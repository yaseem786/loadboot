// trips.js — Wave 3 Loads / Dispatch / Trips. Trip board (lifecycle) + trip detail
// (route, driver, stops, status timeline, advance status, add note). A trip is the
// execution record of a booked load. Reads/writes via cc_dispatch_* / cc_*_trip RPCs
// (dispatch.view / dispatch.manage), all RBAC-gated + audited server-side. Status changes
// sync the parent load and emit domain events into the Automation Core (driver-notify,
// check-call, invoice-ready tasks).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, money, fmtDate, fmtDateTime, card } from '../../shared/ui/components.js';
import { dispatchOverview, listTrips, getTrip, createTrip, advanceTrip, addTripNote, getLoadsList, getCarriersDirectory } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STATUSES = [
  { value: '', label: 'All' }, { value: 'planned', label: 'Planned' }, { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_transit', label: 'In transit' }, { value: 'delivered', label: 'Delivered' }, { value: 'invoiced', label: 'Invoiced' },
];
const TONE = { planned: 'gray', dispatched: 'blue', in_transit: 'amber', delivered: 'green', invoiced: 'violet', canceled: 'red' };
const NEXT = { planned: 'dispatched', dispatched: 'in_transit', in_transit: 'delivered', delivered: 'invoiced' };
const NEXT_LABEL = { dispatched: 'Dispatch', in_transit: 'Mark in transit', delivered: 'Mark delivered', invoiced: 'Mark invoiced' };

export function renderTrips(host) {
  let state = { status: '', search: '' };
  const kpiHost = el('div');
  const listHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await dispatchOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'truck', label: 'Active trips', value: String(n('active_trips')), sub: n('in_transit') + ' in transit', accent: 'blue' }),
      statCard({ icon: 'grid', label: 'Awaiting dispatch', value: String(n('awaiting_dispatch')), sub: 'booked, no trip', accent: 'amber' }),
      statCard({ icon: 'check', label: 'Delivered', value: String(n('delivered')), sub: 'completed', accent: 'green' }),
      statCard({ icon: 'doc', label: 'Needs invoice', value: String(n('needs_invoice')), sub: 'POD + billing', accent: n('needs_invoice') > 0 ? 'violet' : 'green' }),
    ]));
  }

  function header() {
    const actions = can('dispatch.manage') ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: openCreate }, '+ New trip')] : null;
    return el('div', null, [
      sectionHead('Loads, Dispatch & Trips', 'Dispatch booked loads and track trips end to end. Status changes auto-create driver, check-call and invoice tasks.', actions),
      kpiHost,
      toolbar([ searchBox('Search route, carrier or driver…', (v) => { state.search = v; loadList(); }), segmented(STATUSES, state.status, (v) => { state.status = v; loadList(); }) ]),
    ]);
  }

  async function loadList() {
    showLoading(listHost, 'Loading trips…');
    let rows; try { rows = await listTrips({ status: state.status || null, search: state.search || null, limit: 300 }); }
    catch (e) { showError(listHost, humanizeError(e), loadList); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No trips yet. Create a trip from a booked load to start dispatching.'); return; }
    mount(listHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [ el('th', null, 'Route'), el('th', null, 'Carrier'), el('th', null, 'Driver'), el('th', null, 'Status'), el('th', null, 'Rate'), el('th', null, 'Pickup'), el('th', null, '') ])),
      el('tbody', null, rows.map(t => el('tr', { class: 'cc-row', onClick: () => openTrip(t.id) }, [
        el('td', null, el('b', null, (t.origin || '—') + '  →  ' + (t.destination || '—'))),
        el('td', null, t.carrier || '—'),
        el('td', null, t.driver_name || '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (TONE[t.status] || 'gray') }, (t.status || '').replace('_', ' '))),
        el('td', null, t.rate != null ? money(t.rate) : '—'),
        el('td', null, t.scheduled_pickup ? fmtDate(t.scheduled_pickup) : '—'),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  // create a trip from a booked/available load
  async function openCreate() {
    const drawer = openDrawer('New trip', el('div', { class: 'lb-state lb-loading' }, 'Loading loads…'), { subtitle: 'Dispatch a load — assign carrier & driver' });
    let loads, carriers;
    try { [loads, carriers] = await Promise.all([getLoadsList({ limit: 200 }), getCarriersDirectory({ limit: 200 })]); }
    catch (e) { mount(drawer.body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const bookable = (loads || []).filter(l => l.status === 'booked' || l.status === 'available');
    const f = {};
    const loadSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Select a load…'),
      ...bookable.map(l => el('option', { value: l.id }, (l.origin || '?') + ' → ' + (l.destination || '?') + (l.rate != null ? ' · $' + l.rate : '')))]);
    loadSel.addEventListener('change', () => f.load = loadSel.value);
    const carSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Carrier (optional)…'),
      ...(carriers || []).map(c => el('option', { value: c.id }, c.name))]);
    carSel.addEventListener('change', () => f.carrier = carSel.value);
    const inp = (k, ph, type) => { const i = el('input', { class: 'cc-input', placeholder: ph, type: type || 'text' }); i.addEventListener('input', () => f[k] = i.value); return i; };
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; if (!f.load) { err.textContent = 'Pick a load to dispatch.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Creating…';
      try { const id = await createTrip({ load: f.load, carrier: f.carrier || null, driverName: f.driver || null, driverPhone: f.phone || null, truck: f.truck || null,
              scheduledPickup: f.pickup || null, scheduledDelivery: f.delivery || null });
        toast('Trip created', 'success'); drawer.close(); openTrip(id); loadList(); loadKpis();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Create trip'; }
    } }, 'Create trip');
    mount(drawer.body, el('div', { class: 'cc-form' }, [
      el('label', { class: 'cc-sub' }, 'Load'), loadSel,
      el('label', { class: 'cc-sub' }, 'Carrier'), carSel,
      el('div', { class: 'cc-form-2' }, [inp('driver', 'Driver name'), inp('phone', 'Driver phone')]),
      inp('truck', 'Truck / unit #'),
      el('div', { class: 'cc-form-2' }, [el('div', null, [el('label', { class: 'cc-sub' }, 'Pickup'), inp('pickup', '', 'datetime-local')]),
        el('div', null, [el('label', { class: 'cc-sub' }, 'Delivery'), inp('delivery', '', 'datetime-local')])]),
      err, submit,
    ]));
  }

  async function openTrip(id) {
    const { body } = openDrawer('Trip', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Route, driver, timeline & status' });
    let t; try { t = await getTrip(id); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v || '—')]);

    const advanceRow = el('div', { class: 'cc-status-row', style: 'margin-top:6px' });
    if (can('dispatch.manage')) {
      const nxt = NEXT[t.status];
      if (nxt) advanceRow.appendChild(el('button', { class: 'cc-chip-btn', onClick: () => advance(id, nxt) }, NEXT_LABEL[nxt]));
      if (['planned', 'dispatched', 'in_transit'].includes(t.status))
        advanceRow.appendChild(el('button', { class: 'cc-chip-btn', onClick: () => advance(id, 'canceled') }, 'Cancel trip'));
    }

    const stops = (t.stops || []);
    const stopList = stops.length ? el('div', { class: 'cc-doclist' }, stops.map(s => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, (s.kind || '').toUpperCase() + ' · ' + (s.location || '—')),
        el('div', { class: 'cc-sub' }, s.scheduled_at ? 'scheduled ' + fmtDateTime(s.scheduled_at) : 'no schedule')]),
    ]))) : el('div', { class: 'cc-sub' }, 'No stops.');

    const events = (t.events || []);
    const timeline = events.length ? el('div', { class: 'cc-doclist' }, events.map(e => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [
        el('b', null, e.kind === 'status' ? ((e.from || '—') + ' → ' + (e.to || '—')) : 'Note'),
        el('div', { class: 'cc-sub' }, [(e.note || '') + (e.location ? ' · ' + e.location : ''), ' · ' + fmtDateTime(e.created_at)]),
      ]),
    ]))) : el('div', { class: 'cc-sub' }, 'No events yet.');

    const noteInput = el('input', { class: 'cc-input', placeholder: 'Add a check-call note…' });
    const addRow = can('dispatch.manage') ? el('div', { class: 'cc-form-row' }, [ noteInput,
      el('button', { class: 'lb-btn lb-btn-secondary', onClick: async (ev) => {
        if (!noteInput.value) return; const b = ev.currentTarget; b.disabled = true; b.textContent = '…';
        try { await addTripNote(id, noteInput.value); toast('Note added', 'success'); openTrip(id); }
        catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = 'Add'; }
      } }, 'Add') ]) : '';

    mount(body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, (t.origin || '—') + ' → ' + (t.destination || '—')),
        el('span', { class: 'cc-pill cc-pill-' + (TONE[t.status] || 'gray') }, (t.status || '').replace('_', ' '))]),
      card([ field('Carrier', t.carrier), field('Driver', t.driver_name), field('Phone', t.driver_phone),
        field('Truck', t.truck_no), field('Rate', t.rate != null ? money(t.rate) : '—'), field('Miles', t.miles != null ? String(t.miles) : '—') ], 'cc-fields'),
      can('dispatch.manage') ? el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Advance status') : '',
      advanceRow,
      el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Stops'),
      stopList,
      el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Timeline'),
      addRow, timeline,
    ]));

    async function advance(tid, status) {
      try { await advanceTrip(tid, status, null, null); toast('Trip → ' + status.replace('_', ' '), 'success'); openTrip(tid); loadList(); loadKpis(); }
      catch (e) { toast(humanizeError(e), 'error'); }
    }
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), listHost]));
  loadKpis(); loadList();
}

export default renderTrips;
