// shipperRegistry360.js — bl_ship_0502. The staff "State registry check" card inside Shipper 360 → Two-lane verification.
// Staff pull the company's record from the state registry THEMSELVES (open data pre-fill where the state publishes it,
// otherwise the Secretary of State search link), attach a screenshot and save. The server compares the record with the
// shipper's answers and refuses Verify while a hard check fails. EIN letter / address proof verify only against it, and a
// shipper whose name matches an SEC company needs its email domain approved here.
import { el } from '../../shared/ui/dom.js';
import { openDrawer } from '../../shared/ui/components.js';
import { shipperRegistryCheck, shipperDocVerify, shipperEmailDomainApprove, shipperPlacesLookup, onboardingReviewItem } from '../../shared/api.js';
import { uploadDocument, signedDocumentUrl } from '../../shared/storage.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { pill } from './partner360-kit.js';
import { canPrefill, fetchRegistry } from './registry-prefill.js';

const NASS = 'https://www.nass.org/business-services/corporate-registration';
const STATUSES = [['active', 'Active / good standing'], ['inactive', 'Inactive'], ['suspended', 'Suspended / delinquent'], ['dissolved', 'Dissolved / cancelled'], ['revoked', 'Revoked'], ['not_found', 'Not found in the registry']];
const VIA = [['', '— signer is listed in the registry —'], ['callback', 'Confirmed on the independent call-back'], ['registry_domain_email', 'Email from a domain the registry / official site lists'], ['postal_code', 'Code posted to the registry address']];
const CHECKS = [['state_ok', 'State of formation'], ['number_ok', 'Entity number'], ['name_ok', 'Legal name'], ['address_ok', 'Business address'], ['signer_ok', 'Signer is a manager / officer'], ['active', 'Status active']];
const itemData = (v, key) => ((v.items || []).find((i) => i.key === key) || {}).data || {};
const lbl = (t) => el('label', { class: 'cc-sub', style: 'display:block;font-weight:700;margin-top:10px' }, t);
const input = (value, ph, type) => el('input', { class: 'lb-input', value: value || '', placeholder: ph || '', type: type || 'text' });
const select = (opts, value) => { const s = el('select', { class: 'lb-input' }, opts.map(([k, t]) => el('option', { value: k }, t))); s.value = value || opts[0][0]; return s; };
const area = (value, ph) => { const t = el('textarea', { class: 'lb-input', rows: '3', placeholder: ph || '' }); t.value = value || ''; return t; };
const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

function answers(v) {
  const le = itemData(v, 'legal_entity'); const pa = itemData(v, 'physical_address'); const sg = itemData(v, 'authorized_signer');
  return { le, pa, sg, addr: [pa.street, pa.city, pa.state, pa.zip].filter(Boolean).join(', ') };
}

async function openFile(path) {
  try { const u = await signedDocumentUrl(path, 120); window.open(u, '_blank', 'noopener'); } catch (e) { toast(humanizeError(e), 'error'); }
}

