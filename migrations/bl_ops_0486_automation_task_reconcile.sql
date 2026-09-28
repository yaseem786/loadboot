create table if not exists app_private.automation_task_autoclose_log (
  id            bigserial primary key,
  task_id       uuid not null,
  task_type     text,
  related_type  text,
  related_id    text,
  prev_status   text,
  prev_priority text,
  new_status    text not null,
  reason        text not null,
  closed_at     timestamptz not null default now()
);
create index if not exists automation_task_autoclose_log_at on app_private.automation_task_autoclose_log (closed_at desc);
alter table app_private.automation_task_autoclose_log enable row level security;

create or replace function app_private.automation_tasks_reconcile(p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = app_private, public as $fn$
declare v jsonb;
begin
  create temp table if not exists _atr (id uuid primary key, new_status text, reason text) on commit drop;
  truncate _atr;
  insert into _atr (id, new_status, reason)
  select distinct on (id) id, new_status, reason from (
    select t.id, case when a.status in ('approved','rejected') then 'done' else 'cancelled' end new_status,
           case when a.user_id is null then 'agent profile no longer exists'
                when a.status in ('approved','rejected') then 'agent ' || a.status
                else 'agent never submitted (draft, agreement unsigned)' end reason
      from app_private.automation_tasks t left join app_private.agent_profiles a on a.user_id::text = t.related_id
     where t.status = 'open' and t.task_type = 'agent_review'
       and (a.user_id is null or a.status in ('approved','rejected') or (a.status = 'draft' and a.agreement_signed_at is null))
    union all
    select t.id, case when d.user_id is null then 'cancelled' else 'done' end,
           case when d.user_id is null then 'dispatcher profile no longer exists' else 'dispatcher already ' || d.status end
      from app_private.automation_tasks t left join app_private.dispatcher_profiles d on d.user_id::text = t.related_id
     where t.status = 'open' and t.task_type = 'dispatcher_review'
       and (d.user_id is null or d.status not in ('applied','screening'))
    union all
    select t.id, 'done', 'enquiry ' || f.status
      from app_private.automation_tasks t join app_private.form_submissions f on f.id::text = t.related_id
     where t.status = 'open' and t.task_type = 'form_followup' and f.status in ('closed','converted')
    union all
    select t.id, 'done', 'ticket ' || s.status
      from app_private.automation_tasks t join app_private.support_tickets s on s.id::text = t.related_id
     where t.status = 'open' and t.task_type = 'ticket_followup' and s.status in ('resolved','closed')
    union all
    select t.id, 'done', 'carrier already active'
      from app_private.automation_tasks t join public.organizations o on o.id::text = t.related_id
     where t.status = 'open' and t.task_type in ('onboarding_review','onboarding_approval') and o.status = 'active'
    union all
    select t.id, case when coalesce(p.status, o.status) is null then 'cancelled' else 'done' end,
           case when coalesce(p.status, o.status) is null then 'registration no longer exists' else 'registration already ' || coalesce(p.status, o.status) end
      from app_private.automation_tasks t
      left join app_private.partners p on p.id::text = t.related_id
      left join public.organizations o on o.id::text = t.related_id
     where t.status = 'open' and t.task_type = 'partner_review'
       and (coalesce(p.status, o.status) is null or coalesce(p.status, o.status) <> 'pending')
    union all
    select t.id, 'done', 'bank details verified ' || to_char(pp.verified_at, 'YYYY-MM-DD')
      from app_private.automation_tasks t join app_private.org_payment_profiles pp on pp.org_id::text = t.related_id
     where t.status = 'open' and t.task_type = 'bank_details_verify' and pp.verified and pp.verified_at >= t.created_at
    union all
    select t.id, 'done', 'NOA ' || pp.noa_status
      from app_private.automation_tasks t join app_private.org_payment_profiles pp on pp.org_id::text = t.related_id
     where t.status = 'open' and t.task_type = 'noa_verify' and pp.noa_status in ('verified','rejected')
  ) c order by id;

  select jsonb_build_object('dry_run', p_dry_run, 'total', (select count(*) from _atr),
           'by_reason', coalesce((select jsonb_object_agg(k, n) from (select t.task_type || ' · ' || a.reason k, count(*) n
                                     from _atr a join app_private.automation_tasks t on t.id = a.id group by 1) s), '{}'::jsonb))
    into v;
  if p_dry_run then return v; end if;

  insert into app_private.automation_task_autoclose_log (task_id, task_type, related_type, related_id, prev_status, prev_priority, new_status, reason)
  select t.id, t.task_type, t.related_type, t.related_id, t.status, t.priority, a.new_status, a.reason
    from _atr a join app_private.automation_tasks t on t.id = a.id where t.status = 'open';
  update app_private.automation_tasks t
     set status = a.new_status, completed_at = now(),
         description = concat_ws(E'\n', nullif(t.description, ''), '[auto-closed ' || to_char(now(), 'YYYY-MM-DD') || ': ' || a.reason || ']')
    from _atr a where t.id = a.id and t.status = 'open';
  return v;
end $fn$;
revoke all on function app_private.automation_tasks_reconcile(boolean) from public, anon, authenticated;

create or replace function app_private.trg_emit_agent_submitted() returns trigger
language plpgsql security definer set search_path = app_private, public as $fn$
begin
  if new.status = 'under_review' and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (select 1 from app_private.automation_tasks t where t.status = 'open' and t.task_type = 'agent_review' and t.related_id = new.user_id::text) then
    perform app_private.emit_event('agent.submitted', 'agent', new.user_id::text, jsonb_build_object('name', new.full_name),
      'agsub:' || new.user_id::text || ':' || extract(epoch from clock_timestamp())::bigint::text);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_emit_agent_submitted on app_private.agent_profiles;
create trigger trg_emit_agent_submitted after insert or update of status on app_private.agent_profiles
  for each row execute function app_private.trg_emit_agent_submitted();

do $patch$
declare src text; a text;
begin
  src := pg_get_functiondef('public.cc_action_center()'::regprocedure);
  a := E'               1, c.created_at\n          from app_private.dispatcher_carrier_choices c';
  if position(a in src) = 0 then raise exception 'cc_action_center: choice ord anchor not found'; end if;
  src := replace(src, a, E'               -1, c.created_at   -- bl_ops_0486: above the automation tasks, like the trial rows\n          from app_private.dispatcher_carrier_choices c');
  execute src;
end $patch$;

select cron.unschedule('lb-automation-reconcile') where exists (select 1 from cron.job where jobname = 'lb-automation-reconcile');
select cron.schedule('lb-automation-reconcile', '3-59/10 * * * *', $c$select app_private.automation_tasks_reconcile()$c$);
