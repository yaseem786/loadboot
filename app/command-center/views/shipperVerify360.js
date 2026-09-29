// shipperVerify360.js — bl_ship_0491. Shipper 360 → "Two-lane verification".
// Staff see every section's answers (A–G), the free fraud signals (RDAP age, MX class, DMARC, SEC name collision,
// shared documents), the lane gates, signatures and locations. Staff can verify / reject / waive an item, start the
// INDEPENDENT call-back (a number the staff member found — never the one the shipper typed), mark a call-back
// failed (→ hold), and lift the new-shipper limits with a written reason. Staff never approve a carrier or a broker
// for a shipper — that choice is the shipper's (bl_ship_0492).
import { el } from '../../shared/ui/dom.js';
import { card, openDrawer } from '../../shared/ui/components.js';
import { shipperVerification, shipperCallbackStart, shipperCallbackFail, shipperLimitsLift, onboardingReviewItem } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { pill } from './partner360-kit.js';
import { registryBlock, openDocVerify, emailDomainBlock, openPlacesLookup } from './shipperRegistry360.js';  // bl_ship_0502/0503
import { playbookCard } from './shipperPlaybook360.js';  // bl_ship_0503

const SEC = { identity: 'A · Identity', billing: 'B · Billing & credit', agreements: 'C · Agreements', cargo: 'D · Cargo & liability', special: 'E · Special freight', facilities: 'F · Locations', acks: 'G · Acknowledgements' };
const stTone = (s) => (s === 'verified' || s === 'waived') ? 'green' : s === 'submitted' ? 'amber' : s === 'rejected' ? 'red' : s === 'unavailable' ? 'blue' : 'gray';
const when = (t) => t ? String(t).slice(0, 16).replace('T', ' ') : '—';
const show = (v) => v == null || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.map((x) => typeof x === 'object' ? Object.values(x).filter(Boolean).join(' / ') : x).join(', ') : '—') : typeof v === 'object' ? JSON.stringify(v) : String(v);

function dataTable(d) {
  if (!d || typeof d !== 'object') return null;
  const rows = Object.keys(d).filter((k) => k !== 'confirmed' && k !== 'text');
  const conf = Array.isArray(d.confirmed) && d.confirmed.length ? el('div', { class: 'cc-sub', style: 'margin-top:4px;color:#92400e' }, '⚠ Shipper confirmed after a warning: ' + d.confirmed.join(' | ')) : null;
  return el('div', null, [el('table', { class: 'cc-table', style: 'font-size:.8rem' }, el('tbody', null, rows.map((k) => el('tr', null, [el('td', { style: 'color:#64748b;width:38%' }, k.replace(/_/g, ' ')), el('td', null, show(d[k]))])))), conf]);
}

function ask(title, fields, onOk) {
  const inputs = fields.map((f) => f.options
    ? el('select', { class: 'lb-input' }, f.options.map(([v, t]) => el('option', { value: v }, t)))
    : el(f.area ? 'textarea' : 'input', { class: 'lb-input', placeholder: f.ph || '' }));
  inputs.forEach((x, i) => { if (fields[i].value != null) x.value = fields[i].value; });
  const err = el('div', { class: 'cc-sub', style: 'color:#b91c1c;margin-top:6px' });
  const go = el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-top:12px' }, 'Save');
  const body = el('div', null, [...fields.flatMap((f, i) => [el('label', { class: 'cc-sub', style: 'display:block;font-weight:700;margin-top:10px' }, f.label), inputs[i], f.hint ? el('div', { class: 'cc-sub', style: 'font-size:.76rem' }, f.hint) : null]), err, go]);
  const dlg = openDrawer(title, body, { size: 'sm' });
  go.onclick = async () => { go.disabled = true; try { await onOk(inputs.map((x) => x.value.trim())); dlg.close(); } catch (e) { err.textContent = humanizeError(e); go.disabled = false; } };
}

