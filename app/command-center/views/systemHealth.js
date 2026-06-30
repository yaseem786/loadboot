// systemHealth.js — Observability & System Health (Phase 1). Surfaces the live
// platform signals from cc_system_health: event-outbox health, automation tasks,
// notification delivery, scheduled (pg_cron) jobs and security events, with an
// overall status. Staff-gated server-side.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime } from '../../shared/ui/components.js';
import { systemHealth } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const STATUS = { healthy: { tone: 'green', label: 'All systems healthy' }, degraded: { tone: 'amber', label: 'Degraded — failed events present' }, attention: { tone: 'red', label: 'Attention — dead-lettered events' } };

export function renderSystemHealth(host) {
  const banner = el('div');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div');
  mount(host, el('div', null, [
    sectionHead('System Health', 'Live platform observability — event outbox, automation, notifications, scheduled jobs and security. A failure in a non-critical lane never blocks dispatch.'),
    banner, kpis, body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Checking health…');
    let d; try { d = await systemHealth(); } catch (e) { showError(body, humanizeError(e), load); return; }
    d = d || {};
    const a = d.automation || {}, n = d.notifications || {}, s = d.security || {};
    const st = STATUS[d.status] || { tone: 'gray', label: d.status || 'unknown' };
    mount(banner, el('div', { class: 'fa-cardhead', style: 'margin:4px 0 14px' }, [
      el('div', null, [el('span', { class: 'cc-pill cc-pill-' + st.tone, style: 'font-size:.85rem;padding:6px 12px' }, st.label)]),
      el('span', null, d.checked_at ? 'Checked ' + fmtDateTime(d.checked_at) : ''),
    ]));
    mount(kpis, [
      statCard({ icon: 'refresh', label: 'Events pending', value: String(a.events_pending || 0), sub: (a.events_failed || 0) + ' failed · ' + (a.events_dead || 0) + ' dead', accent: (a.events_dead || 0) > 0 ? 'red' : (a.events_failed || 0) > 0 ? 'amber' : 'green' }),
      statCard({ icon: 'bell', label: 'Notifications queued', value: String(n.queued || 0), sub: (n.sent || 0) + ' sent · ' + (n.failed || 0) + ' failed', accent: (n.failed || 0) > 0 ? 'amber' : 'blue' }),
      statCard({ icon: 'list', label: 'Open tasks', value: String(a.tasks_open || 0), sub: (a.tasks_escalated || 0) + ' escalated · ' + (a.tasks_awaiting_approval || 0) + ' awaiting approval', accent: (a.tasks_escalated || 0) > 0 ? 'amber' : 'violet' }),
      statCard({ icon: 'shield', label: 'Security events (24h)', value: String(s.events_24h || 0), sub: (s.events_total || 0) + ' all time', accent: (s.events_24h || 0) > 0 ? 'amber' : 'green' }),
    ]);
    const jobs = Array.isArray(d.scheduled_jobs) ? d.scheduled_jobs : [];
    mount(body, el('div', { class: 'cc-table-wrap', style: 'margin-top:16px' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Scheduled jobs (pg_cron)'), el('span', null, jobs.length + ' jobs')]),
      jobs.length ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Job', 'Schedule', 'Active', 'Last status', 'Last run'].map(h => el('th', null, h)))),
        el('tbody', null, jobs.map(j => el('tr', { class: 'cc-row' }, [
          el('td', null, el('b', null, j.job)),
          el('td', null, j.schedule || '—'),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (j.active ? 'green' : 'gray') }, j.active ? 'on' : 'off')),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (j.last_status === 'succeeded' ? 'green' : j.last_status === 'failed' ? 'red' : 'gray') }, j.last_status || 'never')),
          el('td', null, j.last_run ? fmtDateTime(j.last_run) : '—'),
        ]))),
      ]) : el('div', { class: 'lb-state' }, 'No scheduled-job history available.'),
      el('div', { style: 'margin-top:14px;text-align:right' }, el('button', { class: 'lb-btn lb-btn-sm', onClick: load }, 'Refresh')),
    ]));
  }
}

export default renderSystemHealth;
