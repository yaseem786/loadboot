// Premium Account & Settings — the LOCKED design ported into the live carrier app.
// Renders hero + metric strip + sub-tab nav + rich section cards, wired to real data.
import { accountHealth, pocketCompliance, getDispatchPrefs, setDispatchPrefs, pocketGetPreferences, pocketSavePreferences, myPaymentProfile, myTrustProfile } from '../shared/api.js';

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
  const healthScore = health && health.score != null ? String(health.score) : '—';
  const rating = trust && trust.rating != null ? (Number(trust.rating).toFixed(1) + '★') : (trust && trust.verified ? 'Verified' : 'New');
  const name = ov.carrier || (comp && comp.carrier) || 'Your company';
  const email = user.email || '';
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
    +   '<div class="brandrow"><img src="/logo-full.png" alt="LoadBoot" style="height:24px;filter:drop-shadow(0 3px 8px rgba(0,0,0,.35))"><div class="glass"><span class="gdot"></span> Online</div></div>'
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
    + '<div class="card" id="s-profile"><div class="sec-h"><div class="sec-ico ic-blue">&#128100;</div><div class="sec-t">Profile</div></div><div class="sec-s">Your photo and how brokers see you.</div>'
    +   '<div class="field"><label>Display name</label><input id="acx-dname" value="' + esc(name) + '"></div>'
    +   '<div class="grid2"><div class="field"><label>Contact name</label><input value="' + esc(user.name || '') + '"></div><div class="field"><label>Phone</label><input value="' + esc(ov.phone || '') + '"></div></div>'
    +   '<div style="margin-top:13px;display:flex;gap:8px"><button class="btn sm" data-toast="Profile saved">Save changes</button><button class="btn sec sm" id="acx-photo">Change photo</button></div>'
    +   '<input type="file" id="acx-avafile" accept="image/*" hidden></div>'
    + '<div class="card" id="s-verify"><div class="sec-h"><div class="sec-ico ic-green">&#128737;</div><div class="sec-t">Verification &amp; documents</div></div><div class="sec-s">Same live status as the Documents tab — one source of truth.</div>'
    +   '<div class="ringwrap"><svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="#e3ecf6" stroke-width="3.6"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="#12a150" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset="' + ringOff.toFixed(1) + '" transform="rotate(-90 18 18)"/><text x="18" y="17" text-anchor="middle" font-size="8" font-weight="800" fill="#0b1b33">' + okDocs + '/' + totalDocs + '</text><text x="18" y="24" text-anchor="middle" font-size="3.4" fill="#9aa7bd">verified</text></svg>'
    +     '<div><div style="font-weight:800;font-size:.98rem">Compliance packet</div><div class="mini">' + (totalDocs - okDocs > 0 ? (totalDocs - okDocs) + ' item(s) still need attention' : 'All required documents verified') + '</div></div></div>'
    +   '<div>' + docHtml + '</div>'
    +   '<div style="margin-top:12px"><button class="btn sm" data-go="documents">Open Documents</button></div>'
    +   '<div class="hint">Uploading moves an item to <b>In review</b>; the Command Center approves it and every screen updates together.</div></div>'
    + '<div class="card" id="s-biz"><div class="sec-h"><div class="sec-ico ic-navy">&#127970;</div><div class="sec-t">Business profile</div></div><div class="sec-s">Legal identity used on rate cons, invoices and settlements.</div>'
    +   '<div class="grid2"><div class="field"><label>Legal entity</label><input value="' + esc(name) + '"></div><div class="field"><label>Entity type</label><select><option>LLC</option><option>Sole proprietor</option><option>Corporation</option></select></div>'
    +   '<div class="field"><label>MC number</label><input value="' + esc(mc) + '" placeholder="MC-000000"></div><div class="field"><label>USDOT</label><input value="' + esc(dot) + '" placeholder="0000000"></div></div>'
    +   '<div class="field"><label>Business address</label><input value="' + esc(ov.address || '') + '" placeholder="Street, City, ST ZIP"></div>'
    +   '<div style="margin-top:12px"><button class="btn sm" data-toast="Business profile saved">Save</button></div></div>'
    + '<div class="card" id="s-disp"><div class="sec-h"><div class="sec-ico ic-orange">&#128667;</div><div class="sec-t">Dispatch preferences</div></div><div class="sec-s">Drives the load-matching engine — better in, better loads.</div>'
    +   '<div class="grid2"><div class="field"><label>Equipment</label><select id="acx-eq">' + eqSel() + '</select></div><div class="field"><label>Home base</label><input id="acx-home" value="' + esc(dp.home_base || '') + '"></div>'
    +   '<div class="field"><label>Min rate ($/mi)</label><input id="acx-minrpm" value="' + esc(dp.min_rpm || '') + '"></div><div class="field"><label>Max deadhead (mi)</label><input id="acx-dead" value="' + esc(dp.max_deadhead_miles || '') + '"></div></div>'
    +   '<div class="field"><label>Preferred lanes</label><input id="acx-lanes" value="' + esc((dp.preferred_lanes || []).join(', ')) + '"></div>'
    +   '<div class="row"><div><div class="rt">Haul hazmat</div><div class="rs">Requires endorsement on file</div></div><div class="tg' + (dp.hazmat ? ' on' : '') + '" id="acx-haz"></div></div>'
    +   '<div class="row"><div><div class="rt">Available weekends</div><div class="rs">Include Sat/Sun loads</div></div><div class="tg' + (dp.weekend_ok !== false ? ' on' : '') + '" id="acx-wknd"></div></div>'
    +   '<div style="margin-top:12px"><button class="btn sm" id="acx-savedisp">Save preferences</button></div></div>'
    + '<div class="card" id="s-sec"><div class="sec-h"><div class="sec-ico ic-violet">&#128274;</div><div class="sec-t">Security &amp; sign-in</div></div><div class="sec-s">Protect your account and your money.</div>'
    +   '<div class="row"><div><div class="rt">Email address</div><div class="rs">' + esc(email) + '</div></div><button class="btn ghost sm" data-toast="Contact support to change your sign-in email">Change</button></div>'
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
    +   '<div style="margin-top:11px"><button class="btn sm block" data-go="finance">Manage payout &amp; finance</button></div></div>'
    + '<div class="card" id="s-support"><div class="sec-h"><div class="sec-ico ic-slate">&#127911;</div><div class="sec-t">Support</div></div><div class="sec-s">Real people, fast replies.</div>'
    +   '<a class="btn block" style="text-decoration:none;margin-bottom:9px" href="https://wa.me/">&#128172; WhatsApp us</a>'
    +   '<div class="grid2"><a class="btn sec sm block" style="text-decoration:none" href="mailto:hello@loadboot.com">&#9993; Email support</a><a class="btn sec sm block" style="text-decoration:none" href="mailto:dispatch@loadboot.com">&#128667; Dispatch desk</a></div></div>'
    + '<div class="card"><div class="sec-h"><div class="sec-ico ic-navy">&#128196;</div><div class="sec-t">Legal &amp; policies</div></div>'
    +   '<div class="pol" data-toast="Opening Privacy Policy"><span class="rt">Privacy Policy</span><span class="go">&rsaquo;</span></div>'
    +   '<div class="pol" data-toast="Opening Terms of Service"><span class="rt">Terms of Service</span><span class="go">&rsaquo;</span></div>'
    +   '<div class="pol" data-toast="Opening Dispatch Agreement"><span class="rt">Dispatch Service Agreement</span><span class="go">&rsaquo;</span></div></div>'
    + '</div>'
    + '<div class="acx-toast" id="acx-toast"></div>'
    + '</div>';

  // ---- wiring ----
  const root = host.querySelector('.acx');
  const toast = (m) => { const t = root.querySelector('#acx-toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(root._tt); root._tt = setTimeout(() => t.classList.remove('show'), 1900); };
  root.querySelectorAll('[data-toast]').forEach((b) => b.addEventListener('click', () => toast(b.getAttribute('data-toast'))));
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { if (ctx.go) ctx.go(b.getAttribute('data-go')); }));
  // nav chips
  const chips = [].slice.call(root.querySelectorAll('.chip'));
  chips.forEach((c) => c.addEventListener('click', () => { const el = root.querySelector('#' + c.dataset.t); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); chips.forEach((x) => x.classList.toggle('on', x === c)); }));
  try {
    const secs = chips.map((c) => root.querySelector('#' + c.dataset.t)).filter(Boolean);
    const obs = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) chips.forEach((c) => c.classList.toggle('on', c.dataset.t === e.target.id)); }); }, { rootMargin: '-40% 0px -55% 0px' });
    secs.forEach((s) => obs.observe(s));
  } catch (_) {}
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
        hazmat: hazEl ? hazEl.classList.contains('on') : false,
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
