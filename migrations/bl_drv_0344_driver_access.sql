-- bl_drv_0344 — DRIVER ACCESS (owner invites drivers, plain-language permissions, driver mode, CC visibility)
-- Applied to STAGING 2026-09-14 in five steps via MCP (0344a..e) and end-to-end tested with a throwaway driver.
-- PROD: run this whole file in ONE transaction, then compare the anon-secdef NAMES against docs/audit-2026-09/anon-secdef-baseline.md.
-- Safety: owners/managers/dispatchers behave exactly as before; only 'driver' members are gated. Re-runnable (create or replace / if not exists / on conflict).
begin;
-- ---------------------------------------------------------------- 1. tables
create table if not exists app_private.driver_permission_catalog (
  key         text primary key,
  grp         text not null,
  grp_label   text not null,
  grp_why     text,
  label       text not null,
  description text,
  kind        text not null check (kind in ('core','optional')),
  available   boolean not null default true,
  sort        int  not null default 0
);

insert into app_private.driver_permission_catalog(key,grp,grp_label,grp_why,label,description,kind,available,sort) values
 ('trips.view_mine','trip','Trip work','This is why the driver is on the app. Always on.','See my assigned loads','Only trips assigned to this driver — never other drivers’ loads','core',true,10),
 ('trips.checkin','trip','Trip work',null,'GPS arrive / depart check-in','Timestamps + location prove detention','core',true,11),
 ('trips.location_live','trip','Trip work',null,'Share live location during a trip','Dispatcher and broker see the truck moving. Off outside trips.','core',true,12),
 ('trips.pod_upload','trip','Trip work',null,'Upload POD / BOL photos','Same-day invoicing','core',true,13),
 ('trips.report_issue','trip','Trip work',null,'Report detention, lumper, breakdown, delay','Creates the claim with GPS evidence','core',true,14),
 ('trips.emergency','trip','Trip work',null,'Roadside SOS / emergency','Alerts the owner and the LoadBoot desk','core',true,15),
 ('trips.confirm','trip','Trip work',null,'Confirm or decline an assigned trip','“I’ll take it” by the deadline','core',true,16),
 ('trips.paperwork','trip','Trip work',null,'Download trip paperwork (BOL, dispatch sheet)','Rate stays hidden unless “See load rates” is on','core',true,17),
 ('alerts.mine','trip','Trip work',null,'Alerts for my loads','Push + in-app','core',true,18),
 ('support.chat','trip','Trip work',null,'Chat with LoadBoot dispatch','Same live chat the owner uses','core',true,19),
 ('profile.edit_own','trip','Trip work',null,'Edit my phone, photo, emergency contacts','Name and license stay owner-controlled','core',true,20),
 ('loads.view_board','loads','Loads','Whether the driver can find and book loads on their own.','See the load board','Browse loads for their truck (no booking)','optional',true,30),
 ('loads.see_rates','loads','Loads',null,'See load rates & pay','Otherwise rates are hidden everywhere in the app','optional',true,31),
 ('loads.request_book','loads','Loads',null,'Request / book loads for my truck','Booking still follows your dispatch rules and agreement','optional',true,32),
 ('loads.respond_offers','loads','Loads',null,'Accept or decline dispatcher offers','For loads offered to their truck','optional',true,33),
 ('loads.review_facility','loads','Loads',null,'Rate shippers & facilities after delivery','Feeds LoadBoot facility scores','optional',true,34),
 ('avail.post_truck','avail','Availability & hours','Daily posting rule — let the driver post “empty in Memphis Friday” themselves.','Post my truck available (daily)','Their unit only','optional',true,40),
 ('avail.toggle_online','avail','Availability & hours',null,'Go Online / Offline','Their own truck','optional',true,41),
 ('avail.set_hours','avail','Availability & hours',null,'Update drive hours left (HOS)','Improves load matching; ELD stays owner-connected','optional',true,42),
 ('fleet.view','fleet','Fleet & truck','Trucks, trailers, maintenance — for a lead driver.','See fleet list','Trucks and drivers (no editing)','optional',true,50),
 ('fleet.edit_trucks','fleet','Fleet & truck',null,'Edit truck details','Plate, equipment, liftgate, dock height…','optional',true,51),
 ('fleet.swap_trailer','fleet','Fleet & truck',null,'Change trailer / unit on my trip','Logged on the trip timeline','optional',true,52),
 ('fleet.maintenance','fleet','Fleet & truck',null,'Log service, inspections & defects','Oil, tires, pre-trip defects → owner alert','optional',true,53),
 ('docs.view_status','docs','Documents','Carrier documents are read-only; the driver can upload their own.','See carrier document status','Verified / pending / rejected — read-only','optional',true,60),
 ('docs.upload_own','docs','Documents',null,'Upload my CDL & medical card','You approve; expiry reminders go to both of you','optional',true,61),
 ('finance.view_earnings','money','Money (view / log only)','Seeing or logging only — no money ever moves.','See my trip earnings','Their trips only, no bank details','optional',true,70),
 ('finance.add_expenses','money','Money (view / log only)',null,'Add fuel, tolls, lumper receipts','Receipts land in your P&L and IFTA','optional',true,71),
 ('finance.view_settlements','money','Money (view / log only)',null,'See my settlement / pay stubs','Once you mark payroll paid','optional',true,72),
 ('team.view_drivers','team','Team','Co-ordination with the other drivers.','See other drivers’ names & status','For team driving / handoffs','optional',true,80),
 ('team.message','team','Team',null,'Message other drivers in the fleet','Fleet chat — coming soon','optional',false,81)
on conflict (key) do update set grp=excluded.grp, grp_label=excluded.grp_label, grp_why=excluded.grp_why, label=excluded.label,
  description=excluded.description, kind=excluded.kind, available=excluded.available, sort=excluded.sort;

create table if not exists app_private.driver_presets (
  key text primary key, label text not null, description text, perms text[] not null default '{}', sort int not null default 0
);
insert into app_private.driver_presets(key,label,description,perms,sort) values
 ('driver','Driver only','Runs assigned loads. Default.','{}',1),
 ('book','Driver + book loads','Can find and request loads for their truck','{loads.view_board,loads.see_rates,loads.request_book,loads.respond_offers,loads.review_facility}',2),
 ('lead','Lead driver','Also manages trucks, availability, expenses','{loads.view_board,loads.see_rates,loads.request_book,loads.respond_offers,loads.review_facility,avail.post_truck,avail.toggle_online,avail.set_hours,fleet.view,fleet.edit_trucks,fleet.swap_trailer,fleet.maintenance,finance.add_expenses,docs.upload_own,team.view_drivers}',3),
 ('full','Full trust','Everything except money and account settings','{loads.view_board,loads.see_rates,loads.request_book,loads.respond_offers,loads.review_facility,avail.post_truck,avail.toggle_online,avail.set_hours,fleet.view,fleet.edit_trucks,fleet.swap_trailer,fleet.maintenance,docs.view_status,docs.upload_own,finance.view_earnings,finance.add_expenses,finance.view_settlements,team.view_drivers}',4)
on conflict (key) do update set label=excluded.label, description=excluded.description, perms=excluded.perms, sort=excluded.sort;

create table if not exists app_private.driver_grants (
  org_id     uuid not null,
  user_id    uuid not null,
  perm_key   text not null references app_private.driver_permission_catalog(key) on delete cascade,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id, perm_key)
);
create index if not exists driver_grants_user_idx on app_private.driver_grants(user_id, org_id);

-- rpc_name -> permission required for a DRIVER member. Absent = deny. 'deny' = explicit owner-only.
create table if not exists app_private.driver_rpc_policy (
  rpc_name text primary key,
  perm_key text not null,
  note text
);

create table if not exists app_private.driver_denials (
  id bigserial primary key, org_id uuid, user_id uuid, rpc_name text, perm_key text, created_at timestamptz default now()
);
create index if not exists driver_denials_org_idx on app_private.driver_denials(org_id, created_at desc);

create table if not exists app_private.driver_org_settings (
  org_id uuid primary key,
  require_android_app boolean not null default true,
  updated_at timestamptz default now()
);

alter table app_private.carrier_driver_invites
  add column if not exists perms text[] not null default '{}',
  add column if not exists preset text,
  add column if not exists sent_via text[] not null default '{}',
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid,
  add column if not exists resend_count int not null default 0,
  add column if not exists last_sent_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists install_platform text;

alter table app_private.fleet_drivers
  add column if not exists last_seen_at timestamptz,
  add column if not exists device jsonb,
  add column if not exists app_platform text,
  add column if not exists installed_app boolean not null default false,
  add column if not exists location_on boolean not null default false,
  add column if not exists preset text;

create table if not exists app_private.fleet_driver_docs (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null,
  fleet_driver_id uuid not null references app_private.fleet_drivers(id) on delete cascade,
  kind text not null check (kind in ('cdl','medical','other')),
  path text not null, file_name text, content_type text, size bigint,
  expires_on date,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text,
  uploaded_by uuid, created_at timestamptz default now(),
  reviewed_by uuid, reviewed_at timestamptz
);
create index if not exists fleet_driver_docs_drv_idx on app_private.fleet_driver_docs(fleet_driver_id, created_at desc);

-- Realtime event stream (public so Supabase Realtime can serve it; RLS scopes rows).
create table if not exists public.driver_access_events (
  id bigserial primary key,
  org_id uuid not null,
  user_id uuid,                 -- null = whole org (owner + managers + drivers)
  kind text not null,           -- driver.joined | driver.online | driver.location | grants.changed | driver.suspended | driver.removed | invite.sent | invite.revoked | doc.reviewed | carrier.status
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists driver_access_events_org_idx on public.driver_access_events(org_id, id desc);
alter table public.driver_access_events enable row level security;
drop policy if exists dae_select on public.driver_access_events;
create policy dae_select on public.driver_access_events for select to authenticated using (
  exists (select 1 from public.organization_memberships om
           where om.org_id = driver_access_events.org_id and om.user_id = auth.uid() and om.status='active'
             and (om.member_role in ('owner','manager') or driver_access_events.user_id is null or driver_access_events.user_id = auth.uid()))
);
revoke all on public.driver_access_events from anon, public;
grant select on public.driver_access_events to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='driver_access_events') then
    alter publication supabase_realtime add table public.driver_access_events;
  end if;
end $$;

