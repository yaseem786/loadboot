// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// loads.js — Loads & trips, big-brand edition. Posting now runs through the broker-grade
// 5-step wizard (views/loadWizard.js — external-board source attribution, standards-floor
// rate card, duplicate radar, geo pins). The board auto-refreshes live every 30s; every
// load opens into a command drawer with the full rate card + source dossier, one-click
// Assign (cc_assign_load), Send offers (Match Center) and 🛰 Live tracking — the same
// milestone/map/geofence view the broker gets, powered by cc_staff_track_load.
// All actions stay re-authorized server-side (loads.create / loads.assign), unchanged.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, toolbar, searchBox, segmented, statusPill, statCard, openDrawer, fmtDate, money, ago } from '../../shared/ui/components.js';
import { getLoadsList, getLoadDetail, assignLoad, setLoadStatus, getCarriersDirectory } from '../../shared/api.js';
import { openLoadWizard } from './loadWizard.js';
import { openLoadTracker } from './loadTracker.js';
import { openMatch } from './matchCenter.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STATUSES = [
  { value: '', label: 'All' }, { value: 'available', label: 'Available' },
  { value: 'booked', label: 'Booked' }, { value: 'in_transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
];
const SRC_TONE = { verified: 'green', partial: 'amber', unverified: 'red' };

