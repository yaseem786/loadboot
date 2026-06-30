-- CONTROL TOWER WAVE D — Support / tickets. Flag: support_enabled. Staging + production.
insert into app_private.permissions(key,description) values ('support.view',null),('support.manage',null) on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values ('owner',array['support.view','support.manage']::text[]),('operations_admin',array['support.view','support.manage']::text[]),('support',array['support.view','support.manage']::text[]),('auditor',array['support.view']::text[])) as t(rk,perms) loop
    insert into app_private.role_permissions(role_id,permission_id) select r.id,p.id from app_private.roles r, app_private.permissions p where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop; end $$;

create sequence if not exists app_private.support_ticket_seq start 1001;
create table if not exists app_private.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('TKT-'||nextval('app_private.support_ticket_seq')),
  subject text not null, body text, requester_name text, requester_email text,
  channel text not null default 'manual', category text, priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  assignee_user uuid, related_type text, related_id text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), resolved_at timestamptz);
create index if not exists support_status_idx on app_private.support_tickets(status, created_at desc);
alter table app_private.support_tickets enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function public.cc_support_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('support.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('open',(select count(*) from app_private.support_tickets where status='open'),'pending',(select count(*) from app_private.support_tickets where status='pending'),'resolved',(select count(*) from app_private.support_tickets where status='resolved'),'urgent',(select count(*) from app_private.support_tickets where priority='urgent' and status in ('open','pending'))); end; $function$;

create or replace function public.cc_list_tickets(p_status text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, ref text, subject text, requester_name text, requester_email text, priority text, status text, category text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,200),1),500); begin if not public.has_global_permission('support.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select t.id,t.ref,t.subject,t.requester_name,t.requester_email,t.priority,t.status,t.category,t.created_at from app_private.support_tickets t
    where (p_status is null or t.status=p_status) and (p_search is null or t.subject ilike '%'||p_search||'%' or t.requester_email ilike '%'||p_search||'%' or t.ref ilike '%'||p_search||'%')
    order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at desc limit v_l; end; $function$;

create or replace function public.cc_get_ticket(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb; begin if not public.has_global_permission('support.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(t) into j from app_private.support_tickets t where t.id=p_id; if j is null then raise exception 'ticket not found' using errcode='22023'; end if; return j; end; $function$;

create or replace function public.cc_create_ticket(p_subject text, p_body text default null, p_requester_name text default null, p_requester_email text default null, p_priority text default 'normal', p_category text default null, p_related_type text default null, p_related_id text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_ref text; begin if not public.has_global_permission('support.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(btrim(p_subject),'')='' then raise exception 'subject required' using errcode='22023'; end if;
  insert into app_private.support_tickets(subject,body,requester_name,requester_email,priority,category,related_type,related_id,channel,created_by)
    values (p_subject,p_body,p_requester_name,p_requester_email,coalesce(p_priority,'normal'),p_category,p_related_type,p_related_id,'staff',auth.uid()) returning id,ref into v_id,v_ref;
  perform app_private.log_audit('support.create','support_ticket',v_id::text,null,v_ref||': '||p_subject,'{}'::jsonb);
  perform app_private.emit_event('ticket.created','support_ticket',v_id::text, jsonb_build_object('ref',v_ref,'priority',coalesce(p_priority,'normal')));
  return v_id; end; $function$;

create or replace function public.cc_set_ticket_status(p_id uuid, p_status text, p_assignee uuid default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('support.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('open','pending','resolved','closed') then raise exception 'invalid status' using errcode='22023'; end if;
  update app_private.support_tickets set status=p_status, assignee_user=coalesce(p_assignee,assignee_user), updated_at=now(), resolved_at=case when p_status in ('resolved','closed') then now() else resolved_at end where id=p_id;
  if not found then raise exception 'ticket not found' using errcode='22023'; end if;
  perform app_private.log_audit('support.status','support_ticket',p_id::text,null,'status '||p_status,'{}'::jsonb); return p_status; end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_support_overview()','public.cc_list_tickets(text,text,int)','public.cc_get_ticket(uuid)','public.cc_create_ticket(text,text,text,text,text,text,text,text)','public.cc_set_ticket_status(uuid,text,uuid)']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('support_enabled',false,'Enable the Support / tickets module','all','staff') on conflict (key) do nothing;
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values ('ticket_created_followup','New ticket -> support follow-up','ticket.created','{}'::jsonb,'create_task_and_notify', jsonb_build_object('task_type','ticket_followup','title','Respond to support ticket','priority','high','assignee_role','support','template_key','ticket_received','sla_minutes',120), false) on conflict (key) do nothing;
