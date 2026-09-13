# Deletion suppression — staging checkpoint, September 13

Applied `20260913212633 / audit_deletion_outreach_suppression` to staging only. Production was not changed. Existing approved outreach remains enabled; no delivery worker, real sender, provider call or backfill was run.

Account deletion previously removed the contact without leaving a durable outreach exclusion. A later import could recreate an active contact. Staging also lacked the final marketing eligibility helper and its queue claim function ignored suppressions. Its system/transactional enqueue helpers blocked all suppression reasons, which would make a marketing-only opt-out block necessary transactional messages.

## Changes

| Function | Result |
|---|---|
| cc_account_deletion_process | Before removing CRM/outreach contact rows, inserts normalized email into the existing private suppressions table with reason unsubscribed if no matching suppression exists. Keeps stronger existing reasons. Cancels matching queued, claimed and scheduled marketing rows. Suppression write failure aborts the same deletion transaction. |
| cc_delivery_worker_claim | Excludes blocked rows before claim; closes queued blocked rows. Allows ordinary email transactions through marketing-only unsubscribed markers. Bounce, complaint, manual, unknown/null reasons and SMS suppressions remain blocking. |
| cc_delivery_worker_marketing_allowed | New service-only helper checks current status, suppression and outreach contact eligibility immediately before marketing send. No anon/authenticated EXECUTE. |
| sys_email | Same marketing-only versus stronger suppression distinction at enqueue. |
| cc_enqueue_transactional | Same scope distinction for staff enqueue; passing an outreach template still counts as marketing. Existing caller guard preserved. |

Marketing classification matches checked-in delivery-worker behavior: case-insensitive outreach prefix followed by dot, underscore or dash, or source campaign. Address comparisons trim and lowercase. This uses the existing suppression representation; no new ledger, blanket deletion, existing-contact backfill or retention schedule was introduced. A suppression retains the normalized email address and existing table metadata; it is not anonymous data.

An imported contact row can still exist or be marked active: its independent durable suppression keeps it ineligible. Existing outreach daily candidate source already excludes suppression-table matches. We did not run that sender or claim the live staging queue.

## Fresh verification

- Candidate migration in rollback transaction: **78 runtime assertions PASS**.
- Deployed functions: same **78 runtime assertions PASS** (61 ASSERT sites; failure and category loops execute the relevant sites multiple times).
- Positive deletion, reject/invalid/unauthorized cases and prior atomic rollback checks retained.
- Injected suppression-write and CRM/outreach failures preserve requested state and roll back profile, marker and pending-delivery changes together.
- Existing bounced marker preserved without duplicate; null request email does not select unrelated contacts.
- Durable marker survives contact removal/re-import/reactivation; three outreach prefix variants refused, eligible outreach and null-template campaign controls accepted.
- Queued/claimed/scheduled marketing cancelled; delivered history and ordinary transaction preserved.
- Opt-out after claim causes final marketing eligibility refusal.
- Ordinary transactional enqueue succeeds; marketing-through-transactional enqueue fails. Bounce/complaint/manual/null reasons and SMS opt-out remain blocking.
- Actual current claim **body** runs against a temporary copy of the delivery table, with no live rows. Both positive controls are claimed; six suppressed fixtures are closed. This is an isolated source contract check, not a live sender run.
- Rollback/reapply restores all five deployed function hashes. Exact anonymous name/argument list unchanged at **32**. Six security advisor notices unchanged, including [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Post-transaction: zero synthetic users or injected triggers. Synthetic queue/contact/suppression records are rollback-only.

Early test orchestration attempts failed before fixture execution due to a missing in-memory migration value and JavaScript replacement-token expansion. Corrected the harness to load the exact saved migration and substitute it literally; final candidate and deployed results above are actual successful reruns.

## Exact artifacts and rollback

- `supabase/migrations/20260913212633_audit_deletion_outreach_suppression.sql` (CLI originally named 20260913121306; aligned to actual service-applied version).
- `tests/deletion_outreach_suppression_2026-09-13.sql`: execute on staging as saved to test deployed code. For candidate rehearsal, replace the single MIGRATION_UNDER_TEST comment with the migration text literally, preserving SQL dollar quotes and regex dollar signs.
- `SUPPRESSION-BEFORE-2026-09-13.json` and `SUPPRESSION-AFTER-2026-09-13.json`: exact definitions, hashes, ACLs and anonymous inventory.
- `ROLLBACK-SUPPRESSION-2026-09-13.sql`: guarded code rollback only. Keeps existing suppressions and cancelled deliveries; never recreates contacts or replays queues. Explicit rollback approval required outside the completed rehearsal.

## Remaining limits

This closes the tested database suppression path on staging. Production promotion still requires specific approval and fresh source comparison. Production differs from staging; do not blindly apply this guarded stage-source migration there.

The checked-in delivery-worker calls the final eligibility helper before provider send. Live staging edge-source parity and real provider delivery were not verified here. A check cannot recall a message already accepted by a provider, nor make the check-to-network boundary atomic. No claim of zero possible in-flight delivery is made.

Unsubscribe parity is still separate: staging's public outreach_unsubscribe remains the historical status-only implementation. This migration covers deletion and delivery guards, not all unsubscribe entrypoints. Production already has a newer footer implementation. The remaining fire_comm_trigger/reminder/report consumers need scope review before claiming all transactional paths are equivalent.

Full account erasure still needs a storage manifest and actual object removal, retained-record decisions, supported session revocation, outstanding-JWT handling and a final completion gate. F10 intended role/type decision, browser/native-upload verification, CI/publication and Retell proof/cutover remain open. SEO/F33/WhatsApp remain parked.

Faida: deleted contact dobara import ho bhi jaye to marketing opt-out zinda rehta hai; aam transactional email us opt-out ki wajah se nahi rukti. Risk: yeh staging par verified hai; actual storage/session erasure aur provider/browser gates abhi baqi hain.
