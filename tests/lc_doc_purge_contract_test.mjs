import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
const raw = readFileSync(new URL('../supabase/functions/lc-doc-purge/index.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(raw.replace(/^import .*;\n/gm, ''));
const reply = (value,status=200) => new Response(JSON.stringify(value),{status});
const ACTOR='11111111-1111-4111-8111-111111111111';
const cand = names => ({candidates:names.map(name=>({name})),count:names.length,min_age:'7 days',actor:ACTOR});
const A='lc-onboarding/keyA_0123456789abc/a.png', B='lc-onboarding/keyB_0123456789abc/b.pdf';
async function run(options={}) {
  let handler; const calls=[];
  const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon',...options.env};
  vm.runInNewContext(code, { Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}}, Response, Number, Math, crypto:webcrypto,
    fetch:async(url,init)=>{
      calls.push({url,init});
      if(url.endsWith('/cc_lc_doc_remove_candidates')) return options.list ? options.list() : reply(cand([A,B]));
      if(url.includes('/storage/')) return options.storage ? options.storage(url) : reply({message:'deleted'});
      if(url.endsWith('/lc_doc_recon_log_add')) return options.log ? options.log() : reply({ok:true});
      throw Error('Unexpected external request: '+url);
    }
  });
  const method=options.method||'POST';
  const req=new Request('https://synthetic.invalid/function',{method,headers:options.headers||{authorization:'Bearer test-staff','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(options.body===undefined?{}:options.body)}:{})});
  const response=await handler(req);
  return {status:response.status,data:await response.json().catch(()=>null),calls};
}
const dels=r=>r.calls.filter(c=>c.init&&c.init.method==='DELETE');
const logs=r=>r.calls.filter(c=>c.url.endsWith('/lc_doc_recon_log_add')).map(c=>JSON.parse(c.init.body));
test('default is a dry run: lists, logs would_remove, deletes nothing',async()=>{
  const r=await run();assert.equal(r.status,200);assert.equal(r.data.dry_run,true);assert.equal(dels(r).length,0);
  assert.deepEqual(r.data.results.map(x=>x.result),['would_remove','would_remove']);assert.equal(logs(r).length,2);assert.ok(logs(r).every(l=>l.p_dry_run===true&&l.p_actor===ACTOR&&l.p_action==='remove'));
});
for(const v of [true,'false',0,null,undefined,'no']) test('dry_run stays on unless the literal false is sent: '+JSON.stringify(v),async()=>{const r=await run({body:{dry_run:v}});assert.equal(r.data.dry_run,true);assert.equal(dels(r).length,0);});
test('candidates are fetched with the CALLER identity, deletes and logs use the service identity',async()=>{
  const r=await run({body:{dry_run:false}});assert.equal(r.calls[0].init.headers.Authorization,'Bearer test-staff');assert.equal(r.calls[0].init.headers.apikey,'test-anon');assert.equal(r.calls[0].init.body,'{}');
  assert.equal(dels(r).length,2);assert.ok(dels(r).every(c=>c.init.headers.Authorization==='Bearer test-service'));
  assert.deepEqual(dels(r).map(c=>c.url),[A,B].map(n=>'https://synthetic.invalid/storage/v1/object/documents/'+n));
  assert.deepEqual(logs(r).map(l=>l.p_result),['removed','removed']);assert.ok(logs(r).every(l=>l.p_dry_run===false));
});
test('a path supplied by the caller is ignored',async()=>{const r=await run({body:{dry_run:false,path:'carrier-docs/real.pdf',paths:['x'],name:'y'},list:()=>reply(cand([]))});assert.equal(r.status,200);assert.equal(dels(r).length,0);assert.equal(r.data.processed,0);});
for(const status of [401,403,404]) test('non-staff / refused candidate call '+status+' deletes nothing',async()=>{const r=await run({body:{dry_run:false},list:()=>reply({code:'42501'},status)});assert.equal(r.status,403);assert.equal(r.calls.length,1);});
test('candidate call 500 deletes nothing',async()=>{const r=await run({body:{dry_run:false},list:()=>reply({},500)});assert.equal(r.status,503);assert.equal(r.calls.length,1);});
for(const v of [null,[],{},{candidates:'x',actor:ACTOR},{candidates:[{name:A}]},{candidates:[{name:A}],actor:null}]) test('malformed candidate reply deletes nothing: '+JSON.stringify(v),async()=>{const r=await run({body:{dry_run:false},list:()=>reply(v)});assert.equal(r.status,503);assert.equal(dels(r).length,0);});
test('names outside the lc-onboarding shape are dropped even if the DB listed them',async()=>{
  const bad=['carrier-docs/k/a.png','lc-onboarding/k/../../carrier-docs/a.png','lc-onboarding//a.png','lc-onboarding/k/a b.png','lc-onboarding/k/sub/a.png','/lc-onboarding/k/a.png',''];
  const r=await run({body:{dry_run:false},list:()=>reply(cand([...bad,A]))});assert.equal(dels(r).length,1);assert.ok(dels(r)[0].url.endsWith(A));
});
test('caps at 25 per call and honours a smaller max',async()=>{
  const many=Array.from({length:40},(_,i)=>'lc-onboarding/key_'+String(i).padStart(14,'0')+'/f.png');
  let r=await run({body:{dry_run:false,max:1000},list:()=>reply(cand(many))});assert.equal(dels(r).length,25);assert.equal(r.data.eligible,40);
  r=await run({body:{dry_run:false,max:3},list:()=>reply(cand(many))});assert.equal(dels(r).length,3);
  r=await run({body:{dry_run:false,max:-5},list:()=>reply(cand(many))});assert.equal(dels(r).length,1);
});
test('a storage failure is logged and does not stop the rest',async()=>{
  const r=await run({body:{dry_run:false},storage:url=>url.endsWith(A)?reply({},500):reply({})});
  assert.deepEqual(r.data.results.map(x=>x.result),['storage_failed','removed']);assert.deepEqual(logs(r).map(l=>l.p_result),['storage_failed','removed']);
});
test('a thrown storage call is storage_failed, a thrown log call does not hide the result',async()=>{
  const r=await run({body:{dry_run:false},storage:()=>{throw Error('private');},log:()=>{throw Error('private');}});
  assert.equal(r.status,200);assert.deepEqual(r.data.results.map(x=>x.result),['storage_failed','storage_failed']);assert.ok(!JSON.stringify(r.data).includes('private'));
});
test('missing or malformed Authorization is refused before any call',async()=>{for(const h of [{},{authorization:'Basic x'},{authorization:'Bearer'}]){const r=await run({headers:{...h,'content-type':'application/json'}});assert.equal(r.status,401);assert.equal(r.calls.length,0);}});
test('missing env is 503, GET is 405',async()=>{let r=await run({env:{SUPABASE_SERVICE_ROLE_KEY:''}});assert.equal(r.status,503);assert.equal(r.calls.length,0);r=await run({method:'GET'});assert.equal(r.status,405);});
for(const body of [[],'x',5]) test('non-object body is 400: '+JSON.stringify(body),async()=>{const r=await run({body});assert.equal(r.status,400);assert.equal(r.calls.length,0);});
