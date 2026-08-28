-- bl_disp_0288 — Dispatcher Workspace (P0)
-- Gives a hired dispatcher (status trial/verified/active, with an active assignment) a real
-- working surface: truck cards + availability, booking log with rate-confirmation upload,
-- per-load commission ledger, broker contact book, booking timeline (check calls), and a
-- 3-way thread (dispatcher / carrier / staff) per assignment.
-- Everything is assignment-scoped through app_private.disp_is_assigned(org).
-- Additive: no existing table or function is dropped. cc_dispatcher_assign is widened to
-- accept dispatchers in 'trial' (the trial IS the assignment).
-- Apply to STAGING first, then PROD.

-- ---------------------------------------------------------------- helpers
create or replace function app_private.disp_is_assigned(p_org uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select exists (
    select 1 from app_private.dispatcher_assignments a
     where a.dispatcher_user_id = auth.uid() and a.carrier_org_id = p_org and a.status = 'active');
$$;

create or replace function app_private.disp_is_carrier_member(p_org uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select exists (select 1 from public.organizations o where o.id = p_org and o.owner_user_id = auth.uid())
      or exists (select 1 from public.organization_memberships m where m.org_id = p_org and m.user_id = auth.uid() and coalesce(m.status,'active') = 'active');
$$;

-- who am I relative to this carrier org: 'staff' | 'dispatcher' | 'carrier' | null
create or replace function app_private.disp_role_for(p_org uuid)
returns text language sql stable security definer set search_path = app_private, public as $$
  select case
    when app_private.disp_is_staff() then 'staff'
    when app_private.disp_is_assigned(p_org) then 'dispatcher'
    when app_private.disp_is_carrier_member(p_org) then 'carrier'
    else null end;
$$;

-- ---------------------------------------------------------------- profile: commission + trial window
alter table app_private.dispatcher_profiles
  add column if not exists commission_pct numeric(5,2) not null default 0,
  add column if not exists trial_start date,
  add column if not exists trial_end date;

-- ---------------------------------------------------------------- tables
create table if not exists app_private.truck_availability (
  truck_id            uuid primary key references app_private.fleet_trucks(id) on delete cascade,
  carrier_id          uuid not null,
  status              text not null default 'empty' check (status in ('empty','loaded','off','maintenance')),
  empty_at            timestamptz,
  empty_location      text,
  empty_zip           text,
  must_be_home_by     timestamptz,
  home_location       text,
  overnight_weekdays  boolean not null default true,
  overnight_weekends  boolean not null default false,
  hos_drive_left_h    numeric(4,1),
  hos_note            text,
  driver_name         text,
  driver_phone        text,
  note                text,
  updated_by          uuid,
  updated_at          timestamptz not null default now()
);
create index if not exists truck_availability_carrier_idx on app_private.truck_availability(carrier_id);

create table if not exists app_private.dispatcher_bookings (
  id                  uuid primary key default gen_random_uuid(),
  dispatcher_user_id  uuid not null,
  carrier_org_id      uuid not null,
  truck_id            uuid references app_private.fleet_trucks(id) on delete set null,
  load_id             uuid,
  trip_id             uuid,
  broker              text not null,
  broker_mc           text,
  broker_rep          text,
  broker_phone        text,
  broker_email        text,
  origin              text not null,
  destination         text not null,
  pickup_at           timestamptz,
  delivery_at         timestamptz,
  miles               integer,
  deadhead            integer,
  gross               numeric(12,2) not null check (gross >= 0),
  commodity           text,
  weight_lbs          integer,
  equipment           text,
  rc_number           text,
  rc_doc_path         text,
  rc_doc_name         text,
  rc_received_at      timestamptz,
  status              text not null default 'pending_rc' check (status in
                        ('pending_rc','rc_received','approved','dispatched','picked_up','delivered','invoiced','paid','cancelled','rejected')),
  below_min           boolean not null default false,
  approved_by         uuid,
  approved_at         timestamptz,
  decision_note       text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists dispatcher_bookings_user_idx on app_private.dispatcher_bookings(dispatcher_user_id, created_at desc);
create index if not exists dispatcher_bookings_org_idx  on app_private.dispatcher_bookings(carrier_org_id, status);

create table if not exists app_private.dispatcher_booking_events (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references app_private.dispatcher_bookings(id) on delete cascade,
  kind        text not null check (kind in ('created','rc','status','check_call','note','exception','decision','eta')),
  note        text,
  location    text,
  eta_at      timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists dispatcher_booking_events_idx on app_private.dispatcher_booking_events(booking_id, created_at);

create table if not exists app_private.dispatcher_commission (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null unique references app_private.dispatcher_bookings(id) on delete cascade,
  dispatcher_user_id  uuid not null,
  carrier_org_id      uuid not null,
  gross               numeric(12,2) not null,
  pct                 numeric(5,2) not null,
  amount              numeric(12,2) not null,
  status              text not null default 'draft' check (status in ('draft','approved','paid','void')),
  approved_by         uuid,
  approved_at         timestamptz,
  paid_at             timestamptz,
  note                text,
  created_at          timestamptz not null default now()
);
create index if not exists dispatcher_commission_user_idx on app_private.dispatcher_commission(dispatcher_user_id, created_at desc);

create table if not exists app_private.broker_contacts (
  id                  uuid primary key default gen_random_uuid(),
  dispatcher_user_id  uuid not null,
  broker              text not null,
  mc                  text,
  rep                 text,
  phone               text,
  email               text,
  lanes               text,
  equipment           text,
  new_authority_ok    boolean,
  rating              smallint check (rating between 1 and 5),
  last_contact_at     timestamptz,
  last_outcome        text,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists broker_contacts_user_idx on app_private.broker_contacts(dispatcher_user_id, broker);

create table if not exists app_private.dispatcher_messages (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references app_private.dispatcher_assignments(id) on delete cascade,
  carrier_org_id uuid not null,
  sender_user    uuid,
  sender_role    text not null check (sender_role in ('dispatcher','carrier','staff','system')),
  body           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists dispatcher_messages_idx on app_private.dispatcher_messages(assignment_id, created_at);

-- lock down (SECURITY DEFINER RPCs are the only path)
alter table app_private.truck_availability        enable row level security;
alter table app_private.dispatcher_bookings        enable row level security;
alter table app_private.dispatcher_booking_events  enable row level security;
alter table app_private.dispatcher_commission      enable row level security;
alter table app_private.broker_contacts            enable row level security;
alter table app_private.dispatcher_messages        enable row level security;

-- ---------------------------------------------------------------- commission trigger
-- When a booking reaches 'delivered' (or later), a draft commission row is created once
-- at the dispatcher's current commission_pct. Gross changes before approval re-price it.
create or replace function app_private.disp_booking_commission_trg()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare v_pct numeric;
begin
  if new.status in ('delivered','invoiced','paid') then
    select coalesce(commission_pct,0) into v_pct from app_private.dispatcher_profiles where user_id = new.dispatcher_user_id;
    insert into app_private.dispatcher_commission (booking_id, dispatcher_user_id, carrier_org_id, gross, pct, amount)
      values (new.id, new.dispatcher_user_id, new.carrier_org_id, new.gross, v_pct, round(new.gross * v_pct / 100, 2))
      on conflict (booking_id) do update
        set gross = excluded.gross, pct = excluded.pct, amount = excluded.amount
      where app_private.dispatcher_commission.status = 'draft';
  elsif new.status in ('cancelled','rejected') then
    update app_private.dispatcher_commission set status = 'void' where booking_id = new.id and status = 'draft';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists disp_booking_commission on app_private.dispatcher_bookings;
create trigger disp_booking_commission before insert or update of status, gross on app_private.dispatcher_bookings
  for each row execute function app_private.disp_booking_commission_trg();

-- ---------------------------------------------------------------- storage: assigned dispatcher may READ the carrier's documents
-- (documents live under {carrier owner uid}/...). Needed for the carrier packet.
drop policy if exists doc_read_assigned_dispatcher on storage.objects;
create policy doc_read_assigned_dispatcher on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.organizations o
        join app_private.dispatcher_assignments a on a.carrier_org_id = o.id
       where o.owner_user_id::text = (storage.foldername(name))[1]
         and a.dispatcher_user_id = auth.uid() and a.status = 'active')
  );

-- ---------------------------------------------------------------- widen assignment to trial dispatchers
create or replace function public.cc_dispatcher_assign(p_dispatcher uuid, p_carrier_org uuid, p_sop jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_id uuid; v_kind text; v_dstatus text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select kind into v_kind from public.organizations where id = p_carrier_org;
  if v_kind is null then return jsonb_build_object('error','carrier not found'); end if;
  select status into v_dstatus from app_private.dispatcher_profiles where user_id = p_dispatcher;
  if v_dstatus is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if v_dstatus not in ('trial','verified','active') then
    return jsonb_build_object('error','dispatcher must be in trial, verified or active before assignment');
  end if;
  begin
    insert into app_private.dispatcher_assignments (dispatcher_user_id, carrier_org_id, sop, assigned_by)
    values (p_dispatcher, p_carrier_org, coalesce(p_sop,'{}'::jsonb), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('error','this carrier already has an active dispatcher');
  end;
  update app_private.dispatcher_profiles set status = 'active', updated_at = now()
    where user_id = p_dispatcher and status = 'verified';
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('user','in_app','dispatcher.assigned',
      jsonb_build_object('user', p_dispatcher, 'title', '🚚 New carrier assigned',
        'body','You have been assigned a carrier. Open your workspace for the truck, SOP and booking tools.',
        'tone','success','url','/app/agent/#dashboard'),
      'sent', now());
  exception when others then null; end;
  begin
    insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
      values (v_id, p_carrier_org, 'system', 'Assignment created. This thread is shared by the dispatcher, the carrier and LoadBoot staff.');
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'assignment', v_id);
end $$;

-- ---------------------------------------------------------------- staff: commission % + trial window
create or replace function public.cc_dispatcher_set_terms(p_user uuid, p_commission_pct numeric, p_trial_start date default null, p_trial_end date default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_commission_pct is null or p_commission_pct < 0 or p_commission_pct > 5 then
    return jsonb_build_object('error','commission must be between 0 and 5 percent (LoadBoot fee is 5%)');
  end if;
  update app_private.dispatcher_profiles
     set commission_pct = p_commission_pct,
         trial_start = coalesce(p_trial_start, trial_start),
         trial_end   = coalesce(p_trial_end, trial_end),
         updated_at = now()
   where user_id = p_user;
  if not found then return jsonb_build_object('error','not a dispatcher'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- dispatcher: workspace feed
create or replace function public.dispatcher_workspace_feed()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_prof record; v_out jsonb;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into v_prof from app_private.dispatcher_profiles where user_id = v_uid;
  if v_prof.user_id is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if v_prof.status not in ('trial','verified','active') then
    return jsonb_build_object('error','workspace opens once your trial starts', 'status', v_prof.status);
  end if;

  select jsonb_build_object(
    'profile', jsonb_build_object('full_name', v_prof.full_name, 'status', v_prof.status,
       'commission_pct', v_prof.commission_pct, 'trial_start', v_prof.trial_start, 'trial_end', v_prof.trial_end,
       'currency', v_prof.currency, 'base_salary', v_prof.base_salary, 'per_truck', v_prof.per_truck),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'carrier_org_id', a.carrier_org_id, 'status', a.status, 'sop', a.sop, 'assigned_at', a.assigned_at,
        'carrier', (select jsonb_build_object('name', o.name, 'mc', p.mc, 'dot', p.dot, 'phone', p.phone, 'whatsapp', p.whatsapp,
                        'email', p.email, 'contact_name', p.contact_name, 'home_base', p.home_base, 'min_rpm', p.min_rpm,
                        'max_deadhead', p.max_deadhead, 'avoid_states', p.avoid_states, 'weekend_ok', p.weekend_ok,
                        'factoring_company', p.factoring_company, 'factoring_status', p.factoring_status,
                        'broker_visible', o.broker_visible, 'owner_user_id', o.owner_user_id)
                    from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id),
        'trucks', coalesce((select jsonb_agg(jsonb_build_object(
              'id', t.id, 'unit_no', t.unit_no, 'equipment', t.equipment, 'status', t.status,
              'make', t.vin_make, 'model', t.vin_model, 'year', t.vin_year, 'vin', t.vin, 'gvwr', t.vin_gvwr,
              'payload_lbs', t.payload_lbs, 'cargo_len_in', t.cargo_len_in, 'cargo_width_in', t.cargo_width_in, 'cargo_height_in', t.cargo_height_in,
              'deck_height_in', t.deck_height_in, 'dock_high', t.dock_high, 'liftgate', t.liftgate, 'liftgate_cap_lbs', t.liftgate_cap_lbs,
              'has_pallet_jack', t.has_pallet_jack, 'has_ramp', t.has_ramp, 'has_straps', t.has_straps, 'has_chains', t.has_chains, 'has_tarps', t.has_tarps,
              'has_etrack', t.has_etrack, 'has_load_bars', t.has_load_bars, 'has_blankets', t.has_blankets, 'pallet_positions', t.pallet_positions,
              'temp_control', t.temp_control, 'hazmat_placarded', t.hazmat_placarded, 'team_driven', t.team_driven,
              'trailer_type', t.trailer_type, 'trailer_len_ft', t.trailer_len_ft,
              'domicile_city', t.domicile_city, 'domicile_state', t.domicile_state, 'domicile_zip', t.domicile_zip,
              'min_rpm', t.min_rpm, 'max_radius_miles', t.max_radius_miles, 'home_time', t.home_time,
              'spec_note', t.spec_note, 'capacity_note', t.capacity_note, 'inspection_exp', t.inspection_exp,
              'availability', (select to_jsonb(av) - 'truck_id' - 'carrier_id' from app_private.truck_availability av where av.truck_id = t.id)
            ) order by t.unit_no)
          from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id and coalesce(t.status,'active') <> 'retired'), '[]'::jsonb),
        'drivers', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'phone', d.phone, 'status', d.status) order by d.name)
          from app_private.fleet_drivers d where d.carrier_id = a.carrier_org_id and coalesce(d.status,'active') <> 'inactive'), '[]'::jsonb),
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', dc.id, 'type', dc.type, 'file_name', dc.file_name, 'file_path', dc.file_path, 'status', dc.status, 'created_at', dc.created_at) order by dc.type)
          from public.documents dc
          where dc.status = 'approved'
            -- documents.carrier_id holds the carrier USER id (owner) in practice; accept either convention
            and (dc.carrier_id = a.carrier_org_id
                 or dc.carrier_id = (select o2.owner_user_id from public.organizations o2 where o2.id = a.carrier_org_id))), '[]'::jsonb),
        'unread', (select count(*) from app_private.dispatcher_messages m where m.assignment_id = a.id and m.created_at > coalesce((a.sop->>'disp_read_at')::timestamptz, a.assigned_at) and m.sender_role <> 'dispatcher')
      ) order by a.assigned_at desc)
      from app_private.dispatcher_assignments a where a.dispatcher_user_id = v_uid and a.status = 'active'), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc)
      from (select * from app_private.dispatcher_bookings b where b.dispatcher_user_id = v_uid order by b.created_at desc limit 200) b), '[]'::jsonb),
    'commission', jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'booking_id', c.booking_id, 'gross', c.gross, 'pct', c.pct, 'amount', c.amount,
                  'status', c.status, 'created_at', c.created_at, 'paid_at', c.paid_at,
                  'lane', (select b.origin || ' → ' || b.destination from app_private.dispatcher_bookings b where b.id = c.booking_id)) order by c.created_at desc)
                from app_private.dispatcher_commission c where c.dispatcher_user_id = v_uid), '[]'::jsonb),
      'earned', coalesce((select sum(amount) from app_private.dispatcher_commission where dispatcher_user_id = v_uid and status <> 'void'),0),
      'approved', coalesce((select sum(amount) from app_private.dispatcher_commission where dispatcher_user_id = v_uid and status = 'approved'),0),
      'paid', coalesce((select sum(amount) from app_private.dispatcher_commission where dispatcher_user_id = v_uid and status = 'paid'),0)),
    'brokers', coalesce((select jsonb_agg(to_jsonb(bc) order by bc.broker) from app_private.broker_contacts bc where bc.dispatcher_user_id = v_uid), '[]'::jsonb),
    'kpi', (select jsonb_build_object(
        'bookings_7d', count(*) filter (where created_at > now() - interval '7 days'),
        'delivered_7d', count(*) filter (where status in ('delivered','invoiced','paid') and updated_at > now() - interval '7 days'),
        'gross_7d', coalesce(sum(gross) filter (where status not in ('cancelled','rejected') and created_at > now() - interval '7 days'),0),
        'gross_total', coalesce(sum(gross) filter (where status not in ('cancelled','rejected')),0),
        'avg_rpm', round(avg(case when miles > 0 then gross / miles end)::numeric, 2),
        'active', count(*) filter (where status in ('approved','dispatched','picked_up')),
        'awaiting_rc', count(*) filter (where status = 'pending_rc'),
        'awaiting_approval', count(*) filter (where status = 'rc_received'))
      from app_private.dispatcher_bookings where dispatcher_user_id = v_uid)
  ) into v_out;
  return v_out;
