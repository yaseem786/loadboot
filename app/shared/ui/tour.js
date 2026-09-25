// tour.js — LoadBoot guided tour + in-app help. Shared by every portal shell.
//
//   import { createTour, mountHelp } from '../shared/ui/tour.js';
//   const tour = createTour({ key:'carrier', version:1, role:'owner', flows:{ owner:[...], driver:[...] },
//                             screens:{ loads:{ title:'Load Board', tips:[...] } }, navigate: go, currentRoute: () => tab });
//   const help = mountHelp(tour, { supportRoute:'#support' });   // floating "?" — replay, screen guides, tips
//   tour.autoStart();                                             // first visit only; remembers progress
//
// A step:  { id, screen:'loads', route:'#loads', target:['[data-tour="x"]'], anchor:'.cp-content', title, text (trusted HTML),
//            optional:true (drop the stop when target is missing) | emptyTitle/emptyText (show instead, centred),
//            tip, tipKind:'warn', icon:'loads', tone:'orange', chapter:'Finding loads', placement:'auto',
//            interact:true, advanceOn:'click', hero:true, kind:'welcome'|'done', roles:['owner'], padding:8, radius:14 }
// Title/text/tip are code-defined markup from the portal's tour-content file — never user data.
// Progress lives in localStorage under lb_tour.<key>.v<version>; nothing is sent to the server by this module.
// Everything is additive and reversible: destroy() removes every node and listener it created.
import { el } from './dom.js';
import { icon as lbIcon } from './icons.js';

const h = el;
const isFn = (f) => typeof f === 'function';
const SVG = {
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  tick: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  bulb: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  map: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
  life: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M5.6 18.4l3.9-3.9M14.5 9.5l3.9-3.9"/></svg>',
  truck: '<svg width="84" height="40" viewBox="0 0 84 40" fill="none"><rect x="2" y="6" width="50" height="24" rx="4" fill="#fff" fill-opacity=".95"/><path d="M52 12h14l10 10v8H52z" fill="#FC5305"/><rect x="56" y="15" width="8" height="7" rx="1.5" fill="#0b1220" fill-opacity=".8"/><circle cx="16" cy="32" r="6" fill="#0b1220" stroke="#fff" stroke-width="2"/><circle cx="64" cy="32" r="6" fill="#0b1220" stroke="#fff" stroke-width="2"/><path d="M8 18h16" stroke="#0883F7" stroke-width="3" stroke-linecap="round"/><path d="M8 24h24" stroke="#0883F7" stroke-width="3" stroke-linecap="round" opacity=".55"/></svg>',
};
const STR = {
  next: 'Next', back: 'Back', skip: 'Skip tour', done: 'Finish', start: 'Show me around', later: 'Maybe later',
  gotIt: 'Got it', of: 'of', tryIt: 'Try it — tap the highlighted button', help: 'Help', helpSub: 'Guides for this screen',
  tour: 'Take the 2-minute tour', tourDone: 'Replay the welcome tour', tourResume: 'Continue the tour', screenGuide: 'How this screen works',
  tips: 'Quick tips', support: 'Contact support', keys: '← → to move · Esc to close', nudge: 'New here? See how this screen works',
  welcomeBack: 'Welcome back', resumeText: 'You were part-way through the tour. Pick up where you left off?', resume: 'Continue', restart: 'Start over',
};

// ---------- storage ----------
function store(key) {
  const k = 'lb_tour.' + key;
  return {
    get() { try { return JSON.parse(localStorage.getItem(k) || 'null') || {}; } catch (_) { return {}; } },
    set(patch) { try { localStorage.setItem(k, JSON.stringify(Object.assign(this.get(), patch, { at: Date.now() }))); } catch (_) {} },
    clear() { try { localStorage.removeItem(k); } catch (_) {} },
  };
}

// ---------- element lookup ----------
function visible(node) {
  if (!node || !node.isConnected) return false;
  if (node.closest('[hidden]')) return false;
  const r = node.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const cs = getComputedStyle(node);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}
