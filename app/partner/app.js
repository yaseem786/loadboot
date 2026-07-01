// app.js — LoadBoot Partner Portal. One responsive web app that serves the three
// non-carrier partner types — BROKER, SHIPPER and FACILITY — adapting to the kind of
// account the signed-in user holds. Like the carrier portal, every read/write is a
// self-scoping cc_partner_* RPC: the server resolves the partner org from the session,
// so a partner can only ever see and touch its own records. Admin/staff use the
// Command Center; carriers use the Carrier portal.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signUp, signOut, onAuthChange } from '../shared/session.js';
import {
  partnerRegister, partnerOverview,
  partnerPostLoad, partnerMyLoads,
  partnerRequestShipment, partnerMyShipments,
  partnerCreateAppointment, partnerAppointments, partnerSetAppointmentStatus,
  partnerMyInvoices,
} from '../shared/api.js';
import { registerAppSW } from '../shared/sw-register.js';
import { mountOfflineBanner } from '../shared/connectivity.js';

registerAppSW();
const root = document.getElementById('lb-app');

/* ---------- tiny DOM helper (shared with carrier portal styling) ---------- */
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
const fmtDate = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return '—'; } };
const fmtDT = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return '—'; } };
const TONE = { submitted: 'amber', accepted: 'blue', declined: 'red', posted: 'green', requested: 'amber', quoted: 'blue', booked: 'green', scheduled: 'blue', checked_in: 'amber', completed: 'green', no_show: 'red', cancelled: 'gray', inbound: 'blue', outbound: 'violet' };
const pill = (s) => h('span', { class: 'cp-pill ' + (TONE[s] || 'gray') }, (s || '').replace(/_/g, ' '));
const ic = (name) => ({
  dash: 'M3 12l9-9 9 9M5 10v10h14V10', loads: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M6 20a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z',
  ship: 'M3 7h13v10H3zM16 10h3l2 3v4h-5', dock: 'M3 21V9l9-6 9 6v12M9 21v-6h6v6', bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9',
  user: 'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8', logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14', clock: 'M12 7v5l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  finance: 'M12 1v22M5 5h11a3 3 0 010 6H8a3 3 0 000 6h11',
}[name] || '');
const icon = (name, size = 20) => h('span', { class: 'cp-ic', html: '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + ic(name) + '"/></svg>' });
const LOGO_SVG = '<svg width="26" height="26" viewBox="0 0 56 56" fill="none" aria-hidden="true"><rect x="17" y="13" width="7.5" height="30" rx="3.2" fill="#fff"/><rect x="17" y="35.5" width="15" height="7.5" rx="3.2" fill="#fff"/><path d="M32 30 L45 39 L32 48 Z" fill="#F97316"/></svg>';
const TAGLINE = 'Keep Your Wheels Earning';
const brandMark = () => h('span', { class: 'cp-logo', html: LOGO_SVG });

const KIND_LABEL = { broker: 'Broker', shipper: 'Shipper', facility: 'Facility' };

/* ---------- auth ---------- */
function authScreen() {
  let signup = false;
  const email = h('input', { class: 'cp-in', type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const pass = h('input', { class: 'cp-in', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const name = h('input', { class: 'cp-in', type: 'text', placeholder: 'Your full name', autocomplete: 'name' });
  const extra = h('div', { style: 'display:none' }, [h('label', { class: 'cp-lbl' }, 'Your name'), name]);
  const err = h('div', { class: 'cp-err' });
  const title = h('h1', null, 'Welcome back');
  const sub = h('p', { class: 'cp-auth-sub' }, 'Sign in to your partner portal.');
  const btn = h('button', { class: 'cp-btn cp-btn-lg' }, 'Sign in');
  const toggle = h('p', { class: 'cp-auth-toggle' });
  const setMode = (s) => {
    signup = s;
    title.textContent = s ? 'Create your account' : 'Welcome back';
    sub.textContent = s ? 'Set up your partner account — it’s free.' : 'Sign in to your partner portal.';
    extra.style.display = s ? 'block' : 'none';
    btn.textContent = s ? 'Create account' : 'Sign in';
    err.textContent = ''; err.className = 'cp-err';
    mount(toggle, s ? [document.createTextNode('Already have an account? '), h('a', { onClick: () => setMode(false) }, 'Sign in')]
      : [document.createTextNode('New partner? '), h('a', { onClick: () => setMode(true) }, 'Create an account')]);
  };
  btn.onclick = async () => {
    err.textContent = ''; err.className = 'cp-err';
    const em = email.value.trim(), pw = pass.value;
    if (!em || !pw) { err.textContent = 'Enter your email and password.'; return; }
    if (signup && !name.value.trim()) { err.textContent = 'Enter your name.'; return; }
    btn.disabled = true; btn.textContent = signup ? 'Creating…' : 'Signing in…';
    try {
      if (signup) {
        const { data, error } = await signUp(em, pw, { name: name.value.trim() });
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
        h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('Load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, 'Partner')]),
        h('div', { class: 'cp-tagline' }, TAGLINE),
      ])]),
      title, sub, h('label', { class: 'cp-lbl' }, 'Email'), email, h('label', { class: 'cp-lbl' }, 'Password'), pass, extra, err, btn, toggle,
      h('div', { class: 'cp-staff' }, [
        h('a', { href: '/app/carrier/' }, 'Are you a carrier? →'),
        h('a', { href: '/app/command-center/' }, 'Staff? Command Center →'),
      ]),
    ]),
  ]));
  setMode(false);
  root.setAttribute('aria-busy', 'false');
}

/* ---------- choose partner type (first-time registration) ---------- */
function choosePartnerType(user) {
  const err = h('div', { class: 'cp-err' });
  const company = h('input', { class: 'cp-in', type: 'text', placeholder: 'Company name', autocomplete: 'organization' });
  let chosen = null;
  const cards = {};
  const opt = (kind, title, desc) => {
    const c = h('button', { class: 'cp-typecard', onClick: () => {
      chosen = kind;
      Object.values(cards).forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
    } }, [h('div', { class: 'cp-typecard-t' }, title), h('div', { class: 'cp-typecard-d' }, desc)]);
    cards[kind] = c; return c;
  };
  const btn = h('button', { class: 'cp-btn cp-btn-lg', onClick: async () => {
    err.textContent = ''; err.className = 'cp-err';
    if (!chosen) { err.textContent = 'Pick what type of partner you are.'; return; }
    if (!company.value.trim()) { err.textContent = 'Enter your company name.'; return; }
    btn.disabled = true; btn.textContent = 'Setting up…';
    try { await partnerRegister(chosen, company.value.trim()); appView(user); }
    catch (e) { err.textContent = (e && e.message) || 'Could not set up your account.'; btn.disabled = false; btn.textContent = 'Continue'; }
  } }, 'Continue');
  mount(root, h('div', { class: 'cp-auth' }, [
    h('div', { class: 'cp-auth-card', style: 'max-width:520px' }, [
      h('div', { class: 'cp-auth-brand' }, [brandMark(), h('div', null, [
        h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('Load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, 'Partner')]),
        h('div', { class: 'cp-tagline' }, TAGLINE),
      ])]),
      h('h1', null, 'Welcome to LoadBoot'),
      h('p', { class: 'cp-auth-sub' }, 'What kind of partner are you? You can set up more later.'),
      h('div', { class: 'cp-typegrid' }, [
        opt('broker', 'Freight Broker', 'Post loads to our carrier network and track them.'),
        opt('shipper', 'Shipper', 'Request freight, get it moved, and track shipments.'),
        opt('facility', 'Facility / Warehouse', 'Schedule dock appointments and manage check-ins.'),
      ]),
      h('label', { class: 'cp-lbl' }, 'Company name'), company, err, btn,
      h('div', { class: 'cp-staff' }, [h('a', { onClick: async () => { await signOut(); boot(); } }, 'Sign out')]),
    ]),
  ]));
  root.setAttribute('aria-busy', 'false');
}

/* ---------- helpers for the dashboard shell ---------- */
function shell(user, kind, company, kpis, content) {
  const label = KIND_LABEL[kind] || 'Partner';
  return h('div', { class: 'cp-shell cp-shell-1col' }, [
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        h('div', { class: 'cp-brandrow', style: 'gap:10px' }, [brandMark(), h('div', null, [
          h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('Load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, label)]),
          h('div', { class: 'cp-carrier-name', style: 'font-size:.82rem' }, company || 'Partner'),
        ])]),
        h('div', { class: 'cp-top-right' }, [
          h('span', { class: 'cp-chip ok' }, label),
          h('div', { class: 'cp-avatar', title: (user && user.email) || '' }, ((company || label)[0] || 'P').toUpperCase()),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { await signOut(); boot(); } }, 'Sign out'),
        ]),
      ]),
      h('div', { class: 'cp-content' }, [kpis, content]),
    ]),
  ]);
}
const kpiCard = (label, value, sub, accent) => h('div', { class: 'cp-kpi ' + (accent || '') }, [
  h('div', { class: 'cp-kpi-v' }, String(value)), h('div', { class: 'cp-kpi-l' }, label), sub ? h('div', { class: 'cp-kpi-s' }, sub) : null,
]);
const field = (label, input) => h('label', { class: 'cp-field2' }, [h('span', null, label), input]);
const inp = (ph, type) => h('input', { class: 'cp-in', type: type || 'text', placeholder: ph || '' });

