// staffUpload.js — a document the carrier sent us by email, put onto their file.
//
// We tell carriers to email documents when the portal is in their way, and until now
// there was nowhere for those files to go: the Documents queue reviews what carriers
// upload, and staff could not upload anything at all. So a carrier who did exactly what we
// asked ended up worse off than one who fought the portal.
//
// The file goes into the CARRIER's storage folder, not ours, so they can open their own
// paperwork afterwards. And it is recorded as staff-uploaded with where it came from —
// a document we assert arrived from someone is weaker evidence than one they uploaded
// themselves, and the record should say so rather than quietly look identical.
// Backend: cc_staff_upload_document / cc_document_provenance — bl_doc_0248.
import { el, mount } from '../../shared/ui/dom.js';
import { staffUploadDocument } from '../../shared/api.js';
import { uploadDocumentForCarrier } from '../../shared/storage.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const TYPES = [
  ['insurance', 'Certificate of insurance'],
  ['authority', 'Operating authority'],
  ['w9', 'W-9'],
  ['bank_check', 'Bank verification (voided check / letter)'],
  ['noa', 'Factoring NOA'],
  ['mcs150', 'MCS-150'],
  ['safety', 'FMCSA safety rating'],
  ['hazmat_reg', 'PHMSA hazmat registration'],
  ['hazmat_h', 'CDL hazmat endorsement'],
  ['hazmat_coi', 'Hazmat insurance COI'],
  ['other', 'Other'],
];
const SOURCES = [['email', 'Email'], ['phone', 'Phone / WhatsApp'], ['post', 'Post'], ['in_person', 'In person']];

const L = 'font-size:12px;font-weight:700;color:#475569;display:block;margin:12px 0 4px';

/**
 * @param {{id:string,name:string}} carrier  carrier USER id (documents.carrier_id) + display name
 * @param {Function} onDone  called after a successful upload
 */
export function staffUploadCard(carrier, onDone) {
  const host = el('div');
  if (!carrier || !carrier.id) return host;
  if (!can('documents.review')) return host;

  const type = el('select', { class: 'cc-input' }, TYPES.map(([v, l]) => el('option', { value: v }, l)));
  const source = el('select', { class: 'cc-input' }, SOURCES.map(([v, l]) => el('option', { value: v }, l)));
  const note = el('input', { class: 'cc-input', type: 'text', placeholder: 'Where it came from — e.g. "replied to the Monday chase, 20 Aug"' });
  const file = el('input', { class: 'cc-input', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic' });
  const msg = el('div', { style: 'font-size:12px;margin-top:10px' });

  const go = el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-top:14px', onClick: async () => {
    const f = file.files && file.files[0];
    msg.textContent = '';
    if (!f) { msg.style.color = '#b91c1c'; msg.textContent = 'Choose the file first.'; return; }
    go.disabled = true; go.textContent = 'Uploading…';
    try {
      const up = await uploadDocumentForCarrier(f, type.value, carrier.id);
      await staffUploadDocument({
        carrier: carrier.id, type: type.value, path: up.path, fileName: up.fileName,
        source: source.value, sourceNote: note.value || null,
      });
      msg.style.color = '#15803d';
      msg.textContent = 'On their file and in the review queue. It still needs approving like any other document.';
      toast('Uploaded for ' + (carrier.name || 'carrier'), 'success');
      file.value = ''; note.value = '';
      if (typeof onDone === 'function') onDone();
    } catch (e) {
      msg.style.color = '#b91c1c'; msg.textContent = humanizeError(e);
    }
    go.disabled = false; go.textContent = 'Put it on their file';
  } }, 'Put it on their file');

  mount(host, el('div', { style: 'border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;background:#f8fafc' }, [
    el('div', { style: 'font-weight:800;font-size:.95rem;color:#0f172a' }, 'Document sent to us directly'),
    el('div', { style: 'font-size:.82rem;color:#64748b;line-height:1.55;margin-top:2px' },
      'For a file ' + (carrier.name || 'this carrier') + ' emailed or messaged instead of uploading. It lands in their own folder so they can still open it, '
      + 'and it is recorded as sent to us rather than uploaded by them.'),
    el('label', { style: L }, 'What is it?'), type,
    el('label', { style: L }, 'How did it reach us?'), source,
    el('label', { style: L }, 'Note for the record'), note,
    el('label', { style: L }, 'File'), file,
    go, msg,
  ]));
  return host;
}

export default staffUploadCard;
