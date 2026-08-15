// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// lcOnboard.js — LoadBoot live-chat onboarding concierge (marketing site).
// Runs INSIDE the live chat widget (liveChatCore.js) via the LBChat._ob extension hooks.
// Full signup + onboarding without leaving the chat: role → FMCSA verify → contact →
// password (real email + password signup, same as the portal) → role-specific steps → done.
// The visitor chooses a real password here and signs in at their portal with the SAME
// email + password afterwards (no magic link, no passwordless account they can't log into).
// SECURITY: the password is POSTed straight to /auth/v1/signup and lives only in a local
// variable — it is NEVER put on state, never sent to lc_ob_save / rpc(), never added as a
// chat message, and therefore is never persisted anywhere in the chat transcript or CRM.
// A "reset my password" intent (or LBChatOnboard.reset()) drives /auth/v1/recover.
// Dispatchers fork right after the role card: dispatcher_intent = 'job' (applying for a
// salaried dispatcher seat) or 'independent' (brings their own carriers for the 1% agent
// commission) — both still end up with a real 'agent' account, but the questions and the
// closing copy differ, and a job application is written to the transcript as one clear note.
// State is saved server-side per visitor (lc_ob_get / lc_ob_save), so a visitor can leave,
// come back days later, ask other questions mid-flow — and resume exactly where they left off.
(function () {
  if (typeof window === 'undefined' || window.LBChatOnboard) return;

  var CSS = [
    '.lbo-card{margin:4px 0 0 36px;max-width:84%;background:linear-gradient(180deg,#ffffff,#f6faff);border:1.5px solid #dbe9fb;border-radius:16px;border-bottom-left-radius:6px;padding:15px;box-shadow:0 8px 26px rgba(8,131,247,.12);display:flex;flex-direction:column;gap:9px;font-family:Inter,system-ui,Arial;animation:lbcUp .25s ease}',
    '.lbo-prog{display:flex;align-items:center;gap:8px}',
    '.lbo-prog-bar{flex:1;height:6px;border-radius:3px;background:#e8eff8;overflow:hidden}',
    '.lbo-prog-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#0883F7,#FC5305);transition:width .5s ease}',
    '.lbo-prog-t{font:800 10.5px Inter,Arial;color:#64748b;white-space:nowrap}',
    '.lbo-h{font:800 14px Inter,Arial;color:#10223B}',
    '.lbo-s{font:400 12.5px/1.55 Inter,Arial;color:#475569}',
    '.lbo-card label{font:700 10.5px Inter,Arial;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:-5px}',
    '.lbo-card input,.lbo-card select{border:1.5px solid #dbe4ef;border-radius:11px;padding:10px 12px;font:400 13.5px Inter,Arial;outline:none;color:#0f172a;background:#fff;width:100%;box-sizing:border-box}',
    '.lbo-card input:focus{border-color:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.12)}',
    '.lbo-btn{background:linear-gradient(135deg,#FC5305,#e34a02);color:#fff;border:none;border-radius:11px;padding:11px;font:800 13.5px Inter,Arial;cursor:pointer;transition:transform .15s;box-shadow:0 8px 20px rgba(252,83,5,.3)}',
    '.lbo-btn:hover{transform:translateY(-1px)}.lbo-btn:disabled{opacity:.5}',
    '.lbo-btn.blue{background:linear-gradient(135deg,#0883F7,#065fb8);box-shadow:0 8px 20px rgba(8,131,247,.3)}',
    '.lbo-btn.ghost{background:#fff;color:#0883F7;border:1.5px solid #cfe3fb;box-shadow:none;font-weight:700}',
    '.lbo-err{color:#dc2626;font-size:12px;display:none}',
    '.lbo-note{color:#94a3b8;font-size:10.5px;text-align:center}',
    '.lbo-co{background:#0d1f3a;background:linear-gradient(135deg,#10223B,#153055);border-radius:13px;padding:13px;color:#fff}',
    '.lbo-co b{font-size:14px;display:block;margin-bottom:6px}',
    '.lbo-co-r{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:#c7d5ea}',
    '.lbo-co-r span:last-child{color:#fff;font-weight:700;text-align:right}',
    '.lbo-ok{color:#16a34a;font-weight:800}.lbo-warn{color:#d97706;font-weight:800}.lbo-bad{color:#dc2626;font-weight:800}',
    '.lbo-verdict{border-radius:13px;padding:12px;font-size:12.5px;line-height:1.5}',
    '.lbo-verdict.pass{background:#f0fdf4;border:1.5px solid #bbf7d0;color:#14532d}',
    '.lbo-verdict.warning{background:#fffbeb;border:1.5px solid #fde68a;color:#713f12}',
    '.lbo-verdict.reject{background:#fef2f2;border:1.5px solid #fecaca;color:#7f1d1d}',
    '.lbo-verdict.queued{background:#eff6ff;border:1.5px solid #bfdbfe;color:#1e3a8a}',
    '.lbo-vh{font-weight:800;font-size:13px;margin-bottom:5px;display:flex;align-items:center;gap:6px}',
    '.lbo-issue{margin:6px 0 0;padding:8px 10px;background:rgba(255,255,255,.6);border-radius:9px}',
    '.lbo-issue b{display:block;font-size:12px}.lbo-issue i{font-style:normal;color:#334155;font-size:11.5px}',
    '.lbo-drop{border:2px dashed #b6d5f7;border-radius:13px;padding:18px 12px;text-align:center;font:600 12.5px Inter,Arial;color:#0b62b8;cursor:pointer;background:#f6faff;transition:all .15s}',
    '.lbo-drop:hover,.lbo-drop.on{background:#e9f3fe;border-color:#0883F7}',
    '.lbo-done{background:linear-gradient(135deg,#10223B,#14335c);border-radius:14px;padding:16px;color:#fff;text-align:center}',
    '.lbo-done .big{font-size:30px}.lbo-done b{display:block;font-size:15px;margin:5px 0 3px}.lbo-done p{font-size:12px;color:#c7d5ea;margin:0 0 10px}',
    '.lbo-resume{display:flex;align-items:center;gap:9px;margin:4px 0 0 36px;max-width:84%;background:linear-gradient(135deg,#10223B,#153055);border-radius:14px;padding:11px 13px;color:#fff;cursor:pointer;box-shadow:0 10px 28px rgba(2,12,30,.35);animation:lbcUp .25s ease}',
    '.lbo-resume b{font-size:12.5px;display:block}.lbo-resume i{font-style:normal;font-size:11px;color:#9fb3cc}',
    '.lbo-resume .go{margin-left:auto;background:#FC5305;border-radius:9px;padding:7px 11px;font:800 11.5px Inter,Arial;white-space:nowrap}'
  ].join('');

  // Signup metadata shape matters: the handle_new_user() DB trigger branches on
  // raw_user_meta_data->>'role' — 'agent' builds a referrer + agent_profile, 'driver'
  // skips the org, anything else (or absent) creates a carrier organization. So carrier,
  // broker and shipper must NOT send a 'role' key at all.
  function metaBase(s) {
    return {
      name: s.data.contact_name || null,
      company: s.data.company || (s.data.fmcsa && s.data.fmcsa.legal_name) || null,
      phone: s.data.phone || null
    };
  }
  function metaWith(s, extra) {
    var m = metaBase(s);
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) m[k] = extra[k]; } }
    return m;
  }

  var ROLES = {
    carrier:    { icon: '🚚', label: 'Carrier / Owner-operator', portal: '/app/carrier/', mins: 'about 5 minutes',
      meta: function (s) { return metaBase(s); },
      pitch: "Smart move. Here's what you get: <b>verified loads only</b> (zero ghost loads), detention & TONU <b>pre-agreed in writing</b> on every load, GPS proof that gets you paid, and a flat <b>5% only when we book you</b> — $0 monthly. Setup takes ~5 minutes right here." },
    broker:     { icon: '🏢', label: 'Freight Broker', portal: '/app/partner/', mins: 'about 3 minutes',
      meta: function (s) { return metaWith(s, { partner_kind: 'broker' }); },
      pitch: "Welcome! Brokers post loads <b>100% free — forever</b>. Every carrier is FMCSA-verified before they can book, you get live GPS + geofenced arrive/depart stamps, automatic document collection, and zero double-brokering. Let's get your account up in ~3 minutes." },
    shipper:    { icon: '📦', label: 'Shipper', portal: '/app/partner/', mins: 'about 3 minutes',
      meta: function (s) { return metaWith(s, { partner_kind: 'shipper' }); },
      pitch: "Great choice. Direct-to-carrier shipping: <b>no broker margin stacking</b>, FMCSA-verified carriers, live GPS tracking with photo proof of delivery, and one transparent rate. You'll see exactly which truck has your freight, 24/7. ~3 minutes to set up." },
    dispatcher: { icon: '🧑‍✈️', label: 'Dispatcher', portal: '/app/agent/', mins: 'about 3 minutes',
      meta: function (s) { return metaWith(s, { role: 'agent' }); },
      pitch: "We work with sharp dispatchers. Depending on what you're after — a dispatcher seat with LoadBoot or bringing your carriers onto the platform — I'll set you up and route you to the right team. ~3 minutes." },
    agent:      { icon: '📣', label: 'Referral Partner', portal: '/app/agent/', mins: 'about 2 minutes',
      meta: function (s) { return metaWith(s, { role: 'agent' }); },
      pitch: "Our Referral Partner program pays <b>1% of gross</b> on every load your referred carriers run — for as long as they run. Refer 5 active trucks and it's real monthly income. Account takes ~3 minutes." }
  };

  var ob = null, host = null, saveT = null;

  function H() { return window.LBChat && window.LBChat._ob; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  function state() {
    if (!ob) ob = { role: null, step: 'role', data: {}, active: false };
    return ob;
  }

  async function rpc(fn, args) {
    var c = H().ctx();
    var r = await fetch(c.cfg.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: c.cfg.anon, Authorization: 'Bearer ' + c.cfg.anon },
      body: JSON.stringify(args)
    });
    return r.json();
  }

  function save(patch, note) {
    var s = state(); var c = H().ctx();
    try {
      rpc('lc_ob_save', {
        p_visitor_key: c.vKey, p_conversation_id: c.convId || null, p_role: s.role,
        p_step_key: s.step, p_patch: patch || null, p_note: note || null,
        p_account_email: null, p_account_created: null, p_completed: null
      });
    } catch (e) {}
  }

  function card() {
    clearCards();
    var n = el('div', 'lbo-card');
    host = n;
    H().insertNode(n);
    return n;
  }
  function clearCards() {
    try {
      document.querySelectorAll('.lbo-card,.lbo-resume').forEach(function (x) { x.remove(); });
    } catch (e) {}
  }
  function prog(n, pct, txt) {
    var w = el('div', 'lbo-prog');
    w.appendChild(el('div', 'lbo-prog-bar', '<div class="lbo-prog-fill" style="width:' + pct + '%"></div>'));
    w.appendChild(el('div', 'lbo-prog-t', txt));
    n.appendChild(w);
  }
  var CARRIER_STEPS = ['role', 'mc', 'contact', 'password', 'docs', 'w9', 'sign', 'done'];
  function steps(role) {
    switch (role) {
      case 'carrier': return CARRIER_STEPS;
      case 'broker': return ['role', 'contact', 'password', 'authority', 'done'];
      case 'shipper': return ['role', 'contact', 'password', 'prefs', 'done'];
      case 'dispatcher': return ['role', 'intent', 'contact', 'password', 'prefs', 'done'];
      case 'agent': return ['role', 'contact', 'password', 'prefs', 'done'];
      default: return CARRIER_STEPS;
    }
  }
  // Next step after the password card, per role.
  function afterPassword(role) {
    if (role === 'carrier') return function () { stepDocs(0); };
    if (role === 'broker') return stepAuthority;
    return stepPrefs;
  }
  function pctFor(role, step) {
    var ss = steps(role || 'carrier'); var i = ss.indexOf(step); if (i < 0) i = 0;
    return Math.round((i / (ss.length - 1)) * 100);
  }
  function stepNum(role, step) { var ss = steps(role || 'carrier'); return (ss.indexOf(step) + 1) + ' of ' + ss.length; }

  // ---------- STEP: role ----------
  function stepRole() {
    var s = state(); s.active = true; s.step = 'role';
    var n = card();
    prog(n, 2, 'Step 1');
    n.appendChild(el('div', 'lbo-h', "Let's get you set up 🚀"));
    n.appendChild(el('div', 'lbo-s', 'Everything happens right here in chat — account, verification, documents. First: which one are you?'));
    Object.keys(ROLES).forEach(function (k) {
      var b = el('button', 'lbo-btn ghost', ROLES[k].icon + '  ' + ROLES[k].label);
      b.type = 'button';
      b.onclick = function () { pickRole(k); };
      n.appendChild(b);
    });
    // Returning users: sign in right here and get a live picture of their setup —
    // what's done, what's missing, and their verification status.
    n.appendChild(el('div', 'lbo-note', '— or —'));
    var si = el('button', 'lbo-btn ghost', '🔑 I already have an account — sign in');
    si.type = 'button';
    si.onclick = function () { H().addMsg('visitor', '🔑 I already have an account'); stepSignIn(); };
    n.appendChild(si);
  }
  function pickRole(k) {
    var s = state(); s.role = k;
    H().addMsg('visitor', ROLES[k].icon + ' ' + ROLES[k].label);
    save({ role_label: ROLES[k].label }, '📋 Onboarding started — role: ' + k);
    var n = card();
    prog(n, 12, 'Step ' + stepNum(k, k === 'carrier' ? 'mc' : k === 'dispatcher' ? 'intent' : 'contact'));
    n.appendChild(el('div', 'lbo-h', ROLES[k].icon + ' Perfect.'));
    n.appendChild(el('div', 'lbo-s', ROLES[k].pitch));
    n.appendChild(el('div', 'lbo-s', "That's <b>" + steps(k).length + ' quick steps</b> — ' + ROLES[k].mins + '. You can stop any time and pick up right where you left off.'));
    var go = el('button', 'lbo-btn', k === 'carrier' ? "Let's verify my authority →" : "Let's do it →");
    go.type = 'button';
    go.onclick = function () { if (k === 'carrier') stepMC(); else if (k === 'dispatcher') stepIntent(); else stepContact(); };
    n.appendChild(go);
  }

  // ---------- STEP: intent (dispatcher only) ----------
  // Two very different people pick "Dispatcher": someone applying for a salaried seat on our
  // desk, and an independent dispatcher bringing their own carriers. dispatcher_intent decides
  // which questions stepPrefs asks and how stepDone signs off.
  var INTENTS = [
    ['job', '💼  A dispatcher job at LoadBoot'],
    ['independent', '🤝  I dispatch for my own carriers']
  ];
  function stepIntent() {
    var s = state(); s.step = 'intent'; save(null, null);
    var n = card();
    prog(n, pctFor(s.role, 'intent'), 'Step ' + stepNum(s.role, 'intent'));
    n.appendChild(el('div', 'lbo-h', '🧑‍✈️ Which one are you after?'));
    n.appendChild(el('div', 'lbo-s', "Both doors are open. We hire dispatchers onto our own desk (that's a paid seat at LoadBoot), and we work with independent dispatchers who bring the carriers they already run and earn <b>1% of gross</b> on every load. There's no wrong answer — pick the one that fits and I'll ask the right questions."));
    INTENTS.forEach(function (d) {
      var b = el('button', 'lbo-btn ghost', d[1]);
      b.type = 'button';
      b.onclick = function () {
        s.data.dispatcher_intent = d[0];
        H().addMsg('visitor', d[1]);
        save({ dispatcher_intent: d[0] }, '🧑‍✈️ Dispatcher intent: ' + d[0]);
        stepContact();
      };
      n.appendChild(b);
    });
  }

  // ---------- STEP: MC / FMCSA (carrier) ----------
  function stepMC() {
    var s = state(); s.step = 'mc'; save(null, null);
    var n = card();
    prog(n, pctFor(s.role, 'mc'), 'Step ' + stepNum(s.role, 'mc'));
    n.appendChild(el('div', 'lbo-h', '🔎 Your MC or USDOT number'));
    n.appendChild(el('div', 'lbo-s', "One is enough — I'll pull your company profile live from FMCSA. Nothing to type twice, nothing to upload for this part."));
    var l1 = el('label', null, 'MC or USDOT number'); n.appendChild(l1);
    var inp = document.createElement('input'); inp.placeholder = 'e.g. 123456'; inp.inputMode = 'numeric'; n.appendChild(inp);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn blue', 'Verify with FMCSA'); b.type = 'button'; n.appendChild(b);
    n.appendChild(el('div', 'lbo-note', '🔒 Read-only lookup on the official FMCSA database'));
    b.onclick = async function () {
      var v = (inp.value || '').replace(/[^0-9]/g, '');
      if (v.length < 4) { err.textContent = 'Enter your MC or USDOT number'; err.style.display = 'block'; return; }
      err.style.display = 'none'; b.disabled = true; b.textContent = 'Checking FMCSA…';
      var c = H().ctx();
      try {
        var isDot = v.length >= 7;
        var r = await fetch(c.cfg.url + '/functions/v1/fmcsa-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: c.cfg.anon, Authorization: 'Bearer ' + c.cfg.anon },
          body: JSON.stringify(isDot ? { dot: v, mc: null, carrier_org: null } : { mc: v, dot: null, carrier_org: null })
        });
        var d = await r.json();
        if (!r.ok || (d && d.error)) throw new Error((d && d.error) || 'lookup failed');
        var g = function (k) {
          var cc = k.replace(/_([a-z])/g, function (_, x) { return x.toUpperCase(); });
          var srcs = [d, d && d.result, d && d.carrier, d && d.snapshot];
          for (var i = 0; i < srcs.length; i++) { var src = srcs[i]; if (src && (src[k] != null || src[cc] != null)) return src[k] != null ? src[k] : src[cc]; }
          return null;
        };
        var name = g('legal_name') || g('name') || '';
        if (!name) throw new Error('No FMCSA record found for that number — double-check it, or type it again.');
        s.data.fmcsa = { legal_name: name, dot: g('dot') || g('dot_number') || (isDot ? v : null), mc: g('mc') || g('mc_number') || (isDot ? null : v), authority: g('authority_status') || g('authority') || g('operating_status') || null, safety: g('safety_rating') || null, oos: g('out_of_service'), trucks: g('power_units') || null };
        showFmcsaCard();
      } catch (e) {
        b.disabled = false; b.textContent = 'Verify with FMCSA';
        err.textContent = (e && e.message) || 'FMCSA lookup failed — try again';
        err.style.display = 'block';
      }
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); b.click(); } });
  }
  function showFmcsaCard() {
    var s = state(); var f = s.data.fmcsa;
    save({ fmcsa: f }, '🔎 FMCSA verified in chat: ' + f.legal_name + ' (MC ' + (f.mc || '—') + ' / DOT ' + (f.dot || '—') + ') authority: ' + (f.authority || '—'));
    var n = card();
    prog(n, pctFor(s.role, 'mc') + 8, 'Verified');
    var co = el('div', 'lbo-co');
    co.appendChild(el('b', null, '✓ ' + esc(f.legal_name)));
    var rows = [['USDOT', f.dot], ['MC', f.mc], ['Authority', f.authority], ['Safety rating', f.safety || 'none'], ['Power units', f.trucks]];
    rows.forEach(function (r) { if (r[1] != null && r[1] !== '') co.appendChild(el('div', 'lbo-co-r', '<span>' + r[0] + '</span><span>' + esc(r[1]) + '</span>')); });
    n.appendChild(co);
    n.appendChild(el('div', 'lbo-s', 'Straight from the FMCSA database. Is this you?'));
    var yes = el('button', 'lbo-btn', "✓ Yes, that's my company"); yes.type = 'button';
    var no = el('button', 'lbo-btn ghost', '✗ Not me — try another number'); no.type = 'button';
    yes.onclick = function () { H().addMsg('visitor', "✓ Yes, that's my company"); stepContact(); };
    no.onclick = function () { stepMC(); };
    n.appendChild(yes); n.appendChild(no);
  }

  // ---------- STEP: contact ----------
  function stepContact() {
    var s = state(); s.step = 'contact'; save(null, null);
    var n = card();
    prog(n, pctFor(s.role, 'contact'), 'Step ' + stepNum(s.role, 'contact'));
    n.appendChild(el('div', 'lbo-h', '👤 Your contact details'));
    n.appendChild(el('div', 'lbo-s', s.role === 'carrier' ? 'Who should dispatch and payments talk to?' : 'Who should we set the account up for?'));
    var f = {};
    [['name', 'Full name', 'e.g. John Carter', 'text'], ['email', 'Email', 'you@company.com', 'email'], ['phone', 'Phone (US)', '(555) 555-5555', 'tel']].forEach(function (d) {
      n.appendChild(el('label', null, d[1]));
      var i = document.createElement('input'); i.placeholder = d[2]; i.type = d[3];
      if (d[0] === 'name' && s.data.contact_name) i.value = s.data.contact_name;
      if (d[0] === 'email' && s.data.email) i.value = s.data.email;
      if (d[0] === 'phone' && s.data.phone) i.value = s.data.phone;
      f[d[0]] = i; n.appendChild(i);
    });
    if (s.role !== 'carrier') {
      n.appendChild(el('label', null, 'Company (optional)'));
      f.company = document.createElement('input'); f.company.placeholder = 'Company name';
      if (s.data.company) f.company.value = s.data.company;
      n.appendChild(f.company);
    }
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn', 'Continue →'); b.type = 'button'; n.appendChild(b);
    n.appendChild(el('div', 'lbo-note', '🔒 Private — never sold, never spammed'));
    b.onclick = function () {
      var nm = f.name.value.trim(), em = f.email.value.trim(), ph = f.phone.value.replace(/[^0-9+]/g, '');
      if (nm.length < 2) { err.textContent = 'Please enter your name'; err.style.display = 'block'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { err.textContent = "That email doesn't look right"; err.style.display = 'block'; return; }
      if (ph.length < 10) { err.textContent = 'Please enter a valid US phone'; err.style.display = 'block'; return; }
      s.data.contact_name = nm; s.data.email = em; s.data.phone = ph;
      if (f.company) s.data.company = f.company.value.trim();
      H().addMsg('visitor', '👤 ' + nm + ' · ' + em);
      save({ contact_name: nm, email: em, phone: ph, company: s.data.company || null }, '👤 Onboarding contact: ' + nm + ' · ' + em + ' · ' + ph);
      stepPassword();
    };
  }

  // ---------- STEP: password (real email + password signup, same as the portal) ----------
  // The password below never leaves this function: not saved, not rpc'd, not echoed in chat.
  function stepPassword() {
    var s = state(); s.step = 'password'; save(null, null);
    var next = afterPassword(s.role);
    var n = card();
    prog(n, pctFor(s.role, 'password'), 'Step ' + stepNum(s.role, 'password'));
    n.appendChild(el('div', 'lbo-h', '🔐 Create your password'));
    n.appendChild(el('div', 'lbo-s', 'This is the password you\'ll use to sign in at your portal with <b>' + esc(s.data.email) + '</b> — the exact same one, so pick something you\'ll remember.'));
    n.appendChild(el('label', null, 'Password'));
    var p1 = document.createElement('input'); p1.type = 'password'; p1.setAttribute('autocomplete', 'new-password'); p1.placeholder = 'At least 8 characters'; n.appendChild(p1);
    n.appendChild(el('label', null, 'Confirm password'));
    var p2 = document.createElement('input'); p2.type = 'password'; p2.setAttribute('autocomplete', 'new-password'); p2.placeholder = 'Type it again'; n.appendChild(p2);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn blue', '🔐 Create my account'); b.type = 'button'; n.appendChild(b);
    var skip = el('button', 'lbo-btn ghost', s.role === 'carrier' ? 'Skip for now → documents first' : 'Not now'); skip.type = 'button'; n.appendChild(skip);
    n.appendChild(el('div', 'lbo-note', '🔒 Sent straight to our secure sign-in system — never stored in this chat, never visible to our team.'));
    b.onclick = async function () {
      var pw = p1.value, pw2 = p2.value;
      if (pw.length < 8) { err.textContent = 'Password must be at least 8 characters'; err.style.display = 'block'; return; }
      if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) { err.textContent = 'Password needs at least one letter and one number'; err.style.display = 'block'; return; }
      if (pw !== pw2) { err.textContent = "Those two passwords don't match"; err.style.display = 'block'; return; }
      err.style.display = 'none';
      b.disabled = true; b.textContent = 'Creating your account…';
      var c = H().ctx();
      try {
        var meta = ROLES[s.role] && ROLES[s.role].meta ? ROLES[s.role].meta(s) : metaBase(s);
        var portal = (ROLES[s.role] && ROLES[s.role].portal) || '/app/carrier/';
        var r = await fetch(c.cfg.url + '/auth/v1/signup?redirect_to=' + encodeURIComponent('https://loadboot.com' + portal), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: c.cfg.anon },
          body: JSON.stringify({ email: s.data.email, password: pw, data: meta })
        });
        var d = await r.json().catch(function () { return {}; });
        var msg = (d && (d.msg || d.error_description || d.message || d.error)) || '';
        if (!r.ok) {
          if (/already registered|already exists|User already/i.test(String(msg))) return existingAccountCard(next);
          throw new Error(msg || 'Could not create the account');
        }
        save({ account_created: true }, '🔐 Account created via chat (email + password signup): ' + s.data.email + ' role=' + s.role);
        try { rpc('lc_ob_save', { p_visitor_key: c.vKey, p_conversation_id: c.convId || null, p_role: s.role, p_step_key: s.step, p_patch: null, p_note: null, p_account_email: s.data.email, p_account_created: true, p_completed: null }); } catch (e) {}
        var ok = card();
        prog(ok, pctFor(s.role, 'password') + 6, 'Account ✓');
        ok.appendChild(el('div', 'lbo-h', '✅ Account created — check your inbox!'));
        ok.appendChild(el('div', 'lbo-s', 'A verification email is on its way to <b>' + esc(s.data.email) + '</b> (check spam too). <b>Click that link to confirm your address</b>, then sign in at your portal with this email and the password you just chose. You can keep going here while it arrives.'));
        var go = el('button', 'lbo-btn', s.role === 'carrier' ? 'Next: document check →' : 'Next →'); go.type = 'button'; ok.appendChild(go);
        go.onclick = function () { next(); };
      } catch (e) {
        b.disabled = false; b.textContent = '🔐 Create my account';
        err.textContent = (e && e.message) || 'Something went wrong — try again';
        err.style.display = 'block';
      }
    };
    p2.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); b.click(); } });
    skip.onclick = function () { next(); };
  }
  function existingAccountCard(next) {
    var s = state();
    var n = card();
    n.appendChild(el('div', 'lbo-h', '👋 You already have an account'));
    n.appendChild(el('div', 'lbo-s', '<b>' + esc(s.data.email) + '</b> is already registered with LoadBoot. If you remember the password, just sign in at your portal — otherwise I can email you a reset link right now.'));
    var rst = el('button', 'lbo-btn blue', '🔑 Send me a password reset link'); rst.type = 'button'; n.appendChild(rst);
    var cont = el('button', 'lbo-btn ghost', 'Continue setup anyway →'); cont.type = 'button'; n.appendChild(cont);
    rst.onclick = function () { startReset(s.data.email); };
    cont.onclick = function () { next(); };
  }

  // ---------- STEP: authority (broker) ----------
  function stepAuthority() {
    var s = state(); s.step = 'authority'; save(null, null);
    var n = card();
    prog(n, pctFor(s.role, 'authority'), 'Step ' + stepNum(s.role, 'authority'));
    n.appendChild(el('div', 'lbo-h', '🏢 Your brokerage authority'));
    n.appendChild(el('div', 'lbo-s', 'Two quick compliance details so carriers can see you\'re legit before they book.'));
    n.appendChild(el('label', null, 'MC / brokerage authority number'));
    var mc = document.createElement('input'); mc.placeholder = 'e.g. 123456'; mc.inputMode = 'numeric'; n.appendChild(mc);
    var wrap = el('div', null);
    wrap.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font:400 12.5px/1.5 Inter,Arial;color:#475569';
    var bond = document.createElement('input'); bond.type = 'checkbox'; bond.style.cssText = 'width:16px;height:16px;margin-top:1px;flex:0 0 auto';
    var bl = el('label', null, 'I confirm we carry an active <b>$75,000 BMC-84</b> surety bond (or BMC-85 trust).');
    bl.style.cssText = 'font:400 12.5px/1.5 Inter,Arial;color:#475569;text-transform:none;letter-spacing:0;margin:0';
    wrap.appendChild(bond); wrap.appendChild(bl);
    bl.onclick = function () { bond.checked = !bond.checked; };
    n.appendChild(wrap);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn', 'Continue →'); b.type = 'button'; n.appendChild(b);
    var skip = el('button', 'lbo-btn ghost', "Skip — I'll add it in my portal"); skip.type = 'button'; n.appendChild(skip);
    b.onclick = function () {
      var v = (mc.value || '').replace(/[^0-9]/g, '');
      if (v.length < 4) { err.textContent = 'Enter your MC / brokerage authority number'; err.style.display = 'block'; return; }
      if (!bond.checked) { err.textContent = 'Please confirm your active BMC-84 surety bond'; err.style.display = 'block'; return; }
      err.style.display = 'none';
      H().addMsg('visitor', '🏢 MC ' + v + ' · BMC-84 confirmed');
      save({ broker_mc: v, bmc84_confirmed: true }, '🏢 Broker authority captured: MC ' + v + ' · $75,000 BMC-84 confirmed in chat');
      stepDone();
    };
    skip.onclick = function () { save({ authority_skipped: true }, '🏢 Broker authority skipped in chat — will collect in portal'); stepDone(); };
    mc.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); b.click(); } });
  }

  // ---------- STEP: prefs (shipper / dispatcher / agent) ----------
  var PREFS = {
    shipper: { head: '📦 About your freight', sub: 'So we can match you with the right verified carriers from day one.', fields: [
      ['ship_what', 'What do you ship?', 'e.g. palletized food, machinery, retail', 'text'],
      ['lanes', 'Typical lanes', 'e.g. Chicago to Dallas', 'text'],
      ['loads_month', 'Loads per month', 'e.g. 20', 'number']
    ] },
    agent: { head: '📣 About your network', sub: 'The more we know, the faster we can get your referral links and payouts live.', fields: [
      ['network', "Who's in your network?", 'e.g. owner-operators in Texas', 'text'],
      ['referrals_est', 'Roughly how many could you refer?', 'e.g. 15', 'number'],
      ['payout_email', 'Best email for payouts', 'you@company.com', 'email']
    ] }
  };
  // Dispatchers get one of these two, depending on dispatcher_intent. `note` is the prefix of
  // the Command Center transcript line, so the team can spot a real job application instantly.
  var DISPATCHER_PREFS = {
    job: { head: '💼 Your application', sub: 'This goes straight to the team that hires our dispatchers — the more you tell me, the faster they can come back to you.', note: '💼 DISPATCHER JOB APPLICATION —', fields: [
      ['years_dispatching', 'Years of dispatching experience', 'e.g. 4', 'text'],
      ['equipment', 'Equipment you know best', 'e.g. reefer, flatbed, power only', 'text'],
      ['hours_available', 'Which hours can you cover?', 'e.g. 8am-5pm Central, or nights', 'text'],
      ['current_company', 'Current or last company (optional)', 'Where you dispatch now', 'text'],
      ['resume_link', 'LinkedIn or résumé link (optional)', 'linkedin.com/in/…', 'text'],
      ['pay_expected', 'Expected monthly pay (USD) (optional)', 'e.g. 3500', 'text']
    ] },
    independent: { head: '🤝 Your book of business', sub: 'So we can size your desk, set up your agent commission and get your carriers moved across without a mess.', note: '🤝 INDEPENDENT DISPATCHER —', fields: [
      ['carriers_today', 'How many carriers do you dispatch for today?', 'e.g. 8', 'text'],
      ['equipment', 'Equipment they run', 'e.g. reefer, flatbed, power only', 'text'],
      ['carriers_bringing', 'Roughly how many could you bring to LoadBoot?', 'e.g. 5', 'text'],
      ['payout_email', 'Best email for commission payouts', 'you@company.com', 'email']
    ] }
  };
  function prefsCfg(s) {
    if (s.role === 'dispatcher') return s.data.dispatcher_intent === 'job' ? DISPATCHER_PREFS.job : DISPATCHER_PREFS.independent;
    return PREFS[s.role] || PREFS.shipper;
  }
  function stepPrefs() {
    var s = state(); s.step = 'prefs'; save(null, null);
    var cfg = prefsCfg(s);
    var n = card();
    prog(n, pctFor(s.role, 'prefs'), 'Step ' + stepNum(s.role, 'prefs'));
    n.appendChild(el('div', 'lbo-h', cfg.head));
    n.appendChild(el('div', 'lbo-s', cfg.sub));
    var f = {};
    cfg.fields.forEach(function (d) {
      n.appendChild(el('label', null, d[1]));
      var i = document.createElement('input'); i.placeholder = d[2]; i.type = d[3];
      if (d[3] === 'number') i.inputMode = 'numeric';
      if (s.data[d[0]]) i.value = s.data[d[0]];
      else if (d[0] === 'payout_email' && s.data.email) i.value = s.data.email;
      f[d[0]] = i; n.appendChild(i);
    });
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn', 'Continue →'); b.type = 'button'; n.appendChild(b);
    var skip = el('button', 'lbo-btn ghost', "Skip — I'll add this later"); skip.type = 'button'; n.appendChild(skip);
    n.appendChild(el('div', 'lbo-note', '🔒 Used to match you internally — never sold, never spammed'));
    b.onclick = function () {
      var patch = {}, parts = [], any = false;
      cfg.fields.forEach(function (d) {
        var v = (f[d[0]].value || '').trim();
        patch[d[0]] = v || null;
        if (v) { any = true; parts.push(d[1] + ': ' + v); }
      });
      if (!any) { err.textContent = 'Fill in at least one answer, or tap skip'; err.style.display = 'block'; return; }
      if (patch.payout_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patch.payout_email)) { err.textContent = "That payout email doesn't look right"; err.style.display = 'block'; return; }
      err.style.display = 'none';
      cfg.fields.forEach(function (d) { if (patch[d[0]]) s.data[d[0]] = patch[d[0]]; });
      H().addMsg('visitor', cfg.head.slice(0, 2) + ' ' + parts.join(' · '));
      save(patch, cfg.note
        ? cfg.note + ' ' + parts.join(' · ')
        : cfg.head.slice(0, 2) + ' ' + s.role + ' details captured in chat — ' + parts.join(' · '));
      stepDone();
    };
    skip.onclick = function () { save({ prefs_skipped: true }, '⏭️ ' + s.role + ' details skipped in chat — will collect later'); stepDone(); };
  }

  // ---------- STEP: docs (carrier) ----------
  var DOCS = [
    { key: 'coi', label: 'Certificate of Insurance (COI)', hint: 'ACORD 25 from your insurance agent — $1M auto liability, $100K cargo' },
    { key: 'authority', label: 'MC Authority letter', hint: 'Your FMCSA operating authority document' }
  ];
  function stepDocs(idx) {
    var s = state(); s.step = 'docs'; if (idx == null) idx = 0; save(null, null);
    if (idx >= DOCS.length) return stepW9();
    var doc = DOCS[idx];
    var n = card();
    prog(n, pctFor(s.role, 'docs') + idx * 4, 'Step ' + stepNum(s.role, 'docs'));
    n.appendChild(el('div', 'lbo-h', '📄 ' + doc.label));
    n.appendChild(el('div', 'lbo-s', doc.hint + ". Drop it here — I'll read it on the spot and tell you if anything's wrong <i>before</i> it costs you time."));
    var drop = el('div', 'lbo-drop', '📎 Tap to choose a file<br><span style="font-weight:400;font-size:11px;color:#64748b">PDF, JPG or PNG · max 8 MB</span>');
    n.appendChild(drop);
    var file = document.createElement('input'); file.type = 'file'; file.accept = '.pdf,.jpg,.jpeg,.png,.webp'; file.style.display = 'none';
    n.appendChild(file);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var skip = el('button', 'lbo-btn ghost', idx === DOCS.length - 1 ? "Skip — I'll add it in my portal" : 'Skip this one for now →'); skip.type = 'button'; n.appendChild(skip);
    n.appendChild(el('div', 'lbo-note', '🔒 Encrypted storage · our compliance team double-checks every AI verdict'));
    drop.onclick = function () { file.click(); };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('on'); if (e.dataTransfer.files && e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
    file.onchange = function () { if (file.files && file.files[0]) handle(file.files[0]); };
    skip.onclick = function () { save({}, '📄 Doc skipped in chat: ' + doc.key); stepDocs(idx + 1); };

    function handle(f) {
      err.style.display = 'none';
      var mime = f.type === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(f.type) ? f.type : null;
      if (!mime) { err.textContent = 'PDF, JPG or PNG only'; err.style.display = 'block'; return; }
      if (f.size > 8 * 1024 * 1024) { err.textContent = 'Max 8 MB — ask your agent for the PDF original'; err.style.display = 'block'; return; }
      drop.innerHTML = '⏳ Reading your ' + doc.label + '…<br><span style="font-weight:400;font-size:11px;color:#64748b">AI check in progress — usually under 15 seconds</span>';
      var rd = new FileReader();
      rd.onload = async function () {
        var b64 = String(rd.result).split(',')[1];
        var c = H().ctx();
        try {
          var r = await fetch(c.cfg.url + '/functions/v1/lc-doc-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: c.cfg.anon, Authorization: 'Bearer ' + c.cfg.anon },
            body: JSON.stringify({ visitor_key: c.vKey, conv_id: c.convId || null, doc_type: doc.key, filename: f.name, mime: mime, data_b64: b64, context: s.data.fmcsa ? { legal_name: s.data.fmcsa.legal_name, mc: s.data.fmcsa.mc, dot: s.data.fmcsa.dot, power_units: s.data.fmcsa.trucks } : {} })
          });
          var d = await r.json();
          if (!r.ok || d.error) throw new Error(d.detail || d.error || 'check failed');
          renderVerdict(doc, idx, d.verdict);
        } catch (e) {
          drop.innerHTML = '📎 Tap to choose a file<br><span style="font-weight:400;font-size:11px;color:#64748b">PDF, JPG or PNG · max 8 MB</span>';
          err.textContent = 'Upload hiccup — please try again (' + ((e && e.message) || '') + ')';
          err.style.display = 'block';
        }
      };
      rd.readAsDataURL(f);
    }
  }
  function renderVerdict(doc, idx, v) {
    var s = state();
    var n = card();
    var kind = v.verdict === 'pass' ? 'pass' : v.verdict === 'queued' ? 'queued' : v.verdict === 'warning' ? 'warning' : 'reject';
    var icon = kind === 'pass' ? '✅' : kind === 'queued' ? '📥' : kind === 'warning' ? '⚠️' : '❌';
    var title = kind === 'pass' ? 'Looks good!' : kind === 'queued' ? 'Received — manual review' : kind === 'warning' ? 'Almost — please double-check' : "This one won't fly";
    var box = el('div', 'lbo-verdict ' + kind);
    box.appendChild(el('div', 'lbo-vh', icon + ' ' + esc(v.doc_label || doc.label) + ' — ' + title));
    box.appendChild(el('div', null, esc(v.summary || '')));
    (v.issues || []).forEach(function (i) {
      var it = el('div', 'lbo-issue');
      it.appendChild(el('b', null, (i.severity === 'reject' ? '❌ ' : '⚠️ ') + esc(i.problem)));
      it.appendChild(el('i', null, '💡 ' + esc(i.fix || '')));
      box.appendChild(it);
    });
    n.appendChild(box);
    if (kind === 'reject') {
      var re = el('button', 'lbo-btn', '🔁 Upload a corrected file'); re.type = 'button';
      re.onclick = function () { stepDocs(idx); };
      n.appendChild(re);
      var sk = el('button', 'lbo-btn ghost', "I'll fix it later — continue →"); sk.type = 'button';
      sk.onclick = function () { stepDocs(idx + 1); };
      n.appendChild(sk);
    } else {
      var go = el('button', 'lbo-btn', idx + 1 >= DOCS.length ? 'Next: W-9 (2-min form) →' : 'Next document →'); go.type = 'button';
      go.onclick = function () { stepDocs(idx + 1); };
      n.appendChild(go);
    }
  }

  // ---------- STEP: W-9 guided form (no upload — same interview as the carrier portal) ----------
  var W9_CLASSES = ['Individual / sole proprietor', 'C Corporation', 'S Corporation', 'Partnership', 'Trust / estate', 'Limited liability company (LLC)'];
  function stepW9() {
    var s = state(); s.step = 'w9'; save(null, null);
    var n = card();
    prog(n, pctFor(s.role, 'w9'), 'Step ' + stepNum(s.role, 'w9'));
    n.appendChild(el('div', 'lbo-h', '🧾 Form W-9 — fill it right here'));
    n.appendChild(el('div', 'lbo-s', "No printing, no scanning. Answer these and I'll prepare your W-9 exactly like the IRS form — needed before your first settlement."));
    var f = {};
    n.appendChild(el('label', null, '1 · Name (as on your tax return)'));
    f.name = document.createElement('input'); f.name.value = s.data.contact_name || ''; n.appendChild(f.name);
    n.appendChild(el('label', null, '2 · Business name (if different)'));
    f.business = document.createElement('input'); f.business.placeholder = 'Optional';
    if (s.data.fmcsa && s.data.fmcsa.legal_name) f.business.value = s.data.fmcsa.legal_name;
    n.appendChild(f.business);
    n.appendChild(el('label', null, '3 · Federal tax classification'));
    f.cls = document.createElement('select');
    W9_CLASSES.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; f.cls.appendChild(o); });
    n.appendChild(f.cls);
    n.appendChild(el('label', null, '5 · Street address'));
    f.addr = document.createElement('input'); f.addr.placeholder = '123 Main St'; n.appendChild(f.addr);
    n.appendChild(el('label', null, '6 · City, State, ZIP'));
    f.csz = document.createElement('input'); f.csz.placeholder = 'Dallas, TX 75201'; n.appendChild(f.csz);
    n.appendChild(el('label', null, 'Part I · EIN or SSN'));
    f.tin = document.createElement('input'); f.tin.placeholder = 'XX-XXXXXXX'; f.tin.inputMode = 'numeric'; n.appendChild(f.tin);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn', 'Continue to signature →'); b.type = 'button'; n.appendChild(b);
    var skip = el('button', 'lbo-btn ghost', "Skip — I'll do it in my portal"); skip.type = 'button'; n.appendChild(skip);
    n.appendChild(el('div', 'lbo-note', '🔒 Your TIN is stored encrypted server-side and masked everywhere it is shown'));
    b.onclick = function () {
      var tin = f.tin.value.replace(/[^0-9]/g, '');
      if (f.name.value.trim().length < 2) { err.textContent = 'Name is required'; err.style.display = 'block'; return; }
      if (f.addr.value.trim().length < 4 || f.csz.value.trim().length < 4) { err.textContent = 'Address and City/State/ZIP are required'; err.style.display = 'block'; return; }
      if (tin.length !== 9) { err.textContent = 'EIN/SSN must be 9 digits'; err.style.display = 'block'; return; }
      s.data.w9 = { name: f.name.value.trim(), business_name: f.business.value.trim() || null, classification: f.cls.value, address: f.addr.value.trim(), city_state_zip: f.csz.value.trim(), tin: tin };
      w9Sign();
    };
    skip.onclick = function () { save({ w9_skipped: true }, '🧾 W-9 skipped in chat — will complete in portal'); stepAgreement(); };
  }
  function w9Sign() {
    var s = state();
    var n = card();
    prog(n, pctFor(s.role, 'w9') + 5, 'Sign W-9');
    n.appendChild(el('div', 'lbo-h', '✍️ Certify & sign your W-9'));
    var cert = el('div', 'lbo-s', '<b>Part II — Certification.</b> Under penalties of perjury, I certify that: (1) the number shown on this form is my correct taxpayer identification number; (2) I am not subject to backup withholding; (3) I am a U.S. person. I consent to sign electronically (ESIGN/UETA).');
    cert.style.cssText = 'background:#f8fafc;border:1px solid #e6edf5;border-radius:11px;padding:10px;font-size:11.5px';
    n.appendChild(cert);
    n.appendChild(el('label', null, 'Type your full legal name to sign'));
    var sig = document.createElement('input'); sig.placeholder = s.data.w9.name; sig.style.fontFamily = 'cursive'; sig.style.fontSize = '17px'; n.appendChild(sig);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn', '✍️ Sign my W-9'); b.type = 'button'; n.appendChild(b);
    b.onclick = function () {
      var v = sig.value.trim();
      if (v.toLowerCase() !== s.data.w9.name.toLowerCase()) { err.textContent = 'Signature must match the name exactly: ' + s.data.w9.name; err.style.display = 'block'; return; }
      b.disabled = true; b.textContent = 'Recording signature…';
      var w9 = s.data.w9; w9.signer_name = v; w9.signed_at = new Date().toISOString(); w9.esign_consent = true; w9.ua = navigator.userAgent.slice(0, 120);
      save({ w9: w9 }, '🧾 W-9 e-signed in chat — ' + v + ' · ' + w9.classification + ' · TIN **-***' + w9.tin.slice(-4) + ' (full TIN in secure onboarding record)');
      var ok = card();
      ok.appendChild(el('div', 'lbo-verdict pass', '<div class="lbo-vh">✅ W-9 signed & on file</div>Recorded with timestamp and e-sign consent. Our team countersigns and it appears in your portal under Taxes.'));
      var go = el('button', 'lbo-btn', 'Last step: Dispatch Agreement →'); go.type = 'button'; ok.appendChild(go);
      go.onclick = function () { stepAgreement(); };
    };
  }

  // ---------- STEP: Dispatch Service Agreement e-sign (same terms as the carrier portal) ----------
  var DSA_POINTS = [
    ['1 · Services', 'LoadBoot sources freight, presents options, negotiates rates and handles broker communication for you.'],
    ['2 · Independent contractor', 'LoadBoot is your dispatcher — not a broker, forwarder or motor carrier. You stay in control.'],
    ['3 · Your authority', 'You hold active USDOT/MC authority and DOT-compliant drivers.'],
    ['4 · Insurance', 'You keep $1,000,000 auto liability + $100,000 cargo in force.'],
    ['5 · Limited authorization', 'You authorize LoadBoot to talk to brokers and book loads that match YOUR stated preferences.'],
    ['6 · Communications', 'Operational communication runs through the platform, protecting your data.'],
    ['7 · Dispatch fee', '5% of gross line-haul per load booked AND delivered (e.g. $2,000 → $100). No monthly fee, no booking = no fee.'],
    ['8 · Statements & disputes', 'Itemized statements in the platform; 15-day dispute window.'],
    ['9 · TONU & accessorials', 'Cancellations, TONU, detention, layover follow the published policies you can read on the site.'],
    ['10-13 · Records, license, confidentiality, non-circumvention', 'Platform is the system of record; both sides keep data confidential; no bypassing booked broker relationships for 180 days.'],
    ['14 · Term', 'Effective on your e-signature. Either side may end it with 30 days notice.'],
    ['15-17 · Liability & general', 'Standard indemnity, force majeure and notices terms.'],
    ['18 · Electronic signature', 'Your typed signature below has the same force as a handwritten one (ESIGN/UETA).']
  ];
  function stepAgreement() {
    var s = state(); s.step = 'sign'; save(null, null);
    var n = card();
    prog(n, pctFor(s.role, 'sign'), 'Step ' + stepNum(s.role, 'sign'));
    n.appendChild(el('div', 'lbo-h', '📜 Dispatch Service Agreement'));
    n.appendChild(el('div', 'lbo-s', 'The exact agreement from the carrier portal — here are all 18 sections in plain English. The full legal text is always available in your portal and counts as the authoritative copy.'));
    var box = el('div', null);
    box.style.cssText = 'max-height:190px;overflow-y:auto;border:1px solid #e6edf5;border-radius:11px;padding:11px;background:#f8fafc';
    DSA_POINTS.forEach(function (c) {
      var it = el('div', null, '<div style="font:800 11px Inter,Arial;color:#10223B">' + c[0] + '</div><div style="font:400 11.5px/1.5 Inter,Arial;color:#475569;margin:1px 0 8px">' + c[1] + '</div>');
      box.appendChild(it);
    });
    n.appendChild(box);
    n.appendChild(el('label', null, 'Type your full legal name to sign'));
    var sig = document.createElement('input'); sig.placeholder = s.data.contact_name || 'Full legal name'; sig.style.fontFamily = 'cursive'; sig.style.fontSize = '17px'; n.appendChild(sig);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn', '✍️ Sign the agreement'); b.type = 'button'; n.appendChild(b);
    var skip = el('button', 'lbo-btn ghost', "Skip — I'll sign in my portal"); skip.type = 'button'; n.appendChild(skip);
    n.appendChild(el('div', 'lbo-note', 'Scroll the summary above before signing · e-signature recorded with timestamp'));
    b.onclick = function () {
      var v = sig.value.trim();
      if (v.length < 3) { err.textContent = 'Type your full legal name'; err.style.display = 'block'; return; }
      b.disabled = true; b.textContent = 'Recording signature…';
      save({ dsa: { signer_name: v, signed_at: new Date().toISOString(), esign_consent: true, ua: navigator.userAgent.slice(0, 120), version: 'LB-DSA' } }, '📜 Dispatch Agreement e-signed in chat — ' + v);
      var ok = card();
      ok.appendChild(el('div', 'lbo-verdict pass', '<div class="lbo-vh">✅ Agreement signed</div>Timestamped and on file. LoadBoot countersigns and the executed copy appears in your portal.'));
      var go = el('button', 'lbo-btn', 'Finish 🎉'); go.type = 'button'; ok.appendChild(go);
      go.onclick = function () { stepDone(); };
    };
    skip.onclick = function () { save({ dsa_skipped: true }, '📜 Dispatch Agreement skipped in chat — will sign in portal'); stepDone(); };
  }

  // ---------- STEP: done ----------
  function stepDone() {
    var s = state(); s.step = 'done'; s.active = false;
    var c = H().ctx();
    // Identify at the END (CRM lead + CC identity pill) — not mid-flow, because the bot
    // acknowledges lc_identify with a chat message that would interrupt the step cards.
    if (s.data.contact_name || s.data.email) {
      try { rpc('lc_identify', { p_id: c.convId, p_visitor_key: c.vKey, p_name: s.data.contact_name || null, p_email: s.data.email || null }); } catch (e) {}
    }
    try { rpc('lc_ob_save', { p_visitor_key: c.vKey, p_conversation_id: c.convId || null, p_role: s.role, p_step_key: 'done', p_patch: null, p_note: '🎉 Onboarding COMPLETED in chat — ' + (s.data.contact_name || '') + ' (' + (s.role || '') + '). Review docs & follow up.', p_account_email: null, p_account_created: null, p_completed: true }); } catch (e) {}
    var portal = (ROLES[s.role] && ROLES[s.role].portal) || '/app/carrier/';
    var portalName = portal === '/app/partner/' ? 'Broker & shipper portal' : portal === '/app/agent/' ? 'Agent portal' : 'Carrier portal';
    var n = card();
    prog(n, 100, 'Complete 🎉');
    var d = el('div', 'lbo-done');
    d.appendChild(el('div', 'big', '🎉'));
    d.appendChild(el('b', null, (s.data.contact_name ? esc(s.data.contact_name.split(' ')[0]) + ', you' : 'You') + "'re in!"));
    var tail = ' Our team will reach out shortly to finish any details.';
    if (s.role === 'carrier') {
      tail = ' Our compliance team gives every document a human double-check — usually within a few business hours — then you\'re cleared to book.';
    } else if (s.role === 'dispatcher') {
      tail = s.data.dispatcher_intent === 'job'
        ? ' Your application is with our hiring team now — a real person reads every one and replies by email, so watch that inbox. In the meantime your account is already live, so feel free to sign in and look around.'
        : ' Your agent account is ready: your referral link and earnings dashboard are waiting inside the portal. Our team will reach out shortly to help you move your carriers across.';
    }
    d.appendChild(el('p', null, 'Sign in with <b>' + esc(s.data.email || 'this email') + '</b> and the password you just created. If you haven\'t clicked the verification email yet, open it first — that confirms your address and unlocks sign-in.' + tail));
    var a = el('a', null, 'Open my ' + portalName + ' →');
    a.href = portal;
    a.style.cssText = 'display:inline-block;background:#FC5305;color:#fff;font:800 13px Inter,Arial;padding:11px 18px;border-radius:11px;text-decoration:none';
    d.appendChild(a);
    n.appendChild(d);
    n.appendChild(el('div', 'lbo-note', 'Forgot it later? Just type "reset my password" here and I\'ll sort it out.'));
    n.appendChild(el('div', 'lbo-note', 'Questions any time — just type below. This chat stays saved for you. 💬'));
  }

  // ---------- password reset (self-serve, also reachable via LBChatOnboard.reset) ----------
  // ---- Existing-account sign-in: chat checks the account live and resumes onboarding ----
  // The password goes ONLY to the auth endpoint and the field is wiped immediately after
  // the request — it never enters save()/state/chat history, same rule as signup.
  function stepSignIn(prefillEmail) {
    var s = state();
    var n = card();
    n.appendChild(el('div', 'lbo-h', '🔑 Sign in to your account'));
    n.appendChild(el('div', 'lbo-s', "I'll check exactly where your setup stands — what's done, what's left, and your verification status."));
    n.appendChild(el('label', null, 'Email'));
    var em = document.createElement('input'); em.type = 'email'; em.placeholder = 'you@company.com'; em.setAttribute('autocomplete', 'email');
    if (prefillEmail) em.value = prefillEmail; else if (s.data.email) em.value = s.data.email;
    n.appendChild(em);
    n.appendChild(el('label', null, 'Password'));
    var pw = document.createElement('input'); pw.type = 'password'; pw.placeholder = '••••••••'; pw.setAttribute('autocomplete', 'current-password');
    n.appendChild(pw);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn blue', '→ Sign in & check my status'); b.type = 'button'; n.appendChild(b);
    var rst = el('button', 'lbo-btn ghost', 'Forgot password?'); rst.type = 'button'; n.appendChild(rst);
    n.appendChild(el('div', 'lbo-note', '🔒 Checked against our secure sign-in system — your password is never stored in this chat.'));
    rst.onclick = function () { startReset((em.value || '').trim()); };
    function fail(msg) { err.textContent = msg; err.style.display = 'block'; b.disabled = false; b.textContent = '→ Sign in & check my status'; }
    b.onclick = async function () {
      var e9 = (em.value || '').trim(); var p9 = pw.value || '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e9)) return fail("That email doesn't look right");
      if (!p9) return fail('Enter your password');
      err.style.display = 'none'; b.disabled = true; b.textContent = 'Checking…';
      var c = H().ctx();
      try {
        var r = await fetch(c.cfg.url + '/auth/v1/token?grant_type=password', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: c.cfg.anon },
          body: JSON.stringify({ email: e9, password: p9 }),
        });
        var d = await r.json().catch(function () { return {}; });
        pw.value = ''; p9 = '';
        if (!r.ok || !d.access_token) {
          if ((d.error_code || d.error) === 'email_not_confirmed') return fail('This email is not confirmed yet — check your inbox for the confirmation link (spam too).');
          return fail('Email or password is wrong. Try again, or tap "Forgot password?" below.');
        }
        var r2 = await fetch(c.cfg.url + '/rest/v1/rpc/cc_chat_onboarding_status', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: c.cfg.anon, Authorization: 'Bearer ' + d.access_token },
          body: '{}',
        });
        var st = await r2.json().catch(function () { return null; });
        if (!r2.ok || !st || !st.kind) return fail('Signed in fine, but I could not read your account status — open your portal directly and it will all be there.');
        H().addMsg('visitor', '🔑 Signed in: ' + e9);
        save({ email: e9, signin_kind: st.kind, signin_status: st.verdict },
          '🔑 Existing user signed in via chat — ' + st.kind + (st.company ? ' (' + st.company + ')' : '') + ' · status: ' + st.verdict);
        showAccountStatus(st);
      } catch (x) { fail('Connection hiccup — give it another try.'); }
    };
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); b.click(); } });
  }
  function showAccountStatus(d) {
    var n = card();
    var head, sub;
    if (d.verdict === 'verified') {
      head = '🎉 You are fully verified';
      sub = 'Everything is approved' + (d.company ? ' for <b>' + esc(d.company) + '</b>' : '') + ' — your account is live.';
    } else if (d.verdict === 'in_review') {
      head = '⏳ Submitted — in verification';
      sub = 'Your file is with our review team (usually done within 1 business day). Nothing else is needed from you right now — you will get an email + notification the moment it clears.';
    } else if (d.verdict === 'ready_to_submit') {
      head = '✅ Everything is in — one click left';
      sub = 'Every item is done. Open your dashboard and press <b>Submit for review</b> — that is the only thing left.';
    } else {
      head = '📋 Almost there — here is exactly what is left';
      sub = 'Ticked items are done. Finish the open ones in your portal and press Submit for review.';
    }
    n.appendChild(el('div', 'lbo-h', head));
    n.appendChild(el('div', 'lbo-s', sub));
    var i, done = d.done || [], miss = d.missing || [];
    for (i = 0; i < done.length; i++) n.appendChild(el('div', 'lbo-s', '✅ ' + esc(done[i])));
    for (i = 0; i < miss.length; i++) n.appendChild(el('div', 'lbo-s', '⬜ <b>' + esc(miss[i]) + '</b>'));
    var go = el('button', 'lbo-btn blue', d.verdict === 'verified' ? '🚀 Open my portal' : '📂 Open my portal & finish');
    go.type = 'button'; n.appendChild(go);
    go.onclick = function () { window.open(d.portal || '/app/carrier/', '_blank'); };
    n.appendChild(el('div', 'lbo-note', 'Anything unclear about an item? Just type the question here — I am right here.'));
  }
  function startReset(prefillEmail) {
    var n = card();
    n.appendChild(el('div', 'lbo-h', '🔑 Reset your password'));
    n.appendChild(el('div', 'lbo-s', 'No problem — which portal do you sign in to? I\'ll send the reset link so it drops you back in the right place.'));
    Object.keys(ROLES).forEach(function (k) {
      var b = el('button', 'lbo-btn ghost', ROLES[k].icon + ' ' + ROLES[k].label);
      b.type = 'button';
      b.onclick = function () { resetEmailCard(k, prefillEmail); };
      n.appendChild(b);
    });
  }
  function resetEmailCard(k, prefillEmail) {
    var s = state();
    var n = card();
    n.appendChild(el('div', 'lbo-h', '🔑 Where should I send the link?'));
    n.appendChild(el('div', 'lbo-s', 'Enter the email on your LoadBoot account. The reset link takes you to your ' + esc(ROLES[k].label) + ' portal once you\'ve chosen a new password.'));
    n.appendChild(el('label', null, 'Email'));
    var inp = document.createElement('input'); inp.type = 'email'; inp.placeholder = 'you@company.com';
    inp.setAttribute('autocomplete', 'email');
    if (prefillEmail) inp.value = prefillEmail;
    else if (s.data.email) inp.value = s.data.email;
    n.appendChild(inp);
    var err = el('div', 'lbo-err'); n.appendChild(err);
    var b = el('button', 'lbo-btn blue', '✉️ Email me a reset link'); b.type = 'button'; n.appendChild(b);
    n.appendChild(el('div', 'lbo-note', '🔒 Handled by our secure sign-in system — passwords are never typed or stored in this chat.'));
    b.onclick = async function () {
      var em = (inp.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { err.textContent = "That email doesn't look right"; err.style.display = 'block'; return; }
      err.style.display = 'none';
      b.disabled = true; b.textContent = 'Sending…';
      var c = H().ctx();
      try {
        await fetch(c.cfg.url + '/auth/v1/recover?redirect_to=' + encodeURIComponent('https://loadboot.com' + ROLES[k].portal), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: c.cfg.anon },
          body: JSON.stringify({ email: em })
        });
      } catch (e) {}
      // Same answer either way — never reveal whether an account exists for this address.
      try { save({ reset_requested: true }, '🔑 Password reset link requested in chat for ' + em); } catch (e) {}
      var ok = card();
      ok.appendChild(el('div', 'lbo-h', '✉️ Check your inbox'));
      ok.appendChild(el('div', 'lbo-s', 'If that email has a LoadBoot account, a reset link is on its way. Open it and choose a new password — then sign in at your portal.'));
      var a = el('a', null, 'Go to my portal →');
      a.href = ROLES[k].portal;
      a.style.cssText = 'display:inline-block;text-align:center;background:#0883F7;color:#fff;font:800 13px Inter,Arial;padding:11px 18px;border-radius:11px;text-decoration:none';
      ok.appendChild(a);
      ok.appendChild(el('div', 'lbo-note', 'Nothing after a few minutes? Check spam, or just ask me here. 💬'));
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); b.click(); } });
  }

  // ---------- resume / hooks ----------
  var resumePending = false;
  function stepFor(key) {
    switch (key) {
      case 'mc': return stepMC;
      case 'intent': return stepIntent;
      case 'contact': return stepContact;
      case 'password': return stepPassword;
      case 'account': return stepPassword; // legacy key — live rows still sit on 'account'
      case 'authority': return stepAuthority;
      case 'prefs': return stepPrefs;
      case 'docs': return function () { stepDocs(0); };
      case 'w9': return stepW9;
      case 'sign': return stepAgreement;
      case 'done': return stepDone;
      default: return stepRole;
    }
  }
  function showResume(st) {
    clearCards();
    var s = state();
    s.role = st.role || s.role; s.step = st.step_key || 'role'; s.data = st.data || {}; s.active = true;
    var n = el('div', 'lbo-resume');
    var pct = pctFor(s.role, s.step);
    n.innerHTML = '<div><b>👋 Welcome back' + (s.data.contact_name ? ', ' + esc(s.data.contact_name.split(' ')[0]) : '') + '!</b><i>Your setup is ' + pct + '% done — pick up right where you left off.</i></div><span class="go">Resume ▶</span>';
    n.onclick = function () { n.remove(); stepFor(s.step)(); };
    H().insertNode(n);
  }
  async function checkResume() {
    try {
      var c = H().ctx();
      var st = await rpc('lc_ob_get', { p_visitor_key: c.vKey });
      if (st && st.exists && !st.completed && st.step_key && st.step_key !== 'role') showResume(st);
    } catch (e) {}
  }

  window.LBChatOnboard = {
    begin: function () { stepRole(); },
    reset: startReset,
    checkResume: checkResume,
    // called by liveChatCore on every rendered message
    onMsg: function (sender, body) {
      var s = state();
      if (sender === 'visitor' && /forgot .*password|reset .*password|password reset|can'?t log ?in|cannot log ?in|lost my password/i.test(String(body || ''))) {
        setTimeout(function () { if (!document.querySelector('.lbo-card')) startReset(); }, 1400);
        return;
      }
      if (sender === 'visitor' && /start (my )?(5.minute )?setup/i.test(String(body || ''))) {
        setTimeout(function () { if (!document.querySelector('.lbo-card')) stepRole(); }, 1400);
        return;
      }
      // visitor asked something else mid-flow → let the bot answer, then offer to resume
      if (sender === 'visitor' && s.active && s.step !== 'done' && !/^[✓👤📄🚚🏢📦🧑📣]/.test(String(body || ''))) resumePending = true;
      if (sender !== 'visitor' && resumePending && s.active) {
        resumePending = false;
        setTimeout(function () {
          if (document.querySelector('.lbo-card,.lbo-resume')) return;
          var n = el('div', 'lbo-resume');
          n.innerHTML = '<div><b>▶ Ready when you are</b><i>Your setup is saved at step ' + stepNum(s.role, s.step) + '.</i></div><span class="go">Resume</span>';
          n.onclick = function () { n.remove(); stepFor(s.step)(); };
          H().insertNode(n);
        }, 900);
      }
    }
  };

  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