/* invoices — shown on every partner dashboard (read-only; staff issue + mark paid) */
function invoicesCard() {
  const host = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  (async () => {
    try {
      const rows = await partnerMyInvoices(100);
      if (!rows || !rows.length) { mount(host, h('div', { class: 'lb-state' }, 'No invoices yet.')); return; }
      mount(host, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['Invoice', 'Amount', 'Description', 'Due', 'Status'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(i => h('tr', null, [
          h('td', null, h('b', null, i.number)), h('td', null, money(i.amount)),
          h('td', null, i.description || '—'), h('td', null, fmtDate(i.due_date)), h('td', null, pill(i.status)),
        ]))),
      ]));
    } catch (e) { mount(host, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load invoices.')); }
  })();
  return h('div', { class: 'cp-card', style: 'margin-top:16px' }, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, 'Invoices')]), host]);
}

/* ---------- BROKER dashboard ---------- */
async function brokerDash(user, ov) {
  const kpis = h('div', { class: 'cp-kpis' }, [
    kpiCard('Loads submitted', ov.loads_submitted, 'all time', 'blue'),
    kpiCard('Open', ov.loads_open, 'awaiting dispatch', 'amber'),
    kpiCard('Posted', ov.loads_posted, 'on the board', 'green'),
  ]);
  const origin = inp('Origin city, ST'), dest = inp('Destination city, ST'), equip = inp('Equipment (e.g. Dry Van)');
  const rate = inp('Rate ($)', 'number'), miles = inp('Miles', 'number'), pickup = inp('', 'date'), weight = inp('Weight (lb)', 'number');
  const commodity = inp('Commodity'), notes = inp('Notes (optional)');
  const err = h('div', { class: 'cp-err' });
  const listHost = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  const postBtn = h('button', { class: 'cp-btn', onClick: async () => {
    err.textContent = ''; err.className = 'cp-err';
    if (!origin.value.trim() || !dest.value.trim()) { err.textContent = 'Origin and destination are required.'; return; }
    postBtn.disabled = true; postBtn.textContent = 'Posting…';
    try {
      await partnerPostLoad({ origin: origin.value.trim(), destination: dest.value.trim(), equipment: equip.value.trim() || null, rate: rate.value || null, miles: miles.value || null, pickup: pickup.value || null, weight: weight.value || null, commodity: commodity.value.trim() || null, notes: notes.value.trim() || null });
      [origin, dest, equip, rate, miles, pickup, weight, commodity, notes].forEach(i => i.value = '');
      err.className = 'cp-err ok'; err.textContent = '✓ Load submitted — our dispatch team will review and post it.';
      loadList();
    } catch (e) { err.textContent = (e && e.message) || 'Could not post the load.'; }
    postBtn.disabled = false; postBtn.textContent = 'Post load';
  } }, 'Post load');
  const form = h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [icon('plus', 18), h('h3', null, 'Post a load')]),
    h('div', { class: 'cp-formgrid' }, [field('Origin', origin), field('Destination', dest), field('Equipment', equip), field('Rate', rate), field('Miles', miles), field('Pickup date', pickup), field('Weight', weight), field('Commodity', commodity)]),
    field('Notes', notes), err, postBtn,
  ]);
  async function loadList() {
    try {
      const rows = await partnerMyLoads(50);
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No loads yet. Post your first load above.')); return; }
      mount(listHost, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['Lane', 'Equipment', 'Rate', 'Pickup', 'Status'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(l => h('tr', null, [
          h('td', null, h('b', null, (l.origin || '—') + ' → ' + (l.destination || '—'))),
          h('td', null, l.equipment || '—'), h('td', null, l.rate ? money(l.rate) : '—'),
          h('td', null, fmtDate(l.pickup_date)), h('td', null, pill(l.status)),
        ]))),
      ]));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load.')); }
  }
  mount(root, shell(user, 'broker', ov.company, kpis, h('div', null, [h('div', { class: 'cp-grid2' }, [form, h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, 'My loads')]), listHost])]), invoicesCard()])));
  root.setAttribute('aria-busy', 'false');
  loadList();
}

