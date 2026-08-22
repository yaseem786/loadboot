-- =====================================================================================
-- bl_nag_0270 — reminder caps + demo skip
-- Applied 2026-08-22 to STAGING then PROD.
--
-- AUDIT SCOPE: every non-outreach automated email. ~150 senders were classified; the great
-- majority are event-driven (fire once on an action) and cannot loop. The recurring ones
-- were each read for two properties: (a) does it re-read live state at send time, and
-- (b) does it ever stop.
--
-- CLEAN (verified, no change needed):
--   cc_run_onboarding_reminders   live carrier_onboarding_state every run; silent at
--                                 active/declined; lifetime cap of 3 chases; nudge key is
--                                 stamped with last_activity so carrier action resets it.
--                                 (This is the "activate your account" bug — already fixed.)
--   cron_offer_expiry_warnings    one-shot via expiry_warned_at + live offer status
--   cron_pickup_watch             fires only on a risk transition
--   fmcsa_authority_collect       authority_lapsed sits behind an UPDATE ... status <> 'expired'
--                                 so it fires on the edge only
--   cron_packet_revalidation      packet_revalidation_notices unique per (org,item,stage,cycle)
--   lc_lead_nudge / lc_lead_followup / lc_call_followup
--                                 skip anyone who became a customer (by email AND phone),
--                                 skip suppressions, skip if they replied, single nudge, time-boxed
--   carrier_expiry_notify_run     dedupe table + window + daily cap (bl_exp_0267-0269)
--
-- BROKEN — all three fixed here. Each one re-read live state correctly (so they DID stop
-- when the broker/carrier acted) but none had a ceiling: if the other side simply went
-- quiet, they chased forever.
--   1. cron_expired_load_nag      daily, unbounded. Also had NO demo guard — it was
--                                 processing 8 LoadBoot Demo Brokerage loads twice a day;
--                                 only a suppression on play.broker@loadboot.com stopped
--                                 the mail actually going out.
--   2. cron_broker_checklist_nag  every 2 hours, unbounded, and kept the 2-hourly cadence
--                                 even after the trip had delivered.
--   3. pay_confirm_nag            daily, unbounded.
--
-- PATTERN APPLIED: count the chases in a column, stop at the cap, raise ONE staff notice
-- so a person picks it up, and tell the recipient which reminder they are on ("3 of 4")
-- so the ceiling is honest rather than hidden.
-- =====================================================================================

alter table public.loads                        add column if not exists expired_notify_count int not null default 0;
alter table app_private.load_document_checklist add column if not exists nag_count            int not null default 0;
alter table app_private.pay_transfers           add column if not exists confirm_nag_count    int not null default 0;

-- NOTE: the "chasing stopped" staff notices below list 6 target columns and must supply
-- 6 values. An earlier draft supplied 4; the surrounding `exception when others then null`
-- swallowed the error and the notice silently never appeared. Caught by the staged test —
-- if you edit these inserts, re-run that test rather than trusting the handler.

