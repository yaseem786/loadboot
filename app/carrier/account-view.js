// Premium Account & Settings — the LOCKED design ported into the live carrier app.
// Renders hero + metric strip + sub-tab nav + rich section cards, wired to real data.
import { openSignModal, printExecutedAgreement } from './dispatch-agreement.js';
import { printExecutedW9 } from './w9-form.js';
import { attachAddressSuggest } from '../shared/addr-suggest.js';
import { uploadDocument } from '../shared/storage.js';
import { accountHealth, pocketCompliance, getDispatchPrefs, setDispatchPrefs, pocketGetPreferences, pocketSavePreferences, myPaymentProfile, setMyPaymentProfile, myTrustProfile, myHazmatReadiness, carrierRequestReverify, carrierAgreementSignature, setMyAvatar, myAvatar } from '../shared/api.js';

function sic(n) {
  var P = {
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M12 6h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>',
    truck: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    headset: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
  };
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || P.file) + '</svg>';
}
function lbConfirm(title, body, okLabel) {
  return new Promise((res) => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(4,9,18,.72);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div style="background:linear-gradient(180deg,#131f36,#101a2e);border:1px solid rgba(255,255,255,.12);border-radius:18px;max-width:460px;width:100%;padding:22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.85)">'
      + '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px"><span style="width:34px;height:34px;border-radius:10px;flex:none;background:rgba(217,119,6,.16);color:#fbbf24;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:16px">!</span>'
      + '<div style="font-weight:800;font-size:1.02rem;color:#eaf1fb;line-height:1.35;padding-top:5px">' + title + '</div></div>'
      + '<div style="font-size:.86rem;color:#b9c6db;line-height:1.65;white-space:pre-line;margin-bottom:16px">' + body + '</div>'
      + '<div style="display:flex;gap:9px;justify-content:flex-end"><button id="lbc-no" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#eaf1fb;border-radius:11px;padding:10px 16px;font-weight:700;cursor:pointer;font-family:inherit">Cancel</button>'
      + '<button id="lbc-ok" style="background:linear-gradient(135deg,#d97706,#f59e0b);border:0;color:#fff;border-radius:11px;padding:10px 16px;font-weight:800;cursor:pointer;font-family:inherit">' + (okLabel || 'Continue') + '</button></div></div>';
    document.body.appendChild(ov);
    const done = (v) => { ov.remove(); res(v); };
    ov.querySelector('#lbc-ok').onclick = () => done(true);
    ov.querySelector('#lbc-no').onclick = () => done(false);
    ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
  });
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function renderPremiumAccount(host, ctx) {
  ctx = ctx || {};
  const ov = ctx.ov || {};
  const user = ctx.user || {};
  host.innerHTML = '<div class="acx"><div style="padding:40px;text-align:center;color:#9aa7bd">Loading your account…</div></div>';

  const [health, comp, prefs, pay, trust, prof] = await Promise.all([
    accountHealth().catch(() => null),
    pocketCompliance().catch(() => ({ requirements: [] })),
    pocketGetPreferences().catch(() => ({})),
    myPaymentProfile().catch(() => null),
    myTrustProfile().catch(() => null),
    (await import('../shared/api.js')).pocketGetProfile().catch(() => ({})),
  ]);

  const reqs = (comp && comp.requirements) || [];
  const totalDocs = reqs.length || 0;
  const okDocs = reqs.filter((r) => String(r.status || '').toLowerCase() === 'valid').length;
  const revDocs = reqs.filter((r) => ['pending', 'in_review', 'review', 'submitted'].indexOf(String(r.status || '').toLowerCase()) >= 0).length;
  const needDocs = Math.max(0, totalDocs - okDocs - revDocs);
  const agrReq = reqs.find((r) => /dispatch service agreement|dispatch_agreement/i.test(r.name || '')) || null;
  const agrStatus = agrReq ? String(agrReq.status || 'missing').toLowerCase() : 'missing';
  const healthScore = health && health.score != null ? String(health.score) : '—';
  const rating = trust && trust.rating != null ? (Number(trust.rating).toFixed(1) + '★') : (trust && trust.verified ? 'Verified' : 'New');
  const name = (prof && prof.company) || ov.carrier || (comp && comp.carrier) || 'Your company';
  const _stageRev = ['submitted', 'in_review', 'review', 'compliance_check', 'changes_requested'].indexOf(String(ov.onboarding_stage || '').toLowerCase()) >= 0;
  const email = user.email || '';
  const um = (user && user.user_metadata) || {};
  const contactName = (prof && prof.contact_name) || um.name || user.name || '';
  const phoneVal = (prof && prof.phone) || um.phone || ov.phone || '';
  const initials = (name.trim().replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || 'C').toUpperCase();
  const compliant = !!ov.compliance_ok;
  const mc = (prof && prof.mc) || ov.mc_number || ov.mc || '';
  const dot = (prof && prof.dot) || ov.dot_number || ov.usdot || ov.dot || '';
  const wknet = ov.week_net != null ? ('$' + Number(ov.week_net).toLocaleString()) : '—';
  const sub = ['Owner-operator', mc ? ('MC ' + mc) : null, dot ? ('DOT ' + dot) : null].filter(Boolean).join(' · ');

  const docHtml = reqs.filter((r) => { const _st = String(r.status || '').toLowerCase(); return _st !== 'valid' && (r.mandatory || _st === 'pending' || _st === 'in_review' || _st === 'review' || _st === 'submitted'); }).map((r) => {
    const st = String(r.status || '').toLowerCase();
    let di, pill, rs;
    if (st === 'valid') { di = '<div class="di ok">&#10003;</div>'; pill = '<span class="pill p-green">Approved</span>'; rs = r.expiry_date ? ('Verified · valid to ' + esc(r.expiry_date)) : 'Verified'; }
    else if (st === 'pending' || st === 'in_review' || st === 'review' || st === 'submitted') { di = '<div class="di rev">&#9200;</div>'; pill = '<span class="pill p-blue">In review</span>'; rs = 'Submitted · Command Center reviewing'; }
    else if (!r.mandatory) { di = '<div class="di req" style="background:#f1f5fb;color:#64748b">&ndash;</div>'; pill = '<span class="pill p-gray">Optional</span>'; rs = 'Recommended'; }
    else { di = '<div class="di req">!</div>'; pill = '<span class="pill p-red">Action</span>'; rs = st === 'expired' ? 'Expired — please re-upload' : 'Required — not on file'; }
    return '<div class="doc">' + di + '<div style="flex:1"><div class="rt">' + esc(r.name) + '</div><div class="rs">' + rs + '</div></div>' + pill + '</div>';
  }).join('') || '<div class="mini" style="margin:6px 0">&#10003; Everything on file is verified.</div>';

  const w9Req = reqs.find((r) => /w-?9/i.test(r.name || '')) || {};
  const w9Status = String(w9Req.status || '').toLowerCase();
  const ringOff = totalDocs ? (100 - (okDocs / totalDocs * 100)) : 100;
  const _stageApproved = ['approved', 'active', 'completed'].indexOf(String(ov.onboarding_stage || '').toLowerCase()) >= 0;
  const _stageRejected = String(ov.onboarding_stage || '').toLowerCase() === 'rejected';
  const _isPaused = String(ov.account_status || '') === 'paused';
  const _poaReq = !_isPaused && ov.poa_required;
  const vpill = _stageRejected && !_isPaused
    ? '<div class="vpill" style="background:linear-gradient(90deg,rgba(239,68,68,.3),rgba(239,68,68,.12));color:#fca5a5;border-color:rgba(239,68,68,.45)"><span class="gdot" style="background:#ef4444;box-shadow:0 0 0 4px rgba(239,68,68,.25)"></span> ACCESS REVOKED — CONTACT SUPPORT</div>'
    : _isPaused
    ? '<div class="vpill" style="background:linear-gradient(90deg,rgba(239,68,68,.3),rgba(239,68,68,.12));color:#fca5a5;border-color:rgba(239,68,68,.45)"><span class="gdot" style="background:#ef4444;box-shadow:0 0 0 4px rgba(239,68,68,.25)"></span> PAUSED' + (ov.pause_reason ? ' — ' + String(ov.pause_reason).replace(/</g,'&lt;').toUpperCase().slice(0,60) : '') + '</div>'
    : _poaReq
    ? '<div class="vpill" style="background:linear-gradient(90deg,rgba(217,119,6,.3),rgba(217,119,6,.12));color:#fcd34d;border-color:rgba(217,119,6,.45)"><span class="gdot" style="background:#fbbf24;box-shadow:0 0 0 4px rgba(251,191,36,.25)"></span> ACTION REQUIRED — PLAN OF ACTION' + (ov.poa_required.factor ? ': ' + String(ov.poa_required.factor).replace(/</g,'&lt;').toUpperCase().slice(0,40) : '') + '</div>'
    : (compliant && _stageApproved)
    ? '<div class="vpill"><span class="gdot"></span> VERIFIED — BOOKING OPEN</div>'
    : compliant
      ? '<div class="vpill" style="background:linear-gradient(90deg,rgba(8,131,247,.28),rgba(8,131,247,.12));color:#9cc5f4;border-color:rgba(8,131,247,.4)"><span class="gdot" style="background:#0883F7;box-shadow:0 0 0 4px rgba(8,131,247,.25)"></span> DOCS VERIFIED — FINAL APPROVAL PENDING</div>'
      : '<div class="vpill" style="background:linear-gradient(90deg,rgba(217,119,6,.28),rgba(217,119,6,.12));color:#fcd34d;border-color:rgba(217,119,6,.4)"><span class="gdot" style="background:#fbbf24;box-shadow:0 0 0 4px rgba(251,191,36,.25)"></span> PENDING VERIFICATION</div>';

  const dp = (await getDispatchPrefs().catch(() => ({}))) || {};
  const eqSel = () => ['Dry Van', 'Reefer', 'Flatbed', 'Power Only', 'Step Deck', 'Box Truck', 'Hotshot'].map((o) => {
    const on = (dp.preferred_equipment || []).indexOf(o) >= 0;
    return '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;border:1.5px solid ' + (on ? '#0883F7' : 'var(--border,#334155)') + ';background:' + (on ? 'rgba(8,131,247,.14)' : 'transparent') + ';cursor:pointer;font-size:.82rem;font-weight:700;white-space:nowrap;transition:border-color .15s,background .15s"><input type="checkbox" class="acx-eqc" value="' + o + '"' + (on ? ' checked' : '') + ' style="accent-color:#0883F7;flex:none">' + o + '</label>';
  }).join('');

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
    + '<div class="card" id="s-profile"><div class="sec-h" style="align-items:center"><div class="sec-ico ic-blue">' + sic('user') + '</div><div class="sec-t">Profile</div>' + (contactName ? '<span class="cpa-autopill">&#10003; from sign-up</span>' : '') + '</div><div class="sec-s">Auto-filled from your sign-up \u2014 change anytime.</div>'
    +   '<div class="field"><label>Display name</label><input id="acx-dname" value="' + esc(name) + '"></div>'
    +   '<div class="grid2"><div class="field"><label>Contact name</label><input value="' + esc(contactName) + '"></div><div class="field"><label>Phone' + (phoneVal ? '' : ' <span style=\"color:#d97706;font-size:.66rem;font-weight:800\">\u00b7 recommended</span>') + '</label><input value="' + esc(phoneVal) + '" placeholder="(555) 000-0000"></div></div>'
    +   '<div style="margin-top:13px;display:flex;gap:8px"><button class="btn sm" data-toast="Profile saved">Save changes</button><button class="btn sec sm" id="acx-photo">Change photo</button></div>'
    +   '<input type="file" id="acx-avafile" accept="image/*" hidden></div>'
    + '<div class="card" id="s-verify"><div class="sec-h"><div class="sec-ico ic-green">' + sic('shield') + '</div><div class="sec-t">Verification &amp; documents</div></div><div class="sec-s">Same live status as the Documents tab — one source of truth.</div>'
    +   '<div class="ringwrap"><svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="#e3ecf6" stroke-width="3.6"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="#12a150" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset="' + ringOff.toFixed(1) + '" transform="rotate(-90 18 18)"/><text x="18" y="17" text-anchor="middle" font-size="8" font-weight="800" fill="#0b1b33">' + okDocs + '/' + totalDocs + '</text><text x="18" y="24" text-anchor="middle" font-size="3.4" fill="#9aa7bd">verified</text></svg>'
    +     '<div><div style="font-weight:800;font-size:.98rem">Compliance packet</div><div class="mini">' + ([needDocs ? needDocs + ' still needed' : '', revDocs ? revDocs + ' in review' : ''].filter(Boolean).join(' \u00b7 ') || 'All required documents verified \u2713') + '</div></div></div>'
    +   '<div>' + docHtml + '</div>'
    +   '<div style="margin-top:12px">' + (compliant ? '<button class="btn sm" data-go="documents">Open Documents</button>' : '<button class="btn sm" data-go="onboarding">Finish onboarding &rarr;</button> <button class="btn ghost sm" data-go="documents">Open Documents</button>') + '</div>'
    +   '<div class="hint">Uploading moves an item to <b>In review</b>; the Command Center approves it and every screen updates together.</div></div>'
    + '<div class="card" id="s-biz"><div class="sec-h" style="align-items:center"><div class="sec-ico ic-navy">' + sic('building') + '</div><div class="sec-t">Business profile</div>' + (compliant ? '<span class="cpa-autopill">&#10003; verified</span>' : (_stageRev ? '<span class="cpa-autopill" style="background:var(--ice);color:var(--blue);border-color:#9cc5f4">&#9203; In review</span>' : '')) + '</div><div class="sec-s">Legal identity from your approved authority &amp; W-9. Changing a verified detail re-opens review.</div>'
    +   '<div class="grid2"><div class="field"><label>Legal entity</label><input class="acx-cred" id="acx-entity" value="' + esc(name) + '" readonly></div><div class="field"><label>Entity type</label><select id="acx-etype"><option>LLC</option><option>Sole proprietor</option><option>Corporation</option></select></div>'
    +   '<div class="field"><label>MC number</label><input class="acx-cred" id="acx-mc" value="' + esc(mc) + '" placeholder="MC-000000" readonly></div><div class="field"><label>USDOT</label><input class="acx-cred" id="acx-dot" value="' + esc(dot) + '" placeholder="0000000" readonly></div></div>'
    +   '<div class="field"><label>Business address <span style="color:#94a3b8;font-size:.66rem">&middot; freely editable</span></label><input id="acx-addr" value="' + esc(ov.address || '') + '" placeholder="Street, City, ST ZIP"></div>'
    +   '<div id="acx-bizmsg" class="cp-row-s" style="margin-top:8px"></div>'
    +   '<div style="margin-top:10px;display:flex;gap:8px">' + (!compliant && _stageRev ? '<button class="btn ghost sm" disabled style="opacity:.55;cursor:default">&#9203; In review \u2014 editing locked</button>' : '<button class="btn ghost sm" id="acx-bizchange">Change verified details</button>') + '<button class="btn sm" id="acx-bizsave">Save</button></div></div>'
    + '<div class="card" id="s-disp"><div class="sec-h"><div class="sec-ico ic-orange">' + sic('truck') + '</div><div class="sec-t">Dispatch preferences</div></div><div class="sec-s">Drives the load-matching engine — better in, better loads.</div>'
    +   '<div class="grid2"><div class="field"><label>Equipment — select ALL you run</label><div id="acx-eq" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px">' + eqSel() + '</div></div><div class="field"><label>Home base</label><input id="acx-home" value="' + esc(dp.home_base || '') + '"></div>'
    +   '<div class="field"><label>Min rate ($/mi)</label><input id="acx-minrpm" value="' + esc(dp.min_rpm || '') + '"></div><div class="field"><label>Max deadhead (mi)</label><input id="acx-dead" value="' + esc(dp.max_deadhead_miles || '') + '"></div><div class="field"><label>Target rate ($/mi)</label><input id="acx-target" value="' + esc(dp.target_rpm || '') + '"></div><div class="field"><label>Max weight (lbs)</label><input id="acx-weight" value="' + esc(dp.max_weight_lbs || '') + '"></div></div>'
    +   '<div class="field"><label>Preferred lanes</label><input id="acx-lanes" value="' + esc((dp.preferred_lanes || []).join(', ')) + '"></div>'
    +   '<div class="grid2"><div class="field"><label>Shortest trip (mi)</label><input id="acx-tripmin" value="' + esc(dp.min_trip_miles || '') + '"></div><div class="field"><label>Longest trip (mi)</label><input id="acx-tripmax" value="' + esc(dp.max_trip_miles || '') + '"></div></div>'
    +   '<div class="grid2"><div class="field"><label>Min notice (hrs)</label><input id="acx-notice" value="' + esc(dp.min_notice_hours || '') + '"></div><div class="field"><label>Avoid states</label><input id="acx-avoid" value="' + esc((dp.avoid_states || []).join(', ')) + '"></div></div>'
    +   '<div class="row"><div><div class="rt">Haul hazmat</div><div class="rs">Requires endorsement on file</div></div><div class="tg' + (dp.hazmat ? ' on' : '') + '" id="acx-haz"></div></div>'
    +   '<div class="row"><div><div class="rt">Team drivers</div><div class="rs">Two drivers, longer runs</div></div><div class="tg' + (dp.team_drivers ? ' on' : '') + '" id="acx-team"></div></div>'
    +   '<div class="row"><div><div class="rt">Available weekends</div><div class="rs">Include Sat/Sun loads</div></div><div class="tg' + (dp.weekend_ok !== false ? ' on' : '') + '" id="acx-wknd"></div></div>'
    +   '<div class="hint" style="margin-top:10px;background:#f0f7ff;border:1px solid #d6e8ff;color:#2b5f93;border-radius:11px;padding:9px 12px;font-size:.75rem">More detail = sharper, better-paying matches. Blank fields never hurt your account \u2014 they just mean broader matching.</div>'
    +   '<div style="margin-top:12px"><button class="btn sm" id="acx-savedisp">Save preferences</button></div></div>'
    + '<div class="card" id="s-sec"><div class="sec-h"><div class="sec-ico ic-violet">' + sic('lock') + '</div><div class="sec-t">Security &amp; sign-in</div></div><div class="sec-s">Protect your account and your money.</div>'
    +   '<div class="row"><div style="min-width:0;flex:1"><div class="rt">Email address</div><div class="rs" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(email) + '</div></div><button class="btn ghost sm" style="flex:none" data-toast="To change your sign-in email, contact support — it protects your payouts">Change</button></div>'
    +   '<div class="row"><div><div class="rt">Password</div><div class="rs">Keep it strong and private</div></div><button class="btn ghost sm" id="acx-pw">Reset</button></div>'
    +   '<div class="row"><div><div class="rt">Active sessions</div><div class="rs">Sign out everywhere</div></div><button class="btn ghost sm" id="acx-signout">Sign out</button></div></div>'
    + '<div class="card" id="s-notif"><div class="sec-h"><div class="sec-ico ic-blue">' + sic('bell') + '</div><div class="sec-t">Notifications</div></div><div class="sec-s">Operational alerts always reach you; the rest are optional.</div>'
    +   '<div class="row"><div><div class="rt">Load offers</div><div class="rs">Matching loads on your lanes</div></div><div class="tg' + (prefs.load_offers !== false ? ' on' : '') + '" data-pref="load_offers"></div></div>'
    +   '<div class="row"><div><div class="rt">Weekly summary</div><div class="rs">Your earnings digest</div></div><div class="tg' + (prefs.weekly_summaries !== false ? ' on' : '') + '" data-pref="weekly_summaries"></div></div>'
    +   '<div class="row"><div><div class="rt">SMS text alerts</div><div class="rs">Carrier rates may apply</div></div><div class="tg' + (prefs.sms ? ' on' : '') + '" data-pref="sms"></div></div>'
    +   '<div class="row"><div><div class="rt">Push on this device</div><div class="rs">Trips, payments &amp; announcements</div></div><button class="btn ghost sm" id="acx-push">Turn on</button></div>'
    +   '<div class="row"><div><div class="rt">Marketing emails</div><div class="rs">Offers, news and tips</div></div><div class="tg' + (prefs.marketing_email !== false ? ' on' : '') + '" data-pref="marketing_email"></div></div></div>'
    + '<div class="card" id="s-pay"><div class="sec-h"><div class="sec-ico ic-green">' + sic('card') + '</div><div class="sec-t">Payments &amp; payouts</div></div><div class="sec-s">How settlements reach you. A person verifies bank details before payout.</div>'
    +   (pay && pay.exists
        ? '<div class="row"><div><div class="rt">Payout method</div><div class="rs">' + esc([pay.bank_name, (pay.account_type || '') + ' ···' + (pay.account_last4 || '')].filter(Boolean).join(' · ')) + '</div></div><span class="pill ' + (pay.verified ? 'p-green">Verified' : 'p-blue">Pending') + '</span></div>'
        : '<div class="row"><div><div class="rt">Payout method</div><div class="rs">Not set — add your bank so settlements reach you</div></div><span class="pill p-red">Add</span></div>')
    +   '<div style="margin-top:11px;display:flex;flex-direction:column;gap:8px"><button class="btn sm block" id="acx-addpay">' + (pay && pay.exists ? 'Update payout details' : 'Add payout details') + '</button><button class="btn sec sm block" data-go="finance">Open finance &amp; statements</button></div></div>'
    + '<div class="card" id="s-support"><div class="sec-h"><div class="sec-ico ic-slate">' + sic('headset') + '</div><div class="sec-t">Support</div></div><div class="sec-s">Real people, fast replies.</div>'
    +   '<a class="btn block" style="text-decoration:none;margin-bottom:9px" href="https://wa.me/">&#128172; WhatsApp us</a>'
    +   '<div class="grid2"><a class="btn sec sm block" style="text-decoration:none" href="mailto:hello@loadboot.com">&#9993; Email support</a><a class="btn sec sm block" style="text-decoration:none" href="mailto:dispatch@loadboot.com">&#128667; Dispatch desk</a></div></div>'
    + '<div class="card" id="s-legal"><div class="sec-h"><div class="sec-ico ic-navy">' + sic('file') + '</div><div class="sec-t">Legal &amp; policies</div></div>'
    +   '<a class="pol" href="/privacy.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="rt">Privacy Policy</span><span class="go">&rsaquo;</span></a>'
    +   '<a class="pol" href="/terms.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="rt">Terms of Service</span><span class="go">&rsaquo;</span></a>'
    +   '<div class="pol" style="cursor:default"><span class="rt">W-9 Tax Form</span>' + (w9Status === 'valid' ? '<span style="display:flex;gap:8px;align-items:center"><span class="pill p-green">Approved</span><button class="btn ghost sm" id="acx-w9-dl">Download</button></span>' : (w9Status === 'pending' || w9Status === 'in_review' || w9Status === 'review' || w9Status === 'submitted' ? '<span style="display:flex;gap:8px;align-items:center"><span class="pill p-blue">In review</span><button class="btn ghost sm" id="acx-w9-dl">Download</button></span>' : '<span class="pill p-gray">Not on file</span>')) + '</div>'
    +   '<div class="pol" style="cursor:default"><span class="rt">Dispatch Service Agreement</span>' + (agrStatus === 'valid' ? '<span style="display:flex;gap:8px;align-items:center"><span class="pill p-green">Approved</span><button class="btn ghost sm" id="acx-agr-dl">Download</button></span>' : (agrStatus === 'pending' || agrStatus === 'in_review' || agrStatus === 'review' ? '<span style="display:flex;gap:8px;align-items:center"><span class="pill p-blue">In review</span><button class="btn ghost sm" id="acx-agr-dl">Download</button></span>' : '<button class="btn sm" id="acx-agr-sign">Sign agreement</button>')) + '</div></div>'
    + '<div class="card dangerc" id="s-danger"><div class="sec-h"><div class="sec-ico ic-red">' + sic('alert') + '</div><div class="sec-t">Danger zone</div></div><div class="sec-s">Pause new load offers or close your account. A person handles every request — nothing happens automatically.</div>'
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
  try { const _ad = root.querySelector('#acx-addr'); if (_ad) attachAddressSuggest(_ad); } catch (_) {}
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
    const w9dl = root.querySelector('#acx-w9-dl');
    if (w9dl) w9dl.addEventListener('click', async () => { let w9 = {}; try { w9 = (await import('../shared/api.js').then((m) => m.carrierW9())) || {}; } catch (_) {} printExecutedW9(w9); });
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
      const w = window.innerWidth; const n = w >= 860 ? 2 : 1;
      if (n === lastN) return; lastN = n;
      bodyEl.innerHTML = '';
      if (n === 1) { bodyEl.classList.remove('masonry'); cards.forEach((c) => bodyEl.appendChild(c)); return; }
      bodyEl.classList.add('masonry');
      const cols = []; for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'mcol'; cols.push(d); bodyEl.appendChild(d); }
      // FIXED logical grouping (no height-packing — deterministic, organized):
      // col 0 = identity & money · col 1 = operations & help
      const COL1 = ['s-profile', 's-verify', 's-biz', 's-pay', 's-support', 's-legal', 's-danger'];
      const hdr = (t) => { const d = document.createElement('div'); d.style.cssText = 'font-size:.66rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#7f92b3;padding:4px 6px 2px'; d.textContent = t; return d; };
      cols[0].appendChild(hdr('Account & payments'));
      cols[1].appendChild(hdr('Operations & support'));
      cards.forEach((card) => { const ci = (card.id && COL1.indexOf(card.id) >= 0) ? 0 : 1; cols[ci].appendChild(card); });
    };
    layout(); let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { lastN = -1; layout(); }, 180); });
  })();
  // Business profile: credibility fields locked; Change -> disclaimer -> editable; Save -> re-verify if changed
  (function () {
    const credIds = ['acx-entity', 'acx-mc', 'acx-dot'];
    const orig = {}; credIds.forEach((id) => { const e = root.querySelector('#' + id); if (e) orig[id] = e.value; });
    const changeBtn = root.querySelector('#acx-bizchange');
    const saveBtn = root.querySelector('#acx-bizsave');
    if (changeBtn) changeBtn.addEventListener('click', async () => {
      const okc = await lbConfirm('Change a verified detail?', 'MC / USDOT / legal entity were verified against your official documents.\n\nChanging one sends your account back to PENDING and pauses booking until the Command Center re-verifies the new value.\n\nOnly change it if your real authority or entity actually changed.', 'Yes, unlock & change'); if (!okc) return;
      credIds.forEach((id) => { const e = root.querySelector('#' + id); if (e) { e.readOnly = false; e.style.background = '#0c1628'; e.style.color = '#eaf1fb'; e.style.borderColor = '#3b9dff'; e.style.boxShadow = '0 0 0 3px rgba(8,131,247,.18)'; } });
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
  if (avafile) avafile.addEventListener('change', async () => { const f = avafile.files && avafile.files[0]; if (!f) return;
    if (!/^image\//.test(f.type || '')) { toast('Please choose an image file'); return; }
    const u = URL.createObjectURL(f); ava.innerHTML = '<img src="' + u + '" alt=""><div class="cam" id="acx-cam">&#9998;</div>'; ava.querySelector('#acx-cam').addEventListener('click', pick);
    try { const m = await uploadDocument(f, 'avatar'); await setMyAvatar(m.path); toast('Photo saved \u2713'); }
    catch (e) { toast((e && e.message) || 'Could not save the photo'); } });
  (async () => { try { const a0 = await myAvatar(); const p0 = a0 && a0.avatar_path; if (p0 && ava) {
    const { getClient } = await import('../shared/supabaseClient.js'); const sb = await getClient();
    const { data } = await sb.storage.from('documents').createSignedUrl(p0, 3600);
    if (data && data.signedUrl) { ava.innerHTML = '<img src="' + data.signedUrl + '" alt=""><div class="cam" id="acx-cam">&#9998;</div>'; const c2 = ava.querySelector('#acx-cam'); if (c2) c2.addEventListener('click', pick); }
  } } catch (_) {} })();
  // toggles that persist to preferences
  root.querySelectorAll('[data-pref]').forEach((t) => t.addEventListener('click', async () => { t.classList.toggle('on'); const state = Object.assign({}, prefs); state[t.getAttribute('data-pref')] = t.classList.contains('on'); Object.assign(prefs, state); try { await pocketSavePreferences(state); toast('Preference saved'); } catch (e) { toast((e && e.message) || 'Could not save'); } }));
  // dispatch toggles (local) + save
  const hazEl = root.querySelector('#acx-haz');
  if (hazEl && hazEl.classList.contains('on')) (async () => { try { const r = await myHazmatReadiness(); if (!(r && r.ready)) {
    hazEl.style.background = 'linear-gradient(135deg,#d97706,#f59e0b)';
    const rowEl = hazEl.closest('.row'); const sub = rowEl && rowEl.querySelector('.rs');
    if (sub) { sub.textContent = 'Documents in review \u2014 hazmat loads unlock after Command Center approval'; sub.style.color = '#d97706'; }
  } } catch (_) {} })();
  if (hazEl) hazEl.addEventListener('click', async () => {
    if (hazEl.classList.contains('on')) { hazEl.classList.remove('on'); return; }
    hazEl.style.opacity = '.5';
    let ready = false, items = [];
    try { const r = await myHazmatReadiness(); ready = !!(r && r.ready); items = (r && r.items) || []; } catch (_) {}
    hazEl.style.opacity = '';
    if (!ready) {
      const missing = items.filter((i) => String(i.status || '').toLowerCase() !== 'valid').map((i) => i.name + ' (' + (String(i.status || 'missing').replace('_', ' ')) + ')');
      toast('Hazmat locked \u2014 3 approved documents required first: ' + (missing.join(' \u00b7 ') || 'PHMSA Registration \u00b7 CDL-H Endorsement \u00b7 Hazmat COI') + '. Upload them in the Documents tab.');
      return; // toggle stays OFF — hard requirement
    }
    hazEl.classList.add('on');
  });
  const wkndEl = root.querySelector('#acx-wknd'); if (wkndEl) wkndEl.addEventListener('click', () => wkndEl.classList.toggle('on'));
  const teamEl = root.querySelector('#acx-team'); if (teamEl) teamEl.addEventListener('click', () => teamEl.classList.toggle('on'));
  const saveDisp = root.querySelector('#acx-savedisp');
  if (saveDisp) saveDisp.addEventListener('click', async () => {
    saveDisp.disabled = true; saveDisp.textContent = 'Saving…';
    try {
      await setDispatchPrefs({
        min_rpm: (root.querySelector('#acx-minrpm').value || '').trim() || null,
        preferred_equipment: (function () { const v9 = Array.from(root.querySelectorAll('.acx-eqc:checked')).map(c9 => c9.value); if (!v9.length) { alert('Equipment type is REQUIRED \u2014 brokers match and offer loads by equipment. Select ALL you run.'); throw new Error('equipment required'); } return v9; })(),
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
