// mailbox.js — Command Center Mailbox (bl_mail_0335).
//
// The backend for this screen (app_private.mail_messages + cc_mail_ingest) has been running since
// bl_mail_loads_0176, and cc_mail_ingest raises a notification pointing at
// /app/command-center/#mailbox — but that route never existed, so every one of those notifications
// dead-ended on the Action Center and the mail sat unread. This is the missing screen.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE:
//
//   1. NOTHING SENDS BY ACCIDENT. Composing saves a DRAFT (cc_mail_draft_save). Putting mail on
//      the wire is a separate, confirmed action (cc_mail_send) that the server gates on
//      comm.manage. Owner decision, 7 Sep 2026: every carrier/broker-facing message is sent by a
//      human who chose to send it.
//
//   2. INBOUND HTML IS HOSTILE. It is written by whoever emailed us. It is NEVER put in this
//      document — not via innerHTML, not via el({html}). It renders inside a sandboxed iframe with
//      no scripts, no same-origin, and remote images blocked until the reader asks for them.
//      See renderBodyFrame().
//
// Permission model (client-side hiding only; the RPCs re-check everything):
//   comm.view   → read the mailbox
//   comm.send   → save / discard drafts
//   comm.manage → actually send  (stats.can_send mirrors the server's answer)

import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, searchBox, fmtDateTime, ago, askConfirm } from '../../shared/ui/components.js';
import { mailList, mailThread, mailMark, mailDraftSave, mailDraftDiscard, mailSend, mailStats } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { decodeMessage, decodeSubject, previewOf } from '../../shared/mime.js';

const PAGE = 40;

