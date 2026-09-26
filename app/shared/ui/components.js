// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// components.js — premium UI building blocks shared by Command Center views.
// All code-defined; values from data are inserted as text nodes (XSS-safe).
import { el } from './dom.js';
import { icon } from './icons.js';

// ---- formatting ----
export function money(n, dp = 0) {
  const v = Number(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
// A bare YYYY-MM-DD (a Postgres `date`: trial_start, trial_end, expiry dates) carries NO time zone.
// new Date('2026-09-21') parses it as UTC midnight, which renders as "Sep 20" for anyone west of UTC —
// the trial window read a day early for every US viewer. Build those as a LOCAL date instead.
// Full timestamps still go through Date() untouched.
export function fmtDate(ts) {
  if (!ts) return '—';
  try {
    const m = typeof ts === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(ts);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return String(ts); }
}
export function fmtDateTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch (_) { return String(ts); }
}
export function ago(ts) {
  if (!ts) return '—';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return fmtDate(ts);
}
export function initials(name, fallback) {
  const s = (name || fallback || '?').trim();
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join('').toUpperCase() || '?';
}

// ---- section header ----
export function sectionHead(title, subtitle, actions) {
  return el('div', { class: 'cc-section-head' }, [
    el('div', null, [el('h2', null, title), subtitle ? el('p', null, subtitle) : '']),
    actions ? el('div', { class: 'cc-head-actions' }, actions) : '',
  ]);
}

// ---- status pill (maps a status string to a colored pill) ----
const PILL = {
  active: 'green', approved: 'green', paid: 'green', delivered: 'green',
  pending: 'amber', booked: 'blue', in_transit: 'blue', available: 'blue',
  paused: 'gray', rejected: 'red', cancelled: 'red', suspended: 'red',
};
export function statusPill(status) {
  const s = (status || 'unknown').toLowerCase();
  const tone = PILL[s] || 'gray';
  return el('span', { class: 'cc-pill cc-pill-' + tone }, [el('i', { class: 'cc-pill-dot' }), s.replace(/_/g, ' ')]);
}

// ---- KPI stat card ----
// Pass o.to (a '#/path' hash) or o.onClick to make the whole card a drill-down target.
export function statCard(o) {
  const clickable = !!(o.to || o.onClick);
  const attrs = { class: 'cc-kpi' + (o.accent ? ' cc-kpi-' + o.accent : '') + (clickable ? ' cc-kpi-click' : '') };
  if (clickable) {
    attrs.role = 'button'; attrs.tabindex = '0';
    const go = (e) => { if (e) e.preventDefault(); if (o.onClick) o.onClick(); else if (o.to) location.hash = o.to; };
    attrs.onClick = go;
    attrs.onKeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); };
  }
  return el('div', attrs, [
    el('div', { class: 'cc-kpi-top' }, [
      el('span', { class: 'cc-kpi-ico' }, icon(o.icon || 'grid', 20)),
      o.trend != null ? el('span', { class: 'cc-kpi-trend' }, [icon('arrowUp', 13), String(o.trend)]) : '',
      clickable ? el('span', { class: 'cc-kpi-go' }, '›') : '',
    ]),
    el('div', { class: 'cc-kpi-val' }, o.value),
    el('div', { class: 'cc-kpi-label' }, o.label),
    o.sub ? el('div', { class: 'cc-kpi-sub' }, o.sub) : '',
  ]);
}

// ---- simple SVG bar chart from [{d,c}] ----
export function barChart(series, opts = {}) {
  const data = series || [];
  const max = Math.max(1, ...data.map(p => Number(p.c) || 0));
  const W = 100, H = 38, n = data.length || 1, gap = 1.4, bw = (W - gap * (n - 1)) / n;
  let bars = '';
  data.forEach((p, i) => {
    const h = (Number(p.c) || 0) / max * (H - 6);
    const x = i * (bw + gap);
    bars += '<rect x="' + x.toFixed(2) + '" y="' + (H - h).toFixed(2) + '" width="' + bw.toFixed(2) +
      '" height="' + Math.max(h, 0.6).toFixed(2) + '" rx="0.8" fill="url(#g)"/>';
  });
  const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%" height="' +
    (opts.height || 56) + '"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#93c5fd"/></linearGradient></defs>' +
    bars + '</svg>';
  return el('div', { class: 'cc-chart', html: svg });
}