export function shipperVerifyCard(ctx) {
  const host = card([el('div', { class: 'cc-sub' }, 'Loading two-lane verification…')]);
  const orgId = ctx.orgId;
  const load = async () => {
    let v; try { v = await shipperVerification(orgId); } catch (e) { host.replaceChildren(el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
    const t = v.trust || {}; const cb = v.callback || {};
    const lane = (name, g) => el('div', { style: 'flex:1;min-width:220px;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px' }, [
      el('b', null, name + ' '), g.ok ? pill('green', 'open') : g.hold ? pill('red', 'hold') : pill('amber', (g.missing || []).length + ' left'),
      (g.missing || []).length ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, (g.missing || []).map((m) => m.label).join(' · ')) : null]);
    const signals = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' }, [
      pill(t.free_mail ? 'amber' : 'green', t.free_mail ? 'free-mail signup' : 'company domain ' + (t.domain || '—')),
      pill(t.site_ok ? 'green' : 'amber', t.site_ok ? 'website ✓' : 'no website'),
      t.domain_created_at ? pill((Date.now() - Date.parse(t.domain_created_at)) / 864e5 < 180 ? 'red' : 'green', 'domain registered ' + String(t.domain_created_at).slice(0, 10)) : pill('gray', 'domain age unknown'),
      t.mx_class ? pill(t.mx_class === 'corporate' ? 'green' : t.mx_class === 'budget_host' ? 'amber' : 'gray', 'mail: ' + t.mx_class.replace('_', ' ')) : null,
      t.dmarc ? pill(t.dmarc === 'reject' || t.dmarc === 'quarantine' ? 'green' : 'amber', 'DMARC ' + t.dmarc.replace('_', '=')) : null,
      t.name_collision ? pill('red', 'name matches an SEC company' + (t.sec_names && t.sec_names[0] ? ': ' + t.sec_names[0] : '')) : null,
      (t.shared_doc_orgs || []).length ? pill('red', 'document shared with ' + t.shared_doc_orgs.length + ' other account(s)') : null,
    ].filter(Boolean));
    const reasons = t.needs_human ? el('div', { class: 'p360-warn', style: 'margin-top:8px' }, ['⚠ Needs a human: ', el('b', null, (t.reasons || []).join(' · ')), ' — do the independent call-back before anything reaches carriers.']) : null;
    const startCallback = (pre) => ask('Start independent call-back', [
      { label: 'Company phone you found', ph: '(555) 555-0100', value: pre && pre.phone },
      { label: 'Where you found it', options: [['secretary_of_state', 'Secretary of State record'], ['company_website', 'Company website'], ['google_business', 'Google Business profile'], ['sec_edgar', 'SEC EDGAR filing'], ['bbb', 'BBB'], ['dnb', 'Dun & Bradstreet'], ['other_public', 'Other public source (link required)']], value: pre ? 'google_business' : null },
      { label: 'Link to the source', ph: 'https://…', hint: 'Recorded with the call. Required for "other public source".', value: pre && pre.maps_url },
    ], async ([phone, source, url]) => { const r = await shipperCallbackStart(orgId, phone, source, url || null); toast('Calling ' + (r && r.to) + ' — the code goes to whoever answers.', 'success'); load(); });
    const cbBlock = el('div', { style: 'margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px' }, [
      el('b', null, 'Independent call-back '), cb.status === 'confirmed' ? pill('green', 'confirmed ' + when(cb.at)) : cb.status === 'calling' ? pill('blue', 'code call placed ' + when(cb.at)) : cb.status === 'failed' ? pill('red', 'failed — on hold') : pill('gray', 'not started'),
      cb.phone ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Called ' + cb.phone + ' · source: ' + (cb.source || '—') + (cb.source_url ? ' · ' + cb.source_url : '')) : null,
      el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Find the company\'s number yourself — Secretary of State record, the company\'s own website, Google Business, SEC filing, BBB. Never use the number the shipper typed; the system refuses it.'),
      ctx.manage ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, [
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => startCallback() }, '📞 Start call-back'),
        el('button', { class: 'lb-btn lb-btn-sm', onClick: () => openPlacesLookup(ctx, (p) => startCallback(p)) }, '🔎 Find phone on Google'),
        cb.status !== 'failed' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => ask('Call-back did NOT confirm the company', [{ label: 'What did the company say?', area: true, hint: 'The shipper goes on hold: nothing reaches carriers or brokers.' }],
          async ([note]) => { await shipperCallbackFail(orgId, note); toast('Shipper put on hold.', 'success'); load(); }) }, '⛔ Call-back failed → hold') : null,
      ].filter(Boolean)) : null,
    ]);
    const limits = el('div', { class: 'cc-sub', style: 'margin-top:10px' }, [
      v.graduated ? '✓ New-shipper limits lifted.' : 'New-shipper limits apply (open loads + cargo value cap) until 3 carrier-confirmed paid loads. ',
      (!v.graduated && ctx.manage) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => ask('Lift new-shipper limits', [{ label: 'Why (recorded)', area: true }], async ([why]) => { await shipperLimitsLift(orgId, why); toast('Limits lifted.', 'success'); load(); }) }, 'Lift limits') : null,
    ]);
    const bySec = {};
    (v.items || []).filter((i) => i.active).forEach((i) => { (bySec[i.section] = bySec[i.section] || []).push(i); });
    const secNodes = Object.keys(SEC).filter((k) => bySec[k]).map((k) => el('details', { style: 'margin-top:10px;border:1px solid #e2e8f0;border-radius:12px;padding:8px 12px' }, [
      el('summary', { style: 'cursor:pointer;font-weight:800' }, SEC[k] + ' — ' + bySec[k].filter((i) => i.status === 'verified' || i.status === 'waived').length + '/' + bySec[k].length),
      ...bySec[k].map((i) => el('div', { style: 'border-top:1px solid #f1f5f9;padding:8px 0' }, [
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [el('b', null, i.label), pill(stTone(i.status), i.status), i.file_path ? el('span', { class: 'cc-sub' }, '📎 ' + i.file_path.split('/').pop()) : null,
          (ctx.manage && ['form', 'upload'].includes(i.type) && i.status === 'submitted') ? el('span', { style: 'margin-left:auto;display:flex;gap:6px' }, [
            ['ein_letter', 'address_proof'].includes(i.key)
              ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => openDocVerify(ctx, v, i, load) }, 'Verify vs registry')
              : el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async () => { try { await onboardingReviewItem(orgId, i.key, 'verify', null); toast(i.label + ' verified.', 'success'); load(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Verify'),
            el('button', { class: 'lb-btn lb-btn-sm', onClick: () => ask('Reject — ' + i.label, [{ label: 'What must the shipper fix? (they read this)', area: true }], async ([n]) => { await onboardingReviewItem(orgId, i.key, 'reject', n); toast('Rejected — shipper notified.', 'success'); load(); }) }, 'Reject'),
          ]) : null]),
        i.key === 'legal_entity' && i.data ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Compared with the state record on the State registry check card above.') : null,
        dataTable(i.data),
        i.note ? el('div', { class: 'cc-sub', style: 'color:#b91c1c' }, 'Note: ' + i.note) : null,
      ])),
    ]));
    const sigs = (v.signatures || []).length ? el('div', { class: 'cc-sub', style: 'margin-top:10px' }, 'Signed: ' + v.signatures.map((s) => s.kind + ' v' + s.version + ' by ' + s.signer + ' (' + s.title + ') ' + when(s.signed_at) + (s.ip ? ' · IP ' + s.ip : '')).join(' | ')) : null;
    host.replaceChildren(
      el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [el('h3', { style: 'margin:0' }, 'Two-lane verification'), pill(v.stage === 'hold' ? 'red' : v.stage === 'new' ? 'gray' : 'green', 'stage: ' + String(v.stage).replace('_', ' '))]),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px' }, [lane('Carriers (direct)', v.direct || {}), lane('Brokers (tender)', v.broker || {})]),
      playbookCard(ctx, v), signals, reasons, registryBlock(ctx, v, load), emailDomainBlock(ctx, v, load), cbBlock, limits, ...secNodes, sigs,
      el('div', { class: 'cc-sub', style: 'margin-top:10px' }, 'Staff never choose or approve a carrier or broker for a shipper — the shipper does. Staff can decline or block for fraud or safety.'),
    );
  };
  load();
  return host;
}
