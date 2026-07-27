// iosInstall.js — iPhone/iPad Safari users get a one-time premium "Add to Home Screen"
// guide (PWA install has no native prompt on iOS). Shows once per 14 days, never when
// already installed (standalone), dismissible. Plain script — safe on portals + site.
(function () {
  try {
    if (typeof window === 'undefined') return;
    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!isIOS || standalone) return;
    var KEY = 'lb_ios_install_hint';
    var last = 0; try { last = parseInt(localStorage.getItem(KEY) || '0', 10); } catch (e) {}
    if (Date.now() - last < 14 * 864e5) return;
    setTimeout(function () {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      var w = document.createElement('div');
      w.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:2147483000;background:linear-gradient(135deg,#10223B,#153055);color:#fff;border-radius:18px;padding:16px 16px 14px;box-shadow:0 20px 60px rgba(2,12,30,.55);font-family:Inter,system-ui,Arial;animation:lbIosUp .35s ease';
      var st = document.createElement('style');
      st.textContent = '@keyframes lbIosUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}';
      document.head.appendChild(st);
      w.innerHTML = '<div style="display:flex;gap:12px;align-items:flex-start">'
        + '<img src="/icon-192.png" style="width:44px;height:44px;border-radius:12px;flex:none" onerror="this.style.display=\'none\'">'
        + '<div style="flex:1">'
        + '<b style="font-size:14.5px">Install LoadBoot on your iPhone</b>'
        + '<div style="color:#c7d5ea;font-size:12.5px;line-height:1.6;margin-top:4px">'
        + '1. Tap the <b style="color:#7cc0ff">Share</b> button <span style="display:inline-block;border:1.5px solid #7cc0ff;border-radius:6px;padding:0 6px;color:#7cc0ff">&#8963;&#8593;</span> below<br>'
        + '2. Scroll &amp; tap <b style="color:#7cc0ff">Add to Home Screen</b><br>'
        + '3. Tap <b style="color:#7cc0ff">Add</b> — full app, push alerts included</div></div>'
        + '<button aria-label="Dismiss" style="background:rgba(255,255,255,.12);border:none;color:#cbd5e1;width:28px;height:28px;border-radius:8px;font-size:14px;flex:none" id="lbIosX">✕</button></div>';
      document.body.appendChild(w);
      document.getElementById('lbIosX').onclick = function () { w.remove(); };
      setTimeout(function () { if (w.parentNode) w.remove(); }, 30000);
    }, 4000);
  } catch (e) {}
})();
