import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

// push-send — staff-only Web Push sender (VAPID). Resolves target subscriptions server-side
// via the service-gated cc_push_targets RPC (subscription keys never reach the client) and
// sends an encrypted notification to each device. Deployed to staging + production. verify_jwt=true.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
async function isStaff(auth: string, url: string, anon: string): Promise<boolean> { try { const r = await fetch(`${url}/rest/v1/rpc/get_my_staff_context`, { method: "POST", headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" }, body: "{}" }); if (!r.ok) return false; const d = await r.json(); return !!(d && d.is_staff); } catch { return false; } }
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const URL_ = Deno.env.get("SUPABASE_URL") ?? ""; const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? ""; const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const pub = Deno.env.get("VAPID_PUBLIC_KEY"); const priv = Deno.env.get("VAPID_PRIVATE_KEY"); const subj = Deno.env.get("VAPID_SUBJECT") || "mailto:support@loadboot.com";
    if (!pub || !priv) return json({ error: "VAPID keys not configured." }, 500);
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
    webpush.setVapidDetails(subj, pub, priv);
    const payload = JSON.stringify({ title, body: message, url: clickUrl });
    let sent = 0, failed = 0;
    await Promise.all(subs.map(async (s) => { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent++; } catch { failed++; } }));
    return json({ ok: true, targeted: subs.length, sent, failed });
  } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
