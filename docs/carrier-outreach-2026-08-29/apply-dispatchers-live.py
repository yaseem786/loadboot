#!/usr/bin/env python3
"""
apply-dispatchers-live.py — bl_disp_0307
Wires the approved "Dispatch Command — live" redesign into the REAL CC dispatchers view.

MERGE MODE. The parallel session wired the realtime channel into this view first (ccLive /
ccPoll / paintPresence, 29 Aug). This script BUILDS ON that wiring — it never adds a second
dispatchLiveJoin, never touches the 90 s poll, and never removes their sends. What it adds is the
approved premium surface: command bar, 7-cell triage strip, ticking RC rows, live-wire rail.

Idempotent: every edit is guarded, so it re-runs safely on any base.

Usage:  python apply-dispatchers-live.py <path-to-app/command-center/views/dispatchers.js>
Exit 0 = file is at the target state (edits applied, or already present).
Exit 2 = an anchor was not found -> nothing written, fix the anchor and re-run.
"""
import io, sys, os

MARK = 'bl_disp_0307'

# ── the module-scope helpers (CSS + tiny formatters), inserted before renderDispatchers ──
HELPERS = r'''
// ---------------------------------------------------------------- premium live queue (bl_disp_0307)
// The approved "Dispatch Command — live" direction, wired to the REAL queue RPC.
// Theme-following: every surface/border/text colour is a shared token, so this view stays correct
// whether the CC is on light-exec.css or cc-dark.css. Only risk colours are literal.
const DQ_ICON = { rc_uploaded: '📄', availability_posted: '🗓', check_call: '🕒', message: '💬',
  status_change: '🔁', booking_created: '➕', approved: '✅', rejected: '⛔' };
const DQ_LABEL = { rc_uploaded: 'Rate confirmation uploaded', availability_posted: 'Availability posted',
  check_call: 'Check call logged', message: 'New message', status_change: 'Load status changed',
  booking_created: 'New booking', approved: 'Booking approved', rejected: 'Booking rejected' };
function dqInitials(n) { const p = String(n || '').trim().split(/\s+/).filter(Boolean).slice(0, 2); return p.length ? p.map((w) => w[0]).join('').toUpperCase() : '?'; }
function dqColor(k) { let h = 0; const s = String(k || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; const P = ['#7c3aed', '#0e7490', '#b45309', '#0f766e', '#9333ea', '#1d4ed8']; return P[h % P.length]; }
function dqFmt(s) { s = Math.max(0, Math.round(s)); const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); }
function dqAgo(ts) { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? s + 's ago' : (s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'); }
function dqStyle() {
  if (document.getElementById('dq-css')) return;
  const s = document.createElement('style');
  s.id = 'dq-css';
  s.textContent = [
    '.dq-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;margin-bottom:12px;background:var(--lb-surface);border:1px solid var(--lb-border);border-radius:14px}',
    '.dq-clock{font-variant-numeric:tabular-nums;font-weight:800}',
    '.dq-clock small{color:var(--lb-muted);font-weight:700;margin-left:6px;font-size:10px;letter-spacing:.08em}',
    '.dq-live{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.1em;border-radius:999px;padding:4px 11px;color:#0f9d68;background:rgba(22,163,74,.10);border:1px solid rgba(22,163,74,.30)}',
    '.dq-live.off{color:var(--lb-muted);background:rgba(148,163,184,.12);border-color:var(--lb-border)}',
    '.dq-pulse{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:dqpu 1.6s infinite}',
    '@keyframes dqpu{0%{box-shadow:0 0 0 0 rgba(34,197,94,.5)}70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}',
    '.dq-who{display:flex;align-items:center;margin-left:auto}',
    '.dq-av{width:28px;height:28px;border-radius:50%;border:2px solid var(--lb-surface);margin-left:-7px;display:grid;place-items:center;font-size:10.5px;font-weight:800;color:#fff;position:relative}',
    '.dq-av i{position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:50%;border:2px solid var(--lb-surface);background:#22c55e}',
    '.dq-wholbl{font-size:11px;color:var(--lb-muted);margin-left:10px}',
    '.dq-grid{display:grid;grid-template-columns:minmax(0,1fr) 322px;gap:14px;align-items:start}',
    '@media(max-width:1240px){.dq-grid{grid-template-columns:1fr}}',
    '.dq-triage{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid var(--lb-border);border-radius:14px;overflow:hidden;margin-bottom:12px;background:var(--lb-surface)}',
    '@media(max-width:900px){.dq-triage{grid-template-columns:repeat(4,1fr)}}',
    '.dq-t{padding:12px 13px;border-right:1px solid var(--lb-border);cursor:pointer;position:relative;background:none;text-align:left;font:inherit;color:inherit}',
    '.dq-t:last-child{border-right:0}',
    '.dq-t:hover{background:rgba(8,131,247,.06)}',
    '.dq-t .n{font-size:22px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.05}',
    '.dq-t .l{font-size:10.5px;color:var(--lb-muted);margin-top:3px}',
    '.dq-t.hot .n{color:#dc2626}.dq-t.warm .n{color:#b45309}.dq-t.cool .n{color:#0f9d68}',
    '.dq-t.sel::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:3px;border-radius:3px 3px 0 0;background:#0883F7}',
    // flex, not a fixed grid: the CC content column is only ~850px once the sidebar and the
    // live rail take their share, so the row must WRAP instead of crushing the lane to one word.
    '.dq-rc{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--lb-border)}',
    '.dq-rc:last-child{border-bottom:0}',
    '.dq-rc>.dq-c1{flex:1 1 260px;min-width:0}',
    '.dq-rc>.dq-c2{flex:0 0 auto;min-width:104px}',
    '.dq-rc>.dq-c3{flex:0 0 auto;min-width:132px}',
    '.dq-rc>.dq-fl{flex:1 1 150px}',
    '.dq-rc>.dq-act{flex:0 0 auto;margin-left:auto}',
    '@media(max-width:640px){.dq-rc>.dq-act{margin-left:0}}',
    '.dq-lane{font-weight:800;font-size:14px;letter-spacing:-.01em}',
    '.dq-meta{font-size:12px;color:var(--lb-muted);margin-top:2px}',
    '.dq-gross{font-weight:800;font-size:15px;font-variant-numeric:tabular-nums}',
    '.dq-rpm{font-size:11px;color:var(--lb-muted)}',
    '.dq-cd{font-variant-numeric:tabular-nums;font-weight:800;font-size:13px}',
    '.dq-cd.red{color:#dc2626}.dq-cd.amber{color:#b45309}',
    '.dq-cdl{font-size:10px;color:var(--lb-muted);letter-spacing:.05em;text-transform:uppercase}',
    '.dq-age{font-size:11px;color:var(--lb-muted);font-variant-numeric:tabular-nums}',
    '.dq-fl{display:flex;flex-direction:column;gap:5px;align-items:flex-start}',
    '.dq-flag{font-size:10.5px;font-weight:800;border-radius:7px;padding:3px 8px}',
    '.dq-flag.red{color:#dc2626;background:rgba(220,38,38,.10);border:1px solid rgba(220,38,38,.28)}',
    '.dq-flag.amber{color:#b45309;background:rgba(217,119,6,.10);border:1px solid rgba(217,119,6,.28)}',
    '.dq-act{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
    '.dq-feed{max-height:520px;overflow:auto}',
    '.dq-ev{display:flex;gap:10px;align-items:flex-start;padding:9px 2px;border-bottom:1px solid var(--lb-border)}',
    '.dq-ev:last-child{border-bottom:0}',
    '.dq-ev .ic{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-size:13px;flex:none;background:rgba(8,131,247,.10);border:1px solid rgba(8,131,247,.25)}',
    '.dq-ev .t1{font-size:12.5px;font-weight:700}',
    '.dq-ev .t2{font-size:11px;color:var(--lb-muted)}',
    '.dq-ev .when{margin-left:auto;font-size:10.5px;color:var(--lb-muted);white-space:nowrap}',
    '@media(prefers-reduced-motion:reduce){.dq-pulse{animation:none}}',
  ].join('');
  document.head.appendChild(s);
}

'''

