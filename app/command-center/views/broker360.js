// broker360.js — one-stop Broker/Partner 360 (Carrier-360 parity for the broker side):
// packet review with file previews + verify/reject, FMCSA lookup, loads, claims, health, timeline.
import { el, mount } from '../../shared/ui/dom.js';
import { card, statCard, statusPill, fmtDateTime, openDrawer, askReason, askConfirm } from '../../shared/ui/components.js';
import { partner360, onboardingReviewItem, claimBundle, partnerSetStatus, accountHealth, issueViolation } from '../../shared/api.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { renderFmcsaOnly } from '../../carrier/profile-view.js';
import { printExecutedW9 } from '../../carrier/w9-form.js';

const money = (n) => '$' + Number(n || 0).toLocaleString();

function printExecutedAgreementDoc(d) {
  const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to download.'); return; }
  const esc = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ref = 'LB-BA-' + (d.signed_date || '').replace(/-/g, '') + '-' + (d.signer || 'X').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  const raw = String(d.body || '');
  const parts = raw.split(/\n(?=\d{1,2}\. )/);
  const intro = esc(parts.shift() || '').replace(/\n/g, '<br>');
  const clauses = parts.map((c) => {
    const m = /^(\d{1,2})\. ([A-Z &\/\u2013-]+)\.\s*([\s\S]*)$/.exec(c.trim());
    if (!m) return '<div class="cl"><div class="cl-b">' + esc(c).replace(/\n/g, '<br>') + '</div></div>';
    return '<div class="cl"><div class="cl-h"><span class="cl-n">' + m[1] + '</span>' + esc(m[2]) + '</div><div class="cl-b">' + esc(m[3]).replace(/\n/g, '<br>') + '</div></div>';
  }).join('');
  const logo = '<svg width="30" height="32" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#10223B"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#FC5305"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#10223B"/></svg>';
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(d.title) + ' — Executed</title><style>'
    + '*{box-sizing:border-box}body{font-family:Inter,system-ui,Arial,sans-serif;color:#0f1e36;margin:0 auto;max-width:860px;padding:34px 38px}'
    + '.lh{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #FC5305;padding-bottom:14px}'
    + '.lh .wd{font-weight:800;font-size:1.15rem}.lh .wd span{color:#FC5305}'
    + '.meta{text-align:right;font-size:.7rem;color:#51617a;line-height:1.7}'
    + 'h1{text-align:center;font-size:1.28rem;margin:22px 0 2px}.ref{text-align:center;font-size:.72rem;color:#51617a;letter-spacing:.14em;text-transform:uppercase;margin-bottom:16px}'
    + '.intro{font-size:.85rem;line-height:1.65;background:#f6f8fb;border:1px solid #e6ecf4;border-radius:10px;padding:14px 16px;margin-bottom:14px}'
    + '.cl{margin:0 0 12px;page-break-inside:avoid}.cl-h{font-weight:800;font-size:.85rem;margin-bottom:3px}'
    + '.cl-n{display:inline-flex;width:22px;height:22px;border-radius:50%;background:#10223B;color:#fff;font-size:.7rem;align-items:center;justify-content:center;margin-right:8px}'
    + '.cl-b{font-size:.82rem;line-height:1.6;color:#2b3b52;margin-left:30px}'
    + '.sigrow{display:flex;justify-content:space-between;gap:40px;margin-top:34px;page-break-inside:avoid}' + '.sig{flex:1}.sig .lab{font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}' + '.sig .line{border-bottom:1.5px solid #0f1e36;min-height:32px;font-family:cursive;font-size:1.35rem;color:#0b1b33;padding:2px 0;display:flex;align-items:flex-end}' + '.sig .sub{font-size:.64rem;color:#94a3b8;margin-top:3px}'
    + '.stamp{margin-top:26px;display:flex;justify-content:space-between;align-items:center;background:#e7f9ee;border:1.5px solid #16a34a;border-radius:10px;padding:10px 14px}'
    + '.stamp b{color:#12a150;font-size:.8rem}.stamp span{font-size:.68rem;color:#51617a}'
    + '</style></head><body>'
    + '<div class="lh"><div style="display:flex;align-items:center;gap:10px">' + logo + '<div class="wd">Load<span>Boot</span></div></div>'
    + '<div class="meta">LoadBoot — The Operating System for Trucking<br>hello@loadboot.com · loadboot.com<br>Ref ' + esc(ref) + '</div></div>'
    + '<h1>' + esc(d.title) + '</h1><div class="ref">Version ' + esc(d.version) + ' · EXECUTED ELECTRONICALLY</div>'
    + '<div class="intro">' + intro + '</div>' + clauses
    + '<div class="sigrow">' + '<div class="sig"><div class="lab">Partner (signed electronically)</div><div class="line">' + esc(d.signer) + '</div><div class="sub">' + esc(d.company || '') + (d.company ? ' · ' : '') + 'Signed ' + esc(d.signed_date) + '</div></div>' + '<div class="sig"><div class="lab">LoadBoot (pre-signed)</div><div class="line" style="color:#0e7490">LoadBoot</div><div class="sub">Authorized Signatory, LoadBoot · ' + new Date().toLocaleDateString() + '</div></div>' + '</div>'
    + '<div class="stamp"><b>✓ EXECUTED — SERVER TIMESTAMPED</b><span>Recorded by the LoadBoot platform with an audit entry. Neither party can alter this record.</span></div>'
    + '<scr' + 'ipt>window.print();</scr' + 'ipt></body></html>');
  w.document.close();
}


