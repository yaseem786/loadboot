// driverAccess.js — Command Center view of a carrier's driver app adoption (bl_drv_0344, 14 Sep 2026).
// Carrier 360 → Drivers card: per driver app status (not invited · invited · joined · online · paused),
// truck, preset + permission count, location sharing, device, last seen, 30-day trips/late, docs pending,
// denied attempts — plus untracked trucks, recent access events and the owner's Android setting.
// Cross-carrier adoption KPIs feed the CC Fleet view. Read-only here; the owner changes access in their app.
import { el, mount } from '../../shared/ui/dom.js';
import { statCard, fmtDateTime } from '../../shared/ui/components.js';
import { ccCarrierDriverAccess, ccDriverAdoptionKpis } from '../../shared/api.js';

const TONE = { joined: 'green', invited: 'amber', expired: 'gray', revoked: 'gray', suspended: 'red', not_invited: 'red' };
const LABEL = { joined: 'Joined', invited: 'Invited', expired: 'Invite expired', revoked: 'Revoked', suspended: 'Paused', not_invited: 'Not invited' };
const PRESET = { driver: 'Driver only', book: 'Driver + book loads', lead: 'Lead driver', full: 'Full trust' };
const pill = (st, online) => el('span', { class: 'cc-pill cc-pill-' + (TONE[st] || 'gray') }, [el('i', { class: 'cc-pill-dot' }), (st === 'joined' && online) ? 'Joined · online' : (LABEL[st] || st)]);
const ago = (iso) => { if (!iso) return '—'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min'; const h = Math.round(m / 60); if (h < 24) return h + ' h'; return Math.round(h / 24) + ' d'; };
const daysLeft = (iso) => iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)) : null;

export async function mountDriverAccessCard(cardEl, orgId, fallbackDrivers) {
  let d;
  try { d = await ccCarrierDriverAccess(orgId); }
  catch (e) {
    mount(cardEl, [el('h4', { class: 'cc-card-title' }, 'Drivers (' + (fallbackDrivers || []).length + ')'), el('div', { class: 'cc-sub' }, 'Driver access view unavailable: ' + ((e && e.message) || 'error'))]);
    return;
  }
  const rows = d.drivers || [];
  const untracked = d.untracked_trucks || [];
  const joined = rows.filter((x) => x.app_status === 'joined').length;
  const head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' }, [
    el('h4', { class: 'cc-card-title', style: 'margin:0' }, ['Drivers (' + rows.length + ') · ' + joined + ' on the app ',
      untracked.length ? el('span', { class: 'cc-pill cc-pill-amber' }, [el('i', { class: 'cc-pill-dot' }), untracked.length + ' truck' + (untracked.length > 1 ? 's' : '') + ' untracked']) : el('span', { class: 'cc-pill cc-pill-green' }, [el('i', { class: 'cc-pill-dot' }), 'all trucks tracked'])]),
    el('span', { class: 'cc-sub' }, 'Android app ' + ((d.settings && d.settings.require_android_app === false) ? 'optional' : 'required') + ' (owner setting)'),
  ]);
  const table = rows.length ? el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table cc-table-tight' }, [
    el('thead', null, el('tr', null, ['Driver', 'App', 'Truck', 'Access', 'Location', 'Device', 'Last seen', '30d trips', 'Docs', 'Denied 7d'].map((t) => el('th', null, t)))),
    el('tbody', null, rows.map((x) => el('tr', { 'data-driver': x.id }, [
      el('td', null, [el('b', null, x.name || '—'), el('div', { class: 'cc-sub' }, x.phone || x.email || '')]),
      el('td', null, [pill(x.app_status, x.online), x.app_status === 'invited' && x.invite_expires_at ? el('div', { class: 'cc-sub' }, daysLeft(x.invite_expires_at) + ' d left' + (x.resend_count ? ' · resent ' + x.resend_count + '×' : '')) : null].filter(Boolean)),
      el('td', null, x.last_unit ? 'Unit ' + x.last_unit : '—'),
      el('td', null, x.user_id ? [el('span', null, PRESET[x.preset] || (x.preset ? 'Custom' : '—')), el('div', { class: 'cc-sub' }, (11 + Number(x.perms_count || 0)) + ' permissions')] : '—'),
      el('td', null, x.user_id ? el('span', { class: 'cc-pill cc-pill-' + (x.location_on ? 'green' : 'gray') }, [el('i', { class: 'cc-pill-dot' }), x.location_on ? 'sharing' : 'off']) : '—'),
      el('td', null, x.app_platform ? (x.app_platform === 'android' ? 'Android' + (x.installed_app ? ' · app' : ' · browser') : x.app_platform === 'ios' ? 'iPhone' + (x.installed_app ? ' · home screen' : ' · Safari') : x.app_platform) : '—'),
      el('td', null, x.user_id ? ago(x.last_seen_at) : '—'),
      el('td', null, [String(x.trips_30d || 0), Number(x.late_30d) ? el('span', { class: 'cc-sub', style: 'color:#f59e0b' }, ' · ' + x.late_30d + ' late') : null].filter(Boolean)),
      el('td', null, Number(x.docs_pending) ? el('span', { class: 'cc-pill cc-pill-amber' }, [el('i', { class: 'cc-pill-dot' }), x.docs_pending + ' pending']) : '—'),
      el('td', null, Number(x.denials_7d) ? el('span', { style: 'color:#f59e0b;font-weight:700' }, String(x.denials_7d)) : '0'),
    ]))),
  ])) : el('div', { class: 'cc-sub' }, 'No drivers recorded.');
  const untrackedEl = untracked.length ? el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'Untracked (no app driver has run them in 60 days): ' + untracked.map((t) => 'Unit ' + (t.unit_no || '?') + (t.equipment ? ' (' + t.equipment + ')' : '')).join(', ') + '. Nudge the owner to invite the driver.') : null;
  const denials = d.denials || [];
  const denialsEl = denials.length ? el('details', { style: 'margin-top:8px' }, [
    el('summary', { class: 'cc-sub', style: 'cursor:pointer' }, denials.length + ' denied attempt' + (denials.length > 1 ? 's' : '') + ' — what drivers tried that the owner has not allowed'),
    el('div', { class: 'cc-sub' }, denials.slice(0, 10).map((x) => el('div', null, (x.driver || 'driver') + ' · ' + (x.rpc || '') + ' → ' + (x.perm || '') + ' · ' + fmtDateTime(x.at)))),
  ]) : null;
  const events = d.events || [];
  const eventsEl = events.length ? el('details', { style: 'margin-top:8px' }, [
    el('summary', { class: 'cc-sub', style: 'cursor:pointer' }, 'Recent access events (' + events.length + ')'),
    el('div', { class: 'cc-sub' }, events.slice(0, 15).map((e) => el('div', null, fmtDateTime(e.at) + ' · ' + e.kind + (e.payload && e.payload.name ? ' · ' + e.payload.name : '') + (e.payload && e.payload.platform ? ' · ' + e.payload.platform : '')))),
  ]) : null;
  mount(cardEl, [head, table, untrackedEl, denialsEl, eventsEl].filter(Boolean));
  // deep link #/carriers/<org>/drivers/<id>
  try {
    const m = /\/drivers\/([0-9a-f-]{36})/i.exec(location.hash || '');
    if (m) { const tr = cardEl.querySelector('[data-driver="' + m[1] + '"]'); if (tr) { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); tr.style.outline = '2px solid #0883F7'; setTimeout(() => { tr.style.outline = ''; }, 3500); } }
  } catch (_) {}
}

