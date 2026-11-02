import { mkdir, copyFile, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve, join, parse } from 'node:path';
import { createHash } from 'node:crypto';
const output = resolve('dist');
await mkdir(output, { recursive: true });
await mkdir(join(output,'assets'), { recursive: true });
// Explicit allowlist: never publish source, credentials, or the local database.
let html=await readFile('public/index.html','utf8');
for (const name of ['app.js','styles.css','material.css','goals.css','enterprise.css','favicon.svg']) {
  const content=await readFile(join('public',name));
  const hash=createHash('sha256').update(content).digest('hex').slice(0,12), part=parse(name), asset=`${part.name}.${hash}${part.ext}`;
  await writeFile(join(output,'assets',asset),content);
  await copyFile(join('public',name),join(output,name));
  html=html.replaceAll(`/${name}`,`/assets/${asset}`);
}
await writeFile(join(output,'index.html'),html);
for(const route of ['join','demo']){await mkdir(join(output,route),{recursive:true});await writeFile(join(output,route,'index.html'),html);}
await writeFile(join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2));
await unlink(join(output,'_redirects')).catch(error=>{if(error.code!=='ENOENT')throw error;});
await writeFile(join(output, '_headers'), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
`+['/','/index.html','/join/','/join/index.html','/demo/','/demo/index.html','/app.js','/styles.css','/material.css','/goals.css','/enterprise.css'].map(path=>`${path}\n  Cache-Control: no-cache\n`).join('')+'\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
console.log('Cloudflare Pages assets ready in dist/. Pages automatically bundles functions/.');
