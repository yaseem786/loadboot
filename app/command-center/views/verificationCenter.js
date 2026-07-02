// verificationCenter.js — Command Center: Carrier Verification Center (ct-waveBH).
// Verifies carriers against the OFFICIAL FMCSA QCMobile API (fmcsa-verify edge fn),
// compares the official record to what the carrier submitted, computes discrepancies
// + a match score, and drives a review queue with source + freshness. Human approval
// still gates activation — this flags risk, it does not auto-activate.
// RBAC: compliance.view to read, compliance.manage to verify (enforced server-side).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { listCarrierOrgs, fmcsaVerify, recordCarrierVerification, listCarrierVerifications, verificationQueue } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const ST = { verified: 'green', discrepancy: 'red', unverified: 'gray', not_found: 'amber', provider_error: 'amber' };
const pill = (s) => el('span', { class: 'cc-pill cc-pill-' + (ST[s] || 'gray') }, [el('i', { class: 'cc-pill-dot' }), (s || '').replace(/_/g, ' ')]);
const scorePill = (n) => el('span', { class: 'cc-pill cc-pill-' + (n >= 80 ? 'green' : n >= 50 ? 'amber' : 'red') }, String(n == null ? '—' : n));

export function renderVerificationCenter(host) {
  const manage = can('compliance.manage');
  let orgs = null;
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Verification Center', 'Verify carriers against the official FMCSA QCMobile API. Official data is compared to what the carrier submitted; discrepancies and out-of-service / inactive-authority risks are flagged for human review. Verification never auto-activates a carrier.'),
    el('div', { id: 'vc-kpis' }),
    el('div', { class: 'cc-grid2', style: 'display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:16px;align-items:start' }, [
      el('div', { id: 'vc-verify' }),
      el('div', { id: 'vc-queue' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
    ]),
    el('div', { id: 'vc-recent', style: 'margin-top:16px' }),
  ]));
  const kpiHost = host.querySelector('#vc-kpis');
  const verifyHost = host.querySelector('#vc-verify');
  const queueHost = host.querySelector('#vc-queue');
  const recentHost = host.querySelector('#vc-recent');

  buildVerifyCard();
  loadQueue();
  loadRecent();

  async function buildVerifyCard() {
    if (!manage) { mount(verifyHost, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'You have read-only access. compliance.manage is required to run verifications.'))); return; }
    if (!orgs) { try { orgs = await listCarrierOrgs(); } catch (_) { orgs = []; } }
    const orgSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Select carrier…')].concat((orgs || []).map(o => el('option', { value: o.id }, o.name))));
    const dot = el('input', { class: 'cc-input', placeholder: 'USDOT number' });
    const mc = el('input', { class: 'cc-input', placeholder: 'MC number (optional)' });
    const out = el('div', { style: 'margin-top:10px' });
    const btn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
      if (!orgSel.value) { toast('Pick a carrier.', 'error'); return; }
      if (!dot.value.trim() && !mc.value.trim()) { toast('Enter a USDOT or MC number.', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Checking FMCSA…'; mount(out, el('div', { class: 'cc-sub' }, 'Contacting FMCSA…'));
      try {
        const fm = await fmcsaVerify({ carrierOrg: orgSel.value, dot: dot.value.trim(), mc: mc.value.trim() });
        if (!fm || !fm.carrier) throw new Error('No carrier record returned.');
        const rec = await recordCarrierVerification(orgSel.value, fm.carrier);
        mount(out, resultBlock(fm.carrier, rec));
        loadQueue(); loadRecent();
      } catch (e) {
        const msg = humanizeError(e);
        if (/FMCSA_WEBKEY|not configured|not connected/i.test(msg)) {
          mount(out, el('div', { class: 'lb-card', style: 'border-color:#f59e0b' }, [
            el('b', null, 'FMCSA provider not connected'),
            el('p', { class: 'cc-sub', style: 'margin:6px 0' }, 'Add the free FMCSA WebKey to this project’s Edge Function secrets as FMCSA_WEBKEY (Supabase → Edge Functions → Secrets). Get it at mobile.fmcsa.dot.gov (login.gov → My WebKeys).'),
          ]));
        } else mount(out, el('div', { class: 'lb-state lb-error' }, msg));
      }
      btn.disabled = false; btn.textContent = 'Verify with FMCSA';
    } }, 'Verify with FMCSA');
    mount(verifyHost, card(el('div', null, [
      el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:8px' }, 'Run a verification'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Carrier'), orgSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'USDOT'), dot]),
      el('label', { class: 'cc-field' }, [el('span', null, 'MC'), mc]),
      el('div', { style: 'margin-top:10px' }, btn), out,
    ])));
  }

  function resultBlock(c, rec) {
    const rows = (rec.discrepancies || []).map(d => el('tr', null, [
      el('td', null, el('b', null, d.field)), el('td', null, String(d.submitted || '—')), el('td', null, String(d.official || '—')),
    ]));
    return el('div', { class: 'lb-card', style: 'margin-top:4px' }, [
      el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' }, [pill(rec.status), scorePill(rec.match_score), el('span', { class: 'cc-sub' }, 'FMCSA · just now')]),
      el('div', null, [el('b', null, c.legalName || '—'), el('span', { class: 'cc-sub' }, '  DOT ' + (c.dotNumber || '—') + ' · authority ' + (c.authority || '?') + (c.outOfService ? ' · OUT OF SERVICE' : ''))]),
      rows.length ? el('table', { class: 'cc-table', style: 'margin-top:8px' }, [
        el('thead', null, el('tr', null, ['Field', 'Submitted', 'FMCSA'].map(h => el('th', null, h)))), el('tbody', null, rows),
      ]) : el('div', { class: 'cc-sub', style: 'margin-top:6px;color:#16a34a' }, '✓ No discrepancies — official record matches submitted data.'),
    ]);
  }

  function kvv(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '\u2014' : String(v))]); }
  function renderDiscrepancies(disc) {
    let items = [];
    if (Array.isArray(disc)) items = disc.map(d => (d && typeof d === 'object') ? d : { field: String(d) });
    else if (disc && typeof disc === 'object') items = Object.entries(disc).map(([k, v]) => (v && typeof v === 'object') ? Object.assign({ field: k }, v) : { field: k, official: v });
    if (!items.length) return el('div', { class: 'cc-sub' }, 'No field-level discrepancies recorded.');
    return el('table', { class: 'cc-table cc-table-tight' }, [
      el('thead', null, el('tr', null, ['Field', 'Official (FMCSA)', 'Submitted'].map(h => el('th', null, h)))),
      el('tbody', null, items.map(d => el('tr', null, [
        el('td', null, el('b', null, String(d.field || '\u2014'))),
        el('td', null, String(d.official != null ? d.official : (d.expected != null ? d.expected : '\u2014'))),
        el('td', null, String(d.submitted != null ? d.submitted : (d.actual != null ? d.actual : '\u2014'))),
      ]))),
    ]);
  }
  function openVer(r) {
    const reBtn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Re-verifying\u2026';
      try { await fmcsaVerify({ carrierOrg: r.carrier_org }); const d = document.getElementById('cc-drawer-root'); if (d) d.remove(); loadQueue(); loadRecent(); }
      catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Re-verify against FMCSA'; alert(humanizeError(e)); }
    } }, 'Re-verify against FMCSA');
    const body = el('div', null, [
      kvv('Carrier', r.carrier), kvv('Status', r.status), kvv('Match score', (r.match_score != null ? r.match_score + '%' : '\u2014')),
      kvv('Authority', r.authority), kvv('Reason', r.reason), kvv('Last verified', r.last_verified ? fmtDateTime(r.last_verified) : 'never'),
      el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:14px 0 6px' }, 'Discrepancies \u2014 official FMCSA vs submitted'),
      renderDiscrepancies(r.discrepancies),
      el('div', { style: 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap' }, [reBtn,
        el('a', { class: 'lb-btn lb-btn-secondary', href: '#/carrier?id=' + r.carrier_org, onClick: () => { const d = document.getElementById('cc-drawer-root'); if (d) d.remove(); } }, 'Open carrier 360 \u2192')]),
      el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Verification is advisory \u2014 it never auto-activates a carrier. A person approves activation.'),
    ]);
    openDrawer('Verification \u2014 ' + (r.carrier || 'carrier'), body, { subtitle: 'FMCSA QCMobile check' });
  }

  async function loadQueue() {
    showLoading(queueHost, 'Loading review queue…');
    let rows; try { rows = await verificationQueue(100); } catch (e) { showError(queueHost, humanizeError(e), loadQueue); return; }
    rows = rows || [];
    mount(queueHost, card(el('div', null, [
      el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:8px' }, 'Review queue (' + rows.length + ')'),
      rows.length ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Carrier', 'Status', 'Score', 'Reason', 'Last verified'].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(r => el('tr', { class: 'cc-row-click', onClick: () => openVer(r) }, [
          el('td', null, el('b', null, r.carrier)), el('td', null, pill(r.status)), el('td', null, scorePill(r.match_score)),
          el('td', null, el('span', { class: 'cc-sub' }, r.reason)), el('td', null, r.last_verified ? fmtDateTime(r.last_verified) : '—'),
        ]))),
      ]) : el('div', { class: 'cc-sub', style: 'padding:6px' }, 'All carriers verified and current. Nothing in the queue.'),
    ])));
  }

  async function loadRecent() {
    let rows; try { rows = await listCarrierVerifications({ limit: 50 }); } catch (e) { mount(recentHost, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
    rows = rows || [];
    const verified = rows.filter(r => r.status === 'verified').length;
    const disc = rows.filter(r => r.status === 'discrepancy').length;
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'shield', label: 'Verifications', value: String(rows.length), sub: 'recorded', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Clean', value: String(verified), sub: 'no discrepancy', accent: 'green' }),
      statCard({ icon: 'flag', label: 'Flagged', value: String(disc), sub: 'need review', accent: disc ? 'red' : 'gray' }),
      statCard({ icon: 'doc', label: 'Source', value: 'FMCSA', sub: 'official QCMobile API', accent: 'violet' }),
    ]));
    if (!rows.length) { mount(recentHost, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No verifications yet. Run one on the left.'))); return; }
    mount(recentHost, card(el('div', null, [
      el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:8px' }, 'Recent verifications'),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Carrier', 'DOT', 'Legal name (FMCSA)', 'Authority', 'OOS', 'Score', 'Status', 'When'].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(r => el('tr', null, [
          el('td', null, el('b', null, r.carrier)), el('td', null, r.dot || '—'), el('td', null, r.legal_name || '—'),
          el('td', null, r.authority || '—'), el('td', null, r.out_of_service ? el('span', { class: 'cc-pill cc-pill-red' }, 'yes') : 'no'),
          el('td', null, scorePill(r.match_score)), el('td', null, pill(r.status)), el('td', null, fmtDateTime(r.verified_at)),
        ]))),
      ]),
    ])));
  }
}

export default renderVerificationCenter;
