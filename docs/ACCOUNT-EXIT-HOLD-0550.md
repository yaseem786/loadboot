# bl_acct_0550 — carrier exit hold

When someone files an account-deletion request, every LoadBoot touchpoint aimed at them stops on its own, and any
dispatcher working their carrier is released with a detailed, **reason-free** e-mail. Migration:
`migrations/bl_acct_0550_carrier_exit_hold.sql` (staging applied + tested 15 Oct 2026; **prod: owner runs the file**).

## 1. Inventory — every way LoadBoot reaches a carrier (prod, 15 Oct 2026)

Found from `cron.job` (67 active jobs) and every `public`/`app_private` function that writes to an outbound queue.

| Channel | Where it is queued | Who writes it | How the hold stops it |
|---|---|---|---|
| E-mail via catalog | `app_private.sys_email` → `message_deliveries` | carrier_expiry_notify_run (lb-expiry-reminders), cc_run_onboarding_reminders, cron_packet_revalidation, cron_expired_load_nag, cron_offer_expiry_warnings, cron_pickup_watch, cron_rating_invite, pay_confirm_nag, outreach_run_daily, weekly_send_run, lc_* follow-ups, disp_notify, every event e-mail | check in `sys_email` (non-essential → `email_blocked_log`, code `carrier_exit_hold`) |
| E-mail bypassing `sys_email` | direct insert into `message_deliveries` | fire_comm_trigger, reminder_dispatch, lb_email_notify, cc_enqueue_transactional, cc_campaign_enqueue (cron_trip_comm / cron_compliance_scan / cron_tracking_blackout / cron_sla_escalation reach these) | BEFORE INSERT guard `a1_comm_hold_guard` → `status='suppressed'`, `failure_reason='carrier exit hold'` |
| Carrier SMS | `doc_sms_queue` (document texts + the SMS that rides a carrier e-mail, bl_dial_0550) | doc_sms_sweep, email_sms_note / email_sms_sweep | first reason in doc_sms_sweep + BEFORE INSERT/UPDATE guard → `skipped`, "Account closing — no texts." |
| WhatsApp auto | `wa_auto_outbox` | wa_auto_on_assignment (trigger), wa_auto_enqueue, wa_auto_sweep | guard → `skipped`, "Account closing — no messages." |
| Riley outbound | `riley_call_plans` → `lc_calls` → `retell_dial` | riley_plan_sweep, riley_followup_*, voice_run_scheduled, lc_call_followup | plans cancelled at hold time + guard on new/advancing plans + `retell_dial` refuses a held org/number. Inbound (`retell_inbound`) untouched |
| Push | `push_outbox` | push_enqueue (all senders) | guard drops the row; queued rows marked skipped |
| Dispatcher | assignment, thread, posted loads, bookings | dispatcher_post_load, disp_trial_daily_run, disp_unreachable_run | assignment ended (feeds show `status='active'` only); `dispatcher_post_load` refuses a held org |
| In-app notifications | `app_private.notifications` | many | **not stopped** — not outbound; the person may still open the portal to cancel |

Essential mail still goes: `account_critical`, `billing`, `staff_internal` (the deletion receipt itself is account_critical).

**Recipient-set filters vs a choke point.** The brief asked for a check "where the recipient set is built" in every
reminder / nag / drip cron. I put the check at the queues every one of those crons must write to instead (sys_email +
a BEFORE INSERT guard on each outbound table). That is one check per channel instead of ~15 per-cron patches, and a cron
added next month is covered without anyone remembering this file. Per-cron filters can be added later if wanted; the
guards stay as the backstop either way.

## 2. What happens on a request

`request_account_deletion` → (after its own receipt e-mail) `app_private.on_account_deletion_requested(id)`; a failure
there never fails the request — staff get "Exit hold FAILED" instead.

1. **Held orgs** = orgs the requester owns, or where no other active non-driver member speaks for the org. A driver or an
   office member deleting their own login holds **only themselves** (tested). One `comm_holds` row per request × org
   (user-only row when no org), with every member e-mail and phone (profiles + auth metadata, E.164).
2. Queued non-essential e-mail, doc SMS, WhatsApp, push for those people → suppressed/skipped. Riley plans not yet
   dialled → `cancelled` ("Account closing — no calls."), proposed follow-ups dismissed.
3. Each `active`/`paused` dispatcher assignment of a held org:
   - `status='ended'`, `end_reason='loadboot: carrier exit'`, contact release revoked;
   - the dispatcher's open posts for that org → `withdrawn` (by_role LoadBoot);
   - their bookings in `pending_rc` → `cancelled`, `cancel_reason='loadboot: carrier exit'` (a carrier_accepted load
     behind one → `cancelled`); **bookings past pending_rc (rc_received / approved / dispatched / picked_up) are left
     alone** and listed to staff as MOVING FREIGHT;
   - system thread line: "LoadBoot ended this assignment. Please do not contact this carrier again by any channel.";
   - dispatcher in-app notice + e-mail `dispatcher.assignment.ended.carrier_exit` (email_kit; account_critical);
   - audit `dispatcher.assignment_ended` ("assignment ended by LoadBoot").