function openForm(ctx, v, reload, pre) {
  const reg = v.registry || {}; const rec = Object.assign({}, reg.record || {}, pre || {}); const src = reg.source || null;
  const { le } = answers(v); const sec = !!(v.trust && v.trust.name_collision);
  const f = {
    state: input(rec.state || le.state_of_formation, 'CO'), legal_name: input(rec.legal_name), entity_number: input(rec.entity_number || le.entity_number),
    status: select(STATUSES, rec.status), formation_date: input(rec.formation_date, 'YYYY-MM-DD', 'date'),
    principal_address: area(rec.principal_address, 'Principal office address exactly as the registry shows it'),
    people: area((rec.people || []).join('\n'), 'One per line: Jane Roe (manager)\nBob Smith (registered agent)'),
    registry_url: input(rec.registry_url || (src && src.deep_link && le.entity_number ? src.deep_link.replace('{number}', encodeURIComponent(le.entity_number)) : ''), 'https://…'),
    sec_entity_number: input(rec.sec_entity_number, 'e.g. Delaware 2285944'),
    override_name: area(rec.override_name, 'Only if the names differ: why this is still the same company'),
    override_address: area(rec.override_address, 'Only if the addresses differ: e.g. the registry lists only the registered agent'),
    override_sec: area(rec.override_sec, 'Only for a different company with an SEC name: what the call-back confirmed'),
    via: select(VIA, rec.signer_auth && rec.signer_auth.via), via_note: area(rec.signer_auth && rec.signer_auth.note, 'Who confirmed the authorization, when, on which number / domain'),
  };
  let shot = rec.screenshot_path || null; let authFile = (rec.signer_auth && rec.signer_auth.file_path) || null;
  const shotIn = el('input', { type: 'file', accept: 'image/*,application/pdf', class: 'lb-input' });
  const authIn = el('input', { type: 'file', accept: 'image/*,application/pdf', class: 'lb-input' });
  const shotNow = el('div', { class: 'cc-sub' }, shot ? ['📎 ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); openFile(shot); } }, shot.split('/').pop())] : 'No screenshot yet');
  const err = el('div', { class: 'cc-sub', style: 'color:#b91c1c;margin-top:8px;white-space:pre-wrap' });
  const up = async (inp, cur) => (inp.files && inp.files[0] ? (await uploadDocument(inp.files[0], 'registry_check')).path : cur);
  const collect = async () => {
    shot = await up(shotIn, shot); authFile = await up(authIn, authFile);
    const people = f.people.value.split('\n').map((x) => x.trim()).filter(Boolean);
    return { state: f.state.value.trim().toUpperCase(), legal_name: f.legal_name.value.trim(), entity_number: f.entity_number.value.trim(), status: f.status.value,
      formation_date: f.formation_date.value.trim(), principal_address: f.principal_address.value.trim(), people, registry_url: f.registry_url.value.trim(),
      screenshot_path: shot, source: (pre && pre.source) || rec.source || 'manual', sec_entity_number: sec ? f.sec_entity_number.value.trim() : null,
      override_name: f.override_name.value.trim(), override_address: f.override_address.value.trim(), override_sec: sec ? f.override_sec.value.trim() : null,
      signer_auth: f.via.value ? { via: f.via.value, file_path: authFile, note: f.via_note.value.trim() } : null };
  };
  const go = (verify) => async (e) => {
    const b = e.currentTarget; b.disabled = true; err.textContent = '';
    try { const r = await shipperRegistryCheck(ctx.orgId, await collect(), verify); dlg.close(); toast(verify ? 'Registry check verified.' : 'Registry record saved (' + ((r.checks && r.checks.blockers) || []).length + ' open checks).', 'success'); reload(); }
    catch (x) { err.textContent = humanizeError(x); b.disabled = false; }
  };
  const body = el('div', null, [
    el('div', { class: 'p360-warn' }, 'Type what the REGISTRY says, not what the shipper typed. Open the record yourself' + (src ? ' (' + src.name + ')' : '') + ' and attach a screenshot of it.'),
    pre && pre.source === 'open_data' ? el('div', { class: 'cc-sub', style: 'margin-top:6px;color:#166534' }, '✓ Pre-filled from the state\'s open data. Check it against the registry page before saving.') : null,
    lbl('State'), f.state, lbl('Legal name (registry)'), f.legal_name, lbl('Entity / file number (registry)'), f.entity_number,
    lbl('Status'), f.status, lbl('Formation date'), f.formation_date, lbl('Principal address (registry)'), f.principal_address,
    lbl('Managers / officers / organizer / registered agent'), f.people, lbl('Link to the registry record'), f.registry_url,
    lbl('Screenshot of the registry record'), shotNow, shotIn,
    sec ? el('div', { style: 'margin-top:12px;border:1px solid #fecaca;border-radius:10px;padding:8px 10px' }, [
      el('b', { style: 'color:#b91c1c' }, '⚠ Name matches an SEC company' + (v.trust.sec_names && v.trust.sec_names[0] ? ': ' + v.trust.sec_names[0] : '')),
      el('div', { class: 'cc-sub' }, 'Find that company\'s own state + entity number in its SEC filing (10-K, Exhibit 21, or the state record of the parent). Same number = it claims to be that company. Different number = a look-alike: reject or hold.'),
      lbl('SEC company\'s entity number'), f.sec_entity_number, lbl('Different company — what the call-back confirmed (20+ characters)'), f.override_sec]) : null,
    lbl('If the name differs'), f.override_name, lbl('If the address differs'), f.override_address,
    lbl('Signer not in the registry? Written authorization'), f.via, f.via_note, el('div', { class: 'cc-sub' }, 'Attach the company\'s authorization letter:'), authIn,
    authFile ? el('div', { class: 'cc-sub' }, ['📎 ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); openFile(authFile); } }, authFile.split('/').pop())]) : null,
    err,
    el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [
      el('button', { class: 'lb-btn', onClick: go(false) }, 'Save'),
      el('button', { class: 'lb-btn lb-btn-primary', onClick: go(true) }, 'Save & verify')]),
  ]);
  const dlg = openDrawer('State registry record', body, { size: 'lg' });
}

export function registryBlock(ctx, v, reload) {
  const reg = v.registry || {}; const ch = reg.checks || {}; const src = reg.source || null; const rec = reg.record || null;
  const { le, sg, addr } = answers(v);
  const st = reg.status || 'pending';
  const mark = (ok) => ok === true ? el('span', { style: 'color:#166534;font-weight:800' }, '✓ ') : ok === false ? el('span', { style: 'color:#b91c1c;font-weight:800' }, '✗ ') : el('span', { class: 'cc-sub' }, '– ');
  const prefill = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await fetchRegistry(src, le.entity_number);
      if (!r) { toast('No record for ' + (le.entity_number || '?') + ' in ' + src.od_domain + (src.od_active_only ? ' (this dataset lists ACTIVE entities only — search the registry by name)' : '') + '.', 'error'); b.disabled = false; return; }
      openForm(ctx, v, reload, r);
    } catch (x) { toast(humanizeError(x), 'error'); }
    b.disabled = false;
  };
  return el('div', { style: 'margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px' }, [
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [el('b', null, 'State registry check '),
      pill(st === 'verified' || st === 'waived' ? 'green' : st === 'submitted' ? 'amber' : st === 'rejected' ? 'red' : 'gray', st),
      reg.stale ? pill('red', 'answers changed since verified — re-check') : null,
      ch.young ? pill('red', 'formed ' + ch.age_days + ' days ago') : null]),
    el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Shipper says: ' + [le.legal_name, le.state_of_formation, le.entity_number && '#' + le.entity_number].filter(Boolean).join(' · ') + (addr ? ' · ' + addr : '') + (sg.name ? ' · signer ' + sg.name : '')),
    el('div', { class: 'cc-sub', style: 'margin-top:4px' }, src ? ['Registry: ', link(src.search_url, src.name + ' ↗'), src.deep_link && le.entity_number ? [' · ', link(src.deep_link.replace('{number}', encodeURIComponent(le.entity_number)), 'open record #' + le.entity_number + ' ↗')] : null, src.notes ? el('div', null, src.notes) : null]
      : ['No registry link saved for ' + (le.state_of_formation || 'this state') + ' — ', link(NASS, 'NASS directory of every state\'s business registry ↗')]),
    rec ? el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:8px' }, CHECKS.map(([k, t]) => el('span', { class: 'cc-sub' }, [mark(ch[k]), t]))) : null,
    rec ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Registry says: ' + [rec.legal_name, rec.state, rec.entity_number && '#' + rec.entity_number, rec.status, rec.formation_date && 'formed ' + rec.formation_date].filter(Boolean).join(' · ') + (rec.principal_address ? ' · ' + rec.principal_address : '') + ((rec.people || []).length ? ' · ' + rec.people.join('; ') : '') + (rec.source === 'open_data' ? ' (open data)' : '')) : null,
    rec && rec.screenshot_path ? el('div', { class: 'cc-sub' }, ['📎 ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); openFile(rec.screenshot_path); } }, 'registry screenshot')]) : null,
    (ch.blockers || []).length && rec ? el('div', { class: 'cc-sub', style: 'margin-top:6px;color:#b91c1c' }, '✗ ' + ch.blockers.join(' · ')) : null,
    (ch.warnings || []).length && rec ? el('div', { class: 'cc-sub', style: 'margin-top:4px;color:#92400e' }, '⚠ ' + ch.warnings.join(' · ')) : null,
    ctx.manage ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, [
      canPrefill(src) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: prefill }, '⤓ Fill from ' + src.od_domain) : null,
      el('button', { class: 'lb-btn lb-btn-sm' + (canPrefill(src) ? '' : ' lb-btn-primary'), onClick: () => openForm(ctx, v, reload, null) }, rec ? 'Edit registry record' : 'Enter registry record'),
      st !== 'rejected' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => reasonDialog('Reject — registry check', 'What must the shipper fix? (they read this, e.g. "your entity number is not the one in the Colorado registry")',
        async (n) => { await onboardingReviewItem(ctx.orgId, 'registry_check', 'reject', n); toast('Rejected — shipper notified.', 'success'); reload(); }) }, 'Reject') : null,
      st !== 'waived' && st !== 'verified' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => reasonDialog('Waive — registry check', 'Why (recorded). Only for a sole proprietor with no state filing, after the EIN letter and call-back.',
        async (n) => { await onboardingReviewItem(ctx.orgId, 'registry_check', 'waive', n); toast('Waived.', 'success'); reload(); }) }, 'Waive') : null,
    ].filter(Boolean)) : null,
  ]);
}

