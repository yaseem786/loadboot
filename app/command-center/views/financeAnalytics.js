// financeAnalytics.js — Finance Analytics. Real charts over the dispatch-fee ledger:
// monthly gross + fee + collected series, AR aging buckets, invoice-status mix, and
// top carriers by fee. All data comes from the staff-gated cc_finance_analytics RPC
// (SECURITY DEFINER, finance.view) — aggregated server-side, never mixed with anything else.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, money } from '../../shared/ui/components.js';
import { financeAnalytics } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const C = { gross: '#93c5fd', fee: '#0883F7', paid: '#16a34a', amber: '#f59e0b', red: '#dc2626', gray: '#94a3b8', violet: '#7c3aed' };

// grouped bar chart: months × [gross, fee] with a "collected" overlay marker.
function monthlyChart(months) {
  const data = months || [];
  if (!data.length) return el('div', { class: 'fa-empty' }, 'No invoices in the last 12 months yet.');
  const W = 720, H = 220, padB = 26, padL = 44, padT = 10;
  const max = Math.max(1, ...data.map(m => Math.max(Number(m.gross) || 0, Number(m.fee) || 0)));
  const n = data.length, slot = (W - padL) / n, bw = Math.min(26, slot * 0.34);
  const y = (v) => padT + (H - padT - padB) * (1 - (Number(v) || 0) / max);
  let g = '';
  // gridlines + y labels (0, half, max)
  [0, 0.5, 1].forEach(t => { const yy = padT + (H - padT - padB) * (1 - t); g += '<line x1="' + padL + '" y1="' + yy + '" x2="' + W + '" y2="' + yy + '" stroke="#eef2f8"/><text x="' + (padL - 6) + '" y="' + (yy + 3) + '" text-anchor="end" font-size="9" fill="#94a3b8">' + Math.round(max * t).toLocaleString() + '</text>'; });
  data.forEach((m, i) => {
    const cx = padL + slot * i + slot / 2;
    const gx = cx - bw - 1, fx = cx + 1;
    g += '<rect x="' + gx.toFixed(1) + '" y="' + y(m.gross).toFixed(1) + '" width="' + bw + '" height="' + (H - padB - y(m.gross)).toFixed(1) + '" rx="2" fill="' + C.gross + '"/>';
    g += '<rect x="' + fx.toFixed(1) + '" y="' + y(m.fee).toFixed(1) + '" width="' + bw + '" height="' + (H - padB - y(m.fee)).toFixed(1) + '" rx="2" fill="' + C.fee + '"/>';
    g += '<text x="' + cx + '" y="' + (H - padB + 14) + '" text-anchor="middle" font-size="9" fill="#64748b">' + (m.label || '') + '</text>';
  });
  return el('div', { class: 'fa-chart', html: '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet">' + g + '</svg>' });
}

