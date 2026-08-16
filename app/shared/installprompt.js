// installprompt.js — Android/desktop Chrome A2HS install prompt for the portals.
// Captures beforeinstallprompt (Chrome suppresses the default banner once captured)
// and shows a small install pill after a short delay. 14-day dismiss cooldown,
// never shown when already installed (standalone / TWA).
let _deferred = null;
let _shown = false;

function standalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true
      || document.referrer.startsWith('android-app://');
  } catch (_) { return false; }
}

function cooledDown() {
  try {
    const t = Number(localStorage.getItem('lb_a2hs_hide') || 0);
    return Date.now() - t < 14 * 864e5;
  } catch (_) { return false; }
}

function showPill() {
  if (_shown || !_deferred || standalone() || cooledDown()) return;
  _shown = true;
  const pill = document.createElement('div');
  pill.id = 'lb-a2hs';
  pill.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(74px + env(safe-area-inset-bottom));z-index:9997;background:#0883F7;color:#fff;border-radius:99px;padding:10px 18px;display:flex;align-items:center;gap:10px;font:700 13.5px system-ui,sans-serif;box-shadow:0 14px 34px -10px rgba(8,131,247,.65);cursor:pointer';
  pill.innerHTML = '<span>⬇ Install the LoadBoot app</span><button style="background:none;border:0;color:rgba(255,255,255,.8);font-size:16px;cursor:pointer;line-height:1;padding:0">×</button>';
  document.body.appendChild(pill);
  pill.querySelector('button').onclick = (e) => {
    e.stopPropagation();
    try { localStorage.setItem('lb_a2hs_hide', String(Date.now())); } catch (_) {}
    pill.remove();
  };
  pill.onclick = async () => {
    pill.remove();
    const d = _deferred; _deferred = null;
    if (!d) return;
    try { d.prompt(); await d.userChoice; } catch (_) {}
  };
  setTimeout(() => { try { pill.remove(); } catch (_) {} }, 30000);
}

export function initInstallPrompt() {
  if (standalone()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferred = e;
    setTimeout(showPill, 6000);
  });
  window.addEventListener('appinstalled', () => { _deferred = null; const p = document.getElementById('lb-a2hs'); if (p) p.remove(); });
}
export default initInstallPrompt;