function reasonDialog(title, label, onOk) {
  const t = area('', ''); const err = el('div', { class: 'cc-sub', style: 'color:#b91c1c;margin-top:6px' });
  const go = el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-top:12px' }, 'Save');
  const dlg = openDrawer(title, el('div', null, [lbl(label), t, err, go]), { size: 'sm' });
  go.onclick = async () => { go.disabled = true; try { await onOk(t.value.trim()); dlg.close(); } catch (e) { err.textContent = humanizeError(e); go.disabled = false; } };
}

// EIN letter / address proof: compared with the registry record, both ticks required (stored with the item)
export function openDocVerify(ctx, v, item, reload) {
  const rec = (v.registry || {}).record || {};
  const a = el('input', { type: 'checkbox' }); const b = el('input', { type: 'checkbox' });
  const err = el('div', { class: 'cc-sub', style: 'color:#b91c1c;margin-top:6px' });
  const go = el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-top:12px' }, 'Verify');
  const body = el('div', null, [
    el('div', { class: 'cc-sub' }, 'Registry record: ' + ([rec.legal_name, rec.principal_address].filter(Boolean).join(' · ') || '—')),
    item.file_path ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, ['📎 ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); openFile(item.file_path); } }, 'open the uploaded document')]) : null,
    el('label', { style: 'display:flex;gap:8px;margin-top:12px' }, [a, 'The company NAME on this document is the registry name']),
    el('label', { style: 'display:flex;gap:8px;margin-top:6px' }, [b, 'The ADDRESS on this document is the registry address (or the business address staff accepted on the registry card)']),
    el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'If either does not match, close this and Reject the document.'), err, go]);
  const dlg = openDrawer('Verify ' + item.label + ' against the registry', body, { size: 'sm' });
  go.onclick = async () => { go.disabled = true; try { await shipperDocVerify(ctx.orgId, item.key, a.checked, b.checked); dlg.close(); toast(item.label + ' verified.', 'success'); reload(); } catch (e) { err.textContent = humanizeError(e); go.disabled = false; } };
}

