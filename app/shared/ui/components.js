// components.js — premium UI building blocks shared by Command Center views.
// All code-defined; values from data are inserted as text nodes (XSS-safe).
import { el } from './dom.js';
import { icon } from './icons.js';

// ---- formatting ----
export function money(n, dp = 0) {
  const v = Number(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (_) { return String(ts); }
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
export function openDrawer(title, bodyNode, opts = {}) {
  const existing = document.getElementById('cc-drawer-root');
  if (existing) existing.remove();
  const close = () => { root.classList.remove('open'); setTimeout(() => root.remove(), 220); };
  const panel = el('div', { class: 'cc-drawer-panel' }, [
    el('div', { class: 'cc-drawer-head' }, [
      el('div', null, [el('h3', null, title), opts.subtitle ? el('p', null, opts.subtitle) : '']),
      el('button', { class: 'cc-drawer-x', title: 'Close', onClick: close }, icon('x', 20)),
    ]),
    el('div', { class: 'cc-drawer-body', id: 'cc-drawer-body' }, bodyNode),
  ]);
  const root = el('div', { class: 'cc-drawer-root', id: 'cc-drawer-root' }, [
    el('div', { class: 'cc-drawer-scrim', onClick: close }), panel,
  ]);
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('open'));
  return { close, body: panel.querySelector('#cc-drawer-body') };
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
  const FAMILY = { 'command center': '#60A5FA', 'carrier': '#FB923C', 'pocket': '#FB923C',
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
