-- bl_disp_0442 — "Choose your carrier": the Carrier Fleet Book, inside the dispatcher portal.
-- Applied: staging 2026-09-25 (prod: after the owner's staging test — see the handoff note).
--
-- Owner decision (Yaseen, 25 Sep 2026):
--   Until now a candidate who passed the skills test was e-mailed a hand-built PDF ("LoadBoot ·
--   Carrier Fleet Book") and asked to reply with the carrier they wanted; LoadBoot then moved them
--   to trial and assigned the carrier by hand. From now on the portal does it:
--     1. The moment the test is marked PASSED (the same stamp that releases the result to the
--        candidate — skills_test_attempts.passed_email_at), a "Choose your carrier" tab opens in
--        the dispatcher portal.
--     2. It lists every AVAILABLE carrier — approved by LoadBoot (carrier_onboarding.stage =
--        'approved'), active, not demo, with NO active dispatcher assignment — with the same depth as the Fleet Book: trucks and specs, loading
--        equipment, preferences and rate floor, FMCSA authority age, cargo, timeline, open gaps.
--     3. Carriers whose equipment the candidate said they can manage (dispatcher_profiles.skills →
--        equipment) come FIRST as an exact match. When there is none the screen says so:
--        "No exact match with your profile — but you can still choose from the following
--        available carriers." If every carrier is assigned, the screen says none is open.
--     4. The candidate picks one. Command Center gets an in-app notification + an e-mail with the
--        candidate's profile and the carrier; the candidate gets a receipt. CC then presses
--        Accept — which starts the trial (cc_dispatcher_decide → trial, with the terms) AND
--        assigns the carrier (cc_dispatcher_assign) in ONE step — or Decline, which frees the
--        carrier and tells the candidate to choose again.
--
-- What a candidate may see BEFORE an assignment (owner can widen later): the operating profile —
--   equipment, truck specs, loading gear, dims, payload, preferences, floor, lanes, likes/dislikes,
--   boards, weekly cost, FMCSA counts and authority age, timeline. NOT: owner/driver names, phones,
--   e-mails, MC/DOT dockets, documents, bank/factoring. Those arrive with the assignment brief,
--   exactly as today (dispatcher.assigned.brief). "Never tell a candidate how many carriers LoadBoot
--   has".
-- Shared choice (owner, 25 Sep 2026 — revision): choosing does NOT reserve the carrier. Several candidates may
--   choose the same carrier; CC sees every request on it and accepts ONE. On accept the other pending choices on
--   that carrier are declined automatically with the e-mail + in-app card `dispatcher.carrier.assigned_elsewhere`
--   ("your chosen carrier was assigned to another dispatcher — choose again"). The assigned carrier disappears from
--   every list (active assignment); an unassign makes it available again.
--
-- Contact line: {{contact_inline}} only (WhatsApp via the contact switch — never the Riley line).
-- Public surface: 5 NEW public functions, all revoked from public+anon and granted to
--   authenticated → the anon SECURITY DEFINER count is UNCHANGED (33 prod / 32 staging).
--   dispatcher_carrier_options, dispatcher_choose_carrier, dispatcher_withdraw_choice (candidate);
--   cc_dispatcher_choices, cc_dispatcher_choice_decide (staff).
-- Replaced in place: app_private.disp_test_pass_email (copy only — the e-mail and the in-app card
--   now point at the portal instead of "a coordinator will reach out").
-- Apply: staging → owner test → prod.

-- ---------------------------------------------------------------- 1. the choice
create table if not exists app_private.dispatcher_carrier_choices (
  id                 uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null references auth.users(id) on delete cascade,
  carrier_org_id     uuid not null references public.organizations(id) on delete cascade,
  status             text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn')),
  match_kind         text not null default 'unknown' check (match_kind in ('exact','partial','related','unknown','none')),
  dispatcher_note    text,
  dispatcher_equipment text[] not null default '{}',
  carrier_equipment  text[] not null default '{}',
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  assignment_id      uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- one open choice per candidate. NOT one per carrier: several candidates may choose the same carrier (revision 25 Sep).
create unique index if not exists dispatcher_carrier_choices_one_pending_per_user
  on app_private.dispatcher_carrier_choices (dispatcher_user_id) where status = 'pending';
drop index if exists app_private.dispatcher_carrier_choices_one_pending_per_carrier;
create index if not exists dispatcher_carrier_choices_status_idx
  on app_private.dispatcher_carrier_choices (status, created_at desc);
alter table app_private.dispatcher_carrier_choices enable row level security;
revoke all on app_private.dispatcher_carrier_choices from public, anon, authenticated;
comment on table app_private.dispatcher_carrier_choices is
  'bl_disp_0442 — a passed candidate''s pick from the available carriers. pending = with CC (does not reserve the carrier); accepted = trial started + carrier assigned; declined = CC said no, or another candidate was assigned that carrier (candidate chooses again); withdrawn = candidate took it back.';

-- ---------------------------------------------------------------- 2. equipment vocabulary
-- The carrier side writes "Dry Van" / "Hotshot" / "Box Truck" (fleet form), the prefs side has
-- "BOX" / "Box truck" / "Sprinter" in old rows, the trailer_type column says "gooseneck flatbed";
-- the dispatcher application ticks the same seven labels as the fleet form. One normaliser.
create or replace function app_private.disp_equip_norm(t text) returns text
language sql immutable set search_path = app_private, public, pg_temp as $$
  select case
    when v in ('box','box truck','boxtruck','straight truck','straight box','26 ft box','26ft box') then 'box truck'
    when v in ('van','dry van','dryvan','53 van','53ft van','53 ft van') then 'dry van'
    when v in ('sprinter','sprinter van') then 'sprinter van'
    when v in ('cargo','cargo van') then 'cargo van'
    when v in ('reefer','refrigerated','reefer van') then 'reefer'
    when v in ('flatbed','flat bed','flat','deckover','lowboy') then 'flatbed'
    when v in ('step deck','stepdeck','step-deck','drop deck','dropdeck') then 'step deck'
    when v in ('hotshot','hot shot','hot-shot','gooseneck','gooseneck flatbed','bumper pull','bumper_pull') then 'hotshot'
    when v in ('power only','poweronly','power-only','power_only') then 'power only'
    when v in ('conestoga') then 'conestoga'
    else nullif(v,'') end
  from (select regexp_replace(lower(btrim(coalesce(t,''))), '\s+', ' ', 'g') v) x
$$;
revoke all on function app_private.disp_equip_norm(text) from public, anon;

create or replace function app_private.disp_equip_class(t text) returns text
language sql immutable set search_path = app_private, public, pg_temp as $$
  select case app_private.disp_equip_norm(t)
    when 'flatbed' then 'open deck' when 'step deck' then 'open deck' when 'hotshot' then 'open deck' when 'conestoga' then 'open deck'
    when 'dry van' then 'van' when 'box truck' then 'van' when 'cargo van' then 'van' when 'sprinter van' then 'van'
    when 'reefer' then 'reefer' when 'power only' then 'power only' else null end
$$;
revoke all on function app_private.disp_equip_class(text) from public, anon;

-- Display label for a normalised value ("dry van" → "Dry Van").
create or replace function app_private.disp_equip_label(t text) returns text
language sql immutable set search_path = app_private, public, pg_temp as $$
  select case app_private.disp_equip_norm(t)
    when 'dry van' then 'Dry Van' when 'box truck' then 'Box Truck' when 'cargo van' then 'Cargo Van' when 'sprinter van' then 'Sprinter Van'
    when 'reefer' then 'Reefer' when 'flatbed' then 'Flatbed' when 'step deck' then 'Step Deck' when 'hotshot' then 'Hotshot'
    when 'power only' then 'Power Only' when 'conestoga' then 'Conestoga' else initcap(coalesce(app_private.disp_equip_norm(t), '')) end
$$;
revoke all on function app_private.disp_equip_label(text) from public, anon;

-- What the carrier actually runs: registered trucks first (the strongest signal), then the stated
-- preference, then the signup profile. Normalised, distinct, never null entries.
create or replace function app_private.disp_carrier_equipment(p_org uuid) returns text[]
language sql stable security definer set search_path = app_private, public as $$
  with src as (
    select app_private.disp_equip_norm(t.equipment) e, 1 pri from app_private.fleet_trucks t
      where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired')
    union all
    select app_private.disp_equip_norm(x), 2 from app_private.carrier_dispatch_prefs p, unnest(coalesce(p.preferred_equipment,'{}')) x where p.carrier_id = p_org
    union all
    select app_private.disp_equip_norm(x), 3 from public.organizations o join public.profiles pf on pf.id = o.owner_user_id,
      unnest(coalesce(pf.equipment_types,'{}')) x where o.id = p_org
    union all
    select app_private.disp_equip_norm(x), 3 from public.organizations o join public.profiles pf on pf.id = o.owner_user_id,
      regexp_split_to_table(coalesce(pf.equipment,''), '\s*[,/|]\s*') x where o.id = p_org
  )
  select coalesce(array_agg(distinct e order by e), '{}'::text[])
    from src where e is not null
      -- trucks win: when at least one truck is registered, only truck + prefs count (a stale signup value must not create a "match")
      and (pri <= 2 or not exists (select 1 from app_private.fleet_trucks t where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired')))
$$;
revoke all on function app_private.disp_carrier_equipment(uuid) from public, anon;

create or replace function app_private.disp_dispatcher_equipment(p_user uuid) returns text[]
language sql stable security definer set search_path = app_private, public as $$
  select coalesce(array_agg(distinct e order by e), '{}'::text[])
    from (select app_private.disp_equip_norm(x) e
            from app_private.dispatcher_profiles d, jsonb_array_elements_text(coalesce(d.skills->'equipment','[]'::jsonb)) x
           where d.user_id = p_user) s where e is not null
$$;
revoke all on function app_private.disp_dispatcher_equipment(uuid) from public, anon;

-- exact: the candidate can manage EVERYTHING the carrier runs. partial: some of it. related: same
-- class (a flatbed dispatcher looking at a hotshot). unknown: the carrier has no equipment on file.
-- none: nothing in common.
create or replace function app_private.disp_choice_match(p_disp text[], p_carr text[]) returns text
language sql immutable set search_path = app_private, public, pg_temp as $$
  select case
    when coalesce(cardinality(p_carr),0) = 0 then 'unknown'
    when coalesce(cardinality(p_disp),0) = 0 then 'none'
    when p_carr <@ p_disp then 'exact'
    when p_carr && p_disp then 'partial'
    when exists (select 1 from unnest(p_carr) c, unnest(p_disp) d where app_private.disp_equip_class(c) is not null and app_private.disp_equip_class(c) = app_private.disp_equip_class(d)) then 'related'
    else 'none' end
$$;
revoke all on function app_private.disp_choice_match(text[], text[]) from public, anon;

-- ---------------------------------------------------------------- 3. availability + eligibility
-- Available = approved by LoadBoot, active, real (not demo), no active dispatcher. A pending choice by another
-- candidate does NOT remove it (shared choice — CC decides between them). p_for is kept for the signature.
create or replace function app_private.disp_carrier_available(p_org uuid, p_for uuid default null) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select exists (
    select 1 from public.organizations o
     where o.id = p_org and o.kind = 'carrier' and coalesce(o.status,'active') = 'active'
       and not coalesce(o.is_demo, false)
       and exists (select 1 from app_private.carrier_onboarding ob where ob.carrier_id = o.id and ob.stage = 'approved')
       and not exists (select 1 from app_private.dispatcher_assignments a where a.carrier_org_id = o.id and a.status in ('active','paused')))
$$;
revoke all on function app_private.disp_carrier_available(uuid, uuid) from public, anon;

-- Who may choose: a skills_test candidate whose PASS has been released (passed_email_at — the same
-- stamp that shows the verdict in the portal), or a trial/verified dispatcher with no carrier yet.
create or replace function app_private.disp_choice_eligibility(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare d record; v_pass record; v_asg int; v_pending record;
begin
  select * into d from app_private.dispatcher_profiles where user_id = p_user;
  if d.user_id is null then return jsonb_build_object('eligible', false, 'reason', 'not_dispatcher'); end if;
  select a.id, a.decision, a.passed_email_at, a.staff_score, a.max_score, a.reviewed_at into v_pass
    from app_private.skills_test_attempts a where a.user_id = p_user and a.decision = 'pass' and a.passed_email_at is not null
    order by a.reviewed_at desc nulls last, a.attempt_no desc limit 1;
  select count(*) into v_asg from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status <> 'ended';
  select c.id, c.carrier_org_id, c.status, c.created_at, c.dispatcher_note, c.match_kind into v_pending
    from app_private.dispatcher_carrier_choices c where c.dispatcher_user_id = p_user and c.status = 'pending' limit 1;
  return jsonb_build_object(
    'status', d.status,
    'eligible', (d.status = 'skills_test' and v_pass.id is not null) or (d.status in ('trial','verified') and v_asg = 0),
    'reason', case when d.status = 'skills_test' and v_pass.id is null then 'not_passed'
                   when d.status in ('trial','verified','active') and v_asg > 0 then 'assigned'
                   when d.status in ('applied','screening') then 'not_passed'
                   when d.status in ('rejected','suspended','withdrawn') then 'closed'
                   else null end,
    'passed_at', v_pass.passed_email_at,
    'score', v_pass.staff_score, 'max_score', v_pass.max_score,
    'has_pending', v_pending.id is not null,
    'pending_id', v_pending.id, 'pending_carrier_org_id', v_pending.carrier_org_id, 'pending_at', v_pending.created_at,
    'pending_note', v_pending.dispatcher_note, 'pending_match', v_pending.match_kind);
end $$;
revoke all on function app_private.disp_choice_eligibility(uuid) from public, anon;

-- ---------------------------------------------------------------- 3b. identity rule + conduct terms (owner, 25 Sep 2026)
-- Before Command Center accepts the choice the candidate sees NO carrier identity: no company name, no
-- owner/driver names, phones, e-mails, MC/DOT. Only the operation: equipment, trucks, floor, radius, home
-- state and the AGE of the authority. The stable anonymous label below is what the candidate and every
-- candidate-facing e-mail call the carrier until acceptance.
create or replace function app_private.disp_carrier_label(p_org uuid) returns text
language sql immutable as $$ select 'Carrier ' || upper(left(md5(p_org::text), 4)) $$;
revoke all on function app_private.disp_carrier_label(uuid) from public, anon;

-- The contact-conduct terms every candidate accepts BEFORE the first choice (stored on the profile with
-- the version). One source of truth: the portal renders these lines, the trial e-mail repeats them.
create or replace function app_private.disp_conduct_terms() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'version', 'v1-2026-09-25',
    'title', 'Contact rules — accepted before you choose',
    'rules', jsonb_build_array(
      'Every contact with a carrier goes through LoadBoot channels only: the carrier''s LoadBoot WhatsApp dispatch group, your LoadBoot line and your LoadBoot mailbox. Never a personal phone, personal WhatsApp, personal e-mail, or social media — yours or theirs.',
      'Never ask a carrier for a personal number and never give yours. Never move a carrier, a driver, a broker or a load off LoadBoot, during the assignment or after it ends.',
      'Carriers are told to report any contact that does not come from your LoadBoot line or the LoadBoot group. A report is investigated by LoadBoot. A confirmed report means your account is suspended the same day and blocked permanently: every assignment ends, your LoadBoot line and mailbox are released, and you cannot be reinstated or re-apply.',
      'Names, phones, dockets and documents you see after an assignment are confidential to that assignment. The carrier approves every load — you never book, commit or promise without their OK.'),
    'consequence', 'Confirmed off-platform contact = same-day suspension, permanent block, no re-application.')
$$;
revoke all on function app_private.disp_conduct_terms() from public, anon;

alter table app_private.dispatcher_profiles add column if not exists conduct_terms_accepted_at timestamptz;
alter table app_private.dispatcher_profiles add column if not exists conduct_terms_version text;

-- ---------------------------------------------------------------- 4. the Fleet Book, as JSON
-- p_full = false is what a candidate sees before an assignment (no company name, owner/driver names, phones, dockets, docs).
create or replace function app_private.disp_carrier_book(p_org uuid, p_full boolean default false) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare o record; pf record; pr record; ob record; sf record; snap jsonb; v_home text; v_city text; v_state text;
        v_trucks jsonb; v_truck_n int; v_gaps text[] := '{}'; v_floor numeric; v_radius int; v_deadhead int;
        v_equip text[]; v_last_active timestamptz; v_loads int; v_drivers int; v_auth_date date; v_age_m int;
        v_avail record; v_timeline jsonb; v_flags text[] := '{}'; v_summary text; v_owner_drives text;
begin
  select id, name, owner_user_id, created_at, status, is_demo into o from public.organizations where id = p_org;
  if o.id is null then return null; end if;
  select * into pf from public.profiles where id = o.owner_user_id;
  select * into pr from app_private.carrier_dispatch_prefs where carrier_id = p_org;
  select stage, decided_at, submitted_at into ob from app_private.carrier_onboarding where carrier_id = p_org order by decided_at desc nulls last limit 1;
  select * into sf from app_private.carrier_safety where carrier_id = p_org order by updated_at desc nulls last limit 1;
  snap := coalesce(sf.fmcsa_snapshot, '{}'::jsonb);

  -- home base: preference → truck domicile → signup profile → FMCSA physical address (city level only)
  select nullif(concat_ws(', ', nullif(t.domicile_city,''), nullif(t.domicile_state,'')), ''), t.domicile_city, t.domicile_state
    into v_home, v_city, v_state
    from app_private.fleet_trucks t where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired')
    order by t.unit_no nulls last, t.created_at limit 1;
  v_home := coalesce(nullif(pr.home_base,''), v_home, nullif(pf.home_base,''));

  v_floor    := coalesce(pr.min_rpm, pf.min_rpm);
  v_radius   := coalesce(pr.operating_radius_miles, pf.radius_miles);
  v_deadhead := coalesce(pr.max_deadhead_miles, pf.max_deadhead);
  v_equip    := app_private.disp_carrier_equipment(p_org);
  -- the Fleet Book's "authority since" is the FMCSA registration date (registered_since); the MC grant date is the fallback
  v_auth_date := coalesce(sf.registered_since, case when (snap->>'registeredSince') ~ '^\d{4}-\d{2}-\d{2}' then left(snap->>'registeredSince',10)::date end, sf.authority_date);
  v_age_m := case when v_auth_date is not null then (extract(year from age(current_date, v_auth_date))*12 + extract(month from age(current_date, v_auth_date)))::int end;

  -- trucks (full spec — the Fleet Book "TRUCK · UNIT" block)
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', t.id, 'unit_no', t.unit_no, 'equipment', app_private.disp_equip_label(t.equipment), 'equipment_raw', t.equipment,
      'trailer_type', t.trailer_type, 'trailer_len_ft', t.trailer_len_ft, 'status', t.status,
      'year', t.vin_year, 'make', t.vin_make, 'model', t.vin_model, 'gvwr_class', t.vin_gvwr, 'body', t.vin_body,
      'payload_lbs', t.payload_lbs, 'cargo_len_in', t.cargo_len_in, 'cargo_width_in', t.cargo_width_in, 'cargo_height_in', t.cargo_height_in,
      'deck_height_in', t.deck_height_in, 'door_type', t.door_type, 'door_width_in', t.door_width_in, 'door_height_in', t.door_height_in,
      'pallet_positions', t.pallet_positions, 'wheel_well_width_in', t.wheel_well_width_in,
      'dock_high', t.dock_high, 'liftgate', t.liftgate, 'liftgate_cap_lbs', t.liftgate_cap_lbs,
      'has_pallet_jack', t.has_pallet_jack, 'has_ramp', t.has_ramp, 'has_etrack', t.has_etrack, 'has_load_bars', t.has_load_bars,
      'has_straps', t.has_straps, 'has_blankets', t.has_blankets, 'has_tarps', t.has_tarps, 'has_chains', t.has_chains,
      'temp_control', t.temp_control, 'temp_min_f', t.temp_min_f, 'temp_max_f', t.temp_max_f,
      'hazmat_placarded', t.hazmat_placarded, 'twic', t.twic, 'tsa_sta', t.tsa_sta, 'bonded', t.bonded, 'team_driven', t.team_driven,
      'min_rpm', t.min_rpm, 'max_radius_miles', t.max_radius_miles, 'home_time', t.home_time,
      'inspection_exp', t.inspection_exp, 'next_service_date', t.next_service_date,
      'domicile', nullif(concat_ws(', ', nullif(t.domicile_city,''), nullif(t.domicile_state,''), nullif(t.domicile_zip,'')), ''),
      'spec_note', t.spec_note, 'capacity_note', t.capacity_note,
      'availability', (select jsonb_strip_nulls(jsonb_build_object('status', av.status, 'empty_at', av.empty_at,
           'empty_location', av.empty_location, 'must_be_home_by', av.must_be_home_by, 'home_location', av.home_location,
           'overnight_weekdays', av.overnight_weekdays, 'overnight_weekends', av.overnight_weekends,
           'hos_drive_left_h', av.hos_drive_left_h, 'updated_at', av.updated_at, 'note', av.note,
           'driver_name', case when p_full then av.driver_name end, 'driver_phone', case when p_full then av.driver_phone end))
         from app_private.truck_availability av where av.truck_id = t.id)
    )) order by t.unit_no nulls last, t.created_at), '[]'::jsonb), count(*)
    into v_trucks, v_truck_n
    from app_private.fleet_trucks t where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired');

  -- the book's NULL / CONFIRM flags — what the dispatcher must collect on the first call
  if v_truck_n = 0 then v_gaps := array_append(v_gaps, ('No truck on the portal record yet — call one is a data call: unit, year/make, length, payload, loading gear.')::text); end if;
  if v_truck_n > 0 and exists (select 1 from app_private.fleet_trucks t where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired') and t.trailer_len_ft is null and t.cargo_len_in is null)
    then v_gaps := array_append(v_gaps, ('Trailer / cargo length is not on file.')::text); end if;
  if v_truck_n > 0 and exists (select 1 from app_private.fleet_trucks t where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired') and t.payload_lbs is null)
    then v_gaps := array_append(v_gaps, ('True legal payload (lb) is not on file.')::text); end if;
  if v_floor is null then v_gaps := array_append(v_gaps, ('No rate floor recorded — get the minimum $/mile before quoting anything.')::text);
  elsif v_floor < 1.25 then v_flags := array_append(v_flags, ('Rate floor looks like a placeholder — confirm before you quote it.')::text); end if;
  if v_radius is null and v_deadhead is null then v_gaps := array_append(v_gaps, ('Operating radius / deadhead limit not on file.')::text); end if;
  if not exists (select 1 from app_private.truck_availability av where av.carrier_id = p_org and av.updated_at > now() - interval '7 days')
    then v_gaps := array_append(v_gaps, ('No truck availability posted in the last 7 days — ask where the truck is empty right now.')::text); end if;
  if v_age_m is not null and v_age_m < 6 then v_flags := array_append(v_flags, ('Authority is ' || v_age_m || ' months old — use the new-authority playbook (many brokers refuse under 6–12 months).')::text); end if;
  if coalesce(sf.out_of_service, false) then v_flags := array_append(v_flags, ('FMCSA shows OUT OF SERVICE — do not post until cleared.')::text); end if;
  if coalesce((snap->>'brokerAuthority')::boolean, false) then v_flags := array_append(v_flags, ('FMCSA also shows BROKER authority on this entity — ask about it on the first call.')::text); end if;

  select count(*) into v_drivers from app_private.fleet_drivers fd where fd.carrier_id = p_org and coalesce(fd.status,'active') = 'active';
  select count(*) into v_loads from app_private.dispatcher_bookings b where b.carrier_org_id = p_org and b.status not in ('rejected','cancelled');
  select greatest(u.last_sign_in_at, pr.updated_at, (select max(av.updated_at) from app_private.truck_availability av where av.carrier_id = p_org))
    into v_last_active from auth.users u where u.id = o.owner_user_id;
  v_owner_drives := nullif(pf.owner_drives, '');

  v_timeline := (select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'label', x.label) order by x.at), '[]'::jsonb) from (
      select o.created_at at, 'Joined LoadBoot' label
      union all select ob.decided_at, 'Approved — authority, insurance, W-9 verified' where ob.stage = 'approved' and ob.decided_at is not null
      union all select pr.updated_at, 'Preferences updated' where pr.updated_at is not null
      union all select max(av.updated_at), 'Truck availability posted' from app_private.truck_availability av where av.carrier_id = p_org having max(av.updated_at) is not null
      union all select v_last_active, 'Last active' where v_last_active is not null
    ) x where x.at is not null);

  v_summary := concat_ws(' · ',
    nullif(array_to_string((select array_agg(app_private.disp_equip_label(e)) from unnest(v_equip) e), ' / '), ''),
    case when v_truck_n > 0 then v_truck_n || ' truck' || case when v_truck_n = 1 then '' else 's' end else 'no truck on file' end,
    v_home);

  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', case when p_full then o.name end, 'label', app_private.disp_carrier_label(o.id), 'home_base', v_home, 'city', v_city, 'state', v_state,
             'joined_at', o.created_at, 'approved_at', case when ob.stage = 'approved' then ob.decided_at end, 'summary', v_summary),
    'equipment', v_equip,
    'equipment_labels', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(v_equip) e),
    'authority', jsonb_strip_nulls(jsonb_build_object(
       'status', coalesce(sf.authority_status, snap->>'authority'), 'authority_date', v_auth_date, 'age_months', v_age_m,
       'age_label', case when v_age_m is null then null when v_age_m >= 24 then (v_age_m/12) || ' yr ' || (v_age_m%12) || ' mo'
                         when v_age_m >= 12 then '1 yr ' || (v_age_m%12) || ' mo' else v_age_m || ' mo' end,
       'age_band', case when v_age_m is null then null when v_age_m < 6 then 'new' when v_age_m < 12 then 'under 1 yr' else 'established' end,
       'power_units', coalesce(sf.power_units, (snap->>'powerUnits')::int), 'drivers', coalesce(sf.driver_count, (snap->>'drivers')::int),
       'cdl_drivers', (snap->>'cdlDrivers')::int, 'safety_rating', coalesce(sf.safety_rating, snap->>'safetyRating'),
       'out_of_service', coalesce(sf.out_of_service, (snap->>'outOfService')::boolean),
       'operation', snap->'operationClassification', 'carrier_operation', snap->'carrierClassification',
       'cargo', snap->'cargoCarried', 'entity_type', snap->>'entityType', 'fleet_size', snap->>'fleetSizeCode',
       'mcs150_mileage', snap->>'mcs150Mileage', 'mcs150_year', snap->>'mcs150MileageYear', 'hazmat', snap->'hazmat',
       'broker_authority', snap->'brokerAuthority', 'owned_tractors', snap->'ownedTractors', 'owned_trailers', snap->'ownedTrailers',
       'crash_rate', snap->'recordableCrashRate', 'last_checked', coalesce(sf.last_checked, sf.updated_at),
       'mc', case when p_full then coalesce(sf.mc_number, pf.mc) end, 'dot', case when p_full then coalesce(sf.dot_number, pf.dot) end)),
    'fleet', jsonb_build_object('count', v_truck_n, 'trucks', v_trucks),
    'prefs', jsonb_strip_nulls(jsonb_build_object(
       'min_rpm', v_floor, 'min_rpm_basis', pr.min_rpm_basis, 'target_rpm', pr.target_rpm, 'min_total_rate', pr.min_total_rate,
       'haul_types', pr.haul_types, 'operating_radius_miles', v_radius, 'max_deadhead_miles', v_deadhead,
       'min_trip_miles', pr.min_trip_miles, 'max_trip_miles', pr.max_trip_miles,
       'load_size', pr.load_size, 'max_weight_lbs', pr.max_weight_lbs, 'services', pr.services,
       'avoid_states', coalesce(pr.avoid_states, case when nullif(pf.avoid_states,'') is not null then regexp_split_to_array(pf.avoid_states, '\s*,\s*') end),
       'weekend_ok', coalesce(pr.weekend_ok, pf.weekend_ok), 'home_time', pr.home_time, 'round_trip_pref', pr.round_trip_pref,
       'preferred_lanes', pr.preferred_lanes, 'preferred_equipment', pr.preferred_equipment,
       'facility_likes', pr.facility_likes, 'facility_dislikes', pr.facility_dislikes, 'external_boards', pr.external_boards,
       'hazmat', coalesce(pr.hazmat, pf.hazmat), 'team_drivers', coalesce(pr.team_drivers, pf.team_drivers),
       'min_notice_hours', pr.min_notice_hours, 'dat_seat', pr.dat_seat,
       'weekly_operating_cost', pr.weekly_operating_cost, 'weekly_cost_includes_pay', pr.weekly_cost_includes_pay,
       'equipment_detail', case when p_full then pr.equipment_detail else (coalesce(pr.equipment_detail,'{}'::jsonb) - 'driver' - 'driver_licence' - 'vin' - 'unit' - 'pickup_zip') end,
       'notes', pr.notes, 'updated_at', pr.updated_at)),
    'ops', jsonb_strip_nulls(jsonb_build_object(
       'owner_drives', v_owner_drives, 'drivers_on_file', v_drivers, 'loads_booked', v_loads, 'last_active_at', v_last_active,
       'factoring_status', case when p_full then pf.factoring_status end, 'factoring_company', case when p_full then pf.factoring_company end)),
    'gaps', to_jsonb(v_gaps), 'flags', to_jsonb(v_flags),
    'timeline', v_timeline);
