# Live chat → Claude brain (lc-brain v4) — implementation plan for Claude Code

Written 27 Sep 2026 by the Cowork session. Owner: Yaseen. This is the FINAL plan — build it as written; ask only where a line says "ask".
Read first: `claude/WHATSAPP-0377-NEXT-SESSION.md` is unrelated; the relevant history is the memory note `loadboot-lc-brain-gemini`
(architecture of the current Gemini brain) and `migrations/bl_lc_0312_real_chat.sql` (the chat engine). Repo: `C:\Users\HP\Documents\GitHub\loadboot`.

## 0. Decision (do not reopen)
- The live chat's AI slot (`lc_bot_step` → `lc_brain_dispatch` → edge fn `lc-brain` → `public.lc_brain_write`) moves from Gemini to **Claude via the Anthropic Messages API**.
- Primary model **Sonnet 5**, fallback **Haiku 4.5**, then the existing Gemini chain, then the keyword answer. Never Opus/Fable for chat.
- Take the exact model ID strings from https://platform.claude.com/docs/en/about-claude/models — do not guess them.
- Rates (official, 27 Sep 2026): Sonnet 5 $2/M in · $10/M out; Haiku 4.5 $1/M in · $5/M out. Expected cost at today's volume ≈ $3–4/month for chat alone.
- Scope of THIS build = live chat only (site widget + carrier/broker/agent portals). WhatsApp drafts, email drafts, applicant screening, doc pre-check and the daily brief are Phase 2 — separate tasks, not now.
- Lane: this is Claude's lane (DB / edge functions / prod applies) per `docs/audit-2026-09/WORK-SPLIT-2026-09-22.md`. Do not touch ChatGPT-lane files except `app/shared/ui/liveChatCore.js` + `app/shared/ui/chatText.js` for the link fix in §5 and `app/command-center/views/livechat*.js` for the Brain tab in §4.

## 1. Prerequisites (Yaseen does these; verify, don't assume)
1. Anthropic Console: Individual account, funds added ($20), monthly limit $50 set, key named `loadboot-lc-brain`.
2. Supabase → **staging** `snslhvmkjusozgjelghi` → Edge Functions → Secrets → `ANTHROPIC_API_KEY`. Prod `rwscphuhpjoudvljvmdk` gets it only at §8.
3. Check: `select enabled, model from app_private.lc_brain_config;` on staging — the flag/kill switch already exists, keep it.

## 2. Security model — keep it exactly as it is
- The edge function never holds the service-role key. It receives a one-time 3-minute token minted by `lc_brain_dispatch` (row in `app_private.lc_brain_jobs`) and may only call `public.lc_brain_write(token, reply, escalate, source)`.
- Anything new the function needs from the database goes through ONE new RPC gated by the same token: `public.lc_brain_tool(p_token text, p_name text, p_args jsonb) returns jsonb` (SECURITY DEFINER, `revoke from public`, grant to anon + authenticated, token must match an unexpired unconsumed job; the token is NOT consumed by tool calls — only by `lc_brain_write`). Log every tool call into `app_private.lc_brain_tool_log (job_id, name, args, result_size, ms, created_at)`.
- Prod anon SECURITY DEFINER surface is counted by name in the audit docs (36 after 0457/0459). Adding `lc_brain_tool` makes it 37 — record it in `docs/audit-2026-09/` the way the other migrations did.

## 3. Migration `migrations/bl_lc_0464_claude_brain.sql` (staging first, then prod at §8)
- `app_private.lc_brain_config` add columns: `provider_order text[] default '{anthropic,gemini,keyword}'`, `anthropic_model text`, `anthropic_fallback_model text`, `max_tool_rounds int default 2`, `system_prompt text` (the brain file, §4), `system_prompt_updated_at timestamptz`, `system_prompt_updated_by uuid`.
- `app_private.lc_brain_jobs` add `usage jsonb` (`{input_tokens, output_tokens, cache_read, model, tool_rounds}`) — written by `lc_brain_write` from a new optional 5th arg `p_usage jsonb default null` (add an overload; keep the 4-arg signature working).
- New table `app_private.lc_brain_tool_log` (above).
- New RPC `public.lc_brain_tool(p_token, p_name, p_args)` dispatching to these read-only helpers (all `app_private`, all wrapped in exception handlers that return `{error: text}` — a tool failure must never break the reply):
  - `fmcsa_lookup(mc|dot)` → call the existing `fmcsa-verify` edge function the way the portal does (see `fmcsa_portal_flow` memory / `app/shared/api.js`) via `net.http_post` is NOT possible synchronously — instead read `app_private.fmcsa_cache` (or whatever the verify function writes; find it with `\d app_private.*fmcsa*`) and, on a miss, return `{status:'not_cached', say:'ask the visitor to sign up and click Verify'}`. Never invent authority data.
  - `board_snapshot(equipment, origin_state, dest_state)` → counts of open loads on the board matching equipment/lanes in the last 7 days + top 3 lanes by count. Counts only, no rates, no broker names.
  - `account_file()` → the existing account block that `lc_brain_context` already builds — keep passing it in the context as today; the tool exists only so the model can re-read it after a tool round.
  - `request_callback(phone, when)` → the existing callback path (`lc_chat_request_call` or whatever `lc_bot_step` calls; find it in `bl_lc_0312_real_chat.sql`).
  - `capture_contact(name, email, phone, role)` → the existing email/name capture functions in `lc_bot_step`; must respect the lead gate exactly as today.
  - `applicant_rules()` → returns the dispatcher-applicant rules text from `lc_brain_config.system_prompt` section "DISPATCHER APPLICANTS" (so the model quotes, not paraphrases).
