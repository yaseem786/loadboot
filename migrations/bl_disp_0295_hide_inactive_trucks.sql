-- bl_disp_0295 — dispatcher/carrier truck lists: hide INACTIVE trucks too.
-- fleet_trucks_status_check allows only active|inactive|maintenance — there is no 'retired' status, so the
-- `<> 'retired'` filter in bl_disp_0288/0292/0293 never removed anything, and Warren's replaced Ford (0012,
-- set inactive 28 Aug) kept showing next to the Hino (0026) in the Dispatcher Workspace, the carrier card and
-- HOS driver→truck matching. Keep 'maintenance' visible (it is still the carrier's truck). Rewrites the filter
-- in place in the three functions from their current definitions — no other change. Staging first, then prod.
do $$
declare f text; src text;
begin
  foreach f in array array['public.dispatcher_workspace_feed()', 'public.carrier_my_dispatcher()', 'public.eld_hos_ingest(uuid, jsonb)'] loop
    src := pg_get_functiondef(f::regprocedure);
    src := replace(src, 'coalesce(t.status,''active'') <> ''retired''', 'coalesce(t.status,''active'') not in (''inactive'',''retired'')');
    execute src;
  end loop;
end $$;
