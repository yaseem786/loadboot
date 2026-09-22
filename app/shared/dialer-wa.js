// dialer-wa.js — the WhatsApp channel inside the dispatcher dock's Texts tab (bl_wa_0367).
//
// Why a separate module: dialer.js is a working engine and stays that way. This file owns everything WhatsApp
// and is handed the dock's own helpers, so nothing about calls or SMS changes shape.
//
// What is different from SMS, and why the screen looks the way it does:
//   * LoadBoot has ONE WhatsApp number (Meta caps numbers) and it is the company's public number - it sits in
//     e-mail signatures and on the website. So the server, not this screen, decides who may see what
//     (bl_wa_0368 + bl_wa_0369): a message from a carrier's own number or one of its DRIVERS goes straight to
//     that carrier's assigned dispatcher. Brokers, shippers and numbers LoadBoot does not know are COMMAND
//     CENTER's - a dispatcher never sees them and cannot open them. A dispatcher can also only START a
//     conversation with his own carriers and their drivers. CC can hand any conversation to anyone.
//   * Meta's 24-hour window: free text may only be sent while the other side's last message is less than 24 h old.
//     Outside it, only an APPROVED Utility template goes out. The server refuses anything else — this screen only
//     shows the state honestly (countdown, or the template picker).
//   * Templates are approved by Meta, not by us. Until Meta approves them the picker is empty and says so.
import { waVoiceFile } from './wa-opus.js';   // bl_wa_0378 - Chrome records webm; WhatsApp needs ogg

