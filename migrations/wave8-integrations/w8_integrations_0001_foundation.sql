-- WAVE 8 — INTEGRATIONS / WEBHOOKS foundation.
-- A configuration + delivery-queue surface for outbound webhooks and integrations.
-- SAFETY: this module NEVER contacts an external URL on its own. Webhook deliveries are only
-- ENQUEUED (status='queued') so an operator can review exactly what would be sent; actually
-- transmitting requires a deliberate, separately-approved sender (not part of this migration).
-- No secrets are stored in plaintext — an endpoint records only its URL + event subscription.
-- RBAC-gated, audited SECURITY DEFINER RPCs. Feature-flagged (integrations_enabled, default OFF).
-- Production-safe additive.
-- Applied to STAGING as ledger name w8_integrations_0001_foundation.
-- DOWN: drop public cc_integration*/cc_*endpoint*/cc_*deliver* fns + app_private.webhook_deliveries,
--   webhook_endpoints, integrations + integrations.* permission rows.

insert into app_private.permissions(key,description) values
  ('integrations.view',null),('integrations.manage',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',            array['integrations.view','integrations.manage']::text[]),
    ('operations_admin', array['integrations.view','integrations.manage']::text[]),
    ('auditor',          array['integrations.view']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms)
    on conflict do nothing;
  end loop;
end $$;

create table if not exists app_private.integrations (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, name text not null,
  kind text not null default 'webhook' check (kind in ('webhook','email','sms','storage','crm','other')),
  status text not null default 'available' check (status in ('available','connected','disabled')),
  config jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());

create table if not exists app_private.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null, url text not null,
  event_types text[] not null default '{}',
  active boolean not null default true, signing_configured boolean not null default false,
  created_by uuid, created_at timestamptz not null default now());
create index if not exists webhook_endpoints_active_idx on app_private.webhook_endpoints(active);

create table if not exists app_private.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references app_private.webhook_endpoints(id) on delete cascade,
  event_type text not null, payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','delivered','failed','skipped')),
  attempts int not null default 0, note text, created_at timestamptz not null default now());
create index if not exists webhook_deliveries_idx on app_private.webhook_deliveries(endpoint_id, created_at desc);

alter table app_private.integrations enable row level security;
alter table app_private.webhook_endpoints enable row level security;
alter table app_private.webhook_deliveries enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

insert into app_private.integrations(key,name,kind,status) values
  ('webhooks','Outbound Webhooks','webhook','connected'),
  ('email_smtp','Transactional Email','email','available'),
  ('sms_gateway','SMS Gateway','sms','available'),
  ('storage_s3','Document Storage','storage','available')
on conflict (key) do nothing;

create or replace function public.cc_integrations_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('integrations.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'connected',  (select count(*) from app_private.integrations where status='connected'),
    'available',  (select count(*) from app_private.integrations where status='available'),
    'endpoints',  (select count(*) from app_private.webhook_endpoints where active),
    'queued',     (select count(*) from app_private.webhook_deliveries where status='queued'),
    'failed',     (select count(*) from app_private.webhook_deliveries where status='failed'));
end; $function$;

create or replace function public.cc_list_integrations()
returns table (key text, name text, kind text, status text)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('integrations.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select i.key,i.name,i.kind,i.status from app_private.integrations i order by i.name;
end; $function$;

create or replace function public.cc_list_endpoints()
returns table (id uuid, name text, url text, event_types text[], active boolean, signing_configured boolean, created_at timestamptz, deliveries bigint)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('integrations.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select e.id,e.name,e.url,e.event_types,e.active,e.signing_configured,e.created_at,
    (select count(*) from app_private.webhook_deliveries d where d.endpoint_id=e.id)
    from app_private.webhook_endpoints e order by e.created_at desc;
end; $function$;

create or replace function public.cc_create_endpoint(p_name text, p_url text, p_event_types text[])
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('integrations.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'name required' using errcode='22023'; end if;
  if p_url is null or p_url !~ '^https://' then raise exception 'url must be https' using errcode='22023'; end if;
  insert into app_private.webhook_endpoints(name,url,event_types,created_by)
    values (p_name,p_url,coalesce(p_event_types,'{}'),auth.uid()) returning id into v_id;
  perform app_private.log_audit('integrations.endpoint.create','webhook_endpoint',v_id::text,null,format('endpoint %s',p_name), jsonb_build_object('url',p_url,'events',p_event_types));
  return v_id;
end; $function$;

create or replace function public.cc_set_endpoint_active(p_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('integrations.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.webhook_endpoints set active=coalesce(p_active,true) where id=p_id;
  if not found then raise exception 'endpoint not found' using errcode='22023'; end if;
  perform app_private.log_audit('integrations.endpoint.toggle','webhook_endpoint',p_id::text,null,'active='||coalesce(p_active,true)::text, jsonb_build_object('active',p_active));
  return coalesce(p_active,true);
end; $function$;

-- enqueue a TEST delivery (queued only — never transmitted by this module)
create or replace function public.cc_test_endpoint(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_name text;
begin
  if not public.has_global_permission('integrations.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  select name into v_name from app_private.webhook_endpoints where id=p_id;
  if v_name is null then raise exception 'endpoint not found' using errcode='22023'; end if;
  insert into app_private.webhook_deliveries(endpoint_id,event_type,payload,status,note)
    values (p_id,'ping', jsonb_build_object('test',true,'at',now()),'queued','test delivery (queued, not transmitted)')
    returning id into v_id;
  perform app_private.log_audit('integrations.endpoint.test','webhook_endpoint',p_id::text,null,'test delivery queued', '{}'::jsonb);
  return v_id;
end; $function$;

create or replace function public.cc_list_deliveries(p_status text default null, p_limit int default 100)
returns table (id uuid, endpoint text, event_type text, status text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,100),1),500);
begin
  if not public.has_global_permission('integrations.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select d.id,e.name,d.event_type,d.status,d.note,d.created_at
    from app_private.webhook_deliveries d join app_private.webhook_endpoints e on e.id=d.endpoint_id
    where (p_status is null or d.status=p_status) order by d.created_at desc limit v_limit;
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_integrations_overview()','public.cc_list_integrations()','public.cc_list_endpoints()',
    'public.cc_create_endpoint(text,text,text[])','public.cc_set_endpoint_active(uuid,boolean)',
    'public.cc_test_endpoint(uuid)','public.cc_list_deliveries(text,int)']) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('integrations_enabled',false,'Enable the Integrations / Webhooks module','all','staff')
on conflict (key) do nothing;