- Seed `system_prompt` with the brain file from §4 (as a `$brain$…$brain$` dollar-quoted string).
- `lc_brain_dispatch` / `lc_brain_context`: add `provider_order`, models, `max_tool_rounds`, `system_prompt` to the payload. Nothing else changes in the SQL path.

## 4. The brain file (`lc_brain_config.system_prompt`) — content
Write it as plain text sections; it is editable from CC without a deploy.
1. WHO YOU ARE — "Riley, LoadBoot's assistant"; roles: sales rep for carriers, brokers, shippers; technical support for the portals; answers questions; hands to a human when needed.
2. WHAT IS TRUE — port the existing `FACTS` block from `supabase/functions/lc-brain/index.ts` unchanged (5% fee on paid loads only, no contract, no forced dispatch, verification list, brokers/shippers free, referral 1%, accessorials, 49 CFR 371.2 + BMC-84, hiring via careers, contact details — use the WhatsApp/contact line rule from memory `loadboot-contact-line`: WhatsApp +1 (815) 365-1168 via the contact switch, never the Riley phone line as the primary).
3. PORTAL HOW-TOS — carrier: Documents (authority, COI $1M auto + cargo, W-9, dispatch agreement), Fleet + VIN, Payments, daily availability, Dispatcher tab; broker: post a load, tiered trust, voice OTP; agent portal: dispatcher track vs referral track. Common fixes: PWA cache (delete site data / unregister SW), "form not saving" → refresh + log out/in, upload limits 25 MB.
4. DISPATCHER APPLICANTS — from memory `loadboot-dispatcher-hiring`, verbatim rules: applicants apply through the portal; team reviews in 1–3 days; skills test, never fewer questions; board access is required only AFTER passing the test — never tell a candidate to buy a board before; LoadBoot does NOT provide board access (own, employer's or a company login all count); trial pay = 2.5% of gross line haul per delivered load, no base; after trial salaried, confirmed on trial performance; LoadBoot assigns a work phone line at trial start; never tell a candidate LoadBoot lacks carriers for their equipment; never offer to close a silent candidate's file.
5. HOW TO ANSWER — port `RULES` from index.ts, plus: **plain text only — no HTML tags, no markdown links; write URLs bare (https://loadboot.com/app/carrier/#documents) and the widget makes them clickable**; under 110 words; one question max; answer in the visitor's language; chips line `[[chips:…]]` unchanged.
6. NEVER — port the hard rules unchanged (no invented numbers, no coverage/start-date promises, no rates from memory, no legal/tax advice, never ask for password/card/bank/ID, no feature claims, no repeats).
7. ESCALATE — unchanged conditions; when staff_online=false say the team follows up and offer the 24/7 line + callback tool.

## 5. Edge function `supabase/functions/lc-brain/index.ts` → v4
- Keep everything that exists (Gemini chain, `extractReply`, `sanitize`, `accountBlock`, `write`). Add an `askAnthropic()` provider in front of it.
- Anthropic call: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`; `system` = brain file + VISITOR/ACCOUNT/SNIPPETS blocks (same composition as today's prompt minus FACTS/RULES which now come from `system_prompt`); `messages` = history mapped to user/assistant turns + the new visitor message; `tools` = the six tools from §3 with JSON schemas; `max_tokens: 600`; temperature default.
- Tool loop: up to `max_tool_rounds`; each `tool_use` → `POST {SB_URL}/rest/v1/rpc/lc_brain_tool` with the job token → append `tool_result` → call again. Log rounds. On any tool error, pass `{error}` back to the model and continue.
- Final answer must be JSON `{reply, escalate}` — enforce by giving the model a `final_answer` tool with that schema and `tool_choice: {type:'any'}` on the last round; still run `extractReply` as rescue.
- `sanitize()` additions: strip `<a …>text</a>` → `text url`, strip any other HTML except `<b>`/`<i>`, collapse triple newlines. This is the fix for the broken links Leo saw (bot emitted `<a>` and the widget auto-linkified it again).
- Provider order from config; on Anthropic 4xx/5xx/timeout (15 s) → Haiku → Gemini chain → keyword fallback — exactly today's pattern, source strings `anthropic:<model>`, `anthropic-fallback:<model>`, `gemini:<model>`, `fallback:<err>`.
- Pass `usage` (input/output/cache tokens, model, rounds) to `lc_brain_write` 5-arg overload.
- `verify_jwt: true` stays; anon key in apikey/Bearer as today.
- Widget side, `app/shared/ui/chatText.js` + `liveChatCore.js` `linkify()`: if the body already contains `<a ` do not linkify inside it (belt and braces; the server strip is the real fix).

## 6. CC — Live chat → new **Brain** tab (`app/command-center/views/`)
- Shows: provider order, models, kill switch (existing `enabled`), `max_tool_rounds`, a textarea for `system_prompt` with Save (writes via a new staff RPC `cc_lc_brain_config_set`, audit row), "last 20 answers" with source + tokens + cost (cost = tokens × the rates in §0, computed in SQL, shown as $x.xxx), and "this month" totals.
- Mobile-responsive, no empty space in cards (owner's standing UI rule). Verify with esbuild, not only `node --check`.

## 7. Staging test — must pass before prod
Run these through the real widget on the staging build (`python build_site.py` with staging keys) and paste the transcripts into `docs/livechat/CLAUDE-BRAIN-STAGING-TEST-<date>.md`:
1. Leo's conversation replayed: "Not Working" → "How to use it" → "Which broker available in this". Expect: plain-text links that render clickable, no `<a>` in `lc_messages.body`, an answer to the broker question (explains the board, asks for MC), no escalation.
2. "i have one dry van in dallas, new MC 3 weeks old, can you get me loads" → honest authority-age answer, `board_snapshot` tool used, no promise.
3. "what's my COI status" while signed in as the staging test carrier → answered from the account block.
4. Dispatcher applicant: "do you provide DAT?" → rule 4 verbatim (no board provided, needed only after the test). "how much is the salary?" → 2.5% trial, salaried after; no figure invented.
5. "give me your best rate Chicago to Dallas" → refuses to quote, points to the board.
6. Spanish message → Spanish answer.
7. Frustrated visitor ("this is useless, get me a person") → escalate=true with a useful sentence, staff_online handled.
8. Kill Anthropic (wrong key on staging for one test) → falls to Gemini → keyword; visitor never gets silence.
9. Check `lc_brain_jobs.usage` is populated and the Brain tab shows cost; compare with the Console usage page after 50 replies and write the measured $/reply into the doc.

## 8. Prod rollout (in this order)
1. Apply `bl_lc_0464` on prod (SQL editor), record the anon-SECDEF count by name.
2. Deploy `lc-brain` v4 to prod. Set `ANTHROPIC_API_KEY` on prod.
3. `update app_private.lc_brain_config set provider_order='{anthropic,gemini,keyword}', anthropic_model='<id>', anthropic_fallback_model='<id>' where id;`
4. Watch `select created_at, source, usage from app_private.lc_brain_jobs order by 1 desc limit 20;` for 24 h. Rollback = set `provider_order='{gemini,keyword}'` (no deploy).
5. Commit to `main` with the repo's commit style; Yaseen pushes from GitHub Desktop. Update the memory-style handoff doc `claude/LIVECHAT-CLAUDE-BRAIN-STATUS.md` in the project with what is live.

## 9. Phase 2 backlog (separate tasks, priced 27 Sep at today's volume, Sonnet 5)
WhatsApp inbound drafts (~$0.36/mo) · email inbox drafts + triage (~$2/mo) · dispatcher application screening (~$0.86/mo) · carrier document pre-check with vision (~$0.016/doc) · broker load-email parsing (~$0.009/email) · daily CC brief (~$0.84/mo). Each reuses `lc_brain_tool`'s pattern: one-time token, no service-role key in the function.

## 10. Rules that bind this build
- Migration → staging → test → prod. Never test on prod.
- Edit big files with python/bash, verify JS with esbuild. Keep changes additive; the keyword path and Gemini path must keep working untouched.
- Never invent a number in the brain file; if a fact is unknown, leave it out and say so in the doc.
- Owner sends nothing himself here — the bot answers; staff can still take over in CC as today.
