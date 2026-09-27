// whatsappLive.js — CC "WhatsApp" (bl_wa_0367): the control-room view of LoadBoot's single WhatsApp line.
// bl_wa_0475 — laid out like WhatsApp Web itself: a left rail, the chat list (search, filter chips, Archived,
// a hover chevron + right-click menu on every chat) and the chat pane (wallpaper, bubbles with tails and ticks,
// the rounded composer, contact info on the right). What each piece is backed by:
//   · SERVER (every staff member sees it) — Archive/Unarchive = the thread's open/closed status; the contact's
//     name and note; the owner (dispatcher / staff / Command Center). Unchanged RPCs: cc_wa_thread_set, cc_wa_assign.
//   · THIS BROWSER (per staff member, like WhatsApp's own per-device list state) — Pin, Mute, Favorites,
//     Mark as unread, custom lists, Clear chat and Delete chat. Clear/Delete only hide things from this view:
//     LoadBoot keeps every message on record, and a deleted chat comes back by itself when a new message lands.
//   · Block is shown but disabled: the shared business line has no block API wired yet.
//   · The rail's other screens keep what the page always had: Templates (Meta status, sync, submit),
//     Webhook log, and The line (number, ids, master switch, hourly cap).
// Staff-gated by the RPCs themselves (cc_wa_*). Self-contained scoped styles (wx- / wl-). No alert/confirm/prompt.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { openDrawer } from '../../shared/ui/components.js';
import { waVoiceFile } from '../../shared/wa-opus.js';   // bl_wa_0378 - Chrome records webm; WhatsApp needs ogg
import { ccWaOverview, ccWaAssign, ccWaThreadSet, ccWaTemplateSet, ccWaTemplatesSync, ccWaTemplateSubmit, ccWaNotifyAssigned, ccDialerConfigSet, waThread, waSend, waMediaBlob, waStart, waUploadMedia } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const ET = 'America/New_York';
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const pretty = (n) => { const d = digits(n); const k = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return k.length === 10 ? '+1 (' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6) : String(n || '—'); };
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const left = (v) => { const ms = new Date(v).getTime() - Date.now(); if (!(ms > 0)) return null; const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
const dkey = (d) => d.toLocaleDateString('en-US', { timeZone: ET });
const hm = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET });
const wait = (m) => m == null ? '' : m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d';
// WhatsApp's list stamp: time today, "Yesterday", weekday this week, then the date
function listTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (isNaN(d)) return '';
  if (dkey(d) === dkey(now)) return hm(d);
  if (dkey(d) === dkey(new Date(now.getTime() - 864e5))) return 'Yesterday';
  if (now - d < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: ET });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: ET });
}
function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  if (dkey(d) === dkey(now)) return 'Today';
  if (dkey(d) === dkey(new Date(now.getTime() - 864e5))) return 'Yesterday';
  if (now - d < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: ET });
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: ET });
}

// Filled (Material-style) glyphs, the family WhatsApp Web draws with. Code-defined markup only.
const G = {
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2',
  chats: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 14H5.17L4 17.17V4h16zM7 9h10v2H7zm0-3h10v2H7zm0 6h7v2H7z',
  newchat: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-3 9h-4v4h-2v-4H7V9h4V5h2v4h4z',
  clip: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6z',
  emoji: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5m-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11m3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3m5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72z',
  send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
  stop: 'M6 6h12v12H6z',
  archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27M12 17.5 6.5 12H10v-2h4v2h3.5zM5.12 5l.81-1h12l.94 1z',
  pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3',
  mute: 'M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2m6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2m6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1z',
  unread: 'M22 6.98V16c0 1.1-.9 2-2 2H6l-4 4V4c0-1.1.9-2 2-2h10.1c-.06.32-.1.66-.1 1 0 2.76 2.24 5 5 5 1.13 0 2.16-.39 3-1.02M16 3c0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3-3 1.34-3 3',
  heart: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3m-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05',
  heartf: 'm12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z',
  list: 'M19 5v14H5V5zm1.1-2H3.9c-.5 0-.9.4-.9.9v16.2c0 .4.4.9.9.9h16.2c.4 0 .9-.5.9-.9V3.9c0-.5-.5-.9-.9-.9M11 7h6v2h-6zm0 4h6v2h-6zm0 4h6v2h-6zM7 7h2v2H7zm0 4h2v2H7zm0 4h2v2H7z',
  block: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2M4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.9 7.9 0 0 1 4 12m8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.9 7.9 0 0 1 20 12c0 4.42-3.58 8-8 8',
  clear: 'M7 11v2h10v-2zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8',
  del: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM8 9h8v10H8zm7.5-5-1-1h-5l-1 1H5v2h14V4z',
  down: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  right: 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  phone: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02z',
  tick: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  ticks: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12zM.41 13.41 6 19l1.41-1.41L1.83 12z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
  assign: 'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m-9-2V7H4v3H1v2h3v3h2v-3h3v-2zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1z',
  tpl: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z',
  log: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18m-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6',
  filter: 'M10 18h4v-2h-4zM3 6v2h18V6zm3 7h12v-2H6z',
  refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
  mail: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2m0 4-8 5-8-5V6l8 5 8-5z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  alert: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z',
  pen: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  doc: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
};
const sv = (n, s, cls) => el('span', { class: 'wx-i' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true',
  html: '<svg viewBox="0 0 24 24" width="' + (s || 24) + '" height="' + (s || 24) + '" fill="currentColor"><path d="' + (G[n] || '') + '"/></svg>' });

// the chat wallpaper: a quiet doodle tile (trucks, bubbles, pins, boxes) in the WhatsApp beige
const WALL = (function () {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'><g fill='none' stroke='#cfc4b3' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round' opacity='.55'>"
    + "<path d='M18 30h26v16H18zM44 35h9l5 6v5H44z'/><circle cx='25' cy='48' r='3.2'/><circle cx='50' cy='48' r='3.2'/>"
    + "<path d='M128 18h26a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5h-15l-8 6v-6h-3a5 5 0 0 1-5-5V23a5 5 0 0 1 5-5z'/><path d='M133 27h16M133 32h10'/>"
    + "<path d='M92 86l3.5 7 7.7 1.1-5.6 5.4 1.3 7.7-6.9-3.6-6.9 3.6 1.3-7.7-5.6-5.4 7.7-1.1z'/>"
    + "<circle cx='176' cy='96' r='10'/><path d='M176 90v6l4 3'/>"
    + "<path d='M30 118a9 9 0 0 1 18 0c0 7-9 16-9 16s-9-9-9-16z'/><circle cx='39' cy='118' r='3'/>"
    + "<path d='M120 150h24v18h-24zM120 156h24M132 150v6'/>"
    + "<path d='M60 176c6-6 14-6 20 0M64 182c4-3 8-3 12 0'/><circle cx='70' cy='188' r='1.6'/>"
    + "<path d='M184 160l10 10-10 10M170 170h24'/>"
    + "<path d='M92 30h10v14H92zM97 44v6M90 50h14'/>"
    + "<path d='M196 34l6 6M202 34l-6 6'/><circle cx='12' cy='190' r='5'/><path d='M150 206h12M156 200v12'/>"
    + "</g></svg>";
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
})();

