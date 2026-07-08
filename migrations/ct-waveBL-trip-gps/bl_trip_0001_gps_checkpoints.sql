-- ct-waveBL · Trip GPS checkpoints (Phase A)
-- 1) trips: pickup_mode ('appointment'|'fcfs'), stop coordinates, started_at
-- 2) trip_dwell_events: GPS proof columns (lat/lng/distance_m)
-- 3) cc_trip_arrive_gps: geofenced Arrive — refuses unless driver GPS is within
--    radius of the stop (default 800 m) when stop coords are known.
--    Additive: existing cc_trip_arrive untouched.

alter table app_private.trips
  add column if not exists pickup_mode text not null default 'appointment'
    check (pickup_mode in ('appointment','fcfs')),
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision,
  add column if not exists started_at timestamptz;

alter table app_private.trip_dwell_events
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists distance_m integer;

create or replace function app_private.haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns integer language sql immutable as $$
  select round(6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::int;
$$;

create or replace function public.cc_trip_arrive_gps(p_trip uuid, p_stop text, p_lat double precision, p_lng double precision, p_free_minutes integer default 120)
returns jsonb
language plpgsql security definer
set search_path to 'app_private', 'public'
as $function$
declare v_id uuid; v_slat double precision; v_slng double precision; v_dist integer; v_radius constant integer := 800;
begin
  if p_stop not in ('pickup','delivery') then raise exception 'invalid stop type' using errcode='22023'; end if;
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  if p_lat is null or p_lng is null then
    raise exception 'GPS required — enable location to check in at the %', p_stop using errcode='22023';
  end if;
  select case when p_stop='pickup' then pickup_lat else delivery_lat end,
         case when p_stop='pickup' then pickup_lng else delivery_lng end
    into v_slat, v_slng from app_private.trips where id = p_trip;
  if v_slat is not null and v_slng is not null then
    v_dist := app_private.haversine_m(p_lat, p_lng, v_slat, v_slng);
    if v_dist > v_radius then
      raise exception 'You are % km from the % location — you can check in when you are there.',
        round(v_dist/1000.0, 1), p_stop using errcode='22023';
    end if;
  end if;
  insert into app_private.trip_dwell_events(trip_id, stop_type, free_minutes, created_by, lat, lng, distance_m)
    values (p_trip, p_stop, least(greatest(coalesce(p_free_minutes,120),0),1440), auth.uid(), p_lat, p_lng, v_dist)
    returning id into v_id;
  if p_stop = 'pickup' then
    update app_private.trips set started_at = coalesce(started_at, now()) where id = p_trip;
  end if;
  perform app_private.log_audit('dispatch.dwell.arrive','trip',p_trip::text,null,'arrived at '||p_stop||' (GPS verified)', jsonb_build_object('stop',p_stop,'distance_m',v_dist));
  perform app_private.emit_event('trip.arrived','trip',p_trip::text, jsonb_build_object('stop',p_stop,'gps',true,'distance_m',v_dist));
  return jsonb_build_object('ok',true,'dwell_id',v_id,'arrived_at',now(),'gps_verified', v_dist is not null,'distance_m',v_dist);
exception when unique_violation then
  raise exception 'arrival already recorded for this stop' using errcode='22023';
end; $function$;

revoke all on function public.cc_trip_arrive_gps(uuid,text,double precision,double precision,integer) from public, anon;
grant execute on function public.cc_trip_arrive_gps(uuid,text,double precision,double precision,integer) to authenticated, service_role;
