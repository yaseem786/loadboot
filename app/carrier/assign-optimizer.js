// 🎯 Assignment optimizer (V1) — "best next load per truck".
// Self-contained card for the Fleet tab: calls carrier_assignment_suggestions()
// and renders per-truck ranked picks with the reasons (equipment ✓, $/mi,
// deadhead from your last drop, lane history). Read-only; booking happens on
// the Load Board. Additive module — safe to remove.
import { carrierAssignSuggestions } from '../shared/api.js';

function el(tag, style, txt) { const e = document.createElement(tag); if (style) e.style.cssText = style; if (txt != null) e.textContent = txt; return e; }
function money(n) { return '$' + Number(n || 0).toLocaleString(); }

export async function renderAssignOptimizer(host, opts) {
  opts = opts || {};
  const head = el('div');
  head.innerHTML = '<div style="font-weight:800;font-size:1.02rem">🎯 Best next load — per truck</div>'
    + '<div style="opacity:.75;font-size:.8rem;margin-top:2px">Scored from live board loads: equipment match · $/mile · deadhead from your last drop · your lane history</div>';
  host.textContent = ''; host.appendChild(head);
  const body = el('div', 'margin-top:10px'); host.appendChild(body);
  body.appendChild(el('div', 'opacity:.7;font-size:.85rem', 'Scoring the board for your trucks…'));

  let d; try { d = await carrierAssignSuggestions(); }
  catch (e) { body.textContent = ''; body.appendChild(el('div', 'opacity:.7;font-size:.85rem', (e && e.message) || 'Could not score the board.')); return; }
  const trucks = (d && d.trucks) || [];
  body.textContent = '';
  if (d && d.anchor && d.anchor.city) {
    body.appendChild(el('div', 'font-size:.78rem;opacity:.7;margin-bottom:8px', '📍 Deadhead measured from your last drop: ' + d.anchor.city));
  }
  if (!trucks.length) { body.appendChild(el('div', 'opacity:.7;font-size:.85rem', 'Add trucks to your fleet and suggestions appear here.')); return; }

  trucks.forEach(function (t) {
    const card = el('div', 'border:1px solid rgba(148,163,184,.22);border-radius:13px;padding:11px 13px;margin-bottom:10px');
    const top = el('div', 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap');
    const nm = el('div');
    nm.innerHTML = '<b>🚛 ' + (t.truck || 'Truck') + '</b> <span style="opacity:.7;font-size:.8rem">· ' + (t.equipment || '—') + '</span>';
    top.appendChild(nm);
    if (t.busy) top.appendChild(el('span', 'font-size:.72rem;font-weight:800;padding:3px 9px;border-radius:99px;background:rgba(245,158,11,.16);color:#fbbf24', 'ON A LOAD — plan the next one'));
    else top.appendChild(el('span', 'font-size:.72rem;font-weight:800;padding:3px 9px;border-radius:99px;background:rgba(34,197,94,.16);color:#4ade80', 'READY'));
    card.appendChild(top);
    const picks = (t.picks || []).filter(Boolean);
    if (!picks.length) {
      card.appendChild(el('div', 'opacity:.65;font-size:.82rem;margin-top:6px', 'No ' + (t.equipment || '') + ' loads on the board right now — post your truck and matching loads alert you.'));
    }
    picks.forEach(function (p, i) {
      const row = el('div', 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid rgba(148,163,184,.14);margin-top:' + (i === 0 ? '8px' : '0'));
      const left = el('div', 'flex:1;min-width:200px');
      const why = [];
      why.push('✓ ' + (t.equipment || 'equipment'));
      if (p.rpm != null) why.push('$' + p.rpm + '/mi');
      if (p.deadhead_mi != null) why.push(p.deadhead_mi + ' mi deadhead');
      if (p.lane_trips > 0) why.push('you ran this lane ' + p.lane_trips + '×');
      left.innerHTML = '<div style="font-weight:700;font-size:.92rem">' + (i === 0 ? '⭐ ' : '') + p.lane + '</div>'
        + '<div style="opacity:.72;font-size:.78rem;margin-top:2px">' + why.join(' · ') + (p.pickup_date ? ' · PU ' + p.pickup_date : '') + '</div>';
      row.appendChild(left);
      const right = el('div', 'text-align:right');
      right.innerHTML = '<div style="font-weight:800;color:#4ade80">' + money(p.rate) + '</div>'
        + (p.miles ? '<div style="opacity:.65;font-size:.75rem">' + p.miles + ' mi</div>' : '');
      row.appendChild(right);
      const go = el('button', 'border:0;border-radius:9px;padding:7px 12px;font-weight:800;font-size:.78rem;cursor:pointer;background:#0883F7;color:#fff', 'Open on board →');
      go.onclick = function () { if (opts.goBoard) opts.goBoard(p.load_id); else location.hash = '#loads'; };
      row.appendChild(go);
      card.appendChild(row);
    });
    body.appendChild(card);
  });
}
