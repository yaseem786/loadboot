import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// wa-auto-worker (bl_wa_0447) — drains app_private.wa_auto_outbox: the WhatsApp notices LoadBoot sends BY ITSELF
// when a dispatcher is put on (`dispatcher_assigned_v2`) or taken off (`dispatcher_changed`) a carrier's account.
// Kicked by pg_net (app_private.wa_auto_kick) right after each enqueue / failed delivery, and every 5 minutes by
// cron 'wa-auto-sweep'. verify_jwt=false: the caller must send header x-wa-auto-secret, which the database checks
// inside svc_wa_auto_claim / svc_wa_auto_done (the secret lives only in app_private.wa_auto_config).
// This function is a pipe: svc_wa_auto_claim picks the number, writes the queued wa_messages row and builds the
// Telnyx payload; every rule (demo carriers, template approved, hourly cap, fallback to the next number) is in SQL.
// Endpoint and payload are the same as telnyx-whatsapp: POST https://api.telnyx.com/v2/messages/whatsapp.
const TX = "https://api.telnyx.com/v2";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
type Row = { outbox_id: number; message_id: string; from: string; to: string; whatsapp_message: unknown };

Deno.serve(async (req: Request) => {
  try {
    const secret = req.headers.get("x-wa-auto-secret") || "";
    if (!secret) return json({ error: "forbidden" }, 403);
    const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
    if (!TELNYX_KEY) return json({ error: "TELNYX_API_KEY is not set" }, 503);
    const URL_ = Deno.env.get("SUPABASE_URL") ?? ""; const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const rpc = (fn: string, body: unknown) => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const cr = await rpc("svc_wa_auto_claim", { p_secret: secret });
    if (!cr.ok) return json({ error: "claim failed", status: cr.status }, cr.status === 403 || cr.status === 401 ? 403 : 502);
    const rows: Row[] = await cr.json();
    if (!rows.length) return json({ ok: true, rows: 0 });

    const results = [];
    for (const r of rows) {   // one at a time: a handful per event, and Telnyx rate limits per number
      try {
        const t = await fetch(`${TX}/messages/whatsapp`, {
          method: "POST", headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ from: r.from, to: r.to, whatsapp_message: r.whatsapp_message }),
        });
        const j = await t.json().catch(() => ({}));
        const id = j?.data?.id || j?.data?.message_id || j?.id;
        if (t.ok && id) results.push({ outbox_id: r.outbox_id, message_id: r.message_id, ok: true, telnyx_id: String(id) });
        else results.push({ outbox_id: r.outbox_id, message_id: r.message_id, ok: false, error: String(j?.errors?.[0]?.detail || j?.errors?.[0]?.title || ("Telnyx " + t.status)).slice(0, 280) });
      } catch (e) {
        results.push({ outbox_id: r.outbox_id, message_id: r.message_id, ok: false, error: String((e as Error)?.message ?? e).slice(0, 280) });
      }
    }
    await rpc("svc_wa_auto_done", { p_secret: secret, p_results: results });
    return json({ ok: true, rows: rows.length, sent: results.filter((x) => x.ok).length });
  } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
