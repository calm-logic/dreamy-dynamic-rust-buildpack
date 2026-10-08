// The tests a release runs against a deployed app, as the project's Tests tab
// lists them, and the moving pictures it keeps of each: the browser recorded as
// an animated PNG (APNG), assembled from Playwright screenshots without any
// image library, so it works wherever the release E2E runs.
const crypto = require('node:crypto');
const scenarios = require('./app-scenarios.cjs');

// The core checks every deployed app passes, in the order they run. `custom`
// checks run only for apps with registered models; `visual` ones are recorded.
const CORE = [
  {id: 'core:sign-in', title: 'Sign-in page', visual: true,
   description: "The app opens on its own sign-in page, takes the owner's email address and says a sign-in link is on its way."},
  {id: 'core:email-link', title: 'Sign-in email', visual: true,
   description: 'A real sign-in email arrives, and its one-time link signs the owner in once they confirm.'},
  {id: 'core:home', title: 'Admin home', visual: true,
   description: "The shared admin opens on Home in dark mode with the workspace's name, colors and logo."},
  {id: 'core:theme', title: 'Light and dark mode', visual: true,
   description: 'Switching between light and dark mode from the header sticks after a reload, with the matching logo.'},
  {id: 'core:api', title: 'Core API and permissions', visual: false,
   description: 'The app reports this exact revision, lists every built-in resource with the permissions the owner should have, and refuses writes nobody may make.'},
  {id: 'core:resources', title: "The app's own resources", visual: true, custom: true,
   description: 'Each resource the app registers answers through its API and opens in the admin.'},
  {id: 'core:users', title: 'Users list', visual: true,
   description: 'The Users page lists the people who may sign in, the owner among them.'},
  {id: 'core:roles-providers', title: 'Roles and providers', visual: true,
   description: 'The Roles and Providers pages every app keeps open in the shared admin, beside Users.'},
  {id: 'core:user-details', title: "The owner's user record", visual: true,
   description: "The owner's own record opens with their details."},
  {id: 'core:sign-out', title: 'Sign out', visual: true,
   description: 'Signing out returns to the sign-in page, and the old session no longer reaches the API.'},
];

// Every test one stage of a release will run, in order: core checks with the
// project's scenario steps after its own resources.
function plan({custom, scenarios: config}) {
  const core = CORE.filter(test => custom || !test.custom);
  const steps = custom && config && (config.steps || config.cleanup) ? scenarios.tests(config) : [];
  const after = core.findIndex(test => test.id === 'core:users');
  const list = [...core.slice(0, after), ...steps, ...core.slice(after)];
  return list.map((test, position) => ({id: test.id, title: test.title, description: test.description, position}));
}

// --- Animated PNG -----------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function chunks(png) {
  const list = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    list.push({type: png.toString('ascii', at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length)});
    at += 12 + length;
  }
  return list;
}
// Screenshots of one page share their size and pixel format, so each frame's
// compressed image data can be reused as is: no decoding or re-encoding.
// `frames` are `{png, ms}` with how long each shows; the result loops forever.
function apng(frames) {
  const parsed = frames.map(frame => ({...frame, chunks: chunks(frame.png)}));
  const header = parsed[0].chunks.find(c => c.type === 'IHDR').data;
  if (parsed.some(frame => !frame.chunks.find(c => c.type === 'IHDR').data.equals(header))) return frames.at(-1).png;
  const out = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header)];
  const control = Buffer.alloc(8);
  control.writeUInt32BE(parsed.length, 0);
  out.push(chunk('acTL', control));
  let sequence = 0;
  parsed.forEach((frame, index) => {
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(sequence++, 0);
    fc.writeUInt32BE(header.readUInt32BE(0), 4);
    fc.writeUInt32BE(header.readUInt32BE(4), 8);
    fc.writeUInt16BE(Math.max(1, Math.min(65535, Math.round(frame.ms))), 20);
    fc.writeUInt16BE(1000, 22);
    out.push(chunk('fcTL', fc));
    for (const data of frame.chunks.filter(c => c.type === 'IDAT').map(c => c.data)) {
      if (index === 0) out.push(chunk('IDAT', data));
      else {
        const sq = Buffer.alloc(4);
        sq.writeUInt32BE(sequence++, 0);
        out.push(chunk('fdAT', Buffer.concat([sq, data])));
      }
    }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

// Remove a middle frame; the frame before it shows for its time as well.
function drop(frames, index) {
  frames[index - 1].ms += frames[index].ms;
  frames.splice(index, 1);
}
// Records a page while a test runs: a frame every `interval` ms (identical
// frames merge), at most `limit` frames, the final state always kept, and the
// whole animation under `budget` bytes, dropping middle frames to fit.
function recorder(page, {interval = 450, limit = 14, budget = 1_800_000} = {}) {
  const frames = [];
  let running = true;
  let last = null;
  const capture = async () => {
    try {
      const png = await page.screenshot({type: 'png', animations: 'disabled', caret: 'hide'});
      const digest = crypto.createHash('sha1').update(png).digest('hex');
      const now = Date.now();
      if (last && last.digest === digest) return;
      if (last) last.ms = now - last.at;
      last = {png, digest, at: now, ms: 0};
      frames.push(last);
      if (frames.length > limit) drop(frames, 1 + Math.floor((frames.length - 2) / 2));
    } catch { /* The page may be navigating; the next frame will do. */ }
  };
  const loop = (async () => {
    while (running) {
      await capture();
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      await capture();
      if (!frames.length) return null;
      if (last) last.ms = 1600;
      const chosen = frames.map(frame => ({...frame}));
      const size = list => list.reduce((total, frame) => total + frame.png.length, 0);
      while (chosen.length > 2 && size(chosen) > budget) drop(chosen, Math.floor(chosen.length / 2));
      if (chosen.length === 1 || size(chosen) > budget) return {type: 'image/png', data: chosen.at(-1).png};
      return {type: 'image/apng', data: apng(chosen.map(({png, ms}) => ({png, ms: ms || interval})))};
    },
  };
}

module.exports = {CORE, plan, apng, recorder, crc32};

// `node app-tests.cjs plan` prints the plan for the release input on stdin.
if (require.main === module && process.argv[2] === 'plan') {
  let text = '';
  process.stdin.on('data', data => { text += data; });
  process.stdin.on('end', () => {
    try { process.stdout.write(JSON.stringify(plan(JSON.parse(text)))); }
    catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
  });
}