create or replace function app_private.driver_event(p_org uuid, p_user uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to 'app_private','public' as $$
  insert into public.driver_access_events(org_id, user_id, kind, payload) values (p_org, p_user, p_kind, coalesce(p_payload,'{}'::jsonb));
$$;
revoke all on function app_private.driver_event(uuid,uuid,text,jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. helpers
create or replace function app_private.my_fleet_driver(p_org uuid)
returns uuid language sql stable security definer set search_path to 'app_private','public' as $$
  select d.id from app_private.fleet_drivers d where d.carrier_id = p_org and d.user_id = auth.uid() limit 1;
$$;

create or replace function app_private.driver_has_perm(p_org uuid, p_key text)
returns boolean language sql stable security definer set search_path to 'app_private','public' as $$
  select exists (select 1 from app_private.driver_permission_catalog c where c.key = p_key and c.kind = 'core')
      or exists (select 1 from app_private.driver_grants g where g.org_id = p_org and g.user_id = auth.uid() and g.perm_key = p_key);
$$;

-- Name of the public RPC that (transitively) called us, read from the PL/pgSQL call stack.
create or replace function app_private.caller_rpc_name()
returns text language plpgsql as $$
declare v_ctx text; m text[]; v_name text;
begin
  get diagnostics v_ctx = pg_context;
  for m in select regexp_matches(v_ctx, '(?:PL/pgSQL function|SQL function) "?(?:[a-z_]+\.)?([a-z0-9_]+)"?\(', 'g') loop
    v_name := m[1];
    if v_name in ('caller_rpc_name','my_carrier_org','my_fleet_driver','driver_has_perm','assert_trip_mine','driver_gate') then continue; end if;
    return v_name;
  end loop;
  return null;
end $$;

-- Called only for driver members: raises unless the calling RPC is allowed for this driver.
create or replace function app_private.driver_gate(p_org uuid)
returns void language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_rpc text; v_perm text; v_label text;
begin
  v_rpc := app_private.caller_rpc_name();
  select perm_key into v_perm from app_private.driver_rpc_policy where rpc_name = v_rpc;
  if v_perm is null or v_perm = 'deny' then
    begin insert into app_private.driver_denials(org_id, user_id, rpc_name, perm_key) values (p_org, auth.uid(), coalesce(v_rpc,'?'), coalesce(v_perm,'none')); exception when others then null; end;
    raise exception 'This part of LoadBoot is for the account owner. Ask your carrier if you need it.' using errcode='42501', hint='DRIVER_DENIED';
  end if;
  if not app_private.driver_has_perm(p_org, v_perm) then
    select label into v_label from app_private.driver_permission_catalog where key = v_perm;
    begin insert into app_private.driver_denials(org_id, user_id, rpc_name, perm_key) values (p_org, auth.uid(), v_rpc, v_perm); exception when others then null; end;
    raise exception 'Your carrier has not turned on "%" for you — ask the owner.', coalesce(v_label, v_perm) using errcode='42501', hint='DRIVER_DENIED:' || v_perm;
  end if;
end $$;

-- The gate. Signature and owner/manager/dispatcher behaviour identical to the previous SQL version.
create or replace function app_private.my_carrier_org()
returns uuid language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_role text;
begin
  select om.org_id, om.member_role into v_org, v_role
    from public.organization_memberships om
    join public.organizations o on o.id = om.org_id
   where om.user_id = auth.uid() and om.status = 'active' and o.kind = 'carrier'
   order by om.created_at limit 1;
  if v_org is not null then
    if v_role = 'driver' then perform app_private.driver_gate(v_org); end if;
    return v_org;
  end if;
  select a.carrier_org_id into v_org
    from app_private.dispatcher_assignments a
   where a.dispatcher_user_id = auth.uid() and a.status = 'active'
     and a.carrier_org_id::text = nullif(current_setting('app.dispatch_as', true), '')
   limit 1;
  return v_org;
end $$;

-- Row scoping: a driver may only touch trips assigned to them. Owners/managers: no-op.
create or replace function app_private.assert_trip_mine(p_trip uuid, p_org uuid)
returns void language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_role text; v_drv uuid;
begin
  if p_trip is null then return; end if;
  select member_role into v_role from public.organization_memberships where org_id = p_org and user_id = auth.uid() and status='active';
  if v_role is distinct from 'driver' then return; end if;
  v_drv := app_private.my_fleet_driver(p_org);
  if v_drv is null or not exists (select 1 from app_private.trips t where t.id = p_trip and t.carrier_id = p_org and t.driver_id = v_drv) then
    raise exception 'This load is not assigned to you.' using errcode='42501', hint='DRIVER_DENIED:trips.view_mine';
  end if;
end $$;

revoke all on function app_private.my_fleet_driver(uuid), app_private.driver_has_perm(uuid,text), app_private.caller_rpc_name(),
  app_private.driver_gate(uuid), app_private.assert_trip_mine(uuid,uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. rpc -> permission policy (drivers only)
insert into app_private.driver_rpc_policy(rpc_name, perm_key) values
 -- trip work (core)
 ('cc_pocket_trips','trips.view_mine'),('cc_pocket_trip_timeline','trips.view_mine'),('cc_pocket_trip_docs','trips.view_mine'),
 ('cc_pocket_trip_pods','trips.view_mine'),('cc_load_stops','trips.view_mine'),('cc_booking_status','trips.view_mine'),
 ('cc_my_driver_context','trips.view_mine'),('cc_driver_heartbeat','trips.view_mine'),('cc_driver_my_docs','trips.view_mine'),
 ('cc_trip_checkin','trips.checkin'),('cc_pocket_advance_trip','trips.checkin'),
 ('cc_pocket_post_location','trips.location_live'),('cc_trip_set_tracking','trips.location_live'),('cc_pocket_set_consent','trips.location_live'),
 ('cc_pocket_upload_pod','trips.pod_upload'),
 ('cc_pocket_report_issue','trips.report_issue'),('cc_report_trip_incident','trips.report_issue'),('cc_my_trip_incidents','trips.report_issue'),
 ('cc_trip_emergency_request','trips.emergency'),('cc_trip_my_emergencies','trips.emergency'),('cc_emergency_contacts','trips.emergency'),
 ('cc_pocket_confirm_trip','trips.confirm'),
 ('cc_dispatch_sheet','trips.paperwork'),('cc_delivery_doc_pack','trips.paperwork'),('cc_request_packet_copies','trips.paperwork'),
 ('cc_emergency_contact_add','profile.edit_own'),('cc_emergency_contact_delete','profile.edit_own'),('cc_driver_update_my_profile','profile.edit_own'),
 -- loads
 ('cc_pocket_available_loads','loads.view_board'),('cc_carrier_best_loads','loads.view_board'),('cc_carrier_view_poster','loads.view_board'),
 ('cc_lane_rate','loads.view_board'),('cc_prebook_check','loads.view_board'),('cc_scan_truck_matches','loads.view_board'),
 ('cc_truck_posting_matches','loads.view_board'),('cc_my_book_requests','loads.view_board'),('cc_my_approved_partners','loads.view_board'),
 ('cc_load_detail','loads.see_rates'),('cc_my_rate_confirmation','loads.see_rates'),('cc_acknowledge_rate_confirmation','loads.see_rates'),
 ('cc_pocket_book_load','loads.request_book'),('cc_request_book_load','loads.request_book'),
 ('cc_carrier_offers','loads.respond_offers'),('cc_offer_respond','loads.respond_offers'),
 ('facility_review_submit','loads.review_facility'),('cc_carrier_rateable_trips','loads.review_facility'),
 -- availability & hours
 ('cc_post_truck','avail.post_truck'),('cc_my_truck_postings','avail.post_truck'),('cc_confirm_truck_posting','avail.post_truck'),
 ('cc_update_truck_posting','avail.post_truck'),('cc_update_truck_posting_place','avail.post_truck'),('cc_my_availability_status','avail.post_truck'),
 ('cc_my_free_trucks','avail.post_truck'),('cc_my_capacity','avail.post_truck'),
 ('cc_set_truck_posting_available','avail.toggle_online'),
 ('cc_set_posting_hos','avail.set_hours'),
 -- fleet
 ('cc_pocket_trucks','fleet.view'),('cc_pocket_drivers','fleet.view'),('cc_truck_loading_profiles','fleet.view'),('cc_pocket_fleet_alerts','fleet.view'),
 ('cc_pocket_expiries','fleet.view'),('cc_fleet_maintenance','fleet.view'),('cc_fleet_service_list','fleet.view'),
 ('cc_pocket_upsert_truck','fleet.edit_trucks'),('cc_truck_set_maintenance','fleet.edit_trucks'),('cc_coi_vehicles','fleet.edit_trucks'),('cc_vin_coverage','fleet.edit_trucks'),
 ('cc_pocket_assign_trip','fleet.swap_trailer'),
 ('cc_fleet_service_add','fleet.maintenance'),('cc_fleet_service_delete','fleet.maintenance'),
 -- documents
 ('cc_pocket_compliance','docs.view_status'),('cc_account_health','docs.view_status'),
 ('cc_driver_doc_upload','docs.upload_own'),
 -- money (view / log)
 ('cc_driver_my_earnings','finance.view_earnings'),('cc_trip_pnl','finance.view_earnings'),
 ('cc_expense_add','finance.add_expenses'),('cc_expense_list','finance.add_expenses'),('cc_expense_delete','finance.add_expenses'),
 ('cc_carrier_add_expense','finance.add_expenses'),('cc_carrier_expenses','finance.add_expenses'),('cc_carrier_delete_expense','finance.add_expenses'),
 ('cc_trip_finance_add','finance.add_expenses'),('carrier_fuel_import','finance.add_expenses'),
 ('cc_driver_my_settlements','finance.view_settlements'),
 -- team
 ('cc_pocket_team','team.view_drivers'),
 -- explicit owner-only (documented, same effect as absent)
 ('cc_pocket_overview','deny'),('cc_carrier_dashboard','deny'),('cc_my_payment_profile','deny'),('cc_set_my_payment_profile','deny'),
 ('carrier_factoring_set','deny'),('carrier_factoring_packet','deny'),('cc_carrier_sign_agreement','deny'),('cc_carrier_submit_w9','deny'),
 ('cc_pocket_set_member','deny'),('cc_carrier_invite_driver','deny'),('cc_carrier_link_driver','deny'),('carrier_eld_setup','deny'),
 ('cc_set_dispatch_prefs','deny'),('cc_set_cost_model','deny'),('cc_set_org_logo','deny'),('cc_request_account_action','deny'),
 ('cc_pocket_submit_onboarding','deny'),('cc_pocket_invoices','deny'),('pay_due_items','deny'),('pay_mark_sent','deny'),('cc_carrier_pnl','deny'),('cc_carrier_earnings','deny')
on conflict (rpc_name) do update set perm_key = excluded.perm_key;

-- ---------------------------------------------------------------- 4. trip-scoped RPC patches (anchor: "<var> := app_private.my_carrier_org();")
do $$
declare r record; v_def text; v_new text; v_var text; v_begin int; v_pos int; n_ok int := 0; v_fail text := '';
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname in (
              'cc_pocket_trip_docs','cc_pocket_trip_pods','cc_pocket_trip_timeline','cc_trip_checkin','cc_pocket_upload_pod',
              'cc_pocket_advance_trip','cc_pocket_report_issue','cc_pocket_post_location','cc_pocket_confirm_trip','cc_report_trip_incident',
              'cc_trip_set_tracking','cc_dispatch_sheet','cc_delivery_doc_pack','cc_my_rate_confirmation','cc_trip_pnl','cc_trip_finance_add',
              'cc_request_packet_copies','facility_review_submit','cc_pocket_assign_trip')
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def like '%assert_trip_mine%' then n_ok := n_ok + 1; continue; end if;
    v_var := (regexp_match(v_def, '(\w+)\s*:=\s*app_private\.my_carrier_org\(\);'))[1];
    v_begin := position(E'\nbegin' in v_def);
    v_pos := position(v_var || ' := app_private.my_carrier_org();' in v_def);
    if v_var is null then v_fail := v_fail || ' ' || r.proname; continue; end if;
    -- prod keeps some bodies on one line (no "\nbegin"): v_begin = 0 there, and the assignment is in the body -> regexp path
    if v_begin > 0 and v_pos < v_begin then
      -- assigned in DECLARE: put the assertion as the first statement of the body
      v_new := overlay(v_def placing E'\nbegin\n  perform app_private.assert_trip_mine(p_trip, ' || v_var || ');' from v_begin for length(E'\nbegin'));
    else
      v_new := regexp_replace(v_def, '(\w+)\s*:=\s*app_private\.my_carrier_org\(\);',
             '\1 := app_private.my_carrier_org(); perform app_private.assert_trip_mine(p_trip, \1);', '');
    end if;
    execute v_new;
    n_ok := n_ok + 1;
  end loop;
  raise notice 'assert_trip_mine patched: % ok; failed:%', n_ok, coalesce(nullif(v_fail,''),' none');
  if v_fail <> '' then raise exception 'trip patch failed for:%', v_fail; end if;
end $$;

-- cc_pocket_assign_trip: a driver may only move their own trip onto another truck, never re-assign the driver.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='cc_pocket_assign_trip';
  if v_def not like '%DRIVER_SELF_ONLY%' then
    v_def := replace(v_def, 'perform app_private.assert_trip_mine(p_trip, v_org);',
      'perform app_private.assert_trip_mine(p_trip, v_org); if app_private.my_fleet_driver(v_org) is not null and exists (select 1 from public.organization_memberships where org_id=v_org and user_id=auth.uid() and member_role=''driver'') and p_driver is distinct from app_private.my_fleet_driver(v_org) then raise exception ''Drivers can only change the truck on their own trip.'' using errcode=''42501'', hint=''DRIVER_SELF_ONLY''; end if;');
    execute v_def;
  end if;
end $$;

-- cc_my_trip_incidents was a SQL function (no frame for the gate to read when inlined) — same body, plpgsql, driver-scoped.
create or replace function public.cc_my_trip_incidents(p_trip uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path to 'public','app_private' as $$
declare v_org uuid; v_drv uuid;
begin
  v_org := app_private.my_carrier_org();
  perform app_private.assert_trip_mine(p_trip, v_org);
  v_drv := app_private.my_fleet_driver(v_org);
  return query
    select jsonb_build_object('id',i.id,'trip_id',i.trip_id,'itype',i.itype,'need',i.need,'note',i.note,'status',i.status,
      'location_text',i.location_text,'created_at',i.created_at,'acked_at',i.acked_at,'resolution_note',i.resolution_note)
    from app_private.trip_incidents i
    where i.carrier_id = v_org and (p_trip is null or i.trip_id = p_trip)
      and (v_drv is null or exists (select 1 from app_private.trips t where t.id = i.trip_id and t.driver_id = v_drv))
    order by i.created_at desc;
end $$;

-- cc_pocket_trips: drivers see only their trips; rate hidden unless loads.see_rates.
create or replace function public.cc_pocket_trips(p_limit integer default 50)
returns table(id uuid, load_id uuid, origin text, destination text, status text, rate numeric, scheduled_pickup timestamptz, scheduled_delivery timestamptz,
  started_at timestamptz, delivered_at timestamptz, pickup_mode text, pickup_lat double precision, pickup_lng double precision,
  delivery_lat double precision, delivery_lng double precision, cancel_reason text, cancelled_by text, cancel_fault text, cancel_evidence jsonb)
language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_limit int := least(greatest(coalesce(p_limit,50),1),200); v_drv uuid; v_rates boolean := true;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if exists (select 1 from public.organization_memberships where org_id=v_org and user_id=auth.uid() and member_role='driver') then
    v_drv := app_private.my_fleet_driver(v_org);
    if v_drv is null then return; end if;
    v_rates := app_private.driver_has_perm(v_org, 'loads.see_rates');
  end if;
  return query
    select t.id, t.load_id, l.origin, l.destination, t.status, case when v_rates then t.rate else null end, t.scheduled_pickup, t.scheduled_delivery,
           t.started_at, t.delivered_at, t.pickup_mode, t.pickup_lat, t.pickup_lng, t.delivery_lat, t.delivery_lng,
           t.cancel_reason, t.cancelled_by, t.cancel_fault, t.cancel_evidence
    from app_private.trips t join public.loads l on l.id=t.load_id
    where t.carrier_id=v_org and (v_drv is null or t.driver_id = v_drv)
    order by t.updated_at desc limit v_limit;
end $$;

-- ---------------------------------------------------------------- 5. notifications: owners' mail must not reach drivers
create or replace function app_private.notify_user(p_user uuid, p_template text, p_title text, p_body text, p_url text, p_tone text default 'info', p_idem text default null)
returns integer language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_email text;
begin
  if p_user is null then return 0; end if;
  select email into v_email from auth.users where id = p_user;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user,'in_app',p_template, jsonb_build_object('title',p_title,'body',p_body,'tone',p_tone,'url',coalesce(p_url,'/')),'sent',now());
  exception when others then raise warning 'notify_user in_app failed: %', sqlerrm; end;
  if v_email is not null then
    begin
      perform app_private.sys_email(v_email, p_template, p_title,
        '<h2 style="margin:0 0 8px">' || p_title || '</h2><p style="line-height:1.6">' || p_body || '</p>'
        || case when p_url is not null then '<p style="margin:14px 0"><a href="https://loadboot.com' || p_url || '" style="background:#0883F7;color:#fff;padding:11px 18px;border-radius:9px;text-decoration:none;font-weight:700">Open in LoadBoot &rarr;</a></p>' else '' end,
        null, coalesce(p_idem, p_template || ':' || p_user::text || ':' || to_char(now(),'YYYYMMDDHH24MI')));
    exception when others then raise warning 'notify_user email failed: %', sqlerrm; end;
  end if;
  return 1;
end $$;
revoke all on function app_private.notify_user(uuid,text,text,text,text,text,text) from public, anon, authenticated;

-- notify_org: exclude driver members unless the template is trip/driver-facing (one anchor replaced, body otherwise unchanged).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='notify_org';
  if v_def not like '%member_role <> ''driver''%' then
    v_def := replace(v_def, 'where om.org_id = p_org and om.status=''active'' limit 5',
      'where om.org_id = p_org and om.status=''active'' and (om.member_role <> ''driver'' or p_template like ''trip.%'' or p_template like ''driver.%'') limit 5');
    if v_def not like '%member_role <> ''driver''%' then raise exception 'notify_org anchor not found'; end if;
    execute v_def;
  end if;
end $$;


-- ================================================================ PART B: RPCs
-- gate: denial logging cannot survive the RAISE (the aborted transaction rolls it back), so the client
-- reports denials through cc_driver_log_denial instead. Keep the gate itself minimal.
create or replace function app_private.driver_gate(p_org uuid)
returns void language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_rpc text; v_perm text; v_label text;
begin
  v_rpc := app_private.caller_rpc_name();
  select perm_key into v_perm from app_private.driver_rpc_policy where rpc_name = v_rpc;
  if v_perm is null or v_perm = 'deny' then
    raise exception 'This part of LoadBoot is for the account owner. Ask your carrier if you need it.' using errcode='42501', hint='DRIVER_DENIED:' || coalesce(v_rpc,'?');
  end if;
  if not app_private.driver_has_perm(p_org, v_perm) then
    select label into v_label from app_private.driver_permission_catalog where key = v_perm;
    raise exception 'Your carrier has not turned on "%" for you — ask the owner.', coalesce(v_label, v_perm) using errcode='42501', hint='DRIVER_DENIED:' || v_perm;
  end if;
end $$;

-- owner-or-manager check used by every owner-side RPC below
create or replace function app_private.require_carrier_owner()
returns uuid language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid;
begin
  select om.org_id into v_org from public.organization_memberships om join public.organizations o on o.id=om.org_id
   where om.user_id=auth.uid() and om.status='active' and o.kind='carrier' and om.member_role in ('owner','manager') order by om.created_at limit 1;
  if v_org is null then raise exception 'Only the account owner can manage driver access.' using errcode='42501'; end if;
  return v_org;
end $$;
revoke all on function app_private.require_carrier_owner() from public, anon, authenticated;

create or replace function app_private.driver_app_status(p_user uuid, p_org uuid, p_inv_status text, p_inv_exp timestamptz)
returns text language sql stable as $$
  select case
    when p_user is not null and exists (select 1 from public.organization_memberships om where om.org_id=p_org and om.user_id=p_user and om.status='suspended') then 'suspended'
    when p_user is not null and exists (select 1 from public.organization_memberships om where om.org_id=p_org and om.user_id=p_user and om.status='active') then 'joined'
    when p_inv_status = 'pending' and p_inv_exp < now() then 'expired'
    when p_inv_status = 'pending' then 'invited'
    when p_inv_status in ('expired','revoked') then p_inv_status
    else 'not_invited' end;
$$;

-- ---------------------------------------------------------------- catalog (static, any signed-in user)
create or replace function public.cc_driver_permission_catalog()
returns jsonb language sql stable security definer set search_path to 'app_private','public' as $$
  select jsonb_build_object(
    'catalog', (select coalesce(jsonb_agg(jsonb_build_object('key',key,'grp',grp,'grp_label',grp_label,'grp_why',grp_why,'label',label,'description',description,'kind',kind,'available',available) order by sort),'[]'::jsonb) from app_private.driver_permission_catalog),
    'presets', (select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'description',description,'perms',to_jsonb(perms)) order by sort),'[]'::jsonb) from app_private.driver_presets));
