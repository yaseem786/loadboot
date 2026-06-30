// webhooks.js — Outbound Webhooks admin (Phase 1 hardening). Shows registered
// endpoints and their delivery log with status (pending/sent/failed/dead) and a
// manual retry for dead-lettered deliveries — so a provider failure never silently
// loses a business event. Staff-gated (integrations.view).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, segmented, fmtDateTime } from '../../shared/ui/components.js';
import { listWebhookEndpoints, listWebhookDeliveries, retryWebhookDelivery } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const D_TONE = { pending: 'amber', sent: 'green', delivered: 'green', failed: 'red', dead: 'red', retrying: 'amber' };
const FILTERS = [{ value: '', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }, { value: 'dead', label: 'Dead-letter' }, { value: 'sent', label: 'Sent' }];

export function renderWebhooks(host) {
  let status = '';
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const epHost = el('div', { class: 'cc-table-wrap' });
  const dlHost = el('div', { class: 'cc-table-wrap', style: 'margin-top:18px' });
  mount(host, el('div', null, [
    sectionHead('Webhooks', 'Outbound event delivery — endpoints, delivery log and dead-letter retry. A failed delivery never loses the underlying event.'),
    kpis, epHost, el('div', { style: 'margin:16px 0 6px' }, segmented(FILTERS, status, (v) => { status = v; loadDeliveries(); })), dlHost,
  ]));
  loadEndpoints();
  loadDeliveries();

  async function loadEndpoints() {
    showLoading(epHost, 'Loading endpoints…');
    let rows; try { rows = await listWebhookEndpoints(); } catch (e) { showError(epHost, humanizeError(e), loadEndpoints); return; }
    const totalFailed = (rows || []).reduce((a, r) => a + (Number(r.failed) || 0), 0);
    mount(kpis, [
      statCard({ icon: 'refresh', label: 'Endpoints', value: String((rows || []).length), sub: (rows || []).filter(r => r.active).length + ' active', accent: 'blue' }),
      statCard({ icon: 'shield', label: 'Signed', value: String((rows || []).filter(r => r.signing_configured).length), sub: 'signing configured', accent: 'violet' }),
      statCard({ icon: 'bell', label: 'Failed deliveries', value: String(totalFailed), sub: 'across endpoints', accent: totalFailed > 0 ? 'red' : 'green' }),
    ]);
    mount(epHost, (rows && rows.length) ? el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Endpoint', 'URL', 'Events', 'Signed', 'Active', 'Deliveries', 'Failed'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, el('b', null, r.name || '—')),
        el('td', null, el('span', { class: 'cc-sub', style: 'word-break:break-all' }, r.url || '—')),
        el('td', null, el('span', { class: 'cc-sub' }, r.event_types || '—')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (r.signing_configured ? 'green' : 'gray') }, r.signing_configured ? 'yes' : 'no')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (r.active ? 'green' : 'gray') }, r.active ? 'on' : 'off')),
        el('td', null, String(r.deliveries || 0)),
        el('td', null, el('b', { style: (Number(r.failed) || 0) > 0 ? 'color:var(--lb-red)' : '' }, String(r.failed || 0))),
      ]))),
    ]) : el('div', { class: 'lb-state' }, 'No webhook endpoints registered yet.'));
  }

  async function loadDeliveries() {
    showLoading(dlHost, 'Loading deliveries…');
    let rows; try { rows = await listWebhookDeliveries({ status: status || null, limit: 150 }); } catch (e) { showError(dlHost, humanizeError(e), loadDeliveries); return; }
    if (!rows || !rows.length) { mount(dlHost, el('div', { class: 'lb-state' }, 'No deliveries for this filter.')); return; }
    mount(dlHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['When', 'Endpoint', 'Event', 'Status', 'Attempts', 'Note', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(d => {
        const retryable = d.status === 'failed' || d.status === 'dead';
        return el('tr', { class: 'cc-row' }, [
          el('td', null, el('span', { class: 'cc-sub' }, fmtDateTime(d.created_at))),
          el('td', null, d.endpoint_name || '—'),
          el('td', null, d.event_type || '—'),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (D_TONE[d.status] || 'gray') }, d.status)),
          el('td', null, String(d.attempts ?? 0)),
          el('td', null, el('span', { class: 'cc-sub' }, d.note || '—')),
          el('td', null, retryable ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
            ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Retrying…';
            try { await retryWebhookDelivery(d.id); toast('Delivery re-queued', 'success'); loadDeliveries(); loadEndpoints(); }
            catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Retry'; toast(humanizeError(e), 'error'); }
          } }, 'Retry') : ''),
        ]);
      })),
    ]));
  }
}

export default renderWebhooks;
