-- bl_disp_0459 — the dispatcher fills the carrier profile (locked vs open fields, provenance, guided call sheet).
-- Additive: a field catalog, a provenance table, AFTER triggers on the three source tables (exception-swallowing —
-- they can never break a carrier / CC write), a backfill, 2 dispatcher RPCs and 1 staff RPC. No existing function is
-- touched: dispatcher_workspace_feed stays as is; the workspace calls dispatcher_carrier_gaps() on the Trucks tab.
--
-- Rule (Yaseen, 26 Sep 2026): a value already on file (carrier / CC) is READ-ONLY for the dispatcher — he fills blanks
-- only, and may correct his OWN earlier entry. Every dispatcher value is stamped dispatcher / user / time; CC sees who
-- set each field. Availability is the exception and is untouched here (daily line, already tracked).

-- ---------------------------------------------------------------- 1. field catalog (the whitelist = the UI)
create table if not exists app_private.carrier_fill_fields (
  tbl text not null check (tbl in ('profile','prefs','truck')),
  field text not null,
  label text not null,
  why text,
  kind text not null default 'text' check (kind in ('text','number','money','bool','list','textarea')),
  options jsonb,                       -- suggestions for text / list
  sort int not null default 100,
  core boolean not null default true,  -- empty + core = an open task on the sheet
  primary key (tbl, field)
);
alter table app_private.carrier_fill_fields enable row level security;