end $$;

-- ---------------------------------------------------------------- dispatcher / carrier / staff: availability
create or replace function public.dispatcher_set_availability(p_truck uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_role text;
begin
  select carrier_id into v_org from app_private.fleet_trucks where id = p_truck;
  if v_org is null then return jsonb_build_object('error','truck not found'); end if;
  v_role := app_private.disp_role_for(v_org);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  insert into app_private.truck_availability as ta (truck_id, carrier_id, status, empty_at, empty_location, empty_zip, must_be_home_by, home_location,
      overnight_weekdays, overnight_weekends, hos_drive_left_h, hos_note, driver_name, driver_phone, note, updated_by, updated_at)
  values (p_truck, v_org,
      coalesce(p->>'status','empty'), nullif(p->>'empty_at','')::timestamptz, p->>'empty_location', p->>'empty_zip',
      nullif(p->>'must_be_home_by','')::timestamptz, p->>'home_location',
      coalesce((p->>'overnight_weekdays')::boolean, true), coalesce((p->>'overnight_weekends')::boolean, false),
      nullif(p->>'hos_drive_left_h','')::numeric, p->>'hos_note', p->>'driver_name', p->>'driver_phone', p->>'note', auth.uid(), now())
  on conflict (truck_id) do update set
      status = excluded.status, empty_at = excluded.empty_at, empty_location = excluded.empty_location, empty_zip = excluded.empty_zip,
      must_be_home_by = excluded.must_be_home_by, home_location = excluded.home_location,
      overnight_weekdays = excluded.overnight_weekdays, overnight_weekends = excluded.overnight_weekends,
      hos_drive_left_h = excluded.hos_drive_left_h, hos_note = excluded.hos_note,
      driver_name = excluded.driver_name, driver_phone = excluded.driver_phone, note = excluded.note,
      updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true, 'role', v_role);
