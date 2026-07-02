// carrierScorecards.js — Carrier Performance Scorecards. Deterministic, explainable score per carrier
// (score == sum of shown factor points), computed only from real trips/offers/exceptions. No invented data.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, openDrawer } from '../../shared/ui/components.js';
import { carrierScorecard, carrierScorecardRanking } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const GRADE_TONE = { A: 'green', B: 'blue', C: 'amber', D: 'red' };
const GRADE_COL = { A: '#16a34a', B: '#0883F7', C: '#f59e0b', D: '#dc2626' };
const GRADE_LABEL = { A: 'Excellent', B: 'Good', C: 'Fair', D: 'Needs attention' };
const RANGES = [['30', '30 days'], ['90', '90 days'], ['180', '180 days']];
const FMETA = {
  'On-time delivery': { what: 'Reliability - did loads arrive inside the scheduled delivery window.', up: 'Deliver within the appointment/FCFS window; flag delays to dispatch early.' },
  'Offer acceptance': { what: 'Responsiveness - how many offered loads this carrier accepts.', up: 'Accept more best-match offers; decline fast when passing so we can re-route.' },
  'Few exceptions': { what: 'Clean execution - detention, TONU, breakdowns and other reported issues.', up: 'Fewer avoidable exceptions; tap arrive/depart on time to cut detention.' },
  'Delivered volume': { what: 'Engagement - how many loads were actually delivered in the window.', up: 'Haul more loads through LoadBoot (soft-capped, so a few good loads still score).' },
  'Low cancellations': { what: 'Commitment - booked loads cancelled vs delivered.', up: 'Honor booked loads; only cancel in genuine, proven emergencies.' },
};

function gaugeSvg(score, gcol) {
  const R = 54, CIRC = 2 * Math.PI * R, pct = Math.max(0, Math.min(100, score)), off = CIRC * (1 - pct / 100);
  const c1 = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#e8edf3" stroke-width="13"/>';
  const c2a = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + gcol + '" stroke-width="13" stroke-linecap="round"';
  const c2b = ' stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="' + CIRC.toFixed(1) + '" transform="rotate(-90 70 70)">';
  const an = '<animate attributeName="stroke-dashoffset" from="' + CIRC.toFixed(1) + '" to="' + off.toFixed(1) + '" dur="0.9s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/></circle>';
  const t1 = '<text x="70" y="66" text-anchor="middle" font-size="34" font-weight="800" fill="#0f172a">' + score + '</text>';
  const t2 = '<text x="70" y="88" text-anchor="middle" font-size="12" fill="#64748b">/ 100</text>';
  return '<svg viewBox="0 0 140 140" width="148" height="148" style="display:block">' + c1 + c2a + c2b + an + t1 + t2 + '</svg>';
}

