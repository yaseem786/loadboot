-- CONTROL TOWER WAVE G/H — staff scoped access (child-access) + team chat.
-- cc_list_carrier_orgs feeds the carrier-scoped role-assignment selector in Staff & roles
-- (admin_assign_role already supports scope_type='assigned_carrier'). Team chat is a
-- lightweight staff channel: cc_post_chat / cc_list_chat (polled). author_user is the
-- trusted identity; author_name is a cosmetic display label. Flag: team_chat_enabled.
-- Applied to staging + production.
create or replace function public.cc_list_carrier_orgs()
returns table (id uuid, name text, status text)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not (public.has_global_permission('staff.assign_role') or public.has_global_permission('roles.assign') or public.has_global_permission('carriers.view')) then raise exception 'not authorized' using errcode='42501'; end if;
  return query select o.id, o.name, o.status from public.organizations o where o.kind='carrier' order by o.name; end; $function$;
revoke all on function public.cc_list_carrier_orgs() from public, anon;
grant execute on function public.cc_list_carrier_orgs() to authenticated;

create table if not exists app_private.chat_messages (
  id bigint generated always as identity primary key,
  body text not null, author_user uuid, author_name text,
  created_at timestamptz not null default now());
create index if not exists chat_messages_id_idx on app_private.chat_messages(id);
alter table app_private.chat_messages enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function public.cc_post_chat(p_body text, p_name text default null)
returns bigint language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id bigint; v_body text;
begin if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  v_body := btrim(coalesce(p_body,''));
  if v_body = '' then raise exception 'message required' using errcode='22023'; end if;
  insert into app_private.chat_messages(body, author_user, author_name)
    values (left(v_body,2000), auth.uid(), left(coalesce(p_name,'Staff'),80)) returning id into v_id;
  return v_id; end; $function$;

create or replace function public.cc_list_chat(p_after bigint default 0, p_limit int default 100)
returns table (id bigint, body text, author_name text, is_me boolean, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,100),1),300);
begin if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select c.id, c.body, c.author_name, (c.author_user = auth.uid()) is_me, c.created_at
    from app_private.chat_messages c where c.id > coalesce(p_after,0) order by c.id desc limit v_l; end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_post_chat(text,text)','public.cc_list_chat(bigint,int)']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('team_chat_enabled',false,'Enable the staff team chat','all','staff') on conflict (key) do nothing;
