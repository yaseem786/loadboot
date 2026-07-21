// matchCenter.js — Match Center (Increments 45–46). For a given load, shows ranked ELIGIBLE carriers as cards
// with an explainable score breakdown (deadhead/ETA honestly marked unavailable — no invented GPS), and a
// collapsible list of INELIGIBLE carriers with their exact hard-fail reasons. An ineligible carrier is never
// presented as offerable. Rendered as a drawer opened from Load Intake (openMatch) or standalone.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading } from '../../shared/loading.js';
import { openDrawer, askReason, askConfirm } from '../../shared/ui/components.js';
import { matchRank, matchEligibility, offerSend, loadOffers } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const EQ_TONE = { match: 'green', no_match: 'red', unknown: 'gray' };

export async function openMatch(load) {
  const body = el('div');
  openDrawer('Match Center', body, { subtitle: (load.origin || '?') + ' → ' + (load.destination || '?') + (load.equipment ? ' · ' + load.equipment : '') });
  showLoading(body, 'Ranking eligible carriers…');
  let ranked, elig;
  try { [ranked, elig] = await Promise.all([matchRank(load.id), matchEligibility(load.id)]); }
  catch (e) { mount(body, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
  ranked = ranked || []; elig = elig || [];
  const ineligible = elig.filter(c => !c.eligible);
  const canOffer = can('dispatch.manage');
  let offers = [];
  try { offers = (await loadOffers(load.id)) || []; } catch (_) { offers = []; }
  const offerFor = (cid) => offers.find(o => o.carrier_id === cid);

  async function sendOffer(c, all) {
    const rate = await askReason('Offer rate (USD) for ' + c.carrier + ':', c.loaded_rpm && load.miles ? String(Math.round(c.loaded_rpm * load.miles)) : (load.rate || ''));
    if (rate === null) return;
    const mins = prompt('Expiry window in minutes:', '60');
    if (mins === null) return;
    const carriers = all ? ranked.slice(0, 3).map(x => x.carrier_id) : [c.carrier_id];
    try { const r = await offerSend(load.id, carriers, Number(rate) || null, Number(mins) || 60); toast('Sent ' + r.sent + ' offer(s)' + (r.skipped_ineligible ? ' (' + r.skipped_ineligible + ' skipped)' : ''), 'success'); openMatch(load); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  const card = (c) => el('div', { class: 'lb-card', style: 'margin-bottom:10px' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      el('div', null, [el('b', null, c.carrier), el('div', { class: 'cc-sub' }, (c.available_trucks || 0) + ' truck(s) avail · ' + (c.active_trips || 0) + ' active · ' + (c.delivered || 0) + ' delivered' + (c.on_time_pct != null ? ' · ' + c.on_time_pct + '% on-time' : ''))]),
      el('div', { style: 'text-align:right' }, [el('div', { style: 'font-size:22px;font-weight:800' }, String(c.score)), el('div', { class: 'cc-sub' }, 'score')]),
    ]),
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0' }, [
      el('span', { class: 'cc-pill cc-pill-' + (EQ_TONE[c.equipment_match] || 'gray') }, 'equip: ' + c.equipment_match),
      c.loaded_rpm != null ? el('span', { class: 'cc-pill cc-pill-gray' }, '$' + c.loaded_rpm + '/mi loaded') : null,
      el('span', { class: 'cc-pill cc-pill-amber', title: c.deadhead_note }, 'deadhead: n/a'),
      el('span', { class: 'cc-pill cc-pill-amber', title: c.eta_note }, 'ETA: n/a'),
    ].filter(Boolean)),
    el('details', null, [
      el('summary', { style: 'cursor:pointer;font-weight:600;font-size:.9em' }, 'Why this score'),
      el('div', { style: 'margin-top:6px' }, (c.factors || []).map(f => el('div', { style: 'display:flex;justify-content:space-between;padding:2px 0' }, [
        el('span', { class: 'cc-sub' }, f.factor + ' — ' + f.detail), el('b', null, '+' + f.points),
      ]))),
    ]),
    (c.risks && c.risks.length) ? el('div', { class: 'cc-sub', style: 'color:#b45309;margin-top:6px' }, 'Missing data: ' + c.risks.join(', ')) : null,
    (() => { const o = offerFor(c.carrier_id); return el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:8px' }, [
      o ? el('span', { class: 'cc-pill cc-pill-' + (o.status === 'accepted' ? 'green' : o.status === 'declined' || o.status === 'expired' ? 'red' : 'amber') }, 'offer: ' + o.status + (o.offered_rate ? ' ($' + Number(o.offered_rate).toLocaleString() + ')' : ''))
        : el('span', { class: 'cc-sub' }, 'no offer yet'),
      canOffer ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => sendOffer(c, false) }, o ? 'Re-offer' : 'Send offer') : null,
    ].filter(Boolean)); })(),
  ].filter(Boolean));

  mount(body, el('div', null, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [
      el('span', { class: 'cc-sub' }, ranked.length + ' eligible carrier(s) ranked · ' + ineligible.length + ' ineligible'),
      (canOffer && ranked.length) ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => sendOffer(ranked[0], true) }, 'Offer wave → top 3') : null,
    ].filter(Boolean)),
    ranked.length ? el('div', null, ranked.map(card)) : el('div', { class: 'lb-state' }, 'No eligible carriers for this load.'),
    ineligible.length ? el('details', { style: 'margin-top:10px' }, [
      el('summary', { style: 'cursor:pointer;font-weight:600' }, 'Ineligible carriers (' + ineligible.length + ') — with reasons'),
      el('div', { style: 'margin-top:8px' }, ineligible.map(c => el('div', { class: 'lb-card', style: 'margin-bottom:6px' }, [
        el('b', null, c.carrier),
        el('div', { class: 'cc-sub', style: 'color:#dc2626;margin-top:4px' }, (c.hard_fails || []).join(' · ') || 'not eligible'),
      ]))),
    ]) : null,
  ].filter(Boolean)));
}

export default openMatch;
