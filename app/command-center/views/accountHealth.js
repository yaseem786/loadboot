// accountHealth.js — C7/cxi: Amazon-style ACCOUNT HEALTH for every account holder (carrier /
// broker / shipper), LIVE-computed worst-first. Staff can issue warnings/violations (written
// reason required; the account is notified instantly) and resolve them — score restores live.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard } from '../../shared/ui/components.js';
import { accountHealthBoard, issueViolation, resolveViolation, onboardingBoard, onboardingReviewItem } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const TIER = { healthy: ['#16a34a', '#f0fdf4'], at_risk: ['#d97706', '#fffbeb'], critical: ['#dc2626', '#fef2f2'] };

export function renderAccountHealth(host) {
  const manage = can('dispatch.manage') || can('carriers.manage');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const onbCard = el('div', { class: 'lb-card', style: 'margin:10px 0' });
  const body = el('div');
  mount(host, el('div', null, [
    sectionHead('Account Health', 'Every account holder — carrier, broker, shipper — scored LIVE against its own industry duties. Score = 100 minus itemized deductions (real rows + the staff violations ledger). Issue a warning/violation with a written reason; the account is notified instantly and the score updates on the next view.'),
    onbCard, kpis, body,
  ]));
  load();
  loadOnb();

  async function loadOnb() {
    mount(onbCard, el('div', null, [el('h3', { style: 'margin:0 0 6px' }, 'Onboarding packets (SOP D2)'), el('div', { class: 'cc-sub' }, 'Loading…')]));
    let rows; try { rows = await onboardingBoard(null); } catch (e) { mount(onbCard, el('div', null, [el('h3', { style: 'margin:0 0 6px' }, 'Onboarding packets'), el('div', { class: 'cc-sub' }, humanizeError(e))])); return; }
    rows = (rows || []).filter(r => !r.complete || Number(r.submitted_awaiting) > 0);
    const head = el('h3', { style: 'margin:0 0 6px' }, 'Onboarding packets — ' + rows.length + ' account(s) incomplete / awaiting review');
    if (!rows.length) { mount(onbCard, el('div', null, [head, el('div', { class: 'cc-sub' }, 'Every active account has a complete mandatory packet. ✓')])); return; }
    mount(onbCard, el('div', null, [head].concat(rows.slice(0, 25).map(r => el('div', { style: 'display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--lb-border,#e2e8f0);flex-wrap:wrap' }, [
      el('div', null, [el('b', null, (r.name || r.org) + ' (' + r.kind + ')'),
        el('div', { class: 'cc-sub' }, r.mandatory_done + ' of ' + r.mandatory_total + ' mandatory verified · ' + r.submitted_awaiting + ' awaiting review')]),
      el('span', { class: 'cc-sub' }, r.complete ? 'complete ✓' : 'INCOMPLETE'),
    ])))));
  }

  async function load() {
    showLoading(body, 'Scoring every account from real rows…');
    let rows; try { rows = await accountHealthBoard(200); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = Array.isArray(rows) ? rows : [];
    const n = (t) => rows.filter(r => r.tier === t).length;
    mount(kpis, [
      statCard({ icon: 'users', label: 'Accounts scored', value: String(rows.length), sub: 'carriers + brokers + shippers', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Healthy', value: String(n('healthy')), sub: '90+', accent: 'green' }),
      statCard({ icon: 'alert', label: 'At risk', value: String(n('at_risk')), sub: '70–89', accent: 'amber' }),
      statCard({ icon: 'alert', label: 'Critical', value: String(n('critical')), sub: 'below 70', accent: 'red' }),
    ]);
    mount(body, el('div', null, rows.map(r => {
      const [c, bg] = TIER[r.tier] || TIER.healthy;
      const ded = Array.isArray(r.deductions) ? r.deductions : [];
      const note = el('input', { class: 'cc-input', placeholder: 'Written reason (required)', style: 'max-width:260px' });
      const kindSel = el('select', { class: 'cc-input', style: 'max-width:120px' }, ['policy', 'safety', 'document', 'service', 'conduct', 'legal'].map(k => el('option', { value: k }, k)));
      const sevSel = el('select', { class: 'cc-input', style: 'max-width:120px' }, [['warning', 'Warning −5'], ['violation', 'Violation −15'], ['critical', 'Critical −40']].map(([v, l]) => el('option', { value: v }, l)));
      const issueBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
        if (!note.value.trim()) { toast('Written reason is required', 'error'); return; }
        ev.currentTarget.disabled = true;
        try { await issueViolation(r.org, kindSel.value, sevSel.value, note.value.trim()); toast('Issued — account notified', 'success'); load(); }
        catch (e) { toast(humanizeError(e), 'error'); ev.currentTarget.disabled = false; }
      } }, 'Issue') : null;
      return el('div', { class: 'lb-card', style: 'margin:10px 0;border-left:5px solid ' + c }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
          el('div', { style: 'display:flex;align-items:center;gap:12px' }, [
            el('div', { style: 'width:52px;height:52px;border-radius:50%;border:4px solid ' + c + ';display:flex;align-items:center;justify-content:center;font-weight:800;color:' + c }, String(r.score)),
            el('div', null, [
              el('div', { style: 'font-weight:700' }, (r.kind || '').toUpperCase() + ' · ' + (r.org || '').slice(0, 8) + '…'),
              el('span', { style: 'font-size:.78rem;font-weight:700;color:' + c + ';background:' + bg + ';padding:2px 10px;border-radius:99px' }, (r.tier || '').replace('_', ' ').toUpperCase()),
            ]),
          ]),
          manage ? el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [kindSel, sevSel, note, issueBtn]) : el('span', { class: 'cc-sub' }, 'view only'),
        ]),
        ded.length ? el('div', { style: 'margin-top:8px' }, ded.map(x => el('div', { class: 'cc-sub' }, '− ' + x.deducted + ' · ' + x.label + ' — ' + (x.basis || '')))) : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No deductions — clean account.'),
      ]);
    })));
  }
}

export default renderAccountHealth;
