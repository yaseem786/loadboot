// fleetExpiry.js — cross-carrier CDL / medical-card expiry monitor. Warn the carrier with one
// click (owner notified instantly). Reads cc_fleet_expiry_board, writes cc_warn_driver_expiry.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, segmented } from '../../shared/ui/components.js';
import { fleetExpiryBoard, warnDriverExpiry } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export function renderFleetExpiry(host) {
  let days = 45;
  const listHost = el('div', { class: 'cc-table-wrap' });
  const kpis = el('div');
  const manage = can('fleet.manage') || can('dispatch.manage');

  async function load() {
    showLoading(listHost, 'Scanning driver license & medical expiry...');
    let rows; try { rows = await fleetExpiryBoard(days); } catch (e) { showError(listHost, humanizeError(e), load); return; }
    rows = Array.isArray(rows) ? rows : [];
    const expired = rows.filter(r => r.days_left < 0).length;
    const soon = rows.filter(r => r.days_left >= 0 && r.days_left <= 14).length;
    mount(kpis, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'shield', label: 'Flagged', value: String(rows.length), sub: 'within ' + days + ' days', accent: rows.length ? 'amber' : 'green' }),
      statCard({ icon: 'alert', label: 'Expired', value: String(expired), sub: 'action required', accent: expired ? 'red' : 'green' }),
      statCard({ icon: 'alert', label: 'Due 14 days', value: String(soon), sub: 'urgent', accent: soon ? 'amber' : 'green' }),
    ]));
    if (!rows.length) { showEmpty(listHost, 'No driver licenses or medical cards expiring in the next ' + days + ' days.'); return; }
    mount(listHost, el('div', null, rows.map(r => {
      const overdue = r.days_left < 0;
      const c = overdue ? '#dc2626' : (r.days_left <= 14 ? '#d97706' : '#0883F7');
      const warnBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { await warnDriverExpiry(r.driver_id, r.kind); toast('Warning sent to carrier', 'success'); }
        catch (e) { toast(humanizeError(e), 'error'); ev.currentTarget.disabled = false; }
      } }, 'Warn carrier') : null;
      return el('div', { class: 'lb-card', style: 'margin:8px 0;border-left:5px solid ' + c + ';display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
        el('div', null, [
          el('b', null, (r.name || 'Driver') + ' — ' + r.kind),
          el('div', { class: 'cc-sub' }, (r.carrier || '') + (r.phone ? ' · ' + r.phone : '') + ' · ' + (overdue ? ('EXPIRED ' + (-r.days_left) + 'd ago') : (r.days_left + ' days left')) + ' (' + (r.exp_date || '?') + ')'),
        ]),
        el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
          el('a', { href: '#/carrier?id=' + r.carrier_org, style: 'color:var(--lb-blue,#0883F7);font-weight:600' }, 'Carrier 360 →'),
          warnBtn,
        ].filter(Boolean)),
      ]);
    })));
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('License & medical expiry', 'Every driver across all carriers whose CDL or medical card is expiring or expired. Warn the carrier with one click; the carrier owner is notified instantly.'),
    el('div', { class: 'cc-toolbar' }, [segmented([{ value: '30', label: '30 days' }, { value: '45', label: '45 days' }, { value: '90', label: '90 days' }], String(days), (v) => { days = Number(v); load(); })]),
    kpis, listHost,
  ]));
  load();
}

export default renderFleetExpiry;
