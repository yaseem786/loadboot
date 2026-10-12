-- PROD-bl_comp_0545 — prod copy of migrations/bl_comp_0545_coi_vins_pending.sql (O.6 a–d). NOT applied on prod.
-- Apply through a Claude session with the Supabase MCP (project rwscphuhpjoudvljvmdk), in the same 5 parts as staging
-- (sections 0-4 | anchor patches 5-6 | triggers 7+9 | trigger 8 + catalog | cc_coi_request_vins), only after the
-- owner has seen the read-only list of carriers this turns to 'VINs pending' (posting blocked for them from that moment).
-- Anchors were checked on prod 12 Oct (read-only): all five present exactly once. After: anon SECDEF must read 36, names unchanged.

-- bl_comp_0545 — O.6 (a–d): an approved COI with no VINs must never switch the VIN gate off (owner, 12 Oct 2026)
--
-- Found on prod 12 Oct: T Strick has a valid insurance_coi but NO app_private.coi_coverage row, so
-- vin_coverage_state() said 'no_coi' and assert_vin_dispatchable() (which only blocks 'not_covered') let every
-- truck be added AND posted. An approved certificate we could not read the vehicles off silently disabled the gate.
--
-- What this does:
--   (b) New state 'coi_vins_pending' = a VALID insurance_coi (same test as fleet_truck_coi_gate) AND
--       (no coverage row OR mode 'unknown' OR mode 'scheduled' with 0 VINs).
--       · truck ENTRY allowed  — cc_pocket_upsert_truck / cc_upsert_truck now call assert_vin_registrable (blocks only
--         a bad VIN or 'not_covered'); the fleet_truck_vin_gate trigger already only blocks 'not_covered'.
--       · POSTING / DISPATCH blocked (LB006) — assert_vin_dispatchable (cc_post_truck, cc_update_truck_posting*) and a
--         new BEFORE trigger on truck_postings that refuses any row going ACTIVE (insert, resume, extend, confirm,
--         set-available, truck swap) while the carrier is pending. Already-active postings are not touched here — the
--         backfill (O.6 e) is a separate, owner-approved step.
--   (a) COI approval with no VINs read never leaves the table empty or 'unknown':
--       · AFTER trigger on carrier_compliance: insurance_coi becomes valid and the org has no coverage row → write
--         mode 'scheduled' + EMPTY VIN list, source 'system', note "VINs needed from carrier/agent", + staff flag.
--       · BEFORE trigger on coi_coverage: a non-staff write of mode 'unknown' (coi_ingest_from_document when the AI
--         could not read the schedule) is stored as 'scheduled' + 0 VINs with the same note. A reviewer who picks
--         "Cannot tell" in CC (source 'staff') keeps 'unknown' — it reads as pending all the same.
--         (Done as a trigger, not a patch: coi_ingest_from_document differs between staging and prod — prod has
--         bl_fix_0311, staging does not — so one anchor cannot patch both.)
--   (c)/(d) data for the UI: cc_coi_panel / cc_carrier_fleet_360 / carrier_coi_trucks_banner return vins_pending;
--       public.cc_coi_request_vins(org) sends "Request VIN schedule from carrier" through the email catalog
--       (key document.coi_vins.request, CLAUDE.md §6 + §10 email_kit; email_gate checked per address first).
--
-- Patched functions are edited by anchor (one exact occurrence, else the migration aborts), never retyped, because
-- cc_pocket_upsert_truck, cc_upsert_truck and cc_carrier_fleet_360 differ between staging and prod.
-- anon SECDEF surface: cc_coi_request_vins is revoked from public, anon → count unchanged (36 prod / 35 staging).
-- Staging: applied 12 Oct 2026 in 5 parts (bl_comp_0545_coi_vins_pending_p1..p5) — `drop trigger` hangs the Supabase MCP,
-- so triggers use `create or replace trigger` (PG14+). Anon SECDEF after: 35, names unchanged.

