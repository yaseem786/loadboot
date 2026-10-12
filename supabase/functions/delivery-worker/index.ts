// delivery-worker — drains app_private.message_deliveries and sends via Resend.
// v6: BIG-BRAND shell — clean header + Uber/Amazon-grade footer (link columns, Get-the-app pill).
// v7 (2026-08-01): every email now offers a phone call. A slim line above the footer carries the
// 24/7 number as a tel: link plus a button to loadboot.com/contact.html#call, where the
// recipient can have Riley call them immediately or book a date and time. Agents,
// dispatchers and referral partners are excluded — those relationships run in writing.
// The number is read from app_private.retell_config via the support_phone() RPC, never typed.
// Same safety model: no RESEND_API_KEY => safe no-op. Identities: hello@ / dispatch@ / billing@.
// v18 (2026-09-24): contact line follows the CC contact switch (WhatsApp / phone / both) — bl_comm_0438.
// v21 (2026-09-26, bl_comm_0464): ONE number. When the switch says `same` (the 815 line takes calls AND WhatsApp) the
//   band is one line — "📞💬 Call or WhatsApp us 24/7 on +1 (815) 365-1168 · Open WhatsApp →" — and the phone number
//   comes from the switch (contact_channel.phone), never from Riley's caller id.
// v10 (2026-08-01): outreach.* is pinned to the marketing identity — it was matching DISPATCH_RE on the word "carrier" and sending from dispatch@loadboot.com.
// v13 (2026-08-01): new "support" identity (hello@loadboot.com) replaces "marketing" as the final fallback, so Command Center replies and transactional mail leave the main domain instead of the cold-outreach subdomain SENDER_MARKETING now points at.
// v14 (2026-08-03): every link in the shell now carries its colour on an inner <span> with
// !important, not on the bare <a>. Inline colour on an anchor is not durable: Gmail, Outlook.com,
// Apple Mail and webmail compose editors all re-apply their own link colour, and a browser
// preview of an already-visited link does the same. The footer's pale links were rendering as
// mid-blue on the navy panel, and CTA buttons as dark-on-blue — unreadable in both cases.
// The <span> is what those clients actually respect. Same fix was applied to all 45 body
// templates in bl_mail_0199; this covers the shell that wraps them.
// v15 (2026-08-03): outreach.* emails are NOT wrapped in the shell. outreach_render (and the
// plain-text templates that replaced it in bl_out_0202) produce a COMPLETE email of their own;
// wrapping that in the transactional shell nested one branded email inside another — two
// headers, two footers, two call bands — for every one of the 1,200 cold emails sent so far.
// A cold email must also never carry the customer shell: it has its own unsubscribe footer.
// v16 (2026-08-15): the shell is now the GLOBAL, ONLY source of email branding. If a queued
// body_html arrives as a FULL HTML DOCUMENT (<!doctype/<html> — e.g. a hand-authored email
// queued via sys_email with its own header/footer), the worker normalizes it before wrapping:
// extracts the <body> inner content, strips <head>, and removes any leading/trailing
// dark brand-band tables (background #0f172a/#10223B/#f4f6f9 wrappers with a logo img) so the
// shell never nests a second header or footer. 34 emails went out double-headed on 2026-08-15
// (dispatcher.waitlist ×32, broker.verification, compliance.checklist) before this guard.
// outreach.* stays exempt (self-contained by design, v15).
// v17 (2026-09-01): unsubscribe is marketing-only. Transactional/operational mail no longer
// carries unsubscribe UI or RFC 8058 headers. A final service-role guard runs immediately
// before Resend so a contact who unsubscribed after claim is not sent the next outreach email.
// v19 (2026-09-25, bl_comm_0446): OPTIONAL operational mail (digests, product news, load offers,
// compliance nudges, billing reminders — any catalog group a person may switch off) now carries a
// "Manage email preferences" footer link + RFC 8058 one-click headers, pointing at the preference
// centre (functions/v1/unsubscribe). Essential mail (account & security, billing notices, staff
// alerts) still carries nothing and cannot be switched off. The same service-role gate the engine
// uses (cc_delivery_worker_optional_allowed → app_private.email_gate) runs right before Resend, so a
// one-click that landed after the row was queued still wins. Marketing keeps its "Unsubscribe" label.
// v20 (2026-09-26, bl_comm_0446c): the gate no longer needs meta.preference_group; see the loop.
// v22 (2026-09-28, bl_mail_0489): fifth identity "loads" (LoadBoot Loads <loads@loadboot.com>) for the
//   CC Mailbox's loads@ replies and new messages (template keys loads.mail.*). DB mirror: email_sender_for.
// v23 (2026-10-12, bl_comm_0543): shell moved to ../_shared/email-shell.ts (verbatim; output unchanged).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { renderCallBand, renderShell, type ShellCtx } from "../_shared/email-shell.ts";

