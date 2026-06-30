// documents.js — Document review queue. Read cc_list_documents; approve/reject via
// admin_review_document (documents.review, scope-checked + audited server-side).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, toolbar, segmented, statusPill, openDrawer, fmtDate, card } from '../../shared/ui/components.js';
import { getDocumentsQueue, reviewDocument } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STATUSES = [
  { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }, { value: '', label: 'All' },
];

export function renderDocuments(host) {
  let state = { status: 'pending' };
  const listHost = el('div', { class: 'cc-table-wrap' });

  async function load() {
    showLoading(listHost, 'Loading documents…');
    let rows;
    try { rows = await getDocumentsQueue({ status: state.status || null, limit: 200 }); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No documents in this queue.'); return; }
    const table = el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [
        el('th', null, 'Document'), el('th', null, 'Carrier'), el('th', null, 'Type'),
        el('th', null, 'Submitted'), el('th', null, 'Status'), el('th', null, ''),
      ])),
      el('tbody', null, rows.map(d => el('tr', { class: 'cc-row', onClick: () => openDoc(d) }, [
        el('td', null, el('b', null, d.file_name || 'document')),
        el('td', null, d.company || '—'),
        el('td', null, d.type || '—'),
        el('td', null, fmtDate(d.created_at)),
        el('td', null, statusPill(d.status)),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]);
    mount(listHost, table);
  }

  function openDoc(d) {
    const note = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Optional review note (kept on the document)…' });
    const actions = el('div', { class: 'cc-drawer-actions' });
    function decide(decision, kind, label) {
      return el('button', { class: 'lb-btn lb-btn-' + kind, onClick: async (ev) => {
        const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Saving…';
        try { await reviewDocument(d.id, decision, note.value || null); toast('Document ' + decision, 'success'); drawer.close(); load(); }
        catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; btn.textContent = label; }
      } }, label);
    }
    if (can('documents.review')) { actions.appendChild(decide('approved', 'primary', 'Approve')); actions.appendChild(decide('rejected', 'secondary', 'Reject')); }
    else actions.appendChild(el('p', { class: 'cc-sub' }, 'You have view-only access to documents.'));

    const drawer = openDrawer('Document review', el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, d.file_name || 'document'), statusPill(d.status)]),
      card([
        el('div', { class: 'cc-field' }, [el('span', null, 'Carrier'), el('b', null, d.company || '—')]),
        el('div', { class: 'cc-field' }, [el('span', null, 'Type'), el('b', null, d.type || '—')]),
        el('div', { class: 'cc-field' }, [el('span', null, 'Submitted'), el('b', null, fmtDate(d.created_at))]),
      ], 'cc-fields'),
      can('documents.review') ? el('label', { class: 'cc-card-title', style: 'margin-top:16px;display:block' }, 'Decision') : '',
      can('documents.review') ? note : '',
      actions,
    ]), { subtitle: d.company || '' });
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Documents', 'Review carrier compliance documents.'),
    toolbar([segmented(STATUSES, state.status, (v) => { state.status = v; load(); })]),
    listHost,
  ]));
  load();
}

export default renderDocuments;
