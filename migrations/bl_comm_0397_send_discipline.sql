-- bl_comm_0397: send discipline — quiet hours, a per-person daily cap and a minimum gap.
--
-- The standard this follows (researched 22 Sep 2026):
--   Uber's push engine enforces a per-user daily cap (~2), a minimum spacing between
--   sends (~8 hours) and a send window, and drops the lowest-value message rather than
--   queueing everything. https://www.uber.com/us/en/blog/how-uber-optimizes-push-notifications-using-ml/
--   For operational freight mail dropping is the wrong trade — a carrier missing a POD
--   request is worse than a late one — so LoadBoot DEFERS instead of dropping: the row is
--   written as status='scheduled' with the next allowed slot, and released when due.
--   CAN-SPAM's transactional/relationship carve-out is read narrowly, so account-critical
--   and staff mail is exempt from all of this and never held back.
--   https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
--
-- OFF BY DEFAULT. Nothing changes until app_private.email_send_policy.enabled is true.

create table if not exists app_private.email_send_policy(
  id                    boolean primary key default true check (id),
  enabled               boolean not null default false,
  tz                    text    not null default 'America/Chicago',
  quiet_start           time    not null default '21:00',
  quiet_end             time    not null default '08:00',
  daily_cap             int     not null default 2,
  min_gap_minutes       int     not null default 480,
  exempt_classes        text[]  not null default array['T','S'],
  exempt_groups         text[]  not null default array['account_critical','staff_internal','billing'],
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);
insert into app_private.email_send_policy(id) values (true) on conflict (id) do nothing;
comment on table app_private.email_send_policy is
 'bl_comm_0397. One row. Quiet hours, daily cap and minimum gap for non-critical mail. enabled=false means the send path behaves exactly as it did before.';

-- Returns NULL when the email may go now, or the timestamp it should be held until.
create or replace function app_private.email_next_slot(p_to text, p_class text, p_group text)
returns timestamptz language plpgsql stable security definer set search_path = public, app_private as $$
declare
  p record; v_slot timestamptz; v_last timestamptz; v_n int; v_oldest timestamptz;
  v_local timestamp; v_in_quiet boolean;
begin
  select * into p from app_private.email_send_policy where id;
  if p is null or not p.enabled then return null; end if;
  if coalesce(p_class,'') = any(p.exempt_classes) then return null; end if;
  if coalesce(p_group,'') = any(p.exempt_groups) then return null; end if;

  select count(*), min(created_at), max(created_at)
    into v_n, v_oldest, v_last
    from app_private.message_deliveries d
   where lower(d.recipient_email) = lower(btrim(p_to))
     and d.created_at > now() - interval '24 hours'
     and coalesce(d.meta->>'class','') <> all (p.exempt_classes)
     and coalesce(d.meta->>'preference_group','') <> all (p.exempt_groups);

  v_slot := now();
  if v_n >= p.daily_cap and v_oldest is not null then
    v_slot := greatest(v_slot, v_oldest + interval '24 hours');
  end if;
  if v_last is not null then
    v_slot := greatest(v_slot, v_last + make_interval(mins => p.min_gap_minutes));
  end if;

  -- push out of the quiet window, in the policy's timezone
  v_local := v_slot at time zone p.tz;
  if p.quiet_start < p.quiet_end then
    v_in_quiet := v_local::time >= p.quiet_start and v_local::time < p.quiet_end;
  else
    v_in_quiet := v_local::time >= p.quiet_start or v_local::time < p.quiet_end;
  end if;
  if v_in_quiet then
    v_local := case when v_local::time < p.quiet_end
                    then date_trunc('day', v_local) + p.quiet_end
                    else date_trunc('day', v_local) + interval '1 day' + p.quiet_end end;
    v_slot := v_local at time zone p.tz;
  end if;

  return case when v_slot <= now() + interval '30 seconds' then null else v_slot end;
end $$;

-- Nothing automatic promoted a held row before this: public.cc_delivery_release_due is
-- staff-only (can_manage_comms), so a scheduled row would have sat there forever.
create or replace function app_private.comm_release_due()
returns int language plpgsql security definer set search_path = public, app_private as $$
declare v_n int;
begin
  update app_private.message_deliveries
     set status = 'queued', updated_at = now()
   where status = 'scheduled'
     and coalesce(scheduled_at, now()) <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function app_private.email_next_slot(text,text,text) from public, anon, authenticated;
revoke all on function app_private.comm_release_due() from public, anon, authenticated;