// ---- horizontal breakdown bar (status -> count) ----
export function breakdownBars(obj, total) {
  const entries = Object.entries(obj || {});
  const sum = total || entries.reduce((a, [, c]) => a + Number(c), 0) || 1;
  return el('div', { class: 'cc-breakdown' }, entries.map(([k, c]) => {
    const pct = (Number(c) / sum * 100).toFixed(0);
    return el('div', { class: 'cc-bd-row' }, [
      el('div', { class: 'cc-bd-head' }, [
        el('span', null, [statusPill(k)]),
        el('b', null, String(c)),
      ]),
      el('div', { class: 'cc-bd-track' }, el('i', { class: 'cc-bd-fill cc-bd-' + (PILL[k] || 'gray'), style: 'width:' + pct + '%' })),
    ]);
  }));
}

// ---- filter toolbar ----
export function toolbar(children) { return el('div', { class: 'cc-toolbar' }, children); }
export function searchBox(placeholder, onInput) {
  const input = el('input', { type: 'search', placeholder: placeholder || 'Search…', class: 'cc-search-input' });
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onInput(input.value.trim()), 280); });
  return el('div', { class: 'cc-search' }, [icon('search', 16), input]);
}
export function segmented(options, current, onPick) {
  const wrap = el('div', { class: 'cc-seg' });
  options.forEach(o => {
    const b = el('button', { class: 'cc-seg-btn' + (o.value === current ? ' active' : ''),
      onClick: () => { wrap.querySelectorAll('.cc-seg-btn.active').forEach(x => x.classList.remove('active')); b.classList.add('active'); onPick(o.value); } }, o.label);
    wrap.appendChild(b);
  });
  return wrap;
}

// ---- avatar ----
export function avatar(name, fallback) {
  return el('span', { class: 'cc-avatar' }, initials(name, fallback));
}

// ---- slide-in drawer ----
// Phones: a table with a header becomes a stack of cards. Every <td> gets data-label from its column
// header; CSS (command-center.css, .lb-stack) shows "LABEL  value" rows under 640px. Idempotent.
// cc-nav-unlock (25 Sep 2026): a link inside a popup (e.g. "carrier 360") changes the route while the
// popup is still open, so its close() never runs and html.cc-dlg-lock stayed on — the next page could not
// scroll until a refresh. On every route change: close any open popup/overlay and drop the scroll lock.
// Registered at module load, i.e. before the router's own hashchange listener, so a route that opens a
// new popup (#/carriers?id=…) still opens it after the old one is gone.
if (typeof window !== 'undefined' && !window.__ccNavUnlock) {
  window.__ccNavUnlock = true;
  window.addEventListener('hashchange', () => {
    try {
      const r = document.getElementById('cc-drawer-root');
      if (r) { if (r._lbClose) r._lbClose(true); else r.remove(); }
      document.querySelectorAll('.cc-xdlg-ovl').forEach((o) => o.remove());
    } catch (_) {}
    document.documentElement.classList.remove('cc-dlg-lock');
  });
  // 26 call sites across CC remove '#cc-drawer-root' directly (…?.remove()) instead of calling close(),
  // e.g. after Save. Watch the body: once no popup is left, the lock goes too.
  const unlockIfIdle = () => {
    const h = document.documentElement;
    if (h.classList.contains('cc-dlg-lock') && !document.getElementById('cc-drawer-root') && !document.querySelector('.cc-xdlg-ovl')) h.classList.remove('cc-dlg-lock');
  };
  const watch = () => { try { new MutationObserver(unlockIfIdle).observe(document.body, { childList: true }); } catch (_) {} };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
}

export function stackTables(scope) {
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('table').forEach((t) => {
    const ths = Array.from(t.querySelectorAll('thead th'));
    if (!ths.length) return;
    const labels = ths.map((th) => (th.textContent || '').trim());
    t.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', labels[i] || ''); });
    });
    t.classList.add('lb-stack');
  });
}

