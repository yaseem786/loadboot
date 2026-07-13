// radar.js — Wave 10 Ops Radar ("Today"). One screen of everything that needs attention now,
// pulled live across every module via cc_ops_radar() (staff-only, RBAC-gated). Each card links
// into the module that resolves it. Auto-refreshes so the operator always sees the current state.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, money, fmtDate, fmtDateTime } from '../../shared/ui/components.js';
import { opsRadar, ccPayPendingFees, payConfirmReceived, ccAgentsQueue, ccAgentDecide, ccAgentMsgs, ccAgentMsgSend } from '../../shared/api.js';
import { signedDocumentUrl } from '../../shared/storage.js';
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
    let feeRows = []; try { const fr = await ccPayPendingFees(); feeRows = Array.isArray(fr) ? fr : []; } catch (_) {}
    let agRows = []; try { const ar = await ccAgentsQueue(); agRows = Array.isArray(ar) ? ar : []; } catch (_) {}
    const agCard9 = agRows.length ? card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '🤝 Agents to verify'), el('span', { class: 'cc-pill cc-pill-amber' }, String(agRows.length))]),
      el('div', { class: 'cc-doclist' }, agRows.slice(0, 8).map((x) => el('div', { style: 'padding:8px 0;border-bottom:1px solid #eef2f7' }, [
        el('div', { style: 'font-weight:700' }, (x.name || '(no name)') + (x.agency ? ' — ' + x.agency : '') + ' · ' + (x.email || '')),
        el('div', { class: 'cc-sub' }, (x.city ? x.city + ', ' + (x.state || '') + ' · ' : '') + (x.years_exp != null ? x.years_exp + 'y exp · ' : '') + 'code ' + (x.code || '—') + ' · payout ' + (x.payout_method || '—') + ' · ' + (x.tax_form || 'no tax form') + ' · agreement ' + (x.agreement_signed ? '✓ ' + (x.signed_name || '') : '✕ UNSIGNED')),
        el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [
          el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => { const b9 = ev.currentTarget; if (!confirm('Approve this agent? Their chain starts earning immediately.')) return; b9.disabled = true; try { await ccAgentDecide(x.user_id, 'approve', null); load(); } catch (e9) { b9.disabled = false; alert((e9 && e9.message) || 'Failed.'); } } }, '✓ Approve'),
          el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async (ev) => { const nt9 = prompt('What info is needed? (agent sees this)'); if (!nt9) return; const b9 = ev.currentTarget; b9.disabled = true; try { await ccAgentDecide(x.user_id, 'info', nt9); load(); } catch (e9) { b9.disabled = false; alert((e9 && e9.message) || 'Failed.'); } } }, '？ More info'),
          el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'color:#b91c1c', onClick: async (ev) => { const nt9 = prompt('Reject — why? (agent sees this)'); if (!nt9) return; const b9 = ev.currentTarget; b9.disabled = true; try { await ccAgentDecide(x.user_id, 'reject', nt9); load(); } catch (e9) { b9.disabled = false; alert((e9 && e9.message) || 'Failed.'); } } }, '✕ Reject'),
          el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async () => {
            let th9 = []; try { th9 = (await ccAgentMsgs(x.user_id)) || []; } catch (_) {}
            const hist9 = th9.length ? th9.map((m9) => (m9.sender === 'staff' ? 'CC' : 'Agent') + ' (' + new Date(m9.at).toLocaleString() + '): ' + m9.body).join('\n') : '(no messages yet)';
            const rep9 = prompt('💬 Thread with ' + (x.name || 'agent') + ':\n\n' + hist9 + '\n\nReply (agent gets a notification):');
            if (rep9 && rep9.trim()) { try { await ccAgentMsgSend(x.user_id, rep9.trim()); alert('Sent ✓'); } catch (e9) { alert((e9 && e9.message) || 'Failed.'); } }
          } }, '💬 Message'),
        ]),
      ]))),
    ]) : '';
    const feeCard = feeRows.length ? card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '💳 Fee receipts to verify'), el('span', { class: 'cc-pill cc-pill-amber' }, String(feeRows.length))]),
      el('div', { class: 'cc-doclist' }, feeRows.slice(0, 10).map((x) => el('div', { class: 'cc-docrow', style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;padding:6px 0' }, [
        el('div', null, [
          el('div', { style: 'font-weight:700' }, (x.carrier || 'Carrier') + ' — ' + money(x.amount || 0) + (x.invoice_no ? ' · ' + x.invoice_no : '')),
          el('div', { class: 'cc-sub' }, 'sent ' + (x.sent_at ? fmtDateTime(x.sent_at) : '') + (x.payment_ref ? ' · ref ' + x.payment_ref : '')),
        ]),
        el('div', { style: 'display:flex;gap:6px' }, [
          x.receipt_path ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async (ev) => { const b9 = ev.currentTarget; const w9 = b9.textContent; b9.textContent = '…';
            try { const u9 = await signedDocumentUrl(x.receipt_path, 600); window.open(u9, '_blank', 'noopener'); } catch (e9) { alert((e9 && e9.message) || 'Could not open receipt.'); }
            b9.textContent = w9; } }, '🧾 Receipt') : '',
          el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => { const b9 = ev.currentTarget;
            if (!confirm('Confirm this fee payment landed in the LoadBoot account? The carrier invoice flips to PAID.')) return;
            b9.disabled = true; try { await payConfirmReceived(x.id); load(); } catch (e9) { b9.disabled = false; alert((e9 && e9.message) || 'Failed.'); }
          } }, '✓ Money received'),
        ]),
      ]))),
    ]) : '';
    const len = (k) => Array.isArray(r[k]) ? r[k].length : 0;

    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'alert', label: 'Emergencies', value: String(len('open_emergencies')), sub: 'open now', accent: len('open_emergencies') ? 'red' : 'green' }),
      statCard({ icon: 'truck', label: 'Booking requests', value: String(len('booking_requests')), sub: 'awaiting approval', accent: len('booking_requests') ? 'amber' : 'green' }),
      statCard({ icon: 'doc', label: 'Docs to review', value: String(len('documents_pending') + len('checklist_pending')), sub: 'files + submissions', accent: (len('documents_pending') + len('checklist_pending')) ? 'amber' : 'green' }),
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

    // Docs to review = carrier FILE uploads (Documents page) + broker CHECKLIST submissions
    // (PU#, billing, appointment… — verified in Partner intake → row → Docs). One merged widget
    // so nothing hides behind the broker-loads table.
    const docItems = (r.documents_pending || []).map(d => ({ kind: 'file', d }))
      .concat((r.checklist_pending || []).map(d => ({ kind: 'sub', d })));
    const docsPending = card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Documents & submissions to review'), el('span', { class: 'cc-pill cc-pill-' + (docItems.length ? 'amber' : 'green') }, String(docItems.length))]),
      docItems.length ? el('div', { class: 'cc-doclist' }, docItems.slice(0, 10).map(x => x.kind === 'file'
        ? el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/documents') }, [
            el('div', null, [el('b', null, '📄 ' + (x.d.file || x.d.type || 'document')), el('div', { class: 'cc-sub' }, (x.d.carrier || '') + ' · file upload — review in Documents')]),
            el('span', { class: 'cc-pill cc-pill-amber' }, 'review'),
          ])
        : el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/partner-intake') }, [
            el('div', null, [el('b', null, '📋 ' + (x.d.label || 'submission')), el('div', { class: 'cc-sub' }, (x.d.broker || '') + ' · ' + (x.d.origin || '?') + ' → ' + (x.d.destination || '?') + ' — verify in Partner intake → Docs')]),
            el('span', { class: 'cc-pill cc-pill-blue' }, 'verify'),
          ]))) : el('div', { class: 'cc-sub' }, 'No documents or submissions awaiting review.'),
      el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, [
        el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => go('/documents') }, 'File uploads'),
        el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => go('/partner-intake') }, 'Checklist submissions'),
      ]),
    ]);

    const payments = feed('Payment reports', r.payment_reports || [], p => el('div', { class: 'cc-doc-item cc-row', onClick: () => go('/finance') }, [
      el('div', null, [el('b', null, p.invoice || 'invoice'), el('div', { class: 'cc-sub' }, (p.org || '') + (p.amount != null ? ' · ' + money(p.amount) : '') + (p.expected ? ' · exp ' + fmtDate(p.expected) : ''))]), el('span', { class: 'cc-pill cc-pill-violet' }, 'confirm'),
    ]), 'No payment reports to confirm.', '/finance');

    mount(body, el('div', null, [
      kpis,
      agCard9,
      feeCard,
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [emergencies, booking]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [docsPending, payments]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [overdue, approval]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [unassigned, due]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [expiring, settlements]),
    ]));
  }
}

export default renderRadar;
