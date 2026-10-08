import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-transcribe v2 (bl_dial_0514) — speech-to-text for one dialer call recording, shown in CC → Dialer calls.
// verify_jwt = true. Access is decided in Postgres AS THE CALLER (public.dialer_recording_ref: own call or CC staff).
// Uses the existing TELNYX_API_KEY: Telnyx AI /ai/audio/transcriptions. v2: the audio is downloaded here and uploaded as
// `file` (Telnyx rejected the S3 file_url: "file_url content-length not found"). Telnyx limit: 100 MB per file.
// Long calls take a while, so the work runs in the background (EdgeRuntime.waitUntil) and the result is saved through
// public.dialer_transcript_save (service_role only). The browser polls public.dialer_transcript_get.
// Body: { call_id, force? }  →  { ok, status: 'ready' | 'processing' }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const TX = "https://api.telnyx.com/v2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const txGet = (path: string) => fetch(TX + path, { headers: { Authorization: `Bearer ${TELNYX_KEY}`, Accept: "application/json" } });
const asCaller = (auth: string, fn: string, body: unknown) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const save = (call_id: string, p: Record<string, unknown>) => fetch(`${SUPABASE_URL}/rest/v1/rpc/dialer_transcript_save`, {
  method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_call: call_id, p }),
});
function subOf(auth: string): string {
  try { const t = auth.replace(/^Bearer\s+/i, "").split(".")[1]; return JSON.parse(atob(t.replace(/-/g, "+").replace(/_/g, "/"))).sub || ""; } catch { return ""; }
}

type Seg = { start?: number; end?: number; speaker?: string; text: string };
function normalise(j: any): { text: string; segments: Seg[] } {
  const segs: Seg[] = [];
  const utt = j?.utterances || j?.results?.utterances;
  if (Array.isArray(utt) && utt.length) {
    for (const u of utt) segs.push({ start: u.start, end: u.end, speaker: u.channel != null ? "ch" + u.channel : (u.speaker != null ? "s" + u.speaker : undefined), text: String(u.transcript || u.text || "").trim() });
  } else if (Array.isArray(j?.segments)) {
    for (const s of j.segments) segs.push({ start: s.start, end: s.end, speaker: s.speaker != null ? "s" + s.speaker : (s.channel != null ? "ch" + s.channel : undefined), text: String(s.text || s.transcript || "").trim() });
  }
  let text = typeof j?.text === "string" ? j.text : "";
  if (!text) { const ch = j?.results?.channels; if (Array.isArray(ch)) text = ch.map((c: any) => c?.alternatives?.[0]?.transcript || "").join("\n\n"); }
  if (!text && segs.length) text = segs.map((s) => s.text).join(" ");
  return { text: text.trim(), segments: segs.filter((s) => s.text) };
}

async function transcribe(url: string): Promise<{ model: string; language: string; out: any }> {
  const dl = await fetch(url);
  if (!dl.ok) throw new Error("recording download " + dl.status);
  const audio = await dl.blob();
  if (audio.size > 100 * 1024 * 1024) throw new Error("recording is larger than 100 MB (" + Math.round(audio.size / 1048576) + " MB)");
  const kind = (dl.headers.get("Content-Type") || "").includes("wav") ? "wav" : "mp3";
  const attempts: Array<{ model: string; language?: string; cfg?: Record<string, unknown>; verbose?: boolean }> = [
    { model: "deepgram/nova-3", language: "multi", cfg: { smart_format: true, punctuate: true, utterances: true, multichannel: true } },
    { model: "deepgram/nova-3", language: "multi", cfg: { smart_format: true, punctuate: true, utterances: true, diarize: true } },
    { model: "openai/whisper-large-v3-turbo", verbose: true },
  ];
  let last = "";
  for (const a of attempts) {
    const f = new FormData();
    f.append("model", a.model); f.append("file", new File([audio], "call." + kind, { type: kind === "wav" ? "audio/wav" : "audio/mpeg" }));
    if (a.language) f.append("language", a.language);
    if (a.cfg) f.append("model_config", JSON.stringify(a.cfg));
    if (a.verbose) { f.append("response_format", "verbose_json"); f.append("timestamp_granularities[]", "segment"); }
    const r = await fetch(TX + "/ai/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${TELNYX_KEY}` }, body: f });
    const body = await r.text();
    if (r.ok) { try { return { model: a.model, language: a.language || "auto", out: JSON.parse(body) }; } catch { last = "bad json"; continue; } }
    last += (last ? " | " : "") + a.model + ": " + r.status + " " + body.slice(0, 200);
  }
  throw new Error("transcription failed: " + last);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { const asked = req.headers.get("access-control-request-headers"); return new Response("ok", { headers: asked ? { ...cors, "Access-Control-Allow-Headers": asked } : cors }); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!TELNYX_KEY || !SERVICE) return json({ error: "not configured" }, 503);
  try {
    const auth = req.headers.get("Authorization") || "";
    const { call_id, force } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(String(call_id || ""))) return json({ error: "call_id" }, 400);
    const a = await asCaller(auth, "dialer_recording_ref", { p_call: call_id });
    if (!a?.ok) return json({ error: a?.error || "not authorized" }, 403);
    if (!force) {
      const t = await asCaller(auth, "dialer_transcript_get", { p_call: call_id });
      if (t?.exists && t.model !== "pending" && t.model !== "error") return json({ ok: true, status: "ready" });
      if (t?.exists && t.model === "pending" && Date.now() - Date.parse(t.created_at) < 8 * 60 * 1000) return json({ ok: true, status: "processing" });
    }
    let url: string | null = null;
    if (a.recording_id) { const r = await txGet(`/recordings/${encodeURIComponent(a.recording_id)}`); if (r.ok) { const j = await r.json(); url = j?.data?.download_urls?.mp3 || j?.data?.download_urls?.wav || null; } }
    if (!url && a.session_id) { const r = await txGet(`/recordings?filter[call_session_id]=${encodeURIComponent(a.session_id)}&page[size]=1`); if (r.ok) { const j = await r.json(); const d = j?.data?.[0]; url = d?.download_urls?.mp3 || d?.download_urls?.wav || null; } }
    if (!url) return json({ error: "recording not available" }, 404);
    const who = subOf(auth);
    await save(call_id, { model: "pending", requested_by: who });
    const work = (async () => {
      try {
        const { model, language, out } = await transcribe(url!);
        const { text, segments } = normalise(out);
        const raw = JSON.stringify(out).length < 900000 ? out : null;
        await save(call_id, { model, language, text, segments, raw, requested_by: who });
      } catch (e) {
        await save(call_id, { model: "error", text: null, raw: { error: String((e as Error)?.message || e) }, requested_by: who });
      }
    })();
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
    return json({ ok: true, status: "processing" });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
