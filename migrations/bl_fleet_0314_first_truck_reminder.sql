-- bl_fleet_0314 — Carrier 360 Fleet: first-truck reminder + truthful reminder history.
--
-- Staff can send one premium in-app + email reminder when a carrier has no truck row.
-- The Fleet card also shows this reminder's email delivery state and the existing general
-- onboarding cron history.  The latter is deliberately labelled "general onboarding":
-- cc_run_onboarding_reminders() chases documents, not the missing first truck.
--
-- No new automatic sender is introduced here, so carriers do not receive a second D1/D3/D7
-- ladder beside the capped onboarding ladder.  Manual sends share a six-hour carrier-level
-- cooldown and are written to audit_logs.
-- Applied to staging + production 2026-09-03; no reminder RPC was invoked during verification.

create or replace function public.cc_fleet_truck_remind(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_email text;
  v_carrier text;
  v_safe_carrier text;
  v_idem text;
  v_email_status text;
begin
  if not (public.has_global_permission('carriers.approve')
          or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select o.id, o.owner_user_id, u.email, o.name
    into v_org, v_owner, v_email, v_carrier
    from public.organizations o
    left join auth.users u on u.id = o.owner_user_id
   where o.kind = 'carrier' and (o.id = p_org or o.owner_user_id = p_org)
   limit 1;

  if v_org is null or v_owner is null then
    raise exception 'carrier owner not found' using errcode = '22023';
  end if;
  if exists (select 1 from app_private.fleet_trucks t where t.carrier_id = v_org) then
    raise exception 'this carrier already has a truck registered' using errcode = '22023';
  end if;
  if exists (
    select 1
      from app_private.notifications n
     where n.recipient_user = v_owner
       and n.template_key = 'fleet.first_truck_reminder'
       and n.created_at > now() - interval '6 hours'
  ) then
    raise exception 'a first-truck reminder went out in the last 6 hours — give them a moment'
      using errcode = '22023';
  end if;

  v_idem := 'fleetfirst:' || v_org::text || ':manual:' || to_char(now(), 'YYYYMMDDHH24');
  v_safe_carrier := replace(replace(replace(replace(coalesce(v_carrier, 'your company'),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');

  insert into app_private.notifications(
    recipient_user, channel, template_key, payload, status, sent_at
  ) values (
    v_owner,
    'in_app',
    'fleet.first_truck_reminder',
    jsonb_build_object(
      'title', '🚛 Add your first truck to start moving loads',
      'body', 'Your Fleet is still empty. Add the truck, VIN, capacity and loading equipment so dispatch can find loads the truck can actually handle.',
      'tone', 'warning',
      'url', '/app/carrier/#fleet/add-truck',
      'source', 'manual',
      'email_idem', v_idem
    ),
    'sent',
    now()
  );

  begin
    if v_email is not null then
      perform app_private.sys_email(
        v_email,
        'fleet.first_truck_reminder',
        'LoadBoot: add your first truck so dispatch can start matching loads',
        '<h2 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0b1220">Your Fleet is one truck short 🚛</h2>'
        || '<p style="color:#475569;margin:0 0 14px;line-height:1.7">Hi ' || v_safe_carrier || ', your LoadBoot Fleet is still empty. Add the truck you want us to dispatch so we can match freight to its real size, payload, doors and loading equipment.</p>'
        || '<div style="background:#f8fafc;border:1px solid #e6ebf3;border-radius:12px;padding:14px 16px;margin:0 0 18px">'
        || '<b style="color:#10223B">What to have ready</b>'
        || '<p style="color:#475569;margin:6px 0 0;line-height:1.7">Unit number, VIN, equipment type, payload, cargo dimensions, liftgate/loading gear and operating preferences. You can save only the fields that apply to your truck.</p></div>'
        || '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#FC5305">'
        || '<a href="https://loadboot.com/app/carrier/#fleet/add-truck" style="display:inline-block;padding:14px 26px;color:#ffffff;font-weight:800;text-decoration:none;font-size:15px">Add my truck →</a>'
        || '</td></tr></table>'
        || '<p style="color:#64748b;font-size:13px;line-height:1.7;margin:18px 0 0">Accurate truck details prevent incompatible load offers. Need help? Reply to this email or message LoadBoot support.</p>',
        'Your LoadBoot Fleet is empty. Add your truck, VIN, capacity and loading equipment at https://loadboot.com/app/carrier/#fleet/add-truck so dispatch can match compatible loads.',
        v_idem
      );
    end if;
  exception when others then
    raise warning 'cc_fleet_truck_remind: email queue failed for org %: %', v_org, sqlerrm;
  end;

  select md.status
    into v_email_status
    from app_private.message_deliveries md
   where md.idempotency_key = v_idem
   order by md.created_at desc
   limit 1;

  insert into app_private.audit_logs(
    actor_id, actor_is_staff, action, target_type, target_id, target_org_id, summary, detail
  ) values (
    auth.uid(), true, 'carrier.fleet_first_truck_reminder', 'carrier', v_org::text, v_org,
    'Sent first-truck reminder to ' || coalesce(v_carrier, 'carrier'),
    jsonb_build_object(
      'channels', jsonb_build_array('in_app', 'email'),
      'email_status', coalesce(v_email_status, 'not_queued'),
      'recipient_email', v_email
    )
  );

  return jsonb_build_object(
    'ok', true,
    'sent_to', v_email,
    'in_app', 'sent',
    'email_status', coalesce(v_email_status, 'not_queued'),
    'sent_at', now()
  );
end;
$function$;

create or replace function public.cc_fleet_truck_reminder_status(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_manual_count int := 0;
  v_auto_count int := 0;
  v_last_manual timestamptz;
  v_last_auto timestamptz;
  v_last_auto_stage text;
  v_history jsonb := '[]'::jsonb;
  v_truck_count int := 0;
begin
  if not (public.has_global_permission('carriers.view')
          or public.has_global_permission('carriers.approve')
          or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select o.id, o.owner_user_id into v_org, v_owner
    from public.organizations o
   where o.kind = 'carrier' and (o.id = p_org or o.owner_user_id = p_org)
   limit 1;
  if v_org is null or v_owner is null then
    raise exception 'carrier owner not found' using errcode = '22023';
  end if;

  select count(*) into v_truck_count
    from app_private.fleet_trucks t where t.carrier_id = v_org;

  select count(*), max(n.created_at)
    into v_manual_count, v_last_manual
    from app_private.notifications n
   where n.recipient_user = v_owner
     and n.template_key = 'fleet.first_truck_reminder'
     and coalesce(n.payload->>'source', 'manual') = 'manual';

  select count(*), max(s.sent_at)
    into v_auto_count, v_last_auto
    from app_private.onboarding_reminders_sent s
   where s.user_id = v_owner
     and (s.stage like 'nudge!_%' escape '!' or s.stage in ('onb_d1', 'onb_d3', 'onb_d7'));

  select s.stage into v_last_auto_stage
    from app_private.onboarding_reminders_sent s
   where s.user_id = v_owner
     and (s.stage like 'nudge!_%' escape '!' or s.stage in ('onb_d1', 'onb_d3', 'onb_d7'))
   order by s.sent_at desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'source', h.source,
           'sent_at', h.sent_at,
           'stage', h.stage,
           'title', h.title,
           'in_app_status', h.in_app_status,
           'email_status', h.email_status
         ) order by h.sent_at desc), '[]'::jsonb)
    into v_history
    from (
      select * from (
        select
          'manual_truck'::text as source,
          n.created_at as sent_at,
          null::text as stage,
          n.payload->>'title' as title,
          n.status as in_app_status,
          md.status as email_status
        from app_private.notifications n
        left join lateral (
          select d.status
            from app_private.message_deliveries d
           where d.idempotency_key = n.payload->>'email_idem'
           order by d.created_at desc
           limit 1
        ) md on true
        where n.recipient_user = v_owner
          and n.template_key = 'fleet.first_truck_reminder'

        union all

        select
          'automatic_onboarding'::text as source,
          s.sent_at,
          s.stage,
          'General onboarding reminder'::text as title,
          'sent'::text as in_app_status,
          md.status as email_status
        from app_private.onboarding_reminders_sent s
        left join lateral (
          select d.status
            from app_private.message_deliveries d
           where d.idempotency_key = 'onbremind:' || v_owner::text || ':' || s.stage
           order by d.created_at desc
           limit 1
        ) md on true
        where s.user_id = v_owner
          and (s.stage like 'nudge!_%' escape '!' or s.stage in ('onb_d1', 'onb_d3', 'onb_d7'))
      ) all_history
      order by sent_at desc
      limit 8
    ) h;

  return jsonb_build_object(
    'truck_count', v_truck_count,
    'last_manual', v_last_manual,
    'manual_count', v_manual_count,
    'last_auto_onboarding', v_last_auto,
    'last_auto_onboarding_stage', v_last_auto_stage,
    'auto_onboarding_count', v_auto_count,
    'auto_onboarding_schedule', 'Daily at 14:00 UTC',
    'automatic_first_truck_enabled', false,
    'history', v_history
  );
end;
$function$;

-- Repair the existing Onboarding card's source labels.  Automatic rows do not carry the
-- manual RPC's payload.doc, and onboarding_reminders_sent has no org_id column in either DB.
create or replace function public.cc_onboarding_reminder_status(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
declare
  v_owner uuid;
  v_last_manual timestamptz;
  v_last_auto timestamptz;
  v_last_auto_stage text;
  v_manual_count int := 0;
  v_auto_count int := 0;
begin
  if not (public.has_global_permission('carriers.approve')
          or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select o.owner_user_id into v_owner
    from public.organizations o
   where o.id = p_org or o.owner_user_id = p_org
   limit 1;

  select count(*), max(n.created_at)
    into v_manual_count, v_last_manual
    from app_private.notifications n
   where n.recipient_user = v_owner
     and n.template_key = 'onboarding.reminder'
     and n.payload ? 'doc';

  select count(*), max(s.sent_at)
    into v_auto_count, v_last_auto
    from app_private.onboarding_reminders_sent s
   where s.user_id = v_owner
     and (s.stage like 'nudge!_%' escape '!' or s.stage in ('onb_d1', 'onb_d3', 'onb_d7'));

  select s.stage into v_last_auto_stage
    from app_private.onboarding_reminders_sent s
   where s.user_id = v_owner
     and (s.stage like 'nudge!_%' escape '!' or s.stage in ('onb_d1', 'onb_d3', 'onb_d7'))
   order by s.sent_at desc
   limit 1;

  return jsonb_build_object(
    'last_manual', v_last_manual,
    'manual_count', v_manual_count,
    'last_auto', v_last_auto,
    'last_auto_stage', v_last_auto_stage,
    'auto_count', v_auto_count,
    'auto_engine', 'Automatic onboarding nags run daily at 14:00 UTC and stop after the capped D1/D3/D7 ladder. They chase onboarding documents; first-truck reminders are manual.'
  );
end;
$function$;

revoke all on function public.cc_fleet_truck_remind(uuid) from anon, public;
revoke all on function public.cc_fleet_truck_reminder_status(uuid) from anon, public;
revoke all on function public.cc_onboarding_reminder_status(uuid) from anon, public;
grant execute on function public.cc_fleet_truck_remind(uuid) to authenticated;
grant execute on function public.cc_fleet_truck_reminder_status(uuid) to authenticated;
grant execute on function public.cc_onboarding_reminder_status(uuid) to authenticated;
