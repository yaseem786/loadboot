// accountHealth.js — Amazon-style ACCOUNT HEALTH per account holder, LIVE-computed worst-first.
// Clickable/expandable detail + SUGGESTED warning that pre-fills the issue form from real deductions.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard } from '../../shared/ui/components.js';
import { accountHealthBoard, issueViolation, resolveViolation, onboardingBoard, onboardingReviewItem } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const TIER = { healthy: ['#16a34a', '#f0fdf4'], at_risk: ['#d97706', '#fffbeb'], critical: ['#dc2626', '#fef2f2'] };
const M = '−';

function suggestWarning(ded) {
  const txt = (ded || []).map(d => (d.label || '') + ' ' + (d.basis || '')).join(' ').toLowerCase();
  if (/complian|authorit|insur|document|coi|w-?9|bond|packet|expir/.test(txt))
    return { kind: 'document', sev: 'warning', reason: 'Required compliance documents (authority / insurance / onboarding packet) are not current. Please upload and get them verified to restore your standing.' };
  if (/on-?time|deliver|late|dwell|service/.test(txt))
    return { kind: 'service', sev: 'warning', reason: 'On-time delivery performance is below our standard. Please improve scheduling and keep dispatch updated on upcoming loads.' };
  if (/safety|accident|inspection|violation/.test(txt))
    return { kind: 'safety', sev: 'violation', reason: 'A safety concern was identified on your account. Please review and correct it to avoid further action.' };
  if (/dispute|invoice|payment|settle|billing/.test(txt))
    return { kind: 'policy', sev: 'warning', reason: 'Open billing / payment items need your attention. Please resolve them to stay in good standing.' };
  return null;
}

