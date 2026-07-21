// app.js — LoadBoot Partner Portal. One responsive web app that serves the three
// non-carrier partner types — BROKER, SHIPPER and FACILITY — adapting to the kind of
// account the signed-in user holds. Like the carrier portal, every read/write is a
// self-scoping cc_partner_* RPC: the server resolves the partner org from the session,
// so a partner can only ever see and touch its own records. Admin/staff use the
// Command Center; carriers use the Carrier portal.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signUp, signOut, onAuthChange } from '../shared/session.js';
import { brandLogo } from '../shared/ui/components.js';
import { printExecutedW9 } from '../carrier/w9-form.js';
import { attachAddressSuggest } from '../shared/addr-suggest.js';
import { lookupCommodity, suggestCommodities } from './commodities.js';
import { renderFmcsaOnly } from '../carrier/profile-view.js';
import { renderMarketWidget } from '../shared/market-widget.js';
import {
  partnerRegister, partnerOverview,
  partnerPostLoad, partnerMyLoads, partnerSubmitLoad, rateStandards, brokerShipmentInbox, brokerQuoteShipment, shipperMyShipments, brokerClaimShipment, brokerTenderShipment, myOnboardingPacket, onboardingSubmitItem, currentAgreement, acceptAgreement,
  partnerRequestShipment, partnerMyShipments, partnerCarrierDirectory, partnerCarrierCapacity, partnerCarrierReviews, loadPickupStatus, partnerLoadCancellations, partnerUpdatePickup, setOrgLogo, partnerLoadFull, partnerTrackLoad, marketRpm, laneRate, partnerExtendOffer, partnerOfferWithdraw, partnerCarrierPacket, partnerEligibleDetail, requestPacketCopies, shipperPostLoad,
  partnerClaims, partnerReviewClaim, claimEscalate, partnerCancelLoad, partnerEligibleCarriers, partnerOfferSend,
  myRating, rateCounterparty, partnerRateableTrips,
  bookRequestCarrierPacket,
  partnerCreateAppointment, partnerAppointments, partnerSetAppointmentStatus,
  bookRequestsQueue, decideBookRequest, myApprovedPartners,
  partnerMyInvoices, partnerNotifications, partnerMarkNotificationRead, partnerMarkAllNotificationsRead,
  partnerGetProfile, partnerUpdateProfile,
  getPaymentInstructions, partnerSubmitInvoicePayment,
  loadChecklist, partnerChecklistSubmit, partnerUpdateRequests, partnerRespondUpdate,
  isFlagEnabled, myReferral, claimReferral,
} from '../shared/api.js';
import { registerAppSW } from '../shared/sw-register.js';
import { mountOfflineBanner } from '../shared/connectivity.js';
import { openPrintable } from '../shared/ui/printDoc.js';
import { mountAvatarEditor } from '../shared/ui/avatar.js';
import '../shared/ui/chatWidget.js';
import { uploadDocument, signedDocumentUrl } from '../shared/storage.js';
import { payInstructions, payMarkSent, payDueItems, payTripMarkSent, ccLoadStops, isMyOrgAgent } from '../shared/api.js';
(async () => { try { window.__lbAgentOrg = !!(await isMyOrgAgent()); } catch (_) { window.__lbAgentOrg = false; } })();


// PWA real-app behaviour: remember this portal so the installed app opens here next launch.
try { localStorage.setItem('lb_last_portal', '/app/partner/'); } catch (_) {}

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

// ---- payment rails (bl_pay_0065): HOW-TO-PAY panel + receipt upload + live status ----
function payRailBlock(kind9, ref9, memo9, label9) {
  const host9 = h('div');
  (async () => {
    let pi; try { pi = await payInstructions(kind9, ref9); } catch (_) { return; }
    const tr9 = pi && pi.transfer;
    if (tr9 && tr9.status === 'received') {
      mount(host9, h('div', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150;margin-top:8px' }, '\u2713 ' + (label9 || 'Payment') + ' \u2014 carrier confirmed received' + (tr9.received_at ? ' ' + new Date(tr9.received_at).toLocaleDateString() : ''))); return;
    }
    if (tr9 && tr9.status === 'sent') {
      mount(host9, h('div', { style: 'margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 12px;font-size:.85rem' },
        '\u{1F4B8} ' + (label9 || 'Payment') + ' sent \u2014 receipt uploaded. Expected to land by ' + (tr9.expected_by ? new Date(tr9.expected_by).toLocaleDateString() : '1\u20133 business days') + ' \u00b7 shows as PAID once the carrier taps \u201C\u2713 Received\u201D.' + (tr9.payment_ref ? ' \u00b7 ref: ' + tr9.payment_ref : ''))); return;
    }
    const bank = pi.payee_bank || {};
    const row9 = (k9, v9) => v9 ? h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #e2e8f0;font-size:.85rem' }, [h('span', { style: 'color:#64748b' }, k9), h('b', { style: 'user-select:all' }, String(v9))]) : null;
    const refIn = h('input', { class: 'cp-in', placeholder: 'Bank transfer reference / confirmation #', style: 'margin-top:8px' });
    const fIn = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.85rem;margin-top:6px' });
    const msg9 = h('div', { class: 'cp-sub', style: 'margin-top:4px' });
    const sendB = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: async (ev9) => { const b9 = ev9.currentTarget;
      const f9 = fIn.files && fIn.files[0]; if (!f9) { msg9.textContent = 'Attach the payment receipt/screenshot first \u2014 that is what the carrier sees.'; return; }
      b9.disabled = true; b9.textContent = 'Sending\u2026';
      try {
        const m9 = await uploadDocument(f9, 'payment_receipt');
        await payMarkSent({ kind: kind9, ref: ref9, receiptPath: m9.path, receiptName: m9.fileName, paymentRef: refIn.value.trim() || null, method: 'bank_transfer' });
        mount(host9, h('div', { class: 'cp-pill', style: 'background:#fef3c7;color:#b45309;margin-top:8px' }, '\u{1F4B8} Receipt sent \u2014 the carrier now sees this payment on the way.'));
      } catch (e9) { b9.disabled = false; b9.textContent = 'I have paid \u2014 submit receipt'; msg9.textContent = (e9 && e9.message) || 'Failed.'; }
    } }, 'I have paid \u2014 submit receipt');
    const panel = h('div', { style: 'display:none;margin-top:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;color:#10223B;text-align:left' }, [
      h('div', { style: 'font-weight:800;font-size:.9rem' }, 'How to pay \u2014 ' + (pi.label || label9 || '')),
      h('div', { style: 'font-size:1.3rem;font-weight:900;margin:4px 0' }, money(pi.amount || 0)),
      pi.noa_warning ? h('div', { style: 'background:#fee2e2;color:#b91c1c;border-radius:8px;padding:8px 10px;font-size:.83rem;font-weight:700;margin:6px 0' }, '\u26a0 ' + pi.noa_warning) : null,
      bank.instructions ? h('div', { class: 'cp-sub', style: 'white-space:pre-wrap' }, bank.instructions) : h('div', null, [
        bank.pay_to ? h('div', { style: 'background:#4c1d95;color:#fff;border-radius:9px;padding:8px 12px;font-weight:900;font-size:.85rem;margin:4px 0' }, '🏦 PAY THE FACTORING COMPANY — ' + (bank.factoring_company || '') + (bank.verified ? ' · NOA verified by LoadBoot ✓' : ' · NOA verification pending ⏳')) : null,
        bank.pay_to ? row9('Factoring company', bank.factoring_company) : null,
        row9('Payee', bank.account_title), row9('Bank', bank.bank_name), row9('Account #', bank.account_number),
        row9('Routing (ACH)', bank.routing_number), row9('Account type', bank.account_type), row9('SWIFT/BIC', bank.swift_bic),
        row9('Remittance email', bank.remittance_email), row9('Preferred method', bank.payment_method),
        bank.verified ? h('div', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150;margin-top:6px' }, '\u2713 Bank details verified by LoadBoot') : h('div', { class: 'cp-pill', style: 'background:#fef3c7;color:#b45309;margin-top:6px' }, '\u26a0 Details not yet verified \u2014 confirm with the carrier before a large transfer'),
      ].filter(Boolean)),
      h('div', { class: 'cp-sub', style: 'margin-top:8px' }, (pi.guidelines || '') + ' Use this memo reference: '),
      h('b', { style: 'user-select:all' }, memo9 || ''),
      refIn, fIn, sendB, msg9,
    ].filter(Boolean));
    panel.appendChild(h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:8px', onClick: () => { panel.style.display = 'none'; openB.style.display = ''; } }, '\u2715 Hide payment details'));
    const openB = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a;margin-top:8px', onClick: () => { openB.style.display = 'none'; panel.style.display = 'block'; } }, '\u{1F4B0} ' + (label9 || 'Pay') + ' \u2014 ' + money(pi.amount || 0));
    mount(host9, h('div', null, [openB, panel]));
  })();
  return host9;
}
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
const TAGLINE = 'The Operating System for Trucking';
const brandMark = (dark) => h('span', { class: 'cp-logo', html: '<img src="' + (dark ? '/logo-icon-dark.png' : '/icon-512.png') + '" width="34" height="34" alt="LoadBoot" style="display:block">' });

const KIND_LABEL = { broker: 'Broker', shipper: 'Shipper', facility: 'Facility' };

/* ---------- modal (was missing — brokerDocs crashed without it) ---------- */
function openModal(title, children, opts) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const card = h('div', { class: 'cp-modal-card', onClick: (e) => e.stopPropagation(), style: 'background:#fff;width:100%;max-width:' + ((opts && opts.wide) ? 'min(940px,94vw)' : '520px') + ';border-radius:18px 18px 0 0;max-height:92vh;overflow-y:auto' }, [
    h('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e2e8f0;position:sticky;top:0;background:#fff' }, [h('h3', { style: 'margin:0;font-size:1.02rem' }, title), h('button', { style: 'background:none;border:none;font-size:24px;color:#64748b;cursor:pointer', onClick: close }, '×')]),
    h('div', { style: 'padding:14px 18px 18px' }, Array.isArray(children) ? children : [children]),
  ]);
  const ov = h('div', { style: 'position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center', onClick: close }, card);
  if (window.matchMedia && window.matchMedia('(min-width: 700px)').matches) { ov.style.alignItems = 'center'; ov.style.padding = '24px'; card.style.borderRadius = '18px'; }
  document.body.appendChild(ov);
  document.addEventListener('keydown', onEsc);
  return close;
}

/* ---------- premium toast (replaces browser alert) ---------- */
function lbExpiredP(l) {
  if (!l || !l.pickup_date) return false;
  const d = new Date(String(l.pickup_date) + 'T23:59:59');
  if (isNaN(d.getTime()) || d.getTime() >= Date.now()) return false;
  return !/book|deliver|complete|invoiced/.test((String(l.status || '') + ' ' + String(l.board_status || '')).toLowerCase());
}
function openReschedule(l, after) {
  const st8 = { team: !!(l.details && l.details.team_required) };
  const pd = h('input', { class: 'cp-in', type: 'date' });
  const dd = h('input', { class: 'cp-in', type: 'date' });
  const mkT = () => h('input', { class: 'cp-in', type: 'time', style: 'max-width:130px' });
  const puA = mkT(), puF1 = mkT(), puF2 = mkT(), deA = mkT(), deF1 = mkT(), deF2 = mkT();
  const err = h('div', { style: 'color:#e11d48;font-size:.85rem;min-height:1em;margin-top:6px' });
  const lbl = (t) => h('label', { style: 'display:block;font-weight:700;font-size:.78rem;color:#334155;margin:10px 0 4px' }, t);
  const modeSt = { pu: 'FCFS', de: 'FCFS' };
  const modeRow = (key, hostT) => {
    const wrap = h('div', { style: 'display:flex;gap:8px;margin:4px 0 6px' });
    const mk9 = (v9, t9, s9) => h('button', { type: 'button', style: 'flex:1;padding:9px 10px;border-radius:11px;font-weight:800;font-size:.78rem;cursor:pointer;border:1.5px solid #e2e8f0;background:#fff;color:#334155', onClick: () => { modeSt[key] = v9; paint(); } }, [h('div', null, t9), h('div', { style: 'font-weight:600;font-size:.68rem;color:#64748b;margin-top:2px' }, s9)]);
    const b1 = mk9('FCFS', '\ud83d\ude9b FCFS', 'dock works trucks in arrival order inside a window');
    const b2 = mk9('Appointment', '\ud83d\udcc5 Appointment', 'fixed dock time');
    const paint = () => {
      [b1, b2].forEach((b9, i9) => {
        const on9 = (i9 === 0 ? 'FCFS' : 'Appointment') === modeSt[key];
        b9.style.borderColor = on9 ? '#0883F7' : '#e2e8f0';
        b9.style.background = on9 ? '#eff6ff' : '#fff';
        b9.style.color = on9 ? '#1d4ed8' : '#334155';
      });
      hostT.replaceChildren(...(modeSt[key] === 'FCFS'
        ? [lbl(key === 'pu' ? 'FCFS window \u2014 dock open from \u2192 to' : 'Delivery FCFS window \u2014 from \u2192 to'),
           h('div', { style: 'display:flex;gap:8px;align-items:center' }, [key === 'pu' ? puF1 : deF1, h('span', { style: 'font-weight:800;color:#64748b' }, '\u2192'), key === 'pu' ? puF2 : deF2])]
        : [lbl(key === 'pu' ? 'Pickup appointment time' : 'Delivery appointment time'), key === 'pu' ? puA : deA]));
    };
    wrap.append(b1, b2); paint();
    return wrap;
  };
  const puTHost = h('div'); const deTHost = h('div');
  const teamBtn = h('button', { type: 'button', class: 'cp-btn cp-btn-sm', style: 'width:100%;margin-top:10px' });
  const paintTeam = () => {
    teamBtn.textContent = st8.team ? '\ud83d\udc65 TEAM drivers: ON \u2014 nonstop driving \u00b7 tap for solo' : '\ud83d\udc65 Tight schedule? Require TEAM drivers (2 drivers, nonstop)';
    teamBtn.style.background = st8.team ? '#f59e0b' : ''; teamBtn.style.color = st8.team ? '#fff' : '';
  };
  paintTeam();
  teamBtn.onclick = () => { st8.team = !st8.team; paintTeam(); err.textContent = ''; };
  // pre-fill: pickup tomorrow, delivery auto-shift preview
  const iso9 = (d9) => d9.toISOString().slice(0, 10);
  pd.value = iso9(new Date(Date.now() + 86400000));
  const shift9 = () => {
    if (!pd.value || !l.pickup_date || !l.delivery_date) return;
    const delta9 = (new Date(pd.value) - new Date(String(l.pickup_date))) / 86400000;
    const nd9 = new Date(new Date(String(l.delivery_date)).getTime() + delta9 * 86400000);
    if (!dd.__touched) dd.value = iso9(nd9 < new Date(pd.value) ? new Date(pd.value) : nd9);
  };
  pd.onchange = shift9; dd.onchange = () => { dd.__touched = true; }; shift9();
  const save = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7;color:#fff' }, 'Update & re-activate');
  const close = openModal('\u23f0 Update schedule \u2014 ' + (l.origin || '') + ' \u2192 ' + (l.destination || ''), h('div', null, [
    h('div', { class: 'cp-sub' }, 'This load\u2019s pickup time has passed, so carriers can\u2019t book it. Set the new schedule to re-activate it on the board.'),
    lbl('New pickup date *'), pd,
    lbl('Pickup scheduling'), modeRow('pu', puTHost), puTHost,
    lbl('New delivery date (auto-shifted \u2014 adjust if needed)'), dd,
    lbl('Delivery scheduling'), modeRow('de', deTHost), deTHost,
    teamBtn, err,
    h('div', { style: 'text-align:right;margin-top:12px' }, save),
  ]));
  save.onclick = save.onClick = async () => {
    err.textContent = ''; err.replaceChildren();
    if (!pd.value) { err.textContent = 'Pick a new pickup date first.'; return; }
    const rngv = (a9, b9) => (a9.value && b9.value) ? (a9.value + '\u2013' + b9.value) : '';
    if (modeSt.pu === 'FCFS' && puF1.value && puF2.value && puF2.value <= puF1.value) { err.textContent = 'Pickup window: \u201cto\u201d must be after \u201cfrom\u201d.'; return; }
    if (modeSt.de === 'FCFS' && deF1.value && deF2.value && deF2.value <= deF1.value) { err.textContent = 'Delivery window: \u201cto\u201d must be after \u201cfrom\u201d.'; return; }
    const puT9 = modeSt.pu === 'Appointment' ? puA.value : puF1.value;
    const deT9 = modeSt.de === 'Appointment' ? deA.value : deF1.value;
    const puDt9 = new Date(pd.value + 'T' + (puT9 || '08:00'));
    if (puDt9.getTime() < Date.now() - 60000) { err.textContent = 'That pickup time frame has already PASSED \u2014 pick a future time.'; return; }
    if (dd.value) {
      const deDt9 = new Date(dd.value + 'T' + (deT9 || '23:59'));
      if (!(deDt9 > puDt9)) { err.textContent = 'Delivery must be AFTER the pickup time frame.'; return; }
      // HOS guard: same model as the post wizard (11h drive / 10h rest; TEAM = nonstop)
      const driveH9 = Number(l.miles || 0) / 52;
      if (driveH9 > 0.5) {
        const hosT9 = driveH9 + Math.floor(driveH9 / 11) * 10;
        const minDt9 = new Date(puDt9.getTime() + (st8.team ? driveH9 : hosT9) * 0.95 * 3600 * 1000);
        if (deDt9 < minDt9) {
          err.textContent = 'Not possible: ~' + Math.round(driveH9) + 'h of driving means earliest realistic delivery ' + minDt9.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (st8.team ? ' even with TEAM drivers \u2014 move the delivery later.' : ' under HOS rules (11h drive, 10h rest). Move the delivery later \u2014 or switch to TEAM:');
          if (!st8.team) err.appendChild(h('button', { type: 'button', class: 'cp-btn cp-btn-sm', style: 'display:block;margin-top:8px', onClick: () => { st8.team = true; paintTeam(); err.textContent = ''; } }, '\ud83d\udc65 Make this a TEAM load \u2014 2 drivers, nonstop'));
          return;
        }
      }
    }
    save.disabled = true; save.textContent = 'Updating\u2026';
    try {
      const pv9 = modeSt.pu === 'Appointment' ? (puA.value || null) : (rngv(puF1, puF2) || null);
      const dv9 = modeSt.de === 'Appointment' ? (deA.value || null) : (rngv(deF1, deF2) || null);
      const r = await partnerUpdatePickup(l.id, pd.value, pv9, dd.value || null, dv9, modeSt.pu, modeSt.de, st8.team);
      close();
      pToast(r && r.reactivated ? 'Schedule updated \u2014 the load is back on the board and bookable.' : 'Schedule updated.', { kind: 'ok', title: '\u23f0 Rescheduled' });
      if (after) after();
    } catch (e) { save.disabled = false; save.textContent = 'Update & re-activate'; err.textContent = (e && e.message) || 'Could not update.'; }
  };
}
function pToast(msg, opts) {
  opts = opts || {};
  const kind = opts.kind || 'ok'; // ok | error | info
  const C = {
    ok:    { bar: '#12a150', ic: '✓', bg: '#0b1220' },
    error: { bar: '#e11d48', ic: '⚠', bg: '#0b1220' },
    info:  { bar: '#0883F7', ic: 'ℹ', bg: '#0b1220' },
  }[kind] || { bar: '#0883F7', ic: 'ℹ', bg: '#0b1220' };
  let host = document.getElementById('lbToastHost');
  if (!host) {
    host = h('div', { id: 'lbToastHost', style: 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:100001;display:flex;flex-direction:column;gap:10px;align-items:center;pointer-events:none;max-width:94vw' });
    document.body.appendChild(host);
  }
  const t = h('div', { style: 'pointer-events:auto;min-width:280px;max-width:440px;background:' + C.bg + ';color:#fff;border-radius:14px;border:1px solid rgba(255,255,255,.08);border-left:4px solid ' + C.bar + ';box-shadow:0 18px 44px -12px rgba(2,12,30,.7);padding:13px 15px;display:flex;gap:11px;align-items:flex-start;font-family:inherit;opacity:0;transform:translateY(10px);transition:opacity .22s ease,transform .22s ease' }, [
    h('div', { style: 'width:24px;height:24px;flex:none;border-radius:50%;background:' + C.bar + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px' }, C.ic),
    h('div', { style: 'flex:1;font-size:.9rem;line-height:1.45;font-weight:600' }, [
      opts.title ? h('div', { style: 'font-weight:800;margin-bottom:2px' }, opts.title) : null,
      h('div', { style: opts.title ? 'font-weight:500;color:#cbd5e1' : '' }, msg),
    ].filter(Boolean)),
    h('button', { style: 'background:none;border:none;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;flex:none', onClick: () => remove() }, '×'),
  ]);
  host.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  let done = false;
  const remove = () => { if (done) return; done = true; t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; setTimeout(() => t.remove(), 240); };
  setTimeout(remove, opts.ms || (kind === 'error' ? 6000 : 4200));
  return remove;
}

/* ---------- premium cancel-load modal (replaces confirm()/prompt()) ---------- */
function openCancelLoadModal(l, committed, onDone) {
  const wrap = h('div');
  const assessBox = h('div');
  const err = h('div', { style: 'color:#e11d48;font-size:.85rem;margin-top:8px;min-height:1em' });
  const reason = h('textarea', { class: 'cp-in', rows: 3, placeholder: 'Reason (required — the carrier and dispatch see this)…', style: 'width:100%;box-sizing:border-box;resize:vertical;margin-top:6px' });
  const repostBtn = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7;color:#fff' }, committed ? 'Remove carrier & re-post' : 'Re-post to board');
  const deleteBtn = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#e11d48;color:#fff' }, 'Delete load');
  const keepBtn = h('button', { class: 'cp-btn cp-btn-sm ghost' }, 'Keep load');

  const body = h('div', null, [
    h('div', { style: 'font-weight:700;font-size:.95rem;color:#0f172a' }, (l.origin || '—') + ' → ' + (l.destination || '—')),
    assessBox,
    committed
      ? h('div', { style: 'margin-top:10px;padding:11px 12px;border-radius:11px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:.86rem;line-height:1.5' }, [
          h('b', null, '⚠ A truck is committed.'),
          h('div', { style: 'margin-top:3px' }, 'If the driver was ON TRACK to pickup, this becomes a TONU claim (carrier is paid, GPS evidence attached). If the driver NEVER MOVED toward pickup, NO TONU is owed — the system decides from the GPS.'),
        ])
      : null,
    h('div', { style: 'margin-top:10px;padding:11px 12px;border-radius:11px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;font-size:.86rem;line-height:1.5' }, [
      h('b', null, '↩ Re-post to board (recommended)'),
      h('div', { style: 'margin-top:2px' }, 'Removes ' + (committed ? 'this carrier' : 'the booking') + ' and puts the load back on the load board as available — you can then offer it to another specific carrier. Choose Delete only if the load is no longer needed.'),
    ]),
    h('label', { style: 'display:block;font-weight:700;font-size:.8rem;color:#334155;margin-top:12px' }, 'Reason'),
    reason, err,
    h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap' }, [keepBtn, deleteBtn, repostBtn]),
  ].filter(Boolean));
  mount(wrap, body);
  const close = openModal(committed ? '⚠ Cancel this load?' : 'Cancel this load?', wrap);
  keepBtn.onClick = close; keepBtn.onclick = close;

  // Tailor the message with the live GPS fault read (best-effort).
  if (committed) (async () => {
    let a; try { a = await loadPickupStatus(l.id); } catch (_) { return; }
    if (!a || (a.risk !== 'at_risk' && a.risk !== 'late')) return;
    const carrierFault = a.fault === 'carrier';
    mount(assessBox, h('div', { style: 'margin-top:8px;padding:10px 12px;border-radius:11px;background:' + (carrierFault ? '#fef2f2' : '#eff6ff') + ';border:1px solid ' + (carrierFault ? '#fecaca' : '#bfdbfe') + ';color:' + (carrierFault ? '#991b1b' : '#1e40af') + ';font-size:.85rem;line-height:1.5' }, [
      h('b', null, carrierFault ? '🔴 GPS: driver never moved toward pickup' : '🟢 GPS: driver was on track'),
      h('div', { style: 'margin-top:2px' }, (a.distance_mi ? 'Truck ~' + a.distance_mi + ' mi out (~' + a.eta_h + 'h). ' : '') + (carrierFault ? 'If you cancel now, NO TONU is owed — the carrier is at fault.' : 'If you cancel now, this is a TONU (the carrier is paid).')),
    ]));
  })();

  const submit = async (repost, btn, busyLabel, idleLabel) => {
    const why = reason.value.trim();
    if (!why) { err.textContent = 'Please enter a reason — the carrier and dispatch will see it.'; reason.focus(); return; }
    repostBtn.disabled = true; deleteBtn.disabled = true; keepBtn.disabled = true; btn.textContent = busyLabel;
    try {
      const r9 = await partnerCancelLoad(l.id, why, repost);
      close();
      pToast(r9 && r9.note ? r9.note : (repost ? 'Load re-posted to the board.' : 'Load deleted.'),
        { kind: 'ok', title: repost ? '↩ Back on the board' : 'Load deleted' });
      if (onDone) onDone();
    } catch (e9) {
      repostBtn.disabled = false; deleteBtn.disabled = false; keepBtn.disabled = false; btn.textContent = idleLabel;
      err.textContent = (e9 && e9.message) || 'Could not complete — please try again.';
    }
  };
  repostBtn.onclick = repostBtn.onClick = () => submit(true, repostBtn, 'Re-posting…', committed ? 'Remove carrier & re-post' : 'Re-post to board');
  deleteBtn.onclick = deleteBtn.onClick = () => submit(false, deleteBtn, 'Deleting…', 'Delete load');
}
async function openCancellationHistory(l) {
  const host = h('div', null, h('div', { class: 'cp-sub' }, 'Loading cancellation history…'));
  openModal('⟲ Cancellation history — ' + (l.origin || '') + ' → ' + (l.destination || ''), host);
  let rows; try { rows = await partnerLoadCancellations(l.id); } catch (e) { mount(host, h('div', { style: 'color:#e11d48' }, (e && e.message) || 'Could not load history.')); return; }
  if (!rows || !rows.length) { mount(host, h('div', { class: 'cp-sub' }, 'No cancellations on record for this load.')); return; }
  const fmt = (v) => { try { return new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return v; } };
  mount(host, h('div', null, rows.map(r => {
    const ev = r.evidence || {};
    const carrierFault = r.fault === 'carrier';
    return h('div', { style: 'padding:11px 0;border-bottom:1px solid #e2e8f0' }, [
      h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
        h('div', { style: 'font-weight:800;font-size:.9rem' }, r.carrier || 'Carrier'),
        h('span', { style: 'font-size:.78rem;color:#64748b' }, fmt(r.cancelled_at)),
      ]),
      h('div', { style: 'font-size:.84rem;color:#334155;margin-top:2px' }, 'Cancelled by ' + (r.cancelled_by || '—') + (r.reason ? ' — “' + r.reason + '”' : '')),
      h('div', { style: 'margin-top:4px;display:inline-block;padding:3px 9px;border-radius:999px;font-size:.74rem;font-weight:800;background:' + (carrierFault ? '#fef2f2;color:#b91c1c' : (r.fault === 'broker' ? '#eff6ff;color:#1e40af' : '#f1f5f9;color:#475569')) }, carrierFault ? 'Carrier at fault — no TONU owed' : (r.fault && r.fault !== 'none' ? 'Fault: ' + r.fault : 'No fault recorded')),
      (ev && (ev.distance_mi != null || ev.eta_h != null)) ? h('div', { style: 'font-size:.78rem;color:#64748b;margin-top:4px' }, 'GPS evidence: ~' + (ev.distance_mi != null ? ev.distance_mi + ' mi out' : '') + (ev.eta_h != null ? ', ~' + ev.eta_h + 'h ETA' : '') + (ev.moving === false ? ', not moving' : '')) : null,
    ].filter(Boolean));
  })));
}


/* ---------- smart packet submit (same pattern as the carrier portal) ---------- */
const PACKET_RULES = {
  mc_authority: 'Your FMCSA broker authority — the legal licence to broker freight.',
  bmc84_bond: 'The $75,000 surety bond/trust that protects carriers if a broker fails to pay.',
  w9: 'IRS taxpayer form — needed before any settlement money moves.',
  coi: 'Insurance certificate (GL / E&O / contingent cargo).',
  broker_agreement: 'Your signed master agreement with LoadBoot.',
  bank_instructions: 'Verified bank details for invoicing and payments.',
  claims_procedure: 'Who handles cargo claims on your side and how.',
  references: 'Optional trade references — speeds up carrier trust.',
};
const PACKET_CONSEQ = (tag) => tag === 'optional'
  ? 'Updating sends it back for review. Optional — posting is NOT affected.'
  : 'Updating or a rejection sends it back to review, your packet turns INCOMPLETE, the account goes PENDING and load posting stops until LoadBoot verifies it again.';
const PACKET_FMT = {
  w9: ['pdf'], coi: ['pdf'], bmc84_bond: ['pdf'], broker_agreement: ['pdf'],
  signed_agreement: ['pdf'], credit_application: ['pdf'],
};
const packetExts = (key) => PACKET_FMT[key] || ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
const PACKET_SPEC = {
  // broker
  mc_authority:     { fields: [['Broker MC number', 'MC-000000']], file: 'required', fileHint: 'Broker authority letter (PDF or photo)' },
  bmc84_bond:       { file: 'required', fileHint: 'BMC-84 bond / BMC-85 trust certificate (PDF or photo)' },
  broker_agreement: { file: 'required', fileHint: 'Signed Broker Agreement (PDF or photo)' },
  bank_instructions:{ fields: [['Bank name', ''], ['Account holder (legal name)', ''], ['Account number', 'digits only'], ['Routing / ABA (9 digits)', ''], ['Account type', 'Checking / Savings'], ['Bank address', 'street, city, state'], ['Bank phone', ''], ['Remittance / billing email', '']], file: 'required', fileHint: 'Voided check / bank letter (PDF or photo)' },
  claims_procedure: { fields: [['Claims contact name', 'who owns cargo claims on your side'], ['Claims phone', ''], ['Claims email', ''], ['Process — how a claim is handled', 'acknowledge → investigate → settle, with timelines']], file: 'optional', fileHint: 'Claims procedure doc (optional)' },
  references:       { fields: [['Reference 1 (company · contact · phone)', ''], ['Reference 2 (optional)', '']] },
  coi:              { file: 'required', fileHint: 'Certificate of insurance (PDF or photo)' },
  w9:               { file: 'required', fileHint: 'Signed W-9 (PDF or photo)' },
  // shipper
  credit_application:{ file: 'required', fileHint: 'Completed credit application (PDF or photo)' },
  signed_agreement:  { file: 'required', fileHint: 'Signed Shipper Agreement (PDF or photo)' },
  payment_terms:     { fields: [['Payment terms', 'Net 15 / Net 30 / Net 45']] },
  billing_instructions:{ fields: [['Billing submission instructions', 'Portal / email / EDI details']], file: 'optional', fileHint: 'Billing guide (optional)' },
  cargo_profile:     { fields: [['Commodities', ''], ['Typical value ($)', ''], ['Equipment needed', 'Van / Reefer / Flatbed']] },
  claims_contact:    { fields: [['Claims contact name', ''], ['Claims phone / email', '']] },
  facility_rules:    { fields: [['Facility rules / appointment process', '']], file: 'optional', fileHint: 'Facility rules doc (optional)' },
  insurance_requirements:{ fields: [['Required cargo insurance ($)', 'e.g. 100,000']] },
  special_commodity: { fields: [['Declarations', 'Hazmat / food-grade / high-value details']], file: 'optional', fileHint: 'Supporting docs (optional)' },
};
function openPacketSubmit(it, onDone) {
  if (it.status === 'verified' && !confirm('This item is already verified. Changing it sends it back for review. Continue?')) return;
  const spec = PACKET_SPEC[it.key] || { file: 'optional', fields: [['Reference / note', 'Reference or short note']], fileHint: 'Document (PDF or photo) — optional' };
  const fieldEls = (spec.fields || []).map(([lbl, ph]) => [lbl, h('input', { class: 'cp-in', placeholder: ph || lbl })]);
  let file = null;
  const fMeta = h('div', { class: 'cp-sub' });
  const _exts = packetExts(it.key);
  const fIn = h('input', { type: 'file', accept: _exts.map((e) => '.' + e).join(','), style: 'display:none' });
  fIn.onchange = () => {
    file = fIn.files && fIn.files[0];
    if (file) { const ex = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
      if (_exts.indexOf(ex) < 0) { alert('This document must be ' + (_exts.length === 1 ? _exts[0].toUpperCase() + ' only — the official document, not a screenshot.' : _exts.map((e) => e.toUpperCase()).join('/') + '.')); file = null; fIn.value = ''; fMeta.textContent = ''; return; } }
    fMeta.textContent = file ? ('✓ ' + file.name) : '';
  };
  const pick = h('button', { class: 'cp-btn ghost cp-btn-sm', onClick: () => fIn.click() }, '📎 Choose ' + (_exts.length === 1 ? 'PDF (only)' : 'PDF / photo'));
  const fmtLine = h('div', { class: 'cp-sub', style: 'font-weight:700;color:#b45309' }, '📌 Required format: ' + (_exts.length === 1 ? 'PDF only — the official document (screenshots are rejected)' : 'PDF or clear photo'));
  const err = h('div', { class: 'cp-err' });
  const kids = [];
  kids.push(h('div', { class: 'cp-sub', style: 'background:#f8fafc;border-radius:10px;padding:9px 11px' }, [
    h('b', null, PACKET_RULES[it.key] || it.label), h('br'), PACKET_CONSEQ(String(it.tag || '').toLowerCase()),
  ]));
  fieldEls.forEach(([lbl, inp]) => { kids.push(h('div', { class: 'cp-sub', style: 'font-weight:700;margin-top:8px' }, lbl)); kids.push(inp); });
  if (spec.file) { kids.push(h('div', { class: 'cp-sub', style: 'font-weight:700;margin-top:10px' }, spec.fileHint || 'Document (PDF or photo)')); kids.push(h('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:4px' }, [pick, fIn])); kids.push(fMeta); }
  if (spec.file) kids.push(fmtLine);
  const close = openModal('Submit — ' + it.label, [...kids, err,
    h('button', { class: 'cp-btn', style: 'margin-top:12px;width:100%', onClick: async (ev) => {
      const vals = fieldEls.map(([lbl, inp]) => inp.value.trim() ? (lbl + ': ' + inp.value.trim()) : null).filter(Boolean);
      if (spec.file === 'required' && !file) { err.textContent = 'Please attach the document (PDF or a clear photo).'; return; }
      if (!vals.length && !file) { err.textContent = 'Fill the field(s) or attach the document.'; return; }
      ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Submitting…';
      try {
        let ref = vals.join(' · ');
        if (file) { const m = await uploadDocument(file, 'onboarding-' + it.key); ref = (ref ? ref + ' · ' : '') + 'file:' + m.path; }
        await onboardingSubmitItem(it.key, ref, null); close(); if (onDone) onDone();
      } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Submit'; err.textContent = (e && e.message) || 'Failed'; }
    } }, 'Submit')]);
}
const packetBtnLabel = (st) => st === 'rejected' ? 'Resubmit' : st === 'submitted' ? 'Change' : st === 'verified' ? 'Update' : 'Submit';

/* ---------- auth ---------- */
function authScreen() {
  let signup = false;
  const email = h('input', { class: 'cp-in', type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const pass = h('input', { class: 'cp-in', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const name = h('input', { class: 'cp-in', type: 'text', placeholder: 'Your full name', autocomplete: 'name' });
  const extra = h('div', { style: 'display:none' }, [h('label', { class: 'cp-lbl' }, 'Your name'), name]);
  // Partner type — chosen right on the create-account screen (broker / shipper / facility)
  let chosenKind = null;
  const typeCards = {};
  const typeOpt = (kind9, t9, d9) => {
    const c9 = h('button', { type: 'button', class: 'cp-typecard', onClick: () => {
      chosenKind = kind9;
      Object.values(typeCards).forEach(x9 => x9.classList.remove('sel'));
      c9.classList.add('sel');
    } }, [h('div', { class: 'cp-typecard-t' }, t9), h('div', { class: 'cp-typecard-d' }, d9)]);
    typeCards[kind9] = c9; return c9;
  };
  const typeBlock = h('div', { style: 'display:none' }, [
    h('label', { class: 'cp-lbl' }, 'What kind of partner are you?'),
    h('div', { class: 'cp-typegrid' }, [
      typeOpt('broker', 'Freight Broker', 'Post loads to our carrier network and track them.'),
      typeOpt('shipper', 'Shipper', 'Request freight, get it moved, and track shipments.'),
      typeOpt('facility', 'Facility / Warehouse', 'Schedule dock appointments and manage check-ins.'),
    ]),
  ]);
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
    typeBlock.style.display = s ? 'block' : 'none';
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
    if (signup && !chosenKind) { err.textContent = 'Pick whether you are a broker, shipper or facility.'; return; }
    btn.disabled = true; btn.textContent = signup ? 'Creating…' : 'Signing in…';
    try {
      if (signup) {
        const { data, error } = await signUp(em, pw, { name: name.value.trim(), partner_kind: chosenKind });
        if (error) throw error;
        if (!data || !data.session) { setMode(false); err.className = 'cp-err ok'; err.textContent = '✓ Account created! We emailed a confirmation link to ' + em + '. Click it (check spam too), then sign in here.'; btn.disabled = false; return; }
        boot(); return;
      }
      const { error } = await signInWithPassword(em, pw); if (error) throw error; boot(); return;
    } catch (e) { err.textContent = (e && e.message) || 'Something went wrong.'; btn.disabled = false; btn.textContent = signup ? 'Create account' : 'Sign in'; }
  };
  // Premium split auth — same owner-approved design family as the carrier login, broker story on the left.
  const brandPanel = h('div', { class: 'cpx-auth-brand', html:
    '<style>@keyframes lbOfferDash{to{stroke-dashoffset:-40}}@keyframes lbNodePop{0%,70%{transform:scale(1)}80%{transform:scale(1.25)}100%{transform:scale(1)}}@keyframes lbWinGlow{0%,60%{opacity:.25}75%,100%{opacity:1}}</style>'
    + '<svg viewBox="0 0 320 150" style="width:100%;max-width:320px;overflow:visible" aria-hidden="true">'
    // the load — posted once
    + '<rect x="6" y="56" rx="12" width="86" height="40" fill="rgba(8,131,247,.14)" stroke="#0883F7" stroke-width="1.6"/>'
    + '<text x="49" y="73" font-size="11" font-weight="800" fill="#fff" text-anchor="middle" font-family="Manrope,sans-serif">YOUR LOAD</text>'
    + '<text x="49" y="87" font-size="9.5" font-weight="600" fill="#94a3b8" text-anchor="middle" font-family="Manrope,sans-serif">posted once</text>'
    // fan-out to three carriers (15-min race)
    + '<path d="M92 62 C 150 30, 190 26, 236 34" fill="none" stroke="rgba(148,163,184,.5)" stroke-width="2" stroke-dasharray="5 7" stroke-linecap="round" style="animation:lbOfferDash 1.4s linear infinite"/>'
    + '<path d="M92 76 C 150 76, 190 76, 236 76" fill="none" stroke="#16a34a" stroke-width="2.6" stroke-dasharray="5 7" stroke-linecap="round" style="animation:lbOfferDash 1.1s linear infinite"/>'
    + '<path d="M92 90 C 150 122, 190 126, 236 118" fill="none" stroke="rgba(148,163,184,.5)" stroke-width="2" stroke-dasharray="5 7" stroke-linecap="round" style="animation:lbOfferDash 1.4s linear infinite"/>'
    // carrier nodes
    + '<g style="transform-origin:262px 34px"><circle cx="262" cy="34" r="15" fill="rgba(148,163,184,.14)" stroke="rgba(148,163,184,.6)" stroke-width="1.6"/><text x="262" y="39" font-size="13" text-anchor="middle">🚛</text></g>'
    + '<g style="transform-origin:262px 76px;animation:lbNodePop 2.6s ease-in-out infinite"><circle cx="262" cy="76" r="17" fill="rgba(22,163,74,.18)" stroke="#16a34a" stroke-width="2.2"/><text x="262" y="81" font-size="14" text-anchor="middle">🚛</text>'
    + '<g style="animation:lbWinGlow 2.6s ease-in-out infinite"><circle cx="278" cy="62" r="9" fill="#16a34a"/><text x="278" y="66" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">✓</text></g></g>'
    + '<g style="transform-origin:262px 118px"><circle cx="262" cy="118" r="15" fill="rgba(148,163,184,.14)" stroke="rgba(148,163,184,.6)" stroke-width="1.6"/><text x="262" y="123" font-size="13" text-anchor="middle">🚛</text></g>'
    + '<text x="160" y="146" font-size="10.5" font-weight="700" fill="#64748B" text-anchor="middle" font-family="Manrope,sans-serif">3 verified carriers · 15-min window · first accept wins</text>'
    + '</svg>'
    + '<div style="margin-top:20px;font-size:25px;font-weight:800;color:#fff;line-height:1.22;letter-spacing:-.02em">Post once.<br>Covered in minutes — with proof.</div>'
    + '<div class="cpx-mockstack">'
    +   '<div class="cpx-mockcard">'
    +     '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:19px">Dallas → Atlanta</b><span class="cpx-mockchip green">3 offers out</span></div>'
    +     '<div class="cpx-mockroute"><span class="d o"></span>Offered to 3 verified carriers · 15-min window</div>'
    +     '<div class="cpx-mockroute"><span class="d g"></span>Also live on the load board</div>'
    +   '</div>'
    +   '<div class="cpx-mocktoast">✓ Booked — TRUCKING ENTERPRISE · other offers auto-closed</div>'
    +   '<div class="cpx-mocktoast ok">📍 GPS tracking on — arrive/depart recorded as proof</div>'
    + '</div>'
    + '<div class="cpx-auth-points">'
    +   '<span>✓ Verified, health-scored carriers only</span>'
    +   '<span>✓ First accept wins — zero double-booking</span>'
    +   '<span>✓ Claims settled on GPS evidence, not arguments</span>'
    + '</div>' });
  mount(root, h('div', { class: 'cp-auth' }, [
    h('div', { class: 'cpx-auth-split' }, [brandPanel,
    h('div', { class: 'cp-auth-card' }, [
      h('div', { class: 'cp-auth-brand', style: 'display:flex;align-items:flex-start;gap:4px;margin-bottom:18px' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#94A3B8;line-height:1;margin-top:5px" }, 'Partner')]),
      title, sub, h('label', { class: 'cp-lbl' }, 'Email'), email, h('label', { class: 'cp-lbl' }, 'Password'), pass, extra, typeBlock, err, btn, toggle,
      h('div', { class: 'cp-staff' }, [
        h('a', { href: '/app/carrier/' }, 'Are you a carrier? →'),
        h('a', { href: '/app/command-center/' }, 'Staff? Command Center →'),
      ]),
    ])]),
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
      h('div', { class: 'cp-auth-brand', style: 'display:flex;align-items:flex-start;gap:4px;margin-bottom:18px' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#94A3B8;line-height:1;margin-top:7px" }, 'Partner')]),
      h('h1', null, 'Welcome to LoadBoot'),
      h('p', { class: 'cp-auth-sub' }, 'What kind of partner are you? You can set up more later.'),
      h('div', { class: 'cp-typegrid' }, [
        opt('broker', 'Freight Broker', 'Post loads to our carrier network and track them.'),
        opt('shipper', 'Shipper', 'Request freight, get it moved, and track shipments.'),
        opt('facility', 'Facility / Warehouse', 'Schedule dock appointments and manage check-ins.'),
      ]),
      (function preselectFromSignup9() {
        try {
          var k9 = user && user.user_metadata && user.user_metadata.partner_kind;
          if (k9 && cards[k9]) { chosen = k9; cards[k9].classList.add('sel'); }
        } catch (_) {}
      })(),
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
    mount(panel, [h('div', { class: 'cp-notif-head', style: 'display:flex;align-items:center;gap:8px' }, [
      h('span', { html: '<svg width="18" height="19" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#10223B"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#F97316"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#10223B"/></svg>', style: 'line-height:0' }),
      h('span', null, 'Notifications'),
      ns.some(n9 => !n9.read_at) ? h('button', { style: 'margin-left:auto;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:4px 12px;font-size:.72rem;font-weight:800;cursor:pointer', onClick: async (e9) => {
        e9.stopPropagation(); e9.currentTarget.disabled = true;
        try { await partnerMarkAllNotificationsRead(); } catch (_) {}
        refresh(); load();
      } }, '\u2713 Mark all read') : null,
    ])].concat(ns.map(n => h('div', {
      class: 'cp-notif' + (n.read_at ? '' : ' unread'),
      onClick: async () => {
        if (!n.read_at) { try { await partnerMarkNotificationRead(n.id); } catch (_) {} }
        refresh();
        const t9 = (n.url || '').split('#')[1] || '';
        if (t9) { panel.hidden = true; location.hash = '#' + t9; } else { load(); }
      },
    }, [
      h('div', { style: 'display:flex;gap:10px;align-items:flex-start' }, [
        h('span', { html: '<svg width="20" height="21" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#10223B"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#F97316"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#10223B"/></svg>', style: 'flex:none;width:32px;height:32px;border-radius:9px;background:#f1f5f9;display:inline-flex;align-items:center;justify-content:center;line-height:0;margin-top:2px' }),
        h('div', { style: 'min-width:0;flex:1' }, [
          h('div', { class: 'cp-notif-t' }, n.title),
          n.body ? h('div', { class: 'cp-notif-b' }, n.body) : null,
          h('div', { class: 'cp-notif-time' }, fmtDT(n.created_at)),
        ]),
        n.read_at ? null : h('button', { title: 'Mark read', style: 'flex:none;border:1px solid #e2e8f0;background:#fff;color:#64748b;border-radius:8px;padding:3px 9px;font-size:.68rem;font-weight:800;cursor:pointer;margin-top:2px', onClick: async (e9) => {
          e9.stopPropagation(); e9.currentTarget.disabled = true;
          try { await partnerMarkNotificationRead(n.id); } catch (_) {}
          n.read_at = new Date().toISOString(); refresh(); load();
        } }, 'Mark read'),
      ]),
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
    bTabbar,
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        h('div', { class: 'cp-brandrow', style: 'gap:10px' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:29px;width:auto;display:block' }), h('div', null, [
          h('span', { class: 'cp-brand-sub', style: 'color:#94A3B8;font-weight:500;letter-spacing:0;text-transform:none' }, label),
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
let bgoHook = null;      // set by brokerDash so module-level pages (Carriers) can navigate
let directCarrier = null; // 'post to this carrier' target, consumed by the wizard
let __dirCache = null;
async function dirCarrierInfo(id9) {
  try { if (!__dirCache) __dirCache = (await partnerCarrierDirectory()) || []; } catch (_) { __dirCache = []; }
  return __dirCache.find(x => x.id === id9) || null;
}
async function dirCarrierEq(id9) {
  try { if (!__dirCache) __dirCache = (await partnerCarrierDirectory()) || []; } catch (_) { __dirCache = []; }
  const c9 = __dirCache.find(x => x.id === id9); if (!c9) return null;
  const a9 = ((c9.fleet_mix || []).map(m => m.type)).concat(c9.preferred_equipment || []).filter(e => e && /[a-zA-Z]{2,}/.test(e));
  return a9.filter((x, i9) => a9.indexOf(x) === i9);
}
const kpiCard = (label, value, sub, accent) => h('div', { class: 'cp-kpi ' + (accent || '') }, [
  h('div', { class: 'cp-kpi-v' }, String(value)), h('div', { class: 'cp-kpi-l' }, label), sub ? h('div', { class: 'cp-kpi-s' }, sub) : null,
]);
const field = (label, input) => h('label', { class: 'cp-field2' }, [h('span', null, label), input]);
const inp = (ph, type) => h('input', { class: 'cp-in', type: type || 'text', placeholder: ph || '' });

/* invoices — shown on every partner dashboard (read-only; staff issue + mark paid) */
// 🚛 CARRIER INVOICES — what the broker actually owes per trip, routing-aware:
// factored carrier → "REMIT TO <factor> per NOA"; direct → carrier's own bank. Premium printable.
function carrierInvoicesCard() {
  const host9 = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '🚛 Carrier invoices — per trip')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
  (async () => {
    let d9; try { d9 = await payDueItems(); } catch (e9) { mount(host9, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '🚛 Carrier invoices — per trip')]), h('div', { class: 'cp-sub' }, (e9 && e9.message) || 'Could not load.')]); return; }
    const items9 = ((d9 && d9.payables) || []).filter((x9) => x9.kind !== 'platform_fee');
    const groups9 = {};
    items9.forEach((x9) => { const k9 = x9.trip_id || x9.ref_id; (groups9[k9] = groups9[k9] || { lane: x9.lane, carrier: x9.counterparty, items: [] }).items.push(x9); });
    const gs9 = Object.values(groups9);
    if (!gs9.length) { mount(host9, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '🚛 Carrier invoices — per trip')]), h('div', { class: 'cp-sub' }, 'No carrier invoices yet — they appear automatically the moment a load delivers or a claim is approved.')]); return; }
    const pdf9 = async (g9) => {
      const it9 = g9.items.find((z9) => z9.kind === 'freight') || g9.items[0];
      let pi9 = null; try { pi9 = await payInstructions(it9.kind, it9.ref_id); } catch (_) {}
      const bk9 = (pi9 && pi9.payee_bank) || {};
      const factored9 = !!bk9.pay_to;
      const m9 = (v9) => '$' + Number(v9 || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
      const tot9 = g9.items.reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
      const payBy9 = g9.items.map((x9) => x9.pay_by).filter(Boolean).sort()[0];
      const rowsHtml9 = g9.items.map((x9) => '<tr><td>' + (x9.label || x9.kind) + '<br><span style="font-size:11px;color:#64748b">memo ' + (x9.memo || '') + (x9.transfer_status ? ' · ' + x9.transfer_status : ' · DUE') + '</span></td><td style="text-align:right"><b>' + m9(x9.amount) + '</b></td></tr>').join('');
      const html9 = '<!doctype html><html><head><meta charset="utf-8"><title>Invoice — ' + (g9.carrier || '') + '</title><style>'
        + 'body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#10223B;max-width:820px;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
        + '.hd{background:linear-gradient(120deg,#10223B,#0d2f56);color:#fff;padding:30px 40px;display:flex;justify-content:space-between;border-radius:0 0 0 0}'
        + 'table{width:calc(100% - 80px);margin:18px 40px;border-collapse:collapse}th{background:#10223B;color:#fff;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;text-align:left}th:last-child{text-align:right}td{padding:12px 14px;border-bottom:1px solid #eef2f7;font-size:13.5px}'
        + '.remit{margin:0 40px 18px;border-radius:14px;padding:16px 20px;' + (factored9 ? 'background:#f5f3ff;border:2px solid #7c3aed' : 'background:#f8fafc;border:1.5px solid #e6ebf3') + '}'
        + '.noprint{position:fixed;top:14px;right:14px;background:#0883F7;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer}@media print{.noprint{display:none}}'
        + '</style></head><body>'
        + '<button class="noprint" onclick="print()">🖨 Print / Save PDF</button>'
        + '<div class="hd"><div><div style="font-size:24px;font-weight:900">INVOICE</div><div style="color:#9fb0cc;font-size:12px;margin-top:4px">From ' + (g9.carrier || 'Carrier') + ' · served via LoadBoot</div></div>'
        + '<div style="text-align:right"><div style="font-size:12px;color:#9fb0cc">TOTAL DUE</div><div style="font-size:26px;font-weight:900">' + m9(tot9) + '</div>' + (payBy9 ? '<div style="font-size:12px;color:#9fb0cc">pay by ' + new Date(payBy9).toLocaleDateString() + '</div>' : '') + '</div></div>'
        + '<div style="padding:18px 40px 0;color:#475569;font-size:13px"><b>Bill to:</b> your brokerage · <b>Lane:</b> ' + (g9.lane || '') + '</div>'
        + '<table><tr><th>Item</th><th>Amount</th></tr>' + rowsHtml9 + '<tr><td style="font-weight:900">TOTAL</td><td style="text-align:right;font-weight:900;font-size:16px">' + m9(tot9) + '</td></tr></table>'
        + '<div class="remit">'
        + (factored9
            ? '<div style="font-weight:900;color:#5b21b6;font-size:14px;margin-bottom:6px">🏦 REMIT TO — ' + (bk9.factoring_company || 'Factoring company') + ' (Notice of Assignment)</div>'
              + '<div style="font-size:12.5px;line-height:2">Payee: <b>' + (bk9.account_title || '') + '</b> · Bank: <b>' + (bk9.bank_name || '') + '</b>' + (bk9.account_number ? ' · Acct: <b>' + bk9.account_number + '</b>' : '') + (bk9.routing_number ? ' · Routing: <b>' + bk9.routing_number + '</b>' : '') + (bk9.remittance_email ? ' · ' + bk9.remittance_email : '') + '</div>'
              + '<div style="color:#b91c1c;font-size:12px;margin-top:6px;font-weight:700">Under UCC §9-406, pay the factoring company — paying the carrier directly can leave you liable to pay twice.' + (bk9.verified ? ' NOA verified by LoadBoot ✓' : ' NOA verification pending — confirm with the factor before a large transfer.') + '</div>'
            : '<div style="font-weight:900;font-size:14px;margin-bottom:6px">🏛 REMIT TO — ' + (g9.carrier || 'Carrier') + ' (direct)</div>'
              + '<div style="font-size:12.5px;line-height:2">Payee: <b>' + (bk9.account_title || '') + '</b> · Bank: <b>' + (bk9.bank_name || '') + '</b>' + (bk9.account_number ? ' · Acct: <b>' + bk9.account_number + '</b>' : '') + (bk9.routing_number ? ' · Routing: <b>' + bk9.routing_number + '</b>' : '') + '</div>'
              + '<div style="color:#64748b;font-size:12px;margin-top:6px">' + (bk9.verified ? 'Bank details verified by LoadBoot ✓' : 'Details not yet verified — confirm with the carrier before a large transfer.') + '</div>')
        + '</div>'
        + '<div style="margin:0 40px;color:#64748b;font-size:11px;line-height:1.8;border-top:2px solid #eef2f7;padding-top:12px">Put each memo in the transfer note. Pay from your Dashboard → Payables (per item or one trip-total transfer) and attach the receipt — the payee confirms and everything turns green. Served via LoadBoot · loadboot.com</div>'
        + '</body></html>';
      const w9 = window.open('', '_blank'); if (w9) { w9.document.write(html9); w9.document.close(); }
    };
    mount(host9, [
      h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '🚛 Carrier invoices — per trip')]),
      h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'One invoice per trip — freight + its approved claims. The REMIT-TO switches automatically: factored carrier → their factoring company (NOA), direct carrier → their own bank. Pay from Dashboard → Payables.'),
      ...gs9.map((g9) => {
        const tot9 = g9.items.reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
        const open9 = g9.items.filter((x9) => x9.transfer_status !== 'received');
        const payBy9 = g9.items.map((x9) => x9.pay_by).filter(Boolean).sort()[0];
        return h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid #eef2f7' }, [
          h('div', null, [
            h('div', { class: 'cp-row-t' }, '🚛 ' + (g9.lane || '') + ' · ' + money(tot9)),
            h('div', { class: 'cp-row-s' }, (g9.carrier || '') + ' · ' + g9.items.length + ' item' + (g9.items.length > 1 ? 's' : '') + (payBy9 ? ' · pay by ' + new Date(payBy9).toLocaleDateString() : '')),
          ]),
          h('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            open9.length ? h('span', { class: 'cp-pill', style: 'background:#fee2e2;color:#b91c1c' }, open9.length + ' unsettled') : h('span', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150' }, '✓ settled'),
            h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7', onClick: () => pdf9(g9) }, '⬇ Invoice PDF'),
          ]),
        ]);
      }),
    ]);
  })();
  return host9;
}
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
      const invModal = (title, children) => {
        const scrim = h('div', { style: 'position:fixed;inset:0;background:rgba(2,6,23,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px' });
        const panel = h('div', { class: 'cp-card', style: 'position:relative;max-width:520px;width:92%;max-height:88vh;overflow:auto' }, [h('button', { style: 'position:absolute;top:10px;right:12px;border:none;background:none;font-size:1.1rem;cursor:pointer', onClick: () => scrim.remove() }, '\u2715'), h('h3', { style: 'margin:0 0 10px' }, title), ...children]);
        scrim.appendChild(panel); scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
        document.body.appendChild(scrim); return () => scrim.remove();
      };
      const invPdf = (i) => openPrintable('Invoice ' + i.number, 'INVOICE', [
        { rows: [['Invoice #', i.number], ['Amount', money(i.amount)], ['Description', i.description || '\u2014'], ['Due', fmtDate(i.due_date)], ['Status', String(i.status || '').replace(/_/g, ' ')], i.expected_pay_date ? ['Expected pay date', fmtDate(i.expected_pay_date)] : null, i.payment_ref ? ['Payment reference', i.payment_ref] : null].filter(Boolean) },
        { note: instructions || 'Thank you for your business \u2014 LoadBoot.' },
      ]);
      const rowline = (k, v) => h('div', { class: 'cp-row' }, [h('span', { class: 'cp-sub' }, k), h('span', null, v)]);
      const preview = (i) => invModal('Invoice ' + i.number, [
        h('div', { style: 'font-size:1.6rem;font-weight:800' }, money(i.amount)),
        rowline('Description', i.description || '\u2014'), rowline('Due', fmtDate(i.due_date)), rowline('Status', String(i.status || '').replace(/_/g, ' ')),
        i.expected_pay_date ? rowline('Expected pay date', fmtDate(i.expected_pay_date)) : null,
        i.payment_ref ? rowline('Payment ref', i.payment_ref) : null,
        instructions ? h('div', { class: 'cp-payinfo', style: 'margin-top:8px' }, [h('div', { class: 'cp-payinfo-h' }, 'How to pay'), h('div', { class: 'cp-payinfo-b' }, instructions)]) : null,
        h('button', { class: 'cp-btn', style: 'margin-top:12px', onClick: () => invPdf(i) }, '\u2b07 Download PDF'),
      ].filter(Boolean));
      const payModal = (i) => {
        const dt = h('input', { class: 'cp-in', type: 'date' });
        const ref = h('input', { class: 'cp-in', placeholder: 'Payment reference / transaction # (optional)' });
        const file = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp' });
        const note = h('input', { class: 'cp-in', placeholder: 'Note (optional)' });
        const err = h('div', { class: 'cp-err' });
        let close;
        const submit = h('button', { class: 'cp-btn', style: 'margin-top:8px', onClick: async (ev) => {
          err.textContent = ''; ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Submitting\u2026'; let path = null;
          try {
            const f = file.files && file.files[0];
            if (f) { const m = await uploadDocument(f, 'payment_proof'); path = m.path; }
            await partnerSubmitInvoicePayment(i.id, path, dt.value || null, ref.value.trim() || null, note.value.trim() || null);
            close(); load();
          } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Submit payment report'; err.textContent = (e && e.message) || 'Could not submit.'; }
        } }, 'Submit payment report');
        close = invModal('Report payment \u2014 ' + i.number, [
          h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'Tell us when you expect the payment to clear and upload proof (bank receipt / screenshot). Our team confirms receipt.'),
          h('label', { class: 'cp-fld' }, [h('span', { class: 'cp-row-t' }, 'Expected payment date'), dt]), ref, file, note, err, submit,
        ]);
      };
      // Mobile-first invoice cards (big amount, status, actions thumb-reachable)
      mount(host, h('div', null, rows.map(i => {
        const actions = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => preview(i) }, 'Preview'),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => invPdf(i) }, 'PDF'),
          (i.status === 'sent' || i.status === 'draft') ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => payModal(i) }, 'I\u2019ve paid') : null,
          (i.payment_proof_path && (i.status === 'payment_submitted' || i.status === 'paid')) ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { try { const u = await signedDocumentUrl(i.payment_proof_path, 600); window.open(u, '_blank'); } catch (e) { alert('Could not open proof.'); } } }, 'Proof') : null,
        ].filter(Boolean));
        return h('div', { class: 'cp-card', style: 'margin-bottom:10px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap' }, [
            h('div', null, [
              h('div', { style: 'font-size:22px;font-weight:800;letter-spacing:-.02em' }, money(i.amount)),
              h('div', { class: 'cp-sub' }, [i.number, i.description || null, 'Due ' + fmtDate(i.due_date)].filter(Boolean).join(' \u00b7 ')),
              (i.status === 'payment_submitted') ? h('div', { class: 'cp-sub', style: 'color:#d97706;font-weight:700' }, 'awaiting confirmation' + (i.expected_pay_date ? (' \u00b7 exp ' + fmtDate(i.expected_pay_date)) : '')) : null,
            ].filter(Boolean)),
            pill(i.status),
          ]),
          actions,
        ]);
      })));
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
  const _pAvatar = h('div', { style: 'margin-bottom:12px' });
  try { mountAvatarEditor(_pAvatar, { name: (company && company.value) || 'Partner', size: 60 }); } catch (_) {}
  return h('div', { class: 'cp-card', style: 'margin-top:16px' }, [
    h('div', { class: 'cp-cardhead' }, [icon('user', 18), h('h3', null, 'Account & company')]),
    _pAvatar,
    h('div', { class: 'cp-formgrid' }, [field('Company', company), field('Contact name', contact), field('Phone', phone), field('Billing email', email)]),
    field('Address', address), msg, saveBtn,
  ]);
}

/* WEB-2 — referral program card (flag-gated: referral_program). Brokers earn a share of LoadBoot's own
   dispatch fee on carriers/brokers they refer — the referred party never pays extra. Payouts are human-reviewed. */
/* ----- Mutual rating engine: my rating + rate carriers on delivered trips ----- */
function ratingCard() {
  const host = h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [icon('shield', 18), h('h3', null, 'Ratings')]),
    h('div', { class: 'cp-muted' }, 'Loading…'),
  ]);
  (async () => {
    let mr = null, rt = [];
    try { mr = await myRating(); } catch (_) {}
    try { rt = await partnerRateableTrips(10); } catch (_) { rt = []; }
    const stars = (n) => h('span', { style: 'color:#F97316;letter-spacing:2px' }, '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0)));
    const mine = mr ? h('div', { class: 'cp-row', style: 'border:0' }, [
      h('div', null, [h('div', { class: 'cp-row-t' }, 'Your rating'), h('div', { class: 'cp-row-s' }, (mr.count || 0) + ' reviews · ' + (mr.trips_completed || 0) + ' trips delivered')]),
      mr.avg != null ? h('div', null, [stars(mr.avg), h('b', { style: 'margin-left:6px' }, String(mr.avg))]) : h('span', { class: 'cp-row-s' }, 'No ratings yet'),
    ]) : null;
    const rows = (rt || []).map(x => {
      const w = h('div');
      if (x.my_stars) { w.appendChild(h('div', { class: 'cp-row-s' }, ['You rated: ', stars(x.my_stars)])); }
      else {
        const bar = h('div', { style: 'display:flex;gap:5px;font-size:22px;cursor:pointer;user-select:none' }, [1, 2, 3, 4, 5].map(n =>
          h('span', { style: 'color:#94a3b8', onClick: async () => {
            try { const cm = prompt('Optional \u2014 write a short review (it shows on the carrier\u2019s profile, trip-verified):'); await rateCounterparty(x.trip_id, n, cm && cm.trim() ? cm.trim() : null); w.innerHTML = ''; w.appendChild(h('div', { class: 'cp-row-s', style: 'color:#16a34a' }, '\u2713 Rated ' + n + '\u2605')); }
            catch (e) { alert((e && e.message) || 'Could not rate.'); }
          } }, '☆')));
        w.appendChild(bar);
      }
      return h('div', { class: 'cp-row' }, [
        h('div', null, [h('div', { class: 'cp-row-t' }, x.lane), h('div', { class: 'cp-row-s' }, 'Delivered ' + String(x.delivered_at || '').slice(0, 10))]),
        w,
      ]);
    });
    mount(host, [
      h('div', { class: 'cp-cardhead' }, [icon('shield', 18), h('h3', null, 'Ratings')]),
      mine,
      rows.length ? h('div', null, [h('div', { class: 'cp-row-s', style: 'margin:8px 0 2px;font-weight:700' }, 'Rate the carrier on your delivered trips:'), ...rows]) : h('div', { class: 'cp-muted' }, 'Delivered trips appear here so you can rate the carrier.'),
    ].filter(Boolean));
  })();
  return host;
}

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

/* ---------- verification gate (broker/shipper cannot post until onboarded) ---------- */
function verifyGateCard(ov) {
  const pending = ov.onboarding_pending || 0;
  const card = h('div', { class: 'cp-card', style: 'border-left:4px solid #d97706' }, [
    h('div', { class: 'cp-cardhead' }, [icon('shield', 18), h('h3', null, 'Verification required to post loads')]),
    h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'Your account is under verification. You can post loads once onboarding is complete \u2014 every required document must be reviewed and verified by our team. This protects carriers and keeps the marketplace trusted.'),
    h('div', { class: 'cp-row', style: 'margin-top:10px' }, [h('span', { class: 'cp-row-t' }, 'Required documents still pending'), h('b', { style: 'color:#d97706;font-size:1.1rem' }, String(pending))]),
    h('div', { class: 'cp-sub', style: 'margin:10px 0 4px;font-weight:700' }, 'Your onboarding packet'),
  ]);
  const list = h('div', null, h('div', { class: 'cp-sub' }, 'Loading\u2026'));
  card.appendChild(list);
  (async () => {
    let pk; try { pk = await myOnboardingPacket(); } catch (_) { mount(list, h('div', { class: 'cp-sub' }, 'Could not load your packet.')); return; }
    mount(list, (pk.items || []).map(it => h('div', { style: 'display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #e2e8f0;flex-wrap:wrap' }, [
      h('div', null, [h('b', { style: 'font-size:.9rem' }, it.label), h('div', { class: 'cp-sub' },
        (it.note || '').trim().startsWith('{') ? 'Signed online \u2713'
        : it.status === 'rejected' && it.note ? '\u2715 ' + it.note
        : it.status === 'submitted' ? 'In review'
        : it.status === 'verified' ? 'Verified \u2713'
        : (String(it.tag || '').toLowerCase() === 'optional' ? 'Optional' : 'Required'))]),
      h('div', { style: 'display:flex;gap:6px;align-items:center' }, [pill(it.status),
        h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
          try { openPacketSubmit(it, () => alert('Submitted — our team will verify it. You can post loads once all required items are verified.')); }
          catch (e) { alert((e && e.message) || 'Failed'); }
        } }, packetBtnLabel(it.status))].filter(Boolean)),
    ])));
  })();
  return card;
}

function openCarrierPacketPreview(c) {
  const done9 = (c.compliance || []);
  openModal('\ud83d\udce6 Carrier packet \u2014 ' + (c.name || 'Carrier'), [h('div', { style: 'text-align:center;padding:6px 4px 2px' }, [
    h('div', { style: 'width:74px;height:74px;border-radius:22px;margin:6px auto 12px;display:flex;align-items:center;justify-content:center;font-size:2rem;background:linear-gradient(135deg,#0b1830,#14335c);color:#fff;box-shadow:0 16px 34px -16px rgba(2,12,30,.55)' }, '\ud83d\udd12'),
    h('div', { style: 'font-weight:800;font-size:1.08rem;color:#10223B' }, 'Locked \u2014 unlocks once you start a deal with this carrier'),
    h('div', { class: 'cp-sub', style: 'max-width:460px;margin:6px auto 14px' }, 'The moment ' + (c.name || 'this carrier') + ' accepts one of your loads, LoadBoot releases the full verified setup packet to your brokerage \u2014 no chasing, no email attachments.'),
    h('div', { style: 'text-align:left;max-width:430px;margin:0 auto;background:#f8fafc;border:1px solid #eef2f7;border-radius:14px;padding:14px 16px' }, [
      h('div', { style: 'font-weight:800;font-size:.78rem;color:#64748b;letter-spacing:.08em;margin-bottom:8px' }, 'WHAT YOU RECEIVE ON ACCEPTANCE'),
      ...[['\ud83d\udcc4', 'W-9 \u2014 tax reporting'], ['\ud83d\udee1', 'Certificate of Insurance \u2014 $1M auto / $100k cargo, monitored continuously'], ['\ud83d\udcdc', 'MC/DOT operating authority letter'], ['\u270d', 'Signed broker\u2013carrier agreement'], ['\ud83c\udfc5', 'LoadBoot verification certificate \u2014 downloadable audit record']].map(([i9, t9]) =>
        h('div', { style: 'display:flex;gap:9px;padding:5px 0;font-size:.84rem;color:#334155' }, [h('span', null, i9), h('span', null, t9)])),
    ]),
    done9.length ? h('div', { style: 'max-width:430px;margin:12px auto 0;text-align:left;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:12px 16px' }, [
      h('div', { style: 'font-weight:800;font-size:.74rem;color:#166534;letter-spacing:.06em;margin-bottom:6px' }, '\u2713 ALREADY VERIFIED & WAITING ON FILE (' + done9.length + ')'),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, done9.map(x9 => h('span', { style: 'padding:3px 10px;border-radius:999px;font-size:.7rem;font-weight:700;background:#dcfce7;color:#166534' }, '\u2713 ' + x9))),
    ]) : null,
    h('div', { class: 'cp-sub', style: 'margin-top:12px' }, 'Post a load to this carrier \u2014 the packet unlocks automatically on their acceptance.'),
  ].filter(Boolean))]);
}

function brokerCarriersPage() {
  if (!document.getElementById('cn-css')) {
    const st = document.createElement('style'); st.id = 'cn-css';
    st.textContent = `
      .cn-hero{position:relative;border-radius:20px;overflow:hidden;padding:28px 26px 24px;color:#fff;background:radial-gradient(1100px 420px at 12% -20%,rgba(8,131,247,.5),transparent 60%),radial-gradient(800px 380px at 95% 130%,rgba(252,83,5,.28),transparent 55%),linear-gradient(120deg,#0b1830 0%,#10223B 55%,#132c4e 100%);box-shadow:0 24px 60px -28px rgba(2,12,30,.55);margin-bottom:16px}
      .cn-hero h2{margin:0;font-size:1.45rem;font-weight:800;letter-spacing:-.01em}
      .cn-hero .sub{font-size:.85rem;opacity:.82;margin-top:6px;max-width:720px;line-height:1.55}
      .cn-strip{display:flex;gap:26px;flex-wrap:wrap;margin-top:16px}
      .cn-strip .s b{display:block;font-size:1.3rem;font-weight:800;color:#7cc0ff}
      .cn-strip .s span{font-size:.64rem;text-transform:uppercase;letter-spacing:.09em;opacity:.7;font-weight:700}
      .cn-search{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:10px 15px;margin-top:16px;max-width:560px;backdrop-filter:blur(6px)}
      .cn-search input{flex:1;background:transparent;border:0;outline:0;color:#fff;font-size:.9rem}
      .cn-search input::placeholder{color:rgba(255,255,255,.55)}
      .cn-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 2px 14px}
      .cn-loc{display:flex;align-items:center;gap:7px;background:#fff;border:1.5px solid #e2e8f0;border-radius:999px;padding:6px 13px}
      .cn-loc input{border:0;outline:0;font-size:.8rem;width:170px;font-weight:600;color:#334155}
      .cn-fchip{padding:7px 14px;border-radius:999px;font-size:.8rem;font-weight:700;color:#334155;background:#fff;border:1.5px solid #e2e8f0;cursor:pointer;transition:all .15s}
      .cn-fchip:hover{border-color:#0883F7;color:#0883F7}
      .cn-fchip.on{background:#10223B;border-color:#10223B;color:#fff}
      .cn-sort{margin-left:auto;padding:8px 12px;border-radius:12px;border:1.5px solid #e2e8f0;background:#fff;font-size:.8rem;font-weight:600;color:#334155}
      .cn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
      .cn-card{position:relative;background:#fff;border:1px solid #e6ebf3;border-radius:20px;overflow:hidden;box-shadow:0 14px 38px -26px rgba(2,12,30,.35);transition:transform .18s,box-shadow .18s;display:flex;flex-direction:column}
      .cn-card:hover{transform:translateY(-4px);box-shadow:0 26px 54px -26px rgba(2,12,30,.45)}
      .cn-top{background:linear-gradient(120deg,#0d1b33,#10223B 60%,#14335c);padding:14px 16px 40px;position:relative}
      .cn-top:after{content:'';position:absolute;inset:0;background:radial-gradient(420px 120px at 85% -30%,rgba(8,131,247,.35),transparent 60%)}
      .cn-idrow{position:relative;z-index:1;display:flex;gap:8px;justify-content:space-between;align-items:flex-start}
      .cn-since{font-size:.63rem;color:rgba(255,255,255,.55);font-weight:600;letter-spacing:.04em}
      .cn-ava{width:60px;height:60px;border-radius:16px;margin:-34px 0 0 16px;position:relative;z-index:2;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.15rem;color:#fff;background:linear-gradient(135deg,#0883F7,#10223B);border:3.5px solid #fff;box-shadow:0 10px 22px -10px rgba(2,12,30,.5);overflow:hidden;flex:0 0 auto}
      .cn-ava img{width:100%;height:100%;object-fit:cover}
      .cn-ava.lg{width:74px;height:74px;margin:0;font-size:1.4rem}
      .cn-body{padding:6px 16px 12px;flex:1;display:flex;flex-direction:column}
      .cn-name{font-weight:800;font-size:1.02rem;color:#10223B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cn-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:.64rem;font-weight:800;letter-spacing:.02em}
      .cn-rate{display:inline-flex;align-items:center;gap:7px;margin:5px 0 2px;cursor:pointer;border:0;background:transparent;padding:2px 0;font-size:.83rem;font-weight:700;color:#10223B;text-align:left}
      .cn-rate .st{color:#f59e0b;letter-spacing:1.5px;font-size:.92rem}
      .cn-rate .lnk{color:#0883F7;font-size:.76rem;font-weight:700}
      .cn-rate:hover .lnk{text-decoration:underline}
      .cn-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:9px 0}
      .cn-kpi{background:linear-gradient(180deg,#f8fafc,#f1f5f9);border:1px solid #e9eef5;border-radius:13px;padding:8px 3px;text-align:center}
      .cn-kpi b{display:block;font-size:1rem;font-weight:800;color:#10223B}
      .cn-kpi span{font-size:.57rem;text-transform:uppercase;letter-spacing:.07em;color:#7c8aa0;font-weight:800}
      .cn-sec{margin:6px 0}
      .cn-sec .k{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;font-weight:800;margin-bottom:5px}
      .cn-chips{display:flex;gap:6px;flex-wrap:wrap}
      .cn-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:999px;font-size:.7rem;font-weight:700;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}
      .cn-chip.blue{background:#eff6ff;color:#1d4ed8;border-color:#dbeafe}
      .cn-chip.green{background:#f0fdf4;color:#166534;border-color:#dcfce7}
      .cn-chip.amber{background:#fffbeb;color:#92400e;border-color:#fde68a}
      .cn-chip.red{background:#fef2f2;color:#991b1b;border-color:#fecaca}
      .cn-chip.more{cursor:pointer;color:#0883F7;background:#fff;border-style:dashed}
      .cn-foot{display:flex;gap:8px;border-top:1px solid #f1f5f9;padding:11px 16px;background:#fbfcfe}
      .cn-cta{flex:1;border:0;border-radius:12px;padding:10px 14px;font-weight:800;font-size:.8rem;color:#fff;cursor:pointer;background:linear-gradient(120deg,#0883F7,#0967d2);box-shadow:0 8px 18px -8px rgba(8,131,247,.6);transition:transform .12s}
      .cn-cta:hover{transform:translateY(-1px)}
      .cn-ghost{flex:1;border:1.5px solid #e2e8f0;background:#fff;border-radius:12px;padding:9px 12px;font-weight:700;font-size:.78rem;color:#334155;cursor:pointer;white-space:nowrap}
      .cn-ghost:hover{border-color:#0883F7;color:#0883F7}
      .cn-skel{border-radius:20px;height:330px;background:linear-gradient(100deg,#eef2f7 30%,#f8fafc 45%,#eef2f7 60%);background-size:220% 100%;animation:cnsh 1.1s infinite}
      @keyframes cnsh{0%{background-position:130% 0}100%{background-position:-70% 0}}
      .cn-dist{display:flex;align-items:center;gap:8px;font-size:.76rem;color:#64748b;margin:2px 0}
      .cn-dist .bar{flex:1;height:7px;border-radius:99px;background:#eef2f7;overflow:hidden}
      .cn-dist .bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#fbbf24)}
      #lbmp{max-width:100%;overflow-x:auto}
    `;
    document.head.appendChild(st);
  }
  const wrap = h('div', null);
  const grid = h('div', { class: 'cn-grid' });
  const q = h('input', { placeholder: 'Search carriers by name, DOT, MC, equipment, lane or home base\u2026' });
  const loc = h('input', { placeholder: 'Pickup / delivery state or city\u2026' });
  const stripHost = h('div', { class: 'cn-strip' });
  const barHost = h('div', { class: 'cn-bar' });
  let all = [], fEq = 'All', fFlag = null, sortBy = 'rating', logoBase = null;
  (async () => { try { const sc = await import('../shared/supabaseClient.js'); const sb = await sc.getClient(); const r = sb.storage.from('org-logos').getPublicUrl('x'); logoBase = r && r.data && r.data.publicUrl ? r.data.publicUrl.replace(/\/x$/, '/') : null; } catch (_) {} })();
  const realEq = (e) => e && /[a-zA-Z]{2,}/.test(String(e));
  const mixOf = (c) => (c.fleet_mix || []).filter(m => realEq(m.type));
  const eqOf = (c) => { const a = mixOf(c).map(m => m.type).concat((c.preferred_equipment || []).filter(realEq)); return a.filter((x, i) => a.indexOf(x) === i); };
  const initials = (nm) => String(nm || '?').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
  const starsTxt = (v) => '\u2605'.repeat(Math.round(v || 0)) + '\u2606'.repeat(Math.max(0, 5 - Math.round(v || 0)));
  const pill = (txt, bg, fg) => h('span', { class: 'cn-pill', style: 'background:' + bg + ';color:' + fg }, txt);
  const chip = (txt, cls) => h('span', { class: 'cn-chip' + (cls ? ' ' + cls : '') }, txt);
  const kpi = (label, val, fg) => h('div', { class: 'cn-kpi' }, [h('b', { style: fg ? 'color:' + fg : '' }, val), h('span', null, label)]);
  const sec = (label, kids) => (kids && kids.length) ? h('div', { class: 'cn-sec' }, [h('div', { class: 'k' }, label), h('div', { class: 'cn-chips' }, kids)]) : null;
  const avaEl = (c, lg) => { const logo = (c.logo_path && logoBase) ? (logoBase + c.logo_path) : null; return h('div', { class: 'cn-ava' + (lg ? ' lg' : '') }, logo ? h('img', { src: logo, alt: '' }) : initials(c.name)); };
  const rateLine = (c) => h('button', { class: 'cn-rate', onClick: () => openReviews(c) }, (c.ratings_count || 0) > 0 ? [
    h('span', { class: 'st' }, starsTxt(c.stars)), h('span', null, String(c.stars)),
    h('span', { class: 'lnk' }, c.ratings_count + ' review' + (c.ratings_count === 1 ? '' : 's') + ' \u2014 read \u2192'),
  ] : [h('span', { class: 'cn-chip blue', style: 'font-size:.68rem' }, '\u2728 New on LoadBoot \u2014 not rated yet')]);
  const kpiBand = (c) => {
    const health = c.health != null ? Number(c.health) : null;
    const hFg = health == null ? '#7c8aa0' : health >= 85 ? '#16a34a' : health >= 60 ? '#d97706' : '#dc2626';
    return h('div', { class: 'cn-kpis' }, [
      kpi('On-time', c.on_time_pct != null ? c.on_time_pct + '%' : 'New', c.on_time_pct != null ? (c.on_time_pct >= 90 ? '#16a34a' : '#d97706') : '#94a3b8'),
      kpi('Delivered', String(c.delivered || 0)),
      kpi('Cancels', String(c.carrier_cancels || 0), (c.carrier_cancels || 0) > 0 ? '#dc2626' : '#16a34a'),
      kpi('Health', health != null ? String(health) : '\u2014', hFg),
    ]);
  };
  const fmcsaChips = (c) => [
    c.dot ? chip('DOT ' + String(c.dot).replace(/^DOT\s*/i, '')) : null,
    c.mc ? chip('MC ' + String(c.mc).replace(/^MC\s*/i, '')) : null,
    c.authority ? chip('Authority: ' + String(c.authority).toUpperCase(), String(c.authority).toLowerCase() === 'active' ? 'green' : 'amber') : null,
    (c.safety_rating && String(c.safety_rating).toLowerCase() !== 'none') ? chip('Safety: ' + String(c.safety_rating).toUpperCase()) : null,
    c.driver_count ? chip(c.driver_count + ' drivers') : null,
  ].filter(Boolean);
  const fleetChips = (c) => mixOf(c).map(m => chip('\ud83d\ude9b ' + m.type + (m.n > 1 ? ' \u00d7 ' + m.n : ''), 'blue'))
    .concat((!mixOf(c).length ? (c.preferred_equipment || []).filter(realEq).map(e => chip('\ud83d\ude9b ' + e, 'blue')) : []))
    .concat((c.trailer_mix || []).filter(m => realEq(m.type)).map(m => chip('\ud83d\udee3 ' + m.type + (m.n > 1 ? ' \u00d7 ' + m.n : ''), 'blue')));
  const capChips = (c) => [
    c.hazmat ? chip('\u2622 HAZMAT certified', 'amber') : null,
    c.team_drivers ? chip('\ud83d\udc65 Team drivers', 'green') : null,
    c.weekend_ok ? chip('Weekends OK', 'green') : null,
    c.max_weight_lbs ? chip('Max ' + Number(c.max_weight_lbs).toLocaleString() + ' lb') : null,
    (c.carrier_cancels || 0) > 0 ? chip('\u26a0 ' + c.carrier_cancels + ' carrier cancel' + (c.carrier_cancels === 1 ? '' : 's'), 'red') : null,
  ].filter(Boolean);
  const covChips = (c) => [
    c.home_base ? chip('\ud83d\udccd ' + c.home_base) : null,
    (c.preferred_lanes || []).length ? chip('Runs: ' + c.preferred_lanes.join(', ')) : null,
  ].filter(Boolean);
  const insured = (c) => (c.compliance || []).some(x => /insurance|coi/i.test(String(x)));
  const dotClean = (c) => c.dot ? String(c.dot).replace(/^DOT\s*/i, '') : null;
  const mcClean = (c) => c.mc ? String(c.mc).replace(/^MC\s*/i, '') : null;
  const statusStrip = (c) => {
    const authOk = String(c.authority || '').toLowerCase() === 'active';
    const dotEl = (ok, txt, warnTxt) => h('span', { style: 'display:inline-flex;align-items:center;gap:5px;font-weight:700;color:' + (ok ? '#166534' : '#92400e') }, [
      h('span', { style: 'width:8px;height:8px;border-radius:99px;background:' + (ok ? '#22c55e' : '#f59e0b') }), ok ? txt : warnTxt]);
    return h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:.74rem;color:#475569;background:#f8fafc;border:1px solid #eef2f7;border-radius:11px;padding:7px 11px;margin:7px 0 2px' }, [
      dotClean(c) ? h('span', { style: 'font-weight:700' }, 'DOT ' + dotClean(c)) : null,
      mcClean(c) ? h('span', { style: 'font-weight:700' }, 'MC ' + mcClean(c)) : null,
      c.authority ? dotEl(authOk, 'Authority ACTIVE', 'Authority ' + String(c.authority).toUpperCase()) : null,
      insured(c) ? dotEl(true, '\ud83d\udee1 Insured \u2713') : null,
    ].filter(Boolean));
  };
  const capacityLine = (c) => {
    const kids = fleetChips(c).slice(0, 3);
    if (c.hazmat) kids.push(chip('\u2622', 'amber'));
    if (c.team_drivers) kids.push(chip('\ud83d\udc65', 'green'));
    return kids;
  };
  const clamp = (arr, n, c) => arr.length > n
    ? arr.slice(0, n).concat(h('span', { class: 'cn-chip more', onClick: () => openProfile(c) }, '+' + (arr.length - n) + ' more'))
    : arr;

  const openFmcsa = (c) => {
    const host = h('div', { style: 'width:100%' }, h('div', { class: 'cp-sub' }, 'Loading live FMCSA profile\u2026'));
    openModal('\ud83d\udee1 ' + (c.name || 'Carrier') + ' \u2014 live FMCSA profile', [host], { wide: true });
    try { renderFmcsaOnly(host, String(c.dot).replace(/\D/g, ''), { light: true }); }
    catch (e) { mount(host, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load FMCSA data.')); }
  };

  const openReviews = async (c) => {
    const bodyEl = h('div', null, h('div', { class: 'cp-sub' }, 'Loading reviews\u2026'));
    openModal('\u2b50 ' + (c.name || 'Carrier') + ' \u2014 trip-verified reviews', [bodyEl]);
    let rows; try { rows = (await partnerCarrierReviews(c.id)) || []; } catch (e) { mount(bodyEl, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load reviews.')); return; }
    const avg = c.stars || (rows.length ? (rows.reduce((a, r) => a + (r.stars || 0), 0) / rows.length) : 0);
    const dist = [5, 4, 3, 2, 1].map(n => ({ n, c: rows.filter(r => Math.round(r.stars) === n).length }));
    mount(bodyEl, h('div', null, [
      h('div', { style: 'display:flex;gap:18px;align-items:center;margin-bottom:12px;flex-wrap:wrap' }, [
        h('div', { style: 'text-align:center' }, [
          h('div', { style: 'font-size:2.2rem;font-weight:800;color:#10223B;line-height:1' }, rows.length ? Number(avg).toFixed(1) : '\u2014'),
          h('div', { style: 'color:#f59e0b;letter-spacing:2px' }, starsTxt(avg)),
          h('div', { class: 'cp-sub' }, rows.length + ' review' + (rows.length === 1 ? '' : 's')),
        ]),
        h('div', { style: 'flex:1;min-width:220px' }, dist.map(d => h('div', { class: 'cn-dist' }, [
          h('span', { style: 'width:22px;font-weight:700' }, d.n + '\u2605'),
          h('div', { class: 'bar' }, h('i', { style: 'width:' + (rows.length ? Math.round(100 * d.c / rows.length) : 0) + '%' })),
          h('span', { style: 'width:18px;text-align:right' }, String(d.c)),
        ]))),
      ]),
      h('div', { style: 'background:#eff6ff;border:1px solid #dbeafe;border-radius:12px;padding:10px 13px;font-size:.8rem;color:#1e40af;margin-bottom:12px' },
        '\ud83d\udd12 Every review is trip-verified \u2014 only a broker who completed a booking with this carrier on LoadBoot can rate it. No fake reviews.'),
      rows.length ? h('div', null, rows.map(r => h('div', { style: 'border:1px solid #eef2f7;border-radius:14px;padding:12px 14px;margin-bottom:9px' }, [
        h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap' }, [
          h('span', { style: 'color:#f59e0b;letter-spacing:1.5px;font-weight:700' }, starsTxt(r.stars)),
          h('span', { class: 'cp-sub' }, r.date || ''),
        ]),
        r.comment ? h('div', { style: 'margin:6px 0 4px;color:#334155;font-size:.88rem;line-height:1.55' }, '\u201c' + r.comment + '\u201d') : null,
        h('div', { class: 'cp-sub', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px' }, [
          h('span', { class: 'cn-chip green', style: 'font-size:.66rem' }, '\u2713 ' + (r.reviewer || 'Verified broker')),
          h('span', null, '\ud83d\ude9a ' + (r.lane || 'Completed trip')),
        ]),
      ].filter(Boolean))))
        : h('div', { style: 'text-align:center;padding:26px;color:#64748b' }, [
            h('div', { style: 'font-size:34px' }, '\u2728'),
            h('div', { style: 'font-weight:700;color:#10223B;margin:6px 0 3px' }, '\u2728 New carrier on LoadBoot'),
            h('div', { class: 'cp-sub' }, 'This carrier recently joined and has no completed-booking reviews yet. Ratings appear automatically after brokers finish loads with them \u2014 every review is trip-verified.'),
          ]),
    ]));
  };

  const openProfile = (c) => {
    openModal('Carrier profile', [h('div', null, [
      h('div', { style: 'display:flex;gap:14px;align-items:center;margin-bottom:4px' }, [
        avaEl(c, true),
        h('div', { style: 'min-width:0' }, [
          h('div', { style: 'font-weight:800;font-size:1.15rem;color:#10223B' }, c.name || 'Carrier'),
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:5px' }, [
            pill('\u2713 LOADBOOT VERIFIED', '#dcfce7', '#166534'),
            ((c.compliance || []).length >= 3) ? h('button', { class: 'cn-pill', style: 'background:#ede9fe;color:#6d28d9;border:0;cursor:pointer', onClick: () => openCarrierPacketPreview(c) }, '\ud83d\udce6 Carrier packet \ud83d\udd12') : null,
            c.out_of_service ? pill('\u26d4 OUT OF SERVICE', '#fee2e2', '#991b1b') : null,
            c.available === false ? pill('\u23f8 NOT ACCEPTING LOADS', '#fef3c7', '#92400e') : null,
            pill('MEMBER SINCE ' + String(c.member_since || '\u2014').toUpperCase(), '#f1f5f9', '#334155'),
          ].filter(Boolean)),
        ]),
      ]),
      rateLine(c),
      kpiBand(c),
      sec('FMCSA \u00b7 authority', fmcsaChips(c)),
      sec('Fleet \u2014 what they run', fleetChips(c)),
      sec('Coverage', covChips(c)),
      (c.compliance || []).length ? sec('Compliance on file', c.compliance.map(x => chip('\u2713 ' + x, 'green'))) : null,
      sec('Capabilities', capChips(c)),
      h('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
        h('button', { class: 'cn-ghost', onClick: () => openReviews(c) }, '\u2b50 Reviews'),
        c.dot ? h('button', { class: 'cn-ghost', onClick: () => openFmcsa(c) }, '\ud83d\udee1 Live FMCSA profile') : null,
        (c.at_capacity
          ? h('button', { class: 'cn-cta', disabled: 'disabled', style: 'opacity:.55;cursor:not-allowed;background:#64748b', title: 'All of this carrier\u2019s trucks are on active loads' }, '\ud83d\ude9a All trucks booked')
          : h('button', { class: 'cn-cta', onClick: () => { directCarrier = { id: c.id, name: c.name }; if (bgoHook) { bgoHook('dashboard'); if (window.__lbOpenPost) window.__lbOpenPost(); } } }, '\ud83c\udfaf Post a load to this carrier')),
      ].filter(Boolean)),
    ].filter(Boolean))]);
  };

  const post = (c) => h('div', { class: 'cn-card' }, [
    h('div', { class: 'cn-top' }, [h('div', { class: 'cn-idrow' }, [
      h('span', { class: 'cn-since' }, 'MEMBER SINCE ' + String(c.member_since || '\u2014').toUpperCase()),
      h('div', { style: 'display:flex;gap:6px;position:relative;z-index:1' }, [
        pill('\u2713 VERIFIED', 'rgba(34,197,94,.18)', '#4ade80'),
        ((c.compliance || []).length >= 3) ? h('button', { class: 'cn-pill', style: 'background:rgba(139,92,246,.2);color:#c4b5fd;border:0;cursor:pointer', onClick: (e9) => { e9.stopPropagation(); openCarrierPacketPreview(c); } }, '\ud83d\udce6 Carrier packet \ud83d\udd12') : null,
        c.out_of_service ? pill('\u26d4 OOS', 'rgba(239,68,68,.2)', '#fca5a5') : null,
        c.available === false ? pill('\u23f8', 'rgba(245,158,11,.2)', '#fcd34d') : null,
      ].filter(Boolean)),
    ])]),
    avaEl(c),
    h('div', { class: 'cn-body' }, [
      h('div', { class: 'cn-name', title: c.name || '' }, c.name || 'Carrier'),
      rateLine(c),
      kpiBand(c),
      statusStrip(c),
      sec('Capacity', clamp(capacityLine(c), 5, c)),
      sec('Coverage', clamp(covChips(c), 2, c)),
      h('div', { style: 'flex:1' }),
    ].filter(Boolean)),
    h('div', { class: 'cn-foot' }, [
      h('button', { class: 'cn-ghost', onClick: () => openProfile(c) }, 'View full profile'),
      (c.at_capacity
          ? h('button', { class: 'cn-cta', disabled: 'disabled', style: 'opacity:.55;cursor:not-allowed;background:#64748b', title: 'All of this carrier\u2019s trucks are on active loads' }, '\ud83d\ude9a All trucks booked')
          : h('button', { class: 'cn-cta', onClick: () => { directCarrier = { id: c.id, name: c.name }; if (bgoHook) { bgoHook('dashboard'); if (window.__lbOpenPost) window.__lbOpenPost(); } } }, '\ud83c\udfaf Post a load to this carrier')),
    ]),
  ]);

  const applyAll = () => {
    const t = q.value.trim().toLowerCase();
    const lv = loc.value.trim().toLowerCase();
    let list = all.filter(c => {
      if (fEq !== 'All' && !eqOf(c).some(e => String(e).toLowerCase() === fEq.toLowerCase())) return false;
      if (fFlag === 'hazmat' && !c.hazmat) return false;
      if (fFlag === 'team' && !c.team_drivers) return false;
      if (lv) {
        const zone = [c.home_base].concat(c.preferred_lanes || []).filter(Boolean).join(' ').toLowerCase();
        if (!zone.includes(lv)) return false;
      }
      if (!t) return true;
      const hay = [c.name, c.home_base, c.dot, c.mc].concat(eqOf(c), c.preferred_lanes || []).filter(Boolean).join(' ').toLowerCase();
      return hay.includes(t);
    });
    const num = (v) => v == null ? -1 : Number(v);
    if (sortBy === 'rating') list.sort((a, b) => num(b.stars) - num(a.stars) || num(b.ratings_count) - num(a.ratings_count) || num(b.health) - num(a.health));
    else if (sortBy === 'delivered') list.sort((a, b) => num(b.delivered) - num(a.delivered));
    else if (sortBy === 'health') list.sort((a, b) => num(b.health) - num(a.health));
    mount(grid, list.length ? list.map(post) : h('div', { style: 'grid-column:1/-1;text-align:center;background:#fff;border:1px dashed #cbd5e1;border-radius:20px;padding:44px' }, [
      h('div', { style: 'font-size:44px' }, '\ud83d\ude9a'),
      h('div', { style: 'font-weight:800;margin:10px 0 4px;color:#10223B;font-size:1.05rem' }, (t || lv || fEq !== 'All' || fFlag) ? 'No carriers match' : 'No published carriers yet'),
      h('div', { class: 'cp-sub', style: 'max-width:420px;margin:0 auto' }, (t || lv || fEq !== 'All' || fFlag) ? 'Try a different location, equipment or filter.' : 'LoadBoot verifies every carrier (FMCSA authority, insurance, W-9, signed agreement) and publishes them here once they pass.'),
    ]));
  };

  const drawBar = () => {
    const eqSet = ['All'];
    all.forEach(c => { eqOf(c).forEach(e => { if (eqSet.indexOf(e) < 0) eqSet.push(e); }); });
    const sort = h('select', { class: 'cn-sort' }, [['rating', '\u2b50 Top rated'], ['delivered', '\ud83d\udce6 Most delivered'], ['health', '\ud83d\udc9a Best health'], ['name', 'A \u2192 Z']].map(([v, l]) => h('option', { value: v }, l)));
    sort.value = sortBy; sort.onchange = () => { sortBy = sort.value; applyAll(); };
    mount(barHost, [
      h('div', { class: 'cn-loc' }, [h('span', { style: 'font-size:.85rem' }, '\ud83d\udccd'), loc]),
      ...eqSet.map(e => h('button', { class: 'cn-fchip' + (fEq === e ? ' on' : ''), onClick: () => { fEq = e; drawBar(); applyAll(); } }, e)),
      h('button', { class: 'cn-fchip' + (fFlag === 'hazmat' ? ' on' : ''), onClick: () => { fFlag = fFlag === 'hazmat' ? null : 'hazmat'; drawBar(); applyAll(); } }, '\u2622 HAZMAT'),
      h('button', { class: 'cn-fchip' + (fFlag === 'team' ? ' on' : ''), onClick: () => { fFlag = fFlag === 'team' ? null : 'team'; drawBar(); applyAll(); } }, '\ud83d\udc65 Team'),
      sort,
    ]);
  };

  q.addEventListener('input', applyAll);
  loc.addEventListener('input', applyAll);
  mount(grid, [1, 2, 3].map(() => h('div', { class: 'cn-skel' })));
  (async () => {
    try { all = (await partnerCarrierDirectory()) || []; } catch (_) { all = []; }
    try {
      const ids = all.map(c => c.id).filter(Boolean);
      if (ids.length) { const cap = await partnerCarrierCapacity(ids); all.forEach(c => { const k = cap && cap[c.id]; if (k) { c.at_capacity = !!k.at_capacity; c.available_trucks = k.available; c.active_trips = k.active_trips; } }); }
    } catch (_) {}
    const tTrucks = all.reduce((a, c) => a + ((c.trucks || 0) || c.power_units || 0), 0);
    const tDel = all.reduce((a, c) => a + (c.delivered || 0), 0);
    const hs = all.map(c => Number(c.health)).filter(x => !isNaN(x) && x > 0);
    mount(stripHost, [
      h('div', { class: 's' }, [h('b', null, String(all.length)), h('span', null, 'Verified carriers')]),
      h('div', { class: 's' }, [h('b', null, String(tTrucks)), h('span', null, 'Trucks in network')]),
      h('div', { class: 's' }, [h('b', null, String(tDel)), h('span', null, 'Loads delivered')]),
      hs.length ? h('div', { class: 's' }, [h('b', null, String(Math.round(hs.reduce((a, b) => a + b, 0) / hs.length))), h('span', null, 'Avg health score')]) : null,
    ].filter(Boolean));
    drawBar(); applyAll();
  })();
  mount(wrap, [
    h('div', { class: 'cn-hero' }, [
      h('h2', null, 'LoadBoot Carrier Network'),
      h('div', { class: 'sub' }, 'Every carrier below passed full vetting \u2014 FMCSA authority, insurance, W-9, signed agreement \u2014 and is monitored live by our health engine. Reviews are trip-verified: only brokers who actually booked with a carrier can rate it. Post a load to send direct offers; the first to accept wins.'),
      h('div', { class: 'cn-search' }, [h('span', { style: 'opacity:.7' }, '\ud83d\udd0d'), q]),
      stripHost,
    ]),
    barHost,
    grid,
  ]);
  return wrap;
}

function approvedPartnersCard() {
  const card = h('div', { class: 'cp-card' });
  const body = h('div', null, h('div', { class: 'cp-sub' }, 'Loading\u2026'));
  (async () => {
    let np; try { np = await myApprovedPartners(); } catch (_) { card.remove(); return; }
    const ps = (np && np.partners) || [];
    if (!ps.length) { mount(body, h('div', { class: 'cp-sub' }, 'No approved partners yet. Carriers you approve and shippers you work with appear here as verified, anonymized profiles \u2014 you keep dealing through LoadBoot.')); return; }
    mount(body, ps.map(p => {
      const stars = p.rating ? '\u2605'.repeat(Math.round(p.rating)) + '\u2606'.repeat(5 - Math.round(p.rating)) : '';
      const label = (p.role === 'carrier' ? 'Carrier ' : p.role === 'shipper' ? 'Shipper ' : 'Partner ') + (p.ref || '');
      return h('div', { style: 'padding:8px 10px;margin:6px 0;border:1px solid #e2e8f0;border-radius:10px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;border-left:4px solid ' + (p.verified ? '#16a34a' : '#94a3b8') }, [
        h('div', null, [h('b', null, label + (p.verified ? ' \u2713' : '')), h('div', { class: 'cp-sub' }, [p.deals + ' deal(s)', p.trust_score != null ? 'Trust ' + p.trust_score + '/100' : null].filter(Boolean).join(' \u00b7 '))]),
        h('span', { style: 'align-self:center;color:#f59e0b;font-weight:700' }, stars),
      ]);
    }));
  })();
  mount(card, [h('div', { class: 'cp-cardhead' }, [icon('user', 18), h('h3', null, 'Approved partners')]), body]);
  return card;
}

function bookRequestsCard() {
  const card = h('div', { class: 'cp-card' });
  const body = h('div', null, h('div', { class: 'cp-sub' }, 'Loading\u2026'));
  const render = async () => {
    let rows; try { rows = await bookRequestsQueue('pending'); } catch (_) { card.remove(); return; }
    if (!rows || !rows.length) { mount(body, h('div', { class: 'cp-sub' }, 'No pending booking requests. Carriers who request your loads appear here \u2014 approve or decline after seeing their verified trust profile. Their identity and contact stay private until you work together through LoadBoot.')); return; }
    mount(body, rows.map(r => {
      const t = r.trust || {}; const rate = Number(t.rating || 0);
      const stars = rate ? '\u2605'.repeat(Math.round(rate)) + '\u2606'.repeat(5 - Math.round(rate)) : '';
      const badge = h('span', { style: 'padding:3px 9px;border-radius:20px;font-weight:800;font-size:.72rem;' + (t.verified ? 'background:#dcfce7;color:#166534' : 'background:#fef3c7;color:#92400e') }, t.verified ? '\u2713 ' + (t.verified_label || 'Verified') : 'Unverified');
      const note = h('input', { class: 'cp-in', placeholder: 'Optional note to the carrier\u2026' });
      const decide = async (action, ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = '\u2026'; try { await decideBookRequest(r.id, action, note.value || null); render(); } catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Failed'); } };
      const openApproveBook = async (ev) => {
        const btn = ev.currentTarget; btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Loading\u2026';
        let items = [], fl = null;
        try { if (r.partner_load) items = (await loadChecklist('partner_load', r.partner_load)) || []; } catch (_) {}
        try { fl = await partnerLoadFull(r.load); } catch (_) {}
        btn.disabled = false; btn.textContent = orig;
        const rcItem = items.find(x => x.doc_key === 'rate_confirmation');
        const apptItem = items.find(x => x.doc_key === 'appointment_confirmation');
        const rcSigned = rcItem && (rcItem.status === 'received' || rcItem.status === 'verified');
        const needAppt = !r.fcfs;
        const nameIn = h('input', { class: 'cp-in', placeholder: 'Type your full legal name to SIGN the rate confirmation' });
        const apptIn = h('input', { class: 'cp-in', placeholder: 'Confirmed pickup time (e.g. Jul 16, 10:00 AM)' });
        const apptNo = h('input', { class: 'cp-in', placeholder: 'Appointment / confirmation # (optional)', style: 'margin-top:6px' });
        const err = h('div', { class: 'cp-err' });
        const doIt = h('button', { class: 'cp-btn', style: 'background:#16a34a;width:100%;margin-top:12px' }, '\u270d Sign & book');
        const summary = ((fl && (fl.origin_full || fl.origin)) || r.origin || '') + ' \u2192 ' + ((fl && (fl.destination_full || fl.destination)) || r.destination || '') + ' \u00b7 $' + Number((fl && fl.rate) || r.rate || 0).toLocaleString() + ' \u00b7 ' + ((fl && fl.equipment) || r.equipment || '') + (fl && fl.pickup_date ? ' \u00b7 PU ' + fl.pickup_date : '');
        const close = openModal('\u270d Issue the dispatch pack & book \u2014 ' + (r.origin || '') + ' \u2192 ' + (r.destination || ''), h('div', null, [
          h('div', { class: 'cp-sub' }, 'Two things the driver can\u2019t roll without \u2014 provide them now to book. Pickup #, delivery # and billing are collected later, just-in-time.'),
          h('div', { style: 'background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:10px 13px;font-size:.82rem;color:#334155;margin:10px 0' }, summary),
          h('label', { style: 'display:block;font-weight:700;font-size:.8rem;color:#334155' }, rcSigned ? '\u2460 Rate confirmation \u2713 already signed' : '\u2460 Rate confirmation \u2014 sign to execute'),
          rcSigned ? null : nameIn,
          needAppt ? h('label', { style: 'display:block;font-weight:700;font-size:.8rem;color:#334155;margin-top:10px' }, '\u2461 Appointment (this is an appointment load)') : h('div', { class: 'cp-sub', style: 'margin-top:10px' }, 'FCFS load \u2014 no appointment needed (the carrier checks in within the window).'),
          needAppt ? apptIn : null, needAppt ? apptNo : null,
          err, doIt,
          h('div', { class: 'cp-sub', style: 'margin-top:10px;color:#64748b' }, 'After booking: pickup # before the driver reaches pickup \u00b7 delivery # before delivery \u00b7 billing after POD.'),
        ].filter(Boolean)));
        doIt.onclick = async () => {
          if (!rcSigned && rcItem && !nameIn.value.trim()) { err.textContent = 'Type your legal name to sign the rate confirmation.'; return; }
          if (needAppt && apptItem && !apptIn.value.trim()) { err.textContent = 'Enter the confirmed appointment time.'; return; }
          doIt.disabled = true; doIt.textContent = 'Booking\u2026';
          try {
            if (!rcSigned && rcItem) {
              const d = Object.assign({}, fl || {}, { signer: nameIn.value.trim(), signed_date: new Date().toISOString().slice(0, 10), ref: 'LB-RC-' + String((fl && fl.id) || r.load || '').replace(/-/g, '').slice(0, 8).toUpperCase() });
              await partnerChecklistSubmit(rcItem.id, 'Rate confirmation ' + d.ref + ' signed online by ' + d.signer + ' on ' + d.signed_date, JSON.stringify(d));
            }
            if (needAppt && apptItem && apptIn.value.trim()) {
              await partnerChecklistSubmit(apptItem.id, ['Confirmation #: ' + (apptNo.value.trim() || '\u2014'), 'Confirmed time: ' + apptIn.value.trim()].join(' \u00b7 '));
            }
            await decideBookRequest(r.id, 'approve', (note && note.value) || null);
            close();
            pToast('Rate confirmation issued to the carrier. Add pickup # before the driver reaches pickup, delivery # before delivery, billing after POD.', { kind: 'ok', title: '\ud83d\ude9a Booked \u2014 driver can roll' });
            render();
          } catch (e) { doIt.disabled = false; doIt.textContent = '\u270d Sign & book'; err.textContent = (e && e.message) || 'Could not book.'; }
        };
      };
      const cdEl = h('span', { style: 'font-weight:800;font-size:.78rem;padding:3px 10px;border-radius:20px;background:#fef3c7;color:#92400e' }, '');
      if (r.expires_at) {
        const tick = () => {
          const ms = new Date(r.expires_at).getTime() - Date.now();
          if (ms <= 0) { cdEl.textContent = 'expired'; cdEl.style.background = '#fee2e2'; cdEl.style.color = '#991b1b'; return; }
          const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
          cdEl.textContent = '⏱ ' + m + ':' + String(sec).padStart(2, '0') + ' left';
          if (ms < 5 * 60000) { cdEl.style.background = '#fee2e2'; cdEl.style.color = '#991b1b'; }
          setTimeout(tick, 1000);
        };
        tick();
      }
      return h('div', { style: 'padding:10px;margin:8px 0;border:1px solid #e2e8f0;border-radius:12px;border-left:4px solid ' + (t.verified ? '#16a34a' : '#d97706') }, [
        h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center' }, [
          h('div', null, [h('b', null, (r.origin || '\u2014') + ' \u2192 ' + (r.destination || '\u2014')), h('div', { class: 'cp-sub' }, [r.equipment, r.rate != null ? ('$' + Number(r.rate).toLocaleString()) : null].filter(Boolean).join(' \u00b7 '))]),
          h('div', { style: 'text-align:right' }, [badge, h('div', { style: 'color:#f59e0b;font-weight:700' }, stars + ' ' + rate.toFixed(1)), r.expires_at ? h('div', { style: 'margin-top:4px' }, cdEl) : null].filter(Boolean)),
        ]),
        h('div', { class: 'cp-sub', style: 'margin-top:6px' }, r.carrier + ' \u00b7 Trust ' + (t.trust_score || 0) + '/100 \u00b7 ' + (t.docs_verified || 0) + '/' + (t.docs_required || 0) + ' docs verified' + (t.on_time_pct != null ? (' \u00b7 ' + t.on_time_pct + '% on-time') : '') + (t.deliveries != null ? (' \u00b7 ' + t.deliveries + ' deliveries') : '') + ' \u00b7 identity private'),
        r.note ? h('div', { class: 'cp-sub' }, 'Carrier note: ' + r.note) : null,
        (() => {
          const pw = h('div');
          const pbtn = h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'margin-top:6px', onClick: async () => {
            if (pw.firstChild) { pw.innerHTML = ''; return; }
            pw.appendChild(h('div', { class: 'cp-sub' }, 'Loading carrier packet…'));
            let pk; try { pk = await bookRequestCarrierPacket(r.id); } catch (e) { pw.innerHTML = ''; pw.appendChild(h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load packet.')); return; }
            pw.innerHTML = '';
            const stPill = (st) => h('span', { style: 'font-size:11px;font-weight:800;padding:2px 8px;border-radius:20px;' + (st === 'verified' ? 'background:#dcfce7;color:#166534' : st === 'submitted' ? 'background:#fef3c7;color:#92400e' : 'background:#eef2f7;color:#475569') }, st);
            pw.appendChild(h('div', { style: 'margin-top:8px;padding:10px;background:#f8fafc;border-radius:10px' }, [
              h('div', { style: 'font-weight:800;font-size:13px;margin-bottom:6px' }, 'Carrier packet — ' + pk.required_verified + '/' + pk.required_total + ' required items verified'),
              ...(pk.packet || []).map(it => h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12.5px' }, [h('span', { style: 'font-weight:600' }, it.label), stPill(it.status)])),
              h('div', { class: 'cp-sub', style: 'margin-top:6px' }, pk.note || ''),
            ]));
          } }, '📋 Carrier packet');
          return h('div', null, [pbtn, pw]);
        })(),
        note,
        h('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [
          h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a', onClick: (ev) => openApproveBook(ev) }, 'Approve & book'),
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: (ev) => decide('reject', ev) }, 'Decline'),
        ]),
      ].filter(Boolean));
    }));
  };
  render();
  mount(card, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, 'Booking requests')]), body]);
  return card;
}

/* ---------- BROKER dashboard ---------- */
async function brokerDash(user, ov) {
  try { window.__lbKindLabel = (ov.kind === 'shipper') ? 'Shipper' : 'Broker'; } catch (_) {}
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
  let step = 0, confirmDup = false, prevStep = 0;
  // reactive=true => re-render the step live on each keystroke (market estimate, TEAM check, etc.)
  // stay wired even after the value is cleared and retyped, with focus + caret preserved.
  function renderStepFocus(fkey, caret) { renderStep(); try { const el = stepHost.querySelector('[data-fkey="' + fkey + '"]'); if (el) { el.focus(); if (el.type !== 'number' && caret != null) { try { el.setSelectionRange(caret, caret); } catch (_) {} } } } catch (_) {} }
  const wi = (label, key, type, reactive) => { const i = inp(label, type || 'text'); i.value = w[key] || ''; i.setAttribute('data-fkey', key); i.oninput = () => { w[key] = i.value; if (reactive) { let c = null; try { c = i.selectionStart; } catch (_) {} renderStepFocus(key, c); } }; return field(label, i); };
  const toggle = (label, key) => { const b = h('button', { class: 'cp-btn ghost' + (w[key] ? ' on' : ''), onClick: () => { w[key] = !w[key]; b.className = 'cp-btn ghost' + (w[key] ? ' on' : ''); b.textContent = label + ': ' + (w[key] ? 'Yes' : 'No'); } }, label + ': ' + (w[key] ? 'Yes' : 'No')); return b; };
  function renderStep() {
    let body;
    if (step === 0) {
      body = h('div', { class: 'cp-formgrid' }, [
        h('div', { class: 'cp-sub', style: 'grid-column:1/-1;font-weight:700;color:#10223B' }, 'Pickup facility'),
        wi('Street address', 'o_street'), wi('City', 'o_city'), wi('State (2 letters)', 'o_state'), wi('ZIP *', 'o_zip'),
        h('div', { class: 'cp-sub', style: 'grid-column:1/-1;font-weight:700;color:#10223B;margin-top:4px' }, 'Delivery facility'),
        wi('Street address', 'd_street'), wi('City', 'd_city'), wi('State (2 letters)', 'd_state'), wi('ZIP *', 'd_zip'),
        h('div', { class: 'cp-sub', style: 'grid-column:1/-1;font-weight:700;color:#10223B;margin-top:4px' }, 'Lane'),
        wi('Miles', 'miles', 'number'), wi('Reference (optional)', 'reference'),
      ]);
      // Street suggestions fill city/state/ZIP + exact pin; driving miles auto-calc when both pins known.
      try {
        const ins = body.querySelectorAll('input');
        const oSt = ins[0], oCi = ins[1], oSa = ins[2], oZp = ins[3];
        const dSt = ins[4], dCi = ins[5], dSa = ins[6], dZp = ins[7];
        const mIn = ins[8];
        const geo = { o: (w.pickup_lat && w.pickup_lng) ? { lat: w.pickup_lat, lng: w.pickup_lng } : null, d: (w.delivery_lat && w.delivery_lng) ? { lat: w.delivery_lat, lng: w.delivery_lng } : null };
        const recalc = async () => {
          if (!(geo.o && geo.d)) return;
          try {
            const wp9 = (Array.isArray(w.stops) ? w.stops : []).filter((sp) => sp && sp.lat && sp.lng).map((sp) => sp.lng + ',' + sp.lat);
            const coords9 = [geo.o.lng + ',' + geo.o.lat, ...wp9, geo.d.lng + ',' + geo.d.lat].join(';');
            if (wp9.length && !w.__direct_miles) { try {
              const rd9 = await fetch('https://router.project-osrm.org/route/v1/driving/' + geo.o.lng + ',' + geo.o.lat + ';' + geo.d.lng + ',' + geo.d.lat + '?overview=false');
              const jd9 = await rd9.json(); const dm9 = jd9 && jd9.routes && jd9.routes[0] && jd9.routes[0].distance;
              if (dm9) w.__direct_miles = Math.round(dm9 / 1609.34);
            } catch (_) {} }
            const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + coords9 + '?overview=false');
            const j = await r.json();
            const m9 = j && j.routes && j.routes[0] && j.routes[0].distance;
            if (m9) { const miles = Math.round(m9 / 1609.34); mIn.value = String(miles); w.miles = String(miles); w.__auto_miles = true; try { w.__drive_hours = (j.routes[0].duration || 0) / 3600; w.__leg_hours = (j.routes[0].legs || []).map((lg9) => (lg9.duration || 0) / 3600); } catch (_) {}
              mIn.title = 'Auto-calculated driving miles (via ' + ((Array.isArray(w.stops) ? w.stops.filter((sp) => sp && sp.lat).length : 0) || 'no') + ' extra stop(s)) — edit if you route differently'; }
          } catch (_) {}
        };
        const setIn = (inp, key, val) => { inp.value = val || ''; w[key] = inp.value; };
        const upSt = (inp, key) => { inp.maxLength = 2; inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, ''); w[key] = inp.value; }); };
        upSt(oSa, 'o_state'); upSt(dSa, 'd_state');
        [[oSt, 'o'], [oCi, 'o'], [oSa, 'o'], [dSt, 'd'], [dCi, 'd'], [dSa, 'd']].forEach(([inp, side]) => {
          inp.addEventListener('input', (ev9) => { if (ev9 && ev9.isTrusted === false) return; geo[side] = null; if (side === 'o') { w.pickup_lat = null; w.pickup_lng = null; } else { w.delivery_lat = null; w.delivery_lng = null; } });
        });
        attachAddressSuggest(oSt, { onPick: (r) => { setIn(oSt, 'o_street', r.street); setIn(oCi, 'o_city', r.city); setIn(oSa, 'o_state', r.state); setIn(oZp, 'o_zip', r.zip); if (r.lat && r.lng) { geo.o = { lat: r.lat, lng: r.lng }; w.pickup_lat = r.lat; w.pickup_lng = r.lng; w.__direct_miles = null; recalc(); } } });
        attachAddressSuggest(dSt, { onPick: (r) => { setIn(dSt, 'd_street', r.street); setIn(dCi, 'd_city', r.city); setIn(dSa, 'd_state', r.state); setIn(dZp, 'd_zip', r.zip); if (r.lat && r.lng) { geo.d = { lat: r.lat, lng: r.lng }; w.delivery_lat = r.lat; w.delivery_lng = r.lng; w.__direct_miles = null; recalc(); } } });
        // ---- EXTRA STOPS: real addresses, real detour in the route/ETA, each gets its own geofence on the trip ----
        const stopsHost = h('div', { style: 'grid-column:1/-1' });
        if (!Array.isArray(w.stops)) w.stops = [];
        const paintStops = () => {
          // manual-typing fallback: if the broker typed instead of picking a suggestion,
          // geocode the composed address on blur so the pin (✓) still lands.
          const cityFromPin9 = async (sp) => {
            if ((sp.city || '').trim() || !sp.lat) return;
            try {
              const r9 = await fetch('https://photon.komoot.io/reverse?lat=' + sp.lat + '&lon=' + sp.lng + '&limit=1&lang=en');
              const j9 = await r9.json(); const p9 = j9 && j9.features && j9.features[0] && j9.features[0].properties;
              if (p9) { sp.city = p9.city || p9.district || p9.county || ''; if (!sp.state) sp.state = (p9.state || '').length === 2 ? p9.state : sp.state; if (sp.city) paintStops(); }
            } catch (_) {}
          };
          const geocodeStop = async (sp) => {
            if (sp.lat || !((sp.street || '').trim() && (sp.city || '').trim() && (sp.state || '').trim())) return;
            try {
              const q9 = [sp.street, sp.city, sp.state, sp.zip].filter(Boolean).join(', ');
              const r9 = await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q9) + '&limit=1&lang=en&bbox=-125,24,-66.5,49.6');
              const j9 = await r9.json();
              const f9 = j9 && j9.features && j9.features[0];
              if (f9 && f9.geometry && f9.geometry.coordinates) {
                sp.lng = f9.geometry.coordinates[0]; sp.lat = f9.geometry.coordinates[1];
                w.svc_extra_stop = true; paintStops(); recalc();
              }
            } catch (_) {}
          };
          const rows9 = w.stops.map((sp, i9) => {
            const composeAddr9 = () => { sp.address = [sp.street, sp.city, sp.state, sp.zip].filter(Boolean).join(', '); };
            const mkF9 = (key9, ph9, wd9, up9) => {
              const a9 = h('input', { class: 'cp-in', type: 'text', placeholder: ph9, style: 'margin:0;' + (wd9 || 'flex:1;min-width:140px') });
              a9.value = sp[key9] || '';
              if (up9) { a9.maxLength = 2; }
              a9.addEventListener('input', (ev9) => { if (ev9 && ev9.isTrusted === false) return;
                if (up9) a9.value = a9.value.toUpperCase().replace(/[^A-Z]/g, '');
                sp[key9] = a9.value; sp.lat = null; sp.lng = null; composeAddr9(); });
              a9.addEventListener('blur', () => setTimeout(() => geocodeStop(sp), 250));
              return a9;
            };
            const st9 = mkF9('street', 'Street address', 'flex:2;min-width:200px');
            const ci9 = mkF9('city', 'City');
            const sa9 = mkF9('state', 'ST', 'flex:none;width:64px', true);
            const zp9 = mkF9('zip', 'ZIP', 'flex:none;width:90px');
            [st9, ci9, sa9, zp9].forEach((a9) => { a9.autocomplete = 'off'; a9.name = 'lb-stop-' + Math.random().toString(36).slice(2, 8); });
            attachAddressSuggest(st9, { onPick: (r9) => {
              sp.street = r9.street || ''; sp.city = r9.city || ''; sp.state = r9.state || ''; sp.zip = r9.zip || ''; sp.seq = i9 + 1;
              composeAddr9();
              if (r9.lat && r9.lng) { sp.lat = r9.lat; sp.lng = r9.lng; }
              st9.value = sp.street; ci9.value = sp.city; sa9.value = sp.state; zp9.value = sp.zip;
              w.svc_extra_stop = true; paintStops(); recalc();
              if (!sp.city) cityFromPin9(sp);
            } });
            const del9 = h('button', { type: 'button', class: 'cp-btn cp-btn-sm ghost', style: 'flex:none', onClick: () => { w.stops.splice(i9, 1); w.stops.forEach((z9, k9) => { z9.seq = k9 + 1; }); if (!w.stops.length) w.svc_extra_stop = false; paintStops(); recalc(); } }, '✕');
            const kind9 = h('select', { class: 'cp-in', style: 'margin:0;flex:none;max-width:170px' }, [['pickup', '📦 Extra PICKUP (load more)'], ['delivery', '📤 Extra DELIVERY (drop part)']].map(([v9, l9]) => h('option', { value: v9 }, l9)));
            kind9.value = sp.kind || 'delivery'; sp.kind = kind9.value;
            kind9.onchange = () => { sp.kind = kind9.value; paintStops(); };
            const purp9 = h('input', { class: 'cp-in', type: 'text', placeholder: 'Purpose — e.g. drop 6 pallets at Ace Hardware', style: 'margin:0;flex:1' });
            purp9.value = sp.purpose || ''; purp9.oninput = () => { sp.purpose = purp9.value; }; purp9.addEventListener('blur', () => paintStops());
            return h('div', { style: 'margin-top:8px;padding:8px;border:1px dashed #dbe3ee;border-radius:10px' }, [
              h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
                h('span', { style: 'flex:none;font-weight:800;font-size:.8rem;color:#0883F7' }, '📍 ' + (i9 + 1)),
                h('span', { style: 'flex:none;display:flex;flex-direction:column;gap:2px' }, [
                  h('button', { type: 'button', title: 'move earlier in the run', style: 'border:1px solid #dbe3ee;background:#fff;border-radius:6px;font-size:.6rem;padding:1px 6px;cursor:pointer;opacity:' + (i9 === 0 ? '.3' : '1'), onClick: () => { if (i9 === 0) return; const tmp9 = w.stops[i9 - 1]; w.stops[i9 - 1] = w.stops[i9]; w.stops[i9] = tmp9; w.stops.forEach((z9, k9) => { z9.seq = k9 + 1; }); paintStops(); recalc(); } }, '▲'),
                  h('button', { type: 'button', title: 'move later in the run', style: 'border:1px solid #dbe3ee;background:#fff;border-radius:6px;font-size:.6rem;padding:1px 6px;cursor:pointer;opacity:' + (i9 === w.stops.length - 1 ? '.3' : '1'), onClick: () => { if (i9 === w.stops.length - 1) return; const tmp9 = w.stops[i9 + 1]; w.stops[i9 + 1] = w.stops[i9]; w.stops[i9] = tmp9; w.stops.forEach((z9, k9) => { z9.seq = k9 + 1; }); paintStops(); recalc(); } }, '▼'),
                ]), st9, ci9, sa9, zp9,
                (sp.lat && (sp.city || '').trim()) ? h('span', { title: 'pinned — exact GPS geofence set', style: 'flex:none;color:#16a34a;font-weight:800' }, '✓ pinned')
                : sp.lat ? h('span', { title: 'pin set but the city is missing — type it (the board shows City, ST to carriers)', style: 'flex:none;color:#f59e0b;font-size:.78rem;font-weight:700' }, '⚠ add city')
                : h('span', { title: 'pick a suggestion, or fill street+city+ST and click away — the pin sets itself', style: 'flex:none;color:#f59e0b;font-size:.78rem;font-weight:700' }, '… pin pending'), del9]),
              h('div', { style: 'display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap' }, [kind9, purp9]),
              h('div', { class: 'cp-sub', style: 'margin-top:3px' }, 'THIS order is the driver\u2019s run: Main pickup \u2192 stop 1 \u2192 stop 2 \u2192 stop 3 \u2192 Final delivery. Use \u25b2\u25bc to set the real sequence \u2014 the route, miles, ETA and the driver\u2019s turn-by-turn all follow it. (Main pickup is ALWAYS first and final delivery ALWAYS last \u2014 if a pickup must happen before the main one, make THAT the main pickup.)'),
            ]);
          });
          // ---- RUN ORDER: the system ASKS the broker for the sequence, in plain sight ----
          const hav9 = (a9, b9, c9, d9) => { const r9 = (x9) => x9 * Math.PI / 180; return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(r9(c9 - a9) / 2) ** 2 + Math.cos(r9(a9)) * Math.cos(r9(c9)) * Math.sin(r9(d9 - b9) / 2) ** 2)); };
          const pinned9 = w.stops.filter((z9) => z9 && z9.lat);
          const orderCard9 = pinned9.length ? (() => {
            const posSel9 = (sp9) => {
              const sel9 = h('select', { class: 'cp-in', style: 'margin:0;flex:none;width:64px;font-weight:800' }, w.stops.map((_z9, k9) => h('option', { value: String(k9) }, String(k9 + 1))));
              sel9.value = String(w.stops.indexOf(sp9));
              sel9.onchange = () => { const from9 = w.stops.indexOf(sp9); const to9 = Math.max(0, Math.min(w.stops.length - 1, parseInt(sel9.value, 10) || 0));
                w.stops.splice(to9, 0, w.stops.splice(from9, 1)[0]); w.stops.forEach((z9, k9) => { z9.seq = k9 + 1; }); paintStops(); recalc(); };
              return sel9;
            };
            const rowO9 = (icon9, label9, ctrl9, tone9) => h('div', { style: 'display:flex;gap:10px;align-items:center;padding:7px 10px;border-radius:10px;background:' + (tone9 || '#fff') + ';border:1px solid #e2e8f0;margin-top:6px' }, [
              h('span', { style: 'flex:none;font-size:1rem' }, icon9), h('div', { style: 'flex:1;font-size:.85rem;font-weight:700;color:#10223B' }, label9), ctrl9 || null].filter(Boolean));
            const optimize9 = h('button', { type: 'button', class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:8px', onClick: () => {
              if (!(geo.o && geo.d)) { alert('Pin the main pickup & delivery first.'); return; }
              const rest9 = w.stops.slice(); const ordered9 = []; let cur9 = { lat: geo.o.lat, lng: geo.o.lng };
              while (rest9.length) { let bi9 = 0, bd9 = Infinity; rest9.forEach((z9, k9) => { const dd9 = z9.lat ? hav9(cur9.lat, cur9.lng, z9.lat, z9.lng) : Infinity; if (dd9 < bd9) { bd9 = dd9; bi9 = k9; } });
                const nx9 = rest9.splice(bi9, 1)[0]; ordered9.push(nx9); if (nx9.lat) cur9 = { lat: nx9.lat, lng: nx9.lng }; }
              w.stops = ordered9; w.stops.forEach((z9, k9) => { z9.seq = k9 + 1; }); paintStops(); recalc();
            } }, '✨ Suggest shortest-route order');
            const seqTxt9 = ['🅰 ' + (w.o_city || 'Pickup')].concat(w.stops.map((z9, k9) => (z9.kind === 'pickup' ? '📦' : '📤') + (k9 + 1) + ' ' + (z9.city || z9.street || '?'))).concat(['🏁 ' + (w.d_city || 'Delivery')]).join('  →  ');
            return h('div', { style: 'grid-column:1/-1;margin-top:10px;background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:14px;padding:12px 14px' }, [
              h('div', { style: 'font-weight:800;font-size:.92rem;color:#10223B' }, '🔢 Set the RUN ORDER — the driver serves the stops exactly in this sequence'),
              h('div', { class: 'cp-sub', style: 'margin-top:2px' }, 'Main pickup is always FIRST and final delivery always LAST. Pick each stop\u2019s position (1 = right after pickup) — the route, miles, ETA and every arrival time in the next step recalculate instantly.'),
              rowO9('🅰', 'Main PICKUP — ' + ((w.o_city || '') + (w.o_state ? ', ' + w.o_state : '') || 'set in the fields above'), h('span', { class: 'cp-pill', style: 'background:#dbeafe;color:#1d4ed8' }, 'always 1st'), '#eff6ff'),
              ...w.stops.map((sp9, k9) => {
                const kindSel9 = h('select', { class: 'cp-in', style: 'margin:0;flex:none;width:150px;font-size:.78rem;font-weight:800' }, [['pickup', '📦 Extra PICKUP'], ['delivery', '📤 Extra DELIVERY']].map(([v9, l9]) => h('option', { value: v9 }, l9)));
                kindSel9.value = sp9.kind || 'delivery';
                kindSel9.onchange = () => { sp9.kind = kindSel9.value; paintStops(); };
                return h('div', { style: 'display:flex;gap:10px;align-items:center;padding:7px 10px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;margin-top:6px;flex-wrap:wrap' }, [
                  h('span', { style: 'flex:none;font-weight:900;color:#0883F7' }, String(k9 + 1) + '.'),
                  kindSel9,
                  h('div', { style: 'flex:1;min-width:160px;font-size:.85rem;font-weight:700;color:#10223B' }, ((sp9.city ? sp9.city + (sp9.state ? ', ' + sp9.state : '') : sp9.street || 'stop ' + (k9 + 1))) + (sp9.purpose ? ' · ' + sp9.purpose : '')),
                  h('span', { class: 'cp-sub', style: 'flex:none' }, 'position:'),
                  posSel9(sp9),
                ]);
              }),
              rowO9('🏁', 'Final DELIVERY — ' + ((w.d_city || '') + (w.d_state ? ', ' + w.d_state : '') || 'set in the fields above'), h('span', { class: 'cp-pill', style: 'background:#ffedd5;color:#c2410c' }, 'always last'), '#fff7ed'),
              w.stops.length > 1 ? optimize9 : null,
              h('div', { class: 'cp-sub', style: 'margin-top:8px;font-weight:700' }, seqTxt9),
              (() => { // LANE FIT: extra stops must live on the main corridor — otherwise it's a separate load
                const tot9 = Number(w.miles) || 0, dir9 = Number(w.__direct_miles) || 0;
                if (!(tot9 && dir9 && pinned9.length)) return null;
                const extra9 = Math.max(0, tot9 - dir9); const pct9 = Math.round(extra9 / dir9 * 100);
                if (pct9 > 75 || extra9 > 400) {
                  w.__lane_block = true;
                  return h('div', { style: 'margin-top:8px;background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:9px 12px;font-size:.83rem;color:#b91c1c;font-weight:700' },
                    '🚫 This is NOT one lane: the stops add ' + extra9 + ' mi (+' + pct9 + '%) over the direct ' + dir9 + ' mi route. A carrier will not run this as one trip — post the far-off freight as its OWN load (it will match a truck already heading that way). Remove the off-lane stop to continue.');
                }
                w.__lane_block = false;
                if (pct9 > 35 && extra9 > 150) {
                  return h('div', { style: 'margin-top:8px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:9px 12px;font-size:.83rem;color:#92400e;font-weight:700' },
                    '⚠ Big detour: +' + extra9 + ' mi (+' + pct9 + '%) vs the direct route. Carriers may skip it or want a higher rate — consider ✨ shortest-route order, or post the far stop as a separate load.');
                }
                return h('div', { class: 'cp-sub', style: 'margin-top:6px;color:#0f766e' }, '✓ Lane fit: detour +' + extra9 + ' mi (+' + pct9 + '%) vs direct — fine for one multi-stop run.');
              })(),
            ].filter(Boolean));
          })() : null;
          mount(stopsHost, h('div', null, [
            h('div', { class: 'cp-sub', style: 'font-weight:700;color:#10223B;margin-top:8px' }, '➕ Extra stops (optional — multi-stop load)'),
            ...rows9,
            orderCard9,
            (w.stops.length < 3) ? h('button', { type: 'button', class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:6px', onClick: () => { w.stops.push({ seq: w.stops.length + 1, address: '' }); paintStops(); } }, '+ Add extra stop') : null,
            w.stops.length ? h('div', { class: 'cp-sub', style: 'margin-top:4px' }, '$' + (w.acc_extra_stop || '100') + '/stop pays the carrier per the rate card · the detour is added to the real driving miles and the delivery ETA below · each stop gets its own GPS geofence, detention clock and stop-off fee on the trip.') : null,
          ].filter(Boolean)));
        };
        paintStops();
        body.appendChild(stopsHost);
        // ---- AGENT-POSTED LOAD: the SOURCE of this freight is mandatory (who really pays) ----
        if (window.__lbAgentOrg) {
          const srcF = (lbl9, key9, ph9) => { const i9 = h('input', { class: 'cp-in', type: 'text', placeholder: ph9 || '', style: 'margin:0;flex:1;min-width:180px' }); i9.value = w[key9] || ''; i9.oninput = () => { w[key9] = i9.value; }; return h('div', { style: 'flex:1;min-width:200px' }, [h('label', { class: 'cp-lbl' }, lbl9), i9]); };
          const srcSel = h('select', { class: 'cp-in', style: 'margin:0' }, [['', 'Where is this load from? *'], ['my_broker', 'My referred broker'], ['other_broker', 'Another broker'], ['shipper_direct', 'Shipper direct']].map(([v9, l9]) => h('option', { value: v9 }, l9)));
          // per-source guidance: brokers have an MC# + rate con; a direct shipper has neither — their PO/contract + AP contact is the proof
          const srcHint9 = h('div', { class: 'cp-sub', style: 'margin-top:8px;font-weight:600' }, '');
          const SRC_HINTS9 = {
            my_broker: '📄 Proof due in 2h: the broker\u2019s RATE CONFIRMATION + their billing (AP) contact.',
            other_broker: '📄 Proof due in 2h: that broker\u2019s RATE CONFIRMATION (with their MC#) + billing contact.',
            shipper_direct: '📄 Shipper direct = no broker, no MC#. Proof due in 2h: the shipper\u2019s PO / signed contract / load tender email + their accounts-payable contact. Best margin — no broker in the middle.',
          };
          const syncSrc9 = () => { w.src_type = srcSel.value; try { srcMcWrap9.style.display = srcSel.value === 'shipper_direct' ? 'none' : ''; } catch (_) {} srcHint9.textContent = SRC_HINTS9[srcSel.value] || ''; };
          srcSel.value = w.src_type || ''; srcSel.onchange = syncSrc9;
          body.appendChild(h('div', { style: 'grid-column:1/-1;margin-top:12px;background:#fff7ed;border:1.5px solid #fdba74;border-radius:14px;padding:12px 14px' }, [
            h('div', { style: 'font-weight:800;color:#c2410c' }, '🧾 LOAD SOURCE — required for agent-posted loads'),
            h('div', { class: 'cp-sub', style: 'margin:3px 0 8px' }, 'You are posting as an AGENT: name the real broker/shipper who pays this load. Dispatch verifies it, and their rate confirmation + billing contact are due within 2 HOURS of posting (overdue pauses your postings). Wrong/fake source = program termination.'),
            h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
              h('div', { style: 'flex:1;min-width:200px' }, [h('label', { class: 'cp-lbl' }, 'Source type *'), srcSel]),
              srcF('Source company name *', 'src_company', 'e.g. Apex Logistics LLC'),
              (() => { const w9 = srcF('Source MC / DOT # (brokers)', 'src_mc', 'e.g. MC-123456'); window.__srcMcTmp9 = w9; return w9; })(),
              srcF('Source contact name *', 'src_contact', ''),
              srcF('Source email *', 'src_email', 'ap@company.com'),
              srcF('Source phone', 'src_phone', ''),
            ]),
            srcHint9,
          ]));
          const srcMcWrap9 = window.__srcMcTmp9; delete window.__srcMcTmp9;
          syncSrc9();
        }
        body.appendChild(h('div', { class: 'cp-sub', style: 'grid-column:1/-1' }, '🇺🇸 Type the street address and pick a suggestion — city, state and ZIP fill in, real driving miles calculate automatically and the exact pin powers GPS tracking. Carriers on the board see only the City, ST; the full address goes on the rate confirmation after booking.'));
      } catch (_) {}
    }
    else if (step === 1) {
      // auto-deduce: if delivery date empty, suggest pickup + real drive time (+2h dock buffer)
      if (!w.delivery_date && w.pickup_date && w.__drive_hours) {
        try {
          const base = new Date(w.pickup_date + 'T' + ((w.sched_pu === 'Appointment' ? w.pu_appt : (w.pickup_window || '').slice(0, 5)) || '08:00'));
          const hos9 = w.__drive_hours + Math.floor(w.__drive_hours / 11) * 10; // 11h driving max, then 10h rest (federal HOS)
          const dock9 = 2 + ((Array.isArray(w.stops) ? w.stops.filter((sp) => sp && sp.lat).length : 0) * 2); // 2h dock buffer per extra stop
          const eta = new Date(base.getTime() + (hos9 + dock9) * 3600 * 1000);
          w.delivery_date = eta.toISOString().slice(0, 10);
          w.__eta_suggested = true;
        } catch (_) {}
      }
      const tRange = (label, key) => {
        const a = h('input', { class: 'cp-in', type: 'time', style: 'margin:0;flex:1' });
        const b = h('input', { class: 'cp-in', type: 'time', style: 'margin:0;flex:1' });
        const m9 = String(w[key] || '').match(/(\d{1,2}:\d{2})\s*[\u2013-]\s*(\d{1,2}:\d{2})/);
        if (m9) { a.value = ('0' + m9[1]).slice(-5); b.value = ('0' + m9[2]).slice(-5); }
        const upd = () => { w[key] = (a.value && b.value) ? (a.value + '\u2013' + b.value) : ''; };
        a.oninput = upd; b.oninput = upd;
        return field(label, h('div', { style: 'display:flex;gap:8px;align-items:center' }, [a, h('span', { class: 'cp-sub', style: 'flex:0 0 auto' }, 'to'), b]));
      };
      const tOne = (label, key) => { const a = h('input', { class: 'cp-in', type: 'time', style: 'margin:0' }); a.value = w[key] || ''; a.oninput = () => { w[key] = a.value; }; return field(label, a); };
      const modeSel = (key) => {
        const mk = (v9, ttl, sub9) => { const on = w[key] === v9; return h('button', { type: 'button', onClick: () => { w[key] = v9; renderStep(); },
          style: 'flex:1;min-width:190px;text-align:left;border-radius:14px;padding:11px 14px;cursor:pointer;border:2px solid ' + (on ? '#0883F7' : '#e2e8f0') + ';background:' + (on ? '#eff6ff' : '#fff') }, [
          h('div', { style: 'font-weight:800;font-size:.84rem;color:#10223B' }, (on ? '\u25c9 ' : '\u25cb ') + ttl),
          h('div', { class: 'cp-sub', style: 'margin-top:2px' }, sub9),
        ]); };
        return h('div', { style: 'grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap' }, [
          mk('FCFS', 'FCFS \u2014 first come, first served', 'Truck can arrive ANY time inside the window \u2014 dock works the line in arrival order. Most flexible for carriers.'),
          mk('Appointment', 'Appointment \u2014 fixed time', 'Truck must arrive at the exact appointed time. Late = risk of rescheduling/detention rules.'),
        ]);
      };
      body = h('div', { class: 'cp-formgrid' }, [
        h('div', { class: 'cp-sub', style: 'grid-column:1/-1;font-weight:700;color:#10223B' }, '\ud83d\udce6 Pickup \u2014 how does the shipper schedule trucks?'),
        modeSel('sched_pu'),
        wi('Pickup date *', 'pickup_date', 'date'),
        w.sched_pu === 'Appointment' ? tOne('Pickup appointment time *', 'pu_appt') : (w.sched_pu === 'FCFS' ? tRange('FCFS window \u2014 dock open from \u2192 to *', 'pickup_window') : null),
        h('div', { class: 'cp-sub', style: 'grid-column:1/-1;font-weight:700;color:#10223B;margin-top:6px' }, '\ud83c\udfc1 Delivery \u2014 how does the receiver schedule trucks?'),
        modeSel('sched_del'),
        wi('Delivery date *', 'delivery_date', 'date'),
        w.sched_del === 'Appointment' ? tOne('Delivery appointment time *', 'del_appt') : (w.sched_del === 'FCFS' ? tRange('FCFS window \u2014 dock open from \u2192 to *', 'delivery_window') : null),
        // ---- per-EXTRA-STOP scheduling: same FCFS/Appointment discipline as the main docks ----
        ...((Array.isArray(w.stops) && w.stops.length) ? w.stops.map((sp8, i8) => {
          const kindLbl8 = sp8.kind === 'pickup' ? '\u{1F4E6} Extra PICKUP' : '\u{1F4E4} Extra DELIVERY';
          const mk8 = (v8, tl8, sb8) => { const on8 = (sp8.sched || 'FCFS') === v8;
            return h('div', { style: 'flex:1;min-width:200px;border:2px solid ' + (on8 ? '#0883F7' : '#e2e8f0') + ';border-radius:12px;padding:10px 12px;cursor:pointer;background:' + (on8 ? '#eff6ff' : '#fff'), onClick: () => { sp8.sched = v8; renderStep(); } }, [
              h('div', { style: 'font-weight:800;font-size:.85rem' }, (on8 ? '\u25c9 ' : '\u25cb ') + tl8), h('div', { class: 'cp-sub', style: 'margin-top:2px' }, sb8)]); };
          const d8 = h('input', { class: 'cp-in', type: 'date', style: 'margin:0' }); d8.value = sp8.date || ''; d8.onchange = () => { sp8.date = d8.value; };
          const t8a = h('input', { class: 'cp-in', type: 'time', style: 'margin:0' }); t8a.value = sp8.time || ''; t8a.onchange = () => { sp8.time = t8a.value; };
          const t8f = h('input', { class: 'cp-in', type: 'time', style: 'margin:0;flex:1' }); const t8t = h('input', { class: 'cp-in', type: 'time', style: 'margin:0;flex:1' });
          const wparts8 = String(sp8.window || '').split('\u2013'); t8f.value = wparts8[0] || ''; t8t.value = wparts8[1] || '';
          const syncW8 = () => { sp8.window = (t8f.value && t8t.value) ? t8f.value + '\u2013' + t8t.value : ''; };
          t8f.onchange = syncW8; t8t.onchange = syncW8;
          return h('div', { style: 'grid-column:1/-1;border:1px dashed #c7d4e8;border-radius:14px;padding:10px 12px;margin-top:4px' }, [
            h('div', { class: 'cp-sub', style: 'font-weight:800;color:#10223B' }, kindLbl8 + ' ' + (i8 + 1) + ' \u2014 ' + ((sp8.address || '').split(',').slice(0, 2).join(',') || 'set the address in step 1') + (sp8.purpose ? ' \u00b7 ' + sp8.purpose : '')),
            h('div', { style: 'display:flex;gap:10px;margin-top:6px;flex-wrap:wrap' }, [
              mk8('FCFS', 'FCFS \u2014 window', 'any time inside the window \u2014 dock works the line'),
              mk8('Appointment', 'Appointment \u2014 fixed time', 'exact appointed time'),
            ]),
            h('div', { style: 'display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;align-items:center' }, [
              field('Stop date *', d8),
              (sp8.sched || 'FCFS') === 'Appointment' ? field('Appointment time *', t8a) : h('div', { style: 'flex:1;min-width:220px' }, [h('div', { class: 'cp-sub', style: 'font-weight:700;margin-bottom:3px' }, 'FCFS window \u2014 from \u2192 to *'), h('div', { style: 'display:flex;gap:8px' }, [t8f, t8t])]),
            ]),
            (() => { // earliest realistic arrival at THIS stop (drive time + HOS + earlier docks)
              try {
                if (!w.pickup_date || !w.__drive_hours) return null;
                const pinned8 = w.stops.filter((z8) => z8 && z8.lat);
                const pos8 = pinned8.indexOf(sp8); if (pos8 < 0) return null;
                const legs8 = (Array.isArray(w.__leg_hours) && w.__leg_hours.length === pinned8.length + 1) ? w.__leg_hours : null;
                let cum8 = 0; for (let k8 = 0; k8 <= pos8; k8++) cum8 += legs8 ? legs8[k8] : (w.__drive_hours / (pinned8.length + 1));
                const hos8 = w.team_required ? cum8 : cum8 + Math.floor(cum8 / 11) * 10;
                const base8 = new Date(w.pickup_date + 'T' + ((w.sched_pu === 'Appointment' ? w.pu_appt : (w.pickup_window || '').slice(0, 5)) || '08:00'));
                const ea8 = new Date(base8.getTime() + (hos8 * 0.95 + pos8 * 2) * 3600 * 1000);
                if (!sp8.date) { sp8.date = ea8.toISOString().slice(0, 10); d8.value = sp8.date; }
                return h('div', { class: 'cp-sub', style: 'margin-top:5px;color:#0f766e' }, '\u23f1 Earliest realistic arrival here: ' + ea8.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (~' + Math.round(cum8) + 'h driving from pickup' + (w.team_required ? ', TEAM nonstop' : ' + HOS rest') + (pos8 ? ' + earlier dock time' : '') + ') \u2014 date auto-suggested, adjust as needed.');
              } catch (_) { return null; }
            })(),
          ]);
        }) : []),
        (() => {
          const tx8 = (label8, key8, ph8) => { const a8 = h('input', { class: 'cp-in', type: 'text', placeholder: ph8 || '', style: 'margin:0' }); a8.value = w[key8] || ''; a8.oninput = () => { w[key8] = a8.value; }; return field(label8, a8); };
          return h('div', { style: 'grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:6px' }, [
            tx8('Pickup dock contact (optional \u2014 goes to the driver)', 'fac_pu', 'e.g. Shipping office \u00b7 (414) 555-0192'),
            tx8('Delivery dock contact (optional \u2014 goes to the driver)', 'fac_del', 'e.g. Receiving \u00b7 (404) 555-0138'),
          ]);
        })(),
      ].filter(Boolean));
      try {
        const today = new Date().toISOString().slice(0, 10);
        body.querySelectorAll('input').forEach(i9 => { if (i9.type === 'date') i9.min = today; });
        if (w.__drive_hours) {
          const nStops9 = Array.isArray(w.stops) ? w.stops.filter((sp) => sp && sp.lat).length : 0;
          const hos9 = w.__drive_hours + Math.floor(w.__drive_hours / 11) * 10 + nStops9 * 2;
          const days9 = Math.max(1, Math.ceil(hos9 / 24));
          body.appendChild(h('div', { style: 'grid-column:1/-1;background:#eff6ff;border:1px solid #dbeafe;border-radius:12px;padding:9px 13px;font-size:.8rem;color:#1e40af' },
            w.team_required
              ? '\ud83d\udc65 TEAM load: ~' + Math.round(w.__drive_hours) + 'h NONSTOP driving (two drivers swap \u2014 no HOS overnight stops). Tight delivery windows are allowed.'
              : '\ud83d\ude9a Real trip duration: ~' + Math.round(w.__drive_hours) + 'h driving' + (nStops9 ? ' (route includes ' + nStops9 + ' extra stop' + (nStops9 > 1 ? 's' : '') + ' + 2h dock each)' : '') + ' \u00b7 with federal HOS rest rules (max 11h driving, then 10h rest) this is a ' + days9 + '-day trip. The system will not accept a delivery window earlier than that.'));
          body.appendChild(h('button', { type: 'button', class: 'cp-btn cp-btn-sm ' + (w.team_required ? '' : 'ghost'), style: 'grid-column:1/-1', onClick: () => { w.team_required = !w.team_required; renderStep(); } },
            w.team_required ? '\ud83d\udc65 TEAM drivers: ON \u2014 nonstop driving \u00b7 tap to switch back to solo' : '\ud83d\udc65 Need it faster? Require TEAM drivers (2 drivers, nonstop \u2014 books at +20\u201330%)'));
        }
        if (w.__eta_suggested) { body.appendChild(h('div', { class: 'cp-sub', style: 'grid-column:1/-1;color:#0f766e' }, '\ud83e\udde0 Delivery date auto-suggested from the real driving time (' + Math.round(w.__drive_hours) + 'h) + dock buffer \u2014 adjust if you need.')); w.__eta_suggested = false; }
        body.appendChild(h('div', { class: 'cp-sub', style: 'grid-column:1/-1' }, '\u23f1 One choice per stop \u2014 FCFS window or exact appointment. This is exactly what the carrier sees on the board and what goes on the rate confirmation; no separate \u201cfacility hours\u201d to fill.'));
      } catch (_) {}
    }
    else if (step === 2) {
      const sl = (label, key, opts2, onch) => { const sel = h('select', { class: 'cp-in' }, [h('option', { value: '' }, label)].concat(opts2.map(o => h('option', { value: o }, o)))); sel.value = w[key] || ''; sel.onchange = () => { w[key] = sel.value; if (onch) onch(); }; return field(label, sel); };
      const isReefer = (w.equipment || '') === 'Reefer';
      const isFlat = ['Flatbed', 'Step Deck', 'Conestoga', 'Hotshot'].indexOf(w.equipment || '') >= 0;
      body = h('div', null, [
        h('div', { class: 'cp-formgrid' }, [
          sl('Equipment *', 'equipment', ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Conestoga', 'Power Only', 'Box Truck', 'Hotshot'], () => renderStep()),
          (directCarrier && w.equipment) ? (() => {
            const hint9 = h('div', { class: 'cp-sub', style: 'grid-column:1/-1' }, '\ud83c\udfaf Checking ' + directCarrier.name + '\u2019s equipment\u2026');
            (async () => {
              const eqs9 = await dirCarrierEq(directCarrier.id);
              if (!hint9.isConnected) return;
              if (eqs9 === null) { hint9.textContent = ''; return; }
              if (!eqs9.length) { hint9.style.color = '#b45309'; hint9.textContent = '\u26a0 ' + directCarrier.name + ' has not published any equipment yet \u2014 the direct offer may not match. Consider picking a carrier from the Carriers page.'; return; }
              if (eqs9.some(e => e.toLowerCase() === w.equipment.toLowerCase())) { hint9.style.color = '#0f766e'; hint9.textContent = '\u2713 ' + directCarrier.name + ' runs ' + w.equipment + ' \u2014 good match.'; }
              else { hint9.style.color = '#b91c1c'; hint9.textContent = '\u2715 ' + directCarrier.name + ' does NOT run ' + w.equipment + ' \u2014 their fleet: ' + eqs9.join(', ') + '. Change the equipment or remove the direct target.'; }
            })();
            return hint9;
          })() : null,
          sl('Load size *', 'load_size', ['Full truckload (FTL)', 'Partial (LTL)']),
          (() => {
            const i = inp('Start typing… e.g. frozen chicken, steel coils, drywall', 'text');
            i.value = w.commodity || ''; i.setAttribute('data-fkey', 'commodity'); i.setAttribute('list', 'lb_comm_list'); i.setAttribute('autocomplete', 'off');
            i.oninput = () => { w.commodity = i.value; let cc = null; try { cc = i.selectionStart; } catch (_) {} renderStepFocus('commodity', cc); };
            return field('Commodity * (pick from the list or type your own)', i);
          })(),
          h('datalist', { id: 'lb_comm_list' }, suggestCommodities(w.commodity, 15).map(n => h('option', { value: n }))),
          (() => {
            // commodity → equipment suggester (soft: one-tap switch, warns on clear mismatch)
            const c = (w.commodity || '').toLowerCase();
            if (c.trim().length < 3) return null;
            const RULES = [
              { eq: 'Reefer', strong: true, kw: ['frozen', 'ice cream', 'ice-cream', 'gelato', 'popsicle', 'produce', 'perishable', 'refriger', 'chilled', 'cold chain', 'cold-chain', 'temperature control', 'temperature-controlled', 'temp control', 'temp-controlled', 'meat', 'beef', 'pork', 'poultry', 'chicken', 'turkey', 'bacon', 'sausage', 'deli meat', 'seafood', 'fish', 'shrimp', 'lobster', 'crab', 'salmon', 'tuna', 'dairy', 'milk', 'cheese', 'yogurt', 'yoghurt', 'egg', 'vaccine', 'pharmaceutical', 'medicine', 'insulin', 'biologic', 'flowers', 'floral', 'nursery stock', 'strawberr', 'blueberr', 'raspberr', 'berries', 'lettuce', 'spinach', 'broccoli', 'celery', 'citrus', 'melon', 'avocado', 'fresh fruit', 'fresh vegetable', 'fresh produce', 'frozen food', 'frozen meal', 'cold cut'] },
              { eq: 'Step Deck', strong: false, kw: ['excavator', 'bulldozer', 'backhoe', 'wheel loader', 'skid steer', 'skid-steer', 'forklift', 'boom lift', 'scissor lift', 'harvester', 'combine', 'farm tractor', 'agricultural machinery', 'ag equipment', 'cnc machine', 'construction equipment', 'heavy equipment', 'heavy machinery', 'over height', 'over-height', 'oversize', 'oversized', 'paving equipment', 'road roller'] },
              { eq: 'Flatbed', strong: true, kw: ['steel', 'coil', 'rebar', 'i-beam', 'h-beam', 'girder', 'lumber', 'timber', 'plywood', 'osb board', 'drywall', 'sheetrock', 'pipe', 'piping', 'tubing', 'conduit', 'building material', 'construction material', 'concrete', 'cement', 'precast', 'brick', 'cinder block', 'concrete block', 'masonry', 'roofing', 'shingle', 'granite', 'marble', 'stone slab', 'structural', 'sheet metal', 'scrap metal', 'utility pole', 'guardrail', 'fencing', 'scaffold', 'truss', 'decking', 'siding', 'aggregate', 'asphalt', 'machinery', 'generator', 'transformer', 'tractor'] },
              { eq: 'Box Truck', strong: false, kw: ['last mile', 'last-mile', 'final mile', 'local delivery', 'white glove'] },
            ];
            let sugEq = null;
            const dbm = lookupCommodity(w.commodity);
            if (dbm) sugEq = dbm.eq;
            if (!sugEq) { for (const r of RULES) { if (r.kw.some(k => c.indexOf(k) >= 0)) { sugEq = r.eq; break; } } }
            const HZ = ['gasoline', 'diesel fuel', 'propane', 'butane', 'lpg', 'flammable', 'explosive', 'ammonia', 'chlorine', 'lithium', 'battery', 'batteries', 'paint', 'solvent', 'corrosive', ' acid', 'caustic', 'hazmat', 'hazardous', 'chemical', 'aerosol', 'oxidizer', 'radioactive', 'compressed gas', 'cryogenic', 'fireworks', 'ammunition', 'petroleum', 'ethanol', 'methanol', 'pesticide', 'fungicide', 'sulfuric'];
            const looksHz = HZ.some(k => c.indexOf(k) >= 0);
            const out = [];
            if (sugEq && sugEq !== w.equipment) {
              out.push(h('div', { style: 'grid-column:1/-1;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;border-radius:12px;padding:10px 13px;font-size:.83rem;background:#eff6ff;border:1px solid #dbeafe;color:#1e40af' }, [
                h('span', null, '💡 “' + (w.commodity || '') + '” often ships on a ' + sugEq + (w.equipment ? ' — you picked ' + w.equipment + '. Switch if that fits.' : '.')),
                h('button', { type: 'button', class: 'cp-btn cp-btn-sm', style: 'white-space:nowrap', onClick: () => { w.equipment = sugEq; renderStep(); } }, 'Switch to ' + sugEq)]));
            } else if (!sugEq && (c.indexOf('food') >= 0 || c.indexOf('grocery') >= 0 || c.indexOf('beverage') >= 0) && w.equipment === 'Dry Van') {
              out.push(h('div', { style: 'grid-column:1/-1;background:#eff6ff;border:1px solid #dbeafe;color:#1e40af;border-radius:12px;padding:10px 13px;font-size:.83rem' }, [
                h('span', null, '💡 Fresh / frozen / chilled food needs a '),
                h('a', { style: 'font-weight:800;color:#0883F7;cursor:pointer', onClick: () => { w.equipment = 'Reefer'; renderStep(); } }, 'Reefer'),
                h('span', null, ' — canned, packaged or dry goods are fine on Dry Van.')]));
            }
            if (looksHz && w.hazmat_sel !== 'yes') {
              out.push(h('div', { style: 'grid-column:1/-1;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:12px;padding:9px 13px;font-size:.82rem' }, '☢ This looks hazmat — you’ll declare it (UN #, hazard class) in the Rate card step, and only hazmat-certified carriers will see it.'));
            }
            return out.length ? h('div', { style: 'grid-column:1/-1;display:grid;gap:8px' }, out) : null;
          })(),
          wi('Weight (lb) *', 'weight', 'number'),
          wi('Pallets / pieces', 'pallets'),
          wi('Rate ($) *', 'rate', 'number', true),
          (() => {
            // \ud83d\udca1 market-rate suggester: LoadBoot baseline $/mi by equipment \u00d7 distance band \u00d7 service premiums.
            // Baselines are overridable from CC via cc_rate_standards keys (rpm_dry_van, rpm_reefer, ...).
            const mi9 = Number(w.miles) || 0;
            if (!w.equipment || mi9 <= 0) return null;
            const BASE = { 'Dry Van': 2.05, 'Reefer': 2.40, 'Flatbed': 2.55, 'Step Deck': 2.65, 'Conestoga': 2.70, 'Power Only': 1.85, 'Box Truck': 1.60, 'Hotshot': 2.00 };
            // industry MINIMUM $/mi (2026: owner-operator cost floor ~$1.80\u20132.00 + margin) \u2014 suggestions never go below this
            const FLOOR = { 'Dry Van': 2.00, 'Reefer': 2.50, 'Flatbed': 2.50, 'Step Deck': 2.55, 'Conestoga': 2.60, 'Power Only': 1.80, 'Box Truck': 1.55, 'Hotshot': 2.00 };
            let rpm0 = BASE[w.equipment] || 2.10; let liveN = 0;
            let floor0 = FLOOR[w.equipment] || 2.00;
            // LIVE platform-booking layer is GATED OFF until marketplace volume is meaningful.
            // Until accepted bookings per equipment reach LIVE_MIN_N within 30 days, the estimate
            // uses market/baseline lane rates only (no "LIVE · N bookings" badge, no thin-sample skew).
            // To switch it back on once volume grows, lower LIVE_MIN_N (e.g. to 8–12).
            const LIVE_MIN_N = 9999;
            try { const lv = w.__mkt && w.__mkt[w.equipment]; if (lv && Number(lv.rpm) > 0 && Number(lv.n) >= LIVE_MIN_N) { rpm0 = Math.max(Number(lv.rpm), floor0); liveN = Number(lv.n); } } catch (_) {}
            try { const f9 = 'floor_' + w.equipment.toLowerCase().replace(/[^a-z]+/g, '_'); if (w.__stds && w.__stds[f9]) floor0 = Number(w.__stds[f9]) || floor0; } catch (_) {}
            try { const k9 = 'rpm_' + w.equipment.toLowerCase().replace(/[^a-z]+/g, '_'); if (w.__stds && w.__stds[k9]) rpm0 = Number(w.__stds[k9]) || rpm0; } catch (_) {}
            const distF = mi9 < 250 ? 1.35 : mi9 < 500 ? 1.15 : mi9 <= 1000 ? 1.0 : 0.92;
            let svcF = 1;
            if (w.team_required) svcF *= 1.25;
            if (w.hazmat_sel === 'yes') svcF *= 1.15;
            const flAdj = floor0 * svcF; // service premiums raise the floor too
            const lo9 = Math.max(rpm0 * distF * svcF * 0.93, flAdj), hi9 = Math.max(rpm0 * distF * svcF * 1.07, flAdj * 1.08);
            const mid9 = Math.max(Math.round((rpm0 * distF * svcF * mi9) / 25) * 25, Math.ceil((flAdj * mi9) / 25) * 25);
            w.__rpm_floor = flAdj; w.__rpm_floor_eq = w.equipment;
            const cur9 = Number(w.rate) || 0;
            const tone9 = !cur9 ? '#1e40af' : cur9 < lo9 * mi9 ? '#b45309' : cur9 > hi9 * mi9 * 1.15 ? '#0f766e' : '#166534';
            const wrap9 = h('div', { style: 'grid-column:1/-1;background:#eff6ff;border:1px solid #dbeafe;border-radius:12px;padding:9px 13px;font-size:.8rem;color:' + tone9 }, [
              liveN ? h('span', { style: 'display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:2px 9px;font-size:.64rem;font-weight:800;margin-right:6px' }, '\ud83d\udfe2 LIVE \u00b7 ' + liveN + ' bookings/30d') : null,
              h('span', null, '\ud83d\udca1 Market estimate for ' + w.equipment + ' \u00b7 ' + mi9.toLocaleString() + ' mi' + (w.team_required ? ' \u00b7 TEAM +25%' : '') + (w.hazmat_sel === 'yes' ? ' \u00b7 HAZMAT +15%' : '') + ': '),
              h('b', null, '$' + Math.round(lo9 * mi9).toLocaleString() + ' \u2013 $' + Math.round(hi9 * mi9).toLocaleString()),
              h('span', null, ' ($' + lo9.toFixed(2) + '\u2013' + hi9.toFixed(2) + '/mi)  '),
              h('button', { type: 'button', class: 'cp-btn cp-btn-sm', style: 'margin-left:6px;padding:3px 12px', onClick: () => { w.rate = String(mid9); renderStep(); } }, 'Use $' + mid9.toLocaleString()),
              (cur9 && cur9 < lo9 * mi9) ? h('div', { class: 'cp-sub', style: 'color:#b45309;margin-top:4px' }, '\u26a0 Your $' + cur9.toLocaleString() + ' is under the estimated market range \u2014 under-priced loads sit unbooked.') : null,
              h('div', { class: 'cp-sub', style: 'margin-top:3px' }, 'Estimate from LoadBoot baseline lane rates + distance/equipment/service adjustments, hard-floored at the industry minimum ($' + flAdj.toFixed(2) + '/mi for ' + w.equipment + (svcF > 1 ? ' incl. service premium' : '') + ') \u2014 the suggestion can never be below what carriers accept. A guide, not a quote.'),
            ].filter(Boolean));
            try {
              const lk9 = [w.o_state, w.d_state, w.equipment, mi9].join('|');
              if (w.__lane && w.__lane_key === lk9 && w.__lane.buy) {
                const L9 = w.__lane;
                wrap9.appendChild(h('div', { style: 'margin-top:7px;padding-top:7px;border-top:1px dashed #bfdbfe;display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
                  h('b', null, '\ud83d\udcc8 Lane rate ' + (L9.o_state || '') + '\u2192' + (L9.d_state || '') + ' (' + L9.confidence + '):'),
                  ...(['low', 'avg', 'high'].map(k9 => L9.buy['flat_' + k9] ? h('button', { type: 'button', class: 'cp-btn cp-btn-sm ' + (k9 === 'avg' ? '' : 'ghost'), style: 'padding:3px 11px;font-size:.72rem', onClick: () => { w.rate = String(L9.buy['flat_' + k9]); renderStep(); } }, k9.toUpperCase() + ' $' + Number(L9.buy['flat_' + k9]).toLocaleString()) : null).filter(Boolean)),
                  h('span', { class: 'cp-sub' }, 'sell-side guide $' + L9.sell.avg + '/mi (+' + L9.margin_pct + '%)'),
                ]));
              } else if (w.o_state && w.d_state && !w.__laneP) {
                w.__laneP = true;
                (async () => { try { w.__lane = await laneRate(w.o_state, w.d_state, w.equipment, mi9); w.__lane_key = lk9; } catch (_) {} w.__laneP = false; try { renderStep(); } catch (_) {} })();
              }
            } catch (_) {}
            if (!w.__stds && !w.__stds_p) { w.__stds_p = true; (async () => { try { const m9 = {}; ((await rateStandards()) || []).forEach(r9 => { m9[r9.key] = r9.value; }); w.__stds = m9; } catch (_) {} try { w.__mkt = (await marketRpm()) || {}; } catch (_) {} })(); }
            return wrap9;
          })(),
          (w.team_required && w.rate && w.miles && Number(w.miles) > 0) ? (() => {
            const tRpm = Number(w.rate) / Number(w.miles);
            const TEAM_MIN_RPM = 2.20; // solo-level floor; team freight should sit 20\u201330% above this
            const under = tRpm < TEAM_MIN_RPM;
            return h('div', { class: 'cp-sub', style: 'grid-column:1/-1;color:' + (under ? '#b45309' : '#0f766e') },
              (under
                ? '\ud83d\udc65 \u26a0 TEAM pricing check: $' + tRpm.toFixed(2) + '/mi is solo-level \u2014 team freight books at solo +20\u201330% (\u2248 +$0.40\u20130.60/mi), so team loads at this rate sit unbooked.'
                : '\ud83d\udc65 \u2713 TEAM pricing check: $' + tRpm.toFixed(2) + '/mi looks healthy for team freight \u2014 20\u201330% above solo, as it should be.'));
          })() : null,
          wi('Cargo value ($ \u2014 carrier checks cargo insurance)', 'cargo_value', 'number'),
          isReefer ? wi('Temperature (\u00b0F) \u2014 required for reefer *', 'temperature') : null,
          isFlat ? sl('Tarps', 'tarps', ['No tarps needed', '4 ft tarps', '6 ft tarps', '8 ft tarps']) : null,
          sl('Pickup loading *', 'load_method_pickup', ['Live load', 'Drop & hook', 'Preloaded trailer'], () => renderStep()),
          sl('Delivery unloading *', 'load_method_delivery', ['Live unload', 'Drop trailer'], () => renderStep()),
        ].filter(Boolean)),
        (() => {
          // per-stop freight handling — lumper (fee) and/or driver assist can occur at EITHER stop
          const rt = (label, key) => h('button', { class: 'cp-btn ghost' + (w[key] ? ' on' : ''), onClick: () => { w[key] = !w[key]; renderStep(); } }, label + ': ' + (w[key] ? 'Yes' : 'No'));
          const stopRow = (stopLabel, lkey, akey) => {
            const lc = h('input', { type: 'checkbox' }); lc.checked = !!w[lkey]; lc.onchange = () => { w[lkey] = lc.checked; renderStep(); };
            const ac = h('input', { type: 'checkbox' }); ac.checked = !!w[akey]; ac.onchange = () => { w[akey] = ac.checked; renderStep(); };
            const box = (cb, t9) => h('label', { style: 'display:flex;gap:7px;align-items:center;cursor:pointer;font-size:.82rem;color:#334155' }, [cb, h('span', null, t9)]);
            return h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px' }, [
              h('b', { style: 'font-size:.82rem;color:#10223B;flex:0 0 66px' }, stopLabel), box(lc, 'Lumpers load/unload (fee)'), box(ac, 'Driver assists (load/unload)')]);
          };
          return h('div', { style: 'margin-top:8px;display:grid;gap:8px' }, [
            h('div', { class: 'cp-sub', style: 'font-weight:700;color:#10223B' }, 'Freight handling — tick anything that applies at each stop. Detention, layover, lumper and driver assist can all apply at BOTH pickup and delivery.'),
            stopRow('Pickup', 'lumper_pickup', 'assist_pickup'),
            stopRow('Delivery', 'lumper_delivery', 'assist_delivery'),
            h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:2px' }, [rt('Team drivers required', 'team_required')]),
          (() => {
            if (!w.__billInit) { w.__billInit = true; try { const b9 = JSON.parse(localStorage.getItem('lb:billing') || '{}'); if (!w.doc_bn && b9.bn) { w.doc_bn = b9.bn; w.doc_be = b9.be || ''; w.doc_bp = b9.bp || ''; } } catch (_) {} }
            const tx9 = (label9, key9, ph9) => { const a9 = h('input', { class: 'cp-in', type: 'text', placeholder: ph9 || '', style: 'margin:0' }); a9.value = w[key9] || ''; a9.oninput = () => { w[key9] = a9.value; }; return field(label9, a9); };
            return h('details', { open: !!(w.doc_pu || w.doc_dn || w.doc_bn), style: 'grid-column:1/-1;margin-top:12px;background:#f8fafc;border:1.5px dashed #cbd5e1;border-radius:14px;padding:12px 16px' }, [
              h('summary', { style: 'cursor:pointer;font-weight:800;font-size:.84rem;color:#334155' }, '\ud83d\udccb Already have the load paperwork? Add it now \u2014 optional, speeds up dispatch'),
              h('div', { class: 'cp-sub', style: 'margin:8px 0 10px' }, 'Whatever you add here lands in the carrier\u2019s dispatch pack the moment the load posts. Anything you skip is collected after booking \u2014 reminders every 2 hours; 4h+ overdue pauses your new postings.'),
              h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px' }, [
                tx9('PU / pickup number (from the shipper)', 'doc_pu', 'e.g. PU-482913'),
                tx9('Delivery / confirmation number', 'doc_dn', 'e.g. DEL-99120'),
                tx9('Appointment confirmation #', 'doc_ac', 'if the facility confirmed one'),
                tx9('Appt confirmed time', 'doc_at', 'e.g. Jul 16, 10:00 AM'),
                tx9('Billing contact name', 'doc_bn', 'accounts payable'),
                tx9('Billing email', 'doc_be', 'ap@company.com'),
                tx9('Billing phone (optional)', 'doc_bp', ''),
                ...((Array.isArray(w.stops) ? w.stops : []).flatMap((sp9, i9) => {
                  const lb9 = (sp9.kind === 'pickup' ? 'Extra PICKUP ' : 'Extra DELIVERY ') + (i9 + 1);
                  const in1 = h('input', { class: 'cp-in', type: 'text', placeholder: sp9.kind === 'pickup' ? 'e.g. PU-1182' : 'e.g. DEL-2210', style: 'margin:0' });
                  in1.value = sp9.doc_number || ''; in1.oninput = () => { sp9.doc_number = in1.value; };
                  const in2 = h('input', { class: 'cp-in', type: 'text', placeholder: 'if the facility confirmed one', style: 'margin:0' });
                  in2.value = sp9.doc_appt || ''; in2.oninput = () => { sp9.doc_appt = in2.value; };
                  return [field(lb9 + ' \u2014 ' + (sp9.kind === 'pickup' ? 'PU number' : 'delivery number'), in1), field(lb9 + ' \u2014 appt confirmation #', in2)];
                })),
              ]),
            ]);
          })(),
          ]);
        })(),
        (() => {
          // derive combined flags consumed by the rate card + validation
          w.driver_assist_required = !!(w.assist_pickup || w.assist_delivery);
          w.lumper_any = !!(w.lumper_pickup || w.lumper_delivery);
          const svcs = [];
          if (w.load_method_pickup === 'Drop & hook') svcs.push(['Drop & hook (pickup)', 'trailer stays at the facility — detention & layover clocks run per the rate card']);
          if (w.load_method_delivery === 'Drop trailer') svcs.push(['Drop trailer (delivery)', 'detention & layover clocks run per the rate card']);
          const lstops = [w.lumper_pickup ? 'pickup' : null, w.lumper_delivery ? 'delivery' : null].filter(Boolean);
          if (lstops.length) svcs.push(['Lumper at ' + lstops.join(' & '), 'broker pays the lumper directly or reimburses with receipt — NEVER the carrier’s cost (set the Lumper policy in the Rate card step)']);
          const astops = [w.assist_pickup ? 'pickup' : null, w.assist_delivery ? 'delivery' : null].filter(Boolean);
          if (astops.length) svcs.push(['Driver assist at ' + astops.join(' & '), '$75 per stop — LoadBoot industry standard (you can set higher in the Rate card step)']);
          if (w.team_required) svcs.push(['Team drivers', 'no separate fee — priced in the linehaul: industry standard is +20–30% over a solo rate (≈ +$0.40–0.60/mi), because a team runs 1,000+ mi/day nonstop with two paid drivers']);
          if (!svcs.length) { w.svc_rates_ok = false; return null; }
          const cb = h('input', { type: 'checkbox' }); cb.checked = !!w.svc_rates_ok; cb.onchange = () => { w.svc_rates_ok = cb.checked; };
          return h('div', { style: 'margin-top:10px;background:#fff7ed;border:1.5px solid #fdba74;border-radius:14px;padding:12px 14px' }, [
            h('div', { style: 'font-weight:800;font-size:.85rem;color:#9a3412;margin-bottom:6px' }, '🧾 Extra services you selected — industry-standard rates apply'),
            ...svcs.map(([t9, d9]) => h('div', { style: 'display:flex;gap:8px;padding:5px 0;border-bottom:1px dashed #fed7aa;font-size:.8rem;color:#7c2d12' }, [h('b', { style: 'flex:0 0 auto' }, '• ' + t9 + ':'), h('span', null, d9)])),
            h('label', { style: 'display:flex;gap:9px;align-items:flex-start;margin-top:9px;cursor:pointer;font-size:.8rem;color:#7c2d12;line-height:1.5' }, [cb,
              h('span', null, ['I agree these services are payable at the ', h('b', null, 'LoadBoot industry-standard rates'), ' (or higher if I set more in the Rate card step) — they appear on the rate confirmation and the carrier can claim them with proof. ',
                h('a', { href: '/lumper-policy.html', target: '_blank', rel: 'noopener' }, 'Lumper'), ' · ', h('a', { href: '/driver-assist-policy.html', target: '_blank', rel: 'noopener' }, 'Driver assist'), ' · ', h('a', { href: '/detention-pay-policy.html', target: '_blank', rel: 'noopener' }, 'Detention')]),
            ]),
          ]);
        })(),
        h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'Everything here shows on the carrier\u2019s load card \u2014 a carrier must be able to decide YES/NO without calling anyone.'),
      ]);
    }
    else if (step === 3) body = h('div', null, [
      h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'These are LoadBoot marketplace standards — pre-agreed on every load, so a carrier can book without a single phone call. You cannot post BELOW standard; you may offer ABOVE to attract carriers on a tough lane.'),
      (() => {
        // ---- LoadBoot standard accessorials: fixed floor, broker may raise ABOVE (never below) ----
        const STD = { acc_detention_per_hr: 60, acc_detention_free_hours: 2, acc_layover_per_day: 250, acc_tonu: 250, acc_driver_assist: 75, acc_extra_stop: 100 };
        const KEYMAP = { acc_detention_per_hr: 'detention_per_hr', acc_detention_free_hours: 'detention_free_hours', acc_layover_per_day: 'layover_per_day', acc_tonu: 'tonu', acc_driver_assist: 'driver_assist', acc_extra_stop: 'extra_stop' };
        const sv = (k) => { const s = (w.__stds && Number(w.__stds[KEYMAP[k]])) || STD[k]; return s; };
        if (!w.__stds && !w.__stds_p3) { w.__stds_p3 = true; (async () => { try { const m = {}; ((await rateStandards()) || []).forEach(r => { m[r.key] = r.value; }); w.__stds = w.__stds || m; } catch (_) {} try { renderStep(); } catch (_) {} })(); }
        // auto-init always-on protections to standard so nothing is ever blank or below floor
        ['acc_detention_per_hr', 'acc_detention_free_hours', 'acc_layover_per_day', 'acc_tonu'].forEach(k => { if (w[k] === undefined || w[k] === '' || Number(w[k]) < sv(k)) w[k] = String(sv(k)); });
        if (w.acc_lumper_policy === undefined) w.acc_lumper_policy = 'Reimbursed with receipt';
        if (w.driver_assist_required && (w.acc_driver_assist === undefined || w.acc_driver_assist === '' || Number(w.acc_driver_assist) < sv('acc_driver_assist'))) w.acc_driver_assist = String(sv('acc_driver_assist'));
        if (w.svc_extra_stop && (w.acc_extra_stop === undefined || w.acc_extra_stop === '' || Number(w.acc_extra_stop) < sv('acc_extra_stop'))) w.acc_extra_stop = String(sv('acc_extra_stop'));
        const row = (title, key, std, unit, extra) => {
          const cur = Number(w[key]) || std; const above = cur > std; const rk = '__raise_' + key;
          const valTxt = h('b', { style: 'color:#0f766e;white-space:nowrap' }, '$' + std + unit + (above ? ' → $' + cur + unit + ' (above)' : ''));
          const raiseBtn = h('a', { style: 'font-size:.74rem;font-weight:800;color:#0883F7;cursor:pointer;white-space:nowrap', onClick: () => { w[rk] = !w[rk]; renderStep(); } }, w[rk] ? 'Cancel' : (above ? 'Edit' : 'Offer above ▸'));
          const parts = [h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap' }, [h('span', null, [h('b', null, title), extra ? h('span', { class: 'cp-sub' }, ' · ' + extra) : null]), h('span', { style: 'display:flex;gap:12px;align-items:center' }, [valTxt, raiseBtn])])];
          if (w[rk]) {
            const inpx = h('input', { class: 'cp-in', type: 'number', style: 'margin-top:6px', value: String(cur), min: String(std) });
            inpx.oninput = () => { const n = Number(inpx.value); w[key] = (n >= std ? String(n) : String(std)); };
            inpx.onblur = () => { if (Number(w[key]) < std) w[key] = String(std); renderStep(); };
            parts.push(inpx);
            parts.push(h('div', { class: 'cp-sub', style: 'color:#b45309;margin-top:3px' }, 'Minimum is the LoadBoot standard $' + std + unit + ' — you can only go higher.'));
          }
          return h('div', { style: 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:11px 13px' }, parts);
        };
        const protections = h('div', { style: 'display:grid;gap:9px' }, [
          row('Detention', 'acc_detention_per_hr', sv('acc_detention_per_hr'), '/hr', 'after ' + sv('acc_detention_free_hours') + 'h free time'),
          row('Layover', 'acc_layover_per_day', sv('acc_layover_per_day'), '/day', 'overnight hold'),
          row('TONU', 'acc_tonu', sv('acc_tonu'), '', 'late cancel of a confirmed load'),
        ]);
        const esCb = h('input', { type: 'checkbox' }); esCb.checked = !!w.svc_extra_stop;
        esCb.onchange = () => { w.svc_extra_stop = esCb.checked; if (esCb.checked && (w.acc_extra_stop === undefined || Number(w.acc_extra_stop) < sv('acc_extra_stop'))) w.acc_extra_stop = String(sv('acc_extra_stop')); renderStep(); };
        const optRow = (cb, label, hint, extra) => h('label', { style: 'display:flex;gap:9px;align-items:flex-start;cursor:pointer;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:11px 13px' }, [cb, h('div', { style: 'flex:1' }, [h('b', null, label), h('div', { class: 'cp-sub' }, hint), extra ? h('div', { style: 'margin-top:8px' }, extra) : null])]);
        const daStops = [w.assist_pickup ? 'pickup' : null, w.assist_delivery ? 'delivery' : null].filter(Boolean).join(' & ');
        const daInfo = w.driver_assist_required
          ? h('div', { style: 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:11px 13px' }, [h('b', null, 'Driver assist — enabled at ' + daStops), h('div', { class: 'cp-sub', style: 'margin:2px 0 8px' }, 'You marked the driver loads/unloads — standard $' + sv('acc_driver_assist') + '/stop. Change it under Freight handling in the previous step.'), row('Driver assist', 'acc_driver_assist', sv('acc_driver_assist'), '/stop', '')])
          : h('div', { class: 'cp-sub', style: 'background:#f8fafc;border:1px dashed #e2e8f0;border-radius:12px;padding:10px 12px' }, 'Driver assist not marked for this load. If the driver may work the dock at pickup or delivery, tick it under Freight handling in the previous step.');
        const optional = h('div', { style: 'display:grid;gap:9px;margin-top:9px' }, [
          daInfo,
          (() => {
            const nst9 = (Array.isArray(w.stops) ? w.stops.filter((z9) => z9 && z9.lat) : []).length;
            if (nst9) { w.svc_extra_stop = true; esCb.checked = true; esCb.disabled = true; }
            const rate9 = Number(w.acc_extra_stop) || sv('acc_extra_stop');
            const desc9 = nst9
              ? 'This load has ' + nst9 + ' extra stop' + (nst9 > 1 ? 's' : '') + ' (from step 1): ' + w.stops.filter((z9) => z9 && z9.lat).map((z9, k9) => (z9.kind === 'pickup' ? '📦' : '📤') + ' ' + (z9.city || 'stop ' + (k9 + 1))).join(', ') + ' — ' + nst9 + ' × $' + rate9 + ' = $' + (nst9 * rate9) + ' total, auto-billed as each stop is served (GPS-verified).'
              : 'Multi-stop load — each extra stop pays standard $' + sv('acc_extra_stop') + '/stop.';
            return optRow(esCb, 'Extra stops beyond pickup & delivery' + (nst9 ? ' — ' + nst9 + ' on this load' : ''), desc9, w.svc_extra_stop ? row('Extra stop' + (nst9 ? ' (×' + nst9 + ')' : ''), 'acc_extra_stop', sv('acc_extra_stop'), '/stop', '') : null);
          })(),
        ]);
        const lsel = h('select', { class: 'cp-in' }, ['Reimbursed with receipt', 'Broker pays lumper directly', 'Included in rate', 'Not covered'].map(o => h('option', { value: o }, o)));
        lsel.value = w.acc_lumper_policy || 'Reimbursed with receipt'; lsel.onchange = () => { w.acc_lumper_policy = lsel.value; renderStep(); };
        const lump = h('div', { style: 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:11px 13px;margin-top:9px' }, [h('b', null, 'Lumper policy'), h('div', { class: 'cp-sub', style: 'margin:2px 0 6px' }, 'Who pays third-party dock labor. LoadBoot standard: broker pays direct or reimburses with receipt — never the carrier.'), lsel]);
        const agCb = h('input', { type: 'checkbox' }); agCb.checked = !!w.acc_agreed; agCb.onchange = () => { w.acc_agreed = agCb.checked; };
        const li = (label, val, href) => h('div', { style: 'display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed #bbf7d0;font-size:.82rem;color:#065f46' }, [
          href ? h('a', { href: href, target: '_blank', rel: 'noopener', style: 'font-weight:700;color:#047857' }, label) : h('b', { style: 'color:#047857' }, label),
          h('b', { style: 'white-space:nowrap;text-align:right' }, val)]);
        const items = [
          li('Detention', '$' + (Number(w.acc_detention_per_hr) || sv('acc_detention_per_hr')) + '/hr after ' + sv('acc_detention_free_hours') + 'h free', '/detention-pay-policy.html'),
          li('Layover', '$' + (Number(w.acc_layover_per_day) || sv('acc_layover_per_day')) + '/day', '/layover-policy.html'),
          li('TONU', '$' + (Number(w.acc_tonu) || sv('acc_tonu')), '/tonu-policy.html'),
          li('Lumper', w.acc_lumper_policy || 'Reimbursed with receipt', '/lumper-policy.html'),
        ];
        if (w.driver_assist_required) items.push(li('Driver assist', '$' + (Number(w.acc_driver_assist) || sv('acc_driver_assist')) + '/stop', '/driver-assist-policy.html'));
        if (w.svc_extra_stop) { const nst9 = (Array.isArray(w.stops) ? w.stops.filter((z9) => z9 && z9.lat) : []).length; const rt9 = Number(w.acc_extra_stop) || sv('acc_extra_stop'); items.push(li('Extra stop' + (nst9 ? 's ×' + nst9 : ''), '$' + rt9 + '/stop' + (nst9 ? ' = $' + (nst9 * rt9) + ' total' : ''), null)); }
        if (w.team_required) items.push(li('Team drivers', 'priced in linehaul (+20–30%)', null));
        const agree = h('div', { style: 'margin-top:14px;background:#ecfdf5;border:1.5px solid #6ee7b7;border-radius:14px;padding:14px 16px' }, [
          h('div', { style: 'font-weight:800;color:#065f46;font-size:.92rem;margin-bottom:3px' }, '📋 Standard marketplace terms — please review before continuing'),
          h('div', { class: 'cp-sub', style: 'color:#047857;margin-bottom:9px;line-height:1.55' }, 'These are industry-standard protections agreed between YOU and the carrier — LoadBoot does not charge, add, or take any of them. They only apply IF the situation happens, and the carrier must prove it. Showing them upfront keeps every load transparent and dispute-proof.'),
          h('div', null, items),
          h('label', { style: 'display:flex;gap:9px;align-items:flex-start;margin-top:11px;cursor:pointer;font-size:12.5px;line-height:1.6;color:#065f46' }, [agCb,
            h('span', null, ['I have reviewed the above and ', h('b', null, 'agree these standard rates & policies apply'), ' to this load’s rate confirmation, claimable by the carrier with proof.'])]),
        ]);
        return h('div', null, [
          h('div', { style: 'font-weight:800;font-size:.85rem;color:#10223B;margin:2px 0 8px' }, '🛡️ Carrier protections — standard on every load'),
          h('div', { class: 'cp-sub', style: 'margin:-4px 0 8px' }, 'These apply at EVERY stop — pickup, delivery and any stop in between.'),
          protections,
          h('div', { style: 'font-weight:800;font-size:.85rem;color:#10223B;margin:14px 0 4px' }, 'Optional services for this load'),
          optional, lump, agree,
        ]);
      })(),
      (() => { const sel = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Hazmat? (required)'), h('option', { value: 'no' }, 'No — not hazmat'), h('option', { value: 'yes' }, 'YES — hazmat (placardable)')]);
        sel.value = w.hazmat_sel || ''; sel.onchange = () => { w.hazmat_sel = sel.value; renderStep(); }; return field('Hazmat declaration *', sel); })(),
      (w.hazmat_sel === 'yes') ? (() => {
        const un = inp('4 digits, e.g. 1203', 'text'); un.maxLength = 6; un.value = (w.hz_un || '').replace(/^UN/i, '');
        un.oninput = () => { un.value = un.value.replace(/\D/g, '').slice(0, 4); w.hz_un = un.value; };
        const cls = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Hazard class *')].concat([
          ['1', 'Class 1 \u2014 Explosives'], ['2', 'Class 2 \u2014 Gases'], ['3', 'Class 3 \u2014 Flammable liquid'],
          ['4', 'Class 4 \u2014 Flammable solid'], ['5', 'Class 5 \u2014 Oxidizer / organic peroxide'],
          ['6', 'Class 6 \u2014 Toxic / infectious'], ['7', 'Class 7 \u2014 Radioactive'],
          ['8', 'Class 8 \u2014 Corrosive'], ['9', 'Class 9 \u2014 Miscellaneous'],
        ].map(([v9, t9]) => h('option', { value: v9 }, t9))));
        cls.value = w.hz_class || ''; cls.onchange = () => { w.hz_class = cls.value; };
        const pg = h('select', { class: 'cp-in' }, ['', 'I', 'II', 'III'].map(v9 => h('option', { value: v9 }, v9 ? 'Packing group ' + v9 : 'Packing group (optional)')));
        pg.value = w.hz_pg || ''; pg.onchange = () => { w.hz_pg = pg.value; };
        const nm = inp('Proper shipping name, e.g. Gasoline', 'text'); nm.value = w.hz_name || ''; nm.oninput = () => { w.hz_name = nm.value; };
        return h('div', { style: 'background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:12px 14px;margin-top:6px' }, [
          h('div', { style: 'font-weight:800;font-size:.85rem;color:#92400e;margin-bottom:8px' }, '\u2622 DOT hazmat details \u2014 required, they go on the rate confirmation & shipping papers'),
          h('div', { class: 'cp-formgrid' }, [
            field('UN number *', un), field('Hazard class *', cls),
            field('Packing group', pg), field('Proper shipping name *', nm),
          ]),
          h('div', { class: 'cp-sub', style: 'color:#b45309;margin-top:4px' }, '\u26a0 Only carriers with a VERIFIED hazmat certificate can see & book this load. Placards per 49 CFR are the shipper\u2019s responsibility.'),
        ]);
      })() : null,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px' }, [toggle('Tracking required', 'tracking_required')]),
      h('div', { class: 'cp-sub', style: 'margin-top:4px' }, 'Scheduling (FCFS / appointment) was set in the Schedule step \u2014 ' + (w.fcfs ? 'FCFS pickup' : w.appointment_required ? 'pickup by appointment' : 'not set yet') + '.'),
      h('div', { class: 'cp-sub', style: 'margin-top:6px' }, ['These are LoadBoot marketplace standards — read the full policies: ',
        h('a', { href: '/detention-pay-policy.html', target: '_blank', rel: 'noopener' }, 'Detention'), ' · ',
        h('a', { href: '/tonu-policy.html', target: '_blank', rel: 'noopener' }, 'TONU'), ' · ',
        h('a', { href: '/layover-policy.html', target: '_blank', rel: 'noopener' }, 'Layover'), ' · ',
        h('a', { href: '/lumper-policy.html', target: '_blank', rel: 'noopener' }, 'Lumper'), ' · ',
        h('a', { href: '/driver-assist-policy.html', target: '_blank', rel: 'noopener' }, 'Driver assist'), ' · ',
        h('a', { href: '/fcfs-policy.html', target: '_blank', rel: 'noopener' }, 'FCFS')]),
      (() => { const cb = h('input', { type: 'checkbox' }); cb.checked = !!w.emg_policy_ok; cb.onchange = () => { w.emg_policy_ok = cb.checked; };
        return h('label', { style: 'display:flex;gap:9px;align-items:flex-start;margin-top:8px;background:#fff7ed;border:1.5px solid #fdba74;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.6;cursor:pointer' }, [cb,
          h('span', null, ['I accept the ', h('a', { href: '/emergency-rescheduling-policy.html', target: '_blank', rel: 'noopener' }, 'Emergency Rescheduling Policy'), ' — a VERIFIED on-road emergency (proof + live GPS + Dispatch verification) may reschedule the delivery window; response window 2 hours, then policy auto-reschedule; no carrier penalty/TONU on verified emergencies. Required to post.'])]);
      })(),
      wi('Notes / special instructions', 'notes'),
    ]);
    else {
      const go9 = (i9) => { step = i9; renderStep(); };
      const sec9 = (icon9, title9, stepIdx, rows9) => h('div', { style: 'background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:13px 15px' }, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
          h('div', { style: 'font-weight:800;font-size:.82rem;color:#10223B' }, icon9 + ' ' + title9),
          h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'padding:3px 10px;font-size:.7rem', onClick: () => go9(stepIdx) }, '\u270e Edit'),
        ]),
        ...rows9.filter(Boolean).map(([k9, v9]) => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px dashed #f1f5f9;font-size:.8rem' }, [
          h('span', { style: 'color:#7c8aa0;font-weight:600;flex:0 0 auto' }, k9), h('b', { style: 'color:#10223B;text-align:right' }, String(v9))])),
      ]);
      const rpm9 = (w.rate && w.miles && Number(w.miles) > 0) ? '$' + (Number(w.rate) / Number(w.miles)).toFixed(2) + '/mi' : null;
      body = h('div', null, [
        h('div', { style: 'background:radial-gradient(500px 160px at 90% -40%,rgba(8,131,247,.4),transparent 60%),linear-gradient(120deg,#0d1b33,#14335c);border-radius:16px;padding:16px 18px;color:#fff;margin-bottom:12px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center' }, [
            h('div', null, [
              h('div', { style: 'font-size:.64rem;letter-spacing:.1em;opacity:.65;font-weight:800' }, 'READY TO POST \u2014 FINAL CHECK'),
              h('div', { style: 'font-weight:800;font-size:1.12rem;margin-top:3px' }, (w.origin || '?') + '  \u2192  ' + (w.destination || '?')),
              h('div', { style: 'font-size:.76rem;opacity:.75;margin-top:2px' }, [w.miles ? Number(w.miles).toLocaleString() + ' mi' : null, w.__drive_hours ? ('~' + Math.round(w.__drive_hours) + 'h drive') : null, (w.pickup_lat && w.delivery_lat) ? 'exact GPS pins locked \u2713' : null].filter(Boolean).join(' \u00b7 ')),
            ]),
            h('div', { style: 'text-align:right' }, [
              h('div', { style: 'font-weight:800;font-size:1.5rem;color:#7cc0ff' }, w.rate ? ('$' + Number(w.rate).toLocaleString()) : '\u2014'),
              rpm9 ? h('div', { style: 'font-size:.76rem;opacity:.8' }, rpm9 + ' all-in') : null,
            ]),
          ]),
        ]),
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px' }, [
          sec9('\ud83d\udce6', 'Freight', 2, [
            ['Equipment', w.equipment || '\u2014'], ['Load size', w.load_size || '\u2014'], ['Commodity', w.commodity || '\u2014'],
            w.weight ? ['Weight', Number(w.weight).toLocaleString() + ' lb'] : null,
            w.pallets ? ['Pallets / pieces', w.pallets] : null,
            w.temperature ? ['Reefer temp', w.temperature + '\u00b0F'] : null,
            w.tarps ? ['Tarps', w.tarps] : null,
            w.cargo_value ? ['Cargo value', '$' + Number(w.cargo_value).toLocaleString()] : null,
            ['Hazmat', w.hazmat_sel === 'yes' ? '\u26a0 YES \u2014 certified carriers only' : 'No'],
          ]),
          sec9('\ud83d\udcc5', 'Schedule', 1, [
            ['Pickup', (w.pickup_date || '\u2014') + (w.pickup_window ? ' \u00b7 ' + w.pickup_window : '')],
            ['Pickup scheduling', w.sched_pu === 'FCFS' ? 'FCFS \u2014 first come, first served' : w.sched_pu === 'Appointment' ? 'Fixed appointment' : '\u2014'],
            ['Delivery', (w.delivery_date || '\u2014') + (w.delivery_window ? ' \u00b7 ' + w.delivery_window : '')],
            ['Delivery scheduling', w.sched_del === 'FCFS' ? 'FCFS \u2014 first come, first served' : w.sched_del === 'Appointment' ? 'Fixed appointment' : '\u2014'],
          ]),
          sec9('\ud83e\uddfe', 'Rate card \u2014 what the carrier can claim', 3, [
            ['Detention', '$' + (w.acc_detention_per_hr || '?') + '/hr after ' + (w.acc_detention_free_hours || '?') + 'h free'],
            ['Layover', '$' + (w.acc_layover_per_day || '?') + '/day'],
            ['TONU', '$' + (w.acc_tonu || '?')],
            ['Lumper', w.acc_lumper_policy || '\u2014'],
            w.acc_driver_assist ? ['Driver assist', '$' + w.acc_driver_assist + '/stop'] : null,
            w.acc_extra_stop ? ['Extra stop', '$' + w.acc_extra_stop] : null,
          ]),
          sec9('\u2699\ufe0f', 'Services & handling', 2, [
            ['Pickup loading', w.load_method_pickup || '\u2014'],
            ['Delivery unloading', w.load_method_delivery || '\u2014'],
            w.lumper_any ? ['Lumper at', [w.lumper_pickup ? 'pickup' : null, w.lumper_delivery ? 'delivery' : null].filter(Boolean).join(' & ')] : null,
            w.driver_assist_required ? ['Driver assist at', [w.assist_pickup ? 'pickup' : null, w.assist_delivery ? 'delivery' : null].filter(Boolean).join(' & ') + ' \u2014 paid per rate card'] : null,
            w.team_required ? ['Drivers', '\u26a0 TEAM required'] : null,
            w.svc_rates_ok ? ['Service rates', 'Industry-standard rates agreed \u2713'] : null,
            ['Tracking', w.tracking_required ? 'Required (live GPS)' : 'Standard GPS proof'],
            w.reference ? ['Reference', w.reference] : null,
          ]),
        ]),
        h('div', { style: 'margin-top:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px 13px;font-size:.8rem;color:#166534' }, '\ud83d\udcb3 Payment & contact on the rate confirmation: settlement runs through LoadBoot (documented terms, no games), and LoadBoot dispatch is the 24/7 day-of contact \u2014 the carrier never needs to chase anyone by phone.'),
        h('div', { class: 'cp-sub', style: 'margin-top:8px' }, 'On submit, a required-document checklist (rate con, pickup/delivery #, appointment, billing) is created for our dispatch team.'),
      ]);
      // duplicate radar — warn BEFORE submitting if an open load already covers this lane+date
      (async () => {
        try {
          const rows9 = (await partnerMyLoads(60)) || [];
          const dups9 = rows9.filter(r9 => !/reject|cancel|deliver|complete|invoiced/.test(String(r9.status || '').toLowerCase())
            && String(r9.origin || '').toLowerCase() === String(w.origin || '').toLowerCase()
            && String(r9.destination || '').toLowerCase() === String(w.destination || '').toLowerCase()
            && String(r9.pickup_date || '') === String(w.pickup_date || ''));
          if (dups9.length && body.isConnected) body.insertBefore(h('div', { style: 'background:#fef2f2;border:1.5px solid #fecaca;border-radius:14px;padding:12px 14px;margin-bottom:12px' }, [
            h('div', { style: 'font-weight:800;color:#991b1b;font-size:.86rem' }, '\u26a0 Possible duplicate \u2014 you already have ' + dups9.length + ' open load' + (dups9.length === 1 ? '' : 's') + ' on this exact lane & pickup date'),
            h('div', { class: 'cp-sub', style: 'margin-top:3px' }, 'Duplicates confuse carriers and split your offers. Check My Loads first \u2014 the system will also challenge this on submit.'),
          ]), body.firstChild);
        } catch (_) {}
      })();
    }
    const back = h('button', { class: 'cp-btn ghost', onClick: () => { if (step > 0) { step--; renderStep(); } } }, 'Back');
    const nextLbl = step < STEPS.length - 1 ? 'Next' : (confirmDup ? 'Submit anyway' : 'Submit load');
    const next = h('button', { class: 'cp-btn', onClick: async () => {
      err.textContent = ''; err.className = 'cp-err';
      if (step === 0) {
        const need = [];
        if (!(w.o_street || '').trim()) need.push('pickup street address');
        if (!(w.o_city || '').trim()) need.push('pickup city');
        if (!/^[A-Za-z]{2}$/.test((w.o_state || '').trim())) need.push('pickup state (2 letters)');
        if (!/^\d{5}(-\d{4})?$/.test((w.o_zip || '').trim())) need.push('pickup ZIP (5 digits)');
        if (!(w.d_street || '').trim()) need.push('delivery street address');
        if (!(w.d_city || '').trim()) need.push('delivery city');
        if (!/^[A-Za-z]{2}$/.test((w.d_state || '').trim())) need.push('delivery state (2 letters)');
        if (!/^\d{5}(-\d{4})?$/.test((w.d_zip || '').trim())) need.push('delivery ZIP (5 digits)');
        if (window.__lbAgentOrg) {
          if (!w.src_type) need.push('load source type (agent posts must name the source)');
          if (!(w.src_company || '').trim()) need.push('source company name');
          if (!(w.src_contact || '').trim()) need.push('source contact name');
          if (!/.+@.+\..+/.test(w.src_email || '')) need.push('source email');
        }
        if (w.__lane_block) { err.textContent = '🚫 One of your extra stops is far OFF this lane — the route balloons past what any carrier runs as one trip. Remove that stop (post it as its own load) to continue.'; return; }
        (Array.isArray(w.stops) ? w.stops : []).forEach((sp0, i0) => {
          const any0 = (sp0.street || sp0.city || sp0.address || '').trim();
          if (!any0) return;
          if (!sp0.lat) need.push('extra stop ' + (i0 + 1) + ' pin (pick a suggestion or complete the address)');
          if (!(sp0.city || '').trim()) need.push('extra stop ' + (i0 + 1) + ' city');
          if (!/^[A-Za-z]{2}$/.test((sp0.state || '').trim())) need.push('extra stop ' + (i0 + 1) + ' state (2 letters)');
        });
        if (need.length) { err.textContent = 'Required: ' + need.join(', ') + '.'; return; }
        const stU = (x) => String(x || '').trim().toUpperCase();
        w.origin_full = [w.o_street.trim(), w.o_city.trim(), stU(w.o_state) + ' ' + w.o_zip.trim()].join(', ');
        w.destination_full = [w.d_street.trim(), w.d_city.trim(), stU(w.d_state) + ' ' + w.d_zip.trim()].join(', ');
        w.origin = w.o_city.trim() + ', ' + stU(w.o_state);
        w.destination = w.d_city.trim() + ', ' + stU(w.d_state);
      }
      if (step === 1) {
        const m1 = [];
        if (!w.sched_pu) m1.push('pickup scheduling (FCFS or appointment)');
        if (!w.pickup_date) m1.push('pickup date');
        if (w.sched_pu === 'FCFS' && !/\d{2}:\d{2}\u2013\d{2}:\d{2}/.test(w.pickup_window || '')) m1.push('pickup FCFS window (from & to)');
        if (w.sched_pu === 'Appointment' && !(w.pu_appt || '').trim()) m1.push('pickup appointment time');
        (Array.isArray(w.stops) ? w.stops : []).forEach((sp9, i9) => {
          if (!sp9.lat) return;
          if (!sp9.date) m1.push('extra stop ' + (i9 + 1) + ' date');
          if ((sp9.sched || 'FCFS') === 'Appointment' && !(sp9.time || '').trim()) m1.push('extra stop ' + (i9 + 1) + ' appointment time');
          if ((sp9.sched || 'FCFS') === 'FCFS' && !/\d{2}:\d{2}\u2013\d{2}:\d{2}/.test(sp9.window || '')) m1.push('extra stop ' + (i9 + 1) + ' FCFS window');
        });
        if (!w.sched_del) m1.push('delivery scheduling (FCFS or appointment)');
        if (!w.delivery_date) m1.push('delivery date');
        if (w.sched_del === 'FCFS' && !/\d{2}:\d{2}\u2013\d{2}:\d{2}/.test(w.delivery_window || '')) m1.push('delivery FCFS window (from & to)');
        if (w.sched_del === 'Appointment' && !(w.del_appt || '').trim()) m1.push('delivery appointment time');
        if (m1.length) { err.textContent = 'Required: ' + m1.join(', ') + '.'; return; }
        if (w.delivery_date < w.pickup_date) { err.textContent = 'Delivery date cannot be before the pickup date.'; return; }
        const tod9 = new Date().toISOString().slice(0, 10);
        if (w.pickup_date < tod9) { err.textContent = 'Pickup date is in the past.'; return; }
        const rng9 = (v9) => (String(v9).match(/(\d{2}:\d{2})\u2013(\d{2}:\d{2})/) || []).slice(1);
        if (w.sched_pu === 'FCFS') { const [f9, t9] = rng9(w.pickup_window); if (f9 && t9 && t9 <= f9) { err.textContent = 'Pickup window: \u201cto\u201d must be after \u201cfrom\u201d.'; return; } }
        if (w.sched_del === 'FCFS') { const [f9, t9] = rng9(w.delivery_window); if (f9 && t9 && t9 <= f9) { err.textContent = 'Delivery window: \u201cto\u201d must be after \u201cfrom\u201d.'; return; } }
        const puT = (w.sched_pu === 'Appointment' ? w.pu_appt : (w.pickup_window || '').slice(0, 5)) || '00:00';
        const deT = (w.sched_del === 'Appointment' ? w.del_appt : (w.delivery_window || '').slice(0, 5)) || '23:59';
        const puDt = new Date(w.pickup_date + 'T' + puT);
        const deDt = new Date(w.delivery_date + 'T' + deT);
        if (puDt.getTime() < Date.now() - 60000) { err.textContent = 'Pickup time frame has already PASSED \u2014 it\u2019s ' + new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' now. Update your pickup schedule to a future date/time.'; return; }
        if (!(deDt > puDt)) { err.textContent = 'Delivery time frame must be in the FUTURE of the pickup time frame \u2014 fix the delivery date/time.'; return; }
        // ---- MULTI-STOP CHAIN: pickup -> S1 -> S2 -> ... -> delivery, each leg HOS-checked ----
        const XSv = (Array.isArray(w.stops) ? w.stops.filter((sp9) => sp9 && sp9.lat) : []);
        if (XSv.length) {
          const legs9 = (Array.isArray(w.__leg_hours) && w.__leg_hours.length === XSv.length + 1) ? w.__leg_hours : null;
          const hos9f = (hrs9) => w.team_required ? hrs9 : hrs9 + Math.floor(hrs9 / 11) * 10;
          let cum9 = 0; let clock9 = puDt.getTime(); let prevLbl9 = 'pickup'; let prevT9 = puDt;
          const fmt9 = (d9) => d9.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          for (let i9 = 0; i9 < XSv.length; i9++) {
            const sp9 = XSv[i9];
            const legH9 = legs9 ? legs9[i9] : (w.__drive_hours / (XSv.length + 1));
            cum9 += legH9;
            const earliest9 = new Date(puDt.getTime() + hos9f(cum9) * 0.95 * 3600 * 1000 + i9 * 2 * 3600 * 1000);
            const spT9 = (sp9.sched === 'Appointment' ? (sp9.time || '00:00') : (String(sp9.window || '').slice(0, 5) || '00:00'));
            const spDt9 = sp9.date ? new Date(sp9.date + 'T' + spT9) : null;
            const lbl9 = (sp9.kind === 'pickup' ? 'Extra pickup ' : 'Extra delivery ') + (i9 + 1);
            if (!spDt9) { err.textContent = lbl9 + ': set the stop date/time.'; return; }
            if (spDt9.getTime() < Date.now() - 60000) { err.textContent = lbl9 + ' date/time has already PASSED — move it to the future.'; return; }
            if (spDt9 <= prevT9) { err.textContent = lbl9 + ' must be AFTER the ' + prevLbl9 + ' time — the truck runs the stops in order.'; return; }
            if (spDt9 < earliest9) {
              err.textContent = '🚚 ' + lbl9 + ' is not reachable in time: ~' + Math.round(cum9) + 'h driving from pickup' + (w.team_required ? ' (TEAM, nonstop)' : ' + HOS rest') + (i9 ? ' + dock time at earlier stops' : '') + '. Earliest realistic arrival: ' + fmt9(earliest9) + ' — move this stop later (or reorder the stops ▲▼ in step 1).';
              return;
            }
            clock9 = Math.max(spDt9.getTime(), earliest9.getTime()) + 2 * 3600 * 1000; // serve the dock ~2h
            prevLbl9 = lbl9; prevT9 = new Date(clock9);
          }
          const lastLeg9 = legs9 ? legs9[legs9.length - 1] : (w.__drive_hours / (XSv.length + 1));
          const finEarliest9 = new Date(clock9 + hos9f(lastLeg9) * 0.95 * 3600 * 1000);
          if (deDt < finEarliest9) {
            err.textContent = '🏁 Final delivery is too early for this multi-stop run: after serving ' + XSv.length + ' stop(s) the truck can realistically deliver by ' + fmt9(finEarliest9) + '. Move the delivery later' + (w.team_required ? '.' : ' — or switch to TEAM drivers:');
            if (!w.team_required) err.appendChild(h('button', { type: 'button', class: 'cp-btn cp-btn-sm', style: 'display:block;margin-top:8px', onClick: () => { w.team_required = true; renderStep(); } }, '\ud83d\udc65 Make this a TEAM load \u2014 2 drivers, nonstop (books at +20\u201330%)'));
            return;
          }
        }
        if (w.__drive_hours && w.__drive_hours > 0.5) {
          const hosT9 = w.__drive_hours + Math.floor(w.__drive_hours / 11) * 10;
          const days9 = Math.max(1, Math.ceil(hosT9 / 24));
          const minDt = new Date(puDt.getTime() + (w.team_required ? w.__drive_hours : hosT9) * 0.95 * 3600 * 1000);
          if (deDt < minDt) {
            err.textContent = 'Not possible for one driver: ~' + Math.round(w.__drive_hours) + 'h of driving means a ' + days9 + '-day trip under federal HOS rules (11h driving max, then 10h rest). Earliest realistic delivery: ' + minDt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '. ' + (w.team_required ? 'Even TEAM drivers cannot cover it \u2014 move the delivery later.' : 'Move the delivery later \u2014 or switch to TEAM drivers for nonstop driving:');
            if (!w.team_required) err.appendChild(h('button', { type: 'button', class: 'cp-btn cp-btn-sm', style: 'display:block;margin-top:8px', onClick: () => { w.team_required = true; renderStep(); } }, '\ud83d\udc65 Make this a TEAM load \u2014 2 drivers, nonstop (books at +20\u201330%)'));
            return;
          }
        }
        if (!w.__dup_ack) {
          let dups9 = [];
          try {
            const rows9 = (await partnerMyLoads(60)) || [];
            dups9 = rows9.filter(r9 => !/reject|cancel|deliver|complete|invoiced/.test(String(r9.status || '').toLowerCase())
              && String(r9.origin || '').toLowerCase() === String(w.origin || '').toLowerCase()
              && String(r9.destination || '').toLowerCase() === String(w.destination || '').toLowerCase()
              && String(r9.pickup_date || '') === String(w.pickup_date || ''));
          } catch (_) {}
          if (dups9.length) {
            err.textContent = '';
            err.appendChild(h('div', { style: 'background:#fef2f2;border:1.5px solid #fecaca;border-radius:14px;padding:12px 14px;text-align:left' }, [
              h('div', { style: 'font-weight:800;color:#991b1b;font-size:.86rem' }, '\u26a0 You already have ' + dups9.length + ' open load' + (dups9.length === 1 ? '' : 's') + ' with these details'),
              ...dups9.slice(0, 3).map(d9 => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;background:#fff;border:1px solid #fee2e2;border-radius:10px;padding:8px 11px;margin-top:7px;font-size:.8rem;flex-wrap:wrap' }, [
                h('span', null, [h('b', null, (d9.origin || '') + ' \u2192 ' + (d9.destination || '')), ' \u00b7 ' + (d9.equipment || '') + ' \u00b7 $' + Number(d9.rate || 0).toLocaleString() + ' \u00b7 PU ' + (d9.pickup_date || '')]),
                h('span', { style: 'font-weight:800;color:#92400e' }, String(d9.status || '')),
              ])),
              h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
                h('button', { type: 'button', class: 'cp-btn cp-btn-sm ghost', onClick: () => bgo('loads') }, '\ud83d\udccb View My Loads'),
                h('button', { type: 'button', class: 'cp-btn cp-btn-sm', onClick: () => { w.__dup_ack = true; err.textContent = ''; next.click(); } }, 'This is a DIFFERENT load \u2014 continue'),
              ]),
            ]));
            return;
          }
        }
        // derive the platform flags + carrier-facing text from the choices
        w.fcfs = w.sched_pu === 'FCFS';
        w.appointment_required = w.sched_pu === 'Appointment';
        if (w.sched_pu === 'Appointment') w.pickup_window = 'Appt ' + w.pu_appt;
        if (w.sched_del === 'Appointment') w.delivery_window = 'Appt ' + w.del_appt;
        w.dock_hours_pickup = w.sched_pu === 'Appointment' ? 'By appointment only' : ('FCFS ' + w.pickup_window);
        w.dock_hours_delivery = w.sched_del === 'Appointment' ? 'By appointment only' : ('FCFS ' + w.delivery_window);
      }
      if (step === 2) {
        const m2 = [];
        if (!w.equipment) m2.push('equipment');
        if (!w.load_size) m2.push('load size (FTL/partial)');
        if (!(w.commodity || '').trim()) m2.push('commodity');
        if (!w.weight || Number(w.weight) <= 0) m2.push('weight');
        if (!w.rate || Number(w.rate) <= 0) m2.push('rate');
        if (w.rate && w.miles && Number(w.miles) > 0 && w.__rpm_floor && w.__rpm_floor_eq === w.equipment) {
          const rpmNow = Number(w.rate) / Number(w.miles);
          if (rpmNow < w.__rpm_floor * 0.999) m2.push('rate is $' + rpmNow.toFixed(2) + '/mi \u2014 BELOW the industry minimum $' + w.__rpm_floor.toFixed(2) + '/mi for ' + w.equipment + '. Carriers will not book it and it hurts your acceptance record; raise it to at least $' + Math.ceil(w.__rpm_floor * Number(w.miles)).toLocaleString());
        }
        if (w.equipment === 'Reefer' && !(w.temperature || '').trim()) m2.push('reefer temperature');
        if (!w.load_method_pickup) m2.push('pickup loading method');
        if (!w.load_method_delivery) m2.push('delivery unloading method');
        if (directCarrier && w.equipment) {
          const eqs9 = await dirCarrierEq(directCarrier.id);
          if (eqs9 && eqs9.length && !eqs9.some(e => e.toLowerCase() === w.equipment.toLowerCase()))
            m2.push('\ud83c\udfaf ' + directCarrier.name + ' does NOT run ' + w.equipment + ' (their fleet: ' + eqs9.join(', ') + ') \u2014 change equipment or press \u201c\u2715 Remove target\u201d above');
        }
        const anySvc9 = w.load_method_pickup === 'Drop & hook' || w.load_method_delivery === 'Drop trailer' || w.lumper_any || w.driver_assist_required || w.team_required;
        if (anySvc9 && !w.svc_rates_ok) m2.push('agree to the industry-standard rates for the extra services you selected (checkbox)');
        if (m2.length) { err.textContent = 'Required: ' + m2.join(', ') + '.'; return; }
      }
      if (step === 3) {
        const missing = [];
        [['acc_detention_per_hr', 'detention rate'], ['acc_detention_free_hours', 'free hours'], ['acc_layover_per_day', 'layover rate'], ['acc_tonu', 'TONU rate']].forEach(([k, l]) => { if (w[k] === undefined || w[k] === '' || isNaN(Number(w[k])) || Number(w[k]) < 0) missing.push(l); });
        if (!w.acc_lumper_policy) missing.push('lumper policy');
        if (w.driver_assist_required && (w.acc_driver_assist === undefined || w.acc_driver_assist === '' || isNaN(Number(w.acc_driver_assist)) || Number(w.acc_driver_assist) <= 0)) missing.push('driver assist rate \u2014 you marked driver assist REQUIRED');
        if (w.lumper_any && w.acc_lumper_policy && /not covered/i.test(w.acc_lumper_policy)) missing.push('a lumper policy that covers the lumper \u2014 you marked a lumper stop, so \u201cNot covered\u201d is not allowed');
        if (w.hazmat_sel !== 'yes' && w.hazmat_sel !== 'no') missing.push('hazmat declaration (yes/no)');
        if (w.hazmat_sel === 'yes') {
          if (!/^\d{4}$/.test(w.hz_un || '')) missing.push('hazmat UN number (4 digits)');
          if (!w.hz_class) missing.push('hazard class (1\u20139)');
          if (!(w.hz_name || '').trim()) missing.push('proper shipping name');
          if (/^\d{4}$/.test(w.hz_un || '') && w.hz_class && (w.hz_name || '').trim())
            w.hazmat_info = 'UN' + w.hz_un + ' \u00b7 Class ' + w.hz_class + (w.hz_pg ? ' \u00b7 PG ' + w.hz_pg : '') + ' \u00b7 ' + w.hz_name.trim();
        }

        if (!w.acc_agreed) missing.push('agree to the LoadBoot standard accessorial rates (checkbox)');
        if (!w.emg_policy_ok) missing.push('Emergency Rescheduling Policy acceptance (required)');
        if (w.hazmat_sel === 'yes' && directCarrier) {
          const c9 = await dirCarrierInfo(directCarrier.id);
          if (c9 && c9.hazmat === false) missing.push('\ud83c\udfaf ' + directCarrier.name + ' is NOT hazmat-certified \u2014 remove the direct target or make the load non-hazmat');
        }
        if (missing.length) { err.textContent = 'Required before posting: ' + missing.join(', ') + '.'; return; }
      }
      if (step < STEPS.length - 1) { step++; renderStep(); return; }
      next.disabled = true; next.textContent = 'Submitting…';
      try {
        const payload = Object.assign({}, w, confirmDup ? { confirm_duplicate: 'true' } : {});
        const shortAddr = (a) => { const s1 = String(a || '').replace(/\s*\d{5}(-\d{4})?\s*$/, '').replace(/,\s*(USA|United States)\s*$/i, '').trim(); const parts = s1.split(',').map((x) => x.trim()).filter(Boolean); return parts.length >= 2 ? parts.slice(-2).join(', ') : s1; };
        payload.origin_full = w.origin_full || w.origin || '';
        payload.destination_full = w.destination_full || w.destination || '';
        payload.origin = shortAddr(payload.origin_full);
        payload.destination = shortAddr(payload.destination_full);
        payload.hazmat = w.hazmat_sel === 'yes' ? 'true' : 'false';
        payload.hazmat_info = w.hazmat_info || null;
        payload.accessorials = { detention_per_hr: String(w.acc_detention_per_hr), detention_free_hours: String(w.acc_detention_free_hours), layover_per_day: String(w.acc_layover_per_day), tonu: String(w.acc_tonu), driver_assist: w.acc_driver_assist ? String(w.acc_driver_assist) : null, extra_stop: w.acc_extra_stop ? String(w.acc_extra_stop) : null, lumper_policy: w.acc_lumper_policy, lumper_at: [w.lumper_pickup ? 'pickup' : null, w.lumper_delivery ? 'delivery' : null].filter(Boolean).join(',') || null, driver_assist_at: [w.assist_pickup ? 'pickup' : null, w.assist_delivery ? 'delivery' : null].filter(Boolean).join(',') || null, fcfs: w.fcfs ? 'true' : 'false' };
        ['acc_detention_per_hr', 'acc_detention_free_hours', 'acc_layover_per_day', 'acc_tonu', 'acc_driver_assist', 'acc_extra_stop', 'acc_lumper_policy'].forEach(k => delete payload[k]);
        if (window.__lbAgentOrg) payload.details_load_source = null; // marker (details built below)
        payload.stops = (Array.isArray(w.stops) ? w.stops.filter((sp) => sp && sp.lat && sp.lng) : []);
        payload.details = { load_source: window.__lbAgentOrg ? { type: w.src_type || null, company: (w.src_company || '').trim() || null, mc: (w.src_mc || '').trim() || null, contact: (w.src_contact || '').trim() || null, email: (w.src_email || '').trim() || null, phone: (w.src_phone || '').trim() || null } : undefined, stops: payload.stops, load_size: w.load_size || null, pallets: w.pallets || null, temperature: w.temperature || null, tarps: w.tarps || null,
          load_method_pickup: w.load_method_pickup || null, load_method_delivery: w.load_method_delivery || null,
          driver_assist_required: !!w.driver_assist_required, team_required: !!w.team_required, cargo_value: w.cargo_value || null,
          dock_hours_pickup: w.dock_hours_pickup || null, dock_hours_delivery: w.dock_hours_delivery || null,
          facility_contact_pickup: (w.fac_pu || '').trim() || null, facility_contact_delivery: (w.fac_del || '').trim() || null };
        const docs9 = {};
        const xsPu9 = (Array.isArray(w.stops) ? w.stops : []).filter((sp9) => sp9.kind === 'pickup' && (sp9.doc_number || '').trim()).map((sp9, k9) => 'Extra pickup S' + (sp9.seq || k9 + 1) + ': ' + sp9.doc_number.trim());
        const xsDn9 = (Array.isArray(w.stops) ? w.stops : []).filter((sp9) => sp9.kind !== 'pickup' && (sp9.doc_number || '').trim()).map((sp9, k9) => 'Extra delivery S' + (sp9.seq || k9 + 1) + ': ' + sp9.doc_number.trim());
        const xsAc9 = (Array.isArray(w.stops) ? w.stops : []).filter((sp9) => (sp9.doc_appt || '').trim()).map((sp9, k9) => 'Stop S' + (sp9.seq || k9 + 1) + ' appt #: ' + sp9.doc_appt.trim());
        if ((w.doc_pu || '').trim() || xsPu9.length) docs9.pickup_number = [(w.doc_pu || '').trim() ? 'Pickup / PU number: ' + w.doc_pu.trim() : null, ...xsPu9].filter(Boolean).join(' \u00b7 ');
        if ((w.doc_dn || '').trim() || xsDn9.length) docs9.delivery_number = [(w.doc_dn || '').trim() ? 'Delivery number: ' + w.doc_dn.trim() : null, ...xsDn9].filter(Boolean).join(' \u00b7 ');
        if ((w.doc_ac || '').trim() || (w.doc_at || '').trim() || xsAc9.length) docs9.appointment_confirmation = [(w.doc_ac || '').trim() ? 'Confirmation #: ' + w.doc_ac.trim() : null, (w.doc_at || '').trim() ? 'Confirmed time: ' + w.doc_at.trim() : null, ...xsAc9].filter(Boolean).join(' \u00b7 ');
        if ((w.doc_bn || '').trim() && (w.doc_be || '').trim()) {
          docs9.billing_contact = ['Contact name: ' + w.doc_bn.trim(), 'Email: ' + w.doc_be.trim(), (w.doc_bp || '').trim() ? 'Phone: ' + w.doc_bp.trim() : null].filter(Boolean).join(' \u00b7 ');
          try { localStorage.setItem('lb:billing', JSON.stringify({ bn: w.doc_bn.trim(), be: w.doc_be.trim(), bp: (w.doc_bp || '').trim() })); } catch (_) {}
        }
        ['doc_pu', 'doc_dn', 'doc_ac', 'doc_at', 'doc_bn', 'doc_be', 'doc_bp', '__billInit'].forEach(k => delete payload[k]);
        if (Object.keys(docs9).length) payload.docs = docs9;
        if (directCarrier) { payload.details.direct_carrier_id = directCarrier.id; payload.details.direct_carrier_name = directCarrier.name; payload.details.direct_wait_minutes = w.direct_wait_minutes || '15'; }
        await partnerSubmitLoad(payload);
        err.className = 'cp-err ok'; err.textContent = '✓ Load submitted' + (directCarrier ? ' \u2014 \ud83c\udfaf direct offer to ' + directCarrier.name + ' fires automatically when dispatch posts it' : '') + ' \u2014 our dispatch team will review it and generate the document checklist.'; directCarrier = null;
        for (const k in w) delete w[k]; w.appointment_required = false; w.tracking_required = false; step = 0; confirmDup = false; renderStep(); loadList();
      } catch (e) {
        const msg = (e && e.message) || 'Could not submit the load.';
        if (/duplicate/i.test(msg)) { confirmDup = true; err.textContent = 'Possible duplicate in the last 24h. Press “Submit anyway” to proceed.'; renderStep(); }
        else { next.disabled = false; next.textContent = nextLbl; err.textContent = msg; }
      }
    } }, nextLbl);
    mount(stepHost, h('div', null, [
      (() => {
        if (!document.getElementById('plw-css')) {
          const st9 = document.createElement('style'); st9.id = 'plw-css';
          st9.textContent = `
            .plw-ring{transform:rotate(-90deg)}
            .plw-ring .tr{fill:none;stroke:#eef2f7;stroke-width:5}
            .plw-ring .pr{fill:none;stroke:url(#plwGrad);stroke-width:5;stroke-linecap:round;transition:stroke-dashoffset .45s cubic-bezier(.4,0,.2,1)}
            .plw-slide-r{animation:plwR .32s cubic-bezier(.2,.7,.3,1)}
            .plw-slide-l{animation:plwL .32s cubic-bezier(.2,.7,.3,1)}
            @keyframes plwR{from{opacity:0;transform:translateX(34px)}to{opacity:1;transform:none}}
            @keyframes plwL{from{opacity:0;transform:translateX(-34px)}to{opacity:1;transform:none}}
          `;
          document.head.appendChild(st9);
        }
        const frac = step / (STEPS.length - 1);
        const C9 = 2 * Math.PI * 20;
        const ringWrap = h('div', { style: 'position:relative;width:52px;height:52px;flex:0 0 auto' });
        ringWrap.innerHTML = '<svg class="plw-ring" width="52" height="52" viewBox="0 0 52 52">'
          + '<defs><linearGradient id="plwGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0883F7"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs>'
          + '<circle class="tr" cx="26" cy="26" r="20"/>'
          + '<circle class="pr" cx="26" cy="26" r="20" stroke-dasharray="' + C9.toFixed(2) + '" stroke-dashoffset="' + (C9 * (1 - frac)).toFixed(2) + '"/></svg>'
          + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.66rem;font-weight:800;color:#10223B">' + Math.round(frac * 100) + '%</div>';
        return h('div', { style: 'margin-bottom:14px' }, [
          h('div', { class: 'cp-wiz-head', style: 'align-items:center' }, [
            h('div', { style: 'display:flex;gap:12px;align-items:center' }, [
              ringWrap,
              h('div', null, [
                h('h3', { style: 'margin:0' }, 'Step ' + (step + 1) + ' of ' + STEPS.length + ' \u2014 ' + STEPS[step]),
                h('div', { class: 'cp-sub', style: 'margin-top:2px' }, ['Exact facility addresses \u2014 real miles calculate automatically.', 'Windows & dock hours \u2014 the carrier plans the whole day around these.', 'Equipment & freight \u2014 what the truck must be able to carry.', 'Your rate card \u2014 a carrier books without a single phone call.', 'One last look \u2014 then it goes to dispatch.'][step] || ''),
              ]),
            ]),
            step > 0 ? h('span', { class: 'cp-row-s', style: 'white-space:nowrap' }, STEPS[step - 1] + ' \u2713') : null,
          ].filter(Boolean)),
          h('div', { class: 'cp-wiz-bar', style: 'margin-top:10px' }, h('div', { class: 'cp-wiz-fill', style: 'background:linear-gradient(90deg,#0883F7,#22c55e);width:' + Math.round(frac * 100) + '%' })),
        ]);
      })(),
      directCarrier ? (() => {
        const wsel = h('select', { class: 'cp-in', style: 'margin:0;max-width:220px' },
          [['15', '\u23f1 Wait 15 minutes (standard)'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['120', '2 hours'], ['240', '4 hours']].map(([v9, t9]) => h('option', { value: v9 }, t9)));
        wsel.value = w.direct_wait_minutes || '15';
        wsel.onchange = () => { w.direct_wait_minutes = wsel.value; renderStep(); };
        return h('div', { style: 'background:#eff6ff;border:1.5px solid #93c5fd;border-radius:13px;padding:10px 14px;margin-bottom:10px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap' }, [
            h('div', { style: 'font-size:.84rem;color:#1e40af' }, [h('b', null, '\ud83c\udfaf Direct target: ' + directCarrier.name), h('span', null, ' \u2014 the moment dispatch posts this load, a direct offer with YOUR wait window goes to this carrier. A live countdown runs on both sides; if it expires unanswered, the load stays available. First acceptance wins.')]),
            h('button', { type: 'button', class: 'cp-btn ghost cp-btn-sm', onClick: () => { directCarrier = null; renderStep(); } }, '\u2715 Remove target'),
          ]),
          h('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap' }, [
            h('span', { style: 'font-size:.78rem;font-weight:700;color:#1e40af' }, 'How long should we hold the offer for this carrier?'), wsel,
          ]),
        ]);
      })() : null,
      h('div', { class: 'cp-wiz-body ' + (step >= prevStep ? 'plw-slide-r' : 'plw-slide-l') }, body), err,
      h('div', { class: 'cp-wiz-actions' }, [step > 0 ? back : h('span'), next]),
    ]));
    if (step !== prevStep) { try { requestAnimationFrame(function () { var _c = stepHost.closest('.cp-card') || stepHost; var _y = _c.getBoundingClientRect().top + window.pageYOffset - 90; window.scrollTo({ top: _y < 0 ? 0 : _y, behavior: 'smooth' }); }); } catch (_) {} }
    prevStep = step;
  }
  renderStep();
  const form = h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [icon('plus', 18), h('h3', null, 'Post a load')]),
    stepHost,
  ]);
  async function loadList() {
    try {
      const rows = await partnerMyLoads(50);
      let __bq9 = {};
      try { ((await bookRequestsQueue('pending')) || []).forEach(r9 => { const k9 = [r9.origin, r9.destination, r9.equipment].join('|'); (__bq9[k9] = __bq9[k9] || []).push(r9); }); } catch (_) {}
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No loads yet. Post your first load above.')); return; }
      // Mobile-first load cards with a lifecycle stepper (submitted -> posted -> booked -> delivered).
      const BSTEPS = [['submitted', 'Submitted'], ['posted', 'Posted'], ['booked', 'Booked'], ['delivered', 'Delivered']];
      const bIdx = (l) => {
        const t = (String(l.status || '') + ' ' + String(l.board_status || '')).toLowerCase();
        if (/deliver|complete|invoiced/.test(t)) return 3;
        if (l.carrier || /booked|assigned|covered|transit/.test(t)) return 2;
        if (/available|posted/.test(t)) return 1;
        return 0;
      };
      mount(listHost, h('div', null, rows.map(l => {
        const idx = bIdx(l);
        const stepper = h('div', { style: 'display:flex;gap:5px;margin:10px 0 4px' }, BSTEPS.map(([k, label], i) =>
          h('div', { style: 'flex:1;text-align:center' }, [
            h('div', { style: 'height:5px;border-radius:99px;background:' + (i <= idx ? '#0883F7' : '#e2e8f0') }),
            h('div', { style: 'font-size:10px;margin-top:4px;color:' + (i <= idx ? '#0883F7' : '#94a3b8') + ';font-weight:' + (i === idx ? '700' : '500') }, label),
          ])));
        return h('div', { class: 'cp-card', style: 'margin-bottom:10px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap' }, [
            h('div', null, [
              h('div', { style: 'font-weight:800;font-size:15px' }, (l.origin || '—') + ' → ' + (l.destination || '—')),
              h('div', { class: 'cp-sub' }, [l.equipment || null, l.rate ? money(l.rate) : null, l.carrier ? 'Carrier: ' + l.carrier : null].filter(Boolean).join(' · ')),
            ]),
            pill(l.status),
          ]),
          stepper,
          h('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center' }, [
            (() => {
              const rqs9 = __bq9[[l.origin, l.destination, l.equipment].join('|')] || [];
              if (!rqs9.length || /book|deliver|cancel/.test(String(l.status || '') + String(l.board_status || ''))) return null;
              const openReqs9 = () => {
                const host9 = h('div');
                const closeR9 = openModal('\ud83d\ude9a ' + rqs9.length + ' booking request' + (rqs9.length === 1 ? '' : 's') + ' \u2014 ' + (l.origin || '') + ' \u2192 ' + (l.destination || ''), [
                  h('div', { class: 'cp-sub', style: 'margin-bottom:10px' }, 'First approval wins \u2014 the load books instantly, every other request closes automatically, rate con + dispatch pack fire on their own.'),
                  host9,
                ], { wide: true });
                mount(host9, rqs9.map((rq9, i9) => {
                  const t9 = rq9.trust || {};
                  const exp9 = rq9.expires_at ? Math.max(0, Math.round((new Date(rq9.expires_at).getTime() - Date.now()) / 60000)) : null;
                  const err9 = h('div', { style: 'display:none;width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:9px 12px;font-size:.82rem;color:#991b1b' });
                return h('div', { style: 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:#fff;border:1.5px solid ' + (i9 === 0 ? '#fdba74' : '#e2e8f0') + ';border-radius:16px;padding:14px 16px;margin-bottom:10px;box-shadow:0 10px 28px -24px rgba(2,12,30,.35)' }, [
                    h('div', { style: 'width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;font-weight:800;font-size:1.1rem;display:flex;align-items:center;justify-content:center;flex:none' }, String(rq9.carrier || 'C').replace(/Carrier /, '').charAt(0)),
                    h('div', { style: 'min-width:0;flex:1' }, [
                      h('div', { style: 'font-weight:800;color:#10223B' }, rq9.carrier || 'Carrier'),
                      h('div', { class: 'cp-sub' }, [
                        t9.trust_score != null ? '\u2b50 Trust ' + t9.trust_score + '/100' : null,
                        t9.docs_verified != null ? t9.docs_verified + '/' + t9.docs_required + ' docs verified' : null,
                        t9.on_time_pct != null ? t9.on_time_pct + '% on-time' : null,
                        t9.deliveries != null ? t9.deliveries + ' deliveries' : null,
                        exp9 != null ? '\u23f3 expires in ' + exp9 + 'm' : null,
                      ].filter(Boolean).join(' \u00b7 ')),
                      rq9.note ? h('div', { class: 'cp-sub', style: 'font-style:italic;margin-top:2px' }, '\u201c' + rq9.note + '\u201d') : null,
                    ]),
                    h('div', { style: 'display:flex;gap:8px;flex:none' }, [
                      h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a;color:#fff;font-weight:800;padding:9px 18px', onClick: async (e9) => {
                        e9.currentTarget.disabled = true; e9.currentTarget.textContent = 'Booking\u2026';
                        try { await decideBookRequest(rq9.id, 'approve', null); closeR9(); pToast('\u2713 Booked to ' + (rq9.carrier || 'the carrier') + ' \u2014 rate con + dispatch pack fire automatically; other requests closed.', { kind: 'ok', title: '\ud83d\ude9a Booked' }); loadList(); }
                        catch (e2) {
                          e9.currentTarget.disabled = false; e9.currentTarget.textContent = '\u2713 Approve & book';
                          const m9 = (e2 && e2.message) || 'Failed';
                          err9.style.display = 'block';
                          mount(err9, h('div', null, [
                            h('div', null, '\u26a0 ' + m9),
                            /rate conf/i.test(m9) ? h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:7px', onClick: () => { closeR9(); brokerDocs(l); } }, '\ud83d\udcc4 Open Docs \u2014 sign the rate confirmation') : null,
                          ].filter(Boolean)));
                        }
                      } }, '\u2713 Approve & book'),
                      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (e9) => {
                        const why9 = prompt('Optional \u2014 reason for declining (the carrier sees this):') || null;
                        e9.currentTarget.disabled = true;
                        try { await decideBookRequest(rq9.id, 'decline', why9); rqs9.splice(i9, 1); if (!rqs9.length) { closeR9(); } loadList(); }
                        catch (e2) { e9.currentTarget.disabled = false; alert((e2 && e2.message) || 'Failed'); }
                      } }, 'Decline'),
                    ]),
                    err9,
                  ]);
                }));
              };
              return h('button', { style: 'width:100%;display:flex;align-items:center;gap:12px;background:linear-gradient(120deg,#fff7ed,#ffedd5 70%,#fed7aa);border:1.5px solid #fdba74;border-radius:14px;padding:11px 16px;cursor:pointer;text-align:left', onClick: openReqs9 }, [
                h('span', { style: 'position:relative;display:inline-flex' }, [
                  h('span', { style: 'width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:1.05rem;box-shadow:0 6px 16px -6px rgba(234,88,12,.6)' }, '\ud83d\ude9a'),
                  h('span', { style: 'position:absolute;top:-6px;right:-7px;background:#dc2626;color:#fff;font-size:.62rem;font-weight:800;border-radius:999px;min-width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;border:2px solid #fff' }, String(rqs9.length)),
                ]),
                h('span', { style: 'min-width:0;flex:1' }, [
                  h('span', { style: 'display:block;font-weight:800;font-size:.88rem;color:#9a3412' }, rqs9.length === 1 ? ('Booking request \u2014 ' + (rqs9[0].carrier || 'carrier') + (rqs9[0].trust && rqs9[0].trust.trust_score != null ? ' \u00b7 Trust ' + rqs9[0].trust.trust_score + '/100' : '')) : rqs9.length + ' carriers want this load'),
                  h('span', { style: 'display:block;font-size:.72rem;color:#b45309;font-weight:600' }, 'Tap to compare & approve \u2014 first approval wins, the rest close automatically'),
                ]),
                h('span', { class: 'cp-btn cp-btn-sm', style: 'background:#ea580c;color:#fff;font-weight:800;flex:none;pointer-events:none' }, 'Review \u2192'),
              ]);
            })(),
            ((l.offers_pending || 0) > 0 && l.offer_expiry) ? (() => {
              const chip9 = h('span', { style: 'padding:6px 14px;border-radius:999px;font-size:.76rem;font-weight:800;background:#ede9fe;color:#6d28d9' });
              const lbl9 = l.direct_carrier ? ('\ud83c\udfaf Requested to ' + l.direct_carrier) : ('\ud83d\udce3 Offered to ' + l.offers_pending + ' carrier' + (l.offers_pending === 1 ? '' : 's'));
              const tick9 = () => {
                const ms9 = new Date(l.offer_expiry).getTime() - Date.now();
                if (ms9 <= 0) { chip9.textContent = lbl9 + ' \u00b7 expired \u2014 refreshing\u2026'; clearInterval(chip9.__t9); setTimeout(() => loadList(), 1500); return; }
                const m9 = Math.floor(ms9 / 60000), s9 = Math.floor((ms9 % 60000) / 1000);
                chip9.textContent = lbl9 + ' \u00b7 \u23f3 ' + m9 + ':' + String(s9).padStart(2, '0');
              };
              tick9(); chip9.__t9 = setInterval(() => { if (!chip9.isConnected) { clearInterval(chip9.__t9); return; } tick9(); }, 1000);
              const x9 = h('button', { title: 'Withdraw this request \u2014 the carrier is notified and the load returns to the open board', style: 'border:1.5px solid #ddd6fe;background:#fff;color:#6d28d9;font-weight:900;border-radius:50%;width:22px;height:22px;line-height:1;cursor:pointer;font-size:.72rem;flex:none;display:inline-flex;align-items:center;justify-content:center', onClick: async () => {
                if (!confirm('Withdraw this request' + (l.direct_carrier ? ' to ' + l.direct_carrier : '') + '?\n\nThe carrier will be notified and the load goes back to the open load board for everyone.')) return;
                x9.disabled = true;
                try { await partnerOfferWithdraw(l.id); loadList(); }
                catch (e9) { x9.disabled = false; alert((e9 && e9.message) || 'Could not withdraw.'); }
              } }, '\u2715');
              return h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, [chip9, x9]);
            })() : null,
            ((l.offers_pending || 0) > 0 && l.offer_expiry) ? (() => {
              const ext9 = h('select', { class: 'cp-in', style: 'margin:0;max-width:170px;padding:6px 10px;font-size:.76rem' },
                [['', '\u23f3 Need more time?'], ['15', '+15 minutes'], ['30', '+30 minutes'], ['60', '+1 hour'], ['120', '+2 hours']].map(([v9, t9]) => h('option', { value: v9 }, t9)));
              ext9.onchange = async () => {
                const mins9 = Number(ext9.value); if (!mins9) return;
                ext9.disabled = true;
                try { const r9 = await partnerExtendOffer(l.id, mins9); alert('\u23f3 Window extended \u2014 the carrier was notified. New expiry: ' + new Date(r9.new_expiry).toLocaleTimeString()); loadList(); }
                catch (e9) { ext9.disabled = false; ext9.value = ''; alert((e9 && e9.message) || 'Could not extend.'); }
              };
              return ext9;
            })() : null,
            (!((l.offers_pending || 0) > 0) && String(l.board_status || '') === 'available' && !lbExpiredP(l)) ? h('span', { style: 'padding:6px 14px;border-radius:999px;font-size:.76rem;font-weight:800;background:#dcfce7;color:#166534' }, '\ud83d\udfe2 On load board') : null,
            (/book/.test(String(l.board_status || '') + String(l.status || ''))) ? h('button', { style: 'padding:6px 14px;border-radius:999px;font-size:.76rem;font-weight:800;background:#eff6ff;color:#1d4ed8;border:1.5px solid #bfdbfe;cursor:pointer', title: 'View this carrier\u2019s full profile & packet', onClick: async () => {
              try { if (!__dirCache) __dirCache = (await partnerCarrierDirectory()) || []; } catch (_) { __dirCache = __dirCache || []; }
              const c9 = (__dirCache || []).find(x9 => x9.name && l.carrier && x9.name.toLowerCase() === String(l.carrier).toLowerCase());
              if (c9) openCarrierFullProfile(c9, null); else openCarrierPacket(l);
            } }, '\u2713 Booked by ' + (l.carrier || 'carrier') + ' \u2014 view profile') : null,
            (!((l.offers_pending || 0) > 0) && String(l.board_status || '') !== 'available' && idx < 2 && !/cancel|reject|book/.test((String(l.status || '') + String(l.board_status || '')).toLowerCase())) ? h('span', { style: 'padding:6px 14px;border-radius:999px;font-size:.76rem;font-weight:800;background:#fef3c7;color:#92400e' }, '\u23f3 Board: with dispatch') : null,
            lbExpiredP(l) ? h('span', { style: 'padding:6px 14px;border-radius:999px;font-size:.76rem;font-weight:800;background:#fef2f2;color:#b91c1c;border:1.5px solid #fecaca' }, '\u23f0 EXPIRED \u2014 pickup time passed, update it') : null,
            (/book|deliver/.test((String(l.status || '') + String(l.board_status || '')).toLowerCase()) && idx < 8) ? (() => {
              const dchip9 = h('span');
              (async () => {
                try {
                  const items9 = ((await loadChecklist('partner_load', l.id)) || []).filter(it9 => it9.required_from === 'broker' && ['required', 'rejected'].indexOf(String(it9.status || '')) >= 0);
                  if (!items9.length || !dchip9.parentNode) return;
                  dchip9.replaceWith(h('button', {
                    style: 'padding:6px 14px;border-radius:999px;font-size:.76rem;font-weight:800;background:#fffbeb;color:#92400e;border:1.5px solid #fcd34d;cursor:pointer;animation:pulse 2s infinite',
                    title: items9.map(it9 => it9.label).join(', '),
                    onClick: () => brokerDocs(l),
                  }, '\ud83d\udccb Finalizing details \u2014 ' + items9.length + ' doc' + (items9.length === 1 ? '' : 's') + ' missing \u00b7 provide now'));
                } catch (_) {}
              })();
              return dchip9;
            })() : null,
            ((l.cancel_count || 0) > 0) ? h('button', { style: 'padding:6px 14px;border-radius:999px;font-size:.76rem;font-weight:800;background:#fef2f2;color:#b91c1c;border:1.5px solid #fecaca;cursor:pointer', title: 'View who cancelled, why, and the GPS evidence — kept even after the load is re-posted', onClick: () => openCancellationHistory(l) }, '⟲ ' + l.cancel_count + ' prior cancellation' + (l.cancel_count === 1 ? '' : 's') + ' — view history') : null,
          ].filter(Boolean)),
          (() => {
            const rh = h('div');
            const committed9 = idx >= 2 || /book|transit/.test((String(l.status || '') + String(l.board_status || '')).toLowerCase());
            if (committed9) (async () => {
              let a; try { a = await loadPickupStatus(l.id); } catch (_) { return; }
              if (!a || (a.risk !== 'at_risk' && a.risk !== 'late')) return;
              const isLate = a.risk === 'late';
              mount(rh, h('div', { style: 'margin-top:8px;padding:10px 12px;border-radius:10px;background:' + (isLate ? '#fef2f2' : '#fffbeb') + ';border:1px solid ' + (isLate ? '#fecaca' : '#fde68a') + ';color:' + (isLate ? '#991b1b' : '#92400e') + ';font-size:.85rem;line-height:1.5' }, [
                h('b', null, isLate ? '\ud83d\udd34 Pickup is late \u2014 driver still not moving' : '\u26a0 Carrier has not departed \u2014 pickup at risk'),
                h('div', { style: 'margin-top:2px' }, (a.distance_mi ? 'Truck ~' + a.distance_mi + ' mi out (~' + a.eta_h + 'h drive). ' : '') + 'You can wait, or Cancel below \u2014 if the driver never moved toward pickup, no TONU is owed.'),
              ]));
            })();
            return rh;
          })(),
          h('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
            lbExpiredP(l) ? null : h('button', { class: 'cp-btn cp-btn-sm', onClick: () => openLoadTracker(l) }, '\ud83d\udef0 Track live'),
            lbExpiredP(l) ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#f59e0b;color:#fff', onClick: () => openReschedule(l, loadList) }, '\u23f0 Update pickup time') : null,
            h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => brokerDocs(l) }, '📄 Docs'),
            (() => {
              const booked9 = /book|transit|deliver|complete|invoiced/.test((String(l.status || '') + ' ' + String(l.board_status || '')).toLowerCase());
              if (!(idx < 2 || booked9)) return null;
              return booked9
                ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a', onClick: () => openCarrierPacket(l) }, '\ud83d\udd13 Carrier packet \u2014 UNLOCKED')
                : h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'opacity:.75', title: 'W-9, COI, authority, signed agreement \u2014 released the moment a carrier accepts', onClick: () => openCarrierPacket(l) }, '\ud83d\udd12 Carrier packet \u2014 unlocks on acceptance');
            })(),
            (idx < 2 && !lbExpiredP(l) && !/cancel/.test(String(l.status || '').toLowerCase())) ? h('button', { class: 'cp-btn cp-btn-sm', title: String(l.board_status || '') === 'available' ? 'Send direct offers on top of the board listing' : 'Direct offers unlock once dispatch posts the load', onClick: () => openOfferPicker(l, loadList) }, '\ud83c\udfaf Offer to specific carriers') : null,
            (!/cancel|deliver|complete|invoiced/.test(String(l.status || '').toLowerCase())) ? h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'color:#b91c1c', onClick: () => {
              openCancelLoadModal(l, idx >= 2, () => loadList());
            } }, '\u2715 Cancel') : null,
          ].filter(Boolean)),
        ]);
      })));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load.')); }
  }

  // Full decision profile for ONE carrier — usable from the offer picker (and anywhere else).
  function openCarrierFullProfile(c, logoBase) {
    const initials = (nm) => String(nm || '?').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
    const starsTxt = (v) => '\u2605'.repeat(Math.round(v || 0)) + '\u2606'.repeat(Math.max(0, 5 - Math.round(v || 0)));
    const chip9 = (txt, bg, fg) => h('span', { style: 'display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:999px;font-size:.7rem;font-weight:700;background:' + (bg || '#f1f5f9') + ';color:' + (fg || '#334155') + ';border:1px solid #e2e8f0' }, txt);
    const sec9 = (label, kids) => (kids && kids.length) ? h('div', { style: 'margin:9px 0' }, [h('div', { style: 'font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;font-weight:800;margin-bottom:5px' }, label), h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, kids)]) : null;
    const health = c.health != null ? Number(c.health) : null;
    const hFg = health == null ? '#7c8aa0' : health >= 85 ? '#16a34a' : health >= 60 ? '#d97706' : '#dc2626';
    const kpi9 = (l9, v9, fg) => h('div', { style: 'background:#f8fafc;border:1px solid #e9eef5;border-radius:13px;padding:9px 4px;text-align:center' }, [h('b', { style: 'display:block;font-size:1rem;font-weight:800;color:' + (fg || '#10223B') }, v9), h('span', { style: 'font-size:.58rem;text-transform:uppercase;letter-spacing:.07em;color:#7c8aa0;font-weight:800' }, l9)]);
    const mix9 = (c.fleet_mix || []).filter(m => m.type && /[a-zA-Z]{2,}/.test(m.type));
    const logo = (c.logo_path && logoBase) ? (logoBase + c.logo_path) : null;
    const revHost = h('div');
    openModal('Carrier profile \u2014 assign with confidence', [h('div', null, [
      h('div', { style: 'display:flex;gap:12px;align-items:center;margin-bottom:6px;flex-wrap:wrap' }, [
        h('div', { style: 'width:64px;height:64px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.2rem;color:#fff;background:linear-gradient(135deg,#0883F7,#10223B);overflow:hidden;flex:0 0 auto' }, logo ? h('img', { src: logo, style: 'width:100%;height:100%;object-fit:cover' }) : initials(c.name)),
        h('div', { style: 'min-width:0;flex:1' }, [
          h('div', { style: 'font-weight:800;font-size:1.1rem;color:#10223B' }, c.name || 'Carrier'),
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:4px' }, [
            chip9('\u2713 LOADBOOT VERIFIED', '#dcfce7', '#166534'),
            ((c.compliance || []).length >= 3) ? h('button', { style: 'display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:999px;font-size:.7rem;font-weight:700;background:#ede9fe;color:#6d28d9;border:0;cursor:pointer', onClick: () => openCarrierPacketPreview(c) }, '\ud83d\udce6 Carrier packet \ud83d\udd12') : null,
            c.out_of_service ? chip9('\u26d4 OUT OF SERVICE', '#fee2e2', '#991b1b') : null,
            c.available === false ? chip9('\u23f8 NOT ACCEPTING', '#fef3c7', '#92400e') : null,
            chip9('since ' + (c.member_since || '\u2014')),
          ].filter(Boolean)),
          h('div', { style: 'font-size:.82rem;font-weight:700;color:#f59e0b;margin-top:4px' }, (c.ratings_count || 0) > 0 ? (starsTxt(c.stars) + ' ' + c.stars + ' \u00b7 ' + c.ratings_count + ' trip-verified review' + (c.ratings_count === 1 ? '' : 's')) : h('span', { style: 'color:#94a3b8;font-weight:600' }, '\u2728 New on LoadBoot \u2014 not rated yet')),
        ]),
      ]),
      h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:10px 0' }, [
        kpi9('On-time', c.on_time_pct != null ? c.on_time_pct + '%' : 'New', c.on_time_pct != null ? (c.on_time_pct >= 90 ? '#16a34a' : '#d97706') : '#94a3b8'),
        kpi9('Delivered', String(c.delivered || 0)),
        kpi9('Cancels', String(c.carrier_cancels || 0), (c.carrier_cancels || 0) > 0 ? '#dc2626' : '#16a34a'),
        kpi9('Health', health != null ? String(health) : '\u2014', hFg),
      ]),
      sec9('FMCSA \u00b7 authority', [
        c.dot ? chip9('DOT ' + String(c.dot).replace(/^DOT\s*/i, '')) : null,
        c.mc ? chip9('MC ' + String(c.mc).replace(/^MC\s*/i, '')) : null,
        c.authority ? chip9('Authority: ' + String(c.authority).toUpperCase(), String(c.authority).toLowerCase() === 'active' ? '#dcfce7' : '#fef3c7', String(c.authority).toLowerCase() === 'active' ? '#166534' : '#92400e') : null,
        (c.safety_rating && String(c.safety_rating).toLowerCase() !== 'none') ? chip9('Safety: ' + String(c.safety_rating).toUpperCase()) : null,
        c.power_units ? chip9(c.power_units + ' power units') : null,
        c.driver_count ? chip9(c.driver_count + ' drivers') : null,
      ].filter(Boolean)),
      sec9('Fleet \u2014 what they run', mix9.map(m => chip9('\ud83d\ude9b ' + m.type + (m.n > 1 ? ' \u00d7 ' + m.n : ''), '#eff6ff', '#1d4ed8'))
        .concat((!mix9.length ? (c.preferred_equipment || []).filter(e => /[a-zA-Z]{2,}/.test(e)).map(e => chip9('\ud83d\ude9b ' + e, '#eff6ff', '#1d4ed8')) : []))
        .concat(((c.trailer_mix || []).filter(m => m.type && /[a-zA-Z]{2,}/.test(m.type))).map(m => chip9('\ud83d\udee3 ' + m.type + (m.n > 1 ? ' \u00d7 ' + m.n : ''), '#eff6ff', '#1d4ed8')))),
      sec9('Coverage', [
        c.home_base ? chip9('\ud83d\udccd ' + c.home_base) : null,
        (c.preferred_lanes || []).length ? chip9('Runs: ' + c.preferred_lanes.join(', ')) : null,
      ].filter(Boolean)),
      (c.compliance || []).length ? sec9('Compliance on file', c.compliance.map(x => chip9('\u2713 ' + x, '#f0fdf4', '#166534'))) : null,
      (() => {
        const has9 = (re) => (c.compliance || []).some(x => re.test(String(x)));
        const items9 = [
          ['\ud83e\uddfe', 'Executed rate confirmation', true, 'auto-generated & signed at booking'],
          ['\ud83d\udee1', 'Certificate of Insurance \u2014 $1M auto liability \u00b7 $100k cargo (industry standard)', has9(/insurance|coi/i), has9(/insurance|coi/i) ? 'verified on file \u2014 lands in your packet' : 'not on file yet \u2014 LoadBoot collects it before first dispatch'],
          ['\ud83d\udcc4', 'W-9 tax form', has9(/w-?9/i), has9(/w-?9/i) ? 'verified on file' : 'collected before settlement'],
          ['\ud83d\udcdc', 'MC/DOT operating authority letter', has9(/authority/i), has9(/authority/i) ? 'verified on file' : 'verified live against FMCSA'],
          ['\u270d', 'Signed broker\u2013carrier agreement', has9(/agreement/i), has9(/agreement/i) ? 'executed on file' : 'signed during onboarding'],
          ['\ud83d\udef0', 'Live GPS from booking to delivery + geofenced arrival proof', true, 'platform standard \u2014 every load'],
          ['\ud83d\udcd1', 'Signed BOL / POD uploaded at every stop', true, 'platform standard'],
          ['\ud83d\udcb3', 'One documented settlement through LoadBoot', true, 'platform standard \u2014 no chasing invoices'],
        ];
        return h('div', { style: 'margin:12px 0;background:linear-gradient(120deg,#0d1b33,#14335c);border-radius:16px;padding:14px 16px;color:#fff' }, [
          h('div', { style: 'font-weight:800;font-size:.9rem;margin-bottom:8px' }, '\ud83d\udce6 What lands in YOUR packet the moment this carrier accepts'),
          ...items9.map(([ic9, t9, ok9, s9]) => h('div', { style: 'display:flex;gap:9px;align-items:flex-start;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:.78rem' }, [
            h('span', null, ic9),
            h('div', { style: 'flex:1' }, [h('div', { style: 'font-weight:700' }, t9), h('div', { style: 'opacity:.65;font-size:.68rem' }, s9)]),
            h('span', { style: 'flex:0 0 auto;font-weight:800;font-size:.66rem;padding:2.5px 9px;border-radius:999px;background:' + (ok9 ? 'rgba(34,197,94,.18)' : 'rgba(245,158,11,.2)') + ';color:' + (ok9 ? '#4ade80' : '#fcd34d') }, ok9 ? '\u2713 INCLUDED' : '\u23f3 PENDING'),
          ])),
        ]);
      })(),
      sec9('Capabilities', [
        c.hazmat ? chip9('\u2622 HAZMAT certified', '#fef9c3', '#854d0e') : null,
        c.team_drivers ? chip9('\ud83d\udc65 Team drivers', '#f0fdf4', '#166534') : null,
        c.weekend_ok ? chip9('Weekends OK', '#f0fdf4', '#166534') : null,
        c.max_weight_lbs ? chip9('Max ' + Number(c.max_weight_lbs).toLocaleString() + ' lb') : null,
      ].filter(Boolean)),
      h('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [
        h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'flex:1;min-width:130px', onClick: async (ev9) => {
          ev9.currentTarget.disabled = true;
          let rows9 = []; try { rows9 = (await partnerCarrierReviews(c.id)) || []; } catch (_) {}
          mount(revHost, rows9.length ? h('div', { style: 'margin-top:10px' }, rows9.slice(0, 8).map(r9 => h('div', { style: 'border:1px solid #eef2f7;border-radius:12px;padding:10px 12px;margin-bottom:8px' }, [
            h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap' }, [h('span', { style: 'color:#f59e0b;font-weight:700;letter-spacing:1.5px' }, starsTxt(r9.stars)), h('span', { class: 'cp-sub' }, r9.date || '')]),
            r9.comment ? h('div', { style: 'margin-top:4px;font-size:.84rem;color:#334155' }, '\u201c' + r9.comment + '\u201d') : null,
            h('div', { class: 'cp-sub', style: 'margin-top:3px' }, '\u2713 ' + (r9.reviewer || 'Verified broker') + ' \u00b7 \ud83d\ude9a ' + (r9.lane || '')),
          ].filter(Boolean)))) : h('div', { class: 'cp-sub', style: 'margin-top:8px' }, '\u2728 New carrier \u2014 no completed-booking reviews yet.'));
        } }, '\u2b50 Read reviews'),
        c.dot ? h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'flex:1;min-width:130px', onClick: () => {
          const fh = h('div', { style: 'width:100%' }, h('div', { class: 'cp-sub' }, 'Loading live FMCSA profile\u2026'));
          openModal('\ud83d\udee1 ' + (c.name || '') + ' \u2014 live FMCSA profile', [fh], { wide: true });
          try { renderFmcsaOnly(fh, String(c.dot).replace(/\D/g, ''), { light: true }); } catch (_) {}
        } }, '\ud83d\udee1 Live FMCSA (7 tabs)') : null,
      ].filter(Boolean)),
      revHost,
    ].filter(Boolean))], { wide: true });
  }

  // ============ CARRIER PACKET — locked until acceptance, then preview + download ============
  function printCarrierPacketCert(d) {
    const w9 = window.open('', '_blank'); if (!w9) { alert('Allow pop-ups to download.'); return; }
    const esc = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const cr = d.carrier || {};
    const rows = (d.items || []).map(it => '<tr><td class="k">' + esc(it.label) + (it.mandatory ? ' <span class="req">REQUIRED</span>' : '') + '</td>'
      + '<td class="v ' + (/valid|verified|approv|on file|active/i.test(it.status) ? 'ok' : 'bad') + '">' + esc(String(it.status).toUpperCase()) + '</td>'
      + '<td class="n">' + esc([it.effective_date ? 'from ' + it.effective_date : null, it.expiry_date ? 'expires ' + it.expiry_date : null, it.verified_at ? 'verified ' + String(it.verified_at).slice(0, 10) : null].filter(Boolean).join(' \u00b7 ')) + '</td></tr>').join('');
    const logo = '<svg width="32" height="34" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#fff"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#FC5305"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#fff"/></svg>';
    w9.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Carrier Packet \u2014 ' + esc(cr.name) + '</title><style>'
      + '*{box-sizing:border-box}body{font-family:Inter,system-ui,Arial,sans-serif;color:#0f1e36;margin:0 auto;max-width:880px;padding:0 0 30px}'
      + '.band{background:linear-gradient(120deg,#0b1830,#10223B 60%,#14335c);color:#fff;padding:24px 36px;display:flex;justify-content:space-between;align-items:center}'
      + '.band .wd{font-weight:800;font-size:1.25rem}.band .wd span{color:#FC5305}'
      + '.ribbon{background:#16a34a;color:#fff;text-align:center;font-weight:800;letter-spacing:.3em;font-size:.7rem;padding:6px}'
      + '.wrap{padding:22px 36px}'
      + 'h1{font-size:1.15rem;margin:0 0 2px}.sub{color:#51617a;font-size:.78rem;margin-bottom:14px}'
      + '.id{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}'
      + '.chip{border:1px solid #e6ecf4;border-radius:999px;padding:5px 13px;font-size:.74rem;font-weight:700}'
      + 'table{width:100%;border-collapse:collapse;font-size:.8rem;margin-top:8px}'
      + 'th{background:#10223B;color:#fff;text-align:left;padding:9px 12px;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase}'
      + 'td{padding:9px 12px;border-bottom:1px solid #eef2f7}td.k{font-weight:700}'
      + 'td.v.ok{color:#16a34a;font-weight:800}td.v.bad{color:#b45309;font-weight:800}td.n{color:#51617a;font-size:.72rem}'
      + '.req{font-size:.56rem;color:#b45309;font-weight:800;letter-spacing:.06em}'
      + '.note{background:#f8fafc;border:1px solid #eef2f7;border-radius:10px;padding:11px 14px;font-size:.72rem;color:#51617a;line-height:1.7;margin-top:12px}'
      + '.stamp{margin:24px auto 0;width:230px;text-align:center;border:3.5px solid #16a34a;color:#16a34a;border-radius:12px;padding:9px;font-weight:800;letter-spacing:.18em;transform:rotate(-3deg)}'
      + '.ft{margin-top:22px;border-top:1px solid #e6ecf4;padding:10px 36px 0;font-size:.64rem;color:#8795a9;text-align:center}'
      + '@media print{.band{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>'
      + '<div class="band"><div style="display:flex;gap:12px;align-items:center">' + logo + '<div class="wd">Load<span>Boot</span></div></div>'
      + '<div style="text-align:right;font-size:.68rem;opacity:.75">CARRIER SETUP PACKET \u00b7 VERIFICATION CERTIFICATE<br>Generated ' + esc(new Date().toISOString().slice(0, 10)) + '</div></div>'
      + '<div class="ribbon">L O A D B O O T \u2013 V E R I F I E D</div>'
      + '<div class="wrap"><h1>' + esc(cr.name || 'Carrier') + '</h1>'
      + '<div class="sub">Released to your brokerage because this carrier accepted your load' + (d.trip && d.trip.booked_at ? ' on ' + esc(String(d.trip.booked_at).slice(0, 10)) : '') + '.</div>'
      + '<div class="id">'
      + (cr.dot ? '<span class="chip">DOT ' + esc(String(cr.dot).replace(/^DOT\s*/i, '')) + '</span>' : '')
      + (cr.mc ? '<span class="chip">MC ' + esc(String(cr.mc).replace(/^MC\s*/i, '')) + '</span>' : '')
      + (cr.authority ? '<span class="chip" style="color:#16a34a;border-color:#bbf7d0">Authority: ' + esc(String(cr.authority).toUpperCase()) + '</span>' : '')
      + (cr.safety_rating && String(cr.safety_rating).toLowerCase() !== 'none' ? '<span class="chip">Safety: ' + esc(String(cr.safety_rating).toUpperCase()) + '</span>' : '')
      + (d.trip && d.trip.driver ? '<span class="chip">Driver: ' + esc(d.trip.driver) + '</span>' : '')
      + '</div>'
      + '<table><tr><th>Document</th><th>Status</th><th>Dates</th></tr>' + rows + '</table>'
      + '<div class="note"><b>' + esc(d.mandatory_verified) + ' of ' + esc(d.mandatory_total) + ' mandatory documents verified.</b><br>'
      + esc(d.insurance_note || '') + '<br>' + esc(d.payments_note || '') + '<br>' + esc(d.files_note || '') + '</div>'
      + '<div class="stamp">PACKET VERIFIED</div></div>'
      + '<div class="ft">This certificate is LoadBoot\u2019s audit record of the carrier\u2019s setup packet at booking time \u00b7 loadboot.com</div>'
      + '<script>setTimeout(function(){window.print()},400)<\/script></body></html>');
    w9.document.close();
  }
  async function openCarrierPacket(l) {
    const host = h('div', null, h('div', { class: 'cp-sub' }, 'Opening the carrier packet\u2026'));
    openModal('\ud83d\udce6 Carrier setup packet', [host], { wide: true });
    let d; try { d = await partnerCarrierPacket(l.id); } catch (e) { mount(host, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load.')); return; }
    if (!d.unlocked) {
      mount(host, h('div', { style: 'text-align:center;padding:30px 16px' }, [
        h('div', { style: 'font-size:50px' }, '\ud83d\udd12'),
        h('div', { style: 'font-weight:800;font-size:1.05rem;color:#10223B;margin:10px 0 6px' }, 'Locked \u2014 unlocks the moment a carrier accepts'),
        h('div', { class: 'cp-sub', style: 'max-width:460px;margin:0 auto' }, d.reason || ''),
        h('div', { style: 'margin-top:14px;display:inline-block;background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:10px 16px;font-size:.8rem;color:#334155;text-align:left' }, [
          'On acceptance you receive:', h('br'), '\u2713 W-9 \u00b7 \u2713 COI ($1M/$100k, monitored) \u00b7 \u2713 MC/DOT authority', h('br'), '\u2713 Signed agreement \u00b7 \u2713 verification certificate (download)',
        ]),
      ]));
      return;
    }
    const cr = d.carrier || {};
    const stOk = (x) => /valid|verified|approv|on file|active/i.test(x || '');
    mount(host, h('div', null, [
      h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
        h('div', null, [
          h('b', { style: 'font-size:1.05rem;color:#10223B' }, cr.name || 'Carrier'),
          h('div', { class: 'cp-sub' }, [cr.dot ? 'DOT ' + String(cr.dot).replace(/^DOT\s*/i, '') : null, cr.mc ? 'MC ' + String(cr.mc).replace(/^MC\s*/i, '') : null, cr.authority ? 'Authority ' + String(cr.authority).toUpperCase() : null, d.trip && d.trip.driver ? 'Driver: ' + d.trip.driver : null].filter(Boolean).join(' \u00b7 ')),
        ]),
        h('span', { style: 'padding:6px 14px;border-radius:999px;font-weight:800;font-size:.72rem;background:#dcfce7;color:#166534' }, '\ud83d\udd13 UNLOCKED \u2014 ' + d.mandatory_verified + '/' + d.mandatory_total + ' mandatory verified'),
      ]),
      h('div', { style: 'margin-top:12px' }, (d.items || []).map(it => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:8px 2px;border-bottom:1px solid #f1f5f9;font-size:.84rem;flex-wrap:wrap' }, [
        h('span', { style: 'font-weight:700;color:#10223B' }, [it.label, it.mandatory ? h('span', { style: 'font-size:.6rem;color:#b45309;font-weight:800;margin-left:6px' }, 'REQUIRED') : null]),
        h('span', { style: 'text-align:right' }, [
          h('b', { style: 'color:' + (stOk(it.status) ? '#16a34a' : '#b45309') }, String(it.status).toUpperCase()),
          h('div', { class: 'cp-sub' }, [it.expiry_date ? 'expires ' + it.expiry_date : null, it.verified_at ? 'verified ' + String(it.verified_at).slice(0, 10) : null].filter(Boolean).join(' \u00b7 ')),
          (() => { let j9 = null; try { j9 = it.note ? JSON.parse(it.note) : null; } catch (_) {}
            return (j9 && j9.signer && /w-?9/i.test(it.key || it.label || '')) ? h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'margin-top:4px;padding:3px 10px;font-size:.68rem', onClick: () => printExecutedW9(j9) }, '\u2b07 Download executed W-9') : null; })(),
        ].filter(Boolean)),
      ]))),
      h('div', { style: 'margin-top:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px 13px;font-size:.78rem;color:#166534' }, d.insurance_note || ''),
      h('div', { class: 'cp-sub', style: 'margin-top:6px' }, (d.files_note || '') + ' ' + (d.payments_note || '')),
      h('div', { style: 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap' }, [
        h('button', { class: 'cp-btn', style: 'flex:1;min-width:200px', onClick: () => printCarrierPacketCert(d) }, '\u2b07 Download verification certificate (PDF)'),
        (d.trip && d.trip.id) ? h('button', { class: 'cp-btn ghost', style: 'flex:1;min-width:200px', onClick: async (ev9) => {
          const b9 = ev9.currentTarget; b9.disabled = true; b9.textContent = 'Requesting\u2026';
          try { const r9 = await requestPacketCopies(d.trip.id); alert(r9.note || 'We will send document copies to your email shortly.'); b9.textContent = '\u2713 Requested \u2014 check your email'; }
          catch (e9) { b9.disabled = false; b9.textContent = '\ud83d\udcec Request document copies by email'; alert((e9 && e9.message) || 'Could not request.'); }
        } }, '\ud83d\udcec Request document copies by email') : null,
      ].filter(Boolean)),
    ]));
  }

  // ============ OFFER PICKER — pick from the verified carrier network, filter, blast ============
  async function openOfferPicker(l, after) {
    const host = h('div', null, h('div', { class: 'cp-sub' }, 'Loading your verified carrier network\u2026'));
    const closeP = openModal('\ud83c\udfaf Offer to specific carriers \u2014 ' + (l.origin || '?') + ' \u2192 ' + (l.destination || '?'), [host], { wide: true });
    // Gate: direct offers require the load to be POSTED to the board. A submitted/with-dispatch
    // load has no public listing yet, so offering it would fail with a confusing error.
    const _posted = String(l.board_status || '') === 'available' || /book|transit|deliver|complete|invoiced/.test((String(l.status || '') + ' ' + String(l.board_status || '')).toLowerCase());
    if (!_posted) {
      mount(host, h('div', { style: 'text-align:center;padding:30px' }, [
        h('div', { style: 'font-size:40px' }, '\u23f3'),
        h('div', { style: 'font-weight:800;color:#10223B;margin:8px 0 4px' }, 'This load is still with dispatch'),
        h('div', { class: 'cp-sub' }, 'Direct offers unlock the moment dispatch posts it to the load board (usually within minutes). Once it shows \u201cOn load board\u201d you can offer it to specific carriers.'),
      ]));
      return;
    }
    let logoBase = null;
    try { const sc = await import('../shared/supabaseClient.js'); const sb = await sc.getClient(); const r = sb.storage.from('org-logos').getPublicUrl('x'); logoBase = (r && r.data && r.data.publicUrl) ? r.data.publicUrl.replace(/\/x$/, '/') : null; } catch (_) {}
    let dir = []; try { dir = (await partnerCarrierDirectory()) || []; } catch (_) {}
    let eligIds = null, inelig = [];
    try {
      const e9 = (await partnerEligibleDetail(l.id)) || [];
      eligIds = {}; e9.forEach(x => { if (x.eligible) eligIds[x.id] = 1; else inelig.push(x); });
    } catch (_) { try { const e8 = (await partnerEligibleCarriers(l.id)) || []; eligIds = {}; e8.forEach(x => { eligIds[x.id] = 1; }); } catch (_) { eligIds = null; } }
    const list = eligIds ? dir.filter(c => eligIds[c.id]) : dir;
    const hiddenN = dir.length - list.length;
    if (!list.length) {
      mount(host, h('div', { style: 'text-align:center;padding:30px' }, [
        h('div', { style: 'font-size:40px' }, '\ud83d\ude9a'),
        h('div', { style: 'font-weight:800;color:#10223B;margin:8px 0 4px' }, 'No eligible carriers for this load yet'),
        h('div', { class: 'cp-sub' }, 'Carriers must be published, active and equipment-matched. The load stays on the board \u2014 any verified carrier can still book it there.'),
      ]));
      return;
    }
    const sel = {};
    const q = h('input', { class: 'cp-in', placeholder: '\ud83d\udd0d Name, lane, home base\u2026', style: 'margin:0;max-width:260px' });
    let fEq = 'All', fHaz = false, fTeam = false;
    const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;margin-top:10px' });
    const bar = h('div', { style: 'display:flex;gap:7px;flex-wrap:wrap;align-items:center' });
    const foot = h('div', { style: 'position:sticky;bottom:-18px;background:#fff;border-top:1px solid #eef2f7;padding:12px 0 4px;margin-top:12px' });
    const initials = (nm) => String(nm || '?').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
    const starsTxt = (v) => '\u2605'.repeat(Math.round(v || 0)) + '\u2606'.repeat(Math.max(0, 5 - Math.round(v || 0)));
    const eqOf9 = (c) => { const a = ((c.fleet_mix || []).map(m => m.type)).concat(c.preferred_equipment || []).filter(e => e && /[a-zA-Z]{2,}/.test(e)); return a.filter((x, i9) => a.indexOf(x) === i9); };
    const drawFoot = () => {
      const n = Object.keys(sel).length;
      const rate9 = h('input', { class: 'cp-in', type: 'number', placeholder: 'Offered rate (blank = posted $' + (l.rate || '') + ')', style: 'margin:0;max-width:230px' });
      const exp9 = h('select', { class: 'cp-in', style: 'margin:0;max-width:190px' }, [['15', '\u23f1 15 min window (std)'], ['30', '30 minutes'], ['60', '60 minutes']].map(([v9, t9]) => h('option', { value: v9 }, t9)));
      mount(foot, [
        h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, '\ud83c\udfc1 Race rule: the load stays on the load board too \u2014 the FIRST acceptance anywhere wins; every other offer and the board listing close automatically and you\u2019re notified who won.'),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
          h('b', { style: 'color:#10223B' }, n + ' selected'), rate9, exp9,
          h('button', { class: 'cp-btn', style: 'flex:1;min-width:150px', disabled: n ? null : 'disabled', onClick: async (ev9) => {
            const btn = ev9.currentTarget; btn.disabled = true; btn.textContent = 'Sending\u2026';
            try {
              const r9 = await partnerOfferSend(l.id, Object.keys(sel), rate9.value ? Number(rate9.value) : null, Number(exp9.value));
              const sd9 = r9.skipped_detail || [];
              const rows9 = [];
              if ((r9.sent || 0) > 0) { rows9.push(h('div', { style: 'font-weight:800;color:#166534;font-size:1.02rem' }, '\u2705 Sent to ' + r9.sent + ' carrier(s)')); rows9.push(h('div', { class: 'cp-sub', style: 'margin-top:2px' }, 'The countdown is running on your My Loads card and each carrier\u2019s board \u2014 first to accept wins.')); }
              if (sd9.length) { rows9.push(h('div', { style: 'font-weight:800;color:#9a3412;margin-top:12px' }, '\u26a0 Not sent to ' + sd9.length + ' carrier(s):')); sd9.forEach(function (x9) { rows9.push(h('div', { style: 'display:flex;gap:10px;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #fde68a;font-size:.86rem' }, [h('b', null, x9.name), h('span', { style: 'color:#92400e;text-align:right' }, x9.reason)])); }); }
              if (!rows9.length) rows9.push(h('div', { class: 'cp-sub' }, r9.note || 'Done.'));
              closeP(); if (after) after();
              openModal('\ud83d\udce3 Offer status', rows9);
            }
            catch (e9) {
              btn.disabled = false; btn.textContent = '\ud83d\udce3 Send offers';
              var raw9 = (e9 && e9.message) || 'Something went wrong.';
              var friendly9 = /not authorized/i.test(raw9)
                ? 'This load isn\u2019t on the board yet (it may still be with dispatch), or its link needs a refresh. Once it shows \u201cOn load board\u201d you can send direct offers. If it keeps happening, contact support.'
                : /not a partner/i.test(raw9) ? 'Your account isn\u2019t set up as a broker yet.'
                : /load is (booked|cancelled|delivered)/i.test(raw9) ? raw9
                : raw9;
              openModal('Couldn\u2019t send the offer', [
                h('div', { class: 'cp-sub', style: 'line-height:1.6;color:#991b1b;font-size:.95rem' }, friendly9),
                h('div', { class: 'cp-sub', style: 'margin-top:8px;color:#64748b' }, 'Note: a carrier whose trucks are all on active loads won\u2019t receive offers \u2014 they show as \u201cAll trucks booked.\u201d'),
              ]);
            }
          } }, '\ud83d\udce3 Send offers'),
        ]),
      ]);
    };
    const card9 = (c) => {
      const on = !!sel[c.id];
      const logo = (c.logo_path && logoBase) ? (logoBase + c.logo_path) : null;
      const el = h('div', { style: 'cursor:pointer;background:' + (on ? '#eff6ff' : '#fff') + ';border:2px solid ' + (on ? '#0883F7' : '#e6ebf3') + ';border-radius:14px;padding:11px 13px;transition:all .12s' }, [
        h('div', { style: 'display:flex;gap:10px;align-items:center' }, [
          h('div', { style: 'width:38px;height:38px;border-radius:11px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;color:#fff;background:linear-gradient(135deg,#0883F7,#10223B);overflow:hidden' }, logo ? h('img', { src: logo, style: 'width:100%;height:100%;object-fit:cover' }) : initials(c.name)),
          h('div', { style: 'min-width:0;flex:1' }, [
            h('div', { style: 'font-weight:800;font-size:.86rem;color:#10223B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, (on ? '\u2611 ' : '\u2610 ') + (c.name || 'Carrier')),
            h('div', { style: 'font-size:.7rem;color:#64748b' }, [(c.ratings_count || 0) > 0 ? (starsTxt(c.stars) + ' ' + c.stars) : '\u2728 new', c.health != null ? 'health ' + c.health : null, c.on_time_pct != null ? c.on_time_pct + '% on-time' : null, c.delivered ? c.delivered + ' delivered' : null].filter(Boolean).join(' \u00b7 ')),
          ]),
        ]),
        (() => {
          const k9 = (l9, v9, fg9) => h('div', { style: 'flex:1;text-align:center;background:#f8fafc;border:1px solid #eef2f7;border-radius:10px;padding:5px 2px' }, [
            h('div', { style: 'font-weight:800;font-size:.8rem;color:' + (fg9 || '#10223B') }, v9),
            h('div', { style: 'font-size:.52rem;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:800' }, l9)]);
          const hl9 = c.health != null ? Number(c.health) : null;
          return h('div', { style: 'display:flex;gap:5px;margin-top:7px' }, [
            k9('On-time', c.on_time_pct != null ? c.on_time_pct + '%' : 'New', c.on_time_pct != null ? (c.on_time_pct >= 90 ? '#16a34a' : '#d97706') : '#94a3b8'),
            k9('Delivered', String(c.delivered || 0)),
            k9('Cancels', String(c.carrier_cancels || 0), (c.carrier_cancels || 0) > 0 ? '#dc2626' : '#16a34a'),
            k9('Health', hl9 != null ? String(hl9) : '\u2014', hl9 == null ? '#94a3b8' : hl9 >= 85 ? '#16a34a' : hl9 >= 60 ? '#d97706' : '#dc2626'),
          ]);
        })(),
        (() => {
          const ins9 = (c.compliance || []).some(x => /insurance|coi/i.test(String(x)));
          const authOk9 = String(c.authority || '').toLowerCase() === 'active';
          const bch = (txt, bg, fg) => h('span', { style: 'padding:2.5px 9px;border-radius:999px;font-size:.62rem;font-weight:800;background:' + bg + ';color:' + fg }, txt);
          return h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:6px' }, [
            ins9 ? bch('\ud83d\udee1 INSURED \u2713', '#dcfce7', '#166534') : bch('\ud83d\udee1 INSURANCE NOT ON FILE', '#fef3c7', '#92400e'),
            c.authority ? bch(authOk9 ? '\u25cf AUTHORITY ACTIVE' : 'AUTHORITY ' + String(c.authority).toUpperCase(), authOk9 ? '#dcfce7' : '#fee2e2', authOk9 ? '#166534' : '#991b1b') : null,
            c.hazmat ? bch('\u2622 HAZMAT', '#fef9c3', '#854d0e') : null,
            c.team_drivers ? bch('\ud83d\udc65 TEAM', '#f0fdf4', '#166534') : null,
            (c.safety_rating && String(c.safety_rating).toLowerCase() !== 'none') ? bch('SAFETY: ' + String(c.safety_rating).toUpperCase(), '#f1f5f9', '#334155') : null,
          ].filter(Boolean));
        })(),
        (() => {
          const mixTxt = (c.fleet_mix || []).filter(m => m.type && /[a-zA-Z]{2,}/.test(m.type)).slice(0, 3).map(m => m.type + (m.n > 1 ? '\u00d7' + m.n : '')).join(', ') || eqOf9(c).slice(0, 3).join(', ');
          const fleetN9 = ((c.trucks || 0) + (c.trailers || 0)) || c.power_units || null;
          return h('div', { style: 'font-size:.68rem;color:#64748b;margin-top:6px;line-height:1.6' }, [
            h('div', null, ['\ud83d\ude9b ' + (mixTxt || '\u2014'), fleetN9 ? fleetN9 + ' units' : null, c.max_weight_lbs ? 'max ' + Number(c.max_weight_lbs).toLocaleString() + ' lb' : null].filter(Boolean).join('  \u00b7  ')),
            h('div', null, [c.home_base ? '\ud83d\udccd ' + c.home_base : null, (c.preferred_lanes || []).length ? 'runs ' + c.preferred_lanes.join(', ') : null, c.member_since ? 'since ' + c.member_since : null].filter(Boolean).join('  \u00b7  ')),
          ]);
        })(),
      ]);
      el.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:7px' }, [
        h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'flex:1;padding:5px 8px;font-size:.7rem', onClick: (ev9) => { ev9.stopPropagation(); openCarrierFullProfile(c, logoBase); } }, '\ud83d\udd0e Full details \u2014 decide'),
      ]));
      el.onclick = () => { if (sel[c.id]) delete sel[c.id]; else sel[c.id] = 1; drawGrid(); drawFoot(); };
      return el;
    };
    const drawGrid = () => {
      const t = q.value.trim().toLowerCase();
      const rows = list.filter(c => {
        if (fEq !== 'All' && !eqOf9(c).some(e => e.toLowerCase() === fEq.toLowerCase())) return false;
        if (fHaz && !c.hazmat) return false;
        if (fTeam && !c.team_drivers) return false;
        if (!t) return true;
        return [c.name, c.home_base].concat(eqOf9(c), c.preferred_lanes || []).filter(Boolean).join(' ').toLowerCase().includes(t);
      });
      mount(grid, rows.length ? rows.map(card9) : h('div', { class: 'cp-sub', style: 'grid-column:1/-1;text-align:center;padding:20px' }, 'No carriers match the filters.'));
    };
    const drawBar = () => {
      const eqs = ['All']; list.forEach(c => eqOf9(c).forEach(e => { if (eqs.indexOf(e) < 0) eqs.push(e); }));
      mount(bar, [q,
        ...eqs.map(e => h('button', { class: 'cp-btn cp-btn-sm ' + (fEq === e ? '' : 'ghost'), style: 'padding:5px 12px', onClick: () => { fEq = e; drawBar(); drawGrid(); } }, e)),
        h('button', { class: 'cp-btn cp-btn-sm ' + (fHaz ? '' : 'ghost'), style: 'padding:5px 12px', onClick: () => { fHaz = !fHaz; drawBar(); drawGrid(); } }, '\u2622 HAZMAT'),
        h('button', { class: 'cp-btn cp-btn-sm ' + (fTeam ? '' : 'ghost'), style: 'padding:5px 12px', onClick: () => { fTeam = !fTeam; drawBar(); drawGrid(); } }, '\ud83d\udc65 Team'),
      ]);
    };
    q.addEventListener('input', drawGrid);
    mount(host, [
      h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, list.length + ' eligible verified carrier' + (list.length === 1 ? '' : 's') + ' for this load' + (hiddenN > 0 ? (' \u00b7 ' + hiddenN + ' hidden' + ((() => { const capN = (inelig || []).filter(x => /capac|booked|all trucks|active load|truck/i.test(String(x.reasons || ''))).length; return capN > 0 ? ' (' + capN + ' because all their trucks are on active loads' + (hiddenN > capN ? ', the rest equipment/lane mismatch)' : ')') : ' (equipment/lane mismatch or not accepting)'; })())) : '') + ' \u2014 matched to THIS load\u2019s equipment, hazmat and fleet requirements. A carrier whose every truck is already on a load is hidden automatically, so you can\u2019t offer it by mistake. Tap a card to select; \u201c\ud83d\udd0e Full details\u201d shows everything you receive on acceptance.'),
      bar, grid,
      inelig.length ? h('div', { style: 'margin-top:12px' }, [
        h('div', { style: 'font-weight:800;font-size:.74rem;color:#94a3b8;letter-spacing:.08em;margin-bottom:6px' }, '\u26d4 NOT ELIGIBLE FOR THIS LOAD (' + inelig.length + ') \u2014 why they\u2019re hidden'),
        ...inelig.map(x9 => h('div', { style: 'display:flex;justify-content:space-between;gap:10px;background:#f8fafc;border:1px dashed #e2e8f0;border-radius:12px;padding:9px 13px;margin-bottom:6px;opacity:.85;flex-wrap:wrap' }, [
          h('span', { style: 'font-weight:700;color:#64748b' }, x9.name),
          h('span', { style: 'font-size:.76rem;color:#b45309;text-align:right' }, x9.reasons || (x9.equipment_match === 'no' ? 'equipment does not match this load' : 'requirements not met')),
        ])),
      ]) : null,
      foot,
    ].filter(Boolean));
    drawBar(); drawGrid(); drawFoot();
  }

  // ============ LIVE LOAD TRACKER — Uber/Amazon-class visibility for the broker ============
  let __lbLeaf = null;
  function lbLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (__lbLeaf) return __lbLeaf;
    __lbLeaf = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
      const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      sc.onload = () => res(window.L); sc.onerror = () => { __lbLeaf = null; rej(new Error('Map library failed to load.')); };
      document.head.appendChild(sc);
    });
    return __lbLeaf;
  }
  function openLoadTracker(l) {
    if (!document.getElementById('lt-css')) {
      const st = document.createElement('style'); st.id = 'lt-css';
      st.textContent = `
        .lt-hero{position:relative;border-radius:16px;overflow:hidden;padding:18px 20px;color:#fff;background:radial-gradient(600px 200px at 88% -40%,rgba(8,131,247,.45),transparent 60%),linear-gradient(120deg,#0b1830,#10223B 60%,#14335c);margin-bottom:14px}
        .lt-live{display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.16);color:#4ade80;border:1px solid rgba(74,222,128,.35);border-radius:999px;padding:4px 12px;font-size:.68rem;font-weight:800;letter-spacing:.05em}
        .lt-live .dot{width:8px;height:8px;border-radius:99px;background:#22c55e;animation:ltblink 1.4s infinite}
        @keyframes ltblink{0%,100%{opacity:1}50%{opacity:.25}}
        .lt-steps{display:flex;gap:0;margin:14px 0}
        .lt-step{flex:1;position:relative;text-align:center;padding-top:26px}
        .lt-step:before{content:'';position:absolute;top:10px;left:50%;width:100%;height:3px;background:#eef2f7;z-index:0}
        .lt-step:last-child:before{display:none}
        .lt-step.done:before{background:linear-gradient(90deg,#22c55e,#16a34a)}
        .lt-step .b{position:absolute;top:0;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:99px;background:#eef2f7;color:#94a3b8;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;z-index:1;border:3px solid #fff;box-shadow:0 0 0 1.5px #e2e8f0}
        .lt-step.done .b{background:#16a34a;color:#fff;box-shadow:0 0 0 1.5px #16a34a}
        .lt-step.cur .b{background:#0883F7;color:#fff;box-shadow:0 0 0 1.5px #0883F7;animation:ltpulse 1.8s infinite}
        @keyframes ltpulse{0%{box-shadow:0 0 0 1.5px #0883F7}55%{box-shadow:0 0 0 9px rgba(8,131,247,.12)}100%{box-shadow:0 0 0 1.5px #0883F7}}
        .lt-step .t{font-size:.68rem;font-weight:800;color:#94a3b8}
        .lt-step.done .t,.lt-step.cur .t{color:#10223B}
        .lt-step .s{font-size:.6rem;color:#94a3b8;margin-top:1px}
        .lt-map{height:340px;border-radius:16px;overflow:hidden;border:1px solid #e6ebf3;box-shadow:0 14px 34px -24px rgba(2,12,30,.4)}
        .lt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:12px 0}
        .lt-tile{background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:11px 14px}
        .lt-tile .k{font-size:.6rem;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8;font-weight:800}
        .lt-tile .v{font-weight:800;color:#10223B;font-size:1rem;margin-top:2px}
        .lt-tile .s{font-size:.7rem;color:#64748b;margin-top:1px}
        .lt-ev{border-left:2.5px solid #e2e8f0;margin-left:9px;padding-left:16px}
        .lt-ev .e{position:relative;padding:7px 0}
        .lt-ev .e:before{content:'';position:absolute;left:-22.5px;top:13px;width:10px;height:10px;border-radius:99px;background:#0883F7;border:2.5px solid #fff;box-shadow:0 0 0 1.5px #bfdbfe}
        .lt-prog{height:9px;border-radius:99px;background:#eef2f7;overflow:hidden;margin-top:8px}
        .lt-prog i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#22c55e);transition:width .6s cubic-bezier(.4,0,.2,1)}
        .lt-hero.lt-done{background:radial-gradient(600px 200px at 88% -40%,rgba(34,197,94,.5),transparent 60%),linear-gradient(120deg,#0a2416,#14532d 60%,#166534)}
        .lt-arrive{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:1.32rem;margin-top:9px;color:#fff;letter-spacing:-.01em}
        .lt-arrive small{display:block;font-size:.74rem;font-weight:700;opacity:.75;margin-top:2px;letter-spacing:0}
        .lt-carrier{display:flex;align-items:center;gap:13px;background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:13px 16px;margin:12px 0 0;box-shadow:0 10px 28px -22px rgba(2,12,30,.4)}
        .lt-carrier .av{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#0883F7,#1e40af);color:#fff;font-weight:800;font-size:1.15rem;display:flex;align-items:center;justify-content:center;flex:none}
        .lt-carrier b{color:#10223B;font-size:.95rem}
        .lt-carrier .sub{font-size:.76rem;color:#64748b;margin-top:1px}
        .lt-carrier .act{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
      `;
      document.head.appendChild(st);
    }
    const host = h('div', null, h('div', { class: 'cp-sub' }, 'Connecting to the live feed\u2026'));
    let __xs = null; // extra stops (fetched once)
    (async () => { try { const r0 = await ccLoadStops(l.id); __xs = (r0 && r0.count) ? (r0.stops || []) : []; } catch (_) { __xs = []; } })();
    const closeM = openModal('\ud83d\udef0 Live tracking \u2014 ' + (l.origin || '?') + ' \u2192 ' + (l.destination || '?'), [host], { wide: true });
    let map = null, truckMk = null, routeLn = null, timer = null, dead = false;
    const stop = () => { dead = true; clearTimeout(timer); };
    const fmtT = (x) => x ? new Date(x).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
    const ago = (x) => { if (!x) return null; const m9 = Math.round((Date.now() - new Date(x).getTime()) / 60000); return m9 < 1 ? 'just now' : m9 < 60 ? m9 + ' min ago' : Math.round(m9 / 60) + 'h ago'; };
    async function draw() {
      if (dead || !document.body.contains(host)) { stop(); return; }
      let d; try { d = await partnerTrackLoad(l.id); } catch (e) { mount(host, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load tracking.')); return; }
      const ld = d.load || {}, bd = d.board || {}, of = d.offers || {}, t = d.trip;
      const ts = t ? String(t.status || '') : '';
      const cancelled = ts === 'cancelled' || /reject/.test(String(ld.status || ''));
      // milestone model
      const steps = [
        ['Submitted', ld.submitted_at, true],
        ['Approved \u00b7 posted', bd.posted_at, !!bd.posted],
        ['Carrier accepted', t && t.booked_at, !!t],
        ['Dispatched', t && t.dispatched_at, !!(t && (t.dispatched_at || t.started_at || t.delivered_at))],
        ['Picked up \u00b7 in transit', t && t.started_at, !!(t && (t.started_at || t.delivered_at))],
        ['Delivered', t && t.delivered_at, !!(t && t.delivered_at)],
      ];
      let cur = steps.findIndex(s9 => !s9[2]); if (cur < 0) cur = steps.length;
      // hero + live badge
      const liveOk = t && t.last_loc_at && (Date.now() - new Date(t.last_loc_at).getTime()) < 30 * 60000;
      const heroSub = cancelled ? '\u26d4 ' + (ts === 'cancelled' ? 'Cancelled by ' + (t.cancelled_by || 'party') : 'Rejected by dispatch')
        : t ? (t.carrier || 'Carrier') + (t.driver_name ? ' \u00b7 driver ' + t.driver_name : '') + (t.truck_no ? ' \u00b7 truck #' + t.truck_no : '')
        : bd.on_board_now ? 'Live on the load board \u00b7 offers: ' + (of.sent || 0) + ' sent, ' + (of.pending || 0) + ' awaiting reply' + ((of.declined || 0) ? ', ' + of.declined + ' declined/expired' : '') + ' \u2014 first acceptance wins, everything else closes automatically'
        : String(ld.status || '') === 'submitted' ? 'With LoadBoot dispatch for approval \u2014 usually under an hour' : 'Preparing\u2026';
      const mapEl = h('div', { class: 'lt-map', style: (t || (ld.pickup_lat && ld.delivery_lat)) ? '' : 'display:none' });
      // progress math
      const havM = (a, b, c2, d2) => { const r9 = (x) => x * Math.PI / 180; return 6371000 * 2 * Math.asin(Math.sqrt(Math.sin(r9(c2 - a) / 2) ** 2 + Math.cos(r9(a)) * Math.cos(r9(c2)) * Math.sin(r9(d2 - b) / 2) ** 2)); };
      let progPct = null, remainTxt = null, etaTxt = null;
      mount(host, h('div', null, [
        h('div', { class: 'lt-hero' + ((t && t.delivered_at) ? ' lt-done' : '') }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
            h('div', null, [
              h('div', { style: 'font-weight:800;font-size:1.08rem' }, (ld.origin || '?') + '  \u2192  ' + (ld.destination || '?')),
              h('div', { style: 'font-size:.78rem;opacity:.8;margin-top:3px' }, heroSub),
              (Array.isArray(__xs) && __xs.length) ? h('div', { style: 'font-size:.76rem;opacity:.85;margin-top:3px;color:#c4b5fd' }, '🟣 Multi-stop: ' + (ld.origin || 'A') + ' → ' + __xs.map((s9, i9) => (s9.kind === 'pickup' ? '📦' : '📤') + ' S' + (i9 + 1) + ' ' + (s9.city ? s9.city + ', ' + (s9.state || '') : (s9.address || '').split(',').slice(-3, -1).join(',')) + (s9.purpose ? ' (' + s9.purpose + ')' : '')).join(' → ') + ' → ' + (ld.destination || 'B') + ' · each stop GPS-geofenced (detention + stop-off tracked)') : null,
              h('div', { class: 'lt-arrive', id: 'lt-arrive' },
                (t && t.delivered_at) ? [document.createTextNode('\ud83c\udf89 Delivered ' + fmtT(t.delivered_at)), h('small', null, 'GPS-verified drop \u00b7 POD & trip documents are on the load card')]
                : (t && t.scheduled_delivery && !t.last_lat) ? [document.createTextNode('\ud83d\udce6 Arriving ' + fmtT(t.scheduled_delivery)), h('small', null, 'scheduled delivery \u2014 live ETA appears once the truck is rolling')]
                : ''),
            ]),
            h('div', { style: 'display:flex;gap:8px;align-items:center' }, [
              liveOk ? h('span', { class: 'lt-live' }, [h('span', { class: 'dot' }), 'LIVE \u00b7 ' + ago(t.last_loc_at)]) :
              t ? h('span', { class: 'lt-live', style: 'background:rgba(148,163,184,.15);color:#cbd5e1;border-color:rgba(148,163,184,.3)' }, [h('span', { class: 'dot', style: 'background:#94a3b8;animation:none' }), (String(t.status || '') === 'delivered') ? '\ud83c\udfc1 Delivered \u2014 tracking ended' : (t.last_loc_at ? 'GPS ' + ago(t.last_loc_at) : 'GPS pending')]) : null,
              h('span', { style: 'font-weight:800;color:#7cc0ff;font-size:1.05rem' }, ld.rate ? '$' + Number(ld.rate).toLocaleString() : ''),
            ].filter(Boolean)),
          ]),
        ]),
        cancelled ? null : h('div', { class: 'lt-steps' }, steps.map(([nm, at9, done9], i9) => h('div', { class: 'lt-step' + (done9 ? ' done' : i9 === cur ? ' cur' : '') }, [
          h('span', { class: 'b' }, done9 ? '\u2713' : String(i9 + 1)),
          h('div', { class: 't' }, nm),
          h('div', { class: 's' }, fmtT(at9) || (i9 === cur ? 'in progress\u2026' : '')),
        ]))),
        (t && t.delivered_at && !cancelled) ? payRailBlock('freight', t.id, (ld.ref || ('LOAD-' + String(l.id).slice(0, 8).toUpperCase())), 'Pay freight to carrier') : null,
        mapEl,
        h('div', { class: 'lt-grid', id: 'lt-tiles' }),
        (d.events || []).length ? h('div', { style: 'background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:14px 16px;margin-top:2px' }, [
          h('div', { style: 'font-weight:800;font-size:.85rem;color:#10223B;margin-bottom:8px' }, '\ud83d\udcdc Trip events \u2014 every check-in is server-verified'),
          h('div', { class: 'lt-ev' }, d.events.map(e9 => h('div', { class: 'e' }, [
            h('div', { style: 'font-weight:700;font-size:.8rem;color:#10223B' }, (e9.kind || 'event').replace(/_/g, ' ') + (e9.to ? ' \u2192 ' + e9.to : '')),
            h('div', { class: 'cp-sub' }, [fmtT(e9.at), e9.note].filter(Boolean).join(' \u00b7 ')),
          ]))),
        ]) : null,
        (function () {
          const dwell = d.dwell || [], acc = d.accessorials || [], rates = d.rates || {};
          const detRate = Number(rates.detention_per_hr) || 0;
          const hm = (m) => m >= 60 ? (Math.floor(m / 60) + 'h ' + (m % 60) + 'm') : (m + 'm');
          const rows = [];
          // LIVE detention accruing at the stop the truck is currently sitting in
          dwell.forEach(dw => {
            if (!dw.arrived_at || dw.departed_at) return;
            const arr = new Date(dw.arrived_at).getTime();
            const dwellMin = Math.max(0, Math.round((Date.now() - arr) / 60000));
            const freeMin = Number(dw.free_minutes) || 0;
            const overMin = Math.max(0, dwellMin - freeMin);
            const amt = detRate ? (overMin / 60 * detRate) : 0;
            rows.push(h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed #eef2f7' }, [
              h('div', null, [
                h('div', { style: 'font-weight:800;font-size:.85rem;color:#10223B' }, (overMin > 0 ? '\u23f1 Detention RUNNING at ' : '\u23f3 In dock at ') + dw.stop),
                h('div', { class: 'cp-sub' }, 'In dock ' + hm(dwellMin) + ' \u00b7 free ' + hm(freeMin) + (overMin > 0 ? (' \u00b7 ' + hm(overMin) + ' over free') : ' \u00b7 within free time')),
              ]),
              h('div', { style: 'text-align:right;font-weight:800;color:' + (overMin > 0 ? '#b45309' : '#16a34a') }, overMin > 0 ? ('$' + Math.round(amt).toLocaleString() + ' \u23eb') : '$0'),
            ]));
          });
          // Filed accessorials = the detention/layover invoice building up
          let total = 0;
          acc.forEach(a => {
            const amt = Number(a.amount) || 0; total += amt;
            const stC = a.status === 'approved' ? ['#dcfce7', '#166534'] : a.status === 'rejected' ? ['#fee2e2', '#991b1b'] : ['#fef3c7', '#92400e'];
            rows.push(h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed #eef2f7' }, [
              h('div', null, [
                h('div', { style: 'font-weight:800;font-size:.85rem;color:#10223B;text-transform:capitalize' }, (a.kind || 'accessorial') + ' claim'),
                h('span', { style: 'font-size:.68rem;font-weight:800;padding:2px 8px;border-radius:999px;background:' + stC[0] + ';color:' + stC[1] }, a.status === 'requested' ? 'in review' : (a.status || '')),
              ]),
              h('div', { style: 'font-weight:800;color:#10223B' }, '$' + amt.toLocaleString()),
            ]));
          });
          if (!rows.length) return null;
          return h('div', { style: 'background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:14px 16px;margin-top:10px' }, [
            h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [
              h('div', { style: 'font-weight:800;font-size:.85rem;color:#10223B' }, '\ud83d\udcb0 Detention \u00b7 layover \u00b7 accessorials \u2014 live'),
              total ? h('div', { style: 'font-weight:800;color:#0883F7' }, 'Invoice so far: $' + total.toLocaleString()) : null,
            ].filter(Boolean)),
            ...rows,
            h('div', { class: 'cp-sub', style: 'margin-top:8px' }, 'Detention & layover accrue from the driver\u2019s GPS arrive/depart stamps at each stop. Approved amounts pass straight through to the carrier\u2019s invoice \u2014 LoadBoot takes no cut.'),
          ]);
        })(),
        h('div', { class: 'cp-sub', style: 'margin-top:10px;text-align:center' }, 'Auto-refreshes every 30 seconds \u00b7 GPS is captured from the driver\u2019s device from booking to delivery \u00b7 every milestone lands in your notifications'),
      ].filter(Boolean)));
      // tiles
      const tiles = [];
      const tile = (k, v, s9) => h('div', { class: 'lt-tile' }, [h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s9 ? h('div', { class: 's' }, s9) : null]);
      if (!t) {
        tiles.push(tile('Board status', bd.on_board_now ? 'LIVE on board' : (bd.posted ? String(bd.board_status || '') : String(ld.status || '')), bd.posted_at ? 'posted ' + fmtT(bd.posted_at) : 'awaiting dispatch approval'));
        tiles.push((() => {
          let sub9 = (of.pending || 0) + ' awaiting reply' + ((of.declined || 0) ? ' \u00b7 ' + of.declined + ' declined' : '');
          if (of.next_expiry && (of.pending || 0) > 0) {
            const ms9 = new Date(of.next_expiry).getTime() - Date.now();
            if (ms9 > 0) sub9 = '\u23f3 expires in ' + Math.floor(ms9 / 60000) + 'm ' + Math.floor((ms9 % 60000) / 1000) + 's \u00b7 ' + sub9;
          }
          return tile('Direct offers', (of.sent || 0) + ' sent', sub9);
        })());
        tiles.push(tile('Race rule', 'First accept wins', 'all other offers + the board listing close instantly'));
      } else {
        (() => {
          const card9 = h('div', { class: 'lt-carrier' }, [
            h('div', { class: 'av' }, String(t.carrier || 'C').trim().charAt(0).toUpperCase()),
            h('div', null, [
              h('b', null, t.carrier || 'Carrier'),
              h('div', { class: 'sub' }, ['\u2713 Verified LoadBoot carrier', t.driver_name ? 'driver ' + t.driver_name : null, t.truck_no ? 'truck #' + t.truck_no : null].filter(Boolean).join(' \u00b7 ')),
            ]),
            h('div', { class: 'act' }, [
              h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0f766e;color:#fff', onClick: () => openCarrierPacket(l) }, '\ud83d\udd13 Carrier packet'),
              h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => {
                try { if (!__dirCache) __dirCache = (await partnerCarrierDirectory()) || []; } catch (_) { __dirCache = __dirCache || []; }
                const c9 = (__dirCache || []).find(x9 => x9.name && t.carrier && x9.name.toLowerCase() === String(t.carrier).toLowerCase());
                if (c9) openCarrierFullProfile(c9, null); else alert('Profile not published.');
              } }, '\ud83d\udc64 Profile'),
            ]),
          ]);
          const heroEl9 = host.querySelector('.lt-hero');
          if (heroEl9 && heroEl9.parentNode) heroEl9.parentNode.insertBefore(card9, heroEl9.nextSibling);
        })();
        tiles.push(tile('Scheduled', (fmtT(t.scheduled_pickup) || '\u2014'), 'delivery ' + (fmtT(t.scheduled_delivery) || '\u2014')));
      }
      mount(host.querySelector('#lt-tiles'), tiles);
      // map + route + ETA
      if (mapEl.style.display !== 'none') {
        try {
          const L = await lbLeaflet();
          if (!document.body.contains(mapEl)) return;
          const pk = (t && t.pickup_lat != null) ? [t.pickup_lat, t.pickup_lng] : (ld.pickup_lat != null ? [ld.pickup_lat, ld.pickup_lng] : null);
          const dl = (t && t.delivery_lat != null) ? [t.delivery_lat, t.delivery_lng] : (ld.delivery_lat != null ? [ld.delivery_lat, ld.delivery_lng] : null);
          const tk = (t && t.last_lat != null) ? [t.last_lat, t.last_lng] : null;
          map = L.map(mapEl, { zoomControl: true, attributionControl: false });
          L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
          const mk = (pt, bg, txt) => L.marker(pt, { icon: L.divIcon({ className: '', iconSize: [0, 0], iconAnchor: [0, 0], html: '<div style="position:absolute;transform:translate(-50%,-50%);background:' + bg + ';color:#fff;font-weight:800;font-size:10px;padding:5px 12px;border-radius:999px;border:2px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,.5);white-space:nowrap;letter-spacing:.04em">' + txt + '</div>' }) }).addTo(map);
          const pts = [];
          if (pk) { mk(pk, '#0883F7', 'PICKUP'); pts.push(pk); }
          if (dl) { mk(dl, '#FC5305', 'DELIVERY'); pts.push(dl); }
          if (tk) {
            L.marker(tk, { icon: L.divIcon({ className: '', iconSize: [0, 0], iconAnchor: [0, 0], html: '<div style="position:absolute;transform:translate(-50%,-50%);width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#10223B,#1e3a8a);border:3px solid #22c55e;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 8px 20px rgba(0,0,0,.55),0 0 0 0 rgba(34,197,94,.5);animation:lbpulse2 1.8s infinite">\ud83d\ude9b</div><div style="position:absolute;transform:translate(-50%,14px);background:#16a34a;color:#fff;font-size:9px;font-weight:800;padding:2px 9px;border-radius:999px;border:1.5px solid #fff;white-space:nowrap;letter-spacing:.05em">LIVE</div><style>@keyframes lbpulse2{0%{box-shadow:0 8px 20px rgba(0,0,0,.55),0 0 0 0 rgba(34,197,94,.5)}70%{box-shadow:0 8px 20px rgba(0,0,0,.55),0 0 0 20px rgba(34,197,94,0)}100%{box-shadow:0 8px 20px rgba(0,0,0,.55),0 0 0 0 rgba(34,197,94,0)}}</style>' }) }).addTo(map);
            pts.push(tk);
          }
          if (pts.length) map.fitBounds(pts, { padding: [46, 46] });
          const from9 = tk || pk, to9 = dl;
          if (from9 && to9) {
            try {
              const r9 = await fetch('https://router.project-osrm.org/route/v1/driving/' + from9[1] + ',' + from9[0] + ';' + to9[1] + ',' + to9[0] + '?overview=full&geometries=geojson');
              const j9 = await r9.json(); const rt9 = j9 && j9.routes && j9.routes[0];
              if (rt9 && map) {
                L.geoJSON(rt9.geometry, { style: { color: '#0883F7', weight: 4, opacity: .85 } }).addTo(map);
                const remM = rt9.distance / 1609.34, remH = rt9.duration / 3600;
                remainTxt = Math.round(remM).toLocaleString() + ' mi to delivery';
                etaTxt = fmtT(new Date(Date.now() + rt9.duration * 1000));
                const ar9 = host.querySelector('#lt-arrive');
                if (ar9 && t && !t.delivered_at && tk) {
                  ar9.replaceChildren(document.createTextNode('\ud83d\udce6 Arriving ~ ' + etaTxt),
                    h('small', null, Math.round(remM).toLocaleString() + ' mi to go \u00b7 live from the truck\u2019s GPS'));
                }
                if (ld.miles && Number(ld.miles) > 0 && tk) progPct = Math.max(2, Math.min(98, Math.round(100 * (1 - remM / Number(ld.miles)))));
                const tl = host.querySelector('#lt-tiles');
                if (tl && t && !t.delivered_at) {
                  tl.appendChild(tile(tk ? 'Remaining' : 'Lane', remainTxt, tk ? '~' + (remH >= 1 ? Math.round(remH) + 'h' : Math.round(remH * 60) + 'm') + ' driving' : null));
                  if (tk) tl.appendChild(tile('ETA (live)', etaTxt || '\u2014', 'straight-through driving estimate'));
                  if (progPct != null) {
                    const pr = tile('Trip progress', progPct + '%', null);
                    pr.appendChild(h('div', { class: 'lt-prog' }, h('i', { style: 'width:' + progPct + '%' })));
                    tl.appendChild(pr);
                  }
                }
              }
            } catch (_) {}
          }
        } catch (_) { mapEl.style.display = 'none'; }
      }
      if (!dead && !(t && (t.delivered_at || ts === 'cancelled'))) timer = setTimeout(draw, 30000);
    }
    draw();
    return stop;
  }

  // Premium executed RATE CONFIRMATION — auto-generated from the load, unified LoadBoot signatures.
  function printExecutedRateCon(d) {
    const w9 = window.open('', '_blank'); if (!w9) { alert('Allow pop-ups to download.'); return; }
    const esc = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const logo = '<svg width="34" height="36" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#fff"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#FC5305"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#fff"/></svg>';
    const acc = d.accessorials || {}; const det = d.details || {};
    const rpm = (d.rate && d.miles && Number(d.miles) > 0) ? '$' + (Number(d.rate) / Number(d.miles)).toFixed(2) + '/mi' : '';
    const now9 = new Date();
    const kv = (k, v) => v == null || v === '' ? '' : '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
    const arow = (k, v, note9) => '<tr><td class="ak">' + esc(k) + '</td><td class="av">' + esc(v) + '</td><td class="an">' + esc(note9 || '') + '</td></tr>';
    w9.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Rate Confirmation ' + esc(d.ref) + '</title><style>'
      + '*{box-sizing:border-box}body{font-family:Inter,system-ui,Arial,sans-serif;color:#0f1e36;margin:0 auto;max-width:900px;padding:0 0 30px;background:#fff}'
      + '.band{background:linear-gradient(120deg,#0b1830,#10223B 60%,#14335c);color:#fff;padding:26px 38px;display:flex;justify-content:space-between;align-items:center;gap:14px}'
      + '.band .wd{font-weight:800;font-size:1.3rem;letter-spacing:-.02em}.band .wd span{color:#FC5305}'
      + '.band .doc{text-align:right}.band .doc .t{font-weight:800;font-size:1.05rem;letter-spacing:.16em}'
      + '.band .doc .r{font-family:ui-monospace,Menlo,monospace;font-size:.78rem;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:4px 10px;margin-top:6px;display:inline-block;letter-spacing:.08em}'
      + '.ribbon{background:#16a34a;color:#fff;text-align:center;font-weight:800;letter-spacing:.35em;font-size:.72rem;padding:6px}'
      + '.wrap{padding:24px 38px}'
      + '.parties{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}'
      + '.party{border:1px solid #e6ecf4;border-radius:12px;padding:12px 14px}'
      + '.party .l{font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:#8795a9;font-weight:800;margin-bottom:5px}'
      + '.party .n{font-weight:800;font-size:.9rem}.party .s{font-size:.72rem;color:#51617a;margin-top:3px;line-height:1.6}'
      + '.lane{display:flex;justify-content:space-between;align-items:stretch;gap:14px;background:#f6f9fd;border:1px solid #e0eaf6;border-radius:14px;padding:18px 20px;margin-bottom:18px}'
      + '.lane .stop .tag{font-size:.6rem;letter-spacing:.12em;font-weight:800;color:#0883F7}.lane .stop .a{font-weight:800;font-size:.95rem;margin-top:3px;max-width:280px}'
      + '.lane .stop .w{font-size:.74rem;color:#51617a;margin-top:4px;line-height:1.6}'
      + '.lane .arrow{align-self:center;color:#94a3b8;font-size:1.4rem}'
      + '.lane .money{text-align:right;align-self:center}.lane .money b{font-size:1.65rem;color:#0967d2}.lane .money .m{font-size:.74rem;color:#51617a}'
      + 'h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.16em;color:#8795a9;margin:20px 0 8px;display:flex;align-items:center;gap:8px}'
      + 'h2:after{content:"";flex:1;height:1px;background:#e6ecf4}'
      + '.g2{display:grid;grid-template-columns:1fr 1fr;gap:0 34px}'
      + '.kv{display:flex;justify-content:space-between;gap:14px;padding:6px 2px;border-bottom:1px solid #f1f5f9;font-size:.82rem}'
      + '.kv span{color:#51617a}.kv b{text-align:right}'
      + 'table.acc{width:100%;border-collapse:collapse;font-size:.8rem;border:1px solid #e6ecf4;border-radius:10px;overflow:hidden}'
      + 'table.acc th{background:#10223B;color:#fff;text-align:left;padding:8px 12px;font-size:.66rem;letter-spacing:.1em;text-transform:uppercase}'
      + 'table.acc td{padding:8px 12px;border-bottom:1px solid #eef2f7}table.acc tr:nth-child(even) td{background:#f8fafc}'
      + 'td.ak{font-weight:700;width:220px}td.av{font-weight:800;color:#0967d2;width:180px}td.an{color:#51617a;font-size:.74rem}'
      + '.terms{font-size:.7rem;color:#51617a;line-height:1.7;background:#f8fafc;border:1px solid #eef2f7;border-radius:10px;padding:12px 14px;margin-top:14px}'
      + '.terms b{color:#0f1e36}'
      + '.sigrow{display:flex;gap:20px;margin-top:24px;page-break-inside:avoid}'
      + '.sig{flex:1;border:1px solid #e6ecf4;border-radius:12px;padding:14px 16px}'
      + '.sig .lbl{font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:#8795a9;font-weight:800}'
      + '.sig .line{font-family:"Segoe Script","Brush Script MT",cursive;font-size:1.45rem;border-bottom:1.5px solid #24344d;padding:14px 4px 5px;min-height:46px}'
      + '.sig .who{display:flex;justify-content:space-between;font-size:.68rem;color:#51617a;margin-top:6px}'
      + '.sig.lb .line{color:#0e7490}'
      + '.stamp{position:relative;margin:24px auto 0;width:190px;text-align:center;border:3.5px solid #16a34a;color:#16a34a;border-radius:12px;padding:9px 4px;font-weight:800;letter-spacing:.25em;transform:rotate(-4deg);font-size:.95rem}'
      + '.ft{margin-top:24px;border-top:1px solid #e6ecf4;padding:12px 38px 0;font-size:.64rem;color:#8795a9;text-align:center;line-height:1.7}'
      + '@media print{body{max-width:none}.band{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
      + '</style></head><body>'
      + '<div class="band"><div style="display:flex;gap:12px;align-items:center">' + logo + '<div><div class="wd">Load<span>Boot</span></div><div style="font-size:.66rem;opacity:.7;letter-spacing:.08em">THE OPERATING SYSTEM FOR TRUCKING \u00b7 LOADBOOT.COM</div></div></div>'
      + '<div class="doc"><div class="t">RATE CONFIRMATION</div><div class="r">' + esc(d.ref) + '</div><div style="font-size:.62rem;opacity:.65;margin-top:5px">Issued ' + esc(now9.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })) + ' \u00b7 server-timestamped</div></div></div>'
      + '<div class="ribbon">E X E C U T E D &nbsp;\u00b7&nbsp; L E G A L L Y &nbsp;B I N D I N G</div>'
      + '<div class="wrap">'
      + '<div class="parties">'
      + '<div class="party"><div class="l">Broker (customer)</div><div class="n">' + esc(d.broker_name || '\u2014') + '</div><div class="s">Signed by ' + esc(d.signer) + '<br>' + esc(d.signed_date) + '</div></div>'
      + '<div class="party"><div class="l">Dispatch & settlement</div><div class="n">LoadBoot Dispatch</div><div class="s">24/7 day-of contact<br>All payments & documents flow through LoadBoot</div></div>'
      + '<div class="party"><div class="l">Carrier</div><div class="n">Auto-attached at booking</div><div class="s">The accepting carrier\u2019s verified identity, authority & COI join this document the moment the load is accepted</div></div>'
      + '</div>'
      + '<div class="lane"><div class="stop"><div class="tag">\u25cf ORIGIN \u2014 PICKUP</div><div class="a">' + esc(d.origin_full || d.origin) + '</div><div class="w">' + esc([d.pickup_date, d.pickup_window].filter(Boolean).join(' \u00b7 ')) + (det.dock_hours_pickup ? '<br>Dock: ' + esc(det.dock_hours_pickup) : '') + '</div></div>'
      + '<div class="arrow">\u27f6</div>'
      + '<div class="stop"><div class="tag" style="color:#FC5305">\u25cf DESTINATION \u2014 DELIVERY</div><div class="a">' + esc(d.destination_full || d.destination) + '</div><div class="w">' + esc([d.delivery_date, d.delivery_window].filter(Boolean).join(' \u00b7 ')) + (det.dock_hours_delivery ? '<br>Dock: ' + esc(det.dock_hours_delivery) : '') + '</div></div>'
      + '<div class="money"><b>$' + esc(Number(d.rate || 0).toLocaleString()) + '</b><div class="m">ALL-IN LINEHAUL' + (rpm ? ' \u00b7 ' + esc(rpm) : '') + (d.miles ? ' \u00b7 ' + esc(Number(d.miles).toLocaleString()) + ' mi' : '') + '</div></div></div>'
      + '<div class="g2"><div><h2>\ud83d\udce6 Freight</h2>'
      + kv('Equipment', d.equipment) + kv('Load size', det.load_size) + kv('Commodity', d.commodity)
      + kv('Weight', d.weight ? Number(d.weight).toLocaleString() + ' lb' : '') + kv('Pallets / pieces', det.pallets)
      + kv('Reefer temperature', det.temperature ? det.temperature + '\u00b0F' : '') + kv('Tarps', det.tarps)
      + kv('Cargo value', det.cargo_value ? '$' + Number(det.cargo_value).toLocaleString() : '')
      + kv('Hazmat', d.hazmat ? 'YES' + (d.hazmat_info ? ' \u2014 ' + d.hazmat_info : '') : 'No')
      + '</div><div><h2>\ud83d\udcc5 Scheduling & handling</h2>'
      + kv('Scheduling', d.appointment_required ? 'By appointment' : 'FCFS \u2014 first come, first served')
      + kv('Pickup loading', det.load_method_pickup) + kv('Delivery unloading', det.load_method_delivery)
      + kv('Driver assist', det.driver_assist_required ? 'REQUIRED \u2014 payable per schedule below' : 'Not required')
      + kv('Drivers', det.team_required ? 'TEAM required' : 'Solo OK')
      + kv('Tracking', 'Mandatory \u2014 live GPS from booking to delivery')
      + kv('Reference / PO', d.reference)
      + '</div></div>'
      + '<h2>\ud83e\uddfe Accessorial schedule \u2014 payable with proof, no negotiation at the dock</h2>'
      + '<table class="acc"><tr><th>Item</th><th>Rate</th><th>Condition</th></tr>'
      + arow('Detention', '$' + (acc.detention_per_hr || '60') + '/hr', 'after ' + (acc.detention_free_hours || '2') + ' free hours \u00b7 GPS dwell is proof')
      + arow('Layover', '$' + (acc.layover_per_day || '250') + '/day', 'when held overnight through no fault of the carrier')
      + arow('TONU', '$' + (acc.tonu || '250'), 'truck ordered, not used \u2014 auto-paid on broker cancel after commitment')
      + arow('Lumper', acc.lumper_policy || 'Reimbursed with receipt', 'receipt uploaded in-app')
      + (acc.driver_assist ? arow('Driver assist', '$' + acc.driver_assist + '/stop', det.driver_assist_required ? 'REQUIRED on this load' : 'if requested at the dock') : '')
      + (acc.extra_stop ? arow('Extra stop', '$' + acc.extra_stop + '/stop', 'per additional stop') : '')
      + '</table>'
      + '<div class="terms"><b>Terms.</b> This Rate Confirmation is issued under and governed by the executed LoadBoot Master Broker Agreement and the LoadBoot marketplace policies (detention, layover, TONU, lumper, driver-assist, FCFS and emergency-rescheduling \u2014 loadboot.com/policies). Live GPS tracking and in-app document capture (signed BOL/POD at every stop) are mandatory and constitute the evidence record. Settlement is processed exclusively through LoadBoot with documented terms; the carrier never invoices the broker directly. Verified on-road emergencies are handled per the Emergency Rescheduling Policy with no carrier penalty. This document was generated by LoadBoot from the posted load data and recorded with a server timestamp.</div>'
      + '<div class="sigrow">'
      + '<div class="sig"><div class="lbl">Broker \u2014 ' + esc(d.broker_name || '') + '</div><div class="line">' + esc(d.signer) + '</div><div class="who"><span>' + esc(d.signer) + '</span><span>Signed online \u00b7 ' + esc(d.signed_date) + '</span></div></div>'
      + '<div class="sig lb"><div class="lbl">LoadBoot \u2014 counter-signature</div><div class="line">LoadBoot Dispatch</div><div class="who"><span>Authorized Signatory, LoadBoot</span><span>' + esc(d.signed_date) + '</span></div></div>'
      + '</div>'
      + '<div class="stamp">EXECUTED</div>'
      + '</div>'
      + '<div class="ft">Ref ' + esc(d.ref) + ' \u00b7 generated ' + esc(now9.toISOString()) + ' \u00b7 recorded with a server timestamp \u00b7 the accepting carrier\u2019s executed copy is attached to the trip automatically \u00b7 LoadBoot \u00b7 loadboot.com</div>'
      + '<script>setTimeout(function(){window.print()},450)<\/script></body></html>');
    w9.document.close();
  }

  // Premium broker document checklist — auto-generate what CAN be generated, structured inputs for the rest.
  function brokerDocs(l) {
    const bodyEl = h('div', null, h('div', { class: 'cp-sub' }, 'Loading checklist\u2026'));
    openModal('\ud83d\udce4 Documents YOU provide \u2014 ' + (l.origin || '?') + ' \u2192 ' + (l.destination || '?'), [bodyEl], { wide: true });
    (async () => {
      let items, fl = null;
      try { items = await loadChecklist('partner_load', l.id); } catch (e) { mount(bodyEl, h('div', { class: 'cp-err' }, (e && e.message) || 'Could not load checklist.')); return; }
      try { fl = await partnerLoadFull(l.id); } catch (_) {}
      items = (items || []).filter(it => it.required_from === 'broker');
      if (!items.length) { mount(bodyEl, h('div', { class: 'cp-sub' }, 'No documents required from you for this load.')); return; }
      const CFG = {
        rate_confirmation: { ic: '\ud83e\uddfe', help: 'Auto-generated from this load \u2014 review, sign, done. The executed copy goes on the carrier packet and stays downloadable here.' },
        pickup_number: { ic: '\ud83d\udce6', help: 'The PU / release number the SHIPPER gave you \u2014 the driver quotes it at the gate.', fields: [['Pickup / PU number *', 'pu']] },
        delivery_number: { ic: '\ud83c\udfc1', help: 'The delivery / confirmation number from the RECEIVER.', fields: [['Delivery number *', 'dn']] },
        appointment_confirmation: { ic: '\ud83d\udcc5', help: 'Appointment confirmation from the facility (number and confirmed time).', fields: [['Confirmation #', 'ac'], ['Confirmed time (e.g. Jul 16, 10:00 AM)', 'at']] },
        billing_contact: { ic: '\ud83d\udcb3', help: 'Who receives the invoice \u2014 accounts payable at your company or your customer.', fields: [['Contact name *', 'bn'], ['Email *', 'be'], ['Phone', 'bp']] },
        // AGENT-POSTED LOADS — the 3 LOAD SOURCE proofs (due 2h after posting; overdue pauses your postings)
        source_identity: { ic: '\ud83c\udfe2', help: 'WHO really pays this load \u2014 the source broker/shipper\u2019s legal company name (+ MC/DOT if a broker; shippers have none).', fields: [['Source company name *', 'sc'], ['MC / DOT # (brokers only)', 'sm']] },
        source_rate_con: { ic: '\ud83e\uddfe', help: 'The rate confirmation / tender you got FROM the source \u2014 reference # here (upload the file under the load\u2019s documents). Shipper direct: PO / contract / tender email reference.', fields: [['Rate con / PO / tender reference *', 'sr']] },
        source_billing: { ic: '\ud83d\udcb3', help: 'The SOURCE\u2019s accounts-payable contact \u2014 where invoices for this load go.', fields: [['AP contact name *', 'sn'], ['AP email *', 'se'], ['AP phone', 'sp']] },
      };
      // WHEN each item is needed — the just-in-time sequence so the driver is never blocked.
      const WHEN = {
        rate_confirmation:        [1, '\u2460 NEEDED NOW \u2014 the driver can\u2019t legally roll without it', '#b91c1c', '#fef2f2'],
        appointment_confirmation: [1, '\u2460 NEEDED NOW (appointment loads) \u2014 the confirmed pickup time', '#b91c1c', '#fef2f2'],
        pickup_number:            [2, '\u2461 Before the driver reaches pickup \u2014 released at the gate', '#92400e', '#fffbeb'],
        delivery_number:          [3, '\u2462 Before delivery \u2014 can follow after pickup', '#1e40af', '#eff6ff'],
        billing_contact:          [4, '\u2463 Only to get paid \u2014 after POD, before you invoice', '#475569', '#f1f5f9'],
        source_identity:          [0, '\u26a1 AGENT \u2014 DUE 2H AFTER POSTING or your postings pause', '#9a3412', '#fff7ed'],
        source_rate_con:          [0, '\u26a1 AGENT \u2014 DUE 2H AFTER POSTING or your postings pause', '#9a3412', '#fff7ed'],
        source_billing:           [0, '\u26a1 AGENT \u2014 DUE 2H AFTER POSTING or your postings pause', '#9a3412', '#fff7ed'],
      };
      items.sort((a, b) => ((WHEN[a.doc_key] && WHEN[a.doc_key][0]) || 9) - ((WHEN[b.doc_key] && WHEN[b.doc_key][0]) || 9));
      const done = items.filter(it => it.status === 'verified' || it.status === 'received').length;
      mount(bodyEl, h('div', null, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
          h('div', { class: 'cp-sub' }, done + ' of ' + items.length + ' provided \u2014 these go TO the carrier\u2019s dispatch pack (PU/delivery numbers, signed RC); until you submit them the driver sees \u201cpending from broker\u201d. What you RECEIVE from the carrier is under \ud83d\udce6 Carrier packet on the load card.'),
        ]),
        h('div', { style: 'height:6px;border-radius:99px;background:#eef2f7;margin-bottom:14px;overflow:hidden' },
          h('div', { style: 'height:100%;width:' + Math.round(100 * done / items.length) + '%;background:linear-gradient(90deg,#0883F7,#22c55e);border-radius:99px' })),
        h('div', { style: 'background:#f8fafc;border:1px solid #e6ebf3;border-radius:12px;padding:10px 13px;margin-bottom:12px;font-size:.82rem;color:#334155;line-height:1.65' }, [
          h('b', { style: 'color:#10223B' }, 'When each item is needed \u2014 so the driver is never blocked:'),
          h('div', { style: 'margin-top:2px' }, '\u2460 Rate confirmation + appointment \u2014 the moment you book, so the driver can roll. \u2461 Pickup # \u2014 before the driver reaches pickup. \u2462 Delivery # \u2014 before delivery. \u2463 Billing contact \u2014 only to get paid, after POD.'),
        ]),
        ...items.map(it => {
          const cfg = CFG[it.doc_key] || { ic: '\ud83d\udcc4', help: '', fields: [['Reference / note *', 'x']] };
          const stC = it.status === 'verified' ? ['#dcfce7', '#166534', '\u2713 verified'] : it.status === 'received' ? ['#eff6ff', '#1d4ed8', '\u23f3 submitted \u2014 in review'] : it.status === 'rejected' ? ['#fee2e2', '#991b1b', '\u2715 rejected \u2014 fix below'] : ['#fef3c7', '#92400e', '\u26a0 required'];
          const wrap = h('div', { style: 'background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:14px 16px;margin-bottom:11px;box-shadow:0 8px 24px -20px rgba(2,12,30,.3)' });
          const _wn = WHEN[it.doc_key];
          if (_wn) wrap.appendChild(h('div', { style: 'display:inline-block;font-size:.66rem;font-weight:800;padding:3px 10px;border-radius:999px;margin-bottom:9px;background:' + _wn[3] + ';color:' + _wn[2] }, _wn[1]));
          wrap.appendChild(h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap' }, [
            h('div', { style: 'display:flex;gap:10px;align-items:center' }, [
              h('span', { style: 'font-size:1.25rem' }, cfg.ic),
              h('div', null, [h('b', { style: 'color:#10223B' }, it.label || it.doc_key), h('div', { class: 'cp-sub', style: 'max-width:520px' }, cfg.help)]),
            ]),
            h('span', { style: 'padding:4px 12px;border-radius:999px;font-size:.7rem;font-weight:800;background:' + stC[0] + ';color:' + stC[1] }, stC[2]),
          ]));
          if (it.review_reason) wrap.appendChild(h('div', { style: 'margin-top:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:8px 12px;font-size:.8rem;color:#991b1b' }, 'Fix needed: ' + it.review_reason));
          if (it.submitted_ref && it.status !== 'rejected') wrap.appendChild(h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'You sent: ' + it.submitted_ref));
          const needsInput = it.status === 'required' || it.status === 'rejected';
          if (it.doc_key === 'rate_confirmation') {
            let saved = null; try { saved = it.submitted_note ? JSON.parse(it.submitted_note) : null; } catch (_) {}
            if (saved && saved.ref) wrap.appendChild(h('button', { class: 'cp-btn ghost cp-btn-sm', style: 'margin-top:9px', onClick: () => printExecutedRateCon(saved) }, '\u2b07 Download executed rate confirmation (' + saved.ref + ')'));
            if (needsInput) {
              if (!fl) wrap.appendChild(h('div', { class: 'cp-sub', style: 'margin-top:8px' }, 'Could not read the load \u2014 refresh and retry.'));
              else wrap.appendChild(h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:9px', onClick: () => {
                const nameIn = h('input', { class: 'cp-in', placeholder: 'Type your full legal name to SIGN' });
                const emsg = h('div', { class: 'cp-err' });
                const closeS = openModal('\u270d Sign rate confirmation', [h('div', null, [
                  h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'Generated from this load \u2014 lane, schedule, freight and your full rate card. Signing executes it with a server timestamp; LoadBoot counter-signs automatically and the carrier packet gets the executed copy.'),
                  h('div', { style: 'background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:10px 13px;font-size:.8rem;color:#334155;margin-bottom:10px' },
                    (fl.origin_full || fl.origin) + ' \u2192 ' + (fl.destination_full || fl.destination) + ' \u00b7 $' + Number(fl.rate || 0).toLocaleString() + ' \u00b7 ' + (fl.equipment || '') + ' \u00b7 PU ' + (fl.pickup_date || '')),
                  nameIn, emsg,
                  h('button', { class: 'cp-btn', style: 'width:100%;margin-top:8px', onClick: async (ev) => {
                    const btn = ev.currentTarget;
                    if (!nameIn.value.trim()) { emsg.textContent = 'Type your full legal name to sign.'; return; }
                    btn.disabled = true;
                    const d = Object.assign({}, fl, { signer: nameIn.value.trim(), signed_date: new Date().toISOString().slice(0, 10),
                      ref: 'LB-RC-' + String(fl.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() });
                    try {
                      await partnerChecklistSubmit(it.id, 'Rate confirmation ' + d.ref + ' signed online by ' + d.signer + ' on ' + d.signed_date, JSON.stringify(d));
                      printExecutedRateCon(d); closeS(); brokerDocs(l);
                    } catch (e) { btn.disabled = false; emsg.textContent = (e && e.message) || 'Could not submit.'; }
                  } }, '\u270d Sign & download executed copy'),
                ])]);
              } }, '\u26a1 Generate & sign rate confirmation'));
            }
          } else if (needsInput) {
            const ins2 = (cfg.fields || []).map(([ph]) => h('input', { class: 'cp-in', placeholder: ph, style: 'margin:0;flex:1;min-width:150px' }));
            const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
              const btn = ev.currentTarget;
              const req = (cfg.fields || []).map((f, i9) => [f[0], ins2[i9].value.trim()]);
              const miss = req.filter(([lbl, v9]) => /\*/.test(lbl) && !v9);
              if (miss.length) { alert('Required: ' + miss.map(([lbl]) => lbl.replace(' *', '')).join(', ')); return; }
              btn.disabled = true;
              const refTxt = req.filter(([, v9]) => v9).map(([lbl, v9]) => lbl.replace(' *', '') + ': ' + v9).join(' \u00b7 ');
              try { await partnerChecklistSubmit(it.id, refTxt); btn.textContent = 'Sent \u2713'; brokerDocs(l); }
              catch (e) { btn.disabled = false; alert((e && e.message) || 'Could not submit.'); }
            } }, 'Submit');
            wrap.appendChild(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:9px;align-items:center' }, [...ins2, send]));
          }
          return wrap;
        }),
      ]));
    })();
  }
  // Claims filed by carriers on YOUR loads — GPS + policy evidence, approve or dispute, support escalation.
  function claimsCard() {
    const card = h('div', { class: 'cp-card', id: 'claims' }, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, '\ud83d\udcb0 Claims on your loads')]), h('div', { class: 'cp-sub' }, 'Loading\u2026')]);
    async function loadClaims() {
      let rows; try { rows = await partnerClaims(); } catch (e) { mount(card, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, '\ud83d\udcb0 Claims on your loads')]), h('div', { class: 'cp-sub' }, (e && e.message) || 'Could not load.')]); return; }
      rows = rows || [];
      const pend = rows.filter((b) => b.claim && b.claim.broker_status === 'pending').length;
      const items = rows.length ? rows.map((b) => {
        const c = b.claim || {}; const t = b.trip || {}; const dw = b.gps_dwell || []; const cxl = b.cancellation_trail || [];
        const stPill = c.broker_status === 'approved' ? ['#e7f9ee', '#12a150', '\u2713 You approved'] : c.broker_status === 'disputed' ? ['#fee2e2', '#b91c1c', '\u2715 You rejected'] : ['#fef3c7', '#b45309', '\u23f3 Needs your review'];
        const supPill = c.support_status === 'open' ? h('span', { class: 'cp-pill', style: 'background:#dbeafe;color:#1d4ed8' }, '\ud83c\udfa7 With LoadBoot support') : c.support_status === 'decided' ? h('span', { class: 'cp-pill', style: 'background:' + (c.support_verdict === 'broker' ? '#e7f9ee;color:#12a150' : '#fee2e2;color:#b91c1c') }, '\u2696 Support ruled: ' + c.support_verdict) : null;
        const det = h('div', { style: 'display:none;margin-top:8px;border-top:1px dashed #e2e8f0;padding-top:8px' }, [
          h('div', { style: 'font-weight:700;font-size:.85rem;margin-bottom:4px' }, '\ud83d\udd52 What happened, minute by minute'),
          (Array.isArray(b.timeline) && b.timeline.length) ? h('div', { style: 'border-left:3px solid #0883F7;padding-left:10px;margin-bottom:8px' }, b.timeline.map((tl9) => h('div', { class: 'cp-sub', style: 'padding:3px 0' }, [h('b', { style: 'color:#0f172a' }, tl9.at ? new Date(tl9.at).toLocaleString() : ''), ' \u2014 ' + (tl9.what || '')]))) : h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'No timeline events yet.'),
          (b.filed_evidence && b.filed_evidence.calc) ? h('div', { class: 'cp-sub', style: 'margin-bottom:8px;background:#eff6ff;border-radius:8px;padding:8px 10px' }, [h('b', null, '\u{1F9EE} Amount ' + money(c.amount || 0) + ': '), b.filed_evidence.calc + ' \u2014 the rates you agreed to when posting this load.']) : null,
          (Array.isArray(b.stop_documents) && b.stop_documents.length) ? h('div', { style: 'margin-bottom:8px' }, [
            h('div', { style: 'font-weight:700;font-size:.85rem' }, '\ud83d\udcce Paper proof collected at the stops'),
            ...b.stop_documents.map((d9) => h('div', { class: 'cp-sub', style: 'padding:2px 0' }, [
              ({ bol_signed: '\ud83d\udcdd Facility-SIGNED BOL', pod_signed: '\ud83d\udcdd Facility-SIGNED POD', lumper_receipt: '\ud83e\uddfe Lumper receipt', gate_ticket: '\ud83c\udfab Gate ticket', stop_photo: '\ud83d\udcf7 Stop photo', pod: 'POD' }[d9.kind] || d9.kind) + ' \u2014 ' + (d9.file_name || '') + ' \u00b7 uploaded ' + (d9.uploaded_at ? new Date(d9.uploaded_at).toLocaleString() : ''),
              d9.path ? h('a', { href: '#', style: 'margin-left:8px;color:#0883F7;font-weight:700', onClick: async (ev9) => { ev9.preventDefault(); const a9 = ev9.currentTarget; const was9 = a9.textContent; a9.textContent = 'opening\u2026'; try { const u9 = await signedDocumentUrl(d9.path, 600); window.open(u9, '_blank', 'noopener'); } catch (e9) { alert((e9 && e9.message) || 'Could not open the document.'); } a9.textContent = was9; } }, 'View \u2197') : h('span', { style: 'margin-left:8px;color:#94a3b8' }, '(ask support for a copy)'),
            ].filter(Boolean))),
          ] ) : null,
          h('div', { style: 'font-weight:700;font-size:.85rem' }, 'GPS evidence \u2014 recorded on scene'),
          dw.length ? h('div', null, dw.map((e9) => h('div', { class: 'cp-sub', style: 'padding:3px 0' }, [
            (e9.stop || '') + ': arrived ' + (e9.arrived_at ? new Date(e9.arrived_at).toLocaleString() : '\u2014') + ' \u00b7 departed ' + (e9.departed_at ? new Date(e9.departed_at).toLocaleString() : '\u2014')
            + (e9.held_minutes != null ? ' \u00b7 held ' + e9.held_minutes + ' min (free ' + (e9.free_minutes || 0) + ', detention ' + (e9.detention_minutes || 0) + ' min)' : '')
            + (e9.gps ? ' \u00b7 GPS \u2713 (' + Math.round(e9.gps.distance_m || 0) + 'm from pin)' : ''),
            e9.gps ? h('a', { href: (e9.stop_gps ? 'https://www.google.com/maps/dir/?api=1&origin=' + e9.gps.lat + ',' + e9.gps.lng + '&destination=' + e9.stop_gps.lat + ',' + e9.stop_gps.lng + '&travelmode=walking' : 'https://maps.google.com/?q=' + e9.gps.lat + ',' + e9.gps.lng), target: '_blank', rel: 'noopener', style: 'margin-left:6px;color:#0883F7;font-weight:700', title: e9.stop_gps ? 'Opens BOTH pins — the truck\u2019s recorded fix AND your facility; the tiny gap between them is the proof of presence' : '' }, e9.stop_gps ? 'verify: truck vs facility ↗' : 'verify on map ↗') : null,
          ].filter(Boolean)))) : h('div', { class: 'cp-sub' }, 'No dwell events recorded.'),
          h('div', { class: 'cp-sub', style: 'margin-top:6px;background:#f8fafc;border-radius:8px;padding:8px 10px' }, '\ud83d\udd12 These timestamps and GPS fixes were recorded automatically by LoadBoot on scene (geofenced arrive/depart) \u2014 neither party can create or edit them. \u201cVerify: truck vs facility\u201d opens BOTH pins on Google Maps \u2014 the truck\u2019s recorded position AND your facility. If they sit together (see the meters shown), the truck was there at those timestamps; that is the proof.'),
          cxl.length ? h('div', { style: 'margin-top:6px' }, [h('div', { style: 'font-weight:700;font-size:.85rem' }, 'Cancellation trail'), ...cxl.map((x9) => h('div', { class: 'cp-sub' }, new Date(x9.at).toLocaleString() + ' \u2014 ' + (x9.what || '')))]) : null,
          c.note ? h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'Carrier\u2019s note: \u201c' + c.note + '\u201d') : null,
          b.policy ? h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'Rates apply per the LoadBoot rate card agreed at booking (detention/layover/TONU/lumper).') : null,
          c.broker_note ? h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'Your note: ' + c.broker_note) : null,
          c.support_note ? h('div', { style: 'margin-top:6px;background:#eff6ff;border-radius:8px;padding:8px 10px;font-size:.85rem' }, [h('b', null, 'Support verdict: '), c.support_note]) : null,
        ].filter(Boolean));
        const caret = h('span', { style: 'color:#0883F7;font-weight:700;font-size:.82rem;cursor:pointer' }, '\u25be Evidence');
        const actRow = (c.broker_status === 'pending') ? h('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
          h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { const b9 = ev.currentTarget;
            if (!confirm('Approve this ' + c.kind + ' claim? LoadBoot finalizes the amount and it lands on your invoice.')) return;
            b9.disabled = true; try { await partnerReviewClaim(c.id, 'approve', null); loadClaims(); } catch (e) { b9.disabled = false; alert((e && e.message) || 'Failed.'); }
          } }, '\u2713 Approve'),
          h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#fff;border:1px solid #fca5a5;color:#b91c1c', onClick: async (ev) => { const b9 = ev.currentTarget;
            const nt = prompt('Reject \u2014 why? (the carrier sees this; LoadBoot support can be called in to decide on the GPS evidence):'); if (!nt) return;
            b9.disabled = true; try { await partnerReviewClaim(c.id, 'dispute', nt); loadClaims(); } catch (e) { b9.disabled = false; alert((e && e.message) || 'Failed.'); }
          } }, '\u2715 Reject'),
        ]) : (c.support_status === 'none' && c.broker_status === 'disputed') ? h('div', { style: 'margin-top:8px' },
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { const b9 = ev.currentTarget; b9.disabled = true;
            try { await claimEscalate(c.id); loadClaims(); alert('Escalated \u2014 LoadBoot support will investigate the GPS + policy evidence and decide. The verdict is final for both sides.'); } catch (e) { b9.disabled = false; alert((e && e.message) || 'Failed.'); }
          } }, '\ud83c\udfa7 Ask LoadBoot support to decide')) : null;
        // ---- PAY THIS CLAIM: bank details + guidelines -> receipt upload -> carrier confirms ----
        const payW = h('div');
        if (c.broker_status === 'approved') (async () => {
          let pi; try { pi = await payInstructions('claim', c.id); } catch (_) { return; }
          const tr9 = pi && pi.transfer;
          const renderState = () => {
            if (tr9 && tr9.status === 'received') {
              mount(payW, h('div', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150;margin-top:8px' }, '\u2713 Paid \u2014 carrier confirmed received ' + (tr9.received_at ? new Date(tr9.received_at).toLocaleDateString() : '')));
              return;
            }
            if (tr9 && tr9.status === 'sent') {
              mount(payW, h('div', { style: 'margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 12px;font-size:.85rem' }, [
                h('b', null, '\u{1F4B8} Payment sent \u2014 receipt uploaded. '),
                'Expected to land by ' + (tr9.expected_by ? new Date(tr9.expected_by).toLocaleDateString() : '1\u20133 business days') + ' \u00b7 shows as PAID once the carrier taps \u201C\u2713 Received\u201D.',
                tr9.payment_ref ? ' \u00b7 ref: ' + tr9.payment_ref : '',
              ]));
              return;
            }
            const openB = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#16a34a;margin-top:8px', onClick: () => { openB.style.display = 'none'; panel.style.display = 'block'; } }, '\u{1F4B8} Pay this claim \u2014 ' + money(pi.amount || c.amount || 0));
            const bank = pi.payee_bank || {};
            const row9 = (k9, v9) => v9 ? h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #e2e8f0;font-size:.85rem' }, [h('span', { style: 'color:#64748b' }, k9), h('b', { style: 'user-select:all' }, String(v9))]) : null;
            const refIn = h('input', { class: 'cp-in', placeholder: 'Bank transfer reference / confirmation #', style: 'margin-top:8px' });
            const fIn = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.85rem;margin-top:6px' });
            const msg9 = h('div', { class: 'cp-sub', style: 'margin-top:4px' });
            const sendB = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: async (ev9) => { const b9 = ev9.currentTarget;
              const f9 = fIn.files && fIn.files[0]; if (!f9) { msg9.textContent = 'Attach the payment receipt/screenshot first \u2014 that is what the carrier sees.'; return; }
              b9.disabled = true; b9.textContent = 'Sending\u2026';
              try {
                const m9 = await uploadDocument(f9, 'payment_receipt');
                await payMarkSent({ kind: 'claim', ref: c.id, receiptPath: m9.path, receiptName: m9.fileName, paymentRef: refIn.value.trim() || null, method: 'bank_transfer' });
                loadClaims();
              } catch (e9) { b9.disabled = false; b9.textContent = 'I have paid \u2014 submit receipt'; msg9.textContent = (e9 && e9.message) || 'Failed.'; }
            } }, 'I have paid \u2014 submit receipt');
            const panel = h('div', { style: 'display:none;margin-top:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px' }, [
              h('div', { style: 'font-weight:800;font-size:.9rem' }, 'How to pay \u2014 ' + (pi.label || 'this claim')),
              h('div', { style: 'font-size:1.3rem;font-weight:900;margin:4px 0' }, money(pi.amount || 0)),
              pi.noa_warning ? h('div', { style: 'background:#fee2e2;color:#b91c1c;border-radius:8px;padding:8px 10px;font-size:.83rem;font-weight:700;margin:6px 0' }, '\u26a0 ' + pi.noa_warning) : null,
              bank.instructions ? h('div', { class: 'cp-sub', style: 'white-space:pre-wrap' }, bank.instructions) : h('div', null, [
                bank.pay_to ? h('div', { style: 'background:#4c1d95;color:#fff;border-radius:9px;padding:8px 12px;font-weight:900;font-size:.85rem;margin:4px 0' }, '🏦 PAY THE FACTORING COMPANY — ' + (bank.factoring_company || '') + (bank.verified ? ' · NOA verified by LoadBoot ✓' : ' · NOA verification pending ⏳')) : null,
        bank.pay_to ? row9('Factoring company', bank.factoring_company) : null,
        row9('Payee', bank.account_title), row9('Bank', bank.bank_name), row9('Account #', bank.account_number),
                row9('Routing (ACH)', bank.routing_number), row9('Account type', bank.account_type), row9('SWIFT/BIC', bank.swift_bic),
                row9('Remittance email', bank.remittance_email), row9('Preferred method', bank.payment_method),
                bank.verified ? h('div', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150;margin-top:6px' }, '\u2713 Bank details verified by LoadBoot') : h('div', { class: 'cp-pill', style: 'background:#fef3c7;color:#b45309;margin-top:6px' }, '\u26a0 Details not yet verified \u2014 confirm with the carrier before a large transfer'),
              ].filter(Boolean)),
              h('div', { class: 'cp-sub', style: 'margin-top:8px' }, (pi.guidelines || '') + ' Use this memo reference: '),
              h('b', { style: 'user-select:all' }, c.ref || ''),
              refIn, fIn, sendB, msg9,
            ].filter(Boolean));
            mount(payW, h('div', null, [openB, panel]));
          };
          renderState();
        })();
        return h('div', { style: 'padding:10px 0;border-bottom:1px solid #e2e8f0' }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;cursor:pointer', onClick: () => { const on = det.style.display !== 'none'; det.style.display = on ? 'none' : 'block'; caret.textContent = on ? '\u25be Evidence' : '\u25b4 Hide'; } }, [
            h('div', null, [h('b', null, String(c.kind || '').toUpperCase() + ' \u00b7 ' + money(c.amount || 0) + ' \u2014 ' + (t.origin || '') + ' \u2192 ' + (t.destination || '')), h('div', { class: 'cp-sub' }, (c.ref || '') + ' \u00b7 filed ' + (c.filed_at ? new Date(c.filed_at).toLocaleString() : '') + ' \u00b7 carrier: ' + (t.carrier || ''))]),
            h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [supPill, h('span', { class: 'cp-pill', style: 'background:' + stPill[0] + ';color:' + stPill[1] }, stPill[2]), caret].filter(Boolean)),
          ]),
          actRow, payW, det,
        ].filter(Boolean));
      }) : [h('div', { class: 'cp-sub' }, 'No claims filed on your loads.')];
      mount(card, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, '\ud83d\udcb0 Claims on your loads'), pend ? h('span', { class: 'cp-pill', style: 'background:#fef3c7;color:#b45309;margin-left:8px' }, pend + ' need review') : null].filter(Boolean)), ...items]);
    }
    loadClaims();
    return card;
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
  function openBrokerW9(it, onDone) {
  const f = (ph, v) => h('input', { class: 'cp-in', placeholder: ph, value: v || '' });
  const name = f('Legal name (as on tax return)'), biz = f('Business / DBA name (optional)');
  const cls = h('select', { class: 'cp-in' }, ['Individual/sole proprietor', 'C corporation', 'S corporation', 'Partnership', 'Trust/estate', 'LLC'].map((x) => h('option', { value: x }, x)));
  const tin = f('EIN or SSN — exactly 9 digits'), addr = f('Street address'), city = f('City, State ZIP');
  tin.setAttribute('inputmode', 'numeric'); tin.setAttribute('maxlength', '11');
  const tinHint = h('div', { class: 'cp-sub', style: 'margin-top:3px;font-weight:700' });
  tin.addEventListener('input', () => {
    let d = tin.value.replace(/\D/g, '').slice(0, 9);
    tin.value = d.length > 2 ? d.slice(0, 2) + '-' + d.slice(2) : d;
    if (!d.length) { tinHint.textContent = ''; return; }
    if (d.length < 9) { tinHint.textContent = '✕ ' + d.length + '/9 digits — EIN and SSN are both exactly 9 digits'; tinHint.style.color = '#dc2626'; }
    else { tinHint.textContent = '✓ 9 digits — looks like a valid EIN/SSN format'; tinHint.style.color = '#16a34a'; }
  });
  try { attachAddressSuggest(addr, { onPick: (r) => { addr.value = r.street; if (r.tail) city.value = r.tail; } }); } catch (_) {}
  const addrHint = h('div', { class: 'cp-sub', style: 'margin-top:3px' }, '🇺🇸 US address only — start typing and pick a suggestion; City must end like “Dallas, TX 75201”.');
  const sig = f('Type your full legal name — this is your signature');
  const err = h('div', { class: 'cp-err' });
  const close = openModal('Fill & sign W-9 — online', [
    h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'Same IRS Form W-9 flow as the rest of LoadBoot — fill it once, sign by typing your name, and download the executed PDF any time.'),
    h('label', { class: 'cp-lbl' }, 'Legal name'), name,
    h('label', { class: 'cp-lbl' }, 'Business name'), biz,
    h('label', { class: 'cp-lbl' }, 'Federal tax classification'), cls,
    h('label', { class: 'cp-lbl' }, 'TIN (EIN / SSN)'), tin, tinHint,
    h('label', { class: 'cp-lbl' }, 'Address'), addr, city, addrHint,
    h('label', { class: 'cp-lbl' }, 'Signature'), sig, err,
    h('button', { class: 'cp-btn', style: 'margin-top:12px;width:100%', onClick: async (ev) => {
      const digits = tin.value.replace(/\D/g, '');
      if (!name.value.trim()) { err.textContent = 'Legal name is required.'; return; }
      if (digits.length !== 9) { err.textContent = 'Wrong TIN — EIN and SSN are both EXACTLY 9 digits (you entered ' + digits.length + ').'; return; }
      if (!addr.value.trim()) { err.textContent = 'Street address is required — pick a US suggestion.'; return; }
      if (!/^.+,\s*[A-Za-z]{2}\s*\d{5}(-\d{4})?$/.test(city.value.trim())) { err.textContent = 'US address required — City, ST ZIP (e.g. “Dallas, TX 75201”). Non-US addresses are not accepted on a W-9.'; return; }
      if (!sig.value.trim()) { err.textContent = 'Type your name to sign.'; return; }
      ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Signing…';
      const data = { name: name.value.trim(), business: biz.value.trim(), classification: cls.value,
        tin_last4: digits.slice(-4), address: addr.value.trim(), city: city.value.trim(),
        signer: sig.value.trim(), signed_date: new Date().toISOString().slice(0, 10) };
      try {
        await onboardingSubmitItem('w9', 'W-9 signed online · ' + data.signer + ' · TIN **-***' + data.tin_last4, JSON.stringify(data));
        close(); if (onDone) onDone(data);
        const c2 = openModal('W-9 signed ✓', [
          h('div', { class: 'cp-sub', style: 'margin-bottom:10px' }, 'Submitted for review. Download your executed copy — it also stays on the W-9 row (⬇ Signed W-9).'),
          h('button', { class: 'cp-btn', style: 'width:100%', onClick: () => printExecutedW9(Object.assign({ tin: digits }, data)) }, '⬇ Download executed W-9'),
          h('button', { class: 'cp-btn ghost', style: 'width:100%;margin-top:8px', onClick: () => c2() }, 'Done'),
        ]);
      } catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Sign & submit'; err.textContent = (e && e.message) || 'Failed'; }
    } }, 'Sign & submit')]);
}
function packetExtraBtn(it) {
  // executed-copy downloads for online-signed items
  let data = null; try { data = it.note && it.note.trim().startsWith('{') ? JSON.parse(it.note) : null; } catch (_) {}
  if (!data) return null;
  if (it.key === 'w9') return h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => printExecutedW9(Object.assign({ approved: it.status === 'verified' }, data)) }, '⬇ Signed W-9');
  if (it.key === 'broker_agreement' && data.body) return h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => printExecutedAgreementDoc(data) }, '⬇ Executed copy');
  return null;
}
function printExecutedAgreementDoc(d) {
  const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to download.'); return; }
  const esc = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ref = 'LB-BA-' + (d.signed_date || '').replace(/-/g, '') + '-' + (d.signer || 'X').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  // split numbered clauses into styled blocks
  const raw = String(d.body || '');
  const parts = raw.split(/\n(?=\d{1,2}\. )/);
  const intro = esc(parts.shift() || '').replace(/\n/g, '<br>');
  const clauses = parts.map((c) => {
    const m = /^(\d{1,2})\. ([A-Z &\/\u2013-]+)\.\s*([\s\S]*)$/.exec(c.trim());
    if (!m) return '<div class="cl"><div class="cl-b">' + esc(c).replace(/\n/g, '<br>') + '</div></div>';
    return '<div class="cl"><div class="cl-h"><span class="cl-n">' + m[1] + '</span>' + esc(m[2]) + '</div><div class="cl-b">' + esc(m[3]).replace(/\n/g, '<br>') + '</div></div>';
  }).join('');
  const logo = '<svg width="30" height="32" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#10223B"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#FC5305"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#10223B"/></svg>';
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(d.title) + ' — Executed</title><style>'
    + '*{box-sizing:border-box}body{font-family:Inter,system-ui,Arial,sans-serif;color:#0f1e36;margin:0 auto;max-width:860px;padding:34px 38px}'
    + '.lh{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #FC5305;padding-bottom:14px}'
    + '.lh .wd{font-weight:800;font-size:1.15rem;letter-spacing:-.02em}.lh .wd span{color:#FC5305}'
    + '.meta{text-align:right;font-size:.7rem;color:#51617a;line-height:1.7}'
    + 'h1{text-align:center;font-size:1.28rem;margin:22px 0 2px}.ref{text-align:center;font-size:.72rem;color:#51617a;letter-spacing:.14em;text-transform:uppercase;margin-bottom:16px}'
    + '.intro{font-size:.85rem;line-height:1.65;background:#f6f8fb;border:1px solid #e6ecf4;border-radius:10px;padding:14px 16px;margin-bottom:14px}'
    + '.cl{margin:0 0 12px;page-break-inside:avoid}.cl-h{font-weight:800;font-size:.85rem;letter-spacing:.02em;margin-bottom:3px}'
    + '.cl-n{display:inline-flex;width:22px;height:22px;border-radius:50%;background:#10223B;color:#fff;font-size:.7rem;align-items:center;justify-content:center;margin-right:8px}'
    + '.cl-b{font-size:.82rem;line-height:1.6;color:#2b3b52;margin-left:30px}'
    + '.sigrow{display:flex;justify-content:space-between;gap:40px;margin-top:34px;page-break-inside:avoid}' + '.sig{flex:1}.sig .lab{font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}' + '.sig .line{border-bottom:1.5px solid #0f1e36;min-height:32px;font-family:cursive;font-size:1.35rem;color:#0b1b33;padding:2px 0;display:flex;align-items:flex-end}' + '.sig .sub{font-size:.64rem;color:#94a3b8;margin-top:3px}'
    + '.stamp{margin-top:26px;display:flex;justify-content:space-between;align-items:center;background:#e7f9ee;border:1.5px solid #16a34a;border-radius:10px;padding:10px 14px}'
    + '.stamp b{color:#12a150;font-size:.8rem;letter-spacing:.08em}.stamp span{font-size:.68rem;color:#51617a}'
    + '@media print{body{padding:18px 22px}}'
    + '</style></head><body>'
    + '<div class="lh"><div style="display:flex;align-items:center;gap:10px">' + logo + '<div class="wd">Load<span>Boot</span></div></div>'
    + '<div class="meta">LoadBoot — The Operating System for Trucking<br>hello@loadboot.com · loadboot.com<br>Ref ' + esc(ref) + '</div></div>'
    + '<h1>' + esc(d.title) + '</h1><div class="ref">Version ' + esc(d.version) + ' · EXECUTED ELECTRONICALLY</div>'
    + '<div class="intro">' + intro + '</div>'
    + clauses
    + '<div class="sigrow">' + '<div class="sig"><div class="lab">Broker (signed electronically)</div><div class="line">' + esc(d.signer) + '</div><div class="sub">' + esc(d.company || '') + (d.company ? ' · ' : '') + 'Signed ' + esc(d.signed_date) + '</div></div>' + '<div class="sig"><div class="lab">LoadBoot (pre-signed)</div><div class="line" style="color:#0e7490">LoadBoot</div><div class="sub">Authorized Signatory, LoadBoot · ' + new Date().toLocaleDateString() + '</div></div>' + '</div>'
    + '<div class="stamp"><b>✓ EXECUTED — SERVER TIMESTAMPED</b><span>This electronic signature was recorded by the LoadBoot platform with an audit entry. Neither party can alter this record.</span></div>'
    + '<scr' + 'ipt>window.print();</scr' + 'ipt></body></html>');
  w.document.close();
}
function openBrokerAgreementSign(it, onDone) {
  const host = h('div', { class: 'cp-sub' }, 'Loading agreement…');
  const sig = h('input', { class: 'cp-in', placeholder: 'Type your full legal name — this is your signature' });
  const err = h('div', { class: 'cp-err' });
  const btn = h('button', { class: 'cp-btn', style: 'margin-top:12px;width:100%', disabled: 'disabled' }, 'Loading…');
  const close = openModal('Sign — Broker Agreement', [host, h('label', { class: 'cp-lbl', style: 'margin-top:10px' }, 'Signature'), sig, err, btn]);
  (async () => {
    let ag; try { ag = await currentAgreement('broker_carrier'); } catch (e) { host.textContent = (e && e.message) || 'Could not load.'; return; }
    if (!ag || !ag.available) { host.textContent = (ag && ag.note) || 'Agreement pending legal review — try later.'; return; }
    mount(host, h('div', null, [
      h('div', { style: 'font-weight:800' }, ag.title + ' (v' + ag.version + ')'),
      (() => {
        const raw = String(ag.body_md || ag.body || ag.text || '');
        const parts = raw.split(/\n(?=\d{1,2}\. )/);
        const intro = parts.shift() || '';
        return h('div', { style: 'max-height:280px;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-top:8px' }, [
          h('div', { style: 'font-size:.83rem;line-height:1.6;color:#334155;background:#f6f8fb;border-radius:8px;padding:10px 12px;margin-bottom:10px' }, intro.trim()),
          ...parts.map((c) => {
            const m = /^(\d{1,2})\. ([A-Z &\/\u2013-]+)\.\s*([\s\S]*)$/.exec(c.trim());
            if (!m) return h('div', { style: 'font-size:.82rem;line-height:1.6;color:#334155;margin-bottom:8px' }, c.trim());
            return h('div', { style: 'margin-bottom:10px' }, [
              h('div', { style: 'font-weight:800;font-size:.84rem;color:#10223B' }, m[1] + '. ' + m[2].charAt(0) + m[2].slice(1).toLowerCase()),
              h('div', { style: 'font-size:.82rem;line-height:1.6;color:#334155;margin-top:2px' }, m[3].trim()),
            ]);
          }),
        ]);
      })(),
      h('div', { class: 'cp-sub', style: 'margin-top:6px' }, 'Read it, then sign below — recorded with a server timestamp and audit entry, exactly like the carrier dispatch agreement.'),
    ]));
    btn.disabled = false; btn.textContent = '✍ Sign agreement';
    btn.onclick = async () => {
      if (!sig.value.trim()) { err.textContent = 'Type your name to sign.'; return; }
      btn.disabled = true; btn.textContent = 'Signing…';
      const data = { title: ag.title, version: ag.version, body: ag.body_md || ag.body || ag.text || '', signer: sig.value.trim(), signed_date: new Date().toISOString().slice(0, 10) };
      try {
        await acceptAgreement('broker_carrier');
        await onboardingSubmitItem('broker_agreement', 'Signed online by ' + data.signer + ' on ' + data.signed_date, JSON.stringify(data));
        close(); if (onDone) onDone(data);
        const c4 = openModal('Agreement signed ✓', [
          h('div', { class: 'cp-sub', style: 'margin-bottom:10px' }, 'Recorded and submitted for review. Download your executed copy — it also stays on this row (⬇ Executed copy).'),
          h('button', { class: 'cp-btn', style: 'width:100%', onClick: () => printExecutedAgreementDoc(data) }, '⬇ Download executed agreement'),
          h('button', { class: 'cp-btn ghost', style: 'width:100%;margin-top:8px', onClick: () => c4() }, 'Done'),
        ]);
      } catch (e) { btn.disabled = false; btn.textContent = '✍ Sign agreement'; err.textContent = (e && e.message) || 'Failed'; }
    };
  })();
}
let lbPartnerToast = null;
function packetDocRow(it, onAction) {
  const st = String(it.status || 'pending');
  const V = {
    verified:  { di: '✓', dibg: '#e7f9ee', dic: '#12a150', pill: ['Approved', '#e7f9ee', '#12a150'], rs: 'Verified by LoadBoot ✓' },
    waived:    { di: '–', dibg: '#f1f5f9', dic: '#64748b', pill: ['Waived', '#f1f5f9', '#64748b'], rs: it.note ? 'Waived — ' + it.note : 'Waived by LoadBoot' },
    submitted: { di: '⏳', dibg: '#eff6ff', dic: '#1d4ed8', pill: ['In review', '#dbeafe', '#1d4ed8'], rs: 'Submitted · LoadBoot team reviewing' },
    rejected:  { di: '!', dibg: '#fee2e2', dic: '#b91c1c', pill: ['Action', '#fee2e2', '#b91c1c'], rs: (it.note ? '✕ ' + it.note + ' — ' : '') + 'fix and resubmit' },
    pending:   { di: '!', dibg: '#fee2e2', dic: '#b91c1c', pill: ['Required', '#fef3c7', '#b45309'], rs: 'Required — not on file yet' },
  }[st] || { di: '!', dibg: '#fee2e2', dic: '#b91c1c', pill: [st, '#f1f5f9', '#64748b'], rs: '' };
  if (st === 'pending' && String(it.tag || '').toLowerCase() === 'optional') { V.di = '–'; V.dibg = '#f1f5f9'; V.dic = '#64748b'; V.pill = ['Optional', '#f1f5f9', '#64748b']; V.rs = 'Recommended'; }
  return h('div', { style: 'display:flex;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid #eef2f7;flex-wrap:wrap' }, [
    h('div', { style: 'width:40px;height:40px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;background:' + V.dibg + ';color:' + V.dic }, V.di),
    h('div', { style: 'flex:1;min-width:200px' }, [h('div', { style: 'font-weight:800;font-size:.93rem' }, it.label), h('div', { class: 'cp-sub' }, V.rs)]),
    h('div', { style: 'display:flex;gap:8px;align-items:center;flex:none;flex-wrap:wrap' }, [
      h('span', { class: 'cp-pill', style: 'background:' + V.pill[1] + ';color:' + V.pill[2] + ';font-weight:800' }, V.pill[0]),
      packetExtraBtn(it),
      h('button', { class: 'cp-btn cp-btn-sm' + (st === 'pending' || st === 'rejected' ? '' : ' ghost'), onClick: onAction },
        st === 'rejected' ? 'Fix & resubmit'
        : (it.key === 'w9' && !packetExtraBtn(it)) ? '✍ Sign W-9 online'
        : (it.key === 'broker_agreement' && !packetExtraBtn(it)) ? '✍ Sign agreement'
        : packetBtnLabel(st)),
    ].filter(Boolean)),
  ]);
}
function brokerOnboardingWizard() {
  const card = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('dock', 18), h('h3', null, (window.__lbKindLabel || 'Broker') + ' onboarding — step by step')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
  (async () => {
    let pk = { items: [] }; try { pk = await myOnboardingPacket() || { items: [] }; } catch (_) {}
    let prof = {}; try { prof = await partnerGetProfile() || {}; } catch (_) {}
    const items = pk.items || [];
    const byTag = (t) => items.filter((it) => String(it.tag || '').toLowerCase() === t);
    const legal = byTag('legal');
    const docs = items.filter((it) => ['required', 'conditional'].indexOf(String(it.tag || '').toLowerCase()) >= 0);
    const STEPS = ['Company', 'Authority & legal', 'Documents', 'Review & submit'];
    let step = 0;
    // resume where work is left: company done? -> legal pending? -> docs pending? -> review
    const done = (it) => ['submitted', 'verified'].indexOf(String(it.status || '')) >= 0;
    if (prof.company && prof.phone) { step = legal.every(done) ? (docs.every(done) ? 3 : 2) : 1; }
    const body = h('div');
    const chrome = h('div');
    const drawChrome = () => {
      const pct = Math.round(((step + 1) / STEPS.length) * 100);
      const back = step > 0 ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { step -= 1; draw(); } }, '← Back') : null;
      const next = (step > 0 && step < STEPS.length - 1) ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => { step += 1; draw(); } }, 'Continue →') : null;
      mount(chrome, h('div', null, [
        h('div', { class: 'cp-wiz-head' }, [h('h3', null, 'Step ' + (step + 1) + ' of ' + STEPS.length + ' — ' + STEPS[step]), h('span', { class: 'cp-row-s' }, pct + '%')]),
        h('div', { class: 'cp-wiz-bar' }, h('div', { class: 'cp-wiz-fill', style: 'width:' + pct + '%' })),
        h('div', { class: 'cp-wiz-body' }, body),
        h('div', { class: 'cp-wiz-actions' }, [back, next].filter(Boolean)),
      ]));
    };
    const itemRow = (it) => packetDocRow(it, () => { const fin = (d) => { it.status = 'submitted'; if (d) { it.note = JSON.stringify(d); it.ref = (it.key === 'w9' ? 'W-9' : 'Agreement') + ' signed online · ' + d.signer; } draw(); }; if (it.key === 'w9') openBrokerW9(it, fin); else if (it.key === 'broker_agreement') openBrokerAgreementSign(it, fin); else openPacketSubmit(it, () => fin(null)); });
    function draw() {
      drawChrome();
      const kids = [];
      if (step === 0) {
        const co = h('input', { class: 'cp-in', placeholder: 'Legal company name', value: prof.company || '' });
        const mc = h('input', { class: 'cp-in', placeholder: 'MC number', value: prof.mc || '' });
        const ph = h('input', { class: 'cp-in', placeholder: 'Phone', value: prof.phone || '' });
        const cn = h('input', { class: 'cp-in', placeholder: 'Contact name', value: prof.contact_name || '' });
        const msg0 = h('div', { class: 'cp-err' });
        kids.push(h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'Who are we working with? This appears on rate confirmations and invoices.'));
        kids.push(h('div', { class: 'cp-sub', style: 'font-weight:700' }, 'Company *'), co, h('div', { class: 'cp-sub', style: 'font-weight:700;margin-top:8px' }, 'MC number (optional here — verified with your authority letter in Documents)'), mc, h('div', { class: 'cp-sub', style: 'font-weight:700;margin-top:8px' }, 'Contact name *'), cn, h('div', { class: 'cp-sub', style: 'font-weight:700;margin-top:8px' }, 'Phone *'), ph, msg0);
        kids.push(h('button', { class: 'cp-btn', style: 'margin-top:12px', onClick: async (ev) => {
          if (!co.value.trim() || !ph.value.trim() || !cn.value.trim()) { msg0.textContent = 'Company, contact name and phone are required.'; return; }

          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Saving…';
          try { await partnerUpdateProfile({ company: co.value.trim(), mc: mc.value.trim() || null, phone: ph.value.trim(), contact_name: cn.value.trim() }); prof = Object.assign(prof, { company: co.value.trim(), mc: mc.value.trim(), phone: ph.value.trim(), contact_name: cn.value.trim() }); step = 1; draw(); }
          catch (e) { msg0.textContent = (e && e.message) || 'Could not save.'; ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Save & continue →'; }
        } }, 'Save & continue →'));
      } else if (step === 1) {
        kids.push(h('div', { class: 'cp-sub', style: 'margin-bottom:6px' }, 'Your legal standing — FMCSA broker authority and the $75,000 bond protect every carrier who hauls for you.'));
        legal.forEach((it) => kids.push(itemRow(it)));

      } else if (step === 2) {
        kids.push(h('div', { class: 'cp-sub', style: 'margin-bottom:6px' }, 'Paperwork — PDF or clear photo. Every document is reviewed by the LoadBoot team; you are notified the moment each one is verified or needs a fix.'));
        docs.forEach((it) => kids.push(itemRow(it)));

      } else {
        const nDone = items.filter(done).length; const nRej = items.filter((it) => it.status === 'rejected').length;
        kids.push(h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'Everything in one glance — submit whatever is missing, then our team reviews (usually within 1 business day).'));
        items.forEach((it) => kids.push(itemRow(it)));
        const reqd = items.filter((x) => String(x.tag || '').toLowerCase() !== 'optional');
        const missing = reqd.filter((x) => x.status === 'pending' || x.status === 'rejected');
        kids.push(h('div', { style: 'margin-top:12px;background:' + (pk.complete ? '#e7f9ee' : nRej ? '#fee2e2' : '#eff6ff') + ';border-radius:12px;padding:12px 14px;font-size:.85rem;color:#334155' },
          pk.complete ? '🎉 Packet complete — posting is unlocked. Anything you update goes back through review.'
          : nRej ? '⚠ ' + nRej + ' item(s) were rejected — open each one above, fix it and resubmit.'
          : nDone + ' of ' + items.length + ' submitted. Once ALL are verified, load posting unlocks automatically and you are notified.'));
        kids.push(missing.length
          ? h('button', { class: 'cp-btn', style: 'margin-top:12px;width:100%;opacity:.85', onClick: () => {
              alert('Still missing before you can submit:\n\n' + missing.map((x) => '• ' + x.label + (x.status === 'rejected' ? ' (rejected — fix it)' : '')).join('\n'));
            } }, '⛔ ' + missing.length + ' required item(s) left — complete them above')
          : h('div', { style: 'margin-top:12px' }, [
              h('div', { style: 'background:#eff6ff;border:1.5px solid #93c5fd;border-radius:12px;padding:12px 14px;text-align:center;font-weight:800;color:#1d4ed8;font-size:.95rem' },
                pk.complete ? '🎉 ALL VERIFIED — POSTING IS LIVE' : '⏳ SUBMITTED — UNDER REVIEW'),
              h('div', { class: 'cp-sub', style: 'text-align:center;margin-top:4px' },
                pk.complete ? 'Anything you update goes back through review.' : 'LoadBoot team reviews within 1 business day — you\u2019ll be notified of every decision here and by email.'),
              h('button', { class: 'cp-btn ghost', style: 'margin-top:8px;width:100%', onClick: () => bgo('dashboard') }, 'Track on dashboard →'),
            ]));
      }
      mount(body, h('div', null, kids));
    }
    mount(card, [h('div', { class: 'cp-cardhead' }, [icon('dock', 18), h('h3', null, 'Broker onboarding' + (pk.complete ? ' — complete ✓' : ''))]), chrome]);
    draw();
  })();
  return card;
}
function packetAgreementCards(skipPacket) {
    const wrap = h('div', null);
    const pc = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Industry onboarding packet')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
    (async () => {
      let pk; try { pk = await myOnboardingPacket(); } catch (_) { pc.remove(); return; }
      mount(pc, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Industry onboarding packet' + (pk.complete ? ' — complete ✓' : ''))]),
        ...(pk.items || []).map(it => packetDocRow(it, () => {
          const done = (d) => { if (d) it.note = JSON.stringify(d); pc.querySelector('h3').textContent = 'Industry onboarding packet — submitted, refresh to update'; };
          if (it.key === 'w9') openBrokerW9(it, done); else if (it.key === 'broker_agreement') openBrokerAgreementSign(it, done); else openPacketSubmit(it, done);
        }))]);
    })();
    const ac = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Master agreement')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
    (async () => {
      let ag; try { ag = await currentAgreement('broker_carrier'); } catch (_) { ac.remove(); return; }
      if (!ag.available) { mount(ac, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, 'Master agreement')]), h('div', { class: 'cp-sub' }, ag.note || 'Pending legal review.')]); return; }
      mount(ac, [h('div', { class: 'cp-cardhead' }, [icon('docs', 18), h('h3', null, ag.title + ' (v' + ag.version + ')')]),
        h('pre', { style: 'white-space:pre-wrap;font-size:.82rem;max-height:220px;overflow:auto;background:#f8fafc;padding:10px;border-radius:10px' }, ag.body_md || ''),
        ag.accepted ? h('span', { class: 'cp-pill green' }, 'Accepted ✓') : h('button', { class: 'cp-btn', style: 'margin-top:8px', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            const signer = prompt('Type your full legal name to SIGN this agreement:'); if (!signer || !signer.trim()) { ev.currentTarget.disabled = false; return; }
            await acceptAgreement('broker_carrier');
            const data = { title: ag.title, version: ag.version, body: ag.body_md || ag.body || ag.text || '', signer: signer.trim(), signed_date: new Date().toISOString().slice(0, 10) };
            try { await onboardingSubmitItem('broker_agreement', 'Signed online by ' + data.signer + ' on ' + data.signed_date, JSON.stringify(data)); } catch (_) {}
            ev.currentTarget.textContent = 'Accepted ✓';
            const c3 = openModal('Agreement signed ✓', [
              h('div', { class: 'cp-sub', style: 'margin-bottom:10px' }, 'Recorded with a server timestamp. Download your executed copy — it also stays on the Signed Broker Agreement row (⬇ Executed copy).'),
              h('button', { class: 'cp-btn', style: 'width:100%', onClick: () => printExecutedAgreementDoc(data) }, '⬇ Download executed agreement'),
              h('button', { class: 'cp-btn ghost', style: 'width:100%;margin-top:8px', onClick: () => c3() }, 'Done'),
            ]);
          } catch (e) { ev.currentTarget.disabled = false; alert((e && e.message) || 'Failed'); }
        } }, 'Accept agreement (recorded once)')]);
    })();
    if (!skipPacket) wrap.appendChild(pc); wrap.appendChild(ac);
    return wrap;
  }
  // ---- carrier-style organized shell: side menu + pages, broker-flavoured ----
  const BNAV = [
    ['dashboard', 'Dashboard', 'dash'],
    ['loads', 'My Loads', 'loads'],
    ['claims', 'Claims', 'finance'],
    ['requests', 'Requests', 'clock'],
    ['carriers', 'Carriers', 'loads'],
    ['rates', 'Market Rates', 'finance'],
    ['network', 'Network', 'user'],
    ['onboarding', 'Documents', 'dock'],
    ['invoices', 'Invoices', 'finance'],
    ['account', 'Account', 'user'],
  ];
  const myLoadsCard = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('loads', 18), h('h3', null, 'My loads')]), listHost]);
  const obHero = h('div');
  (async () => {
    let pk = null; try { pk = await myOnboardingPacket(); } catch (_) { return; }
    const items = (pk && pk.items) || [];
    const rej = items.filter((it) => it.status === 'rejected');
    const sub = items.filter((it) => it.status === 'submitted');
    const mk = (border, iconTxt, iconBg, iconCol, titleTxt, titleCol, subTxt, btnTxt) => h('div', { class: 'cp-card', style: 'display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-left:4px solid ' + border + ';margin-bottom:12px' }, [
      h('div', { style: 'width:54px;height:54px;border-radius:50%;flex:none;background:' + iconBg + ';color:' + iconCol + ';display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px' }, iconTxt),
      h('div', { style: 'flex:1;min-width:220px' }, [h('div', { style: 'font-weight:800;font-size:1.02rem;color:' + titleCol }, titleTxt), h('div', { class: 'cp-sub' }, subTxt)]),
      h('button', { class: 'cp-btn cp-btn-sm', onClick: () => bgo('onboarding') }, btnTxt),
    ]);
    if (rej.length) mount(obHero, h('div', { class: 'cp-card', style: 'border-left:4px solid #dc2626;margin-bottom:12px' }, [
      h('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' }, [
        h('div', { style: 'width:46px;height:46px;border-radius:50%;flex:none;background:#fee2e2;color:#b91c1c;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px' }, '!'),
        h('div', { style: 'flex:1;min-width:200px;font-weight:800;font-size:1.02rem;color:#b91c1c' }, rej.length + ' onboarding item(s) rejected — fix now'),
        h('button', { class: 'cp-btn cp-btn-sm', onClick: () => bgo('onboarding') }, 'Fix now →'),
      ]),
      ...rej.map((it) => h('div', { style: 'margin-top:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 12px' }, [
        h('div', { style: 'font-weight:800;font-size:.9rem;color:#b91c1c' }, '✕ ' + it.label),
        it.note ? h('div', { class: 'cp-sub', style: 'margin-top:3px' }, [h('b', null, 'Reason: '), it.note]) : null,
        h('div', { class: 'cp-sub', style: 'margin-top:3px' }, [h('b', null, 'Effect: '), 'packet incomplete — account is PENDING and load posting is stopped until this is verified again.']),
        h('div', { class: 'cp-sub', style: 'margin-top:3px' }, [h('b', null, 'Solution: '), 'open Documents → this item → Fix & resubmit with the corrected document (official PDF where required). Review within 1 business day.']),
      ].filter(Boolean))),
    ]));
    else if (pk.complete) mount(obHero, mk('#16a34a', '🎉', '#e7f9ee', '#12a150', 'Approved — load posting is unlocked', '#12a150', 'Your packet is fully verified. Post loads, offer them to carriers, and track everything with GPS proof.', 'View packet'));
    else if (sub.length) mount(obHero, mk('#0883F7', '⏳', '#eff6ff', '#1d4ed8', 'Onboarding under review', '#1d4ed8', sub.length + ' item(s) with our team — you\u2019ll be notified as each is verified (usually within 1 business day).', 'Track status →'));
    else mount(obHero, mk('#d97706', '📋', '#fef3c7', '#b45309', 'Finish onboarding to start posting', '#b45309', 'A few required items are still missing — the guided steps take about 10 minutes.', 'Start →'));
  })();
  // ---- 💰 Payables: every dollar this broker owes right now (freight + approved claims),
  //      each with the same procedure: bank details → pay → receipt → carrier ✓ Received ----
  function payablesCard() {
    const host9 = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '💰 Payables — money you owe carriers')]), h('div', { class: 'cp-sub' }, 'Loading…')]);
    (async () => {
      let d9; try { d9 = await payDueItems(); } catch (e9) { mount(host9, [h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '💰 Payables — money you owe carriers')]), h('div', { class: 'cp-sub' }, (e9 && e9.message) || 'Could not load.')]); return; }
      const items9 = (d9 && Array.isArray(d9.payables)) ? d9.payables : [];
      const openIt = items9.filter((x9) => x9.transfer_status !== 'received');
      const doneIt = items9.filter((x9) => x9.transfer_status === 'received').slice(0, 5);
      const totalDue = openIt.filter((x9) => !x9.transfer_status).reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
      const row9 = (x9) => {
        const age9 = x9.due_since ? Math.max(0, Math.round((Date.now() - new Date(x9.due_since).getTime()) / 86400000)) : null;
        return h('div', { style: 'padding:10px 0;border-bottom:1px solid #eef2f7' }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
            h('div', null, [
              h('div', { class: 'cp-row-t' }, (x9.label || x9.kind) + ' · ' + money(x9.amount)),
              h('div', { class: 'cp-row-s' }, 'to ' + (x9.counterparty || 'carrier') + (x9.due_since ? ' · due since ' + new Date(x9.due_since).toLocaleDateString() + (age9 != null ? ' (' + age9 + 'd)' : '') : '') + ' · memo: ' + (x9.memo || '')),
              (x9.pay_by && !x9.transfer_status) ? (() => {
                const left9 = Math.ceil((new Date(x9.pay_by).getTime() - Date.now()) / 86400000);
                const c9 = left9 < 0 ? ['#fee2e2', '#b91c1c', '⚠ OVERDUE — was due '] : left9 <= 5 ? ['#fef3c7', '#b45309', '⏳ PAY BY '] : ['#eff6ff', '#1d4ed8', '📅 PAY BY '];
                return h('div', { style: 'display:inline-block;margin-top:4px;padding:3px 12px;border-radius:999px;font-size:.72rem;font-weight:800;background:' + c9[0] + ';color:' + c9[1] },
                  c9[2] + new Date(x9.pay_by).toLocaleDateString() + (left9 >= 0 ? ' · ' + left9 + 'd left' : ' · ' + (-left9) + 'd ago'));
              })() : null,
            ].filter(Boolean)),
            x9.transfer_status === 'received' ? h('span', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150' }, '✓ Paid & confirmed')
            : x9.transfer_status === 'sent' ? h('span', { class: 'cp-pill', style: 'background:#fef3c7;color:#b45309' }, '💸 On the way · awaiting carrier ✓')
            : h('span', { class: 'cp-pill', style: 'background:#fee2e2;color:#b91c1c' }, '⏰ DUE'),
          ]),
          x9.transfer_status ? null : payRailBlock(x9.kind, x9.ref_id, x9.memo || '', x9.kind === 'claim' ? 'Pay this claim' : 'Pay freight'),
        ].filter(Boolean));
      };
      // GROUP PER TRIP: one block per load — freight + every claim/accessorial of THAT trip together
      // with the trip's own subtotal; other trips never mix in. (platform_fee rows have no lane → own group)
      const groups9 = {};
      [...openIt, ...doneIt].forEach((x9) => {
        const k9 = x9.trip_id || ('misc:' + x9.ref_id);
        (groups9[k9] = groups9[k9] || { lane: x9.lane, carrier: x9.counterparty, items: [] }).items.push(x9);
      });
      const gArr9 = Object.values(groups9);
      const gBlock9 = (g9) => {
        const open9 = g9.items.filter((x9) => x9.transfer_status !== 'received');
        const sub9 = g9.items.reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
        const due9 = open9.filter((x9) => !x9.transfer_status).reduce((a9, x9) => a9 + (Number(x9.amount) || 0), 0);
        const allPaid9 = open9.length === 0;
        return h('div', { style: 'border:1.5px solid ' + (allPaid9 ? '#bbf7d0' : due9 > 0 ? '#fecaca' : '#fde68a') + ';border-radius:14px;padding:12px 14px;margin-bottom:12px;background:' + (allPaid9 ? '#f0fdf4' : '#fff') }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:4px' }, [
            h('div', null, [
              h('div', { style: 'font-weight:900;color:#10223B' }, '🚛 ' + (g9.lane || g9.items[0].label || 'Other')),
              h('div', { class: 'cp-sub' }, (g9.carrier ? 'Carrier: ' + g9.carrier + ' · ' : '') + g9.items.length + ' item' + (g9.items.length > 1 ? 's' : '') + ' — freight + claims of THIS trip only'),
            ]),
            h('div', { style: 'text-align:right' }, [
              h('div', { style: 'font-weight:900;font-size:1.05rem;color:#10223B' }, 'Trip total ' + money(sub9)),
              allPaid9 ? h('span', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150' }, '✓ Trip fully settled')
                : due9 > 0 ? h('span', { class: 'cp-pill', style: 'background:#fee2e2;color:#b91c1c' }, money(due9) + ' still DUE')
                : h('span', { class: 'cp-pill', style: 'background:#fef3c7;color:#b45309' }, '💸 payments on the way'),
            ]),
          ]),
          (due9 > 0 && g9.items[0] && g9.items[0].trip_id) ? (() => {
            const w9 = h('div', { style: 'margin:4px 0 8px' });
            const refIn9 = h('input', { class: 'cp-in', placeholder: 'Bank transfer reference / confirmation #', style: 'margin-top:8px' });
            const fIn9 = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp', style: 'font-size:.85rem;margin-top:6px' });
            const m9 = h('div', { class: 'cp-sub', style: 'margin-top:4px' });
            const remitHost9 = h('div', null, h('div', { class: 'cp-sub' }, 'Loading payee details…'));
            (async () => {
              try {
                const it9 = g9.items.find((z9) => z9.kind === 'freight') || g9.items[0];
                const pi9 = await payInstructions(it9.kind, it9.ref_id);
                const bk9 = (pi9 && pi9.payee_bank) || {};
                const rr9 = (k9, v9) => v9 ? h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #e2e8f0;font-size:.85rem' }, [h('span', { style: 'color:#64748b' }, k9), h('b', { style: 'user-select:all' }, String(v9))]) : null;
                mount(remitHost9, h('div', null, [
                  pi9.noa_warning ? h('div', { style: 'background:#fee2e2;color:#b91c1c;border-radius:8px;padding:8px 10px;font-size:.83rem;font-weight:700;margin:6px 0' }, '\u26a0 ' + pi9.noa_warning) : null,
                  bk9.pay_to ? h('div', { style: 'background:#4c1d95;color:#fff;border-radius:9px;padding:8px 12px;font-weight:900;font-size:.85rem;margin:4px 0' }, '🏦 PAY THE FACTORING COMPANY — ' + (bk9.factoring_company || '') + (bk9.verified ? ' · NOA verified by LoadBoot ✓' : ' · NOA verification pending ⏳')) : null,
                  rr9('Payee', bk9.account_title), rr9('Bank', bk9.bank_name), rr9('Account #', bk9.account_number),
                  rr9('Routing (ACH)', bk9.routing_number), rr9('Remittance email', bk9.remittance_email),
                  bk9.pay_to ? null : (bk9.verified ? h('div', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150;margin-top:6px' }, '\u2713 Bank details verified by LoadBoot') : h('div', { class: 'cp-pill', style: 'background:#fef3c7;color:#b45309;margin-top:6px' }, '\u26a0 Details not yet verified — confirm with the carrier before a large transfer')),
                ].filter(Boolean)));
              } catch (_) { mount(remitHost9, h('div', { class: 'cp-sub' }, 'Could not load payee details — open any single item above to see them.')); }
            })();
            const pan9 = h('div', { style: 'display:none;margin-top:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px' }, [
              h('div', { style: 'font-weight:800' }, 'One transfer settles this whole trip — ' + money(due9)),
              h('div', { class: 'cp-sub', style: 'margin:4px 0' }, 'Send ONE payment of ' + money(due9) + ' (freight + all approved claims of this trip) to the payee below — same bank/factor for every item of this trip. Attach the single receipt; every item flips to “on the way” together and the carrier confirms each.'),
              remitHost9,
              refIn9, fIn9,
              h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: async (ev9) => { const b9 = ev9.currentTarget;
                const f9 = fIn9.files && fIn9.files[0]; if (!f9) { m9.textContent = 'Attach the payment receipt first.'; return; }
                b9.disabled = true; b9.textContent = 'Sending\u2026';
                try {
                  const up9 = await uploadDocument(f9, 'payment_receipt');
                  const r9 = await payTripMarkSent(g9.items[0].trip_id, up9.path, up9.fileName, refIn9.value.trim() || null);
                  pToast('\u2713 Whole trip marked paid — ' + (r9.items || 0) + ' items on the way; the carrier confirms each.', { kind: 'ok', title: '\ud83d\udcb0 Trip settled' });
                  loadList(); location.hash = location.hash; setTimeout(() => { try { document.location.reload(); } catch (_) {} }, 900);
                } catch (e9) { b9.disabled = false; b9.textContent = 'I paid the trip total \u2014 submit ONE receipt'; m9.textContent = (e9 && e9.message) || 'Failed.'; }
              } }, 'I paid the trip total \u2014 submit ONE receipt'),
              m9,
              h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:6px', onClick: () => { pan9.style.display = 'none'; ob9.style.display = ''; } }, '\u2715 Hide'),
            ]);
            const ob9 = h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#0883F7;color:#fff;font-weight:800', onClick: () => { ob9.style.display = 'none'; pan9.style.display = 'block'; } }, '\ud83d\udcb0 Pay trip total \u2014 ' + money(due9) + ' (one receipt, all items)');
            mount(w9, h('div', null, [ob9, pan9]));
            return w9;
          })() : null,
          ...g9.items.map(row9),
        ]);
      };
      mount(host9, [
        h('div', { class: 'cp-cardhead' }, [icon('finance', 18), h('h3', null, '💰 Payables — money you owe carriers'),
          totalDue ? h('span', { class: 'cp-pill', style: 'background:#fee2e2;color:#b91c1c;margin-left:8px' }, money(totalDue) + ' due') : h('span', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150;margin-left:8px' }, 'all settled')]),
        h('div', { class: 'cp-sub', style: 'margin-bottom:8px' }, 'Grouped per trip: each block is ONE load — its freight plus every approved claim (detention, lumper, TONU…) with the trip\u2019s own total. Pay each item, attach the receipt — the carrier (or their factor) confirms and the row turns green.'),
        gArr9.length ? h('div', null, gArr9.map(gBlock9)) : h('div', { class: 'cp-muted' }, 'Nothing owed right now — delivered loads and approved claims appear here automatically.'),
      ]);
    })();
    return host9;
  }
  const PAGES = {
    dashboard: [],
    loads: [],
    claims: [claimsCard()],
    requests: ov.kind === 'shipper' ? [bookRequestsCard()] : [bookRequestsCard(), shipmentInboxCard()],
    carriers: [brokerCarriersPage()],
    rates: [(() => { const hst = h('div'); renderMarketWidget(hst); return hst; })()],
    network: [approvedPartnersCard(), ratingCard(), referralCard()],
    onboarding: [brokerOnboardingWizard()],
    invoices: [carrierInvoicesCard(), payablesCard(), invoicesCard()],
    account: [accountCard()],
  };
  let btab = (location.hash || '').replace('#', '') || 'dashboard';
  let __openPostOnBoot = false;
  if (btab === 'post') { btab = 'dashboard'; __openPostOnBoot = true; try { history.replaceState(null, '', '#dashboard'); } catch (_) {} }
  if (!BNAV.some((n) => n[0] === btab)) btab = 'dashboard';
  const bLinks = {};
  const bNavEl = h('nav', { class: 'cp-nav' }, BNAV.map(([id, label, ic9]) => {
    const a = h('a', { class: 'cp-navlink', href: '#' + id, onClick: () => bgo(id) }, [icon(ic9, 20), h('span', null, label)]);
    (bLinks[id] = bLinks[id] || []).push(a); return a;
  }));
  // MOBILE NAV (audit 2026-07-21): .cp-side is hidden <=900px, so the broker/shipper shell
  // had no navigation on phones. Bottom tab bar mirrors the carrier pattern (5 primary tabs).
  const BTABS = ['dashboard', 'loads', 'claims', 'invoices', 'account'];
  const bTabbar = h('nav', { class: 'cp-tabbar' }, BTABS.map((id) => {
    const it = BNAV.find((n) => n[0] === id) || [id, id, 'dash'];
    const a = h('a', { class: 'cp-navlink', href: '#' + id, onClick: () => bgo(id) }, [icon(it[2], 20), h('span', null, it[1])]);
    (bLinks[id] = bLinks[id] || []).push(a); return a;
  }));
  const bTitle = h('h1', { class: 'cp-top-title' }, 'Dashboard');
  const bContent = h('div', { class: 'cp-content' });
  // ---- premium dashboard sections (rebuilt fresh on every dashboard visit) ----
  if (!document.getElementById('bd-css')) {
    const st = document.createElement('style'); st.id = 'bd-css';
    st.textContent = `
      .bd-hero{position:relative;border-radius:20px;overflow:hidden;padding:24px 26px;color:#fff;background:radial-gradient(1000px 400px at 10% -30%,rgba(8,131,247,.5),transparent 60%),radial-gradient(700px 340px at 96% 140%,rgba(252,83,5,.25),transparent 55%),linear-gradient(120deg,#0b1830 0%,#10223B 55%,#132c4e 100%);box-shadow:0 24px 60px -28px rgba(2,12,30,.55);margin-bottom:14px}
      .bd-hero h2{margin:0;font-size:1.35rem;font-weight:800}
      .bd-hero .sub{font-size:.82rem;opacity:.8;margin-top:4px}
      .bd-qa{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      .bd-qa button{border:0;border-radius:12px;padding:10px 16px;font-weight:800;font-size:.8rem;cursor:pointer;transition:transform .12s}
      .bd-qa button:hover{transform:translateY(-1px)}
      .bd-qa .p{background:linear-gradient(120deg,#0883F7,#0967d2);color:#fff;box-shadow:0 8px 18px -8px rgba(8,131,247,.6)}
      .bd-qa .g{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.22)}
      .bd-live{display:flex;gap:24px;flex-wrap:wrap;margin-top:16px}
      .bd-live .s b{display:block;font-size:1.25rem;font-weight:800;color:#7cc0ff}
      .bd-live .s span{font-size:.62rem;text-transform:uppercase;letter-spacing:.09em;opacity:.7;font-weight:700}
      .bd-attn{background:#fff;border:1px solid #e6ebf3;border-left:5px solid #f59e0b;border-radius:16px;padding:14px 16px;margin-bottom:14px;box-shadow:0 10px 30px -22px rgba(2,12,30,.3)}
      .bd-attn.ok{border-left-color:#22c55e}
      .bd-attn .hd{font-weight:800;color:#10223B;font-size:.92rem;margin-bottom:8px;display:flex;align-items:center;gap:8px}
      .bd-arow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border:1px solid #f1f5f9;border-radius:12px;margin-top:7px;flex-wrap:wrap}
      .bd-arow .t{font-size:.84rem;color:#334155;font-weight:600;display:flex;gap:9px;align-items:center}
      .bd-arow button{border:1.5px solid #e2e8f0;background:#fff;border-radius:10px;padding:7px 13px;font-weight:700;font-size:.76rem;color:#0883F7;cursor:pointer}
      .bd-arow button:hover{border-color:#0883F7}
      .bd-kgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}
      .bd-k{background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:14px 16px;box-shadow:0 10px 30px -24px rgba(2,12,30,.35);border-top:3px solid var(--bd-a,#0883F7)}
      .bd-k b{display:block;font-size:1.5rem;font-weight:800;color:#10223B;line-height:1.1}
      .bd-k .l{font-size:.78rem;font-weight:700;color:#334155;margin-top:3px}
      .bd-k .s{font-size:.68rem;color:#94a3b8;margin-top:1px}
      .bd-net{background:linear-gradient(120deg,#0d1b33,#14335c);border-radius:16px;padding:16px 18px;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .bd-net .tt{font-weight:800;font-size:.95rem}
      .bd-net .ss{font-size:.76rem;opacity:.8;margin-top:2px}
      .bd-net button{border:0;border-radius:11px;padding:9px 15px;font-weight:800;font-size:.78rem;cursor:pointer;background:#fff;color:#10223B}
      .bd-act .row{display:flex;gap:10px;align-items:flex-start;padding:9px 4px;border-bottom:1px solid #f1f5f9;cursor:pointer}
      .bd-act .row:hover{background:#f8fafc}
      .bd-act .row:last-child{border-bottom:0}
    `;
    document.head.appendChild(st);
  }
  let postFoldOpen = false;
  if (typeof __openPostOnBoot !== 'undefined' && __openPostOnBoot) { postFoldOpen = true; setTimeout(() => { try { const f = document.getElementById('bd-postload'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }, 700); }
  const postFoldBanner = () => h('div', { style: 'cursor:pointer;border-radius:18px;overflow:hidden;background:#fff;border:1px solid #e6ebf3;box-shadow:0 12px 32px -24px rgba(16,34,59,.18);margin-bottom:14px', onClick: () => { postFoldOpen = true; brender(); } }, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px;flex-wrap:wrap' }, [
      h('div', { style: 'display:flex;gap:12px;align-items:center' }, [
        h('div', { style: 'width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;background:linear-gradient(135deg,#0883F7,#0967d2);color:#fff;box-shadow:0 8px 18px -8px rgba(8,131,247,.6)' }, '\u26a1'),
        h('div', null, [
          h('div', { style: 'font-weight:800;color:#10223B;font-size:.98rem' }, 'Post a load'),
          h('div', { class: 'cp-sub' }, '5 guided steps \u2014 exact addresses, schedule, equipment, rate card, review. Real miles & transit auto-calculate.'),
        ]),
      ]),
      h('button', { class: 'cp-btn cp-btn-sm', style: 'min-width:110px' }, 'Start \u2192'),
    ]),
  ]);
  const bdHero = () => {
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const live = h('div', { class: 'bd-live' });
    const el = h('div', { class: 'bd-hero' }, [
      h('h2', null, greet + (ov.company ? ', ' + ov.company : '')),
      h('div', { class: 'sub' }, new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' \u00b7 Your freight command center \u2014 post, track, and settle every load with GPS proof.'),
      h('div', { class: 'bd-qa' }, [
        h('button', { class: 'p', onClick: () => { postFoldOpen = true; brender(); setTimeout(() => { const f = document.getElementById('bd-postload'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); } }, '\u26a1 Post a load'),
        h('button', { class: 'g', onClick: () => bgo('carriers') }, '\ud83d\ude9b Browse carriers'),
        h('button', { class: 'g', onClick: () => bgo('claims') }, '\ud83d\udcb0 Claims'),
        h('button', { class: 'g', onClick: () => bgo('onboarding') }, '\ud83d\udcc4 Documents'),
      ]),
      live,
    ]);
    (async () => {
      try {
        const rows = (await partnerMyLoads(100)) || [];
        const st9 = (x) => String(x.status || '').toLowerCase();
        const booked = rows.filter(r => /book|dispatch|transit/.test(st9(r))).length;
        const del = rows.filter(r => /deliver|complete|invoiced/.test(st9(r))).length;
        const onBoard = rows.filter(r => /post|approved|available/.test(st9(r))).length;
        mount(live, [
          h('div', { class: 's' }, [h('b', null, String(onBoard)), h('span', null, 'Live on board')]),
          h('div', { class: 's' }, [h('b', null, String(booked)), h('span', null, 'Booked / in transit')]),
          h('div', { class: 's' }, [h('b', null, String(del)), h('span', null, 'Delivered')]),
          h('div', { class: 's' }, [h('b', null, String(rows.length)), h('span', null, 'Total loads')]),
        ]);
      } catch (_) {}
    })();
    return el;
  };
  const bdAttention = () => {
    const el = h('div', { class: 'bd-attn' , style: 'display:none' });
    (async () => {
      const items = [];
      try {
        const cls = (await partnerClaims()) || [];
        const pend = cls.filter(c9 => String(c9.broker_status || 'pending') === 'pending').length;
        if (pend) items.push(['\ud83d\udcb0', pend + ' claim' + (pend === 1 ? '' : 's') + ' awaiting YOUR review \u2014 carriers are waiting on a decision', 'Review claims', () => bgo('claims')]);
      } catch (_) {}
      try {
        const pk = await myOnboardingPacket();
        const rej = ((pk && pk.items) || []).filter(it => it.status === 'rejected');
        if (rej.length) items.push(['\u26a0', rej.length + ' document' + (rej.length === 1 ? '' : 's') + ' rejected \u2014 posting stops until fixed: ' + rej.map(r => r.label).join(', '), 'Fix documents', () => bgo('onboarding')]);
      } catch (_) {}
      try {
        const rows = (await partnerMyLoads(100)) || [];
        const rej9 = rows.filter(r => String(r.status || '').toLowerCase() === 'rejected').length;
        if (rej9) items.push(['\ud83d\udeab', rej9 + ' load' + (rej9 === 1 ? '' : 's') + ' rejected by dispatch \u2014 open My Loads for the reason & fix', 'My Loads', () => bgo('loads')]);
      } catch (_) {}
      try {
        const ns = (await partnerNotifications(50)) || [];
        const un = ns.filter(n => !n.read_at).length;
        if (un > 3) items.push(['\ud83d\udd14', un + ' unread notifications', '\u2713 Mark all read', async () => { try { await partnerMarkAllNotificationsRead(); } catch (_) {} try { brender(); } catch (_) {} }]);
      } catch (_) {}
      el.style.display = '';
      if (!items.length) {
        el.classList.add('ok');
        mount(el, h('div', { class: 'hd' }, ['\u2705', ' All clear \u2014 nothing needs your attention right now.']));
        return;
      }
      mount(el, [
        h('div', { class: 'hd' }, ['\u26a0\ufe0f', ' Needs your attention (' + items.length + ')']),
        ...items.map(([ic, txt, cta, fn]) => h('div', { class: 'bd-arow' }, [
          h('div', { class: 't' }, [h('span', { style: 'font-size:1.05rem' }, ic), txt]),
          h('button', { onClick: fn }, cta + ' \u2192'),
        ])),
      ]);
    })();
    return el;
  };
  const bdKpis = () => {
    const el = h('div', { class: 'bd-kgrid' });
    const tile = (v, l, sub9, a) => h('div', { class: 'bd-k', style: '--bd-a:' + a }, [h('b', null, String(v)), h('div', { class: 'l' }, l), h('div', { class: 's' }, sub9)]);
    mount(el, [
      tile(ov.loads_submitted || 0, 'Submitted', 'all time', '#0883F7'),
      tile(ov.loads_open || 0, 'Awaiting dispatch', 'under review', '#f59e0b'),
      tile(ov.loads_posted || 0, 'Live on board', 'carriers can book', '#22c55e'),
    ]);
    (async () => {
      try {
        const rows = (await partnerMyLoads(100)) || [];
        const st9 = (x) => String(x.status || '').toLowerCase();
        const booked = rows.filter(r => /book|dispatch|transit/.test(st9(r))).length;
        const del = rows.filter(r => /deliver|complete|invoiced/.test(st9(r))).length;
        let claims = 0; try { claims = ((await partnerClaims()) || []).filter(c9 => String(c9.broker_status || 'pending') === 'pending').length; } catch (_) {}
        mount(el, [
          tile(ov.loads_submitted || 0, 'Submitted', 'all time', '#0883F7'),
          tile(ov.loads_open || 0, 'Awaiting dispatch', 'under review', '#f59e0b'),
          tile(ov.loads_posted || 0, 'Live on board', 'carriers can book', '#22c55e'),
          tile(booked, 'In transit', 'booked \u00b7 moving', '#8b5cf6'),
          tile(del, 'Delivered', 'completed loads', '#10b981'),
          tile(claims, 'Claims to review', claims ? 'action needed' : 'all settled', claims ? '#ef4444' : '#94a3b8'),
        ]);
      } catch (_) {}
    })();
    return el;
  };
  const bdNetwork = () => {
    const el = h('div', { class: 'bd-net', style: 'display:none' });
    (async () => {
      let dir; try { dir = (await partnerCarrierDirectory()) || []; } catch (_) { return; }
      if (!dir.length) return;
      const trucks = dir.reduce((a, c9) => a + ((c9.trucks || 0) || c9.power_units || 0), 0);
      const top = dir.filter(c9 => c9.stars).sort((a, b9) => b9.stars - a.stars).slice(0, 2);
      el.style.display = '';
      mount(el, [
        h('div', null, [
          h('div', { class: 'tt' }, '\ud83d\ude9b Your carrier network: ' + dir.length + ' verified carrier' + (dir.length === 1 ? '' : 's') + ' \u00b7 ' + trucks + ' trucks'),
          h('div', { class: 'ss' }, top.length ? ('Top rated: ' + top.map(t9 => t9.name + ' \u2605' + t9.stars).join(' \u00b7 ')) : 'Every carrier is FMCSA-verified, insured and under live health monitoring.'),
        ]),
        h('button', { onClick: () => bgo('carriers') }, 'Browse carriers \u2192'),
      ]);
    })();
    return el;
  };
  const bdActivity = () => {
    const body = h('div', { class: 'bd-act' }, h('div', { class: 'cp-sub' }, 'Loading\u2026'));
    const el = h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('clock', 18), h('h3', null, 'Recent activity')]), body]);
    (async () => {
      let ns; try { ns = (await partnerNotifications(6)) || []; } catch (_) { el.remove(); return; }
      if (!ns.length) { mount(body, h('div', { class: 'cp-sub' }, 'No activity yet \u2014 it starts the moment you post your first load.')); return; }
      mount(body, ns.map(n => h('div', { class: 'row', onClick: () => { if (n.url) location.hash = n.url.replace(/^.*#/, '#'); } }, [
        h('div', { style: 'font-size:1.05rem' }, n.kind === 'success' ? '\u2705' : n.kind === 'warning' ? '\u26a0\ufe0f' : '\ud83d\udce8'),
        h('div', { style: 'min-width:0' }, [
          h('div', { style: 'font-weight:700;font-size:.84rem;color:#10223B' }, n.title || 'Notification'),
          h('div', { class: 'cp-sub', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, n.body || ''),
        ]),
      ])));
    })();
    return el;
  };
  bgoHook = (id) => bgo(id);
  window.__lbOpenPost = () => { postFoldOpen = true; brender(); setTimeout(() => { const f = document.getElementById('bd-postload'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); };
  function brender() {
    if (btab === 'loads') { mount(bContent, h('div', null, [myLoadsCard])); return; }
    if (btab === 'dashboard') {
      const bdRate9 = h('div');
      (async () => {
        let rt9 = []; try { rt9 = (await partnerRateableTrips(5)) || []; } catch (_) {}
        const r9 = rt9.filter(x9 => !x9.my_stars).find(x9 => { try { return !localStorage.getItem('lb:rated:' + x9.trip_id); } catch (_) { return true; } });
        if (!r9) return;
        const card9 = h('div', { class: 'cp-card', style: 'position:relative;border:1.5px solid rgba(245,158,11,.5);background:linear-gradient(120deg,rgba(245,158,11,.06),transparent 60%)' });
        card9.appendChild(h('button', { title: 'Not now', style: 'position:absolute;top:10px;right:12px;border:0;background:transparent;color:#94a3b8;font-size:1.05rem;cursor:pointer;font-weight:800', onClick: () => { try { localStorage.setItem('lb:rated:' + r9.trip_id, 'skip'); } catch (_) {} card9.remove(); } }, '\u2715'));
        let st9 = 0; const btns9 = [];
        const paint9 = () => btns9.forEach((b9, i9) => { b9.textContent = i9 < st9 ? '\u2b50' : '\u2606'; b9.style.filter = i9 < st9 ? 'none' : 'grayscale(1)'; b9.style.transform = i9 < st9 ? 'scale(1.12)' : 'scale(1)'; });
        for (let i9 = 0; i9 < 5; i9++) btns9.push(h('button', { style: 'border:0;background:transparent;font-size:1.9rem;cursor:pointer;transition:transform .12s;padding:2px 4px', onClick: () => { st9 = i9 + 1; paint9(); } }, '\u2606'));
        const cm9 = h('input', { class: 'cp-in', placeholder: 'Optional \u2014 one line (on-time, communication, paperwork) \u2014 shows trip-verified on the carrier\u2019s profile', style: 'margin:8px 0 0' });
        const send9 = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px', onClick: async () => {
          if (!st9) { alert('Tap the stars first \u2014 1 to 5.'); return; }
          send9.disabled = true; send9.textContent = 'Sending\u2026';
          try {
            await rateCounterparty(r9.trip_id, st9, cm9.value.trim() || null);
            try { localStorage.setItem('lb:rated:' + r9.trip_id, String(st9)); } catch (_) {}
            card9.replaceChildren(h('div', { style: 'text-align:center;padding:8px 0' }, [h('div', { style: 'font-size:1.6rem' }, '\u2705'), h('div', { class: 'cp-row-t' }, 'Thanks \u2014 rated ' + st9 + '\u2605'), h('div', { class: 'cp-row-s' }, 'Your rating is live on the carrier\u2019s public profile.')]));
            setTimeout(() => { try { card9.remove(); } catch (_) {} }, 3500);
          } catch (e9) { send9.disabled = false; send9.textContent = 'Submit rating'; alert((e9 && e9.message) || 'Could not submit.'); }
        } }, 'Submit rating');
        card9.append(
          h('div', { class: 'cp-row-t', style: 'font-size:1.02rem' }, '\u2b50 Rate this carrier \u2014 ' + (r9.carrier || 'your carrier')),
          h('div', { class: 'cp-row-s', style: 'margin-top:2px' }, 'Trip-verified: ' + (r9.lane || '') + ' \u00b7 delivered ' + String(r9.delivered_at || '').slice(0, 10) + ' \u00b7 your stars power every broker\u2019s carrier choice'),
          h('div', { style: 'margin-top:6px' }, btns9), cm9, send9);
        bdRate9.appendChild(card9);
      })();
      mount(bContent, h('div', null, [bdHero(), bdRate9, obHero, bdAttention(), payablesCard(), bdKpis(), h('div', { id: 'bd-postload' }, [ov.onboarded ? (postFoldOpen ? h('div', null, [h('div', { style: 'text-align:right;margin-bottom:6px' }, h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { postFoldOpen = false; brender(); } }, '\u2715 Fold away')), form]) : postFoldBanner()) : verifyGateCard(ov)]), myLoadsCard, bdNetwork(), bdActivity()]));
      return;
    }
    mount(bContent, h('div', null, PAGES[btab] || []));
  }
  function bgo(id) {
    btab = id; if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    Object.keys(bLinks).forEach((k) => bLinks[k].forEach((a) => a.classList.toggle('active', k === btab)));
    const it = BNAV.find((n) => n[0] === btab); bTitle.textContent = it ? it[1] : 'Dashboard';
    brender();
  }
  window.addEventListener('hashchange', () => { const t9 = (location.hash || '').replace('#', ''); if (t9 && t9 !== btab && BNAV.some((n) => n[0] === t9)) bgo(t9); });
  const bShell = h('div', { class: 'cp-shell' }, [
    h('aside', { class: 'cp-side' }, [
      h('div', { class: 'cp-brandrow' }, brandLogo({ dark: true, sub: KIND_LABEL[ov.kind] || 'Broker' })),
      bNavEl,
      h('div', { class: 'cp-side-foot' }, [
        h('div', { class: 'cp-carrier' }, [h('div', { class: 'cp-carrier-name' }, ov.company || 'Broker'), h('div', { class: 'cp-carrier-mail' }, (user && user.email) || '')]),
        h('button', { class: 'cp-side-out', onClick: async (ev) => { ev.currentTarget.disabled = true; await signOut(); location.reload(); } }, [icon('logout', 16), h('span', null, 'Sign out')]),
      ]),
    ]),
    h('main', { class: 'cp-main' }, [
      h('header', { class: 'cp-top' }, [
        h('div', { class: 'cp-top-left' }, bTitle),
        h('div', { class: 'cp-top-right' }, [h('span', { class: 'cp-pill', style: 'background:#e7f9ee;color:#12a150;font-weight:800' }, KIND_LABEL[ov.kind] || 'Broker'), notifBell(), (() => {
          const menu = h('div', { class: 'cp-menu', hidden: true, style: 'position:absolute;right:0;top:46px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 18px 44px -14px rgba(15,23,42,.28);min-width:230px;z-index:90;padding:10px 0' }, [
            h('div', { style: 'padding:6px 16px 10px;border-bottom:1px solid #f1f5f9' }, [h('div', { style: 'font-weight:800' }, ov.company || 'Broker'), h('div', { class: 'cp-sub' }, (user && user.email) || '')]),
            h('button', { class: 'cp-menu-item', style: 'display:flex;gap:10px;align-items:center;width:100%;padding:10px 16px;background:none;border:0;cursor:pointer;font-weight:600', onClick: () => { menu.hidden = true; bgo('account'); } }, [icon('user', 16), 'Account & settings']),
            h('button', { class: 'cp-menu-item', style: 'display:flex;gap:10px;align-items:center;width:100%;padding:10px 16px;background:none;border:0;cursor:pointer;font-weight:600', onClick: () => { menu.hidden = true; bgo('onboarding'); } }, [icon('dock', 16), 'Documents']),
            h('button', { class: 'cp-menu-item', style: 'display:flex;gap:10px;align-items:center;width:100%;padding:10px 16px;background:none;border:0;cursor:pointer;font-weight:700;color:#dc2626', onClick: async () => { await signOut(); location.reload(); } }, [icon('logout', 16), 'Sign out']),
          ]);
          const btn = h('button', { class: 'cp-avatar', 'aria-haspopup': 'menu', title: (user && user.email) || '', onClick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; },
            html: '<span style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#0883F7,#1d4ed8);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px">' + (((user && user.email) || '?').trim().charAt(0).toUpperCase()) + '</span>' });
          document.addEventListener('click', () => { menu.hidden = true; });
          return h('div', { style: 'position:relative' }, [btn, menu]);
        })()]),
      ]),
      bContent,
    ]),
  ]);
  mount(root, bShell);
  bgo(btab);
  root.setAttribute('aria-busy', 'false');
  loadList();
  // ---- AGENT SLIM WORKSPACE: agents only POST + TRACK — no broker portal around it ----
  (async () => {
    let isAgentWs = false; try { isAgentWs = !!(await isMyOrgAgent()); } catch (_) {}
    if (!isAgentWs) return;
    const embedded9 = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
    // AGENT DARK SKIN: the wizard must look like a native agent-portal page, not a white broker page
    try {
      document.body.style.background = '#0d1526'; document.documentElement.style.background = '#0d1526';
      document.body.classList.add('lb-agdark');
      if (!document.getElementById('lb-agdark-css')) {
        const st9 = document.createElement('style'); st9.id = 'lb-agdark-css';
        st9.textContent = [
          'body.lb-agdark{background:#0d1526!important;color:#dbe4f3}',
          'body.lb-agdark .cp-card{background:#111c31!important;border-color:rgba(255,255,255,.10)!important;box-shadow:none!important;color:#dbe4f3}',
          'body.lb-agdark .cp-card:hover{box-shadow:none!important}',
          'body.lb-agdark .cp-card h1,body.lb-agdark .cp-card h2,body.lb-agdark .cp-card h3,body.lb-agdark .cp-card h4,body.lb-agdark .cp-cardhead h3{color:#f1f5f9!important}',
          'body.lb-agdark .cp-in,body.lb-agdark select.cp-in,body.lb-agdark textarea.cp-in{background:#0c1628!important;border-color:rgba(255,255,255,.16)!important;color:#eef2f9!important}',
          'body.lb-agdark .cp-in:focus{border-color:#0883F7!important;background:#0c1628!important}',
          'body.lb-agdark .cp-in::placeholder{color:#5f7191!important}',
          'body.lb-agdark select.cp-in option{background:#0c1628;color:#eef2f9}',
          'body.lb-agdark .cp-lbl,body.lb-agdark .cp-field2>span{color:#9fb0cc!important}',
          'body.lb-agdark .cp-sub{color:#8ea1bf!important}',
          'body.lb-agdark table,body.lb-agdark th,body.lb-agdark td{color:#dbe4f3;border-color:rgba(255,255,255,.08)!important}',
        ].join('\n');
        document.head.appendChild(st9);
      }
    } catch (_) {}
    // START MINIMIZED: a slim dark banner — the full wizard opens on tap and can fold away again
    const agFormBox9 = h('div', null, [
      h('div', { style: 'text-align:right;margin-bottom:6px' },
        h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'background:rgba(255,255,255,.08);color:#cbd5e1;border:1px solid rgba(255,255,255,.14)', onClick: () => { agFormBox9.hidden = true; agFoldBar9.hidden = false; } }, '✕ Minimize')),
      form,
    ]);
    agFormBox9.hidden = true;
    const agFoldBar9 = h('div', { style: 'cursor:pointer;border-radius:16px;background:linear-gradient(120deg,#101d36,#0e2246);border:1px solid rgba(8,131,247,.35);padding:16px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap', onClick: () => { agFoldBar9.hidden = true; agFormBox9.hidden = false; try { agFormBox9.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} } }, [
      h('div', { style: 'font-size:1.6rem' }, '⚡'),
      h('div', { style: 'flex:1;min-width:220px' }, [
        h('div', { style: 'font-weight:900;color:#fff;font-size:1.02rem' }, 'Post a load'),
        h('div', { style: 'color:#8ea1bf;font-size:.8rem;margin-top:2px' }, 'Full broker wizard — lane, multi-stop, schedule, rate card, LOAD SOURCE. Tap to open.'),
      ]),
      h('span', { style: 'background:#0883F7;color:#fff;font-weight:800;border-radius:10px;padding:9px 16px;font-size:.85rem' }, '+ Open wizard'),
    ]);
    mount(root, h('div', { style: 'max-width:1100px;margin:0 auto;padding:' + (embedded9 ? '4px 6px 30px' : '16px 14px 40px') }, [
      embedded9 ? null : h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap' }, [
        brandLogo({ dark: true, sub: 'Agent posting' }),
        h('div', { class: 'cp-sub', style: 'flex:1;min-width:220px' }, 'Post a load and track it exactly like a broker — everything else lives in your Agent dashboard.'),
      ]),
      agFoldBar9,
      agFormBox9,
      h('div', { style: 'height:14px' }),
      myLoadsCard,
      h('div', { style: 'height:14px' }),
      // MONEY DUTIES: on YOUR posted loads you stand where the broker stands —
      // carrier claims (detention/layover/lumper/TONU/assist/stop-off) come to YOU to approve/reject,
      // and payables (freight on delivery + approved claims) are YOURS to pay via the pay rail.
      h('div', { style: 'border-radius:14px;background:rgba(252,83,5,.08);border:1px solid rgba(252,83,5,.35);padding:12px 16px;margin-bottom:2px' }, [
        h('div', { style: 'font-weight:900;color:#fdba74' }, '💼 Your broker duties on posted loads'),
        h('div', { style: 'color:#cbb69f;font-size:.8rem;margin-top:3px;line-height:1.6' }, 'Carrier claims (detention · layover · lumper · TONU · driver assist · stop-off) land below with GPS evidence and the exact rate-card amount — you Approve or Reject them, exactly like a broker. Delivered freight + approved claims become DUE items you pay through the pay rail (bank details → transfer → upload receipt → carrier confirms). You collect from your LOAD SOURCE — LoadBoot verifies both sides.'),
      ]),
      payablesCard(),
      h('div', { style: 'height:14px' }),
      claimsCard(),
    ].filter(Boolean)));
  })();
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
      // Mobile-first shipment cards with a live status stepper (phone = primary device).
      const STEPS = [['requested', 'Requested'], ['quoted', 'Quoted'], ['booked', 'Booked'], ['in_transit', 'Moving'], ['delivered', 'Delivered']];
      const stepIdx = (st) => {
        const t = String(st || '').toLowerCase();
        if (/deliver|complete|pod/.test(t)) return 4;
        if (/transit|moving|dispatch|picked/.test(t)) return 3;
        if (/book|tender|covered|accept/.test(t)) return 2;
        if (/quote/.test(t)) return 1;
        return 0;
      };
      mount(listHost, h('div', null, rows.map(sh => {
        const idx = stepIdx(sh.status);
        const stepper = h('div', { style: 'display:flex;gap:5px;margin:10px 0 4px' }, STEPS.map(([k, label], i) =>
          h('div', { style: 'flex:1;text-align:center' }, [
            h('div', { style: 'height:5px;border-radius:99px;background:' + (i <= idx ? '#0883F7' : '#e2e8f0') }),
            h('div', { style: 'font-size:10px;margin-top:4px;color:' + (i <= idx ? '#0883F7' : '#94a3b8') + ';font-weight:' + (i === idx ? '700' : '500') }, label),
          ])));
        return h('div', { class: 'cp-card', style: 'margin-bottom:10px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap' }, [
            h('div', null, [
              h('div', { style: 'font-weight:800;font-size:15px' }, (sh.origin || '—') + ' → ' + (sh.destination || '—')),
              h('div', { class: 'cp-sub' }, ['Ready ' + fmtDate(sh.ready_date), sh.equipment || null, sh.handled_by ? 'Handled by ' + sh.handled_by : null].filter(Boolean).join(' · ')),
            ]),
            pill(sh.status),
          ]),
          stepper,
          sh.quote_amount ? h('div', { style: 'margin-top:6px;font-weight:800;color:#16a34a' }, 'Quote: $' + Number(sh.quote_amount).toLocaleString() + (sh.quote_note ? ' · ' + sh.quote_note : '')) : null,
        ].filter(Boolean));
      })));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load.')); }
  }
  mount(root, shell(user, 'shipper', ov.company, kpis, h('div', null, [h('div', { class: 'cp-grid2' }, [ov.onboarded ? form : verifyGateCard(ov), h('div', { class: 'cp-card' }, [h('div', { class: 'cp-cardhead' }, [icon('ship', 18), h('h3', null, 'My shipments')]), listHost])]), approvedPartnersCard(), (() => { const hst = h('div'); renderMarketWidget(hst, { sub: 'What shipping costs right now \u2014 broker sell rates for your lanes, refreshed weekly.' }); return hst; })(), invoicesCard(), accountCard()])));
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
      // Mobile-first appointment cards (dock staff work from phones/tablets at the gate)
      mount(listHost, h('div', null, rows.map(a => {
        const act = h('div', { style: 'display:flex;gap:8px;margin-top:8px' });
        if (a.status === 'scheduled') act.appendChild(h('button', { class: 'cp-btn cp-btn-sm', onClick: (ev) => setStatus(a.id, 'checked_in', ev.currentTarget.closest('.cp-card')) }, '✓ Check in'));
        else if (a.status === 'checked_in') act.appendChild(h('button', { class: 'cp-btn cp-btn-sm', onClick: (ev) => setStatus(a.id, 'completed', ev.currentTarget.closest('.cp-card')) }, '✓ Complete'));
        return h('div', { class: 'cp-card', style: 'margin-bottom:10px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap' }, [
            h('div', null, [
              h('div', { style: 'font-weight:800;font-size:15px' }, fmtDT(a.window_start)),
              h('div', { class: 'cp-sub' }, [a.dock ? 'Dock ' + a.dock : null, a.carrier_name || null, a.reference || null].filter(Boolean).join(' · ')),
            ]),
            h('div', { style: 'display:flex;gap:6px' }, [pill(a.direction), pill(a.status)]),
          ]),
          act.childNodes.length ? act : null,
        ].filter(Boolean));
      })));
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
  // SHIPPER = full broker-grade portal. Same wizard/tracking/payables/claims/invoices engine;
  // the onboarding packet is kind-aware server-side (credit app, shipper agreement, payment terms,
  // billing instructions, cargo profile, claims contact, facility rules, insurance, hazmat).
  if (ov.kind === 'shipper') return brokerDash(user, ov);
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
