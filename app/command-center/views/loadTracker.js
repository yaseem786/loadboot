// loadTracker.js — CC live tracking for ANY load, at the same standard as the broker
// portal's tracker: hero with live pulse, six milestones, Leaflet map (facility pins,
// truck marker, GPS breadcrumb), progress/ETA tiles, geofenced stop stamps and the trip
// event timeline. Feeds from cc_staff_track_load (bl_cc_0237) and refreshes every 20s.
import { el, mount } from '../../shared/ui/dom.js';
import { openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { staffTrackLoad } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';

function ensureLeaflet() {
  return new Promise((resolve) => {
    if (window.L) return resolve(true);
    if (!document.getElementById('cc-leaflet-css')) {
      const css = document.createElement('link'); css.id = 'cc-leaflet-css'; css.rel = 'stylesheet'; css.href = LEAFLET_CSS; document.head.appendChild(css);
    }
    const existing = document.getElementById('cc-leaflet-js');
    if (existing) { existing.addEventListener('load', () => resolve(!!window.L)); if (window.L) resolve(true); return; }
    const sc = document.createElement('script'); sc.id = 'cc-leaflet-js'; sc.src = LEAFLET_JS;
    sc.onload = () => resolve(true); sc.onerror = () => resolve(false);
    document.head.appendChild(sc);
  });
}

function css() {
  if (document.getElementById('cct-css')) return;
  const st = document.createElement('style'); st.id = 'cct-css';
  st.textContent = `
    .cct-hero{position:relative;border-radius:16px;overflow:hidden;padding:16px 18px;color:#fff;background:radial-gradient(600px 200px at 88% -40%,rgba(8,131,247,.45),transparent 60%),linear-gradient(120deg,#0b1830,#10223B 60%,#14335c);margin-bottom:12px}
    .cct-hero.done{background:radial-gradient(600px 200px at 88% -40%,rgba(34,197,94,.5),transparent 60%),linear-gradient(120deg,#0a2416,#14532d 60%,#166534)}
    .cct-live{display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.16);color:#4ade80;border:1px solid rgba(74,222,128,.35);border-radius:999px;padding:3px 11px;font-size:.66rem;font-weight:800;letter-spacing:.05em}
    .cct-live.off{background:rgba(148,163,184,.18);color:#cbd5e1;border-color:rgba(203,213,225,.3)}
    .cct-live .dot{width:8px;height:8px;border-radius:99px;background:#22c55e;animation:cctblink 1.4s infinite}
    .cct-live.off .dot{background:#94a3b8;animation:none}
    @keyframes cctblink{0%,100%{opacity:1}50%{opacity:.25}}
    .cct-steps{display:flex;margin:12px 0 4px}
    .cct-step{flex:1;position:relative;text-align:center;padding-top:24px}
    .cct-step:before{content:'';position:absolute;top:9px;left:50%;width:100%;height:3px;background:#eef2f7;z-index:0}
    .cct-step:last-child:before{display:none}
    .cct-step.done:before{background:linear-gradient(90deg,#22c55e,#16a34a)}
    .cct-step .b{position:absolute;top:0;left:50%;transform:translateX(-50%);width:20px;height:20px;border-radius:99px;background:#eef2f7;color:#94a3b8;display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:800;z-index:1;border:3px solid #fff;box-shadow:0 0 0 1.5px #e2e8f0}
    .cct-step.done .b{background:#16a34a;color:#fff;box-shadow:0 0 0 1.5px #16a34a}
    .cct-step.cur .b{background:#0883F7;color:#fff;box-shadow:0 0 0 1.5px #0883F7;animation:cctpulse 1.8s infinite}
    @keyframes cctpulse{0%{box-shadow:0 0 0 1.5px #0883F7}55%{box-shadow:0 0 0 8px rgba(8,131,247,.12)}100%{box-shadow:0 0 0 1.5px #0883F7}}
    .cct-step .t{font-size:.62rem;font-weight:800;color:#94a3b8}
    .cct-step.done .t,.cct-step.cur .t{color:#10223B}
    .cct-step .s{font-size:.56rem;color:#94a3b8;margin-top:1px}
    .cct-map{height:280px;border-radius:14px;overflow:hidden;border:1px solid #e6ebf3}
    .cct-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:10px 0}
    .cct-tile{background:#fff;border:1px solid #e6ebf3;border-radius:12px;padding:9px 12px}
    .cct-tile .k{font-size:.57rem;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8;font-weight:800}
    .cct-tile .v{font-weight:800;color:#10223B;font-size:.92rem;margin-top:2px}
    .cct-prog{height:8px;border-radius:99px;background:#eef2f7;overflow:hidden;margin-top:8px}
    .cct-prog i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#22c55e);transition:width .6s cubic-bezier(.4,0,.2,1)}
    .cct-ev{border-left:2.5px solid #e2e8f0;margin-left:8px;padding-left:14px;margin-top:8px}
    .cct-ev .e{position:relative;padding:6px 0;font-size:.8rem}
    .cct-ev .e:before{content:'';position:absolute;left:-20.5px;top:12px;width:9px;height:9px;border-radius:99px;background:#0883F7;border:2.5px solid #fff;box-shadow:0 0 0 1.5px #bfdbfe}
    .cct-car{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:11px 14px;margin:10px 0 0}
    .cct-car .av{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#0883F7,#1e40af);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
  `;
  document.head.appendChild(st);
}

const fmtT = (x) => x ? new Date(x).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
const ago = (x) => { if (!x) return null; const m = Math.round((Date.now() - new Date(x).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + 'h ago'; };
const hav = (a, b, c, d) => { const r = (x) => x * Math.PI / 180; return 3958.8 * 2 * Math.asin(Math.sqrt(Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2)); };

export function openLoadTracker(loadRow) {
  css();
  const host = el('div', null, el('div', { class: 'lb-state lb-loading' }, 'Connecting to the live feed…'));
  const drawer = openDrawer('🛰 Live tracking', host, { subtitle: (loadRow.origin || '?') + ' → ' + (loadRow.destination || '?') });
  let dead = false, timer = null, map = null, truckMk = null, crumb = null;
  const origClose = drawer.close;
  drawer.close = () => { dead = true; clearTimeout(timer); origClose(); };

  async function draw() {
    if (dead || !document.body.contains(host)) { dead = true; clearTimeout(timer); return; }
    let d; try { d = await staffTrackLoad(loadRow.id); } catch (e) { mount(host, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const ld = d.load || {}, t = d.trip, of = d.offers || {}, stops = d.stops || [], events = d.events || [], locs = d.locations || [];
    const done = !!(t && t.delivered_at);
    const liveOk = !!(t && t.last_loc_at && (Date.now() - new Date(t.last_loc_at).getTime()) < 30 * 60000);

    const steps = [
      ['Posted', ld.created_at, true],
      ['Offers', null, (of.sent || 0) > 0 || !!t],
      ['Booked', t && t.booked_at, !!t],
      ['Dispatched', t && t.dispatched_at, !!(t && (t.dispatched_at || t.started_at || t.delivered_at))],
      ['In transit', t && t.started_at, !!(t && (t.started_at || t.delivered_at))],
      ['Delivered', t && t.delivered_at, done],
    ];
    let cur = steps.findIndex(s => !s[2]); if (cur < 0) cur = steps.length;

    // progress + ETA from GPS
    let progPct = null, remainMi = null, etaTxt = null;
    const pins = t || ld;
    if (t && t.last_lat != null && pins.pickup_lat != null && pins.delivery_lat != null) {
      const total = hav(pins.pickup_lat, pins.pickup_lng, pins.delivery_lat, pins.delivery_lng);
      const left = hav(t.last_lat, t.last_lng, pins.delivery_lat, pins.delivery_lng);
      if (total > 1) { progPct = Math.max(0, Math.min(100, Math.round((1 - left / total) * 100))); remainMi = Math.round(left * 1.18); }
      if (remainMi != null && t.started_at && !done) {
        const h = remainMi / 50 + Math.floor((remainMi / 50) / 11) * 10;
        etaTxt = new Date(Date.now() + h * 3600e3).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      }
    }

    const heroSub = done ? '✓ Delivered ' + fmtT(t.delivered_at)
      : t ? (t.carrier || 'Carrier') + (t.driver_name ? ' · ' + t.driver_name : '') + (t.truck_no ? ' · truck #' + t.truck_no : '')
      : String(ld.status) === 'available' ? 'Live on the board · offers: ' + (of.sent || 0) + ' sent, ' + (of.pending || 0) + ' pending' + ((of.declined || 0) ? ', ' + of.declined + ' declined/expired' : '')
      : 'Status: ' + (ld.status || '—');

    const mapEl = el('div', { class: 'cct-map', style: (pins.pickup_lat != null && pins.delivery_lat != null) ? '' : 'display:none' });

    mount(host, el('div', null, [
      el('div', { class: 'cct-hero' + (done ? ' done' : '') }, [
        el('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap' }, [
          el('div', null, [
            el('div', { style: 'font-weight:900;font-size:1.02rem' }, (ld.origin || '?') + ' → ' + (ld.destination || '?')),
            el('div', { style: 'font-size:.78rem;opacity:.85;margin-top:2px' }, heroSub),
          ]),
          el('span', { class: 'cct-live' + (liveOk ? '' : ' off') }, [el('span', { class: 'dot' }), liveOk ? 'LIVE GPS' : (t ? 'NO RECENT PING' : 'NOT BOOKED')]),
        ]),
        etaTxt ? el('div', { style: 'font-weight:800;font-size:1.15rem;margin-top:8px' }, ['ETA ' + etaTxt, el('small', { style: 'display:block;font-size:.7rem;opacity:.75;font-weight:700' }, remainMi + ' mi remaining (HOS-adjusted)')]) : '',
      ]),
      el('div', { class: 'cct-steps' }, steps.map((s, i) => el('div', { class: 'cct-step' + (s[2] ? ' done' : i === cur ? ' cur' : '') }, [
        el('span', { class: 'b' }, s[2] ? '✓' : String(i + 1)),
        el('div', { class: 't' }, s[0]),
        el('div', { class: 's' }, fmtT(s[1]) || ''),
      ]))),
      mapEl,
      el('div', { class: 'cct-grid' }, [
        el('div', { class: 'cct-tile' }, [el('div', { class: 'k' }, 'Rate'), el('div', { class: 'v' }, ld.rate ? '$' + Number(ld.rate).toLocaleString() : '—')]),
        el('div', { class: 'cct-tile' }, [el('div', { class: 'k' }, 'Miles'), el('div', { class: 'v' }, (remainMi != null && !done) ? remainMi + ' left / ' + (ld.miles || '—') : String(ld.miles || '—'))]),
        el('div', { class: 'cct-tile' }, [el('div', { class: 'k' }, 'Last ping'), el('div', { class: 'v' }, t && t.last_loc_at ? ago(t.last_loc_at) : '—')]),
        el('div', { class: 'cct-tile' }, [el('div', { class: 'k' }, 'Tracking'), el('div', { class: 'v' }, (t && t.tracking_method) || '—')]),
      ]),
      progPct != null ? el('div', { class: 'cct-prog' }, el('i', { style: 'width:' + progPct + '%' })) : '',
      stops.length ? el('div', { style: 'margin-top:12px' }, [
        el('h4', { class: 'cc-card-title' }, 'Stops — geofenced stamps'),
        el('div', null, stops.map(s => el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed #eef2f7;font-size:.82rem' }, [
          el('span', null, [el('b', null, (s.kind === 'pickup' ? '📦 ' : '📍 ') + (s.location || s.kind))]),
          el('span', { class: 'cc-sub' }, [s.arrived_at ? 'in ' + fmtT(s.arrived_at) : 'not arrived', s.departed_at ? ' · out ' + fmtT(s.departed_at) : ''].join('')),
        ]))),
      ]) : '',
      t ? el('div', { class: 'cct-car' }, [
        el('div', { class: 'av' }, (t.carrier || 'C').slice(0, 1).toUpperCase()),
        el('div', null, [el('b', null, t.carrier || 'Carrier'), el('div', { class: 'cc-sub' }, [t.driver_name, t.driver_phone, t.truck_no ? 'truck ' + t.truck_no : null].filter(Boolean).join(' · ') || 'no driver details yet')]),
        t.driver_phone ? el('a', { class: 'lb-btn lb-btn-ghost lb-btn-sm', style: 'margin-left:auto', href: 'tel:' + String(t.driver_phone).replace(/[^0-9+]/g, '') }, '📞 Call driver') : '',
      ]) : '',
      events.length ? el('div', { style: 'margin-top:12px' }, [
        el('h4', { class: 'cc-card-title' }, 'Event timeline'),
        el('div', { class: 'cct-ev' }, events.slice(0, 14).map(e => el('div', { class: 'e' }, [
          el('b', null, (e.kind || 'event').replace(/_/g, ' ')),
          e.to_status ? ' → ' + e.to_status : '', e.note ? ' · ' + e.note : '',
          el('div', { class: 'cc-sub' }, fmtDateTime(e.created_at)),
        ]))),
      ]) : '',
      el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Auto-refreshes every 20 seconds. Same feed the geofence detention clock runs on.'),
    ]));

    // map
    if (pins.pickup_lat != null && pins.delivery_lat != null) {
      const ok = await ensureLeaflet();
      if (ok && window.L && !dead && document.body.contains(mapEl)) {
        const L = window.L;
        map = L.map(mapEl, { zoomControl: false, attributionControl: false });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
        const pu = [Number(pins.pickup_lat), Number(pins.pickup_lng)], de = [Number(pins.delivery_lat), Number(pins.delivery_lng)];
        L.circleMarker(pu, { radius: 8, color: '#0883F7', fillColor: '#0883F7', fillOpacity: .9 }).addTo(map).bindTooltip('Pickup');
        L.circleMarker(de, { radius: 8, color: '#FC5305', fillColor: '#FC5305', fillOpacity: .9 }).addTo(map).bindTooltip('Delivery');
        L.polyline([pu, de], { color: '#94a3b8', dashArray: '6 8', weight: 2 }).addTo(map);
        const pts = (locs || []).map(p => [Number(p.lat), Number(p.lng)]).filter(p => isFinite(p[0]) && isFinite(p[1]));
        if (pts.length > 1) crumb = L.polyline(pts, { color: '#0883F7', weight: 3, opacity: .8 }).addTo(map);
        if (t && t.last_lat != null) {
          truckMk = L.marker([Number(t.last_lat), Number(t.last_lng)], { icon: L.divIcon({ html: '<div style="font-size:22px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">🚚</div>', className: '', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map).bindTooltip('Last ping ' + (ago(t.last_loc_at) || ''));
        }
        const all = [pu, de].concat(t && t.last_lat != null ? [[Number(t.last_lat), Number(t.last_lng)]] : []);
        map.fitBounds(L.latLngBounds(all).pad(0.25));
      }
    }
    timer = setTimeout(draw, 20000);
  }
  draw();
  return drawer;
}
