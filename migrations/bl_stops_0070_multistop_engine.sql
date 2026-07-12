-- bl_stops_0070 — MULTI-STOP Stage 2 (engine): GPS arrive/depart now speak 'stop_N'.
-- Extra-stop coords come from loads.details->'stops' (pinned at posting). Same 800m
-- geofence, same dwell events, same auto detention/layover/stop_off triggers (bl_pay_0068
-- already fires on ANY stop_type). Extra stops never change trip.status — the truck stays
-- 'in_transit' between pickup and delivery.

create or replace function app_private.load_stop_coords(p_trip uuid, p_stop text)
 returns table(lat double precision, lng double precision)
 language sql stable
 set search_path to 'app_private, public'
as $$
  select (s->>'lat')::double precision, (s->>'lng')::double precision
    from app_private.trips t
    join public.loads l on l.id = t.load_id,
         jsonb_array_elements(coalesce(l.details->'stops','[]'::jsonb)) s
   where t.id = p_trip
     and (s->>'seq')::int = nullif(regexp_replace(p_stop, '^stop_', ''), '')::int
   limit 1;
$$;

create or replace function public.cc_trip_arrive_gps(p_trip uuid, p_stop text, p_lat double precision, p_lng double precision, p_free_minutes integer default 120)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private', 'public'
as $function$
declare v_id uuid; v_slat double precision; v_slng double precision; v_dist integer; v_radius constant integer := 800;
begin
  if p_stop not in ('pickup','delivery') and p_stop !~ '^stop_[1-9]$' then
    raise exception 'invalid stop type' using errcode='22023';
  end if;
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  if p_lat is null or p_lng is null then
    raise exception 'GPS required — enable location to check in at the %', p_stop using errcode='22023';
  end if;
  if p_stop in ('pickup','delivery') then
    select case when p_stop='pickup' then pickup_lat else delivery_lat end,
           case when p_stop='pickup' then pickup_lng else delivery_lng end
      into v_slat, v_slng from app_private.trips where id = p_trip;
  else
    select c.lat, c.lng into v_slat, v_slng from app_private.load_stop_coords(p_trip, p_stop) c;
  end if;
  if v_slat is null or v_slng is null then
    raise exception 'The % location is not pinned on this trip yet — open the LoadBoot live map once (it pins it automatically) or ask dispatch.', p_stop using errcode='22023';
  end if;
  v_dist := app_private.haversine_m(p_lat, p_lng, v_slat, v_slng);
  if v_dist > v_radius then
    raise exception 'You are % km from the % location — you can check in when you are there.',
      round(v_dist/1000.0, 1), p_stop using errcode='22023';
  end if;
  insert into app_private.trip_dwell_events(trip_id, stop_type, free_minutes, created_by, lat, lng, distance_m)
    values (p_trip, p_stop, least(greatest(coalesce(p_free_minutes,120),0),1440), auth.uid(), p_lat, p_lng, v_dist)
    returning id into v_id;
  if p_stop = 'pickup' then
    update app_private.trips
       set started_at = coalesce(started_at, now()),
           dispatched_at = coalesce(dispatched_at, now()),
           status = case when status in ('planned') then 'dispatched' else status end
     where id = p_trip;
  end if;
  perform app_private.log_audit('dispatch.dwell.arrive','trip',p_trip::text,null,'arrived at '||p_stop||' (GPS verified, '||v_dist||' m)', jsonb_build_object('stop',p_stop,'distance_m',v_dist));
  perform app_private.emit_event('trip.arrived','trip',p_trip::text, jsonb_build_object('stop',p_stop,'gps',true,'distance_m',v_dist));
  return jsonb_build_object('ok',true,'dwell_id',v_id,'arrived_at',now(),'gps_verified',true,'distance_m',v_dist);
exception when unique_violation then
  raise exception 'arrival already recorded for this stop' using errcode='22023';
end; $function$;

create or replace function public.cc_trip_depart(p_trip uuid, p_stop text, p_lat double precision default null, p_lng double precision default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $function$
declare d record; v_dwell int; v_det int;
begin
  if p_stop not in ('pickup','delivery') and p_stop !~ '^stop_[1-9]$' then
    raise exception 'invalid stop type' using errcode='22023';
  end if;
  declare glat9 double precision; glng9 double precision; gd9 double precision;
  begin
    if p_stop = 'pickup' then select t9.pickup_lat, t9.pickup_lng into glat9, glng9 from app_private.trips t9 where t9.id = p_trip;
    elsif p_stop = 'delivery' then select t9.delivery_lat, t9.delivery_lng into glat9, glng9 from app_private.trips t9 where t9.id = p_trip;
    else select c.lat, c.lng into glat9, glng9 from app_private.load_stop_coords(p_trip, p_stop) c; end if;
    if glat9 is not null then
      if p_lat is null or p_lng is null then
        raise exception 'GPS required — departure is recorded from your live position (it happens automatically when you drive out of the facility zone).' using errcode='23514';
      end if;
      gd9 := 111320 * sqrt( ((p_lat - glat9) * (p_lat - glat9)) + (cos(radians(glat9)) * (p_lng - glng9)) * (cos(radians(glat9)) * (p_lng - glng9)) );
      if gd9 <= 800 then
        raise exception 'You are still inside the facility zone (~% m from the dock). Departure records AUTOMATICALLY the moment you drive out of the 800 m radius — no button needed.', round(gd9) using errcode='23514';
      end if;
    end if;
  end;
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.trip_dwell_events
     set departed_at = now()
   where trip_id=p_trip and stop_type=p_stop and departed_at is null
   returning * into d;
  if d.id is null then raise exception 'no open arrival for this stop' using errcode='22023'; end if;
  v_dwell := floor(extract(epoch from (d.departed_at - d.arrived_at))/60)::int;
  v_det := greatest(v_dwell - d.free_minutes, 0);
  perform app_private.log_audit('dispatch.dwell.depart','trip',p_trip::text,null,
    format('departed %s after %s min (detention %s min)', p_stop, v_dwell, v_det),
    jsonb_build_object('stop',p_stop,'dwell_minutes',v_dwell,'detention_minutes',v_det));
  perform app_private.emit_event('trip.departed','trip',p_trip::text,
    jsonb_build_object('stop',p_stop,'dwell_minutes',v_dwell,'detention_minutes',v_det));
  return jsonb_build_object('ok',true,'stop',p_stop,'dwell_minutes',v_dwell,
    'free_minutes',d.free_minutes,'detention_minutes',v_det,
    'note', case when v_det>0 then 'detention measured from recorded arrive/depart stamps — file an accessorial for review' else 'within free time' end);
end; $function$;

-- which extra stops are already served (for the trip map to resume correctly)
create or replace function public.cc_trip_stops_progress(p_trip uuid)
 returns jsonb language sql stable security definer
 set search_path to 'app_private, public'
as $$
  select case when not app_private.can_touch_trip(p_trip) then jsonb_build_object('error','not authorized')
  else coalesce((select jsonb_agg(jsonb_build_object('stop', d.stop_type, 'arrived_at', d.arrived_at, 'departed_at', d.departed_at) order by d.arrived_at)
     from app_private.trip_dwell_events d
    where d.trip_id = p_trip and d.stop_type ~ '^stop_[1-9]$'), '[]'::jsonb) end;
$$;
revoke all on function public.cc_trip_stops_progress(uuid) from public;
grant execute on function public.cc_trip_stops_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