# ── build on the parallel session's realtime wiring: command bar + right rail ──
PRESENCE_OLD = "  const presenceBox = el('div', { class: 'cc-sub', style: 'margin:2px 0 8px;min-height:18px' });\n"
PRESENCE_NEW = ("  // bl_disp_0307: this box is now the command bar — ET clock, socket state, presence avatars\n"
                "  const presenceBox = el('div');\n"
                "  const feedBox = el('div');\n"
                "  let dqTimer = null, dqTicks = 0;\n")

HEAD_OLD = """  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Dispatchers', 'The verified dispatch workforce — hiring pipeline, carrier assignment + SOP, rate-confirmation approvals, per-load commission and payout. One dedicated dispatcher per carrier; nothing moves until LoadBoot approves the RC.'),
    presenceBox,
    queueBox,
    body,
  ]));
  load();
"""

HEAD_NEW = """  dqStyle();
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Dispatchers', 'The verified dispatch workforce — hiring pipeline, carrier assignment + SOP, rate-confirmation approvals, per-load commission and payout. One dedicated dispatcher per carrier; nothing moves until LoadBoot approves the RC.'),
    presenceBox,
    el('div', { class: 'dq-grid' }, [el('div', null, [queueBox, body]), el('div', null, [feedBox])]),
  ]));
  load();
"""

