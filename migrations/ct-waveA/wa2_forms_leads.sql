insert into app_private.permissions(key,description) values ('forms.view',null),('forms.manage',null) on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values ('owner',array['forms.view','forms.manage']::text[]),('operations_admin',array['forms.view','forms.manage']::text[]),('marketing',array['forms.view','forms.manage']::text[]),('support',array['forms.view','forms.manage']::text[]),('auditor',array['forms.view']::text[])) as t(rk,perms) loop
    insert into app_private.role_permissions(role_id,permission_id) select r.id,p.id from app_private.roles r, app_private.permissions p where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop; end $$;
create table if not exists app_private.form_submissions (
  id uuid primary key default gen_random_uuid(), form_key text not null default 'contact', anon_id text,
  name text, email text, phone text, company text, message text, raw jsonb not null default '{}'::jsonb,
  source_page text, referrer text, utm_source text, utm_medium text, utm_campaign text,
  status text not null default 'new' check (status in ('new','assigned','converted','spam','closed')),
  spam_score int not null default 0, assigned_to uuid, lead_id uuid references app_private.crm_leads(id) on delete set null,
  created_at timestamptz not null default now());
create index if not exists form_submissions_status_idx on app_private.form_submissions(status, created_at desc);
alter table app_private.form_submissions enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

-- PUBLIC INGEST (anon): validated, honeypot spam check, size-capped
create or replace function public.submit_web_form(p jsonb)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_spam int := 0; v_email text;
begin
  v_email := left(coalesce(p->>'email',''),255);
  if coalesce(p->>'_hp','')<>'' then v_spam := 100; end if;  -- honeypot filled = bot
  if v_email !~ '^[^@]+@[^@]+\.[^@]+$' then v_spam := v_spam + 40; end if;
  if length(coalesce(p->>'message',''))>5000 then return null; end if;
  insert into app_private.form_submissions(form_key,anon_id,name,email,phone,company,message,raw,source_page,referrer,utm_source,utm_medium,utm_campaign,status,spam_score)
    values (left(coalesce(p->>'form_key','contact'),64), left(p->>'anon_id',64), left(p->>'name',255), v_email, left(p->>'phone',64), left(p->>'company',255), left(p->>'message',5000),
            (coalesce(p,'{}'::jsonb) - '_hp'), left(p->>'page',512), left(p->>'referrer',512), left(p->>'utm_source',128), left(p->>'utm_medium',128), left(p->>'utm_campaign',128),
            case when v_spam>=80 then 'spam' else 'new' end, v_spam)
    returning id into v_id;
  -- mark the web session converted
  if p->>'anon_id' is not null then update app_private.web_sessions set converted=true where anon_id=left(p->>'anon_id',64); end if;
  if v_spam < 80 then perform app_private.emit_event('form.submitted','form_submission',v_id::text, jsonb_build_object('form',coalesce(p->>'form_key','contact'),'email',v_email)); end if;
  return v_id;
end; $function$;
revoke all on function public.submit_web_form(jsonb) from public; grant execute on function public.submit_web_form(jsonb) to anon, authenticated;

create or replace function public.cc_forms_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('forms.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('new',(select count(*) from app_private.form_submissions where status='new'),'assigned',(select count(*) from app_private.form_submissions where status='assigned'),'converted',(select count(*) from app_private.form_submissions where status='converted'),'spam',(select count(*) from app_private.form_submissions where status='spam'),'today',(select count(*) from app_private.form_submissions where created_at>=current_date and status<>'spam')); end; $function$;
create or replace function public.cc_list_forms(p_status text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, form_key text, name text, email text, company text, source_page text, status text, lead_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,200),1),500); begin if not public.has_global_permission('forms.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select f.id,f.form_key,f.name,f.email,f.company,f.source_page,f.status,f.lead_id,f.created_at from app_private.form_submissions f where (p_status is null or f.status=p_status) and (p_search is null or f.name ilike '%'||p_search||'%' or f.email ilike '%'||p_search||'%' or f.company ilike '%'||p_search||'%') order by f.created_at desc limit v_l; end; $function$;
create or replace function public.cc_get_form(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb; begin if not public.has_global_permission('forms.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(f) into j from app_private.form_submissions f where f.id=p_id; if j is null then raise exception 'form not found' using errcode='22023'; end if; return j; end; $function$;
create or replace function public.cc_convert_form_to_lead(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_lead uuid; f record; begin if not public.has_global_permission('forms.manage') or not public.has_global_permission('crm.edit') then raise exception 'not authorized' using errcode='42501'; end if;
  select * into f from app_private.form_submissions where id=p_id; if f.id is null then raise exception 'form not found' using errcode='22023'; end if;
  if f.lead_id is not null then return f.lead_id; end if;
  v_lead := public.cc_crm_create_lead(coalesce(f.name,f.email,'Web lead'), f.company, coalesce(f.utm_source,'website'), null);
  update app_private.form_submissions set lead_id=v_lead, status='converted' where id=p_id;
  perform app_private.log_audit('forms.convert','form_submission',p_id::text,null,'form converted to lead', jsonb_build_object('lead',v_lead)); return v_lead; end; $function$;
create or replace function public.cc_set_form_status(p_id uuid, p_status text, p_assignee uuid default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('forms.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('new','assigned','converted','spam','closed') then raise exception 'invalid status' using errcode='22023'; end if;
  update app_private.form_submissions set status=p_status, assigned_to=coalesce(p_assignee,assigned_to) where id=p_id;
  if not found then raise exception 'form not found' using errcode='22023'; end if;
  perform app_private.log_audit('forms.status','form_submission',p_id::text,null,'status '||p_status, '{}'::jsonb); return p_status; end; $function$;
revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_forms_overview()','public.cc_list_forms(text,text,int)','public.cc_get_form(uuid)','public.cc_convert_form_to_lead(uuid)','public.cc_set_form_status(uuid,text,uuid)']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('forms_enabled',false,'Enable the Forms inbox','all','staff') on conflict (key) do nothing;
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values ('form_submitted_followup','Web form -> sales follow-up','form.submitted','{}'::jsonb,'create_task_and_notify', jsonb_build_object('task_type','form_followup','title','Follow up on website enquiry','priority','high','assignee_role','marketing','template_key','form_received','sla_minutes',240), false) on conflict (key) do nothing;