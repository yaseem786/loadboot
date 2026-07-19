// support.js — Control Tower Wave D: Support / tickets.
// A triage inbox for support requests: priority-ordered list, create, assign, and resolve.
// Creating a ticket fires the support follow-up automation. Reads/writes via cc_*ticket*
// RPCs (support.view / support.manage), RBAC-gated + audited.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, searchBox, segmented, card, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { supportOverview, listTickets, getTicket, createTicket, setTicketStatus, aiAssist, sendEmail, invoiceLookup } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const COLS = [
  { key: 'ref', label: 'Ref' }, { key: 'subject', label: 'Subject' }, { key: 'requester_name', label: 'Requester' },
  { key: 'requester_email', label: 'Email' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' },
  { key: 'created_at', label: 'Opened', fmt: fmtDateTime },
];

export function renderSupport(host, focusId) {
  let status = null, search = null, rows = [];
  const manage = can('support.manage');
  if (focusId) setTimeout(() => openTicket(focusId), 350); // deep-link
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Support', 'Customer and carrier support tickets — triage, assign and resolve. New tickets auto-create a follow-up task.',
      el('div', { class: 'cc-head-actions', id: 'sp-actions' })),
    el('div', { id: 'sp-kpis' }),
    el('div', { class: 'cc-toolbar', id: 'sp-tools' }),
    el('div', { id: 'sp-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const kpiHost = host.querySelector('#sp-kpis');
  const actionHost = host.querySelector('#sp-actions');
  const toolsHost = host.querySelector('#sp-tools');
  const body = host.querySelector('#sp-body');

  mount(actionHost, el('div', { class: 'cc-seg' }, [
    el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV('loadboot-tickets', COLS, rows) }, 'CSV'),
    el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel('loadboot-tickets', COLS, rows, 'Tickets') }, 'Excel'),
    el('button', { class: 'cc-seg-btn', onClick: () => printTable('Support tickets', 'LoadBoot', COLS, rows) }, 'PDF'),
    manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: ticketForm }, '+ Ticket') : '',
  ]));
  mount(toolsHost, [
    segmented([{ value: null, label: 'All' }, { value: 'open', label: 'Open' }, { value: 'pending', label: 'Pending' }, { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }], status, (v) => { status = v; load(); }),
    searchBox('Search subject, email, ref…', (q) => { search = q || null; load(); }),
  ]);

  loadKpis();
  load();

  async function loadKpis() {
    let ov; try { ov = await supportOverview(); } catch (_) { return; }
    const n = (k) => Number((ov && ov[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'bell', label: 'Open', value: String(n('open')), sub: 'awaiting response', accent: 'blue' }),
      statCard({ icon: 'refresh', label: 'Pending', value: String(n('pending')), sub: 'in progress', accent: 'amber' }),
      statCard({ icon: 'check', label: 'Resolved', value: String(n('resolved')), sub: 'closed out', accent: 'green' }),
      statCard({ icon: 'shield', label: 'Urgent', value: String(n('urgent')), sub: 'need attention now', accent: 'red' }),
    ]));
  }

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    try { rows = await listTickets({ status, search }); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No tickets in this view.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Ref'), el('th', null, 'Subject'), el('th', null, 'Requester'), el('th', null, 'Priority'), el('th', null, 'Status'), el('th', null, 'Opened')])),
      el('tbody', null, rows.map(t => el('tr', { class: 'cc-row-click', onClick: () => openTicket(t.id) }, [
        el('td', null, el('b', null, t.ref)), el('td', null, t.subject), el('td', null, t.requester_name || t.requester_email || '—'),
        el('td', null, statusPill(t.priority)), el('td', null, statusPill(t.status)), el('td', null, fmtDateTime(t.created_at)),
      ]))),
    ])));
  }

  async function openTicket(id) {
    let t; try { t = await getTicket(id); } catch (e) { alert(humanizeError(e)); return; }
    const actions = el('div', { class: 'cc-drawer-actions' });
    if (manage) {
      const setS = async (s) => { try { await setTicketStatus(id, s); } catch (e) { alert(humanizeError(e)); return; } document.getElementById('cc-drawer-root')?.remove(); loadKpis(); load(); };
      ['open', 'pending', 'resolved', 'closed'].filter(s => s !== t.status).forEach(s => actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => setS(s) }, s.charAt(0).toUpperCase() + s.slice(1))));
    }
    // AI-drafted reply + send email to the requester (Gemini + Resend)
    let replySection = '';
    if (manage && t.requester_email) {
      const replyBox = el('textarea', { class: 'cc-input', rows: '5', placeholder: 'Write a reply, or use “Draft with AI”…' });
      const note = el('div', { class: 'cc-sub', style: 'margin-top:6px' });
      const aiBtn = el('button', { class: 'lb-btn lb-btn-secondary lb-btn-sm', onClick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = '✨ Drafting…'; note.textContent = '';
        try { const r = await aiAssist('support_reply', { subject: t.subject, body: t.body }); replyBox.value = (r && r.text) || ''; }
        catch (e) { note.style.color = '#dc2626'; note.textContent = humanizeError(e); }
        b.disabled = false; b.textContent = '✨ Draft with AI';
      } }, '✨ Draft with AI');
      const sendBtn = el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: async (ev) => {
        const b = ev.currentTarget; const txt = replyBox.value.trim();
        if (!txt) { note.style.color = '#dc2626'; note.textContent = 'Write a reply first.'; return; }
        b.disabled = true; b.textContent = 'Sending…'; note.textContent = '';
        try {
          await sendEmail({ to: t.requester_email, subject: 'Re: ' + t.subject, text: txt });
          note.style.color = '#16a34a'; note.textContent = '✓ Email sent to ' + t.requester_email;
          try { await setTicketStatus(id, 'pending'); } catch (_) {}
        } catch (e) { note.style.color = '#dc2626'; note.textContent = humanizeError(e); }
        b.disabled = false; b.textContent = 'Send email reply';
      } }, 'Send email reply');
      replySection = el('div', { style: 'margin-top:14px' }, [
        el('h4', { class: 'cc-card-title' }, 'Reply'),
        replyBox, note,
        el('div', { class: 'cc-drawer-actions', style: 'margin-top:8px' }, [aiBtn, sendBtn]),
      ]);
    }
    openDrawer(t.ref + ' · ' + t.subject, el('div', null, [
      kv('Status', t.status), kv('Priority', t.priority), kv('Category', t.category),
      kv('Requester', t.requester_name), kv('Email', t.requester_email), kv('Opened', fmtDateTime(t.created_at)),
      t.related_type ? kv('Related', t.related_type + ' ' + (t.related_id || '')) : '',
      (() => { // auto-link invoice references mentioned in the ticket (e.g. "Invoice #INV-204")
        const mtxt = ((t.subject || '') + ' ' + (t.body || '')).match(/INV[-\s]?\d+/i);
        if (!mtxt) return '';
        const no = mtxt[0].replace(/\s+/g, '').toUpperCase();
        const host9 = el('div', { style: 'margin-top:10px' });
        (async () => {
          let r; try { r = await invoiceLookup(no); } catch (_) { return; }
          if (r && r.found) mount(host9, el('a', { class: 'lb-btn lb-btn-secondary lb-btn-sm', href: '#/finance?id=' + r.id, style: 'text-decoration:none' },
            '🧾 Open ' + r.invoice_no + ' — $' + r.net + ' (' + r.status + ') →'));
          else mount(host9, el('div', { class: 'cc-sub' }, '🧾 ' + no + ' — no matching invoice found in Finance.'));
        })();
        return host9;
      })(),
      el('div', { class: 'cc-kv', style: 'align-items:flex-start' }, [el('span', { class: 'cc-kv-k' }, 'Detail'), el('span', { class: 'cc-kv-v', style: 'white-space:pre-wrap' }, t.body || '—')]),
      actions.childNodes.length ? el('div', { style: 'margin-top:12px' }, actions) : '',
      replySection,
    ]), { subtitle: 'Support ticket' });
  }

  function ticketForm() {
    const fields = {};
    const input = (key, label, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '' }); fields[key] = i; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const bodyInput = el('textarea', { class: 'cc-input', rows: '4' });
    const prioSel = el('select', { class: 'cc-input' }, ['low', 'normal', 'high', 'urgent'].map(s => el('option', { value: s, selected: s === 'normal' ? true : null }, s)));
    const form = el('div', null, [
      input('subject', 'Subject', 'Short summary'),
      input('requester_name', 'Requester name'), input('requester_email', 'Requester email'),
      input('category', 'Category (e.g. billing, onboarding)'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Priority'), prioSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Details'), bodyInput]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, 'Create ticket')]),
    ]);
    openDrawer('New ticket', form, { subtitle: 'Log a support request' });

    async function save() {
      const subject = fields.subject.value.trim();
      if (!subject) { alert('Subject is required.'); return; }
      try { await createTicket({ subject, body: bodyInput.value.trim() || null, requesterName: fields.requester_name.value.trim() || null, requesterEmail: fields.requester_email.value.trim() || null, category: fields.category.value.trim() || null, priority: prioSel.value }); }
      catch (e) { alert(humanizeError(e)); return; }
      document.getElementById('cc-drawer-root')?.remove(); loadKpis(); load();
    }
  }
}

function kv(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '—' : String(v))]); }

export default renderSupport;
