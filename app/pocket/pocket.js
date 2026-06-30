// pocket.js — Carrier Pocket App (carrier-facing, mobile PWA). A carrier signs in and sees
// ONLY their own data via self-scoping cc_pocket_* RPCs (server resolves the carrier org from
// the session; no carrier-id parameter, so cross-carrier access is impossible).
// Sections: Home (action center + onboarding/compliance), Trips (confirm + live GPS share),
// Finance (dispatch invoices), Support (raise an issue + history). Installable PWA + GPS.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signOut } from '../shared/session.js';
import {
  pocketOverview, pocketTrips, pocketInvoices, pocketCompliance, pocketConfirmTrip,
  pocketSetConsent, pocketPostLocation, pocketRaiseIssue, pocketMyIssues, pocketAnnouncements,
} from '../shared/api.js';

const root = document.getElementById('pk-app');
const h = (tag, attrs, kids) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'onclick') e.onclick = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); } (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)); return e; };
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const TONE = { planned: 'gray', dispatched: 'blue', in_transit: 'amber', delivered: 'green', invoiced: 'green', draft: 'gray', sent: 'amber', paid: 'green', valid: 'green', missing: 'gray', pending: 'amber', expired: 'red', rejected: 'red', open: 'amber', resolved: 'green', closed: 'gray' };
const pill = (s) => h('span', { class: 'pk-pill ' + (TONE[s] || 'gray') }, (s || '').replace(/_/g, ' '));

// ---------- PWA: register a tiny offline-capable service worker ----------
function registerPocketSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./pocket-sw.js').catch(() => {});
}

