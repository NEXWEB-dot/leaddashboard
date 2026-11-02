import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { periodStart } from '../lib/rules.mjs';

const schema = readFileSync(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8');
const migration = () => readFileSync(new URL('../cloudflare/migrations/0001-capacity.sql', import.meta.url), 'utf8');
export function capacityFixture(legacy = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(legacy ? schema.split('/* Capacity optimization schema */')[0] : schema);
  sqlite.prepare("INSERT INTO users(id,name,email,password,role,created_at) VALUES('owner','Owner','owner@example.com','unused','admin','2026-01-01'),('member','Member','member@example.com','unused','member','2026-01-02')").run();
  const insert = (id, kind = 'lead', extra = {}) => {
    const row = { id, kind, status: 'pending', approved: '', lead: null, user: 'member', created: '2026-11-02T10:00:00.000Z', ...extra };
    sqlite.prepare('INSERT INTO submissions(id,user_id,kind,title,url,unique_key,lead_id,status,created_at,updated_at,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.user,row.kind,`Prospect ${id}`,`https://example.com/${id}`,`${kind}:${id}`,row.lead,row.status,row.created,row.created,row.approved);
  };
  function statement(sql, args = []) { return { bind: (...v) => statement(sql,v), first: async () => sqlite.prepare(sql).get(...args) || null, all: async () => ({ results: sqlite.prepare(sql).all(...args), success: true }), run: async () => ({ meta: sqlite.prepare(sql).run(...args), success: true }), execute: () => sqlite.prepare(sql).run(...args) }; }
  const binding = { prepare: statement, withSession() { return this; }, async batch(items) { sqlite.exec('BEGIN'); try { const result=items.map(s=>s.execute()); sqlite.exec('COMMIT'); return result; } catch(e) { sqlite.exec('ROLLBACK'); throw e; } } };
  return { sqlite, insert, binding, close: () => sqlite.close() };
}

test('capacity migration preserves existing records, backfills exact Karachi buckets and can rerun', () => {
  const f = capacityFixture(true);
  try {
    f.insert('a','lead',{ status:'approved', approved:'2026-11-01T20:00:00.000Z' });
    f.insert('b','instagram',{ status:'approved', approved:'2026-11-02T10:00:00.000Z' });
    f.insert('pending');
    f.sqlite.exec(migration());
    const count = (bucket,kind) => f.sqlite.prepare('SELECT count FROM summary_counts WHERE bucket=? AND user_id=? AND kind=?').get(bucket,'member',kind)?.count || 0;
    assert.equal(count('all','lead'),1);
    assert.equal(count(`week:${periodStart('week',new Date('2026-11-02T10:00:00Z'))}`,'lead'),1);
    assert.equal(count('day:2026-11-02','lead'),1);
    assert.equal(f.sqlite.prepare('SELECT ready FROM workspace_meta WHERE id=1').get().ready,1);
    const before = f.sqlite.prepare('SELECT * FROM summary_counts ORDER BY bucket,user_id,kind').all();
    f.sqlite.exec(migration());
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM summary_counts ORDER BY bucket,user_id,kind').all(),before);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM submissions').get().n,3);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM users').get().n,2);
  } finally { f.close(); }
});

