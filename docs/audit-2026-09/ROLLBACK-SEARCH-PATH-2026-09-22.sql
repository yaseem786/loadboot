-- Rollback for bl_audit_0363: resets search_path on every SECURITY INVOKER function in public/app_private whose pin is exactly the
-- 0363 value. Functions pinned by other migrations use other values and are untouched.
do $m$ declare r record; begin
  for r in select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname in ('public','app_private') and not p.prosecdef
             and exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c = 'search_path=app_private, public, extensions, pg_temp') loop
    execute format('alter function %I.%I(%s) reset search_path', r.nspname, r.proname, r.args);
  end loop; end $m$;
