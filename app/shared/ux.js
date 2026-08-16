// ux.js — big-brand UX primitives (2026-08 app audit). All additive, dependency-free.
// skeleton loaders (Amazon/DoorDash pattern), haptic feedback (Uber pattern),
// pull-to-refresh (every big app), OS app-icon badge (unread count on the launcher icon).

/* ---------- haptics ---------- */
export function haptic(kind) {
  try {
    if (!('vibrate' in navigator)) return;
    const p = kind === 'success' ? [30, 40, 60]
      : kind === 'warn' ? [60, 40, 60]
      : kind === 'error' ? [90, 50, 90]
      : 12; // 'tap'
    navigator.vibrate(p);
  } catch (_) {}
}

/* ---------- skeleton loaders ---------- */
// showSkeleton(host, 'list' | 'cards' | 'detail', n)
export function skeletonEl(kind, n) {
  const wrap = document.createElement('div');
  wrap.className = 'lb-skel-wrap';
  wrap.setAttribute('aria-busy', 'true');
  wrap.setAttribute('aria-label', 'Loading');
  const count = n || (kind === 'detail' ? 1 : 4);
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'lb-skel-card';
    if (kind === 'cards') {
      c.innerHTML = '<div class="lb-skel ln w40"></div><div class="lb-skel ln w90"></div><div class="lb-skel ln w70"></div><div class="lb-skel ln w55"></div>';
    } else if (kind === 'detail') {
      c.innerHTML = '<div class="lb-skel ln w60"></div><div class="lb-skel ln w90"></div><div class="lb-skel ln w80"></div><div class="lb-skel ln w90"></div><div class="lb-skel ln w45"></div><div class="lb-skel ln w75"></div>';
    } else {
      c.innerHTML = '<div class="lb-skel av"></div><div style="flex:1"><div class="lb-skel ln w70"></div><div class="lb-skel ln w45"></div></div>';
      c.classList.add('row');
    }
    wrap.appendChild(c);
  }
  return wrap;
}
export function showSkeleton(host, kind, n) {
  if (!host) return;
  host.innerHTML = '';
  host.appendChild(skeletonEl(kind || 'list', n));
}

/* ---------- pull-to-refresh ---------- */
// attachPullToRefresh(scrollHost, onRefresh) — native-feel PTR for the installed app.
// Activates only when the page is scrolled to the very top and no modal is open.
export function attachPullToRefresh(host, onRefresh) {
  if (!host || typeof onRefresh !== 'function') return;
  let startY = null, pulling = false, busy = false;
  const ind = document.createElement('div');
  ind.className = 'lb-ptr';
  ind.innerHTML = '<span class="lb-ptr-spin"></span><span class="lb-ptr-txt">Pull to refresh</span>';
  document.body.appendChild(ind);
  const topOf = () => (document.scrollingElement || document.documentElement).scrollTop;
  const modalOpen = () => !!document.querySelector('.cp-modal, .lb-drawer-ov');
  function reset() { pulling = false; startY = null; ind.classList.remove('show', 'ready'); ind.style.transform = ''; }
  window.addEventListener('touchstart', (e) => {
    if (busy || modalOpen() || topOf() > 0 || !e.touches || e.touches.length !== 1) return;
    startY = e.touches[0].clientY; pulling = false;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (startY == null || busy) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 8 || topOf() > 0) { if (pulling) reset(); return; }
    pulling = true;
    const pull = Math.min(dy, 130);
    ind.classList.add('show');
    ind.classList.toggle('ready', pull > 75);
    ind.style.transform = 'translateX(-50%) translateY(' + Math.round(pull * 0.55) + 'px)';
    const txt = ind.querySelector('.lb-ptr-txt');
    if (txt) txt.textContent = pull > 75 ? 'Release to refresh' : 'Pull to refresh';
  }, { passive: true });
  window.addEventListener('touchend', async () => {
    if (!pulling || startY == null) { reset(); return; }
    const ready = ind.classList.contains('ready');
    if (!ready) { reset(); return; }
    busy = true;
    haptic('tap');
    ind.classList.add('show');
    ind.style.transform = 'translateX(-50%) translateY(46px)';
    const txt = ind.querySelector('.lb-ptr-txt');
    if (txt) txt.textContent = 'Refreshing…';
    try { await onRefresh(); } catch (_) {}
    setTimeout(() => { reset(); busy = false; }, 350);
  }, { passive: true });
}

/* ---------- OS app-icon badge (unread count on launcher icon) ---------- */
export function setAppBadge(n) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (n > 0) navigator.setAppBadge(Math.min(Number(n) || 0, 99)); else navigator.clearAppBadge();
  } catch (_) {}
}
export default { haptic, showSkeleton, skeletonEl, attachPullToRefresh, setAppBadge };

/* ---------- number count-up (banking-app KPI animation) ---------- */
export function countUp(el, text, duration) {
  try {
    if (!el) return;
    const m = String(text).match(/^([^0-9\-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) { el.textContent = text; return; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = text; return; }
    const prefix = m[1], suffix = m[3];
    const target = Number(m[2].replace(/,/g, ''));
    if (!isFinite(target) || Math.abs(target) < 2) { el.textContent = text; return; }
    const hasComma = m[2].indexOf(',') >= 0, dec = (m[2].split('.')[1] || '').length;
    const dur = duration || 650, t0 = performance.now();
    const fmt = (v) => {
      let s = dec ? v.toFixed(dec) : String(Math.round(v));
      if (hasComma) s = Number(s).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
      return s;
    };
    function tick(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + fmt(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = text;
    }
    requestAnimationFrame(tick);
  } catch (_) { try { el.textContent = text; } catch (__) {} }
}

/* ---------- swipe action on a list row (iOS Mail pattern, minimal) ---------- */
// attachSwipeAction(row, { label, onAction }) — swipe left past the threshold fires the action.
export function attachSwipeAction(row, opts) {
  try {
    if (!row || !opts || typeof opts.onAction !== 'function') return;
    let sx = null, sy = null, dx = 0, active = false;
    row.style.touchAction = 'pan-y';
    row.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; active = false;
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      if (sx == null) return;
      dx = e.touches[0].clientX - sx;
      const dy = Math.abs(e.touches[0].clientY - sy);
      if (dy > 30 && !active) { sx = null; row.style.transform = ''; return; }
      if (dx < -12) {
        active = true;
        const pull = Math.max(dx, -110);
        row.style.transform = 'translateX(' + pull + 'px)';
        row.style.transition = 'none';
      }
    }, { passive: true });
    row.addEventListener('touchend', () => {
      if (sx == null) return;
      row.style.transition = 'transform .18s ease-out';
      if (active && dx < -80) {
        haptic('tap');
        row.style.transform = 'translateX(-110px)';
        setTimeout(() => { try { opts.onAction(); } catch (_) {} row.style.transform = ''; }, 120);
      } else row.style.transform = '';
      sx = null; active = false;
    }, { passive: true });
  } catch (_) {}
}
