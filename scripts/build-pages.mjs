import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const output = resolve('dist');
await mkdir(output, { recursive: true });
// Explicit allowlist: never publish source, credentials, or the local database.
for (const name of ['index.html','app.js','styles.css','material.css','goals.css','favicon.svg']) await copyFile(join('public', name), join(output, name));
await writeFile(join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2));
await writeFile(join(output, '_redirects'), '/demo /index.html 200\n/join /index.html 200\n');
await writeFile(join(output, '_headers'), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
  Cache-Control: no-cache
`);
console.log('Cloudflare Pages assets ready in dist/. Pages automatically bundles functions/.');
