// loads.js — Loads & trips. Read cc_list_loads / cc_get_load; create via cc_create_load
// (loads.create), assign carrier via cc_assign_load and move status via cc_set_load_status
// (loads.assign, scope-checked + audited). Every action is re-authorized server-side.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, toolbar, searchBox, segmented, statusPill, openDrawer, fmtDate, money, card } from '../../shared/ui/components.js';
import { getLoadsList, getLoadDetail, createLoad, assignLoad, setLoadStatus, getCarriersDirectory } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STATUSES = [
  { value: '', label: 'All' }, { value: 'available', label: 'Available' },
  { value: 'booked', label: 'Booked' }, { value: 'in_transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
];

export function renderLoads(host) {
  let state = { search: '', status: '' };
  const listHost = el('div', { class: 'cc-table-wrap' });

  function header() {
    const actions = can('loads.create')
      ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: openCreate }, '+ Post a load')]
      : null;
    return el('div', null, [
      sectionHead('Loads & trips', 'Post freight, assign carriers and track every trip.', actions),
      toolbar([
        searchBox('Search origin or destination…', (v) => { state.search = v; load(); }),
        segmented(STATUSES, state.status, (v) => { state.status = v; load(); }),
      ]),
    ]);
  }

  async function load() {
    showLoading(listHost, 'Loading loads…');
    let rows;
    try { rows = await getLoadsList({ search: state.search || null, status: state.status || null, limit: 300 }); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No loads match these filters.'); return; }
    const table = el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [
        el('th', null, 'Lane'), el('th', null, 'Equipment'), el('th', null, 'Rate'),
        el('th', null, 'Miles'), el('th', null, 'Carrier'), el('th', null, 'Pickup'), el('th', null, 'Status'), el('th', null, ''),
      ])),
      el('tbody', null, rows.map(l => el('tr', { class: 'cc-row', onClick: () => openLoad(l.id) }, [
        el('td', null, [el('b', null, (l.origin || '?') + ' → ' + (l.destination || '?'))]),
        el('td', null, l.equipment || '—'),
        el('td', null, l.rate != null ? money(l.rate) : '—'),
        el('td', null, l.miles != null ? String(l.miles) : '—'),
        el('td', null, l.assigned_company || '—'),
        el('td', null, fmtDate(l.pickup_date)),
        el('td', null, statusPill(l.status)),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]);
    mount(listHost, table);
  }

  function openCreate() {
    const f = {};
    const inp = (key, ph, type) => { const i = el('input', { class: 'cc-input', placeholder: ph, type: type || 'text' }); i.addEventListener('input', () => f[key] = i.value); return i; };
    const origin = inp('origin', 'Origin (e.g. Dallas, TX)');
    const dest = inp('destination', 'Destination (e.g. Memphis, TN)');
    const equip = inp('equipment', 'Equipment (e.g. Dry Van)');
    const rate = inp('rate', 'Rate (USD)', 'number');
    const miles = inp('miles', 'Miles', 'number');
    const commodity = inp('commodity', 'Commodity');
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = '';
      if (!f.origin || !f.destination) { err.textContent = 'Origin and destination are required.'; return; }
      const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Posting…';
      try {
        await createLoad({ origin: f.origin, destination: f.destination, equipment: f.equipment || null,
          rate: f.rate ? Number(f.rate) : null, miles: f.miles ? Number(f.miles) : null, commodity: f.commodity || null });
        toast('Load posted', 'success'); drawer.close(); load();
      } catch (e) { err.textContent = humanizeError(e); btn.disabled = false; btn.textContent = 'Post load'; }
    } }, 'Post load');
    const drawer = openDrawer('Post a load', el('div', { class: 'cc-form' }, [
      el('label', null, 'Lane'), origin, dest,
      el('label', null, 'Details'), equip,
      el('div', { class: 'cc-form-2' }, [rate, miles]), commodity,
      err, submit,
    ]), { subtitle: 'New available load' });
  }

  async function openLoad(id) {
    const { body } = openDrawer('Load', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Trip detail & dispatch' });
    let l;
    try { l = await getLoadDetail(id); }
    catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const field = (label, val) => el('div', { class: 'cc-field' }, [el('span', null, label), el('b', null, val || '—')]);

    // assign carrier control
    const assignWrap = el('div', { class: 'cc-assign' });
    if (can('loads.assign')) {
      const sel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Assign carrier…')]);
      getCarriersDirectory({ status: 'active', limit: 200 }).then(cs => {
        (cs || []).forEach(c => sel.appendChild(el('option', { value: c.id }, (c.company || 'Carrier') + ' · ' + (c.home_base || ''))));
      }).catch(() => {});
      const go = el('button', { class: 'lb-btn lb-btn-secondary', onClick: async (ev) => {
        if (!sel.value) return;
        const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Assigning…';
        try { await assignLoad(id, sel.value); toast('Carrier assigned · load booked', 'success'); openLoad(id); load(); }
        catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; btn.textContent = 'Assign'; }
      } }, 'Assign');
      assignWrap.appendChild(el('div', { class: 'cc-form-row' }, [sel, go]));
    }

    // status transitions
    const statusWrap = el('div', { class: 'cc-status-row' });
    if (can('loads.assign')) {
      const targets = ['available', 'booked', 'in_transit', 'delivered', 'cancelled'].filter(s => s !== l.status);
      targets.forEach(s => statusWrap.appendChild(el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
        const btn = ev.currentTarget; const prev = btn.textContent; btn.disabled = true; btn.textContent = '…';
        try { await setLoadStatus(id, s); toast('Status → ' + s.replace(/_/g, ' '), 'success'); openLoad(id); load(); }
        catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; btn.textContent = prev; }
      } }, s.replace(/_/g, ' '))));
    }

    mount(body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, (l.origin || '?') + ' → ' + (l.destination || '?')), statusPill(l.status)]),
      card([
        field('Equipment', l.equipment), field('Commodity', l.commodity), field('Weight', l.weight),
        field('Rate', l.rate != null ? money(l.rate) : '—'), field('Miles', l.miles != null ? String(l.miles) : '—'),
        field('Carrier', l.assigned_company), field('Broker', l.broker),
        field('Pickup', fmtDate(l.pickup_date)), field('Delivery', fmtDate(l.delivery_date)),
      ], 'cc-fields'),
      can('loads.assign') ? el('h4', { class: 'cc-card-title', style: 'margin-top:18px' }, 'Dispatch') : '',
      assignWrap, statusWrap,
      (!can('loads.assign')) ? el('p', { class: 'cc-sub' }, 'You have view-only access to dispatch actions.') : '',
    ]));
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), listHost]));
  load();
}

export default renderLoads;
