// broker-trust.js — Broker "post in minutes" onboarding (bl_bp_0312).
// Self-contained module (own h/mount, own CSS injected once). Additive: app.js only
// mounts it where verifyGateCard() used to sit and adds one signup step.
//
// The ladder a broker climbs:
//   1 FMCSA screen (MC or USDOT → live L&I / SAFER)     ← seconds, no documents
//   1b Identity claim (bl_bp_0313/0314): signup-email domain == FMCSA domain → automatic; otherwise
//      one click from the FMCSA-listed email, or an AUTOMATED call to the FMCSA-listed phone that reads a
//      6-digit code (Retell "LoadBoot Verify" agent) — the broker types it here. No LoadBoot staff involved.
//   2 Master Broker Agreement (one click)
//   3 Post — up to 3 open loads until the first delivery, 10 after
//   4 Verified packet → unlimited + instant booking for carriers
// Agents (no own MC) declare the brokerage(s) they post under (bl_bp_0318: one account, up to 10
// brokerages). Each brokerage confirms on its own: a 6-digit code + link emailed to the address FMCSA
// lists (or its LoadBoot owner, or an address on the same domain) — the brokerage hands the code to the
// agent, the agent types it here. No calls, no LoadBoot staff. Loads post under ONE chosen brokerage.
import { partnerBrokerScreen, partnerAgentDeclare, partnerTrustStatus, currentAgreement, acceptAgreement, fmcsaVerify, partnerIdentityResend, partnerIdentityRequestCall, partnerVerifyCall, partnerVerifyCode, partnerAgentParentRemove, partnerAgentParentResend } from '../shared/api.js';

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
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

const CSS = `
.bt-wrap{--bt-navy:#10223B;--bt-blue:#0883F7;--bt-orange:#FC5305;--bt-ok:#12a150;--bt-warn:#b45309;--bt-bad:#c62828;font-family:inherit}
.bt-hero{position:relative;overflow:hidden;border-radius:20px;padding:22px 24px;color:#fff;
  background:radial-gradient(520px 220px at 100% 0%,rgba(8,131,247,.35),transparent 60%),radial-gradient(420px 200px at 0% 100%,rgba(252,83,5,.18),transparent 55%),linear-gradient(135deg,#0a1526,#10223B 70%);
  box-shadow:0 24px 50px -30px rgba(16,34,59,.6)}
.bt-hero-k{font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd}
.bt-hero-t{font-size:1.45rem;font-weight:800;letter-spacing:-.02em;line-height:1.2;margin:6px 0 4px}
.bt-hero-s{color:#b6c3d6;font-size:.92rem;line-height:1.55;max-width:640px}
.bt-ladder{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}
@media(max-width:820px){.bt-ladder{grid-template-columns:repeat(2,1fr)}}
.bt-step{border-radius:14px;padding:12px 13px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);min-height:86px;position:relative;transition:transform .15s,background .15s}
.bt-step.done{background:rgba(18,161,80,.16);border-color:rgba(74,222,128,.45)}
.bt-step.now{background:rgba(8,131,247,.2);border-color:#4EA6F9;box-shadow:0 0 0 4px rgba(8,131,247,.15)}
.bt-step.lock{opacity:.55}
.bt-step-n{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;background:rgba(255,255,255,.12)}
.bt-step.done .bt-step-n{background:#16a34a}
.bt-step.now .bt-step-n{background:#0883F7}
.bt-step-t{font-weight:800;font-size:.9rem;margin-top:8px}
.bt-step-d{font-size:.76rem;color:#aab8cc;margin-top:2px;line-height:1.4}
.bt-card{background:#fff;border:1px solid #e6ebf3;border-radius:18px;padding:18px 20px;margin-top:14px;box-shadow:0 1px 2px rgba(16,34,59,.04),0 12px 32px -24px rgba(16,34,59,.18)}
.bt-card h3{margin:0 0 4px;font-size:1.02rem;font-weight:800;color:#0f1f38;letter-spacing:-.01em}
.bt-sub{color:#64748b;font-size:.88rem;line-height:1.55}
.bt-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
.bt-in{flex:1;min-width:200px;border-radius:12px;border:1.5px solid #e2e8f0;background:#fbfcfe;padding:12px 14px;font-weight:700;font-size:1rem;color:#10223B;letter-spacing:.04em}
.bt-in:focus{outline:none;border-color:#0883F7;background:#fff;box-shadow:0 0 0 4px rgba(8,131,247,.12)}
.bt-btn{border:0;border-radius:12px;padding:12px 18px;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(120deg,#0883F7,#0967d2);box-shadow:0 8px 20px -10px rgba(8,131,247,.65);transition:transform .12s,filter .12s}
.bt-btn:hover{transform:translateY(-1px);filter:brightness(1.05)}
.bt-btn:disabled{opacity:.55;transform:none;cursor:default}
.bt-btn.ghost{background:#fff;color:#334155;border:1.5px solid #e2e8f0;box-shadow:none}
.bt-btn.orange{background:linear-gradient(120deg,#FC5305,#e0480a);box-shadow:0 8px 20px -10px rgba(252,83,5,.6)}
.bt-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 11px;font-size:.76rem;font-weight:800}
.bt-pill.ok{background:#e7f9ee;color:#12a150}.bt-pill.warn{background:#fff4e6;color:#b45309}.bt-pill.bad{background:#fdecec;color:#c62828}.bt-pill.info{background:#eff6ff;color:#1d4ed8}.bt-pill.muted{background:#f1f5f9;color:#475569}
.bt-spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(8,131,247,.25);border-top-color:#0883F7;animation:btspin .8s linear infinite;display:inline-block}
@keyframes btspin{to{transform:rotate(360deg)}}
.bt-fact{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;margin-top:12px}
@media(max-width:640px){.bt-fact{grid-template-columns:1fr}}
.bt-fact div{font-size:.84rem;color:#334155}.bt-fact b{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#7c8aa0;font-weight:800}
.bt-meter{height:8px;border-radius:99px;background:#eef2f7;overflow:hidden;margin-top:8px}
.bt-meter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#4EA6F9)}
.bt-choice{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
@media(max-width:640px){.bt-choice{grid-template-columns:1fr}}
.bt-choice button{text-align:left;border:1.5px solid #e2e8f0;background:#fff;border-radius:14px;padding:14px 16px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.bt-choice button:hover{border-color:#93c5fd}.bt-choice button.sel{border-color:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.14)}
.bt-choice .t{font-weight:800;color:#10223B}.bt-choice .d{font-size:.84rem;color:#64748b;margin-top:3px;line-height:1.45}
.bt-err{color:#c62828;font-weight:700;font-size:.86rem;margin-top:8px;min-height:1em}
.bt-note{margin-top:10px;font-size:.8rem;color:#7c8aa0;line-height:1.5}
.bt-agr{max-height:220px;overflow:auto;border:1px solid #e6ebf3;border-radius:12px;padding:12px 14px;background:#fbfcfe;font-size:.84rem;line-height:1.55;color:#334155;white-space:pre-wrap;margin-top:10px}
.bt-seg{display:inline-flex;border:1.5px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff}
.bt-seg button{border:0;background:transparent;padding:10px 14px;font-weight:800;font-size:.82rem;color:#64748b;cursor:pointer}
.bt-seg button.on{background:#10223B;color:#fff}
.bt-idbox{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:12px;background:#fbfcfe;border:1px dashed #cbd5e1;margin-top:12px}
.bt-par{border:1px solid #e6ebf3;border-radius:14px;padding:12px 14px;margin-top:12px;background:#fff}
.bt-par.ok{border-color:#bbf7d0;background:#f6fef9}.bt-par.warn{border-color:#fcd34d;background:#fffbeb}.bt-par.bad{border-color:#fecaca;background:#fff5f5}.bt-par.muted{opacity:.75}
.bt-par .h{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.bt-par .n{font-weight:800;color:#10223B;font-size:.95rem}.bt-par .mc{font-size:.8rem;color:#64748b;font-weight:700}
.bt-par .acts{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.bt-btn.sm{padding:7px 11px;font-size:.78rem}.bt-btn.danger{color:#c62828;border-color:#fecaca;background:#fff}
.bt-code{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:10px 12px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe}
.bt-code .m{font-weight:800;color:#1e3a8a;font-size:.85rem;flex:1 1 260px}
.bt-idbox .m{font-weight:800;color:#10223B;letter-spacing:.02em}
.bt-topbadge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;font-size:.74rem;font-weight:800;border:1px solid transparent}
`;
let cssDone = false;
export function ensureCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.id = 'bt-css'; s.textContent = CSS; document.head.appendChild(s); }

