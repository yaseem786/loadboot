import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const shareSource=await read('app/shared/share-inbox.js'), workerSource=await read('app/shared/share-inbox-worker.js');
function cacheStorage(){const stores=new Map();return {
  async open(name){if(!stores.has(name)){const rows=new Map();stores.set(name,{async add(){},async addAll(){},async match(k){return rows.get(String(k))?.clone();},async put(k,r){rows.set(String(k),r.clone());},async delete(k){return rows.delete(String(k));},async keys(){return [...rows.keys()];}});}return stores.get(name);},
  async delete(n){return stores.delete(n);},async keys(){return [...stores.keys()];}
};}
async function shares(){
 const caches=cacheStorage(),context=vm.createContext({caches,Response,crypto:webcrypto,Date,self:{}});
 const m=new vm.SourceTextModule(shareSource,{context});await m.link(()=>{});await m.evaluate();
 vm.runInContext(workerSource,context);
 return {caches,...m.namespace,store:context.self.lbStoreSharedFile};
}
const file=()=>Object.assign(new Blob(['synthetic test only'],{type:'text/plain'}),{name:'sample.txt'});
const request=(before=async()=>{})=>({formData:async()=>{await before();return {getAll:()=>[file()]};}});
async function response(f){const c=await f.caches.open('lb-share-inbox');const keys=await c.keys();return keys.length?c.match(keys[0]):null;}
test('signed-out share reads no file bytes',async()=>{const f=await shares();assert.equal(await f.store(request(()=>assert.fail('read bytes'))),false);});
test('own shared file works; another account cannot read it',async()=>{const f=await shares();await f.syncShareOwner('A');assert.equal(await f.store(request()),true);const r=await response(f);assert.equal(await f.validSharedResponse(r,'A'),true);assert.equal(await f.validSharedResponse(r,'B'),false);});
test('expiry and unowned legacy files are refused',async()=>{const f=await shares();await f.syncShareOwner('A');await f.store(request());const r=await response(f);r.headers.set('x-share-expires',String(Date.now()-1));assert.equal(await f.validSharedResponse(r,'A'),false);assert.equal(await f.validSharedResponse(new Response('legacy'),'A'),false);});
test('account switch purges previous shared copy',async()=>{const f=await shares();await f.syncShareOwner('A');await f.store(request());await f.syncShareOwner('B');assert.equal(await response(f),null);});
test('logout during form parsing cannot store old bytes',async()=>{const f=await shares();await f.syncShareOwner('A');assert.equal(await f.store(request(()=>f.clearSharedFiles())),false);assert.equal(await response(f),null);});
test('account change during form parsing cannot relabel bytes',async()=>{const f=await shares();await f.syncShareOwner('A');assert.equal(await f.store(request(()=>f.syncShareOwner('B'))),false);assert.equal(await response(f),null);});
test('logout racing the final cache write leaves no copy',async()=>{
 const f=await shares();await f.syncShareOwner('A');const c=await f.caches.open('lb-share-inbox'),put=c.put;
 c.put=async(k,r)=>{await put(k,r);await f.clearSharedFiles();};
 assert.equal(await f.store(request()),false);assert.equal(await response(f),null);
});
test('oversized share is refused',async()=>{const f=await shares();await f.syncShareOwner('A');assert.equal(await f.store({formData:async()=>({getAll:()=>[{size:26*1024*1024}]})}),false);});
test('expiry of owner lease refuses a new share before reading bytes',async()=>{const f=await shares();await f.syncShareOwner('A');const c=await f.caches.open('lb-share-owner');const x=await (await c.match('/__share_owner')).json();x.expires=Date.now()-1;await c.put('/__share_owner',new Response(JSON.stringify(x)));assert.equal(await f.store(request(()=>assert.fail('read bytes'))),false);});

async function authFixture(){
 const caches=cacheStorage();await (await caches.open('lb-share-inbox')).put('/old',new Response('old'));await caches.open('lb-app-test');
 const storage=()=>{const values=new Map([['lb-auth-preview-ref','token'],['sb-ref-auth-token','oldtoken'],['theme','dark']]);return {get length(){return values.size;},key:i=>[...values.keys()][i],removeItem:k=>values.delete(k),has:k=>values.has(k)};};
 const localStorage=storage(),sessionStorage=storage();
 const context=vm.createContext({caches,Response,crypto:webcrypto,Date,window:{localStorage,sessionStorage,caches,alert:()=>{}},navigator:{serviceWorker:{}},clearTimeout,setTimeout:(fn)=>{const t=setTimeout(fn,5);t.unref();return t;}});
 const dep=new vm.SourceTextModule(shareSource,{context});await dep.link(()=>{});await dep.evaluate();
 const source=await read('app/shared/session.js');const m=new vm.SourceTextModule(source,{context});
 await m.link(spec=>spec.includes('share-inbox')?dep:new vm.SyntheticModule(['getClient'],function(){this.setExport('getClient',async()=>{throw Error('CDN unavailable');});},{context}));await m.evaluate();
 return {m:m.namespace,caches,localStorage,sessionStorage};
}
test('logout cleans custom and legacy tokens even when auth client fails',async()=>{const f=await authFixture();await f.m.signOut();for(const store of [f.localStorage,f.sessionStorage]){assert.equal(store.has('lb-auth-preview-ref'),false);assert.equal(store.has('sb-ref-auth-token'),false);assert.equal(store.has('theme'),true);}assert.equal((await f.caches.keys()).includes('lb-share-inbox'),false);assert.equal((await f.caches.keys()).includes('lb-app-test'),false);});
test('global logout also runs cleanup when client cannot load',async()=>{const f=await authFixture();await f.m.signOutEverywhere();assert.equal(f.localStorage.has('lb-auth-preview-ref'),false);});

