-- bl_ops_0195 — an alarm for the day email stops going out.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- On 1 August the shared Resend quota was exhausted by outreach. Cold outreach and every
-- transactional message we send shared one sending allowance, outreach drained it, and
-- from then on auth confirmation emails failed silently - no error surfaced anywhere in
-- the product. That ran for three weeks. Nine real people signed up, never received the
-- confirmation they were waiting on, and left. We did not find out from a dashboard, a
-- log or an alert: we found out when a customer typed it into live chat.
--
-- This is the alarm that should have existed. It watches the delivery queue itself, from
-- inside the database, and it looks for the three shapes a stoppage actually takes:
-- messages sitting queued long past the time they should have gone out, messages piling
-- up as failed or dead_letter, and the quiet one that fooled us for three weeks - nothing
-- succeeding at all while unsent mail waits. Any of those raises a staff notification and
-- opens a high-priority incident task, and it emails the owner directly.
--
-- Two things matter about how it reports. First, it names the reason: it carries the most
-- common failure_reason off the affected rows into the notification body and turns it into
-- a concrete next action - a quota or 550 means check the provider's sending limit, an auth
-- error means the key expired, nothing claimed at all means the worker or its cron is down.
-- Nobody should have to open a console to learn what broke. Second, the owner email is
-- deliberately fragile: if email delivery is the thing that is broken then this message
-- never leaves, which is expected. It is written so that it cannot throw, cannot retry in
-- a loop, and cannot be queued more than once per 12 hours - the in-flight copy is keyed
-- to a 12-hour bucket on a unique index, so a second copy is impossible by construction.
--
-- Runs hourly (cron job 'lb-email-health').

create or replace function app_private.cron_email_health()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare
  v_stuck int; v_failed int; v_sent int; v_waiting int; v_claimed int;
  v_reason text; v_top_error text; v_action text; v_kind text;
