insert into app_private.permissions(key,description) values ('seo.view',null),('seo.manage',null) on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values ('owner',array['seo.view','seo.manage']::text[]),('operations_admin',array['seo.view','seo.manage']::text[]),('content_seo',array['seo.view','seo.manage']::text[]),('marketing',array['seo.view']::text[])) as t(rk,perms) loop
    insert into app_private.role_permissions(role_id,permission_id) select r.id,p.id from app_private.roles r, app_private.permissions p where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop; end $$;
create table if not exists app_private.seo_keywords (id uuid primary key default gen_random_uuid(), keyword text not null, target_page text, country text default 'US', device text default 'desktop', position numeric, prev_position numeric, best_position numeric, clicks int default 0, impressions int default 0, ctr numeric, intent text, priority text default 'normal' check (priority in ('low','normal','high')), owner uuid, status text not null default 'tracking' check (status in ('tracking','won','lost','paused')), notes text, updated_at timestamptz not null default now(), unique(keyword, country, device));
create table if not exists app_private.redirects (id uuid primary key default gen_random_uuid(), source_path text unique not null, destination text not null, type int not null default 301 check (type in (301,302)), reason text, active boolean not null default true, hit_count int not null default 0, last_hit timestamptz, created_by uuid, created_at timestamptz not null default now());
alter table app_private.seo_keywords enable row level security; alter table app_private.redirects enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;
create or replace function public.cc_seo_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('seo.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('keywords',(select count(*) from app_private.seo_keywords),'top10',(select count(*) from app_private.seo_keywords where position is not null and position<=10),'redirects',(select count(*) from app_private.redirects where active),'improving',(select count(*) from app_private.seo_keywords where prev_position is not null and position is not null and position<prev_position)); end; $function$;
create or replace function public.cc_list_keywords(p_search text default null, p_limit int default 200)
returns table (id uuid, keyword text, target_page text, pos numeric, prev_pos numeric, best_pos numeric, clicks int, impressions int, ctr numeric, priority text, status text)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,200),1),500); begin if not public.has_global_permission('seo.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select k.id,k.keyword,k.target_page,k.position,k.prev_position,k.best_position,k.clicks,k.impressions,k.ctr,k.priority,k.status from app_private.seo_keywords k where (p_search is null or k.keyword ilike '%'||p_search||'%') order by coalesce(k.position,999), k.impressions desc limit v_l; end; $function$;
create or replace function public.cc_upsert_keyword(p_id uuid, p_keyword text, p_target_page text default null, p_position numeric default null, p_priority text default null, p_intent text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_old numeric; begin if not public.has_global_permission('seo.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_id is null then insert into app_private.seo_keywords(keyword,target_page,position,best_position,priority,intent,notes,owner) values (p_keyword,p_target_page,p_position,p_position,coalesce(p_priority,'normal'),p_intent,p_notes,auth.uid()) returning id into v_id;
  else select position into v_old from app_private.seo_keywords where id=p_id;
    update app_private.seo_keywords set keyword=p_keyword,target_page=p_target_page,prev_position=v_old,position=coalesce(p_position,position),best_position=least(coalesce(best_position,999),coalesce(p_position,999)),priority=coalesce(p_priority,priority),intent=coalesce(p_intent,intent),notes=coalesce(p_notes,notes),updated_at=now() where id=p_id returning id into v_id; end if;
  perform app_private.log_audit('seo.keyword.upsert','seo_keyword',v_id::text,null,p_keyword,'{}'::jsonb); return v_id; end; $function$;
create or replace function public.cc_list_redirects(p_limit int default 300)
returns table (id uuid, source_path text, destination text, type int, active boolean, hit_count int, last_hit timestamptz, reason text)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,300),1),1000); begin if not public.has_global_permission('seo.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select r.id,r.source_path,r.destination,r.type,r.active,r.hit_count,r.last_hit,r.reason from app_private.redirects r order by r.created_at desc limit v_l; end; $function$;
create or replace function public.cc_create_redirect(p_source text, p_destination text, p_type int default 301, p_reason text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; begin if not public.has_global_permission('seo.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_source is null or left(p_source,1)<>'/' then raise exception 'source must be an absolute path (/...)' using errcode='22023'; end if;
  if p_destination is null or btrim(p_destination)='' then raise exception 'destination required' using errcode='22023'; end if;
  if p_source = p_destination then raise exception 'redirect loop: source equals destination' using errcode='22023'; end if;
  if exists (select 1 from app_private.redirects where source_path=p_destination and active) then raise exception 'redirect chain: destination is itself a redirect source' using errcode='22023'; end if;
  if exists (select 1 from app_private.redirects where source_path=p_source) then raise exception 'a redirect for this source already exists' using errcode='22023'; end if;
  insert into app_private.redirects(source_path,destination,type,reason,created_by) values (p_source,p_destination,coalesce(p_type,301),p_reason,auth.uid()) returning id into v_id;
  perform app_private.log_audit('seo.redirect.create','redirect',v_id::text,null,p_source||' -> '||p_destination, jsonb_build_object('type',p_type)); return v_id; end; $function$;
create or replace function public.cc_toggle_redirect(p_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('seo.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.redirects set active=coalesce(p_active,true) where id=p_id; if not found then raise exception 'redirect not found' using errcode='22023'; end if; return coalesce(p_active,true); end; $function$;
revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_seo_overview()','public.cc_list_keywords(text,int)','public.cc_upsert_keyword(uuid,text,text,numeric,text,text,text)','public.cc_list_redirects(int)','public.cc_create_redirect(text,text,int,text)','public.cc_toggle_redirect(uuid,boolean)']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('seo_enabled',false,'Enable the SEO control center','all','staff') on conflict (key) do nothing;