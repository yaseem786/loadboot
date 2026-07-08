// market-widget.js — DAT-style Market Rates widget, shared by carrier/broker/shipper portals + CC.
// Audience-aware: the backend (cc_lane_rate) decides what the session may see —
// carrier gets carrier (buy) rates, shipper gets shipper (sell) rates, broker gets BOTH, staff gets all.
import { laneRate, publicMarketRates } from './api.js';

const EQ = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Conestoga', 'Power Only', 'Box Truck', 'Hotshot'];
const US = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

function d(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(k => { if (k === 'style') e.style.cssText = attrs[k]; else if (k.slice(0, 2) === 'on') e[k.toLowerCase()] = attrs[k]; else e.setAttribute(k, attrs[k]); });
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}
const money = (v) => v == null ? '—' : '$' + Number(v).toLocaleString();

function css() {
  if (document.getElementById('mw-css')) return;
  const st = document.createElement('style'); st.id = 'mw-css';
  st.textContent = `
  .mw{font-family:inherit;color:#10223B}
  .mw-hero{border-radius:18px;padding:22px 24px;color:#fff;background:radial-gradient(900px 300px at 90% -30%,rgba(8,131,247,.45),transparent 60%),linear-gradient(120deg,#0b1830,#10223B 60%,#14335c);margin-bottom:14px}
  .mw-hero h2{margin:0;font-size:1.3rem;font-weight:800;color:#fff}
  .mw-hero .s{font-size:.8rem;opacity:.8;margin-top:4px}
  .mw-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
  .mw-form input,.mw-form select{border:0;border-radius:11px;padding:10px 13px;font-weight:700;font-size:.85rem;background:rgba(255,255,255,.95);color:#10223B;outline:none}
  .mw-form input{width:120px;text-transform:uppercase}
  .mw-go{border:0;border-radius:11px;padding:10px 20px;font-weight:800;font-size:.85rem;color:#fff;cursor:pointer;background:linear-gradient(120deg,#0883F7,#0967d2)}
  .mw-card{background:#fff;border:1px solid #e6ebf3;border-radius:18px;padding:18px 20px;margin-bottom:14px;box-shadow:0 12px 32px -24px rgba(2,12,30,.3)}
  .mw-lane{font-weight:800;font-size:1.05rem}
  .mw-chip{display:inline-flex;padding:3px 11px;border-radius:999px;font-size:.66rem;font-weight:800;letter-spacing:.03em}
  .mw-tri{margin:16px 0 6px}
  .mw-bar{position:relative;height:10px;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#22c55e 50%,#0883F7)}
  .mw-bar i{position:absolute;top:-4px;width:4px;height:18px;border-radius:3px;background:#10223B;box-shadow:0 0 0 2.5px #fff}
  .mw-pts{display:flex;justify-content:space-between;margin-top:8px}
  .mw-pt{text-align:center}.mw-pt b{display:block;font-size:1.15rem;font-weight:800}
  .mw-pt.avg b{font-size:1.7rem;color:#0967d2}
  .mw-pt span{font-size:.6rem;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8;font-weight:800}
  .mw-duo{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .mw-side{border:1.5px solid #e6ebf3;border-radius:14px;padding:13px 15px}
  .mw-side.buy{border-color:#bfdbfe;background:#f8fbff}.mw-side.sell{border-color:#bbf7d0;background:#f7fdf9}
  .mw-side .t{font-size:.62rem;text-transform:uppercase;letter-spacing:.11em;font-weight:800;color:#64748b}
  .mw-side .v{font-size:1.5rem;font-weight:800;margin-top:2px}
  .mw-side .r{font-size:.74rem;color:#64748b;margin-top:2px}
  .mw-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;font-size:.72rem;color:#64748b}
  .mw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
  .mw-tile{background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:12px 14px;cursor:pointer;transition:transform .12s}
  .mw-tile:hover{transform:translateY(-2px);border-color:#93c5fd}
  .mw-tile .e{font-weight:800;font-size:.84rem}
  .mw-tile .p{font-size:1.25rem;font-weight:800;color:#0967d2;margin-top:2px}
  .mw-tile .sub{font-size:.68rem;color:#94a3b8}
  .mw-spark{margin-top:10px}
  .mw-snaplbl{font-weight:800;font-size:.8rem;color:#64748b;margin:6px 2px}
  /* ---- dark portal (carrier Midnight Executive) ---- */
  .mw-dark{color:#e2e8f0}
  .mw-dark .mw-card,.mw-dark .mw-tile{background:#0f1d38;border-color:rgba(255,255,255,.09);box-shadow:0 12px 32px -24px rgba(0,0,0,.6)}
  .mw-dark .mw-lane,.mw-dark .mw-tile .e,.mw-dark .mw-pt b{color:#f1f5f9}
  .mw-dark .mw-pt.avg b,.mw-dark .mw-tile .p{color:#7cc0ff}
  .mw-dark .mw-pt span,.mw-dark .mw-tile .sub,.mw-dark .mw-meta,.mw-dark .mw-spark div,.mw-dark .mw-snaplbl{color:#7f92b3}
  .mw-dark .mw-bar i{background:#fff;box-shadow:0 0 0 2.5px #0f1d38}
  .mw-dark .mw-side{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.03)}
  .mw-dark .mw-side.buy{border-color:rgba(59,157,255,.35);background:rgba(8,131,247,.08)}
  .mw-dark .mw-side.sell{border-color:rgba(52,211,153,.3);background:rgba(52,211,153,.07)}
  .mw-dark .mw-side .t,.mw-dark .mw-side .r{color:#7f92b3}
  .mw-dark .mw-side .v{color:#f1f5f9}
  .mw-dark .mw-tile:hover{border-color:#3b9dff}
  @media(max-width:640px){.mw-form input{width:90px}}
  `;
  document.head.appendChild(st);
}

