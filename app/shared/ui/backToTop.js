/* LoadBoot — Back to top (premium floating control)
 * Shared by the marketing site and every portal. No inline JS (CSP-safe), no deps.
 * Behaviour: hidden until the reader is ~1 screen down, fades in bottom-right,
 * stacks itself above the live-chat FAB and any bottom tab bar / mobile CTA bar,
 * shows read progress on its ring, and returns to the top smoothly.
 */
(function () {
  'use strict';
  if (window.__lbBackToTop) return;
  window.__lbBackToTop = true;

  var CSS = [
    '#lb-btt{position:fixed;right:18px;bottom:18px;z-index:2147483644;width:48px;height:48px;padding:0;border:0;',
    'border-radius:50%;cursor:pointer;-webkit-appearance:none;appearance:none;background:transparent;',
    'opacity:0;visibility:hidden;transform:translateY(14px) scale(.9);',
    'transition:opacity .22s ease,transform .22s cubic-bezier(.2,.8,.3,1),visibility .22s;',
    '-webkit-tap-highlight-color:transparent}',
    '#lb-btt.on{opacity:1;visibility:visible;transform:none}',
    '#lb-btt:active{transform:scale(.94)}',
    '#lb-btt:focus-visible{outline:2px solid #0883F7;outline-offset:3px}',
    '#lb-btt .btt-face{position:absolute;inset:4px;border-radius:50%;background:rgba(255,255,255,.94);',
    '-webkit-backdrop-filter:saturate(180%) blur(12px);backdrop-filter:saturate(180%) blur(12px);',
    'border:1px solid rgba(16,34,59,.10);box-shadow:0 10px 28px -8px rgba(16,34,59,.38),0 2px 6px rgba(16,34,59,.10);',
    'display:flex;align-items:center;justify-content:center;color:#10223B;transition:background .18s,color .18s,box-shadow .18s}',
    '#lb-btt:hover .btt-face{background:#10223B;color:#fff;box-shadow:0 14px 34px -8px rgba(16,34,59,.5)}',
    '#lb-btt .btt-ring{position:absolute;inset:0;transform:rotate(-90deg);pointer-events:none}',
    '#lb-btt .btt-ring circle{fill:none;stroke-width:2;stroke-linecap:round}',
    '#lb-btt .btt-trk{stroke:rgba(16,34,59,.14)}',
    '#lb-btt .btt-bar{stroke:#0883F7;transition:stroke-dashoffset .12s linear}',
    '#lb-btt.on:hover .btt-bar{stroke:#FC5305}',
    '#lb-btt svg.btt-ico{width:20px;height:20px;display:block}',
    '@media (prefers-reduced-motion:reduce){#lb-btt,#lb-btt .btt-face,#lb-btt .btt-bar{transition:none}}',
    '@media print{#lb-btt{display:none!important}}',
    /* dark shells (carrier dark theme, partner agent dark, Command Center) — detected at runtime */
    '#lb-btt.dk .btt-face{background:rgba(15,27,48,.94);border-color:rgba(255,255,255,.14);color:#fff;',
    'box-shadow:0 12px 32px -8px rgba(0,0,0,.6)}',
    '#lb-btt.dk .btt-trk{stroke:rgba(255,255,255,.18)}',
    '#lb-btt.dk:hover .btt-face{background:#0883F7;color:#fff}'
  ].join('');

  var R = 21, C = 2 * Math.PI * R;

  function boot() {
    if (document.getElementById('lb-btt')) return;

    var st = document.createElement('style');
    st.id = 'lb-btt-css';
    st.textContent = CSS;
    document.head.appendChild(st);

    var btn = document.createElement('button');
    btn.id = 'lb-btt';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top');
    btn.setAttribute('title', 'Back to top');
    btn.innerHTML =
      '<svg class="btt-ring" viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle class="btt-trk" cx="24" cy="24" r="' + R + '"></circle>' +
      '<circle class="btt-bar" cx="24" cy="24" r="' + R + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"></circle>' +
      '</svg>' +
      '<span class="btt-face"><svg class="btt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 19V6"></path><path d="M5.5 12.5 12 6l6.5 6.5"></path></svg></span>';
    document.body.appendChild(btn);

    var bar = btn.querySelector('.btt-bar');

    function scroller() {
      return document.scrollingElement || document.documentElement;
    }

    /* Match the shell we are sitting on, so the control reads well on the dark portals too. */
    function syncTheme() {
      var el = document.body, bg = '';
      for (var i = 0; el && i < 3; i++) {
        var c = getComputedStyle(el).backgroundColor || '';
        if (c && c !== 'transparent' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(c)) { bg = c; break; }
        el = el.parentElement;
      }
      var m = bg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (!m) return;
      var lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
      btn.classList.toggle('dk', lum < 0.45);
    }

    /* Sit clear of the bottom tab bar / mobile CTA bar, and above the chat FAB. */
    function place() {
      var off = 18;
      try {
        var b = document.querySelector('.cp-tabbar,.lb-tabbar,#bTabbar,.mcta');
        if (b) {
          var r = b.getBoundingClientRect();
          if (r.height > 0 && r.top < window.innerHeight && getComputedStyle(b).display !== 'none') {
            off = Math.max(18, Math.round(window.innerHeight - r.top) + 12);
          }
        }
        var fab = document.getElementById('lbc-fab');
        if (fab && getComputedStyle(fab).display !== 'none') {
          off += Math.round(fab.getBoundingClientRect().height || 56) + 12;
        }
      } catch (e) {}
      btn.style.bottom = 'calc(' + off + 'px + env(safe-area-inset-bottom, 0px))';
    }

    var raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var el = scroller();
        var y = window.pageYOffset || el.scrollTop || 0;
        var vh = window.innerHeight || el.clientHeight || 1;
        var max = Math.max(1, el.scrollHeight - vh);

        /* Never offer it on pages that barely scroll. */
        var worthIt = el.scrollHeight > vh * 2;
        var panelOpen = false;
        try {
          var p = document.getElementById('lbc-panel');
          panelOpen = !!(p && getComputedStyle(p).display !== 'none');
        } catch (e) {}

        var show = worthIt && !panelOpen && y > vh * 0.9;
        if (show !== btn.classList.contains('on')) btn.classList.toggle('on', show);
        if (show) bar.setAttribute('stroke-dashoffset', (C * (1 - Math.min(1, y / max))).toFixed(1));
      });
    }

    btn.addEventListener('click', function () {
      var reduce = false;
      try {
        reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
      } catch (e) {}
      try {
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
      /* keyboard users land back on the top of the document, not on a now-hidden button */
      btn.blur();
      var h = document.querySelector('header a,header button,h1');
      if (h && h.focus) { try { h.focus({ preventScroll: true }); } catch (e) {} }
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { place(); onScroll(); }, { passive: true });
    window.addEventListener('hashchange', function () { setTimeout(function () { place(); onScroll(); }, 300); });
    if (window.MutationObserver) {
      var t = null;
      new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(function () { place(); syncTheme(); onScroll(); }, 300);
      }).observe(document.body, { childList: true, subtree: true });
    }
    place();
    syncTheme();
    onScroll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
