// whatsappLive.js — CC "WhatsApp" (bl_wa_0367): the control-room view of LoadBoot's single WhatsApp line.
//   · STATE — the WABA number, ids, master switch, hourly cap. Read live from dialer_config.
//   · CONVERSATIONS — every thread on the shared number: who owns it, whether Meta's 24-hour window is open,
//     unread count, last message. Staff can reassign an owner, close / reopen a thread and reply themselves.
//   · TEMPLATES — Meta approves templates, we only mirror their state here. Nothing can be sent outside the
//     24-hour window until a template's status is 'approved'.
//   · LAST WEBHOOK EVENTS — Telnyx does not document the inbound WhatsApp payload, so every event is logged raw.
//     This list is how the true shape gets read after the first real message.
// Staff-gated by the RPCs themselves (cc_wa_*). Self-contained scoped styles (wl-). No alert/confirm/prompt.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead } from '../../shared/ui/components.js';
import { waVoiceFile } from '../../shared/wa-opus.js';   // bl_wa_0378 - Chrome records webm; WhatsApp needs ogg
import { ccWaOverview, ccWaAssign, ccWaThreadSet, ccWaTemplateSet, ccWaTemplatesSync, ccWaTemplateSubmit, ccWaNotifyAssigned, ccDialerConfigSet, waThread, waSend, waMediaBlob, waStart, waUploadMedia } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const ET = 'America/New_York';
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const pretty = (n) => { const d = digits(n); const k = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return k.length === 10 ? '(' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6) : String(n || '—'); };
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const left = (v) => { const ms = new Date(v).getTime() - Date.now(); if (!(ms > 0)) return null; const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };

const CSS = `
.wl{--b:#0883F7;--g:#22c55e;--r:#ef4444;--a:#f59e0b;--mu:#93a4c3;--ln:rgba(255,255,255,.09)}
.wl-card{background:var(--card,#fff);border:1px solid var(--line,#e5e9f2);border-radius:16px;padding:16px;margin-bottom:16px}
.wl-card h3{margin:0 0 4px;font-size:16px}.wl-card .hint{color:var(--mut,#64748b);font-size:13px;margin:0 0 12px}
.wl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:14px}
.wl-kpi{border:1px solid var(--line,#e5e9f2);border-radius:14px;padding:11px 13px;background:var(--card,#fff)}
.wl-kpi b{display:block;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.wl-kpi span{font-size:11px;color:var(--mut,#64748b);text-transform:uppercase;letter-spacing:.7px}
.wl-t{width:100%;border-collapse:collapse;font-size:13.5px}
.wl-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut,#64748b);padding:8px 10px;border-bottom:1px solid var(--line,#e5e9f2);white-space:nowrap}
.wl-t td{padding:9px 10px;border-bottom:1px solid var(--line,#eef1f6);vertical-align:middle}
.wl-tw{overflow:auto}
.wl-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:rgba(100,116,139,.14);color:#475569}
.wl-pill.g{background:rgba(34,197,94,.16);color:#15803d}.wl-pill.a{background:rgba(245,158,11,.18);color:#b45309}.wl-pill.r{background:rgba(239,68,68,.16);color:#b91c1c}
.wl-btn{border:1px solid var(--line,#e5e9f2);background:var(--card,#fff);border-radius:10px;padding:6px 11px;font:600 12.5px Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.wl-btn.pri{background:var(--b);border-color:var(--b);color:#fff}
.wl-in,.wl-sel{border:1px solid var(--line,#e5e9f2);border-radius:10px;padding:7px 10px;font:500 13px Inter,system-ui,sans-serif;background:var(--card,#fff);color:inherit;max-width:100%}
.wl-msgs{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto;padding:10px;border:1px solid var(--line,#e5e9f2);border-radius:12px;background:var(--bg2,#f8fafc)}
.wl-bub{max-width:80%;padding:8px 11px;border-radius:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid var(--line,#e5e9f2);align-self:flex-start}
.wl-bub.out{align-self:flex-end;background:var(--b);border-color:var(--b);color:#fff}
.wl-bub.fail{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.4);color:#b91c1c}
.wl-bub small{display:block;margin-top:3px;font-size:10px;opacity:.75}
/* bl_wa_0396 - the template list shows the message that will go out, not just its name. */
.wl-tpls{display:flex;flex-direction:column;gap:6px;max-width:580px}
.wl-tpl{text-align:left;border:1px solid var(--line,#e5e9f2);background:var(--card,#fff);color:inherit;border-radius:12px;padding:9px 11px;cursor:pointer;font:inherit}
.wl-tpl b{display:block;font-size:12.5px;text-transform:capitalize;margin-bottom:2px}
.wl-tpl span{display:block;font-size:12px;line-height:1.45;color:var(--muted,#64748b);white-space:pre-wrap}
.wl-tpl.on{border-color:var(--b);box-shadow:0 0 0 2px rgba(8,131,247,.18)}
.wl-day{align-self:center;background:rgba(100,116,139,.14);color:var(--mut,#64748b);font:600 10.5px Inter,system-ui,sans-serif;padding:3px 10px;border-radius:999px;margin:6px 0 2px}
.wl-img{max-width:240px;max-height:280px;border-radius:12px;display:block;cursor:zoom-in;object-fit:cover}
.wl-ph{width:200px;height:110px;border-radius:12px;display:grid;place-items:center;background:rgba(100,116,139,.12);font-size:11.5px}
.wl-aud{width:250px;height:36px;margin:2px 0}
.wl-doc{display:flex;gap:9px;align-items:center;background:rgba(100,116,139,.12);border:0;border-radius:10px;padding:9px 11px;cursor:pointer;min-width:170px;color:inherit;font:600 12.5px Inter,system-ui,sans-serif;text-align:left}
.wl-doc small{display:block;font-weight:500;opacity:.75;margin-top:2px;font-size:10.5px}
.wl-tick{margin-left:5px;letter-spacing:-3px;font-size:11px}.wl-tick.read{color:#7fd0ff}
.wl-note{border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.1);color:#92400e;border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}
.wl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.wl-mono{font:500 11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mut,#64748b);word-break:break-all}
.wl-kv{display:flex;flex-direction:column;gap:2px;margin-right:20px}
.wl-kv span{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--mut,#64748b)}
.wl-kv b{font:600 13.5px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
`;