export function renderCarrierScorecards(host) {
  let days = 90;
  const body = el('div', { class: 'cc-table-wrap' });
  const rangeSel = el('select', { class: 'cc-input', style: 'max-width:150px' }, RANGES.map(([v, l]) => el('option', { value: v }, l)));
  rangeSel.value = '90';
  rangeSel.onchange = () => { days = Number(rangeSel.value); load(); };

  mount(host, el('div', null, [
    sectionHead('Carrier Scorecards', 'A deterministic performance score per carrier - the score equals the sum of the shown factor points, counted from recorded trips, offers and exceptions. Nothing estimated.', rangeSel),
    body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Scoring carriers...');
    let rows;
    try { rows = await carrierScorecardRanking(days, 100); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No carriers with delivered trips in this window yet.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Carrier', 'Grade', 'Score', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, el('b', null, r.name || '-')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (GRADE_TONE[r.grade] || 'gray') }, r.grade || '-')),
        el('td', null, el('b', null, String(r.score == null ? '-' : r.score) + ' / 100')),
        el('td', null, el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); detail(r.carrier_id, r.name); } }, 'Why this score')),
      ]))),
    ]));
  }

  async function detail(carrierId, name) {
    const bodyEl = el('div', null, el('div', { class: 'cc-sub' }, 'Loading...'));
    openDrawer('Scorecard - ' + (name || 'carrier'), bodyEl);
    let s;
    try { s = await carrierScorecard(carrierId, days); } catch (e) { mount(bodyEl, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
    const m = s.metrics || {};
    const score = Math.round(Number(s.score == null ? 0 : s.score) * 10) / 10;
    const grade = s.grade || '-';
    const gcol = GRADE_COL[grade] || '#64748b';
    const gauge = gaugeSvg(score, gcol);

    const chipStyle = 'flex:1;min-width:92px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px';
    const chip = (label, val, col) => el('div', { style: chipStyle }, [
      el('div', { style: 'font-size:1.15rem;font-weight:800;color:' + (col || '#0f172a') }, String(val)),
      el('div', { class: 'cc-sub', style: 'font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;margin-top:2px' }, label),
    ]);

    const factorRow = (f) => {
      const p = f.weight > 0 ? Math.max(0, Math.min(100, f.points / f.weight * 100)) : 0;
      const col = p >= 85 ? '#16a34a' : p >= 50 ? '#f59e0b' : '#dc2626';
      const meta = FMETA[f.label] || {};
      const fill = el('i', { style: 'display:block;height:100%;width:0%;border-radius:99px;background:' + col + ';transition:width .8s cubic-bezier(.2,.8,.2,1)' });
      requestAnimationFrame(() => { fill.style.width = p.toFixed(0) + '%'; });
      return el('div', { style: 'padding:13px 0;border-bottom:1px solid #eef2f7' }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:10px' }, [
          el('b', { style: 'font-size:.95rem' }, f.label),
          el('span', null, [el('b', { style: 'color:' + col + ';font-size:1.02rem' }, String(f.points)), el('span', { class: 'cc-sub' }, ' / ' + f.weight + ' pts')]),
        ]),
        el('div', { style: 'height:8px;border-radius:99px;background:#eef2f7;overflow:hidden;margin:8px 0 7px' }, fill),
        meta.what ? el('div', { style: 'font-size:.83rem;color:#334155' }, meta.what) : '',
        el('div', { class: 'cc-sub', style: 'font-size:.8rem;margin-top:3px' }, 'Now: ' + (f.basis || '-')),
        meta.up ? el('div', { style: 'font-size:.8rem;color:#0883F7;margin-top:3px' }, 'Improve: ' + meta.up) : '',
      ]);
    };

    const purpose = 'What this is for: one honest score that decides how strongly loads are prioritized to this carrier. Higher = earlier pick of the best-match freight. Every point below is counted from real records - nothing estimated.';
    mount(bodyEl, el('div', null, [
      el('div', { style: 'font-size:.86rem;color:#475569;background:#eff6ff;border:1px solid #dbeafe;border-radius:12px;padding:10px 12px;margin-bottom:14px' }, purpose),
      el('div', { style: 'display:flex;align-items:center;gap:18px;background:linear-gradient(135deg,#f8fafc,#eef4ff);border:1px solid #e2e8f0;border-radius:16px;padding:16px' }, [
        el('div', { html: gauge, style: 'flex:none' }),
        el('div', null, [
          el('div', { style: 'display:inline-flex;align-items:center;gap:10px' }, [
            el('span', { style: 'display:inline-flex;width:38px;height:38px;border-radius:11px;align-items:center;justify-content:center;font-weight:800;font-size:1.2rem;color:#fff;background:' + gcol }, grade),
            el('div', null, [el('div', { style: 'font-weight:800;font-size:1.05rem' }, GRADE_LABEL[grade] || 'Unrated'), el('div', { class: 'cc-sub', style: 'font-size:.78rem' }, 'over ' + (s.window_days || days) + ' days')]),
          ]),
          el('div', { class: 'cc-sub', style: 'margin-top:10px;font-size:.82rem;max-width:260px' }, 'The score is the sum of the five factor points below (max 100).'),
        ]),
      ]),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin:14px 0' }, [
        chip('Delivered', m.delivered || 0),
        chip('On-time', (m.on_time || 0) + '/' + (m.with_schedule || 0), (m.with_schedule ? ((m.on_time / m.with_schedule >= 0.9) ? '#16a34a' : '#f59e0b') : '#64748b')),
        chip('Offers', (m.offers_accepted || 0) + '/' + (m.offers_sent || 0)),
        chip('Exceptions', m.exceptions || 0, (m.exceptions ? '#f59e0b' : '#16a34a')),
        chip('Cancelled', m.cancelled || 0, (m.cancelled ? '#dc2626' : '#16a34a')),
      ]),
      el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:8px 0 2px' }, 'Factor breakdown - what each measures'),
      el('div', null, (s.factors || []).map(factorRow)),
      el('div', { class: 'cc-sub', style: 'margin-top:12px;font-style:italic;font-size:.8rem' }, s.basis || 'Deterministic - every value counted from recorded trips, offers and exceptions. Nothing estimated.'),
    ]));
  }
}

export default renderCarrierScorecards;
