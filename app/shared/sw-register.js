// sw-register.js — register the app service worker (scope /app/) and surface an
// instant "update available" prompt so installed PWAs (mobile home-screen app)
// pick up new deploys immediately instead of only on a cold reopen.
// The SW is network-first for the app shell and NEVER caches API/document/money/
// location/profile data (those are cross-origin Supabase calls).
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
      function promptReload(worker) {
        if (!worker || document.getElementById('lb-sw-update')) return;
        const bar = document.createElement('div');
        bar.id = 'lb-sw-update';
        bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:99999;background:#0883F7;color:#fff;padding:12px 16px;border-radius:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;font:600 14px system-ui,sans-serif;box-shadow:0 12px 30px -8px rgba(8,131,247,.6)';
        const msg = document.createElement('span');
        msg.textContent = 'A new version of LoadBoot is available.';
        const btn = document.createElement('button');
        btn.textContent = 'Update';
        btn.style.cssText = 'background:#fff;color:#0883F7;border:none;border-radius:9px;padding:8px 16px;font-weight:800;cursor:pointer;flex:none';
        btn.onclick = () => { btn.textContent = 'Updating...'; worker.postMessage({ type: 'SKIP_WAITING' }); };
        bar.appendChild(msg); bar.appendChild(btn);
        document.body.appendChild(bar);
      }
      if (reg.waiting && navigator.serviceWorker.controller) promptReload(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) promptReload(nw);
        });
      });
      // check for updates when the app regains focus (mobile: reopened from home screen)
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true; location.reload();
      });
    }).catch(() => {});
  });
}
export default registerAppSW;
