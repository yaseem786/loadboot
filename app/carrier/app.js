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
  pocketAvailableLoads, pocketBookLoad, carrierBestLoads, getDispatchPrefs, setDispatchPrefs, tripArrive, tripDepart,
  isFlagEnabled, myReferral, claimReferral, myReferralEarnings,
  carrierPnl, carrierAddExpense, carrierExpenses, carrierDeleteExpense,
  pocketNotifications, pocketMarkNotificationRead,
} from '../shared/api.js';
import { uploadDocument, uploadPodDocument } from '../shared/storage.js';
import { enablePush, isPushEnabled, pushSupported } from '../shared/push.js';
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
const TONE = { planned: 'gray', dispatched: 'blue', in_transit: 'amber', delivered: 'green', invoiced: 'green', draft: 'gray', sent: 'amber', paid: 'green', valid: 'green', missing: 'gray', pending: 'amber', expired: 'red', rejected: 'red', open: 'amber', resolved: 'green', closed: 'gray', active: 'green' };
const pill = (s) => h('span', { class: 'cp-pill ' + (TONE[s] || 'gray') }, (s || '').replace(/_/g, ' '));
const ic = (name) => ({
  dash: 'M3 12l9-9 9 9M5 10v10h14V10', loads: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M6 20a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z',
  trips: 'M5 17h14M5 17a2 2 0 11-4 0 2 2 0 014 0zm14 0a2 2 0 11-4 0M7 17V7h8v10M15 9h3l3 4v4', finance: 'M12 1v22M5 5h11a3 3 0 010 6H8a3 3 0 000 6h11',
  docs: 'M6 2h9l5 5v15H6zM14 2v6h6', support: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', user: 'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8',
  pin: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0zM12 13a3 3 0 100-6 3 3 0 000 6z', logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
}[name] || '');
const icon = (name, size = 20) => h('span', { class: 'cp-ic', html: '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + ic(name) + '"/></svg>' });
// Official LoadBoot mark (the "L" + orange arrow), same as the marketing site.
const LOGO_SVG = '<img src="/icon-512.png" width="26" height="26" alt="LoadBoot" style="border-radius:22%;display:block">';
const TAGLINE = 'Keep Your Wheels Earning';
const brandMark = () => h('span', { class: 'cp-logo', html: LOGO_SVG });

// horizontal/line-ish bar chart from [{label,value}]
function miniBars(data, opts = {}) {
  const d = data || []; const max = Math.max(1, ...d.map(p => Number(p.value) || 0));
  const W = 100, H = 40, n = d.length || 1, gap = 1.6, bw = (W - gap * (n - 1)) / n;
  let bars = '';
  d.forEach((p, i) => { const hh = (Number(p.value) || 0) / max * (H - 4); bars += '<rect x="' + (i * (bw + gap)).toFixed(2) + '" y="' + (H - hh).toFixed(2) + '" width="' + bw.toFixed(2) + '" height="' + Math.max(hh, 0.8).toFixed(2) + '" rx="1" fill="url(#cpg)"/>'; });
  return h('div', { class: 'cp-chart', html: '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%" height="' + (opts.height || 64) + '"><defs><linearGradient id="cpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#93c5fd"/></linearGradient></defs>' + bars + '</svg>' });
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
      h('div', { class: 'cp-auth-brand' }, [brandMark(), h('div', null, [
        h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('Load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, 'Carrier')]),
        h('div', { class: 'cp-tagline' }, TAGLINE),
      ])]),
      title, sub, h('label', { class: 'cp-lbl' }, 'Email'), email, h('label', { class: 'cp-lbl' }, 'Password'), pass, extra, err, btn, toggle,
      h('div', { class: 'cp-staff' }, [document.createTextNode('Staff member? '), h('a', { href: '/app/command-center/' }, 'Open the Command Center →')]),
    ]),
  ]));
  setMode(false);
  root.setAttribute('aria-busy', 'false');
}

function notCarrier() {
  mount(root, h('div', { class: 'cp-auth' }, [h('div', { class: 'cp-auth-card' }, [
    h('h1', null, 'No carrier account'),
    h('p', { class: 'cp-auth-sub' }, 'This sign-in isn’t linked to a carrier. Contact your dispatcher if you think this is an error.'),
    h('button', { class: 'cp-btn cp-btn-lg', onClick: async () => { await signOut(); boot(); } }, 'Sign out'),
  ])]));
  root.setAttribute('aria-busy', 'false');
}

