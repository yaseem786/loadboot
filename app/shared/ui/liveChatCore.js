// liveChatCore.js — LoadBoot live chat widget (self-hosted; AI assistant + human handoff).
// Plain script (no imports) so the SAME file powers the marketing site and all portals.
// Usage: window.LBChat.mount({ url, anon, origin, getToken? })
//   url      = https://<ref>.supabase.co     anon = publishable anon key
//   origin   = 'website' | 'carrier' | 'partner' | 'agent'
//   getToken = optional async () => access_token (portals pass the user session so
//              staff see exactly WHO is chatting; visitors stay anonymous).
(function () {
  if (typeof window === 'undefined' || window.LBChat) return;

  var NAVY = '#10223B', BLUE = '#0883F7', ORANGE = '#FC5305';
  var CSS = [
    '#lbc-fab{position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;z-index:2147483646;',
    'background:linear-gradient(135deg,#0883F7,#065fb8);color:#fff;box-shadow:0 10px 30px rgba(8,131,247,.45);display:flex;align-items:center;justify-content:center;transition:transform .18s,opacity .2s}',
    '#lbc-fab:hover{transform:scale(1.07)}',
    '#lbc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#FC5305;color:#fff;font:800 11px/20px Inter,Arial;padding:0 5px;display:none}',
    '#lbc-panel{position:fixed;right:18px;bottom:86px;width:378px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 110px);',
    'background:#fff;border-radius:20px;box-shadow:0 24px 80px rgba(2,6,23,.4);z-index:2147483647;display:none;flex-direction:column;overflow:hidden;',
    'font-family:Inter,system-ui,Arial,sans-serif;animation:lbcUp .25s ease}',
    '@keyframes lbcUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    '#lbc-head{background:linear-gradient(135deg,#10223B,#0B1830);padding:16px 18px;display:flex;align-items:center;gap:12px}',
    '#lbc-head img{height:30px;width:30px;border-radius:8px}',
    '.lbc-ht{color:#fff;font-weight:800;font-size:15px;letter-spacing:.2px}',
    '.lbc-hs{color:#9fb3cc;font-size:11.5px;display:flex;align-items:center;gap:5px;margin-top:1px}',
    '.lbc-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)}',
    '#lbc-min{margin-left:auto;background:rgba(255,255,255,.1);border:none;color:#cbd5e1;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:15px}',
    '#lbc-body{flex:1;overflow-y:auto;padding:16px 14px;background:#F4F7FB;display:flex;flex-direction:column;gap:10px}',
    '.lbc-row{display:flex;gap:8px;align-items:flex-end;animation:lbcUp .2s ease}',
    '.lbc-row.me{flex-direction:row-reverse}',
    '.lbc-av{width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:14px}',
    '.lbc-av.bot{background:#10223B;color:#fff}.lbc-av.staff{background:#FC5305;color:#fff;font-weight:800;font-size:11px}',
    '.lbc-b{max-width:78%;padding:10px 13px;border-radius:16px;font-size:13.5px;line-height:1.55;word-wrap:break-word;white-space:pre-wrap}',
    '.lbc-b a{color:#0883F7;font-weight:600;text-decoration:none}.lbc-b a:hover{text-decoration:underline}',
    '.me .lbc-b{background:#0883F7;color:#fff;border-bottom-right-radius:6px}.me .lbc-b a{color:#fff;text-decoration:underline}',
    '.them .lbc-b{background:#fff;color:#0f172a;border:1px solid #e6edf5;border-bottom-left-radius:6px;box-shadow:0 1px 3px rgba(2,6,23,.05)}',
    '.lbc-who{font-size:10.5px;color:#94a3b8;margin:0 38px 2px;font-weight:600}',
    '.lbc-chips{display:flex;flex-wrap:wrap;gap:7px;margin:4px 0 0 36px}',
    '.lbc-chip{background:#fff;border:1.5px solid #cfe3fb;color:#0883F7;font:600 12px Inter,Arial;padding:7px 12px;border-radius:999px;cursor:pointer;transition:all .15s}',
    '.lbc-chip:hover{background:#0883F7;color:#fff;border-color:#0883F7}',
    '#lbc-typing{display:none;margin-left:38px}.lbc-tb{display:inline-flex;gap:4px;background:#fff;border:1px solid #e6edf5;padding:11px 14px;border-radius:16px;border-bottom-left-radius:6px}',
    '.lbc-td{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:lbcBl 1.2s infinite}',
    '.lbc-td:nth-child(2){animation-delay:.18s}.lbc-td:nth-child(3){animation-delay:.36s}',
    '@keyframes lbcBl{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}',
    '#lbc-foot{padding:10px 12px 8px;background:#fff;border-top:1px solid #eef2f7}',
    '#lbc-sug{display:flex;gap:7px;overflow-x:auto;padding:9px 12px 2px;background:#fff;border-top:1px solid #eef2f7;scrollbar-width:none}',
    '#lbc-sug::-webkit-scrollbar{display:none}',
    '.lbc-sug{flex:none;background:#f4f8fd;border:1.5px solid #dbe9fb;color:#0b62b8;font:700 12px Inter,Arial;padding:8px 13px;border-radius:999px;cursor:pointer;transition:all .15s;white-space:nowrap}',
    '.lbc-sug:hover{background:#0883F7;border-color:#0883F7;color:#fff;transform:translateY(-1px)}',
    '#lbc-form{display:flex;gap:8px;align-items:flex-end}',
    '#lbc-in{flex:1;border:1.5px solid #dbe4ef;border-radius:14px;padding:10px 13px;font:400 13.5px Inter,Arial;resize:none;max-height:90px;outline:none;color:#0f172a;background:#fff}',
    '#lbc-in:focus{border-color:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.12)}',
    '#lbc-send{width:42px;height:42px;border-radius:13px;border:none;background:#FC5305;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:transform .15s}',
    '#lbc-send:hover{transform:scale(1.06)}#lbc-send:disabled{opacity:.5}',
    '#lbc-pow{text-align:center;color:#b6c2d4;font-size:10px;margin-top:6px}',
    '#lbc-closedbar{display:none;background:#fff7ed;border-top:1px solid #fed7aa;color:#9a3412;font-size:12px;padding:9px 14px;text-align:center}',
    '#lbc-closedbar button{background:none;border:none;color:#FC5305;font-weight:800;cursor:pointer;font-size:12px}',
    '@media (max-width:520px){#lbc-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}}'
  ].join('');

  var cfg = null, open = false, convId = null, vKey = null, lastId = 0, pollT = null, unread = 0, started = false, mode = 'bot', typingT = null;
  var els = {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function linkify(s) {
    return esc(s).replace(/(https:\/\/[^\s<]+)/g, function (u) {
      var label = u.replace('https://loadboot.com/', '').replace('.html', '').replace(/[-_]/g, ' ') || 'loadboot.com';
      if (u.indexOf('https://loadboot.com') !== 0) label = u;
      return '<a href="' + u + '" target="_blank" rel="noopener">' + esc(label) + ' →</a>';
    });
  }

  async function api(fn, args) {
    var token = null;
    if (cfg.getToken) { try { token = await cfg.getToken(); } catch (e) {} }
    var r = await fetch(cfg.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anon, Authorization: 'Bearer ' + (token || cfg.anon) },
      body: JSON.stringify(args)
    });
    return r.json();
  }

  function addMsg(sender, body) {
    var me = sender === 'visitor';
    var chipDef = null;
    var cm = String(body).match(/\[\[chips:([\s\S]*?)\]\]/);
    if (cm) { chipDef = cm[1]; body = String(body).replace(cm[0], '').replace(/\s+$/, ''); }
    var who = sender === 'bot' ? 'LoadBoot AI ⚡' : sender === 'staff' ? 'LoadBoot Team' : '';
    var html = '';
    if (!me && who) html += '<div class="lbc-who">' + who + '</div>';
    html += '<div class="lbc-row ' + (me ? 'me' : 'them') + '">';
    if (!me) html += '<div class="lbc-av ' + (sender === 'bot' ? 'bot' : 'staff') + '">' + (sender === 'bot' ? '⚡' : 'LB') + '</div>';
    html += '<div class="lbc-b">' + linkify(body) + '</div></div>';
    var w = document.createElement('div');
    w.innerHTML = html;
    while (w.firstChild) els.body.insertBefore(w.firstChild, els.typing);
    if (chipDef && !me) {
      // only the newest message shows action buttons
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
  }

  function typing(on) {
    els.typing.style.display = on ? 'block' : 'none';
    if (on) els.body.scrollTop = els.body.scrollHeight;
    clearTimeout(typingT);
    if (on) typingT = setTimeout(function () { typing(false); }, 8000);
  }

  function welcome() {
    if (started) return; started = true;
    addMsg('bot', "Hi! 👋 I'm the LoadBoot assistant — I answer instantly, 24/7. To point you right: which one are you?");
    var chips = document.createElement('div');
    chips.className = 'lbc-chips';
    [['🚚 I\'m a carrier', "I'm a carrier"],
     ['🏢 I\'m a broker', "I'm a broker"],
     ['📦 I\'m a shipper', "I'm a shipper"],
     ['🧑\u200d✈️ Dispatcher', "I'm a dispatcher"],
     ['📣 Referral partner', "I'm interested in the referral program"],
     ['💰 Just show pricing', 'What does LoadBoot cost?'],
     ['🙋 Talk to a person', 'I want to talk to a real person']].forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'lbc-chip'; b.textContent = c[0];
      b.onclick = function () { chips.remove(); sendText(c[1]); };
      chips.appendChild(b);
    });
    els.body.insertBefore(chips, els.typing);
    els.body.scrollTop = els.body.scrollHeight;
  }

  async function sendText(text) {
    text = (text || '').trim();
    if (!text) return;
    addMsg('visitor', text);
    els.input.value = ''; autoGrow();
    typing(true);
    if (mode !== 'bot') deliveredNote();
    try {
      var r;
      if (!convId) {
        r = await api('lc_start', { p_visitor_key: vKey, p_origin: cfg.origin, p_page: location.pathname, p_name: null, p_email: null, p_body: text });
        if (r && r.id) { convId = r.id; lsSet('lb_lc_conv', convId); }
      } else {
        r = await api('lc_send', { p_id: convId, p_visitor_key: vKey, p_body: text });
      }
      if (r && r.error) { typing(false); addMsg('bot', r.error); return; }
      setTimeout(poll, 650);
    } catch (e) { typing(false); addMsg('bot', 'Connection hiccup — please try again, or email hello@loadboot.com.'); }
  }

  async function poll() {
    if (!convId) return;
    try {
      var r = await api('lc_poll', { p_id: convId, p_visitor_key: vKey, p_after: lastId });
      if (!r || r.error) return;
      if (r.mode) mode = r.mode;
      var msgs = r.messages || [];
      var news = false;
      msgs.forEach(function (m) {
        if (m.id <= lastId) return;
        lastId = m.id; lsSet('lb_lc_last', String(lastId));
        if (m.sender !== 'visitor') { addMsg(m.sender, m.body); news = true; }
        else if (!open) {} // own old message replay when restoring
      });
      if (news) typing(false);
      if (!open && news) { unread += 1; badge(); }
      if (r.status === 'closed') { els.closedbar.style.display = 'block'; } else { els.closedbar.style.display = 'none'; }
    } catch (e) {}
  }

  async function restore() {
    if (!convId) return;
    try {
      var r = await api('lc_poll', { p_id: convId, p_visitor_key: vKey, p_after: 0 });
      if (!r || r.error || !(r.messages || []).length) { convId = null; return; }
      if (r.mode) mode = r.mode;
      started = true;
      r.messages.forEach(function (m) { addMsg(m.sender === 'visitor' ? 'visitor' : m.sender, m.body); lastId = m.id; });
      if (r.status === 'closed') els.closedbar.style.display = 'block';
    } catch (e) {}
  }

  var notedOnce = false;
  function deliveredNote() {
    if (notedOnce) return; notedOnce = true;
    var d = document.createElement('div');
    d.className = 'lbc-who';
    d.style.cssText = 'text-align:center;margin:4px 0;color:#94a3b8';
    d.textContent = '✓ Delivered — our team replies right here (you can close this window, your chat is saved)';
    els.body.insertBefore(d, els.typing);
    els.body.scrollTop = els.body.scrollHeight;
  }

  function teaser() {
    try {
      if (sessionStorage.getItem('lb_lc_teased')) return;
      setTimeout(function () {
        if (open || sessionStorage.getItem('lb_lc_teased')) return;
        sessionStorage.setItem('lb_lc_teased', '1');
        var t = document.createElement('div');
        t.id = 'lbc-teaser';
        t.style.cssText = 'position:fixed;right:18px;bottom:86px;max-width:260px;background:#fff;border:1px solid #e6edf5;border-radius:16px;border-bottom-right-radius:6px;box-shadow:0 16px 50px rgba(2,6,23,.25);padding:13px 15px;z-index:2147483645;font-family:Inter,system-ui,Arial;font-size:13px;color:#0f172a;line-height:1.5;cursor:pointer;animation:lbcUp .3s ease';
        t.innerHTML = '<b>👋 Need a hand?</b><br>I answer instantly — pricing, loads, setup, anything trucking.' +
          '<span style="position:absolute;top:6px;right:9px;color:#94a3b8;font-size:14px" data-x>✕</span>';
        t.onclick = function (e) {
          t.remove();
          if (!(e.target && e.target.hasAttribute && e.target.hasAttribute('data-x'))) togglePanel(true);
        };
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.remove(); }, 25000);
      }, 5000);
    } catch (e) {}
  }

  function badge() {
    els.badge.style.display = unread > 0 ? 'block' : 'none';
    els.badge.textContent = unread > 9 ? '9+' : String(unread);
  }

  function autoGrow() { els.input.style.height = 'auto'; els.input.style.height = Math.min(els.input.scrollHeight, 90) + 'px'; }

  function togglePanel(force) {
    open = force != null ? force : !open;
    els.panel.style.display = open ? 'flex' : 'none';
    if (open) {
      unread = 0; badge();
      if (!started && !convId) welcome();
      els.input.focus();
      els.body.scrollTop = els.body.scrollHeight;
      clearInterval(pollT); pollT = setInterval(poll, 3500);
    } else {
      clearInterval(pollT); pollT = setInterval(poll, 30000);
    }
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
        '<img src="/icon-192.png" alt="" onerror="this.style.display=\'none\'">' +
        '<div><div class="lbc-ht">LoadBoot Support</div>' +
        '<div class="lbc-hs"><span class="lbc-dot"></span>AI answers instantly · humans on standby</div></div>' +
        '<button id="lbc-min" aria-label="Minimize">—</button>' +
      '</div>' +
      '<div id="lbc-body"><div id="lbc-typing"><div class="lbc-tb"><div class="lbc-td"></div><div class="lbc-td"></div><div class="lbc-td"></div></div></div></div>' +
      '<div id="lbc-closedbar">This conversation was closed. <button id="lbc-new">Start a new chat</button></div>' +
      '<div id="lbc-foot"><div id="lbc-form">' +
        '<textarea id="lbc-in" rows="1" placeholder="Type your message…"></textarea>' +
        '<button id="lbc-send" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 11.5 21 3l-8.5 18-2.6-7.4L3 11.5Z" fill="currentColor"/></svg></button>' +
      '</div><div id="lbc-pow">LoadBoot · The Operating System for Trucking</div></div>';

    var fab = document.createElement('button'); fab.id = 'lbc-fab';
    fab.setAttribute('aria-label', 'Chat with LoadBoot');
    fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3 6.6 3 11c0 2.1.9 4 2.4 5.4-.2 1-.7 2.3-1.9 3.2 1.9.3 3.6-.3 4.8-1 1.1.4 2.4.6 3.7.6 5 0 9-3.6 9-8.2S17 3 12 3Z" fill="currentColor"/><circle cx="8.5" cy="11" r="1.2" fill="#10223B"/><circle cx="12" cy="11" r="1.2" fill="#10223B"/><circle cx="15.5" cy="11" r="1.2" fill="#10223B"/></svg><span id="lbc-badge"></span>';

    document.body.appendChild(panel);
    document.body.appendChild(fab);

    els = {
      panel: panel, fab: fab,
      body: panel.querySelector('#lbc-body'),
      typing: panel.querySelector('#lbc-typing'),
      input: panel.querySelector('#lbc-in'),
      send: panel.querySelector('#lbc-send'),
      badge: fab.querySelector('#lbc-badge'),
      closedbar: panel.querySelector('#lbc-closedbar')
    };

    fab.onclick = function () { togglePanel(); };
    panel.querySelector('#lbc-min').onclick = function () { togglePanel(false); };
    panel.querySelector('#lbc-new').onclick = function () {
      convId = null; lastId = 0; started = false; lsSet('lb_lc_conv', '');
      els.body.querySelectorAll('.lbc-row,.lbc-who,.lbc-chips').forEach(function (n) { n.remove(); });
      els.closedbar.style.display = 'none';
      welcome();
    };
    els.send.onclick = function () { sendText(els.input.value); };
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(els.input.value); } });
    els.input.addEventListener('input', autoGrow);

    // Mobile: keep the FAB above portal tab bars
    try {
      var mq = window.matchMedia('(max-width: 900px)');
      var place = function () { fab.style.bottom = mq.matches && document.querySelector('.lb-tabbar,.cp-tabbar,#bTabbar') ? 'calc(84px + env(safe-area-inset-bottom))' : '18px'; };
      place(); mq.addEventListener('change', place); setTimeout(place, 1500);
    } catch (e) {}

    restore();
    teaser();
    pollT = setInterval(poll, 30000);
  }

  window.LBChat = { mount: mount };
})();
