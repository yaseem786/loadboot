// dispatcher-workspace.js — the hired dispatcher's working surface (bl_disp_0288 → 0300).
// Mounted by carrier/app.js → renderDispatcherHome() once the dispatcher is in trial/verified/active.
// Self-contained: own scoped styles (dark premium, brand palette), own data loop, no edits to the
// application form or referral code. Everything it shows comes from dispatcher_workspace_feed()
// and is assignment-scoped server-side — the module never decides what a dispatcher may see.
//
// Tabs: Today (work queue + KPIs) · Board · Trucks (specs + availability) · Bookings (log / RC /
// status / check calls / trip) · Brokers · Money · Messages · Packet · My KPIs.
//
// 2026-08-29 audit rework: every time is US Eastern (the dispatcher is in Pakistan, the trucks are in
// the US — brokers, RCs and appointments are all ET). No alert/confirm/prompt: modals only (mobile
// Safari swallows them). Queue rules use server timestamps (last_event_at). Availability sends only
// the keys the dispatcher changed. Money shows pending/approved/paid + the real payout. Messages poll
// and mark read. Packet is the four broker-setup documents only.
import {
  dispatcherWorkspaceFeed, dispatcherSetAvailability, dispatcherLogBooking, dispatcherBookingUpdate,
  dispatcherBookingEvent, dispatcherBookingTimeline, dispatcherBrokerUpsert, dispatcherBrokerDelete,
  dispatcherThreadList, dispatcherThreadSend, dispatcherThreadMarkRead,
  dispatcherBoard, dispatcherLoadDetail, dispatcherRequestBook, dispatcherPostTruck, dispatcherUpdatePosting, dispatcherPostingMatches, dispatcherMyKpis,
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
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
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
const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'));
const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : '—');
const inches = (v) => (v == null ? '—' : v + '"');
const ftin = (v) => { if (v == null) return '—'; const f = Math.floor(v / 12), i = v % 12; return f + '\'' + (i ? ' ' + i + '"' : ''); };

