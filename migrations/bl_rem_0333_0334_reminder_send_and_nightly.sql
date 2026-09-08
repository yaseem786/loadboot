-- bl_rem_0333_0334_reminder_send_and_nightly
--
-- The send. One engine, two callers:
--   public.cc_reminder_send   — the manual button in Command Center (permission-checked)
--   app_private.reminder_cron — the nightly job, for the days he forgets
-- They share app_private.reminder_dispatch, so the button and the robot can never
-- behave differently.
--
-- Recipient selection (caught by a staging dry run): exactly ONE person per carrier,
-- preferring the account owner. Before this fix a carrier with two members appeared
-- twice, and which of them actually received the email was decided by join order —
-- a driver account could end up being the one person told to go fix the fleet. The
-- idempotency key hid it: only one email went out, just not reliably to the right person.
--
-- Guard rails, applied on both paths because it is the same function:
--   marketing opt-out (comm_preferences.marketing_email / unsubscribed_all)
--   the suppression list
--   the cadence in app_private.reminder_due
--   one queue per carrier per reminder per day (idempotency_key)
--   a missing template SKIPS the carrier rather than sending something wrong

create or replace function app_private.reminder_recipients()
returns table (org uuid, company text, email text, uid uuid, opted_in boolean, suppressed boolean)
language sql
stable
security definer
set search_path to 'app_private, public'
as $fn$
  select distinct on (o.id)
         o.id,
         o.name,
         lower(p.email),
         p.id,
         (coalesce(cp.marketing_email, true) and not coalesce(cp.unsubscribed_all, false)),
         exists (select 1 from app_private.suppressions s
                  where s.channel = 'email' and lower(s.address) = lower(p.email))
    from public.organizations o
    join public.organization_memberships m
      on m.org_id = o.id and coalesce(m.status,'active') = 'active'
    join public.profiles p on p.id = m.user_id
    left join app_private.comm_preferences cp on cp.user_id = p.id
   where o.kind = 'carrier'
     and coalesce(o.status,'active') = 'active'
     and coalesce(o.is_demo,false) = false
     and p.email is not null
     and p.email ~ '^[^@]+@[^@]+\.[^@]+$'
   order by o.id,
            (p.id = o.owner_user_id) desc,          -- the account owner first
            (m.member_role = 'owner') desc,         -- then anyone marked owner
            m.created_at asc,                       -- then the longest-standing member
            p.id asc;                               -- and a stable tiebreak
$fn$;

comment on function app_private.reminder_recipients() is
  'Exactly one reminder recipient per active carrier org, preferring the account owner. Shared by cc_reminder_targets and reminder_dispatch so preview and send can never disagree.';

revoke execute on function app_private.reminder_recipients() from anon, public, authenticated;

create or replace function app_private.reminder_dispatch(
  p_keys text[] default null,
  p_dry_run boolean default true,
  p_ignore_cadence boolean default false,
  p_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare r record; v_key text; v_tpl record; v_id uuid; v_q int := 0; v_skip int := 0; v_rows jsonb := '[]'::jsonb;
begin
  for r in select * from app_private.reminder_recipients() loop
    v_key := app_private.reminder_for_carrier(r.org);
    if v_key is null then continue; end if;
    if p_keys is not null and not (v_key = any(p_keys)) then continue; end if;
    if not r.opted_in then v_skip := v_skip + 1; continue; end if;
    if r.suppressed then v_skip := v_skip + 1; continue; end if;
    if not p_ignore_cadence and not app_private.reminder_due(r.org, v_key) then v_skip := v_skip + 1; continue; end if;

    select * into v_tpl from app_private.comm_templates where key = 'carrier.reminder.' || v_key;
    if v_tpl.key is null then v_skip := v_skip + 1; continue; end if;

    v_rows := v_rows || jsonb_build_object('company', r.company, 'email', r.email, 'reminder', v_key);
    if p_dry_run then continue; end if;

    insert into app_private.message_deliveries(org_id, source, template_key, channel, provider,
        recipient_user, recipient_email, idempotency_key, status, scheduled_at, meta)
    values (r.org, 'campaign', v_tpl.key, 'email', 'resend', r.uid, r.email,
        'rem:' || v_key || ':' || r.org::text || ':' || to_char(now() at time zone 'UTC','YYYYMMDD'),
        'queued', now(),
        jsonb_build_object('subject', v_tpl.subject, 'body_html', v_tpl.body, 'body_text', v_tpl.body_text,
                           'category', 'dispatch'))   -- see bl_rem_0336: pinned, not inferred from the key
    on conflict (idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then v_skip := v_skip + 1; continue; end if;   -- already queued today
    insert into app_private.reminder_log(carrier_id, reminder_key, delivery_id, sent_by)
      values (r.org, v_key, v_id, p_by);
    v_q := v_q + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'queued', v_q, 'skipped', v_skip, 'rows', v_rows);
end $function$;

comment on function app_private.reminder_dispatch(text[], boolean, boolean, uuid) is
  'Shared carrier-reminder send. Called by public.cc_reminder_send (staff, permission-checked) and by app_private.reminder_cron (nightly, unattended).';

revoke execute on function app_private.reminder_dispatch(text[], boolean, boolean, uuid) from anon, public, authenticated;

create or replace function public.cc_reminder_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare v_out jsonb;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'reminder', x->>'company'), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'carrier_id',  t.org,
      'company',     t.company,
      'email',       t.email,
      'reminder',    t.k,
      'due',         app_private.reminder_due(t.org, t.k),
      'last_sent',   (select max(sent_at) from app_private.reminder_log l
                       where l.carrier_id = t.org and l.reminder_key = t.k),
      'sent_before', (select count(*) from app_private.reminder_log l
                       where l.carrier_id = t.org and l.reminder_key = t.k),
      'opted_in',    t.opted_in,
      'suppressed',  t.suppressed
    ) x
    from (
      select r.*, app_private.reminder_for_carrier(r.org) as k
        from app_private.reminder_recipients() r
    ) t
    where t.k is not null
  ) s;
  return v_out;