end $$;
revoke all on function app_private.disp_carrier_book(uuid, boolean) from public, anon;

-- ---------------------------------------------------------------- 5. candidate: options
create or replace function public.dispatcher_carrier_options() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); el jsonb; d record; v_disp text[]; v_list jsonb; v_exact int; v_pending jsonb; v_history jsonb;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  el := app_private.disp_choice_eligibility(v_uid);
  if (el->>'reason') = 'not_dispatcher' then return jsonb_build_object('error','not a dispatcher'); end if;
  select full_name, years_exp, load_boards, skills, status, conduct_terms_accepted_at, conduct_terms_version into d from app_private.dispatcher_profiles where user_id = v_uid;
  v_disp := app_private.disp_dispatcher_equipment(v_uid);

  -- the pending pick (renders as the "with LoadBoot" card, book included)
  select jsonb_build_object('id', c.id, 'carrier_org_id', c.carrier_org_id, 'status', c.status, 'created_at', c.created_at,
           'note', c.dispatcher_note, 'match_kind', c.match_kind, 'book', app_private.disp_carrier_book(c.carrier_org_id, false))
    into v_pending from app_private.dispatcher_carrier_choices c where c.dispatcher_user_id = v_uid and c.status = 'pending' limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'carrier', case when c.status = 'accepted' then o.name else app_private.disp_carrier_label(o.id) end, 'status', c.status, 'created_at', c.created_at,
           'decided_at', c.decided_at, 'decision_note', c.decision_note) order by c.created_at desc), '[]'::jsonb)
    into v_history from app_private.dispatcher_carrier_choices c join public.organizations o on o.id = c.carrier_org_id
   where c.dispatcher_user_id = v_uid and c.status in ('declined','withdrawn','accepted');

  if coalesce((el->>'eligible')::boolean, false) and v_pending is null then
    select coalesce(jsonb_agg(x.j order by x.rank, x.approved_at nulls last, x.name), '[]'::jsonb), coalesce(sum(case when x.rank = 0 then 1 else 0 end), 0)
      into v_list, v_exact
      from (
        select o.name, ob.decided_at approved_at,
               case m when 'exact' then 0 when 'partial' then 1 when 'related' then 2 when 'unknown' then 3 else 4 end rank,
               b || jsonb_build_object('match_kind', m,
                 'match_label', case m when 'exact' then 'Exact match with your profile' when 'partial' then 'Partial match — some equipment you know'
                                       when 'related' then 'Related equipment class' when 'unknown' then 'Equipment not on file yet' else 'Outside your stated equipment' end,
                 'match_common', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(b_eq) e where e = any(v_disp)),
                 'match_missing', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(b_eq) e where not (e = any(v_disp)))) j
          from public.organizations o
          join app_private.carrier_onboarding ob on ob.carrier_id = o.id and ob.stage = 'approved'
          cross join lateral (select app_private.disp_carrier_book(o.id, false) b) bk
          cross join lateral (select (select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(bk.b->'equipment') x) b_eq) eq
          cross join lateral (select app_private.disp_choice_match(v_disp, eq.b_eq) m) mm
         where o.kind = 'carrier' and app_private.disp_carrier_available(o.id, v_uid)
      ) x;
  else
    v_list := '[]'::jsonb; v_exact := 0;
  end if;

  return jsonb_build_object(
    'eligible', coalesce((el->>'eligible')::boolean, false), 'reason', el->>'reason', 'status', d.status,
    'can_choose', coalesce((el->>'eligible')::boolean, false) and v_pending is null,
    'passed_at', el->'passed_at', 'score', el->'score', 'max_score', el->'max_score',
    'dispatcher', jsonb_build_object('name', d.full_name, 'years_exp', d.years_exp, 'load_boards', d.load_boards,
        'equipment', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(v_disp) e),
        'hours', d.skills->>'availability_hours', 'timezone', d.skills->>'timezone'),
    'exact_count', v_exact, 'available_count', jsonb_array_length(v_list),
    'conduct_terms', app_private.disp_conduct_terms() || jsonb_build_object('accepted_at', d.conduct_terms_accepted_at, 'accepted_version', d.conduct_terms_version),
    'carriers', v_list, 'pending', v_pending, 'history', v_history);
