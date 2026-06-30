-- AUTOMATION CORE v1 foundation. Reusable engine every future module plugs into:
-- domain events (outbox) -> rules engine -> tasks + notifications, with idempotency,
-- retry/dead-letter, SLA, human-approval gate, and audit. app_private + RBAC-gated RPCs.
-- Applied to STAGING (snslhvmkjusozgjelghi) as ledger name ac_v1_0001_automation_core_foundation.
-- PRODUCTION-SAFE (additive); apply to production only as part of a reviewed automation rollout,
-- with the automation_core_enabled flag OFF until a production smoke test passes.
-- DOWN: drop the public cc_list_tasks/cc_complete_task/cc_automation_health fns + the 5 tables
-- (domain_events, idempotency_keys, automation_rules, automation_tasks, notifications) + the
-- app_private emit/run/process fns; the feature flag row may stay (harmless).

create table if not exists app_private.domain_events (
  id bigint generated always as identity primary key,
  event_type text not null, aggregate_type text not null, aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processed','failed','dead')),
  attempts int not null default 0, last_error text, processed_at timestamptz, dedupe_key text, actor_id uuid);
create index if not exists domain_events_pending_idx on app_private.domain_events (status, id) where status in ('pending','failed');
create unique index if not exists domain_events_dedupe on app_private.domain_events (dedupe_key) where dedupe_key is not null;

create table if not exists app_private.idempotency_keys (key text primary key, scope text not null, created_at timestamptz not null default now());

create table if not exists app_private.automation_rules (
  id uuid primary key default gen_random_uuid(), key text unique not null, name text not null,
  trigger_event text not null, condition jsonb not null default '{}'::jsonb,
  action_type text not null check (action_type in ('create_task','notify','create_task_and_notify')),
  action_config jsonb not null default '{}'::jsonb, requires_approval boolean not null default false,
  enabled boolean not null default true, created_at timestamptz not null default now());

create table if not exists app_private.automation_tasks (
  id uuid primary key default gen_random_uuid(), task_type text not null, title text not null, description text,
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_role text, assignee_user uuid references public.profiles(id) on delete set null,
  related_type text, related_id text, due_at timestamptz, sla_at timestamptz,
  source_rule text, source_event_id bigint, requires_approval boolean not null default false,
  created_at timestamptz not null default now(), completed_at timestamptz, completed_by uuid);
create index if not exists automation_tasks_open_idx on app_private.automation_tasks (status, priority, created_at desc);

create table if not exists app_private.notifications (
  id uuid primary key default gen_random_uuid(), recipient_role text,
  recipient_user uuid references public.profiles(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app','email','sms')),
  template_key text not null, payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sent','failed','suppressed')),
  created_at timestamptz not null default now(), sent_at timestamptz);
create index if not exists notifications_queued_idx on app_private.notifications (status, created_at);

alter table app_private.domain_events enable row level security;
alter table app_private.idempotency_keys enable row level security;
alter table app_private.automation_rules enable row level security;
alter table app_private.automation_tasks enable row level security;
alter table app_private.notifications enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function app_private.emit_event(p_type text, p_agg_type text, p_agg_id text, p_payload jsonb default '{}'::jsonb, p_dedupe text default null)
 returns bigint language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id bigint; begin
  if p_dedupe is not null and exists (select 1 from app_private.domain_events where dedupe_key=p_dedupe) then select id into v_id from app_private.domain_events where dedupe_key=p_dedupe; return v_id; end if;
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,payload,dedupe_key,actor_id) values (p_type,p_agg_type,p_agg_id,coalesce(p_payload,'{}'::jsonb),p_dedupe,auth.uid()) returning id into v_id; return v_id;
end; $function$;

create or replace function app_private.run_rules_for_event(p_event_id bigint)
 returns int language plpgsql security definer set search_path to 'app_private, public' as $function$
