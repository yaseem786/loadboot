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
  partnerPostLoad, partnerMyLoads, partnerSubmitLoad, rateStandards, brokerShipmentInbox, brokerQuoteShipment, shipperMyShipments, brokerClaimShipment, brokerTenderShipment, myOnboardingPacket, onboardingSubmitItem, currentAgreement, acceptAgreement,
  partnerRequestShipment, partnerMyShipments, shipperPostLoad,
  partnerCreateAppointment, partnerAppointments, partnerSetAppointmentStatus,
  partnerMyInvoices, partnerNotifications, partnerMarkNotificationRead,
  partnerGetProfile, partnerUpdateProfile,
  getPaymentInstructions, partnerSubmitInvoicePayment,
  loadChecklist, partnerChecklistSubmit, partnerUpdateRequests, partnerRespondUpdate,
  isFlagEnabled, myReferral, claimReferral,
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
const LOGO_SVG = '<img src="/icon-512.png" width="34" height="34" alt="LoadBoot" style="border-radius:22%;display:block">';
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
        h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, 'Partner')]),
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
        h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, 'Partner')]),
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

/* notifications bell + dropdown inbox */
function notifBell() {
  const badge = h('span', { class: 'cp-bell-badge', hidden: true });
  const panel = h('div', { class: 'cp-notif-panel', hidden: true });
  const bell = h('button', { class: 'cp-iconbtn', title: 'Notifications', onClick: () => { panel.hidden = !panel.hidden; if (!panel.hidden) load(); } }, [icon('bell', 20), badge]);
  const wrap = h('div', { class: 'cp-bell-wrap' }, [bell, panel]);
  async function refresh() {
    try { const ns = await partnerNotifications(50); const u = (ns || []).filter(n => !n.read_at).length; if (u > 0) { badge.textContent = String(u > 9 ? '9+' : u); badge.hidden = false; } else badge.hidden = true; }
    catch (_) {}
  }
  async function load() {
    mount(panel, h('div', { class: 'cp-notif-loading' }, 'Loading…'));
    let ns; try { ns = await partnerNotifications(50); } catch (e) { mount(panel, h('div', { class: 'cp-notif-loading' }, 'Could not load.')); return; }
    ns = ns || [];
    if (!ns.length) { mount(panel, h('div', { class: 'cp-notif-empty' }, 'No notifications yet.')); return; }
    mount(panel, [h('div', { class: 'cp-notif-head' }, 'Notifications')].concat(ns.map(n => h('div', {
      class: 'cp-notif' + (n.read_at ? '' : ' unread'),
      onClick: async () => { if (!n.read_at) { try { await partnerMarkNotificationRead(n.id); } catch (_) {} } refresh(); load(); },
    }, [
      h('div', { class: 'cp-notif-t' }, n.title),
      n.body ? h('div', { class: 'cp-notif-b' }, n.body) : null,
      h('div', { class: 'cp-notif-time' }, fmtDT(n.created_at)),
    ]))));
  }
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) panel.hidden = true; });
  refresh();
  return wrap;
}

/* ---------- helpers for the dashboard shell ---------- */
function shell(user, kind, company, kpis, content) {
  const label = KIND_LABEL[kind] || 'Partner';
  return h('div', { class: 'cp-shell cp-shell-1col' }, [
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        h('div', { class: 'cp-brandrow', style: 'gap:10px' }, [brandMark(), h('div', null, [
          h('div', { class: 'cp-brand cp-brand-dark' }, [document.createTextNode('load'), h('b', null, 'boot'), h('span', { class: 'cp-brand-sub' }, label)]),
          h('div', { class: 'cp-carrier-name', style: 'font-size:.82rem' }, company || 'Partner'),
        ])]),
        h('div', { class: 'cp-top-right' }, [
          h('span', { class: 'cp-chip ok' }, label),
          notifBell(),
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
  const payInfo = h('div');
  async function load() {
    let instructions = '';
    try { instructions = await getPaymentInstructions(); } catch (_) {}
    mount(payInfo, instructions ? h('div', { class: 'cp-payinfo' }, [h('div', { class: 'cp-payinfo-h' }, 'How to pay'), h('div', { class: 'cp-payinfo-b' }, instructions)]) : null);
    try {
      const rows = await partnerMyInvoices(100);
      if (!rows || !rows.length) { mount(host, h('div', { class: 'lb-state' }, 'No invoices yet.')); return; }
      mount(host, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['Invoice', 'Amount', 'Description', 'Due', 'Status', ''].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(i => {
          const act = h('td', null);
          if (i.status === 'sent' || i.status === 'draft') {
            const b = h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => {
              if (!confirm('Mark invoice ' + i.number + ' as paid? Our team will confirm receipt.')) return;
              b.disabled = true; b.textContent = '…';
              try { await partnerSubmitInvoicePayment(i.id); load(); } catch (e) { b.disabled = false; b.textContent = 'I’ve paid'; alert((e && e.message) || 'Failed'); }
            } }, 'I’ve paid');
            act.appendChild(b);
          } else if (i.status === 'payment_submitted') { act.appendChild(h('span', { class: 'cp-sub' }, 'awaiting confirmation')); }
          return h('tr', null, [
            h('td', null, h('b', null, i.number)), h('td', null, money(i.amount)),
            h('td', null, i.description || '—'), h('td', null, fmtDate(i.due_date)), h('td', null, pill(i.status)), act,
          ]);
        })),
      ]));
    } catch (e) { mount(host, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load invoices.')); }
  }
  load();
  return h('div', { class: 'cp-card', style: 'margin-top:16px' }, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, 'Invoices')]), payInfo, host]);
}

