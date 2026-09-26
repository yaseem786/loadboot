// geo-api.js — board audit #9: routing (OSRM) and geocoding (Photon) go through our own `geo` edge
// function instead of the public demo servers straight from the browser.
//
// geoFetch(url, init) is a drop-in for fetch(url, init) on a public OSRM/Photon URL and returns a
// Response. The function maps the URL onto the upstream set in its env (GEO_OSRM_URL,
// GEO_PHOTON_URL), so moving to a paid provider is a secret change, not an app release.
// If the function is unreachable, not deployed yet, refuses the call (401/403/404/429, or 422 = a URL
// shape it does not allow) or fails (5xx),
// the browser calls the public URL directly, exactly as before this file existed, and skips the
// function for 60 s so a broken deploy costs one extra round trip, not one per keystroke.
import { getClient } from './supabaseClient.js';

const HOSTS = ['https://router.project-osrm.org/', 'https://photon.komoot.io/'];
let _skipUntil = 0;

async function authHeaders(sb) {
  let tok = '';
  try { const { data } = await sb.auth.getSession(); tok = (data && data.session && data.session.access_token) || ''; } catch (_) {}
  return { apikey: sb.supabaseKey, Authorization: 'Bearer ' + (tok || sb.supabaseKey) };
}

export async function geoFetch(url, init) {
  const signal = init && init.signal;
  if (Date.now() >= _skipUntil && HOSTS.some((h) => String(url).indexOf(h) === 0)) {
    try {
      const sb = await getClient();
      const r = await fetch(sb.supabaseUrl + '/functions/v1/geo?u=' + encodeURIComponent(url), { headers: await authHeaders(sb), signal });
      if (r.ok || (r.status >= 400 && r.status < 500 && ![401, 403, 404, 422, 429].includes(r.status))) return r;
      if (r.status !== 422) _skipUntil = Date.now() + 60000; // 422 is about this URL, not the function
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      _skipUntil = Date.now() + 60000;
    }
  }
  return fetch(url, init);
}