-- ---------------------------------------------------------------------------------------------------------------
-- 0. 'system' is a coverage source now (rows written by the approval trigger, not by the AI or a reviewer)
alter table app_private.coi_coverage drop constraint if exists coi_coverage_source_check;
alter table app_private.coi_coverage add constraint coi_coverage_source_check
  check (source = any (array['ai','staff','system']));

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The one definition of "VINs pending"
create or replace function app_private.coi_vins_pending(p_org uuid)
returns boolean
language sql stable
set search_path = app_private, public, extensions, pg_temp
as $$
  select exists (
           select 1 from app_private.carrier_compliance cc
            where cc.carrier_id = p_org
              and cc.requirement_key = 'insurance_coi'
              and cc.status = 'valid'
              and (cc.expiry_date is null or cc.expiry_date >= current_date))
     and (
           not exists (select 1 from app_private.coi_coverage cv where cv.org_id = p_org)
        or exists (select 1 from app_private.coi_coverage cv where cv.org_id = p_org and cv.mode = 'unknown')
        or (exists (select 1 from app_private.coi_coverage cv where cv.org_id = p_org and cv.mode = 'scheduled')
            and not exists (select 1 from app_private.coi_vehicles v where v.org_id = p_org)))
$$;

create or replace function app_private.coi_vins_pending_msg()
returns text language sql immutable as $$
  select 'Your insurance is approved, but we do not have this truck''s VIN on your policy yet. Upload your insurance ID '
      || 'card or the vehicle schedule from your policy on the Documents page (or ask your agent to email it to '
      || 'hello@loadboot.com). We match it the same working day — then this truck can be posted and dispatched.'
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. vin_coverage_state: pending first; a scheduled row with no VINs is never 'not_covered' (that would block entry)
create or replace function app_private.vin_coverage_state(p_org uuid, p_vin text)
returns text
language sql stable
set search_path = app_private, public, extensions, pg_temp
as $$
  select case
    when app_private.coi_vins_pending(p_org) then 'coi_vins_pending'
    when (select mode from app_private.coi_coverage where org_id = p_org) is null then 'no_coi'
    when (select mode from app_private.coi_coverage where org_id = p_org) = 'unknown'  then 'no_coi'
    when (select mode from app_private.coi_coverage where org_id = p_org) = 'any_auto' then 'covered'
    when exists (select 1 from app_private.coi_vehicles v
                  where v.org_id = p_org and v.vin = app_private.vin_norm(p_vin)) then 'covered'
    -- bl_comp_0545: a system "VINs needed" row whose COI has since lapsed — nothing to compare against
    when not exists (select 1 from app_private.coi_vehicles v where v.org_id = p_org) then 'no_coi'
    else 'not_covered'
  end
$$;

-- 3. Dispatch gate (posting, dispatch): now also refuses 'coi_vins_pending'
create or replace function app_private.assert_vin_dispatchable(p_org uuid, p_vin text)
returns void
language plpgsql stable
set search_path = app_private, public, extensions, pg_temp
as $$
declare v_state text;
begin
  if not app_private.vin_looks_valid(p_vin) then
    raise exception 'A valid 17-character VIN is required for every truck.' using errcode = 'LB002';
  end if;
  v_state := app_private.vin_coverage_state(p_org, p_vin);
  if v_state = 'not_covered' then
    raise exception 'This VIN is not listed on the certificate of insurance we have on file, so this truck cannot be dispatched. Ask your insurance agent to add it to the policy schedule, then re-upload the updated certificate for verification.'
      using errcode = 'LB001';
  end if;
  if v_state = 'coi_vins_pending' then   -- bl_comp_0545
    raise exception '%', app_private.coi_vins_pending_msg() using errcode = 'LB006';
  end if;
end $$;

