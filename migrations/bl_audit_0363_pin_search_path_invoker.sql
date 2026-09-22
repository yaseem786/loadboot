-- bl_audit_0363 — F14 remainder: pin search_path on every SECURITY INVOKER function in public/app_private that authenticated may
-- EXECUTE and that still has a mutable search_path (prod 100 / staging 107; 99% live in app_private, whose schema authenticated
-- cannot even USAGE — so this is advisor hygiene + defence in depth, not a live hole).
-- Pin = "app_private, public, extensions, pg_temp": the path 1,234 of the SECURITY DEFINER callers already run under, so name
-- resolution is unchanged for every caller. Verified before writing: ZERO relation/function name collisions between public and
-- app_private, and none against extensions/vault/cron/pg_catalog (22 Sep, both envs). pg_temp goes LAST on purpose (no temp shadowing).
-- Also pins the one mutable SECURITY DEFINER left (app_private.bl_cmp_0324_rollback, owner-only) to pg_catalog.
-- Skipped on purpose: functions that already carry any search_path, and trigger functions (they run under the statement's path).
-- Rollback: ROLLBACK-SEARCH-PATH-2026-09-22.sql (ALTER FUNCTION ... RESET search_path for the same list, recorded by name).
do $m$ declare r record; n int := 0; begin
  create temp table if not exists _pinned_0363(sig text) on commit drop;
  for r in select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname in ('public','app_private') and not p.prosecdef and p.prokind='f'
             and p.prorettype <> 'trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute')
             and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %I.%I(%s) set search_path = app_private, public, extensions, pg_temp', r.nspname, r.proname, r.args);
    insert into _pinned_0363 values (format('%I.%I(%s)', r.nspname, r.proname, r.args)); n := n + 1;
  end loop;
  if to_regprocedure('app_private.bl_cmp_0324_rollback()') is not null then
    alter function app_private.bl_cmp_0324_rollback() set search_path = pg_catalog;
  end if;
  raise notice 'bl_audit_0363: % invoker functions pinned', n;
end $m$;