-- ---------------------------------------------------------------- 1. expired load nag
create or replace function app_private.cron_expired_load_nag()
returns void
language plpgsql security definer
set search_path to 'app_private', 'public'
as $function$
declare r record; m record; c_max constant int := 4;
begin
  for r in
    select l.id, l.origin, l.destination, l.pickup_date, l.broker_org, l.expired_notify_count
      from public.loads l
      join public.organizations o on o.id = l.broker_org
     where l.status = 'available'
       and l.pickup_date is not null and l.pickup_date < current_date
       and l.pickup_date > current_date - 30            -- past a month it is abandoned, not forgotten
       and l.broker_org is not null
       and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
       and not coalesce((to_jsonb(l)->>'is_demo')::boolean, false)
       and (l.expired_notified_at is null or l.expired_notified_at < now() - interval '24 hours')
  loop
    if r.expired_notify_count >= c_max then
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
        select 'staff', 'in_app', 'load.expired_abandoned',
          jsonb_build_object('title','Expired load ignored after ' || c_max || ' reminders',
            'body', r.origin || ' → ' || r.destination || ' (pickup ' || to_char(r.pickup_date,'Mon DD')
                    || ') is still on the board with a dead date. The broker has stopped responding — cancel it or call them.',
            'tone','warning','url','/app/command-center/#loads','load', r.id),
          'sent', now()
        where not exists (select 1 from app_private.notifications n
                           where n.template_key='load.expired_abandoned' and n.payload->>'load' = r.id::text);
      exception when others then null; end;
      update public.loads set expired_notified_at = now() where id = r.id;
      continue;
    end if;

    begin
      perform app_private.notify_partner(r.broker_org,
        '⏰ Load EXPIRED — update the pickup date',
        r.origin || ' → ' || r.destination || ' had pickup on ' || to_char(r.pickup_date,'Mon DD') ||
        ', which has passed. It has been removed from the carrier load board. Open My Loads → "Update pickup time" to reschedule and put it back, or cancel it.',
        'warning', '/app/partner/#loads');
    exception when others then null; end;

    for m in select u.email from public.organization_memberships om
               join auth.users u on u.id = om.user_id
              where om.org_id = r.broker_org and om.status = 'active' limit 2
    loop
      begin
        perform app_private.sys_email(m.email, 'load.expired',
          '⏰ Load expired: ' || r.origin || ' → ' || r.destination || ' — update the pickup date',
          '<div style="font-family:Inter,Arial,sans-serif;max-width:560px">'
          || '<div style="background:#10223B;border-radius:14px 14px 0 0;padding:18px 24px"><span style="color:#fff;font-weight:800;font-size:17px">LoadBoot</span></div>'
          || '<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px;padding:22px 24px">'
          || '<p style="font-size:15px;margin:0 0 8px"><b>Your load is no longer visible to carriers.</b></p>'
          || '<p style="margin:0 0 6px;color:#334155">' || r.origin || ' → ' || r.destination || '</p>'
          || '<p style="margin:0 0 14px;color:#334155">Pickup was <b>' || to_char(r.pickup_date,'Mon DD, YYYY') || '</b> — that date has passed, so the load was removed from the carrier load board and can no longer be booked.</p>'
          || '<p style="margin:0 0 16px;color:#334155">Set a new pickup date to put it back on the board instantly, or cancel it if the freight is gone.</p>'
          || '<p style="margin:0 0 16px;color:#64748b;font-size:13px">Reminder ' || (r.expired_notify_count + 1) || ' of ' || c_max || ' — after that we stop and leave it with our team.</p>'
          || '<p style="margin:14px 0"><a href="https://loadboot.com/app/partner/#loads" style="background:#FC5305;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Update pickup time →</a></p>'
          || '</div></div>',
          null, 'loadexp:' || r.id::text || ':' || to_char(now(),'YYYYMMDD'));
      exception when others then null; end;
    end loop;

    update public.loads
       set expired_notified_at = now(), expired_notify_count = expired_notify_count + 1
     where id = r.id;
  end loop;
end; $function$;

