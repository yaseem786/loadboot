// exceptions.js — Command Center: Trip Exceptions queue (migration cuu_staff_exception_queue).
// Carrier-reported exceptions (detention, TONU, accident, breakdown, ...) land here for dispatch to
// resolve. RBAC: dispatch.manage (server-enforced). Open tab first; resolving requires dispatch.manage.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, card, statusPill, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { listExceptions, resolveException } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const KIND_LABEL = { tonu: 'TONU', missed_appointment: 'Missed appointment' };
const label = (k) => KIND_LABEL[k] || (k || 'issue').replace(/_/g, ' ');

export function renderExceptions(host) {
  let status = 'open';
  const listHost = el('div');

  const tabsHost = el('div');
  function drawTabs() {
    mount(tabsHost, el('div', { class: 'cc-tabs', style: 'display:flex;gap:6px;margin-bottom:14px' },
      ['open', 'resolved'].map(s2 => el('button', {
        class: 'lb-btn lb-btn-sm' + (s2 === status ? ' lb-btn-primary' : ''),
        onClick: () => { status = s2; drawTabs(); load(); }
      }, s2[0].toUpperCase() + s2.slice(1)))));
  }
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Trip Exceptions', 'Issues carriers and drivers report from the road — detention, TONU, accident, breakdown and more. Resolve each once dispatch has handled it.'),
    tabsHost,
    listHost,
  ]));
  drawTabs();

  load();

  async function load() {
    mount(listHost, el('div', { class: 'cc-sub' }, 'Loading…'));
    try {
      const rows = await listExceptions({ status });
      if (!rows || !rows.length) { mount(listHost, card(el('div', { class: 'cc-sub' }, 'No ' + status + ' exceptions.'))); return; }
      const exportBtn = el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-bottom:12px', onClick: () => exportCsv(rows) }, '⬇ Export CSV');
      mount(listHost, el('div', null, [exportBtn, el('div', null, rows.map(row))]));
    } catch (e) { mount(listHost, card(el('div', { class: 'cc-sub' }, humanizeError(e)))); }
  }

  function exportCsv(rows) {
    const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const header = ['kind', 'carrier', 'origin', 'destination', 'trip_id', 'status', 'reported_at', 'resolved_at', 'description', 'resolution_note'];
    const lines = [header.join(',')].concat(rows.map(r => [r.kind, r.carrier_name, r.origin, r.destination, r.trip_id, r.status, r.created_at, r.resolved_at, r.description, r.resolution_note].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'loadboot-exceptions-' + status + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function row(r) {
    const route = (r.origin || r.destination) ? ((r.origin || '—') + ' → ' + (r.destination || '—')) : null;
    return card(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap' }, [
      el('div', null, [
        el('div', { style: 'font-weight:700;text-transform:capitalize' }, label(r.kind)),
        el('div', { class: 'cc-sub', style: 'font-size:.85rem' }, [
          r.carrier_name ? el('b', null, r.carrier_name) : null,
          document.createTextNode((r.carrier_name ? ' · ' : '') + (route ? route + ' · ' : '') + 'Trip ' + String(r.trip_id).slice(0, 8)),
        ].filter(Boolean)),
        el('div', { class: 'cc-sub', style: 'font-size:.82rem' }, 'Reported ' + fmtDateTime(r.created_at)),
        r.description ? el('div', { class: 'cc-sub', style: 'font-size:.85rem;margin-top:4px' }, r.description) : null,
        r.resolution_note ? el('div', { class: 'cc-sub', style: 'font-size:.82rem;color:#16a34a' }, 'Resolution: ' + r.resolution_note) : null,
      ].filter(Boolean)),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
        statusPill(r.status),
        r.status === 'open' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => resolve(r) }, 'Resolve') : null,
      ].filter(Boolean)),
    ]));
  }

  function resolve(r) {
    const note = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'How was this handled? (optional — kept on the record)' });
    openDrawer('Resolve ' + label(r.kind), el('div', null, [
      el('label', { class: 'cc-field' }, [el('span', null, 'Resolution note'), note]),
      el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-top:12px', onClick: async () => {
        try { await resolveException({ id: r.id, note: note.value.trim() || null }); toast('Exception resolved.', 'success'); load(); }
        catch (e) { toast(humanizeError(e), 'error'); }
      } }, 'Mark resolved'),
    ]));
  }
}

export default renderExceptions;
