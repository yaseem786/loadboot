-- WAVE 4 — COMMUNICATIONS foundation.
-- Internal communications hub: message threads (optionally linked to a carrier/load/trip),
-- a notification center over the Automation Core notifications table, and reusable message
-- templates (in_app/email/sms). All writes go through RBAC-gated, audited SECURITY DEFINER
-- RPCs. Starting a thread emits a domain event into the Automation Core (support task).
-- NOTE: outbound email/SMS are QUEUED only (status='queued'); actual external sending is an
-- integration concern deferred to Wave 8 and must require human approval — nothing here
-- contacts a real provider. Feature-flagged (comms_enabled, default OFF). Production-safe additive.
-- Applied to STAGING as ledger name w4_comms_0001_foundation.
-- DOWN: drop public cc_comm_*/cc_*_thread/cc_post_message/cc_*_notification/cc_*_template fns +
--   app_private.comm_messages, comm_threads, comm_templates + comm.* permission rows.

insert into app_private.permissions(key,description) values
  ('comm.view',null),('comm.send',null),('comm.manage',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',            array['comm.view','comm.send','comm.manage']::text[]),
    ('operations_admin', array['comm.view','comm.send','comm.manage']::text[]),
    ('dispatcher',       array['comm.view','comm.send']::text[]),
    ('support',          array['comm.view','comm.send']::text[]),
    ('marketing',        array['comm.view','comm.send']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms)
    on conflict do nothing;
  end loop;
end $$;

create table if not exists app_private.comm_threads (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  related_type text check (related_type in ('carrier','load','trip','lead','none')) default 'none',
  related_id text,
  channel text not null default 'in_app' check (channel in ('in_app','email','sms')),
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid, created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now());
create index if not exists comm_threads_status_idx on app_private.comm_threads(status, last_message_at desc);

create table if not exists app_private.comm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references app_private.comm_threads(id) on delete cascade,
  body text not null,
  direction text not null default 'internal' check (direction in ('internal','outbound','inbound')),
  channel text not null default 'in_app' check (channel in ('in_app','email','sms')),
  author_user uuid, created_at timestamptz not null default now());
create index if not exists comm_messages_thread_idx on app_private.comm_messages(thread_id, created_at);

create table if not exists app_private.comm_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, name text not null,
  channel text not null default 'in_app' check (channel in ('in_app','email','sms')),
  subject text, body text not null, active boolean not null default true);

alter table app_private.comm_threads enable row level security;
alter table app_private.comm_messages enable row level security;
alter table app_private.comm_templates enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

insert into app_private.comm_templates(key,name,channel,subject,body) values
  ('carrier_welcome','Carrier welcome','email','Welcome to LoadBoot','Hi {{carrier}}, welcome aboard! Your dispatcher is ready to find you higher-paying loads.'),
  ('rate_con','Rate confirmation','email','Rate confirmation — {{origin}} to {{destination}}','Load {{load}}: {{origin}} -> {{destination}} at {{rate}}. Reply to confirm.'),
  ('check_call','Check-call SMS','sms',null,'Hi {{driver}}, quick check-call on load {{load}}. Whats your ETA to {{destination}}?'),
  ('invoice_sent','Invoice sent','email','Invoice {{invoice_no}}','Your dispatch invoice {{invoice_no}} for {{amount}} is ready.')
on conflict (key) do nothing;

create or replace function public.cc_comm_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('comm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'open_threads',   (select count(*) from app_private.comm_threads where status='open'),
    'closed_threads', (select count(*) from app_private.comm_threads where status='closed'),
    'messages_today', (select count(*) from app_private.comm_messages where created_at >= current_date),
    'notif_queued',   (select count(*) from app_private.notifications where status='queued'),
    'templates',      (select count(*) from app_private.comm_templates where active));
end; $function$;

