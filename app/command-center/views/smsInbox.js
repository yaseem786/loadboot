// smsInbox.js — CC text-message INBOX (bl_sms_0609). Two panes, one component:
//   · left  — every conversation: who, last message, unread, owner (owner-less ones first — they are Command Center's)
//   · right — the whole conversation, who sent each text and from which line, reply box, hand-over to a dispatcher
// Rules live in Postgres, not here: cc_sms_threads / cc_sms_assign are staff-only, dialer_sms_thread decides who may read,
// dialer_sms_prepare decides who may send, from which number (a main-line conversation is answered from the main line),
// and refuses without consent / after STOP. This file only shows what the server said. Popups: openDrawer() only.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { openDrawer } from '../../shared/ui/components.js';
import { ccSmsThreads, ccSmsAssign, dialerSmsThread, dialerSmsSend, dialerSmsConsentState, dialerSmsConsentRecord } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const ET = 'America/New_York';
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const pretty = (n) => { const d = digits(n); const k = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return k.length === 10 ? '(' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6) : String(n || '—'); };
const fmt = (v, o) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-US', Object.assign({ timeZone: ET }, o)); };
const dayKey = (v) => fmt(v, { year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = (v) => fmt(v, { hour: 'numeric', minute: '2-digit' });
function dayLabel(v) {
  const k = dayKey(v), now = Date.now();
  if (k === dayKey(now)) return 'Today';
  if (k === dayKey(now - 864e5)) return 'Yesterday';
  return fmt(v, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
const listTime = (v) => { if (!v) return ''; const k = dayKey(v); return k === dayKey(Date.now()) ? clock(v) : k === dayKey(Date.now() - 864e5) ? 'Yesterday' : fmt(v, { month: 'short', day: 'numeric' }); };
const initials = (t) => { const n = String(t.contact_name || '').trim(); if (!n) return '#'; const p = n.split(/\s+/); return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };
const snip = (s, n) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const KIND = { carrier: 'Carrier', driver: 'Driver', broker: 'Broker', shipper: 'Shipper', lead: 'Lead' };
const STATUS = { queued: 'Sending…', sent: 'Sent', delivered: 'Delivered', failed: 'Not sent', received: '' };

// what really leaves: the server brands the text; this mirrors app_private.sms_compose for the preview only
const GSM = /^[ -~\n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/;
function finalText(draft, c) {
  c = c || { prefix: 'LoadBoot: ', suffix: ' Reply STOP to opt out.', first: false };
  const d = (draft || '').trim();
  const pre = /^\s*loadboot\b/i.test(d) ? '' : (c.prefix || 'LoadBoot: ');
  const sfx = c.suffix || '';
  const has = c.first ? (sfx && d.includes(sfx.trim())) : /reply\s+stop/i.test(d);
  return { pre, body: d, suf: has ? '' : sfx, first: !!c.first };
}
function segments(text) {
  const gsm = GSM.test(text);
  const len = gsm ? text.replace(/[\^{}\\\[\]~|€]/g, 'xx').length : text.length;
  const one = gsm ? 160 : 70, many = gsm ? 153 : 67;
  return { n: len <= one ? 1 : Math.ceil(len / many), len };
}

const CSS = `
.sx{--b:#0883F7;--o:#FC5305;--g:#16a34a;--r:#dc2626;--ln:var(--line,#e5e9f2);--mu:var(--mut,#64748b);
  display:grid;grid-template-columns:minmax(280px,34%) 1fr;height:660px;min-height:480px;background:var(--card,#fff);border:1px solid var(--ln);border-radius:16px;overflow:hidden;margin-top:14px}
.sx *{box-sizing:border-box}.sx>*{min-width:0;min-height:0}
.sx-l{display:flex;flex-direction:column;border-right:1px solid var(--ln)}
.sx-lh{padding:14px 14px 10px;border-bottom:1px solid var(--ln)}
.sx-lh h3{margin:0 0 10px;font-size:16px;display:flex;align-items:center;gap:8px}
.sx-lh h3 .sx-new{margin-left:auto}
.sx-q{width:100%;border:1px solid var(--ln);background:transparent;color:inherit;border-radius:10px;padding:8px 11px;font:inherit}
.sx-chips{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}
.sx-chip{border:1px solid var(--ln);background:transparent;color:inherit;border-radius:999px;padding:4px 11px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.sx-chip.on{background:var(--b);border-color:var(--b);color:#fff}
.sx-chip i{font-style:normal;font-size:11px;font-weight:700;background:rgba(100,116,139,.18);border-radius:999px;padding:0 6px}
.sx-chip.on i{background:rgba(255,255,255,.25)}
.sx-list{flex:1;overflow:auto}
.sx-row{display:grid;grid-template-columns:40px 1fr auto;gap:10px;padding:11px 14px;border:0;border-bottom:1px solid var(--ln);background:transparent;color:inherit;font:inherit;text-align:left;width:100%;cursor:pointer;align-items:center}
.sx-row:hover{background:rgba(8,131,247,.05)}.sx-row.on{background:rgba(8,131,247,.1)}
.sx-av{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13.5px;background:rgba(8,131,247,.13);color:#0369a1}
.sx-av.un{background:rgba(252,83,5,.14);color:#c2410c}
.sx-nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sx-row.new .sx-nm{font-weight:800}
.sx-sub{font-size:12.5px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.sx-row.new .sx-sub{color:inherit}
.sx-tags{display:flex;gap:5px;margin-top:4px;flex-wrap:wrap}
.sx-rt{display:flex;flex-direction:column;align-items:flex-end;gap:5px;font-size:11.5px;color:var(--mu);white-space:nowrap}
.sx-bdg{min-width:20px;height:20px;border-radius:10px;background:var(--o);color:#fff;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;padding:0 6px}
.sx-pill{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 8px;border-radius:999px;white-space:nowrap}
.sx-pill.g{background:rgba(34,197,94,.14);color:#15803d}.sx-pill.r{background:rgba(239,68,68,.13);color:#b91c1c}.sx-pill.a{background:rgba(245,158,11,.16);color:#b45309}.sx-pill.b{background:rgba(8,131,247,.13);color:#0369a1}.sx-pill.m{background:rgba(100,116,139,.15);color:#475569}
.sx-none{padding:26px 16px;color:var(--mu);font-size:13.5px;text-align:center}
.sx-r{display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(8,131,247,.03),transparent 160px)}
.sx-rh{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--ln);flex-wrap:wrap}
.sx-rh .who{flex:1;min-width:160px}.sx-rh .who b{font-size:15.5px}.sx-rh .who div{font-size:12.5px;color:var(--mu);margin-top:1px}
.sx-back{display:none;border:0;background:transparent;color:inherit;font:inherit;font-size:20px;cursor:pointer;padding:2px 8px 2px 0}
.sx-sel{border:1px solid var(--ln);background:var(--card,#fff);color:inherit;border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;max-width:220px}
.sx-as{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--mu);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.sx-msgs{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:4px}
.sx-day{align-self:center;font-size:11.5px;font-weight:700;color:var(--mu);background:rgba(100,116,139,.12);border-radius:999px;padding:2px 11px;margin:8px 0 6px}
.sx-m{max-width:min(76%,560px);display:flex;flex-direction:column;align-self:flex-start;position:relative}
.sx-m.out{align-self:flex-end;align-items:flex-end}
.sx-bub{border-radius:14px 14px 14px 4px;padding:8px 12px;background:rgba(100,116,139,.13);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45;font-size:14px}
.sx-m.out .sx-bub{border-radius:14px 14px 4px 14px;background:var(--b);color:#fff}
.sx-m.fail .sx-bub{background:rgba(239,68,68,.12);color:inherit;border:1px solid rgba(239,68,68,.4)}
.sx-qt{font-size:12.5px;opacity:.85;border-left:3px solid currentColor;padding:1px 0 1px 8px;margin-bottom:5px;white-space:normal}
.sx-meta{font-size:11px;color:var(--mu);margin:2px 4px 4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.sx-meta .err{color:var(--r)}
.sx-rep{border:0;background:transparent;color:var(--b);font:inherit;font-size:11px;font-weight:700;cursor:pointer;padding:0}
.sx-foot{border-top:1px solid var(--ln);padding:10px 16px 12px}
.sx-rbar{display:flex;gap:8px;align-items:center;font-size:12.5px;border-left:3px solid var(--b);background:rgba(8,131,247,.07);border-radius:6px;padding:5px 8px;margin-bottom:8px}
.sx-rbar span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sx-rbar button{border:0;background:transparent;color:inherit;font-size:16px;cursor:pointer}
.sx-comp{display:flex;gap:8px;align-items:flex-end}
.sx-ta{flex:1;border:1px solid var(--ln);background:var(--card,#fff);color:inherit;border-radius:12px;padding:9px 12px;font:inherit;resize:none;min-height:42px;max-height:150px;line-height:1.4}
.sx-send{border:0;background:var(--o);color:#fff;border-radius:12px;height:42px;padding:0 16px;font:inherit;font-weight:700;cursor:pointer;display:inline-flex;gap:7px;align-items:center}
.sx-send[disabled]{opacity:.45;cursor:not-allowed}
.sx-pv{font-size:12px;color:var(--mu);margin-top:7px;line-height:1.45;overflow-wrap:anywhere}.sx-pv i{opacity:.75}.sx-pv b{font-weight:600;color:inherit}
.sx-gate{border-radius:12px;padding:11px 13px;font-size:13.5px;line-height:1.5;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35)}
.sx-gate.r{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.35)}
.sx-gate b{display:block;margin-bottom:2px}
.sx-btn{border:1px solid var(--ln);background:var(--card,#fff);color:inherit;border-radius:10px;padding:7px 12px;font:inherit;font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.sx-btn.p{background:var(--b);border-color:var(--b);color:#fff}.sx-btn[disabled]{opacity:.5;cursor:not-allowed}
.sx-form{display:grid;gap:12px}.sx-form label{display:grid;gap:5px;font-size:12.5px;font-weight:600}.sx-form small{font-weight:400;color:var(--mu)}
.sx-form input,.sx-form select{border:1px solid var(--ln);background:var(--card,#fff);color:inherit;border-radius:10px;padding:9px 11px;font:inherit}
.sx-script{font-style:italic;padding:9px 11px;border-left:3px solid var(--b);background:rgba(8,131,247,.07);border-radius:6px;font-size:13px;line-height:1.5}
@media (max-width:760px){
  .sx{grid-template-columns:1fr;height:auto;min-height:0;border-radius:14px}
  .sx-l{border-right:0}.sx-list{max-height:62vh}
  .sx-r{display:none;height:78vh}
  .sx.open .sx-l{display:none}.sx.open .sx-r{display:flex}
  .sx-back{display:inline-block}.sx-m{max-width:88%}.sx-sel{max-width:100%}
}
`;

/**
 * smsInbox({ getDispatchers }) → { el, refresh({ dispatcher }), destroy }
 * getDispatchers() returns the dispatcher list of cc_dialer_overview (user_id + a name) for the hand-over menu.
 */
export function smsInbox(opts) {
  const o = opts || {};
  if (!document.getElementById('sx-css')) { const s = document.createElement('style'); s.id = 'sx-css'; s.textContent = CSS; document.head.appendChild(s); }

  let threads = [], unassigned = 0, q = '', filter = 'all', dispatcher = '';
  let sel = null;          // the open conversation's number (E.164) — one conversation per number
  let cur = null;          // dialer_sms_thread payload for `sel`
  let curErr = null, replyTo = null, sending = false, gateSig = '', qT = null, dead = false;
  const drafts = new Map();

  const qIn = el('input', { class: 'sx-q', type: 'search', placeholder: 'Search name, number or text', 'aria-label': 'Search conversations', onInput: (e) => { q = e.target.value; clearTimeout(qT); qT = setTimeout(() => loadThreads(), 300); } });
  const chipsEl = el('div', { class: 'sx-chips', role: 'tablist' });
  const countEl = el('span');
  const listEl = el('div', { class: 'sx-list' });
  const headEl = el('div', { class: 'sx-rh' });
  const msgsEl = el('div', { class: 'sx-msgs', role: 'log', 'aria-live': 'polite' });
  const footEl = el('div', { class: 'sx-foot' });
  const right = el('div', { class: 'sx-r' });
  const root = el('div', { class: 'sx' }, [
    el('div', { class: 'sx-l' }, [
      el('div', { class: 'sx-lh' }, [
        el('h3', null, [icon('chat', 18), 'Text inbox', countEl, el('button', { class: 'sx-btn sx-new', type: 'button', onClick: newText }, 'New text')]),
        qIn, chipsEl,
      ]),
      listEl,
    ]),
    right,
  ]);

  const dname = (d) => d.full_name || d.name || d.contact_name || d.email || d.user_id;
  const title = (t) => t.contact_name || pretty(t.number);
  const selThread = () => threads.find((t) => t.number === sel) || (cur && cur.thread) || null;

  // ------------------------------------------------------------------ left: the list
  function shown() {
    return threads.filter((t) => filter === 'unassigned' ? !t.owner_user_id : filter === 'unread' ? t.unread > 0 : filter === 'stop' ? t.opted_out : true);
  }
  function paintList() {
    const n = { all: threads.length, unassigned: threads.filter((t) => !t.owner_user_id).length, unread: threads.filter((t) => t.unread > 0).length, stop: threads.filter((t) => t.opted_out).length };
    mount(countEl, unassigned ? el('span', { class: 'sx-pill r', title: 'Open conversations nobody owns — only Command Center sees them' }, unassigned + ' unassigned') : null);
    mount(chipsEl, [['all', 'All'], ['unassigned', 'Unassigned'], ['unread', 'Unread'], ['stop', 'Opted out']].map(([id, label]) =>
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(filter === id), class: 'sx-chip' + (filter === id ? ' on' : ''), onClick: () => { filter = id; paintList(); } }, [label, el('i', null, String(n[id]))])));
    const rows = shown();
    mount(listEl, rows.length ? rows.map((t) => {
      const un = !t.owner_user_id;
      return el('button', { type: 'button', class: 'sx-row' + (t.number === sel ? ' on' : '') + (t.unread ? ' new' : ''), onClick: () => open(t.number) }, [
        el('div', { class: 'sx-av' + (un ? ' un' : '') }, initials(t)),
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'sx-nm' }, title(t)),
          el('div', { class: 'sx-sub' }, (t.last_direction === 'outbound' && !/^\s*loadboot\b/i.test(t.last_body || '') ? 'LoadBoot: ' : '') + (snip(t.last_body, 90) || '—')),
          el('div', { class: 'sx-tags' }, [
            un ? el('span', { class: 'sx-pill r' }, 'Unassigned') : el('span', { class: 'sx-pill g' }, t.owner || 'Assigned'),
            t.contact_kind ? el('span', { class: 'sx-pill m' }, KIND[t.contact_kind] || t.contact_kind) : null,
            t.opted_out ? el('span', { class: 'sx-pill r' }, 'STOP') : null,
          ]),
        ]),
        el('div', { class: 'sx-rt' }, [listTime(t.last_at), t.unread ? el('span', { class: 'sx-bdg', 'aria-label': t.unread + ' unread' }, String(t.unread)) : null]),
      ]);
    }) : el('div', { class: 'sx-none' }, q ? 'No conversation matches that search.' : filter !== 'all' ? 'Nothing in this filter.' : 'No text conversations yet.'));
  }
  async function loadThreads() {
    try {
      const r = await ccSmsThreads({ dispatcher, q, limit: 200 });
      if (r && r.error) throw new Error(r.error);
      threads = (r && r.threads) || []; unassigned = (r && r.unassigned) || 0;
    } catch (e) { threads = []; unassigned = 0; }
    if (dead) return;
    paintList();
    if (sel && cur) paintHead();
  }

  // ------------------------------------------------------------------ right: one conversation
  function paintEmpty() {
    mount(headEl, null); mount(footEl, null);
    mount(msgsEl, el('div', { class: 'sx-none', style: 'margin:auto' }, [el('div', { style: 'opacity:.5;margin-bottom:8px' }, icon('chat', 34)), 'Pick a conversation on the left to read and answer it.']));
    mount(right, [msgsEl]);
  }
  function paintHead() {
    const t = selThread(); const ds = (o.getDispatchers && o.getDispatchers()) || [];
    const m = (cur && cur.match) || {};
    const name = (t && t.contact_name) || m.contact_name || '';
    const bits = [name ? pretty(sel) : '', t && t.contact_kind ? (KIND[t.contact_kind] || t.contact_kind) : '', t && t.carrier ? t.carrier : ''].filter(Boolean).join(' · ');
    const mainLine = t && !t.owner_user_id && !t.line;
    mount(headEl, [
      el('button', { class: 'sx-back', type: 'button', 'aria-label': 'Back to conversations', onClick: () => { root.classList.remove('open'); } }, '←'),
      el('div', { class: 'who' }, [
        el('b', null, name || pretty(sel)),
        el('div', null, [bits, bits ? ' · ' : '', t ? (mainLine ? 'Main line' : t.line ? 'Line ' + pretty(t.line) : 'No line yet') : 'New conversation']),
        el('div', { style: 'margin-top:5px;display:flex;gap:5px;flex-wrap:wrap' }, [
          cur && cur.opted_out ? el('span', { class: 'sx-pill r' }, 'Replied STOP') : t && t.consented ? el('span', { class: 'sx-pill g', title: t.consent_method || '' }, 'Consent on file') : el('span', { class: 'sx-pill a' }, 'No consent'),
          t && t.status && t.status !== 'open' ? el('span', { class: 'sx-pill m' }, 'Closed') : null,
          t && t.broker_blocked ? el('span', { class: 'sx-pill a' }, 'Broker texting off') : null,
        ]),
      ]),
      t ? el('label', { class: 'sx-as' }, ['Owner', el('select', { class: 'sx-sel', 'aria-label': 'Hand this conversation to', onChange: (e) => { const v = e.target.value; if (v !== (t.owner_user_id || '')) assign(t, v || null); } }, [
        el('option', { value: '', selected: !t.owner_user_id }, 'Command Center (unassigned)'),
        ...ds.map((d) => el('option', { value: d.user_id, selected: d.user_id === t.owner_user_id }, dname(d))),
        t.owner_user_id && !ds.some((d) => d.user_id === t.owner_user_id) ? el('option', { value: t.owner_user_id, selected: true }, t.owner || 'Assigned') : null,
      ])]) : null,
    ]);
  }
  function bubble(m) {
    const out = m.direction === 'outbound';
    const media = Array.isArray(m.media) ? m.media : (m.media ? [m.media] : []);
    const via = out ? (m.line ? 'via ' + pretty(m.line) : 'via main line') : '';
    return el('div', { class: 'sx-m' + (out ? ' out' : '') + (m.status === 'failed' ? ' fail' : ''), 'data-id': m.id }, [
      el('div', { class: 'sx-bub' }, [
        m.quote ? el('div', { class: 'sx-qt' }, m.quote.missing ? 'Earlier message' : (m.quote.direction === 'outbound' && !/^\s*loadboot\b/i.test(m.quote.body || '') ? 'LoadBoot: ' : '') + (m.quote.body || '')) : null,
        m.body || (media.length ? null : '—'),
        media.map((x, i) => { const u = x && (x.url || (typeof x === 'string' ? x : '')); return el('div', null, u && /^https:\/\//.test(u) ? el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', style: 'color:inherit;text-decoration:underline' }, 'Picture ' + (i + 1)) : '[picture]'); }),
      ]),
      el('div', { class: 'sx-meta' }, [
        clock(m.at),
        out && m.sender ? el('span', null, '· ' + m.sender) : null,
        out ? el('span', null, '· ' + via) : null,
        out && STATUS[m.status] ? el('span', { class: m.status === 'failed' ? 'err' : '' }, '· ' + STATUS[m.status]) : null,
        m.error ? el('span', { class: 'err' }, '· ' + m.error) : null,
        el('button', { class: 'sx-rep', type: 'button', onClick: () => { replyTo = { id: m.id, body: m.body || '[picture]', out }; paintFoot(true); } }, 'Reply'),
      ]),
    ]);
  }
  function paintMsgs(stick) {
    const ms = (cur && cur.messages) || [];
    const near = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90;
    const kids = []; let last = '';
    ms.forEach((m) => { const k = dayKey(m.at); if (k !== last) { kids.push(el('div', { class: 'sx-day' }, dayLabel(m.at))); last = k; } kids.push(bubble(m)); });
    mount(msgsEl, kids.length ? kids : el('div', { class: 'sx-none', style: 'margin:auto' }, curErr || (cur ? 'No messages in this conversation yet.' : 'Loading…')));
    if (stick || near) msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  // the reply box — or, when the server would refuse, the reason in plain words instead of a box that fails
  function gate() {
    const t = cur && cur.thread;
    if (!cur) return null;
    if (cur.opted_out) return ['r', 'This number replied STOP.', 'It cannot be texted again until it sends START. Call them instead.'];
    if (t && t.status !== 'open') return ['', 'This conversation is closed.', 'It is kept for the record; no new text can be sent on it.'];
    if (t && t.broker_blocked) return ['', 'Broker texting is not switched on.', 'Texts to brokers stay off until the broker campaign is approved (Phone settings).'];
    if (!(t && t.consented)) return ['', 'No SMS consent on file for this number.', 'A text can only go out after they agreed to receive texts, or texted LoadBoot first.', 'consent'];
    return null;
  }
  function paintFoot(force) {
    const g = gate(); const t = cur && cur.thread;
    const sig = sel + '|' + (g ? g[1] : 'ok') + '|' + (replyTo ? replyTo.id : '') + '|' + (sending ? 1 : 0);
    if (!force && sig === gateSig) return;
    gateSig = sig;
    if (!cur) { mount(footEl, null); return; }
    if (g) {
      mount(footEl, el('div', { class: 'sx-gate ' + g[0] }, [el('b', null, g[1]), g[2],
        g[3] === 'consent' ? el('div', { style: 'margin-top:8px' }, el('button', { class: 'sx-btn p', type: 'button', onClick: consentDrawer }, 'Record their consent')) : null]));
      return;
    }
    const pv = el('div', { class: 'sx-pv' });
    const ta = el('textarea', { class: 'sx-ta', rows: '1', maxlength: '900', placeholder: 'Write a reply…', 'aria-label': 'Reply' });
    const btn = el('button', { class: 'sx-send', type: 'button', disabled: true, onClick: send }, [icon('send', 16), sending ? 'Sending…' : 'Send']);
    ta.value = drafts.get(sel) || '';
    const sync = () => {
      drafts.set(sel, ta.value);
      ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
      const f = finalText(ta.value, cur.compose); const full = f.pre + f.body + f.suf; const sg = segments(full);
      btn.disabled = !f.body || sending || full.length > 1000;
      mount(pv, f.body ? [el('b', null, 'Goes out as: '), el('i', null, f.pre), f.body, el('i', null, f.suf), ' — ' + sg.n + (sg.n === 1 ? ' segment' : ' segments') + (full.length > 1000 ? ' · too long (1000 max)' : '') + (f.first ? ' · first text to this number carries the full disclosure' : '')]
        : [t && !t.owner_user_id && !t.line ? 'Your reply leaves from the main line — the number they texted. ' : 'Your reply leaves from a LoadBoot line. ', 'Enter sends · Shift+Enter makes a new line.']);
    };
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!btn.disabled) send(); } });
    mount(footEl, [
      replyTo ? el('div', { class: 'sx-rbar' }, [el('span', null, 'Replying to: ' + (replyTo.out ? 'LoadBoot: ' : '') + snip(replyTo.body, 120)), el('button', { type: 'button', 'aria-label': 'Cancel reply', onClick: () => { replyTo = null; paintFoot(true); } }, '×')]) : null,
      el('div', { class: 'sx-comp' }, [ta, btn]), pv,
    ]);
    sync();
    if (force && !sending) { try { ta.focus({ preventScroll: true }); } catch (_) {} }
  }
  async function loadThread(quiet) {
    const num = sel; if (!num) return;
    let t;
    try { t = await dialerSmsThread(num); } catch (e) { t = { error: humanizeError(e) }; }
    if (dead || sel !== num) return;
    if (!t || t.error) { if (!quiet) { cur = null; curErr = (t && t.error) || 'Could not open that conversation.'; paintMsgs(true); paintFoot(true); } return; }
    const sigOf = (x) => (x && x.messages ? x.messages.map((m) => m.id + m.status).join() : '');
    const changed = !cur || sigOf(t) !== sigOf(cur);
    const first = !cur;
    cur = t; curErr = null;
    // the server marks an owner-less conversation read when staff opens it — mirror that in the list without a round trip
    const row = threads.find((x) => x.number === num);
    if (row && t.thread) { Object.assign(row, t.thread); paintList(); }
    paintHead();
    if (changed) paintMsgs(first || !quiet);
    paintFoot(first);
  }
  function open(number) {
    if (sel === number && cur) { root.classList.add('open'); return; }
    sel = number; cur = null; curErr = null; replyTo = null; gateSig = '';
    mount(right, [headEl, msgsEl, footEl]);
    root.classList.add('open');
    paintList(); paintHead(); paintMsgs(true); paintFoot(true);
    loadThread(false);
  }
  async function send() {
    const body = (drafts.get(sel) || '').trim(); if (!body || sending || !sel) return;
    const num = sel; sending = true; paintFoot(true);
    try {
      const r = await dialerSmsSend(num, body, { thread_id: cur && cur.thread ? cur.thread.id : null, reply_to: replyTo ? replyTo.id : null });
      if (r && r.ok) { drafts.delete(num); replyTo = null; }
      else toast((r && r.error) || 'Could not send that text.', 'error');
    } catch (e) { toast(humanizeError(e), 'error'); }
    sending = false;
    if (sel === num) { gateSig = ''; await loadThread(false); paintFoot(true); }
    loadThreads();
  }
  async function assign(t, userId) {
    try {
      const r = await ccSmsAssign(t.id, userId || null);
      if (r && r.error) throw new Error(r.error);
      toast(userId ? 'Conversation handed to ' + ((r.thread && r.thread.owner) || 'them') : 'Conversation back in the Command Center queue');
    } catch (e) { toast(humanizeError(e), 'error'); }
    await loadThreads(); if (sel) loadThread(true);
  }

  // ------------------------------------------------------------------ popups (openDrawer only)
  async function consentDrawer() {
    const num = sel; if (!num) return;
    let st = null; try { st = await dialerSmsConsentState(num); } catch (_) {}
    const method = el('select', null, [el('option', { value: 'verbal' }, 'They said yes on a call'), el('option', { value: 'published_cta' }, 'Their own greeting / website says to text this number')]);
    const ev = el('input', { type: 'text', maxlength: '500', placeholder: 'Which call? e.g. call with Dan, 14 Nov 3:10pm ET' });
    const err = el('div', { style: 'color:#b91c1c;font-size:13px' });
    const save = el('button', { class: 'sx-btn p', type: 'button' }, 'Save consent');
    method.addEventListener('change', () => { ev.placeholder = method.value === 'verbal' ? 'Which call? e.g. call with Dan, 14 Nov 3:10pm ET' : 'Quote it exactly, e.g. "or text us at this number"'; });
    const d = openDrawer('Record SMS consent', el('div', { class: 'sx-form' }, [
      el('div', null, ['A number taken from a load board, a rate confirmation or an email signature is not permission. Record consent only if ', el('b', null, pretty(num)), ' really agreed.']),
      st && st.script ? el('div', null, [el('small', null, 'On a call, read this word for word and continue only if they say yes:'), el('div', { class: 'sx-script', style: 'margin-top:5px' }, st.script)]) : null,
      el('label', null, ['How did they agree?', method]),
      el('label', null, ['Evidence', ev, el('small', null, 'Kept with the consent record. "I think they said so" is not evidence.')]),
      err, save,
    ]), { size: 'sm', subtitle: 'If they simply text LoadBoot first, consent is recorded by itself.' });
    save.addEventListener('click', async () => {
      const e = ev.value.trim(); if (!e) { err.textContent = 'Write the evidence first.'; return; }
      save.disabled = true; err.textContent = '';
      try {
        const t = selThread();
        const r = await dialerSmsConsentRecord({ number: num, method: method.value, evidence: e, contact_name: (t && t.contact_name) || null });
        if (!r || !r.ok) throw new Error((r && r.error) || 'Could not record that.');
        d.close(); toast('Consent recorded'); gateSig = ''; if (sel === num) await loadThread(false); loadThreads();
      } catch (x) { err.textContent = humanizeError(x); save.disabled = false; }
    });
  }
  function newText() {
    const num = el('input', { type: 'tel', inputmode: 'tel', placeholder: '(555) 123-4567', 'aria-label': 'Mobile number' });
    const err = el('div', { style: 'color:#b91c1c;font-size:13px' });
    const go = el('button', { class: 'sx-btn p', type: 'button' }, 'Open conversation');
    const d = openDrawer('New text', el('div', { class: 'sx-form' }, [
      el('label', null, ['US or Canada mobile number', num, el('small', null, 'If this number already has a conversation, it opens. A new number still needs SMS consent before anything can be sent.')]),
      err, go,
    ]), { size: 'sm' });
    const run = () => {
      const dg = digits(num.value); const k = dg.length === 10 ? '1' + dg : dg;
      if (!/^1[2-9][0-9]{9}$/.test(k)) { err.textContent = 'Enter a 10-digit US or Canada number.'; return; }
      d.close(); open('+' + k);
    };
    go.addEventListener('click', run);
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    setTimeout(() => { try { num.focus(); } catch (_) {} }, 60);
  }

  // ------------------------------------------------------------------ life cycle
  const alive = () => !dead && document.body.contains(root);
  const tList = setInterval(() => { if (!alive()) { if (root.isConnected === false && tList) destroy(); return; } if (document.visibilityState === 'visible') loadThreads(); }, 15000);
  const tOpen = setInterval(() => { if (alive() && sel && cur && !sending && document.visibilityState === 'visible') loadThread(true); }, 8000);
  function destroy() { dead = true; clearInterval(tList); clearInterval(tOpen); clearTimeout(qT); }

  paintEmpty(); paintList();
  return {
    el: root,
    refresh: (p) => { if (p && 'dispatcher' in p) dispatcher = p.dispatcher || ''; return loadThreads(); },
    destroy,
  };
}
export default smsInbox;