# their onEvent is a bare refetch; keep the refetch, add the live-wire entry
EVENT_OLD = "    onEvent: () => { paintQueue(); },\n"
EVENT_NEW = "    onEvent: (e) => { dqFeed(e); paintQueue(); },   // bl_disp_0307 — hint only; paintQueue still refetches\n"

# their text-only presence line becomes the command bar (same function name, same signature)
BAR_OLD = """  function paintPresence(list) {
    const on = (list || []).filter((p) => p.role === 'dispatcher');
    if (!on.length) { mount(presenceBox, ''); return; }
    mount(presenceBox, el('span', null, '🟢 ' + on.length + ' dispatcher' + (on.length > 1 ? 's' : '') + ' online — '
      + on.map((p) => (p.name || 'dispatcher') + (p.tab ? ' (' + p.tab + ')' : '')).join(' · ')));
  }
"""

BAR_NEW = """  function paintPresence(list) {
    if (list) state.presence = Array.isArray(list) ? list : [];
    const on = (state.presence || []).filter((p) => p.role === 'dispatcher');
    const live = !!(typeof ccLive !== 'undefined' && ccLive && ccLive.isLive());
    mount(presenceBox, el('div', { class: 'dq-bar' }, [
      el('div', { style: 'font-weight:800;letter-spacing:-.02em' }, 'Dispatch Command'),
      el('span', { class: 'dq-clock', id: 'dq-clock' }, '—'),
      live ? el('span', { class: 'dq-live' }, [el('span', { class: 'dq-pulse' }), 'LIVE · dispatch:live'])
           : el('span', { class: 'dq-live off', title: 'Realtime is not connected — the queue still refreshes on its poll.' }, 'POLLING · realtime offline'),
      el('div', { class: 'dq-who' }, on.length
        ? on.map((p) => el('span', { class: 'dq-av', style: 'background:' + dqColor(p.user_id), title: (p.name || 'dispatcher') + ' — online' + (p.tab ? ', ' + p.tab + ' tab' : '') }, [dqInitials(p.name), el('i')]))
            .concat([el('span', { class: 'dq-wholbl' }, on.length + ' dispatcher' + (on.length > 1 ? 's' : '') + ' online')])
        : [el('span', { class: 'dq-wholbl' }, live ? 'no dispatcher online right now' : 'presence needs realtime')]),
    ]));
    dqTick();
  }
"""

