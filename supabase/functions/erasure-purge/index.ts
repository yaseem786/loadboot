// erasure-purge v1 — removes the Storage objects a staff member decided to REMOVE for one account-deletion request
// (bl_audit_0365). The DB decides everything: the caller's JWT must pass cc_erasure_items (staff), the list comes from
// erasure_removal_candidates (service), and each outcome is written back with erasure_removal_mark. No path is ever taken
// from the caller. dry_run defaults to true; at most 25 objects per call. STAGING ONLY until Yaseen approves retention.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const BUCKET_OK = /^[a-z0-9-]{1,64}$/;
const PATH_OK = /^[A-Za-z0-9._\/-]{1,512}$/;

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
    const requestId = Number.isInteger(b.request_id) && b.request_id > 0 ? b.request_id : null;
    if (!requestId) return json({ error: "bad_request" }, 400);
    const dryRun = b.dry_run !== false;
    const max = Math.min(25, Math.max(1, Number.isInteger(b.max) ? b.max : 25));

    // 1) staff check happens in the DB with the CALLER's identity
    const q = await fetch(`${URL_}/rest/v1/rpc/cc_erasure_items`, { method: "POST", headers: { apikey: ANON, Authorization: caller, "Content-Type": "application/json" }, body: JSON.stringify({ p_request_id: requestId }) });
    if (!q.ok) return json({ error: q.status >= 500 ? "service_unavailable" : "not_authorized" }, q.status >= 500 ? 503 : 403);
    const staffView = await q.json().catch(() => null);
    if (!staffView || typeof staffView !== "object" || !Array.isArray(staffView.items)) return json({ error: "service_unavailable" }, 503);

    // 2) candidates from the DB, service identity
    const c = await fetch(`${URL_}/rest/v1/rpc/erasure_removal_candidates`, { method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_request_id: requestId }) });
    const list = await c.json().catch(() => null);
    if (!c.ok || !list || typeof list !== "object" || !Array.isArray(list.candidates)) return json({ error: "service_unavailable" }, 503);
    const cands = list.candidates
      .map((x: any) => ({ item_key: String(x && x.item_key || ""), bucket: String(x && x.bucket || ""), path: String(x && x.path || "") }))
      .filter((x: any) => /^[0-9a-f]{32}$/.test(x.item_key) && BUCKET_OK.test(x.bucket) && PATH_OK.test(x.path) && !x.path.includes(".."))
      .slice(0, max);

    const results: { item_key: string; path: string; result: string }[] = [];
    for (const cand of cands) {
      let result = "would_remove";
      if (!dryRun) {
        try {
          const d = await fetch(`${URL_}/storage/v1/object/${cand.bucket}/${cand.path}`, { method: "DELETE", headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
          result = d.ok ? "removed" : "storage_failed";
        } catch (_) { result = "storage_failed"; }
      }
      try {
        await fetch(`${URL_}/rest/v1/rpc/erasure_removal_mark`, { method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_request_id: requestId, p_item_key: cand.item_key, p_result: result }) });
      } catch (_) { /* the result is still reported */ }
      results.push({ item_key: cand.item_key, path: cand.path, result });
    }
    return json({ ok: true, request_id: requestId, dry_run: dryRun, eligible: list.candidates.length, processed: results.length, results });
  } catch (_) {
    return json({ error: "server_error" }, 500);
  }
});
