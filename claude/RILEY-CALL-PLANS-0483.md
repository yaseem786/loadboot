# Riley call plans — `bl_voice_0483` (27 Sep 2026)

Plan §9 Phase 1, first slice. The Ops Brain writes the briefing for an outbound carrier call **before** anyone dials.
Nothing in this slice places a call: `tool.schedule_riley_call` stays `prep` / off until the owner flips it under
CC → AI Brain → Permissions. The plan text is written as Riley's `{{context}}`, so when booking ships the same words
drive the call (`lc_calls.context` → `retell_dial`).

## What the owner sees

- **Carrier 360** → header contact block → **Plan a Riley call** (only when a phone is on file and the staffer has
  `comm.manage` / `dispatch.manage` / `settings.manage`). Default reason: onboarding gap (not verified) or no reply (verified).
- **Carrier choices** → each pending card → **Plan a Riley call** — reason `choice_pending`, note pre-filled with the
  candidate's name and match kind. The call is to the **carrier**, never the dispatcher candidate (owner rule §14.2: no calls
  to dispatchers).
- **Riley → Call plans** (`#/riley?tab=plans`, deep link `&id=<plan id>`): counts (planning / ready / called / failed), brain
  cost 30 d, the Retell rate line, a status filter and the table (when, carrier, why, status + confidence, goal, cost estimate).
  Open → the card: Goal · Opener · Talking points (5) · Confirm · Do not say · Best time · Language, the verbatim briefing,
  consent basis, cost line (`brain_usd + est_minutes × $0.13`), the brain's "check first" note when confidence < 0.6.
  Actions: **Copy briefing**, **Edit briefing** (keeps the seven headers), **Redo plan** (new brain job, note required),
  **Mark called** (outcome note required), **Cancel plan**, and a disabled **Book with Riley — off** button that says why.
- The popup is `openDrawer` everywhere (CLAUDE.md §8). The Riley number is never rendered.

## Pieces

| Piece | What |
|---|---|
| `migrations/bl_voice_0483_riley_call_plans.sql` | applied **staging ✓** and **prod ✓** 27 Sep. anon SECDEF 36 prod / 35 staging, names unchanged (list re-checked by name; `docs/audit-2026-09/anon-secdef-baseline.md` gained the two `newsletter_*` names that 0447 had left out of the doc). |
| `app_private.riley_call_plans` | one row per plan: org, contact, `to_number` (E.164), `consent` jsonb, reason, note, lang, status, `job_id`, `plan_text`, `plan` (parsed), confidence, `review_note`, `brain_usd`, `est_minutes` (4), `call_id` (future), error. RLS on, no policies (RPC-only). |
| `app_private.riley_plan_context(plan)` | the carrier file the brain plans from: profile facts, `lc_account_snapshot` (compliance rows + notes, trucks, payment), active dispatcher assignment, pending carrier choices, last 3 Riley calls to the org/number, consent, last login. Returns NULL for a demo org. Includes `user_id` so `tool.account_lookup` reads this account only. |
| `app_private.riley_plan_parse(text)` | the seven fixed headers → jsonb (`goal, opener, points[], confirm[], do_not_say[], best_time, language, parsed`). Postgres ARE gotcha handled: the first quantifier is non-greedy so the whole match is shortest. |
| `brain_user_text` | new `voice_plan` branch in front of the default: reason-specific instruction, staff note, carrier file, the seven-header contract, "confidence < 0.6 when a key fact is missing". chat/assist branches byte-identical to 0474. |
| `brain_sink` | new `voice` branch: done → plan `ready` (text, parsed, confidence, review note, usd); anything else → `failed` with the error. chat branch unchanged from 0473. |
| `brain_permissions` | `source.voice` **planned → live, enabled** (logged via `brain_log`). `tool.schedule_riley_call` untouched: `prep`, off, planned. |
| `brain_config` | `model_by_route.voice_plan = claude-sonnet-5`, `effort.voice_plan = medium`, `max_tokens.voice_plan = 3000` (logged). |
| `public.cc_riley_plan_create(org, reason, note, lang)` | write gate `comm.manage` / `dispatch.manage` / `settings.manage`. Refuses non-carrier orgs, demo orgs, no usable US number. One planning job per carrier per 5 min (returns the open one, `reused: true`). Records the TCPA basis on the row (signup phone of an existing account; `sms_consent` method when a live row matches the number). Enqueues `brain_enqueue('voice', plan_id, 'voice_plan', …, tools get_facts/kb_search/account_lookup)`. |
| `public.cc_riley_plans(status, limit, org)` · `cc_riley_plan(id)` | read gate = the Riley screen's (comm.view / comm.manage / support.view / dispatch.manage / settings.manage). Returns `can_manage`, `source_on`, `dial_tool` state, counts, `usd_30d`, plans (each with job cost/timing and the cost line). |
| `public.cc_riley_plan_set(id, action, note)` | `cancel` · `called` (note = outcome) · `edit` (note = new briefing, re-parsed) · `redo` (new job, note = new staff note). |
| `app/command-center/views/rileyPlanFlow.js` | the shared "Plan a call" popup + `PLAN_REASONS`, `PLAN_STATUS`, `planLink`. |
| `views/riley.js` | Call plans tab (`plans`), polled with the 5 s loop while open; `openPlan` card. |
| `views/carrier360.js`, `views/carrierChoices.js`, `app.js`, `shared/api.js` | buttons, tab keywords, `ccRileyPlan*` wrappers. |

