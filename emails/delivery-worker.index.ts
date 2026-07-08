// delivery-worker — drains app_private.message_deliveries and sends via Resend.
// v4: PREMIUM RESPONSIVE shell (mobile-first tables + @media), same safety model:
// no RESEND_API_KEY => safe no-op. Identities: hello@ / dispatch@ / billing@ on verified domain.
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

  // ---- PREMIUM RESPONSIVE SHELL (v4) ----
  const shell = (bodyHtml: string, unsubUrl: string, subject = "") =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0}
  @media only screen and (max-width:620px){
    .lb-card{width:100%!important;border-radius:0!important}
    .lb-pad{padding-left:20px!important;padding-right:20px!important}
    .lb-hpad{padding-left:20px!important;padding-right:20px!important}
    .lb-h1{font-size:22px!important;line-height:1.3!important}
    .lb-btn{display:block!important;text-align:center!important}
    .lb-2col>tbody>tr>td{display:block!important;width:100%!important}
    .lb-hide-sm{display:none!important}
  }
</style></head>
<body style="margin:0;padding:0;background:#e9eef6">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${subject}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<div style="background:#e9eef6;padding:26px 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" class="lb-card" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dfe7f0">
  <tr><td style="height:5px;background:#FC5305;background:linear-gradient(90deg,#FC5305,#F97316);font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td class="lb-hpad" style="background:#0b1220;padding:26px 32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="left"><img src="${LOGO}" width="150" height="36" alt="LoadBoot" style="display:block;border:0;max-width:150px;height:auto"></td>
      <td align="right" style="vertical-align:middle"><a href="${SITE}/app/" style="color:#60A5FA;font-size:12.5px;font-weight:700;text-decoration:none">Open portal &rarr;</a></td>
    </tr></table>
    <div style="color:#5c6f8f;font-size:11.5px;margin-top:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">The Operating System for Trucking</div>
  </td></tr>
  <tr><td class="lb-pad" style="padding:36px 32px 28px;color:#0f172a;font-size:15px;line-height:1.7">${bodyHtml}</td></tr>
  <tr><td class="lb-pad" style="padding:18px 32px;background:#f6f9fd;border-top:1px solid #e6edf6">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:.12em;color:#94a3b8;margin-bottom:9px">MORE ON LOADBOOT</div>
    <table role="presentation" class="lb-2col" width="100%" cellpadding="0" cellspacing="0"><tbody><tr>
      <td style="font-size:12.5px;line-height:2.1;vertical-align:top">
        <a href="${SITE}/app/carrier/#loads" style="color:#0883F7;text-decoration:none;font-weight:600">&rsaquo; Available loads on the board</a><br>
        <a href="${SITE}/app/carrier/#documents" style="color:#0883F7;text-decoration:none;font-weight:600">&rsaquo; Documents &amp; compliance status</a>
      </td>
      <td style="font-size:12.5px;line-height:2.1;vertical-align:top">
        <a href="${SITE}/detention-pay-policy.html" style="color:#0883F7;text-decoration:none;font-weight:600">&rsaquo; Accessorial pay policies</a><br>
        <a href="${SITE}/resources.html" style="color:#0883F7;text-decoration:none;font-weight:600">&rsaquo; Carrier guides &amp; resources</a>
      </td>
    </tr></tbody></table>
  </td></tr>
  <tr><td class="lb-pad" style="padding:22px 32px;background:#0b1220;color:#8ea2c3;font-size:12px;line-height:2">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><b style="color:#ffffff;font-size:14px">Load<span style="color:#60A5FA">Boot</span></b><br><span style="color:#5c6f8f">Truck dispatch &amp; logistics technology &middot; United States</span></td>
      <td align="right" style="vertical-align:top"><a href="${SITE}/apps.html" style="color:#60A5FA;font-size:12px;font-weight:700;text-decoration:none">Get the app</a></td>
    </tr></table>
    <div style="border-top:1px solid rgba(255,255,255,.12);margin:12px 0 10px"></div>
    <a href="${SITE}/services.html" style="color:#60A5FA;text-decoration:none">Services</a> &middot;
    <a href="${SITE}/pricing.html" style="color:#60A5FA;text-decoration:none">Pricing</a> &middot;
    <a href="${SITE}/contact.html" style="color:#60A5FA;text-decoration:none">Support</a> &middot;
    <a href="${SITE}/privacy.html" style="color:#60A5FA;text-decoration:none">Privacy</a> &middot;
    <a href="${SITE}/terms.html" style="color:#60A5FA;text-decoration:none">Terms</a> &middot;
    <a href="${unsubUrl}" style="color:#60A5FA;text-decoration:none">Unsubscribe</a><br>
    <span style="color:#475569">You're receiving this because you or your company works with LoadBoot. &copy; ${new Date().getFullYear()} LoadBoot.</span>
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
