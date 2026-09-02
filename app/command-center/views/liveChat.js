// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// liveChat.js — CC Live chat: a three-pane agent console (inbox · conversation · context).
//
// Rebuilt 2026-09-02 against the bl_lc_0312 backend contract. What changed and why:
//
//   * The old screen was a two-column page that scrolled as one document. At 30+ open chats
//     the reply box slid off the bottom of the viewport and agents lost the thing they were
//     there to do. The console now fills the viewport and each pane scrolls on its own.
//   * "Waiting 4m" was a static string rendered once and then quietly wrong for the next six
//     seconds of polling. Every timer is now a live text node driven by ONE 1s interval.
//   * The whole timeline was re-rendered on every poll, which killed scroll position and
//     any text selection mid-read. Messages are now diffed by id and appended.
//   * Presence could read "LIVE" while the tab had been asleep for an hour. A 45s heartbeat
//     keeps last_seen_at fresh, and a stale heartbeat shows honestly as "Auto-away".
//   * bot_paused was invisible, so an agent could type a reply while the AI was also
//     answering. The composer now says so before you send, and "Hand back to AI" exists.
//   * Account context (verification, compliance, trucks, calls, CSAT) lived nowhere. It is
//     now a right pane, so nobody has to open Carrier 360 in another tab mid-conversation.
//
// Every button here maps to exactly one RPC in app/shared/api.js. No dead controls.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, searchBox, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { ccLcList, ccLcGet, ccLcReply, ccLcSetStatus, ccLcStats, ccLcMisses, ccLcTeach,
         ccLcMissDismiss, ccLcAssign, ccLcCannedList, ccLcCannedSave, ccLcCannedDelete,
         ccRetellCallback, ccLcCalls, ccLcPresenceGet, ccLcPresenceSet,
         ccLcHeartbeat, ccLcTyping, ccLcBotResume } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { richText, parseDirectives } from '../../shared/ui/chatText.js';

const ORIGIN_ICON = { website: '🌐', carrier: '🚚', partner: '🏢', agent: '🤝' };

// Filter values are passed straight through to cc_lc_list(p_status, …).
const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'human', label: '🙋 Needs human', count: 'needs_human' },
  { value: 'ai', label: '⚡ AI' },
  { value: 'unread', label: 'Unread', count: 'unread' },
  { value: 'mine', label: 'Mine' },
  { value: 'leads', label: '🎯 Leads' },
  { value: 'rated', label: '★ Rated' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const LIST_MS = 5000;      // inbox refresh
const CONV_MS = 2500;      // open conversation refresh
const BEAT_MS = 45000;     // presence heartbeat (contract: keeps last_seen_at fresh)
const TYPE_MS = 3000;      // cc_lc_typing throttle (contract: at most every 3s)

/* ------------------------------------------------------------------ helpers */

function identity(c) {
  if (!c.user_id) {
    const vr = c.visitor_role ? (' · ' + c.visitor_role + ' lead') : '';
    return { label: (c.name || 'Anonymous visitor'), pill: '🌐 Visitor' + vr, tone: c.visitor_role ? 'blue' : 'gray', verified: false };
  }
  const role = (c.role || 'user');
  const ver = (c.profile_status || '').toLowerCase();
  const verified = ['verified', 'approved', 'active'].indexOf(ver) >= 0;
  return {
    label: c.company || c.name || c.email || 'Portal user',
    pill: (verified ? '✅ ' : '⏳ ') + role.charAt(0).toUpperCase() + role.slice(1) + (verified ? ' · verified' : (ver ? ' · ' + ver : '')),
    tone: verified ? 'green' : 'amber',
    verified,
  };
}

function initials(s) {
  const parts = String(s || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p.charAt(0).toUpperCase()).join('') || '?';
}

// Waiting-time wording is the same everywhere, so the tone thresholds are too:
// >10m red, >3m amber. Those are the numbers the SLA email uses.
function waitText(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}
function waitTone(secs) {
  const m = (secs || 0) / 60;
  return m >= 10 ? 'red' : m >= 3 ? 'amber' : 'green';
}
function mmss(secs) {
  if (secs == null) return '—';
  const m = Math.round(secs / 60);
  return m < 1 ? '<1m' : m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function ts(v) { const t = Date.parse(v || ''); return isNaN(t) ? null : t; }

function pill(text, tone, extra) {
  return el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') + ' lcx-pill' + (extra ? ' ' + extra : '') }, text);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.06;
    o.start(); o.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
  } catch (e) { /* sound is a nicety, never a failure */ }
}

function notify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body: body || '', tag: 'lb-livechat' });
    n.onclick = () => { try { window.focus(); n.close(); } catch (e) { /* noop */ } };
  } catch (e) { /* noop */ }
}

// `[[sys]]` is new in this contract and parseDirectives() does not know it, so it is
// stripped here rather than in shared code the widget also uses.
function splitSys(body) {
  const raw = String(body == null ? '' : body);
  const m = /^\s*\[\[sys\]\]\s*/i.exec(raw);
  return m ? { sys: true, rest: raw.slice(m[0].length) } : { sys: false, rest: raw };
}

