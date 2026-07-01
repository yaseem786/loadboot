// delivery-webhook — receives provider (Resend) delivery events and records them on the unified ledger via
// cc_delivery_worker_mark. Maps provider event types → our normalized statuses; bounces/complaints auto-suppress
// (handled inside the RPC). Every event carries a stable dedupe_key so a re-delivered webhook is a no-op.
//
// SAFETY / STATUS: verifies the Svix signature Resend sends (RESEND_WEBHOOK_SECRET). Until that secret is set,
// the endpoint REJECTS every request (401) — it never trusts an unsigned event. It performs no outbound send.
//
// REQUIRED OWNER ACTION (assistant cannot do these — secrets + deploy):
//   1. In Resend → Webhooks, create an endpoint pointing at this function's URL; copy its signing secret.
//   2. In Supabase → Edge Functions → Secrets, set RESEND_WEBHOOK_SECRET = <that secret>.
//   3. Deploy this function with verify_jwt = false (providers can't send a Supabase JWT; auth is the signature).
//
// Uses only the service-role RPC cc_delivery_worker_mark (granted to service_role, revoked from anon/auth).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { Webhook } from "jsr:@standard-webhooks/standard-webhooks@1";

// Resend event type → our ledger status.
const MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "failed",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!SUPABASE_URL || !SERVICE_KEY) return Response.json({ ok: false, reason: "missing service context" }, { status: 200 });
  if (!SECRET) return new Response("webhook secret not configured", { status: 401 });

  const raw = await req.text();
  // Verify signature — reject anything not signed by the provider.
  try {
    const headers = { "webhook-id": req.headers.get("svix-id") ?? "", "webhook-timestamp": req.headers.get("svix-timestamp") ?? "", "webhook-signature": req.headers.get("svix-signature") ?? "" };
    new Webhook(SECRET).verify(raw, headers);
  } catch {
    return new Response("invalid signature", { status: 401 });
  }

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch { return new Response("bad payload", { status: 400 }); }
  const status = MAP[String(evt?.type)];
  if (!status) return Response.json({ ok: true, ignored: String(evt?.type ?? "unknown") }, { status: 200 });

  // Correlate by the ref id we set on send (idempotency_key), falling back to recipient email.
  const refId = evt?.data?.headers?.["X-Entity-Ref-ID"] ?? evt?.data?.email_id ?? null;
  const email = evt?.data?.to?.[0] ?? evt?.data?.to ?? null;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Resolve the delivery id via a service-role lookup RPC (owner adds if desired); if we already have the id
  // on the event, mark directly. dedupe_key makes re-delivered webhooks idempotent.
  const dedupe = `wh:${evt?.data?.email_id ?? refId ?? ""}:${status}`;
  const { data: found } = await sb.rpc("cc_delivery_worker_resolve", { p_ref: refId, p_email: email }).catch(() => ({ data: null }));
  const deliveryId = found ?? null;
  if (!deliveryId) return Response.json({ ok: true, unmatched: true, ref: refId, email }, { status: 200 });

  await sb.rpc("cc_delivery_worker_mark", { p_id: deliveryId, p_status: status, p_reason: evt?.type, p_provider: "resend", p_dedupe: dedupe });
  return Response.json({ ok: true, status, dedupe }, { status: 200 });
});
