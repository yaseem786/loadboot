// load-mail v9 — v8 + the function itself now requires a SERVICE-ROLE caller (audit F01 follow-up, 2026-09-06).
// WHY: bl_sec_0320 locked the three lb_email_* RPCs to service_role, but load-mail is deployed with
// verify_jwt=true, and "a valid project JWT" includes the ANON key that ships in every visitor's browser.
// So anyone could POST {from, subject, text} here and load-mail would faithfully relay it to those RPCs using
// SUPABASE_SERVICE_ROLE_KEY — a confused deputy: the spoofing hole F01 set out to close had simply moved one
// layer up. Found by Codex during the Sprint 1+2 verification pass.
// The real chain is unaffected: inbound-mail v4 already calls us with `Authorization: Bearer ${SERVICE_KEY}`.
// The gateway has already verified the SIGNATURE (verify_jwt=true); here we only read WHO it is.
// load-mail v8 — v7 + Authorization: Bearer <service role> on the three lb_email_* RPC calls.
// v7 sent `apikey` only; bl_sec_0320 (audit F01) makes those RPCs service-role-only, so the
// Bearer header is now REQUIRED (cc_mail_ingest already carried it). No other change.
// Source was not in the repo before 2026-09-05 (v7 lived only in the Supabase deploy) — this
// file is the canonical copy from now on. Deploy order on prod: v8 FIRST, then bl_sec_0320.
// v11.1 (30 Sep): schema fields are plain strings ("" = unknown) — the nullable version hit Claude's union-type limit.
// v11 — CLAUDE FIRST, Gemini fallback (bl_brain_0505, 30 Sep 2026, owner ask). Every loads@ email is parsed by the
//   Claude brain when public.brain_loads_gate() allows it (CC -> AI Brain: kill switch, source.loads_email on/live,
//   its $ and job caps, the brain-wide $ cap; model + effort from brain_config ->> 'loads_email'). Structured JSON
//   output, no tools. Claude off / capped / failing / refusing -> the Gemini chain below, unchanged. Every Claude
//   attempt is written to brain_jobs via public.brain_loads_record() so its cost and failures show in CC.
//   Why: 28-29 Sep, Gemini 429 + 503 turned 36 of 41 loads@ emails into "[loads@ unparsed]".
// v10 — Gemini 5xx moves to the next model + one retry pass (27 Sep 2026). v7 — v6 + BOOKING-CONFIRM reply path (broker replies to booking-ping → confirms/declines the hold).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];
let WM: string | null = null;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
async function gem(key: string, prompt: string): Promise<{ text: string | null; err: string }> {
  const tryM = WM ? [WM, ...MODELS.filter((m) => m !== WM)] : MODELS;
  let err = "";
  // v10 (27 Sep 2026): a 5xx from Gemini (503 "overloaded" is the common one) used to abort the whole loop on the
  // FIRST model, so a warm `WM` that hiccupped once turned into `502 parse_failed gemini-flash-latest:503` for the
  // mail (prod, 14:18 UTC) and inbound-mail had to fall back to the Mailbox. Now every 4xx-quota/5xx status moves on
  // to the next model, and if the whole list fails transiently we wait a moment and go round once more.
  const TRANSIENT = new Set([400, 404, 429, 500, 502, 503, 504]);
  for (let pass = 0; pass < 2; pass++) {
    let transient = false;
    for (const m of tryM) {
      try {
        const cfg: any = { temperature: 0, maxOutputTokens: 4000, responseMimeType: "application/json" };
        if (m.startsWith("gemini-2.5")) cfg.thinkingConfig = { thinkingBudget: 0 };
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg }) });
        if (r.ok) { WM = m; const d = await r.json(); return { text: d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? null, err: String(d?.candidates?.[0]?.finishReason || "") }; }
        err = m + ":" + r.status;
        if (!TRANSIENT.has(r.status)) return { text: null, err };   // 401/403 etc.: the key is wrong, no model will help
        if (r.status === 429 || r.status >= 500) transient = true;    // 400/404 = this model, not the service: no second pass for those
      } catch (e) { err = String(e).slice(0, 100); transient = true; }
    }
    if (!transient) break;
    if (pass === 0) { WM = null; await new Promise((res) => setTimeout(res, 1500)); }
  }
  return { text: null, err };
}
// v11: the shape load-mail already asks Gemini for, as a JSON schema for Claude's structured output.
// reply_fields / confirm_fields are always objects (all-null when unused): the code below only reads non-null keys.
// v11.1: plain strings, "" = unknown. A ["string","null"] union on all 37 fields was rejected (400 "too many
// parameters with union types"); denull() turns "" back into null so everything downstream is unchanged.
const S_ = { type: "string" };
const denull = (v: any): any => v === "" ? null : Array.isArray(v) ? v.map(denull)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, denull(x)])) : v;
const obj = (props: string[], extra: Record<string, unknown> = {}) => ({
  type: "object", additionalProperties: false, required: [...props, ...Object.keys(extra)],
  properties: { ...Object.fromEntries(props.map((k) => [k, S_])), ...extra },
});
const LOAD_SCHEMA = obj([], {
  intent: { type: "string", enum: ["loads", "reply_details", "booking_confirm", "question", "interest", "unsubscribe", "spam", "other"] },
  broker: obj(["company", "mc", "phone", "contact_name"]),
  reply_fields: obj(["rate", "pickup_date", "equipment", "weight", "origin", "destination"]),
  confirm_fields: obj(["pickup_address", "delivery_address", "reference", "contact_phone", "note", "declined"]),
  loads: { type: "array", items: obj(["origin", "origin_address", "destination", "destination_address", "equipment", "weight",
    "commodity", "rate", "rate_type", "miles", "pickup_date", "pickup_time", "delivery_date", "delivery_time", "requirements",
    "temp", "hazmat", "reference", "contact_name", "contact_phone", "notes"]) },
});
type ClaudeOut = { parsed: any; err: string; usage: any; model: string };
async function claudeParse(key: string, model: string, effort: string, prompt: string): Promise<ClaudeOut> {
  const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 });
  const usage = { input_tokens: 0, cache_read: 0, cache_write: 0, output_tokens: 0 };
  let useFormat = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res: any = await client.messages.create({
        model, max_tokens: 8000,
        messages: [{ role: "user", content: useFormat ? prompt + "\n(Where the rules above say null, return an empty string.)" : prompt }],
        output_config: useFormat ? { effort, format: { type: "json_schema", schema: LOAD_SCHEMA } } : { effort },
      } as any);
      const u = res.usage ?? {};
      usage.input_tokens += u.input_tokens ?? 0; usage.output_tokens += u.output_tokens ?? 0;
      usage.cache_read += u.cache_read_input_tokens ?? 0; usage.cache_write += u.cache_creation_input_tokens ?? 0;
      if (res.stop_reason === "refusal") return { parsed: null, err: "refusal:" + (res.stop_details?.category ?? ""), usage, model: res.model ?? model };
      if (res.stop_reason === "max_tokens") return { parsed: null, err: "max_tokens", usage, model: res.model ?? model };
      const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      try { return { parsed: denull(JSON.parse(text.replace(/```json|```/g, "").trim())), err: "", usage, model: res.model ?? model }; }
      catch { return { parsed: null, err: "bad_json", usage, model: res.model ?? model }; }
    } catch (e: any) {
      // Structured output rejected for this model/account? One retry without the format, parsed leniently (as brain does).
      if (useFormat && e instanceof Anthropic.BadRequestError && /output_config|format|json_schema|schema/i.test(String(e.message))) { useFormat = false; continue; }
      return { parsed: null, err: String(e?.status ?? "") + ":" + String(e?.message ?? e).slice(0, 160), usage, model };
    }
  }
  return { parsed: null, err: "no_attempt", usage, model };
}
async function geocode(place: string): Promise<[number, number] | null> {
  try { const r = await fetch("https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(place + ", USA")); const d = await r.json(); const c = d?.features?.[0]?.geometry?.coordinates; return Array.isArray(c) ? [c[0], c[1]] : null; } catch { return null; }
}
// v9: is this caller the service role? TWO accepted proofs, because this project mixes key formats:
//   (a) the bearer equals our own SUPABASE_SERVICE_ROLE_KEY. inbound-mail reads the SAME env var in the SAME
//       project, so this matches by construction and works for the NEW `sb_secret_…` keys, which are opaque
//       strings, not JWTs. The first cut of v9 only did (b) and broke the real chain in staging testing —
//       the same "assume the key format" mistake that F02's exact-key comparison made in the other direction.
//   (b) a legacy JWT whose payload role is service_role — kept so an older/rotated JWT-format key still works.
// Both are checked against values we hold ourselves; nothing here trusts caller-supplied claims alone, and the
// gateway (verify_jwt=true) has already rejected anything that is not a valid credential for this project.
function isServiceCaller(auth: string): boolean {
  const bearer = (auth || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const svc = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (svc && bearer.length === svc.length) {                       // length-guarded constant-time compare
    let diff = 0;
    for (let i = 0; i < svc.length; i++) diff |= bearer.charCodeAt(i) ^ svc.charCodeAt(i);
    if (diff === 0) return true;
  }
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(bearer);
  if (!m) return false;
  try {
    const b64 = m[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - m[2].length % 4) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).role === "service_role";
  } catch { return false; }
}

Deno.serve(async (req) => {
  try {
    // v9: only the inbound-mail relay (service role) may reach the ingestion RPCs through us.
    if (!isServiceCaller(req.headers.get("Authorization") || "")) {
      return json({ error: "forbidden", code: "LB403" }, 403);
    }
    const KEY = Deno.env.get("GEMINI_API_KEY") || "";
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // v8: every RPC call carries the service-role JWT (bl_sec_0320 refuses anything else).
    const RPC_HEADERS = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
    const b = await req.json().catch(() => ({}));
    const from = String(b.from || ""), subject = String(b.subject || ""), text = String(b.text || "").slice(0, 8000);
    if (!from || !text) return json({ error: "need from + text" }, 400);
    const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (!KEY && !CLAUDE_KEY) return json({ error: "no_ai_key" }, 500);
    const prompt = `You are the inbox brain for loads@loadboot.com (US trucking platform). Classify this email and extract data. Respond ONLY minified JSON:\n{"intent":"loads"|"reply_details"|"booking_confirm"|"question"|"interest"|"unsubscribe"|"spam"|"other","broker":{"company":string|null,"mc":string|null,"phone":string|null,"contact_name":string|null},"reply_fields":{"rate":string|null,"pickup_date":string|null,"equipment":string|null,"weight":string|null,"origin":string|null,"destination":string|null}|null,"confirm_fields":{"pickup_address":string|null,"delivery_address":string|null,"reference":string|null,"contact_phone":string|null,"note":string|null,"declined":"yes"|null}|null,"loads":[{"origin":string|null,"origin_address":string|null,"destination":string|null,"destination_address":string|null,"equipment":string|null,"weight":string|null,"commodity":string|null,"rate":string|null,"rate_type":"all-in"|"per-mile"|null,"miles":string|null,"pickup_date":string|null,"pickup_time":string|null,"delivery_date":string|null,"delivery_time":string|null,"requirements":string|null,"temp":string|null,"hazmat":"yes"|null,"reference":string|null,"contact_name":string|null,"contact_phone":string|null,"notes":string|null}]}\nRules: intent="loads" ONLY if the email offers full freight loads. intent="booking_confirm" when the email is a reply CONFIRMING (or declining) a booking / that a load is still available — e.g. \"Confirmed\", \"yes still open, pickup at 123 Dock St\", \"sorry, it's covered\" — put the pickup/delivery address and details in confirm_fields (declined=\"yes\" if the load is gone/covered). intent="reply_details" when it is a SHORT reply supplying missing detail(s) for an earlier load (e.g. \"rate is $2,100\", \"pickup Tuesday 9am\") — put those values in reply_fields. Greetings/questions/marketing = their own intent. Never invent anything. origin/destination \"City, ST\"; equipment normalized (Dry Van/Reefer/Flatbed/Step Deck/Hotshot/Power Only/Box Truck); \"TBD\"/\"call\" = null.\n---EMAIL---\nFROM: ${from}\nSUBJECT: ${subject}\n${text}`;
    // v11: Claude first (when the brain gate allows), Gemini as the fallback.
    let parsed: any = null, via = "", claudeErr = "";
    let gate: any = null;
    try { const r = await fetch(`${URL_}/rest/v1/rpc/brain_loads_gate`, { method: "POST", headers: RPC_HEADERS, body: "{}" }); gate = r.ok ? await r.json() : null; } catch { gate = null; }
    if (CLAUDE_KEY && gate && gate.use_claude) {
      const t0 = Date.now();
      const c = await claudeParse(CLAUDE_KEY, String(gate.model || "claude-sonnet-5"), String(gate.effort || "low"), prompt);
      if (c.parsed) { parsed = c.parsed; via = "claude"; } else claudeErr = "claude " + c.err;
      try {
        await fetch(`${URL_}/rest/v1/rpc/brain_loads_record`, { method: "POST", headers: RPC_HEADERS, body: JSON.stringify({ p: {
          ok: !!c.parsed, ref: from, subject, model: c.model, effort: gate.effort, ms: Date.now() - t0, ...c.usage,
          error: c.parsed ? null : c.err,
          result: c.parsed ? { intent: c.parsed.intent, loads: (c.parsed.loads || []).length } : null } }) });
      } catch { /* the ledger never blocks a load */ }
    } else if (gate && !gate.use_claude) claudeErr = "claude skipped: " + gate.reason;
    let gErr = "";
    if (!parsed && KEY) {
      const g = await gem(KEY, prompt);
      gErr = g.err;
      if (g.text) { try { parsed = JSON.parse(g.text.replace(/```json|```/g, "").trim()); via = "gemini"; } catch { /* noop */ } }
    }
    if (!parsed) return json({ error: "parse_failed", detail: [claudeErr, gErr].filter(Boolean).join(" | ") }, 502);

    if (parsed.intent === "booking_confirm") {
      const cf: any = {};
      if (parsed.confirm_fields) for (const k of Object.keys(parsed.confirm_fields)) if (parsed.confirm_fields[k]) cf[k] = parsed.confirm_fields[k];
      const payload = cf.declined ? { action: "decline", note: (cf.note || text.slice(0, 300)) } : cf;
      const r = await fetch(`${URL_}/rest/v1/rpc/lb_email_ping_confirm_by_email`, { method: "POST", headers: RPC_HEADERS, body: JSON.stringify({ p_from_email: from, p: payload }) });
      const out = await r.json().catch(() => null);
      if (out && out.ok) return json({ ok: true, intent: "booking_confirm", result: out });
      await fetch(`${URL_}/rest/v1/rpc/cc_mail_ingest`, { method: "POST", headers: RPC_HEADERS, body: JSON.stringify({ p: { from_email: from, from_name: parsed.broker?.contact_name || "", to_email: "loads@loadboot.com", subject: "[loads@ booking_confirm] " + subject, body_text: text, body_html: "", message_id: "", in_reply_to: "" } }) });
      return json({ ok: true, intent: "booking_confirm", action: "routed_to_mailbox", detail: out });
    }

    if (parsed.intent === "reply_details" && parsed.reply_fields) {
      const rf: any = {};
      for (const k of Object.keys(parsed.reply_fields)) if (parsed.reply_fields[k]) rf[k] = parsed.reply_fields[k];
      if (Object.keys(rf).length) {
        const r = await fetch(`${URL_}/rest/v1/rpc/lb_email_reply_merge`, { method: "POST", headers: RPC_HEADERS, body: JSON.stringify({ p_from_email: from, p_fields: rf }) });
        const out = await r.json().catch(() => null);
        if (out && out.merged) return json({ ok: true, intent: "reply_details", merge: out });
      }
    }

    const realLoads = (parsed.loads || []).filter((L: any) => L.origin || L.destination);
    if (parsed.intent !== "loads" || realLoads.length === 0) {
      if (parsed.intent === "spam") return json({ ok: true, intent: "spam", action: "dropped" });
      await fetch(`${URL_}/rest/v1/rpc/cc_mail_ingest`, { method: "POST", headers: RPC_HEADERS, body: JSON.stringify({ p: { from_email: from, from_name: parsed.broker?.contact_name || "", to_email: "loads@loadboot.com", subject: "[loads@ " + parsed.intent + "] " + subject, body_text: text, body_html: "", message_id: "", in_reply_to: "" } }) });
      return json({ ok: true, intent: parsed.intent, action: "routed_to_mailbox" });
    }

    const results: any[] = [];
    for (const L of realLoads.slice(0, 10)) {
      if (L.origin && L.destination) {
        const a = await geocode(L.origin), d2 = await geocode(L.destination);
        if (a) { L.olng = String(a[0]); L.olat = String(a[1]); }
        if (d2) { L.dlng = String(d2[0]); L.dlat = String(d2[1]); }
        if (!L.miles && a && d2) {
          try {
            const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${d2[0]},${d2[1]}?overview=false`);
            const dd = await r.json(); const m = dd?.routes?.[0]?.distance;
            if (m) { L.miles = String(Math.round(m / 1609.34)); L.miles_source = "auto_osrm"; }
          } catch { /* noop */ }
          if (!L.miles) {
            const rad = (x: number) => x * Math.PI / 180;
            const h = Math.sin(rad(d2[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(d2[1])) * Math.sin(rad(d2[0] - a[0]) / 2) ** 2;
            L.miles = String(Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) / 1.60934 * 1.2)); L.miles_source = "auto_estimate";
          }
        }
      }
      const r = await fetch(`${URL_}/rest/v1/rpc/lb_email_load_ingest`, { method: "POST", headers: RPC_HEADERS, body: JSON.stringify({ p: { from_email: from, subject, raw_body: text.slice(0, 4000), company: parsed.broker?.company, mc: parsed.broker?.mc, phone: parsed.broker?.phone, parsed: L } }) });
      results.push({ load: L, ingest: await r.json().catch(() => null) });
    }
    return json({ ok: true, intent: "loads", via, broker: parsed.broker, count: results.length, results });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, 500);
  }
});