// SEC-name rule: the confirmed inbox counts only after staff approve its domain from a source the company itself controls
export function emailDomainBlock(ctx, v, reload) {
  const d = v.email_domain || {};
  if (!d.sec_rule) return null;
  const approve = () => {
    const src = select([['official_site', 'The company\'s official website (found independently)'], ['sec_filing', 'An SEC filing'], ['registry', 'The state registry record']]);
    const url = input('', 'https://…'); const note = area('', 'Where exactly the domain is listed, and how you found that source');
    const err = el('div', { class: 'cc-sub', style: 'color:#b91c1c;margin-top:6px' });
    const go = el('button', { class: 'lb-btn lb-btn-primary', style: 'margin-top:12px' }, 'Approve ' + d.confirmed);
    const dlg = openDrawer('Approve email domain', el('div', null, [
      el('div', { class: 'p360-warn' }, 'Approve only if the SEC company itself lists ' + d.confirmed + ' — on a website or filing you found yourself, never a link the shipper sent.'),
      lbl('Source'), src, lbl('Link'), url, lbl('Note'), note, err, go]), { size: 'sm' });
    go.onclick = async () => { go.disabled = true; try { await shipperEmailDomainApprove(ctx.orgId, d.confirmed, src.value, url.value.trim(), note.value.trim()); dlg.close(); toast('Domain approved.', 'success'); reload(); } catch (e) { err.textContent = humanizeError(e); go.disabled = false; } };
  };
  return el('div', { style: 'margin-top:12px;border:1px solid #fecaca;border-radius:12px;padding:10px 12px' }, [
    el('b', null, 'Company email — SEC-name rule '), d.approved && d.approved === d.confirmed ? pill('green', d.approved + ' approved') : pill('red', d.confirmed ? d.confirmed + ' not approved' : 'no inbox confirmed yet'),
    el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'The company name matches an SEC company, so a code confirmed on the shipper\'s own domain proves nothing on its own. Staff approve the domain only when that company itself lists it.'),
    d.approved ? el('div', { class: 'cc-sub' }, 'Approved ' + String(d.approved_at || '').slice(0, 10) + ' · ' + (d.source || '') + ' · ' + (d.source_url || '') + (d.note ? ' · ' + d.note : '')) : null,
    ctx.manage ? el('div', { style: 'display:flex;gap:6px;margin-top:8px' }, [
      d.confirmed && d.approved !== d.confirmed ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: approve }, 'Approve ' + d.confirmed) : null,
      d.approved ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => reasonDialog('Clear the domain approval', 'Why (recorded)', async (n) => { await shipperEmailDomainApprove(ctx.orgId, null, null, null, n); toast('Approval cleared.', 'success'); reload(); }) }, 'Clear approval') : null,
    ].filter(Boolean)) : null,
  ]);
}

