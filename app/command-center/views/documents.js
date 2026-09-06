// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// audit F31 2026-09-05: AI pre-check column + drawer card (cc_list_documents now returns ai_verdict, bl_cmp_0325b).
// documents.js — Document review queue. Read cc_list_documents; approve/reject via
// admin_review_document (documents.review, scope-checked + audited server-side).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, toolbar, segmented, statusPill, openDrawer, fmtDate, card } from '../../shared/ui/components.js';
import { getDocumentsQueue, reviewDocument } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { coiCoverageCard } from './coiCoverage.js';
import { staffUploadCard } from './staffUpload.js';

// audit F31 (bl_cmp_0325): the carrier portal's AI pre-check verdict now rides on the document row. It is ADVISORY —
// recorded_by='carrier-client' means the carrier's own browser sent it (they can only hurt themselves with it),
// 'doc-precheck'/'staff' means a server or a reviewer recorded it. Staff decision stays final.
function aiPill(v) {
  if (!v || !v.verdict) return el('span', { class: 'cc-sub', style: 'color:#94a3b8' }, '—');
  const tone = v.verdict === 'reject' ? '#ef4444' : v.verdict === 'warning' ? '#f59e0b' : v.verdict === 'pass' ? '#16a34a' : '#64748b';
  const label = v.verdict === 'reject' ? 'AI: reject' : v.verdict === 'warning' ? 'AI: warning' : v.verdict === 'pass' ? 'AI: pass' : 'AI: ' + v.verdict;
  const first = (v.issues && v.issues[0] && v.issues[0].problem) ? String(v.issues[0].problem).slice(0, 70) : '';
  return el('span', { title: (v.summary || '') + (v.overridden ? ' — carrier saw the reject and uploaded anyway.' : ''), style: 'display:inline-flex;flex-direction:column;gap:2px' }, [
    el('span', { style: 'font-weight:800;font-size:.78rem;color:' + tone }, label + (v.overridden ? ' ⚠' : '')),
    first ? el('span', { class: 'cc-sub', style: 'font-size:.72rem;color:#94a3b8' }, first) : '',
  ]);
}
function aiCard(v) {
  if (!v || !v.verdict) return '';
  const src = v.recorded_by === 'carrier-client' ? 'carrier-side pre-check (advisory)' : v.recorded_by === 'doc-precheck' ? 'server pre-check' : (v.recorded_by || 'pre-check');
  const tone = v.verdict === 'reject' ? '#ef4444' : v.verdict === 'warning' ? '#f59e0b' : '#16a34a';
  return card([
    el('div', { class: 'cc-field' }, [el('span', null, 'AI pre-check'), el('b', { style: 'color:' + tone }, String(v.verdict).toUpperCase() + (v.overridden ? ' — carrier uploaded anyway' : ''))]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Source'), el('b', null, src + (v.recorded_at ? ' · ' + fmtDate(v.recorded_at) : ''))]),
    v.summary ? el('p', { class: 'cc-sub', style: 'margin:6px 0 0' }, v.summary) : '',
    el('div', null, (v.issues || []).slice(0, 6).map(i => el('div', { style: 'border-left:3px solid ' + (i.severity === 'reject' ? '#ef4444' : '#f59e0b') + ';padding:6px 10px;margin:6px 0;border-radius:0 8px 8px 0;background:rgba(148,163,184,.08)' }, [
      el('div', { style: 'font-weight:700;font-size:.85rem' }, i.problem || ''),
      i.fix ? el('div', { class: 'cc-sub', style: 'font-size:.78rem;white-space:pre-line' }, 'Fix: ' + i.fix) : '',
    ]))),
    v.fields && (v.fields.certificate_holder || v.fields.expiry_date || v.fields.auto_liability || v.fields.cargo_limit)
      ? el('div', { class: 'cc-sub', style: 'font-size:.78rem;margin-top:6px' }, ['Read by AI: ',
          v.fields.certificate_holder ? 'holder "' + v.fields.certificate_holder + '" · ' : '',
          v.fields.auto_liability ? 'auto ' + v.fields.auto_liability + ' · ' : '',
          v.fields.cargo_limit ? 'cargo ' + v.fields.cargo_limit + ' · ' : '',
          v.fields.expiry_date ? 'exp ' + v.fields.expiry_date : ''].join(''))
      : '',
  ], 'cc-fields');
}

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
        el('th', null, 'Submitted'), el('th', null, 'AI pre-check'), el('th', null, 'Status'), el('th', null, ''),
      ])),
      el('tbody', null, rows.map(d => el('tr', { class: 'cc-row', onClick: () => openDoc(d) }, [
        el('td', null, el('b', null, d.file_name || 'document')),
        el('td', null, d.company || '—'),
        el('td', null, d.type || '—'),
        el('td', null, fmtDate(d.created_at)),
        el('td', null, aiPill(d.ai_verdict)),
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
      aiCard(d.ai_verdict),
      el('label', { class: 'cc-card-title', style: 'margin-top:16px;display:block' }, 'Document'),
      previewBox,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [openBtn, dlBtn]),
      // Insurance only: record what the policy covers while the certificate is on screen.
      // Renders nothing for other document types (bl_coi_0234).
      coiCoverageCard(d, load),
      // A carrier who emailed us a document instead of uploading it (bl_doc_0248).
      staffUploadCard({ id: d.carrier_id, name: d.company }, load),
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
