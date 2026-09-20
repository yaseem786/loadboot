import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-sms v1 (bl_dial_0352) — sends ONE text message from the signed-in dispatcher's own LoadBoot number. verify_jwt = true.
// Body: { to, body }. Every check (SMS switched on, line assigned, US/CA only, toll-fraud list, STOP opt-outs, length,
// hourly cap) runs in Postgres AS THE CALLER (public.dialer_sms_prepare), which also writes the queued row — so a text
// exists in LoadBoot's record before it leaves. The Telnyx API key lives only here; the browser never sees it.
// Result is written back with the service role (dialer_sms_mark). Delivery receipts arrive later via telnyx-hook.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const TX = "https://api.telnyx.com/v2";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function mark(id: string, status: string, telnyxId: string | null, error: string | null) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dialer_sms_mark`, {
    method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id, p_status: status, p_telnyx_id: telnyxId, p_error: error }),
  });
  return r.ok ? await r.json() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { const asked = req.headers.get("access-control-request-headers"); return new Response("ok", { headers: asked ? { ...cors, "Access-Control-Allow-Headers": asked } : cors }); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!TELNYX_KEY) return json({ error: "The phone service is not configured yet (TELNYX_API_KEY)." }, 503);
  try {
    const body = await req.json().catch(() => ({}));
    const prep = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dialer_sms_prepare`, {
      method: "POST", headers: { apikey: ANON, Authorization: req.headers.get("Authorization") || "", "Content-Type": "application/json" },
      body: JSON.stringify({ p: { to: String(body?.to || ""), body: String(body?.body || "") } }),
    });
    const p = prep.ok ? await prep.json() : null;
    if (!p?.ok) return json({ ok: false, error: p?.error || "Could not send that text." }, 200);

    const payload: Record<string, unknown> = { from: p.from, to: p.to, text: p.body };
    if (p.messaging_profile_id) payload.messaging_profile_id = p.messaging_profile_id;
    const t = await fetch(`${TX}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await t.json().catch(() => ({}));
    if (!t.ok || !j?.data?.id) {
      const why = String(j?.errors?.[0]?.detail || j?.errors?.[0]?.title || ("Telnyx " + t.status)).slice(0, 280);
      const m = await mark(p.id, "failed", null, why);
      return json({ ok: false, error: why, message: m }, 200);
    }
    const m = await mark(p.id, "sent", String(j.data.id), null);
    return json({ ok: true, message: m });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
