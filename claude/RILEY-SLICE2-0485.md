# Riley call plans, slice 2 — `bl_voice_0485` (27 Sep 2026)

Booking + what happens after the call. Builds on `claude/RILEY-CALL-PLANS-0483.md`.
Applied **staging ✓ → prod ✓**. All 28 new/changed functions have the same md5 on both databases. anon SECDEF is
36 on prod and 35 on staging, and the names match `docs/audit-2026-09/anon-secdef-baseline.md` (no new name).

## Flow

```
ready plan ── "Book with Riley" (cc_riley_plan_book) ──► lc_calls (source 'account', status scheduled, inside calling hours)
                                                          └─ cron lb-voice-scheduled (*/5): riley_plan_predial re-checks everything → retell_dial
retell_webhook call_ended / call_analyzed ──► riley_plan_on_call ──► plan called | no_answer, outcome copied
   answered  → brain job source voice / route voice_followup (Sonnet 5) → NEXT STEP proposed
   no answer → rule: 2nd call next business day, other time of day (attempts 1–2); email after attempt 3
CC → Riley → Call plans → Next step: Plan 2nd call · Review & send email · Create task · Dismiss · Do not call
```

## Owner switch: `tool.schedule_riley_call` (CC → AI Brain → Permissions)

After 0485 the tool is `status live`, `enabled false`, `mode prep`.

| Setting | Effect |
|---|---|
| off | nobody can book, and nothing dials (the gate is checked again right before every dial) |
| on + **prep** | staff press "Book with Riley"; the AI's next step waits for a person |
| on + **auto** | also: the brain's "second call" is planned and **booked by itself** (still fully gated); an AI "staff task" is created by itself. **Emails always wait for a person.** |
| deny | never |

## Guardrails: `app_private.riley_dial_gate(plan, auto, slot)`, checked at booking AND before dialling

The tool is on and live (auto booking needs `auto` mode) · brain master switch on · real carrier (never demo, never a
dispatcher) · consent basis on the plan · valid US number · not on `app_private.voice_dnc` · no SMS STOP on the number ·
Retell configured · Riley Outbound prompt knows `"account"` **and is published** · one call per carrier per 20 h · three
per 7 days · three attempts per topic · `max_per_day` overall. Calling hours: Mon–Fri 09:00–18:30 carrier local time
(state taken from `home_base`; if the zone is unknown, 11:00–18:30 Eastern, which is legal everywhere in the lower 48).
"Next allowed time" shifts past the 20 h cap on its own.

Do-not-call is filled by:
- Riley's analysis saying `not_interested` or `wrong_number`
- the brain reading "don't call me" in the transcript
- staff pressing **Do not call**

Adding a number cancels anything already booked to it. Removal needs comm.manage or settings.manage, and a reason.

## Riley Outbound prompt (draft saved, needs Publish)

A new `"account"` source line was added: use the briefing OPENER, never "returning your request", plus an account
voicemail line. Saved to `riley_prompts` + `riley_prompt_history`. **The owner must press CC → Riley → Prompts →
Publish (Outbound).** Until then the gate says `prompt_unpublished` and nothing can be booked. Both environments share
one Retell account, so publish from prod only.

## Email: `riley.followup` (catalog row, class O, group compliance, unsub allowed)

Staff review and edit the draft, then press Send. `email_gate` runs first and its reason is shown verbatim.
`sys_email` sends with idempotency key `riley.followup:<plan id>`. The body is HTML-escaped and gets the
`{{contact_sig}}` footer (the one-number sign). A Riley number inside the text is refused.

## Cost fix (the $0.10 plan)

The first prod plan cost $0.104. $0.093 of that was the 1-hour cache **write** of a 23k-token system block, which was
mostly the 54k-char KB, on a route that runs about once a day. `brain_config.lean_routes = {voice_plan, voice_followup}`
now sends rules + facts + permissions only, and the model calls `kb_search` when it needs a policy.

Staging results: plan **$0.023** (15 s), follow-up **$0.022** (9 s). Chat and other routes are unchanged.

## Also fixed

`views/riley.js` never imported `askReason`, so "Redo plan" and "Mark called" threw on prod since 0483. Fixed.

## Verified on staging (throwaway, all rows deleted after)

- Test carrier `cc000000-…0001`, fake 555-01xx numbers. Nothing was sent to Retell.
- Plan → Book: Monday 09:00 ET. Sunday predial returned `later`.
- Simulated `call_ended` + `call_analyzed`: plan `called`, outcome copied, **no CRM lead**. The follow-up job proposed an
  email ("Steps to upload your new Certificate of Insurance") at 0.85 confidence, plus a staff-task suggestion. The
  in-app notification fired.
- Email path: `email_gate` refused the fixture's invalid address with its reason. The HTML builder and escaping were
  checked on their own.
- Staff task: created. Second call: plan #4 (attempt 2); a duplicate was refused.
- Booking #4 first hit the cap. This was fixed so the 20 h shift clears the boundary. #4 then booked Mon 13:20 ET.
- No-answer: rule proposed a 2nd call, not earlier than the cap allows.
- Auto mode: plan #5 (attempt 3) was created and booked by itself for Mon 13:23 ET.
- DNC cancelled #5 and its call row. The gate after revert returned `tool_off`.
- Staging tool back to off / prep, and `published_at` restored to NULL.
- Bugs caught by this test and fixed before prod:
  - `r ? 'error'` is always true, because `riley_plan_json` always carries an `error` key
  - `automation_tasks.id` is a uuid
  - the cap shift sat exactly on the 20 h boundary
  - the suggested time came before the cap allowed

## Not built / next

- Auto triggers (§14.2: day-1 welcome, 48 h vanished, hot lead in 10 min). Each would go through
  `riley_plan_new(..., p_actor null)` with a per-carrier cap.
- Capturing Retell `call_cost` per call, to show real spend instead of the estimate. Check the unit first.
- A CC list of the do-not-call numbers (today they show per plan).
