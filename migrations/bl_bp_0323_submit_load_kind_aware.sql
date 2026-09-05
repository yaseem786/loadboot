-- bl_bp_0323 (5 Sep 2026): shippers post through the SAME wizard as brokers (brokerDash is the live
-- shipper UI; shipperDash/cc_shipper_post_load is the unused path), but cc_partner_submit_load
-- gated everyone with assert_broker_can_post — a confirmed shipper got "Enter your broker MC number".
-- Fix: gate by org kind. Shippers → assert_shipper_can_post (bl_bp_0319: business confirmed);
-- brokers/agents unchanged. Surgical: only the gate block changes; everything else is verbatim.
create or replace function public.cc_partner_submit_load(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_id uuid; v_dup boolean; v_kind text;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  select kind into v_kind from public.organizations where id = v_org;
  -- wd_0033: paperwork gate — booked loads with 4h+ overdue broker docs block new postings
  declare g9 record;
  begin
    select l9.origin as o9, l9.destination as d9, count(*) as cnt
      into g9
      from app_private.load_document_checklist c9
      join app_private.partner_loads pl9 on pl9.id = c9.subject_id and c9.subject_type = 'partner_load'
      join public.loads l9 on l9.id = pl9.posted_load_id
      join app_private.trips t9 on t9.load_id = l9.id and t9.status in ('planned','dispatched','in_transit','delivered')
     where pl9.broker_org = v_org and c9.required_from = 'broker' and c9.status in ('required','rejected')
       and t9.created_at < now() - interval '4 hours'
     group by l9.origin, l9.destination
     order by count(*) desc limit 1;
    if g9.cnt is not null then
      raise exception 'New postings are PAUSED: your booked load % → % is missing % document(s) the carrier has been waiting on for 4+ hours (PU number, rate con, appointment...). Open My Loads → Docs, provide them, then post again.', g9.o9, g9.d9, g9.cnt using errcode='23514';
    end if;
  end;
  -- bl_bp_0312: tiered trust replaces the org.status='active' gate (FMCSA-screened brokers post with limits)
  -- bl_bp_0323: shippers are gated by the business check instead (bl_bp_0319)
  if v_kind = 'shipper' then
    perform app_private.assert_shipper_can_post(v_org);
  else
    perform app_private.assert_broker_can_post(v_org);
  end if;
  -- bl_bp_0318: an agent posts under ONE chosen brokerage — its name, MC and posting limit ride on the load
  declare ap9 app_private.agent_parents;
  begin
    if exists (select 1 from app_private.broker_trust bt where bt.org_id = v_org and bt.is_agent) then
      ap9 := app_private.agent_parent_for_post(v_org, nullif(p->'details'->>'agent_parent_id','')::uuid);
      p := jsonb_set(coalesce(p,'{}'::jsonb), '{details}', coalesce(p->'details','{}'::jsonb) || jsonb_build_object(
             'agent_parent_id', ap9.id, 'agent_parent_mc', ap9.parent_mc, 'agent_parent_name', coalesce(ap9.fmcsa_legal_name, ap9.parent_legal_name)));
    end if;
  end;
  if coalesce(trim(p->>'origin'),'')='' or coalesce(trim(p->>'destination'),'')='' then
    raise exception 'origin and destination are required' using errcode='22023'; end if;
  if p->>'hazmat' is null then
    raise exception 'hazmat declaration is required (yes/no)' using errcode='22023'; end if;
  select exists (select 1 from app_private.partner_loads pl
    where pl.broker_org=v_org and lower(pl.origin)=lower(p->>'origin') and lower(pl.destination)=lower(p->>'destination')
      and pl.pickup_date is not distinct from nullif(p->>'pickup_date','')::date
      and coalesce(pl.status,'') not in ('rejected','cancelled')
      and (pl.created_at > now() - interval '24 hours'
           or coalesce(pl.status,'') in ('submitted','posted','approved'))) into v_dup;
  if v_dup and coalesce(p->>'confirm_duplicate','') <> 'true' then
    raise exception 'possible duplicate load in the last 24h — resubmit with confirm_duplicate=true to proceed' using errcode='23505'; end if;
  insert into app_private.partner_loads(broker_org,origin,destination,equipment,rate,miles,pickup_date,delivery_date,
      pickup_window,delivery_window,weight,commodity,notes,stops,appointment_required,tracking_required,accessorials,reference,status,submitted_at,hazmat,hazmat_info,origin_full,destination_full,pickup_lat,pickup_lng,delivery_lat,delivery_lng,details)
  values (v_org, trim(p->>'origin'), trim(p->>'destination'), p->>'equipment', nullif(p->>'rate','')::numeric, nullif(p->>'miles','')::numeric,
      nullif(p->>'pickup_date','')::date, nullif(p->>'delivery_date','')::date, p->>'pickup_window', p->>'delivery_window',
      nullif(p->>'weight','')::numeric, p->>'commodity', p->>'notes', coalesce(p->'stops','[]'::jsonb),
      coalesce((p->>'appointment_required')::boolean,false), coalesce((p->>'tracking_required')::boolean,false),
      coalesce(p->'accessorials','{}'::jsonb), p->>'reference', 'submitted', now(),
      coalesce((p->>'hazmat')::boolean,false), nullif(btrim(coalesce(p->>'hazmat_info','')),''),nullif(btrim(coalesce(p->>'origin_full','')),''),nullif(btrim(coalesce(p->>'destination_full','')),''),nullif(p->>'pickup_lat','')::double precision,nullif(p->>'pickup_lng','')::double precision,nullif(p->>'delivery_lat','')::double precision,nullif(p->>'delivery_lng','')::double precision,coalesce(p->'details','{}'::jsonb))
  returning id into v_id;
  perform app_private.seed_load_checklist('partner_load', v_id, jsonb_build_array(
    jsonb_build_object('doc_key','rate_confirmation','label','Rate confirmation','required_from','broker'),
    jsonb_build_object('doc_key','pickup_number','label','Pickup number','required_from','broker'),
    jsonb_build_object('doc_key','delivery_number','label','Delivery number','required_from','broker'),
    jsonb_build_object('doc_key','appointment_confirmation','label','Appointment confirmation','required_from','broker'),
    jsonb_build_object('doc_key','billing_contact','label','Billing contact','required_from','broker')));
  -- wd_0032: prefill checklist items the broker already provided in the wizard
  if p ? 'docs' then
    declare d9 record;
    begin
      for d9 in select key as k, value #>> '{}' as val from jsonb_each(p->'docs')
                 where coalesce(value #>> '{}','') <> ''
      loop
        update app_private.load_document_checklist
           set status='received', submitted_ref=d9.val, submitted_at=now(),
               submitted_by=auth.uid(), updated_at=now()
         where subject_type='partner_load' and subject_id=v_id
           and doc_key=d9.k and status='required';
      end loop;
    end;
  end if;
  perform app_private.emit_event('partner.load_submitted','partner_load', v_id::text,
    jsonb_build_object('org',v_org,'load',v_id,'duplicate_confirmed',v_dup,'hazmat',coalesce((p->>'hazmat')::boolean,false)));
  return jsonb_build_object('id', v_id, 'status', 'submitted', 'duplicate_flagged', v_dup);
end; $function$;
