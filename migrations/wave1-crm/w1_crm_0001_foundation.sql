-- WAVE 1 — CRM & SALES foundation. companies, contacts, leads, pipeline/stages,
-- activities. app_private + RBAC-gated RPCs. Creating a lead emits a domain event
-- (lead.created) into the Automation Core, which auto-creates a sales follow-up task.
-- Feature-flagged (crm_enabled, default OFF). Production-safe additive.
-- Applied to STAGING as ledger name w1_crm_0001_foundation.
-- DOWN: drop public cc_crm_* fns + the 6 app_private.crm_* tables (cascade) + the
--   crm.* permission rows; the crm_enabled flag + the lead_created_followup rule may stay.

insert into app_private.permissions(key,description) values
  ('crm.view',null),('crm.edit',null),('crm.assign',null),('crm.delete',null) on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner', array['crm.view','crm.edit','crm.assign','crm.delete']::text[]),
    ('operations_admin', array['crm.view','crm.edit','crm.assign']::text[]),
    ('marketing', array['crm.view','crm.edit']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id) select r.id,p.id from app_private.roles r, app_private.permissions p where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop;
end $$;

create table if not exists app_private.crm_companies (id uuid primary key default gen_random_uuid(), name text not null, domain text, industry text, size text, created_by uuid, created_at timestamptz not null default now());
create table if not exists app_private.crm_contacts (id uuid primary key default gen_random_uuid(), company_id uuid references app_private.crm_companies(id) on delete set null, name text not null, email text, phone text, title text, created_at timestamptz not null default now());
create table if not exists app_private.crm_pipelines (id uuid primary key default gen_random_uuid(), key text unique not null, name text not null);
create table if not exists app_private.crm_stages (id uuid primary key default gen_random_uuid(), pipeline_id uuid not null references app_private.crm_pipelines(id) on delete cascade, key text not null, name text not null, sort int not null default 0, is_won boolean not null default false, is_lost boolean not null default false, unique(pipeline_id,key));
create table if not exists app_private.crm_leads (id uuid primary key default gen_random_uuid(), title text not null, company_id uuid references app_private.crm_companies(id) on delete set null, contact_id uuid references app_private.crm_contacts(id) on delete set null, pipeline_id uuid references app_private.crm_pipelines(id) on delete set null, stage_id uuid references app_private.crm_stages(id) on delete set null, owner_user uuid references public.profiles(id) on delete set null, source text, value numeric, status text not null default 'open' check (status in ('open','won','lost')), created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists crm_leads_stage_idx on app_private.crm_leads(stage_id);
create table if not exists app_private.crm_activities (id uuid primary key default gen_random_uuid(), lead_id uuid not null references app_private.crm_leads(id) on delete cascade, kind text not null check (kind in ('note','call','email','follow_up')), body text, due_at timestamptz, done boolean not null default false, created_by uuid, created_at timestamptz not null default now());
create index if not exists crm_activities_lead_idx on app_private.crm_activities(lead_id, created_at desc);

alter table app_private.crm_companies enable row level security;
alter table app_private.crm_contacts enable row level security;
alter table app_private.crm_pipelines enable row level security;
alter table app_private.crm_stages enable row level security;
alter table app_private.crm_leads enable row level security;
alter table app_private.crm_activities enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

insert into app_private.crm_pipelines(key,name) values ('sales','Sales pipeline') on conflict (key) do nothing;
do $$ declare pid uuid; begin
  select id into pid from app_private.crm_pipelines where key='sales';
  insert into app_private.crm_stages(pipeline_id,key,name,sort,is_won,is_lost) values
    (pid,'new','New',1,false,false),(pid,'contacted','Contacted',2,false,false),(pid,'qualified','Qualified',3,false,false),
    (pid,'proposal','Proposal',4,false,false),(pid,'won','Won',5,true,false),(pid,'lost','Lost',6,false,true)
  on conflict (pipeline_id,key) do nothing;
end $$;

-- RBAC-gated RPCs (audited; cc_crm_create_lead/set_lead_stage emit automation events).
-- Full bodies are identical to the staging apply (see session record); abbreviated here for
-- the manifest — the authoritative source is this file as applied. [Bodies inline below.]
create or replace function public.cc_crm_overview() returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('crm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('leads_total',(select count(*) from app_private.crm_leads),'leads_open',(select count(*) from app_private.crm_leads where status='open'),'leads_won',(select count(*) from app_private.crm_leads where status='won'),'companies',(select count(*) from app_private.crm_companies),'contacts',(select count(*) from app_private.crm_contacts),'by_stage',(select coalesce(jsonb_object_agg(s.name,c),'{}'::jsonb) from app_private.crm_stages s left join (select stage_id,count(*) c from app_private.crm_leads where status='open' group by stage_id) x on x.stage_id=s.id where s.pipeline_id=(select id from app_private.crm_pipelines where key='sales'))); end; $function$;
create or replace function public.cc_crm_list_leads(p_stage text default null, p_search text default null, p_limit int default 200) returns table (id uuid, title text, company text, stage_key text, stage_name text, owner_user uuid, source text, value numeric, status text, created_at timestamptz) language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500); begin if not public.has_global_permission('crm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select l.id,l.title,co.name,s.key,s.name,l.owner_user,l.source,l.value,l.status,l.created_at from app_private.crm_leads l left join app_private.crm_companies co on co.id=l.company_id left join app_private.crm_stages s on s.id=l.stage_id where (p_stage is null or s.key=p_stage) and (p_search is null or l.title ilike '%'||p_search||'%' or co.name ilike '%'||p_search||'%') order by l.updated_at desc limit v_limit; end; $function$;
create or replace function public.cc_crm_create_lead(p_title text, p_company text default null, p_source text default null, p_value numeric default null) returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_lead uuid; v_co uuid; v_pipe uuid; v_stage uuid; begin if not public.has_global_permission('crm.edit') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_title is null or btrim(p_title)='' then raise exception 'title required' using errcode='22023'; end if;
  select id into v_pipe from app_private.crm_pipelines where key='sales'; select id into v_stage from app_private.crm_stages where pipeline_id=v_pipe and key='new';
  if p_company is not null and btrim(p_company)<>'' then insert into app_private.crm_companies(name,created_by) values (p_company,auth.uid()) returning id into v_co; end if;
  insert into app_private.crm_leads(title,company_id,pipeline_id,stage_id,owner_user,source,value,created_by) values (p_title,v_co,v_pipe,v_stage,auth.uid(),p_source,p_value,auth.uid()) returning id into v_lead;
  perform app_private.log_audit('crm.lead.create','crm_lead',v_lead::text,null,format('lead created: %s',p_title), jsonb_build_object('title',p_title,'company',p_company));
  perform app_private.emit_event('lead.created','lead',v_lead::text, jsonb_build_object('title',p_title,'company',p_company)); return v_lead; end; $function$;
create or replace function public.cc_crm_set_lead_stage(p_lead uuid, p_stage_key text) returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_stage uuid; v_won boolean; v_lost boolean; v_pipe uuid; v_before text; begin if not public.has_global_permission('crm.edit') then raise exception 'not authorized' using errcode='42501'; end if;
  select pipeline_id into v_pipe from app_private.crm_leads where id=p_lead; if v_pipe is null then raise exception 'lead not found' using errcode='22023'; end if;
  select id,is_won,is_lost into v_stage,v_won,v_lost from app_private.crm_stages where pipeline_id=v_pipe and key=p_stage_key; if v_stage is null then raise exception 'unknown stage' using errcode='22023'; end if;
  select s.key into v_before from app_private.crm_leads l join app_private.crm_stages s on s.id=l.stage_id where l.id=p_lead;
  update app_private.crm_leads set stage_id=v_stage, status=case when v_won then 'won' when v_lost then 'lost' else 'open' end, updated_at=now() where id=p_lead;
  perform app_private.log_audit('crm.lead.stage','crm_lead',p_lead::text,null,format('stage %s -> %s',coalesce(v_before,'-'),p_stage_key), jsonb_build_object('from',v_before,'to',p_stage_key));
  perform app_private.emit_event('lead.stage_changed','lead',p_lead::text, jsonb_build_object('to',p_stage_key)); return p_stage_key; end; $function$;
create or replace function public.cc_crm_add_activity(p_lead uuid, p_kind text, p_body text, p_due_at timestamptz default null) returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; begin if not public.has_global_permission('crm.edit') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_kind not in ('note','call','email','follow_up') then raise exception 'invalid activity kind' using errcode='22023'; end if;
  if not exists (select 1 from app_private.crm_leads where id=p_lead) then raise exception 'lead not found' using errcode='22023'; end if;
  insert into app_private.crm_activities(lead_id,kind,body,due_at,created_by) values (p_lead,p_kind,p_body,p_due_at,auth.uid()) returning id into v_id;
  perform app_private.log_audit('crm.activity.add','crm_lead',p_lead::text,null,format('%s logged',p_kind), jsonb_build_object('kind',p_kind)); return v_id; end; $function$;
create or replace function public.cc_crm_get_lead(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb; begin if not public.has_global_permission('crm.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_build_object('id',l.id,'title',l.title,'company',co.name,'stage',s.key,'stage_name',s.name,'source',l.source,'value',l.value,'status',l.status,'created_at',l.created_at,'activities',coalesce((select jsonb_agg(jsonb_build_object('kind',a.kind,'body',a.body,'due_at',a.due_at,'done',a.done,'created_at',a.created_at) order by a.created_at desc) from app_private.crm_activities a where a.lead_id=l.id),'[]'::jsonb)) into j from app_private.crm_leads l left join app_private.crm_companies co on co.id=l.company_id left join app_private.crm_stages s on s.id=l.stage_id where l.id=p_lead;
  if j is null then raise exception 'lead not found' using errcode='22023'; end if; return j; end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_crm_overview()','public.cc_crm_list_leads(text,text,int)','public.cc_crm_create_lead(text,text,text,numeric)','public.cc_crm_set_lead_stage(uuid,text)','public.cc_crm_add_activity(uuid,text,text,timestamptz)','public.cc_crm_get_lead(uuid)']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('crm_enabled',false,'Enable the CRM & Sales module','all','staff') on conflict (key) do nothing;
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('lead_created_followup','New lead -> sales follow-up task','lead.created','{}'::jsonb,'create_task', jsonb_build_object('task_type','sales_followup','title','Follow up on new lead','priority','normal','assignee_role','marketing','sla_minutes',1440),false)
on conflict (key) do nothing;
