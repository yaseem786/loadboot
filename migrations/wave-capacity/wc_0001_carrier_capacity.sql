-- wave-capacity · wc_0001
-- CAPACITY RULE: a carrier can run at most (trucks on file) concurrent loads; floor of 1.
--   capacity = greatest(active fleet_trucks, 1)
--   at capacity  <=> active_trips (planned/dispatched/in_transit) >= capacity
-- Fixes:
--  1) match_eligibility only blocked capacity when trucks>0, so a 0-truck (owner-op whose
--     "units" came from FMCSA, not fleet_trucks) bypassed it and showed as available while busy.
--  2) carrier self-book (cc_pocket_book_load) and offer-accept created trips with NO capacity gate.
-- Design is additive: a helper + a corrected match_eligibility + BEFORE-INSERT backstops on
-- trips and load_book_requests. The big booking RPCs are NOT rewritten (lower risk).
-- A 4-truck carrier => up to 4 concurrent loads. A 1-truck (or 0-on-file) carrier => 1.

-- helper: capacity + at-capacity test
create or replace function app_private.carrier_capacity(p_org uuid)
returns integer language sql stable security definer set search_path to 'app_private','public' as $$
  select greatest(
    (select count(*) from app_private.fleet_trucks t
       where t.carrier_id = p_org and coalesce(t.status,'active') <> 'inactive')::int,
    1);
$$;

create or replace function app_private.carrier_at_capacity(p_org uuid)
returns boolean language sql stable security definer set search_path to 'app_private','public' as $$
  select (select count(*) from app_private.trips t
            where t.carrier_id = p_org and t.status in ('planned','dispatched','in_transit'))
         >= app_private.carrier_capacity(p_org);
$$;
revoke all on function app_private.carrier_capacity(uuid) from public, anon;
revoke all on function app_private.carrier_at_capacity(uuid) from public, anon;

-- (2) corrected eligibility: capacity floor of 1 truck (was: only when trucks>0)
create or replace function app_private.match_eligibility(p_load uuid)
 returns table(carrier_id uuid, carrier text, eligible boolean, hard_fails text[], missing_data text[], compliant boolean, trucks integer, active_trips integer, available_trucks integer, drivers integer, available_drivers integer, equipment_match text)
 language plpgsql stable security definer set search_path to 'app_private', 'public'
as $function$
declare v_equip text;
begin
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  select equipment into v_equip from public.loads where id=p_load;
  return query
  with c as (
    select o.id, o.name, coalesce(o.status,'') ostatus, coalesce(o.broker_visible,false) bvis,
      app_private.carrier_mandatory_ok(o.id) compliant,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive')::int trucks,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive'
          and (v_equip is null or lower(trim(t.equipment))=lower(trim(v_equip))))::int equip_trucks,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id)::int drivers,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id and coalesce(d.status,'active')='active'
          and (d.license_exp is null or d.license_exp>=current_date) and (d.medical_exp is null or d.medical_exp>=current_date))::int avail_drivers,
      (select count(*) from app_private.trips t where t.carrier_id=o.id and t.status in ('planned','dispatched','in_transit'))::int active_trips
    from public.organizations o where o.kind='carrier' and coalesce(o.status,'') <> 'archived'
  )
  select c.id, c.name,
    (coalesce(array_length(e.hf,1),0)=0) as eligible,
    e.hf, e.md, c.compliant, c.trucks, c.active_trips, greatest(greatest(c.trucks,1) - c.active_trips, 0) as available_trucks,
    c.drivers, c.avail_drivers,
    (case when v_equip is null then 'unknown' when c.trucks=0 then 'unknown' when c.equip_trucks>0 then 'match' else 'no_match' end) as equipment_match
  from c
  cross join lateral (
    select
      (case when c.ostatus<>'active' then array['carrier not active ('||c.ostatus||')'] else '{}'::text[] end)
      || (case when not c.bvis then array['not published to broker portals'] else '{}'::text[] end)
      || (case when not c.compliant then array['compliance / authority / insurance incomplete'] else '{}'::text[] end)
      || (case when c.active_trips >= greatest(c.trucks,1) then array['no available truck (all on active trips)'] else '{}'::text[] end)
      || (case when v_equip is not null and c.trucks>0 and c.equip_trucks=0 then array['no compatible equipment for '||v_equip] else '{}'::text[] end)
      || (case when c.drivers>0 and c.avail_drivers=0 then array['no available driver (license/medical current)'] else '{}'::text[] end)
        as hf,
      (case when c.trucks=0 then array['no trucks on file'] else '{}'::text[] end)
      || (case when c.drivers=0 then array['no drivers on file'] else '{}'::text[] end)
        as md
  ) e
  order by eligible desc, c.compliant desc, c.name;
end; $function$;

-- (3) hard backstop: a new trip cannot exceed the carrier's truck capacity
create or replace function app_private.trg_trip_capacity()
returns trigger language plpgsql set search_path to 'app_private','public' as $function$
begin
  if new.status in ('planned','dispatched','in_transit')
     and app_private.carrier_at_capacity(new.carrier_id) then
    raise exception 'All of this carrier''s trucks are on active loads — capacity is % truck(s). Deliver one before taking another.',
      app_private.carrier_capacity(new.carrier_id) using errcode='55006';
  end if;
  return new;
end; $function$;
drop trigger if exists trip_capacity on app_private.trips;
create trigger trip_capacity before insert on app_private.trips
  for each row execute function app_private.trg_trip_capacity();

-- (4) friendly early block: a busy carrier can't even request a new load
create or replace function app_private.trg_book_request_capacity()
returns trigger language plpgsql set search_path to 'app_private','public' as $function$
begin
  if app_private.carrier_at_capacity(new.carrier_org) then
    raise exception 'All your trucks are on active loads right now — deliver one before requesting another (capacity = % truck(s) on file).',
      app_private.carrier_capacity(new.carrier_org) using errcode='55006';
  end if;
  return new;
end; $function$;
drop trigger if exists book_request_capacity on app_private.load_book_requests;
create trigger book_request_capacity before insert on app_private.load_book_requests
  for each row execute function app_private.trg_book_request_capacity();
