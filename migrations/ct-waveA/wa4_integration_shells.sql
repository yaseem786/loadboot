create table if not exists app_private.integration_configs (
  id uuid primary key default gen_random_uuid(), provider text unique not null, label text not null, category text,
  status text not null default 'not_connected' check (status in ('not_connected','connected','error')),
  config jsonb not null default '{}'::jsonb, last_sync timestamptz, last_error text, updated_by uuid, updated_at timestamptz not null default now());
alter table app_private.integration_configs enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;
insert into app_private.integration_configs(provider,label,category,status) values
  ('ga4','Google Analytics 4','analytics','not_connected'),
  ('search_console','Google Search Console','seo','not_connected'),
  ('resend','Transactional Email (Resend)','email','not_connected'),
  ('twilio','SMS (Twilio)','sms','not_connected'),
  ('maps','Maps / Routing','tracking','not_connected'),
  ('fmcsa','FMCSA / SAFER','compliance','not_connected')
on conflict (provider) do nothing;

create or replace function public.cc_integration_status()
returns table (provider text, label text, category text, status text, last_sync timestamptz, last_error text)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('integrations.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select i.provider,i.label,i.category,i.status,i.last_sync,i.last_error from app_private.integration_configs i order by i.category, i.label; end; $function$;

create or replace function public.cc_set_integration_status(p_provider text, p_status text, p_config jsonb default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('integrations.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('not_connected','connected','error') then raise exception 'invalid status' using errcode='22023'; end if;
  -- config holds only NON-SECRET settings (property id, site url). Secrets live in Supabase secrets, never here.
  update app_private.integration_configs set status=p_status, config=coalesce(p_config,config), updated_by=auth.uid(), updated_at=now() where provider=p_provider;
  if not found then raise exception 'unknown provider' using errcode='22023'; end if;
  perform app_private.log_audit('integration.status','integration',p_provider,null,'status '||p_status, '{}'::jsonb); return p_status; end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin for fn in select unnest(array['public.cc_integration_status()','public.cc_set_integration_status(text,text,jsonb)']) loop execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn); end loop; end $$;