const FONT = '"Segoe UI","Helvetica Neue",Helvetica,"Lucida Grande",Arial,Ubuntu,Cantarell,"Fira Sans",sans-serif';
const CSS = `
.wx{--g:#00a884;--gd:#008069;--bd:#25d366;--pn:#f0f2f5;--ln:#e9edef;--tx:#111b21;--sb:#667781;--ic:#54656f;--out:#d9fdd3;--hv:#f5f6f6;--wall:#efeae2;
  display:grid;grid-template-columns:64px minmax(300px,30%) 1fr;grid-template-rows:minmax(0,1fr);height:640px;min-height:520px;position:relative;overflow:hidden;
  background:#fff;border:1px solid var(--ln);border-radius:14px;box-shadow:0 6px 24px -14px rgba(11,20,26,.35);font-family:${FONT};color:var(--tx);font-size:14.5px}
.wx *{box-sizing:border-box}
.wx > *{min-height:0;min-width:0}
.wx button{font-family:inherit;color:inherit}
.wx-i{display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0}
.wx-ib{border:0;background:transparent;width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--ic);cursor:pointer;flex:none;position:relative;text-decoration:none}
.wx-ib:hover{background:rgba(11,20,26,.06)}.wx-ib.on{background:rgba(11,20,26,.1)}
.wx-ib:disabled{opacity:.4;cursor:default;background:transparent}
/* rail */
.wx-rail{background:var(--pn);border-right:1px solid var(--ln);display:flex;flex-direction:column;align-items:center;padding:10px 0;gap:6px}
.wx-rail .wx-ib{width:42px;height:42px}
.wx-rail .wx-ib.on{background:rgba(11,20,26,.1);color:var(--tx)}
.wx-rsep{width:32px;height:1px;background:#d1d7db;margin:4px 0}
.wx-rsp{flex:1}
.wx-rb{position:absolute;top:1px;right:0;min-width:19px;height:19px;border-radius:10px;background:var(--bd);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid var(--pn)}
.wx-rb.dot{min-width:11px;width:11px;height:11px;padding:0;top:6px;right:6px}
.wx-me{width:34px;height:34px;border-radius:50%;background:#10223B;color:#fff;font:800 13px ${FONT};display:flex;align-items:center;justify-content:center;margin-top:4px}
/* side */
.wx-side{display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--ln);background:#fff;position:relative}
.wx-sh{display:flex;align-items:center;gap:4px;padding:14px 12px 8px 20px;min-height:62px}
.wx-sh h2{margin:0;flex:1;font:700 22px ${FONT};color:var(--tx);letter-spacing:-.2px}
.wx-sh.sub h2{font-size:17px;font-weight:600}
.wx-sh .wx-new{background:var(--tx);color:#fff;border-radius:50%;width:40px;height:40px}
.wx-sh .wx-new:hover{background:#2a3942}
.wx-srch{margin:0 12px 8px;background:var(--pn);border-radius:24px;display:flex;align-items:center;gap:10px;padding:0 14px;height:40px;color:var(--ic)}
.wx-srch input{flex:1;border:0;background:transparent;outline:none;font:400 15px ${FONT};color:var(--tx);min-width:0}
.wx-srch input::placeholder{color:#667781}
.wx-chips{display:flex;gap:8px;padding:2px 12px 10px;overflow-x:auto;scrollbar-width:none;flex:none}
.wx-chips::-webkit-scrollbar{display:none}
.wx-chip{border:1px solid #d1d7db;background:#fff;border-radius:18px;padding:0 13px;height:32px;font:500 14px ${FONT};color:var(--sb);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;flex:none}
.wx-chip:hover{background:var(--hv)}
.wx-chip.on{background:#d9fdd3;border-color:#d9fdd3;color:var(--gd)}
.wx-chip .dt{width:8px;height:8px;border-radius:50%;background:#ea0038}
.wx-chip.ic{width:32px;padding:0;justify-content:center}
.wx-list{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 8px 8px}
.wx-arch{display:flex;align-items:center;gap:16px;padding:0 16px;height:50px;border-radius:10px;cursor:pointer;color:var(--tx)}
.wx-arch:hover{background:var(--hv)}
.wx-arch .wx-i{color:var(--g);width:49px}
.wx-arch b{flex:1;font-weight:500;font-size:16px}.wx-arch span.n{color:var(--g);font-size:12.5px;font-weight:600}
.wx-row{display:flex;align-items:center;gap:12px;padding:0 12px;height:72px;border-radius:10px;cursor:pointer;position:relative;outline:none}
.wx-row:hover,.wx-row:focus-visible{background:var(--hv)}
.wx-row.on{background:var(--pn)}
.wx-row.late{box-shadow:inset 3px 0 0 #ea0038}
.wx-av{border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;overflow:hidden;user-select:none}
.wx-av.none{background:#dfe5e7;color:#fff}
.wx-rbd{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:center;gap:3px;border-bottom:1px solid var(--ln);padding-right:2px}
.wx-row.on .wx-rbd,.wx-row:hover .wx-rbd{border-bottom-color:transparent}
.wx-r1,.wx-r2{display:flex;align-items:center;gap:6px;min-width:0}
.wx-rn{font-size:16.5px;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0}
.wx-tag{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:9px;color:#fff;white-space:nowrap;flex:none;max-width:140px;overflow:hidden;text-overflow:ellipsis}
.wx-rt{margin-left:auto;font-size:12px;color:var(--sb);flex:none;padding-left:6px}
.wx-row.unr .wx-rt{color:var(--bd);font-weight:600}
.wx-rp{flex:1;min-width:0;font-size:14px;color:var(--sb);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:3px}
.wx-rp > span.t{overflow:hidden;text-overflow:ellipsis}
.wx-row.unr .wx-rp{color:var(--tx)}
.wx-rp .dr{color:var(--gd);font-weight:600;flex:none}
.wx-rp .tk{color:#8696a0}
.wx-rx{display:flex;align-items:center;gap:4px;color:#8696a0;flex:none}
.wx-badge{min-width:20px;height:20px;border-radius:10px;background:var(--bd);color:#fff;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;padding:0 6px}
.wx-badge.mu{background:#aebac1}
.wx-badge.e{min-width:12px;width:12px;height:12px;padding:0}
.wx-wt{font-size:11px;font-weight:700;padding:1px 6px;border-radius:8px;background:#fff4e0;color:#b45309;white-space:nowrap}
.wx-wt.r{background:#ffe3e8;color:#c0002d}
.wx-chev{border:0;background:transparent;color:#8696a0;width:0;overflow:hidden;padding:0;cursor:pointer;display:inline-flex;transition:width .12s}
.wx-row:hover .wx-chev,.wx-row.menu .wx-chev{width:22px}
.wx-empty{padding:40px 24px;text-align:center;color:var(--sb);font-size:14px;line-height:1.5}
.wx-sfoot{padding:10px 20px 14px;font-size:12px;color:var(--sb);display:flex;gap:6px;align-items:center;justify-content:center;border-top:1px solid var(--ln)}
/* new chat panel */
.wx-new-f{padding:6px 16px 14px;display:flex;flex-direction:column;gap:10px}
.wx-in{border:1px solid #d1d7db;border-radius:10px;padding:10px 12px;font:400 15px ${FONT};color:var(--tx);background:#fff;outline:none;width:100%}
.wx-in:focus{border-color:var(--g)}
.wx-btn{border:0;background:var(--g);color:#fff !important;border-radius:22px;padding:0 20px;height:38px;font:600 14px ${FONT};cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.wx-btn:hover{background:var(--gd)}.wx-btn:disabled{opacity:.55;cursor:default}
.wx-btn.ghost{background:#fff;color:var(--gd) !important;border:1px solid #d1d7db}.wx-btn.ghost:hover{background:var(--hv)}
.wx-btn.red{background:#ea0038}.wx-btn.red:hover{background:#c0002d}
.wx-hint{font-size:13px;color:var(--sb);line-height:1.5;margin:0}
.wx-lbl{font-size:14px;color:var(--gd);padding:18px 16px 8px;font-weight:500}
/* main */
.wx-main{display:flex;flex-direction:column;min-width:0;position:relative;background:var(--wall)}
.wx-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f7f8fa;text-align:center;padding:30px;border-bottom:6px solid var(--g)}
.wx-welcome .art{width:118px;height:118px;border-radius:50%;background:#e7f8ef;color:var(--g);display:flex;align-items:center;justify-content:center;margin-bottom:26px}
.wx-welcome h3{margin:0 0 10px;font:300 30px ${FONT};color:#41525d}
.wx-welcome p{margin:0 auto 6px;max-width:520px;color:var(--sb);font-size:14px;line-height:1.55}
.wx-kp{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:20px 0 22px}
.wx-kp div{background:#fff;border:1px solid var(--ln);border-radius:12px;padding:9px 14px;min-width:96px}
.wx-kp b{display:block;font-size:20px;color:var(--tx);font-variant-numeric:tabular-nums}
.wx-kp span{font-size:11px;color:var(--sb);text-transform:uppercase;letter-spacing:.5px}
.wx-kp .r b{color:#ea0038}
.wx-foot{margin-top:26px;display:flex;align-items:center;gap:6px;color:#8696a0;font-size:13px}
.wx-ch{height:60px;background:var(--pn);display:flex;align-items:center;gap:10px;padding:0 10px 0 14px;border-bottom:1px solid var(--ln);flex:none;z-index:2}
.wx-ch .who{flex:1;min-width:0;cursor:pointer;display:flex;flex-direction:column;justify-content:center}
.wx-ch .who b{font-weight:500;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wx-ch .who small{font-size:13px;color:var(--sb);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wx-own{display:inline-flex;align-items:center;gap:4px;border:1px solid #d1d7db;background:#fff;border-radius:22px;height:38px;padding:0 6px 0 12px;color:var(--ic);position:relative;flex:none;max-width:220px}
.wx-own select{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:500 13.5px ${FONT};color:var(--tx);padding:0 18px 0 2px;cursor:pointer;outline:none;max-width:160px;text-overflow:ellipsis}
.wx-own .wx-i.dn{position:absolute;right:6px;pointer-events:none}
.wx-back{display:none}
.wx-find{display:flex;align-items:center;gap:8px;background:#fff;padding:8px 12px;border-bottom:1px solid var(--ln);flex:none}
.wx-find input{flex:1;border:0;outline:none;font:400 15px ${FONT};background:var(--pn);border-radius:8px;padding:8px 12px}
.wx-find span{font-size:12.5px;color:var(--sb);white-space:nowrap}
.wx-body{flex:1;overflow-y:auto;overflow-x:hidden;background-color:var(--wall);background-image:${WALL};position:relative;padding:12px 6% 10px}
.wx-msgs{display:flex;flex-direction:column}
.wx-note{align-self:center;background:#ffeecd;color:#54656f;border-radius:8px;font-size:12.5px;line-height:1.45;padding:6px 12px;margin:4px 0 10px;text-align:center;max-width:560px;box-shadow:0 1px .5px rgba(11,20,26,.13);display:flex;gap:6px;align-items:flex-start}
.wx-note .wx-i{margin-top:1px}
.wx-note.r{background:#ffe3e8;color:#8a1030}
.wx-day{align-self:center;background:#fff;color:#54656f;font-size:12.5px;padding:5px 12px;border-radius:8px;margin:10px 0 8px;box-shadow:0 1px .5px rgba(11,20,26,.13);text-transform:uppercase;letter-spacing:.2px}
.wx-mr{display:flex;margin-bottom:2px;padding:0 9px}
.wx-mr.tail{margin-top:10px}
.wx-mr.out{justify-content:flex-end}
.wx-bub{position:relative;max-width:min(65%,560px);background:#fff;border-radius:7.5px;padding:6px 7px 8px 9px;box-shadow:0 1px .5px rgba(11,20,26,.13);font-size:14.2px;line-height:19px;color:var(--tx);word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap}
.wx-mr.out .wx-bub{background:var(--out)}
.wx-mr.tail.in .wx-bub{border-top-left-radius:0}
.wx-mr.tail.out .wx-bub{border-top-right-radius:0}
.wx-mr.tail.in .wx-bub::before{content:"";position:absolute;top:0;left:-8px;width:8px;height:13px;background:#fff;clip-path:polygon(0 0,100% 0,100% 100%)}
.wx-mr.tail.out .wx-bub::before{content:"";position:absolute;top:0;right:-8px;width:8px;height:13px;background:var(--out);clip-path:polygon(0 0,100% 0,0 100%)}
.wx-bub.fail{background:#fff0f2 !important}.wx-mr.tail.out .wx-bub.fail::before{background:#fff0f2}
.wx-meta{float:right;display:inline-flex;align-items:center;gap:3px;margin:8px 0 -6px 12px;font-size:11px;line-height:15px;color:#667781;white-space:nowrap;position:relative;top:1px}
.wx-meta .tk{color:#8696a0}.wx-meta .tk.rd{color:#53bdeb}
.wx-meta .tp{font-style:italic}
.wx-err{display:flex;gap:4px;align-items:center;color:#c0002d;font-size:12px;margin-top:4px;clear:both;white-space:normal}
.wx-bub mark{background:#ffe066;color:inherit;border-radius:2px}
.wx-bub.med{padding:3px 3px 6px}
.wx-bub.med .wx-txt{display:block;padding:4px 4px 0}
.wx-bub.med .wx-meta{margin-right:4px}
.wx-img{max-width:330px;width:100%;max-height:340px;border-radius:6px;display:block;cursor:zoom-in;object-fit:cover;min-height:60px;background:rgba(11,20,26,.06)}
.wx-ph{width:240px;height:120px;border-radius:6px;display:grid;place-items:center;background:rgba(11,20,26,.06);font-size:12px;color:var(--sb);white-space:normal;text-align:center;padding:8px}
.wx-aud{width:260px;height:40px;display:block}
.wx-vn{font-size:11.5px;color:var(--sb);display:flex;gap:4px;align-items:center;padding:2px 4px}
.wx-doc{display:flex;gap:10px;align-items:center;background:rgba(11,20,26,.05);border:0;border-radius:6px;padding:10px 12px;cursor:pointer;min-width:230px;color:var(--tx);font:500 14px ${FONT};text-align:left;white-space:normal}
.wx-doc .wx-i{color:#e74c3c}
.wx-doc small{display:block;font-weight:400;color:var(--sb);margin-top:2px;font-size:11.5px}
.wx-down{position:absolute;right:18px;bottom:96px;width:42px;height:42px;border-radius:50%;background:#fff;border:0;box-shadow:0 1px 3px rgba(11,20,26,.25);color:var(--ic);cursor:pointer;display:none;align-items:center;justify-content:center;z-index:3}
.wx-down.show{display:flex}
/* composer */
.wx-comp{flex:none;padding:6px 16px 12px;background:transparent;position:relative;z-index:2}
.wx-box{background:#fff;border-radius:26px;box-shadow:0 1px 3px rgba(11,20,26,.12);padding:6px 8px;display:grid;align-items:center;
  grid-template-columns:auto auto auto auto 1fr auto;grid-template-areas:"ta ta ta ta ta ta" "clip emo qr recd . send"}
.wx-box.dis{background:#f7f8fa}
.wx-pill{display:contents}
.wx-box .wx-ta{grid-area:ta}.wx-box .wx-clip{grid-area:clip}.wx-box .wx-emob{grid-area:emo}.wx-box .wx-qr{grid-area:qr}.wx-box .wx-recd{grid-area:recd}.wx-box .wx-sendb{grid-area:send}
.wx-qr .m{display:none}
.wx-fab{display:none}
.wx-ta{display:block;width:100%;border:0;outline:none;resize:none;background:transparent;font:400 15px ${FONT};line-height:21px;color:var(--tx);padding:8px 12px 4px;min-height:37px;max-height:170px;overflow-y:auto;white-space:pre-wrap}
.wx-ta::placeholder{color:#8696a0}
.wx-qr{display:inline-flex;align-items:center;gap:4px;border:1px solid #d1d7db;background:#fff;border-radius:18px;height:34px;padding:0 10px 0 14px;font:600 14px ${FONT};color:var(--tx);cursor:pointer;margin-left:4px}
.wx-qr:hover{background:var(--hv)}.wx-qr.on{background:#d9fdd3;border-color:#d9fdd3;color:var(--gd)}
.wx-sendb{width:42px;height:42px;border-radius:50%;border:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:var(--ic)}
.wx-sendb.go{background:var(--g);color:#fff}.wx-sendb.go:hover{background:var(--gd)}
.wx-sendb.rec{background:#ea0038;color:#fff}
.wx-sendb:disabled{opacity:.5;cursor:default}
.wx-recd{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#ea0038;font-weight:600;margin-left:8px}
.wx-recd::before{content:"";width:9px;height:9px;border-radius:50%;background:#ea0038;animation:wxp 1s infinite}
@keyframes wxp{50%{opacity:.25}}
.wx-pend{display:flex;align-items:center;gap:10px;background:#fff;border-radius:14px;padding:8px 10px;margin-bottom:8px;box-shadow:0 1px 3px rgba(11,20,26,.12)}
.wx-pend img,.wx-pend .ext{width:52px;height:52px;border-radius:8px;flex:none;object-fit:cover}
.wx-pend .ext{display:flex;align-items:center;justify-content:center;background:var(--pn);font-size:11px;font-weight:800;color:var(--ic)}
.wx-pend .nm{flex:1;min-width:0}.wx-pend .nm b{display:block;font-weight:500;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wx-pend .nm span{font-size:12px;color:var(--sb)}
.wx-tray{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(11,20,26,.12);margin-bottom:8px;padding:10px;max-height:300px;overflow:auto}
.wx-tray h4{margin:0 4px 8px;font:600 13px ${FONT};color:var(--gd)}
.wx-tpl{display:block;width:100%;text-align:left;border:1px solid var(--ln);background:#fff;border-radius:10px;padding:8px 11px;cursor:pointer;margin-bottom:6px;font:inherit}
.wx-tpl:hover{background:var(--hv)}
.wx-tpl.on{border-color:var(--g);box-shadow:0 0 0 2px rgba(0,168,132,.18)}
.wx-tpl b{display:block;font-size:13px;text-transform:capitalize;margin-bottom:2px;color:var(--tx)}
.wx-tpl span{display:block;font-size:12.5px;line-height:1.45;color:var(--sb);white-space:pre-wrap}
.wx-tvars{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
.wx-tvars .wx-in{width:auto;flex:1;min-width:150px;padding:8px 10px;font-size:14px}
.wx-tprev{background:var(--out);border-radius:8px;padding:8px 10px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;margin:6px 0 8px}
.wx-emo{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:2px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(11,20,26,.12);margin-bottom:8px;padding:8px;max-height:190px;overflow:auto}
.wx-emo button{border:0;background:transparent;font-size:23px;height:40px;border-radius:8px;cursor:pointer}
.wx-emo button:hover{background:var(--pn)}
/* contact info */
.wx-info{position:absolute;top:0;right:0;bottom:0;width:min(400px,100%);background:#fff;border-left:1px solid var(--ln);z-index:6;display:flex;flex-direction:column;box-shadow:-8px 0 24px -16px rgba(11,20,26,.35);animation:wxin .16s ease-out}
@keyframes wxin{from{transform:translateX(24px);opacity:0}}
.wx-ih{height:60px;display:flex;align-items:center;gap:14px;padding:0 12px;background:var(--pn);flex:none}
.wx-ih b{font-weight:500;font-size:16px}
.wx-ib2{flex:1;overflow:auto;background:var(--pn)}
.wx-isec{background:#fff;padding:16px 26px;margin-bottom:10px}
.wx-isec.hero{text-align:center;padding:26px 26px 20px}
.wx-isec.hero .wx-av{margin:0 auto 14px}
.wx-isec.hero h3{margin:0;font:400 22px ${FONT};display:flex;align-items:center;justify-content:center;gap:6px}
.wx-isec.hero p{margin:4px 0 0;color:var(--sb);font-size:15px}
.wx-isec h5{margin:0 0 10px;font:400 14px ${FONT};color:var(--sb)}
.wx-isec .wx-in{font-size:14px}
.wx-irow{display:flex;align-items:center;gap:18px;padding:12px 0;cursor:pointer;color:var(--tx);border:0;background:transparent;width:100%;text-align:left;font:400 15px ${FONT}}
.wx-irow .wx-i{color:#8696a0}
.wx-irow.red,.wx-irow.red .wx-i{color:#ea0038}
.wx-irow:disabled{opacity:.45;cursor:default}
.wx-irow small{display:block;color:var(--sb);font-size:12.5px}
.wx-sel{border:1px solid #d1d7db;border-radius:10px;padding:9px 10px;font:400 14px ${FONT};background:#fff;color:var(--tx);width:100%;outline:none}
.wx-ok{color:var(--gd);font-weight:600}.wx-no{color:#b45309;font-weight:600}
/* screens behind the rail (templates, log, the line) */
.wx-page{grid-column:2 / 4;overflow:auto;background:var(--pn);padding:0}
.wx-page .wx-ph2{height:62px;display:flex;align-items:center;gap:8px;padding:0 18px;background:#fff;border-bottom:1px solid var(--ln);position:sticky;top:0;z-index:2}
.wx-page .wx-ph2 h2{margin:0;font:700 20px ${FONT};flex:1}
.wx-page .pad{padding:16px 18px}
@media (max-width:860px){
  .wx{grid-template-columns:1fr;border-radius:14px;font-size:15px}
  .wx-rail{display:none}
  .wx-page{grid-column:1}
  .wx .wx-main{display:none}
  .wx-sh h2{color:#1daa61;font-size:23px}
  .wx-sh .wx-new{display:none}
  .wx-fab{display:flex;position:absolute;right:16px;bottom:18px;width:56px;height:56px;border-radius:16px;border:0;background:#1daa61;color:#fff;
    align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(11,20,26,.28);cursor:pointer;z-index:4}
  .wx-fab:active{transform:scale(.96)}
  .wx-list{padding:0 4px 88px}
  .wx-row{height:74px;padding:0 10px;border-radius:0;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none}
  .wx-row:hover{background:transparent}.wx-row:active,.wx-row.menu{background:var(--pn)}
  .wx-rbd{border-bottom:0}
  .wx-tag{max-width:96px}
  .wx-chev{display:none}
  /* an open chat takes the whole phone screen, the way WhatsApp opens one */
  .wx.m-chat{position:fixed;left:0;right:0;top:var(--vvt,0px);height:var(--vvh,100dvh) !important;min-height:0;z-index:8000;border:0;border-radius:0;box-shadow:none;animation:wxslide .18s ease-out}
  @keyframes wxslide{from{transform:translateX(30px);opacity:.4}}
  .wx.m-chat .wx-side{display:none}
  .wx.m-chat .wx-main{display:flex}
  .wx-back{display:inline-flex}
  .wx-ch{height:auto;min-height:58px;padding:calc(4px + env(safe-area-inset-top,0px)) 4px 4px 2px;gap:4px;background:#fff}
  .wx-ch .who b{font-weight:600;font-size:16.5px}
  .wx-ch .who small{font-size:12.5px}
  .wx-ch .wx-ib{width:40px;height:40px}
  .wx-own{display:none}
  .wx-body{padding:8px 4px}
  .wx-mr{padding:0 6px}
  .wx-bub{max-width:86%;font-size:15px;line-height:20px}
  .wx-img{max-width:260px}
  .wx-aud{width:220px}
  .wx-note{font-size:12px;margin:4px 8px 10px}
  .wx-down{bottom:84px;right:12px}
  .wx-comp{padding:6px 6px calc(8px + env(safe-area-inset-bottom,0px))}
  .wx-box{display:flex;align-items:flex-end;gap:6px;background:transparent;box-shadow:none;padding:0}
  .wx-box.dis{background:transparent}
  .wx-pill{display:flex;align-items:flex-end;flex:1;min-width:0;background:#fff;border-radius:26px;padding:2px 4px;min-height:48px;box-shadow:0 1px 2px rgba(11,20,26,.18)}
  .wx-box.dis .wx-pill{background:#f7f8fa}
  .wx-pill .wx-ib{width:42px;height:44px}
  .wx-ta{order:2;flex:1;min-width:0;padding:12px 4px;min-height:44px;font-size:16px;line-height:20px;max-height:128px}
  .wx-emob{order:1}.wx-clip{order:3}.wx-qr{order:4}.wx-recd{order:5}
  .wx-qr{border:0;background:transparent;width:42px;height:44px;padding:0;margin:0;justify-content:center;color:var(--ic)}
  .wx-qr.on{background:transparent;color:var(--g)}
  .wx-qr .d{display:none}.wx-qr .m{display:inline-flex}
  .wx-recd{align-self:center;margin:0 6px 0 0;font-size:12px}
  .wx-sendb,.wx-sendb.go,.wx-sendb.rec{width:48px;height:48px;background:#1daa61;color:#fff;flex:none;box-shadow:0 1px 2px rgba(11,20,26,.2)}
  .wx-sendb.rec{background:#ea0038}
  .wx-tray,.wx-emo{border-radius:14px}
  .wx-emo{grid-template-columns:repeat(8,1fr)}
  .wx-info{width:100%;border-left:0;animation:wxslide .18s ease-out}
  .wx-ih{padding-top:env(safe-area-inset-top,0px)}
  .wx-isec{padding:14px 18px}
  .wx-isec.hero .wx-av{width:140px !important;height:140px !important;font-size:52px !important}
  .wx-find input{font-size:16px}
  .wx-srch input,.wx-in{font-size:16px}
}
html.wx-lock,html.wx-lock body{overflow:hidden !important}
/* floating menus + dialogs live on <body>, outside .wx */
.wx-menu{position:fixed;z-index:100000;background:#fff;border-radius:16px;box-shadow:0 2px 5px rgba(11,20,26,.26),0 2px 10px rgba(11,20,26,.16);padding:10px;min-width:232px;font-family:${FONT};color:#111b21;animation:wxm .12s ease-out}
@keyframes wxm{from{opacity:0;transform:scale(.96)}}
.wx-menu .wx-i{display:inline-flex;line-height:0}
.wx-mi{display:flex;align-items:center;gap:14px;width:100%;border:0;background:transparent;padding:0 12px;height:44px;border-radius:10px;font:400 15px ${FONT};color:#3b4a54;cursor:pointer;text-align:left;white-space:nowrap}
.wx-mi:hover,.wx-mi:focus-visible,.wx-mw.open > .wx-mi{background:#f5f6f6;outline:none}
.wx-mi .wx-i{color:#54656f}
.wx-mi .lb{flex:1}
.wx-mi small{display:block;font-size:11.5px;color:#8696a0;white-space:normal;line-height:1.25}
.wx-mi:disabled{opacity:.45;cursor:default;background:transparent}
.wx-mi.chk .lb::after{content:"";}
.wx-mi .ck{color:#00a884}
.wx-msep{height:1px;background:#e9edef;margin:6px 4px}
.wx-mh{font-size:12.5px;color:#8696a0;padding:6px 12px 4px}
.wx-mw{position:relative}
.wx-mw > .wx-menu{display:none;position:absolute;top:-10px;left:calc(100% + 4px)}
.wx-menu.flip .wx-mw > .wx-menu{left:auto;right:calc(100% + 4px)}
.wx-mw.open > .wx-menu{display:block}
@media (max-width:600px){
  .wx-menu{left:0 !important;right:0;top:auto !important;bottom:0;min-width:0;width:100%;border-radius:20px 20px 0 0;padding:8px 8px calc(10px + env(safe-area-inset-bottom,0px));
    max-height:78vh;overflow:auto;box-shadow:0 0 0 100vmax rgba(11,20,26,.4);animation:wxup .18s ease-out}
  @keyframes wxup{from{transform:translateY(40px);opacity:.5}}
  .wx-menu::before{content:"";display:block;width:38px;height:4px;border-radius:2px;background:#d1d7db;margin:2px auto 8px}
  .wx-mi{height:50px;font-size:16px}
  .wx-mw > .wx-menu,.wx-menu.flip .wx-mw > .wx-menu{position:static;box-shadow:none;border-radius:0;padding:0 0 0 34px;max-height:none;animation:none;width:auto}
  .wx-mw > .wx-menu::before{display:none}
}
.wx-dlg{font-family:${FONT}}
.wx-dlg p{margin:0 0 18px;color:#3b4a54;font-size:14.5px;line-height:1.55}
.wx-dlg .row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.wx-dlg .wx-btn{border:0;background:#00a884;color:#fff;border-radius:22px;padding:0 22px;height:40px;font:600 14px ${FONT};cursor:pointer}
.wx-dlg .wx-btn.ghost{background:#fff;color:#008069;border:1px solid #d1d7db}
.wx-dlg .wx-btn.red{background:#ea0038}
.wx-dlg input{border:1px solid #d1d7db;border-radius:10px;padding:10px 12px;font:400 15px ${FONT};width:100%;margin:0 0 16px;outline:none}
.wx-dlg input:focus{border-color:#00a884}
/* the older cards, still used on the Templates / The line / Webhook log screens */
.wl-card{background:#fff;border:1px solid var(--ln,#e5e9f2);border-radius:14px;padding:16px;margin-bottom:14px}
.wl-card h3{margin:0 0 4px;font-size:16px}.wl-card .hint{color:#64748b;font-size:13px;margin:0 0 12px}
.wl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:14px}
.wl-kpi{border:1px solid #e5e9f2;border-radius:14px;padding:11px 13px;background:#fff}
.wl-kpi b{display:block;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.wl-kpi span{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.7px}
.wl-t{width:100%;border-collapse:collapse;font-size:13.5px}
.wl-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:#64748b;padding:8px 10px;border-bottom:1px solid #e5e9f2;white-space:nowrap}
.wl-t td{padding:9px 10px;border-bottom:1px solid #eef1f6;vertical-align:middle}
.wl-tw{overflow:auto}
.wl-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:rgba(100,116,139,.14);color:#475569}
.wl-pill.g{background:rgba(34,197,94,.16);color:#15803d}.wl-pill.a{background:rgba(245,158,11,.18);color:#b45309}.wl-pill.r{background:rgba(239,68,68,.16);color:#b91c1c}
.wl-btn{border:1px solid #e5e9f2;background:#fff;border-radius:10px;padding:6px 11px;font:600 12.5px Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.wl-btn.pri{background:#00a884;border-color:#00a884;color:#fff}
.wl-in,.wl-sel{border:1px solid #e5e9f2;border-radius:10px;padding:7px 10px;font:500 13px Inter,system-ui,sans-serif;background:#fff;color:inherit;max-width:100%}
.wl-note{border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.1);color:#92400e;border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}
.wl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.wl-mono{font:500 11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#64748b;word-break:break-all}
.wl-kv{display:flex;flex-direction:column;gap:2px;margin-right:20px}
.wl-kv span{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#64748b}
.wl-kv b{font:600 13.5px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
`;

