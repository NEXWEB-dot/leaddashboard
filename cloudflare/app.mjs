import { fail } from '../lib/rules.mjs';
import { createCloudStore } from './store.mjs';
import { equal, hash } from './auth.mjs';

const security = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const send = (status, data, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...security, ...headers } });
const cookieName = '__Host-nexweb';
const cookie = (value, clear = false) => `${cookieName}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 604800}`;

async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) fail('Request body required.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 16000) { await reader.cancel(); fail('Request too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Invalid request.'); return data; }
  catch { fail('Invalid JSON.'); }
}
async function rateLimit(db, key, max, duration) {
  const time = Date.now(), window = Math.floor(time / duration), expires = (window + 1) * duration;
  const digest = await hash(`${key}:${window}`);
  const result = await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(digest, expires).first();
  if (result.count > max) fail('Too many attempts. Please try again in a few minutes.', 429);
}
export async function handleRequest(request, env, context = {}) {
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return send(404, { error: 'Endpoint not found.' });
    if (!env.DB) fail('Cloudflare setup is incomplete: add a D1 database binding named DB, then redeploy.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    await rateLimit(env.DB, `requests:${ip}`, 300, 60000);
    // Delete expired counters without delaying the response. Never store IPs or emails in plaintext.
    if (Math.random() < .02 && context.waitUntil) context.waitUntil(env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(Date.now() - 86400000).run());
    const store = createCloudStore(env.DB);
    const raw = request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const session = await store.session(raw);
    const mutation = !['GET', 'HEAD'].includes(request.method);
    if (mutation) {
      const expected = env.APP_ORIGIN || url.origin;
      if (request.headers.get('origin') !== expected || (request.headers.has('sec-fetch-site') && !['same-origin', 'none'].includes(request.headers.get('sec-fetch-site')))) fail('This request must come from the dashboard.', 403);
    }
    if (url.pathname === '/api/session' && request.method === 'GET') return send(200, { user: session?.user || null, csrf: session?.csrf || null, needsSetup: !await store.countUsers(), setupLocation: 'cloudflare' });
    if (['/api/setup', '/api/login', '/api/join'].includes(url.pathname) && request.method === 'POST') {
      await rateLimit(env.DB, `auth:${ip}`, 15, 15 * 60000);
      const input = await body(request); let user;
      if (url.pathname === '/api/setup') {
        if (await store.countUsers()) fail('Setup is already complete.', 409);
        if (typeof env.SETUP_TOKEN !== 'string' || env.SETUP_TOKEN.length < 24) fail('Add a private SETUP_TOKEN secret of at least 24 characters in Cloudflare, then redeploy.', 503);
        if (!equal(input.setupToken, env.SETUP_TOKEN)) fail('Incorrect setup code. Use the private SETUP_TOKEN you set in Cloudflare.', 403);
        if (env.ADMIN_EMAIL && String(input.email || '').trim().toLowerCase() !== env.ADMIN_EMAIL.trim().toLowerCase()) fail('Use the workspace owner’s email address configured in Cloudflare.', 403);
        user = await store.bootstrap(input);
      } else if (url.pathname === '/api/login') {
        if (typeof input.email === 'string') await rateLimit(env.DB, `login:${input.email.trim().toLowerCase()}`, 10, 15 * 60000);
        user = await store.login(input);
      } else user = await store.join(input);
      const created = await store.createSession(user.id);
      return send(200, { user, csrf: created.csrf }, { 'Set-Cookie': cookie(created.token) });
    }
    if (!session) fail('Please sign in to continue.', 401);
    if (mutation && !equal(request.headers.get('x-csrf-token'), session.csrf)) fail('Session verification failed. Refresh and try again.', 403);
    const user = session.user;
    if (url.pathname === '/api/state' && request.method === 'GET') return send(200, await store.state(user));
    if (url.pathname === '/api/logout' && request.method === 'POST') { await store.logout(raw); return send(200, { ok: true }, { 'Set-Cookie': cookie('', true) }); }
    if (url.pathname === '/api/invites' && request.method === 'POST') return send(201, await store.invite(user, await body(request)));
    if (url.pathname === '/api/submissions' && request.method === 'POST') return send(201, await store.submit(user, await body(request)));
    if (url.pathname === '/api/goals' && request.method === 'POST') return send(200, await store.setGoals(user, await body(request)));
    if (url.pathname === '/api/password' && request.method === 'POST') { const data = await store.changePassword(user, await body(request)); return send(200, data, { 'Set-Cookie': cookie('', true) }); }
    const submission = url.pathname.match(/^\/api\/submissions\/([a-f0-9-]+)\/(review|update|resubmit)$/);
    if (submission && request.method === 'POST') return send(200, await store[submission[2]](user, submission[1], await body(request)));
    const member = url.pathname.match(/^\/api\/members\/([a-f0-9-]+)$/);
    if (member && request.method === 'POST') return send(200, await store.updateMember(user, member[1], await body(request)));
    fail('Endpoint not found.', 404);
  } catch (error) {
    if (!error.status) console.error('Dashboard request failed:', error.message);
    const missingSchema = /no such table/i.test(error.message);
    return send(error.status || (missingSchema ? 503 : 500), { error: error.status ? error.message : missingSchema ? 'Cloudflare setup is incomplete: initialize the D1 database using cloudflare/schema.sql, then reload.' : 'Something went wrong. Please try again.' });
  }
}
