// unsubscribe — the API behind the email preference centre (bl_comm_0446).
//
// v1 (2026-07-31): one token, one action — suppress the address from marketing, show a plain page.
// v2 (2026-09-25): rendered the whole preference centre as HTML. It never displayed: Supabase serves
//   every HTML response from *.supabase.co/functions as `text/plain` with `CSP: sandbox`, so people saw
//   raw markup (v1's page had the same problem on prod).
// v3 (2026-09-26): this function is now an API only. The page lives on loadboot.com/unsub.html.
//   GET  ?token=<correlation_id> | ?e=<email>&t=<md5>
//        → 302 to <UNSUB_PAGE_URL or SITE/unsub.html> with the same params + &ref=<project ref>.
//          Nothing is changed on GET: link scanners (Outlook Safe Links, Gmail prefetch) follow GETs,
//          so the unsubscribe happens when the page's script calls {action:'open'}.
//   POST form  List-Unsubscribe=One-Click   RFC 8058 — honoured immediately, 200.
//   POST json  {action:'open'}                        honour the link's category + return the page data
//              {action:'state'}                       page data only
//              {action:'unsubscribe'|'resubscribe', scope, groups, reason_code, reason_text}
//              {action:'reason', reason_code, reason_text}   attach a reason to what just happened
//              {action:'frequency', groups:[code], days: 7|30|null}  "fewer emails" (null = every email)
//   CORS open (*): the token is the credential, no cookies are involved.
//
// verify_jwt is OFF on purpose: recipients carry no Supabase session. Only service-role RPCs are used
// (unsub_link_get / unsub_link_apply / unsub_link_reason) — nothing here is anon-executable.

const SITE = Deno.env.get("SITE_URL") || "https://loadboot.com";
const PAGE = Deno.env.get("UNSUB_PAGE_URL") || `${SITE}/unsub.html`;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });

  const q = new URL(req.url).searchParams;
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const token = isUuid(q.get("token") ?? "") ? (q.get("token") as string).toLowerCase() : null;
  const email = (q.get("e") ?? "").trim().toLowerCase() || null;
  const sig = (q.get("t") ?? "").trim() || null;
  const ref = (SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || "";

  // ---------------------------------------------------------------- GET: hand over to the page
  if (req.method === "GET") {
    const u = new URL(PAGE);
    if (token) u.searchParams.set("token", token);
    else if (email && sig) { u.searchParams.set("e", email); u.searchParams.set("t", sig); }
    if (ref) u.searchParams.set("ref", ref);
    return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store" } });
  }

  if (!token && !(email && sig)) return json({ ok: false, error: "invalid link" }, 400);

  const meta = {
    ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
    user_agent: req.headers.get("user-agent") ?? null,
  };
  const rpc = async (name: string, body: Record<string, unknown>) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`rpc ${name} HTTP ${res.status}: ${JSON.stringify(out).slice(0, 200)}`);
    return out;
  };
  const linkArgs = { p_token: token, p_email: email, p_sig: sig };
  const apply = (action: string, scope: string, groups: string[] | null, source: string, rc: string | null = null, rt: string | null = null) =>
    rpc("unsub_link_apply", { ...linkArgs, p_action: action, p_scope: scope, p_groups: groups, p_reason_code: rc, p_reason_text: rt, p_source: source, p_meta: meta });

  try {
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("application/json")) {
      // RFC 8058 one-click (form body "List-Unsubscribe=One-Click"): honour it now; mail clients only read the status.
      await apply("unsubscribe", "group", null, "one_click").catch(() => null);
      return json({ ok: true });
    }
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const rc = b.reason_code ? String(b.reason_code).slice(0, 60) : null;
    const rt = b.reason_text ? String(b.reason_text).slice(0, 500) : null;

    if (action === "open") {
      const done = await apply("unsubscribe", "group", null, "preference_page");
      if (!done || done.ok !== true) return json({ ok: false, error: (done && done.error) || "invalid link" });
      const info = await rpc("unsub_link_get", linkArgs);
      return json({ ...info, done: { groups: done.groups ?? [], event_id: done.event_id } });
    }
    if (action === "state") return json(await rpc("unsub_link_get", linkArgs));
    if (action === "reason") return json(await rpc("unsub_link_reason", { ...linkArgs, p_reason_code: rc, p_reason_text: rt }));
    if (action === "frequency") {
      const days = [7, 30].includes(Number(b.days)) ? Number(b.days) : null;
      const groups = Array.isArray(b.groups) ? (b.groups as unknown[]).map(String).slice(0, 1) : null;
      return json(await rpc("unsub_link_apply", { ...linkArgs, p_action: "frequency", p_scope: "group", p_groups: groups, p_reason_code: null, p_reason_text: null, p_source: "preference_page", p_meta: { ...meta, max_per_days: days } }));
    }
    if (action === "unsubscribe" || action === "resubscribe") {
      const scope = ["group", "marketing", "all"].includes(String(b.scope)) ? String(b.scope) : "group";
      const groups = Array.isArray(b.groups) ? (b.groups as unknown[]).map(String).slice(0, 12) : null;
      return json(await apply(action, scope, groups, "preference_page", rc, rt));
    }
    return json({ ok: false, error: "invalid action" }, 400);
  } catch (e) {
    console.error("unsubscribe:", (e as Error)?.message ?? e);
    return json({ ok: false, error: "temporary error — please try again in a minute" });
  }
});
