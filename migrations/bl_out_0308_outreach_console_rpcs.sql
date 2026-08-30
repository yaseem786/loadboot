-- bl_out_0308_outreach_console_rpcs
-- 2026-08-29 — Read/control surface for the rebuilt CC "Email outreach" screen.
--
--  * cc_outreach_log_page  — the delivery log the old screen could not page. The old
--    cc_outreach_log is hard-capped at 500 rows with no offset, so 13,000 sends were
--    reachable only as one truncated table. This one takes offset + total, a day window,
--    an audience filter and a text search, and adds opened/clicked filters.
--    The old function is intentionally left in place so an un-deployed CC keeps working.
--  * cc_outreach_audience  — broker vs carrier, side by side: list size, how much of it
--    has ever been touched, where the drip drops off, opens/clicks/replies/signups, and
--    the runway (how long the untouched remainder will take at the current intake rate).
--  * cc_outreach_today     — replaced so its "due" set uses the SAME predicate as
--    outreach_run_daily. It previously ignored suppressions, contacts who already have an
--    account, and replied/converted contacts, so total_due over-reported the real queue.
--  * cc_outreach_control   — gains daily_cap / batch_per_run / new_intake_pct, so the
--    numbers that actually govern send volume stop requiring hand-written SQL.

-- (the migration runner wraps this file in its own transaction)

-- ------------------------------------------------------- paginated delivery log
create or replace function public.cc_outreach_log_page(
  p_filter text default 'all',
  p_kind   text default null,
  p_days   int  default 30,
  p_q      text default null,
  p_limit  int  default 50,
  p_offset int  default 0)
returns jsonb
language sql stable security definer set search_path to 'app_private, public' as $fn$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
p as (
  select least(greatest(coalesce(p_limit,50),1),200) as lim,
         greatest(coalesce(p_offset,0),0)            as off,
         nullif(btrim(coalesce(p_q,'')),'')          as q,
         nullif(btrim(coalesce(p_kind,'')),'')       as kind,
         case when coalesce(p_days,0) <= 0 then null else (p_days||' days')::interval end as win
),
removed as (
  select c.email, c.company, c.kind as audience, c.status, c.emails_sent,
         c.last_sent_at as when_at, null::text as tpl, null::text as reason,
         c.opened_at, c.clicked_at
    from app_private.outreach_contacts c, p
   where p_filter = 'removed'
     and c.status in ('bounced','unsubscribed','suppressed')
     and (p.kind is null or c.kind = p.kind)
     and (p.win is null or c.last_sent_at > now() - p.win)
     and (p.q is null or c.email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
),
sends as (
  select d.recipient_email as email, c.company, c.kind as audience, d.status,
         coalesce(c.emails_sent,0) as emails_sent,
         coalesce(d.sent_at, d.created_at) as when_at,
         d.template_key as tpl, d.failure_reason as reason,
         d.opened_at, d.clicked_at
    from app_private.message_deliveries d
    left join app_private.outreach_contacts c on lower(c.email) = lower(d.recipient_email)
    cross join p
   where p_filter <> 'removed'
     and d.template_key like 'outreach.%'
     and (p.win is null or d.created_at > now() - p.win)
     and (p.kind is null or d.template_key like 'outreach.'||p.kind||'-%')
     and (p.q is null or d.recipient_email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
     and (   p_filter = 'all'
          or (p_filter = 'sent'    and d.status in ('sent','delivered'))
          or (p_filter = 'failed'  and d.status in ('failed','bounced','dead_letter','complained'))
          or (p_filter = 'opened'  and d.opened_at is not null)
          or (p_filter = 'clicked' and d.clicked_at is not null))
),
base as (select * from removed union all select * from sends),
page as (
  select * from base order by when_at desc nulls last limit (select lim from p) offset (select off from p)
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'total',  (select count(*) from base),
  'limit',  (select lim from p),
  'offset', (select off from p),
  'filter', p_filter,
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
             'email', email, 'company', company, 'audience', audience, 'status', status,
             'emails_sent', emails_sent, 'tpl', tpl, 'reason', reason,
             'opened', opened_at is not null, 'clicked', clicked_at is not null,
             'when', when_at) order by when_at desc nulls last) from page), '[]'::jsonb))
