import { el } from '../../shared/ui/dom.js';
import { openDrawer } from '../../shared/ui/components.js';
import { mailStats, mailComposeSave, mailSend } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

// Use the existing mailbox draft/send path: permissions, catalog, opt-outs and
// delivery audit remain enforced by the server. Feedback stays open until handled.
export async function feedbackReply({ email, feedback, onSent }) {
  const status = el('p', { role: 'status' }, 'Loading mailboxes…');
  const body = el('div', null, status);
  const drawer = openDrawer('Reply to dispatcher', body, { subtitle: 'Email reply · request stays open until marked Handled' });
  try {
    const stats = await mailStats();
    if (!body.isConnected) return;
    if (!stats.can_draft) throw new Error('Your role cannot prepare email replies.');
    const boxes = (stats.mailboxes || []).filter(b => b.known !== false);
    if (!boxes.length) throw new Error('No mailbox is available to your role.');
    const from = el('select', { class: 'd3-in', 'aria-label': 'From mailbox' }, boxes.map(b => el('option', { value: b.mailbox }, b.mailbox)));
    from.value = boxes.some(b => b.mailbox === 'dispatch@loadboot.com') ? 'dispatch@loadboot.com' : boxes[0].mailbox;
    const subject = 'Re: Dispatcher ' + (feedback.kind === 'help' ? 'help request' : 'feedback') + ' · ' + feedback.id;
    const input = el('textarea', { class: 'd3-in', rows: '8', 'aria-label': 'Reply message', placeholder: 'Write your reply…', style: 'width:100%;box-sizing:border-box;resize:vertical' });
    const result = el('p', { role: 'status', style: 'white-space:pre-wrap' });
    let draftId = null, busy = false, sent = false;
    const actions = [];
    const run = async (send) => {
      if (busy || sent) return;
      if (!input.value.trim()) { result.textContent = 'Write a reply first.'; input.focus(); return; }
      busy = true; input.disabled = true; from.disabled = true; actions.forEach(b => { b.disabled = true; });
      try {
        // Serialize plain text through DOM, never interpolate dispatcher content as HTML.
        const fragment = el('div', null, [el('p', { style: 'white-space:pre-wrap' }, input.value.trim()),
          el('blockquote', { style: 'white-space:pre-wrap' }, 'Request ' + feedback.id + '\n' + (feedback.note || feedback.mood || feedback.kind))]);
        const draft = await mailComposeSave({ from: from.value, to: email, subject, bodyHtml: fragment.innerHTML, draftId });
        if (!draft || !draft.id) throw new Error('The mailbox did not return a saved draft.');
        draftId = draft.id;
        if (send) {
          const response = await mailSend(draftId);
          if (!response || response.ok !== true) throw new Error(response?.reason || 'The message was not sent.');
          sent = true; input.disabled = true; from.disabled = true;
          result.textContent = 'Reply queued through Mailbox. Check delivery there; mark this request Handled when resolved.';
          if (onSent) Promise.resolve().then(onSent).catch(() => {});
        } else result.textContent = 'Draft saved in Mailbox. Nothing sent.';
      } catch (e) { result.textContent = humanizeError(e); }
      finally { busy = false; input.disabled = sent; from.disabled = sent; actions.forEach(b => { b.disabled = sent; }); }
    };
    actions.push(el('button', { type: 'button', class: 'd3-btn', onClick: () => run(false) }, 'Save draft'));
    if (stats.can_send) actions.push(el('button', { type: 'button', class: 'd3-btn p', onClick: () => run(true) }, 'Send email'));
    body.replaceChildren(el('p', null, 'To: ' + email), from,
      el('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, feedback.note || feedback.mood || feedback.kind), input,
      el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, actions), result,
      el('a', { href: '#/mailbox?q=' + encodeURIComponent(email), onClick: () => drawer.close() }, 'Open email history →'));
  } catch (e) { status.textContent = humanizeError(e); }
}
