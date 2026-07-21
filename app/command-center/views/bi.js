// bi.js — Business Intelligence (Inc 64). One staff-only executive summary + trend series, computed entirely
// from real rows by cc_bi_executive_summary / cc_bi_timeseries. Every figure is counted (never estimated);
// on-time % explicitly states its basis. CSV export flattens the summary for offline analysis.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, barChart } from '../../shared/ui/components.js';
import { biExecutiveSummary, biTimeseries, reportsList, reportSave, reportDelete, reportRun, reportSnapshots } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (num, den) => (den > 0 ? Math.round(1000 * num / den) / 10 : 0);
const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
const METRICS = [['loads_created', 'Loads created'], ['trips_delivered', 'Trips delivered'], ['fee_collected', 'Fee collected ($)'], ['offers_sent', 'Offers sent']];

export function renderBI(host) {
  let days = 30;
  let metric = 'loads_created';
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div');
  const chartHost = el('div', { class: 'lb-card', style: 'margin-top:14px' });
  const savedHost = el('div', { class: 'lb-card', style: 'margin-top:14px' });

  const rangeSel = el('select', { class: 'cc-input', style: 'max-width:150px' }, RANGES.map(([v, l]) => el('option', { value: v }, l)));
  rangeSel.value = '30';
  rangeSel.onchange = () => { days = Number(rangeSel.value); load(); };
  let lastSummary = null;
  const exportBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { if (lastSummary) exportCsv(lastSummary); } }, '⬇ Export CSV');

  mount(host, el('div', null, [
    sectionHead('Business Intelligence', 'Executive summary across dispatch, revenue, delivery and growth — every number counted from live records, nothing estimated.',
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [rangeSel, exportBtn])),
    kpis,
    body,
    chartHost,
    savedHost,
  ]));
  load();
  loadChart();
  loadSaved();

  async function load() {
    showLoading(kpis, 'Loading…'); mount(body, '');
    let s;
    try {
      const to = new Date(); const from = new Date(); from.setDate(to.getDate() - (days - 1));
      s = await biExecutiveSummary(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    } catch (e) { showError(kpis, humanizeError(e), load); return; }
    lastSummary = s;
    const rev = s.revenue || {}, tr = s.trips || {}, of = s.offers || {}, ld = s.loads || {}, ex = s.exceptions || {}, ca = s.carriers || {}, dl = s.delivery || {}, rf = s.referrals || {};
    const onTime = pct(tr.on_time_delivered || 0, tr.with_schedule || 0);
    mount(kpis, [
      statCard({ icon: 'dollar', label: 'Fee collected', value: money(rev.fee_collected), sub: 'in window · paid', accent: 'green' }),
      statCard({ icon: 'truck', label: 'Trips delivered', value: String(tr.delivered_in_window || 0), sub: onTime + '% on time', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Offer acceptance', value: (of.acceptance_rate || 0) + '%', sub: (of.accepted_in_window || 0) + ' / ' + (of.sent_in_window || 0) + ' offers', accent: 'violet' }),
      statCard({ icon: 'users', label: 'Active carriers', value: String(ca.active || 0), sub: (ca.onboarding_pending || 0) + ' onboarding', accent: 'blue' }),
      statCard({ icon: 'grid', label: 'Loads on board', value: String(ld.on_public_board || 0), sub: (ld.created_in_window || 0) + ' created in window', accent: 'gray' }),
      statCard({ icon: 'alert', label: 'Open exceptions', value: String(ex.open_now || 0), sub: (ex.opened_in_window || 0) + ' opened in window', accent: 'amber' }),
    ]);

    const panel = (title, rows, note) => el('div', { class: 'lb-card', style: 'flex:1;min-width:230px' }, [
      el('h3', { style: 'margin:0 0 8px;font-size:1rem' }, title),
      ...rows.map(([k, v]) => el('div', { style: 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eef2f7' }, [el('span', { class: 'cc-sub' }, k), el('b', null, v)])),
      note ? el('div', { class: 'cc-sub', style: 'margin-top:6px;font-style:italic' }, note) : null,
    ].filter(Boolean));

    mount(body, el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;margin-top:14px' }, [
      panel('Revenue', [
        ['Fee collected', money(rev.fee_collected)],
        ['Fee outstanding', money(rev.fee_outstanding)],
        ['Invoices paid', String(rev.invoices_paid_in_window || 0)],
        ['Invoices open', String(rev.invoices_open || 0)],
      ], rev.basis),
      panel('Delivery (comms)', [
        ['Messages sent', String(dl.sent_in_window || 0)],
        ['Delivered', String(dl.delivered_in_window || 0)],
        ['Failed / bounced', String(dl.failed_or_bounced || 0)],
      ]),
      panel('Growth', [
        ['Referrers', String(rf.referrers || 0)],
        ['Referral payable', money(rf.payable)],
        ['Referral paid', money(rf.paid)],
      ]),
      panel('Trips', [
        ['Active now', String(tr.active || 0)],
        ['Delivered (window)', String(tr.delivered_in_window || 0)],
        ['On-time', onTime + '%'],
      ], tr.basis),
    ]));
  }

  async function loadChart() {
    const metSel = el('select', { class: 'cc-input', style: 'max-width:200px' }, METRICS.map(([v, l]) => el('option', { value: v }, l)));
    metSel.value = metric;
    metSel.onchange = () => { metric = metSel.value; drawChart(); };
    const chartBody = el('div', { style: 'margin-top:10px' }, el('div', { class: 'cc-sub' }, 'Loading trend…'));
    mount(chartHost, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px' }, [
        el('h3', { style: 'margin:0;font-size:1rem' }, 'Daily trend'), metSel]),
      chartBody,
    ]);
    async function drawChart() {
      mount(chartBody, el('div', { class: 'cc-sub' }, 'Loading trend…'));
      let rows; try { rows = await biTimeseries(metric, days); } catch (e) { mount(chartBody, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
      rows = rows || [];
      const series = rows.map(r => ({ c: Number(r.value) || 0 }));
      const total = series.reduce((a, p) => a + p.c, 0);
      mount(chartBody, el('div', null, [
        barChart(series, { height: 70 }),
        el('div', { class: 'cc-sub', style: 'margin-top:6px' }, (METRICS.find(m => m[0] === metric) || [, metric])[1] + ' · last ' + days + ' days · total ' + (metric === 'fee_collected' ? money(total) : total.toLocaleString())),
      ]));
    }
    drawChart();
  }

  function exportCsv(s) {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['section', 'metric', 'value'].join(',')];
    Object.entries(s).forEach(([section, obj]) => {
      if (obj && typeof obj === 'object') {
        Object.entries(obj).forEach(([k, v]) => { if (k !== 'basis') lines.push([section, k, v].map(esc).join(',')); });
      }
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'loadboot-bi-summary-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function loadSaved() {
    const listEl = el('div', { style: 'margin-top:10px' }, el('div', { class: 'cc-sub' }, 'Loading…'));
    const nameIn = el('input', { class: 'cc-input', style: 'max-width:220px', placeholder: 'Save current view as…' });
    const saveBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => {
      const name = nameIn.value.trim();
      if (!name) { toast('Give the report a name first', 'info'); return; }
      saveBtn.disabled = true;
      try { await reportSave({ name, metric, days }); nameIn.value = ''; toast('Saved report', 'success'); refresh(); }
      catch (e) { toast(humanizeError(e), 'error'); }
      saveBtn.disabled = false;
    } }, '＋ Save');
    mount(savedHost, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px' }, [
        el('h3', { style: 'margin:0;font-size:1rem' }, 'Saved reports'),
        el('div', { style: 'display:flex;gap:8px;align-items:center' }, [nameIn, saveBtn]),
      ]),
      el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Saves the current metric + window. Running a report captures a dated snapshot you can keep for digests and history. Reports are private to you.'),
      listEl,
    ]);
    refresh();

    async function refresh() {
      mount(listEl, el('div', { class: 'cc-sub' }, 'Loading…'));
      let rows; try { rows = await reportsList(); } catch (e) { mount(listEl, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
      rows = rows || [];
      if (!rows.length) { mount(listEl, el('div', { class: 'lb-state' }, 'No saved reports yet.')); return; }
      mount(listEl, el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Name', 'Metric', 'Window', 'Snapshots', 'Last run', ''].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
          el('td', null, el('b', null, r.name)),
          el('td', null, (METRICS.find(m => m[0] === r.metric) || [, r.metric])[1]),
          el('td', null, r.days + 'd'),
          el('td', null, String(r.snapshots || 0)),
          el('td', null, el('span', { class: 'cc-sub' }, r.last_run ? new Date(r.last_run).toLocaleString() : '—')),
          el('td', null, el('div', { style: 'display:flex;gap:6px' }, [
            el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
              const _btn9 = ev.currentTarget;
              _btn9.disabled = true;
              try { await reportRun(r.id); toast('Snapshot captured', 'success'); refresh(); }
              catch (e) { toast(humanizeError(e), 'error'); if (_btn9) _btn9.disabled = false; }
            } }, 'Run'),
            el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async () => {
              if (!confirm('Delete report "' + r.name + '" and its snapshots?')) return;
              try { await reportDelete(r.id); toast('Deleted', 'success'); refresh(); }
              catch (e) { toast(humanizeError(e), 'error'); }
            } }, 'Delete'),
          ])),
        ]))),
      ]));
    }
  }
}

export default renderBI;
