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
//        RESEND_FROM    = "LoadBoot <hello@loadboot.com>"   (a verified sender on your verified domain)
//
// OFFICIAL SENDER IDENTITY (Increment 61): once RESEND_FROM is on the loadboot.com domain (meaning the owner
// has verified the domain with the provider), the worker automatically signs each message with the identity
// that matches its category — no per-message configuration needed:
//        marketing / campaigns          → "LoadBoot"          <hello@loadboot.com>
//        dispatch / loads / trips / PODs→ "LoadBoot Dispatch"  <dispatch@loadboot.com>
//        billing / invoices / payments  → "LoadBoot Billing"   <billing@loadboot.com>
// Reply-To always matches the category identity, so replies land in the right mailbox. Until the domain is
// verified (RESEND_FROM not on loadboot.com), EVERY message honestly falls back to RESEND_FROM — the worker
// never claims an unverified identity. Each identity is individually overridable via secrets:
//        SENDER_MARKETING, SENDER_DISPATCH, SENDER_BILLING   (format: "Name <addr@domain>")
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
  const LOGO = Deno.env.get("BRAND_LOGO_URL") || `${SITE}/email-logo-white-2x.png`; // official brand-kit email lockup
  // Professional, reusable branded email shell — authentic hosted logo + compliant footer. Table-based for
  // broad client support; light/dark safe neutral palette. No placeholder or fabricated assets.
  // Premium shell v2 (owner request): big-company header/footer — logo + tagline header,
  // "related content" rail with REAL destinations only, dark two-row footer with product/legal links.
  const shell = (bodyHtml: string, unsubUrl: string, subject = "") =>
    `<div style="background:#eef2f7;padding:28px 0;font-family:Arial,Helvetica,sans-serif">
      <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${subject}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="height:4px;background:#F97316;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="background:#0b1220;padding:24px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td align="left"><img src="${LOGO}" width="167" height="40" alt="LoadBoot" style="display:block;border:0"></td>
            <td align="right" style="vertical-align:middle"><a href="${SITE}/app/" style="color:#60A5FA;font-size:12.5px;font-weight:700;text-decoration:none">Open portal &rarr;</a></td>
          </tr></table>
          <div style="color:#64748b;font-size:12px;margin-top:10px;letter-spacing:.02em">The Operating System for Trucking</div>
        </td></tr>
        <tr><td style="padding:30px 30px 24px;color:#0f172a;font-size:15px;line-height:1.65">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 30px;background:#f8fafc;border-top:1px solid #e2e8f0">
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#94a3b8;margin-bottom:9px">MORE ON LOADBOOT</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:12.5px;line-height:2">
              <a href="${SITE}/app/carrier/#loads" style="color:#2563eb;text-decoration:none">&rsaquo; Available loads on the board</a><br>
              <a href="${SITE}/app/carrier/#documents" style="color:#2563eb;text-decoration:none">&rsaquo; Your documents &amp; compliance status</a>
            </td>
            <td style="font-size:12.5px;line-height:2">
              <a href="${SITE}/detention-pay-policy.html" style="color:#2563eb;text-decoration:none">&rsaquo; Accessorial pay policies</a><br>
              <a href="${SITE}/resources.html" style="color:#2563eb;text-decoration:none">&rsaquo; Carrier guides &amp; resources</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 30px;background:#0b1220;color:#94a3b8;font-size:12px;line-height:1.9">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><b style="color:#ffffff;font-size:13px">LoadBoot</b><br><span style="color:#64748b">Truck dispatch &amp; logistics technology &middot; United States</span></td>
            <td align="right" style="vertical-align:top"><a href="${SITE}/apps.html" style="color:#60A5FA;font-size:12px;font-weight:700;text-decoration:none">Get the app</a></td>
          </tr></table>
          <div style="border-top:1px solid rgba(255,255,255,.12);margin:12px 0 10px"></div>
          <a href="${SITE}/services.html" style="color:#60A5FA;text-decoration:none">Services</a> &middot;
          <a href="${SITE}/pricing.html" style="color:#60A5FA;text-decoration:none">Pricing</a> &middot;
          <a href="${SITE}/contact.html" style="color:#60A5FA;text-decoration:none">Support</a> &middot;
          <a href="${SITE}/privacy.html" style="color:#60A5FA;text-decoration:none">Privacy</a> &middot;
          <a href="${SITE}/terms.html" style="color:#60A5FA;text-decoration:none">Terms</a> &middot;
          <a href="${SITE}/security.html" style="color:#60A5FA;text-decoration:none">Security</a> &middot;
          <a href="${unsubUrl}" style="color:#60A5FA;text-decoration:none">Unsubscribe</a><br>
          <span style="color:#475569">You're receiving this because you or your company works with LoadBoot. &copy; ${new Date().getFullYear()} LoadBoot.</span>
        </td></tr>
      </table></td></tr></table></div>`;
  // ---- Official sender identity (Inc 61). Identities activate ONLY when the configured RESEND_FROM is on
  // the official domain (i.e. the owner verified loadboot.com with the provider); otherwise everything falls
  // back to RESEND_FROM so we never send from an unverified address.
  const domainVerified = /@loadboot\.com>?\s*$/i.test(RESEND_FROM);
  const IDENTITIES: Record<string, { from: string; replyTo: string }> = {
    marketing: { from: Deno.env.get("SENDER_MARKETING") || "LoadBoot <hello@loadboot.com>", replyTo: "hello@loadboot.com" },
    dispatch: { from: Deno.env.get("SENDER_DISPATCH") || "LoadBoot Dispatch <dispatch@loadboot.com>", replyTo: "dispatch@loadboot.com" },
    billing: { from: Deno.env.get("SENDER_BILLING") || "LoadBoot Billing <billing@loadboot.com>", replyTo: "billing@loadboot.com" },
  };
  const DISPATCH_RE = /(load|trip|offer|dispatch|booking|tracking|pod|detention|checkin|carrier|driver)/i;
  const BILLING_RE = /(billing|invoice|payment|settlement|payout|statement|receipt|factoring)/i;
  const categoryOf = (d: { source?: string; template_key?: string | null; meta?: Record<string, unknown> | null }): string => {
    const explicit = d.meta && typeof d.meta.category === "string" ? String(d.meta.category).toLowerCase() : "";
    if (explicit in IDENTITIES) return explicit; // explicit meta.category wins
    const key = String(d.template_key ?? "");
    if (BILLING_RE.test(key)) return "billing";
    if (DISPATCH_RE.test(key)) return "dispatch";
    if (d.source === "campaign") return "marketing";
    return "marketing"; // default transactional identity = hello@ (general company mailbox)
  };
  const senderFor = (d: Parameters<typeof categoryOf>[0]): { from: string; replyTo: string | null } =>
    domainVerified ? IDENTITIES[categoryOf(d)] : { from: RESEND_FROM, replyTo: null };

  let sent = 0, failed = 0;
  for (const d of claimed ?? []) {
    const subject = (d.meta && d.meta.subject) ? String(d.meta.subject) : "LoadBoot";
    const unsubUrl = `${UNSUB_BASE}?token=${d.correlation_id}`;
    const html = (d.meta && d.meta.body_html) ? shell(String(d.meta.body_html), unsubUrl, subject) : null;
    const text = ((d.meta && d.meta.body_text) ? String(d.meta.body_text) : subject) + `\n\n— LoadBoot · Support: ${SITE}/contact.html · Unsubscribe: ${unsubUrl}`;
    try {
      const ident = senderFor(d);
      const payload: Record<string, unknown> = { from: ident.from, to: d.recipient_email, subject, text,
        headers: { "X-Entity-Ref-ID": d.idempotency_key, "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
      if (ident.replyTo) payload.reply_to = ident.replyTo;
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
