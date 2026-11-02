// Test harness only: wraps the compiled, unmodified Pages worker to measure real D1 metadata.
import worker from '../.wrangler/pages-build/index.js';
function observedDb(db,metrics){
  const record=result=>{metrics.read+=result.meta?.rows_read||0;metrics.written+=result.meta?.rows_written||0;return result;};
  function statement(source){return {source,bind:(...args)=>statement(source.bind(...args)),all:async()=>record(await source.all()),run:async()=>record(await source.run()),first:async column=>{const result=record(await source.all()),row=result.results[0];return row?(column?row[column]:row):null;}};}
  return {prepare:sql=>statement(db.prepare(sql)),withSession:mode=>observedDb(db.withSession(mode),metrics),batch:async statements=>(await db.batch(statements.map(s=>s.source))).map(record)};
}
export default {async fetch(request,env,context){
  const metrics={read:0,written:0},pending=[];
  const response=await worker.fetch(request,{...env,DB:observedDb(env.DB,metrics)},{...context,waitUntil:p=>{pending.push(p);context.waitUntil(p);}});
  await Promise.allSettled(pending);
  const headers=new Headers(response.headers);headers.set('X-Test-Rows-Read',String(metrics.read));headers.set('X-Test-Rows-Written',String(metrics.written));
  return new Response(response.body,{status:response.status,headers});
}};
