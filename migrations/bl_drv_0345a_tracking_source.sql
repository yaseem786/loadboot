-- bl_drv_0345a — WHO IS DRIVING + WHOSE PHONE REPORTS THE TRUCK (14 Sep 2026)
-- Problem found in the owner's live test: the owner portal auto-starts "mandatory tracking" for every active trip on
-- whatever device it is open on, and cc_pocket_post_location stored every point as source='carrier'. An owner at home
-- with the portal open therefore reported HIS HOUSE as the truck position to CC and the broker, indistinguishable from
-- the driver's phone. Now:
--   • trips.driven_by_owner says who is at the wheel (owner sets it: "I'm driving this myself" vs a fleet driver)
--   • an owner/manager phone is REFUSED for a trip whose assigned driver has a linked app login, unless driven_by_owner
--   • every point records who posted it and from which app: source = driver_app | owner_app | eld:<provider>
--   • ELD wins: a phone point never overwrites a position the ELD reported in the last 10 minutes
--   • CC sees the source and who is driving; the broker sees only "ELD" vs "Driver app"
-- Additive: new column, new RPC, two anchored patches. anon-executable SECURITY DEFINER surface unchanged.
begin;

alter table app_private.trips add column if not exists driven_by_owner boolean not null default false;

create or replace function public.cc_pocket_post_location(p_trip uuid, p_lat double precision, p_lng double precision, p_label text default null)
returns text language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; t record; v_role text; v_src text; v_eld_recent boolean; v_drv_name text;
begin
  v_org := app_private.my_carrier_org(); perform app_private.assert_trip_mine(p_trip, v_org);
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select id, location_consent, driver_id, driven_by_owner, tracking_method, last_loc_at into t from app_private.trips where id=p_trip and carrier_id=v_org;
  if t.id is null then raise exception 'trip not found' using errcode='22023'; end if;
  if not coalesce(t.location_consent,false) then raise exception 'location sharing not consented' using errcode='42501'; end if;
  select member_role into v_role from public.organization_memberships where org_id=v_org and user_id=auth.uid() and status='active';
  if v_role = 'driver' then
    v_src := 'driver_app';                                   -- assert_trip_mine already proved this is THEIR trip
  else
    -- owner/manager phone: only when the owner is the one driving, or the assigned driver has no app login to report from
    if not coalesce(t.driven_by_owner,false) and t.driver_id is not null
       and exists (select 1 from app_private.fleet_drivers d where d.id=t.driver_id and d.user_id is not null and d.user_id <> auth.uid()) then
      select name into v_drv_name from app_private.fleet_drivers where id=t.driver_id;
      raise exception 'This load is assigned to % — their phone reports the truck. Driving it yourself? Choose "I''m driving" on the trip.', coalesce(v_drv_name,'your driver')
        using errcode='42501', hint='OWNER_NOT_DRIVING';
    end if;
    v_src := 'owner_app';
  end if;
  v_eld_recent := coalesce(t.tracking_method,'') like 'eld%' and t.last_loc_at > now() - interval '10 minutes';
  insert into app_private.trip_locations(trip_id,lat,lng,label,source,created_by) values (p_trip,p_lat,p_lng,p_label,v_src,auth.uid());
  if not v_eld_recent then
    update app_private.trips set last_lat=p_lat, last_lng=p_lng, last_loc_at=now(), tracking_method=v_src where id=p_trip;
    begin perform app_private.trip_geofence_tick(p_trip, p_lat, p_lng); exception when others then null; end;
    return 'recorded';
  end if;
  return 'recorded_eld_primary';
end $$;
revoke all on function public.cc_pocket_post_location(uuid,double precision,double precision,text) from public, anon;
grant execute on function public.cc_pocket_post_location(uuid,double precision,double precision,text) to authenticated;

-- ELD reports overwrite the method label (it used to coalesce, so a phone label stuck forever once set)
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='eld_ingest' limit 1;
  if v_def like '%tracking_method = coalesce(tracking_method, ''eld'')%' then
    execute replace(v_def, 'tracking_method = coalesce(tracking_method, ''eld'')', 'tracking_method = ''eld''');
  end if;
end $$;

