// mailbox.js — Command Center Mailbox, Gmail edition (bl_mail_0335 → bl_mail_0488).
//
// Owner ask, 28 Sep 2026: "same to same Gmail" — composer, inbox, reading view, mobile, deep links.
// So this screen copies Gmail's anatomy on purpose: left rail (Compose + folders + labels), a search
// pill, Primary/Updates tabs, 40px rows with hover actions, a reading view that replaces the list,
// Reply/Forward pills, a floating "New Message" window bottom-right, and on phones the Gmail app's
// layout (avatar rows, Compose FAB, full-screen composer, back button walks the screens).
//
// THREE RULES THIS FILE EXISTS TO ENFORCE (unchanged since bl_mail_0335):
//
//   1. NOTHING SENDS BY ACCIDENT. Compose / Reply save DRAFTS (cc_mail_compose_save,
//      cc_mail_draft_save). Putting mail on the wire is cc_mail_send, which the server gates on
//      comm.manage, and which this screen only calls after an explicit confirm. Owner decision,
//      7 Sep 2026: every carrier/broker-facing message is sent by a human who chose to send it.
//
//   2. INBOUND HTML IS HOSTILE. It is written by whoever emailed us. It is NEVER put in this
//      document. It renders inside a sandboxed iframe with no scripts, no same-origin, and remote
//      images blocked until the reader asks for them. See bodyFrame(). Only HTML WE wrote
//      (drafts, sent mail) is shown inline, and even that goes through sanitizeNodes() first.
//
//   3. UNSUBSCRIBES ARE LAW (CLAUDE.md §6.5). A new message uses the mail.compose keys, which honour
//      opt-outs; cc_mail_send raises the gate's own reason sentence and the composer shows it
//      verbatim. There is no "send anyway".
//
// DEEP LINKS — every screen state lives in the hash, so Back, refresh and shared links all work:
//   #/mailbox                              Inbox (Primary)
//   #/mailbox?folder=updates|starred|snoozed|sent|drafts|all|trash
//   #/mailbox?label=loads@loadboot.com     one mailbox (Gmail "label")
//   #/mailbox?q=rate+con                   search
//   #/mailbox?thread=<thread_key>          open a conversation (a deep link never marks it read)
//   #/mailbox?compose=new&to=a@b.com&subject=Hi&from=dispatch@loadboot.com   open the composer
//   #/mailbox?draft=<thread_key>           reopen a saved "new message" draft in the composer
//
// Permission model (client-side hiding only; the RPCs re-check everything):
//   comm.view   → read, star, mark read/unread
//   comm.send   → compose/reply drafts, archive, snooze
//   comm.manage → send, trash, move between Primary and Updates  (stats.can_send mirrors it)
//
// CLAUDE.md §8 says CC popups are openDrawer(). Snooze, the phone folder list and every confirm use
// it. The floating composer and the undo snackbar are the deliberate exceptions: they ARE Gmail.

import { el, mount } from '../../shared/ui/dom.js';
import { fmtDateTime, askConfirm, openDrawer } from '../../shared/ui/components.js';
import {
  mailList, mailThread, mailDraftSave, mailDraftDiscard, mailSend, mailStats, mailSetFolder,
  mailThreadAction, mailComposeSave,
} from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { decodeMessage, decodeSubject, previewOf } from '../../shared/mime.js';

const PAGE = 50;
const MOBILE = () => window.matchMedia('(max-width: 780px)').matches;

const FROM_ADDRS = [
  { v: 'hello@loadboot.com', label: 'LoadBoot <hello@loadboot.com>' },
  { v: 'dispatch@loadboot.com', label: 'LoadBoot Dispatch <dispatch@loadboot.com>' },
  { v: 'billing@loadboot.com', label: 'LoadBoot Billing <billing@loadboot.com>' },
];
// Which address a REPLY actually leaves from (delivery-worker picks the identity by template key).
const replyFromFor = (mailbox) => /^dispatch@/i.test(mailbox || '') ? 'dispatch@loadboot.com'
  : /^billing@/i.test(mailbox || '') ? 'billing@loadboot.com' : 'hello@loadboot.com';

const FOLDERS = [
  { id: 'inbox',   label: 'Inbox',   ic: 'inbox', count: 'inbox_unread', bold: true },
  { id: 'starred', label: 'Starred', ic: 'star' },
  { id: 'snoozed', label: 'Snoozed', ic: 'clock' },
  { id: 'sent',    label: 'Sent',    ic: 'send' },
  { id: 'drafts',  label: 'Drafts',  ic: 'file', count: 'drafts', bold: true },
];
const MORE_FOLDERS = [
  { id: 'updates', label: 'Updates', ic: 'info', count: 'system_unread', bold: true },
  { id: 'all',     label: 'All Mail', ic: 'mails' },
  { id: 'trash',   label: 'Trash',   ic: 'trash' },
];
const FOLDER_IDS = FOLDERS.concat(MORE_FOLDERS).map(f => f.id);
const serverFolder = (f) => f === 'updates' ? 'system' : f;

const EMPTY_TEXT = {
  inbox: 'Your Primary tab is empty.',
  updates: 'Nothing in Updates. Bounces, receipts and auto-replies are filed here automatically.',
  starred: 'No starred messages. Stars let you give messages a special status to make them easier to find. To star a message, click on the star outline beside any message or conversation.',
  snoozed: 'Nothing snoozed. Snooze a conversation to have it come back to your inbox when you need it.',
  sent: 'No sent messages! Send one now?',
  drafts: 'You don’t have any saved drafts. Saving a draft allows you to keep a message you aren’t ready to send yet.',
  all: 'No conversations.',
  trash: 'No conversations in Trash. Nothing here is ever deleted for good — Trash only hides.',
};

// ── icons: code-defined, trusted markup only (never built from data) ─────────
const IC = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  star: '<path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.49l-5.87 3.09 1.12-6.54L2.5 9.41l6.56-.95z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4Z"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  mails: '<rect x="6" y="4" width="16" height="13" rx="2"/><path d="m22 7-7.1 3.78a1.9 1.9 0 0 1-1.8 0L6 7"/><path d="M2 8v11a2 2 0 0 0 2 2h14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  unarchive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="m9 15 3-3 3 3M12 12v6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  forward: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  unread: '<path d="M22 10.5V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/><path d="m2 7 8.97 5.7a1.94 1.94 0 0 0 2.06 0L17 10"/><circle cx="20" cy="5" r="2.5"/>',
  read: '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  min: '<path d="M5 12h14"/>',
  max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  unmax: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16"/>',
  ul: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  ol: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7l3 2.7"/>',
  clear: '<path d="M4 7V4h16v3M5 20h6M13 4 8 20M15 15l5 5M20 15l-5 5"/>',
  quote: '<path d="M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z"/>',
  font: '<path d="M4 20 10 4h1l6 16M6.5 14h8"/><path d="M17 20h4"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  label: '<path d="M3 5a2 2 0 0 1 2-2h9l7 9-7 9H5a2 2 0 0 1-2-2z"/>',
  moveUpd: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v4M12 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  caret: '<path d="M7 10l5 5 5-5z" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
};
function ic(name, size = 20, extra = '') {
  return el('span', {
    class: 'gm-i ' + extra, 'aria-hidden': 'true',
    html: '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (IC[name] || '') + '</svg>',
  });
}
function ib(name, title, onClick, opts = {}) {
  return el('button', {
    type: 'button', class: 'gm-ib' + (opts.cls ? ' ' + opts.cls : ''), title, 'aria-label': title,
    disabled: opts.disabled || null, onClick: (e) => { e.stopPropagation(); onClick && onClick(e); },
  }, ic(name, opts.size || 20));
}

