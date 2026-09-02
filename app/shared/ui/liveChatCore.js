// liveChatCore.js — LoadBoot live chat widget v5 (bl_lc_0312): AI assistant + real human takeover.
// Plain script (no imports) so the SAME file powers the marketing site and all portals.
// Usage: window.LBChat.mount({ url, anon, origin, getToken? })
//   url      = https://<ref>.supabase.co     anon = publishable anon key
//   origin   = 'website' | 'carrier' | 'partner' | 'agent'
//   getToken = optional async () => access_token (portals pass the user session so the chat is
//              account-aware and staff see exactly WHO is chatting; website visitors stay anonymous).
//
// What v5 changes for the visitor (the Amazon/Uber bar: what we say is what happens):
//   • Honest presence — "online" comes from a staff heartbeat, never a stale switch.
//   • A human joining is visible: system line, header flips to their name, AI badge goes quiet.
//   • Thinking state stays up until the answer lands (was auto-hidden at 8 s → people re-sent).
//   • Double-tap guard, staff-typing indicator, faster polling while a human is on the line.
//   • Rating card (1–5 + comment) when a chat closes, "Email me the transcript", "End chat".
//   • Previous chats list (per account when signed in, per browser otherwise).
//   • Portal: a signed-in carrier is greeted with their real verification state and account chips
//     (no more "which one are you?") — via lc_hello, which needs a session and creates nothing.
//   • Connection loss is shown and retried instead of silently swallowing messages.
(function () {
  if (typeof window === 'undefined' || window.LBChat) return;

  var CSS = [
    '#lbc-fab{position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;z-index:2147483646;',
    'background:linear-gradient(135deg,#0883F7,#065fb8);color:#fff;box-shadow:0 10px 30px rgba(8,131,247,.45);display:flex;align-items:center;justify-content:center;transition:transform .18s,opacity .2s}',
    '#lbc-fab:hover{transform:scale(1.07)}',
    '#lbc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#FC5305;color:#fff;font:800 11px/20px Inter,Arial;padding:0 5px;display:none}',
    '#lbc-panel{position:fixed;right:18px;bottom:86px;width:378px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 110px);',
    'background:#fff;border-radius:20px;box-shadow:0 24px 80px rgba(2,6,23,.4);z-index:2147483647;display:none;flex-direction:column;overflow:hidden;',
    'font-family:Inter,system-ui,Arial,sans-serif;animation:lbcUp .25s ease}',
    '@keyframes lbcUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    '#lbc-head{background:linear-gradient(135deg,#10223B,#0B1830);padding:14px 16px;display:flex;align-items:center;gap:12px;position:relative}',
    '#lbc-head img{height:30px;width:30px;border-radius:8px}',
    '.lbc-hav{height:32px;width:32px;border-radius:50%;background:#FC5305;color:#fff;font:800 13px/32px Inter,Arial;text-align:center;flex:none;display:none}',
    '.lbc-ht{color:#fff;font-weight:800;font-size:15px;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}',
    '.lbc-hs{color:#9fb3cc;font-size:11.5px;display:flex;align-items:center;gap:5px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}',
    '.lbc-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25);flex:none}',
    '.lbc-dot.off{background:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.25)}',
    '.lbc-hb{margin-left:auto;display:flex;gap:6px}',
    '.lbc-hb button{background:rgba(255,255,255,.1);border:none;color:#cbd5e1;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:15px;line-height:30px;padding:0}',
    '.lbc-hb button:hover{background:rgba(255,255,255,.18);color:#fff}',
    '#lbc-menu{position:absolute;top:56px;right:12px;background:#fff;border:1px solid #e6edf5;border-radius:12px;box-shadow:0 14px 40px rgba(2,6,23,.25);padding:6px;display:none;z-index:5;min-width:190px}',
    '#lbc-menu button{display:block;width:100%;text-align:left;background:none;border:none;padding:9px 12px;font:600 13px Inter,Arial;color:#0f172a;border-radius:8px;cursor:pointer}',
    '#lbc-menu button:hover{background:#f1f5f9}',
    '#lbc-net{display:none;background:#fef3c7;color:#92400e;font:600 11.5px Inter,Arial;padding:6px 12px;text-align:center}',
    '#lbc-body{flex:1;overflow-y:auto;padding:16px 14px;background:#F4F7FB;display:flex;flex-direction:column;gap:10px}',
    '.lbc-row{display:flex;gap:8px;align-items:flex-end;animation:lbcUp .2s ease}',
    '.lbc-row.me{flex-direction:row-reverse}',
    '.lbc-av{width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:14px}',
    '.lbc-av.bot{background:#10223B;color:#fff}.lbc-av.staff{background:#FC5305;color:#fff;font-weight:800;font-size:11px}',
    '.lbc-b{max-width:78%;padding:10px 13px;border-radius:16px;font-size:13.5px;line-height:1.55;word-wrap:break-word;white-space:pre-wrap}',
    '.lbc-b a{color:#0883F7;font-weight:600;text-decoration:none}.lbc-b a:hover{text-decoration:underline}',
    '.me .lbc-b{background:#0883F7;color:#fff;border-bottom-right-radius:6px}.me .lbc-b a{color:#fff;text-decoration:underline}',
    '.them .lbc-b{background:#fff;color:#0f172a;border:1px solid #e6edf5;border-bottom-left-radius:6px;box-shadow:0 1px 3px rgba(2,6,23,.05)}',
    '.staffrow .lbc-b{border-color:#fed7aa;background:#fffaf5}',
    '.lbc-who{font-size:10.5px;color:#94a3b8;margin:0 38px 2px;font-weight:600}',
    '.lbc-sys{text-align:center;font:600 11px Inter,Arial;color:#64748b;margin:2px 0;padding:0 10px}',
    '.lbc-sys span{background:#e8eef6;border-radius:999px;padding:4px 10px;display:inline-block}',
    '.lbc-day{text-align:center;font:600 10.5px Inter,Arial;color:#94a3b8;margin:4px 0 0;letter-spacing:.04em;text-transform:uppercase}',
    '.lbc-chips{display:flex;flex-wrap:wrap;gap:7px;margin:4px 0 0 36px}',
    '.lbc-chip{background:#fff;border:1.5px solid #cfe3fb;color:#0883F7;font:600 12px Inter,Arial;padding:7px 12px;border-radius:999px;cursor:pointer;transition:all .15s}',
    '.lbc-chip:hover{background:#0883F7;color:#fff;border-color:#0883F7}',
    '#lbc-typing{display:none;margin-left:38px}.lbc-tb{display:inline-flex;gap:4px;background:#fff;border:1px solid #e6edf5;padding:11px 14px;border-radius:16px;border-bottom-left-radius:6px;align-items:center}',
    '.lbc-td{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:lbcBl 1.2s infinite}',
    '.lbc-td:nth-child(2){animation-delay:.18s}.lbc-td:nth-child(3){animation-delay:.36s}',
    '.lbc-tl{font:600 11px Inter,Arial;color:#94a3b8;margin:4px 0 0 4px;display:none}',
    '@keyframes lbcBl{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}',
    '#lbc-foot{padding:10px 12px 8px;background:#fff;border-top:1px solid #eef2f7}',
    '.lbc-form{margin:2px 0 0 36px;max-width:82%;background:linear-gradient(180deg,#ffffff,#f7faff);border:1.5px solid #dbe9fb;border-radius:16px;border-bottom-left-radius:6px;padding:14px;box-shadow:0 6px 22px rgba(8,131,247,.10);display:flex;flex-direction:column;gap:8px;animation:lbcUp .25s ease}',
    '.lbc-form label{font:700 10.5px Inter,Arial;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:-4px}',
    '.lbc-form::before{content:"";display:block;height:2px;border-radius:2px;background:linear-gradient(90deg,#0883F7 0%,#0883F7 55%,#FC5305 100%);margin:-4px -2px 6px;opacity:.9}',
    '.lbc-fhead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:2px}',
    '.lbc-ftitle{font:800 12.5px Manrope,Inter,Arial;color:#0f172a;letter-spacing:-.01em;line-height:1.35}',
    '.lbc-fsub{font:400 11.5px Inter,Arial;color:#64748b;line-height:1.45;margin-top:3px}',
    '.lbc-form button.lbc-fx{flex:0 0 auto;width:26px;height:26px;min-width:26px;margin:0;border:0;background:none;box-shadow:none;color:#94a3b8;font:700 17px Inter,Arial;line-height:1;cursor:pointer;border-radius:8px;padding:0;transform:none}',
    '.lbc-form button.lbc-fx:hover{background:#eef2f7;color:#0f172a;transform:none;box-shadow:none}',
    '.lbc-form button.lbc-fskip{background:none;border:0;box-shadow:none;margin:0;color:#64748b;font:600 11.5px Inter,Arial;cursor:pointer;padding:4px 6px;text-decoration:underline;text-underline-offset:2px;border-radius:8px;transform:none}',
    '.lbc-form button.lbc-fskip:hover{color:#0f172a;background:#f1f5f9;transform:none;box-shadow:none}',
    '.lbc-form.lbc-card-past{opacity:.5}',
    '.lbc-fdone{margin:2px 0 0 36px;font:600 11.5px Inter,Arial;color:#64748b}',
    '.lbc-form input,.lbc-form textarea{border:1.5px solid #dbe4ef;border-radius:11px;padding:10px 12px;font:400 13.5px Inter,Arial;outline:none;color:#0f172a;background:#fff;width:100%;box-sizing:border-box}',
    '.lbc-form input:focus,.lbc-form textarea:focus{border-color:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.12)}',
    '.lbc-form button{margin-top:2px;background:linear-gradient(135deg,#FC5305,#e34a02);color:#fff;border:none;border-radius:11px;padding:11px;font:800 13.5px Inter,Arial;cursor:pointer;transition:transform .15s;box-shadow:0 8px 20px rgba(252,83,5,.35)}',
    '.lbc-form button:hover{transform:translateY(-1px)}.lbc-form button:disabled{opacity:.5}',
    '.lbc-form .lbc-ferr{color:#dc2626;font-size:12px;display:none}',
    '.lbc-form .lbc-fnote{color:#94a3b8;font-size:10.5px;text-align:center}',
    '.lbc-stars{display:flex;gap:6px;justify-content:center;margin:2px 0}',
    '.lbc-star{font-size:26px;line-height:1;cursor:pointer;color:#cbd5e1;background:none;border:none;padding:2px;box-shadow:none;margin:0;transition:transform .1s}',
    '.lbc-star.on{color:#f59e0b}.lbc-star:hover{transform:scale(1.15)}',
    '.lbc-chk{display:flex;align-items:center;gap:8px;font:500 12px Inter,Arial;color:#334155}.lbc-chk input{width:auto}',
    '.lbc-hist{margin:2px 0 0 36px;max-width:86%;background:#fff;border:1.5px solid #dbe9fb;border-radius:16px;border-bottom-left-radius:6px;padding:10px;display:flex;flex-direction:column;gap:6px}',
    '.lbc-hi{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;border:1px solid #eef2f7;font:500 12px Inter,Arial;color:#0f172a}',
    '.lbc-hi:hover{background:#f4f8fd;border-color:#cfe3fb}.lbc-hi small{color:#94a3b8;font-weight:600;white-space:nowrap}',
    '#lbc-form{display:flex;gap:8px;align-items:flex-end}',
    '#lbc-in{flex:1;border:1.5px solid #dbe4ef;border-radius:14px;padding:10px 13px;font:400 13.5px Inter,Arial;resize:none;max-height:90px;outline:none;color:#0f172a;background:#fff}',
    '#lbc-in:focus{border-color:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.12)}',
    '#lbc-send{width:42px;height:42px;border-radius:13px;border:none;background:#FC5305;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:transform .15s}',
    '#lbc-send:hover{transform:scale(1.06)}#lbc-send:disabled{opacity:.5}',
    '#lbc-pow{text-align:center;color:#b6c2d4;font-size:10px;margin-top:6px}',
    '#lbc-closedbar{display:none;background:#f1f5f9;border-top:1px solid #e2e8f0;color:#475569;font-size:12px;padding:9px 14px;text-align:center}',
    '#lbc-closedbar button{background:none;border:none;color:#FC5305;font-weight:800;cursor:pointer;font-size:12px}',
    '@media (max-width:520px){#lbc-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}#lbc-in,.lbc-form input,.lbc-form select,.lbc-form textarea{font-size:16px!important}}'
  ].join('');

  var cfg = null, open = false, convId = null, vKey = null, lastId = 0, pollT = null, unread = 0, started = false;
  var mode = 'bot', botPaused = false, staffName = null, online = false, awaiting = false, awaitingSince = 0;
  var status = 'open', csat = null, hasEmail = false, lastSent = { text: '', at: 0 }, lastTyped = 0, typingSent = 0;
  var netDown = false, signedIn = false, hello = null, lastDay = '', ratedShown = false, baseTitle = null, titleT = null;
  var els = {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function linkify(s) {
    // The AI may use <b>/<i>; everything else is escaped. Links, phones and emails become tappable.
    var keep = esc(s).replace(/&lt;(\/?)(b|i)&gt;/g, '<$1$2>').replace(/&lt;br\s*\/?&gt;/g, '<br>');
    return keep.replace(/(https:\/\/[^\s<]+)/g, function (u) {
      var label = u.replace('https://loadboot.com/', '').replace('.html', '').replace(/[-_]/g, ' ') || 'loadboot.com';
      if (u.indexOf('https://loadboot.com') !== 0) label = u;
      return '<a href="' + u + '" target="_blank" rel="noopener">' + esc(label) + ' →</a>';
    })
      .replace(/\+1 \(\d{3}\) \d{3}-\d{4}/g, function (p) { return '<a href="tel:' + p.replace(/[^0-9+]/g, '') + '">' + p + '</a>'; })
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, function (m) { return '<a href="mailto:' + m + '">' + m + '</a>'; });
  }

  async function api(fn, args) {
    var token = null;
    if (cfg.getToken) { try { token = await cfg.getToken(); } catch (e) {} }
    signedIn = !!token;
    var r = await fetch(cfg.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anon, Authorization: 'Bearer ' + (token || cfg.anon) },
      body: JSON.stringify(args)
    });
    var j = await r.json();
    if (!r.ok && j && !j.error) j = { error: (j.message || 'request failed') };
    return j;
  }

  function netState(down) {
    if (down === netDown) return;
    netDown = down;
    els.net.style.display = down ? 'block' : 'none';
    els.net.textContent = down ? 'Connection lost — reconnecting… your messages are kept.' : '';
  }

  // Dynamic cards (contact / call-back / chips / rating) belong to the NEWEST message only.
  function dropStaleCards() {
    var stale = els.body.querySelectorAll('.lbc-form-dyn,.lbc-callform-dyn,.lbc-chips-dyn,.lbc-hist');
    for (var i = 0; i < stale.length; i++) {
      var n = stale[i], busy = false;
      var fields = n.querySelectorAll('input,select,textarea');
      for (var k = 0; k < fields.length; k++) {
        if (fields[k] === document.activeElement || String(fields[k].value || '').trim()) busy = true;
      }
      if (busy) { n.classList.add('lbc-card-past'); continue; }
      n.remove();
    }
  }

  function dayLabel(at) {
    if (!at) return '';
    var d = new Date(at); if (isNaN(d)) return '';
    var t = new Date(); var y = new Date(); y.setDate(t.getDate() - 1);
    var same = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
    if (same(d, t)) return 'Today';
    if (same(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function sysLine(text) {
    var d = document.createElement('div'); d.className = 'lbc-sys';
    var s = document.createElement('span'); s.textContent = text; d.appendChild(s);
    els.body.insertBefore(d, els.typing);
  }

  function addMsg(sender, body, meta) {
    meta = meta || {};
    body = String(body);
    if (body.indexOf('[[note]]') === 0) return; // internal staff notes never render
    if (body.indexOf('[[sys]]') === 0) { dropStaleCards(); sysLine(body.slice(7).trim()); els.body.scrollTop = els.body.scrollHeight; return; }
    dropStaleCards();
    var dl = dayLabel(meta.at);
    if (dl && dl !== lastDay) { lastDay = dl; var dd = document.createElement('div'); dd.className = 'lbc-day'; dd.textContent = dl; els.body.insertBefore(dd, els.typing); }
    var me = sender === 'visitor';
    var chipDef = null, formDef = null;
    var cm = body.match(/\[\[chips:([\s\S]*?)\]\]/);
    if (cm) { chipDef = cm[1]; body = body.replace(cm[0], ''); }
    var fm = body.match(/\[\[form(?::([a-z, ]*))?\]\]/);
    if (fm) { formDef = (fm[1] || 'name,email'); body = body.replace(fm[0], ''); }
    var callForm = false;
    if (body.indexOf('[[callform]]') >= 0) { callForm = true; body = body.replace('[[callform]]', ''); }
    body = body.replace(/\s+$/, '');
    var who = sender === 'bot' ? 'LoadBoot AI ⚡' : sender === 'staff' ? ((meta.staff_name || staffName || 'LoadBoot Team') + ' · LoadBoot') : '';
    var html = '';
    if (!me && who) html += '<div class="lbc-who">' + esc(who) + '</div>';
    html += '<div class="lbc-row ' + (me ? 'me' : 'them') + (sender === 'staff' ? ' staffrow' : '') + '">';
    if (!me) html += '<div class="lbc-av ' + (sender === 'bot' ? 'bot' : 'staff') + '">' + (sender === 'bot' ? '⚡' : esc(((meta.staff_name || staffName || 'LB').slice(0, 1)).toUpperCase())) + '</div>';
    html += '<div class="lbc-b">' + linkify(body) + '</div></div>';
    var w = document.createElement('div');
    w.innerHTML = html;
    while (w.firstChild) els.body.insertBefore(w.firstChild, els.typing);
    if (formDef && !me) contactCard(formDef);
    if (callForm && !me) callCard();
    if (chipDef && !me) {
      els.body.querySelectorAll('.lbc-chips-dyn').forEach(function (n) { n.remove(); });
      var row = document.createElement('div');
      row.className = 'lbc-chips lbc-chips-dyn';
      chipDef.split('|').forEach(function (c) {
        var i = c.indexOf('=');
        var label = i > 0 ? c.slice(0, i) : c;
        var send = i > 0 ? c.slice(i + 1) : c;
        if (!label.trim()) return;
        var b = document.createElement('button');
        b.className = 'lbc-chip'; b.type = 'button'; b.textContent = label.trim();
        b.onclick = function () { row.remove(); sendText(send.trim()); };
        row.appendChild(b);
      });
      els.body.insertBefore(row, els.typing);
    }
    els.body.scrollTop = els.body.scrollHeight;
    try { if (window.LBChatOnboard && window.LBChatOnboard.onMsg) window.LBChatOnboard.onMsg(sender, body); } catch (e) {}
  }

  function contactCard(formDef) {
    els.body.querySelectorAll('.lbc-form-dyn').forEach(function (n) { n.remove(); });
    var card = document.createElement('div');
    card.className = 'lbc-form lbc-form-dyn';
    var wantName = formDef.indexOf('name') >= 0, wantEmail = formDef.indexOf('email') >= 0;
    var nameIn = null, emailIn = null;
    var head = document.createElement('div'); head.className = 'lbc-fhead';
    var htxt = document.createElement('div');
    htxt.innerHTML = '<div class="lbc-ftitle">Where should the reply go?</div>' +
      '<div class="lbc-fsub">Optional — you can keep chatting either way.</div>';
    var fx = document.createElement('button');
    fx.type = 'button'; fx.className = 'lbc-fx'; fx.setAttribute('aria-label', 'Not now'); fx.title = 'Not now'; fx.innerHTML = '&times;';
    head.appendChild(htxt); head.appendChild(fx); card.appendChild(head);
    fx.onclick = function () {
      var d = document.createElement('div'); d.className = 'lbc-fdone'; d.textContent = 'No problem — back to your questions. 👍';
      card.parentNode.insertBefore(d, card); card.remove();
    };
    if (wantName) { var l1 = document.createElement('label'); l1.textContent = 'Your name'; nameIn = document.createElement('input'); nameIn.placeholder = 'e.g. John Carter'; nameIn.autocomplete = 'name'; card.appendChild(l1); card.appendChild(nameIn); }
    if (wantEmail) { var l2 = document.createElement('label'); l2.textContent = 'Email'; emailIn = document.createElement('input'); emailIn.type = 'email'; emailIn.placeholder = 'you@company.com'; emailIn.autocomplete = 'email'; card.appendChild(l2); card.appendChild(emailIn); }
    var ferr = document.createElement('div'); ferr.className = 'lbc-ferr';
    var sub = document.createElement('button'); sub.type = 'button'; sub.textContent = '✓ Save';
    var note = document.createElement('div'); note.className = 'lbc-fnote'; note.textContent = '🔒 Private — only our team sees this. No spam, and no calls unless you ask.';
    var skipRow = document.createElement('div'); skipRow.style.cssText = 'text-align:center;margin-top:-2px';
    var skip = document.createElement('button'); skip.type = 'button'; skip.className = 'lbc-fskip'; skip.textContent = 'Not now'; skip.onclick = function () { fx.onclick(); };
    skipRow.appendChild(skip);
    card.appendChild(ferr); card.appendChild(sub); card.appendChild(skipRow); card.appendChild(note);
    sub.onclick = async function () {
      ferr.style.display = 'none';
      var nv = nameIn ? nameIn.value.trim() : '', ev = emailIn ? emailIn.value.trim() : '';
      if (!nv && !ev) { ferr.textContent = wantEmail ? 'Please enter your email' : 'Please enter your name'; ferr.style.display = 'block'; return; }
      if (ev && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ev)) { ferr.textContent = 'That email doesn\'t look right'; ferr.style.display = 'block'; return; }
      sub.disabled = true; sub.textContent = 'Saving…';
      try {
        var r = await api('lc_identify', { p_id: convId, p_visitor_key: vKey, p_name: nv || null, p_email: ev || null });
        if (r && r.error) { ferr.textContent = r.error; ferr.style.display = 'block'; sub.disabled = false; sub.textContent = '✓ Save'; return; }
        card.remove(); setTimeout(poll, 300);
      } catch (e) { ferr.textContent = 'Connection hiccup — try again'; ferr.style.display = 'block'; sub.disabled = false; sub.textContent = '✓ Save'; }
    };
    var enter = function (e) { if (e.key === 'Enter') { e.preventDefault(); sub.click(); } };
    if (nameIn) nameIn.addEventListener('keydown', enter);
    if (emailIn) emailIn.addEventListener('keydown', enter);
    els.body.insertBefore(card, els.typing);
  }

  function callCard() {
    els.body.querySelectorAll('.lbc-callform-dyn').forEach(function (n) { n.remove(); });
    var cc = document.createElement('div'); cc.className = 'lbc-form lbc-callform-dyn';
    var lp = document.createElement('label'); lp.textContent = 'Your US phone number';
    var pin = document.createElement('input'); pin.type = 'tel'; pin.placeholder = '(555) 555-5555'; pin.autocomplete = 'tel';
    var lr = document.createElement('label'); lr.textContent = 'You are a…';
    var rsel = document.createElement('select');
    rsel.style.cssText = 'border:1.5px solid #dbe4ef;border-radius:11px;padding:10px 12px;font:400 13.5px Inter,Arial;background:#fff;color:#0f172a;width:100%';
    [['carrier', '🚚 Carrier / Owner-operator'], ['broker', '🏢 Broker'], ['shipper', '📦 Shipper']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; rsel.appendChild(op); });
    var lw = document.createElement('label'); lw.textContent = 'When?';
    var wsel = document.createElement('select'); wsel.style.cssText = rsel.style.cssText;
    [['now', '📞 Call me right now'], ['later', '📅 Pick a date & time']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; wsel.appendChild(op); });
    var dt = document.createElement('input'); dt.type = 'datetime-local'; dt.style.display = 'none';
    wsel.onchange = function () {
      dt.style.display = wsel.value === 'later' ? 'block' : 'none';
      if (wsel.value === 'later' && !dt.value) {
        var d = new Date(Date.now() + 30 * 60000); var p = function (n) { return ('0' + n).slice(-2); };
        var v = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
        dt.value = v; dt.min = v;
      }
    };
    var cerr = document.createElement('div'); cerr.className = 'lbc-ferr';
    var csub = document.createElement('button'); csub.type = 'button'; csub.textContent = '📞 Call me';
    var cnote = document.createElement('div'); cnote.className = 'lbc-fnote'; cnote.textContent = 'By requesting a call you agree to receive one call at this number';
    [lp, pin, lr, rsel, lw, wsel, dt, cerr, csub, cnote].forEach(function (n) { cc.appendChild(n); });
    csub.onclick = async function () {
      cerr.style.display = 'none';
      var pv = pin.value.replace(/[^0-9+]/g, '');
      if (pv.length < 10) { cerr.textContent = 'Please enter a valid US phone number'; cerr.style.display = 'block'; return; }
      var whenIso = null;
      if (wsel.value === 'later') { if (!dt.value) { cerr.textContent = 'Pick a date & time, or choose right now'; cerr.style.display = 'block'; return; } whenIso = new Date(dt.value).toISOString(); }
      csub.disabled = true; csub.textContent = 'Requesting…';
      try {
        var r = await api('lc_chat_request_call', { p_id: convId, p_visitor_key: vKey, p_phone: pv, p_role: rsel.value, p_name: null, p_email: null, p_when: whenIso });
        if (r && r.error) { cerr.textContent = r.error; cerr.style.display = 'block'; csub.disabled = false; csub.textContent = '📞 Call me'; return; }
        cc.remove(); setTimeout(poll, 400);
      } catch (e) { cerr.textContent = 'Connection hiccup — try again'; cerr.style.display = 'block'; csub.disabled = false; csub.textContent = '📞 Call me'; }
    };
    els.body.insertBefore(cc, els.typing);
  }

  // Rating card: shown once when a conversation is closed and not yet rated.
  function ratingCard() {
    if (ratedShown || !convId) return; ratedShown = true;
    var card = document.createElement('div'); card.className = 'lbc-form lbc-form-dyn';
    var t = document.createElement('div'); t.innerHTML = '<div class="lbc-ftitle">How did we do?</div><div class="lbc-fsub">One tap helps us fix what went wrong.</div>';
    card.appendChild(t);
    var stars = document.createElement('div'); stars.className = 'lbc-stars'; var score = 0; var bs = [];
    for (var i = 1; i <= 5; i++) (function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'lbc-star'; b.textContent = '★'; b.setAttribute('aria-label', n + ' star');
      b.onclick = function () { score = n; bs.forEach(function (x, k) { x.classList.toggle('on', k < n); }); };
      bs.push(b); stars.appendChild(b);
    })(i);
    card.appendChild(stars);
    var ta = document.createElement('textarea'); ta.rows = 2; ta.placeholder = 'Anything we should know? (optional)'; card.appendChild(ta);
    var chk = null;
    if (hasEmail || signedIn) {
      var lab = document.createElement('label'); lab.className = 'lbc-chk';
      chk = document.createElement('input'); chk.type = 'checkbox';
      lab.appendChild(chk); lab.appendChild(document.createTextNode('Email me a copy of this chat'));
      card.appendChild(lab);
    }
    var ferr = document.createElement('div'); ferr.className = 'lbc-ferr';
    var sub = document.createElement('button'); sub.type = 'button'; sub.textContent = 'Send rating';
    var skipRow = document.createElement('div'); skipRow.style.cssText = 'text-align:center;margin-top:-2px';
    var skip = document.createElement('button'); skip.type = 'button'; skip.className = 'lbc-fskip'; skip.textContent = 'Skip';
    skip.onclick = function () { card.remove(); };
    skipRow.appendChild(skip);
    card.appendChild(ferr); card.appendChild(sub); card.appendChild(skipRow);
    sub.onclick = async function () {
      if (!score) { ferr.textContent = 'Tap a star first'; ferr.style.display = 'block'; return; }
      sub.disabled = true; sub.textContent = 'Sending…';
      try {
        var r = await api('lc_rate', { p_id: convId, p_visitor_key: vKey, p_score: score, p_comment: ta.value.trim() || null, p_email_transcript: !!(chk && chk.checked), p_close: false });
        if (r && r.error) { ferr.textContent = r.error; ferr.style.display = 'block'; sub.disabled = false; sub.textContent = 'Send rating'; return; }
        csat = score; card.remove();
        sysLine(score >= 4 ? 'Thanks for the rating! 🙏' : 'Thanks — a person will look at this chat.');
        if (chk && chk.checked) sysLine(r && r.transcript ? 'Transcript sent to your email.' : 'No email on file for the transcript.');
        els.body.scrollTop = els.body.scrollHeight;
      } catch (e) { ferr.textContent = 'Connection hiccup — try again'; ferr.style.display = 'block'; sub.disabled = false; sub.textContent = 'Send rating'; }
    };
    els.body.insertBefore(card, els.typing); els.body.scrollTop = els.body.scrollHeight;
  }

  // Thinking indicator: stays until a reply lands. After 8 s the label explains the wait; after 75 s
  // it stops (the server-side watchdog has handed the chat to a person by then).
  function typing(on) {
    els.typing.style.display = on ? 'block' : 'none';
    els.tlabel.style.display = 'none';
    awaiting = !!on; awaitingSince = on ? Date.now() : 0;
    if (on) els.body.scrollTop = els.body.scrollHeight;
  }
  function tickTyping() {
    if (!awaiting) return;
    var s = (Date.now() - awaitingSince) / 1000;
    if (s > 75) { typing(false); return; }
    if (s > 8) { els.tlabel.style.display = 'block'; els.tlabel.textContent = s > 30 ? 'Taking longer than usual — if I can\'t answer, a person is alerted automatically.' : 'Still thinking — checking our knowledge base…'; }
  }

  function setHeader() {
    var t = els.ht, s = els.hs, av = els.hav, dot = els.dot;
    if (botPaused && staffName) {
      t.textContent = staffName + ' · LoadBoot';
      s.textContent = 'Real person · replies right here';
      av.style.display = 'block'; av.textContent = staffName.slice(0, 1).toUpperCase(); els.logo.style.display = 'none';
      dot.className = 'lbc-dot';
    } else {
      t.textContent = 'LoadBoot Support';
      s.textContent = online ? ('AI answers instantly · ' + (staffName || 'a person') + ' is online') : 'AI answers instantly · a person by email/phone';
      av.style.display = 'none'; els.logo.style.display = '';
      dot.className = 'lbc-dot' + (online ? '' : ' off');
    }
  }

  function closedBar(show) {
    els.closedbar.style.display = show ? 'block' : 'none';
    els.input.placeholder = show ? 'Type to reopen this conversation…' : 'Type your message…';
  }

  // ---------- welcome ----------
  function welcome() {
    if (started) return; started = true;
    if (signedIn && hello && hello.ok && cfg.origin !== 'website') {
      var first = hello.first ? ', ' + hello.first : '';
      var msg;
      if (hello.role === 'carrier' && hello.total) {
        msg = 'Hi' + first + ' 👋 ' + hello.verified + ' of ' + hello.total + ' verification items are done';
        if (hello.next) {
          var nx = hello.next;
          msg += ' — ' + (nx.status === 'rejected' ? '<b>' + nx.name + '</b> was sent back' + (nx.note ? ': ' + nx.note : '')
                    : nx.status === 'pending' ? '<b>' + nx.name + '</b> is with our team for review'
                    : 'next up is <b>' + nx.name + '</b>') + '.';
        } else msg += ' — you\'re fully verified. 🎉';
        if (!hello.trucks) msg += ' No truck under Fleet yet.';
        if (hello.payment_status && hello.payment_status !== 'valid') msg += ' Payment setup still open.';
        msg += '\n\nWhat do you need?';
      } else {
        msg = 'Hi' + first + ' 👋 I know your account, so ask me anything about it — or say <b>talk to a person</b>.';
      }
      addMsg('bot', msg);
      chips([['📄 My verification', 'Where do I stand on verification?'],
             ['🚚 Post / find loads', 'How do I post my truck and find loads?'],
             ['💵 Payments', 'When and how do I get paid?'],
             ['🐞 Something\'s not working', 'Something in the portal is not working for me'],
             ['🙋 Talk to a person', 'I want to talk to a real person']]);
      return;
    }
    addMsg('bot', "Hi! 👋 I'm the LoadBoot assistant — I answer instantly, 24/7, and a real person is one tap away. Which one are you?");
    chips([['🚀 Get set up in 5 min', 'Start my 5-minute setup'],
           ['🚚 I\'m a carrier', "I'm a carrier"],
           ['🏢 I\'m a broker', "I'm a broker"],
           ['📦 I\'m a shipper', "I'm a shipper"],
           ['🧑‍✈️ Dispatcher', "I'm a dispatcher"],
           ['📣 Referral partner', "I'm interested in the referral program"],
           ['💰 Just show pricing', 'What does LoadBoot cost?'],
           ['🙋 Talk to a person', 'I want to talk to a real person']]);
  }
  function chips(list) {
    var row = document.createElement('div'); row.className = 'lbc-chips lbc-chips-dyn';
    list.forEach(function (c) {
      var b = document.createElement('button'); b.className = 'lbc-chip'; b.type = 'button'; b.textContent = c[0];
      b.onclick = function () { row.remove(); sendText(c[1]); };
      row.appendChild(b);
    });
    els.body.insertBefore(row, els.typing); els.body.scrollTop = els.body.scrollHeight;
  }

  // ---------- send / poll ----------
  async function sendText(text) {
    text = (text || '').trim();
    if (!text) return;
    if (text === lastSent.text && Date.now() - lastSent.at < 15000) { sysLine('Already sent — hang on, the reply is coming.'); return; }
    lastSent = { text: text, at: Date.now() };
    addMsg('visitor', text, { at: new Date().toISOString() });
    els.input.value = ''; autoGrow();
    if (status === 'closed') { closedBar(false); status = 'open'; ratedShown = false; }
    if (!botPaused) typing(true);
    try {
      var r;
      if (!convId) {
        r = await api('lc_start', { p_visitor_key: vKey, p_origin: cfg.origin, p_page: location.pathname + (hello && hello.ok ? '|hello' : ''), p_name: null, p_email: null, p_body: text });
        if (r && r.id) { convId = r.id; lsSet('lb_lc_conv', convId); }
      } else {
        r = await api('lc_send', { p_id: convId, p_visitor_key: vKey, p_body: text });
      }
      netState(false);
      if (r && r.error) { typing(false); addMsg('bot', r.error); return; }
      if (r && r.human) { typing(false); }
      setTimeout(poll, 500);
    } catch (e) { typing(false); netState(true); addMsg('bot', 'Connection hiccup — your message did not go through. Please try again, or email hello@loadboot.com.'); }
  }

  var polling = false;
  async function poll(force) {
    if (!convId || (polling && !force)) return;
    polling = true;
    try {
      var wantTyping = open && Date.now() - lastTyped < 3000 && Date.now() - typingSent > 2500;
      if (wantTyping) typingSent = Date.now();
      var r = await api('lc_poll', { p_id: convId, p_visitor_key: vKey, p_after: lastId, p_typing: wantTyping });
      netState(false);
      if (!r || r.error) { if (r && r.error === 'not found') { convId = null; lsSet('lb_lc_conv', ''); } return; }
      applyState(r);
      var msgs = r.messages || [], news = false, humanNews = false;
      msgs.forEach(function (m) {
        if (m.id <= lastId) return;
        lastId = m.id; lsSet('lb_lc_last', String(lastId));
        if (m.sender !== 'visitor') { addMsg(m.sender, m.body, { at: m.at, staff_name: m.staff_name }); news = true; if (m.sender === 'staff') humanNews = true; }
      });
      if (news) typing(false);
      if (!open && news) { unread += 1; badge(); }
      if (news && (document.hidden || !open)) { flashTitle(humanNews ? 'New reply from LoadBoot' : 'New message'); ping(); }
      if (status === 'closed' && csat == null && !ratedShown && (r.messages || []).length >= 0) { closedBar(true); if (lastId > 0) ratingCard(); }
    } catch (e) { netState(true); }
    finally { polling = false; }
  }
  function applyState(r) {
    if (r.mode) mode = r.mode;
    botPaused = !!r.bot_paused; staffName = r.staff_name || staffName; online = !!r.online;
    hasEmail = !!r.has_email; if (r.csat != null) csat = r.csat;
    var wasClosed = status === 'closed'; status = r.status || 'open';
    if (status === 'closed' && !wasClosed) { typing(false); }
    if (status === 'open') closedBar(false);
    els.stypeLabel.style.display = r.staff_typing ? 'block' : 'none';
    if (r.staff_typing) els.body.scrollTop = els.body.scrollHeight;
    if (botPaused) typing(false);
    setHeader();
    schedulePoll();
  }

  async function restore() {
    if (!convId) return;
    try {
      var r = await api('lc_poll', { p_id: convId, p_visitor_key: vKey, p_after: 0 });
      if (!r || r.error || !(r.messages || []).length) { convId = null; return; }
      started = true;
      r.messages.forEach(function (m) { addMsg(m.sender, m.body, { at: m.at, staff_name: m.staff_name }); lastId = m.id; });
      applyState(r);
      if (status === 'closed') { closedBar(true); if (csat == null) ratingCard(); }
    } catch (e) {}
  }

  async function showHistory() {
    try {
      var list = await api('lc_history', { p_visitor_key: vKey });
      if (!Array.isArray(list)) return;
      dropStaleCards();
      var box = document.createElement('div'); box.className = 'lbc-hist';
      var t = document.createElement('div'); t.className = 'lbc-ftitle'; t.textContent = list.length ? 'Your previous chats' : 'No previous chats yet'; box.appendChild(t);
      list.forEach(function (c) {
        var row = document.createElement('div'); row.className = 'lbc-hi';
        var l = document.createElement('div'); l.textContent = (c.preview || 'Chat') ; l.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        var s = document.createElement('small'); s.textContent = (c.unread ? '● ' : '') + dayLabel(c.last_msg_at) + (c.status === 'closed' ? ' · closed' : '');
        row.appendChild(l); row.appendChild(s);
        row.onclick = function () { openConversation(c.id); };
        box.appendChild(row);
      });
      var nb = document.createElement('button'); nb.className = 'lbc-chip'; nb.type = 'button'; nb.textContent = '＋ Start a new chat'; nb.style.alignSelf = 'center';
      nb.onclick = function () { newChat(); };
      box.appendChild(nb);
      els.body.insertBefore(box, els.typing); els.body.scrollTop = els.body.scrollHeight;
    } catch (e) {}
  }
  function clearBody() {
    els.body.querySelectorAll('.lbc-row,.lbc-who,.lbc-chips,.lbc-sys,.lbc-day,.lbc-form,.lbc-hist,.lbc-fdone').forEach(function (n) { n.remove(); });
    lastDay = ''; ratedShown = false; csat = null; status = 'open'; botPaused = false; typing(false); closedBar(false);
  }
  function openConversation(id) {
    clearBody(); convId = id; lsSet('lb_lc_conv', id); lastId = 0; started = true;
    restore();
  }
  function newChat() {
    clearBody(); convId = null; lastId = 0; started = false; lsSet('lb_lc_conv', ''); staffName = null; setHeader();
    welcome();
  }
  async function endChat() {
    if (!convId) return;
    try {
      var r = await api('lc_rate', { p_id: convId, p_visitor_key: vKey, p_score: null, p_comment: null, p_email_transcript: false, p_close: true });
      if (r && !r.error) { status = 'closed'; closedBar(true); setTimeout(function () { poll(true); }, 300); ratingCard(); }
    } catch (e) {}
  }
  async function emailTranscript() {
    if (!convId) return;
    try {
      var r = await api('lc_rate', { p_id: convId, p_visitor_key: vKey, p_score: null, p_comment: null, p_email_transcript: true, p_close: false });
      sysLine(r && r.transcript ? 'Transcript sent to your email.' : 'I need an email first — leave it below.');
      if (!(r && r.transcript)) contactCard('name,email');
      els.body.scrollTop = els.body.scrollHeight;
    } catch (e) {}
  }

  // Polling cadence: 2 s while a human is on the line or we are waiting for an answer,
  // 4 s open and idle, 20 s minimised. visibilitychange polls immediately.
  function schedulePoll() {
    clearInterval(pollT);
    var ms = !open ? 20000 : (botPaused || awaiting || mode === 'human') ? 2000 : 4000;
    pollT = setInterval(function () { poll(); tickTyping(); }, ms);
  }

  function flashTitle(t) {
    try {
      if (baseTitle == null) baseTitle = document.title;
      clearInterval(titleT); var onT = false;
      titleT = setInterval(function () { document.title = onT ? baseTitle : '💬 ' + t; onT = !onT; }, 1200);
      var stop = function () { if (!document.hidden && open) { clearInterval(titleT); document.title = baseTitle; document.removeEventListener('visibilitychange', stop); } };
      document.addEventListener('visibilitychange', stop);
    } catch (e) {}
  }
  function ping() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 740; g.gain.value = 0.04; o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3); o.stop(ctx.currentTime + 0.32);
    } catch (e) {}
  }

  function teaser() {
    try {
      if (sessionStorage.getItem('lb_lc_teased')) return;
      setTimeout(function () {
        if (open || sessionStorage.getItem('lb_lc_teased')) return;
        sessionStorage.setItem('lb_lc_teased', '1');
        var t = document.createElement('div'); t.id = 'lbc-teaser';
        t.style.cssText = 'position:fixed;right:18px;bottom:' + (((window.__lbcFabOffset || 18) + 68)) + 'px;max-width:260px;background:#fff;border:1px solid #e6edf5;border-radius:16px;border-bottom-right-radius:6px;box-shadow:0 16px 50px rgba(2,6,23,.25);padding:13px 15px;z-index:2147483645;font-family:Inter,system-ui,Arial;font-size:13px;color:#0f172a;line-height:1.5;cursor:pointer;animation:lbcUp .3s ease';
        // Only promise what this surface can do: the in-chat setup + COI read live on the website
        // (lcOnboard.js); inside the portals the chat knows the account instead.
        var openers = cfg.origin === 'website' ? [
          '<b>👋 Need a hand?</b><br>I answer instantly — pricing, loads, setup, anything trucking. A real person is one tap away.',
          '<b>🚀 New here?</b><br>I can set up your whole account right in this chat — about 5 minutes, done.',
          '<b>📄 Document questions?</b><br>Upload your COI here — I read it on the spot and tell you if anything\'s wrong.',
          '<b>💰 Curious what loads pay?</b><br>Ask me for live rates per mile — real numbers, no login needed.'
        ] : [
          '<b>👋 Stuck on something?</b><br>I can see your verification, trucks and payment setup — ask me what\'s left.',
          '<b>🙋 Need a person?</b><br>Say "talk to a person" — a real LoadBoot teammate joins right here.'
        ];
        var oi = 0;
        try { oi = (parseInt(localStorage.getItem('lb_lc_opener') || '0', 10) || 0) % openers.length; localStorage.setItem('lb_lc_opener', String(oi + 1)); } catch (e) {}
        t.innerHTML = openers[oi] + '<span style="position:absolute;top:6px;right:9px;color:#94a3b8;font-size:14px" data-x>✕</span>';
        t.onclick = function (e) { t.remove(); if (!(e.target && e.target.hasAttribute && e.target.hasAttribute('data-x'))) togglePanel(true); };
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.remove(); }, 25000);
      }, 5000);
    } catch (e) {}
  }

  function badge() { els.badge.style.display = unread > 0 ? 'block' : 'none'; els.badge.textContent = unread > 9 ? '9+' : String(unread); }
  function autoGrow() { els.input.style.height = 'auto'; els.input.style.height = Math.min(els.input.scrollHeight, 90) + 'px'; }

  async function togglePanel(force) {
    open = force != null ? force : !open;
    els.panel.style.display = open ? 'flex' : 'none';
    els.menu.style.display = 'none';
    if (open) {
      unread = 0; badge();
      if (baseTitle != null) { clearInterval(titleT); document.title = baseTitle; }
      if (!started && !convId) {
        if (cfg.getToken && cfg.origin !== 'website' && !hello) {
          try { var h = await api('lc_hello', { p_visitor_key: vKey }); if (h && h.ok) { hello = h; online = !!h.online; staffName = h.staff_name || staffName; setHeader(); } } catch (e) {}
        }
        welcome();
      }
      els.input.focus();
      els.body.scrollTop = els.body.scrollHeight;
      poll(true);
    }
    schedulePoll();
  }

  function mount(c) {
    cfg = c || {};
    if (!cfg.url || !cfg.anon || document.getElementById('lbc-fab')) return;
    vKey = lsGet('lb_lc_key');
    if (!vKey) { vKey = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 10); lsSet('lb_lc_key', vKey); }
    convId = lsGet('lb_lc_conv') || null;
    lastId = 0;

    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var panel = document.createElement('div'); panel.id = 'lbc-panel';
    panel.innerHTML =
      '<div id="lbc-head">' +
        '<img id="lbc-logo" src="/icon-192.png" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="lbc-hav" id="lbc-hav"></div>' +
        '<div><div class="lbc-ht" id="lbc-ht">LoadBoot Support</div>' +
        '<div class="lbc-hs"><span class="lbc-dot off" id="lbc-dot"></span><span id="lbc-hs">AI answers instantly · a person by email/phone</span></div></div>' +
        '<div class="lbc-hb"><button id="lbc-more" aria-label="More">⋯</button><button id="lbc-min" aria-label="Minimize">—</button></div>' +
        '<div id="lbc-menu">' +
          '<button data-act="history">🗂 Previous chats</button>' +
          '<button data-act="new">＋ Start a new chat</button>' +
          '<button data-act="transcript">📧 Email me this chat</button>' +
          '<button data-act="end">✓ End chat</button>' +
        '</div>' +
      '</div>' +
      '<div id="lbc-net"></div>' +
      '<div id="lbc-body" aria-live="polite">' +
        '<div id="lbc-typing"><div class="lbc-tb"><div class="lbc-td"></div><div class="lbc-td"></div><div class="lbc-td"></div></div><div class="lbc-tl" id="lbc-tl"></div></div>' +
        '<div class="lbc-tl" id="lbc-stl" style="margin-left:38px">LoadBoot Team is typing…</div>' +
      '</div>' +
      '<div id="lbc-closedbar">This conversation is closed. <button id="lbc-new">Start a new chat</button></div>' +
      '<div id="lbc-foot"><div id="lbc-form">' +
        '<textarea id="lbc-in" rows="1" placeholder="Type your message…"></textarea>' +
        '<button id="lbc-send" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 11.5 21 3l-8.5 18-2.6-7.4L3 11.5Z" fill="currentColor"/></svg></button>' +
      '</div><div id="lbc-pow">' +
      ((cfg.origin === 'carrier' || cfg.origin === 'partner' || cfg.origin === 'agent')
        ? '<a href="tel:+14692537575" style="color:#64748b;text-decoration:none;font-weight:800">📞 +1 (469) 253-7575</a> · 24/7 · LoadBoot'
        : 'LoadBoot · The Operating System for Trucking') +
      '</div></div>';

    var fab = document.createElement('button'); fab.id = 'lbc-fab';
    fab.setAttribute('aria-label', 'Chat with LoadBoot');
    fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3 6.6 3 11c0 2.1.9 4 2.4 5.4-.2 1-.7 2.3-1.9 3.2 1.9.3 3.6-.3 4.8-1 1.1.4 2.4.6 3.7.6 5 0 9-3.6 9-8.2S17 3 12 3Z" fill="currentColor"/><circle cx="8.5" cy="11" r="1.2" fill="#10223B"/><circle cx="12" cy="11" r="1.2" fill="#10223B"/><circle cx="15.5" cy="11" r="1.2" fill="#10223B"/></svg><span id="lbc-badge"></span>';

    document.body.appendChild(panel);
    document.body.appendChild(fab);

    els = {
      panel: panel, fab: fab,
      body: panel.querySelector('#lbc-body'),
      typing: panel.querySelector('#lbc-typing'),
      tlabel: panel.querySelector('#lbc-tl'),
      stypeLabel: panel.querySelector('#lbc-stl'),
      input: panel.querySelector('#lbc-in'),
      send: panel.querySelector('#lbc-send'),
      badge: fab.querySelector('#lbc-badge'),
      closedbar: panel.querySelector('#lbc-closedbar'),
      net: panel.querySelector('#lbc-net'),
      menu: panel.querySelector('#lbc-menu'),
      ht: panel.querySelector('#lbc-ht'), hs: panel.querySelector('#lbc-hs'), hav: panel.querySelector('#lbc-hav'),
      dot: panel.querySelector('#lbc-dot'), logo: panel.querySelector('#lbc-logo')
    };
    // The staff-typing label lives after the typing bubble so it always sits at the bottom.
    els.body.appendChild(els.stypeLabel);

    fab.onclick = function () { togglePanel(); };
    panel.querySelector('#lbc-min').onclick = function () { togglePanel(false); };
    panel.querySelector('#lbc-more').onclick = function (e) { e.stopPropagation(); els.menu.style.display = els.menu.style.display === 'block' ? 'none' : 'block'; };
    document.addEventListener('click', function (e) { if (els.menu.style.display === 'block' && !els.menu.contains(e.target)) els.menu.style.display = 'none'; });
    els.menu.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        els.menu.style.display = 'none';
        var a = b.getAttribute('data-act');
        if (a === 'history') showHistory();
        else if (a === 'new') newChat();
        else if (a === 'transcript') emailTranscript();
        else if (a === 'end') endChat();
      };
    });
    panel.querySelector('#lbc-new').onclick = function () { newChat(); };
    els.send.onclick = function () { sendText(els.input.value); };
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(els.input.value); } });
    els.input.addEventListener('input', function () { autoGrow(); lastTyped = Date.now(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(true); });

    // Keep the FAB (and its panel/teaser) clear of portal bottom tab bars.
    try {
      var placeFab = function () {
        var off = 18;
        var bar = document.querySelector('.cp-tabbar,.lb-tabbar,#bTabbar,.mcta');
        if (bar) {
          var br = bar.getBoundingClientRect();
          var visible = br.height > 0 && br.top < window.innerHeight && getComputedStyle(bar).display !== 'none';
          if (visible) off = Math.max(18, Math.round(window.innerHeight - br.top) + 12);
        }
        fab.style.bottom = 'calc(' + off + 'px + env(safe-area-inset-bottom, 0px))';
        if (window.innerWidth > 520) panel.style.bottom = (off + 68) + 'px';
        var tz = document.getElementById('lbc-teaser');
        if (tz) tz.style.bottom = (off + 68) + 'px';
        window.__lbcFabOffset = off;
      };
      placeFab();
      window.addEventListener('resize', placeFab);
      window.addEventListener('hashchange', function () { setTimeout(placeFab, 300); });
      if (window.MutationObserver) {
        var moT = null;
        new MutationObserver(function () { clearTimeout(moT); moT = setTimeout(placeFab, 250); }).observe(document.body, { childList: true, subtree: true });
      } else { setInterval(placeFab, 1500); }
    } catch (e) {}

    // Extension hooks for the onboarding concierge (lcOnboard.js — marketing site only).
    window.LBChat._ob = {
      addMsg: addMsg,
      sendText: sendText,
      typing: typing,
      insertNode: function (n) { els.body.insertBefore(n, els.typing); els.body.scrollTop = els.body.scrollHeight; },
      setConv: function (id) { convId = id; lsSet('lb_lc_conv', id); },
      ctx: function () { return { vKey: vKey, convId: convId, cfg: cfg }; }
    };
    restore().then(function () {
      try { if (window.LBChatOnboard && window.LBChatOnboard.checkResume) window.LBChatOnboard.checkResume(); } catch (e) {}
    });
    teaser();
    schedulePoll();
  }

  window.LBChat = { mount: mount };
})();