4. Staff in-app + e-mail `account.exit_hold.applied` with the per-carrier summary.

**The reason never leaks**: not in the e-mail, the thread, the in-app notice or the audit summary. Dispatcher 360 and
the activity feed show "Ended by LoadBoot". `disp_trial_stats` ignores bookings cancelled by the hold, and an ended
assignment already drops out of the trial's carrier count.

Cancel (`cancel_account_deletion`) or a staff **reject** → `comm_hold_lift`: hold lifted, staff notice
`account.exit_hold.lifted` ("reassign manually if wanted"). Assignments are not restored.

## 3. CC

CC → Deletion requests → a request: **Automatic actions** card (hold time, each dispatcher released, posts withdrawn,
bookings cancelled, moving freight, Riley plans, lifted time). A request filed before this migration (e.g. #16) shows
**Apply exit hold now** (confirm, size sm) → `public.cc_account_exit_hold_apply` (carriers.approve or finance.approve).
Nothing is applied to existing requests automatically.

## 4. Catalog rows (§6)

| key | class | group | trigger |
|---|---|---|---|
| `dispatcher.assignment.ended.carrier_exit` | T | account_critical (unsub false) | app_private.on_account_deletion_requested |
| `account.exit_hold.applied` | S | staff_internal | on_account_deletion_requested → disp_notify |
| `account.exit_hold.lifted` | S | staff_internal | comm_hold_lift → disp_notify |

## 5. Staging test (15 Oct 2026, one rolled-back transaction; throwaway carrier + dispatcher, nothing left behind)

Request → assignment `ended` / end_reason internal tag / contact release revoked; open post `withdrawn`; pending_rc
booking `cancelled` (cancel_reason set); dispatched booking untouched and reported as moving; Riley plan cancelled;
doc SMS `skipped` "Account closing — no texts."; dispatcher e-mail queued (body checked: no reason, no "delet");
dispatcher in-app 1; staff summary with MOVING FREIGHT line. After the hold: `onboarding.reminder` and
`compliance.expiring` blocked into `email_blocked_log` (code carrier_exit_hold), `account.closed` delivered; raw
`message_deliveries` insert suppressed; push row dropped; `retell_dial` → `cancelled` without dialling; new Riley plan
cancelled; new doc SMS skipped; `dispatcher_post_load` refused; second apply = `already_applied`. Cancel → hold lifted,
staff notice, assignment stays ended. Driver-only request: only the driver held, employer org and owner not held.
Anon SECDEF in public on staging: 35, names unchanged; `cc_account_exit_hold_apply` not anon-executable.

## 6. Prod — APPLIED 15 Oct 2026

Applied on prod (`rwscphuhpjoudvljvmdk`) on 15 Oct 2026. Verified after the run: anon SECURITY DEFINER count 36 and the
names match `docs/audit-2026-09/anon-secdef-baseline.md`; 5 `a1_comm_hold_guard` triggers; function md5s identical to
staging. Request #16 (T STRICK TRANSPORT LLC): **Apply exit hold now** pressed in CC at 20:17:59 UTC (audit 6314); the
dispatcher-release email to Andrew Higgins was delivered at 20:18:01 UTC and carries no word of the reason.

Steps as run (kept for reference / a re-apply):


1. Supabase → prod (`rwscphuhpjoudvljvmdk`) → SQL editor → paste **all of** `migrations/bl_acct_0550_carrier_exit_hold.sql`
   → Run. It is one transaction; any anchor that moved aborts the whole file (all 11 were checked on prod 15 Oct: each
   found exactly once).
2. Verify:
   ```sql
   select count(*) as anon_secdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');   -- must be 36
   select has_function_privilege('anon', 'public.cc_account_exit_hold_apply(bigint)', 'execute');      -- must be false
   select key, class, preference_group from app_private.email_catalog where key like 'account.exit_hold.%' or key = 'dispatcher.assignment.ended.carrier_exit';
   select tgrelid::regclass, tgname from pg_trigger where tgname = 'a1_comm_hold_guard';                -- 5 rows
   select count(*) from app_private.comm_holds;                                                          -- 0 (nothing applied to #16)
   ```
   and compare the anon NAMES with `docs/audit-2026-09/anon-secdef-baseline.md`.
3. Request #16 stayed untouched until **Apply exit hold now** was pressed on it in CC (done 20:17:59 UTC, above).

Rollback: drop the five `a1_comm_hold_guard` triggers; re-create the 11 patched functions from their previous
definitions (anchor-replace back); `update app_private.email_catalog set status='retired'` for the three keys.