// ---- openDrawer: the ONE popup window used across the Command Center (130+ call sites) ----
// bl_ui_0439 (24 Sep 2026): was a 560px side drawer that squeezed tables into one-word columns.
// Now a centred, premium dialog on desktop and a bottom sheet on phones. Same API and the same
// ids/classes (#cc-drawer-root, #cc-drawer-body, .cc-drawer-*), so every caller keeps working.
//   opts.subtitle  — line under the title
//   opts.size      — 'sm' (confirmations, ~520px) | 'md' (default, ~880px) | 'lg' (~1120px) | 'full'
//                    'md' upgrades itself to 'lg' when a wide table (5+ columns) appears in the body.
// Esc closes, the page behind does not scroll, focus returns to where it was.
export function openDrawer(title, bodyNode, opts = {}) {
  const existing = document.getElementById('cc-drawer-root');
  if (existing) { try { existing._lbClose ? existing._lbClose(true) : existing.remove(); } catch (_) { existing.remove(); } }
  const prevFocus = document.activeElement;
  let size = ['sm', 'md', 'lg', 'full'].includes(opts.size) ? opts.size : 'md';
  let closed = false;
  let mo = null;
  const titleId = 'cc-dlg-t-' + Math.random().toString(36).slice(2, 8);
  const onKey = (e) => { if (e.key === 'Escape' && !closed) { e.stopPropagation(); close(); } };
  const close = (instant) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    try { if (mo) mo.disconnect(); } catch (_) {}
    root.classList.remove('open');
    if (!document.querySelector('.cc-xdlg-ovl')) document.documentElement.classList.remove('cc-dlg-lock');
    if (instant === true) root.remove(); else setTimeout(() => root.remove(), 200);
    try { if (instant !== true && prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (_) {}
  };
  const xBtn = el('button', { class: 'cc-drawer-x', title: 'Close (Esc)', 'aria-label': 'Close', onClick: () => close() }, icon('x', 20));
  const panel = el('div', { class: 'cc-drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1', style: 'outline:none' }, [
    el('div', { class: 'cc-dlg-grab', 'aria-hidden': 'true' }),
    el('div', { class: 'cc-drawer-head' }, [
      el('div', { style: 'min-width:0' }, [el('h3', { id: titleId }, title), opts.subtitle ? el('p', null, opts.subtitle) : '']),
      xBtn,
    ]),
    el('div', { class: 'cc-drawer-body', id: 'cc-drawer-body' }, bodyNode),
  ]);
  const root = el('div', { class: 'cc-drawer-root cc-dlg cc-dlg-' + size, id: 'cc-drawer-root' }, [
    el('div', { class: 'cc-drawer-scrim', onClick: () => close() }), panel,
  ]);
  root._lbClose = close;
  const setSize = (s) => { root.classList.remove('cc-dlg-' + size); size = s; root.classList.add('cc-dlg-' + size); };
  const wideTable = () => Array.from(panel.querySelectorAll('.cc-drawer-body table')).some(t => {
    const r = t.querySelector('tr'); return r && r.children.length >= 5;
  });
  // Tables re-render inside popups, so one observer lives as long as the popup: it upgrades 'md' to
  // 'lg' for wide tables and labels every cell so phones can show each row as a card (lb-stack).
  let pending = false;
  const tidy = () => {
    pending = false;
    if (closed) return;
    if (size === 'md' && wideTable()) setSize('lg');
    stackTables(panel);
  };
  tidy();
  if (typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(tidy); } });
    mo.observe(panel, { childList: true, subtree: true });
  }
  document.body.appendChild(root);
  document.documentElement.classList.add('cc-dlg-lock');
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => {
    root.classList.add('open');
    // Focus the first field if there is one, otherwise the close button — never leave focus behind the dialog.
    setTimeout(() => {
      try {
        const f = panel.querySelector('.cc-drawer-body input:not([type=hidden]):not([disabled]), .cc-drawer-body textarea, .cc-drawer-body select');
        if (f && !opts.noAutofocus) f.focus({ preventScroll: true }); else panel.focus({ preventScroll: true });
      } catch (_) {}
    }, 60);
  });
  return { close, body: panel.querySelector('#cc-drawer-body'), setSize };
}

// ---- card ----
export function card(children, cls) { return el('div', { class: 'lb-card ' + (cls || '') }, children); }

// ---- real LoadBoot brand logo (mark + wordmark), matches loadboot.com ----
const BRAND_MARK_SVG = '<img src="/icon-512.png" width="34" height="34" alt="LoadBoot" style="border-radius:9px;display:block">';
export const BRAND_TAGLINE = 'The Operating System for Trucking';

