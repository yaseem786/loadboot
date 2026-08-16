// lc-brain — LoadBoot live-chat AI brain (Gemini).
//
// Called by Postgres via pg_net from app_private.lc_brain_dispatch(). Postgres builds the whole
// context (conversation history + retrieved KB facts) and mints a one-time token; this function only
// talks to Gemini and posts the answer back through the public RPC lc_brain_write(token, …).
// It never needs the service-role key and cannot write anywhere else.
//
// Contract in : { token, model, question, context: {lang, role, name, has_email, history[], facts[]},
//                fallback }   fallback = the keyword-KB answer, used if Gemini is unavailable.
// Contract out: RPC lc_brain_write(p_token, p_reply, p_escalate, p_source)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-flash-latest",
];

const FACTS = `LOADBOOT — WHAT IS TRUE (never contradict this):
• LoadBoot is a US trucking dispatch service + load board. Four sides: carriers, brokers, shippers, referral partners.
• Carriers: flat 5% of gross, charged ONLY on loads LoadBoot books that actually get paid. Free to join. No contract, no minimum, cancel anytime. NO forced dispatch — the carrier sees rate, miles, deadhead and stops and approves before anything is booked.
• Carrier verification: active MC/DOT authority, certificate of insurance (auto liability + cargo), W-9, signed dispatch agreement. Uploaded and signed in the portal, usually about a day.
• Brokers and shippers post loads FREE, forever. Carriers on the board are FMCSA-verified. Shippers can post direct to carriers with no broker margin on top.
• Referral Partner program: 1% of the gross the accounts you refer generate, paid out of LoadBoot's own fee — the referred party never pays extra.
• LoadBoot NEVER touches freight money. The broker pays the carrier (or the carrier's factoring company) directly; LoadBoot invoices its 5% separately, after the carrier has been paid. Factoring: upload the NOA once and payments route to the factor.
• Accessorial standards: detention $60/hr after 2 hours free time; TONU $250; layover $250/day; lumper reimbursed 100% with receipt or paid direct by the broker; driver assist typically $75 agreed in writing first; FCFS still starts the detention clock at check-in.
• Every load gets live GPS tracking with geofenced arrive/depart timestamps.
• Compliance line that matters: a dispatcher works FOR the carrier and books under the carrier's own authority. Taking a load you do not own and keeping a margin for arranging the move is brokering — that requires your own broker authority (MC) plus a $75,000 BMC-84 surety bond (49 CFR 371.2). LoadBoot cannot let anyone earn a per-load margin without it.
• Contact: +1 (469) 253-7575 (24/7), hello@loadboot.com, dispatch@loadboot.com, loadboot.com`;

const RULES = `HOW TO ANSWER:
• Be short and concrete. Under 110 words unless the question genuinely needs more. Plain sentences, no salesy padding, no bullet-point walls.
• Answer in the visitor's language. If context.lang is "es", answer in Spanish.
• You may use simple HTML <b> and <i>. You may end with ONE chip line in exactly this format, nothing after it:
  [[chips:Label=text the visitor would send|Label2=other text]]
• Ask at most one question per reply.

NEVER DO THIS (these are hard rules, not preferences):
• Never invent or estimate a number we have not been given: no carrier counts, truck counts, driver counts, load volumes, customer counts, years in business, review scores, percentages of anything. If asked "how many carriers/drivers/trucks do you have", say you will not invent a number, and ask for their lane and equipment so a human can answer straight. This is a standing instruction from the owner.
• Never promise that a load will be covered, or by when. Never quote a market rate or rate-per-mile from memory — rates come from the live board only.
• Never give legal, tax or financial advice beyond the compliance facts stated above.
• Never ask for a password, card number, bank details or any government ID.
• Never claim a feature exists if it is not in the facts or the retrieved snippets.
• Do not repeat an answer the visitor has already been given in the history — if you have nothing new, escalate instead.

WHEN TO ESCALATE (set escalate = true and keep reply to one or two sentences):
• You are not confident, or the facts above do not cover it.
• The visitor is frustrated, says you got it wrong, or asks for a human.
• They want a decision only a person can make: a specific rate, whether we can cover their lane, an account or payment problem, anything about their own money.

Reply with JSON only: {"reply": "...", "escalate": true|false}`;