$$;

-- ---------------------------------------------------------------- owner: list drivers with app status
create or replace function public.cc_driver_access_list()
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid;
begin
  v_org := app_private.require_carrier_owner();
  return (
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.name), '[]'::jsonb) from (
      select d.id, d.name, d.phone, d.email, d.license_no, d.license_state, d.license_exp, d.medical_exp, coalesce(d.status,'active') status,
             d.user_id, d.preset, d.last_seen_at, d.location_on, d.app_platform, d.installed_app, d.device,
             (d.last_seen_at > now() - interval '3 minutes') as online,
             app_private.driver_app_status(d.user_id, v_org, inv.status, inv.expires_at) as app_status,
             case when inv.id is null then null else jsonb_build_object('id',inv.id,'status',inv.status,'created_at',inv.created_at,'expires_at',inv.expires_at,
               'last_sent_at',inv.last_sent_at,'resend_count',inv.resend_count,'sent_via',to_jsonb(inv.sent_via),'preset',inv.preset,'email',inv.email,'phone',inv.phone,
               'opened_at',inv.opened_at,'token',case when inv.status='pending' then inv.token end) end as invite,
             (select coalesce(jsonb_agg(g.perm_key order by g.perm_key),'[]'::jsonb) from app_private.driver_grants g where g.org_id=v_org and g.user_id=d.user_id) as perms,
             (select jsonb_build_object('id',t.id,'status',t.status,'origin',l.origin,'destination',l.destination,'truck_no',t.truck_no,'scheduled_pickup',t.scheduled_pickup)
                from app_private.trips t join public.loads l on l.id=t.load_id
               where t.driver_id=d.id and t.status not in ('delivered','cancelled','completed','invoiced','paid') order by t.updated_at desc limit 1) as current_trip,
             (select ft.unit_no from app_private.trips t join app_private.fleet_trucks ft on ft.id=t.truck_id where t.driver_id=d.id order by t.updated_at desc limit 1) as last_unit,
             (select count(*) from app_private.fleet_driver_docs fd where fd.fleet_driver_id=d.id and fd.status='pending') as docs_pending,
             (select count(*) from app_private.trips t where t.driver_id=d.id and t.created_at > now() - interval '30 days') as trips_30d
        from app_private.fleet_drivers d
        left join lateral (select * from app_private.carrier_driver_invites i where i.fleet_driver_id=d.id order by i.created_at desc limit 1) inv on true
       where d.carrier_id = v_org
    ) x);
end $$;

