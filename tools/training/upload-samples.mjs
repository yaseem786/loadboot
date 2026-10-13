// bl_train_0548 — put the watermarked sample PDFs where training_seed recorded them.
//
// training_seed files the compliance documents and the completed load's POD in the database; the
// PDFs themselves live in the private `documents` bucket and can only be written by the carrier's
// own session (storage RLS: {uid}/…). This signs in AS THE TRAINING CARRIER (the email + password
// training_seed printed) and uploads:
//   {uid}/training/{authority,coi,w9,mcs150,bank,dispatch-agreement}.pdf
//   {uid}/pod/{trip}/training-pod.pdf          for every invoiced (completed) trip
// Safe to re-run (upsert). Run it again after training_reset (the completed trip id changes).
//
//   node tools/training/upload-samples.mjs --env prod    --email andrew+training@example.com --password '…'
//   LOADBOOT_STAGING_ANON_KEY=… node tools/training/upload-samples.mjs --env staging --email … --password '…'
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const ENVS = {
  prod: { url: 'https://rwscphuhpjoudvljvmdk.supabase.co', key: process.env.LOADBOOT_PROD_ANON_KEY || 'sb_publishable_lHr4JKuHCZEkkjaEh7vx3A_ya_XLG4V' },
  staging: { url: 'https://snslhvmkjusozgjelghi.supabase.co', key: process.env.LOADBOOT_STAGING_ANON_KEY },
};
const env = ENVS[arg('env') || 'staging'];
const email = arg('email'); const password = arg('password');
if (!env || !env.key || !email || !password) {
  console.error('usage: node tools/training/upload-samples.mjs --env prod|staging --email <training login> --password <password>\n(staging needs LOADBOOT_STAGING_ANON_KEY)');
  process.exit(2);
}

async function j(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return { raw: t }; } }

const auth = await fetch(env.url + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { apikey: env.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
}).then(j);
if (!auth.access_token) { console.error('sign-in failed:', auth.error_description || auth.msg || auth.raw || auth); process.exit(1); }
const uid = auth.user.id; const H = { apikey: env.key, Authorization: 'Bearer ' + auth.access_token };

// refuse to run against anything but a training account
const st = await fetch(env.url + '/rest/v1/rpc/cc_session_demo_state', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' }).then(j);
if (!st || !st.training) { console.error('refusing: this login is not a training carrier (cc_session_demo_state.training is not true).'); process.exit(1); }

async function put(objectPath, file) {
  const body = await readFile(path.join(HERE, 'samples', file));
  const r = await fetch(env.url + '/storage/v1/object/documents/' + objectPath, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/pdf', 'x-upsert': 'true', 'cache-control': '3600' }, body,
  });
  console.log((r.ok ? 'ok   ' : 'FAIL ') + objectPath + (r.ok ? '' : '  ' + JSON.stringify(await j(r))));
  return r.ok;
}

let ok = true;
for (const f of ['authority.pdf', 'coi.pdf', 'w9.pdf', 'mcs150.pdf', 'bank.pdf', 'dispatch-agreement.pdf']) ok = (await put(uid + '/training/' + f, f)) && ok;
const trips = await fetch(env.url + '/rest/v1/rpc/cc_pocket_trips', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_limit: 80 }) }).then(j);
for (const t of (Array.isArray(trips) ? trips : []).filter((x) => x.status === 'invoiced')) ok = (await put(uid + '/pod/' + t.id + '/training-pod.pdf', 'training-pod.pdf')) && ok;
console.log(ok ? 'DONE — sample documents are in place for ' + (st.label || email) : 'finished with errors');
process.exit(ok ? 0 : 1);
