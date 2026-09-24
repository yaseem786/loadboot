import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

// push-worker (bl_inv_0414) — drains app_private.push_outbox and delivers each row to every device the
// user registered (app_private.push_subscriptions): Web Push (VAPID) for browsers / Android / installed
// PWAs, APNs for the iOS App Store shell (endpoint 'apns:<token>'). Works while the app is CLOSED — the
// phone's OS shows the notification; tapping it opens the exact item (row.url).
// Called instantly by pg_net (app_private.push_kick) after each enqueue and swept every minute by cron
// 'push-outbox-sweep'. verify_jwt=false: the caller must send header x-push-secret, which the database
// checks inside svc_push_claim / svc_push_done (secret lives in app_private.push_worker_config only).
// Uses the same project secrets as push-send: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
// APNS_TEAM_ID, APNS_KEY_ID, APNS_P8, APNS_BUNDLE_ID, APNS_ENV.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
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
  if (_apnsJwt && now - _apnsJwt.iat < 50 * 60) return _apnsJwt.token;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(p8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: now }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`)));
  const token = `${header}.${claims}.${b64url(sig)}`; _apnsJwt = { token, iat: now }; return token;
}
async function sendApns(tok: string, title: string, body: string, url: string, tag: string): Promise<{ ok: boolean; dead: boolean }> {
  const teamId = Deno.env.get("APNS_TEAM_ID"), keyId = Deno.env.get("APNS_KEY_ID"), p8 = Deno.env.get("APNS_P8");
  if (!teamId || !keyId || !p8) return { ok: false, dead: false };
  const host = (Deno.env.get("APNS_ENV") || "production") === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const r = await fetch(`${host}/3/device/${tok}`, {
    method: "POST",
    headers: { authorization: `bearer ${await apnsJwt(teamId, keyId, p8)}`, "apns-topic": Deno.env.get("APNS_BUNDLE_ID") || "com.loadboot.app", "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": tag.slice(0, 64), "content-type": "application/json" },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: "default", "thread-id": "investor" }, url }),
  });
  if (r.ok) return { ok: true, dead: false };
  let reason = ""; try { reason = ((await r.json()) as { reason?: string }).reason || ""; } catch { /* */ }
  if (r.status === 403 && reason === "ExpiredProviderToken") _apnsJwt = null;
  return { ok: false, dead: r.status === 410 || (r.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(reason)) };
}
type Row = { id: number; title: string; body: string | null; url: string | null; tag: string | null; subs: { endpoint: string; p256dh: string; auth: string }[] };

Deno.serve(async (req: Request) => {
  try {
    const secret = req.headers.get("x-push-secret") || "";
    if (!secret) return json({ error: "forbidden" }, 403);
    const URL_ = Deno.env.get("SUPABASE_URL") ?? ""; const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const rpc = (fn: string, body: unknown) => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const cr = await rpc("svc_push_claim", { p_secret: secret });
    if (!cr.ok) return json({ error: "claim failed", status: cr.status }, cr.status === 403 || cr.status === 401 ? 403 : 502);
    const rows: Row[] = await cr.json();
    if (!rows.length) return json({ ok: true, rows: 0 });
    const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (pub && priv) webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:support@loadboot.com", pub, priv);
    const results = await Promise.all(rows.map(async (r) => {
      const url = r.url || "/app/investor/"; const tag = r.tag || `lb-${r.id}`;
      const payload = JSON.stringify({ title: r.title, body: r.body || "", url, tag, icon: "/icon-192.png" });
      let sent = 0, failed = 0; const dead: string[] = [];
      await Promise.all((r.subs || []).map(async (s) => {
        try {
          if (s.endpoint.startsWith(APNS_PREFIX)) { const a = await sendApns(s.endpoint.slice(APNS_PREFIX.length), r.title, r.body || "", url, tag); if (a.ok) sent++; else { failed++; if (a.dead) dead.push(s.endpoint); } return; }
          if (!pub || !priv) { failed++; return; }
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high", topic: tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) });
          sent++;
        } catch (e) { failed++; const st = (e as { statusCode?: number })?.statusCode; if (st === 404 || st === 410) dead.push(s.endpoint); }
      }));
      return { id: r.id, targeted: (r.subs || []).length, sent, failed, dead };
    }));
    await rpc("svc_push_done", { p_secret: secret, p_results: results });
    return json({ ok: true, rows: rows.length, results: results.map(({ id, targeted, sent, failed }) => ({ id, targeted, sent, failed })) });
  } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
