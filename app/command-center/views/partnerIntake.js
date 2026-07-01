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
} from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const money = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const TONE = { submitted: 'amber', accepted: 'blue', declined: 'red', posted: 'green', requested: 'amber', quoted: 'blue', booked: 'green', scheduled: 'blue', checked_in: 'amber', completed: 'green', no_show: 'red', cancelled: 'gray', inbound: 'blue', outbound: 'violet' };
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

  const tabs = [['broker', 'Broker loads'], ['shipper', 'Shipper freight'], ['facility', 'Facility docks']];
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
    return loadFacility();
  }

  async function loadBroker() {
    showLoading(body, 'Loading broker loads…');
    let rows; try { rows = await listPartnerLoads({ limit: 200 }); } catch (e) { showError(body, humanizeError(e), loadBroker); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No broker submissions yet.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Broker', 'Lane', 'Equip', 'Rate', 'Pickup', 'Status', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(l => {
        const act = el('td', null);
        if (manage && l.status === 'submitted') {
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (ev) => decide(l.id, 'post', ev, loadBroker) }, 'Post to board'));
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-left:6px', onClick: (ev) => decide(l.id, 'decline', ev, loadBroker) }, 'Decline'));
        } else if (manage && l.status === 'accepted') {
          act.appendChild(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (ev) => decide(l.id, 'post', ev, loadBroker) }, 'Post to board'));
        }
        return el('tr', null, [
          el('td', null, el('b', null, l.broker || '—')),
          el('td', null, (l.origin || '—') + ' → ' + (l.destination || '—')),
          el('td', null, l.equipment || '—'), el('td', null, money(l.rate)),
          el('td', null, l.pickup_date ? fmtDateTime(l.pickup_date) : '—'), el('td', null, pill(l.status)), act,
        ]);
      })),
    ])));
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
