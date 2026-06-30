// env.js — read + validate the build-injected environment.
// The build (build_site.py) writes /app/env-config.js which sets window.__LB_ENV
// with the project URL, anon (publishable) key, project id, and environment name.
// NO service-role key is ever present in the browser. This module fails loudly if
// the env is missing or internally inconsistent (url must match the project id).

const RAW = (typeof window !== 'undefined' && window.__LB_ENV) || null;

function fail(msg) {
  // Surface a hard, visible error rather than silently running mis-configured.
  const e = new Error('[LoadBoot env] ' + msg);
  e.lbFatal = true;
  throw e;
}

if (!RAW) fail('env-config.js did not load (window.__LB_ENV missing).');
for (const k of ['environment', 'supabaseUrl', 'supabaseAnonKey', 'projectId']) {
  if (!RAW[k] || typeof RAW[k] !== 'string') fail('missing env field: ' + k);
}
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(RAW.supabaseUrl)) {
  fail('supabaseUrl is not a valid Supabase https URL.');
}
// Consistency: the URL host must contain the declared project id. This is the
// runtime half of the build-time project-id assertion (prod build => prod ref only,
// preview build => staging ref only). A mismatch means a mis-wired deployment.
if (RAW.supabaseUrl.indexOf('https://' + RAW.projectId + '.supabase.co') !== 0) {
  fail('supabaseUrl does not match projectId — refusing to run mis-wired env.');
}
// The anon/publishable key must NOT look like a service-role JWT (defense in depth).
if (/service_role/.test(RAW.supabaseAnonKey)) {
  fail('a service_role key was injected into the browser — refusing to run.');
}

export const ENV = Object.freeze({
  environment: RAW.environment,                 // 'production' | 'preview'
  isProduction: RAW.environment === 'production',
  supabaseUrl: RAW.supabaseUrl,
  supabaseAnonKey: RAW.supabaseAnonKey,
  projectId: RAW.projectId,
  buildId: RAW.buildId || 'dev',
});

export default ENV;
