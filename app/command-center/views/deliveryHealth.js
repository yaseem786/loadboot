// deliveryHealth.js — Delivery Health (Phase 3D). Operational view over message
// delivery across channels and states (queued / sent / failed / dead / read), with
// re-queue for failed/dead-lettered messages so a delivery failure never silently
// loses the underlying business event. Uses cc_list_notifications / cc_mark_notification.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, fmtDateTime } from '../../shared/ui/components.js';
import { listNotifications, markNotification } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const FILTERS = [{ value: '', label: 'All' }, { value: 'queued', label: 'Queued' }, { value: 'sent', label: 'Sent' }, { value: 'failed', label: 'Failed' }, { value: 'dead', label: 'Dead-letter' }, { value: 'read', label: 'Read' }];

export function renderDeliveryHealth(host) {
  const manage = can('comm.view') || can('settings.manage') || true; // any staff can view; RPC gates
  let status = '';
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const tools = el('div', { style: 'margin:14px 0 6px' });
  const body = el('div', { class: 'cc-table-wrap' });
  mount(host, el('div', null, [
    sectionHead('Delivery Health', 'Message delivery across channels and states. Re-queue failed or dead-lettered messages — the underlying event is never lost.'),
    kpis, tools, body,
  ]));
  loadKpis();
  loadList();

  async function loadKpis() {
    let rows; try { rows = await listNotifications({ limit: 500 }); } catch (e) { return; }
    rows = rows || [];
    const c = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    const failed = (c.failed || 0) + (c.dead || 0);
    mount(kpis, [
      statCard({ icon: 'bell', label: 'Total messages', value: String(rows.length), sub: 'recent', accent: 'blue' }),
      statCard({ icon: 'refresh', label: 'Queued', value: String(c.queued || 0), sub: 'awaiting delivery', accent: (c.queued || 0) > 0 ? 'amber' : 'green' }),
      statCard({ icon: 'check', label: 'Sent', value: String((c.sent || 0) + (c.read || 0)), sub: (c.read || 0) + ' read', accent: 'green' }),
      statCard({ icon: 'shield', label: 'Failed / dead', value: String(failed), sub: 'need re-queue', accent: failed > 0 ? 'red' : 'green' }),
    ]);
    mount(tools, segmented(FILTERS, status, (v) => { status = v; loadList(); }));
  }

  async function loadList() {
    showLoading(body, 'Loading deliveries…');
    let rows; try { rows = await listNotifications({ status: status || null, limit: 300 }); } catch (e) { showError(body, humanizeError(e), loadList); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No messages for this filter.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['When', 'Type', 'Channel', 'Recipient', 'Status', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(t => {
        const retryable = t.status === 'failed' || t.status === 'dead';
        return el('tr', { class: 'cc-row' }, [
          el('td', null, el('span', { class: 'cc-sub' }, fmtDateTime(t.created_at))),
          el('td', null, t.template_key || (t.payload && t.payload.type) || '—'),
          el('td', null, t.channel || 'in_app'),
          el('td', null, t.recipient_role || t.recipient_user || '—'),
          el('td', null, statusPill(t.status)),
          el('td', null, retryable ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
            ev.stopPropagation(); ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Re-queuing…';
            try { await markNotification(t.id, 'queued'); toast('Re-queued for delivery', 'success'); loadList(); loadKpis(); }
            catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Re-queue'; toast(humanizeError(e), 'error'); }
          } }, 'Re-queue') : ''),
        ]);
      })),
    ]));
  }
}

export default renderDeliveryHealth;
