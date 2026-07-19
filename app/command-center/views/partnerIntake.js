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
  loadChecklist, loadChecklistReview, requestUpdate, updateRequests, resolveUpdateRequest, partnerLoadReview,
} from '../../shared/api.js';
import { openDrawer } from '../../shared/ui/components.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const money = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const TONE = { submitted: 'amber', accepted: 'blue', declined: 'red', posted: 'green', covered: 'green', requested: 'amber', quoted: 'blue', booked: 'green', scheduled: 'blue', checked_in: 'amber', completed: 'green', no_show: 'red', cancelled: 'gray', inbound: 'blue', outbound: 'violet', sent: 'amber', payment_submitted: 'blue', paid: 'green', void: 'gray', draft: 'gray' };
const pill = (s) => el('span', { class: 'cc-pill cc-pill-' + (TONE[s] || 'gray') }, [el('i', { class: 'cc-pill-dot' }), (s || '').replace(/_/g, ' ')]);

export function renderPartnerIntake(host, focusId) {
  let focusOpened = false;
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
        const act = el('td', { style: 'min-width:170px' });
        const actW = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center' });
        act.appendChild(actW);
        if (manage && i.status !== 'paid' && i.status !== 'void') {
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (ev) => setInv(i.id, 'paid', ev) }, 'Mark paid'));
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', , onClick: (ev) => setInv(i.id, 'void', ev) }, 'Void'));
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

  async function reviewDrawer(l, reload) {
    const bodyEl = el('div', null, el('div', { class: 'cc-sub' }, 'Running pre-flight checks\u2026'));
    openDrawer('\ud83d\udd0d Load review \u2014 ' + (l.origin || '?') + ' \u2192 ' + (l.destination || '?'), bodyEl, { subtitle: (l.broker || '') + ' \u00b7 decide with everything on one screen' });
    let d; try { d = await partnerLoadReview(l.id); } catch (e) { mount(bodyEl, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
    const ld = d.load || {}, ck = d.checks || [], br = d.broker || {};
    const fails = ck.filter(c => !c.ok), warns = ck.filter(c => c.ok && c.warn);
    const passN = ck.length - fails.length;
    const det = ld.details || {}, acc = ld.accessorials || {};
    const kv = (k, v) => v == null || v === '' ? null : el('div', { style: 'display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed #eef2f7;font-size:.82rem' }, [el('span', { style: 'color:#64748b' }, k), el('b', { style: 'text-align:right' }, String(v))]);
    const secH = (t) => el('div', { style: 'font-size:.64rem;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;font-weight:800;margin:14px 0 6px' }, t);
    const scoreFg = fails.length ? '#dc2626' : warns.length ? '#d97706' : '#16a34a';
    const dTarget = det.direct_carrier_name || null;
    mount(bodyEl, el('div', null, [
      dTarget ? el('div', { style: 'background:#ede9fe;border:1.5px solid #c4b5fd;border-radius:14px;padding:12px 14px;margin-bottom:10px' }, [
        el('div', { style: 'font-weight:800;color:#5b21b6;font-size:.9rem' }, '\ud83c\udfaf DIRECT LOAD \u2014 exclusively for ' + dTarget),
        el('div', { class: 'cc-sub', style: 'margin-top:3px' }, 'The broker chose this carrier. Posting sends a 15-minute direct offer to ' + dTarget + ' ONLY \u2014 this load will NOT appear on the public board for any other carrier.'),
      ]) : null,
      // readiness score
      el('div', { style: 'display:flex;gap:12px;align-items:center;background:#f8fafc;border:1px solid #eef2f7;border-radius:14px;padding:12px 14px' }, [
        el('div', { style: 'font-size:1.6rem;font-weight:800;color:' + scoreFg }, passN + '/' + ck.length),
        el('div', null, [
          el('b', { style: 'color:' + scoreFg }, fails.length ? fails.length + ' blocking issue' + (fails.length === 1 ? '' : 's') + ' \u2014 not board-ready' : warns.length ? 'Board-ready with warnings' : 'Board-ready \u2014 all checks pass'),
          el('div', { class: 'cc-sub' }, 'Pre-flight checks run on the exact data carriers will see.'),
        ]),
      ]),
      el('div', { style: 'margin-top:8px' }, ck.map(c => el('div', { style: 'display:flex;gap:9px;align-items:flex-start;padding:6px 2px;border-bottom:1px solid #f8fafc' }, [
        el('span', { style: 'font-weight:800;color:' + (!c.ok ? '#dc2626' : c.warn ? '#d97706' : '#16a34a') }, !c.ok ? '\u2715' : c.warn ? '\u26a0' : '\u2713'),
        el('div', null, [el('div', { style: 'font-weight:700;font-size:.82rem' }, c.label), el('div', { class: 'cc-sub' }, c.detail || '')]),
      ]))),
      // market + duplicates + rate strips
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px' }, [
        el('div', { style: 'background:#eff6ff;border:1px solid #dbeafe;border-radius:12px;padding:10px 12px' }, [el('b', { style: 'font-size:1.1rem;color:#1d4ed8' }, String(d.matching_carriers || 0)), el('div', { class: 'cc-sub' }, 'published carriers match this equipment' + (ld.hazmat ? ' + hazmat' : ''))]),
        el('div', { style: 'background:' + ((d.duplicates_open || 0) > 0 ? '#fef2f2' : '#f0fdf4') + ';border:1px solid ' + ((d.duplicates_open || 0) > 0 ? '#fecaca' : '#bbf7d0') + ';border-radius:12px;padding:10px 12px' }, [el('b', { style: 'font-size:1.1rem;color:' + ((d.duplicates_open || 0) > 0 ? '#dc2626' : '#16a34a') }, String(d.duplicates_open || 0)), el('div', { class: 'cc-sub' }, 'open duplicates on this lane+date')]),
        el('div', { style: 'background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:10px 12px' }, [el('b', { style: 'font-size:1.1rem' }, d.rpm != null ? '$' + d.rpm + '/mi' : '\u2014'), el('div', { class: 'cc-sub' }, money(ld.rate) + ' \u00b7 ' + (ld.miles || '?') + ' mi (real road)')]),
      ]),
      // broker risk
      secH('Broker risk \u2014 ' + (br.name || '')),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        el('span', { class: 'cc-pill cc-pill-' + (br.org_status === 'active' ? 'green' : 'amber') }, 'account ' + (br.org_status || '?')),
        el('span', { class: 'cc-pill cc-pill-blue' }, (br.loads_posted || 0) + ' posted / ' + (br.loads_submitted || 0) + ' submitted'),
        (br.loads_rejected || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-amber' }, br.loads_rejected + ' rejected') : null,
        (br.loads_cancelled || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-red' }, br.loads_cancelled + ' cancelled') : null,
        (br.claims_pending_review || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-red' }, '\u26a0 ' + br.claims_pending_review + ' carrier claim(s) awaiting THIS broker') : null,
      ].filter(Boolean)),
      // full load detail
      secH('Exactly what the carrier will see (plus private fields)'),
      el('div', null, [
        kv('Pickup (private full)', ld.origin_full), kv('Delivery (private full)', ld.destination_full),
        kv('Board shows', (ld.origin || '') + ' \u2192 ' + (ld.destination || '')),
        kv('Schedule', [ld.pickup_date, ld.pickup_window, '\u2192', ld.delivery_date, ld.delivery_window].filter(Boolean).join(' ')),
        kv('Dock hours', [det.dock_hours_pickup, det.dock_hours_delivery].filter(Boolean).join(' / ')),
        kv('Equipment', [ld.equipment, det.load_size].filter(Boolean).join(' \u00b7 ')),
        kv('Freight', [ld.commodity, ld.weight ? ld.weight + ' lb' : null, det.pallets ? det.pallets + ' plt' : null, det.temperature ? det.temperature + '\u00b0F' : null, det.tarps].filter(Boolean).join(' \u00b7 ')),
        kv('Handling', [det.load_method_pickup, det.load_method_delivery, det.driver_assist_required ? 'driver assist REQ' : null, det.team_required ? 'TEAM REQ' : null].filter(Boolean).join(' \u00b7 ')),
        kv('Cargo value', det.cargo_value ? '$' + Number(det.cargo_value).toLocaleString() : null),
        kv('Rate card', 'det $' + (acc.detention_per_hr || '?') + '/hr\u00b7' + (acc.detention_free_hours || '?') + 'h free \u00b7 lay $' + (acc.layover_per_day || '?') + ' \u00b7 TONU $' + (acc.tonu || '?') + ' \u00b7 ' + (acc.lumper_policy || '?')),
        kv('Reference', ld.reference), kv('Submitted', ld.submitted_at ? fmtDateTime(ld.submitted_at) : null),
        kv('Notes', ld.notes),
      ].filter(Boolean)),
      // actions
      manage ? el('div', { class: 'cc-drawer-actions', style: 'margin-top:14px;display:flex;gap:8px;flex-wrap:wrap' }, [
        (l.status === 'submitted' || l.status === 'accepted') ? el('button', { class: 'lb-btn lb-btn-primary', style: 'flex:1', onClick: async (ev) => {
          if (fails.length && !confirm(fails.length + ' blocking issue(s):\n\n' + fails.map(f => '\u2715 ' + f.label).join('\n') + '\n\nPost to the board anyway?')) return;
          const b9 = ev.currentTarget; b9.disabled = true;
          try { await decidePartnerLoad(l.id, 'post'); toast('Load posted to the board.', 'success'); document.getElementById('cc-drawer-root')?.remove(); reload(); }
          catch (e) { b9.disabled = false; toast(humanizeError(e), 'error'); }
        } }, (dTarget ? '\u2705 Post \u2014 offer ONLY to ' + dTarget : '\u2705 Post to board') + (fails.length ? ' (override)' : '')) : null,
        fails.length || warns.length ? el('button', { class: 'lb-btn', style: 'flex:1', onClick: async (ev) => {
          const msg = 'Before we can post this load, please fix:\n' + fails.concat(warns).map(f => '\u2022 ' + f.label + ' \u2014 ' + (f.detail || '')).join('\n');
          const b9 = ev.currentTarget; b9.disabled = true;
          try { await requestUpdate('partner_load', l.id, l.broker_org, msg); toast('Update request sent \u2014 auto-drafted from the failed checks.', 'success'); document.getElementById('cc-drawer-root')?.remove(); reload(); }
          catch (e) { b9.disabled = false; toast(humanizeError(e), 'error'); }
        } }, '\u2709 Ask update (auto-drafted)') : null,
        l.status === 'submitted' ? el('button', { class: 'lb-btn', style: 'color:#b91c1c', onClick: async (ev) => {
          if (!confirm('Decline this load? The broker is notified.')) return;
          const b9 = ev.currentTarget; b9.disabled = true;
          try { await decidePartnerLoad(l.id, 'decline'); toast('Declined.', 'success'); document.getElementById('cc-drawer-root')?.remove(); reload(); }
          catch (e) { b9.disabled = false; toast(humanizeError(e), 'error'); }
        } }, 'Decline') : null,
      ].filter(Boolean)) : null,
    ].filter(Boolean)));
  }

  async function loadBroker() {
    showLoading(body, 'Loading broker loads…');
    let rows; try { rows = await listPartnerLoads({ limit: 200 }); } catch (e) { showError(body, humanizeError(e), loadBroker); return; }
    rows = rows || [];
    if (focusId && !focusOpened) {
      const hit = rows.find(l => l.id === focusId || l.posted_load_id === focusId);
      if (hit) { focusOpened = true; setTimeout(() => reviewDrawer(hit, loadBroker), 250); }
    }
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
          const b9 = ev.currentTarget; b9.disabled = true;
          try { await resolveUpdateRequest(r.id, 'resolve'); toast('Resolved', 'success'); loadBroker(); }
          catch (e) { b9.disabled = false; toast(humanizeError(e), 'error'); }
        } }, 'Resolve') : null,
      ].filter(Boolean)))),
    ]) : null;
    if (!rows.length) { mount(body, el('div', null, [reqCard, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No broker submissions yet.'))].filter(Boolean))); return; }
    mount(body, el('div', null, [reqCard, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Broker', 'Lane', 'Equip', 'Rate', 'Pickup', 'Status', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(l => {
        const act = el('td', { style: 'min-width:170px' });
        const actW = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center' });
        act.appendChild(actW);
        const exp9 = !!(l.pickup_date && new Date(String(l.pickup_date).slice(0, 10) + 'T23:59:59') < new Date());
        actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => reviewDrawer(l, loadBroker) }, '\ud83d\udd0d Review'));
        actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', , onClick: () => docsDrawer(l) }, 'Docs'));
        if (manage && exp9 && ['submitted', 'accepted'].indexOf(String(l.status || '')) >= 0) {
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', style: 'background:#fef3c7;color:#92400e;border-color:#fcd34d;font-weight:800', onClick: async (ev) => {
            const b9 = ev.currentTarget; b9.disabled = true; b9.textContent = 'Sending\u2026';
            try { const { ccAskReschedule } = await import('../../shared/api.js'); await ccAskReschedule(l.id); b9.textContent = '\u2713 Broker notified'; toast('Broker emailed + notified to update the pickup schedule.', 'success'); }
            catch (e9) { b9.disabled = false; b9.textContent = '\u23f0 Ask reschedule'; toast((e9 && e9.message) || 'Failed', 'error'); }
          } }, '\u23f0 Ask reschedule'));
        }
        if (manage) actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', , onClick: () => askUpdateDrawer(l) }, 'Ask update'));
        if (manage && l.status === 'submitted' && !exp9) {
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', , onClick: (ev) => decide(l.id, 'post', ev, loadBroker) }, 'Quick post'));
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', , onClick: (ev) => decide(l.id, 'decline', ev, loadBroker) }, 'Decline'));
        } else if (manage && l.status === 'submitted' && exp9) {
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', , onClick: (ev) => decide(l.id, 'decline', ev, loadBroker) }, 'Decline'));
        } else if (manage && l.status === 'accepted' && !exp9) {
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', , onClick: (ev) => decide(l.id, 'post', ev, loadBroker) }, 'Post to board'));
        }
        return el('tr', null, [
          el('td', null, el('b', null, l.broker || '—')),
          el('td', null, [
            (l.origin || '—') + ' → ' + (l.destination || '—'),
            l.direct_carrier ? el('div', { style: 'margin-top:3px' }, el('span', { style: 'padding:2.5px 10px;border-radius:999px;font-size:.66rem;font-weight:800;background:#ede9fe;color:#6d28d9' }, '\ud83c\udfaf DIRECT \u2192 ' + l.direct_carrier)) : null,
          ].filter(Boolean)),
          el('td', null, l.equipment || '—'), el('td', null, money(l.rate)),
          el('td', null, [l.pickup_date ? fmtDateTime(l.pickup_date) : '—',
            (exp9 && ['submitted', 'accepted', 'quoted'].indexOf(String(l.status || '')) >= 0) ? el('div', { style: 'margin-top:3px' }, el('span', { style: 'padding:2.5px 10px;border-radius:999px;font-size:.66rem;font-weight:800;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca' }, '\u23f0 EXPIRED \u2014 cannot post')) : null,
          ].filter(Boolean)), el('td', null, pill(l.status)), act,
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
          const b9 = ev.currentTarget; b9.disabled = true;
          try { await loadChecklistReview(it.id, 'verified'); toast('Verified', 'success'); docsDrawer(l); }
          catch (e) { b9.disabled = false; toast(humanizeError(e), 'error'); }
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
        const act = el('td', { style: 'min-width:170px' });
        const actW = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center' });
        act.appendChild(actW);
        if (manage && (s.status === 'requested' || s.status === 'quoted')) {
          if (s.status === 'requested') actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', onClick: (ev) => decide2(s.id, 'quote', ev, loadShipper) }, 'Quote'));
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', , onClick: (ev) => decide2(s.id, 'book', ev, loadShipper) }, 'Book'));
          actW.appendChild(el('button', { class: 'lb-btn lb-btn-sm', , onClick: (ev) => decide2(s.id, 'decline', ev, loadShipper) }, 'Decline'));
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
