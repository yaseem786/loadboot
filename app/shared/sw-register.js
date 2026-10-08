// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// sw-register.js — register the app service worker (scope /app/) and keep installed PWAs
// (mobile home-screen app) on the newest deploy.
// The SW is network-first for the app shell and NEVER caches API/document/money/
// location/profile data (those are cross-origin Supabase calls).
//
// 8 Oct 2026 (owner): NO "A new version of LoadBoot is available" banner in any portal. Big-brand apps
// update by themselves; so does LoadBoot now. A newly installed worker is told to take over at once
// (SKIP_WAITING) and the page is NEVER reloaded under the user's hands — nothing they are typing is
// lost. The next navigation or reopen simply runs the new build. The shell is network-first anyway,
// so a fresh load is always the latest deploy even before the worker switches.
export function registerAppSW() {
  if (!('serviceWorker' in navigator)) return;
  // DEV HOSTS: never register the service worker on localhost / LAN IPs — its
  // cache-first precache keeps serving stale builds during development. Also
  // unregister any SW left over from earlier sessions so dev caches self-heal.
  const _h = location.hostname;
  if (_h === 'localhost' || _h === '127.0.0.1' || /^(10|192\.168|172)\./.test(_h)) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  window.addEventListener('load', () => {
    // updateViaCache:'none' — ALWAYS revalidate sw.js against the network when checking
    // for updates, so a new deploy is detected even if the browser cached the old sw.js.
    // Without this, installed PWAs can serve a stale build until the user clears data.
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/', updateViaCache: 'none' }).then((reg) => {
      // Actively look for a newer SW: right now, and every 60s while the app is open,
      // so an installed PWA picks up new deploys without a manual reinstall.
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60000);
      // a worker that finished installing takes over silently — no banner, no question
      const adopt = (worker) => { try { if (worker) worker.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {} };
      if (reg.waiting && navigator.serviceWorker.controller) adopt(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) adopt(nw);
        });
      });
      // check for updates when the app regains focus (mobile: reopened from home screen)
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      // controllerchange: the new worker now serves this tab's requests. Deliberately NO reload here —
      // the user keeps whatever they were doing; the new build appears on their next open.
    }).catch(() => {});
  });
}
export default registerAppSW;
