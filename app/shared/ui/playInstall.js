// playInstall.js — Android users browsing a portal in a normal Chrome tab get a one-time,
// dismissible "Get the app on Google Play" pill. Never shown inside the installed app
// (standalone / TWA referrer), never on iOS, once per 14 days. Plain script, additive,
// safe on every portal. Counterpart of iosInstall.js.
(function () {
  try {
    if (typeof window === 'undefined') return;
    var ua = navigator.userAgent || '';
    if (!/Android/i.test(ua)) return;
    var standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || (document.referrer || '').indexOf('android-app://com.loadboot.app') === 0;
    if (standalone) return;
    var KEY = 'lb_play_install_hint';
    var last = 0; try { last = parseInt(localStorage.getItem(KEY) || '0', 10); } catch (e) {}
    if (Date.now() - last < 14 * 864e5) return;
    var URL = 'https://play.google.com/store/apps/details?id=com.loadboot.app';
    setTimeout(function () {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      var w = document.createElement('div');
      w.setAttribute('role', 'dialog');
      w.setAttribute('aria-label', 'Get the LoadBoot app on Google Play');
      w.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:2147483000;background:linear-gradient(135deg,#10223B,#153055);color:#fff;border-radius:18px;padding:14px 14px 12px;box-shadow:0 20px 60px rgba(2,12,30,.55);font-family:Inter,system-ui,Arial;animation:lbPlayUp .35s ease';
      var st = document.createElement('style');
      st.textContent = '@keyframes lbPlayUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}';
      document.head.appendChild(st);
      w.innerHTML = '<div style="display:flex;gap:12px;align-items:center">'
        + '<img src="/icon-192.png" alt="" style="width:44px;height:44px;border-radius:12px;flex:none" onerror="this.style.display=\'none\'">'
        + '<div style="flex:1;min-width:0">'
        + '<b style="font-size:14.5px;display:block">Get LoadBoot on Google Play</b>'
        + '<div style="color:#c7d5ea;font-size:12.5px;line-height:1.5;margin-top:2px">Same account, full screen, faster on weak signal.</div></div>'
        + '<a href="' + URL + '" target="_blank" rel="noopener" style="flex:none;background:#0883F7;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:9px 12px;border-radius:10px">Install</a>'
        + '<button aria-label="Dismiss" style="background:rgba(255,255,255,.12);border:none;color:#cbd5e1;width:28px;height:28px;border-radius:8px;font-size:14px;flex:none" id="lbPlayX">✕</button></div>';
      document.body.appendChild(w);
      document.getElementById('lbPlayX').onclick = function () { w.remove(); };
      setTimeout(function () { if (w.parentNode) w.remove(); }, 30000);
    }, 4000);
  } catch (e) {}
})();
