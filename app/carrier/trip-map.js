// trip-map.js — LoadBoot premium live trip (v3).
// inDrive-class experience, trucking semantics:
// • Opens straight onto the A→B leg (real road route via OSRM, dark CARTO tiles)
// • "I am on my way" → broker-visible check-in event
// • AUTO GEOFENCE: entering 800 m of the stop checks the driver in automatically
//   (server-verified cc_trip_arrive_gps → status flips for carrier AND broker);
//   leaving the pickup radius auto-records departure → On the road (in_transit)
// • External navigation row (Google / Waze / phone chooser) like inDrive —
//   navigate anywhere, proof always lands in LoadBoot
// • Manual buttons remain as fallback when GPS is flaky
import { tripArriveGps, tripDepart, pocketAdvanceTrip, tripSetStopCoords, tripCheckin, pocketPostLocation, pocketUploadTripDoc } from '../shared/api.js';

const RADIUS_M = 800;
const ORANGE = '#FC5305', BLUE = '#0883F7';
const hav = (a, b, c, d) => {
  const r = (x) => x * Math.PI / 180;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(
    Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2)));
};
const fmtKm = (m) => m == null ? '' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';

let leafletP = null;
function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => res(window.L);
    s.onerror = () => { leafletP = null; rej(new Error('Could not load the map library.')); };
    document.head.appendChild(s);
  });
  return leafletP;
}
function ensurePulseCss() {
  if (document.getElementById('lb-map-css')) return;
  const st = document.createElement('style'); st.id = 'lb-map-css';
  st.textContent = '@keyframes lbpulse{0%{box-shadow:0 0 0 0 rgba(252,83,5,.45)}70%{box-shadow:0 0 0 22px rgba(252,83,5,0)}100%{box-shadow:0 0 0 0 rgba(252,83,5,0)}} .lb-flow{stroke-dasharray:2 16;animation:lbdash 1.1s linear infinite} @keyframes lbdash{to{stroke-dashoffset:-18}} @keyframes lbdrop{0%{transform:translate(-50%,-140%);opacity:0}100%{transform:translate(-50%,0);opacity:1}}';
  document.head.appendChild(st);
}
async function geocode(q) {
  if (!q) return null;
  try {
    const r = await fetch('https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(q));
    const j = await r.json(); const f = j && j.features && j.features[0];
    return f ? { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } : null;
  } catch (_) { return null; }
}
async function osrmRoute(a, b, withSteps, alts) {
  if (!a || !b) return null;
  try {
    const u = 'https://router.project-osrm.org/route/v1/driving/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson' + (withSteps ? '&steps=true' : '') + (alts ? '&alternatives=2' : '');
    const r = await fetch(u); const j = await r.json();
    if (alts && j && j.routes) return j.routes.map(rt2 => parseRt(rt2, withSteps));
    const rt = j && j.routes && j.routes[0]; if (!rt) return null;
    return parseRt(rt, withSteps);
  } catch (_) { return null; }
}
function parseRt(rt, withSteps) {
  const out = { latlngs: rt.geometry.coordinates.map(c => [c[1], c[0]]), km: rt.distance / 1000, min: Math.round(rt.duration / 60), steps: null };
  if (withSteps && rt.legs && rt.legs[0] && rt.legs[0].steps) {
    out.steps = rt.legs[0].steps.filter(st2 => st2.maneuver && st2.maneuver.type !== 'depart').map(st2 => ({
      lat: st2.maneuver.location[1], lng: st2.maneuver.location[0],
      type: st2.maneuver.type, mod: st2.maneuver.modifier || '', name: st2.name || '', dist: st2.distance || 0, dur: st2.duration || 0,
    }));
  }
  return out;
}
const TURN_ICON = (type, mod) => {
  if (type === 'arrive') return '🏁';
  if (type === 'roundabout' || type === 'rotary') return '↻';
  if (/uturn/.test(mod)) return '⮌';
  if (/left/.test(mod)) return /slight/.test(mod) ? '⬉' : '⬅';
  if (/right/.test(mod)) return /slight/.test(mod) ? '⬈' : '➡';
  return '⬆';
};
// slim Google-style stroked arrows for the main banner
const TURN_SVG = (type, mod) => {
  const P = (d) => '<svg width="40" height="40" viewBox="0 0 36 36" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  if (type === 'arrive') return '<div style="font-size:1.9rem;line-height:1">🏁</div>';
  if (type === 'roundabout' || type === 'rotary') return '<svg width="40" height="40" viewBox="0 0 36 36" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><circle cx="18" cy="20" r="8"/><path d="M18 12 V4 M14 8 L18 4 L22 8"/></svg>';
  if (/uturn/.test(mod)) return P('M12 30 V14 a6 6 0 0 1 12 0 V26 M18 22 L24 29 L30 22');
  if (/slight left/.test(mod)) return P('M22 30 V18 L12 8 M12 17 V8 H21');
  if (/slight right/.test(mod)) return P('M14 30 V18 L24 8 M24 17 V8 H15');
  if (/left/.test(mod)) return P('M26 30 V18 a4 4 0 0 0 -4 -4 H8 M14 8 L8 14 L14 20');
  if (/right/.test(mod)) return P('M10 30 V18 a4 4 0 0 1 4 -4 H28 M22 8 L28 14 L22 20');
  return P('M18 30 V8 M10 15 L18 7 L26 15');
};
const TURN_TXT = (type, mod, name) => {
  const road = name ? ' onto ' + name : '';
  if (type === 'arrive') return 'Arrive at your stop';
  if (type === 'roundabout' || type === 'rotary') return 'Take the roundabout' + road;
  if (/uturn/.test(mod)) return 'Make a U-turn';
  if (mod) return 'Turn ' + mod + road;
  return 'Continue' + road;
};

const stKey = (id, k) => 'lbmap3:' + id + (k ? ':' + k : '');
const getStep = (t) => {
  // server status is the truth — the cached step may be stale (resets, other devices)
  const saved = sessionStorage.getItem(stKey(t.id));
  if (t.status === 'delivered' || t.status === 'invoiced') return 'done';
  if (t.status === 'in_transit') return saved === 'at_delivery' ? 'at_delivery' : 'to_delivery';
  if (t.status === 'dispatched') return 'at_pickup';
  return 'to_pickup'; // planned: Mark delivered can NEVER appear here
};
const setStep = (t, s) => { try { sessionStorage.setItem(stKey(t.id), s); } catch (_) {} };
const el = (tag, style, txt) => { const e = document.createElement(tag); if (style) e.style.cssText = style; if (txt != null) e.textContent = txt; return e; };
const money = (n) => '$' + Number(n || 0).toLocaleString();

export async function openTripMap(t, opts = {}) {
  ensurePulseCss();
  const ov = el('div', 'position:fixed;inset:0;height:100dvh;z-index:9999;background:#0f1114;display:flex;flex-direction:column;font-family:Manrope,system-ui,sans-serif');
  document.body.appendChild(ov);
  const mapWrap = el('div', 'position:relative;flex:1;min-height:0');
  const mapDiv = el('div', 'position:absolute;inset:0');
  mapWrap.appendChild(mapDiv);
  ov.appendChild(mapWrap);
  const ui = mapWrap; // controls live INSIDE the map pane; the sheet sits below it

  // ---- top bar: stage chip + rate + docs/close ----
  const top = el('div', 'position:absolute;top:0;left:0;right:0;z-index:1000;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:13px 14px;background:none');
  const stageChip = { set textContent(v) { if (openTripMap._h) openTripMap._h.textContent = v; } }; // routed to sheet header
  const topSpacer = el('div', '');
  const chipBtn = (txt) => el('button', 'pointer-events:auto;background:rgba(13,18,26,.72);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);color:#fff;font-size:.8rem;font-weight:800;height:40px;padding:0 12px;border-radius:12px;cursor:pointer;font-family:Manrope,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25)', txt);
  const docsBtn = chipBtn('📄');
  const styleBtn = chipBtn({ day: '🌙', dark: '🛰️', sat: '☀️' }[localStorage.getItem('lb:mapstyle') || 'day'] || '🌙');
  let voiceOn = localStorage.getItem('lb:voice') !== '0';
  const voiceBtn = chipBtn(voiceOn ? '🔊' : '🔇');
  voiceBtn.onclick = () => { voiceOn = !voiceOn; localStorage.setItem('lb:voice', voiceOn ? '1' : '0'); voiceBtn.textContent = voiceOn ? '🔊' : '🔇'; };
  const say = (txt) => { if (!voiceOn) return; try { const u2 = new SpeechSynthesisUtterance(txt); u2.lang = 'en-US'; u2.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u2); } catch (_) {} };
  styleBtn.onclick = () => {
    mode = MODE_NEXT[mode] || 'day';
    localStorage.setItem('lb:mapstyle', mode);
    styleBtn.textContent = MODE_ICON[mode];
    tiles.setUrl(TILES[mode]);
    if (mode === 'sat') tiles.options.maxZoom = 19;
    mapDiv.style.background = mode === 'day' ? '#e8ecf1' : '#0f1114';
    try { openTripMap._flow && openTripMap._flow.setStyle({ color: mode === 'day' ? '#10223B' : '#ffffff' }); } catch (_) {}
  };
  const fsBtn = chipBtn('⛶');
  fsBtn.onclick = () => toggleSheet();
  const sim = { on: false, timer: null, path: [], i: 0, pauseUntil: 0, pausedOnce: false };
  const DEV_HOST = /^(\d+\.|localhost$|192\.|172\.|10\.)/.test(location.hostname);
  const simBtn = DEV_HOST ? chipBtn('🧪') : null;
  const x = chipBtn('✕');
  const btns = el('div', 'display:flex;gap:7px;align-items:center');
  btns.append(...[simBtn, voiceBtn, styleBtn, fsBtn, docsBtn, x].filter(Boolean));
  top.append(topSpacer, btns);
  ui.appendChild(top);
  const navBox = el('div', 'position:absolute;top:66px;left:10px;right:10px;z-index:1000;display:none;background:linear-gradient(135deg,#10223B,#173456);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:15px 18px;box-shadow:0 12px 34px rgba(0,0,0,.55)');
  const navMain = el('div', 'display:flex;align-items:center;gap:16px');
  const navArrow = el('div', 'flex:none;width:44px;height:44px;display:flex;align-items:center;justify-content:center');
  const navTxtW = el('div', 'min-width:0');
  const navRoad = el('div', 'color:#fff;font-weight:800;font-size:1.28rem;line-height:1.25', '');
  const navDist = el('div', 'color:#9fc0e8;font-weight:700;font-size:.92rem;margin-top:3px;letter-spacing:.01em', '');
  navTxtW.append(navRoad, navDist);
  navMain.append(navArrow, navTxtW);
  const navThen = el('div', 'color:#dbe7f8;font-size:1.02rem;font-weight:800;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.12);display:none;line-height:1.35', '');
  navBox.append(navMain, navThen);
  ui.appendChild(navBox);
  const bottom = el('div', 'flex:none');
  ov.appendChild(bottom);

  let watchId = null;
  let wake = null;
  const grabWake = async () => { try { wake = await navigator.wakeLock.request('screen'); } catch (_) {} };
  grabWake();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') grabWake(); });
  const fitViewport = () => {
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    ov.style.height = vh + 'px';
  };
  fitViewport();
  const _vv = window.visualViewport;
  const onVV = () => { fitViewport(); try { map && map.invalidateSize(); } catch (_) {} };
  if (_vv) { _vv.addEventListener('resize', onVV); _vv.addEventListener('scroll', onVV); }
  window.addEventListener('resize', onVV);
  const close = () => {
    try { wake && wake.release(); } catch (_) {}
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    if (_vv) { _vv.removeEventListener('resize', onVV); _vv.removeEventListener('scroll', onVV); }
    window.removeEventListener('resize', onVV);
    ov.remove();
  };
  x.onclick = close;
  docsBtn.onclick = () => { close(); if (opts.docs) try { opts.docs(); } catch (_) {} };

  let L;
  try { L = await ensureLeaflet(); } catch (e) { bottom.appendChild(el('div', 'color:#fff', e.message)); return; }
  const map = L.map(mapDiv, { zoomControl: false, attributionControl: false }).setView([31.5, 73.0], 6);
  const TILES = { dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', day: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' };
  const MODE_ICON = { day: '🌙', dark: '🛰️', sat: '☀️' }; // icon = what you get NEXT
  const MODE_NEXT = { day: 'dark', dark: 'sat', sat: 'day' };
  let mode = localStorage.getItem('lb:mapstyle') || 'day';
  let tiles = L.tileLayer(TILES[mode] || TILES.day, { maxZoom: 20, subdomains: 'abcd' }).addTo(map);
  mapDiv.style.background = mode === 'day' ? '#e8ecf1' : '#0f1114';
  L.control.attribution({ prefix: false, position: 'topright' }).addAttribution('© OSM · CARTO').addTo(map);
  requestAnimationFrame(() => { try { map.invalidateSize(); } catch (_) {} });
  setTimeout(() => { try { map.invalidateSize(); if (routeLine) map.fitBounds(routeLine.getBounds(), { padding: [70, 70] }); } catch (_) {} }, 400);

  const dot = (color, letter) => L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div style="width:30px;height:30px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-family:Manrope,sans-serif;box-shadow:0 0 0 4px ' + color + '44,0 4px 12px rgba(0,0,0,.6)">' + letter + '</div>' });
  const truckIcon = L.divIcon({ className: '', iconSize: [46, 46], iconAnchor: [23, 23],
    html: '<div style="width:46px;height:46px;border-radius:50%;background:' + ORANGE + ';display:flex;align-items:center;justify-content:center;font-size:23px;animation:lbpulse 2s infinite;box-shadow:0 6px 16px rgba(0,0,0,.6)">🚛</div>' });
  const bubble = (ll, txt) => L.marker(ll, { zIndexOffset: 1200, icon: L.divIcon({ className: '', iconSize: [1, 1],
    html: '<div style="display:inline-block;width:max-content;transform:translate(-50%,-135%);background:#10223B;border:1px solid rgba(255,255,255,.3);color:#fff;font-weight:800;font-size:13px;font-family:Manrope,sans-serif;padding:7px 12px;border-radius:12px;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.45)">' + txt + '</div>' }), interactive: false }).addTo(map);

  const P = (t.pickup_lat != null && t.pickup_lng != null) ? { lat: t.pickup_lat, lng: t.pickup_lng } : await geocode(t.origin);
  const D = (t.delivery_lat != null && t.delivery_lng != null) ? { lat: t.delivery_lat, lng: t.delivery_lng } : await geocode(t.destination);
  if ((t.pickup_lat == null && P) || (t.delivery_lat == null && D)) tripSetStopCoords(t.id, P && P.lat, P && P.lng, D && D.lat, D && D.lng).catch(() => {});
  if (P) { L.marker([P.lat, P.lng], { icon: dot(BLUE, 'A') }).addTo(map); L.circle([P.lat, P.lng], { radius: RADIUS_M, color: BLUE, weight: 1, opacity: .5, fillOpacity: .07 }).addTo(map); }
  if (D) { L.marker([D.lat, D.lng], { icon: dot(ORANGE, 'B') }).addTo(map); L.circle([D.lat, D.lng], { radius: RADIUS_M, color: ORANGE, weight: 1, opacity: .5, fillOpacity: .07 }).addTo(map); }

  let me = null, meMark = null, routeGlow = null, routeLine = null, etaBub = null, feeder = null, abDrawn = false;
  let step = getStep(t);
  let onway = localStorage.getItem(stKey(t.id, 'onway')) === '1';
  let autoBusy = false, follow = true;
  const target = () => (step === 'to_delivery' || step === 'at_delivery') ? D : P;

  const nav = { line: null, steps: null, idx: 0, legKey: null, lastFetch: 0, spoke: {} };
  async function buildNav(force) {
    const tg = target(); if (!me || !tg) return;
    const now2 = Date.now();
    if (!force && nav.legKey === step && nav.steps && now2 - nav.lastFetch < 45000) return;
    nav.lastFetch = now2; nav.legKey = step;
    const routes = await osrmRoute(me, tg, true, true);
    if (!routes || !routes.length) return;
    const useRt = (rt) => {
      if (nav.line) { nav.line.remove(); nav.line = null; }
      nav.line = L.polyline(rt.latlngs, { color: BLUE, weight: 5.5, opacity: .92 }).addTo(map);
      nav.steps = rt.steps || []; nav.idx = 0; nav.spoke = {};
      nav.min = rt.min; nav.km = rt.km; nav.at = new Date(Date.now() + rt.min * 60000);
    };
    (nav.altLines || []).forEach(l3 => l3.remove()); nav.altLines = [];
    routes.slice(1).forEach(alt => {
      const extra = alt.min - routes[0].min;
      const al = L.polyline(alt.latlngs, { color: '#7d8aa0', weight: 5, opacity: .55, dashArray: '1 10' }).addTo(map);
      al.bindTooltip((extra >= 0 ? '+' : '') + extra + ' min · tap to take this route', { sticky: true });
      al.on('click', () => { (nav.altLines || []).forEach(l3 => l3.remove()); nav.altLines = []; useRt(alt); navTick(); paint(); flash('Route switched — ' + alt.min + ' min · ' + alt.km.toFixed(1) + ' km'); });
      nav.altLines.push(al);
    });
    useRt(routes[0]);
    if (feeder) { feeder.remove(); feeder = null; }
  }
  function navTick() {
    if (!nav.steps || !nav.steps.length || step === 'at_pickup' || step === 'at_delivery' || step === 'done') { navBox.style.display = 'none'; return; }
    // advance past maneuvers we have reached
    while (nav.idx < nav.steps.length - 1 && me && hav(me.lat, me.lng, nav.steps[nav.idx].lat, nav.steps[nav.idx].lng) < 32) { nav.idx++; nav.spoke = {}; }
    const up = nav.steps[nav.idx]; if (!up || !me) { navBox.style.display = 'none'; return; }
    const d2 = hav(me.lat, me.lng, up.lat, up.lng);
    navArrow.innerHTML = TURN_SVG(up.type, up.mod);
    const secs2 = Math.round(d2 / Math.max(lastSpeed || 12, 6));
    navDist.textContent = (d2 >= 1000 ? (d2 / 1000).toFixed(1) + ' km' : d2 + ' m') + ' · ' + (secs2 < 60 ? secs2 + ' sec' : Math.round(secs2 / 60) + ' min') + ' ahead';
    const _act = TURN_TXT(up.type, up.mod, '');
    navRoad.innerHTML = up.name
      ? '<span style="color:#9fc0e8;font-size:.85rem;font-weight:700;display:block;margin-bottom:1px">' + _act.toLowerCase() + ' onto</span>' + up.name
      : _act;
    const nxt = nav.steps[nav.idx + 1];
    if (nxt) {
      navThen.style.display = '';
      navThen.innerHTML = '<span style="color:#8fa6c4;font-size:.8rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-right:8px">Then</span>'
        + '<span style="font-size:1.25rem;vertical-align:-2px;margin-right:6px">' + TURN_ICON(nxt.type, nxt.mod) + '</span>' + TURN_TXT(nxt.type, nxt.mod, nxt.name);
    } else navThen.style.display = 'none';
    navBox.style.display = '';
    if (d2 < 450 && !nav.spoke.far) { nav.spoke.far = true; say('In ' + Math.round(d2 / 50) * 50 + ' meters, ' + TURN_TXT(up.type, up.mod, up.name)); }
    if (d2 < 90 && !nav.spoke.near) { nav.spoke.near = true; say(TURN_TXT(up.type, up.mod, up.name) + (nxt ? '. Then ' + TURN_TXT(nxt.type, nxt.mod, nxt.name) : '')); }
    // off-route? recalc (throttled by buildNav)
    let mind = Infinity; const pts2 = nav.line ? nav.line.getLatLngs() : [];
    for (let i2 = 0; i2 < pts2.length; i2 += Math.max(1, Math.floor(pts2.length / 60))) {
      const dd2 = hav(me.lat, me.lng, pts2[i2].lat, pts2[i2].lng); if (dd2 < mind) mind = dd2;
    }
    if (mind > 260) { say('Rerouting'); buildNav(true); }
  }
  function updateFeeder() {
    const tg = target();
    if (nav.line) { navTick(); return; }
    if (feeder) { feeder.remove(); feeder = null; }
    if (me && tg) feeder = L.polyline([[me.lat, me.lng], [tg.lat, tg.lng]], { color: BLUE, weight: 3, opacity: .85, dashArray: '8 8' }).addTo(map);
  }
  async function drawRoute() {
    // full load route A→B is ALWAYS on the map — no GPS needed for it
    if (!abDrawn && P && D) {
      abDrawn = true;
      const rt = await osrmRoute(P, D);
      const pts = rt ? rt.latlngs : [[P.lat, P.lng], [D.lat, D.lng]];
      routeGlow = L.polyline(pts, { color: ORANGE, weight: 11, opacity: .16 }).addTo(map);
      routeLine = L.polyline(pts, { color: ORANGE, weight: 4.5, opacity: .95 }).addTo(map);
      openTripMap._flow = L.polyline(pts, { color: mode === 'day' ? '#10223B' : '#ffffff', weight: 2.5, opacity: .9, className: 'lb-flow' }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [70, 70] });
      if (rt) { etaBub = bubble([D.lat, D.lng], rt.min + ' min · ' + rt.km.toFixed(1) + ' km'); openTripMap._km = rt.km; }
    } else if (!abDrawn) {
      const tg = target() || P || D; if (tg) map.setView([tg.lat, tg.lng], 11);
    }
    updateFeeder();
  }

  // ---- bottom sheet (premium, safe-area aware) ----
  const sheet = el('div', 'background:#12171f;border-top:1px solid rgba(255,255,255,.08);border-radius:20px 20px 0 0;margin-top:-18px;position:relative;z-index:1001;padding:9px 16px calc(16px + env(safe-area-inset-bottom, 10px));box-shadow:0 -14px 44px rgba(0,0,0,.55)');
  try { new ResizeObserver(() => { try { map.invalidateSize(); } catch (_) {} }).observe(sheet); } catch (_) {}
  bottom.appendChild(sheet);
  const handle = el('div', 'width:100%;padding:2px 0 9px;cursor:pointer');
  handle.appendChild(el('div', 'width:44px;height:5px;border-radius:99px;background:rgba(255,255,255,.25);margin:0 auto'));
  sheet.appendChild(handle);
  const contentWrap = el('div', '');
  const miniRow = el('div', 'display:none;align-items:center;justify-content:space-between;gap:10px;padding:2px 2px 4px;cursor:pointer');
  const miniL = el('div', 'min-width:0');
  const miniTime = el('div', 'color:#4ade80;font-weight:900;font-size:1.35rem;line-height:1.1', '');
  const miniTxt = el('div', 'color:#9fb0c8;font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', '');
  miniL.append(miniTime, miniTxt);
  const exitBtn = el('button', 'flex:none;border:0;border-radius:99px;padding:12px 20px;background:#dc2626;color:#fff;font-weight:900;font-size:.92rem;cursor:pointer;font-family:Manrope,sans-serif', 'Exit');
  exitBtn.onclick = (e2) => { e2.stopPropagation(); close(); };
  const openHint = el('button', 'flex:none;border:1px solid rgba(255,255,255,.18);border-radius:99px;padding:12px 16px;background:rgba(255,255,255,.08);color:#fff;font-weight:800;font-size:.85rem;cursor:pointer;font-family:Manrope,sans-serif', '\u25b4 Details');
  openHint.onclick = (e2) => { e2.stopPropagation(); toggleSheet(); };
  miniRow.append(miniL, openHint, exitBtn);
  sheet.appendChild(miniRow);
  let collapsed = false;
  const toggleSheet = () => {
    collapsed = !collapsed;
    contentWrap.style.display = collapsed ? 'none' : '';
    miniRow.style.display = collapsed ? 'flex' : 'none';
    if (openTripMap._fs) openTripMap._fs.textContent = collapsed ? '🗂  Trip details' : '⛶  Full map';
    setTimeout(() => { try { map.invalidateSize(); if (routeLine && !collapsed) map.fitBounds(routeLine.getBounds(), { padding: [70, 70] }); } catch (_) {} }, 60);
  };
  handle.onclick = toggleSheet; miniRow.onclick = toggleSheet;
  openTripMap._toggle = toggleSheet;
  const headRow = el('div', 'display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:2px');
  const headTxt = el('div', 'color:#fff;font-weight:900;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
  const headRate = el('div', 'color:' + ORANGE + ';font-weight:900;font-size:1.05rem;flex:none');
  headRate.textContent = money(t.rate);
  headRow.append(headTxt, headRate);
  openTripMap._h = headTxt;
  sheet.appendChild(contentWrap);
  contentWrap.appendChild(headRow);
  const statsRow = el('div', 'display:flex;gap:8px;margin:8px 0 4px');
  const statBox = (label2) => {
    const b2 = el('div', 'flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:8px 10px;text-align:center');
    const v2 = el('div', 'color:#fff;font-weight:900;font-size:.98rem', '—');
    b2.append(v2, el('div', 'color:#7f8a9c;font-size:.66rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;margin-top:2px', label2));
    b2._v = v2; return b2;
  };
  const sbSpeed = statBox('Speed'), sbDist = statBox('Dist left'), sbSched = statBox('Appt time');
  statsRow.append(sbSpeed, sbDist, sbSched);
  contentWrap.appendChild(statsRow);
  // ---- journey step tracker: shows WHERE you are + what comes next (hint system) ----
  const STEPS = [['\u{1F697}','Start'],['\u{1F4CD}','Pickup'],['\u{1F6E3}\uFE0F','Drive'],['\u{1F3C1}','Deliver'],['\u{1F4B0}','Paid']];
  const stepsRow = el('div', 'display:flex;align-items:flex-start;gap:0;margin:2px 0 10px');
  const stepEls = STEPS.map(([ic, lb], i) => {
    const wrap = el('div', 'flex:1;display:flex;flex-direction:column;align-items:center;position:relative');
    if (i > 0) wrap.appendChild(el('div', 'position:absolute;left:-50%;top:13px;width:100%;height:2px;background:rgba(255,255,255,.12);z-index:0'));
    const dot = el('div', 'width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;background:rgba(255,255,255,.07);border:2px solid rgba(255,255,255,.14);z-index:1;transition:all .25s', ic);
    const txt = el('div', 'font-size:.6rem;font-weight:800;letter-spacing:.04em;color:#7f8a9c;margin-top:4px;text-transform:uppercase', lb);
    wrap.append(dot, txt); wrap._dot = dot; wrap._txt = txt; wrap._line = i > 0 ? wrap.firstChild : null;
    return wrap;
  });
  stepEls.forEach(w => stepsRow.appendChild(w));
  contentWrap.appendChild(stepsRow);
  function paintSteps(idx) { // idx = current step 0..4
    stepEls.forEach((w, i) => {
      const done = i < idx, cur = i === idx;
      w._dot.style.background = done ? '#16a34a' : cur ? ORANGE : 'rgba(255,255,255,.07)';
      w._dot.style.borderColor = done ? '#16a34a' : cur ? ORANGE : 'rgba(255,255,255,.14)';
      w._dot.style.boxShadow = cur ? '0 0 14px rgba(252,83,5,.55)' : 'none';
      if (done) w._dot.textContent = '\u2713';
      w._txt.style.color = done ? '#4ade80' : cur ? '#fff' : '#7f8a9c';
      if (w._line) w._line.style.background = done || cur ? '#16a34a' : 'rgba(255,255,255,.12)';
    });
  }
  // ---- one-time coach banner: explains that the trip runs itself ----
  let coachEl = null;
  try {
    if (!localStorage.getItem('lb:trip:coach')) {
      coachEl = el('div', 'background:linear-gradient(135deg,rgba(8,131,247,.16),rgba(252,83,5,.10));border:1px solid rgba(8,131,247,.35);border-radius:14px;padding:12px 13px;margin:0 0 10px');
      coachEl.append(
        el('div', 'color:#fff;font-weight:900;font-size:.88rem;margin-bottom:4px', '\u{1F4A1} This trip mostly drives itself'),
        el('div', 'color:#b9c6da;font-size:.79rem;font-weight:600;line-height:1.55', 'Just drive \u2014 LoadBoot checks you in automatically at pickup and delivery, starts your detention clock at the dock, and records departure. Your only taps: \u201CI am on my way\u201D at the start, \u201CMark delivered\u201D at the end, then upload the POD to get paid.'));
      const okB = el('button', 'margin-top:9px;border:0;border-radius:10px;padding:8px 16px;font-weight:800;font-size:.78rem;cursor:pointer;background:rgba(8,131,247,.9);color:#fff;font-family:Manrope,sans-serif', 'Got it \u2713');
      okB.onclick = () => { try { localStorage.setItem('lb:trip:coach', '1'); } catch (_) {} coachEl.remove(); coachEl = null; };
      coachEl.appendChild(okB);
      contentWrap.appendChild(coachEl);
    }
  } catch (_) {}
  const card = el('div', '');
  contentWrap.appendChild(card);
  const statEl = el('div', 'color:#93a0b4;font-size:.83rem;font-weight:600;margin:2px 0 11px;line-height:1.5');
  const actBtn = el('button', 'width:100%;border:0;border-radius:16px;padding:16px;font-size:1.03rem;font-weight:900;font-family:Manrope,sans-serif;cursor:pointer;background:' + ORANGE + ';color:#fff;box-shadow:0 0 22px rgba(252,83,5,.35);transition:opacity .15s', '…');
  // external navigation row — inDrive style, always available
  const extRow = el('div', 'display:flex;gap:8px;margin-top:9px');
  const extBtn = (label) => el('button', 'flex:1;border:0;border-radius:12px;padding:11px 6px;font-size:.78rem;font-weight:800;cursor:pointer;background:rgba(255,255,255,.09);backdrop-filter:blur(6px);color:#dbe6f5;font-family:Manrope,sans-serif', label);
  const gBtn = extBtn('🧭 Google Maps'), wBtn = extBtn('🟦 Waze'), oBtn = extBtn('📱 Other apps');
  extRow.append(gBtn, wBtn, oBtn);
  const extNote = el('div', 'color:#7f8a9c;font-size:.72rem;font-weight:600;text-align:center;margin-top:7px', 'Navigate with any app — check-ins and proof stay in LoadBoot automatically.');
  card.append(statEl, actBtn, extRow, extNote);
  // ---- dock evidence quick-capture: shows ONLY while on site (paper + GPS = bulletproof claim) ----
  const proofRow = el('div', 'display:none;gap:8px;margin-top:9px');
  const proofNote = el('div', 'display:none;color:#7f8a9c;font-size:.72rem;font-weight:600;text-align:center;margin-top:6px', '\u{1F4CE} While you wait: photo the dock, the facility-signed BOL/POD (with IN/OUT times) and any lumper receipt \u2014 they attach to this trip and land in any claim automatically.');
  const proofInput = (() => { const i9 = el('input', 'display:none'); i9.type = 'file'; i9.accept = '.pdf,.jpg,.jpeg,.png,.webp'; return i9; })();
  let proofKind = 'stop_photo';
  const mkProof = (label9, kind9) => { const b9 = extBtn(label9); b9.onclick = () => { proofKind = kind9; proofInput.click(); }; return b9; };
  proofRow.append(mkProof('\u{1F4F7} Dock photo', 'stop_photo'), mkProof('\u{1F4DD} Signed BOL/POD', 'bol_signed'), mkProof('\u{1F9FE} Lumper receipt', 'lumper_receipt'));
  proofInput.onchange = async () => {
    const f9 = proofInput.files && proofInput.files[0]; if (!f9) return;
    const kind9 = (proofKind === 'bol_signed' && (step === 'at_delivery' || step === 'to_delivery' || step === 'done')) ? 'pod_signed' : proofKind;
    try {
      flash('\u23F3 Uploading proof\u2026');
      const st9 = await import('../shared/storage.js');
      const m9 = await st9.uploadTripDoc(f9, t.id, kind9);
      await pocketUploadTripDoc({ trip: t.id, kind: kind9, path: m9.path, fileName: m9.fileName, contentType: m9.contentType, size: m9.size });
      flash('\u2713 Proof attached \u2014 it goes into any claim automatically');
    } catch (e9) { flash((e9 && e9.message) || 'Upload failed', true); }
    proofInput.value = '';
  };
  card.append(proofRow, proofNote, proofInput);
  const destLL = () => { const tg = target(); return tg ? tg.lat + ',' + tg.lng : encodeURIComponent(((step === 'to_delivery' || step === 'at_delivery') ? t.destination : t.origin) || ''); };
  gBtn.onclick = () => window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + destLL(), '_blank');
  wBtn.onclick = () => window.open('https://waze.com/ul?ll=' + destLL() + '&navigate=yes', '_blank');
  oBtn.onclick = () => {
    const q2 = destLL();
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) window.open('https://maps.apple.com/?daddr=' + q2 + '&dirflg=d', '_blank');
    else location.href = 'geo:' + q2;
  };
  // recenter
  const ICO = {
    globe: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>',
    route: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="6" cy="19" r="2.6"/><circle cx="18" cy="5" r="2.6"/><path d="M8 17c6-2 2-8 8-10" stroke-dasharray="3 3"/></svg>',
    locate: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M3 11.5 L21 3 L12.5 21 L10.8 13.2 Z"/></svg>',
    warn: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linejoin="round"><path d="M12 3 L22 20 H2 Z"/><path d="M12 9v5" stroke-linecap="round"/><circle cx="12" cy="17" r="0.6" fill="#FBBF24"/></svg>',
  };
  const stack = el('div', 'position:absolute;right:12px;bottom:30px;z-index:1000;display:flex;flex-direction:column;background:rgba(13,18,26,.85);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);border-radius:99px;box-shadow:0 10px 28px rgba(0,0,0,.5);overflow:hidden');
  const stackBtn = (svg) => { const b2 = el('button', 'width:52px;height:52px;border:0;background:none;display:flex;align-items:center;justify-content:center;cursor:pointer'); b2.innerHTML = svg; return b2; };
  const sep = () => el('div', 'height:1px;margin:0 14px;background:rgba(255,255,255,.12)');
  const glBtn = stackBtn(ICO.globe);
  glBtn.onclick = () => styleBtn.onclick();
  const ovwBtn = stackBtn(ICO.route);
  ovwBtn.onclick = () => { follow = false; recPillShow(); try { if (routeLine) map.fitBounds(routeLine.getBounds(), { padding: [60, 60] }); } catch (_) {} };
  const rec = stackBtn(ICO.locate);
  stack.append(glBtn, sep(), ovwBtn, sep(), rec);
  ui.appendChild(stack);
  const hazBtn = el('button', 'position:absolute;right:12px;bottom:212px;z-index:1000;width:52px;height:52px;border-radius:50%;border:1px solid rgba(251,191,36,.35);background:rgba(13,18,26,.85);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.45)');
  hazBtn.innerHTML = ICO.warn;
  hazBtn.onclick = () => { close(); if (opts.emergency) try { opts.emergency(); } catch (_) {} };
  ui.appendChild(hazBtn);
  let recPillShow = () => {};
  const fsPill = el('button', 'position:absolute;left:14px;bottom:30px;z-index:1000;border:0;border-radius:99px;padding:12px 16px;font-size:.84rem;font-weight:800;font-family:Manrope,sans-serif;background:rgba(10,14,20,.78);backdrop-filter:blur(10px);color:#fff;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.45)', '⛶  Full map');
  ui.appendChild(fsPill);
  openTripMap._fs = fsPill;
  fsPill.onclick = () => { if (openTripMap._toggle) openTripMap._toggle(); };
  const recPill = el('button', 'position:absolute;left:14px;bottom:86px;z-index:1000;display:none;border:0;border-radius:99px;padding:13px 18px;font-size:.9rem;font-weight:900;font-family:Manrope,sans-serif;background:#0883F7;color:#fff;cursor:pointer;box-shadow:0 8px 20px rgba(8,131,247,.45)', '\u25b2  Re-center');
  ui.appendChild(recPill);
  const doRecenter = () => {
    follow = true; recPill.style.display = 'none';
    if (me) map.setView([me.lat, me.lng], 16, { animate: true });
    else try { if (routeLine) map.fitBounds(routeLine.getBounds(), { padding: [70, 70] }); } catch (_) {} };
  recPill.onclick = doRecenter;
  recPillShow = () => { recPill.style.display = ''; };
  rec.onclick = () => doRecenter();

  const puIn = () => {
    if (t.pickup_mode === 'fcfs') return ' \u00b7 FCFS';
    if (!t.scheduled_pickup) return '';
    let d2 = Math.floor((new Date(t.scheduled_pickup).getTime() - Date.now()) / 60000);
    const late = d2 < 0; if (late) d2 = -d2;
    const hh = Math.floor(d2 / 60), mm = d2 % 60;
    return (late ? ' \u00b7 \u26a0 PU late ' : ' \u00b7 PU in ') + (hh ? hh + 'h ' : '') + mm + 'm';
  };
  let lastSpeed = null;
  function paint() {
    const tg = target();
    const distM = (me && tg) ? hav(me.lat, me.lng, tg.lat, tg.lng) : null;
    if (collapsed) {
      miniTime.textContent = nav.min != null ? nav.min + ' min' : (openTripMap._h ? openTripMap._h.textContent.slice(0, 16) : '');
      miniTxt.textContent = nav.min != null ? (nav.km.toFixed(1) + ' km · arrive ' + nav.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : 'tap to open trip details';
    }
    sbSpeed._v.textContent = lastSpeed != null ? Math.round(lastSpeed * 3.6) + ' km/h' : '—';
    sbDist._v.textContent = distM != null ? fmtKm(distM) : '—';
    const schedT = (step === 'to_delivery' || step === 'at_delivery') ? t.scheduled_delivery : t.scheduled_pickup;
    sbSched._v.textContent = t.pickup_mode === 'fcfs' ? 'FCFS' : schedT ? new Date(schedT).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
    paintSteps(step === 'to_pickup' ? (onway ? 1 : 0) : step === 'at_pickup' ? 1 : step === 'to_delivery' ? 2 : step === 'at_delivery' ? 3 : 4);
    const onSite = step === 'at_pickup' || step === 'at_delivery';
    proofRow.style.display = onSite ? 'flex' : 'none'; proofNote.style.display = onSite ? 'block' : 'none';
    const near = distM != null && distM <= RADIUS_M;
    actBtn.disabled = false; actBtn.style.opacity = '1';
    const etaTxt = nav.min != null ? (nav.min + ' min · ' + nav.km.toFixed(1) + ' km · ' + nav.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : null;
    if (step === 'to_pickup') {
      stageChip.textContent = etaTxt ? '🚛 ' + etaTxt : '🚛 To pickup' + (distM != null ? ' · ' + fmtKm(distM) : '') + puIn();
      if (!onway) {
        if (me) { actBtn.textContent = '🚛  I am on my way'; statEl.textContent = 'Tap to let dispatch and the broker know you are rolling toward A.'; }
        else if (DEV_HOST) { actBtn.textContent = '🧪  Start test drive'; statEl.textContent = 'No GPS on this test address — the simulator drives the whole trip for you: auto check-in, dock time, departure, delivery.'; }
        else { actBtn.textContent = '📡  Waiting for GPS…'; actBtn.disabled = true; actBtn.style.opacity = '.5'; statEl.textContent = 'The trip cannot start without location — enable GPS to begin.'; }
      } else if (near) {
        actBtn.textContent = '📍  Checking you in at the pickup…';
        statEl.textContent = 'You are inside the pickup zone — auto check-in is running.';
      } else {
        actBtn.textContent = '📍  Auto check-in at 800 m' + (distM != null ? ' — ' + fmtKm(distM) + ' to go' : '');
        actBtn.disabled = true; actBtn.style.opacity = '.55';
        statEl.textContent = 'Just drive. The moment you enter the blue circle at A, LoadBoot checks you in and updates the broker — no tap needed.';
      }
    } else if (step === 'at_pickup') {
      stageChip.textContent = '📦 At pickup · detention clock running';
      actBtn.textContent = '🚛  Loaded — leaving pickup';
      statEl.textContent = 'Checked in at A ✓ (broker notified). When you drive out of the zone we record departure automatically — or tap when loaded.';
    } else if (step === 'to_delivery') {
      stageChip.textContent = etaTxt ? '🚛 ' + etaTxt : '🚛 On the road' + (distM != null ? ' · ' + fmtKm(distM) + ' to B' : '') + ' · ' + money(t.rate);
      if (!tg) { actBtn.textContent = '📍  Pinning the delivery location…'; actBtn.disabled = true; actBtn.style.opacity = '.55'; statEl.textContent = 'Setting the delivery point on the map — one moment. Check-in stays locked until it is pinned.'; }
      else if (near) { actBtn.textContent = '📍  Checking you in at the delivery…'; statEl.textContent = 'Inside the delivery zone — auto check-in is running.'; }
      else { actBtn.textContent = '📍  Auto check-in at 800 m' + (distM != null ? ' — ' + fmtKm(distM) + ' to go' : ''); actBtn.disabled = true; actBtn.style.opacity = '.55'; statEl.textContent = 'Drive to B. Entering the orange circle checks you in automatically.'; }
    } else if (step === 'at_delivery') {
      stageChip.textContent = '🏁 At delivery';
      actBtn.textContent = '✓  Mark delivered';
      statEl.textContent = 'Checked in at B ✓ Unload, mark delivered, then upload the POD to get paid faster.';
    } else {
      stageChip.textContent = '✅ Delivered';
      actBtn.textContent = 'Delivered ✓ — close';
      statEl.textContent = 'Trip complete. Upload your POD from the trip card.';
    }
  }

  function flash(msg, bad) {
    const b2 = el('div', 'position:absolute;top:64px;left:50%;transform:translate(-50%,0);z-index:1002;background:' + (bad ? '#dc2626' : '#16a34a') + ';color:#fff;font-weight:800;font-size:.86rem;padding:11px 18px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.5);animation:lbdrop .3s ease-out;max-width:88%;text-align:center', msg);
    mapWrap.appendChild(b2);
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (_) {}
    setTimeout(() => { b2.style.transition = 'opacity .4s'; b2.style.opacity = '0'; setTimeout(() => b2.remove(), 450); }, 3200);
  }
  async function doArrive(stop) {
    if (autoBusy) return; autoBusy = true;
    try {
      try { await tripArriveGps(t.id, stop, me && me.lat, me && me.lng, sim.on ? 0 : undefined); }
      catch (e) { if (!/already recorded/i.test(e.message || '')) throw e; }
      step = stop === 'pickup' ? 'at_pickup' : 'at_delivery';
      setStep(t, step); await drawRoute(); paint();
      if (nav.line) { nav.line.remove(); nav.line = null; } nav.steps = null; navBox.style.display = 'none';
      flash(stop === 'pickup' ? '\u2713 Checked in at pickup \u2014 broker notified' : '\u2713 Checked in at delivery \u2014 almost done');
    } catch (e) { flash((e && e.message) || 'Check-in failed — try the button.', true); statEl.textContent = (e && e.message) || ''; }
    autoBusy = false;
  }
  async function doDepartPickup() {
    if (autoBusy) return; autoBusy = true;
    try {
      try { await tripDepart(t.id, 'pickup', me && me.lat, me && me.lng); } catch (e) { if (!/already|no open/i.test(e.message || '')) throw e; }
      try { await pocketAdvanceTrip(t.id, 'in_transit'); } catch (_) {}
      step = 'to_delivery'; setStep(t, step); await drawRoute(); paint();
      buildNav(true);
      flash('\ud83d\ude9b On the road \u2014 departure recorded, detention stamped');
    } catch (e) { statEl.textContent = (e && e.message) || 'Could not record departure.'; }
    autoBusy = false;
  }

  async function doDepartDelivery() {
    if (autoBusy) return; autoBusy = true;
    try {
      try { await tripDepart(t.id, 'delivery', me && me.lat, me && me.lng); } catch (e) { if (!/already|no open/i.test(e.message || '')) throw e; }
      flash('\u2713 Left the receiver \u2014 dock time recorded. Tracking ended.');
      try { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } } catch (_) {}
      try { if (sim.on) { sim.on = false; window.__lbSimOn = false; clearInterval(sim.timer); } } catch (_) {}
      statEl.textContent = 'Delivery dock time is GPS-stamped \u2014 if the receiver held you past free time, the detention claim builds itself.';
    } catch (e) { statEl.textContent = (e && e.message) || ''; }
    autoBusy = false;
  }
  function warnGate(o) {
    return new Promise(function (resolve) {
      const ov = el('div', 'position:absolute;inset:0;z-index:1003;background:rgba(2,8,20,.74);display:flex;align-items:center;justify-content:center;padding:20px', '');
      const card = el('div', 'background:#0f1a2e;border:1px solid rgba(255,255,255,.12);border-radius:18px;max-width:340px;width:100%;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.6)', '');
      card.appendChild(el('div', 'font-weight:800;font-size:1.02rem;color:#fca5a5;margin-bottom:8px', o.title));
      card.appendChild(el('div', 'font-size:.9rem;color:#cbd5e1;line-height:1.55;margin-bottom:16px', o.body));
      const yes = el('button', 'width:100%;border:0;border-radius:12px;padding:13px;font-weight:800;font-size:1rem;cursor:pointer;background:#FC5305;color:#fff;font-family:inherit', o.cta);
      const no = el('button', 'width:100%;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:11px;margin-top:9px;font-weight:700;cursor:pointer;background:transparent;color:#cbd5e1;font-family:inherit', 'Not yet \u2014 go back');
      yes.onclick = function () { ov.remove(); resolve(true); };
      no.onclick = function () { ov.remove(); resolve(false); };
      card.appendChild(yes); card.appendChild(no); ov.appendChild(card); mapWrap.appendChild(ov);
    });
  }
  actBtn.onclick = async () => {
    const was = actBtn.textContent; actBtn.disabled = true; actBtn.textContent = '…';
    try {
      if (step === 'to_pickup' && !onway) {
        if (!me && DEV_HOST) { actBtn.disabled = false; actBtn.textContent = was; toggleSim(); return; }
        onway = true; localStorage.setItem(stKey(t.id, 'onway'), '1');
        say('Navigation started.');
        try { await tripCheckin(t.id, { lat: me && me.lat, lng: me && me.lng, note: 'Driver is on the way to the pickup', source: 'onway' }); } catch (_) {}
      } else if (step === 'to_pickup') { await doArrive('pickup'); }
      else if (step === 'at_pickup') {
        if (!(await warnGate({ title: '\u26a0 Only if you\u2019re actually rolling out', body: 'Tap this only once you\u2019re LOADED and driving out of the facility. Your detention is measured until you leave \u2014 tapping while the dock still has you can cost your detention pay. It also records automatically the moment you drive 800 m out, so you can just drive.', cta: '\ud83d\ude9b Yes, I\u2019m loaded & leaving' }))) { actBtn.textContent = was; actBtn.disabled = false; return; }
        actBtn.textContent = '\u2026'; await doDepartPickup();
      }
      else if (step === 'to_delivery') { await doArrive('delivery'); }
      else if (step === 'at_delivery') {
        if (!(await warnGate({ title: '\u26a0 Has the receiver released you?', body: 'Mark delivered ONLY after the facility has finished unloading and released you. Your dock time (detention) is measured until then \u2014 marking early can lose your detention proof. Tracking keeps running until you drive out of the receiver.', cta: '\u2713 Yes, unloaded & released' }))) { actBtn.textContent = was; actBtn.disabled = false; return; }
        actBtn.textContent = '\u2026'; await pocketAdvanceTrip(t.id, 'delivered'); step = 'done'; setStep(t, step);
        flash('\ud83c\udfc1 Delivered \u2713 \u2014 tracking stays ON until you leave the receiver (800 m) so your dock time is GPS-proven for detention.');
      }
      else { close(); return; }
      paint();
    } catch (e) { actBtn.textContent = was; flash((e && e.message) || 'Could not update the trip.', true); }
    actBtn.disabled = false;
  };

  let firstFix = true;
  let __lastPost = 0;
  function handleFix(f) {
    me = { lat: f.lat, lng: f.lng };
    // Broker live tracker + blackout watchdog feed on this — throttled to every 25s.
    if (Date.now() - __lastPost > 25000) { __lastPost = Date.now(); try { pocketPostLocation(t.id, f.lat, f.lng, null).catch(() => {}); } catch (_) {} }
    lastSpeed = f.speed != null ? f.speed : null;
    if (!meMark) meMark = L.marker([me.lat, me.lng], { icon: truckIcon }).addTo(map); else meMark.setLatLng([me.lat, me.lng]);
    try { if (f.heading != null && meMark._icon) meMark._icon.firstChild.style.transform = 'rotate(' + Math.round(f.heading) + 'deg)'; } catch (_) {}
    if (firstFix) { firstFix = false; drawRoute(); buildNav(true); }
    else if (follow) {
      const spd2 = lastSpeed || 0;
      const z2 = spd2 > 22 ? 13 : spd2 > 13 ? 14 : spd2 > 6 ? 15 : 16;
      map.setView([me.lat, me.lng], spd2 > 2 ? z2 : Math.max(map.getZoom(), 14), { animate: true });
    }
    buildNav(false); updateFeeder(); navTick(); autoImmerse();
    // AUTO GEOFENCE — the map does the work:
    const tg = target();
    if (tg && me) {
      const dm = hav(me.lat, me.lng, tg.lat, tg.lng);
      if (step === 'to_pickup' && onway && dm <= RADIUS_M) doArrive('pickup');
      else if (step === 'at_pickup' && P && hav(me.lat, me.lng, P.lat, P.lng) > RADIUS_M + 150) doDepartPickup();
      else if (step === 'to_delivery' && dm <= RADIUS_M) doArrive('delivery');
      else if ((step === 'at_delivery' || step === 'done') && D && hav(me.lat, me.lng, D.lat, D.lng) > RADIUS_M + 150) doDepartDelivery();
    }
    paint();
  }
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition((pos) => {
      if (sim.on) return; // simulation drives the truck
      handleFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading });
    }, () => { if (!sim.on) statEl.textContent = (location.protocol !== 'https:' && !/^localhost$/.test(location.hostname)) ? 'Browser blocks GPS on this HTTP test address — tap 🧪 to experience the full trip in simulation.' : 'GPS is off — enable location. Auto check-in needs it.'; },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 });
  }
  map.on('dragstart', () => { follow = false; recPill.style.display = ''; });

  // Immersive driving: chrome melts away while rolling; any tap brings it back
  let chromeHidden = false, lastReveal = Date.now();
  function setChrome(show) {
    chromeHidden = !show;
    [top, fsPill, hazBtn, stack].forEach(e2 => { e2.style.transition = 'opacity .35s'; e2.style.opacity = show ? '1' : '0'; e2.style.pointerEvents = show ? '' : 'none'; });
    navBox.style.transition = 'top .35s';
    navBox.style.top = show ? '66px' : 'calc(10px + env(safe-area-inset-top, 0px))';
  }
  mapDiv.addEventListener('click', () => { lastReveal = Date.now(); if (chromeHidden) setChrome(true); });
  function autoImmerse() {
    const moving = (lastSpeed || 0) > 2 && (step === 'to_pickup' || step === 'to_delivery');
    if (moving && !chromeHidden && Date.now() - lastReveal > 12000) {
      setChrome(false);
      if (!collapsed) toggleSheet(); // full map while driving
    }
  }

  // 🧪 SIMULATION (test devices only): drives the truck along the real road route —
  // approach → auto check-in at pickup → 80s dock time (detention proof builds, free time 0)
  // → auto departure → highway → auto check-in at delivery. Everything real except the wheels.
  async function toggleSim() {
    if (sim.on) { sim.on = false; window.__lbSimOn = false; clearInterval(sim.timer); simBtn.textContent = '🧪'; flash('Simulation stopped'); return; }
    if (!P || !D) { alert('Stops are not pinned yet — wait a moment.'); return; }
    const rt = await osrmRoute(P, D, false);
    const road = rt ? rt.latlngs : [[P.lat, P.lng], [D.lat, D.lng]];
    const a0 = { lat: P.lat + 0.045, lng: P.lng - 0.055 };
    const approach = []; for (let i2 = 0; i2 <= 13; i2++) approach.push([a0.lat + (P.lat - a0.lat) * i2 / 13, a0.lng + (P.lng - a0.lng) * i2 / 13]);
    const stepN = Math.max(1, Math.floor(road.length / 220));
    sim.path = approach.concat(road.filter((_, i2) => i2 % stepN === 0), [[D.lat, D.lng]]);
    sim.i = 0; sim.on = true; window.__lbSimOn = true; sim.pauseUntil = 0; sim.pausedOnce = false; simBtn.textContent = '⏹';
    onway = true; localStorage.setItem(stKey(t.id, 'onway'), '1');
    follow = true;
    say('Navigation started.');
    flash('🧪 Test drive started — sit back and watch the whole trip');
    sim.timer = setInterval(() => {
      if (!sim.on) return;
      if (Date.now() < sim.pauseUntil) { paint(); return; }
      if (step === 'at_pickup' && !sim.pausedOnce) {
        sim.pausedOnce = true; sim.pauseUntil = Date.now() + 80000;
        flash('⏳ Dock time (80s) — watch the detention proof build');
        return;
      }
      const pt2 = sim.path[sim.i];
      if (!pt2) { sim.on = false; window.__lbSimOn = false; clearInterval(sim.timer); simBtn.textContent = '🧪'; flash('🏁 Simulation complete — mark it delivered'); return; }
      const prev = sim.path[Math.max(0, sim.i - 1)];
      const hd2 = 90 - Math.atan2(pt2[0] - prev[0], pt2[1] - prev[1]) * 180 / Math.PI;
      handleFix({ lat: pt2[0], lng: pt2[1], speed: 16, heading: hd2 });
      sim.i++;
    }, 700);
  }
  if (simBtn) simBtn.onclick = toggleSim;

  paint(); drawRoute();
}