insert into app_private.carrier_fill_fields (tbl, field, label, why, kind, options, sort, core) values
 -- carrier profile = public.profiles of the org owner (what the carrier typed at signup / Account)
 ('profile','mc',           'MC number',        'Brokers book under the carrier''s MC — nothing moves without it. Read it back digit by digit.', 'text', null, 10, true),
 ('profile','dot',          'USDOT number',     'Every rate confirmation and every broker packet asks for it.', 'text', null, 11, true),
 ('profile','contact_name', 'Owner / contact name', 'Who decides on a load. Brokers will ask "who am I talking to?"', 'text', null, 12, true),
 ('profile','phone',        'Owner phone',      'The number brokers and LoadBoot reach when the truck is loaded.', 'text', null, 13, true),
 ('profile','whatsapp',     'WhatsApp number',  'The carrier group runs on it; ask if it is the same as the phone.', 'text', null, 14, false),
 -- operating preferences = app_private.carrier_dispatch_prefs
 ('prefs','min_rpm',               'Rate floor ($/mi)',        'Below this LoadBoot must approve. Ask: "what is the lowest all-in rate per mile you will run?"', 'money', null, 20, true),
 ('prefs','target_rpm',            'Target rate ($/mi)',       'What you aim for on every call — the floor is the fallback, not the goal.', 'money', null, 21, true),
 ('prefs','preferred_equipment',   'Equipment',                'What the truck can legally and physically haul. Match to the trailer on file.', 'list', '["Dry Van","Reefer","Flatbed","Step Deck","Hotshot","Box Truck","Cargo Van","Power Only","Conestoga","RGN"]', 22, true),
 ('prefs','home_base',             'Home base (city, ST)',     'Deadhead and reload planning start here.', 'text', null, 23, true),
 ('prefs','operating_radius_miles','Operating radius (mi)',    'How far from home the owner is willing to go. Sets what you search.', 'number', null, 24, true),
 ('prefs','max_deadhead_miles',    'Max deadhead (mi)',        'Empty miles the owner accepts to a pickup.', 'number', null, 25, true),
 ('prefs','min_notice_hours',      'Notice needed (hours)',    'How much warning the driver needs before a pickup. Same-day loads need this answered.', 'number', null, 26, true),
 ('prefs','home_time',             'Home time',                'When must the truck be home (every weekend? every 10 days?). Every load has to land it there.', 'text', '["Every weekend","Every 2 weeks","Monthly","Flexible"]', 27, true),
 ('prefs','preferred_lanes',       'Preferred lanes',          'Where the owner likes to run (e.g. "TX → GA", "Midwest"). Start your search there.', 'list', null, 28, true),
 ('prefs','haul_types',            'Haul type',                'OTR / Regional / Local decides which boards and brokers you work.', 'list', '["OTR","Regional","Local"]', 29, true),
 ('prefs','avoid_states',          'Avoid states',             'States the owner will not enter (NYC, CA, winter mountains…). Never offer a load through them.', 'list', null, 30, false),
 ('prefs','weekend_ok',            'Runs weekends?',           'Saturday pickups and Sunday deliveries — yes or no.', 'bool', null, 31, true),
 ('prefs','team_drivers',          'Team drivers?',            'Team = expedited freight and long lanes are on the table.', 'bool', null, 32, false),
 ('prefs','hazmat',                'Hazmat endorsed?',         'Only offer placarded loads if yes.', 'bool', null, 33, false),
 ('prefs','max_weight_lbs',        'Max weight (lb)',          'Legal payload incl. the trailer — heavier loads are a no.', 'number', null, 34, false),
 ('prefs','load_size',             'Load size',                'Full truckload, partials, or both.', 'text', '["Full","Partial","Both"]', 35, false),
 ('prefs','facility_likes',        'Facility likes',           'Drop & hook, fast docks, specific shippers the driver likes.', 'list', null, 36, false),
 ('prefs','facility_dislikes',     'Facility dislikes',        'Places or practices to avoid (long waits, lumper-heavy, certain DCs).', 'list', null, 37, false),
 ('prefs','services',              'Extra services',           'Driver assist, tarping, lumper handling, TWIC, liftgate…', 'list', '["Driver assist","Tarping","Lumper","TWIC","Liftgate","Hazmat","Team"]', 38, false),
 ('prefs','round_trip_pref',       'Round trips',              'Does the owner want a reload home every time, or one-way is fine?', 'text', '["Round trips preferred","One-way fine","Depends"]', 39, false),
 ('prefs','min_trip_miles',        'Min trip (mi)',            'Shortest run worth the owner''s time.', 'number', null, 40, false),
 ('prefs','max_trip_miles',        'Max trip (mi)',            'Longest run the owner accepts.', 'number', null, 41, false),
 ('prefs','dat_seat',              'Load board seat',          'Does the carrier already pay for a DAT / Truckstop seat you may use?', 'text', null, 42, false),
 ('prefs','notes',                 'Owner notes',              'Anything else the owner said that changes how you book.', 'textarea', null, 43, false),
 -- unit / truck = app_private.fleet_trucks (one set per active truck)
 ('truck','trailer_type',   'Trailer type',          'Brokers filter on it first. Van / reefer / flatbed / step deck / hotshot…', 'text', '["Dry Van","Reefer","Flatbed","Step Deck","Hotshot","Box","Cargo Van","Power Only","Conestoga","RGN"]', 50, true),
 ('truck','trailer_len_ft', 'Trailer length (ft)',   '53 vs 48 vs 40 decides which loads fit. Ask and confirm.', 'number', null, 51, true),
 ('truck','payload_lbs',    'Payload (lb)',          'Max cargo weight. A load over it is illegal — never guess it.', 'number', null, 52, true),
 ('truck','domicile_city',  'Truck parked — city',   'Where the unit sits when empty (today''s location is Availability; this is home).', 'text', null, 53, true),
 ('truck','domicile_state', 'Truck parked — state',  'Two-letter state of the parking spot.', 'text', null, 54, true),
 ('truck','has_straps',     'Straps on board?',      'Flatbed / van securement. Brokers ask.', 'bool', null, 55, true),
 ('truck','has_load_bars',  'Load bars on board?',   'Van freight that must not shift needs them.', 'bool', null, 56, true),
 ('truck','has_chains',     'Chains on board?',      'Machinery and steel loads require chains.', 'bool', null, 57, false),
 ('truck','has_tarps',      'Tarps on board?',       'Tarped flatbed loads pay more — only if tarps are on the truck.', 'bool', null, 58, false),
 ('truck','has_pallet_jack','Pallet jack?',          'Driver-unload deliveries need it.', 'bool', null, 59, false),
 ('truck','liftgate',       'Liftgate?',             'Residential / no-dock deliveries need it.', 'bool', null, 60, false),
 ('truck','liftgate_cap_lbs','Liftgate capacity (lb)','Only if there is a liftgate.', 'number', null, 61, false),
 ('truck','dock_high',      'Dock high?',            'Box trucks / vans: can it back to a standard dock?', 'bool', null, 62, false),
 ('truck','has_etrack',     'E-track?',              'Securement for mixed freight.', 'bool', null, 63, false),
 ('truck','has_ramp',       'Ramp?',                 'Roll-on freight and residential deliveries.', 'bool', null, 64, false),
 ('truck','has_blankets',   'Blankets?',             'Furniture / high-value freight.', 'bool', null, 65, false),
 ('truck','pallet_positions','Pallet positions',     'How many standard pallets fit (26 in a 53'' van).', 'number', null, 66, false),
 ('truck','door_type',      'Door type',             'Roll-up vs swing changes dock compatibility.', 'text', '["Swing","Roll-up"]', 67, false),
 ('truck','temp_control',   'Temperature control',   'Reefer range or "none".', 'text', null, 68, false),
 ('truck','team_driven',    'Team driven?',          'This unit specifically — expedited loads.', 'bool', null, 69, false),
 ('truck','hazmat_placarded','Hazmat placarded?',    'Unit can carry placarded loads.', 'bool', null, 70, false),
 ('truck','max_radius_miles','Unit radius (mi)',     'If this unit runs shorter than the carrier default.', 'number', null, 71, false),
 ('truck','home_time',      'Unit home time',        'If this unit''s driver has his own home-time rule.', 'text', null, 72, false),
 ('truck','spec_note',      'Spec note',             'Anything odd about this unit (low deck, no reefer fuel, etc.).', 'textarea', null, 73, false)