-- ---------------------------------------------------------------- invite v2
drop function if exists public.cc_carrier_invite_driver(uuid, text, text);
create or replace function public.cc_carrier_invite_driver(p_fleet_driver uuid, p_email text default null, p_phone text default null,
  p_perms text[] default null, p_preset text default 'driver', p_via text[] default '{email}')
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_name text; v_dremail text; v_email text; v_token text; v_id uuid; v_link text; v_org_name text; v_perms text[]; v_bad text; v_emailed boolean := false;
begin
  v_org := app_private.require_carrier_owner();
  if p_fleet_driver is null or not exists (select 1 from app_private.fleet_drivers d where d.id=p_fleet_driver and d.carrier_id=v_org) then
    raise exception 'driver record not found in your fleet' using errcode='42501'; end if;
  select name, email into v_name, v_dremail from app_private.fleet_drivers where id=p_fleet_driver;
  if exists (select 1 from app_private.fleet_drivers d join public.organization_memberships om on om.user_id=d.user_id and om.org_id=v_org where d.id=p_fleet_driver and om.status='active') then
    raise exception '% has already joined the app. Use Manage access instead.', coalesce(v_name,'This driver') using errcode='22023'; end if;
  select name into v_org_name from public.organizations where id=v_org;
  -- permissions: preset perms unless an explicit list was given; always validated against the catalog
  if p_perms is null then select perms into v_perms from app_private.driver_presets where key = coalesce(p_preset,'driver'); v_perms := coalesce(v_perms,'{}'); else v_perms := p_perms; end if;
  select string_agg(k, ', ') into v_bad from unnest(v_perms) k where not exists (select 1 from app_private.driver_permission_catalog c where c.key=k and c.kind='optional' and c.available);
  if v_bad is not null then raise exception 'unknown or unavailable permission: %', v_bad using errcode='22023'; end if;
  v_perms := (select coalesce(array_agg(distinct k order by k),'{}') from unnest(v_perms) k);
  v_email := nullif(lower(trim(coalesce(p_email, v_dremail, ''))), '');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.' using errcode='22023'; end if;
  if v_email is not null then update app_private.fleet_drivers set email = v_email, updated_at = now() where id = p_fleet_driver and (email is null or email = ''); end if;
  -- one live invite per driver
  update app_private.carrier_driver_invites set status='revoked', revoked_at=now(), revoked_by=auth.uid() where fleet_driver_id=p_fleet_driver and status='pending';
  v_token := encode(gen_random_bytes(18),'hex');
  insert into app_private.carrier_driver_invites(carrier_org, fleet_driver_id, email, phone, driver_name, token, created_by, perms, preset, sent_via, last_sent_at, expires_at)
    values (v_org, p_fleet_driver, v_email, nullif(trim(coalesce(p_phone,'')),''), v_name, v_token, auth.uid(), v_perms, coalesce(p_preset,'driver'), coalesce(p_via,'{}'), now(), now() + interval '14 days')
    returning id into v_id;
  update app_private.fleet_drivers set preset = coalesce(p_preset,'driver'), updated_at = now() where id = p_fleet_driver;
  v_link := 'https://loadboot.com/app/carrier/driver-invite.html?t=' || v_token;
  if v_email is not null and 'email' = any(coalesce(p_via,'{email}')) then
    begin
      perform app_private.sys_email(v_email, 'driver.invite',
        coalesce(v_org_name,'Your carrier') || ' invited you to drive on LoadBoot',
        app_private.driver_invite_email_html(coalesce(v_org_name,'Your carrier'), coalesce(v_name,'there'), v_link),
        'Hi ' || coalesce(v_name,'there') || E',\n\n' || coalesce(v_org_name,'Your carrier') || E' added you as a driver on LoadBoot. Open this link on your phone to set your password and join:\n' || v_link || E'\n\nYou will only see your own loads. Link expires in 14 days.',
        'drvinvite:' || v_id::text);
      v_emailed := true;
    exception when others then v_emailed := false; end;
  end if;
  perform app_private.driver_event(v_org, null, 'invite.sent', jsonb_build_object('fleet_driver',p_fleet_driver,'invite',v_id,'name',v_name,'preset',coalesce(p_preset,'driver')));
  perform app_private.log_audit('carrier.driver.invite','carrier_driver_invite',v_id::text,v_org,'driver invite created', jsonb_build_object('fleet_driver',p_fleet_driver,'emailed',v_emailed,'preset',p_preset,'perms',to_jsonb(v_perms),'via',to_jsonb(p_via)));
  return jsonb_build_object('ok',true,'invite',v_id,'token',v_token,'link',v_link,'emailed',v_emailed,'email',v_email,'expires_at',now() + interval '14 days','perms',to_jsonb(v_perms),'preset',coalesce(p_preset,'driver'));
end $$;

create or replace function app_private.driver_invite_email_html(p_org text, p_name text, p_link text)
returns text language sql immutable as $$
  select '<div style="font-family:Manrope,Segoe UI,Arial,sans-serif;color:#0f172a">'
   || '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0883F7;font-weight:800">You’re invited</div>'
   || '<h2 style="margin:6px 0 10px;font-size:22px;line-height:1.25">' || p_org || ' added you as a driver</h2>'
   || '<p style="color:#334155;font-size:14.5px;line-height:1.6;margin:0 0 16px">Hi ' || p_name || ', your phone becomes your truck’s tracker. You’ll see only your own loads — check in and out with GPS, upload the POD in one tap, and report detention or lumper with proof. No paperwork.</p>'
   || '<p style="margin:0 0 18px"><a href="' || p_link || '" style="display:inline-block;background:#FC5305;color:#fff;padding:13px 22px;border-radius:11px;text-decoration:none;font-weight:800;font-size:15px">Join ' || p_org || ' on LoadBoot &rarr;</a></p>'
   || '<div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:13px;color:#0f172a;line-height:1.7"><b>3 steps, about a minute</b><br>1 · Open the link on your phone and set a password<br>2 · Android: install the LoadBoot app from Google Play · iPhone: add LoadBoot to your Home Screen<br>3 · Allow Location and Notifications so dispatch can see your truck on active loads</div>'
   || '<p style="font-size:12px;color:#64748b;line-height:1.6;margin:16px 0 0">Or paste this link into your browser: ' || p_link || '<br>The link expires in 14 days and works for one driver login.</p>'
   || '</div>';
$$;