-- 4. Entry gate (adding / editing a truck): bad VIN or a VIN the policy does not list — pending is allowed
create or replace function app_private.assert_vin_registrable(p_org uuid, p_vin text)
returns void
language plpgsql stable
set search_path = app_private, public, extensions, pg_temp
as $$
begin
  if not app_private.vin_looks_valid(p_vin) then
    raise exception 'A valid 17-character VIN is required for every truck.' using errcode = 'LB002';
  end if;
  if app_private.vin_coverage_state(p_org, p_vin) = 'not_covered' then
    raise exception 'This VIN is not listed on the certificate of insurance we have on file, so this truck cannot be dispatched. Ask your insurance agent to add it to the policy schedule, then re-upload the updated certificate for verification.'
      using errcode = 'LB001';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Anchor patcher (session-local): exactly one occurrence or the whole migration aborts.
create or replace function pg_temp.lb_patch(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare d text; c int;
begin
  d := pg_get_functiondef(p_fn);
  c := (length(d) - length(replace(d, p_old, ''))) / length(p_old);
  if c <> 1 then raise exception 'bl_comp_0545: anchor found % time(s) in %: %', c, p_fn, p_old; end if;
  execute replace(d, p_old, p_new);
end $$;

-- 5. Truck entry RPCs use the entry gate
select pg_temp.lb_patch('public.cc_pocket_upsert_truck(jsonb)'::regprocedure,
  'perform app_private.assert_vin_dispatchable(v_org, v_vin);',
  'perform app_private.assert_vin_registrable(v_org, v_vin);   -- bl_comp_0545: entry allowed while VINs are pending');
select pg_temp.lb_patch('public.cc_upsert_truck(uuid,uuid,text,text,text,text)'::regprocedure,
  'perform app_private.assert_vin_dispatchable(p_carrier, p_vin);',
  'perform app_private.assert_vin_registrable(p_carrier, p_vin);');

-- 6. UI data: vins_pending on the CC coverage card, the CC fleet card and the carrier's COI banner
select pg_temp.lb_patch('public.cc_coi_panel(uuid)'::regprocedure,
  $a$'mode', coalesce(v_cov.mode, 'unset'),$a$,
  $a$'mode', coalesce(v_cov.mode, 'unset'),
    'vins_pending', app_private.coi_vins_pending(v_org),   -- bl_comp_0545$a$);
select pg_temp.lb_patch('public.cc_carrier_fleet_360(uuid)'::regprocedure,
  $a$'mode',           coalesce(v_cov.mode,'unknown'),$a$,
  $a$'mode',           coalesce(v_cov.mode,'unknown'),
      'vins_pending',   app_private.coi_vins_pending(v_org),   -- bl_comp_0545$a$);
select pg_temp.lb_patch('public.carrier_coi_trucks_banner()'::regprocedure,
  $a$'fmcsa_units', v_units,$a$,
  $a$'fmcsa_units', v_units,
    'vins_pending', app_private.coi_vins_pending(v_org),   -- bl_comp_0545$a$);

-- ---------------------------------------------------------------------------------------------------------------
-- 7. (a) Never 'unknown' from the machine: store it as scheduled + 0 VINs ("VINs needed")
create or replace function app_private.trg_coi_coverage_no_unknown()
returns trigger
language plpgsql
set search_path = public, app_private
as $$
begin
  if new.mode = 'unknown' and coalesce(new.source, '') <> 'staff' then
    new.mode := 'scheduled';
    new.note := 'VINs needed from carrier/agent — the approved certificate does not list readable VINs. '
             || 'Paste them from the insurance ID cards / vehicle schedule, or set Any auto.';
  end if;
  return new;
end $$;

create or replace trigger trg_coi_coverage_no_unknown
  before insert or update of mode on app_private.coi_coverage
  for each row execute function app_private.trg_coi_coverage_no_unknown();

-- 8. (a) COI approved by any path (document review, cc_set_compliance, agent copy, reclassify) and no coverage row
create or replace function app_private.trg_coi_approved_needs_vins()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  begin
    if new.requirement_key = 'insurance_coi' and new.status = 'valid'
       and (tg_op = 'INSERT' or old.status is distinct from 'valid')
       and not exists (select 1 from app_private.coi_coverage where org_id = new.carrier_id) then
      insert into app_private.coi_coverage (org_id, mode, document_id, expiry_date, source, note, updated_at)
      values (new.carrier_id, 'scheduled', null, new.expiry_date, 'system',
              'VINs needed from carrier/agent — COI approved with no vehicle schedule on file. Trucks can be added; '
              || 'none can be posted until a VIN is recorded or the policy is set to Any auto.', now())
      on conflict (org_id) do nothing;
      insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff', 'in_app', 'compliance.coi_coverage',
        jsonb_build_object('title', 'VINs needed from carrier/agent',
          'body', coalesce((select name from public.organizations where id = new.carrier_id), 'A carrier')
                  || ': COI approved but no VINs are on file. Their trucks cannot be posted until you record the '
                  || 'vehicle schedule (or Any auto) — or use "Request VIN schedule from carrier".',
          'tone', 'warning', 'url', '/carriers'), 'sent', now());
    end if;
  exception when others then null;   -- a coverage note must never block a compliance decision
  end;
  return new;
