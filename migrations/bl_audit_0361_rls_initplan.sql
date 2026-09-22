-- bl_audit_0361 — F25 "auth RLS initplan": rewrite policies that call auth.uid()/auth.role()/auth.jwt() per row so they call it
-- once per statement: auth.uid()  ->  (select auth.uid()). Same truth table, cheaper plan. Prod 16 policies / staging similar.
-- Fully dynamic: each policy is re-created from its own catalog definition inside this transaction (drop + create), so nothing is
-- retyped. Rollback: ROLLBACK-RLS-INITPLAN-2026-09-22.sql (reverse replacement, same mechanism).
do $m$
declare r record; q text; w text; n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname in ('public','app_private','storage')
      and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'auth\.(uid|role|jwt)\(\)'
      and (coalesce(qual,'')||coalesce(with_check,'')) !~* '\(\s*select\s+auth\.'
  loop
    q := regexp_replace(r.qual,       '(?<!select\s)auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi');
    w := regexp_replace(r.with_check, '(?<!select\s)auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi');
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
      array_to_string(r.roles, ', '),
      case when q is not null then 'using ('||q||')' else '' end,
      case when w is not null then 'with check ('||w||')' else '' end);
    n := n + 1;
  end loop;
  raise notice 'bl_audit_0361: % policies rewritten', n;
end $m$;
