-- ct-waveBL · Phase C (part 1) — Accessorial Proof Engine
-- Detention/Layover/TONU/Lumper claims with automatic GPS+timestamp evidence.
-- • trip_accessorials gains status ('requested'|'approved'|'rejected'), evidence jsonb, decision cols
--   (default 'approved' keeps every existing CC-entered row working unchanged)
-- • Auto-DETENTION: when a depart stamp closes a dwell past free minutes → 'requested' accessorial
--   with the arrive/depart/GPS evidence attached automatically
-- • Auto-TONU: trip cancelled after dispatch/start or after a pickup arrival → 'requested' TONU
-- • cc_carrier_request_accessorial: carrier files layover/lumper/detention/TONU claim, evidence auto-attached
-- • cc_review_accessorial: staff approve (sets amount, billable) / reject with reason; carrier notified
-- • cc_trip_accessorials: list for staff + the trip's carrier
-- • cc_trip_set_stop_coords: persist geocoded pickup/delivery coords (fill-once) → server geofence armed

alter table app_private.trip_accessorials
  add column if not exists status text not null default 'approved'
    check (status in ('requested','approved','rejected')),
  add column if not exists evidence jsonb,
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;

create or replace function app_private.trip_evidence_snapshot(p_trip uuid)
returns jsonb language sql stable
set search_path to 'app_private', 'public'
as $$
  select jsonb_build_object(
    'captured_at', now(),
    'trip_status', t.status,
    'pickup_mode', t.pickup_mode,
    'scheduled_pickup', t.scheduled_pickup,
    'scheduled_delivery', t.scheduled_delivery,
    'started_at', t.started_at,
    'delivered_at', t.delivered_at,
    'last_location', case when t.last_lat is not null then jsonb_build_object('lat', t.last_lat, 'lng', t.last_lng, 'at', t.last_loc_at) end,
    'dwell', coalesce((select jsonb_agg(jsonb_build_object(
        'stop', d.stop_type, 'arrived_at', d.arrived_at, 'departed_at', d.departed_at,
        'free_minutes', d.free_minutes, 'gps', case when d.lat is not null then jsonb_build_object('lat', d.lat, 'lng', d.lng, 'distance_m', d.distance_m) end,
        'dwell_minutes', case when d.departed_at is not null then floor(extract(epoch from (d.departed_at - d.arrived_at))/60)::int end
      ) order by d.arrived_at) from app_private.trip_dwell_events d where d.trip_id = p_trip), '[]'::jsonb)
  ) from app_private.trips t where t.id = p_trip;
$$;

create or replace function public.cc_carrier_request_accessorial(p_trip uuid, p_kind text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path to 'app_private', 'public'
as $function$
declare v_id uuid; v_ev jsonb;
begin
  if p_kind not in ('detention','layover','tonu','lumper','other') then
    raise exception 'kind must be detention, layover, tonu, lumper or other' using errcode='22023';
  end if;
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  v_ev := app_private.trip_evidence_snapshot(p_trip);
  insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
    values (p_trip, p_kind, null, false, p_note, auth.uid(), 'requested', v_ev)
    returning id into v_id;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
      values ('staff', 'inapp', 'ops.accessorial.requested',
        jsonb_build_object('trip', p_trip, 'kind', p_kind, 'accessorial', v_id, 'note', p_note));
  exception when others then null; end;
  perform app_private.log_audit('dispatch.accessorial.request','trip',p_trip::text,null, p_kind || ' claim filed by carrier', jsonb_build_object('id', v_id));
  perform app_private.emit_event('trip.accessorial.requested','trip',p_trip::text, jsonb_build_object('kind', p_kind, 'id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'requested', 'evidence', v_ev,
    'note', 'Claim filed with your recorded arrive/depart times and GPS as proof. Dispatch will review it.');
end; $function$;

create or replace function public.cc_review_accessorial(p_id uuid, p_action text, p_amount numeric default null, p_note text default null)
returns jsonb language plpgsql security definer
set search_path to 'app_private', 'public'
as $function$
declare a record;
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_action not in ('approve','reject') then raise exception 'action must be approve or reject' using errcode='22023'; end if;
  if p_action = 'reject' and coalesce(trim(p_note),'') = '' then raise exception 'a reason is required to reject' using errcode='22023'; end if;
  if p_action = 'approve' and (p_amount is null or p_amount < 0) then raise exception 'an amount is required to approve' using errcode='22023'; end if;
  update app_private.trip_accessorials
     set status = case when p_action='approve' then 'approved' else 'rejected' end,
         billable = (p_action = 'approve'),
         amount = case when p_action='approve' then p_amount else amount end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_id and status = 'requested'
   returning * into a;
  if a.id is null then raise exception 'claim not found or already decided' using errcode='22023'; end if;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload)
      values (a.created_by, 'inapp', 'trip.accessorial.' || a.status,
        jsonb_build_object('trip', a.trip_id, 'kind', a.kind, 'amount', a.amount, 'note', p_note));
  exception when others then null; end;
  perform app_private.log_audit('dispatch.accessorial.' || p_action,'trip',a.trip_id::text,null, a.kind || ' ' || a.status || coalesce(' $' || a.amount, ''), jsonb_build_object('id', a.id));
  perform app_private.emit_event('trip.accessorial.' || a.status,'trip',a.trip_id::text, jsonb_build_object('kind', a.kind, 'id', a.id, 'amount', a.amount));
  return jsonb_build_object('ok', true, 'id', a.id, 'status', a.status, 'amount', a.amount);
end; $function$;

create or replace function public.cc_trip_accessorials(p_trip uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private', 'public'
as $function$
begin
  if not (app_private.can_touch_trip(p_trip) or public.is_active_staff()) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'status', a.status, 'amount', a.amount, 'billable', a.billable,
      'note', a.note, 'decision_note', a.decision_note, 'created_at', a.created_at,
      'decided_at', a.decided_at, 'evidence', a.evidence) order by a.created_at desc)
    from app_private.trip_accessorials a where a.trip_id = p_trip), '[]'::jsonb);
