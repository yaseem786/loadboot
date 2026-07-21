// app.js — LoadBoot Carrier Portal. A full, responsive carrier-facing web app:
// desktop shows a sidebar dashboard; mobile collapses to a bottom tab bar. Carriers
// sign in / self-register, then see ONLY their own data via self-scoping cc_pocket_*
// RPCs (the server resolves the carrier org from the session — no carrier-id param,
// so cross-carrier access is impossible). Admin/staff use the Command Center.
import ENV from '../shared/env.js';
import { US_CITIES } from './us-cities.js';
import { getSession, getUser, signInWithPassword, signUp, signOut, onAuthChange, resetPassword, updatePassword } from '../shared/session.js';
import {
  pocketOverview, pocketTrips, pocketInvoices, tripPnl, tripFinanceAdd, tripFinanceRemove, carrierEarnings, getCostModel, setCostModel, pocketCompliance, pocketConfirmTrip,
  pocketSetConsent, pocketPostLocation, pocketRaiseIssue, pocketMyIssues, pocketAnnouncements,
  pocketReportIssue, pocketDisputeInvoice, publicLoadOpportunities, pocketUploadPod, pocketTripPods, pocketTripDocs, requestPacketCopies,
  pocketDrivers, pocketUpsertDriver, pocketTrucks, pocketUpsertTruck, pocketTeam, pocketSetMember, carrierInviteDriver, myCapacity,
  pocketFleetAlerts, pocketStatement, pocketTripTimeline, pocketMyExceptions, pocketAssignTrip, pocketAdvanceTrip,
  carrierUploadDocument, carrierListDocuments, fmcsaVerify, carrierAgreementSignature, carrierW9,
  emergencyContacts, emergencyContactAdd, emergencyContactDelete, reportTripIncident, myTripIncidents,
  pocketGetProfile, pocketSaveProfile, pocketSubmitOnboarding,
  pocketGetPreferences, pocketSavePreferences,
  pocketAvailableLoads, pocketBookLoad, requestBookLoad, carrierBestLoads, getDispatchPrefs, setDispatchPrefs, tripArrive, tripArriveGps, tripDepart, carrierOffers, offerRespond,
  isFlagEnabled, myReferral, claimReferral, myReferralEarnings, referralRequestPayout, myPayoutRequests, agentChainStatus, agentFeed, agentOnboardingStatus, agentSaveOnboarding, agentPayoutCenter, agentRequestPayout, agentConfirmPayoutReceived, agentSendInvite, agentMsgSend, agentMsgList, agentClaimUpline,
  setMyPaymentProfile, myPaymentProfile, carrierViewPoster, accountHealth, myTrustProfile, myApprovedPartners, setMyServices, myServices, dispatchSheet, myRateConfirmation, acknowledgeRC, deliveryDocPack, prebookCheck, myOnboardingPacket, onboardingSubmitItem, carrierRequestAccessorial, tripAccessorials,
  carrierPnl, carrierAddExpense, carrierExpenses, carrierDeleteExpense,
  pocketNotifications, pocketMarkNotificationRead, carrierFactoringSet, carrierFactoringPacket, carrierFactoringBrokers, carrierFactoringBrokerSet,
  carrierEldSetup, carrierAccountingExport, carrierFuelImport, carrierFleetOptimization, qboAuthUrl, qboStatus,
  submitReinstatement, myReinstatements, poaThread, myStrikes, claimEscalate, pocketUploadTripDoc, pocketCancelTrip, cancelPreview, tripPickupStatus,
  carrierDashboard, myNotifications, markMyNotification, carrierLoadDetail,
  tripEmergencyRequest, tripMyEmergencies,
  rateCounterparty, myRating, carrierRateableTrips, pocketMarkAllNotificationsRead,
  postTruck, myTruckPostings, truckPostingMatches, updateTruckPosting, scanTruckMatches,
  expenseAdd, expenseList, expenseDelete,
  iftaSet, iftaSummary, truckSetMaintenance, fleetMaintenance,
  fleetServiceAdd, fleetServiceList, fleetServiceDelete,
  payrollAdd, payrollList, payrollMarkPaid, payrollDelete,
} from '../shared/api.js';
import { uploadDocument, uploadPodDocument, uploadTripDoc, signedDocumentUrl } from '../shared/storage.js';
import { payInstructions, payMarkSent, payConfirmReceived, payMyTransfers, payDueItems, payDispute, payRequestReminder, ccLoadStops } from '../shared/api.js';
import { enablePush, isPushEnabled, pushSupported } from '../shared/push.js';
import { imagesToPdf, downloadBlob } from '../shared/ui/scanner.js';
import { brandLogo } from '../shared/ui/components.js';
import { geo, roadMiles, isStateFallback, tollEstimate } from '../shared/usGeo.js';
import { printDispatchSheet, openPrintable, openInvoicePdf } from '../shared/ui/printDoc.js';
import { mountAvatarEditor } from '../shared/ui/avatar.js';
import '../shared/ui/chatWidget.js';
import { registerAppSW } from '../shared/sw-register.js';
import { mountOfflineBanner } from '../shared/connectivity.js';

// Agent portal runs the SAME bundle as the carrier app, told apart only by URL path.
// agent/index.html sets an inline window.__LB_AGENT flag, but the site CSP (script-src
// without 'unsafe-inline'/nonce) can block that inline script, leaving the flag unset and
// the agent URL rendering the carrier portal. Derive it here from the path instead —
// this runs inside app.js (an allowed 'self' script), so it is CSP-proof and reliable.
if (location.pathname.indexOf('/app/agent/') === 0) window.__LB_AGENT = 1;

// PWA real-app behaviour: remember this portal so the installed app opens here next launch.
try { localStorage.setItem('lb_last_portal', window.__LB_AGENT ? '/app/agent/' : '/app/carrier/'); } catch (_) {}

// inDrive-style theme system — Off (light) / On (dark) / System. Official palette only.
const THEME_KEY = 'lb_theme';
function themeMode() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (_) { return 'system'; } }
function setThemeMode(m) { try { localStorage.setItem(THEME_KEY, m); } catch (_) {} applyTheme(); }
function applyTheme() {
  const m = themeMode();
  const dark = m === 'on' || (m === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-lbtheme', dark ? 'dark' : 'light');
}
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode() === 'system') applyTheme(); }); } catch (_) {}
applyTheme();

registerAppSW(); // /app/sw.js — includes Web Push handlers
const root = document.getElementById('lb-app');

/* ---------- tiny DOM helper ---------- */
const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
// GLOBAL notification / status tone tokens — defined ONCE, reused everywhere (dashboard gaps, notification feed,
// Command Center pushes). Command Center controls a notification's severity via payload.tone.
const TONE = {
  urgent:  { c: '#f87171', bg: 'rgba(220,38,38,.14)', label: 'Urgent' },
  warning: { c: '#fbbf24', bg: 'rgba(217,119,6,.14)', label: 'Attention' },
  action:  { c: '#3b9dff', bg: 'rgba(8,131,247,.14)', label: 'Action' },
  success: { c: '#34d399', bg: 'rgba(22,163,74,.14)', label: 'Done' },
  info:    { c: '#9fb0ca', bg: 'rgba(148,163,184,.10)', label: 'Info' },
};
const toneOf = (t) => TONE[t] || TONE.info;
// Premium toast notifications (top-center slide-in card; replaces browser alert()).
let _lbToastHost = null;
function lbTeamOf(txt) {
  const m = /FROM:\s*([A-Z][A-Z &]*TEAM)/i.exec(txt || '');
  if (!m) return null;
  const t = m[1].toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function lbFutureDate(inputEl, label) {
  const v = inputEl && inputEl.value;
  if (!v) return true; // optional fields stay optional
  const d = new Date(v + 'T23:59:59');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!(d.getTime() > 0)) { lbToast(label + ': that is not a valid date.', 'urgent', 'Invalid date'); return false; }
  if (d <= new Date(today.getTime() + 86399000)) { lbToast(label + ' must be a FUTURE date — an expired or same-day document cannot be saved. Renew it first.', 'urgent', 'Expired date'); return false; }
  if (d.getFullYear() > new Date().getFullYear() + 30) { lbToast(label + ': that year looks wrong (' + d.getFullYear() + ') — check the date.', 'urgent', 'Invalid date'); return false; }
  return true;
}
function lbNotifDest(n, p) {
  const TABS9 = ['dashboard', 'health', 'loads', 'trips', 'profile', 'fleet', 'finance', 'documents', 'rates', 'notifications', 'account', 'reinstate', 'onboarding', 'support'];
  const key9 = String((n && n.template_key) || '').toLowerCase();
  // trip/tracking alerts ALWAYS belong on My Loads, whatever the stored url says
  if (/^trip\.|^tracking/.test(key9)) return 'trips';
  if (p && p.url && p.url.indexOf('#') >= 0) { const t = p.url.split('#')[1]; if (t && TABS9.indexOf(t.replace(/^\//, '')) >= 0) return t.replace(/^\//, ''); }
  const txt = (((p && p.title) || '') + ' ' + ((n && n.template_key) || '')).toLowerCase();
  if (/reinstat|plan of action|poa|paused|more information/.test(txt)) return 'reinstate';
  if (/document|coi|insurance|w-?9|agreement|authority|upload/.test(txt)) return 'documents';
  if (/offer|load board|request to book/.test(txt)) return 'loads';
  if (/trip|pickup|delivery|detention|pod/.test(txt)) return 'trips';
  if (/invoice|payment|settle|payout|bank/.test(txt)) return 'finance';
  if (/health|warning|violation|strike|score/.test(txt)) return 'health';
  if (/approved|welcome|booking/.test(txt)) return 'dashboard';
  return 'notifications';
}
function lbToast(msg, tone, title) {
  const t = toneOf(tone || 'urgent');
  if (!_lbToastHost) { _lbToastHost = h('div', { style: 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:3000;display:flex;flex-direction:column;gap:10px;width:min(480px,92vw)' }); document.body.appendChild(_lbToastHost); }
  const icon = tone === 'success' ? '\u2713' : tone === 'action' ? '\u2139' : '!';
  const card = h('div', { style: 'display:flex;gap:12px;align-items:flex-start;background:#111c31;border:1px solid rgba(255,255,255,.12);border-left:4px solid ' + t.c + ';border-radius:14px;padding:13px 14px;box-shadow:0 18px 44px -14px rgba(0,0,0,.7);transform:translateY(-8px);opacity:0;transition:.25s' }, [
    h('span', { style: 'width:26px;height:26px;border-radius:50%;flex:none;background:' + t.bg + ';color:' + t.c + ';display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:14px' }, icon),
    h('div', { style: 'flex:1;min-width:0' }, [h('div', { style: 'font-weight:800;font-size:.92rem;color:#eaf1fb' }, title || (tone === 'success' ? 'Done' : 'Action needed')), h('div', { style: 'font-size:.84rem;color:#b9c6db;margin-top:2px;line-height:1.45' }, msg)]),
    h('button', { style: 'background:none;border:0;color:#8ea2c3;font-size:18px;cursor:pointer;line-height:1;padding:0 2px', onClick: () => card.remove() }, '\u00d7'),
  ]);
  _lbToastHost.appendChild(card);
  requestAnimationFrame(() => { card.style.transform = 'none'; card.style.opacity = '1'; });
  setTimeout(() => { card.style.opacity = '0'; card.style.transform = 'translateY(-8px)'; setTimeout(() => card.remove(), 250); }, 7000);
}
// Lightweight modal used by self-service forms (fleet, etc.). Closes on backdrop click or ✕.
function openModal(title, children) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const card = h('div', { class: 'cp-modal-card', onClick: (e) => e.stopPropagation() }, [
    h('div', { class: 'cp-modal-head' }, [h('h3', null, title), h('button', { class: 'cp-modal-x', 'aria-label': 'Close', onClick: close }, '×')]),
    h('div', { class: 'cp-modal-body' }, Array.isArray(children) ? children : [children]),
  ]);
  const ov = h('div', { class: 'cp-modal', onClick: close }, card);
  document.body.appendChild(ov);
  document.addEventListener('keydown', onEsc);
  const first = card.querySelector('input,select,textarea'); if (first) first.focus();
  return close;
}
const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const havMi = (a, b, c, d) => { const R = 3959, t = Math.PI / 180, dLat = (c - a) * t, dLng = (d - b) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(x))); };
const STATUS_TONE = { planned: 'gray', dispatched: 'blue', in_transit: 'amber', delivered: 'green', invoiced: 'green', draft: 'gray', sent: 'amber', paid: 'green', valid: 'green', missing: 'gray', pending: 'amber', expired: 'red', rejected: 'red', open: 'amber', resolved: 'green', closed: 'gray', active: 'green' };
const FRIENDLY_STATUS = { planned: 'Booked — ready to start', dispatched: 'At pickup', in_transit: 'On the road', delivered: 'Delivered', invoiced: 'Invoiced', cancelled: 'Cancelled' };
// A load whose pickup DAY has already passed is EXPIRED — it stays visible but cannot be booked
// until the broker updates its schedule.
function lbExpired(l) { if (!l || !l.pickup_date) return false; const d = new Date(String(l.pickup_date) + 'T23:59:59'); return !isNaN(d.getTime()) && d.getTime() < Date.now(); }
// Full-trip feasibility from the driver's live GPS: location -> pickup -> delivery, with HOS.
// Solo = 11h drive then 10h reset; Team = nonstop. Used for the board badges AND to block a
// booking the driver physically cannot deliver on time.
function lbFeas(l, dp) {
  const pos = window.__lbPos;
  let dh = (window.__lbDh && window.__lbDh[l.load_id || l.id] != null) ? Number(window.__lbDh[l.load_id || l.id]) : null;
  if (dh == null && pos && l.pickup_lat != null && l.pickup_lng != null) dh = havMi(pos.coords.latitude, pos.coords.longitude, l.pickup_lat, l.pickup_lng) * 1.2;
  if (dh == null) return { have: false };
  const team = !!((dp && dp.team_drivers) || (l.details && l.details.team_required));
  const hos = (mi) => { const d = mi / 52; return team ? d : (d + Math.floor(d / 11) * 10); };
  const isFcfs = !!(l.accessorials && (l.accessorials.fcfs === 'true' || l.accessorials.fcfs === true));
  const dl = (dateStr, timeStr, wnd, endOfWindow) => {
    if (!dateStr) return null;
    let tm = null;
    if (timeStr && /^\d{1,2}:\d{2}/.test(String(timeStr))) tm = String(timeStr).match(/^(\d{1,2}:\d{2})/)[1];
    else if (wnd) { const mm = String(wnd).match(/(\d{1,2}:\d{2})\s*[-\u2013]\s*(\d{1,2}:\d{2})/); if (mm) tm = endOfWindow ? mm[2] : mm[1]; }
    const d = new Date(String(dateStr) + 'T' + (tm || (endOfWindow ? '23:59' : '17:00')));
    return isNaN(d.getTime()) ? null : d;
  };
  const puDeadline = dl(l.pickup_date, l.pickup_time, l.pickup_window, isFcfs);
  const puHoursTo = puDeadline ? (puDeadline.getTime() - Date.now()) / 3600000 : null;
  const puEtaH = hos(dh);
  const transitMi = Number(l.miles) > 0 ? Number(l.miles) : ((l.pickup_lat != null && l.delivery_lat != null) ? havMi(l.pickup_lat, l.pickup_lng, l.delivery_lat, l.delivery_lng) * 1.2 : null);
  const DWELL = 2; // hours to load at pickup
  const delDeadline = dl(l.delivery_date, l.delivery_time, l.delivery_window, true);
  const delHoursTo = delDeadline ? (delDeadline.getTime() - Date.now()) / 3600000 : null;
  const delEtaH = (transitMi != null) ? (puEtaH + DWELL + hos(transitMi)) : null;
  const teamDelEtaH = (transitMi != null) ? ((dh / 52) + DWELL + (transitMi / 52)) : null;
  const puOk = (puHoursTo == null) ? true : (puEtaH <= puHoursTo);
  const delOk = (delEtaH == null || delHoursTo == null) ? true : (delEtaH <= delHoursTo);
  const teamDelOk = (teamDelEtaH == null || delHoursTo == null) ? true : (teamDelEtaH <= delHoursTo);
  return { have: true, team, dh, puEtaH, puHoursTo, puOk, transitMi, delEtaH, delHoursTo, delOk, teamDelOk };
}
function lbFeasChips(l, dp) {
  const out = [];
  const pos = window.__lbPos;
  let dh = (window.__lbDh && window.__lbDh[l.load_id || l.id] != null) ? Number(window.__lbDh[l.load_id || l.id]) : null;
  if (dh == null && pos && l.pickup_lat != null && l.pickup_lng != null) dh = Math.round(havMi(pos.coords.latitude, pos.coords.longitude, l.pickup_lat, l.pickup_lng) * 1.2);
  if (dh == null) return out;
  out.push(h('span', { class: 'cpx-chip', style: 'background:rgba(34,197,94,.16);color:#4ade80;font-weight:800' }, '\ud83d\udccd ' + Number(dh).toLocaleString() + ' mi deadhead \u2014 live from your GPS'));
  const f = lbFeas(l, dp);
  const rnd = (x) => x < 10 ? Math.round(x * 10) / 10 : Math.round(x);
  if (f.have && f.puEtaH != null && f.puHoursTo != null && f.puHoursTo > -24) {
    let bg, col, txt;
    if (f.puEtaH + 1 <= f.puHoursTo) { bg = 'rgba(34,197,94,.16)'; col = '#4ade80'; txt = '\u23f1 ~' + rnd(f.puEtaH) + 'h to pickup \u2014 you\u2019ll make it'; }
    else if (f.puEtaH <= f.puHoursTo) { bg = 'rgba(245,158,11,.18)'; col = '#fbbf24'; txt = '\u23f1 ~' + rnd(f.puEtaH) + 'h to pickup \u2014 tight, roll now'; }
    else { bg = 'rgba(239,68,68,.16)'; col = '#fca5a5'; txt = '\u26a0 ~' + rnd(f.puEtaH) + 'h to pickup, only ' + rnd(Math.max(f.puHoursTo, 0)) + 'h left \u2014 you\u2019d be LATE'; }
    out.push(h('span', { class: 'cpx-chip', style: 'background:' + bg + ';color:' + col + ';font-weight:800', title: (f.team ? 'Team (nonstop)' : 'Solo (incl. HOS breaks)') + ' estimate from your live position' }, txt));
  }
  if (f.have && f.delEtaH != null && f.delHoursTo != null) {
    let bg, col, txt;
    if (f.delEtaH + 2 <= f.delHoursTo) { bg = 'rgba(34,197,94,.16)'; col = '#4ade80'; txt = '\ud83c\udfc1 ~' + rnd(f.delEtaH) + 'h to deliver \u2014 on time'; }
    else if (f.delEtaH <= f.delHoursTo) { bg = 'rgba(245,158,11,.18)'; col = '#fbbf24'; txt = '\ud83c\udfc1 ~' + rnd(f.delEtaH) + 'h to deliver \u2014 tight'; }
    else { bg = 'rgba(239,68,68,.16)'; col = '#fca5a5'; txt = '\u26a0 can\u2019t deliver in time (~' + rnd(f.delEtaH) + 'h needed, ' + rnd(Math.max(f.delHoursTo, 0)) + 'h left)'; }
    out.push(h('span', { class: 'cpx-chip', style: 'background:' + bg + ';color:' + col + ';font-weight:800', title: (f.team ? 'Team (nonstop)' : 'Solo (incl. HOS breaks)') + ' \u2014 location\u2192pickup\u2192delivery vs the delivery schedule' }, txt));
  }
  return out;
}
const pill = (s) => h('span', { class: 'cp-pill ' + (STATUS_TONE[s] || 'gray') }, FRIENDLY_STATUS[s] || (s || '').replace(/_/g, ' '));
const ic = (name) => ({
  dash: 'M3 12l9-9 9 9M5 10v10h14V10',
  // Unique per-tab icons (owner: 'teeno takriban ek jaisi' — Loads/Trips/Fleet must be distinct):
  // Loads = freight package, Trips = navigation arrow (journey), Fleet = the truck itself.
  loads: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.3 7l8.7 5 8.7-5M12 22V12',
  trips: 'M3 11l19-9-9 19-2-8-8-2z',
  truck: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M6 20a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z',
  finance: 'M12 1v22M5 5h11a3 3 0 010 6H8a3 3 0 000 6h11',
  docs: 'M6 2h9l5 5v15H6zM14 2v6h6', support: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', user: 'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8', idcard: 'M3 5h18v14H3zM8 15a2 2 0 014 0M10 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3M15 9h3M15 13h3',
  shield: 'M12 2l8 3v6c0 5-3.4 8.4-8 11-4.6-2.6-8-6-8-11V5z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  sos: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01',
  cog: 'M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1', pin: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0zM12 13a3 3 0 100-6 3 3 0 000 6z', logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
}[name] || '');
const icon = (name, size = 20) => h('span', { class: 'cp-ic', html: '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + ic(name) + '"/></svg>' });
// Official LoadBoot mark (the "L" + orange arrow), same as the marketing site.
// A7 live chat (owner decision 2026-07-02): WhatsApp deep-link. Set the business number
// in E.164 digits (e.g. '15551234567') — the chat button stays HIDDEN until it is set,
// so no fake/unreachable contact is ever shown.
const WHATSAPP_NUMBER = '';
const LOGO_SVG = '<img src="/icon-512.png" width="34" height="34" alt="LoadBoot" style="border-radius:22%;display:block">';
const TAGLINE = 'The Operating System for Trucking';
const brandMark = (dark) => h('span', { class: 'cp-logo', html: '<img src="' + (dark ? '/logo-icon-dark.png' : '/icon-512.png') + '" width="34" height="34" alt="LoadBoot" style="display:block">' });

// horizontal/line-ish bar chart from [{label,value}]
function miniBars(data, opts = {}) {
  const d = data || []; const max = Math.max(1, ...d.map(p => Number(p.value) || 0));
  const W = 100, H = 40, n = d.length || 1, gap = 1.6, bw = (W - gap * (n - 1)) / n;
  let bars = '';
  d.forEach((p, i) => { const hh = (Number(p.value) || 0) / max * (H - 4); bars += '<rect x="' + (i * (bw + gap)).toFixed(2) + '" y="' + (H - hh).toFixed(2) + '" width="' + bw.toFixed(2) + '" height="' + Math.max(hh, 0.8).toFixed(2) + '" rx="1" fill="url(#cpg)"/>'; });
  return h('div', { class: 'cp-chart', html: '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%" height="' + (opts.height || 64) + '"><defs><linearGradient id="cpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0883F7"/><stop offset="1" stop-color="#93c5fd"/></linearGradient></defs>' + bars + '</svg>' });
}
function donut(parts) {
  // parts: [{label,value,color}]
  const total = parts.reduce((a, p) => a + (Number(p.value) || 0), 0) || 1;
  let acc = 0; const R = 16, C = 2 * Math.PI * R; let segs = '';
  parts.forEach(p => { const frac = (Number(p.value) || 0) / total; const len = frac * C; segs += '<circle r="' + R + '" cx="21" cy="21" fill="none" stroke="' + p.color + '" stroke-width="6" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 21 21)"/>'; acc += len; });
  return h('div', { class: 'cp-donut', html: '<svg viewBox="0 0 42 42" width="92" height="92">' + segs + '</svg>' });
}

/* ---------- auth screens ---------- */
function recoveryScreen() {
  const p1 = h('input', { class: 'cp-in', type: 'password', placeholder: 'New password (min 8 characters)' });
  const p2 = h('input', { class: 'cp-in', type: 'password', placeholder: 'Repeat new password' });
  const err = h('div', { class: 'cp-err' });
  const btn = h('button', { class: 'cp-btn cp-btn-lg', onClick: async () => {
    if ((p1.value || '').length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
    if (p1.value !== p2.value) { err.textContent = 'Passwords do not match.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try { const { error } = await updatePassword(p1.value); if (error) throw error;
      history.replaceState(null, '', location.pathname); boot(); }
    catch (e) { err.textContent = (e && e.message) || 'Could not update password.'; btn.disabled = false; btn.textContent = 'Set new password'; }
  } }, 'Set new password');
  mount(root, h('div', { class: 'cp-auth' }, h('div', { class: 'cp-auth-card' }, [
    h('div', { class: 'cp-auth-brand', style: 'display:flex;align-items:flex-start;gap:4px;margin-bottom:18px' }, [h('img', { src: '/logo-full-dark.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#FB923C;line-height:1;margin-top:7px" }, window.__LB_AGENT ? 'Agent' : 'Carrier')]),
    h('h1', null, 'Set a new password'),
    h('p', { class: 'cp-auth-sub' }, 'You followed a reset link — choose a new password for your account.'),
    p1, p2, err, btn,
  ])));
  root.setAttribute('aria-busy', 'false');
}
function authScreen() {
  let signup = false;
  const email = h('input', { class: 'cp-in', type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const pass = h('input', { class: 'cp-in', type: 'password', placeholder: 'Password', autocomplete: 'current-password', style: 'margin:0;padding-right:46px' });
  const eye = h('button', { type: 'button', 'aria-label': 'Show password', style: 'position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;font-size:18px;opacity:.6', onClick: () => { pass.type = pass.type === 'password' ? 'text' : 'password'; eye.textContent = pass.type === 'password' ? '👁' : '🙈'; } }, '👁');
  const passWrap = h('div', { style: 'position:relative' }, [pass, eye]);
  const company = h('input', { class: 'cp-in', type: 'text', placeholder: 'Company / carrier name', autocomplete: 'organization' });
  const name = h('input', { class: 'cp-in', type: 'text', placeholder: 'Your full name', autocomplete: 'name' });
  const CC_LIST = [
    ['🇺🇸/🇨🇦 United States / Canada', '+1'], ['🇲🇽 Mexico', '+52'], ['🇧🇷 Brazil', '+55'], ['🇦🇷 Argentina', '+54'], ['🇨🇴 Colombia', '+57'], ['🇨🇱 Chile', '+56'], ['🇵🇪 Peru', '+51'], ['🇻🇪 Venezuela', '+58'], ['🇪🇨 Ecuador', '+593'], ['🇬🇹 Guatemala', '+502'], ['🇨🇺 Cuba', '+53'], ['🇩🇴 Dominican Rep.', '+1809'], ['🇵🇷 Puerto Rico', '+1787'], ['🇯🇲 Jamaica', '+1876'],
    ['🇬🇧 United Kingdom', '+44'], ['🇮🇪 Ireland', '+353'], ['🇫🇷 France', '+33'], ['🇩🇪 Germany', '+49'], ['🇪🇸 Spain', '+34'], ['🇵🇹 Portugal', '+351'], ['🇮🇹 Italy', '+39'], ['🇳🇱 Netherlands', '+31'], ['🇧🇪 Belgium', '+32'], ['🇨🇭 Switzerland', '+41'], ['🇦🇹 Austria', '+43'], ['🇸🇪 Sweden', '+46'], ['🇳🇴 Norway', '+47'], ['🇩🇰 Denmark', '+45'], ['🇫🇮 Finland', '+358'], ['🇵🇱 Poland', '+48'], ['🇨🇿 Czechia', '+420'], ['🇸🇰 Slovakia', '+421'], ['🇭🇺 Hungary', '+36'], ['🇷🇴 Romania', '+40'], ['🇧🇬 Bulgaria', '+359'], ['🇬🇷 Greece', '+30'], ['🇺🇦 Ukraine', '+380'], ['🇷🇺 Russia', '+7'], ['🇹🇷 Türkiye', '+90'], ['🇷🇸 Serbia', '+381'], ['🇭🇷 Croatia', '+385'], ['🇧🇦 Bosnia', '+387'], ['🇦🇱 Albania', '+355'], ['🇱🇹 Lithuania', '+370'], ['🇱🇻 Latvia', '+371'], ['🇪🇪 Estonia', '+372'], ['🇬🇪 Georgia', '+995'], ['🇦🇲 Armenia', '+374'], ['🇦🇿 Azerbaijan', '+994'],
    ['🇵🇰 Pakistan', '+92'], ['🇮🇳 India', '+91'], ['🇧🇩 Bangladesh', '+880'], ['🇱🇰 Sri Lanka', '+94'], ['🇳🇵 Nepal', '+977'], ['🇦🇫 Afghanistan', '+93'], ['🇨🇳 China', '+86'], ['🇯🇵 Japan', '+81'], ['🇰🇷 South Korea', '+82'], ['🇵🇭 Philippines', '+63'], ['🇮🇩 Indonesia', '+62'], ['🇲🇾 Malaysia', '+60'], ['🇸🇬 Singapore', '+65'], ['🇹🇭 Thailand', '+66'], ['🇻🇳 Vietnam', '+84'], ['🇲🇲 Myanmar', '+95'], ['🇰🇭 Cambodia', '+855'], ['🇰🇿 Kazakhstan', '+7'], ['🇺🇿 Uzbekistan', '+998'], ['🇰🇬 Kyrgyzstan', '+996'], ['🇹🇯 Tajikistan', '+992'], ['🇹🇲 Turkmenistan', '+993'], ['🇲🇳 Mongolia', '+976'], ['🇭🇰 Hong Kong', '+852'], ['🇹🇼 Taiwan', '+886'],
    ['🇦🇪 UAE', '+971'], ['🇸🇦 Saudi Arabia', '+966'], ['🇶🇦 Qatar', '+974'], ['🇰🇼 Kuwait', '+965'], ['🇧🇭 Bahrain', '+973'], ['🇴🇲 Oman', '+968'], ['🇯🇴 Jordan', '+962'], ['🇱🇧 Lebanon', '+961'], ['🇮🇶 Iraq', '+964'], ['🇮🇷 Iran', '+98'], ['🇮🇱 Israel', '+972'], ['🇾🇪 Yemen', '+967'], ['🇸🇾 Syria', '+963'],
    ['🇪🇬 Egypt', '+20'], ['🇲🇦 Morocco', '+212'], ['🇩🇿 Algeria', '+213'], ['🇹🇳 Tunisia', '+216'], ['🇱🇾 Libya', '+218'], ['🇳🇬 Nigeria', '+234'], ['🇬🇭 Ghana', '+233'], ['🇰🇪 Kenya', '+254'], ['🇪🇹 Ethiopia', '+251'], ['🇹🇿 Tanzania', '+255'], ['🇺🇬 Uganda', '+256'], ['🇿🇦 South Africa', '+27'], ['🇿🇼 Zimbabwe', '+263'], ['🇿🇲 Zambia', '+260'], ['🇸🇳 Senegal', '+221'], ['🇨🇮 Ivory Coast', '+225'], ['🇨🇲 Cameroon', '+237'], ['🇸🇩 Sudan', '+249'], ['🇸🇴 Somalia', '+252'],
    ['🇦🇺 Australia', '+61'], ['🇳🇿 New Zealand', '+64'], ['🇫🇯 Fiji', '+679'],
  ];
  const ccSel = h('select', { class: 'cp-in', style: 'width:112px;flex:none' }, CC_LIST.map(([n9, c9]) => h('option', { value: c9, title: n9 }, c9 + '  ' + n9.split(' ')[0])));
  ccSel.value = '+1';
  const phone = h('input', { class: 'cp-in', type: 'tel', placeholder: 'Mobile number', autocomplete: 'tel' });
  const extra = h('div', { style: 'display:none' }, [h('label', { class: 'cp-lbl' }, window.__LB_AGENT ? 'Agency / company (optional)' : 'Company'), company, h('label', { class: 'cp-lbl' }, 'Your name'), name, h('label', { class: 'cp-lbl' }, 'Mobile number'), h('div', { style: 'display:flex;gap:8px' }, [ccSel, phone])]);
  const err = h('div', { class: 'cp-err' });
  const title = h('h1', null, 'Welcome back');
  const sub = h('p', { class: 'cp-auth-sub' }, window.__LB_AGENT ? 'Sign in to your AGENT dashboard — your link, your chain, your 1% on every delivered load.' : 'Sign in to your carrier portal.');
  const btn = h('button', { class: 'cp-btn cp-btn-lg' }, 'Sign in');
  const toggle = h('p', { class: 'cp-auth-toggle' });
  const forgot = h('p', { class: 'cp-auth-toggle', style: 'margin-top:8px' },
    h('a', { onClick: async () => {
      const em = email.value.trim();
      if (!em) { err.textContent = 'Enter your email above first, then tap Forgot password.'; return; }
      err.textContent = ''; err.className = 'cp-err';
      try { const { error } = await resetPassword(em); if (error) throw error;
        err.className = 'cp-err ok'; err.textContent = '✓ Reset link sent to ' + em + ' — check your inbox (and spam).'; }
      catch (e) { err.textContent = (e && e.message) || 'Could not send reset link.'; }
    } }, 'Forgot password?'));
  const setMode = (s) => {
    signup = s;
    const AG = !!window.__LB_AGENT;
    title.textContent = s ? (AG ? 'Become a LoadBoot Agent' : 'Create your account') : 'Welcome back';
    sub.textContent = s ? (AG ? 'Free agent account — your referral link is ready the moment you sign up. Bring a pair, earn 1% on every delivered load.' : 'Set up your carrier profile — it’s free.')
                        : (AG ? 'Sign in to your AGENT dashboard — your link, your chain, your 1% on every delivered load.' : 'Sign in to your carrier portal.');
    extra.style.display = s ? 'block' : 'none';
    btn.textContent = s ? 'Create account' : 'Sign in';
    err.textContent = ''; err.className = 'cp-err';
    mount(toggle, s ? [document.createTextNode('Already have an account? '), h('a', { onClick: () => setMode(false) }, 'Sign in')]
      : [document.createTextNode(AG ? 'New agent? ' : 'New carrier? '), h('a', { onClick: () => setMode(true) }, AG ? 'Create your agent account' : 'Create an account')]);
  };
  btn.onclick = async () => {
    err.textContent = ''; err.className = 'cp-err';
    const em = email.value.trim(), pw = pass.value;
    if (!em || !pw) { err.textContent = 'Enter your email and password.'; return; }
    if (signup && !name.value.trim()) { err.textContent = 'Enter your name.'; return; }
    if (signup && !window.__LB_AGENT && !company.value.trim()) { err.textContent = 'Enter your company.'; return; }
    if (signup && phone.value.replace(/\D/g, '').length < 7) { err.textContent = 'Enter a valid mobile number.'; return; }
    btn.disabled = true; btn.textContent = signup ? 'Creating…' : 'Signing in…';
    try {
      if (signup) {
        const { data, error } = await signUp(em, pw, Object.assign({ company: company.value.trim(), name: name.value.trim(), phone: (ccSel.value + ' ' + phone.value.trim()) }, window.__LB_AGENT ? { role: 'agent' } : {}));
        if (error) throw error;
        if (!data || !data.session) { setMode(false); err.className = 'cp-err ok'; err.textContent = '✓ Account created! We emailed a confirmation link to ' + em + '. Click it (check spam too), then sign in here.'; btn.disabled = false; return; }
        // Phone OTP verification — active the moment an SMS provider (Twilio) is configured; graceful otherwise.
        try {
          const phv = (ccSel.value + phone.value.trim()).replace(/[^\d+]/g, '');
          if (phv && phv.replace(/\D/g, '').length >= 7) {
            const { getClient } = await import('../shared/supabaseClient.js');
            const sb = await getClient();
            const { error: pErr } = await sb.auth.updateUser({ phone: phv });
            if (!pErr) {
              const code = window.prompt('We texted a 6-digit code to ' + phv + '.\n\nEnter it to verify your mobile number:');
              if (code && code.trim()) { try { await sb.auth.verifyOtp({ phone: phv, token: code.trim(), type: 'phone_change' }); } catch (_) {} }
            }
          }
        } catch (_) { /* SMS provider not configured yet — phone saved in profile, verification skipped */ }
        boot(); return;
      }
      const { error } = await signInWithPassword(em, pw); if (error) throw error; boot(); return;
    } catch (e) { err.textContent = (e && e.message) || 'Something went wrong.'; btn.disabled = false; btn.textContent = signup ? 'Create account' : 'Sign in'; }
  };
  const AGENT_BRAND = '<svg viewBox="0 0 300 74" style="width:100%;max-width:300px;overflow:visible" aria-hidden="true">'
    + '<line x1="30" y1="37" x2="270" y2="37" stroke="rgba(148,163,184,.3)" stroke-width="2.5" stroke-dasharray="1 8" stroke-linecap="round"/>'
    + '<circle cx="30" cy="37" r="15" fill="rgba(8,131,247,.15)" stroke="#0883F7" stroke-width="2.5"/><text x="30" y="42" font-size="13" text-anchor="middle">🏢</text>'
    + '<circle cx="150" cy="37" r="17" fill="rgba(252,83,5,.15)" stroke="#FC5305" stroke-width="2.5"/><text x="150" y="42" font-size="13" text-anchor="middle">⚡</text>'
    + '<circle cx="270" cy="37" r="15" fill="rgba(34,197,94,.12)" stroke="#16a34a" stroke-width="2.5"/><text x="270" y="42" font-size="13" text-anchor="middle">🚛</text>'
    + '<text x="150" y="70" font-size="11" font-weight="700" fill="#64748B" text-anchor="middle" font-family="Manrope,sans-serif">your broker · LoadBoot · your carrier — one chain</text></svg>'
    + '<div style="margin-top:18px;font-size:25px;font-weight:800;color:#fff;line-height:1.22;letter-spacing:-.02em">Bring the people.<br>The software does the work.<br><span style="color:#4ade80">You earn 1% — forever.</span></div>'
    + '<div class="cpx-mockstack">'
    +   '<div class="cpx-mockcard"><div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">🏢 Apex Logistics <span style="font-weight:600;color:#64748b;font-size:12px">— your broker</span></b><span class="cpx-mockchip green">joined ✓</span></div>'
    +     '<div class="cpx-mockroute"><span class="d o"></span>posted: Dallas, TX → Atlanta, GA · $2,850</div></div>'
    +   '<div class="cpx-mockcard"><div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">🚛 Ironhide Freight <span style="font-weight:600;color:#64748b;font-size:12px">— your carrier</span></b><span class="cpx-mockchip green">booked ★</span></div>'
    +     '<div class="cpx-mockroute"><span class="d g"></span>delivered · GPS-verified POD</div></div>'
    +   '<div class="cpx-mocktoast ok">💰 +$28.50 — your 1% landed automatically</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-top:22px;flex-wrap:wrap">'
    +   '<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#cdd7ea"><i style="width:20px;height:20px;border-radius:50%;background:rgba(8,131,247,.18);color:#3b9dff;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:800">1</i>Get your link</span>'
    +   '<span style="color:#3b4f75;font-weight:800">›</span>'
    +   '<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#cdd7ea"><i style="width:20px;height:20px;border-radius:50%;background:rgba(8,131,247,.18);color:#3b9dff;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:800">2</i>Bring a pair</span>'
    +   '<span style="color:#3b4f75;font-weight:800">›</span>'
    +   '<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#cdd7ea"><i style="width:20px;height:20px;border-radius:50%;background:rgba(52,211,153,.16);color:#34d399;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:800">3</i>Earn 1% on every load</span>'
    + '</div>'
    + '<div style="margin-top:12px;font-size:12px;font-weight:600;color:#8ea2c3;letter-spacing:.01em">Recurring &nbsp;·&nbsp; No cap &nbsp;·&nbsp; Costs your clients nothing</div>'
    + '<div style="margin-top:20px;color:#94a3b8;font-weight:500;font-size:13px;letter-spacing:.02em">The Operating System for Trucking</div>';
  const brandPanel = window.__LB_AGENT ? h('div', { class: 'cpx-auth-brand', html: AGENT_BRAND }) : h('div', { class: 'cpx-auth-brand', html:
    '<svg viewBox="0 0 300 90" style="width:100%;max-width:300px;overflow:visible" aria-hidden="true">'
    + '<path d="M8 74 C 80 74, 90 18, 170 18 S 282 52, 292 30" fill="none" stroke="rgba(148,163,184,.35)" stroke-width="2.5" stroke-dasharray="1 9" stroke-linecap="round"/>'
    + '<circle cx="8" cy="74" r="6" fill="none" stroke="#0883F7" stroke-width="3.5"/>'
    + '<circle cx="292" cy="30" r="6" fill="none" stroke="#16a34a" stroke-width="3.5"/>'
    + '<text x="150" y="82" font-size="11" font-weight="700" fill="#64748B" text-anchor="middle" font-family="Manrope,sans-serif">781 mi · booked in one tap</text></svg>'
    + '<div style="margin-top:18px;font-size:25px;font-weight:800;color:#fff;line-height:1.22;letter-spacing:-.02em">Higher-paying loads.<br>Paperwork that handles itself.</div>'
    + '<div class="cpx-mockstack">'
    +   '<div class="cpx-mockcard">'
    +     '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:19px">$2,850</b><span class="cpx-mockchip green">≈ +$540 profit</span></div>'
    +     '<div class="cpx-mockroute"><span class="d o"></span>Dallas, TX</div>'
    +     '<div class="cpx-mockroute"><span class="d g"></span>Atlanta, GA <span style="color:#94a3b8;font-weight:500">· 781 mi · $3.65/mi</span></div>'
    +   '</div>'
    +   '<div class="cpx-mocktoast">📍 Arrived 14:02 — detention clock running</div>'
    +   '<div class="cpx-mocktoast ok">✓ POD approved — invoice ready</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-top:22px;flex-wrap:wrap">'
    +   '<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#cdd7ea"><i style="width:20px;height:20px;border-radius:50%;background:rgba(8,131,247,.18);color:#3b9dff;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:800">1</i>Create your profile</span>'
    +   '<span style="color:#3b4f75;font-weight:800">›</span>'
    +   '<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#cdd7ea"><i style="width:20px;height:20px;border-radius:50%;background:rgba(8,131,247,.18);color:#3b9dff;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:800">2</i>Get FMCSA-verified</span>'
    +   '<span style="color:#3b4f75;font-weight:800">›</span>'
    +   '<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#cdd7ea"><i style="width:20px;height:20px;border-radius:50%;background:rgba(52,211,153,.16);color:#34d399;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:800">3</i>Start receiving broker loads</span>'
    + '</div>'
    + '<div style="margin-top:12px;font-size:12px;font-weight:600;color:#8ea2c3;letter-spacing:.01em">No forced dispatch &nbsp;·&nbsp; No contracts &nbsp;·&nbsp; You approve every load</div>'
    + '<div style="margin-top:20px;color:#94a3b8;font-weight:500;font-size:13px;letter-spacing:.02em">The Operating System for Trucking</div>' });
  mount(root, h('div', { class: 'cp-auth' }, [
    h('div', { class: 'cpx-auth-split' }, [brandPanel,
    h('div', { class: 'cp-auth-card' }, [
      h('div', { class: 'cp-auth-brand', style: 'display:flex;align-items:flex-start;gap:4px;margin-bottom:18px' }, [h('img', { src: '/logo-full-dark.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#FB923C;line-height:1;margin-top:7px" }, window.__LB_AGENT ? 'Agent' : 'Carrier')]),
      title, sub, h('label', { class: 'cp-lbl' }, 'Email'), email, h('label', { class: 'cp-lbl' }, 'Password'), passWrap, extra, err, btn, toggle, forgot,
      h('div', { class: 'cp-staff' }, [document.createTextNode('Staff member? '), h('a', { href: '/app/command-center/' }, 'Open the Command Center →')]),
    ]),
    ]),
  ]));
  setMode(false);
  root.setAttribute('aria-busy', 'false');
}

/* ---------- referral panel helpers (shared: carrier Account card + affiliate partner view) ---------- */
function buildReferralStats(r) {
  const money2 = (v) => '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const copyBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
    try { await navigator.clipboard.writeText(r.link); ev.currentTarget.textContent = 'Copied ✓'; } catch (_) { alert(r.link); }
  } }, 'Copy my link');
  return h('div', null, [
    h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Your code'), h('b', null, r.code)]),
    h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Unique link'), h('span', { class: 'cp-row-s', style: 'word-break:break-all' }, r.link)]),
    h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Referrals'), h('span', null, String(r.referrals || 0))]),
    h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Accrued (15-day hold)'), h('span', null, money2(r.accrued))]),
    h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Payable'), h('b', { style: 'color:var(--lb-green)' }, money2(r.payable))]),
    h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Paid out'), h('span', null, money2(r.paid))]),
    h('div', { style: 'margin-top:8px' }, copyBtn),
  ]);
}
function referralPayoutUI(wrap, r) {
  const hist = h('div');
  const reqBtn = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: () => {
    const bank = h('input', { class: 'cp-in', placeholder: 'Bank name' });
    const title = h('input', { class: 'cp-in', placeholder: 'Account title (must match your name / company)' });
    const acct = h('input', { class: 'cp-in', placeholder: 'Account number / IBAN' });
    const err = h('div', { class: 'cp-err' });
    const close = openModal('Request payout', [
      h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'Your full payable balance is requested at once. A person reviews every payout; money is sent through our normal payment rail to this account — nothing moves automatically.'),
      bank, title, acct, err,
      h('button', { class: 'cp-btn', style: 'margin-top:10px', onClick: async (ev) => {
        err.textContent = ''; ev.currentTarget.disabled = true;
        try {
          await referralRequestPayout({ bank_name: bank.value.trim(), account_title: title.value.trim(), account_number: acct.value.trim() });
          close(); loadHist();
        } catch (e) { ev.currentTarget.disabled = false; err.textContent = (e && e.message) || 'Could not request.'; }
      } }, 'Request payout'),
    ]);
  } }, 'Request payout');
  mount(wrap, [
    (Number(r.payable) > 0 ? reqBtn : h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'Payout requests unlock once you have a payable balance (commissions clear a 15-day hold first).')),
    h('div', { class: 'cp-row-t', style: 'margin-top:12px' }, 'Payout requests'),
    hist,
  ]);
  async function loadHist() {
    mount(hist, h('div', { class: 'cp-muted' }, 'Loading…'));
    let rows; try { rows = await myPayoutRequests(); } catch (_) { mount(hist, h('div', { class: 'cp-muted' }, 'Could not load.')); return; }
    mount(hist, (rows && rows.length) ? h('div', null, rows.map(p => h('div', { class: 'cp-row' }, [
      h('div', null, [
        h('div', { class: 'cp-row-t' }, '$' + Number(p.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })),
        h('div', { class: 'cp-row-s' }, (p.bank_name || '') + ' ···' + (p.account_last4 || '') + ' · ' + new Date(p.requested_at).toLocaleDateString() + (p.note ? ' · ' + p.note : '')),
      ]),
      pill(p.status),
    ]))) : h('div', { class: 'cp-muted' }, 'No payout requests yet.'));
  }
  loadHist();
}

// ---------- AGENT PORTAL — its own organized shell (sidebar nav + header + pages) ----------
async function agentPortal(user) {
  // agent recruited by another agent: claim the upline from the stored ?ref code (levels 2–5)
  try { const up9 = localStorage.getItem('lb_ref'); if (up9) { await agentClaimUpline(up9); localStorage.removeItem('lb_ref'); } } catch (_) {}
  let feed = null; try { feed = await agentFeed(); } catch (_) {}
  let r0 = null; try { r0 = await myReferral(); } catch (_) {}
  if (!feed || !feed.has_code) { notCarrier(); return; }
  const money9 = (v) => '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Phone camera photos are 5-15MB and blow past the storage bucket's object-size limit
  // ("The object exceeded the maximum allowed size"). Shrink large images client-side
  // (max 1800px, JPEG q0.82) before upload — invisible to the user, PDFs pass through.
  const lbShrink9 = (f9) => new Promise((res9) => {
    try {
      if (!f9 || !/^image\//.test(f9.type || '') || f9.size < 1200000) { res9(f9); return; }
      const url9 = URL.createObjectURL(f9); const im9 = new Image();
      im9.onload = () => {
        try {
          const mx9 = 1800; const sc9 = Math.min(1, mx9 / Math.max(im9.width, im9.height));
          const cv9 = document.createElement('canvas');
          cv9.width = Math.round(im9.width * sc9); cv9.height = Math.round(im9.height * sc9);
          cv9.getContext('2d').drawImage(im9, 0, 0, cv9.width, cv9.height);
          cv9.toBlob((b9) => { URL.revokeObjectURL(url9);
            if (b9 && b9.size < f9.size) res9(new File([b9], (f9.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
            else res9(f9);
          }, 'image/jpeg', 0.82);
        } catch (_) { URL.revokeObjectURL(url9); res9(f9); }
      };
      im9.onerror = () => { URL.revokeObjectURL(url9); res9(f9); };
      im9.src = url9;
    } catch (_) { res9(f9); }
  });
  let ob = null; try { ob = await agentOnboardingStatus(); } catch (_) {}
  const obProfile = (ob && ob.profile) || null;
  const obStatus = (obProfile && obProfile.status) || 'draft';
  const isVerified = obStatus === 'approved'; // profile approval is the ONLY verification truth (legacy referrer flags don't count)
  const AGNAV = [['dashboard', 'Dashboard', 'dash'], ['verify', isVerified ? 'Verification Center ✓' : 'Verification Center', 'shield'], ['post', 'Post a Load', 'loads'], ['chain', 'My Chain', 'user'], ['loads', 'Chain Loads', 'loads'], ['earnings', 'Earnings', 'finance'], ['payouts', 'Payouts', 'finance'], ['resources', 'Resources', 'docs'], ['settings', 'Settings', 'cog']];
  let tab = (location.hash || '').replace('#', '') || (isVerified ? 'dashboard' : 'verify');
  if (!AGNAV.some((n) => n[0] === tab)) tab = 'dashboard';
  const titleEl = h('h1', { class: 'cp-title' }, 'Dashboard');
  const content = h('div', { class: 'cp-content' });
  const links = {};
  const nav = h('nav', { class: 'cp-nav' }, AGNAV.map(([id, label, ic]) => {
    const a = h('a', { class: 'cp-navlink', href: '#' + id, onClick: (e) => { e.preventDefault(); go(id); } }, [icon(ic, 20), h('span', null, label)]);
    links[id] = a; return a;
  }));
  // Mobile bottom tab bar — same pattern as the carrier shell (.cp-tabbar shows <=900px,
  // sidebar hides). Without this the agent portal had NO navigation on phones.
  const tabLinks = {};
  const MOBTABS = [['dashboard', 'Home', 'dash'], ['verify', 'Verify', 'shield'], ['post', 'Post', 'loads'], ['chain', 'Chain', 'user'], ['earnings', 'Earnings', 'finance']];
  const tabbar = h('nav', { class: 'cp-tabbar' }, MOBTABS.map(([id, label, ic]) => {
    const a = h('a', { class: 'cp-navlink', href: '#' + id, onClick: (e) => { e.preventDefault(); go(id); } }, [icon(ic, 20), h('span', null, label)]);
    tabLinks[id] = a; return a;
  }));
  const SIDE9 = { carrier: ['🚛', 'Carrier'], broker: ['🏢', 'Broker'], shipper: ['🏭', 'Shipper'] };
  const sideIc9 = (k9) => (SIDE9[k9] || ['🏢', k9 || ''])[0];
  const sideLb9 = (k9) => (SIDE9[k9] || ['🏢', String(k9 || '')])[1];
  const agCard = (t9, kids9) => h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [h('h3', null, t9)]), ...(Array.isArray(kids9) ? kids9 : [kids9])].filter(Boolean));
  const tile9 = (lbl, val, hi) => h('div', { style: 'flex:1;min-width:120px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:13px;padding:14px;text-align:center' }, [
    h('div', { style: 'font-size:.6rem;letter-spacing:.09em;font-weight:800;color:#7f92b3;text-transform:uppercase' }, lbl),
    h('div', { style: 'font-size:1.45rem;font-weight:900;margin-top:3px;color:' + (hi ? '#4ade80' : '#fff') }, val)]);
  const taxPdf9 = () => {
    const W9d = (window.__agw && window.__agw.d) || {};
    const nm9 = W9d.full_name || (obProfile && obProfile.full_name) || feed.name || '';
    const isW9 = (W9d.tax_form || (obProfile && obProfile.tax_form)) === 'w9';
    const dt9 = (obProfile && obProfile.agreement_signed_at) ? new Date(obProfile.agreement_signed_at).toLocaleString() : new Date().toLocaleString();
    const addr9 = [W9d.street || (obProfile && obProfile.street), W9d.city || (obProfile && obProfile.city), W9d.state || (obProfile && obProfile.state), W9d.zip || (obProfile && obProfile.zip), W9d.country || (obProfile && obProfile.country)].filter(Boolean).join(', ');
    openPrintable((isW9 ? 'Form W-9 (Substitute)' : 'Form W-8BEN (Substitute)') + ' — ' + nm9, isW9 ? 'W-9 SUBSTITUTE' : 'W-8BEN SUBSTITUTE', [
      { rows: [['Name (as shown on tax return)', nm9], isW9 ? ['Business name', W9d.tax_biz || '—'] : ['Country of citizenship', W9d.tax_citizen || '—'], ['Address', addr9 || '—'], isW9 ? ['Federal tax classification', W9d.tax_class || '—'] : ['Date of birth', W9d.tax_dob || '—'], ['Taxpayer ID', W9d.tax_tin ? ('•••' + String(W9d.tax_tin).replace(/\D/g, '').slice(-4)) : ((obProfile && obProfile.tax_id_last4) ? '•••' + obProfile.tax_id_last4 : '—')]] },
      { h: 'Certification', rows: [['', isW9
        ? 'Under penalties of perjury, I certify that: (1) the TIN shown is correct; (2) I am not subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; (4) any FATCA code entered is correct.'
        : 'I certify that I am the beneficial owner of the income to which this form relates, I am not a U.S. person, and the information on this form is true, correct and complete.']] },
      { h: 'Electronic signature', rows: [['Signed (typed full legal name)', (obProfile && obProfile.agreement_name) || nm9], ['Signed at', dt9], ['Method', 'E-signature captured in the LoadBoot Agent portal (U.S. E-SIGN Act)']] },
      { note: 'Substitute form generated by LoadBoot from the executed onboarding record — retained for payout compliance (1099/withholding). Requestor: LoadBoot, hello@loadboot.com' },
    ]);
  };
  const agreementPdf9 = () => {
    const nm9 = (obProfile && obProfile.agreement_name) || feed.name || '';
    const dt9 = (obProfile && obProfile.agreement_signed_at) ? new Date(obProfile.agreement_signed_at).toLocaleString() : new Date().toLocaleString();
    openPrintable('LoadBoot Agent Agreement — ' + nm9, 'AGENT AGREEMENT', [
      { rows: [['Agent (independent contractor)', nm9], ['Agent code', feed.code || ''], ['Company', 'LoadBoot — The Operating System for Trucking (loadboot.com)'], ['Effective date', dt9]] },
      { h: '1. Relationship', rows: [['', 'The Agent is an INDEPENDENT CONTRACTOR, not an employee, partner or franchisee of LoadBoot. The Agent is solely responsible for their own taxes (Form 1099 will be issued to US persons where required).']] },
      { h: '2. Commission', rows: [['Rate', '1% of gross load value, level-1 (direct clients); overrides on recruited agents: L2 0.50%, L3 0.25%, L4 0.15%, L5 0.10%'], ['Trigger', 'GPS-verified DELIVERED loads only — a completed transaction is mandatory; nothing accrues on cancelled or disputed loads'], ['Activation', 'Chain pair required: one carrier + demand (referred broker/shipper or agent-posted load)'], ['Clearing', '15 days from accrual, then payable'], ['Payout', 'Monthly, minimum balance $100, to the verified payout account'], ['Funding', 'Commissions are paid from LoadBoot\u2019s own service fee — the Agent\u2019s clients never pay extra']] },
      { h: '3. Conduct', rows: [['Anti-fraud', 'Self-referrals, fake companies, incentive-splitting or circumvention cause immediate termination and forfeiture of unpaid balances'], ['Non-circumvention', 'The Agent will not move chain clients off-platform'], ['Authority', 'The Agent has NO authority to bind LoadBoot and may describe themselves only as an independent LoadBoot agent'], ['Marketing', 'No spam (CAN-SPAM/TCPA); truthful claims only; brand guidelines apply'], ['Confidentiality', 'Chain data is confidential and may be used only for program activity'], ['Agent-posted loads', 'Every load the Agent posts must carry accurate SOURCE documentation (real paying party, their rate confirmation, billing contact) within the required timelines']] },
      { h: '4. Term', rows: [['Termination', 'Either side may terminate with 15-day notice; fraud terminates immediately'], ['Balance', 'On clean exit, the earned payable balance is paid out'], ['Policies', 'LoadBoot Terms of Service, Privacy Policy and Referral Program Terms are incorporated by reference']] },
      { h: 'Electronic signature', rows: [['Signed (typed full legal name)', nm9], ['Signed at', dt9], ['Method', 'E-signature captured in the LoadBoot Agent portal (equivalent to a handwritten signature under the U.S. E-SIGN Act)']] },
      { note: 'Generated by LoadBoot from the executed onboarding record. Full program details: loadboot.com/agents.html · Questions: hello@loadboot.com' },
    ]);
  };
  const rulesModal9 = () => openModal('📖 Agent Program — rules & policies', [
    h('div', { style: 'font-size:.88rem;line-height:1.75;color:#cbd5e1' }, [
      h('b', { style: 'color:#fff' }, 'Chain activation (pair rule)'), h('br'),
      '• Your chain goes ACTIVE only when you have BOTH sides: a CARRIER + demand (a broker/shipper you referred, OR loads you post yourself).', h('br'),
      '• One side alone = PENDING: joins are recorded, your link keeps working, but no commissions accrue yet.', h('br'), h('br'),
      h('b', { style: 'color:#fff' }, 'Earning (1% rule)'), h('br'),
      '• 1% of gross ONLY on GPS-verified DELIVERED loads — a completed transaction is mandatory. Booked-but-not-delivered pays nothing.', h('br'),
      '• Counts when ANY side of the transaction is yours: your broker\u2019s load delivered by any carrier ✓ · your carrier delivering any load ✓ · your own posted load delivered ✓.', h('br'),
      '• 15-day clearing window, then payable · payouts monthly from $100 · paid from LoadBoot\u2019s own fee — your clients never pay extra.', h('br'), h('br'),
      h('b', { style: 'color:#fff' }, 'Conduct'), h('br'),
      '• No self-referrals, fake companies or circumvention — instant termination + forfeiture.', h('br'),
      '• No spam (CAN-SPAM/TCPA) · truthful claims only · you are an independent agent, not a LoadBoot employee or broker.', h('br'), h('br'),
      h('span', { class: 'cp-row-s' }, 'Full agreement: the one you e-signed in Get Verified · program page: loadboot.com/agents.html'),
    ]),
  ]);
  const banner9 = () => h('div', {
    style: (feed.pair_active
      ? 'background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.4);color:#4ade80;font-weight:800'
      : 'background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);color:#fbbf24;font-weight:700')
      + ';border-radius:12px;padding:11px 14px;cursor:pointer', onClick: rulesModal9,
  }, [
    h('div', null, feed.pair_active
      ? '✅ CHAIN ACTIVE — you earn 1% on every delivered load your clients touch.'
      : '⏳ CHAIN PENDING — bring the missing side of your pair (carrier + broker/shipper, or post a load yourself) to switch earnings on.'),
    h('div', { style: 'font-size:.72rem;font-weight:700;opacity:.75;margin-top:3px' }, '📖 Tap to read the program rules & policies'),
  ]);
  const inviteModal9 = () => {
    const sideSel = h('select', { class: 'cp-in' }, [['broker', '🏢 Broker'], ['shipper', '🏭 Shipper'], ['carrier', '🚛 Carrier']].map(([v9, l9]) => h('option', { value: v9 }, l9)));
    const nameIn = h('input', { class: 'cp-in', placeholder: 'Their first name (personalises the email)' });
    const emailIn = h('input', { class: 'cp-in', type: 'email', placeholder: 'their@company.com *' });
    const err9 = h('div', { class: 'cp-err' });
    const close = openModal('✉ Send a premium invite — with YOUR link inside', [
      h('p', { class: 'cp-row-s', style: 'margin-bottom:10px' }, 'A branded LoadBoot email goes out instantly — hero pitch for their side, your name as the personal inviter, and your referral link on the button. The join credits to you automatically. (Max 25/day.)'),
      h('label', { class: 'cp-lbl' }, 'Who are they? *'), sideSel,
      h('label', { class: 'cp-lbl' }, 'Their name'), nameIn,
      h('label', { class: 'cp-lbl' }, 'Their email *'), emailIn, err9,
      h('button', { class: 'cp-btn', style: 'margin-top:10px;background:#FC5305', onClick: async (ev9) => {
        err9.textContent = '';
        if (!/.+@.+\..+/.test(emailIn.value || '')) { err9.textContent = 'Enter a valid email.'; return; }
        const b9 = ev9.currentTarget; b9.disabled = true; b9.textContent = 'Sending…';
        try { const r9 = await agentSendInvite(sideSel.value, emailIn.value.trim(), nameIn.value.trim() || null);
          close(); lbToast((r9 && r9.note) || 'Invite sent.', 'success', '✉ Invite sent');
        } catch (e9) { b9.disabled = false; b9.textContent = '🚀 Send invite'; err9.textContent = (e9 && e9.message) || 'Failed.'; }
      } }, '🚀 Send invite'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:8px', onClick: async (ev9) => {
        const nm9 = nameIn.value.trim(); const hi9 = nm9 ? nm9 + '! ' : '';
        const MSG9 = {
          broker: hi9 + 'I moved my freight ops to LoadBoot — post a load and verified carriers book it in one tap, GPS-tracked with automatic paperwork. Join free with my link: ',
          shipper: hi9 + 'Your freight on a verified truck within hours — live GPS door to door, documented settlement. Free to start, join with my link: ',
          carrier: hi9 + 'Real loads, zero ghost posts — booked loads vanish from the board instantly, GPS proof gets your detention PAID. Free verified account: ',
        };
        const t9 = (MSG9[sideSel.value] || '') + feed.link;
        try { await navigator.clipboard.writeText(t9); ev9.currentTarget.textContent = 'Copied ✓ — paste in WhatsApp/SMS'; setTimeout(() => { ev9.currentTarget.textContent = '📋 Copy as message instead (WhatsApp/SMS)'; }, 1800); } catch (_) { alert(t9); }
      } }, '📋 Copy as message instead (WhatsApp/SMS)'),
    ]);
  };
  const linkCard = () => agCard('🔗 Your referral link', [
    h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Code'), h('b', null, feed.code)]),
    h('div', { class: 'cp-row-s', style: 'word-break:break-all;margin:4px 0 8px' }, feed.link),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#FC5305', onClick: inviteModal9 }, '✉ Invite by email'),
      h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { try { await navigator.clipboard.writeText(feed.link); ev.currentTarget.textContent = 'Copied ✓'; } catch (_) { alert(feed.link); } } }, 'Copy link'),

    ]),
  ]);
  const chainRows = () => (Array.isArray(feed.chain) && feed.chain.length) ? feed.chain.map((x) => h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
      h('div', { style: 'flex:1;min-width:190px' }, [
        h('div', { class: 'cp-row-t' }, sideIc9(x.side) + ' ' + (x.org || '')),
        h('div', { class: 'cp-row-s' }, sideLb9(x.side) + ' · joined ' + (x.joined_at ? new Date(x.joined_at).toLocaleDateString() : '') + ' · ' + (x.loads_posted || 0) + ' posted · ' + (x.trips_delivered || 0) + ' delivered'),
      ]), h('b', { style: 'color:#4ade80' }, money9(x.your_earnings)),
    ])) : [h('div', { class: 'cp-muted' }, 'Nobody yet — copy an invite from your link card and send it to the broker or carrier you already know.')];
  const loadRows = () => {
    const loads = Array.isArray(feed.loads) ? feed.loads : [];
    if (!loads.length) return [h('div', { class: 'cp-muted' }, 'Loads your clients post or haul appear here live: POSTED → BOOKED → DELIVERED (+ your cut).')];
    return loads.map((x) => h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
      h('div', { style: 'flex:1;min-width:200px' }, [
        h('div', { class: 'cp-row-t' }, (x.lane || '') + (x.rate ? ' · $' + Number(x.rate).toLocaleString() : '')),
        h('div', { class: 'cp-row-s' }, 'broker: ' + (x.broker || '—') + (x.broker_yours ? ' ★yours' : '') + (x.booked_by ? ' · carrier: ' + x.booked_by + (x.booked_by_yours ? ' ★YOURS — double chain ✓' : '') : '') + (Number(x.your_commission) ? ' · your cut ' + money9(x.your_commission) : '')),
      ]),
      x.delivered_at ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80' }, '✓ DELIVERED')
        : x.trip_status ? h('span', { class: 'cp-pill', style: 'background:rgba(8,131,247,.15);color:#3b9dff' }, '🚛 BOOKED')
        : h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.15);color:#fbbf24' }, '📦 POSTED'),
    ]));
  };
  async function render() {
    const k = feed.kpis || {}; const tt = feed.totals || {};
    if (tab === 'dashboard') {
      const notices = (Array.isArray(feed.notices) ? feed.notices : []).slice(0, 8);
      // ---- verification status card — front and centre until fully approved ----
      const obDone = {
        identity: !!(obProfile && (obProfile.full_name || '').trim() && (obProfile.phone || '').trim()),
        network: !!(obProfile && obProfile.network && Object.keys(obProfile.network).length),
        payout: !!(obProfile && (obProfile.payout_method || '').trim() && (obProfile.tax_form || '').trim()),
        signed: !!(obProfile && obProfile.agreement_signed_at),
      };
      const obCount = Object.values(obDone).filter(Boolean).length;
      const obStep = (lbl9, ok9) => h('span', { style: 'display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;color:' + (ok9 ? '#4ade80' : '#94a3b8') }, (ok9 ? '✓ ' : '○ ') + lbl9);
      const verifyCard =
        obStatus === 'approved' ? h('div', { style: 'background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.35);border-radius:12px;padding:10px 14px;font-weight:800;color:#4ade80;margin-bottom:12px' }, '🛡 Verified agent — payouts unlocked.')
        : obStatus === 'under_review' ? h('div', { style: 'background:rgba(8,131,247,.1);border:1px solid rgba(8,131,247,.4);border-radius:14px;padding:14px 16px;margin-bottom:12px' }, [
            h('div', { style: 'font-weight:800;color:#7cc0ff' }, '⏳ Verification UNDER REVIEW'),
            h('div', { class: 'cp-row-s', style: 'margin-top:3px' }, 'LoadBoot dispatch is reviewing your application — usually under 24 hours. Your link works; earnings switch on at approval.')])
        : obStatus === 'info_needed' ? h('div', { style: 'background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);border-radius:14px;padding:14px 16px;margin-bottom:12px' }, [
            h('div', { style: 'font-weight:800;color:#fbbf24' }, '⚠ Verification — more info needed'),
            h('div', { class: 'cp-row-s', style: 'margin:4px 0 8px' }, (obProfile && obProfile.review_note) || ''),
            h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('verify') }, 'Update & resubmit →')])
        : obStatus === 'rejected' ? h('div', { style: 'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.45);border-radius:14px;padding:14px 16px;margin-bottom:12px;color:#fca5a5;font-weight:700' }, '✕ Application not approved — ' + ((obProfile && obProfile.review_note) || 'contact support.'))
        : h('div', { style: 'background:linear-gradient(120deg,rgba(252,83,5,.14),rgba(8,131,247,.1));border:1.5px solid rgba(252,83,5,.5);border-radius:14px;padding:16px 18px;margin-bottom:12px' }, [
            h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
              h('div', null, [
                h('div', { style: 'font-weight:900;font-size:1.02rem;color:#fff' }, '🛡 Complete your verification — ' + obCount + ' of 4 steps done'),
                h('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;margin-top:8px' }, [
                  obStep('Identity', obDone.identity), obStep('Network', obDone.network), obStep('Payout & tax', obDone.payout), obStep('Agreement signed', obDone.signed)]),
                h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'Earnings stay locked until LoadBoot approves you. Your link works meanwhile — joins are recorded.'),
              ]),
              h('button', { class: 'cp-btn', style: 'background:#FC5305;flex:none', onClick: () => go('verify') }, obCount ? 'Continue verification →' : 'Start verification →'),
            ]),
            h('div', { style: 'height:6px;border-radius:99px;background:rgba(255,255,255,.08);margin-top:12px;overflow:hidden' },
              h('div', { style: 'height:100%;width:' + (obCount * 25) + '%;border-radius:99px;background:linear-gradient(90deg,#FC5305,#4ade80)' })),
          ]);
      mount(content, h('div', null, [
        verifyCard,
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px' }, [
          tile9('Referred', String(k.referred || 0)), tile9('Brokers', String(k.brokers || 0)), tile9('Shippers', String(k.shippers || 0)), tile9('Carriers', String(k.carriers || 0)),
          tile9('Clearing', money9(tt.accrued)), tile9('Payable', money9(tt.payable), true), tile9('Paid', money9(tt.paid), true)]),
        banner9(),
        h('div', { style: 'height:12px' }),
        linkCard(),
        agCard('📈 How your money works — tap any line to open it', [
          (() => {
            const det9 = (icon9, title9, body9) => {
              const d9 = h('details', { style: 'border:1px solid rgba(255,255,255,.1);border-radius:11px;margin-top:6px;background:rgba(255,255,255,.03);overflow:hidden' }, [
                h('summary', { style: 'cursor:pointer;padding:10px 13px;font-weight:800;font-size:.88rem;list-style:none;display:flex;gap:9px;align-items:center' }, [h('span', null, icon9), h('span', { style: 'flex:1' }, title9), h('span', { style: 'color:#7f92b3;font-weight:900' }, '▾')]),
                h('div', { style: 'padding:0 13px 12px;color:#b9c6da;font-size:.84rem;line-height:1.75' }, body9),
              ]);
              return d9;
            };
            return h('div', null, [
              det9('🔗', 'STEP 1 — Share your link (client becomes YOURS, permanently)',
                'Your link (loadboot.com/?ref=' + (feed.code || 'YOURCODE') + ') is your ownership record. The moment a broker, shipper or carrier signs up through it, the system ties them to you FOREVER — no paperwork, no claims later. They cannot be "taken" by another agent, and it costs them nothing.'),
              det9('🤝', 'STEP 2 — Complete the PAIR → chain goes ACTIVE',
                'A marketplace needs both sides. Your chain activates when you have: a CARRIER + demand. Demand = a broker/shipper you referred, OR a load you post yourself from Post a Load. Until then your status shows PENDING — joins still count, they just wait for the switch to flip.'),
              det9('🚚', 'STEP 3 — A load DELIVERS → commission is born',
                'Only a COMPLETED transaction pays: GPS-verified delivery with POD. Booked-but-cancelled = $0. It counts when ANY side is yours — your broker\u2019s load delivered by any carrier ✓, your carrier delivering anyone\u2019s load ✓, your own posted load ✓. The instant delivery is verified, your 1% is calculated on the GROSS load value and appears in Earnings with an in-app alert + email.'),
              det9('⏳', 'STEP 4 — 15-day clearing (why the wait?)',
                'Freight has disputes, claims and reversals. The 15-day window lets every load settle cleanly — it protects YOU too: once cleared, that money is firmly yours. Ledger shows it as "Accrued" during clearing, then it flips to PAYABLE automatically.'),
              det9('🏦', 'STEP 5 — Monthly payout to your VERIFIED account',
                'Payable balance ≥ $100 → request payout from the Payouts tab (or it goes out on the monthly run). Money goes only to the account you verified in onboarding (that\u2019s why we take the ID + bank proof — nobody can redirect your money). W-9/W-8BEN keeps you tax-clean; US persons get a 1099.'),
              h('div', { style: 'margin:14px 0 4px;font-weight:900;font-size:.8rem;letter-spacing:.08em;color:#7f92b3' }, 'THE 5 LEVELS — TAP EACH TO SEE THE MATH'),
              det9('🥇', 'LEVEL 1 — your direct clients · 1.00%',
                'Every delivered load your OWN referrals (or your own posted loads) touch. Example: your broker moves 20 loads/month averaging $2,400 → $48,000 moved → YOU earn $480 every month from that one relationship. This is your bread and butter.'),
              det9('🥈', 'LEVEL 2 — agents YOU recruit · 0.50%',
                'Share the SAME link with other dispatchers — when they become agents, they are your Level-2 team. You earn 0.50% on everything their chains deliver, without touching their work. Example: your recruit\u2019s chain moves $50,000/month → you earn $250/month extra, forever.'),
              det9('🥉', 'LEVEL 3 — your recruits\u2019 recruits · 0.25%',
                'When YOUR agents build their own teams, you earn on that too. Example: 3 level-3 agents each moving $40,000/month → $120,000 × 0.25% = $300/month — from people you may have never met.'),
              det9('4️⃣', 'LEVEL 4 · 0.15%  —  and  5️⃣ LEVEL 5 · 0.10%',
                'The tree keeps paying five levels deep. Individually small, but a healthy tree compounds: 10 agents at L4–L5 moving $30,000 each = $300,000 × ~0.12% ≈ $375/month of pure override. Build the network once — it pays while you sleep.'),
              h('div', { class: 'cp-row-s', style: 'margin-top:10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:10px;padding:9px 12px' },
                '💡 The whole engine is automatic: joins, tracking, commission math, clearing, notifications, emails — the software does it. Your only job: bring good people and keep them winning.'),
            ]);
          })(),
        ]),
                agCard('🔔 Latest activity', notices.length ? notices.map((n) => h('div', { class: 'cp-row-s', style: 'padding:5px 0;border-bottom:1px dashed rgba(148,163,184,.2)' }, (n.at ? new Date(n.at).toLocaleString() + ' — ' : '') + (n.title || '') + (n.body ? ' · ' + n.body : ''))) : [h('div', { class: 'cp-muted' }, 'Joins, posted loads, bookings and deliveries land here the moment they happen.')]),
      ]));
    } else if (tab === 'verify') {
      // ---- VERIFICATION CENTER shared widgets (tracker + CC thread) ----
      const obDocs9 = (ob && ob.docs) || {};
      const itemRow9 = (lbl9, ok9, hint9) => h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, lbl9), hint9 ? h('div', { class: 'cp-row-s' }, hint9) : null].filter(Boolean)),
        ok9 ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80' }, '✓ on file') : h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.15);color:#f87171' }, '✕ missing'),
      ]);
      const trackerCard9 = () => agCard('📋 Submission tracker — what CC sees', [
        itemRow9('Identity (name + mobile)', !!(obProfile && (obProfile.full_name || '').trim() && (obProfile.phone || '').trim())),
        itemRow9('Full address + country', !!(obProfile && (obProfile.country || '').trim() && (obProfile.street || '').trim() && (obProfile.city || '').trim())),
        itemRow9('Network profile', !!(obProfile && obProfile.network && Object.keys(obProfile.network).length), 'lanes/equipment — matching engine seed'),
        itemRow9('Payout method + tax form', !!(obProfile && (obProfile.payout_method || '').trim() && (obProfile.tax_form || '').trim())),
        (() => { const st9 = obDocs9.id_doc_status || 'pending';
          return h('div', { class: 'cp-row' }, [
            h('div', null, [h('div', { class: 'cp-row-t' }, 'Government photo ID'), st9 === 'rejected' && obDocs9.id_doc_reason ? h('div', { class: 'cp-row-s', style: 'color:#f87171' }, '✕ ' + obDocs9.id_doc_reason + ' — re-upload in step 3') : null].filter(Boolean)),
            !obDocs9.id_doc ? h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.15);color:#f87171' }, '✕ missing')
              : st9 === 'accepted' ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80' }, '✓ accepted')
              : st9 === 'rejected' ? h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.15);color:#f87171' }, '✕ rejected')
              : h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.15);color:#fbbf24' }, '⏳ pending review')]); })(),
        (() => { const st9 = obDocs9.bank_doc_status || 'pending';
          return h('div', { class: 'cp-row' }, [
            h('div', null, [h('div', { class: 'cp-row-t' }, 'Bank proof document'), st9 === 'rejected' && obDocs9.bank_doc_reason ? h('div', { class: 'cp-row-s', style: 'color:#f87171' }, '✕ ' + obDocs9.bank_doc_reason + ' — re-upload in step 3') : null].filter(Boolean)),
            !obDocs9.bank_doc ? h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.15);color:#f87171' }, '✕ missing')
              : st9 === 'accepted' ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80' }, '✓ accepted')
              : st9 === 'rejected' ? h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.15);color:#f87171' }, '✕ rejected')
              : h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.15);color:#fbbf24' }, '⏳ pending review')]); })(),
        itemRow9('Agent Agreement e-signed', !!(obProfile && obProfile.agreement_signed_at), obProfile && obProfile.agreement_name ? 'signed: ' + obProfile.agreement_name : null),
      ]);
      const tl9 = () => { const steps9 = [['Submitted', ['under_review','info_needed','approved','rejected'].includes(obStatus)], ['Under review', ['under_review','info_needed'].includes(obStatus) || obStatus === 'approved' || obStatus === 'rejected'], ['Decision', obStatus === 'approved' || obStatus === 'rejected' || obStatus === 'info_needed'], ['Active', obStatus === 'approved']];
        return h('div', { style: 'display:flex;gap:6px;margin-bottom:12px' }, steps9.map(([nm9, on9], i9) => h('div', { style: 'flex:1;text-align:center;font-size:.68rem;font-weight:800;padding:7px 4px;border-radius:9px;background:' + (on9 ? (nm9 === 'Active' ? 'rgba(34,197,94,.2)' : 'rgba(8,131,247,.2)') : 'rgba(255,255,255,.05)') + ';color:' + (on9 ? (nm9 === 'Active' ? '#4ade80' : '#7cc0ff') : '#64748b') }, (i9 + 1) + '. ' + nm9))); };
      const threadCard9 = () => { const host9 = agCard('💬 Talk to LoadBoot dispatch — about YOUR verification', [h('div', { class: 'cp-muted' }, 'Loading…')]);
        (async () => {
          let msgs9 = []; try { msgs9 = (await agentMsgList()) || []; } catch (_) {}
          const list9 = h('div', { style: 'max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:4px 0' },
            msgs9.length ? msgs9.map((m9) => h('div', { style: 'max-width:85%;padding:8px 12px;border-radius:12px;font-size:.85rem;line-height:1.55;' + (m9.sender === 'agent' ? 'align-self:flex-end;background:rgba(8,131,247,.2);color:#dbeafe' : 'align-self:flex-start;background:rgba(255,255,255,.07);color:#e6edf8') }, [
              h('div', null, m9.body), h('div', { style: 'font-size:.62rem;opacity:.6;margin-top:3px' }, (m9.sender === 'agent' ? 'You' : 'LoadBoot dispatch') + ' · ' + (m9.at ? new Date(m9.at).toLocaleString() : ''))]))
            : [h('div', { class: 'cp-muted' }, 'No messages yet — ask anything about your verification, documents or the program. Dispatch replies here and you get a notification.')]);
          const inp9 = h('input', { class: 'cp-in', placeholder: 'Type a message to dispatch…', style: 'flex:1;margin:0' });
          const send9 = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev9) => {
            if (!inp9.value.trim()) return; const b9 = ev9.currentTarget; b9.disabled = true;
            try { await agentMsgSend(inp9.value.trim()); inp9.value = ''; render(); } catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent'); }
          } }, 'Send');
          mount(host9, [h('div', { class: 'cp-cardhead' }, [h('h3', null, '💬 Talk to LoadBoot dispatch')]), list9, h('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [inp9, send9])]);
        })();
        return host9; };
      const W = window.__agw = window.__agw || { step: 0, d: Object.assign({ full_name: feed.name || '', network: {} }, obProfile || {}) };
      const d = W.d;
      const stEl = (st9, note9, tone9) => h('div', { style: 'background:' + (tone9 === 'ok' ? 'rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.4)' : tone9 === 'warn' ? 'rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4)' : 'rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4)') + ';border-radius:12px;padding:12px 14px;font-weight:700;color:#e6edf8' }, [h('b', null, st9), note9 ? h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, note9) : null]);
      if (obStatus === 'under_review') { mount(content, h('div', null, [tl9(), agCard('🛡 Verification status', [stEl('⏳ UNDER REVIEW', 'LoadBoot dispatch is reviewing your application — usually under 24 hours. You will get an in-app + email decision. Your link works meanwhile; earnings switch on at approval.', 'warn'), h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px;background:#0883F7', onClick: agreementPdf9 }, '⬇ Signed agreement (PDF)'), h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px;margin-left:8px;background:#0883F7', onClick: taxPdf9 }, '⬇ Signed tax form (PDF)')]), trackerCard9(), threadCard9()])); return; }
      if (obStatus === 'approved') { mount(content, h('div', null, [tl9(), agCard('🛡 Verification status', [stEl('✅ VERIFIED AGENT', 'Your chain earns on every delivered load.', 'ok'), h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px;background:#0883F7', onClick: agreementPdf9 }, '⬇ Signed agreement (PDF)'), h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px;margin-left:8px;background:#0883F7', onClick: taxPdf9 }, '⬇ Signed tax form (PDF)')]), trackerCard9(), threadCard9()])); return; }
      if (obStatus === 'rejected') { mount(content, h('div', null, [tl9(), agCard('🛡 Verification status', [stEl('✕ NOT APPROVED', (obProfile && obProfile.review_note) || 'Contact support for details.', 'bad')]), threadCard9()])); return; }
      const fld = (lbl9, key9, ph9, type9) => { const i9 = h('input', { class: 'cp-in', type: type9 || 'text', placeholder: ph9 || '' }); i9.value = d[key9] || ''; i9.oninput = () => { d[key9] = i9.value; }; return h('div', { style: 'flex:1;min-width:200px' }, [h('label', { class: 'cp-lbl' }, lbl9), i9]); };
      const steps9 = ['Identity', 'Your network', 'Payout & agreement'];
      const bar9 = h('div', { style: 'display:flex;gap:8px;margin-bottom:14px' }, steps9.map((nm9, i9) => h('div', { style: 'flex:1;text-align:center;font-size:.72rem;font-weight:800;padding:7px;border-radius:9px;background:' + (i9 === W.step ? '#0883F7' : 'rgba(255,255,255,.06)') + ';color:' + (i9 === W.step ? '#fff' : '#7f92b3') }, (i9 + 1) + '. ' + nm9)));
      const err9 = h('div', { class: 'cp-err' });
      let body9;
      if (W.step === 0) {
        const COUNTRIES9 = ['United States','Canada','Mexico','Pakistan','India','Bangladesh','Philippines','United Kingdom','Ireland','Germany','France','Spain','Portugal','Italy','Netherlands','Poland','Ukraine','Romania','Turkey','Russia','Georgia','Armenia','UAE','Saudi Arabia','Qatar','Egypt','Morocco','Nigeria','Ghana','Kenya','South Africa','Brazil','Argentina','Colombia','Peru','Chile','Venezuela','Indonesia','Malaysia','Vietnam','Thailand','China','Japan','South Korea','Sri Lanka','Nepal','Australia','New Zealand','Other'];
        const cSel9 = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Country *')].concat(COUNTRIES9.map((c9) => h('option', { value: c9 }, c9))));
        cSel9.value = d.country || ''; cSel9.onchange = () => { d.country = cSel9.value; };
        body9 = h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, [
          fld('Full name *', 'full_name', 'Your legal name'), fld('Mobile (with country code) *', 'phone', '+92 300 1234567'),
          h('div', { style: 'flex:1;min-width:200px' }, [h('label', { class: 'cp-lbl' }, 'Country *'), cSel9]),
          fld('Street address *', 'street', 'house/street'), fld('City *', 'city', ''), fld('State / Region', 'state', ''), fld('ZIP / Postal code', 'zip', ''),
          fld('Agency / company (optional)', 'agency', ''), fld('Website / LinkedIn (optional)', 'website', '')]);
      }
      else if (W.step === 1) {
        if (!d.network) d.network = {};
        const chk9 = (lbl9, key9) => { const c9 = h('input', { type: 'checkbox' }); c9.checked = !!d.network[key9]; c9.onchange = () => { d.network[key9] = c9.checked; }; return h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:.9rem;font-weight:700' }, [c9, lbl9]); };
        const nfld9 = (lbl9, key9, ph9) => { const i9 = h('input', { class: 'cp-in', placeholder: ph9 || '' }); i9.value = d.network[key9] || ''; i9.oninput = () => { d.network[key9] = i9.value; }; return h('div', { style: 'flex:1;min-width:200px' }, [h('label', { class: 'cp-lbl' }, lbl9), i9]); };
        body9 = h('div', null, [
          fld('Years in dispatch / freight', 'years_exp', 'e.g. 3', 'number'),
          h('div', { class: 'cp-lbl', style: 'margin-top:10px' }, 'Who do you already know? (matching engine uses this)'),
          h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 10px' }, [chk9('Brokers', 'has_brokers'), chk9('Carriers', 'has_carriers'), chk9('Shippers', 'has_shippers')]),
          h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, [nfld9('Lanes you know', 'lanes', 'e.g. TX → Southeast, Midwest reefer'), nfld9('Equipment', 'equipment', 'e.g. dry van, reefer, flatbed')]),
        ]);
      } else {
        const sel9 = h('select', { class: 'cp-in' }, [['', 'Choose payout method *'], ['payoneer', '\u2b50 Payoneer account \u2014 fastest, recommended'], ['local_bank', '\U0001f3e6 My local bank \u2014 paid via Payoneer'], ['ach', '\U0001f3e6 US bank account (ACH) \u2014 US agents'], ['crypto', 'USDT (TRC-20) \u2014 network fee applies'], ['other', 'Request another method \u2014 reviewed by our team']].map(([v9, l9]) => h('option', { value: v9 }, l9)));
        sel9.value = d.payout_method || ''; sel9.onchange = () => { d.payout_method = sel9.value; render(); };
        const tax9 = h('select', { class: 'cp-in' }, [['', 'Tax form *'], ['w9', 'W-9 (US person)'], ['w8ben', 'W-8BEN (non-US)']].map(([v9, l9]) => h('option', { value: v9 }, l9)));
        tax9.value = d.tax_form || ''; tax9.onchange = () => { d.tax_form = tax9.value; render(); };
        const signI = h('input', { class: 'cp-in', placeholder: 'Type your FULL LEGAL NAME to sign' }); signI.value = d.agreement_name || ''; signI.oninput = () => { d.agreement_name = signI.value; };
        body9 = h('div', null, [
          h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, [
            h('div', { style: 'flex:1;min-width:200px' }, [h('label', { class: 'cp-lbl' }, 'Payout method *'), sel9]),
            d.payout_method ? fld('Account title \u2014 must match your legal name & ID *', 'payout_title', 'exact name on the account') : null,
            // PAYONEER (default for non-US): we pay the Payoneer account; the agent withdraws to their own
            // local bank INSIDE Payoneer. We never hold a foreign IBAN — that is what fails on US wires.
            d.payout_method === 'payoneer' ? fld('Payoneer account email *', 'payout_email', 'the email your Payoneer account is registered with') : null,
            d.payout_method === 'payoneer' ? fld('Payoneer customer ID (optional)', 'payout_account', 'from Payoneer \u2192 Settings') : null,
            // LOCAL BANK — allowed, because Payoneer delivers a local bank transfer in 190+ countries.
            d.payout_method === 'local_bank' ? fld('Bank name *', 'payout_bank', 'e.g. Bank Alfalah, HBL, Meezan') : null,
            d.payout_method === 'local_bank' ? fld('IBAN / account number *', 'payout_iban', 'as printed on your statement') : null,
            d.payout_method === 'local_bank' ? fld('SWIFT / BIC (optional)', 'payout_swift', 'we look it up from the bank name if you leave it blank') : null,
            d.payout_method === 'local_bank' ? fld('Bank branch address *', 'payout_bank_addr', 'city, country') : null,
            d.payout_method === 'ach' ? fld('Bank name *', 'payout_bank', 'e.g. Chase') : null,
            d.payout_method === 'ach' ? fld('Routing # *', 'payout_routing', '9 digits') : null,
            d.payout_method === 'ach' ? fld('Account # *', 'payout_account', '') : null,
            d.payout_method === 'crypto' ? fld('USDT TRC-20 wallet address *', 'payout_wallet', 'starts with T\u2026 (Tron network only)') : null,
            d.payout_method === 'other' ? fld('Which method, and why? *', 'payout_other', 'e.g. Wise account in my legal name \u2014 Payoneer is unavailable in my country') : null,
            h('div', { style: 'flex:1;min-width:200px' }, [h('label', { class: 'cp-lbl' }, 'Tax form *'), tax9]),
          ].filter(Boolean)),
          // PAYOUT GUIDANCE — honest about what actually works cross-border, and what it costs.
          d.payout_method ? h('div', { style: 'margin-top:10px;background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.28);border-radius:12px;padding:11px 14px;font-size:.84rem;line-height:1.65;color:#cbd5e1' },
            d.payout_method === 'payoneer' ? [h('b', null, '\u2b50 Why Payoneer'), ' \u2014 we send USD to your Payoneer account, then you withdraw to your own local bank in your own currency. Payoneer\u2019s standard withdrawal fee is a small fixed amount (about US$1.50 per withdrawal on USD accounts; currency conversion is charged separately by Payoneer). ', h('b', null, 'LoadBoot adds no fee.'), ' Open a free account at payoneer.com first, then paste that email here \u2014 it must be in the same legal name as your ID.']
            : d.payout_method === 'local_bank' ? [h('b', null, '\U0001f3e6 Your own local bank, paid through Payoneer'), ' \u2014 we send the payout through Payoneer\u2019s local transfer rail, so it lands in your normal bank account in your own currency, usually in 1\u20133 business days. Payoneer\u2019s standard fee applies (about US$1.50 fixed on USD withdrawals; currency conversion charged separately). ', h('b', null, 'The account must be a real bank account in your own legal name'), ' \u2014 mobile wallets are not banks and cannot receive it.']
            : d.payout_method === 'ach' ? [h('b', null, 'US bank (ACH)'), ' \u2014 free, arrives in 1\u20133 business days. Only for accounts held at a US bank in your legal name.']
            : d.payout_method === 'crypto' ? [h('b', null, 'USDT on the Tron (TRC-20) network only'), ' \u2014 the network fee (typically US$1\u20133) is deducted from your payout, and the exact amount is shown on the payout receipt. Send-to-wrong-network losses cannot be recovered, so the address is verified with a small test transfer before your first full payout.']
            : [h('b', null, 'Requesting another method'), ' \u2014 tell us the method and the reason. Our team reviews it and enables it only if it can legally and reliably receive an international USD payment in your name.']) : null,
          // What we cannot pay to — stated plainly so nobody wastes a payout cycle.
          d.payout_method ? h('div', { style: 'margin-top:8px;background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.3);border-radius:12px;padding:11px 14px;font-size:.83rem;line-height:1.6;color:#fcd9a2' },
            [h('b', null, '\u26a0 We cannot pay to mobile wallets.'), ' JazzCash, EasyPaisa, bKash, M-Pesa, GCash and similar local wallets cannot receive an international USD payment directly \u2014 a payout sent there is rejected or lost. Use Payoneer (it pays into your local bank for you), a US bank account, or ask us about another method. The receiving account must be in ', h('b', null, 'your own legal name'), ' \u2014 third-party accounts are refused for anti-fraud reasons.']) : null,
          // ---- substitute tax-form fields (signed by the same e-signature below) ----
          d.tax_form === 'w9' ? h('div', { style: 'margin-top:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 14px' }, [
            h('div', { style: 'font-weight:800;font-size:.88rem' }, '🧾 W-9 (substitute) — US person'),
            h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-top:8px' }, [
              (() => { const c9 = h('select', { class: 'cp-in' }, [['', 'Federal tax classification *'], ['individual', 'Individual / sole proprietor'], ['single_llc', 'Single-member LLC'], ['c_corp', 'C corporation'], ['s_corp', 'S corporation'], ['partnership', 'Partnership'], ['llc', 'LLC (C/S/P)']].map(([v9, l9]) => h('option', { value: v9 }, l9))); c9.value = d.tax_class || ''; c9.onchange = () => { d.tax_class = c9.value; }; return h('div', { style: 'flex:1;min-width:220px' }, [h('label', { class: 'cp-lbl' }, 'Tax classification *'), c9]); })(),
              fld('SSN or EIN *', 'tax_tin', 'XXX-XX-XXXX / XX-XXXXXXX'),
              fld('Business name (if different)', 'tax_biz', ''),
            ]),
            h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'Your Step-1 address is used on the form. Your e-signature below also signs this W-9 (substitute) — certification included (backup withholding & TIN correctness).'),
          ]) : null,
          d.tax_form === 'w8ben' ? h('div', { style: 'margin-top:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 14px' }, [
            h('div', { style: 'font-weight:800;font-size:.88rem' }, '🧾 W-8BEN (substitute) — non-US person'),
            h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-top:8px' }, [
              fld('Country of citizenship *', 'tax_citizen', 'e.g. Pakistan'),
              fld('Foreign tax ID (CNIC/NTN etc.)', 'tax_tin', ''),
              fld('Date of birth *', 'tax_dob', 'YYYY-MM-DD'),
            ]),
            h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'Your e-signature below also signs this W-8BEN (substitute) — certification of foreign status included.'),
          ]) : null,
          // ---- verification documents: govt ID + bank proof ----
          h('div', { style: 'margin-top:12px;background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:12px;padding:12px 14px' }, [
            h('div', { style: 'font-weight:800;font-size:.88rem' }, '📎 Verification documents (required)'),
            h('div', { class: 'cp-row-s', style: 'margin:3px 0 8px' }, 'Payouts only go to a verified identity — this protects everyone from fraud.'),
            h('div', { style: 'display:flex;gap:14px;flex-wrap:wrap' }, [
              (() => { const i9 = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.8rem' });
                const st9 = h('span', { class: 'cp-row-s' }, d.id_doc ? '✓ uploaded' : '');
                i9.onchange = async () => { let f9 = i9.files && i9.files[0]; if (!f9) return; st9.textContent = 'uploading…'; f9 = await lbShrink9(f9);
                  const try9 = async () => { const m9 = await uploadDocument(f9, 'agent_id'); d.id_doc = m9.path; d.id_doc_name = m9.fileName; st9.textContent = '✓ ' + m9.fileName; };
                  try { await try9(); } catch (e9) { await new Promise((r9) => setTimeout(r9, 1500)); try { await try9(); } catch (e8) { console.error('ID upload failed', e8); st9.textContent = '✕ ' + ((e8 && e8.message) || 'upload failed') + ' — if this mentions size, retake at lower resolution or use a screenshot; otherwise check internet and retry'; } } };
                return h('div', { style: 'flex:1;min-width:220px' }, [h('label', { class: 'cp-lbl' }, 'Government photo ID * (passport / CNIC / licence)'), i9, st9]); })(),
              (() => { const i9 = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.8rem' });
                const st9 = h('span', { class: 'cp-row-s' }, d.bank_doc ? '✓ uploaded' : '');
                i9.onchange = async () => { let f9 = i9.files && i9.files[0]; if (!f9) return; st9.textContent = 'uploading…'; f9 = await lbShrink9(f9);
                  const try9 = async () => { const m9 = await uploadDocument(f9, 'agent_bank'); d.bank_doc = m9.path; d.bank_doc_name = m9.fileName; st9.textContent = '✓ ' + m9.fileName; };
                  try { await try9(); } catch (e9) { await new Promise((r9) => setTimeout(r9, 1500)); try { await try9(); } catch (e8) { console.error('bank-proof upload failed', e8); st9.textContent = '✕ ' + ((e8 && e8.message) || 'upload failed') + ' — if this mentions size, retake at lower resolution or use a screenshot; otherwise check internet and retry'; } } };
                return h('div', { style: 'flex:1;min-width:220px' }, [h('label', { class: 'cp-lbl' }, 'Bank proof * (voided check / statement header / Payoneer screenshot)'), i9, st9]); })(),
            ]),
          ]),
          h('div', { style: 'margin-top:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 14px;max-height:190px;overflow:auto;font-size:.82rem;line-height:1.7;color:#b9c6da' }, [
            h('b', { style: 'color:#fff' }, 'LoadBoot Agent Agreement — summary (full text on loadboot.com/agents.html)'), h('br'),
            '1. Independent contractor — not an employee; you handle your own taxes (1099). ',
            '2. Commission: 1% of gross on GPS-verified DELIVERED loads only; pair-activation required; 15-day clearing; monthly payout from $100; paid from LoadBoot\u2019s own fee; nothing on cancelled/disputed loads. ',
            '3. Anti-fraud: self-referrals, fake companies or circumvention = immediate termination + forfeiture. ',
            '4. Non-circumvention: don\u2019t move chain clients off-platform. ',
            '5. No authority to bind LoadBoot; you may describe yourself only as an independent LoadBoot agent. ',
            '6. Marketing: no spam (CAN-SPAM/TCPA), truthful claims only. ',
            '7. Confidentiality of chain data. 8. Platform ToS & Privacy Policy apply. 9. Either side may end with 15-day notice; earned balance paid out.',
          ]),
          h('div', { style: 'margin-top:10px' }, [h('label', { class: 'cp-lbl' }, '✍ E-sign — type your full legal name *'), signI]),
        ]);
      }
      const backB = W.step > 0 ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { W.step--; render(); } }, '← Back') : null;
      const nextB = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev9) => {
        err9.textContent = '';
        if (W.step === 0 && (!String(d.full_name || '').trim() || String(d.phone || '').replace(/\D/g, '').length < 7 || !d.country || !String(d.street || '').trim() || !String(d.city || '').trim())) { err9.textContent = 'Name, mobile, country, street address and city are all required.'; return; }
        if (W.step < 2) { try { await agentSaveOnboarding(d, false); } catch (_) {} W.step++; render(); return; }
        if (!d.payout_method || !d.tax_form || !String(d.agreement_name || '').trim()) { err9.textContent = 'Payout method, tax form and your typed signature are required.'; return; }
        if (!String(d.payout_title || '').trim()) { err9.textContent = 'Account title is required (must match your legal name).'; return; }
        if (!d.id_doc || !d.bank_doc) { err9.textContent = 'Upload both documents — government ID and bank proof.'; return; }
        if (d.payout_method === 'ach' && (!String(d.payout_routing || '').trim() || !String(d.payout_account || '').trim() || !String(d.payout_bank || '').trim())) { err9.textContent = 'Bank name, routing and account number are required.'; return; }
        if (d.payout_method === 'payoneer' && !/.+@.+\..+/.test(String(d.payout_email || '').trim())) { err9.textContent = 'Enter the email address your Payoneer account is registered with.'; return; }
        if (d.payout_method === 'local_bank' && (!String(d.payout_bank || '').trim() || !String(d.payout_iban || '').trim() || !String(d.payout_bank_addr || '').trim())) { err9.textContent = 'Bank name, IBAN / account number and branch address are required.'; return; }
        if (d.payout_method === 'crypto') {
          const w9x = String(d.payout_wallet || '').trim();
          if (!/^T[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(w9x)) { err9.textContent = 'Enter a valid USDT TRC-20 (Tron) address — it starts with T. Other networks cannot be paid.'; return; }
        }
        // Local mobile wallets cannot receive an international USD payment — catch it before it costs someone a payout cycle.
        {
          const blob9 = [d.payout_title, d.payout_bank, d.payout_other, d.payout_email].join(' ').toLowerCase();
          if (/(jazz ?cash|easy ?paisa|easypaisa|bkash|nagad|m-?pesa|mpesa|gcash|paymaya|upaisa|sadapay|nayapay|telebirr|vodafone cash)/.test(blob9)) {
            err9.textContent = 'Mobile wallets (JazzCash, EasyPaisa, bKash, M-Pesa, GCash…) cannot receive international USD payouts. Use Payoneer — it deposits into your own local bank for you.'; return;
          }
        }
        if (d.payout_method === 'other' && !String(d.payout_other || '').trim()) { err9.textContent = 'Describe your payout method.'; return; }
        if (d.tax_form === 'w9' && (!d.tax_class || !String(d.tax_tin || '').trim())) { err9.textContent = 'W-9: tax classification and SSN/EIN are required.'; return; }
        if (d.tax_form === 'w8ben' && (!String(d.tax_citizen || '').trim() || !String(d.tax_dob || '').trim())) { err9.textContent = 'W-8BEN: country of citizenship and date of birth are required.'; return; }
        const b9 = ev9.currentTarget; b9.disabled = true; b9.textContent = 'Submitting…';
        try {
          d.payout_details = { account_title: d.payout_title || null, bank_name: d.payout_bank || null, email: d.payout_email || null, routing: d.payout_routing || null, account: d.payout_account || null, wallet: d.payout_wallet || null, wallet_network: d.payout_method === 'crypto' ? 'TRC-20' : null, iban: d.payout_iban || null, swift: d.payout_swift || null, bank_address: d.payout_bank_addr2 || d.payout_bank_addr || null, other: d.payout_other || null, id_doc: d.id_doc || null, id_doc_name: d.id_doc_name || null, bank_doc: d.bank_doc || null, bank_doc_name: d.bank_doc_name || null, tax: { form: d.tax_form || null, classification: d.tax_class || null, tin: d.tax_tin || null, business_name: d.tax_biz || null, citizenship: d.tax_citizen || null, dob: d.tax_dob || null } };
          d.tax_id_last4 = String(d.tax_tin || '').replace(/\D/g, '').slice(-4) || null;
          await agentSaveOnboarding(d, true);
          location.reload();
        } catch (e9) { b9.disabled = false; b9.textContent = 'Submit for review'; err9.textContent = (e9 && e9.message) || 'Failed.'; }
      } }, W.step < 2 ? 'Next →' : 'Submit for review');
      mount(content, h('div', null, [agCard('🛡 Verification Center — 3 steps, 5 minutes', [
        h('div', { class: 'cp-row-s', style: 'margin-bottom:10px' }, 'Verification unlocks earnings: LoadBoot dispatch approves every agent (usually <24h). Your link already works — joins are recorded; commissions release at approval.'),
        obStatus === 'info_needed' ? stEl('⚠ MORE INFO NEEDED', (obProfile && obProfile.review_note) || '', 'warn') : null,
        bar9, body9, err9,
        h('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [backB, nextB].filter(Boolean)),
      ].filter(Boolean)), trackerCard9(), threadCard9()]));
    } else if (tab === 'post') {
      if (isVerified && feed.own_broker_org) {
        mount(content, h('div', null, [
          h('div', { class: 'cp-row-s', style: 'margin-bottom:8px;background:rgba(252,83,5,.08);border:1px solid rgba(252,83,5,.3);border-radius:11px;padding:9px 12px;font-weight:700' },
            '📦 The FULL broker wizard, right here in your workspace (“' + (feed.name || 'Agent') + ' (Agent)”) — multi-stop, schedule, rate card, 🎯 direct-carrier targeting. Every post carries your LOAD SOURCE details and is reviewed by dispatch. When it DELIVERS, your 1% lands automatically. ' ),
          h('iframe', { src: '/app/partner/#post', style: 'width:100%;height:calc(100vh - 210px);min-height:640px;border:0;border-radius:16px;background:#0d1526' }),
          h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, [
            'Prefer a full tab? ', h('a', { href: '/app/partner/#post', target: '_blank', rel: 'noopener', style: 'color:#7cc0ff;font-weight:700' }, 'Open the workspace in a new tab →'),
          ]),
        ]));
      } else {
        mount(content, agCard('📦 Post a load', [
          h('div', { class: 'cp-row-s', style: 'line-height:1.8' }, '🔒 Unlocks after verification: once LoadBoot approves your agent application (Get Verified tab), you get your own posting workspace — the same wizard brokers use, with direct-carrier targeting for your referred carriers. A load you post counts as the DEMAND side of your pair.'),
          h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: () => go('verify') }, '🛡 Go to Get Verified →'),
        ]));
      }
    } else if (tab === 'chain') {
      const CH = window.__agch = window.__agch || { q: '', side: 'all', sort: 'newest', show: 30 };
      const all9 = Array.isArray(feed.chain) ? feed.chain.slice() : [];
      const now9 = Date.now();
      const days9 = (x9) => x9.last_activity ? Math.round((now9 - new Date(x9.last_activity).getTime()) / 86400000) : 999;
      const health9 = (x9) => { const dd9 = days9(x9); const nn9 = (now9 - new Date(x9.joined_at || 0).getTime()) / 86400000;
        return nn9 < 7 && !(x9.trips_delivered || 0) ? ['🆕 NEW', 'rgba(8,131,247,.15)', '#3b9dff']
          : dd9 <= 7 ? ['🔥 ACTIVE', 'rgba(34,197,94,.15)', '#4ade80']
          : dd9 <= 30 ? ['🌤 QUIET ' + dd9 + 'd', 'rgba(245,158,11,.15)', '#fbbf24']
          : ['😴 IDLE ' + dd9 + 'd', 'rgba(239,68,68,.15)', '#f87171']; };
      // KPI strip
      const act9 = all9.filter((x9) => days9(x9) <= 7).length, idle9 = all9.filter((x9) => days9(x9) > 30).length;
      const earnTot9 = all9.reduce((a9, x9) => a9 + Number(x9.your_earnings || 0), 0);
      // filter/sort
      let list9 = all9.filter((x9) => (CH.side === 'all' || x9.side === CH.side)
        && (!CH.q || String(x9.org || '').toLowerCase().includes(CH.q.toLowerCase())));
      if (CH.sort === 'newest') list9.sort((a9, b9) => new Date(b9.joined_at || 0) - new Date(a9.joined_at || 0));
      else if (CH.sort === 'earnings') list9.sort((a9, b9) => Number(b9.your_earnings || 0) - Number(a9.your_earnings || 0));
      else if (CH.sort === 'delivered') list9.sort((a9, b9) => (b9.trips_delivered || 0) - (a9.trips_delivered || 0));
      else if (CH.sort === 'idle') list9.sort((a9, b9) => days9(b9) - days9(a9));
      const qIn9 = h('input', { class: 'cp-in', placeholder: '🔍 Search your clients…', style: 'margin:0;flex:1;min-width:180px' });
      qIn9.value = CH.q; qIn9.oninput = () => { CH.q = qIn9.value; render(); };
      const mkSel9 = (val9, opts9, on9, w9) => { const e9 = h('select', { class: 'cp-in', style: 'margin:0;flex:none;width:' + (w9 || '150px') }, opts9.map(([v9, l9]) => h('option', { value: v9 }, l9))); e9.value = val9; e9.onchange = () => on9(e9.value); return e9; };
      const nudge9 = (x9) => x9.side === 'shipper'
        ? 'Hi! Your freight can be on a verified truck within hours — request a shipment on LoadBoot and brokers quote it with GPS tracking + documented settlement built in: loadboot.com/app/partner/ — I\u2019ll watch it personally.'
        : x9.side === 'carrier'
        ? 'Salaam! Quick one — the board has fresh ' + '(your lanes)' + ' loads today, zero ghost posts, detention auto-paid with GPS proof. Jump in: loadboot.com/app/carrier/ — I\u2019m here if you need anything.'
        : 'Hi! Reminder — posting on LoadBoot takes 2 minutes and verified carriers book in one tap (GPS tracking + auto paperwork included). Post one today: loadboot.com/app/partner/ — I\u2019ll personally watch it get covered.';
      const row9x = (x9) => { const hb9 = health9(x9); return h('div', { style: 'border:1px solid rgba(255,255,255,.1);border-radius:13px;padding:12px 14px;margin-top:8px;background:rgba(255,255,255,.03)' }, [
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, [
          h('div', { style: 'flex:1;min-width:200px' }, [
            h('div', { style: 'font-weight:800;font-size:.95rem' }, sideIc9(x9.side) + ' ' + (x9.org || '')),
            h('div', { class: 'cp-row-s' }, sideLb9(x9.side) + ' · joined ' + (x9.joined_at ? new Date(x9.joined_at).toLocaleDateString() : '') + ' · last activity ' + (days9(x9) >= 999 ? '—' : days9(x9) === 0 ? 'today' : days9(x9) + 'd ago')),
          ]),
          h('span', { class: 'cp-pill', style: 'background:' + hb9[1] + ';color:' + hb9[2] + ';font-weight:800' }, hb9[0]),
          h('b', { style: 'color:#4ade80;font-size:1.02rem' }, money9(x9.your_earnings)),
        ]),
        h('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;margin-top:8px' }, [
          h('span', { class: 'cp-row-s' }, '📦 ' + (x9.loads_posted || 0) + ' posted'),
          h('span', { class: 'cp-row-s' }, '✓ ' + (x9.trips_delivered || 0) + ' delivered'),
          h('span', { style: 'flex:1' }),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { window.__agLoadFilter = x9.org; go('loads'); } }, '📦 View loads'),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev9) => { try { await navigator.clipboard.writeText(nudge9(x9)); ev9.currentTarget.textContent = 'Copied ✓'; setTimeout(() => { ev9.currentTarget.textContent = '👋 Nudge'; }, 1400); } catch (_) { alert(nudge9(x9)); } } }, '👋 Nudge'),
        ]),
      ]); };
      mount(content, h('div', null, [
        banner9(), h('div', { style: 'height:12px' }),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px' }, [
          tile9('Clients', String(all9.length)), tile9('Active 7d', String(act9), true), tile9('Idle 30d+', String(idle9)), tile9('Earned total', money9(earnTot9), true)]),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px' }, [
          qIn9,
          mkSel9(CH.side, [['all', 'All sides'], ['carrier', '🚛 Carriers'], ['broker', '🏢 Brokers'], ['shipper', '🏭 Shippers']], (v9) => { CH.side = v9; render(); }),
          mkSel9(CH.sort, [['newest', 'Newest first'], ['earnings', '💰 Top earnings'], ['delivered', '✓ Most delivered'], ['idle', '😴 Idle first']], (v9) => { CH.sort = v9; render(); }, '170px'),
        ]),
        list9.length ? h('div', null, list9.slice(0, CH.show).map(row9x)) : h('div', { class: 'cp-muted', style: 'margin-top:10px' }, all9.length ? 'No client matches that search/filter.' : 'Nobody yet — copy an invite from the Dashboard link card and send it to the broker or carrier you already know.'),
        list9.length > CH.show ? h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:10px', onClick: () => { CH.show += 50; render(); } }, '↓ Show ' + Math.min(50, list9.length - CH.show) + ' more (' + (list9.length - CH.show) + ' left)') : null,
        h('div', { class: 'cp-row-s', style: 'margin-top:12px;background:rgba(8,131,247,.07);border-radius:10px;padding:9px 12px' }, '💡 Pro move: sort by 😴 Idle first once a week and Nudge everyone quiet for 14+ days — reactivated clients are the cheapest money in this business.'),
      ].filter(Boolean)));
    } else if (tab === 'loads') {
      const LD = window.__agld = window.__agld || { q: '', st: 'all', side: 'all', sort: 'newest', show: 30 };
      if (window.__agLoadFilter) { LD.q = window.__agLoadFilter; window.__agLoadFilter = ''; }
      const all9 = Array.isArray(feed.loads) ? feed.loads.slice() : [];
      const stOf9 = (x9) => x9.delivered_at ? 'delivered' : x9.trip_status ? 'booked' : 'posted';
      let list9 = all9.filter((x9) =>
        (LD.st === 'all' || stOf9(x9) === LD.st)
        && (LD.side === 'all'
          || (LD.side === 'own' && x9.own_post)
          || (LD.side === 'broker' && x9.broker_yours && !x9.own_post)
          || (LD.side === 'carrier' && x9.booked_by_yours)
          || (LD.side === 'double' && x9.broker_yours && x9.booked_by_yours))
        && (!LD.q || ((x9.lane || '') + ' ' + (x9.broker || '') + ' ' + (x9.booked_by || '')).toLowerCase().includes(LD.q.toLowerCase())));
      if (LD.sort === 'newest') list9.sort((a9, b9) => new Date(b9.posted_at || 0) - new Date(a9.posted_at || 0));
      else if (LD.sort === 'rate') list9.sort((a9, b9) => Number(b9.rate || 0) - Number(a9.rate || 0));
      else if (LD.sort === 'cut') list9.sort((a9, b9) => Number(b9.your_commission || 0) - Number(a9.your_commission || 0));
      const cnt9 = { posted: 0, booked: 0, delivered: 0 }; let cutT9 = 0;
      all9.forEach((x9) => { cnt9[stOf9(x9)]++; cutT9 += Number(x9.your_commission || 0); });
      const qIn9 = h('input', { class: 'cp-in', placeholder: '🔍 Search lane or company…', style: 'margin:0;flex:1;min-width:170px' });
      qIn9.value = LD.q; qIn9.oninput = () => { LD.q = qIn9.value; render(); };
      const mkSel9 = (val9, opts9, on9, w9) => { const e9 = h('select', { class: 'cp-in', style: 'margin:0;flex:none;width:' + (w9 || '150px') }, opts9.map(([v9, l9]) => h('option', { value: v9 }, l9))); e9.value = val9; e9.onchange = () => on9(e9.value); return e9; };
      const fmtD9 = (x9) => x9 ? new Date(x9).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const row9 = (x9) => {
        const st9 = stOf9(x9);
        const clearBy9 = x9.delivered_at ? new Date(new Date(x9.delivered_at).getTime() + 15 * 86400000) : null;
        return h('div', { style: 'border:1px solid rgba(255,255,255,.1);border-radius:13px;padding:12px 14px;margin-top:8px;background:rgba(255,255,255,.03)' }, [
          h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, [
            h('div', { style: 'flex:1;min-width:210px' }, [
              h('div', { style: 'font-weight:800;font-size:.95rem' }, (x9.lane || '') + (x9.rate ? ' · $' + Number(x9.rate).toLocaleString() : '')),
              h('div', { class: 'cp-row-s' }, [
                x9.own_post ? '📝 YOUR post' : ('🏢 ' + (x9.broker || '—') + (x9.broker_yours ? ' ★yours' : '')),
                x9.booked_by ? ' · 🚛 ' + x9.booked_by + (x9.booked_by_yours ? ' ★YOURS' : '') : '',
                (x9.broker_yours || x9.own_post) && x9.booked_by_yours ? ' · ⚡ double chain' : '',
              ].join('')),
            ]),
            st9 === 'delivered' ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80;font-weight:800' }, '✓ DELIVERED')
              : st9 === 'booked' ? h('span', { class: 'cp-pill', style: 'background:rgba(8,131,247,.15);color:#3b9dff;font-weight:800' }, '🚛 MOVING')
              : h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.15);color:#fbbf24;font-weight:800' }, '📦 ON BOARD'),
          ]),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:.74rem;color:#8fa3bf;font-weight:700' }, [
            h('span', null, '📦 posted ' + fmtD9(x9.posted_at)),
            x9.booked_at ? h('span', null, '→ 🚛 booked ' + fmtD9(x9.booked_at)) : null,
            x9.delivered_at ? h('span', null, '→ ✓ delivered ' + fmtD9(x9.delivered_at)) : null,
            h('span', { style: 'flex:1' }),
            Number(x9.your_commission) ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.14);color:#4ade80;font-weight:800' }, '💰 your 1% = ' + money9(x9.your_commission) + (clearBy9 && clearBy9 > new Date() ? ' · clears ~' + fmtD9(clearBy9) : ' · cleared'))
              : st9 === 'delivered' ? h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.14);color:#fbbf24' }, '⏳ 1% crediting…') : null,
          ].filter(Boolean)),
        ]);
      };
      mount(content, h('div', null, [
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px' }, [
          tile9('Loads', String(all9.length)), tile9('On board', String(cnt9.posted)), tile9('Moving', String(cnt9.booked)), tile9('Delivered', String(cnt9.delivered), true), tile9('Your cut (these)', money9(cutT9), true)]),
        h('div', { class: 'cp-row-s', style: 'background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.22);border-radius:11px;padding:9px 12px;margin-bottom:8px;font-weight:700' },
          '💰 Money flow: ✓ DELIVERED → 1% auto-credits your account → 15-day clearing → PAYABLE → payout request unlocks at $100 (Payouts tab). Fully automatic — you do nothing.'),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px' }, [
          qIn9,
          mkSel9(LD.st, [['all', 'All statuses'], ['posted', '📦 On board'], ['booked', '🚛 Moving'], ['delivered', '✓ Delivered']], (v9) => { LD.st = v9; render(); }),
          mkSel9(LD.side, [['all', 'All involvement'], ['own', '📝 My posts'], ['broker', '🏢 My brokers'], ['carrier', '🚛 My carriers'], ['double', '⚡ Double chain']], (v9) => { LD.side = v9; render(); }, '170px'),
          mkSel9(LD.sort, [['newest', 'Newest'], ['rate', '$ Rate'], ['cut', '💰 My cut']], (v9) => { LD.sort = v9; render(); }, '120px'),
        ]),
        list9.length ? h('div', null, list9.slice(0, LD.show).map(row9)) : h('div', { class: 'cp-muted', style: 'margin-top:10px' }, all9.length ? 'No loads match this filter.' : 'Loads your clients post or haul appear here live: ON BOARD → MOVING → DELIVERED (+ your cut).'),
        list9.length > LD.show ? h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:10px', onClick: () => { LD.show += 50; render(); } }, '↓ Show ' + Math.min(50, list9.length - LD.show) + ' more (' + (list9.length - LD.show) + ' left)') : null,
      ].filter(Boolean)));
    } else if (tab === 'earnings') {
      const hostE = agCard('💰 Commission ledger', [h('div', { class: 'cp-muted' }, 'Loading…')]);
      mount(content, h('div', null, [
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px' }, [tile9('Clearing', money9(tt.accrued)), tile9('Payable', money9(tt.payable), true), tile9('Paid', money9(tt.paid), true)]),
        hostE]));
      try {
        const rows = (await myReferralEarnings(100)) || [];
        mount(hostE, [h('div', { class: 'cp-cardhead' }, [h('h3', null, '💰 Commission ledger')]),
          rows.length ? h('div', null, rows.map((x) => h('div', { class: 'cp-row' }, [
            h('div', null, [h('div', { class: 'cp-row-t' }, money9(x.amount) + ' · ' + ((x.level || 1) === 1 ? 'direct client (1%)' : 'level ' + x.level + ' override — recruited agent\u2019s chain')), h('div', { class: 'cp-row-s' }, (x.source || x.source_org || '') + ' · ' + (x.accrued_at ? new Date(x.accrued_at).toLocaleDateString() : ''))]),
            pill(x.status)]))) : h('div', { class: 'cp-muted' }, 'Commissions appear here per delivered load — 1% of gross, 15-day clearing, then payable.')]);
      } catch (_) { mount(hostE, [h('div', { class: 'cp-cardhead' }, [h('h3', null, '💰 Commission ledger')]), h('div', { class: 'cp-muted' }, 'Could not load.')]); }
    } else if (tab === 'payouts') {
      const hostP = h('div');
      mount(content, hostP);
      (async () => {
        let pc; try { pc = await agentPayoutCenter(); } catch (e9) { mount(hostP, agCard('🏦 Payout Center', [h('div', { class: 'cp-muted' }, (e9 && e9.message) || 'Could not load.')])); return; }
        if (!pc || !pc.has_code) { mount(hostP, agCard('🏦 Payout Center', [h('div', { class: 'cp-muted' }, 'No agent account.')])); return; }
        const pct9 = Math.min(100, Math.round(Number(pc.payable || 0) / Number(pc.min_required || 100) * 100));
        const reqBtn = pc.eligible ? h('button', { class: 'cp-btn', style: 'background:#16a34a;font-size:1.02rem;padding:14px 26px', onClick: async (ev9) => {
          if (!confirm('Request payout of ' + money9(pc.payable) + ' to your verified account on file?')) return;
          const b9 = ev9.currentTarget; b9.disabled = true; b9.textContent = 'Requesting…';
          try { const r9 = await agentRequestPayout(); lbToast((r9 && r9.note) || 'Requested.', 'success', '💸 Payout requested'); render(); }
          catch (e9) { b9.disabled = false; b9.textContent = '💸 Request payout — ' + money9(pc.payable); lbToast((e9 && e9.message) || 'Failed.', 'urgent'); }
        } }, '💸 Request payout — ' + money9(pc.payable)) : null;
        const stMap9 = { requested: ['🕐 REQUESTED — under review', 'rgba(245,158,11,.15)', '#fbbf24'], approved: ['✅ APPROVED — transfer being prepared', 'rgba(8,131,247,.15)', '#3b9dff'], sent: ['💸 SENT — 3–5 business days to your bank', 'rgba(8,131,247,.18)', '#7cc0ff'], paid: ['💸 SENT — 3–5 business days to your bank', 'rgba(8,131,247,.18)', '#7cc0ff'], received: ['✓ RECEIVED', 'rgba(34,197,94,.15)', '#4ade80'], rejected: ['✕ REJECTED', 'rgba(239,68,68,.15)', '#f87171'] };
        const reqRows9 = (Array.isArray(pc.requests) ? pc.requests : []).map((r9) => { const m9 = stMap9[r9.status] || [r9.status, 'rgba(148,163,184,.15)', '#94a3b8'];
          return h('div', { style: 'border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px 13px;margin-top:8px;background:rgba(255,255,255,.03)' }, [
            h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, [
              h('div', { style: 'flex:1;min-width:170px' }, [
                h('div', { style: 'font-weight:900;font-size:1.05rem' }, money9(r9.amount)),
                h('div', { class: 'cp-row-s' }, (r9.bank_name || '') + ' ···' + (r9.last4 || '') + ' · requested ' + (r9.requested_at ? new Date(r9.requested_at).toLocaleDateString() : '') + (r9.note ? ' · ' + r9.note : '')),
              ]),
              h('span', { class: 'cp-pill', style: 'background:' + m9[1] + ';color:' + m9[2] + ';font-weight:800' }, m9[0]),
              (r9.status === 'paid' || r9.status === 'sent' || r9.status === 'approved') ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
                try { await agentConfirmPayoutReceived(r9.id); lbToast('Confirmed — thank you!', 'success', '✓ Received'); render(); } catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent'); }
              } }, '✓ I received it') : null,
            ].filter(Boolean)),
          ]); });
        mount(hostP, h('div', null, [
          h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px' }, [
            tile9('Available for payout', money9(pc.payable), true), tile9('In clearing (15d)', money9(pc.accrued)), tile9('Paid out — lifetime', money9(pc.paid), true),
            pc.next_clearing ? tile9('Next release', new Date(pc.next_clearing).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) : null].filter(Boolean)),
          pc.eligible
            ? h('div', { style: 'background:rgba(34,197,94,.1);border:1.5px solid rgba(34,197,94,.45);border-radius:14px;padding:16px 18px;margin-bottom:12px;text-align:center' }, [
                h('div', { style: 'font-weight:900;font-size:1.05rem;color:#4ade80;margin-bottom:10px' }, '✅ You are ELIGIBLE — money is ready to move'), reqBtn,
                h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'Goes to your verified account on file · reviewed by a person · bank transfers land in 3–5 business days after SENT.')])
            : h('div', { style: 'background:rgba(245,158,11,.09);border:1.5px solid rgba(245,158,11,.4);border-radius:14px;padding:14px 16px;margin-bottom:12px' }, [
                h('div', { style: 'font-weight:900;color:#fbbf24' }, '⏳ Not eligible yet — here is exactly why:'),
                ...(Array.isArray(pc.reasons) ? pc.reasons : []).map((x9) => h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, (x9.icon || '•') + ' ' + (x9.text || ''))),
                h('div', { style: 'height:7px;border-radius:99px;background:rgba(255,255,255,.08);margin-top:12px;overflow:hidden' },
                  h('div', { style: 'height:100%;width:' + pct9 + '%;border-radius:99px;background:linear-gradient(90deg,#FC5305,#4ade80)' })),
                h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, money9(pc.payable) + ' of ' + money9(pc.min_required) + ' minimum (' + pct9 + '%)')]),
          pc.bank ? agCard('🏦 Payout account on file', [
            h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Method'), h('b', null, (pc.bank.method || '—').toUpperCase())]),
            pc.bank.title ? h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Account title'), h('span', null, pc.bank.title)]) : null,
            pc.bank.bank_name ? h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Bank'), h('span', null, pc.bank.bank_name)]) : null,
            h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Account'), h('span', null, '···' + (pc.bank.last4 || '——'))]),
            h('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
              pc.bank.verified ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80' }, '✓ Verified by LoadBoot') : h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.15);color:#fbbf24' }, '⏳ pending verification'),
              pc.bank.docs_ok ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80' }, '📎 ID + bank proof on file') : h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.15);color:#f87171' }, '📎 documents missing'),
              h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => go('verify') }, '✎ Update account'),
            ].filter(Boolean)),
            h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, '🔒 Payouts only ever go to this verified account — nobody can redirect your money.'),
          ].filter(Boolean)) : agCard('🏦 Payout account', [h('div', { class: 'cp-row-s' }, 'No account on file yet — add it in Get Verified step 3.'), h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: () => go('verify') }, '🛡 Add payout account →')]),
          agCard('📜 Payout history & tracking', reqRows9.length ? reqRows9 : [h('div', { class: 'cp-muted' }, 'No payouts yet. Flow: REQUESTED → APPROVED → 💸 SENT (3–5 business days) → ✓ you confirm RECEIVED.')]),
        ]));
      })();
    } else if (tab === 'resources') {
      mount(content, h('div', null, [
        linkCard(),
        agCard('📚 How the program works', [
          h('div', { class: 'cp-row-s', style: 'line-height:1.8' }, '1% of gross on every GPS-verified DELIVERED load your chain touches · pair (broker + carrier) activates earnings · 15-day clearing window · monthly payouts from $100 · your cut comes out of LoadBoot’s own fee — your clients never pay extra · full program details: loadboot.com/agents.html'),
        ]),
      ]));
    } else if (tab === 'settings') {
      const kv9 = (k9, v9) => h('div', { style: 'display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:.86rem' }, [h('span', { class: 'cp-row-s' }, k9), h('b', { style: 'text-align:right;word-break:break-word' }, v9 || '—')]);
      const stMap9 = { approved: ['#4ade80', '✅ Verified'], under_review: ['#fbbf24', '⏳ Under review'], info_needed: ['#fbbf24', '✋ Info needed'], rejected: ['#f87171', '✕ Not approved'], draft: ['#94a3b8', '📝 Not submitted'] };
      const st9 = stMap9[obStatus] || stMap9.draft;
      mount(content, h('div', null, [
        agCard('👤 Account', [
          kv9('Name', (obProfile && obProfile.full_name) || feed.name),
          kv9('Email', (user && user.email) || ''),
          kv9('Agent code', feed.code || ''),
          kv9('Referral link', 'loadboot.com/?ref=' + (feed.code || '')),
          kv9('Phone', obProfile && obProfile.phone),
          kv9('Location', [obProfile && obProfile.city, obProfile && obProfile.state, obProfile && obProfile.country].filter(Boolean).join(', ')),
          kv9('Agent since', (obProfile && obProfile.created_at) ? new Date(obProfile.created_at).toLocaleDateString() : ''),
        ]),
        agCard('🛡 Verification & payout account', [
          h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [
            h('span', { class: 'cp-pill', style: 'font-weight:800;color:' + st9[0] }, st9[1]),
            h('button', { class: 'cp-btn', onClick: () => go('verify') }, isVerified ? 'View / update details' : 'Open Verification Center'),
          ]),
          h('div', { class: 'cp-row-s', style: 'margin-top:9px;line-height:1.6' }, 'Your payout method, bank details, tax form and verification documents all live in the Verification Center. Any change to bank details goes through a quick review so payouts stay safe.'),
        ]),
        agCard('📄 My signed documents', [
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
            h('button', { class: 'cp-btn-ghost', onClick: agreementPdf9 }, '⬇ Agent Agreement (signed PDF)'),
            h('button', { class: 'cp-btn-ghost', onClick: taxPdf9 }, '⬇ Tax form (signed PDF)'),
            h('button', { class: 'cp-btn-ghost', onClick: rulesModal9 }, '📖 Program rules & policies'),
          ]),
        ]),
        agCard('🔒 Security', [
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
            h('button', { class: 'cp-btn-ghost', onClick: async (ev) => { const b9 = ev.currentTarget; b9.disabled = true; try { const r9 = await resetPassword((user && user.email) || ''); if (r9 && r9.error) throw r9.error; b9.textContent = '✓ Reset link sent to your email'; } catch (_) { b9.textContent = 'Could not send — try again later'; b9.disabled = false; } } }, 'Send password-reset email'),
            h('button', { class: 'cp-btn-ghost', onClick: async (ev) => { ev.currentTarget.disabled = true; await signOut(); location.reload(); } }, 'Sign out'),
          ]),
          h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'We never ask for your password by email or phone. Payout bank changes always require re-verification.'),
        ]),
        agCard('💬 Support', [
          h('div', { class: 'cp-row-s', style: 'line-height:1.7' }, 'Program or account questions: hello@loadboot.com — or message the review team any time from the Verification Center thread. Full program details: loadboot.com/agents.html'),
        ]),
      ]));
    }
  }
  function go(id) { tab = id; if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    Object.entries(links).forEach(([k9, a9]) => a9.classList.toggle('active', k9 === tab));
    Object.entries(tabLinks).forEach(([k9, a9]) => a9.classList.toggle('active', k9 === tab));
    const it = AGNAV.find((n) => n[0] === tab); titleEl.textContent = it ? it[1] : 'Dashboard';
    (async () => { try { feed = (await agentFeed()) || feed; } catch (_) {} render(); })();
  }
  // ---- 🔔 notification bell (top-right): commissions, chain joins, payout + doc updates ----
  const agBellBadge = h('span', { class: 'cp-bell-badge', hidden: true });
  const agBellList = h('div', { style: 'max-height:380px;overflow:auto' });
  const agBellPanel = h('div', { hidden: true, style: 'position:absolute;top:44px;right:0;width:min(360px,86vw);background:#0f1b30;border:1px solid rgba(255,255,255,.14);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);z-index:60;overflow:hidden;text-align:left' }, [
    h('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.09)' }, [
      h('b', { style: 'font-size:.85rem' }, '🔔 Notifications'),
      h('button', { class: 'cp-btn-ghost', style: 'font-size:.72rem;padding:4px 8px', onClick: async () => { try { await pocketMarkAllNotificationsRead(); } catch (_) {} agLoadBell(); } }, 'Mark all read'),
    ]),
    agBellList,
  ]);
  async function agLoadBell() {
    let ns9 = []; try { ns9 = (await pocketNotifications(30)) || []; } catch (_) {}
    const un9 = ns9.filter((n) => !n.read_at).length;
    agBellBadge.hidden = un9 === 0; agBellBadge.textContent = un9 > 9 ? '9+' : String(un9);
    mount(agBellList, ns9.length ? h('div', null, ns9.map((n) => {
      const p9 = n.payload || {};
      return h('button', { style: 'display:block;width:100%;text-align:left;background:' + (n.read_at ? 'transparent' : 'rgba(8,131,247,.09)') + ';border:0;border-bottom:1px solid rgba(255,255,255,.06);padding:10px 14px;cursor:pointer;color:inherit;font:inherit', onClick: async () => { try { await pocketMarkNotificationRead(n.id); } catch (_) {} agLoadBell(); } }, [
        h('div', { style: 'font-weight:800;font-size:.82rem' }, p9.title || n.template_key || 'Update'),
        p9.body ? h('div', { class: 'cp-row-s', style: 'margin-top:2px;line-height:1.5' }, String(p9.body).slice(0, 160)) : null,
        h('div', { class: 'cp-row-s', style: 'margin-top:3px;opacity:.7;font-size:.68rem' }, new Date(n.created_at).toLocaleString()),
      ].filter(Boolean));
    })) : h('div', { class: 'cp-row-s', style: 'padding:18px 14px;text-align:center' }, 'Nothing yet — commissions, chain joins, payout and verification updates land here.'));
  }
  const agBell = h('button', { class: 'cp-iconbtn cp-bell', title: 'Notifications', style: 'position:relative', onClick: () => { agBellPanel.hidden = !agBellPanel.hidden; if (!agBellPanel.hidden) agLoadBell(); } }, [icon('bell', 20), agBellBadge]);
  const agBellWrap = h('div', { style: 'position:relative;display:inline-flex' }, [agBell, agBellPanel]);
  agLoadBell(); try { setInterval(agLoadBell, 60000); } catch (_) {}
  document.addEventListener('click', (e9) => { if (!agBellWrap.contains(e9.target)) agBellPanel.hidden = true; });
  // ⏳/✅ PAIR EXPLAINER — tap the header pill: what the pair is, YOUR live status, how it links to earnings
  async function pairModal9() {
    let cs9 = null; try { cs9 = await agentChainStatus(); } catch (_) {}
    const refs9 = (cs9 && cs9.referred) || [];
    const car9 = refs9.filter((r9) => r9.side === 'carrier');
    const dem9 = refs9.filter((r9) => r9.side !== 'carrier');
    const ownPosts9 = Number((feed && (feed.my_loads_posted || feed.loads_posted)) || 0);
    const demandOk9 = dem9.length > 0 || ownPosts9 > 0;
    const active9 = !!(cs9 ? cs9.pair_active : feed.pair_active);
    let close9 = null;
    const sideBox9 = (ok9, ic9, t9, lines9) => h('div', { style: 'flex:1;min-width:220px;border-radius:14px;padding:14px;border:1.5px solid ' + (ok9 ? 'rgba(34,197,94,.4)' : 'rgba(245,158,11,.4)') + ';background:' + (ok9 ? 'rgba(34,197,94,.07)' : 'rgba(245,158,11,.06)') }, [
      h('div', { style: 'font-size:1.3rem' }, ic9 + (ok9 ? ' ✅' : ' ⏳')),
      h('div', { style: 'font-weight:900;margin-top:4px;color:#fff' }, t9),
      h('div', { class: 'cp-row-s', style: 'margin-top:5px;line-height:1.65' }, lines9),
    ]);
    close9 = openModal(active9 ? '✅ Your chain is ACTIVE — earning is ON' : '⏳ Pair pending — one step from earning', [
      h('div', { class: 'cp-row-s', style: 'line-height:1.7;margin-bottom:12px' },
        'Think of it like a marketplace stall: you need SUPPLY (a truck) and DEMAND (freight). The moment you have BOTH, every GPS-verified delivered load your people touch pays you 1% of the gross — automatically, from LoadBoot\u2019s own fee. One side alone earns nothing yet, but nothing is lost: joins are recorded and your link keeps working.'),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        sideBox9(car9.length > 0, '🚛', 'Side 1 — a CARRIER (the truck)', car9.length
          ? 'You have ' + car9.length + ': ' + car9.map((r9) => r9.org).slice(0, 3).join(', ') + (car9.length > 3 ? '…' : '')
          : 'No carrier yet — share your link with any trucking company. The moment one signs up through it, this box turns green.'),
        sideBox9(demandOk9, '🏢', 'Side 2 — DEMAND (the freight)', demandOk9
          ? (dem9.length ? 'You have ' + dem9.length + ' broker/shipper: ' + dem9.map((r9) => r9.org).slice(0, 3).join(', ') + (dem9.length > 3 ? '…' : '') : 'You post loads yourself — that counts as your demand side.')
          : 'No freight side yet — refer a broker or shipper with your link, OR post a load yourself from the Post a Load tab. Either one turns this green.'),
      ]),
      h('div', { style: 'margin-top:12px;border-radius:12px;padding:12px 14px;background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3)' }, [
        h('div', { style: 'font-weight:800;color:#93c5fd' }, active9 ? '💰 What happens now' : '💰 What happens the moment both are green'),
        h('div', { class: 'cp-row-s', style: 'margin-top:4px;line-height:1.7' },
          '1) A load is GPS-verified DELIVERED where any side is yours → 2) 1% of the gross lands in Earnings within the half hour (🔔 + email) → 3) it clears in 15 days → 4) from $100 you request a payout in the Payouts tab. Your clients never pay extra — your cut comes out of LoadBoot\u2019s own 5% fee.'),
      ]),
      h('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [
        h('button', { class: 'cp-btn', onClick: () => { try { navigator.clipboard.writeText((cs9 && cs9.link) || ('https://loadboot.com/?ref=' + (feed.code || ''))); } catch (_) {} } }, '🔗 Copy my link — one link for every side'),
        h('button', { class: 'cp-btn-ghost', onClick: () => { if (close9) close9(); go('chain'); } }, 'Open My Chain'),
        h('button', { class: 'cp-btn-ghost', onClick: rulesModal9 }, '📖 Full rules'),
      ]),
    ]);
  }
  // ---- Mobile side drawer (same inDrive pattern as the carrier shell): profile + FULL menu + sign out ----
  function openAgDrawer() {
    const scrim9 = h('div', { class: 'cpx-scrim' });
    const k9 = feed.kpis || {}; const tt9 = feed.totals || {};
    const dStat9 = (label9, val9, goto9) => h('button', { class: 'cpx-d-stat', onClick: () => { close9(); go(goto9); } }, [h('b', null, val9), h('span', null, label9)]);
    const items9 = AGNAV.map(([id9, label9, ic9]) => h('button', { class: 'cpx-d-item' + (tab === id9 ? ' active' : ''), onClick: () => { close9(); go(id9); } }, [
      icon(ic9, 20), h('span', null, label9),
    ]));
    const drawer9 = h('aside', { class: 'cpx-drawer' }, [
      h('div', { class: 'cpx-d-head', onClick: () => { close9(); go('settings'); } }, [
        h('div', { class: 'cpx-d-ava' }, (feed.name || 'A').trim().charAt(0).toUpperCase()),
        h('div', { style: 'min-width:0;flex:1' }, [
          h('div', { class: 'cpx-d-name' }, feed.name || 'Agent'),
          h('div', { class: 'cpx-d-rating' }, isVerified ? '\u2713 Verified agent' : 'Verification pending'),
          h('div', { class: 'cpx-d-sub', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, (user && user.email) || ''),
        ]),
        h('div', { class: 'cpx-d-chev' }, '\u203a'),
      ]),
      h('div', { class: 'cpx-d-stats' }, [
        dStat9('Referred', String(k9.referred || 0), 'chain'),
        dStat9('Carriers', String(k9.carriers || 0), 'chain'),
        dStat9('Clearing', money9(tt9.accrued || 0), 'earnings'),
      ]),
      h('div', { class: 'cpx-d-items' }, items9),
      h('div', { class: 'cpx-d-foot' }, [
        h('button', { class: 'cpx-d-item', onClick: async () => { await signOut(); location.reload(); } }, [icon('logout', 20), h('span', null, 'Sign out')]),
        h('div', { class: 'cpx-d-site' }, 'loadboot.com \u00b7 The Operating System for Trucking'),
      ]),
    ]);
    function close9() { scrim9.classList.remove('show'); drawer9.classList.remove('show'); setTimeout(() => { scrim9.remove(); drawer9.remove(); }, 220); }
    scrim9.onclick = close9;
    document.body.appendChild(scrim9); document.body.appendChild(drawer9);
    requestAnimationFrame(() => { scrim9.classList.add('show'); drawer9.classList.add('show'); });
  }

  const shell = h('div', { class: 'cp-shell' }, [
    h('aside', { class: 'cp-side' }, [
      h('div', { class: 'cp-brandrow' }, brandLogo({ dark: true, sub: 'Agent' })),
      nav,
      h('div', { class: 'cp-side-foot' }, [
        h('div', { class: 'cp-carrier' }, [h('div', { class: 'cp-carrier-name' }, feed.name || 'Agent'), h('div', { class: 'cp-carrier-mail' }, (user && user.email) || '')]),
        h('button', { class: 'cp-side-out', onClick: async (ev) => { ev.currentTarget.disabled = true; await signOut(); location.reload(); } }, [icon('logout', 16), h('span', null, 'Sign out')]),
      ]),
    ]),
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        h('div', { class: 'cp-top-left' }, [
          h('button', { class: 'cpx-burger', 'aria-label': 'Menu', onClick: (e) => { e.stopPropagation(); openAgDrawer(); } }, icon('menu', 24)),
          titleEl,
        ]),
        h('div', { class: 'cp-top-right' }, [
          agBellWrap,
          h('button', { class: 'cp-pill', title: 'Tap to see exactly what the pair is and how earning switches ON', style: 'cursor:pointer;border:0;font:inherit;' + (feed.pair_active ? 'background:rgba(34,197,94,.15);color:#4ade80;font-weight:800' : 'background:rgba(245,158,11,.15);color:#fbbf24;font-weight:800'), onClick: () => pairModal9() }, feed.pair_active ? '✅ Chain active' : '⏳ Pair pending'),
        ]),
      ]),
      content,
    ]),
    tabbar,
  ]);
  mount(root, shell);
  Object.entries(links).forEach(([k9, a9]) => a9.classList.toggle('active', k9 === tab));
  Object.entries(tabLinks).forEach(([k9, a9]) => a9.classList.toggle('active', k9 === tab));
  const it0 = AGNAV.find((n) => n[0] === tab); titleEl.textContent = it0 ? it0[1] : 'Dashboard';
  render();
  root.setAttribute('aria-busy', 'false');
}

// 🟣 multi-stop route modal from a board card — shows the redacted route (City, ST + purpose);
// exact street addresses & pins unlock after booking (they go on the rate confirmation).
function lbStopsModal9(l9) {
  const st9 = (l9.details && l9.details.stops) || [];
  const row9 = (ic9, t9, s9, hot9) => h('div', { style: 'display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)' }, [
    h('span', { style: 'font-size:1.15rem;flex:none' }, ic9),
    h('div', null, [
      h('div', { style: 'font-weight:800;color:' + (hot9 ? '#c4b5fd' : '#fff') }, t9),
      s9 ? h('div', { class: 'cp-row-s', style: 'margin-top:1px' }, s9) : null,
    ].filter(Boolean)),
  ]);
  openModal('🟣 Route — ' + (st9.length + 2) + ' stops total', [
    h('div', { class: 'cp-row-s', style: 'margin-bottom:8px;line-height:1.6' }, 'Run order as the broker posted it. Exact street addresses + GPS pins unlock the moment you BOOK — they print on your rate confirmation and light up the Trip Map.'),
    row9('🔵', '1 · PICKUP — ' + (l9.origin || ''), l9.pickup_date ? 'Pickup: ' + l9.pickup_date : null, false),
    ...st9.map((s9, i9) => row9(String(s9.kind || '') === 'pickup' ? '🟣' : '🟪',
      (i9 + 2) + ' · EXTRA ' + String(s9.kind || 'stop').toUpperCase() + ' — ' + (s9.city || '?') + (s9.state ? ', ' + s9.state : ''),
      (s9.purpose ? s9.purpose + ' · ' : '') + 'address unlocks on booking', true)),
    row9('🟢', (st9.length + 2) + ' · DELIVERY — ' + (l9.destination || ''), l9.delivery_date ? 'DEL ' + l9.delivery_date : null, false),
    h('div', { style: 'margin-top:10px;background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.3);border-radius:11px;padding:9px 12px' },
      h('div', { class: 'cp-row-s', style: 'line-height:1.65' }, '💰 Every extra stop carries stop-off pay on the rate card, and each stop gets its own GPS check-in — detention protection applies at EVERY stop, not just pickup and delivery.')),
  ]);
}
function notCarrier() {
  const card = h('div', { class: 'cp-auth-card' }, [
    h('h1', null, 'No carrier account'),
    h('p', { class: 'cp-auth-sub' }, 'This sign-in isn’t linked to a carrier. Contact your dispatcher if you think this is an error.'),
    h('button', { class: 'cp-btn cp-btn-lg', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Signing out…'; await signOut(); location.reload(); } }, 'Sign out'),
  ]);
  const shell = h('div', { class: 'cp-auth' }, [card]);
  mount(root, shell);
  root.setAttribute('aria-busy', 'false');
  // Referral partners (agencies / creators / influencers) have no carrier org but DO have a referral
  // account — give them their full tracking + payout dashboard right here instead of a dead end.
  (async () => {
    let on = false; try { on = await isFlagEnabled('referral_program'); } catch (_) { on = false; }
    if (!on) return;
    let r; try { r = await myReferral(); } catch (_) { return; }
    if (!r || !r.code) return;
    card.querySelector('h1').textContent = '🤝 Agent dashboard';
    card.querySelector('.cp-auth-sub').textContent = 'You are a LoadBoot AGENT — bring clients in pairs, earn 1% of every delivered load your chain touches. Everything below is live.';
    const panel = h('div', { class: 'cp-auth-card', style: 'margin-top:14px;text-align:left' }, [
      h('h2', { style: 'margin:0 0 4px' }, 'Your agent program'),
      h('p', { class: 'cp-auth-sub', style: 'margin-bottom:10px' }, 'Share your link — every broker, carrier or shipper who joins through it is yours, permanently. Your 1% comes out of LoadBoot’s own fee: your clients never pay extra.'),
    ]);
    panel.appendChild(buildReferralStats(r));
    // ---- AGENT DASHBOARD v2: one feed, everything live ----
    const chainW = h('div', { style: 'margin-top:14px' });
    panel.appendChild(chainW);
    (async () => {
      let cs; try { cs = await agentFeed(); } catch (_) { return; }
      if (!cs || !cs.has_code) return;
      const money9 = (v) => '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const k = cs.kpis || {}; const tt = cs.totals || {};
      const tile = (lbl, val, hi) => h('div', { style: 'flex:1;min-width:110px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:13px;padding:12px;text-align:center' }, [
        h('div', { style: 'font-size:.6rem;letter-spacing:.09em;font-weight:800;color:#7f92b3;text-transform:uppercase' }, lbl),
        h('div', { style: 'font-size:1.35rem;font-weight:900;margin-top:3px;color:' + (hi ? '#4ade80' : '#fff') }, val)]);
      const kpis = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        tile('Referred', String(k.referred || 0)), tile('Brokers', String(k.brokers || 0)), tile('Carriers', String(k.carriers || 0)),
        tile('Clearing', money9(tt.accrued)), tile('Payable', money9(tt.payable), true), tile('Paid', money9(tt.paid), true)]);
      const banner = cs.pair_active
        ? h('div', { style: 'margin-top:10px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.4);border-radius:12px;padding:10px 14px;font-weight:800;color:#4ade80' }, '✅ CHAIN ACTIVE — you earn 1% on every delivered load your clients touch.')
        : h('div', { style: 'margin-top:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);border-radius:12px;padding:10px 14px;font-weight:700;color:#fbbf24' },
            (k.referred || 0) === 0 ? '⏳ CHAIN PENDING — share your link and bring your first PAIR (a broker + a carrier).'
            : ('⏳ CHAIN PENDING — bring the other side (' + ((k.carriers || 0) ? 'a broker or shipper' : 'a carrier') + ') and every load starts paying you.'));
      // invite templates — one-tap copy
      const invite = (label9, txt9) => h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev9) => { try { await navigator.clipboard.writeText(txt9); ev9.currentTarget.textContent = 'Copied ✓'; setTimeout(() => { ev9.currentTarget.textContent = label9; }, 1500); } catch (_) { alert(txt9); } } }, label9);
      const inviteRow = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, [
        invite('📋 Broker invite', 'I moved my freight ops to LoadBoot — post a load and verified carriers book it in one tap, GPS-tracked with automatic paperwork. Join free with my link: ' + cs.link),
        invite('📋 Carrier invite', 'Real loads, zero ghost posts — booked loads vanish from the board instantly. GPS proof gets your detention PAID. Free verified account, join with my link: ' + cs.link),
      ]);
      // live loads of the chain
      const loads = Array.isArray(cs.loads) ? cs.loads : [];
      const badge9 = (txt9, bg9, cl9) => h('span', { class: 'cp-pill', style: 'background:' + bg9 + ';color:' + cl9 }, txt9);
      const loadRows = loads.map((x) => {
        const st9 = x.delivered_at ? badge9('✓ DELIVERED', 'rgba(34,197,94,.15)', '#4ade80')
          : x.trip_status ? badge9('🚛 BOOKED', 'rgba(8,131,247,.15)', '#3b9dff')
          : badge9('📦 POSTED', 'rgba(245,158,11,.15)', '#fbbf24');
        return h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
          h('div', { style: 'flex:1;min-width:190px' }, [
            h('div', { class: 'cp-row-t' }, (x.lane || '') + (x.rate ? ' · $' + Number(x.rate).toLocaleString() : '')),
            h('div', { class: 'cp-row-s' }, 'broker: ' + (x.broker || '—') + (x.broker_yours ? ' ★yours' : '')
              + (x.booked_by ? ' · carrier: ' + x.booked_by + (x.booked_by_yours ? ' ★YOURS — double chain ✓' : '') : '')
              + (Number(x.your_commission) ? ' · your cut ' + money9(x.your_commission) : '')),
          ]), st9,
        ]);
      });
      // notices feed
      const notices = Array.isArray(cs.notices) ? cs.notices : [];
      const noticeRows = notices.slice(0, 8).map((n) => h('div', { class: 'cp-row-s', style: 'padding:4px 0;border-bottom:1px dashed rgba(148,163,184,.2)' },
        (n.at ? new Date(n.at).toLocaleString() + ' — ' : '') + (n.title || '') + (n.body ? ' · ' + n.body : '')));
      mount(chainW, h('div', null, [
        kpis, banner, inviteRow,
        h('div', { class: 'cp-row-t', style: 'margin:14px 0 4px' }, '🔗 Your chain'),
        (Array.isArray(cs.chain) && cs.chain.length) ? h('div', null, cs.chain.map((x) => h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
          h('div', { style: 'flex:1;min-width:190px' }, [
            h('div', { class: 'cp-row-t' }, (x.side === 'carrier' ? '🚛 ' : '🏢 ') + (x.org || '')),
            h('div', { class: 'cp-row-s' }, x.side + ' · joined ' + (x.joined_at ? new Date(x.joined_at).toLocaleDateString() : '') + ' · ' + (x.loads_posted || 0) + ' posted · ' + (x.trips_delivered || 0) + ' delivered'),
          ]), h('b', { style: 'color:#4ade80' }, money9(x.your_earnings)),
        ]))) : h('div', { class: 'cp-row-s' }, 'Nobody yet — copy an invite above and send it to that broker or carrier you already know.'),
        h('div', { class: 'cp-row-t', style: 'margin:14px 0 4px' }, '📦 Chain loads — live'),
        loadRows.length ? h('div', null, loadRows) : h('div', { class: 'cp-row-s' }, 'Loads your clients post or haul appear here the moment they happen: POSTED → BOOKED → DELIVERED (+ your cut).'),
        noticeRows.length ? h('div', null, [h('div', { class: 'cp-row-t', style: 'margin:14px 0 4px' }, '🔔 Latest activity'), ...noticeRows]) : null,
      ].filter(Boolean)));
    })();
    const pw = h('div'); panel.appendChild(pw); referralPayoutUI(pw, r);
    shell.appendChild(panel);
  })();
}

/* ---------- main app ---------- */
const NAV = [
  ['dashboard', 'Dashboard', 'dash'], ['health', 'Ratings', 'shield'], ['loads', 'Load Board', 'loads'], ['trips', 'My Loads', 'trips'],
  ['profile', 'My Profile', 'idcard'], ['fleet', 'Fleet', 'truck'], ['finance', 'Finance', 'finance'], ['documents', 'Documents', 'docs'],
  ['rates', 'Market Rates', 'finance'],
  ['support', 'Support', 'support'], ['safety', 'Safety', 'sos'], ['account', 'Account', 'user'],
];

async function appView(user) {
  // C4a — auto-claim referral: the marketing site stores ?ref=CODE in localStorage; claim it
  // once, silently, on first portal entry (server enforces one-referrer-per-org + no self-claim).
  (async () => {
    let code = null; try { code = localStorage.getItem('lb_ref'); } catch (_) {}
    if (!code) return;
    try { await claimReferral(code); } catch (_) {}
    try { localStorage.removeItem('lb_ref'); } catch (_) {}
  })();
  let ov; try { ov = await pocketOverview(); }
  catch (e) { if (/carrier account/i.test((e && e.message) || '')) { notCarrier(); return; } mount(root, h('div', { class: 'cp-auth' }, h('div', { class: 'cp-auth-card' }, [h('h1', null, 'Could not load'), h('p', { class: 'cp-auth-sub' }, 'Please refresh and try again.'), h('button', { class: 'cp-btn cp-btn-lg', onClick: () => boot() }, 'Retry')]))); return; }

  const EXTRA_TABS = ['onboarding', 'notifications', 'settings', 'reinstate'];
  let tab = (location.hash || '').replace('#', '') || 'dashboard';
  if (!NAV.some(n => n[0] === tab) && !EXTRA_TABS.includes(tab)) tab = 'dashboard';
  const content = h('div', { class: 'cp-content' });
  const navLinks = {};

  // ---- Customizable bottom tab bar: the carrier picks their own 5 shortcuts (Settings → Customize).
  const TABBAR_DEFAULT = ['dashboard', 'health', 'loads', 'trips', 'fleet'];
  function tabPrefs() {
    try { const v = JSON.parse(localStorage.getItem('lb_tabs') || 'null'); if (Array.isArray(v) && v.length) { const ok = v.filter(id => NAV.some(n => n[0] === id)).slice(0, 5); if (ok.length) return ok; } } catch (_) {}
    return TABBAR_DEFAULT;
  }
  const sideNav = (mobile) => h('nav', { class: mobile ? 'cp-tabbar' : 'cp-nav' }, (mobile ? tabPrefs().map(id => NAV.find(n => n[0] === id)).filter(Boolean) : NAV).map(([id, label, iconName]) => {
    const a = h('a', { class: 'cp-navlink', href: '#' + id, onClick: () => go(id) }, [icon(iconName, mobile ? 22 : 20), h('span', null, label)]);
    (navLinks[id] = navLinks[id] || []).push(a); return a;
  }));
  let mobileBar = null;
  function refreshTabbar() {
    if (!mobileBar) return;
    const nu = sideNav(true); mobileBar.replaceWith(nu); mobileBar = nu;
    Object.keys(navLinks).forEach(k => navLinks[k].forEach(a => a.classList.toggle('active', k === tab)));
  }

  const titleEl = h('h1', { class: 'cp-top-title' }, 'Dashboard');
  const bellBadge = h('span', { class: 'cp-bell-badge', hidden: true });
  const bell = h('button', { class: 'cp-iconbtn cp-bell', title: 'Notifications', onClick: () => go('notifications') }, [icon('bell', 20), bellBadge]);
  async function refreshUnread() { try { const ns = await pocketNotifications(50); const u = (ns || []).filter(n => !n.read_at).length; if (u > 0) { bellBadge.textContent = String(u > 9 ? '9+' : u); bellBadge.hidden = false; } else bellBadge.hidden = true; } catch (_) {} }
  // ---- Availability (Online/Offline) — REAL state stored in dispatch preferences ----
  const availPill = h('button', { class: 'cpx-avail on cpx-desktop', title: 'Your availability for new loads', onClick: () => toggleAvail() }, '…');
  let _dp = null, _dashK = null;
  function setAvailUI(on) { availPill.textContent = on ? 'Online' : 'Offline'; availPill.classList.toggle('on', !!on); availPill.classList.toggle('off', !on); }
  // NOTE: even if prefs fail to load, the toggle must stay ALIVE — previous version left _dp null
  // on error which made the Online button permanently dead. Default to { available: true }.
  (async () => { try { _dp = (await getDispatchPrefs()) || {}; } catch (_) { _dp = { available: true }; } setAvailUI(_dp.available !== false); })();
  async function toggleAvail() {
    if (!_dp) _dp = { available: true };
    const next = !(_dp.available !== false);
    availPill.disabled = true; const was = availPill.textContent; availPill.textContent = '…';
    try {
      await setDispatchPrefs({ min_rpm: _dp.min_rpm || null, preferred_equipment: _dp.preferred_equipment || [],
        preferred_lanes: _dp.preferred_lanes || [], home_base: _dp.home_base || null,
        max_deadhead_miles: _dp.max_deadhead_miles || null, notes: _dp.notes || null, available: next });
      _dp.available = next; setAvailUI(next);
    } catch (e) { availPill.textContent = was; alert((e && e.message) || 'Could not update availability.'); }
    availPill.disabled = false;
  }

  // ---- Side drawer (inDrive pattern): profile + full menu + sign out ----
  function openDrawer() {
    const scrim = h('div', { class: 'cpx-scrim' });
    // Rating line — real data from party_ratings; honest "New" state until reviews exist.
    const dStars = h('div', { class: 'cpx-d-rating' }, 'New — no ratings yet');
    (async () => { try { const r = await myRating(); if (r && r.avg != null) dStars.textContent = '★ ' + r.avg + '  (' + (r.count || 0) + ')'; } catch (_) {} })();
    const items = NAV.map(([id, label, iconName]) => h('button', { class: 'cpx-d-item' + (tab === id ? ' active' : ''), onClick: () => { close(); go(id); } }, [
      icon(iconName, 20), h('span', null, label),
      (id === 'documents' && !ov.compliance_ok) ? h('span', { class: 'cpx-d-pill' }, 'Action needed') : '',
    ]));
    const notifItem = h('button', { class: 'cpx-d-item' + (tab === 'notifications' ? ' active' : ''), onClick: () => { close(); go('notifications'); } }, [icon('bell', 20), h('span', null, 'Notifications'), bellBadge.hidden ? '' : h('span', { class: 'cpx-d-badge' }, bellBadge.textContent)]);
    const setItem = h('button', { class: 'cpx-d-item' + (tab === 'settings' ? ' active' : ''), onClick: () => { close(); go('settings'); } }, [icon('cog', 20), h('span', null, 'Settings')]);
    // Big availability CTA — inDrive's bottom-mode-button position, LoadBoot brand orange. REAL state.
    const cta = h('button', { class: 'cpx-d-cta' }, '');
    function paintCta() {
      const on = !(_dp && _dp.available === false);
      cta.textContent = on ? '● Online — receiving load offers' : 'Go online — start receiving loads';
      cta.classList.toggle('on', on); cta.classList.toggle('off', !on);
    }
    paintCta();
    cta.onclick = async () => { cta.disabled = true; cta.textContent = 'Updating…'; await toggleAvail(); paintCta(); paintDot(); cta.disabled = false; };
    // Live week-stats strip — REAL numbers from the same dashboard aggregate (no dummy data).
    const dStat = (label, goto) => { const b = h('button', { class: 'cpx-d-stat', onClick: () => { close(); go(goto); } }, [h('b', null, '—'), h('span', null, label)]); return b; };
    const sTrips = dStat('Active trips', 'trips'), sDeliv = dStat('Delivered · week', 'trips'), sRev = dStat('Revenue · week', 'finance');
    (async () => { try {
      if (!_dashK) _dashK = await carrierDashboard();
      const k = (_dashK && _dashK.kpis) || {};
      sTrips.firstChild.textContent = String(k.active_trips ?? 0);
      sDeliv.firstChild.textContent = String(k.delivered_this_week ?? 0);
      sRev.firstChild.textContent = money(k.revenue_this_week ?? 0);
    } catch (_) {} })();
    // Availability dot on the avatar (green = online, grey = offline) — mirrors the real toggle.
    const avaDot = h('span', { class: 'cpx-d-avadot' });
    function paintDot() { avaDot.style.background = !(_dp && _dp.available === false) ? '#22c55e' : '#64748b'; }
    paintDot();
    const drawer = h('aside', { class: 'cpx-drawer' }, [
      h('div', { class: 'cpx-d-head', onClick: () => { close(); go('account'); } }, [
        h('div', { class: 'cpx-d-ava', style: 'position:relative' }, [document.createTextNode((ov.carrier || 'C').trim().charAt(0).toUpperCase()), avaDot]),
        h('div', { style: 'min-width:0;flex:1' }, [
          h('div', { class: 'cpx-d-name' }, ov.carrier || 'Carrier'),
          dStars,
          h('div', { class: 'cpx-d-sub', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, (user && user.email) || ''),
        ]),
        h('div', { class: 'cpx-d-chev' }, '›'),
      ]),
      h('div', { class: 'cpx-d-stats' }, [sTrips, sDeliv, sRev]),
      h('div', { class: 'cpx-d-items' }, [...items, notifItem, setItem]),
      h('div', { class: 'cpx-d-foot' }, [
        h('button', { class: 'cpx-d-item', onClick: async () => { await signOut(); location.reload(); } }, [icon('logout', 20), h('span', null, 'Sign out')]),
        cta,
        h('div', { class: 'cpx-d-site' }, 'loadboot.com · The Operating System for Trucking'),
      ]),
    ]);
    function close() { scrim.classList.remove('show'); drawer.classList.remove('show'); setTimeout(() => { scrim.remove(); drawer.remove(); }, 220); }
    scrim.onclick = close;
    document.body.appendChild(scrim); document.body.appendChild(drawer);
    requestAnimationFrame(() => { scrim.classList.add('show'); drawer.classList.add('show'); });
  }

  const shell = h('div', { class: 'cp-shell' }, [
    h('aside', { class: 'cp-side' }, [
      h('div', { class: 'cp-brandrow' }, brandLogo({ dark: true, sub: window.__LB_AGENT ? 'Agent' : 'Carrier' })),
      sideNav(false),
      h('div', { class: 'cp-side-foot' }, [
        h('div', { class: 'cp-carrier' }, [h('div', { class: 'cp-carrier-name' }, ov.carrier || 'Carrier'), h('div', { class: 'cp-carrier-mail' }, (user && user.email) || '')]),
        h('button', { class: 'cp-side-out', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.lastChild.textContent = 'Signing out…'; await signOut(); location.reload(); } }, [icon('logout', 16), h('span', null, 'Sign out')]),
      ]),
    ]),
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        h('div', { class: 'cp-top-left' }, [
          h('button', { class: 'cpx-burger', 'aria-label': 'Menu', onClick: (e) => { e.stopPropagation(); openDrawer(); } }, icon('menu', 24)),
          titleEl,
        ]),
        h('div', { class: 'cp-top-right' }, [
          availPill,
          h('button', { class: 'cp-iconbtn cpx-desktop', title: 'Settings', onClick: () => go('settings') }, icon('cog', 20)),
          h('button', { class: 'cp-chip cp-chip-btn cpx-desktop ' + (ov.compliance_ok ? 'ok' : 'warn'), title: ov.compliance_ok ? 'Account compliant' : 'Action needed \u2014 finish your setup', onClick: () => go(ov.compliance_ok ? 'account' : 'documents') }, ov.compliance_ok ? 'Compliant' : 'Action needed'),
          bell,
          (() => {
            // Account menu — modern avatar dropdown: identity + Settings + Sign out.
            const menu = h('div', { class: 'cp-menu', hidden: true }, [
              h('div', { class: 'cp-menu-id' }, [
                h('div', { class: 'cp-menu-name' }, ov.carrier || 'Carrier account'),
                h('div', { class: 'cp-menu-mail' }, (user && user.email) || ''),
              ]),
              h('button', { class: 'cp-menu-item', onClick: () => { menu.hidden = true; go('account'); } }, [icon('user', 16), h('span', null, 'Account & settings')]),
              h('button', { class: 'cp-menu-item', onClick: () => { menu.hidden = true; go('documents'); } }, [icon('docs', 16), h('span', null, 'Documents')]),
              h('button', { class: 'cp-menu-item cp-menu-out', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.lastChild.textContent = 'Signing out…'; await signOut(); location.reload(); } }, [icon('logout', 16), h('span', null, 'Sign out')]),
            ]);
            const btn = h('button', { class: 'cp-avatar', 'aria-haspopup': 'menu', 'aria-label': 'Account menu', title: (user && user.email) || '', onClick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; }, html: '<span style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#0883F7,#1d4ed8);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px">' + (((user && user.email) || '?').trim().charAt(0).toUpperCase()) + '</span>' });
            document.addEventListener('click', () => { menu.hidden = true; });
            return h('div', { class: 'cp-menuwrap' }, [btn, menu]);
          })(),
        ]),
      ]),
      content,
    ]),
    (mobileBar = sideNav(true)),
  ]);
  mount(root, shell);
  root.setAttribute('aria-busy', 'false');

  function go(id) {
    tab = id; if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);  // replace, not push — keeps Back working / no hash pile-up
    Object.keys(navLinks).forEach(k => navLinks[k].forEach(a => a.classList.toggle('active', k === tab)));
    const item = NAV.find(n => n[0] === tab);
    titleEl.textContent = item ? item[1] : ({ notifications: 'Notifications', onboarding: 'Onboarding', settings: 'Settings', reinstate: 'Account reinstatement' }[tab] || 'Dashboard');
    render();
  }
  window.addEventListener('hashchange', () => { const t = (location.hash || '').replace('#', ''); if (t && t !== tab && (NAV.some(n => n[0] === t) || EXTRA_TABS.includes(t))) go(t); });

  function render() {
    if (tab === 'settings') { loadSettings(); return; }
    if (tab === 'loads') loadLoads();
    else if (tab === 'trips') loadTrips();
    else if (tab === 'fleet') loadFleet();
    else if (tab === 'finance') loadFinance();
    else if (tab === 'documents') loadDocuments();
    else if (tab === 'support') loadSupport();
    else if (tab === 'account') loadAccount();
    else if (tab === 'onboarding') loadOnboarding();
    else if (tab === 'profile') import('./profile-view.js').then(function (m) { m.renderMyProfile(content); }).catch(function () { mount(content, h('div', { class: 'cp-muted' }, 'Could not load your profile.')); });
    else if (tab === 'notifications') loadNotifications();
    else if (tab === 'health') loadHealth();
    else if (tab === 'reinstate') loadReinstate();
    else if (tab === 'safety') loadSafety();
    else if (tab === 'rates') import('../shared/market-widget.js').then(function (m) { const hst = h('div'); mount(content, hst); m.renderMarketWidget(hst, { sub: 'What lanes PAY the truck right now \u2014 real LoadBoot bookings + national benchmarks. Never haul below your cost per mile.' }); }).catch(function () { mount(content, h('div', { class: 'cp-muted' }, 'Could not load market rates.')); });
    else loadDashboard();
  }

  /* ----- on-open prompts: notifications + location ----- */
  function openPrompts() {
    promptHost.innerHTML = '';   // clear first — otherwise prompts stack on every dashboard visit
    if (pushSupported()) {
      isPushEnabled().then(on => {
        if (on) return;
        const card = h('div', { class: 'cp-prompt' }, [
          icon('bell', 22),
          h('div', { class: 'cp-prompt-txt' }, [h('b', null, 'Turn on notifications'), h('span', null, 'Get alerts for new loads, payments and dispatcher messages.')]),
          h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = '…'; try { await enablePush('Carrier portal'); card.remove(); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Enable'; alert((e && e.message) || 'Could not enable.'); } } }, 'Enable'),
          h('button', { class: 'cp-prompt-x', onClick: () => card.remove() }, '×'),
        ]);
        promptHost.appendChild(card);
      });
    }
    if (navigator.geolocation) {
      const card = h('div', { class: 'cp-prompt' }, [
        icon('pin', 22),
        h('div', { class: 'cp-prompt-txt' }, [h('b', null, 'Share your location'), h('span', null, 'Let dispatch see your position while a load is active. You stay in control.')]),
        h('button', { class: 'cp-btn cp-btn-sm', onClick: (ev) => { ev.currentTarget.disabled = true; navigator.geolocation.getCurrentPosition(() => { ev.currentTarget.textContent = 'Allowed ✓'; card.remove(); }, () => { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Allow'; }); } }, 'Allow'),
        h('button', { class: 'cp-prompt-x', onClick: () => card.remove() }, '×'),
      ]);
      promptHost.appendChild(card);
    }
  }
  const promptHost = h('div', { class: 'cp-prompts' });

  /* ----- Dashboard ----- */
  // Star row helper (official palette: orange stars like the brand accent)
  const starsRow = (avg, size) => {
    const full = Math.round(Number(avg) || 0);
    return h('span', { style: 'color:#F97316;font-size:' + (size || 16) + 'px;letter-spacing:2px' }, '★'.repeat(full) + '☆'.repeat(5 - full));
  };
  /* ----- Amazon-style appeal: reinstatement request / health plan of action ----- */
  async function loadReinstate() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading\u2026'));
    let ov = {}; try { ov = (await pocketOverview()) || {}; } catch (_) {}
    let hist = []; try { hist = (await myReinstatements()) || []; } catch (_) {}
    const paused = ov.account_status === 'paused';
    const kind = paused ? 'reinstate' : 'health_poa';
    const open = hist.find((r) => (r.status === 'submitted' || r.status === 'in_review') && r.kind === kind);
    const reason = String(ov.pause_reason || '');

    // Predefined requirements per pause-reason category
    const REQ = (() => {
      if (/insur|coi/i.test(reason)) return [
        { t: 'New Certificate of Insurance (COI)', d: 'Active policy showing $1M auto liability + $100k cargo, with LoadBoot listed as certificate holder. Ask your insurance agent \u2014 they issue it the same day.', type: 'insurance' }];
      if (/fmcsa|authority|oos/i.test(reason)) return [
        { t: 'FMCSA authority proof', d: 'Your authority must show ACTIVE again. Upload the FMCSA reinstatement letter or your updated MCS-150 confirmation.', type: 'authority' }];
      if (/safety/i.test(reason)) return [
        { t: 'Written explanation + supporting documents', d: 'Explain the incident, what you changed (driver, equipment, process), and attach anything that proves it (inspection report, training record).', type: 'other' }];
      if (/payment|settlement/i.test(reason)) return [
        { t: 'Proof the dispute is resolved', d: 'Upload the settlement confirmation, payment receipt, or written agreement that closes the dispute.', type: 'other' }];
      if (/fraud|spoof/i.test(reason)) return [
        { t: 'Written explanation + device/ELD evidence', d: 'Explain the GPS anomaly and attach ELD logs or device records covering the trip(s) in question.', type: 'other' }];
      if (/claim/i.test(reason)) return [
        { t: 'Plan of action for claims', d: 'What caused the claims, what you fixed, and how you will prevent the next one. Attach any repair/insurance paperwork.', type: 'other' }];
      if (/hold/i.test(reason)) return [];
      return paused ? [{ t: 'Supporting document (if any)', d: 'Attach anything that shows the issue is fixed.', type: 'other' }] : [];
    })();

    // Health mode: requirements come from the exact factors that dropped
    let poaCtx = null;
    if (!paused) {
      try { poaCtx = JSON.parse(sessionStorage.getItem('lb:poa:ctx') || 'null'); } catch (_) {}
      const F = (poaCtx && poaCtx.factors) || [];
      const seen = {};
      F.forEach((f) => {
        const t = String(f.label || '').toLowerCase();
        let item = null;
        if (/on-?time|deliver|late|pickup|trip|dwell|pod/.test(t)) item = { t: 'Delivery performance \u2014 explain every late trip', d: 'What caused the late pickup/delivery (breakdown, traffic, planning?), what you changed, and your prevention plan \u2014 departure buffers, route check, backup truck.', type: 'other', k: 'perf' };
        else if (/insur|coi/.test(t)) item = { t: 'Updated Certificate of Insurance', d: 'Fresh COI from your agent \u2014 the score recovers as soon as it verifies.', type: 'insurance', k: 'coi' };
        else if (/authorit|fmcsa|mcs/.test(t)) item = { t: 'FMCSA authority proof', d: 'Reinstatement letter or updated MCS-150 confirmation.', type: 'authority', k: 'auth' };
        else if (/doc|complian|w-?9|agreement|expir/.test(t)) item = { t: 'Expired / missing document', d: 'Re-upload the document flagged in your health breakdown \u2014 that factor heals immediately after approval.', type: 'other', k: 'doc' };
        else if (/claim|damage|cargo/.test(t)) item = { t: 'Claims \u2014 plan of action', d: 'Root cause of the claim(s), repair/insurance paperwork, and how you prevent the next one.', type: 'other', k: 'claim' };
        else if (/dispute|payment|invoice|settle/.test(t)) item = { t: 'Payment dispute resolution proof', d: 'Settlement confirmation or written agreement.', type: 'other', k: 'pay' };
        else item = { t: (f.label || 'Factor') + ' \u2014 explain and fix', d: 'Describe what dropped this factor and the concrete step you took.', type: 'other', k: 'gen' + t.slice(0, 8) };
        if (item && !seen[item.k]) { seen[item.k] = 1; REQ.push(item); }
      });
    }

    const demand = (!paused && ov.poa_required) ? ov.poa_required : null;
    const lastKind = hist.find((r) => r.kind === kind);
    const needMore = lastKind && lastKind.status === 'more_info' ? lastKind : null;
    const helpBtn9 = (small) => h('button', { class: 'cp-btn cp-btn-sm ghost', style: small ? 'margin:0' : 'margin-top:10px', title: 'Talk to LoadBoot support / live chat', onClick: () => go('support') }, '\ud83c\udfa7 Need help?');
    const mkDl = (note9, fromIso) => {
      const m9 = /DEADLINE:\s*respond within\s*(\d+)\s*(hour|day)/i.exec(note9 || '');
      if (!m9 || !fromIso) return null;
      const dl9 = new Date(fromIso).getTime() + Number(m9[1]) * (m9[2].toLowerCase() === 'hour' ? 36e5 : 864e5);
      const tEl = h('span', { style: 'font-weight:800' }, '');
      let wasConn = false; const tick = () => {
        if (tEl.isConnected) wasConn = true; else if (wasConn) { clearInterval(iv9); return; }
        const left = dl9 - Date.now();
        if (left <= 0) { tEl.textContent = '\u23f0 DEADLINE PASSED \u2014 answer immediately to avoid the consequence'; tEl.style.color = '#f87171'; return; }
        const hh = Math.floor(left / 36e5), mm = Math.floor((left % 36e5) / 6e4);
        tEl.textContent = '\u23f3 ' + (hh >= 48 ? Math.floor(hh / 24) + 'd ' + (hh % 24) + 'h' : hh + 'h ' + mm + 'm') + ' left to respond';
        tEl.style.color = left < 3 * 36e5 ? '#f87171' : '#fbbf24';
      }; const iv9 = setInterval(tick, 30e3); tick();
      return tEl;
    };
    const buildUnifiedCard = () => {
    // ONE card: every issue (kind) as its own dated section, View details opens the full dated thread
      const unifiedCard = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-row-t' }, '\ud83d\udcac Requests & conversation \u2014 issue-wise'), h('div', { class: 'cp-row-s' }, 'Loading\u2026')]);
      (async () => {
      const KINDS9 = [['health_poa', '\ud83d\udccb Account health \u2014 plan of action'], ['reinstate', '\u25b6 Account reinstatement']];
      const secs = [];
      for (const [k9, label9] of KINDS9) {
        let ev = []; try { ev = (await poaThread(k9)) || []; } catch (_) { ev = []; }
        if (!ev.length) continue;
        const reqsK = hist.filter((r) => r.kind === k9);
        const latest = reqsK[0] || null;
        const stPill = latest ? (() => { const pl = (latest.status === 'approved') ? ['\u2713 Approved', 'rgba(22,163,74,.15)', '#4ade80'] : latest.status === 'rejected' ? ['\u2715 Declined', 'rgba(239,68,68,.15)', '#f87171'] : latest.status === 'in_review' ? ['\u23f3 In review', 'rgba(8,131,247,.15)', '#3b9dff'] : latest.status === 'more_info' ? ['\u21a9 More info needed', 'rgba(217,119,6,.15)', '#fbbf24'] : ['\u2022 Submitted', 'rgba(217,119,6,.15)', '#fbbf24']; return h('span', { class: 'cp-pill', style: 'background:' + pl[1] + ';color:' + pl[2] }, pl[0]); })() : null;
        const d0 = ev[0] && ev[0].at ? new Date(ev[0].at).toLocaleDateString() : '';
        const d1 = ev[ev.length - 1] && ev[ev.length - 1].at ? new Date(ev[ev.length - 1].at).toLocaleDateString() : '';
        const body9 = h('div', { style: 'display:none;margin-top:8px;border-top:1px dashed rgba(148,163,184,.25);padding-top:6px' });
        let lastDay = '';
        ev.forEach((e9) => {
          const day9 = e9.at ? new Date(e9.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
          if (day9 && day9 !== lastDay) { lastDay = day9; body9.appendChild(h('div', { style: 'text-align:center;margin:8px 0 2px' }, h('span', { class: 'cp-pill', style: 'background:rgba(148,163,184,.15);color:#94a3b8;font-size:.7rem' }, day9))); }
          const you = e9.who === 'you';
          const tone9 = e9.type === 'accepted' ? ['rgba(22,163,74,.12)', '#4ade80', '\u2713 Accepted'] :
                        e9.type === 'declined' ? ['rgba(239,68,68,.12)', '#f87171', '\u2715 Declined'] :
                        e9.type === 'more_info' ? ['rgba(217,119,6,.12)', '#fbbf24', '\u21a9 More info requested'] :
                        e9.type === 'demand' ? ['rgba(217,119,6,.12)', '#fbbf24', '\ud83d\udccb Demand' + (e9.factor ? ' \u2014 ' + e9.factor : '')] :
                        e9.type === 'pause' ? ['rgba(239,68,68,.12)', '#f87171', '\u23f8 Account paused' + (e9.factor ? ' (' + e9.factor + ')' : '')] :
                        you ? ['rgba(8,131,247,.12)', '#3b9dff', '\ud83d\udce4 Your answer'] : ['rgba(148,163,184,.12)', '#94a3b8', 'Reply'];
          body9.appendChild(h('div', { style: 'display:flex;justify-content:' + (you ? 'flex-end' : 'flex-start') + ';margin:5px 0' },
            h('div', { style: 'max-width:88%;background:' + tone9[0] + ';border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:9px 12px' }, [
              h('div', { style: 'display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap' }, [
                h('span', { style: 'font-weight:800;font-size:.78rem;color:' + tone9[1] }, (you ? 'YOU' : ('LOADBOOT ' + (lbTeamOf(e9.text) || 'REVIEW').toUpperCase())) + ' \u00b7 ' + tone9[2]),
                h('span', { class: 'cp-row-s', style: 'font-size:.72rem' }, e9.at ? new Date(e9.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''),
              ]),
              h('div', { class: 'cp-row-s', style: 'white-space:pre-wrap;margin-top:4px' }, e9.text || ''),
              (Array.isArray(e9.attachments) && e9.attachments.length) ? h('div', { class: 'cp-row-s', style: 'margin-top:4px;color:#3b9dff;cursor:pointer', onClick: (x9) => { x9.stopPropagation(); go('documents'); } }, '\ud83d\udcce ' + e9.attachments.map((a9) => a9.file_name).join(' \u00b7 ') + ' \u2014 view in Documents \u2192') : null,
            ].filter(Boolean))));
        });
        const caret9 = h('span', { style: 'color:#3b9dff;font-weight:700;font-size:.85rem' }, '\u25be View details');
        secs.push(h('div', { style: 'border:1px solid rgba(148,163,184,.2);border-radius:12px;padding:10px 12px;margin-top:8px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer', onClick: () => { const on = body9.style.display !== 'none'; body9.style.display = on ? 'none' : 'block'; caret9.textContent = on ? '\u25be View details' : '\u25b4 Hide'; } }, [
            h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [h('span', { style: 'font-weight:700;font-size:.92rem' }, label9), stPill].filter(Boolean)),
            h('div', { style: 'display:flex;gap:8px;align-items:center' }, [h('span', { class: 'cp-row-s', style: 'font-size:.75rem' }, d0 === d1 ? d0 : d0 + ' \u2192 ' + d1), caret9]),
          ]),
          body9,
        ]));
      }
      mount(unifiedCard, h('div', null, [
        h('div', { class: 'cp-row-t' }, '\ud83d\udcac Requests & conversation \u2014 issue-wise'),
        secs.length ? h('div', null, secs) : h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'No conversation yet.'),
        h('div', { style: 'display:flex;justify-content:center' }, helpBtn9(false)),
      ]));
      })();
      return unifiedCard;
    };
    const head = h('div', { class: 'cp-card', style: paused ? 'border-color:rgba(239,68,68,.45)' : 'border-color:rgba(217,119,6,.4)' }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.05rem;color:' + (paused ? '#f87171' : '#fbbf24') }, paused ? '\u23f8 Account paused \u2014 ' + (ov.pause_scope === 'booking' ? 'booking blocked' : 'all services blocked') : '\ud83d\udccb Plan of action \u2014 account health'),
        helpBtn9(true),
      ]),
      paused && reason ? h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Reason on file: ' + reason) : null,
      h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, paused
        ? 'Complete the requirements below and submit \u2014 our team reviews every request within 24 hours. Approval reinstates your account instantly.'
        : 'Your health score dropped. Per LoadBoot policy, explain what caused it, what you fixed, and how you\u2019ll prevent it. This answer stays on your record and is reviewed within 24 hours.'),
      (!paused && poaCtx && poaCtx.factors && poaCtx.factors.length) ? h('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' },
        poaCtx.factors.map((f) => h('span', { class: 'cp-pill', style: 'background:rgba(217,119,6,.15);color:#fbbf24' }, (f.label || '') + (f.lost ? ' \u2212' + f.lost : '')))) : null,
      demand ? (() => {
        const tEl = needMore ? null : mkDl(demand.note, demand.at);
        return h('div', { style: 'margin-top:10px;background:rgba(217,119,6,.1);border:1px solid rgba(217,119,6,.35);border-radius:10px;padding:10px 12px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center' }, [
            h('div', { style: 'font-weight:800;font-size:.85rem;color:#fbbf24' }, '\ud83d\udccb What the ' + (lbTeamOf(demand.note) || 'LoadBoot review') + ' demanded (' + new Date(demand.at).toLocaleDateString() + '):'),
            tEl,
          ].filter(Boolean)),
          h('div', { class: 'cp-row-s', style: 'white-space:pre-wrap;margin-top:4px' }, demand.note || ('Answer for: ' + (demand.factor || ''))),
        ].filter(Boolean));
      })() : null,
      needMore ? (() => {
        const tEl = mkDl(needMore.staff_note, needMore.decided_at || needMore.created_at);
        return h('div', { style: 'margin-top:10px;background:rgba(217,119,6,.1);border:1px solid rgba(217,119,6,.35);border-radius:10px;padding:10px 12px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center' }, [
            h('div', { style: 'font-weight:800;font-size:.85rem;color:#fbbf24' }, '\u21a9 ' + (lbTeamOf(needMore.staff_note) || 'Reviewer') + ' needs MORE information on your last answer' + (needMore.decided_at ? ' (' + new Date(needMore.decided_at).toLocaleString() + ')' : '') + ':'),
            tEl,
          ].filter(Boolean)),
          h('div', { class: 'cp-row-s', style: 'white-space:pre-wrap;margin-top:4px' }, needMore.staff_note || ''),
          h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Submit again below with the missing details \u2014 your previous answer stays on record.'),
        ].filter(Boolean));
      })() : null,
    ].filter(Boolean));

    // Amazon-style status tracker when a request is already open
    const demandNewer = !!(demand && open && new Date(demand.at).getTime() > new Date(open.created_at).getTime());
    if (open && !demandNewer) {
      const step = (label, on, done) => h('div', { style: 'display:flex;align-items:center;gap:10px;padding:8px 0' }, [
        h('div', { style: 'width:26px;height:26px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;' + (done ? 'background:#16a34a;color:#fff' : on ? 'background:#0883F7;color:#fff' : 'background:rgba(148,163,184,.25);color:#94a3b8') }, done ? '\u2713' : on ? '\u25cf' : ''),
        h('div', null, [h('div', { style: 'font-weight:700;font-size:.92rem' }, label), on && !done ? h('div', { class: 'cp-row-s' }, 'Current stage') : null]),
      ]);
      const inRev = open.status === 'in_review';
      mount(content, h('div', null, [head,
        h('div', { class: 'cp-card' }, [
          h('div', { class: 'cp-row-t' }, 'Your request is with our team'),
          h('div', { class: 'cp-row-s', style: 'margin-top:2px' }, 'Submitted ' + new Date(open.created_at).toLocaleString() + ' \u00b7 you\u2019ll be notified here and by email.'),
          h('div', { style: 'margin-top:10px' }, [step('Submitted', true, true), step('In review', true, inRev), step('Decision \u2014 approve / decline / more info', !inRev ? false : true, false)]),
          h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Whatever the decision \u2014 accepted, declined with a note, or a request for more information \u2014 it appears RIGHT HERE and as a notification + email.'),
          h('div', { class: 'cp-row-s', style: 'margin-top:6px;background:rgba(8,131,247,.08);border-radius:10px;padding:10px 12px' }, '\u201c' + open.message + '\u201d'),
        ]),
        buildUnifiedCard(),
      ].filter(Boolean)));
      return;
    }

    // Requirements checklist
    const attached = [];
    const attHost = h('div', null);
    const drawAtt = () => { attHost.innerHTML = ''; attached.forEach((a, i9) => attHost.appendChild(h('div', { class: 'cp-row-s', style: 'padding:4px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
      h('span', null, '\ud83d\udcce ' + a.file_name + ' (' + a.type + ') \u2713'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'padding:2px 10px;font-size:.75rem', title: 'Remove from this request (the copy in document review stays)', onClick: () => { attached.splice(i9, 1); drawAtt(); upMsg.textContent = attached.length ? '\u2713 Attached (' + attached.length + ')' : 'Attachment removed \u2014 add the correct file above.'; if (!attached.length) upBtn.textContent = 'Attach'; } }, '\u2715 Remove'),
    ]))); };
    const reqCard = REQ.length ? h('div', { class: 'cp-card' }, [
      h('div', { class: 'cp-row-t' }, 'What we need from you'),
      ...REQ.map((r, i) => h('div', { style: 'display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.15)' }, [
        h('div', { style: 'width:26px;height:26px;border-radius:50%;flex:none;background:rgba(8,131,247,.15);color:#3b9dff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px' }, String(i + 1)),
        h('div', null, [h('div', { style: 'font-weight:700;font-size:.92rem' }, r.t), h('div', { class: 'cp-row-s' }, r.d)]),
      ])),
    ]) : null;

    // Upload block (documents also land in your Documents page + CC review)
    const fileIn = h('input', { type: 'file', style: 'font-size:.85rem' });
    const typeSel = h('select', { class: 'cp-input', style: 'max-width:220px' }, [
      ...(REQ.length ? REQ.map((r) => h('option', { value: r.type }, r.t.length > 34 ? r.t.slice(0, 34) + '\u2026' : r.t)) : []),
      h('option', { value: 'other' }, 'Other supporting document'),
    ]);
    const fmtHint = h('div', { class: 'cp-row-s', style: 'margin-top:4px' });
    const applyFmt9 = () => { const r = docFmt(typeSel.value); fileIn.accept = r.exts.map((e) => '.' + e).join(','); fmtHint.textContent = '\ud83d\udccc Required format: ' + r.label; };
    typeSel.addEventListener('change', applyFmt9); applyFmt9();
    const upMsg = h('div', { class: 'cp-row-s' });
    const upBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => {
      const btn9 = ev.currentTarget;
      const f = fileIn.files && fileIn.files[0]; if (!f) { upMsg.textContent = 'Choose a file first.'; return; }
      { const rule = docFmt(typeSel.value); const ex = extOf(f);
        if (rule.exts.indexOf(ex) < 0) {
          const _m = 'This document must be ' + (rule.exts.length === 1 ? rule.exts[0].toUpperCase() : rule.exts.map((e) => e.toUpperCase()).join('/')) + ' \u2014 ' + rule.label + '.';
          upMsg.textContent = _m; lbToast(_m, 'urgent', 'Wrong file format'); fileIn.value = ''; return;
        } }
      btn9.disabled = true; btn9.textContent = 'Uploading\u2026';
      try {
        const m = await uploadDocument(f, typeSel.value);
        await carrierUploadDocument({ type: typeSel.value, fileName: m.fileName, filePath: m.path });
        attached.push({ file_name: m.fileName, type: typeSel.value, path: m.path });
        drawAtt(); fileIn.value = '';
        upMsg.textContent = '\u2713 Attached (' + attached.length + ') \u2014 also sent to document review. You can add more.';
        btn9.textContent = '+ Add another document';
      } catch (e) { upMsg.textContent = (e && e.message) || 'Upload failed.'; btn9.textContent = 'Attach'; }
      btn9.disabled = false;
    } }, 'Attach');
    const msgIn = h('textarea', { class: 'cp-input', rows: '5', placeholder: paused
      ? '1) What caused it: \u2026\n2) What I fixed: \u2026\n3) How I\u2019ll prevent it: \u2026'
      : 'Root cause of the score drop: \u2026\nWhat I changed: \u2026\nHow I\u2019ll keep it from happening again: \u2026' });
    const subMsg = h('div', { class: 'cp-err' });
    const formCard = h('div', { class: 'cp-card' }, [
      h('div', { class: 'cp-row-t' }, paused ? 'Submit your reinstatement request' : 'Submit your plan of action'),
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px' }, [typeSel, fileIn, upBtn]),
      fmtHint, upMsg, attHost,
      h('div', { class: 'cp-row-s', style: 'margin:10px 0 4px;font-weight:700' }, 'Describe it (required)'),
      msgIn, subMsg,
      h('button', { class: 'cp-btn', style: 'margin-top:10px', onClick: async (ev) => {
        const btn9 = ev.currentTarget;
        const txt = (msgIn.value || '').trim();
        if (txt.length < 20) { subMsg.textContent = 'Please write at least a couple of sentences \u2014 what caused it, what you fixed, how you\u2019ll prevent it.'; return; }
        if (REQ.length && !attached.length && /insur|coi|fmcsa|authority/i.test(reason)) { subMsg.textContent = 'This pause requires a document \u2014 attach it above before submitting.'; return; }
        const _wantsDoc = (demand && /REQUIRED DOCUMENTS/i.test(demand.note || '')) || (needMore && /ATTACH THIS TIME/i.test(needMore.staff_note || ''));
        if (_wantsDoc && !attached.length) { const _m = 'The reviewer required a document with this answer \u2014 attach it above before submitting.'; subMsg.textContent = _m; lbToast(_m, 'urgent', 'Document required'); return; }
        btn9.disabled = true; btn9.textContent = 'Submitting\u2026';
        const finalTxt = (!paused && poaCtx && poaCtx.factors && poaCtx.factors.length) ? ('[Health ' + (poaCtx.tier || '') + ' ' + (poaCtx.score != null ? poaCtx.score + '/100' : '') + ' \u2014 factors: ' + poaCtx.factors.map((f) => f.label).join(', ') + ']\n' + txt) : txt;
        try { await submitReinstatement(finalTxt, attached, kind); try { sessionStorage.removeItem('lb:poa:ctx'); } catch (_) {} lbToast('Request submitted \u2014 review within 24 hours. Track it on this page.', 'success', 'Submitted \u2713'); loadReinstate(); }
        catch (e) { subMsg.textContent = (e && e.message) || 'Could not submit.'; btn9.disabled = false; btn9.textContent = paused ? 'Submit request' : 'Submit plan'; }
      } }, paused ? 'Submit request' : 'Submit plan'),
    ]);

    function histCard(list) {
      const past = (list || []).filter((r) => !(r.status === 'submitted' || r.status === 'in_review') || r.kind !== kind);
      if (!past.length && !(list || []).length) return null;
      const pillOf = (st) => st === 'approved' ? ['\u2713 Approved', 'rgba(22,163,74,.15)', '#4ade80'] : st === 'rejected' ? ['\u2715 Declined', 'rgba(239,68,68,.15)', '#f87171'] : st === 'in_review' ? ['\u23f3 In review', 'rgba(8,131,247,.15)', '#3b9dff'] : st === 'more_info' ? ['\u21a9 More info needed', 'rgba(217,119,6,.15)', '#fbbf24'] : ['\u2022 Submitted', 'rgba(217,119,6,.15)', '#fbbf24'];
      return h('div', { class: 'cp-card' }, [
        h('div', { class: 'cp-row-t' }, 'Previous requests'),
        ...(list || []).map((r) => { const pl = pillOf(r.status);
          const det = h('div', { style: 'display:none;margin-top:8px;background:rgba(8,131,247,.06);border:1px solid rgba(148,163,184,.2);border-radius:10px;padding:10px 12px' }, [
            h('div', { class: 'cp-row-s' }, 'Submitted: ' + new Date(r.created_at).toLocaleString() + (r.decided_at ? ' \u00b7 Decided: ' + new Date(r.decided_at).toLocaleString() : ' \u00b7 Decision pending')),
            r.pause_reason ? h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Account was paused for: ' + r.pause_reason) : null,
            h('div', { style: 'font-weight:700;font-size:.82rem;margin-top:8px' }, 'Your full answer:'),
            h('div', { class: 'cp-row-s', style: 'white-space:pre-wrap;margin-top:2px' }, r.message || ''),
            (Array.isArray(r.attachments) && r.attachments.length) ? h('div', { style: 'margin-top:8px' }, [
              h('div', { style: 'font-weight:700;font-size:.82rem' }, 'Documents you attached (' + r.attachments.length + '):'),
              ...r.attachments.map((a9) => h('div', { class: 'cp-row-s', style: 'padding:2px 0;cursor:pointer;color:#3b9dff', title: 'Open Documents to view/download it', onClick: (e9) => { e9.stopPropagation(); go('documents'); } }, '\ud83d\udcce ' + (a9.file_name || '') + ' (' + (a9.type || '') + ') \u2014 view in Documents \u2192')),
            ]) : h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, [
              'No documents were attached to this answer. ',
              h('span', { style: 'color:#3b9dff;cursor:pointer', onClick: (e9) => { e9.stopPropagation(); go('documents'); } }, 'Your uploads still live in Documents \u2192'),
            ]),
            r.staff_note ? h('div', { class: 'cp-row-s', style: 'margin-top:8px;background:' + (r.status === 'approved' ? 'rgba(22,163,74,.1)' : 'rgba(217,119,6,.1)') + ';border-radius:8px;padding:8px 10px' }, [h('b', null, 'Reviewer\u2019s note: '), r.staff_note]) : null,
            r.status === 'more_info' ? h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, '\u21a9 Submit again above with the missing information \u2014 this answer stays on record.') : null,
            r.status === 'rejected' ? h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'You can address the note and submit a fresh request above.') : null,
          ].filter(Boolean));
          const caret = h('span', { style: 'color:#3b9dff;font-weight:700;font-size:.8rem' }, '\u25be Details');
          const rowEl = h('div', { style: 'padding:10px 0;border-bottom:1px solid rgba(148,163,184,.15)' }, [
            h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer', onClick: () => { const on = det.style.display !== 'none'; det.style.display = on ? 'none' : 'block'; caret.textContent = on ? '\u25be Details' : '\u25b4 Hide'; } }, [
              h('span', { style: 'font-weight:700;font-size:.9rem' }, (r.kind === 'health_poa' ? 'Plan of action' : 'Reinstatement') + ' \u00b7 ' + new Date(r.created_at).toLocaleDateString()),
              h('span', { style: 'display:flex;gap:8px;align-items:center' }, [h('span', { class: 'cp-pill', style: 'background:' + pl[1] + ';color:' + pl[2] }, pl[0]), caret]),
            ]),
            h('div', { class: 'cp-row-s', style: 'margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.message),
            det,
          ]);
          return rowEl; }),
      ]);
    }

    if (!paused && kind === 'health_poa') { /* still allowed \u2014 POA any time health page sends them here */ }

    void histCard;
    mount(content, h('div', null, [head, reqCard, formCard, buildUnifiedCard()].filter(Boolean)));
  }

  async function loadHealth() {
    mount(content, h('div', { class: 'cp-muted' }, 'Calculating your rating…'));
    let mr = null; try { mr = await myRating(); } catch (_) { mr = null; }
    let ah; try { ah = await accountHealth(); } catch (e) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load account health.'))); return; }
    ah = ah || {}; const score = Number(ah.score || 0);
    const tone = toneOf(ah.tier === 'healthy' ? 'success' : ah.tier === 'building' ? 'info' : ah.tier === 'at_risk' ? 'warning' : 'urgent');
    const ded = Array.isArray(ah.deductions) ? ah.deductions : [];
    const lost = ded.reduce((a, x) => a + (Number(x.deducted) || 0), 0);
    const fixDest = (label) => { const t = (label || '').toLowerCase();
      if (/doc|insur|authorit|complian|coi|w-?9|agreement|bond|expir/.test(t)) return ['documents', 'Fix documents'];
      if (/dispute|invoice|fee|payment|settle|bank|payout/.test(t)) return ['finance', 'Open finance'];
      if (/on-?time|deliver|trip|dwell|late|pod/.test(t)) return ['trips', 'View trips'];
      if (/prefer|match|engage|profile|rate/.test(t)) return ['account', 'Update account'];
      return ['documents', 'Resolve']; };
    const gauge = h('div', { style: 'width:150px;height:150px;border-radius:50%;background:conic-gradient(' + tone.c + ' ' + score + '%, #e2e8f0 0);display:flex;align-items:center;justify-content:center;flex:none' },
      h('div', { style: 'width:116px;height:116px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center' }, [
        h('div', { style: 'font-size:2.6rem;font-weight:800;line-height:1;color:' + tone.c }, String(score)),
        h('div', { class: 'cp-row-s' }, 'of 100'),
      ]));
    const heroCard = h('div', { class: 'cp-card', style: 'border-top:4px solid ' + tone.c }, [
      cardHead('Account health', 'Live — recalculated every time you open this'),
      h('div', { style: 'display:flex;align-items:center;gap:20px;flex-wrap:wrap' }, [gauge,
        h('div', { style: 'flex:1;min-width:220px' }, [
          h('span', { class: 'cp-pill', style: 'background:' + tone.bg + ';color:' + tone.c + ';font-size:.95rem;font-weight:800' }, (ah.tier || 'unknown').replace(/_/g, ' ').toUpperCase()),
          h('div', { class: 'cp-row-t', style: 'margin-top:10px;font-size:1.05rem' }, ah.grace ? 'You are in the new-carrier Building period — we watch performance but nothing counts against you yet. Complete your documents to start strong.' : ded.length ? (ded.length + ' item(s) need attention — fixing them raises your score and your load offers.') : 'Perfect standing — you get first pick of the best-paying loads. Keep it up!'),
          h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, ah.basis || 'Score = 100 minus deductions for compliance gaps, late deliveries, disputes and missing documents.'),
        ])]),
    ]);
    const tiles = h('div', { class: 'cp-kpis' }, [
      statTile('Health score', String(score), 'shield', tone.name || (ah.tier === 'healthy' ? 'green' : ah.tier === 'at_risk' ? 'amber' : 'red')),
      statTile('Standing', (ah.tier || '—').replace(/_/g, ' '), 'dash', 'blue'),
      statTile('Points lost', '-' + lost, 'finance', lost ? 'amber' : 'green'),
      statTile('Open issues', String(ded.length), 'docs', ded.length ? 'red' : 'green', () => { const el2 = document.getElementById('cp-health-actions'); if (el2) el2.scrollIntoView({ behavior: 'smooth' }); }),
    ]);
    const grpsArr = Array.isArray(ah.groups) ? ah.groups : [];
    const GMETA = {
      reliability:   { ic: 'trips',   blurb: 'On-time deliveries (20) and cancellations (15)' },
      communication: { ic: 'bell',    blurb: 'Tracking, check-ins and responsiveness' },
      compliance:    { ic: 'docs',    blurb: 'Documents, authority and insurance' },
      conduct:       { ic: 'shield',  blurb: 'Warnings issued by LoadBoot staff' },
      financial:     { ic: 'finance', blurb: 'Dispatch fees and platform dues' },
    };
    const groupsCard = grpsArr.length ? h('div', { class: 'cp-card' }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap' }, [
        cardHead('Performance breakdown', 'Tap any area to see each metric — like it appears to our dispatch team'),
        h('span', { class: 'cp-pill', style: 'background:rgba(8,131,247,.12);color:#60A5FA;font-weight:800;flex:none' }, (ah.window_days || 180) + '-day rolling window'),
      ]),
      ah.grace ? h('div', { style: 'margin:2px 0 12px;padding:10px 14px;border-radius:12px;background:rgba(8,131,247,.10);border:1px solid rgba(8,131,247,.25);color:#93c5fd;font-size:.85rem;font-weight:600' },
        '\ud83d\udee1 Building period — you are new here. We watch these numbers but nothing counts against you until 5 delivered loads or 30 days. Use this time to learn the targets below.') : null,
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px' }, grpsArr.map(gp => {
        const w = Number(gp.weight) || 0, earned = Number(gp.earned) || 0;
        const pctW = w ? Math.round(earned / w * 100) : 100;
        const gc = pctW >= 100 ? '#22c55e' : pctW >= 60 ? '#f59e0b' : '#ef4444';
        const gbg = pctW >= 100 ? 'rgba(34,197,94,.12)' : pctW >= 60 ? 'rgba(245,158,11,.12)' : 'rgba(239,68,68,.12)';
        const meta = GMETA[gp.key] || { ic: 'dash', blurb: '' };
        const items = Array.isArray(gp.items) ? gp.items : [];
        const detail = h('div', { style: 'display:none;flex-direction:column;gap:10px;margin-top:12px' }, [
          ...items.map(it => {
            const dd = Number(it.deducted) || 0;
            const ic2 = dd > 0 ? '#ef4444' : it.state === 'review' ? '#fbbf24' : '#22c55e';
            return h('div', { style: 'border:1px solid var(--lb-line,#22314e);border-radius:12px;padding:11px 13px;background:rgba(255,255,255,.02)' }, [
              h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
                h('b', { style: 'font-size:.88rem' }, it.label || ''),
                dd > 0 ? h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.14);color:#f87171;font-weight:800;flex:none' }, '\u2212' + dd + ' pts')
                       : it.state === 'review' ? h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.14);color:#fbbf24;font-weight:800;flex:none' }, '\u23f3 in review \u00b7 no penalty')
                       : h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.14);color:#4ade80;font-weight:800;flex:none' }, '\u2713 on target'),
              ]),
              h('div', { style: 'display:flex;align-items:baseline;gap:10px;margin-top:8px;flex-wrap:wrap' }, [
                h('span', { style: 'font-size:1.35rem;font-weight:800;color:' + ic2 }, String(it.value ?? '\u2014')),
                h('span', { class: 'cp-row-s', style: 'font-weight:700' }, 'target ' + (it.target || '\u2014')),
              ]),
              h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, it.basis || ''),
              it.improve ? h('div', { class: 'cp-row-s', style: 'margin-top:5px;color:#60A5FA' }, '\u21b3 ' + it.improve) : null,
            ].filter(Boolean));
          }),
          Number(gp.expiring_soon) > 0 ? h('div', { style: 'border:1px solid rgba(245,158,11,.35);border-radius:12px;padding:10px 13px;background:rgba(245,158,11,.10);color:#fbbf24;font-size:.83rem;font-weight:700' },
            '\u26a0 ' + gp.expiring_soon + ' document(s) expiring within 30 days \u2014 replace them early so no points are lost.') : null,
        ].filter(Boolean));
        const chev = h('span', { style: 'font-size:.8rem;color:var(--lb-muted,#8ea2c3);transition:transform .15s;display:inline-block' }, '\u25be');
        const gcard = h('div', { style: 'border:1px solid var(--lb-line,#22314e);border-radius:14px;padding:14px 15px;cursor:pointer;transition:border-color .15s', onClick: () => {
          const open = detail.style.display !== 'none';
          detail.style.display = open ? 'none' : 'flex';
          chev.style.transform = open ? '' : 'rotate(180deg)';
          gcard.style.borderColor = open ? '' : gc;
        } }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
            h('div', { style: 'display:flex;align-items:center;gap:9px' }, [
              h('span', { style: 'width:34px;height:34px;border-radius:10px;background:' + gbg + ';display:inline-flex;align-items:center;justify-content:center;color:' + gc + ';flex:none' }, icon(meta.ic, 18)),
              h('div', null, [h('b', { style: 'font-size:.93rem;display:block' }, gp.label || gp.key), h('span', { class: 'cp-row-s' }, meta.blurb)]),
            ]),
            chev,
          ]),
          h('div', { style: 'display:flex;align-items:baseline;gap:6px;margin-top:12px' }, [
            h('span', { style: 'font-size:1.7rem;font-weight:800;color:' + gc }, String(earned)),
            h('span', { class: 'cp-row-s', style: 'font-weight:700' }, '/ ' + w + ' pts'),
            h('span', { class: 'cp-pill', style: 'margin-left:auto;background:' + gbg + ';color:' + gc + ';font-weight:800;flex:none' }, pctW >= 100 ? 'Excellent' : pctW >= 60 ? 'Attention' : 'At risk'),
          ]),
          h('div', { style: 'height:7px;border-radius:99px;background:rgba(148,163,184,.18);overflow:hidden;margin-top:9px' },
            h('div', { style: 'height:100%;width:' + Math.max(3, pctW) + '%;border-radius:99px;background:' + gc })),
          detail,
        ]);
        return gcard;
      })),
    ].filter(Boolean)) : null;
    const actions = h('div', { class: 'cp-card', id: 'cp-health-actions' }, [
      cardHead('What to fix today', ded.length ? ('Do these and you get ' + lost + ' points back') : 'Nothing to fix \u2014 you are all good'),
      ded.length ? h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, ded.map(x => {
        const dest = fixDest(x.label);
        return h('div', { class: 'cp-row', style: 'border-left:4px solid ' + tone.c + ';padding-left:12px;border-radius:8px' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, x.label), h('div', { class: 'cp-row-s' }, x.basis || ''), x.improve ? h('div', { class: 'cp-row-s', style: 'margin-top:3px;color:var(--lb-blue,#0883F7)' }, '\u21b3 ' + x.improve) : null].filter(Boolean)),
          h('div', { style: 'display:flex;gap:12px;align-items:center' }, [h('b', { style: 'color:' + tone.c }, '-' + x.deducted), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go(dest[0]) }, dest[1])]),
        ]);
      })) : h('div', { class: 'cp-row-s' }, 'No deductions. Every requirement is met — keep documents current and deliveries on time to stay here.'),
    ]);
    const explain = h('div', { class: 'cp-card' }, [cardHead('How your score works'),
      h('div', { class: 'cp-row-s', style: 'line-height:1.6' }, 'Your account starts at 100. Points come off for expired or missing compliance documents, late deliveries, open disputes, and incomplete dispatch preferences. A higher score means our AI Pilot and dispatchers surface the best-paying loads to you first — the same way a top-rated seller gets more buyers. Fix the items above to climb back to Healthy.')]);
    const trustCard = h('div', { class: 'cp-card' }, [cardHead('Trust profile', 'What brokers & shippers see about you'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let tp; try { tp = await myTrustProfile(); } catch (_) { trustCard.remove(); return; }
      if (!tp || !tp.exists) { trustCard.remove(); return; }
      const vtone = tp.verified ? toneOf('success') : toneOf('warning');
      const rating = Number(tp.rating || 0);
      const stars = '\u2605'.repeat(Math.round(rating)) + '\u2606'.repeat(5 - Math.round(rating));
      const docsOk = tp.docs_required > 0 && tp.docs_verified === tp.docs_required;
      mount(trustCard, [cardHead('Trust profile', 'What brokers & shippers see about you'),
        h('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' }, [
          h('span', { class: 'cp-pill', style: 'background:' + vtone.bg + ';color:' + vtone.c + ';font-weight:800' }, tp.verified ? '\u2713 ' + tp.verified_label : 'Not yet verified'),
          h('div', { style: 'font-size:1.35rem;color:#f59e0b;letter-spacing:3px' }, stars),
          h('b', null, rating.toFixed(1) + ' / 5'),
        ]),
        h('div', { class: 'cp-kpis', style: 'margin-top:12px' }, [
          statTile('Trust score', String(tp.trust_score || 0), 'shield', 'blue'),
          statTile('Docs verified', (tp.docs_verified || 0) + '/' + (tp.docs_required || 0), 'docs', docsOk ? 'green' : 'amber'),
          tp.on_time_pct != null ? statTile('On-time', tp.on_time_pct + '%', 'trips', tp.on_time_pct >= 90 ? 'green' : 'amber') : statTile('Deliveries', String(tp.deliveries || 0), 'trips', 'blue'),
          statTile('Member', (tp.tenure_months || 0) + ' mo', 'user', 'violet'),
        ]),
        h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, tp.verified ? 'You carry a verified badge \u2014 brokers can trust and book you faster.' : 'Get verified by completing your documents (see actions above). Verified accounts win more, better-paying loads.'),
      ]);
    })();
    const networkCard = h('div', { class: 'cp-card' }, [cardHead('Approved brokers', 'Your network'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let np; try { np = await myApprovedPartners(); } catch (_) { networkCard.remove(); return; }
      const ps = (np && np.partners) || [];
      if (!ps.length) { mount(networkCard, [cardHead('Approved brokers', 'Your network'), h('div', { class: 'cp-row-s' }, 'No approved brokers yet. When a broker approves your booking request they appear here \u2014 keep working with trusted partners through LoadBoot. Identities stay private.')]); return; }
      mount(networkCard, [cardHead('Approved brokers', ps.length + ' in your network'), h('div', null, ps.map(pp => {
        const vt = toneOf(pp.verified ? 'success' : 'info');
        const stars = pp.rating ? '\u2605'.repeat(Math.round(pp.rating)) + '\u2606'.repeat(5 - Math.round(pp.rating)) : '';
        return h('div', { class: 'cp-row', style: 'border-left:4px solid ' + vt.c + ';padding-left:10px;border-radius:8px' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, 'Broker ' + (pp.ref || '\u2014') + (pp.verified ? ' \u2713' : '')), h('div', { class: 'cp-row-s' }, [pp.deals + ' approved load(s)', pp.trust_score != null ? 'Trust ' + pp.trust_score + '/100' : null, stars].filter(Boolean).join(' \u00b7 '))]),
          h('span', { class: 'cp-pill', style: 'background:' + vt.bg + ';color:' + vt.c }, pp.verified ? 'Verified' : 'Unverified'),
        ]);
      }))]);
    })();
    const _bar = (label, valueTxt, pct, color) => h('div', { style: 'margin:10px 0' }, [
      h('div', { style: 'height:10px;border-radius:99px;background:#e2e8f0;overflow:hidden' },
        h('div', { style: 'height:100%;width:' + Math.max(3, Math.min(100, pct)) + '%;border-radius:99px;background:' + color })),
      h('div', { style: 'font-weight:800;font-size:14px;margin-top:6px' }, [label + ': ', h('span', { style: 'font-weight:700' }, valueTxt)]),
    ]);
    const _avg = mr && mr.avg != null ? Number(mr.avg) : null;
    const ratingCard = mr ? h('div', { class: 'cp-card' }, [
      h('div', { style: 'text-align:center;padding:6px 0 2px' }, [
        h('div', { style: 'font-size:1.35rem;font-weight:800' }, _avg == null ? 'No ratings yet' : (_avg >= 4.7 ? 'Excellent' : _avg >= 4.2 ? 'Great' : _avg >= 3.5 ? 'Good' : 'Needs work')),
        _avg != null ? h('div', { style: 'margin-top:4px' }, [starsRow(_avg, 20), h('b', { style: 'margin-left:8px;font-size:1.1rem' }, String(_avg))]) : h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Ratings come from brokers and shippers after delivered trips.'),
      ]),
      _avg != null ? _bar('Average rating', String(_avg) + ' / 5', _avg / 5 * 100, '#F97316') : null,
      _bar('Trips completed', String(mr.trips_completed || 0), Math.min(100, (mr.trips_completed || 0) * 4), '#0883F7'),
      mr.on_time_pct != null ? _bar('On-time delivery', mr.on_time_pct + '%', Number(mr.on_time_pct), '#16a34a') : null,
      h('div', { class: 'cp-kpis', style: 'margin-top:10px' }, [
        h('div', { class: 'cp-kpi' }, [h('div', { class: 'cp-stat-v', style: 'font-weight:800;font-size:1.3rem' }, String(mr.count || 0)), h('div', { class: 'cp-row-s' }, 'reviews')]),
        h('div', { class: 'cp-kpi' }, [h('div', { class: 'cp-stat-v', style: 'font-weight:800;font-size:1.3rem' }, String(mr.trips_completed || 0)), h('div', { class: 'cp-row-s' }, 'trips')]),
        h('div', { class: 'cp-kpi' }, [h('div', { class: 'cp-stat-v', style: 'font-weight:800;font-size:1.3rem' }, String(mr.to_rate || 0)), h('div', { class: 'cp-row-s' }, 'to rate')]),
      ]),
      (mr.to_rate || 0) > 0 ? h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: () => go('trips') }, 'Rate your recent trips →') : null,
    ].filter(Boolean)) : null;
    const reviewsCard = (mr && mr.reviews && mr.reviews.length) ? h('div', { class: 'cp-card' }, [
      cardHead(String(mr.count || mr.reviews.length) + ' reviews', 'From brokers & shippers on your delivered trips'),
      h('div', null, mr.reviews.map(r => h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, [starsRow(r.stars, 13), h('span', { style: 'margin-left:8px' }, r.comment || '')]), h('div', { class: 'cp-row-s' }, 'by ' + (r.by || '') + ' · ' + String(r.at || '').slice(0, 10))]),
      ]))),
    ]) : null;
    const poaCard = (ah.tier === 'at_risk' || ah.tier === 'critical') ? h('div', { class: 'cp-card', style: 'border-color:rgba(217,119,6,.4)' }, [
      h('div', { class: 'cp-row-t' }, '\ud83d\udccb Answer for this drop \u2014 submit a plan of action'),
      h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Your score is in the ' + (ah.tier === 'critical' ? 'critical' : 'at-risk') + ' zone. Per LoadBoot policy, tell us what caused it, what you fixed, and how you\u2019ll prevent it \u2014 our team reviews it within 24 hours and it is kept on your record.'),
      h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px', onClick: () => {
        try { sessionStorage.setItem('lb:poa:ctx', JSON.stringify({ tier: ah.tier, score: score, factors: ded.slice().sort((a, b) => (Number(b.deducted) || 0) - (Number(a.deducted) || 0)).slice(0, 4).map((x) => ({ label: x.label || x.key || '', lost: Number(x.deducted) || 0 })) })); } catch (_) {}
        go('reinstate');
      } }, 'Submit plan of action \u2192'),
    ]) : null;
    const strikesCard = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-row-t' }, '\u26a1 What exactly is hitting your score'), h('div', { class: 'cp-row-s' }, 'Loading\u2026')]);
    (async () => {
      let ms = null; try { ms = await myStrikes(); } catch (_) { strikesCard.remove(); return; }
      const sts = (ms && ms.strikes) || []; const adjs = (ms && ms.adjustments) || [];
      if (!sts.length && !adjs.length) { strikesCard.remove(); return; }
      const dleft = (iso) => { const dd = Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5); return dd > 0 ? dd + ' days left' : 'expiring'; };
      mount(strikesCard, [
        h('div', { class: 'cp-row-t' }, '\u26a1 What exactly is hitting your score'),
        h('div', { class: 'cp-row-s', style: 'margin-top:2px' }, 'Every strike and staff adjustment, item by item \u2014 with its exact points, expiry and the way out.'),
        ...sts.map((v9) => {
          const sv = String(v9.severity || 'warning');
          const col = v9.resolved ? '#4ade80' : sv === 'critical' ? '#f87171' : sv === 'violation' ? '#fb923c' : '#fbbf24';
          return h('div', { style: 'border:1px solid rgba(148,163,184,.2);border-left:4px solid ' + col + ';border-radius:10px;padding:9px 12px;margin-top:8px' }, [
            h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center' }, [
              h('span', { style: 'font-weight:800;font-size:.85rem;color:' + col }, (v9.resolved ? '\u2713 RESOLVED \u2014 ' : '') + sv.toUpperCase() + ' \u00b7 \u2212' + v9.points + ' points'),
              h('span', { class: 'cp-row-s', style: 'font-size:.75rem' }, new Date(v9.at).toLocaleDateString() + (v9.resolved ? '' : ' \u00b7 auto-expires ' + new Date(v9.expires).toLocaleDateString() + ' (' + dleft(v9.expires) + ')')),
            ]),
            h('div', { class: 'cp-row-s', style: 'margin-top:3px' }, v9.note || ''),
            v9.resolved ? null : h('div', { class: 'cp-row-s', style: 'margin-top:3px;color:#3b9dff' }, '\u21b3 Way out: fix the cited issue and keep clean \u2014 it auto-expires on the date above, or LoadBoot resolves it early once corrected.'),
          ].filter(Boolean));
        }),
        ...adjs.map((a9) => h('div', { style: 'border:1px solid rgba(148,163,184,.2);border-left:4px solid ' + (a9.points > 0 ? '#4ade80' : '#f87171') + ';border-radius:10px;padding:9px 12px;margin-top:8px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center' }, [
            h('span', { style: 'font-weight:800;font-size:.85rem;color:' + (a9.points > 0 ? '#4ade80' : '#f87171') }, 'STAFF ADJUSTMENT \u00b7 ' + (a9.points > 0 ? '+' : '') + a9.points + ' points \u2014 ' + (a9.factor || 'account')),
            h('span', { class: 'cp-row-s', style: 'font-size:.75rem' }, new Date(a9.at).toLocaleDateString() + (a9.expires ? ' \u00b7 expires ' + new Date(a9.expires).toLocaleDateString() : '')),
          ]),
          h('div', { class: 'cp-row-s', style: 'margin-top:3px' }, a9.reason || ''),
          a9.fix ? h('div', { class: 'cp-row-s', style: 'margin-top:3px;color:#3b9dff' }, '\u21b3 How to fix: ' + a9.fix) : null,
        ].filter(Boolean))),
      ].filter(Boolean));
    })();
    mount(content, h('div', null, [tiles, heroCard, poaCard, strikesCard, actions, groupsCard, ratingCard, reviewsCard, trustCard, networkCard, explain].filter(Boolean)));
  }
  /* ----- Settings (inDrive pattern): appearance, notifications, availability ----- */
  function loadSettings() {
    const seg = (cur, onPick) => h('div', { class: 'cpx-seg' }, [['off', 'Off'], ['on', 'On'], ['system', 'System']].map(([v, l]) =>
      h('button', { class: v === cur ? 'on' : '', onClick: (ev) => { onPick(v); Array.from(ev.currentTarget.parentNode.children).forEach(b => b.classList.toggle('on', b === ev.currentTarget)); } }, l)));
    const themeCard = h('div', { class: 'cp-card' }, [
      h('h3', { class: 'cp-row-t', style: 'margin:0 0 4px' }, 'Appearance'),
      h('div', { class: 'cpx-set-row' }, [
        h('div', null, [h('div', { class: 'cpx-set-t' }, '🌙 Dark mode'), h('div', { class: 'cpx-set-s' }, 'System follows your device setting')]),
        seg(themeMode(), (v) => setThemeMode(v)),
      ]),
    ]);
    let pushCard = null;
    if (pushSupported()) {
      const st = h('span', { class: 'cp-pill gray' }, 'checking…');
      const btn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Enabling…';
        try { await enablePush('Carrier portal'); st.textContent = 'on'; st.className = 'cp-pill green'; ev.currentTarget.textContent = 'On ✓'; }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Turn on'; alert((e && e.message) || 'Could not enable notifications.'); }
      } }, 'Turn on');
      isPushEnabled().then(on => { st.textContent = on ? 'on' : 'off'; st.className = 'cp-pill ' + (on ? 'green' : 'gray'); if (on) { btn.textContent = 'On ✓'; btn.disabled = true; } }).catch(() => {});
      pushCard = h('div', { class: 'cp-card' }, [
        h('h3', { class: 'cp-row-t', style: 'margin:0 0 4px' }, 'Notifications'),
        h('div', { class: 'cpx-set-row' }, [
          h('div', null, [h('div', { class: 'cpx-set-t' }, '🔔 Push notifications'), h('div', { class: 'cpx-set-s' }, 'Trips, payments and announcements on this device')]),
          h('div', { style: 'margin-left:auto;display:flex;gap:8px;align-items:center' }, [st, btn]),
        ]),
      ]);
    }
    const availBtn = h('button', { class: 'cpx-avail ' + (_dp && _dp.available === false ? 'off' : 'on'), onClick: async () => { await toggleAvail(); availBtn.textContent = availPill.textContent; availBtn.className = availPill.className; }, style: 'margin-left:auto' }, (_dp && _dp.available === false) ? 'Offline' : 'Online');
    const availCard = h('div', { class: 'cp-card' }, [
      h('h3', { class: 'cp-row-t', style: 'margin:0 0 4px' }, 'Availability'),
      h('div', { class: 'cpx-set-row' }, [
        h('div', null, [h('div', { class: 'cpx-set-t' }, '🚛 Available for loads'), h('div', { class: 'cpx-set-s' }, 'Offline = dispatch pauses new load matches for you')]),
        availBtn,
      ]),
    ]);
    const cpmIn = h('input', { class: 'cp-in', type: 'number', step: '0.01', placeholder: 'e.g. 1.85', value: (_dp && _dp.cost_per_mile) || '', style: 'max-width:130px;margin:0' });
    const cpmSave = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
      ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
      try {
        await setDispatchPrefs({ min_rpm: (_dp && _dp.min_rpm) || null, preferred_equipment: (_dp && _dp.preferred_equipment) || [],
          preferred_lanes: (_dp && _dp.preferred_lanes) || [], home_base: (_dp && _dp.home_base) || null,
          max_deadhead_miles: (_dp && _dp.max_deadhead_miles) || null, notes: (_dp && _dp.notes) || null, cost_per_mile: cpmIn.value || null });
        if (_dp) _dp.cost_per_mile = cpmIn.value || null;
        ev.currentTarget.textContent = 'Saved ✓';
      } catch (e) { ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
      ev.currentTarget.disabled = false;
    } }, 'Save');
    const cpmCard = h('div', { class: 'cp-card' }, [
      h('h3', { class: 'cp-row-t', style: 'margin:0 0 4px' }, 'Profit engine'),
      h('div', { class: 'cpx-set-row' }, [
        h('div', null, [h('div', { class: 'cpx-set-t' }, '💰 My all-in cost per mile'), h('div', { class: 'cpx-set-s' }, 'Fuel + truck + insurance + fees per mile. Every load card then shows your estimated profit.')]),
        h('div', { style: 'margin-left:auto;display:flex;gap:8px;align-items:center' }, [cpmIn, cpmSave]),
      ]),
    ]);
    // Customize — the carrier picks their own 5 bottom-bar shortcuts. Persisted, applies instantly.
    const tabsCard = (() => {
      const sel = tabPrefs().slice();
      const hint = h('div', { class: 'cpx-set-s', style: 'margin-top:6px' }, sel.length + '/5 selected — tap to change, applies instantly.');
      const wrap = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px' }, NAV.map(([id, label]) => {
        const b = h('button', { class: 'cpx-tabpick' + (sel.includes(id) ? ' on' : ''), onClick: () => {
          const i = sel.indexOf(id);
          if (i >= 0) { if (sel.length <= 1) { hint.textContent = 'Keep at least 1 shortcut.'; return; } sel.splice(i, 1); b.classList.remove('on'); }
          else { if (sel.length >= 5) { hint.textContent = 'Max 5 — unselect one first.'; return; } sel.push(id); b.classList.add('on'); }
          hint.textContent = sel.length + '/5 selected — saved ✓';
          try { localStorage.setItem('lb_tabs', JSON.stringify(sel)); } catch (_) {}
          refreshTabbar();
        } }, label);
        return b;
      }));
      return h('div', { class: 'cp-card' }, [
        h('h3', { class: 'cp-row-t', style: 'margin:0 0 4px' }, 'Customize'),
        h('div', null, [h('div', { class: 'cpx-set-t' }, '📱 Bottom tab bar — your shortcuts'), hint, wrap]),
      ]);
    })();
    const acctCard = h('div', { class: 'cp-card' }, [
      h('h3', { class: 'cp-row-t', style: 'margin:0 0 4px' }, 'Account'),
      h('div', { class: 'cpx-set-row' }, [h('div', { class: 'cpx-set-t' }, 'Profile, preferences & compliance'), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-left:auto', onClick: () => go('account') }, 'Open')]),
      h('div', { class: 'cpx-set-row' }, [h('div', { class: 'cpx-set-t' }, 'Documents'), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-left:auto', onClick: () => go('documents') }, 'Open')]),
      h('div', { class: 'cpx-set-row' }, [h('div', { class: 'cpx-set-t' }, 'Sign out'), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-left:auto', onClick: async () => { await signOut(); location.reload(); } }, 'Sign out')]),
    ]);
    mount(content, h('div', null, [themeCard, cpmCard, pushCard, availCard, tabsCard, acctCard].filter(Boolean)));
  }

  async function loadDashboard() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let dash = null, comp, anns, invs;
    try {
      let trips9 = [], rate9 = [];
      [dash, comp, anns, invs, trips9, rate9] = await Promise.all([
        carrierDashboard().catch(() => null),
        pocketCompliance().catch(() => ({ requirements: [], mandatory_ok: ov.compliance_ok })),
        pocketAnnouncements().catch(() => []),
        pocketInvoices(50).catch(() => []),
        pocketTrips(10).catch(() => []),
        carrierRateableTrips(5).catch(() => []),
      ]);
      window.__dashTrips = trips9 || [];
      window.__dashRateables = (rate9 || []).filter(r9 => { try { return !localStorage.getItem('lb:rated:' + r9.trip_id); } catch (_) { return true; } });
    } catch (_) {}
    const d = dash || {}; const k = d.kpis || {}; const acct = d.account || {};

    // 1) "Complete your setup" — gaps coloured by the GLOBAL tone tokens, each linking to the exact step.
    const gaps = Array.isArray(d.setup_gaps) ? d.setup_gaps : [];
    const setupCard = gaps.length ? h('div', { class: 'cp-card' }, [
      cardHead('Complete your setup', acct.onboarding_complete ? 'Almost there' : 'Action needed'),
      h('div', null, gaps.map(g => { const t = toneOf(g.tone); return h('button', {
        class: 'cp-rowbtn', style: 'border-left:4px solid ' + t.c + ';background:' + t.bg,
        onClick: () => {
          const _r = (g.route || '/account').replace('/', '');
          const _isDocs = _r === 'documents' || g.key === 'compliance';
          const _isOnb = /onboard/i.test(String(g.label || '') + String(g.key || ''));
          if (_isDocs) { try { sessionStorage.setItem('lb:onb:jump', '4'); } catch (_) {} go('onboarding'); return; } // straight to the Documents step
          if (_isOnb) {
            try { const _rej3 = ((comp && comp.requirements) || []).some(r => ['rejected', 'expired'].indexOf(String(r.status || '').toLowerCase()) >= 0); if (_rej3) sessionStorage.setItem('lb:onb:jump', '4'); } catch (_) {}
            go('onboarding'); return;
          }
          go(_r);
        } }, [
        h('span', null, [h('span', { style: 'color:' + t.c + ';font-weight:700;margin-right:8px' }, t.label), g.label]),
        h('span', { class: 'cp-go', style: 'color:' + t.c }, '›')]); })),
    ]) : null;

    // 2) Notifications from Command Center — global tone colours, unread markers, mark-read.
    const nd = d.notifications || {}; const notes = (Array.isArray(nd.recent) ? nd.recent : []).filter(n => !n.read_at); const unread = nd.unread || 0;
    const notifCard = h('div', { class: 'cp-card' }, [
      cardHead('Notifications', unread ? unread + ' unread' : 'All caught up', () => go('notifications')),
      notes.length ? h('div', null, notes.map(n => { const p = n.payload || {}; const t = toneOf(p.tone); const isUnread = !n.read_at;
        const row = h('div', { class: 'cp-row', style: 'border-left:4px solid ' + t.c + ';padding-left:10px;background:' + (isUnread ? t.bg : 'transparent') + ';cursor:pointer', title: 'Open the page this notification is about', onClick: async () => { try { await pocketMarkNotificationRead(n.id); } catch (_) {} go(lbNotifDest(n, p)); } }, [
          h('div', null, [
            h('div', { class: 'cp-row-t' }, [isUnread ? h('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + t.c + ';margin-right:6px' }) : null, p.title || n.template_key || 'Notification'].filter(Boolean)),
            p.body ? h('div', { class: 'cp-row-s' }, p.body) : null].filter(Boolean)),
          isUnread ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { ev.stopPropagation(); const btn9 = ev.currentTarget; btn9.disabled = true; btn9.textContent = '\u2026';
            try { await pocketMarkNotificationRead(n.id); } catch (e9) { try { await markMyNotification(n.id); } catch (e8) { btn9.disabled = false; btn9.textContent = 'Mark read'; lbToast((e8 && e8.message) || 'Could not mark read \u2014 check connection.', 'urgent', 'Not marked'); return; } }
            row.remove(); } }, 'Mark read') : null].filter(Boolean));
        return row; }))
        : h('div', { class: 'cp-muted' }, 'All caught up \u2014 older notifications are under \u201cView all\u201d.'),
    ]);

    // 3) KPI strip from the aggregate (falls back to overview).
    const kpis = h('div', { class: 'cp-kpis' }, [
      statTile('Active trips', String(k.active_trips ?? ov.trips_active ?? 0), 'trips', 'blue', () => go('trips')),
      statTile('Offers for you', String(k.open_offers ?? 0), 'docs', 'violet', () => go('loads')),
      statTile('Delivered this week', String(k.delivered_this_week ?? 0), 'dash', 'green', () => go('trips')),
      statTile('Revenue this week', money(k.revenue_this_week ?? 0), 'finance', 'amber', () => go('finance')),
    ]);

    // 4) Active trips.
    const trips = Array.isArray(d.active_trips) ? d.active_trips : [];
    const tripsCard = h('div', { class: 'cp-card cp-col2' }, [
      cardHead('Active trips', trips.length ? trips.length + ' moving' : 'None active', () => go('trips')),
      trips.length ? h('div', null, trips.slice(0, 6).map(t => h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, (t.origin || '—') + ' → ' + (t.destination || '—')),
          h('div', { class: 'cp-row-s' }, [t.status, t.miles ? t.miles + ' mi' : null, t.rate ? money(t.rate) : null].filter(Boolean).join(' · '))]),
        pill(t.status)])))
        : h('div', { class: 'cp-muted' }, 'No active trips. Browse available loads to book.'),
    ]);

    // finance mini-chart from recent invoices (kept).
    const feeSeries = (invs || []).slice(0, 12).reverse().map((i, kk) => ({ label: String(kk), value: Number(i.fee) || 0 }));
    const due = (invs || []).filter(i => i.status === 'sent').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const paid = (invs || []).filter(i => i.status === 'paid').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const financeCard = h('div', { class: 'cp-card' }, [
      cardHead('Dispatch fees', 'Recent invoices', () => go('finance')),
      feeSeries.length ? miniBars(feeSeries, { height: 70 }) : h('div', { class: 'cp-muted' }, 'No invoices yet.'),
      h('div', { class: 'cp-legend' }, [h('span', null, ['Due ', h('b', null, money(due))]), h('span', null, ['Paid ', h('b', null, money(paid))])]),
    ]);
    const annCards = (anns || []).map(a => h('div', { class: 'cp-ann ' + (a.kind || 'info') }, [h('div', { class: 'cp-ann-t' }, a.title), a.body ? h('div', { class: 'cp-ann-b' }, a.body) : null].filter(Boolean)));

    const acctStrip = h('div', { class: 'cp-card cp-row-click', style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer', onClick: () => go('account') }, [
      h('div', null, [h('div', { class: 'cp-row-t' }, 'Account status'), h('div', { class: 'cp-row-s' }, 'Verification & onboarding - tap to review')]),
      h('div', { style: 'display:flex;gap:8px;align-items:center' }, [
        pill(acct.onboarding_stage || ov.onboarding_stage || 'pending'),
        h('span', { class: 'cp-pill ' + (ov.compliance_ok ? 'green' : 'amber') }, ov.compliance_ok ? 'Compliant' : 'Docs needed'),
        h('button', { class: 'cp-btn cp-btn-sm' + (ov.compliance_ok ? '' : ' cp-attn-pulse'), onClick: (e) => { e.stopPropagation(); go('account'); } }, 'Review'),
      ]),
    ]);
    // Premium onboarding strip (prototype design) — % = real profile completeness.
    const _obDone = !!acct.onboarding_complete;
    const _obStage = String(acct.onboarding_stage || ov.onboarding_stage || '').toLowerCase();
    const _obSubmitted = ['submitted', 'in_review', 'review', 'compliance_check', 'changes_requested'].indexOf(_obStage) >= 0;
    let _obPct = _obDone ? 100 : 0;
    const _obRing = h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:conic-gradient(#0883F7 0%, rgba(255,255,255,.1) 0);display:flex;align-items:center;justify-content:center;box-shadow:0 0 26px -6px rgba(8,131,247,.55)' },
      h('div', { style: 'width:52px;height:52px;border-radius:50%;background:#111c31;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px' }, '\u2026'));
    const _obBtn = h('button', { class: 'cp-btn', style: 'margin:0;background:linear-gradient(135deg,#0883F7,#3b9dff);box-shadow:0 10px 26px -10px rgba(8,131,247,.65)', onClick: () => {
      try { const _rej2 = ((comp && comp.requirements) || []).some(r => ['rejected', 'expired'].indexOf(String(r.status || '').toLowerCase()) >= 0); if (_rej2) sessionStorage.setItem('lb:onb:jump', '4'); } catch (_) {}
      go('onboarding');
    } }, 'Submit Your Profile \u2192');
    const _approvedHero = h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(52,211,153,.45);margin-bottom:14px;background:linear-gradient(135deg,rgba(52,211,153,.08),transparent)' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(52,211,153,.16);color:#34d399;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;box-shadow:0 0 26px -8px rgba(52,211,153,.6)' }, '\ud83c\udf89'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'Approved \u2014 booking is unlocked'),
        h('div', { class: 'cp-row-s' }, 'Your documents are verified and your account is live. Direct broker requests and the load board are open for you.'),
      ]),
      h('button', { class: 'cp-btn', style: 'margin:0;background:linear-gradient(135deg,#16a34a,#34d399)', onClick: () => go('loads') }, 'Start booking loads \u2192'),
    ]);
    const _rejReqs = ((comp && comp.requirements) || []).filter(r => ['rejected', 'expired'].indexOf(String(r.status || '').toLowerCase()) >= 0);
    const _fixHero = _rejReqs.length ? h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(239,68,68,.45);margin-bottom:14px;background:linear-gradient(135deg,rgba(239,68,68,.08),transparent)' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(239,68,68,.14);color:#f87171;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px' }, '\u26a0'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, _rejReqs.length + ' document(s) need your action'),
        h('div', { class: 'cp-row-s' }, _rejReqs.map(r => r.name + (r.note ? ' \u2014 ' + r.note : '')).join('  \u00b7  ')),
      ]),
      h('button', { class: 'cp-btn', style: 'margin:0;background:linear-gradient(135deg,#dc2626,#f87171)', onClick: () => { try { sessionStorage.setItem('lb:onb:jump', '4'); } catch (_) {} go('onboarding'); } }, 'Fix now \u2192'),
    ]) : null;
    const _compOk = (comp && typeof comp.mandatory_ok === 'boolean') ? comp.mandatory_ok : ov.compliance_ok;
    const _docsOkHero = h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(59,157,255,.35);margin-bottom:14px' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(59,157,255,.14);color:#3b9dff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px' }, '\ud83d\udd0e'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'Documents verified \u2713 \u2014 final approval in progress'),
        h('div', { class: 'cp-row-s' }, 'Every document passed review. Our team gives the final sign-off \u2014 you\u2019ll be notified the moment booking unlocks.'),
      ]),
      h('button', { class: 'cp-btn ghost', style: 'margin:0', onClick: () => go('account') }, 'View status'),
    ]);
    const _pausedHero = (ov.account_status === 'paused') ? h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(239,68,68,.45);margin-bottom:14px' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(239,68,68,.15);color:#f87171;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px' }, '\u23f8'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem;color:#f87171' }, 'Account paused \u2014 ' + (ov.pause_scope === 'booking' ? 'booking is blocked' : 'all services blocked')),
        h('div', { class: 'cp-row-s' }, ov.pause_reason ? ('Reason: ' + ov.pause_reason) : 'LoadBoot has paused your account.'),
        h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Resolve the issue above and contact dispatch \u2014 accounts are reinstated the moment the issue is fixed.'),
      ]),
      h('button', { class: 'cp-btn', style: 'margin:0', onClick: () => go('reinstate') }, 'Request reinstatement \u2192'),
    ]) : null;
    const _poaHero = (!_pausedHero && ov.poa_required) ? h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(217,119,6,.45);margin-bottom:14px' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(217,119,6,.15);color:#fbbf24;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px' }, '\ud83d\udccb'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem;color:#fbbf24' }, 'Plan of action required \u2014 ' + (ov.poa_required.factor || 'account health')),
        h('div', { class: 'cp-row-s' }, 'LoadBoot review has demanded a written answer. Your account stays flagged until you respond.'),
      ]),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        h('button', { class: 'cp-btn', style: 'margin:0', onClick: () => go('reinstate') }, 'Answer now \u2192'),
        (ov.appeal_open && (ov.appeal_open.status === 'submitted' || ov.appeal_open.status === 'in_review')) ? h('button', { class: 'cp-btn ghost', style: 'margin:0', onClick: () => go('reinstate') }, '\u23f3 Track submitted request') : null,
      ].filter(Boolean)),
    ]) : null;
    const _ap = ov.appeal_open || null;
    const _moreInfoHero = (!_pausedHero && _ap && _ap.status === 'more_info') ? h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(217,119,6,.45);margin-bottom:14px' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(217,119,6,.15);color:#fbbf24;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px' }, '\u21a9'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem;color:#fbbf24' }, (lbTeamOf(_ap.staff_note) || 'Reviewer') + ' replied \u2014 more information required'),
        h('div', { class: 'cp-row-s' }, _ap.staff_note ? ('\u201c' + String(_ap.staff_note).slice(0, 120) + '\u201d') : 'Open your request to see exactly what is missing, then submit again.'),
      ]),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        h('button', { class: 'cp-btn', style: 'margin:0', onClick: () => go('reinstate') }, 'Reply now \u2192'),
        h('button', { class: 'cp-btn ghost', style: 'margin:0', onClick: () => go('reinstate') }, '\ud83d\udcac Conversation & status'),
      ]),
    ]) : null;
    const _reviewHero = (!_pausedHero && !_moreInfoHero && _ap && (_ap.status === 'submitted' || _ap.status === 'in_review')) ? h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(8,131,247,.4);margin-bottom:14px' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(8,131,247,.14);color:#3b9dff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px' }, '\u23f3'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, (_ap.kind === 'health_poa' ? 'Plan of action' : 'Reinstatement request') + ' \u2014 ' + (_ap.status === 'in_review' ? 'being reviewed right now' : 'submitted, under review')),
        h('div', { class: 'cp-row-s' }, 'Sent ' + new Date(_ap.at).toLocaleString() + ' \u00b7 decision within 24 hours \u00b7 you\u2019ll be notified here + by email.'),
      ]),
      h('button', { class: 'cp-btn ghost', style: 'margin:0', onClick: () => go('reinstate') }, 'Track request \u2192'),
    ]) : null;
    const _revokedHero = (_obStage === 'rejected' && !_fixHero) ? h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(239,68,68,.45);margin-bottom:14px' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(239,68,68,.15);color:#f87171;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px' }, '\u26d4'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem;color:#f87171' }, 'Account access revoked \u2014 booking is locked'),
        h('div', { class: 'cp-row-s' }, 'LoadBoot review has revoked your approval. Check your notifications for the reason \u2014 fix what was cited, or talk to support to get reinstated.'),
      ]),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        h('button', { class: 'cp-btn', style: 'margin:0', onClick: () => go('support') }, '\ud83c\udfa7 Contact support'),
        h('button', { class: 'cp-btn ghost', style: 'margin:0', onClick: () => go('account') }, 'Review my account'),
      ]),
    ]) : null;
    const onbHero = _pausedHero ? _pausedHero : _revokedHero ? _revokedHero : _moreInfoHero ? _moreInfoHero : _poaHero ? _poaHero : _reviewHero ? _reviewHero : _fixHero ? _fixHero : (_obDone && _compOk) ? _approvedHero : (_compOk && _obSubmitted) ? _docsOkHero : _obDone ? null : _obSubmitted ? h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(52,211,153,.3);margin-bottom:14px' }, [
      h('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:rgba(52,211,153,.14);color:#34d399;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;box-shadow:0 0 26px -8px rgba(52,211,153,.5)' }, '\u2713'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'Profile submitted \u2014 under review'),
        h('div', { class: 'cp-row-s' }, 'Our team is verifying your details and documents. You\u2019ll get a notification the moment you\u2019re approved and booking unlocks.'),
      ]),
      h('button', { class: 'cp-btn ghost', style: 'margin:0', onClick: () => go('account') }, 'View status'),
    ]) : h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-color:rgba(59,157,255,.28);margin-bottom:14px' }, [
      _obRing,
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'Submit your profile to get loads'),
        h('div', { class: 'cp-row-s' }, 'Enter your DOT \u2014 we auto-fill from FMCSA. ~5 minutes.'),
      ]),
      _obBtn,
    ]);
    if (onbHero) (async () => { try {
      const pr = (await pocketGetProfile()) || {};
      const parts = [pr.company, pr.contact_name, pr.phone, (pr.mc || pr.dot), pr.home_base, ((pr.equipment_types || []).length ? '1' : ''), pr.factoring_status];
      const done = parts.filter((x) => x != null && String(x).trim() !== '').length;
      _obPct = Math.round((done / parts.length) * 100);
      _obRing.style.background = 'conic-gradient(#0883F7 ' + _obPct + '%, rgba(255,255,255,.1) 0)';
      _obRing.firstChild.textContent = _obPct + '%';
      _obBtn.textContent = (_obPct > 0 ? 'Resume onboarding \u2192' : 'Submit Your Profile \u2192');
    } catch (_) { _obRing.firstChild.textContent = '0%'; } })();
    const _dueAmt = (invs || []).filter(i => i.status === 'sent').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const topBanners = [
      (_obDone && comp && comp.mandatory_ok === false) ? h('button', { class: 'cpx-banner red', onClick: () => go('documents') }, [h('span', null, '⚠'), h('span', null, 'Please verify your compliance documents'), h('span', { class: 'cpx-b-go' }, '›')]) : null,
      _dueAmt > 0 ? h('button', { class: 'cpx-banner amber', onClick: () => go('finance') }, [h('span', null, 'ℹ'), h('span', null, money(_dueAmt) + ' in dispatch fees due — pays off in Finance, clears when LoadBoot confirms your receipt'), h('span', { class: 'cpx-b-go' }, '›')]) : null,
    ].filter(Boolean);
    // 📥 money OWED TO YOU by brokers (direct-pay) — live banner, disappears once everything is confirmed received
    (async () => {
      try {
        const d9 = await payDueItems();
        const recv9 = (d9 && d9.receivables) || [];
        const owed9 = recv9.filter((x9) => x9.transfer_status !== 'received' && x9.kind !== 'platform_fee');
        const amt9 = owed9.filter((x9) => !x9.transfer_status).reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
        const fly9 = owed9.filter((x9) => x9.transfer_status === 'sent').reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
        if (amt9 <= 0 && fly9 <= 0) return;
        const host9 = document.getElementById('lb-recv-banner'); if (!host9) return;
        host9.appendChild(h('button', { class: 'cpx-banner', style: 'background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.35);color:#4ade80', onClick: () => { window.__finSec9 = 'in'; go('finance'); } }, [
          h('span', null, '📥'),
          h('span', null, (amt9 > 0 ? money(amt9) + ' owed to you by brokers' : '') + (amt9 > 0 && fly9 > 0 ? ' · ' : '') + (fly9 > 0 ? money(fly9) + ' on the way — tap ✓ Received when it lands' : '')),
          h('span', { class: 'cpx-b-go' }, '›'),
        ]));
      } catch (_) {}
    })();
    topBanners.push(h('div', { id: 'lb-recv-banner' }));
    const activeTrip9 = (window.__dashTrips || []).find(t9 => ['planned', 'dispatched', 'in_transit'].indexOf(String(t9.status || '')) >= 0);
    if (activeTrip9) { try { ensureLiveLoc(activeTrip9.id); } catch (_) {} }
    const tripHero9 = activeTrip9 ? (() => {
      const t9 = activeTrip9;
      const inTr9 = t9.status === 'in_transit';
      const stTxt9 = inTr9 ? '\ud83d\udef0 ON THE ROAD \u2014 tracking live' : (t9.status === 'dispatched' ? '\ud83d\udced At pickup \u2014 check in / load' : '\u25b6 Booked \u2014 ready to start');
      const cnt9 = h('b', { style: 'font-variant-numeric:tabular-nums' }, '');
      if (t9.status === 'planned' && t9.scheduled_pickup) {
        // drive-time hint from live GPS -> "leave by" / "ROLL NOW"
        let leave9 = '';
        try {
          const pos9 = window.__lbPos;
          if (pos9 && t9.pickup_lat != null && t9.pickup_lng != null) {
            const dh9 = havMi(pos9.coords.latitude, pos9.coords.longitude, t9.pickup_lat, t9.pickup_lng) * 1.2;
            const driveMs9 = (dh9 / 52) * 3600000;
            const leaveAt9 = new Date(t9.scheduled_pickup).getTime() - driveMs9 - 20 * 60000; // 20 min buffer
            leave9 = { at: leaveAt9, dh: Math.round(dh9), h: Math.round((dh9 / 52) * 10) / 10 };
          }
        } catch (_) {}
        const tick9 = () => {
          if (cnt9.__t && !cnt9.isConnected) { clearInterval(cnt9.__t); return; }
          const ms9 = new Date(t9.scheduled_pickup).getTime() - Date.now();
          if (ms9 <= 0) { cnt9.textContent = '\u26a0 PICKUP OVERDUE \u2014 roll now'; cnt9.style.color = '#fecaca'; return; }
          const hh9 = Math.floor(ms9 / 3600000), mm9 = Math.floor((ms9 % 3600000) / 60000);
          let txt9 = '\u23f1 Pickup in ' + (hh9 > 0 ? hh9 + 'h ' : '') + mm9 + 'm \u00b7 due ' + new Date(t9.scheduled_pickup).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          if (leave9) {
            if (Date.now() >= leave9.at) { txt9 += '  \u00b7  \ud83d\udd34 ROLL NOW \u2014 ~' + leave9.h + 'h drive (' + leave9.dh + ' mi), leave immediately to make it'; cnt9.style.color = '#fecaca'; }
            else { txt9 += '  \u00b7  \ud83d\ude9b leave by ' + new Date(leave9.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' (~' + leave9.h + 'h drive \u00b7 ' + leave9.dh + ' mi)'; }
          }
          cnt9.textContent = txt9;
        };
        tick9(); cnt9.__t = setInterval(tick9, 30000);
      } else cnt9.textContent = '';
      return h('div', {
        style: 'position:relative;overflow:hidden;border-radius:18px;padding:18px 20px;margin-bottom:14px;cursor:pointer;background:linear-gradient(120deg,#0b1a33,#10305e 55%,#0883F7);border:1.5px solid rgba(8,131,247,.55);box-shadow:0 18px 44px -18px rgba(8,131,247,.5)',
        onClick: () => go('loads'),
      }, [
        h('div', { style: 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(600px 200px at 85% -20%,rgba(252,83,5,.25),transparent 60%)' }),
        h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;position:relative' }, [
          h('div', null, [
            h('div', { style: 'display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:4px 12px;font-size:.7rem;font-weight:800;color:#fff;letter-spacing:.06em' }, [
              h('span', { style: 'width:8px;height:8px;border-radius:50%;background:' + (inTr9 ? '#22c55e' : '#FC5305') + ';box-shadow:0 0 0 4px ' + (inTr9 ? 'rgba(34,197,94,.25)' : 'rgba(252,83,5,.25)') + ';animation:pulse 1.6s infinite' }),
              'ACTIVE TRIP \u00b7 ' + stTxt9,
            ]),
            h('div', { style: 'font-weight:800;font-size:1.12rem;color:#fff;margin-top:9px' }, (t9.origin || '\u2014') + ' \u2192 ' + (t9.destination || '\u2014')),
            h('div', { style: 'color:#bcd3f2;font-size:.8rem;margin-top:3px' }, [(t9.rate ? '$' + Number(t9.rate).toLocaleString() : null), (t9.miles ? Number(t9.miles).toLocaleString() + ' mi' : null)].filter(Boolean).join(' \u00b7 ')),
            h('div', { style: 'color:#ffd7c2;font-size:.86rem;font-weight:800;margin-top:6px' }, cnt9),
            (t9.status === 'planned') ? h('div', { style: 'margin-top:8px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.38);border-radius:10px;padding:8px 12px;font-size:.76rem;line-height:1.5;color:#bbf7d0;font-weight:700;max-width:480px' },
              '\ud83d\udef0 Tracking is ON since booking \u2014 your GPS proof records automatically (keep the app open while working this load). Tap \u201cStart your trip\u201d when you roll: it opens turn-by-turn navigation and the status then updates on its own from your movement.') : null,
            inTr9 ? h('div', { style: 'margin-top:8px;background:rgba(34,197,94,.13);border:1px solid rgba(34,197,94,.4);border-radius:10px;padding:7px 12px;font-size:.76rem;font-weight:800;color:#86efac;max-width:480px' },
              '\ud83d\udef0 Tracking LIVE \u2014 locked on until delivery. Your GPS is your evidence.') : null,
          ]),
          h('button', { class: 'cp-btn', style: 'background:#FC5305;border:0;font-weight:800;box-shadow:0 10px 26px -10px rgba(252,83,5,.8)', onClick: (e9) => { e9.stopPropagation(); go('loads'); } },
            inTr9 ? '\ud83d\uddfa Open trip map' : '\u25b6 ' + (t9.status === 'planned' ? 'Start your trip' : 'Continue trip')),
        ]),
      ]);
    })() : null;
    const rateCard9 = (window.__dashRateables && window.__dashRateables.length) ? (() => {
      const r9 = window.__dashRateables[0];
      const card9 = h('div', { class: 'cp-card', style: 'position:relative;border:1.5px solid rgba(245,158,11,.45);background:linear-gradient(120deg,rgba(245,158,11,.07),transparent 60%)' });
      const dismiss9 = h('button', { title: 'Not now', style: 'position:absolute;top:10px;right:12px;border:0;background:transparent;color:#94a3b8;font-size:1.05rem;cursor:pointer;font-weight:800', onClick: () => { try { localStorage.setItem('lb:rated:' + r9.trip_id, 'skip'); } catch (_) {} card9.remove(); } }, '\u2715');
      let stars9 = 0; const starBtns9 = [];
      const paint9 = () => starBtns9.forEach((b9, i9) => { b9.textContent = i9 < stars9 ? '\u2b50' : '\u2606'; b9.style.filter = i9 < stars9 ? 'none' : 'grayscale(1)'; b9.style.transform = i9 < stars9 ? 'scale(1.12)' : 'scale(1)'; });
      for (let i9 = 0; i9 < 5; i9++) starBtns9.push(h('button', { style: 'border:0;background:transparent;font-size:1.9rem;cursor:pointer;transition:transform .12s;padding:2px 4px;color:#fbbf24;text-shadow:0 0 1px #fbbf24', onClick: () => { stars9 = i9 + 1; paint9(); } }, '\u2606'));
      const cm9 = h('input', { class: 'cp-in', placeholder: 'Optional \u2014 one line about this broker (payment, dock, communication)', style: 'margin:8px 0 0' });
      const send9 = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px', onClick: async () => {
        if (!stars9) { lbToast('Tap the stars first \u2014 1 to 5.', 'action', 'Pick a rating'); return; }
        send9.disabled = true; send9.textContent = 'Sending\u2026';
        try {
          await rateCounterparty(r9.trip_id, stars9, cm9.value.trim() || null);
          try { localStorage.setItem('lb:rated:' + r9.trip_id, String(stars9)); } catch (_) {}
          card9.replaceChildren(h('div', { style: 'text-align:center;padding:8px 0' }, [
            h('div', { style: 'font-size:1.6rem' }, '\u2705'),
            h('div', { class: 'cp-row-t' }, 'Thanks \u2014 rated ' + stars9 + '\u2605'),
            h('div', { class: 'cp-row-s' }, 'Your rating updates ' + (r9.broker || 'the broker') + '\u2019s live score for every carrier.'),
          ]));
          setTimeout(() => { try { card9.remove(); } catch (_) {} }, 3500);
        } catch (e9) { send9.disabled = false; send9.textContent = 'Submit rating'; lbToast((e9 && e9.message) || 'Could not submit.', 'urgent', 'Rating failed'); }
      } }, 'Submit rating');
      card9.append(dismiss9,
        h('div', { class: 'cp-row-t', style: 'font-size:1.02rem' }, '\u2b50 Rate this broker \u2014 ' + (r9.broker || 'your broker')),
        h('div', { class: 'cp-row-s', style: 'margin-top:2px' }, 'Trip-verified: ' + (r9.origin || '') + ' \u2192 ' + (r9.destination || '') + ' \u00b7 your stars go on the broker\u2019s public score \u2014 payment speed, dock experience, communication'),
        h('div', { style: 'margin-top:6px' }, starBtns9), cm9, send9);
      return card9;
    })() : null;
    const noaDash9 = h('div');
    (async () => {
      try {
        const pp9 = await myPaymentProfile();
        if (!(pp9 && pp9.factoring_noa)) return;
        let docs9 = []; try { docs9 = await carrierListDocuments(); } catch (_) {}
        if ((docs9 || []).some((d9) => d9.type === 'noa')) return;
        const bIn9 = h('input', { type: 'file', accept: '.pdf', style: 'font-size:.85rem' });
        const bSt9 = h('span', { style: 'font-size:.8rem;color:#f87171;font-weight:700' });
        mount(noaDash9, h('div', { class: 'cp-card', style: 'border:1.5px solid rgba(139,92,246,.5);background:rgba(139,92,246,.08)' }, [
          h('div', { style: 'font-weight:900' }, '🏦 One step left on factoring — upload your NOA letter'),
          h('div', { class: 'cp-row-s', style: 'margin:4px 0 8px;line-height:1.6' }, 'You activated factoring with ' + (pp9.factoring_company || 'your factor') + ' but the Notice of Assignment letter (PDF from your factor) is not on file. Upload it right here — LoadBoot verifies it and brokers see “verified” on every pay panel.'),
          h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
            bIn9,
            h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev9) => { const b9 = ev9.currentTarget;
              const f9 = bIn9.files && bIn9.files[0]; if (!f9) { bSt9.textContent = 'Choose the NOA PDF first.'; return; }
              b9.disabled = true; b9.textContent = 'Uploading\u2026';
              try {
                const m9 = await uploadDocument(f9, 'noa');
                await carrierUploadDocument({ type: 'noa', fileName: m9.fileName, filePath: m9.path });
                mount(noaDash9, h('div', { class: 'cp-card', style: 'border:1.5px solid rgba(34,197,94,.45);background:rgba(34,197,94,.08)' }, [
                  h('div', { style: 'font-weight:900;color:#4ade80' }, '✓ NOA letter uploaded — in review'),
                  h('div', { class: 'cp-row-s', style: 'margin-top:3px' }, 'LoadBoot verifies it against your remit-to details (usually a few hours). Track it in Documents — this card disappears on your next visit.'),
                ]));
              } catch (e9) { b9.disabled = false; b9.textContent = 'Upload NOA'; bSt9.textContent = (e9 && e9.message) || 'Upload failed.'; }
            } }, 'Upload NOA'),
            h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => go('documents') }, 'Open Documents'),
            bSt9,
          ]),
        ]));
      } catch (_) {}
    })();
    mount(content, h('div', null, [tripHero9, rateCard9, onbHero, noaDash9, ...topBanners, kpis, acctStrip, setupCard, promptHost, ...annCards, h('div', { class: 'cp-grid' }, [notifCard, tripsCard, financeCard])].filter(Boolean)));
    openPrompts();
  }

  /* ----- Available loads (Phase 2B — real, race-safe booking) ----- */
  function openBrokerPacketPreview() {
    openModal('\ud83c\udfe2 Broker packet \u2014 what YOU get', [h('div', { style: 'text-align:center;padding:6px 4px 2px' }, [
      h('div', { style: 'width:74px;height:74px;border-radius:22px;margin:6px auto 12px;display:flex;align-items:center;justify-content:center;font-size:2rem;background:linear-gradient(135deg,#0b1830,#14335c);color:#fff;box-shadow:0 16px 34px -16px rgba(2,12,30,.55)' }, '\ud83d\udd12'),
      h('div', { style: 'font-weight:800;font-size:1.08rem' }, 'Locked \u2014 unlocks the moment your request is accepted / you book'),
      h('div', { class: 'cp-muted', style: 'max-width:470px;margin:6px auto 14px' }, 'On the board the broker stays anonymous \u2014 but every broker here is already LoadBoot-verified. The second you book, the full packet lands in your Dispatch pack:'),
      h('div', { style: 'text-align:left;max-width:440px;margin:0 auto;background:rgba(8,131,247,.07);border:1px solid rgba(8,131,247,.25);border-radius:14px;padding:14px 16px' }, [
        h('div', { style: 'font-weight:800;font-size:.74rem;letter-spacing:.08em;margin-bottom:8px;opacity:.75' }, 'WHAT YOU GET ONCE YOUR REQUEST IS ACCEPTED'),
        ...[['\ud83d\udccd', 'Exact facility street addresses (pickup & delivery)'],
            ['\ud83d\udce6', 'Pickup / release number + delivery number + appointment confirmation'],
            ['\ud83e\uddfe', 'Executed rate confirmation \u2014 signed by the broker + LoadBoot'],
            ['\ud83d\udcdc', 'Broker\u2019s MC authority \u2014 LoadBoot-verified \u2713'],
            ['\ud83d\udcb0', '$75,000 BMC-84 surety bond \u2014 on file \u2713'],
            ['\ud83d\udcc4', 'Broker W-9 + signed broker agreement \u2713'],
            ['\ud83d\udcb3', 'Documented settlement through LoadBoot \u2014 you never chase an invoice']].map(([i9, t9]) =>
          h('div', { style: 'display:flex;gap:9px;padding:5px 0;font-size:.86rem' }, [h('span', null, i9), h('span', null, t9)])),
      ]),
      h('div', { class: 'cp-muted', style: 'margin-top:12px;font-size:.78rem' }, 'Find it after booking: My Loads \u2192 open the trip \u2192 \ud83d\udd13 Dispatch pack.'),
    ])]);
  }
  async function loadLoads() {
    // \ud83d\udd12 LOCATION IS MANDATORY for the Load Board — real deadhead, geofenced check-ins,
    // anti-fraud. No GPS permission = the tab stays locked.
    const pos9 = await new Promise((res9) => {
      if (!navigator.geolocation) return res9(null);
      navigator.geolocation.getCurrentPosition((p9) => res9(p9), () => res9(null), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });
    if (!pos9) {
      mount(content, h('div', { class: 'cp-card', style: 'max-width:560px;margin:40px auto;text-align:center;padding:36px 28px' }, [
        h('div', { style: 'font-size:52px;line-height:1' }, '\ud83d\udccd'),
        h('div', { class: 'cp-row-t', style: 'font-size:1.2rem;margin:14px 0 6px' }, 'Turn on location to open the Load Board'),
        h('div', { class: 'cp-muted', style: 'line-height:1.7;margin-bottom:10px' }, 'LoadBoot shows REAL road deadhead from where your truck is right now to every pickup \u2014 and uses geofenced GPS check-ins as your proof for detention and on-time pay. Without your location the board would show you wrong numbers, so it stays locked.'),
        h('div', { style: 'background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.25);border-radius:12px;padding:10px 14px;font-size:.8rem;text-align:left;margin-bottom:14px' }, [
          '\u2713 Used only while you use the app \u2014 shown to brokers only AFTER you book their load', h('br'),
          '\u2713 Powers real deadhead miles, arrival proof and detention evidence', h('br'),
          '\u2713 Never sold, never shared outside your booked trips',
        ]),
        h('button', { class: 'cp-btn', style: 'width:100%', onClick: () => loadLoads() }, '\ud83d\udccd Enable location & open the board'),
        h('div', { class: 'cp-muted', style: 'font-size:.72rem;margin-top:10px' }, 'Blocked it by mistake? Tap the \ud83d\udd12/\u24d8 icon in the address bar \u2192 Site settings \u2192 Location \u2192 Allow, then press the button again.'),
      ]));
      return;
    }
    window.__lbPos = pos9;
    // Dispatch preferences drive matching — nudge (action tone) until they are set.
    (async () => {
      try {
        const dp = await getDispatchPrefs();
        if (dp && (dp.min_rpm || (dp.preferred_equipment && dp.preferred_equipment.length) || (dp.preferred_lanes && dp.preferred_lanes.length))) return;
        const tone = toneOf('action');
        const bn = h('div', { class: 'cp-card', style: 'border-left:4px solid ' + tone.c + ';background:' + tone.bg + ';display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, 'Set your dispatch preferences'), h('div', { class: 'cp-row-s' }, 'Minimum rate, equipment and lanes are required for best-match loads — the AI Pilot and your dispatcher match with these.')]),
          h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('account') }, 'Set now'),
        ]);
        if (content.firstChild) content.insertBefore(bn, content.firstChild); else content.appendChild(bn);
      } catch (_) {}
    })();
    mount(content, h('div', { class: 'cp-muted' }, 'Loading available loads…'));
    let __cap9 = null; try { __cap9 = await myCapacity(); } catch (_) {}
    const capNudge = (__cap9 && __cap9.at_capacity) ? h('div', { class: 'cp-card', style: 'border-left:4px solid #f59e0b;margin-bottom:12px' }, [
      h('div', { class: 'cp-row-t' }, '\ud83d\ude9a All your trucks are booked (' + __cap9.active_trips + '/' + __cap9.capacity + ')'),
      h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'You can book another load only when a truck frees up. Add another truck to book more loads at the same time \u2014 each truck runs its own load with its own driver.'),
      h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: () => go('fleet') }, '+ Add a truck to book more'),
    ]) : null;
    // DIRECT REQUESTS — loads a broker posted straight onto THIS carrier's profile (load_offers).
    // Broker side is already collected/approved; the carrier only has to accept before expiry.
    const reqHost = h('div');
    const availWrap = h('div');
    const tabBtn = (label) => h('button', { style: 'flex:1;border:0;border-radius:12px;padding:12px;font-weight:800;font-size:.92rem;cursor:pointer;font-family:Manrope,sans-serif;background:transparent;color:var(--lb-muted,#8ea2c3);transition:all .15s' }, label);
    const tbReq = tabBtn('\ud83d\udce8 Requests'), tbAv = tabBtn('\ud83c\udf10 Available loads');
    const tabsBar = h('div', { style: 'display:flex;gap:6px;background:rgba(255,255,255,.04);border:1px solid var(--lb-line,#22314e);border-radius:14px;padding:5px;margin-bottom:12px' }, [tbReq, tbAv]);
    const setTab = (which) => {
      const on = 'background:#0883F7;color:#fff;box-shadow:0 4px 14px rgba(8,131,247,.35)';
      const off = 'background:transparent;color:var(--lb-muted,#8ea2c3);box-shadow:none';
      tbReq.style.cssText += ';' + (which === 'req' ? on : off);
      tbAv.style.cssText += ';' + (which === 'av' ? on : off);
      reqHost.style.display = which === 'req' ? '' : 'none';
      availWrap.style.display = which === 'av' ? '' : 'none';
    };
    tbReq.onclick = () => setTab('req'); tbAv.onclick = () => setTab('av');
    setTab('av');
    reqHost.appendChild(h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'Checking for direct requests\u2026')));
    (async () => {
      let offers = []; try { offers = await carrierOffers(50) || []; } catch (_) { offers = []; }
      offers = offers.filter(o => (o.status === 'sent' || o.status === 'viewed') && (!o.expiry_at || new Date(o.expiry_at) > new Date()));
      reqHost.innerHTML = '';
      tbReq.textContent = '\ud83d\udce8 Requests' + (offers.length ? ' (' + offers.length + ')' : '');
      if (!offers.length) {
        reqHost.appendChild(h('div', { class: 'cp-card' }, [h('div', { class: 'cp-row-t' }, 'No direct requests right now'), h('div', { class: 'cp-row-s' }, 'When a verified broker posts a load straight to your profile it lands here with an expiry timer. Browse Available loads meanwhile.')]));
        return;
      }
      setTab('req');
      const abRow2 = (color, letter, txt) => h('div', { style: 'display:flex;align-items:center;gap:9px;padding:2px 0' }, [
        h('span', { style: 'width:18px;height:18px;border-radius:50%;background:' + color + ';color:#ffffff;font-weight:900;font-size:10.5px;display:inline-flex;align-items:center;justify-content:center;flex:none' }, letter),
        h('span', { style: 'font-weight:700;font-size:.9rem' }, txt || '—'),
      ]);
      const cardR = h('div', { class: 'cp-card', style: 'border:1px solid rgba(252,83,5,.4);box-shadow:0 0 22px rgba(252,83,5,.08)' }, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px' }, [
          h('b', { style: 'font-size:1.02rem' }, '\ud83d\udce8 Requests for you'),
          h('span', { class: 'cp-pill', style: 'background:rgba(252,83,5,.14);color:#FC5305;font-weight:800' }, offers.length + ' direct from brokers'),
        ]),
        h('div', { class: 'cp-row-s', style: 'margin-bottom:10px' }, 'A verified broker posted these straight to your profile. Everything is already vetted on the broker side — you just accept before the timer runs out.'),
        h('div', null, offers.map(o => {
          const box = h('div', { style: 'border:1px solid var(--lb-line,#22314e);border-radius:14px;padding:13px 14px;margin-bottom:10px' });
          const exp = o.expiry_at ? new Date(o.expiry_at).getTime() : null;
          const cd = h('b', { style: 'color:#FC5305;font-variant-numeric:tabular-nums;font-size:1.02rem' }, '\u2014');
          box.appendChild(h('div', { style: 'margin:2px 0 6px' }, h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'font-size:.72rem;padding:4px 11px', onClick: () => openBrokerPacketPreview() }, '\ud83c\udfe2 Broker packet \ud83d\udd12 \u2014 what you get once accepted')));
          box.appendChild(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 6px' }, [
            (o.details && Array.isArray(o.details.stops) && o.details.stops.length) ? h('button', { class: 'cpx-chip', style: 'background:rgba(139,92,246,.16);color:#c4b5fd;font-weight:800;border:1px solid rgba(139,92,246,.35);cursor:pointer;font:inherit', title: 'Tap for the stop-by-stop route', onClick: (e9) => { e9.stopPropagation(); lbStopsModal9(o); } }, '\ud83d\udfe3 +' + o.details.stops.length + ' STOP' + (o.details.stops.length > 1 ? 'S' : '') + ' \u00b7 ' + o.details.stops.map((s9) => s9.city || '?').join(' \u2192 ') + ' \u203a') : null,
          (o.details && o.details.team_required) ? h('span', { class: 'cpx-chip', style: 'background:rgba(245,158,11,.18);color:#fbbf24;font-weight:800;border:1px solid rgba(245,158,11,.35)' }, '\u26a0 \ud83d\udc65 TEAM DRIVERS REQUIRED') : h('span', { class: 'cpx-chip', style: 'background:rgba(148,163,184,.12);color:#94a3b8;font-weight:700' }, '\ud83d\udc64 Solo OK'),
            (o.details && o.details.driver_assist_required) ? h('span', { class: 'cpx-chip', style: 'background:rgba(245,158,11,.16);color:#fbbf24;font-weight:800' }, '\u26a0 DRIVER ASSIST REQUIRED') : null,
            o.hazmat ? h('span', { class: 'cpx-chip', style: 'background:rgba(239,68,68,.15);color:#f87171;font-weight:800' }, '\u2622 HAZMAT') : null,
            (o.details && o.details.temperature) ? h('span', { class: 'cpx-chip' }, '\u2744 ' + o.details.temperature + '\u00b0F') : null,
            ...lbFeasChips(o),
          ].filter(Boolean)));
          if (exp) {
            let _wc = false;
            const tick = () => {
              if (cd.isConnected) _wc = true;
              else { if (_wc) clearInterval(iv); return; }
              let d2 = Math.floor((exp - Date.now()) / 1000);
              if (d2 <= 0) { cd.textContent = 'expired'; cd.style.color = '#f87171'; clearInterval(iv); box.style.opacity = '.5'; return; }
              const mm = Math.floor(d2 / 60), ss = d2 % 60;
              cd.textContent = (mm >= 60 ? Math.floor(mm / 60) + 'h ' : '') + (mm % 60) + 'm ' + String(ss).padStart(2, '0') + 's';
              if (d2 < 300) cd.style.color = '#f87171';
            };
            const iv = setInterval(tick, 1000); tick();
          } else cd.textContent = 'no expiry';
          const acc = h('button', { style: 'flex:1;border:0;border-radius:12px;padding:12px;font-weight:900;font-size:.95rem;cursor:pointer;background:#FC5305;color:#ffffff;font-family:Manrope,sans-serif;box-shadow:0 0 14px rgba(252,83,5,.25)', onClick: async (ev) => {
            const _b = ev.currentTarget; _b.disabled = true; _b.textContent = 'Booking…';
            try {
              await offerRespond(o.id, 'accept');
              lbToast('Load booked — it is now in My Loads. Your pickup countdown has started.', 'success', 'Request accepted \u2713');
              go('trips');
            } catch (e) { _b.disabled = false; _b.textContent = 'Accept \u00b7 ' + money(o.offered_rate || 0); lbToast((e && e.message) || 'Could not accept.', 'urgent', 'Accept failed'); }
          } }, 'Accept \u00b7 ' + money(o.offered_rate || 0));
          const dec = h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'flex:none', onClick: async (ev) => {
            const why = prompt('Decline this request — reason (goes to the broker):'); if (!why) return;
            ev.currentTarget.disabled = true;
            try { await offerRespond(o.id, 'decline', { reason: why }); box.remove(); lbToast('Request declined.', 'info', 'Declined'); }
            catch (e) { ev.currentTarget.disabled = false; lbToast((e && e.message) || 'Could not decline.', 'urgent', 'Failed'); }
          } }, 'Decline');
          const _gr = Number(o.offered_rate || o.load_rate || 0), _net2 = Math.round(_gr * 0.95 * 100) / 100;
          const fmtD = (d2) => d2 ? new Date(d2 + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : null;
          const chip2 = (txt, urgent2) => txt ? h('span', { style: 'background:' + (urgent2 ? 'rgba(239,68,68,.15)' : 'rgba(8,131,247,.12)') + ';color:' + (urgent2 ? '#f87171' : '#60A5FA') + ';font-size:.74rem;font-weight:800;padding:5px 10px;border-radius:9px;white-space:nowrap' }, txt) : null;
          const dRow = (label2, val2) => val2 ? h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:3px 0' }, [h('span', { class: 'cp-row-s', style: 'flex:none' }, label2), h('span', { style: 'font-size:.85rem;font-weight:700;text-align:right' }, val2)]) : null;
          box.append(
            h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:flex-start' }, [
              h('div', { style: 'min-width:0' }, [
                h('div', { class: 'cp-row-s', style: 'font-weight:800;margin-bottom:4px' }, '\ud83c\udfe2 ' + (o.broker || 'Verified broker')),
                abRow2('#0883F7', 'A', (o.origin || '\u2014') + (fmtD(o.pickup_date) ? '  \u00b7 ' + fmtD(o.pickup_date) : '') + (o.pickup_time ? ' ' + o.pickup_time : '')),
                abRow2('#FC5305', 'B', (o.destination || '\u2014') + (fmtD(o.delivery_date) ? '  \u00b7 ' + fmtD(o.delivery_date) : '') + (o.delivery_time ? ' ' + o.delivery_time : '')),
              ]),
              h('div', { style: 'text-align:right;flex:none' }, [
                h('div', { style: 'font-size:1.35rem;font-weight:900' }, money(_gr)),
                o.rpm ? h('div', { class: 'cp-row-s', style: 'font-weight:700' }, '$' + Number(o.rpm).toFixed(2) + '/mi' + (o.miles ? ' \u00b7 ' + o.miles + ' mi' : '')) : null,
                h('div', { class: 'cp-row-s', style: 'color:#4ade80;font-weight:800' }, 'Net ' + money(_net2) + ' after 5%'),
              ].filter(Boolean)),
            ]),
            h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:9px 0 4px' }, [
              chip2(o.equipment), chip2(o.commodity), chip2(o.weight),
              o.deadhead != null ? chip2(o.deadhead + ' mi deadhead') : null,
              o.hazmat ? chip2('\u2622 HAZMAT', true) : null,
            ].filter(Boolean)),
            h('div', { style: 'margin:4px 0 6px' }, [
              dRow('Requirements', o.requirements),
              dRow('Load notes', o.notes),
              o.message ? h('div', { style: 'margin-top:7px;padding:9px 12px;border-radius:11px;background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.2);font-size:.84rem;font-weight:600;color:#9fc3f5' }, '\ud83d\udcac ' + o.message) : null,
            ].filter(Boolean)),
            (() => {
              // Your protections — the load's REAL accessorial rate card (detention, TONU, layover, lumper)
              const protHost = h('div', { style: 'margin:6px 0 4px' }, h('div', { class: 'cp-row-s' }, 'Loading rate card\u2026'));
              (async () => {
                let det2 = null; try { det2 = await carrierLoadDetail(o.load_id); } catch (_) {}
                const a2 = (det2 && det2.terms && det2.terms.accessorials) || {};
                const pr = (label2, val2) => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:3px 0' }, [
                  h('span', { class: 'cp-row-s' }, label2),
                  h('span', { style: 'font-size:.84rem;font-weight:800;color:' + (val2 ? '#4ade80' : '#f59e0b') }, val2 || 'not set \u2014 platform standard applies'),
                ]);
                mount(protHost, h('div', { style: 'border:1px solid rgba(74,222,128,.25);background:rgba(74,222,128,.05);border-radius:12px;padding:10px 13px' }, [
                  h('div', { style: 'font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#4ade80;margin-bottom:4px' }, '\ud83d\udee1 Your protections on this load'),
                  pr('Detention', a2.detention_per_hr ? ('$' + a2.detention_per_hr + '/hr after ' + (a2.detention_free_hours || 2) + 'h free') : null),
                  pr('TONU (truck ordered, not used)', a2.tonu ? ('$' + a2.tonu) : null),
                  pr('Layover', a2.layover_per_day ? ('$' + a2.layover_per_day + '/day') : null),
                  pr('Lumper', a2.lumper_policy || null),
                  h('div', { class: 'cp-row-s', style: 'margin-top:5px' }, 'All of these are auto-tracked from your GPS Arrive/Depart stamps \u2014 claims file themselves with proof.'),
                ]));
              })();
              return protHost;
            })(),
            h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'width:100%;margin:2px 0 8px', onClick: () => showLoadDetail(o.load_id) }, '\ud83d\udd0d View full load details \u2014 windows, stops, instructions, poster record'),
            h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin:2px 0 10px' }, [
              h('span', { class: 'cp-row-s', style: 'font-weight:800' }, '\u23f3 Expires in'), cd,
            ]),
            h('div', { style: 'display:flex;gap:8px' }, [acc, dec]),
            h('div', { class: 'cp-row-s', style: 'margin-top:8px;text-align:center' }, 'Accepting books this load instantly \u2014 rate confirmation and dispatch sheet are issued to your Documents automatically.'),
          );
          try { offerRespond(o.id, 'view').catch(() => {}); } catch (_) {}
          return box;
        })),
      ]);
      reqHost.appendChild(cardR);
    })();
    // Post-a-Truck: silent background scan picks up new matches for active postings.
    (async () => { try { await scanTruckMatches(); refreshUnread(); } catch (_) {} })();
    let postings = []; try { postings = await myTruckPostings(); } catch (_) { postings = []; }
    let _pk = null; try { _pk = await myOnboardingPacket(); } catch (_) {}
    const hazItems9 = (((_pk && _pk.items) || []).filter(x => /^hazmat/i.test(String(x.key || ''))));
    const hazVerified = hazItems9.length > 0 && hazItems9.every(x => ['verified', 'valid', 'approved'].indexOf(String(x.status || '').toLowerCase()) >= 0);
    const truckCard = h('div', { class: 'cp-card', style: 'margin-bottom:12px' }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, '🚚 Post my truck'), h('div', { class: 'cp-row-s' }, 'Tell us where your truck frees up — matching loads alert you automatically.')]),
        h('button', { class: 'cp-btn cp-btn-sm', onClick: () => {
          const org = h('input', { class: 'cp-in', placeholder: 'Truck location — City, ST *', value: (_dp && _dp.home_base) || '' });
          const from = h('input', { class: 'cp-in', type: 'date', value: new Date().toISOString().slice(0, 10) });
          const to = h('input', { class: 'cp-in', type: 'date', value: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
          const eq = h('input', { class: 'cp-in', placeholder: 'Equipment (e.g. Van, Reefer)', value: ((_dp && _dp.preferred_equipment) || []).join(', ') });
          const rpm = h('input', { class: 'cp-in', type: 'number', step: '0.05', placeholder: 'Min $/mi (optional)', value: (_dp && _dp.min_rpm) || '' });
          const auto = h('input', { type: 'checkbox' });
          const save = h('button', { class: 'cp-btn', onClick: async (ev) => {
            if (!org.value.trim()) { alert('Truck location required (City, ST).'); return; }
            ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Posting…';
            try {
              const r = await postTruck({ origin: org.value.trim(), available_from: from.value, available_to: to.value,
                equipment: eq.value.split(',').map(x => x.trim()).filter(Boolean), min_rpm: rpm.value || null, auto_request: auto.checked });
              _closePT(); alert('Truck posted ✓ — ' + (r.matches || 0) + ' matching load(s) found now. New matches will notify you.'); loadLoads();
            } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Post truck'; alert((e && e.message) || 'Could not post.'); }
          } }, 'Post truck');
          const _closePT = openModal('Post my truck', [org, h('div', { class: 'cp-formrow2' }, [from, to]), eq, rpm,
            h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px;font-size:.88rem' }, [auto, 'Auto-request matching loads (broker still approves every booking)']),
            save]);
        } }, '+ Post truck'),
      ]),
      (postings && postings.length) ? h('div', { style: 'margin-top:10px' }, postings.map(p => {
        const mWrap = h('div');
        return h('div', null, [h('div', { class: 'cp-row' }, [
          h('div', null, [
            h('div', { class: 'cp-row-t' }, p.origin + (p.dest_pref ? ' → ' + p.dest_pref : ' → anywhere')),
            h('div', { class: 'cp-row-s' }, String(p.from) + ' – ' + String(p.to) + ((p.equipment || []).length ? ' · ' + p.equipment.join('/') : '') + (p.min_rpm ? ' · min $' + p.min_rpm + '/mi' : '') + (p.auto_request ? ' · auto-request ON' : '') + (p.status === 'paused' ? ' · PAUSED' : '')),
          ]),
          h('div', { style: 'display:flex;gap:6px;align-items:center' }, [
            h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
              if (mWrap.firstChild) { mWrap.innerHTML = ''; return; }
              mWrap.appendChild(h('div', { class: 'cp-muted' }, 'Loading matches…'));
              let ms; try { ms = await truckPostingMatches(p.id); } catch (_) { ms = []; }
              mWrap.innerHTML = '';
              if (!ms.length) { mWrap.appendChild(h('div', { class: 'cp-row-s', style: 'padding:6px 0' }, 'No matches yet — you will be notified.')); return; }
              ms.forEach(m => mWrap.appendChild(h('div', { class: 'cp-row' }, [
                h('div', null, [h('div', { class: 'cp-row-t' }, (m.origin || '—') + ' → ' + (m.destination || '—')),
                  h('div', { class: 'cp-row-s' }, money(m.rate) + (m.miles ? ' · ' + m.miles + ' mi' : '') + (m.pickup_date ? ' · PU ' + m.pickup_date : '') + (m.still_available ? '' : ' · no longer available'))]),
                m.requested ? h('span', { class: 'cp-pill amber' }, 'requested') : (m.still_available ? h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
                  ev.currentTarget.disabled = true; ev.currentTarget.textContent = '…';
                  try { await requestBookLoad(m.load_id); ev.currentTarget.replaceWith(h('span', { class: 'cp-pill amber' }, 'requested')); }
                  catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Request'; alert((e && e.message) || 'Could not request.'); }
                } }, 'Request') : h('span', { class: 'cp-pill gray' }, 'gone')),
              ])));
            } }, p.matches + ' matches'),
            h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { try { await updateTruckPosting(p.id, p.status === 'paused' ? 'resume' : 'pause'); loadLoads(); } catch (e) { alert((e && e.message) || 'Failed'); } } }, p.status === 'paused' ? '▶' : '⏸'),
            h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { if (!confirm('Delete this truck posting?')) return; try { await updateTruckPosting(p.id, 'delete'); loadLoads(); } catch (e) { alert((e && e.message) || 'Failed'); } } }, '✕'),
          ]),
        ]), mWrap]);
      })) : null,
    ].filter(Boolean));
    let rows; try { rows = await pocketAvailableLoads(60); } catch (e) { rows = []; }
    // \ud83d\udccd REAL deadhead: one OSRM table call (live GPS \u2192 every pickup pin, road miles)
    window.__lbDh = window.__lbDh || {};
    (async () => {
      const p9 = window.__lbPos; if (!p9 || !rows.length) return;
      const pts9 = rows.filter(r9 => r9.pickup_lat != null && r9.pickup_lng != null).slice(0, 45);
      if (!pts9.length) return;
      // Road miles via OSRM; if OSRM has no route (e.g. testing from another continent) or is
      // unreachable, fall back to straight-line x1.2 so the deadhead badge always shows something.
      let ds9 = null;
      try {
        const coords9 = p9.coords.longitude + ',' + p9.coords.latitude + ';' + pts9.map(r9 => r9.pickup_lng + ',' + r9.pickup_lat).join(';');
        const j9 = await (await fetch('https://router.project-osrm.org/table/v1/driving/' + coords9 + '?sources=0&annotations=distance')).json();
        ds9 = j9 && j9.distances && j9.distances[0];
      } catch (_) {}
      let any9 = false;
      pts9.forEach((r9, i9) => {
        let mi9 = (ds9 && ds9[i9 + 1] != null) ? Math.round(ds9[i9 + 1] / 1609.34) : null;
        if (mi9 == null) mi9 = Math.round(havMi(p9.coords.latitude, p9.coords.longitude, r9.pickup_lat, r9.pickup_lng) * 1.2);
        if (mi9 != null) { window.__lbDh[r9.id] = mi9; any9 = true; }
      });
      if (any9 && typeof renderList === 'function') renderList();
    })();
    // Advanced filters (client-side, instant — DAT-style)
    const fOrigin = h('input', { class: 'cp-in', placeholder: 'Origin (city/ST)', style: 'margin:0' });
    const fDest = h('input', { class: 'cp-in', placeholder: 'Destination', style: 'margin:0' });
    const fEq = h('input', { class: 'cp-in', placeholder: 'Equipment', style: 'margin:0' });
    const fRpm = h('input', { class: 'cp-in', type: 'number', step: '0.05', placeholder: 'Min $/mi', style: 'margin:0;max-width:110px' });
    const fRate = h('input', { class: 'cp-in', type: 'number', placeholder: 'Min $', style: 'margin:0;max-width:110px' });
    const applyFilters = (list) => (list || []).filter(l => {
      const okO = !fOrigin.value.trim() || String(l.origin || '').toLowerCase().includes(fOrigin.value.trim().toLowerCase());
      const okD = !fDest.value.trim() || String(l.destination || '').toLowerCase().includes(fDest.value.trim().toLowerCase());
      const okE = !fEq.value.trim() || String(l.equipment || '').toLowerCase().includes(fEq.value.trim().toLowerCase());
      const okR = !fRpm.value || (l.rate && Number(l.miles) > 0 && (Number(l.rate) / Number(l.miles)) >= Number(fRpm.value));
      const okM = !fRate.value || Number(l.rate || 0) >= Number(fRate.value);
      return okO && okD && okE && okR && okM;
    });
    // Collapsed by default — tap "Filters" to open (inDrive pattern)
    const fBody = h('div', { style: 'display:none;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px' },
      [fOrigin, fDest, fEq, fRpm, fRate, h('button', { class: 'cp-btn cp-btn-sm', onClick: () => renderList() }, 'Apply'),
       h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { fOrigin.value = fDest.value = fEq.value = fRpm.value = fRate.value = ''; renderList(); fCount(); } }, 'Clear')]);
    const fChip = h('span', { class: 'cpx-chip', style: 'display:none' }, '');
    const fCount = () => { const n = [fOrigin, fDest, fEq, fRpm, fRate].filter(x => x.value.trim()).length; fChip.style.display = n ? 'inline-block' : 'none'; fChip.textContent = n + ' active'; };
    [fOrigin, fDest, fEq, fRpm, fRate].forEach(x => x.addEventListener('input', fCount));
    const fToggle = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { const open = fBody.style.display !== 'none'; fBody.style.display = open ? 'none' : 'flex'; fToggle.firstChild.textContent = open ? '⚙ Filters ▾' : '⚙ Filters ▴'; } }, [h('span', null, '⚙ Filters ▾'), fChip]);
    const filterBar = h('div', { class: 'cp-card', style: 'margin-bottom:12px;padding:10px 14px' }, [
      h('div', { style: 'display:flex;align-items:center;gap:8px' }, [fToggle]),
      fBody,
    ]);
    [fOrigin, fDest, fEq, fRpm, fRate].forEach(inp => { inp.onkeydown = (e) => { if (e.key === 'Enter') renderList(); }; });
    let renderList = () => {};
    const bestCard = null; // AI Pilot removed — its deadhead/score estimates were unreliable

    let setupBanner = null;
    try {
      const dp0 = await getDispatchPrefs();
      const prefsOk = !!(dp0 && dp0.min_rpm && (dp0.preferred_equipment || []).length && (dp0.preferred_lanes || []).length && dp0.home_base);
      let fleetOk = true;
      try { const fm0 = await fleetMaintenance(); const tr0 = (fm0 && (fm0.trucks || fm0.rows)) || fm0 || []; fleetOk = Array.isArray(tr0) ? tr0.length > 0 : true;
        window.__fleetEq = Array.isArray(tr0) ? tr0.map(t0 => String(t0.equipment || '').trim().toLowerCase()).filter(Boolean) : [];
      } catch (_) {}
      let compOk = true;
      try { const ah0 = await accountHealth(); compOk = !((ah0.deductions || []).some(x => /mandatory compliance/i.test(x.label || ''))); } catch (_) {}
      if (!prefsOk || !compOk || !fleetOk) {
        setupBanner = h('div', { class: 'cp-card', style: 'border-left:4px solid #d97706;margin-bottom:12px' }, [
          h('div', { class: 'cp-row-t', style: 'font-size:1.05rem' }, '\u26a0 Complete your setup to start booking loads'),
          h('div', { class: 'cp-row-s', style: 'margin:6px 0' }, [!prefsOk ? 'Set your minimum rate, equipment, lanes and home base.' : null, !compOk ? 'Upload and verify your compliance documents (authority, insurance, required documents).' : null, !fleetOk ? '\ud83d\ude9b Add at least one TRUCK and one driver with a current license & medical (Fleet tab) \u2014 offers are only sent to carriers with a bookable fleet.' : null].filter(Boolean).join(' ')),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
            !prefsOk ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('account') }, 'Complete account setup') : null,
            !compOk ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => go('onboarding') }, 'Finish onboarding') : null,
            !fleetOk ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => go('fleet') }, '\ud83d\ude9b Add truck & driver') : null,
          ].filter(Boolean)),
        ]);
      }
    } catch (_) {}
    if (!rows || !rows.length) { mount(availWrap, h('div', null, [truckCard, setupBanner, bestCard, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No available loads right now. Check back soon.'))].filter(Boolean))); mount(content, h('div', null, [capNudge, tabsBar, reqHost, availWrap].filter(Boolean))); return; }
    renderList = () => {
      const shown = applyFilters(rows);
      const grid = document.getElementById('cp-loadgrid-host');
      if (grid) { grid.innerHTML = ''; shown.forEach(l => grid.appendChild(loadCard(l))); if (!shown.length) grid.appendChild(h('div', { class: 'cp-muted' }, 'No loads match your filters.')); }
    };
    const loadCard = (l) => (function () {
      const rpm = l.rpm ? '$' + Number(l.rpm).toFixed(2) + '/mi' : '';
      const bookWrap = h('div', { class: 'cpx-req-bw' });
      const book = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!ov.compliance_ok) {
          const closeV = openModal('Verify your account first', [
            h('div', { style: 'text-align:center;padding:6px 0' }, [
              h('div', { style: 'font-size:44px;line-height:1' }, '🛡️'),
              h('div', { class: 'cp-row-t', style: 'margin:10px 0 6px;font-size:1.05rem' }, 'One step before you can book'),
              h('div', { class: 'cp-row-s', style: 'max-width:340px;margin:0 auto' }, 'Brokers only see booking requests from verified carriers. Upload your MC/DOT authority, insurance (COI) and W-9 — our team verifies fast.'),
              h('button', { class: 'cp-btn', style: 'margin-top:16px', onClick: () => { closeV(); go('onboarding'); } }, 'Finish onboarding →'),
              h('div', { class: 'cp-row-s', style: 'margin-top:10px;color:#94a3b8' }, 'Already uploaded? Verification is usually quick — check back soon.'),
            ]),
          ]);
          return;
        }
        if (l.hazmat && !hazVerified) {
          const closeH = openModal('Hazmat certificate required', [
            h('div', { style: 'text-align:center;padding:6px 0' }, [
              h('div', { style: 'font-size:44px;line-height:1' }, '☣️'),
              h('div', { class: 'cp-row-t', style: 'margin:10px 0 6px;font-size:1.05rem' }, 'This is a HAZMAT load'),
              h('div', { class: 'cp-row-s', style: 'max-width:340px;margin:0 auto' }, 'Your hazmat certificate is not verified yet. If you want to haul hazmat freight, upload your hazmat certificate / permit — once verified, hazmat loads unlock automatically.'),
              h('button', { class: 'cp-btn', style: 'margin-top:16px', onClick: () => { closeH(); go('account'); } }, 'Upload hazmat certificate →'),
              h('div', { class: 'cp-row-s', style: 'margin-top:10px;color:#94a3b8' }, 'Non-hazmat loads are not affected.'),
            ]),
          ]);
          return;
        }
        const eqNeed9 = String(l.equipment || '').trim();
        if (eqNeed9 && Array.isArray(window.__fleetEq) && window.__fleetEq.length && window.__fleetEq.indexOf(eqNeed9.toLowerCase()) < 0) {
          const closeE9 = openModal('\ud83d\ude9b ' + eqNeed9 + ' equipment required', [
            h('div', { style: 'text-align:center;padding:6px 0' }, [
              h('div', { style: 'font-size:44px;line-height:1' }, '\ud83d\ude9b'),
              h('div', { class: 'cp-row-t', style: 'margin:10px 0 6px;font-size:1.05rem' }, 'This load is for ' + eqNeed9 + ' equipment'),
              h('div', { class: 'cp-row-s', style: 'max-width:360px;margin:0 auto' }, 'Your fleet doesn\u2019t have a ' + eqNeed9 + ' on file \u2014 brokers match and pay by equipment, so this one can\u2019t be requested. If you run a ' + eqNeed9 + ', add the truck and loads like this unlock automatically.'),
              h('button', { class: 'cp-btn', style: 'margin-top:16px', onClick: () => { closeE9(); go('fleet'); } }, '\u2795 Add your ' + eqNeed9 + ' truck \u2192 Fleet'),
              h('div', { class: 'cp-row-s', style: 'margin-top:10px;color:#94a3b8' }, 'Your fleet today: ' + (window.__fleetEq.map(e9 => e9.replace(/\b\w/g, c9 => c9.toUpperCase())).join(', ') || '\u2014')),
            ]),
          ]);
          return;
        }
        if (lbExpired(l)) { openModal('\u23f0 This load has expired', [h('div', { class: 'cp-row-s' }, 'Its pickup time has already passed. The broker must update the pickup schedule before it can be booked \u2014 it stays on the board as EXPIRED until they do. You can\u2019t request it right now.')]); return; }
        const _f = lbFeas(l, _dp);
        if (_f.have && (!_f.delOk || !_f.puOk)) {
          const rnd = (x) => x == null ? '?' : (x < 10 ? Math.round(x * 10) / 10 : Math.round(x));
          openModal(!_f.delOk ? '\u26a0 You can\u2019t deliver this on time' : '\u26a0 You can\u2019t reach pickup in time', [
            h('div', { class: 'cp-row-s' }, !_f.delOk
              ? ('From where you are now, running ' + (_f.team ? 'team (nonstop)' : 'solo (with HOS breaks)') + ' it takes ~' + rnd(_f.delEtaH) + 'h to reach pickup and deliver \u2014 but only ~' + rnd(Math.max(_f.delHoursTo || 0, 0)) + 'h remain before the delivery appointment. You would deliver LATE.')
              : ('It takes ~' + rnd(_f.puEtaH) + 'h to reach pickup but only ~' + rnd(Math.max(_f.puHoursTo || 0, 0)) + 'h remain before the pickup window \u2014 you\u2019d be late to pickup.')),
            (!_f.team && !_f.delOk && _f.teamDelOk) ? h('div', { class: 'cp-row-s', style: 'margin-top:6px;color:#4ade80;font-weight:700' }, 'A TEAM (nonstop) could make it \u2014 solo cannot. Run this only if you have a co-driver.') : null,
            h('div', { class: 'cp-row-s', style: 'margin-top:8px;color:#94a3b8' }, 'Booking is blocked to protect your on-time score. Pick a load you can run on time.'),
          ].filter(Boolean));
          return;
        }
        const err9 = h('div', { class: 'cp-err', style: 'min-height:1em' });
        const go9 = h('button', { class: 'cp-btn', style: 'flex:1;background:linear-gradient(120deg,#0883F7,#0967d2);font-weight:800' }, '\ud83c\udfaf Send booking request');
        const closeB9 = openModal('\ud83c\udfaf Request to book', [
          h('div', { style: 'background:linear-gradient(120deg,#0b1830,#14335c);border-radius:16px;padding:16px 18px;color:#fff;margin-bottom:12px' }, [
            h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline' }, [
              h('div', { style: 'font-weight:800;font-size:1.05rem' }, (l.origin || '') + ' → ' + (l.destination || '')),
              h('div', { style: 'font-weight:800;font-size:1.25rem;color:#7cc0ff' }, money(l.rate)),
            ]),
            h('div', { style: 'font-size:.8rem;opacity:.8;margin-top:4px' }, [rpm || null, l.equipment || null, l.miles ? Number(l.miles).toLocaleString() + ' mi' : null, l.pickup_date ? 'PU ' + l.pickup_date : null].filter(Boolean).join(' · ')),
            h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px' }, lbFeasChips(l, _dp)),
          ]),
          (l.accessorials && (l.accessorials.detention_per_hr || l.accessorials.tonu)) ? h('div', { style: 'background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:10px 13px;font-size:.8rem;color:#0f766e;font-weight:700;margin-bottom:12px' },
            '\ud83d\udee1 Protected in writing: detention $' + (l.accessorials.detention_per_hr || '60') + '/hr after ' + (l.accessorials.detention_free_hours || '2') + 'h · TONU $' + (l.accessorials.tonu || '250') + ' · layover $' + (l.accessorials.layover_per_day || '250') + '/day') : null,
          h('div', { class: 'cp-row-s', style: 'margin-bottom:12px' }, 'The broker reviews your verified trust profile and approves or declines. Nothing moves and you\u2019re not committed until approved — first acceptance wins the load.'),
          err9,
          h('div', { style: 'display:flex;gap:10px' }, [go9, h('button', { class: 'cp-btn ghost', style: 'flex:0 0 auto', onClick: () => closeB9() }, 'Cancel')]),
        ]);
        go9.onclick = async () => {
          go9.disabled = true; go9.textContent = 'Sending request…';
          try {
            await requestBookLoad(l.id);
            closeB9();
            lbToast('Request sent — pending broker approval. You\u2019ll be notified the moment they respond.', 'ok', '\ud83c\udfaf Requested');
            mount(bookWrap, [h('div', { class: 'cp-row-s', style: 'color:#d97706;font-weight:700;margin-bottom:4px' }, '\u23f3 Requested — pending broker approval'), h('div', { class: 'cp-row-s' }, 'You will be notified when the broker responds. Once approved it appears in My trips.')]);
          } catch (e) { go9.disabled = false; go9.textContent = '\ud83c\udfaf Send booking request'; err9.textContent = (e && e.message) || 'Could not send your request.'; }
        };
        return;
      } }, 'Request to book');
      bookWrap.appendChild(book);
      const counter = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
        if (!ov.compliance_ok || (l.hazmat && !hazVerified)) { book.click(); return; }
        const rateIn = h('input', { class: 'cp-in', type: 'number', placeholder: 'Your all-in rate ($)' });
        const noteIn = h('input', { class: 'cp-in', placeholder: 'Optional note to the broker' });
        const emsg = h('div', { class: 'cp-err' });
        const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          const amt = Number(rateIn.value); if (!amt || amt <= 0) { emsg.textContent = 'Enter your proposed rate.'; return; }
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending\u2026';
          const note = 'Rate counter: $' + amt.toLocaleString() + ' all-in' + (noteIn.value.trim() ? ' \u2014 ' + noteIn.value.trim() : '');
          try { await requestBookLoad(l.id, note); closeC(); mount(bookWrap, [h('div', { class: 'cp-row-s', style: 'color:#d97706;font-weight:700;margin-bottom:4px' }, '\u21a9 Counter sent \u2014 pending broker approval'), h('div', { class: 'cp-row-s' }, 'The broker sees your proposed rate and approves or declines. Nothing is committed until approved.')]); }
          catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send counter'; emsg.textContent = (e && e.message) || 'Could not send.'; }
        } }, 'Send counter');
        const closeC = openModal('Propose your rate', [
          h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'Posted: ' + money(l.rate) + (rpm ? ' \u00b7 ' + rpm : '') + '. Propose your all-in rate \u2014 it goes to the broker with your booking request.'),
          rateIn, noteIn, emsg, send,
        ]);
      } }, 'Propose rate');
      bookWrap.appendChild(counter);
      const detailsBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => showLoadDetail(l.id) }, 'Details');
      const meta = [];
      if (l.commodity) meta.push('Commodity: ' + l.commodity);
      if (l.weight) meta.push('Weight: ' + l.weight);
      if (l.deadhead) meta.push(l.deadhead + ' mi deadhead');
      const dx = l.details || {};
      if (dx.load_size) meta.push(dx.load_size);
      if (dx.pallets) meta.push(dx.pallets + ' plt');
      if (dx.temperature) meta.push('Reefer ' + dx.temperature + '\u00b0F');
      if (dx.tarps) meta.push(dx.tarps);
      if (dx.load_method_pickup) meta.push('PU: ' + dx.load_method_pickup);
      if (dx.load_method_delivery) meta.push('DEL: ' + dx.load_method_delivery);
      if (dx.dock_hours_pickup) meta.push('PU hours ' + dx.dock_hours_pickup);
      if (dx.dock_hours_delivery) meta.push('DEL hours ' + dx.dock_hours_delivery);
      if (dx.driver_assist_required) meta.push('\u26a0 driver assist required');
      if (dx.team_required) meta.push('\u26a0 TEAM drivers required');
      if (dx.cargo_value) meta.push('cargo value $' + Number(dx.cargo_value).toLocaleString());
      const advW = h('div');
      function buildAdvisor(pos) {
        advW.innerHTML = '';
        // ---- AUTO INPUTS (nothing re-typed): saved cost/mile, saved expense template,
        //      GPS or home-base deadhead, offline city-geo verification of posted miles ----
        let tpl = [{ label: 'Tolls', amt: 0 }];
        try { const t0 = JSON.parse(localStorage.getItem('lb_exp_tpl') || 'null'); if (Array.isArray(t0) && t0.length) tpl = t0; } catch (_) {}
        const oGeo = geo(l.origin), dGeo = geo(l.destination);
        const laneRoad = (oGeo && dGeo) ? roadMiles(oGeo, dGeo) : null;   // verified lane miles (est.)
        const postedMi = Number(l.miles) || 0;
        const milesSuspicious = laneRoad != null && postedMi > 0 && (postedMi < laneRoad * 0.75 || postedMi > laneRoad * 1.6);
        const tollAuto = tollEstimate(oGeo, dGeo);
        const st = {
          fuel: _dp && Number(_dp.fuel_price) > 0 ? Number(_dp.fuel_price) : 3.85,
          mpg: _dp && Number(_dp.truck_mpg) > 0 ? Number(_dp.truck_mpg) : 6.5,
          tolls: tollAuto.total || 0,
          cpm: _dp && Number(_dp.cost_per_mile) > 0 ? Number(_dp.cost_per_mile) : 0.65,
          ex: tpl.map(x => ({ label: x.label, amt: Number(x.amt) || 0 })),
          useVerified: milesSuspicious && laneRoad != null,
          dh: 0, dhBasis: 'unknown — set below', dhKnown: false,
        };
        const pickupPt = (l.pickup_lat != null && l.pickup_lng != null) ? [l.pickup_lat, l.pickup_lng] : oGeo;
        if (pos && pickupPt) {
          const gps = [pos.coords.latitude, pos.coords.longitude];
          const d0 = roadMiles(gps, pickupPt);
          if (d0 != null && d0 <= 1200) { st.dh = d0; st.dhBasis = 'LIVE GPS → pickup (road est.)'; st.dhKnown = true; }
          else if (d0 != null) {
            // GPS is far (planning from home/office/abroad) — be honest, use home base instead
            const hb = geo(_dp && _dp.home_base);
            if (hb) { st.dh = roadMiles(hb, pickupPt) || 0; st.dhBasis = 'home base (' + _dp.home_base + ') → pickup — you appear ' + d0.toLocaleString() + ' mi from pickup (planning mode)'; st.dhKnown = true; }
            else { st.dhBasis = 'GPS ' + d0.toLocaleString() + ' mi away (planning mode) — set home base in Account, or type deadhead'; }
          }
        } else if (pickupPt) {
          const hb = geo(_dp && _dp.home_base);
          if (hb) { st.dh = roadMiles(hb, pickupPt) || 0; st.dhBasis = 'home base → pickup (road est.)'; st.dhKnown = true; }
        }
        if (!st.dhKnown && l.deadhead != null) { st.dh = Number(l.deadhead); st.dhBasis = 'posting estimate'; st.dhKnown = true; }
        const saveTpl = () => { try { localStorage.setItem('lb_exp_tpl', JSON.stringify(st.ex.filter(x => x.label || x.amt))); } catch (_) {} };
        let cpmTimer = null;
        const persistCpm = () => { clearTimeout(cpmTimer); cpmTimer = setTimeout(async () => { try {
          await setDispatchPrefs({ min_rpm: (_dp && _dp.min_rpm) || null, preferred_equipment: (_dp && _dp.preferred_equipment) || [], preferred_lanes: (_dp && _dp.preferred_lanes) || [], home_base: (_dp && _dp.home_base) || null, max_deadhead_miles: (_dp && _dp.max_deadhead_miles) || null, notes: (_dp && _dp.notes) || null, cost_per_mile: st.cpm, fuel_price: st.fuel, truck_mpg: st.mpg });
          if (_dp) { _dp.cost_per_mile = st.cpm; _dp.fuel_price = st.fuel; _dp.truck_mpg = st.mpg; }
        } catch (_) {} }, 900); };
        const host = h('div', { class: 'cpx-adv' });
        // Broker matrix — REAL from our platform (verified authority/bond, trip-verified
        // ratings, delivered/on-time history). Loaded async once per open.
        const brokerHost = h('div');
        let _prot = null; // protection score from the load's real accessorial terms
        let _hist = null; // the carrier's OWN delivered-trip track record (real benchmark)
        (async () => {
          try {
            const ts = await pocketTrips(50);
            const done = (ts || []).filter(t2 => (t2.status === 'delivered' || t2.status === 'invoiced') && Number(t2.rate) > 0 && Number(t2.miles) > 0);
            if (done.length >= 3) { _hist = { n: done.length, rpm: done.reduce((a2, t2) => a2 + Number(t2.rate) / Number(t2.miles), 0) / done.length }; render(); }
          } catch (_) {}
        })();
        (async () => {
          try {
            const det = await carrierLoadDetail(l.id);
            const acc2 = (det && det.terms && det.terms.accessorials) || {};
            const have = ['detention_per_hr', 'detention_free_hours', 'tonu', 'layover_per_day', 'lumper_policy'].filter(k2 => acc2[k2] !== undefined && acc2[k2] !== null && acc2[k2] !== '');
            _prot = { n: have.length, total: 5 };
            render();
          } catch (_) {}
        })();
        (async () => {
          let ps = null; try { ps = await carrierViewPoster(l.id); } catch (_) {}
          if (!ps) { brokerHost.innerHTML = ''; return; }
          const isDirect = ps.broker_trust_score == null && /loadboot/i.test(String(ps.posted_by || ''));
          if (isDirect) {
            st.direct = true;
            if (!_prot) _prot = { n: 5, total: 5, enforced: true }; // LoadBoot standards apply BY POLICY on direct posts
            mount(brokerHost, h('div', { style: 'margin-top:10px;border-radius:12px;padding:12px;background:#0F172A;color:#fff' }, [
              h('div', { style: 'display:flex;align-items:center;gap:10px' }, [
                h('span', { html: '<svg width="24" height="26" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#FFFFFF"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#F97316"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#FFFFFF"/></svg>', style: 'line-height:0' }),
                h('div', null, [h('b', { style: 'font-size:13.5px' }, 'LoadBoot Dispatch — platform post'), h('div', { style: 'font-size:11px;color:#94a3b8' }, 'The marketplace itself is the posting party')]),
                h('span', { class: 'cp-pill green', style: 'margin-left:auto' }, '✓ Platform'),
              ]),
              h('div', { style: 'font-size:11.5px;color:#cbd5e1;margin-top:8px;line-height:1.7' },
                '✓ All marketplace standards ENFORCED at post time (detention $60/2h · TONU $250 · layover $250 · lumper receipt · assist $75)' +
                ' — not negotiable, it is policy.'),
              h('div', { style: 'font-size:10.5px;color:#94a3b8;margin-top:4px' }, 'Carrier ratings of LoadBoot posts build from trip-verified reviews — same rules as brokers, no self-exemption.'),
            ]));
            render();
            return;
          }
          st.brokerVerified = ps.broker_verified === true; st.brokerRating = Number(ps.broker_rating || 0); st.brokerTrust = Number(ps.broker_trust_score || 0);
          const br = Number(ps.broker_rating || 0);
          const stars = br ? '★'.repeat(Math.round(br)) + '☆'.repeat(5 - Math.round(br)) : '';
          mount(brokerHost, h('div', { style: 'margin-top:10px;border:1px solid var(--lb-border,#e6ebf3);border-radius:12px;padding:11px;background:#fff' }, [
            h('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px' }, [
              h('b', { style: 'font-size:13px' }, '🏢 ' + (ps.posted_by || 'Posting party')),
              h('span', null, [
                ps.broker_verified != null ? h('span', { class: 'cp-pill ' + (ps.broker_verified ? 'green' : 'amber'), style: 'margin-right:6px' }, ps.broker_verified ? '✓ Verified (bond + authority on file)' : 'Unverified') : null,
                stars ? h('span', { style: 'color:#f59e0b;font-weight:800' }, stars + ' ' + br.toFixed(1)) : null,
              ].filter(Boolean)),
            ]),
            h('div', { class: 'cp-row-s', style: 'margin-top:5px' }, [
              ps.broker_trust_score != null ? 'Trust ' + ps.broker_trust_score + '/100' : null,
              ps.loads_delivered != null ? ps.loads_delivered + ' delivered on LoadBoot' : null,
              ps.on_time_pct != null ? ps.on_time_pct + '% on-time' : null,
            ].filter(Boolean).join(' · ') || (ps.signal || '')),
            h('div', { class: 'cp-row-s', style: 'color:#94a3b8' }, 'Payment history (days-to-pay): insufficient verified data yet — builds automatically as invoices settle on LoadBoot. Ratings are trip-verified only.'),
          ]));
        })();
        const render = () => {
          const rate = Number(l.rate) || 0;
          const loadedMi = st.useVerified && laneRoad ? laneRoad : postedMi;
          const totalMi = loadedMi + (st.dh || 0);
          const fuelLoaded = Math.round((loadedMi / Math.max(st.mpg, 1)) * st.fuel);
          const fuelDead = Math.round(((st.dh || 0) / Math.max(st.mpg, 1)) * st.fuel);
          const otherCost = Math.round(totalMi * st.cpm);
          const cost = fuelLoaded + fuelDead + otherCost + Math.round(st.tolls || 0);
          const fee = Math.round(rate * 0.05);
          const exSum = st.ex.reduce((a, x) => a + (Number(x.amt) || 0), 0);
          const net = rate - cost - fee - exSum;
          const allInRpm = totalMi > 0 ? rate / totalMi : 0;
          const days = Math.max(1, Math.ceil(totalMi / 550));           // ~550 practical mi/day
          const perDay = Math.round(net / days);
          // reload market at destination — REAL: count loads on OUR board originating near destination state
          const dstST = String(l.destination || '').trim().slice(-2).toLowerCase();
          const reloads = (rows || []).filter(r2 => r2.id !== l.id && String(r2.origin || '').trim().slice(-2).toLowerCase() === dstST).length;
          const pct = (v) => rate > 0 ? Math.max(0, Math.min(100, v / rate * 100)) : 0;
          const flags = [];
          if (milesSuspicious) flags.push(['red', '⚠ Posted ' + postedMi.toLocaleString() + ' mi, but ' + (l.origin||'') + ' → ' + (l.destination||'') + ' is ~' + laneRoad.toLocaleString() + ' mi by road. Real rate ≈ $' + (laneRoad ? (rate/laneRoad).toFixed(2) : '?') + '/mi — verify with the broker before booking.' + (st.useVerified ? ' (Math below uses corrected miles.)' : '')]);
          if (!st.dhKnown) flags.push(['amber', 'Deadhead unknown — no live GPS and no home base on file. Enter it below.']);
          if ((oGeo && isStateFallback(l.origin)) || (dGeo && isStateFallback(l.destination))) flags.push(['amber', 'City not in offline map — state-center estimate used for verification.']);
          const checks = [];
          if (_dp && _dp.max_deadhead_miles && st.dhKnown) checks.push([st.dh <= Number(_dp.max_deadhead_miles), 'Deadhead ' + st.dh + '/' + _dp.max_deadhead_miles + ' mi']);
          if (_dp && _dp.min_rpm) checks.push([allInRpm >= Number(_dp.min_rpm), 'All-in $' + allInRpm.toFixed(2) + ' vs your min $' + _dp.min_rpm]);
          checks.push([net > 0, 'Net ' + (net >= 0 ? '+$' : '−$') + Math.abs(net).toLocaleString()]);
          checks.push([reloads > 0, reloads + ' reload' + (reloads === 1 ? '' : 's') + ' on our board out of ' + (l.destination || 'destination')]);
          // ---- LoadBoot Score (0-100): every REAL factor weighted; breakdown visible ----
          const homePt = geo(_dp && _dp.home_base);
          const homeReturn = (homePt && dGeo) ? roadMiles(dGeo, homePt) : null;
          const delDate = l.delivery_date ? new Date(l.delivery_date) : null;
          const weekendDel = delDate ? (delDate.getDay() === 0 || delDate.getDay() === 6) : false;
          const marginPct = rate > 0 ? net / rate : 0;
          const SC = [];
          const TAG = { M: ['MEASURED', '#16a34a'], V: ['VERIFIED', '#0883F7'], E: ['ESTIMATE', '#d97706'], U: ['YOU SET', '#64748b'] };
          SC.push(['Profit margin', Math.max(0, Math.min(25, Math.round(marginPct * 100))), 25, (marginPct * 100).toFixed(0) + '% of rate stays with you', 'U']);
          SC.push(['Rate vs your minimum', _dp && _dp.min_rpm ? (allInRpm >= _dp.min_rpm * 1.2 ? 15 : allInRpm >= _dp.min_rpm ? 10 : 0) : 8, 15, '$' + allInRpm.toFixed(2) + '/mi all-in' + (_hist ? ' · your last ' + _hist.n + ' delivered avg $' + _hist.rpm.toFixed(2) + '/mi' : ''), _hist ? 'M' : 'U']);
          SC.push(['Deadhead', st.dhKnown ? (st.dh <= 50 ? 10 : st.dh <= 150 ? 7 : st.dh <= 300 ? 3 : 0) : 5, 10, st.dh + ' mi to pickup', st.dhBasis.indexOf('LIVE') === 0 ? 'M' : 'E']);
          SC.push(['Miles verified', milesSuspicious ? 0 : laneRoad ? 10 : 5, 10, milesSuspicious ? 'posted miles look WRONG' : laneRoad ? 'matches city-map distance' : 'not verifiable', 'E']);
          SC.push(['Your protections', _prot ? Math.round(_prot.n / _prot.total * 15) : 7, 15, _prot ? (_prot.enforced ? '5/5 — LoadBoot standards enforced on platform posts' : _prot.n + '/' + _prot.total + ' accessorial terms set on this load') : 'checking rate card…', 'V']);
          SC.push(['Posting party', st.direct ? 15 : (st.brokerVerified != null ? Math.round(((st.brokerVerified ? 8 : 0) + Math.min(7, (st.brokerRating || 0) / 5 * 7))) : 7), 15, st.direct ? 'LoadBoot Dispatch — platform post, standards enforced by policy' : (st.brokerVerified != null ? ((st.brokerVerified ? 'verified broker' : 'UNVERIFIED broker') + (st.brokerRating ? ' · ★' + st.brokerRating.toFixed(1) : '')) : 'checking…'), 'V']);
          SC.push(['Reload market', Math.min(5, reloads * 2), 5, reloads + ' loads out of destination on our board', 'M']);
          SC.push(['Home return', homeReturn == null ? 2 : homeReturn <= 100 ? 5 : homeReturn <= 400 ? 3 : 1, 5, homeReturn == null ? 'set home base' : homeReturn.toLocaleString() + ' mi back to ' + (_dp.home_base || 'base') + ' after delivery', 'E']);
          if (weekendDel) SC.push(['Weekend delivery risk', 0, 0, 'delivers ' + (delDate.getDay() === 0 ? 'Sunday' : 'Saturday') + ' — receiver hours / detention risk, confirm before booking', 'M']);
          const lbScore = Math.max(0, Math.min(100, SC.reduce((a2, x2) => a2 + x2[1], 0)));
          const hardFails = checks.slice(0, 3).filter(c => !c[0]).length + (milesSuspicious ? 1 : 0);
          const V = hardFails === 0 ? ['✓', 'Best match', 'the top factors line up with your profile', '#16a34a', 'rgba(22,163,74,.12)']
            : hardFails === 1 ? ['≈', 'Partial match', 'one issue below — resolve it, then book', '#d97706', 'rgba(217,119,6,.12)']
            : ['✕', 'Poor match', 'the numbers work against you on this one', '#dc2626', 'rgba(220,38,38,.12)'];
          const numIn = (val, step2, onch, w) => { const i2 = h('input', { class: 'cp-in', type: 'number', step: step2, value: val, style: 'margin:0;max-width:' + (w || 96) + 'px;padding:7px 9px;font-size:14px;font-weight:700;text-align:right' }); i2.oninput = () => onch(Number(i2.value) || 0); return i2; };
          mount(host, [
            (() => {
              // LOCKED v8 hero: ring dial + verdict + NET/PER-DAY/TRIP + ranked why-rows + watch strip.
              const C2 = 2 * Math.PI * 40, off2 = C2 * (1 - lbScore / 100);
              const dcol = lbScore >= 70 ? '#22c55e' : lbScore >= 45 ? '#f59e0b' : '#ef4444';
              const rank = SC.filter(x2 => x2[2] > 0).slice().sort((a2, b2) => (b2[1] / b2[2]) - (a2[1] / a2[2]));
              const tops = rank.slice(0, 3), worst = rank[rank.length - 1];
              const medals = ['#F97316', '#0883F7', '#475569'];
              return h('div', { class: 'cpx-mhero' }, [
                h('div', { class: 'mh-lock' }, [
                  h('span', { html: '<svg width="19" height="20" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#FFFFFF"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#F97316"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#FFFFFF"/></svg>', style: 'line-height:0' }),
                  h('span', { style: 'display:inline-flex;align-items:flex-start;gap:4px' }, [h('b', { html: 'Load<span style="color:#F97316">Boot</span>', style: 'font-size:15px;letter-spacing:-.02em;line-height:1;color:#fff' }), h('span', { style: 'font-size:11px;font-weight:600;color:#FB923C;line-height:1' }, 'Match')]),
                  h('span', { class: 'mh-eng' }, 'DECISION ENGINE'),
                ]),
                h('div', { style: 'display:flex;align-items:center;gap:14px' }, [
                  h('div', { style: 'position:relative;width:92px;height:92px;flex:none' }, [
                    h('span', { html: '<svg width="92" height="92" viewBox="0 0 92 92" style="transform:rotate(-90deg)"><circle cx="46" cy="46" r="40" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="8"/><circle cx="46" cy="46" r="40" fill="none" stroke="' + dcol + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + C2.toFixed(1) + '" stroke-dashoffset="' + off2.toFixed(1) + '"/></svg>', style: 'line-height:0;display:block' }),
                    h('span', { style: 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center' }, [h('b', { style: 'font-size:26px;line-height:1;color:#fff' }, String(lbScore)), h('span', { style: 'font-size:8.5px;color:#94a3b8;font-weight:800;letter-spacing:.08em;margin-top:2px' }, 'OF 100')]),
                  ]),
                  h('div', null, [h('div', { style: 'font-size:17px;font-weight:800;color:' + dcol }, V[0] + ' ' + V[1]), h('div', { style: 'font-size:12px;color:#94a3b8;margin-top:2px;line-height:1.5' }, V[2])]),
                ]),
                h('div', { class: 'mh-boxes' }, [
                  h('div', { class: 'bx hl' }, [h('span', null, 'NET PROFIT'), h('b', null, (net >= 0 ? '+$' : '−$') + Math.abs(net).toLocaleString())]),
                  h('div', { class: 'bx' }, [h('span', null, 'PER DAY'), h('b', null, '$' + perDay.toLocaleString())]),
                  h('div', { class: 'bx' }, [h('span', null, 'TRIP'), h('b', null, days + ' day' + (days > 1 ? 's' : ''))]),
                ]),
                h('div', { class: 'mh-sect' }, 'WHY IT MATCHES YOU'),
                ...tops.map((t2, i2) => { const pc2 = Math.round(t2[1] / t2[2] * 100); return h('div', { class: 'mh-wrow' }, [
                  h('span', { class: 'mh-medal', style: 'background:' + medals[i2] }, String(i2 + 1)),
                  h('span', { style: 'min-width:0;flex:1' }, [h('div', { style: 'font-weight:800;font-size:13px;color:#fff' }, t2[0]), h('div', { style: 'font-size:11.5px;color:#94a3b8;margin-top:1px;line-height:1.45' }, t2[3]), h('div', { class: 'mh-bar' }, h('i', { style: 'width:' + pc2 + '%' }))]),
                  h('b', { style: 'color:#4ade80;font-size:12px;flex:none' }, t2[1] + '/' + t2[2]),
                ]); }),
                (worst && (worst[1] / worst[2]) < 0.6) ? h('div', { class: 'mh-watch' }, '⚠ Watch — ' + worst[0] + ': ' + worst[3]) : null,
              ].filter(Boolean));
            })(),
            ...flags.map(f => h('div', { style: 'margin-top:8px;border-radius:11px;padding:9px 12px;font-size:12px;font-weight:700;' + (f[0] === 'red' ? 'background:rgba(220,38,38,.1);color:#b91c1c' : 'background:rgba(217,119,6,.12);color:#92400e') }, f[1])),
            milesSuspicious ? h('label', { style: 'display:flex;gap:7px;align-items:center;margin-top:6px;font-size:12px;font-weight:700;color:#334155' }, [
              (() => { const cb = h('input', { type: 'checkbox' }); cb.checked = st.useVerified; cb.onchange = () => { st.useVerified = cb.checked; render(); }; return cb; })(),
              'Use corrected miles (' + laneRoad.toLocaleString() + ') in the math']) : null,
            h('div', { class: 'cpx-adv-bar' }, [
              h('span', { style: 'width:' + pct(cost) + '%;background:#0F172A' }),
              h('span', { style: 'width:' + pct(fee) + '%;background:#F97316' }),
              h('span', { style: 'width:' + pct(exSum) + '%;background:#94a3b8' }),
              h('span', { style: 'width:' + pct(Math.max(net, 0)) + '%;background:#16a34a' }),
            ]),
            h('div', { class: 'cpx-adv-legend' }, [
              h('span', null, [h('i', { style: 'background:#0F172A' }), 'Cost $' + cost.toLocaleString() + ' (fuel $' + (fuelLoaded + fuelDead).toLocaleString() + ' + tolls $' + Math.round(st.tolls || 0) + ' + other $' + otherCost.toLocaleString() + ')']),
              h('span', null, [h('i', { style: 'background:#F97316' }), 'Fee $' + fee.toLocaleString()]),
              exSum ? h('span', null, [h('i', { style: 'background:#94a3b8' }), 'Extras $' + exSum.toLocaleString()]) : null,
              h('span', null, [h('i', { style: 'background:#16a34a' }), 'Net ' + (net >= 0 ? '$' + net.toLocaleString() : '−$' + Math.abs(net).toLocaleString())]),
            ].filter(Boolean)),
            h('div', { style: 'margin-top:10px;border-radius:11px;padding:9px 12px;background:rgba(8,131,247,.07);font-size:12px;font-weight:700;color:#1e3a8a' },
              '⛽ Deadhead fuel: ' + (st.dh || 0) + ' mi ÷ ' + st.mpg + ' mpg × $' + st.fuel + ' = $' + fuelDead.toLocaleString() + ' just to reach pickup · Loaded-leg fuel: $' + fuelLoaded.toLocaleString()),
            h('div', { class: 'cpx-adv-grid' }, [
              h('div', { class: 'cell' }, [h('label', null, '📍 DEADHEAD (MI)'), numIn(st.dh, 1, (v) => { st.dh = v; st.dhKnown = true; st.dhBasis = 'entered by you'; render(); }), h('span', { style: 'font-size:9.5px;color:#94a3b8;font-weight:600' }, st.dhBasis)]),
              h('div', { class: 'cell' }, [h('label', null, '⛽ FUEL $/GAL (auto-saved)'), numIn(st.fuel, 0.05, (v) => { st.fuel = v; persistCpm(); render(); })]),
              h('div', { class: 'cell' }, [h('label', null, '🚛 TRUCK MPG (auto-saved)'), numIn(st.mpg, 0.1, (v) => { st.mpg = v; persistCpm(); render(); })]),
              h('div', { class: 'cell' }, [h('label', null, '🔧 OTHER COST/MI (maint+ins)'), numIn(st.cpm, 0.05, (v) => { st.cpm = v; persistCpm(); render(); })]),
              h('div', { class: 'cell' }, [h('label', null, '🛣 TOLLS (auto-estimated)'), numIn(Math.round(st.tolls), 1, (v) => { st.tolls = v; render(); }), h('span', { style: 'font-size:9.5px;color:#94a3b8;font-weight:600' }, tollAuto.parts.length ? tollAuto.parts.map(p2 => p2[1]).join(' + ') : tollAuto.basis)]),
              h('div', { class: 'cell' }, [h('label', null, 'LOADED MI' + (st.useVerified ? ' (CORRECTED)' : '') + ' · ALL-IN'), h('b', null, loadedMi.toLocaleString() + ' mi · $' + allInRpm.toFixed(2) + '/mi')]),
            ]),
            h('div', { style: 'margin-top:8px' }, [
              h('div', { style: 'font-weight:800;font-size:12px;color:#64748b;margin-bottom:4px' }, 'MY USUAL EXPENSES (saved — auto-fills every load)'),
              ...st.ex.map((x, idx) => h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' }, [
                (() => { const li = h('input', { class: 'cp-in', value: x.label, placeholder: 'Label', style: 'margin:0;flex:1;padding:7px 9px;font-size:13px' }); li.oninput = () => { x.label = li.value; saveTpl(); }; return li; })(),
                numIn(x.amt, 1, (v) => { x.amt = v; saveTpl(); render(); }),
                h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'padding:5px 10px', onClick: () => { st.ex.splice(idx, 1); saveTpl(); render(); } }, '✕'),
              ])),
              h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { st.ex.push({ label: '', amt: 0 }); render(); } }, '+ Add expense (saved for next time)'),
            ]),
            h('div', { class: 'cpx-adv-checks' }, checks.map(c => h('span', { class: 'chk ' + (c[0] ? 'ok' : 'bad') }, (c[0] ? '✓ ' : '✕ ') + c[1]))),
            h('div', { style: 'margin-top:12px;border:1px solid var(--lb-border,#e6ebf3);border-radius:13px;padding:12px;background:#fff' }, [
              h('div', { style: 'font-weight:800;font-size:11px;letter-spacing:.08em;color:#64748b;margin-bottom:6px' }, 'FULL BREAKDOWN — NOTHING HIDDEN'),
              ...SC.map(x2 => {
                const tg = TAG[x2[4]] || TAG.E;
                const pc3 = x2[2] > 0 ? Math.round(x2[1] / x2[2] * 100) : 0;
                const bc3 = pc3 >= 70 ? '#16a34a' : pc3 >= 40 ? '#d97706' : '#dc2626';
                return h('div', { style: 'padding:8px 0;border-bottom:1px solid #f1f5f9' }, [
                  h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
                    h('b', { style: 'font-size:12.5px;color:#0F172A' }, x2[0]),
                    h('span', { style: 'font-size:8.5px;font-weight:800;letter-spacing:.05em;padding:1px 7px;border-radius:99px;background:' + tg[1] + '1f;color:' + tg[1] }, tg[0]),
                    h('b', { style: 'margin-left:auto;font-size:12px;color:' + bc3 }, x2[1] + '/' + x2[2]),
                  ]),
                  x2[2] > 0 ? h('div', { style: 'height:4px;border-radius:99px;background:#e9eef5;margin:6px 0 5px;overflow:hidden' }, h('i', { style: 'display:block;height:4px;border-radius:99px;width:' + pc3 + '%;background:' + bc3 })) : null,
                  h('div', { style: 'font-size:11.5px;color:#64748b;line-height:1.5' }, x2[3]),
                ].filter(Boolean));
              }),
              h('div', { style: 'font-size:9.5px;color:#94a3b8;margin-top:5px' }, 'MEASURED = read from GPS / our board · VERIFIED = documents & trip records · ESTIMATE = labeled approximation · YOU SET = your own saved numbers. Anything unknown is asked — never invented. Dispatch fee (5%) is always auto-deducted before Net.'),
            ]),
            brokerHost,
            h('div', { class: 'cp-row-s', style: 'margin-top:8px;color:#94a3b8' }, 'City-map road + corridor-toll estimates (±) + your saved numbers — everything auto, everything editable. Not financial advice.'),
          ].filter(Boolean));
        };
        render();
        advW.appendChild(host);
      }
      const _cpm = _dp && Number(_dp.cost_per_mile) > 0 ? Number(_dp.cost_per_mile) : null;
      const _profit = (_cpm && l.rate && Number(l.miles) > 0) ? Math.round(Number(l.rate) - Number(l.miles) * _cpm) : null;
      const profitEl = (_profit != null)
        ? h('span', { class: 'cpx-chip', style: _profit >= 0 ? 'background:rgba(22,163,74,.14);color:#15803d' : 'background:rgba(220,38,38,.12);color:#b91c1c', title: 'Estimate: rate − (miles × your $' + _cpm + '/mi cost). Set cost/mi in Settings.' },
            (_profit >= 0 ? '≈ +' : '≈ −') + money(Math.abs(_profit)).replace('$', '$') + ' est. profit')
        : null;
      return h('article', { class: 'cp-load cpx-req' }, [
        h('div', { class: 'cpx-req-rate' }, [h('span', { class: 'v' }, money(l.rate)), rpm ? h('span', { class: 'rpm' }, rpm) : null, profitEl].filter(Boolean)),
        h('div', { class: 'cpx-req-chips' }, [
          h('span', { class: 'cpx-chip eq' }, '🚛 ' + (l.equipment || 'Van')),
          l.hazmat ? h('span', { class: 'cpx-chip', style: 'background:rgba(220,38,38,.14);color:#b91c1c;font-weight:800' }, '☣ HAZMAT') : null,
          l.pickup_date ? h('span', { class: 'cpx-chip' }, '🕐 Pickup: ' + l.pickup_date) : null,
          l.direct_to_you ? (l.direct_offer_expired
            ? h('span', { class: 'cpx-chip', style: 'background:rgba(148,163,184,.18);color:#94a3b8;font-weight:800', title: 'The broker\u2019s direct request window ran out unanswered \u2014 the load is still yours to book from the board at the posted rate.' }, '\ud83c\udfaf DIRECT REQUEST \u2014 expired \u00b7 still bookable')
            : h('span', { class: 'cpx-chip', style: 'background:rgba(139,92,246,.2);color:#c4b5fd;font-weight:800' }, '\ud83c\udfaf DIRECT REQUEST \u2014 reserved for you')) : null,
          (l.details && Array.isArray(l.details.stops) && l.details.stops.length) ? h('button', { class: 'cpx-chip', style: 'background:rgba(139,92,246,.16);color:#c4b5fd;font-weight:800;border:1px solid rgba(139,92,246,.35);cursor:pointer;font:inherit', title: 'Tap for the stop-by-stop route', onClick: (e9) => { e9.stopPropagation(); lbStopsModal9(l); } }, '\ud83d\udfe3 +' + l.details.stops.length + ' STOP' + (l.details.stops.length > 1 ? 'S' : '') + ' \u00b7 ' + l.details.stops.map((s9) => s9.city || '?').join(' \u2192 ') + ' \u203a') : null,
          (l.details && l.details.team_required) ? h('span', { class: 'cpx-chip', style: 'background:rgba(245,158,11,.18);color:#fbbf24;font-weight:800;border:1px solid rgba(245,158,11,.35)' }, '\u26a0 \ud83d\udc65 TEAM DRIVERS REQUIRED') : h('span', { class: 'cpx-chip', style: 'background:rgba(148,163,184,.12);color:#94a3b8;font-weight:700' }, '\ud83d\udc64 Solo OK'),
          (l.details && l.details.driver_assist_required) ? h('span', { class: 'cpx-chip', style: 'background:rgba(245,158,11,.16);color:#fbbf24;font-weight:800' }, '\u26a0 DRIVER ASSIST REQUIRED') : null,
          lbExpired(l) ? h('span', { class: 'cpx-chip', style: 'background:rgba(239,68,68,.2);color:#fca5a5;font-weight:800;border:1px solid rgba(239,68,68,.45)' }, '\u23f0 EXPIRED \u2014 pickup date passed, waiting on broker') : null,
          (window.__lbDh && window.__lbDh[l.id] != null) ? h('span', { class: 'cpx-chip', style: 'background:rgba(34,197,94,.16);color:#4ade80;font-weight:800' }, '\ud83d\udccd ' + window.__lbDh[l.id].toLocaleString() + ' mi deadhead \u2014 live from your GPS') : null,
          (function () {
            const dh = (window.__lbDh && window.__lbDh[l.id] != null) ? Number(window.__lbDh[l.id]) : null;
            if (dh == null || !l.pickup_date) return null;
            const isFcfs = !!(l.accessorials && (l.accessorials.fcfs === 'true' || l.accessorials.fcfs === true));
            let tm = null;
            if (l.pickup_time && /^\d{1,2}:\d{2}/.test(String(l.pickup_time))) tm = String(l.pickup_time).match(/^(\d{1,2}:\d{2})/)[1];
            else if (l.pickup_window) { const mm = String(l.pickup_window).match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/); if (mm) tm = isFcfs ? mm[2] : mm[1]; }
            const deadline = new Date(String(l.pickup_date) + 'T' + (tm || (isFcfs ? '23:59' : '17:00')));
            if (isNaN(deadline.getTime())) return null;
            const hoursTo = (deadline.getTime() - Date.now()) / 3600000;
            if (hoursTo <= -24) return null;
            const team = !!((_dp && _dp.team_drivers) || (l.details && l.details.team_required));
            const driveH = dh / 52;
            const etaH = team ? driveH : (driveH + Math.floor(driveH / 11) * 10);
            const rnd = (x) => x < 10 ? Math.round(x * 10) / 10 : Math.round(x);
            let bg, col, txt;
            if (etaH + 1 <= hoursTo) { bg = 'rgba(34,197,94,.16)'; col = '#4ade80'; txt = '⏱ ~' + rnd(etaH) + 'h to pickup — you’ll make it'; }
            else if (etaH <= hoursTo) { bg = 'rgba(245,158,11,.18)'; col = '#fbbf24'; txt = '⏱ ~' + rnd(etaH) + 'h to pickup — tight, roll now'; }
            else { bg = 'rgba(239,68,68,.16)'; col = '#fca5a5'; txt = '⚠ ~' + rnd(etaH) + 'h to pickup, only ' + rnd(Math.max(hoursTo, 0)) + 'h left — you’d be LATE'; }
            return h('span', { class: 'cpx-chip', style: 'background:' + bg + ';color:' + col + ';font-weight:800', title: (team ? 'Team (nonstop)' : 'Solo (incl. HOS breaks)') + ' estimate from your live deadhead — leave in time or skip the load' }, txt);
          })(),
          (function () {
            const _f = lbFeas(l, _dp);
            if (!_f.have || _f.delEtaH == null || _f.delHoursTo == null) return null;
            const rnd = (x) => x < 10 ? Math.round(x * 10) / 10 : Math.round(x);
            let bg, col, txt;
            if (_f.delEtaH + 2 <= _f.delHoursTo) { bg = 'rgba(34,197,94,.16)'; col = '#4ade80'; txt = '\ud83c\udfc1 ~' + rnd(_f.delEtaH) + 'h to deliver \u2014 on time'; }
            else if (_f.delEtaH <= _f.delHoursTo) { bg = 'rgba(245,158,11,.18)'; col = '#fbbf24'; txt = '\ud83c\udfc1 ~' + rnd(_f.delEtaH) + 'h to deliver \u2014 tight'; }
            else { bg = 'rgba(239,68,68,.16)'; col = '#fca5a5'; txt = '\u26a0 can\u2019t deliver in time (~' + rnd(_f.delEtaH) + 'h needed, ' + rnd(Math.max(_f.delHoursTo, 0)) + 'h left)'; }
            return h('span', { class: 'cpx-chip', style: 'background:' + bg + ';color:' + col + ';font-weight:800', title: (_f.team ? 'Team (nonstop)' : 'Solo (incl. HOS breaks)') + ' \u2014 location\u2192pickup\u2192delivery vs the delivery appointment' }, txt);
          })(),
          l.delivery_date ? h('span', { class: 'cpx-chip' }, 'DEL ' + l.delivery_date) : null,
        ].filter(Boolean)),
        h('div', { class: 'cpx-route' }, [
          h('div', { class: 'cpx-pt' }, [h('span', { class: 'cpx-dot' }), h('span', null, l.origin || '—')]),
          h('div', { class: 'cpx-pt to' }, [h('span', { class: 'cpx-dot' }), h('span', null, [String(l.destination || '—'), l.miles ? h('span', { class: 'sub' }, '  ·  ' + Number(l.miles).toLocaleString() + ' mi') : null].filter(Boolean))]),
        ]),
        meta.length ? h('div', { class: 'cp-load-meta' }, meta.join(' · ')) : null,
        l.requirements ? h('div', { class: 'cp-row-s' }, l.requirements) : null,
        h('div', { style: 'margin:4px 0' }, h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'font-size:.74rem;padding:5px 12px', onClick: (ev9) => { ev9.stopPropagation(); openBrokerPacketPreview(); } }, '\ud83c\udfe2 Broker packet \ud83d\udd12 \u2014 what you get on booking')),
        (l.accessorials && (l.accessorials.detention_per_hr || l.accessorials.tonu)) ? h('div', { class: 'cp-row-s', style: 'color:#0f766e' },
          '\ud83e\uddfe Rate card: ' + ['detention $' + (l.accessorials.detention_per_hr || '60') + '/hr after ' + (l.accessorials.detention_free_hours || '2') + 'h',
            'layover $' + (l.accessorials.layover_per_day || '250') + '/day', 'TONU $' + (l.accessorials.tonu || '250'),
            l.accessorials.lumper_policy ? ('lumper: ' + l.accessorials.lumper_policy) : null,
            (l.accessorials.fcfs === 'true' || l.accessorials.fcfs === true) ? 'FCFS' : null].filter(Boolean).join(' \u00b7 ')) : null,
        h('div', { class: 'cpx-req-actions' }, [bookWrap, detailsBtn]),

      ].filter(Boolean));
    })();
    const gridHost = h('div', { class: 'cp-loadgrid', id: 'cp-loadgrid-host' });
    mount(availWrap, h('div', null, [truckCard, filterBar, setupBanner, bestCard, gridHost].filter(Boolean)));
    mount(content, h('div', null, [capNudge, tabsBar, reqHost, availWrap].filter(Boolean)));
    renderList();
  }

  /* Decision-complete load overview (A2): everything a carrier needs BEFORE booking — accessorial rate card,
     windows / FCFS, stops, instructions, and the mandatory-tracking notice. Broker identity is never shown. */
  async function showLoadDetail(loadId) {
    const bodyEl = h('div', null, h('div', { class: 'cp-muted' }, 'Loading load details…'));
    openModal('Load overview', [bodyEl]);
    let d; try { d = await carrierLoadDetail(loadId); } catch (e) { mount(bodyEl, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load details.')); return; }
    // C3 — posting party's REAL track record (identity stays hidden) appended to the decision set.
    (async () => {
      let ps; try { ps = await carrierViewPoster(loadId); } catch (_) { return; }
      if (!ps) return;
      const bverified = ps.broker_verified === true;
      const btone = toneOf(bverified ? 'success' : 'info');
      const brate = Number(ps.broker_rating || 0);
      const bstars = brate ? '\u2605'.repeat(Math.round(brate)) + '\u2606'.repeat(5 - Math.round(brate)) : '';
      bodyEl.appendChild(h('div', { class: 'cp-row', style: 'margin-top:10px;border-left:4px solid ' + btone.c + ';padding-left:10px;border-radius:8px;flex-wrap:wrap' }, [
        h('div', null, [
          h('div', { class: 'cp-row-t', style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, ['Posting party: ' + (ps.posted_by || '—'),
            ps.broker_trust_score != null ? h('span', { class: 'cp-pill', style: 'background:' + btone.bg + ';color:' + btone.c + ';font-weight:800' }, bverified ? '\u2713 Verified broker' : 'Unverified broker') : null,
            bstars ? h('span', { style: 'color:#f59e0b;font-weight:700' }, bstars + ' ' + brate.toFixed(1)) : null].filter(Boolean)),
          h('div', { class: 'cp-row-s' }, [ps.broker_trust_score != null ? 'Trust ' + ps.broker_trust_score + '/100' : null, ps.loads_delivered != null ? ps.loads_delivered + ' loads delivered' : null, ps.on_time_pct != null ? ps.on_time_pct + '% on-time' : null, ps.loads_submitted != null ? ps.loads_submitted + ' submitted' : null].filter(Boolean).join(' \u00b7 ') || ps.signal || '—'),
          h('div', { class: 'cp-row-s' }, ps.basis || '')]),
      ]));
    })();
    const t = d.terms || {}; const acc = t.accessorials || {};
    const line = (k, v) => v == null || v === '' ? null : h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, k), h('span', null, String(v))]);
    const rpm = d.rpm != null ? '$' + Number(d.rpm).toFixed(2) + '/mi' : null;
    const accEntries = Object.entries(acc);
    mount(bodyEl, h('div', null, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px' }, [
        h('b', { style: 'font-size:1.05rem' }, (d.origin || '—') + ' → ' + (d.destination || '—')),
        h('b', { style: 'color:var(--lb-green,#16a34a)' }, [money(d.rate), rpm ? h('span', { class: 'cp-muted', style: 'font-weight:400;margin-left:6px' }, rpm) : null].filter(Boolean)),
      ]),
      h('div', { class: 'cp-load-tags', style: 'margin-bottom:8px' }, [
        h('span', { class: 'cp-tag' }, d.equipment || 'Van'),
        d.miles ? h('span', { class: 'cp-tag' }, Number(d.miles).toLocaleString() + ' mi') : null,
        d.deadhead ? h('span', { class: 'cp-tag' }, d.deadhead + ' mi deadhead') : null,
        h('span', { class: 'cp-tag' }, d.posted_by || 'LoadBoot dispatch'),
      ].filter(Boolean)),
      line('Commodity', d.commodity), line('Weight', d.weight),
      line('Scheduling', t.scheduling),
      line('Pickup', [d.pickup_date, t.pickup_window].filter(Boolean).join(' · ')),
      line('Delivery', [d.delivery_date, t.delivery_window].filter(Boolean).join(' · ')),
      line('Reference', t.reference),
      h('div', { style: 'margin:10px 0;border:1.5px dashed #94a3b8;border-radius:14px;padding:12px 14px;background:rgba(148,163,184,.06)' }, [
        h('div', { style: 'font-weight:800;font-size:.88rem;display:flex;gap:8px;align-items:center' }, ['\ud83d\udd12', ' You get this the moment you ACCEPT the load']),
        h('div', { class: 'cp-row-s', style: 'margin-top:6px;line-height:1.8' }, [
          '\ud83d\udccd Exact facility street addresses (pickup & delivery)', h('br'),
          '\ud83d\udce6 Pickup / release number for the gate', h('br'),
          '\ud83c\udfc1 Delivery confirmation number', h('br'),
          '\ud83d\udcc5 Appointment confirmation', h('br'),
          '\ud83e\uddfe Executed rate confirmation (signed by the broker + LoadBoot)', h('br'),
          '\ud83d\udef0 Turn-by-turn trip map with geofenced check-ins',
        ]),
      ]),
      t.instructions ? h('div', { style: 'margin:8px 0' }, [h('div', { class: 'cp-row-t' }, 'Instructions'), h('div', { class: 'cp-row-s' }, t.instructions)]) : null,
      (() => {
        const dx = t.details || {};
        const DL = [['load_size', 'Load size'], ['pallets', 'Pallets / pieces'], ['temperature', 'Reefer temperature (\u00b0F)'], ['tarps', 'Tarps'],
          ['load_method_pickup', 'Pickup loading'], ['load_method_delivery', 'Delivery unloading'],
          ['dock_hours_pickup', 'Pickup facility hours'], ['dock_hours_delivery', 'Delivery facility hours'],
          ['facility_contact_pickup', '\ud83d\udcde Pickup dock contact'], ['facility_contact_delivery', '\ud83d\udcde Delivery dock contact'],
          ['cargo_value', 'Cargo value (check your cargo insurance)']];
        const rows2 = DL.map(([k2, lb2]) => dx[k2] != null && dx[k2] !== '' ? line(lb2, k2 === 'cargo_value' ? '$' + Number(dx[k2]).toLocaleString() : dx[k2]) : null).filter(Boolean);
        if (dx.driver_assist_required) rows2.push(line('Driver assist', '\u26a0 REQUIRED \u2014 driver loads/unloads (paid per the rate card)'));
        if (dx.team_required) rows2.push(line('Drivers', '\u26a0 TEAM required'));
        if (!rows2.length) return null;
        return h('div', { style: 'margin:8px 0' }, [h('div', { class: 'cp-row-t', style: 'margin-bottom:4px' }, 'Load details'), ...rows2]);
      })(),
      (() => {
        // Always show the FULL standard rate card. Posting values win; otherwise the
        // LoadBoot marketplace standard applies (and is labeled as such — no blanks, no raw values).
        const money2 = (v) => '$' + Number(v).toLocaleString();
        const STD = [
          ['detention_per_hr', 'Detention (per hour)', '/detention-pay-policy.html', (v) => money2(v) + '/hr', '$60/hr'],
          ['detention_free_hours', 'Detention free time', '/detention-pay-policy.html', (v) => v + ' hours', '2 hours'],
          ['layover_per_day', 'Layover (per day)', '/layover-policy.html', (v) => money2(v) + '/day', '$250/day'],
          ['tonu', 'TONU (Truck Ordered, Not Used)', '/tonu-policy.html', (v) => money2(v), '$250'],
          ['lumper_policy', 'Lumper policy', '/lumper-policy.html', (v) => String(v), 'Reimbursed with receipt'],
          ['driver_assist', 'Driver assist', '/driver-assist-policy.html', (v) => money2(v) + '/stop', '$75/stop'],
          ['extra_stop', 'Extra stop', '/driver-assist-policy.html', (v) => money2(v) + '/stop', '$50/stop'],
          ['fcfs', 'Scheduling', '/fcfs-policy.html', (v) => (v === true || v === 'true') ? 'FCFS — first come, first served' : 'Appointment / window', 'Appointment / window'],
        ];
        const rows = STD.map(([k, label, href, fmt, std]) => {
          const raw = acc[k];
          const hasVal = raw !== undefined && raw !== null && raw !== '';
          const val = hasVal ? fmt(raw) : std;
          return h('div', { class: 'cp-row' }, [
            h('div', { class: 'cp-row-t', style: 'font-size:.88rem' },
              h('a', { href: href, target: '_blank', rel: 'noopener', style: 'font-weight:800;color:inherit;text-decoration:underline;text-decoration-color:rgba(8,131,247,.4);text-underline-offset:3px' }, label)),
            h('span', null, [h('b', null, val), hasVal ? null : h('span', { class: 'cp-muted', style: 'font-size:11px' }, '  · LoadBoot standard')].filter(Boolean)),
          ]);
        });
        return h('div', { style: 'margin-top:8px' }, [
          h('div', { class: 'cp-row-t' }, 'Accessorial rate card'),
          h('div', { class: 'cp-row-s', style: 'margin-bottom:4px' }, 'Every item is clickable — full policy opens. Posted rates are bold; anything not customized uses the LoadBoot marketplace standard.'),
          ...rows,
        ]);
      })(),
      h('div', { class: 'cp-payinfo', style: 'margin-top:10px' }, [h('div', { class: 'cp-payinfo-h' }, '📍 Tracking'), h('div', { class: 'cp-payinfo-b' }, t.tracking_note || 'Location tracking is on from booking until delivery.')]),
    ].filter(Boolean)));
  }

  /* ----- My trips ----- */
function tripStepper(status) {
  const st = (status || '').toLowerCase();
  if (st === 'canceled' || st === 'cancelled') return h('div', { class: 'cp-row-s', style: 'color:#dc2626;font-weight:700;margin:10px 2px' }, 'Trip canceled');
  const STEPS = ['Booked', 'Dispatched', 'In transit', 'Delivered'];
  let cur = 0;
  if (st === 'dispatched') cur = 1; else if (st === 'in_transit') cur = 2; else if (st === 'delivered' || st === 'invoiced' || st === 'paid') cur = 3;
  const nodes = [];
  STEPS.forEach((label, i) => {
    if (i > 0) nodes.push(h('div', { class: 'cp-step-line' + (i <= cur ? ' done' : '') }));
    const cls = i < cur ? ' done' : (i === cur ? ' current' : '');
    nodes.push(h('div', { class: 'cp-step' + cls }, [h('div', { class: 'cp-step-dot' }, i < cur ? '\u2713' : String(i + 1)), h('div', { class: 'cp-step-lbl' }, label)]));
  });
  return h('div', { class: 'cp-steps' }, nodes);
}
  async function loadTrips() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let rows; try { rows = await pocketTrips(80); } catch (e) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'Failed to load.'))); return; }
    try {
      const act9 = (rows || []).find(r9 => /planned|dispatched|in_transit/.test(String(r9.status || '')));
      if (act9) ensureLiveLoc(act9.id);
      else if (_liveWatch != null) { stopLiveLoc(); }
    } catch (_) {}
    if (!rows || !rows.length) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No trips yet. Booked loads will appear here.'))); return; }
    mount(content, h('div', { class: 'cp-card' }, [cardHead('My trips', rows.length + ' total'), ...rows.map(t => {
      const active = t.status === 'planned' || t.status === 'dispatched' || t.status === 'in_transit';
      const confirm = (t.status === 'dispatched') ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { ev.currentTarget.disabled = true; try { await pocketConfirmTrip(t.id); ev.currentTarget.textContent = 'Confirmed ✓'; } catch (x) { ev.currentTarget.textContent = 'Error'; } } }, 'Confirm') : null;
      const share = active ? h('button', { class: 'cp-btn cp-btn-sm', onClick: (ev) => shareLoc(ev, t.id) }, '📍 Share location') : null;
      const nav = (active && t.destination) ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(t.destination), '_blank', 'noopener') }, '🧭 Navigate') : null;
      const _locked = active && /dispatched|in_transit/.test(String(t.status || ''));
      const live = active ? (
        (_locked && _liveWatch != null && _liveTrip === t.id)
          ? h('span', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a;cursor:default', title: 'Live tracking is REQUIRED on the rate confirmation from pickup to delivery. It stops automatically at delivery. On-road emergency? Use the Emergency button \u2014 verified emergencies never penalize you.' }, '\ud83d\udef0 Tracking LOCKED ON until delivery')
          : h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: (ev) => {
              if (_locked && _liveWatch != null && _liveTrip === t.id) { lbToast('Tracking is required until delivery \u2014 it stops automatically when you deliver. For a verified on-road emergency, use the Emergency button.', 'warning', 'Tracking locked'); return; }
              toggleLiveLoc(ev, t.id);
            } }, (_liveWatch != null && _liveTrip === t.id) ? '\ud83d\udef0 Tracking ON \u2014 tap to stop' : '\ud83d\udef0 Live tracking')
      ) : null;
      const fw = h('div');
      const issue = active ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
        if (fw.firstChild) { fw.innerHTML = ''; return; }
        const kind = h('select', { class: 'cp-in' }, ['detention', 'layover', 'lumper', 'tonu', 'breakdown', 'accident', 'weather', 'missed_appointment', 'other'].map(k => h('option', { value: k }, k === 'tonu' ? 'TONU' : k.replace('_', ' '))));
        const note = h('input', { class: 'cp-in', placeholder: 'Details (optional)' });
        const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…'; try { await pocketReportIssue(t.id, kind.value, note.value.trim()); fw.innerHTML = ''; fw.appendChild(h('div', { class: 'cp-row-s', style: 'color:var(--lb-green)' }, '✓ Reported to dispatch')); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send'; alert((e && e.message) || 'Could not report.'); } } }, 'Send');
        fw.appendChild(h('div', { class: 'cp-inlineform' }, [kind, note, send]));
      } }, '⚠ Report issue') : null;
      const emergency = active ? h('button', { class: 'cp-btn cp-btn-sm', style: 'border-color:#dc2626;color:#dc2626', onClick: () => openEmergency(t) }, '🚨 Emergency') : null;
      const podW = h('div');
      const canPod = t.status === 'delivered' || t.status === 'invoiced';
      // Suggested Reloads (Relay-style): loads picking up near this trip's destination
      const reloadW = h('div');
      const reloadBtn = (t.destination && (t.status === 'in_transit' || t.status === 'delivered' || t.status === 'dispatched')) ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
        if (reloadW.firstChild) { reloadW.innerHTML = ''; return; }
        reloadW.appendChild(h('div', { class: 'cp-muted' }, 'Finding reloads near ' + t.destination + '…'));
        let all; try { all = await pocketAvailableLoads(60); } catch (_) { all = []; }
        const dst = String(t.destination || '').toLowerCase(); const dstST = dst.trim().slice(-2);
        const near = (all || []).filter(l => {
          const o = String(l.origin || '').toLowerCase();
          return o && (o.includes(dst.split(',')[0]) || (dstST.match(/[a-z]{2}/) && o.trim().slice(-2) === dstST));
        }).slice(0, 5);
        reloadW.innerHTML = '';
        if (!near.length) { reloadW.appendChild(h('div', { class: 'cp-row-s', style: 'padding:6px 0' }, 'No reloads near ' + t.destination + ' right now — post your truck there and get alerted.')); return; }
        near.forEach(l => reloadW.appendChild(h('div', { class: 'cp-row' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, (l.origin || '—') + ' → ' + (l.destination || '—')),
            h('div', { class: 'cp-row-s' }, money(l.rate) + (l.miles ? ' · ' + l.miles + ' mi' : '') + (l.rate && Number(l.miles) > 0 ? ' · $' + (Number(l.rate) / Number(l.miles)).toFixed(2) + '/mi' : '') + (l.pickup_date ? ' · PU ' + l.pickup_date : ''))]),
          h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
            ev.currentTarget.disabled = true; ev.currentTarget.textContent = '…';
            try { await requestBookLoad(l.id); ev.currentTarget.replaceWith(h('span', { class: 'cp-pill amber' }, 'requested')); }
            catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Request'; alert((e && e.message) || 'Could not request.'); }
          } }, 'Request'),
        ])));
      } }, '🔁 Reloads') : null;
      const rateW = h('div');
      const rateBtn = canPod ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
        if (rateW.firstChild) { rateW.innerHTML = ''; return; }
        let sel = 0; const starEls = [];
        const paint = () => starEls.forEach((el2, i) => { el2.textContent = i < sel ? '★' : '☆'; el2.style.color = i < sel ? '#F97316' : '#94a3b8'; });
        const starsBar = h('div', { style: 'display:flex;gap:6px;font-size:26px;cursor:pointer;user-select:none' }, [1, 2, 3, 4, 5].map((n) => { const el2 = h('span', { onClick: () => { sel = n; paint(); } }, '☆'); starEls.push(el2); return el2; }));
        const cmt = h('input', { class: 'cp-in', placeholder: 'Comment (optional)' });
        const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          if (!sel) { alert('Choose 1–5 stars.'); return; }
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…';
          try { await rateCounterparty(t.id, sel, cmt.value.trim() || null); rateW.innerHTML = ''; rateW.appendChild(h('div', { class: 'cp-row-s', style: 'color:var(--lb-green, #16a34a)' }, '✓ Rating submitted — thank you')); }
          catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Submit rating'; alert((e && e.message) || 'Could not rate.'); }
        } }, 'Submit rating');
        rateW.appendChild(h('div', { class: 'cp-inlineform' }, [h('div', { class: 'cp-row-s' }, 'Rate the posting party for this trip:'), starsBar, cmt, send]));
      } }, '⭐ Rate') : null;
      const pod = canPod ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
        if (podW.firstChild) { podW.innerHTML = ''; return; }
        showCarrierPod(t, podW);
      } }, '📄 Proof of delivery') : null;
      const assign = active ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => assignTrip(t) }, '👤 Assign driver/truck') : null;
      const advBtn = (label, next) => h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try { await pocketAdvanceTrip(t.id, next); loadTrips(); }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = label; alert((e && e.message) || 'Could not update.'); }
      } }, label);
      const _openInApp = async () => {
        try { const m = await import('./trip-map.js'); await m.openTripMap(t, { docs: () => { moreW.style.display = 'block'; moreT.textContent = '\ud83d\udcc1 Documents & tools \u25b4'; moreT.scrollIntoView({ behavior: 'smooth' }); }, emergency: () => openEmergency(t) }); } catch (e) { alert((e && e.message) || 'Could not open the map.'); }
      };
      const liveMap = active ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7;color:#fff', onClick: () => {
        const goingToPickup = (t.status === 'planned');
        const dest = goingToPickup
          ? ((t.pickup_lat != null && t.pickup_lng != null) ? t.pickup_lat + ',' + t.pickup_lng : (t.origin || ''))
          : ((t.delivery_lat != null && t.delivery_lng != null) ? t.delivery_lat + ',' + t.delivery_lng : (t.destination || ''));
        const destTxt = goingToPickup ? (t.origin || 'pickup') : (t.destination || 'delivery');
        const big = (bg2, fg2, label2, sub2, on2) => h('button', { style: 'width:100%;border:0;border-radius:14px;padding:15px;margin-bottom:9px;cursor:pointer;text-align:left;background:' + bg2 + ';color:' + fg2 + ';font-family:Manrope,sans-serif', onClick: on2 }, [
          h('div', { style: 'font-weight:900;font-size:1rem' }, label2),
          h('div', { style: 'font-size:.8rem;opacity:.8;margin-top:2px' }, sub2),
        ]);
        let closeM;
        closeM = openModal(goingToPickup ? '\u25b6 Start your trip' : '\ud83d\uddfa Continue your trip', [
          h('div', { class: 'cp-row-s', style: 'margin-bottom:10px' }, 'Heading to: ' + destTxt + '. Your check-ins (arrive/depart) always happen in the LoadBoot map \u2014 they are your proof for on-time and detention pay.'),
          big('#FC5305', '#fff', '\ud83d\uddfa LoadBoot live map', 'In-app navigation with GPS check-in buttons, route and ETA', () => { if (closeM) closeM(); _openInApp(); }),
          big('rgba(8,131,247,.15)', '#60A5FA', '\ud83e\udded Google Maps', 'Opens your phone\u2019s Google Maps \u2014 destination is pre-filled, just drive', () => { window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(dest), '_blank'); }),
          big('rgba(255,255,255,.07)', 'var(--lb-ink,#dbe6f5)', '\ud83d\udcf1 Other map apps', 'Apple Maps / Waze / HERE \u2014 device chooser', () => {
            const q2 = dest.includes(',') && !/[a-z]/i.test(dest) ? dest : encodeURIComponent(dest);
            if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) window.open('https://maps.apple.com/?daddr=' + q2 + '&dirflg=d', '_blank');
            else location.href = 'geo:' + (dest.includes(',') && !/[a-z]/i.test(dest) ? dest : '0,0?q=' + q2);
          }),
        ]);
      } }, t.status === 'planned' ? '\u25b6 Start your trip' : '\ud83d\uddfa Live trip') : null;
      const start = null; // status is earned by GPS check-in at the pickup — no manual Start-status button
      const cancelBtn = (t.status === 'planned' || t.status === 'dispatched') ? h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'color:#f87171', onClick: async () => {
        let prev; try { prev = await cancelPreview(t.id); } catch (_) { prev = { tier: 'standard', penalty: false, hours_to_pickup: null, message: 'The load goes back on the board.' }; }
        const tone = !prev.penalty ? { c: '#4ade80', bd: '#22c55e', bg: 'rgba(34,197,94,.1)' } : (prev.tier === 'very_late' ? { c: '#fca5a5', bd: '#ef4444', bg: 'rgba(239,68,68,.12)' } : { c: '#fcd34d', bd: '#f59e0b', bg: 'rgba(245,158,11,.12)' });
        const reason = h('input', { class: 'cp-in', placeholder: 'Reason (required \u2014 broker & dispatch see this)' });
        const emsg = h('div', { class: 'cp-row-s' });
        let closeM;
        const doBtn = h('button', { class: 'cp-btn', style: 'flex:1;background:' + tone.bd, onClick: async (ev) => {
          if (!reason.value.trim()) { emsg.textContent = 'A written reason is required.'; emsg.style.color = '#f87171'; return; }
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Cancelling\u2026';
          try { const r9 = await pocketCancelTrip(t.id, reason.value.trim()); if (closeM) closeM(); lbToast(r9.note || 'Cancelled.', r9.penalty ? 'urgent' : 'warning', 'Load cancelled'); loadTrips(); }
          catch (e9) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Cancel this load'; emsg.textContent = (e9 && e9.message) || 'Could not cancel.'; emsg.style.color = '#f87171'; }
        } }, 'Cancel this load');
        const keepBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { if (closeM) closeM(); } }, 'Keep it');
        closeM = openModal('Cancel this load?', [
          h('div', { style: 'border-left:4px solid ' + tone.bd + ';background:' + tone.bg + ';border-radius:10px;padding:11px 13px;color:' + tone.c + ';font-size:.9rem;line-height:1.55' }, (prev.hours_to_pickup != null ? '\u23f1 ~' + prev.hours_to_pickup + 'h to pickup \u2014 ' : '') + prev.message),
          h('div', { class: 'cp-row-s', style: 'margin-top:10px' }, 'Verified breakdown / emergency? Use \u201c\u26a0 Report issue \u2192 Emergency\u201d instead \u2014 it reschedules with NO penalty.'),
          reason, emsg,
          h('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [keepBtn, doBtn]),
        ]);
      } }, '\u2715 Cancel load') : null;
      const deliver = (t.status === 'in_transit') ? advBtn('✓ Mark delivered', 'delivered') : null;
      // Detention protection: record REAL arrive/depart times at each stop. If a facility holds you past
      // the free window, dispatch sees it automatically and a detention draft is created for review.
      const dwellW = h('div');
      const dwell = active ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
        if (dwellW.firstChild) { dwellW.innerHTML = ''; return; }
        const mk = (label, fn) => h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { const r = await fn(); ev.currentTarget.textContent = '✓'; if (r && r.detention_minutes > 0) alert('Detention recorded: ' + r.detention_minutes + ' min past free time. Dispatch has been notified.'); }
          catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not record.'); }
        } }, label);
        const gpsArrive = (stop) => new Promise((res, rej) => {
          if (!navigator.geolocation) return rej(new Error('This device has no GPS — arrivals must be GPS-verified.'));
          navigator.geolocation.getCurrentPosition(
            (p2) => tripArriveGps(t.id, stop, p2.coords.latitude, p2.coords.longitude).then(res, rej),
            () => rej(new Error('Enable location first — arrival check-ins are GPS-verified proof.')),
            { enableHighAccuracy: true, timeout: 12000 });
        });
        dwellW.appendChild(h('div', { class: 'cp-inlineform' }, [
          mk('At pickup', () => gpsArrive('pickup')),
          mk('Left pickup', () => tripDepart(t.id, 'pickup')),
          mk('At delivery', () => gpsArrive('delivery')),
          mk('Left delivery', () => tripDepart(t.id, 'delivery')),
        ]));
        dwellW.appendChild(h('div', { class: 'cp-row-s' }, 'Times are recorded when you tap — this is what protects your detention pay.'));
      } }, '⏱ Arrive / depart') : null;
      // Pay claims — detention / layover / TONU / lumper with automatic GPS+time evidence
      const accW = h('div');
      const KLBL = { detention: 'Detention', layover: 'Layover', tonu: 'TONU', lumper: 'Lumper', driver_assist: 'Driver assist', stop_off: 'Extra stop', other: 'Other' };
      const accBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
        if (accW.firstChild) { accW.innerHTML = ''; return; }
        accW.appendChild(h('div', { class: 'cp-muted' }, 'Loading claims…'));
        let list = []; try { list = await tripAccessorials(t.id) || []; } catch (_) {}
        let trs9 = []; try { trs9 = await payMyTransfers() || []; } catch (_) {}
        const trMap9 = {}; (Array.isArray(trs9) ? trs9 : []).forEach((x9) => { if (x9.kind === 'claim') trMap9[x9.ref_id] = x9; });
        accW.innerHTML = '';
        const rows = h('div', null, list.map(a => {
          const tone2 = a.status === 'approved' ? ['rgba(34,197,94,.14)', '#4ade80'] : a.status === 'rejected' ? ['rgba(239,68,68,.14)', '#f87171'] : ['rgba(245,158,11,.14)', '#fbbf24'];
          const bs = a.broker_status; const ss = a.support_status;
          return h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
            h('div', { style: 'min-width:200px;flex:1' }, [h('div', { class: 'cp-row-t' }, (KLBL[a.kind] || a.kind) + (a.amount != null ? ' · ' + money(a.amount) : '')),
              h('div', { class: 'cp-row-s' }, (a.note || '') + (a.decision_note ? ' — ' + a.decision_note : '')),
              (a.evidence && a.evidence.calc) ? h('div', { class: 'cp-row-s', style: 'color:#7cc0ff' }, '🧮 ' + a.evidence.calc) : null,
              h('div', { style: 'display:flex;gap:6px;margin-top:3px;flex-wrap:wrap' }, [
                bs === 'approved' ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.14);color:#4ade80' }, '✓ Broker approved') : bs === 'disputed' ? h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.14);color:#f87171', title: a.broker_note || '' }, '✕ Broker rejected') : bs ? h('span', { class: 'cp-pill', style: 'background:rgba(148,163,184,.15);color:#94a3b8' }, 'Broker reviewing') : null,
                ss === 'open' ? h('span', { class: 'cp-pill', style: 'background:rgba(8,131,247,.14);color:#3b9dff' }, '🎧 With support') : null,
                ss === 'decided' ? h('span', { class: 'cp-pill', style: 'background:' + (a.support_verdict === 'carrier' ? 'rgba(34,197,94,.14);color:#4ade80' : 'rgba(239,68,68,.14);color:#f87171') }, '⚖ ' + (a.support_verdict === 'carrier' ? 'Ruled FOR you' : 'Ruled against you')) : null,
                (trMap9[a.id] && trMap9[a.id].status === 'sent') ? h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.16);color:#fbbf24' }, '\u{1F4B8} Payment on the way \u00b7 by ' + (trMap9[a.id].expected_by ? new Date(trMap9[a.id].expected_by).toLocaleDateString() : 'soon')) : null,
                (trMap9[a.id] && trMap9[a.id].status === 'received') ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.14);color:#4ade80' }, '\u2713 Payment received') : null,
              ].filter(Boolean)),
              ss === 'decided' && a.support_note ? h('div', { class: 'cp-row-s', style: 'margin-top:3px' }, 'Verdict: ' + a.support_note) : null,
              bs === 'disputed' && ss === 'none' ? h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:5px', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
                try { await claimEscalate(a.id); b9.textContent = '🎧 Escalated ✓'; lbToast('LoadBoot support will investigate your GPS evidence and decide — the verdict binds both sides.', 'success', 'Escalated'); } catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent'); }
              } }, '🎧 Ask support to decide') : null,
              (trMap9[a.id] && trMap9[a.id].status === 'sent') ? h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:5px;background:#16a34a', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
                try { await payConfirmReceived(trMap9[a.id].id); b9.textContent = '\u2713 Confirmed'; lbToast('Marked received \u2014 the broker sees this claim as settled now.', 'success', 'Payment received'); } catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent'); }
              } }, '\u2713 I received this payment') : null,
            ].filter(Boolean)),
            h('span', { class: 'cp-pill', style: 'background:' + tone2[0] + ';color:' + tone2[1] + ';font-weight:800' }, a.status === 'requested' ? 'in review' : a.status),
          ]);
        }));
        const pk = h('select', { class: 'cp-in', style: 'max-width:230px' }, [
          ['bol_signed', '\ud83d\udcdd Facility-SIGNED BOL (in/out times)'],
          ['pod_signed', '\ud83d\udcdd Facility-SIGNED POD'],
          ['lumper_receipt', '\ud83e\uddfe Lumper receipt'],
          ['gate_ticket', '\ud83c\udfab Gate ticket'],
          ['stop_photo', '\ud83d\udcf7 Dock / stop photo'],
        ].map(([v2, l2]) => h('option', { value: v2 }, l2)));
        const pf = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.85rem' });
        const pMsg = h('div', { class: 'cp-row-s' });
        const pUp = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { const b9 = ev.currentTarget;
          const f = pf.files && pf.files[0]; if (!f) { pMsg.textContent = 'Choose a photo/PDF first.'; return; }
          b9.disabled = true; b9.textContent = 'Uploading\u2026';
          try {
            const m = await uploadTripDoc(f, t.id, pk.value);
            await pocketUploadTripDoc({ trip: t.id, kind: pk.value, path: m.path, fileName: m.fileName, contentType: m.contentType, size: m.size });
            pf.value = ''; pMsg.textContent = '\u2713 Attached to this trip \u2014 it goes into any claim\u2019s evidence automatically.';
            lbToast('Stop proof saved. Ask the facility to WRITE the in/out times and SIGN \u2014 their own paper is the strongest proof.', 'success', 'Proof attached \u2713');
          } catch (e) { pMsg.textContent = (e && e.message) || 'Upload failed.'; }
          b9.disabled = false; b9.textContent = 'Attach proof';
        } }, 'Attach proof');
        const packHost = h('div');
        (async () => {
          let pk9; try { pk9 = await pocketTripDocs(t.id); } catch (_) { return; }
          if (!pk9) return;
          const r9 = (k9, v9, miss9) => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px dashed rgba(148,163,184,.25);font-size:.82rem' }, [
            h('span', { style: 'opacity:.75' }, k9), v9 ? h('b', { style: 'text-align:right' }, v9) : h('span', { style: 'color:#d97706;font-weight:700' }, miss9 || 'pending from broker')]);
          mount(packHost, h('div', { style: 'margin:8px 0;padding:10px 12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:12px' }, [
            h('div', { style: 'font-weight:800;font-size:.88rem' }, '\ud83d\udd13 Dispatch pack \u2014 unlocked because this load is YOURS'),
            r9('\ud83d\udccd Pickup address', pk9.origin_full),
            ...(await (async () => { try {
              if (!t.load_id) return [];
              const st9 = await ccLoadStops(t.load_id);
              if (!st9 || !st9.count) return [];
              return (st9.stops || []).map((sp9, i9) => r9((sp9.kind === 'pickup' ? '\u{1F4E6} Extra PICKUP ' : '\u{1F4E4} Extra DELIVERY ') + (i9 + 1),
                (st9.full ? (sp9.address || '') : ((sp9.city || '') + ', ' + (sp9.state || '')))
                + (sp9.purpose ? ' \u2014 ' + sp9.purpose : '')
                + (sp9.date ? ' \u00b7 ' + sp9.date : '')
                + (sp9.sched === 'Appointment' ? (sp9.time ? ' @ ' + sp9.time : ' (appointment)') : (sp9.window ? ' \u00b7 FCFS ' + sp9.window : ''))
                + (sp9.doc_number ? ' \u00b7 #' + sp9.doc_number : '')));
            } catch (_) { return []; } })()),
            r9('\ud83d\udccd Delivery address', pk9.destination_full),
            r9('\ud83d\udce6 Pickup / PU number', pk9.pickup_number),
            r9('\ud83c\udfc1 Delivery number', pk9.delivery_number),
            r9('\ud83d\udcc5 Appointment', pk9.appointment),
            r9('\ud83e\uddfe Rate confirmation', pk9.rate_con_executed ? ('Executed \u2713' + (pk9.rate_con_ref ? ' \u00b7 ' + String(pk9.rate_con_ref).slice(0, 40) : '')) : null, 'being executed'),
            pk9.reference ? r9('Reference', pk9.reference) : null,
            (pk9.broker_name && pk9.broker_packet && pk9.broker_packet.length) ? h('div', { style: 'margin-top:8px;padding-top:8px;border-top:1px dashed rgba(148,163,184,.3)' }, [
              h('div', { style: 'font-weight:800;font-size:.82rem;margin-bottom:4px' }, '\ud83c\udfe2 Broker packet \u2014 ' + (pk9.broker_name || 'broker') + ' (LoadBoot-verified)'),
              ...pk9.broker_packet.map(bp9 => h('div', { style: 'display:flex;justify-content:space-between;font-size:.78rem;padding:2.5px 0' }, [
                h('span', { style: 'opacity:.75' }, bp9.label),
                h('b', { style: 'color:' + (bp9.status === 'verified' ? '#4ade80' : '#fbbf24') }, bp9.status === 'verified' ? '\u2713 verified' : bp9.status),
              ])),
              h('div', { style: 'font-size:.7rem;opacity:.7;margin-top:4px' }, pk9.payments_note || ''),
            ]) : null,
          ].filter(Boolean)));
        })();
        const proofRow = h('div', { style: 'margin:8px 0;padding:8px 10px;background:rgba(8,131,247,.07);border-radius:10px' }, [
          h('div', { style: 'font-weight:700;font-size:.85rem' }, '\ud83d\udcce Stop proof \u2014 collect it AT the dock'),
          h('div', { class: 'cp-row-s' }, 'Get the facility to write IN/OUT times on the BOL and sign it, keep lumper receipts and gate tickets \u2014 photo them here. Paper + your GPS = a claim brokers can\u2019t argue with.'),
          h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px' }, [pk, pf, pUp]), pMsg,
        ]);
        const sel = h('select', { class: 'cp-in' }, ['detention', 'layover', 'tonu', 'lumper', 'driver_assist', 'stop_off', 'other'].map(k2 => h('option', { value: k2 }, KLBL[k2])));
        const amtIn = h('input', { class: 'cp-in', type: 'number', step: '0.01', placeholder: 'Receipt total $', style: 'display:none;max-width:150px' });
        const rateHint = h('div', { class: 'cp-row-s' }, '');
        const HINTS = { detention: 'Auto-computed from your GPS dwell: minutes past free time × the agreed $/hr.', layover: 'Agreed per-day layover rate × days held.', tonu: 'Flat TONU rate from the rate card agreed at posting.', lumper: 'Enter the receipt total and ATTACH the lumper receipt above — reimbursed in full.', driver_assist: 'Flat driver-assist rate from the agreed rate card.', stop_off: 'Flat extra-stop rate from the agreed rate card.', other: 'Enter the amount and attach proof above — dispatch verifies.' };
        const syncKind = () => { const need$ = sel.value === 'lumper' || sel.value === 'other'; amtIn.style.display = need$ ? '' : 'none'; rateHint.textContent = HINTS[sel.value] || ''; };
        sel.onchange = syncKind; syncKind();
        const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          const _b = ev.currentTarget; _b.disabled = true; _b.textContent = 'Filing…';
          try {
            const r0 = await carrierRequestAccessorial(t.id, sel.value, note.value.trim() || null, amtIn.value ? Number(amtIn.value) : null);
            lbToast((r0 && r0.note) || 'Claim filed with your recorded arrive/depart times and GPS attached as proof. Dispatch will review it.', 'success', 'Claim submitted ✓');
            accW.innerHTML = ''; accBtn.click();
          } catch (e) { _b.disabled = false; _b.textContent = 'File claim'; lbToast((e && e.message) || 'Could not file the claim.', 'urgent', 'Claim failed'); }
        } }, 'File claim');
        const note = h('input', { class: 'cp-in', placeholder: 'What happened? (e.g. held 3 hours at dock)' });
        accW.appendChild(h('div', { class: 'cp-inlineform' }, [
          list.length ? rows : h('div', { class: 'cp-row-s' }, 'No pay claims on this trip yet.'),
          h('div', { class: 'cp-row-s', style: 'margin-top:6px;font-weight:700' }, 'File a new claim — your Arrive/Depart stamps and GPS go with it automatically:'),
          packHost, proofRow, sel, amtIn, note, send, rateHint,
          h('div', { class: 'cp-row-s' }, 'Detention is auto-detected when you leave a stop past free time. TONU is auto-filed if a load is cancelled after your truck was committed.'),
        ]));
      } }, '💰 Pay claims');
      // D-screens — generic renderer: any jsonb payload -> readable rows (objects/arrays flattened one level)
      const jr = (v) => {
        if (v === null || v === undefined || v === '') return '—';
        if (typeof v !== 'object') return String(v);
        if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? Object.entries(x).map(([k2, v2]) => k2 + ': ' + jr(v2)).join(' · ') : String(x))).join('  |  ') || '—';
        return Object.entries(v).map(([k2, v2]) => k2.replace(/_/g, ' ') + ': ' + jr(v2)).join(' · ');
      };
      const jsonCard = (obj, skip) => h('div', null, Object.entries(obj || {}).filter(([k2]) => !(skip || []).includes(k2)).map(([k2, v2]) =>
        h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t', style: 'text-transform:capitalize;min-width:140px' }, k2.replace(/_/g, ' ')), h('div', { class: 'cp-row-s', style: 'text-align:right' }, jr(v2))])));
      // D5 — properly formatted dispatch sheet (grouped) instead of a raw key/value dump.
      const dsRow = (label, val) => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t', style: 'min-width:132px' }, label), h('div', { class: 'cp-row-s', style: 'text-align:right' }, (val === null || val === undefined || val === '') ? '—' : String(val))]);
      const dsSection = (title, rows) => h('div', { style: 'margin-top:14px' }, [h('div', { style: 'text-transform:uppercase;font-size:.7rem;letter-spacing:.09em;color:#64748b;font-weight:700;margin-bottom:4px' }, title)].concat(rows.filter(Boolean)));
      const dispatchSheetCard = (d) => {
        d = d || {}; const pk = d.pickup || {}, dl = d.delivery || {}, dr = d.driver || {}, det = d.detention || {};
        return h('div', null, [
          h('div', { style: 'background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;border-radius:14px;padding:16px 18px' }, [
            h('div', { style: 'font-size:.7rem;letter-spacing:.11em;text-transform:uppercase;opacity:.7' }, (d.issued_by || 'LoadBoot Dispatch') + ' · dispatch sheet'),
            h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-top:5px' }, [
              h('div', { style: 'font-size:1.7rem;font-weight:800' }, money(d.agreed_rate || 0)),
              h('div', { style: 'text-align:right;font-size:.85rem;opacity:.9' }, [h('div', null, (d.loaded_miles ? String(d.loaded_miles) + ' mi loaded' : '— mi')), d.loaded_rpm ? h('div', null, '$' + d.loaded_rpm + '/mi') : '']),
            ]),
            h('div', { style: 'font-size:.75rem;opacity:.7;margin-top:4px' }, 'Deadhead: ' + (d.deadhead_note || '—') + '  ·  Load ' + (d.load_number ? String(d.load_number).slice(0, 8) : '—')),
          ]),
          dsSection('Pickup', [dsRow('Address', pk.address), dsRow('Date', pk.date), dsRow('Window', pk.window), dsRow('Appointment', pk.appointment_required ? 'Required' : 'FCFS / window'), dsRow('Reference', pk.reference)]),
          dsSection('Delivery', [dsRow('Address', dl.address), dsRow('Date', dl.date), dsRow('Window', dl.window)]),
          dsSection('Freight', [dsRow('Commodity', d.commodity), dsRow('Weight', d.weight), dsRow('Equipment', d.equipment)]),
          dsSection('Truck & driver', [dsRow('Driver', dr.name), dsRow('Phone', dr.phone), dsRow('Truck #', d.truck_no), dsRow('Trailer #', d.trailer_no)]),
          dsSection('Accessorial rates', [dsRow('Detention', (det.rate_per_hr ? '$' + det.rate_per_hr + '/hr' : '—') + (det.free_hours ? ' after ' + det.free_hours + 'h free' : '')), dsRow('How', det.how), dsRow('Layover', d.layover ? '$' + d.layover + '/day' : '—'), dsRow('TONU', d.tonu ? '$' + d.tonu : '—'), dsRow('Lumper', d.lumper_process)]),
          dsSection('Documents to collect', (d.documents_to_collect || []).map(x => h('div', { class: 'cp-row-s', style: 'padding:2px 0' }, '• ' + x))),
          dsSection('Tracking & POD', [h('div', { class: 'cp-row-s' }, d.tracking_instructions || ''), h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, d.pod_instructions || '')]),
          d.special_instructions ? dsSection('Special instructions', [h('div', { class: 'cp-row-s' }, d.special_instructions)]) : null,
          h('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, [d.rate_confirmation_attached ? h('span', { class: 'cp-pill green' }, 'RC attached') : h('span', { class: 'cp-pill gray' }, 'No RC'), d.rc_acknowledged ? h('span', { class: 'cp-pill green' }, 'RC acknowledged') : '']),
        ].filter(Boolean));
      };
      const sheetBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
        const host = h('div', { class: 'cp-muted' }, 'Loading…'); openModal('Dispatch sheet', [host]);
        try { const d0 = await dispatchSheet(t.id); mount(host, h('div', null, [h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:10px;background:#0883F7', onClick: () => printDispatchSheet(d0) }, '⬇ Download PDF'), dispatchSheetCard(d0)])); } catch (e) { mount(host, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load.')); }
      } }, '📋 Dispatch sheet');
      const rcBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
        const host = h('div', { class: 'cp-muted' }, 'Loading…'); openModal('Rate confirmation (immutable)', [host]);
        try {
          const d0 = await myRateConfirmation(t.id);
          const ackB = d0.acknowledged ? h('span', { class: 'cp-pill green' }, 'Acknowledged ✓') : h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
            ev.currentTarget.disabled = true;
            try { await acknowledgeRC(t.id); ev.currentTarget.textContent = 'Acknowledged ✓'; } catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Failed'); }
          } }, 'Acknowledge RC');
          mount(host, h('div', null, [h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:10px;background:#0883F7', onClick: () => openPrintable('Rate Confirmation', 'RATE CONFIRMATION', [{ rows: Object.entries(d0.rc || {}).map(([k, v]) => [k.replace(/_/g, ' '), jr(v)]) }, { note: d0.note || '' }]) }, '⬇ Download PDF'), jsonCard(d0.rc, []), h('div', { style: 'margin-top:10px' }, ackB), h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, d0.note || '')]));
        } catch (e) { mount(host, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load.')); }
      } }, '🧾 Rate con');
      const packBtn = (t.status === 'delivered' || t.status === 'invoiced') ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
        const host = h('div', { class: 'cp-muted' }, 'Loading…'); openModal('Delivery document pack', [host]);
        try {
          const d0 = await deliveryDocPack(t.id);
          mount(host, h('div', null, [
            h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:10px;background:#0883F7', onClick: () => openPrintable('Delivery Documents', 'DELIVERY PACK', [{ h: 'Required', rows: Object.entries(d0.required || {}).map(([k, v]) => [k.replace(/_/g, ' '), jr(v)]) }, { h: 'Conditional', rows: Object.entries(d0.conditional || {}).map(([k, v]) => [k.replace(/_/g, ' '), jr(v)]) }, { note: d0.retention_note || '' }]) }, '⬇ Download PDF'),
            h('div', { class: 'cp-row' }, [h('b', null, 'Invoice packet'), h('span', { class: 'cp-pill ' + ((d0.packet_ready) ? 'green' : 'amber') }, d0.packet_ready ? 'READY' : 'INCOMPLETE')]),
            h('h4', { style: 'margin:10px 0 4px' }, 'Required'), jsonCard(d0.required, []),
            h('h4', { style: 'margin:10px 0 4px' }, 'Conditional'), jsonCard(d0.conditional, []),
            h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, d0.retention_note || ''),
          ]));
        } catch (e) { mount(host, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load.')); }
      } }, '📦 Delivery docs') : null;
      const history = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
        const host = h('div', { class: 'cp-muted' }, 'Loading…');
        openModal('Trip history', [host]);
        try {
          const ev = await pocketTripTimeline(t.id);
          mount(host, (ev && ev.length) ? h('div', null, ev.map(e => h('div', { class: 'cp-row' }, [
            h('div', null, [h('div', { class: 'cp-row-t', style: 'text-transform:capitalize' }, e.to_status ? (e.from_status || '?') + ' → ' + e.to_status : (e.kind || 'event')), e.note ? h('div', { class: 'cp-row-s' }, e.note) : null].filter(Boolean)),
            h('span', { class: 'cp-row-s' }, new Date(e.created_at).toLocaleString()),
          ]))) : h('div', { class: 'cp-muted' }, 'No history yet.'));
        } catch (e) { mount(host, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load history.')); }
      } }, '🕑 History');
      const _g = Number(t.rate || 0), _fee = Math.round(_g * 0.05 * 100) / 100, _net = Math.round((_g - _fee) * 100) / 100, _rpm = t.miles ? (_g / Number(t.miles)) : null;
      const settleBtn = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#f97316;color:#0b1b33', onClick: () => {
        openModal('Trip settlement \u2014 ' + (t.origin || '') + ' \u2192 ' + (t.destination || ''), [
          h('div', { class: 'cp-row' }, [h('span', null, 'Gross (linehaul)'), h('b', null, money(_g))]),
          h('div', { class: 'cp-row' }, [h('span', null, 'LoadBoot fee (5%)'), h('span', null, '-' + money(_fee))]),
          h('div', { class: 'cp-row' }, [h('b', null, 'Net to you'), h('b', { style: 'color:#16a34a' }, money(_net))]),
          t.miles ? h('div', { class: 'cp-row' }, [h('span', null, 'Miles / RPM'), h('span', null, t.miles + ' mi \u00b7 $' + _rpm.toFixed(2) + '/mi')]) : null,
          h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px;background:#0883F7', onClick: () => openPrintable('Trip Settlement', 'SETTLEMENT', [{ rows: [['Lane', (t.origin || '') + ' \u2192 ' + (t.destination || '')], ['Status', t.status || ''], ['Gross', money(_g)], ['Dispatch fee (5%)', '-' + money(_fee)], ['Net to carrier', money(_net)], ['Miles', t.miles ? String(t.miles) : '\u2014'], ['RPM', _rpm ? ('$' + _rpm.toFixed(2) + '/mi') : '\u2014']] }, { note: 'Add fuel/tolls/other expenses in Finance for the full trip P&L.' }]) }, '\u2b07 Download PDF'),
          h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:6px', onClick: () => go('finance') }, 'Full P&L in Finance \u2192'),
        ].filter(Boolean));
      } }, '\ud83d\udcb0 Settlement');
      // ---- PREMIUM CARD: hero strip (route, rate, countdown, big map button) + collapsed tools ----
      const abRow = (color, letter, txt) => h('div', { style: 'display:flex;align-items:center;gap:9px;padding:3px 0' }, [
        h('span', { style: 'width:19px;height:19px;border-radius:50%;background:' + color + ';color:#ffffff;font-weight:900;font-size:11px;display:inline-flex;align-items:center;justify-content:center;flex:none' }, letter),
        h('span', { style: 'font-weight:700;font-size:.92rem;color:#eef3fb' }, txt || '—'),
      ]);
      let cdEl = null;
      if (active && t.pickup_mode !== 'fcfs' && (t.scheduled_pickup || t.scheduled_delivery)) {
        const toPickup = t.status === 'planned' || t.status === 'dispatched';
        const tgt = new Date(toPickup ? t.scheduled_pickup : (t.scheduled_delivery || t.scheduled_pickup)).getTime();
        cdEl = h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding:10px 13px;border-radius:12px;background:rgba(252,83,5,.08);border:1px solid rgba(252,83,5,.25)' });
        const lbl = h('span', { style: 'color:#8ea2c3;font-size:.78rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase' }, toPickup ? '\u23f1 Pickup in' : '\u23f1 Delivery in');
        const val = h('b', { style: 'font-size:1.15rem;color:#FC5305;font-variant-numeric:tabular-nums' }, '\u2014');
        cdEl.append(lbl, val);
        let _wasConn = false;
        const tick = () => {
          if (cdEl.isConnected) _wasConn = true;
          else { if (_wasConn) clearInterval(iv); return; }
          let d2 = Math.floor((tgt - Date.now()) / 1000);
          const late = d2 < 0; if (late) d2 = -d2;
          const hh = Math.floor(d2 / 3600), mm = Math.floor((d2 % 3600) / 60), ss = d2 % 60;
          val.textContent = (late ? '-' : '') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
          if (late) { val.style.color = '#f87171'; lbl.textContent = toPickup ? '\u26a0 Pickup overdue by' : '\u26a0 Delivery overdue by'; cdEl.style.background = 'rgba(239,68,68,.10)'; cdEl.style.borderColor = 'rgba(239,68,68,.35)'; }
        };
        const iv = setInterval(tick, 1000); tick();
      }
      const riskEl = h('div');
      if (active && (t.status === 'planned' || t.status === 'dispatched')) {
        (async () => {
          let a; try { a = await tripPickupStatus(t.id); } catch (_) { return; }
          if (!a || (a.risk !== 'at_risk' && a.risk !== 'late')) return;
          const isLate = a.risk === 'late';
          const bd = isLate ? '#ef4444' : '#f59e0b', bg = isLate ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)', col = isLate ? '#fca5a5' : '#fcd34d';
          mount(riskEl, h('div', { style: 'margin-top:10px;padding:11px 13px;border-radius:12px;background:' + bg + ';border:1px solid ' + bd + ';color:' + col }, [
            h('div', { style: 'font-weight:800;font-size:.95rem' }, isLate ? '\ud83d\udd34 You are LATE to pickup' : '\u23f1 Roll now \u2014 pickup at risk'),
            h('div', { style: 'font-size:.82rem;margin-top:3px;line-height:1.5' }, (a.distance_mi ? '~' + a.distance_mi + ' mi to pickup \u00b7 ~' + a.eta_h + 'h drive. ' : '') + (isLate ? 'You have not moved toward pickup in time \u2014 move now, or tap \u201c\u26a0 Report issue \u2192 Emergency\u201d if you broke down. The broker may cancel (no TONU if you never moved).' : 'Depart now to make the pickup window.')),
          ]));
        })();
      }
      if (liveMap) {
        liveMap.className = '';
        liveMap.style.cssText = 'width:100%;border:0;border-radius:14px;padding:14px;margin-top:10px;font-size:1rem;font-weight:900;cursor:pointer;background:#FC5305;color:#ffffff;box-shadow:0 0 18px rgba(252,83,5,.3);font-family:Manrope,sans-serif';
        liveMap.textContent = t.status === 'planned' ? '\u25b6  Start your trip' : '\ud83d\uddfa  Continue live trip';
      }
      const hero = h('div', { style: 'background:linear-gradient(135deg,#0b1220,#13253f);border-radius:16px;padding:15px 16px 14px' }, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px' }, [
          h('div', { style: 'min-width:0' }, [abRow('#0883F7', 'A', t.origin), abRow('#FC5305', 'B', t.destination)]),
          h('div', { style: 'text-align:right;flex:none' }, [
            h('div', { style: 'font-size:1.35rem;font-weight:900;color:#fff' }, money(t.rate || 0)),
            pill(t.status),
          ]),
        ]),
        t.pickup_mode === 'fcfs' && active ? h('div', { style: 'margin-top:10px;padding:9px 13px;border-radius:12px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.3);color:#fbbf24;font-size:.82rem;font-weight:800' }, '\u26a1 FCFS \u2014 first come, first served \u00b7 no appointment clock, arrive within the window') : null,
        riskEl, cdEl, liveMap,
      ].filter(Boolean));
      const loadDetBtn = t.load_id ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => showLoadDetail(t.load_id) }, '\ud83d\udd0d Load details') : null;
      const dpackBtn = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a', onClick: async () => {
        const host9 = h('div', null, h('div', { class: 'cp-muted' }, 'Opening your dispatch pack\u2026'));
        openModal('\ud83d\udd13 Dispatch pack \u2014 unlocked for this booking', [host9]);
        let pk9; try { pk9 = await pocketTripDocs(t.id); } catch (e9) { mount(host9, h('div', { class: 'cp-muted' }, (e9 && e9.message) || 'Could not load.')); return; }
        const r9 = (k9, v9, miss9) => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(148,163,184,.25);font-size:.86rem;flex-wrap:wrap' }, [
          h('span', { style: 'opacity:.75' }, k9), v9 ? h('b', { style: 'text-align:right' }, v9) : h('span', { style: 'color:#fbbf24;font-weight:700' }, miss9 || 'pending from broker')]);
        mount(host9, h('div', null, [
          r9('\ud83d\udccd Pickup address', pk9.origin_full), r9('\ud83d\udccd Delivery address', pk9.destination_full),
          r9('\ud83d\udce6 Pickup / PU number', pk9.pickup_number), r9('\ud83c\udfc1 Delivery number', pk9.delivery_number),
          r9('\ud83d\udcc5 Appointment', pk9.appointment),
          r9('\ud83e\uddfe Rate confirmation', pk9.rate_con_executed ? 'Executed \u2713 (open Rate con in Documents & tools to view/acknowledge)' : null, 'being executed'),
          pk9.reference ? r9('Reference', pk9.reference) : null,
          (pk9.broker_name && pk9.broker_packet && pk9.broker_packet.length) ? h('div', { style: 'margin-top:12px;padding-top:10px;border-top:1px solid rgba(148,163,184,.3)' }, [
            h('div', { style: 'font-weight:800;margin-bottom:6px' }, '\ud83c\udfe2 Broker packet \u2014 ' + pk9.broker_name + ' (LoadBoot-verified)'),
            ...pk9.broker_packet.map(bp9 => h('div', { style: 'display:flex;justify-content:space-between;font-size:.82rem;padding:3px 0' }, [
              h('span', { style: 'opacity:.75' }, bp9.label),
              h('b', { style: 'color:' + (bp9.status === 'verified' ? '#4ade80' : '#fbbf24') }, bp9.status === 'verified' ? '\u2713 verified' : bp9.status),
            ])),
            h('div', { class: 'cp-muted', style: 'font-size:.74rem;margin-top:6px' }, (pk9.payments_note || '') + ' Original broker files are held & verified by LoadBoot.'),
            h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px;width:100%', onClick: async (ev9) => {
              const b9 = ev9.currentTarget; b9.disabled = true; b9.textContent = 'Requesting\u2026';
              try { const r9 = await requestPacketCopies(t.id); lbToast(r9.note || 'We will send a copy of the broker packet to your email shortly.', 'success', '\ud83d\udcec Request received'); b9.textContent = '\u2713 Requested \u2014 check your email'; }
              catch (e9) { b9.disabled = false; b9.textContent = '\ud83d\udcec Request copies by email'; lbToast((e9 && e9.message) || 'Could not request.', 'urgent', 'Failed'); }
            } }, '\ud83d\udcec Request copies by email'),
          ]) : null,
        ].filter(Boolean)));
      } }, '\ud83d\udce6 Dispatch pack');
      const chips = h('div', { class: 'cp-trip-actions', style: 'margin-top:10px' }, [confirm, start, deliver, loadDetBtn, dpackBtn, dwell, accBtn, pod, issue, emergency, cancelBtn].filter(Boolean));
      const moreW = h('div', { style: 'display:none' }, [h('div', { class: 'cp-trip-actions' }, [settleBtn, sheetBtn, rcBtn, packBtn, history, nav, share, live, assign, reloadBtn, rateBtn].filter(Boolean))]);
      const moreT = h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'width:100%;margin-top:8px', onClick: (ev) => {
        const open = moreW.style.display !== 'none';
        moreW.style.display = open ? 'none' : 'block';
        ev.currentTarget.textContent = open ? '\ud83d\udcc1 Documents & tools \u25be' : '\ud83d\udcc1 Documents & tools \u25b4';
      } }, '\ud83d\udcc1 Documents & tools \u25be');
      const _fmtT = (x) => x ? new Date(x).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
      const _late = (act, sch) => {
        if (!act || !sch || t.pickup_mode === 'fcfs') return '';
        const m2 = Math.round((new Date(act) - new Date(sch)) / 60000);
        return m2 > 5 ? ' \u00b7 ' + (m2 >= 60 ? Math.floor(m2 / 60) + 'h ' + (m2 % 60) + 'm' : m2 + 'm') + ' late' : ' \u00b7 on time';
      };
      const _tRow = (label2, sch, act) => (sch || act) ? h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:2px 0' }, [
        h('span', { class: 'cp-row-s', style: 'font-weight:800' }, label2),
        h('span', { class: 'cp-row-s', style: 'text-align:right' }, [act ? '\u2713 ' + _fmtT(act) : (sch ? 'due ' + _fmtT(sch) : '\u2014'),
          h('span', { style: (_late(act, sch).includes('late') ? 'color:#f87171' : 'color:#4ade80') + ';font-weight:800' }, _late(act, sch))]),
      ]) : null;
      const timesEl = (t.started_at || t.delivered_at || t.scheduled_pickup) ? h('div', { style: 'margin:6px 0 2px;padding:8px 12px;border:1px solid var(--lb-line,#22314e);border-radius:12px' }, [
        _tRow('Pickup' + (t.pickup_mode === 'fcfs' ? ' (FCFS)' : ''), t.scheduled_pickup, t.started_at),
        _tRow('Delivery', t.scheduled_delivery, t.delivered_at),
      ].filter(Boolean)) : null;
      const _cancelled = /cancel/.test(String(t.status || '').toLowerCase());
      const _ev = t.cancel_evidence || {};
      const _faultCarrier = t.cancel_fault === 'carrier';
      const _stale = t.cancel_fault === 'stale_load' || (t.cancel_evidence && t.cancel_evidence.stale);
      const _fmtEv = (v) => { try { return new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return v; } };
      const tonuEvidence = (_cancelled && t.cancel_fault && t.cancelled_by === 'broker') ? (_faultCarrier
        ? h('div', { style: 'margin-top:9px;padding:11px 13px;border-radius:11px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4)' }, [
            h('div', { style: 'font-weight:800;color:#fca5a5;font-size:.9rem' }, '⛔ No TONU — you cannot claim this load'),
            h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'It was cancelled because your truck did not move toward pickup in time. Under the signed rate confirmation, a late / no-show carrier does NOT qualify for TONU — this is decided from your GPS, not opinion.'),
            h('div', { style: 'margin-top:8px;padding:9px 11px;border-radius:9px;background:rgba(0,0,0,.25)' }, [
              h('div', { style: 'font-weight:700;font-size:.78rem;color:#e5edf8;margin-bottom:3px' }, '📍 GPS evidence recorded at cancellation'),
              _ev.distance_mi != null ? h('div', { class: 'cp-row-s' }, '• Truck was ~' + _ev.distance_mi + ' mi from pickup and ' + (_ev.moving ? 'moving' : 'NOT moving toward it')) : null,
              _ev.must_depart_by ? h('div', { class: 'cp-row-s' }, '• You had to depart by ' + _fmtEv(_ev.must_depart_by) + ' to make the appointment') : null,
              (_ev.hours_to_pickup != null) ? h('div', { class: 'cp-row-s' }, '• Pickup was ' + (Number(_ev.hours_to_pickup) < 0 ? Math.abs(Math.round(_ev.hours_to_pickup)) + 'h overdue' : 'in ' + Math.round(_ev.hours_to_pickup) + 'h') + ' when the load was cancelled') : null,
              (_ev.eta_h != null) ? h('div', { class: 'cp-row-s' }, '• Your ETA to pickup was ~' + _ev.eta_h + 'h — too late for the window') : null,
            ].filter(Boolean)),
            h('div', { class: 'cp-row-s', style: 'margin-top:7px' }, 'Was this a verified breakdown or emergency? Use “⚠ Report issue → Emergency” to appeal — a proven emergency is never penalised.'),
          ].filter(Boolean))
        : h('div', { style: 'margin-top:9px;padding:11px 13px;border-radius:11px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.4)' }, [
            h('div', { style: 'font-weight:800;color:#4ade80;font-size:.9rem' }, _stale ? '✓ TONU owed — this load was already stale' : '✓ TONU filed for you — you were on track'),
            h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, _stale ? 'This load’s pickup time had ALREADY passed when you booked it — the lateness isn’t yours, it was a stale listing. So a TONU is owed and it does NOT count against your reliability. A claim was auto-filed; dispatch reviews it.' : 'Your GPS showed you were moving toward pickup and on time, so the broker cancelling means a TONU is owed. A claim was auto-filed with your evidence — dispatch will review it. This does NOT count against your health. Open “💰 Pay claims” below to track it.'),
          ].filter(Boolean))
      ) : null;
      const cancelInfo = _cancelled ? h('div', { style: 'margin:8px 2px 2px;padding:11px 13px;border-radius:12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.28)' }, [
        h('div', { style: 'font-weight:800;color:#f87171;font-size:.92rem' }, t.cancelled_by === 'broker' ? '✕ Cancelled by the broker' : '✕ Trip cancelled'),
        t.cancel_reason ? h('div', { class: 'cp-row-s', style: 'margin-top:3px' }, 'Reason: ' + t.cancel_reason) : null,
        tonuEvidence,
        h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'This load is no longer assigned to you. Pick up a replacement on the Load Board.'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7;color:#fff;margin-top:9px', onClick: () => { location.hash = '#loads'; } }, '🔎 Browse Load Board'),
      ].filter(Boolean)) : null;
      return h('div', { class: 'cp-trip' }, [
        hero,
        tripStepper(t.status),
        cancelInfo,
        timesEl,
        chips, moreT, moreW, fw, podW, dwellW, accW, reloadW, rateW,
      ].filter(Boolean));
    })]));

    // Emergency / delivery-reschedule request — REQUIRES a defined category, a detailed reason and proof.
    // Goes to Command Center for review (urgent, red). Emergencies are for genuine, evidenced situations only.
    function openEmergency(t) {
      const CATS = [['breakdown', 'Truck breakdown'], ['accident', 'Accident'], ['weather', 'Severe weather'], ['medical', 'Medical emergency'], ['road_closure', 'Road closure'], ['hours_of_service', 'Out of hours (HOS)'], ['mechanical', 'Mechanical failure'], ['theft', 'Theft'], ['other', 'Other (explain)']];
      const cat = h('select', { class: 'cp-in' }, CATS.map(([v, l]) => h('option', { value: v }, l)));
      const reason = h('textarea', { class: 'cp-in', rows: '3', placeholder: 'Exactly what happened, where, and what you need (min 10 characters).' });
      const proof = h('input', { class: 'cp-in', placeholder: 'Or paste a proof link — tow receipt or police report, if no photo' });
      const photo = h('input', { class: 'cp-in', type: 'file', accept: 'image/*', capture: 'environment' });
      const resched = h('input', { class: 'cp-in', type: 'datetime-local' });
      const msg = h('div', { class: 'cp-err' });
      let closeModal;
      const send = h('button', { class: 'cp-btn', onClick: async () => {
        msg.textContent = ''; msg.className = 'cp-err';
        if (reason.value.trim().length < 10) { msg.textContent = 'Please give a detailed reason (min 10 characters).'; return; }
        const pf = photo.files && photo.files[0];
        if (!pf && !proof.value.trim()) { msg.textContent = 'Attach a photo of the situation, or paste a proof link.'; return; }
        send.disabled = true; send.textContent = 'Submitting…';
        try {
          let ref = proof.value.trim();
          if (pf) { const m = await uploadPodDocument(pf, t.id); ref = m.path; }
          await tripEmergencyRequest({ trip: t.id, category: cat.value, reason: reason.value.trim(), proof_ref: ref, reschedule_to: resched.value || null });
          if (closeModal) closeModal();
          alert('Emergency submitted to dispatch. You will be notified once it is reviewed.');
        } catch (e) { send.disabled = false; send.textContent = 'Submit emergency'; msg.textContent = (e && e.message) || 'Could not submit.'; }
      } }, 'Submit emergency');
      closeModal = openModal('🚨 Report an emergency', [
        h('p', { class: 'cp-row-s' }, 'Only for genuine, evidenced emergencies. Every request needs a category, a detailed reason and proof, and is reviewed by dispatch.'),
        h('label', { class: 'cp-row-t' }, 'Category'), cat,
        h('label', { class: 'cp-row-t', style: 'margin-top:8px;display:block' }, 'What happened'), reason,
        h('label', { class: 'cp-row-t', style: 'margin-top:8px;display:block' }, '📷 Photo proof (opens camera on phone)'), photo,
        h('label', { class: 'cp-row-t', style: 'margin-top:8px;display:block' }, 'Proof link (if no photo)'), proof,
        h('label', { class: 'cp-row-t', style: 'margin-top:8px;display:block' }, 'Requested new delivery time (optional)'), resched,
        msg, h('div', { style: 'margin-top:10px' }, send),
      ]);
    }

    async function assignTrip(t) {
      let drivers = [], trucks = [];
      try { [drivers, trucks] = await Promise.all([pocketDrivers(), pocketTrucks()]); } catch (_) {}
      if (!drivers.length && !trucks.length) {
        openModal('Assign driver / truck', [h('p', { class: 'cp-row-s' }, 'Add a driver or truck in the Fleet tab first, then come back to assign one to this trip.'), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('fleet') }, 'Go to Fleet')]);
        return;
      }
      const dSel = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'No change / unassigned')].concat(drivers.map(d => h('option', { value: d.id }, d.name))));
      const tSel = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'No change / unassigned')].concat(trucks.map(tr => h('option', { value: tr.id }, 'Unit ' + tr.unit_no + (tr.equipment ? ' · ' + tr.equipment : '')))));
      const save = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try { await pocketAssignTrip({ trip: t.id, driver: dSel.value || null, truck: tSel.value || null }); loadTrips(); }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not assign.'); }
      } }, 'Save');
      openModal('Assign driver / truck', [h('label', { class: 'cp-row-s' }, 'Driver'), dSel, h('label', { class: 'cp-row-s' }, 'Truck'), tSel, save]);
    }
  }
  let _liveWatch = null, _liveTrip = null;
  function ensureLiveLoc(tripId) {
    // MANDATORY tracking: auto-starts with the trip, survives reloads, stops only at delivery.
    if (!navigator.geolocation) return;
    if (_liveWatch != null && _liveTrip === tripId) return;
    if (_liveWatch != null) { try { navigator.geolocation.clearWatch(_liveWatch); } catch (_) {} _liveWatch = null; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try { await pocketSetConsent(tripId, true); } catch (_) {}
      if (!window.__lbSimOn) { try { await pocketPostLocation(tripId, pos.coords.latitude, pos.coords.longitude, 'portal'); } catch (_) {} }
      _liveTrip = tripId;
      _liveWatch = navigator.geolocation.watchPosition(async (p9) => {
        if (window.__lbSimOn) return; // simulator owns the trip position while running
        try { await pocketPostLocation(tripId, p9.coords.latitude, p9.coords.longitude, 'portal'); } catch (_) {}
      }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
      try { lbToast('Live tracking started automatically \u2014 it stays on until delivery (required by the rate confirmation).', 'success', '\ud83d\udef0 Tracking ON'); } catch (_) {}
    }, () => {}, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  function stopLiveLoc() {
    if (_liveWatch != null) { try { navigator.geolocation.clearWatch(_liveWatch); } catch (_) {} }
    _liveWatch = null; _liveTrip = null;
  }
  // BACKGROUND-PROOF tracking: start on ANY portal entry (not just dashboard/trips render),
  // and the moment the driver returns from Google Maps / another app, push a fresh fix instantly.
  (async () => {
    try {
      const tr9 = await pocketTrips(10);
      const a9 = (tr9 || []).find((r9) => /planned|dispatched|in_transit/.test(String(r9.status || '')));
      if (a9) ensureLiveLoc(a9.id);
    } catch (_) {}
  })();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !_liveTrip || window.__lbSimOn) return;
    try {
      navigator.geolocation.getCurrentPosition((p9) => {
        try { pocketPostLocation(_liveTrip, p9.coords.latitude, p9.coords.longitude, 'portal-resume').catch(() => {}); } catch (_) {}
      }, () => {}, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    } catch (_) {}
  });
  function toggleLiveLoc(ev, tripId) {
    // Continuous GPS trail while driving (ported from Carrier Pocket). One trip at a time;
    // consent is recorded server-side before the first ping; tap again to stop.
    const btn = ev.currentTarget;
    if (_liveWatch != null && _liveTrip === tripId) {
      try { navigator.geolocation.clearWatch(_liveWatch); } catch (_) {}
      _liveWatch = null; _liveTrip = null;
      btn.textContent = '🛰 Live tracking'; btn.classList.remove('on'); return;
    }
    if (!navigator.geolocation) { btn.textContent = 'GPS not available'; return; }
    if (_liveWatch != null) { try { navigator.geolocation.clearWatch(_liveWatch); } catch (_) {} _liveWatch = null; }
    btn.disabled = true; btn.textContent = 'Starting…';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try { await pocketSetConsent(tripId, true); } catch (_) {}
      try { await pocketPostLocation(tripId, pos.coords.latitude, pos.coords.longitude, 'portal'); } catch (_) {}
      _liveTrip = tripId;
      _liveWatch = navigator.geolocation.watchPosition(async (p) => {
        try { await pocketPostLocation(tripId, p.coords.latitude, p.coords.longitude, 'portal'); } catch (_) {}
      }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
      btn.disabled = false; btn.textContent = '🛰 Tracking ON — tap to stop'; btn.classList.add('on');
    }, () => { btn.disabled = false; btn.textContent = 'Permission denied'; }, { enableHighAccuracy: true, timeout: 10000 });
  }
  function shareLoc(ev, tripId) {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Locating…';
    if (!navigator.geolocation) { btn.textContent = 'GPS not available'; return; }
    navigator.geolocation.getCurrentPosition(async (pos) => { try { await pocketSetConsent(tripId, true); await pocketPostLocation(tripId, pos.coords.latitude, pos.coords.longitude, 'portal'); btn.textContent = '📍 Shared ✓'; } catch (x) { btn.textContent = 'Could not share'; btn.disabled = false; } }, () => { btn.textContent = 'Permission denied'; btn.disabled = false; }, { enableHighAccuracy: true, timeout: 10000 });
  }

  /* ----- Proof of delivery (desktop: drag-and-drop; mobile: file/camera picker) ----- */
  const POD_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const podBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  async function showCarrierPod(t, host) {
    const box = h('div', { class: 'cp-pod' });
    mount(host, box);
    await renderPod();

    async function renderPod() {
      mount(box, h('div', { class: 'cp-muted' }, 'Loading proof of delivery…'));
      let pods; try { pods = await pocketTripPods(t.id); }
      catch (e) { mount(box, h('div', { class: 'cp-row-s', style: 'color:var(--lb-red)' }, (e && e.message) || 'Could not load proof of delivery.')); return; }
      pods = pods || [];
      const rows = pods.map((p, i) => h('div', { class: 'cp-row' }, [
        h('div', null, [
          h('div', { class: 'cp-row-t' }, (p.file_name || 'POD') + (i === 0 && pods.length > 1 ? ' · latest' : '')),
          h('div', { class: 'cp-row-s' }, 'Uploaded ' + new Date(p.created_at).toLocaleDateString()),
          (p.status === 'rejected' && p.review_note) ? h('div', { class: 'cp-row-s', style: 'color:var(--lb-red)' }, '✕ Rejected: ' + p.review_note) : null,
          (p.status === 'approved') ? h('div', { class: 'cp-row-s', style: 'color:var(--lb-green)' }, '✓ Approved by dispatch') : null,
        ].filter(Boolean)),
        pill(p.status || 'pending'),
      ]));
      const hasPending = pods.some(p => (p.status || 'pending') === 'pending');
      const hasApproved = pods.some(p => p.status === 'approved');
      const resubmit = pods[0] && pods[0].status === 'rejected';
      mount(box, h('div', null, [
        h('div', { class: 'cp-row-t', style: 'margin-bottom:6px' }, 'Proof of delivery'),
        rows.length ? h('div', null, rows) : h('div', { class: 'cp-muted' }, 'No POD uploaded yet for this trip.'),
        hasApproved
          ? h('div', { class: 'cp-row-s', style: 'color:var(--lb-green);padding-top:6px' }, 'An approved POD is on file — nothing more to do.')
          : podUploader({ hasPending, resubmit }),
      ].filter(Boolean)));
    }

    function podUploader(state) {
      let file = null, url = null;
      const wrap = h('div', { class: 'cp-podup' });
      const err = h('div', { class: 'cp-row-s', style: 'color:var(--lb-red)' });
      const prog = h('div', { class: 'cp-row-s' });
      const prev = h('div', { class: 'cp-podprev' });
      const input = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp', style: 'display:none' });
      input.onchange = () => pick(input.files && input.files[0]);
      const up = h('button', { class: 'cp-btn cp-btn-sm', onClick: doUpload }, state.resubmit ? 'Re-upload POD' : 'Upload POD'); up.disabled = true;

      function clearPrev() { if (url) { URL.revokeObjectURL(url); url = null; } prev.innerHTML = ''; }
      function pick(f) {
        err.textContent = ''; prog.textContent = ''; clearPrev(); file = null; up.disabled = true;
        if (!f) return;
        if (!POD_OK.includes(f.type)) { err.textContent = 'Unsupported file type. Allowed: PDF, JPG, PNG, WEBP.'; return; }
        if (f.size <= 0) { err.textContent = 'That file is empty.'; return; }
        if (f.size > 10 * 1024 * 1024) { err.textContent = 'File is too large (' + podBytes(f.size) + '). Maximum is 10 MB.'; return; }
        file = f;
        const meta = h('div', { class: 'cp-row-s' }, f.name + ' · ' + podBytes(f.size));
        const rm = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { file = null; up.disabled = true; clearPrev(); } }, 'Remove');
        if (f.type.startsWith('image/')) { url = URL.createObjectURL(f); mount(prev, h('div', null, [h('img', { src: url, alt: 'POD preview', style: 'max-width:100%;max-height:240px;border-radius:8px;display:block' }), meta, rm])); }
        else mount(prev, h('div', null, [h('div', { class: 'cp-podpdf' }, '📄 PDF ready to upload'), meta, rm]));
        up.disabled = false;
      }
      const zone = h('div', { class: 'cp-podzone', onClick: () => input.click() }, [
        h('div', { class: 'cp-podzone-t' }, '⬆ Drag & drop, or click to choose'),
        h('div', { class: 'cp-row-s' }, 'Accepted: PDF, JPG, PNG, WEBP · Max 10 MB'),
      ]);
      zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag'); };
      zone.ondragleave = () => zone.classList.remove('drag');
      zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('drag'); pick(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); };

      async function doUpload() {
        if (!file) return;
        err.textContent = ''; up.disabled = true; prog.textContent = 'Uploading…';
        try {
          const m = await uploadPodDocument(file, t.id);
          await pocketUploadPod({ trip: t.id, path: m.path, fileName: m.fileName, contentType: m.contentType, size: m.size });
          clearPrev();
          mount(box, h('div', null, [
            h('div', { class: 'cp-row-t', style: 'color:var(--lb-green)' }, '✓ POD uploaded'),
            h('div', { class: 'cp-row-s' }, 'Dispatch will review it. The status will appear here.'),
            h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:8px', onClick: renderPod }, 'Done'),
          ]));
        } catch (e) {
          const msg = (e && (e.message || e.error)) || 'Upload failed.';
          err.textContent = /fetch|network|timeout/i.test(String(msg)) ? 'Network problem — check your connection and retry.' : String(msg);
          prog.textContent = ''; up.disabled = false; up.textContent = 'Retry upload';
        }
      }

      mount(wrap, [
        state.hasPending ? h('div', { class: 'cp-row-s', style: 'color:#b45309' }, 'A POD is already awaiting review — uploading again adds a new version.') : null,
        zone, input, prev, err, prog,
        h('div', { class: 'cp-trip-actions' }, [up]),
      ].filter(Boolean));
      return wrap;
    }
  }

  /* ----- Fleet: carrier self-service drivers & trucks (own org only, server-scoped) ----- */
  async function loadFleet() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let drivers, trucks;
    try { [drivers, trucks] = await Promise.all([pocketDrivers(), pocketTrucks()]); }
    catch (e) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, (e && e.message) || 'Failed to load.'))); return; }
    drivers = drivers || []; trucks = trucks || [];

    const driverList = h('div');
    const truckList = h('div');
    const renderDrivers = () => mount(driverList, drivers.length ? h('div', null, drivers.map(d => h('div', { class: 'cp-trip' }, [
      h('div', { class: 'cp-trip-head' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, d.name), h('div', { class: 'cp-row-s' }, [d.phone, d.license_no ? 'Lic ' + d.license_no + (d.license_state ? ' (' + d.license_state + ')' : '') : null].filter(Boolean).join(' · ') || '—')]),
        h('div', { style: 'display:flex;gap:6px' }, [
          d.id ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => inviteDriverToApp(d) }, d.user_id ? '\u2713 In app' : '\ud83d\udcf2 Invite to app') : null,
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => driverForm(d) }, 'Edit'),
        ].filter(Boolean)),
      ]),
      d.license_exp ? h('div', { class: 'cp-row-s' }, 'License expires ' + d.license_exp + (d.medical_exp ? ' · Medical ' + d.medical_exp : '')) : null,
    ].filter(Boolean)))) : h('div', { class: 'cp-muted' }, 'No drivers yet. Add your first driver.'));
    const renderTrucks = () => mount(truckList, trucks.length ? h('div', null, trucks.map(t => h('div', { class: 'cp-trip' }, [
      h('div', { class: 'cp-trip-head' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, 'Unit ' + t.unit_no), h('div', { class: 'cp-row-s' }, [t.equipment, t.plate ? 'Plate ' + t.plate : null].filter(Boolean).join(' · ') || '—')]),
        h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => truckForm(t) }, 'Edit'),
      ]),
    ]))) : h('div', { class: 'cp-muted' }, 'No trucks yet. Add your first truck.'));

    async function inviteDriverToApp(d) {
      try {
        const r = await carrierInviteDriver(d.id, d.email || null, d.phone || null);
        const link = r && r.link ? r.link : '';
        const inp = h('input', { class: 'cp-in', value: link, readonly: 'readonly', onClick: (e) => e.currentTarget.select() });
        openModal('Invite ' + (d.name || 'driver') + ' to the app', [
          (r && r.emailed) ? h('div', { class: 'cp-row-s', style: 'color:#16a34a;font-weight:700' }, '\u2713 Invite emailed to ' + (r.email || d.email)) : (d.email ? null : h('div', { class: 'cp-row-s', style: 'color:#d97706' }, 'No email on file \u2014 add the driver\u2019s email (Edit) to email invites automatically. For now, share the link:')),
          h('p', { class: 'cp-row-s' }, 'Send this link to the driver. They sign up, and their phone becomes the truck\u2019s tracker \u2014 only their assigned loads, with GPS arrive/depart, POD and issue reporting.'),
          inp,
          h('button', { class: 'cp-btn cp-btn-sm', onClick: () => { try { navigator.clipboard.writeText(link); lbToast('Invite link copied.', 'success', 'Copied'); } catch (_) {} } }, 'Copy link'),
          h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'Link expires in 14 days. One login per driver record.'),
        ]);
      } catch (e) { alert((e && e.message) || 'Could not create invite.'); }
    }
    function driverForm(d) {
      const name = h('input', { class: 'cp-in', placeholder: 'Driver name', value: (d && d.name) || '' });
      const phone = h('input', { class: 'cp-in', placeholder: 'Phone', value: (d && d.phone) || '' });
      const email = h('input', { class: 'cp-in', placeholder: 'Email', value: (d && d.email) || '' });
      const lic = h('input', { class: 'cp-in', placeholder: 'License #', value: (d && d.license_no) || '' });
      const st = h('input', { class: 'cp-in', placeholder: 'State', maxlength: '2', value: (d && d.license_state) || '' });
      const lexp = h('input', { class: 'cp-in', type: 'date', value: (d && d.license_exp) || '' });
      const mexp = h('input', { class: 'cp-in', type: 'date', value: (d && d.medical_exp) || '' });
      const save = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!name.value.trim()) { alert('Driver name is required.'); return; }
        if (!lbFutureDate(lexp, 'License expiry') || !lbFutureDate(mexp, 'Medical expiry')) return;
        // FMCSA sanity — catches typos and fake entries at the door:
        const licV9 = lic.value.trim();
        if (licV9 && !/^[A-Za-z0-9-]{4,20}$/.test(licV9)) { alert('License # looks wrong \u2014 CDL numbers are 4\u201320 letters/digits. Copy it exactly from the card.'); return; }
        if (licV9 && !/^[A-Za-z]{2}$/.test(st.value.trim())) { alert('License STATE is required with the license # (2 letters, e.g. TX) \u2014 CDLs are state-issued and verified against the issuing state.'); return; }
        if (mexp.value) { const mx9 = new Date(mexp.value); const max9 = new Date(); max9.setMonth(max9.getMonth() + 24);
          if (mx9 > max9) { alert('DOT medical certificates are valid for a MAXIMUM of 24 months (FMCSA rule) \u2014 an expiry more than 2 years out cannot be real. Check the med card date.'); return; } }
        if (lexp.value) { const lx9 = new Date(lexp.value); const lmax9 = new Date(); lmax9.setFullYear(lmax9.getFullYear() + 10);
          if (lx9 > lmax9) { alert('License expiry more than 10 years out looks like a typo \u2014 check the card.'); return; } }
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try {
          await pocketUpsertDriver({ id: d && d.id, name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim(), licenseNo: lic.value.trim(), licenseState: st.value.trim().toUpperCase(), licenseExp: lexp.value || null, medicalExp: mexp.value || null });
          drivers = await pocketDrivers(); renderDrivers();
          try { closeD9(); } catch (_) {}
          lbToast('\ud83d\udc64 Driver saved \u2014 valid license & medical unlock booking.', 'ok', 'Fleet updated');
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save');
      const closeD9 = openModal((d ? 'Edit driver' : 'Add driver'), [name, phone, email, h('div', { class: 'cp-formrow2' }, [lic, st]), h('label', { class: 'cp-row-s' }, 'License expiry'), lexp, h('label', { class: 'cp-row-s' }, 'Medical expiry'), mexp, save]);
    }
    function truckForm(t) {
      const unit = h('input', { class: 'cp-in', placeholder: 'Unit number', value: (t && t.unit_no) || '' });
      const plate = h('input', { class: 'cp-in', placeholder: 'Plate', value: (t && t.plate) || '' });
      const vin = h('input', { class: 'cp-in', placeholder: 'VIN', value: (t && t.vin) || '' });
      const eq = h('select', { class: 'cp-in' }, ['', 'Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Hotshot', 'Power Only', 'Box Truck'].map(o => h('option', { value: o, selected: t && t.equipment === o ? 'selected' : null }, o || 'Equipment…')));
      const svc = h('input', { class: 'cp-in', type: 'date', value: (t && t.next_service_date) || '' });
      const insp = h('input', { class: 'cp-in', type: 'date', value: (t && t.inspection_exp) || '' });
      const vinInfo = h('div', { class: 'cp-row-s', style: 'min-height:1.1em;margin:-4px 0 4px' });
      const save = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        const btn9 = ev.currentTarget;
        if (!unit.value.trim()) { alert('Unit number is required.'); return; }
        if (!lbFutureDate(insp, 'Inspection expiry')) return;
        // REAL-truck check: valid 17-char VIN, decoded LIVE against U.S. DOT (NHTSA).
        const vin9 = vin.value.trim().toUpperCase();
        if (vin9) {
          if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin9) || /^\d{17}$/.test(vin9)) {
            vinInfo.textContent = '\u2715 Not a real VIN \u2014 17 characters, letters AND digits (no I, O, Q). Copy it from the door-jamb sticker or registration.';
            vinInfo.style.color = '#f87171';
            alert('\u26a0 \u201c' + vin9 + '\u201d is not a valid VIN.\n\nA real VIN is exactly 17 characters and mixes letters and digits (never I, O or Q). It\u2019s on the door-jamb sticker, dash plate, title and registration. Fake VINs fail verification and can pause your account.');
            return;
          }
          btn9.disabled = true; btn9.textContent = 'Verifying VIN\u2026';
          try {
            const ctl9 = new AbortController(); const tm9 = setTimeout(() => ctl9.abort(), 7000);
            const rV = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin9) + '?format=json', { signal: ctl9.signal });
            clearTimeout(tm9);
            const jV = await rV.json(); const dV = jV && jV.Results && jV.Results[0];
            if (dV && dV.Make) {
              vinInfo.textContent = '\u2713 VIN verified with U.S. DOT: ' + [dV.ModelYear, dV.Make, dV.Model].filter(Boolean).join(' ') + (dV.VehicleType ? ' \u00b7 ' + dV.VehicleType : '');
              vinInfo.style.color = '#4ade80';
            } else {
              vinInfo.textContent = '\u26a0 U.S. DOT registry could not identify this VIN \u2014 double-check it against the truck. Saving anyway; verification may flag it.';
              vinInfo.style.color = '#fbbf24';
            }
          } catch (_) { vinInfo.textContent = '\u26a0 VIN registry unreachable \u2014 format OK, saving. It will be verified later.'; vinInfo.style.color = '#fbbf24'; }
        }
        btn9.disabled = true; btn9.textContent = 'Saving\u2026';
        try {
          await pocketUpsertTruck({ id: t && t.id, unitNo: unit.value.trim(), plate: plate.value.trim(), vin: vin9 || vin.value.trim(), equipment: eq.value || null });
          trucks = await pocketTrucks();
          const saved = t && t.id ? t : trucks.find(x => x.unit_no === unit.value.trim());
          if (saved && saved.id && (svc.value || insp.value)) { try { await truckSetMaintenance(saved.id, svc.value || null, insp.value || null); } catch (_) {} }
          renderTrucks();
          try { closeT9(); } catch (_) {}
          lbToast('\ud83d\ude9b Truck saved' + (vinInfo.textContent.indexOf('\u2713') === 0 ? ' \u2014 VIN verified with U.S. DOT' : '') + '. Matching loads unlock on the board.', 'ok', 'Fleet updated');
        }
        catch (e) { btn9.disabled = false; btn9.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save');
      const closeT9 = openModal((t ? 'Edit truck' : 'Add truck'), [unit, plate, vin, vinInfo, eq,
        h('label', { class: 'cp-row-s' }, 'Next service due'), svc,
        h('label', { class: 'cp-row-s' }, 'Annual inspection expires'), insp, save]);
    }

    const alertHost = h('div');
    // Maintenance reminders: service due (14d) / inspection due (30d) banners
    (async () => {
      let mt; try { mt = await fleetMaintenance(); } catch (_) { return; }
      (mt || []).forEach(x => {
        if (x.service_due) alertHost.appendChild(h('button', { class: 'cpx-banner amber', onClick: () => truckForm(trucks.find(tt => tt.id === x.id) || null) },
          [h('span', null, '🔧'), h('span', null, 'Unit ' + (x.unit_no || '?') + ' — service due ' + String(x.next_service_date)), h('span', { class: 'cpx-b-go' }, '›')]));
        if (x.inspection_due) alertHost.appendChild(h('button', { class: 'cpx-banner red', onClick: () => truckForm(trucks.find(tt => tt.id === x.id) || null) },
          [h('span', null, '⚠'), h('span', null, 'Unit ' + (x.unit_no || '?') + ' — annual inspection expires ' + String(x.inspection_exp)), h('span', { class: 'cpx-b-go' }, '›')]));
      });
    })();
    (async () => {
      let alerts = []; try { alerts = await pocketFleetAlerts(); } catch (_) { alerts = []; }
      if (!alerts || !alerts.length) return;
      mount(alertHost, h('div', { class: 'cp-card', style: 'border-left:4px solid #f59e0b' }, [
        cardHead('Compliance alerts', alerts.length + ' item' + (alerts.length === 1 ? '' : 's')),
        ...alerts.map(a => h('div', { class: 'cp-row' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, a.name + ' · ' + a.kind), h('div', { class: 'cp-row-s' }, (a.days_left < 0 ? 'Expired ' + Math.abs(a.days_left) + ' days ago' : 'Expires in ' + a.days_left + ' days') + ' (' + a.expires_on + ')')]),
          h('span', { class: 'cp-pill ' + (a.days_left < 0 ? 'red' : 'amber') }, a.days_left < 0 ? 'expired' : 'soon'),
        ])),
      ]));
    })();
    // Service & maintenance log — run equipment upkeep here (no other software needed).
    const serviceHost = h('div');
    const SVC_KINDS = [['oil_change', 'Oil change'], ['tires', 'Tires'], ['brakes', 'Brakes'], ['inspection', 'Inspection'], ['dot_inspection', 'DOT inspection'], ['pm_service', 'PM service'], ['repair', 'Repair'], ['registration', 'Registration'], ['permit', 'Permit'], ['other', 'Other']];
    async function loadService() {
      let recs; try { recs = await fleetServiceList(null, 100); } catch (_) { recs = []; }
      recs = recs || [];
      mount(serviceHost, recs.length ? h('div', null, recs.map(r => h('div', { class: 'cp-trip' }, [
        h('div', { class: 'cp-trip-head' }, [
          h('div', null, [h('div', { class: 'cp-row-t', style: 'text-transform:capitalize' }, (r.kind || '').replace(/_/g, ' ') + (r.truck_unit ? ' · Unit ' + r.truck_unit : '')),
            h('div', { class: 'cp-row-s' }, [r.service_date, r.cost != null ? money(r.cost) : null, r.vendor].filter(Boolean).join(' · '))]),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { if (!confirm('Delete this service record?')) return; try { await fleetServiceDelete(r.id); loadService(); } catch (e) { alert((e && e.message) || 'Could not delete.'); } } }, 'Delete'),
        ]),
        r.next_due_date ? h('div', { class: 'cp-row-s', style: r.due_soon ? 'color:#d97706' : '' }, (r.due_soon ? '⏰ ' : '') + 'Next due ' + r.next_due_date) : null,
      ].filter(Boolean)))) : h('div', { class: 'cp-muted' }, 'No service records yet. Log your first service.'));
    }
    function serviceForm() {
      const truck = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'No specific truck')].concat(trucks.map(t => h('option', { value: t.id }, 'Unit ' + t.unit_no))));
      const kind = h('select', { class: 'cp-in' }, SVC_KINDS.map(([v, l]) => h('option', { value: v }, l)));
      const date = h('input', { class: 'cp-in', type: 'date' });
      const odo = h('input', { class: 'cp-in', type: 'number', placeholder: 'Odometer (optional)' });
      const cost = h('input', { class: 'cp-in', type: 'number', placeholder: 'Cost (optional)' });
      const vendor = h('input', { class: 'cp-in', placeholder: 'Vendor / shop (optional)' });
      const notes = h('input', { class: 'cp-in', placeholder: 'Notes (optional)' });
      const nextDue = h('input', { class: 'cp-in', type: 'date' });
      let closeM;
      const save = h('button', { class: 'cp-btn', onClick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try { await fleetServiceAdd({ truck_id: truck.value || null, kind: kind.value, service_date: date.value || null, odometer: odo.value || null, cost: cost.value || null, vendor: vendor.value.trim() || null, notes: notes.value.trim() || null, next_due_date: nextDue.value || null }); if (closeM) closeM(); loadService(); }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save');
      closeM = openModal('Log service', [h('label', { class: 'cp-row-s' }, 'Truck'), truck, h('label', { class: 'cp-row-s' }, 'Type'), kind, h('label', { class: 'cp-row-s' }, 'Service date'), date, odo, cost, vendor, notes, h('label', { class: 'cp-row-s' }, 'Next due date'), nextDue, save]);
    }
    // 📈 FLEET OPTIMIZATION — real per-truck utilization + top lanes from delivered trips
    const optCard9 = (() => {
      const host9 = h('div', { class: 'cp-card' }, [cardHead('📈 Fleet optimization', 'last 90 days'), h('div', { class: 'cp-muted' }, 'Loading…')]);
      (async () => {
        let d9; try { d9 = await carrierFleetOptimization(90); } catch (_) { mount(host9, h('span')); return; }
        const tr9 = (d9 && d9.trucks) || []; const ln9 = (d9 && d9.top_lanes) || [];
        if (!tr9.length) { mount(host9, [cardHead('📈 Fleet optimization', 'last 90 days'), h('div', { class: 'cp-muted' }, 'Analytics appear after your first delivered trips — per-truck utilization, $/mile and your best lanes.')]); return; }
        mount(host9, [cardHead('📈 Fleet optimization', 'last ' + (d9.window_days || 90) + ' days — real delivered trips'),
          h('div', { class: 'cp-row-s', style: 'margin-bottom:6px' }, 'Which trucks earn and which sit — and the lanes that pay you best. Assign trucks on every trip to sharpen this.'),
          ...tr9.map((t9) => h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
            h('div', { style: 'flex:1;min-width:180px' }, [h('div', { class: 'cp-row-t' }, '🚛 ' + t9.truck), h('div', { class: 'cp-row-s' }, (t9.trips || 0) + ' trips · ' + Number(t9.miles || 0).toLocaleString() + ' mi · ' + (t9.active_days || 0) + ' active days')]),
            h('div', { style: 'text-align:right' }, [h('div', { class: 'cp-row-t', style: 'color:#4ade80' }, money(t9.revenue || 0)), t9.rpm != null ? h('div', { class: 'cp-row-s' }, '$' + t9.rpm + '/mi') : null]),
          ])),
          ln9.length ? h('div', { style: 'margin-top:10px' }, [h('div', { class: 'cp-row-t', style: 'margin-bottom:4px' }, '🗺 Your best lanes'),
            ...ln9.map((l9) => h('div', { class: 'cp-row-s', style: 'padding:3px 0' }, l9.lane + ' — ' + (l9.trips || 0) + ' trips · ' + money(l9.revenue || 0) + (l9.rpm != null ? ' · $' + l9.rpm + '/mi' : '')))]) : null,
        ].filter(Boolean));
      })();
      return host9;
    })();
    // 🛰 ELD / TELEMATICS — live webhook ingest (Motive, Samsara, any device that can POST)
    const eldCard9 = (() => {
      const host9 = h('div', { class: 'cp-card' }, [cardHead('🛰 ELD & telematics', 'device GPS feeds your trips'), h('div', { class: 'cp-muted' }, 'Loading…')]);
      let prov9 = 'generic';
      const paint9 = async (rotate9, apiTok9) => {
        let d9 = null; try { d9 = await carrierEldSetup(prov9, !!rotate9, apiTok9 || null); } catch (_) { mount(host9, h('span')); return; }
        mount(host9, [cardHead('🛰 ELD & telematics', 'device GPS feeds your trips'),
          h('div', { class: 'cp-row-s', style: 'line-height:1.65;margin-bottom:8px' }, 'Point your ELD / telematics webhook (Motive, Samsara, Garmin — anything that can POST a position) at LoadBoot and your trucks track themselves even with the app closed. Positions route to the active trip automatically.'),
          h('div', { class: 'cp-row-s' }, 'Status: ' + (d9.last_ping_at ? '🟢 last ping ' + new Date(d9.last_ping_at).toLocaleString() : '⚪ no pings yet')),
          h('div', { style: 'background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:11px;padding:10px 13px;margin:8px 0;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;line-height:1.8;user-select:all;word-break:break-all' }, d9.webhook || ''),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
            h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => { try { navigator.clipboard.writeText(String(d9.token || '')); lbToast('Ingest token copied.', 'ok', '🛰 Copied'); } catch (_) {} } }, '📋 Copy token'),
            h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => { if (confirm('Rotate the token? The old one stops working immediately.')) paint9(true); } }, '♻ Rotate token'),
          ]),
          (() => {
            const provSel9 = h('select', { class: 'cp-in', style: 'max-width:170px' }, [['generic', 'Generic webhook'], ['samsara', 'Samsara (API token)'], ['motive', 'Motive / KeepTruckin (API key)']].map(([v9, l9]) => h('option', { value: v9, selected: v9 === prov9 ? 'selected' : null }, l9)));
            const tokIn9 = h('input', { class: 'cp-in', type: 'password', placeholder: 'Provider API token (from their dashboard)', style: 'flex:1;min-width:220px' });
            provSel9.onchange = () => { prov9 = provSel9.value; };
            return h('div', { style: 'margin-top:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px' }, [
              h('div', { class: 'cp-row-t', style: 'font-size:.85rem' }, '🔌 Direct provider connection — no webhook setup needed'),
              h('div', { class: 'cp-row-s', style: 'margin:3px 0 8px;line-height:1.6' }, 'Samsara: Settings → API Tokens → create a read-only token. Motive: Admin → API → generate key. Paste it here — LoadBoot polls your trucks every 5 minutes and feeds the active trip automatically.'),
              h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [provSel9, tokIn9,
                h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev9) => { const b9 = ev9.currentTarget;
                  if (prov9 === 'generic') { lbToast('Pick Samsara or Motive for a direct connection — Generic uses the webhook above.', 'action', '🔌 Provider'); return; }
                  if (!tokIn9.value.trim()) { lbToast('Paste the API token from your provider dashboard first.', 'urgent', '🔌 Token'); return; }
                  b9.disabled = true; try { await paint9(false, tokIn9.value.trim()); lbToast('Connected — polling starts within 5 minutes. Watch the status line turn 🟢.', 'success', '🔌 ' + prov9); } catch (_) { b9.disabled = false; }
                } }, 'Connect'),
              ]),
              d9.has_api_token ? h('div', { class: 'cp-pill', style: 'background:rgba(34,197,94,.14);color:#4ade80;margin-top:6px' }, '✓ Provider API token on file — polling active') : null,
            ].filter(Boolean));
          })(),
        ]);
      };
      paint9(false);
      return host9;
    })();
    const assignCard9 = h('div', { class: 'cp-card' }, [cardHead('\ud83c\udfaf Fleet plan \u2014 optimized'), h('div', { class: 'cp-muted' }, 'Loading\u2026')]);
    (async () => { try { const m9 = await import('./assign-optimizer.js'); await m9.renderAssignOptimizer(assignCard9, { goBoard: () => go('loads') }); } catch (_) { assignCard9.style.display = 'none'; } })();
    mount(content, h('div', null, [
      alertHost,
      assignCard9,
      optCard9,
      eldCard9,
      h('div', { class: 'cp-card', style: 'border-left:4px solid #0883F7' }, [
        h('div', { class: 'cp-row-t' }, '\ud83d\ude9a Capacity: ' + Math.max(trucks.length, 1) + ' load' + (Math.max(trucks.length, 1) === 1 ? '' : 's') + ' at a time'),
        h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, trucks.length <= 1
          ? 'You can run ONE load at a time. Add another truck so a second load can be booked while the first is still rolling \u2014 each truck runs its own load, with its own driver. Add the truck below, add its driver, then tap \u201cInvite to app\u201d so their phone tracks that load.'
          : 'Each of your ' + trucks.length + ' trucks can carry its own load at the same time (' + trucks.length + ' concurrent loads). Invite each driver to the app so every truck is tracked separately.'),
      ]),
      h('div', { class: 'cp-card' }, [
        cardHead('Drivers', drivers.length + ' total'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:12px', onClick: () => driverForm(null) }, '+ Add driver'),
        driverList,
      ]),
      h('div', { class: 'cp-card' }, [
        cardHead('Trucks & equipment', trucks.length + ' total'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:12px', onClick: () => truckForm(null) }, '+ Add truck'),
        truckList,
      ]),
      (() => {
      // cxj — Services you offer: LIVE input to the matching engine (read on every automated run).
      const OPTS = ['Hazmat', 'Team drivers', 'Liftgate', 'Tarping', 'TWIC', 'Drop and hook', 'Expedited', 'White glove', 'Multi-stop', 'Pallet jack'];
      const card = h('div', { class: 'cp-card' }, [cardHead('Services you offer', 'Live — the matching engine reads this on every run'), h('div', { class: 'cp-muted' }, 'Loading…')]);
      (async () => {
        let cur = []; try { cur = ((await myServices()) || {}).services || []; } catch (_) {}
        const state = new Set(cur);
        const note = h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'List every service your trucks can run — loads that require a service you have not listed are never auto-pushed to you; add one and the very next matching run includes you.');
        const saveMsg = h('span', { class: 'cp-row-s' }, '');
        const chips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, OPTS.map(o => {
          const b = h('button', { class: 'cp-chip2' + (state.has(o) ? ' on' : ''), onClick: async () => {
            if (state.has(o)) state.delete(o); else state.add(o);
            b.classList.toggle('on');
            try { await setMyServices([...state]); saveMsg.textContent = 'Saved ✓ (live)'; setTimeout(() => { saveMsg.textContent = ''; }, 1600); }
            catch (e) { saveMsg.textContent = (e && e.message) || 'Could not save.'; }
          } }, o);
          return b;
        }));
        mount(card, [cardHead('Services you offer', 'Live — the matching engine reads this on every run'), chips, h('div', { style: 'margin-top:6px' }, saveMsg), note]);
      })();
      return card;
    })(),
    h('div', { class: 'cp-card' }, [
        cardHead('Service & maintenance', 'Log & track upkeep'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:12px', onClick: () => serviceForm() }, '+ Log service'),
        serviceHost,
      ]),
    ]));
    renderDrivers(); renderTrucks(); loadService();
  }

  /* ----- Finance ----- */
  // ---------- 🧾 TAX CENTER — per diem, deadlines, Schedule C (the pieces owner-ops always miss) ----------
  function taxCenter() {
    const card = h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'Loading tax centre…'));
    (async () => {
      const yr = new Date().getFullYear();
      const y0 = yr + '-01-01';
      let d = { trips: [], totals: {} }; try { d = (await carrierEarnings(y0, null)) || d; } catch (_) {}
      let ex = []; try { ex = (await carrierExpenses(y0, null, 500)) || []; } catch (_) {}
      // PER DIEM — $80/day, 80% deductible (worth $5k+/yr to an OTR owner-op)
      let nights = 0;
      (d.trips || []).forEach(p => {
        const t = p.trip || {};
        if (t.started_at && t.delivered_at) nights += Math.max(0, Math.round((new Date(t.delivered_at) - new Date(t.started_at)) / 864e5));
      });
      const PD_RATE = 80, PD_PCT = 0.8;
      const pdDeduct = Math.round(nights * PD_RATE * PD_PCT);
      // SCHEDULE C — expense rollup by category
      const byCat = {};
      (ex || []).forEach(e => { const c = String(e.category || 'other'); byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0); });
      const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
      const exTotal = cats.reduce((a, c) => a + byCat[c], 0);
      // DEADLINES
      const DL = [['Apr 15', 'Q1 estimated tax + Form 1040'], ['Jun 16', 'Q2 estimated tax'],
                  ['Aug 31', 'Form 2290 (HVUT, 55,000+ lb)'], ['Sep 15', 'Q3 estimated tax'], ['Jan 15', 'Q4 estimated tax']];
      const mIdx = { 'Apr': 3, 'Jun': 5, 'Aug': 7, 'Sep': 8, 'Jan': 0 };
      const now = new Date();
      const nextI = DL.findIndex(([dt]) => { const [mo, dy] = dt.split(' '); const dd = new Date(yr + (mo === 'Jan' ? 1 : 0), mIdx[mo], Number(dy)); return dd >= now; });
      const row = (k, v, sub, col) => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed rgba(148,163,184,.18)' }, [
        h('div', { style: 'min-width:0' }, [h('div', { class: 'cp-row-s', style: 'font-weight:700;color:#dbe6f5' }, k), sub ? h('div', { class: 'cp-row-s' }, sub) : null].filter(Boolean)),
        h('div', { style: 'font-weight:800;flex:none;color:' + (col || '#dbe6f5') }, v),
      ]);
      mount(card, h('div', null, [
        cardHead('🧾 Tax centre — ' + yr, 'estimates only · not tax advice'),
        h('div', { style: 'background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:12px 14px;margin-bottom:10px' }, [
          h('div', { style: 'font-weight:800;color:#4ade80' }, '🛏 Per diem — ' + nights + ' nights away'),
          h('div', { style: 'font-size:1.6rem;font-weight:900;color:#4ade80;margin:2px 0' }, '$' + pdDeduct.toLocaleString()),
          h('div', { class: 'cp-row-s' }, nights + ' nights × $' + PD_RATE + '/day × 80% deductible. Most owner-ops leave this on the table — your GPS trip records ARE the proof.'),
        ]),
        h('div', { class: 'cp-row-s', style: 'font-weight:800;margin:10px 0 2px' }, '📅 Deadlines'),
        ...DL.map(([dt, what], i) => row(dt, i === nextI ? 'NEXT UP' : '', what, i === nextI ? '#fbbf24' : '#7f92b3')),
        h('div', { class: 'cp-row-s', style: 'font-weight:800;margin:12px 0 2px' }, '📊 Schedule C — deductible expenses logged'),
        cats.length ? h('div', null, [...cats.map(c => row(c, '$' + Math.round(byCat[c]).toLocaleString())), row('TOTAL LOGGED', '$' + Math.round(exTotal).toLocaleString(), null, '#4ade80')])
          : h('div', { class: 'cp-muted', style: 'padding:6px 0' }, 'No expenses logged yet — log fuel, tolls, scales, repairs under Costs and they roll up here for Schedule C.'),
        h('div', { class: 'cp-row-s', style: 'margin-top:10px;color:#7f92b3' }, 'Deduct: fuel · per diem · truck payment interest · insurance · maintenance · tolls · scales · parking · permits. Principal on the truck loan is NOT deductible. This is a worksheet, not tax advice.'),
      ]));
    })();
    return card;
  }

  // ---------- 📥 CASH POSITION — what you're owed and when it lands ----------
  function cashCard(rows) {
    const now = Date.now();
    const sent = (rows || []).filter(i => i.status === 'sent');
    const awaiting = sent.reduce((a, i) => a + (Number(i.gross) || 0), 0);
    const overdue = sent.filter(i => i.created_at && (now - new Date(i.created_at).getTime()) > 30 * 864e5);
    const overdueAmt = overdue.reduce((a, i) => a + (Number(i.gross) || 0), 0);
    const paidAmt = (rows || []).filter(i => i.status === 'paid').reduce((a, i) => a + (Number(i.gross) || 0), 0);
    const t = (k, v, col, sub) => h('div', { style: 'flex:1;min-width:130px;padding:12px 14px;border:1px solid var(--lb-line,#22314e);border-radius:14px' }, [
      h('div', { style: 'font-size:.6rem;letter-spacing:.09em;color:#7f92b3;font-weight:800' }, k),
      h('div', { style: 'font-weight:900;font-size:1.3rem;margin-top:2px;color:' + col }, '$' + Math.round(v).toLocaleString()),
      sub ? h('div', { class: 'cp-row-s' }, sub) : null,
    ].filter(Boolean));
    return h('div', { class: 'cp-card' }, [
      cardHead('📥 Cash position', 'trucking pays in 30–45 days — watch the gap'),
      h('div', { style: 'display:flex;gap:9px;flex-wrap:wrap' }, [
        t('AWAITING PAYMENT', awaiting, '#fbbf24', sent.length + ' invoice(s) out'),
        t('OVERDUE 30+ DAYS', overdueAmt, overdueAmt > 0 ? '#f87171' : '#4ade80', overdue.length + ' invoice(s)'),
        t('PAID', paidAmt, '#4ade80', 'received'),
      ]),
      overdueAmt > 0 ? h('div', { style: 'margin-top:10px;padding:10px 12px;border-radius:11px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3)' },
        h('div', { class: 'cp-row-s', style: 'color:#fca5a5' }, '⚠ $' + Math.round(overdueAmt).toLocaleString() + ' is past 30 days. Chase it, or factor it to free the cash.')) : null,
    ].filter(Boolean));
  }

  // ---------- 💰 EARNINGS HUB — per-trip A-to-Z P&L (Uber-style) ----------
  function earningsHub() {
    const card = h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'Loading earnings…'));
    let days = 30;
    const M = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
    const M2 = (v) => (v == null ? '—' : '$' + Number(v).toFixed(2));
    const HC = { good: ['rgba(34,197,94,.16)', '#4ade80'], ok: ['rgba(245,158,11,.16)', '#fbbf24'], risky: ['rgba(239,68,68,.16)', '#f87171'], unknown: ['rgba(148,163,184,.14)', '#94a3b8'] };

    const costModelBox = () => {
      const w = h('div', { style: 'display:none' });
      const btn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
        if (w.style.display !== 'none') { w.style.display = 'none'; return; }
        w.style.display = 'block';
        let cm = {}; try { cm = (await getCostModel()) || {}; } catch (_) {}
        const f = (lbl, key, ph) => { const i = h('input', { class: 'cp-in', type: 'number', step: '0.01', placeholder: ph, value: cm[key] != null ? cm[key] : '' }); i.dataset.k = key; return h('div', null, [h('div', { class: 'cp-row-s', style: 'font-weight:700' }, lbl), i]); };
        const fields = [f('Truck MPG', 'truck_mpg', '6.5'), f('Fuel $/gal', 'fuel_price', '3.85'), f('Driver pay $/mi', 'driver_pay_per_mile', '0.65'), f('Maintenance $/mi', 'maint_per_mile', '0.18'), f('Fixed overhead $/mi', 'fixed_per_mile', '0.35'), f('Factoring %', 'factoring_pct', '3')];
        const save = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
          const o = {}; fields.forEach(fd => { const i = fd.querySelector('input'); const v = i.value.trim(); if (v !== '') o[i.dataset.k] = Number(v); });
          try { await setCostModel(o); b.textContent = 'Saved ✓'; render(); } catch (e) { b.disabled = false; b.textContent = 'Save cost model'; lbToast((e && e.message) || 'Failed.', 'urgent'); }
        } }, 'Save cost model');
        mount(w, h('div', { style: 'margin-top:10px;padding:12px;border:1px solid var(--lb-line,#22314e);border-radius:12px' }, [
          h('div', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'These numbers drive every automatic cost line below. Set them once — every trip is priced with YOUR real costs.'),
          h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px' }, fields),
          save,
        ]));
      } }, '⚙ Cost model');
      return h('div', null, [btn, w]);
    };

    const tripRow = (p) => {
      const tr = p.trip || {}, rev = p.revenue || {}, cst = p.costs || {}, mt = p.metrics || {};
      const hc = HC[mt.health || 'unknown'] || HC.unknown;
      const body = h('div', { style: 'display:none' });
      const head = h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;cursor:pointer;padding:10px 0', onClick: () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        if (!open) drawBody();
      } }, [
        h('div', { style: 'min-width:0' }, [
          h('div', { class: 'cp-row-t' }, (tr.origin || '—') + ' → ' + (tr.destination || '—')),
          h('div', { class: 'cp-row-s' }, [tr.delivered_at ? new Date(tr.delivered_at).toLocaleDateString() : (tr.status || ''), (tr.miles_total ? Math.round(tr.miles_total) + ' mi' : null), (mt.rpm != null ? '$' + mt.rpm + '/mi' : null)].filter(Boolean).join(' · ')),
        ]),
        h('div', { style: 'text-align:right;flex:none' }, [
          h('div', { style: 'font-weight:900;font-size:1.05rem;color:' + (Number(p.net) >= 0 ? '#4ade80' : '#f87171') }, M(p.net)),
          h('span', { class: 'cp-pill', style: 'background:' + hc[0] + ';color:' + hc[1] + ';font-weight:800' }, (mt.margin_pct != null ? mt.margin_pct + '% margin' : 'n/a')),
        ]),
      ]);
      const drawBody = () => {
        const ln = (lbl, amt, sub, col, onDel) => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(148,163,184,.18)' }, [
          h('div', { style: 'min-width:0' }, [h('div', { class: 'cp-row-s', style: 'font-weight:700;color:#dbe6f5' }, lbl), sub ? h('div', { class: 'cp-row-s' }, sub) : null].filter(Boolean)),
          h('div', { style: 'display:flex;gap:8px;align-items:center;flex:none' }, [
            h('span', { style: 'font-weight:800;color:' + (col || '#dbe6f5') }, amt),
            onDel ? h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'padding:2px 8px', onClick: onDel }, '✕') : null,
          ].filter(Boolean)),
        ]);
        const rows = [];
        rows.push(h('div', { class: 'cp-row-s', style: 'font-weight:800;color:#4ade80;margin-top:6px' }, 'MONEY IN'));
        rows.push(ln('Linehaul', M2(rev.linehaul), null, '#4ade80'));
        (rev.accessorials || []).forEach(a => rows.push(ln(String(a.kind || '').toUpperCase(), M2(a.amount), a.status === 'approved' ? 'approved ✓' : a.status, a.status === 'approved' ? '#4ade80' : '#94a3b8')));
        (rev.custom || []).forEach(c => rows.push(ln(c.label, M2(c.amount), c.category, '#4ade80', async () => { try { await tripFinanceRemove(c.id); render(); } catch (_) {} })));
        rows.push(ln('GROSS', M2(rev.gross), null, '#4ade80'));
        rows.push(h('div', { class: 'cp-row-s', style: 'font-weight:800;color:#f87171;margin-top:10px' }, 'MONEY OUT'));
        (cst.auto || []).forEach(c => rows.push(ln(c.label, '−' + M2(c.amount).slice(1), 'auto', '#f87171')));
        (cst.custom || []).forEach(c => rows.push(ln(c.label, '−' + M2(c.amount).slice(1), c.category, '#f87171', async () => { try { await tripFinanceRemove(c.id); render(); } catch (_) {} })));
        rows.push(ln('TOTAL COST', '−' + M2(cst.total).slice(1), null, '#f87171'));
        rows.push(h('div', { style: 'display:flex;justify-content:space-between;padding:10px 0 4px;border-top:2px solid rgba(148,163,184,.25);margin-top:6px' }, [
          h('div', { style: 'font-weight:900;font-size:1rem' }, 'NET PROFIT'),
          h('div', { style: 'font-weight:900;font-size:1.15rem;color:' + (Number(p.net) >= 0 ? '#4ade80' : '#f87171') }, M2(p.net)),
        ]));
        const mtile = (k, v) => h('div', { style: 'flex:1;min-width:88px;text-align:center;padding:7px 4px;border:1px solid var(--lb-line,#22314e);border-radius:10px' }, [
          h('div', { style: 'font-size:.62rem;letter-spacing:.08em;color:#7f92b3;font-weight:800' }, k),
          h('div', { style: 'font-weight:800;margin-top:2px' }, v),
        ]);
        rows.push(h('div', { style: 'display:flex;gap:7px;flex-wrap:wrap;margin-top:10px' }, [
          mtile('RPM', mt.rpm != null ? '$' + mt.rpm : '—'),
          mtile('COST/MI', mt.cpm != null ? '$' + mt.cpm : '—'),
          mtile('NET/MI', mt.net_per_mile != null ? '$' + mt.net_per_mile : '—'),
          mtile('NET/HR', mt.net_per_hour != null ? '$' + mt.net_per_hour : '—'),
          mtile('BREAK-EVEN', mt.breakeven_rpm != null ? '$' + mt.breakeven_rpm + '/mi' : '—'),
        ]));
        // add a custom line to THIS trip
        const dir = h('select', { class: 'cp-in', style: 'max-width:110px' }, [h('option', { value: 'cost' }, '− Cost'), h('option', { value: 'earning' }, '+ Earning')]);
        const catI = h('select', { class: 'cp-in', style: 'max-width:130px' }, ['tolls', 'fuel', 'lumper', 'scale', 'parking', 'repair', 'bonus', 'other'].map(c => h('option', { value: c }, c)));
        const labI = h('input', { class: 'cp-in', placeholder: 'What was it?' });
        const amtI = h('input', { class: 'cp-in', type: 'number', step: '0.01', placeholder: '$', style: 'max-width:100px' });
        const addB = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          const b = ev.currentTarget;
          if (!labI.value.trim() || !(Number(amtI.value) > 0)) { lbToast('Add a label and an amount.', 'warning'); return; }
          b.disabled = true; b.textContent = '…';
          try { await tripFinanceAdd(tr.id, dir.value, catI.value, labI.value.trim(), Number(amtI.value)); render(); }
          catch (e) { b.disabled = false; b.textContent = '+ Add'; lbToast((e && e.message) || 'Failed.', 'urgent'); }
        } }, '+ Add');
        rows.push(h('div', { style: 'margin-top:10px' }, [
          h('div', { class: 'cp-row-s', style: 'font-weight:700;margin-bottom:5px' }, 'Add anything specific to THIS trip — tolls, scale, a repair, a bonus:'),
          h('div', { class: 'cp-inlineform' }, [dir, catI, labI, amtI, addB]),
        ]));
        mount(body, h('div', { style: 'padding:4px 2px 10px' }, rows));
      };
      return h('div', { style: 'border-bottom:1px solid rgba(148,163,184,.14)' }, [head, body]);
    };

    async function render() {
      mount(card, h('div', { class: 'cp-muted' }, 'Loading earnings…'));
      const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      let d; try { d = await carrierEarnings(from, null); }
      catch (e) { mount(card, [cardHead('💰 Earnings'), h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load.')]); return; }
      const t = d.totals || {}, trips = d.trips || [];
      const chip = (n, lbl) => h('button', { class: 'cp-btn cp-btn-sm ' + (days === n ? '' : 'ghost'), style: 'padding:5px 12px', onClick: () => { days = n; render(); } }, lbl);
      const big = h('div', { style: 'text-align:center;padding:6px 0 12px' }, [
        h('div', { style: 'font-size:.66rem;letter-spacing:.12em;color:#7f92b3;font-weight:800' }, 'NET PROFIT · LAST ' + days + ' DAYS'),
        h('div', { style: 'font-size:2.5rem;font-weight:900;letter-spacing:-.02em;color:' + (Number(t.net) >= 0 ? '#4ade80' : '#f87171') }, M(t.net)),
        h('div', { class: 'cp-row-s' }, M(t.gross) + ' gross − ' + M(t.costs) + ' costs · ' + (t.trip_count || 0) + ' trips · ' + Math.round(t.miles || 0).toLocaleString() + ' mi'),
      ]);
      const kt = (k, v, col) => h('div', { style: 'flex:1;min-width:90px;text-align:center;padding:9px 5px;border:1px solid var(--lb-line,#22314e);border-radius:12px' }, [
        h('div', { style: 'font-size:.6rem;letter-spacing:.09em;color:#7f92b3;font-weight:800' }, k),
        h('div', { style: 'font-weight:900;margin-top:2px;color:' + (col || '#dbe6f5') }, v),
      ]);
      mount(card, h('div', null, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' }, [
          h('div', { class: 'cp-row-t', style: 'font-size:1.05rem' }, '💰 Earnings — every trip, A to Z'),
          h('div', { style: 'display:flex;gap:6px;align-items:center' }, [chip(7, '7d'), chip(30, '30d'), chip(90, '90d'), costModelBox()]),
        ]),
        big,
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' }, [
          kt('REVENUE/MI', t.rpm != null ? '$' + t.rpm : '—'),
          kt('COST/MI', t.cpm != null ? '$' + t.cpm : '—'),
          kt('NET/MI', t.net_per_mile != null ? '$' + t.net_per_mile : '—', Number(t.net_per_mile) >= 0 ? '#4ade80' : '#f87171'),
          kt('NET/HR', t.net_per_hour != null ? '$' + t.net_per_hour : '—'),
          kt('MARGIN', t.margin_pct != null ? t.margin_pct + '%' : '—', (t.margin_pct >= 30 ? '#4ade80' : t.margin_pct >= 15 ? '#fbbf24' : '#f87171')),
        ]),
        (d.settings_hint === false) ? null : null,
        trips.length
          ? h('div', null, [h('div', { class: 'cp-row-s', style: 'font-weight:800;margin-bottom:2px' }, 'Tap any trip for its full profit statement'), ...trips.map(tripRow)])
          : h('div', { class: 'cp-muted', style: 'text-align:center;padding:16px' }, 'No trips in this period yet. Once you deliver, each trip gets its own full P&L here.'),
      ].filter(Boolean)));
    }
    render();
    return card;
  }

  async function loadFinance() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let rows; try { rows = await pocketInvoices(100); } catch (e) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'Failed to load.'))); return; }
    rows = rows || [];
    const due = rows.filter(i => i.status === 'sent').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const paid = rows.filter(i => i.status === 'paid').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const gross = rows.reduce((a, i) => a + (Number(i.gross) || 0), 0);
    const series = rows.slice(0, 14).reverse().map((i, k) => ({ label: String(k), value: Number(i.fee) || 0 }));
    const statusParts = [
      { label: 'Paid', value: rows.filter(i => i.status === 'paid').length, color: '#16a34a' },
      { label: 'Due', value: rows.filter(i => i.status === 'sent').length, color: '#f59e0b' },
      { label: 'Draft', value: rows.filter(i => i.status === 'draft').length, color: '#94a3b8' },
    ];
    // ---- 🏦 FACTORING (NOA) — org-level by design: an NOA legally binds ALL your invoices (UCC 9-406);
    // there is no per-load bank/factor toggle. Switching back needs the factor's signed RELEASE letter.
    const factoringCard9 = (() => {
      const host9 = h('div', { class: 'cp-card', style: 'margin-top:14px' }, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '🏦 Factoring — how brokers pay you')]), h('div', { class: 'cp-muted' }, 'Loading…')]);
      (async () => {
        let pp9 = null; try { pp9 = await myPaymentProfile(); } catch (_) {}
        const st9 = (pp9 && pp9.noa_status) || 'none';
        const on9 = !!(pp9 && pp9.factoring_noa);
        const chip9 = { pending: ['#fbbf24', '⏳ NOA under LoadBoot review — brokers already see the factor\u2019s details with a “verification pending” note'], verified: ['#4ade80', '✅ NOA verified — every broker payment panel shows your FACTOR\u2019s remit-to, never your bank'], rejected: ['#f87171', '✕ NOA rejected — fix and resubmit'], released: ['#94a3b8', '↩ Factoring released — brokers pay your own bank again'], none: ['#94a3b8', 'Not using factoring — brokers pay your bank on file directly'] }[st9] || ['#94a3b8', ''];
        const f9 = { factoring_company: (pp9 && pp9.factoring_company) || '', account_title: '', bank_name: '', account_number: '', routing_number: '', remittance_email: '', payment_method: 'ACH', advance_pct: '', fee_pct: '', terms_days_broker: '30' };
        const inp9 = (k9, lbl9, ph9) => { const i9 = h('input', { class: 'cp-in', placeholder: ph9 || '', value: f9[k9] || '' }); i9.oninput = () => { f9[k9] = i9.value; }; return h('div', { style: 'flex:1;min-width:190px' }, [h('label', { class: 'cp-lbl' }, lbl9), i9]); };
        const msg9 = h('div', { style: 'margin-top:6px;min-height:1em;color:#f87171;font-weight:700;font-size:.82rem' });
        const form9 = h('div', { style: on9 ? 'display:none' : '' }, [
          h('div', { class: 'cp-row-s', style: 'line-height:1.7;margin:8px 0' }, 'Use a factoring company? Declare it here ONCE — it applies to ALL your loads (a Notice of Assignment legally covers every invoice — that\u2019s why there is no per-trip choice). Brokers then automatically see your factor\u2019s remit-to details instead of your bank, with the NOA warning. First upload the factor\u2019s NOA letter under Documents → Factoring NOA.'),
          h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
            inp9('factoring_company', 'Factoring company *', 'e.g. OTR Capital'),
            inp9('account_title', 'Remit-to payee name *', 'exactly as the factor wrote it'),
            inp9('bank_name', 'Factor\u2019s bank *', ''),
            inp9('account_number', 'Factor account #', ''),
            inp9('routing_number', 'Factor routing (ACH)', ''),
            inp9('remittance_email', 'Factor remittance email', 'payments@factor.com'),
            inp9('advance_pct', 'Advance % they pay you', 'e.g. 95'),
            inp9('fee_pct', 'Factor fee %', 'e.g. 3'),
            inp9('terms_days_broker', 'Days the broker gets to pay the factor', '30'),
          ]),
          h('button', { class: 'cp-btn', style: 'margin-top:10px', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
            try { await carrierFactoringSet({ action: 'activate', factoring_company: f9.factoring_company, remit: { account_title: f9.account_title, bank_name: f9.bank_name, account_number: f9.account_number, routing_number: f9.routing_number, remittance_email: f9.remittance_email, payment_method: f9.payment_method, advance_pct: f9.advance_pct || null, fee_pct: f9.fee_pct || null, terms_days_broker: f9.terms_days_broker || '30' } }); lbToast('Factoring submitted — LoadBoot verifies the NOA, brokers with open loads are being notified.', 'ok', '🏦 NOA filed'); loadFinance(); }
            catch (e9) { b9.disabled = false; msg9.textContent = (e9 && e9.message) || 'Failed.'; } } }, 'Activate factoring — file the NOA'),
          msg9,
        ]);
        const releaseRow9 = on9 ? h('div', { style: 'margin-top:10px' }, [
          h('div', { class: 'cp-row-s', style: 'line-height:1.65' }, 'Leaving your factor? Upload their signed RELEASE LETTER under Documents → Factoring NOA, then tap below — until the release, brokers must keep paying the factor.'),
          h('button', { class: 'cp-btn-ghost', style: 'margin-top:7px', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
            try { await carrierFactoringSet({ action: 'release', release_doc: 'documents:noa-release' }); lbToast('Release filed — after LoadBoot verifies it, brokers pay your own bank again.', 'ok', '↩ Release filed'); loadFinance(); }
            catch (e9) { b9.disabled = false; msg9.textContent = (e9 && e9.message) || 'Failed.'; } } }, '↩ I left my factoring company — file the release'),
          msg9,
        ]) : null;
        // PER-BROKER control: choose which brokers pay your factor and which pay you directly
        const brokerList9 = on9 ? (() => {
          const w9 = h('div', { style: 'margin-top:12px' }, h('div', { class: 'cp-muted' }, 'Loading your brokers…'));
          (async () => {
            let bl9; try { bl9 = await carrierFactoringBrokers(); } catch (_) { mount(w9, h('span')); return; }
            const bs9 = (bl9 && bl9.brokers) || [];
            if (!bs9.length) { mount(w9, h('div', { class: 'cp-row-s' }, 'No brokers hauled for yet — as soon as you book a load, the broker appears here with a factor/direct switch.')); return; }
            mount(w9, h('div', null, [
              h('div', { style: 'font-weight:800;margin-bottom:4px' }, '🎛 Per-broker control — full freedom'),
              h('div', { class: 'cp-row-s', style: 'line-height:1.6;margin-bottom:8px' }, 'Choose which brokers pay your FACTOR and which pay YOU directly. ⚠ Use “direct” only if your factoring contract is non-exclusive AND that broker never got an NOA from your factor — otherwise keep them on factor.'),
              ...bs9.map((b9) => {
                const isDirect9 = b9.mode === 'direct';
                const btn9 = h('button', { class: 'cp-btn-ghost cp-btn-sm', style: 'font-size:.74rem', onClick: async (ev9) => { const x9 = ev9.currentTarget; x9.disabled = true;
                  try { await carrierFactoringBrokerSet(b9.org_id, !isDirect9); lbToast((b9.name || 'Broker') + ' → ' + (!isDirect9 ? 'DIRECT to your bank' : 'via ' + ((bl9 && bl9.factoring_company) || 'factor')) + ' — the broker was notified.', 'ok', '🎛 Switched'); loadFinance(); }
                  catch (e9) { x9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent', 'Switch'); } } }, isDirect9 ? '→ Switch to factor' : '→ Switch to direct');
                return h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07);flex-wrap:wrap' }, [
                  h('div', null, [h('b', { style: 'font-size:.86rem' }, b9.name || 'Broker'), h('div', { class: 'cp-row-s' }, (b9.trips || 0) + ' trips')]),
                  h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
                    h('span', { class: 'cp-pill', style: 'font-weight:800;' + (isDirect9 ? 'background:rgba(34,197,94,.15);color:#4ade80' : 'background:rgba(139,92,246,.18);color:#c4b5fd') }, isDirect9 ? '🏛 pays YOU directly' : '🏦 pays your FACTOR'),
                    btn9,
                  ]),
                ]);
              }),
            ]));
          })();
          return w9;
        })() : null;
        mount(host9, h('div', null, [
          h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '🏦 Factoring — how brokers pay you')]),
          h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
            h('span', { class: 'cp-pill', style: 'font-weight:800;color:' + chip9[0] }, (on9 ? ((pp9 && pp9.factoring_company) || 'Factoring') + ' · ' : '') + st9.toUpperCase()),
          ]),
          h('div', { class: 'cp-row-s', style: 'margin-top:6px;line-height:1.65' }, chip9[1]),
          form9, brokerList9, releaseRow9,
        ].filter(Boolean)));
      })();
      return host9;
    })();
    const stmtCard = h('div', { class: 'cp-card' }, [cardHead('Account statement'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let s; try { s = await pocketStatement(); } catch (e) { mount(stmtCard, [cardHead('Account statement'), h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load.')]); return; }
      s = s || {};
      const settlements = Array.isArray(s.settlements) ? s.settlements : [];
      const line = (k, v) => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, k), h('span', null, v)]);
      const download = h('button', { class: 'cp-btn cp-btn-sm', onClick: () => {
        const rowsTxt = [
          'LoadBoot — Account Statement',
          'Carrier: ' + (s.carrier || '—'),
          'Generated: ' + new Date().toLocaleString(),
          '',
          'Invoices total,' + (s.invoices_total || 0),
          'Fees outstanding,' + (s.fees_outstanding || 0),
          'Fees paid,' + (s.fees_paid || 0),
          'Adjustments,' + (s.adjustments || 0),
          'Open disputes,' + (s.open_disputes || 0),
          '',
          'Settlement,Net,Status',
          ...settlements.map(x => [x.no, x.net, x.status].join(',')),
        ].join('\n');
        const blob = new Blob([rowsTxt], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'loadboot-statement-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
      } }, '⬇ Download (CSV)');
      const downloadPdf = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7', onClick: () => openPrintable('Account Statement', 'STATEMENT', [
        { rows: [['Carrier', s.carrier || '—'], ['Generated', new Date().toLocaleString()], ['Invoices', String(s.invoices_total || 0)], ['Fees outstanding', money(s.fees_outstanding || 0)], ['Fees paid', money(s.fees_paid || 0)], ['Adjustments', money(s.adjustments || 0)], ['Open disputes', String(s.open_disputes || 0)]] },
        { h: 'Invoices', rows: rows.map(i => [i.invoice_no || '—', money(i.gross || 0) + ' gross · ' + money(i.fee || 0) + ' fee · ' + (i.status || '')]) },
        { h: 'Settlements', rows: settlements.map(x => [String(x.no || '—'), money(x.net || 0) + ' · ' + (x.status || '—')]) },
      ]) }, '⬇ Download (PDF)');
      const settleList = settlements.length ? h('div', { style: 'margin-top:10px' }, [h('b', { class: 'cp-row-s' }, 'Settlements'), ...settlements.map(x => h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, 'Settlement ' + (x.no || '—')), h('div', { class: 'cp-row-s' }, x.status || '—')]),
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, [h('b', null, money(x.net || 0)), h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7', onClick: () => openPrintable('Settlement ' + (x.no || ''), 'SETTLEMENT', [
          { rows: [['Settlement #', String(x.no || '—')], ['Status', x.status || '—'], ['Net paid', money(x.net || 0)], ['Gross', money(x.gross || x.net || 0)], ['Fees', money(x.fees || 0)], ['Date', x.date ? new Date(x.date).toLocaleDateString() : (x.paid_at ? new Date(x.paid_at).toLocaleDateString() : '—')]] },
          { note: 'LoadBoot settlement statement — flat 5% dispatch, no contracts.' },
        ]) }, '⬇ PDF')]),
      ]))]) : null;
      mount(stmtCard, [
        cardHead('Account statement'),
        line('Invoices', String(s.invoices_total || 0)),
        line('Fees outstanding', money(s.fees_outstanding || 0)),
        line('Fees paid', money(s.fees_paid || 0)),
        line('Open disputes', String(s.open_disputes || 0)),
        settleList || line('Settlements', '0'),
        h('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, [download, downloadPdf]),
      ]);
    })();
    // Inc 55 — Profit & Loss (honest labels: confirmed revenue vs manually-entered expenses; ESTIMATE marked).
    const pnlCard = h('div', { class: 'cp-card' }, [cardHead('Profit & Loss (this month)'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    // #49 — real per-trip P&L: every delivered load with its own revenue, dispatch fee, allocated cost, net + PDF.
    const tripPnlCard = h('div', { class: 'cp-card' }, [cardHead('Per-trip P&L'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let p; try { p = await carrierPnl(); } catch (e) { mount(pnlCard, [cardHead('Profit & Loss (this month)'), h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load.')]); return; }
      const m = p.metrics || {}, rev = p.revenue || {}, ex = p.expenses || {};
      const row2 = (lbl, val, sub) => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, lbl), sub ? h('div', { class: 'cp-row-s' }, sub) : null].filter(Boolean)), h('b', null, val)]);
      const cats = Object.entries(ex.by_category || {});
      const expForm = (() => {
        const cat = h('select', { class: 'cp-in' }, ['fuel','tolls','driver_pay','maintenance','repairs','insurance','truck_payment','trailer','permits','factoring_fee','dispatch_fee','misc'].map(c => h('option', { value: c }, c.replace('_',' '))));
        const amt = h('input', { class: 'cp-in', type: 'number', placeholder: 'Amount $' });
        const add = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          if (!amt.value || Number(amt.value) <= 0) { alert('Enter a valid amount.'); return; }
          ev.currentTarget.disabled = true;
          try { await carrierAddExpense({ category: cat.value, amount: amt.value }); loadFinance(); }
          catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not add.'); }
        } }, 'Add expense');
        return h('div', { class: 'cp-inlineform', style: 'margin-top:8px' }, [cat, amt, add]);
      })();
      mount(pnlCard, [cardHead('Profit & Loss (this month)'),
        row2('Revenue', money(rev.total), rev.basis),
        row2('Expenses', money(ex.total), ex.basis),
        row2('Est. profit', money(m.est_profit), m.note),
        h('div', { class: 'cp-row-s', style: 'margin-top:6px' },
          [(m.delivered_trips || 0) + ' delivered', m.loaded_rpm != null ? '$' + m.loaded_rpm + '/mi loaded' : null,
           m.profit_per_mile != null ? '$' + m.profit_per_mile + '/mi profit' : null,
           m.on_time_pct != null ? m.on_time_pct + '% on-time (' + (m.on_time_basis || '') + ')' : null].filter(Boolean).join(' · ')),
        cats.length ? h('div', { style: 'margin-top:8px' }, cats.map(([c, v]) => h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, c.replace('_',' ')), h('span', null, money(v))]))) : h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'No expenses entered this month — add them below for a real profit picture.'),
        expForm,
        (p.by_lane && p.by_lane.length) ? h('div', { style: 'margin-top:10px' }, [h('b', { class: 'cp-row-s' }, 'Top lanes'), ...p.by_lane.map(x => h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, x.lane + ' (' + x.trips + ')'), h('span', null, money(x.revenue))]))]) : null,
      ].filter(Boolean));
      // --- per-trip P&L ---
      const trips2 = Array.isArray(p.by_trip) ? p.by_trip : [];
      const tripRow = (t) => {
        const dw = h('div');
        const prof = Number(t.est_profit || 0);
        const profColor = prof > 0 ? 'var(--lb-green,#16a34a)' : (prof < 0 ? 'var(--lb-red,#dc2626)' : '');
        const tripPdf = () => openPrintable('Trip P&L — ' + (t.load_ref || ''), 'TRIP P&L', [
          { rows: [['Load', t.load_ref || '—'], ['Lane', t.lane || '—'], ['Commodity', t.commodity || '—'], ['Equipment', t.equipment || '—'], ['Truck', t.truck || '—'], ['Delivered', t.delivered ? new Date(t.delivered).toLocaleDateString() : '—'], ['On-time', t.on_time == null ? '—' : (t.on_time ? 'Yes' : 'No')], ['Miles', t.miles != null ? String(t.miles) : '—'], ['Loaded RPM', t.rpm != null ? ('$' + t.rpm + '/mi') : '—']] },
          { h: 'Money', rows: [['Linehaul', money(t.linehaul || 0)], ['Accessorials', money(t.accessorials || 0)], ['Gross revenue', money(t.gross || 0)], ['Dispatch fee (5%)', '-' + money(t.dispatch_fee || 0)], ['Carrier net', money(t.net || 0)], ['Allocated expenses', '-' + money(t.alloc_expense || 0)], ['Est. trip profit', money(t.est_profit || 0)]] },
          { note: 'Allocated expenses spread your month’s entered expenses across trips by share of miles. Est. profit = net after 5% dispatch fee minus allocated expenses.' },
        ]);
        const detail = h('div', { hidden: true, style: 'margin-top:8px;border-top:1px dashed var(--lb-border,#e2e8f0);padding-top:8px' }, [
          h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, 'Linehaul'), h('span', null, money(t.linehaul || 0))]),
          Number(t.accessorials || 0) ? h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, 'Accessorials'), h('span', null, money(t.accessorials))]) : null,
          h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, 'Gross revenue'), h('b', null, money(t.gross || 0))]),
          h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, 'Dispatch fee (5%)'), h('span', null, '-' + money(t.dispatch_fee || 0))]),
          h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, 'Carrier net'), h('span', null, money(t.net || 0))]),
          h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-s' }, 'Allocated expenses'), h('span', null, '-' + money(t.alloc_expense || 0))]),
          h('div', { class: 'cp-row' }, [h('span', { class: 'cp-row-t' }, 'Est. trip profit'), h('b', { style: 'color:' + profColor }, money(t.est_profit || 0))]),
          h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, [t.miles != null ? (t.miles + ' mi') : null, t.rpm != null ? ('$' + t.rpm + '/mi') : null, t.truck ? ('Unit ' + t.truck) : null, t.commodity || null, t.on_time == null ? null : (t.on_time ? 'on-time' : 'late')].filter(Boolean).join(' · ')),
          h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7;margin-top:8px', onClick: tripPdf }, '⬇ Trip P&L PDF'),
        ].filter(Boolean));
        const toggle = h('div', { class: 'cp-trip-head', style: 'cursor:pointer', onClick: () => { detail.hidden = !detail.hidden; } }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, (t.load_ref || 'Trip') + ' · ' + (t.lane || '')), h('div', { class: 'cp-row-s' }, [t.delivered ? new Date(t.delivered).toLocaleDateString() : null, t.miles != null ? (t.miles + ' mi') : null, 'gross ' + money(t.gross || 0)].filter(Boolean).join(' · '))]),
          h('div', { style: 'text-align:right' }, [h('b', { style: 'color:' + profColor }, money(t.est_profit || 0)), h('div', { class: 'cp-row-s' }, 'profit')]),
        ]);
        return h('div', { class: 'cp-trip' }, [toggle, detail]);
      };
      mount(tripPnlCard, [
        cardHead('Per-trip P&L', trips2.length + ' delivered'),
        h('div', { class: 'cp-row-s', style: 'margin-bottom:8px' }, p.by_trip_note || 'Every delivered load with its own revenue, dispatch fee, allocated cost and net. Tap a trip for the breakdown and a PDF.'),
        trips2.length ? h('div', null, trips2.map(tripRow)) : h('div', { class: 'cp-muted' }, 'No delivered trips in this period yet.'),
      ]);
    })();
    // A5 — Payroll / employee salary management (manually entered; self-scoped).
    const payrollCard = h('div', { class: 'cp-card' }, [cardHead('Payroll'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    async function renderPayroll() {
      let pr; try { pr = await payrollList(); } catch (e) { mount(payrollCard, [cardHead('Payroll'), h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load.')]); return; }
      pr = pr || {}; const entries = Array.isArray(pr.entries) ? pr.entries : [];
      const name = h('input', { class: 'cp-in', placeholder: 'Employee name' });
      const role = h('input', { class: 'cp-in', placeholder: 'Role (optional)' });
      const type = h('select', { class: 'cp-in' }, [['salary', 'Salary'], ['hourly', 'Hourly'], ['per_mile', 'Per mile'], ['percentage', 'Percentage'], ['bonus', 'Bonus'], ['reimbursement', 'Reimbursement']].map(([v, l]) => h('option', { value: v }, l)));
      const amt = h('input', { class: 'cp-in', type: 'number', placeholder: 'Amount $' });
      const pend = h('input', { class: 'cp-in', type: 'date' });
      const add = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!name.value.trim() || !amt.value) { alert('Enter an employee name and amount.'); return; }
        ev.currentTarget.disabled = true;
        try { await payrollAdd({ employee_name: name.value.trim(), role: role.value.trim() || null, pay_type: type.value, amount: amt.value, period_end: pend.value || null }); renderPayroll(); }
        catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not add.'); }
      } }, 'Add');
      mount(payrollCard, [
        cardHead('Payroll', money(pr.unpaid) + ' unpaid'),
        h('div', { class: 'cp-row-s' }, 'Total ' + money(pr.total) + ' · paid ' + money(pr.paid) + ' · unpaid ' + money(pr.unpaid) + ' — ' + (pr.basis || '')),
        entries.length ? h('div', null, entries.map(e => h('div', { class: 'cp-row' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, e.employee_name + (e.role ? ' · ' + e.role : '')), h('div', { class: 'cp-row-s', style: 'text-transform:capitalize' }, [(e.pay_type || '').replace(/_/g, ' '), e.period_end].filter(Boolean).join(' · '))]),
          h('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            h('b', { style: e.paid ? 'color:var(--lb-green,#16a34a)' : '' }, money(e.amount)),
            h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { try { await payrollMarkPaid(e.id, !e.paid); renderPayroll(); } catch (x) {} } }, e.paid ? 'Paid ✓' : 'Mark paid'),
            h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { if (!confirm('Delete this payroll entry?')) return; try { await payrollDelete(e.id); renderPayroll(); } catch (x) {} } }, '✕'),
          ]),
        ]))) : h('div', { class: 'cp-muted' }, 'No payroll entries yet. Add your team’s pay below.'),
        h('div', { class: 'cp-inlineform', style: 'margin-top:8px;flex-wrap:wrap' }, [name, role, type, amt, pend, add]),
      ]);
    }
    renderPayroll();
    // ---- Expense tracker (tax/IFTA prep + feeds cost-per-mile awareness) ----
    const CATS = [['fuel', '⛽ Fuel'], ['tolls', '🛣 Tolls'], ['maintenance', '🔧 Maintenance'], ['insurance', '🛡 Insurance'], ['lumper', '📦 Lumper'], ['parking', '🅿 Parking'], ['permits', '📋 Permits'], ['other', '💳 Other']];
    const expCard = h('div', { class: 'cp-card' });
    const expMonth = h('input', { class: 'cp-in', type: 'month', value: new Date().toISOString().slice(0, 7), style: 'max-width:160px;margin:0' });
    async function renderExpenses() {
      let d; try { d = await expenseList(expMonth.value || null); } catch (e) { mount(expCard, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load expenses.')); return; }
      const cat = h('select', { class: 'cp-in', style: 'margin:0;max-width:150px' }, CATS.map(([v, l]) => h('option', { value: v }, l)));
      const amt = h('input', { class: 'cp-in', type: 'number', step: '0.01', placeholder: '$', style: 'margin:0;max-width:110px' });
      const nt = h('input', { class: 'cp-in', placeholder: 'Note (optional)', style: 'margin:0;flex:1;min-width:120px' });
      const add = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!amt.value || Number(amt.value) <= 0) { alert('Enter an amount.'); return; }
        ev.currentTarget.disabled = true;
        try { await expenseAdd({ category: cat.value, amount: amt.value, note: nt.value.trim() || null }); renderExpenses(); }
        catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not add.'); }
      } }, '+ Add');
      const byCat = d.by_category || {};
      const catChips = Object.keys(byCat).length ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 2px' },
        CATS.filter(([v]) => byCat[v]).map(([v, l]) => h('span', { class: 'cpx-chip' }, l + ' ' + money(byCat[v])))) : null;
      mount(expCard, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, '💳 Expenses — ' + (d.month || '')), h('div', { class: 'cp-row-s' }, 'Log fuel, tolls & costs on the go. Month total feeds your real cost per mile.')]),
          h('div', { style: 'display:flex;gap:8px;align-items:center' }, [expMonth, h('b', { style: 'font-size:1.2rem' }, money(d.total || 0))]),
        ]),
        catChips,
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px' }, [cat, amt, nt, add]),
        (d.rows && d.rows.length) ? h('div', { style: 'margin-top:6px' }, d.rows.slice(0, 20).map(x => h('div', { class: 'cp-row' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, (CATS.find(c => c[0] === x.category) || ['', x.category])[1] + ' · ' + money(x.amount)),
            h('div', { class: 'cp-row-s' }, String(x.incurred_on) + (x.note ? ' · ' + x.note : ''))]),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { if (!confirm('Delete this expense?')) return; try { await expenseDelete(x.id); renderExpenses(); } catch (e) { alert('Failed'); } } }, '✕'),
        ]))) : h('div', { class: 'cp-muted' }, 'No expenses logged this month yet.'),
      ].filter(Boolean));
    }
    expMonth.onchange = renderExpenses;
    renderExpenses();
    // ---- IFTA state-miles (manual quarterly log; totals + avg MPG) ----
    const q0 = (() => { const d = new Date(); return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1); })();
    const iftaCard = h('div', { class: 'cp-card' });
    const qSel = h('select', { class: 'cp-in', style: 'margin:0;max-width:130px' }, (() => {
      const y = new Date().getFullYear(); const out = [];
      [y, y - 1].forEach(yy => { for (let q = 4; q >= 1; q--) out.push(h('option', { value: yy + '-Q' + q }, yy + ' Q' + q)); });
      return out;
    })());
    qSel.value = q0;
    async function renderIfta() {
      let d; try { d = await iftaSummary(qSel.value); } catch (e) { mount(iftaCard, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load IFTA.')); return; }
      const stIn = h('input', { class: 'cp-in', placeholder: 'State (TX)', maxlength: '2', style: 'margin:0;max-width:90px;text-transform:uppercase' });
      const miIn = h('input', { class: 'cp-in', type: 'number', placeholder: 'Miles', style: 'margin:0;max-width:110px' });
      const gaIn = h('input', { class: 'cp-in', type: 'number', step: '0.1', placeholder: 'Gallons (opt)', style: 'margin:0;max-width:130px' });
      const add = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        const st = stIn.value.trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(st)) { alert('2-letter state code (e.g. TX).'); return; }
        if (!miIn.value) { alert('Enter miles.'); return; }
        ev.currentTarget.disabled = true;
        try { await iftaSet(qSel.value, st, Number(miIn.value), gaIn.value ? Number(gaIn.value) : null); renderIfta(); }
        catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save');
      mount(iftaCard, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, '⛽ IFTA — state miles'), h('div', { class: 'cp-row-s' }, 'Log miles per state each quarter. Setting a state to 0 removes it. This is your filing worksheet — not tax advice.')]),
          h('div', { style: 'display:flex;gap:8px;align-items:center' }, [qSel,
            h('b', null, Number(d.total_miles || 0).toLocaleString() + ' mi'),
            d.avg_mpg ? h('span', { class: 'cpx-chip' }, d.avg_mpg + ' avg MPG') : null].filter(Boolean)),
        ]),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px' }, [stIn, miIn, gaIn, add]),
        (d.rows && d.rows.length) ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' },
          d.rows.map(r => h('span', { class: 'cpx-chip', title: 'Tap Save with 0 miles to remove', style: 'cursor:pointer', onClick: () => { stIn.value = r.state; miIn.value = r.miles; gaIn.value = r.gallons || ''; } },
            r.state + ' · ' + Number(r.miles).toLocaleString() + ' mi' + (r.gallons ? ' · ' + r.gallons + ' gal' : '')))) : h('div', { class: 'cp-muted' }, 'No states logged for this quarter yet.'),
      ].filter(Boolean));
    }
    qSel.onchange = renderIfta;
    renderIfta();
    // Mobile-first sectioned Finance. No duplicates: the Earnings hub REPLACES the old
    // "Profit & Loss (this month)" and "Per-trip P&L" cards.
    if (!document.getElementById('lb-fin-css')) {
      const st = document.createElement('style'); st.id = 'lb-fin-css';
      st.textContent = '.finnav{display:flex;gap:7px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:2px 0 8px;scrollbar-width:none}.finnav::-webkit-scrollbar{display:none}'
        + '.finnav button{flex:none;white-space:nowrap}'
        + '@media(max-width:640px){.cp-kpis{grid-template-columns:repeat(2,1fr)!important}.cp-grid{display:block!important}.cp-grid>*{margin-bottom:12px}}';
      document.head.appendChild(st);
    }
    const feesChart = h('div', { class: 'cp-card' }, [cardHead('Dispatch fees over time'), series.length ? miniBars(series, { height: 84 }) : h('div', { class: 'cp-muted' }, 'No data yet.')]);
    const statusCard = h('div', { class: 'cp-card' }, [cardHead('Invoice status'), h('div', { class: 'cp-donut-wrap' }, [donut(statusParts), h('div', { class: 'cp-donut-leg' }, statusParts.map(p => h('div', null, [h('i', { style: 'background:' + p.color }), p.label + ' · ' + p.value])))])]);
    // ---- 💸 payments in flight: claim/freight money coming in, fee payments going out ----
    const payFlightCard = h('div', { class: 'cp-card' }, [cardHead('💸 Payments in flight'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let trs; try { trs = await payMyTransfers(); } catch (e) { mount(payFlightCard, [cardHead('💸 Payments in flight'), h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load.')]); return; }
      // 🏦 vs 🏛 — where each payment lands: factor (NOA) or your own bank, per-broker aware
      let fb9 = null; try { fb9 = await carrierFactoringBrokers(); } catch (_) {}
      const dirMap9 = {}; ((fb9 && fb9.brokers) || []).forEach((b9) => { dirMap9[b9.name] = b9.mode; });
      const routeChip9 = (x9) => {
        if (x9.kind === 'platform_fee' || x9.direction === 'outgoing') return null;
        const factOn9 = !!(fb9 && fb9.factoring_on);
        const direct9 = !factOn9 || dirMap9[x9.counterparty] === 'direct';
        return direct9
          ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.13);color:#4ade80;font-weight:800' }, '🏛 lands in YOUR bank (direct)')
          : h('span', { class: 'cp-pill', style: 'background:rgba(139,92,246,.18);color:#c4b5fd;font-weight:800' }, '🏦 goes to ' + ((fb9 && fb9.factoring_company) || 'your factor') + ' (NOA)');
      };
      trs = Array.isArray(trs) ? trs : [];
      // money OWED to you that the broker has not even sent yet (no transfer row)
      let owed9 = []; try { const d9 = await payDueItems(); owed9 = ((d9 && d9.receivables) || []).filter((x9) => !x9.transfer_status); } catch (_) {}
      const open9 = trs.filter((x) => x.status === 'sent');
      const done9 = trs.filter((x) => x.status === 'received').slice(0, 5);
      const owedRow9 = (x9) => {
        const age9 = x9.due_since ? Math.max(0, Math.round((Date.now() - new Date(x9.due_since).getTime()) / 86400000)) : null;
        return h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
          h('div', { style: 'flex:1;min-width:200px' }, [
            h('div', { class: 'cp-row-t' }, '📥 ' + (x9.label || x9.kind) + ' · ' + money(x9.amount)),
            h('div', { class: 'cp-row-s' }, 'From ' + (x9.counterparty || 'broker') + (x9.due_since ? ' · due since ' + new Date(x9.due_since).toLocaleDateString() + (age9 != null ? ' (' + age9 + 'd)' : '') : '') + ' · memo ' + (x9.memo || '')),
          ]),
          h('div', { style: 'display:flex;flex-direction:column;gap:6px;align-items:flex-end' }, [
            h('span', { class: 'cp-pill', style: 'background:rgba(239,68,68,.14);color:#f87171' }, '⏰ awaiting broker payment'),
            routeChip9(x9),
            (x9.kind === 'claim' || x9.kind === 'freight') ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
              try { await payRequestReminder(x9.kind, x9.ref_id); b9.textContent = '✓ Requested'; lbToast('Payment request sent — the broker got a 🔔 + email with the pay panel link.', 'success', '🔔 Requested'); }
              catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent', 'Request'); }
            } }, '🔔 Request payment') : null,
            (age9 != null && age9 >= 3 && (x9.kind === 'claim' || x9.kind === 'freight')) ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev9) => { const b9 = ev9.currentTarget;
              const nt9 = prompt('Dispute non-payment — what happened? (goes to the broker AND LoadBoot support):'); if (!nt9) return;
              b9.disabled = true; try { const r9 = await payDispute(x9.kind, x9.ref_id, nt9); lbToast((r9 && r9.note) || 'Dispute filed.', 'success', 'Dispute filed'); } catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent'); }
            } }, '⚠ Dispute non-payment') : null,
          ].filter(Boolean)),
        ]);
      };
      const row9 = (x) => {
        const dl9 = (x.status === 'sent' && x.expected_by) ? Math.ceil((new Date(x.expected_by).getTime() - Date.now()) / 86400000) : null;
        const eta9 = dl9 == null ? '' : dl9 > 0 ? ('🕐 landing in ~' + dl9 + ' day' + (dl9 > 1 ? 's' : '') + ' (by ' + new Date(x.expected_by).toLocaleDateString() + ')') : '⚠ past the expected date — check your bank, then ✓ or dispute';
        return h('div', { class: 'cp-row', style: 'flex-wrap:wrap' }, [
        h('div', { style: 'flex:1;min-width:200px' }, [
          h('div', { class: 'cp-row-t' }, (x.direction === 'incoming' ? '📥 ' : '📤 ') + (x.label || x.kind) + ' · ' + money(x.amount)),
          h('div', { class: 'cp-row-s' }, (x.direction === 'incoming' ? 'From ' : 'To ') + (x.counterparty || '') + ' · sent ' + (x.sent_at ? new Date(x.sent_at).toLocaleDateString() : '')
            + (x.payment_ref ? ' · ref ' + x.payment_ref : '')),
          x.status === 'sent' ? h('div', { class: 'cp-row-s', style: 'margin-top:2px;font-weight:700;color:' + (dl9 != null && dl9 <= 0 ? '#fbbf24' : '#60a5fa') }, eta9) : null,
          (() => { const c9 = routeChip9(Object.assign({ direction: x.direction }, x)); return c9 ? h('div', { style: 'margin-top:4px' }, c9) : null; })(),
          (x.status === 'sent' && x.receipt_path) ? h('button', { class: 'cp-btn-ghost cp-btn-sm', style: 'margin-top:5px;font-size:.72rem', onClick: async (ev9) => {
            try { const u9 = await signedDocumentUrl(x.receipt_path); window.open(u9, '_blank', 'noopener'); } catch (_) { lbToast('Could not open the receipt.', 'urgent'); }
          } }, '📎 View their receipt') : null,
        ].filter(Boolean)),
        x.status === 'received' ? h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.14);color:#4ade80' }, '✓ received' + (x.received_at ? ' ' + new Date(x.received_at).toLocaleDateString() : ''))
        : x.direction === 'incoming' ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
            try { await payConfirmReceived(x.id); lbToast('Marked received — the payer sees this as settled.', 'success', 'Payment received'); loadFinance(); } catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Failed.', 'urgent'); }
          } }, '✓ I received it')
        : h('span', { class: 'cp-pill', style: 'background:rgba(245,158,11,.16);color:#fbbf24' }, x.kind === 'platform_fee' ? '⏳ LoadBoot verifying' : '⏳ awaiting their ✓'),
      ]); };
      const owedTotal9 = owed9.reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
      mount(payFlightCard, [cardHead('💸 Your money — owed & in flight'),
        owedTotal9 ? h('div', { class: 'cp-row-s', style: 'margin-bottom:4px' }, money(owedTotal9) + ' owed to you — brokers see these as DUE with your bank details and pay through the same receipt procedure.') : null,
        (owed9.length || open9.length || done9.length) ? h('div', null, [...owed9.map(owedRow9), ...open9.map(row9), ...done9.map(row9)])
          : h('div', { class: 'cp-muted' }, 'Nothing owed or in flight. Delivered loads and approved claims appear here the moment money is due — then: on the way → ✓ received.')]);
    })();
    // 📤 QuickBooks / accounting export — CSVs QuickBooks and any bookkeeper can import
    const acctExportCard9 = (() => {
      const from9 = h('input', { class: 'cp-in', type: 'date', style: 'max-width:160px' });
      const to9 = h('input', { class: 'cp-in', type: 'date', style: 'max-width:160px' });
      const msg9 = h('div', { class: 'cp-row-s', style: 'margin-top:6px' });
      const dl9 = (name9, header9, rows9) => {
        const csv9 = [header9.join(',')].concat(rows9.map((r9) => header9.map((h9) => '"' + String(r9[h9.toLowerCase().replace(/ /g, '_')] ?? '').replace(/"/g, '""') + '"').join(','))).join('\n');
        const a9 = document.createElement('a'); a9.href = URL.createObjectURL(new Blob([csv9], { type: 'text/csv' })); a9.download = name9; a9.click();
      };
      return h('div', { class: 'cp-card' }, [cardHead('📤 Accounting export', 'QuickBooks-compatible CSVs — invoices, expenses, payments'),
        h('div', { class: 'cp-row-s', style: 'margin-bottom:8px;line-height:1.6' }, 'Download your books as clean CSVs: revenue (invoices with gross/fee/net), every expense, and confirmed payments. Import directly into QuickBooks (File → Import), Wave, Xero or hand to your accountant.'),
        h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [h('span', { class: 'cp-row-s' }, 'From'), from9, h('span', { class: 'cp-row-s' }, 'to'), to9,
          h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
            try {
              const d9 = await carrierAccountingExport(from9.value || null, to9.value || null);
              dl9('loadboot-invoices.csv', ['Date','Invoice_No','Lane','Gross','Fee','Net','Status','Paid_Date'], d9.invoices || []);
              dl9('loadboot-expenses.csv', ['Date','Category','Amount','Note'], d9.expenses || []);
              dl9('loadboot-payments.csv', ['Date','Kind','Direction','Amount','Ref'], d9.payments || []);
              msg9.textContent = '✓ 3 CSVs downloaded — invoices, expenses, payments.';
            } catch (e9) { msg9.textContent = (e9 && e9.message) || 'Export failed.'; }
            b9.disabled = false;
          } }, '⬇ Export CSVs'), msg9]),
      ]);
    })();
    // ⛽ Fuel card statement import (EFS / Comdata / WEX CSV)
    const fuelImportCard9 = (() => {
      const fIn9 = h('input', { type: 'file', accept: '.csv', style: 'font-size:.85rem' });
      const msg9 = h('div', { class: 'cp-row-s', style: 'margin-top:6px' });
      return h('div', { class: 'cp-card' }, [cardHead('⛽ Fuel card import', 'EFS · Comdata · WEX statement CSV → expenses'),
        h('div', { class: 'cp-row-s', style: 'margin-bottom:8px;line-height:1.6' }, 'Export the transactions CSV from your fuel-card portal and drop it here — each purchase lands as a fuel expense (feeds your P&L and cost-per-mile). Columns auto-detected: date, amount, location.'),
        h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [fIn9,
          h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev9) => { const b9 = ev9.currentTarget;
            const f9 = fIn9.files && fIn9.files[0]; if (!f9) { msg9.textContent = 'Choose the CSV first.'; return; }
            b9.disabled = true;
            try {
              const txt9 = await f9.text();
              const lines9 = txt9.split(/\r?\n/).filter((l9) => l9.trim());
              const head9 = lines9[0].toLowerCase().split(',').map((x9) => x9.replace(/"/g, '').trim());
              const di9 = head9.findIndex((h9) => /date/.test(h9));
              const ai9 = head9.findIndex((h9) => /amount|total|cost/.test(h9));
              const li9 = head9.findIndex((h9) => /location|merchant|site|city|stop/.test(h9));
              if (di9 < 0 || ai9 < 0) throw new Error('Could not find date/amount columns — export the standard transactions CSV from your fuel-card portal.');
              const rows9 = lines9.slice(1).map((l9) => { const c9 = l9.split(','); const d9 = new Date((c9[di9] || '').replace(/"/g, ''));
                return { date: isNaN(d9.getTime()) ? null : d9.toISOString().slice(0, 10), amount: parseFloat(String(c9[ai9] || '').replace(/[^0-9.\-]/g, '')) || null, location: li9 >= 0 ? String(c9[li9] || '').replace(/"/g, '').trim() : null };
              }).filter((r9) => r9.date && r9.amount);
              if (!rows9.length) throw new Error('No usable rows found in that CSV.');
              const r9 = await carrierFuelImport(rows9);
              msg9.textContent = '✓ Imported ' + (r9.imported || 0) + ' fuel purchases — $' + Number(r9.total || 0).toLocaleString() + ' added to expenses.';
              lbToast('Fuel statement imported — your P&L and cost-per-mile just got sharper.', 'success', '⛽ Imported'); loadFinance();
            } catch (e9) { msg9.textContent = (e9 && e9.message) || 'Import failed.'; }
            b9.disabled = false;
          } }, 'Import statement'), msg9]),
      ]);
    })();
    // 🟢 QUICKBOOKS ONLINE — OAuth two-way sync (invoices out, paid-status back)
    function qboCard9() {
      const host9 = h('div', { class: 'cp-card' }, [cardHead('🟢 QuickBooks Online', 'two-way sync'), h('div', { class: 'cp-muted' }, 'Loading…')]);
      (async () => {
        let st9 = null; try { st9 = await qboStatus(); } catch (_) { mount(host9, h('span')); return; }
        const syncBtn9 = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true; b9.textContent = 'Syncing…';
          try {
            const { getClient } = await import('../shared/supabaseClient.js');
            const sb9 = await getClient(); const { data: { session } } = await sb9.auth.getSession();
            const env9 = window.__LB_ENV;
            const r9 = await fetch(env9.supabaseUrl + '/functions/v1/qbo-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env9.supabaseAnonKey, Authorization: 'Bearer ' + session.access_token }, body: '{}' });
            const j9 = await r9.json();
            if (!j9.ok) throw new Error(j9.error || 'Sync failed');
            lbToast('✓ Synced — ' + (j9.note || (j9.invoices + ' invoices, ' + j9.expenses + ' expenses')), 'success', '🟢 QuickBooks'); loadFinance();
          } catch (e9) { lbToast((e9 && e9.message) || 'Sync failed.', 'urgent', 'QuickBooks'); b9.disabled = false; b9.textContent = '🔄 Sync now'; }
        } }, '🔄 Sync now');
        if (st9 && st9.connected) {
          mount(host9, [cardHead('🟢 QuickBooks Online', 'connected'),
            h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
              h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80;font-weight:800' }, '✓ ' + (st9.company || 'Connected')),
              syncBtn9,
            ]),
            h('div', { class: 'cp-row-s', style: 'margin-top:6px;line-height:1.6' }, 'Pushes your delivered-freight invoices (customer = broker) and every expense into QuickBooks, and pulls back which invoices got PAID there. ' + (st9.synced || 0) + ' records synced' + (st9.paid_in_qbo ? ' · ' + st9.paid_in_qbo + ' marked paid in QBO' : '') + (st9.last_sync_note ? ' · last sync: ' + st9.last_sync_note : '') + '.'),
          ]);
        } else {
          mount(host9, [cardHead('🟢 QuickBooks Online', 'two-way sync'),
            h('div', { class: 'cp-row-s', style: 'margin-bottom:8px;line-height:1.65' }, 'Connect once — LoadBoot pushes your freight invoices and expenses straight into QuickBooks and pulls payment status back. No CSVs, no double entry.'),
            h('button', { class: 'cp-btn', style: 'background:#2CA01C', onClick: async (ev9) => { const b9 = ev9.currentTarget; b9.disabled = true;
              try { const u9 = await qboAuthUrl(location.origin + '/app/qbo.html'); location.href = u9.url; }
              catch (e9) { b9.disabled = false; lbToast((e9 && e9.message) || 'Could not start.', 'urgent', 'QuickBooks'); }
            } }, '🟢 Connect QuickBooks'),
          ]);
        }
      })();
      return host9;
    }
    // Accounting = the BOOKS (QuickBooks sync + exports); Taxes = tax centre + IFTA.
    // Promoted out of Taxes so carriers actually find it — zero manual bookkeeping is a headline feature.
    const acctBenefits9 = h('div', { class: 'cp-card', style: 'background:linear-gradient(120deg,rgba(8,131,247,.12),rgba(34,197,94,.08));border:1.5px solid rgba(8,131,247,.35)' }, [
      h('div', { style: 'font-weight:900;font-size:1.02rem;margin-bottom:6px' }, '📒 Your books, done for you'),
      h('div', { class: 'cp-row-s', style: 'line-height:1.7' },
        'Every delivered load becomes an invoice in YOUR QuickBooks automatically. Every expense lands as a Purchase. When the broker pays, paid-status flows back. Zero manual bookkeeping — your accountant gets ready books.'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, [
        h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80;font-weight:800' }, '✓ Invoices auto-push'),
        h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80;font-weight:800' }, '✓ Expenses auto-push'),
        h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80;font-weight:800' }, '✓ Paid-status pull-back'),
        h('span', { class: 'cp-pill', style: 'background:rgba(8,131,247,.15);color:#7cc0ff;font-weight:800' }, '⬇ CSV export for any accountant'),
      ]),
    ]);
    const SECS = [
      ['earn', '💰 Earnings', () => [earningsHub()]],
      ['in',   '📥 Money in', () => [payFlightCard, cashCard(rows), statusCard, stmtCard]],
      ['cost', '📤 Costs',    () => [fuelImportCard9, expCard, feesChart]],
      ['acct', '📒 Accounting', () => [acctBenefits9, qboCard9(), acctExportCard9]],
      ['tax',  '🧾 Taxes',    () => [taxCenter(), iftaCard]],
      ['pay',  '👥 Payroll',  () => [payrollCard]],
    ];
    let sec = 'earn';
    try { if (window.__finSec9) { sec = window.__finSec9; window.__finSec9 = null; } } catch (_) {}
    const secHost = h('div');
    const nav = h('div', { class: 'finnav' });
    const paint = () => {
      mount(nav, SECS.map(([k, lbl]) => h('button', { class: 'cp-btn cp-btn-sm ' + (sec === k ? '' : 'ghost'), onClick: () => { sec = k; paint(); } }, lbl)));
      const f = SECS.find(x => x[0] === sec);
      mount(secHost, h('div', null, f ? f[2]() : []));
    };
    paint();
    mount(content, h('div', null, [
      nav,
      secHost,
      factoringCard9,
      h('div', { class: 'cp-card' }, [cardHead('🧾 LoadBoot fee invoices', 'the flat 5% dispatch fee — nothing else'),
        h('div', { style: 'background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:11px;padding:10px 13px;margin-bottom:10px' }, [
          h('div', { class: 'cp-row-s', style: 'line-height:1.7' }, 'What these are: every time a load DELIVERS, LoadBoot auto-issues an invoice for its flat 5% service fee (e.g. $1,175 gross → $59). This is the ONLY thing you ever pay LoadBoot — broker freight money is separate and tracked under 📥 Money in. DUE = pay within 15 days (💳 Pay now → transfer to the details shown → attach receipt → LoadBoot verifies → PAID). Factored carriers: this fee comes from YOUR account, not your factor.'),
        ]),
        rows.length ? h('div', null, rows.map(i => {
        const dw = h('div');
        const packetBtn9 = i.trip_id ? h('button', { class: 'cp-btn-ghost cp-btn-sm', style: 'margin:4px 6px 0 0;font-size:.74rem', onClick: async () => {
          let pk9; try { pk9 = await carrierFactoringPacket(i.trip_id); } catch (e9) { lbToast((e9 && e9.message) || 'Could not load the packet.', 'urgent', 'Packet'); return; }
          const li9 = (t9) => h('div', { class: 'cp-row-s', style: 'padding:3px 0;line-height:1.6' }, t9);
          openModal('📦 Factoring packet — ' + ((pk9.trip && pk9.trip.origin) || '') + ' → ' + ((pk9.trip && pk9.trip.destination) || ''), [
            pk9.factor ? h('div', { style: 'background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.35);border-radius:11px;padding:10px 13px;margin-bottom:10px' }, [
              h('b', null, '🏦 ' + (pk9.factor.company || 'Your factor') + (pk9.factor.noa_status === 'verified' ? ' · NOA verified ✓' : ' · NOA ' + (pk9.factor.noa_status || ''))),
              li9('Send the bundle to: ' + (pk9.factor.remittance_email || 'your factor') + (pk9.factor.advance_pct ? ' · advance ~' + pk9.factor.advance_pct + '%' : '') + ' · broker pays them in ' + (pk9.factor.terms_days_broker || '30') + ' days'),
            ]) : h('div', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'No factoring on file — this packet works for direct billing too.'),
            (pk9.missing && pk9.missing.length) ? h('div', { style: 'background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);border-radius:11px;padding:10px 13px;margin-bottom:10px' },
              [h('b', { style: 'color:#fbbf24' }, '⚠ Still needed for funding'), ...pk9.missing.map((m9) => li9('• ' + m9))]) : h('div', { class: 'cp-pill', style: 'background:rgba(34,197,94,.15);color:#4ade80;font-weight:800;margin-bottom:10px' }, '✅ Packet complete — fund-ready'),
            h('b', null, 'In this packet (collected automatically during the trip):'),
            li9('🧾 Invoice ' + ((pk9.invoice && pk9.invoice.invoice_no) || '—') + (pk9.invoice ? ' · $' + Number(pk9.invoice.gross || 0).toLocaleString() : '')),
            li9('✍ Executed rate confirmation: ' + (pk9.rate_confirmation ? 'on file (signed by the broker' + (pk9.rate_confirmation.submitted_at ? ' ' + new Date(pk9.rate_confirmation.submitted_at).toLocaleDateString() : '') + ')' : 'not yet')),
            ...(((pk9.documents || []).length ? pk9.documents : []).map((d9) => li9('📄 ' + (d9.kind || '').replace(/_/g, ' ').toUpperCase() + ' — ' + (d9.file_name || '') + ' · ' + new Date(d9.uploaded_at).toLocaleDateString() + ' (open it from the trip\u2019s documents)'))),
            li9('🛰 GPS proof: ' + ((pk9.gps_proof && pk9.gps_proof.note) || '')),
            h('div', { class: 'cp-row-s', style: 'margin-top:10px;background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:10px;padding:9px 12px;line-height:1.65' }, pk9.how_to_fund || ''),
          ]);
        } }, '📦 Factoring packet') : null;
        const dispute = (i.status === 'sent' || i.status === 'paid') ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
          if (dw.firstChild) { dw.innerHTML = ''; return; }
          const reason = h('input', { class: 'cp-in', placeholder: 'Reason for dispute' });
          const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { if (!reason.value.trim()) { alert('Enter a reason.'); return; } ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…'; try { await pocketDisputeInvoice(i.id, reason.value.trim()); dw.innerHTML = ''; dw.appendChild(h('div', { class: 'cp-row-s', style: 'color:var(--lb-green)' }, '✓ Dispute opened')); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send'; alert((e && e.message) || 'Could not dispute.'); } } }, 'Send');
          dw.appendChild(h('div', { class: 'cp-inlineform' }, [reason, send]));
        } }, 'Dispute') : null;
        const invPdf = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7', onClick: () => openInvoicePdf(Object.assign({}, i, { __carrier: window.__lbOrgName || 'Your company', __email: (typeof user !== 'undefined' && user && user.email) || '' })) }, '⬇ PDF');
        const payFee = i.status === 'sent' ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a', onClick: async () => {
          if (dw.firstChild) { dw.innerHTML = ''; return; }
          dw.appendChild(h('div', { class: 'cp-muted' }, 'Loading payment instructions…'));
          let pi; try { pi = await payInstructions('platform_fee', i.id); } catch (e9) { dw.innerHTML = ''; dw.appendChild(h('div', { class: 'cp-row-s' }, (e9 && e9.message) || 'Failed.')); return; }
          dw.innerHTML = '';
          const tr9 = pi && pi.transfer;
          if (tr9 && tr9.status === 'sent') { dw.appendChild(h('div', { class: 'cp-pill', style: 'background:rgba(245,158,11,.16);color:#fbbf24;margin-top:6px' }, '⏳ Receipt uploaded — LoadBoot is verifying. This invoice flips to PAID once confirmed.')); return; }
          const refIn = h('input', { class: 'cp-in', placeholder: 'Transfer reference / confirmation #' });
          const fIn = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.85rem;margin-top:6px' });
          const msg9 = h('div', { class: 'cp-row-s', style: 'margin-top:4px' });
          const sendB = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:6px', onClick: async (ev9) => { const b9 = ev9.currentTarget;
            const f9 = fIn.files && fIn.files[0]; if (!f9) { msg9.textContent = 'Attach the payment receipt/screenshot first — that is what LoadBoot verifies.'; return; }
            b9.disabled = true; b9.textContent = 'Sending…';
            try {
              const m9 = await uploadDocument(f9, 'payment_receipt');
              await payMarkSent({ kind: 'platform_fee', ref: i.id, receiptPath: m9.path, receiptName: m9.fileName, paymentRef: refIn.value.trim() || null, method: 'bank_transfer' });
              lbToast('Receipt sent — LoadBoot verifies it and marks the invoice paid.', 'success', 'Payment submitted'); loadFinance();
            } catch (e9) { b9.disabled = false; b9.textContent = 'I have paid — submit receipt'; msg9.textContent = (e9 && e9.message) || 'Failed.'; }
          } }, 'I have paid — submit receipt');
          // PREMIUM pay panel: remit card + copyable memo pill + 1-2-3 steps
          const insTxt9 = (pi.payee_bank && pi.payee_bank.instructions) || '';
          const parts9 = insTxt9.split(/\n\s*RULES\s*\n/i);
          const remit9 = (parts9[0] || '').trim(); const rules9 = (parts9[1] || '').trim();
          const memoPill9 = h('button', { class: 'cp-pill', style: 'background:#FC5305;color:#fff;font-weight:900;letter-spacing:.04em;cursor:pointer;border:0;font-size:.9rem;padding:7px 16px', title: 'Tap to copy', onClick: (ev9) => { try { navigator.clipboard.writeText(i.invoice_no || ''); ev9.currentTarget.textContent = '✓ copied — ' + (i.invoice_no || ''); } catch (_) {} } }, i.invoice_no || '');
          const step9 = (n9, t9, s9) => h('div', { style: 'flex:1;min-width:140px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:9px 11px' }, [
            h('div', { style: 'font-weight:900;color:#60a5fa;font-size:.78rem' }, n9 + ' · ' + t9),
            h('div', { class: 'cp-row-s', style: 'margin-top:2px;line-height:1.5' }, s9)]);
          dw.appendChild(h('div', { style: 'margin-top:8px;border:1px solid rgba(255,255,255,.14);border-radius:16px;overflow:hidden' }, [
            h('div', { style: 'background:linear-gradient(120deg,#10223B,#0d2f56);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
              h('div', null, [h('div', { style: 'font-weight:900;color:#fff' }, '💳 Pay LoadBoot'), h('div', { style: 'font-size:.72rem;color:#9fb0cc' }, 'flat 5% dispatch fee · net 15')]),
              h('div', { style: 'font-size:1.5rem;font-weight:900;color:#fff' }, money(pi.amount || i.fee || 0)),
            ]),
            h('div', { style: 'padding:12px 16px' }, [
              h('div', { style: 'background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:12px;padding:10px 13px' }, [
                h('div', { style: 'font-weight:800;font-size:.78rem;letter-spacing:.06em;color:#93c5fd;margin-bottom:4px' }, '🏛 REMIT-TO'),
                h('div', { class: 'cp-row-s', style: 'white-space:pre-wrap;line-height:1.8;font-family:ui-monospace,Menlo,monospace;font-size:.8rem;user-select:all' }, remit9 || 'Payment instructions are being finalised — contact billing@loadboot.com.'),
              ]),
              h('div', { style: 'display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap' }, [
                h('span', { class: 'cp-row-s', style: 'font-weight:800' }, 'Transfer memo (required — tap to copy):'), memoPill9,
              ]),
              h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px' }, [
                step9('1', 'Transfer', 'ACH 1–3 business days · wires same day'),
                step9('2', 'Receipt', 'attach the screenshot/PDF below'),
                step9('3', 'PAID', 'LoadBoot verifies — usually same business day'),
              ]),
              rules9 ? h('details', { style: 'margin-bottom:8px' }, [h('summary', { class: 'cp-row-s', style: 'cursor:pointer;font-weight:700' }, '📖 Payment rules'), h('div', { class: 'cp-row-s', style: 'white-space:pre-wrap;line-height:1.7;margin-top:4px' }, rules9)]) : null,
              h('div', { class: 'cp-inlineform' }, [refIn]), fIn, sendB, msg9,
            ].filter(Boolean)),
          ]));
        } }, '💳 Pay now') : null;
        return h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, i.invoice_no), h('div', { class: 'cp-row-s' }, 'Fee ' + money(i.fee) + ' · gross ' + money(i.gross))]), pill(i.status)]), h('div', { class: 'cp-trip-actions' }, [invPdf, packetBtn9, payFee, dispute].filter(Boolean)), dw].filter(Boolean));
      })) : h('div', { class: 'cp-muted' }, 'No invoices yet.')]),
    ]));
  }

  /* ----- Documents & compliance ----- */
  const DOC_TYPES = [['insurance', 'Insurance / COI'], ['authority', 'Operating authority'], ['w9', 'W-9'], ['noa', '🏦 Factoring NOA (Notice of assignment)'], ['agreement', 'Signed agreement'], ['hazmat_reg', 'PHMSA Hazmat Registration'], ['hazmat_h', 'CDL Hazmat (H) Endorsement'], ['hazmat_coi', 'Hazmat Insurance COI'], ['rate_con', 'Rate confirmation'], ['bol', 'Bill of lading'], ['pod', 'Proof of delivery'], ['bank_check', 'Bank verification (voided check / letter)'], ['other', 'Other']];
  // Format enforcement: agent/IRS-issued documents MUST be the original PDF —
  // screenshots get rejected by brokers and factoring. Field paperwork may be a clear photo.
  const DOC_FMT = {
    insurance: { exts: ['pdf'], label: 'PDF only — the certificate your agent emails you (screenshots are rejected)' },
    w9:        { exts: ['pdf'], label: 'PDF only — the signed IRS form (not a photo of the screen)' },
    agreement: { exts: ['pdf'], label: 'PDF only — the signed agreement document' },
    noa:       { exts: ['pdf'], label: 'PDF only — factoring company letter' },
    rate_con:  { exts: ['pdf'], label: 'PDF only' },
    authority: { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'PDF preferred, or a CLEAR photo of the authority letter' },
    bol:       { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'PDF or clear photo' },
    pod:       { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'PDF or clear photo' },
    hazmat_reg: { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'PDF preferred \u2014 your PHMSA registration certificate (a CLEAR photo of the printed certificate is accepted)' },
    hazmat_h:   { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'CLEAR photo of the CDL showing the H endorsement (PDF scan also accepted)' },
    hazmat_coi: { exts: ['pdf'], label: 'PDF only \u2014 the hazmat-level COI your insurance agent emails you (screenshots are rejected)' },
    bank_check: { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'Voided check or bank letter \u2014 PDF or a CLEAR photo' },
    mcs150: { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'MCS-150 filing copy \u2014 PDF or clear photo' },
    safety: { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'FMCSA safety rating letter \u2014 PDF or clear photo' },
    other:     { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], label: 'PDF or clear photo' },
  };
  const docFmt = (t) => DOC_FMT[t] || DOC_FMT.other;
  const extOf = (f) => (f && f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '');
  async function loadDocuments() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let c; try { c = await pocketCompliance(); } catch (e) { c = { requirements: [] }; }
    const reqs = (c && c.requirements) || [];
    let allDocs = []; try { allDocs = await carrierListDocuments(); } catch (_) { allDocs = []; }
    const latestDoc = (t) => (allDocs || []).find(d => d.type === t) || null; // list is newest-first
    const listWrap = h('div');
    // 🏦 factoring active but NOA letter not uploaded yet → loud reminder at the top
    let noaBanner9 = null;
    try {
      const pp9 = await myPaymentProfile();
      if (pp9 && pp9.factoring_noa && !latestDoc('noa')) {
        noaBanner9 = h('div', { class: 'cp-card', style: 'border:1.5px solid rgba(139,92,246,.5);background:rgba(139,92,246,.08);margin-bottom:12px' }, [
          h('div', { style: 'font-weight:900' }, '🏦 Upload your factor\u2019s NOA letter'),
          h('div', { class: 'cp-row-s', style: 'margin-top:4px;line-height:1.65' }, 'You activated factoring with ' + (pp9.factoring_company || 'your factor') + ' but the Notice of Assignment letter is not on file yet. Get the PDF from your factoring company, then upload it below with type \u201C🏦 Factoring NOA\u201D \u2014 LoadBoot verifies it against your remit-to details and brokers see \u201Cverified\u201D on every pay panel.'),
        ]);
      }
    } catch (_) {}
    // 📷 Scan to PDF — camera pages -> one PDF, fully offline, no external service.
    let scanPages = [];
    const scanPrev = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' });
    const scanIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
    const scanStatus = h('div', { class: 'cp-row-s' });
    const renderScan = () => {
      scanPrev.innerHTML = '';
      scanPages.forEach((f, i) => {
        const u = URL.createObjectURL(f);
        scanPrev.appendChild(h('div', { style: 'position:relative' }, [
          h('img', { src: u, style: 'width:74px;height:98px;object-fit:cover;border-radius:8px;border:1px solid var(--lb-border, #e2e8f0)' }),
          h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'position:absolute;top:-8px;right:-8px;padding:1px 7px;border-radius:99px', onClick: () => { scanPages.splice(i, 1); renderScan(); } }, '✕'),
        ]));
      });
      scanStatus.textContent = scanPages.length ? (scanPages.length + ' page(s) ready') : '';
    };
    scanIn.onchange = () => { if (scanIn.files && scanIn.files[0]) { scanPages.push(scanIn.files[0]); scanIn.value = ''; renderScan(); } };
    const scanCard = h('div', { class: 'cp-card', style: 'margin-bottom:12px' }, [
      h('div', { class: 'cp-row-t' }, '📷 Scan to PDF'),
      h('div', { class: 'cp-row-s' }, 'Photograph BOL / receipts / permits page by page — get one clean PDF to upload anywhere. Works offline.'),
      h('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
        h('button', { class: 'cp-btn cp-btn-sm', onClick: () => scanIn.click() }, '+ Add page (camera)'),
        h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => {
          if (!scanPages.length) { alert('Add at least one page first.'); return; }
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Building…';
          try {
            const blob = await imagesToPdf(scanPages);
            downloadBlob(blob, 'loadboot-scan-' + new Date().toISOString().slice(0, 10) + '.pdf');
            scanPages = []; renderScan(); scanStatus.textContent = '✓ PDF saved to your downloads — upload it below or in your trip.';
          } catch (e) { alert((e && e.message) || 'Could not build PDF.'); }
          ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Make PDF';
        } }, 'Make PDF'),
        scanIn,
      ]),
      scanPrev, scanStatus,
    ]);
    // upload form
    const typeSel = h('select', { class: 'cp-in' }, DOC_TYPES.map(([v, l]) => h('option', { value: v }, l)));
    const fmtLine = h('div', { class: 'cp-row-s', style: 'font-weight:700;color:#b45309' });
    const fileIn = h('input', { class: 'cp-in', type: 'file' });
    const applyFmt = () => { const r = docFmt(typeSel.value); fileIn.accept = r.exts.map(e => '.' + e).join(','); fmtLine.textContent = '📌 Required format: ' + r.label; };
    typeSel.onchange = applyFmt; applyFmt();
    const msg = h('div', { class: 'cp-err' });
    const up = h('button', { class: 'cp-btn', onClick: async () => {
      const f = fileIn.files && fileIn.files[0];
      msg.textContent = ''; msg.className = 'cp-err';
      if (!f) { msg.textContent = 'Choose a file first.'; return; }
      // DUPLICATE GUARD: same type already pending review → stop the re-upload spiral
      const dup9 = (allDocs || []).find((d9) => d9.type === typeSel.value && d9.status === 'pending');
      if (dup9 && !confirm('A ' + (DOC_TYPES.find((t9) => t9[0] === typeSel.value) || ['', typeSel.value])[1] + ' is ALREADY uploaded and in review (' + (dup9.file_name || '') + ') — you do NOT need to send it again.\n\nUpload another copy anyway?')) {
        msg.className = 'cp-err ok'; msg.textContent = '✓ Already in review — no need to re-upload. LoadBoot verifies it, usually within a few hours.';
        return;
      }
      up.disabled = true; up.textContent = 'Uploading…';
      try {
        const rule = docFmt(typeSel.value);
        if (!rule.exts.includes(extOf(f))) {
          msg.className = 'cp-err';
          msg.textContent = 'This document must be ' + (rule.exts.length === 1 ? rule.exts[0].toUpperCase() : rule.exts.map(e => e.toUpperCase()).join('/')) + ' — ' + rule.label + '. Tip: use 📷 Scan to PDF above to turn photos into a proper PDF.';
          up.disabled = false; up.textContent = 'Upload';
          return;
        }
        const meta = await uploadDocument(f, typeSel.value);
        await carrierUploadDocument({ type: typeSel.value, fileName: meta.fileName, filePath: meta.path });
        fileIn.value = ''; msg.className = 'cp-err ok'; msg.textContent = '✓ Uploaded — in review. You will NOT be asked again; track it right here.';
        lbToast('✓ Document received — status is IN REVIEW. No need to upload it again.', 'success', 'Uploaded');
        // factored-but-not-set-up: NOA letter without a factoring profile can't route broker payments
        if (typeSel.value === 'noa') {
          try { const pp9 = await myPaymentProfile(); if (!(pp9 && pp9.factoring_noa)) lbToast('You uploaded a factoring NOA but factoring is NOT set up yet — go to Finance → 🏦 Factoring and add your factor\u2019s remit-to details, otherwise brokers still see your own bank.', 'action', '🏦 One more step'); } catch (_) {}
        }
        try { loadDocuments(); return; } catch (_) {}
        await loadList();
      } catch (e) { msg.className = 'cp-err'; msg.textContent = (e && e.message) || 'Upload failed.'; }
      up.disabled = false; up.textContent = 'Upload document';
    } }, 'Upload document');
    // A6 — urgency-highlighted needs: every requirement carries a tone from the GLOBAL colour tokens
    // (urgent = red: required + missing/expired/rejected; action = blue: required + under review;
    // warning = amber: expiring within 30 days or optional gap; success = green: valid).
    const reqTone = (r) => {
      const st = (r.status || '').toLowerCase();
      const days = r.expiry_date ? Math.floor((new Date(r.expiry_date) - Date.now()) / 86400000) : null;
      if (st === 'valid' && days !== null && days <= 30) return { t: 'warning', why: days < 0 ? 'expired ' + (-days) + 'd ago' : 'expires in ' + days + 'd' };
      if (st === 'valid') return { t: 'success', why: r.expiry_date ? 'valid until ' + r.expiry_date : 'on file' };
      if (r.mandatory && (st === 'missing' || st === 'expired' || st === 'rejected')) return { t: 'urgent', why: st === 'missing' ? 'required — not on file' : 'required — ' + st };
      if (r.mandatory) return { t: 'action', why: 'under review' };
      return { t: 'warning', why: st || 'recommended' };
    };
    const needAttention = reqs.filter(r => reqTone(r).t === 'urgent').length;
    // Clicking a requirement opens the upload dialog with the right document type pre-selected.
    const reqDocType = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('insurance') || n.includes('liability') || n.includes('coi')) return 'insurance';
      if (n.includes('authority') || n.includes('mc/dot') || n.includes('mcs-150')) return 'authority';
      if (n.includes('w-9') || n.includes('w9')) return 'w9';
      if (n.includes('assignment') || n.includes('noa')) return 'noa';
      if (n.includes('agreement')) return 'agreement';
      return 'other';
    };
    const uploadFor = (r) => {
      // Two-phase submit (owner spec): choose file → SEE it on the spot → 'Submit for review'.
      // While it is in review the requirement is LOCKED (no replace) until a decision comes back.
      const t = r.doc_type || reqDocType(r.name);
      const typeSel2 = h('select', { class: 'cp-in' }, DOC_TYPES.map(([v, l]) => h('option', { value: v, selected: v === t ? 'selected' : null }, l)));
      const fileIn2 = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx' });
      const prev2 = h('div', { style: 'margin:8px 0;display:none' });
      const msg2 = h('div', { class: 'cp-err' });
      const upBtn = h('button', { class: 'cp-btn', style: 'margin-top:10px', disabled: true, onClick: async (ev) => {
        const file = fileIn2.files && fileIn2.files[0];
        msg2.textContent = ''; msg2.className = 'cp-err';
        if (!file) { msg2.textContent = 'Choose a file first.'; return; }
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Submitting…';
        try {
          const meta = await uploadDocument(file, typeSel2.value);
          await carrierUploadDocument({ type: typeSel2.value, fileName: meta.fileName, filePath: meta.path });
          msg2.className = 'cp-err ok'; msg2.textContent = '✓ Submitted — status is now IN REVIEW. You cannot change it until the review decision.';
          setTimeout(() => { close2(); loadDocuments(); }, 900);
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Submit for review'; msg2.className = 'cp-err'; msg2.textContent = (e && e.message) || 'Upload failed.'; }
      } }, 'Submit for review');
      fileIn2.onchange = () => {
        prev2.innerHTML = ''; upBtn.disabled = true;
        const f = fileIn2.files && fileIn2.files[0]; if (!f) { prev2.style.display = 'none'; return; }
        prev2.style.display = 'block';
        const kb = Math.max(1, Math.round(f.size / 1024));
        if (/^image\//.test(f.type)) {
          prev2.appendChild(h('img', { src: URL.createObjectURL(f), style: 'max-width:100%;max-height:220px;border-radius:12px;border:1px solid var(--lb-border, #e2e8f0);display:block' }));
        } else {
          prev2.appendChild(h('div', { style: 'display:flex;align-items:center;gap:10px;border:1px solid var(--lb-border, #e2e8f0);border-radius:12px;padding:10px 12px' }, [
            h('span', { html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0883F7" stroke-width="1.8"><path d="M6 2h9l5 5v15H6zM14 2v6h6"/></svg>', style: 'line-height:0' }),
            h('div', null, [h('div', { style: 'font-weight:800;font-size:13px' }, f.name), h('div', { class: 'cp-row-s' }, (f.type || 'file') + ' · ' + kb + ' KB')]),
          ]));
        }
        prev2.appendChild(h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'Check the preview — this exact file goes to review.'));
        upBtn.disabled = false;
      };
      const close2 = openModal('Submit — ' + r.name, [
        h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'PDF or photo, up to 25 MB. Choose the file, check the preview, then submit. While in review it is locked — you can change it again only after a decision.'),
        typeSel2, fileIn2, prev2, msg2, upBtn,
      ]);
    };
    const verifyAuthority = (r) => {
      const mcIn = h('input', { class: 'cp-in', placeholder: 'MC number (e.g. 1234567)' });
      const dotIn = h('input', { class: 'cp-in', placeholder: 'USDOT number (e.g. 3456789)' });
      const res = h('div', { style: 'margin-top:10px' });
      const msg = h('div', { class: 'cp-err' });
      const vbtn = h('button', { class: 'cp-btn', style: 'background:linear-gradient(135deg,#0e7490,#06b6d4)', onClick: async (ev) => {
        const mc = mcIn.value.trim(), dot = dotIn.value.trim();
        if (!mc && !dot) { msg.className = 'cp-err'; msg.textContent = 'Enter your MC or DOT number.'; return; }
        _vb.disabled = true; _vb.textContent = 'Verifying with FMCSA\u2026'; msg.textContent = '';
        try {
          const d = await fmcsaVerify({ mc: mc || null, dot: dot || null });
          const g = (k) => { const cc = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); for (const src of [d, d && d.result, d && d.carrier]) { if (src && src[k] != null) return src[k]; if (src && src[cc] != null) return src[cc]; } return null; };
          mount(res, h('div', { class: 'cp-card', style: 'margin-top:8px' }, [
            h('div', { class: 'cp-row' }, [h('span', null, 'Authority'), h('b', null, String(g('authority_status') || g('authority') || g('operating_status') || g('allowed_to_operate') || 'checked'))]),
            h('div', { class: 'cp-row' }, [h('span', null, 'Safety rating'), h('span', null, String(g('safety_rating') || 'none'))]),
            h('div', { class: 'cp-row' }, [h('span', null, 'Out of service'), h('span', null, String(g('out_of_service') != null ? g('out_of_service') : 'No'))]),
            h('div', { class: 'cp-row-s' }, 'Live from FMCSA (SAFER/QCMobile) via MC/DOT \u2014 nothing to upload for this verification.'),
          ]));
          msg.className = 'cp-err ok'; msg.textContent = '\u2713 FMCSA verified \u2014 sent to your dispatcher for approval.';
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Verify with FMCSA'; msg.className = 'cp-err'; msg.textContent = (e && e.message) || 'FMCSA verification failed \u2014 try again or upload the authority letter instead.'; }
      } }, 'Verify with FMCSA');
      const upl = h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:8px', onClick: () => uploadFor(r) }, 'Or upload authority letter (PDF) instead');
      openModal('Operating authority \u2014 verify with FMCSA', [
        h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'Enter EITHER your MC or your USDOT \u2014 one is enough. We verify it live from FMCSA; nothing to upload for this verification step.'),
        mcIn, dotIn, vbtn, msg, res, upl,
      ]);
    };
    const changeDoc = (r) => {
      const critical = r.mandatory && /authorit|insur|coi|mc\/dot|mcs-?150/i.test(r.name || '');
      const impact = critical
        ? 'This is a REQUIRED document. Changing it sends your account back to PENDING and pauses booking until the Command Center re-approves the new file.'
        : (r.mandatory ? 'This document will go back to In review. Keep it current to avoid a booking pause.' : 'This optional document will go back to In review \u2014 your booking stays open.');
      if (!confirm('Change \u201C' + r.name + '\u201D?\n\n' + impact + '\n\nContinue?')) return;
      if ((r.doc_type === 'authority') || /authorit|mc\/dot/i.test(r.name || '')) verifyAuthority(r); else uploadFor(r);
    };
    const reqRow = (r) => {
      const k = reqTone(r); const tone = toneOf(k.t);
      // FIX: requirements often carry no doc_type — resolve via the same name→type map the
      // upload dialog uses, so a fresh upload immediately shows as Uploaded → In review.
      const d = latestDoc(r.doc_type || reqDocType(r.name)) || null;
      const fdate = (x) => x ? new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + new Date(x).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
      // Amazon-style verification tracker: Uploaded → In review → Approved (or Rejected w/ reason)
      const stateIdx = r.status === 'valid' ? 3 : r.status === 'rejected' ? 2 : (r.status === 'pending' || d) ? 2 : 0;
      const rejected = r.status === 'rejected' || (d && d.status === 'rejected');
      const STEPS = [['Uploaded', d ? fdate(d.created_at) : null], ['In review', stateIdx >= 2 && !rejected && r.status !== 'valid' ? 'dispatch team — usually a few hours' : (rejected ? fdate(d && d.reviewed_at) : null)], [rejected ? 'Rejected' : 'Approved', r.status === 'valid' ? fdate(d && d.reviewed_at) || '✓' : null]];
      const stepper = stateIdx > 0 ? h('div', { style: 'display:flex;gap:6px;margin:9px 0 2px' }, STEPS.map(([lbl, sub], si) => {
        const on = si < stateIdx; const isLast = si === 2;
        const colr = isLast && rejected && on ? '#dc2626' : on ? (isLast && r.status === 'valid' ? '#16a34a' : '#0883F7') : '#e2e8f0';
        return h('div', { style: 'flex:1;text-align:center' }, [
          h('div', { style: 'height:5px;border-radius:99px;background:' + colr }),
          h('div', { style: 'font-size:10px;margin-top:4px;font-weight:' + (on ? '800' : '500') + ';color:' + (on ? colr : '#94a3b8') }, lbl),
          sub ? h('div', { style: 'font-size:9px;color:#94a3b8' }, sub) : null,
        ].filter(Boolean));
      })) : null;
      const note = rejected && d && d.review_note ? h('div', { style: 'margin-top:6px;border-radius:9px;padding:8px 11px;background:rgba(220,38,38,.08);color:#b91c1c;font-size:12px;font-weight:700' }, '✕ Reason: ' + d.review_note) : null;
      // Owner spec: LOCKED while in review — no replace until a decision comes back.
      const inReview = stateIdx >= 2 && !rejected && r.status !== 'valid';
      const actionable = r.status !== 'valid' && !inReview;
      const btnLabel = rejected ? 'Resubmit' : 'Upload';
      const isAgr = (r.doc_type === 'dispatch_agreement') || /dispatch service agreement/i.test(r.name || '');
      const _agrCarrier = (c && c.carrier) || '';
      const signAgr = () => import('./dispatch-agreement.js').then((m) => m.openSignModal({ openModal: openModal, toast: (msg) => lbToast(msg, 'success', 'Agreement') }, { carrier: _agrCarrier }, () => loadDocuments()));
      const dlAgr = async () => { let sig = {}; try { sig = (await carrierAgreementSignature()) || {}; } catch (_) {} const m = await import('./dispatch-agreement.js'); m.printExecutedAgreement({ carrier: _agrCarrier, signer: (sig && sig.signer_name) || '', date: (sig && sig.signed_date) || '', approved: r.status === 'valid' }); };
      const isW9 = (r.doc_type === 'w9') || r.requirement_key === 'w9' || /\bw-?9\b/i.test(r.name || '');
      const startW9 = () => import('./w9-form.js').then((m) => m.openW9Wizard({ openModal: openModal, toast: (msg) => lbToast(msg, 'success', 'W-9') }, { carrier: _agrCarrier }, () => loadDocuments()));
      const dlW9 = async () => { let w = {}; try { w = (await carrierW9()) || {}; } catch (_) {} const m = await import('./w9-form.js'); m.printExecutedW9(Object.assign({}, w, { approved: r.status === 'valid' })); };
      return h('div', { class: 'cp-row', style: 'border-left:4px solid ' + (rejected ? '#dc2626' : tone.c) + ';padding-left:10px;border-radius:8px;flex-direction:column;align-items:stretch;gap:0' }, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, r.name), h('div', { class: 'cp-row-s' }, (r.mandatory ? 'Required' : 'Optional') + (d ? ' · ' + (d.file_name || '') : ' · ' + k.why))]),
          h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
            h('span', { class: 'cp-pill', style: 'background:' + (rejected ? 'rgba(220,38,38,.1)' : tone.bg) + ';color:' + (rejected ? '#b91c1c' : tone.c) }, rejected ? 'Rejected' : r.status === 'valid' ? 'Approved ✓' : stateIdx >= 2 ? 'In review' : tone.label),
            isAgr
              ? (r.status === 'valid' ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: dlAgr }, 'Download') : (inReview ? null : h('button', { class: 'cp-btn cp-btn-sm', onClick: signAgr }, 'Sign')))
              : isW9
              ? (r.status === 'valid' ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: dlW9 }, 'Download') : (inReview ? null : h('button', { class: 'cp-btn cp-btn-sm', onClick: startW9 }, 'Start your W-9')))
              : (actionable ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => uploadFor(r) }, btnLabel) : (r.status === 'valid' ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => changeDoc(r) }, 'Change') : null)),
          ].filter(Boolean)),
        ]),
        stepper, note,
      ].filter(Boolean));
    };
    // 🏦 factoring active → NOA becomes a FIRST-CLASS requirement card (tracker + Upload/Resubmit)
    try {
      const ppN9 = await myPaymentProfile();
      if (ppN9 && ppN9.factoring_noa && !reqs.some((r9) => r9.doc_type === 'noa' || /assignment/i.test(r9.name || ''))) {
        const nd9 = latestDoc('noa');
        reqs.push({ name: '🏦 Factoring NOA (Notice of Assignment) — ' + (ppN9.factoring_company || 'your factor'), doc_type: 'noa', mandatory: true,
          status: nd9 ? (nd9.status === 'approved' ? 'valid' : nd9.status === 'rejected' ? 'rejected' : 'pending') : 'missing' });
      }
    } catch (_) {}
    const sorted = reqs.slice().sort((a, b) => ({ urgent: 0, action: 1, warning: 2, success: 3 }[reqTone(a).t] - { urgent: 0, action: 1, warning: 2, success: 3 }[reqTone(b).t]));
    mount(content, h('div', null, [noaBanner9, scanCard, 
      h('div', { class: 'cp-card' }, [cardHead('What LoadBoot needs from you',
          c && c.mandatory_ok && !needAttention ? 'All required documents are in ✓'
            : (needAttention ? needAttention + ' required item' + (needAttention > 1 ? 's' : '') + ' need' + (needAttention > 1 ? '' : 's') + ' attention' : 'Some documents still needed')),
        sorted.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, sorted.map(reqRow)) : h('div', { class: 'cp-muted' }, 'No requirements listed.')]),
      h('div', { class: 'cp-card' }, [cardHead('Upload an extra document', 'Anything not listed above \u2014 permits, lease agreements, references'), h('p', { class: 'cp-row-s', style: 'margin-bottom:6px' }, 'PDF or photo, up to 25 MB. Stored privately; only you and LoadBoot staff can see it.'), typeSel, fmtLine, fileIn, msg, up]),
      h('div', { class: 'cp-card' }, [cardHead('My uploads \u2014 review status', 'Every file you sent, incl. plan-of-action attachments'), listWrap]),
    ]));
    async function loadList() {
      mount(listWrap, h('div', { class: 'cp-muted' }, 'Loading…'));
      let docs; try { docs = await carrierListDocuments(); } catch (e) { mount(listWrap, h('div', { class: 'cp-muted' }, 'Could not load.')); return; }
      const label = (t) => (DOC_TYPES.find(d => d[0] === t) || [t, t])[1];
      docs = (docs || []).filter(d => String(d.status || '') !== 'superseded');
      mount(listWrap, (docs && docs.length) ? h('div', null, docs.map(d => h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, label(d.type)), h('div', { class: 'cp-row-s' },
          d.file_name + (d.created_at ? ' · submitted ' + new Date(d.created_at).toLocaleDateString() : '') + ((d.status || 'pending') === 'pending' ? ' · awaiting review' : ''))]),
        pill(d.status || 'pending'),
      ]))) : h('div', { class: 'cp-muted' }, 'No documents uploaded yet.'));
    }
    loadList();
  }

  /* ----- Support ----- */
  async function loadSupport() {
    const subj = h('input', { class: 'cp-in', placeholder: 'Subject (e.g. detention not applied)' });
    const body = h('textarea', { class: 'cp-in', rows: '3', placeholder: 'Describe the issue…' });
    const msg = h('div', { class: 'cp-err' });
    const list = h('div');
    const send = h('button', { class: 'cp-btn', onClick: async () => { msg.textContent = ''; if (!subj.value.trim()) { msg.textContent = 'Subject is required.'; return; } send.disabled = true; send.textContent = 'Sending…'; try { const _a9 = (send._getAtts ? send._getAtts() : []); const _bodyF = body.value.trim() + (_a9.length ? '\n\nATTACHED DOCUMENTS (' + _a9.length + '): ' + _a9.map((x) => x.file_name).join(' \u00b7 ') + ' \u2014 files are in document review.' : ''); await pocketRaiseIssue(subj.value.trim(), _bodyF); subj.value = ''; body.value = ''; msg.className = 'cp-err ok'; msg.textContent = 'Sent — we’ll get back to you.'; await loadIssues(); } catch (e) { msg.className = 'cp-err'; msg.textContent = (e && e.message) || 'Could not send.'; } send.disabled = false; send.textContent = 'Send to dispatch'; } }, 'Send to dispatch');
    const exList = h('div');
    // A7 — the carrier's direct line to Command Center, always visible on top.
    const deskCard = h('div', { class: 'cp-card' }, [cardHead('Your dispatch desk', 'Message us any time — a person answers'),
      h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, 'Email dispatch'), h('div', { class: 'cp-row-s' }, 'dispatch@loadboot.com — loads, trips, appointments, documents')]),
        h('a', { class: 'cp-btn cp-btn-sm', href: 'mailto:dispatch@loadboot.com' }, 'Email'),
      ]),
      h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, 'Billing questions'), h('div', { class: 'cp-row-s' }, 'billing@loadboot.com — invoices, settlements, disputes')]),
        h('a', { class: 'cp-btn cp-btn-sm ghost', href: 'mailto:billing@loadboot.com' }, 'Email'),
      ]),
      (WHATSAPP_NUMBER ? h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, 'Live chat on WhatsApp'), h('div', { class: 'cp-row-s' }, 'Chat with your dispatch desk — fastest for on-the-road questions')]),
        h('a', { class: 'cp-btn cp-btn-sm', style: 'background:#25D366', href: 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent('Hi LoadBoot dispatch — carrier support needed'), target: '_blank', rel: 'noopener noreferrer' }, 'Open WhatsApp'),
      ]) : null),
      h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, 'On the road right now?'), h('div', { class: 'cp-row-s' }, 'Breakdown, accident or reschedule — use the 🚨 Emergency button on your active trip so it reaches dispatch with priority.')]),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'background:' + toneOf('urgent').c, onClick: () => go('trips') }, 'My trips'),
      ]),
      h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'Replies within business hours; dispatch is on call for active loads.'),
    ].filter(Boolean));
    mount(content, h('div', null, [deskCard, h('div', { class: 'cp-grid' }, [
      h('div', { class: 'cp-card' }, [cardHead('Raise an issue'), subj, body, (() => {
        const att9 = [];
        const fIn = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.85rem' });
        const aMsg = h('div', { class: 'cp-row-s' });
        const aHost = h('div');
        const drawA = () => { aHost.innerHTML = ''; att9.forEach((a, i) => aHost.appendChild(h('div', { class: 'cp-row-s', style: 'padding:3px 0;display:flex;gap:8px;align-items:center' }, [h('span', null, '\ud83d\udcce ' + a.file_name + ' \u2713'), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'padding:1px 8px;font-size:.72rem', onClick: () => { att9.splice(i, 1); drawA(); } }, '\u2715')]))); };
        const aBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { const b9 = ev.currentTarget;
          const f = fIn.files && fIn.files[0]; if (!f) { aMsg.textContent = 'Choose a file first.'; return; }
          b9.disabled = true; b9.textContent = 'Uploading\u2026';
          try { const m = await uploadDocument(f, 'other'); await carrierUploadDocument({ type: 'other', fileName: m.fileName, filePath: m.path }); att9.push({ file_name: m.fileName, path: m.path }); drawA(); fIn.value = ''; aMsg.textContent = '\u2713 Attached (' + att9.length + ') \u2014 you can add more.'; }
          catch (e) { aMsg.textContent = (e && e.message) || 'Upload failed.'; }
          b9.disabled = false; b9.textContent = att9.length ? '+ Add another' : 'Attach';
        } }, 'Attach');
        send._getAtts = () => att9;
        return h('div', { style: 'margin:8px 0' }, [h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [fIn, aBtn]), aMsg, aHost]);
      })(), msg, send]),
      h('div', { class: 'cp-card' }, [cardHead('Your tickets'), list]),
      h('div', { class: 'cp-card' }, [cardHead('Reported trip issues'), exList]),
    ])]));
    async function loadIssues() { mount(list, h('div', { class: 'cp-muted' }, 'Loading…')); let rows; try { rows = await pocketMyIssues(40); } catch (_) { mount(list, h('div', { class: 'cp-muted' }, 'Failed to load.')); return; } mount(list, (rows && rows.length) ? h('div', null, rows.map(t => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, t.subject), h('div', { class: 'cp-row-s' }, t.ref)]), pill(t.status)]))) : h('div', { class: 'cp-muted' }, 'No tickets yet.')); }
    async function loadExceptions() {
      mount(exList, h('div', { class: 'cp-muted' }, 'Loading…'));
      let rows; try { rows = await pocketMyExceptions(50); } catch (_) { mount(exList, h('div', { class: 'cp-muted' }, 'Failed to load.')); return; }
      mount(exList, (rows && rows.length) ? h('div', null, rows.map(e => h('div', { class: 'cp-row' }, [
        h('div', null, [
          h('div', { class: 'cp-row-t', style: 'text-transform:capitalize' }, (e.kind === 'tonu' ? 'TONU' : (e.kind || 'issue').replace('_', ' ')) + ((e.origin || e.destination) ? ' · ' + (e.origin || '—') + ' → ' + (e.destination || '—') : '')),
          h('div', { class: 'cp-row-s' }, new Date(e.created_at).toLocaleDateString() + (e.description ? ' · ' + e.description : '')),
        ]),
        pill(e.status),
      ]))) : h('div', { class: 'cp-muted' }, 'No trip issues reported. Report detention, TONU, breakdown and more from a trip.'));
    }
    loadIssues(); loadExceptions();
  }

  /* ----- Account ----- */
  async function loadAccount() {
    try {
      const m = await import('./account-view.js');
      await m.renderPremiumAccount(content, { ov, user, go, signOut, enablePush, isPushEnabled, pushSupported, openModal });
    } catch (e) {
      mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load account.')));
    }
  }

  /* ----- Onboarding wizard (Phase 2A) ----- */
  async function loadOnboarding() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    const EQUIP = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Hotshot', 'Power Only', 'Box Truck', 'Conestoga', 'Tanker', 'Car Hauler'];
    const STEPS = ['Company & authority', 'Operation & equipment', 'Factoring & payment', 'Dispatch preferences', 'Documents', 'Review & submit'];
    let prof = {}; try { prof = await pocketGetProfile(); } catch (_) { prof = {}; }
    const f = Object.assign({ company: '', contact_name: '', phone: '', mc: '', dot: '', home_base: '', radius_miles: '', equipment_types: [], truck_count: '', hazmat: false, weekend_ok: false, factoring_status: '', factoring_company: '', contact_method: '', whatsapp: '', bank_name: '', account_title: '', account_number: '', routing_number: '', fr_title: '', fr_bank: '', fr_account: '', fr_routing: '', fr_email: '', fr_advance: '', fr_fee: '', fr_days: '30' }, prof || {});
    if (!Array.isArray(f.equipment_types)) f.equipment_types = [];
    let st = 0; let fmcsaRes = null;
    try { const _j = sessionStorage.getItem('lb:onb:jump'); if (_j != null) { st = Math.max(0, Math.min(5, Number(_j) || 0)); sessionStorage.removeItem('lb:onb:jump'); } } catch (_) {}
    // Dispatch preferences are REQUIRED at onboarding (drive best-match loads + CC AI matching);
    // the carrier can change them any time later in Account.
    const dpf = { min_rpm: '', preferred_equipment: '', preferred_lanes: '', max_deadhead_miles: '', home_base: '' };
    (async () => { try { const dp = await getDispatchPrefs(); if (dp) { dpf.min_rpm = dp.min_rpm || ''; dpf.preferred_equipment = (dp.preferred_equipment || []).join(', '); dpf.preferred_lanes = (dp.preferred_lanes || []).join(', '); dpf.max_deadhead_miles = dp.max_deadhead_miles || ''; dpf.home_base = dp.home_base || ''; } } catch (_) {} })();
    function prefsStep() {
      const fldp = (label, key, ph, type) => { const i = h('input', { class: 'cp-in', type: type || 'text', placeholder: ph || '', value: dpf[key] == null ? '' : dpf[key] }); if (key === 'home_base') i.setAttribute('list', 'lb-uscities'); i.oninput = () => { dpf[key] = i.value; }; return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), i]); };
      return h('div', null, [
        h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'Required — these drive your best-match loads: the AI Pilot and your dispatcher only push loads that fit your minimum rate, equipment and lanes. You can change them any time in Account.'),
        h('div', { class: 'cp-wiz-grid' }, [
          fldp('Minimum rate ($/mi) *', 'min_rpm', 'e.g. 2.25', 'number'),
          fldp('Preferred equipment (comma separated) *', 'preferred_equipment', 'Dry Van, Reefer'),
          fldp('Preferred lanes / regions (comma separated) *', 'preferred_lanes', 'TX, Atlanta, Midwest'),
          fldp('Max deadhead (miles)', 'max_deadhead_miles', 'e.g. 250', 'number'),
          fldp('Home base', 'home_base', 'Dallas, TX'),
        ]),
      ]);
    }
    async function savePrefsStep() {
      const missing = [];
      if (!dpf.min_rpm || isNaN(Number(dpf.min_rpm)) || Number(dpf.min_rpm) <= 0) missing.push('minimum rate ($/mi)');
      const eq = String(dpf.preferred_equipment || '').split(',').map(x => x.trim()).filter(Boolean);
      const ln = String(dpf.preferred_lanes || '').split(',').map(x => x.trim()).filter(Boolean);
      if (!eq.length && f.equipment_types && f.equipment_types.length) eq.push(...f.equipment_types);
      if (!eq.length) missing.push('preferred equipment');
      if (!ln.length) missing.push('preferred lanes / regions');
      if (missing.length) throw new Error('Required: ' + missing.join(', ') + '.');
      if (!eq || !eq.length) { alert('Equipment type is REQUIRED \u2014 brokers match and offer loads by your equipment. Select at least one.'); return; }
      await setDispatchPrefs({ min_rpm: dpf.min_rpm, preferred_equipment: eq, preferred_lanes: ln,
        max_deadhead_miles: dpf.max_deadhead_miles || null, home_base: (dpf.home_base || f.home_base || '').trim() || null });
    }
    async function saveBankStep() {
      const factoring = String(f.factoring_status || '') === 'yes';
      if (factoring && !String(f.factoring_company || '').trim()) throw new Error('Please enter your factoring company name.');
      const allBank = f.bank_name && f.account_title && f.account_number && f.routing_number;
      const someBank = f.bank_name || f.account_title || f.account_number || f.routing_number;
      if (factoring) {
        if (!String(f.fr_title || '').trim() || !String(f.fr_bank || '').trim()) throw new Error('Add your factor\u2019s remit-to payee name and bank \u2014 that is what every broker pays.');
        try {
          await carrierFactoringSet({ action: 'activate', factoring_company: f.factoring_company, noa_doc: f.noa_path || null, remit: { account_title: f.fr_title, bank_name: f.fr_bank, account_number: f.fr_account || null, routing_number: f.fr_routing || null, remittance_email: f.fr_email || null, payment_method: 'ACH', advance_pct: f.fr_advance || null, fee_pct: f.fr_fee || null, terms_days_broker: f.fr_days || '30' } });
          lbToast('Factoring filed \u2014 LoadBoot verifies your NOA (upload the letter at the Documents step, type: Notice of assignment). Brokers will pay your factor automatically.', 'action', '🏦 NOA filed');
        } catch (e9) { lbToast((e9 && e9.message) || 'Factoring setup failed \u2014 you can redo it any time in Finance.', 'urgent', 'Factoring'); }
      }
      if (factoring && !allBank) { if (someBank) lbToast('Bank details were incomplete, so they were skipped \u2014 factored loads pay via your factor either way. Tip: adding a full bank account lets direct-pay / quick-pay brokers and fee settlement use it. You can add it any time (here or in Account).', 'action', 'Bank skipped \u2014 optional for you'); return; }
      if (!factoring && !someBank) throw new Error('Add your bank account for payouts (or select factoring above).');
      if (!allBank) throw new Error('Please complete all bank fields.');
      if (!/^\d{9}$/.test(String(f.routing_number).trim())) throw new Error('Routing number must be 9 digits.');
      await setMyPaymentProfile({ bank_name: String(f.bank_name).trim(), account_title: String(f.account_title).trim(), account_number: String(f.account_number).trim(), routing_number: String(f.routing_number).trim(), payment_method: 'ach' });
      lbToast('Bank account added \u2014 one more document is now required: Bank Verification (voided check or bank letter). It has been added to your Documents checklist.', 'action', 'Bank verification required');
    }
    const host = h('div', { class: 'cp-card cp-wiz' });
    if (!document.getElementById('lb-uscities')) document.body.appendChild(h('datalist', { id: 'lb-uscities', html: US_CITIES.map((c) => '<option value="' + c + '"></option>').join('') }));
    const FACTORS = ['RTS Financial', 'Triumph Business Capital', 'OTR Solutions', 'Apex Capital', 'TAFS (Transport Alliance Funding)', 'eCapital Freight Factoring', 'Riviera Finance', 'TCI Business Capital', 'Porter Freight Funding', 'Thunder Funding', 'Phoenix Capital Group', 'Compass Funding Solutions', 'Great Plains Transportation Services', 'England Carrier Services', 'Love\u2019s Financial', 'WEX Fleet One Factoring', 'Bobtail', 'Denim', 'CoreFund Capital', 'Steelhead Finance', 'Saint John Capital', 'FreightWaves Ratings partner \u2014 other'];
    if (!document.getElementById('lb-factors')) document.body.appendChild(h('datalist', { id: 'lb-factors', html: FACTORS.map((c) => '<option value="' + c + '"></option>').join('') }));
    const field = (label, key, ph, type) => { const i = h('input', { class: 'cp-in', type: type || 'text', placeholder: ph || '', value: f[key] == null ? '' : f[key] }); if (key === 'home_base') i.setAttribute('list', 'lb-uscities'); if (key === 'factoring_company' && String(f.factoring_status || '') === 'interested') i.setAttribute('list', 'lb-factors'); i.oninput = () => { f[key] = i.value; }; return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), i]); };
    const selectField = (label, key, opts) => { const s = h('select', { class: 'cp-in' }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v ? 'selected' : null }, l))); s.onchange = () => { f[key] = s.value; if (key === 'factoring_status') draw(); }; return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), s]); };
    const toggle = (label, key) => { const b = h('button', { class: 'cp-chip2' + (f[key] ? ' on' : ''), onClick: () => { f[key] = !f[key]; b.classList.toggle('on'); if (key === 'hazmat' && f[key]) lbToast('You will need 3 documents at the Documents step: PHMSA Hazmat Registration \u00b7 Driver CDL Hazmat (H) Endorsement \u00b7 Hazmat Liability Insurance COI. Hazmat loads unlock after the Command Center approves all three.', 'action', 'Hazmat \u2014 3 documents required'); } }, label); return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), b]); };
    function save() {
      return pocketSaveProfile({ company: f.company, contactName: f.contact_name, phone: f.phone, mc: f.mc, dot: f.dot, homeBase: f.home_base, radiusMiles: f.radius_miles ? Number(f.radius_miles) : null, equipmentTypes: (f.equipment_types && f.equipment_types.length) ? f.equipment_types : null, truckCount: f.truck_count ? String(f.truck_count) : null, hazmat: !!f.hazmat, weekendOk: !!f.weekend_ok, factoringStatus: f.factoring_status, factoringCompany: f.factoring_company, contactMethod: f.contact_method, whatsapp: f.whatsapp });
    }
    function docStep() {
      const types = [['w9', 'W-9'], ['authority', 'Operating authority'], ['insurance', 'Insurance / COI'], ['mcs150', 'MCS-150 (Biennial Update)'], ['safety', 'FMCSA Safety Rating'], ['noa', 'Notice of assignment (factoring)'], ['agreement', 'Signed agreement']].concat(f.hazmat ? [['hazmat_reg', 'PHMSA Hazmat Registration'], ['hazmat_h', 'CDL Hazmat (H) Endorsement'], ['hazmat_coi', 'Hazmat Insurance COI']] : []).concat([['bank_check', 'Bank verification (voided check / letter)'], ['other', 'Other']]);
      const typeSel = h('select', { class: 'cp-in' }, types.map(([v, l]) => h('option', { value: v }, l)));
      const fileIn = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx' });
      const msg = h('div', { class: 'cp-err' });
      let autoUp = false;
      const reqHost = h('div');
      const hazHost = h('div');
      const loadReqs = async () => { try { const c = await pocketCompliance(); const rs = (c && c.requirements) || [];
        mount(reqHost, h('div', { style: 'margin-bottom:10px' }, [h('div', { class: 'cp-row-t', style: 'margin-bottom:4px' }, 'Required documents checklist'), ...rs.map((r) => { const st = String(r.status || 'missing').toLowerCase(); const okd = st === 'valid'; const rev = st === 'pending' || st === 'in_review' || st === 'review' || st === 'submitted'; const col = okd ? '#34d399' : rev ? '#3b9dff' : (r.mandatory ? '#f87171' : '#fbbf24');
          let dt0 = r.doc_type || (/w-?9/i.test(r.name || '') ? 'w9' : /agreement/i.test(r.name || '') ? 'agreement' : ''); if (/agreement/i.test(dt0)) dt0 = 'agreement'; if (/^w-?9$/i.test(dt0)) dt0 = 'w9';
          const goUp = () => {
            if (dt0 === 'w9') { w9Btn.click(); return; }
            if (dt0 === 'agreement') { agrBtn.click(); return; }
            if (dt0) { try { typeSel.value = dt0; if (typeSel.value !== dt0) typeSel.value = 'other'; } catch (_) {} }
            autoUp = true; fileIn.click();
          };
          const act = okd ? h('span', { class: 'cp-pill green' }, 'Approved')
            : rev ? h('div', { style: 'display:flex;gap:8px;align-items:center' }, [h('span', { class: 'cp-pill blue' }, 'Uploaded \u2713 In review'), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin:0', onClick: goUp }, dt0 === 'w9' ? 'Redo W-9' : dt0 === 'agreement' ? 'Re-sign' : 'Change')].filter(Boolean))
            : h('button', { class: 'cp-btn cp-btn-sm', style: 'margin:0', onClick: goUp }, dt0 === 'w9' ? 'Start W-9' : dt0 === 'agreement' ? 'Sign' : 'Upload');
          return h('div', { class: 'cp-row', style: 'border-left:3px solid ' + col + ';padding-left:10px' }, [h('div', { style: 'min-width:0;flex:1' }, [h('div', { class: 'cp-row-t', style: 'font-size:.88rem' }, r.name), h('div', { class: 'cp-row-s' }, okd ? 'Approved \u2713' : rev ? 'Submitted \u00b7 in review' : (r.mandatory ? 'Required \u2014 not on file' : 'Optional'))]), act]); })]));
        const hazLeft = rs.filter((r) => /hazmat|phmsa/i.test(r.name || '') && ['missing', 'expired', 'rejected'].indexOf(String(r.status || 'missing').toLowerCase()) >= 0);
        mount(hazHost, (f.hazmat && hazLeft.length) ? h('div', { class: 'cp-ann warning', style: 'margin:8px 0' }, [h('div', { class: 'cp-ann-t' }, 'Hazmat \u2014 ' + hazLeft.length + ' document(s) still needed'), h('div', { class: 'cp-ann-b' }, hazLeft.map((r) => r.name).join(' \u00b7 ') + ' \u2014 mandatory before hazmat loads can be booked.')]) : h('span'));
      } catch (_) {} }; loadReqs();
      const list = h('div'); const refresh = async () => { try { const ds = await carrierListDocuments(); mount(list, (ds && ds.length) ? h('div', null, ds.map(d => h('div', { class: 'cp-row' }, [h('div', { style: 'min-width:0;flex:1' }, [h('div', { class: 'cp-row-t' }, d.file_name), h('div', { class: 'cp-row-s' }, (d.type || 'document') + ' \u00b7 uploaded')]), h('div', { style: 'display:flex;gap:8px;align-items:center' }, [pill(d.status || 'pending'), (String(d.status || 'pending').toLowerCase() === 'pending' ? h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin:0', onClick: () => { try { typeSel.value = d.type || 'other'; } catch (_) {} autoUp = true; fileIn.click(); } }, 'Change') : null)].filter(Boolean))]))) : h('div', { class: 'cp-muted' }, 'No documents yet.')); } catch (_) {} };
      const up = h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { const file = fileIn.files && fileIn.files[0]; msg.textContent = ''; msg.className = 'cp-err'; if (!file) { msg.textContent = 'Choose a file.'; return; } { const rule = docFmt(typeSel.value); const ex = extOf(file); if (rule.exts.indexOf(ex) < 0) { const _m = 'This document must be ' + (rule.exts.length === 1 ? rule.exts[0].toUpperCase() : rule.exts.map((e) => e.toUpperCase()).join('/')) + ' \u2014 ' + rule.label + '.'; msg.textContent = _m; lbToast(_m, 'urgent', 'Wrong file format'); fileIn.value = ''; return; } } up.disabled = true; up.textContent = 'Uploading…'; try { const m = await uploadDocument(file, typeSel.value); await carrierUploadDocument({ type: typeSel.value, fileName: m.fileName, filePath: m.path }); fileIn.value = ''; msg.className = 'cp-err ok'; msg.textContent = '✓ Uploaded.'; lbToast('Document uploaded \u2014 sent for review. The checklist above now shows \u201cIn review\u201d.', 'success', 'Uploaded \u2713'); await refresh(); try { loadReqs(); } catch (_) {} } catch (e) { const _um = (e && e.message) || 'Upload failed.'; msg.className = 'cp-err'; msg.textContent = _um; lbToast(_um, 'urgent', 'Upload failed'); } up.disabled = false; up.textContent = 'Upload'; } }, 'Upload');
      fileIn.addEventListener('change', () => { if (autoUp && fileIn.files && fileIn.files[0]) { autoUp = false; up.click(); } });
      refresh();
      const w9Btn = h('button', { class: 'cp-btn cp-btn-sm', onClick: () => import('./w9-form.js').then((m) => m.openW9Wizard({ openModal: openModal, toast: (msg) => lbToast(msg, 'success', 'W-9') }, { carrier: f.company }, () => { refresh(); try { loadReqs(); } catch (_) {} })) }, 'Complete W-9 in-app');
      const agrBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: () => import('./dispatch-agreement.js').then((m) => m.openSignModal({ openModal: openModal, toast: (msg) => lbToast(msg, 'success', 'Agreement') }, { carrier: f.company }, () => { refresh(); try { loadReqs(); } catch (_) {} })) }, 'Sign dispatch agreement');
      return h('div', null, [reqHost, h('p', { class: 'cp-row-s' }, 'W-9 and the Dispatch Agreement are the only two you complete right here (tap Start W-9 / Sign \u2014 no file needed for these two). Every other document \u2014 insurance, authority, certificates \u2014 is a file upload from the checklist above, and agent-issued ones must be original PDFs.'), hazHost, h('p', { class: 'cp-row-s' }, 'Manual upload \u2014 pick the document type, then the file (up to 25 MB). Agent-issued documents must be the original PDF; photos are OK where noted.'), h('div', { class: 'cp-inlineform' }, [typeSel, fileIn, up, msg]), h('div', { style: 'margin-top:10px' }, list)]);
    }
    function reviewStep() {
      const row = (k, v) => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, k), h('span', null, v || '—')]);
      return h('div', null, [h('p', { class: 'cp-row-s' }, 'Check your details, then submit. Our team reviews and approves your account.'), row('Company', f.company), row('Contact', [f.contact_name, f.phone].filter(Boolean).join(' · ')), row('MC / DOT', (f.mc || '—') + ' / ' + (f.dot || '—')), row('Home base', f.home_base), row('Equipment', (f.equipment_types || []).join(', ')), row('Trucks', f.truck_count), row('Factoring', [f.factoring_status === 'yes' ? 'Yes' : f.factoring_status === 'no' ? 'No — direct pay' : f.factoring_status === 'interested' ? 'Wants a recommendation' : '', f.factoring_company].filter(Boolean).join(' · ')), row('Payout', String(f.factoring_status) === 'yes' ? ('Via ' + (f.factoring_company || 'factor') + (f.fr_title ? ' — remit-to ' + f.fr_title : '') + (f.fr_days ? ' · broker pays in ' + f.fr_days + 'd' : '')) : (f.bank_name ? (f.bank_name + ' ····' + String(f.account_number || '').slice(-4)) : '—')), row('Dispatch prefs', (dpf.min_rpm ? '$' + dpf.min_rpm + '/mi min' : '—') + (dpf.preferred_lanes ? ' · ' + dpf.preferred_lanes : ''))]);
    }
    function doneCard() { return [h('div', { class: 'cp-wiz-done' }, [h('div', { style: 'font-size:2.4rem' }, '✓'), h('h3', null, 'Submitted for review'), h('p', { class: 'cp-row-s' }, 'Thanks! Our team is reviewing your onboarding. You’ll get a notification when it’s approved.'), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('dashboard') }, 'Back to dashboard')])]; }
    function draw() {
      const pct = Math.round((st / (STEPS.length - 1)) * 100);
      let body;
      if (st === 0) {
        const vmsg = h('div', { class: 'cp-err' });
        const g = (k) => { if (!fmcsaRes) return null; const cc = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); for (const src of [fmcsaRes, fmcsaRes.result, fmcsaRes.carrier]) { if (src && src[k] != null) return src[k]; if (src && src[cc] != null) return src[cc]; } return null; };
        const resCard = fmcsaRes ? h('div', { class: 'cp-card', style: 'margin-top:8px' }, [
          h('div', { class: 'cp-row' }, [h('span', null, 'Legal name'), h('b', null, String(g('legal_name') || g('name') || f.company || '\u2014'))]),
          h('div', { class: 'cp-row' }, [h('span', null, 'Authority'), h('b', null, String(g('authority_status') || g('authority') || g('operating_status') || g('allowed_to_operate') || 'checked'))]),
          h('div', { class: 'cp-row' }, [h('span', null, 'Safety rating'), h('span', null, String(g('safety_rating') || 'none'))]),
          (fmcsaRes && fmcsaRes.__disq) ? h('div', { class: 'cp-ann emergency', style: 'margin-top:8px' }, [h('div', { class: 'cp-ann-t' }, 'Not authorized to operate'), h('div', { class: 'cp-ann-b' }, 'FMCSA lists this authority as inactive / out of service. Onboarding is blocked until FMCSA shows it ACTIVE again.')]) : null,
            h('div', { class: 'cp-row-s' }, '\u2713 Live from FMCSA (SAFER/QCMobile). Verified authority strengthens your profile.'),
        ]) : null;
        const vbtn = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:6px', onClick: async (ev) => { const _vb = ev.currentTarget;
          const mc = String(f.mc || '').trim(), dot = String(f.dot || '').trim();
          if (!mc && !dot) { vmsg.className = 'cp-err'; vmsg.textContent = 'Enter your MC or DOT number first.'; return; }
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Verifying with FMCSA\u2026';
          try { let dd; try { dd = await fmcsaVerify({ mc: mc || null, dot: dot || null }); } catch (e1) { if (/not responding|taking too long|Could not reach/i.test((e1 && e1.message) || '')) { _vb.textContent = 'FMCSA slow \u2014 retrying\u2026'; await new Promise((r) => setTimeout(r, 1500)); dd = await fmcsaVerify({ mc: mc || null, dot: dot || null }); } else { throw e1; } } fmcsaRes = dd || {}; const cr = fmcsaRes.carrier || fmcsaRes.result || fmcsaRes; const nm = cr && (cr.legalName || cr.legal_name || cr.dbaName || cr.name); if (nm) f.company = nm; if (cr && cr.phone && !String(f.phone || '').trim()) f.phone = String(cr.phone); if (cr && cr.mcNumber) f.mc = String(cr.mcNumber).replace(/\D/g, ''); if (cr && cr.dotNumber) f.dot = String(cr.dotNumber);
            fmcsaRes.__disq = !!(cr && (cr.authority === 'inactive' || cr.allowedToOperate === 'N' || cr.outOfService === true));
            if (fmcsaRes.__disq) lbToast('FMCSA lists this authority as INACTIVE or under an out-of-service order. LoadBoot only onboards carriers with active authority \u2014 resolve it with FMCSA first, or contact support if this looks wrong.', 'urgent', 'Authority not active');
            draw(); }
          catch (e) { _vb.disabled = false; _vb.textContent = 'Verify with FMCSA'; vmsg.className = 'cp-err'; vmsg.textContent = (e && e.message) || 'FMCSA verification failed \u2014 you can still continue and upload your authority letter.'; }
        } }, 'Verify with FMCSA');
        body = h('div', null, [h('div', { class: 'cp-wiz-grid' }, [field('Company / carrier name', 'company', 'Acme Trucking LLC'), field('Your name', 'contact_name'), field('Phone', 'phone'), field('MC number', 'mc', '123456'), field('DOT number', 'dot', '1234567')]), h('p', { class: 'cp-row-s', style: 'margin-top:8px' }, 'Verify your authority live with FMCSA \u2014 instant, nothing to upload for THIS step. (Insurance, W-9 and other documents come later, at the Documents step.)'), vbtn, vmsg, resCard].filter(Boolean));
      }
      else if (st === 1) { const eq = h('div', { class: 'cp-eqgrid' }, EQUIP.map(e => { const on = (f.equipment_types || []).includes(e); const b = h('button', { class: 'cp-chip2' + (on ? ' on' : ''), onClick: () => { const s = new Set(f.equipment_types || []); if (s.has(e)) s.delete(e); else s.add(e); f.equipment_types = [...s]; b.classList.toggle('on'); } }, e); return b; })); body = h('div', { class: 'cp-wiz-grid' }, [field('Home base (city, ST)', 'home_base', 'Dallas, TX'), field('Search radius (miles)', 'radius_miles', '300', 'number'), field('Number of trucks', 'truck_count', '1'), h('div', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Equipment types'), eq]), toggle('Haul hazmat', 'hazmat'), toggle('Available weekends', 'weekend_ok')]); }
      else if (st === 2) body = h('div', null, [h('p', { class: 'cp-row-s', style: 'margin-bottom:10px' }, 'We don\u2019t manage your factoring \u2014 we only need to know where money flows: after delivery we route your invoice/BOL paperwork to the right place, and your dispatch fee is collected the right way.'), (String(f.factoring_status || '') === 'interested' ? h('div', { class: 'cp-ann', style: 'margin-bottom:10px' }, [h('div', { class: 'cp-ann-t' }, 'We\u2019ll connect you \u2713'), h('div', { class: 'cp-ann-b' }, 'After you submit, our team reaches out with 2\u20133 recommended factoring partners \u2014 you sign with them directly. Until your factoring is live, add your bank below so settlements can reach you.')]) : null), h('div', { class: 'cp-wiz-grid' }, [selectField('Factoring', 'factoring_status', [['', '—'], ['yes', 'I use factoring'], ['no', 'No factoring \u2014 pay me direct'], ['interested', 'Recommend me a factoring partner']]), field(String(f.factoring_status || '') === 'interested' ? 'Pick a recommended factoring partner' : 'Factoring company', 'factoring_company', String(f.factoring_status || '') === 'interested' ? 'Tap to see our recommended list' : 'Your factoring company\u2019s name'), selectField('Preferred contact', 'contact_method', [['', '—'], ['phone', 'Phone'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email']]), field('WhatsApp number', 'whatsapp'), h('div', { class: 'cp-fld', style: 'grid-column:1/-1' }, [h('span', { class: 'cp-row-t' }, 'Bank account for settlement payouts'), h('span', { class: 'cp-row-s' }, 'Encrypted & tokenized. Factoring carriers: optional but RECOMMENDED \u2014 direct-pay / quick-pay brokers and your dispatch fee can settle here while factored loads pay via your factor. No factoring: required. The account title MUST match your legal company name (sole proprietors: the owner\u2019s name on the W-9) \u2014 mismatched titles fail verification.')]), field('Bank name', 'bank_name', 'e.g. Chase'), field('Account holder / title \u2014 must match your LEGAL company name', 'account_title', 'Exactly as on your W-9 / authority'), field('Account number', 'account_number'), field('Routing number (ABA)', 'routing_number', '9 digits')]),
        (String(f.factoring_status || '') === 'yes' ? h('div', { style: 'margin-top:12px;border:1.5px solid rgba(139,92,246,.4);background:rgba(139,92,246,.07);border-radius:14px;padding:12px 14px' }, [
          h('div', { class: 'cp-row-t', style: 'margin-bottom:2px' }, '🏦 Your factor\u2019s REMIT-TO — exactly what brokers need to pay them'),
          h('div', { class: 'cp-row-s', style: 'margin-bottom:8px;line-height:1.6' }, 'Copy these from your factoring company\u2019s NOA / remittance sheet. Once verified, every broker automatically sees THESE details (never your bank) on the pay panel of every load, with the NOA warning. Upload the NOA letter itself at the Documents step (type: Notice of assignment).'),
          h('div', { class: 'cp-wiz-grid' }, [
            field('Remit-to payee name *', 'fr_title', 'exactly as the factor wrote it'),
            field('Factor\u2019s bank *', 'fr_bank', ''),
            field('Factor account #', 'fr_account', ''),
            field('Factor routing (ACH)', 'fr_routing', ''),
            field('Factor remittance email', 'fr_email', 'payments@factor.com'),
            field('Advance % they pay you', 'fr_advance', 'e.g. 95'),
            field('Factor fee %', 'fr_fee', 'e.g. 3'),
            field('Days the broker gets to pay the factor', 'fr_days', '30'),
          ]),
          (() => {
            const fIn9 = h('input', { type: 'file', accept: '.pdf', style: 'font-size:.85rem' });
            const st9 = h('span', { class: 'cp-row-s' }, f.noa_uploaded ? '✓ NOA letter attached' : '');
            const up9 = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev9) => { const b9 = ev9.currentTarget;
              const f9 = fIn9.files && fIn9.files[0]; if (!f9) { st9.textContent = 'Choose the factor\u2019s NOA PDF first.'; st9.style.color = '#f87171'; return; }
              b9.disabled = true; b9.textContent = 'Uploading\u2026';
              try { const m9 = await uploadDocument(f9, 'noa'); await carrierUploadDocument({ type: 'noa', fileName: m9.fileName, filePath: m9.path }); f.noa_uploaded = true; f.noa_path = m9.path; st9.style.color = '#4ade80'; st9.textContent = '✓ NOA letter attached — LoadBoot verifies it against your remit-to'; b9.textContent = '✓ Uploaded'; }
              catch (e9) { b9.disabled = false; b9.textContent = 'Upload NOA'; st9.style.color = '#f87171'; st9.textContent = (e9 && e9.message) || 'Upload failed.'; }
            } }, 'Upload NOA');
            return h('div', { style: 'margin-top:10px' }, [
              h('div', { class: 'cp-row-t' }, '📄 The NOA letter itself (PDF from your factoring company)'),
              h('div', { class: 'cp-row-s', style: 'margin:3px 0 6px' }, 'Your factor emails you this letter when you sign with them — attach it here (or later under Documents).'),
              h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [fIn9, up9]), st9,
            ]);
          })(),
          h('div', { style: 'margin-top:10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:11px;padding:10px 13px' }, [
            h('div', { style: 'font-weight:800;color:#4ade80' }, '💡 Don\u2019t worry — nothing gets locked'),
            h('div', { class: 'cp-row-s', style: 'margin-top:3px;line-height:1.65' }, 'Add your own bank below too (recommended): direct-pay / quick-pay brokers and fee settlements use it. Later you can switch ANY broker between factor and direct per-broker (Finance → 🏦 Factoring), and if you ever leave your factor, one release letter flips everything back. You stay in control.'),
          ]),
        ]) : null)]);
      else if (st === 3) body = prefsStep();
      else if (st === 4) body = docStep();
      else body = reviewStep();
      const back = st > 0 ? h('button', { class: 'cp-btn ghost cp-btn-sm', onClick: () => { st--; draw(); } }, '← Back') : h('span');
      const next = st < STEPS.length - 1
        ? h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { const _btn = ev.currentTarget; _btn.disabled = true; _btn.textContent = 'Saving…'; try { if (st === 0 && (!String(f.company || '').trim() || !String(f.contact_name || '').trim() || (!String(f.mc || '').trim() && !String(f.dot || '').trim()))) { throw new Error('Company name, your name, and MC or DOT number are required to continue.'); } if (st === 0 && !fmcsaRes && (String(f.dot || '').trim() || String(f.mc || '').trim())) {
            // Carrier skipped the Verify button — run the FMCSA screen silently before allowing continue.
            _btn.textContent = 'Checking FMCSA\u2026';
            try { const dd0 = await fmcsaVerify({ mc: String(f.mc || '').trim() || null, dot: String(f.dot || '').trim() || null }); fmcsaRes = dd0 || {}; const cr0 = fmcsaRes.carrier || {}; fmcsaRes.__disq = !!(cr0 && (cr0.authority === 'inactive' || cr0.allowedToOperate === 'N' || cr0.outOfService === true)); } catch (_) { /* FMCSA unreachable — let CC risk flags catch it at review */ }
          }
          if (st === 0 && fmcsaRes && fmcsaRes.__disq) { throw new Error('FMCSA shows this authority as INACTIVE or out of service \u2014 onboarding is blocked until your authority is active again.'); }
          if (st === 1) {
            const miss1 = [];
            if (!String(f.home_base || '').trim()) miss1.push('home base (city, ST)');
            if (!(f.equipment_types && f.equipment_types.length)) miss1.push('at least one equipment type');
            if (!String(f.truck_count || '').trim() || Number(f.truck_count) < 1) miss1.push('number of trucks');
            if (miss1.length) throw new Error('Required before continuing: ' + miss1.join(' \u00b7 ') + '. These drive your load matching.');
          } if (st === 2) await saveBankStep(); if (st === 3) await savePrefsStep();
          if (st === 4) { let _c = null; try { _c = await pocketCompliance(); } catch (_) {}
            const _rs = (_c && _c.requirements) || [];
            const _bad = _rs.filter((r) => r.mandatory && ['missing', 'expired', 'rejected'].indexOf(String(r.status || 'missing').toLowerCase()) >= 0).map((r) => r.name);
            if (_bad.length) throw new Error('Required documents still missing: ' + _bad.join(' \u00b7 ') + '. Upload each one (\u201cIn review\u201d is enough) before continuing.');
          }
          await save(); st++; draw(); } catch (e) { _btn.disabled = false; _btn.textContent = 'Save & continue'; lbToast((e && e.message) || 'Could not save.', 'urgent', 'Cannot continue yet'); } } }, 'Save & continue')
        : h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { const _sb = ev.currentTarget; _sb.disabled = true; _sb.textContent = 'Submitting…'; try { await save(); await pocketSubmitOnboarding(); mount(host, doneCard()); lbToast('Onboarding submitted \u2014 our team is reviewing it now. You\u2019ll get a notification on approval.', 'success', 'Submitted \u2713'); } catch (e) { _sb.disabled = false; _sb.textContent = 'Submit for review'; lbToast((e && e.message) || 'Could not submit.', 'urgent', 'Submit failed'); } } }, 'Submit for review');
      mount(host, [h('div', { class: 'cp-wiz-head' }, [h('h3', null, 'Step ' + (st + 1) + ' of ' + STEPS.length + ' — ' + STEPS[st]), h('span', { class: 'cp-row-s' }, pct + '%')]), h('div', { class: 'cp-wiz-bar' }, h('div', { class: 'cp-wiz-fill', style: 'width:' + pct + '%' })), h('div', { class: 'cp-wiz-body' }, body), h('div', { class: 'cp-wiz-actions' }, [back, next])]);
    }
    mount(content, host); draw();
  }

  function statTile(label, value, iconName, accent, onClick) {
    return h('button', { class: 'cp-stat ' + (accent || '') + (onClick ? ' clickable' : ''), onClick: onClick || null }, [
      h('div', { class: 'cp-stat-ic' }, icon(iconName, 20)),
      h('div', null, [h('div', { class: 'cp-stat-v' }, value), h('div', { class: 'cp-stat-l' }, label)]),
    ]);
  }
  function cardHead(title, sub, onClick) { return h('div', { class: 'cp-cardhead' }, [h('div', null, [h('h3', null, title), sub ? h('span', { class: 'cp-cardhead-sub' }, sub) : null].filter(Boolean)), onClick ? h('button', { class: 'cp-link', onClick }, 'View all →') : null].filter(Boolean)); }

  /* ----- Notifications inbox (Phase 5) ----- */

  /* ===== SAFETY v2 (locked design): hub + trip emergency reporting =====
     Live location REQUIRED (UI gate + server rejects without lat/lng). Proof rules per type.
     Carrier never sees the word 'CC' — it is '24/7 Dispatch support'. */
  const INCIDENT_TYPES = [
    ['accident', 'Accident / collision', 'Proof required: scene + vehicle photos.', true],
    ['breakdown', 'Breakdown / tire', 'Proof required: photo of the truck where it sits.', true],
    ['medical', 'Medical emergency', 'Call 911 first. Proof optional.', false],
    ['security', 'Theft / security threat', 'Proof required: photos; add police report # in the note.', true],
    ['unsafe_facility', 'Unsafe facility', 'Proof required: facility/condition photos.', true],
    ['other', 'Other urgent issue', 'Proof recommended.', false],
  ];
  function openIncidentSheet(trip, onDone) {
    let TYPE = null, PROOFREQ = false, NEED = null, LOC = null, PROOFPATH = null;
    const locOk = h('div', { style: 'display:none;align-items:center;gap:7px;background:#e8f8ee;border:1px solid #bbe7c9;border-radius:10px;padding:9px 11px;font-size:12px;font-weight:700;color:#15803d;margin:8px 0' });
    const locBtn = h('button', { class: 'cp-btn', style: 'width:100%;background:#F97316', onClick: () => {
      locBtn.disabled = true; locBtn.textContent = 'Getting live location…';
      if (!navigator.geolocation) { alert('Location is not available on this device/browser.'); locBtn.disabled = false; locBtn.textContent = 'Enable live location'; return; }
      navigator.geolocation.getCurrentPosition((pos) => {
        LOC = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) };
        locBtn.style.display = 'none'; locOk.style.display = 'flex';
        locOk.textContent = '✓ Live location ON — ' + LOC.lat.toFixed(4) + ', ' + LOC.lng.toFixed(4) + ' · accuracy ' + LOC.accuracy + ' m';
        upd();
      }, () => { alert('Live location is required to report an emergency — please allow location access.'); locBtn.disabled = false; locBtn.textContent = 'Enable live location'; }, { enableHighAccuracy: true, timeout: 15000 });
    } }, 'Enable live location (required)');
    const typeHost = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0' });
    INCIDENT_TYPES.forEach(([key, label, proofNote, req]) => {
      const b = h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'text-align:left;padding:9px;line-height:1.35', onClick: () => {
        TYPE = key; PROOFREQ = req;
        Array.from(typeHost.children).forEach(x => { x.style.borderColor = ''; x.style.background = ''; });
        b.style.borderColor = '#dc2626'; b.style.background = 'rgba(220,38,38,.08)'; upd();
      } }, [h('div', { style: 'font-weight:800;font-size:12px' }, label), h('div', { style: 'font-size:10px;color:#64748b;margin-top:3px' }, proofNote)]);
      typeHost.appendChild(b);
    });
    const needHost = h('div', { style: 'display:flex;gap:7px;margin:8px 0' }, [['reschedule', 'Reschedule delivery'], ['help', 'Immediate help'], ['both', 'Both']].map(([v, l]) => {
      const b = h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'flex:1', onClick: () => { NEED = v; Array.from(needHost.children).forEach(x => { x.style.borderColor = ''; x.style.background = ''; }); b.style.borderColor = '#0883F7'; b.style.background = 'rgba(8,131,247,.08)'; upd(); } }, l);
      return b;
    }));
    const note = h('textarea', { class: 'cp-in', rows: 2, placeholder: 'Short note — e.g. blown tire, on shoulder, no injuries' });
    const proofIn = h('input', { type: 'file', accept: 'image/*,.pdf', style: 'display:none' });
    const proofBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'width:100%', onClick: () => proofIn.click() }, 'Add photo proof');
    proofIn.onchange = async () => {
      const f = proofIn.files && proofIn.files[0]; if (!f) return;
      proofBtn.disabled = true; proofBtn.textContent = 'Uploading proof…';
      try { const m = await uploadDocument(f, 'other'); PROOFPATH = m.path; proofBtn.textContent = '✓ ' + (m.fileName || 'proof attached'); proofBtn.style.color = '#15803d'; }
      catch (e) { proofBtn.textContent = 'Add photo proof'; alert((e && e.message) || 'Upload failed.'); }
      proofBtn.disabled = false; upd();
    };
    const err = h('div', { class: 'cp-err' });
    const send = h('button', { class: 'cp-btn', style: 'width:100%;background:#dc2626', disabled: true, onClick: async () => {
      send.disabled = true; send.textContent = 'Sending to Dispatch…';
      try {
        await reportTripIncident({ trip: trip.id, type: TYPE, need: NEED, note: note.value || null,
          lat: LOC.lat, lng: LOC.lng, accuracy: LOC.accuracy, location: null, proofs: PROOFPATH ? [PROOFPATH] : [] });
        err.className = 'cp-err ok';
        err.textContent = '✓ Sent — 24/7 Dispatch support has your live location and is verifying now. You will get a notification the moment they respond.';
        setTimeout(() => { close(); if (onDone) onDone(); }, 1400);
      } catch (e) { send.disabled = false; send.textContent = 'Send to 24/7 Dispatch support'; err.className = 'cp-err'; err.textContent = (e && e.message) || 'Could not send.'; }
    } }, 'Send to 24/7 Dispatch support');
    function upd() { const proofOk = PROOFREQ ? !!PROOFPATH : true; send.disabled = !(TYPE && NEED && LOC && proofOk); }
    const close = openModal('Report a problem — this trip', [
      h('p', { class: 'cp-row-s' }, (trip.origin || '—') + ' → ' + (trip.destination || '—') + ' · your report goes straight to 24/7 Dispatch support with proof and live GPS.'),
      locBtn, locOk,
      h('div', { class: 'cp-row-s', style: 'font-weight:800;color:#64748b;margin-top:4px' }, 'WHAT HAPPENED?'),
      typeHost,
      h('div', { class: 'cp-row-s', style: 'font-weight:800;color:#64748b' }, 'WHAT DO YOU NEED?'),
      needHost, note, proofIn, proofBtn, err, send,
      h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'Genuine emergencies are protected: verified reports never hurt your on-time score and carry no penalty under the Emergency Rescheduling Policy. False reports are detected (GPS trail, photo checks) and damage your account.'),
    ]);
  }
  async function loadSafety() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let trips = []; try { trips = (await pocketTrips(30)) || []; } catch (_) {}
    const active = (trips || []).filter(t => ['dispatched', 'in_transit', 'at_pickup', 'loaded'].includes(String(t.status || '').toLowerCase()));
    let incidents = []; try { incidents = (await myTripIncidents()) || []; } catch (_) {}
    let contacts = []; try { contacts = (await emergencyContacts()) || []; } catch (_) {}
    const stTxt = { open: ['⏳ Sent — Dispatch verifying', '#92400e', 'rgba(217,119,6,.12)'],
      acknowledged: ['✓ Dispatch responding', '#1e40af', 'rgba(8,131,247,.1)'],
      reschedule_approved: ['✓ Rescheduled — no penalty', '#15803d', 'rgba(22,163,74,.12)'],
      resolved: ['✓ Resolved', '#475569', 'rgba(100,116,139,.12)'] };
    const callRow = h('div', { style: 'display:flex;gap:8px;margin-bottom:12px' }, [
      h('a', { class: 'cp-btn', href: 'tel:911', style: 'flex:1;text-align:center;background:#dc2626;text-decoration:none' }, '📞 Call 911'),
      h('a', { class: 'cp-btn ghost', href: '/contact.html', style: 'flex:1;text-align:center;text-decoration:none' }, '24/7 Dispatch support'),
    ]);
    const trip = active[0] || null;
    const sosCard = h('div', { class: 'cp-card', style: 'background:linear-gradient(150deg,#101d3a,#0b1220 70%);color:#fff;border:0' }, [
      h('div', { style: 'font-weight:800;font-size:15px' }, 'Emergency on a trip?'),
      h('div', { style: 'font-size:12.5px;color:#94a3b8;margin-top:4px;line-height:1.6' }, 'Report with proof — 24/7 Dispatch support is notified the same second, with your live GPS pin. Live location is required.'),
      trip
        ? h('div', null, [
            h('div', { style: 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border-radius:11px;padding:9px 11px;margin-top:10px;font-size:12px;font-weight:700' }, [
              h('span', { style: 'width:8px;height:8px;border-radius:50%;background:#22c55e;flex:none' }),
              'ACTIVE TRIP — ' + (trip.origin || '—') + ' → ' + (trip.destination || '—'),
            ]),
            h('button', { class: 'cp-btn', style: 'width:100%;margin-top:10px;background:#dc2626', onClick: () => openIncidentSheet(trip, loadSafety) }, 'Report a problem on this trip'),
          ])
        : h('div', { style: 'font-size:12px;color:#94a3b8;margin-top:10px' }, 'No active trip right now — emergency reporting is tied to a live trip so proof and rescheduling attach to the right delivery.'),
    ]);
    const repCard = incidents.length ? h('div', { class: 'cp-card' }, [cardHead('My reports'),
      ...incidents.slice(0, 6).map(i => { const t = stTxt[i.status] || stTxt.open; return h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, (i.itype || '').replace('_', ' ') + ' · needs ' + i.need),
          h('div', { class: 'cp-row-s' }, new Date(i.created_at).toLocaleString() + (i.resolution_note ? ' · ' + i.resolution_note : ''))]),
        h('span', { class: 'cp-pill', style: 'background:' + t[2] + ';color:' + t[1] }, t[0]),
      ]); })]) : null;
    const cName = h('input', { class: 'cp-in', placeholder: 'Name' });
    const cRel = h('input', { class: 'cp-in', placeholder: 'Relation (optional)' });
    const cPhone = h('input', { class: 'cp-in', placeholder: 'Phone', type: 'tel' });
    const cErr = h('div', { class: 'cp-err' });
    const contactsCard = h('div', { class: 'cp-card' }, [cardHead('My emergency contacts'),
      ...contacts.map(c => h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, c.name), h('div', { class: 'cp-row-s' }, (c.relation ? c.relation + ' · ' : '') + c.phone)]),
        h('div', { style: 'display:flex;gap:6px' }, [
          h('a', { class: 'cp-btn cp-btn-sm', href: 'tel:' + c.phone, style: 'text-decoration:none' }, 'Call'),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { try { await emergencyContactDelete(c.id); loadSafety(); } catch (_) {} } }, '✕'),
        ]),
      ])),
      h('div', { class: 'cp-formrow2', style: 'margin-top:8px' }, [cName, cRel]),
      cPhone, cErr,
      h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: async () => {
        cErr.textContent = ''; cErr.className = 'cp-err';
        try { await emergencyContactAdd(cName.value, cRel.value, cPhone.value); loadSafety(); }
        catch (e) { cErr.textContent = (e && e.message) || 'Could not save.'; }
      } }, '+ Add contact'),
    ]);
    const LINKS = [
      ['Emergency & Rescheduling Policy', 'Verified emergency = reschedule with zero penalty — the full process', '/emergency-rescheduling-policy.html'],
      ['Detention, TONU & Layover pay', 'Your accessorial rights — enforced from the signed rate con', '/detention-pay-policy.html'],
      ['How to read a rate confirmation', 'Every clause explained in plain language', '/how-to-read-a-rate-confirmation.html'],
      ['Carrier guides & resources', 'Practical guides for running safe and getting paid', '/resources.html'],
    ];
    const centre = h('div', { class: 'cp-card' }, [cardHead('Safety centre', 'policies & guides'),
      ...LINKS.map(([t, sub, url]) => h('a', { class: 'cp-row', href: url, target: '_blank', style: 'text-decoration:none;color:inherit' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, t), h('div', { class: 'cp-row-s' }, sub)]),
        h('span', { style: 'color:#94a3b8;font-size:19px;font-weight:600' }, '›'),
      ])),

    ]);
    mount(content, h('div', null, [callRow, sosCard, repCard, contactsCard, centre].filter(Boolean)));
  }

  async function loadNotifications() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let rows; try { rows = await pocketNotifications(60); } catch (e) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'Could not load notifications.'))); return; }
    if (!rows || !rows.length) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No notifications yet. Alerts about your loads, payments and onboarding will appear here.'))); refreshUnread(); return; }
    const unread9 = rows.filter(n => !n.read_at).length;
    const card = h('div', { class: 'cp-card' }, [cardHead('Notifications', unread9 + ' unread'),
      unread9 ? h('div', { style: 'text-align:right;margin:-6px 0 8px' }, h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (e9) => {
        e9.currentTarget.disabled = true;
        try { await pocketMarkAllNotificationsRead(); } catch (_) {}
        refreshUnread(); loadNotifications();
      } }, '\u2713 Mark all read')) : null,
      ...rows.map(n => {
      const p = n.payload || {};
      // Owner: every notification carries the official LoadBoot mark (real asset, not a text card),
      // with a tone-colored ring — like a native push notification showing the app icon.
      const toneCol = p.tone === 'urgent' ? '#dc2626' : p.tone === 'success' ? '#16a34a' : '#0883F7';
      const row = h('div', { class: 'cp-row cp-notif' + (n.read_at ? '' : ' unread'), style: 'align-items:flex-start;gap:12px', onClick: async () => { if (!n.read_at) { try { await pocketMarkNotificationRead(n.id); n.read_at = new Date().toISOString(); row.classList.remove('unread'); refreshUnread(); } catch (_) {} } go(lbNotifDest(n, p)); }, title: 'Open the page this notification is about' }, [
        h('span', { html: '<img src="/icon-512.png" width="34" height="34" alt="LoadBoot" style="display:block;border-radius:9px;box-shadow:0 0 0 2px ' + toneCol + '33">', style: 'flex:none;line-height:0;margin-top:2px' }),
        h('div', { style: 'min-width:0;flex:1' }, [h('div', { class: 'cp-row-t' }, p.title || n.template_key || 'Notification'), p.body ? h('div', { class: 'cp-row-s' }, p.body) : null,
          n.created_at ? h('div', { class: 'cp-row-s', style: 'font-size:.68rem;opacity:.75;margin-top:2px' }, new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + new Date(n.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) : null].filter(Boolean)),
        n.read_at ? null : h('span', { class: 'cp-pill blue' }, 'new'),
      ].filter(Boolean));
      return row;
    })]);
    mount(content, card);
    refreshUnread();
  }

  go(tab);
  refreshUnread();
}

/* ---------- auth watch (only reload on real sign-out) ---------- */
let _hadSession = false, _watching = false;
function watchAuth() { if (_watching) return; _watching = true; onAuthChange((s) => { if (s) { _hadSession = true; return; } if (_hadSession) { _hadSession = false; location.reload(); } }); }

async function boot() {
  if (/type=recovery/.test(location.hash || '')) { recoveryScreen(); return; }
  root.setAttribute('aria-busy', 'true');
  let session = null;
  try { session = await getSession(); } catch (_) {}
  if (!session) { authScreen(); return; }
  _hadSession = true; watchAuth();
  try { mountOfflineBanner(); } catch (_) {}
  let user = null; try { user = await getUser(); } catch (_) {}
  // /app/agent/ is the AGENT product — never render the carrier portal here,
  // even if this login also owns a carrier org (agents are a separate persona).
  if (window.__LB_AGENT) { agentPortal(user); return; }
  appView(user);
}

boot();
