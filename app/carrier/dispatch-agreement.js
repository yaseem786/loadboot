// Dispatch Service Agreement — carrier sign flow + executed-PDF print.
// Records the signature via cc_carrier_sign_agreement (compliance requirement
// 'dispatch_agreement' -> pending -> Command Center approves in the compliance queue).
import { carrierSignAgreement } from '../shared/api.js';

const REF = 'LB-DSA';
const CLAUSES = [
  ['1. Services', 'Dispatcher (LoadBoot) uses commercial best efforts to source freight, present options, negotiate rates, communicate with brokers/shippers on Carrier’s behalf, and relay Rate Confirmations. No guarantee of any number, lane, or rate of loads.'],
  ['2. Independent contractor', 'Dispatcher is an independent contractor, NOT a licensed broker or freight forwarder, takes no title to freight, and is not liable for cargo loss, damage, or delay. Carrier controls its drivers, equipment and routing.'],
  ['3. Carrier obligations', 'Carrier maintains active USDOT/MC authority, insurance of at least $1,000,000 auto liability and $100,000 cargo, qualified DOT-compliant drivers, and full FMCSA/DOT compliance.'],
  ['4. Limited authorization', 'Carrier authorizes Dispatcher to communicate with brokers and book loads per Carrier’s preferences; each booking is confirmed or auto-booked within pre-approved limits and recorded in LoadBoot. Carrier may revoke before dispatch.'],
  ['5. Dispatch fee & payment', 'Fee: 5% of gross line-haul revenue per load booked through Dispatcher and delivered (e.g. $2,000 → $100; fuel/lumper/detention excluded). Earned on booked+delivered; collected by settlement deduction or invoice per onboarding. Itemized statements; 15-day dispute window; no fee on Carrier-sourced loads; late fees may accrue 1.5%/mo.'],
  ['6. Cancellations / TONU', 'Cancelled loads, TONU, detention and layover follow Dispatcher’s published policies. No fee on a cancelled load unless a TONU/cancellation payment is received.'],
  ['7. Records', 'The LoadBoot platform is the authoritative record for loads, rate confirmations, bookings, consents and fees, and governs any dispute absent clear error.'],
  ['8. Term & termination', 'Effective on acceptance; either party may terminate on 30 days’ notice, or immediately for material breach, loss of authority or lapse of insurance. Earned fees survive.'],
  ['9. Non-circumvention', 'Non-exclusive. For the term + 180 days, Carrier will not circumvent Dispatcher to avoid fees on relationships first introduced by Dispatcher.'],
  ['10. Liability & law', 'Carrier indemnifies Dispatcher for claims from Carrier’s operations. Dispatcher’s liability is capped at fees paid in the prior 3 months; no consequential damages. Texas law; AAA arbitration in Dallas County, TX. ESIGN/UETA consent.'],
];

function clausesHtml() {
  return CLAUSES.map(function (c) { return '<div style="margin:8px 0"><b style="color:#0b1b33">' + c[0] + '.</b> <span style="color:#334155">' + c[1] + '</span></div>'; }).join('');
}

