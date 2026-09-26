import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// geo v1 (board audit #9, bl_board_0459) — routing + geocoding proxy.
// The apps used router.project-osrm.org and photon.komoot.io straight from the browser: public demo
// servers, rate-limited, no SLA, and when they fail auto-miles and the HOS/ETA checks fail silently.
// Browsers now call GET /functions/v1/geo?u=<the same public URL> (app/shared/geo-api.js). This
// function:
//   • accepts only the URL shapes the apps use (OSRM route/table, Photon search/reverse) and only
//     their known query params; anything else → 422 (the browser then falls back to the public URL)
//   • sends it to the upstream in env GEO_OSRM_URL / GEO_PHOTON_URL (default: the same public
//     servers), so switching to a paid or self-hosted provider is a secret change, not a release
//   • caches 200 answers in memory per isolate (routes 24 h, geocodes 7 d), times out after 8 s,
//     and caps each caller IP at 240 calls/min
// Auth: deployed with verify_jwt=true; the browser sends the user's token, or the anon key on pages
// without a session. No database access, no secrets besides the two optional upstream URLs.

const OSRM = (Deno.env.get("GEO_OSRM_URL") || "https://router.project-osrm.org").replace(/\/+$/, "");
const PHOTON = (Deno.env.get("GEO_PHOTON_URL") || "https://photon.komoot.io").replace(/\/+$/, "");
const UA = "LoadBoot/1.0 (+https://loadboot.com)";
const TTL_ROUTE = 24 * 3600e3, TTL_GEO = 7 * 24 * 3600e3, CACHE_MAX = 1500;
const RATE_PER_MIN = 240;

type Rule = { base: string; ttl: number; params: Record<string, RegExp> };
const NUM = /^-?\d{1,3}(\.\d{1,17})?$/;
const OSRM_PARAMS = {
  overview: /^(false|full|simplified)$/, geometries: /^(geojson|polyline|polyline6)$/, steps: /^(true|false)$/,
  alternatives: /^(true|false|[0-3])$/, sources: /^\d{1,2}(;\d{1,2}){0,24}$/, destinations: /^\d{1,2}(;\d{1,2}){0,24}$/,
  annotations: /^(distance|duration|distance,duration|duration,distance)$/,
};
const PHOTON_SEARCH = {
  q: /^[^\u0000-\u001f]{1,200}$/, limit: /^([1-9]|10)$/, lang: /^[a-z]{2}$/,
  bbox: /^-?\d{1,3}(\.\d+)?(,-?\d{1,3}(\.\d+)?){3}$/, lat: NUM, lon: NUM, osm_tag: /^[a-z_:!]{1,40}$/, layer: /^[a-z]{1,20}$/,
};
const PHOTON_REVERSE = { lat: NUM, lon: NUM, limit: /^([1-9]|10)$/, lang: /^[a-z]{2}$/ };

function match(u: URL): { rule: Rule; path: string } | null {
  if (u.protocol !== "https:") return null;
  if (u.hostname === "router.project-osrm.org") {
    const m = /^\/(route|table)\/v1\/driving\/([^/]+)$/.exec(u.pathname);
    if (!m) return null;
    const pts = decodeURIComponent(m[2]).split(";");
    if (pts.length < 2 || pts.length > 25) return null;
    for (const p of pts) {
      const [lng, lat] = p.split(",");
      if (!NUM.test(lng || "") || !NUM.test(lat || "") || Math.abs(+lng) > 180 || Math.abs(+lat) > 90) return null;
    }
    return { rule: { base: OSRM, ttl: TTL_ROUTE, params: OSRM_PARAMS }, path: `/${m[1]}/v1/driving/${pts.join(";")}` };
  }
  if (u.hostname === "photon.komoot.io") {
    if (u.pathname === "/api" || u.pathname === "/api/") return { rule: { base: PHOTON, ttl: TTL_GEO, params: PHOTON_SEARCH }, path: "/api/" };
    if (u.pathname === "/reverse" || u.pathname === "/reverse/") return { rule: { base: PHOTON, ttl: TTL_GEO, params: PHOTON_REVERSE }, path: "/reverse" };
  }
  return null;
}

const cache = new Map<string, { exp: number; body: string; type: string }>();
const hits = new Map<string, { win: number; n: number }>();

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("access-control-request-headers") || "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

Deno.serve(async (req) => {
  const ch = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  const json = (status: number, o: unknown) => new Response(JSON.stringify(o), { status, headers: { ...ch, "Content-Type": "application/json" } });
  if (req.method !== "GET") return json(405, { error: "GET only" });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const minute = Math.floor(Date.now() / 60000);
  const h = hits.get(ip);
  if (!h || h.win !== minute) hits.set(ip, { win: minute, n: 1 });
  else if (++h.n > RATE_PER_MIN) return json(429, { error: "rate limit" });
  if (hits.size > 5000) for (const [k, v] of hits) if (v.win !== minute) hits.delete(k);

  let src: URL;
  try { src = new URL(new URL(req.url).searchParams.get("u") || ""); } catch { return json(422, { error: "bad url" }); }
  const m = match(src);
  if (!m) return json(422, { error: "url not allowed" });
  const q = new URLSearchParams();
  for (const [k, v] of src.searchParams) {
    const re = m.rule.params[k];
    if (!re || !re.test(v)) return json(422, { error: "param not allowed: " + k });
    q.set(k, v);
  }
  const target = m.rule.base + m.path + (q.toString() ? "?" + q.toString() : "");

  const now = Date.now();
  const c = cache.get(target);
  if (c && c.exp > now) return new Response(c.body, { status: 200, headers: { ...ch, "Content-Type": c.type, "Cache-Control": "private, max-age=3600", "X-Geo-Cache": "hit" } });

  let r: Response;
  try {
    r = await fetch(target, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return json(504, { error: "upstream unreachable", detail: String((e as Error)?.name || e) });
  }
  const body = await r.text();
  const type = r.headers.get("content-type") || "application/json";
  // Upstream 5xx/429 → 502 so the browser falls back to the public server; OSRM's own 400
  // (NoRoute, bad coordinates) passes through unchanged, exactly as the apps saw it before.
  if (r.status >= 500 || r.status === 429) return json(502, { error: "upstream " + r.status });
  if (r.status === 200) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(target, { exp: now + m.rule.ttl, body, type });
  }
  return new Response(body, { status: r.status, headers: { ...ch, "Content-Type": type, "Cache-Control": r.status === 200 ? "private, max-age=3600" : "no-store", "X-Geo-Cache": "miss" } });
});
