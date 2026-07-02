// carrierScorecards.js — Carrier Performance Scorecards (Inc 67). Staff view of a deterministic, EXPLAINABLE
// score per carrier (score == sum of shown factor points), computed only from real trips/offers/exceptions.
// Click a carrier to see the "why this score" factor breakdown. No invented data anywhere.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, openDrawer } from '../../shared/ui/components.js';
import { carrierScorecard, carrierScorecardRanking } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const GRADE_TONE = { A: 'green', B: 'blue', C: 'amber', D: 'red' };
const RANGES = [['30', '30 days'], ['90', '90 days'], ['180', '180 days']];

export function renderCarrierScorecards(host) {
  let days = 90;
  const body = el('div', { class: 'cc-table-wrap' });
  const rangeSel = el('select', { class: 'cc-input', style: 'max-width:150px' }, RANGES.map(([v, l]) => el('option', { value: v }, l)));
  rangeSel.value = '90';
  rangeSel.onchange = () => { days = Number(rangeSel.value); load(); };

  mount(host, el('div', null, [
    sectionHead('Carrier Scorecards', 'A deterministic performance score per carrier — the score equals the sum of the shown factor points, and every value is counted from recorded trips, offers and exceptions. Nothing estimated.', rangeSel),
    body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Scoring carriers…');
    let rows; try { rows = await carrierScorecardRanking(days, 100); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No carriers with delivered trips in this window yet.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Carrier', 'Grade', 'Score', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, el('b', null, r.name || '—')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (GRADE_TONE[r.grade] || 'gray') }, r.grade || '—')),
        el('td', null, el('b', null, String(r.score ?? '—') + ' / 100')),
        el('td', null, el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); detail(r.carrier_id, r.name); } }, 'Why this score')),
      ]))),
    ]));
  }

  async function detail(carrierId, name) {
    const bodyEl = el('div', null, el('div', { class: 'cc-sub' }, 'Loading…'));
    openDrawer('Scorecard — ' + (name || 'carrier'), bodyEl);
    let s; try { s = await carrierScorecard(carrierId, days); } catch (e) { mount(bodyEl, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
    const m = s.metrics || {};
    mount(bodyEl, el('div', null, [
      el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:12px' }, [
        el('span', { class: 'cc-pill cc-pill-' + (GRADE_TONE[s.grade] || 'gray'), style: 'font-size:1.1rem;padding:6px 14px' }, s.grade || '—'),
        el('b', { style: 'font-size:1.4rem' }, String(s.score ?? '—') + ' / 100'),
        el('span', { class: 'cc-sub' }, 'over ' + (s.window_days || days) + ' days'),
      ]),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Factor', 'Points', 'Weight', 'Basis'].map(h => el('th', null, h)))),
        el('tbody', null, (s.factors || []).map(f => el('tr', null, [
          el('td', null, el('b', null, f.label)),
          el('td', null, el('b', null, String(f.points))),
          el('td', null, el('span', { class: 'cc-sub' }, 'of ' + f.weight)),
          el('td', { style: 'max-width:260px' }, el('span', { class: 'cc-sub' }, f.basis || '')),
        ]))),
      ]),
      el('div', { class: 'cc-sub', style: 'margin-top:10px' }, 'Delivered ' + (m.delivered || 0) + ' · on-time ' + (m.on_time || 0) + '/' + (m.with_schedule || 0) + ' · offers ' + (m.offers_accepted || 0) + '/' + (m.offers_sent || 0) + ' accepted · ' + (m.exceptions || 0) + ' exception(s) · ' + (m.cancelled || 0) + ' cancelled.'),
      el('div', { class: 'cc-sub', style: 'margin-top:6px;font-style:italic' }, s.basis || ''),
    ]));
  }
}

export default renderCarrierScorecards;