export function renderBroker360(host, orgId) {
  mount(host, el('div', { class: 'cc-view' }, el('div', { class: 'cc-sub', style: 'padding:20px' }, 'Loading broker 360…')));
  load();

  async function load() {
    let d;
    try { d = await partner360(orgId); }
    catch (e) { mount(host, el('div', { class: 'cc-view' }, el('div', { class: 'lb-state lb-error', style: 'margin:20px' }, humanizeError(e)))); return; }
    const o = d.org || {}; const prof = d.profile || {}; const packet = d.packet || [];
    const loads = d.loads || []; const claims = d.claims || []; const ah = d.health; const tl = d.timeline || [];
    const manage = can('partners.manage') || can('dispatch.manage');

    // ---- header ----
    const tierCol = ah ? (ah.tier === 'healthy' ? '#16a34a' : ah.tier === 'building' ? '#0883F7' : ah.tier === 'at_risk' ? '#f59e0b' : '#dc2626') : '#94a3b8';
    const head = el('div', { class: 'lb-card', style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap' }, [
      el('div', null, [
        el('h2', { style: 'margin:0;font-size:1.3rem' }, o.name || 'Broker'),
        el('div', { class: 'cc-sub', style: 'margin-top:3px' }, (o.kind || '').toUpperCase() + ' · since ' + fmtDateTime(o.created_at) + (prof.contact_name ? ' · ' + prof.contact_name : '') + (prof.phone ? ' · ' + prof.phone : '') + (prof.email ? ' · ' + prof.email : '')),
      ]),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        statusPill(o.status),
        ah ? el('span', { class: 'cc-pill', style: 'background:' + tierCol + '1a;color:' + tierCol + ';font-weight:800' }, String(ah.score) + ' · ' + String(ah.tier || '').replace('_', ' ').toUpperCase()) : null,
      ].filter(Boolean)),
    ]);

    // ---- KPIs ----
    const mand = packet.filter((x) => x.tag !== 'optional');
    const mandOk = mand.filter((x) => x.status === 'verified' || x.status === 'waived').length;
    const awaiting = packet.filter((x) => x.status === 'submitted').length;
    const openClaims = claims.filter((x) => x.status === 'requested' || x.support_status === 'open').length;
    const kpis = el('div', { class: 'cc-kpi-grid', style: 'margin-top:14px' }, [
      statCard({ icon: 'doc', label: 'Packet', value: mandOk + '/' + mand.length, sub: awaiting ? awaiting + ' awaiting review' : 'mandatory verified', accent: mandOk === mand.length ? 'green' : 'amber' }),
      statCard({ icon: 'loads', label: 'Loads', value: String(loads.length), sub: 'most recent', accent: 'blue' }),
      statCard({ icon: 'flag', label: 'Open claims', value: String(openClaims), sub: claims.length + ' total on their loads', accent: openClaims ? 'amber' : 'green' }),
      statCard({ icon: 'shield', label: 'Health', value: ah ? String(ah.score) : '—', sub: ah ? (ah.tier || '') : 'not scored', accent: 'violet' }),
    ]);

    // ---- packet review (files + verify/reject) ----
    const packetCard = card([el('h4', { class: 'cc-card-title' }, 'Onboarding packet — review & decide')]);
    const filePathOf = (ref) => { const m = /file:([^\s·]+)/.exec(ref || ''); return m ? m[1] : null; };
    const drawPacket = () => mount(packetCard, el('div', null, [
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Onboarding packet — review & decide'), el('span', { class: 'cc-pill cc-pill-' + (mandOk === mand.length ? 'green' : 'amber') }, mandOk === mand.length ? 'complete' : 'action needed')]),
      ...packet.map((it) => {
        const st = it.status;
        const tone = st === 'verified' ? 'green' : st === 'rejected' ? 'red' : st === 'submitted' ? 'blue' : 'amber';
        const fpath = filePathOf(it.ref);
        const refTxt = (it.ref || '').replace(/file:[^\s·]+/, '').replace(/^\s*·\s*|\s*·\s*$/g, '');
        // labelled ref fields → tidy chips instead of one long scattered line
        const pairs = (refTxt || '').split('·').map((x) => /^\s*([^:]{2,40}):\s*(.+)\s*$/.exec(x)).filter(Boolean);
        const chips = pairs.length >= 2 ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:5px' },
          pairs.map((m) => el('span', { style: 'background:#f6f8fb;border:1px solid #e8edf3;border-radius:8px;padding:3px 9px;font-size:.76rem;color:#334155' }, [el('b', { style: 'color:#64748b;font-weight:700' }, m[1].trim() + ': '), m[2].trim()]))) : null;
        return el('div', { style: 'display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eef2f7;flex-wrap:wrap' }, [
          el('div', { style: 'min-width:220px;flex:1' }, [
            el('b', { style: 'font-size:.9rem' }, it.label),
            el('div', { class: 'cc-sub' }, '[' + String(it.tag || '').toUpperCase() + ']'
              + (!chips && refTxt ? ' · ' + refTxt : '')
              + (it.submitted_at ? ' · submitted ' + fmtDateTime(it.submitted_at) : '')
              + (st === 'rejected' && it.note ? ' · ✕ ' + it.note : '')
              + ((!fpath && !(it.note || '').trim().startsWith('{')) ? ' · ⚠ no file on record — text-only submission' : '')),
            chips,
          ].filter(Boolean)),
          el('div', { style: 'display:flex;gap:6px;align-items:center;flex:none;flex-wrap:wrap' }, [
            el('span', { class: 'cc-pill cc-pill-' + tone }, st),
            fpath ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true;
              try { const u = await signedDocumentUrl(fpath, 300); window.open(u, '_blank', 'noopener'); } catch (e) { alert(humanizeError(e)); }
              b.disabled = false;
            } }, '👁 View file') : null,
            (() => {
              let sd = null; try { sd = it.note && it.note.trim().startsWith('{') ? JSON.parse(it.note) : null; } catch (_) {}
              if (!sd) return null;
              if (it.key === 'w9') return el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => printExecutedW9(Object.assign({ approved: st === 'verified' }, sd)) }, '⬇ Executed W-9');
              if (it.key === 'broker_agreement' && sd.body) return el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => printExecutedAgreementDoc(sd) }, '⬇ Executed agreement');
              return null;
            })(),
            (manage && st !== 'verified') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true;
              try { await onboardingReviewItem(orgId, it.key, 'verify', null); toast(it.label + ' verified — partner notified', 'success'); load(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); }
            } }, '✓ Verify') : null,
            manage ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => {
              const HINTS = {
                mc_authority: 'Check the MC on the letter against FMCSA (card below) — name and status must match.',
                bmc84_bond: 'Bond must be ACTIVE and $75,000 — call the surety if the certificate looks stale.',
                w9: 'Legal name + 9-digit TIN + signature. Signed-online copies carry the data (⬇ Executed W-9).',
                coi: 'GL / E&O / contingent cargo current — check expiry dates and insured name.',
                broker_agreement: 'Open ⬇ Executed agreement — signer name and date must be present.',
                bank_instructions: 'Match the voided check to the typed account/routing before verifying.',
                claims_procedure: 'A named contact + phone + a real process — not just \u201cwe handle it\u201d.',
              };
              const dA = openDrawer('⚙ Actions — ' + it.label, [
                el('div', { class: 'cc-sub' }, '[' + String(it.tag || '').toUpperCase() + '] · status: ' + st + (it.submitted_at ? ' · submitted ' + fmtDateTime(it.submitted_at) : '')),
                HINTS[it.key] ? el('div', { style: 'background:#eef6ff;border:1px solid #bfdbfe;border-radius:10px;padding:9px 12px;font-size:.83rem;color:#1e40af;margin-top:8px' }, '🎛 Review hint: ' + HINTS[it.key]) : null,
                el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [
                  st !== 'verified' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => { _btn9.disabled = true;
                    const _btn9 = ev.currentTarget;
                    try { await onboardingReviewItem(orgId, it.key, 'verify', null); toast('Verified — partner notified', 'success'); dA.close(); load(); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
                  } }, '✓ Verify') : null,
                  el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev) => {
                    const _btn9 = ev.currentTarget;
                    const why = await askReason('Waive "' + it.label + '" — reason (audited; item counts as satisfied):'); if (!why) return;
                    _btn9.disabled = true;
                    try { await onboardingReviewItem(orgId, it.key, 'waive', why); toast('Waived', 'info'); dA.close(); load(); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
                  } }, 'Waive'),
                  el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: async (ev) => {
                    const _btn9 = ev.currentTarget;
                    const why = await askReason('⚠ Reject + WARN — reason (rejects the item AND issues a −5 pt document strike):'); if (!why) return;
                    _btn9.disabled = true;
                    try { await onboardingReviewItem(orgId, it.key, 'reject', why); await issueViolation(orgId, 'document', 'warning', '[' + it.label + '] ' + why); toast('Rejected + strike issued', 'info'); dA.close(); load(); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
                  } }, '⚠ Reject + warn'),
                ].filter(Boolean)),
              ].filter(Boolean));
            } }, '⚙ Actions') : null,
            (manage && st !== 'rejected') ? el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: () => {
              const REASONS = ['Illegible / wrong document uploaded', 'Expired or inactive — needs a current one', 'Details do not match the FMCSA record', 'Wrong format — official PDF required (screenshots rejected)', 'Incomplete information / fields missing', 'Suspected altered or fraudulent document', 'Other (describe below)'];
              const cat = el('select', { class: 'cc-input' }, REASONS.map((x) => el('option', { value: x }, x)));
              const why = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Description (required) — the partner reads these exact words in-app and by branded email.' });
              const required = String(it.tag || '').toLowerCase() !== 'optional';
              const dr = openDrawer('✕ Reject — ' + it.label, [
                el('div', { class: 'cc-sub' }, '[' + String(it.tag || '').toUpperCase() + ']' + (it.submitted_at ? ' · submitted ' + fmtDateTime(it.submitted_at) : '') + (it.ref ? ' · ' + String(it.ref).slice(0, 80) : '')),
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Reason category'), cat,
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Description (required)'), why,
                el('div', { style: 'background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;font-size:.83rem;color:#7f1d1d;margin-top:12px;line-height:1.55' }, [
                  el('div', { style: 'font-weight:800;margin-bottom:3px' }, 'What happens:'),
                  'Partner gets an urgent notification + branded email with your reason · the item goes back to them for fix & resubmit'
                  + (required ? ' · their packet turns INCOMPLETE, the account goes PENDING and load posting STOPS until this is verified again.' : ' · optional item — posting is not affected.'),
                ]),
                el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
                  el('button', { class: 'lb-btn lb-btn-primary', style: 'background:#b91c1c;border-color:#b91c1c', onClick: async (ev) => {
                    if (!why.value.trim()) { alert('Description is required — the partner must know exactly what to fix.'); return; }
                    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Rejecting…';
                    try { await onboardingReviewItem(orgId, it.key, 'reject', cat.value + ' — ' + why.value.trim()); dr.close(); toast('Rejected — partner notified + emailed' + (required ? ' · account parked (pending)' : ''), 'info'); load(); }
                    catch (e) { b.disabled = false; b.textContent = '✕ Reject item'; alert(humanizeError(e)); }
                  } }, '✕ Reject item'),
                  el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => dr.close() }, 'Cancel'),
                ]),
              ]);
            } }, '✕ Reject') : null,
          ].filter(Boolean)),
        ]);
      }),
    ]));
    drawPacket();
    const gateRow = manage ? el('div', { style: 'display:flex;gap:9px;margin-top:6px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #e8edf3;border-radius:12px;padding:12px 14px' }, [
      o.status === 'active'
        ? el('button', { class: 'lb-btn lb-btn-primary', disabled: 'disabled', style: 'opacity:.75', title: 'Account is active — posting live' }, '✓ Account approved')
        : el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
            const _btn9 = ev.currentTarget;
            if (!await askConfirm('Please confirm', { body: 'Approve this partner account? Posting goes live and they are notified.', danger: true })) return;
            _btn9.disabled = true;
            try { await partnerSetStatus(orgId, 'approve', null); toast('Approved — partner notified 🎉', 'success'); load(); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
          } }, '✓ Approve account'),
      el('span', { class: 'cc-pill', style: 'background:' + (o.status === 'active' ? '#e7f9ee;color:#12a150' : '#fef3c7;color:#b45309') }, 'status: ' + o.status),
      el('button', { style: 'margin-left:auto;border:1px solid #fecaca;background:#fff;color:#b91c1c;font-weight:800;border-radius:10px;padding:10px 18px;cursor:pointer', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        const why = prompt((o.status === 'active' ? 'Revoke approval / park account' : 'Park account') + ' — reason (partner sees this):'); if (!why || !why.trim()) return;
        _btn9.disabled = true;
        try { await partnerSetStatus(orgId, 'park', why.trim()); toast('Account parked — posting paused, partner notified', 'info'); load(); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
      } }, '✕ Revoke approval'),
    ]) : null;

    // --- health engine (broker) + warn — carrier-engine parity ---
    const engineCard = card([el('h4', { class: 'cc-card-title' }, 'Health engine — live score'), el('div', { class: 'cc-sub' }, 'Loading…')]);
    (async () => {
      let ah2 = null; try { ah2 = await accountHealth(orgId); } catch (e) { mount(engineCard, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
      const t2 = ah2.tier || '—';
      const tc2 = t2 === 'healthy' ? '#16a34a' : t2 === 'building' ? '#0883F7' : t2 === 'at_risk' ? '#f59e0b' : '#dc2626';
      const ded2 = Array.isArray(ah2.deductions) ? ah2.deductions : [];
      mount(engineCard, el('div', null, [
        el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Health engine — live score'), el('span', { class: 'cc-pill', style: 'background:' + tc2 + '1a;color:' + tc2 + ';font-weight:800' }, String(ah2.score) + ' · ' + t2.replace('_', ' ').toUpperCase())]),
        ded2.length ? el('div', null, ded2.map((d2) => el('div', { style: 'font-size:.83rem;color:#334155;padding:3px 0' }, '− ' + d2.deducted + ' — ' + d2.label + (d2.basis ? ' (' + d2.basis + ')' : '')))) : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No deductions — clean account.'),
        manage ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', style: 'margin-top:10px', onClick: async (ev) => {
          const _btn9 = ev.currentTarget;
          const why = await askReason('⚠ Warn this partner — reason (they see this; points deducted):'); if (!why) return;
          _btn9.disabled = true;
          try { await issueViolation(orgId, 'conduct', 'warning', why); _btn9.textContent = 'Warned ✓'; toast('Warning issued', 'success'); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
        } }, '⚠ Warn account') : null,
      ].filter(Boolean)));
    })();

    // ---- Payout & bank details (carrier-360 parity) — parsed from the bank packet item ----
    const bankIt = packet.find((x) => x.key === 'bank_instructions');
    const bankCard = (() => {
      if (!bankIt) return null;
      const kvs = {};
      String(bankIt.ref || '').split('·').forEach((seg) => { const m = /^\s*([^:]+):\s*(.+)\s*$/.exec(seg); if (m) kvs[m[1].trim().toLowerCase()] = m[2].trim(); });
      const kv2 = (label, key) => el('div', { class: 'cc-kv', style: 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:.85rem' }, [el('span', { style: 'color:#64748b;font-weight:600' }, label), el('b', null, (Object.keys(kvs).find((k) => k.startsWith(key)) ? kvs[Object.keys(kvs).find((k) => k.startsWith(key))] : '—'))]);
      const st9 = bankIt.status;
      const fpath9 = (/file:([^\s·]+)/.exec(bankIt.ref || '') || [])[1] || null;
      return card([
        el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Payout & bank details'), el('span', { class: 'cc-pill cc-pill-' + (st9 === 'verified' ? 'green' : st9 === 'rejected' ? 'red' : 'amber') }, st9)]),
        kv2('Bank', 'bank name'), kv2('Account holder', 'account holder'), kv2('Account #', 'account number'),
        kv2('Routing / ABA', 'routing'), kv2('Account type', 'account type'), kv2('Bank address', 'bank address'),
        kv2('Bank phone', 'bank phone'), kv2('Remittance / billing email', 'remittance'),
        el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
          fpath9 ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true;
            try { const u = await signedDocumentUrl(fpath9, 300); window.open(u, '_blank', 'noopener'); } catch (e) { alert(humanizeError(e)); } b.disabled = false;
          } }, '👁 Voided check / bank letter') : el('span', { class: 'cc-sub' }, '⚠ no voided check on file'),
          (manage && st9 !== 'verified') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => { _btn9.disabled = true;
            const _btn9 = ev.currentTarget;
            try { await onboardingReviewItem(orgId, 'bank_instructions', 'verify', null); toast('Bank details verified — partner notified', 'success'); load(); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
          } }, '✓ Verify bank details') : null,
          (manage && st9 !== 'rejected') ? el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: async (ev) => {
            const _btn9 = ev.currentTarget;
            const why = await askReason('Reject bank details — reason (partner notified + emailed):'); if (!why) return;
            _btn9.disabled = true;
            try { await onboardingReviewItem(orgId, 'bank_instructions', 'reject', why); toast('Rejected — partner notified', 'info'); load(); } catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
          } }, '✕ Reject with reason') : null,
        ].filter(Boolean)),
      ]);
    })();

    // ---- FMCSA (brokers are in the census too — look up by DOT) ----
    const allRefs = packet.map((x) => x.ref || '').join(' ');
    const dotGuess = (/DOT[:\s#]*([0-9]{5,8})/i.exec(allRefs) || [])[1] || '';
    const fmcsaHost = el('div', { style: 'margin-top:8px' });
    const dotIn = el('input', { class: 'cc-input', placeholder: 'DOT number', value: dotGuess, style: 'max-width:160px' });
    const fmcsaCard = (o.kind === 'shipper') ? card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '🏭 Shipper verification — no FMCSA record'), el('span', { class: 'cc-sub' }, 'shippers are not carriers/brokers')]),
      el('div', { class: 'cc-sub', style: 'margin-top:6px;line-height:1.7' }, 'Shippers have no MC/DOT — verify them commercially instead: ① legal entity + EIN on the W-9/credit application, ② business address & website, ③ trade/credit references called, ④ payment terms agreed in writing, ⑤ facility contacts answer the phone. All of that lives in the packet above.'),
    ]) : card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'FMCSA — verify broker authority'), el('span', { class: 'cc-sub' }, 'live government record')]),
      el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Brokers appear in the FMCSA census by DOT number. Enter it (from the authority letter) and verify the legal name, authority status and bond on file.'),
      el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap' }, [dotIn,
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => {
          const dot = (dotIn.value || '').replace(/\D/g, '');
          if (!dot) { alert('Enter the DOT number from their authority letter.'); return; }
          renderFmcsaOnly(fmcsaHost, dot, { light: true });
        } }, 'Verify with FMCSA')]),
      fmcsaHost,
    ]);

    // ---- loads ----
    const loadsCard = card([
      el('h4', { class: 'cc-card-title' }, 'Recent loads'),
      loads.length ? el('div', null, loads.map((l) => el('div', { style: 'display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #eef2f7;flex-wrap:wrap' }, [
        el('div', null, [el('b', { style: 'font-size:.88rem' }, (l.origin || '—') + ' → ' + (l.destination || '—')),
          el('div', { class: 'cc-sub' }, money(l.rate) + ' · ' + fmtDateTime(l.created_at) + (l.carrier ? ' · carrier: ' + l.carrier : ''))]),
        el('div', { style: 'display:flex;gap:6px;align-items:center' }, [
          Number(l.claims) ? el('span', { class: 'cc-pill', style: 'background:#fef3c7;color:#b45309' }, l.claims + ' claim' + (l.claims > 1 ? 's' : '')) : null,
          statusPill(l.status)].filter(Boolean)),
      ]))) : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No loads posted yet.'),
    ]);

    // ---- claims on their loads ----
    const claimsCard = card([
      el('h4', { class: 'cc-card-title' }, '💰 Claims on their loads'),
      claims.length ? el('div', null, claims.map((a) => el('div', { style: 'display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #eef2f7;flex-wrap:wrap;cursor:pointer', title: 'Open evidence bundle', onClick: async () => {
        let b = null; try { b = await claimBundle(a.id); } catch (e) { toast(humanizeError(e), 'error'); return; }
        const c = (b && b.claim) || {};
        const rowKV9 = (k9, v9) => el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #eef2f7;font-size:.78rem' }, [el('span', { style: 'color:#64748b' }, String(k9).replace(/_/g, ' ')), el('b', { style: 'text-align:right;word-break:break-word' }, String(v9))]);
        const objBox9 = (v9) => { if (Array.isArray(v9)) return el('div', null, v9.length ? v9.map((it9, i9) => (typeof it9 === 'object' && it9) ? el('div', { style: 'border:1px solid #e8edf3;border-radius:8px;padding:6px 8px;margin:4px 0;background:#fff' }, Object.entries(it9).filter(([, vv9]) => vv9 != null && typeof vv9 !== 'object').map(([kk9, vv9]) => rowKV9(kk9, vv9))) : rowKV9('#' + (i9 + 1), it9)) : [el('div', { class: 'cc-sub' }, 'none')]); return el('div', null, Object.entries(v9).filter(([, vv9]) => vv9 != null).map(([kk9, vv9]) => (typeof vv9 === 'object') ? el('div', { style: 'margin:4px 0' }, [el('div', { style: 'font-size:.7rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em' }, String(kk9).replace(/_/g, ' ')), objBox9(vv9)]) : rowKV9(kk9, vv9))); };
        
        openDrawer('Claim ' + (c.ref || ''), [
          el('div', { class: 'cc-sub' }, (a.origin || '') + ' → ' + (a.destination || '') + ' · ' + String(a.kind || '').toUpperCase()),
          el('div', { style: 'font-size:.74rem;background:#f6f8fb;border:1px solid #e8edf3;border-radius:8px;padding:8px;max-height:340px;overflow:auto;margin-top:8px' }, objBox9({ timeline: b.timeline, gps_dwell: b.gps_dwell, stop_documents: b.stop_documents })),
          el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Decide in Exception Center → Pay claims, or from the carrier’s 360 trip drawer.'),
        ]);
      } }, [
        el('div', null, [el('b', { style: 'font-size:.88rem' }, String(a.kind || '').toUpperCase() + ' — ' + (a.origin || '') + ' → ' + (a.destination || '')),
          el('div', { class: 'cc-sub' }, fmtDateTime(a.created_at) + (a.amount > 0 ? ' · ' + money(a.amount) : ''))]),
        el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
          statusPill(a.status),
          a.broker_status === 'approved' ? el('span', { class: 'cc-pill', style: 'background:#e7f9ee;color:#12a150' }, '✓ broker ok') : a.broker_status === 'disputed' ? el('span', { class: 'cc-pill', style: 'background:#fee2e2;color:#b91c1c' }, '✕ disputed') : null,
          a.support_status === 'open' ? el('span', { class: 'cc-pill', style: 'background:#dbeafe;color:#1d4ed8' }, '🎧 escalated') : null,
        ].filter(Boolean)),
      ]))) : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No claims filed on their loads.'),
    ]);

    // ---- timeline ----
    const tlCard = card([
      el('h4', { class: 'cc-card-title' }, 'Activity timeline'),
      tl.length ? el('div', { class: 'cc-timeline' }, tl.map((e) => el('div', { class: 'cc-tl-row' }, [
        el('span', { class: 'cc-tl-dot' }), el('div', null, [el('b', null, e.action), el('div', { class: 'cc-sub' }, (e.summary || '') + ' · ' + fmtDateTime(e.at))]),
      ]))) : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No audit activity yet.'),
    ]);

    mount(host, el('div', { class: 'cc-view' }, el('div', null, [
      head, kpis,
      el('div', { style: 'margin-top:16px' }, packetCard),
      gateRow,
      bankCard ? el('div', { style: 'margin-top:16px' }, bankCard) : null,
      el('div', { style: 'margin-top:16px' }, engineCard),
      el('div', { style: 'margin-top:16px' }, fmcsaCard),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [loadsCard, claimsCard]),
      el('div', { style: 'margin-top:16px' }, tlCard),
    ].filter(Boolean))));
  }
}

export default renderBroker360;