-- ---------------------------------------------------------------- 2. broker checklist nag
create or replace function app_private.cron_broker_checklist_nag()
returns void
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare r record; m record; c_max constant int := 8;
begin
  for r in
    select c.id as item_id, c.label, c.nag_count, pl.broker_org, l.origin, l.destination,
           t.status as trip_status, t.created_at as booked_at
      from app_private.load_document_checklist c
      join app_private.partner_loads pl on pl.id = c.subject_id and c.subject_type = 'partner_load'
      join public.loads l on l.id = pl.posted_load_id
      join app_private.trips t on t.load_id = l.id and t.status in ('planned','dispatched','in_transit','delivered')
      join public.organizations bo on bo.id = pl.broker_org
     where c.required_from = 'broker' and c.status in ('required','rejected')
       and not coalesce((to_jsonb(bo)->>'is_demo')::boolean, false)
       -- 2-hourly while the truck is actually waiting, daily once it has delivered
       and (c.last_nag_at is null
            or (t.status <> 'delivered' and c.last_nag_at < now() - interval '2 hours')
            or (t.status =  'delivered' and c.last_nag_at < now() - interval '24 hours'))
  loop
    if r.nag_count >= c_max then
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
        select 'staff','in_app','checklist.nag_exhausted',
          jsonb_build_object('title','Broker ignored ' || c_max || ' requests for ' || r.label,
            'body', r.origin || ' → ' || r.destination || ' — automated chasing has stopped. This one needs a phone call.',
            'tone','urgent','url','/app/command-center/#/partner-intake','item', r.item_id),
          'sent', now()
        where not exists (select 1 from app_private.notifications n
                           where n.template_key='checklist.nag_exhausted' and n.payload->>'item' = r.item_id::text);
      exception when others then null; end;
      update app_private.load_document_checklist set last_nag_at = now() where id = r.item_id;
      continue;
    end if;

    begin
      perform app_private.notify_partner(r.broker_org,
        '⏰ Your carrier is WAITING: ' || r.label,
        r.origin || ' → ' || r.destination || ' is booked and moving — the driver cannot work without ' || r.label || '. Open My Loads → Documents and submit it now.',
        'warning', '/app/partner/#loads');
    exception when others then null; end;

    for m in select u.email from public.organization_memberships om join auth.users u on u.id = om.user_id
              where om.org_id = r.broker_org and om.status='active' limit 2 loop
      begin
        perform app_private.sys_email(m.email, 'checklist.nag',
          '⏰ Carrier waiting: ' || r.label || ' — ' || r.origin || ' → ' || r.destination,
          '<div style="font-family:Inter,Arial,sans-serif"><p style="font-size:15px"><b>Your booked load is missing: ' || r.label || '</b></p>'
          || '<p>' || r.origin || ' → ' || r.destination || ' — the driver and dispatch are waiting on you.</p>'
          || '<p style="color:#64748b;font-size:13px">Reminder ' || (r.nag_count + 1) || ' of ' || c_max || ' — after that we stop the automated reminders and a person picks it up.</p>'
          || '<p style="margin:14px 0"><a href="https://loadboot.com/app/partner/#loads" style="background:#FC5305;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Provide it now →</a></p></div>',
          null, 'nag:' || r.item_id::text || ':' || to_char(now(),'YYYYMMDDHH24'));
      exception when others then null; end;
    end loop;

    update app_private.load_document_checklist
       set last_nag_at = now(), nag_count = nag_count + 1
     where id = r.item_id;

    if r.booked_at < now() - interval '8 hours' then
      update app_private.load_document_checklist set cc_flagged_at = now()
       where id = r.item_id and cc_flagged_at is null;
      if found then
        for m in select pr.id as uid from public.profiles pr where pr.role = 'admin' limit 5 loop
          begin
            insert into app_private.notifications(recipient_user, channel, template_key, payload)
            values (m.uid, 'in_app', 'checklist.cc_escalation',
              jsonb_build_object('title', '🚨 Broker paperwork 8h+ overdue: ' || r.label,
                'body', r.origin || ' → ' || r.destination || ' — the carrier is still waiting and the broker has been nagged repeatedly. New postings are already paused; consider calling the broker.',
                'tone', 'urgent', 'url', '/app/command-center/#/partner-intake'));
          exception when others then null; end;
        end loop;
      end if;
    end if;
  end loop;
end; $function$;