on conflict (tbl, field) do update set label = excluded.label, why = excluded.why, kind = excluded.kind, options = excluded.options, sort = excluded.sort, core = excluded.core;

-- ---------------------------------------------------------------- 2. provenance
create table if not exists app_private.carrier_field_sources (
  id bigserial primary key,
  carrier_org_id uuid not null,
  tbl text not null,
  field text not null,
  truck_id uuid,
  set_by_role text not null check (set_by_role in ('carrier','staff','dispatcher','system')),
  set_by uuid,
  set_at timestamptz not null default now(),
  value_text text,
  note text
);
alter table app_private.carrier_field_sources enable row level security;
create unique index if not exists carrier_field_sources_key on app_private.carrier_field_sources
  (carrier_org_id, tbl, field, coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists carrier_field_sources_org on app_private.carrier_field_sources (carrier_org_id);

create or replace function app_private.cfs_is_empty(v jsonb) returns boolean language sql immutable as $$
  select v is null or v = 'null'::jsonb
      or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
      or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)
      or (jsonb_typeof(v) = 'object' and v = '{}'::jsonb);
$$;
create or replace function app_private.cfs_value_text(v jsonb) returns text language sql immutable as $$
  select case when v is null or v = 'null'::jsonb then null
              when jsonb_typeof(v) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(v) x)
              when jsonb_typeof(v) = 'object' then v::text
              else v #>> '{}' end;
$$;
-- who is writing: null uid = a job / service role
create or replace function app_private.cfs_role_of(p_uid uuid) returns text
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if p_uid is null then return 'system'; end if;
  if app_private.disp_is_staff_user(p_uid) then return 'staff'; end if;
  if exists (select 1 from app_private.dispatcher_profiles where user_id = p_uid) then return 'dispatcher'; end if;
  return 'carrier';
end $$;
create or replace function app_private.cfs_name_of(p_uid uuid) returns text
language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select full_name from app_private.dispatcher_profiles where user_id = p_uid),
                  (select nullif(contact_name,'') from public.profiles where id = p_uid),
                  (select nullif(company,'') from public.profiles where id = p_uid));
$$;

