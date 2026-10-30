import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, safeURL, instagramURL, rankMembers, periodStart } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

const account = (email, name = 'Test Member') => ({ name, email, password: 'correct horse battery staple' });
function team() {
  const store = createStore();
  const admin = store.bootstrap(account('admin@example.com', 'Test Admin'));
  const add = (email, role = 'member') => { const invite = store.invite(admin, { email, role }); return store.join({ ...account(email), token: invite.token }); };
  return { store, admin, reviewer: add('reviewer@example.com', 'admin'), member: add('member@example.com'), other: add('other@example.com') };
}
const leadInput = (suffix = '12345') => ({ kind: 'lead', title: 'Acme · Website redesign', url: `https://www.linkedin.com/posts/acme_activity-${suffix}-xx?utm_source=test`, country: 'USA', service: 'Website redesign', notes: 'Seeking a responsive redesign with a contact form.' });
const postInput = (code = 'SamplePost') => ({ kind: 'instagram', title: 'Our new website showcase', url: `https://www.instagram.com/p/${code}/?igsh=tracking`, proof: 'Posted from our official team account; campaign launch.' });
function throwsStatus(fn, status, pattern) { assert.throws(fn, e => e.status === status && (!pattern || pattern.test(e.message))); }

test('URLs canonicalize tracking, country subdomains, and LinkedIn activity aliases', () => {
  const canonical = 'https://www.linkedin.com/feed/update/urn:li:activity:12345';
  assert.equal(safeURL('https://pk.linkedin.com/posts/acme_activity-12345-abc?trk=x#x'), canonical);
  assert.equal(safeURL('https://www.linkedin.com/feed/update/urn:li:activity:12345/?trk=x'), canonical);
  assert.equal(instagramURL('https://www.instagram.com/reel/ABC123/?igsh=x').key, instagramURL('https://instagram.com/p/ABC123').key);
  for (const bad of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://127.0.0.1/x', 'https://localhost/x']) assert.throws(() => safeURL(bad));
  for (const bad of ['https://instagram.com/teamname', 'https://instagram.com.evil.com/p/ABC', 'https://example.com/p/ABC']) assert.throws(() => instagramURL(bad));
});

test('invite-only accounts: bound to email, single use, and admin-only', () => {
  const { store, admin, member } = team();
  try {
    throwsStatus(() => store.bootstrap(account('intruder@example.com')), 409);
    throwsStatus(() => store.invite(member, { email: 'new@example.com' }), 403);
    const invite = store.invite(admin, { email: 'new@example.com' });
    throwsStatus(() => store.join({ ...account('wrong@example.com'), token: invite.token }), 403);
    const joined = store.join({ ...account('new@example.com'), token: invite.token });
    assert.equal(joined.role, 'member');
    throwsStatus(() => store.join({ ...account('new@example.com'), token: invite.token }), 403);
    const expired = store.invite(admin, { email: 'expired@example.com' });
    store.db.prepare("UPDATE invites SET expires_at='2000-01-01' WHERE email='expired@example.com'").run();
    throwsStatus(() => store.join({ ...account('expired@example.com'), token: expired.token }), 403);
    assert.equal(store.login(account('new@example.com')).id, joined.id);
    throwsStatus(() => store.login({ email: 'new@example.com', password: 'wrong password' }), 401);
  } finally { store.close(); }
});

test('10 points per post and 1 per DM, only after independent approval', () => {
  const { store, admin, reviewer, member } = team();
  try {
    const lead = store.submit(member, leadInput());
    const post = store.submit(member, { ...postInput(), points: 99999, userId: admin.id, status: 'approved' });
    assert.equal(post.userId, member.id); assert.equal(post.status, 'pending');
    const score = () => store.state(member).leaderboards['all:points'].find(m => m.id === member.id);
    assert.equal(score().points, 0);
    throwsStatus(() => store.review(member, post.id, { decision: 'approve' }), 403);
    const own = store.submit(admin, postInput('AdminOwn'));
    throwsStatus(() => store.review(admin, own.id, { decision: 'approve' }), 403, /own/);
    store.review(reviewer, own.id, { decision: 'approve' });
    store.review(admin, post.id, { decision: 'approve' });
    assert.equal(score().points, 10);
    store.review(admin, lead.id, { decision: 'approve' });
    assert.equal(score().points, 10); assert.equal(score().leads, 1);
    const dm = store.submit(member, { kind: 'dm', title: 'Sent proposal', leadId: lead.id, url: 'https://example.com/private-proof', proof: 'Sent a website proposal to the named prospect on LinkedIn.' });
    assert.equal(score().points, 10);
    store.review(admin, dm.id, { decision: 'approve' });
    assert.equal(score().points, 11);
    assert.equal(store.state(member).submissions.find(s => s.id === lead.id).stage, 'contacted');
    throwsStatus(() => store.review(admin, dm.id, { decision: 'approve' }), 409);
    store.review(admin, post.id, { decision: 'revoke', reason: 'Post ownership could not be verified.' });
    assert.equal(score().points, 1);
    store.review(admin, lead.id, { decision: 'revoke', reason: 'The source is no longer valid.' });
    assert.equal(score().points, 0); assert.equal(score().leads, 0);
    assert.equal(store.state(member).submissions.find(s => s.id === dm.id).status, 'rejected');
    assert.throws(() => store.db.prepare('UPDATE audit SET details=?').run('tampered'), /immutable/);
    assert.throws(() => store.db.prepare('DELETE FROM audit').run(), /immutable/);
  } finally { store.close(); }
});

test('duplicate leads/posts/DMs are blocked globally; DM evidence is private', () => {
  const { store, admin, member, other } = team();
  try {
    const lead = store.submit(member, leadInput());
    throwsStatus(() => store.submit(other, { ...leadInput(), url: 'https://pk.linkedin.com/feed/update/urn:li:activity:12345?different=1' }), 409);
    store.submit(member, postInput());
    throwsStatus(() => store.submit(other, { ...postInput(), url: 'https://instagram.com/reel/SamplePost/?different=1' }), 409);
    const dmInput = { kind: 'dm', title: 'Contacted Acme', leadId: lead.id, url: 'https://example.com/evidence', proof: 'Private message text and recipient evidence, visible to reviewers.' };
    throwsStatus(() => store.submit(member, dmInput), 400);
    store.review(admin, lead.id, { decision: 'approve' });
    throwsStatus(() => store.submit(other, dmInput), 403);
    const dm = store.submit(member, dmInput);
    throwsStatus(() => store.submit(member, dmInput), 409);
    const visible = user => store.state(user).submissions.find(s => s.id === dm.id);
    assert.equal(visible(other).url, ''); assert.equal(visible(other).proof, '');
    assert.equal(visible(member).proof, dmInput.proof); assert.equal(visible(admin).url, dmInput.url);
    assert.deepEqual(store.state(member).audit, []);
    throwsStatus(() => store.update(other, lead.id, { stage: 'won', followUp: '', notes: 'Changed without permission.' }), 403);
  } finally { store.close(); }
});

test('rejected evidence can be resubmitted; disabling accounts revokes sessions', () => {
  const { store, admin, member } = team();
  try {
    const s = store.submit(member, postInput());
    store.review(admin, s.id, { decision: 'reject', reason: 'Please provide ownership context.' });
    store.resubmit(member, s.id, { evidence: 'Updated ownership evidence with campaign details.' });
    assert.equal(store.state(member).submissions[0].status, 'pending');
    const session = store.createSession(member.id);
    assert.equal(store.session(session.token).user.id, member.id);
    store.updateMember(admin, member.id, { role: 'member', active: false });
    assert.equal(store.session(session.token), null);
    throwsStatus(() => store.login(account(member.email)), 401);
    throwsStatus(() => store.updateMember(admin, admin.id, { role: 'member', active: false }), 403);
    assert.equal(store.state(admin).leaderboards['all:points'].some(m => m.id === member.id), false);
  } finally { store.close(); }
});

test('rank ties and Monday/month boundaries use Karachi time', () => {
  const monday = new Date('2026-10-26T00:00:00+05:00');
  assert.equal(periodStart('week', monday), '2026-10-25T19:00:00.000Z');
  assert.equal(periodStart('month', new Date('2026-11-01T00:01:00+05:00')), '2026-10-31T19:00:00.000Z');
  const members = ['a', 'b', 'c'].map(id => ({ id, name: id, active: true, createdAt: '2026-01-01' }));
  const submissions = [
    { userId: 'a', kind: 'instagram', status: 'approved', approvedAt: monday.toISOString() },
    { userId: 'b', kind: 'instagram', status: 'approved', approvedAt: monday.toISOString() },
    { userId: 'c', kind: 'instagram', status: 'pending', approvedAt: '' },
  ];
  assert.deepEqual(rankMembers(members, submissions, 'week', 'points', monday).map(m => [m.id, m.rank, m.points]), [['a', 1, 10], ['b', 1, 10], ['c', 3, 0]]);
});

test('data and scores survive closing and reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leadroom-test-'));
  let store = createStore(join(dir, 'test.sqlite'));
  try {
    const admin = store.bootstrap(account('admin@example.com'));
    const invite = store.invite(admin, { email: 'member@example.com' });
    const member = store.join({ ...account('member@example.com'), token: invite.token });
    const post = store.submit(member, postInput()); store.review(admin, post.id, { decision: 'approve' });
    store.close(); store = createStore(join(dir, 'test.sqlite'));
    assert.equal(store.state(admin).leaderboards['all:points'][0].points, 10);
    assert.equal(store.countUsers(), 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP: bootstrap token, protected APIs, CSRF, origin, cookies, static pages, and role checks', async () => {
  const app = createApp({ store: createStore(), setupToken: 'test-setup-token' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '', csrf = '';
  async function request(path, input, overrides = {}) {
    const res = await fetch(`${base}${path}`, { method: input ? 'POST' : 'GET', headers: { cookie, ...(input ? { 'Content-Type': 'application/json', Origin: base, 'X-CSRF-Token': csrf } : {}), ...overrides }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const setCookie = res.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const data = res.headers.get('content-type').includes('application/json') ? await res.json() : await res.text();
    if (data.csrf) csrf = data.csrf;
    return { res, data };
  }
  try {
    assert.equal((await request('/api/state')).res.status, 401);
    assert.equal((await request('/api/session')).data.needsSetup, true);
    assert.equal((await request('/api/setup', { ...account('admin@example.com'), setupToken: 'wrong' })).res.status, 403);
    const setup = await request('/api/setup', { ...account('admin@example.com'), setupToken: 'test-setup-token' });
    assert.equal(setup.res.status, 200); assert.match(setup.res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await request('/api/setup', { ...account('admin2@example.com'), setupToken: 'test-setup-token' })).res.status, 409);
    assert.equal((await request('/api/invites', { email: 'member@example.com' }, { 'X-CSRF-Token': 'wrong' })).res.status, 403);
    assert.equal((await request('/api/invites', { email: 'member@example.com' }, { Origin: 'https://evil.example' })).res.status, 403);
    const invitation = await request('/api/invites', { email: 'member@example.com' }); assert.equal(invitation.res.status, 201);
    const post = await request('/api/submissions', postInput()); assert.equal(post.res.status, 201);
    assert.equal((await request(`/api/submissions/${post.data.id}/review`, { decision: 'approve' })).res.status, 403);
    await request('/api/logout', {});
    assert.equal((await request('/api/state')).res.status, 401);
    assert.equal((await request('/api/join', { ...account('member@example.com'), token: invitation.data.token })).res.status, 200);
    assert.equal((await request('/api/invites', { email: 'another@example.com' })).res.status, 403);
    assert.equal((await request('/api/state')).data.user.role, 'member');
    for (const path of ['/', '/demo', '/join', '/styles.css', '/material.css', '/app.js', '/favicon.svg']) {
      const { res } = await request(path); assert.equal(res.status, 200); assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    }
    assert.equal((await request('/.env')).res.status, 404);
    assert.equal((await request('/data/leads.sqlite')).res.status, 404);
    assert.equal((await request('/api/password', { currentPassword: 'wrong', password: 'a completely different passphrase' })).res.status, 403);
    assert.equal((await request('/api/password', { currentPassword: account('').password, password: 'a completely different passphrase' })).res.status, 200);
    assert.equal((await request('/api/state')).res.status, 401);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});

test('production refuses missing HTTPS origin and sets Secure session cookies', async () => {
  const store = createStore();
  assert.throws(() => createApp({ store, production: true }), /HTTPS/);
  const app = createApp({ store, production: true, origin: 'https://leads.example.com', setupToken: 'setup-code' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://leads.example.com' }, body: JSON.stringify({ ...account('admin@example.com'), setupToken: 'setup-code' }) });
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /__Host-nexweb=.*; Secure/);
  } finally { await new Promise(resolve => app.server.close(resolve)); store.close(); }
});
