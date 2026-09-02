// lc-brain — LoadBoot live-chat AI brain (Gemini). v4
//
// Called by Postgres via pg_net from app_private.lc_brain_dispatch(). Postgres builds the whole
// context and mints a one-time token; this function only talks to Gemini and posts the answer back
// through the public RPC lc_brain_write(token, …). It never gets a service key and can only write to
// the one conversation the token was minted for.
//
// v2: thinkingBudget 0 + maxOutputTokens 2048 — 2.5-flash was spending the whole budget on internal
//     thinking and returning empty parts, so every answer escalated. Retry once per model on 503/429.
// v3: NEVER lose a good answer to a JSON error. responseSchema makes Gemini emit schema-valid JSON,
//     and extractReply() degrades through four stages: strict parse -> first {...} block -> regex
//     repair of the "reply" value -> treat the whole text as prose.
// v4 (bl_lc_0312): SIGNED-IN ACCOUNT block — Postgres now sends ctx.account (compliance rows with
//     review notes, trucks, payment setup) for portal users, so "my COI got rejected, why?" is answered
//     from their real file, not the KB. ctx.staff_online tells the model whether a human is actually
//     at the desk, so it never promises a person who is not there. The fallback passed by Postgres is
//     now exact-phrase-only (lc_bot_answer_l2 ≥ 2.0); when it is empty and Gemini fails, the write
//     escalates honestly instead of sending a fuzzy keyword answer.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
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
• Hiring: there are two doors — salaried dispatcher roles (see loadboot.com/careers.html, CV to hello@loadboot.com with "Dispatcher application" in the subject) and the Referral Partner program (1%, not a job). Never quote a salary figure that is not published on the careers page. Never promise anyone work, or work by a date.
• Portal pages a signed-in carrier can open: Documents (https://loadboot.com/app/carrier/#documents — upload COI, authority, W-9, sign the dispatch agreement), Fleet (https://loadboot.com/app/carrier/#fleet — trucks with VIN, drivers), Account → Payments (https://loadboot.com/app/carrier/#account/payments — bank or factoring + NOA), Load Board (https://loadboot.com/app/carrier/#loads). A truck can only be posted if its VIN is on the certificate of insurance (error LB001) and saved under Fleet (LB002).
• Contact: +1 (469) 253-7575 (24/7), hello@loadboot.com, dispatch@loadboot.com, loadboot.com`;

const RULES = `HOW TO ANSWER:
• Default to ANSWERING. Anything covered by the facts above, the retrieved snippets, or the SIGNED-IN ACCOUNT block, you answer yourself — pricing, the 5% fee, contracts, forced dispatch, verification and documents, factoring, detention and accessorials, GPS, who posts free, the referral program, the brokering/authority rule, how to apply. Escalating those is a failure.
• If a SIGNED-IN ACCOUNT block is present, it is THEIR real file and it is authoritative: answer "my"/"me" questions from it — which document is rejected, missing or pending and WHY (quote the review note), whether their truck has a VIN on file, whether payments are set up. Point to the exact portal page. Never guess anything about their account that is not in the block.
• staff_online=false means nobody is at the desk right now. Never say a person is available or "will reply in a moment"; say the team follows up (email/here) and offer the 24/7 phone line. staff_online=true means a human can be pulled in right now.
• Be short and concrete. Under 110 words unless the question genuinely needs more. Plain sentences, no salesy padding.
• Answer in the visitor's language. If the language is "es", answer in Spanish.
• You may use simple HTML <b> and <i>. You may end with ONE chip line in exactly this format and nothing after it:
  [[chips:Label=text the visitor would send|Label2=other text]]
• Ask at most one question per reply.

NEVER DO THIS (hard rules, not preferences):
• Never invent or estimate a number we have not been given: no carrier counts, truck counts, driver counts, load volumes, customer counts, years in business, review scores, salary figures. If asked "how many carriers/drivers/trucks do you have", say plainly that you will not invent a number, and ask for their lane and equipment so a human can answer straight. This is a standing instruction from the owner.
• Never promise that a load will be covered, or by when. Never promise a job or a start date. Never quote a market rate or rate-per-mile from memory — live rates come from the board only.
• Never give legal, tax or financial advice beyond the compliance facts above.
• Never ask for a password, card number, bank details or any government ID.
• Never claim a feature exists if it is not in the facts or the snippets.
• Never send the same answer the visitor already received earlier in the history — say something new or escalate.

ESCALATE (escalate = true) ONLY when:
• the facts, snippets and account block genuinely do not cover it, or
• the visitor is frustrated / says you got it wrong / asks for a human, or
• it needs a decision only a person can make: a specific rate, whether we can cover their lane today, an account or payment problem you cannot resolve from the block, anything about their own money.
When you escalate, still write one or two useful sentences in "reply" — never leave it empty, and never promise a reply time.`;

async function askGemini(key: string, prompt: string, preferred?: string) {
  const chain = preferred && !MODELS.includes(preferred) ? [preferred, ...MODELS] : MODELS;
  const cfg = {
    temperature: 0.2,
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: { reply: { type: "STRING" }, escalate: { type: "BOOLEAN" } },
      required: ["reply", "escalate"],
    },
    thinkingConfig: { thinkingBudget: 0 },
  };
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
              generationConfig: cfg,
            }),
          },
        );
        if (res.status === 429 || res.status >= 500) {
          lastErr = `${model}:${res.status}`;
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
          break;
        }
        if (res.status === 400) {
          lastErr = `${model}:400:${(await res.text()).slice(0, 160)}`;
          if (attempt === 0) {
            const res2 = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: prompt }] }],
                  generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
                }),
              },
            );
            if (res2.ok) {
              const j2 = await res2.json();
              const t2 = j2?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
              if (t2.trim()) return { txt: t2, model, finish: j2?.candidates?.[0]?.finishReason ?? "" };
            }
          }
          break;
        }
        if (!res.ok) { lastErr = `${model}:${res.status}:${(await res.text()).slice(0, 160)}`; break; }
        const j = await res.json();
        const cand = j?.candidates?.[0];
        const txt = cand?.content?.parts?.map((p: any) => p.text).join("") ?? "";
        if (!txt.trim()) { lastErr = `${model}:empty:${cand?.finishReason ?? "?"}`; break; }
        return { txt, model, finish: cand?.finishReason ?? "" };
      } catch (e) {
        lastErr = `${model}:${String(e).slice(0, 120)}`;
      }
    }
  }
  throw new Error(lastErr || "all models failed");
}

// Four-stage rescue. Losing a correct answer to a parse error is the worst failure mode here, so we
// try progressively looser readings before giving up.
function extractReply(txt: string): { reply: string; escalate: boolean } {
  const from = (j: any) =>
    j && typeof j.reply === "string" ? { reply: j.reply, escalate: j.escalate === true } : null;
  try { const r = from(JSON.parse(txt)); if (r) return r; } catch { /* stage 2 */ }
  const block = txt.match(/\{[\s\S]*\}/);
  if (block) { try { const r = from(JSON.parse(block[0])); if (r) return r; } catch { /* stage 3 */ } }
  const m = txt.match(/"reply"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"escalate"|\}\s*$)/);
  if (m) {
    return {
      reply: m[1].replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      escalate: /"escalate"?\s*:\s*true/i.test(txt),
    };
  }
  const bare = txt.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  if (bare && !bare.startsWith("{")) return { reply: bare, escalate: false };
  return { reply: "", escalate: true };
}

function sanitize(reply: string): string {
  let r = String(reply || "").trim();
  r = r.replace(/\[\[form[^\]]*\]\]/gi, "").replace(/\[\[callform\]\]/gi, "").replace(/\[\[note\]\]/gi, "").replace(/\[\[sys\]\]/gi, "");
  const chips = r.match(/\[\[chips:[\s\S]*?\]\]/);
  r = r.replace(/\[\[chips:[\s\S]*?\]\]/g, "").trim();
  if (chips) r = r + "\n\n" + chips[0];
  if (r.length > 1800) r = r.slice(0, 1800);
  return r.trim();
}

// Compact, human-readable rendering of ctx.account so the model reads statuses, not JSON noise.
function accountBlock(acct: any): string {
  if (!acct || typeof acct !== "object") return "";
  const lines: string[] = [];
  lines.push(`Company: ${acct.org_name ?? "-"} · account status: ${acct.org_status ?? "-"} · kind: ${acct.kind ?? "-"}`);
  if (acct.kind === "carrier") {
    lines.push(`Verification: ${acct.verified ?? 0} of ${acct.total ?? 0} requirements verified.`);
    for (const c of (Array.isArray(acct.compliance) ? acct.compliance : [])) {
      lines.push(`  - ${c.name}: ${String(c.status).toUpperCase()}${c.note ? ` — review note: "${String(c.note).slice(0, 300)}"` : ""}`);
    }
    const trucks = Array.isArray(acct.trucks) ? acct.trucks : [];
    lines.push(trucks.length
      ? `Trucks (${trucks.length}): ` + trucks.map((t: any) => `unit ${t.unit ?? "?"} ${t.equipment ?? ""} [${t.status ?? "-"}, VIN ${t.vin_on_file ? "on file" : "MISSING"}]`).join("; ")
      : "Trucks: none added under Fleet yet.");
    lines.push(`Payment setup (bank or factoring): ${String(acct.payment_status ?? "missing").toUpperCase()}.`);
  }
  return lines.join("\n").slice(0, 3500);
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
    return { status: res.status, text: (await res.text()).slice(0, 200) };
  };

  const fallback = typeof body?.fallback === "string" ? body.fallback : "";
  if (!GEMINI) return ok({ ok: true, path: "no-key", write: await write(fallback, !fallback, "no-key") });

  const ctx = body?.context ?? {};
  const history = Array.isArray(ctx.history) ? ctx.history : [];
  const facts = Array.isArray(ctx.facts) ? ctx.facts : [];
  const acct = accountBlock(ctx.account);

  const prompt = [
    "You are Riley, the LoadBoot assistant in the website/portal live chat. You are talking to one visitor.",
    "", FACTS, "",
    facts.length
      ? "RETRIEVED SNIPPETS FROM OUR OWN KNOWLEDGE BASE (highest authority — prefer these wordings):\n" +
        facts.map((f: string, i: number) => `[${i + 1}] ${f}`).join("\n---\n")
      : "(no knowledge-base snippet matched this question)",
    "", RULES, "",
    `VISITOR: role=${ctx.role ?? "unknown"}, name=${ctx.name ?? "unknown"}, ` +
      `contact_on_file=${ctx.has_email ? "yes" : "no"}, language=${ctx.lang ?? "en"}, page=${ctx.page ?? "-"}, ` +
      `origin=${ctx.origin ?? "website"}, staff_online=${ctx.staff_online === true ? "true" : "false"}`,
    acct ? "\nSIGNED-IN ACCOUNT (authoritative — this is the visitor's real file):\n" + acct : "",
    "", "CONVERSATION SO FAR (oldest first):",
    history.length
      ? history.map((m: any) => `${m.who}: ${String(m.body ?? "").slice(0, 900)}`).join("\n")
      : "(this is the first message)",
    "", `NEW MESSAGE FROM VISITOR: ${String(body?.question ?? "").slice(0, 2000)}`,
  ].join("\n");

  try {
    const { txt, model, finish } = await askGemini(GEMINI, prompt, body?.model);
    const got = extractReply(txt);
    const reply = sanitize(got.reply);
    const escalate = got.escalate || !reply;
    const w = await write(reply || fallback, reply ? escalate : !fallback, `gemini:${model}`);
    return ok({
      ok: true, path: reply ? "gemini" : "gemini-empty", model, finish, escalate, len: reply.length,
      raw: reply ? undefined : String(txt).slice(0, 400), write: w,
    });
  } catch (e) {
    // Gemini is down: an exact-phrase KB answer may still go out; otherwise escalate honestly.
    const w = await write(fallback, !fallback, "fallback:" + String(e).slice(0, 90));
    return ok({ ok: true, path: "fallback", error: String(e).slice(0, 220), write: w });
  }
});
