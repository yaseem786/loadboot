-- bl_fleet_0120: V1 assignment optimizer — "best next load per truck".
-- Scores every AVAILABLE load per fleet truck: equipment match (hard filter),
-- $/mile, deadhead from the carrier's last delivered drop, and lane history.
-- Read-only, additive. Applied to STAGING first.
create or replace function public.carrier_assignment_suggestions()
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_org uuid; v_anchor record; v_out jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'carrier account required' using errcode='42501'; end if;

  -- anchor = where the fleet last dropped (most recent delivered trip's delivery pin)
  select l.delivery_lat as lat, l.delivery_lng as lng, l.destination as city
    into v_anchor
  from app_private.trips t join public.loads l on l.id = t.load_id
  where t.carrier_id = v_org and t.status = 'delivered' and l.delivery_lat is not null
  order by coalesce(t.delivered_at, t.updated_at) desc limit 1;

  with trucks as (
    select id, unit_no, equipment from app_private.fleet_trucks where carrier_id = v_org
  ), busy as (
    select distinct truck_id from app_private.trips
    where carrier_id = v_org and status in ('planned','dispatched','in_transit') and truck_id is not null
  ), hist as (
    select l.origin, l.destination, count(*) as n
    from app_private.trips t join public.loads l on l.id = t.load_id
    where t.carrier_id = v_org and t.status = 'delivered'
    group by 1,2
  ), avail as (
    select l.id, l.origin, l.destination, l.equipment, l.rate, l.miles,
           l.pickup_lat, l.pickup_lng, l.pickup_date,
           case when l.miles is not null and l.miles > 0 then round(l.rate / l.miles, 2) end as rpm
    from public.loads l
    where l.status = 'available' and l.rate is not null
      and (l.expires_at is null or l.expires_at > now())
  ), scored as (
    select tk.id as truck_id, tk.unit_no, tk.equipment as truck_eq,
           a.id as load_id, a.origin, a.destination, a.rate, a.miles, a.rpm, a.pickup_date,
           case when v_anchor.lat is not null and a.pickup_lat is not null then
             round((3959 * acos(least(1, greatest(-1,
               cos(radians(v_anchor.lat)) * cos(radians(a.pickup_lat))
               * cos(radians(a.pickup_lng) - radians(v_anchor.lng))
               + sin(radians(v_anchor.lat)) * sin(radians(a.pickup_lat))))))::numeric, 0)
           end as deadhead_mi,
           coalesce(h.n, 0) as lane_trips,
           (tk.id in (select truck_id from busy)) as is_busy
    from trucks tk
    join avail a on (a.equipment is null or lower(a.equipment) = lower(tk.equipment))
    left join hist h on h.origin = a.origin and h.destination = a.destination
  ), ranked as (
    select s.*,
           (coalesce(s.rpm, 2.0) * 100
            - coalesce(s.deadhead_mi, 250) * 0.35
            + s.lane_trips * 40) as score,
           row_number() over (partition by s.truck_id order by
             (coalesce(s.rpm, 2.0) * 100 - coalesce(s.deadhead_mi, 250) * 0.35 + s.lane_trips * 40) desc) as rn
    from scored s
  )
  select jsonb_build_object(
    'anchor', case when v_anchor.lat is not null then jsonb_build_object('city', v_anchor.city) end,
    'trucks', coalesce((select jsonb_agg(x order by x->>'truck') from (
       select jsonb_build_object(
         'truck', r.unit_no, 'equipment', r.truck_eq, 'busy', bool_or(r.is_busy),
         'picks', jsonb_agg(jsonb_build_object(
            'load_id', r.load_id, 'lane', r.origin || ' → ' || r.destination,
            'rate', r.rate, 'miles', r.miles, 'rpm', r.rpm,
            'deadhead_mi', r.deadhead_mi, 'lane_trips', r.lane_trips,
            'pickup_date', r.pickup_date, 'score', round(r.score::numeric, 0)
          ) order by r.rn) filter (where r.rn <= 3)
       ) as x
       from ranked r group by r.truck_id, r.unit_no, r.truck_eq
    ) q), '[]'::jsonb)
  ) into v_out;
  return v_out;
end; $$;
revoke all on function public.carrier_assignment_suggestions() from public;
grant execute on function public.carrier_assignment_suggestions() to authenticated;
notify pgrst, 'reload schema';