// Open a print window with the fully-executed agreement (carrier signature + date + LoadBoot pre-sign + stamp)
export function printExecutedAgreement(o) {
  o = o || {};
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to download your agreement.'); return; }
  const stamp = o.approved ? 'EXECUTED · CC APPROVED' : 'EXECUTED';
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Dispatch Service Agreement</title>'
    + '<style>*{font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}body{margin:0;color:#0f1e36;padding:28px;max-width:820px;margin:0 auto}'
    + '.lh{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0b1b33;padding-bottom:12px}.lh img{height:28px}.meta{text-align:right;font-size:.72rem;color:#51617a;line-height:1.6}'
    + 'h1{text-align:center;font-size:1.4rem;margin:16px 0 4px}.ref{text-align:center;font-size:.74rem;color:#94a3b8;margin-bottom:12px}'
    + '.rec{font-size:.8rem;color:#334155;line-height:1.6;border-bottom:1px solid #eaf0f7;padding-bottom:10px;margin-bottom:8px}'
    + '.sb{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:24px;border-top:2px solid #eaf0f7;padding-top:16px}'
    + '.lbl{font-size:.7rem;text-transform:uppercase;color:#94a3b8;font-weight:800}.line{border-bottom:1.5px solid #0f1e36;min-height:32px;font-family:cursive;font-size:1.45rem;color:#0b1b33;padding:2px}'
    + '.m{font-size:.72rem;color:#51617a;margin-top:5px;line-height:1.5}.stamp{border:3px solid #12a150;color:#12a150;font-weight:800;display:inline-block;padding:5px 12px;border-radius:8px;transform:rotate(-8deg);letter-spacing:.08em;margin-top:14px}</style></head><body>'
    + '<div class="lh"><img src="/logo-full.png" alt="LoadBoot"><div class="meta">Agreement No. ' + (o.ref || REF) + '<br>hello@loadboot.com · dispatch@loadboot.com</div></div>'
    + '<h1>Dispatch Service Agreement</h1><div class="ref">Ref ' + (o.ref || REF) + ' · Effective on Carrier acceptance</div>'
    + '<div class="rec">Between <b>LoadBoot</b> (“Dispatcher”) and <b>' + (o.carrier || 'Carrier') + '</b>'
    + (o.mc || o.dot ? ', ' + (o.mc ? 'MC ' + o.mc : '') + (o.dot ? ' / USDOT ' + o.dot : '') : '') + ' (“Carrier”). The parties agree to the following in full:</div>'
    + clausesHtml()
    + '<div class="sb"><div><div class="lbl">Dispatcher (pre-signed)</div><div class="line" style="color:#0e7490">LoadBoot</div><div class="m">By: Authorized Signatory, LoadBoot<br>Date: January 15, 2026 (config) · Pre-signed</div></div>'
    + '<div><div class="lbl">Carrier</div><div class="line">' + (o.signer || '') + '</div><div class="m">By: ' + (o.signer || '') + ', Authorized Representative<br>Date: ' + (o.date || '') + '<br>e-signed · timestamp recorded</div></div></div>'
    + '<div style="text-align:center"><span class="stamp">' + stamp + '</span></div>'
    + '</body></html>');
  w.document.close();
  setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
}

// Sign modal — uses the host app's openModal(title, nodes[]) and toast
export function openSignModal(ctx, opts, onSigned) {
  opts = opts || {};
  const mk = function (tag, css, txt) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; };
  const scroll = mk('div', 'max-height:210px;overflow:auto;font-size:.8rem;line-height:1.5;border:1px solid #eaf0f7;border-radius:10px;padding:10px;margin-bottom:8px');
  scroll.innerHTML = '<div style="font-size:.76rem;color:#94a3b8;margin-bottom:6px">Dispatcher (LoadBoot) has pre-signed. Read and countersign below.</div>' + clausesHtml();
  const nm = mk('input', 'width:100%;border:1px solid #eaf0f7;border-radius:10px;padding:10px 11px;font-size:1.05rem;font-family:cursive;margin-top:6px'); nm.placeholder = 'Type your full legal name';
  const dl = mk('label', 'font-size:.72rem;color:#64748b;font-weight:700;display:block;margin-top:8px', 'Date (editable)');
  const dt = mk('input', 'width:100%;border:1px solid #eaf0f7;border-radius:10px;padding:10px 11px;font-size:.9rem;margin-top:3px'); dt.value = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const chkw = mk('label', 'display:flex;gap:8px;align-items:flex-start;font-size:.8rem;margin:10px 0'); const chk = mk('input'); chk.type = 'checkbox';
  const chkt = mk('span', '', 'I am authorized to bind the Carrier, I agree to this Agreement, and I consent to sign electronically (ESIGN/UETA).'); chkw.appendChild(chk); chkw.appendChild(chkt);
  const msg = mk('div', 'color:#e0304a;font-size:.8rem;min-height:1em');
  const btn = mk('button', 'width:100%;background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;border:0;border-radius:12px;padding:12px;font-weight:800;cursor:pointer', 'Sign & execute');
  let close;
  btn.addEventListener('click', async function () {
    msg.textContent = '';
    if (nm.value.trim().length < 3 || !chk.checked) { msg.textContent = 'Enter your full name and check the box.'; return; }
    btn.disabled = true; btn.textContent = 'Signing…';
    try {
      await carrierSignAgreement(nm.value.trim(), dt.value.trim(), REF);
      if (close) close();
      if (ctx.toast) ctx.toast('Signed — sent to the Command Center for approval');
      if (onSigned) onSigned({ signer: nm.value.trim(), date: dt.value.trim() });
    } catch (e) { btn.disabled = false; btn.textContent = 'Sign & execute'; msg.textContent = (e && e.message) || 'Could not sign.'; }
  });
  close = ctx.openModal('Dispatch Service Agreement', [scroll, nm, dl, dt, chkw, msg, btn]);
}
