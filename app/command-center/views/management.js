// management.js — Enterprise Completion: Management dashboard. Executive summary across the
// whole operation, lane rate history, and a system-health strip. Read-only via
// cc_management_dashboard / cc_lane_history / cc_system_health (staff-gated).
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, money } from '../../shared/ui/components.js';
import { managementDashboard, laneHistory, systemHealth } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

export function renderManagement(host) {
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Management', 'Executive summary, lane rate history and live system health.'),
    el('div', { id: 'mg-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const body = host.querySelector('#mg-body');
  load();

  async function load() {
    let m, lanes, health;
    try { [m, lanes, health] = await Promise.all([managementDashboard(), laneHistory(12), systemHealth().catch(() => null)]); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const n = (k) => Number((m && m[k]) || 0);

    const attention = n('open_exceptions') + n('settlements_pending') + n('open_disputes');
    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'doc', label: 'Revenue collected', value: money(n('revenue_collected')), sub: money(n('revenue_outstanding')) + ' outstanding', accent: 'green', to: '#/finance' }),
      statCard({ icon: 'truck', label: 'Active trips', value: String(n('active_trips')), sub: n('delivered_30d') + ' delivered/30d', accent: 'blue', to: '#/trips' }),
      statCard({ icon: 'users', label: 'Carriers compliant', value: n('carriers_compliant') + '/' + n('carriers_active'), sub: 'onboarded & valid', accent: 'violet', to: '#/compliance' }),
      statCard({ icon: 'flag', label: 'Needs attention', value: String(attention), sub: 'exceptions/payouts/disputes', accent: attention ? 'amber' : 'green', to: '#/radar' }),
    ]);

    const healthCard = health ? card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'System health'), el('span', { class: 'cc-pill cc-pill-' + (health.status === 'healthy' ? 'green' : health.status === 'degraded' ? 'amber' : 'red') }, health.status)]),
      el('div', { class: 'cc-fields' }, [
        field('Automation queue', (health.automation && health.automation.events_pending) + ' pending · ' + (health.automation && health.automation.events_dead) + ' dead'),
        field('Open tasks', String(health.automation && health.automation.tasks_open)),
        field('Rules enabled', String(health.automation && health.automation.rules_enabled)),
        field('Scheduled jobs', Array.isArray(health.scheduled_jobs) ? health.scheduled_jobs.map(j => j.job + ' (' + j.last_status + ')').join(', ') : '—'),
      ]),
    ]) : '';

    const laneCard = card([
      el('h4', { class: 'cc-card-title' }, 'Lane rate history'),
      (lanes && lanes.length) ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Lane'), el('th', null, 'Loads'), el('th', null, 'Avg rate'), el('th', null, 'Min'), el('th', null, 'Max'), el('th', null, 'Avg RPM')])),
        el('tbody', null, lanes.map(l => el('tr', null, [
          el('td', null, el('b', null, l.lane)),
          el('td', null, String(l.loads)),
          el('td', null, money(l.avg_rate)),
          el('td', null, money(l.min_rate)),
          el('td', null, money(l.max_rate)),
          el('td', null, l.avg_rpm != null ? '$' + l.avg_rpm : '—'),
        ]))),
      ]) : el('div', { class: 'cc-sub' }, 'No lane history yet — it builds as loads flow through.'),
    ]);

    mount(body, el('div', null, [kpis, el('div', { style: 'margin-top:16px' }, healthCard), el('div', { style: 'margin-top:16px' }, laneCard)]));
  }
  function field(k, v) { return el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v || '—')]); }
}

export default renderManagement;
