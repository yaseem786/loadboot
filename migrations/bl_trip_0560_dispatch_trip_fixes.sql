-- bl_trip_0560 (22 Oct 2026) — fixes found on the first dispatcher load (Sprint Shift, DFW -> Terrell)
-- 1. cc_assign_load: core returns text 'booked', wrapper stored it in jsonb -> 22P02 "Token booked is invalid" on every Assign.
--    Also notify_org() was handed the carrier's USER id, so the carrier never got the "load assigned" notice.
-- 2. carrier_mandatory_ok: demo orgs (organizations.is_demo, staff-set) pass — the internal test carrier and store-review
--    accounts could never accept a load. Real carriers unchanged.
-- 3. dispatcher_booking_update: dispatcher "picked_up" / "delivered" only wrote a timeline note; the trip stayed
--    'dispatched', so the carrier never got Mark delivered or the POD upload. Now they move the trip.
-- 4. cc_pocket_confirm_trip: idempotent (it logged "Carrier confirmed receipt" 4x on one trip).
-- 5. cc_dispatcher_booking_decide: owner-operator whose phone is the driver's -> driven_by_owner = true
--    (removes the false "Owner phone, but X is assigned — verify who is at the wheel" warning).
-- Every function keeps its signature, so CREATE OR REPLACE keeps its ACL; anon surface unchanged.

-- 1 ---------------------------------------------------------------------------------------------
create or replace function public.cc_assign_load(p_load uuid, p_carrier uuid)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare v text; l record; v_org uuid;
begin
  v := public.cc_assign_load_core(p_load, p_carrier);
  begin
    select origin, destination, rate, pickup_date into l from public.loads where id = p_load;
    select id into v_org from public.organizations where kind = 'carrier' and owner_user_id = p_carrier limit 1;
    perform app_private.notify_org(coalesce(v_org, p_carrier), 'load.assigned', '🚚 Dispatch assigned you a load — '||coalesce(l.origin,'')||' → '||coalesce(l.destination,''),
      '$'||coalesce(l.rate,0)||' · pickup '||coalesce(l.pickup_date::text,'TBD')||'. Open My Trips for the rate confirmation and dispatch sheet.',
      '/app/carrier/#trips','info','assign:'||p_load::text||':'||p_carrier::text);
  exception when others then raise warning 'assign notify failed: %', sqlerrm; end;
  return to_jsonb(v);
end $function$;

-- 2 ---------------------------------------------------------------------------------------------
create or replace function app_private.carrier_mandatory_ok(p_carrier uuid)
returns boolean language sql stable security definer
set search_path to 'app_private, public'
as $function$
  select coalesce((select o.is_demo from public.organizations o where o.id = p_carrier), false)
  or not exists (
    select 1 from app_private.compliance_requirements r
    where r.active and r.mandatory
      and (r.condition_key is null
           or (r.condition_key = 'hazmat' and app_private.carrier_is_hazmat(p_carrier))
           or (r.condition_key = 'bank' and app_private.carrier_has_bank(p_carrier)))
      and not exists (
        select 1 from app_private.carrier_compliance c
        where c.carrier_id = p_carrier and c.requirement_key = r.key
          and c.status = 'valid' and (c.expiry_date is null or c.expiry_date >= current_date)
      )
  );
$function$;

-- 3 ---------------------------------------------------------------------------------------------
do $mig$
declare d text; a text := $a$if v_to = 'dispatched' then update app_private.trips set status = 'dispatched', dispatched_at = coalesce(dispatched_at, now()) where id = v_b.trip_id and status = 'planned'; end if;$a$;
begin
  d := pg_get_functiondef('public.dispatcher_booking_update(uuid,jsonb)'::regprocedure);
  if position('bl_trip_0560' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'bl_trip_0560: dispatcher_booking_update anchor not found exactly once'; end if;
  d := replace(d, a, a || $b$
          -- bl_trip_0560: picked_up / delivered used to stop at a note; the trip stayed 'dispatched' and the carrier never got the POD upload
          if v_to = 'picked_up' then
            update app_private.trips set status = 'in_transit', dispatched_at = coalesce(dispatched_at, now()), started_at = coalesce(started_at, now())
             where id = v_b.trip_id and status in ('planned','dispatched');
            if found then insert into app_private.trip_events (trip_id, kind, to_status, note, created_by) values (v_b.trip_id, 'status', 'in_transit', 'Dispatcher confirmed pickup', v_uid); end if;
          elsif v_to = 'delivered' then
            update app_private.trips set status = 'delivered', delivered_at = coalesce(delivered_at, now()), dispatched_at = coalesce(dispatched_at, now())
             where id = v_b.trip_id and status in ('planned','dispatched','in_transit');
            if found then insert into app_private.trip_events (trip_id, kind, to_status, note, created_by) values (v_b.trip_id, 'status', 'delivered', 'Dispatcher confirmed delivery', v_uid); end if;
          end if;$b$);
  execute d;
end $mig$;

-- 4 ---------------------------------------------------------------------------------------------
create or replace function public.cc_pocket_confirm_trip(p_trip uuid)
returns text language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_status text;
begin
  v_org := app_private.my_carrier_org(); perform app_private.assert_trip_mine(p_trip, v_org);
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select status into v_status from app_private.trips where id=p_trip and carrier_id=v_org;
  if v_status is null then raise exception 'trip not found' using errcode='22023'; end if;
  if exists (select 1 from app_private.trip_events where trip_id = p_trip and note = 'Carrier confirmed receipt of dispatch') then return 'confirmed'; end if;  -- bl_trip_0560
  insert into app_private.trip_events(trip_id,kind,note,created_by)
    values (p_trip,'note','Carrier confirmed receipt of dispatch',auth.uid());
  perform app_private.log_audit('pocket.trip.confirm','trip',p_trip::text,null,'carrier confirmed dispatch', '{}'::jsonb);
  return 'confirmed';
end; $function$;

-- 5 ---------------------------------------------------------------------------------------------
do $mig$
declare d text; a text := 'returning id into v_trip;';
begin
  d := pg_get_functiondef('public.cc_dispatcher_booking_decide(uuid,text,text)'::regprocedure);
  if position('bl_trip_0560' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'bl_trip_0560: cc_dispatcher_booking_decide anchor not found exactly once'; end if;
  d := replace(d, a, a || $b$
        -- bl_trip_0560: owner-operator — the driver's phone is the owner's phone, so the owner app IS the driver's tracker
        update app_private.trips t set driven_by_owner = true
         where t.id = v_trip
           and length(regexp_replace(coalesce(v_drv.driver_phone, ''), '\D', '', 'g')) >= 10
           and exists (select 1 from public.organizations o join public.profiles pr on pr.id = o.owner_user_id
                        where o.id = v_b.carrier_org_id and pr.owner_drives = 'owner'
                          and right(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(v_drv.driver_phone, '\D', '', 'g'), 10));$b$);
  execute d;
end $mig$;