# the ticking clocks + the live-wire rail, added after their observer is armed
TICK_OLD = "  ccMo.observe(document.body, { childList: true, subtree: true });\n"
TICK_NEW = """  ccMo.observe(document.body, { childList: true, subtree: true });

  // ---- bl_disp_0307: one-second repaint of the ET clock and of every ticking countdown/age,
  // plus the live-wire rail. Display only — it never fetches; ccPoll and ccLive do that.
  paintPresence(null);
  paintFeed();
  dqTimer = setInterval(() => {
    if (!host.isConnected) { clearInterval(dqTimer); return; }
    dqTick();
  }, 1000);
  function dqTick() {
    dqTicks++;
    const c = document.getElementById('dq-clock');
    if (c) c.innerHTML = new Date().toLocaleTimeString('en-US', { timeZone: ET, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + '<small>US EASTERN</small>';
    queueBox.querySelectorAll('[data-cd]').forEach((e) => {
      const v = Number(e.dataset.cd) - 1; e.dataset.cd = String(v);
      e.textContent = (v < 0 ? '-' : '') + dqFmt(Math.abs(v));
      e.classList.toggle('red', v < 4 * 3600);
      e.classList.toggle('amber', v >= 4 * 3600 && v < 12 * 3600);
    });
    queueBox.querySelectorAll('[data-age]').forEach((e) => {
      const v = Number(e.dataset.age) + 1; e.dataset.age = String(v);
      e.textContent = 'waiting ' + dqFmt(v);
    });
    const live = !!(ccLive && ccLive.isLive());
    if (live !== state.liveShown) { state.liveShown = live; paintPresence(null); paintFeed(); }
    else if (dqTicks % 5 === 0 && state.feed.length) paintFeed();
  }
  function dqFeed(e) {
    const t2 = [e.lane, e.carrier, e.booking ? 'booking ' + String(e.booking).slice(0, 8) : ''].filter(Boolean).join(' · ');
    state.feed.unshift({ ic: DQ_ICON[e.type] || '•', t1: DQ_LABEL[e.type] || String(e.type), t2: t2, at: Date.now() });
    state.feed = state.feed.slice(0, 9);
    paintFeed();
  }
  function paintFeed() {
    mount(feedBox, card([
      el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' }, [
        el('div', { style: 'font-weight:800' }, 'Live wire'), el('span', { style: 'flex:1' }),
        el('span', { class: 'cc-sub' }, ccLive && ccLive.isLive() ? 'connected' : 'offline'),
      ]),
      state.feed.length
        ? el('div', { class: 'dq-feed' }, state.feed.map((f) => el('div', { class: 'dq-ev' }, [
            el('span', { class: 'ic' }, f.ic),
            el('span', null, [el('span', { class: 't1' }, f.t1), el('br'), el('span', { class: 't2' }, f.t2 || '')]),
            el('span', { class: 'when' }, dqAgo(f.at)),
          ])))
        : el('div', { class: 'cc-sub' }, 'Nothing yet. An entry appears here the moment a dispatcher uploads an RC, posts availability, logs a check call or sends a message.'),
    ]));
  }
"""

MO_OLD = "if (!document.body.contains(presenceBox)) { clearInterval(ccPoll); try { ccLive.leave(); } catch (_) {} ccMo.disconnect(); }"
MO_NEW = "if (!document.body.contains(presenceBox)) { clearInterval(ccPoll); clearInterval(dqTimer); try { ccLive.leave(); } catch (_) {} ccMo.disconnect(); }"

# ── the queue itself: triage strip + premium RC rows + drill-downs ──
QUEUE_OLD_START = "  // ---------------------------------------------------------------- cross-dispatcher queue (bl_disp_0300)\n"
QUEUE_OLD_END = "  // ---------------------------------------------------------------- RC preview (inline; PDF or image)\n"

