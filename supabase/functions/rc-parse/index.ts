// rc-parse — read a rate confirmation (PDF or photo) and return the booking fields (Gemini).
//
// Called by the Dispatcher Workspace when an RC file is chosen. Same convention as doc-precheck:
// the file travels inline as base64 with the caller's JWT (verify_jwt). The function writes nothing:
// the client shows the extracted fields as a PREFILL the dispatcher must verify. Every field may be
// null — "unknown" is a valid answer; the model is told never to guess.
//
// Contract in : POST { mime, data_b64 }
// Contract out: { ok, fields:{…}, confidence, warnings[], model }  |  { ok:false, error }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];  // flash-latest answered first on 28 Aug; the others returned 400/503 for inline PDFs
const MAX_BYTES = 8 * 1024 * 1024;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    broker: { type: "STRING", nullable: true, description: "Broker / freight company name on the rate confirmation" },
    broker_mc: { type: "STRING", nullable: true, description: "Broker MC number, digits only" },
    broker_rep: { type: "STRING", nullable: true },
    broker_phone: { type: "STRING", nullable: true },
    broker_email: { type: "STRING", nullable: true },
    rc_number: { type: "STRING", nullable: true, description: "Load / order / RC / reference number" },
    origin: { type: "STRING", nullable: true, description: "First pickup as 'City, ST'" },
    destination: { type: "STRING", nullable: true, description: "Final delivery as 'City, ST'" },
    pickup_at: { type: "STRING", nullable: true, description: "Pickup date-time ISO 8601 (assume the local time printed; if only a date, use 08:00)" },
    delivery_at: { type: "STRING", nullable: true, description: "Delivery date-time ISO 8601" },
    miles: { type: "NUMBER", nullable: true },
    gross: { type: "NUMBER", nullable: true, description: "Total carrier pay / line haul + fuel, the amount the CARRIER receives" },
    commodity: { type: "STRING", nullable: true },
    weight_lbs: { type: "NUMBER", nullable: true },
    equipment: { type: "STRING", nullable: true },
    stops: { type: "NUMBER", nullable: true, description: "Total number of stops including pickup and delivery" },
    notes: { type: "STRING", nullable: true, description: "Special instructions, appointment numbers, accessorial terms, detention / TONU terms — short" },
    carrier_named: { type: "STRING", nullable: true, description: "Carrier company name printed on the RC, if any" },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    warnings: { type: "ARRAY", items: { type: "STRING" }, description: "Anything a dispatcher must double-check: unclear rate, missing dates, hand-written edits, multiple rates, unreadable scan" },
  },
  required: ["confidence", "warnings"],
};

const PROMPT = `You are reading a US trucking RATE CONFIRMATION (broker → carrier). Extract the booking fields exactly as printed.
Rules:
- Never guess. If a field is not clearly printed, return null and add a warning.
- gross = the TOTAL the carrier is paid (line haul + fuel surcharge + accessorials listed as included). If several amounts appear, prefer the one labelled total / carrier pay / rate and warn.
- origin/destination as "City, ST" (two-letter state). Multi-stop: origin = first pickup, destination = last delivery, and set stops.
- Dates: ISO 8601 without timezone conversion (write the printed local time). Appointment windows: use the window start.
- broker_mc digits only. Phone as printed.
- confidence: high only when broker, gross, origin, destination and pickup date are all clearly printed.`;

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type", ...extra } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(204, null);
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
  const GEMINI = Deno.env.get("GEMINI_API_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return json(401, { ok: false, error: "sign in first" });
  if (!GEMINI) return json(503, { ok: false, error: "RC reader is not configured (no model key)" });

  // 1) the file comes inline (same convention as doc-precheck): { mime, data_b64 } ≤ 8 MB
  let mime = "", b64 = "";
  try { const b = await req.json(); mime = String(b?.mime ?? ""); b64 = String(b?.data_b64 ?? ""); } catch { /* empty */ }
  if (!b64) return json(400, { ok: false, error: "data_b64 required" });
  if (b64.length > MAX_BYTES * 4 / 3) return json(413, { ok: false, error: "file too large for the reader (8 MB max)" });
  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  const useMime = allowed.includes(mime) ? mime : "application/pdf";

  // 2) Gemini, schema-constrained, thinking off (see lc-brain gotcha #1)
  let lastErr = ""; const errs: string[] = [];
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body: Record<string, unknown> = {
          contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType: useMime, data: b64 } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
        };
        if (attempt === 1) delete (body.generationConfig as Record<string, unknown>).thinkingConfig;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        if (!res.ok) {
          let msg = ""; try { const j = await res.json(); msg = String(j?.error?.message ?? "").slice(0, 160); } catch { /* */ }
          errs.push(model + ":" + res.status + (msg ? " " + msg : "")); lastErr = model + ":" + res.status;
          if (res.status === 400 && attempt === 0) continue;               // retry once without thinkingConfig
          if (res.status === 503 || res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); continue; }
          break;
        }
        const data = await res.json();
        const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } } }
        if (!parsed) { lastErr = model + ":empty"; break; }
        const { confidence, warnings, ...fields } = parsed;
        // normalise
        const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
        const str = (v: unknown) => (v == null ? null : String(v).trim() || null);
        const out = {
          broker: str(fields.broker), broker_mc: str(fields.broker_mc)?.replace(/\D/g, "") || null, broker_rep: str(fields.broker_rep), broker_phone: str(fields.broker_phone), broker_email: str(fields.broker_email),
          rc_number: str(fields.rc_number), origin: str(fields.origin), destination: str(fields.destination), pickup_at: str(fields.pickup_at), delivery_at: str(fields.delivery_at),
          miles: num(fields.miles), gross: num(fields.gross), commodity: str(fields.commodity), weight_lbs: num(fields.weight_lbs), equipment: str(fields.equipment), stops: num(fields.stops),
          notes: str(fields.notes), carrier_named: str(fields.carrier_named),
        };
        return json(200, { ok: true, fields: out, confidence: confidence ?? "low", warnings: Array.isArray(warnings) ? warnings : [], model });
      } catch (e) { lastErr = model + ":" + ((e as Error).message || "error"); break; }
    }
  }
  return json(502, { ok: false, error: "could not read the RC right now (" + lastErr + ") — fill the form by hand", errors: errs });
});
