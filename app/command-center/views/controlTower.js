// controlTower.js — Trip Control Tower (Increments 50–51). Live active-trip board: status, last location with
// SOURCE + freshness (never invented — 'n/a' until a consented check-in exists), consent/tracking method,
// booking-checklist gaps, open exceptions, and the computed NEXT REQUIRED ACTION per trip. Staff-gated.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { controlTower, bookingStatus } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const ST_TONE = { planned: 'gray', dispatched: 'blue', in_transit: 'amber' };

export function renderControlTower(host) {
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  mount(host, el('div', null, [
    sectionHead('Trip Control Tower', 'Every active trip with tracking freshness, consent state, checklist gaps and the next required action. Locations are consent-first and source-labeled — never invented.'),
    kpis, body,
  ]));
  load();
  const timer = setInterval(() => { if (!document.body.contains(body)) { clearInterval(timer); return; } load(); }, 60000);

  async function load() {
    if (!body.childElementCount) showLoading(body, 'Loading active trips…');
    let rows; try { rows = await controlTower(200); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    const stale = rows.filter(r => r.next_action && r.next_action.startsWith('stale tracking')).length;
    const needTrack = rows.filter(r => !r.tracking_method).length;
    const withDocs = rows.filter(r => (r.checklist_missing || 0) > 0).length;
    mount(kpis, [
      statCard({ icon: 'trend', label: 'Active trips', value: String(rows.length), sub: 'planned / dispatched / in transit', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Stale tracking', value: String(stale), sub: 'need check-in', accent: stale ? 'red' : 'green' }),
      statCard({ icon: 'shield', label: 'No tracking method', value: String(needTrack), sub: 'consent pending', accent: needTrack ? 'amber' : 'green' }),
      statCard({ icon: 'document', label: 'Checklist gaps', value: String(withDocs), sub: 'booking docs missing', accent: withDocs ? 'amber' : 'green' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No active trips right now.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Lane / carrier', 'Status', 'Tracking', 'Last location', 'Docs', 'Exceptions', 'Next action', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, [el('b', null, (r.origin || '?') + ' → ' + (r.destination || '?')), el('div', { class: 'cc-sub' }, r.carrier || '—')]),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[r.status] || 'gray') }, r.status)),
        el('td', null, r.tracking_method
          ? el('span', { class: 'cc-pill cc-pill-' + (r.location_consent ? 'green' : 'gray') }, r.tracking_method + (r.location_consent ? ' ✓' : ''))
          : el('span', { class: 'cc-pill cc-pill-amber' }, 'not selected')),
        el('td', null, r.last_loc_at
          ? el('span', { class: 'cc-sub', title: (r.last_lat != null ? (r.last_lat + ', ' + r.last_lng) : '') },
              (r.loc_fresh_minutes != null ? (r.loc_fresh_minutes + ' min ago') : fmtDateTime(r.last_loc_at)) + (r.loc_source ? ' · ' + r.loc_source : ''))
          : el('span', { class: 'cc-sub' }, 'no location yet')),
        el('td', null, (r.checklist_missing || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-amber' }, r.checklist_missing + ' missing') : el('span', { class: 'cc-pill cc-pill-green' }, 'complete')),
        el('td', null, (r.open_exceptions || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-red' }, String(r.open_exceptions)) : el('span', { class: 'cc-sub' }, '—')),
        el('td', null, el('b', { style: r.next_action && r.next_action.startsWith('stale') ? 'color:#b45309' : '' }, r.next_action || '—')),
        el('td', null, el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); detail(r); } }, 'Booking')),
      ]))),
    ]));
  }

  async function detail(r) {
    const box = el('div', { class: 'cc-sub' }, 'Loading…');
    openDrawer('Booking status', box, { subtitle: (r.origin || '?') + ' → ' + (r.destination || '?') });
    let b; try { b = await bookingStatus(r.load_id); } catch (e) { mount(box, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
    mount(box, el('div', null, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, 'Load status: ' + b.status + ' · checklist ' + (b.checklist_complete ? 'complete ✓' : 'incomplete')),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Document / action', 'From', 'Status'].map(h => el('th', null, h)))),
        el('tbody', null, (b.checklist || []).map(c => el('tr', null, [
          el('td', null, c.label), el('td', null, c.required_from),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (c.status === 'received' || c.status === 'verified' ? 'green' : c.status === 'rejected' ? 'red' : 'amber') }, c.status)),
        ]))),
      ]),
    ]));
  }
}

export default renderControlTower;
