import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ai-assist — staff-only AI helper backed by Google Gemini (GEMINI_API_KEY secret).
// Tasks: support_reply, price_lane, match_explain, summarize, draft (free prompt).
// Verifies the caller is active staff before doing anything. Returns plain text.
// Deployed to staging + production via Supabase MCP. verify_jwt = true.

const MODEL = "gemini-1.5-flash";
const GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(o: unknown, s = 200): Response { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...cors } }); }

async function isStaff(auth: string, url: string, anon: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/rest/v1/rpc/get_my_staff_context`, { method: "POST", headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return false; const d = await r.json(); return !!(d && d.is_staff);
  } catch { return false; }
}

function buildPrompt(task: string, c: Record<string, any>): string {
  const brand = "You are an assistant for LoadBoot, a flat-5% truck dispatching service. Be concise, professional and accurate. Never invent facts, prices or policies.";
  switch (task) {
    case "support_reply":
      return `${brand}\nDraft a friendly, helpful reply to this customer/carrier support ticket. Keep it under 120 words and sign off as "LoadBoot Support".\nSubject: ${c.subject || ""}\nMessage: ${c.body || ""}\nReply:`;
    case "price_lane":
      return `${brand}\nSuggest a fair dispatch rate RANGE (low–high USD) for this lane and explain in 2 short sentences. Note it is an estimate, not a quote.\nOrigin: ${c.origin || ""}\nDestination: ${c.destination || ""}\nEquipment: ${c.equipment || ""}\nMiles: ${c.miles || "unknown"}\nAnswer:`;
    case "match_explain":
      return `${brand}\nGiven this load and candidate carriers, rank the top matches and justify each in one line.\nLoad: ${JSON.stringify(c.load || {})}\nCarriers: ${JSON.stringify(c.carriers || [])}\nAnswer:`;
    case "summarize":
      return `${brand}\nSummarize the following in 3 short bullet points.\n${c.text || ""}`;
    default:
      return `${brand}\n${c.prompt || c.text || ""}`;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "GEMINI_API_KEY is not configured in this project's secrets." }, 500);
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "missing authorization" }, 401);
    const URL_ = Deno.env.get("SUPABASE_URL") ?? ""; const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!(await isStaff(auth, URL_, ANON))) return json({ error: "staff access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const task = String(body.task || "draft");
    const prompt = buildPrompt(task, body);
    if (!prompt.trim()) return json({ error: "nothing to do" }, 400);

    const r = await fetch(`${GEMINI}?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 512 } }),
    });
    if (!r.ok) { const t = await r.text(); return json({ error: `Gemini error (HTTP ${r.status})`, detail: t.slice(0, 300) }, 502); }
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    return json({ ok: true, task, text: text.trim() });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
