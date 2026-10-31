import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Source-level smoke checks. These do not replace visual browser inspection.
function client(path = '/demo', session = {}, hash = '') {
  const events = {}, nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', open: false, classList: { add() {}, remove() {} }, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; } });
    return nodes.get(key);
  };
  const document = { querySelector: node, addEventListener: (name, fn) => { events[name] = fn; }, title: '', hidden: false };
  const context = vm.createContext({ document, location: { pathname: path, hash, origin: 'http://localhost' }, crypto: webcrypto, URL, Intl, Date, console, navigator: {}, history: { replaceState() {} }, window: { scrollTo() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, fetch: async () => ({ ok: true, json: async () => session }) });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  return { node, document, context, click: async dataset => events.click({ target: { closest: () => ({ dataset }) }, preventDefault() {} }) };
}
test('sample dashboard renders and all eight screens and submission dialogs open', async () => {
  const c = client();
  assert.match(c.node('#app').innerHTML, /Team dashboard/);
  assert.match(c.node('#app').innerHTML, /Preview workspace/);
  assert.match(c.node('#app').innerHTML, /rank r1/);
  for (const [page, text] of [['goals', 'Your weekly goals'], ['leads', 'One shared pipeline'], ['leaderboard', 'By leads'], ['review', 'Great work deserves'], ['team', 'Better together'], ['activity', 'Workspace audit trail'], ['rules', '10'], ['overview', 'Daily Leads']]) {
    await c.click({ page }); assert.match(c.node('#app').innerHTML, new RegExp(text));
  }
  for (const kind of ['lead', 'instagram', 'dm']) { await c.click({ add: kind }); assert.equal(c.node('#modal').open, true); assert.match(c.node('#modal').innerHTML, new RegExp(`data-kind="${kind}"`)); }
  await c.click({ action: 'invite' }); assert.match(c.node('#modal').innerHTML, /Email address/);
  assert.doesNotMatch(c.node('#modal').innerHTML, /name="role"/);
  await c.click({ action: 'outcome' }); assert.match(c.node('#modal').innerHTML, /Client won · 50 points/);
  await c.click({ action: 'edit-goals' }); assert.match(c.node('#modal').innerHTML, /name="teamPoints"/);
  await c.click({ action: 'close' }); assert.equal(c.node('#modal').open, false);
});

test('goal progress, recognition, shared celebrations, and self-review controls follow approved data', async () => {
  const c = client();
  await c.click({ page: 'goals' });
  assert.match(c.node('#app').innerHTML, /Your achievements/);
  assert.match(c.node('#app').innerHTML, /Client closer/);
  assert.match(c.node('#app').innerHTML, /Everyone’s progress/);
  vm.runInContext("state.goals.teamPoints = 1", c.context);
  await c.click({ page: 'goals' });
  assert.match(c.node('#app').innerHTML, /You did it, together!/);
  await c.click({ page: 'review' });
  const ownId = vm.runInContext("state.submissions.find(s => s.status === 'pending' && s.userId === state.user.id).id", c.context);
  assert.match(c.node('#app').innerHTML, new RegExp(`data-approve="${ownId}"`));
  await c.click({ approve: ownId });
  assert.equal(vm.runInContext(`state.submissions.find(s => s.id === '${ownId}').status`, c.context), 'approved');
  vm.runInContext("state.user = state.members[1]", c.context);
  await c.click({ page: 'goals' });
  assert.doesNotMatch(c.node('#app').innerHTML, /data-action="edit-goals"/);
  await c.click({ page: 'review' });
  assert.doesNotMatch(c.node('#app').innerHTML, /data-approve=/);
});

test('sign-in, initial setup, and invitation screens render without a client error', async () => {
  for (const [path, session, expected] of [['/', { needsSetup: false, user: null }, 'Welcome back'], ['/', { needsSetup: true, user: null }, 'Private setup code'], ['/join', { needsSetup: false, user: null }, 'You’re invited']]) {
    const c = client(path, session); await new Promise(resolve => setImmediate(resolve));
    assert.match(c.node('#app').innerHTML, new RegExp(expected));
  }
});

test('invitation fragments open account creation after Pages redirects the join route to the homepage', async () => {
  const token = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  for (const path of ['/', '/join', '/join/']) {
    const c = client(path, { needsSetup: false, user: null }, `#${token}`);
    await new Promise(resolve => setImmediate(resolve));
    const html = c.node('#app').innerHTML;
    assert.match(html, /data-form="join"/);
    assert.match(html, /name="name"/);
    assert.match(html, /autocomplete="new-password"/);
    assert.match(html, /minlength="12"/);
  }
  for (const hash of ['', '#overview', '#deadbeef']) {
    const c = client('/', { needsSetup: false, user: null }, hash);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(c.node('#app').innerHTML, /data-form="login"/);
  }
});
