-- CONTROL TOWER WAVE L — Announcements/Broadcast + Marketing Campaign manager.
-- Announcements: send Info/Warning/Emergency/Promo to all carriers or one carrier; shown in
-- the Carrier Pocket app + portal (cc_pocket_announcements, self-scoped). Campaigns: UTM-tagged
-- links with live performance from first-party web analytics. Flags announcements_enabled /
-- campaigns_enabled (staging on, prod off). Applied to staging + production.
insert into app_private.permissions(key,description) values
  ('announce.view',null),('announce.manage',null),('campaigns.view',null),('campaigns.manage',null) on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',array['announce.view','announce.manage','campaigns.view','campaigns.manage']::text[]),
    ('operations_admin',array['announce.view','announce.manage','campaigns.view','campaigns.manage']::text[]),
    ('marketing',array['announce.view','announce.manage','campaigns.view','campaigns.manage']::text[]),
    ('support',array['announce.view','announce.manage']::text[]),
    ('auditor',array['announce.view','campaigns.view']::text[])) as t(rk,perms) loop
    insert into app_private.role_permissions(role_id,permission_id) select r.id,p.id from app_private.roles r, app_private.permissions p where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop; end $$;

create table if not exists app_private.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null, body text,
  kind text not null default 'info' check (kind in ('info','warning','emergency','promo')),
  audience text not null default 'all_carriers' check (audience in ('all_carriers','carrier','all_staff')),
  target_org uuid, active boolean not null default true,
  starts_at timestamptz not null default now(), expires_at timestamptz,
  created_by uuid, created_at timestamptz not null default now());
create index if not exists announcements_active_idx on app_private.announcements(active, audience, created_at desc);
alter table app_private.announcements enable row level security;

create or replace function public.cc_create_announcement(p_title text, p_body text, p_kind text default 'info', p_audience text default 'all_carriers', p_target_org uuid default null, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; begin if not public.has_global_permission('announce.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(btrim(p_title),'')='' then raise exception 'title required' using errcode='22023'; end if;
  if p_kind not in ('info','warning','emergency','promo') then raise exception 'invalid kind' using errcode='22023'; end if;
  if p_audience not in ('all_carriers','carrier','all_staff') then raise exception 'invalid audience' using errcode='22023'; end if;
  if p_audience='carrier' and p_target_org is null then raise exception 'pick a carrier for a targeted announcement' using errcode='22023'; end if;
  insert into app_private.announcements(title,body,kind,audience,target_org,expires_at,created_by)
    values (left(p_title,200),left(coalesce(p_body,''),4000),p_kind,p_audience,p_target_org,p_expires_at,auth.uid()) returning id into v_id;
  perform app_private.log_audit('announce.create','announcement',v_id::text,p_target_org,p_kind||' -> '||p_audience,jsonb_build_object('title',p_title));
  perform app_private.emit_event('announcement.created','announcement',v_id::text,jsonb_build_object('kind',p_kind,'audience',p_audience));
  return v_id; end; $function$;

create or replace function public.cc_list_announcements(p_limit int default 100)
returns table (id uuid, title text, kind text, audience text, target_org uuid, active boolean, expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,100),1),300); begin if not public.has_global_permission('announce.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select a.id,a.title,a.kind,a.audience,a.target_org,a.active,a.expires_at,a.created_at from app_private.announcements a order by a.created_at desc limit v_l; end; $function$;

create or replace function public.cc_set_announcement_active(p_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('announce.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.announcements set active=coalesce(p_active,true) where id=p_id; if not found then raise exception 'not found' using errcode='22023'; end if;
  perform app_private.log_audit('announce.toggle','announcement',p_id::text,null,case when p_active then 'active' else 'off' end,'{}'::jsonb); return coalesce(p_active,true); end; $function$;

create or replace function public.cc_pocket_announcements()
returns table (id uuid, title text, body text, kind text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_org uuid;
begin
  select id into v_org from public.organizations where owner_user_id=auth.uid() and kind='carrier' limit 1;
  if v_org is null then return; end if;
  return query select a.id,a.title,a.body,a.kind,a.created_at from app_private.announcements a
    where a.active and a.starts_at<=now() and (a.expires_at is null or a.expires_at>now())
      and (a.audience='all_carriers' or (a.audience='carrier' and a.target_org=v_org))
    order by case a.kind when 'emergency' then 0 when 'warning' then 1 when 'promo' then 2 else 3 end, a.created_at desc limit 20; end; $function$;

create table if not exists app_private.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null, utm_source text, utm_medium text, utm_campaign text not null,
  landing_path text default '/', active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), unique(utm_campaign));
alter table app_private.campaigns enable row level security;

create or replace function public.cc_create_campaign(p_name text, p_source text, p_medium text, p_campaign text, p_landing text default '/')
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; begin if not public.has_global_permission('campaigns.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(btrim(p_name),'')='' or coalesce(btrim(p_campaign),'')='' then raise exception 'name and campaign code required' using errcode='22023'; end if;
  insert into app_private.campaigns(name,utm_source,utm_medium,utm_campaign,landing_path,created_by)
    values (left(p_name,120),left(p_source,60),left(p_medium,60),left(regexp_replace(p_campaign,'\s+','_','g'),60),coalesce(nullif(left(p_landing,200),''),'/'),auth.uid()) returning id into v_id;
  perform app_private.log_audit('campaign.create','campaign',v_id::text,null,p_name,'{}'::jsonb); return v_id; end; $function$;

create or replace function public.cc_list_campaigns(p_limit int default 100)
returns table (id uuid, name text, utm_source text, utm_medium text, utm_campaign text, landing_path text, active boolean, sessions bigint, conversions bigint, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,100),1),300); begin if not public.has_global_permission('campaigns.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select c.id,c.name,c.utm_source,c.utm_medium,c.utm_campaign,c.landing_path,c.active,
      (select count(*) from app_private.web_sessions s where s.utm_campaign=c.utm_campaign and not s.is_bot),
      (select count(*) from app_private.web_sessions s where s.utm_campaign=c.utm_campaign and s.converted and not s.is_bot),
      c.created_at
    from app_private.campaigns c order by c.created_at desc limit v_l; end; $function$;

create or replace function public.cc_set_campaign_active(p_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('campaigns.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.campaigns set active=coalesce(p_active,true) where id=p_id; if not found then raise exception 'not found' using errcode='22023'; end if; return coalesce(p_active,true); end; $function$;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array[
  'public.cc_create_announcement(text,text,text,text,uuid,timestamptz)','public.cc_list_announcements(int)','public.cc_set_announcement_active(uuid,boolean)','public.cc_pocket_announcements()',
  'public.cc_create_campaign(text,text,text,text,text)','public.cc_list_campaigns(int)','public.cc_set_campaign_active(uuid,boolean)']) loop
  execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values
  ('announcements_enabled',false,'Enable Announcements & Broadcast','all','staff'),
  ('campaigns_enabled',false,'Enable the Campaign manager','all','staff') on conflict (key) do nothing;
