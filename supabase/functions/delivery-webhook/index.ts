// delivery-webhook — receives provider (Resend) delivery events and records them on the unified ledger via
// cc_delivery_worker_mark. Maps provider event types → our normalized statuses; bounces/complaints auto-suppress
// (handled inside the RPC). Every event carries a stable dedupe_key so a re-delivered webhook is a no-op.
//
// SAFETY / STATUS: verifies the Svix signature Resend sends (RESEND_WEBHOOK_SECRET). Until that secret is set,
// the endpoint REJECTS every request (401) — it never trusts an unsigned event. It performs no outbound send.
//
// REQUIRED OWNER ACTION (assistant cannot do these — secrets + deploy):
//   1. In Resend → Webhooks, point the endpoint at this function's URL; copy its signing secret.
//   2. In Supabase → Edge Functions → Secrets, set RESEND_WEBHOOK_SECRET = <that secret>.
//   3. Set verify_jwt = false on this function (providers can't send a Supabase JWT; auth is the signature).
//
// 2026-07-31: the original version imported jsr:@standard-webhooks/standard-webhooks, which does not exist —
// that is why this function had never deployed. Signature verification is now done inline with WebCrypto
// (same Svix scheme, no dependency). Logic and RPC usage are otherwise unchanged.
//
// Uses only the service-role RPCs cc_delivery_worker_resolve / cc_delivery_worker_mark.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

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

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Svix scheme: base64(HMAC_SHA256(secret, `${id}.${timestamp}.${body}`))
async function verifySignature(req: Request, raw: string): Promise<boolean> {
  if (!SECRET) return false;
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  // Reject anything older than five minutes to blunt replay attempts.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  const secretB64 = SECRET.startsWith("whsec_") ? SECRET.slice(6) : SECRET;
  const key = await crypto.subtle.importKey(
    "raw", b64ToBytes(secretB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Header looks like: "v1,<sig> v1,<sig2>" — any one matching is enough.
  return sigHeader.split(" ").map((p) => p.split(",")[1] ?? "").some((s) => s && safeEqual(s, expected));
}

async function rpc(name: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, reason: "missing service context" }, { status: 200 });
  }
  if (!SECRET) return new Response("webhook secret not configured", { status: 401 });

  const raw = await req.text();
  if (!(await verifySignature(req, raw))) return new Response("invalid signature", { status: 401 });

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch { return new Response("bad payload", { status: 400 }); }

  const status = MAP[String(evt?.type)];
  if (!status) return Response.json({ ok: true, ignored: String(evt?.type ?? "unknown") }, { status: 200 });

  // Correlate by the ref id we set on send (idempotency_key), falling back to recipient email.
  const refId = evt?.data?.headers?.["X-Entity-Ref-ID"] ?? evt?.data?.email_id ?? null;
  const to = evt?.data?.to;
  const email = Array.isArray(to) ? to[0] : to ?? null;

  // dedupe_key makes a re-delivered webhook a no-op.
  const dedupe = `wh:${evt?.data?.email_id ?? refId ?? ""}:${status}`;

  try {
    const deliveryId = await rpc("cc_delivery_worker_resolve", { p_ref: refId, p_email: email });
    if (!deliveryId) {
      return Response.json({ ok: true, unmatched: true, ref: refId, email }, { status: 200 });
    }
    await rpc("cc_delivery_worker_mark", {
      p_id: deliveryId, p_status: status, p_reason: evt?.type, p_provider: "resend", p_dedupe: dedupe,
    });
    return Response.json({ ok: true, status, dedupe }, { status: 200 });
  } catch (e) {
    console.error("delivery-webhook", String(e));
    return new Response("downstream error", { status: 500 });
  }
});