## Verified

- Staging throwaway (test carrier `yuayui788`, fake 555 number, row inserted directly — no staff JWT from SQL): job on
  `claude-sonnet-5`, **12.7 s, $0.016**, 0 tool calls, plan parsed (`parsed: true`, 5 points), status `ready`, confidence
  0.45 with an honest review note ("file is missing contact name, phone, home_base…"). Plan row + both brain jobs deleted after.
- Gate: `cc_riley_plans()` as postgres (no JWT) → `not authorized` on both databases.
- One wasted job on staging (#49, empty context) came from a CTE-snapshot mistake in the test itself, not from the code: a
  data-modifying CTE's row is invisible to `riley_plan_context()` in the same statement. The RPCs run in plpgsql, so they
  see their own insert.
- `bash scripts/check_esm_syntax.sh` → 216 files pass; `python3 build_site.py` → BUILD OK, `site/app/...` carries the new files.

## Cost line (plan §9)

Brain ≈ $0.01–0.03 per plan on Sonnet 5 (12 000-char carrier file, cached system block). Retell ≈ $0.13/min only when a
call is placed; the card shows `est_minutes (4) × 0.13 + brain_usd`. `source.voice` caps: $5/day, 500 jobs/day (unchanged 0472 row).

## Guardrails kept

- Carriers only; demo orgs refused at create, redo and in the context builder (returns NULL). No dispatcher calls (§14.2).
- TCPA basis recorded per plan; the number is the one the carrier gave at signup. Booking stays off.
- No email, no SMS, no dial from this slice. No new anon-executable name.
- Every brain change is a `brain_permissions` / `brain_config` row with a `brain_log` entry (CLAUDE.md §9).

## Next slice — BUILT in `bl_voice_0485` (see `claude/RILEY-SLICE2-0485.md`); items 1–2 done, 3 still open

1. `tool.schedule_riley_call` executor in `brain_tool_exec` + a **Book with Riley** button: inserts `lc_calls`
   (direction outbound, `source 'cc'`, `context = plan_text`, `org_id`, `scheduled_at` from best time, requested_by) and
   calls `retell_dial()`; plan → `scheduled`, `call_id` set. Only after the owner flips the tool to live.
2. `retell_webhook` `call_analyzed` → find the plan by `call_id` → status `called`, attach summary / next_step; brain
   post-call job (`voice_followup` route) continues the thread (§14.2 "after every call").
3. Auto triggers per §14.2 (day-1 welcome, 48 h vanished, hot lead in 10 min) — each a `source.voice` job through the
   same `cc_riley_plan_create` path with `created_by = null` and a cap per carrier per day.
4. ~~Retell balance line~~ — DONE in `bl_voice_0484` (27 Sep): Retell's API has no balance endpoint (docs: only per-call
   `call_cost` and get-concurrency), so CC → Riley → Settings & wiring → **Retell balance** takes the dashboard figure by
   hand (`retell_config.balance_usd/_as_of/_set_by`) and shows Riley calls + minutes since that reading; banner under $10.
