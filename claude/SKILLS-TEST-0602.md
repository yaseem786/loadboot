# bl_disp_0602 — skills test: 5-day window, expired → Screening, duplicate applications held

Owner, 11 Nov 2026 ("Skill Test System – Required Changes"). Migration: `migrations/bl_disp_0602_test_window_expired_duplicates.sql`.
Rolled-back E2E: `tests/bl_disp_0602_rollback_test.sql` (staging only).

## 1. Submit confirmation (portal, `app/agent/skills-test.js`)

The confirm box already existed (bl_disp_0306). Now: title "Are you sure you want to submit your test?", buttons
**Yes, submit my test** / **No, go back to my answers**, Esc and a click outside = no. Nothing is sent on the first click.

## 2. Five days to take the test

| | before | now |
|---|---|---|
| Invitation window (`start_by`) | 48 h | **120 h (5 days)** — `disp_test_invite`, `cc_dispatcher_test_invite`, `disp_test_reinvite` |
| Clock once Start is pressed | 75 min | 75 min (unchanged — he asked for 5 days to *take* it, not an untimed test) |
| 12 h reminder | person-sent invites | unchanged (now lands on day 5) |
| Automatic re-invites | 3 rounds × 48 h | 3 rounds × 5 days (worst case one invite chain ≈ 20 days) |

E-mail copy says "5 days" (`app_private.disp_window_label`). Invitations that were open on deploy were extended to 5 days
from their invite time. CC Test tab passed an explicit 48 — now `INVITE_START_DAYS * 24`.

## 3. Expired test → back in Screening

Cause: an expired candidate stayed `skills_test` + attempt `expired`. The CC board has no column for that pair and the roster's
"Send test" button only showed on `screening`, so they disappeared.

- `skills_test_sweep` → `app_private.disp_test_back_to_screening` when a test lapses **for good**: started and nothing
  answered / 3 automatic re-invites used / address cannot be e-mailed. Audit `dispatcher.test.expired_to_screening`.
  While automatic re-invites are still running the status stays `skills_test`.
- `lb_dispatcher_applied_email` skips `skills_test → screening` (it would have re-sent "Application received").
- Backfill: every `skills_test` application whose latest attempt was `expired` → `screening` (prod: 8).
- CC: "Screened" column also picks expired tests (chip "Test expired", next action "send again"); roster button
  "Send test again".

## 4. Duplicate applications

Identity = e-mail **or** phone. `disp_phone_key` = last 10 digits (so `+92 300…` = `0300…`); `disp_email_key` folds Gmail
dots and `+tags`. Same name + country is shown as "possible" only — never held on.

- `dispatcher_apply(submit)`: a match against any application that was ever submitted → the new one is saved, stays
  `applied`, gets a row in `app_private.dispatcher_dup_holds`, staff get one in-app notice, the applicant sees
  "we already have an application on file…". No e-mail is sent (no catalog row needed).
- `cc_dispatcher_decide` / `cc_dispatcher_test_invite` refuse to advance a held application.
- CC → dispatcher page → **Duplicate application / Identity & previous record** card (`cc_dispatcher_identity`): the
  earlier record with status, test score, attempts, trial window, delivered loads, reject note.
- Management decides (`cc_dispatcher_duplicate_resolve`): **Reactivate the original** (original → screening via
  `cc_dispatcher_decide`, duplicate stays closed) or **Allow this application** (→ screening, link kept). Reason is stored.
  An earlier record that is permanently blocked (upheld carrier report) cannot be bypassed either way.
- A rejected application now has a **Reactivate application** button on its own page (same `decide('screening')`; the old
  reject note is archived by bl_disp_0528, scores/trial stay).

### Known limits (say so, do not pretend)

- The phone is what the applicant typed — it is **not OTP-verified**. A new Gmail *and* a new number still gets through
  as a fresh application (the "same name" hint is the only signal). Closing that needs WhatsApp/SMS OTP or an ID number.
- The self-service re-apply on the SAME account (14-day cooldown, max 3 — bl_disp_0379) is unchanged. It keeps the full
  history, but it is not management-approved. Owner to decide whether trial-failed candidates should lose it.

## Applied

- Staging 11 Nov: applied (`execute_sql`, 3 batches); rolled-back E2E passed all 11 steps.
- Prod 11 Nov: applied; 8 stuck candidates back in screening; 18 open invitations extended to 5 days; anon SECDEF 36,
  names md5 unchanged; the 10 touched/new functions md5 = staging. Not in `supabase_migrations.schema_migrations`.
- Frontend is on branch `claude/tender-edison-al8jhv` — until it is merged to `main`, a held duplicate has no resolve
  card in CC (the DB still holds it and notifies staff).
