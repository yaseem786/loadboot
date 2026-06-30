// automation.js — Automation Core view: operational health + open task queue.
// Reads cc_automation_health + cc_list_tasks; completes via cc_complete_task. All
// RBAC-gated server-side. Gated behind the automation_core_enabled flag (nav hidden
// when off, so production without the engine never calls these RPCs).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, card, fmtDateTime } from '../../shared/ui/components.js';
import { automationHealth, listTasks, completeTask } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STATUSES = [
  { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' }, { value: '', label: 'All' },
];
const PRIO = { urgent: 'red', high: 'amber', normal: 'blue', low: 'gray' };

export function renderAutomation(host) {
  let state = { status: 'open' };
  const healthHost = el('div');
  const listHost = el('div', { class: 'cc-table-wrap' });

  async function loadHealth() {
    let h;
    try { h = await automationHealth(); } catch (e) { mount(healthHost, ''); return; }
    const n = (k) => Number((h && h[k]) || 0);
    mount(healthHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Open tasks', value: String(n('tasks_open')), sub: n('tasks_awaiting_approval') + ' need approval', accent: 'blue' }),
      statCard({ icon: 'flag', label: 'Rules enabled', value: String(n('rules_enabled')), sub: 'active automations', accent: 'green' }),
      statCard({ icon: 'bell', label: 'Notifications queued', value: String(n('notifications_queued')), sub: 'pending delivery', accent: 'violet' }),
      statCard({ icon: 'shield', label: 'Events', value: String(n('events_pending')), sub: n('events_failed') + ' failed · ' + n('events_dead') + ' dead-letter', accent: n('events_dead') > 0 ? 'amber' : 'green' }),
    ]));
  }

  async function loadTasks() {
    showLoading(listHost, 'Loading tasks…');
    let rows;
    try { rows = await listTasks({ status: state.status || null, limit: 200 }); }
    catch (e) { showError(listHost, humanizeError(e), loadTasks); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No tasks in this queue.'); return; }
    const table = el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [
        el('th', null, 'Task'), el('th', null, 'Type'), el('th', null, 'Priority'),
        el('th', null, 'Assignee role'), el('th', null, 'Related'), el('th', null, 'Status'), el('th', null, ''),
      ])),
      el('tbody', null, rows.map(t => el('tr', { class: 'cc-row' }, [
        el('td', null, [el('b', null, t.title || t.task_type), t.requires_approval ? el('span', { class: 'cc-chip-warn', style: 'margin-left:8px' }, 'needs approval') : '']),
        el('td', null, t.task_type),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (PRIO[t.priority] || 'gray') }, t.priority)),
        el('td', null, t.assignee_role || '—'),
        el('td', null, t.related_type ? (t.related_type) : '—'),
        el('td', null, statusPill(t.status)),
        el('td', null, t.status === 'open' || t.status === 'in_progress'
          ? el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
              const b = ev.currentTarget; b.disabled = true; b.textContent = '…';
              try { await completeTask(t.id); toast('Task completed', 'success'); loadTasks(); loadHealth(); }
              catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = 'Complete'; }
            } }, 'Complete')
          : ''),
      ]))),
    ]);
    mount(listHost, table);
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Automation', 'Domain events → rules → tasks & notifications. High-risk actions wait for human approval.'),
    healthHost,
    card([
      el('h3', { class: 'cc-card-title' }, 'Task queue'),
      toolbar([segmented(STATUSES, state.status, (v) => { state.status = v; loadTasks(); })]),
      listHost,
    ], 'cc-pad'),
  ]));
  loadHealth();
  loadTasks();
}

export default renderAutomation;
