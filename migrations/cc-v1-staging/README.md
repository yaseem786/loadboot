# Command Center V1 — staging backend (source of truth)

This is the exact, source-controlled SQL for the V1 Command Center backend **as applied to staging**
(`snslhvmkjusozgjelghi`) via the Supabase MCP. Applied order and the ledger names recorded on staging:

| Ledger name (staging) | Source file |
|---|---|
| `cc_v1_0000_staging_app_baseline` | `../../docs/recreation-test/staging-baseline.sql` (Supabase-safe app baseline) |
| `cc_v1_0015_organizations_and_rbac` | `../0015_organizations_and_rbac.sql` |
| `cc_v1_0016_permission_scope_helpers` | `../0016_permission_scope_helpers.sql` |
| `cc_v1_0017_audit_foundation` | `../0017_audit_foundation.sql` |
| `cc_v1_0018_feature_flags_and_settings` | `../0018_feature_flags_and_settings.sql` |
| `cc_v1_0019_privileged_action_audit` | `../0019_privileged_action_audit.sql` |
| `cc_v1_0020_staff_directory_reads` | `../0020_staff_directory_reads.sql` |
| `cc_v1_0029_drop_experimental_0021_0026_leftovers` | `0029_drop_experimental_leftovers.sql` (NEW) |
| `cc_v1_0030_operator_surface` | `0030_operator_surface.sql` (NEW, reviewed replacement for experimental 0021) |
| `cc_v1_0031_staging_owner_provisioning` | `0031_provision_staging_owner.sql` (NEW, staging-only) |

The experimental `0021`–`0026` are **NOT** applied and must not be re-applied unchanged.

## Re-apply (fresh staging) — exact order
1. `docs/recreation-test/staging-baseline.sql`
2. `migrations/0015` → `0016` → `0017` → `0018` → `0019` → `0020`
3. `cc-v1-staging/0029_drop_experimental_leftovers.sql`
4. `cc-v1-staging/0030_operator_surface.sql`
5. `cc-v1-staging/0031_provision_staging_owner.sql`
Then (optional demo) seed synthetic carriers/loads/documents; then `select app_private.provision_staging_owner('<auth-uid>')`.

## Down / reset strategy
- **Foundation down migrations** already exist for 0015–0020 under `migrations/down/` and
  `migrations/emergency-down/` — use those for a reviewed teardown of the RBAC/audit/flags/privileged layer.
- **Operator surface (0030)** down: `DROP-RESET.sql` drops exactly the ten `cc_*` functions it created
  (RESTRICT) plus `provision_staging_owner`. It does not touch base tables.
- **Full staging wipe**: the reviewed destructive package in `scripts/staging-reset/` (drop-order fix +
  augmented clone-test) is the supported way to return staging to empty before a clean re-apply.
- These files are **STAGING ONLY**. Every privileged function carries the production-rejection guard
  (provisioning) or runs only inside the reviewed staging series.

## Tests
`SMOKE-TEST.sql` is the persona matrix executed on staging (Owner full workflow + audit, Dispatcher
allow/deny, Carrier non-staff, Anonymous deny) using simulated JWT `sub` claims. It is read-mostly and
self-cleaning where safe; it proves the RBAC + workflow behaviour at the data layer.
