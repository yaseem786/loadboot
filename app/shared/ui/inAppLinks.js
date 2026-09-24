// inAppLinks.js — bl_ui_0440 (24 Sep 2026). Keeps the Android app (Play TWA) full-screen.
//
// Inside the installed app, any link that opens a NEW window (target="_blank" or window.open)
// is shown by Chrome as a Custom Tab on top of the app: an "X · loadboot.com · share · ⋮" bar.
// The owner saw exactly that on the agent dashboard. Portals had 118 such links, many pointing at
// our own pages (policies, other portals). Inside the app, our own links now open in the same
// window instead. External sites (wa.me, Stripe, Google) still open in a tab — that is correct.
// Plain script, no module, safe on every page; does nothing in a normal browser tab.
(function () {
  try {
    if (typeof window === 'undefined' || window.__lbInAppLinks) return;
    window.__lbInAppLinks = true;
    var inApp = false;
    try { inApp = sessionStorage.getItem('lb_in_app') === '1'; } catch (e) {}
    if ((document.referrer || '').indexOf('android-app://com.loadboot.app') === 0) inApp = true;
    try {
      if (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) inApp = true;
    } catch (e) {}
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) inApp = true;
    if (!inApp) return;
    try { sessionStorage.setItem('lb_in_app', '1'); } catch (e) {}
    document.documentElement.classList.add('lb-in-app');

    var OURS = /^(www\.)?loadboot\.com$/i;
    var ours = function (u) {
      try {
        var x = new URL(u, location.href);
        if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
        if (x.origin !== location.origin && !OURS.test(x.hostname)) return null;
        return location.origin + x.pathname + x.search + x.hash;   // always the app's own origin (no www hop)
      } catch (e) { return null; }
    };

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[target]') : null;
      if (!a || a.hasAttribute('download')) return;
      var t = (a.getAttribute('target') || '').toLowerCase();
      if (t === '' || t === '_self' || t === '_top' || t === '_parent') return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      var to = ours(href);
      if (!to) return;
      e.preventDefault();
      location.assign(to);
    }, true);

    var nativeOpen = window.open;
    window.open = function (u, t) {
      var to = (u && typeof u === 'string') ? ours(u) : null;
      if (to && (!t || String(t).toLowerCase() === '_blank')) { location.assign(to); return window; }
      return nativeOpen.apply(window, arguments);
    };
  } catch (err) { /* never break a page */ }
})();