QUEUE_NEW = r'''  // ------------------------------------------- cross-dispatcher queue (bl_disp_0300 → bl_disp_0307)
  // Same RPC, same guards; the triage strip is a filter over what the queue already returns.
  // "Stale > 4 h" is derived from moving[].last_touch_min, and the money figures come from the
  // commission list — no new backend.
  async function paintQueue() {
    dqStyle();
    let q; try { q = await ccDispatcherQueue(); } catch (e) { mount(queueBox, ''); return; }
    if (!q || q.error) { mount(queueBox, ''); return; }
    state.queue = q;
    if (state.comm === null) {
      const c = await ccDispatcherCommissionList(null).catch(() => []);
      state.comm = Array.isArray(c) ? c : [];
      paint();                                   // roster rows show "owed" once commissions land
    }
    paintQueueBody();
  }

  function dqSum(status, uid) {
    return (state.comm || []).filter((c) => c.status === status && (!uid || c.dispatcher_user_id === uid))
      .reduce((s, c) => s + Number(c.amount || 0), 0);
  }

  function paintQueueBody() {
    const q = state.queue || {};
    const ap = q.awaiting_approval || [], rc = q.awaiting_rc || [], mv = q.moving || [];
    const ut = (q.unread_threads || []).filter((t) => Number(t.unread) > 0), te = q.trials_ending || [];
    const stale = mv.filter((b) => Number(b.last_touch_min) > 240);
    const unread = ut.reduce((s, t) => s + Number(t.unread || 0), 0);
    const toPay = dqSum('approved'), toApprove = dqSum('draft');
    const byUser = (uid, bid) => { const x = state.rows.find((r) => r.user_id === uid); if (x) open360(x, bid || null); };
    const decideQuick = async (b) => { const ok = await approveFlow(b); if (ok) { state.comm = null; paintQueue(); } };

    const cells = [
      ['rc', String(ap.length), 'RC to approve', ap.length ? 'hot' : 'cool'],
      ['awaiting', String(rc.length), 'Awaiting RC', rc.length ? 'warm' : 'cool'],
      ['moving', String(mv.length), 'Moving', 'cool'],
      ['stale', String(stale.length), 'Stale > 4 h', stale.length ? 'hot' : 'cool'],
      ['unread', String(unread), 'Unread', unread ? 'warm' : 'cool'],
      ['pay', toPay ? money(toPay) : String(Number(q.commission_to_pay || 0)), 'To pay out', toPay ? 'hot' : 'cool'],
      ['trials', String(te.length), 'Trial ends ≤3 d', te.length ? 'warm' : 'cool'],
    ];
    const strip = el('div', { class: 'dq-triage' }, cells.map(([k, n, l, tone]) => el('button', {
      class: 'dq-t ' + tone + (state.dq === k ? ' sel' : ''), type: 'button',
      onClick: () => { state.dq = k; paintQueueBody(); },
    }, [el('div', { class: 'n' }, n), el('div', { class: 'l' }, l)])));

    // ---- the premium RC row: lane · money · ticking clocks · risk flags · actions
    const rcRow = (b) => {
      const pk = b.pickup_at ? Math.round((new Date(b.pickup_at).getTime() - Date.now()) / 1000) : null;
      const age = Math.round(Number(b.age_min || 0) * 60);
      const miles = Number(b.miles || 0), gross = Number(b.gross || 0);
      const flags = [];
      if (b.below_min) flags.push(['red', 'BELOW FLOOR — NEEDS WRITTEN REASON']);
      if (!b.rc_doc_path) flags.push(['amber', 'NO RC FILE YET']);
      if (!b.driver_set) flags.push(['amber', 'NO DRIVER ON TRUCK']);
      if (Number(b.age_min) > 60) flags.push(['red', 'SLA ' + mins(b.age_min)]);
      if (b.hours_to_pickup != null && Number(b.hours_to_pickup) < 6) flags.push(['red', 'PICKUP IN ' + b.hours_to_pickup + ' H']);
      return el('div', { class: 'dq-rc' }, [
        el('div', { class: 'dq-c1' }, [
          el('div', { class: 'dq-lane' }, b.lane || ((b.origin || '') + ' → ' + (b.destination || ''))),
          el('div', { class: 'dq-meta' }, (b.dispatcher || '—') + ' → ' + (b.carrier || '—') + (b.broker ? ' · ' + b.broker : '') + ' · PU ' + et(b.pickup_at)),
        ]),
        el('div', { class: 'dq-c2' }, [
          el('div', { class: 'dq-gross' }, money(gross)),
          miles > 0 ? el('div', { class: 'dq-rpm' }, '$' + (gross / miles).toFixed(2) + ' /mi · ' + miles + ' mi') : '',
        ]),
        el('div', { class: 'dq-c3' }, [
          pk === null ? el('div', { class: 'dq-cd' }, '—') : el('div', { class: 'dq-cd', 'data-cd': String(pk) }, (pk < 0 ? '-' : '') + dqFmt(Math.abs(pk))),
          el('div', { class: 'dq-cdl' }, pk !== null && pk < 0 ? 'pickup passed' : 'to pickup'),
          el('div', { class: 'dq-age', 'data-age': String(age) }, 'waiting ' + dqFmt(age)),
        ]),
        el('div', { class: 'dq-fl' }, flags.length ? flags.map(([t, l]) => el('span', { class: 'dq-flag ' + t }, l)) : [el('span', { class: 'cc-sub' }, 'clean')]),
        el('div', { class: 'dq-act' }, [
          b.rc_doc_path ? el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => previewRc(b) }, 'View RC') : '',
          el('button', {
            class: 'lb-btn lb-btn-primary', disabled: !b.rc_doc_path ? '' : undefined,
            title: b.rc_doc_path ? 'Read the RC first' : 'Approve only from the RC — never from the summary',
            onClick: () => decideQuick(b),
          }, 'Approve'),
          el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => byUser(b.dispatcher_user_id, b.id) }, 'Open'),
        ]),
      ]);
    };

    const plain = (b, tail) => el('div', { class: 'dq-rc' }, [
      el('div', { class: 'dq-c1' }, [
        el('div', { class: 'dq-lane' }, b.lane || ''),
        el('div', { class: 'dq-meta' }, (b.dispatcher || '—') + ' → ' + (b.carrier || '—') + (b.broker ? ' · ' + b.broker : '') + ' · ' + tail),
      ]),
      el('div', { class: 'dq-act' }, [el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => byUser(b.dispatcher_user_id, b.id) }, 'Open')]),
    ]);

    let head = '', list = [];
    if (state.dq === 'rc') {
      head = 'Rate confirmations waiting — approve from the RC, never from the summary';
      list = ap.map(rcRow);
    } else if (state.dq === 'awaiting') {
      head = 'Booked, RC not in yet — the dispatcher still owes us the paperwork';
      list = rc.map((b) => plain(b, money(b.gross) + ' · PU ' + et(b.pickup_at) + ' · waiting ' + mins(b.age_min)));
    } else if (state.dq === 'moving' || state.dq === 'stale') {
      const src = state.dq === 'stale' ? stale : mv;
      head = state.dq === 'stale' ? 'No check call in over 4 hours — chase the dispatcher' : 'On the road';
      list = src.map((b) => plain(b, b.status + ' · last touch ' + mins(b.last_touch_min) + (Number(b.last_touch_min) > 240 ? ' ⚠' : '') + (b.delivery_at ? ' · DEL ' + et(b.delivery_at) : '')));
    } else if (state.dq === 'unread') {
      head = 'Carrier threads with unread messages';
      list = ut.map((t) => el('div', { class: 'dq-rc' }, [
        el('div', { class: 'dq-c1' }, [el('div', { class: 'dq-lane' }, t.carrier || '—'), el('div', { class: 'dq-meta' }, t.unread + ' unread')]),
        el('div', { class: 'dq-act' }, [el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => byUser(t.dispatcher_user_id) }, 'Open')]),
      ]));
    } else if (state.dq === 'pay') {
      head = 'Commission — paid per load, through the payout dialog on the dispatcher’s 360';
      list = [el('div', { class: 'cc-sub', style: 'padding:10px 0' },
        Number(q.commission_to_approve || 0) + ' to approve (' + money(toApprove) + ') · ' +
        Number(q.commission_to_pay || 0) + ' approved and unpaid (' + money(toPay) + '). Open a dispatcher below to approve or record a payment.')];
    } else if (state.dq === 'trials') {
      head = 'Trials ending — decide from the KPIs: verify or end';
      list = te.map((t) => el('div', { class: 'dq-rc' }, [
        el('div', { class: 'dq-c1' }, [el('div', { class: 'dq-lane' }, t.name || '—'), el('div', { class: 'dq-meta' }, 'trial ends ' + t.trial_end + ' · ' + t.days_left + ' d left')]),
        el('div', { class: 'dq-act' }, [el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => byUser(t.user_id) }, 'Open')]),
      ]));
    }

    mount(queueBox, el('div', null, [
      strip,
      card([
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px' }, [
          el('div', { style: 'font-weight:800' }, head || 'Dispatch queue'),
          el('span', { style: 'flex:1' }),
          el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => { state.comm = null; paintQueue(); } }, [icon('refresh', 14), ' Refresh']),
        ]),
        list.length ? el('div', null, list) : el('div', { class: 'cc-sub', style: 'padding:8px 0' }, 'Nothing here — clear.'),
      ]),
    ]));
    dqTick();
  }

'''

