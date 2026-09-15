import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// driver-join (bl_drv_0344f, 14 Sep 2026) — email-proven driver signup.
// The invite EMAIL carries ?t=<token>&c=<email_code>; copy-link / WhatsApp links carry only ?t=.
// A driver who arrives with a valid code AND signs up with the invite's own email has already proven
// they own that inbox, so we create the auth user pre-confirmed (no "check your email" detour).
// Anything else (no code, wrong code, different email) is refused here and the page falls back to
// normal Supabase signUp with email confirmation. Existing accounts are never touched: we answer
// {exists:true} and the page says "sign in instead".
// verify_jwt=false: the caller has no session yet. Authorization = token + 24-hex code, both single-use
// per invite, checked server-side via cc_driver_invite_verify (service_role only; not in the anon surface).

function corsFor(req: Request) {
  const reqHdr = req.headers.get("access-control-request-headers");
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": reqHdr || "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" };
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const out = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method !== "POST") return out({ ok: false, error: "method" }, 405);
  try {
    const URL_ = Deno.env.get("SUPABASE_URL") ?? ""; const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!URL_ || !SRK) return out({ ok: false, error: "server_config" }, 500);
    const b = await req.json().catch(() => ({}));
    const token = String(b.token ?? "").trim(), code = String(b.code ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase(), password = String(b.password ?? "");
    const name = String(b.name ?? "").trim().slice(0, 120), platform = String(b.platform ?? "").slice(0, 20);
    if (!/^[0-9a-f]{20,64}$/.test(token) || !/^[0-9a-f]{16,64}$/.test(code)) return out({ ok: false, error: "code_invalid" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) return out({ ok: false, error: "bad_input" }, 400);

    const H = { "Content-Type": "application/json", "apikey": SRK, "Authorization": `Bearer ${SRK}` };
    // 1) the code must belong to a pending, unexpired invite
    const vr = await fetch(`${URL_}/rest/v1/rpc/cc_driver_invite_verify`, { method: "POST", headers: H, body: JSON.stringify({ p_token: token, p_code: code }) });
    const v = await vr.json().catch(() => null);
    if (!vr.ok || !v || v.ok !== true) return out({ ok: false, error: "code_invalid", reason: v?.reason ?? null }, 400);
    // 2) proof only covers the invite's own address
    if (String(v.email ?? "").toLowerCase() !== email) return out({ ok: false, error: "email_mismatch" }, 400);

    // 3) create the user already confirmed. Same metadata shape as signUpDriver() so handle_new_user
    //    (no org for drivers) and send_welcome_email (no carrier welcome for drivers) behave identically.
    const cr = await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: { role: "driver", invite_token: token, name: name || v.name || "", join_via: "email_link", platform },
    }) });
    const c = await cr.json().catch(() => ({}));
    if (cr.ok && c && c.id) return out({ ok: true, user: c.id });
    const msg = String(c?.msg ?? c?.message ?? c?.error_description ?? c?.error ?? "");
    if (cr.status === 422 || /already (been )?registered|already exists|email_exists/i.test(msg) || c?.error_code === "email_exists") return out({ ok: false, error: "exists" }, 409);
    return out({ ok: false, error: "create_failed", detail: msg.slice(0, 200) }, 500);
  } catch (e) { return out({ ok: false, error: String((e as Error)?.message ?? e) }, 500); }
});