export function renderAccountHealth(host) {
  const manage = can('dispatch.manage') || can('carriers.manage');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const onbCard = el('div', { class: 'lb-card', style: 'margin:10px 0' });
  const body = el('div');
  mount(host, el('div', null, [
    sectionHead('Account Health', 'Every account holder scored LIVE against its own industry duties. Score = 100 minus itemized deductions. Click an account to expand full detail; issue a warning/violation with a written reason and the account is notified instantly.'),
    onbCard, kpis, body,
  ]));
  load();
  loadOnb();

  const orgLink = (kind, org) => (kind === 'carrier') ? ('#/carrier?id=' + org) : '#/partners';

  async function loadOnb() {
    mount(onbCard, el('div', null, [el('h3', { style: 'margin:0 0 6px' }, 'Onboarding packets (SOP D2)'), el('div', { class: 'cc-sub' }, 'Loading...')]));
    let rows; try { rows = await onboardingBoard(null); } catch (e) { mount(onbCard, el('div', null, [el('h3', { style: 'margin:0 0 6px' }, 'Onboarding packets'), el('div', { class: 'cc-sub' }, humanizeError(e))])); return; }
    rows = (rows || []).filter(r => !r.complete || Number(r.submitted_awaiting) > 0);
    const head = el('h3', { style: 'margin:0 0 6px' }, 'Onboarding packets — ' + rows.length + ' account(s) incomplete / awaiting review');
    if (!rows.length) { mount(onbCard, el('div', null, [head, el('div', { class: 'cc-sub' }, 'Every active account has a complete mandatory packet.')])); return; }
    mount(onbCard, el('div', null, [head].concat(rows.slice(0, 25).map(r => el('a', {
      href: orgLink(r.kind, r.org), class: 'cc-search-row',
      style: 'display:flex;justify-content:space-between;gap:8px;padding:8px 6px;border-bottom:1px solid var(--lb-border,#e2e8f0);flex-wrap:wrap;text-decoration:none' }, [
      el('div', null, [el('b', null, (r.name || r.org) + ' (' + r.kind + ')'),
        el('div', { class: 'cc-sub' }, r.mandatory_done + ' of ' + r.mandatory_total + ' mandatory verified · ' + r.submitted_awaiting + ' awaiting review')]),
      el('span', { class: 'cc-sub', style: 'display:flex;align-items:center;gap:8px' }, [r.complete ? 'complete' : 'INCOMPLETE', el('span', { class: 'cc-row-go' }, '›')]),
    ])))));
  }

  async function load() {
    showLoading(body, 'Scoring every account from real rows...');
    let rows; try { rows = await accountHealthBoard(200); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = Array.isArray(rows) ? rows : [];
    const n = (t) => rows.filter(r => r.tier === t).length;
    mount(kpis, [
      statCard({ icon: 'users', label: 'Accounts scored', value: String(rows.length), sub: 'carriers + brokers + shippers', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Healthy', value: String(n('healthy')), sub: '90+', accent: 'green' }),
      statCard({ icon: 'alert', label: 'At risk', value: String(n('at_risk')), sub: '70-89', accent: 'amber' }),
      statCard({ icon: 'alert', label: 'Critical', value: String(n('critical')), sub: 'below 70', accent: 'red' }),
    ]);
    mount(body, el('div', null, rows.map(r => {
      const tier = TIER[r.tier] || TIER.healthy;
      const c = tier[0], bg = tier[1];
      const ded = Array.isArray(r.deductions) ? r.deductions : [];
      const sug = suggestWarning(ded);
      const nameLabel = r.name || ((r.kind || '').toUpperCase() + ' · ' + (r.org || '').slice(0, 8) + '...');

      const note = el('input', { class: 'cc-input', placeholder: sug ? 'Suggested reason pre-filled - edit if needed' : 'Written reason (required)', style: 'max-width:260px' });
      if (sug) note.value = sug.reason;
      const kindSel = el('select', { class: 'cc-input', style: 'max-width:120px' }, ['policy', 'safety', 'document', 'service', 'conduct', 'legal'].map(k => el('option', { value: k, selected: sug && sug.kind === k ? 'selected' : null }, k)));
      const sevSel = el('select', { class: 'cc-input', style: 'max-width:120px' }, [['warning', 'Warning ' + M + '5'], ['violation', 'Violation ' + M + '15'], ['critical', 'Critical ' + M + '40']].map(function (o) { return el('option', { value: o[0], selected: sug && sug.sev === o[0] ? 'selected' : null }, o[1]); }));
      const issueBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
        if (!note.value.trim()) { toast('Written reason is required', 'error'); return; }
        ev.currentTarget.disabled = true;
        try { await issueViolation(r.org, kindSel.value, sevSel.value, note.value.trim()); toast('Issued - account notified', 'success'); load(); }
        catch (e) { toast(humanizeError(e), 'error'); ev.currentTarget.disabled = false; }
      } }, 'Issue') : null;

      const detail = el('div', { hidden: true, style: 'margin-top:10px;border-top:1px dashed var(--lb-border,#e2e8f0);padding-top:10px' }, [
        el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Why this score'),
        ded.length ? el('div', null, ded.map(x => el('div', { class: 'cc-sub' }, M + ' ' + x.deducted + ' · ' + x.label + ' — ' + (x.basis || '')))) : el('div', { class: 'cc-sub' }, 'No deductions - clean account.'),
        sug ? el('div', { style: 'margin-top:8px;padding:8px 10px;border-radius:8px;background:' + bg + ';color:' + c }, [el('b', null, 'Suggested: '), 'send a ' + sug.sev + ' (' + sug.kind + '). Reason pre-filled below - review & Issue.']) : '',
        el('div', { style: 'margin-top:8px;display:flex;gap:14px;flex-wrap:wrap' }, [
          el('a', { href: orgLink(r.kind, r.org), style: 'color:var(--lb-blue,#0883F7);font-weight:600' }, (r.kind === 'carrier' ? 'Open Carrier 360 →' : 'Open partner record →')),
          el('a', { href: '#/documents', style: 'color:var(--lb-blue,#0883F7);font-weight:600' }, 'Documents →'),
        ]),
      ]);
      const toggle = el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: () => { detail.hidden = !detail.hidden; toggle.textContent = detail.hidden ? 'Details ▾' : 'Hide ▴'; } }, 'Details ▾');

      return el('div', { class: 'lb-card', style: 'margin:10px 0;border-left:5px solid ' + c }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
          el('div', { style: 'display:flex;align-items:center;gap:12px' }, [
            el('div', { style: 'width:52px;height:52px;border-radius:50%;border:4px solid ' + c + ';display:flex;align-items:center;justify-content:center;font-weight:800;color:' + c }, String(r.score)),
            el('div', null, [
              el('a', { href: orgLink(r.kind, r.org), style: 'font-weight:700;color:inherit;text-decoration:none' }, nameLabel),
              el('div', null, [
                el('span', { style: 'font-size:.72rem;font-weight:700;color:#64748b;text-transform:uppercase;margin-right:6px' }, r.kind),
                el('span', { style: 'font-size:.78rem;font-weight:700;color:' + c + ';background:' + bg + ';padding:2px 10px;border-radius:99px' }, (r.tier || '').replace('_', ' ').toUpperCase()),
              ]),
            ]),
          ]),
          el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [toggle,
            manage ? el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [kindSel, sevSel, note, issueBtn]) : el('span', { class: 'cc-sub' }, 'view only')]),
        ]),
        ded.length ? el('div', { style: 'margin-top:8px' }, ded.slice(0, 2).map(x => el('div', { class: 'cc-sub' }, M + ' ' + x.deducted + ' · ' + x.label + ' — ' + (x.basis || '')))) : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No deductions - clean account.'),
        detail,
      ]);
    })));
  }
}

export default renderAccountHealth;
