-- WAVE 3 — LOADS / DISPATCH / TRIPS foundation.
-- Builds the TRIP execution layer ON TOP OF the existing public.loads (V1 already ships
-- loads + cc_create_load/cc_assign_load/cc_set_load_status). A trip is the execution
-- record of a booked load: driver, truck, stops, and a status timeline
-- (planned -> dispatched -> in_transit -> delivered -> invoiced). Status changes sync the
-- parent load status and emit domain events into the Automation Core, which creates a
-- driver-notify task, an in-transit check-call task, and an invoice-ready task.
-- All writes go through RBAC-gated, audited SECURITY DEFINER RPCs.
-- Feature-flagged (dispatch_enabled, default OFF). Production-safe additive: public.loads
-- is NOT altered.
-- Applied to STAGING as ledger name w3_dispatch_0001_foundation.
-- DOWN: drop public cc_dispatch_overview / cc_list_trips / cc_get_trip / cc_create_trip /
--   cc_advance_trip / cc_add_trip_note fns, app_private.trip_events, app_private.trip_stops,
--   app_private.trips, the dispatch.* permission rows. dispatch_enabled flag + the 3
--   automation rules may stay.

-- ============================================================ permissions
insert into app_private.permissions(key,description) values
  ('dispatch.view',null),('dispatch.manage',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',            array['dispatch.view','dispatch.manage']::text[]),
    ('operations_admin', array['dispatch.view','dispatch.manage']::text[]),
    ('dispatcher',       array['dispatch.view','dispatch.manage']::text[]),
    ('finance',          array['dispatch.view']::text[]),
    ('auditor',          array['dispatch.view']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms)
    on conflict do nothing;
  end loop;
end $$;

-- ============================================================ tables
create table if not exists app_private.trips (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  carrier_id uuid references public.organizations(id) on delete set null,
  driver_name text, driver_phone text, truck_no text, trailer_no text,
  status text not null default 'planned'
    check (status in ('planned','dispatched','in_transit','delivered','invoiced','canceled')),
  rate numeric, miles int,
  scheduled_pickup timestamptz, scheduled_delivery timestamptz,
  dispatched_at timestamptz, delivered_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- at most one active (non-canceled) trip per load
create unique index if not exists trips_active_load_idx on app_private.trips(load_id) where status <> 'canceled';
create index if not exists trips_status_idx on app_private.trips(status);

create table if not exists app_private.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references app_private.trips(id) on delete cascade,
  kind text not null check (kind in ('pickup','delivery','stop')),
  sort int not null default 0,
  location text, scheduled_at timestamptz, arrived_at timestamptz, departed_at timestamptz, notes text
);
create index if not exists trip_stops_trip_idx on app_private.trip_stops(trip_id, sort);

create table if not exists app_private.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references app_private.trips(id) on delete cascade,
  kind text not null default 'status' check (kind in ('status','note','location')),
  from_status text, to_status text, note text, location text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists trip_events_trip_idx on app_private.trip_events(trip_id, created_at desc);

alter table app_private.trips enable row level security;
alter table app_private.trip_stops enable row level security;
alter table app_private.trip_events enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

-- ============================================================ internal helper: load<-trip status sync
create or replace function app_private.sync_load_status(p_load uuid, p_trip_status text)
returns void language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_load_status text;
begin
  v_load_status := case p_trip_status
    when 'planned' then 'booked' when 'dispatched' then 'booked'
    when 'in_transit' then 'in_transit'
    when 'delivered' then 'delivered' when 'invoiced' then 'delivered'
    when 'canceled' then 'available' else null end;
  if v_load_status is not null then
    update public.loads set status=v_load_status where id=p_load;
  end if;
end; $function$;

-- ============================================================ RPCs (RBAC-gated, audited)
create or replace function public.cc_dispatch_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'active_trips',     (select count(*) from app_private.trips where status in ('planned','dispatched','in_transit')),
    'in_transit',       (select count(*) from app_private.trips where status='in_transit'),
    'delivered',        (select count(*) from app_private.trips where status in ('delivered','invoiced')),
    'awaiting_dispatch',(select count(*) from public.loads l where l.status='booked'
                           and not exists (select 1 from app_private.trips t where t.load_id=l.id and t.status<>'canceled')),
    'needs_invoice',    (select count(*) from app_private.trips where status='delivered')
  );
