// loadPilot.js — AI Load Pilot drawer. Max input → max output: load economics (RPM, est. margin), data trust,
// source reliability, lane history, timing, completeness — each factor itemized with points — plus a carrier
// PUSH ranking that folds in each carrier's last known location (real deadhead when coords exist) and their
// stated dispatch preferences. Every estimate is labeled; assumptions are shown and tunable.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading } from '../../shared/loading.js';
import { openDrawer } from '../../shared/ui/components.js';
import { loadAdvisor, offerSend, dispatchPlan } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const REC_TONE = { take: 'green', negotiate: 'amber', skip: 'red' };

export async function openLoadPilot(load, overrides) {
  const body = el('div');
  openDrawer('AI Load Pilot', body, { subtitle: (load.origin || '?') + ' → ' + (load.destination || '?') });
  showLoading(body, 'Analyzing load, carriers, locations and preferences…');
  let a; try { a = await loadAdvisor(load.id, overrides); } catch (e) { mount(body, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
  const canOffer = can('dispatch.manage');

  const recBanner = el('div', { class: 'lb-card', style: 'display:flex;justify-content:space-between;align-items:center;border-left:5px solid ' + (a.recommendation === 'take' ? '#16a34a' : a.recommendation === 'negotiate' ? '#d97706' : '#dc2626') }, [
    el('div', null, [
      el('div', { style: 'font-size:20px;font-weight:800;text-transform:uppercase' }, a.recommendation),
      el('div', { class: 'cc-sub' }, (a.loaded_rpm != null ? ('$' + a.loaded_rpm + '/mi loaded · ') : '') + (a.rate != null ? ('$' + Number(a.rate).toLocaleString()) : 'no rate') + (a.miles ? (' · ' + a.miles + ' mi') : '')),
      a.suggested_counter_rate ? el('div', { style: 'font-weight:700;color:#d97706;margin-top:4px' }, 'Suggested counter: $' + Number(a.suggested_counter_rate).toLocaleString()) : null,
    ].filter(Boolean)),
    el('div', { style: 'text-align:right' }, [el('div', { style: 'font-size:26px;font-weight:800' }, a.score + '/' + a.score_max), el('div', { class: 'cc-sub' }, 'load score')]),
  ]);

  const factorRows = (a.factors || []).map(f => el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px dashed #e2e8f0' }, [
    el('span', null, [el('b', null, f.factor), el('span', { class: 'cc-sub' }, ' — ' + (f.detail || ''))]),
    el('b', { style: 'white-space:nowrap' }, f.points + '/' + f.max),
  ]));

  const pushCards = (a.push_ranking || []).map((c, i) => el('div', { class: 'lb-card', style: 'margin-bottom:8px' + (i === 0 ? ';border:2px solid #2563eb' : '') }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      el('div', null, [el('b', null, (i === 0 ? '★ ' : '') + c.carrier), el('div', { class: 'cc-sub' }, c.pref_notes || '')]),
      el('div', { style: 'text-align:right' }, [el('div', { style: 'font-weight:800;font-size:18px' }, String(c.push_score)), el('div', { class: 'cc-sub' }, 'push score')]),
    ]),
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' }, [
      c.deadhead_miles != null ? el('span', { class: 'cc-pill cc-pill-' + (c.deadhead_miles < 50 ? 'green' : c.deadhead_miles < 150 ? 'amber' : 'red'), title: c.deadhead_basis || '' }, '~' + Math.round(c.deadhead_miles) + ' mi deadhead') : el('span', { class: 'cc-pill cc-pill-gray' }, 'deadhead unknown'),
      c.all_in_rpm != null ? el('span', { class: 'cc-pill cc-pill-gray' }, '$' + c.all_in_rpm + '/mi all-in (est.)') : null,
      el('span', { class: 'cc-pill cc-pill-' + (String(c.pref_fit || '').startsWith('BELOW') ? 'red' : c.pref_fit === 'fits stated preferences' ? 'green' : 'gray') }, c.pref_fit || ''),
    ].filter(Boolean)),
    canOffer ? el('div', { style: 'margin-top:8px;text-align:right' }, el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async () => {
      try { const r = await offerSend(load.id, [c.carrier_id], load.rate || null, 60); toast(r.sent ? 'Offer pushed to ' + c.carrier : 'Carrier no longer eligible', r.sent ? 'success' : 'error'); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, 'Push offer')) : null,
  ].filter(Boolean)));

  mount(body, el('div', null, [
    recBanner,
    (a.flags && a.flags.length) ? el('div', { class: 'lb-card', style: 'background:#fef2f2;margin-top:8px' }, [
      el('b', { style: 'color:#dc2626' }, 'Flags'), el('div', { class: 'cc-sub' }, a.flags.join(' · '))]) : null,
    el('div', { class: 'lb-card', style: 'margin-top:8px' }, [el('b', null, 'Why this recommendation'), el('div', { style: 'margin-top:6px' }, factorRows)]),
    el('div', { class: 'cc-sub', style: 'margin:10px 0 4px' }, 'Lane history: ' + ((a.lane_history || {}).delivered_trips || 0) + ' delivered trip(s)' + ((a.lane_history || {}).avg_rate ? ' · avg $' + a.lane_history.avg_rate : '')),
    el('div', { style: 'margin-top:10px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
        el('b', null, 'Who to push this load to'),
        el('span', { class: 'cc-pill cc-pill-' + (REC_TONE[a.recommendation] || 'gray') }, a.push_recommendation || ''),
      ]),
      pushCards.length ? el('div', null, pushCards) : el('div', { class: 'lb-state' }, 'No eligible carriers.'),
    ]),
    el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Assumptions: $' + a.assumptions.cost_per_mile + '/mi cost · $' + a.assumptions.target_rpm + '/mi target · deadhead is a straight-line ESTIMATE from the carrier’s last trip GPS. Every figure above is explained — nothing is a black box.'),
    whatIf(load, a),
  ].filter(Boolean)));
}

