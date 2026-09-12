import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const queueSource = await readFile(new URL('../app/shared/ui/onboarding-save-queue.js', import.meta.url), 'utf8');
const { createOnboardingSaveQueue: create } = await import('data:text/javascript;base64,' + Buffer.from(queueSource).toString('base64'));
const ok = { ok: true };
const base = { getIdentity: () => 'chat-A' };

test('saves preserve order and snapshot each patch', async () => {
  const seen = [], states = [];
  const q = create({ ...base, send: async p => { seen.push(p.n); return ok; }, onStatus: s => states.push(s) });
  const p = { n: 1 }; const a = q.enqueue(p); p.n = 9;
  await Promise.all([a, q.enqueue({n: 2}), q.enqueue({n: 3})]);
  assert.deepEqual(seen, [1,2,3]); assert.equal(states.at(-1), 'saved');
});
test('explicit quota refusal waits before retrying', async () => {
  let calls = 0; const waits = [];
  const q = create({ ...base, send: async () => ++calls === 1 ? {error:'rate_limit',retry_after:2} : ok, wait: async ms => waits.push(ms) });
  await q.enqueue({}); assert.equal(calls,2); assert.deepEqual(waits,[2000]);
});
test('retries are bounded to three attempts', async () => {
  let calls=0;
  const q = create({...base,send:async()=>{calls++;return {error:'rate_limit',retry_after:1};},wait:async()=>{}});
  await assert.rejects(q.enqueue({})); assert.equal(calls,3); assert.equal(q.isHealthy(),false);
});
test('network failure is never retried and later success cannot erase warning', async () => {
  let calls=0; const states=[];
  const q=create({...base,send:async()=>{if(++calls===1)throw Error('network');return ok;},onStatus:s=>states.push(s)});
  await assert.rejects(q.enqueue({})); await q.enqueue({});
  assert.equal(calls,2); assert.equal(q.isHealthy(),false); assert.equal(states.at(-1),'error');
});
test('empty, malformed and denied results cannot count as saved', async () => {
  for (const value of [null,{}, {ok:false}, {ok:true,error:'denied'}]) {
    const q=create({...base,send:async()=>value}); await assert.rejects(q.enqueue({}));
  }
});
test('untrusted retry delays are refused', async () => {
  for(const delay of [0,61,'bad',null]){
    const q=create({...base,send:async()=>({error:'rate_limit',retry_after:delay}),wait:async()=>assert.fail('must not wait')});
    await assert.rejects(q.enqueue({}));
  }
});
test('conversation switch cancels queued and delayed work', async () => {
  let identity='A',calls=0;
  const q=create({getIdentity:()=>identity,send:async()=>{calls++;return {error:'rate_limit',retry_after:1};},wait:async()=>{identity='B';}});
  await assert.rejects(q.enqueue({})); assert.equal(calls,1);
  const p=q.enqueue({}); identity='C'; await assert.rejects(p); assert.equal(calls,1);
});
test('conversation change while request is in flight does not report success', async () => {
  let identity='A';const states=[];
  const q=create({getIdentity:()=>identity,send:async()=>{identity='B';return ok;},onStatus:s=>states.push(s)});
  await assert.rejects(q.enqueue({}));assert.equal(states.includes('saved'),false);
});
test('pending work is bounded and overflow remains visible', async () => {
  const q=create({...base,send:async()=>ok});
  const pending=Array.from({length:40},()=>q.enqueue({}));
  await assert.rejects(q.enqueue({}));await Promise.all(pending);assert.equal(q.isHealthy(),false);
});
test('status rendering failures do not interrupt saving', async () => {
  const q=create({...base,send:async()=>ok,onStatus:()=>{throw Error('render');}});await q.enqueue({});
});

const uiSource = await readFile(new URL('../app/shared/ui/lcOnboard.js',import.meta.url),'utf8');
async function fixture({getToken,fetchImpl}={}) {
  const nodes=[],requests=[];
  function node(){return {isConnected:true,style:{},children:[],setAttribute(){},appendChild(n){this.children.push(n);},querySelector(selector){for(const child of this.children){if('.'+child.className===selector)return child;const found=child.querySelector(selector);if(found)return found;}return null;}};}
  const ctx={vKey:'visitor-abcdefghijklmnop',convId:'chat-A',cfg:{url:'https://staging.invalid',anon:'public-key',getToken}};
  const sandbox={URL,location:{href:'https://site.invalid/contact.html'},window:{LBChat:{_ob:{ctx:()=>ctx,insertNode:n=>nodes.push(n)}}},document:{currentScript:{src:'https://site.invalid/app/shared/ui/lcOnboard.js'},createElement:node,head:{appendChild(){}},querySelectorAll:()=>[]},fetch:async (url,args)=>{requests.push({url,args});return fetchImpl ? fetchImpl(url,args) : {ok:true,json:async()=>ok};},setTimeout,clearTimeout};
  const context=vm.createContext(sandbox);
  let queueModule;
  const script=new vm.Script(uiSource.replace(/\}\)\(\);\s*$/, 'window.testHooks = {rpc, stepDone};})();'), {
    importModuleDynamically:async spec=>{
      assert.equal(spec,'https://site.invalid/app/shared/ui/onboarding-save-queue.js');
      if(!queueModule){queueModule=new vm.SourceTextModule(queueSource,{context});await queueModule.link(()=>{});await queueModule.evaluate();}
      return queueModule;
    }
  });
  script.runInContext(context);
  return {ctx,nodes,requests,...sandbox.window.testHooks};
}
test('actual UI sends session bearer and renders confirmed save status',async()=>{
  const f=await fixture({getToken:async()=>'session-token'});
  assert.equal((await f.rpc('lc_ob_save',{})).ok,true);
  assert.equal(f.requests[0].args.headers.Authorization,'Bearer session-token');
  assert.equal(f.nodes.at(-1).textContent,'Progress saved.');
});
test('actual UI rejects HTTP failure instead of announcing success',async()=>{
  const f=await fixture({fetchImpl:async()=>({ok:false,json:async()=>ok})});
  assert.equal((await f.rpc('lc_ob_save',{})).error,'save_failed');
  assert.match(f.nodes.at(-1).textContent,/could not be saved/);
});
test('actual UI rechecks chat after asynchronous token lookup',async()=>{
  let f; f=await fixture({getToken:async()=>{f.ctx.convId='chat-B';return 'session-token';}});
  assert.equal((await f.rpc('lc_ob_save',{})).error,'save_failed');assert.equal(f.requests.length,0);
});
test('actual UI does not downgrade a failed token lookup to anonymous',async()=>{
  const f=await fixture({getToken:async()=>{throw Error('session unavailable');}});
  assert.equal((await f.rpc('lc_ob_save',{})).error,'save_failed');assert.equal(f.requests.length,0);
});

for (const [success, expected] of [[true, 'Progress saved ✓'], [false, 'Save needs attention']]) {
  test('actual completion card waits for save result: ' + expected, async () => {
    const f = await fixture({fetchImpl:async()=>({ok:true,json:async()=>success ? ok : {error:'denied'}})});
    f.stepDone();
    const card = f.nodes.find(n=>n.className==='lbo-card');
    assert.equal(card.querySelector('.lbo-prog-t').innerHTML,'Saving final step…');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(card.querySelector('.lbo-prog-t').textContent,expected);
  });
}
