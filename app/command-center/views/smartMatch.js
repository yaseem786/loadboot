// smartMatch.js — Smart Matching (Phase 5, dispatch intelligence). Pick a load and see
// deterministically-ranked carrier recommendations with a score, compliance flag,
// on-time history and a plain-language reason. Assignment stays a human action
// (assignLoad), gated on loads.assign — AI/scoring recommends, it never books.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDate } from '../../shared/ui/components.js';
import { getLoadsList, matchCarriers, assignLoad } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export function renderSmartMatch(host) {
  const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const canAssign = can('loads.assign');
  const loadsHost = el('div', { class: 'cc-table-wrap' });
  const panel = el('div', { class: 'lb-card', style: 'margin-top:16px' }, el('div', { class: 'cc-sub' }, 'Select a load to see recommended carriers.'));
  mount(host, el('div', null, [
    sectionHead('Smart Matching', 'Deterministic carrier recommendations per load — score, compliance, on-time history and reasoning. Assignment is always a human action.'),
    loadsHost, panel,
  ]));
  loadLoads();

  async function loadLoads() {
    showLoading(loadsHost, 'Loading loads…');
    let rows; try { rows = await getLoadsList({ status: 'available', limit: 100 }); } catch (e) { showError(loadsHost, humanizeError(e), loadLoads); return; }
    rows = rows || [];
    if (!rows.length) { mount(loadsHost, el('div', { class: 'lb-state' }, 'No available loads. Create or import loads to match.')); return; }
    mount(loadsHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Lane', 'Equipment', 'Rate', 'Miles', 'Pickup', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(l => el('tr', { class: 'cc-row', onClick: () => showMatches(l) }, [
        el('td', null, el('b', null, (l.origin || '—') + ' → ' + (l.destination || '—'))),
        el('td', null, l.equipment || '—'),
        el('td', null, money(l.rate)),
        el('td', null, l.miles ? Number(l.miles).toLocaleString() : '—'),
        el('td', null, l.pickup_date ? fmtDate(l.pickup_date) : '—'),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  async function showMatches(l) {
    mount(panel, [el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Recommended carriers'), el('span', null, (l.origin || '') + ' → ' + (l.destination || '') + ' · ' + money(l.rate))]), el('div', { class: 'cc-sub' }, 'Scoring…')]);
    let rows; try { rows = await matchCarriers(l.id); } catch (e) { mount(panel, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    rows = rows || [];
    if (!rows.length) { mount(panel, [el('div', { class: 'fa-cardhead' }, el('h3', null, 'Recommended carriers')), el('div', { class: 'lb-state' }, 'No eligible carriers found for this load.')]); return; }
    mount(panel, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Recommended carriers'), el('span', null, (l.origin || '') + ' → ' + (l.destination || '') + ' · ' + money(l.rate))]),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Carrier', 'Score', 'Compliant', 'On-time', 'Active / done', 'Why', ''].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(m => el('tr', { class: 'cc-row' }, [
          el('td', null, el('b', null, m.carrier || '—')),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (m.score >= 70 ? 'green' : m.score >= 40 ? 'amber' : 'gray') }, String(m.score))),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (m.compliant ? 'green' : 'red') }, m.compliant ? 'yes' : 'no')),
          el('td', null, (m.on_time_pct != null ? m.on_time_pct + '%' : '—')),
          el('td', null, (m.active_trips || 0) + ' / ' + (m.delivered || 0)),
          el('td', null, el('span', { class: 'cc-sub' }, m.reason || '—')),
          el('td', null, (canAssign && m.compliant) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => {
            if (!confirm('Assign this load to ' + m.carrier + '?')) return;
            ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Assigning…';
            try { await assignLoad(l.id, m.carrier_id); toast('Load assigned to ' + m.carrier, 'success'); loadLoads(); mount(panel, el('div', { class: 'cc-sub' }, 'Assigned. Select another load to match.')); }
            catch (e) { ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Assign'; toast(humanizeError(e), 'error'); }
          } }, 'Assign') : ''),
        ]))),
      ]),
      el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Recommendations are advisory. Non-compliant carriers cannot be assigned. The final booking is always a human decision.'),
    ]);
  }
}

export default renderSmartMatch;
