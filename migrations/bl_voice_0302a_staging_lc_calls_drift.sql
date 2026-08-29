-- bl_voice_0302a_staging_lc_calls_drift
-- 29 Aug 2026 — STAGING ONLY (production already has both columns).
--
-- app_private.lc_calls on staging was missing `analysis` and `lead_id`, which production
-- has had since bl_voice_0183 (call analysis -> CRM). retell_webhook could not even be
-- executed on staging as a result — every call failed with 42703 "column analysis does
-- not exist" — which is why that function has been going straight to production untested.
-- Adding them makes the staging-first rule possible for the voice pipeline again.
alter table app_private.lc_calls add column if not exists analysis jsonb;
alter table app_private.lc_calls add column if not exists lead_id uuid;
