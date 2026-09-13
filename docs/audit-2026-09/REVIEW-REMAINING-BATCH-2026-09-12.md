# Remaining audit batch — 12 September 2026

## Result and scope

Branch `audit/recovery-20260912`, current-main base `90ccaff`. Other lanes' source was preserved. F08/F09/F18/F31 frontend changes have now been reconstructed against current main. F06 report package has been recovered and tested. Seven dispatcher-test EXECUTE grants were narrowed on STAGING only. Full audit is not closed.

No production migration, deploy, backfill, real provider call, customer message or email was performed. Outreach stays enabled. SEO/F33/WhatsApp remain parked. No public push: the existing approval-review block on security disclosures remains unresolved.

## Changes completed locally

- F08: generated public/app workers no longer call skipWaiting during install. Activation requires a message. Each open tab asks before reloading; a different tab's update cannot reload an unfinished form without its own consent. Marketing worker cleanup is restricted to its own cache family and its fetch handler excludes `/app/`.
- F09: logout purges temporary shares before waiting for Auth, and clears both actual `lb-auth-*` tokens and legacy `sb-*-auth-token` keys from local/session storage. CDN/client failure does not skip cleanup. Sibling-tab token removal invalidates pending session reads. Global logout reports when remote revocation could not be confirmed instead of claiming every device was signed out.
- F09 sharing: temporary file is bound to the current account and a random owner nonce, maximum 25 MB, with a 15-minute maximum lease. The worker checks ownership before reading form bytes and before/after writing the cache. Signed-out, expired, legacy/unowned and wrong-account files are refused. Upload checks the account again after async lookup. Account switch/logout purge the copy. Expired bytes are removed on the next inbox read/share/logout; exact disk deletion while the app is closed is not guaranteed. The original phone file is untouched. UI explains expiry/logout removal and how to re-share after refusal.
- F31: all four precheck upload paths include the AI verdict in the document insert. The existing server trigger (freshly confirmed on BOTH projects) stamps client provenance. No second metadata write or invented server verification. SQL errors remain visible.
- F18: actual workflow prepared with read-only permissions, no deploy step, syntax/import/UI/privacy checks, actual-source IP cases and a staging build. Missing staging key fails the build. Workflow activation/repository variable configuration are NOT claimed complete because nothing was pushed.
- F06 UI: unavailable/denied/malformed audience reports clear stale totals and show an alert.

## Fresh verification

| Check | Result |
|---|---|
| UI/privacy/session/share/update/verdict/report regression cases | 40 PASS |
| Actual domain-check source IP cases | 30/30 PASS; copied classifier removed from the test |
| JavaScript syntax / import-reference gate | 158 files PASS / PASS |
| Final staging build | PASS; built changed modules match reviewed source |
| F06 staging transaction | Missing functions + missing column creation, repeat apply, exact source/grants, active allowed staff, explicit deny, suspended/nonstaff refusal, anon refusal, pagination, unchanged anonymous function names, rollback/reapply PASS |
| F06 cleanup | Zero synthetic auth users remain; original staging source hashes and opened_at column restored |
| Dispatcher ACL pre-apply test | All seven existing anon guards refused; ACL-only change, exact anonymous-name delta, unchanged bodies/auth/service grants and signed-in empty-state/nonstaff checks PASS |
| Dispatcher deployed rollback/reapply rehearsal | PASS; outer transaction restored the deployed narrowed grants |
| Browser / native sharing / real HTTP document upload | Still UNVERIFIED: prior same-session local-preview navigation returned ERR_BLOCKED_BY_CLIENT. Not counted as PASS. |

Tests use synthetic fixtures and isolated source/DOM/cache models, not real customer accounts. F06 test fixtures join the existing internal organization only within the rolled-back transaction; the existing organization is never edited. Two initial F06 rehearsals failed on missing statement separators and the one-internal-organization constraint; both were corrected before the successful runs. No failing run is counted as PASS.

## Production-ready database batch for explicit approval

Apply these independently with the migration tool, never the old broad outreach batch:

1. `supabase/migrations/20260913111048_audit_outreach_reports_recovery.sql` (originally 20260912185723; filename aligned after approved September 13 production apply)
   - Adds the nullable `app_private.outreach_contacts.opened_at` column; no backfill.
   - Creates only `cc_outreach_audience(integer)` and `cc_outreach_log_page(text,text,integer,text,integer,integer)` from fresh staging definitions, retains permission guards, grants authenticated/service access and denies PUBLIC/anon.
   - Fresh production catalog: both function names absent, column absent.
   - Guard refuses a different existing definition or incompatible column shape. It does not change sending, volumes, schedules or outreach settings.
   - Rollback: `ROLLBACK-F06-REPORTS-2026-09-12.sql`, ONLY when both functions and the column were absent before promotion. Rollback refuses changed function definitions and refuses to discard non-null opened_at values. If engagement data arrives after promotion, retain it and review rollback instead of forcing a drop.