// bl_ship_0503 — Google Places suggests a phone for the registry name + address. Staff still judge it: a fraudster can make a
// Google Business profile too, so trust a listing only when its address is the REGISTRY address and it is not brand new.
export async function openPlacesLookup(ctx, onUse) {
  const body = el('div', null, el('div', { class: 'cc-sub' }, 'Asking Google…'));
  const dlg = openDrawer('Company phone from Google', body, { size: 'lg' });
  let r;
  try { r = await shipperPlacesLookup(ctx.orgId); } catch (e) { body.replaceChildren(el('div', { class: 'cc-sub', style: 'color:#b91c1c' }, humanizeError(e))); return; }
  if (!r || !r.ok) {
    body.replaceChildren(el('div', { class: 'cc-sub', style: 'color:#b91c1c' }, r && r.error === 'not_configured'
      ? 'Google Places is not switched on yet. The owner adds the GOOGLE_PLACES_KEY secret to the places-lookup edge function (steps in claude/REGISTRY-CHECK-PLAN.md).'
      : (r && (r.message || r.error)) || 'Google lookup failed'));
    return;
  }
  const rows = (r.results || []);
  body.replaceChildren(el('div', null, [
    el('div', { class: r.basis === 'registry' ? 'cc-sub' : 'p360-warn' }, r.basis === 'registry'
      ? 'Searched the REGISTRY name and address: "' + r.query + '".'
      : 'No registry record saved yet, so this searched what the SHIPPER typed ("' + r.query + '"). A fake shipper can match its own fake listing — save the registry record first if you can.'),
    el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Google lookups this month: ' + r.used + ' of ' + r.cap + ' (free tier).'),
    rows.length ? el('div', null, rows.map((p) => el('div', { style: 'border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-top:10px' }, [
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [el('b', null, p.name || '—'),
        p.status && p.status !== 'OPERATIONAL' ? pill('red', p.status.toLowerCase().replace(/_/g, ' ')) : pill('green', 'operational')]),
      el('div', { class: 'cc-sub' }, p.address || '—'),
      el('div', { class: 'cc-sub' }, ['📞 ', p.phone || 'no phone listed', p.website ? [' · ', link(p.website, p.website.replace(/^https?:\/\//, '').slice(0, 50) + ' ↗')] : null, p.maps_url ? [' · ', link(p.maps_url, 'Google Maps ↗')] : null]),
      p.phone ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', style: 'margin-top:8px', onClick: () => { dlg.close(); onUse(p); } }, 'Use this number for the call-back') : null,
    ]))) : el('div', { class: 'cc-sub', style: 'margin-top:10px' }, 'Google has no listing for this company at this address. That alone proves nothing — find the number on the company\'s own website or the registry.'),
    el('div', { class: 'cc-sub', style: 'margin-top:10px' }, 'Nothing here is saved except Google\'s place id. The number you call is recorded with the call-back.'),
  ]));
}

export default { registryBlock, openDocVerify, emailDomainBlock, openPlacesLookup };