begin
  -- Rows the worker should already have taken. cc_delivery_worker_claim picks status
  -- 'queued' whose scheduled_at is due; cc_delivery_release_due promotes 'scheduled'
  -- to 'queued' when it comes due; 'claimed' means the worker took the row and then
  -- never marked it, which is what a crashed or timed-out worker leaves behind.
  select count(*) into v_stuck from app_private.message_deliveries
   where channel = 'email'
     and status in ('queued','scheduled','claimed')
     and coalesce(scheduled_at, created_at) < now() - interval '20 minutes'
     and created_at > now() - interval '6 hours';

  -- cc_delivery_worker_mark turns a reported 'failed' back into 'queued' for another
  -- attempt until attempts hits 5, and only then into 'dead_letter'. Both states carry
  -- failure_reason, which is where the provider's own words end up.
  select count(*) into v_failed from app_private.message_deliveries
   where channel = 'email'
     and status in ('failed','dead_letter')
     and updated_at > now() - interval '6 hours';

  select count(*) into v_sent from app_private.message_deliveries
   where channel = 'email'
     and status in ('sent','delivered','opened','clicked')
     and coalesce(sent_at, updated_at) > now() - interval '6 hours';

  -- Everything unsent and already due, at any age - the backlog a stoppage builds up.
  select count(*) into v_waiting from app_private.message_deliveries
   where channel = 'email'
     and status in ('queued','scheduled','claimed')
     and coalesce(scheduled_at, created_at) <= now();

  select count(*) into v_claimed from app_private.message_deliveries
   where channel = 'email' and claimed_at > now() - interval '6 hours';

  -- Healthy, or too small to be a signal. A couple of stragglers is normal.
  if v_stuck < 5 and v_failed < 3 and not (v_sent = 0 and v_waiting > 0) then
    return jsonb_build_object('ok', true, 'stuck', v_stuck, 'failed', v_failed,
      'sent', v_sent, 'waiting', v_waiting, 'claimed', v_claimed,
      'alerted', false, 'reason', 'email delivery healthy');
  end if;

  -- One alarm per 12 hours, not one per hour.
  if exists (select 1 from app_private.notifications
             where template_key = 'ops.email_health' and created_at > now() - interval '12 hours') then
    return jsonb_build_object('ok', true, 'stuck', v_stuck, 'failed', v_failed,
      'sent', v_sent, 'waiting', v_waiting, 'claimed', v_claimed,
      'alerted', false, 'suppressed', true, 'reason', 'already alerted within 12 hours');
  end if;

  -- The provider's own words, most common first. This is the whole point of the alarm.
  select failure_reason into v_top_error from app_private.message_deliveries
   where channel = 'email' and failure_reason is not null
     and updated_at > now() - interval '6 hours'
   group by failure_reason order by count(*) desc limit 1;

  -- Turn the reason into the one thing a human should go and do.
  if v_claimed = 0 and v_waiting > 0 then
    v_kind := 'worker_down';
    v_action := 'Nothing was claimed at all in 6 hours, so the send path never even ran. '
             || 'The delivery-worker edge function or its cron job is down: check that cron jobs '
             || '''lb-email-worker'' and ''delivery-worker-minutely'' are active, then call the '
             || 'delivery-worker function by hand and read what it returns.';
  elsif v_top_error ~* '(quota|rate.?limit|limit reached|too many|429|550)' then
    v_kind := 'quota';
    v_action := 'The provider is refusing sends against a sending limit - this is the same failure '
             || 'as 1 Aug 2026. Check the Resend dashboard sending limit and the daily cap on the '
             || 'sending domain, raise the plan or pause outreach, and confirm outreach is not '
             || 'spending the allowance that transactional and auth email depend on.';
  elsif v_top_error ~* '(401|403|unauthor|forbidden|api.?key|invalid.?key|credential|smtp|authenticat)' then
    v_kind := 'credentials';
    v_action := 'The provider rejected our credentials: RESEND_API_KEY has expired, been rotated or '
             || 'been revoked. Issue a fresh key in Resend and update the delivery-worker secret, '
             || 'then re-queue the affected rows.';
  elsif v_top_error ~* '(domain|dkim|spf|dmarc|not verified|unverified)' then
    v_kind := 'domain';
    v_action := 'The sending domain is not verified with the provider. Re-check the DNS records for '
             || 'loadboot.com and mail.loadboot.com in the Resend dashboard - a DNS change or an '
             || 'expired verification will stop every send from that identity.';
  else
    v_kind := 'unknown';
    v_action := 'No single provider error dominates. Read failure_reason on the affected rows in '
             || 'app_private.message_deliveries and the delivery-worker function logs, and treat '
             || 'this as a delivery outage until proven otherwise.';
  end if;

  v_reason := v_stuck || ' email(s) queued past their send time, '
           || v_failed || ' failed or dead-lettered in the last 6 hours, '
           || v_sent || ' sent successfully in that same window, '
           || v_waiting || ' still unsent right now.'
           || coalesce(E'\nMost common provider error: ' || v_top_error,
                       E'\nNo provider error was recorded at all - nothing reached the provider.');

  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','ops.email_health',
      jsonb_build_object(
        'title','[!] Email delivery has stopped',
        'body', v_reason || E'\n' || v_action,
        'tone','urgent','url','/task-queue'), 'sent', now());
  exception when others then null; end;

  begin
    insert into app_private.automation_tasks
      (task_type, title, description, status, priority, assignee_role, related_type, related_id, due_at, source_rule)
    values ('incident', '[!] Email delivery has stopped - ' || v_kind,
      v_reason || E'\n\nNext action: ' || v_action
               || E'\n\nWhile it is broken, assume nothing we send is arriving - including signup '
               || 'confirmations. Fix the sender first, then go back over anyone who was waiting on '
               || 'an email during the outage and contact them by hand.',
      'open', 'high', 'staff', 'email', 'email_health', now() + interval '1 hour', 'ops.email_health');
  exception when others then null; end;

  -- Email the owner. If email delivery is what is broken this never leaves, and that is
  -- fine - the notification and the task above are the reliable channels. It is queued as
  -- an ordinary delivery so it goes out the moment the path recovers. Guards, in order:
  -- the whole block is exception-swallowed so a failure here can never abort the check;
  -- the idempotency_key is a fixed 12-hour bucket on the md_idem_uq unique index, so a
  -- second copy cannot be inserted no matter how often this runs; and meta.category is
  -- pinned to 'support' so it leaves from hello@loadboot.com rather than being routed by
  -- template_key (which starts 'ops.' and would otherwise match the dispatch identity).
  begin
    insert into app_private.message_deliveries
      (source, channel, provider, recipient_email, idempotency_key, status, scheduled_at, template_key, meta)
    values ('transactional','email','resend','hello@loadboot.com',
      'ops.email_health:' || floor(extract(epoch from now()) / 43200)::bigint::text,
      'queued', now(), 'ops.email_health',
      jsonb_build_object(
        'category','support',
        'no_call', true,
        'subject','[LoadBoot] Email delivery has stopped',
        'body_text', v_reason || E'\n\nNext action: ' || v_action,
        'body_html', '<p><strong>Email delivery has stopped.</strong></p><p>'
                     || replace(v_reason, E'\n', '<br>') || '</p><p><strong>Next action:</strong> '
                     || v_action || '</p>'))
    on conflict (idempotency_key) do nothing;
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'stuck', v_stuck, 'failed', v_failed,
    'sent', v_sent, 'waiting', v_waiting, 'claimed', v_claimed,
    'alerted', true, 'kind', v_kind, 'reason', v_reason);
end $function$;

select cron.schedule('lb-email-health', '40 * * * *', 'select app_private.cron_email_health()');