function find(sel) {
  const list = Array.isArray(sel) ? sel : [sel];
  for (const s of list) {
    if (!s) continue;
    if (isFn(s)) { const n = s(); if (visible(n)) return n; continue; }
    let nodes = []; try { nodes = document.querySelectorAll(s); } catch (_) {}
    for (const n of nodes) if (visible(n)) return n;
  }
  return null;
}
function waitFor(sel, ms) {
  return new Promise((res) => {
    const t0 = Date.now();
    (function tick() { const n = find(sel); if (n) return res(n); if (Date.now() - t0 > ms) return res(null); setTimeout(tick, 90); })();
  });
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const prefersReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

// =====================================================================================
export function createTour(opts) {
  const o = Object.assign({ key: 'portal', version: 1, role: 'owner', flows: null, steps: [], screens: {}, padding: 8, radius: 14, waitMs: 3000, userName: '' }, opts || {});
  const ico = (name, size) => (isFn(o.icon) ? o.icon(name, size) : lbIcon(name, size));   // a portal may pass its own icon set
  const S = Object.assign({}, STR, o.strings || {});
  const st = store(o.key + '.v' + o.version);
  const seen = store(o.key + '.seen');
  const emit = (name, data) => { try { if (isFn(o.onEvent)) o.onEvent(name, Object.assign({ key: o.key, role: o.role }, data || {})); } catch (_) {} };
  const hasTabbar = () => { try { return isFn(o.hasTabbar) ? !!o.hasTabbar() : matchMedia('(max-width: 900px)').matches; } catch (_) { return false; } };
  const route = () => { try { return isFn(o.currentRoute) ? String(o.currentRoute() || '') : (location.hash || '').replace('#', ''); } catch (_) { return ''; } };

  let veil = null, hole = null, blocks = [], card = null, steps = [], i = -1, mode = null, target = null, ro = null, raf = 0, unbindTarget = null, keyH = null, alive = false, lastFocus = null;

  function allSteps() {
    let list = o.flows ? (o.flows[o.role] || o.flows.default || []) : (o.steps || []);
    return list.filter((s) => !s.roles || s.roles.includes(o.role));
  }

  // ---------- DOM scaffold ----------
  function build() {
    if (veil) return;
    hole = h('div', { class: 'lbt-hole' }, [h('i', { class: 'lbt-ring' })]);
    blocks = [0, 1, 2, 3].map(() => h('div', { class: 'lbt-block' }));
    veil = h('div', { class: 'lbt-veil', 'aria-hidden': 'true' }, [...blocks, hole]);
    blocks.forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (card) { card.classList.remove('lbt-shake'); void card.offsetWidth; card.classList.add('lbt-shake'); } }));
    card = h('div', { class: 'lbt-card', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    document.body.append(veil, card);
    keyH = (e) => {
      if (!alive) return;
      if (e.key === 'Escape') { e.preventDefault(); stop('skipped'); }
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('button'))) { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Tab') trap(e);
    };
    document.addEventListener('keydown', keyH, true);
    // touch: swipe the card left for next, right for back; a tap on the veil outside the target just nudges the card
    let tx = 0, ty = 0, dx = 0, swiping = false;
    card.addEventListener('touchstart', (e) => { if (!e.touches.length) return; tx = e.touches[0].clientX; ty = e.touches[0].clientY; dx = 0; swiping = false; }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (!e.touches.length) return; const mx = e.touches[0].clientX - tx, my = e.touches[0].clientY - ty;
      if (!swiping && Math.abs(mx) > 14 && Math.abs(mx) > Math.abs(my) * 1.4) swiping = true;
      if (!swiping) return; dx = mx; card.classList.add('lbt-drag'); card.style.transform = 'translateX(' + Math.round(dx * .35) + 'px)';
    }, { passive: true });
    card.addEventListener('touchend', () => {
      card.classList.remove('lbt-drag'); card.style.transform = '';
      if (!swiping) return; const step = steps[i] || {};
      if (step.kind === 'welcome' || step.kind === 'done') return;
      if (dx < -60) next(); else if (dx > 60) back();
    });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
  }
  function trap(e) {
    const f = card.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]'); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function schedule() { if (!alive) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); }

  // ---------- geometry ----------
  function layout() {
    if (!alive || !card) return;
    const vw = innerWidth, vh = innerHeight, step = steps[i] || {};
    if (mode === 'hero' || !target || !visible(target)) {
      hole.classList.add('lbt-center'); veil.classList.add('lbt-modal');
      blocks.forEach((b, k) => { b.style.cssText = k === 0 ? 'inset:0' : 'display:none'; });
      centerCard(); return;
    }
    hole.classList.remove('lbt-center'); veil.classList.remove('lbt-modal');
    const pad = step.padding != null ? step.padding : o.padding, r = target.getBoundingClientRect();
    const x = clamp(r.left - pad, 0, vw), y = clamp(r.top - pad, 0, vh), w = Math.min(r.width + pad * 2, vw - x), hh = Math.min(r.height + pad * 2, vh - y);
    hole.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${hh}px;border-radius:${step.radius != null ? step.radius : o.radius}px`;
    // four blockers around the hole: clicks outside the target never reach the page
    blocks[0].style.cssText = `left:0;top:0;right:0;height:${y}px`;
    blocks[1].style.cssText = `left:0;top:${y + hh}px;right:0;bottom:0`;
    blocks[2].style.cssText = `left:0;top:${y}px;width:${x}px;height:${hh}px`;
    blocks[3].style.cssText = `left:${x + w}px;top:${y}px;right:0;height:${hh}px`;
    placeCard({ x, y, w, h: hh }, step);
  }
  function centerCard() {
    card.querySelectorAll('.lbt-arrow').forEach((a) => a.remove());
    if (vwSmall()) { card.classList.toggle('lbt-nobar', !hasTabbar()); card.classList.remove('lbt-sheet-top'); card.style.left = card.style.top = ''; return; }
    const cw = card.offsetWidth, ch = card.offsetHeight;
    card.style.left = Math.round((innerWidth - cw) / 2) + 'px'; card.style.top = Math.round(Math.max(16, (innerHeight - ch) / 2 - 10)) + 'px';
  }
  const vwSmall = () => innerWidth <= 640;
  function placeCard(R, step) {
    card.querySelectorAll('.lbt-arrow').forEach((a) => a.remove());
    if (vwSmall()) {
      // docked sheet: sits above the tab bar unless the target is down there, then it docks at the top
      card.classList.toggle('lbt-nobar', !hasTabbar());
      const ch = card.offsetHeight, barH = hasTabbar() ? 76 : 14, topH = 70;
      const sheetTop = innerHeight - ch - barH, below = sheetTop - 8 - (R.y + R.h), above = R.y - (topH + ch + 8);
      let top = false;
      if (below >= 0) top = false; else if (above >= 0) top = true;
      else { // neither side fits: keep the sheet at the bottom and light only the part of the target it leaves visible
        top = false; const cut = sheetTop - 10 - R.y; if (cut > 40) hole.style.height = cut + 'px';
      }
      card.classList.toggle('lbt-sheet-top', top);
      if (top) { const cut = (R.y + R.h) - (topH + ch + 10); if (cut > 40 && R.y < topH + ch + 10) { hole.style.top = (topH + ch + 10) + 'px'; hole.style.height = cut + 'px'; } }
      card.style.left = card.style.top = ''; return;
    }
    card.classList.remove('lbt-sheet-top', 'lbt-nobar');
    const cw = card.offsetWidth, ch = card.offsetHeight, m = 14, gap = 16, vw = innerWidth, vh = innerHeight;
    const want = step.placement && step.placement !== 'auto' ? [step.placement] : [];
    const order = [...want, 'bottom', 'top', 'right', 'left'];
    const fits = { bottom: R.y + R.h + gap + ch <= vh - m, top: R.y - gap - ch >= m, right: R.x + R.w + gap + cw <= vw - m, left: R.x - gap - cw >= m };
    let side = order.find((s) => fits[s]) || 'bottom';
    let left, top;
    if (side === 'bottom' || side === 'top') {
      left = clamp(R.x + R.w / 2 - cw / 2, m, vw - cw - m);
      top = side === 'bottom' ? R.y + R.h + gap : R.y - gap - ch;
      if (!fits[side]) top = clamp(top, m, vh - ch - m);
    } else {
      top = clamp(R.y + R.h / 2 - ch / 2, m, vh - ch - m);
      left = side === 'right' ? R.x + R.w + gap : R.x - gap - cw;
    }
    card.style.left = Math.round(left) + 'px'; card.style.top = Math.round(top) + 'px';
    const arrow = h('i', { class: 'lbt-arrow ' + ({ bottom: 'top', top: 'bottom', right: 'left', left: 'right' })[side] });
    if (side === 'bottom' || side === 'top') arrow.style.left = clamp(R.x + R.w / 2 - left - 8, 18, cw - 34) + 'px';
    else arrow.style.top = clamp(R.y + R.h / 2 - top - 8, 18, ch - 34) + 'px';
    card.appendChild(arrow);
  }

  // ---------- card content ----------
  function render(step) {
    card.className = 'lbt-card' + (step.hero ? ' lbt-hero' : '');
    card.innerHTML = '';
    const real = steps.filter((x) => !x.hero), n = real.length, idx = step.hero ? (step.kind === 'done' ? n : 0) : real.findIndex((x) => x.id === step.id) + 1;
    const body = h('div', { class: 'lbt-body' });
    if (step.hero) body.appendChild(heroArt(step));
    else {
      body.appendChild(h('div', { class: 'lbt-eyebrow' }, [h('span', { class: 'lbt-chapter' }, step.chapter || ' '), h('span', { class: 'lbt-count' }, `${idx} ${S.of} ${n}`)]));
      if (step.icon) { const ic = h('div', { class: 'lbt-ico ' + (step.empty ? 'navy' : (step.tone || '')) }); ic.appendChild(ico(step.icon, 22)); body.appendChild(ic); }
    }
    body.appendChild(h('h3', { class: 'lbt-title', html: step.title || '' }));
    body.appendChild(h('div', { class: 'lbt-text', html: step.text || '' }));
    if (step.tip) body.appendChild(h('div', { class: 'lbt-tip ' + (step.tipKind || ''), html: SVG.bulb + '<span>' + step.tip + '</span>' }));
    if (step.advanceOn === 'click') body.appendChild(h('div', { class: 'lbt-try' }, [h('i'), S.tryIt]));
    if (step.kind === 'welcome') body.appendChild(h('div', { class: 'lbt-meta', html: SVG.clock + `<span>${step.meta || ('2 minutes · ' + n + ' stops · skip any time')}</span>` }));
    if (step.kind === 'done' && step.actions) body.appendChild(h('div', { class: 'lbt-quick' }, step.actions.map((a) => {
      const b = h('button', { type: 'button', onClick: () => { stop('done'); if (a.route && isFn(o.navigate)) o.navigate(a.route); } }, [ico(a.icon || 'chev', 16), a.label]); return b; })));
    if (step.kind === 'welcome' && step.rolePicker) body.appendChild(rolePicker(step));
    card.appendChild(h('div', { class: 'lbt-bar' }, h('i', { style: `width:${Math.round((idx / n) * 100)}%` })));
    card.appendChild(body);
    card.appendChild(h('button', { class: 'lbt-x', type: 'button', 'aria-label': S.skip, html: SVG.x, onClick: () => stop(step.kind === 'done' ? 'done' : 'skipped') }));
    const dots = h('div', { class: 'lbt-dots' }, real.map((x, k) => h('i', { class: x.id === step.id ? 'on' : k < idx - 1 ? 'done' : '' })));
    const btns = h('div', { class: 'lbt-btns' });
    if (step.kind === 'welcome') { btns.append(h('button', { class: 'lbt-btn ghost', type: 'button', onClick: () => stop('skipped') }, S.later), h('button', { class: 'lbt-btn pri big', type: 'button', onClick: next }, [S.start, h('span', { html: SVG.chev })])); }
    else if (step.kind === 'done') btns.append(h('button', { class: 'lbt-btn pri big', type: 'button', onClick: () => stop('done') }, [h('span', { html: SVG.tick }), S.done]));
    else {
      if (i > 0 && !(steps[i - 1] && steps[i - 1].kind === 'welcome')) btns.appendChild(h('button', { class: 'lbt-btn ghost', type: 'button', onClick: back }, S.back));
      btns.appendChild(h('button', { class: 'lbt-btn pri', type: 'button', onClick: next }, [i === steps.length - 1 ? S.gotIt : S.next, h('span', { html: SVG.chev })]));
    }
    card.appendChild(h('div', { class: 'lbt-foot' }, [dots, btns]));
    card.setAttribute('aria-label', (step.title || '').replace(/<[^>]+>/g, ''));
  }
  function heroArt(step) {
    if (step.kind === 'done') {
      const art = h('div', { class: 'lbt-art done' }, [h('div', { class: 'lbt-glow' }), h('div', { class: 'lbt-check', html: SVG.check })]);
      if (!prefersReduced()) for (let k = 0; k < 18; k++) { const c = h('i', { class: 'lbt-conf' }); c.style.cssText = `left:${5 + Math.random() * 90}%;background:${['#0883F7', '#FC5305', '#10b981', '#fbbf24', '#a78bfa'][k % 5]};animation-delay:${Math.random() * .6}s;animation-duration:${1.3 + Math.random()}s`; art.appendChild(c); }
      return art;
    }
    return h('div', { class: 'lbt-art' }, [h('div', { class: 'lbt-glow' }), h('div', { class: 'lbt-road' }), h('div', { class: 'lbt-truck', html: SVG.truck })]);
  }
  function rolePicker(step) {
    const wrap = h('div', { class: 'lbt-roles' });
    (step.rolePicker || []).forEach((r) => {
      const b = h('button', { class: 'lbt-role' + (r.id === o.role ? ' on' : ''), type: 'button' }, [ico(r.icon || 'user', 20), h('div', null, [h('b', null, r.label), h('span', null, r.sub || '')])]);
      b.addEventListener('click', () => { o.role = r.id; wrap.querySelectorAll('.lbt-role').forEach((x) => x.classList.toggle('on', x === b)); const cur = steps[i]; steps = allSteps(); i = Math.max(0, steps.indexOf(cur)); render(steps[i]); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // ---------- flow ----------
  let showing = 0, dir = 1;
  async function show(k) {
    if (!alive) return;
    const my = ++showing; i = k; let step = steps[i]; if (!step) return stop('done');
    unbind(); card.classList.remove('lbt-in');   // the old card fades while the next screen loads
    if (step.route && isFn(o.navigate) && route() !== String(step.route).replace('#', '')) { try { await o.navigate(step.route); } catch (_) {} }
    let el9 = null;
    if (!step.hero && step.target) el9 = await waitFor(step.target, step.wait != null ? step.wait : o.waitMs);
    if (!alive || my !== showing) return;
    if (!step.hero && !el9 && step.anchor) el9 = find(step.anchor);   // generic place to point at when the precise hook is missing (normal copy)
    if (!step.hero && !el9 && (step.optional || step.missing === 'skip')) {
      // nothing to point at (empty board, setup already finished, no active load): drop the stop and move on
      emit('tour.skipstep', { id: step.id, index: i }); steps.splice(i, 1);
      if (!steps.length) return stop('done');
      return show(dir < 0 ? Math.max(0, i - 1) : Math.min(i, steps.length - 1));
    }
    target = el9; mode = step.hero || !el9 ? 'hero' : 'spot';
    if (!step.hero && !el9 && (step.emptyTitle || step.emptyText)) step = Object.assign({}, step, { title: step.emptyTitle || step.title, text: step.emptyText || step.text, tip: step.emptyTip != null ? step.emptyTip : step.tip, advanceOn: null, empty: true });
    if (el9) { try { const tall = vwSmall() && el9.getBoundingClientRect().height > innerHeight * 0.38; el9.style.scrollMarginTop = '78px'; el9.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: prefersReduced() ? 'auto' : 'smooth' }); } catch (_) {} }   // scroll-margin keeps it clear of the sticky header
    card.classList.remove('lbt-in'); render(step); veil.classList.add('lbt-on'); veil.classList.toggle('lbt-pass', !!(step.interact || step.advanceOn === 'click'));
    hole.querySelectorAll('.lbt-tapme').forEach((x) => x.remove()); if (step.advanceOn === 'click') hole.appendChild(h('i', { class: 'lbt-tapme' }));
    document.body.classList.add('lbt-lock');
    if (el9) {
      if (step.advanceOn === 'click') { const fn = () => { setTimeout(next, 120); }; el9.addEventListener('click', fn, { once: true, capture: true }); unbindTarget = () => el9.removeEventListener('click', fn, true); }
      try { ro = new ResizeObserver(schedule); ro.observe(el9); } catch (_) {}
    }
    // settle after the smooth scroll, then lay out and fade the card in
    const settle = el9 && !prefersReduced() ? 260 : 20;
    setTimeout(() => { if (!alive || my !== showing) return; layout(); requestAnimationFrame(() => { if (my !== showing) return; card.classList.add('lbt-in'); try { card.focus({ preventScroll: true }); } catch (_) {} }); }, settle);
    setTimeout(() => { if (alive && my === showing) layout(); }, settle + 420);
    st.set({ status: 'active', step: i, total: steps.length, mode: runMode });
    emit(runMode === 'screen' ? 'screen.step' : 'tour.step', { id: step.id, index: i, total: steps.length });
  }
  function unbind() { if (unbindTarget) { unbindTarget(); unbindTarget = null; } if (ro) { try { ro.disconnect(); } catch (_) {} ro = null; } }
  function next() { if (!alive) return; dir = 1; if (i >= steps.length - 1) return stop('done'); show(i + 1); }
  function back() { if (!alive || i <= 0) return; dir = -1; show(i - 1); }
  let runMode = 'tour', runScreen = null;
  function begin(list, m, screen, from) {
    if (!list.length) return false;
    build(); alive = true; runMode = m; runScreen = screen || null; steps = list; lastFocus = document.activeElement;
    emit(m === 'screen' ? 'screen.start' : 'tour.start', { screen, total: list.length });
    show(clamp(from || 0, 0, list.length - 1)); return true;
  }
  function stop(reason) {
    if (!alive) return; alive = false; unbind(); showing++;
    card.classList.remove('lbt-in'); veil.classList.remove('lbt-on', 'lbt-pass'); document.body.classList.remove('lbt-lock');
    hole.classList.add('lbt-center'); blocks.forEach((b) => { b.style.cssText = 'display:none'; });
    const step = steps[i] || {};
    if (runMode === 'screen') { if (runScreen) seen.set({ [runScreen]: reason }); emit('screen.' + (reason === 'done' ? 'done' : 'skip'), { screen: runScreen, at: i }); }
    else { st.set({ status: reason === 'done' ? 'done' : 'skipped', step: i, total: steps.length }); emit('tour.' + (reason === 'done' ? 'done' : 'skip'), { at: i, id: step.id, total: steps.length }); }
    try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (_) {}
    if (isFn(o.onStop)) { try { o.onStop(reason, runMode, runScreen); } catch (_) {} }
  }

  const api = {
    get active() { return alive; }, get role() { return o.role; }, set role(r) { o.role = r; },
    state() { return st.get(); }, isDone() { const s = st.get(); return s.status === 'done' || s.status === 'skipped'; },
    screens: o.screens || {}, strings: S,
    start(a) { const from = a && a.from != null ? a.from : 0; if (alive) stop('skipped'); return begin(allSteps(), 'tour', null, from); },
    // resume: welcome-back card first when the person left part-way through
    autoStart(a) {
      const s = st.get(); if (a && a.force) return api.start();
      if (s.status === 'done' || s.status === 'skipped') return false;
      if (s.status === 'active' && s.step > 1 && s.mode !== 'screen') { resumeCard(s.step); return true; }
      return api.start();
    },
    startScreen(screen) { if (alive) stop('skipped'); const list = allSteps().filter((s) => s.screen === screen && !s.hero); return begin(list, 'screen', screen, 0); },
    hasScreen(screen) { return allSteps().some((s) => s.screen === screen && !s.hero); },
    screenSeen(screen) { return !!seen.get()[screen]; }, markScreen(screen) { seen.set({ [screen]: 'seen' }); },
    next, back, goto(k) { if (alive) show(k); }, stop, reset() { st.clear(); seen.clear(); },
    destroy() { if (alive) stop('skipped'); if (veil) veil.remove(); if (card) card.remove(); document.removeEventListener('keydown', keyH, true); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); veil = card = null; },
  };
  function resumeCard(step) {
    build(); alive = true; runMode = 'tour'; steps = allSteps(); mode = 'hero'; target = null; i = clamp(step, 0, steps.length - 1);
    card.className = 'lbt-card lbt-hero'; card.innerHTML = '';
    const body = h('div', { class: 'lbt-body' }, [heroArt({}), h('h3', { class: 'lbt-title' }, S.welcomeBack), h('div', { class: 'lbt-text' }, S.resumeText)]);
    card.append(body, h('button', { class: 'lbt-x', type: 'button', 'aria-label': S.skip, html: SVG.x, onClick: () => stop('skipped') }),
      h('div', { class: 'lbt-foot' }, [h('div', { class: 'lbt-dots' }), h('div', { class: 'lbt-btns' }, [
        h('button', { class: 'lbt-btn ghost', type: 'button', onClick: () => show(0) }, S.restart),
        h('button', { class: 'lbt-btn pri big', type: 'button', onClick: () => show(i) }, [S.resume, h('span', { html: SVG.chev })])])]));
    veil.classList.add('lbt-on'); document.body.classList.add('lbt-lock'); layout(); requestAnimationFrame(() => card.classList.add('lbt-in'));
  }
  return api;
}

// =====================================================================================
// Floating "?" — replay the tour, run a single screen's guide, read quick tips, reach support.
export function mountHelp(tour, opts) {
  const o = Object.assign({ supportRoute: '#support', nudgeMs: 9000 }, opts || {});
  const S = tour.strings;
  const hasTabbar = () => { try { return isFn(o.hasTabbar) ? !!o.hasTabbar() : matchMedia('(max-width: 900px)').matches; } catch (_) { return false; } };
  const btn = h('button', { class: 'lbt-help', type: 'button', 'aria-label': S.help, 'aria-haspopup': 'dialog', html: '?' });
  const panel = h('div', { class: 'lbt-panel', role: 'dialog', 'aria-label': S.help });
  let nudge = null, nudgeT = 0, curRoute = '', open = false, unbindOutside = null;
  document.body.append(btn, panel);
  const screenOf = (r) => (tour.screens || {})[r] || null;

  function paint() {
    const done = tour.isDone(), s = tour.state(), scr = screenOf(curRoute), title = scr ? scr.title : '';
    btn.querySelectorAll('.lbt-help-dot').forEach((x) => x.remove()); if (!done) btn.appendChild(h('i', { class: 'lbt-help-dot' }));
    panel.innerHTML = '';
    panel.appendChild(h('div', { class: 'lbt-panel-head' }, [h('div', null, [h('b', null, S.help), h('span', null, title ? `${S.helpSub}: ${title}` : S.helpSub)]), h('button', { class: 'lbt-x', type: 'button', style: 'position:static', 'aria-label': 'Close', html: SVG.x, onClick: close })]));
    const list = h('div', { class: 'lbt-panel-list' });
    const tourLabel = done ? S.tourDone : (s.status === 'active' && s.step > 1 ? S.tourResume : S.tour);
    list.appendChild(item(SVG.play, tourLabel, done ? 'Every screen, start to finish' : 'Two minutes, skip any time', () => { close(); if (!done && s.status === 'active' && s.step > 1) tour.start({ from: s.step }); else tour.start(); }));
    if (scr && tour.hasScreen(curRoute)) list.appendChild(item(SVG.map, S.screenGuide, title, () => { close(); tour.startScreen(curRoute); }));
    panel.appendChild(list);
    if (scr && scr.tips && scr.tips.length) panel.appendChild(h('div', { class: 'lbt-screen' }, [h('h4', null, S.tips), h('ul', null, scr.tips.map((t) => h('li', { html: SVG.tick + '<span>' + t + '</span>' })))]));
    panel.appendChild(h('div', { class: 'lbt-panel-foot' }, [
      o.supportRoute ? h('button', { type: 'button', onClick: () => { close(); if (isFn(o.navigate)) o.navigate(o.supportRoute); else location.hash = o.supportRoute; } }, [S.support, ' ›']) : h('span'),
      h('span', { class: 'lbt-keys' }, hasTabbar() ? '' : S.keys)]));
    btn.classList.toggle('lbt-nobar', !hasTabbar()); panel.classList.toggle('lbt-nobar', !hasTabbar());
  }
  function item(svg, label, sub, fn) { return h('button', { class: 'lbt-item', type: 'button', onClick: fn }, [h('span', { class: 'lbt-item-ic', html: svg }), h('div', null, [h('b', null, label), h('span', null, sub)]), h('span', { class: 'lbt-chev', html: SVG.chev })]); }
  function openP() { paint(); open = true; panel.classList.add('lbt-in'); btn.setAttribute('aria-expanded', 'true'); hideNudge(); tour.markScreen && curRoute && tour.markScreen(curRoute);
    setTimeout(() => { const outside = (e) => { if (!panel.contains(e.target) && e.target !== btn) close(); }; document.addEventListener('click', outside, true); unbindOutside = () => document.removeEventListener('click', outside, true); }, 0);
    try { if (isFn(o.onEvent)) o.onEvent('help.open', { route: curRoute }); } catch (_) {} }
  function close() { open = false; panel.classList.remove('lbt-in'); btn.setAttribute('aria-expanded', 'false'); if (unbindOutside) { unbindOutside(); unbindOutside = null; } }
  btn.addEventListener('click', (e) => { e.stopPropagation(); open ? close() : openP(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });

  function showNudge(text) {
    hideNudge();
    nudge = h('div', { class: 'lbt-nudge' + (hasTabbar() ? '' : ' lbt-nobar'), role: 'status' }, [h('span', null, text), h('span', { class: 'lbt-nudge-x', html: SVG.x })]);
    nudge.addEventListener('click', (e) => { const x = e.target.closest('.lbt-nudge-x'); hideNudge(); tour.markScreen(curRoute); if (!x) tour.startScreen(curRoute); });
    document.body.appendChild(nudge); requestAnimationFrame(() => nudge && nudge.classList.add('lbt-in'));
    nudgeT = setTimeout(hideNudge, o.nudgeMs);
  }
  function hideNudge() { clearTimeout(nudgeT); if (nudge) { const n = nudge; nudge = null; n.classList.remove('lbt-in'); setTimeout(() => n.remove(), 300); } }

  const api = {
    button: btn, panel, open: openP, close,
    // call on every route change: keeps the panel in context and nudges once per screen (after the main tour)
    onRoute(r) {
      curRoute = String(r || '').replace('#', ''); if (open) paint();
      const scr = screenOf(curRoute);
      if (scr && tour.isDone() && !tour.active && !tour.screenSeen(curRoute) && tour.hasScreen(curRoute)) showNudge(scr.nudge || S.nudge); else hideNudge();
    },
    hide() { btn.hidden = true; close(); hideNudge(); }, show() { btn.hidden = false; },
    destroy() { close(); hideNudge(); btn.remove(); panel.remove(); },
  };
  return api;
}

export default { createTour, mountHelp };
