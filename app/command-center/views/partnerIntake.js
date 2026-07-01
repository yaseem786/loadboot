// partnerIntake.js — Command Center: Partner Intake (ct-waveBG).
// Staff review of what partners submit through the Partner Portal:
//  • Broker loads   → Accept / Decline / Post to the real load board
//  • Shipper freight → Quote / Book / Decline
//  • Facility docks  → read-only schedule across all facilities
// All reads gate on partners.view; all actions gate on partners.manage (server-side).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, statusPill, fmtDateTime } from '../../shared/ui/components.js';
import {
  partnerIntakeOverview, listPartnerLoads, decidePartnerLoad,
  listPartnerShipments, decidePartnerShipment, listPartnerAppointmentsAll,
  listPartnerInvoicesAll, createPartnerInvoice, setPartnerInvoiceStatus, listPartnerOrgs,
  getPaymentInstructions, setPaymentInstructions,
  loadChecklist, loadChecklistReview, requestUpdate, updateRequests, resolveUpdateRequest,
} from '../../shared/api.js';
import { openDrawer } from '../../shared/ui/components.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const money = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const TONE = { submitted: 'amber', accepted: 'blue', declined: 'red', posted: 'green', covered: 'green', requested: 'amber', quoted: 'blue', booked: 'green', scheduled: 'blue', checked_in: 'amber', completed: 'green', no_show: 'red', cancelled: 'gray', inbound: 'blue', outbound: 'violet', sent: 'amber', payment_submitted: 'blue', paid: 'green', void: 'gray', draft: 'gray' };
const pill = (s) => el('span', { class: 'cc-pill cc-pill-' + (TONE[s] || 'gray') }, [el('i', { class: 'cc-pill-dot' }), (s || '').replace(/_/g, ' ')]);

