-- ENTERPRISE COMPLETION WAVE 2 — FLEET & DISPATCH EXECUTION.
-- Drivers, trucks, trailers (per carrier); trip driver/truck/trailer assignment; accessorial
-- charges (detention/lumper/TONU/layover); and trip exceptions (breakdown/weather/missed
-- appointment). RBAC-gated, audited; additive. Flag: fleet_enabled (default OFF).
-- Applied to STAGING as ledger name ec2_fleet_0001.

insert into app_private.permissions(key,description) values
  ('fleet.view',null),('fleet.manage',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',array['fleet.view','fleet.manage']::text[]),
    ('operations_admin',array['fleet.view','fleet.manage']::text[]),
    ('dispatcher',array['fleet.view','fleet.manage']::text[]),
    ('compliance_reviewer',array['fleet.view']::text[]),
    ('auditor',array['fleet.view']::text[])
  ) as t(rk,perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop;
end $$;

create table if not exists app_private.fleet_drivers (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, phone text, email text,
  license_no text, license_state text, license_exp date, medical_exp date,
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  created_by uuid, created_at timestamptz not null default now());
create index if not exists fleet_drivers_carrier_idx on app_private.fleet_drivers(carrier_id);

create table if not exists app_private.fleet_trucks (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.organizations(id) on delete cascade,
  unit_no text not null, plate text, vin text, equipment text,
  status text not null default 'active' check (status in ('active','inactive','maintenance')),
  created_at timestamptz not null default now());
create table if not exists app_private.fleet_trailers (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.organizations(id) on delete cascade,
  unit_no text not null, type text, status text not null default 'active' check (status in ('active','inactive','maintenance')),
  created_at timestamptz not null default now());

alter table app_private.trips add column if not exists driver_id uuid references app_private.fleet_drivers(id) on delete set null;
alter table app_private.trips add column if not exists truck_id uuid references app_private.fleet_trucks(id) on delete set null;
alter table app_private.trips add column if not exists trailer_id uuid references app_private.fleet_trailers(id) on delete set null;

create table if not exists app_private.trip_accessorials (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references app_private.trips(id) on delete cascade,
  kind text not null check (kind in ('detention','lumper','layover','tonu','reconsignment','other')),
  amount numeric not null default 0, billable boolean not null default true, note text,
  created_by uuid, created_at timestamptz not null default now());
create index if not exists trip_accessorials_trip_idx on app_private.trip_accessorials(trip_id);

create table if not exists app_private.trip_exceptions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references app_private.trips(id) on delete cascade,
  kind text not null check (kind in ('breakdown','weather','missed_appointment','accident','delay','other')),
  description text, status text not null default 'open' check (status in ('open','resolved')),
  created_by uuid, created_at timestamptz not null default now(), resolved_at timestamptz);
create index if not exists trip_exceptions_trip_idx on app_private.trip_exceptions(trip_id, created_at desc);

alter table app_private.fleet_drivers enable row level security;
alter table app_private.fleet_trucks enable row level security;
alter table app_private.fleet_trailers enable row level security;
alter table app_private.trip_accessorials enable row level security;
alter table app_private.trip_exceptions enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function public.cc_fleet_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('fleet.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'drivers',(select count(*) from app_private.fleet_drivers where status='active'),
    'trucks',(select count(*) from app_private.fleet_trucks where status='active'),
    'trailers',(select count(*) from app_private.fleet_trailers where status='active'),
    'license_expiring',(select count(*) from app_private.fleet_drivers where status='active' and license_exp is not null and license_exp between current_date and current_date+30),
    'open_exceptions',(select count(*) from app_private.trip_exceptions where status='open'));
end; $function$;

