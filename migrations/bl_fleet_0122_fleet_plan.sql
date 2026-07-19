-- bl_fleet_0122: V2 ENTERPRISE FLEET PLAN — carrier_fleet_plan().
-- Upgrades the V1 per-truck suggestions to a fleet-wide optimized plan:
--  • GLOBAL greedy assignment: each available load goes to at most ONE truck
--    (highest-scoring truck×load pairs first — no two trucks chasing the same load)
--  • PER-TRUCK anchors: each truck's own last delivered drop when trips.truck_id is
--    set; falls back to the fleet's last drop
--  • RELOAD CHAINING: for every planned assignment, the best follow-up load whose
--    pickup sits within ~250 mi of the planned delivery (2-leg lookahead)
--  • FLEET KPIs: utilization, idle trucks, planned revenue, loaded vs deadhead miles
-- Read-only, additive. STAGING first. V1 RPC (carrier_assignment_suggestions) stays.
create or replace function public.carrier_fleet_plan()
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare
  v_org uuid; v_fleet_anchor record; r record;
  v_assign jsonb := '[]'::jsonb; v_used_trucks uuid[] := '{}'; v_used_loads uuid[] := '{}';
  v_reload jsonb; v_total_rev numeric := 0; v_loaded_mi numeric := 0; v_dead_mi numeric := 0;
  v_trucks int; v_busy int; v_planned int := 0;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'carrier account required' using errcode='42501'; end if;

  select l.delivery_lat as lat, l.delivery_lng as lng, l.destination as city into v_fleet_anchor
  from app_private.trips t join public.loads l on l.id = t.load_id
  where t.carrier_id = v_org and t.status = 'delivered' and l.delivery_lat is not null
  order by coalesce(t.delivered_at, t.updated_at) desc limit 1;

  select count(*) into v_trucks from app_private.fleet_trucks where carrier_id = v_org;
  select count(distinct truck_id) into v_busy from app_private.trips
   where carrier_id = v_org and status in ('planned','dispatched','in_transit') and truck_id is not null;

  drop table if exists _fp_pairs;
  create temp table _fp_pairs on commit drop as
  with trucks as (
    select tk.id, tk.unit_no, tk.equipment,
           coalesce(ta.lat, v_fleet_anchor.lat) as a_lat,
           coalesce(ta.lng, v_fleet_anchor.lng) as a_lng,
           coalesce(ta.city, v_fleet_anchor.city) as a_city,
           (tk.id in (select truck_id from app_private.trips
                      where carrier_id = v_org and status in ('planned','dispatched','in_transit') and truck_id is not null)) as busy
    from app_private.fleet_trucks tk
    left join lateral (
      select l.delivery_lat as lat, l.delivery_lng as lng, l.destination as city
      from app_private.trips t join public.loads l on l.id = t.load_id
      where t.carrier_id = v_org and t.truck_id = tk.id and t.status = 'delivered' and l.delivery_lat is not null
      order by coalesce(t.delivered_at, t.updated_at) desc limit 1
    ) ta on true
    where tk.carrier_id = v_org
  ), hist as (
    select l.origin, l.destination, count(*) as n
    from app_private.trips t join public.loads l on l.id = t.load_id
    where t.carrier_id = v_org and t.status = 'delivered' group by 1,2
  ), avail as (
    select l.id, l.origin, l.destination, l.equipment, l.rate, l.miles, l.pickup_lat, l.pickup_lng,
           l.delivery_lat, l.delivery_lng, l.pickup_date,
           case when l.miles is not null and l.miles > 0 then round(l.rate / l.miles, 2) end as rpm
    from public.loads l
    where l.status = 'available' and l.rate is not null
      and (l.expires_at is null or l.expires_at > now())
  )
  select tk.id as truck_id, tk.unit_no, tk.equipment as truck_eq, tk.busy, tk.a_city,
         a.id as load_id, a.origin, a.destination, a.rate, a.miles, a.rpm, a.pickup_date,
         a.delivery_lat as d_lat, a.delivery_lng as d_lng,
         case when tk.a_lat is not null and a.pickup_lat is not null then
           round((3959 * acos(least(1, greatest(-1,
             cos(radians(tk.a_lat)) * cos(radians(a.pickup_lat))
             * cos(radians(a.pickup_lng) - radians(tk.a_lng))
             + sin(radians(tk.a_lat)) * sin(radians(a.pickup_lat))))))::numeric, 0) end as deadhead_mi,
         coalesce(h.n, 0) as lane_trips,
         (coalesce(a.rpm, 2.0) * 100
          - coalesce(case when tk.a_lat is not null and a.pickup_lat is not null then
              (3959 * acos(least(1, greatest(-1,
                cos(radians(tk.a_lat)) * cos(radians(a.pickup_lat))
                * cos(radians(a.pickup_lng) - radians(tk.a_lng))
                + sin(radians(tk.a_lat)) * sin(radians(a.pickup_lat)))))) end, 250) * 0.35
          + coalesce(h.n, 0) * 40) as score
  from trucks tk
  join avail a on (a.equipment is null or lower(a.equipment) = lower(tk.equipment))
  left join hist h on h.origin = a.origin and h.destination = a.destination;

  -- GLOBAL GREEDY: repeatedly take the best remaining truck×load pair
  loop
    select * into r from _fp_pairs p
    where not (p.truck_id = any(v_used_trucks)) and not (p.load_id = any(v_used_loads)) and not p.busy
    order by p.score desc limit 1;
    exit when r.truck_id is null;
    v_used_trucks := v_used_trucks || r.truck_id;
    v_used_loads := v_used_loads || r.load_id;
    v_planned := v_planned + 1;
    v_total_rev := v_total_rev + coalesce(r.rate, 0);
    v_loaded_mi := v_loaded_mi + coalesce(r.miles, 0);
    v_dead_mi := v_dead_mi + coalesce(r.deadhead_mi, 0);
    -- RELOAD lookahead from this load's delivery pin
    v_reload := null;
    if r.d_lat is not null then
      select jsonb_build_object('lane', p2.origin || ' → ' || p2.destination, 'rate', p2.rate,
                                'rpm', p2.rpm, 'deadhead_mi', p2.dh, 'load_id', p2.load_id)
        into v_reload
      from (
        select a2.id as load_id, a2.origin, a2.destination, a2.rate,
               case when a2.miles is not null and a2.miles > 0 then round(a2.rate / a2.miles, 2) end as rpm,
               round((3959 * acos(least(1, greatest(-1,
                 cos(radians(r.d_lat)) * cos(radians(a2.pickup_lat))
                 * cos(radians(a2.pickup_lng) - radians(r.d_lng))
                 + sin(radians(r.d_lat)) * sin(radians(a2.pickup_lat))))))::numeric, 0) as dh
        from public.loads a2
        where a2.status = 'available' and a2.rate is not null and a2.pickup_lat is not null
          and a2.id <> all(v_used_loads)
          and (a2.equipment is null or lower(a2.equipment) = lower(r.truck_eq))
          and (a2.expires_at is null or a2.expires_at > now())
      ) p2
      where p2.dh <= 250
      order by p2.dh asc, p2.rate desc limit 1;
    end if;
    v_assign := v_assign || jsonb_build_object(
      'truck', r.unit_no, 'equipment', r.truck_eq, 'from_city', r.a_city,
      'lane', r.origin || ' → ' || r.destination, 'load_id', r.load_id,
      'rate', r.rate, 'miles', r.miles, 'rpm', r.rpm, 'deadhead_mi', r.deadhead_mi,
      'lane_trips', r.lane_trips, 'pickup_date', r.pickup_date,
      'score', round(r.score::numeric, 0), 'reload', v_reload);
  end loop;

  return jsonb_build_object(
    'kpis', jsonb_build_object(
      'trucks', v_trucks, 'busy', v_busy, 'planned', v_planned,
      'idle_after_plan', greatest(v_trucks - v_busy - v_planned, 0),
      'planned_revenue', v_total_rev, 'loaded_miles', v_loaded_mi, 'deadhead_miles', v_dead_mi,
      'deadhead_pct', case when (v_loaded_mi + v_dead_mi) > 0 then round(100 * v_dead_mi / (v_loaded_mi + v_dead_mi), 1) end),
    'plan', v_assign,
    'anchor', case when v_fleet_anchor.lat is not null then jsonb_build_object('city', v_fleet_anchor.city) end);
end; $$;
revoke all on function public.carrier_fleet_plan() from public;
grant execute on function public.carrier_fleet_plan() to authenticated;
notify pgrst, 'reload schema';
