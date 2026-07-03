// brokerSla.js — Broker SLA & on-time analytics (Inc 68). Staff view of each broker's fill rate, on-time
// delivery, cover speed and open exceptions — computed only from real partner_loads -> posted load -> trip
// linkage. Nothing estimated; the basis is stated on every scorecard row.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard } from '../../shared/ui/components.js';
import { brokerSlaRanking } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const RANGES = [['30', '30 days'], ['90', '90 days'], ['180', '180 days']];
const pctTone = (v) => (v == null ? 'gray' : v >= 85 ? 'green' : v >= 60 ? 'amber' : 'red');
const fmtPct = (v) => (v == null ? '—' : v + '%');

export function renderBrokerSla(host) {
  let days = 90;
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  const rangeSel = el('select', { class: 'cc-input', style: 'max-width:150px' }, RANGES.map(([v, l]) => el('option', { value: v }, l)));
  rangeSel.value = '90';
  rangeSel.onchange = () => { days = Number(rangeSel.value); load(); };

  mount(host, el('div', null, [
    sectionHead('Broker SLA', 'Fill rate, on-time delivery and cover speed per broker partner — counted from real submitted loads, their posted board loads and the resulting trips. Nothing estimated.', rangeSel),
    kpis,
    body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Computing broker SLAs…'); mount(kpis, '');
    let rows; try { rows = await brokerSlaRanking(days, 100); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    const totSub = rows.reduce((a, r) => a + (r.submitted || 0), 0);
    const totCov = rows.reduce((a, r) => a + (r.covered || 0), 0);
    const totDel = rows.reduce((a, r) => a + (r.delivered || 0), 0);
    const totOnt = rows.reduce((a, r) => a + (r.on_time || 0), 0);
    const totSched = rows.reduce((a, r) => a + (r.delivered_with_schedule || 0), 0);
    mount(kpis, [
      statCard({ icon: 'users', label: 'Active brokers', value: String(rows.length), sub: 'with loads in window', accent: 'blue' }),
      statCard({ icon: 'grid', label: 'Fill rate', value: totSub ? Math.round(1000 * totCov / totSub) / 10 + '%' : '—', sub: totCov + ' / ' + totSub + ' covered', accent: 'violet' }),
      statCard({ icon: 'truck', label: 'On-time', value: totSched ? Math.round(1000 * totOnt / totSched) / 10 + '%' : '—', sub: totOnt + ' / ' + totSched + ' scheduled', accent: 'green' }),
      statCard({ icon: 'check', label: 'Delivered', value: String(totDel), sub: 'across all brokers', accent: 'gray' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No brokers with submitted loads in this window yet.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Broker', 'Fill rate', 'On-time', 'Submitted', 'Covered', 'Delivered', 'Avg cover', 'Open exc.'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row', style: 'cursor:pointer', onClick: () => { location.hash = '#/partners'; } }, [
        el('td', null, el('b', null, r.name || '—')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + pctTone(r.fill_rate_pct) }, fmtPct(r.fill_rate_pct))),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + pctTone(r.on_time_pct) }, fmtPct(r.on_time_pct))),
        el('td', null, String(r.submitted || 0)),
        el('td', null, String(r.covered || 0)),
        el('td', null, String(r.delivered || 0)),
        el('td', null, el('span', { class: 'cc-sub' }, r.avg_hours_to_cover != null ? r.avg_hours_to_cover + 'h' : '—')),
        el('td', null, Number(r.open_exceptions || 0) > 0 ? el('b', { style: 'color:#d97706' }, String(r.open_exceptions)) : el('span', { class: 'cc-sub' }, '0')),
      ]))),
    ]));
  }
}

export default renderBrokerSla;
