// supabaseClient.js — single shared Supabase client (auth + RPC only).
// Loaded from a PINNED CDN build of supabase-js. The anon/publishable key is the
// only credential in the browser; all privileged logic is server-side (RLS + RPC).
import ENV from './env.js';

// Pinned, integrity-scoped dependency. Bump deliberately (never float to @latest).
const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.45.4';

let _clientPromise = null;

export function getClient() {
  if (!_clientPromise) {
    _clientPromise = import(/* @vite-ignore */ SUPABASE_JS).then(({ createClient }) =>
      createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Namespace storage per environment so a preview session can never be
          // confused with a production session in the same browser.
          storageKey: 'lb-auth-' + ENV.environment + '-' + ENV.projectId,
        },
        global: { headers: { 'x-lb-app': 'command-center/' + ENV.buildId } },
      })
    );
  }
  return _clientPromise;
}

export default getClient;
