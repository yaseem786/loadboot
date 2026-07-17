-- bl_fix_0110 — allow 'pending' on app_private.referrers.status
-- Root bug: the check constraint only permitted ('active','suspended'), but BOTH
-- handle_new_user() (agent signup) and cc_agent_decide() (reject/info path) insert/update
-- status='pending'. Those writes silently failed (swallowed by `exception when others then
-- null`), so agent-portal signups never got a referrer row + code and were mis-registered
-- as carriers. Widen the constraint to include 'pending'.
-- Applied: STAGING (snslhvmkjusozgjelghi) + PROD (rwscphuhpjoudvljvmdk) 2026-07-17.

alter table app_private.referrers drop constraint if exists referrers_status_check;
alter table app_private.referrers add constraint referrers_status_check
  check (status = any (array['pending','active','suspended']));
