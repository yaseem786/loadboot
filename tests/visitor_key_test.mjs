import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync('app/shared/ui/visitor-key.js','utf8');
function setup({old,fail,crypto=webcrypto}={}) {
  const data=new Map([['lb_lc_conv','old-conversation']]);
  if(old!==undefined)data.set('lb_lc_key',old);
  const storage={getItem(k){if(fail==='read')throw Error();return data.get(k)??null;},setItem(k,v){if(fail==='write')throw Error();data.set(k,v);},removeItem(k){if(fail==='remove')throw Error();data.delete(k);}};
  const window={crypto};Object.defineProperty(window,'localStorage',{get(){if(fail==='getter')throw Error();return storage;}});
  const context=vm.createContext({window,Uint8Array});vm.runInContext(source,context);
  return {window,context,data,get:()=>window.LBVisitorIdentity.getKey()};
}
test('new identity uses 24 cryptographic bytes, persists and remains stable',()=>{
  let bytes;const s=setup({crypto:{getRandomValues(b){bytes=b.length;return webcrypto.getRandomValues(b);}}});
  const key=s.get();assert.equal(bytes,24);assert.match(key,/^v[0-9a-f]{48}$/);assert.equal(s.get(),key);assert.equal(s.data.get('lb_lc_key'),key);assert.equal(s.data.has('lb_lc_conv'),false);
});
test('independent pages receive different random identities',()=>assert.notEqual(setup().get(),setup().get()));
for(const n of [16,26,64])test(`legacy ${n}-character identity preserves history`,()=>{const old='a'.repeat(n),s=setup({old});assert.equal(s.get(),old);assert.equal(s.data.get('lb_lc_conv'),'old-conversation');});
for(const old of ['short','x'.repeat(65),'novkeyabcdefgh123456'])test(`invalid identity ${old.length}/${old.slice(0,6)} rotates`,()=>{const s=setup({old});assert.notEqual(s.get(),old);assert.equal(s.data.has('lb_lc_conv'),false);});
for(const fail of ['getter','read','write','remove'])test(`storage ${fail} failure retains secure identity in memory`,()=>{const s=setup({fail});const key=s.get();assert.match(key,/^v[0-9a-f]{48}$/);assert.equal(s.get(),key);});
for(const crypto of [null,{}, {getRandomValues(){throw Error('entropy unavailable');}}])test('missing/failing secure randomness cannot create an identity',()=>{const s=setup({crypto});assert.throws(s.get);assert.equal(s.data.has('lb_lc_key'),false);});
test('duplicate provider script does not reset identity',()=>{const s=setup();const key=s.get();vm.runInContext(source,s.context);assert.equal(s.get(),key);});
test('portal loads shared provider before core',()=>{const text=readFileSync('app/shared/ui/chatWidget.js','utf8');assert.ok(text.indexOf("import './visitor-key.js'")<text.indexOf("import './liveChatCore.js'"));});
// Execute the actual generated callback script with a fake transport. No provider calls.
function callback({identity}={}) {
 const html=readFileSync('site/contact.html','utf8');
 const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function vkey()'))?.[1];assert.ok(script);
 const nodes={};for(const id of ['cwGate','cwMain','cwWhenSel','cwWhenWrap','cwBtn','cwMsg','cwName','cwPhone','cwTopic'])nodes[id]={value:'',style:{},addEventListener(event,fn){this[event]=fn;}};
 nodes.cwName.value='Synthetic';nodes.cwPhone.value='5555555555';nodes.cwWhenSel.value='now';
 const requests=[];const document={querySelectorAll:()=>[],querySelector:()=>({value:'carrier'}),getElementById:id=>nodes[id]};
 vm.runInNewContext(script,{window:{LBVisitorIdentity:identity},document,fetch:(url,args)=>{requests.push(JSON.parse(args.body));return Promise.resolve({json:async()=>({error:'synthetic-stop'})});}});
 nodes.cwBtn.click();return {requests,nodes,html};
}
test('built callback uses same shared identity and provider loads before core',()=>{const s=setup({fail:'getter'}),result=callback({identity:s.window.LBVisitorIdentity});assert.equal(result.requests[0].p_visitor_key,s.get());assert.ok(result.html.indexOf('/app/shared/ui/visitor-key.js?')<result.html.indexOf('/app/shared/ui/liveChatCore.js?'));});
test('callback missing provider shows error and sends nothing',()=>{const r=callback();assert.equal(r.requests.length,0);assert.match(r.nodes.cwMsg.textContent,/securely/);assert.notEqual(r.nodes.cwBtn.disabled,true);});
test('callback failed randomness shows error and sends nothing',()=>{const s=setup({crypto:null}),r=callback({identity:s.window.LBVisitorIdentity});assert.equal(r.requests.length,0);assert.match(r.nodes.cwMsg.textContent,/securely/);});
test('chat core stops before network/setup when secure identity fails',()=>{
  const alerts=[];let requests=0;
  const window={LBVisitorIdentity:{getKey(){throw Error('no secure randomness');}}};
  const document={getElementById:()=>null,createElement:()=>({setAttribute(k,v){this[k]=v;}}),body:{appendChild(n){alerts.push(n);}}};
  vm.runInNewContext(readFileSync('app/shared/ui/liveChatCore.js','utf8'),{window,document,fetch(){requests++;throw Error('unexpected network');}});
  window.LBChat.mount({url:'https://example.invalid',anon:'synthetic'});
  assert.equal(requests,0);assert.equal(alerts.length,1);assert.equal(alerts[0].role,'alert');assert.match(alerts[0].textContent,/securely/);
});
