import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// retell-inbound-hook v2 (audit F14, 2026-09-07) — accepts EITHER a valid signature OR a URL token.
//
// WHY v2. Retell's docs are explicit that the CALL webhook is signed; they do NOT say the same about the
// phone-number INBOUND webhook, and no real inbound delivery has been observed. Since this endpoint fails
// closed by design, an unsigned inbound webhook would mean a generic greeting on every call. The URL token
// removes that dependency entirely: the secret travels in the URL, which Retell always sends, whatever it does
// about signatures.
//
// This is not a workaround — it is the mechanism the production webhook ALREADY uses, done properly. The URL
// in the Retell dashboard today is  .../rpc/retell_inbound?apikey=<PUBLIC anon key>  : a secret in the URL,
// where the "secret" is the public key every browser on loadboot.com already holds. Replacing it with a real
// unguessable token is the whole fix.
//
// ORDER OF CHECKS: signature first (it is the stronger proof and covers the body, not just the caller); token
// second. Either one alone is enough. Neither → 401, exactly as v1. The token never reaches this runtime — the
// candidate goes to public.retell_inbound_token_ok and a boolean comes back.
//
// retell-inbound-hook v1 (audit F14, second instance, 2026-09-06) — the signed front door for Retell's
// INBOUND-CALL webhook (the one that supplies dynamic_variables before the agent speaks).
//
// WHY. public.retell_inbound(jsonb) on PROD is SECURITY DEFINER with EXECUTE granted to anon and authenticated.
// It takes a single unnamed parameter, so PostgREST exposes it as a raw-body RPC. Its entire purpose is to turn
// a phone number into who that person is, which means anyone holding the PUBLIC anon key can POST a number and
// read back a registered user's name, company, role, MC, DOT, equipment, truck count, lanes, home base and
// account status — or a broker's company and MC — or the first 400 characters of what someone typed into a form
// on the website. The only gate is to_number == retell_config.from_number, and that number is published on the
// site. It is a caller-identity oracle that answers for any number the caller cares to try.
//
// WHAT THIS FUNCTION DOES. It reads the RAW body (Retell signs raw bytes — a re-serialised body never verifies),
// verifies X-Retell-Signature through public.retell_hook_verify (which does the HMAC inside the database, so the
// Retell API key never reaches this runtime), and only then calls public.retell_inbound_verified — the
// service-role-only twin of the prod function, byte-for-byte identical apart from one caller check.
//
// FAIL CLOSED, DELIBERATELY. Unlike the outbound retell-hook, this endpoint hands out personal data, so there is
// no observe mode here and no "forward anyway" path. Anything short of a proven-good signature gets nothing:
//   • signature missing / unparsable / wrong / stale        -> 401, RPC never called
//   • body is not JSON                                       -> 400, RPC never called
//   • verifier errors, times out, or returns an incomplete
//     verdict (no boolean `verified`)                        -> 503, RPC never called
// A 503 means "we could not prove this was Retell", which is not the same as "this was not Retell", and the
// difference matters when someone reads the log later.
//
// NEVER LOGGED: the request body, the phone numbers, and the response context. app_private.retell_hook_log
// records the verdict and the event name only. A log that quietly copies the thing being protected is not a log.
//
// CUTOVER — nothing here is on prod, and the order is load-bearing:
//   1. deploy this to prod (verify_jwt=false: Retell cannot send a Supabase JWT)
//   2. YASEEN repoints the Retell phone-number INBOUND webhook at .../functions/v1/retell-inbound-hook and a
//      real signed delivery is observed verifying
//   3. only then may revoking anon/authenticated on public.retell_inbound be PROPOSED
// Step 3 before step 2 removes the personalised greeting from every inbound call.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EMPTY = { call_inbound: {} };

async function rpc(fn: string, body: unknown, ms = 8000): Promise<{ ok: boolean; status: number; body: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SVC, "Authorization": `Bearer ${SVC}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const t = await r.text();
    try { return { ok: r.ok, status: r.status, body: JSON.parse(t) }; }
    catch { return { ok: false, status: r.status, body: null }; }      // malformed response = not ok
  } catch {
    return { ok: false, status: 0, body: null };                        // timeout / network = not ok
  } finally { clearTimeout(timer); }
}

Deno.serve(async (req: Request) => {
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  const log = (verified: boolean | null, reason: string, forwarded: boolean, event: string | null) =>
    rpc("retell_hook_log_write", { p_verified: verified, p_reason: `inbound:${reason}`, p_forwarded: forwarded, p_event: event })
      .catch(() => undefined);

  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ ...EMPTY, error: "method not allowed" }, 405);
  if (!SUPABASE_URL || !SVC) { await log(null, "function_not_configured", false, null); return json({ ...EMPTY, error: "not configured" }, 503); }

  const raw = await req.text();
  const sig = req.headers.get("x-retell-signature") || "";
  const token = (() => { try { return new URL(req.url).searchParams.get("t") || ""; } catch { return ""; } })();

  const v = await rpc("retell_hook_verify", { p_raw: raw, p_sig: sig });
  // fail closed: transport failure, non-2xx, unparsable body, or a verdict without a boolean `verified`
  if (!v.ok || v.body === null || typeof v.body?.verified !== "boolean") {
    const why = !v.ok ? (v.status === 0 ? "verifier_unreachable" : `verifier_http_${v.status}`) : "verifier_verdict_incomplete";
    await log(null, why, false, null);
    return json({ ...EMPTY, error: "verification unavailable", code: "LB503", reason: why }, 503);
  }

  let how = v.body.verified === true ? "signature_ok" : "";
  if (!how) {
    // No usable signature. Fall back to the URL token — but ONLY if one was actually presented, so a request
    // with neither still reads as "unverified" in the log rather than "token_mismatch".
    if (token) {
      const t = await rpc("retell_inbound_token_ok", { p_token: token });
      if (!t.ok || t.body === null || typeof t.body?.token_ok !== "boolean") {
        await log(null, "token_check_unavailable", false, null);
        return json({ ...EMPTY, error: "verification unavailable", code: "LB503", reason: "token_check_unavailable" }, 503);
      }
      if (t.body.token_ok === true) how = "url_token_ok";
    }
  }
  if (!how) {
    const why = token ? "token_mismatch" : String(v.body.reason ?? "unverified");
    await log(false, why, false, null);
    return json({ ...EMPTY, error: "unauthorized", code: "LB401", reason: why }, 401);
  }

  let payload: any = null;
  try { payload = JSON.parse(raw); } catch {
    await log(true, "body_not_json", false, null);
    return json({ ...EMPTY, error: "bad json", code: "LB400" }, 400);
  }

  const out = await rpc("retell_inbound_verified", payload);
  if (!out.ok || out.body === null) {
    await log(true, out.status === 0 ? "rpc_unreachable" : `rpc_http_${out.status}`, false, payload?.event ?? null);
    return json({ ...EMPTY, error: "upstream unavailable", code: "LB503" }, 503);
  }

  await log(true, how, true, payload?.event ?? null);   // "signature_ok" or "url_token_ok"
  // Retell's envelope, passed through untouched. Nothing about the caller is logged or added here.
  return json(out.body, 200);
});