-- sys_email v3 — same as v2 (bl_comm_0395) plus the hold.
create or replace function app_private.sys_email(
  p_to text, p_template text, p_subject text, p_html text,
  p_text text default null, p_idem text default null)
returns void language plpgsql as $function$
declare
  v_user uuid; v_org uuid; v_cat text; v_group text; v_class text;
  v_subj text := p_subject; v_html text := p_html;
  v_sub_ov text; v_html_ov text; v_ov boolean;
  v_slot timestamptz; v_status text; v_sched timestamptz;
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions
              where channel='email' and lower(btrim(address))=lower(btrim(p_to))
                and (reason is distinct from 'unsubscribed'
                     or coalesce(p_template ~* '^outreach[._-]', false))) then return; end if;

  perform app_private.email_catalog_touch(p_template);

  select c.class, c.preference_group, c.subject_override, c.html_override, coalesce(c.override_active,false)
    into v_class, v_group, v_sub_ov, v_html_ov, v_ov
    from app_private.email_catalog c where c.key = p_template;

  select e.user_id, e.org_id into v_user, v_org from app_private.email_identify(p_to) e;

  if not app_private.email_pref_allows(p_template, v_user) then
    perform app_private.email_block_note(p_template, p_to, v_user, v_group, 'preference group opted out');
    return;
  end if;

  if v_ov then
    v_subj := coalesce(nullif(btrim(coalesce(v_sub_ov,'')),''), p_subject);
    if coalesce(btrim(coalesce(v_html_ov,'')),'') <> '' then
      v_html := case when v_html_ov like '%{{BODY}}%'
                     then replace(v_html_ov, '{{BODY}}', coalesce(p_html,''))
                     else v_html_ov end;
    end if;
  end if;

  v_cat := case when v_class = 'M' then 'marketing' else 'transactional' end;

  -- quiet hours / daily cap / minimum gap. Held, never dropped.
  v_slot := app_private.email_next_slot(p_to, v_class, v_group);
  if v_slot is null then v_status := 'queued'; v_sched := now();
  else                   v_status := 'scheduled'; v_sched := v_slot; end if;

  insert into app_private.message_deliveries(
      source, channel, provider, recipient_email, recipient_user, org_id,
      idempotency_key, status, scheduled_at, template_key, meta)
  values ('transactional','email','resend', lower(p_to), v_user, v_org,
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    v_status, v_sched, p_template,
    jsonb_build_object('subject', app_private.contact_expand(v_subj, true),
                       'body_html', app_private.contact_expand(v_html, false),
                       'body_text', app_private.contact_expand(coalesce(p_text, v_subj), true),
                       'category', v_cat,
                       'class', coalesce(v_class,'unclassified'),
                       'preference_group', v_group,
                       'sender', app_private.email_sender_for(p_template),
                       'override', v_ov,
                       'held_until', v_slot))
  on conflict (idempotency_key) do nothing;
end $function$;

-- staff view + control
create or replace function public.cc_email_policy(p_patch jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v jsonb;
begin
  if p_patch is null then
    if not public.has_global_permission('comm.view') then
      raise exception 'not authorized' using errcode='42501'; end if;
  else
    if not app_private.can_manage_comms() then
      raise exception 'not authorized' using errcode='42501'; end if;
    update app_private.email_send_policy set
      enabled         = coalesce((p_patch->>'enabled')::boolean, enabled),
      tz              = coalesce(p_patch->>'tz', tz),
      quiet_start     = coalesce((p_patch->>'quiet_start')::time, quiet_start),
      quiet_end       = coalesce((p_patch->>'quiet_end')::time, quiet_end),
      daily_cap       = coalesce((p_patch->>'daily_cap')::int, daily_cap),
      min_gap_minutes = coalesce((p_patch->>'min_gap_minutes')::int, min_gap_minutes),
      updated_at = now(), updated_by = auth.uid()
    where id;
  end if;

  select to_jsonb(s) into v from app_private.email_send_policy s where id;
  return jsonb_build_object('ok',true,'policy',v,
    'held_now',(select count(*) from app_private.message_deliveries where status='scheduled'),
    'next_release',(select min(scheduled_at) from app_private.message_deliveries where status='scheduled'));
end $$;

revoke all on function public.cc_email_policy(jsonb) from public, anon;
grant execute on function public.cc_email_policy(jsonb) to authenticated;

-- release held mail every minute
select cron.schedule('comm-release-due', '* * * * *',
       $cron$ select app_private.comm_release_due(); $cron$)
 where not exists (select 1 from cron.job where jobname = 'comm-release-due');
