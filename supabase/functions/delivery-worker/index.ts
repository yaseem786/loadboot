// delivery-worker — drains the UNIFIED delivery ledger (app_private.message_deliveries) and transmits via a
// real provider (Resend for email). This is the single send path for campaigns AND transactional messages.
//
// SAFETY / STATUS: this is the ONLY function that performs a real external send. It is intentionally a safe
// no-op until the owner sets provider credentials. Without RESEND_API_KEY it returns "provider not configured"
// and sends NOTHING — no message ever leaves silently or without an explicit, owner-set secret.
//
// REQUIRED OWNER ACTION to enable real delivery (assistant cannot do these — they need secrets + a deploy):
//   1. In Supabase → Project → Edge Functions → Secrets, set:
//        RESEND_API_KEY = <your Resend API key>
//        RESEND_FROM    = "LoadBoot <ops@yourdomain.com>"   (a verified sender)
//   2. Deploy this function (verify_jwt = false — it authenticates by the service-role key, not a user JWT).
//   3. Schedule it every minute via pg_cron + pg_net to keep the queue draining.
//
// It uses ONLY service-role RPCs, which are granted to service_role and revoked from anon/authenticated:
//   - public.cc_delivery_release_due(channel)              -- promote due scheduled → queued
//   - public.cc_delivery_worker_claim(limit, channel)      -- atomic claim (FOR UPDATE SKIP LOCKED)
//   - public.cc_delivery_worker_mark(id, status, reason, provider, dedupe) -- settle (retry/dead-letter/suppress)
// The app_private schema is never exposed to the API; the worker only ever sees these three functions.

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "LoadBoot <onboarding@resend.dev>";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, reason: "missing Supabase service context" }, { status: 200 });
  }
  if (!RESEND_API_KEY) {
    // Expected state until the owner sets the secret. Nothing is sent.
    return Response.json({ ok: true, sent: 0, reason: "RESEND_API_KEY not set — email delivery disabled (safe no-op)" }, { status: 200 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. release any due scheduled rows into the queue, then 2. claim a batch atomically.
  await sb.rpc("cc_delivery_release_due", { p_channel: "email" });
  const { data: claimed, error } = await sb.rpc("cc_delivery_worker_claim", { p_limit: 50, p_channel: "email" });
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 200 });

  // Base URL of the deployed `unsubscribe` edge function (RFC 8058 one-click). Defaults to this project.
  const UNSUB_BASE = Deno.env.get("UNSUBSCRIBE_URL") || `${SUPABASE_URL}/functions/v1/unsubscribe`;
  const SITE = Deno.env.get("SITE_URL") || "https://loadboot.com";
  const LOGO = Deno.env.get("BRAND_LOGO_URL") || `${SITE}/icon-512.png`; // authentic brand icon (see BRAND-ASSET-AUDIT.md)
  // Professional, reusable branded email shell — authentic hosted logo + compliant footer. Table-based for
  // broad client support; light/dark safe neutral palette. No placeholder or fabricated assets.
  const shell = (bodyHtml: string, unsubUrl: string) =>
    `<div style="background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#0b1220;padding:18px 24px" align="left">
          <img src="${LOGO}" width="28" height="28" alt="LoadBoot" style="vertical-align:middle;border-radius:6px">
          <span style="color:#fff;font-size:18px;font-weight:800;vertical-align:middle;margin-left:8px">LoadBoot</span>
        </td></tr>
        <tr><td style="padding:24px;color:#0f172a;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6">
          <b style="color:#0f172a">LoadBoot</b> &middot; Truck dispatch &amp; logistics technology<br>
          <a href="${SITE}/contact.html" style="color:#2563eb">Support</a> &middot;
          <a href="${SITE}/privacy.html" style="color:#2563eb">Privacy</a> &middot;
          <a href="${SITE}/terms.html" style="color:#2563eb">Terms</a> &middot;
          <a href="${unsubUrl}" style="color:#2563eb">Unsubscribe</a><br>
          <span style="color:#94a3b8">You're receiving this because you or your company works with LoadBoot.</span>
        </td></tr>
      </table></td></tr></table></div>`;
  let sent = 0, failed = 0;
  for (const d of claimed ?? []) {
    const subject = (d.meta && d.meta.subject) ? String(d.meta.subject) : "LoadBoot";
    const unsubUrl = `${UNSUB_BASE}?token=${d.correlation_id}`;
    const html = (d.meta && d.meta.body_html) ? shell(String(d.meta.body_html), unsubUrl) : null;
    const text = ((d.meta && d.meta.body_text) ? String(d.meta.body_text) : subject) + `\n\n— LoadBoot · Support: ${SITE}/contact.html · Unsubscribe: ${unsubUrl}`;
    try {
      const payload: Record<string, unknown> = { from: RESEND_FROM, to: d.recipient_email, subject, text,
        headers: { "X-Entity-Ref-ID": d.idempotency_key, "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
      if (html) payload.html = html;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        // idempotency: Resend de-dupes on X-Entity-Ref-ID, and our idempotency_key already prevented double-queueing.
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "sent", p_reason: null, p_provider: "resend", p_dedupe: `send:${d.id}` }); sent++; }
      else { await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "failed", p_reason: `HTTP ${res.status}: ${JSON.stringify(out).slice(0, 200)}`, p_provider: "resend", p_dedupe: null }); failed++; }
    } catch (e) {
      await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "failed", p_reason: String((e as Error)?.message ?? e), p_provider: "resend", p_dedupe: null });
      failed++;
    }
  }
  return Response.json({ ok: true, claimed: (claimed ?? []).length, sent, failed }, { status: 200 });
});
