// opsMap.js — Control Tower Wave J: Live Operations Map.
// Plots consented, active trips on a Leaflet + OpenStreetMap map (no third-party key
// required). A side list names every tracked carrier/driver and focuses its marker on
// click; markers are colored by status. Auto-refreshes. Data via cc_ops_map (staff-gated).
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, ago } from '../../shared/ui/components.js';
import { opsMap } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const STATUS_COLOR = { in_transit: '#2563eb', dispatched: '#7c3aed', planned: '#64748b' };

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS; link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = LEAFLET_JS; s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Could not load the map library.'));
    document.head.appendChild(s);
  });
}

export function renderOpsMap(host) {
  let map = null, layer = null, timer = null;
  const markers = new Map(); // trip id -> leaflet marker
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Live operations map', 'Every consented, in-motion trip in real time. Click a truck — on the map or in the list — to see the driver and details.'),
    el('div', { id: 'om-kpis' }),
    el('div', { class: 'cc-map-legend', id: 'om-legend' }, [
      legendDot('#2563eb', 'In transit'), legendDot('#7c3aed', 'Dispatched'), legendDot('#64748b', 'Planned'),
    ]),
    el('div', { class: 'cc-map-layout' }, [
      el('div', { class: 'cc-map-wrap', id: 'om-map' }, el('div', { class: 'lb-state lb-loading' }, 'Loading map…')),
      el('div', { class: 'cc-map-side', id: 'om-list' }),
    ]),
  ]));
  const kpiHost = host.querySelector('#om-kpis');
  const mapHost = host.querySelector('#om-map');
  const listHost = host.querySelector('#om-list');

  start();
  const obs = new MutationObserver(() => { if (!document.body.contains(mapHost)) { clearInterval(timer); obs.disconnect(); if (map) { map.remove(); map = null; } } });
  obs.observe(document.body, { childList: true, subtree: true });

  async function start() {
    let L;
    try { L = await loadLeaflet(); }
    catch (e) { showError(mapHost, humanizeError(e), start); return; }
    mapHost.textContent = '';
    map = L.map(mapHost, { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    await refresh(L);
    timer = setInterval(() => refresh(L), 20000);
  }

  function focusTrip(t) {
    if (!map || t.lat == null) return;
    map.setView([t.lat, t.lng], 9, { animate: true });
    const m = markers.get(t.id); if (m) m.openPopup();
  }

  async function refresh(L) {
    let d;
    try { d = await opsMap(); } catch (_) { return; }
    const trips = (d && d.trips) || [];
    mount(kpiHost, el('div', { class: 'cc-kpi-grid', style: 'margin-bottom:12px' }, [
      statCard({ icon: 'truck', label: 'Active trips', value: String(Number((d && d.active) || 0)), sub: (d && d.tracked) + ' with live GPS', accent: 'blue', to: '#/trips' }),
      statCard({ icon: 'bell', label: 'On the map', value: String(trips.length), sub: 'consented & moving', accent: 'green' }),
    ]));

    layer.clearLayers(); markers.clear();
    const pts = [];
    trips.forEach(t => {
      if (t.lat == null || t.lng == null) return;
      const color = STATUS_COLOR[t.status] || '#64748b';
      const m = L.circleMarker([t.lat, t.lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 });
      m.bindPopup('<b>' + esc(t.carrier || 'Carrier') + '</b><br>' + (t.driver ? '🚛 ' + esc(t.driver) : '') + (t.truck ? ' · Unit ' + esc(t.truck) : '') +
        '<br>' + esc((t.status || '').replace(/_/g, ' ')) + '<br><small>updated ' + esc(ago(t.updated)) + '</small><br><a href="#/trips">Open trips →</a>');
      m.addTo(layer); markers.set(t.id, m); pts.push([t.lat, t.lng]);
    });
    if (pts.length) { try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 7 }); } catch (_) {} }

    // side list — names every tracked driver/carrier
    mount(listHost, [
      el('div', { class: 'cc-map-side-head' }, 'Tracked now (' + trips.length + ')'),
      trips.length ? el('div', null, trips.map(t => el('div', { class: 'cc-map-row', onClick: () => focusTrip(t) }, [
        el('span', { class: 'cc-map-dot', style: 'background:' + (STATUS_COLOR[t.status] || '#64748b') }),
        el('div', { class: 'cc-map-row-main' }, [
          el('b', null, t.driver || t.carrier || 'Driver'),
          el('div', { class: 'cc-sub' }, (t.carrier || '') + (t.truck ? ' · Unit ' + t.truck : '')),
          el('div', { class: 'cc-sub' }, [statusPill(t.status), ' · ', ago(t.updated)]),
        ]),
      ]))) : el('div', { class: 'cc-sub', style: 'padding:10px' }, 'No trips are sharing live location right now. Drivers share from the Carrier Pocket app (Trips → 📍 Share location).'),
    ]);
  }
}

function legendDot(color, label) {
  return el('span', { class: 'cc-legend-item' }, [el('span', { class: 'cc-map-dot', style: 'background:' + color }), label]);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export default renderOpsMap;
