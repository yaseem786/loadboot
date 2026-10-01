// thread-chat.js — one WhatsApp-style chat for the 3-way dispatcher thread
// (dispatcher · carrier · LoadBoot). bl_ui_0502
//
// Used by CC Dispatcher 360, CC Dispatchers, the carrier's Dispatcher desk and the
// dispatcher workspace, so every side reads and writes the thread the same way:
//   • bubbles — mine on the right, others on the left, sender colour by role
//   • line breaks kept, links / e-mails / phones clickable (no innerHTML anywhere)
//   • day separators, grouped consecutive messages, time + delivery tick
//   • auto-growing composer: Enter sends, Shift+Enter = new line (touch: button sends)
//   • optimistic send with Retry, draft kept per thread, 4000-char guard
//   • polls while visible, marks read, "new messages" jump when scrolled up
// Plain DOM only — no dependency on any portal's h()/el() helper.
import { dispatcherThreadList, dispatcherThreadSend, dispatcherThreadMarkRead } from './api.js';

const MAX = 4000;
const ROLE_COLOR = { dispatcher: '#0883F7', carrier: '#0E9F6E', staff: '#FC5305', system: '#64748b' };

function E(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => { if (c == null || c === false) return; n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
  return n;
}

let cssDone = false;
function injectCss() {
  if (cssDone || document.getElementById('tc-css')) { cssDone = true; return; }
  cssDone = true;
  const s = document.createElement('style'); s.id = 'tc-css';
  s.textContent = `
.tc{--tc-bg:#eef2f7;--tc-them:#fff;--tc-them-ink:#0f1f33;--tc-me:#0883F7;--tc-me-ink:#fff;--tc-line:#dfe6ef;--tc-mut:#64748b;--tc-in:#fff;--tc-in-ink:#0f1f33;--tc-sys:#e2e8f0;
  display:flex;flex-direction:column;border:1px solid var(--tc-line);border-radius:16px;overflow:hidden;background:var(--tc-bg);font-family:inherit;position:relative}
.tc[data-theme=dark]{--tc-bg:#0b1728;--tc-them:#14263f;--tc-them-ink:#eaf1fb;--tc-me:#0883F7;--tc-me-ink:#fff;--tc-line:rgba(255,255,255,.1);--tc-mut:#8ea3c2;--tc-in:#0f1f35;--tc-in-ink:#eaf1fb;--tc-sys:rgba(255,255,255,.07)}
.tc-head{padding:8px 14px;font-size:11.5px;color:var(--tc-mut);border-bottom:1px solid var(--tc-line);background:var(--tc-in);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tc-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:3px}
.tc-list{overflow-y:auto;padding:14px 12px 10px;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain;scroll-behavior:auto}
.tc-day{align-self:center;margin:10px 0 8px;font-size:11px;font-weight:700;color:var(--tc-mut);background:var(--tc-sys);padding:3px 10px;border-radius:999px}
.tc-row{display:flex;flex-direction:column;max-width:78%;align-self:flex-start;margin-top:8px}
.tc-row.cont{margin-top:2px}
.tc-row.me{align-self:flex-end;align-items:flex-end}
.tc-name{font-size:11.5px;font-weight:800;margin:0 10px 2px}
.tc-b{background:var(--tc-them);color:var(--tc-them-ink);padding:7px 11px 5px;border-radius:14px;border-top-left-radius:4px;box-shadow:0 1px 1px rgba(15,31,51,.08);font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.tc-row.cont .tc-b{border-top-left-radius:14px}
.tc-row.me .tc-b{background:var(--tc-me);color:var(--tc-me-ink);border-top-left-radius:14px;border-top-right-radius:4px}
.tc-row.me.cont .tc-b{border-top-right-radius:14px}
.tc-b a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.tc-meta{display:block;text-align:right;font-size:10.5px;opacity:.72;margin-top:2px;white-space:nowrap}
.tc-row.failed .tc-b{background:#fee2e2;color:#7f1d1d}
.tc-fail{font-size:11.5px;color:#dc2626;margin:3px 6px 0;display:flex;gap:10px}
.tc-fail button{border:0;background:none;color:inherit;font:inherit;font-weight:800;cursor:pointer;padding:0;text-decoration:underline}
.tc-sys{align-self:center;max-width:88%;text-align:center;font-size:12px;color:var(--tc-mut);background:var(--tc-sys);padding:5px 12px;border-radius:10px;margin:8px 0;white-space:pre-wrap}
.tc-empty{margin:auto;text-align:center;color:var(--tc-mut);font-size:13px;padding:24px 10px;max-width:420px}
.tc-chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.tc-chip{border:1px solid var(--tc-line);background:var(--tc-in);color:var(--tc-in-ink);border-radius:999px;padding:5px 11px;font:inherit;font-size:12px;cursor:pointer}
.tc-jump{position:absolute;right:16px;bottom:78px;border:0;background:var(--tc-me);color:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:12px;font-weight:800;box-shadow:0 4px 14px rgba(8,131,247,.35);cursor:pointer;display:none}
.tc-comp{display:flex;align-items:flex-end;gap:8px;padding:10px;border-top:1px solid var(--tc-line);background:var(--tc-in)}
.tc-ta{flex:1;resize:none;border:1px solid var(--tc-line);border-radius:20px;padding:9px 14px;font:inherit;font-size:14px;line-height:1.4;max-height:150px;min-height:40px;background:var(--tc-bg);color:var(--tc-in-ink);outline:none;box-sizing:border-box;overflow-y:hidden}
.tc-ta:focus{border-color:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.15)}
.tc-ta:disabled{opacity:.6;cursor:not-allowed}
.tc-send{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:#0883F7;color:#fff;display:grid;place-items:center;cursor:pointer;transition:transform .12s,opacity .12s}
.tc-send:disabled{opacity:.35;cursor:default}
.tc-send:not(:disabled):active{transform:scale(.92)}
.tc-foot{display:flex;justify-content:space-between;gap:8px;padding:0 14px 8px;font-size:11px;color:var(--tc-mut);background:var(--tc-in)}
.tc-foot .over{color:#dc2626;font-weight:800}
.tc-ro{padding:10px 14px;font-size:12.5px;color:var(--tc-mut);background:var(--tc-in);border-top:1px solid var(--tc-line);text-align:center}
@media (max-width:640px){.tc-row{max-width:88%}.tc-hint{display:none}}
`;
  document.head.appendChild(s);
}

const URLRE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/gi;
function richText(text) {
  const out = []; const s = String(text == null ? '' : text); let last = 0; let m;
  URLRE.lastIndex = 0;
  while ((m = URLRE.exec(s))) {
    let tok = m[0]; let trail = '';
    while (/[).,;:!?]$/.test(tok)) { trail = tok.slice(-1) + trail; tok = tok.slice(0, -1); }
    if (m.index > last) out.push(document.createTextNode(s.slice(last, m.index)));
    let href;
    if (/@/.test(tok) && !/^https?:/i.test(tok)) href = 'mailto:' + tok;
    else if (/^[+\d(]/.test(tok.trim()) && !/^https?:/i.test(tok)) href = 'tel:' + tok.replace(/[^\d+]/g, '');
    else href = /^https?:/i.test(tok) ? tok : 'https://' + tok;
    out.push(E('a', { href, target: /^https?:/i.test(href) ? '_blank' : null, rel: 'noopener noreferrer' }, tok));
    if (trail) out.push(document.createTextNode(trail));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(document.createTextNode(s.slice(last)));
  return out;
}

function fmt(d, tz, opts) { try { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)).format(d); } catch (_) { return d.toLocaleString(); } }
function dayKey(d, tz) { return fmt(d, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }); }
function dayLabel(d, tz) {
  const k = dayKey(d, tz); const now = new Date();
  if (k === dayKey(now, tz)) return 'Today';
  if (k === dayKey(new Date(now.getTime() - 864e5), tz)) return 'Yesterday';
  return fmt(d, tz, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
const SEND_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';
const touch = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } };

/**
 * threadChat({ assignmentId, theme, height, placeholder, chips, emptyText, poll, tz, tzLabel, onSent, onLoaded })
 * → { el, refresh, focus, destroy }
 */
export function threadChat(opts) {
  injectCss();
  const o = Object.assign({ theme: 'light', height: '440px', poll: 20000, tz: 'America/New_York', tzLabel: 'ET', placeholder: 'Type a message', chips: null, emptyText: 'No messages yet. Everyone in this thread — dispatcher, carrier and LoadBoot — sees what you write.', showHead: true }, opts || {});
  const id = o.assignmentId;
  const dkey = 'tc-draft:' + id;
  let msgs = []; let pending = []; let lastId = null; let viewerRole = null; let status = 'active'; let timer = null; let dead = false; let loading = false;

  const head = E('div', { class: 'tc-head' });
  const list = E('div', { class: 'tc-list', role: 'log', 'aria-live': 'polite', style: 'height:' + o.height + ';max-height:' + o.height }, E('div', { class: 'tc-empty' }, 'Loading messages…'));
  const jump = E('button', { class: 'tc-jump', type: 'button', onClick: () => { toBottom(); jump.style.display = 'none'; } }, '↓ New messages');
  const ta = E('textarea', { class: 'tc-ta', rows: '1', maxlength: String(MAX + 500), placeholder: o.placeholder, 'aria-label': 'Message' });
  const sendBtn = E('button', { class: 'tc-send', type: 'button', 'aria-label': 'Send message', title: 'Send', disabled: true });
  sendBtn.innerHTML = SEND_SVG;
  const count = E('span');
  const hint = E('span', { class: 'tc-hint' }, touch() ? '' : 'Enter to send · Shift+Enter for a new line');
  const comp = E('div', { class: 'tc-comp' }, [ta, sendBtn]);
  const foot = E('div', { class: 'tc-foot' }, [hint, count]);
  const ro = E('div', { class: 'tc-ro', style: 'display:none' });
  const root = E('div', { class: 'tc', 'data-theme': o.theme }, [o.showHead ? head : null, list, jump, comp, foot, ro]);

  try { const d = sessionStorage.getItem(dkey); if (d) ta.value = d; } catch (_) {}

  function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 80; }
  function toBottom() { list.scrollTop = list.scrollHeight; }
  function grow() { ta.style.height = 'auto'; const h = Math.min(ta.scrollHeight, 150); ta.style.height = h + 'px'; ta.style.overflowY = ta.scrollHeight > 150 ? 'auto' : 'hidden'; }
  function sync() {
    const n = ta.value.length; const empty = !ta.value.trim();
    sendBtn.disabled = empty || n > MAX || readOnly();
    count.textContent = n > MAX - 500 ? (n > MAX ? (n - MAX) + ' over the 4000 limit' : (MAX - n) + ' left') : '';
    count.className = n > MAX ? 'over' : '';
    try { if (ta.value) sessionStorage.setItem(dkey, ta.value); else sessionStorage.removeItem(dkey); } catch (_) {}
  }
  function readOnly() { return status !== 'active' && viewerRole !== 'staff' && viewerRole !== null; }

  function isMine(m) { return !!m.mine || (viewerRole === 'staff' && m.role === 'staff'); }
  function sender(m) { return m.role === 'staff' ? 'LoadBoot' : (m.by || (m.role === 'carrier' ? 'Carrier' : m.role === 'dispatcher' ? 'Dispatcher' : 'LoadBoot')); }

  function paint() {
    const stick = nearBottom() || !list.dataset.painted;
    const all = msgs.concat(pending);
    const kids = [];
    if (!all.length) {
      kids.push(E('div', { class: 'tc-empty' }, [o.emptyText, o.chips && o.chips.length && !readOnly() ? E('div', { class: 'tc-chips' }, o.chips.map((t) => E('button', { class: 'tc-chip', type: 'button', onClick: () => { ta.value = t; grow(); sync(); ta.focus(); } }, t))) : null]));
    }
    let prevDay = null; let prev = null;
    all.forEach((m) => {
      const d = new Date(m.at || Date.now());
      const dk = dayKey(d, o.tz);
      if (dk !== prevDay) { kids.push(E('div', { class: 'tc-day' }, dayLabel(d, o.tz))); prevDay = dk; prev = null; }
      if (m.role === 'system') { kids.push(E('div', { class: 'tc-sys' }, richText(m.body).concat([E('span', { class: 'tc-meta', style: 'text-align:center' }, fmt(d, o.tz, { hour: 'numeric', minute: '2-digit' }))]))); prev = null; return; }
      const mine = isMine(m);
      const cont = prev && prev.role === m.role && sender(prev) === sender(m) && isMine(prev) === mine && (d - new Date(prev.at || Date.now())) < 5 * 60e3;
      const tick = m._state === 'sending' ? ' 🕓' : m._state === 'failed' ? ' ⚠' : mine ? ' ✓' : '';
      const meta = E('span', { class: 'tc-meta' }, fmt(d, o.tz, { hour: 'numeric', minute: '2-digit' }) + (cont ? '' : ' ' + o.tzLabel) + tick);
      const row = E('div', { class: 'tc-row' + (mine ? ' me' : '') + (cont ? ' cont' : '') + (m._state === 'failed' ? ' failed' : '') }, [
        !mine && !cont ? E('div', { class: 'tc-name', style: 'color:' + (ROLE_COLOR[m.role] || ROLE_COLOR.system) }, sender(m) + (m.role === 'dispatcher' ? ' · dispatcher' : m.role === 'carrier' ? ' · carrier' : '')) : null,
        E('div', { class: 'tc-b' }, richText(m.body).concat([meta])),
        m._state === 'failed' ? E('div', { class: 'tc-fail' }, [m._err || 'Not sent.', E('button', { type: 'button', onClick: () => retry(m) }, 'Retry'), E('button', { type: 'button', onClick: () => { pending = pending.filter((x) => x !== m); paint(); } }, 'Delete')]) : null,
      ]);
      kids.push(row); prev = m;
    });
    list.replaceChildren(...kids);
    list.dataset.painted = '1';
    if (stick) { toBottom(); jump.style.display = 'none'; }
  }

  function paintHead(P) {
    if (!o.showHead) return;
    const bits = [['dispatcher', P.dispatcher || 'Dispatcher'], ['carrier', P.carrier || 'Carrier'], ['staff', 'LoadBoot']];
    head.replaceChildren(E('span', { style: 'font-weight:700' }, 'In this thread:'), ...bits.map(([r, n]) => E('span', null, [E('span', { class: 'tc-dot', style: 'background:' + ROLE_COLOR[r] }), n])), E('span', { style: 'margin-left:auto' }, 'Everyone sees every message'));
  }

  function applyStatus() {
    const r = readOnly();
    ta.disabled = r; comp.style.display = r ? 'none' : ''; foot.style.display = r ? 'none' : '';
    ro.style.display = r ? '' : 'none';
    ro.textContent = r ? 'This assignment is ' + status + ' — the thread is read-only.' : '';
    sync();
  }

  async function load(first) {
    if (dead || loading) return; loading = true;
    try {
      const r = await dispatcherThreadList(id, 200);
      if (r && r.error) throw new Error(r.error);
      viewerRole = (r && r.role) || viewerRole; status = (r && r.status) || 'active';
      const ms = (r && r.messages) || [];
      const newest = ms.length ? ms[ms.length - 1].id : null;
      paintHead((r && r.participants) || {}); applyStatus();
      if (first || newest !== lastId) {
        const wasBottom = nearBottom();
        const grew = !first && lastId && newest !== lastId;
        msgs = ms; lastId = newest; paint();
        if (grew && !wasBottom) jump.style.display = 'block';
        dispatcherThreadMarkRead(id).catch(() => {});
        if (o.onLoaded) try { o.onLoaded(r); } catch (_) {}
      }
    } catch (e) {
      if (first) list.replaceChildren(E('div', { class: 'tc-empty' }, (e && e.message) || 'Could not load messages.'));
    } finally { loading = false; }
  }

  async function deliver(m) {
    try {
      const r = await dispatcherThreadSend(id, m.body);
      if (r && r.error) throw new Error(r.error);
      pending = pending.filter((x) => x !== m);
      lastId = null; await load(false);
      if (o.onSent) try { o.onSent(r); } catch (_) {}
    } catch (e) { m._state = 'failed'; m._err = (e && e.message) || 'Not sent.'; paint(); }
  }
  function retry(m) { m._state = 'sending'; m._err = null; paint(); deliver(m); }
  function send() {
    const body = ta.value.replace(/\s+$/, '');
    if (!body.trim() || body.length > MAX || readOnly()) return;
    const m = { id: 'tmp-' + Date.now(), role: viewerRole || 'staff', body, at: new Date().toISOString(), mine: true, _state: 'sending' };
    pending.push(m); ta.value = ''; grow(); sync(); paint(); toBottom(); ta.focus();
    deliver(m);
  }

  ta.addEventListener('input', () => { grow(); sync(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch()) { e.preventDefault(); send(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', send);
  list.addEventListener('scroll', () => { if (nearBottom()) jump.style.display = 'none'; });

  load(true); requestAnimationFrame(() => { grow(); sync(); });
  if (o.poll) timer = setInterval(() => {
    if (!document.body.contains(root)) { if (list.dataset.painted) destroy(); return; }
    if (document.visibilityState === 'visible') load(false);
  }, o.poll);
  function destroy() { dead = true; if (timer) clearInterval(timer); timer = null; }
  return { el: root, refresh: () => load(false), focus: () => ta.focus(), destroy };
}
