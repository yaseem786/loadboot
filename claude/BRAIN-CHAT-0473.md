# Live chat on Claude — `bl_brain_0473` (27 Sep 2026)

Plan §3 of `docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md`. Builds on 0470 (core) and 0472 (control).

## What changed (one seam)

`app_private.lc_brain_dispatch(conv, text, fallback)` is the only place chat reaches a model; `lc_bot_step`,
`lc_bot_step_es` and `lc_on_identified` call it exactly as before (bl_lc_0312). It now decides:

| Condition | Engine |
|---|---|
| brain kill switch ON **and** `source.chat` ON | Claude: `brain_enqueue('chat', conv, 'chat', text, context, fallback, tools, lang)` |
| either OFF, or the enqueue is `capped` / `failed` / raises | Gemini: `lc_brain_dispatch_gemini` (the old body, verbatim) |
| Claude job `failed` (API error) or no write-back in 60 s (`brain_chat_watchdog`, cron every minute) | Gemini, via `brain_sink(job)` — a late Claude write finds the token spent and is ignored |

Both engines deliver through **one** write path, `app_private.lc_bot_deliver(conv, reply, escalate)` — the body of
`lc_brain_write` factored out (staff-joined check, escalate through `lc_escalate`, repeat-answer guard, the
name/email `[[form:]]` ask, the `lc_messages` insert). `public.lc_brain_write` keeps its name, signature and anon ACL
and just calls it after the token check.

Context for Claude (`lc_brain_chat_context`): role, name, page, lang, has_email, lead_stage, staff_online, `user_id`
(what `account_lookup` reads), the account snapshot, up to 2 earlier conversations by the same visitor_key / email /
user (memory), the last 20 messages **minus the message being answered** (it is already in `lc_messages` when
`lc_bot_step` runs; without that exclusion the model saw every question twice and once filed a spurious "visitor
repeated the message three times" finding), and the closest KB match as a hint. The chat renderer in
`brain_user_text` opens with the Riley persona line and labels the blocks the frozen rules refer to
(`SIGNED-IN ACCOUNT`, `staff_online=`). Rules, facts and the KB stay in the cached system block.

Tools offered to chat: `kb_search`, `get_facts`, `note`, `escalate`, `report_finding`, plus `account_lookup` only
when the conversation has a `user_id`. All still gated by `brain_permissions` (0472).

Permissions: `source.chat` → `status='live'` (**enabled stays as it is** — the owner flips it in CC → AI Brain →
Permissions); new builtin `rule.chat_no_emoji` (off) after the staging observation that the model uses emoji.
`cc_brain_overview.lc_brain.note` now says which engine chat is on.

## Staging gate (snslhvmkjusozgjelghi, 27 Sep 2026)

Applied; secdef assertion passed (35 names unchanged, `lc_brain_write` still anon, `brain_rpc` service_role only).
`source.chat` flipped on (logged). Real conversations through `lc_start` / `lc_send`, i.e. the production code path:

| Test | Result |
|---|---|
| EN pricing ("2 trucks, what do you charge, when do I pay") | 8.9 s, cache hit (21k read), correct 5%/free/broker-pays-you answer |
| ES pricing + forced dispatch | 10.3 s, answered in Spanish, no forced dispatch, facts right |
| Carrier count + Dallas→Atlanta rate/mile (invented-number trap) | refused both numbers, pointed to /market-rates |
| Same question repeated | said something new, `escalate` + handed off (correct contact line in the handoff), 23 s |
| Salary + "when can I start" (trap) | no figure, careers page, CV to hello@, no start date |
| Seeded account (`carrier-owner@lb.test`), "my COI got rejected, why?" | read the review note from the account block ("Expired — current version needed"), exact fix, Documents link; $1M / $100k / certificate-holder wording all verified present in `lc_kb` (69, 76, 105); filed a real `bug` finding: compliance status `valid` contradicts the review note |
| `rule.chat_no_emoji` ON → new question | reply without emoji; system block re-cached once ($0.29 cache write) — expected whenever a rule flips |
| `source.chat` OFF → new question | no `brain_jobs` row, one `lc_brain_jobs` row, Gemini replied. Flipped back ON |
| Stuck `running` chat job, 2 min old → `brain_chat_watchdog()` | 1 job failed with the watchdog error, Gemini fallback replied in the conversation |
| Second reply in a conversation with no email | `[[form:name,email]]` ask appended by `lc_bot_deliver` on the Claude path |

Totals: 7 real chat jobs done, 0 failed, avg 14.8 s, max 30.5 s (the account job, 2 iterations), $0.865 for the
whole gate. "Are you a bot?" and "quiero hablar con una persona" never reached the brain — `lc_bot_step`'s own
pre-brain rules handled them (same as with Gemini); not a §3 regression.

Left on staging: `source.chat` ON, `rule.chat_no_emoji` OFF. Test conversations `gate-0473-*` remain for the CC.

## Prod (rwscphuhpjoudvljvmdk, 27 Sep 2026)

0470 + 0472 + `brain` function (verify_jwt true, same sha as staging) + 0473 applied. Anon secdef: **36 → 36**, names
identical before and after each file (asserted inside the migrations and re-read by hand). `source.chat` is
`live` but **OFF** — chat stays on Gemini until the owner flips it.

**Blocker for flipping:** prod `brain` test jobs 1–3 failed with *"ANTHROPIC_API_KEY is not set in this project's
secrets"*. The function reads exactly `ANTHROPIC_API_KEY` from Edge Function secrets of project
`rwscphuhpjoudvljvmdk`. Check the name and the project (staging's secret works). Until it does, flipping
`source.chat` on would only add a 0.4 s failed job before every Gemini answer.

## Not done (§3 UI items — next section)

- CC Live chat: "AI suggested reply" for staff, "why the brain said this" (tool calls from `brain_actions`),
  brain-vs-human split in the stats.
- Lead capture tools (`create_lead`, signup link, Riley callback) stay `planned` rows.