test('approval counters follow transitions, rollback, linked revocation and rebuild', () => {
  const f = capacityFixture(true);
  try {
    f.sqlite.exec(migration());
    f.insert('lead');
    const version = () => f.sqlite.prepare('SELECT revision FROM workspace_meta WHERE id=1').get().revision;
    const total = kind => f.sqlite.prepare("SELECT count FROM summary_counts WHERE bucket='all' AND user_id='member' AND kind=?").get(kind)?.count || 0;
    const before = version();
    f.sqlite.exec("UPDATE submissions SET status='approved',approved_at='2026-11-02T10:00:00.000Z' WHERE id='lead'");
    assert.equal(total('lead'),1); assert.ok(version()>before);
    f.sqlite.exec("UPDATE submissions SET notes='Updated context' WHERE id='lead'");
    assert.equal(total('lead'),1);
    f.insert('dm','dm',{ lead:'lead', status:'approved', approved:'2026-11-02T10:00:00.000Z' });
    assert.equal(total('dm'),1);
    f.sqlite.exec("BEGIN; UPDATE submissions SET status='rejected',approved_at='' WHERE id IN ('lead','dm'); ROLLBACK;");
    assert.equal(total('lead'),1); assert.equal(total('dm'),1);
    f.sqlite.exec("UPDATE submissions SET status='rejected',approved_at='' WHERE id IN ('lead','dm')");
    assert.equal(total('lead'),0); assert.equal(total('dm'),0);
    const rejected = f.sqlite.prepare("SELECT SUM(count) n FROM queue_counts WHERE status='rejected'").get().n;
    assert.equal(rejected,2);
    f.sqlite.exec('UPDATE workspace_meta SET ready=0 WHERE id=1');
    f.insert('later','instagram',{ status:'approved', approved:'2026-11-02T10:00:00.000Z' });
    f.sqlite.exec('UPDATE workspace_meta SET ready=1 WHERE id=1');
    assert.equal(total('instagram'),1); assert.equal(total('lead'),0);
  } finally { f.close(); }
});

test('compact dashboard uses saved totals, bounded recent records, and safe shared cache data', async () => {
  const { createCompactStore } = await import('../cloudflare/compact.mjs');
  const f=capacityFixture();
  try {
    for(let i=0;i<121;i++) f.insert(`lead-${String(i).padStart(3,'0')}`,'lead',{status:'approved',approved:new Date().toISOString()});
    f.insert('secret','dm',{lead:'lead-000',status:'approved',approved:new Date().toISOString()});
    f.sqlite.exec("UPDATE submissions SET proof='Private recipient details',url='https://private.example/evidence' WHERE id='secret'");
    const store=createCompactStore(f.binding), owner={id:'owner',role:'admin'}, member={id:'member',role:'member'}, outsider={id:'someone-else',role:'member'};
    const shared=await store.shared();
    assert.equal(shared.totals.all.leads,121);
    assert.equal(shared.leaderboards['all:points'].find(m=>m.id==='member').points,1);
    assert.equal(JSON.stringify(shared).includes('Private recipient'),false);
    assert.equal(JSON.stringify(shared).includes('unused'),false);
    const data=await store.dashboard(member,shared);
    assert.ok(data.submissions.length<=20);
    assert.equal(data.lifetime.member.lead,121);
    const secret=await store.detail(outsider,'secret'); assert.equal(secret.item.proof,''); assert.equal(secret.item.url,'');
    assert.equal((await store.detail(owner,'secret')).item.proof,'Private recipient details');
    assert.equal((await store.detail(member,'secret')).item.proof,'Private recipient details');
  } finally { f.close(); }
});

test('record cursors cover the full filtered history and eligible search finds old owned leads', async () => {
  const { createCompactStore } = await import('../cloudflare/compact.mjs');
  const f=capacityFixture();
  try {
    for(let i=0;i<123;i++) f.insert(`lead-${String(i).padStart(3,'0')}`,'lead',{status:'approved',approved:new Date().toISOString()});
    f.insert('pending'); f.insert('other','lead',{user:'owner',status:'approved',approved:new Date().toISOString()});
    const store=createCompactStore(f.binding), user={id:'member',role:'member'}, ids=[];
    let cursor='';
    do {
      const page=await store.records(user,new URLSearchParams({view:'leads',mine:'1',filter:'approved',cursor}));
      assert.ok(page.items.length<=50); ids.push(...page.items.map(r=>r.id)); cursor=page.nextCursor;
    } while(cursor);
    assert.equal(ids.length,123); assert.equal(new Set(ids).size,123);
    const found=await store.records(user,new URLSearchParams({view:'eligible',query:'lead-000',claim:'dm'}));
    assert.deepEqual(found.items.map(r=>r.id),['lead-000']);
    f.insert('claim','dm',{lead:'lead-000'});
    assert.equal((await store.records(user,new URLSearchParams({view:'eligible',query:'lead-000',claim:'dm'}))).items.length,0);
    const ownQueue=await store.records(user,new URLSearchParams({view:'review',filter:'pending'}));
    assert.ok(ownQueue.items.every(r=>r.userId==='member'));
    await assert.rejects(store.records(user,new URLSearchParams({cursor:'bad'})),/cursor/i);
    await assert.rejects(store.records(user,new URLSearchParams({filter:'sql injection'})),/filter/i);
  } finally { f.close(); }
});

