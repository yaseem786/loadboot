-- cc_v1_0030 — Command Center V1 operator surface. Clean, reviewed replacement for
-- experimental 0021. Every read is a permission-gated SECURITY DEFINER DTO; every write
-- re-checks permission server-side and writes an audit row in the same transaction.
-- app_private is never exposed. Depends on baseline + 0015-0020. STAGING (and prod-ready).

create or replace function public.cc_get_overview()
 returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare j jsonb;
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_build_object(
    'carriers_total', (select count(*) from public.profiles where role='carrier'),
    'carriers_pending', (select count(*) from public.profiles where role='carrier' and status='pending'),
    'carriers_active', (select count(*) from public.profiles where role='carrier' and status='active'),
    'carriers_paused', (select count(*) from public.profiles where role='carrier' and status='paused'),
    'loads_available', (select count(*) from public.loads where status='available'),
    'loads_booked', (select count(*) from public.loads where status='booked'),
    'loads_in_transit', (select count(*) from public.loads where status='in_transit'),
    'loads_delivered', (select count(*) from public.loads where status='delivered'),
    'documents_pending', (select count(*) from public.documents where status='pending'),
    'staff_active', (select count(*) from app_private.staff_members where status='active')
  ) into j;
  return j;
end; $function$;

create or replace function public.cc_list_carriers(p_search text default null, p_status text default null, p_limit int default 100)
 returns table (id uuid, company text, contact_name text, email text, phone text, mc text, dot text, status text, equipment_types text[], home_base text, created_at timestamptz, doc_pending int)
 language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare v_limit int := least(greatest(coalesce(p_limit,100),1), 500);
begin
  if not public.has_global_permission('carriers.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select pr.id, pr.company, pr.contact_name, pr.email, pr.phone, pr.mc, pr.dot, pr.status,
           pr.equipment_types, pr.home_base, pr.created_at,
           (select count(*)::int from public.documents d where d.carrier_id=pr.id and d.status='pending')
    from public.profiles pr
    where pr.role='carrier'
      and (p_status is null or pr.status=p_status)
      and (p_search is null or pr.company ilike '%'||p_search||'%' or pr.email ilike '%'||p_search||'%' or pr.mc ilike '%'||p_search||'%')
    order by pr.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_get_carrier(p_carrier uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare j jsonb; pr record;
begin
  if not public.can_access_carrier(p_carrier, 'carriers.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select * into pr from public.profiles where id=p_carrier and role='carrier';
  if pr is null then raise exception 'carrier not found' using errcode='22023'; end if;
  select jsonb_build_object(
    'id', pr.id, 'company', pr.company, 'contact_name', pr.contact_name, 'email', pr.email,
    'phone', pr.phone, 'mc', pr.mc, 'dot', pr.dot, 'status', pr.status, 'home_base', pr.home_base,
    'equipment_types', pr.equipment_types, 'truck_count', pr.truck_count, 'radius_miles', pr.radius_miles,
    'factoring_status', pr.factoring_status, 'created_at', pr.created_at, 'submitted_at', pr.submitted_at,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'file_name', d.file_name,
                    'status', d.status, 'review_note', d.review_note, 'reviewed_at', d.reviewed_at, 'created_at', d.created_at) order by d.created_at desc)
                  from public.documents d where d.carrier_id=pr.id), '[]'::jsonb)
  ) into j;
  return j;
end; $function$;

create or replace function public.cc_set_carrier_status(p_carrier uuid, p_status text, p_note text default null)
 returns text language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_corg uuid; v_before text;
begin
  if p_status not in ('active','pending','paused') then raise exception 'status must be active, pending or paused' using errcode='22023'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'note too long (max 500)' using errcode='22023'; end if;
  if not public.can_access_carrier(p_carrier, 'carriers.approve') then raise exception 'not authorized' using errcode='42501'; end if;
  select status into v_before from public.profiles where id=p_carrier and role='carrier';
  if v_before is null then raise exception 'carrier not found' using errcode='22023'; end if;
  select id into v_corg from public.organizations where kind='carrier' and owner_user_id=p_carrier;
  update public.profiles set status=p_status where id=p_carrier;
  perform app_private.log_audit('carrier.status_change', 'carrier', p_carrier::text, v_corg,
    format('carrier status %s -> %s', v_before, p_status),
    jsonb_build_object('from', v_before, 'to', p_status, 'cause', 'command_center', 'note_present', (p_note is not null)));
  return p_status;
end; $function$;

create or replace function public.cc_list_documents(p_status text default 'pending', p_limit int default 100)
 returns table (id uuid, carrier_id uuid, company text, type text, file_name text, status text, created_at timestamptz)
 language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare v_limit int := least(greatest(coalesce(p_limit,100),1), 500);