function donut(parts) {
  const total = parts.reduce((a, p) => a + (Number(p.value) || 0), 0) || 1;
  let acc = 0; const R = 15.5, CIRC = 2 * Math.PI * R; let segs = '';
  parts.forEach(p => { const len = (Number(p.value) || 0) / total * CIRC; segs += '<circle r="' + R + '" cx="21" cy="21" fill="none" stroke="' + p.color + '" stroke-width="7" stroke-dasharray="' + len.toFixed(2) + ' ' + (CIRC - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 21 21)"/>'; acc += len; });
  return el('div', { class: 'fa-donut', html: '<svg viewBox="0 0 42 42" width="120" height="120">' + segs + '<text x="21" y="22" text-anchor="middle" font-size="6" font-weight="700" fill="#0b1220">' + total + '</text><text x="21" y="27" text-anchor="middle" font-size="3" fill="#94a3b8">invoices</text></svg>' });
}

// horizontal ranked bars: [{label, value}]
function rankedBars(rows, fmt) {
  if (!rows || !rows.length) return el('div', { class: 'fa-empty' }, 'No data yet.');
  const max = Math.max(1, ...rows.map(r => Number(r.value) || 0));
  return el('div', { class: 'fa-ranks' }, rows.map(r => el('div', { class: 'fa-rank' }, [
    el('div', { class: 'fa-rank-l' }, r.label),
    el('div', { class: 'fa-rank-bar' }, el('div', { class: 'fa-rank-fill', style: 'width:' + Math.max(3, (Number(r.value) || 0) / max * 100) + '%' })),
    el('div', { class: 'fa-rank-v' }, fmt ? fmt(r.value) : String(r.value)),
  ])));
}

function legend(items) {
  return el('div', { class: 'fa-legend' }, items.map(it => el('span', null, [el('i', { style: 'background:' + it.color }), it.label])));
}

export function renderFinanceAnalytics(host) {
  const head = sectionHead('Finance Analytics', 'Revenue, dispatch fees, AR aging, invoice mix and top carriers — straight from the fee ledger.');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div');
  mount(host, el('div', null, [head, kpis, body]));
  load();

  async function load() {
    showLoading(body, 'Crunching the numbers…');
    let d; try { d = await financeAnalytics(); } catch (e) { showError(body, humanizeError(e), load); return; }
    d = d || {};
    const t = d.totals || {}, aging = d.aging || {}, sc = d.status_counts || {};
    mount(kpis, [
      statCard({ icon: 'doc', label: 'Gross hauled', value: money(t.gross_total), sub: (t.invoices || 0) + ' invoices', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Fees collected', value: money(t.paid_fee), sub: 'paid', accent: 'green' }),
      statCard({ icon: 'list', label: 'Outstanding fees', value: money(t.outstanding_fee), sub: money(aging.d60p) + ' over 60d', accent: (Number(aging.d60p) || 0) > 0 ? 'red' : 'amber' }),
      statCard({ icon: 'trend', label: 'Collection rate', value: pct(t.paid_fee, (Number(t.paid_fee) || 0) + (Number(t.outstanding_fee) || 0)), sub: 'fees paid vs billed', accent: 'violet' }),
    ]);

    const statusParts = [
      { label: 'Paid', value: sc.paid || 0, color: C.paid },
      { label: 'Sent', value: sc.sent || 0, color: C.amber },
      { label: 'Draft', value: sc.draft || 0, color: C.gray },
      { label: 'Void', value: sc.void || 0, color: C.red },
    ].filter(p => p.value > 0);
    const agingRows = [
      { label: 'Current', value: Number(aging.current) || 0 },
      { label: '1–30 days', value: Number(aging.d1_30) || 0 },
      { label: '31–60 days', value: Number(aging.d31_60) || 0 },
      { label: '60+ days', value: Number(aging.d60p) || 0 },
    ];
    const carriers = (d.top_carriers || []).map(c => ({ label: c.carrier, value: Number(c.fee) || 0 }));

    mount(body, el('div', { class: 'fa-grid' }, [
      el('div', { class: 'lb-card fa-col2' }, [
        cardHead('Gross & dispatch fees', 'Last 12 months'),
        monthlyChart(d.monthly),
        legend([{ label: 'Gross hauled', color: C.gross }, { label: 'Dispatch fee (5%)', color: C.fee }]),
      ]),
      el('div', { class: 'lb-card' }, [
        cardHead('Invoice status'),
        statusParts.length ? el('div', { class: 'fa-donut-wrap' }, [donut(statusParts), legend(statusParts.map(p => ({ label: p.label + ' · ' + p.value, color: p.color })))]) : el('div', { class: 'fa-empty' }, 'No invoices yet.'),
      ]),
      el('div', { class: 'lb-card' }, [
        cardHead('AR aging', 'Outstanding fees by age'),
        rankedBars(agingRows, money),
      ]),
      el('div', { class: 'lb-card fa-col2' }, [
        cardHead('Top carriers by fee', 'Lifetime dispatch fees'),
        rankedBars(carriers, money),
      ]),
    ]));
  }

  function cardHead(title, sub) { return el('div', { class: 'fa-cardhead' }, [el('h3', null, title), sub ? el('span', null, sub) : '']); }
  function pct(a, b) { a = Number(a) || 0; b = Number(b) || 0; return b > 0 ? Math.round(a / b * 100) + '%' : '—'; }
}

export default renderFinanceAnalytics;
