-- bl_notif_0306 — the four notifications the 29 Aug 2026 audit found missing.
--
-- These are not "built but never fired": before this migration there was no code path in the
-- database that could produce any of them.
--
-- All four are NOTIFY-ONLY. Nothing here changes a status, sweeps a row or alters matching —
-- in particular an expired truck posting is still left `active`, exactly as before, because
-- tp_run_matcher already refuses to match a passed window (bl_tp_0272) and sweeping the status
-- would change what the portal lists. Whether postings should also be swept is a separate call.
--
-- Each is idempotent against app_private.notifications itself, so a re-run is harmless and no new
-- bookkeeping table is needed. Per-row failures RAISE WARNING and continue; they are never
-- swallowed, because a handler that hides its own bugs is how the nag crons went blind.
--
-- organizations.is_demo exists on PROD but NOT on STAGING, so every demo guard is written through
-- to_jsonb and this file applies unchanged to both.
--
-- Verified on STAGING 29 Aug 2026 inside a rolled-back transaction:
--   posting.expiring        1  "Unit 0099 out of Hinesville, GA stops being matched … after 30 Aug"
--   document.review_overdue 3  (found genuinely stale pending documents, one from 29 Jun)
--   fleet.no_truck          0  (org under test had a truck)
--   email.bouncing          1  "Messages to <address> are coming back undelivered"
--
-- Prod blast radius, measured read-only before enabling the cron:
--   postings expiring within 24h            0
--   documents pending > 24h                 0
--   carriers verified with 0 trucks         3   <-- one of them is the "Trucking Inc" TEST FIXTURE;
--                                                   set is_demo on that org before enabling
--   carrier owners with a suppressed email  1

-- 1 ── A truck posting stops matching when its window passes. Nothing sweeps it and, until now,
--      nothing told the carrier: he believed he was visible to freight and he was not.
create or replace function app_private.notif_posting_expiring() returns int language plpgsql
security definer set search_path = public, app_private as $$
declare r record; n int := 0;
begin
  for r in
    select p.id, p.origin, p.available_to, o.owner_user_id uid, t.unit_no
      from app_private.truck_postings p
      join public.organizations o on o.id = p.carrier_id
       and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
      left join app_private.fleet_trucks t on t.id = p.truck_id
     where p.status = 'active' and p.available_to is not null
       and p.available_to between current_date and current_date + 1
       and o.owner_user_id is not null
       and not exists (select 1 from app_private.notifications n2
                        where n2.recipient_user = o.owner_user_id and n2.template_key = 'posting.expiring'
                          and n2.payload->>'subject' = p.id::text and n2.created_at > now() - interval '3 days')
  loop
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (r.uid, 'in_app', 'posting.expiring',
        jsonb_build_object('title','Your truck posting expires ' || case when r.available_to = current_date then 'today' else 'tomorrow' end,
          'body', case when r.unit_no is not null then 'Unit ' || r.unit_no else 'Your truck' end
                  || ' out of ' || coalesce(r.origin,'your home base')
                  || ' stops being matched to freight after ' || to_char(r.available_to,'FMDD Mon')
                  || '. Extend it and you stay in the pool.',
          'tone','warning','url','/app/carrier/#loads','subject', r.id::text), 'sent', now());
      n := n + 1;
    exception when others then raise warning 'notif_posting_expiring %: %', r.id, sqlerrm; end;
  end loop;
  return n;
end $$;

-- 2 ── Every email we send promises verification "within a few hours". When we miss that, the
--      carrier hears nothing and chases us. Owning it is cheaper than being chased.
create or replace function app_private.notif_document_review_overdue(p_hours int default 24) returns int language plpgsql
security definer set search_path = public, app_private as $$
declare r record; n int := 0;
begin
  for r in
    select d.id, d.type, d.carrier_id uid, d.created_at
      from public.documents d
      join public.organizations o on o.owner_user_id = d.carrier_id
       and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
     where lower(coalesce(d.status,'pending')) in ('pending','in_review','review','submitted')
       and d.created_at < now() - make_interval(hours => greatest(p_hours,1))
       and not exists (select 1 from app_private.notifications n2
                        where n2.recipient_user = d.carrier_id and n2.template_key = 'document.review_overdue'
                          and n2.payload->>'subject' = d.id::text and n2.created_at > now() - interval '7 days')
  loop
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (r.uid, 'in_app', 'document.review_overdue',
        jsonb_build_object('title','We are late reviewing your document',
          'body','Your ' || replace(coalesce(r.type,'document'),'_',' ') || ' has been with us since '
                 || to_char(r.created_at,'FMDD Mon') || ' and we said a few hours. It is still in the queue and '
                 || 'nothing is wrong with it as far as we know — we are simply behind. Reply to any of our emails if you need it moved up.',
          'tone','warning','url','/app/carrier/#documents','subject', r.id::text), 'sent', now());
      n := n + 1;
    exception when others then raise warning 'notif_document_review_overdue %: %', r.id, sqlerrm; end;
  end loop;
  return n;
