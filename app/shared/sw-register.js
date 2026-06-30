// sw-register.js — register the app service worker (scope /app/).
// The SW precaches ONLY the static shell allowlist and is network-only for
// everything else. It NEVER caches API, document, message, money, location,
// profile, or admin data (all of which are cross-origin Supabase calls anyway).
export function registerAppSW() {
  if (!('serviceWorker' in navigator)) return;
  // env-config carries environment identity and must always come from the network,
  // so it is intentionally excluded from the SW precache (see build-generated sw.js).
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
  });
}
export default registerAppSW;