create or replace function public.cc_driver_invite_resend(p_invite uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; inv record; v_org_name text; v_link text; v_emailed boolean := false;
begin
  v_org := app_private.require_carrier_owner();
  select * into inv from app_private.carrier_driver_invites where id=p_invite and carrier_org=v_org for update;
  if inv.id is null then raise exception 'invite not found' using errcode='22023'; end if;
  if inv.status = 'accepted' then raise exception 'This driver already joined.' using errcode='22023'; end if;
  if inv.last_sent_at > now() - interval '2 minutes' then raise exception 'Just sent — give it a couple of minutes.' using errcode='22023'; end if;
  update app_private.carrier_driver_invites set status='pending', expires_at = now() + interval '14 days', last_sent_at=now(), resend_count=resend_count+1, revoked_at=null, revoked_by=null where id=inv.id;
  select name into v_org_name from public.organizations where id=v_org;
  v_link := 'https://loadboot.com/app/carrier/driver-invite.html?t=' || inv.token;
  if inv.email is not null then
    begin
      perform app_private.sys_email(inv.email, 'driver.invite', coalesce(v_org_name,'Your carrier') || ' invited you to drive on LoadBoot (reminder)',
        app_private.driver_invite_email_html(coalesce(v_org_name,'Your carrier'), coalesce(inv.driver_name,'there'), v_link), null, 'drvinvite:' || inv.id::text || ':' || (inv.resend_count+1));
      v_emailed := true;
    exception when others then v_emailed := false; end;
  end if;
  perform app_private.driver_event(v_org, null, 'invite.sent', jsonb_build_object('fleet_driver',inv.fleet_driver_id,'invite',inv.id,'resend',true));
  perform app_private.log_audit('carrier.driver.invite.resend','carrier_driver_invite',inv.id::text,v_org,'driver invite resent', jsonb_build_object('emailed',v_emailed));
  return jsonb_build_object('ok',true,'link',v_link,'emailed',v_emailed,'expires_at',now() + interval '14 days');
end $$;

create or replace function public.cc_driver_invite_revoke(p_invite uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; inv record;
begin
  v_org := app_private.require_carrier_owner();
  select * into inv from app_private.carrier_driver_invites where id=p_invite and carrier_org=v_org for update;
  if inv.id is null then raise exception 'invite not found' using errcode='22023'; end if;
  if inv.status <> 'pending' then raise exception 'invite is already %', inv.status using errcode='22023'; end if;
  update app_private.carrier_driver_invites set status='revoked', revoked_at=now(), revoked_by=auth.uid() where id=inv.id;
  perform app_private.driver_event(v_org, null, 'invite.revoked', jsonb_build_object('fleet_driver',inv.fleet_driver_id,'invite',inv.id));
  perform app_private.log_audit('carrier.driver.invite.revoke','carrier_driver_invite',inv.id::text,v_org,'driver invite revoked','{}'::jsonb);
  return jsonb_build_object('ok',true);
end $$;

-- public peek for the invite page (before sign-in): carrier name, driver name, platform rule. Token is the secret; nothing else leaks.
create or replace function public.cc_driver_invite_peek(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare inv record; v_org_name text; v_req boolean;
begin
  select * into inv from app_private.carrier_driver_invites where token = p_token;
  if inv.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  select name into v_org_name from public.organizations where id=inv.carrier_org;
  select coalesce(require_android_app,true) into v_req from app_private.driver_org_settings where org_id=inv.carrier_org;
  return jsonb_build_object('ok', inv.status='pending' and inv.expires_at > now(),
    'status', case when inv.status='pending' and inv.expires_at < now() then 'expired' else inv.status end,
    'carrier', v_org_name, 'driver_name', inv.driver_name, 'email', inv.email, 'preset', inv.preset,
    'require_android_app', coalesce(v_req,true), 'expires_at', inv.expires_at);
end $$;

-- ---------------------------------------------------------------- accept v2 (applies the owner's permissions, records platform, notifies owner)
drop function if exists public.cc_accept_driver_invite(text);
create or replace function public.cc_accept_driver_invite(p_token text, p_platform text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare inv record; v_owner uuid; v_org_name text; k text;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode='42501'; end if;
  select * into inv from app_private.carrier_driver_invites where token=p_token for update;
  if inv.id is null then raise exception 'invite not found' using errcode='22023'; end if;
  if inv.status <> 'pending' then raise exception 'invite is %', inv.status using errcode='22023'; end if;
  if inv.expires_at < now() then
    update app_private.carrier_driver_invites set status='expired' where id=inv.id;
    raise exception 'invite has expired — ask the carrier to resend' using errcode='22023';
  end if;
  -- an owner/manager of ANOTHER carrier cannot also be a driver here with the same login (would collapse the two accounts)
  if exists (select 1 from public.organization_memberships om join public.organizations o on o.id=om.org_id where om.user_id=auth.uid() and om.status='active' and o.kind='carrier' and om.member_role in ('owner','manager')) then
    raise exception 'This login is a carrier owner/manager account — it cannot become a driver login. Open the invite link in a private window and create the driver''s own account with their email.' using errcode='22023';
  end if;
  if exists (select 1 from public.organization_memberships where org_id=inv.carrier_org and user_id=auth.uid()) then
    update public.organization_memberships set member_role='driver', status='active', updated_at=now() where org_id=inv.carrier_org and user_id=auth.uid();
  else
    insert into public.organization_memberships(org_id, user_id, member_role, status) values (inv.carrier_org, auth.uid(), 'driver', 'active');
  end if;
  if inv.fleet_driver_id is not null then
    update app_private.fleet_drivers set user_id=null where carrier_id=inv.carrier_org and user_id=auth.uid() and id<>inv.fleet_driver_id;
    update app_private.fleet_drivers set user_id=auth.uid(), preset=coalesce(inv.preset,preset,'driver'), app_platform=coalesce(p_platform,app_platform), last_seen_at=now(), updated_at=now() where id=inv.fleet_driver_id;
  end if;
  delete from app_private.driver_grants where org_id=inv.carrier_org and user_id=auth.uid();
  foreach k in array coalesce(inv.perms,'{}') loop
    insert into app_private.driver_grants(org_id,user_id,perm_key,granted_by) values (inv.carrier_org, auth.uid(), k, inv.created_by) on conflict do nothing;
  end loop;
  update app_private.carrier_driver_invites set status='accepted', accepted_by=auth.uid(), accepted_at=now(), install_platform=p_platform where id=inv.id;
  select name into v_org_name from public.organizations where id=inv.carrier_org;
  select user_id into v_owner from public.organization_memberships where org_id=inv.carrier_org and member_role='owner' and status='active' order by created_at limit 1;
  perform app_private.driver_event(inv.carrier_org, null, 'driver.joined', jsonb_build_object('fleet_driver',inv.fleet_driver_id,'user',auth.uid(),'name',inv.driver_name,'platform',p_platform));
  begin
    perform app_private.notify_user(v_owner, 'driver.joined', coalesce(inv.driver_name,'Your driver') || ' joined the LoadBoot app',
      coalesce(inv.driver_name,'Your driver') || ' set up their login and is on the app with the "' || coalesce((select label from app_private.driver_presets where key=inv.preset),'Driver only') || '" preset. Assign a truck so their loads and tracking start.',
      '/app/carrier/#fleet/driver/' || coalesce(inv.fleet_driver_id::text,''), 'success', 'driver.joined:' || inv.id::text);
  exception when others then null; end;
  perform app_private.log_audit('carrier.driver.invite.accept','carrier_driver_invite',inv.id::text,inv.carrier_org,'driver joined', jsonb_build_object('user',auth.uid(),'platform',p_platform,'perms',to_jsonb(inv.perms)));
  return jsonb_build_object('ok',true,'carrier_org',inv.carrier_org,'carrier',v_org_name,'fleet_driver',inv.fleet_driver_id,'perms',to_jsonb(inv.perms));
end $$;

-- ---------------------------------------------------------------- owner: grants / status / settings / docs review
create or replace function public.cc_driver_grants_get(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid;
begin
  v_org := app_private.require_carrier_owner();
  if not exists (select 1 from public.organization_memberships where org_id=v_org and user_id=p_user and member_role='driver') then raise exception 'driver not found in your account' using errcode='42501'; end if;
  return jsonb_build_object('perms', (select coalesce(jsonb_agg(perm_key order by perm_key),'[]'::jsonb) from app_private.driver_grants where org_id=v_org and user_id=p_user),
    'preset', (select preset from app_private.fleet_drivers where carrier_id=v_org and user_id=p_user limit 1),
    'status', (select status from public.organization_memberships where org_id=v_org and user_id=p_user));
end $$;

create or replace function public.cc_driver_grants_set(p_user uuid, p_perms text[], p_preset text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_before text[]; v_after text[]; v_bad text; v_added text[]; v_removed text[]; v_name text; v_fd uuid;
begin
  v_org := app_private.require_carrier_owner();
  if not exists (select 1 from public.organization_memberships where org_id=v_org and user_id=p_user and member_role='driver') then raise exception 'driver not found in your account' using errcode='42501'; end if;
  select string_agg(k, ', ') into v_bad from unnest(coalesce(p_perms,'{}')) k where not exists (select 1 from app_private.driver_permission_catalog c where c.key=k and c.kind='optional' and c.available);
  if v_bad is not null then raise exception 'unknown or unavailable permission: %', v_bad using errcode='22023'; end if;
  select coalesce(array_agg(perm_key order by perm_key),'{}') into v_before from app_private.driver_grants where org_id=v_org and user_id=p_user;
  v_after := (select coalesce(array_agg(distinct k order by k),'{}') from unnest(coalesce(p_perms,'{}')) k);
  delete from app_private.driver_grants where org_id=v_org and user_id=p_user and not (perm_key = any(v_after));
  insert into app_private.driver_grants(org_id,user_id,perm_key,granted_by) select v_org, p_user, k, auth.uid() from unnest(v_after) k on conflict do nothing;
  select id, name into v_fd, v_name from app_private.fleet_drivers where carrier_id=v_org and user_id=p_user limit 1;
  if p_preset is not null then update app_private.fleet_drivers set preset=p_preset, updated_at=now() where id=v_fd; end if;
  v_added := (select coalesce(array_agg(k),'{}') from unnest(v_after) k where not (k = any(v_before)));
  v_removed := (select coalesce(array_agg(k),'{}') from unnest(v_before) k where not (k = any(v_after)));
  perform app_private.driver_event(v_org, p_user, 'grants.changed', jsonb_build_object('perms',to_jsonb(v_after),'added',to_jsonb(v_added),'removed',to_jsonb(v_removed),'preset',p_preset,'fleet_driver',v_fd));
  perform app_private.driver_event(v_org, null, 'grants.changed', jsonb_build_object('fleet_driver',v_fd,'user',p_user,'count',cardinality(v_after)));
  if cardinality(v_added) + cardinality(v_removed) > 0 then
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (p_user,'in_app','driver.access_changed', jsonb_build_object('title','Your access was updated','body',
        case when cardinality(v_added) > 0 then 'Turned on: ' || (select string_agg(c.label, ', ') from app_private.driver_permission_catalog c where c.key = any(v_added)) else '' end
        || case when cardinality(v_added) > 0 and cardinality(v_removed) > 0 then ' · ' else '' end
        || case when cardinality(v_removed) > 0 then 'Turned off: ' || (select string_agg(c.label, ', ') from app_private.driver_permission_catalog c where c.key = any(v_removed)) else '' end,
        'tone','info','url','/app/carrier/#dashboard'),'sent',now());
    exception when others then null; end;
  end if;
  perform app_private.log_audit('carrier.driver.perms.set','organization_membership',p_user::text,v_org,'driver permissions changed', jsonb_build_object('before',to_jsonb(v_before),'after',to_jsonb(v_after),'added',to_jsonb(v_added),'removed',to_jsonb(v_removed),'preset',p_preset));
  return jsonb_build_object('ok',true,'perms',to_jsonb(v_after),'added',to_jsonb(v_added),'removed',to_jsonb(v_removed));
end $$;

create or replace function public.cc_driver_set_status(p_user uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_fd uuid; v_name text;
begin
  v_org := app_private.require_carrier_owner();
  if p_user = auth.uid() then raise exception 'you cannot change your own membership' using errcode='22023'; end if;
  if not exists (select 1 from public.organization_memberships where org_id=v_org and user_id=p_user and member_role='driver') then raise exception 'driver not found in your account' using errcode='42501'; end if;
  if p_status not in ('active','suspended','removed') then raise exception 'status must be active, suspended or removed' using errcode='22023'; end if;
  select id, name into v_fd, v_name from app_private.fleet_drivers where carrier_id=v_org and user_id=p_user limit 1;
  if p_status = 'removed' then
    delete from app_private.driver_grants where org_id=v_org and user_id=p_user;
    delete from public.organization_memberships where org_id=v_org and user_id=p_user and member_role='driver';
    update app_private.fleet_drivers set user_id=null, location_on=false, installed_app=false, updated_at=now() where id=v_fd;
    update app_private.carrier_driver_invites set status='revoked', revoked_at=now(), revoked_by=auth.uid() where fleet_driver_id=v_fd and status='pending';
  else
    update public.organization_memberships set status=p_status, updated_at=now() where org_id=v_org and user_id=p_user;
    if p_status='suspended' then update app_private.fleet_drivers set location_on=false where id=v_fd; end if;
  end if;
  perform app_private.driver_event(v_org, p_user, 'driver.' || p_status, jsonb_build_object('fleet_driver',v_fd,'name',v_name));
  perform app_private.driver_event(v_org, null, 'driver.' || p_status, jsonb_build_object('fleet_driver',v_fd,'name',v_name,'user',p_user));
  perform app_private.log_audit('carrier.driver.status','organization_membership',p_user::text,v_org,'driver ' || p_status, jsonb_build_object('fleet_driver',v_fd));
  return jsonb_build_object('ok',true,'status',p_status);
end $$;

create or replace function public.cc_driver_org_settings(p_require_android_app boolean default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_req boolean;
begin
  v_org := app_private.require_carrier_owner();
  if p_require_android_app is not null then
    insert into app_private.driver_org_settings(org_id, require_android_app, updated_at) values (v_org, p_require_android_app, now())
    on conflict (org_id) do update set require_android_app=excluded.require_android_app, updated_at=now();
    perform app_private.log_audit('carrier.driver.settings','organization',v_org::text,v_org,'require_android_app=' || p_require_android_app::text,'{}'::jsonb);
  end if;
  select coalesce(require_android_app,true) into v_req from app_private.driver_org_settings where org_id=v_org;
  return jsonb_build_object('require_android_app', coalesce(v_req,true));
end $$;

create or replace function public.cc_driver_docs_for_owner(p_fleet_driver uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid;
begin
  v_org := app_private.require_carrier_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('id',fd.id,'fleet_driver_id',fd.fleet_driver_id,'driver',d.name,'kind',fd.kind,'path',fd.path,'file_name',fd.file_name,
      'content_type',fd.content_type,'size',fd.size,'expires_on',fd.expires_on,'status',fd.status,'note',fd.note,'created_at',fd.created_at,'reviewed_at',fd.reviewed_at) order by fd.created_at desc),'[]'::jsonb)
    from app_private.fleet_driver_docs fd join app_private.fleet_drivers d on d.id=fd.fleet_driver_id
    where fd.carrier_id=v_org and (p_fleet_driver is null or fd.fleet_driver_id=p_fleet_driver));
end $$;

create or replace function public.cc_driver_doc_review(p_doc uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; fd record;
begin
  v_org := app_private.require_carrier_owner();
  if p_status not in ('approved','rejected') then raise exception 'status must be approved or rejected' using errcode='22023'; end if;
  select * into fd from app_private.fleet_driver_docs where id=p_doc and carrier_id=v_org for update;
  if fd.id is null then raise exception 'document not found' using errcode='22023'; end if;
  update app_private.fleet_driver_docs set status=p_status, note=p_note, reviewed_by=auth.uid(), reviewed_at=now() where id=fd.id;
  if p_status='approved' and fd.expires_on is not null then
    if fd.kind='cdl' then update app_private.fleet_drivers set license_exp=fd.expires_on, updated_at=now() where id=fd.fleet_driver_id;
    elsif fd.kind='medical' then update app_private.fleet_drivers set medical_exp=fd.expires_on, updated_at=now() where id=fd.fleet_driver_id; end if;
  end if;
  perform app_private.driver_event(v_org, (select user_id from app_private.fleet_drivers where id=fd.fleet_driver_id), 'doc.reviewed', jsonb_build_object('doc',fd.id,'kind',fd.kind,'status',p_status,'note',p_note));
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    select d.user_id,'in_app','driver.doc_reviewed', jsonb_build_object('title', case fd.kind when 'cdl' then 'CDL' when 'medical' then 'Medical card' else 'Document' end || ' ' || p_status,
      'body', coalesce(p_note, case when p_status='approved' then 'Your carrier approved it.' else 'Your carrier asked for a new upload.' end), 'tone', case when p_status='approved' then 'success' else 'warning' end, 'url','/app/carrier/#account'),'sent',now()
    from app_private.fleet_drivers d where d.id=fd.fleet_driver_id and d.user_id is not null;
  exception when others then null; end;
  perform app_private.log_audit('carrier.driver.doc.review','fleet_driver_doc',fd.id::text,v_org,fd.kind || ' ' || p_status, jsonb_build_object('note',p_note));
  return jsonb_build_object('ok',true,'status',p_status);
end $$;

-- ---------------------------------------------------------------- driver side
-- Not gated (user-scoped by construction). Works for suspended drivers too so the app can show "access paused".
create or replace function public.cc_my_driver_context()
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare m record; d record; v_req boolean; v_perms text[]; v_trip jsonb;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode='42501'; end if;
  select om.org_id, om.member_role, om.status, o.name org_name, o.status org_status, o.mc_number, o.dot_number
    into m from public.organization_memberships om join public.organizations o on o.id=om.org_id
   where om.user_id=auth.uid() and o.kind='carrier' and om.status in ('active','suspended') order by (om.status='active') desc, om.created_at limit 1;
  if m.org_id is null or m.member_role <> 'driver' then return jsonb_build_object('role', coalesce(m.member_role,'none')); end if;
  select * into d from app_private.fleet_drivers where carrier_id=m.org_id and user_id=auth.uid() limit 1;
  select coalesce(require_android_app,true) into v_req from app_private.driver_org_settings where org_id=m.org_id;
  v_perms := (select array_agg(key order by sort) from app_private.driver_permission_catalog where kind='core')
          || (select coalesce(array_agg(g.perm_key),'{}') from app_private.driver_grants g where g.org_id=m.org_id and g.user_id=auth.uid());
  if d.id is not null then
    select jsonb_build_object('id',t.id,'status',t.status,'origin',l.origin,'destination',l.destination,'truck_no',t.truck_no,'scheduled_pickup',t.scheduled_pickup,'scheduled_delivery',t.scheduled_delivery)
      into v_trip from app_private.trips t join public.loads l on l.id=t.load_id
     where t.driver_id=d.id and t.status not in ('delivered','cancelled','completed','invoiced','paid') order by t.updated_at desc limit 1;
  end if;
  return jsonb_build_object('role','driver','org_id',m.org_id,'carrier',m.org_name,'carrier_status',m.org_status,'carrier_mc',m.mc_number,'carrier_dot',m.dot_number,
    'carrier_verified', (m.org_status = 'active' and exists (select 1 from app_private.carrier_onboarding co where co.carrier_id = m.org_id and co.decided_at is not null)),
    'membership_status',m.status,'require_android_app',coalesce(v_req,true),
    'fleet_driver', case when d.id is null then null else jsonb_build_object('id',d.id,'name',d.name,'phone',d.phone,'email',d.email,'license_no',d.license_no,'license_state',d.license_state,'license_exp',d.license_exp,'medical_exp',d.medical_exp,'preset',d.preset,'location_on',d.location_on,'installed_app',d.installed_app,'app_platform',d.app_platform) end,
    'perms', to_jsonb(v_perms), 'current_trip', v_trip,
    'docs_pending', (select count(*) from app_private.fleet_driver_docs fd where fd.fleet_driver_id=d.id and fd.status='pending'),
    'catalog', public.cc_driver_permission_catalog());
end $$;

create or replace function public.cc_driver_heartbeat(p_platform text default null, p_standalone boolean default null, p_device jsonb default null, p_location_on boolean default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; d record; v_was_online boolean; v_loc_changed boolean;
begin
  select om.org_id into v_org from public.organization_memberships om join public.organizations o on o.id=om.org_id
   where om.user_id=auth.uid() and om.status='active' and om.member_role='driver' and o.kind='carrier' order by om.created_at limit 1;
  if v_org is null then return jsonb_build_object('ok',false); end if;
  select * into d from app_private.fleet_drivers where carrier_id=v_org and user_id=auth.uid() limit 1 for update;
  if d.id is null then return jsonb_build_object('ok',false); end if;
  v_was_online := d.last_seen_at > now() - interval '3 minutes';
  v_loc_changed := p_location_on is not null and p_location_on is distinct from d.location_on;
  update app_private.fleet_drivers set last_seen_at=now(), app_platform=coalesce(p_platform,app_platform),
    installed_app = coalesce(p_standalone, installed_app), device = coalesce(p_device, device),
    location_on = coalesce(p_location_on, location_on), updated_at=now() where id=d.id;
  if not coalesce(v_was_online,false) then perform app_private.driver_event(v_org, null, 'driver.online', jsonb_build_object('fleet_driver',d.id,'name',d.name,'platform',p_platform)); end if;
  if v_loc_changed then perform app_private.driver_event(v_org, null, 'driver.location', jsonb_build_object('fleet_driver',d.id,'name',d.name,'on',p_location_on)); end if;
  return jsonb_build_object('ok',true,'fleet_driver',d.id);
end $$;

create or replace function public.cc_driver_log_denial(p_rpc text, p_perm text default null)
returns void language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid;
begin
  select om.org_id into v_org from public.organization_memberships om where om.user_id=auth.uid() and om.member_role='driver' order by om.created_at limit 1;
  if v_org is null then return; end if;
  if (select count(*) from app_private.driver_denials where user_id=auth.uid() and created_at > now() - interval '1 minute') > 30 then return; end if;
  insert into app_private.driver_denials(org_id, user_id, rpc_name, perm_key) values (v_org, auth.uid(), left(coalesce(p_rpc,'?'),80), left(coalesce(p_perm,'none'),80));
end $$;

create or replace function public.cc_driver_update_my_profile(p_phone text default null, p_avatar_path text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_fd uuid;
begin
  v_org := app_private.my_carrier_org();
  v_fd := app_private.my_fleet_driver(v_org);
  if v_fd is null then raise exception 'no driver record linked to your login' using errcode='42501'; end if;
  if p_phone is not null then update app_private.fleet_drivers set phone=nullif(trim(p_phone),''), updated_at=now() where id=v_fd; update public.profiles set phone=nullif(trim(p_phone),'') where id=auth.uid(); end if;
  if p_avatar_path is not null then update public.profiles set avatar_path=p_avatar_path where id=auth.uid(); end if;
  perform app_private.log_audit('carrier.driver.profile','fleet_driver',v_fd::text,v_org,'driver updated own profile','{}'::jsonb);
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.cc_driver_my_docs()
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_fd uuid;
begin
  v_org := app_private.my_carrier_org(); v_fd := app_private.my_fleet_driver(v_org);
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'path',path,'file_name',file_name,'expires_on',expires_on,'status',status,'note',note,'created_at',created_at,'reviewed_at',reviewed_at) order by created_at desc),'[]'::jsonb)
          from app_private.fleet_driver_docs where fleet_driver_id=v_fd);
end $$;

create or replace function public.cc_driver_doc_upload(p_kind text, p_path text, p_file_name text default null, p_content_type text default null, p_size bigint default null, p_expires_on date default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_fd uuid; v_id uuid; v_owner uuid; v_name text;
begin
  v_org := app_private.my_carrier_org(); v_fd := app_private.my_fleet_driver(v_org);
  if v_fd is null then raise exception 'no driver record linked to your login' using errcode='42501'; end if;
  if p_kind not in ('cdl','medical','other') then raise exception 'kind must be cdl, medical or other' using errcode='22023'; end if;
  if p_path is null or split_part(p_path,'/',1) <> auth.uid()::text then raise exception 'upload path must be under your own folder' using errcode='22023'; end if;
  insert into app_private.fleet_driver_docs(carrier_id, fleet_driver_id, kind, path, file_name, content_type, size, expires_on, uploaded_by)
    values (v_org, v_fd, p_kind, p_path, p_file_name, p_content_type, p_size, p_expires_on, auth.uid()) returning id into v_id;
  select name into v_name from app_private.fleet_drivers where id=v_fd;
  select user_id into v_owner from public.organization_memberships where org_id=v_org and member_role='owner' and status='active' order by created_at limit 1;
  perform app_private.driver_event(v_org, null, 'doc.uploaded', jsonb_build_object('fleet_driver',v_fd,'doc',v_id,'kind',p_kind,'name',v_name));
  begin
    perform app_private.notify_user(v_owner, 'driver.doc_uploaded', coalesce(v_name,'Your driver') || ' uploaded a ' || case p_kind when 'cdl' then 'CDL' when 'medical' then 'medical card' else 'document' end,
      'Review it under Fleet → ' || coalesce(v_name,'driver') || ' → Documents. Approving a CDL or medical card updates the expiry reminders automatically.',
      '/app/carrier/#fleet/driver/' || v_fd::text || '/docs', 'info', 'driver.doc:' || v_id::text);
  exception when others then null; end;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.cc_driver_my_earnings(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_fd uuid; v_rates boolean;
begin
  v_org := app_private.my_carrier_org(); v_fd := app_private.my_fleet_driver(v_org);
  v_rates := app_private.driver_has_perm(v_org, 'loads.see_rates');
  return (select jsonb_build_object('days', p_days, 'rates_visible', v_rates,
    'trips', count(*), 'delivered', count(*) filter (where t.status in ('delivered','completed','invoiced','paid')),
    'miles', coalesce(sum(t.miles),0), 'gross', case when v_rates then coalesce(sum(t.rate),0) else null end,
    'note', 'Gross is the load rate — your pay depends on your agreement with the carrier.',
    'rows', coalesce(jsonb_agg(jsonb_build_object('id',t.id,'origin',l.origin,'destination',l.destination,'status',t.status,'delivered_at',t.delivered_at,'miles',t.miles,'rate',case when v_rates then t.rate end) order by t.updated_at desc),'[]'::jsonb))
    from app_private.trips t join public.loads l on l.id=t.load_id
    where t.carrier_id=v_org and t.driver_id=v_fd and t.created_at > now() - make_interval(days => least(greatest(coalesce(p_days,30),1),365)));
end $$;

-- best effort: payroll rows are keyed by employee_name (no driver id column today) — matched on the driver's name.
create or replace function public.cc_driver_my_settlements()
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid; v_fd uuid; v_name text;
begin
  v_org := app_private.my_carrier_org(); v_fd := app_private.my_fleet_driver(v_org);
  select name into v_name from app_private.fleet_drivers where id=v_fd;
  return jsonb_build_object('matched_on','employee_name','rows',
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'period_start',period_start,'period_end',period_end,'pay_type',pay_type,'amount',amount,'paid',paid,'paid_at',paid_at) order by period_end desc),'[]'::jsonb)
       from app_private.carrier_payroll where carrier_id=v_org and v_name is not null and lower(trim(employee_name)) = lower(trim(v_name)) and paid = true));
end $$;

-- ---------------------------------------------------------------- CC (staff)
create or replace function public.cc_carrier_driver_access(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_org uuid;
begin
  if not public.has_global_permission('carriers.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select id into v_org from public.organizations where kind='carrier' and (id=p_org or owner_user_id=p_org) limit 1;
  if v_org is null then raise exception 'carrier not found' using errcode='22023'; end if;
  return jsonb_build_object(
    'drivers', (select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.name),'[]'::jsonb) from (
      select d.id, d.name, d.phone, d.email, d.user_id, d.preset, d.last_seen_at, (d.last_seen_at > now() - interval '3 minutes') online, d.location_on, d.app_platform, d.installed_app, d.device,
             d.license_exp, d.medical_exp,
             app_private.driver_app_status(d.user_id, v_org, inv.status, inv.expires_at) app_status,
             inv.expires_at invite_expires_at, inv.last_sent_at invite_last_sent_at, inv.resend_count, inv.sent_via, inv.id invite_id,
             (select count(*) from app_private.driver_grants g where g.org_id=v_org and g.user_id=d.user_id) perms_count,
             (select coalesce(jsonb_agg(g.perm_key order by g.perm_key),'[]'::jsonb) from app_private.driver_grants g where g.org_id=v_org and g.user_id=d.user_id) perms,
             (select ft.unit_no from app_private.trips t join app_private.fleet_trucks ft on ft.id=t.truck_id where t.driver_id=d.id order by t.updated_at desc limit 1) last_unit,
             (select jsonb_build_object('id',t.id,'status',t.status,'origin',l.origin,'destination',l.destination) from app_private.trips t join public.loads l on l.id=t.load_id where t.driver_id=d.id and t.status not in ('delivered','cancelled','completed','invoiced','paid') order by t.updated_at desc limit 1) current_trip,
             (select count(*) from app_private.trips t where t.driver_id=d.id and t.created_at > now() - interval '30 days') trips_30d,
             (select count(*) from app_private.trips t where t.driver_id=d.id and t.created_at > now() - interval '30 days' and t.delivered_at > t.scheduled_delivery) late_30d,
             (select count(*) from app_private.fleet_driver_docs fd where fd.fleet_driver_id=d.id and fd.status='pending') docs_pending,
             (select count(*) from app_private.driver_denials dn where dn.user_id=d.user_id and dn.created_at > now() - interval '7 days') denials_7d
        from app_private.fleet_drivers d
        left join lateral (select * from app_private.carrier_driver_invites i where i.fleet_driver_id=d.id order by i.created_at desc limit 1) inv on true
       where d.carrier_id=v_org) x),
    'untracked_trucks', (select coalesce(jsonb_agg(jsonb_build_object('id',ft.id,'unit_no',ft.unit_no,'equipment',ft.equipment)),'[]'::jsonb)
        from app_private.fleet_trucks ft where ft.carrier_id=v_org and coalesce(ft.status,'active')='active'
         and not exists (select 1 from app_private.trips t join app_private.fleet_drivers d on d.id=t.driver_id where t.truck_id=ft.id and d.user_id is not null and t.updated_at > now() - interval '60 days')),
    'denials', (select coalesce(jsonb_agg(jsonb_build_object('user',dn.user_id,'driver',(select name from app_private.fleet_drivers where user_id=dn.user_id and carrier_id=v_org limit 1),'rpc',dn.rpc_name,'perm',dn.perm_key,'at',dn.created_at) order by dn.id desc),'[]'::jsonb)
        from (select * from app_private.driver_denials where org_id=v_org order by id desc limit 25) dn),
    'settings', (select jsonb_build_object('require_android_app', coalesce(require_android_app,true)) from app_private.driver_org_settings where org_id=v_org),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'payload',e.payload,'at',e.created_at) order by e.id desc),'[]'::jsonb)
        from (select * from public.driver_access_events where org_id=v_org order by id desc limit 30) e));
