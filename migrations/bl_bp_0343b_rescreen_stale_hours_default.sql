-- bl_bp_0343b — the re-screen staleness threshold must leave room for the sweep's own answer.
-- 2026-09-12 · Claude · apply to STAGING first, then prod. Idempotent on both.
--
-- FOUND IN PRODUCTION, NOT BY READING. bl_bp_0343 shipped with stale_hours = 24 and the sweep
-- scheduled at 07:00:00. When the sweep queues a check, lb-broker-screen-collect answers and
-- broker_screen_apply() stamps checked_at / last_pass_at about a MINUTE later, at ~07:01. The
-- sweep's own predicate is
--
--     coalesce(s.auto_requested_at, epoch) < now() - make_interval(hours => cfg.stale_hours)
--     and coalesce(s.last_pass_at,  epoch) < now() - make_interval(hours => cfg.stale_hours)
--
-- so at the NEXT 07:00 sweep the row is 23h59m old — one minute short of stale — and nothing is
-- requested. The row only becomes eligible the day after, at 47h59m.
--
-- Observed on prod 12 Sep 2026: the only screening row (MC 1082282) read
--     last_pass_at = last_attempt_at = checked_at = 2026-09-10 07:01:00Z
-- while cron.job_run_details showed the 11 Sep 07:00 sweep had run and SUCCEEDED having moved
-- nothing. The advertised 24-hour cadence was really 48 hours.
--
-- The second-order effect was worse than the missed check. broker_screen_pipeline_healthy() asks
-- whether ANY broker passed inside 48 HOURS. With re-screens landing every 48h minus a minute, the
-- breaker sat exactly on its own edge — true until ~07:01 on the off day, false after it — so the
-- staleness gate silently disengaged every other day. Fail-safe, so nothing broke and no broker was
-- ever wrongly stopped; the breaker simply was not measuring what it claimed to measure.
--
-- FIX: stale_hours 24 → 20. Eligibility then lands at ~03:01, comfortably ahead of the 07:00 sweep,
--      so the cadence is a real 24 hours and a successful pass is always well inside the 48-hour
--      health window.
--
-- WHY A MIGRATION FOR A CONFIG VALUE. The live rows on prod and staging were already corrected by
-- hand on 2026-09-12 (06:19:04Z and 06:19:18Z) — broker_rescreen_config exists precisely so this is
-- tuned without a migration, and that part needs nothing from this file. What a hand-tune CANNOT
-- fix is the COLUMN DEFAULT: bl_bp_0343 line 106 seeds `stale_hours int not null default 24`, so
-- any database running bl_bp_0343 for the first time — a fresh environment, a staging reset —
-- would inherit the bug that was just fixed everywhere else. bl_bp_0343 itself must not be edited:
-- both databases have already run it and the file has to keep matching what ran.
--
-- SCOPE: this changes ONLY stale_hours, which ONLY broker_rescreen_sweep() and
--        broker_screen_refresh_if_stale() read — confirmed against the live definitions on prod.
--        broker_authority_state() does NOT read it; its stale verdict is block_days (14). So no
--        broker-visible behaviour changes, only how often LoadBoot re-asks FMCSA.
--        alert_days (3), block_days (14), fail_strikes (2) and sweep_limit (40) are untouched.
--
-- TEST: docs/audit-2026-09/tests/bl_bp_0343_rollback_test.sql still passes unchanged — it does not
--       assert on stale_hours. The real check is behavioural: after this, the prod screening row
--       should get a fresh last_pass_at at ~07:01 EVERY day, not every other day.
-- ROLLBACK: alter table app_private.broker_rescreen_config alter column stale_hours set default 24;
--           update app_private.broker_rescreen_config set stale_hours = 24 where stale_hours = 20;

do $mig$
declare v_default text; v_rows int;
begin
  if to_regclass('app_private.broker_rescreen_config') is null then
    raise exception 'bl_bp_0343b: app_private.broker_rescreen_config does not exist — apply bl_bp_0343 (and bl_bp_0343a) first';
  end if;

  -- (1) the seed a fresh database inherits
  alter table app_private.broker_rescreen_config alter column stale_hours set default 20;

  -- (2) any row still carrying the old seed. Scoped to exactly 24 so a deliberate tune to some
  --     other value is never silently overwritten by this migration.
  update app_private.broker_rescreen_config set stale_hours = 20, updated_at = now()
   where stale_hours = 24;
  get diagnostics v_rows = row_count;

  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'app_private.broker_rescreen_config'::regclass
     and a.attname = 'stale_hours';

  raise notice 'bl_bp_0343b: stale_hours default is now %, rows moved off 24: %', v_default, v_rows;
end $mig$;

do $$
declare v_default text; v_stale int;
begin
  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'app_private.broker_rescreen_config'::regclass
     and a.attname = 'stale_hours';
  if v_default is null or v_default !~ '20' then
    raise exception 'bl_bp_0343b: column default did not land (reads %)', coalesce(v_default, '<none>');
  end if;

  select stale_hours into v_stale from app_private.broker_rescreen_config where id;
  if v_stale = 24 then
    raise exception 'bl_bp_0343b: the config row still reads 24';
  end if;

  -- Not an assertion, a reminder: the sweep must stay far enough after this threshold that its own
  -- answer never makes the row look fresh at the next run.
  raise notice 'bl_bp_0343b: default 20, live row %, sweep is 0 7 * * * — eligibility lands ~03:01', v_stale;
end $$;
