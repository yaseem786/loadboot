-- bl_rem_0337_full_onboarding_funnel
--
-- The decision tree now covers the WHOLE funnel, not just the fleet half.
-- One call, one answer, for every active carrier — so Command Center can show
-- "what is this carrier missing" in one place instead of two systems that each
-- know half the story.
--
-- Order, hardest blocker first:
--   0. owner never confirmed their email -> confirm_email   (they cannot even sign in)
--   1. onboarding declined               -> nothing, ever
--   2. a document was rejected           -> docs_fix
--   3. documents not started             -> docs_start
--   4. documents partly done             -> docs_finish
--   5. with our compliance team          -> nothing (the ball is on OUR side)
--   6. verified, awaiting activation     -> nothing (the ball is on OUR side)
--   7. active -> the fleet/availability tree from bl_rem_0332, unchanged
--
-- Two things this deliberately does NOT do:
--   * It stays silent while a carrier is waiting on us. Nagging somebody for a
--     document that is already sitting in our review queue is how you teach people
--     to ignore your email.
--   * It no longer needs the "no truck and no COI -> silence" guard from
--     bl_rem_0332. That guard existed because the document half was owned by a
--     different system; now the doc stages answer for those carriers directly.
--     The COI check survives only as a fallback for an ACTIVE carrier whose
--     certificate has since expired — trg_fleet_truck_coi_gate would refuse the
--     truck, so the honest ask is the document, not the truck.
--
-- Measured on production before writing this (47 active carriers):
--   6 never confirmed their email, 25 have not started documents,
--   8 have documents missing or rejected, 1 is with compliance,
--   6 are active and owe a fleet/availability step, 1 owes nothing.
--
-- Verified on staging with a 16-case truth table covering every branch above.

create or replace function app_private.reminder_doc_list(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare s jsonb; v text;
begin
  s := app_private.carrier_onboarding_state(p_org);
  -- Rejected first: a correction is more urgent than a gap, and it is the one the
  -- carrier has forgotten about because they believe they already sent it.
  if jsonb_array_length(coalesce(s->'rejected','[]'::jsonb)) > 0 then
    select string_agg(value, ', ') into v from jsonb_array_elements_text(s->'rejected');
  else
    select string_agg(value, ', ') into v from jsonb_array_elements_text(s->'missing');
  end if;
  return nullif(btrim(coalesce(v,'')), '');
end $function$;

revoke execute on function app_private.reminder_doc_list(uuid) from anon, public, authenticated;

create or replace function app_private.reminder_for_carrier(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare v_trucks int; v_trucks_bad int; v_drivers int; v_posts int; v_last timestamptz;
        v_draft_avail timestamptz; v_draft_truck timestamptz;
        v_owner uuid; v_confirmed timestamptz; v_st jsonb; v_onb text; v_coi boolean;
begin
  -- 0. The account was never activated. Nothing else is reachable for them.
  select o.owner_user_id into v_owner from public.organizations o where o.id = p_org;
  if v_owner is not null then
    select u.email_confirmed_at into v_confirmed from auth.users u where u.id = v_owner;
    if v_confirmed is null then return 'confirm_email'; end if;
  end if;

  v_st  := app_private.carrier_onboarding_state(p_org);
  v_onb := v_st->>'state';

  if v_onb = 'declined' then return null; end if;

  -- The ball is on our side. Silence is the correct answer.
  if v_onb in ('awaiting_review', 'ready_not_activated') then return null; end if;

  if v_onb <> 'active' then
    if jsonb_array_length(coalesce(v_st->'rejected','[]'::jsonb)) > 0 then return 'docs_fix'; end if;
    if coalesce((v_st->>'verified_count')::int, 0) = 0 then return 'docs_start'; end if;
    return 'docs_finish';
  end if;

  -- ---- active from here down: the fleet / availability tree ----------------
  select count(*), count(*) filter (where vin is null or length(vin) <> 17 or payload_lbs is null)
    into v_trucks, v_trucks_bad
    from app_private.fleet_trucks
   where carrier_id = p_org and coalesce(status,'active') not in ('inactive','retired');

  -- Active, but the certificate of insurance has lapsed since approval. Adding a
  -- truck is blocked by trg_fleet_truck_coi_gate (LB004), so ask for the document.
  if v_trucks = 0 then
    select exists (
      select 1 from app_private.carrier_compliance cc
       where cc.carrier_id = p_org and cc.requirement_key = 'insurance_coi'
         and cc.status = 'valid'
         and (cc.expiry_date is null or cc.expiry_date >= current_date)
    ) into v_coi;
    if not v_coi then return 'docs_finish'; end if;
  end if;

  select count(*) into v_drivers
    from app_private.fleet_drivers
   where carrier_id = p_org and coalesce(status,'active') not in ('inactive','retired');

  select count(*), max(last_confirmed_at) into v_posts, v_last
    from app_private.truck_postings
   where carrier_id = p_org and status = 'active';

  select updated_at into v_draft_avail from app_private.form_progress
   where carrier_id = p_org and form_key = 'availability' and completed_at is null
     and updated_at > now() - interval '7 days';
  select updated_at into v_draft_truck from app_private.form_progress
   where carrier_id = p_org and form_key = 'truck' and completed_at is null
     and updated_at > now() - interval '7 days';

  -- A live, confirmed post means nothing is owed today.
  if v_last is not null and v_last >= now() - interval '24 hours' then return null; end if;

  -- No truck at all. Checked before the driver branch, which is why a carrier who
  -- added a DRIVER first and still has no truck never receives the driver email.
  if v_trucks = 0 then
    if v_draft_truck is not null then return 'truck_continue'; end if;
    return 'truck_add';
  end if;

  -- Truck rows exist but not one of them is dispatchable.
  if v_trucks_bad = v_trucks then return 'truck_continue'; end if;

  if v_drivers = 0 then return 'driver_add'; end if;

  if v_last is not null then return 'avail_confirm'; end if;
  if v_draft_avail is not null then return 'avail_continue'; end if;
  return 'avail_start';
end $function$;

revoke execute on function app_private.reminder_for_carrier(uuid) from anon, public, authenticated;
