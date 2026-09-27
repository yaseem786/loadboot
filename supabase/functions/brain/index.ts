// brain — LoadBoot Ops Brain, edge side. v1 (bl_brain_0470)
//
// Called by Postgres via pg_net from app_private.brain_enqueue(). Postgres builds the WHOLE prompt (frozen rules +
// facts + KB as the cached system block, the volatile context as the user turn), mints a one-time job token and
// names the tools this job may use. This function only talks to Anthropic and writes back through ONE RPC,
// public.brain_rpc(token, op, payload), which is service_role-only and scoped to that job. Tools are executed by
// Postgres inside brain_rpc('tool'), never here.
//
// Model: claude-fable-5-1 (plan §0). Thinking is always on for Fable — the `thinking` param is omitted; depth is
// output_config.effort per route. Refusal fallbacks on (`fallbacks: "default"`). System block cached 1h. Every
// response's usage is written to brain_jobs / brain_usage_daily by brain_rpc('done').
//
// The HTTP reply to Postgres is 202 straight away; the job itself runs in EdgeRuntime.waitUntil so pg_net's timeout
// never cuts a long tool loop. Pass {"sync": true} (manual curl) to wait for the summary instead.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// Client tools. Stable order + identical JSON on every call, or the prompt cache misses (tools render before system).
const TOOL_DEFS: Record<string, any> = {
  kb_search: {
    name: "kb_search",
    description: "Search LoadBoot's own approved knowledge base for an answer. Use before saying you do not know.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["query"],
      properties: { query: { type: "string", description: "What the person is asking, in a few words" } } },
  },
  get_facts: {
    name: "get_facts",
    description: "Return the full LoadBoot facts registry (fees, verification, accessorial standards, contact line).",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  account_lookup: {
    name: "account_lookup",
    description: "Return the signed-in person's own account file (compliance documents with review notes, trucks, payment setup). Only the account attached to this job.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  note: {
    name: "note",
    description: "Leave an internal note for staff on this job. Not shown to the customer.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["text"],
      properties: { text: { type: "string" } } },
  },
  escalate: {
    name: "escalate",
    description: "Hand this to a person: money, legal, partnership, press, an angry customer, or anything the facts do not cover. Give a one-line reason, a summary and a suggested reply.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["reason", "summary", "suggested_reply"],
      properties: { reason: { type: "string" }, summary: { type: "string" }, suggested_reply: { type: "string" } } },
  },
  report_finding: {
    name: "report_finding",
    description: "File something the owner should act on: a bug you hit, a knowledge-base gap (a question we could not answer well), a portal improvement, or a growth / SEO / ads idea. Include evidence and a concrete suggested fix.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["kind", "title", "detail", "suggested_fix"],
      properties: {
        kind: { type: "string", enum: ["bug", "kb_gap", "portal", "growth", "seo", "ads", "process"] },
        surface: { type: "string", description: "Where: live chat, carrier portal, CC mailbox, website page, email …" },
        title: { type: "string" },
        detail: { type: "string" },
        suggested_fix: { type: "string" },
      } },
  },
};

// The reply contract (plan §2). Enforced by structured outputs; parsed leniently as a fallback.
const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["reply", "lang", "confidence", "escalate", "escalate_reason", "actions"],
  properties: {
    reply: { type: "string" },
    lang: { type: "string", enum: ["en", "es"] },
    confidence: { type: "number" },
    escalate: { type: "boolean" },
    escalate_reason: { type: "string" },
    actions: { type: "array", items: { type: "string" } },
  },
};

type Usage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; output_tokens: number };

async function rpc(token: string, op: string, payload: unknown) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/brain_rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
    body: JSON.stringify({ p_token: token, p_op: op, p_payload: payload ?? {} }),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: { raw: text.slice(0, 300) } }; }
}

function parseResult(txt: string): any {
  const shape = (j: any) => j && typeof j === "object" && typeof j.reply === "string"
    ? { reply: j.reply, lang: j.lang === "es" ? "es" : "en", confidence: Number.isFinite(+j.confidence) ? Math.max(0, Math.min(1, +j.confidence)) : 0.5,
        escalate: j.escalate === true, escalate_reason: typeof j.escalate_reason === "string" ? j.escalate_reason : "",
        actions: Array.isArray(j.actions) ? j.actions.map(String).slice(0, 20) : [] }
    : null;
  try { const r = shape(JSON.parse(txt)); if (r) return r; } catch { /* next */ }
  const block = txt.match(/\{[\s\S]*\}/);
  if (block) { try { const r = shape(JSON.parse(block[0])); if (r) return r; } catch { /* next */ } }
  const bare = txt.trim();
  return bare && !bare.startsWith("{")
    ? { reply: bare.slice(0, 1800), lang: "en", confidence: 0.4, escalate: false, escalate_reason: "", actions: ["unstructured"] }
    : { reply: "", lang: "en", confidence: 0, escalate: true, escalate_reason: "empty or unparseable model output", actions: [] };
}

