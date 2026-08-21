-- bl_cc_0237_staff_track_load — staff-side live tracking feed for ANY load, mirroring the
-- broker-only cc_partner_track_load shape. Powers the new CC Loads & trips tracker modal
-- (map, milestones, breadcrumb, dwell timeline). Staff-gated; additive; no existing fn touched.
create or replace function public.cc_staff_track_load(p_load uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare l public.loads; t app_private.trips; v_carrier text;
begin
  if not (public.has_global_permission('dispatch.view') or public.has_global_permission('loads.assign')
          or public.has_global_permission('loads.create') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select * into l from public.loads where id = p_load;
  if l.id is null then raise exception 'load not found' using errcode='22023'; end if;
  select tr.* into t from app_private.trips tr where tr.load_id = l.id order by tr.created_at desc limit 1;
  if t.carrier_id is not null then select name into v_carrier from public.organizations where id = t.carrier_id; end if;

  return jsonb_build_object(
    'load', jsonb_build_object(
      'id', l.id, 'origin', l.origin, 'destination', l.destination,
      'origin_full', l.origin_full, 'destination_full', l.destination_full,
      'status', l.status, 'created_at', l.created_at, 'rate', l.rate, 'miles', l.miles,
      'equipment', l.equipment, 'commodity', l.commodity, 'weight', l.weight,
      'pickup_date', l.pickup_date, 'delivery_date', l.delivery_date,
      'pickup_lat', l.pickup_lat, 'pickup_lng', l.pickup_lng,
      'delivery_lat', l.delivery_lat, 'delivery_lng', l.delivery_lng,
      'broker', l.broker, 'source_type', l.source_type, 'source_provider', l.source_provider,
      'source_reference', l.source_reference, 'verification_state', l.verification_state,
      'confidence', l.confidence, 'field_meta', l.field_meta, 'details', l.details),
    'trip', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'status', t.status, 'carrier', v_carrier, 'carrier_id', t.carrier_id,
      'driver_name', t.driver_name, 'driver_phone', t.driver_phone,
      'truck_no', t.truck_no, 'trailer_no', t.trailer_no,
      'booked_at', t.created_at, 'dispatched_at', t.dispatched_at, 'started_at', t.started_at,
      'delivered_at', t.delivered_at, 'cancelled_by', t.cancelled_by,
      'scheduled_pickup', t.scheduled_pickup, 'scheduled_delivery', t.scheduled_delivery,
      'last_lat', t.last_lat, 'last_lng', t.last_lng, 'last_loc_at', t.last_loc_at,
      'tracking_method', t.tracking_method,
      'pickup_lat', coalesce(t.pickup_lat, l.pickup_lat), 'pickup_lng', coalesce(t.pickup_lng, l.pickup_lng),
      'delivery_lat', coalesce(t.delivery_lat, l.delivery_lat), 'delivery_lng', coalesce(t.delivery_lng, l.delivery_lng)) end,
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object('kind', s.kind, 'sort', s.sort, 'location', s.location,
        'scheduled_at', s.scheduled_at, 'arrived_at', s.arrived_at, 'departed_at', s.departed_at) order by s.sort)
      from app_private.trip_stops s where t.id is not null and s.trip_id = t.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(e2 order by (e2->>'created_at') desc) from (
        select jsonb_build_object('kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
          'note', e.note, 'location', e.location, 'created_at', e.created_at) e2
        from app_private.trip_events e where t.id is not null and e.trip_id = t.id
        order by e.created_at desc limit 40) x), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(l2 order by (l2->>'created_at')) from (
        select jsonb_build_object('lat', tl.lat, 'lng', tl.lng, 'created_at', tl.created_at, 'source', tl.source) l2
        from app_private.trip_locations tl where t.id is not null and tl.trip_id = t.id
        order by tl.created_at desc limit 120) y), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_build_object(
        'sent', count(*),
        'pending', count(*) filter (where o.status in ('sent','viewed')),
        'accepted', count(*) filter (where o.status = 'accepted'),
        'declined', count(*) filter (where o.status in ('declined','expired')),
        'next_expiry', min(o.expiry_at) filter (where o.status in ('sent','viewed')))
      from app_private.load_offers o where o.load_id = l.id), jsonb_build_object('sent',0,'pending',0,'accepted',0,'declined',0))
  );
end $function$;

revoke all on function public.cc_staff_track_load(uuid) from anon, public;
grant execute on function public.cc_staff_track_load(uuid) to authenticated, service_role;

do $$ declare n int; begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='cc_staff_track_load'
     and has_function_privilege('anon', p.oid,'EXECUTE');
  if n <> 0 then raise exception 'cc_staff_track_load still anon-executable'; end if;
end $$;