/* account & company settings */
function accountCard() {
  const company = inp('Company name'), contact = inp('Contact name'), phone = inp('Phone', 'tel'), email = inp('Billing email', 'email'), address = inp('Address');
  const msg = h('div', { class: 'cp-err' });
  const saveBtn = h('button', { class: 'cp-btn', onClick: async () => {
    msg.textContent = ''; msg.className = 'cp-err';
    if (!company.value.trim()) { msg.textContent = 'Company name is required.'; return; }
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try { await partnerUpdateProfile({ company: company.value.trim(), contactName: contact.value.trim() || null, phone: phone.value.trim() || null, email: email.value.trim() || null, address: address.value.trim() || null }); msg.className = 'cp-err ok'; msg.textContent = '✓ Saved.'; }
    catch (e) { msg.textContent = (e && e.message) || 'Could not save.'; }
    saveBtn.disabled = false; saveBtn.textContent = 'Save changes';
  } }, 'Save changes');
  (async () => {
    try { const p = await partnerGetProfile(); company.value = p.company || ''; contact.value = p.contact_name || ''; phone.value = p.phone || ''; email.value = p.email || ''; address.value = p.address || ''; } catch (_) {}
  })();
  return h('div', { class: 'cp-card', style: 'margin-top:16px' }, [
    h('div', { class: 'cp-cardhead' }, [icon('user', 18), h('h3', null, 'Account & company')]),
    h('div', { class: 'cp-formgrid' }, [field('Company', company), field('Contact name', contact), field('Phone', phone), field('Billing email', email)]),
    field('Address', address), msg, saveBtn,
  ]);
}

/* WEB-2 — referral program card (flag-gated: referral_program). Brokers earn a share of LoadBoot's own
   dispatch fee on carriers/brokers they refer — the referred party never pays extra. Payouts are human-reviewed. */
function referralCard() {
  const money2 = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const row = (label, valNode) => h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eef2f7' },
    [h('span', { class: 'cp-sub' }, label), valNode]);
  const card = h('div', { class: 'cp-card', style: 'margin-top:16px' }, [
    h('div', { class: 'cp-cardhead' }, [icon('user', 18), h('h3', null, 'Referral program')]),
    h('div', { class: 'cp-sub' }, 'Checking…'),
  ]);
  (async () => {
    let on = false; try { on = await isFlagEnabled('referral_program'); } catch (_) { on = false; }
    if (!on) {
      mount(card, [h('div', { class: 'cp-cardhead' }, [icon('user', 18), h('h3', null, 'Referral program')]),
        h('div', { class: 'cp-sub' }, 'The referral program is not active yet — it is coming soon.')]);
      return;
    }
    let r; try { r = await myReferral(); } catch (e) {
      mount(card, [h('div', { class: 'cp-cardhead' }, [icon('user', 18), h('h3', null, 'Referral program')]),
        h('div', { class: 'cp-sub' }, (e && e.message) || 'Could not load.')]);
      return;
    }
    const copyBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
      try { await navigator.clipboard.writeText(r.link); ev.currentTarget.textContent = 'Copied ✓'; } catch (_) { alert(r.link); }
    } }, 'Copy my link');
    const claimIn = h('input', { class: 'cp-in', placeholder: 'Were you referred? Enter their code once' });
    const claimBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => {
      if (!claimIn.value.trim()) return; ev.currentTarget.disabled = true;
      try { await claimReferral(claimIn.value.trim()); ev.currentTarget.textContent = 'Linked ✓'; }
      catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not link.'); }
    } }, 'Link referrer');
    mount(card, [
      h('div', { class: 'cp-cardhead' }, [icon('user', 18), h('h3', null, 'Referral program')]),
      row('Your code', h('b', null, r.code)),
      row('Referrals', h('span', null, String(r.referrals || 0))),
      row('Accrued (15-day hold)', h('span', null, money2(r.accrued))),
      row('Payable', h('b', { style: 'color:var(--lb-green,#16a34a)' }, money2(r.payable))),
      row('Paid out', h('span', null, money2(r.paid))),
      h('div', { style: 'margin-top:10px' }, copyBtn),
      h('div', { class: 'cp-inlineform', style: 'margin-top:8px' }, [claimIn, claimBtn]),
      h('div', { class: 'cp-sub', style: 'margin-top:8px' }, 'You earn a share of LoadBoot\'s own dispatch fee on every booked trip of carriers or brokers you refer — they never pay extra. Commissions unlock 15 days after accrual; every payout is reviewed by a person.'),
    ]);
  })();
  return card;
}

