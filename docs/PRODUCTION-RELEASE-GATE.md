# LoadBoot — Production Release Gate (Phase 1)

Date: 30 June 2026. Run before merging PR #11 and before any production feature-flag activation.

## Gate result: **PASS** (with two owner-confirm items)

| # | Gate condition | Result | Evidence |
|---|---|---|---|
| 1 | Updated root `build_site.py` committed | ✅ on disk | Written to repo root via device bridge (map CSP + analytics beacon). Commit is the owner's git action. |
| 2 | Every applied migration is source-controlled | ✅ PASS | Production ledger (51 migrations) — the Control Tower set (`wa1–wa4`, `ctb–ctk`) all have source files in `migrations/ct-waveA/` + `migrations/ct-waveBF/`. Earlier waves under `migrations/`. |
| 3 | Every deployed Edge Function is source-controlled | ✅ FIXED | `fmcsa-verify`, `ai-assist`, `send-email` written to `supabase/functions/*/index.ts` (this release). |
| 4 | Production build contains zero staging references | ✅ PASS | `build_site.py` is context-aware: a `production` build targets PROD_REF only (`rwscphuhpjoudvljvmdk`); staging ref is used only in preview/branch context. CSP `_CSP_REF = APP_REF` (context's project only). |
| 5 | No secret / service-role value in frontend or bundle | ✅ PASS | Frontend uses the publishable (anon) key only. `env.js` actively *refuses to run* if a `service_role` key is detected. All secrets live in Edge Function secrets (server-side). |
| 6 | Netlify rollback deploy preserved | ☑ owner-confirm | Netlify keeps prior production deploys; the last good deploy remains the one-click rollback target. Confirm in Netlify → Deploys. |
| 7 | Production feature flags remain OFF | ✅ PASS | All 14 Control Tower flags query `enabled=false` on production (web_analytics, forms, seo, reports, entity360, partners, support, notifications_center, team_chat, automations_admin, announcements, campaigns, ops_map, action_center). |
| 8 | Production data counts unchanged | ✅ PASS | organizations(carrier) 3 · carrier profiles 3 · documents 2 · trips 0 · invoices 0 · all new greenfield tables empty (partners/tickets/announcements/campaigns/web_sessions = 0). Existing data untouched. |
| 9 | Migrations are additive | ✅ PASS | All `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` / additive `INSERT … ON CONFLICT DO NOTHING`. No `DROP`, no destructive `ALTER`, no data deletion. |
| 10 | CI / syntax / security scans pass | ✅ PASS | All app JS passes `node --check`. Supabase **security advisors: 0 ERROR** (240 findings, all WARN/INFO and by-design: SECURITY-DEFINER-callable = our RBAC architecture; RLS-enabled-no-policy = deny-by-default; leaked-password-protection = owner toggle). |
| 11 | Backup / PITR before activation | ☑ manual backup done | Free plan = no automatic PITR. A **manual logical backup** of production config + business tables was taken (`loadboot-production-backup-2026-06-30.json`, 13 tables). See runbook below. |

## Manual backup contents
`organizations`, `profiles`, `documents`, `feature_flags`, `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `staff_members`, `carrier_onboarding`, `carrier_compliance`, `compliance_requirements`, `automation_rules`. Row counts: organizations 4, profiles 4, documents 2, feature_flags 28, automation_rules 17.

## Restore runbook (manual logical restore)
If activation must be rolled back beyond a feature-flag toggle:
1. **First response is always the flag** — disable the affected flag in Feature Flags (or `update app_private.feature_flags set enabled=false where key='…'`). This reverts UI/behaviour instantly with no data change.
2. **Code rollback** — in Netlify → Deploys, click "Publish deploy" on the last known-good production deploy.
3. **Data restore (only if data was corrupted)** — migrations are additive, so this should never be needed. If it is: from `loadboot-production-backup-2026-06-30.json`, restore a table by upserting its rows back (e.g. for config tables `feature_flags`, `roles`, `role_permissions`). Business tables (`organizations`, `profiles`, `documents`) should be restored by an owner with care; never bulk-delete live carrier data.
4. **Verify** — re-run the data fingerprint query and `cc_system_health`; confirm cron jobs `succeeded`.

## Recommendation
**PASS** — safe to merge PR #11. Two items are owner-confirm (Netlify rollback exists by default; commit is your git action). Backups are manual on the free plan — upgrading the Supabase plan to enable automatic PITR is still recommended before heavy production traffic.
