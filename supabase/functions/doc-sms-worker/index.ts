import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// doc-sms-worker v1 (bl_dial_0540, item N) — sends the queued document-decision texts. verify_jwt = false: it is pinged by
// the doc_sms_sweep cron through pg_net (same as delivery-worker) and takes NO input. Every gate (switches, consent, STOP,
// test mode, daily cap, quiet hours, ≤2 segments) already ran in Postgres (app_private.doc_sms_sweep) and the switches +
// consent + STOP run again in public.doc_sms_worker_claim, which writes the dialer_messages row before the text leaves.
// Only rows Postgres marked 'ready' can go, each exactly once (claim flips them to 'sending'; a lost run is marked failed by
// the sweep after 10 min, never re-sent). The Telnyx key lives only here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const TX = "https://api.telnyx.com/v2";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!SUPABASE_URL || !SVC) return json({ error: "not configured" }, 503);
  let claimed: { items?: Array<Record<string, string>> };
  try { claimed = await rpc("doc_sms_worker_claim", { p_limit: 10 }); }
  catch (e) { return json({ ok: false, error: String((e as Error)?.message || e) }, 500); }
  const items = claimed?.items || [];
  let sent = 0, failed = 0;
  for (const it of items) {
    let ok = false, tid: string | null = null, err: string | null = null;
    try {
      // A missing key fails the claimed row visibly in CC instead of leaving it queued forever.
      if (!TELNYX_KEY) throw new Error("The phone service is not configured (TELNYX_API_KEY).");
      const payload: Record<string, unknown> = { from: it.from, to: it.to, text: it.text };
      if (it.messaging_profile_id) payload.messaging_profile_id = it.messaging_profile_id;
      const t = await fetch(`${TX}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await t.json().catch(() => ({}));
      if (t.ok && j?.data?.id) { ok = true; tid = String(j.data.id); }
      else err = String(j?.errors?.[0]?.detail || j?.errors?.[0]?.title || ("Telnyx " + t.status)).slice(0, 280);
    } catch (e) { err = String((e as Error)?.message || e).slice(0, 280); }
    try { await rpc("doc_sms_worker_done", { p_queue: it.queue_id, p_ok: ok, p_telnyx_id: tid, p_error: err }); }
    catch (_) { /* the sweep marks it failed after 10 min — never re-sent */ }
    if (ok) sent++; else failed++;
  }
  return json({ ok: true, claimed: items.length, sent, failed });
});
