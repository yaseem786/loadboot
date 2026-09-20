import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-recording v2 (bl_dial_0351) — streams one call recording to the signed-in user. verify_jwt = true.
// Access is decided in Postgres AS THE CALLER (public.dialer_recording_ref: own call, or CC staff). Telnyx
// download links are short-lived and need the API key, so the audio is proxied: the browser gets bytes, never
// a Telnyx URL or key. Body: { call_id }.
// Served as application/octet-stream on purpose: supabase-js functions.invoke() only hands back a Blob for that type.
// v2: CORS preflight echoes the requested headers.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const TX = "https://api.telnyx.com/v2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const txGet = (path: string) => fetch(TX + path, { headers: { Authorization: `Bearer ${TELNYX_KEY}`, Accept: "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { const asked = req.headers.get("access-control-request-headers"); return new Response("ok", { headers: asked ? { ...cors, "Access-Control-Allow-Headers": asked } : cors }); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!TELNYX_KEY) return json({ error: "not configured" }, 503);
  try {
    const { call_id } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(String(call_id || ""))) return json({ error: "call_id" }, 400);
    const ref = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dialer_recording_ref`, {
      method: "POST", headers: { apikey: ANON, Authorization: req.headers.get("Authorization") || "", "Content-Type": "application/json" },
      body: JSON.stringify({ p_call: call_id }),
    });
    const a = ref.ok ? await ref.json() : null;
    if (!a?.ok) return json({ error: a?.error || "not authorized" }, 403);

    let url: string | null = null;
    if (a.recording_id) {
      const r = await txGet(`/recordings/${encodeURIComponent(a.recording_id)}`);
      if (r.ok) { const j = await r.json(); url = j?.data?.download_urls?.mp3 || j?.data?.download_urls?.wav || null; }
    }
    if (!url && a.session_id) {
      const r = await txGet(`/recordings?filter[call_session_id]=${encodeURIComponent(a.session_id)}&page[size]=1`);
      if (r.ok) { const j = await r.json(); const d = j?.data?.[0]; url = d?.download_urls?.mp3 || d?.download_urls?.wav || null; }
    }
    if (!url) return json({ error: "recording not available" }, 404);
    const audio = await fetch(url);
    if (!audio.ok || !audio.body) return json({ error: "download " + audio.status }, 502);
    return new Response(audio.body, { headers: { ...cors, "Content-Type": "application/octet-stream", "X-Audio-Type": audio.headers.get("Content-Type") || "audio/mpeg", "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
