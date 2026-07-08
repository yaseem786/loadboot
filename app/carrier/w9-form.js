import { attachAddressSuggest } from '../shared/addr-suggest.js';
// W-9 tax setup — Amazon Seller Central-style guided interview + completed-form print.
// Records via cc_carrier_submit_w9 (compliance requirement 'w9' -> pending -> Command
// Center approves). TIN is stored server-side (app_private, RPC-gated) and masked in notes.
import { carrierSubmitW9 } from '../shared/api.js';

const REF = 'LB-W9';
const CLASSES = ['Individual / sole proprietor', 'C Corporation', 'S Corporation', 'Partnership', 'Trust / estate', 'Limited liability company (LLC)'];

function today() { return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }

// ---- Completed W-9 print ----
export function printExecutedW9(o) {
  o = o || {};
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to download your W-9.'); return; }
  const cls = o.classification || '';
  const llc = o.llc_class ? ' (' + o.llc_class + ')' : '';
  const tin = (o.tin || '').replace(/\D/g, '');
  const tinDisp = tin ? tin.replace(/(\d{2})(\d{0,7}).*/, function (m, a, b) { return a + (b ? '-' + b : ''); }) : (o.tin_last4 ? '**-***' + o.tin_last4 : '');
  const stamp = o.approved ? 'COMPLETED · CC APPROVED' : 'COMPLETED';
  const box = function (label, checked) { return '<span style="display:inline-block;margin:2px 10px 2px 0;font-size:.78rem"><span style="display:inline-block;width:13px;height:13px;border:1.5px solid #0f1e36;border-radius:3px;text-align:center;line-height:12px;margin-right:5px;font-weight:800;color:#0b1b33">' + (checked ? '✓' : '') + '</span>' + label + '</span>'; };
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Form W-9 (Request for Taxpayer ID)</title>'
    + '<style>*{font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}body{margin:0;color:#0f1e36;padding:28px;max-width:820px;margin:0 auto}'
    + '.lh{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0b1b33;padding-bottom:12px}.lh img{height:26px}.meta{text-align:right;font-size:.7rem;color:#51617a;line-height:1.6}'
    + 'h1{text-align:center;font-size:1.3rem;margin:14px 0 2px}.ref{text-align:center;font-size:.72rem;color:#94a3b8;margin-bottom:14px}'
    + '.fld{border:1px solid #dbe4ef;border-radius:9px;padding:9px 12px;margin:7px 0}.k{font-size:.64rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-weight:800;display:block;margin-bottom:2px}.v{font-size:.95rem;color:#0b1b33;font-weight:600}'
    + '.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.cert{font-size:.72rem;color:#334155;line-height:1.55;border-top:1px solid #eaf0f7;margin-top:12px;padding-top:10px}'
    + '.sb{display:grid;grid-template-columns:1.4fr 1fr;gap:24px;margin-top:16px;border-top:2px solid #eaf0f7;padding-top:14px}'
    + '.lbl{font-size:.66rem;text-transform:uppercase;color:#94a3b8;font-weight:800}.line{border-bottom:1.5px solid #0f1e36;min-height:30px;font-family:cursive;font-size:1.35rem;color:#0b1b33;padding:2px}'
    + '.m{font-size:.7rem;color:#51617a;margin-top:5px}.stamp{border:3px solid #12a150;color:#12a150;font-weight:800;display:inline-block;padding:5px 12px;border-radius:8px;transform:rotate(-8deg);letter-spacing:.08em;margin-top:14px}</style></head><body>'
    + '<div class="lh"><img src="/logo-full.png" alt="LoadBoot"><div class="meta">Form W-9 · Ref ' + (o.ref || REF) + '<br>Request for Taxpayer Identification Number &amp; Certification</div></div>'
    + '<h1>Form W-9</h1><div class="ref">Substitute W-9 · furnished to LoadBoot as payer · retained on file</div>'
    + '<div class="fld"><span class="k">1 · Name (as shown on your income tax return)</span><span class="v">' + (o.name || o.signer_name || '') + '</span></div>'
    + '<div class="fld"><span class="k">2 · Business name / disregarded entity (if different)</span><span class="v">' + (o.business_name || '—') + '</span></div>'
    + '<div class="fld"><span class="k">3 · Federal tax classification</span><div style="margin-top:4px">'
    + CLASSES.map(function (c) { return box(c, cls === c); }).join('') + (llc ? '<div style="font-size:.75rem;margin-top:4px;color:#334155">LLC tax classification' + llc + '</div>' : '') + '</div></div>'
    + '<div class="two"><div class="fld"><span class="k">5 · Address</span><span class="v">' + (o.address || '') + '</span></div>'
    + '<div class="fld"><span class="k">6 · City, State, ZIP</span><span class="v">' + (o.city_state_zip || '') + '</span></div></div>'
    + '<div class="fld"><span class="k">Part I · Taxpayer Identification Number (TIN)</span><span class="v" style="letter-spacing:.12em">' + (tinDisp || '—') + '</span></div>'
    + '<div class="cert"><b>Part II — Certification.</b> Under penalties of perjury, I certify that: (1) the number shown on this form is my correct taxpayer identification number; (2) I am not subject to backup withholding; (3) I am a U.S. person; and (4) any FATCA code entered is correct. Consent to electronic signature (ESIGN/UETA) recorded.</div>'
    + '<div class="sb"><div><div class="lbl">Signature of U.S. person</div><div class="line">' + (o.signer_name || '') + '</div><div class="m">e-signed · timestamp recorded</div></div>'
    + '<div><div class="lbl">Date</div><div class="line" style="font-size:.95rem;font-family:Inter">' + (o.signed_date || o.date || today()) + '</div></div></div>'
    + '<div style="text-align:center"><span class="stamp">' + stamp + '</span></div>'
    + '</body></html>');
  w.document.close();
  setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
}

