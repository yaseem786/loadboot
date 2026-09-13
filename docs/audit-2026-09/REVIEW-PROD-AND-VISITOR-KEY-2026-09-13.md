# September 13 audit checkpoint

Two specifically approved production fixes are applied. Remaining audit work continues; the audit is not closed.

## Production outcome

| Migration | Change | Fresh verification |
|---|---|---|
| 20260913111048 audit_outreach_reports_recovery | Adds cc_outreach_audience and cc_outreach_log_page plus nullable opened_at | Both exact function hashes/ACLs match staging; column nullable timestamptz; unauthorized authenticated caller refused, anon denied |
| 20260913111246 audit_dispatcher_test_execute_prod | Removes PUBLIC and anon EXECUTE on seven dispatcher RPCs | Exact bodies/authenticated/service grants unchanged and match staging; anon catalog 40→33 with exactly intended seven names removed |

Before deployment, both environments had received 0309's dispatcher start race guard. The prior hash guard correctly needed updating: reviewed current production source and changed ONLY the expected start hash to `1541febc44a85c680a98f03bd39b105e`. The adapted current-source staging rollback/reapply rehearsal passed before production apply. No function body was overwritten.

Production checks used a nonexistent synthetic identity and safe read/refusal paths within a rollback transaction. No customer fixtures, real account deletions, messages, provider calls or backfills. Outreach settings unchanged. Production security advisor still reports leaked-password protection disabled; this batch does not fix that setting.

Evidence: `PROD-BEFORE-2026-09-13.json`, `PROD-AFTER-2026-09-13.json`, `tests/dispatcher_acl_current_source_rehearsal_2026-09-13.sql`.

Rollback: dispatcher exact current-source rollback is `ROLLBACK-DISPATCHER-PROD-2026-09-13.sql`. Report rollback remains `ROLLBACK-F06-REPORTS-2026-09-12.sql`. Re-sync and obtain specific rollback approval before use; neither rollback was run on production.

Migration filenames now match actual production service versions. Report source formerly `20260912185723_audit_outreach_reports_recovery.sql` is now `20260913111048_audit_outreach_reports_recovery.sql`, unchanged SQL. CLI-created dispatcher file `20260913111134` was aligned to applied `20260913111246`. Historical staging migration `20260912190639` remains unchanged with its original hash guard.

## Additional F34 frontend fix

Latest main `4bb1c6f` merged at `c009a10`, preserving mobile/dispatcher changes. New `app/shared/ui/visitor-key.js` supplies one identity to callback and live-chat consumers. Uses 24 cryptographic random bytes (192 bits, 49 characters). Preserves existing valid 16–64-character keys and conversation history; refuses the known predictable novkey prefix. Rotated invalid identities clear the old conversation pointer when storage works. Storage exceptions retain the random identity in page memory; page reload without storage starts a new identity. Crypto unavailable means clear visible error and no request, never predictable fallback.

Marketing pages load the provider before chat core; portal module imports it before core. Callback uses the same provider. Existing analytics IDs are not visitor-key bearer credentials and are unchanged.

| Fresh local check | Result |
|---|---|
| Visitor-key and actual generated callback/core behavior | 21 PASS |
| Prior save/shipper/privacy/update/verdict regression cases | 40 PASS |
| Actual-source IP parsing cases | 30 PASS |
| JS syntax and import checks | 160 files PASS; imports PASS |
| Build using actual staging publishable key | PASS |
| Browser / native sharing / live upload | UNVERIFIED; previous preview access blocked |

Callback tests stub transport; no real call request. CI runs visitor tests after staging build, because callback tests inspect actual generated contact.html. Frontend has not been deployed, public push remains blocked by the previous automatic disclosure review, and CI is not activated.

## Remaining gates

- F08/F09/F18/F31/F34 frontend: actual staging browser/native-sharing/upload checks, permitted publication/CI setup, then explicit production deployment approval.
- Live-chat database/edge corrections and save throttling: staging evidence does not authorize production promotion. Preserve prior sources/settings for rollback.
- F10: intended role/document permissions decision must cover every OR-combined access route; no isolated blanket-policy removal.
- Account deletion: full storage erasure, durable suppression, retention decisions and old-session/JWT handling remain unproven. Existing corrected SQL is not complete erasure.
- Retell: real signed delivery proof and separate cutover approval; no automatic real call or observe-mode closure.
- Password protection, legal/fees/claims, backup restore, performance and accessibility still need their own evidence or decisions.
- SEO/F33/WhatsApp remain parked; approved outreach stays enabled.

Faida: production reports ab available hain aur anonymous callers dispatcher-test functions tak nahi pohanch sakte. Chat/callback ki nayi temporary identity secure randomness se banti hai. Baqi risk: frontend abhi live nahi, aur browser, document-access, account-erasure aur Retell ke open gates ko alag verify karna hai.
