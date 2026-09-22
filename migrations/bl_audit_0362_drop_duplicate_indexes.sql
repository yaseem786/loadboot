-- bl_audit_0362 — F25: drop exact-duplicate indexes (same table, columns, opclasses, predicate, uniqueness). Keeps the one that
-- backs a constraint (or the older oid), drops the other. Prod 22 Sep: comm_templates key, carrier_expenses carrier/org,
-- trip_locations trip. Fully dynamic; safe to re-run. Rollback: recreate from the definitions printed in the NOTICE.
do $m$ declare r record; keep oid; drp oid; begin
  for r in
    select a.indexrelid ia, b.indexrelid ib, a.indrelid t
    from pg_index a join pg_index b on a.indrelid=b.indrelid and a.indexrelid<b.indexrelid and a.indkey=b.indkey and a.indclass=b.indclass
      and coalesce(pg_get_expr(a.indpred,a.indrelid),'')=coalesce(pg_get_expr(b.indpred,b.indrelid),'') and a.indisunique=b.indisunique
    join pg_class c on c.oid=a.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private')
  loop
    if exists (select 1 from pg_constraint where conindid=r.ib) then keep := r.ib; drp := r.ia; else keep := r.ia; drp := r.ib; end if;
    if exists (select 1 from pg_constraint where conindid=drp) then continue; end if; -- both constraint-backed: leave alone
    raise notice 'bl_audit_0362: dropping % (keeping %): %', drp::regclass, keep::regclass, pg_get_indexdef(drp);
    execute format('drop index if exists %s', drp::regclass);
  end loop; end $m$;
