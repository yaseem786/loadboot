-- bl_fleet_0592 — a carrier can say who drives each truck (owner, 2 Nov 2026)
-- Before: the Fleet tab had no way to put a driver on a truck; a driver was only ever attached trip by trip. Two carriers
-- (Cascade Cargo, QuickFlash) asked for it, and the app's own "Assign a truck to start tracking" toast pointed at nothing.
-- Now:
--   * fleet_trucks.default_driver_id — one driver per truck, one truck per driver (setting it elsewhere moves the driver).
--   * cc_pocket_truck_drivers() / cc_pocket_set_truck_driver() for the portal. Drivers are refused by driver_gate (owner only).
--   * cc_carrier_fleet_360 hands CC Carrier 360 the driver's name on each truck.
--   * fleet_drivers.archived_at — a retired record (e.g. a duplicate) leaves the carrier's own lists; nothing is deleted.

alter table app_private.fleet_trucks
  add column if not exists default_driver_id uuid references app_private.fleet_drivers(id) on delete set null;
comment on column app_private.fleet_trucks.default_driver_id is
  'bl_fleet_0592: who normally drives this truck. Set by the carrier in Fleet. Trips still record their own driver_id.';
create unique index if not exists fleet_trucks_default_driver_uq
  on app_private.fleet_trucks (default_driver_id) where default_driver_id is not null;

alter table app_private.fleet_drivers add column if not exists archived_at timestamptz;
comment on column app_private.fleet_drivers.archived_at is
  'bl_fleet_0592: retired record, hidden from the carrier''s own lists. Set together with status=inactive; never a delete.';

create or replace function public.cc_pocket_truck_drivers()
returns jsonb language sql stable security definer set search_path to 'app_private', 'public' as $f$
  select coalesce(jsonb_object_agg(t.id::text, t.default_driver_id), '{}'::jsonb)
    from app_private.fleet_trucks t
   where t.carrier_id = app_private.my_carrier_org() and t.default_driver_id is not null
$f$;

create or replace function public.cc_pocket_set_truck_driver(p_truck uuid, p_driver uuid default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $f$
declare v_org uuid; v_unit text; v_name text;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode = '42501'; end if;
  select t.unit_no into v_unit from app_private.fleet_trucks t where t.id = p_truck and t.carrier_id = v_org;
  if v_unit is null then raise exception 'truck not found for your account' using errcode = '42501'; end if;
  if p_driver is not null then
    select d.name into v_name from app_private.fleet_drivers d
     where d.id = p_driver and d.carrier_id = v_org and d.archived_at is null and coalesce(d.status, 'active') = 'active';
    if v_name is null then raise exception 'That driver is not active on your account.' using errcode = '22023'; end if;
    update app_private.fleet_trucks set default_driver_id = null
     where default_driver_id = p_driver and id <> p_truck;     -- one truck per driver: this moves them
  end if;
  update app_private.fleet_trucks set default_driver_id = p_driver where id = p_truck;
  perform app_private.log_audit('carrier.truck.driver', 'fleet_truck', p_truck::text, v_org, 'driver set on truck',
    jsonb_build_object('driver', p_driver, 'unit', v_unit));
  return jsonb_build_object('ok', true, 'truck', p_truck, 'unit_no', v_unit, 'driver', p_driver, 'driver_name', v_name);
end $f$;

revoke all on function public.cc_pocket_truck_drivers() from public, anon;
revoke all on function public.cc_pocket_set_truck_driver(uuid, uuid) from public, anon;
grant execute on function public.cc_pocket_truck_drivers() to authenticated;
grant execute on function public.cc_pocket_set_truck_driver(uuid, uuid) to authenticated;

-- the carrier's two driver lists skip archived records; Carrier 360 gets the name (one anchor each, no retyping)
do $$
declare r record; d text; n int;
begin
  for r in select * from (values
    ('public.cc_pocket_drivers()', 'from app_private.fleet_drivers d where d.carrier_id=v_org',
       'from app_private.fleet_drivers d where d.carrier_id=v_org and d.archived_at is null'),
    ('public.cc_driver_access_list()', 'where d.carrier_id = v_org', 'where d.carrier_id = v_org and d.archived_at is null'),
    ('public.cc_carrier_fleet_360(uuid)', 'select to_jsonb(t)',
       'select to_jsonb(t) || jsonb_build_object(''default_driver_name'', (select dd.name from app_private.fleet_drivers dd where dd.id = t.default_driver_id))')
  ) v(fn, anchor, repl) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position('archived_at' in d) > 0 or position('default_driver_name' in d) > 0 then continue; end if;
    n := (length(d) - length(replace(d, r.anchor, ''))) / length(r.anchor);
    if n <> 1 then raise exception 'bl_fleet_0592: anchor found % times in %', n, r.fn; end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
end $$;
