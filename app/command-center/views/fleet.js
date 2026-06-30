// fleet.js — Enterprise Completion: Fleet & execution. Drivers and trucks per carrier with
// license/medical expiry tracking (feeds the daily compliance scan). Reads/writes via
// cc_fleet_* / cc_*_driver / cc_*_truck RPCs (fleet.view/manage), RBAC-gated + audited.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, fmtDate, card } from '../../shared/ui/components.js';
import { fleetOverview, listDrivers, upsertDriver, upsertTruck, getCarriersDirectory } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const TABS = [{ value: 'drivers', label: 'Drivers' }, { value: 'trucks', label: 'Trucks' }];

export function renderFleet(host) {
  let tab = 'drivers';
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await fleetOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Drivers', value: String(n('drivers')), sub: 'active', accent: 'blue' }),
      statCard({ icon: 'truck', label: 'Trucks', value: String(n('trucks')), sub: n('trailers') + ' trailers', accent: 'violet' }),
      statCard({ icon: 'shield', label: 'License expiring', value: String(n('license_expiring')), sub: 'next 30 days', accent: n('license_expiring') ? 'amber' : 'green' }),
      statCard({ icon: 'flag', label: 'Open exceptions', value: String(n('open_exceptions')), sub: 'trip issues', accent: n('open_exceptions') ? 'red' : 'green' }),
    ]));
  }

  function header() {
    const actions = can('fleet.manage') ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: () => (tab === 'trucks' ? openTruck() : openDriver()) }, tab === 'trucks' ? '+ Add truck' : '+ Add driver')] : null;
    return el('div', null, [
      sectionHead('Fleet & execution', 'Drivers and trucks per carrier. License & medical expiry feed the compliance automation.', actions),
      kpiHost,
      toolbar([ segmented(TABS, tab, (v) => { tab = v; route(); }) ]),
    ]);
  }
  function route() { mount(host, el('div', { class: 'cc-view' }, [header(), bodyHost])); if (tab === 'trucks') loadTrucks(); else loadDrivers(); }

  async function loadDrivers() {
    showLoading(bodyHost, 'Loading drivers…');
    let rows; try { rows = await listDrivers({ limit: 300 }); } catch (e) { showError(bodyHost, humanizeError(e), loadDrivers); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No drivers yet. Add one to start building the fleet.'); return; }
    const soon = (d) => d && new Date(d) <= new Date(Date.now() + 30 * 86400000);
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Driver'), el('th', null, 'Carrier'), el('th', null, 'Phone'), el('th', null, 'License'), el('th', null, 'License exp'), el('th', null, 'Medical exp'), el('th', null, 'Status')])),
      el('tbody', null, rows.map(d => el('tr', null, [
        el('td', null, el('b', null, d.name)),
        el('td', null, d.carrier || '—'),
        el('td', null, d.phone || '—'),
        el('td', null, d.license_no || '—'),
        el('td', null, d.license_exp ? el('span', { class: 'cc-pill cc-pill-' + (soon(d.license_exp) ? 'amber' : 'gray') }, fmtDate(d.license_exp)) : '—'),
        el('td', null, d.medical_exp ? el('span', { class: 'cc-pill cc-pill-' + (soon(d.medical_exp) ? 'amber' : 'gray') }, fmtDate(d.medical_exp)) : '—'),
        el('td', null, statusPill(d.status)),
      ]))),
    ]));
  }
  function loadTrucks() { showEmpty(bodyHost, can('fleet.manage') ? 'Use “Add truck” to register trucks. Truck list view is available via the fleet API.' : 'Trucks are managed by fleet staff.'); }

  async function carrierField() {
    let carriers = [];
    try { carriers = await getCarriersDirectory({ limit: 200 }); } catch (_) {}
    const sel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Select carrier…'), ...carriers.map(c => el('option', { value: c.id }, c.name))]);
    return sel;
  }

  async function openDriver() {
    const drawer = openDrawer('Add driver', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Driver qualification' });
    const carSel = await carrierField();
    const f = {};
    const inp = (k, ph, type) => { const i = el('input', { class: 'cc-input', placeholder: ph, type: type || 'text' }); i.addEventListener('input', () => f[k] = i.value); return i; };
    carSel.addEventListener('change', () => f.carrier = carSel.value);
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; if (!f.carrier || !f.name) { err.textContent = 'Carrier and driver name required.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
      try { await upsertDriver({ carrier: f.carrier, name: f.name, phone: f.phone || null, licenseNo: f.licenseNo || null, licenseExp: f.licenseExp || null, medicalExp: f.medicalExp || null });
        toast('Driver added', 'success'); drawer.close(); loadDrivers(); loadKpis();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save driver'; }
    } }, 'Save driver');
    mount(drawer.body, el('div', { class: 'cc-form' }, [
      el('label', { class: 'cc-sub' }, 'Carrier'), carSel,
      inp('name', 'Driver name'), inp('phone', 'Phone'), inp('licenseNo', 'License #'),
      el('div', { class: 'cc-form-2' }, [el('div', null, [el('label', { class: 'cc-sub' }, 'License exp'), inp('licenseExp', '', 'date')]), el('div', null, [el('label', { class: 'cc-sub' }, 'Medical exp'), inp('medicalExp', '', 'date')])]),
      err, submit,
    ]));
  }

  async function openTruck() {
    const drawer = openDrawer('Add truck', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Power unit' });
    const carSel = await carrierField();
    const f = {};
    const inp = (k, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph }); i.addEventListener('input', () => f[k] = i.value); return i; };
    carSel.addEventListener('change', () => f.carrier = carSel.value);
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; if (!f.carrier || !f.unit) { err.textContent = 'Carrier and unit # required.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
      try { await upsertTruck({ carrier: f.carrier, unit: f.unit, plate: f.plate || null, vin: f.vin || null, equipment: f.equipment || null });
        toast('Truck added', 'success'); drawer.close(); loadKpis();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save truck'; }
    } }, 'Save truck');
    mount(drawer.body, el('div', { class: 'cc-form' }, [
      el('label', { class: 'cc-sub' }, 'Carrier'), carSel,
      inp('unit', 'Unit #'), inp('plate', 'Plate'), inp('vin', 'VIN'), inp('equipment', 'Equipment (Dry Van, Reefer…)'),
      err, submit,
    ]));
  }

  route(); loadKpis();
}

export default renderFleet;