end $$;

-- ---------------------------------------------------------------- dispatcher: bookings
create or replace function public.dispatcher_log_booking(p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_org uuid := nullif(p->>'carrier_org_id','')::uuid; v_truck uuid := nullif(p->>'truck_id','')::uuid;
        v_id uuid; v_min numeric; v_gross numeric; v_miles int; v_below boolean := false; v_status text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  if not app_private.disp_is_assigned(v_org) then return jsonb_build_object('error','you are not assigned to this carrier'); end if;
  if v_truck is not null and not exists (select 1 from app_private.fleet_trucks where id = v_truck and carrier_id = v_org) then
    return jsonb_build_object('error','truck does not belong to this carrier'); end if;
  if coalesce(p->>'broker','') = '' or coalesce(p->>'origin','') = '' or coalesce(p->>'destination','') = '' then
    return jsonb_build_object('error','broker, origin and destination are required'); end if;
  v_gross := nullif(p->>'gross','')::numeric; v_miles := nullif(p->>'miles','')::int;
  if v_gross is null or v_gross <= 0 then return jsonb_build_object('error','gross rate is required'); end if;
  select coalesce(t.min_rpm, (a.sop->>'min_rate')::numeric, pr.min_rpm) into v_min
    from app_private.dispatcher_assignments a
    left join app_private.fleet_trucks t on t.id = v_truck
    left join public.organizations o on o.id = a.carrier_org_id
    left join public.profiles pr on pr.id = o.owner_user_id
   where a.dispatcher_user_id = v_uid and a.carrier_org_id = v_org and a.status = 'active' limit 1;
  if v_min is not null and v_miles is not null and v_miles > 0 and (v_gross / v_miles) < v_min then v_below := true; end if;
  v_status := case when coalesce(p->>'rc_doc_path','') <> '' then 'rc_received' else 'pending_rc' end;
  insert into app_private.dispatcher_bookings (dispatcher_user_id, carrier_org_id, truck_id, broker, broker_mc, broker_rep, broker_phone, broker_email,
      origin, destination, pickup_at, delivery_at, miles, deadhead, gross, commodity, weight_lbs, equipment,
      rc_number, rc_doc_path, rc_doc_name, rc_received_at, status, below_min, notes)
  values (v_uid, v_org, v_truck, p->>'broker', p->>'broker_mc', p->>'broker_rep', p->>'broker_phone', p->>'broker_email',
      p->>'origin', p->>'destination', nullif(p->>'pickup_at','')::timestamptz, nullif(p->>'delivery_at','')::timestamptz,
      v_miles, nullif(p->>'deadhead','')::int, v_gross, p->>'commodity', nullif(p->>'weight_lbs','')::int, p->>'equipment',
      p->>'rc_number', nullif(p->>'rc_doc_path',''), p->>'rc_doc_name', case when coalesce(p->>'rc_doc_path','') <> '' then now() end,
      v_status, v_below, p->>'notes')
  returning id into v_id;
  insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by)
    values (v_id, 'created', 'Booking logged by dispatcher' || case when v_below then ' — BELOW carrier minimum rate, needs approval' else '' end, v_uid);
  -- keep the broker book warm
  if exists (select 1 from app_private.broker_contacts bc where bc.dispatcher_user_id = v_uid and lower(bc.broker) = lower(p->>'broker')) then
    update app_private.broker_contacts set last_contact_at = now(), last_outcome = 'booked', updated_at = now(),
      mc = coalesce(nullif(p->>'broker_mc',''), mc), rep = coalesce(nullif(p->>'broker_rep',''), rep),
      phone = coalesce(nullif(p->>'broker_phone',''), phone), email = coalesce(nullif(p->>'broker_email',''), email)
     where dispatcher_user_id = v_uid and lower(broker) = lower(p->>'broker');
  else
    insert into app_private.broker_contacts (dispatcher_user_id, broker, mc, rep, phone, email, last_contact_at, last_outcome)
      values (v_uid, p->>'broker', p->>'broker_mc', p->>'broker_rep', p->>'broker_phone', p->>'broker_email', now(), 'booked');
  end if;
  -- staff alert
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','dispatcher.booking.logged',
      jsonb_build_object('title', '📋 Dispatcher booking: ' || (p->>'origin') || ' → ' || (p->>'destination'),
        'body', (p->>'broker') || ' · $' || v_gross::text || case when v_below then ' · ⚠ below min rate' else '' end,
        'tone', case when v_below then 'warning' else 'info' end, 'url', '/app/command-center/#dispatchers'),
      'sent', now());
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'below_min', v_below);
end $$;

