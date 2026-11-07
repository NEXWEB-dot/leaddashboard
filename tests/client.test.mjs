import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Source-level smoke checks. These do not replace visual browser inspection.
function client(path = '/demo', session = {}, hash = '', fetchImpl) {
  const events = {}, nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', open: false, querySelector:child=>node(child), classList: { add() {}, remove() {} }, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; } });
    return nodes.get(key);
  };
  const anchors=[];
  const document = { querySelector: node, addEventListener: (name, fn) => { events[name] = fn; }, createElement:()=>{const a={click(){}};anchors.push(a);return a;}, title: '', hidden: false };
  const context = vm.createContext({ document, location: { pathname: path, hash, origin: 'http://localhost' }, crypto: webcrypto, URL, URLSearchParams, Blob, Intl, Date, console, navigator: {}, history: { replaceState() {} }, window: { scrollTo() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, fetch: fetchImpl || (async () => ({ ok: true, json: async () => session })) });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  return { node, document, context, anchors, click: async dataset => events.click({ target: { closest: () => ({ dataset }) }, preventDefault() {} }) };
}
test('sample dashboard renders and all eight screens and submission dialogs open', async () => {
  const c = client();
  assert.match(c.node('#app').innerHTML, /My work/);
  assert.match(c.node('#app').innerHTML, /Preview workspace/);
  assert.match(c.node('#app').innerHTML, /rank r1/);
  for (const [page, text] of [['goals', 'Your weekly goals'], ['leads', 'One shared pipeline'], ['leaderboard', 'By leads'], ['review', 'Review contributions'], ['team', 'Your team'], ['activity', 'Workspace audit trail'], ['rules', '10'], ['overview', 'Your activities']]) {
    await c.click({ page }); assert.match(c.node('#app').innerHTML, new RegExp(text));
  }
  for (const kind of ['lead', 'instagram', 'dm']) { await c.click({ add: kind }); assert.equal(c.node('#modal').open, true); assert.match(c.node('#modal').innerHTML, new RegExp(`data-kind="${kind}"`)); }
  await c.click({ action: 'invite' }); assert.match(c.node('#modal').innerHTML, /Email address/);
  assert.match(c.node('#modal').innerHTML, /name="role"/);
  await c.click({ action: 'outcome' }); assert.match(c.node('#modal').innerHTML, /Client won · 50 points/);
  await c.click({ action: 'edit-goals' }); assert.match(c.node('#modal').innerHTML, /name="teamPoints"/);
  await c.click({ action: 'close' }); assert.equal(c.node('#modal').open, false);
});

test('personal home and badges use compact summary totals rather than the recent activity page', async () => {
  const c=client();
  vm.runInContext(`state.compact=true; state.lifetime={ [state.user.id]:{lead:200,instagram:5,dm:120,reply:30,call:10,win:3} }; state.leaderboards={'week:points':[{...state.user,rank:1,leads:123,posts:5,dms:55,replies:4,calls:2,wins:1,points:177}]}; state.myPendingCount=7; state.daily={lead:[9,0,0,0,0,0,0]};`,c.context);
  await c.click({page:'overview'});
  assert.match(c.node('#app').innerHTML,/Your activities/);
  assert.match(c.node('#app').innerHTML,/123/);
  assert.match(c.node('#app').innerHTML,/177/);
  const badges=vm.runInContext('achievements(state.user)',c.context);
  assert.equal(badges.every(b=>b.earned),true);
  assert.match(vm.runInContext("materialChart('lead','Leads','','green')",c.context),/9/);
});

test('compact refresh handles 304 without parsing JSON or replacing data', async () => {
  const seeded=client(), data=JSON.parse(JSON.stringify(vm.runInContext('state',seeded.context)));
  data.compact=true; data.pendingCount=3; data.myPendingCount=0;
  const calls=[];
  const c=client('/',{},'',async(url,options)=>{
    calls.push({url,options});
    const body=url.endsWith('/session')?{user:data.user,csrf:'test',compact:true}:data;
    const unchanged=url.endsWith('/dashboard')&&options.headers['If-None-Match']==='"version-1"';
    return {ok:!unchanged,status:unchanged?304:200,headers:new Headers({ETag:'"version-1"'}),json:async()=>{assert.equal(unchanged,false,'304 must not parse JSON');return body;}};
  });
  await new Promise(resolve=>setImmediate(resolve));
  await vm.runInContext('refresh(false,true)',c.context);
  assert.equal(calls.filter(r=>r.url.endsWith('/dashboard')).length,2);
  assert.equal(vm.runInContext('state.pendingCount',c.context),3);
  assert.match(c.node('#app').innerHTML,/Your activities/);
});

