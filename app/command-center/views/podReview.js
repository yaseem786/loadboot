// podReview.js — Command Center: POD Document Review Queue (migration cul_pod_review_workflow).
// Lists pending trip PODs, opens a signed private preview, and lets an authorized reviewer
// Approve or Reject (rejection requires a reason). Approval triggers invoice-prep exactly once
// (server-side). RBAC: dispatch.manage / finance.manage / compliance.manage (server-enforced).
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, card, statusPill, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { podReviewQueue, podSignedRef, reviewPod } from '../../shared/api.js';
import { getClient } from '../../shared/supabaseClient.js';
import { humanizeError, toast } from '../../shared/errors.js';

export function renderPodReview(host) {
  let status = 'pending';
  const listHost = el('div');

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('POD Review Queue', 'Proof-of-delivery documents uploaded by carriers. Open a signed private preview, then approve or reject. A rejection needs a reason; an approval prepares the invoice exactly once.'),
    el('div', { class: 'cc-tabs', style: 'display:flex;gap:6px;margin-bottom:14px' },
      ['pending', 'approved', 'rejected'].map(s => el('button', {
        class: 'lb-btn lb-btn-sm' + (s === status ? ' lb-btn-primary' : ''),
        onClick: () => { status = s; load(); }
      }, s[0].toUpperCase() + s.slice(1)))),
    listHost,
  ]));

  load();

  async function load() {
    mount(listHost, el('div', { class: 'cc-sub' }, 'Loading…'));
    try {
      const rows = await podReviewQueue({ status });
      if (!rows || !rows.length) { mount(listHost, card(el('div', { class: 'cc-sub' }, 'No ' + status + ' PODs.'))); return; }
      const exportBtn = el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-bottom:12px', onClick: () => exportCsv(rows) }, '⬇ Export CSV');
      mount(listHost, el('div', null, [exportBtn, el('div', null, rows.map(row))]));
    } catch (e) { mount(listHost, card(el('div', { class: 'cc-sub' }, humanizeError(e)))); }
  }

  function exportCsv(rows) {
    const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const header = ['file_name', 'carrier', 'origin', 'destination', 'trip_id', 'status', 'uploaded_at', 'reviewed_at', 'review_note'];
    const lines = [header.join(',')].concat(rows.map(r => [r.file_name, r.carrier_name, r.origin, r.destination, r.trip_id, r.status, r.created_at, r.reviewed_at, r.review_note].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'loadboot-pod-' + status + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function row(r) {
    const route = (r.origin || r.destination) ? ((r.origin || '—') + ' → ' + (r.destination || '—')) : null;
    return card(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap' }, [
      el('div', null, [
        el('div', { style: 'font-weight:700' }, r.file_name || 'POD'),
        el('div', { class: 'cc-sub', style: 'font-size:.85rem' }, [
          r.carrier_name ? el('b', null, r.carrier_name) : null,
          r.carrier_name ? document.createTextNode(' · ') : null,
          document.createTextNode(route ? route + ' · ' : ''),
          document.createTextNode('Trip ' + String(r.trip_id).slice(0, 8)),
        ].filter(Boolean)),
        el('div', { class: 'cc-sub', style: 'font-size:.8rem' }, 'Uploaded ' + fmtDateTime(r.created_at) + (r.delivery_date ? ' · delivered ' + r.delivery_date : '')),
        r.review_note ? el('div', { class: 'cc-sub', style: 'font-size:.82rem;color:#b45309' }, 'Note: ' + r.review_note) : null,
      ].filter(Boolean)),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
        statusPill(r.status),
        el('button', { class: 'lb-btn lb-btn-sm ghost', onClick: () => preview(r) }, 'Preview'),
        r.status === 'pending' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => decide(r, 'approved') }, 'Approve') : null,
        r.status === 'pending' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => decide(r, 'rejected') }, 'Reject') : null,
      ]),
    ]));
  }

  async function preview(r) {
    try {
      const ref = await podSignedRef(r.id);
      const sb = await getClient();
      const { data, error } = await sb.storage.from(ref.bucket).createSignedUrl(ref.path, 120); // 2-min signed URL
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  function decide(r, decision) {
    if (decision === 'approved') return submit(r, 'approved', null);
    // rejection: require a reason
    const reason = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Reason for rejection (required) — the carrier sees this and can re-upload.' });
    openDrawer('Reject POD — ' + (r.file_name || ''), el('div', null, [
      el('label', { class: 'cc-field' }, [el('span', null, 'Rejection reason'), reason]),
      el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-top:12px', onClick: () => {
        if (!reason.value.trim()) { toast('A rejection reason is required.', 'error'); return; }
        submit(r, 'rejected', reason.value.trim());
      } }, 'Confirm rejection'),
    ]));
  }

  async function submit(r, decision, reason) {
    try {
      await reviewPod({ doc: r.id, decision, reason });
      toast('POD ' + decision + (decision === 'approved' ? ' — invoice prep queued.' : '.'), 'success');
      load();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }
}

export default renderPodReview;
