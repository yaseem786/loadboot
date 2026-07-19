// automation.js — Automation Core view: operational health + open task queue.
// Reads cc_automation_health + cc_list_tasks; completes via cc_complete_task. All
// RBAC-gated server-side. Gated behind the automation_core_enabled flag (nav hidden
// when off, so production without the engine never calls these RPCs).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, card, fmtDateTime, ago } from '../../shared/ui/components.js';
import { automationHealth, listTasks, completeTask, startTask } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STATUSES = [
  { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' }, { value: '', label: 'All' },
];
const PRIO = { urgent: 'red', high: 'amber', normal: 'blue', low: 'gray' };

// What each task type MEANS and what to actually do — shown on the row so nobody guesses.
const PLAYBOOK = {
  check_call: { do: 'Call/message the driver for status + ETA; log anything unusual on the trip.', go: (t) => '#/trips' },
  driver_notify: { do: 'Confirm the driver got the dispatch sheet + rate con; resend from the trip if not.', go: (t) => '#/trips' },
  invoice_ready: { do: 'Collect the signed POD, then generate/send the carrier invoice.', go: (t) => '#/finance' },
  settlement_payout: { do: 'Verify gross − 5% math + bank details, then approve the payout.', go: (t) => '#/finance' },
  trip_exception: { do: 'Open the exception (detention/breakdown/weather), verify evidence, resolve or pay.', go: (t) => '#/exceptions' },
  onboarding_review: { do: 'Review the new carrier’s packet (MC/DOT, COI, W-9) in Onboarding & compliance.', go: (t) => t.related_type === 'carrier' ? '#/carrier?id=' + t.related_id : '#/compliance' },
  onboarding_approval: { do: 'Final gate: approve or reject the carrier’s onboarding.', go: (t) => t.related_type === 'carrier' ? '#/carrier?id=' + t.related_id : '#/compliance' },
  sales_followup: { do: 'Call/email the lead within SLA; log the activity in CRM.', go: (t) => '#/crm' },
  form_followup: { do: 'Reply to the website enquiry; convert to a lead if real.', go: (t) => '#/forms' },
  comm_followup: { do: 'Open the conversation and answer the waiting message.', go: (t) => '#/comms' },
  driver_renewal: { do: 'Driver license/medical expiring — warn the carrier and track the renewal.', go: (t) => '#/fleet-expiry' },
  doc_renewal: { do: 'Compliance document expiring — request the renewal from the account.', go: (t) => t.related_type === 'carrier' ? '#/carrier?id=' + t.related_id : '#/compliance' },
};
const RELGO = { trip: '#/trips', load: '#/loads', carrier: (id) => '#/carrier?id=' + id, form_submission: '#/forms', support_ticket: '#/support', invoice: '#/finance', settlement: '#/finance', lead: '#/crm' };
function goFor(t) {
  const pb = PLAYBOOK[t.task_type];
  if (pb && pb.go) return pb.go(t);
  const g = RELGO[t.related_type];
  return typeof g === 'function' ? g(t.related_id) : (g || null);
}


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
      el('tbody', null, rows.map(t => {
        const pb = PLAYBOOK[t.task_type] || {};
        const go = goFor(t);
        const startBtn = t.status === 'open' ? el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = '…';
          try { await startTask(t.id); toast('Task started — assigned to you · moved to In progress', 'success'); state.status = 'in_progress'; drawToolbar(); loadTasks(); loadHealth(); }
          catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = '▶ Start'; }
        } }, '▶ Start') : null;
        const doneBtn = (t.status === 'open' || t.status === 'in_progress') ? el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = '…';
          try { await completeTask(t.id); toast('Task completed', 'success'); loadTasks(); loadHealth(); }
          catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = '✓ Done'; }
        } }, '✓ Done') : null;
        return el('tr', { class: 'cc-row' }, [
          el('td', { style: 'min-width:220px;max-width:340px' }, [
            el('b', null, t.title || t.task_type),
            t.requires_approval ? el('span', { class: 'cc-chip-warn', style: 'margin-left:8px' }, 'needs approval') : '',
            t.related_label ? el('div', { class: 'cc-sub', style: 'margin-top:2px' }, '📌 ' + t.related_label) : '',
            pb.do ? el('div', { class: 'cc-sub', style: 'margin-top:2px;color:#0369a1' }, '👉 ' + pb.do) : (t.description ? el('div', { class: 'cc-sub', style: 'margin-top:2px' }, t.description) : ''),
          ]),
          el('td', null, t.task_type),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (PRIO[t.priority] || 'gray') }, t.priority)),
          el('td', null, [
            el('div', null, t.assignee_role || '—'),
            t.assignee_name ? el('div', { class: 'cc-sub' }, '👤 ' + t.assignee_name + (t.started_at ? ' · started ' + ago(t.started_at) : '')) : '',
          ]),
          el('td', null, go ? el('a', { href: go, class: 'cc-link' }, (t.related_type || 'open') + ' →') : (t.related_type || '—')),
          el('td', null, statusPill(t.status)),
          el('td', null, el('div', { style: 'display:flex;flex-direction:column;gap:6px;align-items:stretch;min-width:96px' }, [startBtn, doneBtn].filter(Boolean))),
        ]);
      })),
    ]);
    mount(listHost, table);
  }

  const tbHost = el('div');
  function drawToolbar() { mount(tbHost, toolbar([segmented(STATUSES, state.status, (v) => { state.status = v; drawToolbar(); loadTasks(); })])); }
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Automation', 'Domain events → rules → tasks & notifications. High-risk actions wait for human approval.'),
    healthHost,
    card([
      el('h3', { class: 'cc-card-title' }, 'Task queue'),
      tbHost,
      listHost,
    ], 'cc-pad'),
  ]));
  drawToolbar();
  loadHealth();
  loadTasks();
}

export default renderAutomation;
