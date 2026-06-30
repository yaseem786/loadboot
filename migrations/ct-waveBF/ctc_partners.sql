-- CONTROL TOWER WAVE C — Brokers & Shippers as first-class partner entities.
-- Flag: partners_enabled. Applied to staging + production.
insert into app_private.permissions(key,description) values ('partners.view',null),('partners.manage',null) on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values ('owner',array['partners.view','partners.manage']::text[]),('operations_admin',array['partners.view','partners.manage']::text[]),('marketing',array['partners.view']::text[]),('auditor',array['partners.view']::text[])) as t(rk,perms) loop
    insert into app_private.role_permissions(role_id,permission_id) select r.id,p.id from app_private.roles r, app_private.permissions p where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop; end $$;

create table if not exists app_private.partners (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('broker','shipper')),
  name text not null, mc text, contact_name text, email text, phone text,
  billing_terms text, credit_limit numeric, status text not null default 'active' check (status in ('active','hold','inactive')),
  notes text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists partners_kind_idx on app_private.partners(kind, status, name);
alter table app_private.partners enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function public.cc_partners_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('partners.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('brokers',(select count(*) from app_private.partners where kind='broker'),'shippers',(select count(*) from app_private.partners where kind='shipper'),'active',(select count(*) from app_private.partners where status='active'),'hold',(select count(*) from app_private.partners where status='hold')); end; $function$;

create or replace function public.cc_list_partners(p_kind text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, kind text, name text, mc text, contact_name text, email text, phone text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,200),1),500); begin if not public.has_global_permission('partners.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select p.id,p.kind,p.name,p.mc,p.contact_name,p.email,p.phone,p.status,p.created_at from app_private.partners p
    where (p_kind is null or p.kind=p_kind) and (p_search is null or p.name ilike '%'||p_search||'%' or p.mc ilike '%'||p_search||'%' or p.email ilike '%'||p_search||'%')
    order by p.created_at desc limit v_l; end; $function$;

create or replace function public.cc_get_partner(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb; begin if not public.has_global_permission('partners.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(p) into j from app_private.partners p where p.id=p_id; if j is null then raise exception 'partner not found' using errcode='22023'; end if;
  return j || jsonb_build_object('timeline',coalesce((select jsonb_agg(jsonb_build_object('at',occurred_at,'action',action,'summary',summary) order by occurred_at desc) from (select * from app_private.audit_logs where target_type='partner' and target_id=p_id::text order by occurred_at desc limit 20) tl),'[]'::jsonb)); end; $function$;

create or replace function public.cc_upsert_partner(p_id uuid, p_kind text, p_name text, p_mc text default null, p_contact_name text default null, p_email text default null, p_phone text default null, p_billing_terms text default null, p_credit_limit numeric default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; begin if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_kind not in ('broker','shipper') then raise exception 'kind must be broker or shipper' using errcode='22023'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'name required' using errcode='22023'; end if;
  if p_id is null then insert into app_private.partners(kind,name,mc,contact_name,email,phone,billing_terms,credit_limit,notes,created_by) values (p_kind,p_name,p_mc,p_contact_name,p_email,p_phone,p_billing_terms,p_credit_limit,p_notes,auth.uid()) returning id into v_id;
  else update app_private.partners set kind=p_kind,name=p_name,mc=p_mc,contact_name=p_contact_name,email=p_email,phone=p_phone,billing_terms=p_billing_terms,credit_limit=p_credit_limit,notes=p_notes,updated_at=now() where id=p_id returning id into v_id;
    if v_id is null then raise exception 'partner not found' using errcode='22023'; end if; end if;
  perform app_private.log_audit('partner.upsert','partner',v_id::text,null,p_name,jsonb_build_object('kind',p_kind)); return v_id; end; $function$;

create or replace function public.cc_set_partner_status(p_id uuid, p_status text)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('active','hold','inactive') then raise exception 'invalid status' using errcode='22023'; end if;
  update app_private.partners set status=p_status, updated_at=now() where id=p_id; if not found then raise exception 'partner not found' using errcode='22023'; end if;
  perform app_private.log_audit('partner.status','partner',p_id::text,null,'status '||p_status,'{}'::jsonb); return p_status; end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_partners_overview()','public.cc_list_partners(text,text,int)','public.cc_get_partner(uuid)','public.cc_upsert_partner(uuid,text,text,text,text,text,text,text,numeric,text)','public.cc_set_partner_status(uuid,text)']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('partners_enabled',false,'Enable the Brokers & Shippers module','all','staff') on conflict (key) do nothing;
