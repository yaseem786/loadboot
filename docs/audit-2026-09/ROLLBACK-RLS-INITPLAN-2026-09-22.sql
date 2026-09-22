-- Rollback for bl_audit_0361: (select auth.uid()) -> auth.uid() in every policy, same drop+create mechanism.
do $m$ declare r record; q text; w text; begin
  for r in select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
           where schemaname in ('public','app_private','storage') and (coalesce(qual,'')||coalesce(with_check,'')) ~* '\(\s*select\s+auth\.(uid|role|jwt)\(\)\s*\)' loop
    q := regexp_replace(r.qual,       '\(\s*select\s+auth\.(uid|role|jwt)\(\)\s*\)', 'auth.\1()', 'gi');
    w := regexp_replace(r.with_check, '\(\s*select\s+auth\.(uid|role|jwt)\(\)\s*\)', 'auth.\1()', 'gi');
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s', r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
      array_to_string(r.roles, ', '), case when q is not null then 'using ('||q||')' else '' end, case when w is not null then 'with check ('||w||')' else '' end);
  end loop; end $m$;
