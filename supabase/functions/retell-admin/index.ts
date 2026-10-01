import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// retell-admin v2 (bl_voice_0458, 2026-09-26) — the ONE staff-gated door from Command Center to Retell.
//
// WHY. Riley's prompts, agent wiring and phone-number mapping lived only in the Retell dashboard, and on
// 7 Sep the inbound line was left pointing at a one-off "Broker Outbound" script by hand. Postgres cannot
// reach Retell for anything but GET/POST/DELETE (pg_net has no PATCH), so this function is where the
// PATCH/publish calls happen. The Retell API key never leaves the database except into this runtime:
// public.retell_admin_config() hands it over to the service role only.
//
// AUTH. Same pattern as ai-assist: the caller's Supabase JWT is checked through get_my_staff_context, and
// on top of that the op must be allowed for their permissions (comm.manage or settings.manage to write;
// comm.view / support.view / dispatch.manage to read). No JWT, no staff, no op.
//
// OPS (POST { op, ... }):
//   status              phone-number mapping, our two agents (published version + llm version), prompt rows
//                       (0500: POST /v2/list-agents + /list-agent-versions + /get-agent?version=; GET /list-agents is gone)
//   set_phone_agents    { inbound_agent_id?, outbound_agent_id? }  -> PATCH update-phone-number  (write)
//   get_llm             { key }  -> the live retell-llm draft for the inbound|outbound agent (read)
//   publish             { key }  -> read app_private.riley_prompts[key], PATCH the retell-llm draft, point the
//                                   agent draft at that llm version + shared post-call analysis, publish the
//                                   agent, mark the row published. (write)
//                                   0522: outbound also gets press_digit, and ivr_option + voicemail_option cleared.
//   get_call            { call_id } -> GET v2/get-call (fresh recording_url + transcript + analysis) (read)
//   recording           { call_id } -> the recording BYTES (read). v2 (0458d): Retell serves recordings from CloudFront as
//                                   application/octet-stream with no CORS headers, which Safari/iOS will not play in an
//                                   <audio src>; the browser gets the bytes from here instead (same shape as telnyx-recording:
//                                   octet-stream so functions.invoke() hands back a Blob, X-Audio-Type says what it is).
//
// Deployed to staging + production via Supabase MCP. verify_jwt = true.

const RETELL = "https://api.retellai.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lb-app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(o: unknown, s = 200): Response {
  return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...cors } });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Staff = { is_staff: boolean; permissions?: string[] } | null;