end; $function$;

create or replace function public.cc_list_trips(p_status text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, load_id uuid, origin text, destination text, carrier text, driver_name text,
               status text, rate numeric, miles int, scheduled_pickup timestamptz, scheduled_delivery timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select t.id, t.load_id, l.origin, l.destination, org.name, t.driver_name, t.status, t.rate, t.miles,
           t.scheduled_pickup, t.scheduled_delivery, t.updated_at
    from app_private.trips t
    join public.loads l on l.id=t.load_id
    left join public.organizations org on org.id=t.carrier_id
    where (p_status is null or t.status=p_status)
      and (p_search is null or l.origin ilike '%'||p_search||'%' or l.destination ilike '%'||p_search||'%'
           or org.name ilike '%'||p_search||'%' or t.driver_name ilike '%'||p_search||'%')
    order by t.updated_at desc
    limit v_limit;
end; $function$;

create or replace function public.cc_get_trip(p_trip uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb; v_load uuid;
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select load_id into v_load from app_private.trips where id=p_trip;
  if v_load is null then raise exception 'trip not found' using errcode='22023'; end if;
  select jsonb_build_object(
    'id',t.id,'load_id',t.load_id,'status',t.status,'carrier',org.name,'carrier_id',t.carrier_id,
    'driver_name',t.driver_name,'driver_phone',t.driver_phone,'truck_no',t.truck_no,'trailer_no',t.trailer_no,
    'rate',t.rate,'miles',t.miles,'scheduled_pickup',t.scheduled_pickup,'scheduled_delivery',t.scheduled_delivery,
    'dispatched_at',t.dispatched_at,'delivered_at',t.delivered_at,
    'origin',l.origin,'destination',l.destination,'equipment',l.equipment,'commodity',l.commodity,
    'stops',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'location',s.location,'scheduled_at',s.scheduled_at,
              'arrived_at',s.arrived_at,'departed_at',s.departed_at,'notes',s.notes) order by s.sort)
              from app_private.trip_stops s where s.trip_id=t.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'from',e.from_status,'to',e.to_status,
              'note',e.note,'location',e.location,'created_at',e.created_at) order by e.created_at desc)
              from app_private.trip_events e where e.trip_id=t.id),'[]'::jsonb)
  ) into j
  from app_private.trips t
  join public.loads l on l.id=t.load_id
  left join public.organizations org on org.id=t.carrier_id
  where t.id=p_trip;
  return j;
end; $function$;

