// compliance.js — Wave 2 Carrier Onboarding & Compliance. Onboarding queue + per-carrier
// compliance checklist (MC authority, COI, W-9, MCS-150, safety) with expiry tracking,
// document verification, and a human-approval gate. Reads/writes via cc_compliance_* /
// cc_*_onboarding RPCs (compliance.view / verify / approve), all RBAC-gated + audited.
// Starting onboarding and verifying docs emit domain events into the Automation Core
// (review task, expiry renewal task, and an approval-gate task that requires_approval).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, fmtDate, fmtDateTime, card } from '../../shared/ui/components.js';
import { complianceOverview, listOnboarding, getCarrierCompliance, startOnboarding, setCompliance, decideOnboarding, getCarriersDirectory } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STAGES = [
  { value: '', label: 'All' }, { value: 'submitted', label: 'Submitted' }, { value: 'compliance_check', label: 'In review' },
  { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
];
const STAGE_TONE = { submitted: 'amber', docs_review: 'amber', compliance_check: 'blue', approved: 'green', rejected: 'red', not_started: 'gray' };
const REQ_TONE = { valid: 'green', pending: 'amber', missing: 'gray', expired: 'red', rejected: 'red' };
const STATUSES = ['valid', 'pending', 'expired', 'rejected', 'missing'];

function daysUntil(d) { if (!d) return null; return Math.round((new Date(d) - new Date()) / 86400000); }

export function renderCompliance(host) {
  let state = { stage: '', search: '' };
  const kpiHost = el('div');
  const listHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await complianceOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'truck', label: 'In onboarding', value: String(n('in_onboarding')), sub: n('approved') + ' approved', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Pending checks', value: String(n('pending_checks')), sub: 'documents to verify', accent: 'amber' }),
      statCard({ icon: 'shield', label: 'Expiring (30d)', value: String(n('expiring_30')), sub: 'renew soon', accent: 'violet' }),
      statCard({ icon: 'flag', label: 'Expired', value: String(n('expired')), sub: 'out of compliance', accent: n('expired') > 0 ? 'red' : 'green' }),
    ]));
  }

  function header() {
    const actions = can('compliance.verify') ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: openStart }, '+ Start onboarding')] : null;
    return el('div', null, [
      sectionHead('Carrier Onboarding & Compliance', 'Onboarding queue, document verification and expiry tracking. New onboardings auto-create a review task.', actions),
      kpiHost,
      toolbar([ searchBox('Search carrier…', (v) => { state.search = v; loadList(); }), segmented(STAGES, state.stage, (v) => { state.stage = v; loadList(); }) ]),
    ]);
  }

  async function loadList() {
    showLoading(listHost, 'Loading onboarding queue…');
    let rows; try { rows = await listOnboarding({ stage: state.stage || null, search: state.search || null, limit: 300 }); }
    catch (e) { showError(listHost, humanizeError(e), loadList); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No carriers in onboarding yet. Start one to begin compliance review.'); return; }
    mount(listHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [ el('th', null, 'Carrier'), el('th', null, 'Stage'), el('th', null, 'Mandatory docs'), el('th', null, 'Expiring'), el('th', null, 'Submitted'), el('th', null, '') ])),
      el('tbody', null, rows.map(c => {
        const ok = c.mandatory_ok;
        return el('tr', { class: 'cc-row', onClick: () => openCarrier(c.carrier_id) }, [
          el('td', null, el('b', null, c.carrier_name)),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (STAGE_TONE[c.stage] || 'gray') }, (c.stage || '').replace('_', ' '))),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ok ? 'green' : 'amber') }, (c.mandatory_valid || 0) + ' / ' + (c.mandatory_total || 0))),
          el('td', null, (c.expiring || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-violet' }, c.expiring + ' soon') : '—'),
          el('td', null, fmtDate(c.submitted_at)),
          el('td', null, el('span', { class: 'cc-row-go' }, '›')),
        ]);
      })),
    ]));
  }

  // start onboarding for a carrier that isn't in the queue yet
  async function openStart() {
    const { body } = openDrawer('Start onboarding', el('div', { class: 'lb-state lb-loading' }, 'Loading carriers…'), { subtitle: 'Pick a carrier to begin compliance review' });
    let carriers; try { carriers = await getCarriersDirectory({ limit: 200 }); }
    catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const search = el('input', { class: 'cc-input', placeholder: 'Search carrier…' });
    const listWrap = el('div', { class: 'cc-doclist' });
    const draw = (q) => {
      const items = (carriers || []).filter(c => !q || (c.name || '').toLowerCase().includes(q.toLowerCase()));
      mount(listWrap, items.length ? items.map(c => el('div', { class: 'cc-doc-item cc-row', onClick: async () => {
        try { await startOnboarding(c.id); toast('Onboarding started · review task queued', 'success'); openCarrier(c.id); loadList(); loadKpis(); }
        catch (e) { toast(humanizeError(e), 'error'); }
      } }, [ el('div', null, [el('b', null, c.name), el('div', { class: 'cc-sub' }, (c.status || '') )]), el('span', { class: 'cc-row-go' }, '›') ]))
        : el('div', { class: 'cc-sub' }, 'No carriers match.'));
    };
    search.addEventListener('input', () => draw(search.value));
    mount(body, el('div', null, [ el('div', { class: 'cc-form' }, [search]), listWrap ]));
    draw('');
  }

  async function openCarrier(id) {
    const { body } = openDrawer('Carrier compliance', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Documents, expiry & approval' });
    let c; try { c = await getCarrierCompliance(id); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const reqs = c.requirements || [];

    const reqRow = (r) => {
      const tone = REQ_TONE[r.status] || 'gray';
      const d = daysUntil(r.expiry_date);
      const expiryLabel = r.expiry_date ? (d != null && d < 0 ? 'expired ' + fmtDate(r.expiry_date) : (d != null && d <= 30 ? 'expires in ' + d + 'd' : 'valid to ' + fmtDate(r.expiry_date))) : (r.requires_expiry ? 'no expiry set' : '');
      const verify = can('compliance.verify') ? el('button', { class: 'cc-chip-btn', onClick: () => openVerify(id, r) }, 'Verify') : '';
      return el('div', { class: 'cc-doc-item' }, [
        el('div', null, [
          el('b', null, [r.name, r.mandatory ? '' : el('span', { class: 'cc-sub', style: 'margin-left:6px' }, '(optional)')]),
          el('div', { class: 'cc-sub' }, [expiryLabel, r.note ? ' · ' + r.note : '']),
        ]),
        el('div', { class: 'cc-status-row' }, [ el('span', { class: 'cc-pill cc-pill-' + tone }, r.status), verify ]),
      ]);
    };

    const canApprove = can('compliance.approve') && c.stage !== 'approved' && c.stage !== 'rejected';
    const gate = canApprove ? el('div', { class: 'cc-status-row', style: 'margin-top:14px' }, [
      el('button', { class: 'lb-btn lb-btn-primary', disabled: !c.mandatory_ok, title: c.mandatory_ok ? '' : 'All mandatory documents must be valid first',
        onClick: () => decide(id, 'approve') }, c.mandatory_ok ? 'Approve onboarding' : 'Approve (mandatory incomplete)'),
      el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => decide(id, 'reject') }, 'Reject'),
    ]) : '';

    const decided = (c.stage === 'approved' || c.stage === 'rejected')
      ? el('div', { class: 'cc-sub', style: 'margin-top:10px' }, 'Decision: ' + c.stage + (c.decided_at ? ' · ' + fmtDateTime(c.decided_at) : '') + (c.decision_note ? ' · ' + c.decision_note : '')) : '';

    mount(body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, c.carrier_name), el('span', { class: 'cc-pill cc-pill-' + (STAGE_TONE[c.stage] || 'gray') }, (c.stage || '').replace('_', ' '))]),
      card([
        el('div', { class: 'cc-field' }, [el('span', null, 'Mandatory complete'), el('b', null, c.mandatory_ok ? 'Yes' : 'No')]),
        el('div', { class: 'cc-field' }, [el('span', null, 'Submitted'), el('b', null, fmtDate(c.submitted_at))]),
      ], 'cc-fields'),
      el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Compliance checklist'),
      el('div', { class: 'cc-doclist' }, reqs.map(reqRow)),
      gate, decided,
    ]));

    async function decide(cid, decision) {
      try { await decideOnboarding(cid, decision, null); toast('Onboarding ' + decision + 'd', 'success'); openCarrier(cid); loadList(); loadKpis(); }
      catch (e) { toast(humanizeError(e), 'error'); }
    }
  }

  // verify one requirement: set status + optional expiry + note
  function openVerify(carrierId, r) {
    const f = { status: 'valid', expiry: r.expiry_date || '', note: r.note || '' };
    const sel = el('select', { class: 'cc-input' }, STATUSES.map(s => el('option', { value: s, selected: s === f.status }, s)));
    sel.addEventListener('change', () => f.status = sel.value);
    const exp = el('input', { class: 'cc-input', type: 'date', value: f.expiry });
    exp.addEventListener('input', () => f.expiry = exp.value);
    const note = el('input', { class: 'cc-input', placeholder: 'Note (policy #, carrier, etc.)', value: f.note });
    note.addEventListener('input', () => f.note = note.value);
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
      try { await setCompliance({ carrier: carrierId, requirement: r.key, status: f.status, expiry: f.expiry || null, note: f.note || null });
        toast(r.name + ' → ' + f.status, 'success'); drawer.close(); openCarrier(carrierId); loadKpis();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save'; }
    } }, 'Save');
    const drawer = openDrawer('Verify document', el('div', { class: 'cc-form' }, [
      el('div', { class: 'cc-field' }, [el('span', null, 'Requirement'), el('b', null, r.name)]),
      el('label', { class: 'cc-sub' }, 'Status'), sel,
      r.requires_expiry ? el('label', { class: 'cc-sub' }, 'Expiry date') : '', r.requires_expiry ? exp : '',
      note, err, submit,
    ]), { subtitle: 'Sets verification status (RBAC + audited)' });
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), listHost]));
  loadKpis(); loadList();
}

export default renderCompliance;