end $$;
revoke all on function public.dispatcher_carrier_options() from public, anon;
grant execute on function public.dispatcher_carrier_options() to authenticated;

-- ---------------------------------------------------------------- 5b. candidate: accept the contact-conduct terms
create or replace function public.dispatcher_accept_conduct_terms() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_ver text := app_private.disp_conduct_terms()->>'version'; v_name text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  update app_private.dispatcher_profiles set conduct_terms_accepted_at = now(), conduct_terms_version = v_ver, updated_at = now()
   where user_id = v_uid returning full_name into v_name;
  if not found then return jsonb_build_object('error','not a dispatcher'); end if;
  perform app_private.disp_audit('dispatcher.conduct_terms.accepted', 'dispatcher', v_uid::text, null,
    coalesce(v_name,'dispatcher') || ' accepted the contact-conduct terms ' || v_ver, jsonb_build_object('version', v_ver));
  return jsonb_build_object('ok', true, 'version', v_ver, 'accepted_at', now());
end $$;
revoke all on function public.dispatcher_accept_conduct_terms() from public, anon;
grant execute on function public.dispatcher_accept_conduct_terms() to authenticated;

-- ---------------------------------------------------------------- 6. candidate: choose
create or replace function public.dispatcher_choose_carrier(p_org uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); el jsonb; d record; o record; v_disp text[]; v_carr text[]; v_match text; v_id uuid;
        v_book jsonb; v_note text; v_mail text; v_staff text := app_private.disp_contact()->>'email'; v_html text; v_text text;
        v_score text; v_boards text; v_equip_d text; v_equip_c text; v_contact text := app_private.disp_contact()->>'email';
        v_cc_url text; v_match_label text; v_label text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  el := app_private.disp_choice_eligibility(v_uid);
  if (el->>'reason') = 'not_dispatcher' then return jsonb_build_object('error','not a dispatcher'); end if;
  if not coalesce((el->>'eligible')::boolean, false) then return jsonb_build_object('error','choosing a carrier opens once your skills test is marked passed'); end if;
  if coalesce((el->>'has_pending')::boolean, false) then return jsonb_build_object('error','your choice is already with LoadBoot — withdraw it first if you want to change it'); end if;
  if p_org is null then return jsonb_build_object('error','pick a carrier'); end if;
  if not exists (select 1 from app_private.dispatcher_profiles where user_id = v_uid and conduct_terms_version = app_private.disp_conduct_terms()->>'version')
    then return jsonb_build_object('error','accept the contact rules first', 'code', 'terms_required'); end if;
  v_label := app_private.disp_carrier_label(p_org);
  if not app_private.disp_carrier_available(p_org, v_uid) then return jsonb_build_object('error','this carrier is no longer open — pick another'); end if;

  select full_name, years_exp, load_boards, skills, status into d from app_private.dispatcher_profiles where user_id = v_uid;
  select id, name, owner_user_id into o from public.organizations where id = p_org;
  v_disp := app_private.disp_dispatcher_equipment(v_uid);
  v_carr := app_private.disp_carrier_equipment(p_org);
  v_match := app_private.disp_choice_match(v_disp, v_carr);
  v_note := nullif(left(btrim(coalesce(p_note,'')), 1200), '');

  begin
    insert into app_private.dispatcher_carrier_choices (dispatcher_user_id, carrier_org_id, match_kind, dispatcher_note, dispatcher_equipment, carrier_equipment)
    values (v_uid, p_org, v_match, v_note, v_disp, v_carr) returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('error','your choice is already with LoadBoot — withdraw it first if you want to change it');
  end;

  v_book := app_private.disp_carrier_book(p_org, false);
  v_score := case when el->>'score' is not null then (el->>'score') || ' / ' || coalesce(el->>'max_score','100') end;
  v_boards := nullif((select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(d.load_boards) = 'array' then d.load_boards else '[]'::jsonb end) x), '');
  v_equip_d := coalesce(nullif((select string_agg(app_private.disp_equip_label(e), ' / ' order by e) from unnest(v_disp) e), ''), 'none stated');
  v_equip_c := coalesce(nullif((select string_agg(app_private.disp_equip_label(e), ' / ' order by e) from unnest(v_carr) e), ''), 'not on file');
  v_match_label := case v_match when 'exact' then 'EXACT MATCH' when 'partial' then 'PARTIAL MATCH' when 'related' then 'RELATED CLASS' when 'unknown' then 'CARRIER EQUIPMENT NOT ON FILE' else 'OUTSIDE STATED EQUIPMENT' end;
  v_cc_url := 'https://loadboot.com/app/command-center/#/dispatcher?id=' || v_uid::text || '&tab=carriers';

  -- ---- Command Center: in-app card + e-mail to the dispatch inbox
  perform app_private.disp_notify(null, 'staff', 'dispatcher.carrier.chosen',
    coalesce(d.full_name,'A candidate') || ' chose ' || coalesce(o.name,'a carrier') || ' — ' || lower(v_match_label),
    'Skills test passed' || coalesce(' (' || v_score || ')', '') || ' · knows ' || v_equip_d || ' · carrier runs ' || v_equip_c
      || coalesce(E'\nCandidate note: ' || v_note, '') || E'\nAccept in Command Center = trial starts + carrier assigned in one step.',
    '/app/command-center/#/dispatcher?id=' || v_uid::text || '&tab=carriers', false);

  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Carrier choice', app_private.disp_esc(coalesce(d.full_name,'A candidate')) || ' chose ' || app_private.disp_esc(coalesce(o.name,'a carrier')))
    || '<p style="margin:0 0 14px">A candidate who passed the skills test has picked a carrier from the portal. Nothing is assigned yet &mdash; Command Center decides.</p>'
    || app_private.disp_strip('Candidate', app_private.disp_esc(coalesce(d.full_name,'—')) || coalesce('<div style="font-size:10.5px;letter-spacing:.12em;color:#8ea2c3;font-weight:700;margin-top:2px">TEST ' || v_score || '</div>',''),
         'Carrier', app_private.disp_esc(coalesce(o.name,'—')) || coalesce('<div style="font-size:10.5px;letter-spacing:.12em;color:#8ea2c3;font-weight:700;margin-top:2px">' || app_private.disp_esc(v_book#>>'{org,home_base}') || '</div>',''),
         'Match', '<span style="color:' || case v_match when 'exact' then '#4ade80' when 'none' then '#f87171' else '#FC5305' end || '">' || v_match_label || '</span>')
    || app_private.disp_box('Candidate profile',
         '<b>Equipment they can manage:</b> ' || app_private.disp_esc(v_equip_d) || '<br>'
      || '<b>US dispatch experience:</b> ' || coalesce(d.years_exp::text || ' yr', 'not stated') || '<br>'
      || '<b>Load boards:</b> ' || app_private.disp_esc(coalesce(v_boards,'not stated')) || '<br>'
      || '<b>Hours / timezone:</b> ' || app_private.disp_esc(coalesce(d.skills->>'availability_hours','?')) || ' h/wk &middot; ' || app_private.disp_esc(coalesce(d.skills->>'timezone','?')) || '<br>'
      || '<b>Status:</b> ' || app_private.disp_esc(coalesce(d.status,'?')))
    || app_private.disp_box('Carrier snapshot',
         '<b>Runs:</b> ' || app_private.disp_esc(v_equip_c) || ' &middot; ' || coalesce((v_book#>>'{fleet,count}'),'0') || ' truck(s) on file<br>'
      || '<b>Rate floor:</b> ' || coalesce('$' || to_char((v_book#>>'{prefs,min_rpm}')::numeric,'FM990.00') || '/mi', 'not on file') || ' &middot; <b>Radius:</b> ' || coalesce((v_book#>>'{prefs,operating_radius_miles}') || ' mi', 'not on file') || '<br>'
      || '<b>Authority:</b> ' || coalesce(app_private.disp_esc(v_book#>>'{authority,age_label}') || ' old', 'age unknown') || coalesce(' &middot; ' || (v_book#>>'{authority,power_units}') || ' power unit(s)', '') || '<br>'
      || '<b>Approved:</b> ' || coalesce(to_char((v_book#>>'{org,approved_at}')::timestamptz, 'FMDD Mon YYYY'), '—')
      || case when jsonb_array_length(coalesce(v_book->'gaps','[]'::jsonb)) > 0 then '<br><b>Open gaps:</b> ' || (select string_agg(app_private.disp_esc(g), ' · ') from jsonb_array_elements_text(v_book->'gaps') g) else '' end)
    || case when v_note is not null then app_private.disp_box('Candidate note', replace(app_private.disp_esc(v_note), E'\n', '<br>'), 'note') else '' end
    || app_private.disp_box('What Accept does',
         '<b>Accept</b> in Command Center starts the trial (terms first &mdash; commission % and the 10 working days) <b>and</b> assigns this carrier with its SOP in one step: the candidate gets the trial e-mail and the full carrier brief, the carrier gets the intro. '
      || '<b>Decline</b> tells the candidate to choose again. Other candidates can choose this carrier too &mdash; whoever you accept gets it and the rest are told to choose again.', 'ok')
    || app_private.disp_btn('Open in Command Center', v_cc_url)
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">Staff notice &middot; dispatcher.carrier.chosen &middot; choice ' || v_id::text || '</p></div>';
  v_text := coalesce(d.full_name,'A candidate') || ' chose ' || coalesce(o.name,'a carrier') || ' (' || v_match_label || E').\n'
    || 'Candidate: ' || v_equip_d || ' · ' || coalesce(d.years_exp::text || ' yr', '?') || ' · test ' || coalesce(v_score,'?') || E'\n'
    || 'Carrier: ' || v_equip_c || ' · floor ' || coalesce('$' || (v_book#>>'{prefs,min_rpm}') || '/mi', 'n/a') || E'\n'
    || coalesce('Note: ' || v_note || E'\n', '') || 'Open: ' || v_cc_url;
  begin
    perform app_private.sys_email(v_staff, 'dispatcher.carrier.chosen',
      'Carrier choice: ' || coalesce(d.full_name,'candidate') || ' → ' || coalesce(o.name,'carrier') || ' (' || lower(v_match_label) || ')',
      v_html, v_text, 'disp.choice.staff:' || v_id::text);
  exception when others then null; end;

  -- ---- the candidate: in-app + receipt e-mail
  perform app_private.disp_notify(v_uid, 'dispatcher', 'dispatcher.carrier.chosen.receipt',
    'Your choice is with LoadBoot: ' || v_label,
    'LoadBoot reviews it, sets your trial terms and opens your workspace. Other candidates may choose the same carrier; you get an e-mail the moment it is decided.',
    '/app/agent/#dashboard', false);
  select u.email into v_mail from auth.users u where u.id = v_uid;
  if v_mail is not null then
    v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
      || app_private.disp_head('LoadBoot Dispatch &middot; Carrier choice', 'Your choice is with LoadBoot')
      || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(d.full_name,''),'Dispatcher')) || ', you chose <b>' || v_label || '</b>. LoadBoot now reviews it.</p>'
      || app_private.disp_strip('Carrier', v_label, 'Runs', app_private.disp_esc(v_equip_c), 'Your fit', '<span style="color:' || case v_match when 'exact' then '#4ade80' else '#FC5305' end || '">' || v_match_label || '</span>')
      || app_private.disp_box('What happens next',
           '<b>1.</b> LoadBoot reviews your choice &mdash; usually within one working day. Other candidates may choose the same carrier; LoadBoot decides who is assigned and tells everyone.<br>'
        || '<b>2.</b> On acceptance your paid trial starts: you receive the trial terms e-mail and this carrier&rsquo;s full operating brief (truck, driver, rules, authority) in a second e-mail.<br>'
        || '<b>3.</b> Read the brief completely before you introduce yourself. Contact details arrive through the carrier&rsquo;s WhatsApp group, never before.')
      || app_private.disp_box('Changed your mind?', 'Open your portal and withdraw the choice and pick another. Do not contact the carrier directly before the assignment.', 'note')
      || app_private.disp_btn('Open my portal', 'https://loadboot.com/app/agent/#dashboard')
      || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_contact || '</span></p>'
      || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because you chose a carrier in your LoadBoot dispatcher portal. Transactional notice about your application.</p></div>';
    v_text := 'Dear ' || coalesce(nullif(d.full_name,''),'Dispatcher') || E',\n\nYou chose ' || v_label || E'. LoadBoot reviews it (usually within one working day); other candidates may choose the same carrier and LoadBoot decides who is assigned. On acceptance your paid trial starts and you receive the trial terms and the carrier''s full brief by e-mail.\n\nChanged your mind? Withdraw the choice in your portal: https://loadboot.com/app/agent/#dashboard\n\nLoadBoot Dispatch - {{contact_inline}} - ' || v_contact;
    begin
      perform app_private.sys_email(v_mail, 'dispatcher.carrier.chosen.receipt', 'Your carrier choice is with LoadBoot: ' || v_label, v_html, v_text, 'disp.choice.receipt:' || v_id::text);
    exception when others then null; end;
  end if;

  perform app_private.disp_audit('dispatcher.carrier.chosen', 'dispatcher_choice', v_id::text, p_org,
    coalesce(d.full_name,'dispatcher') || ' chose ' || coalesce(o.name,'carrier') || ' (' || v_match || ')',
    jsonb_build_object('note', v_note, 'dispatcher_equipment', v_disp, 'carrier_equipment', v_carr));
  return jsonb_build_object('ok', true, 'id', v_id, 'match_kind', v_match);
end $$;
revoke all on function public.dispatcher_choose_carrier(uuid, text) from public, anon;
grant execute on function public.dispatcher_choose_carrier(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 7. candidate: withdraw
create or replace function public.dispatcher_withdraw_choice() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); c record; v_name text; v_cname text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  update app_private.dispatcher_carrier_choices set status = 'withdrawn', decided_at = now(), updated_at = now()
   where dispatcher_user_id = v_uid and status = 'pending' returning * into c;
  if c.id is null then return jsonb_build_object('error','nothing to withdraw'); end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = v_uid;
  select name into v_cname from public.organizations where id = c.carrier_org_id;
  perform app_private.disp_notify(null, 'staff', 'dispatcher.carrier.withdrawn',
    coalesce(v_name,'Candidate') || ' withdrew the choice: ' || coalesce(v_cname,'carrier'),
    'The candidate can pick another from the portal.',
    '/app/command-center/#/dispatcher?id=' || v_uid::text || '&tab=carriers', false);
  perform app_private.disp_audit('dispatcher.carrier.withdrawn', 'dispatcher_choice', c.id::text, c.carrier_org_id,
    coalesce(v_name,'dispatcher') || ' withdrew ' || coalesce(v_cname,'carrier'), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.dispatcher_withdraw_choice() from public, anon;
grant execute on function public.dispatcher_withdraw_choice() to authenticated;

-- ---------------------------------------------------------------- 8. staff: the queue
create or replace function public.cc_dispatcher_choices(p_status text default 'pending', p_user uuid default null) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'status', c.status, 'match_kind', c.match_kind, 'note', c.dispatcher_note,
        'created_at', c.created_at, 'decided_at', c.decided_at, 'decision_note', c.decision_note, 'assignment_id', c.assignment_id,
        'age_hours', round(extract(epoch from (now() - c.created_at))/3600, 1),
        'dispatcher_user_id', c.dispatcher_user_id,
        'dispatcher', (select jsonb_build_object('name', d.full_name, 'status', d.status, 'years_exp', d.years_exp, 'country', d.country, 'city', d.city,
              'commission_pct', d.commission_pct, 'trial_start', d.trial_start, 'trial_end', d.trial_end,
              'equipment', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(c.dispatcher_equipment) e),
              'load_boards', d.load_boards, 'hours', d.skills->>'availability_hours', 'timezone', d.skills->>'timezone',
              'score', (select a.staff_score || ' / ' || coalesce(a.max_score::text,'100') from app_private.skills_test_attempts a where a.user_id = c.dispatcher_user_id and a.decision = 'pass' order by a.reviewed_at desc nulls last limit 1))
            from app_private.dispatcher_profiles d where d.user_id = c.dispatcher_user_id),
        'carrier_org_id', c.carrier_org_id,
        'carrier', (select jsonb_build_object('name', o.name,
              'equipment', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(c.carrier_equipment) e),
              'trucks', (select count(*) from app_private.fleet_trucks t where t.carrier_id = o.id and coalesce(t.status,'active') not in ('inactive','retired')),
              'home_base', coalesce((select nullif(p.home_base,'') from app_private.carrier_dispatch_prefs p where p.carrier_id = o.id),
                                    (select nullif(concat_ws(', ', nullif(t.domicile_city,''), nullif(t.domicile_state,'')), '') from app_private.fleet_trucks t where t.carrier_id = o.id order by t.created_at limit 1)),
              'min_rpm', (select p.min_rpm from app_private.carrier_dispatch_prefs p where p.carrier_id = o.id),
              'still_available', app_private.disp_carrier_available(o.id, c.dispatcher_user_id),
              'competing', (select count(*) from app_private.dispatcher_carrier_choices x where x.carrier_org_id = o.id and x.status = 'pending' and x.id <> c.id))
            from public.organizations o where o.id = c.carrier_org_id)
      ) order by c.created_at desc)
      from app_private.dispatcher_carrier_choices c
     where (p_status is null or p_status = 'all' or c.status = p_status)
       and (p_user is null or c.dispatcher_user_id = p_user)
     limit 200), '[]'::jsonb) end
$$;
revoke all on function public.cc_dispatcher_choices(text, uuid) from public, anon;
grant execute on function public.cc_dispatcher_choices(text, uuid) to authenticated;

-- ---------------------------------------------------------------- 9. staff: accept / decline
-- accept = (trial if not already on trial/verified/active) + assign, atomically: a failed assign
-- RAISES so the status change rolls back with it. The terms (commission %, window) are set by the
-- CC dialog through cc_dispatcher_set_terms BEFORE this call, exactly like "Move to trial" today.
create or replace function public.cc_dispatcher_choice_decide(p_id uuid, p_action text, p_note text default null, p_sop jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare c record; d record; o record; r jsonb; r2 jsonb; v_trial boolean := false; v_mail text; v_html text; v_text text;
        v_contact text := app_private.disp_contact()->>'email'; v_note text := nullif(btrim(coalesce(p_note,'')), ''); v_label text; x record; v_others int := 0; v_oname text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into c from app_private.dispatcher_carrier_choices where id = p_id for update;
  if c.id is null then return jsonb_build_object('error','choice not found'); end if;
  v_label := app_private.disp_carrier_label(c.carrier_org_id);
  if c.status <> 'pending' then return jsonb_build_object('error','this choice was already ' || c.status); end if;
  select full_name, status into d from app_private.dispatcher_profiles where user_id = c.dispatcher_user_id;
  select id, name into o from public.organizations where id = c.carrier_org_id;

  if p_action = 'accept' then
    if not app_private.disp_carrier_available(c.carrier_org_id, c.dispatcher_user_id) then
      return jsonb_build_object('error','this carrier is no longer available (assigned or paused) — decline the choice so the candidate can pick again');
    end if;
    if d.status not in ('trial','verified','active') then
      r := public.cc_dispatcher_decide(c.dispatcher_user_id, 'trial', v_note);
      if r ? 'error' then raise exception 'trial: %', r->>'error'; end if;
      v_trial := true;
    end if;
    r2 := public.cc_dispatcher_assign(c.dispatcher_user_id, c.carrier_org_id, coalesce(p_sop,'{}'::jsonb));
    if r2 ? 'error' then raise exception 'assign: %', r2->>'error'; end if;
    update app_private.dispatcher_carrier_choices
       set status = 'accepted', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, assignment_id = (r2->>'assignment')::uuid, updated_at = now()
     where id = c.id;
    -- shared choice: every other pending choice on this carrier is declined and its candidate told to choose again
    for x in update app_private.dispatcher_carrier_choices
               set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = 'assigned to another dispatcher', updated_at = now()
             where carrier_org_id = c.carrier_org_id and status = 'pending' and id <> c.id
             returning id, dispatcher_user_id loop
      v_others := v_others + 1;
      perform app_private.disp_notify(x.dispatcher_user_id, 'dispatcher', 'dispatcher.carrier.assigned_elsewhere',
        'Your chosen carrier was assigned to another dispatcher',
        v_label || ' went to another candidate. Your "Choose your carrier" tab is open again — visit your portal to see the carriers open today and choose again.',
        '/app/agent/#dashboard', false);
      select u.email into v_mail from auth.users u where u.id = x.dispatcher_user_id;
      select coalesce(nullif(full_name,''), 'Dispatcher') into v_oname from app_private.dispatcher_profiles where user_id = x.dispatcher_user_id;
      if v_mail is not null then
        v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
          || app_private.disp_head('LoadBoot Dispatch &middot; Carrier choice', 'Your chosen carrier was assigned to another dispatcher')
          || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(v_oname) || ', more than one candidate chose <b>' || v_label || '</b>. LoadBoot assigned it to another dispatcher. Nothing is held against you &mdash; it is simply taken.</p>'
          || app_private.disp_box('What to do now', 'Open your portal &mdash; the <b>Choose your carrier</b> tab is open again with every carrier that is available today. Pick the one that fits your experience best; the carriers whose equipment you know are listed first. If none is open today, the tab says so and we tell you the moment one opens.')
          || app_private.disp_btn('Choose another carrier', 'https://loadboot.com/app/agent/#dashboard')
          || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_contact || '</span></p>'
          || '<p style="color:#8ea2c3;font-size:12px;margin:0">Transactional notice about your LoadBoot dispatcher application.</p></div>';
        v_text := 'Dear ' || v_oname || E',\n\nMore than one candidate chose ' || v_label || E'. LoadBoot assigned it to another dispatcher.\n\nPlease choose another carrier in your portal: https://loadboot.com/app/agent/#dashboard\n\nLoadBoot Dispatch - {{contact_inline}} - ' || v_contact;
        begin
          perform app_private.sys_email(v_mail, 'dispatcher.carrier.assigned_elsewhere', 'Your chosen carrier was assigned to another dispatcher — please choose again', v_html, v_text, 'disp.choice.elsewhere:' || x.id::text);
        exception when others then null; end;
      end if;
    end loop;
    perform app_private.disp_audit('dispatcher.carrier.choice.accept', 'dispatcher_choice', c.id::text, c.carrier_org_id,
      coalesce(d.full_name,'dispatcher') || ' → ' || coalesce(o.name,'carrier') || case when v_trial then ' (trial started)' else '' end || case when v_others > 0 then ' · ' || v_others || ' other candidate(s) told to choose again' else '' end,
      jsonb_build_object('note', v_note, 'assignment', r2->>'assignment', 'others_declined', v_others));
    return jsonb_build_object('ok', true, 'assignment', r2->'assignment', 'trial_started', v_trial, 'warning', r->'warning', 'others_declined', v_others);

  elsif p_action = 'decline' then
    update app_private.dispatcher_carrier_choices
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now()
     where id = c.id;
    perform app_private.disp_notify(c.dispatcher_user_id, 'dispatcher', 'dispatcher.carrier.declined',
      'Please choose another carrier',
      'LoadBoot could not confirm ' || v_label || coalesce(': ' || v_note, '.') || ' Your "Choose your carrier" tab is open again.',
      '/app/agent/#dashboard', false);
    select u.email into v_mail from auth.users u where u.id = c.dispatcher_user_id;
    if v_mail is not null then
      v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
        || app_private.disp_head('LoadBoot Dispatch &middot; Carrier choice', 'Please choose another carrier')
        || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(d.full_name,''),'Dispatcher')) || ', LoadBoot could not confirm <b>' || v_label || '</b> for you.</p>'
        || case when v_note is not null then app_private.disp_box('From LoadBoot', replace(app_private.disp_esc(v_note), E'\n', '<br>'), 'note') else '' end
        || app_private.disp_box('What to do now', 'Open your portal &mdash; the <b>Choose your carrier</b> tab is open again with every carrier that is available today. Pick the one that fits your experience best; the carriers whose equipment you know are listed first.')
        || app_private.disp_btn('Choose another carrier', 'https://loadboot.com/app/agent/#dashboard')
        || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_contact || '</span></p>'
        || '<p style="color:#8ea2c3;font-size:12px;margin:0">Transactional notice about your LoadBoot dispatcher application.</p></div>';
      v_text := 'Dear ' || coalesce(nullif(d.full_name,''),'Dispatcher') || E',\n\nLoadBoot could not confirm ' || v_label || coalesce(E' for you: ' || v_note, ' for you.') || E'\n\nPlease choose another carrier in your portal: https://loadboot.com/app/agent/#dashboard\n\nLoadBoot Dispatch - {{contact_inline}} - ' || v_contact;
      begin
        perform app_private.sys_email(v_mail, 'dispatcher.carrier.declined', 'Please choose another carrier — ' || v_label, v_html, v_text, 'disp.choice.declined:' || c.id::text);
      exception when others then null; end;
    end if;
    perform app_private.disp_audit('dispatcher.carrier.choice.decline', 'dispatcher_choice', c.id::text, c.carrier_org_id,
      coalesce(d.full_name,'dispatcher') || ' ✕ ' || coalesce(o.name,'carrier'), jsonb_build_object('note', v_note));
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('error','bad action');
end $$;
revoke all on function public.cc_dispatcher_choice_decide(uuid, text, text, jsonb) from public, anon;
grant execute on function public.cc_dispatcher_choice_decide(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- 10. e-mail catalog (rule §6)
insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   preference_group, unsub_allowed, cc_deep_link, status, discovered_in)
values
  ('dispatcher.carrier.chosen', 'Carrier choice — staff notice',
   'A passed candidate picked a carrier in the portal: candidate profile, carrier snapshot, match, note, Accept/Decline link',
   'S', 'staff', 'event', 'public.dispatcher_choose_carrier', 'once per choice', 'once (idempotency disp.choice.staff:<choice>)',
   'staff_internal', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.carrier.chosen.receipt', 'Carrier choice — receipt',
   'Candidate receipt: LoadBoot reviews the choice (others may choose the same carrier); what happens next; how to withdraw',
   'T', 'dispatcher', 'event', 'public.dispatcher_choose_carrier', 'once per choice', 'once (idempotency disp.choice.receipt:<choice>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.carrier.assigned_elsewhere', 'Carrier choice — assigned to another dispatcher',
   'CC accepted another candidate for the carrier this candidate chose: the tab is open again, choose another',
   'T', 'dispatcher', 'event', 'public.cc_dispatcher_choice_decide', 'once per competing choice', 'once (idempotency disp.choice.elsewhere:<choice>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.carrier.declined', 'Carrier choice — declined',
   'CC declined the candidate''s carrier choice: reason + the tab is open again to choose another',
   'T', 'dispatcher', 'event', 'public.cc_dispatcher_choice_decide', 'once per decision', 'once (idempotency disp.choice.declined:<choice>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed, cc_deep_link = excluded.cc_deep_link,
  status = 'live', updated_at = now();

-- ---------------------------------------------------------------- 11. the pass e-mail now points at the portal
-- Same function, same idempotency, same catalog key (dispatcher.test_passed). Only the copy changes:
-- "a coordinator will reach out" → "sign in and choose your carrier".
create or replace function app_private.disp_test_pass_email(p_attempt uuid) returns void
language plpgsql security definer set search_path = app_private, public as $$
declare v_user uuid; v_mail text; v_name text; v_html text;
begin
  select user_id into v_user from app_private.skills_test_attempts where id = p_attempt;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (v_user, 'in_app', 'dispatcher.test_passed_inapp',
      jsonb_build_object('title', 'You passed the skills test — choose your carrier', 'body', 'The carriers open for a dedicated dispatcher are in your portal with their full fleet book. Pick the one that fits your experience.', 'tone', 'success', 'url', '/app/agent/#dashboard'),
      'sent', now());
  exception when others then null; end;
  if v_user is null then return; end if;
  select u.email into v_mail from auth.users u where u.id = v_user;
  if v_mail is null then return; end if;
  select coalesce(nullif(initcap(split_part(trim(full_name), ' ', 1)), ''), 'there') into v_name
    from app_private.dispatcher_profiles where user_id = v_user;

  v_html :=
       '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#16a34a;text-transform:uppercase">Result</p>'
    || '<h2 style="margin:0 0 10px;color:#10223B;font-size:24px">You passed the skills test</h2>'
    || '<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">Hi ' || v_name
    || ' — thank you for taking the time. You passed, and we would like to move ahead with you.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px;color:#334155">'
    || '<tr><td style="padding:14px 16px;background:#f1f5f9;border-radius:10px;line-height:1.9">'
    || '<b style="color:#10223B">What happens next</b><br>'
    || '<b>1.</b> Sign in to your LoadBoot dispatcher portal. A new tab, <b>Choose your carrier</b>, lists every carrier that is open for a dedicated dispatcher right now — every truck, every preference, every constraint, the age of each authority.<br>'
    || '<b>2.</b> The carriers whose equipment you told us you can manage are listed first. Pick the one you want to dispatch for.<br>'
    || '<b>3.</b> LoadBoot confirms it, your 10 working day paid trial starts, and you receive that carrier''s full operating brief before your first call.'
    || '</td></tr></table>'
    || '<p style="margin:18px 0 0"><a href="https://loadboot.com/app/agent/#dashboard" style="display:inline-block;background:#0883F7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px">Choose my carrier</a></p>'
    || '<p style="margin:14px 0 0;color:#334155;font-size:14px;line-height:1.7">If no carrier is open today the tab says so — we onboard carriers every week and will tell you the moment one opens.</p>'
    || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Sent because you applied to dispatch for LoadBoot. This is a transactional notice about your application, not a marketing e-mail.</p>';

  begin
    perform app_private.sys_email(v_mail, 'dispatcher.test_passed',
      'LoadBoot Dispatcher — you passed the skills test: choose your carrier',
      v_html, null, 'disppass:' || p_attempt::text);
  exception when others then null; end;
end $$;
revoke all on function app_private.disp_test_pass_email(uuid) from public, anon;

-- ---------------------------------------------------------------- 12. after-apply check (run by hand, both DBs)
-- select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1;
-- → must equal docs/audit-2026-09/anon-secdef-baseline.md (33 prod / 32 staging), no new names.
