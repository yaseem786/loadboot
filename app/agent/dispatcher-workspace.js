// dispatcher-workspace.js — the hired dispatcher's working surface (P0, bl_disp_0288).
// Mounted by carrier/app.js → renderDispatcherHome() once the dispatcher is in trial/verified/active.
// Self-contained: own scoped styles (dark premium, brand palette), own data loop, no edits to the
// application form or referral code. Everything it shows comes from dispatcher_workspace_feed()
// and is assignment-scoped server-side — the module never decides what a dispatcher may see.
//
// Tabs: Today (work queue + KPIs) · Trucks (specs + availability) · Bookings (log / RC / status /
// check calls) · Brokers (contact book) · Money (per-load commission) · Messages (3-way thread) ·
// Packet (carrier documents for broker setup).
import {
  dispatcherWorkspaceFeed, dispatcherSetAvailability, dispatcherLogBooking, dispatcherBookingUpdate,
  dispatcherBookingEvent, dispatcherBookingTimeline, dispatcherBrokerUpsert, dispatcherBrokerDelete,
  dispatcherThreadList, dispatcherThreadSend,
  dispatcherBoard, dispatcherRequestBook, dispatcherPostTruck, dispatcherUpdatePosting, dispatcherPostingMatches, dispatcherMyKpis,
  dispatcherTrip, dispatcherTripAction,
} from '../shared/api.js';
import { uploadDocument, signedDocumentUrl } from '../shared/storage.js';
import { el, mount, clear } from '../shared/ui/dom.js';
import { roadMiles } from '../shared/usGeo.js';
import { icon as sharedIcon } from '../shared/ui/icons.js';

// Line icons (Lucide-style, stroke=currentColor) — shared set + a few extras this module needs.
const XP = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-2 6-2 6-2s0 3-2 6l-6 6-4-4 6-6z"/><path d="M9 12 5.5 11 8 8.5M12 15l1 3.5 2.5-2.5"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  scale: '<path d="M12 3v18M3 7h18M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 4 3 5-7"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  fileCheck: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
};
function ic(name, size) {
  if (XP[name]) return h('span', { class: 'dw-ic', 'aria-hidden': 'true', html: '<svg xmlns="http://www.w3.org/2000/svg" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + XP[name] + '</svg>' });
  const s0 = sharedIcon(name, size || 18); s0.className = 'dw-ic'; return s0;
}
// RC reader (edge fn rc-parse, Gemini). Advisory only: returns null on ANY failure, never blocks.
async function readRateCon(file) {
  try {
    if (!file || file.size > 8 * 1024 * 1024) return null;
    const mime = file.type || 'application/pdf';
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime)) return null;
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
    if (!b64) return null;
    const { getClient } = await import('../shared/supabaseClient.js');
    const sb = await getClient(); const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const env = window.__LB_ENV || {};
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 60000);
    const r = await fetch(env.supabaseUrl + '/functions/v1/rc-parse', { method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey, Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ mime, data_b64: b64 }) });
    clearTimeout(tm);
    const j = await r.json().catch(() => null);
    return j && j.ok ? j : null;
  } catch (_) { return null; }
}
const stars = (n) => h('span', { class: 'dw-stars', title: n + '/5' }, Array.from({ length: 5 }, (_, i) => h('span', { style: 'opacity:' + (i < n ? 1 : .25) }, ic('star', 12))));

const h = el;
const money = (v) => '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString());
const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : '—');
const when = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const hh = Math.round(m / 60); if (hh < 48) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; };
const dtLocal = (v) => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const fromLocal = (s) => (s ? new Date(s).toISOString() : null);
const inches = (v) => (v == null ? '—' : v + '"');
const ftin = (v) => { if (v == null) return '—'; const f = Math.floor(v / 12), i = v % 12; return f + '\'' + (i ? ' ' + i + '"' : ''); };

const STATUS = {
  pending_rc: ['Awaiting RC', '#fbbf24'], rc_received: ['RC received — awaiting LoadBoot approval', '#7cc0ff'],
  approved: ['Approved — dispatch the driver', '#4ade80'], dispatched: ['Dispatched', '#4ade80'], picked_up: ['Picked up · in transit', '#4ade80'],
  delivered: ['Delivered', '#a7f3d0'], invoiced: ['Invoiced', '#a7f3d0'], paid: ['Paid', '#a7f3d0'],
  cancelled: ['Cancelled', '#94a3b8'], rejected: ['Not approved', '#f87171'],
};
const pill = (s) => { const m = STATUS[s] || [s, '#cbd5e1']; return h('span', { class: 'dw-pill', style: 'color:' + m[1] + ';border-color:' + m[1] + '55' }, m[0]); };

const CSS = `
.dw{--dw-line:rgba(255,255,255,.09);--dw-line2:rgba(255,255,255,.16);--dw-panel:rgba(255,255,255,.045);--dw-panel2:rgba(255,255,255,.07);--dw-ink:#eaf1fb;--dw-ink2:#c3d1e6;--dw-muted:#7f92b3;--dw-blue:#4EA6F9;--dw-orange:#FC5305;color:var(--dw-ink);font-family:Manrope,system-ui,sans-serif}
.dw *{box-sizing:border-box}
.dw-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;padding:6px;border-radius:16px;background:var(--dw-panel);border:1px solid var(--dw-line)}
.dw-tab{border:0;background:transparent;color:var(--dw-ink2);font:inherit;font-weight:800;font-size:.86rem;padding:9px 13px;border-radius:11px;cursor:pointer;display:flex;gap:7px;align-items:center}
.dw-tab.on{background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;box-shadow:0 8px 18px -10px rgba(8,131,247,.6)}
.dw-ic{display:inline-flex;align-items:center;vertical-align:-3px;line-height:0}
.dw-ic svg{display:block}
.dw-card h3 .dw-ic{color:var(--dw-blue);margin-right:2px}
.dw-stars{display:inline-flex;gap:1px;color:#fbbf24}
.dw-btn .dw-ic{margin-right:6px}
.dw-q .ic{color:var(--dw-blue);padding-top:2px}
.dw-q.hot .ic{color:var(--dw-orange)}
.dw-tab .n{background:var(--dw-orange);color:#fff;border-radius:99px;font-size:.7rem;padding:1px 7px}
.dw-card{background:var(--dw-panel);border:1px solid var(--dw-line);border-radius:18px;padding:18px 20px;margin-bottom:14px}
.dw-card h3{margin:0 0 10px;font-size:1.02rem;font-weight:900;color:#fff;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
.dw-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.dw-kpi{background:var(--dw-panel);border:1px solid var(--dw-line);border-radius:14px;padding:12px 14px}
.dw-kpi b{display:block;font-size:1.35rem;color:#fff;font-weight:900}
.dw-kpi span{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--dw-muted);font-weight:800}
.dw-pill{display:inline-block;border:1px solid;border-radius:99px;padding:3px 10px;font-size:.74rem;font-weight:800;white-space:nowrap}
.dw-muted{color:var(--dw-muted);font-size:.86rem}
.dw-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 14px}
.dw-f{padding:6px 0;border-bottom:1px solid var(--dw-line)}
.dw-f .k{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dw-muted);font-weight:800}
.dw-f .v{font-weight:700;color:var(--dw-ink);margin-top:2px;word-break:break-word}
.dw-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 12px}
.dw-form label{display:flex;flex-direction:column;gap:4px;font-size:.74rem;font-weight:800;color:var(--dw-muted);letter-spacing:.04em}
.dw-form .wide{grid-column:1/-1}
.dw .dw-in{width:100%;padding:10px 12px;border-radius:11px;border:1px solid var(--dw-line2);background:rgba(0,0,0,.25);color:#fff;font:inherit;font-size:.92rem}
.dw .dw-in:focus{outline:2px solid rgba(8,131,247,.55);border-color:transparent}
.dw select.dw-in option{color:#000}
.dw-btn{border:0;border-radius:12px;padding:10px 16px;font:inherit;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;box-shadow:0 8px 18px -10px rgba(8,131,247,.55)}
.dw-btn.ghost{background:transparent;border:1px solid var(--dw-line2);color:var(--dw-ink2);box-shadow:none}
.dw-btn.warn{background:linear-gradient(135deg,#FC5305,#e04a03)}
.dw-btn.sm{padding:7px 11px;font-size:.8rem;border-radius:10px}
.dw-btn:disabled{opacity:.5;cursor:default}
.dw-q{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--dw-line)}
.dw-q:last-child{border-bottom:0}
.dw-q .ic{font-size:1.25rem;line-height:1.2}
.dw-q b{color:#fff}
.dw-q.hot{border-left:3px solid var(--dw-orange);padding-left:10px}
.dw-book{padding:12px 0;border-bottom:1px solid var(--dw-line);cursor:pointer}
.dw-book:hover{background:rgba(255,255,255,.02)}
.dw-lane{font-weight:900;color:#fff;font-size:1rem}
.dw-msg{max-width:78%;padding:9px 12px;border-radius:14px;margin:6px 0;background:var(--dw-panel2);border:1px solid var(--dw-line)}
.dw-msg.mine{margin-left:auto;background:rgba(8,131,247,.22);border-color:rgba(8,131,247,.4)}
.dw-msg .who{font-size:.68rem;color:var(--dw-muted);font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.dw-msg.staff{border-color:rgba(252,83,5,.45)}
.dw-tl{border-left:2px solid var(--dw-line2);margin-left:8px;padding-left:14px}
.dw-tl>div{position:relative;padding:4px 0 10px}
.dw-tl>div:before{content:'';position:absolute;left:-19px;top:9px;width:8px;height:8px;border-radius:50%;background:var(--dw-blue)}
.dw-warn{background:rgba(252,83,5,.12);border:1px solid rgba(252,83,5,.45);border-radius:12px;padding:10px 12px;color:#ffb38a;font-weight:700;font-size:.86rem}
.dw-ok{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.4);border-radius:12px;padding:10px 12px;color:#86efac;font-weight:700;font-size:.86rem}
.dw-err{color:#f87171;font-weight:700;font-size:.86rem;margin-top:8px}
.dw-table{width:100%;border-collapse:collapse;font-size:.86rem}
.dw-table th{text-align:left;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dw-muted);padding:6px 8px;border-bottom:1px solid var(--dw-line2)}
.dw-table td{padding:8px;border-bottom:1px solid var(--dw-line);vertical-align:top}
.dw-tablewrap{overflow-x:auto}
.dw-modal{position:fixed;inset:0;background:rgba(3,8,18,.72);z-index:9000;display:flex;align-items:flex-end;justify-content:center;padding:0}
.dw-modal .box{background:#0b1220;border:1px solid var(--dw-line2);border-radius:22px 22px 0 0;width:min(820px,100%);max-height:92vh;overflow:auto;padding:18px 20px 28px}
@media(min-width:720px){.dw-modal{align-items:center;padding:20px}.dw-modal .box{border-radius:22px}}
.dw-modal h3{margin:0 0 12px;color:#fff;display:flex;justify-content:space-between;align-items:center}
.dw-x{background:transparent;border:1px solid var(--dw-line2);color:#fff;border-radius:10px;padding:5px 10px;cursor:pointer;font-weight:800}
.dw-chip{display:inline-block;padding:3px 9px;border-radius:99px;background:var(--dw-panel2);border:1px solid var(--dw-line);font-size:.74rem;font-weight:700;color:var(--dw-ink2);margin:2px 3px 2px 0}
.dw-chip.no{opacity:.45;text-decoration:line-through}
.dw-avail{background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:14px;padding:12px 14px;margin-top:10px}
`;