export function createWaPanel(ctx) {
  const { h, mount, ic, ago, pretty, digits, toast, paint, rootOf, S, api, onCall } = ctx;
  let timer = null;

  const SEC = 'font:700 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--mu);margin:12px 0 4px';

  // bl_wa_0372 - the chat reads like WhatsApp: day separators, delivery ticks, and attachments you can open.
  // Styles are scoped (lbdwa-) and injected once, so dialer.js's own stylesheet is untouched.
  const WA_CSS = `
.lbdwa-day{align-self:center;background:rgba(255,255,255,.09);color:#cbd7ee;font:600 10.5px Inter,system-ui,sans-serif;
  padding:3px 10px;border-radius:999px;margin:8px 0 2px;letter-spacing:.3px}
.lbdwa-img{max-width:230px;max-height:280px;border-radius:12px;display:block;cursor:zoom-in;object-fit:cover}
.lbdwa-ph{width:200px;height:110px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.08);color:#9fb3d6;font-size:11.5px}
.lbdwa-aud{width:238px;height:36px;margin:2px 0}
.lbdwa-img.pend{min-height:140px;min-width:170px;background:rgba(255,255,255,.06)}
.lbdwa-lb{position:fixed;inset:0;z-index:99999;background:rgba(3,8,20,.93);display:grid;place-items:center;cursor:zoom-out}
.lbdwa-lb img{max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.lbdwa-lb .x{position:absolute;top:14px;right:18px;color:#cbd7ee;font:700 22px Inter,system-ui,sans-serif;background:none;border:0;cursor:pointer}
.lbdwa-rec{display:flex;align-items:center;gap:10px;margin-top:8px;padding:7px 9px;border-radius:26px;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.13)}
.lbdwa-recbtn{background:none;border:0;color:#9fb3d6;cursor:pointer;padding:5px;display:flex;flex:none}
.lbdwa-recbtn:hover{color:#fff}
.lbdwa-recdot{width:9px;height:9px;border-radius:50%;background:#ef4444;flex:none;animation:lbdwaBlink 1s steps(2,start) infinite}
.lbdwa-rect{font-variant-numeric:tabular-nums;font-weight:700;font-size:13px;color:#e8eefc;min-width:36px;flex:none}
.lbdwa-wave{display:flex;align-items:center;gap:2px;flex:1;height:22px;overflow:hidden;min-width:0}
.lbdwa-wave i{display:block;width:3px;border-radius:2px;background:#9fb3d6;height:6px;animation:lbdwaWave .9s ease-in-out infinite}
.lbdwa-recdot.off{animation:none;opacity:.35}
.lbdwa-prev{flex:1;min-width:0;height:32px}
.lbdwa-recsend{width:36px;height:36px;border-radius:50%;border:0;background:var(--bl);color:#fff;display:grid;place-items:center;cursor:pointer;flex:none}
/* bl_wa_0396 - the dispatcher reads the message before choosing it, not just the template's name. */
.lbdwa-tpls{display:flex;flex-direction:column;gap:6px}
.lbdwa-tpl{display:block;width:100%;text-align:left;border:1px solid var(--ln);background:rgba(255,255,255,.04);color:#dbe6fb;border-radius:12px;padding:8px 10px;cursor:pointer;font:inherit}
.lbdwa-tpl b{display:block;font-size:12px;text-transform:capitalize;color:#fff;margin-bottom:2px}
.lbdwa-tpl span{display:block;font-size:11.5px;line-height:1.45;color:#9fb3d6;white-space:pre-wrap}
.lbdwa-tpl.on{border-color:var(--bl);background:rgba(8,131,247,.18)}
.lbdwa-tpl.on span{color:#cfe1fb}
@keyframes lbdwaBlink{50%{opacity:.25}}
@keyframes lbdwaWave{0%,100%{height:6px}50%{height:20px}}
.lbdwa-doc{display:flex;gap:9px;align-items:center;background:rgba(255,255,255,.12);border:0;border-radius:10px;
  padding:9px 11px;cursor:pointer;min-width:170px;color:inherit;font:600 12.5px Inter,system-ui,sans-serif;text-align:left}
.lbdwa-doc small{display:block;font-weight:500;opacity:.75;margin-top:2px;font-size:10.5px}
.lbdwa-tick{margin-left:5px;letter-spacing:-3px;font-size:11px}
.lbdwa-tick.read{color:#7fd0ff}
.lbdwa-cap{margin-top:5px}
.lbdwa-from{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mu);margin:0 0 8px}
.lbdwa-from b{color:#cfe3ff;font-weight:700;letter-spacing:.2px}
/* full screen: the dock takes over the page, so a long thread is readable */
.lbd.lbd-max{right:0;left:0;top:0;bottom:0;display:grid;place-items:center;background:rgba(3,10,24,.62);backdrop-filter:blur(3px)}
.lbd.lbd-max .lbd-fab{display:none}
.lbd.lbd-max .lbd-panel{width:min(1040px,96vw);height:94vh;max-height:94vh}
.lbd.lbd-max .lbd-msgs{max-height:none;flex:1}
.lbd.lbd-max .lbdwa-img{max-width:min(520px,60vw);max-height:60vh}
`;
  const setMax = (on) => {
    S.waMax = !!on;
    try { localStorage.setItem('lbd_wa_max', S.waMax ? '1' : '0'); } catch (_) {}
    const r = rootOf(); if (r) r.classList.toggle('lbd-max', S.waMax);
  };
  const isMax = () => !!S.waMax;
  const fromLine = (wa) => (wa && wa.number
    ? h('div', { class: 'lbdwa-from' }, [ic('msg', 13), 'Sending from LoadBoot WhatsApp ', h('b', null, pretty(wa.number))])
    : null);

  function ensureCss() {
    if (document.getElementById('lbdwa-css')) return;
    const st = document.createElement('style'); st.id = 'lbdwa-css'; st.textContent = WA_CSS; document.head.appendChild(st);
  }

  const mediaCache = new Map();            // message id -> object URL
  // bl_wa_0385 - a blob: URL cannot be handed to window.open with 'noopener'. An anchor click keeps the
  // opener tie, so the file really opens; images skip this and use the overlay below.
  const mediaDims = new Map();
  function openBlob(url, name) {
    const a2 = document.createElement('a');
    a2.href = url; a2.target = '_blank'; a2.download = name || '';
    document.body.appendChild(a2); a2.click(); a2.remove();
  }
  function lightbox(url) {
    const esc = (e) => { if (e.key === 'Escape') shut(); };
    const box = h('div', { class: 'lbdwa-lb', onClick: () => shut() }, [
      h('button', { class: 'x', type: 'button', 'aria-label': 'Close' }, '\u2715'),
      h('img', { src: url, alt: 'Photo', onClick: (e) => e.stopPropagation() }),
    ]);
    function shut() { document.removeEventListener('keydown', esc); box.remove(); }
    box.querySelector('.x').onclick = shut;
    document.addEventListener('keydown', esc);
    document.body.appendChild(box);
  }

  async function mediaUrl(id) {
    if (mediaCache.has(id)) return mediaCache.get(id);
    const blob = await api.waMediaBlob(id);
    const url = URL.createObjectURL(blob);
    mediaCache.set(id, url);
    return url;
  }
  const dayLabel = (iso) => {
    const d = new Date(iso); const today = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return 'Today';
    if (same(d, new Date(today.getTime() - 86400000))) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function tick(m) {
    if (m.direction !== 'outbound' || m.status === 'failed') return null;
    if (m.status === 'queued') return h('span', { class: 'lbdwa-tick' }, '\u00b7\u00b7');
    const two = m.status === 'delivered' || m.status === 'read';
    return h('span', { class: 'lbdwa-tick' + (m.status === 'read' ? ' read' : '') }, two ? '\u2713\u2713' : '\u2713');
  }

  // the attachment itself: a picture you can open, a voice note you can play, a file you can download
  function mediaEl(m) {
    const kind = m.media_kind || '';
    const mime = m.mime || '';
    if (kind === 'image' || kind === 'sticker' || mime.startsWith('image/')) {
      // bl_wa_0385 - window.open(blobUrl, '_blank', 'noopener') is blocked by Chrome: a blob URL is tied to
      // the document that made it and 'noopener' cuts that tie, so the tab opened blank and the photo
      // "would not open". It shows in an overlay inside the panel instead, which is what WhatsApp does too.
      const d = mediaDims.get(m.id);
      const img = h('img', { class: 'lbdwa-img' + (d ? '' : ' pend'), alt: 'Photo', loading: 'lazy' });
      if (d) { img.style.width = d.w + 'px'; img.style.height = d.h + 'px'; }
      mediaUrl(m.id).then((u) => {
        img.onclick = () => lightbox(u);
        img.addEventListener('load', () => {
          img.classList.remove('pend');
          if (img.clientWidth && img.clientHeight) mediaDims.set(m.id, { w: img.clientWidth, h: img.clientHeight });
          img.style.width = ''; img.style.height = '';
        }, { once: true });
        img.src = u;
      }).catch((e) => { img.replaceWith(h('div', { class: 'lbdwa-ph' }, (e && e.message) || 'Photo unavailable')); });
      return img;
    }
    if (kind === 'audio' || kind === 'voice' || mime.startsWith('audio/')) {
      const au = h('audio', { class: 'lbdwa-aud', controls: 'controls', preload: 'none' });
      mediaUrl(m.id).then((u) => { au.src = u; }).catch(() => { au.replaceWith(h('div', { class: 'lbdwa-ph' }, 'Audio unavailable')); });
      return h('div', null, [m.voice ? h('small', { style: 'opacity:.75' }, 'Voice message') : null, au]);
    }
    if (kind === 'video' || mime.startsWith('video/')) {
      const v = h('video', { class: 'lbdwa-img', controls: 'controls', preload: 'none' });
      mediaUrl(m.id).then((u) => { v.src = u; }).catch(() => { v.replaceWith(h('div', { class: 'lbdwa-ph' }, 'Video unavailable')); });
      return v;
    }
    const name = m.file_name || (kind === 'document' ? 'Document' : 'Attachment');
    return h('button', { class: 'lbdwa-doc', type: 'button', onClick: async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try { const u = await mediaUrl(m.id); openBlob(u, m.file_name || 'attachment'); }
      catch (err) { toast((err && err.message) || 'Could not open that file.'); }
      btn.disabled = false;
    } }, [ic('msg', 16), h('span', null, [name, h('small', null, (mime || 'file').split(';')[0])])]);
  }

  const fmtLeft = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (!(ms > 0)) return null;
    const m = Math.round(ms / 60000);
    return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
  };

  async function load(quiet) {
    ensureCss();
    try {
      const r = await api.waInbox();
      if (r && !r.error) { S.wa = r; if (!quiet) paint(); }
    } catch (_) {}
  }

  function close() { if (timer) { clearInterval(timer); timer = null; } S.waId = null; S.waThread = null; S.waDraft = ''; S.waTpl = null; S.waVars = []; clearPend(); msgsBox = null; waTop = 0; waAtEnd = true; }

  async function loadThread(quiet) {
    if (!S.waId) return;
    try {
      const t = await api.waThread(S.waId);
      if (!t || t.error || !S.waId) { if (t && t.error && !quiet) toast(t.error); return; }
      const sig = (x) => (x && x.messages ? x.messages.map((m) => m.id + m.status).join() : '');
      const had = S.waThread && S.waThread.messages ? S.waThread.messages.length : -1;
      const changed = sig(t) !== sig(S.waThread);
      S.waThread = t;
      if (!quiet) { paint(); return; }
      if (changed) { paintMsgs(t.messages.length !== had); load(true); }
    } catch (_) {}
  }

  function openThread(id) {
    close();
    S.tab = 'texts'; S.chan = 'wa'; S.open = true; S.showSettings = false; S.waId = id;
    paint(); loadThread(false);
    timer = setInterval(() => { if (S.open && S.tab === 'texts' && S.chan === 'wa' && S.waId && document.visibilityState === 'visible') loadThread(true); }, 8000);
  }

  async function startWith(number) {
    const r = await api.waStart(number, '');
    if (!r || r.error) { toast((r && r.error) || 'Could not open that conversation.'); return; }
    await load(true);
    openThread(r.thread.id);
  }

  async function claim(id) {
    const r = await api.waClaim(id);
    if (!r || r.error) { toast((r && r.error) || 'Could not take that conversation.'); return; }
    await load(true);
    if (S.waId === id) loadThread(false); else paint();
  }

  function bubble(m) {
    const failed = m.status === 'failed';
    const media = m.has_media ? mediaEl(m) : null;
    return h('div', { class: 'lbd-bub' + (m.direction === 'outbound' ? ' out' : '') + (failed ? ' fail' : '') }, [
      media,
      m.body ? h('div', { class: media ? 'lbdwa-cap' : '' }, m.body) : null,
      metaLine(m),
    ]);
  }

  // bl_wa_0386 - the whole list used to be re-mounted on every poll, so each status tick (sent - delivered
  // - read) threw away every bubble and every loaded photo and rebuilt them. That is what pulled the view
  // to the top. Bubbles are kept and reused now; only a changed meta line is swapped, and only genuinely
  // new rows are inserted. Nothing the reader is looking at is touched, so nothing moves.
  const rowCache = new Map();
  let listFor = null;
  // bl_wa_0387 - attaching, sending, recording and pausing all call paint(), which builds a brand new
  // message box; a fresh box starts at scrollTop 0 and the old code then forced it to the very bottom.
  // The reader's position is tracked here instead and put back after every repaint.
  let waTop = 0, waAtEnd = true, waLock = false, waRepaint = false;
  // bl_wa_0389 - paint() rebuilds the whole dialer panel, so the message box used to be a NEW empty
  // element every time: it reported scrollHeight 0, the tracker believed the reader had jumped to the
  // top, and that wrong position was then restored. One node is kept and re-parented instead, and every
  // scroll event fired during a repaint is ignored - only the reader's own scrolling is recorded.
  let msgsBox = null;
  function msgsNode() {
    if (!msgsBox) msgsBox = h('div', { class: 'lbd-msgs', 'data-walist': '1', role: 'log', 'aria-live': 'polite' });
    waRepaint = true;
    return msgsBox;
  }
  // bl_wa_0388 - setting scrollTop fires a scroll event of its own. Without this lock the tracker read
  // back the value the browser had just clamped (a freshly mounted box is still 0 high, so the clamp is
  // 0) and overwrote the remembered position with it - which is why the list kept ending up at the top.
  function setScroll(box, v) {
    waLock = true;
    box.scrollTop = v;
    requestAnimationFrame(() => requestAnimationFrame(() => { waLock = false; }));
  }

  function metaLine(m) {
    const failed = m.status === 'failed';
    return h('small', null, [
      m.kind === 'template' ? h('span', null, 'Template \u00b7 ') : null,
      h('span', null, clock(m.at)),
      failed ? h('span', null, ' \u00b7 Not sent' + (m.error ? ' \u2014 ' + m.error : '')) : null,
      tick(m),
    ]);
  }

  function paintMsgs(toEnd) {
    const root = rootOf();
    const box = root && root.querySelector('[data-walist]'); if (!box) return;
    const ms = (S.waThread && S.waThread.messages) || [];
    if (listFor !== S.waId) { rowCache.clear(); box.textContent = ''; listFor = S.waId; waTop = 0; waAtEnd = true; }
    if (!box.__waScroll) {                    // a repainted panel brings a new box; re-arm the tracker
      box.__waScroll = true;
      box.addEventListener('scroll', () => {
        if (waLock || waRepaint) return;      // our own restore or a repaint, not the reader
        waTop = box.scrollTop;
        waAtEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      }, { passive: true });
    }
    if (!ms.length) {
      rowCache.clear();
      mount(box, h('div', { class: 'lbd-empty' }, S.waThread ? 'No messages yet.' : 'Loading...'));
      return;
    }
    const want = [], keep = new Set(), fresh = [];
    let day = '';
    ms.forEach((m) => {                       // a separator whenever the date changes, like WhatsApp
      const d = dayLabel(m.at);
      if (d !== day) {
        day = d;
        const k = 'day:' + d; keep.add(k);
        let c = rowCache.get(k);
        if (!c) { c = { el: h('div', { class: 'lbdwa-day' }, d) }; rowCache.set(k, c); }
        want.push(c.el);
      }
      keep.add(m.id);
      const sig = [m.status, m.error || '', m.body || '', m.has_media ? 1 : 0].join('|');
      let c = rowCache.get(m.id);
      if (!c) { c = { el: bubble(m), sig: sig }; rowCache.set(m.id, c); fresh.push(c.el); }
      else if (c.sig !== sig) {               // a tick moved: swap the one line, never the photo above it
        const small = c.el.querySelector(':scope > small');
        const nw = metaLine(m);
        if (small) c.el.replaceChild(nw, small); else c.el.appendChild(nw);
        c.el.classList.toggle('fail', m.status === 'failed');
        c.sig = sig;
      }
      want.push(c.el);
    });
    rowCache.forEach((_v, k) => { if (!keep.has(k)) rowCache.delete(k); });
    want.forEach((elx, i) => { if (box.children[i] !== elx) box.insertBefore(elx, box.children[i] || null); });
    while (box.children.length > want.length) box.removeChild(box.lastChild);
    // The box has usually not been laid out yet on the frame a repaint mounts it, so the first write can
    // be clamped to 0. It is applied again on the next frame, once the real height exists.
    const target = () => (toEnd || waAtEnd) ? box.scrollHeight : waTop;
    setScroll(box, target());
    requestAnimationFrame(() => {
      if (Math.abs(box.scrollTop - target()) > 2) setScroll(box, target());
      requestAnimationFrame(() => { waRepaint = false; });
    });
    // a photo in a brand-new bubble still lands late and grows the list; only those are anchored.
    fresh.forEach((elx) => {
      const im = elx.tagName === 'IMG' ? elx : elx.querySelector && elx.querySelector('img.lbdwa-img');
      if (!im || im.complete) return;
      const t0 = box.scrollTop, h0 = box.scrollHeight;
      const atEnd = waAtEnd;
      im.addEventListener('load', () => {
        setScroll(box, atEnd ? box.scrollHeight : t0 + (box.scrollHeight - h0));
      }, { once: true });
    });
  }

  async function send(payload) {
    if (S.waBusy) return;
    S.waBusy = true; paint();
    try {
      const r = await api.waSend(payload);
      if (r && r.ok) { S.waDraft = ''; S.waTpl = null; S.waVars = []; }
      else toast((r && r.error) || 'Could not send that message.');
    } catch (e) { toast((e && e.message) || 'Could not send that message.'); }
    S.waBusy = false;
    await loadThread(false);
  }

  function threadRow(t, showOwner) {
    const open = !!t.window_open;
    return h('div', { class: 'lbd-row', style: 'cursor:pointer', role: 'button', tabindex: '0',
      onClick: () => openThread(t.id), onKeydown: (e) => { if (e.key === 'Enter') openThread(t.id); } }, [
      h('div', { class: 'd' + (t.last_direction === 'inbound' ? ' in' : '') }, ic('msg', 16)),
      h('div', { class: 'm' }, [
        h('b', null, t.contact_name || pretty(t.number)),
        h('span', null, [(t.last_direction === 'outbound' ? 'You: ' : ''), (t.last_body || 'No messages yet'),
          showOwner && t.owner ? ' · ' + t.owner : ''].join('')),
      ]),
      h('span', { style: 'font-size:11px;color:var(--mu);flex:none' }, [open ? '24 h open' : 'Template only', ' · ', ago(t.last_at)].join('')),
      t.unread ? h('span', { class: 'lbd-badge' }, String(t.unread)) : null,
    ]);
  }

  // ---------------------------------------------------------------- attachments and voice notes (bl_wa_0375)
  const CLIP = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-8.8 8.8a5 5 0 0 1-7.1-7.1l8.9-8.8a3.3 3.3 0 1 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.4l8.2-8.1"/></svg>';
  const MIC = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
  const STOP = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const iconBtn = (html, label, on, extra) => h('button', { class: 'lbd-send', type: 'button', style: 'background:rgba(255,255,255,.10)' + (extra || ''),
    'aria-label': label, title: label, onClick: on, html: html });

  async function sendFile(threadId, file, voice) {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast('That file is larger than 16 MB.'); return; }
    if (S.waBusy) return;
    S.waBusy = true; paint();
    try {
      const up = await api.waUploadMedia(threadId, file);
      const r = await api.waSend({ thread_id: threadId, media: { ...up, voice: !!voice, caption: voice ? '' : (S.waDraft || '') } });
      if (r && r.ok) { S.waDraft = ''; clearPend(); }
      else toast((r && r.error) || 'That attachment could not be sent.');
    } catch (e) { toast((e && e.message) || 'That attachment could not be sent.'); }
    S.waBusy = false;
    await loadThread(false);
  }

  // bl_wa_0383 — a picked file no longer flies off on the spot. It waits in a preview strip and the
  // message box becomes its caption, the way WhatsApp itself does it. The caption still travels as
  // S.waDraft, so the send path above is unchanged.
  function clearPend() {
    if (S.waPend && S.waPend.url) { try { URL.revokeObjectURL(S.waPend.url); } catch (_) {} }
    S.waPend = null;
  }
  const fsize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  const PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  const TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

  // bl_wa_0385 - the recorder now reads the way WhatsApp's does: bin on the left to throw the take away,
  // a blinking dot and a running clock, a moving wave, and one round button to stop and send.
  function recStrip() {
    if (!rec) return null;
    const bars = [];
    for (let i = 0; i < 18; i++) bars.push(h('i', { style: recPaused ? 'animation:none;height:6px' : 'animation-delay:' + (i * 60) + 'ms' }));
    return h('div', { class: 'lbdwa-rec' }, [
      h('button', { class: 'lbdwa-recbtn', type: 'button', 'aria-label': 'Delete recording', title: 'Delete recording',
        onClick: cancelRec, html: TRASH }),
      h('span', { class: 'lbdwa-recdot' + (recPaused ? ' off' : '') }),
      h('span', { class: 'lbdwa-rect', 'data-warecs': '1' }, mmss(recSecs)),
      recPaused && recPrevUrl
        ? h('audio', { class: 'lbdwa-prev', controls: 'controls', src: recPrevUrl })
        : h('span', { class: 'lbdwa-wave' }, bars),
      h('button', { class: 'lbdwa-recbtn', type: 'button', 'aria-label': recPaused ? 'Resume recording' : 'Pause and listen',
        title: recPaused ? 'Resume recording' : 'Pause and listen', onClick: pauseRec, html: recPaused ? MIC : PAUSE }),
      h('button', { class: 'lbdwa-recsend', type: 'button', 'aria-label': 'Send voice note', title: 'Send voice note',
        onClick: stopAndSend }, ic('send', 17)),
    ]);
  }

  function pendStrip() {
    const p = S.waPend;
    if (!p) return null;
    const isImg = /^image\//.test(p.type || '');
    return h('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:8px;padding:8px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.05)' }, [
      isImg
        ? h('img', { src: p.url, alt: '', style: 'width:52px;height:52px;object-fit:cover;border-radius:8px;flex:none' })
        : h('div', { style: 'width:52px;height:52px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.10);font-size:11px;font-weight:800;letter-spacing:.5px' },
            ((p.name.split('.').pop() || 'file').slice(0, 4)).toUpperCase()),
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { style: 'font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.name),
        h('div', { style: 'font-size:11px;color:var(--mu)' }, fsize(p.size) + ' · add a caption, then Send'),
      ]),
      h('button', { class: 'lbd-send', type: 'button', 'aria-label': 'Remove attachment', title: 'Remove attachment',
        style: 'background:rgba(255,255,255,.10);flex:none', disabled: S.waBusy,
        onClick: () => { clearPend(); paint(); } }, '✕'),
    ]);
  }

  function pickFile(threadId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; inp.value = '';
      if (!f) return;
      if (f.size > 16 * 1024 * 1024) { toast('That file is larger than 16 MB.'); return; }
      clearPend();
      S.waPend = { file: f, name: f.name || 'file', size: f.size, type: f.type || '', url: URL.createObjectURL(f) };
      paint();
      const box = rootOf().querySelector('#lbd-wa');
      if (box) { try { box.focus({ preventScroll: true }); } catch (_) { box.focus(); } }   // bl_wa_0389
    };
    inp.click();
  }

  // WhatsApp voice notes are OGG/Opus. Chrome usually records webm/opus instead, so the best supported type is
  // chosen here and, if Meta refuses it, the reason lands on the bubble rather than being swallowed.
  let rec = null, recChunks = [], recTimer = null, recSecs = 0, recCancel = false, recPaused = false, recPrevUrl = '';
  const mmss = (n) => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  function dropPrev() { if (recPrevUrl) { try { URL.revokeObjectURL(recPrevUrl); } catch (_) {} recPrevUrl = ''; } }
  function cancelRec() { if (!rec) return; recCancel = true; try { rec.stop(); } catch (_) {} }
  // bl_wa_0386 - pause keeps the recorder alive and hands back what is on tape so far, so the take can be
  // listened to before it goes. Resume carries on into the same chunk list; nothing recorded is lost.
  function pauseRec() {
    if (!rec) return;
    if (recPaused) { dropPrev(); recPaused = false; try { rec.resume(); } catch (_) {} paint(); return; }
    try { rec.pause(); } catch (_) {}
    recPaused = true;
    try {
      rec.requestData();
      setTimeout(() => {
        if (!recPaused || !recChunks.length) return;
        dropPrev();
        recPrevUrl = URL.createObjectURL(new Blob(recChunks, { type: (rec && rec.mimeType) || 'audio/webm' }));
        paint();
      }, 120);
    } catch (_) {}
    paint();
  }
  function stopAndSend() { if (!rec) return; recCancel = false; try { rec.stop(); } catch (_) {} }
  // bl_wa_0384 — a WhatsApp VOICE message must be Ogg/Opus; Meta refuses anything else with voice:true.
  // Chrome on Windows now reports audio/mp4 as supported, and mp4/AAC cannot be remuxed to Ogg/Opus — so it
  // used to be picked here and the send failed at the carrier. webm/opus comes first: wa-opus.js moves those
  // packets into an Ogg container with no re-encode. mp4 stays last, as a plain audio file of last resort.
  const recMime = () => ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  async function toggleRec(threadId) {
    if (rec) { try { rec.stop(); } catch (_) {} return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This browser cannot record audio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mt = recMime();
      rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
      recChunks = []; recSecs = 0; recCancel = false; recPaused = false; dropPrev();
      rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
      rec.onstop = async () => {
        clearInterval(recTimer); recTimer = null;
        stream.getTracks().forEach((tr) => tr.stop());
        const type = (rec && rec.mimeType) || mt || 'audio/webm';
        const blob = new Blob(recChunks, { type });
        const cancelled = recCancel;
        rec = null; recChunks = []; recSecs = 0; recCancel = false; recPaused = false; dropPrev(); paint();
        if (cancelled) return;
        if (blob.size < 1200) { toast('That recording was too short.'); return; }
        // bl_wa_0378 - WhatsApp refuses audio/webm, which is all Chrome can record. The Opus packets are
        // moved into an Ogg container (no re-encode); if that fails the original goes out as before.
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const f = await waVoiceFile(blob, 'voice-note.' + ext);
        // bl_wa_0384 - if it could not be made Ogg/Opus it still goes, but as a plain audio file rather
        // than a voice message, and the dispatcher is told. The old silent pass-through made Meta refuse
        // the whole message and the bubble only said the carrier did not accept it.
        const isOgg = /ogg/i.test(f.type || '');
        if (!isOgg) toast('This browser cannot record a WhatsApp voice note, so it went as an audio file.');
        await sendFile(threadId, f, isOgg);
      };
      rec.start();
      paint();
      recTimer = setInterval(() => { if (recPaused) return; recSecs += 1; const l = rootOf().querySelector('[data-warecs]'); if (l) l.textContent = mmss(recSecs); }, 1000);
    } catch (e) { toast('Microphone permission is needed to record.'); rec = null; }
  }

  function composer(wa, t) {
    const tpls = wa.templates || [];
    if (t.thread.window_open) {
      // bl_wa_0383 — one Send for both: a waiting attachment goes with the box as its caption,
      // otherwise the box is the message. An empty caption is allowed; an empty message is not.
      const goSend = () => {
        if (S.waBusy) return;
        if (S.waPend) sendFile(t.thread.id, S.waPend.file, false);
        else if ((S.waDraft || '').trim()) send({ thread_id: t.thread.id, body: S.waDraft });
      };
      if (rec) return recStrip();                   // bl_wa_0385 - the pill replaces the whole composer
      return h('div', null, [
        pendStrip(),
        h('div', { class: 'lbd-comp' }, [
          rec ? null : iconBtn(CLIP, S.waPend ? 'Replace the attachment' : 'Attach a file', () => pickFile(t.thread.id)),
          S.waPend ? null : h('button', { class: 'lbd-send', type: 'button', 'data-warec': '1', 'aria-label': rec ? 'Stop and send' : 'Record a voice note',
            title: rec ? 'Stop and send' : 'Record a voice note', style: rec ? 'background:var(--or)' : 'background:rgba(255,255,255,.10)',
            onClick: () => toggleRec(t.thread.id), html: rec ? STOP : MIC }),
          h('textarea', { class: 'lbd-in', id: 'lbd-wa', rows: '2', maxlength: '3000',
            placeholder: S.waPend ? 'Add a caption… (optional)' : 'Write a WhatsApp message…', 'aria-label': S.waPend ? 'Caption' : 'Message',
            onInput: (e) => { S.waDraft = e.target.value; const b = rootOf().querySelector('[data-wasend]'); if (b) b.disabled = S.waBusy || (!S.waPend && !e.target.value.trim()); },
            onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); goSend(); } } }, S.waDraft),
          h('button', { class: 'lbd-send', 'data-wasend': '1', 'aria-label': S.waPend ? 'Send attachment' : 'Send WhatsApp message',
            disabled: S.waBusy || (!S.waPend && !(S.waDraft || '').trim()), onClick: goSend }, ic('send', 17)),
        ]),
      ]);
    }
    // window closed → template only
    if (!tpls.length) {
      return h('div', { class: 'lbd-note', style: 'margin:8px 0 0' }, wa.templates_pending
        ? 'The 24-hour window is closed and LoadBoot’s templates are still in review at Meta, so nothing can be sent until they are approved or this person messages first. Call them, or send an SMS.'
        : 'The 24-hour window is closed and there is no approved template yet. Call them, or send an SMS.');
    }
    const chosen = tpls.find((x) => x.name === S.waTpl) || null;
    return h('div', null, [
      h('div', { class: 'lbd-note', style: 'margin:0 0 8px' }, 'The 24-hour window is closed — only an approved template can go out.'),
      h('div', { class: 'lbdwa-tpls' }, tpls.map((x) => h('button', {
        type: 'button', class: 'lbdwa-tpl' + (S.waTpl === x.name ? ' on' : ''),
        onClick: () => { S.waTpl = x.name; S.waVars = new Array(x.variables).fill(''); paint(); },
      }, [h('b', null, x.name.replace(/_/g, ' ')), h('span', null, labelled(x))]))),
      chosen ? h('div', { style: 'margin-top:8px' }, [
        ...(chosen.var_labels || []).map((lab, i) => h('input', { class: 'lbd-in', style: 'margin-bottom:6px', placeholder: lab, 'aria-label': lab,
          value: S.waVars[i] || '', onInput: (e) => { S.waVars[i] = e.target.value; const pv = rootOf().querySelector('[data-wapv]'); if (pv) pv.textContent = fill(chosen.body, S.waVars); } })),
        h('div', { class: 'lbd-bub out', 'data-wapv': '1', style: 'margin:6px 0' }, fill(chosen.body, S.waVars)),
        h('button', { class: 'lbd-btn', disabled: S.waBusy, onClick: () => send({ thread_id: t.thread.id, template: { name: chosen.name, vars: S.waVars } }) }, 'Send template'),
      ]) : null,
    ]);
  }

  const fill = (body, vars) => (body || '').replace(/\{\{(\d+)\}\}/g, (_, i) => (vars && vars[Number(i) - 1]) || '{{' + i + '}}');
  // bl_wa_0396 - the body with each {{n}} shown as the thing it stands for, so the list reads as English
  // before a single box is filled in. Meta owns the wording; this only makes the placeholders legible.
  const labelled = (x) => (x.body || '').replace(/\{\{(\d+)\}\}/g, (_, i) => {
    const lab = (x.var_labels || [])[Number(i) - 1];
    return lab ? '\u27e8' + lab + '\u27e9' : '{{' + i + '}}';
  });

  function view() {
    const wa = S.wa || { enabled: false, threads: [], unassigned: [], templates: [] };
    if (S.waMax === undefined) { try { S.waMax = localStorage.getItem('lbd_wa_max') === '1'; } catch (_) { S.waMax = false; } }
    const r0 = rootOf(); if (r0) r0.classList.toggle('lbd-max', !!S.waMax);
    if (S.wa == null) { load(false); return h('div', { class: 'lbd-empty' }, 'Loading…'); }
    const off = !wa.enabled
      ? h('div', { class: 'lbd-note', style: 'margin:0 0 10px' },
          wa.reason === 'no_number' ? 'WhatsApp is not connected to a number yet.' : 'WhatsApp is not switched on yet. Messages people send to LoadBoot’s WhatsApp number still arrive here.')
      : null;

    if (S.waId) {
      const t = S.waThread;
      const th = (t && t.thread) || null;
      const left = th && th.window_ends ? fmtLeft(th.window_ends) : null;
      const view2 = h('div', null, [
        h('div', { class: 'lbd-th' }, [
          h('button', { class: 'lbd-ib', 'aria-label': 'Back to conversations', onClick: () => { close(); paint(); } }, ic('back', 17)),
          h('div', { class: 'who' }, [
            h('b', null, (th && (th.contact_name || pretty(th.number))) || 'Conversation'),
            h('span', null, th ? (th.window_open ? 'WhatsApp · replies open ' + (left || 'briefly') : 'WhatsApp · window closed') : 'WhatsApp'),
          ]),
          th ? h('button', { class: 'lbd-ib', 'aria-label': 'Call ' + pretty(th.number), onClick: () => onCall(th.number, { source: 'whatsapp', contact_name: th.contact_name || '' }) }, ic('phone', 17)) : null,
        ]),
        fromLine(wa),
        th && !th.owner_user_id ? h('div', { class: 'lbd-note', style: 'margin:0 0 8px' }, [
          'Nobody has taken this carrier\u2019s conversation yet. ',
          h('button', { class: 'lbd-btn ghost sm', onClick: () => claim(th.id) }, 'Take it'),
        ]) : null,
        msgsNode(),
        th && wa.enabled ? composer(wa, t) : (th ? h('div', { class: 'lbd-note', style: 'margin:8px 0 0' }, 'Sending is switched off.') : null),
      ]);
      setTimeout(() => paintMsgs(listFor !== S.waId), 0);   // bl_wa_0387 - only a new thread jumps to the end
      return h('div', null, [off, view2]);
    }

    const pool = wa.unassigned || [];
    const mineRows = wa.threads || [];
    return h('div', null, [
      off,
      fromLine(wa),
      h('div', { class: 'lbd-comp', style: 'margin:0 0 8px' }, [
        h('input', { class: 'lbd-in', id: 'lbd-wanew', type: 'tel', inputmode: 'tel', placeholder: 'Message one of your carriers or drivers…', 'aria-label': 'Carrier or driver number',
          onKeydown: (e) => { if (e.key === 'Enter') { const v = digits(e.target.value); if (v.length >= 10) startWith(e.target.value); } } }),
        h('button', { class: 'lbd-send', 'aria-label': 'Open conversation', onClick: () => {
          const el2 = rootOf().querySelector('#lbd-wanew'); const v = el2 ? el2.value : '';
          if (digits(v).length >= 10) startWith(v); else toast('Enter the number with its country code.');
        } }, ic('msg', 17)),
      ]),
      pool.length ? h('div', null, [h('div', { style: SEC }, 'Your carriers · waiting · ' + pool.length), ...pool.map((t) => threadRow(t, false))]) : null,
      mineRows.length ? h('div', null, [pool.length ? h('div', { style: SEC }, 'Yours') : null, ...mineRows.map((t) => threadRow(t, false))]) : null,
      !pool.length && !mineRows.length ? h('div', { class: 'lbd-empty' }, 'No WhatsApp conversations yet. Your carriers and their drivers reach you here; brokers and unknown numbers go to Command Center.') : null,
    ]);
  }

  return { load, close, view, openThread, setMax, isMax, unread: () => (S.wa && S.wa.unread) || 0 };
}
