-- cut_carrier_assign_trip.sql
-- Carrier assigns their OWN driver/truck to their OWN trip (Carrier Portal "Assign driver/truck").
-- Self-scoped: the trip, driver and truck must all belong to the caller's carrier org (my_carrier_org()).
-- Passing null for driver or truck leaves that assignment unchanged. Audited.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_assign_trip(p_trip uuid, p_driver uuid default null, p_truck uuid default null)
returns void
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_dname text;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if not exists (select 1 from app_private.trips t where t.id=p_trip and t.carrier_id=v_org) then
    raise exception 'trip not found for your account' using errcode='42501'; end if;
  if p_driver is not null then
    select name into v_dname from app_private.fleet_drivers where id=p_driver and carrier_id=v_org;
    if v_dname is null then raise exception 'driver not found for your account' using errcode='42501'; end if;
  end if;
  if p_truck is not null then
    if not exists (select 1 from app_private.fleet_trucks where id=p_truck and carrier_id=v_org) then
      raise exception 'truck not found for your account' using errcode='42501'; end if;
  end if;
  update app_private.trips
    set driver_id = coalesce(p_driver, driver_id),
        truck_id  = coalesce(p_truck, truck_id),
        driver_name = coalesce(v_dname, driver_name),
        updated_at = now()
  where id=p_trip and carrier_id=v_org;
  perform app_private.log_audit('carrier.trip.assign','trip',p_trip::text,v_org,
    format('driver=%s truck=%s', coalesce(p_driver::text,'-'), coalesce(p_truck::text,'-')), '{}'::jsonb);
end; $$;
revoke execute on function public.cc_pocket_assign_trip(uuid,uuid,uuid) from anon, public;
grant  execute on function public.cc_pocket_assign_trip(uuid,uuid,uuid) to authenticated;
