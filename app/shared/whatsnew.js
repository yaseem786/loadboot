// whatsnew.js — "What's new" card after an app update (big-brand app-store hygiene).
// Shows ONCE per build id: first-ever visitors just get the build stored silently
// (no card — nothing is "new" to them), returning users see a small dismissible
// card the first time they open the app on a new build.
export function showWhatsNew(items) {
  try {
    const build = (window.__LB_ENV && window.__LB_ENV.buildId) || null;
    if (!build || !Array.isArray(items) || !items.length) return;
    // bl_drv_0344f (14 Sep 2026): never for drivers (the items are owner features), never on preview/local builds
    // (their build id changes on every rebuild, so the card nagged on each one), and at most ONCE per device —
    // bump WN_V deliberately for a release worth announcing, instead of every build.
    if (window.__lbDriver) return;
    if (window.__LB_ENV && window.__LB_ENV.environment && window.__LB_ENV.environment !== 'production') return;
    const WN_V = 'v1', KEY = 'lb_seen_build', SEEN = 'lb_seen_whatsnew_' + WN_V;
    if (localStorage.getItem(SEEN)) return;
    const prev = localStorage.getItem(KEY);
    localStorage.setItem(KEY, build);
    if (!prev) { localStorage.setItem(SEEN, '1'); return; } // first-ever run: nothing is "new" to them
    localStorage.setItem(SEEN, '1');
    const card = document.createElement('div');
    card.id = 'lb-whatsnew';
    card.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(74px + env(safe-area-inset-bottom));z-index:9998;background:#10223B;color:#eaf1fb;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:14px 16px;box-shadow:0 18px 44px -12px rgba(0,0,0,.65);font:500 13px/1.5 system-ui,sans-serif;max-width:480px;margin:0 auto';
    const list = items.slice(0, 4).map((t) => '<div style="display:flex;gap:8px;margin-top:6px"><span style="color:#0883F7;font-weight:800">•</span><span>' + String(t).replace(/</g, '&lt;') + '</span></div>').join('');
    card.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><b style="font-size:14px">✨ What’s new in LoadBoot</b><button id="lb-wn-x" style="margin-left:auto;background:none;border:0;color:#8ea2c3;font-size:18px;cursor:pointer;line-height:1;padding:2px 4px">×</button></div>' + list;
    document.body.appendChild(card);
    const close = () => card.remove();
    card.querySelector('#lb-wn-x').onclick = close;
    setTimeout(close, 20000);
  } catch (_) {}
}
export default showWhatsNew;