// bl_wa_0385 — Chrome blocks window.open on a blob: URL opened with 'noopener' (the blob belongs to the
// document that created it, and 'noopener' severs that), so attachments appeared not to open at all. A photo
// gets an in-page overlay; anything else is opened through an anchor click, which keeps the tie.
function waOpenBlob(url, name) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.download = name || '';
  document.body.appendChild(a); a.click(); a.remove();
}
function waLightbox(url) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(3,8,20,.93);display:grid;place-items:center;cursor:zoom-out';
  const im = document.createElement('img');
  im.src = url; im.alt = 'Photo';
  im.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.6)';
  im.onclick = (e) => e.stopPropagation();
  box.appendChild(im);
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); shut(); } };
  function shut() { document.removeEventListener('keydown', esc, true); box.remove(); }
  box.onclick = shut;
  document.addEventListener('keydown', esc, true);
  document.body.appendChild(box);
}

// ---- per-browser list state (pin / mute / favorites / unread mark / lists / clear / delete) ----
const LS = 'lb.cc.wa.ui.v1';
const U0 = () => ({ pin: {}, fav: {}, mute: {}, unr: {}, del: {}, clr: {}, lists: {} });
function uLoad() {
  try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); const u = U0(); if (v && typeof v === 'object') for (const k in u) if (v[k] && typeof v[k] === 'object') u[k] = v[k]; return u; }
  catch (_) { return U0(); }
}

const AVC = ['#25d366', '#53bdeb', '#f5a623', '#ff7a8a', '#a78bfa', '#06cf9c', '#fb923c', '#5e9cf5', '#e573b0', '#009de2'];
const EMOJI = '😀 😂 😊 😍 🙂 😉 😎 🤔 😅 😢 🙏 👍 👌 👏 🤝 👋 💪 🔥 ✅ ❌ ⚠️ ⏰ 📞 📍 📄 📷 💰 💵 🚚 🚛 🛣️ ⛽ 🏁 🎉 ❤️ 💯 👀 ✨ 🙌 😴'.split(' ');