EDITS_DONE = []


def die(msg):
    print('ANCHOR NOT FOUND: ' + msg)
    sys.exit(2)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    src = io.open(path, encoding='utf-8', newline='').read()
    if '\r\n' in src:
        die('file has CRLF line endings — expected LF; convert first')
    out = src

    if "from '../../shared/dispatch-live.js'" not in out:
        die("the realtime import is missing — this script MERGES onto the parallel session's "
            "ccLive wiring and must not add a second dispatchLiveJoin. Re-stage the current file.")
    if 'const ccLive = dispatchLiveJoin(' not in out:
        die('ccLive join (the parallel session\'s realtime wiring) — see above')

    # 1 ── module-scope helpers (scoped CSS + formatters)
    if 'function dqStyle(' not in out:
        a = 'export function renderDispatchers(host) {\n'
        if a not in out:
            die('renderDispatchers declaration')
        out = out.replace(a, HELPERS + a, 1)
        EDITS_DONE.append('1 helpers + scoped css')

    # 2 ── state fields
    a = "  const state = { q: '', st: 'all', rows: [], carriers: [], queue: null };\n"
    if a in out:
        out = out.replace(a, "  const state = { q: '', st: 'all', rows: [], carriers: [], queue: null, dq: 'rc', presence: [], feed: [], comm: null, liveShown: false };\n", 1)
        EDITS_DONE.append('2 state fields')
    elif "dq: 'rc'" not in out:
        die('state declaration')

    # 3 ── the presence box becomes the command bar; add the rail + timer handle
    if 'const feedBox' not in out:
        if PRESENCE_OLD not in out:
            die('presenceBox declaration')
        out = out.replace(PRESENCE_OLD, PRESENCE_NEW, 1)
        EDITS_DONE.append('3 command-bar container + rail')

    # 4 ── two-column layout
    if "class: 'dq-grid'" not in out:
        if HEAD_OLD not in out:
            die('renderDispatchers mount block')
        out = out.replace(HEAD_OLD, HEAD_NEW, 1)
        EDITS_DONE.append('4 grid layout')

    # 5 ── their onEvent keeps refetching; the event also lands in the live wire
    if 'dqFeed(e); paintQueue()' not in out:
        if EVENT_OLD not in out:
            die('ccLive onEvent line')
        out = out.replace(EVENT_OLD, EVENT_NEW, 1)
        EDITS_DONE.append('5 live-wire entry on each event')

    # 6 ── the text presence line becomes the command bar
    if "class: 'dq-bar'" not in out:
        if BAR_OLD not in out:
            die('paintPresence body')
        out = out.replace(BAR_OLD, BAR_NEW, 1)
        EDITS_DONE.append('6 command bar')

    # 7 ── stop the display timer with the rest (BEFORE the tick block is inserted)
    if 'clearInterval(ccPoll); clearInterval(dqTimer)' not in out:
        if MO_OLD not in out:
            die('ccMo cleanup line')
        out = out.replace(MO_OLD, MO_NEW, 1)
        EDITS_DONE.append('7 clear the display timer on unmount')

    # 8 ── ticking clocks + live-wire rail
    if 'function dqTick(' not in out:
        if TICK_OLD not in out:
            die('ccMo.observe line')
        out = out.replace(TICK_OLD, TICK_NEW, 1)
        EDITS_DONE.append('8 ticking clocks + live wire')

    # 9 ── the queue itself
    if 'paintQueueBody' not in out:
        i = out.find(QUEUE_OLD_START)
        j = out.find(QUEUE_OLD_END)
        if i < 0 or j < 0 or j <= i:
            die('paintQueue block boundaries')
        out = out[:i] + QUEUE_NEW + out[j:]
        EDITS_DONE.append('9 triage strip + premium rows')

    # 10 ── roster row: what this dispatcher is owed
    a = "    const tr = q ? (q.trials_ending || []).find((t) => t.user_id === uid) : null;\n"
    if a in out and "dqSum('approved', uid)" not in out:
        out = out.replace(a, a + "    const owed = dqSum('approved', uid);\n", 1)
        b = "tr ? el('span', { class: 'cc-pill cc-pill-amber' }, 'trial ends in ' + tr.days_left + ' d') : '',\n"
        if b not in out:
            die('roster pill line')
        out = out.replace(b, b + "      owed ? el('span', { class: 'cc-pill cc-pill-amber' }, money(owed) + ' to pay') : '',\n", 1)
        EDITS_DONE.append('10 owed pill on roster row')

    if out == src:
        print('already at target state — nothing to write (' + MARK + ')')
        return
    with io.open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('applied ' + str(len(EDITS_DONE)) + ' edit(s): ' + '; '.join(EDITS_DONE))
    print('bytes %d -> %d' % (len(src.encode('utf-8')), len(out.encode('utf-8'))))


main()