declare e record; r record; n_actions int := 0; v_match boolean; k text; v_task uuid; begin
  select * into e from app_private.domain_events where id=p_event_id for update; if e is null then return 0; end if;
  for r in select * from app_private.automation_rules where enabled and trigger_event=e.event_type loop
    v_match := true;
    for k in select jsonb_object_keys(r.condition) loop if (e.payload->>k) is distinct from (r.condition->>k) then v_match := false; exit; end if; end loop;
    if not v_match then continue; end if;
    if r.action_type in ('create_task','create_task_and_notify') then
      insert into app_private.automation_tasks(task_type,title,description,priority,assignee_role,related_type,related_id,source_rule,source_event_id,requires_approval,sla_at)
        values (coalesce(r.action_config->>'task_type','generic'), coalesce(r.action_config->>'title', r.name), r.action_config->>'description', coalesce(r.action_config->>'priority','normal'), r.action_config->>'assignee_role', e.aggregate_type, e.aggregate_id, r.key, e.id, r.requires_approval, case when r.action_config ? 'sla_minutes' then now() + ((r.action_config->>'sla_minutes')||' minutes')::interval else null end) returning id into v_task;
      n_actions := n_actions + 1;
    end if;
    if r.action_type in ('notify','create_task_and_notify') then
      insert into app_private.notifications(recipient_role,channel,template_key,payload) values (r.action_config->>'assignee_role', coalesce(r.action_config->>'channel','in_app'), coalesce(r.action_config->>'template_key', r.key), e.payload);
      n_actions := n_actions + 1;
    end if;
  end loop;
  update app_private.domain_events set status='processed', processed_at=now(), attempts=attempts+1 where id=p_event_id; return n_actions;
exception when others then
  update app_private.domain_events set status=case when attempts+1>=5 then 'dead' else 'failed' end, attempts=attempts+1, last_error=sqlerrm where id=p_event_id; return -1;
end; $function$;

create or replace function app_private.process_outbox(p_limit int default 100)
 returns int language plpgsql security definer set search_path to 'app_private, public' as $function$
declare ev bigint; n int := 0; begin
  for ev in select id from app_private.domain_events where status in ('pending','failed') and attempts < 5 order by id limit p_limit loop perform app_private.run_rules_for_event(ev); n := n + 1; end loop; return n;
end; $function$;

create or replace function public.cc_list_tasks(p_status text default 'open', p_limit int default 100)
 returns table (id uuid, task_type text, title text, status text, priority text, assignee_role text, related_type text, related_id text, requires_approval boolean, sla_at timestamptz, created_at timestamptz)
 language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,100),1),500); begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select t.id,t.task_type,t.title,t.status,t.priority,t.assignee_role,t.related_type,t.related_id,t.requires_approval,t.sla_at,t.created_at from app_private.automation_tasks t where (p_status is null or t.status=p_status) order by t.priority desc, t.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_complete_task(p_task uuid)
 returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare t record; begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into t from app_private.automation_tasks where id=p_task; if t is null then raise exception 'task not found' using errcode='22023'; end if;
  if t.requires_approval and not public.has_global_permission('settings.manage') then raise exception 'this task needs an approver' using errcode='42501'; end if;
  update app_private.automation_tasks set status='done', completed_at=now(), completed_by=auth.uid() where id=p_task;
  perform app_private.log_audit('automation.task.complete','automation_task',p_task::text,null,format('task %s completed',t.task_type), jsonb_build_object('task_type',t.task_type)); return 'done';
end; $function$;

create or replace function public.cc_automation_health()
 returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('events_pending',(select count(*) from app_private.domain_events where status='pending'),'events_failed',(select count(*) from app_private.domain_events where status='failed'),'events_dead',(select count(*) from app_private.domain_events where status='dead'),'tasks_open',(select count(*) from app_private.automation_tasks where status='open'),'tasks_awaiting_approval',(select count(*) from app_private.automation_tasks where status='open' and requires_approval),'notifications_queued',(select count(*) from app_private.notifications where status='queued'),'rules_enabled',(select count(*) from app_private.automation_rules where enabled));
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_list_tasks(text,int)','public.cc_complete_task(uuid)','public.cc_automation_health()']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('automation_core_enabled',false,'Enable the automation engine (events->rules->tasks)','all','staff') on conflict (key) do nothing;
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('carrier_submitted_onboarding_task','Carrier submitted -> onboarding review task','carrier.submitted','{}'::jsonb,'create_task_and_notify', jsonb_build_object('task_type','onboarding_review','title','Review new carrier onboarding','priority','high','assignee_role','compliance_reviewer','template_key','carrier_onboarding','sla_minutes',120),false)
on conflict (key) do nothing;
