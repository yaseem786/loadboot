// lc-doc-purge v1 — removes ownerless live-chat onboarding uploads (Phase 2b of the orphan reconciliation design).
// The DATABASE decides who is staff and what is eligible: the caller's own JWT is forwarded to cc_lc_doc_remove_candidates
// (staff guard + 7-day floor live in SQL). This function NEVER takes a path from the caller; it only deletes names the DB just listed.
// dry_run defaults to true. At most 25 objects per call. Every outcome is logged through the service-only lc_doc_recon_log_add.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const NAME_OK = /^lc-onboarding\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,160}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const URL_ = Deno.env.get("SUPABASE_URL") || "";
    const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const caller = req.headers.get("authorization");
    if (!URL_ || !SVC || !ANON) return json({ error: "service_unavailable" }, 503);
    if (!caller || !/^Bearer \S+$/i.test(caller)) return json({ error: "not_authorized" }, 401);

    const b = await req.json().catch(() => ({}));
    if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "bad_request" }, 400);
    const dryRun = b.dry_run !== false; // only the literal false turns deletion on
    const max = Math.min(25, Math.max(1, Number.isInteger(b.max) ? b.max : 25));

    const q = await fetch(`${URL_}/rest/v1/rpc/cc_lc_doc_remove_candidates`, { method: "POST", headers: { apikey: ANON, Authorization: caller, "Content-Type": "application/json" }, body: "{}" });
    const list = await q.json().catch(() => null);
    if (!q.ok) return json({ error: q.status >= 500 ? "service_unavailable" : "not_authorized" }, q.status >= 500 ? 503 : 403);
    if (!list || typeof list !== "object" || !Array.isArray(list.candidates) || typeof list.actor !== "string") return json({ error: "service_unavailable" }, 503);

    const actor = list.actor;
    const names: string[] = list.candidates.map((c: any) => String(c && c.name || "")).filter((n: string) => NAME_OK.test(n) && !n.includes("..")).slice(0, max);
    const results: { name: string; result: string }[] = [];
    for (const name of names) {
      let result = "would_remove";
      if (!dryRun) {
        try {
          const d = await fetch(`${URL_}/storage/v1/object/documents/${name}`, { method: "DELETE", headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
          result = d.ok ? "removed" : "storage_failed";
        } catch (_) { result = "storage_failed"; }
      }
      try {
        await fetch(`${URL_}/rest/v1/rpc/lc_doc_recon_log_add`, { method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_actor: actor, p_action: "remove", p_path: name, p_dry_run: dryRun, p_result: result }) });
      } catch (_) { /* the delete result is still reported to the caller */ }
      results.push({ name, result });
    }
    return json({ ok: true, dry_run: dryRun, eligible: list.candidates.length, processed: results.length, min_age: list.min_age, results });
  } catch (_) {
    return json({ error: "server_error" }, 500);
  }
});
