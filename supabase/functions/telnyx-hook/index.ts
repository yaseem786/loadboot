import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

// telnyx-hook v3 (bl_dial_0351 + 0351b + 0351c) — the signed front door for every Telnyx voice webhook (both the WebRTC
// credential connection and the Voice-API application that owns the dispatcher numbers point here).
// verify_jwt = false (Telnyx cannot send a Supabase JWT) — authenticity comes from the Ed25519 signature:
//   telnyx-signature-ed25519: base64(sig)   telnyx-timestamp: unix seconds   message = `${timestamp}|${rawBody}`
// With no TELNYX_PUBLIC_KEY configured the function REFUSES everything (503): an unsigned door is never open.
// The decision logic lives in Postgres (public.dialer_hook_event); this function only verifies, forwards,
// and executes the ONE Telnyx command the database asks for. It always answers Telnyx fast.
// v2 (bl_dial_0351b): when the database returns `notify`, the dispatcher's devices get a web push ("Incoming call —
// open LoadBoot") so a phone in the pocket still knows. Same VAPID secrets + cc_push_targets as push-send. Best effort.
// v3 (bl_dial_0351c): action 'wait' — the dispatcher's portal is closed and no mobile forward is set. The caller is left
// ringing, the push goes out, and a background timer asks the database after N seconds whether anyone claimed the call
// (telnyx-token {claim:true} does that when their phone registers); if not, the normal fallback runs.
// iOS App Store shell (apns: endpoints) is skipped here — push-send owns APNs; add it when the iOS app ships.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const PUBKEY_B64 = Deno.env.get("TELNYX_PUBLIC_KEY") || "";
const TX = "https://api.telnyx.com/v2";
const TOLERANCE_S = 300;

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let keyP: Promise<CryptoKey> | null = null;
const pubKey = () => (keyP ??= crypto.subtle.importKey("raw", b64(PUBKEY_B64), { name: "Ed25519" }, false, ["verify"]));

async function verify(raw: string, sig: string | null, ts: string | null): Promise<boolean> {
  if (!sig || !ts) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_S) return false;
  try {
    return await crypto.subtle.verify({ name: "Ed25519" }, await pubKey(), b64(sig), new TextEncoder().encode(`${ts}|${raw}`));
  } catch (_) { return false; }
}

async function hookEvent(data: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dialer_hook_event`, {
    method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p: data, p_verified: true }),
  });
  if (!r.ok) throw new Error("dialer_hook_event " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}

const cmd = (ccid: string, action: string, body: Record<string, unknown>) => fetch(`${TX}/calls/${encodeURIComponent(ccid)}/actions/${action}`, {
  method: "POST", headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(body),
});

// deno-lint-ignore no-explicit-any
async function notify(n: any): Promise<void> {
  try {
    const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!n?.user_id || !pub || !priv) return;
    const tr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cc_push_targets`, {
      method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_audience: null, p_user_ids: [n.user_id], p_org: null }),
    });
    if (!tr.ok) return;
    const subs: { endpoint: string; p256dh: string; auth: string }[] = await tr.json();
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:support@loadboot.com", pub, priv);
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || "/app/agent/", tag: "lb-call" });
    await Promise.all(subs.filter((s) => !s.endpoint.startsWith("apns:")).map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 45, urgency: "high" }).catch(() => {})));
  } catch (e) { console.error("notify", e); }
}

async function waitThenFallback(callId: string, secs: number): Promise<void> {
  await new Promise((r) => setTimeout(r, Math.min(Math.max(secs, 5), 60) * 1000));
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dialer_wait_expired`, {
      method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_call: callId }),
    });
    const act = r.ok ? await r.json() : null;
    if (act) await run(act);
  } catch (e) { console.error("wait", e); }
}

// deno-lint-ignore no-explicit-any
async function run(act: any, depth = 0): Promise<void> {
  if (act?.type === "wait" && act.wait_call_id) {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    const p = waitThenFallback(String(act.wait_call_id), Number(act.secs) || 35);
    if (rt?.waitUntil) rt.waitUntil(p); else await p;
    return;
  }
  if (!act || !act.type || !act.call_control_id || depth > 2) return;
  const id = act.call_control_id as string;
  let r: Response | null = null;
  if (act.type === "transfer") {
    r = await cmd(id, "transfer", { to: act.to, from: act.from, timeout_secs: act.timeout_secs ?? 25, client_state: act.client_state, target_leg_client_state: act.target_leg_client_state });
    if (!r.ok && act.target_leg_client_state) {
      // the dispatcher's browser could not be reached at all → behave exactly as if their leg rang out
      const res = await hookEvent({ id: "synth-" + crypto.randomUUID(), event_type: "call.hangup", payload: { client_state: act.target_leg_client_state, hangup_cause: "transfer_failed_" + r.status } });
      return run(res?.action, depth + 1);
    }
  } else if (act.type === "answer") r = await cmd(id, "answer", { client_state: act.client_state });
  else if (act.type === "speak") r = await cmd(id, "speak", { payload: act.text, voice: "female", language: "en-US", client_state: act.client_state });
  else if (act.type === "record_start") {
    // call.bridged can reach us a moment before Telnyx marks the leg answered → 422 "Call not answered yet" (90034). Retry briefly.
    for (let i = 0; i < 4; i++) {
      r = await cmd(id, "record_start", { format: "mp3", channels: "dual", play_beep: !!act.notice });
      if (r.ok || r.status !== 422) break;
      await new Promise((ok) => setTimeout(ok, 1200));
    }
  }
  else if (act.type === "record_voicemail") r = await cmd(id, "record_start", { format: "mp3", channels: "single", play_beep: true, max_length: 120, timeout_secs: 6 });
  else if (act.type === "hangup") r = await cmd(id, "hangup", {});
  if (r && !r.ok) console.error("telnyx cmd failed", act.type, r.status, (await r.text()).slice(0, 300));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  if (!PUBKEY_B64 || !TELNYX_KEY) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  const ok = await verify(raw, req.headers.get("telnyx-signature-ed25519"), req.headers.get("telnyx-timestamp"));
  if (!ok) return new Response("bad signature", { status: 401 });
  try {
    const body = JSON.parse(raw);
    const data = body?.data;
    if (!data?.event_type || !String(data.event_type).startsWith("call.")) return new Response("ignored");
    const res = await hookEvent(data);
    await Promise.all([res?.action ? run(res.action) : Promise.resolve(), res?.notify ? notify(res.notify) : Promise.resolve()]);
  } catch (e) {
    console.error("telnyx-hook", e);         // still 200: Telnyx retries would only replay the same failure
  }
  return new Response("ok");
});