-- dispatcher-side status moves. Approval is staff-only (cc_dispatcher_booking_decide).
create or replace function public.dispatcher_booking_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_b record; v_to text := p->>'status'; v_ok boolean := false;
begin
  select * into v_b from app_private.dispatcher_bookings where id = p_id;
  if v_b.id is null then return jsonb_build_object('error','booking not found'); end if;
  if v_b.dispatcher_user_id <> v_uid and not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  -- attach / replace RC
  if coalesce(p->>'rc_doc_path','') <> '' then
    update app_private.dispatcher_bookings set rc_doc_path = p->>'rc_doc_path', rc_doc_name = p->>'rc_doc_name',
       rc_number = coalesce(p->>'rc_number', rc_number), rc_received_at = now(),
       status = case when status = 'pending_rc' then 'rc_received' else status end
     where id = p_id;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'rc', 'Rate confirmation attached: ' || coalesce(p->>'rc_doc_name',''), v_uid);
    v_ok := true;
  end if;
  -- editable fields while not yet approved
  if v_b.status in ('pending_rc','rc_received') and (p ? 'gross' or p ? 'miles' or p ? 'pickup_at' or p ? 'delivery_at' or p ? 'notes') then
    update app_private.dispatcher_bookings set
      gross = coalesce(nullif(p->>'gross','')::numeric, gross), miles = coalesce(nullif(p->>'miles','')::int, miles),
      pickup_at = coalesce(nullif(p->>'pickup_at','')::timestamptz, pickup_at), delivery_at = coalesce(nullif(p->>'delivery_at','')::timestamptz, delivery_at),
      notes = coalesce(p->>'notes', notes)
     where id = p_id;
    v_ok := true;
  end if;
  if v_to is not null then
    if v_to = 'cancelled' and v_b.status not in ('delivered','invoiced','paid') then
      update app_private.dispatcher_bookings set status = 'cancelled', decision_note = coalesce(p->>'note', decision_note) where id = p_id;
      insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'status', 'Cancelled: ' || coalesce(p->>'note',''), v_uid);
      v_ok := true;
    elsif (v_b.status, v_to) in (('approved','dispatched'), ('dispatched','picked_up'), ('picked_up','delivered')) then
      update app_private.dispatcher_bookings set status = v_to where id = p_id;
      insert into app_private.dispatcher_booking_events (booking_id, kind, note, location, created_by)
        values (p_id, 'status', v_to || coalesce(': ' || (p->>'note'), ''), p->>'location', v_uid);
      -- mirror into the CC trip timeline when linked
      if v_b.trip_id is not null then
        begin
          insert into app_private.trip_events (trip_id, kind, note, location, created_by)
            values (v_b.trip_id, 'note', 'Dispatcher: ' || v_to || coalesce(' — ' || (p->>'note'), ''), p->>'location', v_uid);
        exception when others then null; end;
      end if;
      v_ok := true;
    elsif not v_ok then
      return jsonb_build_object('error', 'cannot move from ' || v_b.status || ' to ' || v_to || (case when v_to = 'approved' then ' — approval is done by LoadBoot' else '' end));
    end if;
  end if;
  if not v_ok then return jsonb_build_object('error','nothing to update'); end if;
  return jsonb_build_object('ok', true, 'status', (select status from app_private.dispatcher_bookings where id = p_id));