const TIER_LABEL = {
  new: ['muted', 'Not screened yet'],
  unclaimed: ['warn', 'Confirm it’s your brokerage'],
  screened: ['info', 'FMCSA-screened · limited posting'],
  agent_pending: ['warn', 'Waiting for your brokerage to confirm'],
  agent_confirmed: ['info', 'Confirmed agent · limited posting'],
  verified: ['ok', 'Verified brokerage · unlimited'],
  hold: ['bad', 'Posting on hold'],
};

// Small badge for the top bar / dashboard hero.
export function trustBadge(st) {
  const [cls, label] = TIER_LABEL[(st && st.tier) || 'new'] || TIER_LABEL.new;
  const col = { ok: ['#e7f9ee', '#12a150'], info: ['#eff6ff', '#1d4ed8'], warn: ['#fff4e6', '#b45309'], bad: ['#fdecec', '#c62828'], muted: ['#f1f5f9', '#475569'] }[cls];
  return h('span', { class: 'bt-topbadge', style: 'background:' + col[0] + ';color:' + col[1], title: (st && st.reason) || '' }, [
    cls === 'ok' ? '✓ ' : cls === 'bad' ? '⛔ ' : cls === 'warn' ? '⏳ ' : '🛡 ', label]);
}

function stepState(st) {
  const tier = (st && st.tier) || 'new';
  const scrOk = !!(st && st.screening && st.screening.outcome === 'pass');
  const agrOk = !!(st && st.agreement_ok);
  const verified = tier === 'verified';
  const agentOk = !st.agent || !!(st.agent && st.agent.confirmed_at) || !!((st.parents || []).some((p) => p.status === 'confirmed'));
  const idOk = !!st.agent || !st.identity || st.identity.status === 'verified';
  return {
    s1: verified || (scrOk && agentOk && idOk) ? 'done' : 'now',
    s2: verified || agrOk ? 'done' : (scrOk && agentOk && idOk) ? 'now' : 'lock',
    s3: verified ? 'done' : (st && st.can_post) ? 'now' : 'lock',
    s4: verified ? 'done' : (st && st.can_post) ? 'now' : 'lock',
  };
}

function ladder(st) {
  const s = stepState(st);
  const step = (n, cls, t, d) => h('div', { class: 'bt-step ' + cls }, [h('span', { class: 'bt-step-n' }, cls === 'done' ? '✓' : String(n)), h('div', { class: 'bt-step-t' }, t), h('div', { class: 'bt-step-d' }, d)]);
  const lim = st && st.posting_limit;
  return h('div', { class: 'bt-ladder' }, [
    step(1, s.s1, 'FMCSA screen + identity', st && st.agent ? 'Each brokerage’s authority, checked live on FMCSA — then they hand you a 6-digit code from the email we send them.' : 'Your broker authority, checked live on FMCSA, then a code by automated call to your FMCSA-listed phone (or one click from the FMCSA-listed email). No uploads, no waiting.'),
    step(2, s.s2, 'One-click agreement', 'The Master Broker Agreement — rate card, detention, TONU terms carriers see.'),
    step(3, s.s3, 'Post your first loads', (lim ? 'Up to ' + lim + ' open postings' : 'Unlimited postings') + ' · carriers request, you approve.'),
    step(4, s.s4, 'Verified brokerage', 'Packet verified → unlimited postings, instant booking, payables inside LoadBoot.'),
  ]);
}

