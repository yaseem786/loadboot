// app.js — LoadBoot Carrier Portal. A full, responsive carrier-facing web app:
// desktop shows a sidebar dashboard; mobile collapses to a bottom tab bar. Carriers
// sign in / self-register, then see ONLY their own data via self-scoping cc_pocket_*
// RPCs (the server resolves the carrier org from the session — no carrier-id param,
// so cross-carrier access is impossible). Admin/staff use the Command Center.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signUp, signOut, onAuthChange, resetPassword, updatePassword } from '../shared/session.js';
import {
  pocketOverview, pocketTrips, pocketInvoices, pocketCompliance, pocketConfirmTrip,
  pocketSetConsent, pocketPostLocation, pocketRaiseIssue, pocketMyIssues, pocketAnnouncements,
  pocketReportIssue, pocketDisputeInvoice, publicLoadOpportunities, pocketUploadPod, pocketTripPods,
  pocketDrivers, pocketUpsertDriver, pocketTrucks, pocketUpsertTruck, pocketTeam, pocketSetMember,
  pocketFleetAlerts, pocketStatement, pocketTripTimeline, pocketMyExceptions, pocketAssignTrip, pocketAdvanceTrip,
  carrierUploadDocument, carrierListDocuments, fmcsaVerify, carrierAgreementSignature, carrierW9,
  emergencyContacts, emergencyContactAdd, emergencyContactDelete, reportTripIncident, myTripIncidents,
  pocketGetProfile, pocketSaveProfile, pocketSubmitOnboarding,
  pocketGetPreferences, pocketSavePreferences,
  pocketAvailableLoads, pocketBookLoad, requestBookLoad, carrierBestLoads, getDispatchPrefs, setDispatchPrefs, tripArrive, tripDepart,
  isFlagEnabled, myReferral, claimReferral, myReferralEarnings, referralRequestPayout, myPayoutRequests,
  setMyPaymentProfile, myPaymentProfile, carrierViewPoster, accountHealth, myTrustProfile, myApprovedPartners, setMyServices, myServices, dispatchSheet, myRateConfirmation, acknowledgeRC, deliveryDocPack, prebookCheck, myOnboardingPacket, onboardingSubmitItem,
  carrierPnl, carrierAddExpense, carrierExpenses, carrierDeleteExpense,
  pocketNotifications, pocketMarkNotificationRead,
  carrierDashboard, myNotifications, markMyNotification, carrierLoadDetail,
  tripEmergencyRequest, tripMyEmergencies,
  rateCounterparty, myRating,
  postTruck, myTruckPostings, truckPostingMatches, updateTruckPosting, scanTruckMatches,
  expenseAdd, expenseList, expenseDelete,
  iftaSet, iftaSummary, truckSetMaintenance, fleetMaintenance,
  fleetServiceAdd, fleetServiceList, fleetServiceDelete,
  payrollAdd, payrollList, payrollMarkPaid, payrollDelete,
} from '../shared/api.js';
import { uploadDocument, uploadPodDocument } from '../shared/storage.js';
import { enablePush, isPushEnabled, pushSupported } from '../shared/push.js';
import { imagesToPdf, downloadBlob } from '../shared/ui/scanner.js';
import { brandLogo } from '../shared/ui/components.js';
import { geo, roadMiles, isStateFallback, tollEstimate } from '../shared/usGeo.js';
import { printDispatchSheet, openPrintable } from '../shared/ui/printDoc.js';
import { mountAvatarEditor } from '../shared/ui/avatar.js';
import '../shared/ui/chatWidget.js';
import { registerAppSW } from '../shared/sw-register.js';
import { mountOfflineBanner } from '../shared/connectivity.js';