create or replace function public.cc_list_drivers(p_carrier uuid default null, p_search text default null, p_limit int default 200)
returns table (id uuid, carrier text, name text, phone text, license_no text, license_exp date, medical_exp date, status text)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public.has_global_permission('fleet.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select d.id,org.name,d.name,d.phone,d.license_no,d.license_exp,d.medical_exp,d.status
    from app_private.fleet_drivers d join public.organizations org on org.id=d.carrier_id
    where (p_carrier is null or d.carrier_id=p_carrier) and (p_search is null or d.name ilike '%'||p_search||'%')
    order by d.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_upsert_driver(p_id uuid, p_carrier uuid, p_name text, p_phone text default null,
   p_license_no text default null, p_license_exp date default null, p_medical_exp date default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('fleet.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'driver name required' using errcode='22023'; end if;
  if p_id is null then
    insert into app_private.fleet_drivers(carrier_id,name,phone,license_no,license_exp,medical_exp,created_by)
      values (p_carrier,p_name,p_phone,p_license_no,p_license_exp,p_medical_exp,auth.uid()) returning id into v_id;
  else
    update app_private.fleet_drivers set name=p_name,phone=p_phone,license_no=p_license_no,license_exp=p_license_exp,medical_exp=p_medical_exp
      where id=p_id returning id into v_id;
    if v_id is null then raise exception 'driver not found' using errcode='22023'; end if;
  end if;
  perform app_private.log_audit('fleet.driver.upsert','fleet_driver',v_id::text,null,format('driver %s',p_name), '{}'::jsonb);
  return v_id;
end; $function$;

create or replace function public.cc_upsert_truck(p_id uuid, p_carrier uuid, p_unit text, p_plate text default null, p_vin text default null, p_equipment text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('fleet.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_unit is null or btrim(p_unit)='' then raise exception 'unit # required' using errcode='22023'; end if;
  if p_id is null then
    insert into app_private.fleet_trucks(carrier_id,unit_no,plate,vin,equipment) values (p_carrier,p_unit,p_plate,p_vin,p_equipment) returning id into v_id;
  else
    update app_private.fleet_trucks set unit_no=p_unit,plate=p_plate,vin=p_vin,equipment=p_equipment where id=p_id returning id into v_id;
    if v_id is null then raise exception 'truck not found' using errcode='22023'; end if;
  end if;
  perform app_private.log_audit('fleet.truck.upsert','fleet_truck',v_id::text,null,format('truck %s',p_unit), '{}'::jsonb);
  return v_id;
end; $function$;

create or replace function public.cc_assign_trip_resources(p_trip uuid, p_driver uuid default null, p_truck uuid default null, p_trailer uuid default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('fleet.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.trips set driver_id=coalesce(p_driver,driver_id), truck_id=coalesce(p_truck,truck_id), trailer_id=coalesce(p_trailer,trailer_id), updated_at=now()
    where id=p_trip;
  if not found then raise exception 'trip not found' using errcode='22023'; end if;
  perform app_private.log_audit('dispatch.trip.assign_resources','trip',p_trip::text,null,'driver/truck/trailer assigned', jsonb_build_object('driver',p_driver,'truck',p_truck));
  return 'assigned';
end; $function$;

create or replace function public.cc_add_accessorial(p_trip uuid, p_kind text, p_amount numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_kind not in ('detention','lumper','layover','tonu','reconsignment','other') then raise exception 'invalid accessorial kind' using errcode='22023'; end if;
  insert into app_private.trip_accessorials(trip_id,kind,amount,note,created_by) values (p_trip,p_kind,coalesce(p_amount,0),p_note,auth.uid()) returning id into v_id;
  perform app_private.log_audit('dispatch.accessorial.add','trip',p_trip::text,null,format('%s %s',p_kind,p_amount), jsonb_build_object('kind',p_kind,'amount',p_amount));
  return v_id;
end; $function$;

create or replace function public.cc_log_exception(p_trip uuid, p_kind text, p_description text)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_kind not in ('breakdown','weather','missed_appointment','accident','delay','other') then raise exception 'invalid exception kind' using errcode='22023'; end if;
  insert into app_private.trip_exceptions(trip_id,kind,description,created_by) values (p_trip,p_kind,p_description,auth.uid()) returning id into v_id;
  perform app_private.log_audit('dispatch.exception.log','trip',p_trip::text,null,format('exception: %s',p_kind), jsonb_build_object('kind',p_kind));
  perform app_private.emit_event('trip.exception','trip',p_trip::text, jsonb_build_object('kind',p_kind,'description',p_description));
  return v_id;
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_fleet_overview()','public.cc_list_drivers(uuid,text,int)','public.cc_upsert_driver(uuid,uuid,text,text,text,date,date)',
    'public.cc_upsert_truck(uuid,uuid,text,text,text,text)','public.cc_assign_trip_resources(uuid,uuid,uuid,uuid)',
    'public.cc_add_accessorial(uuid,text,numeric,text)','public.cc_log_exception(uuid,text,text)']) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('fleet_enabled',false,'Enable Fleet & execution depth','all','staff') on conflict (key) do nothing;
-- exception -> ops follow-up task
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('trip_exception_followup','Trip exception -> dispatcher follow-up','trip.exception','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','trip_exception','title','Resolve trip exception','priority','high','assignee_role','dispatcher','sla_minutes',240), false)
on conflict (key) do nothing;