end;
$fn$;

revoke all on function public.cc_outreach_log_page(text,text,int,text,int,int) from public, anon;
grant execute on function public.cc_outreach_log_page(text,text,int,text,int,int) to authenticated, service_role;

-- ------------------------------------------------ broker vs carrier, side by side
create or replace function public.cc_outreach_audience(p_days int default 30)
returns jsonb
language sql stable security definer set search_path to 'app_private, public' as $fn$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
win as (select (greatest(coalesce(p_days,30),1)||' days')::interval as w),
lists as (
  select kind,
    count(*)                                             as contacts,
    count(*) filter (where status='active')              as active,
    count(*) filter (where emails_sent = 0)              as never_touched,
    count(*) filter (where emails_sent between 1 and 6)  as in_drip,
    count(*) filter (where emails_sent >= 7)             as finished_drip,
    count(*) filter (where status='bounced')             as bounced,
    count(*) filter (where status='unsubscribed')        as unsubscribed,
    count(*) filter (where opened_at  is not null)       as opened,
    count(*) filter (where clicked_at is not null)       as clicked,
    count(*) filter (where replied_at is not null)       as replied,
    count(*) filter (where converted_at is not null)     as converted
  from app_private.outreach_contacts group by kind
),
sends as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
    count(*)                                                          as sent,
    count(*) filter (where d.status='delivered')                      as delivered,
    count(*) filter (where d.status in ('bounced','failed','dead_letter','complained')) as bad,
    count(*) filter (where d.opened_at  is not null)                  as opened,
    count(*) filter (where d.clicked_at is not null)                  as clicked
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%' and d.created_at > now() - win.w
  group by 1
),
-- How fast is the cold list actually moving? Count day-1 sends in the window.
intake as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
         count(*) as new_started
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%-d1' and d.created_at > now() - win.w
  group by 1
),
steps as (
  select kind, emails_sent as step, count(*) as n,
         count(*) filter (where clicked_at is not null) as clicked,
         count(*) filter (where opened_at  is not null) as opened
  from app_private.outreach_contacts where emails_sent > 0 group by 1,2
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'days', greatest(coalesce(p_days,30),1),
  'audiences', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', l.kind,
      'contacts', l.contacts, 'active', l.active,
      'never_touched', l.never_touched, 'in_drip', l.in_drip, 'finished_drip', l.finished_drip,
      'bounced', l.bounced, 'unsubscribed', l.unsubscribed,
      'contacts_opened', l.opened, 'contacts_clicked', l.clicked,
      'replied', l.replied, 'converted', l.converted,
      'sent', coalesce(s.sent,0), 'delivered', coalesce(s.delivered,0), 'bad', coalesce(s.bad,0),
      'opens', coalesce(s.opened,0), 'clicks', coalesce(s.clicked,0),
      'new_started', coalesce(i.new_started,0),
      'intake_per_day', round(coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1), 1),
      -- Days to work through everything never emailed, at the window's own intake rate.
      -- null = at the current rate this list is never finished.
      'runway_days', case when coalesce(i.new_started,0) = 0 then null
                          else ceil(l.never_touched::numeric
                               / (coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1))) end,
      'steps', coalesce((select jsonb_agg(jsonb_build_object('step',st.step,'n',st.n,'clicked',st.clicked,'opened',st.opened) order by st.step)
                         from steps st where st.kind = l.kind), '[]'::jsonb)
    ) order by l.kind)
    from lists l left join sends s on s.kind = l.kind left join intake i on i.kind = l.kind), '[]'::jsonb))
end;
$fn$;

revoke all on function public.cc_outreach_audience(int) from public, anon;
grant execute on function public.cc_outreach_audience(int) to authenticated, service_role;

