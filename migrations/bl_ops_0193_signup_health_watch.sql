-- bl_ops_0193 — nobody noticed the signup funnel was broken for three weeks.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Supabase's built-in email hit its daily quota, /signup started returning 500, and nine
-- real people - including a logistics company and five would-be agents - created accounts
-- that never confirmed. There was no alarm anywhere. Someone had to type the words "error
-- sending confirmation email" into the live chat before we found out.
--
-- This watches the funnel from the inside: it counts accounts created in the last 24 hours
-- that were sent a confirmation and never confirmed it. A couple is normal - people get
-- distracted. Three or more in a day, or any single account sitting unconfirmed for more
-- than two days, means the email path is broken again. It raises an urgent staff
-- notification and opens a task, and it will not repeat the same alarm within 12 hours.
--
-- Runs hourly (cron job 'lb-signup-health').

create or replace function app_private.cron_signup_health()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare
  v_recent int; v_stale int; v_total int; v_reason text; v_oldest text;
begin
  select count(*) into v_recent from auth.users
   where email_confirmed_at is null and confirmation_sent_at is not null
     and created_at > now() - interval '24 hours';

  select count(*) into v_stale from auth.users
   where email_confirmed_at is null and confirmation_sent_at is not null
     and created_at between now() - interval '14 days' and now() - interval '2 days';

  select count(*) into v_total from auth.users where email_confirmed_at is null;

  if v_recent < 3 and v_stale < 3 then
    return jsonb_build_object('ok', true, 'recent', v_recent, 'stale', v_stale, 'alerted', false);
  end if;

  -- One alarm per 12 hours, not one per hour.
  if exists (select 1 from app_private.notifications
             where template_key = 'ops.signup_health' and created_at > now() - interval '12 hours') then
    return jsonb_build_object('ok', true, 'recent', v_recent, 'stale', v_stale, 'alerted', false, 'suppressed', true);
  end if;

  select string_agg(email, ', ') into v_oldest from (
    select email from auth.users
     where email_confirmed_at is null and confirmation_sent_at is not null
     order by created_at desc limit 5) x;

  v_reason := v_recent || ' account(s) created in the last 24h never confirmed, '
           || v_stale || ' sitting unconfirmed for 2+ days, ' || v_total || ' unconfirmed in total.'
           || coalesce(E'\nMost recent: ' || v_oldest, '');

  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','ops.signup_health',
      jsonb_build_object(
        'title','[!] Signups may be failing - confirmation emails not landing',
        'body', v_reason || E'\nCheck Supabase -> Authentication -> Emails -> SMTP, and the auth logs for "could not send email".',
        'tone','urgent','url','/task-queue'), 'sent', now());
  exception when others then null; end;

  begin
    insert into app_private.automation_tasks
      (task_type, title, description, status, priority, assignee_role, related_type, related_id, due_at, source_rule)
    values ('incident', '[!] Signup confirmation emails are not being delivered',
      v_reason || E'\n\nMost likely cause: the auth email provider hit a sending quota, or custom SMTP credentials expired. '
               || E'Fix the sender first, then confirm the affected users by hand in Supabase -> Authentication -> Users, '
               || E'and email each of them - they left thinking the site was broken.',
      'open', 'high', 'staff', 'auth', 'signup_health', now() + interval '2 hours', 'ops.signup_health');
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'recent', v_recent, 'stale', v_stale, 'total', v_total, 'alerted', true);
end $function$;

select cron.schedule('lb-signup-health', '25 * * * *', 'select app_private.cron_signup_health()');