async function runJob(body: any) {
  const token: string = body.token;
  const usage: Usage = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
  let iterations = 0; let servedModel: string = body.model;
  const fail = async (error: string) => {
    const w = await rpc(token, "fail", { error, usage, iterations, model: servedModel });
    return { ok: false, path: "fail", error, write: w.body };
  };

  if (!API_KEY) return await fail("ANTHROPIC_API_KEY is not set in this project's secrets");
  const started = await rpc(token, "start", {});
  if (!started.body?.ok) return { ok: false, path: "no-start", write: started.body };

  const client = new Anthropic({ apiKey: API_KEY, maxRetries: 2, timeout: 180_000 });
  const model: string = body.model || "claude-fable-5-1";
  const effort: string = body.effort || "medium";
  const maxTokens: number = Number(body.max_tokens) || 16000;
  const maxToolCalls: number = Number(body.max_tool_calls) || 8;
  const toolNames: string[] = Array.isArray(body.tools) ? body.tools : [];
  const tools = Object.keys(TOOL_DEFS).filter((n) => toolNames.includes(n)).map((n) => TOOL_DEFS[n]);

  const sysIn: any[] = Array.isArray(body.system) ? body.system : [];
  const system = sysIn.map((b: any) => b.cache
    ? { type: "text", text: String(b.text ?? ""), cache_control: { type: "ephemeral", ttl: "1h" } }
    : { type: "text", text: String(b.text ?? "") });

  const messages: any[] = [{ role: "user", content: String(body.user ?? "") }];
  let useFormat = true; let toolCalls = 0; let last: any = null;

  try {
    for (;;) {
      iterations++;
      const req: any = {
        model, max_tokens: maxTokens, system, messages,
        tools: tools.length ? tools : undefined,
        output_config: useFormat ? { effort, format: { type: "json_schema", schema: OUTPUT_SCHEMA } } : { effort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      };
      let res: any;
      try {
        res = await client.beta.messages.create(req);
      } catch (e: any) {
        // Structured output + tools rejected by this account/model? Retry once without the format and parse leniently.
        if (useFormat && e instanceof Anthropic.BadRequestError && /output_config|format|json_schema/i.test(String(e.message))) {
          useFormat = false; iterations--; continue;
        }
        throw e;
      }
      last = res;
      servedModel = res.model ?? servedModel;
      const u = res.usage ?? {};
      usage.input_tokens += u.input_tokens ?? 0;
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
      usage.output_tokens += u.output_tokens ?? 0;

      if (res.stop_reason === "refusal") {
        const cat = res.stop_details?.category ?? "unknown";
        const result = { reply: String(body.fallback ?? ""), lang: body.lang === "es" ? "es" : "en", confidence: 0, escalate: true,
          escalate_reason: `model refusal (${cat})`, actions: ["refusal"] };
        const w = await rpc(token, "done", { result, usage, iterations, model: servedModel, path: "refusal" });
        return { ok: true, path: "refusal", category: cat, write: w.body };
      }

      const toolUses = (res.content ?? []).filter((b: any) => b.type === "tool_use");
      if (res.stop_reason === "tool_use" && toolUses.length) {
        // Append the assistant turn unchanged (thinking blocks included — append-only history), then ALL results in ONE user turn.
        messages.push({ role: "assistant", content: res.content });
        const results: any[] = [];
        for (const tu of toolUses) {
          toolCalls++;
          let out: any;
          if (toolCalls > maxToolCalls) out = { error: "tool budget for this job is spent; answer now with what you have" };
          else { const w = await rpc(token, "tool", { name: tu.name, input: tu.input, id: tu.id }); out = w.body?.result ?? w.body; }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 12000), is_error: !!(out && out.error) });
        }
        messages.push({ role: "user", content: results });
        if (toolCalls > maxToolCalls + 4) throw new Error("tool loop did not converge");
        continue;
      }

      const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      const result = parseResult(text);
      if (res.stop_reason === "max_tokens") { result.escalate = true; result.escalate_reason = result.escalate_reason || "max_tokens"; }
      if (result.confidence < 0.6 && !result.escalate) { result.escalate = true; result.escalate_reason = result.escalate_reason || `low confidence ${result.confidence}`; }
      const fallbackRan = Array.isArray(res.usage?.iterations) && res.usage.iterations.some((it: any) => it?.type === "fallback_message");
      const w = await rpc(token, "done", { result, usage, iterations, model: servedModel, path: fallbackRan ? "fallback-model" : "primary" });
      return { ok: true, path: "done", model: servedModel, stop: res.stop_reason, tool_calls: toolCalls, usage, write: w.body };
    }
  } catch (e: any) {
    const msg = e instanceof Anthropic.APIError ? `${e.name} ${e.status ?? ""}: ${e.message}` : String(e);
    return await fail(msg.slice(0, 500) + (last?.id ? ` (last msg ${last.id})` : ""));
  }
}

Deno.serve(async (req: Request) => {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!body?.token) return json({ error: "no token" }, 400);
  if (!SB_SERVICE) return json({ error: "SUPABASE_SERVICE_ROLE_KEY missing in runtime" }, 500);

  if (body.sync === true) return json(await runJob(body));
  const p = runJob(body).catch((e) => console.error("brain job crashed", String(e)));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p); else await p;
  return json({ accepted: true, job_id: body.job_id ?? null, key: !!API_KEY }, 202);
});
