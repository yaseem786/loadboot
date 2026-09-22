// Run: node --experimental-vm-modules docs/audit-2026-09/tests/f31_client_verdict_test.mjs
// Executes the actual API module with a fake Supabase client. No network, users or documents touched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const source = await readFile(new URL('app/shared/api.js', root), 'utf8');
const inserts = [];
let error = null;
const client = { from(table) {
  assert.equal(table, 'documents');
  return { async insert(row) { inserts.push(JSON.parse(JSON.stringify(row))); return { error }; } };
} };
const context = vm.createContext({});
const dependency = new vm.SyntheticModule(['getClient'], function () {
  this.setExport('getClient', async () => client);
}, { context });
await dependency.link(() => { throw new Error('Unexpected import'); });
await dependency.evaluate();
const resolve = (name) => {
  assert.equal(name, './supabaseClient.js');
  return dependency;
};
const api = new vm.SourceTextModule(source, { context, importModuleDynamically: resolve });
await api.link(resolve);
await api.evaluate();
const upload = api.namespace.carrierUploadDocument;
const metadata = { type: 'insurance', fileName: 'synthetic.pdf', filePath: 'fixture/synthetic.pdf' };

for (const verdict of ['pass', 'warning', 'reject', 'queued']) {
  const aiVerdict = Object.freeze({ verdict, summary: 'Synthetic result', issues: [{ severity: 'warning', problem: 'Synthetic issue' }] });
  const before = JSON.stringify(aiVerdict);
  assert.equal(await upload({ ...metadata, aiVerdict }), true);
  const row = inserts.at(-1);
  assert.deepEqual(row, { type: metadata.type, file_name: metadata.fileName, file_path: metadata.filePath,
    ai_verdict: { ...aiVerdict, overridden: verdict === 'reject' } });
  assert.equal(JSON.stringify(aiVerdict), before, 'Do not mutate the precheck result');
  assert.equal('recorded_by' in row.ai_verdict, false, 'Do not claim trusted provenance');
}
for (const aiVerdict of [undefined, null, false, 'unavailable', []]) {
  assert.equal(await upload({ ...metadata, aiVerdict }), true);
  assert.deepEqual(inserts.at(-1), { type: metadata.type, file_name: metadata.fileName, file_path: metadata.filePath });
}
error = { message: 'Synthetic insert refusal' };
const count = inserts.length;
await assert.rejects(upload({ ...metadata, aiVerdict: { verdict: 'warning' } }), /Synthetic insert refusal/);
assert.equal(inserts.length, count + 1, 'An insert failure must not trigger a second upload');

// Protect against the previous partial overwrite: each precheck path must carry its own result.
const carrier = await readFile(new URL('app/carrier/app.js', root), 'utf8');
const paths = [...carrier.matchAll(/const pv9 = await lbAiPrecheck\([\s\S]*?await carrierUploadDocument\((\{[^}]*\})\)/g)];
assert.equal(paths.length, 4, 'Review every prechecked upload path when adding/removing one');
for (const [path, payload] of paths) {
  assert.match(path, /if \(!\(await lbPrecheckGate\(pv9\)\)\)/, 'Keep the upload-anyway gate');
  assert.match(payload, /aiVerdict:\s*pv9\b/, 'Do not drop the verdict at an upload call site');
}
console.log('PASS F31: verdict payloads, absent AI, errors, immutable inputs and all four gated upload paths; no network.');
