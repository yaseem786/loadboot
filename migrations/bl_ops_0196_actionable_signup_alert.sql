-- bl_ops_0196 — make the signup-health alert actionable and self-silencing.
-- Applied to production 2026-08-03 (this file is the repo record of that change).
--
-- Three defects fixed:
--   1. payload.url was '/task-queue'. No such route exists; the Command Center route is
--      '/automation' ("Task queue"). Every click on this alert went nowhere.
--   2. Suppression was "one alarm per 12 hours", so the alert re-fired twice a day forever
--      and stacked duplicate automation_tasks (3 were open).
--   3. Counts included addresses that can never confirm (typo domains, throwaways, the
--      owner's own test signups), so the alert could not fall quiet after a real repair.

create table if not exists app_private.signup_health_ignore (
  email      text primary key,
  added_at   timestamptz not null default now(),
  added_by   uuid,
  note       text
);

create or replace function app_private.cron_signup_health()
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_recent int; v_stale int; v_total int; v_reason text; v_oldest text; v_task uuid;
begin
  create temp table if not exists _sh_actionable on commit drop as
  select u.id, u.email, u.created_at
    from auth.users u
   where u.email_confirmed_at is null
     and u.confirmation_sent_at is not null
     and not exists (select 1 from app_private.signup_health_ignore g
                      where lower(g.email) = lower(u.email));

  select count(*) into v_recent from _sh_actionable where created_at > now() - interval '24 hours';
  select count(*) into v_stale  from _sh_actionable
   where created_at between now() - interval '14 days' and now() - interval '2 days';
  select count(*) into v_total  from _sh_actionable;

  if v_recent < 3 and v_stale < 3 then
    return jsonb_build_object('ok', true, 'recent', v_recent, 'stale', v_stale, 'alerted', false);
  end if;

  if exists (select 1 from app_private.automation_tasks
             where source_rule = 'ops.signup_health' and status in ('open','in_progress')) then
    return jsonb_build_object('ok', true, 'recent', v_recent, 'stale', v_stale,
                              'alerted', false, 'suppressed', 'task_open');
  end if;

  select string_agg(email, ', ') into v_oldest
    from (select email from _sh_actionable order by created_at desc limit 5) x;

  v_reason := v_recent || ' account(s) created in the last 24h never confirmed, '
           || v_stale || ' sitting unconfirmed for 2+ days, ' || v_total || ' unconfirmed in total.'
           || coalesce(E'\nMost recent: ' || v_oldest, '');

  begin
    insert into app_private.automation_tasks
      (task_type, title, description, status, priority, assignee_role, related_type, related_id, due_at, source_rule)
    values ('incident', '🚨 Signup confirmation emails are not being delivered',
      v_reason || E'\n\nMost likely cause: the auth email provider hit a sending quota, or custom SMTP '
               || E'credentials expired or point at a sandboxed sender that can only mail verified '
               || E'addresses. Check Supabase -> Authentication -> Emails -> SMTP and the auth logs for '
               || E'"could not send email".'
               || E'\n\nFix the sender first. Then confirm the affected users by hand and email each of '
               || E'them - they left thinking the site was broken. Mark this task done when handled; '
               || E'the alert re-arms itself and will only fire again for a NEW stuck signup.',
      'open', 'high', 'staff', 'auth', 'signup_health', now() + interval '2 hours', 'ops.signup_health')
    returning id into v_task;
  exception when others then v_task := null; end;

  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','ops.signup_health',
      jsonb_build_object(
        'title','🚨 Signups may be failing — confirmation emails not landing',
        'body', v_reason || E'\nOpen the task queue to handle it, then mark it done.',
        'tone','urgent',
        'url','/automation',
        'task_id', v_task), 'sent', now());
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'recent', v_recent, 'stale', v_stale, 'total', v_total,
                            'alerted', true, 'task', v_task);
end $function$;

create or replace function public.cc_signup_health_dismiss()
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_parked int := 0; v_closed int := 0;
begin
  if not public.has_global_permission('comm.send') then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with ins as (
    insert into app_private.signup_health_ignore (email, added_by, note)
    select u.email, auth.uid(), 'dismissed from Command Center'
      from auth.users u
     where u.email_confirmed_at is null and u.confirmation_sent_at is not null
    on conflict (email) do nothing
    returning 1)
  select count(*) into v_parked from ins;

  with upd as (
    update app_private.automation_tasks
       set status = 'done'
     where source_rule = 'ops.signup_health' and status in ('open','in_progress')
    returning 1)
  select count(*) into v_closed from upd;

  update app_private.notifications
     set read_at = coalesce(read_at, now())
   where template_key = 'ops.signup_health' and read_at is null;

  return jsonb_build_object('ok', true, 'parked', v_parked, 'closed', v_closed);
end $function$;

-- Security invariant: anon-executable SECURITY DEFINER count stays 27; no cc_* is anon.
revoke all on function public.cc_signup_health_dismiss() from public, anon;
grant execute on function public.cc_signup_health_dismiss() to authenticated;
