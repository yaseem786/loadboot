-- cux_carrier_advance_trip.sql
-- Let a carrier/driver advance their OWN trip FORWARD through the operational states
-- dispatched -> in_transit -> delivered (so they can mark a trip delivered, which unlocks POD upload).
-- Finance states (invoiced/paid) stay server/staff-controlled. Self-scoped via my_carrier_org(); forward-only.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_advance_trip(p_trip uuid, p_status text)
returns text
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_cur text; rank jsonb := '{"dispatched":1,"in_transit":2,"delivered":3}';
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if p_status not in ('in_transit','delivered') then raise exception 'status must be in_transit or delivered' using errcode='22023'; end if;
  select status into v_cur from app_private.trips where id=p_trip and carrier_id=v_org;
  if v_cur is null then raise exception 'trip not found for your account' using errcode='42501'; end if;
  if not (rank ? v_cur) then raise exception 'this trip cannot be advanced from its current state' using errcode='22023'; end if;
  if (rank->>p_status)::int <= (rank->>v_cur)::int then raise exception 'trips can only move forward' using errcode='22023'; end if;
  update app_private.trips
    set status = p_status,
        dispatched_at = case when p_status='in_transit' and dispatched_at is null then now() else dispatched_at end,
        delivered_at  = case when p_status='delivered' then now() else delivered_at end,
        updated_at = now()
  where id=p_trip and carrier_id=v_org;
  insert into app_private.trip_events(trip_id,kind,note,created_by)
    values (p_trip,'note', case when p_status='in_transit' then 'Carrier started the trip' else 'Carrier marked the trip delivered' end, auth.uid());
  perform app_private.emit_event('trip.status','trip',p_trip::text, jsonb_build_object('status',p_status,'source','pocket'));
  perform app_private.log_audit('pocket.trip.advance','trip',p_trip::text,v_org,p_status,'{}'::jsonb);
  return p_status;
end; $$;
revoke execute on function public.cc_pocket_advance_trip(uuid,text) from anon, public;
grant  execute on function public.cc_pocket_advance_trip(uuid,text) to authenticated;
