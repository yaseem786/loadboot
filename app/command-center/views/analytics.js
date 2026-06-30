// analytics.js — Wave 6 Analytics. Operational dashboards over the live modules: headline
// KPIs, dispatch-fee revenue trend, loads/trips breakdowns, on-time rate, top carriers.
// All data via read-only cc_analytics_* RPCs (analytics.view), RBAC-gated + audited.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, barChart, breakdownBars, card, money } from '../../shared/ui/components.js';
import { analyticsOverview, analyticsRevenue, analyticsOps, analyticsCarriers } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

export function renderAnalytics(host) {
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Analytics', 'Live operational performance across dispatch, finance, sales and compliance.'),
    el('div', { id: 'an-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading analytics…')),
  ]));
  const body = host.querySelector('#an-body');
  load();

  async function load() {
    let ov, rev, ops, carriers;
    try { [ov, rev, ops, carriers] = await Promise.all([analyticsOverview(), analyticsRevenue(14), analyticsOps(), analyticsCarriers(8)]); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const n = (k) => Number((ov && ov[k]) || 0);

    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'doc', label: 'Revenue collected', value: money(n('revenue_collected')), sub: money(n('revenue_outstanding')) + ' outstanding', accent: 'green' }),
      statCard({ icon: 'trend', label: 'Gross booked', value: money(n('gross_booked')), sub: 'across invoiced loads', accent: 'violet' }),
      statCard({ icon: 'truck', label: 'Trips delivered', value: String(n('trips_delivered')), sub: n('trips_active') + ' active', accent: 'blue' }),
      statCard({ icon: 'users', label: 'Active carriers', value: String(n('carriers_active')), sub: n('compliance_approved') + ' onboarded', accent: 'amber' }),
    ]);

    const revSeries = (rev || []).map(r => ({ c: Number(r.fee) || 0 }));
    const revTotal = (rev || []).reduce((a, r) => a + (Number(r.fee) || 0), 0);
    const revenueCard = card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Dispatch-fee revenue · last 14 days'), el('b', null, money(revTotal))]),
      barChart(revSeries, { height: 70 }),
    ]);

    const otp = ops && ops.on_time_pct != null ? ops.on_time_pct + '%' : '—';
    const opsCard = card([
      el('h4', { class: 'cc-card-title' }, 'Loads by status'),
      breakdownBars((ops && ops.loads_by_status) || {}),
      el('div', { class: 'cc-card-head', style: 'margin-top:14px' }, [el('h4', { class: 'cc-card-title' }, 'Trips by status'), el('span', { class: 'cc-sub' }, 'On-time ' + otp + ' (' + ((ops && ops.on_time_n) || 0) + ')')]),
      breakdownBars((ops && ops.trips_by_status) || {}),
    ]);

    const rows = (carriers || []).filter(c => (c.trips || 0) > 0 || (Number(c.revenue) || 0) > 0);
    const carriersCard = card([
      el('h4', { class: 'cc-card-title' }, 'Top carriers'),
      rows.length ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Carrier'), el('th', null, 'Trips'), el('th', null, 'Fee revenue')])),
        el('tbody', null, rows.map(c => el('tr', null, [
          el('td', null, el('b', null, c.carrier)),
          el('td', null, String(c.trips || 0)),
          el('td', null, money(c.revenue || 0)),
        ]))),
      ]) : el('div', { class: 'cc-sub' }, 'No carrier activity yet.'),
    ]);

    mount(body, el('div', null, [
      kpis,
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [revenueCard, opsCard]),
      el('div', { style: 'margin-top:16px' }, carriersCard),
    ]));
  }
}

export default renderAnalytics;
