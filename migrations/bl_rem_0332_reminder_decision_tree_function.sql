-- bl_rem_0332_reminder_decision_tree_function
--
-- The decision tree itself. One function, one answer per carrier.
--
-- Order matters and is deliberate — the checks run hardest-blocker-first:
--   0. onboarding not finished  -> silence (cc_run_onboarding_reminders owns them)
--   1. no truck                 -> truck_continue (draft open) / truck_add
--   2. trucks but none usable   -> truck_continue          (no VIN / no payload)
--   3. usable truck, no driver  -> driver_add
--   4. fleet ready              -> avail_confirm / avail_continue / avail_start
--   and a post confirmed in the last 24h means nothing is owed today.
--
-- The rule Yaseen asked for is structural rather than incidental: because the truck
-- branches are checked before the driver branch, a carrier who added a DRIVER first
-- and still has no truck can never be sent the driver email.
--
-- Why step 0 exists (measured on production, 46 active carriers):
--   30 of them are 'not_started' in document onboarding with no verified COI, no
--   truck and no driver. app_private.trg_fleet_truck_coi_gate REFUSES to insert a
--   truck until a certificate of insurance is verified (LB004), so "add your first
--   truck" would send those 30 to a form that turns them away — while
--   cc_run_onboarding_reminders (14:00 UTC) is already emailing them about the
--   documents. Silence is the correct answer there.
--
-- Verified on staging with a 14-case truth table before it went to production.

create or replace function app_private.reminder_for_carrier(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare v_trucks int; v_trucks_bad int; v_drivers int; v_posts int; v_last timestamptz;
        v_draft_avail timestamptz; v_draft_truck timestamptz;
        v_onb text; v_coi boolean;
begin
  select count(*), count(*) filter (where vin is null or length(vin) <> 17 or payload_lbs is null)
    into v_trucks, v_trucks_bad
    from app_private.fleet_trucks
   where carrier_id = p_org and coalesce(status,'active') not in ('inactive','retired');

  -- 0. Onboarding gate.
  v_onb := app_private.carrier_onboarding_state(p_org) ->> 'state';
  if v_onb = 'declined' then return null; end if;

  if v_trucks = 0 then
    select exists (
      select 1 from app_private.carrier_compliance cc
       where cc.carrier_id = p_org
         and cc.requirement_key = 'insurance_coi'
         and cc.status = 'valid'
         and (cc.expiry_date is null or cc.expiry_date >= current_date)
    ) into v_coi;
    -- No truck AND no verified COI: the only email we could send points at a form
    -- that will reject them. Leave them to the onboarding reminder.
    if not v_coi then return null; end if;
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

  -- 1. No truck at all.
  if v_trucks = 0 then
    if v_draft_truck is not null then return 'truck_continue'; end if;  -- opened the form, walked away
    return 'truck_add';                                                -- never started
  end if;

  -- 2. Truck rows exist but not one of them is dispatchable.
  if v_trucks_bad = v_trucks then return 'truck_continue'; end if;

  -- 3. Usable truck, no driver.
  if v_drivers = 0 then return 'driver_add'; end if;

  -- 4. Fleet is ready. Availability is the only thing between them and freight.
  if v_last is not null then return 'avail_confirm'; end if;           -- posted before, now stale
  if v_draft_avail is not null then return 'avail_continue'; end if;   -- opened the form, walked away
  return 'avail_start';                                                -- never posted at all
end $function$;

revoke execute on function app_private.reminder_for_carrier(uuid) from anon, public, authenticated;
