import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('Pages build fingerprints assets, revalidates entry pages, and keeps route HTML at its own path',()=>{
  const root=mkdtempSync(join(tmpdir(),'leadroom-build-'));
  try{
    mkdirSync(join(root,'public'));
    for(const name of ['index.html','app.js','styles.css','material.css','goals.css','enterprise.css','favicon.svg','Manrope.ttf','Manrope-OFL.txt'])copyFileSync(new URL(`../public/${name}`,import.meta.url),join(root,'public',name));
    writeFileSync(join(root,'private-secret.txt'),'must not publish');
    const build=()=>execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/build-pages.mjs',import.meta.url))],{cwd:root,stdio:'pipe'});
    build();
    let html=readFileSync(join(root,'dist/index.html'),'utf8');
    const script=html.match(/src="(\/assets\/app\.[a-f0-9]+\.js)"/)?.[1];
    assert.ok(script,'entry page must use a content-fingerprinted script');
    assert.ok(existsSync(join(root,'dist',script)));
    assert.match(html,/\/assets\/enterprise\.[a-f0-9]+\.css/);
    const stylesheet=html.match(/href="(\/assets\/enterprise\.[a-f0-9]+\.css)"/)[1];
    const styles=readFileSync(join(root,'dist',stylesheet),'utf8');
    assert.match(styles,/\/assets\/Manrope\.[a-f0-9]+\.ttf/);
    assert.equal(readFileSync(join(root,'dist/join/index.html'),'utf8'),html);
    assert.equal(readFileSync(join(root,'dist/demo/index.html'),'utf8'),html);
    assert.equal(existsSync(join(root,'dist/_redirects')),false);
    assert.equal(existsSync(join(root,'dist/private-secret.txt')),false);
    const headers=readFileSync(join(root,'dist/_headers'),'utf8');
    assert.match(headers,/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    assert.match(headers,/\n\/\n\s+Cache-Control: no-cache/);
    writeFileSync(join(root,'public/app.js'),readFileSync(join(root,'public/app.js'),'utf8')+'\n/* changed asset */');
    build();html=readFileSync(join(root,'dist/index.html'),'utf8');
    assert.notEqual(html.match(/src="([^"]+)"/)[1],script);
  }finally{rmSync(root,{recursive:true,force:true});}
});
