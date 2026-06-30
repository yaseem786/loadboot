// ga4-insights — real Google Analytics 4 data via the Analytics Data API. Staff-gated.
// Reuses the GOOGLE_SA_KEY service account; needs GA4_PROPERTY_ID (numeric). Returns
// {connected:false} when not configured — never fabricates. Realtime + period totals with
// previous-period comparison, source/medium, campaigns, pages, devices, countries, events.
// Deployed to staging + production via Supabase MCP. verify_jwt = true.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
function b64url(buf: ArrayBuffer | Uint8Array): string { const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlStr(str: string): string { return b64url(new TextEncoder().encode(str)); }
function pemToDer(pem: string): Uint8Array { const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, ""); const bin = atob(body); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function getToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const data = await res.json(); if (!data.access_token) throw new Error("token_error:" + (data.error_description || data.error || "unknown")); return data.access_token as string;
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
async function runReport(token: string, prop: string, body: unknown) { const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) throw new Error("ga4_" + res.status + ":" + (await res.text()).slice(0, 160)); return await res.json(); }
async function runRealtime(token: string, prop: string, body: unknown) { const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runRealtimeReport`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return { rows: [] }; return await res.json(); }
const dim1 = (r: any) => (r.dimensionValues?.[0]?.value ?? null);
const met = (r: any, i = 0) => Number(r.metricValues?.[i]?.value ?? 0);
function rows(rep: any) { return rep?.rows || []; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!; const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") || ""; if (!auth) return json({ error: "no auth" }, 401);
    const staffRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_active_staff`, { method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
    if ((await staffRes.json().catch(() => false)) !== true) return json({ error: "not authorized" }, 403);
    const keyRaw = Deno.env.get("GOOGLE_SA_KEY"); if (!keyRaw) return json({ connected: false, reason: "no_key" });
    const prop = Deno.env.get("GA4_PROPERTY_ID"); if (!prop) return json({ connected: false, reason: "no_property_id" });
    let sa: { client_email: string; private_key: string }; try { sa = JSON.parse(keyRaw); } catch { return json({ connected: false, reason: "bad_key" }); }

    const params = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(params.days) || 28, 1), 365);
    const today = new Date(); const curEnd = new Date(today.getTime() - 864e5); const curStart = new Date(curEnd.getTime() - (days - 1) * 864e5);
    const prevEnd = new Date(curStart.getTime() - 864e5); const prevStart = new Date(prevEnd.getTime() - (days - 1) * 864e5);
    const cur = { startDate: ymd(curStart), endDate: ymd(curEnd) }; const prev = { startDate: ymd(prevStart), endDate: ymd(prevEnd) };
    const token = await getToken(sa);
    const METRICS = [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }, { name: "engagementRate" }, { name: "conversions" }];
    const [realtime, totals, daily, srcMed, campaigns, pages, landing, devices, countries, events] = await Promise.all([
      runRealtime(token, prop, { metrics: [{ name: "activeUsers" }] }),
      runReport(token, prop, { dateRanges: [cur, prev], metrics: METRICS }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], orderBys: [{ dimension: { dimensionName: "date" } }] }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }, { name: "conversions" }], limit: 15, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "sessionCampaignName" }], metrics: [{ name: "sessions" }, { name: "conversions" }], limit: 15, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }], limit: 15, orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }] }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }], limit: 15, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "sessions" }] }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "country" }], metrics: [{ name: "sessions" }], limit: 10, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
      runReport(token, prop, { dateRanges: [cur], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 15, orderBys: [{ metric: { metricName: "eventCount" }, desc: true }] }),
    ]);
    const tRows = rows(totals); const c0 = tRows[0] || {}; const p0 = tRows[1] || {};
    const sm = (row: any, i: number) => Number(row.metricValues?.[i]?.value ?? 0);
    const totalsCur = { sessions: sm(c0, 0), users: sm(c0, 1), views: sm(c0, 2), engagementRate: sm(c0, 3), conversions: sm(c0, 4) };
    const totalsPrev = { sessions: sm(p0, 0), users: sm(p0, 1), views: sm(p0, 2), engagementRate: sm(p0, 3), conversions: sm(p0, 4) };
    const pct = (a: number, b: number) => b > 0 ? Math.round(((a - b) / b) * 100) : null;
    return json({ connected: true, source: "Google Analytics 4", property: prop, range: cur, previous: prev, fetched_at: new Date().toISOString(), realtime_active_users: met(rows(realtime)[0] || {}, 0), totals: totalsCur, previous_totals: totalsPrev, change_pct: { sessions: pct(totalsCur.sessions, totalsPrev.sessions), users: pct(totalsCur.users, totalsPrev.users), views: pct(totalsCur.views, totalsPrev.views), conversions: pct(totalsCur.conversions, totalsPrev.conversions) }, daily: rows(daily).map((r: any) => ({ date: dim1(r), sessions: met(r, 0) })), source_medium: rows(srcMed).map((r: any) => ({ key: dim1(r), sessions: met(r, 0), conversions: met(r, 1) })), campaigns: rows(campaigns).map((r: any) => ({ key: dim1(r), sessions: met(r, 0), conversions: met(r, 1) })), pages: rows(pages).map((r: any) => ({ key: dim1(r), views: met(r, 0) })), landing_pages: rows(landing).map((r: any) => ({ key: dim1(r), sessions: met(r, 0) })), devices: rows(devices).map((r: any) => ({ key: dim1(r), sessions: met(r, 0) })), countries: rows(countries).map((r: any) => ({ key: dim1(r), sessions: met(r, 0) })), events: rows(events).map((r: any) => ({ key: dim1(r), count: met(r, 0) })) });
  } catch (e) { return json({ connected: false, reason: "error", detail: String(e instanceof Error ? e.message : e).slice(0, 220) }, 200); }
});
