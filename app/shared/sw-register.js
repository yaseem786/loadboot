// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
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
      // bl_pwa_0532b (8 Oct 2026, owner) — SILENT updates, the way a store app behaves. LoadBoot deploys daily, so a bar
      // asking the carrier to tap "Update" every day was the wrong design (and inside the Play Store TWA the tap did not
      // even work: window.confirm + a stale worker). Now: a new worker is activated the moment it is installed, and the
      // page swaps to it with ONE reload only when that cannot interrupt anyone — the app is in the background, or
      // nothing is being typed, no sheet / drawer / dialog is open, no call is live (window.__lbBusy from the dialer),
      // and the last touch was >20 s ago. Otherwise the swap waits: the next time the app is reopened it is already
      // the new version. No prompt, no tap, no loop. (The Play Store listing's own "Update" is the Android shell —
      // a different thing, not touched here.)
      let pending = false; let lastInput = 0; let swapping = false;
      ['keydown', 'touchstart', 'pointerdown'].forEach((ev) => document.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
      const busy = () => {
        try {
          if (typeof window.__lbBusy === 'function' && window.__lbBusy()) return true;
          const a = document.activeElement;
          if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true;
          if (document.querySelector('.cp-modal, .cpx-drawer, .cpx-scrim, [role="dialog"], .lb-sheet')) return true;
          if (Date.now() - lastInput < 20000) return true;
        } catch (_) {}
        return false;
      };
      const activate = (w) => { try { if (w && w.state !== 'activated' && w.state !== 'redundant') w.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {} };
      const swap = () => {
        if (!pending || swapping) return;
        if (document.hidden || !busy()) { swapping = true; try { sessionStorage.setItem('lb:sw:updated', String(Date.now())); } catch (_) {} location.reload(); }
      };
      if (reg.waiting && navigator.serviceWorker.controller) activate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) activate(nw); });
      });
      // check for updates when the app regains focus (mobile: reopened from home screen); swap then if one is waiting
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); swap(); });
      setInterval(swap, 15000);
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }   // very first install: this page already is the new version
        pending = true; swap();
      });
    }).catch(() => {});
  });
}
export default registerAppSW;