end $$;
revoke execute on function app_private.trg_coi_approved_needs_vins() from public;

create or replace trigger trg_coi_approved_needs_vins
  after insert or update of status on app_private.carrier_compliance
  for each row when (new.requirement_key = 'insurance_coi' and new.status = 'valid')
  execute function app_private.trg_coi_approved_needs_vins();

-- 9. (b) Every way a posting goes ACTIVE is refused while VINs are pending
create or replace function app_private.trg_truck_posting_vin_gate()
returns trigger
language plpgsql
set search_path = public, app_private
as $$
begin
  if new.status = 'active' and new.truck_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.truck_id is distinct from new.truck_id)
     and app_private.coi_vins_pending(new.carrier_id) then
    raise exception '%', app_private.coi_vins_pending_msg() using errcode = 'LB006';
  end if;
  return new;
end $$;

create or replace trigger trg_truck_posting_vin_gate
  before insert or update of status, truck_id on app_private.truck_postings
  for each row execute function app_private.trg_truck_posting_vin_gate();

-- ---------------------------------------------------------------------------------------------------------------
-- 10. (d) "Request VIN schedule from carrier" — catalog row first (CLAUDE.md §6), then the sender
insert into app_private.email_catalog as c
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
   preference_group, unsub_allowed, status, cc_deep_link, owner_note)
values
  ('document.coi_vins.request', 'VIN schedule request',
   'Staff ask a carrier whose COI is approved but lists no readable VINs to send their insurance ID cards or the '
   || 'policy vehicle schedule. Until a VIN is recorded (or the policy is set to Any auto) their trucks cannot be posted.',
   'T', 'carrier', 'manual', 'public.cc_coi_request_vins (CC → document → coverage card → Request VIN schedule)',
   'on staff click', 'one per address per day (idempotency coi-vins:<org>:<day>:<email>)',
   'a VIN is recorded or coverage is set to Any auto', 'compliance', true, 'live', '#/documents',
   'Created 12 Oct 2026 (bl_comp_0545, O.6 d).')
on conflict (key) do update set
  name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence,
  cap_note = excluded.cap_note, stop_condition = excluded.stop_condition, preference_group = excluded.preference_group,
  unsub_allowed = excluded.unsub_allowed, status = excluded.status, cc_deep_link = excluded.cc_deep_link,
  owner_note = excluded.owner_note, updated_at = now();

