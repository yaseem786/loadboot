// backnav.js — big-brand Android back behaviour for the portals (Uber/Amazon pattern).
//
// Three rules:
//  1. An open layer (modal / sheet / signup mode) is closed by the system back
//     gesture instead of navigating the whole page away.
//  2. From any non-home tab, back first returns to the home tab (YouTube pattern),
//     and only exits the app from home.
//  3. Manual closes (✕ / backdrop / Esc / after-save) unwind their history entry
//     so the stack never drifts.
//
// IMPLEMENTATION NOTE — why entries are tagged with history.state:
// Chrome fires `popstate` not only for real back/forward but ALSO for forward
// hash navigations (location.hash = …). The ONLY reliable way to know what kind
// of movement happened is to tag our own entries and inspect history.state of
// the entry we LANDED on:
//   {lb:'root'}  the entry under the app — landing here means the user pressed
//                back from a tab → go home first, exit only from home
//   {lb:'layer'} an entry created for an open modal/sheet
//   (anything else / null = normal hash routing — leave it to the router;
//    note the portals' own go()/bgo() replaceState(null,…) wipes tags on the
//    top entry, which is fine: decisions are made on the entry we land on.)

const stack = [];       // closeFns for currently-open layers (LIFO)
let suppress = 0;       // ignore popstates we caused ourselves (popLayer / exit)
let goHome = null;      // () => true if it navigated to the home tab
let inited = false;

function onPop() {
  if (suppress > 0) { suppress--; return; }
  // Layers are always the top-most entries: any un-suppressed pop while a layer
  // is open means the back gesture closed it.
  if (stack.length) {
    const closeFn = stack.pop();
    try { closeFn(); } catch (_) {}
    return;
  }
  const landed = history.state;
  if (landed && landed.lb === 'root') {
    // Back from a tab landed on the root marker: home-first, exit-from-home.
    let wentHome = false;
    try { wentHome = !!(goHome && goHome()); } catch (_) {}
    if (wentHome) {
      // goHome()'s replaceState wiped the root tag — restore it, then re-arm
      // the app entry above it so the NEXT back lands here again.
      try {
        history.replaceState({ lb: 'root' }, '', location.href);
        history.pushState({ lb: 'nav' }, '', location.href);
      } catch (_) {}
      return;
    }
    // Already home — really leave (step past the root entry too).
    try { suppress++; history.back(); } catch (_) {}
    return;
  }
  // Anything else (forward hash push, back across plain hash entries):
  // normal routing — the portals' hashchange listeners handle it.
}
window.addEventListener('popstate', onPop);

export function initBackNav(opts) {
  goHome = (opts && opts.goHome) || null;
  // 2026-08 audit fix: a re-init used to drop tracked layers while their history
  // entries survived, making the next N back presses dead. Unwind them instead.
  const orphans = stack.length;
  stack.length = 0;     // a fresh shell invalidates any stale logged-out layers
  if (inited) {
    if (orphans > 0) { try { suppress += orphans; history.go(-orphans); } catch (_) {} }
    return;
  }
  inited = true;
  try {
    history.replaceState({ lb: 'root' }, '', location.href);   // entry under the app
    history.pushState({ lb: 'nav' }, '', location.href);       // the app lives here
  } catch (_) {}
}

export function pushLayer(closeFn) {
  stack.push(closeFn);
  try { history.pushState({ lb: 'layer' }, '', location.href); } catch (_) {}
}

export function popLayer(closeFn) {
  const i = stack.lastIndexOf(closeFn);
  if (i < 0) return;
  const wasTop = i === stack.length - 1;
  stack.splice(i, 1);
  // 2026-08 audit fix: only pop history when the closed layer was the TOP one.
  // Popping for a non-top layer consumed the top layer's entry and desynced the
  // stack. Leaving the extra entry is safe: onPop closes layers stack-first, and
  // once the stack is empty a leftover entry is a harmless no-op back press.
  if (wasTop) { try { suppress++; history.back(); } catch (_) {} }
}
