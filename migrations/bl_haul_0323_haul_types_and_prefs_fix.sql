-- bl_haul_0323 — Haul type (OTR / Regional / Local) + a real bug fix (6 Sep 2026, owner request)
--
--  1. carrier_dispatch_prefs.haul_types text[]  — which kinds of running the carrier will take.
--     Empty array = no preference = everything matches (never a silent filter).
--     LoadBoot's own bands, stated to the carrier in the UI so nothing is guessed:
--        local <= 250 mi   ·   regional 251-800 mi   ·   otr > 800 mi
--     These are OUR product bands for load LENGTH, not a quoted industry standard. The FMCSA
--     150 air-mile short-haul rule is a RADIUS rule about the driver's day, not a load length —
--     the two are different things and must not be conflated in copy or in code.
--
--  2. app_private.haul_band(miles) — one place that turns a load's miles into a band, so the
--     matcher, the CC and any report can never drift apart.
--
--  3. tp_load_matches gains an additive haul rule: if the carrier set haul_types AND the load
--     has miles, a load outside those bands is not a match. A load with NULL miles is never
--     filtered out — unknown is unknown, we do not guess a band for it.
--
--  4. BUG FIX (found 6 Sep 2026, confirmed on production): the Account → Dispatch tab has been
--     sending target_rpm, max_weight_lbs, min_trip_miles, max_trip_miles, min_notice_hours and
--     avoid_states to cc_set_dispatch_prefs for months, and the function never wrote them —
--     the insert/update column list simply did not include them. On production all 25 prefs
--     rows have min_trip_miles = max_trip_miles = target_rpm = min_notice_hours = NULL and no
--     avoid_states, while home_base (13) and min_rpm (12) — which ARE in the list — are filled.
--     Every field is written only when its key is present in the payload, so no existing caller
--     can be made to clear a value it does not send.
--
-- Additive and reversible. Grants unchanged (authenticated + service_role, as before).

begin;

-- 1) Column ------------------------------------------------------------------------------------
alter table app_private.carrier_dispatch_prefs
  add column if not exists haul_types text[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'carrier_dispatch_prefs_haul_types_chk') then
    alter table app_private.carrier_dispatch_prefs
      add constraint carrier_dispatch_prefs_haul_types_chk
      check (haul_types <@ array['local','regional','otr']::text[]);
  end if;
end $$;

-- 2) One definition of a band -------------------------------------------------------------------
create or replace function app_private.haul_band(p_miles numeric)
returns text language sql immutable
set search_path to 'app_private, public' as $$
  select case
           when p_miles is null or p_miles <= 0 then null      -- unknown stays unknown
           when p_miles <= 250  then 'local'
           when p_miles <= 800  then 'regional'
           else 'otr'
         end;
$$;

-- 3) Matcher — additive haul rule ----------------------------------------------------------------
create or replace function app_private.tp_load_matches(p app_private.truck_postings, l loads)
 returns text
 language plpgsql
 stable
as $function$
declare v_rpm numeric; v_basis text := ''; v_haul text[]; v_band text;
begin
  if l.status is distinct from 'available' then return null; end if;

  if p.equipment is not null and array_length(p.equipment,1) > 0 and l.equipment is not null then
    if not exists (select 1 from unnest(p.equipment) e where l.equipment ilike '%'||e||'%' or e ilike '%'||l.equipment||'%') then return null; end if;
    v_basis := v_basis || 'equipment;';
  end if;

  if l.pickup_date is not null then
    begin
      if l.pickup_date::date < p.available_from or l.pickup_date::date > p.available_to then return null; end if;
      v_basis := v_basis || 'date;';
    exception when others then null; end;
  end if;

  if p.min_rpm is not null and l.rate is not null and coalesce(l.miles,0) > 0 then
    v_rpm := l.rate / l.miles;
    if v_rpm < p.min_rpm then return null; end if;
    v_basis := v_basis || 'rpm ' || round(v_rpm,2) || '>=' || p.min_rpm || ';';
  end if;

  -- Haul type (bl_haul_0323): only bites when the carrier stated a preference AND the load has
  -- miles on it. No preference, or no mileage, means no filtering — never a silent exclusion.
  select c.haul_types into v_haul from app_private.carrier_dispatch_prefs c where c.carrier_id = p.carrier_id;
  if v_haul is not null and array_length(v_haul,1) > 0 then
    v_band := app_private.haul_band(l.miles);
    if v_band is not null then
      if not (v_band = any(v_haul)) then return null; end if;
      v_basis := v_basis || 'haul ' || v_band || ';';
    end if;
  end if;

  if p.origin_lat is not null and p.origin_lng is not null and l.pickup_lat is not null and l.pickup_lng is not null then
    if app_private.haversine_miles(p.origin_lat, p.origin_lng, l.pickup_lat, l.pickup_lng) > p.radius_miles then return null; end if;
    v_basis := v_basis || 'radius;';
  elsif p.origin is not null and l.origin is not null then
    if upper(right(btrim(p.origin),2)) ~ '^[A-Z]{2}$' and upper(right(btrim(l.origin),2)) ~ '^[A-Z]{2}$'
       and upper(right(btrim(p.origin),2)) <> upper(right(btrim(l.origin),2)) then return null; end if;
    v_basis := v_basis || 'state;';
  end if;

  return coalesce(nullif(v_basis,''),'open-criteria');
