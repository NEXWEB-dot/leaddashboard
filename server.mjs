import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { createStore, token, fail } from './lib/store.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export function createApp(options = {}) {
  const store = options.store || createStore(join(resolve(process.env.DATA_DIR || './data'), 'leads.sqlite'));
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin || process.env.APP_ORIGIN || '';
  if (production && (!origin.startsWith('https://') || new URL(origin).origin !== origin)) throw new Error('Production requires APP_ORIGIN set to your exact HTTPS origin (no trailing slash).');
  const setupToken = options.setupToken || process.env.SETUP_TOKEN || token();
  const limiters = new Map();
  const cookieName = production ? '__Host-nexweb' : 'nexweb';
  const cookie = (value, clear = false) => `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 604800}${production ? '; Secure' : ''}`;
  const headers = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
  function rateLimit(key, max, ms) {
    const time = Date.now(), current = limiters.get(key);
    const entry = !current || current.until < time ? { count: 0, until: time + ms } : current;
    entry.count++; limiters.set(key, entry);
    if (limiters.size > 5000) for (const [k, v] of limiters) if (v.until < time) limiters.delete(k);
    if (entry.count > max) fail('Too many attempts. Please try again in a few minutes.', 429);
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail('Expected JSON.', 415);
    let size = 0, parts = [];
    for await (const part of req) { size += part.length; if (size > 16000) fail('Request too large.', 413); parts.push(part); }
    try { const value = JSON.parse(Buffer.concat(parts).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid request.'); return value; } catch { fail('Invalid JSON.'); }
  }
  const send = (res, status, data, extra = {}) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) fail('Method not allowed.', 405);
        const files = { '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/material.css': ['material.css', 'text/css'], '/goals.css': ['goals.css', 'text/css'], '/enterprise.css': ['enterprise.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
        const item = files[url.pathname] || (['/', '/demo', '/join'].includes(url.pathname) ? ['index.html', 'text/html'] : null);
        if (!item) fail('Page not found.', 404);
        const data = await readFile(join(root, 'public', item[0]));
        res.writeHead(200, { ...headers, 'Content-Type': `${item[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      const ip = req.socket.remoteAddress || 'unknown';
      rateLimit(`all:${ip}`, 300, 60000);
      const rawCookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const session = store.session(rawCookie);
      const mutation = !['GET', 'HEAD'].includes(req.method);
      if (mutation) {
        const expected = origin || `http://${req.headers.host}`;
        if (req.headers.origin !== expected || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) fail('This request must come from the dashboard.', 403);
      }
      if (url.pathname === '/api/session' && req.method === 'GET') return send(res, 200, { user: session?.user || null, csrf: session?.csrf || null, needsSetup: !store.countUsers() });
      const authPaths = ['/api/setup', '/api/login', '/api/join'];
      if (authPaths.includes(url.pathname) && req.method === 'POST') {
        rateLimit(`auth:${ip}`, 15, 15 * 60000);
        const input = await body(req);
        if (url.pathname === '/api/login' && typeof input.email === 'string') rateLimit(`login:${input.email.trim().toLowerCase()}`, 10, 15 * 60000);
        let user;
        if (url.pathname === '/api/setup') {
          if (store.countUsers()) fail('Setup is already complete.', 409);
          const supplied = Buffer.from(typeof input.setupToken === 'string' ? input.setupToken : '');
          const expected = Buffer.from(setupToken);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail('Incorrect setup code. Use the code shown in your server terminal.', 403);
          user = store.bootstrap(input);
        } else user = url.pathname === '/api/login' ? store.login(input) : store.join(input);
        const created = store.createSession(user.id);
        return send(res, 200, { user, csrf: created.csrf }, { 'Set-Cookie': cookie(created.token) });
      }
      if (!session) fail('Please sign in to continue.', 401);
      if (mutation && req.headers['x-csrf-token'] !== session.csrf) fail('Session verification failed. Refresh and try again.', 403);
      const user = session.user;
      if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, store.state(user));
      if (url.pathname === '/api/logout' && req.method === 'POST') { store.logout(rawCookie); return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', true) }); }
      if (url.pathname === '/api/invites' && req.method === 'POST') return send(res, 201, store.invite(user, await body(req)));
      if (url.pathname === '/api/submissions' && req.method === 'POST') return send(res, 201, store.submit(user, await body(req)));
      if (url.pathname === '/api/goals' && req.method === 'POST') return send(res, 200, store.setGoals(user, await body(req)));
      if (url.pathname === '/api/password' && req.method === 'POST') { const result = store.changePassword(user, await body(req)); return send(res, 200, result, { 'Set-Cookie': cookie('', true) }); }
      const match = url.pathname.match(/^\/api\/submissions\/([a-f0-9-]+)\/(review|update|resubmit)$/);
      if (match && req.method === 'POST') return send(res, 200, store[match[2]](user, match[1], await body(req)));
      const member = url.pathname.match(/^\/api\/members\/([a-f0-9-]+)$/);
      if (member && req.method === 'POST') return send(res, 200, store.updateMember(user, member[1], await body(req)));
      fail('Endpoint not found.', 404);
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.message);
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, store, setupToken };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => {
    console.log(`NEXWEB Leadroom is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (!app.store.countUsers()) console.log(`One-time admin setup code (keep private): ${app.setupToken}`);
    console.log('Open /demo for a separate sample-data preview.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.server.close(() => { app.store.close(); process.exit(0); }));
}
