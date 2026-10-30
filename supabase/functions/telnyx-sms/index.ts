import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-sms v2 (bl_dial_0352 + bl_sms_0533) — sends ONE text message on a LoadBoot line. verify_jwt = true.
// Body: { to | thread_id, body, reply_to? }. v2: the conversation has an OWNER (dialer_sms_prepare decides who may send, which
// line it leaves on and which Telnyx messaging profile — carrier or broker — carries it), the text comes back BRANDED
// ("LoadBoot: " … " Reply STOP to opt out." / the first-message disclosure) and that FINAL text is what goes to Telnyx. Every check (SMS switched on, line assigned, US/CA only, toll-fraud list, STOP opt-outs, length,
// hourly cap) runs in Postgres AS THE CALLER (public.dialer_sms_prepare), which also writes the queued row — so a text
// exists in LoadBoot's record before it leaves. The Telnyx API key lives only here; the browser never sees it.
// Result is written back with the service role (dialer_sms_mark). Delivery receipts arrive later via telnyx-hook.
// bl_disp_0572: a database guard refusal (42501 — conduct guard, training guard, shipper rate rule) now reaches the
// sender in plain words instead of "Could not send that text."; a conduct-guard block is reported for staff review.

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
    const auth = req.headers.get("Authorization") || "";
    const prep = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dialer_sms_prepare`, {
      method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ p: { to: String(body?.to || ""), thread_id: body?.thread_id ? String(body.thread_id) : null, reply_to: body?.reply_to ? String(body.reply_to) : null, body: String(body?.body || "") } }),
    });
    const pj = await prep.json().catch(() => null);
    if (!prep.ok) {
      const code = String(pj?.code || ""), msg = String(pj?.message || "");
      if (msg.startsWith("BLOCKED —")) {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/contact_guard_report`, {
          method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ p_channel: "sms", p_body: String(body?.body || ""), p_target: String(body?.to || body?.thread_id || "") }),
        }).catch(() => null);
        return json({ ok: false, error: msg, conduct_blocked: true }, 200);
      }
      return json({ ok: false, error: (code === "42501" && msg) ? msg : "Could not send that text." }, 200);
    }
    const p = pj;
    if (!p?.ok) return json({ ok: false, error: p?.error || "Could not send that text.", needs_consent: !!p?.needs_consent, broker_blocked: !!p?.broker_blocked }, 200);

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
    return json({ ok: true, thread_id: p.thread_id, message: m });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
