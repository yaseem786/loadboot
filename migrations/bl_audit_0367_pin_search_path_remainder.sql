-- bl_audit_0367 — F14 tail: the security advisor still flagged 35 functions on prod after 0363 (all app_private, SECURITY INVOKER,
-- 14 trigger functions + 21 internal helpers not executable by authenticated). Same safe pin as 0363; trigger functions accept
-- SET search_path like any other. After this the advisor's function_search_path_mutable count must be 0 on both envs.
-- Rollback: ROLLBACK-SEARCH-PATH-2026-09-22.sql already resets every function carrying exactly this pin value.
do $m$ declare r record; n int := 0; begin
  for r in select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname in ('public','app_private') and p.prokind='f'
             and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c(v) where c.v like 'search_path=%')
  loop
    execute format('alter function %I.%I(%s) set search_path = app_private, public, extensions, pg_temp', r.nspname, r.proname, r.args);
    n := n + 1;
  end loop;
  raise notice 'bl_audit_0367: % functions pinned', n;
end $m$;