begin
  if not public.has_global_permission('documents.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select d.id, d.carrier_id, pr.company, d.type, d.file_name, d.status, d.created_at
    from public.documents d join public.profiles pr on pr.id=d.carrier_id
    where (p_status is null or d.status=p_status)
    order by d.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_list_loads(p_status text default null, p_search text default null, p_limit int default 200)
 returns table (id uuid, origin text, destination text, equipment text, rate numeric, miles int, status text, assigned_to uuid, assigned_company text, pickup_date date, created_at timestamptz)
 language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1), 500);
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select l.id, l.origin, l.destination, l.equipment, l.rate, l.miles, l.status, l.assigned_to, pr.company, l.pickup_date, l.created_at
    from public.loads l left join public.profiles pr on pr.id=l.assigned_to
    where (p_status is null or l.status=p_status)
      and (p_search is null or l.origin ilike '%'||p_search||'%' or l.destination ilike '%'||p_search||'%')
    order by l.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_get_load(p_load uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare j jsonb;
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_build_object('id', l.id, 'origin', l.origin, 'destination', l.destination, 'equipment', l.equipment,
    'commodity', l.commodity, 'weight', l.weight, 'miles', l.miles, 'deadhead', l.deadhead, 'rate', l.rate,
    'status', l.status, 'assigned_to', l.assigned_to, 'assigned_company', pr.company, 'broker', l.broker,
    'pickup_date', l.pickup_date, 'delivery_date', l.delivery_date, 'requirements', l.requirements, 'created_at', l.created_at)
  into j from public.loads l left join public.profiles pr on pr.id=l.assigned_to where l.id=p_load;
  if j is null then raise exception 'load not found' using errcode='22023'; end if;
  return j;
end; $function$;

create or replace function public.cc_create_load(p_origin text, p_destination text, p_equipment text, p_rate numeric default null, p_miles int default null, p_commodity text default null, p_pickup_date date default null)
 returns uuid language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('loads.create') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_origin is null or p_destination is null then raise exception 'origin and destination are required' using errcode='22023'; end if;
  insert into public.loads(origin, destination, equipment, rate, miles, commodity, pickup_date, status)
    values (p_origin, p_destination, p_equipment, p_rate, p_miles, p_commodity, p_pickup_date, 'available')
    returning id into v_id;
  perform app_private.log_audit('load.create', 'load', v_id::text, null, format('load created %s -> %s', p_origin, p_destination),
    jsonb_build_object('origin', p_origin, 'destination', p_destination, 'rate', p_rate));
  return v_id;
end; $function$;

create or replace function public.cc_assign_load(p_load uuid, p_carrier uuid)
 returns text language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_before text;
begin
  if not public.can_access_load(p_load, 'loads.assign') then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.profiles where id=p_carrier and role='carrier') then raise exception 'carrier not found' using errcode='22023'; end if;
  select status into v_before from public.loads where id=p_load;
  if v_before is null then raise exception 'load not found' using errcode='22023'; end if;
  update public.loads set assigned_to=p_carrier, status='booked' where id=p_load;
  perform app_private.log_audit('load.assign', 'load', p_load::text, null, format('load assigned to %s', p_carrier),
    jsonb_build_object('carrier', p_carrier, 'status_from', v_before, 'status_to', 'booked'));
  return 'booked';
end; $function$;

create or replace function public.cc_set_load_status(p_load uuid, p_status text)
 returns text language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_before text;
begin
  if p_status not in ('available','booked','in_transit','delivered','cancelled') then raise exception 'invalid load status' using errcode='22023'; end if;
  if not public.can_access_load(p_load, 'loads.assign') then raise exception 'not authorized' using errcode='42501'; end if;
  select status into v_before from public.loads where id=p_load;
  if v_before is null then raise exception 'load not found' using errcode='22023'; end if;
  update public.loads set status=p_status, assigned_to = case when p_status='available' then null else assigned_to end where id=p_load;
  perform app_private.log_audit('load.status_change', 'load', p_load::text, null, format('load status %s -> %s', v_before, p_status),
    jsonb_build_object('from', v_before, 'to', p_status));
  return p_status;
end; $function$;

do $$
declare fn text;
begin
  for fn in select unnest(array[
    'public.cc_get_overview()','public.cc_list_carriers(text,text,int)','public.cc_get_carrier(uuid)',
    'public.cc_set_carrier_status(uuid,text,text)','public.cc_list_documents(text,int)',
    'public.cc_list_loads(text,text,int)','public.cc_get_load(uuid)','public.cc_create_load(text,text,text,numeric,int,text,date)',
    'public.cc_assign_load(uuid,uuid)','public.cc_set_load_status(uuid,text)'
  ]) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
