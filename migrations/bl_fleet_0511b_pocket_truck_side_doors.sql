-- bl_fleet_0511b — has_side_door for the carrier's own trucks, as a small separate RPC
-- (cc_pocket_trucks keeps its fixed RETURNS TABLE shape; app/shared/api.js pocketTrucks merges this in).
create or replace function public.cc_pocket_truck_side_doors()
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $f$
  select coalesce(jsonb_object_agg(t.id::text, t.has_side_door), '{}'::jsonb)
    from app_private.fleet_trucks t
   where t.carrier_id = app_private.my_carrier_org() and t.has_side_door is not null
$f$;
revoke all on function public.cc_pocket_truck_side_doors() from public, anon;
grant execute on function public.cc_pocket_truck_side_doors() to authenticated;
