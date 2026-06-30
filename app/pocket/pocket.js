// pocket.js — Wave 9 Carrier Pocket App (carrier-facing, mobile). A carrier signs in and sees
// ONLY their own data — overview, trips, invoices, compliance — via the self-scoping cc_pocket_*
// RPCs (server resolves the carrier org from the session; there is no carrier-id parameter, so
// cross-carrier access is impossible). This is a separate surface from the staff Command Center.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signOut } from '../shared/session.js';
import { pocketOverview, pocketTrips, pocketInvoices, pocketCompliance, pocketConfirmTrip } from '../shared/api.js';

const root = document.getElementById('pk-app');
const h = (tag, attrs, kids) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'onclick') e.onclick = attrs[k]; else e.setAttribute(k, attrs[k]); } (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)); return e; };
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const TONE = { planned: 'gray', dispatched: 'blue', in_transit: 'amber', delivered: 'green', invoiced: 'green', draft: 'gray', sent: 'amber', paid: 'green', valid: 'green', missing: 'gray', pending: 'amber', expired: 'red', rejected: 'red' };
const pill = (s) => h('span', { class: 'pk-pill ' + (TONE[s] || 'gray') }, (s || '').replace('_', ' '));

function loginView() {
  const email = h('input', { class: 'pk-in', type: 'email', placeholder: 'Email' });
  const pass = h('input', { class: 'pk-in', type: 'password', placeholder: 'Password' });
  const err = h('div', { class: 'err' });
  const btn = h('button', { class: 'pk-btn', onclick: async () => {
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
    try { await signInWithPassword(email.value.trim(), pass.value); boot(); }
    catch (e) { err.textContent = (e && e.message) || 'Sign-in failed.'; btn.disabled = false; btn.textContent = 'Sign in'; }
  } }, 'Sign in');
  mount(root, h('div', { class: 'pk-login' }, [
    h('div', { class: 'pk-brand', style: 'font-size:20px;font-weight:800' }, [document.createTextNode('Load'), h('b', { style: 'color:#f97316' }, 'boot')]),
    h('h2', null, 'Carrier Pocket'),
    h('div', { class: 'pk-muted', style: 'text-align:left;padding:0 0 6px' }, 'Sign in to see your loads, trips, invoices and compliance.'),
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

  let tab = 'trips';
  const top = h('div', { class: 'pk-top' }, [
    h('div', { class: 'pk-brand' }, [document.createTextNode('Load'), h('b', null, 'boot'), document.createTextNode(' Pocket')]),
    h('div', { class: 'pk-sub' }, ov.carrier || 'Carrier'),
    h('h1', null, 'Welcome back'),
    h('span', { class: 'pk-chip ' + (ov.compliance_ok ? 'ok' : 'warn') }, ov.compliance_ok ? 'Compliant' : 'Action needed'),
  ]);
  const kpis = h('div', { class: 'pk-kpis' }, [
    h('div', { class: 'pk-kpi' }, [h('div', { class: 'v' }, String(ov.trips_active || 0)), h('div', { class: 'l' }, 'Active trips')]),
    h('div', { class: 'pk-kpi' }, [h('div', { class: 'v' }, String(ov.trips_delivered || 0)), h('div', { class: 'l' }, 'Delivered')]),
    h('div', { class: 'pk-kpi' }, [h('div', { class: 'v' }, money(ov.invoices_due)), h('div', { class: 'l' }, 'Fees due')]),
    h('div', { class: 'pk-kpi' }, [h('div', { class: 'v', style: 'font-size:16px;padding-top:6px' }, (ov.onboarding_stage || '—').replace('_', ' ')), h('div', { class: 'l' }, 'Onboarding')]),
  ]);
  const tabs = h('div', { class: 'pk-tabs' }, ['trips', 'invoices', 'compliance'].map(t =>
    h('div', { class: 'pk-tab' + (t === tab ? ' active' : ''), onclick: () => { tab = t; render(); } }, t[0].toUpperCase() + t.slice(1))));
  const panel = h('div', { class: 'pk-wrap' });

  function render() {
    Array.from(tabs.children).forEach(c => c.classList.toggle('active', c.textContent.toLowerCase() === tab));
    if (tab === 'invoices') loadInvoices(); else if (tab === 'compliance') loadCompliance(); else loadTrips();
  }
  async function loadTrips() {
    mount(panel, h('div', { class: 'pk-muted' }, 'Loading…'));
    let rows; try { rows = await pocketTrips(50); } catch (e) { mount(panel, h('div', { class: 'pk-muted' }, 'Failed to load.')); return; }
    if (!rows || !rows.length) { mount(panel, h('div', { class: 'pk-card' }, h('div', { class: 'pk-muted' }, 'No trips yet.'))); return; }
    mount(panel, h('div', { class: 'pk-card' }, [h('h3', null, 'My trips'), ...rows.map(t => {
      const confirm = (t.status === 'dispatched') ? h('button', { class: 'pk-btn sec', style: 'width:auto;padding:6px 12px;margin:0', onclick: async (ev) => {
        ev.stopPropagation(); ev.currentTarget.disabled = true; try { await pocketConfirmTrip(t.id); ev.currentTarget.textContent = 'Confirmed ✓'; } catch (x) { ev.currentTarget.textContent = 'Error'; }
      } }, 'Confirm') : null;
      return h('div', { class: 'pk-row' }, [
        h('div', null, [h('div', { class: 't' }, (t.origin || '—') + ' → ' + (t.destination || '—')), h('div', { class: 's' }, money(t.rate || 0))]),
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, [pill(t.status), confirm].filter(Boolean)),
      ]);
    })]));
  }
  async function loadInvoices() {
    mount(panel, h('div', { class: 'pk-muted' }, 'Loading…'));
    let rows; try { rows = await pocketInvoices(50); } catch (e) { mount(panel, h('div', { class: 'pk-muted' }, 'Failed to load.')); return; }
    if (!rows || !rows.length) { mount(panel, h('div', { class: 'pk-card' }, h('div', { class: 'pk-muted' }, 'No invoices yet.'))); return; }
    mount(panel, h('div', { class: 'pk-card' }, [h('h3', null, 'Dispatch invoices'), ...rows.map(i =>
      h('div', { class: 'pk-row' }, [
        h('div', null, [h('div', { class: 't' }, i.invoice_no), h('div', { class: 's' }, 'Fee ' + money(i.fee) + ' · gross ' + money(i.gross))]),
        pill(i.status),
      ]))]));
  }
  async function loadCompliance() {
    mount(panel, h('div', { class: 'pk-muted' }, 'Loading…'));
    let c; try { c = await pocketCompliance(); } catch (e) { mount(panel, h('div', { class: 'pk-muted' }, 'Failed to load.')); return; }
    mount(panel, h('div', { class: 'pk-card' }, [
      h('h3', null, 'Compliance — ' + (c.mandatory_ok ? 'all good ✓' : 'action needed')),
      ...(c.requirements || []).map(r => h('div', { class: 'pk-row' }, [
        h('div', null, [h('div', { class: 't' }, r.name), h('div', { class: 's' }, r.mandatory ? 'required' : 'optional')]),
        pill(r.status),
      ])),
    ]));
  }

  mount(root, h('div', null, [top, kpis_wrap(kpis), tabs, panel,
    h('div', { class: 'pk-wrap' }, h('button', { class: 'pk-btn sec', onclick: async () => { await signOut(); boot(); } }, 'Sign out'))]));
  root.setAttribute('aria-busy', 'false');
  render();
  function kpis_wrap(k) { return h('div', { class: 'pk-wrap' }, k); }
}

async function boot() {
  root.setAttribute('aria-busy', 'true');
  let session = null;
  try { session = await getSession(); } catch (_) {}
  if (!session) { loginView(); return; }
  appView();
}

boot();