function loginView() {
  const email = h('input', { class: 'pk-in', type: 'email', placeholder: 'Email', autocomplete: 'username' });
  const pass = h('input', { class: 'pk-in', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const err = h('div', { class: 'err' });
  const btn = h('button', { class: 'pk-btn', onclick: async () => {
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
    try { await signInWithPassword(email.value.trim(), pass.value); boot(); }
    catch (e) { err.textContent = (e && e.message) || 'Sign-in failed.'; btn.disabled = false; btn.textContent = 'Sign in'; }
  } }, 'Sign in');
  mount(root, h('div', { class: 'pk-login' }, [
    h('div', { class: 'pk-brand', style: 'font-size:20px;font-weight:800' }, [document.createTextNode('Load'), h('b', { style: 'color:#f97316' }, 'boot')]),
    h('h2', null, 'Carrier Pocket'),
    h('div', { class: 'pk-muted', style: 'text-align:left;padding:0 0 6px' }, 'Sign in to manage your loads, trips, invoices, compliance and support.'),
    email, pass, err, btn,
  ]));
  root.setAttribute('aria-busy', 'false');
}

function notCarrierView() {
  mount(root, h('div', { class: 'pk-login' }, [
    h('h2', null, 'No carrier account'),
    h('div', { class: 'pk-muted', style: 'text-align:left' }, 'This sign-in is not linked to a carrier. If you believe this is an error, contact your dispatcher.'),
    h('button', { class: 'pk-btn sec', onclick: async () => { await signOut(); boot(); } }, 'Sign out'),
  ]));
  root.setAttribute('aria-busy', 'false');
}

async function appView() {
  let ov; try { ov = await pocketOverview(); }
  catch (e) { if (/carrier account/i.test(e && e.message || '')) { notCarrierView(); return; } mount(root, h('div', { class: 'pk-muted' }, 'Could not load. Pull to retry.')); return; }

  let tab = 'home';
  const top = h('div', { class: 'pk-top' }, [
    h('div', { class: 'pk-brand' }, [document.createTextNode('Load'), h('b', null, 'boot'), document.createTextNode(' Pocket')]),
    h('div', { class: 'pk-sub' }, ov.carrier || 'Carrier'),
    h('h1', null, 'Welcome back'),
    h('span', { class: 'pk-chip ' + (ov.compliance_ok ? 'ok' : 'warn') }, ov.compliance_ok ? 'Compliant' : 'Action needed'),
  ]);
  const TABS = [['home', 'Home'], ['trips', 'Trips'], ['finance', 'Finance'], ['support', 'Support']];
  const tabs = h('div', { class: 'pk-tabs' }, TABS.map(([t, label]) =>
    h('div', { class: 'pk-tab' + (t === tab ? ' active' : ''), onclick: () => { tab = t; render(); } }, label)));
  const panel = h('div', { class: 'pk-wrap' });

  function render() {
    Array.from(tabs.children).forEach((c, i) => c.classList.toggle('active', TABS[i][0] === tab));
    if (tab === 'trips') loadTrips();
    else if (tab === 'finance') loadFinance();
    else if (tab === 'support') loadSupport();
    else loadHome();
  }

  // ---------- CP-A: Home / Action center + onboarding/compliance ----------
  async function loadHome() {
    mount(panel, h('div', { class: 'pk-muted' }, 'Loading…'));
    let c; try { c = await pocketCompliance(); } catch (_) { c = { requirements: [], mandatory_ok: ov.compliance_ok }; }
    let anns = []; try { anns = await pocketAnnouncements(); } catch (_) { anns = []; }
    const annCards = (anns || []).map(a => h('div', { class: 'pk-ann ' + (a.kind || 'info') }, [
      h('div', { class: 'pk-ann-t' }, a.title),
      a.body ? h('div', { class: 'pk-ann-b' }, a.body) : null,
    ].filter(Boolean)));
    const actions = [];
    if (!c.mandatory_ok) actions.push(['Complete your compliance documents', 'compliance']);
    if ((ov.invoices_due || 0) > 0) actions.push([money(ov.invoices_due) + ' in dispatch fees due', 'finance']);
    const kpis = h('div', { class: 'pk-kpis' }, [
      h('div', { class: 'pk-kpi' }, [h('div', { class: 'v' }, String(ov.trips_active || 0)), h('div', { class: 'l' }, 'Active trips')]),
      h('div', { class: 'pk-kpi' }, [h('div', { class: 'v' }, String(ov.trips_delivered || 0)), h('div', { class: 'l' }, 'Delivered')]),
      h('div', { class: 'pk-kpi' }, [h('div', { class: 'v' }, money(ov.invoices_due)), h('div', { class: 'l' }, 'Fees due')]),
      h('div', { class: 'pk-kpi' }, [h('div', { class: 'v', style: 'font-size:15px;padding-top:7px' }, (ov.onboarding_stage || '—').replace(/_/g, ' ')), h('div', { class: 'l' }, 'Onboarding')]),
    ]);
    const actionCard = h('div', { class: 'pk-card' }, [
      h('h3', null, 'Needs your attention'),
      actions.length ? h('div', null, actions.map(([txt, go]) => h('div', { class: 'pk-row', onclick: () => { tab = go; render(); } }, [
        h('div', { class: 't' }, txt), h('span', { class: 'pk-go' }, '›'),
      ]))) : h('div', { class: 'pk-muted' }, 'All clear — nothing needs you right now. 🎉'),
    ]);
    const compCard = h('div', { class: 'pk-card' }, [
      h('h3', null, 'Compliance — ' + (c.mandatory_ok ? 'all good ✓' : 'action needed')),
      ...((c.requirements || []).map(r => h('div', { class: 'pk-row' }, [
        h('div', null, [h('div', { class: 't' }, r.name), h('div', { class: 's' }, r.mandatory ? 'required' : 'optional')]),
        pill(r.status),
      ]))),
    ]);
    mount(panel, h('div', null, [...annCards, kpis, actionCard, compCard]));
  }

  // ---------- CP-B + CP-E: Trips (confirm) + live GPS share ----------
  async function loadTrips() {
    mount(panel, h('div', { class: 'pk-muted' }, 'Loading…'));
    let rows; try { rows = await pocketTrips(50); } catch (e) { mount(panel, h('div', { class: 'pk-muted' }, 'Failed to load.')); return; }
    if (!rows || !rows.length) { mount(panel, h('div', { class: 'pk-card' }, h('div', { class: 'pk-muted' }, 'No trips yet.'))); return; }
    mount(panel, h('div', { class: 'pk-card' }, [h('h3', null, 'My trips'), ...rows.map(t => {
      const isActive = t.status === 'dispatched' || t.status === 'in_transit';
      const confirm = (t.status === 'dispatched') ? h('button', { class: 'pk-btn sec pk-mini', onclick: async (ev) => {
        ev.stopPropagation(); ev.currentTarget.disabled = true; try { await pocketConfirmTrip(t.id); ev.currentTarget.textContent = 'Confirmed ✓'; } catch (x) { ev.currentTarget.textContent = 'Error'; }
      } }, 'Confirm') : null;
      const share = isActive ? h('button', { class: 'pk-btn pk-mini', onclick: (ev) => shareLocation(ev, t.id) }, '📍 Share location') : null;
      return h('div', { class: 'pk-trip' }, [
        h('div', { class: 'pk-row', style: 'border:0;padding:0' }, [
          h('div', null, [h('div', { class: 't' }, (t.origin || '—') + ' → ' + (t.destination || '—')), h('div', { class: 's' }, money(t.rate || 0))]),
          pill(t.status),
        ]),
        (confirm || share) ? h('div', { class: 'pk-trip-actions' }, [confirm, share].filter(Boolean)) : null,
      ].filter(Boolean));
    })]));
  }

  function shareLocation(ev, tripId) {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Locating…';
    if (!navigator.geolocation) { btn.textContent = 'GPS not available'; return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await pocketSetConsent(tripId, true);
        await pocketPostLocation(tripId, pos.coords.latitude, pos.coords.longitude, 'pocket');
        btn.textContent = '📍 Location shared ✓';
      } catch (x) { btn.textContent = 'Could not share'; btn.disabled = false; }
    }, () => { btn.textContent = 'Permission denied'; btn.disabled = false; }, { enableHighAccuracy: true, timeout: 10000 });
  }

  // ---------- CP-D: Finance (dispatch invoices) ----------
  async function loadFinance() {
    mount(panel, h('div', { class: 'pk-muted' }, 'Loading…'));
    let rows; try { rows = await pocketInvoices(50); } catch (e) { mount(panel, h('div', { class: 'pk-muted' }, 'Failed to load.')); return; }
    const due = (rows || []).filter(i => i.status === 'sent').reduce((a, i) => a + (Number(i.fee) || 0), 0);
    mount(panel, h('div', null, [
      h('div', { class: 'pk-card' }, [h('h3', null, 'Summary'), h('div', { class: 'pk-row' }, [h('div', { class: 't' }, 'Dispatch fees due'), h('b', null, money(due))])]),
      h('div', { class: 'pk-card' }, [h('h3', null, 'Invoices'),
        (rows && rows.length) ? h('div', null, rows.map(i => h('div', { class: 'pk-row' }, [
          h('div', null, [h('div', { class: 't' }, i.invoice_no), h('div', { class: 's' }, 'Fee ' + money(i.fee) + ' · gross ' + money(i.gross))]),
          pill(i.status),
        ]))) : h('div', { class: 'pk-muted' }, 'No invoices yet.'),
      ]),
    ]));
  }

  // ---------- CP-C: Support (raise an issue + history) ----------
  async function loadSupport() {
    const subj = h('input', { class: 'pk-in', placeholder: 'Subject (e.g. detention not applied)' });
    const bodyIn = h('textarea', { class: 'pk-in', rows: '3', placeholder: 'Describe the issue…' });
    const msg = h('div', { class: 'err' });
    const listWrap = h('div');
    const send = h('button', { class: 'pk-btn', onclick: async () => {
      msg.textContent = ''; if (!subj.value.trim()) { msg.textContent = 'Subject is required.'; return; }
      send.disabled = true; send.textContent = 'Sending…';
      try { await pocketRaiseIssue(subj.value.trim(), bodyIn.value.trim()); subj.value = ''; bodyIn.value = ''; msg.style.color = '#16a34a'; msg.textContent = 'Sent — we’ll get back to you.'; await loadIssues(); }
      catch (e) { msg.style.color = ''; msg.textContent = (e && e.message) || 'Could not send.'; }
      send.disabled = false; send.textContent = 'Send to dispatch';
    } }, 'Send to dispatch');
    mount(panel, h('div', null, [
      h('div', { class: 'pk-card' }, [h('h3', null, 'Raise an issue'), subj, bodyIn, msg, send]),
      h('div', { class: 'pk-card' }, [h('h3', null, 'Your issues'), listWrap]),
    ]));
    async function loadIssues() {
      mount(listWrap, h('div', { class: 'pk-muted' }, 'Loading…'));
      let rows; try { rows = await pocketMyIssues(30); } catch (_) { mount(listWrap, h('div', { class: 'pk-muted' }, 'Failed to load.')); return; }
      mount(listWrap, (rows && rows.length) ? h('div', null, rows.map(t => h('div', { class: 'pk-row' }, [
        h('div', null, [h('div', { class: 't' }, t.subject), h('div', { class: 's' }, t.ref)]),
        pill(t.status),
      ]))) : h('div', { class: 'pk-muted' }, 'No issues yet.'));
    }
    loadIssues();
  }

  mount(root, h('div', null, [top, h('div', { class: 'pk-wrap' }, tabs), panel,
    h('div', { class: 'pk-wrap' }, h('button', { class: 'pk-btn sec', onclick: async () => { await signOut(); boot(); } }, 'Sign out'))]));
  root.setAttribute('aria-busy', 'false');
  render();
}

async function boot() {
  root.setAttribute('aria-busy', 'true');
  let session = null;
  try { session = await getSession(); } catch (_) {}
  if (!session) { loginView(); return; }
  appView();
}

registerPocketSW();
boot();