// ── small helpers ────────────────────────────────────────────────────────────
const AV_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#c5221f', '#12b5cb', '#e52592', '#5f6368', '#f29900', '#1e8e3e', '#a142f4'];
function avatar(nameOrEmail, size = 40) {
  const s = String(nameOrEmail || '?').trim();
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const letter = (s.replace(/^["'<]+/, '')[0] || '?').toUpperCase();
  return el('span', { class: 'gm-av', style: 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.45) + 'px;background:' + AV_COLORS[Math.abs(h) % AV_COLORS.length] }, letter);
}
function listDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}
function relAgo(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) { const m = Math.floor(s / 60); return m + (m === 1 ? ' minute ago' : ' minutes ago'); }
  if (s < 86400) { const h = Math.floor(s / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  const d = Math.floor(s / 86400); return d + (d === 1 ? ' day ago' : ' days ago');
}
function longDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const base = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (Date.now() - d.getTime() < 7 * 86400000) ? base + ' (' + relAgo(ts) + ')' : base;
}
const shortBox = (mb) => String(mb || '').replace(/@loadboot\.com$/i, '@');
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
// The server's own sentence for the errors WE raise (validation, the unsubscribe gate). Everything
// else still goes through humanizeError so no SQL text ever reaches the screen.
function mailErr(e) {
  if (e && (e.code === '22023' || e.code === 'P0001') && e.message && e.message.length < 400) return e.message;
  return humanizeError(e);
}

// ── HTML we write: whitelist sanitizer (drafts, sent mail, composer) ──────────
// Parsed in an inert DOMParser document (no scripts run, no images load), then rebuilt node by node
// in THIS document from a short whitelist. Anything else is unwrapped to its text.
const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'SPAN']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK', 'SVG', 'MATH', 'NOSCRIPT', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IMG', 'VIDEO', 'AUDIO']);
function cleanNode(n) {
  if (n.nodeType === 3) return [document.createTextNode(n.nodeValue)];
  if (n.nodeType !== 1) return [];
  const tag = n.tagName.toUpperCase();
  if (DROP.has(tag)) return [];
  const kids = [];
  n.childNodes.forEach(c => kids.push(...cleanNode(c)));
  if (!KEEP.has(tag)) return kids;
  const out = document.createElement(tag.toLowerCase());
  if (tag === 'A') {
    const href = String(n.getAttribute('href') || '').trim();
    if (/^(https?:|mailto:)/i.test(href)) { out.setAttribute('href', href); out.setAttribute('target', '_blank'); out.setAttribute('rel', 'noopener noreferrer'); }
  }
  kids.forEach(k => out.appendChild(k));
  return [out];
}
function sanitizeNodes(html) {
  const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || '') + '</body>', 'text/html');
  const out = [];
  doc.body.childNodes.forEach(c => out.push(...cleanNode(c)));
  return out;
}
function sanitizeHtml(html) {
  const box = document.createElement('div');
  sanitizeNodes(html).forEach(n => box.appendChild(n));
  return box.innerHTML;
}
function htmlToText(html) {
  const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr)>/gi, '\n') + '</body>', 'text/html');
  doc.querySelectorAll('style,script').forEach(n => n.remove());
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textToHtml = (s) => escHtml(s).split(/\n{2,}/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');

// ── module state: one live mailbox; a hashchange just re-applies the route ────
let CTRL = null;

export function renderMailbox(host, query) {
  const q = query instanceof URLSearchParams ? query
    : new URLSearchParams(typeof query === 'string' && query ? 'thread=' + encodeURIComponent(query) : '');
  if (CTRL && CTRL.host === host && CTRL.root.isConnected) { CTRL.apply(q, {}); return; }
  if (CTRL) CTRL.destroy();
  injectStyleOnce();
  if (!can('comm.view')) {
    mount(host, el('div', { class: 'lb-state lb-error', role: 'alert' },
      el('p', null, 'You do not have access to the shared mailbox (comm.view required).')));
    return;
  }
  CTRL = createMailbox(host);
  CTRL.apply(q, {});
}

function createMailbox(host) {
  const S = {
    folder: 'inbox', label: '', q: '', thread: null,
    threads: [], total: 0, cursors: [null], nextBefore: null, listLoaded: false, listKey: '',
    sel: new Set(), stats: null, canSend: false, canDraft: can('comm.send'),
    railCollapsed: window.innerWidth < 1280, moreOpen: false,
    msgs: null, openKey: null, expanded: new Set(), showImages: new Set(),
    pushedThread: false, pushedCompose: false, reply: null,
  };
  let composer = null;
  let openingDraft = null;
  let loadSeq = 0, threadSeq = 0;

  // ── skeleton ──
  const railHost = el('aside', { class: 'gm-rail' });
  const searchIn = el('input', { class: 'gm-search-in', type: 'search', placeholder: 'Search mail', 'aria-label': 'Search mail', enterkeyhint: 'search' });
  const searchClear = ib('x', 'Clear search', () => { searchIn.value = ''; nav({ q: '', thread: null }); }, { cls: 'gm-search-x' });
  const searchPill = el('form', { class: 'gm-search', role: 'search', onSubmit: (e) => { e.preventDefault(); searchIn.blur(); nav({ q: searchIn.value.trim(), thread: null, folder: searchIn.value.trim() ? 'all' : S.folder }); } }, [
    ib('menu', 'Main menu', () => MOBILE() ? openFolderSheet() : toggleRail(), { cls: 'gm-search-menu' }),
    el('button', { type: 'submit', class: 'gm-ib gm-search-go', title: 'Search', 'aria-label': 'Search' }, ic('search')),
    searchIn, searchClear,
  ]);
  const topHost = el('div', { class: 'gm-top' }, [
    ib('menu', 'Main menu', () => toggleRail(), { cls: 'gm-railbtn' }),
    searchPill,
  ]);
  const mainHost = el('section', { class: 'gm-main' });
  const progress = el('div', { class: 'gm-progress', hidden: true });
  const fab = el('button', { type: 'button', class: 'gm-fab', onClick: () => openCompose({}) }, [ic('pencil', 22), el('span', null, 'Compose')]);
  const root = el('div', { class: 'gm' + (S.railCollapsed ? ' rail-collapsed' : '') }, [topHost, railHost, el('div', { class: 'gm-mainwrap' }, [progress, mainHost]), S.canDraft ? fab : null]);
  mount(host, root);

  // Desktop: the app owns the viewport below the CC top bar and scrolls inside its panes, like Gmail.
  const fit = () => {
    if (!root.isConnected) return;
    if (MOBILE()) { root.style.height = ''; return; }
    const top = root.getBoundingClientRect().top + window.scrollY;
    root.style.height = Math.max(420, window.innerHeight - top) + 'px';
  };
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);

  let lastY = 0;
  const onScroll = () => { const y = window.scrollY; fab.classList.toggle('shrunk', y > lastY && y > 80); lastY = y; };
  window.addEventListener('scroll', onScroll, { passive: true });

  const onKey = (e) => keyboard(e);
  document.addEventListener('keydown', onKey);

  // Live mail: a quiet refresh every minute while someone is looking at the first page of a list.
  const poll = setInterval(() => {
    if (!root.isConnected) { destroy(); return; }
    if (document.visibilityState !== 'visible' || S.thread || S.sel.size || S.cursors.length > 1) return;
    loadList({ silent: true }); loadStats();
  }, 60000);

  function destroy() {
    clearInterval(poll);
    window.removeEventListener('resize', fit);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('keydown', onKey);
    if (composer) { composer.destroyQuiet(); composer = null; }
    document.documentElement.classList.remove('gm-lock');
  }

  // ── routing ──
  function current() {
    return { folder: S.folder, label: S.label, q: S.q, thread: S.thread,
      compose: composer && composer.routeCompose ? composer.routeCompose : null,
      draft: composer && composer.routeDraft ? composer.routeDraft : null };
  }
  function hashFor(p) {
    const q = new URLSearchParams();
    if (p.folder && p.folder !== 'inbox') q.set('folder', p.folder);
    if (p.label) q.set('label', p.label);
    if (p.q) q.set('q', p.q);
    if (p.thread) q.set('thread', p.thread);
    if (p.compose) q.set('compose', p.compose);
    if (p.draft) q.set('draft', p.draft);
    const s = q.toString();
    return '#/mailbox' + (s ? '?' + s : '');
  }
  function nav(patch, opts = {}) {
    const next = Object.assign(current(), patch);
    const h = hashFor(next);
    if (h !== location.hash) {
      try { history[opts.replace ? 'replaceState' : 'pushState'](null, '', h); } catch (_) { location.hash = h; return; }
    }
    apply(new URLSearchParams(h.split('?')[1] || ''), opts);
  }
  function hrefFor(patch) { return hashFor(Object.assign({ folder: S.folder, label: S.label, q: S.q }, patch)); }

  function apply(q, opts = {}) {
    const folder = FOLDER_IDS.includes(q.get('folder')) ? q.get('folder') : 'inbox';
    const label = q.get('label') || '';
    const search = q.get('q') || '';
    const thread = q.get('thread') || null;
    const listKey = [folder, label, search].join('|');

    S.folder = folder; S.label = label; S.q = search;
    if (document.activeElement !== searchIn) searchIn.value = search;
    searchPill.classList.toggle('has-q', !!search);
    paintRail();

    if (listKey !== S.listKey || !S.listLoaded) {
      S.listKey = listKey; S.cursors = [null]; S.sel.clear(); S.threads = []; S.listLoaded = false;
      loadList({});
    }
    if (!S.stats) loadStats();

    // leaving a conversation with an unsaved reply → keep it as a draft, like Gmail
    if (S.thread && S.thread !== thread) flushReply();
    if (thread) {
      if (thread !== S.openKey || !S.msgs) openThread(thread, !!opts.markRead);
      else paintMain();
    } else {
      S.thread = null; S.openKey = null; S.msgs = null; S.reply = null; S.pushedThread = false;
      paintMain();
    }
    root.classList.toggle('in-thread', !!thread);

    // composer follows the URL (so Back closes it on a phone)
    const wantCompose = q.get('compose'), wantDraft = q.get('draft');
    if ((wantCompose || wantDraft) && !composer) {
      if (wantDraft) openDraftComposer(wantDraft, { fromRoute: true });
      else openComposer({ to: q.get('to') || '', subject: q.get('subject') || '', from: q.get('from') || '', body: q.get('body') || '' }, { fromRoute: true });
    } else if (!wantCompose && !wantDraft && composer && composer.routed) {
      composer.close({ save: true, fromRoute: true });
    }
  }

  // ── data ──
  async function loadStats() {
    let s;
    try { s = await mailStats(); } catch (_) { return; }
    S.stats = s || {};
    S.canSend = !!(s && s.can_send);
    if (s && typeof s.can_draft === 'boolean') S.canDraft = s.can_draft;
    paintRail();
    if (!S.thread) paintListView();   // permissions just arrived: the row hover actions depend on them
  }

  async function loadList(opts = {}) {
    const seq = ++loadSeq;
    if (!opts.silent) { progress.hidden = false; if (!S.threads.length && !S.thread) paintMain(); }
    let res;
    try {
      res = await mailList({ limit: PAGE, mailbox: S.label || null, search: S.q || null,
        before: S.cursors[S.cursors.length - 1], folder: serverFolder(S.folder) });
    } catch (e) {
      if (seq !== loadSeq) return;
      progress.hidden = true;
      if (!opts.silent) { S.listError = mailErr(e); S.listLoaded = true; if (!S.thread) paintMain(); }
      return;
    }
    if (seq !== loadSeq) return;
    progress.hidden = true;
    S.listError = null;
    S.threads = res?.threads || [];
    S.total = Number(res?.total ?? S.threads.length);
    S.nextBefore = res?.next_before || null;
    S.listLoaded = true;
    for (const k of [...S.sel]) if (!S.threads.some(t => t.thread_key === k)) S.sel.delete(k);
    if (!S.thread) paintMain();
  }

  function reloadAll() { S.listLoaded = false; S.stats = null; loadList({}); loadStats(); }

  // ── rail ──
  function toggleRail() {
    S.railCollapsed = !S.railCollapsed;
    root.classList.toggle('rail-collapsed', S.railCollapsed);
  }
  function folderCount(f) {
    const c = f.count && S.stats && S.stats.folders ? Number(S.stats.folders[f.count] || 0) : 0;
    return c > 0 ? c.toLocaleString('en-US') : '';
  }
  function navItem(f, onPick) {
    const count = folderCount(f);
    const active = !S.label && (S.folder === f.id || (f.id === 'inbox' && S.folder === 'updates'));
    const a = el('a', {
      class: 'gm-nav' + (active ? ' active' : '') + (f.bold && count ? ' bold' : ''),
      href: hrefFor({ folder: f.id, label: '', q: '', thread: null }), title: f.label,
      onClick: (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault(); onPick && onPick();
        nav({ folder: f.id, label: '', q: '', thread: null });
      },
    }, [ic(f.id === 'starred' && active ? 'star' : f.ic, 20, f.id === 'starred' && active ? 'filled' : ''),
      el('span', { class: 'gm-nav-t' }, f.label), el('span', { class: 'gm-nav-c' }, count)]);
    return a;
  }
  function labelItems(onPick) {
    const boxes = Array.isArray(S.stats?.mailboxes) ? S.stats.mailboxes : [];
    return boxes.map((b, i) => {
      const active = S.label === b.mailbox;
      return el('a', {
        class: 'gm-nav' + (active ? ' active' : '') + (b.unread ? ' bold' : ''),
        href: hrefFor({ folder: 'all', label: b.mailbox, q: '', thread: null }), title: b.mailbox,
        onClick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault(); onPick && onPick();
          nav({ folder: 'all', label: b.mailbox, q: '', thread: null });
        },
      }, [el('span', { class: 'gm-i gm-lbl-ic', style: 'color:' + AV_COLORS[(i * 5 + 2) % AV_COLORS.length] }, ic('label', 18)),
        el('span', { class: 'gm-nav-t' }, titleCase(b.mailbox)), el('span', { class: 'gm-nav-c' }, b.unread ? String(b.unread) : '')]);
    });
  }
  function railBody(onPick) {
    const more = !!onPick || S.moreOpen || MORE_FOLDERS.some(f => f.id === S.folder);
    return [
      S.canDraft ? el('button', { type: 'button', class: 'gm-compose', onClick: () => { onPick && onPick(); openCompose({}); } },
        [ic('pencil', 22), el('span', null, 'Compose')]) : null,
      el('nav', { class: 'gm-navs' }, [
        ...FOLDERS.map(f => navItem(f, onPick)),
        onPick ? null : el('button', { type: 'button', class: 'gm-nav gm-more', onClick: () => { S.moreOpen = !more; paintRail(); } },
          [ic(more ? 'up' : 'down'), el('span', { class: 'gm-nav-t' }, more ? 'Less' : 'More')]),
        ...(more ? MORE_FOLDERS.map(f => navItem(f, onPick)) : []),
      ]),
      el('div', { class: 'gm-labels-h' }, [el('span', null, 'Labels')]),
      el('nav', { class: 'gm-navs' }, labelItems(onPick)),
    ];
  }
  function paintRail() { mount(railHost, railBody(null)); }

  // Phones: the folder list opens as the CC bottom sheet (openDrawer), per CLAUDE.md §8.
  let sheet = null;
  function openFolderSheet() {
    if (sheet) { try { sheet.close(); } catch (_) {} }
    const body = el('div', { class: 'gm-sheet' });
    const pick = () => { try { sheet && sheet.close(); } catch (_) {} };
    mount(body, railBody(pick));
    sheet = openDrawer('LoadBoot Mail', body, { size: 'sm', subtitle: 'Folders & mailboxes' });
  }

  // ── main panel ──
  function paintMain() {
    if (S.thread) paintThread(); else paintListView();
  }

  function folderTitle() {
    if (S.label) return titleCase(S.label);
    if (S.q) return 'Search results';
    const f = FOLDERS.concat(MORE_FOLDERS).find(x => x.id === S.folder);
    return S.folder === 'inbox' ? 'Primary' : (f ? f.label : 'Inbox');
  }

  // ── list view ──
  const tabsHost = el('div', { class: 'gm-tabs', role: 'tablist' });
  function paintTabs() {
    if (!(S.folder === 'inbox' || S.folder === 'updates') || S.label || S.q) { mount(tabsHost, null); tabsHost.hidden = true; return; }
    tabsHost.hidden = false;
    const upd = Number(S.stats?.folders?.system_unread || 0);
    const inb = Number(S.stats?.folders?.inbox_unread || 0);
    const tab = (id, label, icName, badge, badgeCls) => el('a', {
      class: 'gm-tab' + (S.folder === id ? ' active' : ''), role: 'tab', 'aria-selected': S.folder === id ? 'true' : 'false',
      href: hrefFor({ folder: id, thread: null }),
      onClick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); nav({ folder: id, thread: null }, { replace: true }); },
    }, [ic(icName), el('span', { class: 'gm-tab-t' }, label), badge ? el('span', { class: 'gm-badge ' + badgeCls }, badge + ' new') : null]);
    mount(tabsHost, [
      tab('inbox', 'Primary', 'inbox', S.folder !== 'inbox' && inb ? inb : 0, 'blue'),
      tab('updates', 'Updates', 'info', S.folder !== 'updates' && upd ? upd : 0, 'orange'),
    ]);
  }

  function selectedThreads() { return S.threads.filter(t => S.sel.has(t.thread_key)); }

  function listToolbar() {
    const sel = selectedThreads();
    const all = S.threads.length && sel.length === S.threads.length;
    const cb = el('input', { type: 'checkbox', class: 'gm-cb', 'aria-label': 'Select all',
      onClick: (e) => { e.stopPropagation(); if (all || sel.length) S.sel.clear(); else S.threads.forEach(t => S.sel.add(t.thread_key)); paintListView(); } });
    cb.checked = !!all; cb.indeterminate = !all && sel.length > 0;
    const selMenu = dropBtn('caret', 'Select', [
      ['All', () => S.threads.forEach(t => S.sel.add(t.thread_key))],
      ['None', () => S.sel.clear()],
      ['Read', () => { S.sel.clear(); S.threads.filter(t => !Number(t.unread)).forEach(t => S.sel.add(t.thread_key)); }],
      ['Unread', () => { S.sel.clear(); S.threads.filter(t => Number(t.unread)).forEach(t => S.sel.add(t.thread_key)); }],
      ['Starred', () => { S.sel.clear(); S.threads.filter(t => t.starred).forEach(t => S.sel.add(t.thread_key)); }],
      ['Unstarred', () => { S.sel.clear(); S.threads.filter(t => !t.starred).forEach(t => S.sel.add(t.thread_key)); }],
    ], () => paintListView(), 'gm-selcaret');

    const left = [el('span', { class: 'gm-cbwrap' }, [cb, selMenu])];
    if (sel.length) {
      left.push(ib('x', 'Clear selection', () => { S.sel.clear(); paintListView(); }, { cls: 'gm-m-only' }));
      left.push(el('span', { class: 'gm-selcount gm-m-only' }, String(sel.length)));
      left.push(...threadActions(sel.map(t => t.thread_key), {
        anyUnread: sel.some(t => Number(t.unread)), anyStarred: sel.some(t => t.starred), rows: sel,
      }));
    } else {
      left.push(ib('refresh', 'Refresh', () => { reloadAll(); }));
      left.push(dropBtn('more', 'More', [
        ['Mark all as read', async () => {
          const keys = S.threads.filter(t => Number(t.unread)).map(t => t.thread_key);
          if (!keys.length) { toast('Everything on this page is already read.'); return; }
          await act(keys, 'read');
        }],
      ]));
    }
    const start = S.total ? ((S.cursors.length - 1) * PAGE + 1) : 0;
    const end = (S.cursors.length - 1) * PAGE + S.threads.length;
    const right = el('div', { class: 'gm-pager' }, [
      el('span', { class: 'gm-range' }, S.total ? start.toLocaleString('en-US') + '–' + end.toLocaleString('en-US') + ' of ' + S.total.toLocaleString('en-US') : ''),
      ib('left', 'Newer', () => { if (S.cursors.length > 1) { S.cursors.pop(); S.sel.clear(); loadList({}); } }, { disabled: S.cursors.length <= 1 }),
      ib('right', 'Older', () => { if (S.nextBefore) { S.cursors.push(S.nextBefore); S.sel.clear(); loadList({}); } }, { disabled: !S.nextBefore }),
    ]);
    return el('div', { class: 'gm-tb' + (sel.length ? ' has-sel' : '') }, [el('div', { class: 'gm-tb-l' }, left), right]);
  }

  // Gmail's toolbar buttons for a set of conversations (list selection OR the open thread).
  function threadActions(keys, o) {
    const out = [];
    const f = S.folder;
    const inTrash = f === 'trash' || (o.rows && o.rows.every(t => t.trashed));
    const archived = o.rows ? o.rows.every(t => t.archived) : false;
    if (S.canDraft && !inTrash && f !== 'drafts') {
      out.push(archived
        ? ib('unarchive', 'Move to Inbox', () => act(keys, 'unarchive'))
        : ib('archive', 'Archive', () => act(keys, 'archive')));
    }
    if (S.canSend && !inTrash && (f === 'inbox' || f === 'updates')) {
      out.push(f === 'updates'
        ? ib('inbox', 'Move to Primary', () => moveFolder(keys, 'inbox'))
        : ib('moveUpd', 'Move to Updates (not a person waiting)', () => moveFolder(keys, 'system')));
    }
    if (S.canSend) {
      out.push(inTrash
        ? ib('unarchive', 'Restore from Trash', () => act(keys, 'untrash'))
        : ib('trash', 'Delete (move to Trash)', () => act(keys, 'trash')));
    }
    out.push(el('span', { class: 'gm-tb-sep' }));
    out.push(o.anyUnread
      ? ib('read', 'Mark as read', () => act(keys, 'read'))
      : ib('unread', 'Mark as unread', () => act(keys, 'unread')));
    if (S.canDraft && !inTrash) {
      out.push(f === 'snoozed'
        ? ib('clock', 'Unsnooze', () => act(keys, 'unsnooze'))
        : ib('clock', 'Snooze', () => openSnooze(keys)));
    }
    out.push(dropBtn('more', 'More', [
      [o.anyStarred ? 'Remove star' : 'Add star', () => act(keys, o.anyStarred ? 'unstar' : 'star')],
      o.anyUnread ? ['Mark as unread', null] : ['Mark as read', () => act(keys, 'read')],
    ].filter(x => x[1])));
    return out;
  }

  // Absolute-positioned dropdown inside the toolbar (a menu, not a dialog).
  function dropBtn(icName, title, items, after, cls) {
    const wrap = el('span', { class: 'gm-drop' + (cls ? ' ' + cls : '') });
    const btn = ib(icName, title, () => {
      const open = wrap.querySelector('.gm-menu');
      document.querySelectorAll('.gm-menu').forEach(m => m.remove());
      if (open) return;
      const menu = el('div', { class: 'gm-menu', role: 'menu' }, items.map(([label, fn]) =>
        el('button', { type: 'button', role: 'menuitem', class: 'gm-menu-i', onClick: async (e) => {
          e.stopPropagation(); menu.remove(); await fn(); if (after) after();
        } }, label)));
      wrap.appendChild(menu);
      const off = (ev) => { if (!wrap.contains(ev.target)) { menu.remove(); document.removeEventListener('click', off, true); } };
      setTimeout(() => document.addEventListener('click', off, true), 0);
    }, { size: icName === 'caret' ? 18 : 20 });
    wrap.appendChild(btn);
    return wrap;
  }

  function paintListView() {
    fab.hidden = !!composer;
    const body = el('div', { class: 'gm-list', role: 'grid', 'aria-label': folderTitle() });
    if (!S.listLoaded) {
      mount(body, el('div', { class: 'gm-empty' }, 'Loading…'));
    } else if (S.listError) {
      mount(body, el('div', { class: 'gm-empty' }, [S.listError, ' ', el('button', { type: 'button', class: 'gm-linkbtn', onClick: () => reloadAll() }, 'Try again')]));
    } else if (!S.threads.length) {
      mount(body, el('div', { class: 'gm-empty' }, S.q ? 'No messages matched your search.' : S.label ? 'No conversations for ' + S.label + '.' : (EMPTY_TEXT[S.folder] || 'No conversations.')));
    } else {
      mount(body, S.threads.map(t => listRow(t)));
    }
    paintTabs();
    mount(mainHost, [
      listToolbar(),
      tabsHost,
      el('div', { class: 'gm-mhead' }, [
        el('span', null, folderTitle()),
        S.q ? el('button', { type: 'button', class: 'gm-linkbtn', onClick: () => { searchIn.value = ''; nav({ q: '', folder: 'inbox' }); } }, 'Clear search') : null,
      ]),
      body,
    ]);
  }

  function senderLabel(t) {
    const who = t.peer_name || String(t.peer_email || '').split('@')[0] || 'Unknown sender';
    if (S.folder === 'sent' || (t.direction === 'out' && !t.has_in)) return 'To: ' + (t.peer_name || t.peer_email || '');
    return who;
  }

  function listRow(t) {
    const key = t.thread_key;
    const unread = Number(t.unread || 0) > 0;
    const selected = S.sel.has(key);
    const subject = decodeSubject(t.subject) || '(no subject)';
    const snippet = t.preview ? previewOf({ body_text: t.preview }, 140) : '';
    const toggleSel = () => { if (S.sel.has(key)) S.sel.delete(key); else S.sel.add(key); paintListView(); };

    const cb = el('input', { type: 'checkbox', class: 'gm-cb', 'aria-label': 'Select conversation', onClick: (e) => { e.stopPropagation(); toggleSel(); } });
    cb.checked = selected;
    const star = el('button', { type: 'button', class: 'gm-star' + (t.starred ? ' on' : ''), title: t.starred ? 'Starred' : 'Not starred', 'aria-pressed': t.starred ? 'true' : 'false',
      onClick: (e) => { e.stopPropagation(); act([key], t.starred ? 'unstar' : 'star', { quiet: true }); } }, ic('star', 20, t.starred ? 'filled' : ''));
    const av = el('button', { type: 'button', class: 'gm-avbtn', 'aria-label': 'Select', onClick: (e) => { e.stopPropagation(); toggleSel(); } },
      selected ? el('span', { class: 'gm-av gm-av-sel' }, ic('check', 22)) : avatar(t.peer_name || t.peer_email));

    const count = Number(t.msg_count || 0);
    const fromCell = el('div', { class: 'gm-from' }, [
      el('span', { class: 'gm-from-t' }, senderLabel(t)),
      count > 1 ? el('span', { class: 'gm-count' }, String(count)) : null,
      t.has_draft ? el('span', { class: 'gm-draft' }, 'Draft') : null,
    ]);
    const chips = [];
    if (!S.label && t.mailbox) chips.push(el('span', { class: 'gm-chip' }, shortBox(t.mailbox)));
    if (t.folder === 'system' && S.folder !== 'updates' && t.mail_class) chips.push(el('span', { class: 'gm-chip amber' }, String(t.mail_class).replace(/_/g, ' ')));
    if (t.snoozed_until && S.folder === 'snoozed') chips.push(el('span', { class: 'gm-chip blue' }, 'until ' + listDate(t.snoozed_until)));
    const mid = el('div', { class: 'gm-mid' }, [
      ...chips,
      el('span', { class: 'gm-subj' }, subject),
      snippet ? el('span', { class: 'gm-snip' }, ' - ' + snippet) : null,
    ]);
    const hover = el('div', { class: 'gm-hover' }, [
      S.canDraft && S.folder !== 'trash' ? (t.archived ? ib('unarchive', 'Move to Inbox', () => act([key], 'unarchive')) : ib('archive', 'Archive', () => act([key], 'archive'))) : null,
      S.canSend ? (S.folder === 'trash' ? ib('unarchive', 'Restore', () => act([key], 'untrash')) : ib('trash', 'Delete', () => act([key], 'trash'))) : null,
      unread ? ib('read', 'Mark as read', () => act([key], 'read')) : ib('unread', 'Mark as unread', () => act([key], 'unread')),
      S.canDraft && S.folder !== 'trash' ? ib('clock', 'Snooze', () => openSnooze([key])) : null,
    ].filter(Boolean));

    const row = el('div', {
      class: 'gm-row' + (unread ? ' unread' : '') + (selected ? ' sel' : ''), role: 'row', tabindex: '0', 'data-key': key,
      onClick: (e) => {
        if (e.metaKey || e.ctrlKey) { window.open(hrefFor({ thread: key }), '_blank'); return; }
        if (S.sel.size && MOBILE()) { toggleSel(); return; }
        openRow(t);
      },
      onKeydown: (e) => { if (e.key === 'Enter') openRow(t); },
    }, [
      el('div', { class: 'gm-c-cb' }, cb),
      el('div', { class: 'gm-c-star' }, star),
      el('div', { class: 'gm-c-av' }, av),
      fromCell, mid,
      el('div', { class: 'gm-date', title: fmtDateTime(t.last_at) }, listDate(t.last_at)),
      hover,
    ]);
    // long-press selects on a phone, like the Gmail app
    let lp = null;
    row.addEventListener('touchstart', () => { lp = setTimeout(() => { lp = 'fired'; toggleSel(); }, 480); }, { passive: true });
    row.addEventListener('touchend', (e) => { if (lp === 'fired') e.preventDefault(); clearTimeout(lp); lp = null; });
    row.addEventListener('touchmove', () => { clearTimeout(lp); lp = null; }, { passive: true });
    return row;
  }

  function openRow(t) {
    // A "new message" draft with no conversation behind it opens in the composer, as in Gmail.
    if (t.has_draft && !t.has_in && !t.has_sent) { openDraftComposer(t.thread_key, {}); return; }
    S.pushedThread = true;
    nav({ thread: t.thread_key }, { markRead: true });
  }

  // ── actions ──
  const UNDO = { archive: 'unarchive', unarchive: 'archive', trash: 'untrash', untrash: 'trash', snooze: 'unsnooze', star: 'unstar', unstar: 'star', read: 'unread', unread: 'read' };
  const DONE = {
    archive: 'archived', unarchive: 'moved to Inbox', trash: 'moved to Trash', untrash: 'restored', snooze: 'snoozed',
    unsnooze: 'unsnoozed', star: 'starred', unstar: 'unstarred', read: 'marked as read', unread: 'marked as unread',
  };
  function leavesView(action) {
    const f = S.folder;
    return (action === 'archive' && (f === 'inbox' || f === 'updates'))
      || (action === 'trash' && f !== 'trash' && f !== 'drafts')
      || (action === 'untrash' && f === 'trash')
      || (action === 'snooze' && f !== 'snoozed')
      || (action === 'unsnooze' && f === 'snoozed')
      || (action === 'unstar' && f === 'starred');
  }
  async function act(keys, action, opts = {}) {
    try { await mailThreadAction(keys, action, opts.until); }
    catch (e) { toast(mailErr(e), 'error'); return false; }
    const gone = leavesView(action);
    for (const t of S.threads) if (keys.includes(t.thread_key)) {
      if (action === 'star') t.starred = true;
      if (action === 'unstar') t.starred = false;
      if (action === 'read') t.unread = 0;
      if (action === 'unread') t.unread = Math.max(1, Number(t.unread || 0));
      if (action === 'archive') t.archived = true;
      if (action === 'unarchive') t.archived = false;
      if (action === 'trash') t.trashed = true;
      if (action === 'untrash') t.trashed = false;
    }
    if (S.msgs && keys.includes(S.openKey)) {
      S.msgs.forEach(m => {
        if (action === 'star' || action === 'unstar') m.starred = action === 'star';
        if (action === 'archive' || action === 'unarchive') m.archived = action === 'archive';
        if (action === 'trash' || action === 'untrash') m.trashed = action === 'trash';
      });
    }
    let nextKey = null;
    if (gone) {
      if (S.thread && keys.includes(S.thread)) {
        const i = S.threads.findIndex(t => t.thread_key === S.thread);
        const nxt = S.threads.slice(i + 1).find(t => !keys.includes(t.thread_key));
        nextKey = nxt ? nxt.thread_key : null;
      }
      S.threads = S.threads.filter(t => !keys.includes(t.thread_key));
      S.total = Math.max(0, S.total - keys.length);
    }
    keys.forEach(k => S.sel.delete(k));
    if (!opts.quiet || gone) {
      const what = keys.length === 1 ? 'Conversation' : keys.length + ' conversations';
      snack(what + ' ' + DONE[action] + '.', UNDO[action] ? async () => {
        try { await mailThreadAction(keys, UNDO[action]); } catch (e) { toast(mailErr(e), 'error'); return; }
        reloadAll();
      } : null);
    }
    loadStats();
    if (S.thread && keys.includes(S.thread) && gone) {
      if (nextKey && !MOBILE()) nav({ thread: nextKey }, { replace: true, markRead: true });
      else backToList();
    } else if (S.thread && action === 'unread' && keys.includes(S.thread)) {
      backToList();
    } else {
      paintMain();
    }
    return true;
  }

  async function moveFolder(keys, folder) {
    try { for (const k of keys) await mailSetFolder(k, folder); }
    catch (e) { toast(mailErr(e), 'error'); return; }
    snack((keys.length === 1 ? 'Conversation' : keys.length + ' conversations') + ' moved to ' + (folder === 'system' ? 'Updates' : 'Primary') + '.',
      async () => { try { for (const k of keys) await mailSetFolder(k, folder === 'system' ? 'inbox' : 'system'); } catch (e) { toast(mailErr(e), 'error'); } reloadAll(); });
    S.threads = S.threads.filter(t => !keys.includes(t.thread_key));
    keys.forEach(k => S.sel.delete(k));
    loadStats();
    if (S.thread && keys.includes(S.thread)) backToList(); else paintMain();
  }

  function backToList() {
    flushReply();
    if (S.pushedThread && history.length > 1) { S.pushedThread = false; history.back(); }
    else nav({ thread: null }, { replace: true });
  }

  // Gmail snackbar: bottom-left, one at a time, with Undo.
  let snackEl = null, snackT = null;
  function snack(text, undo) {
    if (snackEl) snackEl.remove();
    clearTimeout(snackT);
    snackEl = el('div', { class: 'gm-snack', role: 'status' }, [
      el('span', null, text),
      undo ? el('button', { type: 'button', class: 'gm-snack-undo', onClick: () => { snackEl.remove(); undo(); } }, 'Undo') : null,
      el('button', { type: 'button', class: 'gm-snack-x', 'aria-label': 'Close', onClick: () => snackEl.remove() }, ic('x', 18)),
    ]);
    document.body.appendChild(snackEl);
    snackT = setTimeout(() => { if (snackEl) snackEl.remove(); }, 7000);
  }

  // Snooze: Gmail's list of times, in the CC dialog (a bottom sheet on phones).
  function openSnooze(keys) {
    const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
    const now = new Date();
    const addDays = (n) => { const x = new Date(now); x.setDate(x.getDate() + n); return x; };
    const opts = [];
    if (now.getHours() < 17) opts.push(['Later today', at(now, 18)]);
    opts.push(['Tomorrow', at(addDays(1), 8)]);
    const dow = now.getDay();
    if (dow >= 1 && dow <= 3) opts.push(['Later this week', at(addDays(2), 8)]);
    if (dow >= 1 && dow <= 5) opts.push(['This weekend', at(addDays(6 - dow), 8)]);
    opts.push(['Next week', at(addDays(((8 - dow) % 7) || 7), 8)]);
    const fmt = (d) => d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    let dlg;
    const pick = async (d) => { try { dlg.close(); } catch (_) {} await act(keys, 'snooze', { until: d.toISOString() }); };
    const custom = el('input', { type: 'datetime-local', class: 'cc-input', style: 'max-width:240px' });
    const body = el('div', { class: 'gm-snooze' }, [
      ...opts.map(([label, d]) => el('button', { type: 'button', class: 'gm-snooze-i', onClick: () => pick(d) },
        [el('span', null, label), el('span', { class: 'gm-snooze-t' }, fmt(d))])),
      el('div', { class: 'gm-snooze-custom' }, [
        el('span', null, 'Pick date & time'), custom,
        el('button', { type: 'button', class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => {
          const d = custom.value ? new Date(custom.value) : null;
          if (!d || isNaN(d) || d <= new Date()) { toast('Pick a time in the future.'); return; }
          pick(d);
        } }, 'Save'),
      ]),
    ]);
    dlg = openDrawer('Snooze until…', body, { size: 'sm', subtitle: 'It comes back to the Inbox by itself' });
  }

  // ── thread view ──
  async function openThread(key, markRead) {
    const seq = ++threadSeq;
    S.thread = key; S.openKey = key; S.msgs = null; S.reply = null; S.expanded = new Set(); S.showImages = new Set();
    root.classList.add('in-thread');
    progress.hidden = false;
    paintThread();
    let msgs;
    try { msgs = await mailThread(key, !!markRead); }
    catch (e) {
      if (seq !== threadSeq) return;
      progress.hidden = true;
      mount(mainHost, [threadToolbar([]), el('div', { class: 'gm-empty' }, [mailErr(e), ' ', el('button', { type: 'button', class: 'gm-linkbtn', onClick: () => openThread(key, markRead) }, 'Try again')])]);
      return;
    }
    if (seq !== threadSeq) return;
    progress.hidden = true;
    S.msgs = Array.isArray(msgs) ? msgs : [];
    if (markRead) {
      const t = S.threads.find(x => x.thread_key === key);
      if (t) t.unread = 0;
      loadStats();
    }
    // Gmail: the newest message and anything unread are open; older read ones are folded.
    const shown = S.msgs.filter(m => m.status !== 'draft');
    shown.forEach((m, i) => { if (i === shown.length - 1 || (m.direction === 'in' && !m.read_at) || shown.length <= 2) S.expanded.add(m.id); });
    const draft = S.msgs.find(m => m.status === 'draft' && m.mail_class !== 'compose');
    if (draft) S.reply = { mode: 'reply', html: draft.body_html || '', draftId: draft.id, savedAt: draft.created_at, dirty: false };
    paintThread();
    window.scrollTo(0, 0);
  }

  function threadToolbar(msgs) {
    const key = S.thread;
    const row = S.threads.find(t => t.thread_key === key);
    const st = {
      thread_key: key,
      starred: row ? !!row.starred : !!(msgs[0] && msgs[0].starred),
      archived: row ? !!row.archived : !!(msgs[0] && msgs[0].archived),
      trashed: row ? !!row.trashed : !!(msgs[0] && msgs[0].trashed),
    };
    const anyUnread = msgs.some(m => m.direction === 'in' && !m.read_at);
    const idx = S.threads.findIndex(t => t.thread_key === key);
    const go = (i) => { const t = S.threads[i]; if (t) { flushReply(); nav({ thread: t.thread_key }, { replace: true, markRead: true }); } };
    return el('div', { class: 'gm-tb gm-tb-thread' }, [
      el('div', { class: 'gm-tb-l' }, [
        ib('back', 'Back to ' + folderTitle(), () => backToList()),
        ...(msgs.length ? threadActions([key], { anyUnread, anyStarred: st.starred, rows: [st] }) : []),
      ]),
      el('div', { class: 'gm-pager' }, [
        idx >= 0 && S.total ? el('span', { class: 'gm-range' }, ((S.cursors.length - 1) * PAGE + idx + 1).toLocaleString('en-US') + ' of ' + S.total.toLocaleString('en-US')) : null,
        ib('left', 'Newer', () => go(idx - 1), { disabled: idx <= 0 }),
        ib('right', 'Older', () => go(idx + 1), { disabled: idx < 0 || idx >= S.threads.length - 1 }),
      ]),
    ]);
  }

  function paintThread() {
    fab.hidden = true;
    const msgs = S.msgs || [];
    if (!S.msgs) { mount(mainHost, [threadToolbar([]), el('div', { class: 'gm-empty' }, 'Loading…')]); return; }
    if (!msgs.length) { mount(mainHost, [threadToolbar([]), el('div', { class: 'gm-empty' }, 'This conversation is empty or no longer exists.')]); return; }

    const head = msgs[0];
    const shown = msgs.filter(m => m.status !== 'draft' || m.mail_class === 'compose');
    const lastIn = [...msgs].reverse().find(m => m.direction === 'in') || null;
    const subject = decodeSubject(head.subject) || '(no subject)';
    const row = S.threads.find(t => t.thread_key === S.thread);
    const starred = row ? !!row.starred : !!head.starred;
    const folderChip = head.trashed ? 'Trash' : (lastIn && lastIn.folder === 'system') ? 'Updates' : (lastIn && !head.archived) ? 'Inbox' : null;

    const subj = el('div', { class: 'gm-th-head' }, [
      el('h2', { class: 'gm-th-subj' }, [
        el('span', null, subject + ' '),
        folderChip ? el('span', { class: 'gm-chip gm-chip-x' }, folderChip) : null,
        head.mailbox ? el('span', { class: 'gm-chip gm-chip-x' }, shortBox(head.mailbox)) : null,
      ]),
      el('div', { class: 'gm-th-tools' }, [
        el('button', { type: 'button', class: 'gm-star gm-star-lg' + (starred ? ' on' : ''), title: starred ? 'Starred' : 'Not starred',
          onClick: () => act([S.thread], starred ? 'unstar' : 'star', { quiet: true }) }, ic('star', 22, starred ? 'filled' : '')),
        lastIn && lastIn.peer_email ? el('a', { class: 'gm-ib', title: 'Open in your mail app', 'aria-label': 'Open in your mail app',
          href: 'mailto:' + encodeURIComponent(lastIn.peer_email) + '?subject=' + encodeURIComponent('Re: ' + subject) }, ic('ext')) : null,
      ]),
    ]);

    const cards = [];
    let folded = [];
    const flushFolded = () => {
      if (folded.length >= 2) {
        const n = folded.length; const ids = folded.map(m => m.id);
        cards.push(el('button', { type: 'button', class: 'gm-folded', onClick: () => { ids.forEach(id => S.expanded.add(id)); paintThread(); } },
          el('span', { class: 'gm-folded-n' }, String(n))));
      } else folded.forEach(m => cards.push(messageCard(m, false)));
      folded = [];
    };
    shown.forEach((m, i) => {
      const open = S.expanded.has(m.id);
      if (!open && i > 0 && i < shown.length - 1) { folded.push(m); return; }
      flushFolded();
      cards.push(messageCard(m, open));
    });
    flushFolded();

    mount(mainHost, [
      threadToolbar(msgs),
      el('div', { class: 'gm-th-scroll' }, [
        subj,
        el('div', { class: 'gm-msgs' }, cards),
        replyArea(lastIn, head, subject),
      ]),
    ]);
  }

  function messageCard(m, open) {
    const isOut = m.direction === 'out';
    const d = decodeMessage(m);
    const name = isOut ? 'LoadBoot' : (m.peer_name || String(m.peer_email || '').split('@')[0] || 'Sender');
    const email = isOut ? (m.status === 'draft' || m.mail_class === 'compose' ? m.mailbox : replyFromFor(m.mailbox)) : m.peer_email;
    const when = m.status === 'sent' && m.sent_at ? m.sent_at : m.created_at;
    const snippet = previewOf(m, 120);
    const toggle = () => { if (S.expanded.has(m.id)) S.expanded.delete(m.id); else S.expanded.add(m.id); paintThread(); };

    if (!open) {
      return el('div', { class: 'gm-msg gm-msg-c', onClick: toggle }, [
        avatar(isOut ? 'LoadBoot' : (m.peer_name || m.peer_email)),
        el('div', { class: 'gm-msg-c-body' }, [
          el('div', { class: 'gm-msg-c-top' }, [el('span', { class: 'gm-msg-name' }, name),
            el('span', { class: 'gm-msg-date gm-msg-date-l' }, longDate(when)), el('span', { class: 'gm-msg-date gm-msg-date-s' }, listDate(when))]),
          el('div', { class: 'gm-msg-snip' }, m.status === 'draft' ? 'Draft' : snippet),
        ]),
      ]);
    }

    const toLine = isOut ? 'to ' + (m.peer_email || '') : 'to ' + (m.mailbox || 'me');
    const bodyHost = el('div', { class: 'gm-msg-body' });
    if (isOut && d.html) {
      mount(bodyHost, el('div', { class: 'gm-own' }, sanitizeNodes(d.html)));
    } else if (d.html) {
      mount(bodyHost, bodyFrame(m.id, d.html, d.text));
    } else {
      mount(bodyHost, el('div', { class: 'gm-plain' }, d.text || '(empty message)'));
    }
    const status = m.status === 'draft' ? el('span', { class: 'gm-draft' }, 'Draft') : m.status === 'failed' ? el('span', { class: 'gm-draft' }, 'Failed: ' + (m.send_error || 'not delivered')) : null;
    return el('div', { class: 'gm-msg' }, [
      avatar(isOut ? 'LoadBoot' : (m.peer_name || m.peer_email)),
      el('div', { class: 'gm-msg-main' }, [
        el('div', { class: 'gm-msg-h', onClick: (e) => { if (!e.target.closest('button,a')) toggle(); } }, [
          el('div', { class: 'gm-msg-who' }, [
            el('span', { class: 'gm-msg-name' }, name), ' ',
            email ? el('span', { class: 'gm-msg-email' }, '<' + email + '>') : null, ' ', status,
            el('div', { class: 'gm-msg-to' }, toLine),
          ]),
          el('div', { class: 'gm-msg-right' }, [
            el('span', { class: 'gm-msg-date gm-msg-date-l', title: fmtDateTime(when) }, longDate(when)),
            el('span', { class: 'gm-msg-date gm-msg-date-s', title: fmtDateTime(when) }, listDate(when)),
            S.canDraft && m.status !== 'draft' ? ib('reply', 'Reply', () => startReply('reply')) : null,
            S.canDraft && m.status !== 'draft' ? ib('forward', 'Forward', () => startForward(m)) : null,
            m.status === 'draft' && m.mail_class === 'compose' ? el('button', { type: 'button', class: 'gm-linkbtn', onClick: () => openDraftComposer(S.thread, {}) }, 'Edit draft') : null,
          ]),
        ]),
        d.attachments && d.attachments.length
          ? el('div', { class: 'gm-attach' }, [ic('file', 18), ' ' + d.attachments.map(a => a.filename).join(', ') + ' — attachments are not stored yet; open the message in your mail app to get them.'])
          : null,
        bodyHost,
      ]),
    ]);
  }

  /**
   * SECURITY BOUNDARY — inbound HTML.
   *
   * `html` is attacker-controlled: anyone who can email loads@ can put markup here. It is never
   * parsed by this document. The iframe has:
   *   • sandbox WITHOUT allow-scripts      → no JS runs, ever
   *   • sandbox WITHOUT allow-same-origin  → opaque origin: no access to our cookies, storage,
   *                                          Supabase session, or parent DOM
   *   • a CSP meta that blocks every remote fetch, so a tracking pixel cannot phone home and tell
   *     a sender that staff opened their mail. "Display images below" re-renders with img-src https:
   *     — a deliberate, per-message choice (Gmail's own banner).
   *   • allow-popups + <base target="_blank"> so a link the reader clicks still opens, in a new tab
   *   • referrerpolicy=no-referrer so we never leak CC URLs outward
   *
   * The frame cannot self-size (that would need same-origin), so its height is estimated from the
   * content with a Show more toggle.
   */
  function bodyFrame(id, html, text) {
    const showRemote = S.showImages.has(id);
    let expanded = false, showingText = false;
    const hasRemote = /<img[^>]+src\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
    const frame = el('iframe', {
      class: 'gm-frame', sandbox: 'allow-popups allow-popups-to-escape-sandbox',
      referrerpolicy: 'no-referrer', loading: 'lazy', title: 'Message body (isolated)',
    });
    // Estimate the height from the text and the width the frame will get (it cannot measure itself).
    const plainLen = htmlToText(html).length;
    const blocks = (html.match(/<(br|p|div|tr|li|h\d|table)\b/gi) || []).length;
    const cpl = Math.max(28, Math.round((MOBILE() ? window.innerWidth - 36 : Math.min(window.innerWidth - 760, 1100)) / 7.4));
    const est = Math.min(1600, Math.max(140, Math.ceil(plainLen / cpl) * 21 + blocks * 14 + 60));
    const capped = Math.min(est, 560);
    const csp = showRemote
      ? "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:;"
      : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;";
    frame.setAttribute('srcdoc',
      '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
      + '<base target="_blank">'
      + '<style>html,body{margin:0;padding:0 2px;font:14px/1.5 Arial,Helvetica,sans-serif;'
      + 'color:#222;background:#fff;word-break:break-word}img{max-width:100%;height:auto}'
      + 'table{max-width:100%!important}a{color:#1a73e8}</style></head><body>' + html + '</body></html>');
    const setH = () => { frame.style.height = (expanded ? est : capped) + 'px'; };
    setH();
    const plain = el('div', { class: 'gm-plain', hidden: true }, text || htmlToText(html));
    const tools = el('div', { class: 'gm-frame-tools' }, [
      est > capped ? (() => { const b = el('button', { type: 'button', class: 'gm-linkbtn', onClick: () => { expanded = !expanded; b.textContent = expanded ? 'Show less' : 'Show more'; setH(); } }, 'Show more'); return b; })() : null,
      (() => { const b = el('button', { type: 'button', class: 'gm-linkbtn', onClick: () => {
        showingText = !showingText; frame.hidden = showingText; plain.hidden = !showingText;
        b.textContent = showingText ? 'View formatted' : 'View plain text';
      } }, 'View plain text'); return b; })(),
    ].filter(Boolean));
    return el('div', null, [
      hasRemote && !showRemote ? el('div', { class: 'gm-imgbar' }, [
        ic('image', 18), el('span', null, 'Images in this message are hidden. '),
        el('button', { type: 'button', class: 'gm-linkbtn', onClick: () => { S.showImages.add(id); paintThread(); } }, 'Display images below'),
      ]) : null,
      frame, plain, tools,
    ]);
  }

  // ── reply (inline, Gmail style) ──
  function startReply(mode) {
    if (!S.canDraft) return;
    const lastIn = [...(S.msgs || [])].reverse().find(m => m.direction === 'in');
    const head = (S.msgs || [])[0];
    if (!lastIn) {
      // A conversation we started: "Reply" is another new message to the same person, same subject.
      const out = [...(S.msgs || [])].reverse().find(m => m.direction === 'out');
      if (!out) return;
      openCompose({ to: out.peer_email, subject: 'Re: ' + (decodeSubject(head.subject) || '').replace(/^(re|fwd?)\s*:\s*/i, ''), from: out.mailbox });
      return;
    }
    if (!S.reply) S.reply = { mode, html: '', draftId: null, dirty: false };
    paintThread();
    setTimeout(() => { const b = mainHost.querySelector('.gm-reply .gm-editor'); if (b) { b.focus(); b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }, 30);
  }
  function startForward(m) {
    const d = decodeMessage(m);
    const who = m.direction === 'out' ? (m.mailbox || 'LoadBoot') : ((m.peer_name ? m.peer_name + ' ' : '') + '<' + (m.peer_email || '') + '>');
    const subject = decodeSubject(m.subject) || '';
    const bodyText = d.text || htmlToText(d.html || '');
    const header = '---------- Forwarded message ---------\nFrom: ' + who + '\nDate: ' + longDate(m.created_at).replace(/ \(.*\)$/, '')
      + '\nSubject: ' + subject + '\nTo: ' + (m.direction === 'out' ? m.peer_email : m.mailbox) + '\n\n';
    openCompose({ to: '', subject: 'Fwd: ' + subject.replace(/^fwd?\s*:\s*/i, ''), bodyHtml: '<p><br></p>' + textToHtml(header + bodyText),
      from: replyFromFor(m.mailbox), note: d.attachments && d.attachments.length ? 'Attachments are not forwarded (not stored yet).' : '' });
  }

  function replyArea(lastIn, head, subject) {
    if (!S.canDraft) {
      return el('div', { class: 'gm-reply-note' }, 'You can read this conversation but not reply (comm.send required).');
    }
    if (!S.reply) {
      return el('div', { class: 'gm-reply-btns' }, [
        el('button', { type: 'button', class: 'gm-pill', onClick: () => startReply('reply') }, [ic('reply', 20), 'Reply']),
        el('button', { type: 'button', class: 'gm-pill', onClick: () => { const last = [...S.msgs].reverse().find(m => m.status !== 'draft'); if (last) startForward(last); } }, [ic('forward', 20), 'Forward']),
      ]);
    }
    const R = S.reply;
    const editor = makeEditor(R.html, () => { R.dirty = true; R.html = editor.getHtml(); });
    const status = el('span', { class: 'gm-reply-status' }, R.draftId ? (R.dirty ? '' : 'Draft saved') : '');
    const err = el('div', { class: 'gm-cmp-err', hidden: true });
    const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; };
    const from = replyFromFor(lastIn && lastIn.mailbox);

    const save = async (quiet) => {
      const html = sanitizeHtml(editor.getHtml());
      if (!htmlToText(html)) { if (!quiet) showErr('Write something first.'); return null; }
      try {
        const id = await mailDraftSave(S.thread, html);
        R.draftId = id; R.dirty = false; R.html = html; R.savedAt = new Date().toISOString();
        status.textContent = 'Draft saved'; showErr('');
        const t = S.threads.find(x => x.thread_key === S.thread); if (t) t.has_draft = true;
        loadStats();
        return id;
      } catch (e) { showErr(mailErr(e)); return null; }
    };
    const sendBtn = el('button', { type: 'button', class: 'gm-send', onClick: async () => {
      if (!S.canSend) {
        const id = await save(false);
        if (id) snack('Draft saved. Sending needs comm.manage — an owner can open it and press Send.');
        return;
      }
      sendBtn.disabled = true;
      const id = (R.dirty || !R.draftId) ? await save(false) : R.draftId;
      if (!id) { sendBtn.disabled = false; return; }
      const ok = await askConfirm('Send this reply for real?', {
        body: 'This emails ' + ((lastIn && lastIn.peer_email) || 'the sender') + ' from ' + from + ' now. Drafts are safe; sending cannot be undone.',
        subtitle: 'Outbound email', confirmLabel: 'Send it',
      });
      if (!ok) { sendBtn.disabled = false; return; }
      try {
        const res = await mailSend(id);
        S.reply = null;
        snack(res && res.ok === false ? 'Already sent — nothing sent twice.' : 'Message sent.');
        loadStats(); openThread(S.thread, false);
      } catch (e) { showErr(mailErr(e)); sendBtn.disabled = false; }
    } }, S.canSend ? 'Send' : 'Save draft');
    R.flush = async () => { if (R.dirty && htmlToText(editor.getHtml())) { const id = await save(true); if (id) snack('Draft saved.'); } };

    return el('div', { class: 'gm-reply' }, [
      avatar('LoadBoot'),
      el('div', { class: 'gm-reply-card' }, [
        el('div', { class: 'gm-reply-to' }, [ic(R.mode === 'forward' ? 'forward' : 'reply', 18), el('span', null, (lastIn && lastIn.peer_email) || ''),
          el('span', { class: 'gm-reply-from' }, 'from ' + from)]),
        editor.node,
        err,
        el('div', { class: 'gm-cmp-bottom' }, [
          sendBtn,
          editor.formatToggle,
          status,
          el('span', { class: 'gm-flex' }),
          ib('trash', 'Discard draft', async () => {
            if (R.draftId) {
              try { await mailDraftDiscard(S.thread); } catch (e) { showErr(mailErr(e)); return; }
              const t = S.threads.find(x => x.thread_key === S.thread); if (t) t.has_draft = false;
              loadStats(); snack('Draft discarded.');
            }
            S.reply = null;
            S.msgs = S.msgs.filter(m => m.id !== R.draftId);
            paintThread();
          }),
        ]),
        editor.toolbar,
      ]),
    ]);
  }
  function flushReply() { if (S.reply && S.reply.flush) { const f = S.reply.flush; S.reply.flush = null; f(); } }

  // ── rich-text editor (composer + reply) ──
  function makeEditor(initialHtml, onInput) {
    const node = el('div', { class: 'gm-editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Message Body', spellcheck: 'true' });
    sanitizeNodes(initialHtml || '').forEach(n => node.appendChild(n));
    node.addEventListener('input', () => onInput && onInput());
    // Paste as plain text: other people's markup never enters our outbound HTML.
    node.addEventListener('paste', (e) => {
      const t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (t == null) return;
      e.preventDefault();
      document.execCommand('insertText', false, t);
    });
    const cmd = (c, v) => (e) => { e.preventDefault(); node.focus(); document.execCommand(c, false, v); onInput && onInput(); };
    const tbtn = (name, title, c, v) => el('button', { type: 'button', class: 'gm-ib gm-fmt', title, 'aria-label': title, onMousedown: cmd(c, v) }, ic(name, 18));
    const toolbar = el('div', { class: 'gm-fmtbar', hidden: true }, [
      tbtn('undo', 'Undo (Ctrl-Z)', 'undo'), tbtn('redo', 'Redo (Ctrl-Y)', 'redo'), el('span', { class: 'gm-tb-sep' }),
      tbtn('bold', 'Bold (Ctrl-B)', 'bold'), tbtn('italic', 'Italic (Ctrl-I)', 'italic'), tbtn('underline', 'Underline (Ctrl-U)', 'underline'),
      el('span', { class: 'gm-tb-sep' }),
      tbtn('ol', 'Numbered list', 'insertOrderedList'), tbtn('ul', 'Bulleted list', 'insertUnorderedList'), tbtn('quote', 'Quote', 'formatBlock', 'blockquote'),
      el('button', { type: 'button', class: 'gm-ib gm-fmt', title: 'Insert link', 'aria-label': 'Insert link', onMousedown: (e) => {
        e.preventDefault();
        const url = window.prompt('Link address (https://…)', 'https://');
        if (!url || !/^(https?:|mailto:)/i.test(url.trim())) return;
        node.focus(); document.execCommand('createLink', false, url.trim()); onInput && onInput();
      } }, ic('link', 18)),
      tbtn('clear', 'Remove formatting', 'removeFormat'),
    ]);
    const formatToggle = el('button', { type: 'button', class: 'gm-ib gm-aa', title: 'Formatting options', 'aria-label': 'Formatting options',
      onClick: () => { toolbar.hidden = !toolbar.hidden; formatToggle.classList.toggle('on', !toolbar.hidden); } }, ic('font', 20));
    return { node, toolbar, formatToggle, getHtml: () => node.innerHTML };
  }

  // ── composer: the floating "New Message" window ──
  function openCompose(init) {
    // Every new composer gets a history entry, so Back (or a phone's back gesture) closes it.
    S.pushedCompose = !composer;
    nav({ compose: 'new' });
    if (composer) composer.fill(init);
  }
  function openComposer(init, opts = {}) {
    if (composer) { composer.focus(); return composer; }
    composer = createComposer(init, opts);
    return composer;
  }
  async function openDraftComposer(threadKey, opts = {}) {
    if (!opts.fromRoute) {
      if (composer) { const c = composer; await c.close({ save: true, keepRoute: true }); if (composer) return; }
      S.pushedCompose = true; nav({ compose: null, draft: threadKey });
      return;
    }
    if (openingDraft === threadKey) return;
    openingDraft = threadKey;
    let msgs;
    try { msgs = await mailThread(threadKey, false); } catch (e) { openingDraft = null; toast(mailErr(e), 'error'); return; }
    openingDraft = null;
    const d = (msgs || []).find(m => m.status === 'draft' && m.mail_class === 'compose');
    if (!d) { toast('That draft was already sent or discarded.'); reloadAll(); nav({ draft: null }, { replace: true }); return; }
    if (composer) composer.destroyQuiet();
    composer = createComposer({ to: d.peer_email, subject: decodeSubject(d.subject), from: d.mailbox, bodyHtml: d.body_html || '', draftId: d.id, threadKey }, { routeDraft: threadKey });
  }

  function createComposer(init, opts = {}) {
    const C = { draftId: init.draftId || null, threadKey: init.threadKey || null, dirty: false, sending: false,
      routed: true, routeCompose: opts.routeDraft ? null : 'new', routeDraft: opts.routeDraft || null };
    const fromSel = el('select', { class: 'gm-fld-in gm-from-sel', 'aria-label': 'From' },
      FROM_ADDRS.map(a => el('option', { value: a.v }, a.label)));
    fromSel.value = FROM_ADDRS.some(a => a.v === String(init.from || '').toLowerCase()) ? String(init.from).toLowerCase() : 'hello@loadboot.com';
    const toIn = el('input', { class: 'gm-fld-in', type: 'email', autocomplete: 'email', 'aria-label': 'To recipients', value: init.to || '' });
    const subjIn = el('input', { class: 'gm-fld-in', type: 'text', placeholder: 'Subject', 'aria-label': 'Subject', value: init.subject || '' });
    const titleEl = el('span', { class: 'gm-cmp-title' }, init.subject || 'New Message');
    const markDirty = () => { C.dirty = true; titleEl.textContent = subjIn.value.trim() || 'New Message'; };
    [fromSel, toIn, subjIn].forEach(n => n.addEventListener('input', markDirty));
    const editor = makeEditor(init.bodyHtml || (init.body ? textToHtml(init.body) : ''), markDirty);
    const err = el('div', { class: 'gm-cmp-err', hidden: !init.note, role: 'alert' }, init.note || '');
    const showErr = (m) => { err.textContent = m || ''; err.hidden = !m; err.classList.toggle('info', false); };
    const saved = el('span', { class: 'gm-reply-status' }, C.draftId ? 'Draft saved' : '');

    const save = async (quiet) => {
      const html = sanitizeHtml(editor.getHtml());
      if (!htmlToText(html) && !toIn.value.trim() && !subjIn.value.trim()) return 'empty';
      try {
        const r = await mailComposeSave({ from: fromSel.value, to: toIn.value.trim(), subject: subjIn.value.trim(), bodyHtml: html, draftId: C.draftId });
        C.draftId = r && r.id; C.threadKey = r && r.thread_key; C.dirty = false;
        saved.textContent = 'Draft saved'; showErr('');
        loadStats();
        if (S.folder === 'drafts') loadList({ silent: true });
        return C.draftId;
      } catch (e) { showErr(mailErr(e)); if (!quiet) toIn.focus(); return null; }
    };

    const send = async () => {
      if (C.sending) return;
      if (!toIn.value.trim()) { showErr('Please specify at least one recipient.'); toIn.focus(); return; }
      if (!S.canSend) {
        const id = await save(false);
        if (id && id !== 'empty') { snack('Draft saved. Sending needs comm.manage — an owner can open it from Drafts and press Send.'); close({ save: false }); }
        return;
      }
      C.sending = true; sendBtn.disabled = true;
      const id = (C.dirty || !C.draftId) ? await save(false) : C.draftId;
      if (!id || id === 'empty') { C.sending = false; sendBtn.disabled = false; if (id === 'empty') showErr('Write the message first.'); return; }
      const ok = await askConfirm('Send this email for real?', {
        body: 'This emails ' + toIn.value.trim() + ' from ' + fromSel.value + ' now. Drafts are safe; sending cannot be undone.',
        subtitle: 'Outbound email', confirmLabel: 'Send it',
      });
      if (!ok) { C.sending = false; sendBtn.disabled = false; return; }
      try {
        const res = await mailSend(id);
        const key = C.threadKey;
        close({ save: false });
        snack(res && res.ok === false ? 'Already sent — nothing sent twice.' : 'Message sent.', null);
        loadStats(); if (['sent', 'all', 'drafts'].includes(S.folder)) loadList({ silent: true });
        void key;
      } catch (e) { showErr(mailErr(e)); C.sending = false; sendBtn.disabled = false; }
    };

    const sendBtn = el('button', { type: 'button', class: 'gm-send', title: S.canSend ? 'Send (Ctrl-Enter)' : 'Save draft (sending needs comm.manage)', onClick: send }, S.canSend ? 'Send' : 'Save draft');
    const sendMenu = el('span', { class: 'gm-drop gm-send-drop' });
    const sendCaret = el('button', { type: 'button', class: 'gm-send-caret', title: 'More send options', 'aria-label': 'More send options', onClick: (e) => {
      e.stopPropagation();
      const open = sendMenu.querySelector('.gm-menu'); if (open) { open.remove(); return; }
      const menu = el('div', { class: 'gm-menu gm-menu-up', role: 'menu' }, [
        el('button', { type: 'button', class: 'gm-menu-i', onClick: async () => { menu.remove(); const id = await save(false); if (id && id !== 'empty') snack('Draft saved.'); } }, 'Save draft'),
      ]);
      sendMenu.appendChild(menu);
      setTimeout(() => document.addEventListener('click', function off(ev) { if (!sendMenu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', off, true); } }, true), 0);
    } }, ic('caret', 18));
    sendMenu.appendChild(sendCaret);

    const discard = async () => {
      if (C.draftId && C.threadKey) {
        try { await mailDraftDiscard(C.threadKey); } catch (e) { showErr(mailErr(e)); return; }
        loadStats(); if (S.folder === 'drafts') loadList({ silent: true });
      }
      close({ save: false });
      snack('Draft discarded.');
    };

    const minBtn = ib('min', 'Minimize', () => { win.classList.toggle('min'); win.classList.remove('max'); scrim.hidden = true; });
    const maxBtn = ib('max', 'Full screen', () => { const m = !win.classList.contains('max'); win.classList.toggle('max', m); win.classList.remove('min'); scrim.hidden = !m; });
    const closeBtn = ib('x', 'Save & close', () => close({ save: true }));

    const win = el('div', { class: 'gm-cmp', role: 'dialog', 'aria-label': 'New Message' }, [
      el('div', { class: 'gm-cmp-head', onClick: (e) => { if (!e.target.closest('button') && win.classList.contains('min')) win.classList.remove('min'); } }, [
        ib('back', 'Save & close', () => close({ save: true }), { cls: 'gm-m-only' }),
        titleEl, el('span', { class: 'gm-flex' }), minBtn, maxBtn, closeBtn,
        el('button', { type: 'button', class: 'gm-ib gm-m-only gm-m-send', title: 'Send', 'aria-label': 'Send', onClick: send }, ic('send', 22)),
      ]),
      el('div', { class: 'gm-cmp-body' }, [
        el('label', { class: 'gm-fld' }, [el('span', { class: 'gm-fld-l' }, 'From'), fromSel]),
        el('label', { class: 'gm-fld' }, [el('span', { class: 'gm-fld-l' }, 'To'), toIn]),
        el('label', { class: 'gm-fld' }, [el('span', { class: 'gm-fld-l gm-m-only' }, 'Subject'), subjIn]),
        err,
        editor.node,
        editor.toolbar,
        el('div', { class: 'gm-cmp-bottom' }, [
          el('span', { class: 'gm-send-grp' }, [sendBtn, sendMenu]),
          editor.formatToggle,
          saved,
          el('span', { class: 'gm-flex' }),
          ib('trash', 'Discard draft', discard),
        ]),
      ]),
    ]);
    const scrim = el('div', { class: 'gm-cmp-scrim', hidden: true, onClick: () => { win.classList.remove('max'); scrim.hidden = true; } });
    editor.node.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); } });
    win.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.getElementById('cc-drawer-root')) { e.stopPropagation(); close({ save: true }); } });
    document.body.appendChild(scrim);
    document.body.appendChild(win);
    if (MOBILE()) document.documentElement.classList.add('gm-lock');
    if (fab) fab.hidden = true;
    setTimeout(() => { (toIn.value ? (subjIn.value ? editor.node : subjIn) : toIn).focus(); }, 40);

    let closing = false;
    async function close(o = {}) {
      if (closing) return;
      if (o.save && C.dirty) {
        closing = true;
        const r = await save(true);
        closing = false;
        if (r === null) {
          // Could not save (e.g. no valid To yet): keep the window, and its history entry, alive.
          if (o.fromRoute) { try { history.pushState(null, '', hashFor(Object.assign(current(), { compose: C.routeCompose, draft: C.routeDraft }))); } catch (_) {} }
          win.classList.remove('min');
          return;
        }
        if (r !== 'empty') snack('Draft saved.');
      }
      destroyQuiet();
      if (!o.fromRoute && !o.keepRoute) {
        if (S.pushedCompose && history.length > 1) { S.pushedCompose = false; history.back(); }
        else nav({ compose: null, draft: null }, { replace: true });
      }
    }
    function destroyQuiet() {
      win.remove(); scrim.remove();
      document.documentElement.classList.remove('gm-lock');
      if (composer === api) composer = null;
      if (fab) fab.hidden = !!S.thread;
    }
    const api = {
      routed: C.routed, routeCompose: C.routeCompose, routeDraft: C.routeDraft,
      close, destroyQuiet,
      focus: () => { win.classList.remove('min'); toIn.focus(); },
      fill: (i) => { if (!i) return; if (i.to && !toIn.value) toIn.value = i.to; if (i.subject && !subjIn.value) { subjIn.value = i.subject; titleEl.textContent = i.subject; }
        if (i.from) fromSel.value = FROM_ADDRS.some(a => a.v === String(i.from).toLowerCase()) ? String(i.from).toLowerCase() : fromSel.value;
        if (i.bodyHtml && !htmlToText(editor.getHtml())) { sanitizeNodes(i.bodyHtml).forEach(n => editor.node.appendChild(n)); }
        if (i.note) { err.textContent = i.note; err.hidden = false; }
        C.dirty = true; },
    };
    return api;
  }

  // ── Gmail keyboard shortcuts ──
  function keyboard(e) {
    if (!root.isConnected) return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      if (e.key === 'Escape' && t === searchIn) searchIn.blur();
      return;
    }
    if (document.getElementById('cc-drawer-root')) return;
    const k = e.key;
    const rows = [...mainHost.querySelectorAll('.gm-row')];
    const focusIdx = rows.indexOf(document.activeElement);
    if (k === 'c' && S.canDraft) { e.preventDefault(); openCompose({}); }
    else if (k === '/') { e.preventDefault(); searchIn.focus(); }
    else if (k === 'u' && S.thread) { backToList(); }
    else if ((k === 'j' || k === 'k') && S.thread) {
      const idx = S.threads.findIndex(x => x.thread_key === S.thread);
      const nt = S.threads[idx + (k === 'j' ? 1 : -1)];
      if (nt) nav({ thread: nt.thread_key }, { replace: true, markRead: true });
    } else if ((k === 'j' || k === 'k') && rows.length) {
      const n = rows[Math.min(rows.length - 1, Math.max(0, focusIdx + (k === 'j' ? 1 : -1)))];
      if (n) n.focus();
    } else if (k === 'x' && focusIdx >= 0) {
      const key = rows[focusIdx].dataset.key; if (S.sel.has(key)) S.sel.delete(key); else S.sel.add(key); paintListView();
      const again = mainHost.querySelector('.gm-row[data-key="' + CSS.escape(key) + '"]'); if (again) again.focus();
    } else {
      const keys = S.thread ? [S.thread] : (S.sel.size ? [...S.sel] : (focusIdx >= 0 ? [rows[focusIdx].dataset.key] : []));
      if (!keys.length) return;
      const rowsT = S.threads.filter(x => keys.includes(x.thread_key));
      if (k === 'e' && S.canDraft) act(keys, 'archive');
      else if (k === '#' && S.canSend) act(keys, 'trash');
      else if (k === 's') act(keys, rowsT.some(x => x.starred) ? 'unstar' : 'star', { quiet: true });
      else if (k === 'I') act(keys, 'read');
      else if (k === 'U') act(keys, 'unread');
      else if (k === 'r' && S.thread) { e.preventDefault(); startReply('reply'); }
      else if (k === 'f' && S.thread) { const last = [...(S.msgs || [])].reverse().find(m => m.status !== 'draft'); if (last) startForward(last); }
    }
  }

  return { host, root, apply, destroy };
}

