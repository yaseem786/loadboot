// chat.js — Control Tower Wave H: staff team chat.
// A lightweight live channel for the ops team. Posts via cc_post_chat, reads via
// cc_list_chat (polled every 4s for new messages). author_user is the trusted identity;
// the display name comes from the signed-in session. Staff-only, flag team_chat_enabled.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, fmtDateTime } from '../../shared/ui/components.js';
import { postChat, listChat } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { getUser } from '../../shared/session.js';

export function renderChat(host) {
  let maxId = 0, timer = null, myName = 'Staff';
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Team chat', 'A live channel for the dispatch team. Messages are visible to all active staff.'),
    el('div', { class: 'cc-chat', id: 'chat-wrap' }, [
      el('div', { class: 'cc-chat-stream', id: 'chat-stream' }, el('div', { class: 'cc-sub', style: 'padding:10px' }, 'Loading messages…')),
      el('div', { class: 'cc-chat-bar' }, [
        el('input', { class: 'cc-input', id: 'chat-input', placeholder: 'Write a message… (Enter to send)', autocomplete: 'off' }),
        el('button', { class: 'lb-btn lb-btn-primary', id: 'chat-send' }, 'Send'),
      ]),
    ]),
  ]));
  const stream = host.querySelector('#chat-stream');
  const input = host.querySelector('#chat-input');
  const sendBtn = host.querySelector('#chat-send');

  getUser().then(u => { myName = (u && (u.user_metadata?.name || u.email)) || 'Staff'; }).catch(() => {});

  load(true);
  timer = setInterval(() => load(false), 4000);
  const obs = new MutationObserver(() => { if (!document.body.contains(stream)) { clearInterval(timer); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  async function send() {
    const body = input.value.trim();
    if (!body) return;
    input.value = ''; sendBtn.disabled = true;
    try { await postChat(body, myName); } catch (e) { alert(humanizeError(e)); input.value = body; }
    sendBtn.disabled = false; input.focus();
    await load(false);
  }

  async function load(initial) {
    let rows;
    try { rows = await listChat(initial ? 0 : maxId, 100); } catch (e) { if (initial) mount(stream, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    rows = (rows || []).slice().reverse(); // server returns newest-first; show oldest→newest
    if (!rows.length) { if (initial) mount(stream, el('div', { class: 'cc-sub', style: 'padding:10px' }, 'No messages yet. Say hello 👋')); return; }
    if (initial) clear(stream);
    rows.forEach(m => {
      if (m.id > maxId) maxId = m.id;
      stream.appendChild(el('div', { class: 'cc-msg' + (m.is_me ? ' me' : '') }, [
        el('div', { class: 'cc-msg-bubble' }, [
          el('div', { class: 'cc-msg-meta' }, [el('b', null, m.is_me ? 'You' : (m.author_name || 'Staff')), el('span', { class: 'cc-sub' }, ' · ' + fmtDateTime(m.created_at))]),
          el('div', { class: 'cc-msg-body' }, m.body),
        ]),
      ]));
    });
    stream.scrollTop = stream.scrollHeight;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
}

export default renderChat;
