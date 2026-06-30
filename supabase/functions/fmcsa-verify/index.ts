import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// fmcsa-verify — verifies a carrier against the FMCSA QCMobile API using the FMCSA_WEBKEY
// secret, then persists the result via the existing RBAC-gated cc_upsert_carrier_safety RPC
// (called with the CALLER's JWT, so permissions are enforced). No PII beyond public FMCSA data.
// Deployed to staging + production via Supabase MCP. verify_jwt = true.

const FMCSA_BASE = "https://mobile.fmcsa.dot.gov/qc/services/carriers";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ratingMap(r: unknown): string {
  switch (String(r || "").toUpperCase()) {
    case "S": return "satisfactory";
    case "C": return "conditional";
    case "U": return "unsatisfactory";
    default: return "none";
  }
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const webKey = Deno.env.get("FMCSA_WEBKEY");
    if (!webKey) return json({ error: "FMCSA_WEBKEY is not configured in this project's secrets." }, 500);
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "missing authorization" }, 401);

    const body = await req.json().catch(() => ({}));
    const carrierOrg = body.carrier_org ?? null;
    const dot = String(body.dot ?? "").replace(/\D/g, "");
    const mc = String(body.mc ?? "").replace(/\D/g, "");
    if (!dot && !mc) return json({ error: "Provide a DOT or MC number to verify." }, 400);

    const url = dot
      ? `${FMCSA_BASE}/${dot}?webKey=${webKey}`
      : `${FMCSA_BASE}/docket-number/${mc}?webKey=${webKey}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return json({ error: `FMCSA request failed (HTTP ${r.status}).` }, 502);
    const data = await r.json();

    let c: any = null;
    const content = (data && data.content) ?? null;
    if (Array.isArray(content)) c = content[0]?.carrier ?? content[0] ?? null;
    else c = content?.carrier ?? content ?? null;
    if (!c) return json({ error: "Carrier not found at FMCSA for that number." }, 404);

    const result = {
      legalName: c.legalName ?? c.dbaName ?? null,
      dbaName: c.dbaName ?? null,
      dotNumber: c.dotNumber ?? (dot ? Number(dot) : null),
      allowedToOperate: c.allowedToOperate ?? null,
      authority: c.allowedToOperate === "Y" ? "active" : "inactive",
      safetyRating: ratingMap(c.safetyRating),
      powerUnits: c.totalPowerUnits ?? null,
      drivers: c.totalDrivers ?? null,
      outOfService: !!c.oosDate,
      oosDate: c.oosDate ?? null,
    };

    let saved = false; let saveError: string | null = null;
    if (carrierOrg) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const ANON = Deno.env.get("SUPABASE_ANON_KEY");
      const sr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cc_upsert_carrier_safety`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": auth, "apikey": ANON ?? "" },
        body: JSON.stringify({
          p_carrier: carrierOrg,
          p_dot: result.dotNumber ? String(result.dotNumber) : null,
          p_mc: mc || null,
          p_authority: result.authority,
          p_rating: result.safetyRating,
          p_power_units: result.powerUnits,
          p_oos: result.outOfService,
        }),
      });
      saved = sr.ok;
      if (!sr.ok) saveError = (await sr.text()).slice(0, 300);
    }

    return json({ ok: true, carrier: result, saved, saveError });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