create or replace function public.cc_list_threads(p_status text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, subject text, related_type text, related_id text, channel text, status text, last_message_at timestamptz, messages bigint)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public.has_global_permission('comm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select t.id,t.subject,t.related_type,t.related_id,t.channel,t.status,t.last_message_at,
           (select count(*) from app_private.comm_messages m where m.thread_id=t.id)
    from app_private.comm_threads t
    where (p_status is null or t.status=p_status)
      and (p_search is null or t.subject ilike '%'||p_search||'%')
    order by t.last_message_at desc limit v_limit;
end; $function$;

create or replace function public.cc_get_thread(p_thread uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb; v_sub text;
begin
  if not public.has_global_permission('comm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select subject into v_sub from app_private.comm_threads where id=p_thread;
  if v_sub is null then raise exception 'thread not found' using errcode='22023'; end if;
  select jsonb_build_object('id',t.id,'subject',t.subject,'related_type',t.related_type,'related_id',t.related_id,
    'channel',t.channel,'status',t.status,'created_at',t.created_at,
    'messages',coalesce((select jsonb_agg(jsonb_build_object('body',m.body,'direction',m.direction,'channel',m.channel,'created_at',m.created_at) order by m.created_at)
      from app_private.comm_messages m where m.thread_id=t.id),'[]'::jsonb))
    into j from app_private.comm_threads t where t.id=p_thread;
  return j;
end; $function$;

create or replace function public.cc_create_thread(p_subject text, p_body text, p_related_type text default 'none', p_related_id text default null, p_channel text default 'in_app')
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('comm.send') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_subject is null or btrim(p_subject)='' then raise exception 'subject required' using errcode='22023'; end if;
  if coalesce(p_related_type,'none') not in ('carrier','load','trip','lead','none') then raise exception 'invalid related_type' using errcode='22023'; end if;
  if p_channel not in ('in_app','email','sms') then raise exception 'invalid channel' using errcode='22023'; end if;
  insert into app_private.comm_threads(subject,related_type,related_id,channel,created_by)
    values (p_subject,coalesce(p_related_type,'none'),p_related_id,p_channel,auth.uid()) returning id into v_id;
  if p_body is not null and btrim(p_body)<>'' then
    insert into app_private.comm_messages(thread_id,body,direction,channel,author_user)
      values (v_id,p_body,case when p_channel='in_app' then 'internal' else 'outbound' end,p_channel,auth.uid());
  end if;
  perform app_private.log_audit('comm.thread.create','comm_thread',v_id::text,null,format('thread: %s',p_subject), jsonb_build_object('subject',p_subject,'channel',p_channel));
  perform app_private.emit_event('comm.thread_created','comm_thread',v_id::text, jsonb_build_object('subject',p_subject,'channel',p_channel), 'comm_thread:'||v_id::text);
  return v_id;
end; $function$;

create or replace function public.cc_post_message(p_thread uuid, p_body text, p_channel text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_ch text;
begin
  if not public.has_global_permission('comm.send') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'message body required' using errcode='22023'; end if;
  select channel into v_ch from app_private.comm_threads where id=p_thread;
  if v_ch is null then raise exception 'thread not found' using errcode='22023'; end if;
  v_ch := coalesce(p_channel,v_ch);
  insert into app_private.comm_messages(thread_id,body,direction,channel,author_user)
    values (p_thread,p_body,case when v_ch='in_app' then 'internal' else 'outbound' end,v_ch,auth.uid()) returning id into v_id;
  update app_private.comm_threads set last_message_at=now() where id=p_thread;
  perform app_private.log_audit('comm.message.post','comm_thread',p_thread::text,null,'message posted', jsonb_build_object('channel',v_ch));
  return v_id;
end; $function$;

create or replace function public.cc_set_thread_status(p_thread uuid, p_status text)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('comm.send') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('open','closed') then raise exception 'invalid status' using errcode='22023'; end if;
  update app_private.comm_threads set status=p_status where id=p_thread;
  if not found then raise exception 'thread not found' using errcode='22023'; end if;
  perform app_private.log_audit('comm.thread.status','comm_thread',p_thread::text,null,'thread '||p_status, jsonb_build_object('status',p_status));
  return p_status;
end; $function$;

create or replace function public.cc_list_notifications(p_status text default null, p_limit int default 100)
returns table (id uuid, recipient_role text, channel text, template_key text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,100),1),500);
begin
  if not public.has_global_permission('comm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select n.id,n.recipient_role,n.channel,n.template_key,n.status,n.created_at
    from app_private.notifications n where (p_status is null or n.status=p_status)
    order by n.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_mark_notification(p_id uuid, p_status text)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('comm.send') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('queued','sent','suppressed') then raise exception 'invalid status' using errcode='22023'; end if;
  update app_private.notifications set status=p_status, sent_at=case when p_status='sent' then now() else sent_at end where id=p_id;
  if not found then raise exception 'notification not found' using errcode='22023'; end if;
  return p_status;
end; $function$;

create or replace function public.cc_list_templates()
returns table (key text, name text, channel text, subject text, body text, active boolean)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('comm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select t.key,t.name,t.channel,t.subject,t.body,t.active from app_private.comm_templates t order by t.name;
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_comm_overview()','public.cc_list_threads(text,text,int)','public.cc_get_thread(uuid)',
    'public.cc_create_thread(text,text,text,text,text)','public.cc_post_message(uuid,text,text)',
    'public.cc_set_thread_status(uuid,text)','public.cc_list_notifications(text,int)',
    'public.cc_mark_notification(uuid,text)','public.cc_list_templates()']) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('comms_enabled',false,'Enable the Communications module','all','staff')
on conflict (key) do nothing;
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('comm_thread_support','New thread -> support follow-up','comm.thread_created','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','comm_followup','title','Follow up on new conversation','priority','normal','assignee_role','support','sla_minutes',480), false)
on conflict (key) do nothing;
