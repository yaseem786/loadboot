// loadIntake.js — Command Center Load Intake workspace (Increment 43). Every load carries a normalized SOURCE
// attribution + verification/confidence, so staff can see where a load came from and how trustworthy it is
// before it enters matching. New loads are created with explicit source attribution (no silently-"verified" data).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { loadIntakeList, createLoadSourced, loadSetVerification, LOAD_SOURCE_TYPES } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { openMatch } from './matchCenter.js';
import { openLoadPilot, openFleetPlan } from './loadPilot.js';

const VER_TONE = { unverified: 'red', partial: 'amber', verified: 'green' };
const CONF_TONE = { low: 'red', medium: 'amber', high: 'green' };
const SRC_LABEL = Object.fromEntries(LOAD_SOURCE_TYPES);

export function renderLoadIntake(host) {
  const manage = can('loads.create');
  let filterSource = '', filterVer = '';
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  const srcSel = el('select', { class: 'cc-input', style: 'max-width:200px' }, [el('option', { value: '' }, 'All sources')].concat(LOAD_SOURCE_TYPES.map(([v, l]) => el('option', { value: v }, l))));
  srcSel.onchange = () => { filterSource = srcSel.value; load(); };
  const verSel = el('select', { class: 'cc-input', style: 'max-width:180px' }, [['', 'All verification'], ['unverified', 'Unverified'], ['partial', 'Partial'], ['verified', 'Verified']].map(([v, l]) => el('option', { value: v }, l)));
  verSel.onchange = () => { filterVer = verSel.value; load(); };
  mount(host, el('div', null, [
    sectionHead('Load Intake', 'Every load is attributed to a normalized source and carries a verification + confidence state. Nothing enters matching as "verified" unless a person marks it so.',
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'lb-btn lb-btn-sm', onClick: () => openFleetPlan(() => load()) }, 'AI Fleet Plan'),
        manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => composer() }, '+ New load') : null,
      ].filter(Boolean))),
    kpis,
    el('div', { style: 'display:flex;gap:8px;margin:10px 0' }, [srcSel, verSel]),
    body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Loading loads…');
    let rows; try { rows = await loadIntakeList({ source: filterSource || null, verification: filterVer || null, limit: 300 }); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    mount(kpis, [
      statCard({ icon: 'trend', label: 'Loads', value: String(rows.length), sub: 'in view', accent: 'blue' }),
      statCard({ icon: 'shield', label: 'Unverified', value: String(rows.filter(r => r.verification_state === 'unverified').length), sub: 'need review', accent: 'amber' }),
      statCard({ icon: 'check', label: 'Verified', value: String(rows.filter(r => r.verification_state === 'verified').length), sub: 'ready', accent: 'green' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No loads for this filter.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Lane', 'Equip', 'Rate', 'Source', 'Verification', 'Confidence', 'Updated', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, [el('b', null, (r.origin || '?') + ' → ' + (r.destination || '?')), r.miles ? el('div', { class: 'cc-sub' }, r.miles + ' mi') : '']),
        el('td', null, r.equipment || '—'),
        el('td', null, r.rate != null ? ('$' + Number(r.rate).toLocaleString()) : '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-gray' }, SRC_LABEL[r.source_type] || r.source_type || 'unknown')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (VER_TONE[r.verification_state] || 'gray') }, r.verification_state)),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (CONF_TONE[r.confidence] || 'gray') }, r.confidence)),
        el('td', null, el('span', { class: 'cc-sub' }, r.source_updated_at ? fmtDateTime(r.source_updated_at) : '—')),
        el('td', null, el('div', { style: 'display:flex;gap:6px;justify-content:flex-end' }, [
          el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (e) => { e.stopPropagation(); openLoadPilot(r); } }, 'AI Pilot'),
          el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); openMatch(r); } }, 'Match'),
          manage && r.verification_state !== 'verified' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); verify(r); } }, 'Verify') : null,
        ].filter(Boolean))),
      ]))),
    ]));
  }

  async function verify(r) {
    try { await loadSetVerification(r.id, 'verified', 'high'); toast('Load marked verified', 'success'); load(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  function composer() {
    const f = { source_type: 'staff_entered', verification_state: 'unverified', confidence: 'medium' };
    const inp = (label, key, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '' }); i.oninput = () => { f[key] = i.value; }; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const srcSel2 = el('select', { class: 'cc-input' }, LOAD_SOURCE_TYPES.map(([v, l]) => el('option', { value: v, selected: v === 'staff_entered' ? 'selected' : null }, l))); srcSel2.onchange = () => { f.source_type = srcSel2.value; };
    const verSel2 = el('select', { class: 'cc-input' }, [['unverified', 'Unverified'], ['partial', 'Partial'], ['verified', 'Verified']].map(([v, l]) => el('option', { value: v }, l))); verSel2.onchange = () => { f.verification_state = verSel2.value; };
    const confSel2 = el('select', { class: 'cc-input' }, [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, l]) => el('option', { value: v, selected: v === 'medium' ? 'selected' : null }, l))); confSel2.onchange = () => { f.confidence = confSel2.value; };
    const form = el('div', null, [
      inp('Origin', 'origin', 'Dallas, TX'), inp('Destination', 'destination', 'Atlanta, GA'),
      inp('Equipment', 'equipment', 'Dry Van'), inp('Rate (USD)', 'rate', '2450'), inp('Miles', 'miles', '780'),
      inp('Commodity', 'commodity', 'Palletized freight'), inp('Weight', 'weight', '42000 lbs'),
      inp('Pickup date', 'pickup_date', 'YYYY-MM-DD'), inp('Broker / source name', 'broker', 'ACME Logistics'),
      inp('Source reference', 'source_reference', 'e.g. board ref / call note'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Source type (required)'), srcSel2]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Verification'), verSel2]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Confidence'), confSel2]),
      el('p', { class: 'cc-sub' }, 'Attribute the real source. Do not mark unverified information as verified.'),
      el('div', { style: 'border-top:1px solid var(--lb-border,#e2e8f0);margin:10px 0;padding-top:10px;font-weight:700' }, 'Rate card — required before the load can post'),
      el('p', { class: 'cc-sub' }, 'A carrier must know every rate before booking. The server refuses loads without a complete card.'),
      inp('Detention rate ($/hr) *', 'acc_detention_per_hr', '55'),
      inp('Free time before detention (hours) *', 'acc_detention_free_hours', '2'),
      inp('Layover rate ($/day) *', 'acc_layover_per_day', '225'),
      inp('TONU rate ($) *', 'acc_tonu', '175'),
      (() => { const sel = el('select', { class: 'cc-input' }, ['', 'Broker pays lumper directly', 'Reimbursed with receipt', 'Included in rate', 'Not covered'].map(o => el('option', { value: o }, o || 'Select…'))); sel.onchange = () => { f.acc_lumper_policy = sel.value; }; return el('label', { class: 'cc-field' }, [el('span', null, 'Lumper policy *'), sel]); })(),
      (() => { const sel = el('select', { class: 'cc-input' }, [['fcfs', 'First come, first served (FCFS)'], ['appointment', 'By appointment'], ['window', 'Pickup window']].map(([v, l]) => el('option', { value: v }, l))); f.scheduling = 'fcfs'; sel.onchange = () => { f.scheduling = sel.value; }; return el('label', { class: 'cc-field' }, [el('span', null, 'Scheduling *'), sel]); })(),
      inp('Pickup window (if applicable)', 'pickup_window', '08:00-14:00'),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, 'Create load')),
    ]);
    openDrawer('New load', form, { subtitle: 'Source-attributed intake' });
    async function save() {
      if (!f.origin || !f.destination) { alert('Origin and destination are required.'); return; }
      const missing = [];
      [['acc_detention_per_hr', 'detention rate'], ['acc_detention_free_hours', 'free hours'], ['acc_layover_per_day', 'layover rate'], ['acc_tonu', 'TONU rate']].forEach(([k, l]) => { if (!f[k] || isNaN(Number(f[k])) || Number(f[k]) < 0) missing.push(l); });
      if (!f.acc_lumper_policy) missing.push('lumper policy');
      if (f.scheduling === 'window' && !(f.pickup_window || '').trim()) missing.push('pickup window');
      if (missing.length) { alert('Required before posting: ' + missing.join(', ') + '.'); return; }
      const payload = Object.assign({}, f);
      payload.field_meta = {
        appointment_required: f.scheduling === 'appointment',
        pickup_window: (f.pickup_window || '').trim() || null,
        accessorials: { detention_per_hr: String(f.acc_detention_per_hr), detention_free_hours: String(f.acc_detention_free_hours), layover_per_day: String(f.acc_layover_per_day), tonu: String(f.acc_tonu), lumper_policy: f.acc_lumper_policy, fcfs: f.scheduling === 'fcfs' ? 'true' : 'false' },
      };
      ['acc_detention_per_hr', 'acc_detention_free_hours', 'acc_layover_per_day', 'acc_tonu', 'acc_lumper_policy', 'scheduling'].forEach(k => delete payload[k]);
      try { await createLoadSourced(payload); toast('Load created', 'success'); document.getElementById('cc-drawer-root')?.remove(); load(); }
      catch (e) { alert(humanizeError(e)); }
    }
  }
}

export default renderLoadIntake;