export async function mountDispatcherWorkspace(host, opts = {}) {
  const root = h('div', { class: 'dw' });
  if (!document.getElementById('dw-css')) { const s = document.createElement('style'); s.id = 'dw-css'; s.textContent = CSS; document.head.appendChild(s); }
  mount(host, root);
  let feed = null; let tab = (opts.tab) || (sessionStorage.getItem('dw_tab') || 'today'); let busy = false;
  const body = h('div');
  const tabsEl = h('div', { class: 'dw-tabs' });
  root.append(tabsEl, body);

  async function load() {
    try { feed = await dispatcherWorkspaceFeed(); } catch (e) { feed = { error: e.message || 'Could not load your workspace.' }; }
    render();
  }
  function err(msg) { return h('div', { class: 'dw-err' }, msg); }
  const A = () => (feed && feed.assignments) || [];
  const B = () => (feed && feed.bookings) || [];
  const trucksAll = () => A().flatMap((a) => (a.trucks || []).map((t) => ({ ...t, _a: a })));
  const activeFor = (truckId) => B().filter((b) => b.truck_id === truckId && ['approved', 'dispatched', 'picked_up', 'rc_received', 'pending_rc'].includes(b.status));

  // ---------------------------------------------------------------- queue (client-side rules, all from feed)
  function queue() {
    const q = []; const now = Date.now();
    const p = feed.profile || {};
    if (p.trial_end) { const days = Math.ceil((new Date(p.trial_end) - now) / 86400000); if (days >= 0) q.push({ ic: 'rocket', hot: days <= 2, t: 'Trial: ' + days + ' day' + (days === 1 ? '' : 's') + ' left', s: 'Commission ' + (p.commission_pct || 0) + '% of gross on every load delivered during the trial.' }); }
    for (const t of trucksAll()) {
      const av = t.availability || {}; const act = activeFor(t.id).filter((b) => ['approved', 'dispatched', 'picked_up'].includes(b.status));
      const label = (t._a.carrier && t._a.carrier.name) + ' · Unit ' + (t.unit_no || '?') + ' (' + (t.equipment || 'truck') + ')';
      if (!act.length && (av.status || 'empty') === 'empty') {
        q.push({ ic: 'search', hot: true, t: 'Find a load — ' + label, s: (av.empty_location ? 'Empty at ' + av.empty_location + (av.empty_at ? ' from ' + when(av.empty_at) : '') : 'Location not set — update availability') + (av.must_be_home_by ? ' · home by ' + when(av.must_be_home_by) : ''), go: 'board' });
      }
      if (!av.updated_at || now - new Date(av.updated_at).getTime() > 36 * 3600000) q.push({ ic: 'pin', t: 'Availability is ' + (av.updated_at ? ago(av.updated_at) : 'not set') + ' — ' + label, s: 'Brokers ask "where is the truck and when is it empty?" — keep this current.', go: 'trucks' });
      if (av.must_be_home_by) { const hrs = (new Date(av.must_be_home_by) - now) / 3600000; if (hrs > 0 && hrs < 48) q.push({ ic: 'home', hot: hrs < 24, t: 'Home-time deadline in ' + Math.round(hrs) + ' h — ' + label, s: 'Every load from here must land the truck at ' + (av.home_location || 'home') + ' by ' + when(av.must_be_home_by) + '.', go: 'trucks' }); }
      if (av.hos_drive_left_h != null && av.hos_drive_left_h < 3 && act.length) q.push({ ic: 'clock', hot: true, t: 'HOS: only ' + av.hos_drive_left_h + ' h drive left — ' + label, s: 'Plan the next stop around a reset.', go: 'trucks' });
    }
    for (const b of B()) {
      const lane = b.origin + ' → ' + b.destination;
      if (b.status === 'pending_rc') q.push({ ic: 'doc', hot: true, t: 'Attach the rate confirmation — ' + lane, s: 'LoadBoot cannot approve, and the driver cannot move, until the RC is on file.', go: 'bookings', id: b.id });
      if (b.status === 'rc_received') q.push({ ic: 'clock', t: 'Waiting for LoadBoot approval — ' + lane, s: b.below_min ? 'Below the carrier’s minimum rate — expect a question.' : 'Usually minutes. Message the team if it’s urgent.', go: 'bookings', id: b.id });
      if (b.status === 'approved') q.push({ ic: 'truck', hot: true, t: 'Approved — dispatch the driver — ' + lane, s: 'Send pickup details to the driver, then mark Dispatched.', go: 'bookings', id: b.id });
      if (['dispatched', 'picked_up'].includes(b.status)) {
        const last = b._last_event_at || b.updated_at; const hrs = (now - new Date(last).getTime()) / 3600000;
        if (hrs >= 4) q.push({ ic: 'phone', hot: hrs >= 8, t: 'Check call due (' + Math.round(hrs) + ' h since last update) — ' + lane, s: 'Log location + ETA. Brokers expect an update every 4 hours.', go: 'bookings', id: b.id });
        if (b.delivery_at && new Date(b.delivery_at) < now && b.status !== 'delivered') q.push({ ic: 'alert', hot: true, t: 'Delivery time passed — ' + lane, s: 'Mark delivered with the POD, or log an exception.', go: 'bookings', id: b.id });
      }
    }
    return q.sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0));
  }

  // ---------------------------------------------------------------- render
  function render() {
    clear(tabsEl);
    if (!feed || feed.error) { mount(body, h('div', { class: 'dw-card' }, [h('h3', null, 'Dispatcher workspace'), h('div', { class: 'dw-muted' }, (feed && feed.error) || 'Loading…')])); return; }
    const k = feed.kpi || {}; const unread = A().reduce((s, a) => s + Number(a.unread || 0), 0);
    const TABS = [['today', 'Today', 'clipboard', queue().filter((x) => x.hot).length], ['board', 'Board', 'search', 0], ['trucks', 'Trucks', 'truck', 0], ['bookings', 'Bookings', 'package', Number(k.awaiting_rc || 0) + Number(k.approved || 0)], ['brokers', 'Brokers', 'phone', 0], ['money', 'Money', 'dollar', 0], ['messages', 'Messages', 'chat', unread], ['packet', 'Packet', 'paperclip', 0], ['kpis', 'My KPIs', 'chart', 0]];
    TABS.forEach(([id, label, icn, n]) => tabsEl.appendChild(h('button', { class: 'dw-tab' + (tab === id ? ' on' : ''), onClick: () => { tab = id; try { sessionStorage.setItem('dw_tab', id); } catch (_) {} render(); } }, [ic(icn, 16), label, n ? h('span', { class: 'n' }, String(n)) : null])));
    const view = { today: vToday, board: vBoard, trucks: vTrucks, bookings: vBookings, brokers: vBrokers, money: vMoney, messages: vMessages, packet: vPacket, kpis: vKpis }[tab] || vToday;
    mount(body, view());
  }

  function kpis() {
    const k = feed.kpi || {}; const c = feed.commission || {};
    return h('div', { class: 'dw-kpis' }, [
      ['Active loads', k.active], ['Awaiting RC', k.awaiting_rc], ['Awaiting approval', k.awaiting_approval],
      ['Gross · 7 days', money(k.gross_7d)], ['Avg $/mile', k.avg_rpm != null ? '$' + Number(k.avg_rpm).toFixed(2) : '—'], ['Commission earned', money(c.earned)],
    ].map(([l, v]) => h('div', { class: 'dw-kpi' }, [h('b', null, v == null ? '—' : String(v)), h('span', null, l)])));
  }

  // ---- TODAY
  function vToday() {
    const q = queue(); const p = feed.profile || {};
    return h('div', null, [
      h('div', { class: 'dw-card', style: 'background:linear-gradient(135deg,rgba(8,131,247,.16),rgba(252,83,5,.08))' }, [
        h('h3', null, ['Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') + ', ' + (p.full_name || 'dispatcher').split(' ')[0], h('span', { class: 'dw-pill', style: 'color:#4ade80;border-color:#4ade8055' }, (p.status || '').toUpperCase())]),
        h('div', { class: 'dw-muted' }, A().length + ' carrier' + (A().length === 1 ? '' : 's') + ' · ' + trucksAll().length + ' truck' + (trucksAll().length === 1 ? '' : 's') + ' · ' + B().filter((b) => ['approved', 'dispatched', 'picked_up'].includes(b.status)).length + ' load' + (B().length === 1 ? '' : 's') + ' moving'),
      ]),
      kpis(),
      h('div', { class: 'dw-card' }, [h('h3', null, ['Work queue', h('button', { class: 'dw-btn sm ghost', onClick: load }, [ic('refresh', 14), 'Refresh'])]),
        q.length ? q.map((x) => h('div', { class: 'dw-q' + (x.hot ? ' hot' : ''), style: x.go ? 'cursor:pointer' : '', onClick: () => { if (x.go) { tab = x.go; if (x.id) openBooking(x.id); render(); } } }, [h('div', { class: 'ic' }, ic(x.ic, 20)), h('div', null, [h('b', null, x.t), h('div', { class: 'dw-muted' }, x.s)])]))
          : h('div', { class: 'dw-ok' }, 'Nothing urgent. Trucks are covered, RCs are in, check calls are current.')]),
      h('div', { class: 'dw-card' }, [h('h3', null, 'Rules of the road'), h('div', { class: 'dw-muted', style: 'line-height:1.9' }, [
        h('div', null, '1. Every rate confirmation goes to LoadBoot first (attach it here). The driver does not move until the booking shows Approved.'),
        h('div', null, '2. Below the carrier’s minimum rate? Log it anyway — it is flagged and LoadBoot decides. Never promise the broker before that.'),
        h('div', null, '3. Check call every 4 hours while loaded: location + ETA. Log it under the booking.'),
        h('div', null, '4. Book under the carrier’s MC only. Never touch freight money. Never re-broker.'),
        h('div', null, '5. Something went wrong (detention, breakdown, refused freight)? Log an Exception — LoadBoot is alerted instantly.'),
      ])]),
    ]);
  }

  // ---- TRUCKS
  function vTrucks() {
    const ts = trucksAll();
    if (!ts.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Trucks'), h('div', { class: 'dw-muted' }, A().length ? 'Your carrier has no truck on file yet — ask LoadBoot to add it.' : 'No carrier assigned yet.')]);
    return h('div', null, [
      ...A().map((a) => carrierCard(a)),
      ...ts.map((t) => truckCard(t)),
    ]);
  }
  function carrierCard(a) {
    const c = a.carrier || {}; const s = a.sop || {};
    return h('div', { class: 'dw-card' }, [
      h('h3', null, [h('span', null, [ic('building'), ' ' + (c.name || 'Carrier')]), h('span', { class: 'dw-pill', style: 'color:' + (c.broker_visible ? '#4ade80' : '#fbbf24') + ';border-color:currentColor' }, c.broker_visible ? 'LIVE TO BROKERS' : 'NOT YET VISIBLE')]),
      h('div', { class: 'dw-grid' }, [
        f('MC', c.mc), f('USDOT', c.dot), f('Contact', c.contact_name), f('Phone', c.phone), f('WhatsApp', c.whatsapp), f('Email', c.email),
        f('Home base', c.home_base), f('Carrier min $/mi', c.min_rpm != null ? '$' + Number(c.min_rpm).toFixed(2) : null), f('Max deadhead', c.max_deadhead != null ? c.max_deadhead + ' mi' : null),
        f('Avoid states', c.avoid_states), f('Weekends', yn(c.weekend_ok)), f('Factoring', c.factoring_company ? c.factoring_company + (c.factoring_status ? ' · ' + c.factoring_status : '') : null),
      ]),
      (s.scope_value || s.lanes || s.rules || s.min_rate) ? h('div', { class: 'dw-avail' }, [h('b', { style: 'color:#7cc0ff' }, [ic('scale', 16), ' Your SOP for this carrier']), h('div', { class: 'dw-muted', style: 'line-height:1.8;margin-top:4px' }, [
        s.scope_value ? h('div', null, 'Scope: ' + s.scope_value + ' — only source loads inside this scope.') : null,
        s.lanes ? h('div', null, 'Lanes: ' + s.lanes) : null, s.min_rate ? h('div', null, 'Min rate/mile: $' + s.min_rate) : null,
        s.equipment ? h('div', null, 'Equipment: ' + s.equipment) : null, s.home_time ? h('div', null, 'Home time: ' + s.home_time) : null, s.rules ? h('div', null, 'Rules: ' + s.rules) : null,
      ])]) : null,
      (a.drivers || []).length ? h('div', { style: 'margin-top:10px' }, [h('div', { class: 'dw-f' }, [h('div', { class: 'k' }, 'Drivers on file'), h('div', { class: 'v' }, a.drivers.map((d) => (d.name || '?') + (d.phone ? ' · ' + d.phone : '')).join('  |  '))])]) : null,
    ]);
  }
  function f(k, v) { return h('div', { class: 'dw-f' }, [h('div', { class: 'k' }, k), h('div', { class: 'v' }, v == null || v === '' ? '—' : String(v))]); }
  function truckCard(t) {
    const av = t.availability || {}; const act = activeFor(t.id).filter((b) => ['approved', 'dispatched', 'picked_up'].includes(b.status)); const pend = activeFor(t.id).length - act.length;
    const chips = [['Dock-high', t.dock_high], ['Liftgate', t.liftgate], ['Pallet jack', t.has_pallet_jack], ['Ramp', t.has_ramp], ['Straps', t.has_straps], ['Chains', t.has_chains], ['Tarps', t.has_tarps], ['E-track', t.has_etrack], ['Load bars', t.has_load_bars], ['Blankets', t.has_blankets], ['Team', t.team_driven], ['Hazmat', t.hazmat_placarded]].filter(([, v]) => v != null);
    const card = h('div', { class: 'dw-card' });
    const availBox = h('div');
    const renderAvail = (editing) => {
      if (!editing) {
        mount(availBox, h('div', { class: 'dw-avail' }, [
          h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('b', { style: 'color:#7cc0ff' }, [ic('pin', 16), ' Availability' + (av.updated_at ? ' · updated ' + ago(av.updated_at) : ' · NOT SET')]), h('button', { class: 'dw-btn sm', onClick: () => renderAvail(true) }, av.updated_at ? 'Update' : 'Set availability')]),
          h('div', { class: 'dw-grid', style: 'margin-top:6px' }, [
            f('Status', (av.status || 'empty').toUpperCase()), f('Empty at', av.empty_location ? av.empty_location + (av.empty_zip ? ' ' + av.empty_zip : '') : null), f('Empty from', av.empty_at ? when(av.empty_at) : null),
            f('Must be home by', av.must_be_home_by ? when(av.must_be_home_by) + (av.home_location ? ' · ' + av.home_location : '') : null),
            f('Overnight weekdays', yn(av.overnight_weekdays)), f('Overnight weekends', yn(av.overnight_weekends)),
            f('HOS drive left', av.hos_drive_left_h != null ? av.hos_drive_left_h + ' h' : null), f('Driver', av.driver_name ? av.driver_name + (av.driver_phone ? ' · ' + av.driver_phone : '') : null),
          ]),
          av.note ? h('div', { class: 'dw-muted', style: 'margin-top:6px' }, av.note) : null,
        ]));
        return;
      }
      const I = (k, type, extra) => h('input', Object.assign({ class: 'dw-in', type: type || 'text', value: av[k] == null ? '' : (type === 'datetime-local' ? dtLocal(av[k]) : String(av[k])) }, extra || {}));
      const st = h('select', { class: 'dw-in' }, ['empty', 'loaded', 'off', 'maintenance'].map((v) => h('option', { value: v, selected: (av.status || 'empty') === v }, v.toUpperCase())));
      const eloc = I('empty_location'), ezip = I('empty_zip'), eat = I('empty_at', 'datetime-local'), home = I('must_be_home_by', 'datetime-local'), hloc = I('home_location');
      const owd = h('input', { type: 'checkbox', checked: av.overnight_weekdays !== false }), owe = h('input', { type: 'checkbox', checked: av.overnight_weekends === true });
      const hos = I('hos_drive_left_h', 'number', { step: '0.5', min: '0', max: '11' }), dn = I('driver_name'), dp = I('driver_phone'), note = h('textarea', { class: 'dw-in', rows: 2 }, av.note || '');
      const e = h('div', { class: 'dw-err' });
      mount(availBox, h('div', { class: 'dw-avail' }, [h('b', { style: 'color:#7cc0ff' }, [ic('pin', 16), ' Update availability']), h('div', { class: 'dw-form', style: 'margin-top:8px' }, [
        h('label', null, ['Status', st]), h('label', null, ['Empty at (city, ST)', eloc]), h('label', null, ['ZIP', ezip]), h('label', null, ['Empty from', eat]),
        h('label', null, ['Must be home by', home]), h('label', null, ['Home location', hloc]),
        h('label', null, ['HOS drive hours left', hos]), h('label', null, ['Driver name', dn]), h('label', null, ['Driver phone', dp]),
        h('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, [owd, 'Overnight OK on weekdays']), h('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, [owe, 'Overnight OK on weekends']),
        h('label', { class: 'wide' }, ['Note for LoadBoot / carrier', note]),
      ]), e, h('div', { class: 'dw-row', style: 'margin-top:10px' }, [
        h('button', { class: 'dw-btn', onClick: async (ev) => { ev.target.disabled = true; try {
          const r = await dispatcherSetAvailability(t.id, { status: st.value, empty_location: eloc.value, empty_zip: ezip.value, empty_at: fromLocal(eat.value), must_be_home_by: fromLocal(home.value), home_location: hloc.value, overnight_weekdays: owd.checked, overnight_weekends: owe.checked, hos_drive_left_h: hos.value || null, driver_name: dn.value, driver_phone: dp.value, note: note.value });
          if (r && r.error) throw new Error(r.error); await load();
        } catch (x) { e.textContent = x.message; ev.target.disabled = false; } } }, 'Save'),
        h('button', { class: 'dw-btn ghost', onClick: () => renderAvail(false) }, 'Cancel'),
      ])]));
    };
    renderAvail(false);
    mount(card, [
      h('h3', null, [h('span', null, [ic('truck'), ' Unit ' + (t.unit_no || '?') + ' — ' + [t.year, t.make, t.model].filter(Boolean).join(' ') + (t.equipment ? ' · ' + t.equipment : '')]), h('span', { class: 'dw-pill', style: 'color:' + (act.length ? '#4ade80' : '#fbbf24') + ';border-color:currentColor' }, act.length ? act.length + ' LOAD' + (act.length > 1 ? 'S' : '') + ' MOVING' : pend ? pend + ' BOOKING' + (pend > 1 ? 'S' : '') + ' PENDING' : (av.status || 'EMPTY').toUpperCase())]),
      h('div', { class: 'dw-muted' }, (t._a.carrier && t._a.carrier.name) || ''),
      h('div', { class: 'dw-grid', style: 'margin-top:8px' }, [
        f('Payload', t.payload_lbs != null ? num(t.payload_lbs) + ' lb' : null), f('Interior L × W × H', (t.cargo_len_in || t.cargo_width_in || t.cargo_height_in) ? ftin(t.cargo_len_in) + ' × ' + inches(t.cargo_width_in) + ' × ' + inches(t.cargo_height_in) : null),
        f('Deck height', t.deck_height_in != null ? t.deck_height_in + '"' : null), f('GVWR', t.gvwr), f('Pallet positions', t.pallet_positions),
        t.trailer_type ? f('Trailer', t.trailer_type + (t.trailer_len_ft ? ' · ' + t.trailer_len_ft + ' ft' : '')) : null,
        f('Domicile', [t.domicile_city, t.domicile_state, t.domicile_zip].filter(Boolean).join(', ')), f('Min $/mile', t.min_rpm != null ? '$' + Number(t.min_rpm).toFixed(2) : null),
        f('Max radius', t.max_radius_miles != null ? t.max_radius_miles + ' mi' : null), f('Home time', t.home_time), f('Temp control', t.temp_control), f('Inspection exp', t.inspection_exp),
      ]),
      chips.length ? h('div', { style: 'margin-top:10px' }, chips.map(([l, v]) => h('span', { class: 'dw-chip' + (v ? '' : ' no') }, [ic(v ? 'check' : 'x', 12), ' ' + l]))) : null,
      t.spec_note ? h('div', { class: 'dw-warn', style: 'margin-top:10px' }, [ic('alert', 16), ' ' + t.spec_note]) : null,
      t.capacity_note ? h('div', { class: 'dw-muted', style: 'margin-top:8px;line-height:1.7' }, t.capacity_note) : null,
      availBox,
      h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: () => { tab = 'bookings'; render(); openLogForm(t); } }, [ic('plus', 16), 'Log a booking for this truck'])]),
    ]);
    return card;
  }

  // ---- BOOKINGS
  let openId = null;
  function openBooking(id) { openId = id; }
  function vBookings() {
    const bs = B();
    const wrap = h('div');
    const filt = h('select', { class: 'dw-in', style: 'width:auto', onChange: () => paint() }, [['', 'All'], ['open', 'Open'], ['pending_rc', 'Awaiting RC'], ['rc_received', 'Awaiting approval'], ['approved', 'Approved'], ['dispatched', 'Dispatched'], ['picked_up', 'In transit'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled / rejected']].map(([v, l]) => h('option', { value: v }, l)));
    const list = h('div');
    const paint = () => {
      const v = filt.value; const rows = bs.filter((b) => !v || (v === 'open' ? !['delivered', 'invoiced', 'paid', 'cancelled', 'rejected'].includes(b.status) : v === 'cancelled' ? ['cancelled', 'rejected'].includes(b.status) : b.status === v));
      mount(list, rows.length ? rows.map((b) => bookingRow(b)) : h('div', { class: 'dw-muted', style: 'padding:10px 0' }, 'No bookings here yet.'));
    };
    paint();
    mount(wrap, [
      h('div', { class: 'dw-card' }, [h('h3', null, ['Bookings', h('div', { class: 'dw-row' }, [filt, h('button', { class: 'dw-btn', onClick: () => openLogForm(null) }, [ic('plus', 16), 'Log a booking'])])]), list]),
    ]);
    if (openId) { const b = bs.find((x) => x.id === openId); if (b) setTimeout(() => showBooking(b), 0); openId = null; }
    return wrap;
  }
  function bookingRow(b) {
    const rpm = b.miles > 0 ? Number(b.gross) / Number(b.miles) : null;
    return h('div', { class: 'dw-book', onClick: () => showBooking(b) }, [
      h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, b.origin + ' → ' + b.destination), pill(b.status)]),
      h('div', { class: 'dw-muted', style: 'margin-top:4px' }, [b.broker, ' · ', money(b.gross), rpm ? ' · $' + rpm.toFixed(2) + '/mi' : '', b.miles ? ' · ' + num(b.miles) + ' mi' : '', b.pickup_at ? ' · PU ' + when(b.pickup_at) : '', b.below_min ? h('span', { style: 'color:#ffb38a;font-weight:800' }, ' · below min') : '']),
    ]);
  }
  function modal(title, content) {
    const box = h('div', { class: 'box' }); const m = h('div', { class: 'dw-modal', onClick: (e) => { if (e.target === m) m.remove(); } }, box);
    mount(box, [h('h3', null, [title, h('button', { class: 'dw-x', onClick: () => m.remove() }, ic('x', 16))]), content]);
    root.appendChild(m); return m;
  }
  async function showBooking(b) {
    const body = h('div');
    const m = modal(b.origin + ' → ' + b.destination, body);
    const rpm = b.miles > 0 ? Number(b.gross) / Number(b.miles) : null;
    const tl = h('div', { class: 'dw-muted' }, 'Loading timeline…');
    const e = h('div', { class: 'dw-err' });
    const act = async (fn) => { try { const r = await fn(); if (r && r.error) throw new Error(r.error); m.remove(); await load(); } catch (x) { e.textContent = x.message; } };
    const noteIn = h('input', { class: 'dw-in', placeholder: 'note (optional)' }), locIn = h('input', { class: 'dw-in', placeholder: 'location (city, ST)' }), etaIn = h('input', { class: 'dw-in', type: 'datetime-local' });
    const rcFile = h('input', { type: 'file', accept: '.pdf,image/*', class: 'dw-in' }), rcNo = h('input', { class: 'dw-in', placeholder: 'RC / load number' });
    const actions = [];
    if (['pending_rc', 'rc_received'].includes(b.status)) actions.push(h('div', { class: 'dw-avail' }, [h('b', { style: 'color:#7cc0ff' }, [ic('doc', 16), b.rc_doc_path ? ' Replace rate confirmation' : ' Attach the rate confirmation']), h('div', { class: 'dw-form', style: 'margin-top:8px' }, [h('label', null, ['File (PDF / photo)', rcFile]), h('label', null, ['RC number', rcNo])]),
      h('button', { class: 'dw-btn', style: 'margin-top:8px', onClick: (ev) => act(async () => { const f0 = rcFile.files && rcFile.files[0]; if (!f0) throw new Error('Choose the RC file first.'); ev.target.disabled = true; const up = await uploadDocument(f0, 'rate_confirmation'); return dispatcherBookingUpdate(b.id, { rc_doc_path: up.path, rc_doc_name: up.fileName, rc_number: rcNo.value || null }); }) }, 'Upload RC')]));
    if (b.status === 'approved') actions.push(h('button', { class: 'dw-btn', onClick: () => act(() => dispatcherBookingUpdate(b.id, { status: 'dispatched', note: noteIn.value })) }, [ic('truck', 16), 'Driver dispatched']));
    if (b.status === 'dispatched') actions.push(h('button', { class: 'dw-btn', onClick: () => act(() => dispatcherBookingUpdate(b.id, { status: 'picked_up', note: noteIn.value, location: locIn.value })) }, [ic('package', 16), 'Picked up / loaded']));
    if (b.status === 'picked_up') actions.push(h('button', { class: 'dw-btn', onClick: () => act(() => dispatcherBookingUpdate(b.id, { status: 'delivered', note: noteIn.value, location: locIn.value })) }, [ic('fileCheck', 16), 'Delivered']));
    if (['dispatched', 'picked_up', 'approved'].includes(b.status)) {
      actions.push(h('button', { class: 'dw-btn ghost', onClick: () => act(() => dispatcherBookingEvent(b.id, 'check_call', noteIn.value || 'Check call', locIn.value || null, fromLocal(etaIn.value))) }, [ic('phone', 16), 'Log check call']));
      actions.push(h('button', { class: 'dw-btn warn', onClick: () => act(() => { if (!noteIn.value) throw new Error('Describe the exception in the note.'); return dispatcherBookingEvent(b.id, 'exception', noteIn.value, locIn.value || null, null); }) }, [ic('alert', 16), 'Exception']));
    }
    if (!['delivered', 'invoiced', 'paid', 'cancelled', 'rejected'].includes(b.status)) actions.push(h('button', { class: 'dw-btn ghost', onClick: () => { if (confirm('Cancel this booking?')) act(() => dispatcherBookingUpdate(b.id, { status: 'cancelled', note: noteIn.value })); } }, 'Cancel booking'));
    actions.push(h('button', { class: 'dw-btn ghost', onClick: () => act(() => dispatcherBookingEvent(b.id, 'note', noteIn.value || '(empty)', locIn.value || null, null)) }, [ic('edit', 16), 'Add note']));
    mount(body, [
      h('div', { class: 'dw-row', style: 'justify-content:space-between;margin-bottom:8px' }, [pill(b.status), b.below_min ? h('span', { class: 'dw-warn', style: 'padding:4px 10px' }, 'Below carrier minimum rate') : null]),
      b.decision_note ? h('div', { class: 'dw-warn', style: 'margin-bottom:8px' }, 'LoadBoot: ' + b.decision_note) : null,
      h('div', { class: 'dw-grid' }, [f('Broker', b.broker + (b.broker_mc ? ' · MC ' + b.broker_mc : '')), f('Rep', [b.broker_rep, b.broker_phone, b.broker_email].filter(Boolean).join(' · ')), f('Gross', money(b.gross)), f('$/mile', rpm ? '$' + rpm.toFixed(2) : null), f('Miles', b.miles), f('Deadhead', b.deadhead), f('Pickup', when(b.pickup_at)), f('Delivery', when(b.delivery_at)), f('Commodity', b.commodity), f('Weight', b.weight_lbs ? num(b.weight_lbs) + ' lb' : null), f('RC #', b.rc_number), f('Logged', when(b.created_at))]),
      b.rc_doc_path ? h('div', { style: 'margin:8px 0' }, h('button', { class: 'dw-btn sm ghost', onClick: async () => { try { const u = await signedDocumentUrl(b.rc_doc_path, 600); window.open(u, '_blank'); } catch (x) { e.textContent = x.message; } } }, [ic('doc', 14), 'Open RC · ' + (b.rc_doc_name || 'file')])) : null,
      b.notes ? h('div', { class: 'dw-muted', style: 'margin:6px 0' }, b.notes) : null,
      h('div', { class: 'dw-form', style: 'margin-top:10px' }, [h('label', null, ['Note', noteIn]), h('label', null, ['Location', locIn]), h('label', null, ['ETA', etaIn])]),
      e,
      h('div', { class: 'dw-row', style: 'margin-top:10px' }, actions),
      b.trip_id ? tripPanel(b) : null,
      h('h3', { style: 'margin-top:16px;font-size:.9rem' }, 'Timeline'), tl,
    ]);
    try { const r = await dispatcherBookingTimeline(b.id); const rows = Array.isArray(r) ? r : []; mount(tl, rows.length ? h('div', { class: 'dw-tl' }, rows.map((x) => h('div', null, [h('b', { style: 'color:#fff' }, ({ created: 'Logged', rc: 'RC', status: 'Status', check_call: 'Check call', note: 'Note', exception: 'Exception', decision: 'LoadBoot', eta: 'ETA' })[x.kind] || x.kind), ' · ', h('span', { class: 'dw-muted' }, when(x.created_at) + (x.by ? ' · ' + x.by : '')), h('div', null, [x.note || '', x.location ? ' — ' + x.location : '', x.eta_at ? ' — ETA ' + when(x.eta_at) : ''])]))) : h('div', { class: 'dw-muted' }, 'No events yet.')); } catch (x) { mount(tl, err(x.message)); }
  }
  // ---- TRIP PANEL (bl_disp_0290): the CC trip behind an approved booking — arrive/depart, check-in,
  //      detention/TONU/layover claims, issues, POD status, RC. All via the carrier engines, as the carrier.
  function tripPanel(b) {
    const box = h('div', { class: 'dw-avail', style: 'margin-top:12px' }, h('div', { class: 'dw-muted' }, 'Loading trip…'));
    const e = h('div', { class: 'dw-err' });
    const org = b.carrier_org_id;
    async function paint() {
      let d; try { d = await dispatcherTrip(org, b.trip_id); } catch (x) { d = { error: x.message }; }
      if (d.error) { mount(box, [h('b', { style: 'color:#7cc0ff' }, [ic('navigation', 16), ' Trip']), err(d.error)]); return; }
      const t = d.trip || {}; const stops = d.stops || []; const dwell = d.dwell || []; const pods = d.pods || []; const acc = d.accessorials || []; const exc = d.exceptions || [];
      const open = (stop) => dwell.find((x) => x.stop === stop && x.arrived_at && !x.departed_at);
      const done = (stop) => dwell.find((x) => x.stop === stop && x.departed_at);
      const act = async (action, p) => { e.textContent = ''; const r = await dispatcherTripAction(org, b.trip_id, action, p).catch((x) => ({ error: x.message })); if (r && r.error) { e.textContent = r.error; return; } await paint(); };
      const note = h('input', { class: 'dw-in', placeholder: 'note / where is the truck' });
      const stopBtns = ['pickup', 'delivery'].map((stop) => {
        const o = open(stop), dn = done(stop);
        return h('div', { class: 'dw-row', style: 'gap:6px' }, [
          h('span', { class: 'dw-chip' }, stop.toUpperCase() + (dn ? ' · done' : o ? ' · on site since ' + when(o.arrived_at) : '')),
          !o && !dn ? h('button', { class: 'dw-btn sm', onClick: () => act('arrive', { stop, free_minutes: 120 }) }, 'Arrived at ' + stop) : null,
          o ? h('button', { class: 'dw-btn sm', onClick: () => act('depart', { stop, note: note.value }) }, 'Departed ' + stop) : null,
        ]);
      });
      mount(box, [
        h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('b', { style: 'color:#7cc0ff' }, [ic('navigation', 16), ' Trip · ' + String(t.status || '').replace('_', ' ').toUpperCase()]), h('button', { class: 'dw-btn sm ghost', onClick: paint }, ic('refresh', 14))]),
        h('div', { class: 'dw-grid', style: 'margin-top:6px' }, [f('Driver', t.driver_name ? t.driver_name + (t.driver_phone ? ' · ' + t.driver_phone : '') : null), f('Truck', t.truck_no), f('Tracking', t.tracking_method), f('Last location', t.last_lat != null ? Number(t.last_lat).toFixed(3) + ', ' + Number(t.last_lng).toFixed(3) + ' · ' + ago(t.last_loc_at) : null), f('Pickup risk', t.pickup_risk), f('POD', pods.length ? pods.length + ' file' + (pods.length > 1 ? 's' : '') + ' · ' + pods[0].status : 'not uploaded')]),
        stops.length ? h('div', { class: 'dw-muted', style: 'margin-top:6px' }, stops.map((s0) => (s0.kind || '') + ': ' + (s0.location || '') + (s0.scheduled_at ? ' · ' + when(s0.scheduled_at) : '')).join('  →  ')) : null,
        h('div', { style: 'margin-top:8px' }, stopBtns),
        h('div', { class: 'dw-form', style: 'margin-top:8px' }, [h('label', { class: 'wide' }, ['Note', note])]),
        h('div', { class: 'dw-row', style: 'margin-top:8px' }, [
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('checkin', { note: note.value || 'check-in' }) }, [ic('pin', 14), 'GPS-less check-in']),
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('accessorial', { kind: 'detention', note: note.value }) }, 'Claim detention'),
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('accessorial', { kind: 'tonu', note: note.value }) }, 'Claim TONU'),
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('accessorial', { kind: 'layover', note: note.value }) }, 'Claim layover'),
          h('button', { class: 'dw-btn sm warn', onClick: () => { const k = prompt('Issue type: breakdown / accident / weather / missed_appointment / other', 'breakdown'); if (!k) return; act('issue', { kind: k, note: note.value }); } }, [ic('alert', 14), 'Report issue']),
        ]),
        acc.length ? h('div', { style: 'margin-top:8px' }, [h('div', { class: 'dw-muted', style: 'font-weight:800' }, 'Claims'), ...acc.map((a0) => h('div', { class: 'dw-muted' }, [a0.kind, ' · ', money(a0.amount), ' · ', a0.status, a0.broker_status ? ' · broker ' + a0.broker_status : '', (a0.evidence && a0.evidence.calc) ? ' — ' + a0.evidence.calc : '']))]) : null,
        exc.length ? h('div', { style: 'margin-top:8px' }, [h('div', { class: 'dw-muted', style: 'font-weight:800' }, 'Issues'), ...exc.map((x0) => h('div', { class: 'dw-muted' }, [x0.kind, ' · ', x0.status, x0.description ? ' — ' + x0.description : '', ' · ', when(x0.created_at)]))]) : null,
        e,
      ]);
    }
    paint();
    return box;
  }
  function openLogForm(truck) {
    const ts = trucksAll(); if (!ts.length) { alert('No truck on file yet.'); return; }
    const tsel = h('select', { class: 'dw-in' }, ts.map((t) => h('option', { value: t.id, selected: truck && truck.id === t.id }, (t._a.carrier && t._a.carrier.name) + ' · Unit ' + (t.unit_no || '?') + ' · ' + (t.equipment || ''))));
    const I = (ph, type, extra) => h('input', Object.assign({ class: 'dw-in', placeholder: ph || '', type: type || 'text' }, extra || {}));
    const broker = I('e.g. TQL'), bmc = I('MC #'), rep = I('rep name'), bphone = I('phone'), bemail = I('email');
    const org = I('City, ST'), dst = I('City, ST'), pu = I('', 'datetime-local'), dl = I('', 'datetime-local');
    const miles = I('loaded miles', 'number', { min: '0' }), dh = I('deadhead miles', 'number', { min: '0' }), gross = I('total $', 'number', { min: '0', step: '0.01' });
    const comm = I('commodity'), wt = I('lbs', 'number'), eq = I('equipment as booked (e.g. 26ft box, liftgate)'), rcno = I('RC / load #'), rcFile = h('input', { type: 'file', accept: '.pdf,image/*', class: 'dw-in' }), notes = h('textarea', { class: 'dw-in', rows: 2, placeholder: 'special instructions, appointment info, pallet count…' });
    const rpmBox = h('div', { class: 'dw-muted' }, 'Enter miles + gross to see $/mile.');
    const aiBox = h('div', { style: 'display:none;margin-top:8px' });
    rcFile.addEventListener('change', async () => {
      const f0 = rcFile.files && rcFile.files[0]; if (!f0) return;
      aiBox.style.display = 'block'; mount(aiBox, h('div', { class: 'dw-muted' }, [ic('search', 14), ' Reading the rate confirmation…']));
      const r = await readRateCon(f0);
      if (!r) { mount(aiBox, h('div', { class: 'dw-muted' }, 'Could not read this file automatically — fill in the fields by hand.')); return; }
      const F = r.fields || {}; const filled = [];
      const setIf = (inp, v, label) => { if (v != null && v !== '' && !inp.value) { inp.value = String(v); filled.push(label); } };
      setIf(broker, F.broker, 'broker'); setIf(bmc, F.broker_mc, 'MC'); setIf(rep, F.broker_rep, 'rep'); setIf(bphone, F.broker_phone, 'phone'); setIf(bemail, F.broker_email, 'email');
      setIf(org, F.origin, 'origin'); setIf(dst, F.destination, 'destination'); setIf(miles, F.miles, 'miles'); setIf(gross, F.gross, 'gross');
      setIf(comm, F.commodity, 'commodity'); setIf(wt, F.weight_lbs, 'weight'); setIf(eq, F.equipment, 'equipment'); setIf(rcno, F.rc_number, 'RC #');
      if (F.pickup_at && !pu.value) { const d0 = new Date(F.pickup_at); if (!isNaN(d0)) { pu.value = dtLocal(d0.toISOString()); filled.push('pickup'); } }
      if (F.delivery_at && !dl.value) { const d0 = new Date(F.delivery_at); if (!isNaN(d0)) { dl.value = dtLocal(d0.toISOString()); filled.push('delivery'); } }
      if (F.notes && !notes.value) { notes.value = F.notes; filled.push('notes'); }
      calc();
      const tone = r.confidence === 'high' ? 'dw-ok' : 'dw-warn';
      mount(aiBox, h('div', { class: tone }, [
        h('div', null, [ic('fileCheck', 14), ' Read from the RC (' + r.confidence + ' confidence): ' + (filled.length ? filled.join(', ') : 'nothing new') + '. Check every field against the document before saving.']),
        F.carrier_named ? h('div', { style: 'margin-top:4px' }, 'Carrier named on the RC: ' + F.carrier_named) : null,
        F.stops && F.stops > 2 ? h('div', { style: 'margin-top:4px' }, 'Multi-stop load: ' + F.stops + ' stops — add the extra stops in Notes.') : null,
        (r.warnings || []).length ? h('div', { style: 'margin-top:4px' }, 'Check: ' + r.warnings.join(' · ')) : null,
      ]));
    });
    const calc = () => { const m = Number(miles.value), g = Number(gross.value); const t = ts.find((x) => x.id === tsel.value); const min = t && (t.min_rpm != null ? Number(t.min_rpm) : (t._a.carrier && t._a.carrier.min_rpm != null ? Number(t._a.carrier.min_rpm) : null));
      if (m > 0 && g > 0) { const r = g / m; rpmBox.className = min != null && r < min ? 'dw-warn' : 'dw-ok'; rpmBox.textContent = '$' + r.toFixed(2) + ' per loaded mile' + (min != null ? (r < min ? ' — BELOW the carrier minimum of $' + min.toFixed(2) + '. You can log it; LoadBoot will decide.' : ' — above the $' + min.toFixed(2) + ' minimum') : '') + (Number(dh.value) > 0 ? ' · all-in $' + (g / (m + Number(dh.value))).toFixed(2) + '/mi' : ''); } else { rpmBox.className = 'dw-muted'; rpmBox.textContent = 'Enter miles + gross to see $/mile.'; } };
    [miles, gross, dh].forEach((x) => x.addEventListener('input', calc)); tsel.addEventListener('change', calc);
    const est = h('button', { class: 'dw-btn sm ghost', onClick: () => { const rm = roadMiles(org.value, dst.value); if (rm) { miles.value = rm; calc(); } else alert('Could not estimate — use "City, ST" for both.'); } }, 'Estimate miles');
    const e = h('div', { class: 'dw-err' });
    const m = modal('Log a booking', h('div', null, [
      h('div', { class: 'dw-muted', style: 'margin-bottom:10px' }, 'Log it the moment the broker confirms. Attach the RC first — the fields below fill themselves from it (verify every one). LoadBoot approves from the RC; the driver only moves after approval.'),
      h('div', { class: 'dw-form' }, [
        h('label', { class: 'wide' }, ['Truck', tsel]),
        h('label', { class: 'wide' }, ['Rate confirmation (PDF / photo) — attach first, the form fills itself', rcFile]),
        h('label', null, ['Broker *', broker]), h('label', null, ['Broker MC', bmc]), h('label', null, ['Rep', rep]), h('label', null, ['Rep phone', bphone]), h('label', null, ['Rep email', bemail]),
        h('label', null, ['Origin *', org]), h('label', null, ['Destination *', dst]), h('label', null, ['Pickup', pu]), h('label', null, ['Delivery', dl]),
        h('label', null, ['Loaded miles', h('div', { class: 'dw-row' }, [miles, est])]), h('label', null, ['Deadhead miles', dh]), h('label', null, ['Gross rate $ *', gross]),
        h('label', null, ['Commodity', comm]), h('label', null, ['Weight (lb)', wt]), h('label', null, ['Equipment as booked', eq]),
        h('label', null, ['RC number', rcno]),
        h('label', { class: 'wide' }, ['Notes', notes]),
      ]),
      aiBox,
      h('div', { style: 'margin-top:10px' }, rpmBox), e,
      h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: async (ev) => { ev.target.disabled = true; try {
        const t = ts.find((x) => x.id === tsel.value);
        let rc = null; const f0 = rcFile.files && rcFile.files[0]; if (f0) rc = await uploadDocument(f0, 'rate_confirmation');
        const r = await dispatcherLogBooking({ carrier_org_id: t._a.carrier_org_id, truck_id: t.id, broker: broker.value, broker_mc: bmc.value, broker_rep: rep.value, broker_phone: bphone.value, broker_email: bemail.value, origin: org.value, destination: dst.value, pickup_at: fromLocal(pu.value), delivery_at: fromLocal(dl.value), miles: miles.value || null, deadhead: dh.value || null, gross: gross.value, commodity: comm.value, weight_lbs: wt.value || null, equipment: eq.value || t.equipment, rc_number: rcno.value, rc_doc_path: rc && rc.path, rc_doc_name: rc && rc.fileName, notes: notes.value });
        if (r && r.error) throw new Error(r.error); m.remove(); await load(); tab = 'bookings'; render();
      } catch (x) { e.textContent = x.message; ev.target.disabled = false; } } }, 'Save booking'), h('button', { class: 'dw-btn ghost', onClick: () => m.remove() }, 'Cancel')]),
    ]));
  }

  // ---- BROKERS
  function vBrokers() {
    const rows = feed.brokers || [];
    const list = h('div', { class: 'dw-tablewrap' });
    const paintRows = () => mount(list, rows.length ? h('table', { class: 'dw-table' }, [h('thead', null, h('tr', null, ['Broker', 'MC', 'Rep', 'Contact', 'Lanes / equipment', 'New MC ok?', 'Last', ''].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, [h('td', null, [h('b', { style: 'color:#fff' }, r.broker), r.rating ? stars(r.rating) : null]), h('td', null, r.mc || '—'), h('td', null, r.rep || '—'), h('td', null, [r.phone ? h('div', null, r.phone) : null, r.email ? h('div', null, r.email) : null]), h('td', null, [r.lanes ? h('div', null, r.lanes) : null, r.equipment ? h('div', { class: 'dw-muted' }, r.equipment) : null]), h('td', null, yn(r.new_authority_ok)), h('td', null, [r.last_contact_at ? ago(r.last_contact_at) : '—', r.last_outcome ? h('div', { class: 'dw-muted' }, r.last_outcome) : null]),
        h('td', null, h('div', { class: 'dw-row' }, [h('button', { class: 'dw-btn sm ghost', onClick: () => brokerForm(r) }, 'Edit'), h('button', { class: 'dw-btn sm ghost', onClick: async () => { if (!confirm('Remove ' + r.broker + '?')) return; await dispatcherBrokerDelete(r.id); await load(); } }, ic('x', 14))]))])))]) : h('div', { class: 'dw-muted' }, 'No brokers yet. Every booking you log adds its broker here automatically — or add the ones you already know.'));
    paintRows();
    return h('div', { class: 'dw-card' }, [h('h3', null, ['Broker book (' + rows.length + ')', h('button', { class: 'dw-btn', onClick: () => brokerForm(null) }, [ic('plus', 16), 'Add broker'])]), h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Your relationships are the asset. Log every rep you speak to — especially the ones who work with new authorities.'), list]);
  }
  function brokerForm(r) {
    r = r || {};
    const I = (k, ph, type) => h('input', { class: 'dw-in', placeholder: ph || '', type: type || 'text', value: r[k] == null ? '' : String(r[k]) });
    const broker = I('broker', 'company *'), mc = I('mc', 'MC #'), rep = I('rep'), phone = I('phone'), email = I('email'), lanes = I('lanes', 'e.g. FL→GA, Southeast'), eq = I('equipment', 'e.g. box truck, hotshot'), rating = h('select', { class: 'dw-in' }, [['', '—'], ['1', '1 / 5'], ['2', '2 / 5'], ['3', '3 / 5'], ['4', '4 / 5'], ['5', '5 / 5']].map(([v, l]) => h('option', { value: v, selected: String(r.rating || '') === v }, l)));
    const na = h('select', { class: 'dw-in' }, [['', 'Unknown'], ['true', 'Yes — works with new MCs'], ['false', 'No — 90/180-day rule']].map(([v, l]) => h('option', { value: v, selected: (r.new_authority_ok == null ? '' : String(r.new_authority_ok)) === v }, l)));
    const out = I('last_outcome', 'last outcome (quoted / booked / no capacity…)'), note = h('textarea', { class: 'dw-in', rows: 2 }, r.note || '');
    const e = h('div', { class: 'dw-err' });
    const m = modal(r.id ? 'Edit broker' : 'Add broker', h('div', null, [h('div', { class: 'dw-form' }, [h('label', null, ['Broker *', broker]), h('label', null, ['MC', mc]), h('label', null, ['Rep', rep]), h('label', null, ['Phone', phone]), h('label', null, ['Email', email]), h('label', null, ['Lanes', lanes]), h('label', null, ['Equipment', eq]), h('label', null, ['Rating', rating]), h('label', null, ['New authority?', na]), h('label', null, ['Last outcome', out]), h('label', { class: 'wide' }, ['Notes', note])]), e,
      h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: async () => { try { const x = await dispatcherBrokerUpsert({ id: r.id, broker: broker.value, mc: mc.value, rep: rep.value, phone: phone.value, email: email.value, lanes: lanes.value, equipment: eq.value, rating: rating.value || null, new_authority_ok: na.value === '' ? null : na.value, last_outcome: out.value, note: note.value }); if (x && x.error) throw new Error(x.error); m.remove(); await load(); } catch (x) { e.textContent = x.message; } } }, 'Save'), h('button', { class: 'dw-btn ghost', onClick: () => m.remove() }, 'Cancel')])]));
  }

  // ---- MONEY
  function vMoney() {
    const c = feed.commission || {}; const p = feed.profile || {}; const rows = c.rows || [];
    return h('div', null, [
      h('div', { class: 'dw-kpis' }, [['Earned (all)', money(c.earned)], ['Approved · unpaid', money(c.approved)], ['Paid', money(c.paid)], ['Your rate', (p.commission_pct || 0) + '% of gross']].map(([l, v]) => h('div', { class: 'dw-kpi' }, [h('b', null, v), h('span', null, l)]))),
      h('div', { class: 'dw-card' }, [h('h3', null, 'How you get paid'), h('div', { class: 'dw-muted', style: 'line-height:1.8' }, [
        h('div', null, 'A commission line is created the moment you mark a load Delivered — ' + (p.commission_pct || 0) + '% of the gross line-haul on that load.'),
        h('div', null, 'LoadBoot approves it once the broker is invoiced, and marks it Paid with your payout' + (p.currency ? ' (' + p.currency + ')' : '') + '. Cancelled or rejected loads never earn.'),
        p.base_salary ? h('div', null, 'Base: ' + (p.currency || '') + ' ' + num(p.base_salary) + ' + ' + num(p.per_truck || 0) + ' per active truck (post-trial).') : null,
        p.trial_end ? h('div', null, 'Trial window: ' + (p.trial_start || '?') + ' → ' + p.trial_end) : null,
      ])]),
      h('div', { class: 'dw-card' }, [h('h3', null, 'Commission ledger'), h('div', { class: 'dw-tablewrap' }, rows.length ? h('table', { class: 'dw-table' }, [h('thead', null, h('tr', null, ['Load', 'Gross', '%', 'Commission', 'Status', 'When'].map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, [h('td', null, r.lane || r.booking_id), h('td', null, money(r.gross)), h('td', null, r.pct + '%'), h('td', null, h('b', { style: 'color:#fff' }, money(r.amount))), h('td', null, h('span', { class: 'dw-pill', style: 'color:' + ({ draft: '#fbbf24', approved: '#7cc0ff', paid: '#4ade80', void: '#94a3b8' })[r.status] + ';border-color:currentColor' }, r.status.toUpperCase())), h('td', null, r.paid_at ? 'paid ' + when(r.paid_at) : when(r.created_at))])))]) : h('div', { class: 'dw-muted' }, 'Nothing yet — your first delivered load appears here.'))]),
    ]);
  }

  // ---- MESSAGES
  function vMessages() {
    const as = A(); if (!as.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Messages'), h('div', { class: 'dw-muted' }, 'No carrier assigned yet.')]);
    const wrap = h('div'); let cur = as[0];
    const sel = h('select', { class: 'dw-in', style: 'width:auto', onChange: () => { cur = as.find((a) => a.id === sel.value); paintThread(); } }, as.map((a) => h('option', { value: a.id }, (a.carrier && a.carrier.name) || 'Carrier')));
    const thread = h('div', { style: 'max-height:52vh;overflow:auto;padding:6px 2px' });
    const inp = h('textarea', { class: 'dw-in', rows: 2, placeholder: 'Message the carrier + LoadBoot… (everyone in this thread sees it)' });
    const e = h('div', { class: 'dw-err' });
    async function paintThread() {
      mount(thread, h('div', { class: 'dw-muted' }, 'Loading…'));
      try { const r = await dispatcherThreadList(cur.id); if (r.error) throw new Error(r.error);
        const msgs = r.messages || [];
        mount(thread, msgs.length ? msgs.map((x) => h('div', { class: 'dw-msg ' + (x.mine ? 'mine' : x.role) }, [h('div', { class: 'who' }, (x.role === 'system' ? 'LoadBoot' : x.role) + (x.by && !x.mine ? ' · ' + x.by : '') + ' · ' + when(x.at)), h('div', { style: 'white-space:pre-wrap' }, x.body)])) : h('div', { class: 'dw-muted' }, 'No messages yet. Say hello — the carrier and LoadBoot both see this.'));
        thread.scrollTop = thread.scrollHeight;
      } catch (x) { mount(thread, err(x.message)); }
    }
    paintThread();
    mount(wrap, h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('chat'), ' Thread with ' + ((cur.carrier && cur.carrier.name) || 'carrier') + ' + LoadBoot']), as.length > 1 ? sel : null]),
      h('div', { class: 'dw-muted', style: 'margin-bottom:6px' }, 'One shared channel: you, the carrier and LoadBoot staff. Use it for pickup details, ETAs, problems. No side channels.'),
      thread, inp, e, h('div', { class: 'dw-row', style: 'margin-top:8px' }, [h('button', { class: 'dw-btn', onClick: async (ev) => { if (!inp.value.trim()) return; ev.target.disabled = true; try { const r = await dispatcherThreadSend(cur.id, inp.value); if (r.error) throw new Error(r.error); inp.value = ''; await paintThread(); } catch (x) { e.textContent = x.message; } ev.target.disabled = false; } }, 'Send'), h('button', { class: 'dw-btn ghost', onClick: paintThread }, ic('refresh', 14))])]));
    return wrap;
  }

  // ---- BOARD (internal LoadBoot board, acting for the assigned carrier — P1, bl_disp_0289)
  const boardCache = {};
  function vBoard() {
    const as = A(); if (!as.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Load board'), h('div', { class: 'dw-muted' }, 'No carrier assigned yet.')]);
    let cur = as[0];
    const sel = h('select', { class: 'dw-in', style: 'width:auto', onChange: () => { cur = as.find((a) => a.id === sel.value); paint(); } }, as.map((a) => h('option', { value: a.id }, (a.carrier && a.carrier.name) || 'Carrier')));
    const body = h('div', { class: 'dw-muted' }, 'Loading the board…');
    const wrap = h('div', null, [
      h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('search'), ' LoadBoot board — ' + ((cur.carrier && cur.carrier.name) || '')]), h('div', { class: 'dw-row' }, [as.length > 1 ? sel : null, h('button', { class: 'dw-btn sm ghost', onClick: () => paint(true) }, ic('refresh', 14)), h('button', { class: 'dw-btn sm', onClick: () => postForm(cur) }, [ic('plus', 16), 'Post the truck'])])]),
        h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Loads posted on LoadBoot by brokers and shippers, ranked for this carrier’s truck. Requesting a load sends the broker a 30-minute booking request under the carrier’s MC. Your own DAT/Truckstop finds still go through “Log a booking”.'),
        body]),
    ]);
    async function paint(force) {
      mount(body, h('div', { class: 'dw-muted' }, 'Loading the board…'));
      let d = boardCache[cur.id]; if (!d || force) { try { d = await dispatcherBoard(cur.carrier_org_id, 20); } catch (e) { d = { error: e.message }; } boardCache[cur.id] = d; }
      if (d.error) { mount(body, err(d.error)); return; }
      const best = (d.best && d.best.loads) || []; const avail = Array.isArray(d.available) ? d.available : []; const reqs = Array.isArray(d.requests) ? d.requests : []; const posts = Array.isArray(d.postings) ? d.postings : [];
      const bestIds = new Set(best.map((x) => x.load));
      const req = (loadId, lane) => async () => { const note = prompt('Note to the broker (optional) — ' + lane) ; if (note === null) return; const r = await dispatcherRequestBook(cur.carrier_org_id, loadId, note).catch((e) => ({ error: e.message })); if (r && r.error) { alert(r.error); return; } alert('Request sent — the broker has ' + (r.expires_in_minutes || 30) + ' minutes to respond. You’ll see it under Requests.'); paint(true); };
      const loadRow = (x, scored) => h('div', { class: 'dw-book', style: 'cursor:default' }, [
        h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, x.lane || (x.origin + ' → ' + x.destination)), scored ? h('span', { class: 'dw-pill', style: 'color:' + (x.score >= 70 ? '#4ade80' : x.score >= 45 ? '#fbbf24' : '#94a3b8') + ';border-color:currentColor' }, 'FIT ' + x.score + '/100') : (x.direct_to_you ? h('span', { class: 'dw-pill', style: 'color:#7cc0ff;border-color:currentColor' }, 'DIRECT OFFER') : null)]),
        h('div', { class: 'dw-muted', style: 'margin-top:4px' }, [x.equipment, x.rate != null ? money(x.rate) : 'rate on request', x.miles ? num(x.miles) + ' mi' : null, (x.loaded_rpm || x.rpm) ? '$' + Number(x.loaded_rpm || x.rpm).toFixed(2) + '/mi' : null, x.deadhead_miles != null ? 'DH ~' + x.deadhead_miles + ' mi' : null, x.all_in_rpm ? 'all-in $' + x.all_in_rpm : null, x.pickup_date ? 'PU ' + x.pickup_date : null, x.broker, x.commodity, x.weight].filter(Boolean).join(' · ')),
        scored && Array.isArray(x.factors) ? h('div', { style: 'margin-top:4px' }, x.factors.map((f0) => h('span', { class: 'dw-chip', title: f0.detail || '' }, f0.factor + ' ' + f0.points + '/' + f0.max))) : null,
        x.requirements ? h('div', { class: 'dw-muted' }, 'Req: ' + x.requirements) : null,
        h('div', { class: 'dw-row', style: 'margin-top:8px' }, [h('button', { class: 'dw-btn sm', onClick: req(x.load || x.id, x.lane || (x.origin + ' → ' + x.destination)) }, 'Request to book'), x.direct_offer_expired ? h('span', { class: 'dw-muted' }, 'direct offer expired') : null]),
      ]);
      mount(body, [
        d.best && d.best.assumptions ? h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Ranking assumes target $' + d.best.assumptions.target_rpm + '/mi, max deadhead ' + d.best.assumptions.max_deadhead + ' mi · location basis: ' + (d.best.last_location_basis || '—') + (d.best.skipped_ineligible ? ' · ' + d.best.skipped_ineligible + ' loads hidden (not eligible for this truck)' : '')) : null,
        h('h3', { style: 'font-size:.9rem;margin:8px 0 4px' }, 'Best fit for this truck (' + best.length + ')'),
        best.length ? best.map((x) => loadRow(x, true)) : h('div', { class: 'dw-muted' }, 'Nothing scores for this truck right now.'),
        h('h3', { style: 'font-size:.9rem;margin:14px 0 4px' }, 'All available (' + avail.length + ')'),
        avail.filter((x) => !bestIds.has(x.id)).length ? avail.filter((x) => !bestIds.has(x.id)).map((x) => loadRow(x, false)) : h('div', { class: 'dw-muted' }, 'No other loads on the board.'),
        h('h3', { style: 'font-size:.9rem;margin:14px 0 4px' }, 'Booking requests (' + reqs.length + ')'),
        reqs.length ? reqs.map((r) => h('div', { class: 'dw-book', style: 'cursor:default' }, [h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, r.origin + ' → ' + r.destination), h('span', { class: 'dw-pill', style: 'color:' + ({ pending: '#fbbf24', approved: '#4ade80', declined: '#f87171', expired: '#94a3b8', cancelled: '#94a3b8' })[r.status] + ';border-color:currentColor' }, String(r.status).toUpperCase())]), h('div', { class: 'dw-muted' }, [money(r.rate), ' · sent ', when(r.created_at), r.decided_at ? ' · decided ' + when(r.decided_at) : '', r.note ? ' · ' + r.note : ''])])) : h('div', { class: 'dw-muted' }, 'No requests yet.'),
        h('h3', { style: 'font-size:.9rem;margin:14px 0 4px' }, 'Truck postings (' + posts.length + ')'),
        posts.length ? posts.map((p0) => h('div', { class: 'dw-book', style: 'cursor:default' }, [h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, (p0.unit_no ? 'Unit ' + p0.unit_no + ' · ' : '') + p0.origin + (p0.dest_pref ? ' → ' + p0.dest_pref : ' → anywhere')), h('span', { class: 'dw-pill', style: 'color:' + (p0.status === 'active' ? '#4ade80' : '#fbbf24') + ';border-color:currentColor' }, String(p0.status).toUpperCase() + ' · ' + (p0.matches || 0) + ' matches')]),
          h('div', { class: 'dw-muted' }, [(p0.equipment || []).join('/'), ' · ', p0.from, ' → ', p0.to, ' · ', p0.radius, ' mi', p0.min_rpm ? ' · min $' + p0.min_rpm + '/mi' : '', p0.notes ? ' · ' + p0.notes : '']),
          h('div', { class: 'dw-row', style: 'margin-top:6px' }, [
            h('button', { class: 'dw-btn sm ghost', onClick: async () => { const m0 = await dispatcherPostingMatches(cur.carrier_org_id, p0.id).catch((e) => ({ error: e.message })); if (m0 && m0.error) { alert(m0.error); return; } const rows = Array.isArray(m0) ? m0 : []; modal('Matches — ' + p0.origin, h('div', null, rows.length ? rows.map((mm) => h('div', { class: 'dw-book', style: 'cursor:default' }, [h('div', { class: 'dw-lane' }, mm.origin + ' → ' + mm.destination), h('div', { class: 'dw-muted' }, [money(mm.rate), mm.miles ? ' · ' + mm.miles + ' mi' : '', ' · ', mm.equipment || '', mm.pickup_date ? ' · PU ' + mm.pickup_date : '', ' · ', mm.basis || '', mm.still_available ? '' : ' · GONE']), mm.still_available ? h('button', { class: 'dw-btn sm', style: 'margin-top:6px', onClick: req(mm.load_id, mm.origin + ' → ' + mm.destination) }, 'Request to book') : null])) : h('div', { class: 'dw-muted' }, 'No matches yet — the matcher runs as brokers post.'))); } }, 'Matches'),
            p0.status === 'active' ? h('button', { class: 'dw-btn sm ghost', onClick: async () => { await dispatcherUpdatePosting(cur.carrier_org_id, p0.id, 'pause'); paint(true); } }, 'Pause') : h('button', { class: 'dw-btn sm ghost', onClick: async () => { await dispatcherUpdatePosting(cur.carrier_org_id, p0.id, 'resume'); paint(true); } }, 'Resume'),
            h('button', { class: 'dw-btn sm ghost', onClick: async () => { if (!confirm('Delete this posting?')) return; await dispatcherUpdatePosting(cur.carrier_org_id, p0.id, 'delete'); paint(true); } }, ic('x', 14)),
          ])])) : h('div', { class: 'dw-muted' }, 'No active posting. Post the truck so brokers can find it and the matcher can alert you.'),
      ]);
    }
    function postForm(a) {
      const ts = (a.trucks || []); if (!ts.length) { alert('No truck on file for this carrier.'); return; }
      const t0 = ts[0]; const av = t0.availability || {};
      const tsel = h('select', { class: 'dw-in' }, ts.map((t) => h('option', { value: t.id }, 'Unit ' + (t.unit_no || '?') + ' · ' + (t.equipment || ''))));
      const origin = h('input', { class: 'dw-in', placeholder: 'City, ST', value: av.empty_location || [t0.domicile_city, t0.domicile_state].filter(Boolean).join(', ') });
      const dest = h('input', { class: 'dw-in', placeholder: 'e.g. GA / Southeast / anywhere' });
      const from = h('input', { class: 'dw-in', type: 'date', value: (av.empty_at ? new Date(av.empty_at) : new Date()).toISOString().slice(0, 10) });
      const to = h('input', { class: 'dw-in', type: 'date', value: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });
      const radius = h('input', { class: 'dw-in', type: 'number', value: t0.max_radius_miles || 300 });
      const minr = h('input', { class: 'dw-in', type: 'number', step: '0.05', value: t0.min_rpm != null ? t0.min_rpm : '' });
      const notes = h('textarea', { class: 'dw-in', rows: 2, placeholder: 'e.g. liftgate + dock-high, no residential, home by Thursday' });
      const e = h('div', { class: 'dw-err' });
      tsel.addEventListener('change', () => { const t = ts.find((x) => x.id === tsel.value) || t0; const av2 = t.availability || {}; origin.value = av2.empty_location || [t.domicile_city, t.domicile_state].filter(Boolean).join(', '); radius.value = t.max_radius_miles || 300; minr.value = t.min_rpm != null ? t.min_rpm : ''; });
      const m = modal('Post the truck on LoadBoot', h('div', null, [h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Brokers searching LoadBoot see this truck; the matcher alerts you when a fitting load is posted. Auto-request is always OFF for dispatcher postings — you confirm every load.'),
        h('div', { class: 'dw-form' }, [h('label', { class: 'wide' }, ['Truck', tsel]), h('label', null, ['Available at (City, ST) *', origin]), h('label', null, ['Destination preference', dest]), h('label', null, ['From *', from]), h('label', null, ['To *', to]), h('label', null, ['Radius (mi)', radius]), h('label', null, ['Min $/mile', minr]), h('label', { class: 'wide' }, ['Notes for brokers', notes])]), e,
        h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: async (ev) => { ev.target.disabled = true; try { const r = await dispatcherPostTruck(a.carrier_org_id, { truck_id: tsel.value, origin: origin.value, dest_pref: dest.value, available_from: from.value, available_to: to.value, radius_miles: radius.value || null, min_rpm: minr.value || null, notes: notes.value }); if (r && r.error) throw new Error(r.error); m.remove(); paint(true); } catch (x) { e.textContent = x.message; ev.target.disabled = false; } } }, 'Post truck'), h('button', { class: 'dw-btn ghost', onClick: () => m.remove() }, 'Cancel')])]));
    }
    paint();
    return wrap;
  }

  // ---- KPIS (computed server-side from bookings + events — nothing hand-typed)
  function vKpis() {
    const wrap = h('div'); let days = 30;
    const body = h('div', { class: 'dw-muted' }, 'Loading…');
    const sel = h('select', { class: 'dw-in', style: 'width:auto', onChange: () => { days = Number(sel.value); paint(); } }, [[7, 'Last 7 days'], [14, 'Trial (14 days)'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => h('option', { value: v, selected: v === 30 }, l)));
    async function paint() {
      let k; try { k = await dispatcherMyKpis(days); } catch (e) { mount(body, err(e.message)); return; }
      if (k.error) { mount(body, err(k.error)); return; }
      const tile = (l, v, hint) => h('div', { class: 'dw-kpi', title: hint || '' }, [h('b', null, v == null ? '—' : String(v)), h('span', null, l)]);
      mount(body, [h('div', { class: 'dw-kpis' }, [
        tile('Bookings', k.bookings), tile('Delivered', k.delivered), tile('Cancelled / rejected', k.cancelled), tile('Loads / week', k.loads_per_week),
        tile('Gross booked', money(k.gross)), tile('Avg $/mile', k.avg_rpm != null ? '$' + Number(k.avg_rpm).toFixed(2) : null),
        tile('On-time delivery', k.on_time_pct != null ? k.on_time_pct + '%' : null, 'delivered on or before the scheduled delivery time'),
        tile('Check calls / load', k.check_calls_per_load, 'logged check calls per dispatched load — target ≥ 2'),
        tile('RC attached', k.rc_attach_rate != null ? k.rc_attach_rate + '%' : null, 'bookings with a rate confirmation on file'),
        tile('Below-min bookings', k.below_min_share != null ? k.below_min_share + '%' : null, 'share of bookings under the carrier’s minimum rate'),
        tile('Brokers used', k.brokers_used),
      ]), h('div', { class: 'dw-muted', style: 'line-height:1.8' }, [
        h('div', null, 'These are the numbers LoadBoot looks at when the trial ends and when pay is reviewed. They are computed from what you log — so log everything.'),
        h('div', null, 'Good trial: ≥ 3 loads/week per truck, avg $/mile above the carrier minimum, 100% RC attached, ≥ 2 check calls per load, 0 cancellations caused by dispatch.'),
      ])]);
    }
    paint();
    mount(wrap, h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('chart'), ' My KPIs']), sel]), body]));
    return wrap;
  }

  // ---- PACKET
  function vPacket() {
    const as = A(); if (!as.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Carrier packet'), h('div', { class: 'dw-muted' }, 'No carrier assigned yet.')]);
    const LABEL = { w9: 'W-9', coi: 'Certificate of insurance', insurance: 'Certificate of insurance', authority: 'Operating authority (MC)', mc_authority: 'Operating authority (MC)', noa: 'Notice of assignment (factoring)', factoring_noa: 'Notice of assignment (factoring)', bank_letter: 'Bank letter / voided check', dispatch_agreement: 'Dispatch agreement', cdl: 'Driver license', mcs150: 'MCS-150' };
    return h('div', null, as.map((a) => { const c = a.carrier || {}; const docs = a.documents || [];
      const summary = [c.name, c.mc ? 'MC ' + c.mc : null, c.dot ? 'USDOT ' + c.dot : null, c.contact_name, c.phone, c.email, c.home_base, c.factoring_company ? 'Factoring: ' + c.factoring_company : null].filter(Boolean).join('\n');
      return h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('paperclip'), ' ' + (c.name || 'Carrier') + ' — broker setup packet']), h('button', { class: 'dw-btn sm ghost', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(summary); } }, 'Copy carrier details')]),
        h('pre', { class: 'dw-muted', style: 'white-space:pre-wrap;font-family:inherit;margin:0 0 10px' }, summary),
        h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Approved documents on file. Open → download → attach to the broker’s carrier-setup email. Never edit them.'),
        docs.length ? h('div', null, docs.map((d) => h('div', { class: 'dw-row', style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--dw-line)' }, [h('div', null, [h('b', { style: 'color:#fff' }, LABEL[d.type] || d.type), h('div', { class: 'dw-muted' }, (d.file_name || '') + ' · ' + when(d.created_at))]), h('button', { class: 'dw-btn sm', onClick: async (ev) => { try { const u = await signedDocumentUrl(d.file_path, 600); window.open(u, '_blank'); } catch (x) { ev.target.textContent = 'No access — ask LoadBoot'; } } }, 'Open')]))) : h('div', { class: 'dw-warn' }, 'No approved documents yet — ask LoadBoot to send you the packet.'),
      ]); }));
  }

  await load();
  return { reload: load, setTab: (t) => { tab = t; render(); } };
}

export default mountDispatcherWorkspace;
