// Declarative project E2E; no scripts, foreign origins, credentials, or eval.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
function valueAt(value, path) {
  for (const key of path.split('.')) {
    assert.ok(value !== null && typeof value === 'object' && Object.hasOwn(value, key), 'Missing scenario result: ' + path);
    value = value[key];
  }
  return value;
}
function substitute(value, saved) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{([a-zA-Z0-9_.]+)\}\}$/);
    if (whole) return valueAt(saved, whole[1]);
    return value.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, key) => encodeURIComponent(String(valueAt(saved, key))));
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, saved));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, saved)]));
  return value;
}
function validate(config) {
  assert.ok(config && typeof config === 'object' && JSON.stringify(config).length <= 64000, 'Invalid E2E configuration');
  for (const key of ['steps', 'cleanup']) {
    assert.ok(config[key] === undefined || (Array.isArray(config[key]) && config[key].length <= 50), 'Too many scenario steps');
    for (const step of config[key] || []) {
      assert.ok(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'].includes(step.method || 'GET'), 'Invalid scenario method');
      assert.ok(typeof step.path === 'string' && step.path.startsWith('/api/admin/'), 'Scenarios use the app admin API');
      assert.ok(Number.isInteger(step.status) && step.status >= 200 && step.status < 600, 'Specify the expected response status');
      if (step.save) assert.match(step.save, /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
      // `as` names an app role: the step runs as a synthetic member holding only it.
      if (step.as !== undefined) assert.ok(typeof step.as === 'string' && /^[^\n]{1,100}$/.test(step.as), 'Scenario role names are 1-100 characters');
      // What the project's Tests tab calls the step; derived from it when absent.
      if (step.title !== undefined) assert.ok(typeof step.title === 'string' && /^[^\n]{1,120}$/.test(step.title.trim()), 'Scenario titles are 1-120 characters on one line');
      if (step.description !== undefined) assert.ok(typeof step.description === 'string' && step.description.trim().length <= 400, 'Scenario descriptions are at most 400 characters');
    }
  }
  if ((config.steps || []).some(step => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(step.method))) {
    assert.ok(config.cleanup?.length, 'Write scenarios must include cleanup steps');
  }
  return config;
}
const OUTCOMES = {400: 'is rejected as invalid', 401: 'is refused', 403: 'is refused', 404: 'is not found', 405: 'is not allowed', 409: 'conflicts'};
const sentence = text => text.charAt(0).toUpperCase() + text.slice(1);
// A readable title and description for a step that brings none.
function describe(entry, kind) {
  const method = entry.method || 'GET';
  const parts = entry.path.replace(/^\/api\/admin\//, '').split('?')[0].split('/').filter(Boolean);
  const resource = (parts[0] || 'the admin API').replace(/_/g, ' ');
  const action = parts[2] === 'actions' && parts[3] ? parts[3].replace(/_/g, ' ') : null;
  const one = parts.length > 1;
  const what = action ? `run “${action}” on a record in ${resource}`
    : method === 'OPTIONS' ? `describe ${resource}`
    : method === 'GET' ? (one ? `read a record in ${resource}` : `list ${resource}`)
    : method === 'POST' ? `create a record in ${resource}`
    : method === 'DELETE' ? `delete a record in ${resource}`
    : `update a record in ${resource}`;
  const outcome = OUTCOMES[entry.status] || (entry.status < 300 ? '' : 'answers ' + entry.status);
  const who = entry.as ? `${entry.as}: ` : '';
  const title = (kind === 'cleanup' ? 'Clean up: ' : '') + (who + (who ? what : sentence(what)) + (outcome ? ' ' + outcome : ''));
  const actor = entry.as ? `a member holding only the ${entry.as} role` : 'the owner';
  const description = `${method} ${entry.path} as ${actor} expects ${entry.status}.`;
  return {title: (entry.title || title).trim().slice(0, 120), description: (entry.description || description).trim().slice(0, 400)};
}
// Every step as a test the project's Tests tab lists. An id stays the same
// while the step's method, path, role and expected status do.
function tests(config) {
  const seen = new Map();
  const list = [];
  for (const key of ['steps', 'cleanup']) {
    const kind = key === 'steps' ? 'step' : 'cleanup';
    (config[key] || []).forEach((entry, index) => {
      const identity = [entry.method || 'GET', entry.path, entry.as || '', entry.status].join(' ');
      const hash = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12);
      const count = (seen.get(kind + hash) || 0) + 1;
      seen.set(kind + hash, count);
      list.push({id: `scenario:${kind}:${hash}${count > 1 ? '-' + count : ''}`, kind, index, entry, ...describe(entry, kind)});
    });
  }
  return list;
}
// `actAs(role)` returns a request function signed in as a member holding only
// that role; steps without `as` run as the owner. `observe(test, event)` hears
// each step start, pass, fail, or be skipped after an earlier failure.
async function run(config, request, origin, actAs, observe = async () => {}) {
  validate(config);
  const saved = Object.create(null);
  const lookup = new Map(tests(config).map(test => [test.entry, test]));
  const step = async entry => {
    const test = lookup.get(entry);
    const details = {method: entry.method || 'GET', path: entry.path, as: entry.as || null, expected: entry.status};
    await observe(test, {status: 'running', details});
    try { details.actual = await perform(entry); } catch (error) {
      await observe(test, {status: 'failed', error: error.message, details});
      throw error;
    }
    await observe(test, {status: 'passed', details});
  };
  const perform = async entry => {
    // eslint-disable-next-line no-unused-vars
    const {as, title, description, ...rest} = entry;
    const resolved = substitute(rest, saved);
    let send = request;
    if (as !== undefined) {
      assert.ok(actAs, 'Role scenarios are not available on this platform');
      send = await actAs(as);
    }
    const url = new URL(resolved.path, origin);
    assert.ok(url.origin === origin && url.pathname.startsWith('/api/admin/') && !url.username && !url.password && !url.hash && !resolved.path.includes('\\'), 'Scenario path leaves the app API');
    const response = await send(url.pathname + url.search, resolved.method || 'GET', resolved.body);
    assert.equal(response.status, resolved.status, 'Unexpected API scenario response: ' + (as === undefined ? '' : as + ' ') + (resolved.method || 'GET') + ' ' + url.pathname);
    if (resolved.save) saved[resolved.save] = response.data;
    for (const check of resolved.expect || []) assert.deepEqual(valueAt(response.data, check.path), check.value, 'Scenario assertion: ' + check.path);
    return response.status;
  };
  let failure;
  const steps = config.steps || [];
  let started = 0;
  try {
    for (const entry of steps) { started++; await step(entry); }
  } catch (error) {
    failure = error;
    for (const entry of steps.slice(started)) await observe(lookup.get(entry), {status: 'skipped'});
  }
  finally {
    for (const entry of config.cleanup || []) {
      // Cleaning up a record an earlier failure kept from being created has
      // nothing to do: it is skipped, not another failure.
      try { substitute(entry, saved); } catch (error) {
        if (/^Missing scenario result/.test(error.message)) {
          await observe(lookup.get(entry), {status: 'skipped', details: {method: entry.method || 'GET', path: entry.path, as: entry.as || null, expected: entry.status, reason: 'Nothing to clean up: an earlier step did not create it.'}});
          continue;
        }
      }
      try { await step(entry); } catch (error) { failure ||= error; }
    }
  }
  if (failure) throw failure;
}
module.exports = {validate, substitute, run, tests, describe};