-- upsert / clear one source row
create or replace function app_private.cfs_stamp(p_org uuid, p_tbl text, p_field text, p_truck uuid, p_value jsonb, p_uid uuid, p_role text default null, p_note text default null)
returns void language plpgsql security definer set search_path = app_private, public as $$
begin
  if app_private.cfs_is_empty(p_value) then
    delete from app_private.carrier_field_sources where carrier_org_id = p_org and tbl = p_tbl and field = p_field
      and coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_truck, '00000000-0000-0000-0000-000000000000'::uuid);
    return;
  end if;
  insert into app_private.carrier_field_sources (carrier_org_id, tbl, field, truck_id, set_by_role, set_by, set_at, value_text, note)
  values (p_org, p_tbl, p_field, p_truck, coalesce(p_role, app_private.cfs_role_of(p_uid)), p_uid, now(), left(app_private.cfs_value_text(p_value), 400), p_note)
  on conflict (carrier_org_id, tbl, field, coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set set_by_role = excluded.set_by_role, set_by = excluded.set_by, set_at = excluded.set_at, value_text = excluded.value_text, note = excluded.note;
end $$;

-- generic tracker for the three tables; every write path (carrier portal, CC, dispatcher) gets stamped by who auth.uid() is.
create or replace function app_private.cfs_track() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare v_tbl text; v_org uuid; v_truck uuid; v_new jsonb; v_old jsonb; f record; v_uid uuid := auth.uid();
begin
  begin
    if tg_table_name = 'profiles' then
      v_tbl := 'profile';
      select id into v_org from public.organizations where owner_user_id = coalesce(new.id, old.id) and kind = 'carrier' order by created_at limit 1;
    elsif tg_table_name = 'carrier_dispatch_prefs' then
      v_tbl := 'prefs'; v_org := coalesce(new.carrier_id, old.carrier_id);
    elsif tg_table_name = 'fleet_trucks' then
      v_tbl := 'truck'; v_org := coalesce(new.carrier_id, old.carrier_id); v_truck := coalesce(new.id, old.id);
    else
      return coalesce(new, old);
    end if;
    if v_org is null then return coalesce(new, old); end if;
    if tg_op = 'DELETE' then
      delete from app_private.carrier_field_sources where carrier_org_id = v_org and tbl = v_tbl
        and (v_truck is null or truck_id = v_truck);
      return old;
    end if;
    v_new := to_jsonb(new); v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
    for f in select field from app_private.carrier_fill_fields where tbl = v_tbl loop
      if tg_op = 'INSERT' or (v_new -> f.field) is distinct from (v_old -> f.field) then
        if tg_op = 'INSERT' and app_private.cfs_is_empty(v_new -> f.field) then continue; end if;
        perform app_private.cfs_stamp(v_org, v_tbl, f.field, v_truck, v_new -> f.field, v_uid);
      end if;
    end loop;
  exception when others then null;   -- provenance must never break a carrier / CC write
  end;
  return coalesce(new, old);
end $$;

drop trigger if exists cfs_track_profiles on public.profiles;
create trigger cfs_track_profiles after insert or update or delete on public.profiles for each row execute function app_private.cfs_track();
drop trigger if exists cfs_track_prefs on app_private.carrier_dispatch_prefs;
create trigger cfs_track_prefs after insert or update or delete on app_private.carrier_dispatch_prefs for each row execute function app_private.cfs_track();
drop trigger if exists cfs_track_trucks on app_private.fleet_trucks;
create trigger cfs_track_trucks after insert or update or delete on app_private.fleet_trucks for each row execute function app_private.cfs_track();

-- backfill: everything already on file predates provenance → filed as 'carrier' with a note (Yaseen's rule)
insert into app_private.carrier_field_sources (carrier_org_id, tbl, field, truck_id, set_by_role, set_by, set_at, value_text, note)
select o.id, 'profile', f.field, null, 'carrier', null, coalesce(p.submitted_at, p.created_at, now()), left(app_private.cfs_value_text(to_jsonb(p) -> f.field), 400), 'predates provenance (bl_disp_0459 backfill)'
  from public.profiles p join public.organizations o on o.owner_user_id = p.id and o.kind = 'carrier'
  cross join app_private.carrier_fill_fields f
 where f.tbl = 'profile' and not app_private.cfs_is_empty(to_jsonb(p) -> f.field)
on conflict do nothing;
insert into app_private.carrier_field_sources (carrier_org_id, tbl, field, truck_id, set_by_role, set_by, set_at, value_text, note)
select pf.carrier_id, 'prefs', f.field, null, 'carrier', null, coalesce(pf.updated_at, now()), left(app_private.cfs_value_text(to_jsonb(pf) -> f.field), 400), 'predates provenance (bl_disp_0459 backfill)'
  from app_private.carrier_dispatch_prefs pf cross join app_private.carrier_fill_fields f
 where f.tbl = 'prefs' and not app_private.cfs_is_empty(to_jsonb(pf) -> f.field)
on conflict do nothing;
insert into app_private.carrier_field_sources (carrier_org_id, tbl, field, truck_id, set_by_role, set_by, set_at, value_text, note)
select t.carrier_id, 'truck', f.field, t.id, 'carrier', null, coalesce(t.created_at, now()), left(app_private.cfs_value_text(to_jsonb(t) -> f.field), 400), 'predates provenance (bl_disp_0459 backfill)'
  from app_private.fleet_trucks t cross join app_private.carrier_fill_fields f
 where f.tbl = 'truck' and not app_private.cfs_is_empty(to_jsonb(t) -> f.field)
on conflict do nothing;

-- ---------------------------------------------------------------- 3. the dispatcher's sheet
create or replace function public.dispatcher_carrier_gaps(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); a app_private.dispatcher_assignments; v_owner uuid; v_name text; v_prof jsonb; v_prefs jsonb;
        v_fields jsonb := '[]'::jsonb; f record; t record; v_val jsonb; s record; v_track text; v_phone text; v_driver jsonb; v_disp text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null or a.dispatcher_user_id <> v_uid or a.status <> 'active' or not app_private.disp_is_assigned(a.carrier_org_id) then
    return jsonb_build_object('error','not your active assignment');
  end if;
  select o.owner_user_id, o.name into v_owner, v_name from public.organizations o where o.id = a.carrier_org_id;
  select to_jsonb(p) into v_prof from public.profiles p where p.id = v_owner;
  select to_jsonb(pf) into v_prefs from app_private.carrier_dispatch_prefs pf where pf.carrier_id = a.carrier_org_id;
  v_phone := nullif(v_prof ->> 'phone', '');
  select jsonb_build_object('name', d.name, 'phone', d.phone) into v_driver from app_private.fleet_drivers d
   where d.carrier_id = a.carrier_org_id and coalesce(d.status,'active') <> 'inactive' and nullif(d.phone,'') is not null order by d.name limit 1;
  select full_name into v_disp from app_private.dispatcher_profiles where user_id = v_uid;

  for f in select * from app_private.carrier_fill_fields order by sort loop
    if f.tbl = 'truck' then
      for t in select id, unit_no, to_jsonb(x) j from app_private.fleet_trucks x where x.carrier_id = a.carrier_org_id and coalesce(x.status,'active') not in ('inactive','retired') order by unit_no loop
        v_val := t.j -> f.field;
        select set_by_role, set_by, set_at into s from app_private.carrier_field_sources where carrier_org_id = a.carrier_org_id and tbl = 'truck' and field = f.field and truck_id = t.id;
        v_fields := v_fields || jsonb_build_object('tbl', f.tbl, 'field', f.field, 'label', f.label, 'why', f.why, 'kind', f.kind, 'options', f.options, 'core', f.core,
          'truck_id', t.id, 'unit_no', t.unit_no, 'value', v_val, 'empty', app_private.cfs_is_empty(v_val),
          'locked', (not app_private.cfs_is_empty(v_val)) and not coalesce(s.set_by_role = 'dispatcher' and s.set_by = v_uid, false),
          'source', case when s.set_by_role is null then null else jsonb_build_object('role', s.set_by_role, 'by', s.set_by, 'by_name', app_private.cfs_name_of(s.set_by), 'at', s.set_at) end);
      end loop;
    else
      v_val := case when f.tbl = 'profile' then v_prof -> f.field else v_prefs -> f.field end;
      select set_by_role, set_by, set_at into s from app_private.carrier_field_sources where carrier_org_id = a.carrier_org_id and tbl = f.tbl and field = f.field and truck_id is null;
      v_fields := v_fields || jsonb_build_object('tbl', f.tbl, 'field', f.field, 'label', f.label, 'why', f.why, 'kind', f.kind, 'options', f.options, 'core', f.core,
        'truck_id', null, 'unit_no', null, 'value', v_val, 'empty', app_private.cfs_is_empty(v_val),
        'locked', (not app_private.cfs_is_empty(v_val)) and not coalesce(s.set_by_role = 'dispatcher' and s.set_by = v_uid, false),
        'source', case when s.set_by_role is null then null else jsonb_build_object('role', s.set_by_role, 'by', s.set_by, 'by_name', app_private.cfs_name_of(s.set_by), 'at', s.set_at) end);
    end if;
  end loop;

  -- Track B = nothing posted for a week (call first). Track A = an active carrier (post offers first, call on day 3).
  v_track := case when exists (select 1 from app_private.truck_availability av where av.carrier_id = a.carrier_org_id and av.updated_at > now() - interval '7 days') then 'A' else 'B' end;

  return jsonb_build_object(
    'assignment_id', a.id, 'carrier_org_id', a.carrier_org_id, 'carrier_name', v_name, 'dispatcher_name', v_disp,
    'phone', v_phone, 'contact_name', nullif(v_prof ->> 'contact_name',''), 'whatsapp', nullif(v_prof ->> 'whatsapp',''), 'driver', v_driver,
    'assigned_at', a.assigned_at, 'has_trucks', exists (select 1 from app_private.fleet_trucks x where x.carrier_id = a.carrier_org_id and coalesce(x.status,'active') not in ('inactive','retired')),
    'fields', v_fields,
    'total_core', (select count(*) from jsonb_array_elements(v_fields) e where (e->>'core')::boolean),
    'open_core',  (select count(*) from jsonb_array_elements(v_fields) e where (e->>'core')::boolean and (e->>'empty')::boolean),
    'open_all',   (select count(*) from jsonb_array_elements(v_fields) e where (e->>'empty')::boolean),
    'track', v_track,
    'script', jsonb_build_array(
      jsonb_build_object('step', 1, 'title', 'Call from your LoadBoot line', 'text',
        'Tap the owner''s number below — it dials through your LoadBoot phone, never a personal one. No answer after two tries 10 minutes apart? Call the driver on file, then post in the WhatsApp group that you tried.'),
      jsonb_build_object('step', 2, 'title', 'Introduce yourself', 'text',
        '"Hi ' || coalesce(nullif(v_prof ->> 'contact_name',''), 'there') || ', this is ' || coalesce(v_disp, 'your dispatcher') || ' with LoadBoot Dispatch. LoadBoot has appointed me your dedicated dispatcher effective today. Do you have five minutes so I can confirm what I have on file for ' || coalesce(v_name, 'your company') || ' and start finding you loads?" If not now — ask for a time, log the outcome, and post in the group.'),
      jsonb_build_object('step', 3, 'title', 'Confirm the basics', 'text',
        'Onboarding complete and account active? Truck and driver on file correct? Then walk the open tasks below one at a time. Type the answer into the field while you are on the call — do not take notes to enter later.'),
      jsonb_build_object('step', 4, 'title', 'Never overwrite', 'text',
        'Anything already on file was set by the carrier or LoadBoot and is locked. If the owner says a locked value is wrong, tell LoadBoot in the Messages thread — do not argue it on the call.'),
      jsonb_build_object('step', 5, 'title', 'Close the call', 'text',
        'Read back the rate floor, the home-time rule and the next availability. Say what happens next: "I will post today''s matching loads in the group within the hour." Then set Availability for each truck and log the call outcome in the dialer (Outcome / Tag).'),
      jsonb_build_object('step', 6, 'title', case when v_track = 'B' then 'Track B — this carrier: call first' else 'Track A — this carrier: offers first' end, 'text',
        case when v_track = 'B'
          then 'Nothing has been posted for this carrier in the last 7 days. Call first (this sheet), confirm truck + prefs, state what is missing, present today''s loads, post the same day. Aim for the first booking by day 4.'
          else 'This carrier is active. Day 1: post 2–3 genuine offers in the group with a one-line intro, daily for 3 days regardless of reply; make this call on day 3 (or sooner if the owner answers your posts).' end)
    ));
end $$;
revoke all on function public.dispatcher_carrier_gaps(uuid) from public, anon;
grant execute on function public.dispatcher_carrier_gaps(uuid) to authenticated;

-- fill ONE blank (or correct the dispatcher's own earlier entry); refuses anything set by the carrier / CC
create or replace function public.dispatcher_carrier_fill(p_assignment uuid, p_tbl text, p_field text, p_value jsonb, p_truck uuid default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); a app_private.dispatcher_assignments; f app_private.carrier_fill_fields; v_owner uuid;
        v_schema text; v_table text; v_where text; v_cur jsonb; s record; v_udt text; v_set text; v_val jsonb := p_value; v_unit text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null or a.dispatcher_user_id <> v_uid or a.status <> 'active' or not app_private.disp_is_assigned(a.carrier_org_id) then
    return jsonb_build_object('error','not your active assignment');
  end if;
  select * into f from app_private.carrier_fill_fields where tbl = p_tbl and field = p_field;
  if f.field is null then return jsonb_build_object('error','this field cannot be filled by a dispatcher'); end if;

  if p_tbl = 'profile' then
    select owner_user_id into v_owner from public.organizations where id = a.carrier_org_id;
    if v_owner is null then return jsonb_build_object('error','carrier has no owner profile'); end if;
    v_schema := 'public'; v_table := 'profiles'; v_where := format('id = %L', v_owner);
  elsif p_tbl = 'prefs' then
    insert into app_private.carrier_dispatch_prefs (carrier_id) values (a.carrier_org_id) on conflict (carrier_id) do nothing;
    v_schema := 'app_private'; v_table := 'carrier_dispatch_prefs'; v_where := format('carrier_id = %L', a.carrier_org_id);
  else
    if p_truck is null then return jsonb_build_object('error','truck required'); end if;
    select unit_no into v_unit from app_private.fleet_trucks where id = p_truck and carrier_id = a.carrier_org_id;
    if not found then return jsonb_build_object('error','not this carrier''s truck'); end if;
    v_schema := 'app_private'; v_table := 'fleet_trucks'; v_where := format('id = %L', p_truck);
  end if;

  execute format('select to_jsonb(t) -> %L from %I.%I t where %s', p_field, v_schema, v_table, v_where) into v_cur;
  if not app_private.cfs_is_empty(v_cur) then
    select set_by_role, set_by into s from app_private.carrier_field_sources where carrier_org_id = a.carrier_org_id and tbl = p_tbl and field = p_field
      and coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(case when p_tbl = 'truck' then p_truck end, '00000000-0000-0000-0000-000000000000'::uuid);
    if not coalesce(s.set_by_role = 'dispatcher' and s.set_by = v_uid, false) then
      return jsonb_build_object('error','locked', 'message', 'This value was set by the ' || case when s.set_by_role in ('staff','system') then 'LoadBoot team' else 'carrier' end || ' — you can only fill blanks. If it is wrong, tell LoadBoot in the thread.');
    end if;
  end if;

  -- normalise + type the value from the column's real type
  if f.kind = 'list' and v_val is not null and jsonb_typeof(v_val) = 'string' then
    v_val := to_jsonb(array(select btrim(x) from unnest(string_to_array(v_val #>> '{}', ',')) x where btrim(x) <> ''));
  end if;
  if f.kind = 'bool' and v_val is not null and jsonb_typeof(v_val) = 'string' then
    v_val := case when lower(btrim(v_val #>> '{}')) in ('true','yes','y','1') then 'true'::jsonb when lower(btrim(v_val #>> '{}')) in ('false','no','n','0') then 'false'::jsonb else null end;
  end if;
  if app_private.cfs_is_empty(v_val) then v_val := null; end if;
  select udt_name into v_udt from information_schema.columns where table_schema = v_schema and table_name = v_table and column_name = p_field;
  if v_udt is null then return jsonb_build_object('error','column missing'); end if;
  if v_val is null then v_set := 'null';
  elsif v_udt like '\_%' then v_set := format('(select coalesce(array_agg(x::%s), ''{}'')::%s[] from jsonb_array_elements_text($1) x)', substr(v_udt, 2), substr(v_udt, 2));
  elsif v_udt in ('jsonb','json') then v_set := '$1';
  else v_set := format('nullif($1 #>> ''{}'', '''')::%s', v_udt);
  end if;
  begin
    execute format('update %I.%I set %I = %s where %s', v_schema, v_table, p_field, v_set, v_where) using v_val;
  exception when others then
    return jsonb_build_object('error', 'bad value', 'message', 'That value does not fit "' || f.label || '": ' || sqlerrm);
  end;
  -- stamp (the trigger does it too; explicit so the sheet is right even if a trigger was ever disabled)
  perform app_private.cfs_stamp(a.carrier_org_id, p_tbl, p_field, case when p_tbl = 'truck' then p_truck end, v_val, v_uid, 'dispatcher', null);
  perform app_private.disp_audit('dispatcher.carrier_fill', 'carrier', a.carrier_org_id::text, a.carrier_org_id,
    f.label || case when v_unit is not null then ' (unit ' || v_unit || ')' else '' end || case when v_val is null then ' cleared' else ' = ' || left(app_private.cfs_value_text(v_val), 120) end || ' — by dispatcher',
    jsonb_build_object('assignment_id', a.id, 'tbl', p_tbl, 'field', p_field, 'truck_id', p_truck, 'value', v_val));
  return jsonb_build_object('ok', true, 'tbl', p_tbl, 'field', p_field, 'truck_id', p_truck, 'value', v_val,
    'source', jsonb_build_object('role', 'dispatcher', 'by', v_uid, 'by_name', app_private.cfs_name_of(v_uid), 'at', now()));
end $$;
revoke all on function public.dispatcher_carrier_fill(uuid, text, text, jsonb, uuid) from public, anon;
grant execute on function public.dispatcher_carrier_fill(uuid, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------- 4. CC: who set each field (Carrier 360 + dispatcher 360)
create or replace function public.cc_carrier_field_sources(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('tbl', s.tbl, 'field', s.field, 'label', coalesce(f.label, s.field), 'truck_id', s.truck_id,
                'unit_no', (select unit_no from app_private.fleet_trucks t where t.id = s.truck_id), 'role', s.set_by_role, 'by', s.set_by,
                'by_name', app_private.cfs_name_of(s.set_by), 'at', s.set_at, 'value', s.value_text, 'note', s.note) order by s.set_at desc)
              from app_private.carrier_field_sources s left join app_private.carrier_fill_fields f on f.tbl = s.tbl and f.field = s.field
             where s.carrier_org_id = p_org), '[]'::jsonb),
    'by_role', coalesce((select jsonb_object_agg(set_by_role, n) from (select set_by_role, count(*) n from app_private.carrier_field_sources where carrier_org_id = p_org group by 1) z), '{}'::jsonb),
    'open_core', (select count(*) from app_private.carrier_fill_fields f
                   where f.core and (
                     (f.tbl = 'profile' and app_private.cfs_is_empty((select to_jsonb(p) -> f.field from public.profiles p join public.organizations o on o.owner_user_id = p.id where o.id = p_org)))
                  or (f.tbl = 'prefs'   and app_private.cfs_is_empty((select to_jsonb(pf) -> f.field from app_private.carrier_dispatch_prefs pf where pf.carrier_id = p_org)))
                  or (f.tbl = 'truck'   and exists (select 1 from app_private.fleet_trucks t where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired') and app_private.cfs_is_empty(to_jsonb(t) -> f.field))))));
end $$;
revoke all on function public.cc_carrier_field_sources(uuid) from public, anon;
grant execute on function public.cc_carrier_field_sources(uuid) to authenticated;
