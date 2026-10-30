import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../cloudflare/app.mjs';
import { createCloudStore } from '../cloudflare/store.mjs';
import { DEFAULT_GOALS } from '../lib/rules.mjs';

// Model the documented D1 prepared statement + atomic batch API using SQLite.
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
  function statement(sql, args = []) {
    return {
      bind: (...values) => statement(sql, values),
      first: async () => sqlite.prepare(sql).get(...args) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args), success: true }),
      run: async () => ({ meta: sqlite.prepare(sql).run(...args), success: true }),
      execute: () => ({ meta: sqlite.prepare(sql).run(...args), success: true }),
    };
  }
  const binding = { prepare: statement, withSession() { return this; }, async batch(statements) { sqlite.exec('BEGIN IMMEDIATE'); try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  const env = { DB: binding, SETUP_TOKEN: 'a-private-test-code-with-more-than-24-characters', ADMIN_EMAIL: 'owner@example.com' };
  const store = createCloudStore(binding);
  return { sqlite, binding, env, store, close: () => sqlite.close() };
}
const account = address => ({ name: address.split('@')[0], email: address, password: 'a private test password 123' });
const leadInput = number => ({ kind: 'lead', title: 'Test prospect website', url: `https://www.linkedin.com/posts/client_activity-${number}-abc`, country: 'USA', service: 'Landing page', notes: 'Looking for a fast landing page with a clear inquiry form.' });
function client(env, ip = '192.0.2.1') {
  let cookie = '', csrf = '';
  return async (path, data, headers = {}) => {
    const response = await handleRequest(new Request(`https://test.pages.dev/api/${path}`, { method: data ? 'POST' : 'GET', headers: { cookie, 'CF-Connecting-IP': ip, ...(data ? { Origin: 'https://test.pages.dev', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const body = await response.json(); if (body.csrf) csrf = body.csrf;
    return { status: response.status, body, response };
  };
}
test('Cloudflare: complete owner setup, member invitation, scoring, privacy, revocation, and goal workflow', async () => {
  const f = fixture(), owner = client(f.env), member = client(f.env, '192.0.2.2');
  try {
    assert.equal((await owner('state')).status, 401);
    assert.equal((await owner('session')).body.setupLocation, 'cloudflare');
    assert.equal((await owner('setup', { ...account('owner@example.com'), setupToken: 'wrong' })).status, 403);
    assert.equal((await owner('setup', { ...account('stranger@example.com'), setupToken: f.env.SETUP_TOKEN })).status, 403);
    const setup = await owner('setup', { ...account('owner@example.com'), setupToken: f.env.SETUP_TOKEN });
    assert.equal(setup.status, 200); assert.match(setup.response.headers.get('set-cookie'), /Secure; SameSite=Strict/);
    assert.equal((await owner('setup', { ...account('other@example.com'), setupToken: f.env.SETUP_TOKEN })).status, 409);
    assert.equal((await owner('invites', { email: 'otheradmin@example.com', role: 'admin' })).status, 403);
    assert.equal((await owner('goals', DEFAULT_GOALS, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await owner('goals', DEFAULT_GOALS, { 'X-CSRF-Token': 'wrong' })).status, 403);
    const invitation = await owner('invites', { email: 'member@example.com' }); assert.equal(invitation.status, 201);
    assert.equal((await member('join', { ...account('wrong@example.com'), token: invitation.body.token })).status, 403);
    assert.equal((await member('join', { ...account('member@example.com'), token: invitation.body.token, role: 'admin' })).body.user.role, 'member');
    assert.equal((await member('join', { ...account('member@example.com'), token: invitation.body.token })).status, 403);
    assert.equal((await member('goals', DEFAULT_GOALS)).status, 403);
    const lead = await member('submissions', leadInput('54321')); assert.equal(lead.status, 201);
    assert.equal((await member(`submissions/${lead.body.id}/review`, { decision: 'approve' })).status, 403);
    assert.equal((await owner(`submissions/${lead.body.id}/review`, { decision: 'approve' })).status, 200);
    assert.equal((await member('submissions', { ...leadInput('54321'), url: 'https://pk.linkedin.com/feed/update/urn:li:activity:54321?tracking=1' })).status, 409);
    let total = 0;
    for (const [kind, points] of [['instagram', 10], ['dm', 1], ['reply', 5], ['call', 20], ['win', 50]]) {
      const claim = { kind, title: 'A meaningful contribution', url: kind === 'instagram' ? 'https://www.instagram.com/p/NEWPOST/' : `https://example.com/private-proof?record=${kind}`, proof: 'An original record with the recipient, date, and verified outcome.', leadId: lead.body.id };
      const submitted = await member('submissions', claim); assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
      assert.equal((await member('submissions', claim)).status, 409);
      assert.equal((await owner(`submissions/${submitted.body.id}/review`, { decision: 'approve' })).status, 200);
      total += points;
      const state = (await member('state')).body;
      assert.equal(state.leaderboards['all:points'].find(m => m.email === 'member@example.com').points, total);
    }
    assert.equal(total, 86);
    const thirdInvite = await owner('invites', { email: 'third@example.com' });
    const third = client(f.env, '192.0.2.3'); await third('join', { ...account('third@example.com'), token: thirdInvite.body.token });
    const thirdState = (await third('state')).body;
    for (const s of thirdState.submissions.filter(s => ['dm','reply','call','win'].includes(s.kind))) { assert.equal(s.proof, ''); assert.equal(s.url, ''); }
    assert.deepEqual(thirdState.audit, []);
    assert.equal((await owner('goals', { ...DEFAULT_GOALS, teamPoints: 700 })).status, 200);
    assert.equal((await member('state')).body.goals.teamPoints, 700);
    assert.equal((await owner(`submissions/${lead.body.id}/review`, { decision: 'revoke', reason: 'The prospect was a duplicate under another URL.' })).status, 200);
    const finalState = (await owner('state')).body;
    assert.equal(finalState.leaderboards['all:points'].find(m => m.email === 'member@example.com').points, 10);
    assert.equal(finalState.submissions.filter(s => s.leadId === lead.body.id && s.status === 'approved').length, 0);
    assert.equal((await member('password', { currentPassword: account('member@example.com').password, password: 'a different private passphrase' })).status, 200);
    assert.equal((await member('state')).status, 401);
    assert.equal((await member('login', { ...account('member@example.com'), password: 'a different private passphrase' })).status, 200);
    const memberId = (await member('state')).body.user.id;
    assert.equal((await owner(`members/${memberId}`, { active: false })).status, 200);
    assert.equal((await member('state')).status, 401);
    assert.throws(() => f.sqlite.exec('DELETE FROM audit'), /immutable/);
  } finally { f.close(); }
});

test('Cloudflare: concurrent setup, invitation use, duplicate claims and approvals are atomic', async () => {
  const f = fixture();
  try {
    const setup = await Promise.allSettled([f.store.bootstrap(account('first@example.com')), f.store.bootstrap(account('second@example.com'))]);
    assert.equal(setup.filter(r => r.status === 'fulfilled').length, 1);
    const owner = setup.find(r => r.status === 'fulfilled').value;
    const invitation = await f.store.invite(owner, { email: 'member@example.com' });
    const joined = await Promise.allSettled([f.store.join({ ...account('member@example.com'), token: invitation.token }), f.store.join({ ...account('member@example.com'), token: invitation.token })]);
    assert.equal(joined.filter(r => r.status === 'fulfilled').length, 1);
    const member = joined.find(r => r.status === 'fulfilled').value;
    const leads = await Promise.allSettled([f.store.submit(member, leadInput('12345')), f.store.submit(member, leadInput('12345'))]);
    assert.equal(leads.filter(r => r.status === 'fulfilled').length, 1);
    const lead = leads.find(r => r.status === 'fulfilled').value;
    const reviews = await Promise.allSettled([f.store.review(owner, lead.id, { decision: 'approve' }), f.store.review(owner, lead.id, { decision: 'reject', reason: 'Conflicting parallel decision' })]);
    assert.equal(reviews.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await f.store.state(owner)).audit.filter(a => a.targetId === lead.id && ['submission.approve','submission.reject'].includes(a.action)).length, 1);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_checks').get().n, 0);
  } finally { f.close(); }
});

test('Cloudflare: missing configuration fails clearly and auth limits persist across requests', async () => {
  const missing = await handleRequest(new Request('https://test.pages.dev/api/session'), {});
  assert.equal(missing.status, 503); assert.match((await missing.json()).error, /binding named DB/);
  const f = fixture(), request = client(f.env);
  try {
    const noSecret = client({ DB: f.binding });
    assert.equal((await noSecret('setup', { ...account('owner@example.com'), setupToken: 'test' })).status, 503);
    for (let i = 0; i < 14; i++) assert.equal((await request('login', account('unknown@example.com'))).status, i < 10 ? 401 : 429);
    assert.equal((await request('login', account('unknown@example.com'))).status, 429);
  } finally { f.close(); }
});
