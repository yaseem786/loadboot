-- bl_bp_0343a — a re-screen REQUEST must never demote a broker that has already passed.
-- 2026-09-09 · Claude · applied to STAGING with bl_bp_0343. Prod only on Yaseen's word.
--
-- FOUND BY THE TEST, NOT BY READING. The bl_bp_0343 staging run showed broker_rescreen_sweep()
-- queueing a check and then finding nothing to alert on. The cause was much worse than the missing
-- alert. broker_screen_request() (bl_bp_0312 §5) writes, on conflict:
--     outcome = 'pending', reason = null          -- normal path
--     outcome = 'error'                           -- fmcsa_config missing/disabled
-- Under bl_bp_0312 that only ever ran on a FIRST screening, so clobbering cost nothing. bl_bp_0343
-- calls it every night and on every stale post. As written, each nightly re-screen would drop a
-- passing brokerage to 'pending' → broker_tier() → 'new' → POSTING BLOCKED until the collector
-- answered a minute later — and blocked PERMANENTLY if the response never arrived, or immediately
-- and permanently for everyone if FMCSA config were ever switched off.
--
-- That is the same failure this whole change exists to prevent: a system that cannot observe
-- something reporting a negative. The verdict must move on ANSWERS, never on the act of asking.
--
-- FIX: on a re-screen the stored verdict, and its reason, are left alone; only request_id /
--      requested_at / attempts / last_outcome move. A row that has never passed (last_pass_at is
--      null) keeps bl_bp_0312's behaviour byte for byte — there is no good verdict to protect and
--      the portal's "screening is running" copy depends on outcome='pending'.
--      `request_id is not null` still signals in-flight to partner_trust_status(); unchanged.
--
-- TEST: docs/audit-2026-09/tests/bl_bp_0343_rollback_test.sql (cases R1–R4)
-- ROLLBACK: inert once bl_bp_0343 is disabled (no nightly caller). To revert the text, re-apply bl_bp_0312 §5.

do $mig$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='broker_screen_request';
  if v_def is null then raise exception 'bl_bp_0343a: broker_screen_request missing'; end if;
  if position('bl_bp_0343a' in v_def) > 0 then raise notice 'bl_bp_0343a: already patched'; return; end if;

  -- (1) the normal request path
  v_old := E'    request_id = excluded.request_id, requested_at = now(), outcome = ''pending'', reason = null,\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343a: pending anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old,
E'    request_id = excluded.request_id, requested_at = now(),\n' ||
E'    -- bl_bp_0343a: a re-screen of a broker that has passed before leaves the verdict alone.\n' ||
E'    outcome = case when app_private.broker_screenings.last_pass_at is null then ''pending'' else app_private.broker_screenings.outcome end,\n' ||
E'    reason  = case when app_private.broker_screenings.last_pass_at is null then null else app_private.broker_screenings.reason end,\n');

  -- (2) the "FMCSA screening is not configured" path
  v_old := E'      outcome = ''error'', reason = excluded.reason, checked_at = now(), request_id = null, attempts = app_private.broker_screenings.attempts + 1, updated_at = now();\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343a: not-configured anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old,
E'      -- bl_bp_0343a: our own config being off is never a finding against a brokerage that has passed.\n' ||
E'      outcome = case when app_private.broker_screenings.last_pass_at is null then ''error'' else app_private.broker_screenings.outcome end,\n' ||
E'      reason  = case when app_private.broker_screenings.last_pass_at is null then excluded.reason else app_private.broker_screenings.reason end,\n' ||
E'      last_outcome = ''error'', last_attempt_at = now(),\n' ||
E'      checked_at = now(), request_id = null, attempts = app_private.broker_screenings.attempts + 1, updated_at = now();\n');

  execute v_def;
end $mig$;

do $$
begin
  if (select position('bl_bp_0343a' in pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='app_private' and p.proname='broker_screen_request') = 0
  then raise exception 'bl_bp_0343a: patch did not land'; end if;
  raise notice 'bl_bp_0343a: broker_screen_request no longer clobbers a passing verdict';
end $$;
