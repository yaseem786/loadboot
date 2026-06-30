# Command Center V1 — PRODUCTION-SAFE DELTA (rollout package)

Exact delta to take **production** (`quickfreights-portal` / `rwscphuhpjoudvljvmdk`) from its current
source-of-truth to Command Center V1. **NOT applied yet** — Phase 2 executes this after the pre-write
checks below. Production already carries the base schema + Phase-1 + Stage-1 + 0012B contract (see
`docs/PRODUCTION-SOURCE-OF-TRUTH.md`), so the delta is **additive RBAC/audit/operator layer only**.

## Apply order (production-safe, reviewed)
1. `migrations/0015_organizations_and_rbac.sql`
2. `migrations/0016_permission_scope_helpers.sql`
3. `migrations/0017_audit_foundation.sql`
4. `migrations/0018_feature_flags_and_settings.sql`
5. `migrations/0019_privileged_action_audit.sql`
6. `migrations/0020_staff_directory_reads.sql`
7. `migrations/cc-v1-staging/0030_operator_surface.sql`  (reviewed CC operator RPCs)

Then: provision the first **real** production Owner via trusted, recorded owner SQL (NOT
`provision_staging_owner`). Keep `command_center_enabled = OFF` until browser smoke tests pass.

## EXCLUDED from production (must NOT be applied)
- `staging-baseline.sql` (production already has the base schema) — **never apply to prod**
- `cc-v1-staging/0029_drop_experimental_leftovers.sql` (prod has no experimental 0021–0026 leftovers)
- `cc-v1-staging/0031_provision_staging_owner.sql` (staging-only; hard-rejects prod anyway)
- `cc-v1-staging/0032_profile_write_contract.sql` (prod already has 0012B active — would be a no-op,
  excluded for clarity)
- demo carriers/loads/documents · synthetic Owner/Dispatcher rows · `SMOKE-TEST.sql`
- experimental `0021`–`0026` · any fake analytics/content RPCs

## Pre-write checklist (Phase 2, before any production DDL)
- [ ] Confirm production **backup / PITR** point exists; record timestamp + ID privately.
- [ ] Record current production **schema fingerprint** (object inventory hash).
- [ ] Confirm **rotated credentials**; the exposed key is revoked (returns 401).
- [ ] Confirm production **0012B/0013a postconditions** still active (no drift).
- [ ] Confirm the delta carries **no demo/synthetic/staging data**.
- [ ] `is_admin()`-based legacy paths unaffected; new objects additive only.

## Frontend
Deploy the **exact** reviewed frontend to **ops.loadboot.com** (separate surface; NOT in the public
marketing nav). Shared production Supabase backend with the Carrier Portal. Production build context →
production project; `command_center_enabled` OFF until the production smoke tests pass, then ON.

## Production smoke tests (required to flip the flag ON)
Owner login · Overview real counts · Carriers list/detail · approve/reject/pause · Documents review ·
Loads create/detail/assign · Dispatch status movement · Staff & Roles · Audit · Feature Flags · Settings ·
Dispatcher restrictions · Carrier denied · Anonymous denied · zero production console errors · zero
staging network calls · no service-role key in frontend. → **COMMAND CENTER V1 PRODUCTION GATE: PASS**.
