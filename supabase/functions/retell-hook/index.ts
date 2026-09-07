import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// retell-hook v1 (audit F14, 2026-09-06) — the signed front door for Retell's call webhook.
//
// WHY THIS FUNCTION EXISTS. Retell currently posts straight at PostgREST:
//   POST /rest/v1/rpc/retell_webhook  with the PUBLIC anon key
// public.retell_webhook(jsonb) is a single-unnamed-parameter SECURITY DEFINER function, so PostgREST exposes it
// as a raw-body RPC, and EXECUTE is granted to anon/authenticated/PUBLIC on both envs. Anyone with the anon key
// — which every browser that loads the site already has — can therefore inject synthetic call events, and on a
// crafted call_ended/call_analyzed payload create a CRM contact, lead, activity, an automation task and staff
// notifications. Confirmed on staging by a rollback-only probe (Codex) and by a live HTTP probe (Claude,
// req 193585 → HTTP 200).
//
// WHY THE CHECK CANNOT LIVE IN POSTGRES. Retell signs the RAW request body:
//   X-Retell-Signature: v=<unix_ms>,d=<hex>   with   d = HMAC-SHA256(raw_body || timestamp, api_key)
// and its docs are explicit that a re-serialised body will not verify. PostgREST hands the RPC ALREADY-PARSED
// jsonb, so the exact bytes are gone by then. This function is the only place the raw body still exists.
//
// THE API KEY NEVER REACHES THIS FUNCTION. It sends the raw body and the header to public.retell_hook_verify()
// (service_role only), which does the HMAC inside the database and returns a verdict. The same RPC reports
// whether enforcement is on, so there is exactly ONE switch for the whole mechanism:
//   app_private.retell_config.allow_unsigned_webhook
//     true  (default, today) → OBSERVE: forward every delivery, but report whether it verified
//     false                  → ENFORCE: an unverified delivery is refused 401 and nothing is written
//
// OBSERVE MODE IS NOT DECORATION. The signature format above is taken from Retell's documentation, not from a
// delivery anyone here has actually seen. Observe mode is how that gets confirmed against real traffic before
// anything depends on it. Read the verdicts back with:
//   select * from app_private.retell_hook_log order by at desc limit 20;
//
// CUTOVER ORDER (only Yaseen can do step 2):
//   1. deploy this function (verify_jwt=false — Retell cannot send a Supabase JWT)
//   2. point the Retell dashboard webhook at .../functions/v1/retell-hook and watch the log verify
//   3. update app_private.retell_config set allow_unsigned_webhook = false
// Doing 3 before 2 silently stops inbound voice reaching CC and CRM. Prod has 112 lc_calls rows and 8
// voice-call leads — this chain is live and earning.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function rpc(fn: string, body: unknown): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SVC, "Authorization": `Bearer ${SVC}` },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}

Deno.serve(async (req: Request) => {
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!SUPABASE_URL || !SVC) return json({ ok: false, error: "function not configured" }, 500);

  // the raw body, read once and never re-serialised — this is the whole point of the function
  const raw = await req.text();
  const sig = req.headers.get("x-retell-signature") || "";

  const v = await rpc("retell_hook_verify", { p_raw: raw, p_sig: sig });
  const verdict = v.body ?? {};
  const verified = verdict.verified === true;
  const enforce = verdict.enforce === true;
  const reason = String(verdict.reason ?? "verifier_unavailable");

  if (enforce && !verified) {
    // nothing is forwarded, so nothing is written
    await rpc("retell_hook_log_write", { p_verified: false, p_reason: reason, p_forwarded: false, p_event: null });
    return json({ ok: false, error: "unauthorized", code: "LB401", reason }, 401);
  }

  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const event = (payload as any)?.event ?? null;

  const fwd = await rpc("retell_webhook", payload);
  await rpc("retell_hook_log_write", { p_verified: verified, p_reason: reason, p_forwarded: true, p_event: event });

  // In observe mode the response still says what the verdict WAS, so a real delivery can be checked
  // without waiting for the log.
  return json({ ok: true, verified, enforce, reason, forwarded: true, upstream: fwd.body }, fwd.status === 200 ? 200 : 502);
});