// bl_wa_0385 — Chrome blocks window.open on a blob: URL opened with 'noopener' (the blob belongs to the
// document that created it, and 'noopener' severs that), so attachments appeared not to open at all. A photo
// gets an in-page overlay; anything else is opened through an anchor click, which keeps the tie.
function waOpenBlob(url, name) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.download = name || '';
  document.body.appendChild(a); a.click(); a.remove();
}
function waLightbox(url) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(3,8,20,.93);display:grid;place-items:center;cursor:zoom-out';
  const im = document.createElement('img');
  im.src = url; im.alt = 'Photo';
  im.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.6)';
  im.onclick = (e) => e.stopPropagation();
  box.appendChild(im);
  const esc = (e) => { if (e.key === 'Escape') shut(); };
  function shut() { document.removeEventListener('keydown', esc); box.remove(); }
  box.onclick = shut;
  document.addEventListener('keydown', esc);
  document.body.appendChild(box);
}

export async function renderWhatsappLive(host) {
  if (!document.getElementById('wl-css')) { const s = document.createElement('style'); s.id = 'wl-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = el('div', { class: 'wl' });
  const stateEl = el('div'), listEl = el('div'), threadEl = el('div'), tplEl = el('div'), logEl = el('div');
  mount(host, root);
  let ov = null, open = null, busy = false, timer = null, editLine = false, sending = false, newOpen = false;
  // attachments and voice notes (bl_wa_0375) — same rules as the dispatcher dock
  let rec = null, recChunks = [];
  async function sendFile(threadId, file, voice) {
    if (!file || sending) return;
    if (file.size > 16 * 1024 * 1024) { toast('That file is larger than 16 MB.'); return; }
    sending = true; paintThread();
    try {
      const up = await waUploadMedia(threadId, file);
      const r = await waSend({ thread_id: threadId, media: { ...up, voice: !!voice, caption: voice ? '' : draft } });
      if (!r || !r.ok) throw new Error((r && r.error) || 'That attachment could not be sent.');
      draft = ''; clearPend();
      sending = false;
      await loadThread(open, true); await load(true);
    } catch (e) { sending = false; toast(humanizeError(e)); paintThread(); }
  }
  // bl_wa_0383 — the picked file waits in a preview strip and the reply box becomes its caption,
  // the way WhatsApp itself does it. Same behaviour as the dispatcher dock.
  let pend = null;
  function clearPend() {
    if (pend && pend.url) { try { URL.revokeObjectURL(pend.url); } catch (_) {} }
    pend = null;
  }
  const fsize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  function pendStrip() {
    if (!pend) return null;
    const isImg = /^image\//.test(pend.type || '');
    return el('div', { class: 'wl-row', style: 'align-items:center;gap:10px;padding:8px;border:1px solid rgba(255,255,255,.14);border-radius:10px;margin-bottom:8px' }, [
      isImg
        ? el('img', { src: pend.url, alt: '', style: 'width:48px;height:48px;object-fit:cover;border-radius:8px;flex:none' })
        : el('div', { style: 'width:48px;height:48px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.10);font-size:11px;font-weight:800' },
            ((pend.name.split('.').pop() || 'file').slice(0, 4)).toUpperCase()),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { style: 'font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, pend.name),
        el('span', { class: 'hint' }, fsize(pend.size) + ' · add a caption, then Send'),
      ]),
      el('button', { class: 'wl-btn', disabled: sending, onClick: () => { clearPend(); paintThread(); } }, 'Remove'),
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
      pend = { file: f, name: f.name || 'file', size: f.size, type: f.type || '', url: URL.createObjectURL(f) };
      paintThread();
    };
    inp.click();
  }
  // bl_wa_0384 — webm/opus before mp4: only those packets can be remuxed to the Ogg/Opus that Meta
  // requires for a voice message. Chrome now offers audio/mp4, which the carrier refuses with voice:true.
  const recMime = () => ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
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
        stream.getTracks().forEach((tr) => tr.stop());
        const type = (rec && rec.mimeType) || mt || 'audio/webm';
        const blob = new Blob(recChunks, { type });
        rec = null; recChunks = []; paintThread();
        if (blob.size < 1200) { toast('That recording was too short.'); return; }
        // bl_wa_0378 - WhatsApp refuses audio/webm, which is all Chrome can record. The Opus packets are
        // moved into an Ogg container (no re-encode); if that fails the original goes out as before.
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const f = await waVoiceFile(blob, 'voice-note.' + ext);
        // bl_wa_0384 - not Ogg/Opus means it cannot be a voice message; it still goes, as an audio file,
        // and the sender is told rather than the send failing silently at the carrier.
        const isOgg = /ogg/i.test(f.type || '');
        if (!isOgg) toast('This browser cannot record a WhatsApp voice note, so it went as an audio file.');
        await sendFile(threadId, f, isOgg);
      };
      rec.start(); paintThread();
    } catch (_) { rec = null; toast('Microphone permission is needed to record.'); }
  }

  async function startNew() {
    const box = document.getElementById('wl-newnum');
    const v = (box && box.value || '').trim();
    if (!v) return;
    try {
      const r = await waStart(v, null);
      if (!r || r.error) throw new Error((r && r.error) || 'Could not open that conversation.');
      newOpen = false; open = r.thread.id;
      await load(true); await loadThread(open, false);
      toast('Conversation open. Nothing has been sent.');
    } catch (e) { toast(humanizeError(e)); }
  }
  // bl_wa_0372 - attachments and WhatsApp-style chrome (day separators, delivery ticks)
  const mediaCache = new Map();
  async function mediaUrl(id) {
    if (mediaCache.has(id)) return mediaCache.get(id);
    const u = URL.createObjectURL(await waMediaBlob(id));
    mediaCache.set(id, u); return u;
  }
  const dayLabel = (iso) => {
    const d = new Date(iso), today = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return 'Today';
    if (same(d, new Date(today.getTime() - 86400000))) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: ET });
  };
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET }) + ' ET';
  function tick(m) {
    if (m.direction !== 'outbound' || m.status === 'failed') return null;
    if (m.status === 'queued') return el('span', { class: 'wl-tick' }, '\u00b7\u00b7');
    const two = m.status === 'delivered' || m.status === 'read';
    return el('span', { class: 'wl-tick' + (m.status === 'read' ? ' read' : '') }, two ? '\u2713\u2713' : '\u2713');
  }
  function mediaEl(m) {
    const kind = m.media_kind || '', mime = m.mime || '';
    if (kind === 'image' || kind === 'sticker' || mime.startsWith('image/')) {
      const img = el('img', { class: 'wl-img', alt: 'Photo', loading: 'lazy' });
      mediaUrl(m.id).then((u) => { img.src = u; img.onclick = () => waLightbox(u); })
        .catch((e) => img.replaceWith(el('div', { class: 'wl-ph' }, (e && e.message) || 'Photo unavailable')));
      return img;
    }
    if (kind === 'audio' || kind === 'voice' || mime.startsWith('audio/')) {
      const au = el('audio', { class: 'wl-aud', controls: 'controls', preload: 'none' });
      mediaUrl(m.id).then((u) => { au.src = u; }).catch(() => au.replaceWith(el('div', { class: 'wl-ph' }, 'Audio unavailable')));
      return el('div', null, [m.voice ? el('small', null, 'Voice message') : null, au]);
    }
    if (kind === 'video' || mime.startsWith('video/')) {
      const v = el('video', { class: 'wl-img', controls: 'controls', preload: 'none' });
      mediaUrl(m.id).then((u) => { v.src = u; }).catch(() => v.replaceWith(el('div', { class: 'wl-ph' }, 'Video unavailable')));
      return v;
    }
    const name = m.file_name || (kind === 'document' ? 'Document' : 'Attachment');
    return el('button', { class: 'wl-doc', type: 'button', onClick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { waOpenBlob(await mediaUrl(m.id), m.file_name || 'attachment'); } catch (err) { toast(humanizeError(err)); }
      b.disabled = false;
    } }, [icon('doc', 16), el('span', null, [name, el('small', null, (mime || 'file').split(';')[0])])]);
  }
  function msgRows(list) {
    let day = '';
    const rows = [];
    (list || []).forEach((m) => {
      const d = dayLabel(m.at);
      if (d !== day) { day = d; rows.push(el('div', { class: 'wl-day' }, d)); }
      const media = m.has_media ? mediaEl(m) : null;
      rows.push(el('div', { class: 'wl-bub' + (m.direction === 'outbound' ? ' out' : '') + (m.status === 'failed' ? ' fail' : '') }, [
        media,
        m.body ? el('div', null, m.body) : null,
        el('small', null, [
          m.kind === 'template' ? el('span', null, 'Template \u00b7 ') : null,
          el('span', null, clock(m.at)),
          m.error ? el('span', null, ' \u00b7 ' + m.error) : null,
          tick(m),
        ]),
      ]));
    });
    return rows.length ? rows : [el('div', { class: 'wl-ph', style: 'width:100%;height:60px' }, 'No messages yet.')];
  }
  const F = { q: '', dispatcher: '' };

  root.append(
    sectionHead('WhatsApp', 'LoadBoot’s public WhatsApp number. Carrier and driver conversations go to their dispatcher; brokers, shippers and strangers are yours. Meta’s 24-hour window decides what can be sent.', []),
    stateEl, listEl, threadEl, tplEl, logEl);

  async function load(quiet) {
    if (busy) return; busy = true;
    try {
      const r = await ccWaOverview({ q: F.q, dispatcher: F.dispatcher });
      if (r && r.error) throw new Error(r.error);
      ov = r; paintState(); paintList(); paintTpl(); paintLog();
      if (open) await loadThread(open, true);
    } catch (e) { if (!quiet) toast(humanizeError(e)); }
    busy = false;
  }

  async function saveCfg(p) {
    try { const r = await ccDialerConfigSet(p); if (r && r.error) throw new Error(r.error); editLine = false; toast('Saved.'); await load(true); }
    catch (e) { toast(humanizeError(e)); }
  }

  function paintState() {
    const c = ov || {};
    const saved = !!(c.number && c.messaging_profile_id);
    const kv = (k, v) => el('div', { class: 'wl-kv' }, [el('span', null, k), el('b', null, v || '\u2014')]);
    const toggle = el('button', { class: 'wl-btn', onClick: () => saveCfg({ wa_enabled: !c.enabled }) }, c.enabled ? 'Switch sending OFF' : 'Switch sending ON');
    const pill = el('span', { class: 'wl-pill ' + (c.enabled ? 'g' : 'a') }, c.enabled ? 'Sending on' : 'Sending off');
    mount(stateEl, el('div', { class: 'wl-card' }, [
      el('h3', null, 'The line'),
      el('p', { class: 'hint' }, 'Set these from Telnyx \u2192 Messaging \u2192 WhatsApp and Meta\u2019s WhatsApp Manager. The switch below only decides whether LoadBoot may SEND; messages people send in always arrive.'),
      !c.number ? el('div', { class: 'wl-note' }, 'No WhatsApp number is set yet, so nothing can be sent or matched to a conversation.') : null,
      el('div', { class: 'wl-kpis' }, [
        ['Conversations', (c.counts && c.counts.threads) || 0], ['Unassigned', (c.counts && c.counts.unassigned) || 0],
        ['24 h windows open', (c.counts && c.counts.open_windows) || 0], ['Unread', (c.counts && c.counts.unread) || 0],
        ['Messages 24 h', (c.counts && c.counts.msgs_24h) || 0], ['Failed 24 h', (c.counts && c.counts.failed_24h) || 0],
      ].map(([k, v]) => el('div', { class: 'wl-kpi' }, [el('b', null, String(v)), el('span', null, k)]))),
      saved && !editLine
        // saved: read it, don't re-type it. "Change" puts the fields back.
        ? el('div', null, [
            el('div', { class: 'wl-row' }, [
              kv('Number', c.number), kv('WABA id', c.waba_id), kv('Phone number id', c.phone_number_id),
              kv('Messaging profile id', c.messaging_profile_id), kv('Max per hour', String(c.max_per_hour || 120)),
            ]),
            el('div', { class: 'wl-row' }, [
              el('span', { class: 'wl-pill g' }, 'Saved'),
              el('button', { class: 'wl-btn', onClick: () => { editLine = true; paintState(); } }, 'Change'),
              toggle, pill,
            ]),
          ])
        : el('div', { class: 'wl-row' }, [
            el('label', null, ['Number ', el('input', { class: 'wl-in', id: 'wl-num', value: c.number || '', placeholder: '+18153651168' })]),
            el('label', null, ['WABA id ', el('input', { class: 'wl-in', id: 'wl-waba', value: c.waba_id || '', placeholder: '1620552536337068' })]),
            el('label', null, ['Phone number id ', el('input', { class: 'wl-in', id: 'wl-pnid', value: c.phone_number_id || '', placeholder: '1293822517154161' })]),
            el('label', null, ['Messaging profile id ', el('input', { class: 'wl-in', id: 'wl-prof', value: c.messaging_profile_id || '' })]),
            el('label', null, ['Max per hour ', el('input', { class: 'wl-in', id: 'wl-cap', type: 'number', min: '1', max: '1000', style: 'width:90px', value: String(c.max_per_hour || 120) })]),
            el('button', { class: 'wl-btn pri', onClick: () => saveCfg({
              wa_number: (document.getElementById('wl-num') || {}).value || '',
              wa_waba_id: (document.getElementById('wl-waba') || {}).value || '',
              wa_phone_number_id: (document.getElementById('wl-pnid') || {}).value || '',
              wa_messaging_profile_id: (document.getElementById('wl-prof') || {}).value || '',
              max_wa_per_hour: Number((document.getElementById('wl-cap') || {}).value || 120),
            }) }, 'Save'),
            saved ? el('button', { class: 'wl-btn', onClick: () => { editLine = false; paintState(); } }, 'Cancel') : null,
            toggle, pill,
          ]),
    ]));
  }

  function ownerSelect(t) {
    const disp = (ov && ov.dispatchers) || [], staff = (ov && ov.staff) || [];
    const opt = (x) => el('option', { value: x.user_id }, x.name || x.user_id);
    const sel = el('select', { class: 'wl-sel', onChange: async (e) => {
      try { const r = await ccWaAssign(t.id, e.target.value || null); if (r && r.error) throw new Error(r.error); toast('Owner updated.'); await load(true); }
      catch (err) { toast(humanizeError(err)); }
    } }, [
      // empty = nobody's name on it: Command Center answers. Staff can also put their own name on it.
      el('option', { value: '' }, 'Command Center'),
      disp.length ? el('optgroup', { label: 'Dispatchers' }, disp.map(opt)) : null,
      staff.length ? el('optgroup', { label: 'Staff' }, staff.map(opt)) : null,
    ]);
    sel.value = t.owner_user_id || '';
    return sel;
  }

  function paintList() {
    const rows = (ov && ov.threads) || [];
    mount(listEl, el('div', { class: 'wl-card' }, [
      el('h3', null, 'Conversations'),
      el('p', { class: 'hint' }, 'Carriers and their drivers are routed to their own dispatcher automatically. Everything else — brokers, shippers, unknown numbers — stays unassigned and is Command Center’s to answer. Hand one to a dispatcher or a staff member here, or leave it with Command Center.'),
      el('div', { class: 'wl-row', style: 'margin:0 0 12px' }, [
        el('input', { class: 'wl-in', type: 'search', placeholder: 'Search name, number or message', value: F.q,
          onInput: (e) => { F.q = e.target.value; clearTimeout(paintList.t); paintList.t = setTimeout(() => load(true), 350); } }),
        el('select', { class: 'wl-sel', onChange: (e) => { F.dispatcher = e.target.value; load(true); } },
          [el('option', { value: '' }, 'Every dispatcher'), ...((ov && ov.dispatchers) || []).map((d) => el('option', { value: d.user_id }, d.name || d.user_id))]),
        el('button', { class: 'wl-btn', onClick: () => load(false) }, [icon('refresh', 15), 'Refresh']),
        el('button', { class: 'wl-btn', onClick: () => { newOpen = !newOpen; paintList(); } }, [icon('chat', 15), newOpen ? 'Cancel' : 'New conversation']),
        // one e-mail when the set is complete, not one per assignment
        F.dispatcher ? el('button', { class: 'wl-btn', onClick: async () => {
          try {
            const r = await ccWaNotifyAssigned(F.dispatcher);
            if (r && r.error) throw new Error(r.error);
            toast('E-mail sent — ' + r.threads + ' conversation(s) listed.');
          } catch (e) { toast(humanizeError(e)); }
        } }, [icon('mail', 15), 'Email dispatcher']) : null,
      ]),
      newOpen ? el('div', { class: 'wl-row', style: 'margin:0 0 12px' }, [
        el('input', { class: 'wl-in', id: 'wl-newnum', placeholder: 'Number with country code, e.g. +14695550100', style: 'min-width:280px',
          onKeydown: (e) => { if (e.key === 'Enter') startNew(); } }),
        el('button', { class: 'wl-btn pri', onClick: () => startNew() }, 'Open conversation'),
        el('span', { class: 'hint' }, 'Opening one sends nothing. Outside the 24-hour window only an approved template can go out.'),
      ]) : null,
      rows.length ? el('div', { class: 'wl-tw' }, el('table', { class: 'wl-t' }, [
        el('thead', null, el('tr', null, ['Contact', 'Owner', '24 h window', 'Last message', 'When', ''].map((k) => el('th', null, k)))),
        el('tbody', null, rows.map((t) => el('tr', null, [
          el('td', null, [el('b', null, t.contact_name || pretty(t.number)), t.contact_name ? el('div', { class: 'wl-mono' }, t.number) : null,
            t.unread ? el('span', { class: 'wl-pill a' }, t.unread + ' unread') : null]),
          el('td', null, ownerSelect(t)),
          el('td', null, t.window_open ? el('span', { class: 'wl-pill g' }, 'open · ' + (left(t.window_ends) || 'briefly')) : el('span', { class: 'wl-pill' }, 'closed · template only')),
          el('td', null, (t.last_direction === 'outbound' ? 'Us: ' : '') + (t.last_body || '—')),
          el('td', null, et(t.last_at)),
          el('td', null, el('div', { style: 'display:flex;gap:6px' }, [
            el('button', { class: 'wl-btn', onClick: () => { open = t.id; loadThread(t.id, false); } }, 'Open'),
            el('button', { class: 'wl-btn', onClick: async () => {
              try { const r = await ccWaThreadSet({ id: t.id, status: t.status === 'open' ? 'closed' : 'open' }); if (r && r.error) throw new Error(r.error); await load(true); }
              catch (e) { toast(humanizeError(e)); }
            } }, t.status === 'open' ? 'Close' : 'Reopen'),
          ])),
        ]))),
      ])) : el('p', { class: 'hint' }, 'No conversations yet. The first one appears when someone messages LoadBoot’s WhatsApp number, or when a dispatcher starts one.'),
    ]));
  }

  let thr = null, draft = '', tplName = '', tplVars = [];
  async function loadThread(id, quiet) {
    try {
      const r = await waThread(id);
      if (r && r.error) throw new Error(r.error);
      thr = r; paintThread();
    } catch (e) { if (!quiet) toast(humanizeError(e)); }
  }
  const fill = (body, vars) => (body || '').replace(/\{\{(\d+)\}\}/g, (_, i) => (vars && vars[Number(i) - 1]) || '{{' + i + '}}');
  // bl_wa_0396 - the same body with each {{n}} shown as what it stands for, so the list can be read
  // before anything is typed. Meta owns the wording; this only makes the placeholders legible.
  const labelled = (x) => (x.body || '').replace(/\{\{(\d+)\}\}/g, (_, i) => {
    const lab = (x.var_labels || [])[Number(i) - 1];
    return lab ? '\u27e8' + lab + '\u27e9' : '{{' + i + '}}';
  });

  // one click, one message: a second click while the first is still in flight is ignored (the first live
  // test sent the same reply twice, 1.3 s apart, because nothing stopped it). The server refuses a repeat too.
  async function send(payload) {
    if (sending) return;
    sending = true; paintThread();
    try {
      const r = await waSend(payload);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Could not send that message.');
      draft = ''; tplVars = [];
      sending = false;
      await loadThread(open, true); await load(true);
    } catch (e) { sending = false; toast(humanizeError(e)); paintThread(); }
  }

  function paintThread() {
    if (!open || !thr || !thr.thread) { mount(threadEl, el('div')); return; }
    const t = thr.thread;
    const approved = ((ov && ov.templates) || []).filter((x) => x.status === 'approved');
    const chosen = approved.find((x) => x.name === tplName) || null;
    mount(threadEl, el('div', { class: 'wl-card' }, [
      el('h3', null, (t.contact_name || pretty(t.number)) + ' · ' + t.number),
      el('p', { class: 'hint' }, [t.owner ? 'Owner: ' + t.owner : 'Unassigned', ' · ', t.window_open ? 'replies open for ' + (left(t.window_ends) || 'a moment') : 'window closed — approved template only'].join('')),
      el('div', { class: 'wl-msgs' }, msgRows(thr.messages)),
      t.window_open ? el('div', null, [
        pendStrip(),
        el('div', { class: 'wl-row' }, [
          el('input', { class: 'wl-in', style: 'flex:1;min-width:240px', placeholder: pend ? 'Add a caption… (optional)' : 'Reply as LoadBoot staff…', value: draft, onInput: (e) => { draft = e.target.value; } }),
          el('button', { class: 'wl-btn', disabled: sending, onClick: () => pickFile(t.id) }, [icon('upload', 15), pend ? 'Replace' : 'Attach']),
          pend ? null : el('button', { class: 'wl-btn', disabled: sending, onClick: () => toggleRec(t.id) }, rec ? 'Stop & send' : 'Record voice'),
          el('button', { class: 'wl-btn pri', disabled: sending, onClick: () => { if (pend) sendFile(t.id, pend.file, false); else if (draft.trim()) send({ thread_id: t.id, body: draft }); } }, sending ? 'Sending…' : (pend ? 'Send file' : 'Send')),
          el('button', { class: 'wl-btn', onClick: () => { clearPend(); open = null; thr = null; paintThread(); } }, 'Close panel'),
        ]),
      ]) : el('div', null, [
        !approved.length
          ? el('div', { class: 'wl-note' }, 'The window is closed and no template is approved at Meta yet, so nothing can be sent to this person until they message first.')
          : el('div', null, [
            el('div', { class: 'wl-tpls' }, approved.map((x) => el('button', {
              type: 'button', class: 'wl-tpl' + (tplName === x.name ? ' on' : ''),
              onClick: () => { tplName = x.name; tplVars = new Array(x.variables || 0).fill(''); paintThread(); },
            }, [el('b', null, x.name.replace(/_/g, ' ')), el('span', null, labelled(x))]))),
            chosen ? el('div', { class: 'wl-row', style: 'margin-top:8px' }, [
              ...(chosen.var_labels || []).map((lab, i) => el('input', { class: 'wl-in', placeholder: lab, value: tplVars[i] || '', onInput: (e) => { tplVars[i] = e.target.value; } })),
              el('button', { class: 'wl-btn pri', disabled: sending, onClick: () => send({ thread_id: t.id, template: { name: chosen.name, vars: tplVars } }) }, sending ? 'Sending…' : 'Send template'),
            ]) : null,
          ]),
        chosen ? el('div', { class: 'wl-bub out', style: 'margin-top:10px' }, fill(chosen.body, tplVars)) : null,
        el('div', { class: 'wl-row' }, [el('button', { class: 'wl-btn', onClick: () => { open = null; thr = null; paintThread(); } }, 'Close panel')]),
      ]),
    ]));
    if (tplName && !approved.find((x) => x.name === tplName)) tplName = '';
  }

  // bl_wa_0377 - the status comes FROM Meta now (asked through Telnyx, which owns the WABA), not from somebody's
  // memory of a Meta screen. The hand-set dropdown stays as the override for when something looks wrong.
  let tplBusy = false;
  async function tplSync() {
    if (tplBusy) return;
    tplBusy = true; paintTpl();
    try {
      const r = await ccWaTemplatesSync({ action: 'sync' });
      const ch = (r && r.changed) || [];
      toast(ch.length
        ? ch.map((c) => c.name + ': ' + (c.from || 'new') + ' → ' + c.to).join(' · ')
        : 'Read from Meta — nothing has changed.');
      await load(true);
    } catch (e) { toast((e && e.message) || humanizeError(e)); }
    tplBusy = false; paintTpl();
  }
  async function tplSubmit(name) {
    if (tplBusy) return;
    if (!window.confirm('Send "' + name + '" to Meta for approval? You cannot edit it while it is in review.')) return;
    tplBusy = true; paintTpl();
    try {
      await ccWaTemplateSubmit(name);
      toast(name + ' is with Meta. Press Sync from Meta later to see the answer.');
      await load(true);
    } catch (e) { toast((e && e.message) || humanizeError(e)); }
    tplBusy = false; paintTpl();
  }
  const tplPill = (st) => el('span', { class: 'wl-pill ' + (st === 'approved' ? 'g' : (st === 'rejected' || st === 'disabled' || st === 'paused' || st === 'limit_exceeded') ? 'r' : '') },
    st === 'pending' ? 'in review' : st === 'draft' ? 'draft · not sent' : String(st || '').replace(/_/g, ' '));

  function paintTpl() {
    const rows = (ov && ov.templates) || [];
    const synced = rows.map((x) => x.synced_at).filter(Boolean).sort().pop();
    mount(tplEl, el('div', { class: 'wl-card' }, [
      el('h3', null, 'Templates'),
      el('p', { class: 'hint' }, 'Meta decides these, not LoadBoot. “Sync from Meta” reads the real status through Telnyx and writes it in — that is the status the server enforces when the 24-hour window is shut.'),
      // 21 Sep 2026, proven live: a template created in Meta's own WhatsApp Manager does NOT appear in Telnyx's
      // template list, so the sync cannot read its status. Say so here rather than let it look like a fault.
      el('p', { class: 'hint' }, 'A template created in Meta’s WhatsApp Manager does not appear in Telnyx’s list, so the sync cannot read its status — use Override for those. Create new ones with Submit to Meta and the sync reads them by itself.'),
      el('div', { class: 'wl-row' }, [
        el('button', { class: 'wl-btn pri', disabled: tplBusy, onClick: tplSync }, tplBusy ? 'Asking Meta…' : 'Sync from Meta'),
        el('span', { class: 'hint' }, synced ? 'Last read ' + et(synced) : 'Never read from Meta yet.'),
      ]),
      el('div', { class: 'wl-tw' }, el('table', { class: 'wl-t' }, [
        el('thead', null, el('tr', null, ['Name', 'Category', 'Variables', 'Body', 'Status at Meta', 'Override'].map((k) => el('th', null, k)))),
        el('tbody', null, rows.map((x) => el('tr', null, [
          el('td', null, el('b', null, x.name)),
          el('td', null, x.category),
          el('td', null, String(x.variables)),
          el('td', null, [
            el('span', { class: 'wl-mono' }, x.body),
            (x.var_labels && x.var_labels.length)
              ? el('div', { class: 'hint' }, x.var_labels.map((l, i) => '{{' + (i + 1) + '}} ' + l).join(' · '))
              : null,
          ]),
          el('td', null, [
            tplPill(x.status),
            x.rejection_reason ? el('div', { class: 'hint' }, 'Meta: ' + x.rejection_reason) : null,
            x.note ? el('div', { class: 'hint' }, x.note) : null,
            x.status === 'draft'
              ? el('div', null, el('button', { class: 'wl-btn', disabled: tplBusy, onClick: () => tplSubmit(x.name) }, 'Submit to Meta'))
              : null,
          ]),
          el('td', null, x.status === 'draft' ? el('span', { class: 'hint' }, '—') : (() => {
            const sel = el('select', { class: 'wl-sel', onChange: async (e) => {
              try { const r = await ccWaTemplateSet({ name: x.name, status: e.target.value }); if (r && r.error) throw new Error(r.error); toast('Template status saved by hand. Sync from Meta will overwrite it.'); await load(true); }
              catch (err) { toast(humanizeError(err)); }
            } }, ['pending', 'approved', 'rejected', 'paused', 'disabled'].map((s) => el('option', { value: s }, s)));
            sel.value = x.status; return sel;
          })()),
        ]))),
      ])),
    ]));
  }

  function paintLog() {
    const rows = (ov && ov.last_events) || [];
    mount(logEl, el('div', { class: 'wl-card' }, [
      el('h3', null, 'Last webhook events'),
      el('p', { class: 'hint' }, 'Telnyx does not document the inbound WhatsApp payload, so LoadBoot stores every event it receives. If a real message does not become a conversation, the answer is here — and “verified: false” means the request was NOT signed with LoadBoot’s Telnyx key and was only logged, never acted on.'),
      rows.length ? el('div', { class: 'wl-tw' }, el('table', { class: 'wl-t' }, [
        el('thead', null, el('tr', null, ['When', 'Event', 'Signed', 'Result'].map((k) => el('th', null, k)))),
        el('tbody', null, rows.map((e) => el('tr', null, [
          el('td', null, et(e.at)),
          el('td', null, e.event_type || '—'),
          el('td', null, el('span', { class: 'wl-pill ' + (e.verified ? 'g' : 'r') }, e.verified ? 'yes' : 'no')),
          el('td', null, el('span', { class: 'wl-mono' }, e.result ? JSON.stringify(e.result) : '—')),
        ]))),
      ])) : el('p', { class: 'hint' }, 'Nothing yet. The first WhatsApp webhook Telnyx sends lands here.'),
    ]));
  }

  await load(false);
  timer = setInterval(() => { if (document.visibilityState === 'visible' && host.isConnected) load(true); }, 20000);
  return () => { if (timer) clearInterval(timer); };
}
