-- bl_rem_0342_carrier_reminder_checklist
--
-- "If several things are missing, is there one button for all of them, or does each
-- missing thing show separately?"
--
-- The EMAIL stays one at a time, and that is deliberate. Measured on production:
-- of the 46 carriers owed something, 39 have exactly one gap. Of the 7 with more
-- than one, 6 are "email never confirmed + documents" — and they cannot touch the
-- documents until they can sign in, so asking for both in one email would be asking
-- for something they are not able to do yet. One email, one action, is also simply
-- what gets acted on. (Within the document stage the email already names EVERY
-- outstanding document at once — that part was never one-at-a-time.)
--
-- The SCREEN is a different question. Staff looking at a carrier record should see
-- the whole picture, not just the next step, so cc_reminder_carrier now also returns
-- the full funnel as a checklist: every stage, done or not, with the detail, and a
-- flag on the one the button will actually send. Read-only; changes nothing about
-- what is sent.

create or replace function public.cc_reminder_carrier(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_key text; v_r record; v_tpl record; v_st jsonb; v_out jsonb;
  v_owner uuid; v_conf timestamptz;
  v_trucks int; v_trucks_ok int; v_drivers int; v_last timestamptz;
  v_open text; v_fresh boolean;
begin
  if not public.has_global_permission('carriers.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_r from app_private.reminder_recipients() t where t.org = p_org;
  v_key := app_private.reminder_for_carrier(p_org);
  v_st  := app_private.carrier_onboarding_state(p_org);

  if v_key is not null then
    select * into v_tpl from app_private.comm_templates where key = 'carrier.reminder.' || v_key;
  end if;

  select o.owner_user_id into v_owner from public.organizations o where o.id = p_org;
  if v_owner is not null then
    select u.email_confirmed_at into v_conf from auth.users u where u.id = v_owner;
  end if;

  select count(*), count(*) filter (where vin is not null and length(vin) = 17 and payload_lbs is not null)
    into v_trucks, v_trucks_ok
    from app_private.fleet_trucks
   where carrier_id = p_org and coalesce(status,'active') not in ('inactive','retired');

  select count(*) into v_drivers from app_private.fleet_drivers
   where carrier_id = p_org and coalesce(status,'active') not in ('inactive','retired');

  select max(last_confirmed_at) into v_last from app_private.truck_postings
   where carrier_id = p_org and status = 'active';
  v_fresh := v_last is not null and v_last >= now() - interval '24 hours';

  v_open := app_private.reminder_doc_list(p_org);

  v_out := jsonb_build_object(
    'reminder',       v_key,
    'onboarding',     v_st->>'state',
    'subject',        v_tpl.subject,
    'template_ready', (v_tpl.key is not null),
    'missing',        v_open,
    'email',          v_r.email,
    'opted_in',       coalesce(v_r.opted_in, false),
    'suppressed',     coalesce(v_r.suppressed, false),
    'reachable',      (v_r.email is not null),
    'due',            case when v_key is null then null else app_private.reminder_due(p_org, v_key) end,
    'last_sent',      (select max(sent_at) from app_private.reminder_log l
                        where l.carrier_id = p_org and (v_key is null or l.reminder_key = v_key)),
    'sent_before',    (select count(*) from app_private.reminder_log l
                        where l.carrier_id = p_org and (v_key is null or l.reminder_key = v_key)),
    'can_send',       app_private.can_manage_comms(),

    -- The whole funnel, in order, so staff see everything at once even though only
    -- one step is being emailed today. 'current' marks the step the button sends.
    'checklist', jsonb_build_array(
      jsonb_build_object(
        'label',   'Email confirmed',
        'done',    (v_conf is not null),
        'detail',  case when v_conf is not null then 'Signed in and active'
                        else 'Never clicked the confirmation link — cannot sign in at all' end,
        'current', (v_key = 'confirm_email')),
      jsonb_build_object(
        'label',   'Documents verified',
        'done',    coalesce((v_st->>'mandatory_ok')::boolean, false),
        'detail',  coalesce(v_st->>'verified_count','0') || ' of ' || coalesce(v_st->>'required_count','0') || ' verified'
                   || case when v_open is not null then ' · open: ' || v_open else '' end
                   || case when v_st->>'state' = 'awaiting_review' then ' · with our compliance team'
                           when v_st->>'state' = 'ready_not_activated' then ' · waiting on our activation decision'
                           else '' end,
        'current', (v_key in ('docs_start','docs_finish','docs_fix'))),
      jsonb_build_object(
        'label',   'Truck on file',
        'done',    (v_trucks_ok > 0),
        'detail',  case when v_trucks = 0 then 'No truck added'
                        when v_trucks_ok = 0 then v_trucks || ' truck(s), none dispatchable — VIN or payload missing'
                        else v_trucks_ok || ' of ' || v_trucks || ' dispatchable' end,
        'current', (v_key in ('truck_add','truck_continue'))),
      jsonb_build_object(
        'label',   'Driver on file',
        'done',    (v_drivers > 0),
        'detail',  case when v_drivers = 0 then 'Nobody assigned — a load cannot be dispatched'
                        else v_drivers || ' driver(s)' end,
        'current', (v_key = 'driver_add')),
      jsonb_build_object(
        'label',   'Availability posted',
        'done',    v_fresh,
        'detail',  case when v_last is null then 'Never posted — nothing can be matched to them'
                        when v_fresh then 'Confirmed in the last 24 hours'
                        else 'Last confirmed ' || to_char(v_last at time zone 'UTC','DD Mon HH24:MI') || ' UTC — off the board' end,
        'current', (v_key in ('avail_start','avail_continue','avail_confirm')))
    )
  );
  return v_out;
end $function$;

revoke execute on function public.cc_reminder_carrier(uuid) from anon, public;
grant  execute on function public.cc_reminder_carrier(uuid) to authenticated;