end $$;

-- check calls / notes / ETA / exceptions on a booking
create or replace function public.dispatcher_booking_event(p_booking uuid, p_kind text, p_note text, p_location text default null, p_eta timestamptz default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_b record; v_id uuid;
begin
  select * into v_b from app_private.dispatcher_bookings where id = p_booking;
  if v_b.id is null then return jsonb_build_object('error','booking not found'); end if;
  if app_private.disp_role_for(v_b.carrier_org_id) is null and v_b.dispatcher_user_id <> auth.uid() then return jsonb_build_object('error','not authorized'); end if;
  if p_kind not in ('check_call','note','exception','eta') then return jsonb_build_object('error','bad kind'); end if;
  insert into app_private.dispatcher_booking_events (booking_id, kind, note, location, eta_at, created_by)
    values (p_booking, p_kind, p_note, p_location, p_eta, auth.uid()) returning id into v_id;
  if v_b.trip_id is not null then
    begin
      insert into app_private.trip_events (trip_id, kind, note, location, created_by)
        values (v_b.trip_id, 'note', '[' || p_kind || '] ' || coalesce(p_note,''), p_location, auth.uid());
    exception when others then null; end;
  end if;
  if p_kind = 'exception' then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','dispatcher.booking.exception',
        jsonb_build_object('title', '🚨 Exception on ' || v_b.origin || ' → ' || v_b.destination, 'body', coalesce(p_note,''), 'tone','danger','url','/app/command-center/#dispatchers'),
        'sent', now());
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.dispatcher_booking_timeline(p_booking uuid)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when exists (select 1 from app_private.dispatcher_bookings b where b.id = p_booking
                             and (b.dispatcher_user_id = auth.uid() or app_private.disp_role_for(b.carrier_org_id) is not null))
    then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'note', e.note, 'location', e.location, 'eta_at', e.eta_at, 'created_at', e.created_at,
                     'by', (select coalesce(pr.contact_name, pr.email) from public.profiles pr where pr.id = e.created_by)) order by e.created_at)
                   from app_private.dispatcher_booking_events e where e.booking_id = p_booking), '[]'::jsonb)
    else jsonb_build_object('error','not authorized') end;
