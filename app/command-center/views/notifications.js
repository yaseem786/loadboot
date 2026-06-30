// notifications.js — Control Tower Wave F: Notifications center.
// A single place to see queued/sent notifications (email/SMS/in-app) and mark them read.
// Until a delivery provider (Resend/Twilio) is connected, items stay queued — never
// silently dropped. Reads/writes via cc_list_notifications / cc_mark_notification.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, card, fmtDateTime } from '../../shared/ui/components.js';
import { listNotifications, markNotification } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

export function renderNotifications(host) {
  let status = null, rows = [];
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Notifications', 'Every notification the system has raised — queued, sent or read. Nothing is sent silently; delivery needs a connected provider.'),
    el('div', { id: 'nt-kpis' }),
    el('div', { class: 'cc-toolbar', id: 'nt-tools' }),
    el('div', { id: 'nt-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const kpiHost = host.querySelector('#nt-kpis');
  const body = host.querySelector('#nt-body');
  mount(host.querySelector('#nt-tools'), segmented([
    { value: null, label: 'All' }, { value: 'queued', label: 'Queued' }, { value: 'sent', label: 'Sent' }, { value: 'read', label: 'Read' },
  ], status, (v) => { status = v; load(); }));

  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    try { rows = await listNotifications({ status, limit: 200 }); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'bell', label: 'Queued', value: String(counts.queued || 0), sub: 'awaiting delivery', accent: 'amber' }),
      statCard({ icon: 'check', label: 'Sent', value: String(counts.sent || 0), sub: 'delivered to provider', accent: 'green' }),
      statCard({ icon: 'doc', label: 'Read', value: String(counts.read || 0), sub: 'acknowledged', accent: 'blue' }),
      statCard({ icon: 'grid', label: 'Showing', value: String(rows.length), sub: 'most recent', accent: 'violet' }),
    ]));
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No notifications in this view.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Template'), el('th', null, 'Channel'), el('th', null, 'Recipient'), el('th', null, 'Status'), el('th', null, 'Raised'), el('th', null, '')])),
      el('tbody', null, rows.map(t => el('tr', null, [
        el('td', null, el('b', null, t.template_key || '—')),
        el('td', null, t.channel || 'in_app'),
        el('td', null, t.recipient_role || t.recipient_user || '—'),
        el('td', null, statusPill(t.status)),
        el('td', null, fmtDateTime(t.created_at)),
        el('td', null, t.status !== 'read' ? el('button', { class: 'cc-seg-btn', onClick: async (ev) => { ev.stopPropagation(); try { await markNotification(t.id, 'read'); } catch (e) { alert(humanizeError(e)); return; } load(); } }, 'Mark read') : ''),
      ]))),
    ])));
  }
}

export default renderNotifications;
