// inbound-mail v4 (PROD) — Resend/Cloudflare inbound webhook. Emails addressed to loads@*
// route to the load-mail parser (email load ingestion); everything else files into the
// CC Mailbox via cc_mail_ingest. Optional ?secret= gate via INBOUND_SECRET.
//
// v3 (2026-07-31): a reply whose subject or body says "unsubscribe" (or remove me / stop
// emailing / opt out) is now HONORED automatically — the sender is suppressed and their
// outreach contact flipped via the service-role RPC cc_mail_unsubscribe_from — and the
// email still files into the CC Mailbox with an [unsubscribe] tag so staff can see it.
// Both the email footer and the unsubscribe page tell people they can reply with the word
// "unsubscribe", so that path has to actually work.
//
// v4 (2026-08-02): loads@ routing now matches ANY recipient field (to/cc/bcc/envelope/
// delivered-to/headers), not just To — brokers Cc or Bcc us on their carrier blasts.
import { createClient } from "jsr:@supabase/supabase-js@2";

const pick = (v: unknown): string => (typeof v === "string" ? v : "");
const emailOf = (v: unknown): { email: string; name: string } => {
  if (!v) return { email: "", name: "" };
  if (typeof v === "string") { const m = v.match(/^\s*\"?([^<\"]*)\"?\s*<([^>]+)>\s*$/); return m ? { email: m[2].trim(), name: m[1].trim() } : { email: v.trim(), name: "" }; }
  if (Array.isArray(v)) return emailOf(v[0]);
  if (typeof v === "object") { const o = v as Record<string, unknown>; return { email: pick(o.email) || pick(o.address), name: pick(o.name) }; }
  return { email: "", name: "" };
};

// Split a raw header value on top-level commas (ignoring commas inside a quoted display
// name), so "Doe, John" <j@x.com>, loads@loadboot.com yields both addresses.
const splitAddrs = (s: string): string[] => s.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
// Flatten any recipient-ish value (string / array / object / comma-joined header) into
// lowercased addresses. Every field below may be absent or any of those shapes.
const addrsOf = (v: unknown): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap(addrsOf);
  if (typeof v === "string") return splitAddrs(v).map((s) => emailOf(s).email.toLowerCase()).filter(Boolean);
  const e = emailOf(v).email.toLowerCase();
  return e ? [e] : [];
};

const UNSUB_RE = /\bunsubscribe\b|\bremove me\b|\bstop (sending|emailing|these emails)\b|\bopt[ -]?out\b|\btake me off\b/i;

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return Response.json({ ok: false }, { status: 200 });
  const SECRET = Deno.env.get("INBOUND_SECRET");
  if (SECRET) { const u = new URL(req.url); if (u.searchParams.get("secret") !== SECRET) return Response.json({ ok: false, reason: "bad secret" }, { status: 401 }); }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { return Response.json({ ok: false, reason: "bad json" }, { status: 200 }); }
  const d = (body.data ?? body) as Record<string, unknown>;
  const from = emailOf(d.from);
  // Our outreach asks brokers to "add loads@loadboot.com to your daily load blast list", and
  // they do that by Cc'ing or Bcc'ing us — their To line is their own carrier list. So the
  // loads@ test has to look at every recipient field the provider might populate, not just To.
  // A Bcc'd address is stripped from the headers entirely and survives ONLY in the envelope
  // recipient, so envelope/delivered-to/x-original-to are checked too.
  const hdrs = (typeof d.headers === "object" && d.headers ? d.headers : {}) as Record<string, unknown>;
  const envl = (typeof d.envelope === "object" && d.envelope ? d.envelope : {}) as Record<string, unknown>;
  const tos = addrsOf(d.to);
  const rcpts = [...new Set([
    ...tos,
    ...addrsOf(d.cc), ...addrsOf(d.bcc),
    ...addrsOf(envl.to), ...addrsOf(d.envelope_to), ...addrsOf(d.envelopeTo),
    ...addrsOf(d.delivered_to), ...addrsOf(d.deliveredTo), ...addrsOf(d.recipient), ...addrsOf(d.recipients),
    ...addrsOf(hdrs.to), ...addrsOf(hdrs.cc), ...addrsOf(hdrs["delivered-to"]), ...addrsOf(hdrs["x-original-to"]),
  ])];
  if (!from.email || rcpts.length === 0) return Response.json({ ok: false, reason: "missing from/to" }, { status: 200 });

  if (rcpts.some((t) => t.startsWith("loads@"))) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/load-mail`, {
        method: "POST", headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ from: from.email, subject: pick(d.subject), text: pick(d.text) || pick(d.html).replace(/<[^>]+>/g, " ") }),
      });
      const out = await r.json().catch(() => ({}));
      return Response.json({ ok: true, routed: "load-mail", result: out }, { status: 200 });
    } catch (e) {
      return Response.json({ ok: false, routed: "load-mail", reason: String(e).slice(0, 200) }, { status: 200 });
    }
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Honor "reply to unsubscribe" before filing the mail.
  const subjectRaw = pick(d.subject);
  const textRaw = pick(d.text) || pick(d.html).replace(/<[^>]+>/g, " ");
  let unsubscribed = false;
  if (UNSUB_RE.test(subjectRaw) || UNSUB_RE.test(textRaw.slice(0, 2000))) {
    try { const { data: u } = await sb.rpc("cc_mail_unsubscribe_from", { p_email: from.email }); unsubscribed = !!(u && (u as { ok?: boolean }).ok); } catch (_) { /* file the mail regardless */ }
  }

  const { data, error } = await sb.rpc("cc_mail_ingest", { p: {
    from_email: from.email, from_name: from.name, to_email: tos[0] || rcpts[0],
    subject: (unsubscribed ? "[unsubscribe] " : "") + subjectRaw, body_text: pick(d.text), body_html: pick(d.html),
    message_id: pick(d.message_id) || pick((d.headers as Record<string, unknown> | undefined)?.["message-id"]),
    in_reply_to: pick((d.headers as Record<string, unknown> | undefined)?.["in-reply-to"]),
  } });
  if (error) return Response.json({ ok: false, reason: error.message, unsubscribed }, { status: 200 });
  return Response.json({ ok: true, id: data, unsubscribed }, { status: 200 });
});
