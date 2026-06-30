-- WAVE 7 — CONTENT / MARKETING foundation.
-- A content management surface for the marketing site: blog posts (draft/published/archived)
-- and editable site pages/snippets. All writes go through RBAC-gated, audited SECURITY DEFINER
-- RPCs. Publishing emits a domain event (marketing notification). Feature-flagged
-- (content_enabled, default OFF). Production-safe additive.
-- Applied to STAGING as ledger name w7_content_0001_foundation.
-- DOWN: drop public cc_content_*/cc_*_post/cc_*_page fns + app_private.content_posts,
--   content_pages + content.* permission rows.

insert into app_private.permissions(key,description) values
  ('content.view',null),('content.edit',null),('content.publish',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',            array['content.view','content.edit','content.publish']::text[]),
    ('operations_admin', array['content.view','content.edit','content.publish']::text[]),
    ('content_seo',      array['content.view','content.edit','content.publish']::text[]),
    ('marketing',        array['content.view','content.edit']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms)
    on conflict do nothing;
  end loop;
end $$;

create table if not exists app_private.content_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null, excerpt text, body text,
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  author_user uuid, published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists content_posts_status_idx on app_private.content_posts(status, updated_at desc);

create table if not exists app_private.content_pages (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, title text not null, body text,
  updated_by uuid, updated_at timestamptz not null default now());

alter table app_private.content_posts enable row level security;
alter table app_private.content_pages enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

insert into app_private.content_pages(key,title,body) values
  ('home_hero','Homepage hero','Higher-paying loads, less deadhead — flat 5%, no contracts.'),
  ('about','About LoadBoot','LoadBoot is a modern truck dispatching service for owner-operators and small fleets.')
on conflict (key) do nothing;
insert into app_private.content_posts(slug,title,excerpt,status,tags,published_at) values
  ('how-to-get-loads-new-authority','How to get loads with a new authority','Practical steps for brand-new carriers to land their first profitable loads.','published',array['authority','getting-started'],now()),
  ('dispatcher-vs-broker','Truck dispatcher vs freight broker','What is the difference, and which one actually works for your trucks?','published',array['education'],now())
on conflict (slug) do nothing;

create or replace function public.cc_content_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('content.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'published', (select count(*) from app_private.content_posts where status='published'),
    'draft',     (select count(*) from app_private.content_posts where status='draft'),
    'archived',  (select count(*) from app_private.content_posts where status='archived'),
    'pages',     (select count(*) from app_private.content_pages));
end; $function$;

create or replace function public.cc_list_posts(p_status text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, slug text, title text, excerpt text, status text, tags text[], published_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public.has_global_permission('content.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select p.id,p.slug,p.title,p.excerpt,p.status,p.tags,p.published_at,p.updated_at
    from app_private.content_posts p
    where (p_status is null or p.status=p_status)
      and (p_search is null or p.title ilike '%'||p_search||'%' or p.slug ilike '%'||p_search||'%')
    order by p.updated_at desc limit v_limit;
end; $function$;

create or replace function public.cc_get_post(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb;
begin
  if not public.has_global_permission('content.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(p) into j from app_private.content_posts p where p.id=p_id;
  if j is null then raise exception 'post not found' using errcode='22023'; end if;
  return j;
end; $function$;

create or replace function public.cc_upsert_post(p_id uuid, p_title text, p_slug text, p_excerpt text default null, p_body text default null, p_tags text[] default '{}')
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('content.edit') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_title is null or btrim(p_title)='' then raise exception 'title required' using errcode='22023'; end if;
  if p_slug is null or btrim(p_slug)='' then raise exception 'slug required' using errcode='22023'; end if;
  if p_id is null then
    insert into app_private.content_posts(slug,title,excerpt,body,tags,author_user)
      values (p_slug,p_title,p_excerpt,p_body,coalesce(p_tags,'{}'),auth.uid()) returning id into v_id;
  else
    update app_private.content_posts set slug=p_slug,title=p_title,excerpt=p_excerpt,body=p_body,tags=coalesce(p_tags,'{}'),updated_at=now()
      where id=p_id returning id into v_id;
    if v_id is null then raise exception 'post not found' using errcode='22023'; end if;
  end if;
  perform app_private.log_audit('content.post.upsert','content_post',v_id::text,null,format('post saved: %s',p_title), jsonb_build_object('slug',p_slug));
  return v_id;
end; $function$;

create or replace function public.cc_set_post_status(p_id uuid, p_status text)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_title text;
begin
  if p_status='published' then
    if not public.has_global_permission('content.publish') then raise exception 'not authorized to publish' using errcode='42501'; end if;
  else
    if not public.has_global_permission('content.edit') then raise exception 'not authorized' using errcode='42501'; end if;
  end if;
  if p_status not in ('draft','published','archived') then raise exception 'invalid status' using errcode='22023'; end if;
  update app_private.content_posts
    set status=p_status, published_at=case when p_status='published' then coalesce(published_at,now()) else published_at end, updated_at=now()
    where id=p_id returning title into v_title;
  if v_title is null then raise exception 'post not found' using errcode='22023'; end if;
  perform app_private.log_audit('content.post.'||p_status,'content_post',p_id::text,null,format('%s -> %s',v_title,p_status), jsonb_build_object('status',p_status));
  if p_status='published' then
    perform app_private.emit_event('content.published','content_post',p_id::text, jsonb_build_object('title',v_title));
  end if;
  return p_status;
end; $function$;

create or replace function public.cc_list_pages()
returns table (id uuid, key text, title text, body text, updated_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('content.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select p.id,p.key,p.title,p.body,p.updated_at from app_private.content_pages p order by p.key;
end; $function$;

create or replace function public.cc_upsert_page(p_key text, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('content.edit') then raise exception 'not authorized' using errcode='42501'; end if;
  insert into app_private.content_pages(key,title,body,updated_by,updated_at)
    values (p_key,p_title,p_body,auth.uid(),now())
  on conflict (key) do update set title=excluded.title, body=excluded.body, updated_by=auth.uid(), updated_at=now()
  returning id into v_id;
  perform app_private.log_audit('content.page.upsert','content_page',v_id::text,null,format('page saved: %s',p_key), jsonb_build_object('key',p_key));
  return v_id;
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_content_overview()','public.cc_list_posts(text,text,int)','public.cc_get_post(uuid)',
    'public.cc_upsert_post(uuid,text,text,text,text,text[])','public.cc_set_post_status(uuid,text)',
    'public.cc_list_pages()','public.cc_upsert_page(text,text,text)']) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('content_enabled',false,'Enable the Content / Marketing module','all','staff')
on conflict (key) do nothing;
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('content_published_notify','Post published -> marketing notification','content.published','{}'::jsonb,'notify',
     jsonb_build_object('assignee_role','marketing','channel','in_app','template_key','content_published'), false)
on conflict (key) do nothing;
