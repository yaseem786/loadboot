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
      const img = h('img', { class: 'lbdwa-img', alt: 'Photo', loading: 'lazy' });
      mediaUrl(m.id).then((u) => { img.src = u; img.onclick = () => window.open(u, '_blank', 'noopener'); })
        .catch((e) => { img.replaceWith(h('div', { class: 'lbdwa-ph' }, (e && e.message) || 'Photo unavailable')); });
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
      try { const u = await mediaUrl(m.id); window.open(u, '_blank', 'noopener'); }
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

  function close() { if (timer) { clearInterval(timer); timer = null; } S.waId = null; S.waThread = null; S.waDraft = ''; S.waTpl = null; S.waVars = []; }

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
      h('small', null, [
        m.kind === 'template' ? h('span', null, 'Template \u00b7 ') : null,
        h('span', null, clock(m.at)),
        failed ? h('span', null, ' \u00b7 Not sent' + (m.error ? ' \u2014 ' + m.error : '')) : null,
        tick(m),
      ]),
    ]);
  }

  function paintMsgs(toEnd) {
    const root = rootOf();
    const box = root && root.querySelector('[data-walist]'); if (!box) return;
    const ms = (S.waThread && S.waThread.messages) || [];
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    let day = '';
    const rows = [];
    ms.forEach((m) => {                       // a separator whenever the date changes, like WhatsApp
      const d = dayLabel(m.at);
      if (d !== day) { day = d; rows.push(h('div', { class: 'lbdwa-day' }, d)); }
      rows.push(bubble(m));
    });
    mount(box, rows.length ? rows : h('div', { class: 'lbd-empty' }, S.waThread ? 'No messages yet.' : 'Loading...'));
    if (toEnd || near) box.scrollTop = box.scrollHeight;
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
      if (r && r.ok) S.waDraft = '';
      else toast((r && r.error) || 'That attachment could not be sent.');
    } catch (e) { toast((e && e.message) || 'That attachment could not be sent.'); }
    S.waBusy = false;
    await loadThread(false);
  }

  function pickFile(threadId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) sendFile(threadId, f, false); };
    inp.click();
  }

  // WhatsApp voice notes are OGG/Opus. Chrome usually records webm/opus instead, so the best supported type is
  // chosen here and, if Meta refuses it, the reason lands on the bubble rather than being swallowed.
  let rec = null, recChunks = [], recTimer = null;
  const recMime = () => ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
    .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  async function toggleRec(threadId) {
    if (rec) { try { rec.stop(); } catch (_) {} return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This browser cannot record audio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mt = recMime();
      rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
      recChunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
      rec.onstop = async () => {
        clearInterval(recTimer); recTimer = null;
        stream.getTracks().forEach((tr) => tr.stop());
        const type = (rec && rec.mimeType) || mt || 'audio/webm';
        const blob = new Blob(recChunks, { type });
        rec = null; recChunks = []; paint();
        if (blob.size < 1200) { toast('That recording was too short.'); return; }
        // bl_wa_0378 - WhatsApp refuses audio/webm, which is all Chrome can record. The Opus packets are
        // moved into an Ogg container (no re-encode); if that fails the original goes out as before.
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        await sendFile(threadId, await waVoiceFile(blob, 'voice-note.' + ext), true);
      };
      rec.start();
      paint();
      recTimer = setInterval(() => { const b = rootOf().querySelector('[data-warec]'); if (b) b.title = 'Stop and send'; }, 1000);
    } catch (e) { toast('Microphone permission is needed to record.'); rec = null; }
  }

  function composer(wa, t) {
    const tpls = wa.templates || [];
    if (t.thread.window_open) {
      return h('div', { class: 'lbd-comp' }, [
        iconBtn(CLIP, 'Attach a file', () => pickFile(t.thread.id)),
        h('button', { class: 'lbd-send', type: 'button', 'data-warec': '1', 'aria-label': rec ? 'Stop and send' : 'Record a voice note',
          title: rec ? 'Stop and send' : 'Record a voice note', style: rec ? 'background:var(--or)' : 'background:rgba(255,255,255,.10)',
          onClick: () => toggleRec(t.thread.id), html: rec ? STOP : MIC }),
        h('textarea', { class: 'lbd-in', id: 'lbd-wa', rows: '2', maxlength: '3000', placeholder: 'Write a WhatsApp message…', 'aria-label': 'Message',
          onInput: (e) => { S.waDraft = e.target.value; const b = rootOf().querySelector('[data-wasend]'); if (b) b.disabled = S.waBusy || !e.target.value.trim(); },
          onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if ((S.waDraft || '').trim()) send({ thread_id: t.thread.id, body: S.waDraft }); } } }, S.waDraft),
        h('button', { class: 'lbd-send', 'data-wasend': '1', 'aria-label': 'Send WhatsApp message', disabled: S.waBusy || !(S.waDraft || '').trim(),
          onClick: () => send({ thread_id: t.thread.id, body: S.waDraft }) }, ic('send', 17)),
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
      h('div', { class: 'lbd-tpl' }, tpls.map((x) => h('button', { type: 'button', style: S.waTpl === x.name ? 'border-color:var(--bl);background:rgba(8,131,247,.18);color:#fff' : '',
        onClick: () => { S.waTpl = x.name; S.waVars = new Array(x.variables).fill(''); paint(); } }, x.name.replace(/_/g, ' ')))),
      chosen ? h('div', { style: 'margin-top:8px' }, [
        ...(chosen.var_labels || []).map((lab, i) => h('input', { class: 'lbd-in', style: 'margin-bottom:6px', placeholder: lab, 'aria-label': lab,
          value: S.waVars[i] || '', onInput: (e) => { S.waVars[i] = e.target.value; const pv = rootOf().querySelector('[data-wapv]'); if (pv) pv.textContent = fill(chosen.body, S.waVars); } })),
        h('div', { class: 'lbd-bub out', 'data-wapv': '1', style: 'margin:6px 0' }, fill(chosen.body, S.waVars)),
        h('button', { class: 'lbd-btn', disabled: S.waBusy, onClick: () => send({ thread_id: t.thread.id, template: { name: chosen.name, vars: S.waVars } }) }, 'Send template'),
      ]) : null,
    ]);
  }

  const fill = (body, vars) => (body || '').replace(/\{\{(\d+)\}\}/g, (_, i) => (vars && vars[Number(i) - 1]) || '{{' + i + '}}');

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
        h('div', { class: 'lbd-msgs', 'data-walist': '1', role: 'log', 'aria-live': 'polite' }),
        th && wa.enabled ? composer(wa, t) : (th ? h('div', { class: 'lbd-note', style: 'margin:8px 0 0' }, 'Sending is switched off.') : null),
      ]);
      setTimeout(() => paintMsgs(true), 0);
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
