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
  pocketReportIssue, pocketDisputeInvoice, publicLoadOpportunities,
} from '../shared/api.js';
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
      h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('Load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, 'Carrier')]),
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
  ['finance', 'Finance', 'finance'], ['documents', 'Documents', 'docs'], ['support', 'Support', 'support'], ['account', 'Account', 'user'],
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
  const bell = h('button', { class: 'cp-iconbtn', title: 'Notifications', onClick: () => go('support') }, icon('bell', 20));
  const shell = h('div', { class: 'cp-shell' }, [
    h('aside', { class: 'cp-side' }, [
      h('div', { class: 'cp-brand' }, [document.createTextNode('Load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, 'Carrier')]),
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
    titleEl.textContent = item ? item[1] : 'Dashboard';
    render();
  }
  window.addEventListener('hashchange', () => { const t = (location.hash || '').replace('#', ''); if (t && t !== tab && NAV.some(n => n[0] === t)) go(t); });

  function render() {
    if (tab === 'loads') loadLoads();
    else if (tab === 'trips') loadTrips();
    else if (tab === 'finance') loadFinance();
    else if (tab === 'documents') loadDocuments();
    else if (tab === 'support') loadSupport();
    else if (tab === 'account') loadAccount();
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
    if (comp && !comp.mandatory_ok) actions.push(['Complete your compliance documents', () => go('documents')]);
    if ((ov.invoices_due || 0) > 0) actions.push([money(ov.invoices_due) + ' in dispatch fees due', () => go('finance')]);
    actions.push(['Browse available loads to book', () => go('loads')]);
    const attention = h('div', { class: 'cp-card' }, [cardHead('Needs your attention'), h('div', null, actions.map(([t, fn]) => h('button', { class: 'cp-rowbtn', onClick: fn }, [h('span', null, t), h('span', { class: 'cp-go' }, '›')])))]);
    const compCard = h('div', { class: 'cp-card' }, [cardHead('Compliance', comp && comp.mandatory_ok ? 'All good ✓' : 'Action needed'),
      ...((comp && comp.requirements || []).slice(0, 6).map(r => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, r.name), h('div', { class: 'cp-row-s' }, r.mandatory ? 'required' : 'optional')]), pill(r.status)])))]);
    mount(content, h('div', null, [promptHost, ...annCards, kpis, h('div', { class: 'cp-grid' }, [financeCard, attention, compCard])]));
    openPrompts();
  }

  /* ----- Available loads ----- */
  async function loadLoads() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading available loads…'));
    let rows; try { rows = await publicLoadOpportunities(24); } catch (e) { rows = []; }
    if (!rows || !rows.length) { mount(content, h('div', { class: 'cp-card' }, h('div', { class: 'cp-muted' }, 'No available loads right now. Check back soon.'))); return; }
    mount(content, h('div', { class: 'cp-loadgrid' }, rows.map(l => {
      const rpm = l.rpm ? '$' + Number(l.rpm).toFixed(2) + '/mi' : '';
      const reqWrap = h('div');
      const req = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Requesting…';
        try { await pocketRaiseIssue('Load request — ' + (l.origin || '') + ' → ' + (l.destination || ''), 'Carrier requested to book load ref #' + (l.ref || '') + ' (' + money(l.rate) + ').'); ev.currentTarget.textContent = 'Requested ✓'; }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Request load'; alert((e && e.message) || 'Could not request.'); }
      } }, 'Request load');
      reqWrap.appendChild(req);
      return h('article', { class: 'cp-load' }, [
        h('div', { class: 'cp-load-top' }, [h('div', { class: 'cp-load-lane' }, [h('b', null, l.origin || '—'), h('span', { class: 'cp-arrow' }, '→'), h('b', null, l.destination || '—')]), h('div', { class: 'cp-load-rate' }, [money(l.rate), rpm ? h('span', null, rpm) : null])]),
        h('div', { class: 'cp-load-tags' }, [h('span', { class: 'cp-tag' }, l.equipment || 'Van'), l.miles ? h('span', { class: 'cp-tag' }, Number(l.miles).toLocaleString() + ' mi') : null, l.pickup_date ? h('span', { class: 'cp-tag' }, 'PU ' + l.pickup_date) : null].filter(Boolean)),
        h('div', { class: 'cp-load-meta' }, 'Ref #' + (l.ref || '—')),
        reqWrap,
      ]);
    })));
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
        const kind = h('select', { class: 'cp-in' }, ['detention', 'layover', 'lumper', 'breakdown', 'weather', 'missed_appointment', 'other'].map(k => h('option', { value: k }, k.replace('_', ' '))));
        const note = h('input', { class: 'cp-in', placeholder: 'Details (optional)' });
        const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…'; try { await pocketReportIssue(t.id, kind.value, note.value.trim()); fw.innerHTML = ''; fw.appendChild(h('div', { class: 'cp-row-s', style: 'color:var(--lb-green)' }, '✓ Reported to dispatch')); } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send'; alert((e && e.message) || 'Could not report.'); } } }, 'Send');
        fw.appendChild(h('div', { class: 'cp-inlineform' }, [kind, note, send]));
      } }, '⚠ Report issue') : null;
      return h('div', { class: 'cp-trip' }, [
        h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, (t.origin || '—') + ' → ' + (t.destination || '—')), h('div', { class: 'cp-row-s' }, money(t.rate || 0))]), pill(t.status)]),
        (confirm || share || issue) ? h('div', { class: 'cp-trip-actions' }, [confirm, share, issue].filter(Boolean)) : null, fw,
      ].filter(Boolean));
    })]));
  }
  function shareLoc(ev, tripId) {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Locating…';
    if (!navigator.geolocation) { btn.textContent = 'GPS not available'; return; }
    navigator.geolocation.getCurrentPosition(async (pos) => { try { await pocketSetConsent(tripId, true); await pocketPostLocation(tripId, pos.coords.latitude, pos.coords.longitude, 'portal'); btn.textContent = '📍 Shared ✓'; } catch (x) { btn.textContent = 'Could not share'; btn.disabled = false; } }, () => { btn.textContent = 'Permission denied'; btn.disabled = false; }, { enableHighAccuracy: true, timeout: 10000 });
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
    mount(content, h('div', null, [
      h('div', { class: 'cp-kpis' }, [statTile('Fees due', money(due), 'finance', 'amber'), statTile('Fees paid', money(paid), 'dash', 'green'), statTile('Gross hauled', money(gross), 'trips', 'blue'), statTile('Invoices', String(rows.length), 'docs', 'violet')]),
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
  async function loadDocuments() {
    mount(content, h('div', { class: 'cp-muted' }, 'Loading…'));
    let c; try { c = await pocketCompliance(); } catch (e) { c = { requirements: [] }; }
    const reqs = (c && c.requirements) || [];
    mount(content, h('div', null, [
      h('div', { class: 'cp-card' }, [cardHead('Onboarding & compliance', c && c.mandatory_ok ? 'All required documents are in ✓' : 'Some documents still needed'),
        reqs.length ? h('div', null, reqs.map(r => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, r.name), h('div', { class: 'cp-row-s' }, r.mandatory ? 'Required' : 'Optional')]), pill(r.status)]))) : h('div', { class: 'cp-muted' }, 'No requirements listed.')]),
      h('div', { class: 'cp-card' }, [cardHead('Upload a document'), h('p', { class: 'cp-muted', style: 'text-align:left' }, 'To submit or update a compliance document, open a support request and your dispatcher will share a secure upload link.'), h('button', { class: 'cp-btn cp-btn-sm', onClick: () => go('support') }, 'Request upload link')]),
    ]));
  }

  /* ----- Support ----- */
  async function loadSupport() {
    const subj = h('input', { class: 'cp-in', placeholder: 'Subject (e.g. detention not applied)' });
    const body = h('textarea', { class: 'cp-in', rows: '3', placeholder: 'Describe the issue…' });
    const msg = h('div', { class: 'cp-err' });
    const list = h('div');
    const send = h('button', { class: 'cp-btn', onClick: async () => { msg.textContent = ''; if (!subj.value.trim()) { msg.textContent = 'Subject is required.'; return; } send.disabled = true; send.textContent = 'Sending…'; try { await pocketRaiseIssue(subj.value.trim(), body.value.trim()); subj.value = ''; body.value = ''; msg.className = 'cp-err ok'; msg.textContent = 'Sent — we’ll get back to you.'; await loadIssues(); } catch (e) { msg.className = 'cp-err'; msg.textContent = (e && e.message) || 'Could not send.'; } send.disabled = false; send.textContent = 'Send to dispatch'; } }, 'Send to dispatch');
    mount(content, h('div', { class: 'cp-grid' }, [h('div', { class: 'cp-card' }, [cardHead('Raise an issue'), subj, body, msg, send]), h('div', { class: 'cp-card' }, [cardHead('Your tickets'), list])]));
    async function loadIssues() { mount(list, h('div', { class: 'cp-muted' }, 'Loading…')); let rows; try { rows = await pocketMyIssues(40); } catch (_) { mount(list, h('div', { class: 'cp-muted' }, 'Failed to load.')); return; } mount(list, (rows && rows.length) ? h('div', null, rows.map(t => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, t.subject), h('div', { class: 'cp-row-s' }, t.ref)]), pill(t.status)]))) : h('div', { class: 'cp-muted' }, 'No tickets yet.')); }
    loadIssues();
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
    mount(content, h('div', { class: 'cp-grid' }, [
      h('div', { class: 'cp-card' }, [cardHead('Profile'), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Carrier'), h('span', null, ov.carrier || '—')]), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Email'), h('span', null, (user && user.email) || '—')]), h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, 'Onboarding'), pill((ov.onboarding_stage || 'pending'))])]),
      h('div', { class: 'cp-card' }, [cardHead('Preferences'), pushRow, h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, 'Location sharing'), h('div', { class: 'cp-row-s' }, 'Asked per active trip, you stay in control')]), h('span', { class: 'cp-pill gray' }, 'per trip')]), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:12px', onClick: async () => { await signOut(); boot(); } }, 'Sign out')]),
    ]));
  }

  function statTile(label, value, iconName, accent, onClick) {
    return h('button', { class: 'cp-stat ' + (accent || '') + (onClick ? ' clickable' : ''), onClick: onClick || null }, [
      h('div', { class: 'cp-stat-ic' }, icon(iconName, 20)),
      h('div', null, [h('div', { class: 'cp-stat-v' }, value), h('div', { class: 'cp-stat-l' }, label)]),
    ]);
  }
  function cardHead(title, sub, onClick) { return h('div', { class: 'cp-cardhead' }, [h('div', null, [h('h3', null, title), sub ? h('span', { class: 'cp-cardhead-sub' }, sub) : null].filter(Boolean)), onClick ? h('button', { class: 'cp-link', onClick }, 'View all →') : null].filter(Boolean)); }

  go(tab);
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
