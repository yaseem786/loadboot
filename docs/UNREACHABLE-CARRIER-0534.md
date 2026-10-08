# bl_disp_0534 — Unresponsive-carrier handling, daily trial report split, catalog counter fix, W-9 fix

Built 8 Oct 2026 on branch `claude/cool-cori-3aymt3`. **STAGING ONLY** (snslhvmkjusozgjelghi, applied as 0534a/b/c + two
follow-up patches). **Prod: the owner applies `migrations/bl_disp_0534_carrier_unreachable.PROD.sql`** (same SQL, prod header).
Reads with `migrations/bl_disp_0484_trial_daily_report.sql` and CLAUDE.md §6.

## 1. What is on staging

| Piece | Where | State |
|---|---|---|
| `dispatcher.carrier.unreachable` catalog e-mail (O, carrier, **send_mode test**) | migration §1 + `app_private.disp_unreachable_email` | catalog row in; rendered (see §3) |
| Auto-flag: `flagged_at` / `flag_reason` / `flag_cleared_at` / `flag_stats` on `dispatcher_assignments`, `disp_unreachable_eval/flag/clear/run`, cron `lb-disp-unreachable` (hourly :23) | migration §2 | flagged a throwaway assignment on staging, e-mail/notice/thread line/staff copy all fired |
| CC: flag badge + **End assignment — carrier unresponsive** (48 h, reason prefilled, calls the existing `cc_dispatcher_unassign`) | `app/command-center/views/dispatcher-360.js`, `dispatchers.js`; `cc_dispatcher_360` carries `flagged_at`, `flag_stats`, `unreachable_end_ready` | esbuild clean, not browser-tested |
| Dispatcher workspace card ("… is unreachable — we e-mailed them") | `app/agent/dispatcher-workspace.js`; `dispatcher_workspace_feed` carries `flagged_at`, `flag_stats` | esbuild clean, not browser-tested |
| Daily report: EFFORT + OUTCOME, "Blocked by carrier", paused days, effort-driven tone/subject/verdict | `disp_trial_stats` (replaced), `disp_trial_daily_build` (19 anchor patches), `disp_tdr_score` (+ `blocked`), `app_private.disp_trial_paused_days` | rendered (see §3) |
| Catalog sends counter | `email_catalog_touch` bumps at send; `cc_email_catalog` reads 30-day count live; cron `lb-email-catalog-sync` 03:40 UTC; index `md_template_key_at_idx` | staging: `dispatcher.trial.alert` went 0 → 1 on the first send |
| W-9 false blocker | `disp_carrier_ready` + `carrier_dispatcher_desk`: an `app_private.w9_submissions` row (carrier_id = org id) counts; detail "Signed <date>" | staging: "Signed 5 Jul 2026" on the e-signed test carrier |

Anon-executable SECURITY DEFINER surface on staging after everything: **35, same names**.

## 2. Decisions worth knowing

- **The flag is two columns, not a status.** The spec said the assignment "becomes carrier_unreachable"; `status` keeps its
  CHECK (`active|paused|ended`) and the one-active-per-carrier index, and `wa_route`, SMS routing and ~every dispatcher query
  filter on `status = 'active'`. `flagged_at` + `flag_reason = 'carrier_unreachable'` is the state; `flag_cleared_at` is history.
- **Rule** (hourly): ≥ 3 unanswered outbound attempts (answered_at null or duration ≤ 20 s) on ≥ 2 distinct ET days, 0 answered,
  and no carrier contact in the window (window = since assignment / last clear, max 14 days). Carrier numbers = owner phone +
  WhatsApp + drivers' phones, or any call tagged with the carrier org. **Contact** = answered call > 20 s, inbound call,
  inbound WhatsApp (thread with that carrier org/number), inbound SMS, carrier message in the thread, owner portal login.
- **Nothing auto-ends.** After 48 h with no contact CC gets the one-click button; it calls the existing `cc_dispatcher_unassign`
  with a prefilled reason (the "force" rule for moving loads still applies).
