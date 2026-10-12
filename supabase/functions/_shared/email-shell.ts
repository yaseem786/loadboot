// email-shell — the ONE LoadBoot email shell (header with the real logo, brand bar, body slot, call/WhatsApp band,
// Uber/Amazon-style footer). Extracted verbatim from delivery-worker v22 on 12 Oct 2026 (bl_comm_0543) so the worker
// and tools/email-preview render from the SAME code — a preview can never drift from what a customer receives.
// Rules (CLAUDE.md §10): an email body is a FRAGMENT. Never put a logo, header, footer or contact line in a body —
// this shell adds them. Premium bodies are built with app_private.email_kit(jsonb).
// Changing this file changes EVERY email LoadBoot sends: preview it first (node tools/email-preview/preview.mjs).

export interface ShellCtx {
  SITE: string;          // https://loadboot.com
  LOGO: string;          // white logo for the navy header/footer (email-logo-white-2x.png)
  PHONE_DISPLAY: string; // from the CC contact switch (lb_contact_channel), never typed
  PHONE_TEL: string;
  WA_DISPLAY: string;
  WA_URL: string;
  useOne: boolean;       // one number for call + WhatsApp (bl_comm_0464)
  useWa: boolean;
  usePhone: boolean;
}

export function renderCallBand(ctx: ShellCtx): string {
  const { SITE, PHONE_DISPLAY, PHONE_TEL, WA_DISPLAY, WA_URL, useOne, useWa, usePhone } = ctx;
  return `<tr><td class="lb-pad" style="padding:0 32px 24px">
    <div style="border-top:1px solid #e8eef6;padding-top:13px;font-size:13px;line-height:1.7;color:#64748b">
      ${useOne ? `&#128222;&#128172; Rather just talk or message? <b style="color:#10223B">Call or WhatsApp</b> us 24/7 on <a href="tel:${PHONE_TEL}" style="color:#0883F7;font-weight:800;text-decoration:none;white-space:nowrap">${PHONE_DISPLAY}</a>
      &nbsp;&middot;&nbsp; <a href="${WA_URL}" style="color:#16a34a;font-weight:700;text-decoration:none;white-space:nowrap">Open WhatsApp &rarr;</a>
      &nbsp;&middot;&nbsp; or <a href="${SITE}/contact.html#call" style="color:#0883F7;font-weight:700;text-decoration:none">have us call you &rarr;</a>` : ""}${!useOne && useWa ? `&#128172; Rather just message? WhatsApp us 24/7 on <a href="${WA_URL}" style="color:#0883F7;font-weight:800;text-decoration:none;white-space:nowrap">${WA_DISPLAY}</a>
      &nbsp;&middot;&nbsp; <a href="${WA_URL}" style="color:#16a34a;font-weight:700;text-decoration:none;white-space:nowrap">Open WhatsApp &rarr;</a>` : ""}${!useOne && useWa && usePhone ? "<br>" : ""}${!useOne && usePhone ? `&#128222; Rather just talk? Call us 24/7 on <a href="tel:${PHONE_TEL}" style="color:#0883F7;font-weight:800;text-decoration:none;white-space:nowrap">${PHONE_DISPLAY}</a>
      &nbsp;&middot;&nbsp; or <a href="${SITE}/contact.html#call" style="color:#0883F7;font-weight:700;text-decoration:none">have us call you &rarr;</a>` : ""}
    </div>
  </td></tr>`;
}