-- Owner/manager declares who is at the wheel. Not in driver_rpc_policy → drivers are denied (fail-closed).
create or replace function public.cc_trip_set_driving(p_trip uuid, p_owner_driving boolean)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_role text; t record;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select member_role into v_role from public.organization_memberships where org_id=v_org and user_id=auth.uid() and status='active';
  if v_role not in ('owner','manager') then raise exception 'Only the carrier owner or a manager can set who is driving.' using errcode='42501'; end if;
  select id, driver_id, driven_by_owner into t from app_private.trips where id=p_trip and carrier_id=v_org;
  if t.id is null then raise exception 'trip not found' using errcode='22023'; end if;
  update app_private.trips set driven_by_owner = coalesce(p_owner_driving,false), updated_at = now() where id=p_trip;
  perform app_private.log_audit('trip.driving.set','trip',p_trip::text,v_org, case when p_owner_driving then 'owner is driving' else 'assigned driver is driving' end,
    jsonb_build_object('driver_id',t.driver_id,'was',t.driven_by_owner,'now',coalesce(p_owner_driving,false)));
  begin perform app_private.driver_event(v_org, null, 'trip.driving', jsonb_build_object('trip',p_trip,'owner_driving',coalesce(p_owner_driving,false))); exception when others then null; end;
  return jsonb_build_object('ok',true,'trip',p_trip,'driven_by_owner',coalesce(p_owner_driving,false));
end $$;
revoke all on function public.cc_trip_set_driving(uuid,boolean) from public, anon;
grant execute on function public.cc_trip_set_driving(uuid,boolean) to authenticated;

-- CC: source + who is driving. Broker: only the class of source (ELD vs app), never whose phone.
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_staff_track_load' and pronamespace='public'::regnamespace;
  if v_def not like '%driven_by_owner%' then
    execute replace(v_def, '''tracking_method'', t.tracking_method,',
      '''tracking_method'', t.tracking_method, ''driven_by_owner'', t.driven_by_owner, ''tracking_label'', case when coalesce(t.tracking_method,'''') like ''eld%'' then ''ELD'' when t.tracking_method = ''driver_app'' then ''Driver app'' when t.tracking_method = ''owner_app'' then ''Owner phone'' when t.last_loc_at is not null then ''App (legacy)'' else null end,');
  end if;
end $$;
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_partner_track_load' and pronamespace='public'::regnamespace;
  if v_def not like '%tracking_source%' then
    execute replace(v_def, '''last_lat'', t.last_lat, ''last_lng'', t.last_lng, ''last_loc_at'', t.last_loc_at,',
      '''last_lat'', t.last_lat, ''last_lng'', t.last_lng, ''last_loc_at'', t.last_loc_at, ''tracking_source'', case when coalesce(t.tracking_method,'''') like ''eld%'' then ''ELD'' when t.last_loc_at is not null then ''Driver app'' else null end,');
  end if;
end $$;

-- (b) a load BOOKED BY A DRIVER (driver app: request/book with loads.request_book) is that driver's trip from birth:
--     trips.created_by is the booking user on every creation path (cc_pocket_book_load, cc_decide_book_request,
--     lb_email_ping_approve), so one BEFORE INSERT trigger covers them all. Owner can still take it over ("Me").
create or replace function app_private.trg_trip_default_driver()
returns trigger language plpgsql security definer set search_path to 'app_private','public' as $$
declare d record;
begin
  if new.driver_id is null and new.created_by is not null then
    select fd.id, fd.name, fd.phone into d from app_private.fleet_drivers fd
      join public.organization_memberships om on om.user_id = fd.user_id and om.org_id = fd.carrier_id
     where fd.carrier_id = new.carrier_id and fd.user_id = new.created_by and om.member_role = 'driver' and om.status = 'active' limit 1;
    if d.id is not null then
      new.driver_id := d.id; new.driven_by_owner := false;
      if new.driver_name is null then new.driver_name := d.name; end if;
      if new.driver_phone is null then new.driver_phone := d.phone; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_default_driver on app_private.trips;
create trigger trg_trip_default_driver before insert on app_private.trips for each row execute function app_private.trg_trip_default_driver();

-- (c) when the owner has marked "I'm driving", the assigned driver's phone must not report either (no two-phone jitter)
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_pocket_post_location' and pronamespace='public'::regnamespace;
  if v_def not like '%OWNER_TOOK_OVER%' then
    v_def := replace(v_def, 'v_src := ''driver_app'';',
      'if coalesce(t.driven_by_owner,false) then raise exception ''The owner marked this load as driven by them — your phone is not tracking it. Ask the owner if that is wrong.'' using errcode=''42501'', hint=''OWNER_TOOK_OVER''; end if;' || E'\n' || '    v_src := ''driver_app'';');
    execute v_def;
  end if;
end $$;

-- verify: anon-executable SECURITY DEFINER count must be unchanged (33 prod / 32 staging)
select count(*) as anon_secdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
commit;