// Scoped styles, injected once into <head> (the view host is re-mounted on every route change).
// Colours, sizes and spacing follow Gmail's 2024 web + Android layout.
function injectStyleOnce() {
  if (document.getElementById('gm-mail-style')) return;
  document.head.appendChild(el('style', { id: 'gm-mail-style' }, `
.cc-content:has(> .gm){max-width:none;padding:0}
.gm,.gm-cmp,.gm-snack,.gm-sheet,.gm-snooze{--gm-bg:#f6f8fc;--gm-ink:#1f1f1f;--gm-mut:#5f6368;--gm-ic:#444746;--gm-blue:#0b57d0;--gm-act:#d3e3fd;--gm-hov:rgba(68,71,70,.08);--gm-line:#eceff1}
.gm{display:grid;grid-template-columns:256px minmax(0,1fr);grid-template-rows:64px minmax(0,1fr);grid-template-areas:"top top" "rail main";
  background:var(--gm-bg);color:var(--gm-ink);font:14px/20px "Google Sans",Roboto,"Segoe UI",Arial,sans-serif;min-height:420px;position:relative}
.gm.rail-collapsed{grid-template-columns:72px minmax(0,1fr)}
.gm *{box-sizing:border-box}
.gm-i{display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0}
.gm-i.filled svg{fill:#f4b400;stroke:#f4b400}
.gm-ib{width:40px;height:40px;border-radius:50%;border:0;background:transparent;color:var(--gm-ic);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;padding:0;text-decoration:none}
.gm-ib:hover{background:var(--gm-hov);color:var(--gm-ink)}
.gm-ib:disabled{opacity:.38;cursor:default;background:transparent}
.gm-flex{flex:1}
.gm-linkbtn{border:0;background:none;color:var(--gm-blue);cursor:pointer;font:inherit;padding:0;text-decoration:underline}
.gm-m-only{display:none!important}
/* top */
.gm-top{grid-area:top;display:flex;align-items:center;gap:8px;padding:8px 16px 8px 12px}
.gm-railbtn{margin-right:6px}
.gm-search{flex:1;max-width:720px;height:48px;border-radius:24px;background:#eaf1fb;display:flex;align-items:center;padding:0 6px;transition:background .15s,box-shadow .15s}
.gm-search:focus-within{background:#fff;box-shadow:0 1px 1px 0 rgba(65,69,73,.3),0 1px 3px 1px rgba(65,69,73,.15)}
.gm-search-in{flex:1;border:0;background:transparent;outline:0;font:16px "Google Sans",Roboto,Arial,sans-serif;color:var(--gm-ink);min-width:0;padding:0 4px}
.gm-search-in::-webkit-search-cancel-button{display:none}
.gm-search-x{visibility:hidden}.gm-search.has-q .gm-search-x{visibility:visible}
.gm-search-menu{display:none}
/* rail */
.gm-rail{grid-area:rail;overflow-y:auto;overflow-x:hidden;padding:0 0 16px}
.gm-compose{display:inline-flex;align-items:center;gap:12px;height:56px;min-width:56px;margin:8px 0 16px 8px;padding:0 24px 0 16px;border:0;border-radius:16px;background:#c2e7ff;color:#001d35;font:500 14px "Google Sans",Roboto,Arial,sans-serif;cursor:pointer;transition:box-shadow .15s}
.gm-compose:hover{box-shadow:0 1px 3px 0 rgba(60,64,67,.3),0 4px 8px 3px rgba(60,64,67,.15)}
.gm-navs{display:flex;flex-direction:column}
.gm-nav{display:flex;align-items:center;gap:18px;height:32px;padding:0 12px 0 26px;margin-right:8px;border-radius:0 16px 16px 0;color:#202124;text-decoration:none;font-size:14px;border:0;background:none;cursor:pointer;text-align:left;font-family:inherit;white-space:nowrap}
.gm-nav:hover{background:rgba(32,33,36,.06)}
.gm-nav.active{background:var(--gm-act);color:#001d35;font-weight:700}
.gm-nav.bold{font-weight:700}
.gm-nav .gm-i{color:var(--gm-ic)}.gm-nav.active .gm-i{color:#001d35}
.gm-nav-t{flex:1;overflow:hidden;text-overflow:ellipsis}
.gm-nav-c{font-size:12px;letter-spacing:.2px}
.gm-labels-h{display:flex;align-items:center;height:40px;padding:0 16px 0 26px;margin-top:12px;font:500 16px "Google Sans",Roboto,Arial,sans-serif;color:var(--gm-ink)}
.gm.rail-collapsed .gm-compose{padding:0;width:56px;justify-content:center}
.gm.rail-collapsed .gm-compose span:last-child,.gm.rail-collapsed .gm-nav-t,.gm.rail-collapsed .gm-nav-c,.gm.rail-collapsed .gm-labels-h span{display:none}
.gm.rail-collapsed .gm-nav{width:56px;margin:0 8px;padding:0;justify-content:center;border-radius:16px}
.gm.rail-collapsed .gm-labels-h{padding:0;margin:8px 16px 0;border-top:1px solid #dadce0;height:8px}
/* main */
.gm-mainwrap{grid-area:main;min-width:0;min-height:0;position:relative;display:flex;flex-direction:column;margin:0 16px 16px 0}
.gm-main{flex:1;min-height:0;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
.gm-progress{position:absolute;left:0;right:0;top:0;height:3px;z-index:3;overflow:hidden;border-radius:16px 16px 0 0}
.gm-progress::after{content:"";position:absolute;inset:0;width:40%;background:var(--gm-blue);animation:gm-prog 1s ease-in-out infinite}
@keyframes gm-prog{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}
.gm-tb{display:flex;align-items:center;justify-content:space-between;min-height:48px;padding:0 8px 0 8px;gap:4px;flex:none}
.gm-tb-l{display:flex;align-items:center;gap:2px;min-width:0;flex-wrap:wrap}
.gm-tb-sep{display:inline-block;width:1px;height:20px;background:#dadce0;margin:0 6px}
.gm-cbwrap{display:inline-flex;align-items:center;padding-left:8px;border-radius:4px}
.gm-cbwrap:hover{background:var(--gm-hov)}
.gm-selcaret .gm-ib{width:20px;border-radius:4px}
.gm-cb{width:18px;height:18px;margin:0;accent-color:#444746;cursor:pointer}
.gm-pager{display:flex;align-items:center;gap:0;color:var(--gm-mut);font-size:12px;flex:none}
.gm-range{padding:0 8px;white-space:nowrap}
.gm-drop{position:relative;display:inline-flex}
.gm-menu{position:absolute;top:100%;left:0;z-index:40;min-width:180px;background:#fff;border-radius:4px;padding:6px 0;box-shadow:0 2px 2px 0 rgba(0,0,0,.14),0 3px 1px -2px rgba(0,0,0,.12),0 1px 5px 0 rgba(0,0,0,.2)}
.gm-menu-up{top:auto;bottom:100%}
.gm-menu-i{display:block;width:100%;text-align:left;border:0;background:none;padding:6px 20px;font:14px/20px "Google Sans",Roboto,Arial,sans-serif;color:var(--gm-ink);cursor:pointer;white-space:nowrap}
.gm-menu-i:hover{background:#f1f3f4}
.gm-tabs{display:flex;border-bottom:1px solid var(--gm-line);flex:none;padding-left:8px}
.gm-tabs[hidden]{display:none}
.gm-tab{flex:0 1 250px;display:flex;align-items:center;gap:16px;height:56px;padding:0 16px;color:var(--gm-ic);text-decoration:none;position:relative;font-weight:500;font-size:14px;border-radius:0}
.gm-tab:hover{background:#f5f5f5}
.gm-tab.active{color:var(--gm-blue)}
.gm-tab.active::after{content:"";position:absolute;left:8px;right:8px;bottom:0;height:3px;border-radius:3px 3px 0 0;background:var(--gm-blue)}
.gm-badge{font-size:12px;line-height:18px;padding:0 8px;border-radius:9px;color:#fff;font-weight:500;white-space:nowrap}
.gm-badge.orange{background:#e37400}.gm-badge.blue{background:#0b57d0}
.gm-mhead{display:none}
.gm-list{flex:1;overflow-y:auto;min-height:0}
.gm-empty{padding:48px 24px;text-align:center;color:var(--gm-mut);font-size:14px;line-height:1.6}
/* rows */
.gm-row{position:relative;display:grid;grid-template-columns:34px 30px minmax(120px,200px) minmax(0,1fr) 76px;align-items:center;height:40px;padding:0 16px 0 12px;
  background:#f2f6fc;color:#202124;cursor:pointer;border-bottom:1px solid var(--gm-line);outline:none}
.gm-row.unread{background:#fff}
.gm-row.unread .gm-from,.gm-row.unread .gm-subj,.gm-row.unread .gm-date{font-weight:700;color:#1f1f1f}
.gm-row:hover{box-shadow:inset 1px 0 0 #dadce0,inset -1px 0 0 #dadce0,0 1px 2px 0 rgba(60,64,67,.3),0 1px 3px 1px rgba(60,64,67,.15);z-index:2}
.gm-row:focus-visible{box-shadow:inset 4px 0 0 #0b57d0}
.gm-row.sel{background:#c2dbff}
.gm-c-av{display:none}
.gm-from{display:flex;align-items:center;gap:4px;min-width:0;padding-right:24px;white-space:nowrap}
.gm-from-t{overflow:hidden;text-overflow:ellipsis}
.gm-count{color:var(--gm-mut);font-size:12px;font-weight:400}
.gm-draft{color:#d93025;font-weight:400}
.gm-mid{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.gm-snip{color:var(--gm-mut);font-weight:400}
.gm-chip{display:inline-block;font-size:12px;line-height:18px;padding:0 6px;border-radius:4px;background:#e8eaed;color:#444746;margin-right:6px;font-weight:400;vertical-align:1px;white-space:nowrap}
.gm-chip.amber{background:#fef7e0;color:#b06000}.gm-chip.blue{background:#e8f0fe;color:#1a73e8}
.gm-date{font-size:12px;text-align:right;color:var(--gm-mut);white-space:nowrap}
.gm-hover{display:none;position:absolute;right:8px;top:0;bottom:0;align-items:center;background:inherit;padding-left:8px}
.gm-row:hover .gm-hover{display:flex}.gm-row:hover .gm-date{visibility:hidden}
.gm-star{border:0;background:none;padding:0;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;color:#c4c7c5;cursor:pointer;border-radius:50%}
.gm-row.unread .gm-star{color:#444746}
.gm-star:hover{color:#1f1f1f;background:var(--gm-hov)}
.gm-star.on{color:#f4b400}
.gm-star-lg{width:40px;height:40px}
.gm-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:500;flex:none;user-select:none}
.gm-av-sel{background:#0b57d0!important;width:40px;height:40px}
.gm-avbtn{border:0;background:none;padding:0;cursor:pointer;border-radius:50%;line-height:0}
/* thread */
.gm-th-scroll{flex:1;overflow-y:auto;min-height:0;padding-bottom:24px}
.gm-th-head{display:flex;align-items:flex-start;gap:8px;padding:20px 16px 8px 72px}
.gm-th-subj{flex:1;margin:0;font:400 22px/28px "Google Sans",Roboto,Arial,sans-serif;color:var(--gm-ink);word-break:break-word}
.gm-chip-x{font-size:12px;vertical-align:4px;margin-left:4px}
.gm-th-tools{display:flex;align-items:center;gap:4px}
.gm-msgs{display:flex;flex-direction:column}
.gm-msg{display:grid;grid-template-columns:40px minmax(0,1fr);gap:0 16px;padding:16px 16px 8px 16px;border-top:1px solid transparent}
.gm-msg + .gm-msg,.gm-folded + .gm-msg{border-top-color:var(--gm-line)}
.gm-msg-c{cursor:pointer;padding:12px 16px}
.gm-msg-c:hover{background:#f8f9fa}
.gm-msg-c-top{display:flex;justify-content:space-between;gap:12px}
.gm-msg-snip{color:var(--gm-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gm-msg-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;cursor:pointer}
.gm-msg-who{min-width:0;line-height:20px}
.gm-msg-name{font-weight:700;color:var(--gm-ink)}
.gm-msg-email{color:var(--gm-mut);font-size:12px}
.gm-msg-to{color:var(--gm-mut);font-size:12px}
.gm-msg-right{display:flex;align-items:center;gap:0;flex:none}
.gm-msg-date{color:var(--gm-mut);font-size:12px;white-space:nowrap;margin-right:6px}
.gm-msg-date-s{display:none}
.gm-msg-body{margin-top:12px;min-width:0}
.gm-own{font:14px/1.5 Arial,Helvetica,sans-serif;color:#222;word-break:break-word}
.gm-own p{margin:0 0 10px}.gm-own blockquote{margin:0 0 0 8px;padding-left:8px;border-left:2px solid #ccc;color:#555}
.gm-plain{white-space:pre-wrap;word-break:break-word;font:14px/1.5 Arial,Helvetica,sans-serif;color:#222}
.gm-frame{width:100%;border:0;display:block;background:#fff}
.gm-frame-tools{display:flex;gap:16px;margin-top:6px;font-size:12px}
.gm-imgbar{display:flex;align-items:center;gap:8px;background:#f1f3f4;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:13px;color:#3c4043}
.gm-attach{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--gm-mut)}
.gm-folded{display:flex;align-items:center;height:26px;border:0;border-top:1px solid var(--gm-line);border-bottom:1px solid var(--gm-line);background:repeating-linear-gradient(#fff 0 3px,#f1f3f4 3px 4px);cursor:pointer;padding:0 0 0 20px;margin:4px 0}
.gm-folded-n{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#fff;border:1px solid #dadce0;color:var(--gm-mut);font-size:13px}
.gm-reply-btns{display:flex;gap:12px;padding:20px 16px 8px 72px;flex-wrap:wrap}
.gm-pill{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 24px 0 16px;border:1px solid #747775;border-radius:20px;background:#fff;color:var(--gm-ic);font:500 14px "Google Sans",Roboto,Arial,sans-serif;cursor:pointer}
.gm-pill:hover{background:#f3f6fc;color:var(--gm-ink)}
.gm-reply-note{padding:20px 16px 8px 72px;color:var(--gm-mut)}
.gm-reply{display:grid;grid-template-columns:40px minmax(0,1fr);gap:0 16px;padding:16px}
.gm-reply-card{border-radius:8px;box-shadow:0 1px 2px 0 rgba(60,64,67,.3),0 2px 6px 2px rgba(60,64,67,.15);background:#fff;display:flex;flex-direction:column;min-width:0}
.gm-reply-to{display:flex;align-items:center;gap:8px;padding:12px 16px 4px;color:var(--gm-ink);flex-wrap:wrap}
.gm-reply-from{color:var(--gm-mut);font-size:12px;margin-left:auto}
.gm-reply .gm-editor{min-height:140px}
.gm-reply-status{color:var(--gm-mut);font-size:12px;margin-left:8px}
/* editor + composer */
.gm-editor{flex:1;min-height:120px;overflow-y:auto;padding:10px 16px;outline:0;font:14px/1.5 Arial,Helvetica,sans-serif;color:#222;word-break:break-word}
.gm-editor p{margin:0 0 10px}.gm-editor blockquote{margin:0 0 0 8px;padding-left:8px;border-left:2px solid #ccc;color:#555}
.gm-editor:empty::before{content:"";}
.gm-fmtbar{display:flex;align-items:center;flex-wrap:wrap;gap:0;margin:0 16px 8px;padding:2px 6px;border-radius:16px;background:#eef2f9}
.gm-fmtbar[hidden]{display:none}
.gm-fmt{width:32px;height:32px}
.gm-aa.on{background:#d3e3fd}
.gm-cmp-bottom{display:flex;align-items:center;gap:4px;padding:8px 16px 12px}
.gm-send-grp{display:inline-flex;align-items:center;margin-right:8px}
.gm-send{height:36px;padding:0 16px 0 24px;border:0;border-radius:18px;background:var(--gm-blue);color:#fff;font:500 14px "Google Sans",Roboto,Arial,sans-serif;cursor:pointer}
.gm-send-grp .gm-send{border-radius:18px 0 0 18px}
.gm-send:hover{box-shadow:0 1px 2px 0 rgba(60,64,67,.3),0 1px 3px 1px rgba(60,64,67,.15);background:#0a4ec0}
.gm-send:disabled{opacity:.6;cursor:default}
.gm-send-caret{height:36px;width:32px;border:0;border-left:1px solid rgba(255,255,255,.35);border-radius:0 18px 18px 0;background:var(--gm-blue);color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.gm-cmp-err{margin:8px 16px 0;padding:8px 12px;border-radius:8px;background:#fce8e6;color:#a50e0e;font-size:13px;line-height:1.45}
.gm-cmp-err[hidden]{display:none}
.gm-cmp{position:fixed;right:16px;bottom:0;width:560px;height:min(560px,calc(100vh - 80px));z-index:1200;background:#fff;border-radius:8px 8px 0 0;display:flex;flex-direction:column;
  box-shadow:0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12),0 5px 5px -3px rgba(0,0,0,.2);font:14px/20px "Google Sans",Roboto,Arial,sans-serif;color:#1f1f1f}
.gm-cmp *{box-sizing:border-box}
.gm-cmp.min{height:40px;width:320px}.gm-cmp.min .gm-cmp-body{display:none}
.gm-cmp.max{right:auto;bottom:auto;left:50%;top:50%;transform:translate(-50%,-50%);width:min(80vw,1100px);height:min(86vh,820px);border-radius:8px}
.gm-cmp-scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1199}
.gm-cmp-scrim[hidden]{display:none}
.gm-cmp-head{display:flex;align-items:center;height:40px;padding:0 4px 0 16px;background:#f2f6fc;border-radius:8px 8px 0 0;flex:none;cursor:default}
.gm-cmp.min .gm-cmp-head{cursor:pointer}
.gm-cmp-head .gm-ib{width:32px;height:32px}
.gm-cmp-title{font-weight:500;color:#041e49;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%}
.gm-cmp-body{flex:1;display:flex;flex-direction:column;min-height:0}
.gm-fld{display:flex;align-items:center;min-height:40px;margin:0 16px;border-bottom:1px solid #f1f3f4;gap:8px;flex:none}
.gm-fld-l{color:#444746;min-width:0}
.gm-fld-in:focus,.gm-fld-in:focus-visible,.gm-editor:focus-visible{outline:none!important;box-shadow:none!important}
.gm-fld-in{flex:1;min-width:0;border:0;outline:0;background:transparent;font:14px/20px "Google Sans",Roboto,Arial,sans-serif;color:#1f1f1f;padding:8px 0}
.gm-from-sel{appearance:none;-webkit-appearance:none;cursor:pointer}
/* snackbar */
.gm-snack{position:fixed;left:24px;bottom:24px;z-index:9400;display:flex;align-items:center;gap:16px;min-width:288px;max-width:568px;padding:6px 8px 6px 24px;border-radius:4px;background:#323232;color:#fff;font:14px/20px "Google Sans",Roboto,Arial,sans-serif;box-shadow:0 3px 5px -1px rgba(0,0,0,.2),0 6px 10px 0 rgba(0,0,0,.14)}
.gm-snack span{flex:1;padding:8px 0}
.gm-snack-undo{border:0;background:none;color:#a8c7fa;font:500 14px "Google Sans",Roboto,Arial,sans-serif;cursor:pointer;padding:8px}
.gm-snack-x{border:0;background:none;color:#fff;cursor:pointer;padding:6px;border-radius:50%;line-height:0}
/* snooze + phone folder sheet (inside openDrawer) */
.gm-snooze{display:flex;flex-direction:column}
.gm-snooze-i{display:flex;justify-content:space-between;gap:16px;padding:12px 8px;border:0;border-bottom:1px solid #f1f3f4;background:none;font:14px "Google Sans",Roboto,Arial,sans-serif;cursor:pointer;text-align:left;color:#1f1f1f}
.gm-snooze-i:hover{background:#f1f3f4}
.gm-snooze-t{color:#5f6368}
.gm-snooze-custom{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 8px 4px}
.gm-sheet .gm-compose{margin:0 0 12px}
.gm-sheet .gm-nav{margin-right:0;border-radius:16px;padding-left:16px}
.gm-sheet .gm-labels-h{padding-left:16px}
.gm-fab{display:none}
html.gm-lock,html.gm-lock body{overflow:hidden}

/* ── phones: the Gmail app ── */
@media (max-width:780px){
  .gm{display:block;background:#fff;min-height:0;padding-bottom:84px}
  .gm-top{padding:8px 12px}
  .gm-railbtn,.gm-rail{display:none}
  .gm-search{max-width:none;background:#eef2f9;border-radius:28px;height:52px}
  .gm-search-menu{display:inline-flex}.gm-search-go{display:none}
  .gm-mainwrap{margin:0}
  .gm-main{border-radius:0;overflow:visible}
  .gm-progress{position:fixed;top:0;border-radius:0;z-index:50}
  .gm-m-only{display:inline-flex!important}
  .gm-tb{display:none;position:sticky;top:0;z-index:15;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .gm-tb.has-sel,.gm-tb-thread{display:flex}
  .gm-tb.has-sel .gm-cbwrap,.gm-tb.has-sel .gm-pager{display:none}
  .gm-tb-thread{box-shadow:none}
  .gm-tb-thread .gm-pager{display:none}
  .gm-tb-thread .gm-tb-l{flex:1;flex-wrap:nowrap;justify-content:space-between}
  .gm-msg-date-l{display:none}.gm-msg-date-s{display:inline}
  .gm-msg-h{flex-wrap:nowrap}
  .gm-msg-who{flex:1}
  .gm-msg-right .gm-ib[title="Forward"]{display:none}
  .gm-cmp .gm-send-grp{display:none}
  .gm-selcount{font:500 18px "Google Sans",Roboto,Arial,sans-serif;margin:0 auto 0 8px;display:inline-flex}
  .gm-tb.has-sel .gm-tb-l{flex:1;flex-wrap:nowrap}
  .gm-tb-sep{display:none}
  .gm-tabs{display:none!important}
  .gm-mhead{display:flex;align-items:center;justify-content:space-between;padding:10px 16px 4px;color:#444746;font-size:14px}
  .gm-list{overflow:visible}
  .gm-row{grid-template-columns:40px minmax(0,1fr) auto;grid-template-areas:"av from date" "av subj star" "av snip star";
    column-gap:14px;row-gap:0;height:auto;padding:10px 16px;background:#fff;border-bottom:0;align-items:center}
  .gm-row:hover{box-shadow:none}
  .gm-row.sel{background:#d3e3fd}
  .gm-c-cb,.gm-hover,.gm-chip{display:none!important}
  .gm-c-av{display:block;grid-area:av;align-self:start;padding-top:2px}
  .gm-from{grid-area:from;padding-right:0;font-size:16px;line-height:22px;color:#444746}
  .gm-date{grid-area:date;align-self:center}
  .gm-row:hover .gm-date{visibility:visible}
  .gm-mid{display:contents}
  .gm-subj{grid-area:subj;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#444746}
  .gm-snip{grid-area:snip;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .gm-row .gm-snip{font-size:14px}
  .gm-c-star{grid-area:star;grid-row:2 / span 2;justify-self:end}
  .gm-row.unread .gm-from,.gm-row.unread .gm-subj{color:#1f1f1f}
  .gm-fab{display:inline-flex;align-items:center;gap:12px;position:fixed;right:16px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:30;height:56px;padding:0 20px 0 16px;border:0;border-radius:16px;
    background:#c2e7ff;color:#001d35;font:500 14px "Google Sans",Roboto,Arial,sans-serif;box-shadow:0 1px 3px 0 rgba(60,64,67,.3),0 4px 8px 3px rgba(60,64,67,.15);transition:padding .2s}
  .gm-fab[hidden]{display:none}
  .gm-fab.shrunk{padding:0 16px}.gm-fab.shrunk span:last-child{display:none}
  .gm.in-thread .gm-top{display:none}
  .gm-th-scroll{overflow:visible;padding-bottom:96px}
  .gm-th-head{padding:8px 16px 8px 16px}
  .gm-th-subj{font-size:20px;line-height:26px}
  .gm-th-tools .gm-ib{display:none}
  .gm-msg{padding:14px 12px 6px 16px;gap:0 12px}
  .gm-msg-email{display:none}
  .gm-msg-right .gm-msg-date{margin-right:0}
  .gm-msg-body{margin-left:-52px;margin-top:10px}
  .gm-reply-btns{padding:16px;justify-content:space-between}
  .gm-pill{flex:1;justify-content:center;height:40px}
  .gm-reply{grid-template-columns:1fr;padding:12px}
  .gm-reply > .gm-av{display:none}
  .gm-reply-note{padding:16px}
  .gm-cmp,.gm-cmp.max,.gm-cmp.min{inset:0;width:auto;height:auto;transform:none;border-radius:0;box-shadow:none;z-index:9100}
  .gm-cmp.min .gm-cmp-body{display:flex}
  .gm-cmp-head{height:56px;background:#fff;border-radius:0;padding:0 4px 0 4px}
  .gm-cmp-head .gm-ib{width:44px;height:44px}
  .gm-cmp-head .gm-ib[title="Minimize"],.gm-cmp-head .gm-ib[title="Full screen"],.gm-cmp-head .gm-ib[title="Save & close"]:not(.gm-m-only){display:none}
  .gm-cmp-title{font-size:18px;font-weight:400;color:#1f1f1f;margin-left:4px}
  .gm-m-send{color:#1f1f1f}
  .gm-fld{margin:0 16px;min-height:52px}
  .gm-fld-in{font-size:16px}
  .gm-editor{font-size:16px;padding:14px 16px}
  .gm-cmp-scrim{display:none!important}
  .gm-snack{left:16px;right:16px;bottom:calc(88px + env(safe-area-inset-bottom,0px));min-width:0;max-width:none}
}
`));
}

export default renderMailbox;
