-- bl_claims_0064 — broker can VIEW carrier stop-proof documents on claims of their own loads.
-- 1) claim_bundle: stop_documents now carries id/path/bucket so the partner UI can open them.
-- 2) partner_can_read_stop_doc(name): SECURITY DEFINER gate — doc must belong to a trip whose
--    load's broker_org = caller's partner org, and be one of the stop-proof kinds.
-- 3) storage.objects SELECT policy for authenticated using that gate (signed URLs work client-side).

create or replace function app_private.claim_bundle(p_id uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'app_private, public'
as $function$
declare a record; t record; l record; v_pol jsonb; v_dwell jsonb; v_cxl jsonb; v_carrier text; v_broker text; v_docs jsonb; v_tl jsonb;
begin
  select * into a from app_private.trip_accessorials where id = p_id;
  if a is null then return null; end if;
  select * into t from app_private.trips where id = a.trip_id;
  select * into l from public.loads where id = t.load_id;
  select name into v_carrier from public.organizations where id = t.carrier_id;
  select name into v_broker from public.organizations where id = l.broker_org;
  begin v_pol := public.cc_rate_standards(); exception when others then v_pol := null; end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'stop', e.stop_type, 'arrived_at', e.arrived_at, 'departed_at', e.departed_at,
      'held_minutes', case when e.arrived_at is not null and e.departed_at is not null then round(extract(epoch from e.departed_at - e.arrived_at)/60) end,
      'free_minutes', e.free_minutes,
      'detention_minutes', case when e.arrived_at is not null and e.departed_at is not null
          then greatest(round(extract(epoch from e.departed_at - e.arrived_at)/60) - coalesce(e.free_minutes,0), 0) end,
      'gps', case when e.lat is not null then jsonb_build_object('lat', e.lat, 'lng', e.lng, 'distance_m', e.distance_m) end,
      'stop_gps', case when e.stop_type = 'pickup' and t.pickup_lat is not null then jsonb_build_object('lat', t.pickup_lat, 'lng', t.pickup_lng)
                       when e.stop_type = 'delivery' and t.delivery_lat is not null then jsonb_build_object('lat', t.delivery_lat, 'lng', t.delivery_lng) end
    ) order by e.arrived_at), '[]'::jsonb)
    into v_dwell from app_private.trip_dwell_events e where e.trip_id = a.trip_id;
  select coalesce(jsonb_agg(jsonb_build_object('at', g.occurred_at, 'what', g.summary) order by g.occurred_at), '[]'::jsonb)
    into v_cxl from app_private.audit_logs g
   where g.target_type in ('load','trip') and g.target_id in (t.load_id::text, t.id::text)
     and (g.action ilike '%cancel%' or g.summary ilike '%cancel%');
  select coalesce(jsonb_agg(jsonb_build_object('id', df.id, 'kind', df.kind, 'file_name', df.file_name, 'uploaded_at', df.created_at, 'status', df.status, 'path', df.path, 'bucket', df.bucket) order by df.created_at), '[]'::jsonb)
    into v_docs from app_private.document_files df
   where df.owner_type = 'trip' and df.owner_id = t.id::text
     and df.kind in ('pod','bol_signed','pod_signed','lumper_receipt','gate_ticket','stop_photo');
  -- narrative timeline: WHO caused the wait, in plain words
  select coalesce(jsonb_agg(ev order by (ev->>'at')), '[]'::jsonb) into v_tl from (
    select jsonb_build_object('at', t.scheduled_pickup, 'what', 'Appointment: pickup scheduled') as ev where t.scheduled_pickup is not null
    union all
    select jsonb_build_object('at', t.started_at, 'what', 'Trip started — truck en route (GPS tracking on)') where t.started_at is not null
    union all
    select jsonb_build_object('at', e.arrived_at, 'what',
        'ARRIVED at ' || e.stop_type || ' — GPS-verified on scene'
        || case when e.stop_type = 'pickup' and t.scheduled_pickup is not null and t.pickup_mode is distinct from 'fcfs'
             then case when e.arrived_at <= t.scheduled_pickup then ' · ON TIME for the appointment (any wait after this is on the facility)'
                       else ' · ' || round(extract(epoch from e.arrived_at - t.scheduled_pickup)/60) || ' min after the appointment' end
             else '' end)
      from app_private.trip_dwell_events e where e.trip_id = t.id and e.arrived_at is not null
    union all
    select jsonb_build_object('at', e.departed_at, 'what',
        'DEPARTED ' || e.stop_type || ' — held ' || round(extract(epoch from e.departed_at - e.arrived_at)/60) || ' min (free ' || coalesce(e.free_minutes,0) || ' min'
        || case when round(extract(epoch from e.departed_at - e.arrived_at)/60) > coalesce(e.free_minutes,0)
             then ' → ' || (round(extract(epoch from e.departed_at - e.arrived_at)/60) - coalesce(e.free_minutes,0)) || ' min DETENTION, truck stayed inside the geofence the whole time)'
             else ')' end)
      from app_private.trip_dwell_events e where e.trip_id = t.id and e.departed_at is not null
    union all
    select jsonb_build_object('at', df.created_at, 'what',
        case df.kind when 'bol_signed' then 'Facility-SIGNED BOL uploaded by driver (in/out times on paper — the facility''s own acknowledgement)'
                     when 'pod_signed' then 'Facility-SIGNED POD uploaded by driver'
                     when 'lumper_receipt' then 'Lumper receipt uploaded (paid crew demanded by facility)'
                     when 'gate_ticket' then 'Gate ticket uploaded (facility gate record)'
                     when 'pod' then 'POD uploaded by driver'
                     else 'Stop photo uploaded' end)
      from app_private.document_files df where df.owner_type='trip' and df.owner_id=t.id::text
        and df.kind in ('pod','bol_signed','pod_signed','lumper_receipt','gate_ticket','stop_photo')
    union all
    select jsonb_build_object('at', t.delivered_at, 'what', 'Delivered — trip complete') where t.delivered_at is not null
    union all
    select jsonb_build_object('at', a.created_at, 'what', 'Claim filed (' || a.kind || ') with this evidence attached')
  ) z;
  return jsonb_build_object(
    'claim', jsonb_build_object('id', a.id, 'ref', 'CLM-' || upper(left(replace(a.id::text,'-',''),8)),
      'kind', a.kind, 'amount', a.amount, 'status', a.status, 'note', a.note, 'filed_at', a.created_at,
      'decision_note', a.decision_note, 'broker_status', a.broker_status, 'broker_note', a.broker_note,
      'broker_decided_at', a.broker_decided_at, 'support_status', a.support_status,
      'support_verdict', a.support_verdict, 'support_note', a.support_note),
    'trip', jsonb_build_object('id', t.id, 'origin', l.origin, 'destination', l.destination,
      'rate', t.rate, 'miles', t.miles, 'pickup_mode', t.pickup_mode,
      'scheduled_pickup', t.scheduled_pickup, 'scheduled_delivery', t.scheduled_delivery,
      'started_at', t.started_at, 'delivered_at', t.delivered_at, 'status', t.status,
      'carrier', v_carrier, 'broker', v_broker, 'load_status', l.status,
      'pickup_gps', case when t.pickup_lat is not null then jsonb_build_object('lat', t.pickup_lat, 'lng', t.pickup_lng) end,
      'delivery_gps', case when t.delivery_lat is not null then jsonb_build_object('lat', t.delivery_lat, 'lng', t.delivery_lng) end),
    'gps_dwell', v_dwell,
    'stop_documents', v_docs,
    'timeline', v_tl,
    'policy', v_pol,
    'cancellation_trail', v_cxl,
    'filed_evidence', a.evidence);
end; $function$;

create or replace function public.partner_can_read_stop_doc(p_name text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'app_private, public'
as $$
  select exists (
    select 1 from app_private.document_files df
    join app_private.trips t on t.id::text = df.owner_id
    join public.loads l on l.id = t.load_id
    where df.owner_type = 'trip' and df.bucket = 'documents' and df.path = p_name
      and df.kind in ('pod','bol_signed','pod_signed','lumper_receipt','gate_ticket','stop_photo')
      and l.broker_org = app_private.my_partner_org()
  );
$$;
revoke all on function public.partner_can_read_stop_doc(text) from public;
grant execute on function public.partner_can_read_stop_doc(text) to authenticated;

drop policy if exists "partner read claim stop documents" on storage.objects;
create policy "partner read claim stop documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.partner_can_read_stop_doc(name));

notify pgrst, 'reload schema';