export function renderPartnerIntake(host) {
  const manage = can('partners.manage');
  let tab = 'broker';
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Partner Intake', 'Everything brokers, shippers and facilities submit through the Partner Portal. Review it here — accept, quote, or post broker loads straight to the live board.'),
    el('div', { id: 'pi-kpis' }),
    el('div', { class: 'cc-seg', id: 'pi-tabs' }),
    el('div', { id: 'pi-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const kpiHost = host.querySelector('#pi-kpis');
  const tabsHost = host.querySelector('#pi-tabs');
  const body = host.querySelector('#pi-body');

  const tabs = [['broker', 'Broker loads'], ['shipper', 'Shipper freight'], ['facility', 'Facility docks'], ['invoices', 'Invoices']];
  function renderTabs() {
    mount(tabsHost, tabs.map(([id, label]) => el('button', {
      class: 'cc-seg-btn' + (tab === id ? ' active' : ''), onClick: () => { tab = id; renderTabs(); route(); },
    }, label)));
  }

  async function loadKpis() {
    try {
      const o = await partnerIntakeOverview();
      mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
        statCard({ icon: 'loads', label: 'Broker loads pending', value: String(o.broker_pending), sub: o.broker_total + ' total', accent: 'amber' }),
        statCard({ icon: 'doc', label: 'Shipper freight pending', value: String(o.shipper_pending), sub: o.shipper_total + ' total', accent: 'blue' }),
        statCard({ icon: 'flag', label: 'Upcoming dock appts', value: String(o.appts_upcoming), sub: o.appts_total + ' total', accent: 'green' }),
      ]));
    } catch (e) { mount(kpiHost, el('div', { class: 'cc-sub', style: 'padding:4px 2px' }, humanizeError(e))); }
  }

  function route() {
    if (tab === 'broker') return loadBroker();
    if (tab === 'shipper') return loadShipper();
    if (tab === 'facility') return loadFacility();
    return loadInvoices();
  }

  async function loadInvoices() {
    showLoading(body, 'Loading invoices…');
    let rows; try { rows = await listPartnerInvoicesAll({ limit: 200 }); } catch (e) { showError(body, humanizeError(e), loadInvoices); return; }
    rows = rows || [];
    const head = el('div', { class: 'cc-head-actions', style: 'margin-bottom:12px; display:flex; gap:8px' },
      manage ? [
        el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => invoiceComposer(loadInvoices) }, '+ New invoice'),
        el('button', { class: 'lb-btn lb-btn-sm', onClick: () => paymentInstructionsDrawer() }, 'Payment instructions'),
      ] : null);
    const table = rows.length ? el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Invoice', 'Partner', 'Type', 'Amount', 'Due', 'Status', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(i => {
        const act = el('td', null);
        if (manage && i.status !== 'paid' && i.status !== 'void') {
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (ev) => setInv(i.id, 'paid', ev) }, 'Mark paid'));
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-left:6px', onClick: (ev) => setInv(i.id, 'void', ev) }, 'Void'));
        }
        return el('tr', null, [
          el('td', null, el('b', null, i.number)), el('td', null, i.partner || '—'), el('td', null, i.kind || '—'),
          el('td', null, money(i.amount)), el('td', null, i.due_date ? fmtDateTime(i.due_date) : '—'), el('td', null, pill(i.status)), act,
        ]);
      })),
    ]) : el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No invoices yet. Issue one with “New invoice”.');
    mount(body, card(el('div', null, [head, table])));
  }

  async function setInv(id, status, ev) {
    const btn = ev.currentTarget; btn.disabled = true; const t = btn.textContent; btn.textContent = '…';
    try { await setPartnerInvoiceStatus(id, status); toast('Invoice ' + status + '.', 'success'); loadInvoices(); }
    catch (e) { btn.disabled = false; btn.textContent = t; toast(humanizeError(e), 'error'); }
  }

  async function paymentInstructionsDrawer() {
    let cur = ''; try { cur = await getPaymentInstructions(); } catch (_) {}
    const ta = el('textarea', { class: 'cc-input', rows: '5', placeholder: 'e.g. Bank transfer — HBL, Acct 1234-5678, Title LoadBoot. Or JazzCash/Easypaisa: 0300-1234567. Send the invoice number as reference.' });
    ta.value = cur || '';
    const form = el('div', null, [
      el('p', { class: 'cc-sub' }, 'Shown to partners on their invoices. Bank / JazzCash / Easypaisa details — no payment gateway needed.'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Payment instructions'), ta]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        try { await setPaymentInstructions(ta.value.trim() || null); } catch (e) { alert(humanizeError(e)); return; }
        document.getElementById('cc-drawer-root')?.remove(); toast('Payment instructions saved.', 'success');
      } }, 'Save')]),
    ]);
    openDrawer('Payment instructions', form, { subtitle: 'How partners pay their invoices' });
  }

  async function invoiceComposer(reload) {
    let orgs = []; try { orgs = await listPartnerOrgs(); } catch (_) { orgs = []; }
    const orgSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Select partner…')].concat((orgs || []).map(o => el('option', { value: o.id }, o.name + ' (' + o.kind + ')'))));
    const amount = el('input', { class: 'cc-input', type: 'number', min: '0', step: '0.01', placeholder: '0.00' });
    const desc = el('input', { class: 'cc-input', placeholder: 'e.g. Line haul, Reno → Boise' });
    const due = el('input', { class: 'cc-input', type: 'date' });
    const form = el('div', null, [
      el('label', { class: 'cc-field' }, [el('span', null, 'Partner'), orgSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Amount (USD)'), amount]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Description'), desc]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Due date (optional)'), due]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: send }, 'Issue invoice')]),
    ]);
    openDrawer('New invoice', form, { subtitle: 'Bill a broker, shipper or facility' });
    async function send() {
      if (!orgSel.value) { alert('Pick a partner.'); return; }
      if (!amount.value || Number(amount.value) < 0) { alert('Enter an amount.'); return; }
      try { await createPartnerInvoice({ org: orgSel.value, amount: Number(amount.value), description: desc.value.trim() || null, due: due.value || null }); }
      catch (e) { alert(humanizeError(e)); return; }
      document.getElementById('cc-drawer-root')?.remove(); toast('Invoice issued.', 'success'); reload();
    }
  }

  async function loadBroker() {
    showLoading(body, 'Loading broker loads…');
    let rows; try { rows = await listPartnerLoads({ limit: 200 }); } catch (e) { showError(body, humanizeError(e), loadBroker); return; }
    rows = rows || [];
    // Inc 54 — open update requests to/from brokers (staff view)
    let reqs = []; try { reqs = (await updateRequests(null, 50)) || []; } catch (_) { reqs = []; }
    reqs = reqs.filter(r => r.status === 'open' || r.status === 'responded');
    const reqCard = reqs.length ? el('div', { class: 'lb-card', style: 'margin-bottom:10px' }, [
      el('b', null, 'Update requests (' + reqs.length + ' open)'),
      el('div', null, reqs.map(r => el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed #e2e8f0' }, [
        el('div', null, [
          el('div', null, [el('b', null, r.partner_name || 'partner'), el('span', { class: 'cc-sub' }, ' — ' + r.request)]),
          r.response ? el('div', { class: 'cc-sub', style: 'color:#16a34a' }, '↳ ' + r.response) : el('div', { class: 'cc-sub' }, 'awaiting partner response'),
        ]),
        manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await resolveUpdateRequest(r.id, 'resolve'); toast('Resolved', 'success'); loadBroker(); }
          catch (e) { ev.currentTarget.disabled = false; toast(humanizeError(e), 'error'); }
        } }, 'Resolve') : null,
      ].filter(Boolean)))),
    ]) : null;
    if (!rows.length) { mount(body, el('div', null, [reqCard, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No broker submissions yet.'))].filter(Boolean))); return; }
    mount(body, el('div', null, [reqCard, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Broker', 'Lane', 'Equip', 'Rate', 'Pickup', 'Status', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(l => {
        const act = el('td', null);
        act.appendChild(el('button', { class: 'lb-btn lb-btn-sm', onClick: () => docsDrawer(l) }, 'Docs'));
        if (manage) act.appendChild(el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-left:6px', onClick: () => askUpdateDrawer(l) }, 'Ask update'));
        if (manage && l.status === 'submitted') {
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', style: 'margin-left:6px', onClick: (ev) => decide(l.id, 'post', ev, loadBroker) }, 'Post to board'));
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-left:6px', onClick: (ev) => decide(l.id, 'decline', ev, loadBroker) }, 'Decline'));
        } else if (manage && l.status === 'accepted') {
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', style: 'margin-left:6px', onClick: (ev) => decide(l.id, 'post', ev, loadBroker) }, 'Post to board'));
        }
        return el('tr', null, [
          el('td', null, el('b', null, l.broker || '—')),
          el('td', null, (l.origin || '—') + ' → ' + (l.destination || '—')),
          el('td', null, l.equipment || '—'), el('td', null, money(l.rate)),
          el('td', null, l.pickup_date ? fmtDateTime(l.pickup_date) : '—'), el('td', null, pill(l.status)), act,
        ]);
      })),
    ]))].filter(Boolean)));
  }

  // Inc 54 — checklist review drawer: broker submissions with verify / reject-with-reason.
  async function docsDrawer(l) {
    const bodyEl = el('div', null, el('div', { class: 'cc-sub' }, 'Loading checklist…'));
    openDrawer('Documents — ' + (l.broker || ''), bodyEl, { subtitle: (l.origin || '?') + ' → ' + (l.destination || '?') });
    let items; try { items = await loadChecklist('partner_load', l.id); } catch (e) { mount(bodyEl, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
    const TONE2 = { required: 'amber', received: 'blue', verified: 'green', rejected: 'red', expired: 'red', waived: 'gray' };
    mount(bodyEl, el('div', null, (items || []).map(it => el('div', { class: 'lb-card', style: 'margin-bottom:8px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
        el('div', null, [el('b', null, it.label || it.doc_key), el('div', { class: 'cc-sub' }, 'from ' + it.required_from)]),
        el('span', { class: 'cc-pill cc-pill-' + (TONE2[it.status] || 'gray') }, it.status),
      ]),
      it.submitted_ref ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Submitted: ' + it.submitted_ref + (it.submitted_note ? ' — ' + it.submitted_note : '')) : null,
      it.review_reason ? el('div', { class: 'cc-sub', style: 'color:#dc2626' }, 'Rejected: ' + it.review_reason) : null,
      (manage && it.status === 'received') ? el('div', { style: 'margin-top:8px;display:flex;gap:6px;justify-content:flex-end' }, [
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await loadChecklistReview(it.id, 'verified'); toast('Verified', 'success'); docsDrawer(l); }
          catch (e) { ev.currentTarget.disabled = false; toast(humanizeError(e), 'error'); }
        } }, 'Verify'),
        el('button', { class: 'lb-btn lb-btn-sm', onClick: () => {
          const reason = prompt('Rejection reason (the broker will see this):');
          if (!reason || !reason.trim()) return;
          loadChecklistReview(it.id, 'rejected', reason.trim()).then(() => { toast('Rejected with reason', 'success'); docsDrawer(l); }).catch(e => toast(humanizeError(e), 'error'));
        } }, 'Reject'),
      ]) : null,
    ].filter(Boolean)))));
  }

  // Inc 54 — ask the broker for corrected/updated information.
  function askUpdateDrawer(l) {
    const ta = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'e.g. Please confirm the pickup number and facility hours' });
    const form = el('div', null, [
      el('label', { class: 'cc-field' }, [el('span', null, 'What do you need from ' + (l.broker || 'the broker') + '?'), ta]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        if (!ta.value.trim()) { alert('Request text is required.'); return; }
        try { await requestUpdate('partner_load', l.id, l.broker_org, ta.value.trim()); toast('Update requested — the broker sees it in their portal', 'success'); document.getElementById('cc-drawer-root')?.remove(); loadBroker(); }
        catch (e) { alert(humanizeError(e)); }
      } }, 'Send request')),
    ]);
    openDrawer('Request update — ' + (l.broker || ''), form, { subtitle: (l.origin || '?') + ' → ' + (l.destination || '?') });
  }

  async function loadShipper() {
    showLoading(body, 'Loading shipper freight…');
    let rows; try { rows = await listPartnerShipments({ limit: 200 }); } catch (e) { showError(body, humanizeError(e), loadShipper); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No shipper requests yet.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Shipper', 'Lane', 'Equip', 'Ready', 'Commodity', 'Status', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(s => {
        const act = el('td', null);
        if (manage && (s.status === 'requested' || s.status === 'quoted')) {
          if (s.status === 'requested') act.appendChild(el('button', { class: 'lb-btn lb-btn-sm', onClick: (ev) => decide2(s.id, 'quote', ev, loadShipper) }, 'Quote'));
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', style: 'margin-left:6px', onClick: (ev) => decide2(s.id, 'book', ev, loadShipper) }, 'Book'));
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-left:6px', onClick: (ev) => decide2(s.id, 'decline', ev, loadShipper) }, 'Decline'));
        }
        return el('tr', null, [
          el('td', null, el('b', null, s.shipper || '—')),
          el('td', null, (s.origin || '—') + ' → ' + (s.destination || '—')),
          el('td', null, s.equipment || '—'), el('td', null, s.ready_date ? fmtDateTime(s.ready_date) : '—'),
          el('td', null, s.commodity || '—'), el('td', null, pill(s.status)), act,
        ]);
      })),
    ])));
  }

  async function loadFacility() {
    showLoading(body, 'Loading dock appointments…');
    let rows; try { rows = await listPartnerAppointmentsAll(200); } catch (e) { showError(body, humanizeError(e), loadFacility); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No dock appointments yet.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Facility', 'When', 'Dir', 'Dock', 'Carrier', 'Ref', 'Status'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(a => el('tr', null, [
        el('td', null, el('b', null, a.facility || '—')),
        el('td', null, a.window_start ? fmtDateTime(a.window_start) : '—'), el('td', null, pill(a.direction)),
        el('td', null, a.dock || '—'), el('td', null, a.carrier_name || '—'), el('td', null, a.reference || '—'), el('td', null, pill(a.status)),
      ]))),
    ])));
  }

  async function decide(id, action, ev, reload) {
    const btn = ev.currentTarget; btn.disabled = true; const t = btn.textContent; btn.textContent = '…';
    try { const r = await decidePartnerLoad(id, action); toast(action === 'post' ? 'Load posted to the board.' : ('Load ' + (r && r.status) + '.'), 'success'); loadKpis(); reload(); }
    catch (e) { btn.disabled = false; btn.textContent = t; toast(humanizeError(e), 'error'); }
  }
  async function decide2(id, action, ev, reload) {
    const btn = ev.currentTarget; btn.disabled = true; const t = btn.textContent; btn.textContent = '…';
    try { const r = await decidePartnerShipment(id, action); toast('Shipment ' + (r && r.status) + '.', 'success'); loadKpis(); reload(); }
    catch (e) { btn.disabled = false; btn.textContent = t; toast(humanizeError(e), 'error'); }
  }

  renderTabs();
  loadKpis();
  route();
}

export default renderPartnerIntake;