// ---- Guided wizard ----
export function openW9Wizard(ctx, opts, onDone) {
  opts = opts || {};
  const mk = function (tag, css, txt) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const inCss = 'width:100%;border:1px solid #eaf0f7;border-radius:11px;padding:11px 12px;font-size:.94rem;background:#fafcff;margin-top:3px';
  const lblCss = 'font-size:.72rem;color:#51617a;font-weight:700;display:block;margin-top:11px';
  const state = { name: opts.carrier || '', business: '', cls: '', llc: 'C = C corporation', address: '', csz: '', tin: '' };

  const root = mk('div');
  // progress
  const bar = mk('div', 'display:flex;gap:6px;margin-bottom:14px');
  const dots = []; for (let i = 0; i < 5; i++) { const d = mk('i', 'height:5px;flex:1;border-radius:99px;background:#e2e8f0'); bar.appendChild(d); dots.push(d); }
  const body = mk('div');
  const msg = mk('div', 'color:#e0304a;font-size:.8rem;min-height:1em;margin-top:8px');
  root.appendChild(bar); root.appendChild(body); root.appendChild(msg);

  let step = 1; let close;
  const setDots = function () { dots.forEach(function (d, i) { d.style.background = i < step ? '#0883F7' : '#e2e8f0'; }); };
  const btnRow = function (backTo, nextFn, nextLabel) {
    const row = mk('div', 'display:flex;gap:8px;margin-top:16px');
    if (backTo) { const b = mk('button', 'flex:1;background:#eef3fb;color:#0b1b33;border:0;border-radius:12px;padding:12px;font-weight:800;cursor:pointer', 'Back'); b.onclick = function () { step = backTo; render(); }; row.appendChild(b); }
    const n = mk('button', 'flex:2;background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;border:0;border-radius:12px;padding:12px;font-weight:800;cursor:pointer', nextLabel || 'Continue'); n.onclick = nextFn; row.appendChild(n);
    return row;
  };
  const head = function (t, s) { const h = mk('div', 'font-size:1.15rem;font-weight:800', t); const sub = mk('div', 'color:#94a3b8;font-size:.8rem;margin:2px 0 4px', s); const wrap = mk('div'); wrap.appendChild(h); wrap.appendChild(sub); return wrap; };

  function render() {
    setDots(); body.innerHTML = ''; msg.textContent = '';
    if (step === 1) {
      body.appendChild(head('Start your W-9', 'Step 1 of 5 — Tax identity. Enter your name exactly as on your tax return.'));
      const l1 = mk('label', lblCss, 'Name (as shown on your income tax return)'); const nm = mk('input', inCss); nm.value = state.name;
      const l2 = mk('label', lblCss, 'Business name / DBA (if different)'); const bz = mk('input', inCss); bz.value = state.business; bz.placeholder = 'Optional';
      body.appendChild(l1); body.appendChild(nm); body.appendChild(l2); body.appendChild(bz);
      body.appendChild(btnRow(0, function () { if (nm.value.trim().length < 2) { msg.textContent = 'Enter your legal name.'; return; } state.name = nm.value.trim(); state.business = bz.value.trim(); step = 2; render(); }));
    } else if (step === 2) {
      body.appendChild(head('Federal tax classification', 'Step 2 of 5 — Choose the one that matches your IRS filing.'));
      const l = mk('label', lblCss, 'Classification'); const sel = mk('select', inCss);
      sel.appendChild(mk('option', '', 'Select…'));
      CLASSES.forEach(function (c) { const o = mk('option', '', c); o.value = c; if (state.cls === c) o.selected = true; sel.appendChild(o); });
      const llcWrap = mk('div', state.cls.indexOf('LLC') >= 0 ? '' : 'display:none');
      const ll = mk('label', lblCss, 'LLC tax classification'); const lsel = mk('select', inCss);
      ['C = C corporation', 'S = S corporation', 'P = Partnership'].forEach(function (x) { const o = mk('option', '', x); o.value = x; if (state.llc === x) o.selected = true; lsel.appendChild(o); });
      llcWrap.appendChild(ll); llcWrap.appendChild(lsel);
      // Plain-language hints — truck drivers should never need a CPA to pick this.
      const HINTS = {
        'Individual / sole proprietor': '\u2705 Most single-truck owner-operators pick THIS. You run the business under your own name (or a DBA) \u2014 no separate company, or a single-member LLC taxed as yourself.',
        'C corporation': 'Your company files its OWN corporate tax return (Form 1120). Rare for small carriers \u2014 pick only if your accountant set this up.',
        'S corporation': 'Your company elected S-corp status with the IRS (Form 2553) \u2014 common for established small fleets that pay the owner a salary.',
        'Partnership': 'Two or more owners legally share the business and its profits.',
        'Trust / estate': 'Rare \u2014 only if the business is owned by a trust or an estate.',
        'Limited liability company (LLC)': 'Your company is registered as an LLC with the state. You will also pick how the IRS taxes it below \u2014 it is on your IRS election letter, or ask whoever files your taxes. (Single-owner LLC with no election? Choose \u201cIndividual / sole proprietor\u201d above instead.)'
      };
      const hint = mk('div', 'background:#f0f7ff;border:1px solid #d6e8ff;border-radius:11px;padding:10px 12px;font-size:.78rem;line-height:1.55;color:#2b5f93;margin-top:8px', 'Not sure? It\u2019s written on your last tax return \u2014 or ask whoever files your taxes. Most owner-operators are \u201cIndividual / sole proprietor\u201d.');
      const setHint = function () { hint.textContent = HINTS[sel.value] || 'Not sure? It\u2019s written on your last tax return \u2014 or ask whoever files your taxes. Most owner-operators are \u201cIndividual / sole proprietor\u201d.'; };
      if (state.cls) setHint();
      sel.onchange = function () { llcWrap.style.display = sel.value.indexOf('LLC') >= 0 ? '' : 'none'; setHint(); };
      body.appendChild(l); body.appendChild(sel); body.appendChild(hint); body.appendChild(llcWrap);
      body.appendChild(btnRow(1, function () { if (!sel.value) { msg.textContent = 'Pick a classification.'; return; } state.cls = sel.value; state.llc = lsel.value; step = 3; render(); }));
    } else if (step === 3) {
      body.appendChild(head('Address', 'Step 3 of 5 — Where the IRS should mail correspondence.'));
      const l1 = mk('label', lblCss, 'Street address'); const a = mk('input', inCss); a.value = state.address; a.placeholder = '1200 Trucker Way';
      const l2 = mk('label', lblCss, 'City, State, ZIP'); const cz = mk('input', inCss); cz.value = state.csz; cz.placeholder = 'Dallas, TX 75201';
      body.appendChild(l1); body.appendChild(a); body.appendChild(l2); body.appendChild(cz);
      try { attachAddressSuggest(a, { onPick: function (r) { a.value = r.street; if (r.tail) cz.value = r.tail; } }); } catch (_) {}
      body.appendChild(btnRow(2, function () { if (a.value.trim().length < 3 || cz.value.trim().length < 3) { msg.textContent = 'Enter your full address.'; return; } state.address = a.value.trim(); state.csz = cz.value.trim(); step = 4; render(); }));
    } else if (step === 4) {
      body.appendChild(head('Taxpayer ID (TIN)', 'Step 4 of 5 — Businesses use an EIN; sole proprietors may use SSN or EIN.'));
      const l = mk('label', lblCss, 'EIN (or SSN for sole proprietor)'); const t = mk('input', inCss); t.value = state.tin; t.placeholder = '12-3456789'; t.setAttribute('inputmode', 'numeric');
      const lock = mk('div', 'font-size:.72rem;color:#12a150;font-weight:700;margin-top:8px', '🔒 Stored securely & masked — only the last 4 digits appear in review; the full number is used solely for your W-9.');
      body.appendChild(l); body.appendChild(t); body.appendChild(lock);
      body.appendChild(btnRow(3, function () { const digits = t.value.replace(/\D/g, ''); if (digits.length !== 9) { msg.textContent = 'Enter a valid 9-digit EIN or SSN.'; return; } state.tin = t.value.trim(); step = 5; render(); }));
    } else if (step === 5) {
      body.appendChild(head('Certify & sign', 'Step 5 of 5 — Review, certify, and e-sign (IRS W-9 certification).'));
      const rev = mk('div', 'background:#f7fbff;border:1px solid #d6e8ff;border-radius:12px;padding:11px;font-size:.82rem;line-height:1.8;margin-top:4px;color:#0f1e36');
      const digits = state.tin.replace(/\D/g, '');
      rev.innerHTML = '<div><b>Name:</b> ' + state.name + '</div><div><b>Classification:</b> ' + state.cls + (state.cls.indexOf('LLC') >= 0 ? ' (' + state.llc + ')' : '') + '</div><div><b>Address:</b> ' + state.address + ', ' + state.csz + '</div><div><b>TIN:</b> ••-•••' + digits.slice(-4) + '</div>';
      body.appendChild(rev);
      const c1w = mk('label', 'display:flex;gap:9px;align-items:flex-start;font-size:.8rem;margin:11px 0'); const c1 = mk('input'); c1.type = 'checkbox'; c1w.appendChild(c1); c1w.appendChild(mk('span', '', 'Under penalties of perjury, the TIN shown is correct, I am a U.S. person, and I am not subject to backup withholding.'));
      const c2w = mk('label', 'display:flex;gap:9px;align-items:flex-start;font-size:.8rem;margin:6px 0'); const c2 = mk('input'); c2.type = 'checkbox'; c2w.appendChild(c2); c2w.appendChild(mk('span', '', 'I consent to sign this W-9 electronically (ESIGN/UETA).'));
      const ls = mk('label', lblCss, 'Type your full legal name to sign'); const sig = mk('input', inCss + ';font-family:cursive;font-size:1.1rem'); sig.placeholder = 'Your full name';
      body.appendChild(c1w); body.appendChild(c2w); body.appendChild(ls); body.appendChild(sig);
      const btn = mk('button', 'width:100%;background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;border:0;border-radius:12px;padding:13px;font-weight:800;cursor:pointer;margin-top:14px', 'Sign & submit W-9');
      const back = mk('button', 'width:100%;background:#eef3fb;color:#0b1b33;border:0;border-radius:12px;padding:11px;font-weight:800;cursor:pointer;margin-top:8px', 'Back'); back.onclick = function () { step = 4; render(); };
      btn.onclick = async function () {
        if (!c1.checked || !c2.checked) { msg.textContent = 'Please certify both boxes.'; return; }
        if (sig.value.trim().length < 3) { msg.textContent = 'Type your full name to sign.'; return; }
        btn.disabled = true; btn.textContent = 'Submitting…';
        try {
          await carrierSubmitW9({ name: state.name, business_name: state.business, classification: state.cls, llc_class: state.cls.indexOf('LLC') >= 0 ? state.llc : '', address: state.address, city_state_zip: state.csz, tin: state.tin, signer_name: sig.value.trim(), signed_date: today(), ref: REF });
          if (close) close();
          if (ctx.toast) ctx.toast('W-9 completed — sent to the Command Center for review');
          if (onDone) onDone();
        } catch (e) { btn.disabled = false; btn.textContent = 'Sign & submit W-9'; msg.textContent = (e && e.message) || 'Could not submit your W-9.'; }
      };
      body.appendChild(btn); body.appendChild(back);
    }
  }
  render();
  close = ctx.openModal('W-9 tax setup', [root]);
}