// What-if controls: tune the assumptions and re-run the SAME deterministic analysis — no hidden state.
function whatIf(load, a) {
  const num = (label, key, val) => {
    const i = el('input', { class: 'cc-input', type: 'number', step: '0.05', value: String(val), style: 'max-width:110px' });
    return { field: el('label', { class: 'cc-field', style: 'flex:1' }, [el('span', null, label), i]), get: () => i.value, key };
  };
  const c1 = num('Cost $/mi', 'cost_per_mile', a.assumptions.cost_per_mile);
  const c2 = num('Target $/mi', 'target_rpm', a.assumptions.target_rpm);
  const c3 = num('Max deadhead mi', 'max_deadhead', a.assumptions.max_deadhead);
  return el('div', { class: 'lb-card', style: 'margin-top:10px' }, [
    el('b', null, 'What-if — tune assumptions'),
    el('div', { style: 'display:flex;gap:8px;margin-top:6px;align-items:flex-end' }, [
      c1.field, c2.field, c3.field,
      el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => openLoadPilot(load, {
        cost_per_mile: c1.get(), target_rpm: c2.get(), max_deadhead: c3.get() }) }, 'Re-analyze'),
    ]),
  ]);
}

// FLEET DISPATCH PLAN drawer — one click: every open load paired to the best eligible carrier (greedy,
// capacity-aware, fully itemized). A PROPOSAL — the dispatcher pushes offers; nothing books automatically.
export async function openFleetPlan(onOffer) {
  const body = el('div');
  openDrawer('AI Fleet Plan', body, { subtitle: 'Who should haul what — explained' });
  showLoading(body, 'Planning across all open loads and eligible carriers…');
  let p; try { p = await dispatchPlan(20); } catch (e) { mount(body, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
  const canOffer = can('dispatch.manage');
  const rows = (p.plan || []).map(x => el('div', { class: 'lb-card', style: 'margin-bottom:8px' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      el('div', null, [el('b', null, x.lane), el('div', { class: 'cc-sub' }, (x.equipment || '—') + (x.rate != null ? ' · $' + Number(x.rate).toLocaleString() : '') + (x.loaded_rpm != null ? ' · $' + x.loaded_rpm + '/mi' : ''))]),
      el('div', { style: 'text-align:right' }, [el('b', null, '→ ' + x.carrier), el('div', { class: 'cc-sub' }, 'push score ' + x.push_score)]),
    ]),
    el('div', { class: 'cc-sub', style: 'margin-top:6px' }, (x.explanation || []).join(' · ')),
    canOffer ? el('div', { style: 'margin-top:8px;text-align:right' }, el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async () => {
      try { const r = await offerSend(x.load, [x.carrier_id], x.rate || null, 60); toast(r.sent ? 'Offer pushed to ' + x.carrier : 'Carrier no longer eligible', r.sent ? 'success' : 'error'); if (onOffer) onOffer(); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, 'Push offer')) : null,
  ].filter(Boolean)));
  const unassigned = (p.unassigned || []).map(u => el('div', { class: 'cc-sub' }, u.lane + ' — ' + u.reason));
  mount(body, el('div', null, [
    el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, p.note || ''),
    el('div', { style: 'display:flex;gap:14px;margin-bottom:10px' }, [
      el('b', null, p.assigned + '/' + p.loads_considered + ' loads planned'),
      el('span', { class: 'cc-sub' }, 'total push score ' + p.total_push_score),
    ]),
    rows.length ? el('div', null, rows) : el('div', { class: 'lb-state' }, 'No open loads to plan.'),
    unassigned.length ? el('div', { class: 'lb-card', style: 'margin-top:8px;background:#fffbeb' }, [el('b', null, 'Unassigned'), ...unassigned]) : null,
  ].filter(Boolean)));
}

export default openLoadPilot;