end; $function$;

create or replace function public.cc_trip_set_stop_coords(p_trip uuid, p_plat double precision, p_plng double precision, p_dlat double precision, p_dlng double precision)
returns jsonb language plpgsql security definer
set search_path to 'app_private', 'public'
as $function$
begin
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.trips set
    pickup_lat   = coalesce(pickup_lat, p_plat),
    pickup_lng   = coalesce(pickup_lng, p_plng),
    delivery_lat = coalesce(delivery_lat, p_dlat),
    delivery_lng = coalesce(delivery_lng, p_dlng)
  where id = p_trip;
  return jsonb_build_object('ok', true);
end; $function$;

-- AUTO-DETENTION: depart closes a dwell past free minutes → claim drafted with evidence
create or replace function app_private.trg_auto_detention()
returns trigger language plpgsql
set search_path to 'app_private', 'public'
as $function$
declare v_det int;
begin
  if new.departed_at is not null and old.departed_at is null then
    v_det := greatest(floor(extract(epoch from (new.departed_at - new.arrived_at))/60)::int - new.free_minutes, 0);
    if v_det > 0 and not exists (
      select 1 from app_private.trip_accessorials
      where trip_id = new.trip_id and kind = 'detention' and (evidence->>'dwell_id')::uuid = new.id
    ) then
      insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
        values (new.trip_id, 'detention', null, false,
          'Auto-detected: ' || v_det || ' min past free time at ' || new.stop_type, new.created_by, 'requested',
          app_private.trip_evidence_snapshot(new.trip_id) || jsonb_build_object('dwell_id', new.id, 'detention_minutes', v_det, 'auto', true));
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload)
          values ('staff', 'inapp', 'ops.accessorial.requested',
            jsonb_build_object('trip', new.trip_id, 'kind', 'detention', 'minutes', v_det, 'auto', true));
      exception when others then null; end;
    end if;
  end if;
  return new;
end; $function$;
drop trigger if exists auto_detention on app_private.trip_dwell_events;
create trigger auto_detention after update on app_private.trip_dwell_events
  for each row execute function app_private.trg_auto_detention();

-- AUTO-TONU: cancelled after dispatch/start or after arriving at pickup → claim drafted
create or replace function app_private.trg_auto_tonu()
returns trigger language plpgsql
set search_path to 'app_private', 'public'
as $function$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and (old.status in ('dispatched','in_transit') or new.started_at is not null
          or exists (select 1 from app_private.trip_dwell_events d where d.trip_id = new.id and d.stop_type = 'pickup'))
     and not exists (select 1 from app_private.trip_accessorials a where a.trip_id = new.id and a.kind = 'tonu') then
    insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
      values (new.id, 'tonu', null, false,
        'Auto-detected: load cancelled after truck was committed (TONU review)', new.created_by, 'requested',
        app_private.trip_evidence_snapshot(new.id) || jsonb_build_object('auto', true, 'cancelled_from', old.status));
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload)
        values ('staff', 'inapp', 'ops.accessorial.requested',
          jsonb_build_object('trip', new.id, 'kind', 'tonu', 'auto', true));
    exception when others then null; end;
  end if;
  return new;
end; $function$;
drop trigger if exists auto_tonu on app_private.trips;
create trigger auto_tonu after update on app_private.trips
  for each row execute function app_private.trg_auto_tonu();

revoke all on function public.cc_carrier_request_accessorial(uuid,text,text) from public, anon;
revoke all on function public.cc_review_accessorial(uuid,text,numeric,text) from public, anon;
revoke all on function public.cc_trip_accessorials(uuid) from public, anon;
revoke all on function public.cc_trip_set_stop_coords(uuid,double precision,double precision,double precision,double precision) from public, anon;
grant execute on function public.cc_carrier_request_accessorial(uuid,text,text) to authenticated, service_role;
grant execute on function public.cc_review_accessorial(uuid,text,numeric,text) to authenticated, service_role;
grant execute on function public.cc_trip_accessorials(uuid) to authenticated, service_role;
grant execute on function public.cc_trip_set_stop_coords(uuid,double precision,double precision,double precision,double precision) to authenticated, service_role;