create or replace function public.cc_coi_request_vins(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  k constant text := 'document.coi_vins.request';
  v_name text; v_html text; v_txt text; v_sub text; v_gate jsonb; m record;
  v_sent int := 0; v_blocked jsonb := '[]'::jsonb; v_to jsonb := '[]'::jsonb;
begin
  if not public.has_global_permission('documents.review') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not app_private.coi_vins_pending(p_org) then
    raise exception 'This carrier is not waiting on VINs — there is no approved COI, or VINs / Any auto are already recorded.'
      using errcode = '22023';
  end if;
  select o.name into v_name from public.organizations o where o.id = p_org;

  v_sub := 'Your insurance is approved — one thing left before your trucks can run';
  v_html := app_private.email_kit(jsonb_build_object(
    'eyebrow', jsonb_build_object('text', 'Insurance approved', 'tone', 'success'),
    'title', 'Send us your vehicle list',
    'intro_html', '<b>' || app_private.h_esc(coalesce(v_name, 'Your company')) || '</b> — your certificate of insurance '
                  || 'is approved. It does not list the vehicles it covers, so we cannot match your trucks to it yet.',
    'card', jsonb_build_object('title', 'Any one of these works', 'tone', 'info', 'items', jsonb_build_array(
              'Your insurance ID card for each truck',
              'The vehicle schedule page from your policy (it lists each VIN)',
              'Or ask your insurance agent to email it to hello@loadboot.com')),
    'step', jsonb_build_object('label', 'Your next step', 'title', 'Upload your ID cards or vehicle schedule',
              'text', 'Open Documents and upload it. You can add trucks now; posting them for loads opens as soon as '
                      || 'we match the VIN, usually the same working day.'),
    'cta', jsonb_build_object('label', 'Upload it now', 'url', 'https://loadboot.com/app/carrier/#documents'),
    'note', 'Brokers check that every truck we dispatch is on your policy. This is how we prove it for you.'));
  v_txt := 'Your insurance is approved. It does not list the vehicles it covers, so we cannot match your trucks to it yet.'
        || E'\n\nSend any one of these: your insurance ID card for each truck, the vehicle schedule page from your '
        || 'policy, or ask your agent to email it to hello@loadboot.com.'
        || E'\n\nUpload it here: https://loadboot.com/app/carrier/#documents'
        || E'\n\nYou can add trucks now; posting them opens as soon as we match the VIN.';

  for m in select u.id as uid, u.email from public.organization_memberships om
           join auth.users u on u.id = om.user_id
           where om.org_id = p_org and om.status = 'active' and u.email is not null limit 3
  loop
    v_to := v_to || to_jsonb(m.email);
    v_gate := app_private.email_gate(k, m.email, m.uid);
    if not coalesce((v_gate->>'allowed')::boolean, false) then
      -- CLAUDE.md §6.5: no other route — staff get the reason sentence verbatim
      v_blocked := v_blocked || jsonb_build_object('email', m.email, 'reason', v_gate->>'reason');
      continue;
    end if;
    perform app_private.sys_email(m.email, k, v_sub, v_html, v_txt,
      'coi-vins:' || p_org::text || ':' || to_char(now(), 'YYYYMMDD') || ':' || m.email);
    v_sent := v_sent + 1;
    begin
      insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
      values ('carrier', m.uid, 'in_app', k,
        jsonb_build_object('title', '📄 Send your insurance ID cards or vehicle schedule',
          'body', 'Your insurance is approved. Upload your ID cards or the vehicle schedule so your trucks can be posted.',
          'tone', 'warning', 'url', '/app/carrier/#documents'), 'sent', now());
    exception when others then null; end;
  end loop;

  perform app_private.log_audit('compliance.coi_vins_requested', 'org', p_org::text, p_org,
    format('VIN schedule requested from carrier (%s sent, %s blocked)', v_sent, jsonb_array_length(v_blocked)),
    jsonb_build_object('sent', v_sent, 'blocked', v_blocked, 'to', v_to));
  return jsonb_build_object('ok', true, 'sent', v_sent, 'blocked', v_blocked, 'recipients', jsonb_array_length(v_to));
end $$;
revoke execute on function public.cc_coi_request_vins(uuid) from public, anon;
grant execute on function public.cc_coi_request_vins(uuid) to authenticated;
