import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// places-lookup v1 (bl_ship_0503, 2026-09-29): suggest a company phone number for the INDEPENDENT call-back.
// Staff only. The caller's own JWT is forwarded to PostgREST, so cc_places_lookup_start does the staff check, the monthly
// cap (inside Google's free tier) and the audit row; this function only holds the Google key.
//   Secret: GOOGLE_PLACES_KEY (Google Cloud → APIs & Services → Credentials; restrict it to "Places API (New)").
//   Google: Text Search (New), field mask with nationalPhoneNumber → "Text Search Enterprise" SKU (1,000 free/month).
// Nothing Google returns is stored except the place ids (Maps Platform terms); staff see the rest once and pick a number.

function corsFor(req: Request) {
  const reqHdr = req.headers.get("access-control-request-headers");
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": reqHdr || "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" };
}

const FIELDS = ["places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber", "places.internationalPhoneNumber",
  "places.websiteUri", "places.businessStatus", "places.googleMapsUri", "places.types"].join(",");

async function rpc(name: string, args: unknown, auth: string, apikey: string) {
  const url = (Deno.env.get("SUPABASE_URL") || "") + "/rest/v1/rpc/" + name;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "apikey": apikey, "Authorization": auth }, body: JSON.stringify(args) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && (body.message || body.error)) || ("rpc " + name + " failed: " + res.status));
  return body;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const out = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method !== "POST") return out({ ok: false, error: "POST only" });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return out({ ok: false, error: "sign in again" });
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";  // the caller's own project key
  const key = Deno.env.get("GOOGLE_PLACES_KEY") || "";
  if (!key) return out({ ok: false, error: "not_configured", message: "Google Places is not set up: add the GOOGLE_PLACES_KEY secret to the places-lookup function." });
  const body = await req.json().catch(() => ({}));
  const org = String(body.org_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(org)) return out({ ok: false, error: "org_id required" });

  let start: any;
  try { start = await rpc("cc_places_lookup_start", { p_org: org }, auth, apikey); }
  catch (e) { return out({ ok: false, error: String((e as Error).message || e) }); }

  let places: any[] = []; let err: string | null = null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({ textQuery: start.query, pageSize: 3, regionCode: "US", languageCode: "en" }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) err = (j && j.error && j.error.message) || ("Google answered " + res.status);
    else places = Array.isArray(j.places) ? j.places : [];
  } catch (e) { err = String((e as Error).message || e); }

  try { await rpc("cc_places_lookup_done", { p_id: start.id, p_place_ids: places.map((p) => p.id).filter(Boolean), p_ok: !err, p_error: err }, auth, apikey); }
  catch (_) { /* the audit row already exists; a failed close-out must not hide the answer */ }
  if (err) return out({ ok: false, error: err, used: start.used, cap: start.cap });
  return out({ ok: true, basis: start.basis, query: start.query, used: start.used, cap: start.cap,
    results: places.map((p) => ({ name: p.displayName && p.displayName.text, address: p.formattedAddress, phone: p.nationalPhoneNumber || null,
      intl_phone: p.internationalPhoneNumber || null, website: p.websiteUri || null, status: p.businessStatus || null, maps_url: p.googleMapsUri || null,
      types: (p.types || []).slice(0, 4) })) });
});