const swRegister=await read('app/shared/sw-register.js');
async function tab(){
 const handlers={},nodes=new Map();let reloads=0,approved=false,posts=0;
 const elem=()=>({style:{},children:[],appendChild(x){this.children.push(x);if(x.id)nodes.set(x.id,x);}});
 const body=elem(),worker={state:'installed',postMessage(){posts++;}},reg={waiting:worker,update:async()=>{},addEventListener(){}};
 const context=vm.createContext({window:{addEventListener:(k,f)=>handlers[k]=f,confirm:()=>approved},location:{hostname:'preview.invalid',reload(){reloads++;}},navigator:{serviceWorker:{controller:{},register:async()=>reg,addEventListener:(k,f)=>handlers[k]=f}},document:{getElementById:k=>nodes.get(k),createElement:elem,body,addEventListener(){}},setInterval(){}});
 const m=new vm.SourceTextModule(swRegister,{context});await m.link(()=>{});await m.evaluate();m.namespace.registerAppSW();handlers.load();await new Promise(r=>setImmediate(r));
 return {handlers,worker,button:()=>body.children[0].children[1],approve(){approved=true;},get reloads(){return reloads;},get posts(){return posts;}};
}
test('each tab requires consent, including another tab activating the worker',async()=>{const a=await tab(),b=await tab();a.approve();a.button().onclick();assert.equal(a.posts,1);a.handlers.controllerchange();b.handlers.controllerchange();assert.equal(a.reloads,1);assert.equal(b.reloads,0);b.worker.state='activated';b.approve();b.button().onclick();assert.equal(b.reloads,1);});
test('cancel update preserves form and sends no activation message',async()=>{const f=await tab();f.button().onclick();f.handlers.controllerchange();assert.equal(f.reloads,0);assert.equal(f.posts,0);});

test('actual document insert includes AI verdict and propagates DB refusal',async()=>{
 const source=await read('app/shared/api.js');const start=source.indexOf('export const carrierUploadDocument'),end=source.indexOf('export const carrierListDocuments',start);let row,error=null;
 const context=vm.createContext({});const dep=new vm.SyntheticModule(['getClient'],function(){this.setExport('getClient',async()=>({from:()=>({insert:async r=>{row=r;return {error};}})}));},{context});await dep.link(()=>{});await dep.evaluate();
 const m=new vm.SourceTextModule(source.slice(start,end),{context,importModuleDynamically:()=>dep});await m.link(()=>{});await m.evaluate();
 const verdict={verdict:'warning',issues:['synthetic']};await m.namespace.carrierUploadDocument({type:'coi',fileName:'test',filePath:'owner/test',aiVerdict:verdict});assert.equal(row.ai_verdict,verdict);
 await m.namespace.carrierUploadDocument({type:'other',fileName:'test',filePath:'owner/test'});assert.equal('ai_verdict' in row,false);
 error={message:'denied'};await assert.rejects(m.namespace.carrierUploadDocument({type:'coi',aiVerdict:verdict}),/denied/);
});
test('all four actual precheck upload paths pass their verdict',async()=>{
 const source=await read('app/carrier/app.js');const hits=[...source.matchAll(/const pv9 = await lbAiPrecheck\(/g)];assert.equal(hits.length,4);
 for(const h of hits){const rest=source.slice(h.index);const args=rest.match(/await carrierUploadDocument\((\{[^}]+\})\)/)[1];assert.match(args,/aiVerdict: pv9/);}
});
test('generated workers wait for explicit activation and delegate share handling',async()=>{
 const app=await read('site/app/sw.js'),publicSW=await read('site/sw.js');
 for(const source of [app,publicSW]){const handlers={};let skipped=0;const c=cacheStorage();const context=vm.createContext({self:{addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>{skipped++;}},caches:c,importScripts(){},URL,location:{origin:'https://preview.invalid'}});vm.runInContext(source,context);let job;handlers.install({waitUntil:p=>job=p});await job;assert.equal(skipped,0);handlers.message({data:{type:'SKIP_WAITING'}});assert.equal(skipped,1);}
 assert.match(app,/lbStoreSharedFile\(r\)/);
});

for (const mode of ['network','denied','malformed']) test('outreach report '+mode+' visibly clears stale totals',async()=>{
 const source=await read('app/command-center/views/outreach.js');
 const start=source.indexOf('  async function loadCompare()'),end=source.indexOf('  function reachNum(',start);
 const state={days:30,audience:['stale']}, reach={}, compare={};
 const context=vm.createContext({S:state,reachHost:reach,cmpHost:compare,ccOutreachAudience:async()=>{if(mode==='network')throw Error('offline');return mode==='denied'?{error:'denied'}:{audiences:{}};},el:(tag,attrs,text)=>({text,attrs}),mount:(host,node)=>host.node=node});
 const run=vm.runInContext(source.slice(start,end)+'\nloadCompare;',context);await run();
 assert.equal(state.audience,null);for(const host of [reach,compare]){assert.equal(host.node.attrs.role,'alert');assert.match(host.node.text,/could not be loaded/);}
});

test('shared upload refuses a different account after asynchronous user lookup',async()=>{
 const source=await read('app/shared/storage.js');const context=vm.createContext({});
 const m=new vm.SourceTextModule(source,{context});
 await m.link(spec=>{const name=spec.includes('session')?'getUser':'getClient';return new vm.SyntheticModule([name],function(){this.setExport(name,name==='getUser'?async()=>({id:'B'}):async()=>({storage:{from:()=>{assert.fail('must not upload');}}}));},{context});});await m.evaluate();
 await assert.rejects(m.namespace.uploadDocument(file(),'other','A'),/account changed/);
});