export function renderShell(ctx: ShellCtx, bodyHtml: string, unsubUrl: string | null, subject = "", callBand = "", unsubLabel = "Unsubscribe"): string {
  const { SITE, LOGO } = ctx;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
  @media only screen and (max-width:620px){
    .lb-card{width:100%!important;border-radius:0!important}
    .lb-pad{padding-left:22px!important;padding-right:22px!important}
    .lb-btn{display:block!important;text-align:center!important}
    .lb-2col>tbody>tr>td{display:block!important;width:100%!important;padding-right:0!important;padding-bottom:14px!important}
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
  ${callBand}
  <tr><td class="lb-pad" style="padding:30px 32px 8px;background:#10223B">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="left" style="vertical-align:middle"><img src="${LOGO}" width="140" height="34" alt="LoadBoot" style="display:block;border:0;max-width:140px;height:auto"></td>
      <td align="right" style="vertical-align:middle">
        <table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr><td style="border:1px solid rgba(255,255,255,.28);border-radius:999px">
          <a href="${SITE}/apps.html" style="display:inline-block;padding:9px 18px;font-size:12.5px;font-weight:700;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">&#9660;&nbsp; Get the app</span></a>
        </td></tr></table>
      </td>
    </tr></table>
    <div style="color:#5c6f8f;font-size:11px;margin-top:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">The Operating System for Trucking</div>
  </td></tr>
  <tr><td class="lb-pad" style="padding:22px 32px 4px;background:#10223B">
    <table role="presentation" class="lb-2col" width="100%" cellpadding="0" cellspacing="0"><tbody><tr>
      <td width="33%" style="vertical-align:top;padding-right:10px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.13em;color:#5c6f8f;text-transform:uppercase;margin-bottom:8px">Company</div>
        <div style="font-size:13px;line-height:2.15">
          <a href="${SITE}/about.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">About us</span></a><br>
          <a href="${SITE}/how-it-works.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">How it works</span></a><br>
          <a href="${SITE}/blog.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">Blog</span></a><br>
          <a href="${SITE}/contact.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">Contact</span></a>
        </div>
      </td>
      <td width="33%" style="vertical-align:top;padding-right:10px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.13em;color:#5c6f8f;text-transform:uppercase;margin-bottom:8px">Products</div>
        <div style="font-size:13px;line-height:2.15">
          <a href="${SITE}/services.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">Dispatch services</span></a><br>
          <a href="${SITE}/pricing.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">Pricing</span></a><br>
          <a href="${SITE}/market-rates.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">Market rates</span></a><br>
          <a href="${SITE}/cost-per-mile-calculator.html" style="color:#cbd5e1 !important;text-decoration:none"><span style="color:#cbd5e1 !important;text-decoration:none">Cost-per-mile calculator</span></a>
        </div>
      </td>
      <td width="33%" style="vertical-align:top">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.13em;color:#5c6f8f;text-transform:uppercase;margin-bottom:8px">Sign in</div>
        <div style="font-size:13px;line-height:2.15">
          <a href="${SITE}/app/carrier/" style="color:#7dd3fc !important;text-decoration:none;font-weight:700"><span style="color:#7dd3fc !important;text-decoration:none">Carrier portal</span></a><br>
          <a href="${SITE}/app/partner/" style="color:#7dd3fc !important;text-decoration:none;font-weight:700"><span style="color:#7dd3fc !important;text-decoration:none">Broker &amp; shipper portal</span></a><br>
          <a href="${SITE}/app/agent/" style="color:#7dd3fc !important;text-decoration:none;font-weight:700"><span style="color:#7dd3fc !important;text-decoration:none">Agent portal</span></a><br>
          <a href="${SITE}/agents.html" style="color:#7dd3fc !important;text-decoration:none;font-weight:700"><span style="color:#7dd3fc !important;text-decoration:none">Agent program (1%)</span></a>
        </div>
      </td>
    </tr></tbody></table>
  </td></tr>
  <tr><td class="lb-pad" style="padding:18px 32px 26px;background:#10223B">
    <div style="border-top:1px solid rgba(255,255,255,.12);margin:0 0 14px"></div>
    <div style="font-size:11.5px;line-height:2">
      <a href="${SITE}/privacy.html" style="color:#94a3b8 !important;text-decoration:none"><span style="color:#94a3b8 !important;text-decoration:none">Privacy</span></a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/terms.html" style="color:#94a3b8 !important;text-decoration:none"><span style="color:#94a3b8 !important;text-decoration:none">Terms</span></a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/contact.html" style="color:#94a3b8 !important;text-decoration:none"><span style="color:#94a3b8 !important;text-decoration:none">Support</span></a>
      ${unsubUrl ? ` &nbsp;&middot;&nbsp; <a href="${unsubUrl}" style="color:#94a3b8 !important;text-decoration:none"><span style="color:#94a3b8 !important;text-decoration:none">${unsubLabel}</span></a>` : ""}
    </div>
    <div style="color:#5c6f8f;font-size:11px;line-height:1.8;margin-top:8px">
      LoadBoot &middot; Truck dispatch &amp; logistics technology &middot; United States<br>
      This email was sent to you because you or your company works with LoadBoot.<br>
      &copy; ${new Date().getFullYear()} LoadBoot. All rights reserved.
    </div>
  </td></tr>
</table></td></tr></table></div></body></html>`;
}
