-- CONTROL TOWER WAVE F — Automations management + Notifications center flags.
-- Flags: automations_admin_enabled, notifications_center_enabled. Staging + production.
create or replace function public.cc_list_rules()
returns table (id uuid, key text, name text, trigger_event text, action_type text, requires_approval boolean, enabled boolean, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select r.id,r.key,r.name,r.trigger_event,r.action_type,r.requires_approval,r.enabled,r.created_at from app_private.automation_rules r order by r.created_at; end; $function$;

create or replace function public.cc_set_rule_enabled(p_key text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $function$
begin if not public.has_global_permission('flags.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.automation_rules set enabled=coalesce(p_enabled,true) where key=p_key; if not found then raise exception 'rule not found' using errcode='22023'; end if;
  perform app_private.log_audit('automation.rule.toggle','automation_rule',p_key,null,case when p_enabled then 'enabled' else 'disabled' end,'{}'::jsonb);
  return coalesce(p_enabled,true); end; $function$;

revoke all on function public.cc_list_rules() from public, anon;
revoke all on function public.cc_set_rule_enabled(text,boolean) from public, anon;
grant execute on function public.cc_list_rules() to authenticated;
grant execute on function public.cc_set_rule_enabled(text,boolean) to authenticated;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values
  ('automations_admin_enabled',false,'Enable the Automations management view','all','staff'),
  ('notifications_center_enabled',false,'Enable the Notifications center','all','staff')
on conflict (key) do nothing;
