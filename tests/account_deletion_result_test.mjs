import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('app/shared/api.js','utf8');
async function api(response){
 const context=vm.createContext({});const calls=[];
 const mod=new vm.SourceTextModule(source,{context});
 await mod.link(async()=>new vm.SyntheticModule(['getClient'],function(){this.setExport('getClient',async()=>({rpc:async(name,args)=>{calls.push({name,args});return response;}}));},{context}));
 await mod.evaluate();return {call:mod.namespace.ccAccountDeletionProcess,calls};
}
test('structured review refusal rejects, preserving useful code and message',async()=>{
 const x=await api({data:{ok:false,code:'ERASURE_REVIEW_REQUIRED',error:'File review is required.'}});
 await assert.rejects(x.call(12,'complete'),e=>e.code==='ERASURE_REVIEW_REQUIRED'&&e.message==='File review is required.');
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].args.p_id,12);assert.equal(x.calls[0].args.p_note,null);
});
for(const data of [null,{},false,{ok:true,error:'review needed'},{ok:true},{ok:true,status:'requested'}])test('incomplete or contradictory response cannot be a success',async()=>{const x=await api({data});await assert.rejects(x.call(12,'complete'));});
for(const status of ['completed','rejected'])test(`confirmed ${status} still returns its result`,async()=>{const data={ok:true,status};const x=await api({data});assert.equal(await x.call(12,status==='completed'?'complete':'reject','note'),data);});
test('transport/database failure remains an error',async()=>{const x=await api({error:{message:'not authorized',code:'42501'}});await assert.rejects(x.call(12,'complete'),e=>e.code==='42501');});
