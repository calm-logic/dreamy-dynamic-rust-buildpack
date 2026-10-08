// Trusted deployed-app browser gate. Synthetic account details arrive on stdin.
// Each check is reported as it starts and finishes (`TEST {...}` lines on
// stdout, after the `TESTS [...]` plan), with an animated recording of the
// browser for the checks that drive it, for the project's Tests tab.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const scenarios = require('./app-scenarios.cjs');
const tests = require('./app-tests.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/ant/code/asaak/asaak-e2e-tests/node_modules/playwright');
// Lines that could carry a credential never leave the test.
const safe = message => String(message || '').split('\n').filter(line => !/(cookie|authorization|password|token|secret|signature)\s*[:=]/i.test(line)).join('\n').slice(0, 4000);
(async () => {
  const lines=readline.createInterface({input:process.stdin});
  const messages=lines[Symbol.asyncIterator]();
  const input=JSON.parse((await messages.next()).value);
  // Dreamy names the folder its report, failure screenshot and recordings go to.
  const output=path.resolve(input.output);
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const planned=tests.plan({custom:input.custom,scenarios:input.scenarios});
  const titles=new Map(planned.map(test=>[test.id,test.title]));
  const recorded=new Set(tests.CORE.filter(test=>test.visual).map(test=>test.id));
  const reported=new Set();
  const report=event=>{if(['passed','failed','skipped'].includes(event.status))reported.add(event.id);console.log('TEST '+JSON.stringify(event));};
  console.log('TESTS '+JSON.stringify(planned));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || chromium.executablePath(),args:['--no-sandbox']});
  let phase='open app';
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  // Use the browser's network/session context, like the app itself. Separate
  // Node request contexts can use a different DNS resolver on the release host.
  const request=async (pathname,method='GET',body)=>page.evaluate(async({pathname,method,body})=>{
    const response=await fetch(pathname,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=null}
    return {status:response.status,data};
  },{pathname,method,body});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // One check of the plan: reported as running, then passed or failed with its recording.
  const keep=async (id,recording)=>{
    if(!recording)return null;
    const media=await recording.stop();
    if(!media)return null;
    const file='test-'+id.replace(/[^a-z0-9-]+/gi,'_')+'.png';
    fs.writeFileSync(path.join(output,file),media.data);
    return {type:media.type,file};
  };
  const check=async (id,run)=>{
    phase=titles.get(id) || id;
    const started_at=new Date().toISOString();
    report({id,status:'running',started_at});
    const recording=recorded.has(id)?tests.recorder(page):null;
    try { await run(); }
    catch(error) {
      report({id,status:'failed',started_at,finished_at:new Date().toISOString(),error:safe(error.message),media:await keep(id,recording)});
      throw error;
    }
    report({id,status:'passed',started_at,finished_at:new Date().toISOString(),media:await keep(id,recording)});
  };
  try {
    let mail;
    await check('core:sign-in',async()=>{
      await page.goto(input.url,{waitUntil:'domcontentloaded'});
      await page.waitForURL(url=>url.origin===input.url && url.pathname==='/api/login/',{timeout:60000});
      await page.getByLabel('Email address',{exact:true}).waitFor();
      await page.screenshot({path:path.join(output,'sign-in.png'),fullPage:true});
      await page.getByLabel('Email address',{exact:true}).fill(input.username);
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      await page.getByText('Check your inbox.',{exact:false}).first().waitFor({timeout:30000});
    });
    await check('core:email-link',async()=>{
      console.log('MAGIC_LINK_REQUESTED');
      mail=JSON.parse((await messages.next()).value);
      const link=new URL(mail.magic_link);
      assert.equal(link.origin,input.url);assert.equal(link.pathname,'/api/login/');
      assert.match(new URLSearchParams(link.hash.slice(1)).get('token'),/^[A-Za-z0-9_-]{64}$/);
      await page.goto(mail.magic_link,{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'Confirm sign in',exact:true}).click();
      await page.waitForURL(url=>url.origin===input.url && !url.pathname.includes('/api/'),{timeout:60000});
    });
    const assertLogo=async dark=>{
      const expected=input.branding[dark?'logo_dark_url':'logo_light_url'] || input.branding.logo_url;
      if(expected)assert.equal(await page.locator('.q-drawer img').first().getAttribute('src'),expected,'Admin drawer must show workspace branding');
    };
    await check('core:home',async()=>{
      if (input.custom) {
        // An app may make its landing page a workspace of its own, outside the shared
        // shell; it only has to load signed in. The shell (account menu, theme, workspace
        // branding) is checked on the core Users screen every app keeps.
        await page.waitForLoadState('networkidle');
        assert.ok(!new URL(page.url()).pathname.startsWith('/api/'),'The signed-in landing page loads');
        await page.screenshot({path:path.join(output,'home.png'),fullPage:true,animations:'disabled'});
        await page.goto(input.url+'/users/');
      }
      await page.getByRole('button',{name:'Account menu',exact:true}).waitFor({timeout:60000});
      if (!input.custom) {
        await page.locator('.q-toolbar').getByText('Home',{exact:true}).waitFor({timeout:60000});
        await page.locator('.core-home').getByText('Core resources',{exact:true}).waitFor();
        assert.equal(await page.locator('.core-home-resource').count(),7);
      }
      await page.waitForLoadState('networkidle');
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.locator('body.body--dark').count(),1);
      if (!input.custom) await page.screenshot({path:path.join(output,'home.png'),fullPage:true,animations:'disabled'});
      await assertLogo(true);
    });
    await check('core:theme',async()=>{
      // On a desktop the theme switch is a header icon; the account menu keeps profile and sign-out.
      for (const [label,expected] of [['Switch to light mode',false],['Switch to dark mode',true]]) {
        await page.getByRole('button',{name:label,exact:true}).click();
        await page.reload();
        await page.getByRole('button',{name:'Account menu',exact:true}).waitFor({timeout:60000});
        assert.equal(await page.locator('body.body--dark').count(),expected?1:0);
        await assertLogo(expected);
      }
    });
    let resources;
    await check('core:api',async()=>{
      const health=await request('/api/health');
      assert.equal(health.data.revision,input.revision);
      const metadata=await request('/api/admin/','OPTIONS');
      assert.equal(metadata.status,200);
      resources=metadata.data.resources;
      const branding=await request('/branding.json');
      assert.equal(branding.data.company_name,input.branding.company_name);
      assert.equal(branding.data.primary_color,input.branding.primary_color);
      const kinds=['users','identities','identity_verifications','roles','dashboards','views','providers'];
      for (const kind of kinds) assert.ok(resources[kind], 'Missing shared core resource: ' + kind);
      if (!input.custom) assert.deepEqual(Object.keys(resources).sort(),kinds.sort());
      for(const kind of kinds){
        // Roles, users, dashboards, views and providers are writable for people whose
        // roles allow it, as the owner's Admin role does; sign-in identities and their
        // verifications are read-only for everyone.
        const writable=['roles','users','dashboards','views','providers'].includes(kind);
        for(const operation of ['create','update','delete']){
          const allowed=resources[kind].permissions[operation];
          assert.equal(typeof allowed,'boolean',kind+' '+operation);
          if(!writable) assert.equal(allowed,false,kind+' '+operation);
        }
        const response=await request('/api/admin/'+kind+'/');
        assert.equal(response.status,200,kind);
        assert.ok(Array.isArray(response.data[kind]),kind);
      }
      assert.equal((await request('/api/admin/identities/','POST',{name:'Unsupported write'})).status,405);
    });
    if (input.custom) {
      await check('core:resources',async()=>{
        for (const kind of input.scenarios?.resources || []) {
          assert.match(kind,/^[a-z][a-z0-9_]*$/);
          assert.ok(resources[kind], 'Missing registered resource: ' + kind);
          assert.equal((await request('/api/admin/'+kind+'/')).status,200,kind);
          await page.goto(input.url+'/'+kind+'/');
          await page.getByRole('button',{name:'Account menu',exact:true}).waitFor({timeout:60000});
          await page.waitForLoadState('networkidle');
        }
      });
      phase='application scenarios';
      // Steps with `as` run as a synthetic member holding only that role: the owner
      // adds the person, the release runner signs an operator grant for them, and
      // they get their own browser session. They are removed afterwards.
      const members=new Map(), added=[], contexts=[];
      const actAs=async role=>{
        if(members.has(role))return members.get(role);
        assert.ok(input.operator_secret,'Role scenarios need operator sessions, which this platform has not configured');
        const roles=await request('/api/admin/roles/?per_page=1000&exclude_links=1');
        assert.equal(roles.status,200,'list roles');
        const held=(roles.data.roles||[]).find(item=>item.name===role);
        assert.ok(held,'Scenario role is missing from the app: '+role);
        const email=('release-'+input.revision.slice(0,8)+'-'+role.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'@example.com').slice(0,200);
        let person=await request('/api/admin/users/','POST',{email,name:'Release check: '+role,roles:[held.id]});
        if(person.status===400){
          // Left over from an interrupted run: reuse it with only this role.
          const found=await request('/api/admin/users/?per_page=1000&exclude_links=1');
          const existing=(found.data.users||[]).find(item=>item.email===email);
          assert.ok(existing,'Could not add the '+role+' check user');
          person=await request('/api/admin/users/'+existing.id+'/','PATCH',{roles:[held.id]});
        }
        assert.ok([200,201].includes(person.status),'add the '+role+' check user');
        added.push(person.data.user.id);
        const expires=Math.floor(Date.now()/1000)+300;
        const signature=crypto.createHmac('sha256',input.operator_secret).update('operator\n'+email+'\n'+expires).digest('hex');
        const session=await request('/api/operator/session','POST',{email,expires,signature});
        assert.equal(session.status,200,'open a session for the '+role+' check user');
        const context=await browser.newContext();contexts.push(context);
        await context.addCookies([{name:'dream_app',value:session.data.token,domain:new URL(input.url).hostname,path:'/api',httpOnly:true,secure:true,sameSite:'Lax'}]);
        const rolePage=await context.newPage();
        await rolePage.goto(input.url+'/api/health',{waitUntil:'domcontentloaded'});
        const send=async (pathname,method='GET',body)=>rolePage.evaluate(async({pathname,method,body})=>{
          const response=await fetch(pathname,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
          const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=null}
          return {status:response.status,data};
        },{pathname,method,body});
        const me=await send('/api/admin/users/me/');
        assert.equal(me.data?.user?.email,email,'the '+role+' session is that person');
        members.set(role,send);
        return send;
      };
      // Each scenario step is a test of its own; API steps carry no recording.
      const observe=async (test,event)=>{
        const at=new Date().toISOString();
        if(event.status==='running'){phase=test.title;report({id:test.id,status:'running',started_at:at,details:event.details});}
        else report({id:test.id,status:event.status,finished_at:at,...(event.error?{error:safe(event.error)}:{}),...(event.details?{details:event.details}:{})});
      };
      try { await scenarios.run(input.scenarios || {},request,input.url,actAs,observe); }
      finally {
        for(const context of contexts)await context.close().catch(()=>{});
        for(const id of added)await request('/api/admin/users/'+id+'/','DELETE');
      }
    }
    await check('core:users',async()=>{
      await page.goto(input.url+'/users/');
      await page.getByRole('button',{name:'Account menu',exact:true}).waitFor({timeout:60000});
      await page.getByText(input.username,{exact:true}).first().waitFor({timeout:60000});
      assert.equal(await page.getByRole('button',{name:'copilot button',exact:true}).count(),0);
      await page.screenshot({path:path.join(output,'users.png'),fullPage:true,animations:'disabled'});
    });
    await check('core:roles-providers',async()=>{
      // Every app keeps Users, Roles and Providers, whatever navigation it draws.
      for (const [route,label] of [['/roles/','Roles'],['/providers/','Providers']]) {
        await page.goto(input.url+route);
        await page.getByRole('button',{name:'Account menu',exact:true}).waitFor({timeout:60000});
        await page.locator('.q-toolbar').getByText(label,{exact:true}).first().waitFor({timeout:60000});
        await page.waitForLoadState('networkidle');
        assert.equal(new URL(page.url()).pathname,route,`The ${label} page stays open`);
      }
      await page.screenshot({path:path.join(output,'providers.png'),fullPage:true,animations:'disabled'});
    });
    await check('core:user-details',async()=>{
      const me=await request('/api/admin/users/me/');
      await page.goto(input.url+'/users/'+me.data.user.id+'/');
      await page.getByText(input.username,{exact:true}).first().waitFor({timeout:60000});
      await page.screenshot({path:path.join(output,'user-details.png'),fullPage:true,animations:'disabled'});
      assert.deepEqual(errors,[]);
    });
    await check('core:sign-out',async()=>{
      await page.getByRole('button',{name:'Account menu',exact:true}).click();
      await page.getByText('Logout',{exact:true}).click();
      await page.getByRole('button',{name:'Yes',exact:true}).click();
      await page.waitForURL(url=>url.origin===input.url && url.pathname==='/api/login/',{timeout:60000});
      await page.getByRole('button',{name:'Continue',exact:true}).waitFor();
      const loggedOut=await page.goto(input.url+'/api/admin/users/me/');
      assert.equal(loggedOut.status(),401);
      assert.match(await page.locator('body').innerText(),/Authentication credentials were not provided/);
    });
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,url:input.url,revision:input.revision,checks:planned.map(test=>test.title)},null,2));
    console.log('Generated app E2E passed.');
  } catch(error) {
    await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
    // Whatever the failure stopped from running is reported as skipped.
    for(const test of planned) if(!reported.has(test.id)) report({id:test.id,status:'skipped'});
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:false,phase,error:safe(error.message),errors},null,2));
    throw new Error('Generated app E2E failed during '+phase);
  } finally {lines.close();await browser.close();}
})().catch(error=>{console.error(error.message);process.exit(1)});
