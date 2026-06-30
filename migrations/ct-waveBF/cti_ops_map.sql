-- CONTROL TOWER WAVE J — Live Operations Map. Returns consented, active trips with their
-- latest GPS position for a Leaflet/OpenStreetMap map (no third-party key). Staff-gated.
-- Flag ops_map_enabled (staging on, prod off). Applied to staging + production.
create or replace function public.cc_ops_map()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'trips',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',t.id,'lat',t.last_lat,'lng',t.last_lng,'status',t.status,
        'carrier',(select name from public.organizations o where o.id=t.carrier_id),
        'driver',t.driver_name,'truck',t.truck_no,'updated',t.last_loc_at) order by t.last_loc_at desc nulls last),'[]'::jsonb)
      from app_private.trips t
      where t.last_lat is not null and t.last_lng is not null
        and t.status in ('planned','dispatched','in_transit')),
    'active',(select count(*) from app_private.trips where status in ('planned','dispatched','in_transit')),
    'tracked',(select count(*) from app_private.trips where last_lat is not null and status in ('planned','dispatched','in_transit'))
  );
end; $function$;
revoke all on function public.cc_ops_map() from public, anon;
grant execute on function public.cc_ops_map() to authenticated;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('ops_map_enabled',false,'Enable the live operations map','all','staff') on conflict (key) do nothing;