const confChip = (c) => {
  const m = { HIGH: ['#dcfce7', '#166534'], MEDIUM: ['#fef9c3', '#854d0e'], LOW: ['#f1f5f9', '#64748b'] }[c] || ['#f1f5f9', '#64748b'];
  return d('span', { class: 'mw-chip', style: 'background:' + m[0] + ';color:' + m[1] }, 'CONFIDENCE: ' + c);
};

function spark(hist) {
  const pts = (hist || []).map(x => Number(x.rpm)).filter(x => x > 0);
  if (pts.length < 2) return null;
  const w = 220, hh = 44, mn = Math.min(...pts), mx = Math.max(...pts), rg = (mx - mn) || 1;
  const xy = pts.map((p, i) => (i * (w / (pts.length - 1))).toFixed(1) + ',' + (hh - 6 - ((p - mn) / rg) * (hh - 12)).toFixed(1)).join(' ');
  const host = d('div', { class: 'mw-spark' });
  host.innerHTML = '<svg width="' + w + '" height="' + hh + '" viewBox="0 0 ' + w + ' ' + hh + '"><polyline fill="none" stroke="#0883F7" stroke-width="2.5" stroke-linecap="round" points="' + xy + '"/></svg>'
    + '<div style="font-size:.62rem;color:#94a3b8">12-week trend · $' + mn.toFixed(2) + '–' + mx.toFixed(2) + '/mi</div>';
  return host;
}

function triPoint(rt, label) {
  const lo = Number(rt.low), av = Number(rt.avg), hi = Number(rt.high);
  const pct = hi > lo ? Math.max(3, Math.min(97, ((av - lo) / (hi - lo)) * 100)) : 50;
  return d('div', { class: 'mw-tri' }, [
    label ? d('div', { style: 'font-size:.66rem;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;font-weight:800;margin-bottom:8px' }, label) : null,
    d('div', { class: 'mw-bar' }, d('i', { style: 'left:' + pct + '%' })),
    d('div', { class: 'mw-pts' }, [
      d('div', { class: 'mw-pt' }, [d('b', null, '$' + lo.toFixed(2)), d('span', null, 'Low')]),
      d('div', { class: 'mw-pt avg' }, [d('b', null, '$' + av.toFixed(2)), d('span', null, 'Average /mi')]),
      d('div', { class: 'mw-pt' }, [d('b', null, '$' + hi.toFixed(2)), d('span', null, 'High')]),
    ]),
    rt.flat_avg ? d('div', { style: 'text-align:center;font-size:.8rem;color:#334155;margin-top:6px' }, ['Flat for this lane: ', d('b', null, money(rt.flat_low) + ' – ' + money(rt.flat_high) + '  (avg ' + money(rt.flat_avg) + ')')]) : null,
  ]);
}