// ---------------------------------------------------------------- time: everything the dispatcher sees is US Eastern
const ET = 'America/New_York';
const PKT = 'Asia/Karachi';
function partsIn(d, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {}; for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  if (o.hour === 24) o.hour = 0;
  return o;
}
// ISO/Date → 'YYYY-MM-DDTHH:MM' in ET (for datetime-local inputs)
const dtET = (v) => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; const p = partsIn(d, ET); const z = (n) => String(n).padStart(2, '0'); return p.year + '-' + z(p.month) + '-' + z(p.day) + 'T' + z(p.hour) + ':' + z(p.minute); };
// 'YYYY-MM-DDTHH:MM' typed as ET → ISO (UTC). Two-pass offset resolution handles DST edges.
function fromET(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s); if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = want;
  for (let i = 0; i < 2; i++) { const p = partsIn(new Date(guess), ET); const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); guess += want - got; }
  return new Date(guess).toISOString();
}
const dateET = (d) => { const p = partsIn(d || new Date(), ET); const z = (n) => String(n).padStart(2, '0'); return p.year + '-' + z(p.month) + '-' + z(p.day); };
const when = (v, opts) => { if (!v) return '—'; const d = new Date(v); if (isNaN(d)) return String(v); return d.toLocaleString('en-US', Object.assign({ timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts || {})) + ' ET'; };
const whenDay = (v) => { if (!v) return '—'; const d = new Date(v); if (isNaN(d)) return String(v); return d.toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const clock = (tz) => new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const hh = Math.round(m / 60); if (hh < 48) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; };
// 06:00 ET today as epoch ms — the daily availability line is due before the US morning
function sixAmET() { const p = partsIn(new Date(), ET); const z = (n) => String(n).padStart(2, '0'); return new Date(fromET(p.year + '-' + z(p.month) + '-' + z(p.day) + 'T06:00')).getTime(); }

const STATUS = {
  pending_rc: ['Awaiting RC', '#fbbf24'], rc_received: ['RC in — awaiting LoadBoot approval', '#7cc0ff'],
  approved: ['Approved — dispatch the driver', '#4ade80'], dispatched: ['Dispatched', '#4ade80'], picked_up: ['Picked up · in transit', '#4ade80'],
  delivered: ['Delivered', '#a7f3d0'], invoiced: ['Invoiced', '#a7f3d0'], paid: ['Paid', '#a7f3d0'],
  cancelled: ['Cancelled', '#94a3b8'], rejected: ['Not approved', '#f87171'],
};
const OPEN = ['pending_rc', 'rc_received', 'approved', 'dispatched', 'picked_up'];
const MOVING = ['approved', 'dispatched', 'picked_up'];
const DONE = ['delivered', 'invoiced', 'paid', 'cancelled', 'rejected'];
const pill = (s) => { const m = STATUS[s] || [s, '#cbd5e1']; return h('span', { class: 'dw-pill', style: 'color:' + m[1] + ';border-color:' + m[1] + '55' }, m[0]); };

const CSS = `
.dw{--dw-line:rgba(255,255,255,.09);--dw-line2:rgba(255,255,255,.16);--dw-panel:rgba(255,255,255,.045);--dw-panel2:rgba(255,255,255,.07);--dw-ink:#eaf1fb;--dw-ink2:#c3d1e6;--dw-muted:#7f92b3;--dw-blue:#4EA6F9;--dw-orange:#FC5305;color:var(--dw-ink);font-family:Manrope,system-ui,sans-serif}
.dw *{box-sizing:border-box}
.dw-clock{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:.78rem;color:var(--dw-muted);font-weight:800;letter-spacing:.04em;margin:0 0 10px;padding:0 4px}
.dw-clock b{color:#fff}
.dw-clock .et{color:#7cc0ff}
.dw-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;padding:6px;border-radius:16px;background:var(--dw-panel);border:1px solid var(--dw-line)}
.dw-tab{border:0;background:transparent;color:var(--dw-ink2);font:inherit;font-weight:800;font-size:.86rem;padding:9px 13px;border-radius:11px;cursor:pointer;display:flex;gap:7px;align-items:center}
.dw-tab.on{background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;box-shadow:0 8px 18px -10px rgba(8,131,247,.6)}
.dw-tab:focus-visible,.dw-btn:focus-visible,.dw-book:focus-visible,.dw-q:focus-visible{outline:2px solid rgba(78,166,249,.9);outline-offset:2px}
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
.dw-msg.system{max-width:100%;text-align:center;background:transparent;border-style:dashed;color:var(--dw-ink2);font-size:.84rem}
.dw-tl{border-left:2px solid var(--dw-line2);margin-left:8px;padding-left:14px}
.dw-tl>div{position:relative;padding:4px 0 10px}
.dw-tl>div:before{content:'';position:absolute;left:-19px;top:9px;width:8px;height:8px;border-radius:50%;background:var(--dw-blue)}
.dw-warn{background:rgba(252,83,5,.12);border:1px solid rgba(252,83,5,.45);border-radius:12px;padding:10px 12px;color:#ffb38a;font-weight:700;font-size:.86rem}
.dw-ok{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.4);border-radius:12px;padding:10px 12px;color:#86efac;font-weight:700;font-size:.86rem}
.dw-info{background:rgba(8,131,247,.1);border:1px solid rgba(8,131,247,.35);border-radius:12px;padding:10px 12px;color:#bfdcff;font-weight:700;font-size:.86rem}
.dw-err{color:#f87171;font-weight:700;font-size:.86rem;margin-top:8px}
.dw-err:empty{display:none}
.dw-table{width:100%;border-collapse:collapse;font-size:.86rem}
.dw-table th{text-align:left;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dw-muted);padding:6px 8px;border-bottom:1px solid var(--dw-line2)}
.dw-table td{padding:8px;border-bottom:1px solid var(--dw-line);vertical-align:top}
.dw-tablewrap{overflow-x:auto}
.dw-modal{position:fixed;inset:0;background:rgba(3,8,18,.72);z-index:9000;display:flex;align-items:flex-end;justify-content:center;padding:0}
.dw-modal .box{background:#0b1220;border:1px solid var(--dw-line2);border-radius:22px 22px 0 0;width:min(820px,100%);max-height:92vh;overflow:auto;padding:18px 20px 28px;color:var(--dw-ink);font-family:Manrope,system-ui,sans-serif}
.dw-modal .box.narrow{width:min(480px,100%)}
@media(min-width:720px){.dw-modal{align-items:center;padding:20px}.dw-modal .box{border-radius:22px}}
.dw-modal h3{margin:0 0 12px;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px}
.dw-x{background:transparent;border:1px solid var(--dw-line2);color:#fff;border-radius:10px;padding:5px 10px;cursor:pointer;font-weight:800}
.dw-chip{display:inline-block;padding:3px 9px;border-radius:99px;background:var(--dw-panel2);border:1px solid var(--dw-line);font-size:.74rem;font-weight:700;color:var(--dw-ink2);margin:2px 3px 2px 0}
.dw-chip.no{opacity:.45;text-decoration:line-through}
.dw-avail{background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:14px;padding:12px 14px;margin-top:10px}
.dw-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0b1220;border:1px solid rgba(74,222,128,.5);color:#86efac;padding:10px 16px;border-radius:12px;font-weight:800;z-index:9500;box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:Manrope,system-ui,sans-serif;max-width:min(92vw,520px)}
.dw-toast.bad{border-color:rgba(248,113,113,.6);color:#fca5a5}
.dw-stop{display:grid;grid-template-columns:90px 1fr 150px 32px;gap:6px;align-items:center;margin:4px 0}
@media(max-width:640px){.dw-stop{grid-template-columns:1fr 1fr;grid-auto-rows:auto}}
`;

export async function mountDispatcherWorkspace(host, opts = {}) {
  const root = h('div', { class: 'dw' });
  if (!document.getElementById('dw-css')) { const s = document.createElement('style'); s.id = 'dw-css'; s.textContent = CSS; document.head.appendChild(s); }
  mount(host, root);
  let feed = null; let tab = (opts.tab) || (sessionStorage.getItem('dw_tab') || 'today');
  const clockEl = h('div', { class: 'dw-clock' });
  const body = h('div');
  const tabsEl = h('div', { class: 'dw-tabs', role: 'tablist' });
  root.append(clockEl, tabsEl, body);
  const paintClock = () => mount(clockEl, [h('span', { class: 'et' }, [ic('globe', 13), ' US Eastern ', h('b', null, clock(ET))]), h('span', null, ['Pakistan ', h('b', null, clock(PKT))]), h('span', { style: 'opacity:.75' }, 'All times in this workspace are ET — brokers, RCs and appointments use it.')]);
  paintClock(); const clockTimer = setInterval(paintClock, 30000);
  // stop timers when the host is unmounted (tab switch in the shell)
  const mo = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(clockTimer); stopThreadPoll(); mo.disconnect(); } });
  mo.observe(document.body, { childList: true, subtree: true });

  async function load() {
    try { feed = await dispatcherWorkspaceFeed(); } catch (e) { feed = { error: e.message || 'Could not load your workspace.' }; }
    render();
  }
  function err(msg) { return h('div', { class: 'dw-err' }, msg); }
  const A = () => (feed && feed.assignments) || [];
  const B = () => (feed && feed.bookings) || [];
  const trucksAll = () => A().flatMap((a) => (a.trucks || []).map((t) => ({ ...t, _a: a })));
  const activeFor = (truckId) => B().filter((b) => b.truck_id === truckId && OPEN.includes(b.status));
  const minFor = (t) => (t && t.effective_min_rpm != null ? Number(t.effective_min_rpm) : t && t.min_rpm != null ? Number(t.min_rpm) : t && t._a && t._a.carrier && t._a.carrier.min_rpm != null ? Number(t._a.carrier.min_rpm) : null);

  // ---------------------------------------------------------------- modals (no native dialogs — mobile Safari eats them)
  function modal(title, content, o = {}) {
    const box = h('div', { class: 'box' + (o.narrow ? ' narrow' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Dialog', tabindex: '-1' });
    const m = h('div', { class: 'dw-modal', onClick: (e) => { if (e.target === m && !o.sticky) close(); } }, box);
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    function close() { m.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) try { prev.focus(); } catch (_) {} if (o.onClose) o.onClose(); }
    mount(box, [h('h3', null, [typeof title === 'string' ? h('span', null, title) : title, h('button', { class: 'dw-x', 'aria-label': 'Close', onClick: close }, ic('x', 16))]), content]);
    document.addEventListener('keydown', onKey);
    root.appendChild(m); setTimeout(() => { const f0 = box.querySelector('input,textarea,select,button.dw-btn'); (f0 || box).focus(); }, 0);
    m.close = close; return m;
  }
  function toast(msg, bad) { const t = h('div', { class: 'dw-toast' + (bad ? ' bad' : ''), role: 'status' }, msg); document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 6000 : 3500); }
  // ask({title, text, fields:[{key,label,type,placeholder,required,value,options}], ok, danger}) → values | null
  function ask(o) {
    return new Promise((resolve) => {
      const inputs = {}; const e = h('div', { class: 'dw-err' });
      const fields = (o.fields || []).map((f0) => {
        let inp;
        if (f0.type === 'select') inp = h('select', { class: 'dw-in' }, f0.options.map(([v, l]) => h('option', { value: v, selected: v === f0.value }, l)));
        else if (f0.type === 'textarea') inp = h('textarea', { class: 'dw-in', rows: f0.rows || 3, placeholder: f0.placeholder || '' }, f0.value || '');
        else inp = h('input', { class: 'dw-in', type: f0.type || 'text', placeholder: f0.placeholder || '', value: f0.value == null ? '' : String(f0.value) });
        inputs[f0.key] = inp; return h('label', { class: 'wide' }, [f0.label + (f0.required ? ' *' : ''), inp]);
      });
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; resolve(v); m.close(); };
      const m = modal(o.title, h('div', null, [o.text ? h('div', { class: 'dw-muted', style: 'margin-bottom:10px;line-height:1.6' }, o.text) : null, fields.length ? h('div', { class: 'dw-form' }, fields) : null, e,
        h('div', { class: 'dw-row', style: 'margin-top:14px;justify-content:flex-end' }, [h('button', { class: 'dw-btn ghost', onClick: () => done(null) }, o.cancel || 'Cancel'), h('button', { class: 'dw-btn' + (o.danger ? ' warn' : ''), onClick: () => {
          const v = {}; for (const f0 of (o.fields || [])) { v[f0.key] = inputs[f0.key].value; if (f0.required && !String(v[f0.key] || '').trim()) { e.textContent = f0.label + ' is required.'; inputs[f0.key].focus(); return; } }
          done(v);
        } }, o.ok || 'OK')])]), { narrow: true, onClose: () => { if (!settled) { settled = true; resolve(null); } } });
    });
  }
  const confirmBox = (title, text, ok, danger) => ask({ title, text, ok, danger }).then((v) => v !== null);

  // ---------------------------------------------------------------- queue (client-side rules, all from feed + server timestamps)
  function queue() {
    const q = []; const now = feed.now ? new Date(feed.now).getTime() : Date.now(); const six = sixAmET();
    const p = feed.profile || {};
    if (p.trial_end) { const days = Math.ceil((new Date(p.trial_end + 'T23:59:59') - now) / 86400000); if (days >= 0) q.push({ ic: 'rocket', hot: days <= 2, t: 'Trial: ' + days + ' day' + (days === 1 ? '' : 's') + ' left (ends ' + p.trial_end + ')', s: 'Commission ' + (p.commission_pct || 0) + '% of gross on every load delivered during the trial. My KPIs shows what LoadBoot reviews.', go: 'kpis' }); }
    for (const a of A()) {
      if ((a.ack_state || (a.carrier_ack_at ? 'confirmed' : 'pending')) === 'pending') q.push({ ic: 'building', t: (a.carrier && a.carrier.name) + ' has not confirmed you yet', s: 'The owner got the intro e-mail and sees a card in their portal. Introduce yourself in Messages and in the WhatsApp group so they tap it today.', go: 'messages' });
      if (a.last_message && a.last_message.role !== 'dispatcher' && Number(a.unread || 0) > 0) q.push({ ic: 'chat', hot: true, t: a.unread + ' unread from ' + (a.last_message.role === 'carrier' ? (a.carrier && a.carrier.name) : 'LoadBoot'), s: a.last_message.body || '', go: 'messages' });
    }
    for (const t of trucksAll()) {
      const av = t.availability || {}; const act = activeFor(t.id).filter((b) => MOVING.includes(b.status));
      const label = (t._a.carrier && t._a.carrier.name) + ' · Unit ' + (t.unit_no || '?') + ' (' + (t.equipment || 'truck') + ')';
      if (!act.length && (av.status || 'empty') === 'empty') {
        q.push({ ic: 'search', hot: true, t: 'Find a load — ' + label, s: (av.empty_location ? 'Empty at ' + av.empty_location + (av.empty_at ? ' from ' + when(av.empty_at) : '') : 'Location not set — update availability') + (av.must_be_home_by ? ' · home by ' + whenDay(av.must_be_home_by) : ''), go: 'board' });
      }
      const upd = av.updated_at ? new Date(av.updated_at).getTime() : 0;
      if (!upd) q.push({ ic: 'pin', hot: true, t: 'Availability not set — ' + label, s: 'Brokers ask "where is the truck and when is it empty?" — set it before you call anyone.', go: 'trucks' });
      else if (upd < six && now > six + 2 * 3600000 && av.updated_by_role !== 'eld') q.push({ ic: 'pin', t: 'Daily availability line is due — ' + label, s: 'Last update ' + ago(av.updated_at) + ' by ' + (av.updated_by_role || '?') + '. Ask in the group ("Truck where? Empty since? Home by? Hours OK?") and put the answer in Trucks.', go: 'trucks' });
      if (av.must_be_home_by) { const hrs = (new Date(av.must_be_home_by) - now) / 3600000; if (hrs > 0 && hrs < 48) q.push({ ic: 'home', hot: hrs < 24, t: 'Home-time deadline in ' + Math.round(hrs) + ' h — ' + label, s: 'Every load from here must land the truck at ' + (av.home_location || 'home') + ' by ' + whenDay(av.must_be_home_by) + '.', go: 'trucks' }); }
      if (av.hos_drive_left_h != null && av.hos_drive_left_h < 3 && act.length) q.push({ ic: 'clock', hot: true, t: 'HOS: only ' + av.hos_drive_left_h + ' h drive left — ' + label, s: 'Plan the next stop around a reset.' + (av.hos_note ? ' (' + av.hos_note + ')' : ''), go: 'trucks' });
      if (av.status === 'maintenance' || av.status === 'off') q.push({ ic: 'alert', t: 'Truck is ' + av.status.toUpperCase() + ' — ' + label, s: 'Do not book it. Check with the owner when it is back.', go: 'trucks' });
    }
    for (const b of B()) {
      const lane = b.origin + ' → ' + b.destination;
      if (b.status === 'pending_rc') q.push({ ic: 'doc', hot: true, t: 'Attach the rate confirmation — ' + lane, s: 'LoadBoot cannot approve, and the driver cannot move, until the RC is on file.', go: 'bookings', id: b.id });
      if (b.status === 'rc_received') q.push({ ic: 'clock', t: 'Waiting for LoadBoot approval — ' + lane + (b.rc_received_at ? ' (' + ago(b.rc_received_at) + ')' : ''), s: b.below_min ? 'Below the carrier’s minimum rate — LoadBoot needs a reason to approve. Expect a question.' : 'Usually minutes. Message LoadBoot if pickup is close.', go: 'bookings', id: b.id });
      if (b.status === 'approved') q.push({ ic: 'truck', hot: true, t: 'Approved — dispatch the driver — ' + lane, s: (b.carrier_ack ? b.carrier_ack + '. ' : '') + 'Post pickup details in the group, then mark Dispatched.', go: 'bookings', id: b.id });
      if (MOVING.includes(b.status) && b.pickup_at && new Date(b.pickup_at) < now && b.status !== 'picked_up') q.push({ ic: 'alert', hot: true, t: 'Pickup time passed — ' + lane, s: 'Pickup was ' + when(b.pickup_at) + '. Mark Picked up, or log an exception and tell the broker.', go: 'bookings', id: b.id });
      if (['dispatched', 'picked_up'].includes(b.status)) {
        const last = b.last_event_at || b.updated_at; const hrs = (now - new Date(last).getTime()) / 3600000;
        if (hrs >= 4) q.push({ ic: 'phone', hot: hrs >= 8, t: 'Check call due (' + Math.round(hrs) + ' h since last update) — ' + lane, s: 'Log location + ETA. Brokers expect an update every 4 hours.', go: 'bookings', id: b.id });
        if (b.delivery_at && new Date(b.delivery_at) < now) q.push({ ic: 'alert', hot: true, t: 'Delivery time passed — ' + lane, s: 'Mark delivered with the POD, or log an exception.', go: 'bookings', id: b.id });
      }
      if (b.status === 'delivered' && b.trip_id && !Number(b.pod_count || 0)) q.push({ ic: 'doc', t: 'POD missing — ' + lane, s: 'Delivered but no POD photo on the trip. The carrier cannot invoice without it — ask the driver in the group.', go: 'bookings', id: b.id });
      if (b.carrier_ack && /PROBLEM/.test(b.carrier_ack) && MOVING.includes(b.status)) q.push({ ic: 'alert', hot: true, t: 'Carrier flagged a problem — ' + lane, s: b.carrier_ack, go: 'bookings', id: b.id });
    }
    return q.sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0));
  }

  // ---------------------------------------------------------------- render
  function render() {
    clear(tabsEl);
    if (!feed || feed.error) { mount(body, h('div', { class: 'dw-card' }, [h('h3', null, 'Dispatcher workspace'), h('div', { class: 'dw-muted' }, (feed && feed.error) || 'Loading…')])); return; }
    const k = feed.kpi || {}; const unread = A().reduce((s, a) => s + Number(a.unread || 0), 0);
    const TABS = [['today', 'Today', 'clipboard', queue().filter((x) => x.hot).length], ['board', 'Board', 'search', 0], ['trucks', 'Trucks', 'truck', 0], ['bookings', 'Bookings', 'package', Number(k.awaiting_rc || 0) + Number(k.approved || 0)], ['brokers', 'Brokers', 'phone', 0], ['money', 'Money', 'dollar', 0], ['messages', 'Messages', 'chat', unread], ['packet', 'Packet', 'paperclip', 0], ['kpis', 'My KPIs', 'chart', 0]];
    TABS.forEach(([id, label, icn, n]) => tabsEl.appendChild(h('button', { class: 'dw-tab' + (tab === id ? ' on' : ''), role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', onClick: () => { tab = id; try { sessionStorage.setItem('dw_tab', id); } catch (_) {} render(); } }, [ic(icn, 16), label, n ? h('span', { class: 'n', 'aria-label': n + ' items' }, String(n)) : null])));
    if (tab !== 'messages') stopThreadPoll();
    const view = { today: vToday, board: vBoard, trucks: vTrucks, bookings: vBookings, brokers: vBrokers, money: vMoney, messages: vMessages, packet: vPacket, kpis: vKpis }[tab] || vToday;
    mount(body, view());
  }

  function kpis() {
    const k = feed.kpi || {}; const c = feed.commission || {};
    return h('div', { class: 'dw-kpis' }, [
      ['Loads moving', k.active], ['Awaiting RC', k.awaiting_rc], ['Awaiting approval', k.awaiting_approval],
      ['Gross · 7 days', money(k.gross_7d)], ['Avg $/mile', k.avg_rpm != null ? '$' + Number(k.avg_rpm).toFixed(2) : '—'], ['Commission pending', money(Number(c.pending || 0) + Number(c.approved || 0))],
    ].map(([l, v]) => h('div', { class: 'dw-kpi' }, [h('b', null, v == null ? '—' : String(v)), h('span', null, l)])));
  }

  // ---- TODAY
  function vToday() {
    const q = queue(); const p = feed.profile || {};
    const hourET = partsIn(new Date(), ET).hour;
    return h('div', null, [
      h('div', { class: 'dw-card', style: 'background:linear-gradient(135deg,rgba(8,131,247,.16),rgba(252,83,5,.08))' }, [
        h('h3', null, ['Good ' + (hourET < 12 ? 'morning' : hourET < 18 ? 'afternoon' : 'evening') + ' (ET), ' + (p.full_name || 'dispatcher').split(' ')[0], h('span', { class: 'dw-pill', style: 'color:#4ade80;border-color:#4ade8055' }, (p.status || '').toUpperCase())]),
        h('div', { class: 'dw-muted' }, A().length + ' carrier' + (A().length === 1 ? '' : 's') + ' · ' + trucksAll().length + ' truck' + (trucksAll().length === 1 ? '' : 's') + ' · ' + B().filter((b) => MOVING.includes(b.status)).length + ' load' + (B().filter((b) => MOVING.includes(b.status)).length === 1 ? '' : 's') + ' moving'),
      ]),
      kpis(),
      h('div', { class: 'dw-card' }, [h('h3', null, ['Work queue', h('button', { class: 'dw-btn sm ghost', onClick: load }, [ic('refresh', 14), 'Refresh'])]),
        q.length ? q.map((x) => h('div', { class: 'dw-q' + (x.hot ? ' hot' : ''), style: x.go ? 'cursor:pointer' : '', tabindex: x.go ? '0' : null, role: x.go ? 'button' : null, onKeydown: (e) => { if (x.go && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(x); } }, onClick: () => go(x) }, [h('div', { class: 'ic' }, ic(x.ic, 20)), h('div', null, [h('b', null, x.t), h('div', { class: 'dw-muted' }, x.s)])]))
          : h('div', { class: 'dw-ok' }, 'Nothing urgent. Trucks are covered, RCs are in, check calls are current.')]),
      h('div', { class: 'dw-card' }, [h('h3', null, 'Rules of the road'), h('div', { class: 'dw-muted', style: 'line-height:1.9' }, [
        h('div', null, '1. Every rate confirmation goes to LoadBoot first (attach it here). The driver does not move until the booking shows Approved.'),
        h('div', null, '2. Below the carrier’s minimum rate? Log it anyway — it is flagged and LoadBoot decides. Never promise the broker before that.'),
        h('div', null, '3. Check call every 4 hours while loaded: location + ETA. Log it under the booking.'),
        h('div', null, '4. Book under the carrier’s MC only. Never touch freight money. Never re-broker. Never send bank details — the Packet has what brokers need.'),
        h('div', null, '5. All carrier and driver communication stays in the WhatsApp group and the Messages thread. Driver calls are for emergencies only — post a summary in the group after.'),
        h('div', null, '6. Something went wrong (detention, breakdown, refused freight)? Log an Exception — LoadBoot is alerted instantly.'),
      ])]),
    ]);
    function go(x) { if (!x.go) return; tab = x.go; if (x.id) openBooking(x.id); render(); }
  }

  // ---- TRUCKS
  function vTrucks() {
    const ts = trucksAll();
    if (!ts.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Trucks'), h('div', { class: 'dw-muted' }, A().length ? 'Your carrier has no active truck on file yet — ask LoadBoot to add it.' : 'No carrier assigned yet.')]);
    return h('div', null, [
      ...A().map((a) => carrierCard(a)),
      ...ts.map((t) => truckCard(t)),
    ]);
  }
  function carrierCard(a) {
    const c = a.carrier || {}; const s = a.sop || {};
    return h('div', { class: 'dw-card' }, [
      h('h3', null, [h('span', null, [ic('building'), ' ' + (c.name || 'Carrier')]), h('div', { class: 'dw-row', style: 'gap:6px' }, [
        h('span', { class: 'dw-pill', style: 'color:' + (a.carrier_ack_at ? '#4ade80' : a.ack_state === 'notified' ? '#94a3b8' : '#fbbf24') + ';border-color:currentColor' }, a.carrier_ack_at ? 'CONFIRMED YOU' : a.ack_state === 'notified' ? 'INTRO SENT' : 'NOT CONFIRMED YET'),
        h('span', { class: 'dw-pill', style: 'color:' + (c.broker_visible ? '#4ade80' : '#fbbf24') + ';border-color:currentColor' }, c.broker_visible ? 'LIVE TO BROKERS' : 'NOT YET VISIBLE')])]),
      h('div', { class: 'dw-grid' }, [
        f('MC', c.mc), f('USDOT', c.dot), f('Contact', c.contact_name), f('Phone', c.phone), f('WhatsApp', c.whatsapp), f('Email', c.email),
        f('Home base', c.home_base), f('Carrier min $/mi', c.min_rpm != null ? '$' + Number(c.min_rpm).toFixed(2) : null), f('Max deadhead', c.max_deadhead != null ? c.max_deadhead + ' mi' : null),
        f('Avoid states', c.avoid_states), f('Weekends', yn(c.weekend_ok)), f('Factoring', c.factoring_company ? c.factoring_company + (c.factoring_status ? ' · ' + c.factoring_status : '') : null),
      ]),
      (s.scope_value || s.lanes || s.rules || s.min_rate || s.min_rate_note) ? h('div', { class: 'dw-avail' }, [h('b', { style: 'color:#7cc0ff' }, [ic('scale', 16), ' Your SOP for this carrier (set by LoadBoot)']), h('div', { class: 'dw-muted', style: 'line-height:1.8;margin-top:4px' }, [
        s.scope_value ? h('div', null, 'Scope: ' + s.scope_value + ' — only source loads inside this scope.') : null,
        s.lanes ? h('div', null, 'Lanes: ' + s.lanes) : null,
        s.min_rate ? h('div', null, ['Min rate/mile: ', h('b', { style: 'color:#fff' }, '$' + Number(s.min_rate).toFixed(2)), s.min_rate_note ? ' — ' + s.min_rate_note : '']) : null,
        s.equipment ? h('div', null, 'Equipment: ' + s.equipment) : null, s.home_time ? h('div', null, 'Home time: ' + s.home_time) : null, s.rules ? h('div', null, 'Rules: ' + s.rules) : null,
      ])]) : null,
      (a.drivers || []).length ? h('div', { style: 'margin-top:10px' }, [h('div', { class: 'dw-f' }, [h('div', { class: 'k' }, 'Drivers on file'), h('div', { class: 'v' }, a.drivers.map((d) => (d.name || '?') + (d.phone ? ' · ' + d.phone : '')).join('  |  '))])]) : null,
    ]);
  }
  function f(k, v) { return h('div', { class: 'dw-f' }, [h('div', { class: 'k' }, k), h('div', { class: 'v' }, v == null || v === '' ? '—' : (typeof v === 'string' || typeof v === 'number') ? String(v) : v)]); }
  function truckCard(t) {
    const av = t.availability || {}; const act = activeFor(t.id).filter((b) => MOVING.includes(b.status)); const pend = activeFor(t.id).length - act.length;
    const chips = [['Dock-high', t.dock_high], ['Liftgate' + (t.liftgate && t.liftgate_cap_lbs ? ' ' + num(t.liftgate_cap_lbs) + ' lb' : ''), t.liftgate], ['Pallet jack', t.has_pallet_jack], ['Ramp', t.has_ramp], ['Straps', t.has_straps], ['Chains', t.has_chains], ['Tarps', t.has_tarps], ['E-track', t.has_etrack], ['Load bars', t.has_load_bars], ['Blankets', t.has_blankets], ['Team', t.team_driven], ['Hazmat', t.hazmat_placarded]].filter(([, v]) => v != null);
    const card = h('div', { class: 'dw-card' });
    const availBox = h('div');
    const gps = t.last_gps && t.last_gps.lat != null ? t.last_gps : null;
    const renderAvail = (editing) => {
      if (!editing) {
        mount(availBox, h('div', { class: 'dw-avail' }, [
          h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('b', { style: 'color:#7cc0ff' }, [ic('pin', 16), ' Availability' + (av.updated_at ? ' · updated ' + ago(av.updated_at) + (av.updated_by_role ? ' by ' + (av.updated_by_role === 'eld' ? 'ELD' : av.updated_by_role) : '') : ' · NOT SET')]), h('button', { class: 'dw-btn sm', onClick: () => renderAvail(true) }, av.updated_at ? 'Update' : 'Set availability')]),
          h('div', { class: 'dw-grid', style: 'margin-top:6px' }, [
            f('Status', (av.status || 'empty').toUpperCase()), f('Empty at', av.empty_location ? av.empty_location + (av.empty_zip ? ' ' + av.empty_zip : '') : null), f('Empty from', av.empty_at ? when(av.empty_at) : null),
            f('Must be home by', av.must_be_home_by ? whenDay(av.must_be_home_by) + (av.home_location ? ' · ' + av.home_location : '') : null),
            f('Overnight weekdays', yn(av.overnight_weekdays)), f('Overnight weekends', yn(av.overnight_weekends)),
            f('HOS drive left', av.hos_drive_left_h != null ? av.hos_drive_left_h + ' h' + (av.hos_note ? ' · ' + av.hos_note : '') : (av.hos_note || null)), f('Driver', av.driver_name ? av.driver_name + (av.driver_phone ? ' · ' + av.driver_phone : '') : null),
            gps ? f('Last GPS', h('a', { href: 'https://www.google.com/maps?q=' + gps.lat + ',' + gps.lng, target: '_blank', rel: 'noopener', style: 'color:#7cc0ff' }, Number(gps.lat).toFixed(3) + ', ' + Number(gps.lng).toFixed(3) + ' · ' + ago(gps.at))) : null,
          ]),
          av.note ? h('div', { class: 'dw-muted', style: 'margin-top:6px' }, av.note) : null,
          av.updated_by_role === 'carrier' && av.driver_name ? h('div', { class: 'dw-muted', style: 'margin-top:4px;font-size:.78rem' }, 'The carrier set the driver — ask in the thread before changing it.') : null,
        ]));
        return;
      }
      const I = (k, type, extra) => h('input', Object.assign({ class: 'dw-in', type: type || 'text', value: av[k] == null ? '' : (type === 'datetime-local' ? dtET(av[k]) : String(av[k])) }, extra || {}));
      const st = h('select', { class: 'dw-in' }, ['empty', 'loaded', 'off', 'maintenance'].map((v) => h('option', { value: v, selected: (av.status || 'empty') === v }, v.toUpperCase())));
      const eloc = I('empty_location'), ezip = I('empty_zip'), eat = I('empty_at', 'datetime-local'), home = I('must_be_home_by', 'datetime-local'), hloc = I('home_location');
      const owd = h('input', { type: 'checkbox', checked: av.overnight_weekdays !== false }), owe = h('input', { type: 'checkbox', checked: av.overnight_weekends === true });
      const hos = I('hos_drive_left_h', 'number', { step: '0.5', min: '0', max: '14' }), dn = I('driver_name'), dp = I('driver_phone'), note = h('textarea', { class: 'dw-in', rows: 2 }, av.note || '');
      const e = h('div', { class: 'dw-err' });
      mount(availBox, h('div', { class: 'dw-avail' }, [h('b', { style: 'color:#7cc0ff' }, [ic('pin', 16), ' Update availability']), h('div', { class: 'dw-form', style: 'margin-top:8px' }, [
        h('label', null, ['Status', st]), h('label', null, ['Empty at (City, ST)', eloc]), h('label', null, ['ZIP', ezip]), h('label', null, ['Empty from (ET)', eat]),
        h('label', null, ['Must be home by (ET)', home]), h('label', null, ['Home location', hloc]),
        h('label', null, ['HOS drive hours left (0–14)', hos]), h('label', null, ['Driver name', dn]), h('label', null, ['Driver phone', dp]),
        h('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, [owd, 'Overnight OK on weekdays']), h('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, [owe, 'Overnight OK on weekends']),
        h('label', { class: 'wide' }, ['Note for LoadBoot / carrier', note]),
      ]), e, h('div', { class: 'dw-row', style: 'margin-top:10px' }, [
        h('button', { class: 'dw-btn', onClick: async (ev) => { ev.target.disabled = true; try {
          // send only what changed — the server keeps the rest (and refuses driver overwrites the carrier set)
          const next = { status: st.value, empty_location: eloc.value, empty_zip: ezip.value, empty_at: fromET(eat.value), must_be_home_by: fromET(home.value), home_location: hloc.value, overnight_weekdays: owd.checked, overnight_weekends: owe.checked, hos_drive_left_h: hos.value === '' ? null : Number(hos.value), driver_name: dn.value, driver_phone: dp.value, note: note.value };
          const norm = (k, v) => { if (v == null || v === '') return k === 'overnight_weekdays' ? 'true' : k === 'overnight_weekends' ? 'false' : ''; if (['empty_at', 'must_be_home_by'].includes(k)) { const d0 = new Date(v); return isNaN(d0) ? '' : d0.toISOString().slice(0, 16); } return String(v); };
          const p = {}; for (const k of Object.keys(next)) if (norm(k, av[k]) !== norm(k, next[k])) p[k] = next[k];
          if (!Object.keys(p).length) p.status = st.value; // nothing changed → just re-confirm today's line (bumps updated_at)
          const r = await dispatcherSetAvailability(t.id, p);
          if (r && r.error) throw new Error(r.error); toast('Availability saved'); await load();
        } catch (x) { e.textContent = x.message; ev.target.disabled = false; } } }, 'Save'),
        h('button', { class: 'dw-btn ghost', onClick: () => renderAvail(false) }, 'Cancel'),
      ])]));
    };
    renderAvail(false);
    const min = minFor(t);
    mount(card, [
      h('h3', null, [h('span', null, [ic('truck'), ' Unit ' + (t.unit_no || '?') + ' — ' + [t.year, t.make, t.model].filter(Boolean).join(' ') + (t.equipment ? ' · ' + t.equipment : '')]), h('span', { class: 'dw-pill', style: 'color:' + (act.length ? '#4ade80' : '#fbbf24') + ';border-color:currentColor' }, act.length ? act.length + ' LOAD' + (act.length > 1 ? 'S' : '') + ' MOVING' : pend ? pend + ' BOOKING' + (pend > 1 ? 'S' : '') + ' PENDING' : (av.status || 'EMPTY').toUpperCase())]),
      h('div', { class: 'dw-muted' }, (t._a.carrier && t._a.carrier.name) || ''),
      h('div', { class: 'dw-grid', style: 'margin-top:8px' }, [
        f('Payload', t.payload_lbs != null ? num(t.payload_lbs) + ' lb' : null), f('Interior L × W × H', (t.cargo_len_in || t.cargo_width_in || t.cargo_height_in) ? ftin(t.cargo_len_in) + ' × ' + inches(t.cargo_width_in) + ' × ' + inches(t.cargo_height_in) : null),
        f('Deck height', t.deck_height_in != null ? t.deck_height_in + '"' : null), f('GVWR', t.gvwr), f('Pallet positions', t.pallet_positions),
        t.trailer_type ? f('Trailer', t.trailer_type + (t.trailer_len_ft ? ' · ' + t.trailer_len_ft + ' ft' : '')) : null,
        f('Domicile', [t.domicile_city, t.domicile_state, t.domicile_zip].filter(Boolean).join(', ')), f('Floor $/mile', min != null ? '$' + min.toFixed(2) + (t.effective_min_rpm != null && t.min_rpm != null && Number(t.effective_min_rpm) !== Number(t.min_rpm) ? ' (SOP)' : '') : null),
        f('Max radius', t.max_radius_miles != null ? t.max_radius_miles + ' mi' : null), f('Home time', t.home_time), f('Temp control', t.temp_control), f('Inspection exp', t.inspection_exp),
      ]),
      chips.length ? h('div', { style: 'margin-top:10px' }, chips.map(([l, v]) => h('span', { class: 'dw-chip' + (v ? '' : ' no') }, [ic(v ? 'check' : 'x', 12), ' ' + l]))) : null,
      t.spec_note ? h('div', { class: 'dw-warn', style: 'margin-top:10px' }, [ic('alert', 16), ' ' + t.spec_note]) : null,
      t.capacity_note ? h('div', { class: 'dw-muted', style: 'margin-top:8px;line-height:1.7' }, t.capacity_note) : null,
      availBox,
      h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: () => { tab = 'bookings'; render(); openLogForm(t); } }, [ic('plus', 16), 'Log a booking for this truck']), h('button', { class: 'dw-btn ghost', onClick: () => { tab = 'board'; render(); } }, [ic('search', 16), 'Find a load'])]),
    ]);
    return card;
  }

  // ---- BOOKINGS
  let openId = null;
  function openBooking(id) { openId = id; }
  function vBookings() {
    const bs = B();
    const wrap = h('div');
    const filt = h('select', { class: 'dw-in', style: 'width:auto', 'aria-label': 'Filter bookings', onChange: () => paint() }, [['open', 'Open'], ['', 'All'], ['pending_rc', 'Awaiting RC'], ['rc_received', 'Awaiting approval'], ['approved', 'Approved'], ['dispatched', 'Dispatched'], ['picked_up', 'In transit'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled / rejected']].map(([v, l]) => h('option', { value: v }, l)));
    const list = h('div');
    const paint = () => {
      const v = filt.value; const rows = bs.filter((b) => !v || (v === 'open' ? !DONE.includes(b.status) : v === 'cancelled' ? ['cancelled', 'rejected'].includes(b.status) : b.status === v));
      mount(list, rows.length ? rows.map((b) => bookingRow(b)) : h('div', { class: 'dw-muted', style: 'padding:10px 0' }, v === 'open' ? 'No open bookings. Log one the moment a broker confirms.' : 'No bookings here yet.'));
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
    const t = trucksAll().find((x) => x.id === b.truck_id);
    return h('div', { class: 'dw-book', tabindex: '0', role: 'button', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBooking(b); } }, onClick: () => showBooking(b) }, [
      h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, b.origin + ' → ' + b.destination), pill(b.status)]),
      h('div', { class: 'dw-muted', style: 'margin-top:4px' }, [b.broker, ' · ', money(b.gross), rpm ? ' · $' + rpm.toFixed(2) + '/mi' : '', b.miles ? ' · ' + num(b.miles) + ' mi' : '', b.pickup_at ? ' · PU ' + when(b.pickup_at) : '', t ? ' · Unit ' + (t.unit_no || '?') : '', b.source === 'loadboot' ? ' · LoadBoot board' : '', b.below_min ? h('span', { style: 'color:#ffb38a;font-weight:800' }, ' · below floor') : '', Array.isArray(b.stops) && b.stops.length > 2 ? ' · ' + b.stops.length + ' stops' : '']),
    ]);
  }
  function dispatchMessage(b, t) {
    const stops = Array.isArray(b.stops) && b.stops.length ? b.stops : [{ kind: 'pickup', location: b.origin, at: b.pickup_at }, { kind: 'delivery', location: b.destination, at: b.delivery_at }];
    const L = ['LOAD — ' + b.origin + ' → ' + b.destination + (t ? ' · Unit ' + (t.unit_no || '?') : ''), 'Broker: ' + b.broker + (b.broker_mc ? ' (MC ' + b.broker_mc + ')' : '') + (b.broker_phone ? ' · ' + b.broker_phone : ''), 'Rate: ' + money(b.gross) + (b.miles ? ' · ' + num(b.miles) + ' mi' : '') + (b.rc_number ? ' · RC # ' + b.rc_number : '')];
    stops.forEach((s, i) => L.push((i + 1) + '. ' + String(s.kind || (i === 0 ? 'pickup' : 'delivery')).toUpperCase() + ': ' + (s.location || '') + (s.at ? ' · ' + whenDay(s.at) : '') + (s.note ? ' · ' + s.note : '')));
    if (b.commodity || b.weight_lbs) L.push('Freight: ' + [b.commodity, b.weight_lbs ? num(b.weight_lbs) + ' lb' : null].filter(Boolean).join(' · '));
    if (b.notes) L.push('Notes: ' + b.notes);
    L.push('Check calls: at pickup (BOL photo), in transit every 4 h, at delivery (POD photo) — in the group.');
    return L.join('\n');
  }
  async function showBooking(b) {
    const body = h('div');
    const m = modal(b.origin + ' → ' + b.destination, body);
    const rpm = b.miles > 0 ? Number(b.gross) / Number(b.miles) : null;
    const t = trucksAll().find((x) => x.id === b.truck_id);
    const tl = h('div', { class: 'dw-muted' }, 'Loading timeline…');
    const e = h('div', { class: 'dw-err' });
    const act = async (fn, msg) => { try { const r = await fn(); if (r && r.error) throw new Error(r.error); m.close(); if (msg) toast(msg); await load(); } catch (x) { e.textContent = x.message; } };
    const noteIn = h('input', { class: 'dw-in', placeholder: 'note (optional)' }), locIn = h('input', { class: 'dw-in', placeholder: 'location (City, ST)' }), etaIn = h('input', { class: 'dw-in', type: 'datetime-local' });
    const rcFile = h('input', { type: 'file', accept: '.pdf,image/*', class: 'dw-in' }), rcNo = h('input', { class: 'dw-in', placeholder: 'RC / load number', value: b.rc_number || '' });
    const actions = [];
    if (['pending_rc', 'rc_received'].includes(b.status)) actions.push(h('div', { class: 'dw-avail', style: 'width:100%' }, [h('b', { style: 'color:#7cc0ff' }, [ic('doc', 16), b.rc_doc_path ? ' Replace rate confirmation' : ' Attach the rate confirmation']), h('div', { class: 'dw-form', style: 'margin-top:8px' }, [h('label', null, ['File (PDF / photo)', rcFile]), h('label', null, ['RC number', rcNo])]),
      h('div', { class: 'dw-row', style: 'margin-top:8px' }, [h('button', { class: 'dw-btn', onClick: (ev) => act(async () => { const f0 = rcFile.files && rcFile.files[0]; if (!f0) throw new Error('Choose the RC file first.'); ev.target.disabled = true; const up = await uploadDocument(f0, 'rate_confirmation'); return dispatcherBookingUpdate(b.id, { rc_doc_path: up.path, rc_doc_name: up.fileName, rc_number: rcNo.value || null }); }, 'RC sent to LoadBoot for approval') }, 'Upload RC'),
        h('button', { class: 'dw-btn ghost', onClick: () => { m.close(); editBooking(b); } }, [ic('edit', 16), 'Edit booking'])])]));
    if (b.status === 'approved') actions.push(h('button', { class: 'dw-btn', onClick: () => act(() => dispatcherBookingUpdate(b.id, { status: 'dispatched', note: noteIn.value }), 'Marked dispatched — truck shows LOADED') }, [ic('truck', 16), 'Driver dispatched']));
    if (b.status === 'dispatched') actions.push(h('button', { class: 'dw-btn', onClick: () => act(() => dispatcherBookingUpdate(b.id, { status: 'picked_up', note: noteIn.value, location: locIn.value }), 'Picked up') }, [ic('package', 16), 'Picked up / loaded']));
    if (b.status === 'picked_up') actions.push(h('button', { class: 'dw-btn', onClick: () => act(() => dispatcherBookingUpdate(b.id, { status: 'delivered', note: noteIn.value, location: locIn.value }), 'Delivered — truck is EMPTY at ' + b.destination) }, [ic('fileCheck', 16), 'Delivered']));
    if (MOVING.includes(b.status)) {
      actions.push(h('button', { class: 'dw-btn ghost', onClick: () => act(() => dispatcherBookingEvent(b.id, 'check_call', noteIn.value || 'Check call', locIn.value || null, fromET(etaIn.value)), 'Check call logged') }, [ic('phone', 16), 'Log check call']));
      actions.push(h('button', { class: 'dw-btn warn', onClick: () => act(() => { if (!noteIn.value) throw new Error('Describe the exception in the note.'); return dispatcherBookingEvent(b.id, 'exception', noteIn.value, locIn.value || null, null); }, 'Exception logged — LoadBoot alerted') }, [ic('alert', 16), 'Exception']));
      actions.push(h('button', { class: 'dw-btn ghost', onClick: async () => { try { await navigator.clipboard.writeText(dispatchMessage(b, t)); toast('Dispatch message copied — paste it in the WhatsApp group'); } catch (_) { modal('Dispatch message', h('pre', { style: 'white-space:pre-wrap;font-family:inherit' }, dispatchMessage(b, t)), { narrow: true }); } } }, [ic('copy', 16), 'Copy dispatch message']));
    }
    if (!DONE.includes(b.status)) actions.push(h('button', { class: 'dw-btn ghost', style: 'color:#f87171', onClick: async () => {
      if (b.status === 'picked_up') { e.textContent = 'The freight is on the truck — only LoadBoot can cancel now. Log an Exception and message LoadBoot.'; return; }
      const v = await ask({ title: 'Cancel this booking?', text: 'The broker, the carrier and LoadBoot are told. Cancelling an approved load counts against you in KPIs.', danger: true, ok: 'Cancel the booking', cancel: 'Keep it', fields: [{ key: 'reason', label: 'Reason', type: 'textarea', required: true, placeholder: 'e.g. broker cancelled — no freight ready; truck broke down; rate cut after booking' }] });
      if (!v) return; act(() => dispatcherBookingUpdate(b.id, { status: 'cancelled', note: v.reason }), 'Booking cancelled');
    } }, 'Cancel booking'));
    actions.push(h('button', { class: 'dw-btn ghost', onClick: () => act(() => { if (!noteIn.value.trim()) throw new Error('Write the note first.'); return dispatcherBookingEvent(b.id, 'note', noteIn.value, locIn.value || null, null); }, 'Note added') }, [ic('edit', 16), 'Add note']));
    const stops = Array.isArray(b.stops) ? b.stops : [];
    mount(body, [
      h('div', { class: 'dw-row', style: 'justify-content:space-between;margin-bottom:8px' }, [pill(b.status), b.below_min ? h('span', { class: 'dw-warn', style: 'padding:4px 10px' }, 'Below the carrier’s floor rate') : null, b.source === 'loadboot' ? h('span', { class: 'dw-chip' }, 'LoadBoot board') : null]),
      b.decision_note ? h('div', { class: b.status === 'rejected' ? 'dw-warn' : 'dw-info', style: 'margin-bottom:8px' }, 'LoadBoot: ' + b.decision_note) : null,
      b.carrier_ack ? h('div', { class: /PROBLEM/.test(b.carrier_ack) ? 'dw-warn' : 'dw-ok', style: 'margin-bottom:8px' }, b.carrier_ack) : null,
      h('div', { class: 'dw-grid' }, [f('Truck', t ? 'Unit ' + (t.unit_no || '?') + ' · ' + (t.equipment || '') : null), f('Broker', b.broker + (b.broker_mc ? ' · MC ' + b.broker_mc : '')), f('Rep', [b.broker_rep, b.broker_phone, b.broker_email].filter(Boolean).join(' · ')), f('Gross', money(b.gross)), f('$/mile', rpm ? '$' + rpm.toFixed(2) : null), f('Miles', b.miles), f('Deadhead', b.deadhead), f('Pickup', whenDay(b.pickup_at)), f('Delivery', whenDay(b.delivery_at)), f('Commodity', b.commodity), f('Weight', b.weight_lbs ? num(b.weight_lbs) + ' lb' : null), f('Equipment', b.equipment), f('RC #', b.rc_number), f('Logged', when(b.created_at)), b.approved_at ? f('Approved', when(b.approved_at)) : null, b.trip_status ? f('Trip', String(b.trip_status).replace('_', ' ') + (b.pod_count ? ' · POD ×' + b.pod_count : '')) : null]),
      stops.length ? h('div', { style: 'margin:8px 0' }, [h('div', { class: 'dw-f' }, [h('div', { class: 'k' }, 'Stops'), h('div', { class: 'v' }, stops.map((s, i) => h('div', null, (i + 1) + '. ' + String(s.kind || '').toUpperCase() + ' · ' + (s.location || '') + (s.at ? ' · ' + whenDay(s.at) : '') + (s.note ? ' — ' + s.note : ''))))])]) : null,
      b.rc_doc_path ? h('div', { style: 'margin:8px 0' }, h('button', { class: 'dw-btn sm ghost', onClick: async () => { try { const u = await signedDocumentUrl(b.rc_doc_path, 600); window.open(u, '_blank'); } catch (x) { e.textContent = x.message; } } }, [ic('doc', 14), 'Open RC · ' + (b.rc_doc_name || 'file')])) : null,
      b.notes ? h('div', { class: 'dw-muted', style: 'margin:6px 0;white-space:pre-wrap' }, b.notes) : null,
      !DONE.includes(b.status) ? h('div', { class: 'dw-form', style: 'margin-top:10px' }, [h('label', null, ['Note', noteIn]), h('label', null, ['Location', locIn]), h('label', null, ['ETA (ET)', etaIn])]) : null,
      e,
      h('div', { class: 'dw-row', style: 'margin-top:10px' }, actions),
      b.trip_id ? tripPanel(b) : null,
      h('h3', { style: 'margin-top:16px;font-size:.9rem' }, 'Timeline'), tl,
    ]);
    try { const r = await dispatcherBookingTimeline(b.id); const rows = Array.isArray(r) ? r : []; mount(tl, rows.length ? h('div', { class: 'dw-tl' }, rows.map((x) => h('div', null, [h('b', { style: 'color:#fff' }, ({ created: 'Logged', rc: 'RC', status: 'Status', check_call: 'Check call', note: 'Note', exception: 'Exception', decision: 'LoadBoot', eta: 'ETA' })[x.kind] || x.kind), ' · ', h('span', { class: 'dw-muted' }, when(x.created_at) + (x.by ? ' · ' + x.by : '')), h('div', null, [x.note || '', x.location ? ' — ' + x.location : '', x.eta_at ? ' — ETA ' + when(x.eta_at) : ''])]))) : h('div', { class: 'dw-muted' }, 'No events yet.')); } catch (x) { mount(tl, err(x.message)); }
  }
  // edit a booking before approval (gross / miles / times / stops / notes) — the server recomputes the floor flag
  function editBooking(b) {
    const I = (v, type, extra) => h('input', Object.assign({ class: 'dw-in', type: type || 'text', value: v == null ? '' : (type === 'datetime-local' ? dtET(v) : String(v)) }, extra || {}));
    const gross = I(b.gross, 'number', { step: '0.01', min: '0' }), miles = I(b.miles, 'number', { min: '0' }), pu = I(b.pickup_at, 'datetime-local'), dl = I(b.delivery_at, 'datetime-local'), comm = I(b.commodity), wt = I(b.weight_lbs, 'number'), rep = I(b.broker_rep), ph = I(b.broker_phone), em = I(b.broker_email), rcno = I(b.rc_number), notes = h('textarea', { class: 'dw-in', rows: 3 }, b.notes || '');
    const stopsUI = stopsEditor(Array.isArray(b.stops) && b.stops.length ? b.stops : null, () => ({ origin: b.origin, destination: b.destination, pu: pu.value, dl: dl.value }));
    const e = h('div', { class: 'dw-err' });
    const m = modal('Edit booking — ' + b.origin + ' → ' + b.destination, h('div', null, [
      h('div', { class: 'dw-muted', style: 'margin-bottom:10px' }, 'Broker, origin and destination are fixed (cancel and re-log if those changed). Every edit is on the timeline and LoadBoot sees it.'),
      h('div', { class: 'dw-form' }, [h('label', null, ['Gross rate $', gross]), h('label', null, ['Loaded miles', miles]), h('label', null, ['Pickup (ET)', pu]), h('label', null, ['Delivery (ET)', dl]), h('label', null, ['Commodity', comm]), h('label', null, ['Weight (lb)', wt]), h('label', null, ['Rep', rep]), h('label', null, ['Rep phone', ph]), h('label', null, ['Rep email', em]), h('label', null, ['RC number', rcno]), h('label', { class: 'wide' }, ['Stops (multi-stop loads)', stopsUI.el]), h('label', { class: 'wide' }, ['Notes', notes])]), e,
      h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: async (ev) => { ev.target.disabled = true; try {
        const p = { gross: gross.value, miles: miles.value || null, pickup_at: fromET(pu.value), delivery_at: fromET(dl.value), commodity: comm.value, weight_lbs: wt.value || null, broker_rep: rep.value, broker_phone: ph.value, broker_email: em.value, rc_number: rcno.value, notes: notes.value };
        const st = stopsUI.value(); if (st) p.stops = st;
        const r = await dispatcherBookingUpdate(b.id, p); if (r && r.error) throw new Error(r.error); m.close(); toast('Booking updated'); await load();
      } catch (x) { e.textContent = x.message; ev.target.disabled = false; } } }, 'Save changes'), h('button', { class: 'dw-btn ghost', onClick: () => m.close() }, 'Cancel')]),
    ]));
  }
  // stops editor: rows of kind / location / time (ET) / note; returns null when only the plain PU→DEL pair is present
  function stopsEditor(initial, defaults) {
    const list = h('div'); const rows = [];
    const addRow = (s) => {
      s = s || {};
      const kind = h('select', { class: 'dw-in' }, [['pickup', 'Pickup'], ['delivery', 'Delivery']].map(([v, l]) => h('option', { value: v, selected: (s.kind || 'pickup') === v }, l)));
      const loc = h('input', { class: 'dw-in', placeholder: 'City, ST (or facility)', value: s.location || '' }), at = h('input', { class: 'dw-in', type: 'datetime-local', value: s.at ? dtET(s.at) : '' }), note = h('input', { class: 'dw-in', placeholder: 'appt / ref / note', value: s.note || '' });
      const row = h('div', { class: 'dw-stop' }, [kind, loc, at, h('button', { class: 'dw-x', type: 'button', 'aria-label': 'Remove stop', onClick: () => { row.remove(); rows.splice(rows.indexOf(rec), 1); } }, ic('x', 12)), h('div', { style: 'grid-column:1/-1' }, note)]);
      const rec = { row, kind, loc, at, note }; rows.push(rec); list.appendChild(row);
    };
    (initial || []).forEach(addRow);
    const el0 = h('div', null, [h('div', { class: 'dw-muted', style: 'font-weight:400;margin-bottom:4px' }, 'Only for loads with more than one pickup or delivery. Leave empty for a simple A → B load.'), list, h('button', { class: 'dw-btn sm ghost', type: 'button', style: 'margin-top:4px', onClick: () => { if (!rows.length) { const d = defaults(); addRow({ kind: 'pickup', location: d.origin, at: d.pu ? fromET(d.pu) : null }); addRow({ kind: 'delivery', location: d.destination, at: d.dl ? fromET(d.dl) : null }); } addRow({ kind: 'delivery' }); } }, [ic('plus', 14), 'Add stop'])]);
    return { el: el0, value: () => { const v = rows.map((r) => ({ kind: r.kind.value, location: r.loc.value.trim(), at: fromET(r.at.value), note: r.note.value.trim() || undefined })).filter((s) => s.location); return v.length ? v : null; } };
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
      const act = async (action, p, msg) => { e.textContent = ''; const r = await dispatcherTripAction(org, b.trip_id, action, p).catch((x) => ({ error: x.message })); if (r && r.error) { e.textContent = r.error; return; } if (msg) toast(msg); await paint(); };
      const note = h('input', { class: 'dw-in', placeholder: 'note / where is the truck' });
      const stopBtns = ['pickup', 'delivery'].map((stop) => {
        const o = open(stop), dn = done(stop);
        return h('div', { class: 'dw-row', style: 'gap:6px' }, [
          h('span', { class: 'dw-chip' }, stop.toUpperCase() + (dn ? ' · done' : o ? ' · on site since ' + when(o.arrived_at) : '')),
          !o && !dn ? h('button', { class: 'dw-btn sm', onClick: () => act('arrive', { stop, free_minutes: 120 }, 'Arrival logged — detention clock starts after 2 h') }, 'Arrived at ' + stop) : null,
          o ? h('button', { class: 'dw-btn sm', onClick: () => act('depart', { stop, note: note.value }, 'Departure logged') }, 'Departed ' + stop) : null,
        ]);
      });
      mount(box, [
        h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('b', { style: 'color:#7cc0ff' }, [ic('navigation', 16), ' Trip · ' + String(t.status || '').replace('_', ' ').toUpperCase()]), h('button', { class: 'dw-btn sm ghost', 'aria-label': 'Refresh trip', onClick: paint }, ic('refresh', 14))]),
        h('div', { class: 'dw-grid', style: 'margin-top:6px' }, [f('Driver', t.driver_name ? t.driver_name + (t.driver_phone ? ' · ' + t.driver_phone : '') : null), f('Truck', t.truck_no), f('Tracking', t.tracking_method), f('Last location', t.last_lat != null ? h('a', { href: 'https://www.google.com/maps?q=' + t.last_lat + ',' + t.last_lng, target: '_blank', rel: 'noopener', style: 'color:#7cc0ff' }, Number(t.last_lat).toFixed(3) + ', ' + Number(t.last_lng).toFixed(3) + ' · ' + ago(t.last_loc_at)) : null), f('Pickup risk', t.pickup_risk), f('POD', pods.length ? pods.length + ' file' + (pods.length > 1 ? 's' : '') + ' · ' + pods[0].status : 'not uploaded — ask the driver for the signed BOL photo')]),
        stops.length ? h('div', { class: 'dw-muted', style: 'margin-top:6px' }, stops.map((s0) => (s0.kind || '') + ': ' + (s0.location || '') + (s0.scheduled_at ? ' · ' + when(s0.scheduled_at) : '')).join('  →  ')) : null,
        h('div', { style: 'margin-top:8px' }, stopBtns),
        h('div', { class: 'dw-form', style: 'margin-top:8px' }, [h('label', { class: 'wide' }, ['Note', note])]),
        h('div', { class: 'dw-row', style: 'margin-top:8px' }, [
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('checkin', { note: note.value || 'check-in' }, 'Check-in logged') }, [ic('pin', 14), 'GPS-less check-in']),
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('accessorial', { kind: 'detention', note: note.value }, 'Detention claim filed') }, 'Claim detention'),
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('accessorial', { kind: 'tonu', note: note.value }, 'TONU claim filed') }, 'Claim TONU'),
          h('button', { class: 'dw-btn sm ghost', onClick: () => act('accessorial', { kind: 'layover', note: note.value }, 'Layover claim filed') }, 'Claim layover'),
          h('button', { class: 'dw-btn sm warn', onClick: async () => { const v = await ask({ title: 'Report an issue', danger: true, ok: 'Report', fields: [{ key: 'kind', label: 'Type', type: 'select', value: 'breakdown', options: [['breakdown', 'Breakdown'], ['accident', 'Accident'], ['weather', 'Weather'], ['missed_appointment', 'Missed appointment'], ['other', 'Other']] }, { key: 'note', label: 'What happened', type: 'textarea', required: true, value: note.value }] }); if (!v) return; act('issue', { kind: v.kind, note: v.note }, 'Issue reported — LoadBoot alerted'); } }, [ic('alert', 14), 'Report issue']),
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
    const ts = trucksAll(); if (!ts.length) { toast('No active truck on file yet — ask LoadBoot.', true); return; }
    const tsel = h('select', { class: 'dw-in' }, ts.map((t) => h('option', { value: t.id, selected: truck && truck.id === t.id }, (t._a.carrier && t._a.carrier.name) + ' · Unit ' + (t.unit_no || '?') + ' · ' + (t.equipment || ''))));
    const I = (ph, type, extra) => h('input', Object.assign({ class: 'dw-in', placeholder: ph || '', type: type || 'text' }, extra || {}));
    const broker = I('e.g. TQL'), bmc = I('MC #'), rep = I('rep name'), bphone = I('phone'), bemail = I('email');
    const org = I('City, ST'), dst = I('City, ST'), pu = I('', 'datetime-local'), dl = I('', 'datetime-local');
    const miles = I('loaded miles', 'number', { min: '0' }), dh = I('deadhead miles', 'number', { min: '0' }), gross = I('total $', 'number', { min: '0', step: '0.01' });
    const comm = I('commodity'), wt = I('lbs', 'number'), eq = I('equipment as booked (e.g. 26ft box, liftgate)'), rcno = I('RC / load #'), rcFile = h('input', { type: 'file', accept: '.pdf,image/*', class: 'dw-in' }), notes = h('textarea', { class: 'dw-in', rows: 2, placeholder: 'special instructions, appointment info, pallet count…' });
    const stopsUI = stopsEditor(null, () => ({ origin: org.value, destination: dst.value, pu: pu.value, dl: dl.value }));
    const rpmBox = h('div', { class: 'dw-muted' }, 'Enter miles + gross to see $/mile.');
    const aiBox = h('div', { style: 'display:none;margin-top:8px' });
    // brokers already in the book → quick-fill
    const known = feed.brokers || [];
    const dlist = h('datalist', { id: 'dw-brokers' }, known.map((k) => h('option', { value: k.broker })));
    broker.setAttribute('list', 'dw-brokers');
    broker.addEventListener('change', () => { const k = known.find((x) => x.broker.toLowerCase() === broker.value.trim().toLowerCase()); if (!k) return; if (!bmc.value && k.mc) bmc.value = k.mc; if (!rep.value && k.rep) rep.value = k.rep; if (!bphone.value && k.phone) bphone.value = k.phone; if (!bemail.value && k.email) bemail.value = k.email; });
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
      // RC times are written in the facility's local time; for Eastern lanes that is ET. Never re-shift a "naive" time.
      const asET = (v) => { const s = String(v); const mm = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s); if (mm && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return mm[1] + 'T' + mm[2]; const d0 = new Date(s); return isNaN(d0) ? '' : dtET(d0.toISOString()); };
      if (F.pickup_at && !pu.value) { const v = asET(F.pickup_at); if (v) { pu.value = v; filled.push('pickup'); } }
      if (F.delivery_at && !dl.value) { const v = asET(F.delivery_at); if (v) { dl.value = v; filled.push('delivery'); } }
      if (F.notes && !notes.value) { notes.value = F.notes; filled.push('notes'); }
      calc();
      const t = ts.find((x) => x.id === tsel.value); const cname = t && t._a.carrier && (t._a.carrier.name || ''); const cmc = t && t._a.carrier && String(t._a.carrier.mc || '');
      const named = F.carrier_named ? String(F.carrier_named) : ''; const mcOnRc = String(F.carrier_mc || '');
      const mismatch = named && cname && !named.toLowerCase().includes(cname.toLowerCase().split(' ')[0]) || (mcOnRc && cmc && mcOnRc.replace(/\D/g, '') !== cmc.replace(/\D/g, ''));
      const tone = mismatch ? 'dw-warn' : r.confidence === 'high' ? 'dw-ok' : 'dw-warn';
      mount(aiBox, h('div', { class: tone }, [
        h('div', null, [ic('fileCheck', 14), ' Read from the RC (' + r.confidence + ' confidence): ' + (filled.length ? filled.join(', ') : 'nothing new') + '. Check every field against the document before saving. Times are taken as Eastern.']),
        named ? h('div', { style: 'margin-top:4px' }, 'Carrier named on the RC: ' + named + (mcOnRc ? ' · MC ' + mcOnRc : '')) : null,
        mismatch ? h('div', { style: 'margin-top:4px;font-weight:900' }, '⚠ This RC does not look like it is made out to ' + cname + (cmc ? ' (MC ' + cmc + ')' : '') + '. A load booked under another MC cannot be approved — get the broker to re-issue it.') : null,
        F.stops && F.stops > 2 ? h('div', { style: 'margin-top:4px' }, 'Multi-stop load: ' + F.stops + ' stops — add them under Stops below.') : null,
        (r.warnings || []).length ? h('div', { style: 'margin-top:4px' }, 'Check: ' + r.warnings.join(' · ')) : null,
      ]));
    });
    const calc = () => { const m = Number(miles.value), g = Number(gross.value); const t = ts.find((x) => x.id === tsel.value); const min = minFor(t);
      if (m > 0 && g > 0) { const r = g / m; rpmBox.className = min != null && r < min ? 'dw-warn' : 'dw-ok'; rpmBox.textContent = '$' + r.toFixed(2) + ' per loaded mile' + (min != null ? (r < min ? ' — BELOW the floor of $' + min.toFixed(2) + '. You can log it; LoadBoot needs a written reason to approve.' : ' — above the $' + min.toFixed(2) + ' floor') : '') + (Number(dh.value) > 0 ? ' · all-in $' + (g / (m + Number(dh.value))).toFixed(2) + '/mi' : ''); } else { rpmBox.className = 'dw-muted'; rpmBox.textContent = 'Enter miles + gross to see $/mile.'; } };
    [miles, gross, dh].forEach((x) => x.addEventListener('input', calc)); tsel.addEventListener('change', calc);
    const est = h('button', { class: 'dw-btn sm ghost', type: 'button', onClick: () => { const rm = roadMiles(org.value, dst.value); if (rm) { miles.value = rm; calc(); } else toast('Could not estimate — use "City, ST" for both.', true); } }, 'Estimate');
    const e = h('div', { class: 'dw-err' });
    const m = modal('Log a booking', h('div', null, [
      h('div', { class: 'dw-muted', style: 'margin-bottom:10px' }, 'Log it the moment the broker confirms. Attach the RC first — the fields below fill themselves from it (verify every one). LoadBoot approves from the RC; the driver only moves after approval. All times are Eastern.'),
      dlist,
      h('div', { class: 'dw-form' }, [
        h('label', { class: 'wide' }, ['Truck', tsel]),
        h('label', { class: 'wide' }, ['Rate confirmation (PDF / photo) — attach first, the form fills itself', rcFile]),
        h('label', null, ['Broker *', broker]), h('label', null, ['Broker MC', bmc]), h('label', null, ['Rep', rep]), h('label', null, ['Rep phone', bphone]), h('label', null, ['Rep email', bemail]),
        h('label', null, ['Origin *', org]), h('label', null, ['Destination *', dst]), h('label', null, ['Pickup (ET) *', pu]), h('label', null, ['Delivery (ET)', dl]),
        h('label', null, ['Loaded miles', h('div', { class: 'dw-row', style: 'flex-wrap:nowrap' }, [miles, est])]), h('label', null, ['Deadhead miles', dh]), h('label', null, ['Gross rate $ *', gross]),
        h('label', null, ['Commodity', comm]), h('label', null, ['Weight (lb)', wt]), h('label', null, ['Equipment as booked', eq]),
        h('label', null, ['RC number', rcno]),
        h('label', { class: 'wide' }, ['Stops (multi-stop loads only)', stopsUI.el]),
        h('label', { class: 'wide' }, ['Notes', notes]),
      ]),
      aiBox,
      h('div', { style: 'margin-top:10px' }, rpmBox), e,
      h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: async (ev) => { ev.target.disabled = true; try {
        const t = ts.find((x) => x.id === tsel.value);
        if (!pu.value) throw new Error('Pickup time is required — LoadBoot cannot approve a load without it.');
        const t0 = ts.find((x) => x.id === tsel.value); const wcap = t0 && t0.payload_lbs != null ? Number(t0.payload_lbs) : null;
        if (wcap && Number(wt.value) > wcap) throw new Error('Weight ' + num(wt.value) + ' lb is over the truck payload of ' + num(wcap) + ' lb.');
        let rc = null; const f0 = rcFile.files && rcFile.files[0]; if (f0) rc = await uploadDocument(f0, 'rate_confirmation');
        const p = { carrier_org_id: t._a.carrier_org_id, truck_id: t.id, broker: broker.value.trim(), broker_mc: bmc.value, broker_rep: rep.value, broker_phone: bphone.value, broker_email: bemail.value, origin: org.value.trim(), destination: dst.value.trim(), pickup_at: fromET(pu.value), delivery_at: fromET(dl.value), miles: miles.value || null, deadhead: dh.value || null, gross: gross.value, commodity: comm.value, weight_lbs: wt.value || null, equipment: eq.value || t.equipment, rc_number: rcno.value, rc_doc_path: rc && rc.path, rc_doc_name: rc && rc.fileName, notes: notes.value, source: 'external' };
        const st = stopsUI.value(); if (st) p.stops = st;
        const r = await dispatcherLogBooking(p);
        if (r && r.error) throw new Error(r.error); m.close(); toast(r.status === 'rc_received' ? 'Logged — RC sent to LoadBoot for approval' : 'Logged — attach the RC as soon as you have it'); if (Array.isArray(r.warnings) && r.warnings.length) toast('⚠ ' + r.warnings.join(' · '), true); await load(); tab = 'bookings'; render();
      } catch (x) { e.textContent = x.message; ev.target.disabled = false; } } }, 'Save booking'), h('button', { class: 'dw-btn ghost', onClick: () => m.close() }, 'Cancel')]),
    ]));
  }

  // ---- BROKERS
  function vBrokers() {
    const rows = (feed.brokers || []).slice().sort((a, b) => Number(b.bookings || 0) - Number(a.bookings || 0) || String(a.broker).localeCompare(String(b.broker)));
    const list = h('div', { class: 'dw-tablewrap' });
    const paintRows = () => mount(list, rows.length ? h('table', { class: 'dw-table' }, [h('thead', null, h('tr', null, ['Broker', 'MC', 'Rep', 'Contact', 'Lanes / equipment', 'New MC ok?', 'Loads · gross', 'Last', ''].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, [h('td', null, [h('b', { style: 'color:#fff' }, r.broker), r.rating ? stars(r.rating) : null]), h('td', null, r.mc || '—'), h('td', null, r.rep || '—'), h('td', null, [r.phone ? h('div', null, h('a', { href: 'tel:' + r.phone, style: 'color:inherit' }, r.phone)) : null, r.email ? h('div', null, h('a', { href: 'mailto:' + r.email, style: 'color:inherit' }, r.email)) : null]), h('td', null, [r.lanes ? h('div', null, r.lanes) : null, r.equipment ? h('div', { class: 'dw-muted' }, r.equipment) : null]), h('td', null, yn(r.new_authority_ok)), h('td', null, Number(r.bookings || 0) ? r.bookings + ' · ' + money(r.gross) : '—'), h('td', null, [r.last_contact_at ? ago(r.last_contact_at) : '—', r.last_outcome ? h('div', { class: 'dw-muted' }, r.last_outcome) : null]),
        h('td', null, h('div', { class: 'dw-row', style: 'flex-wrap:nowrap' }, [h('button', { class: 'dw-btn sm ghost', onClick: () => brokerForm(r) }, 'Edit'), h('button', { class: 'dw-btn sm ghost', 'aria-label': 'Remove ' + r.broker, onClick: async () => { if (!(await confirmBox('Remove ' + r.broker + '?', 'Only the contact card is removed — bookings stay.', 'Remove', true))) return; await dispatcherBrokerDelete(r.id); toast('Removed'); await load(); } }, ic('x', 14))]))])))]) : h('div', { class: 'dw-muted' }, 'No brokers yet. Every booking you log adds its broker here automatically — or add the ones you already know.'));
    paintRows();
    return h('div', { class: 'dw-card' }, [h('h3', null, ['Broker book (' + rows.length + ')', h('button', { class: 'dw-btn', onClick: () => brokerForm(null) }, [ic('plus', 16), 'Add broker'])]), h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Your relationships are the asset. Log every rep you speak to — especially the ones who work with new authorities. This book is yours; LoadBoot only sees the brokers on bookings.'), list]);
  }
  function brokerForm(r) {
    r = r || {};
    const I = (k, ph, type) => h('input', { class: 'dw-in', placeholder: ph || '', type: type || 'text', value: r[k] == null ? '' : String(r[k]) });
    const broker = I('broker', 'company *'), mc = I('mc', 'MC #'), rep = I('rep'), phone = I('phone'), email = I('email'), lanes = I('lanes', 'e.g. FL→GA, Southeast'), eq = I('equipment', 'e.g. box truck, hotshot'), rating = h('select', { class: 'dw-in' }, [['', '—'], ['1', '1 / 5'], ['2', '2 / 5'], ['3', '3 / 5'], ['4', '4 / 5'], ['5', '5 / 5']].map(([v, l]) => h('option', { value: v, selected: String(r.rating || '') === v }, l)));
    const na = h('select', { class: 'dw-in' }, [['', 'Unknown'], ['true', 'Yes — works with new MCs'], ['false', 'No — 90/180-day rule']].map(([v, l]) => h('option', { value: v, selected: (r.new_authority_ok == null ? '' : String(r.new_authority_ok)) === v }, l)));
    const out = h('select', { class: 'dw-in' }, [['', '—'], ['quoted', 'Quoted'], ['booked', 'Booked'], ['no capacity', 'No capacity'], ['rate too low', 'Rate too low'], ['setup pending', 'Carrier setup pending'], ['no new MC', 'Will not use new MC'], ['other', 'Other']].map(([v, l]) => h('option', { value: v, selected: String(r.last_outcome || '') === v }, l)));
    const note = h('textarea', { class: 'dw-in', rows: 2 }, r.note || '');
    const e = h('div', { class: 'dw-err' });
    const m = modal(r.id ? 'Edit broker' : 'Add broker', h('div', null, [h('div', { class: 'dw-form' }, [h('label', null, ['Broker *', broker]), h('label', null, ['MC', mc]), h('label', null, ['Rep', rep]), h('label', null, ['Phone', phone]), h('label', null, ['Email', email]), h('label', null, ['Lanes', lanes]), h('label', null, ['Equipment', eq]), h('label', null, ['Rating', rating]), h('label', null, ['New authority?', na]), h('label', null, ['Last outcome', out]), h('label', { class: 'wide' }, ['Notes', note])]), e,
      h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: async () => { try { if (!broker.value.trim()) throw new Error('Broker name is required.'); const x = await dispatcherBrokerUpsert({ id: r.id, broker: broker.value.trim(), mc: mc.value, rep: rep.value, phone: phone.value, email: email.value, lanes: lanes.value, equipment: eq.value, rating: rating.value || null, new_authority_ok: na.value === '' ? null : na.value, last_outcome: out.value || null, note: note.value }); if (x && x.error) throw new Error(x.error); m.close(); toast('Saved'); await load(); } catch (x) { e.textContent = x.message; } } }, 'Save'), h('button', { class: 'dw-btn ghost', onClick: () => m.close() }, 'Cancel')])]));
  }

  // ---- MONEY
  function vMoney() {
    const c = feed.commission || {}; const p = feed.profile || {}; const rows = c.rows || [];
    const PC = { draft: '#fbbf24', approved: '#7cc0ff', paid: '#4ade80', void: '#94a3b8' };
    return h('div', null, [
      h('div', { class: 'dw-kpis' }, [['Pending (delivered)', money(c.pending)], ['Approved · unpaid', money(c.approved)], ['Paid', money(c.paid)], ['Your rate', (p.commission_pct || 0) + '% of gross']].map(([l, v]) => h('div', { class: 'dw-kpi' }, [h('b', null, v), h('span', null, l)]))),
      h('div', { class: 'dw-card' }, [h('h3', null, 'How you get paid'), h('div', { class: 'dw-muted', style: 'line-height:1.8' }, [
        h('div', null, 'A commission line is created the moment you mark a load Delivered — ' + (p.commission_pct || 0) + '% of the gross line-haul on that load, at the rate in force when LoadBoot approved it.'),
        h('div', null, 'Pending → LoadBoot approves it once the broker is invoiced → Paid, with the real payout' + (p.currency ? ' in ' + p.currency : '') + ', the exchange rate used and the transfer reference. Cancelled or rejected loads never earn.'),
        p.trial_end ? h('div', null, 'Trial window: ' + (p.trial_start || '?') + ' → ' + p.trial_end + ' (commission only during the trial).') : null,
      ])]),
      h('div', { class: 'dw-card' }, [h('h3', null, 'Commission ledger'), h('div', { class: 'dw-tablewrap' }, rows.length ? h('table', { class: 'dw-table' }, [h('thead', null, h('tr', null, ['Load', 'Gross', '%', 'Commission', 'Status', 'Paid', 'When'].map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, [h('td', null, r.lane || r.booking_id), h('td', null, money(r.gross)), h('td', null, r.pct + '%'), h('td', null, h('b', { style: 'color:#fff' }, money(r.amount))), h('td', null, [h('span', { class: 'dw-pill', style: 'color:' + (PC[r.status] || '#cbd5e1') + ';border-color:currentColor' }, ({ draft: 'PENDING', approved: 'APPROVED', paid: 'PAID', void: 'VOID' })[r.status] || String(r.status).toUpperCase()), r.note ? h('div', { class: 'dw-muted' }, r.note) : null]), h('td', null, r.status === 'paid' ? [r.paid_amount != null ? Number(r.paid_amount).toLocaleString('en-US') + ' ' + (r.paid_currency || '') : '—', r.fx_rate ? h('div', { class: 'dw-muted' }, '@ ' + r.fx_rate) : null, r.payout_ref ? h('div', { class: 'dw-muted' }, 'ref ' + r.payout_ref) : null] : '—'), h('td', null, r.paid_at ? when(r.paid_at) : when(r.created_at))])))]) : h('div', { class: 'dw-muted' }, 'Nothing yet — your first delivered load appears here.'))]),
    ]);
  }

  // ---- MESSAGES (polls every 30 s while open; marks read on open)
  let threadTimer = null; let threadVisible = false;
  function stopThreadPoll() { if (threadTimer) { clearInterval(threadTimer); threadTimer = null; } threadVisible = false; }
  function vMessages() {
    const as = A(); if (!as.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Messages'), h('div', { class: 'dw-muted' }, 'No carrier assigned yet.')]);
    const wrap = h('div'); let cur = as.find((a) => Number(a.unread || 0) > 0) || as[0]; let lastId = null;
    const sel = h('select', { class: 'dw-in', style: 'width:auto', 'aria-label': 'Carrier thread', onChange: () => { cur = as.find((a) => a.id === sel.value); lastId = null; paintThread(true); } }, as.map((a) => h('option', { value: a.id, selected: a.id === cur.id }, ((a.carrier && a.carrier.name) || 'Carrier') + (Number(a.unread || 0) ? ' (' + a.unread + ')' : ''))));
    const thread = h('div', { style: 'max-height:52vh;overflow:auto;padding:6px 2px', role: 'log', 'aria-live': 'polite' });
    const who = h('div', { class: 'dw-muted', style: 'margin-bottom:6px' });
    const inp = h('textarea', { class: 'dw-in', rows: 2, placeholder: 'Message the carrier + LoadBoot… (everyone in this thread sees it)' });
    const e = h('div', { class: 'dw-err' });
    async function paintThread(first) {
      if (first) mount(thread, h('div', { class: 'dw-muted' }, 'Loading…'));
      try { const r = await dispatcherThreadList(cur.id); if (r.error) throw new Error(r.error);
        const msgs = r.messages || []; const newest = msgs.length ? msgs[msgs.length - 1].id : null;
        if (!first && newest === lastId) return; lastId = newest;
        const P = r.participants || {}; mount(who, 'In this thread: you (' + (P.dispatcher || 'dispatcher') + ') · ' + (P.carrier || 'carrier') + ' · ' + (P.staff || 'LoadBoot') + '. One shared channel — no side channels.' + (r.status && r.status !== 'active' ? ' Assignment is ' + r.status + '.' : ''));
        mount(thread, msgs.length ? msgs.map((x) => h('div', { class: 'dw-msg ' + (x.mine ? 'mine' : x.role) }, [x.role !== 'system' ? h('div', { class: 'who' }, (x.mine ? 'you' : (x.by || x.role)) + ' · ' + when(x.at)) : null, h('div', { style: 'white-space:pre-wrap' }, x.body), x.role === 'system' ? h('div', { class: 'who', style: 'margin-top:2px' }, when(x.at)) : null])) : h('div', { class: 'dw-muted' }, 'No messages yet. Introduce yourself — the carrier and LoadBoot both see this.'));
        thread.scrollTop = thread.scrollHeight;
        if (Number(cur.unread || 0) > 0 || first) { try { await dispatcherThreadMarkRead(cur.id); cur.unread = 0; } catch (_) {} }
      } catch (x) { mount(thread, err(x.message)); }
    }
    paintThread(true);
    stopThreadPoll(); threadVisible = true; threadTimer = setInterval(() => { if (!document.body.contains(thread)) { stopThreadPoll(); return; } if (document.visibilityState === 'visible') paintThread(false); }, 30000);
    const send = async (ev) => { if (!inp.value.trim()) return; ev.target.disabled = true; try { const r = await dispatcherThreadSend(cur.id, inp.value); if (r.error) throw new Error(r.error); inp.value = ''; e.textContent = ''; lastId = null; await paintThread(false); } catch (x) { e.textContent = x.message; } ev.target.disabled = false; };
    inp.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); send({ target: sendBtn }); } });
    const sendBtn = h('button', { class: 'dw-btn', onClick: send }, 'Send');
    mount(wrap, h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('chat'), ' Thread with ' + ((cur.carrier && cur.carrier.name) || 'carrier') + ' + LoadBoot']), as.length > 1 ? sel : null]),
      who, thread, inp, e, h('div', { class: 'dw-row', style: 'margin-top:8px' }, [sendBtn, h('button', { class: 'dw-btn ghost', 'aria-label': 'Refresh thread', onClick: () => paintThread(false) }, ic('refresh', 14)), h('span', { class: 'dw-muted' }, 'Ctrl+Enter sends · refreshes every 30 s')])]));
    return wrap;
  }

  // ---- BOARD (internal LoadBoot board, acting for the assigned carrier — P1, bl_disp_0289)
  const boardCache = {};
  function vBoard() {
    const as = A(); if (!as.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Load board'), h('div', { class: 'dw-muted' }, 'No carrier assigned yet.')]);
    let cur = as[0];
    const sel = h('select', { class: 'dw-in', style: 'width:auto', 'aria-label': 'Carrier', onChange: () => { cur = as.find((a) => a.id === sel.value); paint(); } }, as.map((a) => h('option', { value: a.id }, (a.carrier && a.carrier.name) || 'Carrier')));
    const fMin = h('input', { class: 'dw-in', type: 'number', step: '0.05', placeholder: 'min $/mi', style: 'width:110px', 'aria-label': 'Minimum rate per mile' });
    const fDh = h('input', { class: 'dw-in', type: 'number', placeholder: 'max DH mi', style: 'width:110px', 'aria-label': 'Maximum deadhead' });
    const fEq = h('input', { class: 'dw-in', placeholder: 'equipment / text', style: 'width:150px', 'aria-label': 'Filter text' });
    [fMin, fDh, fEq].forEach((x) => x.addEventListener('input', () => paintRows()));
    const body = h('div', { class: 'dw-muted' }, 'Loading the board…');
    let data = null;
    const wrap = h('div', null, [
      h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('search'), ' LoadBoot board — ' + ((cur.carrier && cur.carrier.name) || '')]), h('div', { class: 'dw-row' }, [as.length > 1 ? sel : null, h('button', { class: 'dw-btn sm ghost', 'aria-label': 'Refresh board', onClick: () => paint(true) }, ic('refresh', 14)), h('button', { class: 'dw-btn sm', onClick: () => postForm(cur) }, [ic('plus', 16), 'Post the truck'])])]),
        h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Loads posted on LoadBoot by brokers and shippers, ranked for this carrier’s truck. Requesting a load sends the broker a 30-minute booking request under the carrier’s MC; when the broker accepts, the booking appears under Bookings automatically. Your own DAT/Truckstop finds still go through “Log a booking”.'),
        h('div', { class: 'dw-row', style: 'margin-bottom:8px' }, [h('span', { class: 'dw-muted' }, 'Filter:'), fMin, fDh, fEq]),
        body]),
    ]);
    function paintRows() {
      const d = data; if (!d || d.error) return;
      const best = (d.best && d.best.loads) || []; const avail = Array.isArray(d.available) ? d.available : []; const reqs = Array.isArray(d.requests) ? d.requests : []; const posts = Array.isArray(d.postings) ? d.postings : [];
      const bestIds = new Set(best.map((x) => x.load));
      const pass = (x) => { const r = Number(x.loaded_rpm || x.rpm || (x.rate && x.miles ? x.rate / x.miles : 0)); if (fMin.value && r && r < Number(fMin.value)) return false; if (fDh.value && x.deadhead_miles != null && Number(x.deadhead_miles) > Number(fDh.value)) return false; if (fEq.value) { const s = JSON.stringify(x).toLowerCase(); if (!s.includes(fEq.value.toLowerCase())) return false; } return true; };
      const req = (loadId, lane) => async () => { const v = await ask({ title: 'Request to book', text: lane + ' — the broker gets a 30-minute booking request under ' + ((cur.carrier && cur.carrier.name) || 'the carrier') + '’s MC.', ok: 'Send request', fields: [{ key: 'note', label: 'Note to the broker (optional)', type: 'textarea', placeholder: 'e.g. can pick up today 14:00, liftgate on board' }] }); if (!v) return; const r = await dispatcherRequestBook(cur.carrier_org_id, loadId, v.note).catch((e) => ({ error: e.message })); if (r && r.error) { toast(r.error, true); return; } toast('Request sent — the broker has ' + (r.expires_in_minutes || 30) + ' minutes to respond.'); paint(true); };
      const detail = (loadId) => async () => { const box = h('div', { class: 'dw-muted' }, 'Loading…'); modal('Load details', box); const d2 = await dispatcherLoadDetail(cur.carrier_org_id, loadId).catch((e) => ({ error: e.message })); if (!d2 || d2.error) { mount(box, err((d2 && d2.error) || 'Could not load.')); return; } const t = d2.terms || {}; const dx = t.details || {}; mount(box, [h('div', { class: 'dw-lane' }, (d2.origin || '') + ' → ' + (d2.destination || '')), h('div', { class: 'dw-grid', style: 'margin-top:8px' }, [f('Rate', money(d2.rate) + (d2.rpm != null ? ' · $' + Number(d2.rpm).toFixed(2) + '/mi' : '')), f('Miles', d2.miles), f('Equipment', d2.equipment), f('Commodity', d2.commodity), f('Weight', d2.weight), f('Pickup', [d2.pickup_date, t.pickup_window].filter(Boolean).join(' · ')), f('Delivery', [d2.delivery_date, t.delivery_window].filter(Boolean).join(' · ')), f('Scheduling', t.scheduling), f('Reference', t.reference), f('Posted by', d2.posted_by), f('Load size', dx.load_size), f('Pallets', dx.pallets), f('Tarps', dx.tarps), f('Pickup loading', dx.load_method_pickup), f('Delivery unloading', dx.load_method_delivery), f('Pickup hours', dx.dock_hours_pickup), f('Delivery hours', dx.dock_hours_delivery), dx.driver_assist_required ? f('Driver assist', 'REQUIRED') : null, dx.team_required ? f('Drivers', 'TEAM required') : null]), t.instructions ? h('div', { class: 'dw-muted', style: 'margin-top:8px;white-space:pre-wrap' }, t.instructions) : null, h('div', { class: 'dw-info', style: 'margin-top:10px' }, 'Exact addresses, pickup numbers and the executed RC are released the moment the broker accepts the request.'), h('div', { class: 'dw-row', style: 'margin-top:10px' }, [h('button', { class: 'dw-btn', onClick: req(loadId, (d2.origin || '') + ' → ' + (d2.destination || '')) }, 'Request to book')])]); };
      const loadRow = (x, scored) => h('div', { class: 'dw-book', style: 'cursor:default' }, [
        h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, x.lane || (x.origin + ' → ' + x.destination)), scored ? h('span', { class: 'dw-pill', style: 'color:' + (x.score >= 70 ? '#4ade80' : x.score >= 45 ? '#fbbf24' : '#94a3b8') + ';border-color:currentColor' }, 'FIT ' + x.score + '/100') : (x.direct_to_you ? h('span', { class: 'dw-pill', style: 'color:#7cc0ff;border-color:currentColor' }, 'DIRECT OFFER') : null)]),
        h('div', { class: 'dw-muted', style: 'margin-top:4px' }, [x.equipment, x.rate != null ? money(x.rate) : 'rate on request', x.miles ? num(x.miles) + ' mi' : null, (x.loaded_rpm || x.rpm) ? '$' + Number(x.loaded_rpm || x.rpm).toFixed(2) + '/mi' : null, x.deadhead_miles != null ? 'DH ~' + x.deadhead_miles + ' mi' : null, x.all_in_rpm ? 'all-in $' + x.all_in_rpm : null, x.pickup_date ? 'PU ' + x.pickup_date : null, x.broker, x.commodity, x.weight].filter(Boolean).join(' · ')),
        scored && Array.isArray(x.factors) ? h('div', { style: 'margin-top:4px' }, x.factors.map((f0) => h('span', { class: 'dw-chip', title: f0.detail || '' }, f0.factor + ' ' + f0.points + '/' + f0.max))) : null,
        x.requirements ? h('div', { class: 'dw-muted' }, 'Req: ' + x.requirements) : null,
        h('div', { class: 'dw-row', style: 'margin-top:8px' }, [h('button', { class: 'dw-btn sm', onClick: req(x.load || x.id, x.lane || (x.origin + ' → ' + x.destination)) }, 'Request to book'), h('button', { class: 'dw-btn sm ghost', onClick: detail(x.load || x.id) }, 'Details'), x.direct_offer_expired ? h('span', { class: 'dw-muted' }, 'direct offer expired') : null]),
      ]);
      const bestF = best.filter(pass), availF = avail.filter((x) => !bestIds.has(x.id)).filter(pass);
      mount(body, [
        d.best && d.best.assumptions ? h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Ranking assumes target $' + d.best.assumptions.target_rpm + '/mi, max deadhead ' + d.best.assumptions.max_deadhead + ' mi · location basis: ' + (d.best.last_location_basis || '—') + (d.best.skipped_ineligible ? ' · ' + d.best.skipped_ineligible + ' loads hidden (not eligible for this truck)' : '')) : null,
        h('h3', { style: 'font-size:.9rem;margin:8px 0 4px' }, 'Best fit for this truck (' + bestF.length + (bestF.length !== best.length ? ' of ' + best.length : '') + ')'),
        bestF.length ? bestF.map((x) => loadRow(x, true)) : h('div', { class: 'dw-muted' }, best.length ? 'Nothing passes your filter.' : 'Nothing scores for this truck right now.'),
        h('h3', { style: 'font-size:.9rem;margin:14px 0 4px' }, 'All available (' + availF.length + ')'),
        availF.length ? availF.map((x) => loadRow(x, false)) : h('div', { class: 'dw-muted' }, 'No other loads on the board.'),
        h('h3', { style: 'font-size:.9rem;margin:14px 0 4px' }, 'Booking requests (' + reqs.length + ')'),
        reqs.length ? reqs.map((r) => h('div', { class: 'dw-book', style: 'cursor:default' }, [h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, r.origin + ' → ' + r.destination), h('span', { class: 'dw-pill', style: 'color:' + ({ pending: '#fbbf24', approved: '#4ade80', declined: '#f87171', expired: '#94a3b8', cancelled: '#94a3b8' })[r.status] + ';border-color:currentColor' }, String(r.status).toUpperCase())]), h('div', { class: 'dw-muted' }, [money(r.rate), ' · sent ', when(r.created_at), r.decided_at ? ' · decided ' + when(r.decided_at) : '', r.note ? ' · ' + r.note : ''])])) : h('div', { class: 'dw-muted' }, 'No requests yet.'),
        h('h3', { style: 'font-size:.9rem;margin:14px 0 4px' }, 'Truck postings (' + posts.length + ')'),
        posts.length ? posts.map((p0) => h('div', { class: 'dw-book', style: 'cursor:default' }, [h('div', { class: 'dw-row', style: 'justify-content:space-between' }, [h('div', { class: 'dw-lane' }, (p0.unit_no ? 'Unit ' + p0.unit_no + ' · ' : '') + p0.origin + (p0.dest_pref ? ' → ' + p0.dest_pref : ' → anywhere')), h('span', { class: 'dw-pill', style: 'color:' + (p0.status === 'active' ? '#4ade80' : '#fbbf24') + ';border-color:currentColor' }, String(p0.status).toUpperCase() + ' · ' + (p0.matches || 0) + ' matches')]),
          h('div', { class: 'dw-muted' }, [(p0.equipment || []).join('/'), ' · ', p0.from, ' → ', p0.to, ' · ', p0.radius, ' mi', p0.min_rpm ? ' · min $' + p0.min_rpm + '/mi' : '', p0.notes ? ' · ' + p0.notes : '']),
          h('div', { class: 'dw-row', style: 'margin-top:6px' }, [
            h('button', { class: 'dw-btn sm ghost', onClick: async () => { const m0 = await dispatcherPostingMatches(cur.carrier_org_id, p0.id).catch((e) => ({ error: e.message })); if (m0 && m0.error) { toast(m0.error, true); return; } const rows = Array.isArray(m0) ? m0 : []; modal('Matches — ' + p0.origin, h('div', null, rows.length ? rows.map((mm) => h('div', { class: 'dw-book', style: 'cursor:default' }, [h('div', { class: 'dw-lane' }, mm.origin + ' → ' + mm.destination), h('div', { class: 'dw-muted' }, [money(mm.rate), mm.miles ? ' · ' + mm.miles + ' mi' : '', ' · ', mm.equipment || '', mm.pickup_date ? ' · PU ' + mm.pickup_date : '', ' · ', mm.basis || '', mm.still_available ? '' : ' · GONE']), mm.still_available ? h('button', { class: 'dw-btn sm', style: 'margin-top:6px', onClick: req(mm.load_id, mm.origin + ' → ' + mm.destination) }, 'Request to book') : null])) : h('div', { class: 'dw-muted' }, 'No matches yet — the matcher runs as brokers post.'))); } }, 'Matches'),
            p0.status === 'active' ? h('button', { class: 'dw-btn sm ghost', onClick: async () => { await dispatcherUpdatePosting(cur.carrier_org_id, p0.id, 'pause'); paint(true); } }, 'Pause') : h('button', { class: 'dw-btn sm ghost', onClick: async () => { await dispatcherUpdatePosting(cur.carrier_org_id, p0.id, 'resume'); paint(true); } }, 'Resume'),
            h('button', { class: 'dw-btn sm ghost', 'aria-label': 'Delete posting', onClick: async () => { if (!(await confirmBox('Delete this posting?', 'Brokers stop seeing the truck immediately.', 'Delete', true))) return; await dispatcherUpdatePosting(cur.carrier_org_id, p0.id, 'delete'); paint(true); } }, ic('x', 14)),
          ])])) : h('div', { class: 'dw-muted' }, 'No active posting. Post the truck so brokers can find it and the matcher can alert you.'),
      ]);
    }
    async function paint(force) {
      mount(body, h('div', { class: 'dw-muted' }, 'Loading the board…'));
      let d = boardCache[cur.id]; if (!d || force) { try { d = await dispatcherBoard(cur.carrier_org_id, 20); } catch (e) { d = { error: e.message }; } boardCache[cur.id] = d; }
      data = d;
      if (d.error) { mount(body, err(d.error)); return; }
      paintRows();
    }
    function postForm(a) {
      const ts = (a.trucks || []); if (!ts.length) { toast('No active truck on file for this carrier.', true); return; }
      const t0 = ts[0]; const av = t0.availability || {};
      const tsel = h('select', { class: 'dw-in' }, ts.map((t) => h('option', { value: t.id }, 'Unit ' + (t.unit_no || '?') + ' · ' + (t.equipment || ''))));
      const origin = h('input', { class: 'dw-in', placeholder: 'City, ST', value: av.empty_location || [t0.domicile_city, t0.domicile_state].filter(Boolean).join(', ') });
      const dest = h('input', { class: 'dw-in', placeholder: 'e.g. GA / Southeast / anywhere' });
      const from = h('input', { class: 'dw-in', type: 'date', value: av.empty_at ? dateET(new Date(av.empty_at)) : dateET() });
      const to = h('input', { class: 'dw-in', type: 'date', value: av.must_be_home_by ? dateET(new Date(av.must_be_home_by)) : dateET(new Date(Date.now() + 5 * 86400000)) });
      const radius = h('input', { class: 'dw-in', type: 'number', value: t0.max_radius_miles || 300 });
      const minr = h('input', { class: 'dw-in', type: 'number', step: '0.05', value: minFor({ ...t0, _a: a }) != null ? minFor({ ...t0, _a: a }) : '' });
      const notes = h('textarea', { class: 'dw-in', rows: 2, placeholder: 'e.g. liftgate + dock-high, no residential, home by Thursday' }, [t0.liftgate ? 'liftgate' : null, t0.dock_high ? 'dock-high' : null, av.must_be_home_by ? 'home by ' + whenDay(av.must_be_home_by) : null].filter(Boolean).join(', '));
      const e = h('div', { class: 'dw-err' });
      tsel.addEventListener('change', () => { const t = ts.find((x) => x.id === tsel.value) || t0; const av2 = t.availability || {}; origin.value = av2.empty_location || [t.domicile_city, t.domicile_state].filter(Boolean).join(', '); radius.value = t.max_radius_miles || 300; const mn = minFor({ ...t, _a: a }); minr.value = mn != null ? mn : ''; });
      const m = modal('Post the truck on LoadBoot', h('div', null, [h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Brokers searching LoadBoot see this truck; the matcher alerts you when a fitting load is posted. Auto-request is always OFF for dispatcher postings — you confirm every load. Dates are Eastern.'),
        h('div', { class: 'dw-form' }, [h('label', { class: 'wide' }, ['Truck', tsel]), h('label', null, ['Available at (City, ST) *', origin]), h('label', null, ['Destination preference', dest]), h('label', null, ['From *', from]), h('label', null, ['To *', to]), h('label', null, ['Radius (mi)', radius]), h('label', null, ['Min $/mile', minr]), h('label', { class: 'wide' }, ['Notes for brokers', notes])]), e,
        h('div', { class: 'dw-row', style: 'margin-top:12px' }, [h('button', { class: 'dw-btn', onClick: async (ev) => { ev.target.disabled = true; try { if (!origin.value.trim()) throw new Error('Where is the truck available?'); if (to.value < from.value) throw new Error('"To" is before "From".'); const r = await dispatcherPostTruck(a.carrier_org_id, { truck_id: tsel.value, origin: origin.value, dest_pref: dest.value, available_from: from.value, available_to: to.value, radius_miles: radius.value || null, min_rpm: minr.value || null, notes: notes.value }); if (r && r.error) throw new Error(r.error); m.close(); toast('Truck posted'); paint(true); } catch (x) { e.textContent = x.message; ev.target.disabled = false; } } }, 'Post truck'), h('button', { class: 'dw-btn ghost', onClick: () => m.close() }, 'Cancel')])]));
    }
    paint();
    return wrap;
  }

  // ---- KPIS (computed server-side from bookings + events — nothing hand-typed)
  function vKpis() {
    const wrap = h('div'); const p = feed.profile || {};
    const trialDays = p.trial_start && p.trial_end ? Math.max(1, Math.ceil((new Date(p.trial_end) - new Date(p.trial_start)) / 86400000) + 1) : null;
    let days = trialDays && p.status === 'trial' ? trialDays : 30;
    const body = h('div', { class: 'dw-muted' }, 'Loading…');
    const opts = [[7, 'Last 7 days'], trialDays ? [trialDays, 'Trial window (' + p.trial_start + ' → ' + p.trial_end + ')'] : null, [30, 'Last 30 days'], [90, 'Last 90 days']].filter(Boolean);
    const sel = h('select', { class: 'dw-in', style: 'width:auto', 'aria-label': 'Period', onChange: () => { days = Number(sel.value); paint(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === days }, l)));
    async function paint() {
      let k; try { k = await dispatcherMyKpis(days); } catch (e) { mount(body, err(e.message)); return; }
      if (k.error) { mount(body, err(k.error)); return; }
      const tile = (l, v, hint, good) => h('div', { class: 'dw-kpi', title: hint || '', style: good === false ? 'border-color:rgba(252,83,5,.5)' : good === true ? 'border-color:rgba(74,222,128,.5)' : '' }, [h('b', null, v == null ? '—' : String(v)), h('span', null, l)]);
      mount(body, [h('div', { class: 'dw-kpis' }, [
        tile('Bookings', k.bookings), tile('Delivered', k.delivered), tile('Cancelled / rejected', k.cancelled, '', k.cancelled != null ? Number(k.cancelled) === 0 : null), tile('Loads / week / truck', k.loads_per_week_per_truck, 'target ≥ 3', k.loads_per_week_per_truck != null ? Number(k.loads_per_week_per_truck) >= 3 : null),
        tile('Gross booked', money(k.gross)), tile('Gross / truck / week', money(k.gross_per_truck_week)), tile('Avg $/mile', k.avg_rpm != null ? '$' + Number(k.avg_rpm).toFixed(2) : null),
        tile('Deadhead', k.deadhead_pct != null ? k.deadhead_pct + '%' : null, 'deadhead miles as a share of all miles — lower is better', k.deadhead_pct != null ? Number(k.deadhead_pct) <= 15 : null),
        tile('On-time delivery', k.on_time_pct != null ? k.on_time_pct + '%' : null, 'delivered within 30 min of the appointment', k.on_time_pct != null ? Number(k.on_time_pct) >= 95 : null),
        tile('Check calls / load', k.check_calls_per_load, 'logged check calls per dispatched load — target ≥ 2', k.check_calls_per_load != null ? Number(k.check_calls_per_load) >= 2 : null),
        tile('RC attached', k.rc_attach_rate != null ? k.rc_attach_rate + '%' : null, 'bookings with a rate confirmation on file — target 100%', k.rc_attach_rate != null ? Number(k.rc_attach_rate) >= 100 : null),
        tile('RC turnaround', k.rc_turnaround_h != null ? k.rc_turnaround_h + ' h' : null, 'hours from logging a booking to attaching its RC'),
        tile('Below-floor bookings', k.below_min_share != null ? k.below_min_share + '%' : null, 'share of bookings under the carrier’s floor rate'),
        tile('Brokers used', k.brokers_used), tile('Trucks', k.trucks),
      ]), h('div', { class: 'dw-muted', style: 'line-height:1.8' }, [
        h('div', null, 'These are the numbers LoadBoot looks at when the trial ends and when pay is reviewed. They are computed from what you log — so log everything.'),
        h('div', null, 'Good trial: ≥ 3 loads/week per truck, avg $/mile above the floor, 100% RC attached, ≥ 2 check calls per load, deadhead under 15%, 0 cancellations caused by dispatch.'),
      ])]);
    }
    paint();
    mount(wrap, h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('chart'), ' My KPIs']), sel]), body]));
    return wrap;
  }

  // ---- PACKET (the four broker-setup documents — never bank details)
  function vPacket() {
    const as = A(); if (!as.length) return h('div', { class: 'dw-card' }, [h('h3', null, 'Carrier packet'), h('div', { class: 'dw-muted' }, 'No carrier assigned yet.')]);
    const LABEL = { authority: 'Operating authority (MC certificate)', insurance: 'Certificate of insurance (COI)', w9: 'W-9', noa: 'Notice of assignment (factoring)' };
    const ORDER = ['authority', 'insurance', 'w9', 'noa'];
    return h('div', null, as.map((a) => { const c = a.carrier || {}; const docs = (a.documents || []).slice().sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type));
      const have = new Set(docs.map((d) => d.type)); const missing = ORDER.filter((k) => !have.has(k) && (k !== 'noa' || c.factoring_company));
      const summary = [c.name, c.mc ? 'MC ' + c.mc : null, c.dot ? 'USDOT ' + c.dot : null, c.contact_name, c.phone, c.email, c.home_base, c.factoring_company ? 'Factoring: ' + c.factoring_company + ' (NOA on file — pay the factor)' : 'Direct pay — payment details come from LoadBoot, not from dispatch'].filter(Boolean).join('\n');
      return h('div', { class: 'dw-card' }, [h('h3', null, [h('span', null, [ic('paperclip'), ' ' + (c.name || 'Carrier') + ' — broker setup packet']), h('button', { class: 'dw-btn sm ghost', onClick: async () => { try { await navigator.clipboard.writeText(summary); toast('Carrier details copied'); } catch (_) {} } }, [ic('copy', 14), 'Copy carrier details'])]),
        h('pre', { class: 'dw-muted', style: 'white-space:pre-wrap;font-family:inherit;margin:0 0 10px' }, summary),
        h('div', { class: 'dw-muted', style: 'margin-bottom:8px' }, 'Approved documents on file. Open → download → attach to the broker’s carrier-setup email. Never edit them. Bank letters, voided checks and insurance changes are never yours to send — those requests go to LoadBoot.'),
        docs.length ? h('div', null, docs.map((d) => h('div', { class: 'dw-row', style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--dw-line)' }, [h('div', null, [h('b', { style: 'color:#fff' }, LABEL[d.type] || d.type), h('div', { class: 'dw-muted' }, (d.file_name || '') + ' · ' + when(d.created_at))]), h('button', { class: 'dw-btn sm', onClick: async (ev) => { try { const u = await signedDocumentUrl(d.file_path, 600); window.open(u, '_blank'); } catch (x) { ev.target.textContent = 'No access — ask LoadBoot'; } } }, 'Open')]))) : h('div', { class: 'dw-warn' }, 'No approved documents yet — ask LoadBoot to send you the packet.'),
        missing.length ? h('div', { class: 'dw-warn', style: 'margin-top:8px' }, 'Missing from the packet: ' + missing.map((k) => LABEL[k]).join(', ') + ' — tell LoadBoot before a broker asks.') : null,
      ]); }));
  }

  await load();
  return { reload: load, setTab: (t) => { tab = t; render(); } };
}

export default mountDispatcherWorkspace;
