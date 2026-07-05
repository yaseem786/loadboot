// Premium Account & Settings — the LOCKED design ported into the live carrier app.
// Renders hero + metric strip + sub-tab nav + rich section cards, wired to real data.
import { openSignModal, printExecutedAgreement } from './dispatch-agreement.js';
import { accountHealth, pocketCompliance, getDispatchPrefs, setDispatchPrefs, pocketGetPreferences, pocketSavePreferences, myPaymentProfile, setMyPaymentProfile, myTrustProfile, carrierRequestReverify, carrierAgreementSignature } from '../shared/api.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function renderPremiumAccount(host, ctx) {
  ctx = ctx || {};
  const ov = ctx.ov || {};
  const user = ctx.user || {};
  host.innerHTML = '<div class="acx"><div style="padding:40px;text-align:center;color:#9aa7bd">Loading your account…</div></div>';

  const [health, comp, prefs, pay, trust] = await Promise.all([
    accountHealth().catch(() => null),
    pocketCompliance().catch(() => ({ requirements: [] })),
    pocketGetPreferences().catch(() => ({})),
    myPaymentProfile().catch(() => null),
    myTrustProfile().catch(() => null),
  ]);

  const reqs = (comp && comp.requirements) || [];
  const totalDocs = reqs.length || 0;
  const okDocs = reqs.filter((r) => String(r.status || '').toLowerCase() === 'valid').length;
  const agrReq = reqs.find((r) => /dispatch service agreement|dispatch_agreement/i.test(r.name || '')) || null;
  const agrStatus = agrReq ? String(agrReq.status || 'missing').toLowerCase() : 'missing';
  const healthScore = health && health.score != null ? String(health.score) : '—';
  const rating = trust && trust.rating != null ? (Number(trust.rating).toFixed(1) + '★') : (trust && trust.verified ? 'Verified' : 'New');
  const name = ov.carrier || (comp && comp.carrier) || 'Your company';
  const email = user.email || '';
  const um = (user && user.user_metadata) || {};
  const contactName = um.name || user.name || '';
  const phoneVal = um.phone || ov.phone || '';
  const initials = (name.trim().replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || 'C').toUpperCase();
  const compliant = !!ov.compliance_ok;
  const mc = ov.mc_number || ov.mc || '';
  const dot = ov.dot_number || ov.usdot || ov.dot || '';
  const wknet = ov.week_net != null ? ('$' + Number(ov.week_net).toLocaleString()) : '—';
  const sub = ['Owner-operator', mc ? ('MC ' + mc) : null, dot ? ('DOT ' + dot) : null].filter(Boolean).join(' · ');

  const docHtml = reqs.map((r) => {
    const st = String(r.status || '').toLowerCase();
    let di, pill, rs;
    if (st === 'valid') { di = '<div class="di ok">&#10003;</div>'; pill = '<span class="pill p-green">Approved</span>'; rs = r.expiry_date ? ('Verified · valid to ' + esc(r.expiry_date)) : 'Verified'; }
    else if (st === 'pending' || st === 'in_review' || st === 'review' || st === 'submitted') { di = '<div class="di rev">&#9200;</div>'; pill = '<span class="pill p-blue">In review</span>'; rs = 'Submitted · Command Center reviewing'; }
    else if (!r.mandatory) { di = '<div class="di req" style="background:#f1f5fb;color:#64748b">&ndash;</div>'; pill = '<span class="pill p-gray">Optional</span>'; rs = 'Recommended'; }
    else { di = '<div class="di req">!</div>'; pill = '<span class="pill p-red">Action</span>'; rs = st === 'expired' ? 'Expired — please re-upload' : 'Required — not on file'; }
    return '<div class="doc">' + di + '<div style="flex:1"><div class="rt">' + esc(r.name) + '</div><div class="rs">' + rs + '</div></div>' + pill + '</div>';
  }).join('') || '<div class="mini">No documents on file yet.</div>';

  const ringOff = totalDocs ? (100 - (okDocs / totalDocs * 100)) : 100;
  const vpill = compliant
    ? '<div class="vpill"><span class="gdot"></span> VERIFIED — BOOKING OPEN</div>'
    : '<div class="vpill" style="background:linear-gradient(90deg,rgba(217,119,6,.28),rgba(217,119,6,.12));color:#fcd34d;border-color:rgba(217,119,6,.4)"><span class="gdot" style="background:#fbbf24;box-shadow:0 0 0 4px rgba(251,191,36,.25)"></span> PENDING VERIFICATION</div>';

  const dp = (await getDispatchPrefs().catch(() => ({}))) || {};
  const eqSel = (v) => ['Dry Van', 'Reefer', 'Flatbed', 'Power Only'].map((o) => '<option' + ((dp.preferred_equipment || []).indexOf(o) >= 0 ? ' selected' : '') + '>' + o + '</option>').join('');

  host.innerHTML = ''
    + '<div class="acx">'
    + '<div class="hero"><div class="glow g1"></div><div class="glow g2"></div>'
    +   '<div class="brandrow"><img src="/logo-full-dark.png" alt="LoadBoot" style="height:24px;filter:drop-shadow(0 3px 8px rgba(0,0,0,.35))"><div class="glass"><span class="gdot"></span> Online</div></div>'
    +   '<div class="profrow"><div class="ava" id="acx-ava">' + esc(initials) + '<div class="cam" id="acx-cam">&#9998;</div></div>'
    +     '<div><div class="pname">' + esc(name) + '</div><div class="psub">' + esc(sub || 'Owner-operator') + '</div>' + vpill + '</div></div>'
    + '</div>'
    + '<div class="mstrip">'
    +   '<div class="m"><div class="v">' + esc(healthScore) + '</div><div class="l">Health</div></div>'
    +   '<div class="m"><div class="v">' + esc(rating) + '</div><div class="l">Rating</div></div>'
    +   '<div class="m"><div class="v">' + okDocs + '/' + totalDocs + '</div><div class="l">Docs</div></div>'
    +   '<div class="m"><div class="v">' + esc(wknet) + '</div><div class="l">Wk net</div></div>'
    + '</div>'
    + '<div class="nav" id="acx-nav">'
    +   ['Profile:s-profile', 'Verification:s-verify', 'Business:s-biz', 'Dispatch:s-disp', 'Security:s-sec', 'Alerts:s-notif', 'Payments:s-pay', 'Support:s-support'].map((p, i) => { const a = p.split(':'); return '<div class="chip' + (i === 0 ? ' on' : '') + '" data-t="' + a[1] + '">' + a[0] + '</div>'; }).join('')
    + '</div>'
    + '<div class="body">'
    + '<div class="card" id="s-profile"><div class="sec-h" style="align-items:center"><div class="sec-ico ic-blue">&#128100;</div><div class="sec-t">Profile</div>' + (contactName ? '<span class="cpa-autopill">&#10003; from sign-up</span>' : '') + '</div><div class="sec-s">Auto-filled from your sign-up \u2014 change anytime.</div>'
    +   '<div class="field"><label>Display name</label><input id="acx-dname" value="' + esc(name) + '"></div>'
    +   '<div class="grid2"><div class="field"><label>Contact name</label><input value="' + esc(contactName) + '"></div><div class="field"><label>Phone' + (phoneVal ? '' : ' <span style=\"color:#d97706;font-size:.66rem;font-weight:800\">\u00b7 recommended</span>') + '</label><input value="' + esc(phoneVal) + '" placeholder="(555) 000-0000"></div></div>'
    +   '<div style="margin-top:13px;display:flex;gap:8px"><button class="btn sm" data-toast="Profile saved">Save changes</button><button class="btn sec sm" id="acx-photo">Change photo</button></div>'
    +   '<input type="file" id="acx-avafile" accept="image/*" hidden></div>'
    + '<div class="card" id="s-verify"><div class="sec-h"><div class="sec-ico ic-green">&#128737;</div><div class="sec-t">Verification &amp; documents</div></div><div class="sec-s">Same live status as the Documents tab — one source of truth.</div>'
    +   '<div class="ringwrap"><svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="#e3ecf6" stroke-width="3.6"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="#12a150" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset="' + ringOff.toFixed(1) + '" transform="rotate(-90 18 18)"/><text x="18" y="17" text-anchor="middle" font-size="8" font-weight="800" fill="#0b1b33">' + okDocs + '/' + totalDocs + '</text><text x="18" y="24" text-anchor="middle" font-size="3.4" fill="#9aa7bd">verified</text></svg>'
    +     '<div><div style="font-weight:800;font-size:.98rem">Compliance packet</div><div class="mini">' + (totalDocs - okDocs > 0 ? (totalDocs - okDocs) + ' item(s) still need attention' : 'All required documents verified') + '</div></div></div>'
    +   '<div>' + docHtml + '</div>'
    +   '<div style="margin-top:12px"><button class="btn sm" data-go="documents">Open Documents</button></div>'
    +   '<div class="hint">Uploading moves an item to <b>In review</b>; the Command Center approves it and every screen updates together.</div></div>'
    + '<div class="card" id="s-biz"><div class="sec-h" style="align-items:center"><div class="sec-ico ic-navy">&#127970;</div><div class="sec-t">Business profile</div>' + (compliant ? '<span class="cpa-autopill">&#10003; verified</span>' : '') + '</div><div class="sec-s">Legal identity from your approved authority &amp; W-9. Changing a verified detail re-opens review.</div>'
    +   '<div class="grid2"><div class="field"><label>Legal entity</label><input class="acx-cred" id="acx-entity" value="' + esc(name) + '" readonly></div><div class="field"><label>Entity type</label><select id="acx-etype"><option>LLC</option><option>Sole proprietor</option><option>Corporation</option></select></div>'
    +   '<div class="field"><label>MC number</label><input class="acx-cred" id="acx-mc" value="' + esc(mc) + '" placeholder="MC-000000" readonly></div><div class="field"><label>USDOT</label><input class="acx-cred" id="acx-dot" value="' + esc(dot) + '" placeholder="0000000" readonly></div></div>'
    +   '<div class="field"><label>Business address <span style="color:#94a3b8;font-size:.66rem">&middot; freely editable</span></label><input id="acx-addr" value="' + esc(ov.address || '') + '" placeholder="Street, City, ST ZIP"></div>'
    +   '<div id="acx-bizmsg" class="cp-row-s" style="margin-top:8px"></div>'
    +   '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn ghost sm" id="acx-bizchange">Change verified details</button><button class="btn sm" id="acx-bizsave">Save</button></div></div>'
    + '<div class="card" id="s-disp"><div class="sec-h"><div class="sec-ico ic-orange">&#128667;</div><div class="sec-t">Dispatch preferences</div></div><div class="sec-s">Drives the load-matching engine — better in, better loads.</div>'
    +   '<div class="grid2"><div class="field"><label>Equipment</label><select id="acx-eq">' + eqSel() + '</select></div><div class="field"><label>Home base</label><input id="acx-home" value="' + esc(dp.home_base || '') + '"></div>'
    +   '<div class="field"><label>Min rate ($/mi)</label><input id="acx-minrpm" value="' + esc(dp.min_rpm || '') + '"></div><div class="field"><label>Max deadhead (mi)</label><input id="acx-dead" value="' + esc(dp.max_deadhead_miles || '') + '"></div><div class="field"><label>Target rate ($/mi)</label><input id="acx-target" value="' + esc(dp.target_rpm || '') + '"></div><div class="field"><label>Max weight (lbs)</label><input id="acx-weight" value="' + esc(dp.max_weight_lbs || '') + '"></div></div>'
    +   '<div class="field"><label>Preferred lanes</label><input id="acx-lanes" value="' + esc((dp.preferred_lanes || []).join(', ')) + '"></div>'
    +   '<div class="grid2"><div class="field"><label>Shortest trip (mi)</label><input id="acx-tripmin" value="' + esc(dp.min_trip_miles || '') + '"></div><div class="field"><label>Longest trip (mi)</label><input id="acx-tripmax" value="' + esc(dp.max_trip_miles || '') + '"></div></div>'
    +   '<div class="grid2"><div class="field"><label>Min notice (hrs)</label><input id="acx-notice" value="' + esc(dp.min_notice_hours || '') + '"></div><div class="field"><label>Avoid states</label><input id="acx-avoid" value="' + esc((dp.avoid_states || []).join(', ')) + '"></div></div>'
    +   '<div class="row"><div><div class="rt">Haul hazmat</div><div class="rs">Requires endorsement on file</div></div><div class="tg' + (dp.hazmat ? ' on' : '') + '" id="acx-haz"></div></div>'
    +   '<div class="row"><div><div class="rt">Team drivers</div><div class="rs">Two drivers, longer runs</div></div><div class="tg' + (dp.team_drivers ? ' on' : '') + '" id="acx-team"></div></div>'
    +   '<div class="row"><div><div class="rt">Available weekends</div><div class="rs">Include Sat/Sun loads</div></div><div class="tg' + (dp.weekend_ok !== false ? ' on' : '') + '" id="acx-wknd"></div></div>'
    +   '<div class="hint" style="margin-top:10px;background:#f0f7ff;border:1px solid #d6e8ff;color:#2b5f93;border-radius:11px;padding:9px 12px;font-size:.75rem">More detail = sharper, better-paying matches. Blank fields never hurt your account \u2014 they just mean broader matching.</div>'
    +   '<div style="margin-top:12px"><button class="btn sm" id="acx-savedisp">Save preferences</button></div></div>'
    + '<div class="card" id="s-sec"><div class="sec-h"><div class="sec-ico ic-violet">&#128274;</div><div class="sec-t">Security &amp; sign-in</div></div><div class="sec-s">Protect your account and your money.</div>'
    +   '<div class="row"><div style="min-width:0;flex:1"><div class="rt">Email address</div><div class="rs" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(email) + '</div></div><button class="btn ghost sm" style="flex:none" data-toast="To change your sign-in email, contact support — it protects your payouts">Change</button></div>'
    +   '<div class="row"><div><div class="rt">Password</div><div class="rs">Keep it strong and private</div></div><button class="btn ghost sm" id="acx-pw">Reset</button></div>'
    +   '<div class="row"><div><div class="rt">Active sessions</div><div class="rs">Sign out everywhere</div></div><button class="btn ghost sm" id="acx-signout">Sign out</button></div></div>'
    + '<div class="card" id="s-notif"><div class="sec-h"><div class="sec-ico ic-blue">&#128276;</div><div class="sec-t">Notifications</div></div><div class="sec-s">Operational alerts always reach you; the rest are optional.</div>'
    +   '<div class="row"><div><div class="rt">Load offers</div><div class="rs">Matching loads on your lanes</div></div><div class="tg' + (prefs.load_offers !== false ? ' on' : '') + '" data-pref="load_offers"></div></div>'
    +   '<div class="row"><div><div class="rt">Weekly summary</div><div class="rs">Your earnings digest</div></div><div class="tg' + (prefs.weekly_summaries !== false ? ' on' : '') + '" data-pref="weekly_summaries"></div></div>'
    +   '<div class="row"><div><div class="rt">SMS text alerts</div><div class="rs">Carrier rates may apply</div></div><div class="tg' + (prefs.sms ? ' on' : '') + '" data-pref="sms"></div></div>'
    +   '<div class="row"><div><div class="rt">Push on this device</div><div class="rs">Trips, payments &amp; announcements</div></div><button class="btn ghost sm" id="acx-push">Turn on</button></div>'
    +   '<div class="row"><div><div class="rt">Marketing emails</div><div class="rs">Offers, news and tips</div></div><div class="tg' + (prefs.marketing_email !== false ? ' on' : '') + '" data-pref="marketing_email"></div></div></div>'
    + '<div class="card" id="s-pay"><div class="sec-h"><div class="sec-ico ic-green">&#128179;</div><div class="sec-t">Payments &amp; payouts</div></div><div class="sec-s">How settlements reach you. A person verifies bank details before payout.</div>'
    +   (pay && pay.exists
        ? '<div class="row"><div><div class="rt">Payout method</div><div class="rs">' + esc([pay.bank_name, (pay.account_type || '') + ' ···' + (pay.account_last4 || '')].filter(Boolean).join(' · ')) + '</div></div><span class="pill ' + (pay.verified ? 'p-green">Verified' : 'p-blue">Pending') + '</span></div>'
        : '<div class="row"><div><div class="rt">Payout method</div><div class="rs">Not set — add your bank so settlements reach you</div></div><span class="pill p-red">Add</span></div>')
    +   '<div style="margin-top:11px;display:flex;flex-direction:column;gap:8px"><button class="btn sm block" id="acx-addpay">' + (pay && pay.exists ? 'Update payout details' : 'Add payout details') + '</button><button class="btn sec sm block" data-go="finance">Open finance &amp; statements</button></div></div>'
    + '<div class="card" id="s-support"><div class="sec-h"><div class="sec-ico ic-slate">&#127911;</div><div class="sec-t">Support</div></div><div class="sec-s">Real people, fast replies.</div>'
    +   '<a class="btn block" style="text-decoration:none;margin-bottom:9px" href="https://wa.me/">&#128172; WhatsApp us</a>'
    +   '<div class="grid2"><a class="btn sec sm block" style="text-decoration:none" href="mailto:hello@loadboot.com">&#9993; Email support</a><a class="btn sec sm block" style="text-decoration:none" href="mailto:dispatch@loadboot.com">&#128667; Dispatch desk</a></div></div>'
    + '<div class="card"><div class="sec-h"><div class="sec-ico ic-navy">&#128196;</div><div class="sec-t">Legal &amp; policies</div></div>'
    +   '<a class="pol" href="/privacy.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="rt">Privacy Policy</span><span class="go">&rsaquo;</span></a>'
    +   '<a class="pol" href="/terms.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="rt">Terms of Service</span><span class="go">&rsaquo;</span></a>'
    +   '<div class="pol" style="cursor:default"><span class="rt">Dispatch Service Agreement</span>' + (agrStatus === 'valid' ? '<span style="display:flex;gap:8px;align-items:center"><span class="pill p-green">Approved</span><button class="btn ghost sm" id="acx-agr-dl">Download</button></span>' : (agrStatus === 'pending' || agrStatus === 'in_review' || agrStatus === 'review' ? '<span class="pill p-blue">In review</span>' : '<button class="btn sm" id="acx-agr-sign">Sign agreement</button>')) + '</div></div>'
    + '<div class="card dangerc"><div class="sec-h"><div class="sec-ico ic-red">&#9888;</div><div class="sec-t">Danger zone</div></div><div class="sec-s">Pause new load offers or close your account. A person handles every request — nothing happens automatically.</div>'
    +   '<div class="row"><div style="min-width:0;flex:1"><div class="rt">Pause activation</div><div class="rs">Stop new offers temporarily — your data stays safe</div></div><a class="btn danger sm" style="flex:none;text-decoration:none" href="mailto:hello@loadboot.com?subject=Pause%20my%20LoadBoot%20account&body=Please%20pause%20new%20load%20offers%20on%20my%20account.">Request pause</a></div>'
    +   '<div class="row"><div style="min-width:0;flex:1"><div class="rt">Close account</div><div class="rs">Permanently deactivate — we confirm with you first</div></div><a class="btn danger sm" style="flex:none;text-decoration:none" href="mailto:hello@loadboot.com?subject=Close%20my%20LoadBoot%20account">Contact us</a></div></div>'
    + '</div>'
    + '<div class="acx-toast" id="acx-toast"></div>'
    + '</div>';

  // ---- wiring ----
  const root = host.querySelector('.acx');
  const toast = (m) => { const t = root.querySelector('#acx-toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(root._tt); root._tt = setTimeout(() => t.classList.remove('show'), 1900); };
  root.querySelectorAll('[data-toast]').forEach((b) => b.addEventListener('click', () => toast(b.getAttribute('data-toast'))));
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { if (ctx.go) ctx.go(b.getAttribute('data-go')); }));
  // Dispatch Service Agreement: sign -> record (compliance pending) -> CC approves; download executed PDF
  (function () {
    const contact = contactName || name;
    const signBtn = root.querySelector('#acx-agr-sign');
    if (signBtn) signBtn.addEventListener('click', () => {
      openSignModal({ openModal: ctx.openModal, toast: toast }, { carrier: name, mc: mc, dot: dot }, (res) => {
        const pol = signBtn.closest('.pol');
        if (pol) { pol.innerHTML = '<span class="rt">Dispatch Service Agreement</span><span class="pill p-blue">In review</span>'; }
      });
    });
    const dl = root.querySelector('#acx-agr-dl');
    if (dl) dl.addEventListener('click', async () => { let sig = {}; try { sig = (await carrierAgreementSignature()) || {}; } catch (_) {} printExecutedAgreement({ carrier: name, mc: mc, dot: dot, signer: (sig && sig.signer_name) || contact, date: (sig && sig.signed_date) || '', approved: (agrStatus === 'valid') }); });
  })();
  const addPay = root.querySelector('#acx-addpay');
  if (addPay) addPay.addEventListener('click', () => {
    if (!ctx.openModal) { if (ctx.go) ctx.go('finance'); return; }
    const mk = (ph, val) => { const i = document.createElement('input'); i.placeholder = ph; i.style.cssText = 'width:100%;border:1px solid #eaf0f7;border-radius:11px;padding:10px 11px;font-size:.9rem;margin-top:8px;box-sizing:border-box'; if (val) i.value = val; return i; };
    const abaValid = (r) => { r = (r || '').replace(/\D/g, ''); if (r.length !== 9) return false; const d = r.split('').map(Number); return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8])) % 10 === 0; };
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const bank = mk('Bank name *', pay && pay.bank_name), holder = mk('Account holder name * (must match your company)', pay && pay.account_title), acct = mk('Account number *'), routing = mk('Routing / ABA number *'), baddr = mk('Bank address (for wires)'), phone = mk('Bank / accounting phone');
    const rfb = document.createElement('div'); rfb.style.cssText = 'font-size:.72rem;font-weight:700;margin-top:2px';
    const nfb = document.createElement('div'); nfb.style.cssText = 'font-size:.72rem;font-weight:700;margin-top:2px';
    routing.addEventListener('input', () => { const r = routing.value; if (!r) { rfb.textContent = ''; return; } if (abaValid(r)) { rfb.style.color = '#12a150'; rfb.textContent = '\u2713 Routing valid (auto-checked, free)'; } else { rfb.style.color = '#e0304a'; rfb.textContent = '\u2717 Routing number invalid'; } });
    holder.addEventListener('input', () => { const h = holder.value.trim(); if (!h) { nfb.textContent = ''; return; } if (norm(h) === norm(name)) { nfb.style.color = '#12a150'; nfb.textContent = '\u2713 Matches your company name'; } else { nfb.style.color = '#d97706'; nfb.textContent = '\u26a0 Does not match \u201C' + name + '\u201D \u2014 use a factoring NOA / DBA proof, or the Command Center will review'; } });
    const msg = document.createElement('div'); msg.style.cssText = 'color:#e0304a;font-size:.8rem;margin-top:6px';
    const note = document.createElement('p'); note.style.cssText = 'font-size:.8rem;color:#64748b;margin:0'; note.textContent = 'A person verifies bank details before any payout. Numbers are masked once saved.';
    const save = document.createElement('button'); save.textContent = 'Save payout details'; save.style.cssText = 'margin-top:12px;width:100%;background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;border:0;border-radius:12px;padding:11px;font-weight:700;cursor:pointer';
    let close;
    save.addEventListener('click', async () => { msg.textContent = ''; if (!bank.value.trim() || !holder.value.trim() || !acct.value.trim() || !routing.value.trim()) { msg.textContent = 'Please complete all required fields.'; return; } if (!abaValid(routing.value)) { msg.textContent = 'Routing number is invalid \u2014 please re-check it.'; return; } save.disabled = true; save.textContent = 'Saving…'; try { await setMyPaymentProfile({ bank_name: bank.value.trim(), account_title: holder.value.trim(), account_number: acct.value.trim(), routing_number: routing.value.trim(), bank_address: baddr.value.trim(), bank_phone: phone.value.trim(), payment_method: 'ach' }); if (close) close(); toast('Payout details saved — pending verification'); } catch (e) { save.disabled = false; save.textContent = 'Save payout details'; msg.textContent = (e && e.message) || 'Could not save.'; } });
    close = ctx.openModal('Payout & bank details', [note, holder, nfb, bank, acct, routing, rfb, baddr, phone, msg, save]);
  });
  // nav chips
  const chips = [].slice.call(root.querySelectorAll('.chip'));
  chips.forEach((c) => c.addEventListener('click', () => { const el = root.querySelector('#' + c.dataset.t); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); chips.forEach((x) => x.classList.toggle('on', x === c)); }));
  try {
    const secs = chips.map((c) => root.querySelector('#' + c.dataset.t)).filter(Boolean);
    const obs = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) chips.forEach((c) => c.classList.toggle('on', c.dataset.t === e.target.id)); }); }, { rootMargin: '-40% 0px -55% 0px' });
    secs.forEach((s) => obs.observe(s));
  } catch (_) {}
  // Desktop masonry: pack cards into balanced shortest-height columns (no dead gaps). Mobile = single column.
  (function () {
    const bodyEl = root.querySelector('.body'); if (!bodyEl) return;
    const cards = [].slice.call(bodyEl.querySelectorAll('.card'));
    let lastN = -1;
    const layout = () => {
      const w = window.innerWidth; const n = w >= 1200 ? 3 : (w >= 860 ? 2 : 1);
      if (n === lastN) return; lastN = n;
      bodyEl.innerHTML = '';
      if (n === 1) { bodyEl.classList.remove('masonry'); cards.forEach((c) => bodyEl.appendChild(c)); return; }
      bodyEl.classList.add('masonry');
      const cols = []; for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'mcol'; cols.push(d); bodyEl.appendChild(d); }
      cards.forEach((card) => { let min = 0; for (let i = 1; i < n; i++) { if (cols[i].offsetHeight < cols[min].offsetHeight) min = i; } cols[min].appendChild(card); });
    };
    layout(); let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { lastN = -1; layout(); }, 180); });
  })();
  // Business profile: credibility fields locked; Change -> disclaimer -> editable; Save -> re-verify if changed
  (function () {
    const credIds = ['acx-entity', 'acx-mc', 'acx-dot'];
    const orig = {}; credIds.forEach((id) => { const e = root.querySelector('#' + id); if (e) orig[id] = e.value; });
    const changeBtn = root.querySelector('#acx-bizchange');
    const saveBtn = root.querySelector('#acx-bizsave');
    if (changeBtn) changeBtn.addEventListener('click', () => {
      if (!confirm('Change a verified detail?\n\nMC / USDOT / legal entity were verified against your official documents. Changing one sends your account back to PENDING and pauses booking until the Command Center re-verifies the new value.\n\nOnly change it if your real authority or entity actually changed. Continue?')) return;
      credIds.forEach((id) => { const e = root.querySelector('#' + id); if (e) { e.readOnly = false; e.style.background = '#fff'; } });
      changeBtn.style.display = 'none';
      const m = root.querySelector('#acx-bizmsg'); if (m) { m.style.color = '#d97706'; m.textContent = 'Editing verified details — saving will send your account for re-verification.'; }
    });
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const changed = credIds.some((id) => { const e = root.querySelector('#' + id); return e && e.value !== orig[id]; });
      const m = root.querySelector('#acx-bizmsg');
      if (!changed) { if (m) { m.style.color = ''; m.textContent = 'Saved. (No verified detail changed.)'; } return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        await carrierRequestReverify('mc_authority', 'Business detail changed (MC/DOT/entity)');
        if (m) { m.style.color = '#b45309'; m.innerHTML = '\u2709 Sent to the Command Center for re-verification. Your account is now <b>pending</b> and booking is paused until approved.'; }
        credIds.forEach((id) => { const e = root.querySelector('#' + id); if (e) e.readOnly = true; });
        saveBtn.textContent = 'Sent for review';
      } catch (e) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; if (m) { m.style.color = '#e0304a'; m.textContent = (e && e.message) || 'Could not save.'; } }
    });
  })();
  // avatar
  const avafile = root.querySelector('#acx-avafile'); const ava = root.querySelector('#acx-ava');
  const pick = () => avafile && avafile.click();
  const camEl = root.querySelector('#acx-cam'); if (camEl) camEl.addEventListener('click', pick);
  const photoBtn = root.querySelector('#acx-photo'); if (photoBtn) photoBtn.addEventListener('click', pick);
  if (avafile) avafile.addEventListener('change', () => { const f = avafile.files && avafile.files[0]; if (!f) return; const u = URL.createObjectURL(f); ava.innerHTML = '<img src="' + u + '" alt=""><div class="cam" id="acx-cam">&#9998;</div>'; ava.querySelector('#acx-cam').addEventListener('click', pick); toast('Photo updated'); });
  // toggles that persist to preferences
  root.querySelectorAll('[data-pref]').forEach((t) => t.addEventListener('click', async () => { t.classList.toggle('on'); const state = Object.assign({}, prefs); state[t.getAttribute('data-pref')] = t.classList.contains('on'); Object.assign(prefs, state); try { await pocketSavePreferences(state); toast('Preference saved'); } catch (e) { toast((e && e.message) || 'Could not save'); } }));
  // dispatch toggles (local) + save
  const hazEl = root.querySelector('#acx-haz'); if (hazEl) hazEl.addEventListener('click', () => hazEl.classList.toggle('on'));
  const wkndEl = root.querySelector('#acx-wknd'); if (wkndEl) wkndEl.addEventListener('click', () => wkndEl.classList.toggle('on'));
  const teamEl = root.querySelector('#acx-team'); if (teamEl) teamEl.addEventListener('click', () => teamEl.classList.toggle('on'));
  const saveDisp = root.querySelector('#acx-savedisp');
  if (saveDisp) saveDisp.addEventListener('click', async () => {
    saveDisp.disabled = true; saveDisp.textContent = 'Saving…';
    try {
      await setDispatchPrefs({
        min_rpm: (root.querySelector('#acx-minrpm').value || '').trim() || null,
        preferred_equipment: [root.querySelector('#acx-eq').value].filter(Boolean),
        preferred_lanes: (root.querySelector('#acx-lanes').value || '').split(',').map((x) => x.trim()).filter(Boolean),
        home_base: (root.querySelector('#acx-home').value || '').trim() || null,
        max_deadhead_miles: (root.querySelector('#acx-dead').value || '').trim() || null,
        target_rpm: (root.querySelector('#acx-target').value || '').trim() || null,
        max_weight_lbs: (root.querySelector('#acx-weight').value || '').trim() || null,
        min_trip_miles: (root.querySelector('#acx-tripmin').value || '').trim() || null,
        max_trip_miles: (root.querySelector('#acx-tripmax').value || '').trim() || null,
        min_notice_hours: (root.querySelector('#acx-notice').value || '').trim() || null,
        avoid_states: (root.querySelector('#acx-avoid').value || '').split(',').map((x) => x.trim()).filter(Boolean),
        hazmat: hazEl ? hazEl.classList.contains('on') : false,
        team_drivers: teamEl ? teamEl.classList.contains('on') : false,
        weekend_ok: wkndEl ? wkndEl.classList.contains('on') : true,
      });
      saveDisp.textContent = 'Saved ✓'; toast('Dispatch preferences saved'); setTimeout(() => { saveDisp.disabled = false; saveDisp.textContent = 'Save preferences'; }, 1400);
    } catch (e) { saveDisp.disabled = false; saveDisp.textContent = 'Save preferences'; toast((e && e.message) || 'Could not save'); }
  });
  // push
  const pushBtn = root.querySelector('#acx-push');
  if (pushBtn) {
    if (ctx.pushSupported && !ctx.pushSupported()) { pushBtn.textContent = 'Not supported'; pushBtn.disabled = true; }
    else {
      if (ctx.isPushEnabled) ctx.isPushEnabled().then((on) => { if (on) { pushBtn.textContent = 'On ✓'; pushBtn.disabled = true; } }).catch(() => {});
      pushBtn.addEventListener('click', async () => { pushBtn.disabled = true; pushBtn.textContent = 'Enabling…'; try { if (ctx.enablePush) await ctx.enablePush('Carrier portal'); pushBtn.textContent = 'On ✓'; toast('Push notifications enabled'); } catch (e) { pushBtn.disabled = false; pushBtn.textContent = 'Turn on'; toast((e && e.message) || 'Could not enable'); } });
    }
  }
  // password + signout
  const pwBtn = root.querySelector('#acx-pw'); if (pwBtn) pwBtn.addEventListener('click', () => { if (ctx.go) ctx.go('account'); toast('Use “Forgot password” on the sign-in screen to reset securely'); });
  const soBtn = root.querySelector('#acx-signout'); if (soBtn) soBtn.addEventListener('click', async () => { soBtn.disabled = true; soBtn.textContent = 'Signing out…'; try { if (ctx.signOut) await ctx.signOut(); location.reload(); } catch (_) { location.reload(); } });
}

export default renderPremiumAccount;