$$;

-- ---------------------------------------------------------------- dispatcher: broker book
create or replace function public.dispatcher_broker_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_id uuid := nullif(p->>'id','')::uuid;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  if coalesce(p->>'broker','') = '' then return jsonb_build_object('error','broker name required'); end if;
  if v_id is null then
    insert into app_private.broker_contacts (dispatcher_user_id, broker, mc, rep, phone, email, lanes, equipment, new_authority_ok, rating, last_contact_at, last_outcome, note)
    values (v_uid, p->>'broker', p->>'mc', p->>'rep', p->>'phone', p->>'email', p->>'lanes', p->>'equipment',
            nullif(p->>'new_authority_ok','')::boolean, nullif(p->>'rating','')::smallint,
            coalesce(nullif(p->>'last_contact_at','')::timestamptz, now()), p->>'last_outcome', p->>'note')
    returning id into v_id;
  else
    update app_private.broker_contacts set broker = coalesce(p->>'broker', broker), mc = coalesce(p->>'mc', mc), rep = coalesce(p->>'rep', rep),
      phone = coalesce(p->>'phone', phone), email = coalesce(p->>'email', email), lanes = coalesce(p->>'lanes', lanes), equipment = coalesce(p->>'equipment', equipment),
      new_authority_ok = coalesce(nullif(p->>'new_authority_ok','')::boolean, new_authority_ok), rating = coalesce(nullif(p->>'rating','')::smallint, rating),
      last_contact_at = coalesce(nullif(p->>'last_contact_at','')::timestamptz, last_contact_at), last_outcome = coalesce(p->>'last_outcome', last_outcome),
      note = coalesce(p->>'note', note), updated_at = now()
    where id = v_id and dispatcher_user_id = v_uid;
    if not found then return jsonb_build_object('error','not found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.dispatcher_broker_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  delete from app_private.broker_contacts where id = p_id and dispatcher_user_id = auth.uid();
  return jsonb_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------- thread (dispatcher / carrier / staff)
create or replace function public.dispatcher_thread_list(p_assignment uuid, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record; v_role text;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','not found'); end if;
  v_role := app_private.disp_role_for(v_a.carrier_org_id);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  if v_role = 'dispatcher' then
    update app_private.dispatcher_assignments set sop = coalesce(sop,'{}'::jsonb) || jsonb_build_object('disp_read_at', now()) where id = p_assignment;
  end if;
  return jsonb_build_object('role', v_role, 'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.sender_role, 'body', m.body, 'at', m.created_at,
      'mine', m.sender_user = auth.uid(),
      'by', (select coalesce(pr.contact_name, pr.email) from public.profiles pr where pr.id = m.sender_user)) order by m.created_at)
    from (select * from app_private.dispatcher_messages where assignment_id = p_assignment order by created_at desc limit p_limit) m), '[]'::jsonb));
end $$;

create or replace function public.dispatcher_thread_send(p_assignment uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record; v_role text; v_id uuid;
begin
  if coalesce(btrim(p_body),'') = '' then return jsonb_build_object('error','empty message'); end if;
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','not found'); end if;
  v_role := app_private.disp_role_for(v_a.carrier_org_id);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_user, sender_role, body)
    values (p_assignment, v_a.carrier_org_id, auth.uid(), v_role, left(p_body, 4000)) returning id into v_id;
  -- notify the other parties (carrier owner + dispatcher); staff see it in CC
  begin
    if v_role <> 'dispatcher' then
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('user','in_app','dispatcher.thread', jsonb_build_object('user', v_a.dispatcher_user_id, 'title', '💬 New message from ' || v_role, 'body', left(p_body, 140), 'tone','info','url','/app/agent/#dashboard'), 'sent', now());
    end if;
    if v_role <> 'carrier' then
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      select 'user','in_app','dispatcher.thread', jsonb_build_object('user', o.owner_user_id, 'title', '💬 Message from your dispatcher', 'body', left(p_body, 140), 'tone','info','url','/app/carrier/'), 'sent', now()
        from public.organizations o where o.id = v_a.carrier_org_id and o.owner_user_id is not null;
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'id', v_id, 'role', v_role);
end $$;

