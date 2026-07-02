// exceptionCenter.js — Exception Center (Increments 52–53). One queue for everything going wrong on active
// trips: auto-detected detention (from REAL arrive/depart stamps — never invented), breakdowns, weather,
// missed appointments. Detention drafts are visible but stay NON-billable until a dispatcher reviews them.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { exceptionCenter, resolveException, detentionScan, emergencyQueue, emergencyReview } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const KIND_TONE = { detention: 'red', breakdown: 'red', accident: 'red', weather: 'amber', missed_appointment: 'amber', delay: 'amber', layover: 'gray', lumper: 'gray', tonu: 'gray', other: 'gray' };

export function renderExceptionCenter(host) {
  const manage = can('dispatch.manage');
  let filterStatus = 'open';
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  const stSel = el('select', { class: 'cc-input', style: 'max-width:160px' }, [['open', 'Open'], ['resolved', 'Resolved'], ['', 'All']].map(([v, l]) => el('option', { value: v }, l)));
  stSel.onchange = () => { filterStatus = stSel.value; load(); };
  const scanBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
    ev.currentTarget.disabled = true;
    try { const r = await detentionScan(); toast(r.detected ? r.detected + ' detention case(s) detected — drafts created for review' : 'No new detention — all stops within free time', r.detected ? 'success' : 'info'); load(); }
    catch (e) { toast(humanizeError(e), 'error'); }
    ev.currentTarget.disabled = false;
  } }, 'Run detention scan') : null;
  const emCard = el('div', { class: 'lb-card', style: 'margin:10px 0' });
  mount(host, el('div', null, [
    sectionHead('Exception Center', 'Detention is measured from recorded arrive/depart timestamps and auto-drafted for review — nothing is billed automatically. Every open exception needs an owner and a resolution note.', scanBtn),
    kpis,
    emCard,
    el('div', { style: 'display:flex;gap:8px;margin:10px 0' }, [stSel]),
    body,
  ]));
  load();
  loadEmergencies();

  // A3 staff loop — carrier emergency / reschedule requests (category + detailed reason + PROOF required
  // at submission; approve/deny here with a note).
  async function loadEmergencies() {
    mount(emCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '🚨 Emergency requests'), el('div', { class: 'cc-sub' }, 'Loading…')]));
    let rows; try { rows = await emergencyQueue('open', 100); } catch (e) { mount(emCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '🚨 Emergency requests'), el('div', { class: 'cc-sub' }, humanizeError(e))])); return; }
    rows = Array.isArray(rows) ? rows : [];
    const head = el('h3', { style: 'margin:0 0 8px' }, '🚨 Emergency requests (' + rows.length + ' open)');
    if (!rows.length) { mount(emCard, el('div', null, [head, el('div', { class: 'cc-sub' }, 'No open emergency requests. Carriers raise these from an active trip with a defined category, a detailed reason and mandatory proof.')])); return; }
    const items = rows.map((r) => {
      const note = el('input', { class: 'cc-input', placeholder: 'Decision note (visible to the carrier)', style: 'max-width:260px' });
      const act = (label, approve, primary) => el('button', { class: 'lb-btn lb-btn-sm' + (primary ? ' lb-btn-primary' : ''), style: 'margin-left:6px', onClick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { await emergencyReview(r.id, approve, note.value.trim() || null); toast('Request ' + (approve ? 'approved' : 'denied'), 'success'); loadEmergencies(); }
        catch (e) { toast(humanizeError(e), 'error'); ev.currentTarget.disabled = false; }
      } }, label);
      return el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--lb-border,#e2e8f0)' }, [
        el('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
          el('div', null, [
            el('div', { style: 'font-weight:700' }, (r.category || 'emergency').replace(/_/g, ' ').toUpperCase() + ' — ' + (r.carrier || 'carrier') + ' · ' + (r.origin || '—') + ' → ' + (r.destination || '—')),
            el('div', { class: 'cc-sub' }, 'Reason: ' + (r.reason || '—')),
            el('div', { class: 'cc-sub' }, 'Proof: ' + (r.proof_ref || '—') + (r.requested_reschedule_to ? ' · requested new delivery: ' + new Date(r.requested_reschedule_to).toLocaleString() : '') + ' · raised ' + (r.created_at ? new Date(r.created_at).toLocaleString() : '—')),
          ]),
          manage ? el('div', { style: 'display:flex;align-items:center;gap:4px;flex-wrap:wrap' }, [note, act('Approve', true, true), act('Deny', false, false)]) : el('span', { class: 'cc-sub' }, 'dispatch.manage required'),
        ]),
      ]);
    });
    mount(emCard, el('div', null, [head].concat(items)));
  }

  async function load() {
    showLoading(body, 'Loading exceptions…');
    let rows; try { rows = await exceptionCenter(filterStatus || null, 200); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    mount(kpis, [
      statCard({ icon: 'alert', label: 'In view', value: String(rows.length), sub: filterStatus || 'all', accent: 'blue' }),
      statCard({ icon: 'clock', label: 'Detention', value: String(rows.filter(r => r.kind === 'detention').length), sub: 'measured from real stamps', accent: 'red' }),
      statCard({ icon: 'shield', label: 'Draft $ pending review', value: '$' + rows.reduce((a, r) => a + Number(r.accessorial_draft || 0), 0).toLocaleString(), sub: 'not billable yet', accent: 'amber' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No exceptions for this filter.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Kind', 'Lane / carrier', 'What happened', 'Age', 'On site', 'Draft $', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (KIND_TONE[r.kind] || 'gray') }, r.kind)),
        el('td', null, [el('b', null, (r.origin || '?') + ' → ' + (r.destination || '?')), el('div', { class: 'cc-sub' }, r.carrier_name || '—')]),
        el('td', { style: 'max-width:340px' }, [el('div', { class: 'cc-sub' }, r.description || ''), r.resolution_note ? el('div', { class: 'cc-sub', style: 'color:#16a34a' }, '✓ ' + r.resolution_note) : null]),
        el('td', null, el('span', { class: 'cc-sub' }, r.status === 'resolved' ? fmtDateTime(r.resolved_at) : fmtAge(r.age_minutes))),
        el('td', null, r.on_site ? el('span', { class: 'cc-pill cc-pill-amber' }, r.on_site) : el('span', { class: 'cc-sub' }, '—')),
        el('td', null, Number(r.accessorial_draft || 0) > 0 ? el('b', { style: 'color:#d97706' }, '$' + Number(r.accessorial_draft).toLocaleString()) : el('span', { class: 'cc-sub' }, '—')),
        el('td', null, (manage && r.status === 'open') ? el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); resolveUI(r); } }, 'Resolve') : null),
      ]))),
    ]));
  }

  function fmtAge(min) {
    if (min == null) return '—';
    if (min < 60) return min + ' min';
    if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    return Math.floor(min / 1440) + 'd';
  }

  function resolveUI(r) {
    const ta = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'What was done? (required — this is the audit trail)' });
    const form = el('div', null, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, r.description || ''),
      Number(r.accessorial_draft || 0) > 0 ? el('div', { class: 'lb-card', style: 'background:#fffbeb;margin-bottom:8px' },
        el('div', { class: 'cc-sub' }, 'This trip has $' + Number(r.accessorial_draft).toLocaleString() + ' in DRAFT accessorials (labeled assumptions). Review them under the trip before billing — resolving this exception does not bill anything.')) : null,
      el('label', { class: 'cc-field' }, [el('span', null, 'Resolution note'), ta]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        if (!ta.value.trim()) { alert('A resolution note is required.'); return; }
        try { await resolveException({ id: r.id, note: ta.value.trim() }); toast('Exception resolved', 'success'); document.getElementById('cc-drawer-root')?.remove(); load(); }
        catch (e) { alert(humanizeError(e)); }
      } }, 'Mark resolved')),
    ].filter(Boolean));
    openDrawer('Resolve — ' + r.kind, form, { subtitle: (r.origin || '?') + ' → ' + (r.destination || '?') });
  }
}

export default renderExceptionCenter;
