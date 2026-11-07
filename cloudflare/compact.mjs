import { POINTS, DEFAULT_GOALS, periodStart, fail, detectPlatform } from '../lib/rules.mjs';

const fields={lead:'leads',instagram:'posts',dm:'dms',reply:'replies',call:'calls',win:'wins'};
const empty=()=>({leads:0,posts:0,dms:0,replies:0,calls:0,wins:0,points:0});
const privateKinds=['dm','reply','call','win'];
const cleanUser=r=>({id:r.id,name:r.name,email:r.email,role:r.role,active:Boolean(r.active),createdAt:r.created_at});
const cleanRow=(r,user)=>{
  const hidden=user.role!=='admin' && r.user_id!==user.id && privateKinds.includes(r.kind);
  return {id:r.id,userId:r.user_id,kind:r.kind,title:r.title,url:hidden?'':r.url,country:r.country,service:r.service,notes:hidden?'':r.notes,leadId:r.lead_id,proof:hidden?'':r.proof,status:r.status,stage:r.stage,followUp:r.follow_up,createdAt:r.created_at,updatedAt:r.updated_at,approvedAt:r.approved_at,reviewerId:r.reviewer_id,reviewNote:hidden?'':r.review_note,platform:r.kind==='lead'?(r.platform||detectPlatform(r.url)):''};
};
function ranked(rows,metric){
  const secondary=metric==='points'?'leads':'points';
  rows=rows.filter(r=>r.active).map(r=>({...r})).sort((a,b)=>b[metric]-a[metric] || b[secondary]-a[secondary] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let rank=0;
  return rows.map((row,i)=>{if(!i || row[metric]!==rows[i-1][metric] || row[secondary]!==rows[i-1][secondary]) rank=i+1; return {...row,rank};});
}
const encodeCursor=row=>btoa(JSON.stringify([row.created_at,row.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
function decodeCursor(value){
  try {const pair=JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/'))); if(!Array.isArray(pair)||pair.length!==2||pair.some(v=>typeof v!=='string'||v.length>100)) throw Error(); return pair;}
  catch {fail('Invalid page cursor. Refresh the list.');}
}

// Only sanitized, common summary data goes into this cache. Session/evidence responses never do.
const inflight=new Map();
export async function cachedSummary(key,load,cache){
  if(!cache) return load();
  const request=new Request(key);
  try {const hit=await cache.match(request); if(hit) return await hit.json();} catch { /* Cache eviction/outage must not break database reads. */ }
  if(inflight.has(key)) return inflight.get(key);
  const pending=(async()=>{const data=await load(); try {await cache.put(request,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=45'}}));} catch { /* Best effort cache. */ } return data;})();
  inflight.set(key,pending);
  try{return await pending;}finally{inflight.delete(key);}
}

export function createCompactStore(binding){
  const db=binding.withSession?binding.withSession('first-primary'):binding;
  const q=(sql,...args)=>db.prepare(sql).bind(...args);
  const first=(sql,...args)=>q(sql,...args).first();
  const all=async(sql,...args)=>(await q(sql,...args).all()).results;
  async function revision(){
    try {const row=await first('SELECT revision,ready,cache_id FROM workspace_meta WHERE id=1'); return row?.ready===1?`c1-${row.cache_id}-${row.revision}-${new Date(Date.now()+18000000).toISOString().slice(0,10)}`:null;}
    catch(e){if(/no such table|no such column/i.test(e.message))return null; throw e;}
  }
  async function shared(){
    const time=new Date(), dates=Array.from({length:7},(_,i)=>new Date(time.getTime()+18000000-(6-i)*86400000).toISOString().slice(0,10));
    const buckets=['all',`week:${periodStart('week',time)}`,`month:${periodStart('month',time)}`,...dates.map(d=>`day:${d}`)];
    const [users,counts,goalsRow,queue]=await Promise.all([
      all('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at,id'),
      all(`SELECT bucket,user_id,kind,count FROM summary_counts WHERE bucket IN (${buckets.map(()=>'?').join(',')})`,...buckets),
      first("SELECT value FROM settings WHERE key='weekly_goals'"),
      all('SELECT user_id,kind,status,count FROM queue_counts WHERE count>0')
    ]);
    const members=users.map(cleanUser), totals={}, leaderboards={}, lifetime={}, daily=Object.fromEntries(Object.keys(fields).map(k=>[k,dates.map(()=>0)]));
    for(const p of ['all','week','month']){
      const bucket=p==='all'?'all':`${p}:${periodStart(p,time)}`, byUser=new Map(members.map(m=>[m.id,{...m,...empty()}]));
      totals[p]=empty();
      for(const r of counts.filter(r=>r.bucket===bucket)){
        const row=byUser.get(r.user_id); if(!row||!fields[r.kind])continue;
        row[fields[r.kind]]+=r.count; row.points+=(POINTS[r.kind]||0)*r.count;
        totals[p][fields[r.kind]]+=r.count; totals[p].points+=(POINTS[r.kind]||0)*r.count;
        if(p==='all'){lifetime[r.user_id]??={};lifetime[r.user_id][r.kind]=r.count;}
      }
      for(const metric of ['points','leads'])leaderboards[`${p}:${metric}`]=ranked([...byUser.values()],metric);
    }
    for(const row of counts){const i=dates.indexOf(row.bucket.slice(4));if(row.bucket.startsWith('day:')&&i>=0&&daily[row.kind])daily[row.kind][i]+=row.count;}
    return {members,leaderboards,totals,lifetime,daily,dates,queue,goals:{...DEFAULT_GOALS,...(goalsRow?JSON.parse(goalsRow.value):{})}};
  }
  async function dashboard(user,common){
    const [recent,wins,logs,personalRecent]=await Promise.all([
      all('SELECT * FROM submissions ORDER BY created_at DESC,id DESC LIMIT 20'),
      all("SELECT * FROM submissions INDEXED BY submissions_verified_wins WHERE status='approved' AND approved_at>=? AND kind IN ('reply','call','win') ORDER BY approved_at DESC,id DESC LIMIT 12",periodStart('week')),
      user.role==='admin'?all('SELECT id,actor_id AS actorId,action,target_id AS targetId,details,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 200'):[],
      all('SELECT * FROM submissions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 5',user.id)
    ]);
    const {queue,...safe}=common;
    const pendingCount=queue.filter(r=>r.status==='pending'&&(user.role==='admin'||r.user_id===user.id)).reduce((n,r)=>n+r.count,0);
    const myPendingCount=queue.filter(r=>r.status==='pending'&&r.user_id===user.id).reduce((n,r)=>n+r.count,0);
    return {...safe,user,compact:true,pendingCount,myPendingCount,personalRecent:personalRecent.map(r=>cleanRow(r,user)),submissions:recent.map(r=>cleanRow(r,user)),weeklyWins:wins.map(r=>cleanRow(r,user)),audit:logs,scoring:POINTS,timezone:'Asia/Karachi'};
  }
  async function records(user,params){
    const view=params.get('view')||'leads', filter=params.get('filter')||'all', country=params.get('country')||'all', query=(params.get('query')||'').trim();
    const validFilters=['all','pending','approved','rejected','new','contacted','replied','call_booked','won','lost'];
    if(!['leads','review','eligible'].includes(view))fail('Invalid list view.');
    if(!validFilters.includes(filter))fail('Invalid status filter.');
    if(!['all','USA','Pakistan','Other'].includes(country))fail('Invalid country filter.');
    if(query.length>120)fail('Search must be at most 120 characters.');
    const limit=Number(params.get('limit')||50);if(!Number.isInteger(limit)||limit<1||limit>250)fail('Page size must be 1–250.');
    const clauses=[],args=[],fromArgs=[];
    let source='submissions s';
    if(view==='leads'){
      const owned=params.get('mine')==='1',field=filter==='all'?'':['pending','approved','rejected'].includes(filter)?'status':'stage';
      const index=!owned&&country==='all'&&!field?'submissions_kind_created':owned&&country==='all'&&field==='status'?'submissions_user_kind_status_created':`submissions_lead_${owned?'owned':'team'}_${country!=='all'?'country_':''}${field?field+'_':''}created`;
      source=`submissions s INDEXED BY ${index}`;
    }else if(view==='review')source=`submissions s INDEXED BY ${user.role==='admin'?'submissions_status_created':'submissions_owner_review'}`;
    if(view==='leads'||view==='eligible')clauses.push("s.kind='lead'");
    if(view==='review'){
      const status=filter==='all'?'pending':filter;if(!['pending','approved','rejected'].includes(status))fail('Invalid review filter.');
      clauses.push('s.status=?');args.push(status);
      if(user.role!=='admin'){clauses.push('s.user_id=?');args.push(user.id);}
    }else if(view==='eligible'){
      const claim=params.get('claim')||'dm';if(!privateKinds.includes(claim))fail('Invalid outcome type.');
      clauses.push("s.status='approved'",'s.user_id=?',"NOT EXISTS(SELECT 1 FROM submissions c WHERE c.lead_id=s.id AND c.kind=?)");args.push(user.id,claim);
    }else{
      if(filter!=='all'){clauses.push(['pending','approved','rejected'].includes(filter)?'s.status=?':'s.stage=?');args.push(filter);}
      if(params.get('mine')==='1'){clauses.push('s.user_id=?');args.push(user.id);}
    }
    if(country!=='all'){clauses.push('s.country=?');args.push(country);}
    if(query){
      const tokens=query.match(/[\p{L}\p{N}_]+/gu)||[];
      if(!tokens.length)clauses.push('0');
      else{
        const match=tokens.map(t=>`"${t}"*`).join(' AND ');
        // CROSS JOIN keeps the small search candidate set ahead of the growing history.
        source="(SELECT rowid FROM submissions_search WHERE submissions_search MATCH ? UNION SELECT rowid FROM submissions WHERE user_id IN (SELECT id FROM users WHERE name LIKE ? ESCAPE '\\')) matched CROSS JOIN submissions s ON s.rowid=matched.rowid";
        fromArgs.push(match,`%${query.replace(/[\\%_]/g,'\\$&')}%`);
      }
    }
    if(params.get('cursor')){const [created,id]=decodeCursor(params.get('cursor'));clauses.push('(s.created_at,s.id)<(?,?)');args.push(created,id);}
    const rows=await all(`SELECT s.* FROM ${source} WHERE ${clauses.join(' AND ')} ORDER BY s.created_at DESC,s.id DESC LIMIT ?`,...fromArgs,...args,limit+1);
    return {items:rows.slice(0,limit).map(r=>cleanRow(r,user)),nextCursor:rows.length>limit?encodeCursor(rows[limit-1]):''};
  }
  async function detail(user,id){
    if(typeof id!=='string'||id.length>80)fail('Invalid record.');
    const row=await first('SELECT * FROM submissions WHERE id=?',id);if(!row)fail('Submission not found.',404);
    const linked=row.kind==='lead'?await all('SELECT * FROM submissions WHERE lead_id=?',id):[];
    return {item:cleanRow(row,user),linked:linked.map(r=>cleanRow(r,user))};
  }
  return {revision,shared,dashboard,records,detail};
}