/* ---------- SHIPPER dashboard ---------- */
async function shipperDash(user, ov) {
  const kpis = h('div', { class: 'cp-kpis' }, [
    kpiCard('Shipments', ov.shipments, 'all time', 'blue'),
    kpiCard('Open', ov.shipments_open, 'awaiting a truck', 'amber'),
    kpiCard('Booked', ov.shipments_booked, 'on the way', 'green'),
  ]);
  const origin = inp('Origin city, ST'), dest = inp('Destination city, ST'), ready = inp('', 'date'), equip = inp('Equipment');
  const weight = inp('Weight (lb)', 'number'), commodity = inp('Commodity'), pieces = inp('Pieces', 'number'), acc = inp('Accessorials (e.g. liftgate)'), notes = inp('Notes (optional)');
  const err = h('div', { class: 'cp-err' });
  const listHost = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  const btn = h('button', { class: 'cp-btn', onClick: async () => {
    err.textContent = ''; err.className = 'cp-err';
    if (!origin.value.trim() || !dest.value.trim()) { err.textContent = 'Origin and destination are required.'; return; }
    btn.disabled = true; btn.textContent = 'Requesting…';
    try {
      await partnerRequestShipment({ origin: origin.value.trim(), destination: dest.value.trim(), ready: ready.value || null, equipment: equip.value.trim() || null, weight: weight.value || null, commodity: commodity.value.trim() || null, pieces: pieces.value || null, accessorials: acc.value.trim() || null, notes: notes.value.trim() || null });
      [origin, dest, ready, equip, weight, commodity, pieces, acc, notes].forEach(i => i.value = '');
      err.className = 'cp-err ok'; err.textContent = '✓ Shipment requested — we’ll quote and assign a truck.';
      loadList();
    } catch (e) { err.textContent = (e && e.message) || 'Could not request the shipment.'; }
    btn.disabled = false; btn.textContent = 'Request shipment';
  } }, 'Request shipment');
  const form = h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [icon('plus', 18), h('h3', null, 'Request a shipment')]),
    h('div', { class: 'cp-formgrid' }, [field('Origin', origin), field('Destination', dest), field('Ready date', ready), field('Equipment', equip), field('Weight', weight), field('Commodity', commodity), field('Pieces', pieces), field('Accessorials', acc)]),
    field('Notes', notes), err, btn,
  ]);
  async function loadList() {
    try {
      const rows = await partnerMyShipments(50);
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No shipments yet. Request your first above.')); return; }
      mount(listHost, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['Lane', 'Ready', 'Equipment', 'Commodity', 'Status'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(s => h('tr', null, [
          h('td', null, h('b', null, (s.origin || '—') + ' → ' + (s.destination || '—'))),
          h('td', null, fmtDate(s.ready_date)), h('td', null, s.equipment || '—'),
          h('td', null, s.commodity || '—'), h('td', null, pill(s.status)),
        ]))),
      ]));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load.')); }
  }
  mount(root, shell(user, 'shipper', ov.company, kpis, h('div', null, [h('div', { class: 'cp-grid2' }, [form, h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('ship', 18), h('h3', null, 'My shipments')]), listHost])]), invoicesCard()])));
  root.setAttribute('aria-busy', 'false');
  loadList();
}