export function brandLogo(opts = {}) {
  const dark = !!opts.dark;
  // Official brand-kit product-family lockup: same icon, same wordmark — only the
  // descriptor changes (kit section 06). Blue = ops/dev, orange = carrier-side, slate = partners.
  const ink = dark ? '#FFFFFF' : '#0F172A';
  const FAMILY = { 'command center': '#60A5FA', 'carrier': '#FB923C', 'pocket': '#FB923C', 'driver': '#FB923C',
    'marketplace': '#FB923C', 'partner': '#94A3B8', 'developer': '#60A5FA', 'developers': '#60A5FA' };
  // Official kit crop (16 14 68 72) — never redraw or recolor the mark.
  const iconSvg = '<svg width="21" height="22" viewBox="16 14 68 72" role="img" aria-label="LoadBoot">'
    + '<path d="M16 14 H34 V68 H84 V86 H16 Z" fill="' + ink + '"></path>'
    + '<path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#F97316"></path>'
    + '<path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="' + ink + '"></path></svg>';
  const wordHtml = 'Load<span style="color:#F97316">Boot</span>';
  const textKids = [
    el('span', { html: wordHtml, style: "font-family:'Manrope',Inter,sans-serif;font-size:14px;font-weight:800;color:" + ink + ';letter-spacing:-.02em;white-space:nowrap;line-height:1' }),
  ];
  if (opts.sub) {
    // LOCKED spec (auth design, owner-approved): descriptor sits at the cap of the wordmark —
    // superscript, 12px/600, 4px gap, family color.
    const c = FAMILY[String(opts.sub).toLowerCase()] || '#94A3B8';
    textKids.push(el('span', { style: "font-family:'Manrope',Inter,sans-serif;font-size:12px;font-weight:600;color:" + c + ';white-space:nowrap;line-height:1;align-self:flex-start;margin-top:-1px' }, opts.sub));
  }
  const kids = [
    el('span', { html: iconSvg, style: 'display:block;line-height:0;flex:none' }),
    el('span', { style: 'display:inline-flex;align-items:center;gap:4px' }, textKids),
  ];
  return el('div', { class: 'cc-brandrow', style: 'display:flex;align-items:center;gap:8px' }, kids);
}

export default {
  money, fmtDate, fmtDateTime, ago, initials, sectionHead, statusPill, statCard,
  barChart, breakdownBars, toolbar, searchBox, segmented, avatar, openDrawer, card,
};

// ---- askReason / askConfirm: premium drawer-based replacements for prompt()/confirm().
// The reason text is stored AND shown to the counterparty, so a one-line browser prompt is
// the wrong control. Returns a Promise<string|null> (askReason) / Promise<boolean> (askConfirm).
export function askReason(title, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const ta = el('textarea', { class: 'cc-input', rows: String(opts.rows || 4), placeholder: opts.placeholder || 'Type the reason…' });
    if (opts.value) ta.value = opts.value;
    const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px;margin-top:4px' });
    // bl_disp_0378 — opts.reasons: [[code, label], …]. Ticked codes are machine-readable and drive
    // the re-application gate in the applicant's portal. With reasons requested the promise
    // resolves { note, reasons } instead of a bare string (still null on cancel).
    const rmap = {};
    const rbox = Array.isArray(opts.reasons) && opts.reasons.length ? el('div', { style: 'margin-bottom:10px' }, [
      el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:5px' }, opts.reasonsLabel || 'Which gaps? (the applicant must close these to re-apply)'),
      el('div', { style: 'display:flex;flex-direction:column;gap:5px' }, opts.reasons.map(([c, l]) => {
        const cb = el('input', { type: 'checkbox' }); rmap[c] = cb;
        return el('label', { style: 'display:flex;gap:7px;align-items:center;font-size:.88rem;cursor:pointer' }, [cb, l]);
      })),
    ]) : null;
    const pickedReasons = () => Object.keys(rmap).filter((c) => rmap[c].checked);
    const done = (v) => { if (settled) return; settled = true; resolve(v); try { drawer.close(); } catch (_) {} };
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: () => {
      const v = ta.value.trim();
      if (!v && !opts.optional) { err.textContent = 'A reason is required — the other side sees this.'; return; }
      if (rbox && !pickedReasons().length) { err.textContent = 'Tick at least one gap — this is what the applicant has to close.'; return; }
      done(rbox ? { note: v || null, reasons: pickedReasons() } : (v || null));
    } }, opts.submitLabel || 'Confirm');
    const cancel = el('button', { class: 'lb-btn', onClick: () => done(null) }, 'Cancel');
    const drawer = openDrawer(title, el('div', { class: 'cc-form' }, [
      opts.note ? el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, opts.note) : '',
      rbox || '',
      ta, err,
      el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [submit, cancel]),
    ]), { subtitle: opts.subtitle || 'This is recorded and shared with the counterparty', size: 'sm' });
    setTimeout(() => { try { ta.focus(); } catch (_) {} }, 60);
  });
}

export function askConfirm(title, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; resolve(v); try { drawer.close(); } catch (_) {} };
    const yes = el('button', { class: 'lb-btn lb-btn-primary', style: opts.danger ? 'background:#dc2626;border-color:#dc2626' : '', onClick: () => done(true) }, opts.confirmLabel || 'Yes, continue');
    const no = el('button', { class: 'lb-btn', onClick: () => done(false) }, 'Cancel');
    const drawer = openDrawer(title, el('div', null, [
      el('p', { style: 'margin:0 0 12px;line-height:1.6' }, opts.body || 'Are you sure?'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [yes, no]),
    ]), { subtitle: opts.subtitle || 'Confirm action', size: 'sm' });
  });
}
