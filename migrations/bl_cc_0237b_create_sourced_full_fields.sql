-- bl_cc_0237b — cc_create_load_sourced now also persists full addresses, geo pins, hazmat
-- flag and the details jsonb (stops, external-broker source block, docs) that the new CC
-- load wizard collects. Backward compatible: all new keys optional; old callers unchanged.
create or replace function public.cc_create_load_sourced(p jsonb)
returns uuid
language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_id uuid; v_src text; v_ver text; v_conf text; a jsonb; bad text[] := '{}'; k text; fm jsonb;
begin
  if not public.has_global_permission('loads.create') then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(p->>'origin','')='' or coalesce(p->>'destination','')='' then raise exception 'origin and destination are required' using errcode='22023'; end if;
  v_src := p->>'source_type';
  if v_src is null then raise exception 'source_type is required (staff must attribute the load source)' using errcode='22023'; end if;
  if v_src <> all (array['partner_portal','staff_entered','licensed_integration','official_api','uploaded_document','imported','unverified_external','quote_converted','recurring_lane','duplicated','api_client'])
    then raise exception 'invalid source_type' using errcode='22023'; end if;
  fm := coalesce(p->'field_meta','{}'::jsonb);
  a := coalesce(fm->'accessorials','{}'::jsonb);
  foreach k in array array['detention_per_hr','detention_free_hours','layover_per_day','tonu'] loop
    if not (a ? k) or (a->>k) !~ '^[0-9]+(\.[0-9]+)?$' then bad := array_append(bad, k); end if;
  end loop;
  if coalesce(trim(a->>'lumper_policy'),'') = '' then bad := array_append(bad, 'lumper_policy'); end if;
  if array_length(bad,1) is not null then
    raise exception 'load is not ready to post — missing/invalid rate card fields: % (a carrier must know detention, layover, TONU and lumper terms before booking)', array_to_string(bad, ', ')
      using errcode='22023';
  end if;
  if not (coalesce((a->>'fcfs')::boolean, false) or coalesce((fm->>'appointment_required')::boolean, false)
          or coalesce(trim(fm->>'pickup_window'),'') <> '') then
    raise exception 'load is not ready to post — choose FCFS or set an appointment / pickup window' using errcode='22023';
  end if;
  v_ver  := coalesce(p->>'verification_state','unverified');
  v_conf := coalesce(p->>'confidence','medium');
  insert into public.loads(origin,destination,equipment,rate,miles,commodity,weight,pickup_date,delivery_date,broker,notes,requirements,status,
      source_type,source_provider,source_reference,verification_state,confidence,source_updated_at,created_by,broker_org,shipper_org,field_meta,
      origin_full,destination_full,pickup_lat,pickup_lng,delivery_lat,delivery_lng,hazmat,details)
  values (p->>'origin', p->>'destination', p->>'equipment', nullif(p->>'rate','')::numeric, nullif(p->>'miles','')::int,
      p->>'commodity', p->>'weight', nullif(p->>'pickup_date','')::date, nullif(p->>'delivery_date','')::date, p->>'broker', p->>'notes', p->>'requirements',
      'available', v_src, p->>'source_provider', p->>'source_reference', v_ver, v_conf, now(), auth.uid(),
      nullif(p->>'broker_org','')::uuid, nullif(p->>'shipper_org','')::uuid, fm,
      nullif(p->>'origin_full',''), nullif(p->>'destination_full',''),
      nullif(p->>'pickup_lat','')::numeric, nullif(p->>'pickup_lng','')::numeric,
      nullif(p->>'delivery_lat','')::numeric, nullif(p->>'delivery_lng','')::numeric,
      coalesce(nullif(p->>'hazmat','')::boolean, false),
      case when p ? 'details' and jsonb_typeof(p->'details')='object' then p->'details' end)
  returning id into v_id;
  perform app_private.emit_event('load.created','load',v_id::text, jsonb_build_object('source',v_src,'origin',p->>'origin','destination',p->>'destination'));
  perform app_private.log_audit('load.create.sourced','load',v_id::text,null,format('load created from %s: %s -> %s', v_src, p->>'origin', p->>'destination'),
    jsonb_build_object('source_type',v_src,'verification',v_ver,'confidence',v_conf));
  return v_id;
end $function$;
