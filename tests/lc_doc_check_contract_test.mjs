import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

const raw = readFileSync(new URL('../supabase/functions/lc-doc-check/index.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(raw.replace(/^import .*;\n/gm, ''));
const body = { visitor_key:'a'.repeat(26), conv_id:null, mime:'application/pdf', data_b64:'c3ludGhldGlj', filename:'synthetic.pdf' };
const reply = (value,status=200) => new Response(JSON.stringify(value),{status});
async function run(options={}) {
  let handler; const calls=[];
  const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon',...options.env};
  vm.runInNewContext(code, { Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}}, Response,Uint8Array,atob,crypto:webcrypto,
    fetch:async(url,init)=>{
      calls.push({url,init});
      if(url.endsWith('/lc_ob_upload_check')) return options.preflight ? options.preflight() : reply({ok:true});
      if(url.includes('/storage/')) return options.storage ? options.storage() : reply({Key:'synthetic'});
      if(url.endsWith('/lc_ob_doc_log')) return options.log ? options.log() : reply({ok:true});
      throw Error('Unexpected external request: '+url);
    }
  });
  const method=options.method||'POST';
  const req=new Request('https://synthetic.invalid/function',{method,headers:options.headers||{authorization:'Bearer test-user','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(options.body===undefined?body:options.body)}:{})});
  const response=await handler(req);
  return {status:response.status, data:response.status===200&&method==='OPTIONS'?null:await response.json(),calls};
}
test('authorized upload scopes preflight to caller and logs with service identity',async()=>{
  const r=await run(); assert.equal(r.status,200);assert.equal(r.data.ok,true);assert.equal(r.data.stored,true);
  assert.equal(r.calls.length,3); assert.equal(r.calls[0].init.headers.Authorization,'Bearer test-user');assert.equal(r.calls[0].init.headers.apikey,'test-anon');
  assert.equal(r.calls[2].init.headers.Authorization,'Bearer test-service');assert.equal(r.calls[1].init.headers['x-upsert'],'false');
});
for(const value of [null,{},[],{error:'not found'},{ok:false},{ok:'true'},{ok:true,error:'denied'}]) test('incomplete/denied preflight never uploads: '+JSON.stringify(value),async()=>{
  const r=await run({preflight:()=>reply(value)});assert.equal(r.status,403);assert.equal(r.calls.length,1);
});
for(const status of [401,403,404,500]) test('failed preflight HTTP '+status+' never uploads',async()=>{
  const r=await run({preflight:()=>reply({ok:true},status)});assert.equal(r.status,status>=500?503:403);assert.equal(r.calls.length,1);
});
test('preflight exception stops upload',async()=>{const r=await run({preflight:()=>{throw Error('private upstream error');}});assert.equal(r.status,500);assert.equal(r.calls.length,1);assert.equal(r.data.detail,undefined);});
test('storage failure stops AI and document logging',async()=>{const r=await run({storage:()=>reply({},500)});assert.equal(r.status,502);assert.equal(r.calls.length,2);assert.equal(r.data.ok,undefined);});
for(const value of [null,{},[],{ok:false},{error:'limit'},{ok:true,error:'bad key'}]) test('unconfirmed metadata save cannot return success: '+JSON.stringify(value),async()=>{
 const r=await run({log:()=>reply(value)});assert.equal(r.status,502);assert.equal(r.data.ok,undefined);
});
test('failed metadata HTTP cannot return success',async()=>{const r=await run({log:()=>reply({ok:true},500)});assert.equal(r.status,502);});
for(const visitor_key of ['short','novkey'+'x'.repeat(20),'x'.repeat(65),'../../'+'x'.repeat(20)]) test('invalid key refused before fetch: '+visitor_key,async()=>{
 const r=await run({body:{...body,visitor_key}});assert.equal(r.status,400);assert.equal(r.calls.length,0);
});
test('missing caller is rejected',async()=>{const r=await run({headers:{}});assert.equal(r.status,401);assert.equal(r.calls.length,0);});
test('missing configuration fails closed',async()=>{const r=await run({env:{SUPABASE_ANON_KEY:''}});assert.equal(r.status,503);assert.equal(r.calls.length,0);});
test('malformed base64 creates no object',async()=>{const r=await run({body:{...body,data_b64:'!!!'}});assert.equal(r.status,400);assert.equal(r.calls.length,1);});
test('GET is refused without requests',async()=>{const r=await run({method:'GET'});assert.equal(r.status,405);assert.equal(r.calls.length,0);});

const client=readFileSync(new URL('../app/shared/ui/lcOnboard.js',import.meta.url),'utf8');
const start=client.indexOf('rd.onload = async function () {',client.indexOf('function stepDocs'));
const end=client.indexOf('\n      };',start);
assert.ok(start>=0&&end>start);
const upload=client.slice(start+'rd.onload = async function () {'.length,end);
async function clientRun(getToken, response={ok:true,stored:true,verdict:{verdict:'queued'}}) {
 let identity='first',sent=0,rendered=0,headers;
 const context={uploadIdentity:'first',rd:{result:'data:application/pdf;base64,c3ludGhldGlj'},H:()=>({ctx:()=>({cfg:{url:'https://synthetic.invalid',anon:'test-anon',getToken:()=>getToken(()=>{identity='second';})},vKey:body.visitor_key,convId:null})}),chatIdentity:()=>identity,
 f:{name:'test.pdf'},mime:'application/pdf',s:{data:{}},doc:{key:'other'},idx:0,drop:{innerHTML:''},err:{style:{}},renderVerdict:()=>{rendered++;},fetch:async(_u,init)=>{sent++;headers=init.headers;return reply(response);}};
 await vm.runInNewContext('(async()=>{'+upload+'})()',context);return {sent,rendered,headers,err:context.err};
}
test('client sends signed-in token',async()=>{const r=await clientRun(async()=> 'user-token');assert.equal(r.headers.Authorization,'Bearer user-token');assert.equal(r.rendered,1);});
test('token failure cannot downgrade upload to anon',async()=>{const r=await clientRun(async()=>{throw Error('token failure');});assert.equal(r.sent,0);assert.equal(r.rendered,0);});
test('conversation switch during token lookup stops upload',async()=>{const r=await clientRun(async change=>{change();return 'user-token';});assert.equal(r.sent,0);});
test('client rejects ambiguous success',async()=>{const r=await clientRun(async()=>null,{verdict:{verdict:'pass'}});assert.equal(r.rendered,0);assert.equal(r.err.style.display,'block');});
