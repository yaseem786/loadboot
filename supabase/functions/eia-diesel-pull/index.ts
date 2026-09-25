// eia-diesel-pull v1 (bl_mkt_0443, 25 Sep 2026) — weekly US on-highway diesel from the EIA Open Data API v2
// into app_private.fuel_prices, so the public site's diesel figure is never typed by hand again.
//   Source : https://api.eia.gov/v2/petroleum/pri/gnd/data/  product EPD2D (No 2 diesel), process PTE (retail),
//            frequency weekly, ten duoareas = the ten rows of EIA's weekly diesel table = the ten rows fuel_prices
//            already has. EIA publishes Mondays ~5 pm ET (Tuesday after a holiday); pg_cron kicks this Tue + Wed
//            14:00 UTC via app_private.diesel_pull_kick(). A repeat pull with the same period changes nothing.
//   Auth   : verify_jwt (anon bearer from the cron) + x-lb-worker must equal LB_WORKER_TOKEN, same as stripe-worker.
//   Secrets: EIA_API_KEY (owner creates it at eia.gov/opendata and sets it himself), LB_WORKER_TOKEN,
//            SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//   Write  : ONE service-role RPC, public.diesel_pull_record(...) — it upserts fuel_prices, logs the pull in
//            app_private.diesel_pull_log and fires the site rebuild only when the period actually moved.
//   Guard  : a US average outside $2.00–$8.00/gal is refused as 'implausible' and logged, nothing written.
//   Note   : the series ids below are from EIA's published weekly diesel table and could not be verified from
//            the build container (api.eia.gov is blocked there). The first real pull's raw sample is stored in
//            the log row, so a wrong id shows up in CC as 'partial' with the areas that did come back.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_ = Deno.env.get("SUPABASE_URL") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WORKER = Deno.env.get("LB_WORKER_TOKEN") || "";
const EIA_KEY = Deno.env.get("EIA_API_KEY") || "";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// EIA duoarea -> the region names app_private.fuel_prices uses (primary key).
const AREAS: Record<string, string> = {
  NUS: "US average", R10: "East Coast", R1X: "New England", R1Y: "Central Atlantic", R1Z: "Lower Atlantic",
  R20: "Midwest", R30: "Gulf Coast", R40: "Rocky Mountain", R50: "West Coast", SCA: "California",
};

async function record(outcome: string, period: string | null, rows: unknown[], error: string | null, raw: unknown) {
  if (!URL_ || !SVC) return { ok: false, error: "service_unavailable" };
  try {
    const r = await fetch(`${URL_}/rest/v1/rpc/diesel_pull_record`, {
      method: "POST",
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_outcome: outcome, p_period: period, p_rows: rows, p_error: error, p_raw: raw }),
    });
    const body = await r.json().catch(() => null);
    return r.ok ? body : { ok: false, error: `record http ${r.status}`, body };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!WORKER || req.headers.get("x-lb-worker") !== WORKER) return json({ error: "forbidden" }, 403);
  if (!EIA_KEY) {
    const rec = await record("eia_key_missing", null, [], "EIA_API_KEY secret is not set on this project", null);
    return json({ ok: false, outcome: "eia_key_missing", rec });
  }

  const u = new URL("https://api.eia.gov/v2/petroleum/pri/gnd/data/");
  u.searchParams.set("api_key", EIA_KEY);
  u.searchParams.set("frequency", "weekly");
  u.searchParams.append("data[0]", "value");
  u.searchParams.append("facets[product][]", "EPD2D");
  u.searchParams.append("facets[process][]", "PTE");
  for (const a of Object.keys(AREAS)) u.searchParams.append("facets[duoarea][]", a);
  u.searchParams.append("sort[0][column]", "period");
  u.searchParams.append("sort[0][direction]", "desc");
  u.searchParams.set("length", "60"); // 10 areas × the last few weeks; we keep the newest row per area

  let data: any[] = [];
  let rawSample: unknown = null;
  try {
    const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || !body.response || !Array.isArray(body.response.data)) {
      const err = `EIA http ${r.status}: ${body && (body.error || (body.response && body.response.error)) || "no data array"}`;
      const rec = await record("eia_error", null, [], err.slice(0, 500), body && JSON.stringify(body).slice(0, 800));
      return json({ ok: false, outcome: "eia_error", error: err, rec });
    }
    data = body.response.data;
    rawSample = data.slice(0, 3);
  } catch (e) {
    const rec = await record("eia_error", null, [], String(e).slice(0, 500), null);
    return json({ ok: false, outcome: "eia_error", error: String(e), rec });
  }

  const latest: Record<string, { period: string; value: number }> = {};
  for (const row of data) {
    const area = String(row.duoarea || "");
    if (!AREAS[area] || latest[area]) continue; // sorted newest first, keep the first per area
    const v = Number(row.value);
    const period = String(row.period || "");
    if (!isFinite(v) || !/^\d{4}-\d{2}-\d{2}$/.test(period)) continue;
    latest[area] = { period, value: v };
  }
  const us = latest["NUS"];
  if (!us) {
    const rec = await record("partial", null, [], "US average (NUS) missing from the EIA response", rawSample);
    return json({ ok: false, outcome: "partial", got: Object.keys(latest), rec });
  }
  if (us.value < 2 || us.value > 8) {
    const rec = await record("implausible", us.period, [], `US average ${us.value} $/gal is outside 2.00–8.00`, rawSample);
    return json({ ok: false, outcome: "implausible", value: us.value, rec });
  }
  const rows = Object.entries(latest).map(([area, x]) => ({ region: AREAS[area], usd_gal: x.value, as_of: x.period }));
  const missing = Object.keys(AREAS).filter((a) => !latest[a]);
  const outcome = missing.length ? "partial" : "ok";
  const rec = await record(outcome, us.period, rows, missing.length ? `missing areas: ${missing.join(",")}` : null, rawSample);
  return json({ ok: true, outcome, period: us.period, us_avg: us.value, rows: rows.length, missing, rec });
});