/* ---------------- screening card (own MC) ---------------- */
function screenCard(st, refresh) {
  const scr = st.screening;
  const err = h('div', { class: 'bt-err' });
  // MC (docket) or USDOT — broker authority lives on the MC; a USDOT is resolved to it by FMCSA
  let idKind = (scr && !scr.mc && scr.dot) ? 'dot' : 'mc';
  const mc = h('input', { class: 'bt-in', placeholder: 'MC number — e.g. 1234567', inputmode: 'numeric', autocomplete: 'off', value: (scr && scr.mc) || st.mc || '' });
  const segMc = h('button', { type: 'button', class: 'on' }, 'MC'); const segDot = h('button', { type: 'button' }, 'USDOT');
  const setKind = (k) => { idKind = k; segMc.className = k === 'mc' ? 'on' : ''; segDot.className = k === 'dot' ? 'on' : ''; mc.placeholder = k === 'mc' ? 'MC number — e.g. 1234567' : 'USDOT number — e.g. 2228065'; };
  segMc.onclick = () => setKind('mc'); segDot.onclick = () => setKind('dot'); setKind(idKind);
  const btn = h('button', { class: 'bt-btn' }, scr ? 'Re-run screening' : 'Screen my authority →');
  btn.onclick = async () => {
    err.textContent = '';
    const raw = mc.value; const d = digits(raw);
    if (/usdot|dot/i.test(raw)) setKind('dot'); else if (/mc/i.test(raw)) setKind('mc');
    if (!d) { err.textContent = idKind === 'dot' ? 'Enter your USDOT number.' : 'Enter your MC number.'; return; }
    if (d.length > 8) { err.textContent = 'That number is too long (max 8 digits).'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="bt-spin"></span>&nbsp; Checking FMCSA…';
    try {
      const r = idKind === 'dot' ? await partnerBrokerScreen(null, d) : await partnerBrokerScreen(d, null);
      if (r && r.outcome === 'refused') { err.textContent = r.error || 'This MC is already registered on LoadBoot.'; btn.disabled = false; btn.textContent = 'Screen my authority →'; return; }
      await refresh(true);
    }
    catch (e) { err.textContent = (e && e.message) || 'Could not start the screening.'; btn.disabled = false; btn.textContent = 'Screen my authority →'; }
  };
  const facts = scr && scr.outcome !== 'pending' ? h('div', { class: 'bt-fact' }, [
    h('div', null, [h('b', null, 'FMCSA legal name'), scr.legal_name || '—']),
    h('div', null, [h('b', null, 'Broker authority'), scr.broker_authority === true ? 'ACTIVE' : scr.broker_authority === false ? 'not active' : (scr.safer_text ? scr.safer_text.replace(/\s+/g, ' ') : 'unknown')]),
    h('div', null, [h('b', null, 'Source'), scr.source === 'fmcsa-li' ? 'FMCSA Licensing & Insurance (live)' : scr.source === 'fmcsa-safer' ? 'FMCSA SAFER snapshot (live)' : scr.source === 'staff' ? 'Verified by LoadBoot staff' : '—']),
    h('div', null, [h('b', null, 'Checked'), scr.checked_at ? new Date(scr.checked_at).toLocaleString() : '—']),
  ]) : null;
  const status = !scr ? null
    : scr.pending || scr.outcome === 'pending' ? h('div', { class: 'bt-row' }, [h('span', { class: 'bt-spin' }), h('span', { class: 'bt-sub' }, 'Checking FMCSA Licensing & Insurance… usually under a minute. This page updates by itself.')])
    : scr.outcome === 'pass' ? h('span', { class: 'bt-pill ok' }, '✓ Broker authority active on FMCSA — bond on file')
    : scr.outcome === 'fail' ? h('span', { class: 'bt-pill bad' }, '✕ ' + (scr.reason || 'Screening did not pass'))
    : h('span', { class: 'bt-pill warn' }, '⏳ ' + (scr.reason || 'Our team is verifying this by hand'));
  return h('div', { class: 'bt-card' }, [
    h('h3', null, '1 · Screen your broker authority'),
    h('div', { class: 'bt-sub' }, 'We read your authority straight from FMCSA — Licensing & Insurance, with the SAFER snapshot as backup. FMCSA only keeps broker authority active while a $75,000 BMC-84/85 bond is on file, so this one check covers both. Enter your MC or your USDOT — nothing to upload, nothing to photocopy.'),
    status ? h('div', { style: 'margin-top:12px' }, status) : null,
    facts,
    (!scr || scr.outcome !== 'pass') ? h('div', { class: 'bt-row' }, [h('div', { class: 'bt-seg' }, [segMc, segDot]), mc, btn]) : null,
    err,
    (!scr || scr.outcome !== 'pass') ? h('div', { class: 'bt-note' }, 'Don’t have your own MC? Post under the brokerage you work for instead — ', [h('a', { href: '#', onClick: (ev) => { ev.preventDefault(); refresh(false, 'agent'); } }, 'I’m an agent →')]) : null,
  ]);
}

/* ---------------- voice OTP block (bl_bp_0314) — shared by the identity card and the agent card ---------------- */
// purpose 'identity': call the broker's own FMCSA-listed phone. purpose 'parent': call the parent brokerage's.
// The number is never typed by the user — it comes from the FMCSA record. Whoever answers hears a 6-digit code.
let otpNotice = null;
function voiceOtpBlock(st, purpose, refresh) {
  const vc = st.verify_call && st.verify_call.purpose === purpose && !st.verify_call.consumed ? st.verify_call : null;
  const phoneOk = st.verify_phone_ok !== false;
  const phoneMasked = (st.identity && st.identity.fmcsa_phone_masked) || (st.screening && st.screening.fmcsa_phone ? st.screening.fmcsa_phone.replace(/\d(?=\d{4})/g, '*') : null);
  const err = h('div', { class: 'bt-err' });
  if (otpNotice) { err.style.color = otpNotice.ok ? '#12a150' : ''; err.textContent = otpNotice.text; }
  const live = vc && new Date(vc.expires_at).getTime() > Date.now();
  const callBtn = h('button', { class: 'bt-btn' + (live ? ' ghost' : '') }, live ? 'Call again' : (purpose === 'parent' ? '📞 Call my brokerage’s FMCSA number now' : '📞 Call my FMCSA-listed number now'));
  callBtn.onclick = async () => {
    otpNotice = null; callBtn.disabled = true; callBtn.innerHTML = '<span class="bt-spin"></span>&nbsp; Dialing…';
    try { const r = await partnerVerifyCall(purpose); otpNotice = r && r.ok ? { ok: true, text: r.already ? 'Already confirmed.' : 'Calling ' + (r.to || 'the FMCSA-listed number') + ' now — it rings within about 10 seconds. Type the 6-digit code you hear below.' + (r.calls_left != null ? ' (' + r.calls_left + ' call' + (r.calls_left === 1 ? '' : 's') + ' left today)' : '') } : { ok: false, text: (r && r.why) || 'Could not place the call.' }; }
    catch (e) { otpNotice = { ok: false, text: (e && e.message) || 'Could not place the call.' }; }
    await refresh(true);
  };
  const code = h('input', { class: 'bt-in', placeholder: '6-digit code from the call', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, style: 'flex:0 1 240px;letter-spacing:.2em;text-align:center' });
  const okBtn = h('button', { class: 'bt-btn orange' }, 'Confirm code →');
  okBtn.onclick = async () => {
    const d = digits(code.value); if (d.length !== 6) { err.style.color = ''; err.textContent = 'Enter the 6 digits you heard.'; return; }
    okBtn.disabled = true;
    try { const r = await partnerVerifyCode(d); otpNotice = r && r.ok ? { ok: true, text: '✓ Confirmed.' } : { ok: false, text: (r && r.why) || 'That code did not match.' }; }
    catch (e) { otpNotice = { ok: false, text: (e && e.message) || 'Could not check the code.' }; }
    okBtn.disabled = false; await refresh(true);
  };
  const who = purpose === 'parent' ? 'whoever answers at your brokerage' : 'whoever answers';
  return h('div', { class: 'bt-idbox', style: 'flex-direction:column;align-items:stretch;gap:8px' }, [
    h('div', { class: 'm' }, '📞 Automated call — no waiting on anyone at LoadBoot'),
    h('div', { class: 'bt-note', style: 'margin:0' }, phoneOk
      ? 'We call the phone number FMCSA lists' + (phoneMasked ? ' (' + phoneMasked + ')' : '') + ' with a short automated message; ' + who + ' hears a 6-digit code' + (purpose === 'parent' ? ' and gives it to you if they approve' : '') + '. Type it here and you are confirmed on the spot. Codes last 15 minutes; 3 calls a day.'
      : 'FMCSA lists no usable US phone number for this record, so the call option is off — use the email link' + (purpose === 'parent' ? '' : ', or ask our team') + '.'),
    phoneOk ? h('div', { class: 'bt-row', style: 'margin-top:4px' }, live ? [code, okBtn, callBtn] : [callBtn]) : null,
    live ? h('div', { class: 'bt-note', style: 'margin:0' }, 'Call placed ' + new Date(vc.placed_at).toLocaleTimeString() + ' · code valid until ' + new Date(vc.expires_at).toLocaleTimeString() + (vc.call_status === 'no-answer' ? ' · no answer — try again when someone can pick up' : '') + (vc.attempts ? ' · ' + vc.attempts + ' wrong attempt' + (vc.attempts === 1 ? '' : 's') : '')) : null,
    err,
  ]);
}

/* ---------------- identity card (own MC · screening passed · not yet claimed) ---------------- */
// Authority ≠ identity: anyone can type a real brokerage's MC. This is the Highway-style claim —
// prove you are that brokerage via the contact FMCSA has on file (email link) or a staff call
// to the FMCSA-listed phone. Domain matches are verified automatically and never see this card.
let idNotice = null; // { ok, text } — survives the repaint that follows a refresh
function identityCard(st, refresh) {
  const idn = st.identity || {};
  const err = h('div', { class: 'bt-err' });
  if (idNotice) { err.style.color = idNotice.ok ? '#12a150' : ''; err.textContent = idNotice.text; }
  const hasMail = !!idn.has_fmcsa_email;
  const sentAt = idn.email_sent_at ? new Date(idn.email_sent_at) : null;
  const resend = h('button', { class: 'bt-btn ghost' }, 'Resend the email');
  resend.onclick = async () => {
    err.textContent = ''; resend.disabled = true;
    try { const r = await partnerIdentityResend(); idNotice = (r && r.sent === false) ? { ok: false, text: r.why || 'Could not resend yet.' } : { ok: true, text: 'Sent again to ' + ((r && r.to) || idn.fmcsa_email_masked || 'the FMCSA address') + '.' }; }
    catch (e) { idNotice = { ok: false, text: (e && e.message) || 'Could not resend.' }; }
    resend.disabled = false; await refresh(true);
  };
  // last resort only (no FMCSA phone AND no FMCSA email): a human at LoadBoot
  const help = h('a', { href: '#', onClick: async (ev) => { ev.preventDefault(); try { await partnerIdentityRequestCall(null, 'no FMCSA phone/email usable'); idNotice = { ok: true, text: 'Logged — our team will reach out.' }; } catch (e) { idNotice = { ok: false, text: (e && e.message) || 'Could not log the request.' }; } await refresh(true); } }, 'ask our team to help →');
  return h('div', { class: 'bt-card', style: 'border-left:4px solid #b45309' }, [
    h('h3', null, '1b · Confirm it’s really your brokerage'),
    h('div', { class: 'bt-sub' }, 'Your broker authority is active on FMCSA — now we make sure this account belongs to that brokerage, the same check the big load boards run. Freight fraud starts with someone typing a real MC into a signup form; this closes that door.'),
    h('div', { class: 'bt-note', style: 'margin-top:10px;font-weight:800;color:#334155' }, 'Pick whichever is faster — both are automatic:'),
    voiceOtpBlock(st, 'identity', refresh),
    hasMail
      ? h('div', null, [
          h('div', { class: 'bt-idbox' }, [h('span', null, '📧'), h('div', null, [h('div', { class: 'm' }, 'Or click the link we emailed to ' + (idn.fmcsa_email_masked || 'the address FMCSA has on file')), h('div', { class: 'bt-note', style: 'margin-top:2px' }, (sentAt ? 'Sent ' + sentAt.toLocaleString() + '. ' : '') + 'One click there unlocks posting. The address is masked here on purpose — it comes from your FMCSA registration, not from you.')])]),
          h('div', { class: 'bt-row' }, [resend]),
        ])
      : h('div', { class: 'bt-note' }, ['FMCSA lists no email for your brokerage, so the phone call is the way in.', st.verify_phone_ok === false ? ' No usable phone either — ' : null, st.verify_phone_ok === false ? help : null]),
    err,
    h('div', { class: 'bt-note' }, 'Tip: signing up with an email at the same domain FMCSA has on file confirms identity automatically. Old contact details on your FMCSA record? Update them at FMCSA first — we only ever use what FMCSA lists.'),
  ]);
}

/* ---------------- agent card (no own MC) — bl_bp_0318: one account, several brokerages ---------------- */
// One row per brokerage. Each row is screened on FMCSA on its own and confirmed on its own:
//   • brokerage on LoadBoot  → its owner approves under Agents & team (we also email them the code)
//   • FMCSA-listed email     → link + 6-digit code; the brokerage gives the code to the agent, the agent types it here
//   • same-domain address    → an address the agent supplies counts only on the FMCSA email's own domain
//   • no FMCSA email at all  → the record is outdated: the brokerage fixes it on Ask FMCSA (MCS-150, free) and we re-check
// No calls in this path. Loads post under ONE chosen brokerage (picker on the post form).
let parNotice = {}; // parent id → { ok, text } — survives repaints
function agentCard(st, refresh) {
  const parents = st.parents || [];
  const live = parents.filter((p) => p.status !== 'revoked');
  const err = h('div', { class: 'bt-err' });
  const when = (ts) => ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  async function act(id, fn, okText) {
    parNotice[id] = null;
    try { const r = await fn(); parNotice[id] = (r && r.ok === false) || (r && r.sent === false) ? { ok: false, text: (r && r.why) || 'Could not do that.' } : { ok: true, text: okText || '✓ Done.' }; }
    catch (e) { parNotice[id] = { ok: false, text: (e && e.message) || 'Could not do that.' }; }
    await refresh(true);
  }

  function codeBox(p) {
    const code = h('input', { class: 'bt-in', placeholder: '6-digit code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, style: 'flex:0 1 170px;letter-spacing:.2em;text-align:center' });
    const ok = h('button', { class: 'bt-btn orange sm' }, 'Confirm code →');
    ok.onclick = async () => {
      const d = digits(code.value); if (d.length !== 6) { parNotice[p.id] = { ok: false, text: 'Enter the 6 digits from the email.' }; refresh(true); return; }
      ok.disabled = true;
      await act(p.id, () => partnerVerifyCode(d), '✓ Confirmed — you can post under ' + (p.name || 'this brokerage') + ' now.');
    };
    return h('div', { class: 'bt-code' }, [
      h('div', { class: 'm' }, 'Ask ' + (p.name || 'the brokerage') + ' for the 6-digit code in that email and type it here — confirmed on the spot.'),
      code, ok,
    ]);
  }

  function noContactBox(p) {
    const em = h('input', { class: 'bt-in', type: 'email', placeholder: p.fmcsa_domain ? 'someone@' + p.fmcsa_domain : 'ops@their-company-domain.com', style: 'flex:0 1 260px' });
    const btn = h('button', { class: 'bt-btn sm' }, 'Re-check FMCSA →');
    btn.onclick = async () => { btn.disabled = true; await act(p.id, () => partnerAgentDeclare(p.mc, p.name || '', em.value.trim() || null), 'Re-checking FMCSA — takes about a minute.'); };
    return h('div', { class: 'bt-idbox', style: 'flex-direction:column;align-items:stretch;gap:8px;border-color:#fcd34d;background:#fffbeb' }, [
      h('div', { class: 'm' }, '⚠ FMCSA lists no email for ' + (p.name || 'this brokerage') + ' — their record is out of date'),
      h('div', { class: 'bt-note', style: 'margin:0' }, [
        'We confirm agents only through the contact on the brokerage’s FMCSA record, so there are three ways forward: ',
        h('b', null, '(1)'), ' the brokerage updates its email on ', h('a', { href: 'https://ask.fmcsa.dot.gov', target: '_blank', rel: 'noopener' }, 'Ask FMCSA'), ' (MCS-150 update — free, a few minutes; it shows up within a day or two) and you press Re-check; ',
        h('b', null, '(2)'), ' the brokerage creates its own LoadBoot account and invites you from Agents & team; ',
        h('b', null, '(3)'), ' last resort — email ', h('a', { href: 'mailto:hello@loadboot.com?subject=Agent%20confirmation%20' + encodeURIComponent('MC-' + (p.mc || '')) }, 'hello@loadboot.com'), ' with your signed agent agreement.',
      ]),
      p.fmcsa_domain ? h('div', { class: 'bt-row', style: 'margin-top:0' }, [em, btn]) : h('div', { class: 'bt-row', style: 'margin-top:0' }, [btn]),
    ]);
  }

  function row(p) {
    const n = parNotice[p.id];
    const note = n ? h('div', { class: 'bt-err', style: n.ok ? 'color:#12a150' : '' }, n.text) : null;
    const remove = (label) => h('button', { class: 'bt-btn sm danger', onClick: async () => {
      if (p.status === 'confirmed' && !confirm('Leave ' + (p.name || 'this brokerage') + '? Your open postings under them will be cancelled.')) return;
      await act(p.id, () => partnerAgentParentRemove(p.id), 'Removed.');
    } }, label);
    const resend = h('button', { class: 'bt-btn ghost sm', onClick: async () => { await act(p.id, () => partnerAgentParentResend(p.id), 'Sent again.'); } }, 'Resend email');
    const recheck = h('button', { class: 'bt-btn sm', onClick: async () => { await act(p.id, () => partnerAgentDeclare(p.mc, p.name || '', null), 'Re-checking FMCSA — about a minute.'); } }, 'Re-check FMCSA');
    let cls = 'muted', pill = null, body = null, acts = [];
    if (p.status === 'confirmed') {
      cls = 'ok'; pill = h('span', { class: 'bt-pill ok' }, '✓ confirmed ' + when(p.confirmed_at));
      body = h('div', { class: 'bt-note', style: 'margin-top:6px' }, 'Confirmed by ' + (p.confirmed_by || 'the brokerage') + '. ' + (p.open ? p.open + ' open posting' + (p.open === 1 ? '' : 's') + ' under them. ' : '') + 'Every load you post under them shows their name and MC.');
      acts = [remove('Leave')];
    } else if (p.status === 'pending') {
      cls = 'warn'; pill = h('span', { class: 'bt-pill warn' }, '⏳ waiting for their code');
      const noContact = !p.sent_at && !p.has_fmcsa_email && !p.on_loadboot;
      body = noContact ? noContactBox(p) : h('div', null, [
        h('div', { class: 'bt-note', style: 'margin-top:6px' }, (p.on_loadboot
          ? (p.loadboot_name || p.name || 'They') + ' already has a LoadBoot account — its owner sees you under Agents & team and can approve with one click. We also emailed them a code and link' + (p.sent_to ? ' (' + p.sent_to + ')' : '') + '.'
          : 'Authority active on FMCSA. We emailed ' + (p.sent_to || 'the address on their FMCSA record') + ' a 6-digit code and a confirm link' + (p.sent_at ? ' on ' + new Date(p.sent_at).toLocaleString() : '') + (p.contact_source === 'domain' ? ' — including the company-domain address you gave us' : '') + '. Nothing you post under them can be booked until they decide.')),
        p.code_live || p.sent_at ? codeBox(p) : null,
      ]);
      acts = [p.sent_at ? resend : null, remove('Remove')].filter(Boolean);
    } else if (p.status === 'screening') {
      cls = 'muted'; pill = h('span', { class: 'bt-pill info' }, [h('span', { class: 'bt-spin' }), ' checking FMCSA…']);
      body = h('div', { class: 'bt-note', style: 'margin-top:6px' }, 'Reading their authority live — usually under a minute. The confirmation email goes out the moment it passes.');
      acts = [remove('Remove')];
    } else if (p.status === 'failed') {
      cls = 'bad'; pill = h('span', { class: 'bt-pill bad' }, '✕ did not pass');
      body = h('div', { class: 'bt-note', style: 'margin-top:6px' }, (p.screen_reason || 'FMCSA shows no active broker authority for this MC.') + ' Check the MC number with the brokerage.');
      acts = [recheck, remove('Remove')];
    } else if (p.status === 'needs_human') {
      cls = 'warn'; pill = h('span', { class: 'bt-pill warn' }, 'FMCSA gave no clear answer');
      body = h('div', { class: 'bt-note', style: 'margin-top:6px' }, (p.screen_reason || '') + ' Our team verifies the authority by hand — you will be notified.');
      acts = [recheck, remove('Remove')];
    } else if (p.status === 'declined') {
      cls = 'bad'; pill = h('span', { class: 'bt-pill bad' }, '✕ said you are not their agent');
      body = h('div', { class: 'bt-note', style: 'margin-top:6px' }, 'Declined ' + when(p.declined_at) + (p.note ? ' — “' + p.note + '”' : '') + '. If this is a mistake, contact hello@loadboot.com with your agent agreement.');
    } else if (p.status === 'revoked') {
      cls = 'muted'; pill = h('span', { class: 'bt-pill muted' }, 'access revoked ' + when(p.revoked_at));
      body = h('div', { class: 'bt-note', style: 'margin-top:6px' }, (p.revoked_by === 'agent' ? 'You left this brokerage.' : 'The brokerage revoked your access.') + ' Open postings under them were cancelled.');
      acts = [remove('Remove from list')];
    }
    return h('div', { class: 'bt-par ' + cls }, [
      h('div', { class: 'h' }, [h('div', null, [h('div', { class: 'n' }, p.name || 'Brokerage'), h('div', { class: 'mc' }, 'MC-' + (p.mc || '?') + (p.on_loadboot ? ' · on LoadBoot' : ''))]), pill, h('div', { class: 'acts' }, acts)]),
      body, note,
    ]);
  }

  // add a brokerage
  const mc = h('input', { class: 'bt-in', placeholder: 'Brokerage MC number', inputmode: 'numeric', style: 'flex:0 1 200px' });
  const co = h('input', { class: 'bt-in', placeholder: 'Brokerage legal name', style: 'flex:1 1 220px' });
  const em = h('input', { class: 'bt-in', placeholder: 'Their ops email on the company domain (optional)', type: 'email', style: 'flex:1 1 260px' });
  const btn = h('button', { class: 'bt-btn' }, live.length ? '+ Add this brokerage →' : 'Check the brokerage →');
  btn.onclick = async () => {
    err.textContent = '';
    const d = digits(mc.value); if (!d) { err.textContent = 'Enter the brokerage’s MC number.'; return; }
    if (!co.value.trim()) { err.textContent = 'Enter the brokerage’s legal name.'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="bt-spin"></span>&nbsp; Checking FMCSA…';
    try { await partnerAgentDeclare(d, co.value.trim(), em.value.trim() || null); await refresh(true); }
    catch (e) { err.textContent = (e && e.message) || 'Could not save.'; btn.disabled = false; btn.textContent = live.length ? '+ Add this brokerage →' : 'Check the brokerage →'; }
  };
  const canAdd = live.length < 10 && st.tier !== 'hold';
  const confirmedN = live.filter((p) => p.status === 'confirmed').length;
  return h('div', { class: 'bt-card' }, [
    h('h3', null, '1 · Post under your brokerage’s authority' + (live.length > 1 ? ' (' + live.length + ' brokerages)' : '')),
    h('div', { class: 'bt-sub' }, 'Agents post under the MC of the brokerage they work for — one or several. We screen each authority live on FMCSA, then that brokerage confirms you: we email its FMCSA-listed address a 6-digit code and a link; they give you the code, you type it here. If the brokerage has a LoadBoot account, its owner approves you there instead. Every load shows their name and MC, and the rate confirmation must be on their paper.' + (confirmedN > 1 ? ' When you post, you pick which brokerage the load goes under.' : '')),
    parents.length ? h('div', null, parents.map(row)) : null,
    canAdd ? h('div', { style: 'margin-top:14px' }, [
      live.length ? h('div', { class: 'bt-note', style: 'font-weight:800;color:#334155;margin-bottom:4px' }, 'Work with another brokerage too? Add it — each one confirms you separately.') : null,
      h('div', { class: 'bt-row' }, [mc, co]),
      h('div', { class: 'bt-row' }, [em, btn]),
      h('div', { class: 'bt-note' }, 'The email is optional and only counts if it is on the same domain as the brokerage’s FMCSA-listed email — a Gmail typed here never confirms anything. Invited by a brokerage from Agents & team? Sign up with the invited email and you are confirmed the moment their MC passes.'),
    ]) : null,
    err,
    (!live.length) ? h('div', { class: 'bt-note' }, ['Have your own broker MC? ', h('a', { href: '#', onClick: (ev) => { ev.preventDefault(); refresh(false, 'own'); } }, 'Screen it instead →')]) : null,
  ]);
}

/* ---------------- agreement card ---------------- */
function agreementCard(st, refresh) {
  const host = h('div', { class: 'bt-card' }, [h('h3', null, '2 · Master Broker Agreement'), h('div', { class: 'bt-sub' }, 'Loading…')]);
  (async () => {
    let a = null; try { a = await currentAgreement('broker_carrier'); } catch (_) {}
    if (!a || !a.available) { mount(host, [h('h3', null, '2 · Master Broker Agreement'), h('div', { class: 'bt-sub' }, 'The agreement text is being finalised — our team will enable this step shortly.')]); return; }
    const accepted = a.accepted || st.agreement_ok;
    const err = h('div', { class: 'bt-err' });
    const btn = h('button', { class: 'bt-btn orange' }, 'I agree — accept v' + a.version);
    btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Recording…'; try { await acceptAgreement('broker_carrier'); await refresh(true); } catch (e) { err.textContent = (e && e.message) || 'Could not record.'; btn.disabled = false; btn.textContent = 'I agree — accept v' + a.version; } };
    mount(host, [
      h('h3', null, '2 · Master Broker Agreement'),
      h('div', { class: 'bt-sub' }, 'One master agreement covers every load you post — the printed rate card (detention, layover, TONU, lumper), request-to-book, GPS proof and the payables procedure. Carriers see these terms on every posting, which is why they book without a phone call.'),
      accepted ? h('div', { style: 'margin-top:12px' }, h('span', { class: 'bt-pill ok' }, '✓ Accepted · ' + (a.title || 'Master Broker Agreement') + ' v' + a.version))
        : h('div', null, [h('div', { class: 'bt-agr' }, a.body_md || ''), h('div', { class: 'bt-row' }, [btn]), err]),
    ]);
  })();
  return host;
}

/* ---------------- posting allowance + packet card ---------------- */
function allowanceCard(st, goPacket, goPost) {
  const lim = st.posting_limit, act = st.active_postings || 0;
  const pct = lim ? Math.min(100, Math.round(act / lim * 100)) : 0;
  const done = st.packet_required_done || 0, tot = st.packet_required_total || 0;
  return h('div', { class: 'bt-card' }, [
    h('h3', null, st.can_post ? '3 · You can post now' : '3 · Posting'),
    h('div', { class: 'bt-sub' }, st.can_post
      ? (lim ? 'Post up to ' + lim + ' open loads' + (st.first_delivered ? ' until your packet is verified.' : ' until your first load delivers, then 10.') + ' Each posting is reviewed by LoadBoot dispatch before it goes live, and carriers book through request-to-book — you approve within 30 minutes.' : 'Unlimited postings. Carriers can book instantly.')
      : (st.reason || 'Finish the steps above to unlock posting.')),
    lim ? h('div', null, [h('div', { class: 'bt-meter' }, h('i', { style: 'width:' + pct + '%' })), h('div', { class: 'bt-note' }, act + ' of ' + lim + ' open postings in use')]) : null,
    h('div', { class: 'bt-row' }, [
      st.can_post ? h('button', { class: 'bt-btn', onClick: goPost }, 'Post a load →') : null,
      h('button', { class: 'bt-btn ghost', onClick: goPacket }, (st.tier === 'verified' ? 'View verified packet' : 'Finish verification packet (' + done + '/' + tot + ')')),
    ]),
    st.tier !== 'verified' ? h('div', { class: 'bt-note' }, '4 · Verification packet — only three things left for you: W-9, bank instructions for payables, and a claims contact. Your authority, bond and BOC-3 were filled in from the FMCSA screen, and the agreement from your click. It lifts the limit, turns on instant booking for carriers and moves your payables inside LoadBoot; nothing in it is needed to post your first loads.') : null,
  ]);
}

/* ---------------- main mount ---------------- */
// opts: { goPacket(), goPost(), onStatus(st) }  — onStatus fires on every refresh so the
// dashboard can unfold the post-load form the moment can_post flips.
export function mountBrokerTrust(host, opts = {}) {
  ensureCss();
  let mode = null; // 'own' | 'agent' — user choice before any screening exists
  let timer = null; let timerMs = 0; let st = null; let alive = true;
  const stop = () => { alive = false; if (timer) clearInterval(timer); };
  const paint = () => {
    if (!st) { mount(host, h('div', { class: 'bt-wrap' }, h('div', { class: 'bt-card' }, h('div', { class: 'bt-sub' }, 'Loading your status…')))); return; }
    const isAgent = st.agent ? true : mode === 'agent';
    const [cls, label] = TIER_LABEL[st.tier] || TIER_LABEL.new;
    const hero = h('div', { class: 'bt-hero' }, [
      h('div', { class: 'bt-hero-k' }, 'Broker onboarding · ' + label),
      h('div', { class: 'bt-hero-t' }, st.tier === 'verified' ? 'You’re fully verified.' : st.can_post ? 'You’re cleared to post.' : st.tier === 'unclaimed' ? 'Authority confirmed — one click left.' : 'Post your first load in minutes — no documents to start.'),
      h('div', { class: 'bt-hero-s' }, st.tier === 'verified' ? 'Unlimited postings, instant booking for carriers, payables inside LoadBoot.' : 'Your authority is read live from FMCSA instead of a PDF you upload. Documents come later, only where they matter — first booking and first payment.'),
      ladder(st),
    ]);
    const first = st.tier === 'hold'
      ? h('div', { class: 'bt-card', style: 'border-left:4px solid #c62828' }, [h('h3', null, 'Posting is on hold'), h('div', { class: 'bt-sub' }, st.hold_reason || 'Contact support.')])
      : (!st.screening && !st.agent && !mode)
        ? h('div', { class: 'bt-card' }, [h('h3', null, '1 · How do you post freight?'), h('div', { class: 'bt-sub' }, 'Both paths are screened live on FMCSA. Pick the one that matches you.'),
            h('div', { class: 'bt-choice' }, [
              h('button', { onClick: () => { mode = 'own'; paint(); } }, [h('div', { class: 't' }, '🏢 I hold my own broker MC'), h('div', { class: 'd' }, 'Licensed property broker with a BMC-84/85 on file. Screened in seconds.')]),
              h('button', { onClick: () => { mode = 'agent'; paint(); } }, [h('div', { class: 't' }, '🤝 I’m an agent of a brokerage'), h('div', { class: 'd' }, 'You post under their authority — one or several brokerages. Each one confirms you with a 6-digit code we email to their FMCSA-listed address.')]),
            ])])
        : isAgent ? agentCard(st, refresh) : screenCard(st, refresh);
    if (st.tier !== 'unclaimed') idNotice = null;
    if (st.tier !== 'unclaimed' && st.tier !== 'agent_pending') otpNotice = null;
    if (!(st.parents || []).length) parNotice = {};
    const identity = (st.tier === 'unclaimed' && !isAgent) ? identityCard(st, refresh) : null;
    mount(host, h('div', { class: 'bt-wrap' }, [hero, first, identity, (st.tier !== 'hold') ? agreementCard(st, refresh) : null, allowanceCard(st, opts.goPacket || (() => {}), opts.goPost || (() => {}))]));
  };
  async function refresh(force, newMode) {
    if (newMode) { mode = newMode; paint(); return; }
    try { const s = await partnerTrustStatus(); if (!alive) return; st = s; } catch (e) { if (!st) { mount(host, h('div', { class: 'bt-card' }, h('div', { class: 'bt-err' }, (e && e.message) || 'Could not load.'))); return; } }
    paint();
    try { opts.onStatus && opts.onStatus(st); } catch (_) {}
    const pending = st && ((st.screening && (st.screening.pending || st.screening.outcome === 'pending')) || (st.parents || []).some((p) => p.status === 'screening'));
    const waiting = st && (st.tier === 'unclaimed' || st.tier === 'agent_pending' || (st.parents || []).some((p) => p.status === 'pending'));
    const want = pending ? 5000 : waiting ? 20000 : 0;
    if (timer && (!want || timerMs !== want)) { clearInterval(timer); timer = null; timerMs = 0; }
    if (want && !timer) { timer = setInterval(() => refresh(true), want); timerMs = want; }
  }
  paint(); refresh(true);
  return { refresh: () => refresh(true), stop, get status() { return st; } };
}

/* ---------------- signup step: run the screening right after registration ---------------- */
// Called by choosePartnerType() after cc_partner_register for brokers. Fire-and-forget:
// the dashboard's trust card picks the result up.
export async function kickoffScreening(kind, mcDigits, agent) {
  if (kind !== 'broker') return;
  try {
    if (agent && agent.parentMc) await partnerAgentDeclare(agent.parentMc, agent.parentCompany || '', agent.contactEmail || null);
    else if (mcDigits) await partnerBrokerScreen(mcDigits, null);
  } catch (_) { /* the trust card shows the reason */ }
}

// Client-side pre-check used by the signup screen (unchanged semantics: a miss warns once).
export async function precheckMc(mcDigits) { try { return await fmcsaVerify({ mc: mcDigits }); } catch (_) { return null; } }