end $$;

create or replace function public.cc_driver_adoption_kpis()
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
begin
  if not public.has_global_permission('carriers.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'drivers_total', (select count(*) from app_private.fleet_drivers d join public.organizations o on o.id=d.carrier_id where not coalesce(o.is_demo,false)),
    'drivers_joined', (select count(*) from app_private.fleet_drivers d join public.organizations o on o.id=d.carrier_id where d.user_id is not null and not coalesce(o.is_demo,false)),
    'drivers_online_now', (select count(*) from app_private.fleet_drivers d join public.organizations o on o.id=d.carrier_id where d.last_seen_at > now() - interval '3 minutes' and not coalesce(o.is_demo,false)),
    'invites_pending', (select count(*) from app_private.carrier_driver_invites where status='pending' and expires_at > now()),
    'invites_expiring_3d', (select count(*) from app_private.carrier_driver_invites where status='pending' and expires_at between now() and now() + interval '3 days'),
    'joined_7d', (select count(*) from app_private.carrier_driver_invites where status='accepted' and accepted_at > now() - interval '7 days'),
    'median_join_hours', (select round((extract(epoch from percentile_cont(0.5) within group (order by accepted_at - created_at))/3600.0)::numeric, 1) from app_private.carrier_driver_invites where status='accepted' and accepted_at > now() - interval '90 days'),
    'carriers_with_untracked_trucks', (select count(distinct ft.carrier_id) from app_private.fleet_trucks ft join public.organizations o on o.id=ft.carrier_id
        where coalesce(ft.status,'active')='active' and not coalesce(o.is_demo,false)
          and not exists (select 1 from app_private.fleet_drivers d where d.carrier_id=ft.carrier_id and d.user_id is not null)),
    'suspended', (select count(*) from public.organization_memberships where member_role='driver' and status='suspended'),
    'location_off_active_trip', (select count(*) from app_private.trips t join app_private.fleet_drivers d on d.id=t.driver_id
        where t.status in ('in_transit','dispatched','at_pickup','loaded','en_route') and d.user_id is not null and d.location_on=false),
    'top_untracked', (select coalesce(jsonb_agg(jsonb_build_object('org_id',o.id,'carrier',o.name,'trucks',c.n) order by c.n desc),'[]'::jsonb) from (
        select ft.carrier_id, count(*) n from app_private.fleet_trucks ft where coalesce(ft.status,'active')='active'
          and not exists (select 1 from app_private.fleet_drivers d where d.carrier_id=ft.carrier_id and d.user_id is not null) group by ft.carrier_id order by n desc limit 15) c
        join public.organizations o on o.id=c.carrier_id where not coalesce(o.is_demo,false)));