export async function renderWhatsappLive(host) {
  if (!document.getElementById('wx-css')) { const s = document.createElement('style'); s.id = 'wx-css'; s.textContent = CSS; document.head.appendChild(s); }
  let U = uLoad();
  const uSave = () => { try { localStorage.setItem(LS, JSON.stringify(U)); } catch (_) {} };

  // ---- state ----
  let ov = null, ovQ = '', open = null, thr = null, busy = false, timer = null, thrTimer = null, editLine = false, sending = false;
  let rail = 'chats', side = 'chats', chip = 'all', infoOpen = false, findQ = null, trayOpen = false, emoOpen = false, tplName = '', tplVars = [];
  const F = { q: '', dispatcher: '' };
  const drafts = {};
  const stateEl = el('div'), tplEl = el('div'), logEl = el('div');

  const threads = () => (ov && ov.threads) || [];
  const byId = (id) => threads().find((t) => t.id === id) || (thr && thr.thread && thr.thread.id === id ? thr.thread : null);
  const cur = () => { const a = byId(open); const b = thr && thr.thread && thr.thread.id === open ? thr.thread : null; return a && b ? Object.assign({}, b, a) : (a || b); };
  const tName = (t) => (t.who && t.who.name) || t.contact_name || pretty(t.number);
  const isMuted = (id) => { const m = U.mute[id]; return m != null && (m === -1 || m > Date.now()); };
  const isUnr = (t) => (t.unread > 0) || !!U.unr[t.id];
  const isDel = (t) => U.del[t.id] != null && !(t.last_at && new Date(t.last_at).getTime() > U.del[t.id]);
  const PILL = { dispatcher: { trial: '#0883F7', active: '#15803d', verified: '#15803d' }, carrier: '#10223B', driver: '#0f766e' };
  const whoColor = (w) => w.kind === 'dispatcher' ? (PILL.dispatcher[w.status] || '#64748b') : (PILL[w.kind] || '#64748b');

  function avatar(t, size) {
    const n = t ? tName(t) : '';
    const named = t && ((t.who && t.who.name) || t.contact_name);
    const s = size || 49;
    if (!named) return el('div', { class: 'wx-av none', style: 'width:' + s + 'px;height:' + s + 'px' }, sv('person', Math.round(s * 0.72)));
    const ini = n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return el('div', { class: 'wx-av', style: 'width:' + s + 'px;height:' + s + 'px;background:' + AVC[h % AVC.length] + ';font-size:' + Math.round(s * 0.38) + 'px' }, ini);
  }

  // ---- floating menus (WhatsApp's rounded white menu, with fly-out sub-menus) ----
  let menuEl = null, menuRow = null;
  const canHover = () => { try { return window.matchMedia('(hover: hover)').matches; } catch (_) { return true; } };
  const isPhone = () => window.innerWidth <= 860;
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    if (menuRow) { menuRow.classList.remove('menu'); menuRow = null; }
    document.removeEventListener('mousedown', menuOutside, true);
    window.removeEventListener('resize', closeMenu);
  }
  function menuOutside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function menuNode(items) {
    return el('div', { class: 'wx-menu', role: 'menu' }, items.filter(Boolean).map((it) => {
      if (it.sep) return el('div', { class: 'wx-msep' });
      if (it.head) return el('div', { class: 'wx-mh' }, it.head);
      const btn = el('button', { class: 'wx-mi', role: 'menuitem', type: 'button', disabled: !!it.disabled, title: it.hint || null,
        onClick: (e) => {
          e.stopPropagation();
          if (it.sub) { const w = e.currentTarget.parentNode; const was = w.classList.contains('open'); w.parentNode.querySelectorAll('.wx-mw.open').forEach((x) => x.classList.remove('open')); if (!was || canHover()) w.classList.add('open'); return; }
          closeMenu(); if (it.on) it.on();
        } }, [
        it.ic ? sv(it.ic, 20) : null,
        el('span', { class: 'lb' }, [it.label, it.hint && it.disabled ? el('small', null, it.hint) : null]),
        it.checked ? sv('check', 18, 'ck') : null,
        it.sub ? sv('right', 18) : null,
      ]);
      if (!it.sub) return btn;
      const w = el('div', { class: 'wx-mw', onMouseenter: (e) => { if (!canHover()) return; const p = e.currentTarget; p.parentNode.querySelectorAll(':scope > .wx-mw.open').forEach((x) => { if (x !== p) x.classList.remove('open'); }); p.classList.add('open'); }, onMouseleave: (e) => { if (canHover()) e.currentTarget.classList.remove('open'); } }, [btn, menuNode(it.sub)]);
      return w;
    }));
  }
  function showMenu(items, x, y, row) {
    closeMenu();
    menuEl = menuNode(items);
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    const px = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const py = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    menuEl.style.left = px + 'px'; menuEl.style.top = py + 'px';
    if (px + r.width + 250 > window.innerWidth) menuEl.classList.add('flip');
    if (row) { menuRow = row; row.classList.add('menu'); }
    setTimeout(() => { document.addEventListener('mousedown', menuOutside, true); window.addEventListener('resize', closeMenu); }, 0);
    if (canHover()) { const first = menuEl.querySelector('.wx-mi:not(:disabled)'); if (first) first.focus({ preventScroll: true }); }
  }
  function menuAt(e, items, row) { e.preventDefault(); e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); showMenu(items, e.type === 'contextmenu' ? e.clientX : b.right - 232, e.type === 'contextmenu' ? e.clientY : b.bottom + 4, row); }

  function dialog(title, text, okLabel, fn, opts) {
    const o = opts || {};
    let d = null;
    const inp = o.input ? el('input', { type: 'text', placeholder: o.input, maxlength: '40', onKeydown: (e) => { if (e.key === 'Enter') go(); } }) : null;
    async function go() { const v = inp ? inp.value.trim() : true; if (inp && !v) { inp.focus(); return; } d.close(); try { await fn(v); } catch (e) { toast(humanizeError(e)); } }
    const body = el('div', { class: 'wx-dlg' }, [
      text ? el('p', null, text) : null, inp,
      el('div', { class: 'row' }, [
        el('button', { class: 'wx-btn ghost', type: 'button', onClick: () => d.close() }, 'Cancel'),
        el('button', { class: 'wx-btn' + (o.danger ? ' red' : ''), type: 'button', onClick: go }, okLabel),
      ]),
    ]);
    d = openDrawer(title, body, { size: 'sm', noAutofocus: !inp });
  }

  // ---- actions behind the menus ----
  async function setStatus(t, st) {
    try {
      const r = await ccWaThreadSet({ id: t.id, status: st }); if (r && r.error) throw new Error(r.error);
      toast(st === 'closed' ? 'Chat archived' : 'Chat unarchived'); await load(true);
    } catch (e) { toast(humanizeError(e)); }
  }
  function toggle(map, t, on, msgOn, msgOff) {
    if (on) { U[map][t.id] = Date.now(); } else delete U[map][t.id];
    uSave(); paintSide(); paintMain(); if (msgOn || msgOff) toast(on ? msgOn : msgOff);
  }
  function pin(t) {
    if (U.pin[t.id]) return toggle('pin', t, false, '', 'Chat unpinned');
    if (Object.keys(U.pin).filter((id) => threads().some((x) => x.id === id && x.status === 'open' && !isDel(x))).length >= 3) { toast('You can only pin up to 3 chats'); return; }
    toggle('pin', t, true, 'Chat pinned', '');
  }
  function mute(t, ms) { U.mute[t.id] = ms === -1 ? -1 : Date.now() + ms; uSave(); paintSide(); paintMain(); toast('Notifications muted'); }
  function unmute(t) { delete U.mute[t.id]; uSave(); paintSide(); paintMain(); toast('Notifications unmuted'); }
  async function markRead(t) {
    delete U.unr[t.id]; uSave();
    if (t.unread > 0) { try { await waThread(t.id); t.unread = 0; } catch (e) { toast(humanizeError(e)); } }
    paintSide(); paintRail(); load(true);
  }
  function markUnread(t) { U.unr[t.id] = true; uSave(); if (open === t.id) closeChat(); else { paintSide(); paintRail(); } }
  function inList(name, id) { return (U.lists[name] || []).includes(id); }
  function listToggle(name, t) {
    const l = U.lists[name] || (U.lists[name] = []);
    const i = l.indexOf(t.id);
    if (i >= 0) l.splice(i, 1); else l.push(t.id);
    uSave(); paintSide(); toast(i >= 0 ? 'Removed from ' + name : 'Added to ' + name);
  }
  function newList(t) {
    dialog('New list', 'Give the list a name. Lists live in this browser and show up as a filter above your chats.', 'Create', (name) => {
      if (!U.lists[name]) U.lists[name] = [];
      if (t && !U.lists[name].includes(t.id)) U.lists[name].push(t.id);
      uSave(); chip = 'list:' + name; paintSide();
    }, { input: 'List name, e.g. Hot brokers' });
  }
  function clearChat(t) {
    dialog('Clear this chat?', 'Messages disappear from this chat in your Command Center view only. LoadBoot keeps every message on record, and the other person still has theirs. New messages will show as normal.', 'Clear chat', () => {
      U.clr[t.id] = new Date().toISOString(); uSave(); paintMain(true); paintSide(); toast('Chat cleared');
    });
  }
  function deleteChat(t) {
    dialog('Delete this chat?', 'The chat is removed from your list in this browser. Nothing is deleted from LoadBoot’s records, and the chat comes back by itself when a new message arrives.', 'Delete chat', () => {
      U.del[t.id] = Date.now(); delete U.pin[t.id]; uSave(); if (open === t.id) closeChat(); paintSide(); toast('Chat deleted');
    }, { danger: true });
  }
  function chatItems(t, inHeader) {
    const arch = t.status !== 'open', muted = isMuted(t.id), pinned = !!U.pin[t.id], fav = !!U.fav[t.id], unr = isUnr(t);
    const names = Object.keys(U.lists);
    return [
      inHeader ? { ic: 'info', label: 'Contact info', on: () => { infoOpen = true; paintInfo(); } } : null,
      inHeader ? { ic: 'assign', label: 'Who answers this chat', on: () => { infoOpen = true; paintInfo(); } } : null,
      inHeader ? { ic: 'search', label: 'Search', on: () => openFind() } : null,
      inHeader ? { ic: 'close', label: 'Close chat', on: () => closeChat() } : null,
      inHeader ? { sep: true } : null,
      { ic: 'archive', label: arch ? 'Unarchive chat' : 'Archive chat', on: () => setStatus(t, arch ? 'open' : 'closed') },
      muted ? { ic: 'bell', label: 'Unmute notifications', on: () => unmute(t) }
        : { ic: 'mute', label: 'Mute notifications', sub: [
          { label: '8 hours', on: () => mute(t, 8 * 3600e3) }, { label: '1 week', on: () => mute(t, 7 * 864e5) }, { label: 'Always', on: () => mute(t, -1) }] },
      arch ? null : { ic: 'pin', label: pinned ? 'Unpin chat' : 'Pin chat', on: () => pin(t) },
      { ic: 'unread', label: unr ? 'Mark as read' : 'Mark as unread', on: () => (unr ? markRead(t) : markUnread(t)) },
      { ic: fav ? 'heartf' : 'heart', label: fav ? 'Remove from Favorites' : 'Add to Favorites', on: () => toggle('fav', t, !fav, 'Added to Favorites', 'Removed from Favorites') },
      { ic: 'list', label: 'Add to list', sub: [
        ...names.map((n) => ({ label: n, checked: inList(n, t.id), on: () => listToggle(n, t) })),
        names.length ? { sep: true } : null,
        { ic: 'newchat', label: 'New list', on: () => newList(t) }] },
      { sep: true },
      { ic: 'block', label: 'Block', disabled: true, hint: 'Not available on the shared business line yet' },
      { ic: 'clear', label: 'Clear chat', on: () => clearChat(t) },
      { ic: 'del', label: 'Delete chat', on: () => deleteChat(t) },
    ];
  }

  // ---- layout ----
  const root = el('div', { class: 'wx' });
  const railEl = el('nav', { class: 'wx-rail', 'aria-label': 'WhatsApp sections' });
  const sideEl = el('section', { class: 'wx-side' });
  const mainEl = el('section', { class: 'wx-main' });
  const pageEl = el('section', { class: 'wx-page' });
  mount(host, root);
  function fit() {
    try {
      const top = root.getBoundingClientRect().top + window.scrollY;
      const mobile = window.innerWidth <= 860;
      root.style.height = Math.max(mobile ? 480 : 540, window.innerHeight - top - (mobile ? 84 : 20)) + 'px';
      document.documentElement.classList.toggle('wx-lock', !!open && rail === 'chats' && mobile);
    } catch (_) {}
  }
  function paintLayout() {
    closeMenu();
    if (rail === 'chats') mount(root, [railEl, sideEl, mainEl]);
    else { mount(root, [railEl, pageEl]); paintPage(); }
    mChat();
    paintRail();
  }

  function paintRail() {
    const list = threads().filter((t) => t.status === 'open' && !isDel(t));
    const unread = list.filter((t) => isUnr(t) && !isMuted(t.id)).length;
    const late = list.some((t) => t.needs_reply && (t.waiting_min || 0) >= 60);
    const rb = (id, g, title, badge) => el('button', { class: 'wx-ib' + (rail === id ? ' on' : ''), type: 'button', title, 'aria-label': title,
      onClick: () => { rail = id; paintLayout(); } }, [sv(g, 24), badge]);
    const failed = (ov && ov.counts && ov.counts.failed_24h) || 0;
    mount(railEl, [
      rb('chats', 'chats', 'Chats', unread ? el('span', { class: 'wx-rb' }, String(unread)) : late ? el('span', { class: 'wx-rb dot' }) : null),
      rb('tpl', 'tpl', 'Templates', null),
      rb('log', 'log', 'Webhook log', failed ? el('span', { class: 'wx-rb dot', style: 'background:#ea0038' }) : null),
      el('div', { class: 'wx-rsp' }),
      el('div', { class: 'wx-rsep' }),
      rb('line', 'gear', 'The line — number, ids, sending switch', ov && !ov.enabled ? el('span', { class: 'wx-rb dot', style: 'background:#f59e0b' }) : null),
      el('div', { class: 'wx-me', title: 'LoadBoot business line' }, 'LB'),
    ]);
  }

  // ---- side: chats / archived / new chat ----
  const search = el('input', { type: 'text', placeholder: 'Search or start a new chat', 'aria-label': 'Search chats',
    onInput: (e) => { F.q = e.target.value; paintSide(); clearTimeout(search.t); search.t = setTimeout(() => load(true), 350); },
    onKeydown: (e) => { if (e.key === 'Escape' && F.q) { e.stopPropagation(); F.q = ''; search.value = ''; paintSide(); load(true); } } });
  const srchBox = el('label', { class: 'wx-srch' }, [sv('search', 20), search]);
  const chipsEl = el('div', { class: 'wx-chips', role: 'tablist' });
  const listEl = el('div', { class: 'wx-list', onScroll: () => closeMenu() });

  function filtered() {
    const q = F.q.trim().toLowerCase(), qd = digits(F.q);
    const serverDid = ovQ === F.q;   // the server search also reads message bodies; trust it once it has answered
    const match = (t) => serverDid || !q || tName(t).toLowerCase().includes(q) || (qd.length >= 3 && digits(t.number).includes(qd)) || (t.last_body || '').toLowerCase().includes(q);
    const base = threads().filter((t) => !isDel(t) && match(t));
    return { act: base.filter((t) => t.status === 'open'), arch: base.filter((t) => t.status !== 'open') };
  }
  const CHIPS = [
    ['all', 'All', () => true],
    ['unread', 'Unread', (t) => isUnr(t)],
    ['fav', 'Favorites', (t) => !!U.fav[t.id]],
    ['needs', 'Needs reply', (t) => !!t.needs_reply],
    ['disp', 'Dispatchers', (t) => t.who && t.who.kind === 'dispatcher'],
    ['carr', 'Carriers & drivers', (t) => t.who && (t.who.kind === 'carrier' || t.who.kind === 'driver')],
    ['else', 'Everyone else', (t) => !t.who],
  ];
  const chipFn = (c) => { if (c.startsWith('list:')) { const n = c.slice(5); return (t) => inList(n, t.id); } const x = CHIPS.find((k) => k[0] === c); return x ? x[2] : () => true; };
  const sortRows = (rows, pins) => rows.slice().sort((a, b) => {
    if (pins) { const pa = U.pin[a.id] || 0, pb = U.pin[b.id] || 0; if (pa || pb) return pb - pa; }
    return new Date(b.last_at || 0) - new Date(a.last_at || 0);
  });

  function row(t) {
    const unr = isUnr(t), muted = isMuted(t.id), draft = drafts[t.id] && open !== t.id ? drafts[t.id] : '';
    const late = t.needs_reply && (t.waiting_min || 0) >= 60;
    let lp = null, fired = false;
    const r = el('div', { class: 'wx-row' + (open === t.id ? ' on' : '') + (unr ? ' unr' : '') + (late ? ' late' : ''), role: 'button', tabindex: '0', 'aria-label': tName(t),
      onClick: () => { if (fired) { fired = false; return; } openChat(t.id); },
      onTouchstart: (e) => { fired = false; const p = e.touches[0]; clearTimeout(lp); lp = setTimeout(() => { fired = true; try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} showMenu(chatItems(t), p.clientX, p.clientY, r); }, 480); },
      onTouchmove: () => clearTimeout(lp), onTouchend: (e) => { clearTimeout(lp); if (fired && e.cancelable) e.preventDefault(); }, onTouchcancel: () => clearTimeout(lp),
      onKeydown: (e) => { if (e.key === 'Enter') openChat(t.id); },
      onContextmenu: (e) => { if (fired || menuEl) { e.preventDefault(); return; } menuAt(e, chatItems(t), r); } }, [
      avatar(t, 49),
      el('div', { class: 'wx-rbd' }, [
        el('div', { class: 'wx-r1' }, [
          el('span', { class: 'wx-rn' }, tName(t)),
          t.who ? el('span', { class: 'wx-tag', style: 'background:' + whoColor(t.who), title: t.who.dispatcher ? 'Dispatcher: ' + t.who.dispatcher : null }, t.who.label || t.who.kind) : null,
          el('span', { class: 'wx-rt' }, listTime(t.last_at)),
        ]),
        el('div', { class: 'wx-r2' }, [
          el('span', { class: 'wx-rp' }, draft
            ? [el('span', { class: 'dr' }, 'Draft:'), el('span', { class: 't' }, draft)]
            : [t.last_direction === 'outbound' ? sv('tick', 16, 'tk') : null, el('span', { class: 't' }, t.last_body || (t.last_at ? 'Attachment' : 'No messages yet'))]),
          el('span', { class: 'wx-rx' }, [
            t.needs_reply ? el('span', { class: 'wx-wt' + (late ? ' r' : ''), title: 'Waiting on us' }, wait(t.waiting_min)) : null,
            muted ? sv('mute', 18) : null,
            U.pin[t.id] && t.status === 'open' ? sv('pin', 18) : null,
            unr ? el('span', { class: 'wx-badge' + (muted ? ' mu' : '') + (t.unread > 0 ? '' : ' e') }, t.unread > 0 ? String(t.unread) : '') : null,
            el('button', { class: 'wx-chev', type: 'button', 'aria-label': 'Chat options', onClick: (e) => menuAt(e, chatItems(t), r) }, sv('down', 22)),
          ]),
        ]),
      ]),
    ]);
    return r;
  }

  function sideMenuItems() {
    return [
      { ic: 'newchat', label: 'New chat', on: () => { side = 'new'; paintSide(); } },
      { ic: 'archive', label: 'Archived', on: () => { side = 'archived'; paintSide(); } },
      { ic: 'list', label: 'New list', on: () => newList(null) },
      { ic: 'unread', label: 'Mark all as read', on: () => { const l = threads().filter((t) => isUnr(t)); l.forEach((t) => { delete U.unr[t.id]; }); uSave(); Promise.all(l.filter((t) => t.unread > 0).map((t) => waThread(t.id).catch(() => null))).then(() => load(true)); paintSide(); } },
      { ic: 'refresh', label: 'Refresh', on: () => load(false) },
      { sep: true },
      { ic: 'tpl', label: 'Templates', on: () => { rail = 'tpl'; paintLayout(); } },
      { ic: 'log', label: 'Webhook log', on: () => { rail = 'log'; paintLayout(); } },
      { ic: 'gear', label: 'The line (settings)', on: () => { rail = 'line'; paintLayout(); } },
    ];
  }
  function filterMenuItems() {
    const disp = (ov && ov.dispatchers) || [];
    const names = Object.keys(U.lists);
    const selName = (disp.find((d) => d.user_id === F.dispatcher) || {}).name;
    return [
      { head: 'Lists' },
      ...names.map((n) => ({ ic: 'list', label: n + ' (' + (U.lists[n] || []).length + ')', checked: chip === 'list:' + n, on: () => { chip = 'list:' + n; paintSide(); } })),
      { ic: 'newchat', label: 'New list', on: () => newList(null) },
      names.length ? { ic: 'del', label: 'Delete a list', sub: names.map((n) => ({ label: n, on: () => dialog('Delete “' + n + '”?', 'Only the list goes. The chats in it stay where they are.', 'Delete list', () => { delete U.lists[n]; if (chip === 'list:' + n) chip = 'all'; uSave(); paintSide(); }, { danger: true }) })) } : null,
      { sep: true },
      { head: 'Dispatcher' },
      { ic: 'person', label: 'Every dispatcher', checked: !F.dispatcher, on: () => { F.dispatcher = ''; load(true); } },
      ...disp.map((d) => ({ ic: 'person', label: d.name || d.user_id, checked: F.dispatcher === d.user_id, on: () => { F.dispatcher = d.user_id; load(true); } })),
      // one e-mail when the set is complete, not one per assignment
      F.dispatcher ? { sep: true } : null,
      F.dispatcher ? { ic: 'mail', label: 'Email ' + (selName || 'dispatcher') + ' their chats', on: async () => {
        try { const r = await ccWaNotifyAssigned(F.dispatcher); if (r && r.error) throw new Error(r.error); toast('E-mail sent — ' + r.threads + ' conversation(s) listed.'); }
        catch (e) { toast(humanizeError(e)); }
      } } : null,
    ];
  }

  function paintSide() {
    if (rail !== 'chats') return;
    if (side === 'new') return paintNew();
    const { act, arch } = filtered();
    if (side === 'archived') {
      sideEl.dataset.m = 'archived';
      mount(sideEl, [
        el('div', { class: 'wx-sh sub' }, [
          el('button', { class: 'wx-ib', type: 'button', 'aria-label': 'Back', onClick: () => { side = 'chats'; paintSide(); } }, sv('back', 24)),
          el('h2', null, 'Archived'),
        ]),
        el('p', { class: 'wx-hint', style: 'padding:4px 22px 12px' }, 'Archived chats are closed conversations. A chat comes back to the list by itself when the person writes again.'),
        listEl,
      ]);
      mount(listEl, arch.length ? sortRows(arch, false).map(row) : el('div', { class: 'wx-empty' }, 'No archived chats'));
      return;
    }
    const counts = { unread: act.filter((t) => isUnr(t)).length, needs: act.filter((t) => t.needs_reply).length };
    const fn = chipFn(chip);
    const rows = sortRows(act.filter(fn), true);
    const dispOn = !!F.dispatcher;
    mount(chipsEl, [
      ...CHIPS.map(([k, label]) => el('button', { class: 'wx-chip' + (chip === k ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': chip === k ? 'true' : 'false', onClick: () => { chip = k; paintSide(); } }, [
        k === 'needs' && counts.needs ? el('span', { class: 'dt' }) : null,
        label,
        (k === 'unread' || k === 'needs') && counts[k] ? ' ' + counts[k] : null,
      ])),
      ...Object.keys(U.lists).map((n) => el('button', { class: 'wx-chip' + (chip === 'list:' + n ? ' on' : ''), type: 'button', onClick: () => { chip = 'list:' + n; paintSide(); } }, n)),
      el('button', { class: 'wx-chip ic' + (dispOn ? ' on' : ''), type: 'button', title: 'Lists and dispatcher filter', 'aria-label': 'More filters', onClick: (e) => menuAt(e, filterMenuItems()) }, sv('down', 20)),
    ]);
    const empty = chip === 'all' ? (F.q ? 'No chats, contacts or messages found' : 'No chats yet. The first one appears when someone messages LoadBoot’s WhatsApp number, or when you start one.')
      : chip === 'unread' ? 'No unread chats' : chip === 'fav' ? 'Add people to Favorites from a chat’s menu and they will show up here.'
      : chip.startsWith('list:') ? 'This list is empty. Use “Add to list” on any chat.' : 'Nothing here';
    const dispName = dispOn ? ((((ov && ov.dispatchers) || []).find((d) => d.user_id === F.dispatcher) || {}).name || 'one dispatcher') : '';
    mount(listEl, [
      arch.length ? el('div', { class: 'wx-arch', role: 'button', tabindex: '0', onClick: () => { side = 'archived'; paintSide(); } }, [sv('archive', 22), el('b', null, 'Archived'), el('span', { class: 'n' }, String(arch.length))]) : null,
      dispOn ? el('div', { class: 'wx-hint', style: 'padding:4px 14px 8px;display:flex;gap:8px;align-items:center' }, [sv('filter', 16), 'Showing ' + dispName + '’s chats · ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); F.dispatcher = ''; load(true); } }, 'show all')]) : null,
      ...(rows.length ? rows.map(row) : [el('div', { class: 'wx-empty' }, empty)]),
    ]);
    if (!sideEl.contains(listEl) || sideEl.dataset.m !== 'chats') {
      sideEl.dataset.m = 'chats';
      mount(sideEl, [
        el('div', { class: 'wx-sh' }, [
          el('h2', null, 'WhatsApp'),
          el('button', { class: 'wx-ib', type: 'button', title: 'Menu', 'aria-label': 'Menu', onClick: (e) => menuAt(e, sideMenuItems()) }, sv('more', 24)),
          el('button', { class: 'wx-ib wx-new', type: 'button', title: 'New chat', 'aria-label': 'New chat', onClick: () => { side = 'new'; paintSide(); } }, sv('newchat', 22)),
        ]),
        srchBox, chipsEl, listEl,
        el('button', { class: 'wx-fab', type: 'button', title: 'New chat', 'aria-label': 'New chat', onClick: () => { side = 'new'; paintSide(); } }, sv('newchat', 24)),
      ]);
    }
  }

  function paintNew() {
    sideEl.dataset.m = 'new';
    const num = el('input', { class: 'wx-in', type: 'tel', placeholder: 'Number with country code, e.g. +14695550100', onInput: () => paintMatches(),
      onKeydown: (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') { e.stopPropagation(); side = 'chats'; paintSide(); } } });
    const nm = el('input', { class: 'wx-in', type: 'text', placeholder: 'Name (optional)', maxlength: '80', onKeydown: (e) => { if (e.key === 'Enter') go(); } });
    const btn = el('button', { class: 'wx-btn', type: 'button', onClick: () => go() }, [sv('newchat', 18), 'Open chat']);
    const matches = el('div');
    function paintMatches() {
      const d = digits(num.value);
      const hits = d.length >= 3 ? threads().filter((t) => digits(t.number).includes(d)).slice(0, 8) : [];
      mount(matches, hits.length ? [el('div', { class: 'wx-lbl' }, 'Chats on this line'), ...hits.map((t) => { const r = row(t); r.onclick = null; r.addEventListener('click', () => { side = 'chats'; paintSide(); }); return r; })] : null);
    }
    async function go() {
      const v = num.value.trim(); if (!v || btn.disabled) { num.focus(); return; }
      btn.disabled = true;
      try {
        const r = await waStart(v, nm.value.trim() || null);
        if (!r || r.error) throw new Error((r && r.error) || 'Could not open that conversation.');
        side = 'chats'; await load(true); openChat(r.thread.id);
        toast('Conversation open. Nothing has been sent.');
      } catch (e) { btn.disabled = false; toast(humanizeError(e)); }
    }
    mount(sideEl, [
      el('div', { class: 'wx-sh sub' }, [
        el('button', { class: 'wx-ib', type: 'button', 'aria-label': 'Back', onClick: () => { side = 'chats'; paintSide(); } }, sv('back', 24)),
        el('h2', null, 'New chat'),
      ]),
      el('div', { class: 'wx-new-f' }, [num, nm, btn,
        el('p', { class: 'wx-hint' }, 'Opening a chat sends nothing. Outside Meta’s 24-hour window only an approved template can go out.')]),
      el('div', { class: 'wx-list' }, matches),
    ]);
    setTimeout(() => num.focus(), 30);
  }

  // ---- main: welcome / chat ----
  let built = null;   // DOM of the open chat: { id, head, find, body, msgs, down, comp, ta, ... }
  function welcome() {
    const c = (ov && ov.counts) || {};
    return el('div', { class: 'wx-welcome' }, [
      el('div', { class: 'art' }, sv('chats', 58)),
      el('h3', null, 'LoadBoot WhatsApp'),
      el('p', null, 'Carriers and their drivers are routed to their own dispatcher automatically. Brokers, shippers and unknown numbers stay with Command Center. Pick a chat to read and reply, or hand it to a dispatcher from the chat header.'),
      ov && !ov.number ? el('p', { style: 'color:#b45309;font-weight:600' }, 'No WhatsApp number is set yet, so nothing can be sent or matched to a conversation.') : null,
      el('div', { class: 'wx-kp' }, [
        ['Chats', c.threads], ['Unassigned', c.unassigned], ['Windows open', c.open_windows], ['Unread', c.unread], ['Messages 24 h', c.msgs_24h], ['Failed 24 h', c.failed_24h, !!c.failed_24h],
      ].map(([k, v, bad]) => el('div', { class: bad ? 'r' : '' }, [el('b', null, String(v || 0)), el('span', null, k)]))),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center' }, [
        el('button', { class: 'wx-btn', type: 'button', onClick: () => { side = 'new'; paintSide(); } }, [sv('newchat', 18), 'New chat']),
        el('button', { class: 'wx-btn ghost', type: 'button', onClick: () => { rail = 'tpl'; paintLayout(); } }, [sv('tpl', 18), 'Templates']),
      ]),
      el('div', { class: 'wx-foot' }, [sv(ov && ov.enabled ? 'lock' : 'alert', 14),
        ov && ov.enabled ? 'Sending is ON. Meta’s 24-hour window decides what can be sent.' : 'Sending is OFF — messages still arrive, nothing goes out. Switch it on under The line.']),
    ]);
  }

  function ownerPill(t) {
    const disp = (ov && ov.dispatchers) || [], staff = (ov && ov.staff) || [];
    const opt = (x) => el('option', { value: x.user_id }, x.name || x.user_id);
    const sel = el('select', { 'aria-label': 'Owner of this chat', title: 'Who answers this chat', onChange: async (e) => {
      try { const r = await ccWaAssign(t.id, e.target.value || null); if (r && r.error) throw new Error(r.error); toast('Owner updated.'); await load(true); }
      catch (err) { toast(humanizeError(err)); }
    } }, [
      // empty = nobody's name on it: Command Center answers. Staff can also put their own name on it.
      el('option', { value: '' }, 'Command Center'),
      disp.length ? el('optgroup', { label: 'Dispatchers' }, disp.map(opt)) : null,
      staff.length ? el('optgroup', { label: 'Staff' }, staff.map(opt)) : null,
    ]);
    sel.value = t.owner_user_id || '';
    return sel;
  }

  function buildChat() {
    const t = cur();
    const B = { id: open };
    B.head = el('header', { class: 'wx-ch' });
    B.find = el('div');
    B.msgs = el('div', { class: 'wx-msgs' });
    B.down = el('button', { class: 'wx-down', type: 'button', 'aria-label': 'Scroll to latest', onClick: () => { B.body.scrollTo({ top: B.body.scrollHeight, behavior: 'smooth' }); } }, sv('down', 26));
    B.body = el('div', { class: 'wx-body', onScroll: () => { B.down.classList.toggle('show', B.body.scrollHeight - B.body.scrollTop - B.body.clientHeight > 300); } }, B.msgs);
    B.pend = el('div'); B.tray = el('div'); B.emo = el('div');
    B.ta = el('textarea', { class: 'wx-ta', rows: '1', maxlength: '3000', 'aria-label': 'Message',
      onInput: (e) => { drafts[open] = e.target.value; grow(); syncComp(); },
      onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } } });
    B.ta.value = drafts[open] || '';
    B.emoB = el('button', { class: 'wx-ib wx-emob', type: 'button', title: 'Emoji', 'aria-label': 'Emoji', onClick: () => { emoOpen = !emoOpen; trayOpen = false; paintTrays(); } }, sv('emoji', 24));
    B.clip = el('button', { class: 'wx-ib wx-clip', type: 'button', title: 'Attach', 'aria-label': 'Attach', onClick: () => pickFile() }, sv('clip', 24));
    B.qr = el('button', { class: 'wx-qr', type: 'button', title: 'Approved WhatsApp templates', onClick: () => { trayOpen = !trayOpen; emoOpen = false; paintTrays(); } }, [sv('tpl', 22, 'm'), el('span', { class: 'd' }, 'Templates'), sv('down', 18, 'd')]);
    B.recd = el('span', { class: 'wx-recd', style: 'display:none' }, 'Recording…');
    B.send = el('button', { class: 'wx-sendb', type: 'button', onClick: () => { if (hasText() || pend) submit(); else toggleRec(); } });
    B.box = el('div', { class: 'wx-box' }, [el('div', { class: 'wx-pill' }, [B.emoB, B.ta, B.clip, B.qr, B.recd]), B.send]);
    B.comp = el('footer', { class: 'wx-comp' }, [B.pend, B.emo, B.tray, B.box]);
    B.info = el('div');
    B.sig = '';
    built = B;
    mount(mainEl, [B.head, B.find, B.body, B.down, B.comp, B.info]);
    if (t) { paintHead(); paintFind(); }
    grow(); syncComp(); paintTrays();
  }
  const hasText = () => !!(built && built.ta.value.trim());
  function grow() { const ta = built && built.ta; if (!ta) return; try { ta.style.height = 'auto'; ta.style.height = Math.min(170, Math.max(37, ta.scrollHeight)) + 'px'; } catch (_) {} }

  function paintHead() {
    const t = cur(); if (!t || !built) return;
    // the 8-second refresh must not rebuild an owner dropdown someone is holding open
    const hs = [t.id, tName(t), t.who && t.who.label, t.number, t.owner_user_id, findQ != null, ((ov && ov.dispatchers) || []).length].join('|');
    if (hs === built.hs) return;
    built.hs = hs;
    const sub = [t.who ? (t.who.label || t.who.kind) + (t.who.dispatcher ? ' · dispatcher ' + t.who.dispatcher : '') : null, pretty(t.number)].filter(Boolean).join(' · ');
    mount(built.head, [
      el('button', { class: 'wx-ib wx-back', type: 'button', 'aria-label': 'Back to chats', onClick: () => closeChat() }, sv('back', 24)),
      el('div', { style: 'cursor:pointer', onClick: () => { infoOpen = true; paintInfo(); } }, avatar(t, 40)),
      el('div', { class: 'who', role: 'button', tabindex: '0', title: 'Contact info', onClick: () => { infoOpen = true; paintInfo(); } }, [
        el('b', null, tName(t)),
        el('small', null, sub),
      ]),
      el('label', { class: 'wx-own', title: 'Who answers this chat' }, [sv('assign', 20), ownerPill(t), sv('down', 16, 'dn')]),
      el('a', { class: 'wx-ib', href: 'tel:+' + digits(t.number), title: 'Call ' + pretty(t.number), 'aria-label': 'Call' }, sv('phone', 22)),
      el('button', { class: 'wx-ib' + (findQ != null ? ' on' : ''), type: 'button', title: 'Search', 'aria-label': 'Search in chat', onClick: () => (findQ != null ? closeFind() : openFind()) }, sv('search', 22)),
      el('button', { class: 'wx-ib', type: 'button', title: 'Menu', 'aria-label': 'Chat menu', onClick: (e) => menuAt(e, chatItems(t, true)) }, sv('more', 22)),
    ]);
  }
  function openFind() { findQ = findQ || ''; paintHead(); paintFind(); const i = built && built.find.querySelector('input'); if (i) i.focus(); }
  function closeFind() { findQ = null; paintHead(); paintFind(); paintMsgs(true); }
  function paintFind() {
    if (!built) return;
    if (findQ == null) { mount(built.find, null); return; }
    const cnt = el('span');
    built.findCnt = cnt;
    mount(built.find, el('div', { class: 'wx-find' }, [
      sv('search', 20),
      el('input', { type: 'text', placeholder: 'Search within chat', value: findQ, onInput: (e) => { findQ = e.target.value; paintMsgs(true); }, onKeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeFind(); } } }),
      cnt,
      el('button', { class: 'wx-ib', type: 'button', 'aria-label': 'Close search', onClick: () => closeFind() }, sv('close', 20)),
    ]));
  }

  // attachments and voice notes (bl_wa_0375) — same rules as the dispatcher dock
  const mediaCache = new Map();
  async function mediaUrl(id) {
    if (mediaCache.has(id)) return mediaCache.get(id);
    const u = URL.createObjectURL(await waMediaBlob(id));
    mediaCache.set(id, u); return u;
  }
  function tick(m) {
    if (m.direction !== 'outbound' || m.status === 'failed') return null;
    if (m.status === 'queued') return sv('clock', 14, 'tk');
    const two = m.status === 'delivered' || m.status === 'read';
    return sv(two ? 'ticks' : 'tick', 16, 'tk' + (m.status === 'read' ? ' rd' : ''));
  }
  function stick() { if (built && built.stick) built.body.scrollTop = built.body.scrollHeight; }
  function mediaEl(m) {
    const kind = m.media_kind || '', mime = m.mime || '';
    if (kind === 'image' || kind === 'sticker' || mime.startsWith('image/')) {
      const img = el('img', { class: 'wx-img', alt: 'Photo', loading: 'lazy', onLoad: stick });
      mediaUrl(m.id).then((u) => { img.src = u; img.onclick = () => waLightbox(u); })
        .catch((e) => img.replaceWith(el('div', { class: 'wx-ph' }, (e && e.message) || 'Photo unavailable')));
      return img;
    }
    if (kind === 'audio' || kind === 'voice' || mime.startsWith('audio/')) {
      const au = el('audio', { class: 'wx-aud', controls: 'controls', preload: 'none' });
      mediaUrl(m.id).then((u) => { au.src = u; }).catch(() => au.replaceWith(el('div', { class: 'wx-ph' }, 'Audio unavailable')));
      return el('div', null, [m.voice ? el('div', { class: 'wx-vn' }, [sv('mic', 14), 'Voice message']) : null, au]);
    }
    if (kind === 'video' || mime.startsWith('video/')) {
      const v = el('video', { class: 'wx-img', controls: 'controls', preload: 'none' });
      mediaUrl(m.id).then((u) => { v.src = u; }).catch(() => v.replaceWith(el('div', { class: 'wx-ph' }, 'Video unavailable')));
      return v;
    }
    const name = m.file_name || (kind === 'document' ? 'Document' : 'Attachment');
    return el('button', { class: 'wx-doc', type: 'button', onClick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { waOpenBlob(await mediaUrl(m.id), m.file_name || 'attachment'); } catch (err) { toast(humanizeError(err)); }
      b.disabled = false;
    } }, [sv('doc', 30), el('span', null, [name, el('small', null, (mime || 'file').split(';')[0])])]);
  }
  function hl(text, q) {
    if (!q) return text;
    const out = [], lo = text.toLowerCase(), ql = q.toLowerCase();
    let i = 0, j;
    while ((j = lo.indexOf(ql, i)) >= 0) { if (j > i) out.push(text.slice(i, j)); out.push(el('mark', null, text.slice(j, j + q.length))); i = j + q.length; }
    if (i < text.length) out.push(text.slice(i));
    return out;
  }
  function paintMsgs(force) {
    if (!built || !thr || !thr.thread || thr.thread.id !== open) return;
    const t = cur();
    const cut = U.clr[open] ? new Date(U.clr[open]).getTime() : 0;
    const q = (findQ || '').trim();
    let list = (thr.messages || []).filter((m) => !cut || new Date(m.at).getTime() > cut);
    const total = list.length;
    if (q) list = list.filter((m) => (m.body || '').toLowerCase().includes(q.toLowerCase()) || (m.file_name || '').toLowerCase().includes(q.toLowerCase()));
    const sig = [t.window_open, t.window_ends && left(t.window_ends), cut, q, list.map((m) => m.id + m.status + (m.error || '')).join('|')].join('#');
    if (!force && sig === built.sig) return;
    const first = !built.sig;
    built.sig = sig;
    const b = built.body;
    const atBottom = first || b.scrollHeight - b.scrollTop - b.clientHeight < 90;
    built.stick = atBottom && !q;
    if (built.findCnt) built.findCnt.textContent = q ? list.length + ' of ' + total : '';
    const rows = [];
    rows.push(t.window_open
      ? el('div', { class: 'wx-note' }, [sv('lock', 14), 'Replies are open for ' + (left(t.window_ends) || 'a moment') + ' (Meta’s 24-hour window). ' + (t.owner ? 'Owner: ' + t.owner + '.' : 'Command Center answers this chat.')])
      : el('div', { class: 'wx-note r' }, [sv('clock', 14), 'Meta’s 24-hour window is closed — only an approved template can be sent until they write back.']));
    if (cut && !q) rows.push(el('div', { class: 'wx-day', style: 'position:static;text-transform:none' }, 'Chat cleared in this view on ' + et(U.clr[open])));
    let day = '', prev = null;
    list.forEach((m) => {
      const d = dayLabel(m.at);
      if (d !== day) { day = d; prev = null; rows.push(el('div', { class: 'wx-day' }, d)); }
      const out = m.direction === 'outbound', fail = m.status === 'failed';
      const tail = !prev || prev.direction !== m.direction;
      prev = m;
      const media = m.has_media ? mediaEl(m) : null;
      rows.push(el('div', { class: 'wx-mr ' + (out ? 'out' : 'in') + (tail ? ' tail' : '') }, el('div', { class: 'wx-bub' + (fail ? ' fail' : '') + (media ? ' med' : '') }, [
        media,
        m.body ? el('span', { class: 'wx-txt' }, hl(m.body, q)) : null,
        el('span', { class: 'wx-meta', title: et(m.at) }, [
          m.kind === 'template' ? el('span', { class: 'tp' }, 'Template · ') : null,
          hm(new Date(m.at)), tick(m),
        ]),
        fail ? el('div', { class: 'wx-err' }, [sv('alert', 14), 'Not delivered' + (m.error ? ' · ' + m.error : '')]) : null,
      ])));
    });
    if (!list.length) rows.push(el('div', { class: 'wx-day', style: 'position:static;text-transform:none' }, q ? 'No messages found' : 'No messages yet'));
    mount(built.msgs, rows);
    if (built.stick) b.scrollTop = b.scrollHeight;
  }

  // the picked file waits in a preview strip and the reply box becomes its caption (bl_wa_0383)
  let pend = null, rec = null, recChunks = [];
  function clearPend() { if (pend && pend.url) { try { URL.revokeObjectURL(pend.url); } catch (_) {} } pend = null; }
  const fsize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  function pickFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; inp.value = '';
      if (!f) return;
      if (f.size > 16 * 1024 * 1024) { toast('That file is larger than 16 MB.'); return; }
      clearPend();
      pend = { file: f, name: f.name || 'file', size: f.size, type: f.type || '', url: URL.createObjectURL(f) };
      syncComp(); if (built) built.ta.focus();
    };
    inp.click();
  }
  function syncComp() {
    if (!built) return;
    const t = cur(); const open24 = !!(t && t.window_open);
    const B = built;
    B.box.classList.toggle('dis', !open24);
    B.ta.disabled = !open24 || !!rec;
    B.ta.placeholder = !open24 ? (isPhone() ? 'Window closed — use a template' : 'The 24-hour window is closed — send an approved template instead')
      : rec ? 'Recording… press ■ to send' : pend ? 'Add a caption (optional)' : 'Type a message';
    B.clip.disabled = !open24 || sending || !!rec;
    B.emoB.disabled = !open24 || !!rec;
    B.qr.classList.toggle('on', trayOpen);
    B.recd.style.display = rec ? '' : 'none';
    const text = hasText() || !!pend;
    B.send.className = 'wx-sendb' + (rec ? ' rec' : text ? ' go' : '');
    B.send.disabled = sending || !open24;
    B.send.title = rec ? 'Stop and send' : text ? 'Send' : 'Record a voice message';
    B.send.setAttribute('aria-label', B.send.title);
    mount(B.send, sv(rec ? 'stop' : text ? 'send' : 'mic', 24));
    mount(B.pend, pend ? el('div', { class: 'wx-pend' }, [
      /^image\//.test(pend.type) ? el('img', { src: pend.url, alt: '' }) : el('div', { class: 'ext' }, ((pend.name.split('.').pop() || 'file').slice(0, 4)).toUpperCase()),
      el('div', { class: 'nm' }, [el('b', null, pend.name), el('span', null, fsize(pend.size) + ' · add a caption, then send')]),
      el('button', { class: 'wx-ib', type: 'button', disabled: sending, 'aria-label': 'Remove attachment', onClick: () => { clearPend(); syncComp(); } }, sv('close', 20)),
    ]) : null);
  }
  const fill = (body, vars) => (body || '').replace(/\{\{(\d+)\}\}/g, (_, i) => (vars && vars[Number(i) - 1]) || '{{' + i + '}}');
  // bl_wa_0396 - the same body with each {{n}} shown as what it stands for, so the list can be read
  // before anything is typed. Meta owns the wording; this only makes the placeholders legible.
  const labelled = (x) => (x.body || '').replace(/\{\{(\d+)\}\}/g, (_, i) => { const lab = (x.var_labels || [])[Number(i) - 1]; return lab ? '⟨' + lab + '⟩' : '{{' + i + '}}'; });
  function paintTrays() {
    if (!built) return;
    const t = cur();
    mount(built.emo, emoOpen ? el('div', { class: 'wx-emo' }, EMOJI.map((em) => el('button', { type: 'button', onClick: () => {
      const ta = built.ta, s = ta.selectionStart ?? ta.value.length, e2 = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + em + ta.value.slice(e2); drafts[open] = ta.value;
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + em.length; grow(); syncComp();
    } }, em))) : null);
    if (!trayOpen) { mount(built.tray, null); syncComp(); return; }
    const approved = ((ov && ov.templates) || []).filter((x) => x.status === 'approved');
    if (tplName && !approved.find((x) => x.name === tplName)) tplName = '';
    const chosen = approved.find((x) => x.name === tplName) || null;
    mount(built.tray, el('div', { class: 'wx-tray' }, !approved.length
      ? [el('h4', null, 'Templates'), el('p', { class: 'wx-hint', style: 'padding:0 4px' }, 'No template is approved at Meta yet. Outside the 24-hour window nothing can be sent until the person writes first.')]
      : [
        el('h4', null, t && t.window_open ? 'Send an approved template' : 'Window closed — pick an approved template'),
        ...approved.map((x) => el('button', { type: 'button', class: 'wx-tpl' + (tplName === x.name ? ' on' : ''),
          onClick: () => { tplName = x.name; tplVars = new Array(x.variables || 0).fill(''); paintTrays(); } }, [el('b', null, x.name.replace(/_/g, ' ')), el('span', null, labelled(x))])),
        chosen ? el('div', null, [
          (chosen.var_labels || []).length ? el('div', { class: 'wx-tvars' }, (chosen.var_labels || []).map((lab, i) => el('input', { class: 'wx-in', placeholder: lab, value: tplVars[i] || '',
            onInput: (e) => { tplVars[i] = e.target.value; const p = built.tray.querySelector('.wx-tprev'); if (p) p.textContent = fill(chosen.body, tplVars); } }))) : null,
          el('div', { class: 'wx-tprev' }, fill(chosen.body, tplVars)),
          el('div', { style: 'display:flex;justify-content:flex-end;gap:8px' }, [
            el('button', { class: 'wx-btn ghost', type: 'button', onClick: () => { tplName = ''; trayOpen = false; paintTrays(); } }, 'Cancel'),
            el('button', { class: 'wx-btn', type: 'button', disabled: sending, onClick: () => send({ thread_id: open, template: { name: chosen.name, vars: tplVars } }) }, [sv('send', 16), sending ? 'Sending…' : 'Send template']),
          ]),
        ]) : null,
      ]));
    syncComp();
  }

  // one click, one message: a second click while the first is still in flight is ignored (the first live
  // test sent the same reply twice, 1.3 s apart, because nothing stopped it). The server refuses a repeat too.
  async function send(payload) {
    if (sending) return;
    const id = open;
    sending = true; syncComp(); paintTrays();
    try {
      const r = await waSend(payload);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Could not send that message.');
      if (payload.template) { tplVars = []; tplName = ''; trayOpen = false; }
      else { drafts[id] = ''; if (built && built.id === id) { built.ta.value = ''; grow(); } }
      sending = false;
      if (built) built.stick = true;
      await loadThread(id, true); await load(true);
    } catch (e) { toast(humanizeError(e)); }
    sending = false; syncComp(); paintTrays();
  }
  async function sendFile(file, voice) {
    if (!file || sending) return;
    const id = open;
    if (file.size > 16 * 1024 * 1024) { toast('That file is larger than 16 MB.'); return; }
    sending = true; syncComp();
    try {
      const up = await waUploadMedia(id, file);
      const r = await waSend({ thread_id: id, media: { ...up, voice: !!voice, caption: voice ? '' : (drafts[id] || '') } });
      if (!r || !r.ok) throw new Error((r && r.error) || 'That attachment could not be sent.');
      if (!voice) { drafts[id] = ''; if (built && built.id === id) { built.ta.value = ''; grow(); } clearPend(); }
      sending = false;
      if (built) built.stick = true;
      await loadThread(id, true); await load(true);
    } catch (e) { toast(humanizeError(e)); }
    sending = false; syncComp();
  }
  function submit() {
    if (sending || !open) return;
    const t = cur(); if (!t || !t.window_open) return;
    if (pend) return sendFile(pend.file, false);
    const body = drafts[open] || '';
    if (body.trim()) send({ thread_id: open, body });
  }
  // bl_wa_0384 — webm/opus before mp4: only those packets can be remuxed to the Ogg/Opus that Meta
  // requires for a voice message. Chrome now offers audio/mp4, which the carrier refuses with voice:true.
  const recMime = () => ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  async function toggleRec() {
    if (rec) { try { rec.stop(); } catch (_) {} return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This browser cannot record audio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mt = recMime();
      rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
      recChunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = (rec && rec.mimeType) || mt || 'audio/webm';
        const blob = new Blob(recChunks, { type });
        rec = null; recChunks = []; syncComp();
        if (blob.size < 1200) { toast('That recording was too short.'); return; }
        // bl_wa_0378 - WhatsApp refuses audio/webm, which is all Chrome can record. The Opus packets are
        // moved into an Ogg container (no re-encode); if that fails the original goes out as before.
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const f = await waVoiceFile(blob, 'voice-note.' + ext);
        // bl_wa_0384 - not Ogg/Opus means it cannot be a voice message; it still goes, as an audio file,
        // and the sender is told rather than the send failing silently at the carrier.
        const isOgg = /ogg/i.test(f.type || '');
        if (!isOgg) toast('This browser cannot record a WhatsApp voice note, so it went as an audio file.');
        await sendFile(f, isOgg);
      };
      rec.start(); syncComp();
    } catch (_) { rec = null; toast('Microphone permission is needed to record.'); syncComp(); }
  }

  // ---- contact info (right panel) ----
  function paintInfo() {
    if (!built) return;
    const t = cur();
    if (!infoOpen || !t) { mount(built.info, null); return; }
    const muted = isMuted(t.id), fav = !!U.fav[t.id], arch = t.status !== 'open';
    const nameIn = el('input', { class: 'wx-in', value: t.contact_name || '', placeholder: 'Name for this number', maxlength: '80' });
    const noteIn = el('textarea', { class: 'wx-in', rows: '3', placeholder: 'Private note for staff (not sent)', style: 'resize:vertical' }, t.note || '');
    const save = async (p, msg) => { try { const r = await ccWaThreadSet(Object.assign({ id: t.id }, p)); if (r && r.error) throw new Error(r.error); toast(msg); await load(true); paintInfo(); } catch (e) { toast(humanizeError(e)); } };
    const irow = (ic, label, on, cls, sub, dis) => el('button', { class: 'wx-irow' + (cls ? ' ' + cls : ''), type: 'button', disabled: !!dis, onClick: on }, [sv(ic, 22), el('span', null, [label, sub ? el('small', null, sub) : null])]);
    mount(built.info, el('aside', { class: 'wx-info', 'aria-label': 'Contact info' }, [
      el('div', { class: 'wx-ih' }, [el('button', { class: 'wx-ib', type: 'button', 'aria-label': 'Close contact info', onClick: () => { infoOpen = false; paintInfo(); } }, sv('close', 24)), el('b', null, 'Contact info')]),
      el('div', { class: 'wx-ib2' }, [
        el('div', { class: 'wx-isec hero' }, [
          avatar(t, 200),
          el('h3', null, tName(t)),
          el('p', null, pretty(t.number)),
          t.who ? el('p', null, el('span', { class: 'wx-tag', style: 'background:' + whoColor(t.who) + ';font-size:12px;padding:2px 10px' }, t.who.label || t.who.kind)) : null,
          t.who && t.who.dispatcher ? el('p', { style: 'font-size:13px' }, 'Their dispatcher: ' + t.who.dispatcher) : null,
        ]),
        el('div', { class: 'wx-isec' }, [
          el('h5', null, 'Who answers this chat'),
          (() => { const s = ownerPill(t); s.className = 'wx-sel'; return s; })(),
          el('p', { class: 'wx-hint', style: 'margin-top:8px' }, t.owner ? 'Owner: ' + t.owner : 'Unassigned — Command Center answers.'),
        ]),
        el('div', { class: 'wx-isec' }, [
          el('h5', null, 'Meta 24-hour window'),
          t.window_open ? el('span', { class: 'wx-ok' }, 'Open · ' + (left(t.window_ends) || 'briefly') + ' left') : el('span', { class: 'wx-no' }, 'Closed · template only'),
          el('p', { class: 'wx-hint', style: 'margin-top:6px' }, 'Last message ' + et(t.last_at)),
        ]),
        el('div', { class: 'wx-isec' }, [
          el('h5', null, 'Name'),
          el('div', { style: 'display:flex;gap:8px' }, [nameIn, el('button', { class: 'wx-btn', type: 'button', onClick: () => save({ contact_name: nameIn.value }, 'Name saved.') }, 'Save')]),
          el('h5', { style: 'margin-top:16px' }, 'Note'),
          noteIn,
          el('div', { style: 'display:flex;justify-content:flex-end;margin-top:8px' }, el('button', { class: 'wx-btn', type: 'button', onClick: () => save({ note: noteIn.value }, 'Note saved.') }, 'Save note')),
        ]),
        el('div', { class: 'wx-isec' }, [
          irow(fav ? 'heartf' : 'heart', fav ? 'Remove from Favorites' : 'Add to Favorites', () => { toggle('fav', t, !fav, 'Added to Favorites', 'Removed from Favorites'); paintInfo(); }),
          irow(muted ? 'bell' : 'mute', muted ? 'Unmute notifications' : 'Mute notifications', () => { if (muted) unmute(t); else mute(t, 8 * 3600e3); paintInfo(); }, '', muted ? null : 'Mutes for 8 hours — more options in the chat menu'),
          irow('archive', arch ? 'Unarchive chat' : 'Archive chat', () => setStatus(t, arch ? 'open' : 'closed'), '', arch ? 'Reopens the conversation' : 'Closes the conversation for every staff member'),
        ]),
        el('div', { class: 'wx-isec' }, [
          irow('block', 'Block ' + tName(t), null, 'red', 'Not available on the shared business line yet', true),
          irow('clear', 'Clear chat', () => clearChat(t), 'red'),
          irow('del', 'Delete chat', () => deleteChat(t), 'red'),
        ]),
      ]),
    ]));
  }

  function mChat() {
    const on = !!open && rail === 'chats';
    root.classList.toggle('m-chat', on);
    document.documentElement.classList.toggle('wx-lock', on && isPhone());
    vv();
  }
  function vv() {
    const v = window.visualViewport;
    root.style.setProperty('--vvh', (v ? v.height : window.innerHeight) + 'px');
    root.style.setProperty('--vvt', (v ? v.offsetTop : 0) + 'px');
  }
  function paintMain(force) {
    if (rail !== 'chats') return;
    mChat();
    if (!open) { built = null; mount(mainEl, welcome()); return; }
    if (!built || built.id !== open || !mainEl.contains(built.head)) buildChat();
    paintHead(); paintMsgs(force); syncComp();
  }

  async function openChat(id) {
    closeMenu();
    if (open === id && built) { built.ta.focus(); return; }
    if (rec) { try { rec.stop(); } catch (_) {} }
    clearPend();
    open = id; thr = null; findQ = null; infoOpen = false; trayOpen = false; emoOpen = false; tplName = ''; tplVars = [];
    delete U.unr[id]; uSave();
    const t = byId(id); if (t) t.unread = 0;
    paintSide(); paintRail();
    buildChat();
    mount(built.msgs, el('div', { class: 'wx-day', style: 'position:static' }, 'Loading…'));
    await loadThread(id, false);
    // on a phone the keyboard stays down until they tap the box, like WhatsApp
    if (open === id && built) { const c = cur(); if (c && !c.window_open) { trayOpen = true; paintTrays(); } else if (!isPhone()) built.ta.focus(); }
  }
  function closeChat() { if (rec) { try { rec.stop(); } catch (_) {} } clearPend(); open = null; thr = null; findQ = null; infoOpen = false; paintMain(); paintSide(); }

  async function loadThread(id, quiet) {
    try {
      const r = await waThread(id);
      if (r && r.error) throw new Error(r.error);
      if (open !== id) return;
      thr = r; paintMain();
    } catch (e) { if (!quiet) toast(humanizeError(e)); }
  }

  async function load(quiet) {
    if (busy) return; busy = true;
    try {
      const q = F.q;
      const r = await ccWaOverview({ q, dispatcher: F.dispatcher });
      if (r && r.error) throw new Error(r.error);
      ov = r; ovQ = q;
      paintRail(); paintSide();
      if (rail === 'chats') { if (open) { paintHead(); syncComp(); } else paintMain(); } else paintPage();
    } catch (e) { if (!quiet) toast(humanizeError(e)); }
    busy = false;
  }

  // ---- screens behind the rail ----
  function paintPage() {
    const T = { tpl: ['Templates', tplEl, paintTpl], log: ['Webhook log', logEl, paintLog], line: ['The line', stateEl, paintState] }[rail];
    if (!T) return;
    T[2]();
    mount(pageEl, [
      el('div', { class: 'wx-ph2' }, [
        el('button', { class: 'wx-ib', type: 'button', 'aria-label': 'Back to chats', onClick: () => { rail = 'chats'; paintLayout(); paintSide(); paintMain(true); } }, sv('back', 24)),
        el('h2', null, T[0]),
        el('button', { class: 'wx-ib', type: 'button', title: 'Refresh', 'aria-label': 'Refresh', onClick: () => load(false) }, sv('refresh', 22)),
      ]),
      el('div', { class: 'pad' }, T[1]),
    ]);
  }

  async function saveCfg(p) {
    try { const r = await ccDialerConfigSet(p); if (r && r.error) throw new Error(r.error); editLine = false; toast('Saved.'); await load(true); }
    catch (e) { toast(humanizeError(e)); }
  }
  function paintState() {
    const c = ov || {};
    const saved = !!(c.number && c.messaging_profile_id);
    const kv = (k, v) => el('div', { class: 'wl-kv' }, [el('span', null, k), el('b', null, v || '—')]);
    const toggleBtn = el('button', { class: 'wl-btn', onClick: () => saveCfg({ wa_enabled: !c.enabled }) }, c.enabled ? 'Switch sending OFF' : 'Switch sending ON');
    const pill = el('span', { class: 'wl-pill ' + (c.enabled ? 'g' : 'a') }, c.enabled ? 'Sending on' : 'Sending off');
    mount(stateEl, el('div', { class: 'wl-card' }, [
      el('h3', null, 'The line'),
      el('p', { class: 'hint' }, 'Set these from Telnyx → Messaging → WhatsApp and Meta’s WhatsApp Manager. The switch below only decides whether LoadBoot may SEND; messages people send in always arrive.'),
      !c.number ? el('div', { class: 'wl-note' }, 'No WhatsApp number is set yet, so nothing can be sent or matched to a conversation.') : null,
      el('div', { class: 'wl-kpis' }, [
        ['Conversations', (c.counts && c.counts.threads) || 0], ['Unassigned', (c.counts && c.counts.unassigned) || 0],
        ['24 h windows open', (c.counts && c.counts.open_windows) || 0], ['Unread', (c.counts && c.counts.unread) || 0],
        ['Messages 24 h', (c.counts && c.counts.msgs_24h) || 0], ['Failed 24 h', (c.counts && c.counts.failed_24h) || 0],
      ].map(([k, v]) => el('div', { class: 'wl-kpi' }, [el('b', null, String(v)), el('span', null, k)]))),
      saved && !editLine
        // saved: read it, don't re-type it. "Change" puts the fields back.
        ? el('div', null, [
            el('div', { class: 'wl-row' }, [
              kv('Number', c.number), kv('WABA id', c.waba_id), kv('Phone number id', c.phone_number_id),
              kv('Messaging profile id', c.messaging_profile_id), kv('Max per hour', String(c.max_per_hour || 120)),
            ]),
            el('div', { class: 'wl-row' }, [
              el('span', { class: 'wl-pill g' }, 'Saved'),
              el('button', { class: 'wl-btn', onClick: () => { editLine = true; paintState(); } }, 'Change'),
              toggleBtn, pill,
            ]),
          ])
        : el('div', { class: 'wl-row' }, [
            el('label', null, ['Number ', el('input', { class: 'wl-in', id: 'wl-num', value: c.number || '', placeholder: '+18153651168' })]),
            el('label', null, ['WABA id ', el('input', { class: 'wl-in', id: 'wl-waba', value: c.waba_id || '', placeholder: '1620552536337068' })]),
            el('label', null, ['Phone number id ', el('input', { class: 'wl-in', id: 'wl-pnid', value: c.phone_number_id || '', placeholder: '1293822517154161' })]),
            el('label', null, ['Messaging profile id ', el('input', { class: 'wl-in', id: 'wl-prof', value: c.messaging_profile_id || '' })]),
            el('label', null, ['Max per hour ', el('input', { class: 'wl-in', id: 'wl-cap', type: 'number', min: '1', max: '1000', style: 'width:90px', value: String(c.max_per_hour || 120) })]),
            el('button', { class: 'wl-btn pri', onClick: () => saveCfg({
              wa_number: (document.getElementById('wl-num') || {}).value || '',
              wa_waba_id: (document.getElementById('wl-waba') || {}).value || '',
              wa_phone_number_id: (document.getElementById('wl-pnid') || {}).value || '',
              wa_messaging_profile_id: (document.getElementById('wl-prof') || {}).value || '',
              max_wa_per_hour: Number((document.getElementById('wl-cap') || {}).value || 120),
            }) }, 'Save'),
            saved ? el('button', { class: 'wl-btn', onClick: () => { editLine = false; paintState(); } }, 'Cancel') : null,
            toggleBtn, pill,
          ]),
    ]));
  }

  // bl_wa_0377 - the status comes FROM Meta now (asked through Telnyx, which owns the WABA), not from somebody's
  // memory of a Meta screen. The hand-set dropdown stays as the override for when something looks wrong.
  let tplBusy = false;
  async function tplSync() {
    if (tplBusy) return;
    tplBusy = true; paintTpl();
    try {
      const r = await ccWaTemplatesSync({ action: 'sync' });
      const ch = (r && r.changed) || [];
      toast(ch.length ? ch.map((c) => c.name + ': ' + (c.from || 'new') + ' → ' + c.to).join(' · ') : 'Read from Meta — nothing has changed.');
      await load(true);
    } catch (e) { toast((e && e.message) || humanizeError(e)); }
    tplBusy = false; paintTpl();
  }
  function tplSubmit(name) {
    if (tplBusy) return;
    dialog('Send “' + name + '” to Meta?', 'Meta reviews it before it can be used. You cannot edit it while it is in review.', 'Submit to Meta', async () => {
      tplBusy = true; paintTpl();
      try { await ccWaTemplateSubmit(name); toast(name + ' is with Meta. Press Sync from Meta later to see the answer.'); await load(true); }
      catch (e) { toast((e && e.message) || humanizeError(e)); }
      tplBusy = false; paintTpl();
    });
  }
  const tplPill = (st) => el('span', { class: 'wl-pill ' + (st === 'approved' ? 'g' : (st === 'rejected' || st === 'disabled' || st === 'paused' || st === 'limit_exceeded') ? 'r' : '') },
    st === 'pending' ? 'in review' : st === 'draft' ? 'draft · not sent' : String(st || '').replace(/_/g, ' '));
  function paintTpl() {
    const rows = (ov && ov.templates) || [];
    const synced = rows.map((x) => x.synced_at).filter(Boolean).sort().pop();
    mount(tplEl, el('div', { class: 'wl-card' }, [
      el('h3', null, 'Templates'),
      el('p', { class: 'hint' }, 'Meta decides these, not LoadBoot. “Sync from Meta” reads the real status through Telnyx and writes it in — that is the status the server enforces when the 24-hour window is shut.'),
      // 21 Sep 2026, proven live: a template created in Meta's own WhatsApp Manager does NOT appear in Telnyx's
      // template list, so the sync cannot read its status. Say so here rather than let it look like a fault.
      el('p', { class: 'hint' }, 'A template created in Meta’s WhatsApp Manager does not appear in Telnyx’s list, so the sync cannot read its status — use Override for those. Create new ones with Submit to Meta and the sync reads them by itself.'),
      el('div', { class: 'wl-row' }, [
        el('button', { class: 'wl-btn pri', disabled: tplBusy, onClick: tplSync }, tplBusy ? 'Asking Meta…' : 'Sync from Meta'),
        el('span', { class: 'hint' }, synced ? 'Last read ' + et(synced) : 'Never read from Meta yet.'),
      ]),
      el('div', { class: 'wl-tw' }, el('table', { class: 'wl-t' }, [
        el('thead', null, el('tr', null, ['Name', 'Category', 'Variables', 'Body', 'Status at Meta', 'Override'].map((k) => el('th', null, k)))),
        el('tbody', null, rows.map((x) => el('tr', null, [
          el('td', null, el('b', null, x.name)),
          el('td', null, x.category),
          el('td', null, String(x.variables)),
          el('td', null, [
            el('span', { class: 'wl-mono' }, x.body),
            (x.var_labels && x.var_labels.length) ? el('div', { class: 'hint' }, x.var_labels.map((l, i) => '{{' + (i + 1) + '}} ' + l).join(' · ')) : null,
          ]),
          el('td', null, [
            tplPill(x.status),
            x.rejection_reason ? el('div', { class: 'hint' }, 'Meta: ' + x.rejection_reason) : null,
            x.note ? el('div', { class: 'hint' }, x.note) : null,
            x.status === 'draft' ? el('div', null, el('button', { class: 'wl-btn', disabled: tplBusy, onClick: () => tplSubmit(x.name) }, 'Submit to Meta')) : null,
          ]),
          el('td', null, x.status === 'draft' ? el('span', { class: 'hint' }, '—') : (() => {
            const sel = el('select', { class: 'wl-sel', onChange: async (e) => {
              try { const r = await ccWaTemplateSet({ name: x.name, status: e.target.value }); if (r && r.error) throw new Error(r.error); toast('Template status saved by hand. Sync from Meta will overwrite it.'); await load(true); }
              catch (err) { toast(humanizeError(err)); }
            } }, ['pending', 'approved', 'rejected', 'paused', 'disabled'].map((s) => el('option', { value: s }, s)));
            sel.value = x.status; return sel;
          })()),
        ]))),
      ])),
    ]));
  }
  function paintLog() {
    const rows = (ov && ov.last_events) || [];
    mount(logEl, el('div', { class: 'wl-card' }, [
      el('h3', null, 'Last webhook events'),
      el('p', { class: 'hint' }, 'Telnyx does not document the inbound WhatsApp payload, so LoadBoot stores every event it receives. If a real message does not become a conversation, the answer is here — and “verified: false” means the request was NOT signed with LoadBoot’s Telnyx key and was only logged, never acted on.'),
      rows.length ? el('div', { class: 'wl-tw' }, el('table', { class: 'wl-t' }, [
        el('thead', null, el('tr', null, ['When', 'Event', 'Signed', 'Result'].map((k) => el('th', null, k)))),
        el('tbody', null, rows.map((e) => el('tr', null, [
          el('td', null, et(e.at)),
          el('td', null, e.event_type || '—'),
          el('td', null, el('span', { class: 'wl-pill ' + (e.verified ? 'g' : 'r') }, e.verified ? 'yes' : 'no')),
          el('td', null, el('span', { class: 'wl-mono' }, e.result ? JSON.stringify(e.result) : '—')),
        ]))),
      ])) : el('p', { class: 'hint' }, 'Nothing yet. The first WhatsApp webhook Telnyx sends lands here.'),
    ]));
  }

  // Esc peels one layer at a time, like WhatsApp Web: menu → search → contact info → trays → the chat itself
  function onKey(e) {
    if (e.key !== 'Escape' || !host.isConnected || document.getElementById('cc-drawer-root')) return;
    if (menuEl) { closeMenu(); return; }
    if (rail !== 'chats') return;
    if (findQ != null) { closeFind(); return; }
    if (infoOpen) { infoOpen = false; paintInfo(); return; }
    if (trayOpen || emoOpen) { trayOpen = false; emoOpen = false; paintTrays(); return; }
    if (open) closeChat();
  }
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', fit);
  const onVV = () => { vv(); if (built && built.stick) stick(); };
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', onVV); window.visualViewport.addEventListener('scroll', onVV); }

  paintLayout(); fit(); paintSide(); paintMain();
  await load(false);
  fit();
  timer = setInterval(() => { if (document.visibilityState === 'visible' && host.isConnected) load(true); }, 20000);
  // the open chat refreshes faster than the list, so a reply shows up while you are looking at it
  thrTimer = setInterval(() => { if (open && !sending && document.visibilityState === 'visible' && host.isConnected) loadThread(open, true); }, 8000);
  return () => {
    if (timer) clearInterval(timer); if (thrTimer) clearInterval(thrTimer);
    document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit);
    if (window.visualViewport) { window.visualViewport.removeEventListener('resize', onVV); window.visualViewport.removeEventListener('scroll', onVV); }
    document.documentElement.classList.remove('wx-lock');
    closeMenu(); if (rec) { try { rec.stop(); } catch (_) {} } clearPend();
  };
}
