import { el } from '../../shared/ui/dom.js';
import { mailList, mailThread } from '../../shared/api.js';
import { fmtDateTime } from '../../shared/ui/components.js';
import { humanizeError } from '../../shared/errors.js';

export const requestReplies = (messages, email, id) => (messages || []).filter(m =>
  m.direction === 'out' && m.status === 'sent' &&
  String(m.peer_email || '').toLowerCase() === String(email || '').toLowerCase() &&
  String(m.subject || '').includes(id));

export const attachReplyThread = (messages, threadKey) => (messages || []).map(m => ({ ...m, thread_key: threadKey }));

// Detached parsing + text nodes only. Never render stored email HTML into CC.
function replyText(m) {
  if (!m.body_html) return m.body_text || '';
  const doc = new DOMParser().parseFromString(m.body_html || '', 'text/html');
  doc.querySelectorAll('blockquote,script,style').forEach(n => n.remove());
  doc.querySelectorAll('p,br,div').forEach(n => n.appendChild(doc.createTextNode('\n')));
  return (doc.body.textContent || '').trim();
}

export function feedbackReplyHistory(email, id) {
  const box = el('div', { style: 'margin-top:10px;padding:10px;border:1px solid var(--line2);border-radius:8px;overflow-wrap:anywhere', 'aria-label': 'Replies to this request' });
  const refresh = async () => {
    box.replaceChildren(el('span', { class: 'd3-mut' }, 'Loading reply history…'));
    try {
      const result = await mailList({ search: id, folder: 'all', limit: 50 });
      const threads = (result?.threads || []).filter(t => String(t.subject || '').includes(id) && String(t.peer_email || '').toLowerCase() === email.toLowerCase());
      const messages = (await Promise.all(threads.map(async t => attachReplyThread(await mailThread(t.thread_key, false), t.thread_key)))).flat();
      const replies = requestReplies(messages, email, id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      box.replaceChildren(...(replies.length ? replies.map(m => el('div', { style: 'margin:4px 0 12px' }, [
        el('b', null, 'Reply sent · ' + fmtDateTime(m.sent_at || m.created_at)),
        el('div', { class: 'd3-mut' }, (m.mailbox || '') + ' → ' + m.peer_email),
        el('div', { style: 'white-space:pre-wrap;margin-top:6px' }, replyText(m)),
        el('a', { href: '#/mailbox?thread=' + encodeURIComponent(m.thread_key) }, 'Open sent reply →'),
      ])) : [el('span', { class: 'd3-mut' }, 'No sent reply recorded for this request.') ]));
    } catch (e) {
      box.replaceChildren(el('span', null, 'Reply history unavailable: ' + humanizeError(e)),
        el('button', { type: 'button', class: 'd3-btn sm', onClick: refresh }, 'Retry'));
    }
  };
  refresh();
  return box;
}