async function staffContext(auth: string): Promise<Staff> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_staff_context`, {
      method: "POST", headers: { Authorization: auth, apikey: ANON, "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.is_staff ? d : null;
  } catch { return null; }
}
function hasAny(s: Staff, perms: string[]): boolean {
  const p: string[] = (s && Array.isArray(s.permissions)) ? s.permissions : [];
  return p.includes("*") || perms.some((x) => p.includes(x));
}

async function svcRpc(name: string, body: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  let b: any = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  return { ok: r.ok, status: r.status, body: b };
}

type Cfg = { api_key: string; from_number: string; outbound_from_number: string | null; inbound_agent_id: string | null; outbound_agent_id: string | null; escalation_number: string | null };

async function retell(cfg: Cfg, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${RETELL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.api_key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let b: any = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  return { ok: r.ok, status: r.status, body: b };
}

// bl_voice_0500: Retell removed GET /list-agents on 31 Jul 2026. Its v2 list endpoints (/v2/list-agents,
// /list-agent-versions) return { items, has_more, pagination_key }; this walks every page. ok=false if any page fails.
async function retellAll(cfg: Cfg, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; items: any[] }> {
  const items: any[] = [];
  let key: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = `limit=1000${key ? `&pagination_key=${encodeURIComponent(key)}` : ""}`;
    const r = await retell(cfg, method, `${path}${path.includes("?") ? "&" : "?"}${q}`, body);
    if (!r.ok || !Array.isArray(r.body?.items)) return { ok: false, status: r.status, items };
    items.push(...r.body.items);
    if (!r.body.has_more || !r.body.pagination_key || r.body.pagination_key === key) return { ok: true, status: r.status, items };
    key = r.body.pagination_key;
  }
  return { ok: true, status: 200, items };
}

// What every Riley call is graded on afterwards. Same list on both agents so CC shows one shape.
// Mirrors what the inbound agent already carried in the dashboard (Sep 2026), plus next_step.
const POST_CALL_ANALYSIS = [
  { name: "caller_type", type: "enum", choices: ["carrier", "broker", "shipper", "dispatcher", "other"],
    description: "What kind of business the caller is in. carrier = runs trucks (owner-operator, fleet, driver). broker = freight broker with loads. shipper = ships their own freight. dispatcher = dispatches for carriers or wants to work with us as a dispatcher/agent. other = wrong number, spam, vendor, job seeker." },
  { name: "caller_name", type: "string", description: "The caller's own first and last name exactly as they said it, not their company. Empty if never given." },
  { name: "company_name", type: "string", description: "The caller's company or DBA name as they said it. Empty if not given." },
  { name: "mc_number", type: "string", required: false, examples: ["123456"],
    description: "The caller's MC or DOT number, digits only. Empty if not given.",
    conditional_prompt: "Populate only when the caller said an MC or DOT number out loud or typed it. Leave empty on voicemail, no-response, wrong-number and spam calls." },
  { name: "contact_email", type: "string", required: false,
    description: "The caller's email, lowercase, only if it was read back and confirmed. Empty otherwise.",
    conditional_prompt: "Populate only when the caller gave an email and confirmed it back correctly." },
  { name: "equipment_type", type: "enum", choices: ["dry_van", "reefer", "flatbed", "step_deck", "power_only", "box_truck", "hotshot", "mixed", "none"], description: "Equipment the caller runs or needs. none if not a carrier or not discussed." },
  { name: "truck_count", type: "number", description: "How many trucks the caller runs. 1 for a single owner-operator. 0 if not a carrier or unknown." },
  { name: "preferred_lanes", type: "string", description: "Lanes or regions the caller wants, e.g. TX to CA, Southeast regional. Empty if not discussed." },
  { name: "interest_level", type: "enum", choices: ["hot", "warm", "cold", "not_interested", "wrong_number"],
    description: "hot = asked to sign up, gave MC, or wants loads right away. warm = interested, thinking / call back. cold = listened, no real interest. not_interested = said no or asked not to be contacted. wrong_number = wrong number, spam, vendor, robocall." },
  { name: "next_step", type: "string", description: "The single next step Riley promised, in one sentence, e.g. 'team emails document checklist', 'dispatcher confirms load within the hour'. Empty if none." },
  { name: "needs_human", type: "boolean", description: "true if the caller raised a specific load, payment, claim, dispute or complaint that a human must follow up, or asked for a person. false otherwise." },
];

function agentIdFor(cfg: Cfg, key: string): string | null {
  return key === "inbound" ? cfg.inbound_agent_id : key === "outbound" ? cfg.outbound_agent_id : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "missing authorization" }, 401);
    const staff = await staffContext(auth);
    if (!staff) return json({ error: "staff access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const op = String(body.op || "");
    const READ = ["status", "get_llm", "get_call", "recording"];
    const WRITE = ["set_phone_agents", "publish"];
    if (READ.includes(op) && !hasAny(staff, ["comm.view", "comm.manage", "support.view", "dispatch.manage", "settings.manage"])) return json({ error: "not authorized" }, 403);
    if (WRITE.includes(op) && !hasAny(staff, ["comm.manage", "settings.manage"])) return json({ error: "not authorized" }, 403);
    if (!READ.includes(op) && !WRITE.includes(op)) return json({ error: "unknown op" }, 400);

    const c = await svcRpc("retell_admin_config", {});
    if (!c.ok || !c.body || !c.body.api_key) return json({ error: "Retell is not configured on this environment", code: "LB503" }, 503);
    const cfg = c.body as Cfg;

    if (op === "status") {
      // bl_voice_0488: the outbound caller id (815) must exist in Retell (imported via Telnyx SIP) or every dial fails.
      const out = cfg.outbound_from_number && cfg.outbound_from_number !== cfg.from_number ? cfg.outbound_from_number : null;
      const [phone, agents, rows, outPhone] = await Promise.all([
        retell(cfg, "GET", `/get-phone-number/${encodeURIComponent(cfg.from_number)}`),
        retellAll(cfg, "POST", `/v2/list-agents`, { filter_criteria: { channel: { type: "string", op: "eq", value: "voice" } } }),
        svcRpc("riley_prompts_admin_get", {}),
        out ? retell(cfg, "GET", `/get-phone-number/${encodeURIComponent(out)}`) : Promise.resolve(null),
      ]);
      // v2 list is one row per agent (no version/engine fields): it only says whether our agent exists. The
      // version rows come from /list-agent-versions, the config of the version we report from /get-agent?version=.
      const ours: Record<string, any> = {};
      if (agents.ok) {
        const top = (vs: any[]) => vs.reduce((m: any, v: any) => (m === null || (v.version ?? 0) > (m.version ?? 0) ? v : m), null);
        await Promise.all(["inbound", "outbound"].map(async (key) => {
          const id = agentIdFor(cfg, key);
          if (!id) return;
          if (!agents.items.some((a: any) => a.agent_id === id)) { ours[key] = { agent_id: id, missing: true }; return; }
          const vs = await retellAll(cfg, "GET", `/list-agent-versions/${encodeURIComponent(id)}`);
          if (!vs.ok) { ours[key] = { agent_id: id, error: `retell ${vs.status}` }; return; }
          const pub = top(vs.items.filter((v: any) => v.is_published)), draft = top(vs.items);
          const pick = pub || draft;
          const a = await retell(cfg, "GET", `/get-agent/${encodeURIComponent(id)}${pick ? `?version=${pick.version}` : ""}`);
          const d = a.ok ? a.body : null;
          const name = agents.items.find((x: any) => x.agent_id === id)?.agent_name ?? null;
          ours[key] = {
            agent_id: id, agent_name: d?.agent_name ?? name,
            published_version: pub?.version ?? null, published_llm_version: pub ? (d?.response_engine?.version ?? null) : null,
            draft_version: draft?.version ?? null, llm_id: d?.response_engine?.llm_id ?? null,
            voice_id: d?.voice_id ?? null, webhook_url: d?.webhook_url ?? null,
            last_modified: pick?.last_modification_timestamp ?? d?.last_modification_timestamp ?? null,
          };
        }));
      }
      const p = phone.ok ? phone.body : null;
      return json({
        ok: true,
        from_number: cfg.from_number,
        phone: p ? {
          inbound_agent_id: p.inbound_agent_id ?? (p.inbound_agents?.[0]?.agent_id ?? null),
          outbound_agent_id: p.outbound_agent_id ?? (p.outbound_agents?.[0]?.agent_id ?? null),
          inbound_webhook_url: p.inbound_webhook_url ?? null, nickname: p.nickname ?? null,
        } : { error: `retell ${phone.status}` },
        outbound_from: out ? { number: out, in_retell: !!outPhone?.ok, status: outPhone?.status ?? null,
          termination_uri: outPhone?.ok ? (outPhone.body?.sip_outbound_trunk_config?.termination_uri ?? outPhone.body?.termination_uri ?? null) : null,
          nickname: outPhone?.ok ? (outPhone.body?.nickname ?? null) : null } : null,
        expected: { inbound_agent_id: cfg.inbound_agent_id, outbound_agent_id: cfg.outbound_agent_id },
        agents: ours,
        prompts: rows.ok ? rows.body : null,
        escalation_number: cfg.escalation_number,
      });
    }

    if (op === "set_phone_agents") {
      const patch: Record<string, string> = {};
      const inb = body.inbound_agent_id ?? cfg.inbound_agent_id, out = body.outbound_agent_id ?? cfg.outbound_agent_id;
      if (inb) patch.inbound_agent_id = String(inb);
      if (out) patch.outbound_agent_id = String(out);
      if (!Object.keys(patch).length) return json({ error: "nothing to set" }, 400);
      const r = await retell(cfg, "PATCH", `/update-phone-number/${encodeURIComponent(cfg.from_number)}`, patch);
      if (!r.ok) return json({ error: `retell ${r.status}`, detail: r.body }, 502);
      return json({ ok: true, phone: { inbound_agent_id: r.body?.inbound_agent_id ?? null, outbound_agent_id: r.body?.outbound_agent_id ?? null } });
    }

    if (op === "get_llm") {
      const id = agentIdFor(cfg, String(body.key));
      if (!id) return json({ error: "unknown key" }, 400);
      const a = await retell(cfg, "GET", `/get-agent/${id}`);
      if (!a.ok) return json({ error: `retell ${a.status}`, detail: a.body }, 502);
      const llmId = a.body?.response_engine?.llm_id;
      if (!llmId) return json({ error: "agent has no retell-llm engine" }, 409);
      const l = await retell(cfg, "GET", `/get-retell-llm/${llmId}`);
      if (!l.ok) return json({ error: `retell ${l.status}`, detail: l.body }, 502);
      return json({ ok: true, agent_version: a.body.version, llm_id: llmId, llm_version: l.body.version, model: l.body.model,
        begin_message: l.body.begin_message ?? null, general_prompt: l.body.general_prompt ?? "", general_tools: l.body.general_tools ?? [] });
    }

    if (op === "publish") {
      const key = String(body.key);
      const id = agentIdFor(cfg, key);
      if (!id) return json({ error: "unknown key" }, 400);
      const rows = await svcRpc("riley_prompts_admin_get", {});
      const row = Array.isArray(rows.body) ? rows.body.find((r: any) => r.agent_key === key) : null;
      if (!row || !row.general_prompt) return json({ error: "no saved prompt for " + key }, 404);

      const a = await retell(cfg, "GET", `/get-agent/${id}`);
      if (!a.ok) return json({ error: `retell ${a.status}`, detail: a.body }, 502);
      const llmId = a.body?.response_engine?.llm_id;
      if (!llmId) return json({ error: "agent has no retell-llm engine" }, 409);

      // Tools: end_call always; transfer_call only when an escalation number is set in CC. The prompt tells
      // Riley she cannot transfer, so the tool only exists for the day the owner decides otherwise.
      const tools: any[] = [{ type: "end_call", name: "end_call", description: "End the call when the conversation is clearly over and the caller has said goodbye or confirmed there is nothing else." }];
      if (cfg.escalation_number) {
        tools.push({ type: "transfer_call", name: "transfer_to_team", description: "Transfer the caller to the LoadBoot team. Use ONLY when the caller explicitly demands a human and the prompt allows it.",
          transfer_destination: { type: "predefined", number: cfg.escalation_number }, transfer_option: { type: "cold_transfer" } });
      }
      // bl_voice_0522: outbound reaches company switchboards (TQL, 1 Oct). Riley needs a key to get past a phone menu.
      if (key === "outbound") {
        tools.push({ type: "press_digit", name: "press_digit", delay_ms: 1500,
          description: "Press a key on an automated phone menu (IVR). Use ONLY when a recorded menu asks you to press a number, to reach an operator, 'all other calls', or the department the briefing names. Never enter account, payment, PIN or extension numbers you were not given." });
      }
      const llmPatch: Record<string, unknown> = { general_prompt: row.general_prompt, general_tools: tools };
      // inbound opener is dynamic (the prompt decides known vs unknown caller); outbound keeps a fixed first line.
      llmPatch.begin_message = row.begin_message && String(row.begin_message).trim() ? row.begin_message : null;
      const l = await retell(cfg, "PATCH", `/update-retell-llm/${llmId}`, llmPatch);
      if (!l.ok) return json({ error: `retell llm ${l.status}`, detail: l.body }, 502);
      const llmVersion = l.body?.version ?? null;

      const agentPatch: Record<string, unknown> = { post_call_analysis_data: POST_CALL_ANALYSIS };
      if (llmVersion !== null) agentPatch.response_engine = { type: "retell-llm", llm_id: llmId, version: llmVersion };
      // bl_voice_0522: outbound only. ivr_option {hangup} cut call 407 on TQL's menu ("ivr_reached") before an operator
      // was reachable; voicemail_option {prompt} carried its own canned line ("... following up with you") that overrode
      // the CC prompt on call 399. Both cleared, so the published CC prompt alone decides menus and voicemail.
      if (key === "outbound") { agentPatch.ivr_option = null; agentPatch.voicemail_option = null; }
      const u = await retell(cfg, "PATCH", `/update-agent/${id}`, agentPatch);
      if (!u.ok) return json({ error: `retell agent ${u.status}`, detail: u.body }, 502);

      const pub = await retell(cfg, "POST", `/publish-agent/${id}`, {});
      if (!pub.ok) return json({ error: `retell publish ${pub.status}`, detail: pub.body }, 502);

      const after = await retell(cfg, "GET", `/get-agent/${id}`);
      const agentVersion = after.ok ? after.body?.version ?? null : null;
      await svcRpc("riley_prompt_mark_published", { p_key: key, p_llm_version: llmVersion, p_agent_version: agentVersion });
      return json({ ok: true, key, llm_id: llmId, llm_version: llmVersion, agent_version: agentVersion });
    }

    if (op === "get_call") {
      const callId = String(body.call_id || "");
      if (!/^[a-zA-Z0-9_-]{6,80}$/.test(callId)) return json({ error: "bad call_id" }, 400);
      const r = await retell(cfg, "GET", `/v2/get-call/${callId}`);
      if (!r.ok) return json({ error: `retell ${r.status}`, detail: r.body }, 502);
      const b = r.body || {};
      return json({ ok: true, call_id: callId, status: b.call_status, direction: b.direction, from_number: b.from_number, to_number: b.to_number,
        start: b.start_timestamp, end: b.end_timestamp, duration_ms: b.duration_ms, recording_url: b.recording_url ?? null,
        transcript: b.transcript ?? null, analysis: b.call_analysis ?? null, disconnection_reason: b.disconnection_reason ?? null,
        cost: b.call_cost ?? null });
    }

    if (op === "recording") {
      const callId = String(body.call_id || "");
      if (!/^[a-zA-Z0-9_-]{6,80}$/.test(callId)) return json({ error: "bad call_id" }, 400);
      const r = await retell(cfg, "GET", `/v2/get-call/${callId}`);
      if (!r.ok) return json({ error: `retell ${r.status}`, detail: r.body }, 502);
      const url = String((r.body && r.body.recording_url) || "");
      if (!/^https:\/\//.test(url)) return json({ error: "recording not available", status: r.body && r.body.call_status }, 404);
      const audio = await fetch(url);
      if (!audio.ok || !audio.body) return json({ error: "download " + audio.status }, 502);
      const kind = /\.mp3(\?|$)/i.test(url) ? "audio/mpeg" : "audio/wav";
      return new Response(audio.body, { headers: { ...cors, "Content-Type": "application/octet-stream", "X-Audio-Type": kind,
        "Access-Control-Expose-Headers": "X-Audio-Type", "Cache-Control": "private, max-age=600" } });
    }

    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