- **Paused days** are written by the hourly run (one row per dispatcher per ET day while any of their active assignments is
  flagged). The report subtracts them from the day count and paints them grey in the countdown after today.
- **Tone** = effort only: zero effort → bad; < 5 attempts → bad ("Low effort"); < 15 → warn ("Quiet day"); else good. Outcome
  never sets the tone. Minimum is `v_min_att := 15` in the build (one place).
- **Counter root cause**: `sends_total/sends_30d/last_seen` were only written by `email_catalog_sync()`, which nothing
  scheduled (prod: 44 `dispatcher.trial.daily` deliveries, catalog 0, last sync ≈ 22 Sep). Fixed for every key.

## 3. Staging test (8 Oct 2026, test dispatcher agent@lb.test + "TEST Carrier Co")

Throwaway: trial window on the test dispatcher, an assignment to TEST Carrier Co (and first to "Claude Test Carrier 0499",
which the rule correctly refused — that carrier had a real contact on staging that day), 3 unanswered outbound calls on
6–7 Oct (one voicemail) + 7 broker calls on 7 Oct. `disp_unreachable_run()` → `qualifies = true`, flagged, in-portal notice,
thread line, staff copy queued to hello@ (live key), counter bumped. No carrier e-mail went out because TEST Carrier Co
has no owner e-mail — the HTML was rendered straight from the builder.

Renders (desktop 1100 px + phone 390 px, Playwright) are in the session scratchpad:
`emails/unreachable-desktop.png`, `unreachable-phone.png`, `daily-desktop.png`, `daily-phone.png`.
Daily: "Day 3 of 14 · Quiet day: 9 call attempts (min 15)", Effort + Outcome blocks, every scorecard row "Blocked by carrier".
Oct 9 build also checked: 1 paused day, "Day 3 of 14" (not 4), tone bad "Low effort: 1 call attempt".

**Cleanup — what I could and could not do.** The MCP SQL tool holds every DELETE for a confirmation this session cannot give,
so the throwaway rows were neutralised with UPDATEs instead: the 13 test calls moved to the year 2000 (note
`zz_0534_test — throwaway, delete me`), both test assignments `ended` with `end_reason` 'zz_0534 staging test — throwaway, delete me',
flags cleared, the dispatcher profile restored (status skills_test, no trial window). **Please run this on staging once:**

```sql
delete from app_private.dialer_calls where note like 'zz_0534_test%';
delete from app_private.dispatcher_messages where assignment_id in (select id from app_private.dispatcher_assignments where sop ? 'zz_0534_test');
delete from app_private.dispatcher_assignments where sop ? 'zz_0534_test';
delete from app_private.disp_trial_paused_days where dispatcher_user_id = 'fde914d9-5792-44e5-89f6-050a614ed880';
delete from app_private.notifications where template_key in ('dispatcher.carrier_unreachable','dispatcher.carrier_reachable') and created_at::date = date '2026-10-08';
delete from app_private.message_deliveries where idempotency_key like 'disp.trial.alert:carrier_unreachable:%' and created_at::date = date '2026-10-08';
drop table app_private.zz_0534_test_backup;
```

## 4. Prod — in this order

1. Apply `migrations/bl_disp_0534_carrier_unreachable.PROD.sql` in the prod SQL editor (all anchors assert; it ends with one
   `email_catalog_sync()` run, the slow step). Check the anon SECURITY DEFINER **names** (36).
2. `dispatcher.carrier.unreachable` is `send_mode = 'test'` — the first real flag e-mails `[TEST → owner]` to hello@. Flip it to
   live in CC → Email catalog when the staging render is approved.
3. Andrew's W-9 rows: THE WAY HOME and SPRINT SHIFT read "Signed 30 Sep 2026" / "Signed 6 Oct 2026" the moment the function is in.
4. The next 8 AM report is already EFFORT/OUTCOME; the next Sync (or 03:40 UTC) fills `sends_30d` for every key.
5. Deploy the three JS files with the next site build (CC + agent portal).
