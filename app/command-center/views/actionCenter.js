// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// actionCenter.js — Control Tower Wave I: the personalized Action Center home.
// Instead of a generic dashboard, this surfaces "what needs YOU now" — a single
// priority-ranked queue across tasks, tickets, forms, documents, exceptions and
// settlements, each item one click from the record. Read-only via cc_action_center.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, ago, fmtDateTime } from '../../shared/ui/components.js';
import { actionCenter } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { goFor, liveLine } from './automation.js';   // bl_ops_0489: one deep-link map + live line for tasks

const KIND_META = {
  task: { tone: 'blue', label: 'Task' },
  ticket: { tone: 'amber', label: 'Ticket' },
  form: { tone: 'violet', label: 'Lead' },
  choice: { tone: 'green', label: 'Carrier choice' },   // bl_disp_0481 — a candidate picked a carrier; Accept/Decline on #/carrier-choices
  trial_zero: { tone: 'amber', label: 'Trial · no activity' },   // bl_disp_0485 — red daily report; Seen on the Dispatcher 360 → Performance
  trial_help: { tone: 'violet', label: 'Trial · dispatcher wrote' },   // bl_disp_0485 — Help / Feedback / Stuck from the daily report
};
// where a queue item links, by its related entity
const DESK = { emergency_sla: '#/safety', pod_missing: '#/pod-review', claim_decision_stale: '#/exceptions', load_post_review: '#/partner-intake' };
function linkFor(it) {
  if (it.kind === 'ticket') return '#/support' + (it.related_id ? '?id=' + it.related_id : '');
  if (it.kind === 'form') return '#/forms' + (it.related_id ? '?id=' + it.related_id : '');
  if (it.kind === 'choice') return '#/carrier-choices' + (it.related_id ? '?id=' + it.related_id : '');
  if (it.kind === 'trial_zero' || it.kind === 'trial_help') return '#/dispatcher?id=' + (it.related_id || '') + '&tab=performance';
  if (it.task_type && DESK[it.task_type]) return DESK[it.task_type]; // work lives on a dedicated desk
  if (it.kind === 'task') { const g = goFor(it); if (g) return g; }   // bl_ops_0489: exact record (dispatcher → 360) before the generic switch
  switch (it.related_type) {
    case 'carrier': return '#/carrier?id=' + (it.related_id || '');
    case 'support_ticket': return '#/support';
    case 'form_submission': return '#/forms';
    case 'trip': return '#/trips' + (it.related_id ? '?id=' + it.related_id : '');
    case 'load': return '#/loads' + (it.related_id ? '?id=' + it.related_id : '');
    case 'invoice': case 'settlement': return '#/finance';
    case 'document': return '#/documents';
    case 'lead': return '#/crm';
    default: return '#/automation';
  }
}
const prioTone = { urgent: 'red', high: 'amber', normal: 'blue', low: 'gray' };

export function renderActionCenter(host, ctx, user) {
  const name = (user && (user.user_metadata?.name || user.email)) || 'there';
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead(greet + ', ' + String(name).split(/[ @]/)[0], 'Here’s what needs your attention right now — newest and most urgent first.'),
    el('div', { id: 'ac-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading your action center…')),
  ]));
  const body = host.querySelector('#ac-body');
  load();

  async function load() {
    let d;
    try { d = await actionCenter(); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const n = (k) => Number((d && d[k]) || 0);

    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Open tasks', value: String(n('tasks_open')), sub: n('tasks_overdue') + ' overdue', accent: n('tasks_overdue') ? 'amber' : 'blue', to: '#/automation' }),
      statCard({ icon: 'bell', label: 'Open tickets', value: String(n('tickets_open')), sub: 'support queue', accent: 'violet', to: '#/support' }),
      statCard({ icon: 'trend', label: 'New leads', value: String(n('forms_new')), sub: 'from website', accent: 'green', to: '#/forms' }),
      statCard({ icon: 'doc', label: 'Docs to review', value: String(n('docs_pending')), sub: 'compliance', accent: n('docs_pending') ? 'amber' : 'green', to: '#/documents' }),
      statCard({ icon: 'shield', label: 'Expiring soon', value: String(n('compliance_expiring')), sub: 'credentials (30d)', accent: n('compliance_expiring') ? 'amber' : 'green', to: '#/compliance' }),
      statCard({ icon: 'flag', label: 'Settlements', value: String(n('settlements_pending')), sub: 'awaiting approval', accent: n('settlements_pending') ? 'amber' : 'green', to: '#/finance' }),
      statCard({ icon: 'handshake', label: 'Carrier choices', value: String(n('choices_pending')), sub: n('choices_pending') ? 'candidates waiting on you' : 'nothing waiting', accent: n('choices_pending') ? 'amber' : 'green', to: '#/carrier-choices' }),   // bl_disp_0481
      statCard({ icon: 'timer', label: 'Trial alerts', value: String(n('trial_alerts')), sub: n('trial_alerts') ? 'red days + help requests' : 'every trial is moving', accent: n('trial_alerts') ? 'amber' : 'green', to: '#/dispatchers?tab=queue' }),   // bl_disp_0485
    ]);

    const queue = (d && d.queue) || [];
    const queueCard = card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Needs you now'), el('span', { class: 'cc-sub' }, queue.length + ' items')]),
      queue.length ? el('div', { class: 'cc-actionlist' }, queue.map(it => {
        const meta = KIND_META[it.kind] || { tone: 'gray', label: it.kind };
        return el('a', { class: 'cc-action-row', href: linkFor(it) }, [
          el('span', { class: 'cc-pill cc-pill-' + (prioTone[it.priority] || 'blue') }, [el('i', { class: 'cc-pill-dot' }), it.priority || 'normal']),
          el('div', { class: 'cc-action-main' }, [
            el('b', null, it.title || meta.label),
            el('div', { class: 'cc-sub' }, [el('span', { class: 'cc-tag cc-tag-' + meta.tone }, meta.label), ' · ', it.when ? ago(it.when) : '—', it.overdue ? el('span', { class: 'cc-overdue' }, ' · OVERDUE') : '']),
            it.kind === 'task' ? liveLine(it) : '',   // bl_ops_0489
          ]),
          el('span', { class: 'cc-row-go' }, '›'),
        ]);
      })) : el('div', { class: 'cc-empty-good' }, '🎉 All clear — nothing needs you right now.'),
    ]);

    mount(body, el('div', null, [kpis, el('div', { style: 'margin-top:16px' }, queueCard)]));
  }
}

export default renderActionCenter;
