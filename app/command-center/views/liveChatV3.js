// liveChatV3.js — CC Live chat v3: the Amazon/Uber-grade agent console approved from
// previews/cc-livechat-v3.html on 19 Sep 2026.
//
// What changed against v2 (views/liveChat.js, still on disk and reachable at #/live-chat?v=2):
//   * The queue column is a queue again. Presence, KPIs and drawers moved to a slim top bar;
//     nine filter chips became four state tabs (Needs you · Mine · AI · All · Closed) plus a
//     compact role / intent / language row.
//   * Every conversation has a state (waiting on you / waiting on customer / AI / closed)
//     derived from the SAME fields v2 already used — mode, bot_paused, first_staff_reply_at,
//     staff_unread — so the tabs cannot disagree with the alerts.
//   * Intent tags are a client-side keyword classifier over the visitor's own words. They
//     are a reading aid, never stored, and say so in their tooltip.
//   * Role playbooks: one row of buttons per role, each landing on the exact CC screen
//     (#/carrier?id=<org_id>&tab=…) or dropping a portal deep link into the composer for the
//     agent to send. Nothing here sends to a customer without the agent pressing Send.
//   * Deep-linkable itself: #/live-chat?id=<conversation> opens that conversation.
//   * ⌘K palette, alerts drawer, bulk select, message hover actions (Copy / Teach the AI),
//     keyboard (J/K/E/T//, 1–5, ?), and a native-app mobile shell with a bottom tab bar.
//   * Icons are Lucide via app/shared/ui/icons.js — no emoji in the chrome.
//
// Every button maps to an RPC that exists today in app/shared/api.js. Things the preview
// marked ⚡ (AI draft, translate, transfer-to-teammate, collision presence, journey events,
// internal notes) are NOT built here; they need backend work and are listed in the handoff.
import { el, mount } from '../../shared/ui/dom.js';
import { fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { ccLcList, ccLcGet, ccLcReply, ccLcSetStatus, ccLcStats, ccLcMisses, ccLcTeach,
         ccLcMissDismiss, ccLcAssign, ccLcCannedList, ccLcCannedSave, ccLcCannedDelete,
         ccRetellCallback, ccLcCalls, ccLcPresenceGet, ccLcPresenceSet,
         ccLcHeartbeat, ccLcTyping, ccLcBotResume } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { richText, parseDirectives } from '../../shared/ui/chatText.js';
import { ico, icoHtml, ensureIcons } from '../../shared/ui/lucide.js';

const CSS_HREF = new URL('../livechat-v3.css', import.meta.url).href + '?v=20260919b';
const LIST_MS = 5000, CONV_MS = 2500, BEAT_MS = 45000, TYPE_MS = 3000;
const PORTAL = 'https://loadboot.com/app/';

/* ----------------------------------------------------------- vocabulary */

const ROLES = {
  carrier:    { ic: 'truck',       lbl: 'Carrier',    c: '#0883F7' },
  partner:    { ic: 'building-2',  lbl: 'Broker',     c: '#7c3aed' },
  broker:     { ic: 'building-2',  lbl: 'Broker',     c: '#7c3aed' },
  shipper:    { ic: 'package',     lbl: 'Shipper',    c: '#0d9488' },
  dispatcher: { ic: 'headset',     lbl: 'Dispatcher', c: '#e11d48' },
  agent:      { ic: 'handshake',   lbl: 'Agent',      c: '#f59e0b' },
  referral:   { ic: 'handshake',   lbl: 'Agent',      c: '#f59e0b' },
  driver:     { ic: 'car-front',   lbl: 'Driver',     c: '#0ea5e9' },
  visitor:    { ic: 'globe',       lbl: 'Visitor',    c: '#64748b' },
};
const ROLE_FILTERS = ['carrier', 'broker', 'shipper', 'dispatcher', 'agent', 'driver', 'visitor'];

// Order matters: the first family whose pattern matches wins.
const INTENTS = [
  ['docs',       'Documents & compliance', /\b(coi|insurance|certificate|w-?9|authority|mc\s?\d|dot\s?\d|noa|rejected|upload|document|expir|cdl|medical)\b/i],
  ['pay',        'Payments & settlement',  /\b(pay|paid|payment|settle|settlement|invoice|factoring|deposit|commission|payout|money|quick ?pay)\b/i],
  ['loads',      'Loads & booking',        /\b(load|loads|lane|reefer|dry ?van|flatbed|rate|book|booking|pickup|deliver|capacity|truck(s)? out of|freight)\b/i],
  ['onboarding', 'Onboarding',             /\b(sign ?up|get started|start|onboard|activate|how do (i|we)|register|set ?up|join)\b/i],
  ['account',    'Account & access',       /\b(log ?in|sign ?in|password|otp|code|account|access|locked|email link|can'?t get in)\b/i],
  ['pricing',    'Pricing & plans',        /\b(price|pricing|cost|charge|fee|percent|%|contract|plan|subscription|free)\b/i],
  ['jobs',       'Jobs & hiring',          /\b(job|hiring|apply|application|interview|test|dispatcher position|career|salary)\b/i],
  ['tech',       'Technical issue',        /\b(app|bug|crash|not (working|loading)|error|broken|refresh|cache|button|screen|update)\b/i],
];
const INTENT_LBL = INTENTS.reduce((a, x) => { a[x[0]] = x[1]; return a; }, { other: 'General' });
const FRUSTRATED = /\b(again|still|third time|nobody|no one|ridiculous|worst|frustrat|waiting for hours|!!)/i;

function classify(text) {
  const t = String(text || '');
  for (let i = 0; i < INTENTS.length; i++) if (INTENTS[i][2].test(t)) return INTENTS[i][0];
  return 'other';
}

/* --------------------------------------------------------------- helpers */

function roleKey(c) {
  if (!c.user_id) return c.visitor_role && ROLES[c.visitor_role] ? c.visitor_role : 'visitor';
  const r = String(c.role || '').toLowerCase();
  return ROLES[r] ? r : 'visitor';
}
function roleOf(c) { return ROLES[roleKey(c)]; }
function label(c) { return c.name || (c.user_id ? 'Signed-in user' : 'Anonymous visitor'); }
function initials(s) { return String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'; }
function verified(c) {
  if (!c.user_id) return { cls: 'new', txt: c.visitor_role ? 'Lead' : 'Not signed in' };
  const v = String(c.profile_status || '').toLowerCase();
  if (['verified', 'approved', 'active'].indexOf(v) >= 0) return { cls: 'ok', txt: 'Verified' };
  if (!v || v === 'not_started') return { cls: 'new', txt: 'Not started' };
  return { cls: 'warn', txt: v.replace(/_/g, ' ') };
}
// One place decides what a conversation is waiting on. The tabs, the row timer and the
// header pill all read this, so they cannot disagree.
function stateOf(c) {
  if (c.status !== 'open') return 'closed';
  if (c.mode === 'human' || c.bot_paused) {
    if (!c.first_staff_reply_at || Number(c.staff_unread || 0) > 0) return 'wa';
    return 'wc';
  }
  return 'ai';
}
const STATE = { wa: ['Waiting on you', 'wa'], wc: ['Waiting on customer', 'wc'], ai: ['AI handling', 'ai'], closed: ['Closed', 'cl'] };
const mmss = s => (s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's');
const slaTone = s => (s >= 300 ? 'r' : s >= 120 ? 'a' : 'g');
const ts = v => { const t = Date.parse(v || ''); return isNaN(t) ? null : t; };
const dayKey = v => { const t = ts(v); return t == null ? '' : new Date(t).toDateString(); };
function dayLabel(v) {
  const t = ts(v); if (t == null) return '';
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function clock(v) { const t = ts(v); return t == null ? '' : new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function splitSys(body) {
  const s = String(body || '');
  return s.slice(0, 7) === '[[sys]]' ? { sys: true, rest: s.slice(7).trim() } : { sys: false, rest: s };
}
function tag(text, cls, iconName, title) {
  return el('span', { class: 'lcv-tag ' + (cls || ''), title: title || null, html: (iconName ? icoHtml(iconName) : '') + text });
}
function beep() {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const ctx = new A(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.18);
  } catch (e) { /* silent */ }
}
function notify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    const n = new Notification(title, { body, tag: 'lb-livechat' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { /* optional */ }
}
function copy(text) {
  try { navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { toast(text); }
}
function ensureCss() {
  if (document.querySelector('link[data-lcv]')) return;
  document.head.appendChild(el('link', { rel: 'stylesheet', href: CSS_HREF, 'data-lcv': '1' }));
}

/* ------------------------------------------------------- deep-link vocab */
// Staff links are real CC routes (app.js router). Customer links are portal hashes that
// already exist in the carrier / agent apps. Anything not verified is simply not listed.
const chatLink = id => '#/live-chat?id=' + id;
const CUSTOMER_LINKS = {
  coi:        { t: 'Re-upload your COI',            u: PORTAL + 'carrier/#documents/insurance' },
  w9:         { t: 'Sign your W-9 in the portal',   u: PORTAL + 'carrier/#documents/w9' },
  pay:        { t: 'Set up your payout',            u: PORTAL + 'carrier/#account/payments' },
  loads:      { t: 'Open your loads',               u: PORTAL + 'carrier/#loads' },
  money:      { t: 'Your referral link & earnings', u: PORTAL + 'agent/#money' },
  setup:      { t: 'Get set up in 5 minutes',       u: 'https://loadboot.com/get-started' },
  pricing:    { t: 'How LoadBoot pricing works',    u: 'https://loadboot.com/pricing' },
};
function playbook(c) {
  const a = c.account || {};
  const org = a.org_id || null;
  const staff = (t, ic, h) => ({ t, ic, h, k: 'staff' });
  const send = (t, ic, card) => ({ t, ic, card, k: 'send' });
  const call = { t: 'Call back', ic: 'phone', k: 'call' };
  const name = encodeURIComponent(label(c));
  switch (roleKey(c)) {
    case 'carrier': return [
      org ? staff('Carrier 360', 'id-card', '#/carrier?id=' + org) : staff('Carriers', 'id-card', '#/carriers'),
      org ? staff('Review documents', 'file-text', '#/carrier?id=' + org + '&tab=documents') : staff('Documents', 'file-text', '#/documents'),
      send('Ask to re-upload COI', 'refresh-cw', 'coi'), send('Send W-9 link', 'pen-line', 'w9'),
      org ? staff('Fleet & VINs', 'truck', '#/fleet?org=' + org) : null, call,
    ].filter(Boolean);
    case 'partner': case 'broker': return [
      org ? staff('Broker 360', 'building-2', '#/broker?id=' + org) : staff('Partners', 'building-2', '#/partners'),
      staff('Trust & authority', 'shield-check', '#/broker-trust'), staff('Post a load', 'send', '#/loads'), call];
    case 'shipper': return [staff('CRM lead', 'target', '#/crm?q=' + name), send('Send get-started link', 'rocket', 'setup'), call];
    case 'dispatcher': return [staff('Applicants', 'clipboard-list', '#/dispatchers'), staff('Skills tests', 'flask-conical', '#/dispatchers'), call];
    case 'agent': case 'referral': return [staff('Agents', 'handshake', '#/agents'), send('Send referral link', 'link', 'money'), call];
    case 'driver': return [org ? staff('Carrier 360', 'id-card', '#/carrier?id=' + org) : staff('Carriers', 'id-card', '#/carriers'), staff('Loads & tracking', 'map-pin', '#/loads'), call];
    default: return [send('Send 5-min setup', 'rocket', 'setup'), send('Send pricing card', 'dollar-sign', 'pricing'), staff('CRM & leads', 'target', '#/crm'), call];
  }
}
const TABS = [
  { k: 'need',   l: 'Needs you',   f: c => stateOf(c) === 'wa' },
  { k: 'mine',   l: 'Mine',        f: c => !!c.assigned_me && c.status === 'open' },
  { k: 'ai',     l: 'AI handling', f: c => stateOf(c) === 'ai' },
  { k: 'all',    l: 'All open',    f: c => c.status === 'open' },
  { k: 'closed', l: 'Closed',      f: c => c.status !== 'open' },
];
const SCREENS = [['Carriers', '#/carriers'], ['Documents review', '#/documents'], ['Loads & trips', '#/loads'], ['Dispatchers', '#/dispatchers'],
  ['Broker trust', '#/broker-trust'], ['Partners', '#/partners'], ['Finance', '#/finance'], ['CRM & leads', '#/crm'], ['Email outreach', '#/outreach']];

/* ================================================================== view */

export function renderLiveChatV3(host) {
  ensureCss(); ensureIcons();

  const S = {
    tab: 'need', rf: { role: null, intent: null, lang: null, flag: null }, search: '',
    activeId: null, rows: [], stats: null, presence: null, canned: [], conv: null,
    seenIds: new Set(), lastDay: '', needsHuman: new Set(), lastMsgAt: {}, alerted: false,
    lastTyping: 0, misses: 0, sel: new Set(), menu: null, view: 'q',
  };
  const timers = []; let listTickers = []; let drawerRef = null;

  /* ------------------------------------------------------------ skeleton */
  const presHost = el('div', { class: 'lcv-pres-host' });
  const metricHost = el('div', { class: 'lcv-mstrip' });
  const bellBadge = el('span', { class: 'lcv-bdg', style: 'display:none' });
  const drawer = el('div', { class: 'lcv-drawer' });
  const top = el('div', { class: 'lcv-top' }, [
    el('div', { class: 'lcv-title' }, [el('h1', null, 'Live chat'), el('small', null, 'Support console')]),
    presHost, metricHost, el('div', { class: 'lcv-spacer' }),
    el('button', { class: 'lcv-omni', onclick: () => openPalette() }, [ico('search'), el('span', null, 'Search chats, MC#, people — or jump anywhere'), el('kbd', null, '⌘K')]),
    el('div', { class: 'lcv-dd' }, [el('button', { class: 'lcv-ic', title: 'Alerts', onclick: (e) => { e.stopPropagation(); toggleAlerts(); } }, [ico('bell'), bellBadge]), drawer]),
    el('button', { class: 'lcv-ic', title: 'Keyboard shortcuts (?)', onclick: () => openSheet() }, ico('circle-help')),
  ]);

  const tabsHost = el('div', { class: 'lcv-qtabs' });
  const filtHost = el('div', { class: 'lcv-qfilters' });
  const rowsHost = el('div', { class: 'lcv-rows' });
  const footNormal = el('span', { class: 'lcv-foot-n' });
  const bulkN = el('b', null, '0');
  const foot = el('div', { class: 'lcv-qfoot' }, [
    footNormal,
    el('div', { class: 'lcv-bulkbar' }, [bulkN, el('span', null, ' selected'),
      el('button', { class: 'lcv-btn sm', onclick: () => bulk('close') }, [ico('check'), 'Resolve']),
      el('button', { class: 'lcv-btn sm', onclick: () => bulk('take') }, [ico('hand'), 'Take']),
      el('button', { class: 'lcv-btn sm', onclick: () => { S.sel.clear(); paintList(S.rows); } }, 'Clear')]),
  ]);
  const qpane = el('div', { class: 'lcv-pane lcv-qpane' }, [tabsHost, filtHost, rowsHost, foot]);

  const convHead = el('div', { class: 'lcv-chead' });
  const playbar = el('div', { class: 'lcv-playbar' });
  const msgsEl = el('div', { class: 'lcv-msgs' });
  const typingEl = el('div', { class: 'lcv-typing', style: 'display:none' }, [el('i'), el('i'), el('i'), el('span', null, 'Visitor is typing…')]);
  const aiNote = el('div', { class: 'lcv-note-ai', style: 'display:none', html: icoHtml('bot') + ' The AI is still answering here — sending a reply takes over automatically.' });
  const closedNote = el('div', { class: 'lcv-note-closed', style: 'display:none' }, 'This conversation is closed — reopen to reply.');
  const cannedPop = el('div', { class: 'lcv-macro', style: 'display:none' });
  const input = el('textarea', { class: 'lcv-ta', rows: '1', placeholder: 'Reply… ( / saved replies )' });
  const sendBtn = el('button', { class: 'lcv-btn pri', title: 'Send (Enter)' }, [el('span', null, 'Send'), ico('send')]);
  const linkMenu = el('div', { class: 'lcv-menu lcv-menu-up' });
  const composer = el('div', { class: 'lcv-comp' }, [
    cannedPop, aiNote, closedNote,
    el('div', { class: 'lcv-cbox' }, [
      input,
      el('div', { class: 'lcv-ctools' }, [
        el('button', { class: 'lcv-tbtn', title: 'Saved replies (/)', onclick: () => toggleCanned() }, ico('zap')),
        el('div', { class: 'lcv-dd' }, [el('button', { class: 'lcv-tbtn', title: 'Insert a portal link', onclick: (e) => { e.stopPropagation(); toggleMenu('links'); } }, ico('target')), linkMenu]),
        sendBtn,
      ]),
    ]),
    el('div', { class: 'lcv-chint', html: '<span><kbd>Enter</kbd> send</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> newline</span><span><kbd>/</kbd> saved replies</span><span><kbd>J</kbd>/<kbd>K</kbd> next chat</span><span><kbd>E</kbd> resolve</span><span><kbd>?</kbd> all shortcuts</span>' }),
  ]);
  const convEmpty = el('div', { class: 'lcv-empty' }, [el('div', { class: 'lcv-empty-ico' }, ico('message-square')), el('b', null, 'Pick a conversation'),
    el('p', null, 'Needs-you sorts first, longest wait on top. Everything else the AI is holding.')]);
  const convLive = el('div', { class: 'lcv-conv-live', style: 'display:none' }, [convHead, playbar, msgsEl, typingEl, composer]);
  const convPane = el('div', { class: 'lcv-pane lcv-convpane' }, [convEmpty, convLive]);

  const ctxHost = el('div', { class: 'lcv-pane lcv-ctxpane' });

  const mnavQ = el('button', { onclick: () => view('q') }, [ico('inbox'), el('span', null, 'Queue'), el('s', { class: 'lcv-mn-b' })]);
  const mnavC = el('button', { onclick: () => view('c') }, [ico('message-square'), el('span', null, 'Chat'), el('s', { class: 'lcv-mn-b b' })]);
  const mnavD = el('button', { onclick: () => view('d') }, [ico('user-round'), el('span', null, 'Details')]);
  const mnav = el('nav', { class: 'lcv-mnav' }, [mnavQ, mnavC, mnavD]);

  const linkbar = el('div', { class: 'lcv-linkbar' });
  const overlay = el('div', { class: 'lcv-ovl', onclick: (e) => { if (e.target === overlay) closeOverlay(); } });
  const root = el('div', { class: 'lcv-root', dataset: { v: 'q' } }, [top, el('div', { class: 'lcv-console' }, [qpane, convPane, ctxHost]), mnav, linkbar, overlay]);
  mount(host, root);

  /* ----------------------------------------------------------- lifecycle */
  paintFilters(); loadPresence(); loadStats(); loadList(); loadCanned(); loadMisses();
  timers.push(setInterval(() => { loadStats(); loadList(true); }, LIST_MS));
  timers.push(setInterval(() => { if (S.activeId) loadConv(S.activeId, true); }, CONV_MS));
  timers.push(setInterval(heartbeat, BEAT_MS));
  timers.push(setInterval(() => { for (let i = 0; i < listTickers.length; i++) { try { listTickers[i](); } catch (e) { /* noop */ } } }, 1000));
  heartbeat();

  const onVis = () => { if (document.visibilityState === 'visible') { heartbeat(); loadStats(); loadList(true); if (S.activeId) loadConv(S.activeId, true); } };
  document.addEventListener('visibilitychange', onVis);
  const onDocClick = (e) => { if (!e.target.closest('.lcv-dd')) closeMenus(); };
  document.addEventListener('click', onDocClick);
  const onOver = (e) => {
    const b = e.target.closest('[data-href]');
    if (!b || !root.contains(b)) { linkbar.classList.remove('show'); return; }
    const k = b.dataset.kind || 'staff';
    linkbar.innerHTML = '<i>' + (k === 'customer' ? 'INSERTS LINK' : k === 'call' ? 'ACTION' : 'OPENS') + '</i><b>' + b.dataset.href + '</b>';
    linkbar.classList.add('show');
  };
  document.addEventListener('mouseover', onOver);
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      if (overlay.classList.contains('open')) { closeOverlay(); return; }
      if (drawerRef && drawerRef.close) { drawerRef.close(); drawerRef = null; return; }
      closeMenus(); cannedPop.style.display = 'none'; return;
    }
    const t = e.target || {}; const tg = (t.tagName || '').toLowerCase();
    if (tg === 'input' || tg === 'textarea' || tg === 'select' || t.isContentEditable) return;
    const rows = S.rows; const i = rows.findIndex(r => r.id === S.activeId);
    if ((e.key === 'j' || e.key === 'ArrowDown') && rows.length) { e.preventDefault(); select(rows[Math.min(rows.length - 1, i + 1)].id); }
    else if ((e.key === 'k' || e.key === 'ArrowUp') && rows.length) { e.preventDefault(); select(rows[Math.max(0, i < 0 ? 0 : i - 1)].id); }
    else if (e.key === 'e' && S.conv) resolveDialog(S.conv);
    else if (e.key === 't' && S.conv) takeOver(S.conv);
    else if (e.key === '/' && S.conv) { e.preventDefault(); input.focus(); toggleCanned(true); }
    else if (e.key === '?') openSheet();
    else if (/^[1-5]$/.test(e.key)) setTab(TABS[Number(e.key) - 1].k);
  };
  document.addEventListener('keydown', onKey);

  const obs = new MutationObserver(() => {
    if (document.body.contains(root)) return;
    timers.forEach(clearInterval); obs.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('mouseover', onOver);
    document.title = document.title.replace(/^\(\d+\) /, '');
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // #/live-chat?id=<n> — land on that conversation (notifications and e-mails use this).
  const boot = (location.hash.match(/[?&]id=(\d+)/) || [])[1];
  if (boot) select(Number(boot), true);

  async function heartbeat() {
    try { const p = await ccLcHeartbeat(); if (p && !p.error) { S.presence = p; paintPresence(); } } catch (e) { /* next beat */ }
  }

  /* ------------------------------------------------------------ presence */
  async function loadPresence() {
    let p; try { p = await ccLcPresenceGet(); } catch (e) { return; }
    if (!p || p.error) return;
    S.presence = p; paintPresence(true);
  }
  function paintPresence(rebuild) {
    const p = S.presence; if (!p) return;
    const stale = !!p.available && !p.online;
    const key = String(p.available) + stale + (p.staff_name || '');
    if (!rebuild && presHost.dataset.key === key) return;
    presHost.dataset.key = key;

    const nameIn = el('input', { class: 'lcv-in', placeholder: 'Your name', value: p.staff_name || '' });
    const desigIn = el('input', { class: 'lcv-in', placeholder: 'Designation', value: p.designation || 'Carrier Success Manager' });
    const emailIn = el('input', { class: 'lcv-in', placeholder: 'Alerts to: hello@loadboot.com', value: p.alert_email || '' });
    const save = async (available) => {
      try {
        const r = await ccLcPresenceSet(available, nameIn.value.trim(), desigIn.value.trim(), emailIn.value.trim() || null);
        if (r && r.error) throw new Error(r.error);
        toast(available ? 'You are LIVE — new handoffs carry your name' : 'Away — the AI promises an e-mail reply instead');
        loadPresence();
      } catch (e) { toast(humanizeError(e), 'error'); }
    };
    [nameIn, desigIn, emailIn].forEach(i => i.addEventListener('change', () => save(!!p.available)));
    const pop = el('div', { class: 'lcv-menu lcv-presmenu' }, [
      el('div', { class: 'lcv-mh' }, 'Shown to visitors as'), nameIn, desigIn,
      el('div', { class: 'lcv-mh' }, 'Handoff & SLA alerts go to'), emailIn,
      stale ? el('div', { class: 'lcv-pwarn' }, 'No heartbeat for 3 minutes — visitors are being told the team is offline. This tab was probably asleep; it is refreshing now.') : null,
      notifBtn(),
    ].filter(Boolean));
    const pill = el('div', { class: 'lcv-status' + (p.available ? (stale ? ' stale' : '') : ' off') }, [
      el('span', { class: 'lcv-bulb' }),
      el('span', { class: 'lcv-status-t', onclick: (e) => { e.stopPropagation(); toggleMenu('pres'); } },
        (stale ? 'Auto-away' : p.available ? 'Online' : 'Away') + ' · ' + (p.staff_name || 'set your name') + (p.designation ? ' (' + p.designation + ')' : '')),
      el('button', { class: 'lcv-sw', title: p.available ? 'Go away' : 'Go online', onclick: (e) => { e.stopPropagation(); e.currentTarget.disabled = true; save(!p.available); } }, el('b')),
    ]);
    mount(presHost, el('div', { class: 'lcv-dd' }, [pill, pop]));
    pop.dataset.menu = 'pres';
  }
  function notifBtn() {
    if (typeof Notification === 'undefined' || Notification.permission === 'granted') return null;
    const b = el('button', { class: 'lcv-btn sm', onclick: async () => {
      try { const p = await Notification.requestPermission(); if (p === 'granted') { b.remove(); toast('Desktop alerts on'); } }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, [ico('bell-ring'), 'Enable desktop alerts']);
    return b;
  }

  /* --------------------------------------------------------------- stats */
  async function loadStats() {
    let s; try { s = await ccLcStats(); } catch (e) { return; }
    if (!s || s.error) return;
    S.stats = s;
    const nh = Number(s.needs_human || 0);
    document.title = (nh > 0 ? '(' + nh + ') ' : '') + document.title.replace(/^\(\d+\) /, '');
    const m = (l, v, cls, title) => el('div', { class: 'lcv-m ' + (cls || ''), title: title || null }, [el('u', null, l), el('b', null, v)]);
    const med = s.median_first_reply_secs_7d, ans = s.handoffs_answered_15m_pct_7d, csat = s.csat_avg_30d, ai = s.ai_share_7d;
    mount(metricHost, [
      m('Waiting', String(nh), nh > 0 ? 'alert' : 'good', (s.unanswered_handoffs || 0) + ' never answered'),
      m('1st reply', med == null ? '—' : mmss(Number(med)), med == null ? '' : med > 900 ? 'alert' : med > 300 ? 'warn' : 'good', 'Median first staff reply, last 7 days'),
      m('<15 min', ans == null ? '—' : Math.round(ans) + '%', ans == null ? '' : ans < 80 ? 'alert' : ans < 95 ? 'warn' : 'good', (s.handoffs_7d || 0) + ' handoffs · 7d'),
      m('AI solved', ai == null ? '—' : Math.round(ai) + '%', '', (s.convs_7d || 0) + ' chats · 7d'),
      m('CSAT 30d', csat == null ? '—' : String(Math.round(csat * 10) / 10), csat == null ? '' : csat < 4 ? 'warn' : 'good', (s.csat_n_30d || 0) + ' ratings'),
    ]);
  }

  /* --------------------------------------------------------------- queue */
  function serverStatus() { return S.tab === 'closed' ? 'closed' : 'open'; }
  function rowIntent(c) { return classify((c.last_msg || '') + ' ' + (c.page || '')); }
  function visible(rows) {
    const t = TABS.find(x => x.k === S.tab) || TABS[0];
    return rows.filter(t.f)
      .filter(c => !S.rf.role || roleKey(c) === S.rf.role || (S.rf.role === 'broker' && roleKey(c) === 'partner') || (S.rf.role === 'agent' && roleKey(c) === 'referral'))
      .filter(c => !S.rf.intent || rowIntent(c) === S.rf.intent)
      .filter(c => !S.rf.lang || c.lang === S.rf.lang)
      .filter(c => !S.rf.flag || (S.rf.flag === 'leads' ? (!c.user_id && c.email) : S.rf.flag === 'rated' ? c.csat != null : true))
      .sort((a, b) => (stateOf(b) === 'wa') - (stateOf(a) === 'wa') || Number(b.waiting_secs || 0) - Number(a.waiting_secs || 0) || (ts(b.last_msg_at) || 0) - (ts(a.last_msg_at) || 0));
  }
  function paintTabs() {
    mount(tabsHost, TABS.map(t => {
      const n = S.rows.filter(t.f).length;
      return el('button', { class: 'lcv-qtab' + (S.tab === t.k ? ' on' : '') + (t.k === 'need' && n ? ' urgent' : ''), onclick: () => setTab(t.k) }, [t.l, el('s', null, String(n))]);
    }));
  }
  function paintFilters() {
    const chip = (g, v, txt, icon) => el('button', { class: 'lcv-fsel' + (S.rf[g] === v ? ' on' : ''), onclick: () => { S.rf[g] = S.rf[g] === v ? null : v; paintFilters(); paintList(S.rows); } }, [icon ? ico(icon) : null, txt].filter(Boolean));
    const none = !S.rf.role && !S.rf.intent && !S.rf.lang && !S.rf.flag;
    mount(filtHost, [
      el('button', { class: 'lcv-fsel' + (none ? ' on' : ''), onclick: () => { S.rf = { role: null, intent: null, lang: null, flag: null }; paintFilters(); paintList(S.rows); } }, 'All'),
      ...ROLE_FILTERS.map(r => chip('role', r, ROLES[r].lbl, ROLES[r].ic)),
      chip('flag', 'leads', 'Leads', 'target'), chip('flag', 'rated', 'Rated', 'star'), chip('lang', 'es', 'Español', 'globe'),
      ...INTENTS.map(x => chip('intent', x[0], x[1])),
    ]);
  }
  function setTab(k) {
    const was = serverStatus(); S.tab = k; paintTabs();
    if (serverStatus() !== was) loadList(); else paintList(S.rows);
  }
  function skeleton(n) {
    const out = []; for (let i = 0; i < n; i++) out.push(el('div', { class: 'lcv-sk' }, [el('span', { class: 'lcv-sk-a' }), el('span', { class: 'lcv-sk-b' }), el('span', { class: 'lcv-sk-c' })]));
    return out;
  }
  async function loadList(silent) {
    if (!silent) mount(rowsHost, skeleton(6));
    let rows;
    try { rows = await ccLcList(serverStatus(), S.search || null); }
    catch (e) { if (!silent) mount(rowsHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!rows || rows.error) { if (!silent) mount(rowsHost, el('div', { class: 'lb-state lb-error' }, (rows && rows.error) || 'Failed to load')); return; }
    S.rows = rows;
    if (serverStatus() === 'open') alerts(rows);
    paintTabs(); paintList(rows);
  }
  // Alerts fire on TRANSITIONS only — the same rule v2 used.
  function alerts(rows) {
    const nowHuman = new Set(); let fresh = null, mine = null;
    rows.forEach(c => {
      if (stateOf(c) === 'wa' && !c.first_staff_reply_at) { nowHuman.add(c.id); if (S.alerted && !S.needsHuman.has(c.id)) fresh = c; }
      const prev = S.lastMsgAt[c.id];
      if (S.alerted && c.assigned_me && prev && c.last_msg_at && c.last_msg_at !== prev && Number(c.staff_unread || 0) > 0) mine = c;
      S.lastMsgAt[c.id] = c.last_msg_at;
    });
    S.needsHuman = nowHuman;
    if (fresh) { beep(); toast(label(fresh) + ' needs a human'); notify('Someone needs a human', label(fresh) + (fresh.last_msg ? ' — ' + fresh.last_msg.slice(0, 120) : '')); fresh._pulse = true; }
    else if (mine) { beep(); notify('New message in your chat', label(mine) + (mine.last_msg ? ' — ' + mine.last_msg.slice(0, 120) : '')); }
    S.alerted = true;
    const breaches = rows.filter(c => stateOf(c) === 'wa' && Number(c.waiting_secs || 0) >= 120).length;
    bellBadge.textContent = String(breaches); bellBadge.style.display = breaches ? '' : 'none';
    const wa = rows.filter(c => stateOf(c) === 'wa').length, un = rows.reduce((a, c) => a + Number(c.staff_unread || 0), 0);
    const bq = mnavQ.querySelector('s'), bc = mnavC.querySelector('s');
    bq.textContent = String(wa); bq.style.display = wa ? 'grid' : 'none';
    bc.textContent = String(un); bc.style.display = un ? 'grid' : 'none';
  }
  function paintList(all) {
    listTickers = [];
    const rows = visible(all);
    footNormal.innerHTML = 'Sorted by <b>breach risk</b> · ' + rows.length + ' shown · ' + all.length + (serverStatus() === 'open' ? ' open' : ' closed');
    bulkN.textContent = String(S.sel.size);
    root.classList.toggle('lcv-bulk', S.sel.size > 0);
    if (!rows.length) {
      mount(rowsHost, el('div', { class: 'lcv-empty sm' }, [el('div', { class: 'lcv-empty-ico' }, ico('inbox')), el('b', null, S.search ? 'No match' : 'Nothing here'),
        el('p', null, S.search ? 'Try a company, an e-mail, or words from a message.' : 'New chats from the website or a portal land here within five seconds.')]));
      return;
    }
    mount(rowsHost, rows.map(c => {
      const R = roleOf(c), st = stateOf(c);
      const timer = el('span', { class: 'lcv-sla' });
      if (st === 'wa' && c.waiting_secs != null) {
        const base = Date.now() - Number(c.waiting_secs) * 1000;
        const paint = () => { const s = Math.floor((Date.now() - base) / 1000); timer.textContent = mmss(s); timer.className = 'lcv-sla ' + slaTone(s); };
        paint(); listTickers.push(paint);
      } else if (st === 'wc') { timer.innerHTML = icoHtml('corner-up-left') + ' replied'; }
      else if (st === 'closed') { timer.innerHTML = icoHtml('check') + ' closed'; timer.className = 'lcv-sla g'; }
      else timer.textContent = 'AI';
      const intent = rowIntent(c);
      const tags = [
        tag(R.lbl, 't-role', R.ic),
        tag(INTENT_LBL[intent], 't-int', null, 'Topic guessed from their words — not stored'),
        FRUSTRATED.test(c.last_msg || '') ? tag('Frustrated', 't-sent', 'frown', 'Wording suggests frustration') : null,
        c.assigned_email ? tag(c.assigned_me ? 'Mine' : String(c.assigned_email).split('@')[0], c.assigned_me ? 't-mine' : 't-role', 'user-round') : null,
        (!c.user_id && c.email) ? tag('Lead', 't-lead', 'target') : null,
        c.lang && c.lang !== 'en' ? tag(String(c.lang).toUpperCase(), 't-lang') : null,
        c.csat != null ? tag(String(c.csat), 't-lang', 'star') : null,
      ].filter(Boolean);
      const sel = el('span', { class: 'lcv-sel' + (S.sel.has(c.id) ? ' on' : ''), onclick: (e) => { e.stopPropagation(); S.sel.has(c.id) ? S.sel.delete(c.id) : S.sel.add(c.id); paintList(S.rows); } }, ico('check'));
      const row = el('div', { class: 'lcv-row' + (c.id === S.activeId ? ' on' : '') + (c._pulse ? ' pulse' : ''), dataset: { id: c.id }, onclick: () => select(c.id) }, [
        sel,
        el('div', { class: 'lcv-av', style: 'background:' + R.c }, [initials(label(c)), c.visitor_online ? el('span', { class: 'lcv-ondot', title: 'On the page right now' }) : null]),
        el('div', { class: 'lcv-rbody' }, [
          el('div', { class: 'lcv-r1' }, [el('b', null, label(c)), el('span', null, c.company || (c.origin === 'website' ? (c.page || 'website') : c.origin || '')), timer]),
          el('div', { class: 'lcv-r2' }, tags),
          el('div', { class: 'lcv-r3' }, splitSys(c.last_msg || '').rest || '—'),
        ]),
        Number(c.staff_unread || 0) > 0 ? el('span', { class: 'lcv-unread' }, String(c.staff_unread)) : null,
      ]);
      if (c._pulse) { c._pulse = false; setTimeout(() => row.classList.remove('pulse'), 2400); }
      return row;
    }));
  }
  async function bulk(what) {
    const ids = Array.from(S.sel); if (!ids.length) return;
    let ok = 0;
    for (const id of ids) {
      try { const r = what === 'close' ? await ccLcSetStatus(id, 'closed') : await ccLcAssign(id, true); if (!r || !r.error) ok++; } catch (e) { /* count below */ }
    }
    toast((what === 'close' ? 'Resolved ' : 'Took ') + ok + ' of ' + ids.length + (what === 'close' ? ' — each visitor gets the rating card' : ''));
    S.sel.clear(); loadList(true); if (S.activeId) loadConv(S.activeId, true);
  }

  /* -------------------------------------------------------- conversation */
  function select(id, silentHash) {
    S.activeId = id; S.seenIds = new Set(); S.lastDay = ''; S.conv = null;
    mount(msgsEl, ''); paintList(S.rows);
    if (!silentHash) { try { history.replaceState(null, '', chatLink(id)); } catch (e) { /* ignore */ } }
    if (window.matchMedia('(max-width:820px)').matches) view('c');
    loadConv(id);
  }
  async function loadConv(id, silent) {
    if (!silent) { convEmpty.style.display = 'none'; convLive.style.display = ''; mount(msgsEl, el('div', { class: 'lb-state lb-loading' }, 'Loading conversation…')); }
    let c; try { c = await ccLcGet(id); }
    catch (e) { if (!silent) mount(msgsEl, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!c || c.error) { if (!silent) mount(msgsEl, el('div', { class: 'lb-state lb-error' }, (c && c.error) || 'Not found')); return; }
    if (id !== S.activeId) return;
    S.conv = c;
    convEmpty.style.display = 'none'; convLive.style.display = '';
    if (!silent) mount(msgsEl, '');
    paintHead(c); paintPlaybar(c); paintMessages(c, !silent); paintComposer(c); paintContext(c);
    typingEl.style.display = c.visitor_typing ? '' : 'none';
  }
  function firstAsk(c) {
    const m = (c.messages || []).find(x => x.sender === 'visitor' && splitSys(x.body).rest && !/^\[\[/.test(x.body));
    return m ? parseDirectives(splitSys(m.body).rest).text.slice(0, 110) : '';
  }
  function convIntent(c) { return classify((c.messages || []).filter(x => x.sender === 'visitor').map(x => x.body).join(' ') + ' ' + (c.page || '')); }
  function ent(text, href, kind, onclick) {
    return el('span', { class: 'lcv-ent', dataset: { href, kind: kind || 'staff' }, onclick: onclick || (() => go(href, kind)) }, text);
  }
  function go(href, kind) {
    if (kind === 'customer') { insertLink(href); return; }
    if (/^https?:/.test(href)) { window.open(href, '_blank', 'noopener'); return; }
    location.hash = href;
  }
  function insertLink(url, title) {
    const cur = input.value.trim();
    input.value = (cur ? cur + '\n' : '') + (title ? title + ': ' : '') + url;
    input.focus(); autoGrow();
    toast('Link inserted — press Send when the message reads right');
  }
  async function takeOver(c) {
    try { const r = await ccLcAssign(c.id, true); if (r && r.error) throw new Error(r.error); toast('You are on it — the AI is paused here'); loadConv(c.id, true); loadList(true); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }
  function paintHead(c) {
    const R = roleOf(c), v = verified(c), st = stateOf(c), a = c.account || {};
    const org = a.org_id || null;
    const taken = c.assigned_me && c.bot_paused;
    const acts = [];
    if (st !== 'closed') {
      if (!taken) acts.push(el('button', { class: 'lcv-btn pri', onclick: () => takeOver(c) }, [ico('hand'), c.bot_paused ? 'Join' : 'Take over from AI']));
      if (c.bot_paused) acts.push(el('button', { class: 'lcv-btn', title: 'The AI answers again from the next visitor message', onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { const r = await ccLcBotResume(c.id); if (r && r.error) throw new Error(r.error); toast('Handed back to the AI'); loadConv(c.id, true); loadList(true); }
        catch (e) { toast(humanizeError(e), 'error'); }
      } }, [ico('bot'), 'Hand back to AI']));
    }
    acts.push(el('button', { class: 'lcv-btn icon', title: 'Riley calls this person back', onclick: () => openCallback(c) }, ico('phone')));
    acts.push(st === 'closed'
      ? el('button', { class: 'lcv-btn', onclick: () => setStatus(c, 'open') }, [ico('refresh-cw'), 'Reopen'])
      : el('button', { class: 'lcv-btn', onclick: () => resolveDialog(c) }, [ico('check'), 'Resolve']));
    const more = el('div', { class: 'lcv-menu' }, [
      el('button', { onclick: () => { copy(location.origin + location.pathname + chatLink(c.id)); closeMenus(); } }, [ico('link'), 'Copy link to this chat', el('small', null, chatLink(c.id))]),
      el('button', { onclick: () => { closeMenus(); openTraining(); } }, [ico('brain'), 'Train the AI', el('small', null, S.misses ? S.misses + ' misses' : '')]),
      el('button', { onclick: () => { closeMenus(); openCalls(); } }, [ico('phone'), 'Recent calls']),
      el('button', { onclick: () => { closeMenus(); location.hash = '#/live-chat?v=2'; } }, [ico('history'), 'Open in the old console', el('small', null, 'v2')]),
      el('button', { onclick: () => { closeMenus(); openSheet(); } }, [ico('keyboard'), 'Shortcuts', el('small', null, '?')]),
    ]);
    more.dataset.menu = 'more';
    acts.push(el('div', { class: 'lcv-dd' }, [el('button', { class: 'lcv-btn icon', onclick: (e) => { e.stopPropagation(); toggleMenu('more'); } }, ico('ellipsis')), more]));

    const sub = [el('span', null, c.company || (c.origin === 'website' ? 'Website visitor' : (c.origin || 'chat')))];
    if (c.mc) sub.push(org ? ent(c.mc, '#/carrier?id=' + org) : el('span', { class: 'lcv-ent static' }, c.mc));
    if (c.dot) sub.push(ent(c.dot + ' · SAFER', 'https://safer.fmcsa.dot.gov/query.asp?query_type=queryCarrierSnapshot&query_param=USDOT&query_string=' + encodeURIComponent(String(c.dot).replace(/\D/g, '')), 'staff'));
    sub.push(ent('#' + c.id, chatLink(c.id), 'staff', () => copy(location.origin + location.pathname + chatLink(c.id))));
    sub.push(el('span', null, (c.messages || []).length + ' msgs'));
    if (st === 'wa' && c.waiting_secs != null) sub.push(el('span', { class: 'lcv-waitt' }, 'waiting ' + mmss(Number(c.waiting_secs))));
    if (c.visitor_online) sub.push(el('span', { class: 'lcv-onpage', html: '<span class="lcv-ldot"></span> on ' + (c.page || 'the page') }));
    else if (c.page) sub.push(el('span', null, 'last on ' + c.page));

    const ask = firstAsk(c);
    mount(convHead, [
      el('button', { class: 'lcv-btn sm lcv-back', title: 'Back to queue', onclick: () => view('q') }, ico('chevron-left')),
      el('div', { class: 'lcv-av lg', style: 'background:' + R.c }, [initials(label(c)), c.visitor_online ? el('span', { class: 'lcv-ondot' }) : null]),
      el('div', { class: 'lcv-cwho' }, [
        el('h2', null, [label(c), el('span', { class: 'lcv-vpill ' + v.cls }, v.txt), tag(R.lbl, 't-role', R.ic),
          el('span', { class: 'lcv-state ' + STATE[st][1] }, STATE[st][0]),
          c.bot_paused && c.bot_paused_by_name ? tag(c.bot_paused_by_name, 't-mine', 'user-round', 'Human in charge') : null,
          c.lang === 'es' ? tag('ES', 't-lang') : null].filter(Boolean)),
        el('div', { class: 'lcv-sub' }, sub.reduce((acc, n, i) => { if (i) acc.push(el('i', null, '·')); acc.push(n); return acc; }, [])),
        ask ? el('div', { class: 'lcv-why', html: icoHtml('target') + ' <span><b>First asked:</b> ' + richText(ask) + '</span><em>' + INTENT_LBL[convIntent(c)] + '</em>' }) : null,
      ].filter(Boolean)),
      el('div', { class: 'lcv-cacts' }, acts),
    ]);
  }
  function paintPlaybar(c) {
    const R = roleOf(c);
    mount(playbar, [el('span', { class: 'lcv-lbl' }, R.lbl + ' playbook')].concat(playbook(c).map(p => actionBtn(c, p, 'sm'))));
  }
  function actionBtn(c, p, cls) {
    if (p.k === 'call') return el('button', { class: 'lcv-btn ' + (cls || ''), dataset: { href: 'Riley callback (cc_retell_callback)', kind: 'call' }, onclick: () => openCallback(c) }, [ico(p.ic), p.t]);
    if (p.k === 'send') { const L = CUSTOMER_LINKS[p.card]; return el('button', { class: 'lcv-btn ' + (cls || ''), dataset: { href: L.u, kind: 'customer' }, onclick: () => insertLink(L.u, L.t) }, [ico(p.ic), p.t]); }
    return el('button', { class: 'lcv-btn ' + (cls || ''), dataset: { href: p.h, kind: 'staff' }, onclick: () => go(p.h, 'staff') }, [ico(p.ic), p.t]);
  }
  function paintMessages(c, force) {
    const list = c.messages || [];
    if (force) { S.seenIds = new Set(); S.lastDay = ''; mount(msgsEl, ''); }
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90;
    let added = 0;
    list.forEach(m => {
      const key = m.id != null ? String(m.id) : (m.at + '|' + m.sender + '|' + String(m.body).slice(0, 24));
      if (S.seenIds.has(key)) return;
      S.seenIds.add(key);
      const dk = dayKey(m.at);
      if (dk && dk !== S.lastDay) { S.lastDay = dk; msgsEl.appendChild(el('div', { class: 'lcv-day' }, el('span', null, dayLabel(m.at)))); }
      msgsEl.appendChild(bubble(m, c)); added++;
    });
    if (added && (nearBottom || force)) msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function bubble(m, c) {
    const sys = splitSys(m.body); const d = parseDirectives(sys.rest);
    if (sys.sys) return el('div', { class: 'lcv-sys' }, el('span', { html: richText(d.text) }));
    if (d.note) return el('div', { class: 'lcv-inote' }, el('span', { html: icoHtml('lock') + ' ' + richText(d.text) }));
    const side = m.sender === 'staff' ? 's' : m.sender === 'bot' ? 'b' : 'v';
    const R = roleOf(c);
    const who = side === 'b' ? 'LoadBoot AI' : side === 's' ? (m.staff_name || 'LoadBoot') : label(c);
    const acts = el('div', { class: 'lcv-mact' }, [
      el('button', { onclick: () => copy(d.text) }, [ico('copy'), 'Copy']),
      side === 'v' ? el('button', { title: 'Teach the AI this question', onclick: () => openTeach(d.text) }, [ico('brain'), 'Teach AI']) : null,
    ].filter(Boolean));
    return el('div', { class: 'lcv-msg ' + side }, [
      acts,
      el('div', { class: 'lcv-mav', style: 'background:' + (side === 'v' ? R.c : side === 'b' ? '#7c3aed' : '#0883F7') }, side === 'v' ? initials(label(c)) : side === 'b' ? 'AI' : initials(who)),
      el('div', null, [
        d.text ? el('div', { class: 'lcv-bub', html: richText(d.text) }) : null,
        d.chips.length ? el('div', { class: 'lcv-chipsrow' }, d.chips.map(ch => el('span', { class: 'lcv-offer' }, ch))) : null,
        d.askedFor ? el('span', { class: 'lcv-hint' }, '↳ asked for ' + d.askedFor) : null,
        d.callback ? el('span', { class: 'lcv-hint' }, '↳ offered a callback') : null,
        el('div', { class: 'lcv-meta' }, who + ' · ' + clock(m.at)),
      ].filter(Boolean)),
    ]);
  }
  function paintComposer(c) {
    const open = c.status === 'open';
    aiNote.style.display = (open && !c.bot_paused) ? '' : 'none';
    closedNote.style.display = open ? 'none' : '';
    input.disabled = !open; sendBtn.disabled = !open;
    input.placeholder = open ? 'Reply to ' + label(c).split(' ')[0] + '…   /  saved replies' : 'This conversation is closed.';
    mount(linkMenu, [el('div', { class: 'lcv-mh' }, 'Insert a portal link — lands on the exact screen')].concat(
      Object.keys(CUSTOMER_LINKS).map(k => el('button', { onclick: () => { insertLink(CUSTOMER_LINKS[k].u, CUSTOMER_LINKS[k].t); closeMenus(); } },
        [ico('external-link'), CUSTOMER_LINKS[k].t, el('small', null, CUSTOMER_LINKS[k].u.replace('https://loadboot.com', ''))]))));
    linkMenu.dataset.menu = 'links';
  }
  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; }
  async function send() {
    const c = S.conv; if (!c) return;
    const body = input.value.trim(); if (!body || c.status !== 'open') return;
    const keep = input.value; input.value = ''; autoGrow(); cannedPop.style.display = 'none'; sendBtn.disabled = true;
    try {
      const r = await ccLcReply(c.id, body); if (r && r.error) throw new Error(r.error);
      await loadConv(c.id, true); msgsEl.scrollTop = msgsEl.scrollHeight; loadList(true);
    } catch (e) { input.value = keep; autoGrow(); toast(humanizeError(e), 'error'); }
    sendBtn.disabled = c.status !== 'open';
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Escape') cannedPop.style.display = 'none';
  });
  input.addEventListener('input', () => {
    autoGrow();
    const v = input.value;
    if (v.charAt(0) === '/') { renderCanned(v.slice(1).trim()); cannedPop.style.display = ''; } else cannedPop.style.display = 'none';
    if (!v.trim() || !S.activeId) return;
    const now = Date.now(); if (now - S.lastTyping < TYPE_MS) return;
    S.lastTyping = now; ccLcTyping(S.activeId).catch(() => { /* best-effort */ });
  });
  async function setStatus(c, status) {
    try { const r = await ccLcSetStatus(c.id, status); if (r && r.error) throw new Error(r.error); toast(status === 'closed' ? 'Resolved — the visitor is asked to rate it' : 'Reopened'); loadConv(c.id, true); loadList(true); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }
  function resolveDialog(c) {
    if (c.status !== 'open') return;
    openOverlay(el('div', { class: 'lcv-modal' }, [
      el('h3', null, 'Resolve #' + c.id + ' · ' + label(c)),
      el('p', null, 'The widget shows the visitor a rating card and the AI stops answering this thread. Reopen any time.'),
      el('div', { class: 'lcv-mf' }, [el('button', { class: 'lcv-btn', onclick: closeOverlay }, 'Cancel'),
        el('button', { class: 'lcv-btn pri', onclick: () => { closeOverlay(); setStatus(c, 'closed'); } }, [ico('check'), 'Resolve'])]),
    ]));
  }

  /* --------------------------------------------------------------- canned */
  function toggleCanned(force) {
    const showing = cannedPop.style.display !== 'none';
    if (showing && !force) { cannedPop.style.display = 'none'; return; }
    renderCanned(''); cannedPop.style.display = ''; input.focus();
  }
  async function loadCanned() { try { const r = await ccLcCannedList(); if (Array.isArray(r)) S.canned = r; } catch (e) { /* optional */ } }
  function renderCanned(q) {
    const needle = String(q || '').toLowerCase();
    const intent = S.conv ? INTENT_LBL[convIntent(S.conv)].toLowerCase() : '';
    const rows = S.canned.filter(x => !needle || (x.title + ' ' + x.body).toLowerCase().includes(needle))
      .sort((a, b) => Number((b.title + b.body).toLowerCase().includes(intent.split(' ')[0])) - Number((a.title + a.body).toLowerCase().includes(intent.split(' ')[0])));
    const title = el('input', { class: 'lcv-in', placeholder: 'Title' }); const body = el('textarea', { class: 'lcv-in', rows: '2', placeholder: 'Reply text' });
    mount(cannedPop, [
      el('div', { class: 'lcv-mh' }, 'Saved replies' + (intent ? ' · ' + intent + ' first' : '') + ' · Esc closes'),
      rows.length ? rows.map(x => el('div', { class: 'lcv-mi' }, [
        el('div', { class: 'lcv-mi-t', onclick: () => { input.value = x.body; input.focus(); autoGrow(); cannedPop.style.display = 'none'; } }, [el('b', null, x.title), el('s', null, x.body)]),
        el('button', { class: 'lcv-mi-x', title: 'Delete', onclick: async (e) => { e.stopPropagation(); try { await ccLcCannedDelete(x.id); await loadCanned(); renderCanned(q); } catch (err) { toast(humanizeError(err), 'error'); } } }, ico('x')),
      ])) : el('div', { class: 'lcv-mi' }, el('s', null, needle ? 'No saved reply matches.' : 'No saved replies yet — add one below.')),
      el('div', { class: 'lcv-mi-new' }, [title, body, el('button', { class: 'lcv-btn sm', onclick: async () => {
        if (!title.value.trim() || !body.value.trim()) { toast('Title and text are both required.', 'error'); return; }
        try { const r = await ccLcCannedSave(title.value.trim(), body.value.trim()); if (r && r.error) throw new Error(r.error); await loadCanned(); renderCanned(''); toast('Saved'); }
        catch (e) { toast(humanizeError(e), 'error'); }
      } }, [ico('pen-line'), 'Save reply'])]),
    ]);
  }

  /* -------------------------------------------------------------- context */
  function card(title, iconName, kids, extra) {
    return el('div', { class: 'lcv-card' + (extra ? ' ' + extra : '') }, [el('h4', null, [ico(iconName), title]), el('div', { class: 'lcv-cbody' }, kids)]);
  }
  function kv(k, v) { return el('div', { class: 'lcv-kv' }, [el('u', null, k), el('b', null, v == null || v === '' ? '—' : v)]); }
  function ring(done, total) {
    const pct = total ? Math.round(done / total * 100) : 0, dash = 2 * Math.PI * 22, off = dash * (1 - pct / 100);
    const color = pct >= 100 ? '#16a34a' : pct >= 50 ? '#0883F7' : '#f59e0b';
    return el('div', { class: 'lcv-ring', html: '<svg width="54" height="54"><circle cx="27" cy="27" r="22" stroke="#e8eef6" stroke-width="5" fill="none"/>'
      + '<circle cx="27" cy="27" r="22" stroke="' + color + '" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="' + dash + '" stroke-dashoffset="' + off + '"/></svg><b>' + pct + '%</b>' });
  }
  function paintContext(c) {
    const R = roleOf(c), a = c.account, org = a && a.org_id;
    const kids = [];
    kids.push(el('div', { class: 'lcv-dhead' }, [el('button', { class: 'lcv-btn sm lcv-back', onclick: () => view('c') }, ico('chevron-left')), el('b', null, 'Details'), ent('#' + c.id, chatLink(c.id), 'staff', () => copy(location.origin + location.pathname + chatLink(c.id)))]));
    if (a) {
      kids.push(el('div', { class: 'lcv-ctxhead' }, [ring(Number(a.verified || 0), Number(a.total || 0)),
        el('div', null, [el('b', null, a.org_name || label(c)), el('div', { class: 'lcv-sub2' }, (a.org_status || 'status unknown') + (a.payment_status ? ' · payment ' + a.payment_status : ''))])]));
      const comp = a.compliance || [];
      const bad = comp.filter(x => !/^(ok|approved|verified|valid|active)$/i.test(x.status || ''));
      const rowsC = (bad.length ? bad.concat(comp.filter(x => bad.indexOf(x) < 0)) : comp).map(x => {
        const k = /^(ok|approved|verified|valid|active)$/i.test(x.status || '') ? 'ok' : /reject|expired|fail|missing/i.test(x.status || '') ? 'bad' : 'warn';
        return el('div', { class: 'lcv-blk' }, [el('span', { class: 'lcv-d ' + k }), el('div', null, [el('b', null, x.name), el('p', null, (x.status || 'missing') + (x.note ? ' — ' + x.note : ''))])]);
      });
      kids.push(bad.length
        ? card('Blocking this person', 'triangle-alert', rowsC, 'bad')
        : card('Account health', 'circle-check', rowsC.length ? rowsC : [el('div', { class: 'lcv-sub2' }, 'No compliance items on file.')]));
    }
    kids.push(card('Next best actions', 'zap', el('div', { class: 'lcv-qa' }, playbook(c).slice(0, 4).map(p => actionBtn(c, p, 'sm')))));
    const links = [];
    if (org) { links.push(['Carrier 360', '#/carrier?id=' + org, 'id-card'], ['Documents', '#/carrier?id=' + org + '&tab=documents', 'file-text'], ['Fleet', '#/fleet?org=' + org, 'truck']); }
    if (roleKey(c) === 'partner' || roleKey(c) === 'broker') links.push(['Partners', '#/partners', 'building-2'], ['Broker trust', '#/broker-trust', 'shield-check']);
    if (roleKey(c) === 'dispatcher') links.push(['Dispatchers', '#/dispatchers', 'headset']);
    if (roleKey(c) === 'agent' || roleKey(c) === 'referral') links.push(['Agents', '#/agents', 'handshake']);
    if (!c.user_id) links.push(['CRM & leads', '#/crm', 'target']);
    links.push(['Recent calls', 'calls', 'phone']);
    kids.push(card('Open in Command Center', 'arrow-up-right', links.map(l => el('div', { class: 'lcv-ctxlink', dataset: { href: l[1] === 'calls' ? 'Recent calls drawer' : l[1], kind: 'staff' },
      onclick: () => { if (l[1] === 'calls') openCalls(); else go(l[1], 'staff'); } }, [ico(l[2]), l[0], el('s', null, l[1] === 'calls' ? 'drawer' : l[1])]))));
    kids.push(card('Identity', 'user-round', [
      kv('Role', R.lbl), (c.mc || c.dot) ? kv('MC / DOT', (c.mc || '—') + ' / ' + (c.dot || '—')) : null,
      c.email ? el('div', { class: 'lcv-kv' }, [el('u', null, 'Email'), el('a', { href: 'mailto:' + c.email }, c.email)]) : kv('Email', null),
      kv('Signed in', c.user_id ? 'Yes' : 'No — anonymous'), kv('Company', c.company), kv('Profile', c.profile_status),
      c.page ? el('div', { class: 'lcv-kv' }, [el('u', null, 'On page'), el('a', { href: c.page, target: '_blank', rel: 'noopener noreferrer' }, String(c.page).slice(0, 40))]) : null,
      kv('Language', c.lang === 'es' ? 'Español' : 'English'), kv('Source', c.origin),
    ].filter(Boolean)));
    if (a) kids.push(card('Equipment (' + (a.trucks || []).length + ')', 'truck', (a.trucks || []).length
      ? (a.trucks || []).map(t => el('div', { class: 'lcv-truck' }, [ico('truck'), el('span', null, (t.unit || '—') + ' · ' + (t.equipment || '—')), el('s', { class: t.vin_on_file ? 'ok' : 'no' }, t.vin_on_file ? 'VIN on COI' : 'no VIN')]))
      : [el('div', { class: 'lcv-sub2' }, 'No trucks added yet.')]));
    const calls = c.calls || [];
    kids.push(card('Calls (' + calls.length + ')', 'phone', (calls.length ? calls.slice(0, 5).map(x => el('div', { class: 'lcv-hist' }, [
      el('b', null, (x.direction === 'outbound' ? '↗ ' : '↘ ') + (x.status || '—') + (x.duration_sec != null ? ' · ' + Math.floor(x.duration_sec / 60) + 'm ' + (x.duration_sec % 60) + 's' : '')),
      el('span', null, fmtDateTime(x.at || x.scheduled_at) + (x.summary ? ' — ' + x.summary : '')),
    ])) : [el('div', { class: 'lcv-sub2' }, 'No calls with this person yet.')]).concat([el('button', { class: 'lcv-btn sm', onclick: () => openCallback(c) }, [ico('phone'), 'Call back'])])));
    kids.push(card('Rating', 'star', c.csat != null
      ? [el('div', { class: 'lcv-stars' }, '★'.repeat(Math.max(0, Math.min(5, Number(c.csat)))) + '☆'.repeat(Math.max(0, 5 - Number(c.csat)))),
         c.csat_comment ? el('div', { class: 'lcv-quote' }, '“' + c.csat_comment + '”') : null, el('div', { class: 'lcv-sub2' }, fmtDateTime(c.csat_at))].filter(Boolean)
      : [el('div', { class: 'lcv-sub2' }, 'Not rated yet — the rating card appears when you resolve the chat.')]));
    const first = ts(c.first_staff_reply_at), hand = ts(c.handoff_at);
    const gapMin = (first != null && hand != null) ? Math.round((first - hand) / 60000) : null;
    kids.push(card('This conversation', 'clock', [
      kv('Started', fmtDateTime(c.created_at)), kv('Asked for a human', c.handoff_at ? fmtDateTime(c.handoff_at) : 'never — AI handled it'),
      kv('First staff reply', c.first_staff_reply_at ? fmtDateTime(c.first_staff_reply_at) : 'not yet'),
      gapMin != null ? el('div', { class: 'lcv-kv' }, [el('u', null, 'Answered in'), el('b', { class: gapMin > 15 ? 'lcv-bad' : 'lcv-good' }, gapMin + ' min')]) : null,
      kv('Messages', String((c.messages || []).length)),
    ].filter(Boolean)));
    mount(ctxHost, kids);
  }

  /* ------------------------------------------------------------- overlays */
  function openOverlay(node) { mount(overlay, node); overlay.classList.add('open'); }
  function closeOverlay() { overlay.classList.remove('open'); mount(overlay, ''); }
  function toggleMenu(id) {
    const open = S.menu === id; closeMenus(); if (open) return;
    const m = root.querySelector('.lcv-menu[data-menu="' + id + '"]'); if (m) { m.classList.add('open'); S.menu = id; }
  }
  function closeMenus() { root.querySelectorAll('.lcv-menu.open').forEach(m => m.classList.remove('open')); drawer.classList.remove('open'); S.menu = null; }
  function view(v) {
    S.view = v; root.dataset.v = v;
    [mnavQ, mnavC, mnavD].forEach((b, i) => b.classList.toggle('on', 'qcd'[i] === v));
    if (v === 'c') msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function toggleAlerts() {
    if (drawer.classList.contains('open')) { drawer.classList.remove('open'); return; }
    closeMenus();
    const items = S.rows.filter(c => stateOf(c) === 'wa' && Number(c.waiting_secs || 0) >= 120)
      .sort((a, b) => Number(b.waiting_secs) - Number(a.waiting_secs))
      .map(c => ({ k: 'bad', t: label(c) + ' waiting ' + mmss(Number(c.waiting_secs)), p: INTENT_LBL[rowIntent(c)] + ' · ' + (splitSys(c.last_msg || '').rest || '').slice(0, 70), id: c.id }));
    S.rows.filter(c => c.csat != null && Number(c.csat) <= 2).slice(0, 3).forEach(c => items.push({ k: 'warn', t: 'Low rating ★' + c.csat + ' · ' + label(c), p: c.csat_comment || 'no comment', id: c.id }));
    if (S.misses) items.push({ k: 'warn', t: S.misses + ' questions the AI could not answer', p: 'Teach one and it knows it instantly', train: true });
    mount(drawer, [el('div', { class: 'lcv-dh' }, [el('b', null, 'Alerts'), el('small', null, items.length ? items.length + ' open' : 'all clear')])].concat(items.length
      ? items.map(i => el('div', { class: 'lcv-ni', onclick: () => { drawer.classList.remove('open'); if (i.train) openTraining(); else select(i.id); } },
          [el('span', { class: 'lcv-d ' + i.k }), el('div', null, [el('b', null, i.t), el('p', null, i.p)])]))
      : [el('div', { class: 'lcv-ni' }, el('div', null, [el('b', null, 'Nothing needs you right now'), el('p', null, 'Breaches over 2 minutes, low ratings and AI misses show up here.')]))]));
    drawer.classList.add('open');
  }
  function openPalette() {
    const q = el('input', { class: 'lcv-palq', placeholder: 'Search chats, MC#, people — or jump to any screen…' });
    const list = el('div', { class: 'lcv-pall' });
    const draw = () => {
      const needle = q.value.toLowerCase().trim();
      const item = (b, s, code, fn) => el('div', { class: 'lcv-pi', onclick: fn }, [el('b', null, b), el('span', null, s || ''), code ? el('code', null, code) : null].filter(Boolean));
      const chats = S.rows.filter(c => !needle || (label(c) + ' ' + (c.company || '') + ' ' + (c.mc || '') + ' ' + (c.email || '') + ' ' + (c.last_msg || '')).toLowerCase().includes(needle)).slice(0, 6)
        .map(c => item(label(c), splitSys(c.last_msg || '').rest, chatLink(c.id), () => { closeOverlay(); select(c.id); }));
      const scr = SCREENS.filter(s => !needle || s[0].toLowerCase().includes(needle)).map(s => item(s[0], 'screen', s[1], () => { closeOverlay(); location.hash = s[1]; }));
      const acts = [['Toggle my presence', () => { const b = presHost.querySelector('.lcv-sw'); if (b) b.click(); }], ['Resolve current chat', () => S.conv && resolveDialog(S.conv)],
        ['Take over current chat', () => S.conv && takeOver(S.conv)], ['Train the AI', openTraining], ['Recent calls', openCalls], ['Search messages on the server for "' + q.value + '"', () => { S.search = q.value.trim(); loadList(); }]]
        .filter(a => !needle || a[0].toLowerCase().includes(needle) || a[0].startsWith('Search')).map(a => item(a[0], 'action', null, () => { closeOverlay(); a[1](); }));
      mount(list, [chats.length ? el('div', { class: 'lcv-ph' }, 'Conversations (loaded)') : null, ...chats, scr.length ? el('div', { class: 'lcv-ph' }, 'Screens') : null, ...scr, el('div', { class: 'lcv-ph' }, 'Actions'), ...acts].filter(Boolean));
    };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = list.querySelector('.lcv-pi'); if (f) f.click(); } });
    openOverlay(el('div', { class: 'lcv-pal' }, [q, list, el('div', { class: 'lcv-pf', html: '<span>↵ open first</span><span>esc close</span><span>"Search messages" runs the server-side search</span>' })]));
    draw(); q.focus();
  }
  function openSheet() {
    openOverlay(el('div', { class: 'lcv-modal' }, [el('h3', null, 'Keyboard'),
      el('div', { class: 'lcv-kr', html: '<div><kbd>J</kbd><kbd>K</kbd> next / previous chat</div><div><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline</div><div><kbd>/</kbd> saved replies</div><div><kbd>E</kbd> resolve</div><div><kbd>T</kbd> take over</div><div><kbd>1</kbd>–<kbd>5</kbd> queue tabs</div><div><kbd>⌘K</kbd> palette</div><div><kbd>Esc</kbd> close</div>' }),
      el('div', { class: 'lcv-mf' }, el('button', { class: 'lcv-btn pri', onclick: closeOverlay }, 'Done'))]));
  }

  /* -------------------------------------------------------------- drawers */
  function openCallback(c) {
    const phone = el('input', { class: 'cc-input', placeholder: 'US phone e.g. +15551234567' });
    const nm = el('input', { class: 'cc-input', placeholder: 'Their name (Riley uses it)', value: (c && c.name) || '' });
    const tp = el('input', { class: 'cc-input', placeholder: 'Topic they asked about (e.g. detention pay)' });
    const rl = el('select', { class: 'cc-input' }, ['carrier', 'broker', 'shipper', 'dispatcher', 'other'].map(r => el('option', { value: r, selected: (c && c.visitor_role) === r ? 'selected' : null }, r)));
    const ctxIn = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Context for Riley — she uses it naturally on the call' });
    const when = el('input', { class: 'cc-input', type: 'datetime-local' });
    if (c && c.messages) ctxIn.value = c.messages.slice(-4).map(m => (m.sender === 'visitor' ? 'Them: ' : 'Us: ') + splitSys(m.body).rest).join('\n').slice(0, 600);
    const go2 = el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
      const b = ev.currentTarget;
      if (!phone.value.trim()) { toast('A phone number is required.', 'error'); return; }
      b.disabled = true; b.textContent = 'Dialing…';
      try {
        const r = await ccRetellCallback({ to: phone.value.trim(), name: nm.value.trim() || null, topic: tp.value.trim() || null, role: rl.value, context: ctxIn.value || null, when: when.value ? new Date(when.value).toISOString() : null });
        if (r && r.error) throw new Error(r.error);
        toast(r.scheduled ? 'Call scheduled' : 'Riley is calling them now');
        if (drawerRef && drawerRef.close) { drawerRef.close(); drawerRef = null; }
        if (S.activeId) loadConv(S.activeId, true);
      } catch (e) { toast(humanizeError(e), 'error'); }
      b.disabled = false; b.textContent = 'Riley calls them';
    } }, 'Riley calls them');
    drawerRef = openDrawer('Call this person back', el('div', { class: 'cc-form' }, [
      el('p', { class: 'cc-sub' }, 'Callback ONLY for people who asked for a call. Never cold lists.'),
      phone, nm, tp, rl, ctxIn, el('label', { class: 'cc-sub' }, 'Schedule (optional — empty means call right now)'), when, go2,
    ]), { subtitle: c ? label(c) : '' });
  }
  async function loadMisses() {
    let rows; try { rows = await ccLcMisses(); } catch (e) { return; }
    if (!rows || rows.error) return;
    S.misses = rows.length;
  }
  // Teach straight from a visitor's message — cc_lc_teach accepts a null miss id.
  function openTeach(question) {
    const kw = el('input', { class: 'cc-input', placeholder: 'Keywords, comma separated', value: String(question || '').replace(/[?!.]/g, '').split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(', ') });
    const ans = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'The answer the AI should give (links allowed)' });
    const b = el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
      if (!kw.value.trim() || !ans.value.trim()) { toast('Keywords and an answer are both required.', 'error'); return; }
      ev.currentTarget.disabled = true;
      try { const r = await ccLcTeach(null, kw.value, ans.value); if (r && r.error) throw new Error(r.error); toast('The AI learned it'); if (drawerRef && drawerRef.close) drawerRef.close(); drawerRef = null; }
      catch (e) { toast(humanizeError(e), 'error'); ev.currentTarget.disabled = false; }
    } }, 'Teach');
    drawerRef = openDrawer('Teach the AI', el('div', { class: 'cc-form' }, [el('p', { class: 'cc-sub' }, '“' + question + '”'), kw, ans, b]), { subtitle: 'Writes to lc_kb at priority 3 — live on the next message' });
  }
  async function openTraining() {
    const body = el('div', null, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    drawerRef = openDrawer('Train the AI', body, { subtitle: 'Questions the AI could not answer — teach one and it knows it instantly' });
    const paint = async () => {
      let rows; try { rows = await ccLcMisses(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
      if (!rows || rows.error) { mount(body, el('div', { class: 'lb-state lb-error' }, (rows && rows.error) || 'Failed')); return; }
      S.misses = rows.length;
      if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'Nothing waiting — the AI answered everything it was asked.')); return; }
      mount(body, rows.map(m => {
        const kw = el('input', { class: 'cc-input', placeholder: 'Keywords, comma separated (e.g. insurance cost, monthly insurance)' });
        const ans = el('input', { class: 'cc-input', placeholder: 'The answer the bot should give (links allowed)' });
        return el('div', { class: 'lcv-miss' }, [
          el('div', { class: 'lcv-miss-q' }, [el('b', null, '“' + m.question + '”'), tag(m.n + '×', m.n > 2 ? 't-sent' : 't-lang'), el('span', { class: 'lcv-sub2' }, fmtDateTime(m.last_seen))]),
          kw, ans,
          el('div', { class: 'lcv-miss-a' }, [
            el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
              if (!kw.value.trim() || !ans.value.trim()) { toast('Keywords and an answer are both required.', 'error'); return; }
              ev.currentTarget.disabled = true;
              try { const r = await ccLcTeach(m.id, kw.value, ans.value); if (r && r.error) throw new Error(r.error); toast('Bot learned it'); paint(); }
              catch (e) { toast(humanizeError(e), 'error'); ev.currentTarget.disabled = false; }
            } }, 'Teach'),
            el('button', { class: 'lb-btn lb-btn-ghost', onclick: async (ev) => {
              ev.currentTarget.disabled = true;
              try { const r = await ccLcMissDismiss(m.id); if (r && r.error) throw new Error(r.error); paint(); } catch (e) { toast(humanizeError(e), 'error'); }
            } }, 'Dismiss'),
          ]),
        ]);
      }));
    };
    paint();
  }
  async function openCalls() {
    const body = el('div', null, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    drawerRef = openDrawer('Recent calls', body, { subtitle: 'Inbound calls and Riley callbacks, with audio and transcripts' });
    let rows; try { rows = await ccLcCalls(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!rows || rows.error) { mount(body, el('div', { class: 'lb-state lb-error' }, (rows && rows.error) || 'Failed')); return; }
    mount(body, el('div', null, [
      el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-bottom:12px', onclick: () => openCallback(S.conv) }, 'New callback'),
      rows.length ? el('div', { class: 'lcv-calllist' }, rows.map(c => {
        const answered = (c.status === 'ended' || c.status === 'analyzed') && (c.duration_sec || 0) > 0;
        const lbl = answered ? 'Answered' : c.status === 'in-progress' ? 'On call' : c.status === 'dialing' ? 'Ringing…' : c.status === 'scheduled' ? 'Scheduled'
          : c.status === 'no-answer' ? 'No answer' : c.status === 'no-result' ? 'No result' : c.status === 'cancelled' ? 'Cancelled' : (c.status || '—');
        const cls = answered ? 't-mine' : c.status === 'no-answer' ? 't-sent' : 't-lang';
        return el('div', { class: 'lcv-hist' }, [
          el('div', null, [tag(lbl, cls), ' ', el('b', null, c.name || c.to_number || c.from_number || '—'), el('span', { class: 'lcv-sub2' }, ' ' + fmtDateTime(c.at || c.scheduled_at) + (c.duration_sec != null ? ' · ' + Math.floor(c.duration_sec / 60) + 'm ' + (c.duration_sec % 60) + 's' : ''))]),
          el('div', { class: 'lcv-sub2' }, c.summary || c.topic || '—'),
          (c.transcript || c.recording_url) ? el('details', null, [el('summary', { class: 'lcv-sub2' }, 'Transcript / audio'),
            c.recording_url ? el('audio', { controls: '', src: c.recording_url, style: 'width:100%;margin:6px 0' }) : null,
            c.transcript ? el('pre', { class: 'lcv-transcript' }, c.transcript) : null].filter(Boolean)) : null,
        ].filter(Boolean));
      })) : el('div', { class: 'lb-state' }, 'No calls yet.'),
    ]));
  }
}