export async function renderMarketWidget(host, opts = {}) {
  css();
  const wrap = d('div', { class: 'mw' });
  try {
    const bg = getComputedStyle(document.body).backgroundColor || '';
    const m9 = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (opts.dark === true || (m9 && (Number(m9[1]) * 0.299 + Number(m9[2]) * 0.587 + Number(m9[3]) * 0.114) < 110)) wrap.classList.add('mw-dark');
  } catch (_) {}
  const oIn = d('input', { placeholder: 'Origin ST', maxlength: '2' });
  const dIn = d('input', { placeholder: 'Dest ST', maxlength: '2' });
  const eqSel = d('select', null, EQ.map(e => { const o = d('option', { value: e }, e); return o; }));
  const miIn = d('input', { placeholder: 'Miles (opt)', style: 'text-transform:none;width:110px' });
  const res = d('div');
  const snap = d('div', { class: 'mw-grid' });
  const go = d('button', { class: 'mw-go' }, 'Get rates →');
  const run = async () => {
    const os = oIn.value.trim().toUpperCase() || null, ds = dIn.value.trim().toUpperCase() || null;
    if (os && US.indexOf(os) < 0) { alert('Origin: 2-letter US state'); return; }
    if (ds && US.indexOf(ds) < 0) { alert('Destination: 2-letter US state'); return; }
    res.innerHTML = '<div style="color:#64748b;font-size:.85rem;padding:14px">Crunching market data…</div>';
    let r; try { r = await laneRate(os, ds, eqSel.value, miIn.value ? Number(miIn.value) : null); }
    catch (e) { res.innerHTML = '<div style="color:#dc2626;font-size:.85rem;padding:14px">' + ((e && e.message) || 'Could not load rates.') + '</div>'; return; }
    const card = d('div', { class: 'mw-card' });
    card.appendChild(d('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
      d('div', { class: 'mw-lane' }, (r.o_state || 'USA') + (r.d_state ? ' → ' + r.d_state : ' · national') + '  ·  ' + r.equipment),
      d('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        confChip(r.confidence),
        r.trend_pct_4wk != null ? d('span', { class: 'mw-chip', style: 'background:' + (r.trend_pct_4wk >= 0 ? '#dcfce7;color:#166534' : '#fee2e2;color:#991b1b') }, (r.trend_pct_4wk >= 0 ? '▲ +' : '▼ ') + r.trend_pct_4wk + '% · 4wk') : null,
      ]),
    ]));
    if (r.audience === 'broker') {
      card.appendChild(d('div', { class: 'mw-duo', style: 'margin-top:12px' }, [
        d('div', { class: 'mw-side buy' }, [d('div', { class: 't' }, '🚛 BUY — what you pay the carrier'), d('div', { class: 'v', style: 'color:#0967d2' }, '$' + Number(r.buy.avg).toFixed(2) + '/mi'), d('div', { class: 'r' }, '$' + Number(r.buy.low).toFixed(2) + ' – $' + Number(r.buy.high).toFixed(2) + (r.buy.flat_avg ? ' · flat avg ' + money(r.buy.flat_avg) : ''))]),
        d('div', { class: 'mw-side sell' }, [d('div', { class: 't' }, '🏢 SELL — what you quote the shipper'), d('div', { class: 'v', style: 'color:#15803d' }, '$' + Number(r.sell.avg).toFixed(2) + '/mi'), d('div', { class: 'r' }, '$' + Number(r.sell.low).toFixed(2) + ' – $' + Number(r.sell.high).toFixed(2) + ' · margin ~' + r.margin_pct + '%' + (r.sell.flat_avg && r.buy.flat_avg ? ' ≈ ' + money(r.sell.flat_avg - r.buy.flat_avg) + ' spread' : ''))]),
      ]));
      card.appendChild(triPoint(r.buy, 'Buy-side spread (carrier rate)'));
    } else if (r.audience === 'staff') {
      card.appendChild(d('div', { class: 'mw-duo', style: 'margin-top:12px' }, [
        d('div', { class: 'mw-side buy' }, [d('div', { class: 't' }, 'CARRIER (buy)'), d('div', { class: 'v', style: 'color:#0967d2' }, '$' + Number(r.carrier.avg).toFixed(2) + '/mi'), d('div', { class: 'r' }, '$' + Number(r.carrier.low).toFixed(2) + '–' + Number(r.carrier.high).toFixed(2))]),
        d('div', { class: 'mw-side sell' }, [d('div', { class: 't' }, 'BROKER SELL / SHIPPER'), d('div', { class: 'v', style: 'color:#15803d' }, '$' + Number(r.shipper.avg).toFixed(2) + '/mi'), d('div', { class: 'r' }, 'margin ~' + r.margin_pct + '%')]),
      ]));
      card.appendChild(triPoint(r.carrier, 'Carrier-side spread'));
    } else {
      card.appendChild(triPoint(r.rate, r.audience === 'shipper' ? 'What shipping this lane costs (broker sell rate)' : 'What this lane pays the truck'));
    }
    const sp = spark(r.history); if (sp) card.appendChild(sp);
    card.appendChild(d('div', { class: 'mw-meta' }, [
      d('span', null, '📊 Source: ' + r.source), d('span', null, '· as of ' + r.as_of),
      d('span', null, '· window ' + r.window_days + 'd'),
      d('span', null, '· A guide, not a quote — confidence rises as LoadBoot bookings grow on this lane.'),
    ]));
    res.innerHTML = ''; res.appendChild(card);
  };
  go.onclick = run;
  [oIn, dIn].forEach(x => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }));
  wrap.appendChild(d('div', { class: 'mw-hero' }, [
    d('h2', null, '📈 Market Rates & Analytics'),
    d('div', { class: 's' }, opts.sub || 'Lane-level truckload rates — blended from real LoadBoot bookings and published national benchmarks, refreshed weekly. Your role sees your side of the market.'),
    d('div', { class: 'mw-form' }, [oIn, d('span', { style: 'color:rgba(255,255,255,.6);font-weight:800' }, '→'), dIn, eqSel, miIn, go]),
  ]));
  wrap.appendChild(res);
  wrap.appendChild(d('div', { class: 'mw-snaplbl' }, 'NATIONAL SNAPSHOT \u2014 tap an equipment to load it'));
  wrap.appendChild(snap);
  host.innerHTML = ''; host.appendChild(wrap);
  // snapshot tiles (public blended numbers; audience view resolves on tap)
  try {
    const rows = (await publicMarketRates()) || [];
    rows.forEach(b => {
      const t = d('div', { class: 'mw-tile', onClick: () => { eqSel.value = b.equipment; run(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, [
        d('div', { class: 'e' }, b.equipment),
        d('div', { class: 'p' }, '$' + Number(b.carrier_rpm).toFixed(2) + '/mi'),
        d('div', { class: 'sub' }, 'range $' + Number(b.low).toFixed(2) + '–' + Number(b.high).toFixed(2) + ' · ' + b.as_of),
      ]);
      snap.appendChild(t);
    });
  } catch (_) { snap.innerHTML = '<div style="color:#94a3b8;font-size:.8rem">Snapshot unavailable.</div>'; }
  run(); // initial: national card for Dry Van
}
export default renderMarketWidget;