test('late list responses cannot overwrite a newer search',async()=>{
  const pending=[];
  const c=client('/demo',{},'',(url)=>new Promise(resolve=>pending.push({url,resolve})));
  vm.runInContext("compactMode=true;page='leads';query='first'",c.context);
  const first=vm.runInContext('loadRecords()',c.context);
  vm.runInContext("query='second'",c.context);
  const second=vm.runInContext('loadRecords()',c.context);
  const seed=JSON.parse(JSON.stringify(vm.runInContext("state.submissions.find(s=>s.kind==='lead')",c.context)));
  pending[1].resolve({ok:true,json:async()=>({items:[{...seed,id:'new',title:'Newer search result'}],nextCursor:''})});
  await second;
  pending[0].resolve({ok:true,json:async()=>({items:[{...seed,id:'old',title:'Outdated search result'}],nextCursor:''})});
  await first;
  assert.equal(vm.runInContext('recordPage.items[0].id',c.context),'new');
  assert.match(c.node('#lead-results').innerHTML,/Newer search result/);
  assert.doesNotMatch(c.node('#lead-results').innerHTML,/Outdated search result/);
});

test('export reads every filtered page and escapes spreadsheet formulas',async()=>{
  const requests=[];
  const seed=client(), row=JSON.parse(JSON.stringify(vm.runInContext("state.submissions.find(s=>s.kind==='lead')",seed.context)));
  const c=client('/demo',{},'',async url=>{
    const params=new URL(url,'http://localhost').searchParams;requests.push(params);
    const page=params.get('cursor');
    return {ok:true,json:async()=>({items:page?[{...row,id:'last',title:'Last matching prospect'}]:[{...row,id:'first',title:'=DANGEROUS()'}],nextCursor:page?'':'next-page'})};
  });
  vm.runInContext("compactMode=true;page='leads';filter='approved';country='USA';query='website'",c.context);
  await vm.runInContext('exportCSV()',c.context);
  assert.equal(requests.length,2);
  assert.ok(requests.every(p=>p.get('filter')==='approved'&&p.get('country')==='USA'&&p.get('query')==='website'));
  const csv=await (await fetch(c.anchors[0].href)).text();URL.revokeObjectURL(c.anchors[0].href);
  assert.match(csv,/'=DANGEROUS\(\)/);assert.match(csv,/Last matching prospect/);
});

test('polling backs off on failures and retains visible work',async()=>{
  const c=client('/',{},'',async url=>{if(url.endsWith('/session'))return {ok:true,json:async()=>({user:null})};throw Error('Temporary network failure');});
  await new Promise(resolve=>setImmediate(resolve));
  vm.runInContext('state=seedDemo();compactMode=true;render()',c.context);
  const before=c.node('#app').innerHTML;
  await vm.runInContext('poll()',c.context);
  assert.ok(vm.runInContext('retryAt>Date.now()',c.context));
  assert.equal(c.node('#app').innerHTML,before);
  assert.match(c.node('#sync-status').textContent,/Connection interrupted/);
});

test('eligible lead picker can page beyond fifty identical titles',async()=>{
  const seed=client(),row=JSON.parse(JSON.stringify(vm.runInContext("state.submissions.find(s=>s.kind==='lead')",seed.context)));
  const c=client('/demo',{},'',async url=>({ok:true,json:async()=>({items:[{...row,id:new URL(url,'http://localhost').searchParams.get('cursor')?'oldest':'recent',title:'Same company website'}],nextCursor:new URL(url,'http://localhost').searchParams.get('cursor')?'':'older-page'})}));
  vm.runInContext('compactMode=true',c.context);
  await vm.runInContext("loadEligible('dm')",c.context);
  assert.match(vm.runInContext("eligiblePicker('Lead',eligibleItems)",c.context),/data-eligible="next"/);
  vm.runInContext('modal.showModal()',c.context);
  await c.click({eligible:'next'});
  assert.equal(vm.runInContext('eligibleItems[0].id',c.context),'oldest');
});

test('export resumes a throttled page without discarding prior rows or duplicating an active export',async()=>{
  const seed=client(),row=JSON.parse(JSON.stringify(vm.runInContext("state.submissions.find(s=>s.kind==='lead')",seed.context)));
  let calls=0,release;const delays=[];
  const c=client('/demo',{},'',async url=>{
    calls++;if(calls===1)await new Promise(resolve=>{release=resolve;});
    const cursor=new URL(url,'http://localhost').searchParams.get('cursor');
    if(calls===2)return {ok:false,status:429,headers:new Headers({'Retry-After':'60'}),json:async()=>({error:'Wait for the next rate window.'})};
    return {ok:true,json:async()=>({items:[{...row,title:cursor?'Last page after retry':'First completed page'}],nextCursor:cursor?'':'last'})};
  });
  c.context.setTimeout=(fn,ms)=>{if(ms>=60000){delays.push(ms);queueMicrotask(fn);}return 0;};
  vm.runInContext("compactMode=true;page='leads'",c.context);
  const first=vm.runInContext('exportCSV()',c.context);
  await vm.runInContext('exportCSV()',c.context);assert.equal(calls,1);
  release();await first;assert.equal(calls,3);assert.deepEqual(delays,[60000]);
  const csv=await(await fetch(c.anchors[0].href)).text();URL.revokeObjectURL(c.anchors[0].href);
  assert.match(csv,/First completed page/);assert.match(csv,/Last page after retry/);
});

test('guided lead form submits pending work through the real form handler',async()=>{
  const c=client();
  c.context.FormData=class{constructor(form){this.values=form.values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}};
  const form={dataset:{form:'submission',kind:'lead'},querySelector:()=>null,values:{title:'New form lead',url:'https://example.com/new-form-lead',country:'USA',service:'Website redesign',notes:'The prospect needs a responsive website redesign.'}};
  c.context.testForm=form;
  await vm.runInContext('onSubmit({target:{closest:()=>testForm},preventDefault(){}})',c.context);
  assert.equal(vm.runInContext("state.submissions.find(s=>s.title==='New form lead')?.status",c.context),'pending');
});

test('mobile navigation opens explicitly and closes when a destination is selected',async()=>{
  const c=client();
  await c.click({action:'toggle-menu'});
  assert.equal(vm.runInContext('navOpen',c.context),true);
  assert.match(c.node('#app').innerHTML,/aria-expanded="true"/);
  await c.click({page:'leads'});
  assert.equal(vm.runInContext('navOpen',c.context),false);
  assert.match(c.node('#app').innerHTML,/aria-expanded="false"/);
});

test('lead modal provides platform selector and manage member supports role', async () => {
  const c = client();
  await c.click({ add: 'lead' });
  assert.equal(c.node('#modal').open, true);
  assert.match(c.node('#modal').innerHTML, /name="platform"/);
  assert.match(c.node('#modal').innerHTML, /LinkedIn/);
  assert.match(c.node('#modal').innerHTML, /Facebook/);
  await c.click({ page: 'team' });
  const firstMemberId = vm.runInContext('state.members[1].id', c.context);
  await c.click({ member: firstMemberId });
  assert.equal(c.node('#modal').open, true);
  assert.match(c.node('#modal').innerHTML, /name="role"/);
});

test('workspace search opens the real filtered lead list',async()=>{
  const c=client();c.context.FormData=class{constructor(form){this.values=form.values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}};
  c.context.testForm={dataset:{form:'quick-search'},querySelector:()=>null,values:{query:'Studio'}};
  await vm.runInContext('onSubmit({target:{closest:()=>testForm},preventDefault(){}})',c.context);
  assert.equal(vm.runInContext('page',c.context),'leads');
  assert.equal(vm.runInContext('query',c.context),'Studio');
  assert.match(c.node('#app').innerHTML,/Studio North/);
});

test('goal progress, recognition, shared celebrations, and self-review controls follow approved data', async () => {
  const c = client();
  await c.click({ page: 'goals' });
  assert.match(c.node('#app').innerHTML, /Your achievements/);
  assert.match(c.node('#app').innerHTML, /Client closer/);
  assert.match(c.node('#app').innerHTML, /Everyone’s progress/);
  vm.runInContext("state.goals.teamPoints = 1", c.context);
  await c.click({ page: 'goals' });
  assert.match(c.node('#app').innerHTML, /You did it, together!/);
  await c.click({ page: 'review' });
  const ownId = vm.runInContext("state.submissions.find(s => s.status === 'pending' && s.userId === state.user.id).id", c.context);
  assert.match(c.node('#app').innerHTML, new RegExp(`data-approve="${ownId}"`));
  await c.click({ approve: ownId });
  assert.equal(vm.runInContext(`state.submissions.find(s => s.id === '${ownId}').status`, c.context), 'approved');
  vm.runInContext("state.user = state.members[1]", c.context);
  await c.click({ page: 'goals' });
  assert.doesNotMatch(c.node('#app').innerHTML, /data-action="edit-goals"/);
  await c.click({ page: 'review' });
  assert.doesNotMatch(c.node('#app').innerHTML, /data-approve=/);
});

test('sign-in, initial setup, and invitation screens render without a client error', async () => {
  for (const [path, session, expected] of [['/', { needsSetup: false, user: null }, 'Welcome back'], ['/', { needsSetup: true, user: null }, 'Private setup code'], ['/join', { needsSetup: false, user: null }, 'You’re invited']]) {
    const c = client(path, session); await new Promise(resolve => setImmediate(resolve));
    assert.match(c.node('#app').innerHTML, new RegExp(expected));
  }
});

test('invitation fragments open account creation after Pages redirects the join route to the homepage', async () => {
  const token = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  for (const path of ['/', '/join', '/join/']) {
    const c = client(path, { needsSetup: false, user: null }, `#${token}`);
    await new Promise(resolve => setImmediate(resolve));
    const html = c.node('#app').innerHTML;
    assert.match(html, /data-form="join"/);
    assert.match(html, /name="name"/);
    assert.match(html, /autocomplete="new-password"/);
    assert.match(html, /minlength="12"/);
  }
  for (const hash of ['', '#overview', '#deadbeef']) {
    const c = client('/', { needsSetup: false, user: null }, hash);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(c.node('#app').innerHTML, /data-form="login"/);
  }
});
