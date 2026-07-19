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
  ticket_followup: { do: 'Open the new support ticket, triage priority, and send the first reply.', go: (t) => '#/support' },
  partner_review: { do: 'Verify the broker’s authority + $75k bond (or shipper’s facility details), then activate in Partner Intake.', go: (t) => '#/partner-intake' },
  agent_review: { do: 'Check government ID, payout-account proof and W-9/W-8BEN, then approve — activates the 1% chain.', go: (t) => '#/agents' },
  load_post_review: { do: 'Sanity-check the rate card, pins and schedule, then post the load to the board.', go: (t) => '#/partner-intake' },
  noa_verify: { do: 'Verify the factoring company + NOA letter and set the pay-to routing before the next settlement.', go: (t) => t.related_type === 'carrier' ? '#/carrier?id=' + t.related_id : '#/finance' },
  pod_missing: { do: 'Delivered 24h ago, no POD — call/notify the carrier; the invoice packet is blocked until it lands.', go: (t) => '#/pod-review' },
  invoice_overdue: { do: 'Pay-by date passed — send the reminder, check the pay rail, escalate per collections policy.', go: (t) => '#/finance' },
  tracking_blackout: { do: 'No GPS ping 30+ min on an active trip — call the driver, verify the feed, log the reason.', go: (t) => '#/control-tower' },
  emergency_sla: { do: 'Driver filed an EMERGENCY — verify it, decide the reschedule (no TONU if verified), respond within 2 hours.', go: (t) => '#/safety-desk' },
  claim_decision_stale: { do: 'Claim has GPS evidence but no payer decision in 24h — nudge the payer or escalate.', go: (t) => '#/exceptions' },
  offers_all_expired: { do: 'Every direct offer expired unaccepted — widen the carrier set or reprice, then re-offer.', go: (t) => '#/loads' },
  bank_details_verify: { do: 'Carrier changed payout bank — verify ownership before the next settlement (fraud gate).', go: (t) => t.related_type === 'carrier' ? '#/carrier?id=' + t.related_id : '#/finance' },
  trip_overdue: { do: 'URGENT: trip is past its appointment — call the driver, warn the receiver, and log the reason.', go: (t) => '#/trips' },
  driver_renewal: { do: 'Driver license/medical expiring — warn the carrier and track the renewal.', go: (t) => '#/fleet-expiry' },
  doc_renewal: { do: 'Compliance document expiring — request the renewal from the account.', go: (t) => t.related_type === 'carrier' ? '#/carrier?id=' + t.related_id : '#/compliance' },
};
const RELGO = { trip: (id) => '#/trips?id=' + id, load: (id) => '#/loads?id=' + id, carrier: (id) => '#/carrier?id=' + id, partner: '#/partners', agent: '#/agents', form_submission: (id) => '#/forms?id=' + id, support_ticket: (id) => '#/support?id=' + id, invoice: (id) => '#/finance?id=' + id, settlement: '#/finance', lead: '#/crm' };
function goFor(t) {
  // EXACT record first (deep link), playbook screen as fallback
  const g = t.related_id ? RELGO[t.related_type] : null;
  const exact = typeof g === 'function' ? g(t.related_id) : g;
  if (exact) return exact;
  const pb = PLAYBOOK[t.task_type];
  return (pb && pb.go) ? pb.go(t) : null;
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
