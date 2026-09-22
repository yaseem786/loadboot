import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
const raw = readFileSync(new URL('../supabase/functions/erasure-purge/index.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(raw.replace(/^import .*;\n/gm, ''));
const reply = (value,status=200) => new Response(JSON.stringify(value),{status});
const K1='a'.repeat(32), K2='b'.repeat(32);
const cand = list => ({candidates:list});
const two = [{item_key:K1,bucket:'documents',path:'u1/w9.pdf'},{item_key:K2,bucket:'documents',path:'u1/coi.pdf'}];
async function run(options={}) {
  let handler; const calls=[];
  const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon',...options.env};
  vm.runInNewContext(code, { Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}}, Response, Number, Math, crypto:webcrypto,
    fetch:async(url,init)=>{ calls.push({url,init});
      if(url.endsWith('/cc_erasure_items')) return options.staff ? options.staff() : reply({request_id:7,items:[]});
      if(url.endsWith('/erasure_removal_candidates')) return options.list ? options.list() : reply(cand(two));
      if(url.includes('/storage/')) return options.storage ? options.storage(url) : reply({message:'deleted'});
      if(url.endsWith('/erasure_removal_mark')) return options.mark ? options.mark() : reply({ok:true});
      throw Error('Unexpected external request: '+url); } });
  const method=options.method||'POST';
  const req=new Request('https://synthetic.invalid/function',{method,headers:options.headers||{authorization:'Bearer test-staff','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(options.body===undefined?{request_id:7}:options.body)}:{})});
  const response=await handler(req); return {status:response.status,data:await response.json().catch(()=>null),calls};
}
const dels=r=>r.calls.filter(c=>c.init&&c.init.method==='DELETE');
const marks=r=>r.calls.filter(c=>c.url.endsWith('/erasure_removal_mark')).map(c=>JSON.parse(c.init.body));
test('dry run by default: nothing deleted, would_remove marked',async()=>{const r=await run();assert.equal(r.status,200);assert.equal(r.data.dry_run,true);assert.equal(dels(r).length,0);assert.deepEqual(marks(r).map(m=>m.p_result),['would_remove','would_remove']);});
for(const v of [true,'false',0,null,'no']) test('dry_run stays on unless literal false: '+JSON.stringify(v),async()=>{const r=await run({body:{request_id:7,dry_run:v}});assert.equal(dels(r).length,0);});
test('real run: staff check with caller identity, delete + mark with service identity, exact paths',async()=>{
  const r=await run({body:{request_id:7,dry_run:false}});
  assert.equal(r.calls[0].init.headers.Authorization,'Bearer test-staff');assert.equal(JSON.parse(r.calls[0].init.body).p_request_id,7);
  assert.equal(r.calls[1].init.headers.Authorization,'Bearer test-service');
  assert.deepEqual(dels(r).map(c=>c.url),['https://synthetic.invalid/storage/v1/object/documents/u1/w9.pdf','https://synthetic.invalid/storage/v1/object/documents/u1/coi.pdf']);
  assert.ok(dels(r).every(c=>c.init.headers.Authorization==='Bearer test-service'));assert.deepEqual(marks(r).map(m=>m.p_result),['removed','removed']);assert.ok(marks(r).every(m=>m.p_request_id===7));
});
for(const st of [401,403,404]) test('non-staff '+st+' deletes nothing',async()=>{const r=await run({body:{request_id:7,dry_run:false},staff:()=>reply({code:'42501'},st)});assert.equal(r.status,403);assert.equal(r.calls.length,1);});
test('caller-supplied paths/keys are ignored',async()=>{const r=await run({body:{request_id:7,dry_run:false,path:'x/real.pdf',candidates:[{path:'y'}]},list:()=>reply(cand([]))});assert.equal(dels(r).length,0);assert.equal(r.data.processed,0);});
for(const body of [{},{request_id:0},{request_id:'7'},{request_id:-1},{request_id:1.5}]) test('bad request_id is 400: '+JSON.stringify(body),async()=>{const r=await run({body});assert.equal(r.status,400);assert.equal(r.calls.length,0);});
test('unsafe candidate rows from the DB are dropped',async()=>{
  const bad=[{item_key:K1,bucket:'documents',path:'a/../b.pdf'},{item_key:'nothex',bucket:'documents',path:'a/b.pdf'},{item_key:K1,bucket:'Bad Bucket',path:'a/b.pdf'},{item_key:K1,bucket:'documents',path:'a b.pdf'},{item_key:K1,bucket:'documents',path:''}];
  const r=await run({body:{request_id:7,dry_run:false},list:()=>reply(cand([...bad,two[0]]))});assert.equal(dels(r).length,1);assert.ok(dels(r)[0].url.endsWith('u1/w9.pdf'));
});
test('caps at 25 and honours max',async()=>{const many=Array.from({length:40},(_,i)=>({item_key:(i.toString(16).padStart(32,'0')),bucket:'documents',path:'u/'+i+'.pdf'}));let r=await run({body:{request_id:7,dry_run:false,max:100},list:()=>reply(cand(many))});assert.equal(dels(r).length,25);r=await run({body:{request_id:7,dry_run:false,max:2},list:()=>reply(cand(many))});assert.equal(dels(r).length,2);});
test('a storage failure is marked and does not stop the rest',async()=>{const r=await run({body:{request_id:7,dry_run:false},storage:u=>u.endsWith('w9.pdf')?reply({},500):reply({})});assert.deepEqual(marks(r).map(m=>m.p_result),['storage_failed','removed']);});
test('thrown storage/mark calls never leak details',async()=>{const r=await run({body:{request_id:7,dry_run:false},storage:()=>{throw Error('private');},mark:()=>{throw Error('private');}});assert.equal(r.status,200);assert.ok(!JSON.stringify(r.data).includes('private'));assert.deepEqual(r.data.results.map(x=>x.result),['storage_failed','storage_failed']);});
test('candidate call failure is 503 with nothing deleted',async()=>{const r=await run({body:{request_id:7,dry_run:false},list:()=>reply({},500)});assert.equal(r.status,503);assert.equal(dels(r).length,0);});
test('auth/env/method guards',async()=>{let r=await run({headers:{'content-type':'application/json'}});assert.equal(r.status,401);r=await run({env:{SUPABASE_SERVICE_ROLE_KEY:''}});assert.equal(r.status,503);r=await run({method:'GET'});assert.equal(r.status,405);});
