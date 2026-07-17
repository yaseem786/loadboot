// delivery-worker — drains app_private.message_deliveries and sends via Resend.
// v5: CLEAN PREMIUM shell (single consistent look for EVERY LoadBoot email — app + auth).
// Same safety model: no RESEND_API_KEY => safe no-op. Identities: hello@ / dispatch@ / billing@.
// The Supabase Auth "Confirm signup" template (docs/email-templates/confirm-signup-premium.html)
// mirrors this exact shell, so app-sent and auth emails look identical — only the body changes.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "LoadBoot <onboarding@resend.dev>";
  if (!SUPABASE_URL || !SERVICE_KEY) return Response.json({ ok: false, reason: "missing Supabase service context" }, { status: 200 });
  if (!RESEND_API_KEY) return Response.json({ ok: true, sent: 0, reason: "RESEND_API_KEY not set — email delivery disabled (safe no-op)" }, { status: 200 });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  await sb.rpc("cc_delivery_release_due", { p_channel: "email" });
  const { data: claimed, error } = await sb.rpc("cc_delivery_worker_claim", { p_limit: 50, p_channel: "email" });
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 200 });

  const UNSUB_BASE = Deno.env.get("UNSUBSCRIBE_URL") || `${SUPABASE_URL}/functions/v1/unsubscribe`;
  const SITE = Deno.env.get("SITE_URL") || "https://loadboot.com";
  const LOGO = Deno.env.get("BRAND_LOGO_URL") || `${SITE}/email-logo-white-2x.png`;

  // ---- CLEAN PREMIUM SHELL (v5) — navy header + logo/tagline, thin brand accent, body, clean navy footer ----
  const shell = (bodyHtml: string, unsubUrl: string, subject = "") =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0}
  @media only screen and (max-width:620px){
    .lb-card{width:100%!important;border-radius:0!important}
    .lb-pad{padding-left:22px!important;padding-right:22px!important}
    .lb-btn{display:block!important;text-align:center!important}
  }
</style></head>
<body style="margin:0;padding:0;background:#eef2f8">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${subject}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<div style="background:#eef2f8;padding:28px 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" class="lb-card" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
  <tr><td class="lb-pad" style="background:#10223B;padding:26px 32px">
    <img src="${LOGO}" width="150" height="36" alt="LoadBoot" style="display:block;border:0;max-width:150px;height:auto">
    <div style="color:#7dd3fc;font-size:11.5px;margin-top:9px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">The Operating System for Trucking</div>
  </td></tr>
  <tr><td style="height:4px;background:#0883F7;background:linear-gradient(90deg,#0883F7,#FC5305);font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td class="lb-pad" style="padding:34px 32px 30px;color:#0f172a;font-size:15px;line-height:1.7">${bodyHtml}</td></tr>
  <tr><td class="lb-pad" style="padding:24px 32px 26px;background:#10223B;color:#94a3b8;font-size:12px;line-height:1.7">
    <img src="${LOGO}" width="128" height="31" alt="LoadBoot" style="display:block;border:0;max-width:128px;height:auto;margin-bottom:13px">
    <div style="font-size:13px;line-height:2.05;margin-bottom:6px">
      <a href="${SITE}/how-it-works.html" style="color:#cbd5e1;text-decoration:none">How It Works</a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/pricing.html" style="color:#cbd5e1;text-decoration:none">Pricing</a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/services.html" style="color:#cbd5e1;text-decoration:none">Services</a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/market-rates.html" style="color:#cbd5e1;text-decoration:none">Market Rates</a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/contact.html" style="color:#cbd5e1;text-decoration:none">Contact</a>
    </div>
    <div style="font-size:13px;line-height:2.05;margin-bottom:14px">
      <a href="${SITE}/app/carrier/" style="color:#7dd3fc;text-decoration:none;font-weight:700">Carrier Portal</a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/app/partner/" style="color:#7dd3fc;text-decoration:none;font-weight:700">Broker / Shipper Portal</a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/agents.html" style="color:#7dd3fc;text-decoration:none;font-weight:700">Agent Program</a>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,.12);margin:0 0 12px"></div>
    <div style="font-size:11.5px;line-height:1.9">
      <a href="${SITE}/privacy.html" style="color:#94a3b8;text-decoration:none">Privacy</a> &middot;
      <a href="${SITE}/terms.html" style="color:#94a3b8;text-decoration:none">Terms</a> &middot;
      <a href="${SITE}/contact.html" style="color:#94a3b8;text-decoration:none">Support</a> &middot;
      <a href="${unsubUrl}" style="color:#94a3b8;text-decoration:none">Unsubscribe</a>
    </div>
    <div style="color:#5c6f8f;font-size:11px;margin-top:9px">Truck dispatch &amp; logistics technology &middot; United States &middot; &copy; ${new Date().getFullYear()} LoadBoot</div>
  </td></tr>
</table></td></tr></table></div></body></html>`;

  const domainVerified = /@loadboot\.com>?\s*$/i.test(RESEND_FROM);
  const IDENTITIES: Record<string, { from: string; replyTo: string }> = {
    marketing: { from: Deno.env.get("SENDER_MARKETING") || "LoadBoot <hello@loadboot.com>", replyTo: "hello@loadboot.com" },
    dispatch: { from: Deno.env.get("SENDER_DISPATCH") || "LoadBoot Dispatch <dispatch@loadboot.com>", replyTo: "dispatch@loadboot.com" },
    billing: { from: Deno.env.get("SENDER_BILLING") || "LoadBoot Billing <billing@loadboot.com>", replyTo: "billing@loadboot.com" },
  };
  const DISPATCH_RE = /(load|trip|offer|dispatch|booking|tracking|pod|detention|checkin|carrier|driver|ops\.)/i;
  const BILLING_RE = /(billing|invoice|payment|settlement|payout|statement|receipt|factoring)/i;
  const categoryOf = (d: { source?: string; template_key?: string | null; meta?: Record<string, unknown> | null }): string => {
    const explicit = d.meta && typeof d.meta.category === "string" ? String(d.meta.category).toLowerCase() : "";
    if (explicit in IDENTITIES) return explicit;
    const key = String(d.template_key ?? "");
    if (BILLING_RE.test(key)) return "billing";
    if (DISPATCH_RE.test(key)) return "dispatch";
    if (d.source === "campaign") return "marketing";
    return "marketing";
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
