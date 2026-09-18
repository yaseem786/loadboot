import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

// push-send — staff-only push sender. Resolves target subscriptions server-side via the
// service-gated cc_push_targets RPC (subscription keys never reach the client) and sends
// to each device over the right transport:
//   • Web Push (VAPID)  — endpoint is an https:// push-service URL (browsers, Android TWA/PWA)
//   • APNs (HTTP/2 + p8 JWT) — endpoint is 'apns:<hex device token>' (iOS App Store shell,
//     registered by app/shared/push.js through app/shared/native.js)
// Dead endpoints (APNs 410/400 BadDeviceToken, Web Push 404/410) are pruned via
// cc_push_drop_endpoint (bl_ios_0349). Deployed to staging + production. verify_jwt=true.
//
// APNs secrets (Supabase → Edge Functions → Secrets):
//   APNS_TEAM_ID   — 10-char Apple Team ID
//   APNS_KEY_ID    — 10-char Key ID of the APNs Auth Key (.p8) from developer.apple.com → Keys
//   APNS_P8        — the .p8 file contents (PEM, "-----BEGIN PRIVATE KEY-----" … ), newlines kept or as \n
//   APNS_BUNDLE_ID — com.loadboot.app (default)
//   APNS_ENV       — production (default) | sandbox (TestFlight/dev builds use sandbox for
//                    development-signed apps; TestFlight builds themselves use production)
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
async function isStaff(auth: string, url: string, anon: string): Promise<boolean> { try { const r = await fetch(`${url}/rest/v1/rpc/get_my_staff_context`, { method: "POST", headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" }, body: "{}" }); if (!r.ok) return false; const d = await r.json(); return !!(d && d.is_staff); } catch { return false; } }

// ---------- APNs (token-based auth, ES256) ----------
const APNS_PREFIX = "apns:";
let _apnsJwt: { token: string; iat: number } | null = null;
function b64url(bytes: Uint8Array | string): string {
  const s = typeof bytes === "string" ? btoa(bytes) : btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem.replace(/\\n/g, "\n").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(b64); const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out.buffer;
}
async function apnsJwt(teamId: string, keyId: string, p8: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_apnsJwt && now - _apnsJwt.iat < 50 * 60) return _apnsJwt.token;            // APNs: reuse ≤ 60 min, refresh ≥ 20 min
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(p8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: now }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`)));
  // WebCrypto returns raw r||s (64 bytes) which is exactly the JWS ES256 format.
  const token = `${header}.${claims}.${b64url(sig)}`;
  _apnsJwt = { token, iat: now };
  return token;
}
async function sendApns(deviceToken: string, title: string, body: string, url: string): Promise<{ ok: boolean; dead: boolean; status: number; reason?: string }> {
  const teamId = Deno.env.get("APNS_TEAM_ID"), keyId = Deno.env.get("APNS_KEY_ID"), p8 = Deno.env.get("APNS_P8");
  if (!teamId || !keyId || !p8) return { ok: false, dead: false, status: 0, reason: "APNs not configured" };
  const bundle = Deno.env.get("APNS_BUNDLE_ID") || "com.loadboot.app";
  const host = (Deno.env.get("APNS_ENV") || "production") === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const jwt = await apnsJwt(teamId, keyId, p8);
  const payload = { aps: { alert: { title, body }, sound: "default", "mutable-content": 0 }, url };
  const r = await fetch(`${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": bundle, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600), "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (r.ok) return { ok: true, dead: false, status: r.status };
  let reason = ""; try { reason = ((await r.json()) as { reason?: string }).reason || ""; } catch { /* no body */ }
  const dead = r.status === 410 || (r.status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic" || reason === "Unregistered"));
  if (r.status === 403 && reason === "ExpiredProviderToken") _apnsJwt = null;
  return { ok: false, dead, status: r.status, reason };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const URL_ = Deno.env.get("SUPABASE_URL") ?? ""; const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? ""; const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const pub = Deno.env.get("VAPID_PUBLIC_KEY"); const priv = Deno.env.get("VAPID_PRIVATE_KEY"); const subj = Deno.env.get("VAPID_SUBJECT") || "mailto:support@loadboot.com";
    const auth = req.headers.get("Authorization"); if (!auth) return json({ error: "missing authorization" }, 401);
    if (!(await isStaff(auth, URL_, ANON))) return json({ error: "staff access required" }, 403);
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "LoadBoot").slice(0, 120);
    const message = String(body.body || "").slice(0, 400);
    const clickUrl = String(body.url || "/");
    const audience = body.audience ?? null; const userIds = Array.isArray(body.user_ids) ? body.user_ids : null;
    const org = body.org ?? null;
    if (!audience && !userIds && !org) return json({ error: "provide audience, user_ids or org" }, 400);
    const tr = await fetch(`${URL_}/rest/v1/rpc/cc_push_targets`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_audience: audience, p_user_ids: userIds, p_org: org }) });
    if (!tr.ok) return json({ error: "could not resolve targets" }, 502);
    const subs: { endpoint: string; p256dh: string; auth: string }[] = await tr.json();
    const webSubs = subs.filter((s) => !s.endpoint.startsWith(APNS_PREFIX));
    const apnsSubs = subs.filter((s) => s.endpoint.startsWith(APNS_PREFIX));
    if (webSubs.length && (!pub || !priv)) return json({ error: "VAPID keys not configured." }, 500);
    if (webSubs.length) webpush.setVapidDetails(subj, pub!, priv!);
    const payload = JSON.stringify({ title, body: message, url: clickUrl });
    const dead: string[] = [];
    let sent = 0, failed = 0, apnsSent = 0, apnsFailed = 0; const apnsReasons: Record<string, number> = {};
    await Promise.all([
      ...webSubs.map(async (s) => { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent++; } catch (e) { failed++; const st = (e as { statusCode?: number })?.statusCode; if (st === 404 || st === 410) dead.push(s.endpoint); } }),
      ...apnsSubs.map(async (s) => { try { const r = await sendApns(s.endpoint.slice(APNS_PREFIX.length), title, message, clickUrl); if (r.ok) apnsSent++; else { apnsFailed++; if (r.reason) apnsReasons[r.reason] = (apnsReasons[r.reason] || 0) + 1; if (r.dead) dead.push(s.endpoint); } } catch { apnsFailed++; } }),
    ]);
    // prune dead endpoints so they are not retried forever (best effort)
    await Promise.all(dead.map((ep) => fetch(`${URL_}/rest/v1/rpc/cc_push_drop_endpoint`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_endpoint: ep }) }).catch(() => null)));
    return json({ ok: true, targeted: subs.length, sent, failed, apns: { targeted: apnsSubs.length, sent: apnsSent, failed: apnsFailed, reasons: apnsReasons }, pruned: dead.length });
  } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