end $function$;

create or replace function public.cc_reminder_send(
  p_keys text[] default null,
  p_dry_run boolean default true,
  p_ignore_cadence boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_by uuid; v_res jsonb;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  v_by := auth.uid();
  v_res := app_private.reminder_dispatch(p_keys, p_dry_run, p_ignore_cadence, v_by);
  if not p_dry_run then
    perform app_private.log_audit('reminder.send','carrier', null, null,
      format('queued %s carrier reminder(s), skipped %s', v_res->>'queued', v_res->>'skipped'),
      jsonb_build_object('keys', p_keys, 'ignore_cadence', p_ignore_cadence, 'manual', true));
  end if;
  return v_res;
end $function$;

-- Creating/recreating a public function re-applies Supabase's default anon EXECUTE grant.
revoke execute on function public.cc_reminder_targets()                     from anon, public;
revoke execute on function public.cc_reminder_send(text[], boolean, boolean) from anon, public;
grant  execute on function public.cc_reminder_targets()                     to authenticated;
grant  execute on function public.cc_reminder_send(text[], boolean, boolean) to authenticated;

create or replace function app_private.reminder_cron()
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_res jsonb;
begin
  -- Never ignores cadence. The nightly job is the safe path by construction:
  -- only a human pressing the button in Command Center can override the gaps.
  v_res := app_private.reminder_dispatch(null, false, false, null);
  begin
    perform app_private.log_audit('reminder.send.cron','carrier', null, null,
      format('nightly: queued %s carrier reminder(s), skipped %s', v_res->>'queued', v_res->>'skipped'),
      jsonb_build_object('manual', false));
  exception when others then null; end;
  return v_res;
end $function$;

revoke execute on function app_private.reminder_cron() from anon, public, authenticated;

-- ---------------------------------------------------------------------------
-- The nightly schedule. 15:00 UTC, an hour AFTER cc_run_onboarding_reminders
-- (14:00 UTC), so a carrier who finishes their documents in the morning gets the
-- document email first and the fleet nudge only once bl_rem_0332's gate lets
-- them through.
--
-- Registered on both databases and left DISABLED on purpose: nothing reaches a
-- real carrier until Yaseen has previewed the six emails and switched it on.
--   select cron.schedule('lb-carrier-reminders','0 15 * * *',
--          $$select app_private.reminder_cron();$$);
--   select cron.alter_job((select jobid from cron.job where jobname='lb-carrier-reminders'),
--                          active := false);
--
-- To turn it on:
--   select cron.alter_job((select jobid from cron.job where jobname='lb-carrier-reminders'),
--                          active := true);
-- (cron.alter_job, not "update cron.job" — the migration role has no write grant
--  on that table.)
-- ---------------------------------------------------------------------------
