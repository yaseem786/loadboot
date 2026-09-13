# Account-deletion cleanup correction — staging

Applied `20260913113248 / audit_deletion_cleanup_atomic` on staging only. Production is unchanged this turn and remains at the two previously approved September 13 packages.

The current deletion processor caught every error from CRM/outreach cleanup and continued to mark the request completed. A rollback-only baseline probe reproduced it: injected CRM deletion failure, response completed, both contact records still present.

The narrow correction removes that exception-swallowing block and records per-table deletion counts. A CRM or outreach error now aborts the whole function call: earlier profile/document changes roll back and the request remains requested. A later successful retry performs the existing cleanup. Authorization, row lock, action/rejection validation, unrelated rows and grants remain intact. No sender settings changed.

## Fresh verification

- Old-source bug reproduced with synthetic fixtures; transaction rolled back.
- Candidate migration + actual processor: **36 runtime assertions PASS** (29 ASSERT sites; seven failure assertions run for each of two tables).
- Deployed processor: same **36 assertions PASS**.
- Positive successful cleanup, both injected cleanup failures, retry, unrelated record preservation, missing email, nonstaff refusal, ACLs, invalid/null actions, reject-with-reason, duplicate completion refusal and exact anonymous surface comparison covered.
- Rollback then reapply rehearsal PASS; restored deployed hash.
- Security advisor comparison: six notices before/after with identical identities; leaked-password protection warning remains open ([setting reference](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).
- Post-test: **zero synthetic users and zero injected test triggers**. Anonymous surface remains exactly 32 names. All synthetic changes rolled back; no real account, document object, customer message, call or backfill used.

Source md5 before `555b32439b095bf930317f2ec81c1902`; after `98259dd3b5c3f3d5dca8aae02743730c`. ACL remains postgres/authenticated/service_role EXECUTE. Migration source created through CLI as 20260913112855 and renamed to actual applied service version 20260913113248.

Files: migration in supabase/migrations; tests `tests/deletion_cleanup_atomic_2026-09-13.sql` (deployed test; replace MIGRATION_UNDER_TEST marker with candidate migration for preapply rehearsal); historical reproduction `tests/deletion_cleanup_baseline_2026-09-13.sql`; exact old body `DELETION-SOURCE-BEFORE-2026-09-13.sql`; post-catalog `DELETION-AFTER-2026-09-13.json`; guarded rollback `ROLLBACK-DELETION-ATOMIC-2026-09-13.sql`. Rollback is saved, not authorized for production.

## Remaining account-erasure work

This closes false success for failed marketing cleanup, not full account erasure. A completed response still represents the existing processor's limited scope.

- Storage: document metadata is currently removed without deleting object bytes. Capture an authoritative object manifest before metadata removal; classify retained trip/financial evidence separately; use the Storage API and verify results before final completion. Do not delete storage.objects metadata as a substitute for deleting files.
- Sessions: current auth-row anonymization/ban does not establish invalidation of all sessions or outstanding access JWTs. Design supported session revocation and sensitive-operation session checks; retained foreign keys currently require an auth tombstone. Do not blindly delete that auth row.
- Suppression: current cleanup removes marketing contacts. A later import may recreate eligibility. Design a protected durable suppression record plus importer/sender enforcement before claiming suppression persists after erasure.
- Retention: owner/legal decisions must define retained fields/documents and periods. This change approves no retention duration and performs no backfill.
- Completion state: full workflow needs durable resumable steps and a final completion gate covering those outcomes, with observable retry errors. Do not apply staging deletion corrections to production as if these gaps were solved.

Current official references: [Supabase user deletion/session caveats](https://supabase.com/docs/guides/auth/managing-user-data), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control). Changelog index fetch was partial due timeout; scanned retrieved current section and found no applicable change to this existing PL/pgSQL exception correction. No SDK or Auth feature was introduced.

F10 matrix has also been recovered from live catalog: `F10-DOCUMENT-ACCESS-MATRIX-2026-09-13.md`. Intended role/type access remains a decision; no policy has been altered.

Faida: cleanup fail ho to jhoota completed result nahi aayega; request retry ke liye open rahegi. Risk: files ka actual erase, session invalidation aur durable suppression abhi poore nahi; isliye full deletion finding open hai.