-- create a trip from a booked/available load; seeds pickup+delivery stops; emits trip.created
create or replace function public.cc_create_trip(p_load uuid, p_carrier uuid default null, p_driver_name text default null,
   p_driver_phone text default null, p_truck text default null,
   p_scheduled_pickup timestamptz default null, p_scheduled_delivery timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_trip uuid; v_load record;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  select id,origin,destination,rate,miles,status into v_load from public.loads where id=p_load;
  if v_load.id is null then raise exception 'load not found' using errcode='22023'; end if;
  if exists (select 1 from app_private.trips where load_id=p_load and status<>'canceled') then
    raise exception 'load already has an active trip' using errcode='22023'; end if;
  insert into app_private.trips(load_id,carrier_id,driver_name,driver_phone,truck_no,rate,miles,
                                scheduled_pickup,scheduled_delivery,created_by)
    values (p_load,p_carrier,p_driver_name,p_driver_phone,p_truck,v_load.rate,v_load.miles,
            p_scheduled_pickup,p_scheduled_delivery,auth.uid())
    returning id into v_trip;
  insert into app_private.trip_stops(trip_id,kind,sort,location,scheduled_at) values
    (v_trip,'pickup',1,v_load.origin,p_scheduled_pickup),
    (v_trip,'delivery',2,v_load.destination,p_scheduled_delivery);
  insert into app_private.trip_events(trip_id,kind,to_status,note,created_by)
    values (v_trip,'status','planned','trip created',auth.uid());
  perform app_private.sync_load_status(p_load,'planned');
  perform app_private.log_audit('dispatch.trip.create','trip',v_trip::text,null,
     format('trip created for %s -> %s',v_load.origin,v_load.destination),
     jsonb_build_object('load',p_load,'carrier',p_carrier));
  perform app_private.emit_event('trip.created','trip',v_trip::text,
     jsonb_build_object('load',p_load,'origin',v_load.origin,'destination',v_load.destination), 'trip_create:'||v_trip::text);
  return v_trip;
end; $function$;

-- advance a trip's status (validated transitions); records timeline event; syncs load; emits trip.<status>
create or replace function public.cc_advance_trip(p_trip uuid, p_status text, p_note text default null, p_location text default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_cur text; v_load uuid; v_allowed text[];
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  select status,load_id into v_cur,v_load from app_private.trips where id=p_trip;
  if v_cur is null then raise exception 'trip not found' using errcode='22023'; end if;
  v_allowed := case v_cur
    when 'planned'    then array['dispatched','canceled']
    when 'dispatched' then array['in_transit','canceled']
    when 'in_transit' then array['delivered','canceled']
    when 'delivered'  then array['invoiced']
    else array[]::text[] end;
  if not (p_status = any(v_allowed)) then
    raise exception 'invalid transition % -> %', v_cur, p_status using errcode='22023'; end if;
  update app_private.trips
    set status=p_status, updated_at=now(),
        dispatched_at = case when p_status='dispatched' then now() else dispatched_at end,
        delivered_at  = case when p_status='delivered' then now() else delivered_at end
    where id=p_trip;
  insert into app_private.trip_events(trip_id,kind,from_status,to_status,note,location,created_by)
    values (p_trip,'status',v_cur,p_status,p_note,p_location,auth.uid());
  perform app_private.sync_load_status(v_load,p_status);
  perform app_private.log_audit('dispatch.trip.advance','trip',p_trip::text,null,
     format('%s -> %s',v_cur,p_status), jsonb_build_object('from',v_cur,'to',p_status,'note',p_note));
  perform app_private.emit_event('trip.'||p_status,'trip',p_trip::text,
     jsonb_build_object('load',v_load,'note',p_note));
  return p_status;
end; $function$;

create or replace function public.cc_add_trip_note(p_trip uuid, p_note text, p_location text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from app_private.trips where id=p_trip) then raise exception 'trip not found' using errcode='22023'; end if;
  if p_note is null or btrim(p_note)='' then raise exception 'note required' using errcode='22023'; end if;
  insert into app_private.trip_events(trip_id,kind,note,location,created_by)
    values (p_trip,'note',p_note,p_location,auth.uid()) returning id into v_id;
  perform app_private.log_audit('dispatch.trip.note','trip',p_trip::text,null,'note added', jsonb_build_object('note',p_note));
  return v_id;
end; $function$;

-- ============================================================ grants (deny-by-default; execute to authenticated only)
revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_dispatch_overview()',
    'public.cc_list_trips(text,text,int)',
    'public.cc_get_trip(uuid)',
    'public.cc_create_trip(uuid,uuid,text,text,text,timestamptz,timestamptz)',
    'public.cc_advance_trip(uuid,text,text,text)',
    'public.cc_add_trip_note(uuid,text,text)'
  ]) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ============================================================ feature flag + automation rules
insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('dispatch_enabled',false,'Enable the Loads / Dispatch / Trips module','all','staff')
on conflict (key) do nothing;

insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('trip_dispatched_notify','Trip dispatched -> notify driver','trip.dispatched','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','driver_notify','title','Notify driver of dispatch & send rate con','priority','high','assignee_role','dispatcher','sla_minutes',120), false),
  ('trip_intransit_checkcall','Trip in transit -> check-call','trip.in_transit','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','check_call','title','Check-call driver for status & ETA','priority','normal','assignee_role','dispatcher','sla_minutes',720), false),
  ('trip_delivered_invoice','Trip delivered -> invoice ready','trip.delivered','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','invoice_ready','title','Collect POD & generate carrier invoice','priority','high','assignee_role','finance','sla_minutes',1440), false)
on conflict (key) do nothing;