function dayKey(v) { const t = ts(v); return t == null ? '' : new Date(t).toDateString(); }
function dayLabel(v) {
  const t = ts(v); if (t == null) return '';
  const d = new Date(t); const now = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, now)) return 'Today';
  const y = new Date(now.getTime() - 86400000);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function clock(v) {
  const t = ts(v); if (t == null) return '';
  try { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  catch (e) { return fmtDateTime(v); }
}

/* ------------------------------------------------------------------- view */

export function renderLiveChat(host) {
  // One state object so a refresh never loses the filter, the selection or the scroll.
  const S = {
    filter: 'open', search: '', activeId: null,
    rows: [], stats: null, presence: null, canned: [],
    conv: null,               // last cc_lc_get payload for the active conversation
    seenIds: new Set(),       // message ids already in the DOM (diffing)
    lastDay: '',              // day separator bookkeeping for appends
    needsHuman: new Set(),    // conversation ids currently in the human queue
    lastMsgAt: {},            // id -> last_msg_at, for "message landed in my chat" alerts
    ctxOpen: true,
    alerted: false,           // has the first stats load happened (no beep on page 1)
    lastTyping: 0,
    misses: 0,
  };

  const timers = [];
  // Two ticker buckets, run by ONE 1s interval. They are kept apart because the KPI strip
  // and the inbox list re-render on different clocks and each must drop only its own.
  let kpiTickers = [];
  let listTickers = [];
  let drawerRef = null;

  /* --------------------------------------------------- skeleton (built once) */

  const presenceHost = el('div', { class: 'lcx-presence' });
  const kpiHost = el('div', { class: 'lcx-kpis' });
  const chipHost = el('div', { class: 'lcx-chips' });
  const listHost = el('div', { class: 'lcx-list' });
  const inboxTools = el('div', { class: 'lcx-inbox-tools' });

  const convHead = el('div', { class: 'lcx-conv-head' });
  const msgsEl = el('div', { class: 'lcx-msgs' });
  const typingEl = el('div', { class: 'lcx-typing', style: 'display:none' }, [
    el('span', { class: 'lcx-dot' }), el('span', { class: 'lcx-dot' }), el('span', { class: 'lcx-dot' }),
    el('span', { class: 'lcx-typing-t' }, 'Visitor is typing…'),
  ]);
  const aiNote = el('div', { class: 'lcx-ainote', style: 'display:none' },
    'The AI is still answering here — sending a reply takes over automatically.');
  const closedNote = el('div', { class: 'lcx-closednote', style: 'display:none' }, 'Reopen to reply.');
  const cannedPop = el('div', { class: 'lcx-canned', style: 'display:none' });
  const input = el('textarea', { class: 'cc-input lcx-input', rows: '2',
    placeholder: 'Reply as LoadBoot team…  (Enter to send · Shift+Enter newline · / for saved replies)' });
  const sendBtn = el('button', { class: 'lb-btn lcx-send' }, 'Send');
  const composer = el('div', { class: 'lcx-composer' }, [
    aiNote, closedNote, cannedPop,
    el('div', { class: 'lcx-composer-row' }, [
      el('button', { class: 'lb-btn lb-btn-ghost lcx-iconbtn', title: 'Saved replies (or type /)',
        onclick: () => toggleCanned() }, '⚡'),
      el('div', { class: 'lcx-inputwrap' }, input),
      sendBtn,
    ]),
  ]);
  const convEmpty = el('div', { class: 'lcx-empty' }, [
    el('div', { class: 'lcx-empty-ico' }, '💬'),
    el('b', null, 'Pick a conversation'),
    el('p', null, 'Needs-human chats sort first, longest wait on top. Everything else the AI is already holding.'),
  ]);
  const convLive = el('div', { class: 'lcx-conv-live', style: 'display:none' }, [convHead, msgsEl, typingEl, composer]);
  const centerPane = el('div', { class: 'lcx-center' }, [convEmpty, convLive]);

  const ctxHost = el('div', { class: 'lcx-ctx-body' });
  const ctxPane = el('div', { class: 'lcx-ctx' }, [
    el('div', { class: 'lcx-ctx-head' }, [
      el('b', null, 'Details'),
      el('button', { class: 'lcx-collapse', title: 'Collapse details',
        onclick: () => { S.ctxOpen = !S.ctxOpen; root.classList.toggle('lcx-ctx-closed', !S.ctxOpen); } }, '⟩'),
    ]),
    ctxHost,
  ]);

  const leftPane = el('div', { class: 'lcx-inbox' }, [
    el('div', { class: 'lcx-inbox-head' }, [presenceHost, kpiHost, inboxTools, chipHost]),
    listHost,
  ]);

  const consoleEl = el('div', { class: 'lcx-console' }, [leftPane, centerPane, ctxPane]);
  const root = el('div', { class: 'lcx-root' }, [
    sectionHead('Live chat', 'One console: the human queue with live SLA timers, the conversation, and everything known about who is on the other end.'),
    consoleEl,
  ]);
  mount(host, root);

  // Search + drawers live above the filter chips and are built once, so typing in the
  // search box is never interrupted by the 5-second list refresh.
  mount(inboxTools, [
    searchBox('Search name, email, message text…', (v) => { S.search = v; loadList(); }),
    el('div', { class: 'lcx-toolrow' }, [
      el('button', { class: 'lb-btn lb-btn-ghost lcx-tinybtn', onclick: openTraining, id: 'lcx-train-btn' }, '🧠 Train the AI'),
      el('button', { class: 'lb-btn lb-btn-ghost lcx-tinybtn', onclick: openCalls }, '📞 Recent calls'),
      notifBtn(),
    ]),
  ]);

  function notifBtn() {
    if (typeof Notification === 'undefined' || Notification.permission === 'granted') return el('span');
    // Permission is requested on a real click only — asking on load gets denied forever.
    const b = el('button', { class: 'lb-btn lb-btn-ghost lcx-tinybtn', onclick: async () => {
      try { const p = await Notification.requestPermission(); if (p === 'granted') { b.style.display = 'none'; toast('Desktop alerts on ✓'); } }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, '🔔 Enable desktop alerts');
    return b;
  }

  /* ------------------------------------------------------------ lifecycle */

  loadPresence(); loadStats(); loadList(); loadCanned(); loadMisses();
  timers.push(setInterval(() => { loadStats(); loadList(true); }, LIST_MS));
  timers.push(setInterval(() => { if (S.activeId) loadConv(S.activeId, true); }, CONV_MS));
  timers.push(setInterval(heartbeat, BEAT_MS));
  timers.push(setInterval(() => {
    const all = kpiTickers.concat(listTickers);
    for (let i = 0; i < all.length; i++) { try { all[i](); } catch (e) { /* noop */ } }
  }, 1000));
  heartbeat();

  // A tab that was asleep has stale everything — catch up the moment it comes back.
  const onVis = () => { if (document.visibilityState === 'visible') { heartbeat(); loadStats(); loadList(true); if (S.activeId) loadConv(S.activeId, true); } };
  document.addEventListener('visibilitychange', onVis);

  const onKey = (e) => {
    const t = e.target || {};
    const tag = (t.tagName || '').toLowerCase();
    if (e.key === 'Escape') { if (drawerRef && drawerRef.close) { drawerRef.close(); drawerRef = null; } return; }
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (!S.rows.length) return;
    e.preventDefault();
    const i = S.rows.findIndex(r => r.id === S.activeId);
    const next = e.key === 'ArrowDown' ? Math.min(S.rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    select(S.rows[next].id);
  };
  document.addEventListener('keydown', onKey);

  // Same unmount detection the previous view used: the router swaps #cc-content's child,
  // so the moment our root leaves the document we tear everything down.
  const obs = new MutationObserver(() => {
    if (document.body.contains(root)) return;
    timers.forEach(clearInterval);
    obs.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey);
    document.title = document.title.replace(/^\(\d+\) /, '');
  });
  obs.observe(document.body, { childList: true, subtree: true });

  async function heartbeat() {
    try {
      const p = await ccLcHeartbeat();
      if (p && !p.error) { S.presence = p; paintPresence(); }
    } catch (e) { /* a missed beat just means the next one matters more */ }
  }

  /* -------------------------------------------------------------- presence */

  async function loadPresence() {
    let p; try { p = await ccLcPresenceGet(); } catch (e) { return; }
    if (!p || p.error) return;
    S.presence = p; paintPresence(true);
  }

  function paintPresence(rebuild) {
    const p = S.presence; if (!p) return;
    // "available but no recent heartbeat" is the honest amber case: the toggle says on,
    // the visitor widget already treats us as offline.
    const stale = !!p.available && !p.online;
    if (!rebuild && presenceHost.firstChild && presenceHost.dataset.state === String(p.available) + stale) return;
    presenceHost.dataset.state = String(p.available) + stale;

    const nameIn = el('input', { class: 'cc-input lcx-mini', placeholder: 'Your name', value: p.staff_name || '' });
    const desigIn = el('input', { class: 'cc-input lcx-mini', placeholder: 'Designation', value: p.designation || 'Carrier Success Manager' });
    const emailIn = el('input', { class: 'cc-input lcx-mini lcx-alertmail', placeholder: 'hello@loadboot.com', value: p.alert_email || '' });

    const save = async (available) => {
      try {
        const r = await ccLcPresenceSet(available, nameIn.value.trim(), desigIn.value.trim(), emailIn.value.trim() || null);
        if (r && r.error) throw new Error(r.error);
        toast(available ? '🟢 Tum LIVE ho — naye handoffs tumhare naam ke saath aayenge' : 'Ab offline — AI email ka wada karegi');
        loadPresence();
      } catch (e) { toast(humanizeError(e), 'error'); }
    };
    emailIn.addEventListener('change', () => save(!!p.available));
    nameIn.addEventListener('change', () => save(!!p.available));
    desigIn.addEventListener('change', () => save(!!p.available));

    const toggle = el('button', {
      class: 'lcx-toggle' + (p.available ? ' is-on' : '') + (stale ? ' is-stale' : ''),
      title: stale ? 'Toggled on, but no heartbeat in the last 3 minutes' : (p.available ? 'You are shown as online' : 'You are shown as offline'),
      onclick: (ev) => { ev.currentTarget.disabled = true; save(!p.available); },
    }, [el('span', { class: 'lcx-knob' })]);

    mount(presenceHost, el('div', { class: 'lcx-pcard' + (p.available ? ' is-on' : '') }, [
      el('div', { class: 'lcx-prow' }, [
        el('span', { class: 'lcx-avatar' }, initials(p.staff_name)),
        el('div', { class: 'lcx-pwho' }, [
          el('b', null, p.staff_name || 'Set your name'),
          el('span', null, p.designation || 'Carrier Success Manager'),
        ]),
        el('div', { class: 'lcx-pstate' }, [
          toggle,
          el('span', { class: 'lcx-pstate-t' + (stale ? ' is-amber' : p.available ? ' is-green' : '') },
            stale ? 'Auto-away' : p.available ? 'Online' : 'Away'),
        ]),
      ]),
      stale ? el('div', { class: 'lcx-pwarn' }, 'No heartbeat for 3 minutes — visitors are being told the team is offline. Click anywhere to refresh.') : null,
      el('div', { class: 'lcx-pfields' }, [nameIn, desigIn]),
      el('label', { class: 'lcx-palert' }, [el('span', null, 'Alerts to:'), emailIn]),
    ].filter(Boolean)));
  }

  /* ----------------------------------------------------------------- stats */

  function kpi(label, value, sub, tone) {
    const val = el('div', { class: 'lcx-kpi-v' }, value);
    return { node: el('div', { class: 'lcx-kpi lcx-t-' + (tone || 'gray') }, [val, el('div', { class: 'lcx-kpi-l' }, label), sub ? el('div', { class: 'lcx-kpi-s' }, sub) : null].filter(Boolean)), val };
  }

  async function loadStats() {
    let s; try { s = await ccLcStats(); } catch (e) { return; }
    if (!s || s.error) return;
    S.stats = s;

    const nh = Number(s.needs_human || 0);
    document.title = (nh > 0 ? '(' + nh + ') ' : '') + document.title.replace(/^\(\d+\) /, '');

    // KPI tiles are rebuilt wholesale (no inputs inside), but the oldest-wait tile owns a
    // live text node so it does not lie for five seconds at a time.
    const oldest = s.oldest_wait_secs == null ? null : Number(s.oldest_wait_secs);
    const base = oldest == null ? null : Date.now() - oldest * 1000;
    const med = s.median_first_reply_secs_7d;
    const ans = s.handoffs_answered_15m_pct_7d;
    const csat = s.csat_avg_30d;
    const ai = s.ai_share_7d;

    const tiles = [];
    tiles.push(kpi('Needs human', String(nh), nh > 0 ? (s.unanswered_handoffs || 0) + ' never answered' : 'queue clear', nh > 0 ? 'red' : 'green'));
    const ow = kpi('Oldest wait', oldest == null ? '—' : waitText(oldest), nh > 0 ? 'ticking' : 'nobody waiting', oldest == null ? 'gray' : waitTone(oldest));
    tiles.push(ow);
    tiles.push(kpi('Median 1st reply', med == null ? '—' : mmss(med), 'last 7 days', med == null ? 'gray' : med > 900 ? 'red' : med > 300 ? 'amber' : 'green'));
    tiles.push(kpi('Answered <15m', ans == null ? '—' : Math.round(ans) + '%', (s.handoffs_7d || 0) + ' handoffs · 7d', ans == null ? 'gray' : ans < 80 ? 'red' : ans < 95 ? 'amber' : 'green'));
    tiles.push(kpi('CSAT 30d', csat == null ? '—' : (Math.round(csat * 10) / 10) + ' ★', (s.csat_n_30d || 0) + ' ratings', csat == null ? 'gray' : csat < 4 ? 'amber' : 'green'));
    tiles.push(kpi('AI-handled', ai == null ? '—' : Math.round(ai) + '%', (s.convs_7d || 0) + ' chats · 7d', ai == null ? 'gray' : 'blue'));

    mount(kpiHost, tiles.map(t => t.node));

    // The old tiles are gone from the DOM, so their tickers must go with them.
    kpiTickers = [];
    if (base != null && nh > 0) {
      kpiTickers.push(() => {
        const secs = Math.floor((Date.now() - base) / 1000);
        ow.val.textContent = waitText(secs);
        ow.node.className = 'lcx-kpi lcx-t-' + waitTone(secs);
      });
    }
    paintChips();
  }

  function paintChips() {
    const s = S.stats || {};
    mount(chipHost, FILTERS.map(f => {
      const n = f.count ? Number(s[f.count] || 0) : null;
      return el('button', {
        class: 'lcx-chip' + (S.filter === f.value ? ' is-on' : ''),
        onclick: () => { S.filter = f.value; paintChips(); loadList(); },
      }, [el('span', null, f.label), (n ? el('i', { class: 'lcx-chip-n' }, String(n)) : null)].filter(Boolean));
    }));
  }

  /* ------------------------------------------------------------------ list */

  function skeleton(n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(el('div', { class: 'lcx-sk' }, [
        el('div', { class: 'lcx-sk-l lcx-sk-a' }), el('div', { class: 'lcx-sk-l lcx-sk-b' }), el('div', { class: 'lcx-sk-l lcx-sk-c' }),
      ]));
    }
    return el('div', null, rows);
  }

  async function loadList(silent) {
    if (!silent) mount(listHost, skeleton(6));
    let rows;
    try { rows = await ccLcList(S.filter, S.search || null); }
    catch (e) { if (!silent) mount(listHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!rows || rows.error) { if (!silent) mount(listHost, el('div', { class: 'lb-state lb-error' }, (rows && rows.error) || 'Failed to load')); return; }
    S.rows = rows;
    alerts(rows);
    paintList(rows);
  }

  // Sound + desktop notification fire on TRANSITIONS only: a conversation that has just
  // entered the human queue, or a visitor message landing in a chat assigned to me.
  function alerts(rows) {
    const nowHuman = new Set();
    let fresh = null, mine = null;
    rows.forEach(c => {
      const needs = c.status === 'open' && (c.mode === 'human' || c.bot_paused) && !c.first_staff_reply_at;
      if (needs) {
        nowHuman.add(c.id);
        if (S.alerted && !S.needsHuman.has(c.id)) fresh = c;
      }
      const prev = S.lastMsgAt[c.id];
      if (S.alerted && c.assigned_me && prev && c.last_msg_at && c.last_msg_at !== prev && (c.staff_unread || 0) > 0) mine = c;
      S.lastMsgAt[c.id] = c.last_msg_at;
    });
    S.needsHuman = nowHuman;
    if (fresh) {
      beep();
      const who = identity(fresh).label;
      toast('🙋 ' + who + ' needs a human');
      notify('Someone needs a human', who + (fresh.last_msg ? ' — ' + fresh.last_msg.slice(0, 120) : ''));
      fresh._pulse = true;
    } else if (mine) {
      beep();
      notify('New message in your chat', identity(mine).label + (mine.last_msg ? ' — ' + mine.last_msg.slice(0, 120) : ''));
    }
    S.alerted = true;
  }

  function paintList(rows) {
    listTickers = [];
    if (!rows.length) {
      mount(listHost, el('div', { class: 'lcx-empty lcx-empty-sm' }, [
        el('div', { class: 'lcx-empty-ico' }, S.search ? '🔍' : '📭'),
        el('b', null, S.search ? 'No match' : 'Nothing here'),
        el('p', null, S.search ? 'Try a company name, an email, or words from a message.' : 'When someone chats on the website or in a portal, the conversation lands here instantly.'),
      ]));
      return;
    }
    mount(listHost, rows.map(c => {
      const idn = identity(c);
      const waitNode = el('span', { class: 'cc-pill lcx-wait' });
      let base = null;
      if (c.waiting_secs != null) {
        base = Date.now() - Number(c.waiting_secs) * 1000;
        const paint = () => {
          const secs = Math.floor((Date.now() - base) / 1000);
          waitNode.textContent = '⏱ ' + waitText(secs);
          waitNode.className = 'cc-pill lcx-wait cc-pill-' + waitTone(secs);
        };
        paint(); listTickers.push(paint);
      }

      const dots = [];
      if (c.visitor_online) dots.push(el('span', { class: 'lcx-d lcx-d-on', title: 'Visitor is on the page right now' }, '🟢'));
      if (c.visitor_typing) dots.push(el('span', { class: 'lcx-d', title: 'Visitor is typing' }, '✍️'));
      dots.push(el('span', { class: 'lcx-d', title: c.bot_paused ? 'A human has taken over' : 'The AI is answering' }, c.bot_paused ? '🧑' : '🤖'));
      if (c.csat != null) dots.push(el('span', { class: 'lcx-d', title: 'Rated ' + c.csat + ' of 5' }, '★' + c.csat));
      if (c.lang === 'es') dots.push(el('span', { class: 'lcx-d', title: 'Spanish' }, '🇪🇸'));

      const row = el('div', {
        class: 'lcx-row' + (c.id === S.activeId ? ' is-sel' : '') + (c._pulse ? ' lcx-pulse' : ''),
        onclick: () => select(c.id),
      }, [
        el('div', { class: 'lcx-row-main' }, [
          el('div', { class: 'lcx-row-top' }, [
            el('span', { class: 'lcx-origin', title: c.origin || 'chat' }, ORIGIN_ICON[c.origin] || '💬'),
            el('b', { class: 'lcx-row-name' }, idn.label),
            el('span', { class: 'lcx-row-when' }, fmtDateTime(c.last_msg_at)),
          ]),
          el('div', { class: 'lcx-row-pills' }, [
            pill(idn.pill, idn.tone),
            c.assigned_email ? pill('👤 ' + (c.assigned_me ? 'you' : String(c.assigned_email).split('@')[0]), c.assigned_me ? 'green' : 'gray') : null,
            (!c.user_id && c.email) ? pill('🎯 lead', 'amber') : null,
          ].filter(Boolean)),
          el('div', { class: 'lcx-row-prev' }, splitSys(c.last_msg || '').rest || '—'),
        ]),
        el('div', { class: 'lcx-row-side' }, [
          c.waiting_secs != null ? waitNode : null,
          (c.staff_unread > 0) ? el('span', { class: 'lcx-unread' }, String(c.staff_unread)) : null,
          el('div', { class: 'lcx-dots' }, dots),
        ].filter(Boolean)),
      ]);
      if (c._pulse) { c._pulse = false; setTimeout(() => row.classList.remove('lcx-pulse'), 2400); }
      return row;
    }));
  }

  function select(id) {
    S.activeId = id;
    S.seenIds = new Set(); S.lastDay = ''; S.conv = null;
    mount(msgsEl, '');
    root.classList.add('lcx-mobile-conv');
    paintList(S.rows);
    loadConv(id);
  }

  /* ---------------------------------------------------------- conversation */

  async function loadConv(id, silent) {
    if (!silent) {
      convEmpty.style.display = 'none'; convLive.style.display = '';
      mount(msgsEl, el('div', { class: 'lb-state lb-loading' }, 'Loading conversation…'));
    }
    let c;
    try { c = await ccLcGet(id); }
    catch (e) { if (!silent) mount(msgsEl, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!c || c.error) { if (!silent) mount(msgsEl, el('div', { class: 'lb-state lb-error' }, (c && c.error) || 'Not found')); return; }
    if (id !== S.activeId) return;   // a click landed while this request was in flight

    S.conv = c;
    convEmpty.style.display = 'none'; convLive.style.display = '';
    if (!silent) mount(msgsEl, '');
    paintHead(c);
    paintMessages(c, !silent);
    paintComposer(c);
    paintContext(c);
    typingEl.style.display = c.visitor_typing ? '' : 'none';
  }

  function paintHead(c) {
    const idn = identity(c);
    const online = c.visitor_online;
    const act = [];

    const taken = c.assigned_me && c.bot_paused;
    const takeBtn = el('button', {
      class: 'lb-btn ' + (taken ? 'lb-btn-ghost' : 'lb-btn-primary'),
      onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true;
        try { const r = await ccLcAssign(c.id, true); if (r && r.error) throw new Error(r.error); toast('You are on it ✓'); loadConv(c.id); loadList(true); }
        catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; }
      },
    }, taken ? "You're on it" : '👤 Join & take over');
    takeBtn.disabled = !!taken;   // set as a property: el() writes attributes, not booleans
    act.push(takeBtn);

    if (c.bot_paused) {
      act.push(el('button', { class: 'lb-btn lb-btn-ghost', title: 'The AI answers again from the next visitor message',
        onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true;
          try { const r = await ccLcBotResume(c.id); if (r && r.error) throw new Error(r.error); toast('Handed back to the AI ✓'); loadConv(c.id); loadList(true); }
          catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; }
        } }, '⚡ Hand back to AI'));
    }

    act.push(el('button', { class: 'lb-btn lb-btn-ghost', onclick: async (ev) => {
      const b = ev.currentTarget; b.disabled = true;
      try {
        const r = await ccLcSetStatus(c.id, c.status === 'open' ? 'closed' : 'open');
        if (r && r.error) throw new Error(r.error);
        toast(c.status === 'open' ? 'Closed — the visitor is asked to rate it ✓' : 'Reopened ✓');
        loadConv(c.id); loadList(true);
      } catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; }
    } }, c.status === 'open' ? 'Close' : 'Reopen'));

    act.push(el('button', { class: 'lb-btn lb-btn-ghost', title: 'Riley calls this person back',
      onclick: () => openCallback(c) }, '📞 Call back'));

    mount(convHead, [
      el('button', { class: 'lcx-back', title: 'Back to inbox', onclick: () => { root.classList.remove('lcx-mobile-conv'); } }, '‹'),
      el('div', { class: 'lcx-conv-id' }, [
        el('div', { class: 'lcx-conv-name' }, [
          el('span', { class: 'lcx-avatar lcx-avatar-sm' }, initials(idn.label)),
          el('b', null, idn.label),
        ]),
        el('div', { class: 'lcx-conv-pills' }, [
          pill(idn.pill, idn.tone),
          pill((ORIGIN_ICON[c.origin] || '💬') + ' ' + (c.origin || 'chat') + (c.page ? ' · ' + c.page : ''), 'gray'),
          pill(c.bot_paused ? '🧑 Human' + (c.bot_paused_by_name ? ' · ' + c.bot_paused_by_name : '') : '⚡ AI answering', c.bot_paused ? 'violet' : 'blue'),
          c.assigned_email ? pill('👤 ' + (c.assigned_me ? 'you' : String(c.assigned_email).split('@')[0]), c.assigned_me ? 'green' : 'gray') : null,
          pill(online ? '🟢 On the page' : '⚪ Not on the page', online ? 'green' : 'gray'),
          c.lang === 'es' ? pill('🇪🇸 Spanish', 'amber') : null,
          c.csat != null ? pill('★ ' + c.csat + '/5', c.csat >= 4 ? 'green' : 'amber') : null,
        ].filter(Boolean)),
      ]),
      el('div', { class: 'lcx-conv-actions' }, act),
    ]);
  }

  // Messages are appended, never re-rendered: re-rendering threw away scroll position and
  // any text an agent was mid-way through selecting.
  function paintMessages(c, force) {
    const list = c.messages || [];
    if (force) { S.seenIds = new Set(); S.lastDay = ''; mount(msgsEl, ''); }
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90;
    let added = 0;
    const idn = identity(c);
    list.forEach((m) => {
      const key = m.id != null ? String(m.id) : (m.at + '|' + m.sender + '|' + String(m.body).slice(0, 24));
      if (S.seenIds.has(key)) return;
      S.seenIds.add(key);
      const dk = dayKey(m.at);
      if (dk && dk !== S.lastDay) { S.lastDay = dk; msgsEl.appendChild(el('div', { class: 'lcx-day' }, el('span', null, dayLabel(m.at)))); }
      msgsEl.appendChild(bubble(m, idn));
      added++;
    });
    if (added && (nearBottom || force)) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function bubble(m, idn) {
    const sys = splitSys(m.body);
    const d = parseDirectives(sys.rest);

    // System events and internal notes are not messages anyone sent — they must not look
    // like one, or an agent will assume the visitor saw them.
    if (sys.sys) return el('div', { class: 'lcx-sys' }, el('span', { html: richText(d.text) }));
    if (d.note) return el('div', { class: 'lcx-note' }, el('span', { html: '📝 ' + richText(d.text) }));

    const who = m.sender === 'bot' ? '⚡ AI assistant'
      : m.sender === 'staff' ? (m.staff_name ? '🧑 ' + m.staff_name : '🧑 Staff')
      : idn.label;
    const side = m.sender === 'staff' ? 'staff' : m.sender === 'bot' ? 'bot' : 'visitor';

    return el('div', { class: 'lcx-m lcx-m-' + side }, [
      el('span', { class: 'lcx-m-meta' }, who + ' · ' + clock(m.at)),
      d.text ? el('div', { class: 'lcx-b', html: richText(d.text) }) : null,
      // What the bot actually put in front of them. An agent taking over blind is the
      // reason visitors get asked the same question twice.
      d.chips.length ? el('div', { class: 'lcx-chipsrow' }, d.chips.map(ch => el('span', { class: 'lcx-offer' }, ch))) : null,
      d.askedFor ? el('span', { class: 'lcx-hint' }, '↳ asked for ' + d.askedFor) : null,
      d.callback ? el('span', { class: 'lcx-hint' }, '↳ offered a callback') : null,
    ].filter(Boolean));
  }

  function paintComposer(c) {
    const open = c.status === 'open';
    // The amber note is the whole point of bot_paused being on the wire: without it an
    // agent types a reply while the AI is mid-answer and the visitor gets two voices.
    aiNote.style.display = (open && !c.bot_paused) ? '' : 'none';
    closedNote.style.display = open ? 'none' : '';
    input.disabled = !open;
    sendBtn.disabled = !open;
    input.placeholder = open
      ? 'Reply as LoadBoot team…  (Enter to send · Shift+Enter newline · / for saved replies)'
      : 'This conversation is closed.';
  }

  async function send() {
    const c = S.conv; if (!c) return;
    const body = input.value.trim();
    if (!body || c.status !== 'open') return;
    const keep = input.value;
    input.value = ''; cannedPop.style.display = 'none'; sendBtn.disabled = true;
    try {
      const r = await ccLcReply(c.id, body);
      if (r && r.error) throw new Error(r.error);
      await loadConv(c.id, true);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      loadList(true);
    } catch (e) {
      input.value = keep;   // never silently swallow something an agent typed
      toast(humanizeError(e), 'error');
    }
    sendBtn.disabled = c.status !== 'open';
  }
  sendBtn.addEventListener('click', send);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Escape') { cannedPop.style.display = 'none'; }
  });
  input.addEventListener('input', () => {
    // "/" at the start of an empty-ish composer opens the saved replies, filtered as you type.
    const v = input.value;
    if (v.charAt(0) === '/') { renderCanned(v.slice(1).trim()); cannedPop.style.display = ''; }
    else cannedPop.style.display = 'none';
    if (!v.trim() || !S.activeId) return;
    const now = Date.now();
    if (now - S.lastTyping < TYPE_MS) return;   // contract: at most one call every 3s
    S.lastTyping = now;
    ccLcTyping(S.activeId).catch(() => { /* typing signal is best-effort */ });
  });

  function toggleCanned() {
    const showing = cannedPop.style.display !== 'none';
    if (showing) { cannedPop.style.display = 'none'; return; }
    renderCanned(''); cannedPop.style.display = ''; input.focus();
  }

  async function loadCanned() {
    try { const r = await ccLcCannedList(); if (Array.isArray(r)) S.canned = r; } catch (e) { /* optional */ }
  }

  function renderCanned(q) {
    const needle = String(q || '').toLowerCase();
    const list = (S.canned || []).filter(cr =>
      !needle || (cr.title + ' ' + cr.body).toLowerCase().indexOf(needle) >= 0);
    mount(cannedPop, [
      el('div', { class: 'lcx-canned-h' }, list.length ? 'Saved replies' : 'No saved reply matches'),
      el('div', { class: 'lcx-canned-l' }, list.map(cr => el('div', { class: 'lcx-canned-i' }, [
        el('button', { class: 'lcx-canned-b', title: cr.body, onclick: () => {
          input.value = cr.body; cannedPop.style.display = 'none'; input.focus();
        } }, [el('b', null, cr.title), el('span', null, String(cr.body).slice(0, 90))]),
        el('button', { class: 'lcx-canned-x', title: 'Delete this saved reply', onclick: async () => {
          try { const r = await ccLcCannedDelete(cr.id); if (r && r.error) throw new Error(r.error); await loadCanned(); renderCanned(needle); }
          catch (e) { toast(humanizeError(e), 'error'); }
        } }, '×'),
      ]))),
      el('button', { class: 'lcx-canned-new', onclick: async () => {
        const t = prompt('Saved reply title:'); if (!t) return;
        const b = prompt('Saved reply text:'); if (!b) return;
        try { const r = await ccLcCannedSave(t, b); if (r && r.error) throw new Error(r.error); await loadCanned(); renderCanned(''); toast('Saved reply added ✓'); }
        catch (e) { toast(humanizeError(e), 'error'); }
      } }, '+ New saved reply'),
    ]);
  }

  /* ----------------------------------------------------------- right pane */

  function dot(status) {
    const s = String(status || '').toLowerCase();
    const tone = s === 'valid' || s === 'approved' || s === 'active' ? 'green'
      : s === 'pending' || s === 'review' ? 'amber'
      : s === 'rejected' || s === 'expired' ? 'red' : 'gray';
    return el('span', { class: 'lcx-sdot lcx-t-' + tone, title: status || 'missing' });
  }

  function ring(done, total) {
    const pct = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
    const R = 26, C = 2 * Math.PI * R;
    const wrap = el('div', { class: 'lcx-ring' });
    // Inline SVG so it inherits the pane's colours without another asset request.
    wrap.innerHTML =
      '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="' + R + '" class="lcx-ring-bg"></circle>' +
      '<circle cx="32" cy="32" r="' + R + '" class="lcx-ring-fg" stroke-dasharray="' + C.toFixed(1) + '" ' +
      'stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '" transform="rotate(-90 32 32)"></circle>' +
      '</svg><div class="lcx-ring-t"><b>' + done + '</b><span>/' + total + '</span></div>';
    return wrap;
  }

  function card(title, kids) {
    return el('div', { class: 'lcx-card' }, [el('div', { class: 'lcx-card-h' }, title), el('div', { class: 'lcx-card-b' }, kids)]);
  }
  function kv(k, v) { return el('div', { class: 'lcx-kv' }, [el('span', null, k), el('b', null, v == null || v === '' ? '—' : v)]); }

  function paintContext(c) {
    const idn = identity(c);
    const a = c.account;
    const kids = [];

    kids.push(card('Visitor', [
      kv('Name', c.name),
      c.email ? el('div', { class: 'lcx-kv' }, [el('span', null, 'Email'), el('a', { href: 'mailto:' + c.email }, c.email)]) : kv('Email', null),
      kv('Role', c.visitor_role || c.role),
      c.page ? el('div', { class: 'lcx-kv' }, [el('span', null, 'On page'),
        el('a', { href: c.page, target: '_blank', rel: 'noopener noreferrer' }, String(c.page).slice(0, 42))]) : null,
      kv('Signed in', c.user_id ? 'Yes' : 'No — anonymous visitor'),
      kv('Company', c.company),
      (c.mc || c.dot) ? kv('MC / DOT', (c.mc || '—') + ' / ' + (c.dot || '—')) : null,
      kv('Profile', c.profile_status),
    ].filter(Boolean)));

    if (a) {
      kids.push(card('Verification', [
        el('div', { class: 'lcx-verrow' }, [
          ring(Number(a.verified || 0), Number(a.total || 0)),
          el('div', null, [
            el('b', { class: 'lcx-org' }, a.org_name || idn.label),
            el('div', { class: 'lcx-sub2' }, (a.org_status || 'status unknown') + ' · payment ' + (a.payment_status || '—')),
          ]),
        ]),
        (a.compliance || []).length ? el('div', { class: 'lcx-complist' }, (a.compliance || []).map(x =>
          el('div', { class: 'lcx-comp' }, [
            dot(x.status),
            el('div', null, [el('b', null, x.name), x.note ? el('span', { class: 'lcx-sub2' }, x.note) : null].filter(Boolean)),
            el('span', { class: 'lcx-comp-s' }, x.status || 'missing'),
          ]))) : el('div', { class: 'lcx-sub2' }, 'No compliance items on file.'),
      ]));

      kids.push(card('Trucks (' + ((a.trucks || []).length) + ')', (a.trucks || []).length
        ? (a.trucks || []).map(t => el('div', { class: 'lcx-truck' }, [
            el('b', null, t.unit || '—'),
            el('span', null, t.equipment || '—'),
            el('span', { class: 'lcx-vin' + (t.vin_on_file ? ' ok' : '') }, t.vin_on_file ? 'VIN ✓' : 'VIN ✗'),
            t.status ? pill(t.status, 'gray') : null,
          ].filter(Boolean)))
        : el('div', { class: 'lcx-sub2' }, 'No trucks added yet.')));
    }

    const calls = c.calls || [];
    const callKids = calls.length
      ? calls.slice(0, 6).map(x => el('div', { class: 'lcx-call' }, [
          el('div', { class: 'lcx-call-t' }, [
            pill((x.direction === 'outbound' ? '↗ ' : '↘ ') + (x.status || '—'),
              (x.status === 'ended' || x.status === 'analyzed') ? 'green' : x.status === 'no-answer' ? 'red' : 'amber'),
            el('span', { class: 'lcx-sub2' }, fmtDateTime(x.at || x.scheduled_at)),
          ]),
          x.duration_sec != null ? el('span', { class: 'lcx-sub2' }, Math.floor(x.duration_sec / 60) + 'm ' + (x.duration_sec % 60) + 's') : null,
          x.summary ? el('div', { class: 'lcx-call-s' }, x.summary) : null,
        ].filter(Boolean)))
      : [el('div', { class: 'lcx-sub2' }, 'No calls with this person yet.')];
    callKids.push(el('button', { class: 'lb-btn lb-btn-ghost lcx-tinybtn lcx-callback',
      onclick: () => openCallback(c) }, '📞 Call back'));
    kids.push(card('Calls (' + calls.length + ')', callKids));

    kids.push(card('Rating', c.csat != null
      ? [el('div', { class: 'lcx-stars' }, '★'.repeat(Math.max(0, Math.min(5, Number(c.csat)))) + '☆'.repeat(Math.max(0, 5 - Number(c.csat)))),
         c.csat_comment ? el('div', { class: 'lcx-quote' }, '“' + c.csat_comment + '”') : null,
         el('div', { class: 'lcx-sub2' }, fmtDateTime(c.csat_at))].filter(Boolean)
      : el('div', { class: 'lcx-sub2' }, 'Not rated yet — the rating card appears to the visitor when you close the chat.')));

    const first = ts(c.first_staff_reply_at), hand = ts(c.handoff_at);
    const gapMin = (first != null && hand != null) ? Math.round((first - hand) / 60000) : null;
    kids.push(card('Timing', [
      kv('Started', fmtDateTime(c.created_at)),
      kv('Asked for a human', c.handoff_at ? fmtDateTime(c.handoff_at) : 'never — AI handled it'),
      kv('First staff reply', c.first_staff_reply_at ? fmtDateTime(c.first_staff_reply_at) : 'not yet'),
      gapMin != null ? el('div', { class: 'lcx-kv' }, [el('span', null, 'Answered in'),
        el('b', { class: gapMin > 15 ? 'lcx-bad' : 'lcx-good' }, gapMin + ' min')]) : null,
      kv('Messages', String((c.messages || []).length)),
    ].filter(Boolean)));

    mount(ctxHost, kids.filter(Boolean));
  }

  /* -------------------------------------------------------------- drawers */

  function openCallback(c) {
    const phone = el('input', { class: 'cc-input', placeholder: 'US phone e.g. +15551234567' });
    const nm = el('input', { class: 'cc-input', placeholder: 'Their name (Riley uses it)', value: (c && c.name) || '' });
    const tp = el('input', { class: 'cc-input', placeholder: 'Topic they asked about (e.g. detention pay)' });
    const rl = el('select', { class: 'cc-input' }, ['carrier', 'broker', 'shipper', 'dispatcher', 'other']
      .map(r => el('option', { value: r, selected: (c && c.visitor_role) === r ? 'selected' : null }, r)));
    const ctxIn = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Context for Riley — she uses it naturally on the call' });
    const when = el('input', { class: 'cc-input', type: 'datetime-local' });
    // Seed the context from the last few messages so nobody retypes the conversation.
    if (c && c.messages) {
      ctxIn.value = c.messages.slice(-4).map(m => (m.sender === 'visitor' ? 'Them: ' : 'Us: ') + splitSys(m.body).rest).join('\n').slice(0, 600);
    }
    const go = el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
      const b = ev.currentTarget;
      if (!phone.value.trim()) { toast('A phone number is required.', 'error'); return; }
      b.disabled = true; b.textContent = 'Dialing…';
      try {
        const r = await ccRetellCallback({ to: phone.value.trim(), name: nm.value.trim() || null, topic: tp.value.trim() || null,
          role: rl.value, context: ctxIn.value || null, when: when.value ? new Date(when.value).toISOString() : null });
        if (r && r.error) throw new Error(r.error);
        toast(r.scheduled ? '📅 Call scheduled ✓' : '📞 Riley is calling them now ✓');
        if (drawerRef && drawerRef.close) { drawerRef.close(); drawerRef = null; }
        if (S.activeId) loadConv(S.activeId, true);
      } catch (e) { toast(humanizeError(e), 'error'); }
      b.disabled = false; b.textContent = '📞 Riley calls them';
    } }, '📞 Riley calls them');

    drawerRef = openDrawer('Call this person back', el('div', { class: 'cc-form' }, [
      el('p', { class: 'cc-sub' }, 'Callback ONLY for people who asked for a call. Never cold lists.'),
      phone, nm, tp, rl, ctxIn,
      el('label', { class: 'cc-sub' }, 'Schedule (optional — empty means call right now)'), when, go,
    ]), { subtitle: c ? identity(c).label : '' });
  }

  async function loadMisses() {
    let rows; try { rows = await ccLcMisses(); } catch (e) { return; }
    if (!rows || rows.error) return;
    S.misses = rows.length;
    const b = document.getElementById('lcx-train-btn');
    if (b) { b.textContent = '🧠 Train the AI' + (rows.length ? ' (' + rows.length + ')' : ''); b.classList.toggle('lcx-hot', rows.length > 0); }
  }

  async function openTraining() {
    const body = el('div', null, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    drawerRef = openDrawer('🧠 Train the AI', body, { subtitle: 'Questions the AI could not answer — teach one and it knows it instantly' });
    const paint = async () => {
      let rows; try { rows = await ccLcMisses(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
      if (!rows || rows.error) { mount(body, el('div', { class: 'lb-state lb-error' }, (rows && rows.error) || 'Failed')); return; }
      S.misses = rows.length; loadMisses();
      if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'Nothing waiting — the AI answered everything it was asked. 🎉')); return; }
      mount(body, rows.map(m => {
        const kw = el('input', { class: 'cc-input', placeholder: 'Keywords, comma separated (e.g. insurance cost, monthly insurance)' });
        const ans = el('input', { class: 'cc-input', placeholder: 'The answer the bot should give (links allowed)' });
        return el('div', { class: 'lcx-miss' }, [
          el('div', { class: 'lcx-miss-q' }, [
            el('b', null, '“' + m.question + '”'),
            pill(m.n + '×', m.n > 2 ? 'red' : 'amber'),
            el('span', { class: 'lcx-sub2' }, fmtDateTime(m.last_seen)),
          ]),
          kw, ans,
          el('div', { class: 'lcx-miss-a' }, [
            el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
              const b2 = ev.currentTarget;
              if (!kw.value.trim() || !ans.value.trim()) { toast('Keywords and an answer are both required.', 'error'); return; }
              b2.disabled = true;
              try { const r = await ccLcTeach(m.id, kw.value, ans.value); if (r && r.error) throw new Error(r.error); toast('Bot learned it ✓'); paint(); }
              catch (e) { toast(humanizeError(e), 'error'); b2.disabled = false; }
            } }, 'Teach'),
            el('button', { class: 'lb-btn lb-btn-ghost', onclick: async (ev) => {
              ev.currentTarget.disabled = true;
              try { const r = await ccLcMissDismiss(m.id); if (r && r.error) throw new Error(r.error); paint(); }
              catch (e) { toast(humanizeError(e), 'error'); }
            } }, 'Dismiss'),
          ]),
        ]);
      }));
    };
    paint();
  }

  async function openCalls() {
    const body = el('div', null, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    drawerRef = openDrawer('📞 Recent calls', body, { subtitle: 'Inbound calls and Riley callbacks, with audio and transcripts' });
    let rows; try { rows = await ccLcCalls(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!rows || rows.error) { mount(body, el('div', { class: 'lb-state lb-error' }, (rows && rows.error) || 'Failed')); return; }
    mount(body, el('div', null, [
      el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-bottom:12px', onclick: () => openCallback(S.conv) }, '📞 New callback'),
      rows.length ? el('div', { class: 'lcx-calllist' }, rows.map(c => {
        const answered = (c.status === 'ended' || c.status === 'analyzed') && (c.duration_sec || 0) > 0;
        const label = answered ? '✅ Answered'
          : c.status === 'in-progress' ? '🟢 On call'
          : c.status === 'dialing' ? '📞 Ringing…'
          : c.status === 'scheduled' ? '📅 Scheduled'
          : c.status === 'no-answer' ? '☎ No answer'
          : c.status === 'no-result' ? '⚠ No result'
          : c.status === 'cancelled' ? '— Cancelled' : c.status;
        const tone = answered ? 'green' : c.status === 'in-progress' ? 'blue' : c.status === 'no-answer' ? 'red'
          : c.status === 'no-result' ? 'amber' : c.status === 'cancelled' ? 'gray' : 'amber';
        return el('div', { class: 'lcx-callrow' }, [
          el('div', { class: 'lcx-call-t' }, [
            pill(label, tone),
            el('b', null, c.name || c.to_number || c.from_number || '—'),
            el('span', { class: 'lcx-sub2' }, fmtDateTime(c.at || c.scheduled_at)),
            c.duration_sec != null ? el('span', { class: 'lcx-sub2' }, Math.floor(c.duration_sec / 60) + 'm ' + (c.duration_sec % 60) + 's') : null,
          ].filter(Boolean)),
          el('div', { class: 'lcx-call-s' }, (c.source === 'website' ? '🌐 ' : '') + (c.summary || c.topic || '—')),
          (c.transcript || c.recording_url) ? el('button', { class: 'lb-btn lb-btn-ghost lcx-tinybtn', onclick: () => {
            const kids = [el('p', { class: 'cc-sub' }, (c.name || c.to_number || '') + (c.summary ? ' — ' + c.summary : ''))];
            if (c.recording_url) { const au = el('audio', { controls: 'controls', style: 'width:100%;margin:8px 0' }); au.src = c.recording_url; kids.push(au); }
            if (c.transcript) kids.push(el('pre', { class: 'lcx-transcript' }, c.transcript));
            drawerRef = openDrawer('Call — audio & transcript', el('div', null, kids), { subtitle: c.sentiment || '' });
          } }, c.recording_url ? '🔊 Listen' : '📄 Transcript') : null,
        ].filter(Boolean));
      })) : el('div', { class: 'lb-state' }, 'No calls yet. Inbound calls and Riley callbacks appear here automatically.'),
    ]));
  }
}