-- ------------------------------------------- next run, matched to what really sends
create or replace function public.cc_outreach_today()
returns jsonb
language sql stable security definer set search_path to 'app_private, public' as $fn$
  select case when not (public.has_global_permission('marketing.view') or public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage'))
    then jsonb_build_object('error','not authorized') else (
  with st as (select * from app_private.outreach_state where id = 1),
  cap as (select greatest(0, least(st.max_cap, st.base_cap * (2 ^ floor((current_date - coalesce(st.started_on, current_date)) / 7.0))::int)
            - case when st.last_run is distinct from current_date then 0 else st.sent_today end) as n, st.enabled from st),
  -- Same predicate as app_private.outreach_run_daily. It used to be looser here
  -- (no suppression check, no auth.users check, no replied/converted check), so the
  -- "contacts due in queue" number on the CC screen was larger than what would send.
  due0 as (
    select oc.kind, oc.emails_sent + 1 as day, oc.email, oc.company, oc.emails_sent,
           row_number() over (partition by oc.kind
             order by oc.emails_sent desc, oc.last_sent_at asc nulls last, oc.created_at asc) as krn
    from app_private.outreach_contacts oc
    where oc.status = 'active' and oc.emails_sent < 7
      and oc.replied_at is null and oc.converted_at is null
      and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
      and not exists (select 1 from app_private.suppressions s
                      where s.channel='email' and s.address=lower(trim(oc.email)))
      and not exists (select 1 from auth.users u where lower(u.email)=lower(trim(oc.email)))
      and exists (select 1 from app_private.outreach_templates tt where tt.audience = oc.kind and tt.day = oc.emails_sent + 1 and tt.active)
  ),
  due as (select d.*, row_number() over (order by d.krn, d.kind) as rn from due0 d)
  select jsonb_build_object(
    'enabled', (select enabled from cap),
    'cap_remaining', (select n from cap),
    'total_due', (select count(*) from due),
    'due_new', (select count(*) from due where emails_sent = 0),
    'due_followup', (select count(*) from due where emails_sent > 0),
    'intake_pct', app_private.outreach_setting_int('outreach.new_intake_pct'),
    'daily_cap', app_private.outreach_setting_int('outreach.daily_cap'),
    'batch_per_run', app_private.outreach_setting_int('outreach.batch_per_run'),
    'batch', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('audience', d.kind, 'day', d.day, 'subject',
          (select subject from app_private.outreach_templates where audience = d.kind and day = d.day and active),
          'n', count(*)) as x
        from due d where d.rn <= (select n from cap) group by d.kind, d.day order by d.kind, d.day) q), '[]'::jsonb),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('email', d.email, 'company', d.company, 'audience', d.kind, 'day', d.day) order by d.rn)
        from due d where d.rn <= 10), '[]'::jsonb)
  )) end;
$fn$;

-- ------------------------------------------------------------- volume controls
create or replace function public.cc_outreach_control(p_action text, p_value integer default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare v_type text;
begin
  if not (public.has_global_permission('marketing.view') or public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage')) then
    return jsonb_build_object('error','not authorized'); end if;
  if p_action='enable' then update app_private.outreach_state set enabled=true, started_on=coalesce(started_on,current_date) where id=1;
  elsif p_action='disable' then update app_private.outreach_state set enabled=false where id=1;
  elsif p_action='base_cap' and p_value is not null then update app_private.outreach_state set base_cap=greatest(10,p_value) where id=1;
  elsif p_action='max_cap' and p_value is not null then update app_private.outreach_state set max_cap=greatest(100,p_value) where id=1;
  elsif p_action='run_now' then return app_private.outreach_run_daily();
  -- Raising real volume needs BOTH outreach_state.max_cap and the system setting
  -- 'outreach.daily_cap'; the second one used to be reachable only by hand-written SQL.
  elsif p_action in ('daily_cap','batch_per_run','new_intake_pct') and p_value is not null then
    select value_type into v_type from app_private.system_setting_defs where key = 'outreach.'||p_action;
    if v_type is null then return jsonb_build_object('error','setting not defined: outreach.'||p_action); end if;
    insert into app_private.system_settings(key, value)
    values ('outreach.'||p_action,
            to_jsonb(case p_action
                       when 'new_intake_pct' then least(greatest(p_value,0),100)
                       when 'batch_per_run'  then greatest(p_value,1)
                       else greatest(p_value,1) end))
    on conflict (key) do update set value = excluded.value;
  else return jsonb_build_object('error','bad action'); end if;
  return jsonb_build_object('ok',true);
end $fn$;

