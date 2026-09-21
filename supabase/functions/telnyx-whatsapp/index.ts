import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-whatsapp v2 (bl_wa_0367 + bl_wa_0375) — sends ONE WhatsApp message from LoadBoot's single WABA number
// (+1 815 365 1168, shared by every dispatcher; the conversation has an owner, the number does not). verify_jwt = true.
// Body: { thread_id } or { to } plus either { body } (free text, only inside the 24-hour window) or
//       { template: { name, vars: [...] } } (an APPROVED Utility template, the only thing allowed outside the window).
// Every rule (WhatsApp switched on, dispatcher active, thread ownership, 24-hour window, template approved at Meta,
// variable count, hourly cap, Phone Terms) is enforced in Postgres AS THE CALLER by public.wa_send_prepare, which
// also writes the queued row — so a message exists in LoadBoot's record before it leaves. The Telnyx API key lives
// only here; the browser never sees it. Delivery receipts arrive later through telnyx-hook → public.wa_hook.
// Endpoint per Telnyx docs (20 Sep 2026): POST https://api.telnyx.com/v2/messages/whatsapp
//   { from, to, whatsapp_message: { type: 'text' | 'template' | 'image' | 'document' | 'audio' | 'video', ... } }
// v2 - attachments. Telnyx has to FETCH the file, so it cannot go straight from the browser: the browser uploads
// it to the PRIVATE wa-media bucket and passes only the path. This function turns that path into a 15-minute
// SIGNED link with the service role and puts it in the Telnyx payload. The bucket stays private, the browser
// never mints the link, and the link dies long before anyone could pass it around.
// messaging_profile_id is NOT sent: it is not documented for this endpoint, and `from` already routes the message.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const TX = "https://api.telnyx.com/v2";
const LINK_TTL_S = 900;

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function mark(id: string, status: string, telnyxId: string | null, error: string | null) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wa_mark`, {
    method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id, p_status: status, p_telnyx_id: telnyxId, p_error: error }),
  });
  return r.ok ? await r.json() : null;
}

// a short-lived signed link for a private object, made with the service role
async function signedLink(path: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/wa-media/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: LINK_TTL_S }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const rel = j?.signedURL || j?.signedUrl;
  return rel ? `${SUPABASE_URL}/storage/v1${rel}` : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { const asked = req.headers.get("access-control-request-headers"); return new Response("ok", { headers: asked ? { ...cors, "Access-Control-Allow-Headers": asked } : cors }); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!TELNYX_KEY) return json({ error: "The WhatsApp service is not configured yet (TELNYX_API_KEY)." }, 503);
  try {
    const b = await req.json().catch(() => ({}));
    const p_in: Record<string, unknown> = {};
    if (b?.thread_id) p_in.thread_id = String(b.thread_id);
    if (b?.to) p_in.to = String(b.to);
    if (typeof b?.body === "string") p_in.body = b.body;
    if (b?.template?.name) p_in.template = { name: String(b.template.name), vars: Array.isArray(b.template.vars) ? b.template.vars.map((v: unknown) => String(v ?? "")) : [] };
    if (b?.media?.path) {
      p_in.media = {
        path: String(b.media.path), mime: String(b.media.mime || ""), kind: String(b.media.kind || ""),
        file_name: String(b.media.file_name || ""), caption: String(b.media.caption || ""), voice: !!b.media.voice,
      };
    }

    const prep = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wa_send_prepare`, {
      method: "POST", headers: { apikey: ANON, Authorization: req.headers.get("Authorization") || "", "Content-Type": "application/json" },
      body: JSON.stringify({ p: p_in }),
    });
    const p = prep.ok ? await prep.json() : null;
    if (!p?.ok) return json({ ok: false, error: p?.error || "Could not send that WhatsApp message.", needs_template: !!p?.needs_template }, 200);

    const msg = p.whatsapp_message || {};
    if (p.media_path && p.media_kind) {
      const link = await signedLink(String(p.media_path));
      if (!link) {
        const m0 = await mark(p.id, "failed", null, "The attachment could not be prepared for sending.");
        return json({ ok: false, error: "The attachment could not be prepared for sending.", message: m0 }, 200);
      }
      msg[p.media_kind] = { ...(msg[p.media_kind] || {}), link };
    }

    const t = await fetch(`${TX}/messages/whatsapp`, {
      method: "POST", headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ from: p.from, to: p.to, whatsapp_message: msg }),
    });
    const j = await t.json().catch(() => ({}));
    const id = j?.data?.id || j?.data?.message_id || j?.id;
    if (!t.ok || !id) {
      const why = String(j?.errors?.[0]?.detail || j?.errors?.[0]?.title || ("Telnyx " + t.status)).slice(0, 280);
      const m = await mark(p.id, "failed", null, why);
      return json({ ok: false, error: why, thread_id: p.thread_id, message: m }, 200);
    }
    const m = await mark(p.id, "sent", String(id), null);
    return json({ ok: true, thread_id: p.thread_id, message: m });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
