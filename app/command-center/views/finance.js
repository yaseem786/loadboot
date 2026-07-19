// finance.js — Wave 5 Finance. Dispatch-fee invoices (flat 5%) + carrier settlements.
// Invoices are created from delivered trips; settlements bundle a carrier's unpaid invoices
// and PAYING OUT is gated behind finance.approve + a human-approval automation task.
// Reads/writes via cc_finance_* / cc_*_invoice / cc_*_settlement RPCs (finance.view/manage/
// approve), all RBAC-gated + audited server-side.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, money, fmtDate, fmtDateTime, card } from '../../shared/ui/components.js';
import { financeOverview, listInvoices, getInvoice, setInvoiceStatus, listSettlements, createSettlement, decideSettlement, listTrips, getCarriersDirectory, createInvoice, invoiceDocument, invoiceSendReminder } from '../../shared/api.js';
import { printDocument } from '../../shared/ui/printDoc.js';
import { can } from '../../shared/permissions.js';
import { financeReceivables, financePayables, invoicePrepQueue, financeReconcile } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const INV_STATUS = [{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' }];
const INV_TONE = { draft: 'gray', sent: 'amber', paid: 'green', void: 'red' };
const STL_TONE = { pending: 'amber', approved: 'blue', paid: 'green', void: 'red' };
const TABS = [{ value: 'invoices', label: 'Invoices' }, { value: 'settlements', label: 'Settlements' }, { value: 'receivables', label: 'Receivables' }, { value: 'payables', label: 'Payables' }, { value: 'prep', label: 'Invoice prep' }, { value: 'reconcile', label: 'Reconcile' }];

export function renderFinance(host, focusId) {
  let tab = 'invoices';
  let invStatus = '';
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await financeOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'doc', label: 'Outstanding fees', value: money(n('outstanding_fee')), sub: n('overdue') + ' overdue', accent: n('overdue') > 0 ? 'red' : 'amber' }),
      statCard({ icon: 'check', label: 'Collected fees', value: money(n('paid_fee')), sub: 'paid', accent: 'green' }),
      statCard({ icon: 'list', label: 'Draft invoices', value: String(n('draft')), sub: n('invoices_total') + ' total', accent: 'blue' }),
      statCard({ icon: 'shield', label: 'Settlements', value: String(n('settlements_pending')), sub: 'pending payout', accent: 'violet' }),
    ]));
  }

  function header() {
    const actions = [];
    if (can('finance.manage')) {
      actions.push(el('button', { class: 'lb-btn lb-btn-secondary', onClick: openInvoiceFromTrip }, '+ Invoice trip'));
      actions.push(el('button', { class: 'lb-btn lb-btn-primary', onClick: openSettlement }, '+ Settlement'));
    }
    return el('div', null, [
      sectionHead('Finance', 'Dispatch-fee invoices (flat 5%) and carrier settlements. Payouts require approval.', actions),
      kpiHost,
      toolbar([ segmented(TABS, tab, (v) => { tab = v; route(); }) ]),
    ]);
  }

  function route() {
    if (tab === 'settlements') loadSettlements();
    else if (tab === 'receivables') loadReceivables();
    else if (tab === 'payables') loadPayables();
    else if (tab === 'prep') loadPrep();
    else if (tab === 'reconcile') loadReconcile();
    else loadInvoices();
  }

  // Inc 56 — receivables with aging buckets (deterministic sums; basis shown)
  async function loadReceivables() {
    mount(bodyHost, el('div', { class: 'lb-state lb-loading' }, 'Loading receivables…'));
    let r; try { r = await financeReceivables(); } catch (e) { mount(bodyHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const bucketRow = (label, b) => el('tr', null, [el('td', null, el('b', null, label)),
      el('td', null, money(b.current)), el('td', null, money(b.d1_30)), el('td', null, money(b.d31_60)),
      el('td', null, money(b.d61_90)), el('td', { style: 'color:#dc2626' }, money(b.d90_plus)), el('td', null, el('b', null, money(b.outstanding)))]);
    mount(bodyHost, el('div', null, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, r.basis || ''),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['', 'Current', '1–30d', '31–60d', '61–90d', '90d+', 'Total'].map(h => el('th', null, h)))),
        el('tbody', null, [bucketRow('Partner invoices', r.partner_invoices || {}), bucketRow('Carrier fee invoices', r.carrier_fee_invoices || {})]),
      ]),
      el('div', { style: 'margin:10px 0' }, el('b', null, 'Total outstanding: ' + money(r.total_outstanding))),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Who', 'Ref', 'Amount', 'Due', 'Overdue', 'Status'].map(h => el('th', null, h)))),
        el('tbody', null, (r.items || []).map(i => el('tr', null, [
          el('td', null, i.who || '—'), el('td', null, i.ref || '—'), el('td', null, money(i.amount)),
          el('td', null, i.due ? fmtDate(i.due) : '—'),
          el('td', null, i.overdue_days > 0 ? el('b', { style: 'color:#dc2626' }, i.overdue_days + 'd') : '—'),
          el('td', null, i.status),
        ]))),
      ]),
    ]));
  }

  // Inc 56 — payables (approved-not-paid settlements). Paying stays in the Settlements tab (maker/checker).
  async function loadPayables() {
    mount(bodyHost, el('div', { class: 'lb-state lb-loading' }, 'Loading payables…'));
    let r; try { r = await financePayables(); } catch (e) { mount(bodyHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const sm = r.summary || {};
    mount(bodyHost, el('div', null, [
      el('div', { class: 'cc-kpi-grid' }, [
        statCard({ icon: 'doc', label: 'Pending', value: money(sm.pending_net), sub: (sm.pending_count || 0) + ' settlements', accent: 'amber' }),
        statCard({ icon: 'shield', label: 'Approved, unpaid', value: money(sm.approved_unpaid_net), sub: (sm.approved_unpaid_count || 0) + ' awaiting payout', accent: 'blue' }),
      ]),
      el('p', { class: 'cc-sub' }, r.note || ''),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Ref', 'Carrier', 'Net', 'Status', 'Age', 'Approved?'].map(h => el('th', null, h)))),
        el('tbody', null, (r.items || []).map(i => el('tr', null, [
          el('td', null, el('b', null, i.ref || '—')), el('td', null, i.carrier || '—'), el('td', null, money(i.net)),
          el('td', null, i.status), el('td', null, (i.age_days || 0) + 'd'),
          el('td', null, i.approved_by_set ? '✓' : '—'),
        ]))),
      ]),
    ]));
  }

  // Inc 56 — invoice prep pipeline: delivered → POD status → one-click invoice.
  async function loadPrep() {
    mount(bodyHost, el('div', { class: 'lb-state lb-loading' }, 'Loading queue…'));
    let rows; try { rows = await invoicePrepQueue(100); } catch (e) { mount(bodyHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    rows = rows || [];
    if (!rows.length) { mount(bodyHost, el('div', { class: 'lb-state' }, 'Nothing to invoice — every delivered trip has an invoice.')); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Lane', 'Carrier', 'Rate', 'Delivered', 'Waiting', 'POD', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(q => el('tr', null, [
        el('td', null, el('b', null, q.lane)), el('td', null, q.carrier || '—'), el('td', null, money(q.rate)),
        el('td', null, q.delivered_at ? fmtDateTime(q.delivered_at) : '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (q.days_since_delivery > 3 ? 'red' : 'amber') }, q.days_since_delivery + 'd')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (q.pod_status === 'approved' ? 'green' : q.pod_status === 'no POD uploaded' ? 'red' : 'amber') }, q.pod_status)),
        el('td', null, can('finance.manage') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await createInvoice(q.trip_id); toast('Invoice created (draft)', 'success'); loadPrep(); }
          catch (e) { ev.currentTarget.disabled = false; toast(humanizeError(e), 'error'); }
        } }, 'Create invoice') : null),
      ]))),
    ]));
  }

  // Inc 56 — reconciliation: every mismatch listed individually; zero mismatches is the goal state.
  async function loadReconcile() {
    mount(bodyHost, el('div', { class: 'lb-state lb-loading' }, 'Reconciling…'));
    let r; try { r = await financeReconcile(); } catch (e) { mount(bodyHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const inv = r.invoices || {}, st = r.settlements || {};
    mount(bodyHost, el('div', null, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, 'Window: ' + r.from + ' → ' + r.to + ' · ' + (r.basis || '')),
      el('div', { class: 'cc-kpi-grid' }, [
        statCard({ icon: 'doc', label: 'Invoices issued', value: String(inv.issued_count || 0), sub: money(inv.issued_fee) + ' fees · ' + (inv.paid_count || 0) + ' paid', accent: 'blue' }),
        statCard({ icon: 'shield', label: 'Settlements', value: String(st.created_count || 0), sub: (st.paid_count || 0) + ' paid · ' + money(st.paid_net) + ' net', accent: 'violet' }),
        statCard({ icon: (r.mismatch_count ? 'alert' : 'check'), label: 'Mismatches', value: String(r.mismatch_count || 0), sub: r.mismatch_count ? 'need attention' : 'books consistent ✓', accent: r.mismatch_count ? 'red' : 'green' }),
      ]),
      (r.mismatches && r.mismatches.length) ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Type', 'Invoice', 'Settlement', 'Detail'].map(h => el('th', null, h)))),
        el('tbody', null, r.mismatches.map(m => el('tr', null, [
          el('td', null, el('span', { class: 'cc-pill cc-pill-red' }, (m.type || '').replace(/_/g, ' '))),
          el('td', null, m.invoice || '—'), el('td', null, m.settlement || '—'), el('td', null, el('span', { class: 'cc-sub' }, m.detail || '')),
        ]))),
      ]) : el('div', { class: 'lb-state' }, '✓ No mismatches — invoices and settlements are consistent.'),
    ]));
  }

  async function loadInvoices() {
    mount(bodyHost, el('div', null, [
      el('div', { style: 'margin-bottom:10px' }, segmented(INV_STATUS, invStatus, (v) => { invStatus = v; loadInvoices(); })),
      el('div', { id: 'inv-list' }, el('div', { class: 'lb-state lb-loading' }, 'Loading invoices…')),
    ]));
    const listEl = bodyHost.querySelector('#inv-list');
    let rows; try { rows = await listInvoices({ status: invStatus || null, limit: 300 }); } catch (e) { showError(listEl, humanizeError(e), loadInvoices); return; }
    if (!rows || !rows.length) { showEmpty(listEl, 'No invoices yet. Invoice a delivered trip to start.'); return; }
    mount(listEl, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Invoice'), el('th', null, 'Carrier'), el('th', null, 'Lane'), el('th', null, 'Gross'), el('th', null, 'Fee (5%)'), el('th', null, 'Status'), el('th', null, 'Due'), el('th', null, '')])),
      el('tbody', null, rows.map(i => el('tr', { class: 'cc-row', onClick: () => openInvoice(i.id) }, [
        el('td', null, el('b', null, i.invoice_no)),
        el('td', null, i.carrier || '—'),
        el('td', null, (i.origin || '—') + ' → ' + (i.destination || '—')),
        el('td', null, money(i.gross)),
        el('td', null, el('b', null, money(i.fee))),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (INV_TONE[i.status] || 'gray') }, i.status)),
        el('td', null, i.due_at ? fmtDate(i.due_at) : '—'),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  async function loadSettlements() {
    showLoading(bodyHost, 'Loading settlements…');
    let rows; try { rows = await listSettlements({ limit: 200 }); } catch (e) { showError(bodyHost, humanizeError(e), loadSettlements); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No settlements yet. Bundle a carrier’s sent invoices into a settlement.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Settlement'), el('th', null, 'Carrier'), el('th', null, 'Gross'), el('th', null, 'Fee'), el('th', null, 'Net'), el('th', null, 'Status'), el('th', null, '')])),
      el('tbody', null, rows.map(s => el('tr', { class: 'cc-row', onClick: () => openSettlementDetail(s) }, [
        el('td', null, el('b', null, s.settlement_no)),
        el('td', null, s.carrier || '—'),
        el('td', null, money(s.gross)),
        el('td', null, money(s.fee)),
        el('td', null, el('b', null, money(s.net))),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (STL_TONE[s.status] || 'gray') }, s.status)),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  async function openInvoice(id) {
    const drawer = openDrawer('Invoice', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Dispatch fee invoice' });
    let i; try { i = await getInvoice(id); } catch (e) { mount(drawer.body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v || '—')]);
    const actions = el('div', { class: 'cc-status-row', style: 'margin-top:12px' });
    actions.appendChild(chip('Print / PDF', async () => { try { printDocument(await invoiceDocument(id)); } catch (e) { toast(humanizeError(e), 'error'); } }));
    if (can('finance.manage')) {
      if (i.status === 'draft') actions.appendChild(chip('Send invoice', () => setStatus(id, 'sent')));
      if (i.status === 'sent') actions.appendChild(chip('Mark paid', () => setStatus(id, 'paid')));
      if (i.status === 'sent') actions.appendChild(chip('📨 Send payment reminder', async () => {
        const note = prompt('Optional message for the payer (leave blank for the standard reminder):') || null;
        try { const r = await invoiceSendReminder(id, note);
          toast('Reminder sent ✓ — payer emails: ' + (r.payer_emails || 0) + ' · carrier notified' + (r.days_overdue ? ' · ' + r.days_overdue + 'd overdue' : ''), 'success'); }
        catch (e) { toast(humanizeError(e), 'error'); }
      }));
      if (i.status !== 'paid' && i.status !== 'void') actions.appendChild(chip('Void', () => setStatus(id, 'void')));
    }
    mount(drawer.body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, i.invoice_no), el('span', { class: 'cc-pill cc-pill-' + (INV_TONE[i.status] || 'gray') }, i.status)]),
      card([ field('Carrier', i.carrier), field('Lane', (i.origin || '—') + ' → ' + (i.destination || '—')),
        field('Gross (rate)', money(i.gross)), field('Fee (' + (i.fee_pct || 5) + '%)', money(i.fee)),
        field('Net to carrier', money(i.net)), field('Due', i.due_at ? (fmtDate(i.due_at) + (i.status === 'sent' && new Date(i.due_at) < new Date() ? ' · ⚠ OVERDUE' : '')) : '—'),
        field('Settlement', i.settlement_no) ], 'cc-fields'),
      actions,
    ]));
    async function setStatus(iid, st) { try { await setInvoiceStatus(iid, st); toast('Invoice ' + st, 'success'); openInvoice(iid); loadInvoices(); loadKpis(); } catch (e) { toast(humanizeError(e), 'error'); } }
  }

  function openSettlementDetail(s) {
    const drawer = openDrawer('Settlement', el('div', null, ''), { subtitle: 'Carrier payout' });
    const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v || '—')]);
    const actions = el('div', { class: 'cc-status-row', style: 'margin-top:12px' });
    if (can('finance.approve') && (s.status === 'pending' || s.status === 'approved')) {
      if (s.status === 'pending') actions.appendChild(chip('Approve', () => decide(s.id, 'approve')));
      actions.appendChild(chip('Pay out', () => decide(s.id, 'pay')));
      actions.appendChild(chip('Void', () => decide(s.id, 'void')));
    } else if (s.status === 'pending' || s.status === 'approved') {
      actions.appendChild(el('div', { class: 'cc-sub' }, 'Payout requires a finance approver.'));
    }
    mount(drawer.body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, s.settlement_no), el('span', { class: 'cc-pill cc-pill-' + (STL_TONE[s.status] || 'gray') }, s.status)]),
      card([ field('Carrier', s.carrier), field('Gross', money(s.gross)), field('Fee retained', money(s.fee)),
        field('Net payout', money(s.net)), field('Period', (s.period_start ? fmtDate(s.period_start) : '—') + ' – ' + (s.period_end ? fmtDate(s.period_end) : '—')) ], 'cc-fields'),
      actions,
    ]));
    async function decide(sid, d) { try { await decideSettlement(sid, d); toast('Settlement ' + d, 'success'); drawer.close(); loadSettlements(); loadKpis(); } catch (e) { toast(humanizeError(e), 'error'); } }
  }

  // create an invoice from a delivered/invoiced trip
  async function openInvoiceFromTrip() {
    const drawer = openDrawer('Invoice a trip', el('div', { class: 'lb-state lb-loading' }, 'Loading delivered trips…'), { subtitle: 'Generate a 5% dispatch-fee invoice' });
    let trips; try { trips = await listTrips({ limit: 300 }); } catch (e) { mount(drawer.body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const eligible = (trips || []).filter(t => t.status === 'delivered' || t.status === 'invoiced');
    if (!eligible.length) { mount(drawer.body, el('div', { class: 'cc-sub' }, 'No delivered trips to invoice yet.')); return; }
    mount(drawer.body, el('div', { class: 'cc-doclist' }, eligible.map(t => el('div', { class: 'cc-doc-item cc-row', onClick: async () => {
      try { const id = await createInvoice(t.id, 15); toast('Invoice created', 'success'); drawer.close(); loadInvoices(); loadKpis(); openInvoice(id); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, [ el('div', null, [el('b', null, (t.origin || '?') + ' → ' + (t.destination || '?')), el('div', { class: 'cc-sub' }, (t.carrier || '—') + ' · ' + money(t.rate || 0))]), el('span', { class: 'cc-row-go' }, '›') ]))));
  }

  // bundle a carrier's sent invoices into a settlement
  async function openSettlement() {
    const drawer = openDrawer('New settlement', el('div', { class: 'lb-state lb-loading' }, 'Loading carriers…'), { subtitle: 'Bundle unpaid invoices for payout' });
    let carriers; try { carriers = await getCarriersDirectory({ limit: 200 }); } catch (e) { mount(drawer.body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    mount(drawer.body, el('div', { class: 'cc-doclist' }, (carriers || []).map(c => el('div', { class: 'cc-doc-item cc-row', onClick: async () => {
      try { await createSettlement({ carrier: c.id }); toast('Settlement created · payout approval queued', 'success'); drawer.close(); tab = 'settlements'; route(); loadKpis(); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, [ el('div', null, [el('b', null, c.company || c.contact_name || 'Carrier'), el('div', { class: 'cc-sub' }, [(c.mc ? 'MC ' + c.mc : null), 'bundle unpaid invoices'].filter(Boolean).join(' · '))]), el('span', { class: 'cc-row-go' }, '›') ]))));
  }

  function chip(label, onClick) { return el('button', { class: 'cc-chip-btn', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; await onClick(); } }, label); }

  mount(host, el('div', { class: 'cc-view' }, [header(), bodyHost]));
  loadKpis(); route();
  if (focusId) setTimeout(() => openInvoice(focusId), 400); // deep-link (invoice)
}

export default renderFinance;
