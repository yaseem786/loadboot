// scrollLock.js — bl_ui_0413 (23 Sep 2026, owner): ONE page lock for every sheet / drawer / modal in the portals.
// iOS scrolls the PAGE behind a fixed overlay once the overlay's own scroll reaches its end (scroll chaining) and
// rubber-bands the whole thing — the "drawer shakes / page underneath scrolls" report. Standard fix: while any
// overlay is open the body is position:fixed at its current scroll offset, restored on close.
//   lockPage(el)   — lock; when `el` (the overlay, a direct child of <body>) is given, the lock is released
//                    AUTOMATICALLY the moment it leaves the DOM, whatever close path removed it.
//   unlockPage(el) — explicit release (optional when `el` was given).
// Ref-counted: nested dialogs (a confirm inside a form) release the page only when the last one closes.
const CSS = 'body.lb-page-locked{position:fixed!important;left:0;right:0;width:100%;overflow:hidden;overscroll-behavior:none}';
const holders = new Set(); let scrollY0 = 0; let mo = null;

function ensureCss() { if (document.getElementById('lb-lock-css')) return; const s = document.createElement('style'); s.id = 'lb-lock-css'; s.textContent = CSS; document.head.appendChild(s); }
function apply() {
  if (document.body.classList.contains('lb-page-locked')) return;
  ensureCss();
  scrollY0 = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = (-scrollY0) + 'px';
  document.body.classList.add('lb-page-locked');
}
function release() {
  if (!document.body.classList.contains('lb-page-locked')) return;
  document.body.classList.remove('lb-page-locked');
  document.body.style.top = '';
  try { window.scrollTo(0, scrollY0); } catch (_) {}
}
function prune() {
  holders.forEach((h) => { if (h && h.nodeType === 1 && !h.isConnected) holders.delete(h); });
  if (!holders.size) { release(); if (mo) { try { mo.disconnect(); } catch (_) {} mo = null; } }
}
// Observe only while something is locked (subtree, so an overlay mounted inside a view root is caught too when the
// view re-renders and clears it) — the page can never stay frozen behind an overlay that silently disappeared.
function observe() {
  if (mo) return;
  try { mo = new MutationObserver(() => { if (holders.size) prune(); }); mo.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
}
// The overlay's own scroll areas must not chain into the page either.
function contain(el) {
  try {
    el.style.overscrollBehavior = 'contain';
    el.querySelectorAll('*').forEach((n) => { const o = getComputedStyle(n).overflowY; if (o === 'auto' || o === 'scroll') { n.style.overscrollBehavior = 'contain'; n.style.webkitOverflowScrolling = 'touch'; } });
  } catch (_) {}
}
export function lockPage(el) {
  holders.add(el || Symbol('lock'));
  apply();
  if (el && el.nodeType === 1) { observe(); contain(el); setTimeout(() => { if (el.isConnected) contain(el); }, 60); }
  return el;
}
export function unlockPage(el) {
  if (el) holders.delete(el); else { const it = holders.values().next(); if (!it.done) holders.delete(it.value); }
  prune();
}
try { window.lbLockPage = lockPage; window.lbUnlockPage = unlockPage; } catch (_) {}
