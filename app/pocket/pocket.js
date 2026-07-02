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
  pocketReportIssue, pocketDisputeInvoice, pocketUploadPod, pocketTripPods, pocketAdvanceTrip,
  tripArrive, tripDepart, tripEmergencyRequest, myNotifications, markMyNotification,
  dispatchSheet,
} from '../shared/api.js';
import { uploadPodDocument } from '../shared/storage.js';
import { enablePush, isPushEnabled, pushSupported } from '../shared/push.js';

const POD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
// Only MIME types the private Storage bucket + backend actually accept. Do NOT advertise HEIC/HEIF —
// it is not validated end-to-end, so we do not claim it.
const POD_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const POD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
const fmtBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

const root = document.getElementById('pk-app');
const h = (tag, attrs, kids) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'onclick') e.onclick = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); } (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)); return e; };
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
// GLOBAL notification tone tokens (same palette as the carrier portal / Command Center pushes).
const NTONE = { urgent: '#dc2626', warning: '#d97706', action: '#0883F7', success: '#16a34a', info: '#475569' };
const NBG   = { urgent: '#fef2f2', warning: '#fffbeb', action: '#eff6ff', success: '#f0fdf4', info: '#f8fafc' };
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
    h('div', { class: 'pk-brand', style: 'font-size:20px;font-weight:800;display:flex;align-items:center;gap:2px' }, [h('span', { html: '<img src="/icon-512.png" width="28" height="28" alt="LoadBoot" style="border-radius:22%;display:block">' }), document.createTextNode('load'), h('b', null, 'boot')]),
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
    h('div', { class: 'pk-brand', style: 'display:flex;align-items:center;gap:2px' }, [h('span', { html: '<img src="/icon-512.png" width="24" height="24" alt="LoadBoot" style="border-radius:22%;display:block">' }), document.createTextNode('load'), h('b', null, 'boot'), document.createTextNode(' Pocket')]),
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
    // A9 — today's trip, front and center (driver companion: what am I doing RIGHT NOW?)
    let heroTrip = null; try { const ts = await pocketTrips(10); heroTrip = (ts || []).find(t => t.status === 'in_transit') || (ts || []).find(t => t.status === 'dispatched') || null; } catch (_) {}
    const heroCard = heroTrip ? h('div', { class: 'pk-card', style: 'border-left:4px solid #0883F7' }, [
      h('h3', null, heroTrip.status === 'in_transit' ? '🚛 On the road now' : '📋 Today’s trip — confirm & start'),
      h('div', { class: 'pk-row', style: 'border:0' }, [
        h('div', null, [h('div', { class: 't' }, (heroTrip.origin || '—') + ' → ' + (heroTrip.destination || '—')), h('div', { class: 's' }, money(heroTrip.rate || 0))]),
        pill(heroTrip.status),
      ]),
      h('button', { class: 'pk-btn', onclick: () => { tab = 'trips'; render(); } }, 'Open trip — share location, arrive/depart, POD →'),
    ]) : null;
    // A9 — unified per-user notifications (Command Center pushes; global tone colours)
    let notifs = []; try { notifs = await myNotifications(15); } catch (_) { notifs = []; }
    const unread = (notifs || []).filter(n => !n.read_at);
    const notifCard = (notifs && notifs.length) ? h('div', { class: 'pk-card' }, [
      h('h3', null, 'Notifications' + (unread.length ? ' (' + unread.length + ' new)' : '')),
      ...notifs.slice(0, 8).map(n => {
        const p = n.payload || {}; const tone = p.tone && NTONE[p.tone] ? p.tone : 'info';
        const row = h('div', { class: 'pk-row', style: 'border-left:3px solid ' + NTONE[tone] + ';padding-left:8px;border-radius:6px;background:' + (n.read_at ? 'transparent' : NBG[tone]), onclick: async () => {
          if (!n.read_at) { try { await markMyNotification(n.id); n.read_at = '1'; row.style.background = 'transparent'; } catch (_) {} }
        } }, [
          h('div', null, [h('div', { class: 't' }, p.title || n.template_key || 'Notification'), p.body ? h('div', { class: 's' }, p.body) : null].filter(Boolean)),
        ]);
        return row;
      }),
    ]) : null;
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
    // Phase 5 — enable push notifications on this device
    let pushCard = null;
    if (pushSupported()) {
      const status = h('span', { class: 'pk-pill gray' }, 'checking…');
      const btn = h('button', { class: 'pk-btn pk-mini', onclick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Enabling…';
        try { await enablePush('Carrier device'); status.textContent = 'on'; status.className = 'pk-pill green'; ev.currentTarget.textContent = 'On ✓'; }
        catch (e) { status.textContent = 'off'; ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Turn on'; alert((e && e.message) || 'Could not enable notifications.'); }
      } }, 'Turn on');
      isPushEnabled().then(on => { status.textContent = on ? 'on' : 'off'; status.className = 'pk-pill ' + (on ? 'green' : 'gray'); if (on) { btn.textContent = 'On ✓'; btn.disabled = true; } });
      pushCard = h('div', { class: 'pk-card' }, [h('h3', null, 'Push notifications'),
        h('div', { class: 'pk-row', style: 'border:0;padding:0' }, [
          h('div', null, [h('div', { class: 't' }, 'Alerts for trips, payments & announcements'), h('div', { class: 's' }, 'On this device')]),
          h('div', { style: 'display:flex;gap:8px;align-items:center' }, [status, btn])])]);
    }
    mount(panel, h('div', null, [heroCard, notifCard, ...annCards, kpis, actionCard, pushCard, compCard].filter(Boolean)));
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
      const formWrap = h('div');
      const issueBtn = isActive ? h('button', { class: 'pk-btn sec pk-mini', onclick: () => {
        if (formWrap.firstChild) { formWrap.innerHTML = ''; return; }
        const kind = h('select', { class: 'pk-in' }, ['detention', 'layover', 'lumper', 'tonu', 'breakdown', 'accident', 'weather', 'missed_appointment', 'other'].map(k => h('option', { value: k }, k === 'tonu' ? 'TONU' : k.replace('_', ' '))));
        const note = h('input', { class: 'pk-in', placeholder: 'Details (optional)' });
        const send = h('button', { class: 'pk-btn pk-mini', onclick: async (ev) => {
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…';
          try { await pocketReportIssue(t.id, kind.value, note.value.trim()); formWrap.innerHTML = ''; const ok = h('div', { class: 's', style: 'color:#16a34a' }, '✓ Reported to dispatch'); formWrap.appendChild(ok); }
          catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send'; alert((e && e.message) || 'Could not report.'); }
        } }, 'Send');
        formWrap.appendChild(h('div', { class: 'pk-issueform' }, [kind, note, send]));
      } }, '⚠ Report issue') : null;
      // ---- POD: proof-of-delivery upload/review, only once the trip is delivered or invoiced ----
      const canPod = t.status === 'delivered' || t.status === 'invoiced';
      const podWrap = h('div');
      const podBtn = canPod ? h('button', { class: 'pk-btn pk-mini', onclick: () => {
        if (podWrap.firstChild) { podWrap.innerHTML = ''; return; }
        showPodPanel(t, podWrap);
      } }, '📄 Proof of delivery') : null;
      const adv = (label, next) => h('button', { class: 'pk-btn pk-mini', onclick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = '…';
        try { await pocketAdvanceTrip(t.id, next); loadTrips(); }
        catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = label; alert((e && e.message) || 'Could not update.'); }
      } }, label);
      const startBtn = (t.status === 'dispatched') ? adv('▶ Start', 'in_transit') : null;
      const deliverBtn = (t.status === 'dispatched' || t.status === 'in_transit') ? adv('✓ Delivered', 'delivered') : null;
      // Detention protection — arrive/depart stamps from the driver's phone (measured, not argued).
      const stamp = (label, fn, stop) => h('button', { class: 'pk-btn sec pk-mini', onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { const r = await fn(t.id, stop); ev.currentTarget.textContent = '✓ ' + label; if (r && r.detention_minutes > 0) alert('Detention recorded: ' + r.detention_minutes + ' min beyond free time — dispatch is notified.'); }
        catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Could not record.'); }
      } }, label);
      const stamps = isActive ? [stamp('At pickup', tripArrive, 'pickup'), stamp('Left pickup', tripDepart, 'pickup'), stamp('At delivery', tripArrive, 'delivery'), stamp('Left delivery', tripDepart, 'delivery')] : [];
      // Emergency / reschedule — defined category + detailed reason + PROOF required (A3 flow).
      const shWrap = h('div');
      const shBtn = h('button', { class: 'pk-btn sec pk-mini', onclick: async () => {
        if (shWrap.firstChild) { shWrap.innerHTML = ''; return; }
        shWrap.appendChild(h('div', { class: 's' }, 'Loading sheet…'));
        try {
          const d = await dispatchSheet(t.id);
          shWrap.innerHTML = '';
          const row = (k, v) => h('div', { class: 'pk-row', style: 'padding:5px 0' }, [h('div', { class: 's' }, k), h('div', { class: 't', style: 'font-size:13px;text-align:right' }, String(v ?? '—'))]);
          [['Rate', '$' + (d.agreed_rate || 0)], ['RPM', d.loaded_rpm], ['Pickup', (d.pickup && (d.pickup.address + ' · ' + (d.pickup.window || d.pickup.date || ''))) || '—'],
           ['Delivery', (d.delivery && (d.delivery.address + ' · ' + (d.delivery.window || d.delivery.date || ''))) || '—'],
           ['Detention', (d.detention && ('$' + d.detention.rate_per_hr + '/hr after ' + d.detention.free_hours + 'h')) || '—'],
           ['Lumper', d.lumper_process], ['POD', d.pod_instructions], ['Emergency', d.emergency_contact]]
            .forEach(([k, v]) => shWrap.appendChild(row(k, v)));
        } catch (e) { shWrap.innerHTML = ''; shWrap.appendChild(h('div', { class: 's' }, (e && e.message) || 'Could not load.')); }
      } }, '📋 Sheet');
      const emWrap = h('div');
      const emBtn = isActive ? h('button', { class: 'pk-btn sec pk-mini', style: 'color:#dc2626;border-color:#fecaca', onclick: () => {
        if (emWrap.firstChild) { emWrap.innerHTML = ''; return; }
        const cat = h('select', { class: 'pk-in' }, ['breakdown', 'accident', 'weather', 'medical', 'road_closure', 'hours_of_service', 'mechanical', 'theft', 'other'].map(k => h('option', { value: k }, k.replace(/_/g, ' '))));
        const reason = h('input', { class: 'pk-in', placeholder: 'Detailed reason (min 10 characters) *' });
        const proof = h('input', { class: 'pk-in', placeholder: 'Proof — photo link / doc ref *' });
        const when = h('input', { class: 'pk-in', type: 'datetime-local' });
        const send = h('button', { class: 'pk-btn pk-mini', onclick: async (ev) => {
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…';
          try { await tripEmergencyRequest({ trip: t.id, category: cat.value, reason: reason.value.trim(), proof_ref: proof.value.trim(), reschedule_to: when.value || null }); emWrap.innerHTML = ''; emWrap.appendChild(h('div', { class: 's', style: 'color:#16a34a' }, '✓ Sent — dispatch is notified with priority')); }
          catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send emergency'; alert((e && e.message) || 'Could not send.'); }
        } }, 'Send emergency');
        emWrap.appendChild(h('div', { class: 'pk-issueform' }, [cat, reason, proof, h('div', { class: 's' }, 'New delivery time (optional):'), when, send]));
      } }, '🚨 Emergency') : null;
      return h('div', { class: 'pk-trip' }, [
        h('div', { class: 'pk-row', style: 'border:0;padding:0' }, [
          h('div', null, [h('div', { class: 't' }, (t.origin || '—') + ' → ' + (t.destination || '—')), h('div', { class: 's' }, money(t.rate || 0))]),
          pill(t.status),
        ]),
        (confirm || startBtn || deliverBtn || share || issueBtn || podBtn) ? h('div', { class: 'pk-trip-actions' }, [confirm, startBtn, deliverBtn, share, shBtn, issueBtn, podBtn, ...stamps, emBtn].filter(Boolean)) : null,
        formWrap,
        podWrap,
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
        (rows && rows.length) ? h('div', null, rows.map(i => {
          const dWrap = h('div');
          const disputeBtn = (i.status === 'sent' || i.status === 'paid') ? h('button', { class: 'pk-btn sec pk-mini', onclick: () => {
            if (dWrap.firstChild) { dWrap.innerHTML = ''; return; }
            const reason = h('input', { class: 'pk-in', placeholder: 'Reason for dispute' });
            const send = h('button', { class: 'pk-btn pk-mini', onclick: async (ev) => {
              if (!reason.value.trim()) { alert('Enter a reason.'); return; }
              ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Sending…';
              try { await pocketDisputeInvoice(i.id, reason.value.trim()); dWrap.innerHTML = ''; dWrap.appendChild(h('div', { class: 's', style: 'color:#16a34a' }, '✓ Dispute opened')); }
              catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Send'; alert((e && e.message) || 'Could not dispute.'); }
            } }, 'Send');
            dWrap.appendChild(h('div', { class: 'pk-issueform' }, [reason, send]));
          } }, 'Dispute') : null;
          return h('div', { class: 'pk-trip' }, [
            h('div', { class: 'pk-row', style: 'border:0;padding:0' }, [
              h('div', null, [h('div', { class: 't' }, i.invoice_no), h('div', { class: 's' }, 'Fee ' + money(i.fee) + ' · gross ' + money(i.gross))]),
              pill(i.status),
            ]),
            disputeBtn ? h('div', { class: 'pk-trip-actions' }, [disputeBtn]) : null,
            dWrap,
          ].filter(Boolean));
        })) : h('div', { class: 'pk-muted' }, 'No invoices yet.'),
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

// ---------- CP-POD: Proof-of-delivery upload + review status (private Storage bucket) ----------
// Renders inside a trip card. Shows existing POD versions with review status / rejection reason,
// and — unless an approved POD is already on file — a validated uploader with preview, remove/replace,
// upload state, success, validation error, network-failure retry and duplicate handling.
function showPodPanel(t, wrap) {
  const box = h('div', { class: 'pk-pod' });
  mount(wrap, box);
  renderExisting();

  async function renderExisting() {
    mount(box, h('div', { class: 'pk-muted' }, 'Loading proof of delivery…'));
    let pods;
    try { pods = await pocketTripPods(t.id); }
    catch (e) { mount(box, h('div', { class: 'err' }, (e && e.message) || 'Could not load proof of delivery.')); return; }
    pods = pods || [];
    const items = pods.map((p, i) => h('div', { class: 'pk-row' }, [
      h('div', null, [
        h('div', { class: 't' }, (p.file_name || 'POD') + (i === 0 && pods.length > 1 ? ' · latest' : '')),
        h('div', { class: 's' }, 'Uploaded ' + fmtDate(p.created_at)),
        (p.status === 'rejected' && p.review_note) ? h('div', { class: 's', style: 'color:#dc2626' }, '✕ Rejected: ' + p.review_note) : null,
        (p.status === 'approved') ? h('div', { class: 's', style: 'color:#16a34a' }, '✓ Approved by dispatch') : null,
      ].filter(Boolean)),
      pill(p.status || 'pending'),
    ]));
    const hasPending = pods.some(p => (p.status || 'pending') === 'pending');
    const hasApproved = pods.some(p => p.status === 'approved');
    const latestRejected = pods[0] && pods[0].status === 'rejected';
    mount(box, h('div', null, [
      h('h3', null, 'Proof of delivery'),
      items.length ? h('div', null, items) : h('div', { class: 'pk-muted' }, 'No POD uploaded yet for this trip.'),
      hasApproved
        ? h('div', { class: 's', style: 'color:#16a34a;padding-top:6px' }, 'An approved POD is on file — nothing more to do.')
        : uploader({ hasPending, resubmit: latestRejected }),
    ].filter(Boolean)));
  }

  function uploader(state) {
    let file = null, url = null;
    const wrapEl = h('div', { class: 'pk-podup' });
    const errEl = h('div', { class: 'err' });
    const preview = h('div', { class: 'pk-podprev' });
    const status = h('div', { class: 's' });

    const fileInput = h('input', { type: 'file', accept: POD_ACCEPT, style: 'display:none' });
    const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
    fileInput.onchange = () => pick(fileInput.files && fileInput.files[0]);
    camInput.onchange = () => pick(camInput.files && camInput.files[0]);

    const chooseBtn = h('button', { class: 'pk-btn sec pk-mini', onclick: () => fileInput.click() }, 'Choose file');
    const camBtn = h('button', { class: 'pk-btn sec pk-mini', onclick: () => camInput.click() }, '📷 Take photo');
    const uploadBtn = h('button', { class: 'pk-btn pk-mini', onclick: doUpload }, state.resubmit ? 'Re-upload POD' : 'Upload POD');
    uploadBtn.disabled = true;

    function clearPreview() { if (url) { URL.revokeObjectURL(url); url = null; } preview.innerHTML = ''; }

    function pick(f) {
      errEl.textContent = ''; status.textContent = ''; clearPreview(); file = null; uploadBtn.disabled = true;
      if (!f) return;
      if (!POD_TYPES.includes(f.type)) { errEl.textContent = 'Unsupported file type. Allowed: PDF, JPG, PNG, WEBP.'; return; }
      if (f.size > POD_MAX_BYTES) { errEl.textContent = 'File is too large (' + fmtBytes(f.size) + '). Maximum is 10 MB.'; return; }
      if (f.size <= 0) { errEl.textContent = 'That file is empty.'; return; }
      file = f;
      const meta = h('div', { class: 's' }, f.name + ' · ' + fmtBytes(f.size));
      const remove = h('button', { class: 'pk-btn sec pk-mini', onclick: () => { file = null; uploadBtn.disabled = true; clearPreview(); } }, 'Remove');
      if (f.type.startsWith('image/')) {
        url = URL.createObjectURL(f);
        mount(preview, h('div', null, [h('img', { src: url, alt: 'POD preview', style: 'max-width:100%;max-height:220px;border-radius:8px;display:block' }), meta, remove]));
      } else {
        mount(preview, h('div', null, [h('div', { class: 'pk-podpdf' }, '📄 PDF ready to upload'), meta, remove]));
      }
      uploadBtn.disabled = false;
    }

    async function doUpload() {
      if (!file) return;
      errEl.textContent = '';
      uploadBtn.disabled = true; chooseBtn.disabled = true; camBtn.disabled = true;
      const bar = h('div', { class: 'pk-podbar' }, h('span'));
      status.textContent = 'Uploading…'; preview.appendChild(bar);
      try {
        // 1) put the raw bytes into the PRIVATE 'documents' bucket at {uid}/pod/{trip}/{name} (no public URL)
        const meta = await uploadPodDocument(file, t.id);
        // 2) finalize through the server-validated RPC (re-checks carrier, trip, state, MIME, size, path)
        await pocketUploadPod({ trip: t.id, path: meta.path, fileName: meta.fileName, contentType: meta.contentType, size: meta.size });
        clearPreview();
        mount(box, h('div', { class: 'pk-card', style: 'margin:0' }, [
          h('div', { class: 't', style: 'color:#16a34a' }, '✓ POD uploaded'),
          h('div', { class: 's' }, 'Dispatch will review it. You’ll see the status here.'),
          h('button', { class: 'pk-btn sec pk-mini', onclick: renderExisting }, 'Done'),
        ]));
      } catch (e) {
        // network / storage / validation failure — keep the selection so the driver can retry
        const msg = (e && (e.message || e.error)) || 'Upload failed.';
        errEl.textContent = /fetch|network|timeout/i.test(String(msg)) ? 'Network problem — check your connection and retry.' : String(msg);
        status.textContent = '';
        uploadBtn.disabled = false; chooseBtn.disabled = false; camBtn.disabled = false;
        uploadBtn.textContent = 'Retry upload';
      }
    }

    mount(wrapEl, [
      h('div', { class: 'pk-muted', style: 'padding:6px 0' }, 'Accepted: PDF, JPG, PNG, WEBP · Max 10 MB'),
      state.hasPending ? h('div', { class: 's', style: 'color:#b45309' }, 'A POD is already awaiting review — uploading again adds a new version.') : null,
      h('div', { class: 'pk-trip-actions' }, [chooseBtn, camBtn, fileInput, camInput]),
      preview, errEl, status,
      h('div', { class: 'pk-trip-actions' }, [uploadBtn]),
    ].filter(Boolean));
    return wrapEl;
  }
}

function fmtDate(v) { try { return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(v || ''); } }

async function boot() {
  root.setAttribute('aria-busy', 'true');
  let session = null;
  try { session = await getSession(); } catch (_) {}
  if (!session) { loginView(); return; }
  appView();
}

registerPocketSW();
boot();
