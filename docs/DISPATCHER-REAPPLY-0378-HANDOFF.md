# bl_disp_0378 — rejected dispatcher: premium status + gated re-application

Commit `8078c63` on `main`. Staging DB: **applied**. Production DB: **owner applies**.

## What changed

**Problem.** The rejection reason existed only as free text in `review_note`. bl_disp_0318 gave a
rejected applicant a way back in, but the re-application opened a *blank* form — nothing named the
reason, and nothing stopped the candidate from submitting the identical answers again.

**Now.**

1. **Rejected status is a premium panel** (not the flat `cp-card`): the decision, the team's own
   note in a bordered box, and the named points to close as pills. Compliance rules (which are for
   working dispatchers) no longer appear on a closed application.
2. **Re-apply card rebuilt premium**: cooldown shown as a progress meter with days left and the
   opening date, "answers kept" chip, re-applications remaining, one full-width CTA.
3. **The gate.** Once the candidate re-opens their application (`status = applied` and
   `reapply_count > 0`) a panel sits above the form with one checklist row per rejection reason.
   Each row states what to do, carries its own input where one is needed, and flips `!` → `✓` live.
   **Submit refuses** and scrolls to the first unmet gap with its specific message.
4. **The form is finally pre-filled** from the previous answers — which the re-apply card had been
   promising since bl_disp_0318 but nothing ever implemented. Documents on file show as on file.
5. **CC reject dialog** collects the reason codes alongside the candidate-facing note. The codes are
   saved *before* `decide('reject')`, so the portal has them the moment the applicant opens it.

## Reason codes → what the candidate must do

| code | gate |
|---|---|
| `no_own_board` | board answer = "My OWN paid subscription" + ≥1 board ticked + the login on that account |
| `no_booking_proof` | two loads they sourced and booked themselves (lane, broker, month, rate) |
| `experience` | years ≥ 1, trucks ≥ 1, and a real "why hire you" (≥ 200 chars) |
| `english` | English level Professional/Fluent + agrees to a recorded spoken broker role-play |
| `availability` | 40+ hours a week and US-hours overlap confirmed |
| `no_cv` | CV uploaded |
| `no_id` | government photo ID uploaded (required, not optional) |
| `inconsistent` | board answer set + confirms every answer was re-read |
| `other` | a written answer to the team's note (≥ 120 chars) |

Catalog lives in `app/agent/dispatcher-gaps.js` (`REASONS`) and is imported by both CC views and
validated again in SQL — add a code in all three or it is silently dropped.

**Candidates rejected before this** carry no codes, so the gate **derives** up to three from the
answers on the closed application (no own board / English / experience / no ID / no CV /
availability) and labels them "what is most likely holding your application back" — never as the
team's words. Setting explicit codes in CC always overrides the derivation.

The candidate's gate answers are written into `skills.reapply_gap` on submit, so CC can see the
board login, the booking proof and the acknowledgements they gave.

## Files

- `app/agent/dispatcher-gaps.js` — new: catalog, derivation, gate builder
- `app/agent/dispatcher-reapply.js` — premium rebuild
- `app/carrier/app.js` — rejected panel, prefill, gate wiring, submit gate
- `app/shared/ui/components.js` — `askReason({ reasons })` → resolves `{ note, reasons }`
- `app/shared/api.js` — `ccDispatcherSetRejectReasons`
- `app/command-center/views/dispatchers.js`, `dispatcher-360.js` — reject dialog
- `migrations/bl_disp_0378_reject_reasons.sql`

## Production apply (owner)

Run `migrations/bl_disp_0378_reject_reasons.sql` on `rwscphuhpjoudvljvmdk`. It is idempotent
(`add column if not exists`, `create or replace`). Then check the anon SECDEF surface is still **33**
by name, per `docs/audit-2026-09/anon-secdef-baseline.md` — the new function is authenticated-only
and must not appear there.

`cc_dispatcher_decide` was deliberately **not** given a new parameter, so the site deploy and the
migration can go in either order without breaking rejections.

## Not done

- The rejection e-mail (`app_private.disp_reject_email`) still shows only the free-text note. The
  coded gaps could be listed there too — a separate, small change.
- `python build_site.py` could not be run here: this machine's build refuses without
  `LOADBOOT_STAGING_ANON_KEY` (dev context) and the local env-config does not match a production
  build. All seven touched JS files were verified with **esbuild**, not just `node --check`.
