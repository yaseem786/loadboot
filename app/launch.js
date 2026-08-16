// launch.js — portal chooser behaviour (external file: /app/* CSP blocks inline scripts).
// Real-app feel: remember the last portal used and jump straight to it on launch,
// like WhatsApp opening your chats. Add ?choose=1 to pick a different portal.
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('choose')) { localStorage.removeItem('lb_last_portal'); return; }
    var p = localStorage.getItem('lb_last_portal');
    var OK = ['/app/carrier/', '/app/partner/', '/app/agent/', '/app/developer/', '/app/command-center/'];
    if (p && OK.indexOf(p) !== -1) location.replace(p);
  } catch (_) {}
})();
