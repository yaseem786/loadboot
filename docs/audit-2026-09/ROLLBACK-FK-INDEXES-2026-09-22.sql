-- Rollback for bl_audit_0359: drops only indexes named ix_fk_% in public/app_private (the migration's naming), nothing else.
do $m$ declare r record; begin
  for r in select schemaname, indexname from pg_indexes where schemaname in ('public','app_private') and indexname like 'ix\_fk\_%' loop
    execute format('drop index if exists %I.%I', r.schemaname, r.indexname);
  end loop; end $m$;