export function renderMailbox(host, initialThread) {
  injectStyleOnce();
  if (!can('comm.view')) {
    mount(host, el('div', { class: 'lb-state lb-error', role: 'alert' },
      el('p', null, 'You do not have access to the shared mailbox (comm.view required).')));
    return;
  }

  const S = {
    threads: [],
    nextBefore: null,
    mailbox: '',
    search: '',
    openThread: initialThread || null,
    canSend: false,
    loading: false,
  };

  const kpis      = el('div');
  const filterBar = el('div', { class: 'cc-toolbar', style: 'gap:8px;flex-wrap:wrap' });
  const listHost  = el('div', { class: 'cc-mailbox-list' });
  const paneHost  = el('div', { class: 'cc-mailbox-pane' });

  const mailboxSel = el('select', { class: 'cc-input', style: 'max-width:240px' },
    el('option', { value: '' }, 'All mailboxes'));
  mailboxSel.onchange = () => { S.mailbox = mailboxSel.value; reload(); };

  mount(host, el('div', null, [
    sectionHead('Mailbox',
      'Shared inbound mail (loads@, dispatch@, billing@ …). Replies are saved as drafts — nothing leaves LoadBoot until someone with send rights presses Send.',
      el('button', { class: 'lb-btn lb-btn-sm', onClick: () => reload(true) }, 'Refresh')),
    kpis,
    filterBar,
    el('div', { class: 'cc-mailbox-grid' }, [listHost, paneHost]),
  ]));

  mount(filterBar, [
    mailboxSel,
    searchBox('Search subject, sender or body…', (q) => { S.search = q || ''; reload(); }),
  ]);

  reload(true);

  // ── data ───────────────────────────────────────────────────────────────────

  async function loadStats() {
    let s;
    try { s = await mailStats(); } catch (_) { return; }          // KPIs are decoration, never fatal
    S.canSend = !!(s && s.can_send);
    mount(kpis, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list',  label: 'Threads', value: String(s?.threads ?? 0), sub: 'all mailboxes', accent: 'blue' }),
      statCard({ icon: 'bell',  label: 'Unread',  value: String(s?.unread  ?? 0), sub: 'need a reply',  accent: (s?.unread ? 'amber' : 'green') }),
      statCard({ icon: 'doc',   label: 'Drafts',  value: String(s?.drafts  ?? 0), sub: 'not sent',      accent: 'violet' }),
      statCard({ icon: 'check', label: 'Sent',    value: String(s?.sent    ?? 0), sub: 'from the CC',   accent: 'green' }),
    ]));

    const boxes = Array.isArray(s?.mailboxes) ? s.mailboxes : [];
    const keep = mailboxSel.value;
    mount(mailboxSel, [el('option', { value: '' }, 'All mailboxes')].concat(
      boxes.map(b => el('option', { value: b.mailbox },
        b.mailbox + (b.unread ? '  (' + b.unread + ' unread)' : '')))));
    mailboxSel.value = keep;
  }

  async function reload(withStats) {
    S.nextBefore = null; S.threads = [];
    if (withStats) loadStats();
    showLoading(listHost, 'Loading mail…');
    await loadPage();
    if (S.openThread) openThread(S.openThread, { markRead: false });
    else mount(paneHost, emptyPane());
  }

  async function loadPage() {
    if (S.loading) return;
    S.loading = true;
    let res;
    try {
      res = await mailList({ limit: PAGE, mailbox: S.mailbox || null, search: S.search || null, before: S.nextBefore });
    } catch (e) {
      S.loading = false;
      showError(listHost, humanizeError(e), () => reload(true));
      return;
    }
    S.loading = false;
    S.threads = S.threads.concat(res?.threads || []);
    S.nextBefore = res?.next_before || null;
    paintList();
  }

  // ── thread list ────────────────────────────────────────────────────────────

  function paintList() {
    if (!S.threads.length) {
      showEmpty(listHost, S.search || S.mailbox
        ? 'No mail matches this filter.'
        : 'No mail has been ingested yet. Inbound mail arrives via cc_mail_ingest.');
      return;
    }
    const rows = S.threads.map(t => {
      const unread = Number(t.unread || 0);
      const row = el('button', {
        class: 'cc-mail-row' + (unread ? ' unread' : '') + (t.thread_key === S.openThread ? ' active' : ''),
        onClick: () => openThread(t.thread_key, { markRead: true }),
      }, [
        el('div', { class: 'cc-mail-row-top' }, [
          el('span', { class: 'cc-mail-from' }, t.peer_name || t.peer_email || 'Unknown sender'),
          el('span', { class: 'cc-mail-when', title: fmtDateTime(t.last_at) }, ago(t.last_at)),
        ]),
        el('div', { class: 'cc-mail-subject' }, decodeSubject(t.subject) || '(no subject)'),
        el('div', { class: 'cc-mail-preview' }, t.preview
          ? previewOf({ body_text: t.preview }, 120)
          : ''),
        el('div', { class: 'cc-mail-tags' }, [
          el('span', { class: 'cc-pill cc-pill-gray' }, t.mailbox || '—'),
          unread ? el('span', { class: 'cc-pill cc-pill-amber' }, unread + ' unread') : null,
          t.has_draft ? el('span', { class: 'cc-pill cc-pill-violet' }, 'draft') : null,
          Number(t.msg_count) > 1 ? el('span', { class: 'cc-sub' }, t.msg_count + ' messages') : null,
        ].filter(Boolean)),
      ]);
      return row;
    });

    if (S.nextBefore) {
      rows.push(el('button', { class: 'lb-btn lb-btn-sm', style: 'margin:10px auto;display:block',
        onClick: (e) => { e.target.disabled = true; e.target.textContent = 'Loading…'; loadPage(); } }, 'Load older'));
    }
    mount(listHost, rows);
  }

  // ── thread pane ────────────────────────────────────────────────────────────

  function emptyPane() {
    return el('div', { class: 'lb-state lb-empty' }, el('p', null, 'Pick a conversation to read it.'));
  }

  async function openThread(key, opts = {}) {
    S.openThread = key;
    paintList();
    showLoading(paneHost, 'Opening…');
    let msgs;
    try {
      // Reading marks inbound as read — but only when a human actually clicked into the thread,
      // never on a deep link or a refresh, which is why markRead is explicit.
      msgs = await mailThread(key, opts.markRead !== false);
    } catch (e) { showError(paneHost, humanizeError(e), () => openThread(key, opts)); return; }

    if (opts.markRead !== false) { loadStats(); softDecrementUnread(key); }
    paintThread(key, Array.isArray(msgs) ? msgs : []);
  }

  function softDecrementUnread(key) {
    const t = S.threads.find(x => x.thread_key === key);
    if (t) { t.unread = 0; paintList(); }
  }

  function paintThread(key, msgs) {
    if (!msgs.length) { mount(paneHost, emptyPane()); return; }

    const head = msgs[0];
    const draft = msgs.find(m => m.status === 'draft') || null;
    const lastIn = [...msgs].reverse().find(m => m.direction === 'in') || head;

    mount(paneHost, el('div', { class: 'cc-mail-thread' }, [
      el('div', { class: 'cc-mail-thread-head' }, [
        el('h3', null, decodeSubject(head.subject) || '(no subject)'),
        el('div', { class: 'cc-sub' }, [
          (lastIn.peer_name ? lastIn.peer_name + ' · ' : '') + (lastIn.peer_email || ''),
          ' → ', lastIn.mailbox || '',
        ]),
        el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
          el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => {
            try { await mailMark(key, false); toast('Marked unread', 'success'); loadStats(); reload(); }
            catch (e) { toast(humanizeError(e), 'error'); }
          } }, 'Mark unread'),
          lastIn.peer_email ? el('a', {
            class: 'lb-btn lb-btn-sm',
            href: 'mailto:' + encodeURIComponent(lastIn.peer_email)
                  + '?subject=' + encodeURIComponent('Re: ' + decodeSubject(head.subject)),
          }, 'Open in mail app') : null,
        ].filter(Boolean)),
      ]),
      el('div', { class: 'cc-mail-messages' }, msgs.map(m => messageCard(m))),
      composer(key, draft, lastIn),
    ]));
  }

  function messageCard(m) {
    const d = decodeMessage(m);
    const isOut = m.direction === 'out';
    const label = isOut
      ? (m.status === 'draft' ? 'Draft (not sent)' : 'Sent by LoadBoot')
      : (m.peer_name || m.peer_email || 'Sender');

    const bodyHost = el('div', { class: 'cc-mail-body' });
    renderBody(bodyHost, d);

    return el('div', { class: 'cc-mail-msg' + (isOut ? ' out' : '') + (m.status === 'draft' ? ' draft' : '') }, [
      el('div', { class: 'cc-mail-msg-head' }, [
        el('span', { class: 'cc-mail-msg-who' }, label),
        el('span', { class: 'cc-mail-when', title: fmtDateTime(m.created_at) },
          m.status === 'sent' && m.sent_at ? 'sent ' + ago(m.sent_at) : ago(m.created_at)),
      ]),
      d.attachments?.length
        ? el('div', { class: 'cc-sub' }, '📎 ' + d.attachments.map(a => a.filename).join(', ')
            + ' — attachments are not stored yet; open the message in your mail app to get them.')
        : null,
      bodyHost,
    ].filter(Boolean));
  }

  /**
   * Render one message body.
   * Plain text goes through a text node (el() never sets innerHTML from data).
   * HTML goes into a sandboxed iframe — see renderBodyFrame.
   */
  function renderBody(host, d) {
    if (d.html) { mount(host, renderBodyFrame(d.html, !!d.text, d.text)); return; }
    mount(host, el('pre', { class: 'cc-mail-plain' }, d.text || '(empty message)'));
  }

  /**
   * SECURITY BOUNDARY.
   *
   * `html` is attacker-controlled: anyone who can email loads@ can put markup here. It is never
   * parsed by this document. The iframe has:
   *   • sandbox WITHOUT allow-scripts      → no JS runs, ever
   *   • sandbox WITHOUT allow-same-origin  → opaque origin: no access to our cookies, storage,
   *                                          Supabase session, or parent DOM
   *   • a CSP meta that blocks every remote fetch, so a tracking pixel cannot phone home and tell
   *     a sender that staff opened their mail. "Show remote images" re-renders with img-src https:
   *     — a deliberate, per-message choice.
   *   • allow-popups + <base target="_blank"> so a link the reader clicks still opens, in a new tab
   *   • referrerpolicy=no-referrer so we never leak CC URLs outward
   *
   * The frame cannot self-size (that would need same-origin), so it gets a fixed viewport with an
   * expand toggle. A slightly clipped email is a fair price for not handing the page to a stranger.
   */
  function renderBodyFrame(html, hasText, text) {
    let showRemote = false, expanded = false, showingText = false;

    const frame = el('iframe', {
      class: 'cc-mail-frame',
      sandbox: 'allow-popups allow-popups-to-escape-sandbox',
      referrerpolicy: 'no-referrer',
      loading: 'lazy',
      title: 'Message body (isolated)',
    });

    const plain = el('pre', { class: 'cc-mail-plain', hidden: true }, text || '');

    const paint = () => {
      const csp = showRemote
        ? "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:;"
        : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;";
      frame.setAttribute('srcdoc',
        '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
        + '<base target="_blank">'
        + '<style>html,body{margin:0;padding:12px;font:14px/1.6 system-ui,Segoe UI,Arial,sans-serif;'
        + 'color:#0f172a;background:#fff;word-break:break-word}img{max-width:100%;height:auto}'
        + 'table{max-width:100%}a{color:#0883F7}</style></head><body>' + html + '</body></html>');
      frame.style.height = (expanded ? 900 : 380) + 'px';
    };
    paint();

    const btn = (label, onClick) => el('button', { class: 'lb-btn lb-btn-sm', onClick }, label);

    const controls = el('div', { class: 'cc-mail-frame-controls' }, [
      (() => { const b = btn('Show remote images', () => {
        showRemote = !showRemote; b.textContent = showRemote ? 'Hide remote images' : 'Show remote images'; paint();
      }); return b; })(),
      (() => { const b = btn('Expand', () => {
        expanded = !expanded; b.textContent = expanded ? 'Collapse' : 'Expand'; paint();
      }); return b; })(),
      hasText ? (() => { const b = btn('View plain text', () => {
        showingText = !showingText;
        frame.hidden = showingText; plain.hidden = !showingText;
        b.textContent = showingText ? 'View formatted' : 'View plain text';
      }); return b; })() : null,
      el('span', { class: 'cc-sub' }, 'Isolated view — scripts blocked, images off by default.'),
    ].filter(Boolean));

    return el('div', null, [controls, frame, plain]);
  }

  // ── composer: drafts only ──────────────────────────────────────────────────

  function composer(key, draft, lastIn) {
    if (!can('comm.send')) {
      return el('div', { class: 'cc-sub', style: 'padding:12px' },
        'You can read this thread but not reply (comm.send required).');
    }

    const ta = el('textarea', {
      class: 'cc-input', rows: '7',
      placeholder: 'Write the reply. It is saved as a draft — it is not sent until someone presses Send.',
    });
    if (draft) ta.value = htmlToPlain(draft.body_html || '');

    const status = el('div', { class: 'cc-sub', style: 'min-height:18px' },
      draft ? 'Draft saved ' + ago(draft.created_at) + ' — not sent.' : '');

    const saveBtn = el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: async () => {
      const body = ta.value.trim();
      if (!body) { toast('Write something first.'); return; }
      saveBtn.disabled = true;
      try {
        await mailDraftSave(key, plainToHtml(body));
        toast('Draft saved — nothing sent.', 'success');
        loadStats(); openThread(key, { markRead: false });
      } catch (e) { toast(humanizeError(e), 'error'); saveBtn.disabled = false; }
    } }, draft ? 'Update draft' : 'Save draft');

    const discardBtn = draft ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => {
      if (!await askConfirm('Discard this draft?', { body: 'The unsent reply will be deleted.', confirmLabel: 'Discard', danger: true })) return;
      try { await mailDraftDiscard(key); toast('Draft discarded'); loadStats(); openThread(key, { markRead: false }); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, 'Discard draft') : null;

    // Send is deliberately the smallest, last, most-confirmed control on the screen.
    const sendBtn = (draft && S.canSend) ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => {
      const ok = await askConfirm('Send this reply for real?', {
        body: 'This emails ' + (lastIn.peer_email || 'the sender')
              + ' from LoadBoot immediately. Drafts are safe; sending is not reversible.',
        subtitle: 'Outbound email', confirmLabel: 'Send it',
      });
      if (!ok) return;
      sendBtn.disabled = true;
      try {
        const res = await mailSend(draft.id);
        if (res && res.ok === false) toast('Already sent — nothing sent twice.', 'success');
        else toast('Sent to ' + (res?.to || lastIn.peer_email), 'success');
        loadStats(); openThread(key, { markRead: false });
      } catch (e) { toast(humanizeError(e), 'error'); sendBtn.disabled = false; }
    } }, 'Send now') : null;

    return el('div', { class: 'cc-mail-composer' }, [
      el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:6px' },
        'Reply to ' + (lastIn.peer_email || 'sender')),
      ta,
      el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap' },
        [saveBtn, discardBtn, sendBtn].filter(Boolean)),
      status,
      !S.canSend && draft
        ? el('div', { class: 'cc-sub' }, 'Draft is ready. Sending needs comm.manage — ask an owner to send it.')
        : null,
    ].filter(Boolean));
  }

  // Escape first, then add markup: staff text must never become live HTML in the email.
  function plainToHtml(s) {
    const esc = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.split(/\n{2,}/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('\n');
  }
  function htmlToPlain(h) {
    return String(h)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .trim();
  }
}

