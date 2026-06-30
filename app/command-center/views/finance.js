// finance.js — Wave 5 Finance. Dispatch-fee invoices (flat 5%) + carrier settlements.
// Invoices are created from delivered trips; settlements bundle a carrier's unpaid invoices
// and PAYING OUT is gated behind finance.approve + a human-approval automation task.
// Reads/writes via cc_finance_* / cc_*_invoice / cc_*_settlement RPCs (finance.view/manage/
// approve), all RBAC-gated + audited server-side.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, money, fmtDate, fmtDateTime, card } from '../../shared/ui/components.js';
import { financeOverview, listInvoices, getInvoice, setInvoiceStatus, listSettlements, createSettlement, decideSettlement, listTrips, getCarriersDirectory, createInvoice } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const INV_STATUS = [{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' }];
const INV_TONE = { draft: 'gray', sent: 'amber', paid: 'green', void: 'red' };
const STL_TONE = { pending: 'amber', approved: 'blue', paid: 'green', void: 'red' };
const TABS = [{ value: 'invoices', label: 'Invoices' }, { value: 'settlements', label: 'Settlements' }];

export function renderFinance(host) {
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

  function route() { if (tab === 'settlements') loadSettlements(); else loadInvoices(); }

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
    if (can('finance.manage')) {
      if (i.status === 'draft') actions.appendChild(chip('Send invoice', () => setStatus(id, 'sent')));
      if (i.status === 'sent') actions.appendChild(chip('Mark paid', () => setStatus(id, 'paid')));
      if (i.status !== 'paid' && i.status !== 'void') actions.appendChild(chip('Void', () => setStatus(id, 'void')));
    }
    mount(drawer.body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, i.invoice_no), el('span', { class: 'cc-pill cc-pill-' + (INV_TONE[i.status] || 'gray') }, i.status)]),
      card([ field('Carrier', i.carrier), field('Lane', (i.origin || '—') + ' → ' + (i.destination || '—')),
        field('Gross (rate)', money(i.gross)), field('Fee (' + (i.fee_pct || 5) + '%)', money(i.fee)),
        field('Net to carrier', money(i.net)), field('Due', i.due_at ? fmtDate(i.due_at) : '—'),
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
    } }, [ el('div', null, [el('b', null, c.name), el('div', { class: 'cc-sub' }, 'bundle sent invoices')]), el('span', { class: 'cc-row-go' }, '›') ]))));
  }

  function chip(label, onClick) { return el('button', { class: 'cc-chip-btn', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; await onClick(); } }, label); }

  mount(host, el('div', { class: 'cc-view' }, [header(), bodyHost]));
  loadKpis(); route();
}

export default renderFinance;
