// eld-test — live check of a Samsara API token or Motive API key BEFORE the carrier saves it.
//
// Why: on 29 Aug 2026 a carrier pasted a 128-char hex string as a "Samsara token"; the card said
// "connected" and the poller got 401 every 5 minutes. This function makes the provider itself answer.
//
// Contract in : POST { provider: 'samsara'|'motive', api_token }   (caller JWT required — verify_jwt)
// Contract out: { ok:true,  provider, region, org, vehicles, drivers, hos_drivers, warnings[] }
//               { ok:false, provider, error, hint, http }
//
// Provider facts used here (checked against live endpoints 29 Aug 2026 — 401 with a bogus key,
// i.e. the route exists; 404 for the guesses that don't):
//   Samsara  base https://api.samsara.com (EU orgs: https://api.eu.samsara.com), header
//            "Authorization: Bearer <token>", tokens are issued as samsara_api_… (per Samsara's own
//            docs examples). GET /me → organization; GET /fleet/vehicles; GET /fleet/hos/clocks.
//   Motive   base https://api.gomotive.com, header "X-Api-Key: <key>". GET /v1/companies;
//            GET /v1/vehicles; GET /v1/available_time (the HOS clocks the poller reads).
//            /v1/hos_availability and /v1/hos_available_time do NOT exist (404).
// The function never stores anything; the client saves through carrier_eld_setup only on ok:true.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TIMEOUT_MS = 12000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type" } });
}

async function get(url: string, headers: Record<string, string>) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    let body: unknown = null; try { body = await r.json(); } catch { /* not json */ }
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: { error: (e as Error).message || "network error" } };
  } finally { clearTimeout(t); }
}

const count = (v: unknown, ...keys: string[]) => {
  if (Array.isArray(v)) return v.length;
  const o = v as Record<string, unknown> | null;
  for (const k of keys) { const a = o?.[k]; if (Array.isArray(a)) return a.length; }
  return null;
};

async function testSamsara(token: string) {
  const warnings: string[] = [];
  if (!/^samsara_api_/.test(token)) warnings.push("Samsara issues tokens that start with samsara_api_ — this one does not. It was accepted by Samsara anyway, so it may be an older-format token.");
  for (const base of ["https://api.samsara.com", "https://api.eu.samsara.com"]) {
    const h = { Authorization: "Bearer " + token };
    const me = await get(base + "/me", h);
    if (me.status === 401) continue;                                  // try the other region
    if (me.status === 0) return { ok: false, error: "Could not reach Samsara (" + ((me.body as any)?.error || "timeout") + ")", hint: "Try again in a minute.", http: 0 };
    if (me.status !== 200) return { ok: false, error: "Samsara answered HTTP " + me.status + ((me.body as any)?.message ? ": " + (me.body as any).message : ""), hint: me.status === 403 ? "The token exists but lacks the needed scopes. Recreate it with Read scopes for Vehicles, Drivers and Hours of Service." : "Check the token and try again.", http: me.status };
    const org = String((me.body as any)?.data?.name ?? (me.body as any)?.name ?? "") || null;
    const veh = await get(base + "/fleet/vehicles?limit=100", h);
    const hos = await get(base + "/fleet/hos/clocks?limit=100", h);
    if (veh.status === 403) warnings.push("Token cannot read Vehicles (403) — add the Read Vehicles scope or GPS will not sync.");
    if (hos.status === 403) warnings.push("Token cannot read Hours of Service (403) — add the Read HOS scope or drive-time will not sync.");
    return { ok: true, region: base.includes(".eu.") ? "EU" : "US", org, vehicles: veh.status === 200 ? count(veh.body, "data") : null, drivers: null, hos_drivers: hos.status === 200 ? count(hos.body, "data") : null, warnings };
  }
  return { ok: false, error: "Samsara rejected the token (401 invalid token) on both the US and EU regions.", hint: "Paste the whole token exactly as Samsara showed it (it starts with samsara_api_). If you cannot see it any more, create a new one: Settings → API Tokens → + Add an API Token.", http: 401 };
}

async function testMotive(key: string) {
  const h = { "X-Api-Key": key };
  const co = await get("https://api.gomotive.com/v1/companies", h);
  if (co.status === 0) return { ok: false, error: "Could not reach Motive (" + ((co.body as any)?.error || "timeout") + ")", hint: "Try again in a minute.", http: 0 };
  if (co.status === 401) return { ok: false, error: "Motive rejected the key (401 invalid API key).", hint: "Copy the key again from Fleet Dashboard → Admin → Developers. A Fleet Admin has to create it; a driver login cannot.", http: 401 };
  if (co.status !== 200) return { ok: false, error: "Motive answered HTTP " + co.status + ((co.body as any)?.error_message ? ": " + (co.body as any).error_message : ""), hint: "Check the key and try again.", http: co.status };
  const companies = (co.body as any)?.companies ?? (co.body as any)?.data ?? [];
  const first = Array.isArray(companies) ? (companies[0]?.company ?? companies[0]) : null;
  const org = first ? String(first.name ?? first.company_name ?? "") || null : null;
  const veh = await get("https://api.gomotive.com/v1/vehicles?per_page=100", h);
  const usr = await get("https://api.gomotive.com/v1/users?per_page=100&role=driver", h);
  const hos = await get("https://api.gomotive.com/v1/available_time?per_page=100", h);
  const warnings: string[] = [];
  if (veh.status !== 200) warnings.push("Vehicles list returned HTTP " + veh.status + " — GPS may not sync.");
  if (hos.status !== 200) warnings.push("Available-time (HOS) returned HTTP " + hos.status + " — drive-time may not sync.");
  return { ok: true, region: "US", org, vehicles: veh.status === 200 ? count(veh.body, "vehicles", "data") : null, drivers: usr.status === 200 ? count(usr.body, "users", "data") : null, hos_drivers: hos.status === 200 ? count(hos.body, "users", "drivers", "available_time", "data") : null, warnings };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(204, null);
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return json(401, { ok: false, error: "sign in first" });
  let provider = "", token = "";
  try { const b = await req.json(); provider = String(b?.provider ?? "").toLowerCase(); token = String(b?.api_token ?? "").trim(); } catch { /* empty */ }
  if (!token) return json(400, { ok: false, error: "api_token required" });
  if (token.length < 16 || token.length > 512 || /\s/.test(token)) return json(200, { ok: false, provider, error: "That does not look like an API token (spaces, or too short/long).", hint: "Paste only the token string — nothing else.", http: 0 });
  if (provider === "samsara") return json(200, { provider, ...(await testSamsara(token)) });
  if (provider === "motive") return json(200, { provider, ...(await testMotive(token)) });
  return json(400, { ok: false, error: "provider must be samsara or motive" });
});
