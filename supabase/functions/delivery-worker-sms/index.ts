// delivery-worker-sms — drains the SMS lane of the UNIFIED delivery ledger and transmits via Twilio.
// Same ledger, same service-role RPCs as the email worker (cc_delivery_release_due / cc_delivery_worker_claim /
// cc_delivery_worker_mark) — only the transport differs. Bounces/opt-outs auto-suppress inside the RPC.
//
// SAFETY / STATUS: safe no-op until the owner sets Twilio credentials. Without TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN / TWILIO_FROM it returns "SMS delivery disabled" and sends NOTHING — no message ever
// leaves silently or without explicit, owner-set secrets. SMS also incurs per-message cost, so this stays off
// until the owner deliberately enables it.
//
// REQUIRED OWNER ACTION (assistant cannot: needs secrets + a deploy):
//   1. In Supabase → Edge Functions → Secrets, set:
//        TWILIO_ACCOUNT_SID = <sid>
//        TWILIO_AUTH_TOKEN  = <token>
//        TWILIO_FROM        = <your Twilio number, e.g. +15551234567>
//   2. Deploy with verify_jwt = false (authenticates by service-role key), schedule every minute (pg_cron+pg_net).

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const FROM = Deno.env.get("TWILIO_FROM");

  if (!SUPABASE_URL || !SERVICE_KEY) return Response.json({ ok: false, reason: "missing Supabase service context" }, { status: 200 });
  if (!SID || !TOKEN || !FROM) {
    return Response.json({ ok: true, sent: 0, reason: "Twilio secrets not set — SMS delivery disabled (safe no-op)" }, { status: 200 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  await sb.rpc("cc_delivery_release_due", { p_channel: "sms" });
  const { data: claimed, error } = await sb.rpc("cc_delivery_worker_claim", { p_limit: 50, p_channel: "sms" });
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 200 });

  const auth = "Basic " + btoa(`${SID}:${TOKEN}`);
  let sent = 0, failed = 0;
  for (const d of claimed ?? []) {
    const bodyText = (d.meta && (d.meta.body_text || d.meta.subject)) ? String(d.meta.body_text || d.meta.subject) : "LoadBoot";
    if (!d.recipient_phone) { await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "failed", p_reason: "no recipient phone", p_provider: "twilio", p_dedupe: null }); failed++; continue; }
    try {
      const form = new URLSearchParams({ To: d.recipient_phone, From: FROM, Body: bodyText });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: "POST", headers: { "Authorization": auth, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "sent", p_reason: null, p_provider: "twilio", p_dedupe: `sms:${d.id}` }); sent++; }
      else { await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "failed", p_reason: `HTTP ${res.status}: ${JSON.stringify(out).slice(0, 160)}`, p_provider: "twilio", p_dedupe: null }); failed++; }
    } catch (e) {
      await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "failed", p_reason: String((e as Error)?.message ?? e), p_provider: "twilio", p_dedupe: null });
      failed++;
    }
  }
  return Response.json({ ok: true, claimed: (claimed ?? []).length, sent, failed }, { status: 200 });
});
