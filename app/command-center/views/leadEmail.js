// leadEmail.js — email a web lead straight from CC Web leads, and see every email with that address
// (in + out) across LoadBoot mailboxes. bl_dmail_0505
//
// Send = the existing `dmail` edge function (action 'send') from a shared mailbox (hello@, billing@,
// loads@, dispatch@ … whichever are connected in CC → Dispatcher email). Replies land through the normal
// IMAP sync and show up here on the next refresh (auto every 30 s while open).
import { el, mount } from '../../shared/ui/dom.js';
import { ccDmailContact, dmailAct } from '../../shared/api.js';
import { cleanHtml } from '../../shared/dmail.js';
import { humanizeError, toast } from '../../shared/errors.js';

const CSS = `
.le{margin-top:18px;border:1px solid #e6edf5;border-radius:16px;overflow:hidden;background:#fff}
.le-h{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #eef2f7;background:#f8fafc}
.le-h b{font-size:14px;color:#10223B}.le-h .sp{margin-left:auto}
.le-ib{border:1px solid #dfe6ef;background:#fff;border-radius:9px;padding:5px 10px;font:inherit;font-size:12px;font-weight:700;color:#334155;cursor:pointer}
.le-list{max-height:380px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#f6f8fb}
.le-empty{color:#64748b;font-size:13px;text-align:center;padding:18px 8px}
.le-m{max-width:88%;border-radius:14px;padding:9px 12px;background:#fff;border:1px solid #e6edf5;align-self:flex-start;box-shadow:0 1px 1px rgba(15,31,51,.05)}
.le-m.out{align-self:flex-end;background:#eaf3ff;border-color:#cfe3fd}
.le-meta{font-size:11.5px;color:#64748b;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px}
.le-badge{font-size:10.5px;font-weight:800;background:#10223B;color:#fff;border-radius:6px;padding:1px 6px}
.le-subj{font-weight:800;font-size:13px;color:#10223B;margin-bottom:3px}
.le-body{font-size:13.5px;line-height:1.5;color:#1f2937;white-space:pre-wrap;word-break:break-word}
.le-q{border:0;background:none;color:#0883F7;font:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:4px 0 0}
.le-c{padding:12px 14px;display:flex;flex-direction:column;gap:8px;border-top:1px solid #eef2f7}
.le-row{display:flex;gap:8px;align-items:center}.le-row label{font-size:12px;font-weight:700;color:#64748b;width:52px;flex:none}
.le-in{flex:1;border:1px solid #dfe6ef;border-radius:10px;padding:8px 10px;font:inherit;font-size:13.5px;background:#fff;color:#10223B;min-width:0}
.le-in:focus,.le-ed:focus{outline:none;border-color:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.14)}
.le-tb{display:flex;gap:4px}.le-tb button{border:1px solid #dfe6ef;background:#fff;border-radius:8px;width:30px;height:28px;font:inherit;font-weight:800;cursor:pointer;color:#334155}
.le-ed{min-height:120px;max-height:320px;overflow:auto;border:1px solid #dfe6ef;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.5;color:#1f2937;background:#fff}
.le-ed:empty:before{content:attr(data-ph);color:#94a3b8}
.le-chips{display:flex;gap:6px;flex-wrap:wrap}.le-chip{border:1px dashed #cbd5e1;background:#fff;border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;color:#334155}
.le-foot{display:flex;align-items:center;gap:10px}.le-foot .hint{font-size:11.5px;color:#94a3b8;margin-right:auto}
.le-send{border:0;background:#0883F7;color:#fff;border-radius:11px;padding:9px 18px;font:inherit;font-weight:800;cursor:pointer}
.le-send:disabled{opacity:.5;cursor:default}
.le-warn{font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 10px}
`;
let cssDone = false;
function css() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (v) => { try { return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } };
const htmlToText = (h) => { const d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n'); return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };
// Split off the quoted history ("On … wrote:" / "-----Original Message-----" / "> " lines) so each card shows the new part.
function splitQuote(t) {
  const s = String(t || '').trim();
  const m = s.search(/\n(On .{5,200}wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+\nSent: |>.*)/i);
  return m > 20 ? [s.slice(0, m).trim(), s.slice(m).trim()] : [s, ''];
}
const PREFER = ['hello@', 'loads@', 'dispatch@', 'billing@'];

/** leadEmailPanel({ email, name, subject }) → element. Staff only (server enforces). */
export function leadEmailPanel(o) {
  css();
  const lead = Object.assign({ email: '', name: '', subject: '' }, o || {});
  let data = null; let timer = null; let sending = false;
  const list = el('div', { class: 'le-list' }, el('div', { class: 'le-empty' }, 'Loading email history…'));
  const count = el('span', { style: 'font-size:12px;color:#64748b' });
  const from = el('select', { class: 'le-in', 'aria-label': 'Send from' });
  const to = el('input', { class: 'le-in', value: lead.email || '', 'aria-label': 'To' });
  const subj = el('input', { class: 'le-in', 'aria-label': 'Subject', placeholder: 'Subject' });
  const ed = el('div', { class: 'le-ed', contenteditable: 'true', 'data-ph': 'Write your reply…', role: 'textbox', 'aria-multiline': 'true' });
  const sendBtn = el('button', { class: 'le-send', type: 'button' }, 'Send email');
  const warn = el('div', { class: 'le-warn', style: 'display:none' });
  const first = String(lead.name || '').trim().split(/\s+/)[0] || 'there';
  const chips = [
    ['Thanks', 'Hi ' + first + ',\n\nThanks for reaching out to LoadBoot.\n\n'],
    ['Call?', 'Hi ' + first + ',\n\nThanks for your message. What is the best number and time to reach you for a quick call?'],
    ['Need details', 'Hi ' + first + ',\n\nThanks for getting in touch. Could you share a few more details so we can help you properly?'],
  ].map(([label, txt]) => el('button', { class: 'le-chip', type: 'button', onClick: () => { ed.innerText = txt; place(); ed.focus(); } }, label));
  function place() { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  const fmt = (cmd, arg) => () => { ed.focus(); document.execCommand(cmd, false, arg); };
  const tb = el('div', { class: 'le-tb' }, [
    el('button', { type: 'button', title: 'Bold', onClick: fmt('bold') }, 'B'),
    el('button', { type: 'button', title: 'Italic', style: 'font-style:italic', onClick: fmt('italic') }, 'I'),
    el('button', { type: 'button', title: 'Bullets', onClick: fmt('insertUnorderedList') }, '•'),
    el('button', { type: 'button', title: 'Link', onClick: () => { const u = prompt('Link URL (https://…)'); if (u && /^https?:\/\//i.test(u)) fmt('createLink', u)(); } }, '🔗'),
  ]);

  function lastInbound() { const ms = (data && data.messages) || []; for (let i = ms.length - 1; i >= 0; i--) if (!ms[i].out) return ms[i]; return null; }
  function paintList() {
    const ms = (data && data.messages) || [];
    count.textContent = ms.length ? ms.length + ' email' + (ms.length === 1 ? '' : 's') : '';
    if (!ms.length) { mount(list, el('div', { class: 'le-empty' }, 'No emails with ' + (lead.email || 'this address') + ' yet. Your reply below goes out from the mailbox you pick, and their answer shows up here.')); return; }
    mount(list, ms.map((m) => {
      const [main, quoted] = splitQuote(m.text || htmlToText(m.html) || m.snippet || '');
      const q = el('div', { class: 'le-body', style: 'display:none;color:#64748b;margin-top:6px' }, quoted);
      return el('div', { class: 'le-m' + (m.out ? ' out' : '') }, [
        el('div', { class: 'le-meta' }, [el('span', { class: 'le-badge' }, (m.mailbox || '').split('@')[0] + '@'), el('span', null, (m.out ? 'LoadBoot → ' + ((m.to || []).map((t) => t.email).join(', ') || lead.email) : (m.from_name || m.from_email)) + ' · ' + when(m.at) + (m.has_attach ? ' · 📎' : '') + (m.folder === 'spam' ? ' · spam' : ''))]),
        m.subject ? el('div', { class: 'le-subj' }, m.subject) : '',
        el('div', { class: 'le-body' }, main || '(no text)'),
        quoted ? el('button', { class: 'le-q', type: 'button', onClick: (ev) => { const open = q.style.display === 'none'; q.style.display = open ? '' : 'none'; ev.target.textContent = open ? 'Hide quoted text' : 'Show quoted text'; } }, 'Show quoted text') : '',
        q,
      ]);
    }));
    list.scrollTop = list.scrollHeight;
  }
  function paintFrom() {
    const boxes = (data && data.mailboxes) || [];
    const cur = from.value;
    mount(from, boxes.map((b) => el('option', { value: b.id }, (b.name ? b.name + ' <' + b.address + '>' : b.address) + (b.error ? ' — connection problem' : ''))));
    if (cur && boxes.some((b) => b.id === cur)) from.value = cur;
    else { const li = lastInbound(); const pick = (li && boxes.find((b) => b.id === li.account_id)) || PREFER.map((p) => boxes.find((b) => b.address.startsWith(p))).find(Boolean) || boxes[0]; if (pick) from.value = pick.id; }
    const off = !data.enabled || !boxes.length;
    warn.style.display = off ? '' : 'none';
    warn.textContent = !data.enabled ? 'Company email is switched off in CC → Dispatcher email.' : 'No shared mailbox is connected yet. Connect hello@ (and billing@, loads@) in CC → Dispatcher email → Add mailbox, then you can send from here.';
    sendBtn.disabled = off || sending;
  }
  async function load(firstTime) {
    try {
      data = await ccDmailContact(lead.email, 100) || { messages: [], mailboxes: [] };
      if (firstTime && !subj.value) { const li = lastInbound(); const base = (li && li.subject) || lead.subject || 'Your enquiry with LoadBoot'; subj.value = /^re:/i.test(base) ? base : 'Re: ' + base; }
      paintFrom(); paintList();
    } catch (e) { mount(list, el('div', { class: 'le-empty' }, humanizeError(e))); }
  }
  async function refresh() {
    const ids = ((data && data.mailboxes) || []).filter((b) => !b.alias).map((b) => b.id);
    try { await Promise.all(ids.map((id) => dmailAct({ action: 'sync', account: id }).catch(() => null))); } catch (_) {}
    await load(false);
  }
  async function send() {
    const addr = to.value.trim(); const text = (ed.innerText || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { toast('Enter a valid email address'); to.focus(); return; }
    if (!text) { toast('Write a message first'); ed.focus(); return; }
    if (!from.value) return;
    sending = true; sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
    try {
      const li = lastInbound();
      const body = { action: 'send', account: from.value, to: [{ email: addr, name: lead.name || '' }], cc: [], bcc: [], subject: subj.value.trim() || 'LoadBoot', html: cleanHtml(ed) || esc(text).replace(/\n/g, '<br>') };
      if (li && li.account_id === from.value) body.reply_to = li.id;   // keeps it in their email thread
      await dmailAct(body);
      ed.innerHTML = ''; toast('Email sent');
      await load(false);
    } catch (e) { toast(humanizeError(e)); }
    sending = false; sendBtn.textContent = 'Send email'; paintFrom();
  }
  sendBtn.addEventListener('click', send);
  ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });

  const root = el('div', { class: 'le' }, [
    el('div', { class: 'le-h' }, [el('b', null, 'Email'), count, el('span', { class: 'sp' }), el('button', { class: 'le-ib', type: 'button', onClick: refresh, title: 'Check for new replies' }, '↻ Refresh')]),
    list,
    el('div', { class: 'le-c' }, [
      warn,
      el('div', { class: 'le-row' }, [el('label', null, 'From'), from]),
      el('div', { class: 'le-row' }, [el('label', null, 'To'), to]),
      el('div', { class: 'le-row' }, [el('label', null, 'Subject'), subj]),
      el('div', { class: 'le-row', style: 'justify-content:space-between' }, [tb, el('div', { class: 'le-chips' }, chips)]),
      ed,
      el('div', { class: 'le-foot' }, [el('span', { class: 'hint' }, 'Ctrl+Enter sends · the mailbox signature is added automatically'), sendBtn]),
    ]),
  ]);
  load(true);
  timer = setInterval(() => { if (!document.body.contains(root)) { clearInterval(timer); return; } if (document.visibilityState === 'visible' && !sending) load(false); }, 30000);
  return root;
}
export default leadEmailPanel;
