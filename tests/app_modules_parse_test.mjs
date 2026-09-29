// Every browser module under app/ must parse as an ES module. On 28 Sep 2026 a mid-line "//" comment in
// app/partner/app.js swallowed a closing brace and the whole Partner portal shipped blank ("Unexpected token
// 'catch'") — `node --check` on a .js file did not catch it, a module parse does.
//   node --experimental-vm-modules --test tests/app_modules_parse_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../app/', import.meta.url);
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) out.push(...await walk(u)); else if (e.name.endsWith('.js')) out.push(u);
  }
  return out;
}

test('every app/**/*.js parses as an ES module', async () => {
  const bad = [];
  for (const u of await walk(root)) {
    const src = await readFile(u, 'utf8');
    if (!/^\s*(import|export)\s/m.test(src)) continue;   // classic <script> files are not modules
    try { new vm.SourceTextModule(src, { identifier: u.pathname }); } catch (e) { bad.push(u.pathname.replace(/^.*\/app\//, 'app/') + ': ' + e.message); }
  }
  assert.deepEqual(bad, []);
});
