import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-token v2 (bl_dial_0351 + 0351c) — mints a short-lived Telnyx WebRTC login token for the signed-in dispatcher.
// The Telnyx API key lives ONLY here (env TELNYX_API_KEY). The browser never sees it; it gets a JWT that can
// register one SIP credential — the one bound to this dispatcher's line. verify_jwt = true.
// Body { claim: true } (0351c): the dispatcher's phone has just registered — if a caller is still ringing for them
// (portal was closed, they came from the push), hand that call to their browser now. No token is minted on a claim.
// Flow: user JWT → auth user id → dialer_token_context (service role; checks dialer on, dispatcher active, line
// assigned) → create the on-demand telephony credential once (saved on the line) → POST …/token → return it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const TX = "https://api.telnyx.com/v2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" }, body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return await r.json();
}
const tx = (path: string, body?: unknown) => fetch(TX + path, {
  method: "POST", headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
  body: body ? JSON.stringify(body) : undefined,
});

async function createCredential(ctx: { connection_id: string; name: string; line_id: string }) {
  const r = await tx("/telephony_credentials", { connection_id: ctx.connection_id, name: ctx.name });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.id) throw new Error("telnyx credential " + r.status);
  await rpc("dialer_line_set_credential", { p_line: ctx.line_id, p_credential_id: j.data.id, p_sip_username: j.data.sip_username });
  return j.data.id as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { const asked = req.headers.get("access-control-request-headers"); return new Response("ok", { headers: asked ? { ...cors, "Access-Control-Allow-Headers": asked } : cors }); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!TELNYX_KEY) return json({ error: "The phone service is not configured yet (TELNYX_API_KEY)." }, 503);
  try {
    const auth = req.headers.get("Authorization") || "";
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SVC, Authorization: auth } });
    if (!u.ok) return json({ error: "not signed in" }, 401);
    const user = await u.json();
    if (!user?.id) return json({ error: "not signed in" }, 401);

    const body = await req.json().catch(() => ({}));
    if (body?.claim === true) {
      const c = await rpc("dialer_claim_waiting", { p_user: user.id });
      const a = c?.action;
      if (!a?.call_control_id) return json({ ok: true, claimed: false });
      const t = await tx(`/calls/${encodeURIComponent(a.call_control_id)}/actions/transfer`, { to: a.to, from: a.from, timeout_secs: a.timeout_secs ?? 20, client_state: a.client_state, target_leg_client_state: a.target_leg_client_state });
      return json({ ok: true, claimed: t.ok, status: t.status });
    }

    const ctx = await rpc("dialer_token_context", { p_user: user.id });
    if (!ctx?.ok) return json({ error: ctx?.error || "not allowed" }, 403);

    let cred: string = ctx.credential_id || await createCredential(ctx);
    let t = await tx(`/telephony_credentials/${cred}/token`);
    if (t.status === 404 || t.status === 422) {          // credential was deleted / expired on Telnyx → make a fresh one, once
      cred = await createCredential(ctx);
      t = await tx(`/telephony_credentials/${cred}/token`);
    }
    if (!t.ok) return json({ error: "token " + t.status }, 502);
    const token = (await t.text()).trim().replace(/^"|"$/g, "");
    return json({ ok: true, token });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