-- carrier side: my dispatcher (for the carrier portal, later)
create or replace function public.carrier_my_dispatcher()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'carrier_org_id', a.carrier_org_id, 'assigned_at', a.assigned_at,
      'dispatcher', jsonb_build_object('name', dp.full_name, 'phone', dp.phone, 'country', dp.country, 'status', dp.status)))
    from app_private.dispatcher_assignments a join app_private.dispatcher_profiles dp on dp.user_id = a.dispatcher_user_id
    where a.status = 'active' and app_private.disp_is_carrier_member(a.carrier_org_id)), '[]'::jsonb);
$$;

-- ---------------------------------------------------------------- staff: bookings + commission
create or replace function public.cc_dispatcher_bookings(p_user uuid default null, p_status text default null, p_limit int default 200)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else
    coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object(
        'carrier', (select name from public.organizations o where o.id = b.carrier_org_id),
        'dispatcher', (select full_name from app_private.dispatcher_profiles d where d.user_id = b.dispatcher_user_id),
        'truck', (select unit_no || ' · ' || coalesce(equipment,'') from app_private.fleet_trucks t where t.id = b.truck_id),
        'commission', (select jsonb_build_object('id', c.id, 'amount', c.amount, 'pct', c.pct, 'status', c.status) from app_private.dispatcher_commission c where c.booking_id = b.id)
      ) order by b.created_at desc)
      from (select * from app_private.dispatcher_bookings
             where (p_user is null or dispatcher_user_id = p_user) and (p_status is null or status = p_status)
             order by created_at desc limit p_limit) b), '[]'::jsonb) end;
$$;

-- approve → creates the CC load + trip so the existing tracking/POD/invoice engines take over.
create or replace function public.cc_dispatcher_booking_decide(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_b record; v_load uuid; v_trip uuid; v_truck text; v_drv record;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into v_b from app_private.dispatcher_bookings where id = p_id;
  if v_b.id is null then return jsonb_build_object('error','booking not found'); end if;
  if p_action = 'approve' then
    if v_b.status not in ('pending_rc','rc_received') then return jsonb_build_object('error','already ' || v_b.status); end if;
    if v_b.rc_doc_path is null then return jsonb_build_object('error','no rate confirmation attached — ask the dispatcher for the RC first'); end if;
    -- inserted directly as 'booked': it was booked on an external board, so it must never be
    -- matched against other carriers' postings (trg_load_posted_match fires only on 'available').
    if v_b.load_id is null then
      insert into public.loads(origin, destination, equipment, rate, miles, commodity, pickup_date, delivery_date, broker, status, source_type, source_provider, notes, created_by, assigned_to)
        values (v_b.origin, v_b.destination, v_b.equipment, v_b.gross, v_b.miles, v_b.commodity,
                (v_b.pickup_at at time zone 'America/New_York')::date, (v_b.delivery_at at time zone 'America/New_York')::date,
                v_b.broker, 'booked', 'staff_entered', 'dispatcher', 'Logged by dispatcher; RC ' || coalesce(v_b.rc_number,''), auth.uid(),
                (select o.owner_user_id from public.organizations o where o.id = v_b.carrier_org_id))
        returning id into v_load;
    else v_load := v_b.load_id; end if;
    select unit_no into v_truck from app_private.fleet_trucks where id = v_b.truck_id;
    select driver_name, driver_phone into v_drv from app_private.truck_availability where truck_id = v_b.truck_id;
    if v_b.trip_id is null then
      -- trips carry compliance triggers (valid driver, etc.). Surface those as a readable error
      -- instead of a 500, and roll the load insert back with it.
      begin
        insert into app_private.trips(load_id, carrier_id, driver_name, driver_phone, truck_no, truck_id, rate, miles, scheduled_pickup, scheduled_delivery, created_by)
          values (v_load, v_b.carrier_org_id, v_drv.driver_name, v_drv.driver_phone, v_truck, v_b.truck_id, v_b.gross, v_b.miles, v_b.pickup_at, v_b.delivery_at, auth.uid())
          returning id into v_trip;
      exception when others then
        if v_b.load_id is null then delete from public.loads where id = v_load; end if;
        return jsonb_build_object('error', 'Cannot create the trip: ' || sqlerrm);
      end;
      insert into app_private.trip_stops(trip_id, kind, sort, location, scheduled_at) values
        (v_trip, 'pickup', 1, v_b.origin, v_b.pickup_at), (v_trip, 'delivery', 2, v_b.destination, v_b.delivery_at);
      insert into app_private.trip_events(trip_id, kind, to_status, note, created_by) values (v_trip, 'status', 'planned', 'trip created from dispatcher booking ' || v_b.id::text, auth.uid());
    else v_trip := v_b.trip_id; end if;
    update app_private.dispatcher_bookings set status = 'approved', load_id = v_load, trip_id = v_trip, approved_by = auth.uid(), approved_at = now(), decision_note = p_note where id = p_id;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'decision', 'Approved by LoadBoot' || coalesce(': ' || p_note, ''), auth.uid());
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('user','in_app','dispatcher.booking.approved', jsonb_build_object('user', v_b.dispatcher_user_id, 'title', '✅ Booking approved — dispatch the driver', 'body', v_b.origin || ' → ' || v_b.destination, 'tone','success','url','/app/agent/#dashboard'), 'sent', now());
    exception when others then null; end;
    begin perform app_private.log_audit('dispatcher.booking.approve', 'booking', p_id::text, null, 'dispatcher booking approved', jsonb_build_object('load', v_load, 'trip', v_trip)); exception when others then null; end;
    return jsonb_build_object('ok', true, 'load', v_load, 'trip', v_trip);
  elsif p_action = 'reject' then
    update app_private.dispatcher_bookings set status = 'rejected', decision_note = p_note where id = p_id and status in ('pending_rc','rc_received');
    if not found then return jsonb_build_object('error','cannot reject in status ' || v_b.status); end if;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'decision', 'Rejected by LoadBoot' || coalesce(': ' || p_note, ''), auth.uid());
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('user','in_app','dispatcher.booking.rejected', jsonb_build_object('user', v_b.dispatcher_user_id, 'title', '✕ Booking not approved', 'body', coalesce(p_note, v_b.origin || ' → ' || v_b.destination), 'tone','danger','url','/app/agent/#dashboard'), 'sent', now());
    exception when others then null; end;
    return jsonb_build_object('ok', true);
  elsif p_action in ('invoiced','paid') then
    if v_b.status not in ('delivered','invoiced') then return jsonb_build_object('error','booking must be delivered first'); end if;
    update app_private.dispatcher_bookings set status = p_action where id = p_id;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'status', p_action || coalesce(': ' || p_note, ''), auth.uid());
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('error','bad action');
end $$;