end $$;

-- 3 ── Fully verified and matchable to nothing, because the fleet page is empty. Patterson and
--      Pick N Nett have both been in this state for days with nothing telling them.
create or replace function app_private.notif_fleet_no_truck() returns int language plpgsql
security definer set search_path = public, app_private as $$
declare r record; n int := 0;
begin
  for r in
    select o.id org, o.owner_user_id uid
      from public.organizations o
     where o.kind = 'carrier' and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
       and o.status = 'active' and o.owner_user_id is not null
       and app_private.carrier_mandatory_ok(o.id)
       and not exists (select 1 from app_private.fleet_trucks t where t.carrier_id = o.id)
       and not exists (select 1 from app_private.notifications n2
                        where n2.recipient_user = o.owner_user_id and n2.template_key = 'fleet.no_truck'
                          and n2.created_at > now() - interval '7 days')
  loop
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (r.uid, 'in_app', 'fleet.no_truck',
        jsonb_build_object('title','You are verified — but there is no truck on file',
          'body','Every compliance item is approved, so nothing is holding your account. What is missing is the '
                 || 'equipment: we match on VIN, cargo dimensions, payload, dock height and liftgate, and with an empty '
                 || 'fleet page there is nothing to match. It takes about three minutes.',
          'tone','action','url','/app/carrier/#fleet/add-truck','subject', r.org::text), 'sent', now());
      n := n + 1;
    exception when others then raise warning 'notif_fleet_no_truck %: %', r.org, sqlerrm; end;
  end loop;
  return n;
end $$;

-- 4 ── Their address hard-bounced, so every email since has gone nowhere and they never learned
--      why. This one is in-app ONLY, by definition — emailing it would be absurd.
create or replace function app_private.notif_email_bouncing() returns int language plpgsql
security definer set search_path = public, app_private as $$
declare r record; n int := 0;
begin
  for r in
    select o.owner_user_id uid, u.email
      from public.organizations o
      join auth.users u on u.id = o.owner_user_id
      join app_private.suppressions s on s.channel='email' and lower(s.address)=lower(u.email)
     where o.kind='carrier' and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
       and s.reason in ('bounced','complained')
       and not exists (select 1 from app_private.notifications n2
                        where n2.recipient_user = o.owner_user_id and n2.template_key = 'email.bouncing'
                          and n2.created_at > now() - interval '30 days')
  loop
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (r.uid, 'in_app', 'email.bouncing',
        jsonb_build_object('title','We cannot reach you by email',
          'body','Messages to ' || r.email || ' are coming back undelivered, so our document decisions and load '
                 || 'offers are not reaching you. This notice is in the app because email cannot get through. '
                 || 'Update your address on the Account page and we will start again.',
          'tone','urgent','url','/app/carrier/#account','subject', lower(r.email)), 'sent', now());
      n := n + 1;
    exception when others then raise warning 'notif_email_bouncing %: %', r.uid, sqlerrm; end;
  end loop;
  return n;
end $$;

create or replace function app_private.notif_gap_sweep() returns jsonb language plpgsql
security definer set search_path = public, app_private as $$
declare a int:=0; b int:=0; c int:=0; d int:=0;
begin
  begin a := app_private.notif_posting_expiring();        exception when others then raise warning 'posting sweep: %', sqlerrm; end;
  begin b := app_private.notif_document_review_overdue(); exception when others then raise warning 'doc sweep: %', sqlerrm; end;
  begin c := app_private.notif_fleet_no_truck();          exception when others then raise warning 'fleet sweep: %', sqlerrm; end;
  begin d := app_private.notif_email_bouncing();          exception when others then raise warning 'email sweep: %', sqlerrm; end;
  return jsonb_build_object('posting_expiring',a,'document_review_overdue',b,'fleet_no_truck',c,'email_bouncing',d);
end $$;

-- Cron. Six-hourly is enough: every one of these is a "by tomorrow" concern, not a live event,
-- and each notifier is idempotent, so an extra run costs nothing.
-- Already scheduled on STAGING as jobid 31. Uncomment to enable on production.
-- select cron.schedule('lb-notif-gap-sweep', '17 */6 * * *', $cron$select app_private.notif_gap_sweep();$cron$);