-- ---------------------------------------------------------------- 3. payment confirm nag
create or replace function app_private.pay_confirm_nag()
returns jsonb
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare tr record; v_n int := 0; v_days int; c_max constant int := 7;
begin
  for tr in
    select pt.*, o.owner_user_id, u.email as owner_email, o.name as payee_name
      from app_private.pay_transfers pt
      join public.organizations o on o.id = pt.payee_org
      left join auth.users u on u.id = o.owner_user_id
     where pt.status = 'sent' and pt.payee_org is not null and pt.expected_by <= current_date
       and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
  loop
    v_days := current_date - tr.expected_by;

    -- stop writing to the payee after a week of silence; staff own it from here
    if tr.confirm_nag_count >= c_max then
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload)
        select 'staff', 'in_app', 'pay.confirm_abandoned', jsonb_build_object(
          'title', 'Payment unconfirmed after ' || c_max || ' reminders',
          'body', coalesce(tr.payee_name,'Payee') || ' has not confirmed $' || tr.amount || ' ' || tr.kind
                  || ' (expected ' || to_char(tr.expected_by,'Mon DD') || '). Automated reminders stopped — call them or close it manually.',
          'tone','urgent','transfer', tr.id)
        where not exists (select 1 from app_private.notifications n where n.template_key='pay.confirm_abandoned'
                            and n.payload->>'transfer' = tr.id::text);
      exception when others then null; end;
      continue;
    end if;

    if tr.owner_user_id is not null then
      begin
        insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
        select tr.owner_user_id, 'in_app', 'pay.confirm_nag', jsonb_build_object(
          'title', '❓ Did $' || tr.amount || ' land? Confirm it — day ' || v_days,
          'body', 'A ' || tr.kind || ' payment was expected by ' || to_char(tr.expected_by,'Mon DD') || '. Check your bank' || case when exists (select 1 from app_private.org_payment_profiles pp where pp.org_id=tr.payee_org and pp.factoring_noa) then ' / your factor''s portal' else '' end || ' — if it landed, tap “✓ I received it” in Finance → Money in (the payer is waiting for your confirmation); if not, use ⚠ Dispute. Leaving it unconfirmed blocks the settlement record.',
          'tone', 'warning', 'url', '/app/carrier/#finance', 'ref', tr.id::text), 'sent', now()
        where not exists (select 1 from app_private.notifications n where n.template_key='pay.confirm_nag'
                            and n.recipient_user = tr.owner_user_id and n.payload->>'ref' = tr.id::text
                            and n.created_at > now() - interval '22 hours');
      exception when others then null; end;
      begin
        if tr.owner_email is not null then
          perform app_private.sys_email(tr.owner_email, 'pay.confirm_nag',
            'LoadBoot: confirm your $' || tr.amount || ' payment — did it land?',
            '<div style="font-family:Inter,Arial,sans-serif"><h2>❓ $' || tr.amount || ' was expected by ' || to_char(tr.expected_by,'Mon DD') || '</h2>'
            || '<p>The payer sent it with a receipt. Check your bank — if it landed, tap <b>“✓ I received it”</b> in <a href="https://loadboot.com/app/carrier/#finance">Finance → Money in</a>; if it never arrived, file a dispute from the same row. Please don''t leave it hanging — the payer''s record stays open until you confirm.</p>'
            || '<p style="color:#64748b;font-size:13px">Reminder ' || (tr.confirm_nag_count + 1) || ' of ' || c_max || ' — after that we stop and our team follows up directly.</p></div>',
            null, 'paynag:' || tr.id::text || ':' || to_char(current_date,'YYYYMMDD'));
        end if;
      exception when others then null; end;
      update app_private.pay_transfers set confirm_nag_count = confirm_nag_count + 1 where id = tr.id;
      v_n := v_n + 1;
    end if;

    if v_days >= 4 then
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload)
        select 'staff', 'in_app', 'pay.confirm_stuck', jsonb_build_object(
          'title', '🧷 Unconfirmed payment — ' || v_days || 'd past expected',
          'body', coalesce(tr.payee_name,'Payee') || ' has not confirmed a $' || tr.amount || ' ' || tr.kind || ' payment (expected ' || to_char(tr.expected_by,'Mon DD') || '). Nudge them or verify with the payer.', 'transfer', tr.id)
        where not exists (select 1 from app_private.notifications n where n.template_key='pay.confirm_stuck'
                            and n.payload->>'transfer' = tr.id::text and n.created_at > now() - interval '3 days');
      exception when others then null; end;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'nagged', v_n);
end; $function$;
