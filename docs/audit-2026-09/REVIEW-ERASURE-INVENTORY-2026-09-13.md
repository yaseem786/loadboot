# Account-erasure inventory guard — staging checkpoint

Applied 13 September 2026; checkpoint completed and live hashes rechecked 14 September 2026.

## Outcome

Staging migration `20260913220810 / audit_erasure_inventory_gate` records candidate file references before destructive account cleanup. A request with any saved references remains `requested` and returns `ERASURE_REVIEW_REQUIRED`. Existing rejection behavior and no-file cleanup remain available. Production was not changed.

The private, RLS-enabled inventory is append-only across attempts. It captures public document metadata (including missing paths), Storage owner/prefix references, document_files upload/organization/trip references, known agent payout document references, and linked onboarding document references. These are candidates for review, not proof of ownership or permission to delete. Only reference metadata is retained; file contents and full payout payloads are not copied. No public read/write endpoint or override flag is provided. PUBLIC, anon, authenticated and service_role have no direct inventory-table or capture-helper privileges.

The actual client API wrapper now rejects missing, contradictory and structured failure results. A review-required result cannot become success at that wrapper. No current screen caller was found; browser UI behavior remains unverified. Frontend changes are local only.

## Evidence

| Verification | Result and date |
| --- | --- |
| Candidate + deployed staging rollback suites | 35 runtime assertions each PASS, Sept 13 |
| Empty-inventory rollback/reapply | PASS, Sept 13; exact source/grants restored |
| Populated inventory rollback refusal | 2 assertions PASS, Sept 13; evidence retained |
| Actual-source API contract | 10 PASS Sept 13; 10 independently rerun PASS Sept 14 |
| Combined UI/privacy suite | 71 PASS, Sept 13 |
| Staging-key build | PASS, Sept 13 |
| Syntax/import checks | 160 JS files + imports PASS, Sept 13 |
| Anonymous SECURITY DEFINER names/arguments | Identical before/after, 32, Sept 13 |
| Security advisor identities | Six before/after, no new identities, Sept 13 |
| Fixture cleanup | Zero inventory rows, synthetic users and test triggers, Sept 13 |

Historical Sept 13 results above are not represented as new Sept 14 runs. Sept 14 live re-sync confirms staging still has the deployed hashes below. Latest prod migration remains `20260913214706 / bl_disp_0314_score_email_on_save`; its deletion function remains `9e766c95a2a99b5427bf83a1c00a7533`.

- Previous staged processor: `1b064d8662a4b4c2e9b3bc2cdb684f7f`.
- New staged processor: `3fe3cbac599f19e28d6f4a41109e82ad`.
- Capture helper: `d6fd7d1c2e24a3a9d81ff763f49e089f`.

Tests use rollback-only synthetic records and a temporary Storage metadata fixture; no real object is uploaded, downloaded or deleted. No real customer diagnostics, provider calls, messages or backfills.

## Exact package and rollback

- `supabase/migrations/20260913220810_audit_erasure_inventory_gate.sql`
- `docs/audit-2026-09/tests/erasure_inventory_gate_2026-09-13.sql`
- `docs/audit-2026-09/tests/erasure_inventory_rollback_refusal_2026-09-13.sql`
- `docs/audit-2026-09/ERASURE-INVENTORY-BEFORE-2026-09-13.json`
- `docs/audit-2026-09/ERASURE-INVENTORY-AFTER-2026-09-13.json`
- `docs/audit-2026-09/ROLLBACK-ERASURE-INVENTORY-2026-09-13.sql`
- `app/shared/api.js`, `tests/account_deletion_result_test.mjs`, `package.json`.

Rollback SQL checks both deployed hashes, refuses if ANY saved inventory row exists, restores the previous processor, then drops the empty helper/table. A populated rollback needs a separate evidence-preserving plan. Production promotion and production rollback are not authorized by this checkpoint.

## Remaining limits and next work

This is an inventory/refusal guard, not a completed erasure workflow. Saved references intentionally continue blocking even when source metadata disappears. A reviewed retention/removal-proof workflow is required to finish those requests. Coverage must expand to remaining indirect invoice/load/payment references. Concurrent uploads still require an upload freeze and final rescan. No-file completion does not establish full erasure or session invalidation.

Next: verify sensitive RPC/RLS behavior for previously issued JWT claims after a ban, then implement a staging-first access gate with positive controls. Auth session revocation, edge/Storage access, final completion, retention decisions and actual Storage API removal remain separate work. Supabase documents why strict sign-out protection needs a current session lookup: https://supabase.com/docs/guides/auth/sessions . Storage SQL metadata must remain read-only: https://supabase.com/docs/guides/storage/schema/design .

## Faida aur baqi risk

Faida: account ki safai se pehle files ke references bach jate hain; file review baqi ho to deletion ko successful nahi bataya jata. Risk: files abhi asal storage se remove nahi hotin, purane login session ka access aur retention decision baqi hain. Is liye full account-erasure audit abhi open hai. Prod aur outreach settings unchanged hain.
