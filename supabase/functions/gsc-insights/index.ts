// gsc-insights — returns Google Search Console keyword/ranking data for the
// Command Center. Security: requires a valid Supabase JWT (verify_jwt=true) AND
// re-checks that the caller is active LoadBoot staff before doing anything. The
// Google service-account key lives ONLY in the GOOGLE_SA_KEY edge secret — it is
// never returned to the client. If the secret is absent, returns {connected:false}.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lb-app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(str: string): string { return b64url(new TextEncoder().encode(str)); }

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("token_error:" + (data.error_description || data.error || "unknown"));
  return data.access_token as string;
}

async function pickSite(token: string, preferred: string | null): Promise<string> {
  if (preferred) return preferred;
  const res = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const entries: { siteUrl: string }[] = data.siteEntry || [];
  const match = (u: string) => u.includes("loadboot.com");
  const domain = entries.find((e) => e.siteUrl.startsWith("sc-domain:") && match(e.siteUrl));
  const url = entries.find((e) => match(e.siteUrl));
  return (domain || url || entries[0])?.siteUrl || "";
}

async function query(token: string, site: string, body: unknown) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error("gsc_query_" + res.status + ":" + (await res.text()).slice(0, 200));
  return await res.json();
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "no auth" }, 401);

    // Re-check the caller is active LoadBoot staff (defence in depth).
    const staffRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_active_staff`, {
      method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" }, body: "{}",
    });
    const isStaff = await staffRes.json().catch(() => false);
    if (isStaff !== true) return json({ error: "not authorized" }, 403);

    const keyRaw = Deno.env.get("GOOGLE_SA_KEY");
    if (!keyRaw) return json({ connected: false, reason: "no_key" });
    let sa: { client_email: string; private_key: string };
    try { sa = JSON.parse(keyRaw); } catch { return json({ connected: false, reason: "bad_key" }); }

    const params = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(params.days) || 28, 1), 180);
    const end = new Date(Date.now() - 2 * 864e5);          // GSC lag ~2 days
    const start = new Date(end.getTime() - days * 864e5);
    const range = { startDate: ymd(start), endDate: ymd(end) };

    const token = await getAccessToken(sa);
    const site = await pickSite(token, Deno.env.get("GSC_SITE_URL") || null);
    if (!site) return json({ connected: false, reason: "no_site" });

    const [totalsR, queriesR, pagesR] = await Promise.all([
      query(token, site, { ...range, dimensions: [] }),
      query(token, site, { ...range, dimensions: ["query"], rowLimit: 50 }),
      query(token, site, { ...range, dimensions: ["page"], rowLimit: 20 }),
    ]);

    const totRow = (totalsR.rows || [])[0] || {};
    const norm = (r: any) => ({
      key: r.keys ? r.keys[0] : null,
      clicks: r.clicks || 0, impressions: r.impressions || 0,
      ctr: r.ctr || 0, position: r.position || 0,
    });
    const queries = (queriesR.rows || []).map(norm);
    const pages = (pagesR.rows || []).map(norm);
    // "Focus" opportunities: real impressions but ranking on page 2+ (pos > 10).
    const opportunities = queries
      .filter((q) => q.impressions >= 20 && q.position > 10 && q.position <= 40)
      .sort((a, b) => b.impressions - a.impressions).slice(0, 12);

    return json({
      connected: true,
      site,
      range,
      totals: { clicks: totRow.clicks || 0, impressions: totRow.impressions || 0, ctr: totRow.ctr || 0, position: totRow.position || 0 },
      queries, pages, opportunities,
    });
  } catch (e) {
    return json({ connected: false, reason: "error", detail: String(e instanceof Error ? e.message : e).slice(0, 200) }, 200);
  }
});