export function renderLoads(host, focusId) {
  let state = { search: '', status: '' };
  let alive = true, timer = null, lastRows = [];
  const kpiHost = el('div');
  const listHost = el('div', { class: 'cc-table-wrap' });
  const liveBadge = el('span', { class: 'cc-sub', style: 'font-weight:800;color:#16a34a' }, '● LIVE');

  function header() {
    const actions = can('loads.create')
      ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: () => openLoadWizard({ onDone: () => load() }) }, '+ Post a load')]
      : null;
    return el('div', null, [
      sectionHead('Loads & trips', 'Post freight through the broker-grade wizard, cover it with verified carriers and watch every trip live.', actions),
      kpiHost,
      toolbar([
        searchBox('Search origin or destination…', (v) => { state.search = v; load(); }),
        segmented(STATUSES, state.status, (v) => { state.status = v; load(); }),
        liveBadge,
      ]),
    ]);
  }

  function kpis(rows) {
    const n = (s) => rows.filter(r => r.status === s).length;
    const open = rows.filter(r => r.status === 'available');
    const openVal = open.reduce((a, r) => a + (Number(r.rate) || 0), 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Available', value: String(n('available')), sub: money(openVal) + ' on the board', accent: 'blue', onClick: () => { state.status = 'available'; load(); } }),
      statCard({ icon: 'truck', label: 'Booked', value: String(n('booked')), sub: 'covered, awaiting dispatch', accent: 'amber', onClick: () => { state.status = 'booked'; load(); } }),
      statCard({ icon: 'trend', label: 'In transit', value: String(n('in_transit')), sub: 'live GPS in Loads & trips', accent: 'violet', onClick: () => { state.status = 'in_transit'; load(); } }),
      statCard({ icon: 'check', label: 'Delivered', value: String(n('delivered')), sub: 'ready for settlement', accent: 'green', onClick: () => { state.status = 'delivered'; load(); } }),
    ]));
  }

  function srcBadge(r) {
    const prov = r.source_provider || (r.source_type === 'staff_entered' ? 'Staff' : r.source_type === 'partner_portal' ? 'Broker portal' : r.source_type || '');
    if (!prov) return '';
    const tone = SRC_TONE[r.verification_state] || 'gray';
    return el('span', { class: 'cc-pill cc-pill-' + tone, title: 'Verification: ' + (r.verification_state || '—') }, String(prov));
  }

  async function load(silent) {
    if (!silent) showLoading(listHost, 'Loading loads…');
    let rows;
    try { rows = await getLoadsList({ search: state.search || null, status: state.status || null }); }
    catch (e) { if (!silent) showError(listHost, humanizeError(e), () => load()); return; }
    rows = rows || []; lastRows = rows;
    kpis(rows);
    if (!rows.length) { showEmpty(listHost, 'No loads match. Post one with the wizard — it is live for carriers the moment you finish.'); return; }
    mount(listHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Lane', 'Equipment', 'Rate', 'Pickup', 'Status', 'Source', 'Carrier', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row', onClick: () => openLoad(r.id) }, [
        el('td', null, [el('b', null, (r.origin || '?') + ' → ' + (r.destination || '?')), el('div', { class: 'cc-sub' }, (r.miles ? r.miles + ' mi' : '') + (r.created_at ? ' · posted ' + (ago(r.created_at) || '') : ''))]),
        el('td', null, r.equipment || '—'),
        el('td', null, [el('b', null, r.rate != null ? money(r.rate) : '—'), (r.rate && r.miles) ? el('div', { class: 'cc-sub' }, '$' + (Number(r.rate) / Number(r.miles)).toFixed(2) + '/mi') : '']),
        el('td', null, fmtDate(r.pickup_date)),
        el('td', null, statusPill(r.status)),
        el('td', null, srcBadge(r)),
        el('td', null, r.assigned_company || '—'),
        el('td', null, (r.status === 'booked' || r.status === 'in_transit')
          ? el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onClick: (e) => { e.stopPropagation(); openLoadTracker(r); } }, '🛰 Track')
          : ''),
      ]))),
    ]));
  }

  function tick() {
    if (!alive || !document.body.contains(listHost)) { alive = false; clearTimeout(timer); return; }
    load(true).finally(() => { timer = setTimeout(tick, 30000); });
  }

  async function openLoad(id) {
    const { body } = openDrawer('Load', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Trip detail & dispatch' });
    let l; try { l = await getLoadDetail(id); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!l) { mount(body, el('div', { class: 'lb-state' }, 'Not found.')); return; }
    const fm = l.field_meta || {}; const acc = fm.accessorials || {};
    const det = l.details || {}; const src = det.source || {};

    const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, (v == null || v === '') ? '—' : String(v))]);

    // assign carrier control (unchanged contract: cc_assign_load)
    const assignWrap = el('div', { class: 'cc-assign' });
    if (can('loads.assign')) {
      const sel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Assign carrier…')]);
      getCarriersDirectory({ status: 'active', limit: 200 }).then(cs => {
        (cs || []).forEach(c => sel.appendChild(el('option', { value: c.id }, (c.company || 'Carrier') + ' · ' + (c.home_base || ''))));
      }).catch(() => {});
      const go = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
        if (!sel.value) return;
        const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Assigning…';
        try { await assignLoad(id, sel.value); toast('Carrier assigned · load booked', 'success'); openLoad(id); load(); }
        catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; btn.textContent = 'Assign'; }
      } }, 'Assign');
      assignWrap.appendChild(el('div', { class: 'cc-form-row' }, [sel, go]));
    }

    // status transitions (unchanged contract: cc_set_load_status)
    const statusWrap = el('div', { class: 'cc-status-row' });
    if (can('loads.assign')) {
      const targets = ['available', 'booked', 'in_transit', 'delivered', 'cancelled'].filter(s => s !== l.status);
      targets.forEach(s => statusWrap.appendChild(el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
        const btn = ev.currentTarget; const prev = btn.textContent; btn.disabled = true; btn.textContent = '…';
        try { await setLoadStatus(id, s); toast('Status → ' + s, 'success'); openLoad(id); load(); }
        catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; btn.textContent = prev; }
      } }, '→ ' + s)));
    }

    mount(body, el('div', null, [
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' }, [
        el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => openLoadTracker(l) }, '🛰 Live tracking'),
        can('loads.assign') ? el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onClick: () => openMatch(l) }, '🎯 Send offers') : '',
        statusPill(l.status),
        srcBadge(l),
      ]),
      el('div', { class: 'cc-fields' }, [
        field('Lane', (l.origin || '?') + ' → ' + (l.destination || '?')),
        field('Full addresses', [l.origin_full, l.destination_full].filter(Boolean).join(' → ')),
        field('Equipment', (l.equipment || '—') + (det.load_size ? ' · ' + det.load_size : '') + (det.team_required ? ' · TEAM' : '') + (l.hazmat ? ' · ☢ HAZMAT' : '')),
        field('Freight', [l.commodity, l.weight, det.pallets ? det.pallets + ' plt' : null, det.temperature, det.tarps].filter(Boolean).join(' · ')),
        field('Rate', l.rate != null ? money(l.rate) + (l.miles ? ' · $' + (Number(l.rate) / Number(l.miles)).toFixed(2) + '/mi' : '') : '—'),
        field('Miles', l.miles),
        field('Pickup', fmtDate(l.pickup_date) + (fm.pickup_window ? ' · ' + fm.pickup_window : '') + (fm.appointment_required ? ' · appt' : '') + (String(acc.fcfs) === 'true' ? ' · FCFS' : '')),
        field('Delivery', fmtDate(l.delivery_date) + (fm.delivery_window ? ' · ' + fm.delivery_window : '')),
        field('Carrier', l.assigned_company),
        field('Broker / customer', l.broker),
      ]),
      (acc.detention_per_hr) ? el('div', null, [
        el('h4', { class: 'cc-card-title', style: 'margin-top:14px' }, 'Rate card — what the carrier can claim'),
        el('div', { class: 'cc-fields' }, [
          field('Detention', '$' + acc.detention_per_hr + '/hr after ' + acc.detention_free_hours + 'h'),
          field('Layover', '$' + acc.layover_per_day + '/day'),
          field('TONU', '$' + acc.tonu),
          field('Lumper', acc.lumper_policy),
          acc.driver_assist ? field('Driver assist', '$' + acc.driver_assist + '/stop') : '',
          acc.extra_stop ? field('Extra stop', '$' + acc.extra_stop + '/stop') : '',
        ]),
      ]) : '',
      (src.board || l.source_provider) ? el('div', null, [
        el('h4', { class: 'cc-card-title', style: 'margin-top:14px' }, 'Source dossier'),
        el('div', { class: 'cc-fields' }, [
          field('Board', src.board || l.source_provider),
          field('Reference #', l.source_reference),
          field('Broker company', src.company || l.broker),
          src.mc ? field('MC #', src.mc) : '',
          (src.contact || src.phone || src.email) ? field('Contact', [src.contact, src.phone, src.email].filter(Boolean).join(' · ')) : '',
          (src.credit_score || src.days_to_pay) ? field('Credit', [src.credit_score, src.days_to_pay ? src.days_to_pay + ' days-to-pay' : null].filter(Boolean).join(' · ')) : '',
          src.posted_rate ? field('Posted vs ours', '$' + Number(src.posted_rate).toLocaleString() + ' → ' + (l.rate != null ? money(l.rate) : '—')) : '',
          field('Rate con', src.rate_con_received ? '✓ received' : '✗ not on file'),
          field('Verification', (l.verification_state || '—') + ' · confidence ' + (l.confidence || '—')),
        ]),
      ]) : '',
      (det.docs && (det.docs.pickup_number || det.docs.delivery_number || det.docs.appointment)) ? el('div', null, [
        el('h4', { class: 'cc-card-title', style: 'margin-top:14px' }, 'Driver packet numbers'),
        el('div', { class: 'cc-fields' }, [
          det.docs.pickup_number ? field('Pickup #', det.docs.pickup_number) : '',
          det.docs.delivery_number ? field('Delivery #', det.docs.delivery_number) : '',
          det.docs.appointment ? field('Appt conf', det.docs.appointment) : '',
        ]),
      ]) : '',
      (Array.isArray(det.stops) && det.stops.length) ? el('div', null, [
        el('h4', { class: 'cc-card-title', style: 'margin-top:14px' }, 'Extra stops'),
        el('div', null, det.stops.map(s => el('div', { class: 'cc-sub', style: 'padding:3px 0' }, (s.kind === 'delivery' ? '📍 ' : '📦 ') + (s.address || '')))),
      ]) : '',
      l.requirements ? el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Requirements: ' + l.requirements) : '',
      l.notes ? el('pre', { class: 'cc-sub', style: 'white-space:pre-wrap;margin-top:6px' }, l.notes) : '',
      can('loads.assign') ? el('h4', { class: 'cc-card-title', style: 'margin-top:18px' }, 'Dispatch') : '',
      assignWrap, statusWrap,
      (!can('loads.assign')) ? el('p', { class: 'cc-sub' }, 'You have view-only access to dispatch actions.') : '',
    ]));
  }

  mount(host, el('div', null, [header(), listHost]));
  load().finally(() => { timer = setTimeout(tick, 30000); });
  if (focusId) openLoad(focusId);
}
