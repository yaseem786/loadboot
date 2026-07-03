// documents.js — Document review queue. Read cc_list_documents; approve/reject via
// admin_review_document (documents.review, scope-checked + audited server-side).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, toolbar, segmented, statusPill, openDrawer, fmtDate, card } from '../../shared/ui/components.js';
import { getDocumentsQueue, reviewDocument } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { signedDocumentUrl } from '../../shared/storage.js';

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

    const previewBox = el('div', { style: 'margin:12px 0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#0b1220;min-height:130px;display:flex;align-items:center;justify-content:center' },
      el('div', { class: 'cc-sub', style: 'color:#94a3b8;padding:26px' }, 'Loading preview…'));
    const openBtn = el('a', { class: 'lb-btn lb-btn-secondary', target: '_blank', rel: 'noopener', style: 'pointer-events:none;opacity:.5' }, 'Open in new tab');
    const dlBtn = el('a', { class: 'lb-btn lb-btn-secondary', style: 'pointer-events:none;opacity:.5' }, '\u2b07 Download');
    (async () => {
      if (!d.file_path) { mount(previewBox, el('div', { class: 'cc-sub', style: 'color:#94a3b8;padding:26px' }, 'No file attached to this record.')); return; }
      let url; try { url = await signedDocumentUrl(d.file_path, 600); }
      catch (e) { mount(previewBox, el('div', { class: 'cc-sub', style: 'color:#fca5a5;padding:26px' }, 'Could not load preview: ' + humanizeError(e))); return; }
      const ext = String(d.file_name || d.file_path).split('.').pop().toLowerCase();
      let viewer;
      if (ext === 'pdf') viewer = el('iframe', { src: url, style: 'width:100%;height:440px;border:0;background:#fff' });
      else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) viewer = el('img', { src: url, style: 'max-width:100%;max-height:480px;display:block;margin:0 auto' });
      else viewer = el('div', { class: 'cc-sub', style: 'color:#cbd5e1;padding:26px;text-align:center' }, '.' + ext + ' file — use Download or Open to view.');
      mount(previewBox, viewer);
      openBtn.href = url; openBtn.style.pointerEvents = 'auto'; openBtn.style.opacity = '1';
      dlBtn.href = url + (url.indexOf('?') > -1 ? '&' : '?') + 'download=' + encodeURIComponent(d.file_name || 'document');
      dlBtn.style.pointerEvents = 'auto'; dlBtn.style.opacity = '1';
    })();
    const drawer = openDrawer('Document review', el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, d.file_name || 'document'), statusPill(d.status)]),
      card([
        el('div', { class: 'cc-field' }, [el('span', null, 'Carrier'), el('b', null, d.company || '—')]),
        el('div', { class: 'cc-field' }, [el('span', null, 'Type'), el('b', null, d.type || '—')]),
        el('div', { class: 'cc-field' }, [el('span', null, 'Submitted'), el('b', null, fmtDate(d.created_at))]),
      ], 'cc-fields'),
      el('label', { class: 'cc-card-title', style: 'margin-top:16px;display:block' }, 'Document'),
      previewBox,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [openBtn, dlBtn]),
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