2. `supabase/migrations/20260912190639_audit_dispatcher_test_execute_boundary.sql`
   - Revokes only PUBLIC/anon EXECUTE on seven dispatcher-test RPCs that already require sign-in or staff authorization.
   - Current production and staging body hashes match exactly. Authenticated/service grants and every function body are unchanged.
   - Rollback: `ROLLBACK-DISPATCHER-TEST-ACL-2026-09-12.sql`, guarded by exact body hashes and restoring the prior grants. It intentionally restores the previous broader grants; use only with explicit rollback authorization.

Before production application: re-read current definitions and migration head, run the guards and capture pre-change ACLs/column existence. Use the existing staging tests and post-apply source/grant/name checks. Production mutation approval remains REQUIRED under Yaseen's standing instruction. These approvals do not include frontend deployment, Retell cutover, messages or public GitHub publication.

## Exact live checkpoint

- Production newest migration: `20260912072013 / bl_disp_0308_skills_test_sweep` — untouched here.
- Staging newest migration: `20260912190639 / audit_dispatcher_test_execute_boundary` — APPLIED here. The CLI initially generated 190502; local source filename was aligned to the actual MCP-applied history version 190639.
- Anonymous SECURITY DEFINER names: staging 39 before → 32 after; production 40. The extra seven names are dispatcher-test functions, not added by the F06 package. The name-level delta was tested; do not blindly change the approved prod baseline from 33 to 40.
- Production 24h operational snapshot: 43 active cron jobs; 15,613 successful runs, zero failed. This is an observation, not a restore/monitoring certification.
- Security advisors were read for both projects and again after staging ACL deployment. Leaked-password protection warning remains on both. No configuration setting was changed or declared enabled.

## Remaining gates and work

| Area | Remaining |
|---|---|
| This frontend / CI | Accessible staging browser/native-share/upload tests; publication approval/access and CI variable setup; then production deploy approval. |
| F06 and dispatcher grants | Explicit approval for the two concrete production migrations above. |
| Live-chat 0335/0336/0344 | Staging/backend fixes remain separate from production promotion; preserve old edges/settings and verify actual upload path. |
| F10 document access | Role-by-document matrix and intended access decision; account for independent staff/support/auditor/dispatcher policy paths. No blind policy revoke. |
| Account deletion | Storage-object erasure, retention rules, durable suppression and old-session/JWT invalidation are still not fully proven. Previous SQL fixes do not close this whole finding. |
| Retell | Real signed provider proof, credit/access and separately approved cutover; old paths and observe mode stay until those conditions are met. |
| Password protection | Warning confirmed; actual dashboard/plan setting access and approved configuration work remain. |
| Legal, fees, broader claims | Owner/legal decisions and broader F11/F13 review remain. Domain badge correction alone does not close these. |
| Operations/performance/accessibility | Backup restoration, measurement and relevant browser checks remain open; a successful cron snapshot is insufficient to close them. |
| Parked work | SEO/F33/WhatsApp parked; outreach remains enabled. |

## Verification and evidence files

- `tests/audit_pwa_privacy_test.mjs`
- `tests/onboarding_save_queue_test.mjs`, `tests/shipper_trust_render_test.mjs`
- `docs/audit-2026-09/tests/domain_check_v4_ip_cases.mjs`
- `docs/audit-2026-09/tests/f06_reports_recovery_rollback_2026-09-12.sql`
- `docs/audit-2026-09/tests/dispatcher_test_acl_rollback_2026-09-12.sql`
- `docs/audit-2026-09/tests/dispatcher_test_acl_deployed_rehearsal_2026-09-12.sql`

Build first with the actual staging key in `LOADBOOT_STAGING_ANON_KEY` and `CONTEXT=deploy-preview`, then run the privacy test because it evaluates the generated workers. Do not commit generated site files or credentials.

Official Auth semantics checked: https://supabase.com/docs/reference/javascript/auth-signout . Remote logout does not instantly invalidate already-issued access JWTs; complete account erasure must handle that separately. Supabase changelog reviewed for applicable breaking changes; no new client package was installed.

## Faida aur risk

Form doosre tab ke update se achanak reload nahi hoga. Logout par asal login keys aur temporary shared files saaf hongi; file doosre account ko upload nahi hogi. Reviewer ko upload ke waqt ka AI result milega. Missing report zero/blank ka dhoka nahi degi. Browser/native-upload verification abhi baqi hai; production aur complete account-deletion protection ka daawa nahi hai.

September 13 update: both specifically approved production packages are now applied and independently verified. See `REVIEW-PROD-AND-VISITOR-KEY-2026-09-13.md`; approval-pending statements above describe the September 12 checkpoint.
