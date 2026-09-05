// load-mail v8 — v7 + Authorization: Bearer <service role> on the three lb_email_* RPC calls.
// v7 sent `apikey` only; bl_sec_0320 (audit F01) makes those RPCs service-role-only, so the
// Bearer header is now REQUIRED (cc_mail_ingest already carried it). No other change.
// Source was not in the repo before 2026-09-05 (v7 lived only in the Supabase deploy) — this
// file is the canonical copy from now on. Deploy order on prod: v8 FIRST, then bl_sec_0320.
// v7 — v6 + BOOKING-CONFIRM reply path (broker replies to booking-ping → confirms/declines the hold).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];
let WM: string | null = null;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
async function gem(key: string, prompt: string): Promise<{ text: string | null; err: string }> {
  const tryM = WM ? [WM, ...MODELS.filter((m) => m !== WM)] : MODELS;
  let err = "";
  for (const m of tryM) {
    try {
      const cfg: any = { temperature: 0, maxOutputTokens: 4000, responseMimeType: "application/json" };
      if (m.startsWith("gemini-2.5")) cfg.thinkingConfig = { thinkingBudget: 0 };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg }) });
      if (r.ok) { WM = m; const d = await r.json(); return { text: d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? null, err: String(d?.candidates?.[0]?.finishReason || "") }; }
      err = m + ":" + r.status;
      if (r.status !== 404 && r.status !== 429 && r.status !== 400) return { text: null, err };
    } catch (e) { err = String(e).slice(0, 100); }
  }
  return { text: null, err };
}
async function geocode(place: string): Promise<[number, number] | null> {
  try { const r = await fetch("https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(place + ", USA")); const d = await r.json(); const c = d?.features?.[0]?.geometry?.coordinates; return Array.isArray(c) ? [c[0], c[1]] : null; } catch { return null; }
}
Deno.serve(async (req) => {
  try {
    const KEY = Deno.env.get("GEMINI_API_KEY") || "";
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // v8: every RPC call carries the service-role JWT (bl_sec_0320 refuses anything else).
    const RPC_HEADERS = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
    const b = await req.json().catch(() => ({}));
    const from = String(b.from || ""), subject = String(b.subject || ""), text = String(b.text || "").slice(0, 8000);
    if (!from || !text) return json({ error: "need from + text" }, 400);
    if (!KEY) return json({ error: "no_gemini_key" }, 500);
    const prompt = `You are the inbox brain for loads@loadboot.com (US trucking platform). Classify this email and extract data. Respond ONLY minified JSON:\n{"intent":"loads"|"reply_details"|"booking_confirm"|"question"|"interest"|"unsubscribe"|"spam"|"other","broker":{"company":string|null,"mc":string|null,"phone":string|null,"contact_name":string|null},"reply_fields":{"rate":string|null,"pickup_date":string|null,"equipment":string|null,"weight":string|null,"origin":string|null,"destination":string|null}|null,"confirm_fields":{"pickup_address":string|null,"delivery_address":string|null,"reference":string|null,"contact_phone":string|null,"note":string|null,"declined":"yes"|null}|null,"loads":[{"origin":string|null,"origin_address":string|null,"destination":string|null,"destination_address":string|null,"equipment":string|null,"weight":string|null,"commodity":string|null,"rate":string|null,"rate_type":"all-in"|"per-mile"|null,"miles":string|null,"pickup_date":string|null,"pickup_time":string|null,"delivery_date":string|null,"delivery_time":string|null,"requirements":string|null,"temp":string|null,"hazmat":"yes"|null,"reference":string|null,"contact_name":string|null,"contact_phone":string|null,"notes":string|null}]}\nRules: intent="loads" ONLY if the email offers full freight loads. intent="booking_confirm" when the email is a reply CONFIRMING (or declining) a booking / that a load is still available — e.g. \"Confirmed\", \"yes still open, pickup at 123 Dock St\", \"sorry, it's covered\" — put the pickup/delivery address and details in confirm_fields (declined=\"yes\" if the load is gone/covered). intent="reply_details" when it is a SHORT reply supplying missing detail(s) for an earlier load (e.g. \"rate is $2,100\", \"pickup Tuesday 9am\") — put those values in reply_fields. Greetings/questions/marketing = their own intent. Never invent anything. origin/destination \"City, ST\"; equipment normalized (Dry Van/Reefer/Flatbed/Step Deck/Hotshot/Power Only/Box Truck); \"TBD\"/\"call\" = null.\n---EMAIL---\nFROM: ${from}\nSUBJECT: ${subject}\n${text}`;
    const g = await gem(KEY, prompt);
    let parsed: any = null;
    if (g.text) { try { parsed = JSON.parse(g.text.replace(/```json|```/g, "").trim()); } catch { /* noop */ } }
    if (!parsed) return json({ error: "parse_failed", detail: g.err }, 502);

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
    return json({ ok: true, intent: "loads", broker: parsed.broker, count: results.length, results });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, 500);
  }
});