create or replace function public.cc_dispatcher_commission_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_status not in ('approved','paid','void','draft') then return jsonb_build_object('error','bad status'); end if;
  update app_private.dispatcher_commission set status = p_status, note = coalesce(p_note, note),
     approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
     approved_at = case when p_status = 'approved' then now() else approved_at end,
     paid_at = case when p_status = 'paid' then now() else paid_at end
   where id = p_id;
  if not found then return jsonb_build_object('error','not found'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_dispatcher_commission_list(p_user uuid default null)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'booking_id', c.booking_id, 'dispatcher_user_id', c.dispatcher_user_id,
        'dispatcher', (select full_name from app_private.dispatcher_profiles d where d.user_id = c.dispatcher_user_id),
        'carrier', (select name from public.organizations o where o.id = c.carrier_org_id),
        'lane', (select origin || ' → ' || destination from app_private.dispatcher_bookings b where b.id = c.booking_id),
        'gross', c.gross, 'pct', c.pct, 'amount', c.amount, 'status', c.status, 'created_at', c.created_at, 'paid_at', c.paid_at, 'note', c.note) order by c.created_at desc)
      from app_private.dispatcher_commission c where p_user is null or c.dispatcher_user_id = p_user), '[]'::jsonb) end;
$$;

-- ---------------------------------------------------------------- grants (authenticated only — never anon)
revoke all on function public.dispatcher_workspace_feed() from public, anon;
revoke all on function public.dispatcher_set_availability(uuid, jsonb) from public, anon;
revoke all on function public.dispatcher_log_booking(jsonb) from public, anon;
revoke all on function public.dispatcher_booking_update(uuid, jsonb) from public, anon;
revoke all on function public.dispatcher_booking_event(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.dispatcher_booking_timeline(uuid) from public, anon;
revoke all on function public.dispatcher_broker_upsert(jsonb) from public, anon;
revoke all on function public.dispatcher_broker_delete(uuid) from public, anon;
revoke all on function public.dispatcher_thread_list(uuid, int) from public, anon;
revoke all on function public.dispatcher_thread_send(uuid, text) from public, anon;
revoke all on function public.carrier_my_dispatcher() from public, anon;
revoke all on function public.cc_dispatcher_assign(uuid, uuid, jsonb) from public, anon;
revoke all on function public.cc_dispatcher_set_terms(uuid, numeric, date, date) from public, anon;
revoke all on function public.cc_dispatcher_bookings(uuid, text, int) from public, anon;
revoke all on function public.cc_dispatcher_booking_decide(uuid, text, text) from public, anon;
revoke all on function public.cc_dispatcher_commission_status(uuid, text, text) from public, anon;
revoke all on function public.cc_dispatcher_commission_list(uuid) from public, anon;
grant execute on function public.dispatcher_workspace_feed(), public.dispatcher_set_availability(uuid, jsonb), public.dispatcher_log_booking(jsonb),
  public.dispatcher_booking_update(uuid, jsonb), public.dispatcher_booking_event(uuid, text, text, text, timestamptz), public.dispatcher_booking_timeline(uuid),
  public.dispatcher_broker_upsert(jsonb), public.dispatcher_broker_delete(uuid), public.dispatcher_thread_list(uuid, int), public.dispatcher_thread_send(uuid, text),
  public.carrier_my_dispatcher(), public.cc_dispatcher_assign(uuid, uuid, jsonb), public.cc_dispatcher_set_terms(uuid, numeric, date, date),
  public.cc_dispatcher_bookings(uuid, text, int), public.cc_dispatcher_booking_decide(uuid, text, text), public.cc_dispatcher_commission_status(uuid, text, text),
  public.cc_dispatcher_commission_list(uuid) to authenticated;
