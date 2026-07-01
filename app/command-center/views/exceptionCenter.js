// exceptionCenter.js — Exception Center (Increments 52–53). One queue for everything going wrong on active
// trips: auto-detected detention (from REAL arrive/depart stamps — never invented), breakdowns, weather,
// missed appointments. Detention drafts are visible but stay NON-billable until a dispatcher reviews them.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { exceptionCenter, resolveException, detentionScan } from '../../shared/api.js';
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
  mount(host, el('div', null, [
    sectionHead('Exception Center', 'Detention is measured from recorded arrive/depart timestamps and auto-drafted for review — nothing is billed automatically. Every open exception needs an owner and a resolution note.', scanBtn),
    kpis,
    el('div', { style: 'display:flex;gap:8px;margin:10px 0' }, [stSel]),
    body,
  ]));
  load();

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
