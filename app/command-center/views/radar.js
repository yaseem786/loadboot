// radar.js — Wave 10 Ops Radar ("Today"). One screen of everything that needs attention now,
// pulled live across every module via cc_ops_radar() (staff-only, RBAC-gated). Each card links
// into the module that resolves it. Auto-refreshes so the operator always sees the current state.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, money, fmtDate, fmtDateTime } from '../../shared/ui/components.js';
import { opsRadar } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

function go(hash) { location.hash = hash; }

export function renderRadar(host) {
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Ops Radar', 'Everything that needs attention right now — across dispatch, compliance, finance and automation.'),
    el('div', { id: 'radar-body' }, el('div', { class: 'lb-state lb-loading' }, 'Scanning operations…')),
  ]));
  const body = host.querySelector('#radar-body');
  let timer = null;
  load();
  // light auto-refresh while the view is open
  timer = setInterval(() => { if (document.body.contains(body)) load(); else clearInterval(timer); }, 30000);

  async function load() {
    let r; try { r = await opsRadar(); } catch (e) { showError(body, humanizeError(e), load); return; }
    const len = (k) => Array.isArray(r[k]) ? r[k].length : 0;

    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'alert', label: 'Emergencies', value: String(len('open_emergencies')), sub: 'open now', accent: len('open_emergencies') ? 'red' : 'green' }),
      statCard({ icon: 'truck', label: 'Booking requests', value: String(len('booking_requests')), sub: 'awaiting approval', accent: len('booking_requests') ? 'amber' : 'green' }),
      statCard({ icon: 'doc', label: 'Docs to review', value: String(len('documents_pending')), sub: 'compliance', accent: len('documents_pending') ? 'amber' : 'green' }),
      statCard({ icon: 'flag', label: 'Overdue tasks', value: String(len('overdue_tasks')), sub: 'past SLA', accent: len('overdue_tasks') ? 'red' : 'green' }),
      statCard({ icon: 'shield', label: 'Awaiting approval', value: String(len('awaiting_approval')), sub: 'human gate', accent: len('awaiting_approval') ? 'amber' : 'green' }),
      statCard({ icon: 'truck', label: 'Unassigned loads', value: String(len('unassigned_loads')), sub: 'booked, no trip', accent: len('unassigned_loads') ? 'amber' : 'green' }),
      statCard({ icon: 'doc', label: 'Settlements pending', value: String(len('settlements_pending')), sub: 'payout review', accent: len('settlements_pending') ? 'violet' : 'green' }),
    ]);

    const feed = (title, items, render, emptyMsg, onClickHash) => card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, title), el('span', { class: 'cc-pill cc-pill-' + (items.length ? 'amber' : 'green') }, String(items.length))]),
      items.length ? el('div', { class: 'cc-doclist' }, items.slice(0, 8).map(render)) : el('div', { class: 'cc-sub' }, emptyMsg),
      onClickHash ? el('button', { class: 'lb-btn lb-btn-secondary', style: 'margin-top:10px', onClick: () => go(onClickHash) }, 'Open module') : '',
    ]);

    const overdue = feed('Overdue tasks', r.overdue_tasks || [], t => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, [t.title, t.escalated ? el('span', { class: 'cc-pill cc-pill-red', style: 'margin-left:6px' }, 'escalated') : '']), el('div', { class: 'cc-sub' }, t.type + ' · due ' + fmtDateTime(t.sla_at))]),
      el('span', { class: 'cc-pill cc-pill-' + (t.priority === 'urgent' ? 'red' : 'amber') }, t.priority),
    ]), 'Nothing overdue — nice.', '/automation');

    const approval = feed('Awaiting your approval', r.awaiting_approval || [], t => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, t.title), el('div', { class: 'cc-sub' }, t.type)]), el('span', { class: 'cc-pill cc-pill-violet' }, 'approve'),
    ]), 'No approvals waiting.', '/automation');

    const expiring = feed('Compliance expiring (30d)', r.expiring_compliance || [], c => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, c.carrier), el('div', { class: 'cc-sub' }, c.requirement + ' · ' + fmtDate(c.expiry))]), el('span', { class: 'cc-pill cc-pill-amber' }, 'renew'),
    ]), 'No upcoming expiries.', '/compliance');

    const unassigned = feed('Unassigned loads', r.unassigned_loads || [], l => el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/trips') }, [
      el('div', null, [el('b', null, (l.origin || '?') + ' → ' + (l.destination || '?')), el('div', { class: 'cc-sub' }, l.rate != null ? money(l.rate) : '—')]), el('span', { class: 'cc-row-go' }, '›'),
    ]), 'Every booked load has a trip.', '/trips');

    const due = feed('Deliveries due soon', r.deliveries_due || [], t => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, (t.origin || '?') + ' → ' + (t.destination || '?')), el('div', { class: 'cc-sub' }, 'due ' + fmtDateTime(t.due))]), el('span', { class: 'cc-pill cc-pill-blue' }, 'in transit'),
    ]), 'Nothing due in the next 36h.', '/trips');

    const settlements = feed('Settlements pending', r.settlements_pending || [], s => el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/finance') }, [
      el('div', null, [el('b', null, s.settlement), el('div', { class: 'cc-sub' }, (s.carrier || '—') + ' · ' + money(s.net))]), el('span', { class: 'cc-pill cc-pill-violet' }, s.status),
    ]), 'No settlements awaiting payout.', '/finance');

    const emergencies = feed('Emergencies (open)', r.open_emergencies || [], e => el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/exceptions') }, [
      el('div', null, [el('b', null, (e.category || 'emergency')), el('div', { class: 'cc-sub' }, (e.carrier || '') + ' · ' + fmtDateTime(e.at))]), el('span', { class: 'cc-pill cc-pill-red' }, 'act'),
    ]), 'No open emergencies.', '/exceptions');

    const booking = feed('Booking requests', r.booking_requests || [], b => el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/booking-requests') }, [
      el('div', null, [el('b', null, (b.origin || '?') + ' → ' + (b.destination || '?')), el('div', { class: 'cc-sub' }, (b.carrier || '') + (b.rate != null ? ' · ' + money(b.rate) : ''))]), el('span', { class: 'cc-row-go' }, '›'),
    ]), 'No booking requests waiting.', '/booking-requests');

    const docsPending = feed('Documents to review', r.documents_pending || [], d => el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/documents') }, [
      el('div', null, [el('b', null, d.file || d.type || 'document'), el('div', { class: 'cc-sub' }, (d.carrier || '') + ' · ' + (d.type || ''))]), el('span', { class: 'cc-pill cc-pill-amber' }, 'review'),
    ]), 'No documents awaiting review.', '/documents');

    const payments = feed('Payment reports', r.payment_reports || [], p => el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/finance') }, [
      el('div', null, [el('b', null, p.invoice || 'invoice'), el('div', { class: 'cc-sub' }, (p.org || '') + (p.amount != null ? ' · ' + money(p.amount) : '') + (p.expected ? ' · exp ' + fmtDate(p.expected) : ''))]), el('span', { class: 'cc-pill cc-pill-violet' }, 'confirm'),
    ]), 'No payment reports to confirm.', '/finance');

    mount(body, el('div', null, [
      kpis,
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [emergencies, booking]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [docsPending, payments]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [overdue, approval]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [unassigned, due]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [expiring, settlements]),
    ]));
  }
}

export default renderRadar;