end; $function$;

-- 4) cc_set_dispatch_prefs — write haul_types AND the six fields the Dispatch tab was losing ------
create or replace function public.cc_set_dispatch_prefs(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_owner uuid; v_haul text[];
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;

  if p ? 'haul_types' then
    v_haul := coalesce((select array_agg(lower(btrim(x))) from jsonb_array_elements_text(coalesce(p->'haul_types','[]'::jsonb)) x
                        where lower(btrim(x)) in ('local','regional','otr')), '{}');
  end if;

  insert into app_private.carrier_dispatch_prefs(carrier_id, min_rpm, preferred_equipment, preferred_lanes, home_base, max_deadhead_miles, notes, available, cost_per_mile, fuel_price, truck_mpg,
      target_rpm, max_weight_lbs, min_trip_miles, max_trip_miles, min_notice_hours, avoid_states, haul_types, updated_by, updated_at)
  values (v_org, nullif(p->>'min_rpm','')::numeric,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'preferred_equipment','[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'preferred_lanes','[]'::jsonb)) x), '{}'),
    p->>'home_base', nullif(p->>'max_deadhead_miles','')::int, p->>'notes',
    coalesce((p->>'available')::boolean, true),
    nullif(p->>'cost_per_mile','')::numeric, nullif(p->>'fuel_price','')::numeric, nullif(p->>'truck_mpg','')::numeric,
    nullif(p->>'target_rpm','')::numeric, nullif(p->>'max_weight_lbs','')::int,
    nullif(p->>'min_trip_miles','')::int, nullif(p->>'max_trip_miles','')::int, nullif(p->>'min_notice_hours','')::int,
    coalesce((select array_agg(upper(btrim(x))) from jsonb_array_elements_text(coalesce(p->'avoid_states','[]'::jsonb)) x), '{}'),
    coalesce(v_haul, '{}'),
    auth.uid(), now())
  on conflict (carrier_id) do update set
    min_rpm=excluded.min_rpm, preferred_equipment=excluded.preferred_equipment, preferred_lanes=excluded.preferred_lanes,
    home_base=excluded.home_base, max_deadhead_miles=excluded.max_deadhead_miles, notes=excluded.notes,
    available=coalesce((p->>'available')::boolean, app_private.carrier_dispatch_prefs.available),
    cost_per_mile=coalesce(nullif(p->>'cost_per_mile','')::numeric, app_private.carrier_dispatch_prefs.cost_per_mile),
    fuel_price=coalesce(nullif(p->>'fuel_price','')::numeric, app_private.carrier_dispatch_prefs.fuel_price),
    truck_mpg=coalesce(nullif(p->>'truck_mpg','')::numeric, app_private.carrier_dispatch_prefs.truck_mpg),
    -- present-key-only: a caller that does not send the field cannot wipe it
    target_rpm       = case when p ? 'target_rpm'       then nullif(p->>'target_rpm','')::numeric      else app_private.carrier_dispatch_prefs.target_rpm end,
    max_weight_lbs   = case when p ? 'max_weight_lbs'   then nullif(p->>'max_weight_lbs','')::int      else app_private.carrier_dispatch_prefs.max_weight_lbs end,
    min_trip_miles   = case when p ? 'min_trip_miles'   then nullif(p->>'min_trip_miles','')::int      else app_private.carrier_dispatch_prefs.min_trip_miles end,
    max_trip_miles   = case when p ? 'max_trip_miles'   then nullif(p->>'max_trip_miles','')::int      else app_private.carrier_dispatch_prefs.max_trip_miles end,
    min_notice_hours = case when p ? 'min_notice_hours' then nullif(p->>'min_notice_hours','')::int    else app_private.carrier_dispatch_prefs.min_notice_hours end,
    avoid_states     = case when p ? 'avoid_states'     then coalesce((select array_agg(upper(btrim(x))) from jsonb_array_elements_text(coalesce(p->'avoid_states','[]'::jsonb)) x), '{}')
                            else app_private.carrier_dispatch_prefs.avoid_states end,
    haul_types       = case when p ? 'haul_types'       then coalesce(v_haul, '{}') else app_private.carrier_dispatch_prefs.haul_types end,
    updated_by=excluded.updated_by, updated_at=now();

  select owner_user_id into v_owner from public.organizations where id = v_org;
  if v_owner is not null then
    update public.profiles set
      weekend_ok   = case when p ? 'weekend_ok'   then (p->>'weekend_ok')::boolean else weekend_ok end,
      hazmat       = case when p ? 'hazmat'       then coalesce((p->>'hazmat')::boolean, false) else hazmat end,
      team_drivers = case when p ? 'team_drivers' then coalesce((p->>'team_drivers')::boolean, false) else team_drivers end
    where id = v_owner;
  end if;

  perform app_private.log_audit('carrier.prefs','carrier',v_org::text,null,'dispatch preferences updated',p);
  return jsonb_build_object('ok',true);
end; $function$;

revoke all on function public.cc_set_dispatch_prefs(jsonb) from public, anon;
grant execute on function public.cc_set_dispatch_prefs(jsonb) to authenticated, service_role;

commit;
