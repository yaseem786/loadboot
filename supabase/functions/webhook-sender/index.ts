// webhook-sender — delivers queued outbound webhooks (from the domain-event fan-out) to subscriber URLs.
// Claims via the service-role RPC cc_webhook_claim, POSTs the event payload, marks the result via
// cc_webhook_mark (failed → retry up to 5 attempts then terminal). Optionally HMAC-signs each request with an
// owner-set env secret — NO signing secret is stored in the database.
//
// STATUS: this is safe to deploy immediately (it only calls out to the subscriber URLs the owner registered).
// If no endpoints are registered/active, it's a no-op. Signing is added only when WEBHOOK_SIGNING_SECRET is set.
//
// REQUIRED OWNER ACTION to run it: deploy with verify_jwt = false (authenticates by the service-role key) and
// schedule every minute (pg_cron + pg_net). Optionally set WEBHOOK_SIGNING_SECRET to enable X-LoadBoot-Signature.

import { createClient } from "jsr:@supabase/supabase-js@2";

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SIGNING_SECRET = Deno.env.get("WEBHOOK_SIGNING_SECRET");
  if (!SUPABASE_URL || !SERVICE_KEY) return Response.json({ ok: false, reason: "missing service context" }, { status: 200 });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: claimed, error } = await sb.rpc("cc_webhook_claim", { p_limit: 50 });
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 200 });

  let sent = 0, failed = 0;
  for (const d of claimed ?? []) {
    const body = JSON.stringify(d.payload ?? {});
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-LoadBoot-Event": d.event_type, "X-LoadBoot-Delivery": d.id };
    if (SIGNING_SECRET) headers["X-LoadBoot-Signature"] = await sign(SIGNING_SECRET, body);
    try {
      const res = await fetch(d.url, { method: "POST", headers, body });
      if (res.ok) { await sb.rpc("cc_webhook_mark", { p_id: d.id, p_ok: true, p_note: `HTTP ${res.status}` }); sent++; }
      else { await sb.rpc("cc_webhook_mark", { p_id: d.id, p_ok: false, p_note: `HTTP ${res.status}` }); failed++; }
    } catch (e) {
      await sb.rpc("cc_webhook_mark", { p_id: d.id, p_ok: false, p_note: String((e as Error)?.message ?? e) });
      failed++;
    }
  }
  return Response.json({ ok: true, claimed: (claimed ?? []).length, sent, failed }, { status: 200 });
});
