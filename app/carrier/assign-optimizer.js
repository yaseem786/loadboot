// 🎯 FLEET PLAN (V2 — enterprise) + V1 per-truck suggestions.
// carrier_fleet_plan(): globally optimized, conflict-free assignment across the
// whole fleet (one load → one truck), per-truck deadhead anchors, reload
// chaining (2-leg lookahead) and fleet KPIs. Read-only; booking stays on the
// Load Board. Additive module — safe to remove.
import { carrierFleetPlan } from '../shared/api.js';

function el(tag, style, txt) { const e = document.createElement(tag); if (style) e.style.cssText = style; if (txt != null) e.textContent = txt; return e; }
function money(n) { return '$' + Number(n || 0).toLocaleString(); }

export async function renderAssignOptimizer(host, opts) {
  opts = opts || {};
  const head = el('div');
  head.innerHTML = '<div style="font-weight:800;font-size:1.02rem">🎯 Fleet plan — optimized</div>'
    + '<div style="opacity:.75;font-size:.8rem;margin-top:2px">One pass over the live board for the WHOLE fleet: each load goes to the one truck it fits best — equipment · $/mile · deadhead from each truck&rsquo;s own last drop · lane history — plus the reload after it.</div>';
  host.textContent = ''; host.appendChild(head);
  const body = el('div', 'margin-top:10px'); host.appendChild(body);
  body.appendChild(el('div', 'opacity:.7;font-size:.85rem', 'Optimizing the board across your fleet…'));

  let d; try { d = await carrierFleetPlan(); }
  catch (e) { body.textContent = ''; body.appendChild(el('div', 'opacity:.7;font-size:.85rem', (e && e.message) || 'Could not build the plan.')); return; }
  const k = (d && d.kpis) || {};
  const plan = (d && d.plan) || [];
  body.textContent = '';

  // KPI strip
  const strip = el('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px');
  const kpi = function (label, val, sub, color) {
    const c = el('div', 'background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.18);border-radius:11px;padding:9px 11px;text-align:center');
    c.innerHTML = '<div style="font-weight:900;font-size:1.05rem;color:' + (color || '#fff') + '">' + val + '</div>'
      + '<div style="opacity:.65;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;margin-top:2px">' + label + '</div>'
      + (sub ? '<div style="opacity:.55;font-size:.68rem">' + sub + '</div>' : '');
    return c;
  };
  strip.appendChild(kpi('Trucks', (k.trucks || 0) + '', (k.busy || 0) + ' on loads'));
  strip.appendChild(kpi('Planned', (k.planned || 0) + '', (k.idle_after_plan || 0) + ' still idle', '#4ade80'));
  strip.appendChild(kpi('Plan revenue', money(k.planned_revenue), null, '#4ade80'));
  if (k.deadhead_pct != null) strip.appendChild(kpi('Deadhead', k.deadhead_pct + '%', (k.deadhead_miles || 0) + ' of ' + ((k.loaded_miles || 0) + (k.deadhead_miles || 0)) + ' mi'));
  body.appendChild(strip);

  if (!plan.length) {
    body.appendChild(el('div', 'opacity:.7;font-size:.85rem', 'No plannable matches on the board right now — post your trucks and matching loads alert you.'));
    return;
  }

  plan.forEach(function (a, i) {
    const card = el('div', 'border:1px solid rgba(148,163,184,.22);border-radius:13px;padding:11px 13px;margin-bottom:10px' + (i === 0 ? ';border-left:4px solid #0883F7' : ''));
    const top = el('div', 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap');
    const nm = el('div');
    nm.innerHTML = '<b>🚛 ' + (a.truck || 'Truck') + '</b> <span style="opacity:.7;font-size:.8rem">· ' + (a.equipment || '—') + (a.from_city ? ' · from ' + a.from_city : '') + '</span>';
    top.appendChild(nm);
    top.appendChild(el('span', 'font-size:.72rem;font-weight:800;padding:3px 9px;border-radius:99px;background:rgba(8,131,247,.16);color:#7dd3fc', 'PLANNED'));
    card.appendChild(top);

    const row = el('div', 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;padding-top:8px');
    const left = el('div', 'flex:1;min-width:200px');
    const why = ['✓ ' + (a.equipment || 'equipment')];
    if (a.rpm != null) why.push('$' + a.rpm + '/mi');
    if (a.deadhead_mi != null) why.push(a.deadhead_mi + ' mi deadhead');
    if (a.lane_trips > 0) why.push('you ran this lane ' + a.lane_trips + '×');
    left.innerHTML = '<div style="font-weight:700;font-size:.92rem">⭐ ' + a.lane + '</div>'
      + '<div style="opacity:.72;font-size:.78rem;margin-top:2px">' + why.join(' · ') + (a.pickup_date ? ' · PU ' + a.pickup_date : '') + '</div>';
    row.appendChild(left);
    const right = el('div', 'text-align:right');
    right.innerHTML = '<div style="font-weight:800;color:#4ade80">' + money(a.rate) + '</div>'
      + (a.miles ? '<div style="opacity:.65;font-size:.75rem">' + a.miles + ' mi</div>' : '');
    row.appendChild(right);
    const go = el('button', 'border:0;border-radius:9px;padding:7px 12px;font-weight:800;font-size:.78rem;cursor:pointer;background:#0883F7;color:#fff', 'Open on board →');
    go.onclick = function () { if (opts.goBoard) opts.goBoard(a.load_id); else location.hash = '#loads'; };
    row.appendChild(go);
    card.appendChild(row);

    if (a.reload && a.reload.lane) {
      const rl = el('div', 'margin-top:8px;padding:8px 11px;border-radius:10px;background:rgba(168,85,247,.10);border:1px solid rgba(168,85,247,.28);font-size:.8rem');
      rl.innerHTML = '🔁 <b>Then reload:</b> ' + a.reload.lane + ' — <span style="color:#4ade80;font-weight:800">' + money(a.reload.rate) + '</span>'
        + (a.reload.rpm != null ? ' · $' + a.reload.rpm + '/mi' : '')
        + (a.reload.deadhead_mi != null ? ' · ' + a.reload.deadhead_mi + ' mi from your delivery' : '')
        + ' <span style="opacity:.6">— a 2-leg plan before you roll.</span>';
      card.appendChild(rl);
    }
    body.appendChild(card);
  });
  body.appendChild(el('div', 'opacity:.55;font-size:.74rem;margin-top:2px', 'Read-only plan — booking happens on the board, first acceptance wins. Re-opens fresh on every visit as the board moves.'));
}
