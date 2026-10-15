// bl_disp_0551 — "Loads posted by the dispatcher": one premium panel for Carrier 360 (opts.org) and Dispatcher 360
// (opts.user). Every field the dispatcher entered, the carrier's journey (board → opened → decision → booking), what
// is missing from the post, and the staff controls: alert the dispatcher, withdraw, hide (CC list only), delete
// (off the carrier's board and the dispatcher's list — restorable). Data: cc_dispatcher_posts.
import { el, mount } from '../../shared/ui/dom.js';
import { money, fmtDate, fmtDateTime, askReason, askConfirm } from '../../shared/ui/components.js';
import { ccDispatcherPosts, ccDispatcherPostAction, ccDispatcherPostAlert, dispatcherWithdrawLoad } from '../../shared/api.js';
import { postMissing, postStatus, postJourney, postSeenLine } from '../../shared/dispatcher-post-quality.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const CSS = `
.dpx{--dpx-ink:#0f172a;--dpx-sub:#64748b;--dpx-line:#e6ebf2;--dpx-soft:#f7f9fc;--dpx-blue:#0883F7;--dpx-orange:#FC5305}
.dpx-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dpx-title{margin:0;font-size:1.02rem;font-weight:900;color:var(--dpx-ink);letter-spacing:-.01em}
.dpx-stats{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 10px}
.dpx-stat{min-width:92px;padding:9px 12px;border-radius:14px;background:linear-gradient(180deg,#fff,var(--dpx-soft));border:1px solid var(--dpx-line);box-shadow:0 1px 0 rgba(15,23,42,.03)}
.dpx-stat b{display:block;font-size:1.15rem;font-weight:900;color:var(--dpx-ink);line-height:1.1}
.dpx-stat span{font-size:.68rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--dpx-sub)}
.dpx-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.dpx-chip{border:1px solid var(--dpx-line);background:#fff;color:#334155;border-radius:999px;padding:6px 12px;font:inherit;font-size:.78rem;font-weight:800;cursor:pointer}
.dpx-chip[aria-pressed="true"]{background:#0f172a;border-color:#0f172a;color:#fff}
.dpx-search{flex:1;min-width:160px;max-width:260px;border:1px solid var(--dpx-line);border-radius:999px;padding:7px 13px;font:inherit;font-size:.82rem;background:#fff}
.dpx-card{position:relative;border:1px solid var(--dpx-line);border-radius:18px;padding:15px 16px 13px;margin-bottom:12px;background:#fff;box-shadow:0 10px 30px -24px rgba(15,23,42,.35);overflow:hidden}
.dpx-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--dpx-accent,#cbd5e1)}
.dpx-card.is-muted{opacity:.62}
.dpx-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.dpx-lane{font-size:1.04rem;font-weight:900;color:var(--dpx-ink);letter-spacing:-.01em}
.dpx-meta{font-size:.8rem;color:var(--dpx-sub);margin-top:3px;display:flex;gap:6px 12px;flex-wrap:wrap}
.dpx-meta a{font-weight:800;color:var(--dpx-blue);text-decoration:none}
.dpx-rate{text-align:right}
.dpx-rate b{font-size:1.2rem;font-weight:900;color:var(--dpx-ink)}
.dpx-rate div{font-size:.76rem;color:var(--dpx-sub);font-weight:700}
.dpx-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:900;letter-spacing:.06em;margin-left:6px;vertical-align:2px}
.dpx-steps{display:flex;align-items:flex-start;margin:14px 0 6px;overflow-x:auto;padding-bottom:2px}
.dpx-step{flex:1;min-width:92px;position:relative;text-align:center;font-size:.7rem;color:var(--dpx-sub);font-weight:700}
.dpx-step::before{content:"";position:absolute;top:8px;left:-50%;width:100%;height:2px;background:var(--dpx-line);z-index:0}
.dpx-step:first-child::before{display:none}
.dpx-step.done::before,.dpx-step.bad::before{background:#93c5fd}
.dpx-dot{position:relative;z-index:1;width:18px;height:18px;margin:0 auto 5px;border-radius:50%;border:2px solid #cbd5e1;background:#fff;display:flex;align-items:center;justify-content:center;font-size:.6rem;color:#fff;font-weight:900}
.dpx-step.done .dpx-dot{background:#0883F7;border-color:#0883F7}
.dpx-step.now .dpx-dot{border-color:#0883F7;box-shadow:0 0 0 4px rgba(8,131,247,.15)}
.dpx-step.bad .dpx-dot{background:#ef4444;border-color:#ef4444}
.dpx-step b{display:block;color:var(--dpx-ink);font-size:.74rem}
.dpx-seen{display:flex;align-items:center;gap:8px;font-size:.82rem;font-weight:700;padding:8px 11px;border-radius:12px;margin-top:6px}
.dpx-miss{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:9px;font-size:.76rem}
.dpx-miss .t{font-weight:900;color:#334155;margin-right:2px}
.dpx-tag{padding:3px 9px;border-radius:999px;font-weight:800;font-size:.72rem;border:1px solid}
.dpx-tag.high{background:#fef2f2;color:#b91c1c;border-color:#fecaca}
.dpx-tag.low{background:#fffbeb;color:#92400e;border-color:#fde68a}
.dpx-tag.ok{background:#f0fdf4;color:#166534;border-color:#bbf7d0}
.dpx-more{margin-top:10px;border-top:1px dashed var(--dpx-line);padding-top:8px}
.dpx-more summary{cursor:pointer;font-size:.8rem;font-weight:900;color:#334155;list-style:none}
.dpx-more summary::-webkit-details-marker{display:none}
.dpx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:10px}
.dpx-sec{background:var(--dpx-soft);border:1px solid var(--dpx-line);border-radius:13px;padding:9px 11px}
.dpx-sec h5{margin:0 0 6px;font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:#0883F7;font-weight:900}
.dpx-kv{display:flex;justify-content:space-between;gap:10px;font-size:.78rem;padding:2px 0}
.dpx-kv span{color:var(--dpx-sub)}
.dpx-kv b{text-align:right;word-break:break-word;color:var(--dpx-ink);font-weight:700}
.dpx-kv b.none{color:#cbd5e1;font-weight:600}
.dpx-alerts{margin-top:9px;display:flex;flex-direction:column;gap:6px}
.dpx-alert{font-size:.78rem;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;border-radius:11px;padding:7px 10px}
.dpx-acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
.dpx-btn{border:1px solid var(--dpx-line);background:#fff;color:#0f172a;border-radius:10px;padding:7px 12px;font:inherit;font-size:.78rem;font-weight:800;cursor:pointer}
.dpx-btn:hover{border-color:#94a3b8}
.dpx-btn.pri{background:linear-gradient(135deg,#0883F7,#0a6fd6);border-color:#0a6fd6;color:#fff}
.dpx-btn.dng{color:#b91c1c;border-color:#fecaca}
.dpx-empty{padding:22px;text-align:center;border:1px dashed var(--dpx-line);border-radius:16px;color:var(--dpx-sub);font-size:.86rem}
@media (max-width:640px){.dpx-rate{text-align:left}.dpx-step{min-width:78px}.dpx-stat{min-width:0;flex:1 1 28%;padding:8px 10px}.dpx-stat b{font-size:1rem}}
`;
let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.id = 'dpx-css'; s.textContent = CSS; document.head.appendChild(s); }

const TONE = {
  available: ['OPEN', '#b45309', '#fff7ed', '#f59e0b'], carrier_accepted: ['ACCEPTED', '#166534', '#f0fdf4', '#22c55e'], booked: ['BOOKED', '#166534', '#f0fdf4', '#22c55e'],
  in_transit: ['MOVING', '#166534', '#f0fdf4', '#22c55e'], delivered: ['DELIVERED', '#166534', '#f0fdf4', '#22c55e'],
  declined: ['DECLINED', '#991b1b', '#fef2f2', '#ef4444'], expired: ['EXPIRED', '#475569', '#f1f5f9', '#94a3b8'], withdrawn: ['WITHDRAWN', '#475569', '#f1f5f9', '#94a3b8'], deleted: ['DELETED', '#7f1d1d', '#fee2e2', '#7f1d1d'],
};
const FILTERS = [['all', 'All'], ['open', 'Open'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['expired', 'Expired'], ['withdrawn', 'Withdrawn'], ['unseen', 'Not seen'], ['gaps', 'Missing info']];
const isAccepted = (st) => st === 'carrier_accepted' || st === 'booked' || st === 'in_transit' || st === 'delivered';
const v = (x) => (x == null || x === '' || (Array.isArray(x) && !x.length)) ? null : x;
const left = (iso) => { const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000); if (s <= 0) return 'expired'; const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm left' : m + 'm left'; };

export function dispatcherPostsPanel(opts = {}) {
  ensureCss();
  const canAct = can('dispatch.manage') || can('carriers.approve');
  const root = el('div', { class: 'dpx' }, el('div', { class: 'cc-sub' }, 'Loading dispatcher posts…'));
  let rows = []; let filter = 'all'; let showHidden = false; let showDeleted = false; let q = '';

  async function load() {
    try { const r = await ccDispatcherPosts({ org: opts.org || null, user: opts.user || null, limit: 200 }); if (r && r.error) throw new Error(r.error); rows = Array.isArray(r) ? r : []; }
    catch (e) { mount(root, el('div', { class: 'cc-sub', style: 'color:#b91c1c' }, humanizeError(e))); return; }
    paint();
  }

  const act = async (fn, ok) => { try { const r = await fn(); if (r && r.error) throw new Error(r.error); toast(ok); load(); } catch (e) { toast(humanizeError(e), 'error'); } };

  function kv(k, val) { return el('div', { class: 'dpx-kv' }, [el('span', null, k), val == null ? el('b', { class: 'none' }, '—') : el('b', null, String(val))]); }
  function sec(title, kids) { return el('div', { class: 'dpx-sec' }, [el('h5', null, title)].concat(kids)); }

  function everything(p) {
    const d = p.details || {}; const a = p.accessorials || d.accessorials || {}; const bs = d.broker_screen || {}; const dp = d.dispatcher_post || {};
    const dims = d.dims && (d.dims.l || d.dims.w || d.dims.h) ? [d.dims.l, d.dims.w, d.dims.h].map((x) => x || '?').join(' × ') + ' in' : null;
    const req = Array.isArray(d.requirements) ? d.requirements.join(', ') : p.requirements;
    return el('div', { class: 'dpx-grid' }, [
      sec('Source', [kv('Board', p.board_label || p.board), kv('Board load ID', v(p.source_reference || d.board_ref)), kv('Link', v(d.source_link)), kv('Confidence', v(p.confidence)), kv('Posted by', v(p.dispatcher)), kv('Posted', fmtDateTime(p.created_at)), kv('Expires', p.expires_at ? fmtDateTime(p.expires_at) : null)]),
      sec('Broker', [kv('Company', v(p.broker)), kv('MC #', v(d.broker_mc)), kv('Rep', v(d.broker_rep)), kv('Phone', v(d.broker_phone)), kv('E-mail', v(d.broker_email)),
        kv('FMCSA screen', bs.authority ? (bs.authority === 'active' ? '✓ active' : bs.authority === 'flagged' ? '🚩 ' + (bs.authority_raw || 'flagged') : '◐ unknown') : null), kv('Legal name', v(bs.legal_name)), kv('Authority age', v(bs.authority_age))]),
      sec('Lane & dates', [kv('Origin', v(p.origin)), kv('Origin ZIP / address', v(d.origin_zip || d.origin_full)), kv('Destination', v(p.destination)), kv('Destination ZIP / address', v(d.destination_zip || d.destination_full)),
        kv('Pickup', p.pickup_date ? fmtDate(p.pickup_date) + (p.pickup_window ? ' · ' + p.pickup_window : '') : null), kv('Delivery', p.delivery_date ? fmtDate(p.delivery_date) + (p.delivery_window ? ' · ' + p.delivery_window : '') : v(p.delivery_window)),
        kv('Loaded miles', v(p.miles)), kv('Deadhead', p.deadhead != null ? p.deadhead + ' mi' : null)]),
      sec('Freight', [kv('Equipment', v(p.equipment)), kv('Truck', v(d.truck_id) ? 'assigned' : null), kv('Load type', v(d.load_type || d.load_size)), kv('Commodity', v(p.commodity || d.commodity)), kv('Weight', v(p.weight || (d.weight_lbs ? d.weight_lbs + ' lbs' : null))),
        kv('Dims', dims), kv('Pieces', v(d.pieces)), kv('Hazmat', p.hazmat ? 'YES' : 'no'), kv('Temperature', v(d.temperature)), kv('Requirements', v(req))]),
      sec('Money', [kv('Rate', money(p.rate)), kv('$/mile', p.rpm != null ? '$' + Number(p.rpm).toFixed(2) : null), kv('Floor at post', d.min_rpm_at_post != null ? '$' + Number(d.min_rpm_at_post).toFixed(2) + '/mi' : null),
        kv('Below floor', p.below_min ? 'YES — ' + (p.below_min_reason || 'no reason') : 'no'), kv('Detention', a.detention_per_hr ? '$' + a.detention_per_hr + '/hr after ' + (a.detention_free_hours || '?') + ' h' : null), kv('TONU', a.tonu ? '$' + a.tonu : null),
        kv('Layover', a.layover_per_day ? '$' + a.layover_per_day + '/day' : null), kv('Lumper', v(a.lumper_policy)), kv('Payment terms', v(a.payment_terms)), kv('Quick pay', v(a.quick_pay)), kv('Factoring OK', a.factoring_ok ? 'yes' : null)]),
      sec('Note & outcome', [kv('Note to carrier', v(p.notes || dp.note)), kv('Carrier decision', p.decision && p.decision.action ? p.decision.action + ' · ' + fmtDateTime(p.decision.at) : null), kv('Decline reason', v(p.decision && p.decision.reason)),
        kv('Withdrawn', p.withdrawn && p.withdrawn.at ? fmtDateTime(p.withdrawn.at) + (p.withdrawn.reason ? ' · ' + p.withdrawn.reason : '') : null), kv('Booking', p.booking && p.booking.id ? p.booking.status : null)]),
    ]);
  }

  function postCard(p) {
    const st = postStatus(p); const t = TONE[st] || [String(st).toUpperCase(), '#475569', '#f1f5f9', '#94a3b8'];
    const staff = p.staff || {}; const miss = postMissing(p); const high = miss.filter((m) => m.level === 'high');
    const seen = p.seen || {}; const steps = postJourney(p);
    const seenTone = seen.opened_at ? 'background:#eff6ff;color:#1e40af' : seen.board_at ? 'background:#f8fafc;color:#334155' : 'background:#fff7ed;color:#9a3412';
    const acts = [];
    if (canAct) {
      acts.push(el('button', { class: 'dpx-btn pri', onClick: async () => {
        const msg = await askReason('Alert ' + (p.dispatcher || 'the dispatcher'), { placeholder: 'What should they fix or know? It goes to their workspace bell and phone.', submitLabel: 'Send alert', subtitle: (p.origin || '—') + ' → ' + (p.destination || '—'),
          value: high.length ? 'Your post ' + (p.origin || '') + ' → ' + (p.destination || '') + ' is missing: ' + high.map((m) => m.label).join(', ') + '. Please fill these in on every post.' : '' });
        if (msg) act(() => ccDispatcherPostAlert(p.id, msg), 'Alert sent to ' + (p.dispatcher || 'the dispatcher'));
      } }, '🔔 Alert dispatcher'));
      if (st === 'available') acts.push(el('button', { class: 'dpx-btn', onClick: async () => {
        const why = await askReason('Withdraw this post?', { placeholder: 'Reason — the dispatcher and (if they opened it) the carrier see it', submitLabel: 'Withdraw' });
        if (why != null) act(() => dispatcherWithdrawLoad(p.id, why), 'Post withdrawn');
      } }, 'Withdraw'));
      acts.push(staff.hidden_at
        ? el('button', { class: 'dpx-btn', onClick: () => act(() => ccDispatcherPostAction(p.id, 'unhide'), 'Shown again') }, 'Unhide')
        : el('button', { class: 'dpx-btn', title: 'Only removes it from this Command Center list — the carrier and the dispatcher are not affected', onClick: async () => {
            const ok = await askConfirm('Hide from this list?', { body: 'It only leaves this Command Center list — nothing changes for the carrier or the dispatcher. “Show hidden” brings it back.', confirmLabel: 'Hide' });
            if (ok) act(() => ccDispatcherPostAction(p.id, 'hide'), 'Hidden — “Show hidden” brings it back');
          } }, 'Hide'));
      acts.push(staff.deleted_at
        ? el('button', { class: 'dpx-btn', onClick: () => act(() => ccDispatcherPostAction(p.id, 'restore'), 'Restored to the dispatcher’s list') }, 'Restore')
        : el('button', { class: 'dpx-btn dng', onClick: async () => {
            const why = await askReason('Delete this post?', { placeholder: 'Reason (the dispatcher sees it if the post was still open)', submitLabel: 'Delete', subtitle: st === 'available' ? 'It comes off the carrier’s board now and leaves the dispatcher’s list. Kept for audit; Restore brings it back to the list.' : 'It leaves the dispatcher’s list. Kept for audit; Restore brings it back.' });
            if (why != null) act(() => ccDispatcherPostAction(p.id, 'delete', why), 'Post deleted');
          } }, 'Delete'));
    }
    return el('div', { class: 'dpx-card' + (staff.hidden_at || staff.deleted_at ? ' is-muted' : ''), style: '--dpx-accent:' + t[3] }, [
      el('div', { class: 'dpx-top' }, [
        el('div', null, [
          el('div', { class: 'dpx-lane' }, [(p.origin || '—') + ' → ' + (p.destination || '—'),
            el('span', { class: 'dpx-pill', style: 'background:' + t[2] + ';color:' + t[1] }, t[0]),
            p.is_demo ? el('span', { class: 'dpx-pill', style: 'background:#f5f3ff;color:#6d28d9' }, 'DEMO') : null,
            staff.hidden_at ? el('span', { class: 'dpx-pill', style: 'background:#f1f5f9;color:#475569', title: staff.hidden_reason || '' }, 'HIDDEN') : null,
            p.below_min ? el('span', { class: 'dpx-pill', style: 'background:#fffbeb;color:#92400e', title: p.below_min_reason || '' }, '⚠ BELOW FLOOR') : null]),
          el('div', { class: 'dpx-meta' }, [
            opts.user ? (p.carrier ? el('a', { href: '#/carriers?id=' + encodeURIComponent(p.carrier_org_id || '') }, '🚚 ' + p.carrier) : null)
                      : (p.dispatcher ? el('a', { href: '#/dispatchers?id=' + encodeURIComponent(p.dispatcher_user || '') }, '🎧 ' + p.dispatcher) : null),
            el('span', null, 'from ' + (p.board_label || p.board || '—') + (p.source_reference ? ' · ref ' + p.source_reference : '')),
            el('span', null, [p.equipment, p.pickup_date ? 'PU ' + fmtDate(p.pickup_date) : null, p.broker].filter(Boolean).join(' · ')),
            el('span', null, 'posted ' + fmtDateTime(p.created_at) + (st === 'available' && p.expires_at ? ' · ⏳ ' + left(p.expires_at) : '')),
          ].filter(Boolean)),
        ]),
        el('div', { class: 'dpx-rate' }, [el('b', null, money(p.rate)), el('div', null, p.rpm != null ? '$' + Number(p.rpm).toFixed(2) + '/mi · ' + p.miles + ' mi' : 'no miles — $/mi unknown')]),
      ]),
      el('div', { class: 'dpx-steps' }, steps.map((s) => el('div', { class: 'dpx-step ' + s.state, title: s.note || '' }, [el('div', { class: 'dpx-dot' }, s.state === 'done' ? '✓' : s.state === 'bad' ? '✕' : ''), el('b', null, s.label), s.at ? fmtDateTime(s.at) : (s.state === 'now' ? 'waiting' : '')]))),
      el('div', { class: 'dpx-seen', style: seenTone }, ['👁', postSeenLine(p, fmtDateTime)]),
      p.decision && p.decision.reason ? el('div', { class: 'dpx-seen', style: 'background:#fef2f2;color:#991b1b' }, ['✕', 'Carrier declined: ' + p.decision.reason]) : null,
      miss.length ? el('div', { class: 'dpx-miss' }, [el('span', { class: 't' }, 'Missing:')].concat(miss.map((m) => el('span', { class: 'dpx-tag ' + m.level, title: m.why || '' }, m.label))))
        : el('div', { class: 'dpx-miss' }, el('span', { class: 'dpx-tag ok' }, '✓ Complete post')),
      Array.isArray(staff.alerts) && staff.alerts.length ? el('div', { class: 'dpx-alerts' }, staff.alerts.slice(-3).map((a) => el('div', { class: 'dpx-alert' }, '🔔 ' + (a.by || 'LoadBoot') + ' · ' + fmtDateTime(a.at) + ' — ' + a.message))) : null,
      staff.deleted_at ? el('div', { class: 'dpx-alert', style: 'background:#fef2f2;border-color:#fecaca;color:#7f1d1d;margin-top:9px' }, 'Deleted by ' + (staff.deleted_by || 'LoadBoot') + ' · ' + fmtDateTime(staff.deleted_at) + (staff.deleted_reason ? ' — ' + staff.deleted_reason : '')) : null,
      el('details', { class: 'dpx-more' }, [el('summary', null, '▸ Everything the dispatcher posted'), everything(p)]),
      acts.length ? el('div', { class: 'dpx-acts' }, acts) : null,
    ].filter(Boolean));
  }

  function paint() {
    const base = rows.filter((p) => (showDeleted || !(p.staff && p.staff.deleted_at)) && (showHidden || !(p.staff && p.staff.hidden_at)));
    const n = (fn) => rows.filter((p) => !(p.staff && p.staff.deleted_at) && fn(p)).length;
    const live = rows.filter((p) => !(p.staff && p.staff.deleted_at));
    const nHidden = rows.filter((p) => p.staff && p.staff.hidden_at).length; const nDel = rows.filter((p) => p.staff && p.staff.deleted_at).length;
    const pass = (p) => { const st = postStatus(p); const s = p.seen || {};
      if (filter === 'open' && st !== 'available') return false; if (filter === 'accepted' && !isAccepted(st)) return false;
      if (filter === 'declined' && st !== 'declined') return false; if (filter === 'expired' && st !== 'expired') return false;
      if (filter === 'withdrawn' && st !== 'withdrawn' && st !== 'deleted') return false; if (filter === 'unseen' && (s.board_at || s.opened_at)) return false;
      if (filter === 'gaps' && !postMissing(p).some((m) => m.level === 'high')) return false;
      if (q) { const hay = [p.origin, p.destination, p.broker, p.dispatcher, p.carrier, p.board_label, p.source_reference].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
      return true; };
    const search = el('input', { class: 'dpx-search', placeholder: 'Search lane, broker, dispatcher…', value: q, onInput: (e) => { q = e.target.value.trim().toLowerCase(); paintList(); } });
    const listHost = el('div');
    function paintList() { const s2 = base.filter(pass); mount(listHost, s2.length ? s2.map(postCard) : el('div', { class: 'dpx-empty' }, rows.length ? 'Nothing matches this filter.' : 'No dispatcher-posted loads yet. When a dispatcher finds a load on DAT, Truckstop or a broker call and posts it here, it shows up with everything they entered.')); }
    mount(root, [
      el('div', { class: 'dpx-head' }, [
        opts.noTitle ? el('div') : el('div', null, [el('h4', { class: 'dpx-title' }, (opts.title || 'Loads posted by the dispatcher') + (live.length ? ' · ' + live.length : '')),
          el('div', { class: 'cc-sub' }, opts.user ? 'Every load this dispatcher posted on a carrier’s LoadBoot board, with what the carrier did.' : 'Found on a 3rd-party board and posted on this carrier’s LoadBoot board. Only this carrier sees them; “Accepted” opens a dispatcher booking for the RC.')]),
        el('button', { class: 'dpx-btn', onClick: load }, '↻ Refresh'),
      ]),
      live.length ? el('div', { class: 'dpx-stats' }, [
        ['Posted', live.length], ['Open', n((p) => postStatus(p) === 'available')], ['Accepted', n((p) => isAccepted(postStatus(p)))], ['Declined', n((p) => postStatus(p) === 'declined')],
        ['Expired', n((p) => postStatus(p) === 'expired')], ['Not seen', n((p) => !(p.seen && (p.seen.board_at || p.seen.opened_at)))], ['Missing info', n((p) => postMissing(p).some((m) => m.level === 'high'))],
      ].map(([k, c]) => el('div', { class: 'dpx-stat' }, [el('b', null, String(c)), el('span', null, k)]))) : null,
      rows.length ? el('div', { class: 'dpx-bar' }, FILTERS.map(([k, l]) => el('button', { class: 'dpx-chip', 'aria-pressed': filter === k ? 'true' : 'false', onClick: () => { filter = k; paint(); } }, l))
        .concat([search,
          nHidden ? el('button', { class: 'dpx-chip', 'aria-pressed': showHidden ? 'true' : 'false', onClick: () => { showHidden = !showHidden; paint(); } }, 'Show hidden (' + nHidden + ')') : null,
          nDel ? el('button', { class: 'dpx-chip', 'aria-pressed': showDeleted ? 'true' : 'false', onClick: () => { showDeleted = !showDeleted; paint(); } }, 'Show deleted (' + nDel + ')') : null].filter(Boolean))) : null,
      listHost,
    ].filter(Boolean));
    paintList();
  }

  load();
  return root;
}