/* ---------- BROKER dashboard ---------- */
async function brokerDash(user, ov) {
  const kpis = h('div', { class: 'cp-kpis' }, [
    kpiCard('Loads submitted', ov.loads_submitted, 'all time', 'blue'),
    kpiCard('Open', ov.loads_open, 'awaiting dispatch', 'amber'),
    kpiCard('Posted', ov.loads_posted, 'on the board', 'green'),
  ]);
  const err = h('div', { class: 'cp-err' });
  const listHost = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  // ----- Load Wizard (Inc 44): multi-step broker submission with duplicate detection + doc checklist -----
  const w = { appointment_required: false, tracking_required: false };
  const stepHost = h('div');
  const STEPS = ['Lane', 'Schedule', 'Equipment & commodity', 'Requirements', 'Review'];
  let step = 0, confirmDup = false;
  const wi = (label, key, type) => { const i = inp(label, type || 'text'); i.value = w[key] || ''; i.oninput = () => { w[key] = i.value; }; return field(label, i); };
  const toggle = (label, key) => { const b = h('button', { class: 'cp-btn ghost' + (w[key] ? ' on' : ''), onClick: () => { w[key] = !w[key]; b.className = 'cp-btn ghost' + (w[key] ? ' on' : ''); b.textContent = label + ': ' + (w[key] ? 'Yes' : 'No'); } }, label + ': ' + (w[key] ? 'Yes' : 'No')); return b; };
  function renderStep() {
    let body;
    if (step === 0) body = h('div', { class: 'cp-formgrid' }, [wi('Origin city, ST', 'origin'), wi('Destination city, ST', 'destination'), wi('Miles', 'miles', 'number'), wi('Reference (optional)', 'reference')]);
    else if (step === 1) body = h('div', { class: 'cp-formgrid' }, [wi('Pickup date', 'pickup_date', 'date'), wi('Pickup window', 'pickup_window'), wi('Delivery date', 'delivery_date', 'date'), wi('Delivery window', 'delivery_window')]);
    else if (step === 2) body = h('div', { class: 'cp-formgrid' }, [wi('Equipment (e.g. Dry Van)', 'equipment'), wi('Commodity', 'commodity'), wi('Weight (lb)', 'weight', 'number'), wi('Rate ($)', 'rate', 'number')]);
    else if (step === 3) body = h('div', null, [
      h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'A carrier must be able to book without a single phone call — every rate below is REQUIRED before this load can post. By posting you agree these rates apply to this load.'),
      (() => { const b = h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'margin-bottom:8px', onClick: async () => { let m = {}; try { (await rateStandards() || []).forEach(r => { m[r.key] = r.value; }); } catch (_) {} w.acc_detention_per_hr = m.detention_per_hr || '60'; w.acc_detention_free_hours = m.detention_free_hours || '2'; w.acc_layover_per_day = m.layover_per_day || '250'; w.acc_tonu = m.tonu || '250'; w.acc_lumper_policy = m.lumper_policy || 'Reimbursed with receipt'; renderStep(); } }, 'Use industry-typical defaults ($60/hr after 2h · $250 layover · $250 TONU · lumper reimbursed)'); return b; })(),
      h('div', { class: 'cp-formgrid' }, [
        wi('Detention rate ($/hr) *', 'acc_detention_per_hr', 'number'),
        wi('Free time before detention (hours) *', 'acc_detention_free_hours', 'number'),
        wi('Layover rate ($/day) *', 'acc_layover_per_day', 'number'),
        wi('TONU rate ($) *', 'acc_tonu', 'number'),
      ]),
      (() => { const sel = h('select', { class: 'cp-in' }, ['', 'Broker pays lumper directly', 'Reimbursed with receipt', 'Included in rate', 'Not covered'].map(o => h('option', { value: o }, o || 'Lumper policy *'))); sel.value = w.acc_lumper_policy || ''; sel.onchange = () => { w.acc_lumper_policy = sel.value; }; return field('Lumper policy *', sel); })(),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px' }, [toggle('First come, first served (FCFS)', 'fcfs'), toggle('Appointment required', 'appointment_required'), toggle('Tracking required', 'tracking_required')]),
      h('div', { class: 'cp-sub', style: 'margin-top:4px' }, 'Scheduling: choose FCFS, or appointment (set the pickup window in Schedule).'),
      wi('Notes / special instructions', 'notes'),
    ]);
    else body = h('div', { class: 'cp-card', style: 'background:#f8fafc' }, [
      h('div', { class: 'cp-sub' }, 'Review'),
      h('div', { style: 'font-weight:700;margin:6px 0' }, (w.origin || '?') + ' → ' + (w.destination || '?')),
      h('div', { class: 'cp-sub' }, [w.equipment, w.rate ? ('$' + w.rate) : null, w.miles ? (w.miles + ' mi') : null, w.pickup_date].filter(Boolean).join(' · ')),
      h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'Rate card: detention $' + (w.acc_detention_per_hr || '?') + '/hr after ' + (w.acc_detention_free_hours || '?') + 'h free · layover $' + (w.acc_layover_per_day || '?') + '/day · TONU $' + (w.acc_tonu || '?') + ' · lumper: ' + (w.acc_lumper_policy || '?') + ' · ' + (w.fcfs ? 'FCFS' : (w.appointment_required ? 'appointment' : 'window: ' + (w.pickup_window || '—')))),
      h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'On submit, a required-document checklist (rate con, pickup/delivery #, appointment, billing) is created for our dispatch team.'),
    ]);
    const back = h('button', { class: 'cp-btn ghost', onClick: () => { if (step > 0) { step--; renderStep(); } } }, 'Back');
    const nextLbl = step < STEPS.length - 1 ? 'Next' : (confirmDup ? 'Submit anyway' : 'Submit load');
    const next = h('button', { class: 'cp-btn', onClick: async () => {
      err.textContent = ''; err.className = 'cp-err';
      if (step === 0 && (!w.origin || !w.destination)) { err.textContent = 'Origin and destination are required.'; return; }
      if (step === 3) {
        const missing = [];
        [['acc_detention_per_hr', 'detention rate'], ['acc_detention_free_hours', 'free hours'], ['acc_layover_per_day', 'layover rate'], ['acc_tonu', 'TONU rate']].forEach(([k, l]) => { if (w[k] === undefined || w[k] === '' || isNaN(Number(w[k])) || Number(w[k]) < 0) missing.push(l); });
        if (!w.acc_lumper_policy) missing.push('lumper policy');
        if (!w.fcfs && !w.appointment_required && !(w.pickup_window || '').trim()) missing.push('scheduling (FCFS or appointment / pickup window)');
        if (missing.length) { err.textContent = 'Required before posting: ' + missing.join(', ') + '.'; return; }
      }
      if (step < STEPS.length - 1) { step++; renderStep(); return; }
      next.disabled = true; next.textContent = 'Submitting…';
      try {
        const payload = Object.assign({}, w, confirmDup ? { confirm_duplicate: 'true' } : {});
        payload.accessorials = { detention_per_hr: String(w.acc_detention_per_hr), detention_free_hours: String(w.acc_detention_free_hours), layover_per_day: String(w.acc_layover_per_day), tonu: String(w.acc_tonu), lumper_policy: w.acc_lumper_policy, fcfs: w.fcfs ? 'true' : 'false' };
        ['acc_detention_per_hr', 'acc_detention_free_hours', 'acc_layover_per_day', 'acc_tonu', 'acc_lumper_policy'].forEach(k => delete payload[k]);
        await partnerSubmitLoad(payload);
        err.className = 'cp-err ok'; err.textContent = '✓ Load submitted — our dispatch team will review it and generate the document checklist.';
        for (const k in w) delete w[k]; w.appointment_required = false; w.tracking_required = false; step = 0; confirmDup = false; renderStep(); loadList();
      } catch (e) {
        const msg = (e && e.message) || 'Could not submit the load.';
        if (/duplicate/i.test(msg)) { confirmDup = true; err.textContent = 'Possible duplicate in the last 24h. Press “Submit anyway” to proceed.'; renderStep(); }
        else { next.disabled = false; next.textContent = nextLbl; err.textContent = msg; }
      }
    } }, nextLbl);
    mount(stepHost, h('div', null, [
      h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'Step ' + (step + 1) + ' of ' + STEPS.length + ' — ' + STEPS[step]),
      body, err,
      h('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [step > 0 ? back : null, next].filter(Boolean)),
    ]));
  }
  renderStep();
  const form = h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [icon('plus', 18), h('h3', null, 'Post a load')]),
    stepHost,
  ]);
  async function loadList() {
    try {
      const rows = await partnerMyLoads(50);
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No loads yet. Post your first load above.')); return; }
      mount(listHost, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['Lane', 'Equipment', 'Rate', 'Status', 'Tracking'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(l => {
          let track;
          if (l.carrier) track = h('span', null, [pill('booked'), h('span', { style: 'margin-left:6px;font-size:.82rem' }, l.carrier)]);
          else if (l.board_status) track = pill(l.board_status === 'available' ? 'posted' : l.board_status);
          else track = h('span', { class: 'cp-sub' }, '—');
          const docsBtn = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => brokerDocs(l) }, 'Docs');
          return h('tr', null, [
            h('td', null, h('b', null, (l.origin || '—') + ' → ' + (l.destination || '—'))),
            h('td', null, l.equipment || '—'), h('td', null, l.rate ? money(l.rate) : '—'),
            h('td', null, pill(l.status)), h('td', null, h('div', { style: 'display:flex;gap:6px;align-items:center' }, [track, docsBtn])),
          ]);
        })),
      ]));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load.')); }
  }

  // Inc 54 — broker document checklist: see what dispatch needs, submit each item, see rejection reasons.
  function brokerDocs(l) {
    const bodyEl = h('div', null, h('div', { class: 'cp-sub' }, 'Loading checklist…'));
    openModal('Documents — ' + (l.origin || '?') + ' → ' + (l.destination || '?'), [bodyEl]);
    (async () => {
      let items; try { items = await loadChecklist('partner_load', l.id); } catch (e) { mount(bodyEl, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load checklist.')); return; }
      items = (items || []).filter(it => it.required_from === 'broker');
      if (!items.length) { mount(bodyEl, h('div', { class: 'cp-sub' }, 'No documents required from you for this load.')); return; }
      mount(bodyEl, h('div', null, items.map(it => {
        const wrap = h('div', { style: 'padding:8px 0;border-bottom:1px solid #e2e8f0' });
        const statusColor = it.status === 'verified' ? 'var(--lb-green, #16a34a)' : it.status === 'rejected' ? '#dc2626' : '#d97706';
        wrap.appendChild(h('div', { style: 'display:flex;justify-content:space-between' }, [
          h('b', null, it.label || it.doc_key), h('span', { style: 'color:' + statusColor + ';font-weight:700' }, it.status)]));
        if (it.review_reason) wrap.appendChild(h('div', { class: 'cp-sub', style: 'color:#dc2626' }, 'Fix needed: ' + it.review_reason));
        if (it.submitted_ref) wrap.appendChild(h('div', { class: 'cp-sub' }, 'You sent: ' + it.submitted_ref));
        if (it.status === 'required' || it.status === 'rejected') {
          const ref = h('input', { class: 'cp-in', placeholder: 'Document link / reference / note' });
          const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
            if (!ref.value.trim()) { alert('Enter a document reference or note.'); return; }
            ev.currentTarget.disabled = true;
            try { await partnerChecklistSubmit(it.id, ref.value.trim()); ev.currentTarget.textContent = 'Sent ✓'; brokerDocs(l); }
            catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not submit.'); }
          } }, 'Submit');
          wrap.appendChild(h('div', { class: 'cp-inlineform', style: 'margin-top:6px' }, [ref, send]));
        }
        return wrap;
      })));
    })();
  }
  // C2 — shipper requests assigned to THIS broker by Command Center: full facility detail + inline quote.
  function shipmentInboxCard() {
    const card = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, 'Shipper requests (assigned to you)')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
    async function loadInbox() {
      let rows; try { rows = await brokerShipmentInbox(); } catch (e) { mount(card, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, 'Shipper requests')]), h('div', { class: 'cp-sub' }, (e && e.message) || 'Could not load.')]); return; }
      rows = rows || [];
      const items = rows.length ? rows.map(r => {
        const amt = h('input', { class: 'cp-in', type: 'number', placeholder: 'Quote $', style: 'max-width:110px' });
        const note = h('input', { class: 'cp-in', placeholder: 'Quote note (all-in? FCFS?)', style: 'max-width:220px' });
        const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
          if (!amt.value || Number(amt.value) <= 0) { alert('Enter a positive quote amount.'); return; }
          ev.currentTarget.disabled = true;
          try { await brokerQuoteShipment(r.id, Number(amt.value), note.value.trim() || null); ev.currentTarget.textContent = 'Quoted ✓'; }
          catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not quote.'); }
        } }, r.status === 'quoted' ? 'Re-quote' : 'Send quote');
        return h('div', { style: 'padding:10px 0;border-bottom:1px solid #e2e8f0' }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
            h('div', null, [
              h('b', null, (r.origin || '—') + ' → ' + (r.destination || '—')),
              h('div', { class: 'cp-sub' }, [r.equipment, r.weight ? r.weight + ' lb' : null, r.commodity, r.ready_date ? 'ready ' + r.ready_date : null].filter(Boolean).join(' · ')),
              h('div', { class: 'cp-sub' }, 'Facility: ' + (r.facility_notes || '—') + ' · Dock: ' + (r.dock_hours || '—') + (r.appointment_required ? ' · appointment required' : '') + (r.terms ? ' · terms: ' + r.terms : '')),
              h('div', { class: 'cp-sub' }, 'Ref: ' + (r.ref_po || '—') + ' · Cargo value: ' + (r.cargo_value ? '$' + Number(r.cargo_value).toLocaleString() : '—') + (r.temperature ? ' · temp: ' + r.temperature : '') + (r.hazmat ? ' · ⚠ HAZMAT: ' + (r.hazmat_info || '') : '') + (r.seal_required ? ' · seal req.' : '')),
              h('div', { class: 'cp-sub' }, 'PU: ' + (r.pickup_contact || '—') + ' · DEL: ' + (r.delivery_contact || '—')),
              r.quote_amount ? h('div', { class: 'cp-sub', style: 'color:#16a34a' }, 'Your quote: $' + r.quote_amount) : null,
            ].filter(Boolean)),
            h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
              r.open_pool ? h('span', { class: 'cp-pill blue' }, 'OPEN POOL') : pill(r.status),
              r.open_pool ? h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
                ev.currentTarget.disabled = true;
                try { await brokerClaimShipment(r.id); ev.currentTarget.textContent = 'Claimed ✓'; loadInbox && loadInbox(); }
                catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Already claimed.'); }
              } }, 'Claim this freight') : null,
              !r.open_pool && r.status !== 'tendered' ? amt : null,
              !r.open_pool && r.status !== 'tendered' ? note : null,
              !r.open_pool && r.status !== 'tendered' ? send : null,
              !r.open_pool && r.status !== 'tendered' ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a', onClick: async (ev) => {
                const rate = Number(amt.value || r.quote_amount || 0);
                if (!rate || rate <= 0) { alert('Enter the rate first (quote box).'); return; }
                if (!confirm('Tender to LoadBoot dispatch at $' + rate + '? Industry-standard accessorial rates will be attached (server enforces the full card).')) return;
                ev.currentTarget.disabled = true;
                try {
                  let m = {}; try { (await rateStandards() || []).forEach(x => { m[x.key] = x.value; }); } catch (_) {}
                  await brokerTenderShipment(r.id, rate, { detention_per_hr: m.detention_per_hr || '60', detention_free_hours: m.detention_free_hours || '2', layover_per_day: m.layover_per_day || '250', tonu: m.tonu || '250', lumper_policy: m.lumper_policy || 'Reimbursed with receipt', fcfs: r.appointment_required ? 'false' : 'true' });
                  ev.currentTarget.textContent = 'Tendered ✓'; loadInbox && loadInbox(); loadList();
                } catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not tender.'); }
              } }, '🚀 Tender to dispatch') : null,
            ].filter(Boolean)),
          ]),
        ]);
      }) : [h('div', { class: 'cp-sub' }, 'No shipper requests assigned to you right now. Command Center routes shipper freight to licensed broker partners here.')];
      mount(card, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, 'Shipper freight (' + rows.length + ') — open pool + yours')]), ...items]);
    }
    loadInbox();
    return card;
  }
  function packetAgreementCards() {
    const wrap = h('div', null);
    const pc = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Industry onboarding packet')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
    (async () => {
      let pk; try { pk = await myOnboardingPacket(); } catch (_) { pc.remove(); return; }
      mount(pc, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Industry onboarding packet' + (pk.complete ? ' — complete ✓' : ''))]),
        ...(pk.items || []).map(it => h('div', { style: 'display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #e2e8f0;flex-wrap:wrap' }, [
          h('div', null, [h('b', { style: 'font-size:.93rem' }, it.label), h('div', { class: 'cp-sub' }, '[' + it.tag.toUpperCase() + ']' + (it.note ? ' · ' + it.note : ''))]),
          h('div', { style: 'display:flex;gap:6px;align-items:center' }, [pill(it.status),
            (it.status === 'pending' || it.status === 'rejected') ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
              const ref = prompt('Document reference / note for: ' + it.label);
              if (!ref) return;
              try { await onboardingSubmitItem(it.key, ref, null); pc.querySelector('h3').textContent = 'Industry onboarding packet — submitted, refresh to update'; }
              catch (e) { alert((e && e.message) || 'Failed'); }
            } }, it.status === 'rejected' ? 'Resubmit' : 'Submit') : null].filter(Boolean)),
        ]))]);
    })();
    const ac = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Master agreement')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
    (async () => {
      let ag; try { ag = await currentAgreement('broker_carrier'); } catch (_) { ac.remove(); return; }
      if (!ag.available) { mount(ac, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Master agreement')]), h('div', { class: 'cp-sub' }, ag.note || 'Pending legal review.')]); return; }
      mount(ac, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, ag.title + ' (v' + ag.version + ')')]),
        h('pre', { style: 'white-space:pre-wrap;font-size:.82rem;max-height:220px;overflow:auto;background:#f8fafc;padding:10px;border-radius:10px' }, ag.body_md || ''),
        ag.accepted ? h('span', { class: 'cp-pill green' }, 'Accepted ✓') : h('button', { class: 'cp-btn', style: 'margin-top:8px', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await acceptAgreement('broker_carrier'); ev.currentTarget.textContent = 'Accepted ✓'; } catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Failed'); }
        } }, 'Accept agreement (recorded once)')]);
    })();
    wrap.appendChild(pc); wrap.appendChild(ac);
    return wrap;
  }
  mount(root, shell(user, 'broker', ov.company, kpis, h('div', null, [h('div', { class: 'cp-grid2' }, [form, h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, 'My loads')]), listHost])]), shipmentInboxCard(), packetAgreementCards(), invoicesCard(), referralCard(), accountCard()])));
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
  const facility = inp('Facility notes (dock #, entry, contact) *'), dock = inp('Dock hours (e.g. 06:00-14:00) *');
  const refpo = inp('Load / PO reference *'), puc = inp('Pickup contact (name + phone) *'), dlc = inp('Delivery contact (name + phone) *');
  const cval = inp('Cargo value ($) *', 'number'), temp = inp('Temperature (if reefer)'), hazinfo = inp('Hazmat info (class, UN/NA, shipping name)');
  let hazOn = false; const hazBtn = h('button', { class: 'cp-btn ghost', onClick: () => { hazOn = !hazOn; hazBtn.textContent = 'Hazmat: ' + (hazOn ? 'Yes' : 'No'); } }, 'Hazmat: No');
  let sealOn = false; const sealBtn = h('button', { class: 'cp-btn ghost', onClick: () => { sealOn = !sealOn; sealBtn.textContent = 'Seal required: ' + (sealOn ? 'Yes' : 'No'); } }, 'Seal required: No');
  let apptReq = false; const apptBtn = h('button', { class: 'cp-btn ghost', onClick: () => { apptReq = !apptReq; apptBtn.textContent = 'Appointment required: ' + (apptReq ? 'Yes' : 'No'); } }, 'Appointment required: No');
  const err = h('div', { class: 'cp-err' });
  const listHost = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  const btn = h('button', { class: 'cp-btn', onClick: async () => {
    err.textContent = ''; err.className = 'cp-err';
    if (!origin.value.trim() || !dest.value.trim()) { err.textContent = 'Origin and destination are required.'; return; }
    btn.disabled = true; btn.textContent = 'Requesting…';
    try {
      await shipperPostLoad({ origin: origin.value.trim(), destination: dest.value.trim(), ready_date: ready.value || '', equipment: equip.value.trim(), weight: weight.value, commodity: commodity.value.trim(), pieces: pieces.value, accessorials: acc.value.trim() || null, notes: notes.value.trim() || null, facility_notes: facility.value.trim(), dock_hours: dock.value.trim(), appointment_required: apptReq, ref_po: refpo.value.trim(), pickup_contact: puc.value.trim(), delivery_contact: dlc.value.trim(), cargo_value: cval.value, temperature: temp.value.trim(), hazmat: hazOn, hazmat_info: hazinfo.value.trim(), seal_required: sealOn });
      [origin, dest, ready, equip, weight, commodity, pieces, acc, notes].forEach(i => i.value = '');
      err.className = 'cp-err ok'; err.textContent = '✓ Shipment requested — we’ll quote and assign a truck.';
      loadList();
    } catch (e) { err.textContent = (e && e.message) || 'Could not request the shipment.'; }
    btn.disabled = false; btn.textContent = 'Request shipment';
  } }, 'Request shipment');
  const form = h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [icon('plus', 18), h('h3', null, 'Request a shipment')]),
    h('div', { class: 'cp-formgrid' }, [field('Origin', origin), field('Destination', dest), field('Ready date', ready), field('Equipment', equip), field('Weight', weight), field('Commodity', commodity), field('Pieces', pieces), field('Accessorials', acc)]),
    field('Facility notes *', facility), field('Dock hours *', dock), field('Load / PO ref *', refpo), field('Pickup contact *', puc), field('Delivery contact *', dlc), field('Cargo value ($) *', cval), field('Temperature', temp), h('div', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Appointment'), apptBtn]), h('div', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Hazmat'), hazBtn]), field('Hazmat info (LEGAL if hazmat)', hazinfo), h('div', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Seal'), sealBtn]), field('Notes', notes), err, btn,
  ]);
  async function loadList() {
    try {
      // C2 — pipeline-aware list: status, QUOTE and who is handling it (broker identity hidden).
      let rows; try { rows = await shipperMyShipments(); } catch (_) { rows = await partnerMyShipments(50); }
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No shipments yet. Request your first above.')); return; }
      mount(listHost, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['Lane', 'Ready', 'Equipment', 'Status', 'Quote', 'Handled by'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(s => h('tr', null, [
          h('td', null, h('b', null, (s.origin || '—') + ' → ' + (s.destination || '—'))),
          h('td', null, fmtDate(s.ready_date)), h('td', null, s.equipment || '—'),
          h('td', null, pill(s.status)),
          h('td', null, s.quote_amount ? h('b', { style: 'color:#16a34a' }, '$' + Number(s.quote_amount).toLocaleString() + (s.quote_note ? ' · ' + s.quote_note : '')) : h('span', { class: 'cp-sub' }, '—')),
          h('td', null, h('span', { class: 'cp-sub' }, s.handled_by || '—')),
        ]))),
      ]));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load.')); }
  }
  mount(root, shell(user, 'shipper', ov.company, kpis, h('div', null, [h('div', { class: 'cp-grid2' }, [form, h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('ship', 18), h('h3', null, 'My shipments')]), listHost])]), invoicesCard(), accountCard()])));
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
  const weekHost = h('div', { class: 'cp-weekstrip' });
  function renderWeek(rows) {
    const days = [];
    const base = new Date(); base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) { const d = new Date(base); d.setDate(base.getDate() + i); days.push(d); }
    const key = (d) => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    const counts = {};
    (rows || []).forEach(a => { if (!a.window_start) return; const d = new Date(a.window_start); d.setHours(0, 0, 0, 0); counts[key(d)] = (counts[key(d)] || 0) + 1; });
    mount(weekHost, days.map((d, i) => {
      const n = counts[key(d)] || 0;
      return h('div', { class: 'cp-weekday' + (i === 0 ? ' today' : '') + (n ? ' has' : '') }, [
        h('div', { class: 'cp-weekday-d' }, d.toLocaleDateString(undefined, { weekday: 'short' })),
        h('div', { class: 'cp-weekday-n' }, String(d.getDate())),
        h('div', { class: 'cp-weekday-c' }, n ? (n + (n === 1 ? ' appt' : ' appts')) : '—'),
      ]);
    }));
  }
  async function setStatus(id, status, tr) {
    try { await partnerSetAppointmentStatus(id, status); loadList(); }
    catch (e) { if (tr) { const c = h('div', { class: 'cp-err' }, (e && e.message) || 'Failed'); tr.appendChild(c); } }
  }
  async function loadList() {
    try {
      const rows = await partnerAppointments(100);
      renderWeek(rows);
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
  const weekCard = h('div', { class: 'cp-card', style: 'margin-bottom:16px' }, [h('div', { class: 'cp-cardhead' }, [icon('clock', 18), h('h3', null, 'This week')]), weekHost]);
  mount(root, shell(user, 'facility', ov.company, kpis, h('div', null, [weekCard, h('div', { class: 'cp-grid2' }, [form, h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('dock', 18), h('h3', null, 'Appointments')]), listHost])]), invoicesCard(), accountCard()])));
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