end $$;

-- ---------------------------------------------------------------- storage: owners/managers may read files their drivers uploaded
create or replace function public.driver_doc_can_read(p_name text)
returns boolean language sql stable security definer set search_path to 'app_private','public' as $$
  select exists (
    select 1 from public.organization_memberships me
    join public.organization_memberships drv on drv.org_id = me.org_id and drv.member_role = 'driver'
    where me.user_id = auth.uid() and me.status = 'active' and me.member_role in ('owner','manager')
      and split_part(p_name, '/', 1) = drv.user_id::text);
$$;
revoke all on function public.driver_doc_can_read(text) from public, anon;
grant execute on function public.driver_doc_can_read(text) to authenticated;
drop policy if exists doc_read_driver_uploads_by_owner on storage.objects;
create policy doc_read_driver_uploads_by_owner on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.driver_doc_can_read(name));

-- ---------------------------------------------------------------- grants: authenticated only, never anon
revoke all on function
  public.cc_driver_permission_catalog(), public.cc_driver_access_list(), public.cc_carrier_invite_driver(uuid,text,text,text[],text,text[]),
  public.cc_driver_invite_resend(uuid), public.cc_driver_invite_revoke(uuid), public.cc_driver_invite_peek(text), public.cc_accept_driver_invite(text,text),
  public.cc_driver_grants_get(uuid), public.cc_driver_grants_set(uuid,text[],text), public.cc_driver_set_status(uuid,text), public.cc_driver_org_settings(boolean),
  public.cc_driver_docs_for_owner(uuid), public.cc_driver_doc_review(uuid,text,text), public.cc_my_driver_context(), public.cc_driver_heartbeat(text,boolean,jsonb,boolean),
  public.cc_driver_log_denial(text,text), public.cc_driver_update_my_profile(text,text), public.cc_driver_my_docs(), public.cc_driver_doc_upload(text,text,text,text,bigint,date),
  public.cc_driver_my_earnings(integer), public.cc_driver_my_settlements(), public.cc_carrier_driver_access(uuid), public.cc_driver_adoption_kpis()
from public, anon;
grant execute on function
  public.cc_driver_permission_catalog(), public.cc_driver_access_list(), public.cc_carrier_invite_driver(uuid,text,text,text[],text,text[]),
  public.cc_driver_invite_resend(uuid), public.cc_driver_invite_revoke(uuid), public.cc_driver_invite_peek(text), public.cc_accept_driver_invite(text,text),
  public.cc_driver_grants_get(uuid), public.cc_driver_grants_set(uuid,text[],text), public.cc_driver_set_status(uuid,text), public.cc_driver_org_settings(boolean),
  public.cc_driver_docs_for_owner(uuid), public.cc_driver_doc_review(uuid,text,text), public.cc_my_driver_context(), public.cc_driver_heartbeat(text,boolean,jsonb,boolean),
  public.cc_driver_log_denial(text,text), public.cc_driver_update_my_profile(text,text), public.cc_driver_my_docs(), public.cc_driver_doc_upload(text,text,text,text,bigint,date),
  public.cc_driver_my_earnings(integer), public.cc_driver_my_settlements(), public.cc_carrier_driver_access(uuid), public.cc_driver_adoption_kpis()
