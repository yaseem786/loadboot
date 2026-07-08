// Dispatch Service Agreement — carrier sign flow + executed-PDF print.
// Records the signature via cc_carrier_sign_agreement (compliance requirement
// 'dispatch_agreement' -> pending -> Command Center approves in the compliance queue).
import { carrierSignAgreement, carrierAgreementSignature } from '../shared/api.js';

const REF = 'LB-DSA';
const CLAUSES = [
  ['1. Services', 'Dispatcher (LoadBoot) uses commercial best efforts to source freight, present load options, negotiate rates, communicate with brokers/shippers on Carrier\u2019s behalf, relay Rate Confirmations, and provide booking, paperwork and settlement support through the LoadBoot platform. Dispatcher does not guarantee any number, lane, frequency or rate of loads.'],
  ['2. Independent contractor \u2014 not a broker', 'Dispatcher is an independent contractor and is NOT a licensed freight broker, freight forwarder or motor carrier. Dispatcher takes no possession of or title to freight and is not liable for cargo loss, damage or delay. Nothing here creates an employment, agency, partnership or joint-venture relationship. Carrier at all times controls its drivers, equipment, routing and operations.'],
  ['3. Carrier authority & compliance', 'Carrier represents that it holds active USDOT/MC operating authority, employs qualified, properly licensed DOT-compliant drivers, and operates in full compliance with FMCSA/DOT regulations, including hours-of-service, drug & alcohol testing, ELD and vehicle maintenance requirements. Carrier will notify Dispatcher within 24 hours of any authority revocation, out-of-service order or insurance lapse.'],
  ['4. Insurance', 'Carrier maintains, at its own cost: auto liability of at least $1,000,000, cargo insurance of at least $100,000, and any workers\u2019 compensation cover required by law. Hazmat operations require hazmat-level liability cover and active PHMSA registration before any hazmat load is dispatched. Carrier will provide certificates of insurance on request and ensure Dispatcher receives notice of cancellation or material change.'],
  ['5. Limited authorization', 'Carrier authorizes Dispatcher to communicate with brokers and shippers and to book loads consistent with Carrier\u2019s stated dispatch preferences (minimum rate, equipment, lanes, radius). Each booking is either confirmed by Carrier or auto-booked within Carrier\u2019s pre-approved limits, and every booking is recorded in the LoadBoot platform. Carrier may revoke a booking authorization at any time before dispatch.'],
  ['6. Communications & privacy', 'All operational communication between Carrier, Dispatcher and brokers runs through the LoadBoot platform, which protects Carrier\u2019s contact identity from counterparties. Carrier agrees to keep platform contact details current and to respond promptly to dispatch messages regarding active loads.'],
  ['7. Dispatch fee', 'Fee: 5% of gross line-haul revenue per load booked through Dispatcher and delivered (e.g. $2,000 line-haul \u2192 $100). Fuel surcharges, lumper, detention, layover and TONU payments are excluded from the fee base. The fee is earned when a load is booked and delivered, and is collected by settlement deduction or invoice as selected at onboarding. No fee applies to loads Carrier sources itself.'],
  ['8. Statements, disputes & late payment', 'Dispatcher provides itemized fee statements in the platform. Carrier has a 15-day window from statement date to dispute any line item; undisputed amounts are payable per the statement terms and late amounts may accrue 1.5% per month or the maximum lawful rate, whichever is lower.'],
  ['9. Cancellations, TONU & accessorials', 'Cancelled loads, TONU, detention and layover follow Dispatcher\u2019s published policies as shown on the platform at booking time. No dispatch fee is charged on a cancelled load unless a TONU or cancellation payment is actually received by Carrier.'],
  ['10. Platform records', 'The LoadBoot platform is the authoritative system of record for loads, rate confirmations, bookings, communications, consents, signatures and fees, and its records govern any dispute absent demonstrable error.'],
  ['11. Platform license & data', 'Dispatcher grants Carrier a limited, revocable, non-transferable license to use the LoadBoot platform for its own dispatch operations. Carrier will keep login credentials secure, will not share accounts, scrape data, or use platform data to build a competing service. Carrier\u2019s operational data is handled per the LoadBoot Privacy Policy.'],
  ['12. Confidentiality', 'Each party keeps the other\u2019s non-public business information confidential \u2014 including rates, broker relationships, load history and settlement terms \u2014 and uses it only to perform this Agreement. This obligation survives termination for 2 years.'],
  ['13. Non-circumvention', 'This Agreement is non-exclusive. However, during the term and for 180 days after, Carrier will not bypass Dispatcher to book directly with brokers, shippers or facilities first introduced by Dispatcher in order to avoid fees on those relationships.'],
  ['14. Term & termination', 'Effective on Carrier\u2019s electronic acceptance. Either party may terminate with 30 days\u2019 written notice, or immediately upon material breach, loss of operating authority, or lapse of required insurance. Fees earned before termination survive, as do Sections 10\u201313 and 15.'],
  ['15. Indemnity, liability & disputes', 'Carrier indemnifies and holds Dispatcher harmless from claims arising out of Carrier\u2019s operations, drivers, equipment or cargo. Dispatcher\u2019s total liability is capped at the fees Carrier paid in the 3 months before the claim; neither party is liable for consequential or punitive damages. This Agreement is governed by Texas law; disputes go to binding AAA arbitration in Dallas County, TX, each party bearing its own costs.'],
  ['16. Force majeure', 'Neither party is liable for delay or failure caused by events beyond its reasonable control (weather, road closures, government action, outages), provided it resumes performance promptly.'],
  ['17. General', 'Notices go to the addresses/emails on file in the platform. This Agreement plus platform-published policies form the entire agreement and replace prior discussions; amendments require both parties\u2019 written (including electronic) consent; if any clause is unenforceable the rest stands; Carrier may not assign without Dispatcher\u2019s consent.'],
  ['18. Electronic signature', 'Both parties consent to contract electronically (ESIGN/UETA). Carrier\u2019s typed signature below has the same force as a handwritten signature, and Carrier confirms the signer is authorized to bind the Carrier.'],
];

