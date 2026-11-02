import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sqlStatements} from './sql-statements.mjs';
import {hash} from '../cloudflare/auth.mjs';

const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'leadroom-capacity',modules:[{type:'ESModule',path:'scripts/capacity-worker.mjs',contents:await readFile('scripts/capacity-worker.mjs','utf8')},{type:'ESModule',path:'.wrangler/pages-build/index.js',contents:await readFile('.wrangler/pages-build/index.js','utf8')}],compatibilityDate:'2026-10-30',d1Databases:['DB']}],cf:false}));
const results={workload:{members:10,weeks:26,leadsPerWeek:1500,leads:39000},operations:{}};
try{
  const db=await runtime.getD1Database('DB');
  await db.batch(sqlStatements(await readFile('cloudflare/schema.sql','utf8')).map(s=>db.prepare(s)));
  await db.prepare('UPDATE workspace_meta SET ready=0 WHERE id=1').run();
  for(let i=0;i<10;i++){
    await db.prepare('INSERT INTO users(id,name,email,password,role,active,created_at) VALUES(?,?,?,?,?,1,?)').bind(`person-${i}`,`Teammate ${i}`,`member${i}@example.test`,'test-only-unused-password',i===0?'admin':'member',`2026-01-${String(i+1).padStart(2,'0')}`).run();
    await db.prepare('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').bind(await hash(`capacity-session-${i}`),`person-${i}`,`csrf-${i}`,new Date(Date.now()+86400000).toISOString()).run();
  }
  const created="strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||(CAST((39000-x)/1500 AS INTEGER)*7+(x%5))||' days')";
  await db.prepare(`WITH RECURSIVE numbers(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM numbers WHERE x<39000) INSERT INTO submissions(id,user_id,kind,title,url,unique_key,country,service,notes,status,stage,created_at,updated_at,approved_at,reviewer_id) SELECT printf('lead-%06d',x),'person-'||(x%10),'lead',printf('Opportunity %06d',x),'https://example.test/hiring/'||x,'lead:'||x,CASE WHEN x%2=0 THEN 'USA' ELSE 'Pakistan' END,'Website redesign','A business needs a responsive website and a clear inquiry form.','approved','new',${created},${created},${created},'person-0' FROM numbers`).run();
  for(const [kind,divisor]of[['dm',2],['reply',10],['call',50],['win',150]])await db.prepare(`INSERT INTO submissions(id,user_id,kind,title,url,unique_key,lead_id,proof,status,created_at,updated_at,approved_at,reviewer_id) SELECT ?||id,user_id,?,?||title,'https://evidence.example.test/'||id,?||id,id,'Synthetic private evidence.','approved',created_at,updated_at,approved_at,'person-0' FROM submissions WHERE kind='lead' AND CAST(substr(id,6) AS INTEGER)%?=0`).bind(`${kind}-`,kind,`${kind} · `,`${kind}:`,divisor).run();
  await db.prepare("WITH RECURSIVE n(x)AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<260) INSERT INTO submissions(id,user_id,kind,title,url,unique_key,status,created_at,updated_at,approved_at) SELECT 'post-'||x,'person-'||(x%10),'instagram','Synthetic campaign','https://instagram.com/p/Test'||x,'post:'||x,'approved',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM n").run();
  await db.prepare("WITH RECURSIVE n(x)AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO audit(actor_id,action,target_id,details,created_at) SELECT 'person-0','synthetic.review','test-'||x,'Synthetic audit event',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM n").run();
  await db.prepare('UPDATE workspace_meta SET ready=1 WHERE id=1').run();
  results.workload.contributions=(await db.prepare('SELECT count(*) n FROM submissions').first()).n;
  const actual=(await db.prepare("SELECT SUM(count) n FROM summary_counts WHERE bucket='all' AND kind='lead'").first()).n;
  assert.equal(actual,39000);
  async function request(path,user=0,input,etag){
    const started=performance.now();
    const response=await runtime.dispatchFetch(`https://capacity.example/api/${path}`,{method:input?'POST':'GET',headers:{Cookie:`__Host-nexweb=capacity-session-${user}`,'CF-Connecting-IP':`198.51.100.${user+1}`,...(input?{Origin:'https://capacity.example','Content-Type':'application/json','X-CSRF-Token':`csrf-${user}`}:{...(etag?{'If-None-Match':etag}:{})})},...(input?{body:JSON.stringify(input)}:{})});
    const metrics={rowsRead:Number(response.headers.get('x-test-rows-read')),rowsWritten:Number(response.headers.get('x-test-rows-written')),elapsedMs:Math.round((performance.now()-started)*10)/10};
    const body=response.status===304?null:await response.json();return {status:response.status,body,etag:response.headers.get('etag'),metrics};
  }
  const first=await request('dashboard');assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.totals.all.leads,39000);assert.ok(first.body.submissions.length<=20);
  results.operations.coldDashboard=first.metrics;
  assert.ok(first.metrics.rowsRead<2000,'cold dashboard must not scan the contribution history');
  const cached=await request('dashboard',1);assert.equal(cached.status,200);results.operations.sharedCachedDashboard=cached.metrics;
  assert.ok(cached.metrics.rowsRead<1000,'cached dashboard must not scan the contribution history');
  const clients=await Promise.all(Array.from({length:10},(_,i)=>request('dashboard',i)));
  const unchanged=await Promise.all(clients.map((r,i)=>request('dashboard',i,undefined,r.etag)));
  assert.ok(unchanged.every(r=>r.status===304));assert.ok(unchanged.every(r=>r.metrics.rowsRead<20));
  results.operations.tenConcurrentUnchanged={maxRowsRead:Math.max(...unchanged.map(r=>r.metrics.rowsRead)),maxRowsWritten:Math.max(...unchanged.map(r=>r.metrics.rowsWritten)),maxElapsedMs:Math.max(...unchanged.map(r=>r.metrics.elapsedMs))};
  const burst=await Promise.all(Array.from({length:30},(_,i)=>request('dashboard',i%10,undefined,clients[i%10].etag)));assert.ok(burst.every(r=>r.status===304));
  results.operations.thirtyRequestBurst={successes:burst.length,maxElapsedMs:Math.max(...burst.map(r=>r.metrics.elapsedMs))};
  const listed=await request('records?view=leads');assert.equal(listed.body.items.length,50);assert.ok(listed.metrics.rowsRead<2000);results.operations.leadPage=listed.metrics;
  results.operations.filteredPages={};
  for(const [name,params]of [['emptyStage',{filter:'won'}],['emptyCountry',{country:'Other'}],['emptyStatus',{filter:'rejected'}],['ownCountryMismatch',{country:'USA',mine:'1'}],['ownCountryStageMismatch',{country:'USA',filter:'new',mine:'1'}],['countryStatusMismatch',{country:'USA',filter:'rejected'}]]){
    const filtered=await request(`records?${new URLSearchParams({view:'leads',...params})}`,1);
    assert.equal(filtered.status,200);assert.equal(filtered.body.items.length,0);results.operations.filteredPages[name]=filtered.metrics;
    assert.ok(filtered.metrics.rowsRead<2000,`${name} must not scan lead history`);
  }
  const searched=await request('records?view=leads&query=Opportunity%20000001');assert.equal(searched.body.items.length,1);results.operations.indexedSearch=searched.metrics;
  assert.ok(searched.metrics.rowsRead<2000,'specific indexed search must avoid a history scan');
  let cursor='',exported=0;const ids=new Set();
  do{const response=await request(`records?${new URLSearchParams({view:'leads',limit:'250',cursor})}`);assert.equal(response.status,200);for(const row of response.body.items){ids.add(row.id);exported++;}cursor=response.body.nextCursor;}while(cursor);
  assert.equal(exported,39000);assert.equal(ids.size,39000);results.operations.fullExport={leads:exported,unique:ids.size};
  const addedLead=await request('submissions',1,{kind:'lead',title:'Capacity integration new lead',url:'https://www.linkedin.com/feed/update/urn:li:activity:999999999999999999',country:'USA',service:'Website redesign',notes:'Synthetic prospect needs a responsive website redesign.'});
  assert.equal(addedLead.status,201,JSON.stringify(addedLead.body));results.operations.submitLead=addedLead.metrics;
  const approvedLead=await request(`submissions/${addedLead.body.id}/review`,0,{decision:'approve'});assert.equal(approvedLead.status,200);results.operations.approveLead=approvedLead.metrics;
  const post=await request('submissions',1,{kind:'instagram',title:'Capacity integration post',url:'https://www.instagram.com/p/CapacityIntegrationUnique/',proof:'Synthetic original campaign evidence for runtime verification.'});assert.equal(post.status,201,JSON.stringify(post.body));results.operations.submit=post.metrics;
  const reviewed=await request(`submissions/${post.body.id}/review`,0,{decision:'approve'});assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));results.operations.approve=reviewed.metrics;
  const updated=await request('dashboard',1,undefined,clients[1].etag);assert.equal(updated.status,200);assert.notEqual(updated.etag,clients[1].etag);assert.equal(updated.body.leaderboards['all:points'].find(m=>m.id==='person-1').posts,27);results.operations.afterApproval=updated.metrics;
  const revoked=await request(`submissions/${post.body.id}/review`,0,{decision:'revoke',reason:'Synthetic test revocation for score parity.'});assert.equal(revoked.status,200);
  const afterRevoke=await request('dashboard',1);assert.equal(afterRevoke.body.leaderboards['all:points'].find(m=>m.id==='person-1').posts,26);
  const parity=await db.prepare("SELECT kind,COUNT(*) n FROM submissions WHERE status='approved' GROUP BY kind").all();
  for(const row of parity.results){const counter=await db.prepare("SELECT SUM(count) n FROM summary_counts WHERE bucket='all' AND kind=?").bind(row.kind).first();assert.equal(counter.n,row.n);}
  results.notes=['Local workerd/D1 workload, not a production CPU or uptime guarantee.','Rows include session, rate-limit and version operations; caches may be evicted.','Full export and cold migration are explicit operations, not automatic refreshes.'];
  await mkdir('.wrangler',{recursive:true});await writeFile('.wrangler/capacity-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await runtime.dispose();}
