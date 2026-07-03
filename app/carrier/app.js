// app.js — LoadBoot Carrier Portal. A full, responsive carrier-facing web app:
// desktop shows a sidebar dashboard; mobile collapses to a bottom tab bar. Carriers
// sign in / self-register, then see ONLY their own data via self-scoping cc_pocket_*
// RPCs (the server resolves the carrier org from the session — no carrier-id param,
// so cross-carrier access is impossible). Admin/staff use the Command Center.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signUp, signOut, onAuthChange } from '../shared/session.js';
import {
  pocketOverview, pocketTrips, pocketInvoices, pocketCompliance, pocketConfirmTrip,
  pocketSetConsent, pocketPostLocation, pocketRaiseIssue, pocketMyIssues, pocketAnnouncements,
  pocketReportIssue, pocketDisputeInvoice, publicLoadOpportunities, pocketUploadPod, pocketTripPods,
  pocketDrivers, pocketUpsertDriver, pocketTrucks, pocketUpsertTruck, pocketTeam, pocketSetMember,
  pocketFleetAlerts, pocketStatement, pocketTripTimeline, pocketMyExceptions, pocketAssignTrip, pocketAdvanceTrip,
  carrierUploadDocument, carrierListDocuments,
  pocketGetProfile, pocketSaveProfile, pocketSubmitOnboarding,
  pocketGetPreferences, pocketSavePreferences,
  pocketAvailableLoads, pocketBookLoad, requestBookLoad, carrierBestLoads, getDispatchPrefs, setDispatchPrefs, tripArrive, tripDepart,
  isFlagEnabled, myReferral, claimReferral, myReferralEarnings, referralRequestPayout, myPayoutRequests,
  setMyPaymentProfile, myPaymentProfile, carrierViewPoster, accountHealth, myTrustProfile, myApprovedPartners, setMyServices, myServices, dispatchSheet, myRateConfirmation, acknowledgeRC, deliveryDocPack, prebookCheck, myOnboardingPacket, onboardingSubmitItem,
  carrierPnl, carrierAddExpense, carrierExpenses, carrierDeleteExpense,
  pocketNotifications, pocketMarkNotificationRead,
  carrierDashboard, myNotifications, markMyNotification, carrierLoadDetail,
  tripEmergencyRequest, tripMyEmergencies,
  fleetServiceAdd, fleetServiceList, fleetServiceDelete,
  payrollAdd, payrollList, payrollMarkPaid, payrollDelete,
} from '../shared/api.js';
import { uploadDocument, uploadPodDocument } from '../shared/storage.js';
import { enablePush, isPushEnabled, pushSupported } from '../shared/push.js';
import { printDispatchSheet, openPrintable } from '../shared/ui/printDoc.js';
import { mountAvatarEditor } from '../shared/ui/avatar.js';
import '../shared/ui/chatWidget.js';
import { registerAppSW } from '../shared/sw-register.js';
import { mountOfflineBanner } from '../shared/connectivity.js';

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
const STATUS_TONE = { planned: 'gray', dispatched: 'blue', in_transit: 'amber', delivered: 'green', invoiced: 'green', draft: 'gray', sent: 'amber', paid: 'green', valid: 'green', missing: 'gray', pending: 'amber', expired: 'red', rejected: 'red', open: 'amber', resolved: 'green', closed: 'gray', active: 'green' };
const pill = (s) => h('span', { class: 'cp-pill ' + (STATUS_TONE[s] || 'gray') }, (s || '').replace(/_/g, ' '));
const ic = (name) => ({
  dash: 'M3 12l9-9 9 9M5 10v10h14V10', loads: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M6 20a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z',
  trips: 'M5 17h14M5 17a2 2 0 11-4 0 2 2 0 014 0zm14 0a2 2 0 11-4 0M7 17V7h8v10M15 9h3l3 4v4', finance: 'M12 1v22M5 5h11a3 3 0 010 6H8a3 3 0 000 6h11',
  docs: 'M6 2h9l5 5v15H6zM14 2v6h6', support: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', user: 'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8',
  shield: 'M12 2l8 3v6c0 5-3.4 8.4-8 11-4.6-2.6-8-6-8-11V5z', pin: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0zM12 13a3 3 0 100-6 3 3 0 000 6z', logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
}[name] || '');
const icon = (name, size = 20) => h('span', { class: 'cp-ic', html: '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + ic(name) + '"/></svg>' });
// Official LoadBoot mark (the "L" + orange arrow), same as the marketing site.
// A7 live chat (owner decision 2026-07-02): WhatsApp deep-link. Set the business number
// in E.164 digits (e.g. '15551234567') — the chat button stays HIDDEN until it is set,
// so no fake/unreachable contact is ever shown.
const WHATSAPP_NUMBER = '';
const LOGO_SVG = '<img src="/icon-512.png" width="34" height="34" alt="LoadBoot" style="border-radius:22%;display:block">';
const TAGLINE = 'Keep Your Wheels Earning';
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
function authScreen() {
  let signup = false;
  const email = h('input', { class: 'cp-in', type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const pass = h('input', { class: 'cp-in', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const company = h('input', { class: 'cp-in', type: 'text', placeholder: 'Company / carrier name', autocomplete: 'organization' });
  const name = h('input', { class: 'cp-in', type: 'text', placeholder: 'Your full name', autocomplete: 'name' });
  const extra = h('div', { style: 'display:none' }, [h('label', { class: 'cp-lbl' }, 'Company'), company, h('label', { class: 'cp-lbl' }, 'Your name'), name]);
  const err = h('div', { class: 'cp-err' });
  const title = h('h1', null, 'Welcome back');
  const sub = h('p', { class: 'cp-auth-sub' }, 'Sign in to your carrier portal.');
  const btn = h('button', { class: 'cp-btn cp-btn-lg' }, 'Sign in');
  const toggle = h('p', { class: 'cp-auth-toggle' });
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
    btn.disabled = true; btn.textContent = signup ? 'Creating…' : 'Signing in…';
    try {
      if (signup) {
        const { data, error } = await signUp(em, pw, { company: company.value.trim(), name: name.value.trim() });
        if (error) throw error;
        if (!data || !data.session) { err.className = 'cp-err ok'; err.textContent = 'Account created! Check your email to confirm, then sign in.'; setMode(false); btn.disabled = false; return; }
        boot(); return;
      }
      const { error } = await signInWithPassword(em, pw); if (error) throw error; boot(); return;
    } catch (e) { err.textContent = (e && e.message) || 'Something went wrong.'; btn.disabled = false; btn.textContent = signup ? 'Create account' : 'Sign in'; }
  };
  mount(root, h('div', { class: 'cp-auth' }, [
    h('div', { class: 'cp-auth-card' }, [
      h('div', { class: 'cp-auth-brand', style: 'align-items:flex-start' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:31px;width:auto;display:block' }), h('span', { style: 'color:#64748b;font-weight:500;font-size:.82rem;line-height:1;margin-top:2px' }, 'Carrier')]),
      title, sub, h('label', { class: 'cp-lbl' }, 'Email'), email, h('label', { class: 'cp-lbl' }, 'Password'), pass, extra, err, btn, toggle,
      h('div', { class: 'cp-staff' }, [document.createTextNode('Staff member? '), h('a', { href: '/app/command-center/' }, 'Open the Command Center →')]),
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
  ['dashboard', 'Dashboard', 'dash'], ['health', 'Account health', 'shield'], ['loads', 'Available loads', 'loads'], ['trips', 'My trips', 'trips'],
  ['fleet', 'Fleet', 'trips'], ['finance', 'Finance', 'finance'], ['documents', 'Documents', 'docs'],
  ['support', 'Support', 'support'], ['account', 'Account', 'user'],
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

  const sideNav = (mobile) => h('nav', { class: mobile ? 'cp-tabbar' : 'cp-nav' }, NAV.map(([id, label, iconName]) => {
    const a = h('a', { class: 'cp-navlink', href: '#' + id, onClick: () => go(id) }, [icon(iconName, mobile ? 22 : 20), h('span', null, label)]);
    (navLinks[id] = navLinks[id] || []).push(a); return a;
  }));

  const titleEl = h('h1', { class: 'cp-top-title' }, 'Dashboard');
  const bellBadge = h('span', { class: 'cp-bell-badge', hidden: true });
  const bell = h('button', { class: 'cp-iconbtn cp-bell', title: 'Notifications', onClick: () => go('notifications') }, [icon('bell', 20), bellBadge]);
  async function refreshUnread() { try { const ns = await pocketNotifications(50); const u = (ns || []).filter(n => !n.read_at).length; if (u > 0) { bellBadge.textContent = String(u > 9 ? '9+' : u); bellBadge.hidden = false; } else bellBadge.hidden = true; } catch (_) {} }
  const shell = h('div', { class: 'cp-shell' }, [
    h('aside', { class: 'cp-side' }, [
      h('div', { class: 'cp-brandrow', style: 'display:flex;align-items:flex-start;gap:5px' }, [h('img', { src: '/logo-full-dark.png', alt: 'LoadBoot', style: 'height:29px;width:auto;display:block' }), h('span', { style: 'color:#cbd5e1;font-weight:500;font-size:.82rem;line-height:1;margin-top:2px' }, 'Carrier')]),
      sideNav(false),
      h('div', { class: 'cp-side-foot' }, [
        h('div', { class: 'cp-carrier' }, [h('div', { class: 'cp-carrier-name' }, ov.carrier || 'Carrier'), h('div', { class: 'cp-carrier-mail' }, (user && user.email) || '')]),
        h('button', { class: 'cp-side-out', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.lastChild.textContent = 'Signing out…'; await signOut(); location.reload(); } }, [icon('logout', 16), h('span', null, 'Sign out')]),
      ]),
    ]),
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        titleEl,
        h('div', { class: 'cp-top-right' }, [
          h('button', { class: 'cp-chip cp-chip-btn ' + (ov.compliance_ok ? 'ok' : 'warn'), title: ov.compliance_ok ? 'Account compliant' : 'Action needed \u2014 finish your setup', onClick: () => go(ov.compliance_ok ? 'account' : 'documents') }, ov.compliance_ok ? 'Compliant' : 'Action needed'),
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
    sideNav(true),
  ]);
  mount(root, shell);
  root.setAttribute('aria-busy', 'false');

  function go(id) {
    tab = id; if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);  // replace, not push — keeps Back working / no hash pile-up
    Object.keys(navLinks).forEach(k => navLinks[k].forEach(a => a.classList.toggle('active', k === tab)));
    const item = NAV.find(n => n[0] === tab);
    titleEl.textContent = item ? item[1] : ({ notifications: 'Notifications', onboarding: 'Onboarding' }[tab] || 'Dashboard');
    render();
  }
  window.addEventListener('hashchange', () => { const t = (location.hash || '').replace('#', ''); if (t && t !== tab && NAV.some(n => n[0] === t)) go(t); });

  function render() {
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
  async function loadHealth() {
    mount(content, h('div', { class: 'cp-muted' }, 'Calculating your account health…'));
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
    mount(content, h('div', null, [tiles, heroCard, trustCard, networkCard, actions, explain]));
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
      statTile('Open offers', String(k.open_offers ?? 0), 'docs', 'violet', () => go('loads')),
      statTile('Delivered (wk)', String(k.delivered_this_week ?? 0), 'dash', 'green', () => go('trips')),
      statTile('Revenue (wk)', money(k.revenue_this_week ?? 0), 'finance', 'amber', () => go('finance')),
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
    mount(content, h('div', null, [kpis, acctStrip, setupCard, promptHost, ...annCards, h('div', { class: 'cp-grid' }, [notifCard, tripsCard, financeCard])].filter(Boolean)));
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
    let rows; try { rows = await pocketAvailableLoads(30); } catch (e) { rows = []; }
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
    if (!rows || !rows.length) { mount(content, h('div', null, [setupBanner, bestCard, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No available loads right now. Check back soon.'))].filter(Boolean))); return; }
    mount(content, h('div', null, [setupBanner, bestCard, h('div', { class: 'cp-loadgrid' }, rows.map(l => {
      const rpm = l.rpm ? '$' + Number(l.rpm).toFixed(2) + '/mi' : '';
      const bookWrap = h('div');
      const book = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!confirm('Request to book this load?\n\n' + (l.origin || '') + ' → ' + (l.destination || '') + '\n' + money(l.rate) + (rpm ? ' · ' + rpm : '') + '\n\nThe broker reviews your verified trust profile and approves or declines. Nothing moves and you are not committed until approved.')) return;
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending request…';
        try {
          await requestBookLoad(l.id);
          mount(bookWrap, [h('div', { class: 'cp-row-s', style: 'color:#d97706;font-weight:700;margin-bottom:4px' }, '\u23f3 Requested — pending broker approval'), h('div', { class: 'cp-row-s' }, 'You will be notified when the broker responds. Once approved it appears in My trips.')]);
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Request to book'; alert((e && e.message) || 'Could not send your request.'); }
      } }, 'Request to book');
      bookWrap.appendChild(book);
      const detailsBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => showLoadDetail(l.id) }, 'Detailed overview');
      const meta = [];
      if (l.commodity) meta.push('Commodity: ' + l.commodity);
      if (l.weight) meta.push('Weight: ' + l.weight);
      if (l.deadhead) meta.push(l.deadhead + ' mi deadhead');
      return h('article', { class: 'cp-load' }, [
        h('div', { class: 'cp-load-top' }, [h('div', { class: 'cp-load-lane' }, [h('b', null, l.origin || '—'), h('span', { class: 'cp-arrow' }, '→'), h('b', null, l.destination || '—')]), h('div', { class: 'cp-load-rate' }, [money(l.rate), rpm ? h('span', null, rpm) : null])]),
        h('div', { class: 'cp-load-tags' }, [h('span', { class: 'cp-tag' }, l.equipment || 'Van'), l.miles ? h('span', { class: 'cp-tag' }, Number(l.miles).toLocaleString() + ' mi') : null, l.pickup_date ? h('span', { class: 'cp-tag' }, 'PU ' + l.pickup_date) : null, l.delivery_date ? h('span', { class: 'cp-tag' }, 'DEL ' + l.delivery_date) : null].filter(Boolean)),
        meta.length ? h('div', { class: 'cp-load-meta' }, meta.join(' · ')) : null,
        l.requirements ? h('div', { class: 'cp-row-s' }, l.requirements) : null,
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px' }, [bookWrap, detailsBtn]),
      ].filter(Boolean));
    }))].filter(Boolean)));
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
      accEntries.length ? h('div', { style: 'margin-top:8px' }, [
        h('div', { class: 'cp-row-t' }, 'Accessorial rate card'),
        ...accEntries.map(([k, v]) => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-s' }, k.replace(/_/g, ' ')), h('span', null, typeof v === 'object' ? JSON.stringify(v) : String(v))])),
      ]) : h('div', { class: 'cp-muted', style: 'margin-top:8px;font-size:12px' }, 'No accessorial rates specified for this load.'),
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
      return h('div', { class: 'cp-trip' }, [
        h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, (t.origin || '—') + ' → ' + (t.destination || '—')), h('div', { class: 'cp-row-s' }, money(t.rate || 0))]), pill(t.status)]),
        tripStepper(t.status),
        h('div', { class: 'cp-trip-actions' }, [confirm, start, deliver, share, dwell, issue, emergency, pod, assign, history, sheetBtn, rcBtn, packBtn].filter(Boolean)), fw, podW, dwellW,
      ].filter(Boolean));
    })]));

    // Emergency / delivery-reschedule request — REQUIRES a defined category, a detailed reason and proof.
    // Goes to Command Center for review (urgent, red). Emergencies are for genuine, evidenced situations only.
    function openEmergency(t) {
      const CATS = [['breakdown', 'Truck breakdown'], ['accident', 'Accident'], ['weather', 'Severe weather'], ['medical', 'Medical emergency'], ['road_closure', 'Road closure'], ['hours_of_service', 'Out of hours (HOS)'], ['mechanical', 'Mechanical failure'], ['theft', 'Theft'], ['other', 'Other (explain)']];
      const cat = h('select', { class: 'cp-in' }, CATS.map(([v, l]) => h('option', { value: v }, l)));
      const reason = h('textarea', { class: 'cp-in', rows: '3', placeholder: 'Exactly what happened, where, and what you need (min 10 characters).' });
      const proof = h('input', { class: 'cp-in', placeholder: 'Or paste a proof link — tow receipt, police report (if no photo)' });
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
      const save = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!unit.value.trim()) { alert('Unit number is required.'); return; }
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try { await pocketUpsertTruck({ id: t && t.id, unitNo: unit.value.trim(), plate: plate.value.trim(), vin: vin.value.trim(), equipment: eq.value || null }); trucks = await pocketTrucks(); renderTrucks(); }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save');
      openModal((t ? 'Edit truck' : 'Add truck'), [unit, plate, vin, eq, save]);
    }

    const alertHost = h('div');
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
    mount(content, h('div', null, [
      h('div', { class: 'cp-kpis' }, [statTile('Fees due', money(due), 'finance', 'amber'), statTile('Fees paid', money(paid), 'dash', 'green'), statTile('Gross hauled', money(gross), 'trips', 'blue'), statTile('Invoices', String(rows.length), 'docs', 'violet')]),
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
  async function loadDocuments() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let c; try { c = await pocketCompliance(); } catch (e) { c = { requirements: [] }; }
    const reqs = (c && c.requirements) || [];
    const listWrap = h('div');
    // upload form
    const typeSel = h('select', { class: 'cp-in' }, DOC_TYPES.map(([v, l]) => h('option', { value: v }, l)));
    const fileIn = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx' });
    const msg = h('div', { class: 'cp-err' });
    const up = h('button', { class: 'cp-btn', onClick: async () => {
      const f = fileIn.files && fileIn.files[0];
      msg.textContent = ''; msg.className = 'cp-err';
      if (!f) { msg.textContent = 'Choose a file first.'; return; }
      up.disabled = true; up.textContent = 'Uploading…';
      try {
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
      const t = reqDocType(r.name);
      const typeSel2 = h('select', { class: 'cp-in' }, DOC_TYPES.map(([v, l]) => h('option', { value: v, selected: v === t ? 'selected' : null }, l)));
      const fileIn2 = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx' });
      const msg2 = h('div', { class: 'cp-err' });
      const upBtn = h('button', { class: 'cp-btn', style: 'margin-top:10px', onClick: async (ev) => {
        const file = fileIn2.files && fileIn2.files[0];
        msg2.textContent = ''; msg2.className = 'cp-err';
        if (!file) { msg2.textContent = 'Choose a file first.'; return; }
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Uploading…';
        try {
          const meta = await uploadDocument(file, typeSel2.value);
          await carrierUploadDocument({ type: typeSel2.value, fileName: meta.fileName, filePath: meta.path });
          close2(); loadDocuments();
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Upload'; msg2.className = 'cp-err'; msg2.textContent = (e && e.message) || 'Upload failed.'; }
      } }, 'Upload');
      const close2 = openModal('Upload — ' + r.name, [
        h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'PDF or photo, up to 25 MB. Stored privately; only you and LoadBoot staff can see it. Your dispatcher reviews it after upload.'),
        typeSel2, fileIn2, msg2, upBtn,
      ]);
    };
    const reqRow = (r) => {
      const k = reqTone(r); const tone = toneOf(k.t);
      const actionable = k.t !== 'success';
      return h('div', { class: 'cp-row', role: actionable ? 'button' : null, tabindex: actionable ? '0' : null,
        style: 'border-left:4px solid ' + tone.c + ';padding-left:10px;background:' + (k.t === 'urgent' ? tone.bg : 'transparent') + ';border-radius:8px' + (actionable ? ';cursor:pointer' : ''),
        onClick: actionable ? () => uploadFor(r) : null }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, r.name), h('div', { class: 'cp-row-s' }, (r.mandatory ? 'Required · ' : 'Optional · ') + k.why + (actionable ? ' — tap to upload' : ''))]),
        h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
          h('span', { class: 'cp-pill', style: 'background:' + tone.bg + ';color:' + tone.c + ';border:1px solid ' + tone.c + '33' }, tone.label),
          actionable ? h('span', { class: 'cp-btn cp-btn-sm', style: 'pointer-events:none' }, 'Upload') : null,
        ].filter(Boolean)),
      ]);
    };
    const sorted = reqs.slice().sort((a, b) => ({ urgent: 0, action: 1, warning: 2, success: 3 }[reqTone(a).t] - { urgent: 0, action: 1, warning: 2, success: 3 }[reqTone(b).t]));
    mount(content, h('div', null, [
      h('div', { class: 'cp-card' }, [cardHead('What LoadBoot needs from you',
          c && c.mandatory_ok && !needAttention ? 'All required documents are in ✓'
            : (needAttention ? needAttention + ' required item' + (needAttention > 1 ? 's' : '') + ' need' + (needAttention > 1 ? '' : 's') + ' attention' : 'Some documents still needed')),
        sorted.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, sorted.map(reqRow)) : h('div', { class: 'cp-muted' }, 'No requirements listed.')]),
      h('div', { class: 'cp-grid' }, [
        h('div', { class: 'cp-card' }, [cardHead('Upload a document'), h('p', { class: 'cp-row-s', style: 'margin-bottom:6px' }, 'PDF or photo, up to 25 MB. Stored privately; only you and LoadBoot staff can see it.'), typeSel, fileIn, msg, up]),
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
    const pushRow = h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, 'Push notifications'), h('div', { class: 'cp-row-s' }, 'Alerts on this device')]), h('span', { class: 'cp-muted' }, '…')]);
    if (pushSupported()) {
      const status = h('span', { class: 'cp-pill gray' }, 'checking…');
      const btn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Enabling…'; try { await enablePush('Carrier portal'); status.textContent = 'on'; status.className = 'cp-pill green'; ev.currentTarget.textContent = 'On ✓'; } catch (e) { status.textContent = 'off'; ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Turn on'; alert((e && e.message) || 'Could not enable.'); } } }, 'Turn on');
      isPushEnabled().then(on => { status.textContent = on ? 'on' : 'off'; status.className = 'cp-pill ' + (on ? 'green' : 'gray'); if (on) { btn.textContent = 'On ✓'; btn.disabled = true; } });
      pushRow.replaceChild(h('div', { style: 'display:flex;gap:8px;align-items:center' }, [status, btn]), pushRow.lastChild);
    }
    // Communication preferences (Phase 3H) — operational/compliance messages are always
    // sent; only marketing-class messages are opt-out.
    const prefsCard = h('div', { class: 'cp-card' }, [cardHead('Communication preferences'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let p = {}; try { p = await pocketGetPreferences(); } catch (_) { p = {}; }
      const PREFS = [['marketing_email', 'Marketing emails', 'Offers, news and tips'], ['product_announcements', 'Product announcements', 'New features and updates'], ['load_offers', 'Load offers', 'Alerts when matching loads appear'], ['weekly_summaries', 'Weekly summary', 'A digest of your week'], ['sms', 'SMS messages', 'Text alerts (carrier rates may apply)']];
      const state = Object.assign({ marketing_email: true, product_announcements: true, load_offers: true, weekly_summaries: true, sms: false, unsubscribed_all: false }, p || {});
      const save = async () => { try { await pocketSavePreferences(state); } catch (e) { alert((e && e.message) || 'Could not save.'); } };
      const toggleRow = (key, label, sub) => { const t = h('button', { class: 'cp-chip2' + (state[key] ? ' on' : ''), onClick: async () => { state[key] = !state[key]; t.classList.toggle('on'); t.textContent = state[key] ? 'On' : 'Off'; await save(); } }, state[key] ? 'On' : 'Off'); return h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, label), h('div', { class: 'cp-row-s' }, sub)]), t]); };
      const unsubRow = (() => { const t = h('button', { class: 'cp-chip2' + (state.unsubscribed_all ? ' on' : ''), onClick: async () => { state.unsubscribed_all = !state.unsubscribed_all; t.classList.toggle('on'); t.textContent = state.unsubscribed_all ? 'Unsubscribed' : 'Subscribed'; await save(); } }, state.unsubscribed_all ? 'Unsubscribed' : 'Subscribed'); return h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, 'Unsubscribe from all marketing'), h('div', { class: 'cp-row-s' }, 'Operational, compliance & finance messages still reach you')]), t]); })();
      mount(prefsCard, [cardHead('Communication preferences'), ...PREFS.map(([k, l, s]) => toggleRow(k, l, s)), unsubRow]);
    })();
    // Dispatch preferences (AI Pilot) — what the carrier wants: min RPM, equipment, lanes, max deadhead.
    // These feed the AI Load Pilot's "Best for you" ranking and staff push recommendations.
    const dispCard = h('div', { class: 'cp-card' }, [cardHead('Dispatch preferences (AI Pilot)'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let dp = {}; try { dp = await getDispatchPrefs(); } catch (_) { dp = {}; }
      const errBox = h('div', { class: 'cp-err', style: 'margin:6px 0' });
      const fld = (label, val, ph, opts) => {
        opts = opts || {};
        const i = h('input', { class: 'cp-input', placeholder: ph || '', type: opts.type || 'text' });
        i.value = val == null ? '' : String(val); i.oninput = () => i.classList.remove('cp-invalid');
        const lbl = h('span', null, [label, opts.req ? h('b', { style: 'color:#dc2626' }, ' *') : null].filter(Boolean));
        return { row: h('label', { class: 'cp-field' }, [lbl, i, opts.hint ? h('small', { class: 'cp-row-s' }, opts.hint) : null].filter(Boolean)), i };
      };
      const tog = (label, val) => { const b = h('button', { type: 'button', class: 'cp-chip2' + (val ? ' on' : ''), onClick: () => b.classList.toggle('on') }, label); return { row: h('label', { class: 'cp-field' }, [h('span', null, label), b]), get: () => b.classList.contains('on') }; };
      const f1 = fld('Minimum rate ($/mi)', dp.min_rpm, 'e.g. 2.25', { type: 'number', req: true, hint: 'We never push loads below this.' });
      const fT = fld('Target rate ($/mi)', dp.target_rpm, 'e.g. 2.75', { type: 'number', hint: 'Your ideal — ranked higher.' });
      const f2 = fld('Preferred equipment (comma separated)', (dp.preferred_equipment || []).join(', '), 'Dry Van, Reefer, Flatbed', { req: true });
      const f3 = fld('Preferred lanes / regions (comma separated)', (dp.preferred_lanes || []).join(', '), 'TX, Atlanta, Midwest', { req: true });
      const f5 = fld('Home base (city, ST)', dp.home_base, 'Dallas, TX', { req: true, hint: 'Used for deadhead + home-time matching.' });
      const f4 = fld('Max deadhead (miles)', dp.max_deadhead_miles, 'e.g. 250', { type: 'number' });
      const fW = fld('Max weight you can haul (lbs)', dp.max_weight_lbs, 'e.g. 44000', { type: 'number' });
      const fMin = fld('Shortest trip you want (miles)', dp.min_trip_miles, 'e.g. 200', { type: 'number' });
      const fMax = fld('Longest trip you want (miles)', dp.max_trip_miles, 'e.g. 1800', { type: 'number' });
      const fN = fld('Min notice before pickup (hours)', dp.min_notice_hours, 'e.g. 12', { type: 'number' });
      const fA = fld('Avoid states / regions (comma separated)', (dp.avoid_states || []).join(', '), 'NYC metro, CA', {});
      const tHaz = tog('Hazmat endorsed', dp.hazmat);
      const tTeam = tog('Team drivers', dp.team_drivers);
      const tWk = tog('Available weekends', dp.weekend_ok !== false);
      const fNotes = (() => { const t = h('textarea', { class: 'cp-input', rows: '2', placeholder: 'Anything else for your dispatcher (preferred brokers, home-time needs)…' }); t.value = dp.notes || ''; return { row: h('label', { class: 'cp-field' }, [h('span', null, 'Notes for your dispatcher'), t]), t }; })();
      const req = [f1, f2, f3, f5];
      const arr = (v) => v.split(',').map(x => x.trim()).filter(Boolean);
      const saveBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        errBox.textContent = ''; const miss = [];
        req.forEach(x => { x.i.classList.remove('cp-invalid'); if (!x.i.value.trim()) { x.i.classList.add('cp-invalid'); miss.push(1); } });
        if (f1.i.value && (isNaN(Number(f1.i.value)) || Number(f1.i.value) <= 0)) { f1.i.classList.add('cp-invalid'); miss.push(1); }
        if (miss.length) { errBox.textContent = 'Please complete the required (*) fields — the matching engine needs them to push loads that fit.'; return; }
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try {
          await setDispatchPrefs({ min_rpm: f1.i.value || null, target_rpm: fT.i.value || null,
            preferred_equipment: arr(f2.i.value), preferred_lanes: arr(f3.i.value),
            home_base: f5.i.value.trim() || null, max_deadhead_miles: f4.i.value || null,
            avoid_states: arr(fA.i.value), max_weight_lbs: fW.i.value || null,
            min_trip_miles: fMin.i.value || null, max_trip_miles: fMax.i.value || null, min_notice_hours: fN.i.value || null,
            hazmat: tHaz.get(), team_drivers: tTeam.get(), weekend_ok: tWk.get(), notes: fNotes.t.value.trim() || null });
          ev.currentTarget.textContent = 'Saved ✓'; setTimeout(() => { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save preferences'; }, 1500);
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save preferences'; errBox.textContent = (e && e.message) || 'Could not save.'; }
      } }, 'Save preferences');
      const txtFields = [f1, fT, f2, f3, f5, f4, fW, fMin, fMax, fN, fA];
      const pct = Math.round(txtFields.filter(x => x.i.value.trim()).length / txtFields.length * 100);
      mount(dispCard, [cardHead('Dispatch preferences (AI Pilot)'),
        h('div', { class: 'cp-muted', style: 'margin-bottom:6px' }, 'The more you tell us, the better the AI Pilot and your dispatcher match — we only push loads that fit your rate, equipment, lanes and limits. Fields marked * are required.'),
        h('div', { style: 'margin-bottom:8px;font-weight:800;color:' + (pct >= 70 ? 'var(--lb-green,#16a34a)' : 'var(--lb-blue,#0883F7)') }, 'Matching profile ' + pct + '% complete'),
        errBox,
        f1.row, fT.row, f2.row, f3.row, f5.row, f4.row, fW.row, fMin.row, fMax.row, fN.row, fA.row,
        tHaz.row, tTeam.row, tWk.row, fNotes.row,
        h('div', { style: 'margin-top:8px' }, saveBtn)]);
    })();
    // WEB-2 — Referral program card (flag-gated: referral_program). Earn from OUR fee; client pays nothing extra.
    const refCard = h('div', { class: 'cp-card' }, [cardHead('Referral program'), h('div', { class: 'cp-muted' }, 'Checking…')]);
    (async () => {
      let on = false; try { on = await isFlagEnabled('referral_program'); } catch (_) { on = false; }
      if (!on) { mount(refCard, [cardHead('Referral program'), h('div', { class: 'cp-muted' }, 'The referral program is not active yet — it is coming soon.')]); return; }
      let r; try { r = await myReferral(); } catch (e) { mount(refCard, [cardHead('Referral program'), h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load.')]); return; }
      const money2 = (v) => '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const copyBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        try { await navigator.clipboard.writeText(r.link); ev.currentTarget.textContent = 'Copied ✓'; } catch (_) { alert(r.link); }
      } }, 'Copy my link');
      const claimIn = h('input', { class: 'cp-in', placeholder: 'Were you referred? Enter their code once' });
      const payoutWrap = h('div');
      const claimBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => {
        if (!claimIn.value.trim()) return; ev.currentTarget.disabled = true;
        try { await claimReferral(claimIn.value.trim()); ev.currentTarget.textContent = 'Linked ✓'; }
        catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not link.'); }
      } }, 'Link referrer');
      mount(refCard, [cardHead('Referral program'),
        h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Your code'), h('b', null, r.code)]),
        h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Referrals'), h('span', null, String(r.referrals || 0))]),
        h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Accrued (15-day hold)'), h('span', null, money2(r.accrued))]),
        h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Payable'), h('b', { style: 'color:var(--lb-green)' }, money2(r.payable))]),
        h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Paid out'), h('span', null, money2(r.paid))]),
        h('div', { style: 'margin-top:8px' }, copyBtn),
        h('div', { class: 'cp-inlineform', style: 'margin-top:8px' }, [claimIn, claimBtn]),
        payoutWrap,
        h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'You earn a share of LoadBoot\'s own dispatch fee on every booked trip of carriers/brokers you refer — they never pay extra. Commissions unlock 15 days after accrual; payouts are reviewed by a person.'),
      ]);
      referralPayoutUI(payoutWrap, r);
    })();
    // Team card — visible to all members; management controls only render for the owner.
    const teamCard = h('div', { class: 'cp-card' }, [cardHead('Team'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    (async () => {
      let members; try { members = await pocketTeam(); } catch (e) { mount(teamCard, [cardHead('Team'), h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load team.')]); return; }
      members = members || [];
      const amOwner = members.some(m => m.is_me && m.is_owner);
      const rows = members.map(m => {
        const roleLabel = h('span', { class: 'cp-pill ' + (m.status === 'suspended' ? 'red' : 'gray') }, (m.is_owner ? 'Owner' : (m.member_role || 'member')) + (m.status === 'suspended' ? ' · suspended' : ''));
        const manage = (amOwner && !m.is_owner && !m.is_me) ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => manageMember(m) }, 'Manage') : null;
        return h('div', { class: 'cp-row' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, m.name || m.email || (String(m.user_id).slice(0, 8) + '…')), h('div', { class: 'cp-row-s' }, [m.email, m.phone].filter(Boolean).join(' · ') || '—')]),
          h('div', { style: 'display:flex;gap:8px;align-items:center' }, [roleLabel, manage].filter(Boolean)),
        ]);
      });
      const note = amOwner
        ? h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'You are the account owner. To add a brand-new teammate, contact us — email invites are coming soon.')
        : h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'Only the account owner can change team roles.');
      mount(teamCard, [cardHead('Team', members.length + ' member' + (members.length === 1 ? '' : 's')), ...rows, note]);

      function manageMember(m) {
        const role = h('select', { class: 'cp-in' }, ['manager', 'driver'].map(r => h('option', { value: r, selected: m.member_role === r ? 'selected' : null }, r)));
        const active = h('select', { class: 'cp-in' }, [['active', 'Active'], ['suspended', 'Suspended']].map(([v, l]) => h('option', { value: v, selected: m.status === v ? 'selected' : null }, l)));
        const save = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
          try { await pocketSetMember({ user: m.user_id, role: role.value, status: active.value }); loadAccount(); }
          catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save'; alert((e && e.message) || 'Could not save.'); }
        } }, 'Save');
        openModal('Manage ' + (m.name || m.email || 'member'), [h('label', { class: 'cp-row-s' }, 'Role'), role, h('label', { class: 'cp-row-s' }, 'Access'), active, save]);
      }
    })();
    const heroTiles = h('div', { class: 'cp-kpis' }, [
      statTile('Verification', (ov.onboarding_stage || 'pending').replace(/_/g, ' '), 'user', ov.compliance_ok ? 'green' : 'amber', () => go('documents')),
      statTile('Compliance', ov.compliance_ok ? 'All good' : 'Action needed', 'docs', ov.compliance_ok ? 'green' : 'amber', () => go('documents')),
      statTile('Active trips', String(ov.trips_active ?? 0), 'trips', 'blue', () => go('trips')),
      statTile('Fees due', money(ov.invoices_due ?? 0), 'finance', 'violet', () => go('finance')),
    ]);
    const heroCardAcct = h('div', null, [heroTiles,
      h('div', { class: 'cp-card', style: 'margin-top:10px' }, [
        cardHead('Account & verification', ov.compliance_ok ? 'Your account is verified for dispatch' : 'Finish verification to unlock full dispatch'),
        h('div', { class: 'cp-row-s' }, 'Your verification level controls what the matching engine sends you: complete documents and onboarding raise your account standing, keep offers flowing, and unlock higher-value freight. Every item below updates live.'),
      ]),
      (() => {
        // C7 — LIVE account health (Amazon-style): 100 minus itemized deductions, every reason shown.
        const hc = h('div', { class: 'cp-card', style: 'margin-top:10px' }, [cardHead('Account health'), h('div', { class: 'cp-muted' }, 'Calculating…')]);
        (async () => {
          let ah; try { ah = await accountHealth(); } catch (_) { hc.remove(); return; }
          const tone = toneOf(ah.tier === 'healthy' ? 'success' : ah.tier === 'at_risk' ? 'warning' : 'urgent');
          const ded = Array.isArray(ah.deductions) ? ah.deductions : [];
          mount(hc, [cardHead('Account health', 'Live — recalculated on every view'),
            h('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' }, [
              h('div', { style: 'width:64px;height:64px;border-radius:50%;border:5px solid ' + tone.c + ';display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.2rem;color:' + tone.c }, String(ah.score)),
              h('div', null, [
                h('span', { class: 'cp-pill', style: 'background:' + tone.bg + ';color:' + tone.c }, (ah.tier || '').replace('_', ' ').toUpperCase()),
                h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, ded.length ? 'What is costing you points:' : 'No deductions — perfect standing. Keep it up!'),
              ]),
            ]),
            ded.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:10px' }, ded.map(x => h('div', { class: 'cp-row', style: 'border-left:4px solid ' + tone.c + ';padding-left:10px;border-radius:8px' }, [
              h('div', null, [h('div', { class: 'cp-row-t' }, x.label), h('div', { class: 'cp-row-s' }, x.basis || '')]),
              h('b', { style: 'color:' + tone.c }, '-' + x.deducted),
            ]))) : null,
            h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, ah.basis || ''),
          ].filter(Boolean));
        })();
        return hc;
      })()]);
    const payCard = h('div', { class: 'cp-card' }, [cardHead('Payment method (bank)'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    async function loadPayCard() {
      let p; try { p = await myPaymentProfile(); } catch (_) { p = null; }
      const editBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: () => {
        const inp = (ph, val) => { const i = h('input', { class: 'cp-in', placeholder: ph }); if (val != null) i.value = val; return i; };
        const bank = inp('Bank name *', p && p.bank_name);
        const title = inp('Account holder name * (must match your company)', p && p.account_title);
        const acct = inp('Account number *' + (p && p.account_last4 ? ' (current ···' + p.account_last4 + ')' : ''));
        const routing = inp('Routing number / ABA *' + (p && p.routing_last4 ? ' (current ···' + p.routing_last4 + ')' : ''));
        const atype = h('select', { class: 'cp-in' }, [['', 'Account type *'], ['checking', 'Checking'], ['savings', 'Savings']].map(([v, l]) => h('option', { value: v, selected: (p && p.account_type) === v ? 'selected' : null }, l)));
        const method = h('select', { class: 'cp-in' }, [['ach', 'ACH / direct deposit'], ['wire', 'Wire transfer'], ['factoring', 'Pay my factoring company'], ['check', 'Paper check']].map(([v, l]) => h('option', { value: v, selected: (p && p.payment_method) === v ? 'selected' : null }, l)));
        const baddr = inp('Bank address (for wires)', p && p.bank_address);
        const swift = inp('SWIFT / BIC (international only)');
        const remit = inp('Remittance email (where pay stubs go)', p && p.remittance_email);
        const phone = inp('Bank / accounting phone');
        const tax = inp('Tax ID / EIN (for your 1099)');
        const factco = inp('Factoring company (if factored)', p && p.factoring_company);
        const noaC = h('input', { type: 'checkbox' }); if (p && p.factoring_noa) noaC.checked = true;
        const noaRow = h('label', { style: 'display:flex;align-items:center;gap:8px;margin:6px 0' }, [noaC, h('span', { class: 'cp-row-s' }, 'Notice of Assignment (NOA) on file — pay my factoring company')]);
        const err = h('div', { class: 'cp-err' });
        const close = openModal('Payout & bank details', [
          h('p', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'This is how your settlements reach you. Give us everything so payments never bounce or delay. A person verifies bank details before any payout references them; editing resets verification. For your security we mask stored numbers — re-enter the account and routing number to save.'),
          bank, title, acct, routing, atype, method, baddr, swift, remit, phone, tax, factco, noaRow, err,
          h('button', { class: 'cp-btn', style: 'margin-top:10px', onClick: async (ev) => {
            err.textContent = ''; ev.currentTarget.disabled = true;
            try { await setMyPaymentProfile({ bank_name: bank.value.trim(), account_title: title.value.trim(), account_number: acct.value.trim(), routing_number: routing.value.trim(), account_type: atype.value, payment_method: method.value, bank_address: baddr.value.trim(), swift_bic: swift.value.trim(), remittance_email: remit.value.trim(), bank_phone: phone.value.trim(), tax_id: tax.value.trim(), factoring_company: factco.value.trim(), factoring_noa: noaC.checked }); close(); loadPayCard(); }
            catch (e) { ev.currentTarget.disabled = false; err.textContent = (e && e.message) || 'Could not save.'; }
          } }, 'Save payout details'),
        ]);
      } }, (p && p.exists) ? 'Update' : 'Add payout details');
      const vt = toneOf(p && p.exists ? (p.verified ? 'success' : 'action') : 'warning');
      mount(payCard, [cardHead('Payment method (bank)', p && p.exists ? (p.verified ? 'Verified ✓' : 'Awaiting verification') : 'Not set'),
        (p && p.exists) ? h('div', { class: 'cp-row', style: 'border-left:4px solid ' + vt.c + ';padding-left:10px;border-radius:8px' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, p.bank_name), h('div', { class: 'cp-row-s' }, [p.account_title, (p.account_type || '') + ' ···' + (p.account_last4 || ''), p.routing_last4 ? 'ABA ···' + p.routing_last4 : null, p.payment_method ? String(p.payment_method).toUpperCase() : null, p.factoring_noa ? 'NOA → factor' : null].filter(Boolean).join(' · '))]),
          h('span', { class: 'cp-pill', style: 'background:' + vt.bg + ';color:' + vt.c }, p.verified ? 'Verified' : 'Pending'),
        ]) : h('div', { class: 'cp-row-s', style: 'border-left:4px solid ' + vt.c + ';padding-left:10px' }, 'Add your bank account — it is how settlements reach you. Details are masked; only finance staff can see them for verification.'),
        h('div', { style: 'margin-top:10px' }, editBtn)]);
    }
    loadPayCard();
    // D2 — industry onboarding packet (LEGAL/REQUIRED tags; submit ref; staff verifies)
    const packetCard = h('div', { class: 'cp-card' }, [cardHead('Industry onboarding packet'), h('div', { class: 'cp-muted' }, 'Loading…')]);
    async function loadPacket() {
      let pk; try { pk = await myOnboardingPacket(); } catch (_) { packetCard.remove(); return; }
      const TAGC = { legal: '#dc2626', required: '#d97706', conditional: '#0883F7', optional: '#64748b' };
      mount(packetCard, [cardHead('Industry onboarding packet', pk.complete ? 'Packet complete ✓' : 'Mandatory items outstanding'),
        h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, (pk.items || []).map(it => {
          const c0 = TAGC[it.tag] || '#64748b';
          const act = (it.status === 'pending' || it.status === 'rejected') ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => {
            const ref = h('input', { class: 'cp-in', placeholder: 'Document reference / vault file / note' });
            const err = h('div', { class: 'cp-err' });
            const close = openModal('Submit — ' + it.label, [ref, err,
              h('button', { class: 'cp-btn', style: 'margin-top:10px', onClick: async (ev) => {
                ev.currentTarget.disabled = true;
                try { await onboardingSubmitItem(it.key, ref.value.trim(), null); close(); loadPacket(); }
                catch (e) { ev.currentTarget.disabled = false; err.textContent = (e && e.message) || 'Failed'; }
              } }, 'Submit')]);
          } }, it.status === 'rejected' ? 'Resubmit' : 'Submit') : null;
          return h('div', { class: 'cp-row', style: 'border-left:4px solid ' + c0 + ';padding-left:10px;border-radius:8px' }, [
            h('div', null, [h('div', { class: 'cp-row-t' }, it.label), h('div', { class: 'cp-row-s' }, '[' + it.tag.toUpperCase() + ']' + (it.note ? ' · ' + it.note : ''))]),
            h('div', { style: 'display:flex;gap:6px;align-items:center' }, [pill(it.status), act].filter(Boolean)),
          ]);
        }))]);
    }
    loadPacket();
    const setupCard = h('div', { class: 'cp-card' }, [cardHead('Complete your setup'), h('div', { class: 'cp-muted' }, 'Checking…')]);
    (async () => {
      let d; try { d = await carrierDashboard(); } catch (_) { d = null; }
      const gaps = (d && d.setup_gaps) || [];
      if (!gaps.length) { mount(setupCard, [cardHead('Complete your setup', 'Everything is in place ✓'), h('div', { class: 'cp-muted' }, 'No open setup items — you are fully set up.')]); return; }
      mount(setupCard, [cardHead('Complete your setup', gaps.length + ' item' + (gaps.length > 1 ? 's' : '') + ' remaining'),
        h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, gaps.map(g => {
          const tone = toneOf(g.tone);
          const dest = (g.route || g.action || '').replace(/^\//, '') || 'account';
          return h('div', { class: 'cp-row', style: 'border-left:4px solid ' + tone.c + ';padding-left:10px;border-radius:8px' }, [
            h('div', null, [h('div', { class: 'cp-row-t' }, g.label || g.title || 'Setup item'), h('div', { class: 'cp-row-s' }, (tone.label || '') + (g.key ? ' - ' + g.key : ''))]),
            h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go(NAV.some(n => n[0] === dest) ? dest : 'account') }, 'Fix'),
          ]);
        }))]);
    })();
    const _avatarHost = h('div', { style: 'margin-bottom:10px' });
    try { mountAvatarEditor(_avatarHost, { name: ov.carrier || (user && user.email) || '' }); } catch (_) {}
    mount(content, h('div', null, [heroCardAcct, h('div', { class: 'cp-grid' }, [
      h('div', { class: 'cp-card' }, [cardHead('Profile'), _avatarHost, h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Carrier'), h('span', null, ov.carrier || '—')]), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Email'), h('span', null, (user && user.email) || '—')]), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Onboarding'), pill((ov.onboarding_stage || 'pending'))])]),
      setupCard,
      packetCard,
      payCard,
      teamCard,
      h('div', { class: 'cp-card' }, [cardHead('Device & privacy'), pushRow, h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, 'Location sharing'), h('div', { class: 'cp-row-s' }, 'Asked per active trip, you stay in control')]), h('span', { class: 'cp-pill gray' }, 'per trip')]), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:12px', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Signing out…'; await signOut(); location.reload(); } }, 'Sign out')]),
      dispCard,
      refCard,
      prefsCard,
    ])]));
  }

  /* ----- Onboarding wizard (Phase 2A) ----- */
  async function loadOnboarding() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    const EQUIP = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Hotshot', 'Power Only', 'Box Truck', 'Conestoga', 'Tanker', 'Car Hauler'];
    const STEPS = ['Company & authority', 'Operation & equipment', 'Factoring & payment', 'Dispatch preferences', 'Documents', 'Review & submit'];
    let prof = {}; try { prof = await pocketGetProfile(); } catch (_) { prof = {}; }
    const f = Object.assign({ company: '', contact_name: '', phone: '', mc: '', dot: '', home_base: '', radius_miles: '', equipment_types: [], truck_count: '', hazmat: false, weekend_ok: false, factoring_status: '', factoring_company: '', contact_method: '', whatsapp: '' }, prof || {});
    if (!Array.isArray(f.equipment_types)) f.equipment_types = [];
    let st = 0;
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
      return h('div', null, [h('p', { class: 'cp-row-s' }, 'Upload your W-9, authority letter, insurance/COI and signed agreement. PDF or photo, up to 25 MB each.'), h('div', { class: 'cp-inlineform' }, [typeSel, fileIn, up, msg]), h('div', { style: 'margin-top:10px' }, list)]);
    }
    function reviewStep() {
      const row = (k, v) => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, k), h('span', null, v || '—')]);
      return h('div', null, [h('p', { class: 'cp-row-s' }, 'Check your details, then submit. Our team reviews and approves your account.'), row('Company', f.company), row('Contact', f.contact_name + (f.phone ? ' · ' + f.phone : '')), row('MC / DOT', (f.mc || '—') + ' / ' + (f.dot || '—')), row('Home base', f.home_base), row('Equipment', (f.equipment_types || []).join(', ')), row('Trucks', f.truck_count), row('Factoring', f.factoring_status + (f.factoring_company ? ' · ' + f.factoring_company : '')), row('Dispatch prefs', (dpf.min_rpm ? '$' + dpf.min_rpm + '/mi min' : '—') + (dpf.preferred_lanes ? ' · ' + dpf.preferred_lanes : ''))]);
    }
    function doneCard() { return [h('div', { class: 'cp-wiz-done' }, [h('div', { style: 'font-size:2.4rem' }, '✓'), h('h3', null, 'Submitted for review'), h('p', { class: 'cp-row-s' }, 'Thanks! Our team is reviewing your onboarding. You’ll get a notification when it’s approved.'), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('dashboard') }, 'Back to dashboard')])]; }
    function draw() {
      const pct = Math.round((st / (STEPS.length - 1)) * 100);
      let body;
      if (st === 0) body = h('div', { class: 'cp-wiz-grid' }, [field('Company / carrier name', 'company', 'Acme Trucking LLC'), field('Your name', 'contact_name'), field('Phone', 'phone'), field('MC number', 'mc', '123456'), field('DOT number', 'dot', '1234567')]);
      else if (st === 1) { const eq = h('div', { class: 'cp-eqgrid' }, EQUIP.map(e => { const on = (f.equipment_types || []).includes(e); const b = h('button', { class: 'cp-chip2' + (on ? ' on' : ''), onClick: () => { const s = new Set(f.equipment_types || []); if (s.has(e)) s.delete(e); else s.add(e); f.equipment_types = [...s]; b.classList.toggle('on'); } }, e); return b; })); body = h('div', { class: 'cp-wiz-grid' }, [field('Home base (city, ST)', 'home_base', 'Dallas, TX'), field('Search radius (miles)', 'radius_miles', '300', 'number'), field('Number of trucks', 'truck_count', '1'), h('div', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Equipment types'), eq]), toggle('Haul hazmat', 'hazmat'), toggle('Available weekends', 'weekend_ok')]); }
      else if (st === 2) body = h('div', { class: 'cp-wiz-grid' }, [selectField('Factoring', 'factoring_status', [['', '—'], ['yes', 'I use factoring'], ['no', 'No factoring'], ['interested', 'Interested']]), field('Factoring company', 'factoring_company'), selectField('Preferred contact', 'contact_method', [['', '—'], ['phone', 'Phone'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email']]), field('WhatsApp number', 'whatsapp')]);
      else if (st === 3) body = prefsStep();
      else if (st === 4) body = docStep();
      else body = reviewStep();
      const back = st > 0 ? h('button', { class: 'cp-btn ghost cp-btn-sm', onClick: () => { st--; draw(); } }, '← Back') : h('span');
      const next = st < STEPS.length - 1
        ? h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…'; try { if (st === 3) await savePrefsStep(); await save(); st++; draw(); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save & continue'; alert((e && e.message) || 'Could not save.'); } } }, 'Save & continue')
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
  async function loadNotifications() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let rows; try { rows = await pocketNotifications(60); } catch (e) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'Could not load notifications.'))); return; }
    if (!rows || !rows.length) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No notifications yet. Alerts about your loads, payments and onboarding will appear here.'))); refreshUnread(); return; }
    const card = h('div', { class: 'cp-card' }, [cardHead('Notifications', rows.filter(n => !n.read_at).length + ' unread'), ...rows.map(n => {
      const p = n.payload || {};
      const row = h('div', { class: 'cp-row cp-notif' + (n.read_at ? '' : ' unread'), onClick: async () => { if (!n.read_at) { try { await pocketMarkNotificationRead(n.id); n.read_at = new Date().toISOString(); row.classList.remove('unread'); refreshUnread(); } catch (_) {} } if (p.url) location.hash = (p.url.split('#')[1] || ''); } }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, p.title || n.template_key || 'Notification'), p.body ? h('div', { class: 'cp-row-s' }, p.body) : null].filter(Boolean)),
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
