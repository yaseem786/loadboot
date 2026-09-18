// native.js — LoadBoot native-shell bridge (iOS App Store build; Android-ready).
// Plain script, no module: loaded by every portal index.html BEFORE the install pills.
// Does nothing in a normal browser / PWA / Android TWA (window.Capacitor absent).
//
// Inside the Capacitor shell (tools/ios) it:
//   • tags <html> with lb-native / lb-ios so CSS can adapt (safe-area, hide web-only UI)
//   • hides the native splash once the page has painted
//   • routes off-site and target=_blank links to the system browser (SFSafariViewController)
//   • opens Universal Links / loadboot:// deep links on the right in-app route
//   • navigates to the URL carried by a tapped push notification
//   • adds a light haptic tap to primary buttons
//   • exposes window.__lbNative for push.js (APNs registration lives there)
// It never touches auth, money, documents or tracking logic.
(function () {
  try {
    var C = window.Capacitor;
    if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
    var P = C.Plugins || {};
    var platform = (typeof C.getPlatform === 'function' && C.getPlatform()) || 'ios';
    var html = document.documentElement;
    html.classList.add('lb-native', 'lb-' + platform);

    var ALLOWED_HOSTS = ['loadboot.com', 'www.loadboot.com'];
    function sameApp(u) { try { var x = new URL(u, location.href); return ALLOWED_HOSTS.indexOf(x.hostname) !== -1 && x.pathname.indexOf('/app/') === 0; } catch (_) { return false; } }
    function openExternal(u) { try { if (P.Browser && P.Browser.open) { P.Browser.open({ url: u, presentationStyle: 'popover' }); return; } } catch (_) {} try { window.open(u, '_system'); } catch (_) {} }

    // ---- shell chrome -------------------------------------------------------
    var css = document.createElement('style');
    css.textContent =
      // web-only UI that makes no sense inside the store app
      'html.lb-native [data-lb-web-only],html.lb-native a[href*="/pricing"],html.lb-native a[href*="play.google.com"],html.lb-native a[href*="apps.apple.com"]{display:none !important}' +
      // keep tappable things clear of the home indicator / notch
      'html.lb-native body{padding-bottom:env(safe-area-inset-bottom)}' +
      // no rubber-band "double scroll" chrome, no text-size auto-zoom, no long-press callouts on buttons
      'html.lb-native{-webkit-text-size-adjust:100%;overscroll-behavior-y:none}' +
      'html.lb-native button,html.lb-native .cp-btn{-webkit-touch-callout:none;-webkit-user-select:none}';
    document.head.appendChild(css);
    try { if (P.StatusBar && P.StatusBar.setStyle) P.StatusBar.setStyle({ style: 'DARK' }); } catch (_) {}

    // ---- splash: hide as soon as the app shell has painted -------------------
    function hideSplash() { try { if (P.SplashScreen && P.SplashScreen.hide) P.SplashScreen.hide({ fadeOutDuration: 250 }); } catch (_) {} }
    if (document.readyState === 'complete') setTimeout(hideSplash, 350);
    else window.addEventListener('load', function () { setTimeout(hideSplash, 350); });
    setTimeout(hideSplash, 5000); // never let a JS error strand the splash

    // ---- links: keep the shell on loadboot.com/app, everything else → system browser
    document.addEventListener('click', function (ev) {
      try {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || /^(javascript:|mailto:|tel:|sms:)/i.test(href)) return;
        if (a.hasAttribute('download') || a.target === '_blank' || !sameApp(href)) {
          ev.preventDefault(); ev.stopPropagation();
          openExternal(new URL(href, location.href).href);
        }
      } catch (_) {}
    }, true);
    // window.open(url) from app code (PDF exports, maps) → system browser too
    var _open = window.open;
    window.open = function (u, name, feat) {
      try { if (u && !sameApp(u) && !/^(about:|blob:)/.test(String(u))) { openExternal(new URL(u, location.href).href); return null; } } catch (_) {}
      return _open.apply(window, arguments);
    };

    // ---- deep links (Universal Links + loadboot:// scheme) ------------------
    function routeUrl(raw) {
      try {
        var u = new URL(raw);
        var path = u.pathname + u.search + u.hash;
        if (u.protocol === 'loadboot:') path = '/' + (u.host || '') + u.pathname + u.search + u.hash;  // loadboot://app/carrier/#trips → /app/carrier/#trips
        if (path.indexOf('/app/') !== 0) return;
        if (location.pathname + location.search + location.hash === path) return;
        location.href = path;
      } catch (_) {}
    }
    try { if (P.App && P.App.addListener) P.App.addListener('appUrlOpen', function (d) { if (d && d.url) routeUrl(d.url); }); } catch (_) {}
    try { if (P.App && P.App.getLaunchUrl) P.App.getLaunchUrl().then(function (d) { if (d && d.url) routeUrl(d.url); }).catch(function () {}); } catch (_) {}

    // ---- push: tap-to-open + foreground receipt ----------------------------------
    try {
      if (P.PushNotifications && P.PushNotifications.addListener) {
        P.PushNotifications.addListener('pushNotificationActionPerformed', function (ev) {
          try { var d = (ev && ev.notification && ev.notification.data) || {}; var url = d.url || d.click_url; if (url) { if (sameApp(url)) location.href = new URL(url, location.href).pathname + new URL(url, location.href).hash; else routeUrl(url); } } catch (_) {}
        });
        P.PushNotifications.addListener('pushNotificationReceived', function (n) {
          // App is in the foreground: surface it in-app (same visual as web push) instead of losing it.
          try { window.dispatchEvent(new CustomEvent('lb:push', { detail: n })); } catch (_) {}
        });
      }
    } catch (_) {}

    // ---- haptics on primary actions -----------------------------------------------
    document.addEventListener('click', function (ev) {
      try { var b = ev.target && ev.target.closest ? ev.target.closest('.cp-btn-primary,.btn-primary,button[type=submit]') : null; if (b && P.Haptics && P.Haptics.impact) P.Haptics.impact({ style: 'LIGHT' }); } catch (_) {}
    }, true);

    // ---- bridge for push.js -------------------------------------------------------------
    window.__lbNative = {
      platform: platform,
      version: 1,
      openExternal: openExternal,
      // APNs registration. Resolves with the hex device token, rejects on denied/failed.
      registerPush: function () {
        return new Promise(function (resolve, reject) {
          var PN = P.PushNotifications;
          if (!PN) return reject(new Error('Push plugin unavailable.'));
          var done = false;
          var regL, errL;
          function cleanup() { try { regL && regL.remove && regL.remove(); } catch (_) {} try { errL && errL.remove && errL.remove(); } catch (_) {} }
          Promise.resolve(PN.checkPermissions()).then(function (s) {
            if (s && s.receive === 'granted') return s;
            return PN.requestPermissions();
          }).then(function (s) {
            if (!s || s.receive !== 'granted') throw new Error('Notification permission was not granted.');
            return Promise.all([
              PN.addListener('registration', function (t) { if (done) return; done = true; cleanup(); resolve(t && t.value); }),
              PN.addListener('registrationError', function (e) { if (done) return; done = true; cleanup(); reject(new Error((e && e.error) || 'APNs registration failed.')); })
            ]).then(function (ls) { regL = ls[0]; errL = ls[1]; return PN.register(); });
          }).catch(function (e) { if (!done) { done = true; cleanup(); reject(e); } });
          setTimeout(function () { if (!done) { done = true; cleanup(); reject(new Error('APNs registration timed out.')); } }, 20000);
        });
      },
      unregisterPush: function () { try { return Promise.resolve(P.PushNotifications && P.PushNotifications.unregister && P.PushNotifications.unregister()); } catch (_) { return Promise.resolve(); } }
    };
  } catch (_) {}
})();