// v16: normalize a full HTML document into a shell-safe fragment.
const looksFullDoc = (h: string): boolean => /<!doctype\s|<html[\s>]/i.test(h.slice(0, 500));
const normalizeFragment = (raw: string): string => {
  let h = raw;
  const bodyM = h.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyM) h = bodyM[1];
  h = h.replace(/<!doctype[^>]*>/gi, "").replace(/<head[\s\S]*?<\/head>/gi, "")
       .replace(/<\/?html[^>]*>/gi, "").replace(/<\/?body[^>]*>/gi, "")
       .replace(/<style[\s\S]*?<\/style>/gi, "");
  // Unwrap ONE level of full-width background wrapper table (the common outer scaffold).
  const wrapM = h.trim().match(/^<table[^>]*(?:background:#(?:f4f6f9|eef2f8)|width="100%")[^>]*>[\s\S]*<td[^>]*>([\s\S]*)<\/td>\s*<\/tr>\s*<\/table>$/i);
  if (wrapM && !/<table/i.test(h.trim().slice(0, 8)) === false && wrapM[1] && wrapM[1].length > 200) h = wrapM[1];
  // Drop leading brand-header rows/tables: any <tr>/<table> chunk within the first part of the
  // markup that carries a dark brand band or a logo image, plus gradient divider rows.
  for (let i = 0; i < 4; i++) {
    const t = h.trimStart();
    const lead = t.match(/^<(tr|table)[^>]*>[\s\S]*?<\/\1>/i);
    if (!lead) break;
    const chunk = lead[0];
    const isBrand = /background:\s*(#0f172a|#10223B)/i.test(chunk) || /email-logo[^"']*\.png/i.test(chunk) || (/linear-gradient/i.test(chunk) && chunk.length < 600);
    if (isBrand && chunk.length < 3000) { h = t.slice(chunk.length); continue; }
    break;
  }
  // Drop trailing footer rows/tables that look like a brand footer (dark band, copyright, or 'You received this').
  for (let i = 0; i < 4; i++) {
    const t = h.trimEnd();
    const tail = t.match(/<(tr|table)[^>]*>(?:(?!<\1[\s>])[\s\S])*?<\/\1>\s*$/i);
    if (!tail) break;
    const chunk = tail[0];
    const isFooter = /background:\s*(#0f172a|#10223B|#f8fafc)/i.test(chunk) && (/loadboot\.com/i.test(chunk) || /you received this|all rights reserved|&bull;|&copy;/i.test(chunk));
    if (isFooter && chunk.length < 3000) { h = t.slice(0, t.length - chunk.length); continue; }
    break;
  }
  return h.trim();
};

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

  let PHONE_DISPLAY = "";
  try { const { data: ph } = await sb.rpc("support_phone"); PHONE_DISPLAY = typeof ph === "string" ? ph : ""; } catch (_) { PHONE_DISPLAY = ""; }
  // v18 (2026-09-24, bl_comm_0438): the contact line follows the ONE Command Center contact switch
  // (lb_contact_channel): 'whatsapp' -> "WhatsApp us" with a wa.me link, 'phone' -> the call line,
  // 'both' -> both. Owner rule: no email may hard-code the Retell/Riley phone number.
  let CH = "phone", WA_DISPLAY = "", WA_URL = "", SAME = false;
  try {
    const { data: cc } = await sb.rpc("lb_contact_channel");
    const c = (cc && typeof cc === "object") ? cc as Record<string, any> : null;
    if (c) {
      CH = String(c.channel || "phone"); WA_DISPLAY = String(c.whatsapp?.display || ""); WA_URL = String(c.whatsapp?.url || "");
      SAME = c.same === true && !!c.one?.tel;                                            // v21
      if ((CH === "phone" || CH === "both") && c.phone?.display) PHONE_DISPLAY = String(c.phone.display);   // v21: the switch owns the number
    }
  } catch (_) { /* keep the phone line */ }
  const PHONE_TEL = PHONE_DISPLAY.replace(/[^0-9+]/g, "");
  const useWa = (CH === "whatsapp" || CH === "both") && !!WA_DISPLAY && /^https:\/\/wa\.me\/\d{8,15}$/.test(WA_URL);
  const usePhone = !!PHONE_DISPLAY && (CH === "phone" || CH === "both" || !useWa);
  const useOne = SAME && useWa && !!PHONE_DISPLAY;                                        // v21: one sign, one line

  const NO_CALL_RE = /(agent|dispatcher|referral|commission|payout)/i;
  const wantsCall = (d: { template_key?: string | null; meta?: Record<string, unknown> | null }): boolean => {
    if (!useWa && !usePhone) return false;
    const role = String((d.meta?.role ?? d.meta?.audience ?? "") as string).toLowerCase();
    if (["agent", "dispatcher", "referral"].includes(role)) return false;
    if (d.meta?.no_call === true) return false;
    return !NO_CALL_RE.test(String(d.template_key ?? ""));
  };

  // v23 (2026-10-12, bl_comm_0543): the shell lives in ../_shared/email-shell.ts — one source for this worker AND
  // tools/email-preview, so a preview is byte-for-byte what the customer gets. Output unchanged from v22.
  const SHELL_CTX: ShellCtx = { SITE, LOGO, PHONE_DISPLAY, PHONE_TEL, WA_DISPLAY, WA_URL, useOne, useWa, usePhone };
  const callBandHtml = () => renderCallBand(SHELL_CTX);
  const shell = (bodyHtml: string, unsubUrl: string | null, subject = "", callBand = "", unsubLabel = "Unsubscribe") =>
    renderShell(SHELL_CTX, bodyHtml, unsubUrl, subject, callBand, unsubLabel);

  const domainVerified = /@loadboot\.com>?\s*$/i.test(RESEND_FROM);
  const IDENTITIES: Record<string, { from: string; replyTo: string }> = {
    marketing: { from: Deno.env.get("SENDER_MARKETING") || "LoadBoot <hello@loadboot.com>", replyTo: "hello@loadboot.com" },
    dispatch: { from: Deno.env.get("SENDER_DISPATCH") || "LoadBoot Dispatch <dispatch@loadboot.com>", replyTo: "dispatch@loadboot.com" },
    billing: { from: Deno.env.get("SENDER_BILLING") || "LoadBoot Billing <billing@loadboot.com>", replyTo: "billing@loadboot.com" },
    support: { from: Deno.env.get("SENDER_SUPPORT") || "LoadBoot Support <hello@loadboot.com>", replyTo: "hello@loadboot.com" },
    loads: { from: Deno.env.get("SENDER_LOADS") || "LoadBoot Loads <loads@loadboot.com>", replyTo: "loads@loadboot.com" },
  };
  const DISPATCH_RE = /(load|trip|offer|dispatch|booking|tracking|pod|detention|checkin|carrier|driver|ops\.)/i;
  const BILLING_RE = /(billing|invoice|payment|settlement|payout|statement|receipt|factoring)/i;
  const categoryOf = (d: { source?: string; template_key?: string | null; meta?: Record<string, unknown> | null }): string => {
    const explicit = d.meta && typeof d.meta.category === "string" ? String(d.meta.category).toLowerCase() : "";
    if (explicit in IDENTITIES) return explicit;
    const key = String(d.template_key ?? "");
    // Cold outreach always sends from the marketing identity, never from dispatch@ or
    // billing@. DISPATCH_RE matches the word "carrier", so keys like outreach.carrier.1
    // were being classified as dispatch and sent from the address that carries real load
    // mail. Operational and acquisition email must never share a sender identity.
    if (/^outreach[._-]/i.test(key)) return "marketing";
    // v22: CC Mailbox replies from loads@ (loads.mail.*) leave from loads@. Checked before
    // DISPATCH_RE, which would otherwise claim them for the word "load".
    if (/^loads\.mail\./i.test(key)) return "loads";
    if (BILLING_RE.test(key)) return "billing";
    if (DISPATCH_RE.test(key)) return "dispatch";
    if (d.source === "campaign") return "marketing";
    // Final fallback is "support" (hello@loadboot.com), never "marketing". SENDER_MARKETING now
    // points at mail.loadboot.com, the COLD-OUTREACH subdomain. Anything reaching this line was
    // NOT positively identified as outreach, campaign, billing or dispatch — in practice that is
    // a human Command Center reply (cc_mail_reply -> sys_email, template_key 'mail.reply',
    // meta.category 'transactional') or ordinary transactional mail such as welcome.account and
    // onboarding.confirm_email. A person writing back to a customer must come from the main domain.
    return "support";
  };
  const senderFor = (d: Parameters<typeof categoryOf>[0]): { from: string; replyTo: string | null } =>
    domainVerified ? IDENTITIES[categoryOf(d)] : { from: RESEND_FROM, replyTo: null };

  let sent = 0, failed = 0, suppressed = 0;
  for (const d of claimed ?? []) {
    const subject = (d.meta && d.meta.subject) ? String(d.meta.subject) : "LoadBoot";
    // Marketing gets "Unsubscribe"; optional operational mail gets "Manage email preferences" (v19);
    // essential mail gets nothing and must remain deliverable.
    const selfContained = /^outreach[._-]/i.test(String(d.template_key ?? ""));
    const marketing = selfContained || d.source === "campaign";
    let unsubUrl = marketing ? `${UNSUB_BASE}?token=${d.correlation_id}` : null;
    let unsubLabel = "Unsubscribe";
    const prefGroup = String((d.meta && d.meta.preference_group) || "");
    // v20: the gate runs for EVERY non-marketing row, not only rows whose meta names a preference_group.
    // Rows enqueued without meta.preference_group (cc_enqueue_transactional, fire_comm_trigger,
    // reminder_dispatch, lb_email_notify) skipped it, so catalog-marketing keys sent as "transactional"
    // (chat.lead.followup, agent.invite, dispatcher.waitlist …) reached people who had unsubscribed.
    // email_gate resolves the group from email_catalog by template_key; essential keys still pass.
    if (!marketing && prefGroup !== "account_critical" && prefGroup !== "staff_internal") {
      // v19: ask the engine. Blocked → mark and skip; allowed + optional → carry the preferences link.
      const { data: gate, error: gateError } = await sb.rpc("cc_delivery_worker_optional_allowed", { p_id: d.id });
      if (gateError) {
        await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "failed", p_reason: `preference gate failed: ${gateError.message}`, p_provider: "resend", p_dedupe: null });
        failed++;
        continue;
      }
      const g = (gate && typeof gate === "object") ? gate as Record<string, unknown> : {};
      if (g.allowed === false) {
        await sb.rpc("cc_delivery_worker_mark", { p_id: d.id, p_status: "unsubscribed", p_reason: String(g.reason || "recipient unsubscribed from this kind of email"), p_provider: "resend", p_dedupe: null });
        suppressed++;
        continue;
      }
      if (g.essential !== true && g.group) {
        unsubUrl = `${UNSUB_BASE}?token=${d.correlation_id}`;
        unsubLabel = g.group === "marketing" ? "Unsubscribe" : "Manage email preferences";
      }
    }

    // Fail closed immediately before Resend. This closes the claim→send race: if the
    // recipient unsubscribed after this row was claimed, no next outreach email leaves.
    if (marketing) {
      const { data: allowed, error: guardError } = await sb.rpc("cc_delivery_worker_marketing_allowed", { p_id: d.id });
      if (guardError) {
        await sb.rpc("cc_delivery_worker_mark", {
          p_id: d.id, p_status: "failed",
          p_reason: `marketing suppression guard failed: ${guardError.message}`,
          p_provider: "resend", p_dedupe: null,
        });
        failed++;
        continue;
      }
      if (allowed !== true) {
        await sb.rpc("cc_delivery_worker_mark", {
          p_id: d.id, p_status: "unsubscribed",
          p_reason: "recipient opted out of marketing/outreach",
          p_provider: "resend", p_dedupe: null,
        });
        suppressed++;
        continue;
      }
    }

    // Outreach bodies are complete emails with their own unsubscribe footer — send them
    // exactly as rendered. Wrapping them in the shell nested two branded emails (v15).
    const withCall = !selfContained && wantsCall(d);
    let html: string | null = null;
    if (d.meta && d.meta.body_html) {
      const raw = String(d.meta.body_html);
      if (selfContained) html = raw;
      else {
        // v16: the shell is the only branding layer — full documents get normalized first.
        const fragment = looksFullDoc(raw) ? normalizeFragment(raw) : raw;
        html = shell(fragment || raw, unsubUrl, subject, withCall ? callBandHtml() : "", unsubLabel);
      }
    }
    const callLine = !withCall ? "" : useOne
      ? `\n\nPrefer to talk or message? Call or WhatsApp us 24/7 on ${PHONE_DISPLAY} (WhatsApp: ${WA_URL}), or book a time and we call you: ${SITE}/contact.html#call`
      : (useWa ? `\n\nPrefer to chat? WhatsApp us 24/7 on ${WA_DISPLAY}: ${WA_URL}` : "") +
      (usePhone ? `\n\nPrefer to talk? Call us 24/7 on ${PHONE_DISPLAY}, or book a time and we call you: ${SITE}/contact.html#call` : "");
    const unsubscribeLine = unsubUrl ? `\n\n— LoadBoot · Support: ${SITE}/contact.html · ${unsubLabel}: ${unsubUrl}` : `\n\n— LoadBoot · Support: ${SITE}/contact.html`;
    const text = ((d.meta && d.meta.body_text) ? String(d.meta.body_text) : subject) + callLine + unsubscribeLine;
    try {
      const ident = senderFor(d);
      const headers: Record<string, string> = { "X-Entity-Ref-ID": d.idempotency_key };
      if (unsubUrl) {
        headers["List-Unsubscribe"] = `<${unsubUrl}>`;
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      }
      const payload: Record<string, unknown> = { from: ident.from, to: d.recipient_email, subject, text, headers };
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
  return Response.json({ ok: true, claimed: (claimed ?? []).length, sent, failed, suppressed }, { status: 200 });
});

