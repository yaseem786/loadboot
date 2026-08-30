-- bl_notif_0305 — notification tone/url defaults + one-open-nudge-per-subject
--
-- Audit, 29 Aug 2026 (prod): 166 notifications had been stored with NO tone at all and rendered
-- neutral grey — including bank.rejected, the most urgent message in the payments flow. Separately,
-- Top Knotch carried ten unread notifications describing one missing certificate, because every
-- reminder stacked beside the last instead of replacing it. Onboarding nudges read at 4%.
--
-- Rather than edit ~120 emitting functions, one BEFORE INSERT trigger fixes both at the source.
-- It never overrides a value an emitter set deliberately, and the supersede is limited to
-- recurring nudges: decisions must never collapse, because four approvals for four different
-- documents are four separate pieces of news.
--
-- Applied and verified on STAGING 29 Aug 2026:
--   bank.rejected with no tone/url given  -> tone=urgent, url=/app/carrier/#finance
--   8 unread onboarding.reminder + 1 new  -> 1 unread
--   2 document.reviewed.valid             -> both stay unread

create or replace function app_private.notif_tone_for(p_key text) returns text language sql immutable as $$
select case
  when p_key ~* '(reject|fail|lapse|violation|urgent|emergency|late|overdue|blackout|dispute|suspend|bounc|stranded)' then 'urgent'
  when p_key ~* '(expir|\mwarn|nag|remind|stale|revalidation|watchdog|escalat|pending)' then 'warning'
  -- an offer, or a prerequisite the carrier has not supplied, is undecided and needs him; these
  -- jump ahead of the success words because "offer.received" and "fleet.no_truck" would otherwise
  -- read as good news
  when p_key ~* '(offer|no_truck|missing|needed)' then 'action'
  when p_key ~* '(approv|\mvalid|verifi|complete|received|booked|paid|confirm|welcome|decided|accepted|reopen|released|incoming|visibility)' then 'success'
  when p_key ~* '(request|submit|review|apply|applied|invite|checklist|copy|action)' then 'action'
  else 'info' end;
$$;
-- ordering notes, all covered by the staging test matrix:
--   \mvalid (word start) so packet.revalidation stays a warning, not a success
--   warning before success so pay.confirm_nag is a nag, not a confirmation
--   success before the generic action branch so document.reviewed.valid is not caught by "review"

create or replace function app_private.notif_url_for(p_key text) returns text language sql immutable as $$
select case
  when p_key ~* 'bounc|unsubscrib'                  then '/app/carrier/#account'
  when p_key ~* 'insurance|coi'                     then '/app/carrier/#documents/insurance'
  when p_key ~* 'authority|fmcsa|mcs150'            then '/app/carrier/#documents/authority'
  when p_key ~* 'w9|w-9'                            then '/app/carrier/#documents/w9'
  when p_key ~* 'agreement'                         then '/app/carrier/#documents/agreement'
  when p_key ~* 'posting'                           then '/app/carrier/#loads'
  when p_key ~* 'document|compliance|onboarding|packet' then '/app/carrier/#documents'
  when p_key ~* 'no_truck'                          then '/app/carrier/#fleet/add-truck'
  when p_key ~* 'fleet|truck|driver'                then '/app/carrier/#fleet'
  when p_key ~* 'offer|load|book|match'             then '/app/carrier/#loads'
  when p_key ~* 'trip|tracking|pod|detention|pickup|delivery|safety|emergency' then '/app/carrier/#trips'
  when p_key ~* 'pay|invoice|settle|payout|factoring|bank|fee|remit' then '/app/carrier/#finance'
  when p_key ~* 'visibility|profile'                then '/app/carrier/#profile'
  when p_key ~* 'health|violation|strike|rating|score' then '/app/carrier/#health'
  when p_key ~* 'reinstat'                          then '/app/carrier/#reinstate'
  when p_key ~* 'account|deletion'                  then '/app/carrier/#account'
  else '/app/carrier/#notifications' end;
$$;
-- these use the #tab/target deep links added to app/carrier/app.js on 29 Aug. An unknown target is
-- ignored by the portal, so the URLs are safe to store before that build ships.

create or replace function app_private.notif_is_nudge(p_key text) returns boolean language sql immutable as $$
select p_key in ('onboarding.reminder','agent.onboarding_reminder','document.received','compliance.reminder',
                 'posting.expiring','fleet.no_truck','email.bouncing','document.review_overdue',
                 'checklist.nag','pay.confirm_nag','packet.revalidation','carrier_onboarding');
$$;

-- Legacy rows carry no 'doc' at all while newer ones carry doc='ALL'; both mean "the general
-- nudge", so the subject key normalises them together — otherwise the historic pile never
-- collapses and the ten unread reminders stay forever.
create or replace function app_private.notif_subject_key(p jsonb, p_key text) returns text language sql immutable as $$
select case when s in ('', 'ALL') then '-' else s end
from (select coalesce(nullif(p->>'subject',''), nullif(p->>'doc',''), '') s) x;
$$;

create or replace function app_private.tg_notification_defaults() returns trigger language plpgsql as $$
declare v_subject text;
begin
  if coalesce(new.channel,'in_app') <> 'in_app' then return new; end if;
  new.payload := coalesce(new.payload, '{}'::jsonb);
  if coalesce(new.payload->>'tone','') = '' then
    new.payload := new.payload || jsonb_build_object('tone', app_private.notif_tone_for(coalesce(new.template_key,'')));
  end if;
  if coalesce(new.payload->>'url','') = '' and new.recipient_user is not null then
    new.payload := new.payload || jsonb_build_object('url', app_private.notif_url_for(coalesce(new.template_key,'')));
  end if;
  if new.recipient_user is not null and app_private.notif_is_nudge(coalesce(new.template_key,'')) then
    v_subject := app_private.notif_subject_key(new.payload, new.template_key);
    begin
      update app_private.notifications
         set read_at = now()
       where recipient_user = new.recipient_user and template_key = new.template_key
         and channel = 'in_app' and read_at is null
         and app_private.notif_subject_key(payload, template_key) = v_subject;
    exception when others then raise warning 'notif supersede failed for %: %', new.template_key, sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists tg_notification_defaults on app_private.notifications;
create trigger tg_notification_defaults before insert on app_private.notifications
  for each row execute function app_private.tg_notification_defaults();

-- callable form, for an emitter that wants to supersede explicitly
create or replace function app_private.notify_supersede(p_user uuid, p_template text, p_subject text default null)
returns int language plpgsql as $$
declare n int;
begin
  if p_user is null or p_template is null then return 0; end if;
  update app_private.notifications
     set read_at = now()
   where recipient_user = p_user and template_key = p_template
     and channel = 'in_app' and read_at is null
     and (p_subject is null or coalesce(payload->>'doc', payload->>'subject','') = p_subject);
  get diagnostics n = row_count;
  return n;
end $$;
