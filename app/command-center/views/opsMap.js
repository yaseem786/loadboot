// opsMap.js — Control Tower Wave J: Live Operations Map.
// Plots consented, active trips on a Leaflet + OpenStreetMap map (no third-party key
// required). Markers are colored by status and click through to the trip. Auto-refreshes.
// Data via cc_ops_map (staff-gated). Leaflet is loaded on demand from cdnjs.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, ago } from '../../shared/ui/components.js';
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
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Live operations map', 'Every consented, in-motion trip in real time. Markers update automatically; click a truck for details.'),
    el('div', { id: 'om-kpis' }),
    el('div', { class: 'cc-map-wrap', id: 'om-map' }, el('div', { class: 'lb-state lb-loading' }, 'Loading map…')),
  ]));
  const kpiHost = host.querySelector('#om-kpis');
  const mapHost = host.querySelector('#om-map');

  start();
  const obs = new MutationObserver(() => { if (!document.body.contains(mapHost)) { clearInterval(timer); obs.disconnect(); if (map) { map.remove(); map = null; } } });
  obs.observe(document.body, { childList: true, subtree: true });

  async function start() {
    let L;
    try { L = await loadLeaflet(); }
    catch (e) { showError(mapHost, humanizeError(e), start); return; }
    mapHost.textContent = '';
    map = L.map(mapHost, { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4); // continental US
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    await refresh(L);
    timer = setInterval(() => refresh(L), 20000);
  }

  async function refresh(L) {
    let d;
    try { d = await opsMap(); } catch (_) { return; }
    const trips = (d && d.trips) || [];
    mount(kpiHost, el('div', { class: 'cc-kpi-grid', style: 'margin-bottom:14px' }, [
      statCard({ icon: 'truck', label: 'Active trips', value: String(Number((d && d.active) || 0)), sub: (d && d.tracked) + ' with live GPS', accent: 'blue', to: '#/trips' }),
      statCard({ icon: 'bell', label: 'On the map', value: String(trips.length), sub: 'consented & moving', accent: 'green' }),
    ]));
    layer.clearLayers();
    const pts = [];
    trips.forEach(t => {
      if (t.lat == null || t.lng == null) return;
      const color = STATUS_COLOR[t.status] || '#64748b';
      const m = L.circleMarker([t.lat, t.lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 });
      m.bindPopup('<b>' + esc(t.carrier || 'Carrier') + '</b><br>' + esc(t.status) + (t.driver ? ' · ' + esc(t.driver) : '') +
        '<br><small>updated ' + esc(ago(t.updated)) + '</small><br><a href="#/trips">Open trips →</a>');
      m.addTo(layer); pts.push([t.lat, t.lng]);
    });
    if (pts.length) { try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 7 }); } catch (_) {} }
  }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export default renderOpsMap;
