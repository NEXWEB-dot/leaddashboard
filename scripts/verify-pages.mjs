import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Runs the compiled Pages Functions in Cloudflare's local workerd runtime.
// No Cloudflare account, remote database, or network credentials are used.
const runtime = new Miniflare(convertV4MiniflareOptions({
  workers: [{
    name: 'leadroom', modules: true,
    scriptPath: '.wrangler/pages-build/index.js',
    compatibilityDate: '2026-10-30', d1Databases: ['DB'],
    bindings: { SETUP_TOKEN: 'runtime-test-private-setup-code-32-chars', ADMIN_EMAIL: 'owner@example.com' },
  }],
  cf: false,
}));
try {
  const db = await runtime.getD1Database('DB');
  const schema = await readFile('cloudflare/schema.sql', 'utf8');
  const statements = schema.match(/CREATE TRIGGER[\s\S]*?END;|CREATE [\s\S]*?;/g);
  await db.batch(statements.map(sql => db.prepare(sql)));
  let cookie = '', csrf = '';
  async function request(path, input) {
    const response = await runtime.dispatchFetch(`https://leadroom.example/api/${path}`, { method: input ? 'POST' : 'GET', headers: { cookie, ...(input ? { Origin: 'https://leadroom.example', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const body = await response.json(); if (body.csrf) csrf = body.csrf;
    return { status: response.status, body };
  }
  assert.equal((await request('session')).body.needsSetup, true);
  const setup = await request('setup', { name: 'Runtime Owner', email: 'owner@example.com', password: 'a private runtime test password', setupToken: 'runtime-test-private-setup-code-32-chars' });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.equal((await request('state')).body.user.role, 'admin');
  const post = await request('submissions', { kind: 'instagram', title: 'Runtime verified post', url: 'https://www.instagram.com/p/RuntimeProof/', proof: 'Original campaign post from the workspace owner.' });
  assert.equal(post.status, 201, JSON.stringify(post.body));
  assert.equal((await request(`submissions/${post.body.id}/review`, { decision: 'approve' })).status, 200);
  const state = (await request('state')).body;
  assert.equal(state.leaderboards['all:points'][0].points, 10);
  assert.equal(state.audit.some(event => event.action === 'submission.owner_review'), true);
  assert.equal((await request('invites', { email: 'member@example.com' })).status, 201);
  await request('logout', {});
  assert.equal((await request('state')).status, 401);
  assert.equal((await request('login', { email: 'owner@example.com', password: 'a private runtime test password' })).status, 200);
  console.log('Cloudflare runtime verified: D1 schema, setup, password hashing, sessions, approvals, scoring, audit, invitations, and login.');
} finally { await runtime.dispose(); }
