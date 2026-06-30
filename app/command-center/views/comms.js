// comms.js — Wave 4 Communications. Message threads (optionally tied to a carrier/load/trip),
// a notification center over the Automation Core notifications, and reusable templates.
// Reads/writes via cc_comm_* RPCs (comm.view/send), all RBAC-gated + audited. Starting a
// thread emits a domain event that auto-creates a support follow-up task.
// NOTE: email/SMS are queued only — no real provider is contacted here.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, fmtDateTime, card } from '../../shared/ui/components.js';
import { commOverview, listThreads, getThread, createThread, postMessage, setThreadStatus, listNotifications, markNotification, listTemplates } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const CH_TONE = { in_app: 'blue', email: 'violet', sms: 'amber' };
const TABS = [{ value: 'threads', label: 'Threads' }, { value: 'inbox', label: 'Notifications' }, { value: 'templates', label: 'Templates' }];

export function renderComms(host) {
  let tab = 'threads';
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await commOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Open threads', value: String(n('open_threads')), sub: n('closed_threads') + ' closed', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Notifications', value: String(n('notif_queued')), sub: 'queued', accent: 'amber' }),
      statCard({ icon: 'refresh', label: 'Messages today', value: String(n('messages_today')), sub: 'sent/logged', accent: 'green' }),
      statCard({ icon: 'doc', label: 'Templates', value: String(n('templates')), sub: 'active', accent: 'violet' }),
    ]));
  }

  function header() {
    const actions = can('comm.send') ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: openCompose }, '+ New thread')] : null;
    return el('div', null, [
      sectionHead('Communications', 'Threads, notifications and message templates. New threads auto-create a support follow-up.', actions),
      kpiHost,
      toolbar([ segmented(TABS, tab, (v) => { tab = v; route(); }) ]),
    ]);
  }

  function route() { if (tab === 'inbox') loadInbox(); else if (tab === 'templates') loadTemplates(); else loadThreads(); }

  async function loadThreads() {
    showLoading(bodyHost, 'Loading threads…');
    let rows; try { rows = await listThreads({ limit: 300 }); } catch (e) { showError(bodyHost, humanizeError(e), loadThreads); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No conversations yet. Start a new thread.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Subject'), el('th', null, 'Linked to'), el('th', null, 'Channel'), el('th', null, 'Messages'), el('th', null, 'Status'), el('th', null, 'Updated'), el('th', null, '')])),
      el('tbody', null, rows.map(t => el('tr', { class: 'cc-row', onClick: () => openThread(t.id) }, [
        el('td', null, el('b', null, t.subject)),
        el('td', null, t.related_type && t.related_type !== 'none' ? t.related_type : '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (CH_TONE[t.channel] || 'gray') }, t.channel)),
        el('td', null, String(t.messages || 0)),
        el('td', null, statusPill(t.status)),
        el('td', null, fmtDateTime(t.last_message_at)),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  async function loadInbox() {
    showLoading(bodyHost, 'Loading notifications…');
    let rows; try { rows = await listNotifications({ limit: 200 }); } catch (e) { showError(bodyHost, humanizeError(e), loadInbox); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No notifications. Automation will post here as events fire.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Template'), el('th', null, 'To role'), el('th', null, 'Channel'), el('th', null, 'Status'), el('th', null, 'When'), el('th', null, '')])),
      el('tbody', null, rows.map(nt => el('tr', null, [
        el('td', null, el('b', null, nt.template_key)),
        el('td', null, nt.recipient_role || '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (CH_TONE[nt.channel] || 'gray') }, nt.channel)),
        el('td', null, statusPill(nt.status)),
        el('td', null, fmtDateTime(nt.created_at)),
        el('td', null, (can('comm.send') && nt.status === 'queued') ? el('button', { class: 'cc-chip-btn', onClick: async () => {
          try { await markNotification(nt.id, 'sent'); toast('Marked sent', 'success'); loadInbox(); loadKpis(); } catch (e) { toast(humanizeError(e), 'error'); }
        } }, 'Mark sent') : ''),
      ]))),
    ]));
  }

  async function loadTemplates() {
    showLoading(bodyHost, 'Loading templates…');
    let rows; try { rows = await listTemplates(); } catch (e) { showError(bodyHost, humanizeError(e), loadTemplates); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No templates.'); return; }
    mount(bodyHost, el('div', { class: 'cc-doclist' }, rows.map(t => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [
        el('b', null, [t.name, el('span', { class: 'cc-pill cc-pill-' + (CH_TONE[t.channel] || 'gray'), style: 'margin-left:8px' }, t.channel)]),
        el('div', { class: 'cc-sub' }, (t.subject ? t.subject + ' · ' : '') + (t.body || '')),
      ]),
    ]))));
  }

  function openCompose() {
    const f = { channel: 'in_app', relatedType: 'none' };
    const inp = (k, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph }); i.addEventListener('input', () => f[k] = i.value); return i; };
    const ta = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Message…' }); ta.addEventListener('input', () => f.body = ta.value);
    const ch = el('select', { class: 'cc-input' }, ['in_app', 'email', 'sms'].map(c => el('option', { value: c }, c))); ch.addEventListener('change', () => f.channel = ch.value);
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; if (!f.subject) { err.textContent = 'Subject is required.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Creating…';
      try { await createThread({ subject: f.subject, body: f.body || null, channel: f.channel });
        toast('Thread created · support task queued', 'success'); drawer.close(); loadThreads(); loadKpis();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Create thread'; }
    } }, 'Create thread');
    const drawer = openDrawer('New thread', el('div', { class: 'cc-form' }, [
      inp('subject', 'Subject'), el('label', { class: 'cc-sub' }, 'Channel'), ch, ta, err, submit,
    ]), { subtitle: 'Start a conversation (in-app / email / SMS queued)' });
  }

  async function openThread(id) {
    const drawer = openDrawer('Thread', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Conversation' });
    let t; try { t = await getThread(id); } catch (e) { mount(drawer.body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const msgs = (t.messages || []);
    const list = msgs.length ? el('div', { class: 'cc-doclist' }, msgs.map(m => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, m.direction), el('div', { class: 'cc-sub' }, (m.body || '') + ' · ' + fmtDateTime(m.created_at))]),
    ]))) : el('div', { class: 'cc-sub' }, 'No messages.');
    const input = el('input', { class: 'cc-input', placeholder: 'Reply…' });
    const addRow = can('comm.send') ? el('div', { class: 'cc-form-row' }, [ input,
      el('button', { class: 'lb-btn lb-btn-secondary', onClick: async (ev) => {
        if (!input.value) return; const b = ev.currentTarget; b.disabled = true; b.textContent = '…';
        try { await postMessage(id, input.value); toast('Sent', 'success'); openThread(id); loadKpis(); }
        catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = 'Send'; }
      } }, 'Send') ]) : '';
    const closeBtn = (can('comm.send') && t.status === 'open') ? el('button', { class: 'cc-chip-btn', onClick: async () => {
      try { await setThreadStatus(id, 'closed'); toast('Thread closed', 'success'); openThread(id); loadThreads(); loadKpis(); } catch (e) { toast(humanizeError(e), 'error'); }
    } }, 'Close thread') : '';
    mount(drawer.body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, t.subject), statusPill(t.status)]),
      card([ el('div', { class: 'cc-field' }, [el('span', null, 'Channel'), el('b', null, t.channel)]),
        el('div', { class: 'cc-field' }, [el('span', null, 'Linked to'), el('b', null, t.related_type !== 'none' ? t.related_type : '—')]) ], 'cc-fields'),
      el('div', { class: 'cc-status-row', style: 'margin-top:10px' }, [closeBtn]),
      el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Messages'),
      addRow, list,
    ]));
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), bodyHost]));
  loadKpis(); route();
}

export default renderComms;