test('compact API returns authenticated conditional responses and invalidates immediately after changes', async () => {
  const { handleRequest }=await import('../cloudflare/app.mjs');
  const { hash }=await import('../cloudflare/auth.mjs');
  const f=capacityFixture(), raw='fake-session-token';
  try {
    f.sqlite.prepare('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(await hash(raw),'member','csrf',new Date(Date.now()+86400000).toISOString());
    const env={DB:f.binding};
    const call=(path,headers={})=>handleRequest(new Request(`https://capacity.example/api/${path}`,{headers:{Cookie:`__Host-nexweb=${raw}`,...headers}}),env);
    assert.equal((await (await call('session')).json()).compact,true);
    let response=await call('dashboard'); assert.equal(response.status,200);
    const etag=response.headers.get('etag'); assert.ok(etag);
    assert.equal(response.headers.get('cache-control'),'no-store');
    response=await call('dashboard',{'If-None-Match':etag}); assert.equal(response.status,304); assert.equal(await response.text(),'');
    f.insert('new-lead');
    response=await call('dashboard',{'If-None-Match':etag}); assert.equal(response.status,200); assert.notEqual(response.headers.get('etag'),etag);
    assert.equal((await response.json()).pendingCount,1);
    f.sqlite.exec("UPDATE users SET active=0 WHERE id='member'");
    assert.equal((await call('dashboard',{'If-None-Match':etag})).status,401);
  } finally { f.close(); }
});

test('lead search index follows edits and rebuilds without indexing private outreach evidence',()=>{
  const f=capacityFixture();
  try{
    f.insert('indexed');f.insert('private','dm',{lead:'indexed'});
    f.sqlite.exec("UPDATE submissions SET notes='Special zebra requirement' WHERE id='indexed'");
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM submissions_search WHERE submissions_search MATCH 'zebra'").get().n,1);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM submissions_search').get().n,1);
    f.sqlite.exec("UPDATE submissions SET notes='Updated osprey requirement' WHERE id='indexed'");
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM submissions_search WHERE submissions_search MATCH 'zebra'").get().n,0);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM submissions_search WHERE submissions_search MATCH 'osprey'").get().n,1);
    f.sqlite.exec('UPDATE workspace_meta SET ready=0 WHERE id=1;UPDATE workspace_meta SET ready=1 WHERE id=1;');
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM submissions_search').get().n,1);
  }finally{f.close();}
});

test('shared cache is optional, reused within a revision, and never contains evidence',async()=>{
  const {cachedSummary}=await import('../cloudflare/compact.mjs');
  const saved=new Map();let reads=0;
  const cache={match:async r=>saved.get(r.url)?.clone(),put:async(r,v)=>saved.set(r.url,v.clone())};
  const load=async()=>({totals:{leads:++reads}});
  assert.equal((await cachedSummary('https://cache.example/v1',load,cache)).totals.leads,1);
  assert.equal((await cachedSummary('https://cache.example/v1',load,cache)).totals.leads,1);
  assert.equal((await cachedSummary('https://cache.example/v2',load,cache)).totals.leads,2);
  assert.equal((await cachedSummary('https://cache.example/v3',load,{match(){throw Error('outage')},put(){throw Error('outage')}})).totals.leads,3);
});

test('legacy workspace advertises fallback until its additive migration is applied',async()=>{
  const {createCompactStore}=await import('../cloudflare/compact.mjs');const f=capacityFixture(true);
  try{assert.equal(await createCompactStore(f.binding).revision(),null);f.sqlite.exec(migration());assert.ok(await createCompactStore(f.binding).revision());}finally{f.close();}
});