export async function mountAdoptionKpis(host) {
  let k; try { k = await ccDriverAdoptionKpis(); } catch (e) { mount(host, ''); return; }
  const n = (x) => Number(k[x] || 0);
  const pct = n('drivers_total') ? Math.round(100 * n('drivers_joined') / n('drivers_total')) : 0;
  mount(host, [
    el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Drivers on the app', value: n('drivers_joined') + ' / ' + n('drivers_total'), sub: pct + '% · ' + n('drivers_online_now') + ' online now', accent: pct >= 60 ? 'green' : 'amber' }),
      statCard({ icon: 'mail', label: 'Invites pending', value: String(n('invites_pending')), sub: n('invites_expiring_3d') + ' expire in 3 days · ' + n('joined_7d') + ' joined this week', accent: n('invites_expiring_3d') ? 'amber' : 'blue' }),
      statCard({ icon: 'truck', label: 'Carriers with untracked trucks', value: String(n('carriers_with_untracked_trucks')), sub: 'no app driver at all', accent: n('carriers_with_untracked_trucks') ? 'red' : 'green' }),
      statCard({ icon: 'flag', label: 'Location off on active trip', value: String(n('location_off_active_trip')), sub: n('suspended') + ' drivers paused · median join ' + (k.median_join_hours != null ? k.median_join_hours + ' h' : '—'), accent: n('location_off_active_trip') ? 'red' : 'green' }),
    ]),
    (k.top_untracked || []).length ? el('div', { class: 'cc-sub', style: 'margin:6px 0 12px' }, 'Most untracked trucks: ' + k.top_untracked.slice(0, 6).map((c) => c.carrier + ' (' + c.trucks + ')').join(' · ')) : null,
  ].filter(Boolean));
}

export default { mountDriverAccessCard, mountAdoptionKpis };
