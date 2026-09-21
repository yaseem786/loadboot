import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-wa-media v1 (bl_wa_0372) — streams ONE WhatsApp attachment to the person entitled to see it.
// verify_jwt = true. Body: { message_id }.
// The file lives on Telnyx's storage, not ours. public.wa_media_ref() is called AS THE CALLER, so Postgres
// decides whether this dispatcher owns that conversation (staff always may); only then does this function
// fetch the bytes and hand them back. The Telnyx URL never reaches the browser, and neither does the API key.
// Telnyx's media links appear to be public, so the first attempt is unauthenticated; a 401/403 is retried with
// the API key rather than assumed one way or the other.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { const asked = req.headers.get("access-control-request-headers"); return new Response("ok", { headers: asked ? { ...cors, "Access-Control-Allow-Headers": asked } : cors }); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.message_id || "");
    if (!id) return json({ error: "message_id is required" }, 400);

    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wa_media_ref`, {
      method: "POST", headers: { apikey: ANON, Authorization: req.headers.get("Authorization") || "", "Content-Type": "application/json" },
      body: JSON.stringify({ p_id: id }),
    });
    const ref = r.ok ? await r.json() : null;
    if (!ref?.ok) return json({ error: ref?.error || "Attachment not available." }, 200);

    let m = await fetch(ref.url);
    if ((m.status === 401 || m.status === 403) && TELNYX_KEY) {
      m = await fetch(ref.url, { headers: { Authorization: `Bearer ${TELNYX_KEY}` } });
    }
    if (!m.ok || !m.body) return json({ error: "Telnyx " + m.status + " - the attachment could not be fetched." }, 200);

    const name = ref.file_name || ("attachment" + (String(ref.mime).includes("pdf") ? ".pdf" : ""));
    return new Response(m.body, {
      headers: {
        ...cors,
        "Content-Type": String(ref.mime || "application/octet-stream").split(";")[0],
        "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