async function askGemini(key: string, prompt: string, preferred?: string) {
  const chain = preferred && !MODELS.includes(preferred) ? [preferred, ...MODELS] : MODELS;
  let lastErr = "";
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 700,
                responseMimeType: "application/json",
              },
              safetySettings: [],
            }),
          },
        );
        if (res.status === 404 || res.status === 429 || res.status >= 500) {
          lastErr = `${model}:${res.status}`;
          break; // next model
        }
        if (!res.ok) {
          lastErr = `${model}:${res.status}:${(await res.text()).slice(0, 200)}`;
          break;
        }
        const j = await res.json();
        const txt = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
        if (!txt.trim()) { lastErr = `${model}:empty`; continue; }
        return { txt, model };
      } catch (e) {
        lastErr = `${model}:${String(e).slice(0, 120)}`;
      }
    }
  }
  throw new Error(lastErr || "all models failed");
}

function sanitize(reply: string): string {
  let r = String(reply || "").trim();
  // one chip line at most, and never a form/callform marker invented by the model
  r = r.replace(/\[\[form[^\]]*\]\]/gi, "").replace(/\[\[callform\]\]/gi, "").replace(/\[\[note\]\]/gi, "");
  const chips = r.match(/\[\[chips:[\s\S]*?\]\]/);
  r = r.replace(/\[\[chips:[\s\S]*?\]\]/g, "").trim();
  if (chips) r = r + "\n\n" + chips[0];
  if (r.length > 1800) r = r.slice(0, 1800);
  return r.trim();
}

Deno.serve(async (req: Request) => {
  const ok = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { return ok({ error: "bad json" }, 400); }

  const token = body?.token;
  if (!token) return ok({ error: "no token" }, 400);

  const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const GEMINI = Deno.env.get("GEMINI_API_KEY") ?? "";

  const write = async (reply: string, escalate: boolean, source: string) => {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/lc_brain_write`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
      body: JSON.stringify({ p_token: token, p_reply: reply, p_escalate: escalate, p_source: source }),
    });
    return { status: res.status, text: (await res.text()).slice(0, 300) };
  };

  const fallback = typeof body?.fallback === "string" ? body.fallback : "";

  // No Gemini key configured -> hand straight back to the keyword answer, or escalate.
  if (!GEMINI) {
    const w = await write(fallback, !fallback, "no-key");
    return ok({ ok: true, path: "no-key", write: w });
  }

  const ctx = body?.context ?? {};
  const history = Array.isArray(ctx.history) ? ctx.history : [];
  const facts = Array.isArray(ctx.facts) ? ctx.facts : [];

  const prompt = [
    "You are Riley, the LoadBoot assistant in the website/portal live chat. You are talking to one visitor.",
    "",
    FACTS,
    "",
    facts.length
      ? "RETRIEVED SNIPPETS FROM OUR OWN KNOWLEDGE BASE (highest authority — prefer these wordings):\n" +
        facts.map((f: string, i: number) => `[${i + 1}] ${f}`).join("\n---\n")
      : "(no knowledge-base snippet matched this question)",
    "",
    RULES,
    "",
    `VISITOR: role=${ctx.role ?? "unknown"}, name=${ctx.name ?? "unknown"}, ` +
      `contact_on_file=${ctx.has_email ? "yes" : "no"}, language=${ctx.lang ?? "en"}, page=${ctx.page ?? "-"}`,
    "",
    "CONVERSATION SO FAR (oldest first):",
    history.length
      ? history.map((m: any) => `${m.who}: ${String(m.body ?? "").slice(0, 900)}`).join("\n")
      : "(this is the first message)",
    "",
    `NEW MESSAGE FROM VISITOR: ${String(body?.question ?? "").slice(0, 2000)}`,
    "",
    'Respond with JSON only: {"reply": "...", "escalate": true|false}',
  ].join("\n");

  try {
    const { txt, model } = await askGemini(GEMINI, prompt, body?.model);
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch {
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    }
    const reply = sanitize(parsed?.reply ?? "");
    const escalate = parsed?.escalate === true || !reply;
    const w = await write(reply, escalate, `gemini:${model}`);
    return ok({ ok: true, path: "gemini", model, escalate, write: w });
  } catch (e) {
    // Gemini down / quota: fall back to the keyword answer we were handed, else escalate.
    const w = await write(fallback, !fallback, "fallback:" + String(e).slice(0, 80));
    return ok({ ok: true, path: "fallback", error: String(e).slice(0, 200), write: w });
  }
});