to authenticated;
revoke all on function app_private.driver_invite_email_html(text,text,text), app_private.driver_app_status(uuid,uuid,text,timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- c. gen_random_bytes lives in the extensions schema (pre-existing bug: "Invite to app" never produced a link)
do $$ declare v_def text; begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='cc_carrier_invite_driver';
  if v_def like '%encode(gen_random_bytes(18)%' then execute replace(v_def, 'encode(gen_random_bytes(18)', 'encode(extensions.gen_random_bytes(18)'); end if;
end $$;

-- ---------------------------------------------------------------- d. RLS policy subqueries run as the querying role; use a definer helper
create or replace function public.driver_event_visible(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to 'app_private','public' as $$
  select exists (select 1 from public.organization_memberships om
    where om.org_id = p_org and om.user_id = auth.uid() and om.status = 'active'
      and (om.member_role in ('owner','manager') or p_user is null or p_user = auth.uid()));
$$;
revoke all on function public.driver_event_visible(uuid,uuid) from public, anon;
grant execute on function public.driver_event_visible(uuid,uuid) to authenticated;
drop policy if exists dae_select on public.driver_access_events;
create policy dae_select on public.driver_access_events for select to authenticated using (public.driver_event_visible(org_id, user_id));

-- ---------------------------------------------------------------- e. second authorization path (can_touch_trip) gated too
create or replace function app_private.can_touch_trip(p_trip uuid)
returns boolean language plpgsql stable set search_path to 'app_private','public' as $$
declare v_org uuid; v_role text;
begin
  if public.has_global_permission('dispatch.manage') then return true; end if;
  select t.carrier_id, om.member_role into v_org, v_role
    from app_private.trips t
    join public.organization_memberships om on om.org_id = t.carrier_id and om.user_id = auth.uid() and om.status = 'active'
   where t.id = p_trip limit 1;
  if v_org is not null then
    if v_role = 'driver' then
      perform app_private.driver_gate(v_org);
      return exists (select 1 from app_private.trips t where t.id = p_trip and t.driver_id is not null and t.driver_id = app_private.my_fleet_driver_id());
    end if;
    return true;
  end if;
  return exists (
    select 1 from app_private.trips t
    join app_private.dispatcher_assignments a on a.carrier_org_id = t.carrier_id
    where t.id = p_trip and a.dispatcher_user_id = auth.uid() and a.status = 'active'
      and a.carrier_org_id::text = nullif(current_setting('app.dispatch_as', true), ''));
end $$;

insert into app_private.driver_rpc_policy(rpc_name, perm_key) values
 ('cc_trip_arrive','trips.checkin'),('cc_trip_arrive_gps','trips.checkin'),('cc_trip_depart','trips.checkin'),('cc_trip_pickup_status','trips.checkin'),
 ('cc_trip_stops_progress','trips.checkin'),('cc_trip_set_stop_coords','trips.checkin'),
 ('cc_pocket_upload_trip_doc','trips.pod_upload'),
 ('cc_trip_accessorials','trips.report_issue'),('cc_carrier_request_accessorial','trips.report_issue'),
 ('cc_rate_counterparty','loads.review_facility'),
 ('cc_pocket_my_exceptions','trips.view_mine'),
 ('cc_cancel_preview','deny'),('cc_pocket_cancel_trip','deny'),('cc_claim_escalate','deny'),('cc_my_rating','deny')
on conflict (rpc_name) do update set perm_key = excluded.perm_key;

create or replace function app_private.caller_rpc_name()
returns text language plpgsql as $$
declare v_ctx text; m text[]; v_name text;
begin
  get diagnostics v_ctx = pg_context;
  for m in select regexp_matches(v_ctx, '(?:PL/pgSQL function|SQL function) "?(?:[a-z_]+\.)?([a-z0-9_]+)"?\(', 'g') loop
    v_name := m[1];
    if v_name in ('caller_rpc_name','my_carrier_org','my_fleet_driver','my_fleet_driver_id','driver_has_perm','assert_trip_mine','driver_gate','can_touch_trip') then continue; end if;
    return v_name;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------- 0344f. join flow hardening (14 Sep, after owner's first live test)
-- (1) email-proven join: the EMAILED link carries a second secret (&c=<email_code>) that copy-link / WhatsApp never get.
--     A driver arriving with a valid code for the invite's own email is created already-confirmed by the `driver-join`
--     edge function (service role, admin.createUser email_confirm=true) - no "check your inbox" detour. A shared link
--     (no code) or a different email keeps normal Supabase email confirmation.
-- (2) drivers never receive the CARRIER welcome email; they get a short driver welcome after joining.
alter table app_private.carrier_driver_invites add column if not exists email_code text;

-- read-side for the edge function only: never anon/authenticated (anon-secdef count unchanged)
create or replace function public.cc_driver_invite_verify(p_token text, p_code text)
returns jsonb language sql stable security definer set search_path to 'app_private','public' as $$
  select case when i.id is null then jsonb_build_object('ok',false,'reason','not_found')
              when i.status <> 'pending' then jsonb_build_object('ok',false,'reason',i.status)
              when i.expires_at < now() then jsonb_build_object('ok',false,'reason','expired')
              when i.email_code is null or p_code is null or i.email_code <> p_code then jsonb_build_object('ok',false,'reason','code')
              else jsonb_build_object('ok',true,'email',lower(i.email),'name',i.driver_name,'carrier_org',i.carrier_org) end
  from (select 1) x left join app_private.carrier_driver_invites i on i.token = p_token;
$$;
revoke all on function public.cc_driver_invite_verify(text,text) from public, anon, authenticated;
grant execute on function public.cc_driver_invite_verify(text,text) to service_role;

-- invite: mint email_code, emailed link carries it, UI/copy/WhatsApp link does not
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_carrier_invite_driver' and pronamespace='public'::regnamespace;
  if v_def not like '%v_code text%' then
    v_def := replace(v_def, 'v_emailed boolean := false;', 'v_emailed boolean := false; v_code text; v_elink text;');
    v_def := replace(v_def, 'insert into app_private.carrier_driver_invites(carrier_org, fleet_driver_id, email, phone, driver_name, token, created_by, perms, preset, sent_via, last_sent_at, expires_at)',
                            'v_code := encode(extensions.gen_random_bytes(12),''hex'');' || E'\n' || '  insert into app_private.carrier_driver_invites(carrier_org, fleet_driver_id, email, phone, driver_name, token, email_code, created_by, perms, preset, sent_via, last_sent_at, expires_at)');
    v_def := replace(v_def, 'v_name, v_token, auth.uid(), v_perms,', 'v_name, v_token, v_code, auth.uid(), v_perms,');
    v_def := replace(v_def, 'v_link := ''https://loadboot.com/app/carrier/driver-invite.html?t='' || v_token;', 'v_link := ''https://loadboot.com/app/carrier/driver-invite.html?t='' || v_token; v_elink := v_link || ''&c='' || v_code;');
    v_def := replace(v_def, 'app_private.driver_invite_email_html(coalesce(v_org_name,''Your carrier''), coalesce(v_name,''there''), v_link),', 'app_private.driver_invite_email_html(coalesce(v_org_name,''Your carrier''), coalesce(v_name,''there''), v_elink),');
    v_def := replace(v_def, 'set your password and join:\n'' || v_link ||', 'set your password and join:\n'' || v_elink ||');
    execute v_def;
  end if;
end $$;

-- resend: same code in the emailed link (mint one for invites created before this patch)
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_driver_invite_resend' and pronamespace='public'::regnamespace;
  if v_def not like '%email_code%' then
    v_def := replace(v_def, 'update app_private.carrier_driver_invites set status=''pending'',', 'update app_private.carrier_driver_invites set email_code = coalesce(email_code, encode(extensions.gen_random_bytes(12),''hex'')), status=''pending'',');
    v_def := replace(v_def, 'v_link := ''https://loadboot.com/app/carrier/driver-invite.html?t='' || inv.token;', 'v_link := ''https://loadboot.com/app/carrier/driver-invite.html?t='' || inv.token; select email_code into inv.email_code from app_private.carrier_driver_invites where id=inv.id;');
    v_def := replace(v_def, 'app_private.driver_invite_email_html(coalesce(v_org_name,''Your carrier''), coalesce(inv.driver_name,''there''), v_link),', 'app_private.driver_invite_email_html(coalesce(v_org_name,''Your carrier''), coalesce(inv.driver_name,''there''), v_link || ''&c='' || inv.email_code),');
    execute v_def;
  end if;
end $$;

-- drivers do not get the carrier welcome ("your carrier account is live" is simply false for them)
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='send_welcome_email' and pronamespace='app_private'::regnamespace;
  if v_def not like '%role'''')=''driver''%' then
    v_def := replace(v_def, 'if app_private.is_partner_signup(new.id) then return new; end if;',
      'if app_private.is_partner_signup(new.id) then return new; end if;' || E'\n' ||
      '  if exists (select 1 from auth.users u where u.id = new.id and coalesce(u.raw_user_meta_data->>''role'','''')=''driver'') then return new; end if;');
    execute v_def;
  end if;
end $$;

-- driver welcome AFTER a successful join (inner fragment only; worker shell adds header/footer; key driver.* -> dispatch@)
create or replace function app_private.driver_welcome_email_html(p_org text, p_name text)
returns text language sql immutable as $$
  select '<div style="font-family:Manrope,Segoe UI,Arial,sans-serif;color:#0f172a">'
   || '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0883F7;font-weight:800">You’re in</div>'
   || '<h2 style="margin:6px 0 10px;font-size:22px;line-height:1.25">Driving for ' || p_org || ' on LoadBoot</h2>'
   || '<p style="color:#334155;font-size:14.5px;line-height:1.6;margin:0 0 16px">Hi ' || p_name || ', your login is linked to ' || p_org || '’s LoadBoot account. You’ll see only the loads assigned to you.</p>'
   || '<p style="margin:0 0 18px"><a href="https://loadboot.com/app/carrier/?role=driver" style="display:inline-block;background:#FC5305;color:#fff;padding:13px 22px;border-radius:11px;text-decoration:none;font-weight:800;font-size:15px">Open LoadBoot &rarr;</a></p>'
   || '<div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:13px;color:#0f172a;line-height:1.7"><b>On your phone</b><br>Android: install the LoadBoot app from Google Play (required for GPS check-in) · iPhone: Share → Add to Home Screen<br>Allow Location and Notifications — dispatch sees your truck on active loads only.</div>'
   || '<p style="font-size:12px;color:#64748b;line-height:1.6;margin:16px 0 0">Questions about a load? Use the in-app chat — it reaches LoadBoot dispatch and your carrier.</p>'
   || '</div>';
$$;
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_accept_driver_invite' and pronamespace='public'::regnamespace;
  if v_def not like '%driver.welcome%' then
    v_def := replace(v_def, 'perform app_private.log_audit(''carrier.driver.invite.accept''',
      'begin perform app_private.sys_email((select email from auth.users where id=auth.uid()), ''driver.welcome'', ''You’re in — driving for '' || coalesce(v_org_name,''your carrier'') || '' on LoadBoot'', app_private.driver_welcome_email_html(coalesce(v_org_name,''your carrier''), coalesce(inv.driver_name,''there'')), null, ''drvwelcome:'' || inv.id::text); exception when others then null; end;' || E'\n' ||
      '  perform app_private.log_audit(''carrier.driver.invite.accept''');
    execute v_def;
  end if;
end $$;

-- (3) notifications: drivers never receive org-wide broadcasts (notify_org); trip alerts reach owner/managers +
--     ONLY the driver assigned to that trip. Before this, every driver of the carrier got every trip.* broadcast
--     (cc_trip_revert) and every dispatch alert (cc_trip_notify_parties) - other drivers' lanes included.
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='notify_org' and pronamespace='app_private'::regnamespace;
  if v_def like '%or p_template like ''trip.%''%' then
    v_def := replace(v_def, 'where om.org_id = p_org and om.status=''active'' and (om.member_role <> ''driver'' or p_template like ''trip.%'' or p_template like ''driver.%'') limit 5 loop',
                            'where om.org_id = p_org and om.status=''active'' and om.member_role <> ''driver'' order by (om.member_role=''owner'') desc, om.created_at limit 5 loop');
    execute v_def;
  end if;
end $$;
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_trip_notify_parties' and pronamespace='public'::regnamespace;
  if v_def like '%where om.org_id = t.carrier_id and om.status=''active'' limit 5 loop%' then
    v_def := replace(v_def, 'where om.org_id = t.carrier_id and om.status=''active'' limit 5 loop',
                            'where om.org_id = t.carrier_id and om.status=''active'' and (om.member_role <> ''driver'' or om.user_id = (select d.user_id from app_private.fleet_drivers d where d.id = t.driver_id)) order by (om.member_role=''owner'') desc, om.created_at limit 5 loop');
    execute v_def;
  end if;
end $$;

-- prod shape of cc_trip_notify_parties routes through notify_org (staging has the explicit loop above). notify_org now
-- skips drivers, so add the assigned driver back explicitly via notify_user (idempotent: anchor disappears once patched).
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_trip_notify_parties' and pronamespace='public'::regnamespace;
  if v_def like '%app_private.notify_org(t.carrier_id%' and v_def not like '%notify_user%' then
    v_def := regexp_replace(v_def, '(v_carrier_n := app_private\.notify_org\(t\.carrier_id,[^;]*;)',
      E'\\1 v_carrier_n := v_carrier_n + app_private.notify_user((select d.user_id from app_private.fleet_drivers d where d.id = t.driver_id), ''trip.dispatch_alert'', ''⚠ Dispatch alert on your trip'', v_lane || '' — '' || v_note, ''/app/carrier/#trips'', ''warning'', ''tripalert:'' || p_trip::text || '':drv:'' || to_char(now(),''YYYYMMDDHH24MI''));');
    if v_def not like '%notify_user%' then raise exception 'cc_trip_notify_parties (notify_org shape) anchor not found'; end if;
    execute v_def;
  end if;
end $$;

-- (4) driver's "Verified carrier" badge must mean what the carrier portal means: onboarding decided + org active
--     (organizations.status is 'active' from signup for every carrier, so status alone said "verified" to everyone).
do $$ declare v_def text; begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='cc_my_driver_context' and pronamespace='public'::regnamespace;
  if v_def not like '%carrier_verified%' then
    v_def := replace(v_def, '''carrier_dot'',m.dot_number,', '''carrier_dot'',m.dot_number,' || E'\n' || '    ''carrier_verified'', (m.org_status = ''active'' and exists (select 1 from app_private.carrier_onboarding co where co.carrier_id = m.org_id and co.decided_at is not null)),');
    execute v_def;
  end if;
end $$;

-- ---------------------------------------------------------------- verify (expect anon-executable SECURITY DEFINER count unchanged: 33 prod / 32 staging)
select count(*) as anon_secdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

commit;