/* ---------- main app ---------- */
const NAV = [
  ['dashboard', 'Dashboard', 'dash'], ['loads', 'Available loads', 'loads'], ['trips', 'My trips', 'trips'],
  ['fleet', 'Fleet', 'trips'], ['finance', 'Finance', 'finance'], ['documents', 'Documents', 'docs'],
  ['support', 'Support', 'support'], ['account', 'Account', 'user'],
];

async function appView(user) {
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
      h('div', { class: 'cp-brandrow' }, [brandMark(), h('div', null, [
        h('div', { class: 'cp-brand' }, [document.createTextNode('Load'), h('b', null, 'boot')]),
        h('div', { class: 'cp-tagline light' }, TAGLINE),
      ])]),
      sideNav(false),
      h('div', { class: 'cp-side-foot' }, [
        h('div', { class: 'cp-carrier' }, [h('div', { class: 'cp-carrier-name' }, ov.carrier || 'Carrier'), h('div', { class: 'cp-carrier-mail' }, (user && user.email) || '')]),
        h('button', { class: 'cp-side-out', onClick: async () => { await signOut(); boot(); } }, [icon('logout', 16), h('span', null, 'Sign out')]),
      ]),
    ]),
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        titleEl,
        h('div', { class: 'cp-top-right' }, [
          h('span', { class: 'cp-chip ' + (ov.compliance_ok ? 'ok' : 'warn') }, ov.compliance_ok ? 'Compliant' : 'Action needed'),
          bell,
          h('div', { class: 'cp-avatar', title: (user && user.email) || '' }, ((ov.carrier || 'C')[0] || 'C').toUpperCase()),
        ]),
      ]),
      content,
    ]),
    sideNav(true),
  ]);
  mount(root, shell);
  root.setAttribute('aria-busy', 'false');

  function go(id) {
    tab = id; if (location.hash !== '#' + id) location.hash = id;
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
    else loadDashboard();
  }

  /* ----- on-open prompts: notifications + location ----- */
  function openPrompts() {
    const items = [];
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
  async function loadDashboard() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let comp, anns, invs;
    try { [comp, anns, invs] = await Promise.all([pocketCompliance().catch(() => ({ requirements: [], mandatory_ok: ov.compliance_ok })), pocketAnnouncements().catch(() => []), pocketInvoices(50).catch(() => [])]); } catch (_) {}
    const annCards = (anns || []).map(a => h('div', { class: 'cp-ann ' + (a.kind || 'info') }, [h('div', { class: 'cp-ann-t' }, a.title), a.body ? h('div', { class: 'cp-ann-b' }, a.body) : null].filter(Boolean)));
    const kpis = h('div', { class: 'cp-kpis' }, [
      statTile('Active trips', String(ov.trips_active || 0), 'trips', 'blue', () => go('trips')),
      statTile('Delivered', String(ov.trips_delivered || 0), 'dash', 'green', () => go('trips')),
      statTile('Fees due', money(ov.invoices_due), 'finance', 'amber', () => go('finance')),
      statTile('Onboarding', (ov.onboarding_stage || '—').replace(/_/g, ' '), 'docs', 'violet', () => go('documents')),
    ]);
    // finance mini-chart from recent invoices (fee per invoice)
    const feeSeries = (invs || []).slice(0, 12).reverse().map((i, k) => ({ label: String(k), value: Number(i.fee) || 0 }));
    const due = (invs || []).filter(i => i.status === 'sent').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const paid = (invs || []).filter(i => i.status === 'paid').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    const financeCard = h('div', { class: 'cp-card cp-col2' }, [
      cardHead('Dispatch fees', 'Recent invoices', () => go('finance')),
      feeSeries.length ? miniBars(feeSeries, { height: 70 }) : h('div', { class: 'cp-muted' }, 'No invoices yet.'),
      h('div', { class: 'cp-legend' }, [h('span', null, ['Due ', h('b', null, money(due))]), h('span', null, ['Paid ', h('b', null, money(paid))])]),
    ]);
    const actions = [];
    const obs = (ov.onboarding_stage || '').toLowerCase();
    if (obs && obs !== 'approved' && obs !== 'active' && obs !== 'complete') actions.push(['Complete your onboarding — guided setup', () => go('onboarding')]);
    if (comp && !comp.mandatory_ok) actions.push(['Complete your compliance documents', () => go('documents')]);
    if ((ov.invoices_due || 0) > 0) actions.push([money(ov.invoices_due) + ' in dispatch fees due', () => go('finance')]);
    actions.push(['Browse available loads to book', () => go('loads')]);
    const attention = h('div', { class: 'cp-card' }, [cardHead('Needs your attention'), h('div', null, actions.map(([t, fn]) => h('button', { class: 'cp-rowbtn', onClick: fn }, [h('span', null, t), h('span', { class: 'cp-go' }, '›')])))]);
    const compCard = h('div', { class: 'cp-card' }, [cardHead('Compliance', comp && comp.mandatory_ok ? 'All good ✓' : 'Action needed'),
      ...((comp && comp.requirements || []).slice(0, 6).map(r => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, r.name), h('div', { class: 'cp-row-s' }, r.mandatory ? 'required' : 'optional')]), pill(r.status)])))]);
    mount(content, h('div', null, [promptHost, ...annCards, kpis, h('div', { class: 'cp-grid' }, [financeCard, attention, compCard])]));
    openPrompts();
  }

  /* ----- Available loads (Phase 2B — real, race-safe booking) ----- */
  async function loadLoads() {
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
    if (!rows || !rows.length) { mount(content, h('div', null, [bestCard, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No available loads right now. Check back soon.'))].filter(Boolean))); return; }
    mount(content, h('div', null, [bestCard, h('div', { class: 'cp-loadgrid' }, rows.map(l => {
      const rpm = l.rpm ? '$' + Number(l.rpm).toFixed(2) + '/mi' : '';
      const bookWrap = h('div');
      const book = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        if (!confirm('Book this load?\n\n' + (l.origin || '') + ' → ' + (l.destination || '') + '\n' + money(l.rate) + (rpm ? ' · ' + rpm : '') + '\n\nIt will move to My trips.')) return;
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Booking…';
        try {
          await pocketBookLoad(l.id);
          mount(bookWrap, [h('div', { class: 'cp-row-s', style: 'color:var(--lb-green);margin-bottom:6px' }, '✓ Booked — added to your trips'), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('trips') }, 'Go to My trips')]);
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Book this load'; alert((e && e.message) || 'Could not book this load.'); }
      } }, 'Book this load');
      bookWrap.appendChild(book);
      const meta = [];
      if (l.commodity) meta.push('Commodity: ' + l.commodity);
      if (l.weight) meta.push('Weight: ' + l.weight);
      if (l.deadhead) meta.push(l.deadhead + ' mi deadhead');
      if (l.broker) meta.push('Broker: ' + l.broker);
      return h('article', { class: 'cp-load' }, [
        h('div', { class: 'cp-load-top' }, [h('div', { class: 'cp-load-lane' }, [h('b', null, l.origin || '—'), h('span', { class: 'cp-arrow' }, '→'), h('b', null, l.destination || '—')]), h('div', { class: 'cp-load-rate' }, [money(l.rate), rpm ? h('span', null, rpm) : null])]),
        h('div', { class: 'cp-load-tags' }, [h('span', { class: 'cp-tag' }, l.equipment || 'Van'), l.miles ? h('span', { class: 'cp-tag' }, Number(l.miles).toLocaleString() + ' mi') : null, l.pickup_date ? h('span', { class: 'cp-tag' }, 'PU ' + l.pickup_date) : null, l.delivery_date ? h('span', { class: 'cp-tag' }, 'DEL ' + l.delivery_date) : null].filter(Boolean)),
        meta.length ? h('div', { class: 'cp-load-meta' }, meta.join(' · ')) : null,
        l.requirements ? h('div', { class: 'cp-row-s' }, l.requirements) : null,
        bookWrap,
      ].filter(Boolean));
    }))].filter(Boolean)));
  }

  /* ----- My trips ----- */
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
        h('div', { class: 'cp-trip-actions' }, [confirm, start, deliver, share, dwell, issue, pod, assign, history].filter(Boolean)), fw, podW, dwellW,
      ].filter(Boolean));
    })]));

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
    ]));
    renderDrivers(); renderTrucks();
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
      mount(stmtCard, [
        cardHead('Account statement'),
        line('Invoices', String(s.invoices_total || 0)),
        line('Fees outstanding', money(s.fees_outstanding || 0)),
        line('Fees paid', money(s.fees_paid || 0)),
        line('Open disputes', String(s.open_disputes || 0)),
        line('Settlements', String(settlements.length)),
        h('div', { style: 'margin-top:12px' }, download),
      ]);
    })();
    // Inc 55 — Profit & Loss (honest labels: confirmed revenue vs manually-entered expenses; ESTIMATE marked).
    const pnlCard = h('div', { class: 'cp-card' }, [cardHead('Profit & Loss (this month)'), h('div', { class: 'cp-muted' }, 'Loading…')]);
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
    })();
    mount(content, h('div', null, [
      h('div', { class: 'cp-kpis' }, [statTile('Fees due', money(due), 'finance', 'amber'), statTile('Fees paid', money(paid), 'dash', 'green'), statTile('Gross hauled', money(gross), 'trips', 'blue'), statTile('Invoices', String(rows.length), 'docs', 'violet')]),
      pnlCard,
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
        return h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, i.invoice_no), h('div', { class: 'cp-row-s' }, 'Fee ' + money(i.fee) + ' · gross ' + money(i.gross))]), pill(i.status)]), dispute ? h('div', { class: 'cp-trip-actions' }, [dispute]) : null, dw].filter(Boolean));
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
    mount(content, h('div', null, [
      h('div', { class: 'cp-card' }, [cardHead('Onboarding & compliance', c && c.mandatory_ok ? 'All required documents are in ✓' : 'Some documents still needed'),
        reqs.length ? h('div', null, reqs.map(r => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, r.name), h('div', { class: 'cp-row-s' }, r.mandatory ? 'Required' : 'Optional')]), pill(r.status)]))) : h('div', { class: 'cp-muted' }, 'No requirements listed.')]),
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
        h('div', null, [h('div', { class: 'cp-row-t' }, label(d.type)), h('div', { class: 'cp-row-s' }, d.file_name)]), pill(d.status || 'pending'),
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
    mount(content, h('div', { class: 'cp-grid' }, [
      h('div', { class: 'cp-card' }, [cardHead('Raise an issue'), subj, body, msg, send]),
      h('div', { class: 'cp-card' }, [cardHead('Your tickets'), list]),
      h('div', { class: 'cp-card' }, [cardHead('Reported trip issues'), exList]),
    ]));
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
      const fld = (label, val, ph) => { const i = h('input', { class: 'cp-input', placeholder: ph || '' }); i.value = val == null ? '' : String(val); return { row: h('label', { class: 'cp-field' }, [h('span', null, label), i]), i }; };
      const f1 = fld('Minimum rate ($/mi)', dp.min_rpm, 'e.g. 2.25');
      const f2 = fld('Preferred equipment (comma separated)', (dp.preferred_equipment || []).join(', '), 'Dry Van, Reefer');
      const f3 = fld('Preferred lanes / regions (comma separated)', (dp.preferred_lanes || []).join(', '), 'TX, Atlanta, Midwest');
      const f4 = fld('Max deadhead (miles)', dp.max_deadhead_miles, 'e.g. 250');
      const f5 = fld('Home base', dp.home_base, 'Dallas, TX');
      const saveBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
        try {
          await setDispatchPrefs({ min_rpm: f1.i.value || null,
            preferred_equipment: f2.i.value.split(',').map(x => x.trim()).filter(Boolean),
            preferred_lanes: f3.i.value.split(',').map(x => x.trim()).filter(Boolean),
            max_deadhead_miles: f4.i.value || null, home_base: f5.i.value || null });
          ev.currentTarget.textContent = 'Saved ✓'; setTimeout(() => { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save preferences'; }, 1500);
        } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save preferences'; alert((e && e.message) || 'Could not save.'); }
      } }, 'Save preferences');
      mount(dispCard, [cardHead('Dispatch preferences (AI Pilot)'),
        h('div', { class: 'cp-muted', style: 'margin-bottom:8px' }, 'Tell us what loads you want — the AI Pilot ranks "Best for you" loads and dispatcher pushes using these.'),
        f1.row, f2.row, f3.row, f4.row, f5.row, h('div', { style: 'margin-top:8px' }, saveBtn)]);
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
        h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'You earn a share of LoadBoot\'s own dispatch fee on every booked trip of carriers/brokers you refer — they never pay extra. Commissions unlock 15 days after accrual; payouts are reviewed by a person.'),
      ]);
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
    mount(content, h('div', { class: 'cp-grid' }, [
      h('div', { class: 'cp-card' }, [cardHead('Profile'), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Carrier'), h('span', null, ov.carrier || '—')]), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Email'), h('span', null, (user && user.email) || '—')]), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Onboarding'), pill((ov.onboarding_stage || 'pending'))])]),
      teamCard,
      h('div', { class: 'cp-card' }, [cardHead('Device & privacy'), pushRow, h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, 'Location sharing'), h('div', { class: 'cp-row-s' }, 'Asked per active trip, you stay in control')]), h('span', { class: 'cp-pill gray' }, 'per trip')]), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:12px', onClick: async () => { await signOut(); boot(); } }, 'Sign out')]),
      dispCard,
      refCard,
      prefsCard,
    ]));
  }

  /* ----- Onboarding wizard (Phase 2A) ----- */
  async function loadOnboarding() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    const EQUIP = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Hotshot', 'Power Only', 'Box Truck', 'Conestoga', 'Tanker', 'Car Hauler'];
    const STEPS = ['Company & authority', 'Operation & equipment', 'Factoring & payment', 'Documents', 'Review & submit'];
    let prof = {}; try { prof = await pocketGetProfile(); } catch (_) { prof = {}; }
    const f = Object.assign({ company: '', contact_name: '', phone: '', mc: '', dot: '', home_base: '', radius_miles: '', equipment_types: [], truck_count: '', hazmat: false, weekend_ok: false, factoring_status: '', factoring_company: '', contact_method: '', whatsapp: '' }, prof || {});
    if (!Array.isArray(f.equipment_types)) f.equipment_types = [];
    let st = 0;
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
      return h('div', null, [h('p', { class: 'cp-row-s' }, 'Check your details, then submit. Our team reviews and approves your account.'), row('Company', f.company), row('Contact', f.contact_name + (f.phone ? ' · ' + f.phone : '')), row('MC / DOT', (f.mc || '—') + ' / ' + (f.dot || '—')), row('Home base', f.home_base), row('Equipment', (f.equipment_types || []).join(', ')), row('Trucks', f.truck_count), row('Factoring', f.factoring_status + (f.factoring_company ? ' · ' + f.factoring_company : ''))]);
    }
    function doneCard() { return [h('div', { class: 'cp-wiz-done' }, [h('div', { style: 'font-size:2.4rem' }, '✓'), h('h3', null, 'Submitted for review'), h('p', { class: 'cp-row-s' }, 'Thanks! Our team is reviewing your onboarding. You’ll get a notification when it’s approved.'), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('dashboard') }, 'Back to dashboard')])]; }
    function draw() {
      const pct = Math.round((st / (STEPS.length - 1)) * 100);
      let body;
      if (st === 0) body = h('div', { class: 'cp-wiz-grid' }, [field('Company / carrier name', 'company', 'Acme Trucking LLC'), field('Your name', 'contact_name'), field('Phone', 'phone'), field('MC number', 'mc', '123456'), field('DOT number', 'dot', '1234567')]);
      else if (st === 1) { const eq = h('div', { class: 'cp-eqgrid' }, EQUIP.map(e => { const on = (f.equipment_types || []).includes(e); const b = h('button', { class: 'cp-chip2' + (on ? ' on' : ''), onClick: () => { const s = new Set(f.equipment_types || []); if (s.has(e)) s.delete(e); else s.add(e); f.equipment_types = [...s]; b.classList.toggle('on'); } }, e); return b; })); body = h('div', { class: 'cp-wiz-grid' }, [field('Home base (city, ST)', 'home_base', 'Dallas, TX'), field('Search radius (miles)', 'radius_miles', '300', 'number'), field('Number of trucks', 'truck_count', '1'), h('div', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Equipment types'), eq]), toggle('Haul hazmat', 'hazmat'), toggle('Available weekends', 'weekend_ok')]); }
      else if (st === 2) body = h('div', { class: 'cp-wiz-grid' }, [selectField('Factoring', 'factoring_status', [['', '—'], ['yes', 'I use factoring'], ['no', 'No factoring'], ['interested', 'Interested']]), field('Factoring company', 'factoring_company'), selectField('Preferred contact', 'contact_method', [['', '—'], ['phone', 'Phone'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email']]), field('WhatsApp number', 'whatsapp')]);
      else if (st === 3) body = docStep();
      else body = reviewStep();
      const back = st > 0 ? h('button', { class: 'cp-btn ghost cp-btn-sm', onClick: () => { st--; draw(); } }, '← Back') : h('span');
      const next = st < STEPS.length - 1
        ? h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…'; try { await save(); st++; draw(); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save & continue'; alert((e && e.message) || 'Could not save.'); } } }, 'Save & continue')
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