function clausesHtml() {
  return CLAUSES.map(function (c) { return '<div style="margin:11px 0"><div style="color:#0b1b33;font-weight:800;font-size:.8rem;letter-spacing:.01em;margin-bottom:2px">' + c[0] + '</div><div style="color:#3c4c66;text-align:justify">' + c[1] + '</div></div>'; }).join('');
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
  const scroll = mk('div', 'max-height:300px;overflow:auto;font-size:.8rem;line-height:1.55;border:1px solid #eaf0f7;border-radius:12px;padding:16px 18px;margin-bottom:8px;background:#fff;color:#334155;box-shadow:inset 0 -14px 18px -16px rgba(2,12,30,.18)');
  scroll.innerHTML = '<div style="text-align:center;border-bottom:2.5px solid #0b1b33;padding-bottom:10px;margin-bottom:10px">'
    + '<div style="font-weight:800;font-size:1.02rem;color:#0b1b33;letter-spacing:.02em">DISPATCH SERVICE AGREEMENT</div>'
    + '<div style="font-size:.68rem;color:#94a3b8;margin-top:3px;letter-spacing:.06em">' + REF + ' \u00b7 v2 \u00b7 ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '</div></div>'
    + '<div style="display:flex;gap:10px;margin-bottom:10px">'
    + '<div style="flex:1;background:#f7fbff;border:1px solid #e3eefc;border-radius:9px;padding:8px 10px"><div style="font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">Dispatcher</div><div style="font-weight:700;color:#0b1b33;font-size:.8rem">LoadBoot</div><div style="font-size:.66rem;color:#12a150;font-weight:700">\u2713 Pre-signed</div></div>'
    + '<div style="flex:1;background:#fffdf5;border:1px solid #f5e9c8;border-radius:9px;padding:8px 10px"><div style="font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">Carrier</div><div style="font-weight:700;color:#0b1b33;font-size:.8rem">You</div><div style="font-size:.66rem;color:#b45309;font-weight:700">\u270e Countersign below</div></div></div>'
    + clausesHtml()
    + '<div style="display:flex;gap:14px;margin-top:14px;padding-top:12px;border-top:1.5px solid #eaf0f7">'
    +   '<div style="flex:1"><div style="font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">Dispatcher (pre-signed)</div><div style="font-family:cursive;font-size:1.25rem;color:#0e7490;border-bottom:1.5px solid #0f1e36;padding:2px 0">LoadBoot</div><div style="font-size:.64rem;color:#94a3b8;margin-top:3px">Authorized Signatory, LoadBoot</div></div>'
    +   '<div style="flex:1"><div style="font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">Carrier</div><div id="lb-agr-csig" style="border-bottom:1.5px dashed #b45309;min-height:28px;color:#b45309;font-size:.72rem;padding-top:8px">countersign in the field below \u2193</div><div id="lb-agr-cmeta" style="font-size:.64rem;color:#94a3b8;margin-top:3px"></div></div>'
    + '</div>'
    + '<div style="margin-top:10px;font-size:.68rem;color:#94a3b8;text-align:center">Executes immediately on your signature \u2014 LoadBoot has already signed. A copy stays in Account \u2192 Legal & policies.</div>';
  (async () => { try { const sig = await carrierAgreementSignature();
    if (sig && sig.signer_name) {
      const csig = scroll.querySelector('#lb-agr-csig');
      if (csig) { csig.style.cssText = 'font-family:cursive;font-size:1.3rem;color:#0b1b33;border-bottom:1.5px solid #0f1e36;padding:2px 0;min-height:28px'; csig.textContent = sig.signer_name; }
      const cmeta = scroll.querySelector('#lb-agr-cmeta');
      if (cmeta) cmeta.textContent = 'Signed' + (sig.signed_date ? ' \u00b7 ' + sig.signed_date : '') + ' \u00b7 e-signature on record';
      if (nm && !nm.value) nm.value = sig.signer_name;
    } } catch (_) {} })();
  const nm = mk('input', 'width:100%;border:1px solid #eaf0f7;border-radius:10px;padding:10px 11px;font-size:1.05rem;font-family:cursive;margin-top:6px;background:#fff;color:#0f1e36'); nm.placeholder = 'Type your full legal name';
  const dl = mk('label', 'font-size:.72rem;color:#64748b;font-weight:700;display:block;margin-top:8px', 'Date (editable)');
  const dt = mk('input', 'width:100%;border:1px solid #eaf0f7;border-radius:10px;padding:10px 11px;font-size:.9rem;margin-top:3px;background:#fff;color:#0f1e36'); dt.value = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
      if (ctx.toast) ctx.toast('Agreement executed \u2713 \u2014 download any time from Account \u2192 Legal & policies');
      if (onSigned) onSigned({ signer: nm.value.trim(), date: dt.value.trim() });
    } catch (e) { btn.disabled = false; btn.textContent = 'Sign & execute'; msg.textContent = (e && e.message) || 'Could not sign.'; }
  });
  close = ctx.openModal('Dispatch Service Agreement', [scroll, nm, dl, dt, chkw, msg, btn]);
}
