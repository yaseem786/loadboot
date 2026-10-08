-- bl_pref_0536 — the shared "Dispatch preferences" card (8 Oct 2026, owner item J)
--
-- 1. cc_set_dispatch_prefs learns home_time and round_trip_pref (the carrier form now has them; the codes are the
--    table's own CHECK lists: cdp_home_time_chk / cdp_round_trip_pref_ck). cost_per_mile was already handled.
--    Anchor patch — nothing else in the function changes.
-- 2. public.cc_pocket_field_sources() — the carrier reads who last set each of THEIR fields (role + date, the
--    dispatcher's name; never a staff note, never a staff name), so "Updated by your dispatcher on Oct 8" is never silent.
-- Additive + reversible (drop the function; re-run the previous cc_set_dispatch_prefs definition).

begin;

do $$
declare v_src text; v_new text;
        v_anchor text := E'    min_notice_hours = case when p ? ''min_notice_hours'' then nullif(p->>''min_notice_hours'','''')::int    else app_private.carrier_dispatch_prefs.min_notice_hours end,\n';
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cc_set_dispatch_prefs';
  if v_src is null then raise exception 'cc_set_dispatch_prefs not found'; end if;
  if position('round_trip_pref  = case' in v_src) > 0 then return; end if;   -- already patched
  v_new := replace(v_src, v_anchor, v_anchor
    || E'    home_time        = case when p ? ''home_time''        then nullif(btrim(p->>''home_time''),'''')        else app_private.carrier_dispatch_prefs.home_time end,   -- bl_pref_0536\n'
    || E'    round_trip_pref  = case when p ? ''round_trip_pref''  then nullif(btrim(p->>''round_trip_pref''),'''')  else app_private.carrier_dispatch_prefs.round_trip_pref end,\n');
  if v_new = v_src then raise exception 'bl_pref_0536: cc_set_dispatch_prefs anchor not found — aborting'; end if;
  execute v_new;
end $$;

create or replace function public.cc_pocket_field_sources()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_org uuid := app_private.my_carrier_org();
begin
  if v_org is null then raise exception 'not a carrier account' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'tbl', s.tbl, 'field', s.field, 'truck_id', s.truck_id, 'role', s.set_by_role, 'at', s.set_at,
      'by_name', case when s.set_by_role = 'dispatcher' then app_private.cfs_name_of(s.set_by) else null end)
    order by s.set_at desc)
    from app_private.carrier_field_sources s where s.carrier_org_id = v_org), '[]'::jsonb));
end $$;
revoke execute on function public.cc_pocket_field_sources() from public, anon;
grant  execute on function public.cc_pocket_field_sources() to authenticated, service_role;

do $$
declare n int;
begin
  if has_function_privilege('anon', 'public.cc_pocket_field_sources()', 'execute') then raise exception 'bl_pref_0536: anon can execute cc_pocket_field_sources'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_pref_0536: anon SECURITY DEFINER surface in public = % (expect 36 prod / 35 staging)', n;
end $$;

commit;
