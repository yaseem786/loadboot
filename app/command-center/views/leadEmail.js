// leadEmail.js — email a web lead straight from CC Web leads, and see every email with that address
// (in + out). bl_dmail_0505 → bl_mail_0506
//
// Runs on the SAME engine as CC → Mailbox (hello@, dispatch@, billing@, loads@ — app_private.mail_boxes):
//   mailboxes  = cc_mail_stats.mailboxes (server decides which this person may write from)
//   history    = cc_mail_list(search=email, folder=all) filtered to peer_email = the lead, + cc_mail_thread
//   reply      = cc_mail_draft_save(thread) → cc_mail_send(draft)   (same thread, same mailbox it came to)
//   new email  = cc_mail_compose_save(from,to,subject) → cc_mail_send(draft)
// cc_mail_send goes through the email catalog (mail.reply / mail.compose) + the unsubscribe gate.
// Replies come in through the normal inbound route and show here on refresh (auto every 30 s).
import { el, mount } from '../../shared/ui/dom.js';
import { askConfirm } from '../../shared/ui/components.js';
import { mailStats, mailList, mailThread, mailDraftSave, mailComposeSave, mailSend } from '../../shared/api.js';
import { cleanHtml } from '../../shared/dmail.js';
import { decodeMessage, decodeSubject } from '../../shared/mime.js';
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
.le-badge{font-size:10.5px;font-weight:800;background:var(--bx,#10223B);color:#fff;border-radius:6px;padding:1px 6px}
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
.le-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bx,#0883F7);margin-right:2px}
.le-rp{border:0;background:none;color:#0883F7;font:inherit;font-size:11.5px;font-weight:800;cursor:pointer;padding:0;margin-left:auto}
.le-warn{font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 10px}
`;
let cssDone = false;
function css() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (v) => { try { return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } };
// Split off the quoted history ("On … wrote:" / "-----Original Message-----" / "> " lines) so each card shows the new part.
function splitQuote(t) {
  const s = String(t || '').trim();
  const m = s.search(/\n(On .{5,200}wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+\nSent: |>.*)/i);
  return m > 20 ? [s.slice(0, m).trim(), s.slice(m).trim()] : [s, ''];
}
const PREFER = ['hello@', 'loads@', 'dispatch@', 'billing@'];
const baseSubj = (s) => String(s || '').replace(/^((re|fwd?)\s*:\s*)+/i, '').trim().toLowerCase();
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#10223B');
function mailErr(e) { if (e && (e.code === '22023' || e.code === 'P0001') && e.message && e.message.length < 400) return e.message; return humanizeError(e); }
// Inbound bodies may be raw MIME / HTML: decode, then take TEXT only (never inject their HTML).
function msgText(m) {
  const d = decodeMessage(m);
  if (d.text && d.text.trim()) return d.text;
  if (d.html) { const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(d.html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr)>/gi, '\n') + '</body>', 'text/html'); doc.querySelectorAll('style,script').forEach((n) => n.remove()); return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); }
  return '';
}

/** leadEmailPanel({ email, name, subject }) → element. Staff only (server enforces comm.view / comm.send / comm.manage). */
export function leadEmailPanel(o) {
  css();
  const lead = Object.assign({ email: '', name: '', subject: '' }, o || {});
  const lc = String(lead.email || '').trim().toLowerCase();
  let boxes = []; let canSend = false; let threads = []; let msgs = []; let timer = null; let sending = false; let replyKey = null; let draft = null;
  const list = el('div', { class: 'le-list' }, el('div', { class: 'le-empty' }, 'Loading email history…'));
  const count = el('span', { style: 'font-size:12px;color:#64748b' });
  const from = el('select', { class: 'le-in', 'aria-label': 'Send from' });
  const to = el('input', { class: 'le-in', value: lead.email || '', 'aria-label': 'To' });
  const subj = el('input', { class: 'le-in', 'aria-label': 'Subject', placeholder: 'Subject' });
  const ed = el('div', { class: 'le-ed', contenteditable: 'true', 'data-ph': 'Write your reply…', role: 'textbox', 'aria-multiline': 'true' });
  const sendBtn = el('button', { class: 'le-send', type: 'button' }, 'Send email');
  const warn = el('div', { class: 'le-warn', style: 'display:none' });
  const mode = el('div', { style: 'font-size:12px;color:#64748b' });
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

  const box = (addr) => boxes.find((b) => b.mailbox === String(addr || '').toLowerCase()) || { mailbox: addr || '', label: String(addr || '').split('@')[0], color: '#10223B', from_name: 'LoadBoot' };
  const thr = (k) => threads.find((t) => t.thread_key === k);
  function lastInbound() { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].direction === 'in') return msgs[i]; return null; }
  // The thread a send will REPLY into: same mailbox as From, has an inbound mail, same subject.
  function replyTarget() {
    const t = replyKey && thr(replyKey);
    if (t && t.has_in && String(t.mailbox).toLowerCase() === from.value && baseSubj(subj.value) === baseSubj(decodeSubject(t.subject))) return t;
    return null;
  }
  function paintMode() {
    const t = replyTarget();
    mode.textContent = t ? 'Replying in the same email thread (' + box(t.mailbox).label + ')' : 'New email from ' + (from.value || '—') + (msgs.length ? ' · change Subject/From back to reply in a thread' : '');
  }
  function pickReply(t) {
    replyKey = t.thread_key;
    if (boxes.some((b) => b.mailbox === String(t.mailbox).toLowerCase())) from.value = String(t.mailbox).toLowerCase();
    const s = decodeSubject(t.subject) || ''; subj.value = /^re:/i.test(s) ? s : 'Re: ' + s;
    paintMode(); place(); ed.focus();
  }
  function paintList() {
    const ms = msgs.filter((m) => m.status !== 'draft');
    count.textContent = ms.length ? ms.length + ' email' + (ms.length === 1 ? '' : 's') : '';
    if (!ms.length) { mount(list, el('div', { class: 'le-empty' }, 'No emails with ' + (lead.email || 'this address') + ' yet. Your email below goes out from the mailbox you pick, and their answer shows up here.')); return; }
    mount(list, ms.map((m) => {
      const out = m.direction === 'out'; const b = box(m.mailbox); const t = thr(m.thread_key);
      const [main, quoted] = splitQuote(msgText(m));
      const q = el('div', { class: 'le-body', style: 'display:none;color:#64748b;margin-top:6px' }, quoted);
      const at = out && m.sent_at ? m.sent_at : m.created_at;
      const att = Array.isArray(m.attachments) && m.attachments.length;
      return el('div', { class: 'le-m' + (out ? ' out' : '') }, [
        el('div', { class: 'le-meta' }, [
          el('span', { class: 'le-badge', style: '--bx:' + safeColor(b.color), title: b.mailbox }, b.label || b.mailbox),
          el('span', null, (out ? 'LoadBoot → ' + (m.peer_email || lead.email) : (m.peer_name || m.peer_email)) + ' · ' + when(at) + (att ? ' · 📎' : '') + (m.status === 'failed' ? ' · failed: ' + (m.send_error || 'not delivered') : '')),
          !out && t && t.has_in ? el('button', { class: 'le-rp', type: 'button', onClick: () => pickReply(t) }, 'Reply') : '',
        ]),
        m.subject ? el('div', { class: 'le-subj' }, decodeSubject(m.subject)) : '',
        el('div', { class: 'le-body' }, main || '(no text)'),
        quoted ? el('button', { class: 'le-q', type: 'button', onClick: (ev) => { const open = q.style.display === 'none'; q.style.display = open ? '' : 'none'; ev.target.textContent = open ? 'Hide quoted text' : 'Show quoted text'; } }, 'Show quoted text') : '',
        q,
      ]);
    }));
    list.scrollTop = list.scrollHeight;
  }
  function paintFrom() {
    const writable = boxes.filter((b) => b.known !== false && b.can_compose !== false);
    const cur = from.value;
    mount(from, writable.map((b) => el('option', { value: b.mailbox }, (b.from_name || b.label) + ' <' + b.mailbox + '>')));
    if (cur && writable.some((b) => b.mailbox === cur)) from.value = cur;
    else { const li = lastInbound(); const pick = (li && writable.find((b) => b.mailbox === String(li.mailbox).toLowerCase())) || PREFER.map((p) => writable.find((b) => b.mailbox.startsWith(p))).find(Boolean) || writable[0]; if (pick) from.value = pick.mailbox; }
    const off = !writable.length;
    warn.style.display = off || !canSend ? '' : 'none';
    warn.textContent = off ? 'You cannot write from any LoadBoot mailbox (needs comm.send).' : 'You can save drafts here, but sending needs comm.manage — an owner can send it from CC → Mailbox → Drafts.';
    sendBtn.disabled = off || sending;
    sendBtn.textContent = sending ? 'Sending…' : (canSend ? 'Send email' : 'Save draft');
    paintMode();
  }
  async function load(firstTime) {
    try {
      const [st, res] = await Promise.all([boxes.length ? Promise.resolve(null) : mailStats(), lc ? mailList({ search: lc, folder: 'all', limit: 50 }) : Promise.resolve({ threads: [] })]);
      if (st) { boxes = Array.isArray(st.mailboxes) ? st.mailboxes : []; canSend = !!st.can_send; }
      threads = ((res && res.threads) || []).filter((t) => String(t.peer_email || '').toLowerCase() === lc && !t.trashed).slice(0, 12);
      const all = await Promise.all(threads.map((t) => mailThread(t.thread_key, false).then((ms) => (ms || []).map((m) => Object.assign(m, { thread_key: t.thread_key }))).catch(() => [])));
      msgs = all.flat().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (firstTime) {
        const li = lastInbound(); const t = li && thr(li.thread_key);
        if (t && t.has_in) { replyKey = t.thread_key; }
        const base = (li && decodeSubject(li.subject)) || lead.subject || 'Your enquiry with LoadBoot';
        if (!subj.value) subj.value = /^re:/i.test(base) ? base : 'Re: ' + base;
      }
      paintFrom(); paintList();
    } catch (e) { mount(list, el('div', { class: 'le-empty' }, mailErr(e))); }
  }
  async function send() {
    if (sending) return;
    const addr = to.value.trim().toLowerCase(); const text = (ed.innerText || '').trim();
    if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(addr)) { toast('Enter one valid email address'); to.focus(); return; }
    if (!text) { toast('Write a message first'); ed.focus(); return; }
    if (!from.value) return;
    const sig = box(from.value).signature_html || '';
    const html = (cleanHtml(ed) || esc(text).replace(/\n/g, '<br>')) + (sig ? '<br>' + sig : '');
    const t = addr === lc ? replyTarget() : null;
    sending = true; paintFrom();
    try {
      let id;
      if (t) id = await mailDraftSave(t.thread_key, html);
      else { const r = await mailComposeSave({ from: from.value, to: addr, subject: subj.value.trim() || 'LoadBoot', bodyHtml: html, draftId: draft && draft.to === addr ? draft.id : null }); id = r && r.id; draft = { id, to: addr }; }
      if (!id) throw new Error('Draft could not be saved');
      if (!canSend) { toast('Draft saved — an owner can send it from CC → Mailbox → Drafts'); ed.innerHTML = ''; draft = null; }
      else {
        const ok = await askConfirm('Send this email for real?', { body: 'This emails ' + addr + ' from ' + from.value + ' now. Sending cannot be undone.', subtitle: 'Outbound email', confirmLabel: 'Send it' });
        if (ok) {
          const res = await mailSend(id);
          ed.innerHTML = ''; draft = null;
          toast(res && res.ok === false ? 'Already sent — nothing sent twice.' : 'Email sent');
        } else toast('Not sent — saved as a draft in CC → Mailbox');
      }
      await load(false);
    } catch (e) { toast(mailErr(e)); }
    sending = false; paintFrom();
  }
  sendBtn.addEventListener('click', send);
  from.addEventListener('change', paintMode);
  subj.addEventListener('input', paintMode);
  ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });

  const root = el('div', { class: 'le' }, [
    el('div', { class: 'le-h' }, [el('b', null, 'Email'), count, el('span', { class: 'sp' }),
      el('a', { class: 'le-ib', href: '#/mailbox?q=' + encodeURIComponent(lc), title: 'Open in CC Mailbox', style: 'text-decoration:none' }, 'Mailbox ↗'),
      el('button', { class: 'le-ib', type: 'button', onClick: () => load(false), title: 'Check for new replies' }, '↻ Refresh')]),
    list,
    el('div', { class: 'le-c' }, [
      warn,
      el('div', { class: 'le-row' }, [el('label', null, 'From'), from]),
      el('div', { class: 'le-row' }, [el('label', null, 'To'), to]),
      el('div', { class: 'le-row' }, [el('label', null, 'Subject'), subj]),
      mode,
      el('div', { class: 'le-row', style: 'justify-content:space-between' }, [tb, el('div', { class: 'le-chips' }, chips)]),
      ed,
      el('div', { class: 'le-foot' }, [el('span', { class: 'hint' }, 'Ctrl+Enter sends · mailbox signature added automatically'), sendBtn]),
    ]),
  ]);
  load(true);
  timer = setInterval(() => { if (!document.body.contains(root)) { clearInterval(timer); return; } if (document.visibilityState === 'visible' && !sending) load(false); }, 30000);
  return root;
}
export default leadEmailPanel;