// PWA real-app behaviour: remember this portal so the installed app opens here next launch.
try { localStorage.setItem('lb_last_portal', '/app/carrier/'); } catch (_) {}

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
  urgent:  { c: '#dc2626', bg: '#fef2f2', label: 'Urgent' },
  warning: { c: '#d97706', bg: '#fffbeb', label: 'Attention' },
  action:  { c: '#0883F7', bg: '#eff6ff', label: 'Action' },
  success: { c: '#16a34a', bg: '#f0fdf4', label: 'Done' },
  info:    { c: '#475569', bg: '#f8fafc', label: 'Info' },
};
const toneOf = (t) => TONE[t] || TONE.info;
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
const pill = (s) => h('span', { class: 'cp-pill ' + (STATUS_TONE[s] || 'gray') }, (s || '').replace(/_/g, ' '));
const ic = (name) => ({
  dash: 'M3 12l9-9 9 9M5 10v10h14V10',
  // Unique per-tab icons (owner: 'teeno takriban ek jaisi' — Loads/Trips/Fleet must be distinct):
  // Loads = freight package, Trips = navigation arrow (journey), Fleet = the truck itself.
  loads: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.3 7l8.7 5 8.7-5M12 22V12',
  trips: 'M3 11l19-9-9 19-2-8-8-2z',
  truck: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M6 20a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z',
  finance: 'M12 1v22M5 5h11a3 3 0 010 6H8a3 3 0 000 6h11',
  docs: 'M6 2h9l5 5v15H6zM14 2v6h6', support: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', user: 'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8',
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
    h('div', { class: 'cp-auth-brand', style: 'display:flex;align-items:flex-start;gap:4px;margin-bottom:18px' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#FB923C;line-height:1;margin-top:7px" }, 'Carrier')]),
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
  const ccSel = h('select', { class: 'cp-in', style: 'width:88px;flex:none' }, [h('option', { value: '+1' }, '+1'), h('option', { value: '+92' }, '+92'), h('option', { value: '+44' }, '+44'), h('option', { value: '+91' }, '+91')]);
  const phone = h('input', { class: 'cp-in', type: 'tel', placeholder: 'Mobile number', autocomplete: 'tel' });
  const extra = h('div', { style: 'display:none' }, [h('label', { class: 'cp-lbl' }, 'Company'), company, h('label', { class: 'cp-lbl' }, 'Your name'), name, h('label', { class: 'cp-lbl' }, 'Mobile number'), h('div', { style: 'display:flex;gap:8px' }, [ccSel, phone])]);
  const err = h('div', { class: 'cp-err' });
  const title = h('h1', null, 'Welcome back');
  const sub = h('p', { class: 'cp-auth-sub' }, 'Sign in to your carrier portal.');
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
    title.textContent = s ? 'Create your account' : 'Welcome back';
    sub.textContent = s ? 'Set up your carrier profile — it’s free.' : 'Sign in to your carrier portal.';
    extra.style.display = s ? 'block' : 'none';
    btn.textContent = s ? 'Create account' : 'Sign in';
    err.textContent = ''; err.className = 'cp-err';
    mount(toggle, s ? [document.createTextNode('Already have an account? '), h('a', { onClick: () => setMode(false) }, 'Sign in')]
      : [document.createTextNode('New carrier? '), h('a', { onClick: () => setMode(true) }, 'Create an account')]);
  };
  btn.onclick = async () => {
    err.textContent = ''; err.className = 'cp-err';
    const em = email.value.trim(), pw = pass.value;
    if (!em || !pw) { err.textContent = 'Enter your email and password.'; return; }
    if (signup && (!company.value.trim() || !name.value.trim())) { err.textContent = 'Enter your company and your name.'; return; }
    if (signup && phone.value.replace(/\D/g, '').length < 7) { err.textContent = 'Enter a valid mobile number.'; return; }
    btn.disabled = true; btn.textContent = signup ? 'Creating…' : 'Signing in…';
    try {
      if (signup) {
        const { data, error } = await signUp(em, pw, { company: company.value.trim(), name: name.value.trim(), phone: (ccSel.value + ' ' + phone.value.trim()) });
        if (error) throw error;
        if (!data || !data.session) { err.className = 'cp-err ok'; err.textContent = 'Account created! Check your email to confirm, then sign in.'; setMode(false); btn.disabled = false; return; }
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
  const brandPanel = h('div', { class: 'cpx-auth-brand', html:
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
    + '<div style="margin-top:26px;color:#94a3b8;font-weight:500;font-size:13px;letter-spacing:.02em">The Operating System for Trucking</div>' });
  mount(root, h('div', { class: 'cp-auth' }, [
    h('div', { class: 'cpx-auth-split' }, [brandPanel,
    h('div', { class: 'cp-auth-card' }, [
      h('div', { class: 'cp-auth-brand', style: 'display:flex;align-items:flex-start;gap:4px;margin-bottom:18px' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#FB923C;line-height:1;margin-top:7px" }, 'Carrier')]),
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
    card.querySelector('h1').textContent = 'Referral partner';
    card.querySelector('.cp-auth-sub').textContent = 'This account is a referral partner account — your referrals, earnings and payouts are tracked below.';
    const panel = h('div', { class: 'cp-auth-card', style: 'margin-top:14px;text-align:left' }, [
      h('h2', { style: 'margin:0 0 4px' }, 'Your referral program'),
      h('p', { class: 'cp-auth-sub', style: 'margin-bottom:10px' }, 'Share your unique link — every carrier or broker who joins through it is credited to you, and you earn from LoadBoot’s own fee on every load they haul.'),
    ]);
    panel.appendChild(buildReferralStats(r));
    const pw = h('div'); panel.appendChild(pw); referralPayoutUI(pw, r);
    shell.appendChild(panel);
  })();
}

/* ---------- main app ---------- */
const NAV = [
  ['dashboard', 'Dashboard', 'dash'], ['health', 'Ratings', 'shield'], ['loads', 'Load Board', 'loads'], ['trips', 'My Loads', 'trips'],
  ['fleet', 'Fleet', 'truck'], ['finance', 'Finance', 'finance'], ['documents', 'Documents', 'docs'],
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

  let tab = (location.hash || '').replace('#', '') || 'dashboard';
  if (!NAV.some(n => n[0] === tab)) tab = 'dashboard';
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
      h('div', { class: 'cp-brandrow' }, brandLogo({ dark: true, sub: 'Carrier' })),
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
    titleEl.textContent = item ? item[1] : ({ notifications: 'Notifications', onboarding: 'Onboarding', settings: 'Settings' }[tab] || 'Dashboard');
    render();
  }
  window.addEventListener('hashchange', () => { const t = (location.hash || '').replace('#', ''); if (t && t !== tab && NAV.some(n => n[0] === t)) go(t); });

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
    else if (tab === 'notifications') loadNotifications();
    else if (tab === 'health') loadHealth();
    else if (tab === 'safety') loadSafety();
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
  async function loadHealth() {
    mount(content, h('div', { class: 'cp-muted' }, 'Calculating your rating…'));
    let mr = null; try { mr = await myRating(); } catch (_) { mr = null; }
    let ah; try { ah = await accountHealth(); } catch (e) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load account health.'))); return; }
    ah = ah || {}; const score = Number(ah.score || 0);
    const tone = toneOf(ah.tier === 'healthy' ? 'success' : ah.tier === 'at_risk' ? 'warning' : 'urgent');
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
          h('div', { class: 'cp-row-t', style: 'margin-top:10px;font-size:1.05rem' }, ded.length ? (ded.length + ' item(s) need attention — fixing them raises your score and your load offers.') : 'Perfect standing — you get first pick of the best-paying loads. Keep it up!'),
          h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, ah.basis || 'Score = 100 minus deductions for compliance gaps, late deliveries, disputes and missing documents.'),
        ])]),
    ]);
    const tiles = h('div', { class: 'cp-kpis' }, [
      statTile('Health score', String(score), 'shield', tone.name || (ah.tier === 'healthy' ? 'green' : ah.tier === 'at_risk' ? 'amber' : 'red')),
      statTile('Standing', (ah.tier || '—').replace(/_/g, ' '), 'dash', 'blue'),
      statTile('Points lost', '-' + lost, 'finance', lost ? 'amber' : 'green'),
      statTile('Open issues', String(ded.length), 'docs', ded.length ? 'red' : 'green', () => { const el2 = document.getElementById('cp-health-actions'); if (el2) el2.scrollIntoView({ behavior: 'smooth' }); }),
    ]);
    const actions = h('div', { class: 'cp-card', id: 'cp-health-actions' }, [
      cardHead('Suggested warnings & actions', ded.length ? lost + ' points recoverable' : 'Nothing to fix'),
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
    mount(content, h('div', null, [ratingCard, reviewsCard, tiles, heroCard, trustCard, networkCard, actions, explain].filter(Boolean)));
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
      [dash, comp, anns, invs] = await Promise.all([
        carrierDashboard().catch(() => null),
        pocketCompliance().catch(() => ({ requirements: [], mandatory_ok: ov.compliance_ok })),
        pocketAnnouncements().catch(() => []),
        pocketInvoices(50).catch(() => []),
      ]);
    } catch (_) {}
    const d = dash || {}; const k = d.kpis || {}; const acct = d.account || {};

    // 1) "Complete your setup" — gaps coloured by the GLOBAL tone tokens, each linking to the exact step.
    const gaps = Array.isArray(d.setup_gaps) ? d.setup_gaps : [];
    const setupCard = gaps.length ? h('div', { class: 'cp-card' }, [
      cardHead('Complete your setup', acct.onboarding_complete ? 'Almost there' : 'Action needed'),
      h('div', null, gaps.map(g => { const t = toneOf(g.tone); return h('button', {
        class: 'cp-rowbtn', style: 'border-left:4px solid ' + t.c + ';background:' + t.bg,
        onClick: () => go((g.route || '/account').replace('/', '')) }, [
        h('span', null, [h('span', { style: 'color:' + t.c + ';font-weight:700;margin-right:8px' }, t.label), g.label]),
        h('span', { class: 'cp-go', style: 'color:' + t.c }, '›')]); })),
    ]) : null;

    // 2) Notifications from Command Center — global tone colours, unread markers, mark-read.
    const nd = d.notifications || {}; const notes = Array.isArray(nd.recent) ? nd.recent : []; const unread = nd.unread || 0;
    const notifCard = h('div', { class: 'cp-card' }, [
      cardHead('Notifications', unread ? unread + ' unread' : 'All caught up', () => go('notifications')),
      notes.length ? h('div', null, notes.map(n => { const p = n.payload || {}; const t = toneOf(p.tone); const isUnread = !n.read_at;
        const row = h('div', { class: 'cp-row', style: 'border-left:4px solid ' + t.c + ';padding-left:10px;background:' + (isUnread ? t.bg : 'transparent') }, [
          h('div', null, [
            h('div', { class: 'cp-row-t' }, [isUnread ? h('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + t.c + ';margin-right:6px' }) : null, p.title || n.template_key || 'Notification'].filter(Boolean)),
            p.body ? h('div', { class: 'cp-row-s' }, p.body) : null].filter(Boolean)),
          isUnread ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { try { await markMyNotification(n.id); ev.currentTarget.textContent = '✓'; row.style.background = 'transparent'; } catch (_) {} } }, 'Mark read') : null].filter(Boolean));
        return row; }))
        : h('div', { class: 'cp-muted' }, 'No notifications yet.'),
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
    const _dueAmt = (invs || []).filter(i => i.status === 'sent').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const topBanners = [
      (comp && comp.mandatory_ok === false) ? h('button', { class: 'cpx-banner red', onClick: () => go('documents') }, [h('span', null, '⚠'), h('span', null, 'Please verify your compliance documents'), h('span', { class: 'cpx-b-go' }, '›')]) : null,
      _dueAmt > 0 ? h('button', { class: 'cpx-banner amber', onClick: () => go('finance') }, [h('span', null, 'ℹ'), h('span', null, money(_dueAmt) + ' in dispatch fees due'), h('span', { class: 'cpx-b-go' }, '›')]) : null,
    ].filter(Boolean);
    mount(content, h('div', null, [...topBanners, kpis, acctStrip, setupCard, promptHost, ...annCards, h('div', { class: 'cp-grid' }, [notifCard, tripsCard, financeCard])].filter(Boolean)));
    openPrompts();
  }

  /* ----- Available loads (Phase 2B — real, race-safe booking) ----- */
  async function loadLoads() {
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
    // Post-a-Truck: silent background scan picks up new matches for active postings.
    (async () => { try { await scanTruckMatches(); refreshUnread(); } catch (_) {} })();
    let postings = []; try { postings = await myTruckPostings(); } catch (_) { postings = []; }
    let _pk = null; try { _pk = await myOnboardingPacket(); } catch (_) {}
    const hazVerified = !!((_pk && _pk.items) || []).find(x => x.key === 'hazmat_cert' && x.status === 'verified');
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
    // AI Pilot — "best for you": same open loads, ranked for THIS carrier by rate vs your stated
    // target, deadhead from your real last GPS, and your saved preferences. Every score is itemized.
    let best = null; try { best = await carrierBestLoads(null, 3); } catch (e) { best = null; }
    const bestCard = (best && best.loads && best.loads.length) ? h('section', { class: 'cp-card', style: 'margin-bottom:12px' }, [
      h('div', { class: 'cp-row-s', style: 'display:flex;justify-content:space-between;align-items:center' }, [
        h('b', null, '⭐ Best for you (AI Pilot)'),
        h('span', { class: 'cp-muted', style: 'font-size:12px' }, best.last_location_basis || ''),
      ]),
      h('div', null, best.loads.map((b, i) => h('div', { style: 'padding:8px 0;border-top:1px solid var(--lb-border, #e2e8f0)' }, [
        h('div', { style: 'display:flex;justify-content:space-between' }, [
          h('b', null, (i === 0 ? '1. ' : (i + 1) + '. ') + b.lane),
          h('b', null, b.score + '/100'),
        ]),
        h('div', { class: 'cp-muted', style: 'font-size:12px' },
          [(b.rate != null ? '$' + Number(b.rate).toLocaleString() : null), (b.loaded_rpm != null ? '$' + b.loaded_rpm + '/mi' : null),
           (b.deadhead_miles != null ? '~' + b.deadhead_miles + ' mi deadhead (est.)' : 'deadhead unknown'),
           (b.factors && b.factors[0] ? b.factors[0].detail : null)].filter(Boolean).join(' · ')),
      ]))),
      h('div', { class: 'cp-muted', style: 'font-size:11px;margin-top:6px' }, 'Ranked by your stated minimum rate, real last GPS location and saved preferences — set them under Account. Estimates are labeled; nothing is invented.'),
    ]) : null;
    let setupBanner = null;
    try {
      const dp0 = await getDispatchPrefs();
      const prefsOk = !!(dp0 && dp0.min_rpm && (dp0.preferred_equipment || []).length && (dp0.preferred_lanes || []).length && dp0.home_base);
      let compOk = true;
      try { const ah0 = await accountHealth(); compOk = !((ah0.deductions || []).some(x => /mandatory compliance/i.test(x.label || ''))); } catch (_) {}
      if (!prefsOk || !compOk) {
        setupBanner = h('div', { class: 'cp-card', style: 'border-left:4px solid #d97706;margin-bottom:12px' }, [
          h('div', { class: 'cp-row-t', style: 'font-size:1.05rem' }, '\u26a0 Complete your setup to start booking loads'),
          h('div', { class: 'cp-row-s', style: 'margin:6px 0' }, [!prefsOk ? 'Set your minimum rate, equipment, lanes and home base.' : null, !compOk ? 'Upload and verify your compliance documents (authority, insurance, required documents).' : null].filter(Boolean).join(' ')),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
            !prefsOk ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('account') }, 'Complete account setup') : null,
            !compOk ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => go('documents') }, 'Upload documents') : null,
          ].filter(Boolean)),
        ]);
      }
    } catch (_) {}
    if (!rows || !rows.length) { mount(content, h('div', null, [truckCard, setupBanner, bestCard, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No available loads right now. Check back soon.'))].filter(Boolean))); return; }
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
              h('button', { class: 'cp-btn', style: 'margin-top:16px', onClick: () => { closeV(); go('documents'); } }, 'Upload documents →'),
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
        if (!confirm('Request to book this load?\n\n' + (l.origin || '') + ' → ' + (l.destination || '') + '\n' + money(l.rate) + (rpm ? ' · ' + rpm : '') + '\n\nThe broker reviews your verified trust profile and approves or declines. Nothing moves and you are not committed until approved.')) return;
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending request…';
        try {
          await requestBookLoad(l.id);
          mount(bookWrap, [h('div', { class: 'cp-row-s', style: 'color:#d97706;font-weight:700;margin-bottom:4px' }, '\u23f3 Requested — pending broker approval'), h('div', { class: 'cp-row-s' }, 'You will be notified when the broker responds. Once approved it appears in My trips.')]);
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Request to book'; alert((e && e.message) || 'Could not send your request.'); }
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
          l.delivery_date ? h('span', { class: 'cpx-chip' }, 'DEL ' + l.delivery_date) : null,
        ].filter(Boolean)),
        h('div', { class: 'cpx-route' }, [
          h('div', { class: 'cpx-pt' }, [h('span', { class: 'cpx-dot' }), h('span', null, l.origin || '—')]),
          h('div', { class: 'cpx-pt to' }, [h('span', { class: 'cpx-dot' }), h('span', null, [String(l.destination || '—'), l.miles ? h('span', { class: 'sub' }, '  ·  ' + Number(l.miles).toLocaleString() + ' mi') : null].filter(Boolean))]),
        ]),
        meta.length ? h('div', { class: 'cp-load-meta' }, meta.join(' · ')) : null,
        l.requirements ? h('div', { class: 'cp-row-s' }, l.requirements) : null,
        h('div', { class: 'cpx-req-actions' }, [bookWrap, detailsBtn]),
        h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:8px;width:100%', onClick: (ev) => {
          if (advW.firstChild) { advW.innerHTML = ''; return; }
          advW.appendChild(h('div', { class: 'cp-muted' }, '📍 Getting your location for real deadhead…'));
          const done = (pos) => buildAdvisor(pos);
          if (navigator.geolocation) navigator.geolocation.getCurrentPosition(done, () => done(null), { enableHighAccuracy: true, timeout: 8000 });
          else done(null);
        } }, '⚡ LoadBoot Match — why it fits you'),
        advW,
      ].filter(Boolean));
    })();
    const gridHost = h('div', { class: 'cp-loadgrid', id: 'cp-loadgrid-host' });
    mount(content, h('div', null, [truckCard, filterBar, setupBanner, bestCard, gridHost].filter(Boolean)));
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
      t.instructions ? h('div', { style: 'margin:8px 0' }, [h('div', { class: 'cp-row-t' }, 'Instructions'), h('div', { class: 'cp-row-s' }, t.instructions)]) : null,
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
    if (!rows || !rows.length) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No trips yet. Booked loads will appear here.'))); return; }
    mount(content, h('div', { class: 'cp-card' }, [cardHead('My trips', rows.length + ' total'), ...rows.map(t => {
      const active = t.status === 'dispatched' || t.status === 'in_transit';
      const confirm = (t.status === 'dispatched') ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { ev.currentTarget.disabled = true; try { await pocketConfirmTrip(t.id); ev.currentTarget.textContent = 'Confirmed ✓'; } catch (x) { ev.currentTarget.textContent = 'Error'; } } }, 'Confirm') : null;
      const share = active ? h('button', { class: 'cp-btn cp-btn-sm', onClick: (ev) => shareLoc(ev, t.id) }, '📍 Share location') : null;
      const nav = (active && t.destination) ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(t.destination), '_blank', 'noopener') }, '🧭 Navigate') : null;
      const live = active ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: (ev) => toggleLiveLoc(ev, t.id) }, (_liveWatch != null && _liveTrip === t.id) ? '🛰 Tracking ON — tap to stop' : '🛰 Live tracking') : null;
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
      const start = (t.status === 'dispatched') ? advBtn('▶ Start trip', 'in_transit') : null;
      const deliver = (t.status === 'dispatched' || t.status === 'in_transit') ? advBtn('✓ Mark delivered', 'delivered') : null;
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
        dwellW.appendChild(h('div', { class: 'cp-inlineform' }, [
          mk('At pickup', () => tripArrive(t.id, 'pickup')),
          mk('Left pickup', () => tripDepart(t.id, 'pickup')),
          mk('At delivery', () => tripArrive(t.id, 'delivery')),
          mk('Left delivery', () => tripDepart(t.id, 'delivery')),
        ]));
        dwellW.appendChild(h('div', { class: 'cp-row-s' }, 'Times are recorded when you tap — this is what protects your detention pay.'));
      } }, '⏱ Arrive / depart') : null;
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
      return h('div', { class: 'cp-trip' }, [
        h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, (t.origin || '—') + ' → ' + (t.destination || '—')), h('div', { class: 'cp-row-s' }, money(t.rate || 0))]), pill(t.status)]),
        tripStepper(t.status),
        h('div', { class: 'cp-trip-actions' }, [confirm, start, deliver, nav, share, live, dwell, issue, emergency, pod, settleBtn, reloadBtn, rateBtn, assign, history, sheetBtn, rcBtn, packBtn].filter(Boolean)), fw, podW, dwellW, reloadW, rateW,
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
        h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => driverForm(d) }, 'Edit'),
      ]),
      d.license_exp ? h('div', { class: 'cp-row-s' }, 'License expires ' + d.license_exp + (d.medical_exp ? ' · Medical ' + d.medical_exp : '')) : null,
    ].filter(Boolean)))) : h('div', { class: 'cp-muted' }, 'No drivers yet. Add your first driver.'));
    const renderTrucks = () => mount(truckList, trucks.length ? h('div', null, trucks.map(t => h('div', { class: 'cp-trip' }, [
      h('div', { class: 'cp-trip-head' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, 'Unit ' + t.unit_no), h('div', { class: 'cp-row-s' }, [t.equipment, t.plate ? 'Plate ' + t.plate : null].filter(Boolean).join(' · ') || '—')]),
        h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => truckForm(t) }, 'Edit'),
      ]),
    ]))) : h('div', { class: 'cp-muted' }, 'No trucks yet. Add your first truck.'));

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
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try {
          await pocketUpsertDriver({ id: d && d.id, name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim(), licenseNo: lic.value.trim(), licenseState: st.value.trim().toUpperCase(), licenseExp: lexp.value || null, medicalExp: mexp.value || null });
          drivers = await pocketDrivers(); renderDrivers();
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save');
      openModal((d ? 'Edit driver' : 'Add driver'), [name, phone, email, h('div', { class: 'cp-formrow2' }, [lic, st]), h('label', { class: 'cp-row-s' }, 'License expiry'), lexp, h('label', { class: 'cp-row-s' }, 'Medical expiry'), mexp, save]);
    }
    function truckForm(t) {
      const unit = h('input', { class: 'cp-in', placeholder: 'Unit number', value: (t && t.unit_no) || '' });
      const plate = h('input', { class: 'cp-in', placeholder: 'Plate', value: (t && t.plate) || '' });
      const vin = h('input', { class: 'cp-in', placeholder: 'VIN', value: (t && t.vin) || '' });
      const eq = h('select', { class: 'cp-in' }, ['', 'Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Hotshot', 'Power Only', 'Box Truck'].map(o => h('option', { value: o, selected: t && t.equipment === o ? 'selected' : null }, o || 'Equipment…')));
      const svc = h('input', { class: 'cp-in', type: 'date', value: (t && t.next_service_date) || '' });
      const insp = h('input', { class: 'cp-in', type: 'date', value: (t && t.inspection_exp) || '' });
      const save = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!unit.value.trim()) { alert('Unit number is required.'); return; }
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try {
          await pocketUpsertTruck({ id: t && t.id, unitNo: unit.value.trim(), plate: plate.value.trim(), vin: vin.value.trim(), equipment: eq.value || null });
          trucks = await pocketTrucks();
          const saved = t && t.id ? t : trucks.find(x => x.unit_no === unit.value.trim());
          if (saved && saved.id && (svc.value || insp.value)) { try { await truckSetMaintenance(saved.id, svc.value || null, insp.value || null); } catch (_) {} }
          renderTrucks();
        }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save');
      openModal((t ? 'Edit truck' : 'Add truck'), [unit, plate, vin, eq,
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
    mount(content, h('div', null, [
      alertHost,
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
    mount(content, h('div', null, [
      h('div', { class: 'cp-kpis' }, [statTile('Fees due', money(due), 'finance', 'amber'), statTile('Fees paid', money(paid), 'dash', 'green'), statTile('Gross hauled', money(gross), 'trips', 'blue'), statTile('Invoices', String(rows.length), 'docs', 'violet')]),
      expCard,
      iftaCard,
      pnlCard,
      tripPnlCard,
      payrollCard,
      stmtCard,
      h('div', { class: 'cp-grid' }, [
        h('div', { class: 'cp-card cp-col2' }, [cardHead('Dispatch fees over time'), series.length ? miniBars(series, { height: 84 }) : h('div', { class: 'cp-muted' }, 'No data yet.')]),
        h('div', { class: 'cp-card' }, [cardHead('Invoice status'), h('div', { class: 'cp-donut-wrap' }, [donut(statusParts), h('div', { class: 'cp-donut-leg' }, statusParts.map(p => h('div', null, [h('i', { style: 'background:' + p.color }), p.label + ' · ' + p.value])))])]),
      ]),
      h('div', { class: 'cp-card' }, [cardHead('Invoices'), rows.length ? h('div', null, rows.map(i => {
        const dw = h('div');
        const dispute = (i.status === 'sent' || i.status === 'paid') ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
          if (dw.firstChild) { dw.innerHTML = ''; return; }
          const reason = h('input', { class: 'cp-in', placeholder: 'Reason for dispute' });
          const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { if (!reason.value.trim()) { alert('Enter a reason.'); return; } ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…'; try { await pocketDisputeInvoice(i.id, reason.value.trim()); dw.innerHTML = ''; dw.appendChild(h('div', { class: 'cp-row-s', style: 'color:var(--lb-green)' }, '✓ Dispute opened')); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send'; alert((e && e.message) || 'Could not dispute.'); } } }, 'Send');
          dw.appendChild(h('div', { class: 'cp-inlineform' }, [reason, send]));
        } }, 'Dispute') : null;
        const invPdf = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7', onClick: () => openPrintable('Invoice ' + (i.invoice_no || ''), 'INVOICE', [
          { rows: [['Invoice #', i.invoice_no || '—'], ['Status', i.status || '—'], ['Load', i.load_ref || i.load_id || '—'], ['Lane', i.lane || '—'], ['Issued', i.created_at ? new Date(i.created_at).toLocaleDateString() : '—'], ['Due', i.due_at ? new Date(i.due_at).toLocaleDateString() : '—']] },
          { h: 'Amounts', rows: [['Load gross', money(i.gross || 0)], ['Dispatch fee (5%)', money(i.fee || 0)], ['Carrier net', money(Number(i.gross || 0) - Number(i.fee || 0))]] },
          { note: 'LoadBoot flat 5% dispatch fee — no contracts. Questions? Contact support in your carrier portal.' },
        ]) }, '⬇ PDF');
        return h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, i.invoice_no), h('div', { class: 'cp-row-s' }, 'Fee ' + money(i.fee) + ' · gross ' + money(i.gross))]), pill(i.status)]), h('div', { class: 'cp-trip-actions' }, [invPdf, dispute].filter(Boolean)), dw].filter(Boolean));
      })) : h('div', { class: 'cp-muted' }, 'No invoices yet.')]),
    ]));
  }

  /* ----- Documents & compliance ----- */
  const DOC_TYPES = [['insurance', 'Insurance / COI'], ['authority', 'Operating authority'], ['w9', 'W-9'], ['noa', 'Notice of assignment'], ['agreement', 'Signed agreement'], ['rate_con', 'Rate confirmation'], ['bol', 'Bill of lading'], ['pod', 'Proof of delivery'], ['other', 'Other']];
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
        fileIn.value = ''; msg.className = 'cp-err ok'; msg.textContent = '✓ Uploaded — your dispatcher will review it.';
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
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Verifying with FMCSA\u2026'; msg.textContent = '';
        try {
          const d = await fmcsaVerify({ mc: mc || null, dot: dot || null });
          const g = (k) => (d && (d[k] != null ? d[k] : (d.result && d.result[k])));
          mount(res, h('div', { class: 'cp-card', style: 'margin-top:8px' }, [
            h('div', { class: 'cp-row' }, [h('span', null, 'Authority'), h('b', null, String(g('authority_status') || g('operating_status') || g('allowed_to_operate') || 'checked'))]),
            h('div', { class: 'cp-row' }, [h('span', null, 'Safety rating'), h('span', null, String(g('safety_rating') || 'none'))]),
            h('div', { class: 'cp-row' }, [h('span', null, 'Out of service'), h('span', null, String(g('out_of_service') != null ? g('out_of_service') : 'No'))]),
            h('div', { class: 'cp-row-s' }, 'Live from FMCSA (SAFER/QCMobile) via MC/DOT \u2014 no PDF needed.'),
          ]));
          msg.className = 'cp-err ok'; msg.textContent = '\u2713 FMCSA verified \u2014 sent to your dispatcher for approval.';
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Verify with FMCSA'; msg.className = 'cp-err'; msg.textContent = (e && e.message) || 'FMCSA verification failed \u2014 try again or upload the authority letter instead.'; }
      } }, 'Verify with FMCSA');
      const upl = h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:8px', onClick: () => uploadFor(r) }, 'Or upload authority letter (PDF) instead');
      openModal('Operating authority \u2014 verify with FMCSA', [
        h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'Enter EITHER your MC or your USDOT \u2014 one is enough. We verify it live from FMCSA; no document upload needed.'),
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
      const signAgr = () => import('./dispatch-agreement.js').then((m) => m.openSignModal({ openModal: openModal, toast: (msg) => alert(msg) }, { carrier: _agrCarrier }, () => loadDocuments()));
      const dlAgr = async () => { let sig = {}; try { sig = (await carrierAgreementSignature()) || {}; } catch (_) {} const m = await import('./dispatch-agreement.js'); m.printExecutedAgreement({ carrier: _agrCarrier, signer: (sig && sig.signer_name) || '', date: (sig && sig.signed_date) || '', approved: r.status === 'valid' }); };
      const isW9 = (r.doc_type === 'w9') || r.requirement_key === 'w9' || /\bw-?9\b/i.test(r.name || '');
      const startW9 = () => import('./w9-form.js').then((m) => m.openW9Wizard({ openModal: openModal, toast: (msg) => alert(msg) }, { carrier: _agrCarrier }, () => loadDocuments()));
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
    const sorted = reqs.slice().sort((a, b) => ({ urgent: 0, action: 1, warning: 2, success: 3 }[reqTone(a).t] - { urgent: 0, action: 1, warning: 2, success: 3 }[reqTone(b).t]));
    mount(content, h('div', null, [scanCard, 
      h('div', { class: 'cp-card' }, [cardHead('What LoadBoot needs from you',
          c && c.mandatory_ok && !needAttention ? 'All required documents are in ✓'
            : (needAttention ? needAttention + ' required item' + (needAttention > 1 ? 's' : '') + ' need' + (needAttention > 1 ? '' : 's') + ' attention' : 'Some documents still needed')),
        sorted.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, sorted.map(reqRow)) : h('div', { class: 'cp-muted' }, 'No requirements listed.')]),
      h('div', { class: 'cp-grid' }, [
        h('div', { class: 'cp-card' }, [cardHead('Upload a document'), h('p', { class: 'cp-row-s', style: 'margin-bottom:6px' }, 'PDF or photo, up to 25 MB. Stored privately; only you and LoadBoot staff can see it.'), typeSel, fmtLine, fileIn, msg, up]),
        h('div', { class: 'cp-card' }, [cardHead('My documents'), listWrap]),
      ]),
    ]));
    async function loadList() {
      mount(listWrap, h('div', { class: 'cp-muted' }, 'Loading…'));
      let docs; try { docs = await carrierListDocuments(); } catch (e) { mount(listWrap, h('div', { class: 'cp-muted' }, 'Could not load.')); return; }
      const label = (t) => (DOC_TYPES.find(d => d[0] === t) || [t, t])[1];
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
    const send = h('button', { class: 'cp-btn', onClick: async () => { msg.textContent = ''; if (!subj.value.trim()) { msg.textContent = 'Subject is required.'; return; } send.disabled = true; send.textContent = 'Sending…'; try { await pocketRaiseIssue(subj.value.trim(), body.value.trim()); subj.value = ''; body.value = ''; msg.className = 'cp-err ok'; msg.textContent = 'Sent — we’ll get back to you.'; await loadIssues(); } catch (e) { msg.className = 'cp-err'; msg.textContent = (e && e.message) || 'Could not send.'; } send.disabled = false; send.textContent = 'Send to dispatch'; } }, 'Send to dispatch');
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
      h('div', { class: 'cp-card' }, [cardHead('Raise an issue'), subj, body, msg, send]),
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
    const f = Object.assign({ company: '', contact_name: '', phone: '', mc: '', dot: '', home_base: '', radius_miles: '', equipment_types: [], truck_count: '', hazmat: false, weekend_ok: false, factoring_status: '', factoring_company: '', contact_method: '', whatsapp: '', bank_name: '', account_title: '', account_number: '', routing_number: '' }, prof || {});
    if (!Array.isArray(f.equipment_types)) f.equipment_types = [];
    let st = 0; let fmcsaRes = null;
    // Dispatch preferences are REQUIRED at onboarding (drive best-match loads + CC AI matching);
    // the carrier can change them any time later in Account.
    const dpf = { min_rpm: '', preferred_equipment: '', preferred_lanes: '', max_deadhead_miles: '', home_base: '' };
    (async () => { try { const dp = await getDispatchPrefs(); if (dp) { dpf.min_rpm = dp.min_rpm || ''; dpf.preferred_equipment = (dp.preferred_equipment || []).join(', '); dpf.preferred_lanes = (dp.preferred_lanes || []).join(', '); dpf.max_deadhead_miles = dp.max_deadhead_miles || ''; dpf.home_base = dp.home_base || ''; } } catch (_) {} })();
    function prefsStep() {
      const fldp = (label, key, ph, type) => { const i = h('input', { class: 'cp-in', type: type || 'text', placeholder: ph || '', value: dpf[key] == null ? '' : dpf[key] }); i.oninput = () => { dpf[key] = i.value; }; return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), i]); };
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
      await setDispatchPrefs({ min_rpm: dpf.min_rpm, preferred_equipment: eq, preferred_lanes: ln,
        max_deadhead_miles: dpf.max_deadhead_miles || null, home_base: (dpf.home_base || f.home_base || '').trim() || null });
    }
    async function saveBankStep() {
      const filled = f.bank_name || f.account_title || f.account_number || f.routing_number;
      const factoring = String(f.factoring_status || '') === 'yes';
      if (!filled) { if (factoring) return; throw new Error('Add your bank account for payouts (or select factoring above).'); }
      if (!f.bank_name || !f.account_title || !f.account_number || !f.routing_number) throw new Error('Please complete all bank fields.');
      if (!/^\d{9}$/.test(String(f.routing_number).trim())) throw new Error('Routing number must be 9 digits.');
      await setMyPaymentProfile({ bank_name: String(f.bank_name).trim(), account_title: String(f.account_title).trim(), account_number: String(f.account_number).trim(), routing_number: String(f.routing_number).trim(), payment_method: 'ach' });
    }
    const host = h('div', { class: 'cp-card cp-wiz' });
    const field = (label, key, ph, type) => { const i = h('input', { class: 'cp-in', type: type || 'text', placeholder: ph || '', value: f[key] == null ? '' : f[key] }); i.oninput = () => { f[key] = i.value; }; return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), i]); };
    const selectField = (label, key, opts) => { const s = h('select', { class: 'cp-in' }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v ? 'selected' : null }, l))); s.onchange = () => { f[key] = s.value; }; return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), s]); };
    const toggle = (label, key) => { const b = h('button', { class: 'cp-chip2' + (f[key] ? ' on' : ''), onClick: () => { f[key] = !f[key]; b.classList.toggle('on'); } }, label); return h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, label), b]); };
    function save() {
      return pocketSaveProfile({ company: f.company, contactName: f.contact_name, phone: f.phone, mc: f.mc, dot: f.dot, homeBase: f.home_base, radiusMiles: f.radius_miles ? Number(f.radius_miles) : null, equipmentTypes: (f.equipment_types && f.equipment_types.length) ? f.equipment_types : null, truckCount: f.truck_count ? String(f.truck_count) : null, hazmat: !!f.hazmat, weekendOk: !!f.weekend_ok, factoringStatus: f.factoring_status, factoringCompany: f.factoring_company, contactMethod: f.contact_method, whatsapp: f.whatsapp });
    }
    function docStep() {
      const types = [['w9', 'W-9'], ['authority', 'Operating authority'], ['noa', 'Insurance / COI'], ['agreement', 'Signed agreement'], ['other', 'Other']];
      const typeSel = h('select', { class: 'cp-in' }, types.map(([v, l]) => h('option', { value: v }, l)));
      const fileIn = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx' });
      const msg = h('div', { class: 'cp-err' });
      const list = h('div'); const refresh = async () => { try { const ds = await carrierListDocuments(); mount(list, (ds && ds.length) ? h('div', null, ds.map(d => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, d.file_name), pill(d.status || 'pending')]))) : h('div', { class: 'cp-muted' }, 'No documents yet.')); } catch (_) {} };
      const up = h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { const file = fileIn.files && fileIn.files[0]; msg.textContent = ''; msg.className = 'cp-err'; if (!file) { msg.textContent = 'Choose a file.'; return; } up.disabled = true; up.textContent = 'Uploading…'; try { const m = await uploadDocument(file, typeSel.value); await carrierUploadDocument({ type: typeSel.value, fileName: m.fileName, filePath: m.path }); fileIn.value = ''; msg.className = 'cp-err ok'; msg.textContent = '✓ Uploaded.'; await refresh(); } catch (e) { msg.className = 'cp-err'; msg.textContent = (e && e.message) || 'Upload failed.'; } up.disabled = false; up.textContent = 'Upload'; } }, 'Upload');
      refresh();
      const w9Btn = h('button', { class: 'cp-btn cp-btn-sm', onClick: () => import('./w9-form.js').then((m) => m.openW9Wizard({ openModal: openModal, toast: (msg) => alert(msg) }, { carrier: f.company }, () => refresh())) }, 'Complete W-9 in-app');
      const agrBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: () => import('./dispatch-agreement.js').then((m) => m.openSignModal({ openModal: openModal, toast: (msg) => alert(msg) }, { carrier: f.company }, () => refresh())) }, 'Sign dispatch agreement');
      return h('div', null, [h('p', { class: 'cp-row-s' }, 'Complete these in-app \u2014 no PDF needed \u2014 or upload your own files below.'), h('div', { class: 'cp-inlineform', style: 'margin-bottom:10px' }, [w9Btn, agrBtn]), h('p', { class: 'cp-row-s' }, 'Or upload your W-9, authority letter, insurance/COI and signed agreement. PDF or photo, up to 25 MB each.'), h('div', { class: 'cp-inlineform' }, [typeSel, fileIn, up, msg]), h('div', { style: 'margin-top:10px' }, list)]);
    }
    function reviewStep() {
      const row = (k, v) => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, k), h('span', null, v || '—')]);
      return h('div', null, [h('p', { class: 'cp-row-s' }, 'Check your details, then submit. Our team reviews and approves your account.'), row('Company', f.company), row('Contact', f.contact_name + (f.phone ? ' · ' + f.phone : '')), row('MC / DOT', (f.mc || '—') + ' / ' + (f.dot || '—')), row('Home base', f.home_base), row('Equipment', (f.equipment_types || []).join(', ')), row('Trucks', f.truck_count), row('Factoring', f.factoring_status + (f.factoring_company ? ' · ' + f.factoring_company : '')), row('Payout', f.bank_name ? (f.bank_name + ' ····' + String(f.account_number || '').slice(-4)) : (String(f.factoring_status) === 'yes' ? 'Via factoring' : '—')), row('Dispatch prefs', (dpf.min_rpm ? '$' + dpf.min_rpm + '/mi min' : '—') + (dpf.preferred_lanes ? ' · ' + dpf.preferred_lanes : ''))]);
    }
    function doneCard() { return [h('div', { class: 'cp-wiz-done' }, [h('div', { style: 'font-size:2.4rem' }, '✓'), h('h3', null, 'Submitted for review'), h('p', { class: 'cp-row-s' }, 'Thanks! Our team is reviewing your onboarding. You’ll get a notification when it’s approved.'), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('dashboard') }, 'Back to dashboard')])]; }
    function draw() {
      const pct = Math.round((st / (STEPS.length - 1)) * 100);
      let body;
      if (st === 0) {
        const vmsg = h('div', { class: 'cp-err' });
        const g = (k) => fmcsaRes ? (fmcsaRes[k] != null ? fmcsaRes[k] : (fmcsaRes.result && fmcsaRes.result[k])) : null;
        const resCard = fmcsaRes ? h('div', { class: 'cp-card', style: 'margin-top:8px' }, [
          h('div', { class: 'cp-row' }, [h('span', null, 'Legal name'), h('b', null, String(g('legal_name') || g('name') || f.company || '\u2014'))]),
          h('div', { class: 'cp-row' }, [h('span', null, 'Authority'), h('b', null, String(g('authority_status') || g('operating_status') || g('allowed_to_operate') || 'checked'))]),
          h('div', { class: 'cp-row' }, [h('span', null, 'Safety rating'), h('span', null, String(g('safety_rating') || 'none'))]),
          h('div', { class: 'cp-row-s' }, '\u2713 Live from FMCSA (SAFER/QCMobile). Verified authority strengthens your profile.'),
        ]) : null;
        const vbtn = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:6px', onClick: async (ev) => {
          const mc = String(f.mc || '').trim(), dot = String(f.dot || '').trim();
          if (!mc && !dot) { vmsg.className = 'cp-err'; vmsg.textContent = 'Enter your MC or DOT number first.'; return; }
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Verifying with FMCSA\u2026';
          try { const dd = await fmcsaVerify({ mc: mc || null, dot: dot || null }); fmcsaRes = dd || {}; const nm = (fmcsaRes.legal_name || fmcsaRes.name || (fmcsaRes.result && (fmcsaRes.result.legal_name || fmcsaRes.result.name))); if (nm && !f.company) f.company = nm; draw(); }
          catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Verify with FMCSA'; vmsg.className = 'cp-err'; vmsg.textContent = (e && e.message) || 'FMCSA verification failed \u2014 you can still continue and upload your authority letter.'; }
        } }, 'Verify with FMCSA');
        body = h('div', null, [h('div', { class: 'cp-wiz-grid' }, [field('Company / carrier name', 'company', 'Acme Trucking LLC'), field('Your name', 'contact_name'), field('Phone', 'phone'), field('MC number', 'mc', '123456'), field('DOT number', 'dot', '1234567')]), h('p', { class: 'cp-row-s', style: 'margin-top:8px' }, 'Verify your authority live with FMCSA \u2014 no PDF needed.'), vbtn, vmsg, resCard].filter(Boolean));
      }
      else if (st === 1) { const eq = h('div', { class: 'cp-eqgrid' }, EQUIP.map(e => { const on = (f.equipment_types || []).includes(e); const b = h('button', { class: 'cp-chip2' + (on ? ' on' : ''), onClick: () => { const s = new Set(f.equipment_types || []); if (s.has(e)) s.delete(e); else s.add(e); f.equipment_types = [...s]; b.classList.toggle('on'); } }, e); return b; })); body = h('div', { class: 'cp-wiz-grid' }, [field('Home base (city, ST)', 'home_base', 'Dallas, TX'), field('Search radius (miles)', 'radius_miles', '300', 'number'), field('Number of trucks', 'truck_count', '1'), h('div', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Equipment types'), eq]), toggle('Haul hazmat', 'hazmat'), toggle('Available weekends', 'weekend_ok')]); }
      else if (st === 2) body = h('div', { class: 'cp-wiz-grid' }, [selectField('Factoring', 'factoring_status', [['', '—'], ['yes', 'I use factoring'], ['no', 'No factoring'], ['interested', 'Interested']]), field('Factoring company', 'factoring_company'), selectField('Preferred contact', 'contact_method', [['', '—'], ['phone', 'Phone'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email']]), field('WhatsApp number', 'whatsapp'), h('div', { class: 'cp-fld', style: 'grid-column:1/-1' }, [h('span', { class: 'cp-row-t' }, 'Bank account for settlement payouts'), h('span', { class: 'cp-row-s' }, 'Encrypted & tokenized. Not required if you use a factoring company.')]), field('Bank name', 'bank_name', 'e.g. Chase'), field('Account holder / title', 'account_title', 'Legal business name'), field('Account number', 'account_number'), field('Routing number (ABA)', 'routing_number', '9 digits')]);
      else if (st === 3) body = prefsStep();
      else if (st === 4) body = docStep();
      else body = reviewStep();
      const back = st > 0 ? h('button', { class: 'cp-btn ghost cp-btn-sm', onClick: () => { st--; draw(); } }, '← Back') : h('span');
      const next = st < STEPS.length - 1
        ? h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…'; try { if (st === 2) await saveBankStep(); if (st === 3) await savePrefsStep(); await save(); st++; draw(); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save & continue'; alert((e && e.message) || 'Could not save.'); } } }, 'Save & continue')
        : h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Submitting…'; try { await save(); await pocketSubmitOnboarding(); mount(host, doneCard()); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Submit for review'; alert((e && e.message) || 'Could not submit.'); } } }, 'Submit for review');
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
    const card = h('div', { class: 'cp-card' }, [cardHead('Notifications', rows.filter(n => !n.read_at).length + ' unread'), ...rows.map(n => {
      const p = n.payload || {};
      // Owner: every notification carries the official LoadBoot mark (real asset, not a text card),
      // with a tone-colored ring — like a native push notification showing the app icon.
      const toneCol = p.tone === 'urgent' ? '#dc2626' : p.tone === 'success' ? '#16a34a' : '#0883F7';
      const row = h('div', { class: 'cp-row cp-notif' + (n.read_at ? '' : ' unread'), style: 'align-items:flex-start;gap:12px', onClick: async () => { if (!n.read_at) { try { await pocketMarkNotificationRead(n.id); n.read_at = new Date().toISOString(); row.classList.remove('unread'); refreshUnread(); } catch (_) {} } if (p.url) location.hash = (p.url.split('#')[1] || ''); } }, [
        h('span', { html: '<img src="/icon-512.png" width="34" height="34" alt="LoadBoot" style="display:block;border-radius:9px;box-shadow:0 0 0 2px ' + toneCol + '33">', style: 'flex:none;line-height:0;margin-top:2px' }),
        h('div', { style: 'min-width:0;flex:1' }, [h('div', { class: 'cp-row-t' }, p.title || n.template_key || 'Notification'), p.body ? h('div', { class: 'cp-row-s' }, p.body) : null].filter(Boolean)),
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
  appView(user);
}

boot();