// Scoped styles. Injected into <head>, NOT into the view host — the host is re-mounted on every
// repaint, so a <style> living inside it would be torn out and the guard below would then wrongly
// report it as still present. Kept in this file rather than command-center.css so the whole screen
// reverts by deleting one file and one route.
function injectStyleOnce() {
  if (document.getElementById('cc-mailbox-style')) return;
  document.head.appendChild(el('style', { id: 'cc-mailbox-style' }, `
.cc-mailbox-grid{display:grid;grid-template-columns:minmax(280px,380px) 1fr;gap:14px;align-items:start}
@media (max-width:900px){.cc-mailbox-grid{grid-template-columns:1fr}}
.cc-mailbox-list{max-height:70vh;overflow:auto;border:1px solid var(--lb-border,#e2e8f0);border-radius:12px;background:var(--lb-surface,#fff)}
.cc-mailbox-pane{border:1px solid var(--lb-border,#e2e8f0);border-radius:12px;background:var(--lb-surface,#fff);min-height:240px;overflow:hidden}
.cc-mail-row{display:block;width:100%;text-align:left;padding:12px 14px;border:0;border-bottom:1px solid var(--lb-border,#e2e8f0);background:transparent;cursor:pointer;font:inherit;color:inherit}
.cc-mail-row:hover{background:rgba(8,131,247,.06)}
.cc-mail-row.active{background:rgba(8,131,247,.10);box-shadow:inset 3px 0 0 #0883F7}
.cc-mail-row.unread .cc-mail-subject{font-weight:800}
.cc-mail-row-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.cc-mail-from{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-mail-when{font-size:12px;opacity:.65;white-space:nowrap}
.cc-mail-subject{font-size:14px;margin:2px 0}
.cc-mail-preview{font-size:12px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-mail-tags{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
.cc-mail-thread-head{padding:14px;border-bottom:1px solid var(--lb-border,#e2e8f0)}
.cc-mail-thread-head h3{margin:0 0 4px;font-size:16px}
.cc-mail-messages{padding:14px;display:flex;flex-direction:column;gap:14px;max-height:60vh;overflow:auto}
.cc-mail-msg{border:1px solid var(--lb-border,#e2e8f0);border-radius:10px;overflow:hidden}
.cc-mail-msg.out{border-color:#0883F7}
.cc-mail-msg.draft{border-style:dashed;border-color:#7c3aed}
.cc-mail-msg-head{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;background:rgba(16,34,59,.04);font-size:12px}
.cc-mail-msg-who{font-weight:700}
.cc-mail-plain{margin:0;padding:12px;white-space:pre-wrap;word-break:break-word;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.cc-mail-frame{width:100%;border:0;display:block;background:#fff}
.cc-mail-frame-controls{display:flex;gap:8px;align-items:center;padding:8px 12px;flex-wrap:wrap;border-bottom:1px solid var(--lb-border,#e2e8f0)}
.cc-mail-composer{padding:14px;border-top:1px solid var(--lb-border,#e2e8f0);background:rgba(16,34,59,.03)}
`));
}

export default renderMailbox;
