-- bl_audit_0359 — F25: index every foreign key in public/app_private that has no covering index (prod 53 / staging 64 per advisor).
-- Additive only. Tables total ~2 MB, so plain CREATE INDEX (a second of SHARE lock) is used instead of CONCURRENTLY, which cannot
-- run inside a migration transaction. Names are deterministic: ix_fk_<table>_<col1>[_<col2>]. Re-runnable (IF NOT EXISTS).
-- Rollback: drop index if exists ix_fk_% (ROLLBACK-FK-INDEXES-2026-09-22.sql regenerates the exact list from pg_indexes).
do $m$
declare r record; cols text; nm text; n int := 0;
begin
  for r in
    select c.conrelid, n.nspname, t.relname, c.conkey
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname in ('public','app_private')
      and not exists (select 1 from pg_index i where i.indrelid=c.conrelid
                      and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey)
    order by n.nspname, t.relname
  loop
    select string_agg(quote_ident(a.attname), ',' order by k.o), string_agg(a.attname, '_' order by k.o)
      into cols, nm
    from unnest(r.conkey) with ordinality k(attnum,o) join pg_attribute a on a.attrelid=r.conrelid and a.attnum=k.attnum;
    execute format('create index if not exists %I on %I.%I (%s)', left('ix_fk_'||r.relname||'_'||nm, 63), r.nspname, r.relname, cols);
    n := n + 1;
  end loop;
  raise notice 'bl_audit_0359: % FK indexes created', n;
end $m$;