/* ---------- FACILITY dashboard ---------- */
async function facilityDash(user, ov) {
  const kpis = h('div', { class: 'cp-kpis' }, [
    kpiCard('Today', ov.appts_today, 'appointments', 'blue'),
    kpiCard('Upcoming', ov.appts_upcoming, 'scheduled', 'amber'),
    kpiCard('Checked in', ov.appts_checked_in, 'on site now', 'green'),
  ]);
  const dir = h('select', { class: 'cp-in' }, [h('option', { value: 'inbound' }, 'Inbound'), h('option', { value: 'outbound' }, 'Outbound')]);
  const start = inp('', 'datetime-local'), end = inp('', 'datetime-local'), dock = inp('Dock / door'), carrier = inp('Carrier name'), ref = inp('Reference / PO'), notes = inp('Notes (optional)');
  const err = h('div', { class: 'cp-err' });
  const listHost = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  const btn = h('button', { class: 'cp-btn', onClick: async () => {
    err.textContent = ''; err.className = 'cp-err';
    if (!start.value) { err.textContent = 'Pick an appointment start time.'; return; }
    btn.disabled = true; btn.textContent = 'Scheduling…';
    try {
      await partnerCreateAppointment({ direction: dir.value, windowStart: new Date(start.value).toISOString(), windowEnd: end.value ? new Date(end.value).toISOString() : null, dock: dock.value.trim() || null, carrierName: carrier.value.trim() || null, reference: ref.value.trim() || null, notes: notes.value.trim() || null });
      [start, end, dock, carrier, ref, notes].forEach(i => i.value = '');
      err.className = 'cp-err ok'; err.textContent = '✓ Appointment scheduled.';
      loadList();
    } catch (e) { err.textContent = (e && e.message) || 'Could not schedule.'; }
    btn.disabled = false; btn.textContent = 'Schedule appointment';
  } }, 'Schedule appointment');
  const form = h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [icon('plus', 18), h('h3', null, 'New dock appointment')]),
    h('div', { class: 'cp-formgrid' }, [field('Direction', dir), field('Start', start), field('End', end), field('Dock', dock), field('Carrier', carrier), field('Reference', ref)]),
    field('Notes', notes), err, btn,
  ]);
  async function setStatus(id, status, tr) {
    try { await partnerSetAppointmentStatus(id, status); loadList(); }
    catch (e) { if (tr) { const c = h('div', { class: 'cp-err' }, (e && e.message) || 'Failed'); tr.appendChild(c); } }
  }
  async function loadList() {
    try {
      const rows = await partnerAppointments(100);
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No appointments yet. Schedule one above.')); return; }
      mount(listHost, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['When', 'Dir', 'Dock', 'Carrier', 'Status', ''].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(a => {
          const actions = h('td', null);
          if (a.status === 'scheduled') actions.appendChild(h('button', { class: 'cp-btn cp-btn-sm', onClick: (ev) => setStatus(a.id, 'checked_in', ev.currentTarget.closest('tr')) }, 'Check in'));
          else if (a.status === 'checked_in') actions.appendChild(h('button', { class: 'cp-btn cp-btn-sm', onClick: (ev) => setStatus(a.id, 'completed', ev.currentTarget.closest('tr')) }, 'Complete'));
          return h('tr', null, [
            h('td', null, fmtDT(a.window_start)), h('td', null, pill(a.direction)),
            h('td', null, a.dock || '—'), h('td', null, a.carrier_name || '—'),
            h('td', null, pill(a.status)), actions,
          ]);
        })),
      ]));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load.')); }
  }
  mount(root, shell(user, 'facility', ov.company, kpis, h('div', null, [h('div', { class: 'cp-grid2' }, [form, h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('dock', 18), h('h3', null, 'Appointments')]), listHost])]), invoicesCard()])));
  root.setAttribute('aria-busy', 'false');
  loadList();
}

/* ---------- app view ---------- */
async function appView(user) {
  let ov;
  try { ov = await partnerOverview(); }
  catch (e) {
    if (/not a partner account/i.test((e && e.message) || '')) { choosePartnerType(user); return; }
    mount(root, h('div', { class: 'cp-auth' }, h('div', { class: 'cp-auth-card' }, [
      h('h1', null, 'Could not load'), h('p', { class: 'cp-auth-sub' }, 'Please refresh and try again.'),
      h('button', { class: 'cp-btn cp-btn-lg', onClick: () => boot() }, 'Retry'),
    ]))); return;
  }
  if (ov.kind === 'broker') return brokerDash(user, ov);
  if (ov.kind === 'shipper') return shipperDash(user, ov);
  if (ov.kind === 'facility') return facilityDash(user, ov);
  choosePartnerType(user);
}

/* ---------- boot + auth guard (only reload on a real sign-out) ---------- */
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
