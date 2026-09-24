-- bl_ux_0433 — carrier Support "Your tickets" and dashboard announcements never loaded (ux-audit 2026-09, C1).
-- public.cc_pocket_my_issues(int) and public.cc_pocket_announcements() both RETURN TABLE(id uuid, ...) and
-- both open with  `select id into v_org from public.organizations ...`  — inside a plpgsql body the OUT
-- column `id` shadows the table column, so every call failed with 42702 "column reference "id" is
-- ambiguous" (staging + prod, md5 1e6b73e4… / 0e8d7d70… before). The carrier saw "Failed to load." under
-- Your tickets and an empty announcements strip. Anchor replace on the live definitions: qualify the
-- organizations lookup. cc_pocket_raise_issue returns uuid (no OUT column) and is untouched.
do $m$
declare d text; n int; f text;
  a text := $a$select id into v_org from public.organizations where owner_user_id=auth.uid() and kind='carrier' limit 1;$a$;
  b text := $b$select o.id into v_org from public.organizations o where o.owner_user_id=auth.uid() and o.kind='carrier' limit 1;$b$;
begin
  foreach f in array array['cc_pocket_my_issues', 'cc_pocket_announcements'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = f;
    if d is null then raise exception 'bl_ux_0433: public.% not found — nothing applied', f; end if;
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    if n <> 1 then raise exception 'bl_ux_0433: % anchor count % (expected 1) — nothing applied', f, n; end if;
    execute replace(d, a, b);
  end loop;
end $m$;
