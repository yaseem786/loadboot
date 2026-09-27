-- bl_voice_0484 — Retell balance line in CC → Riley → Settings & wiring (owner decision §9, RILEY-CALL-PLANS-0483 "Next" 3).
--
-- Retell's API has no balance/credit endpoint (checked 27 Sep 2026: docs.retellai.com lists get-call / list-calls
-- `call_cost` and get-concurrency, nothing account-level; balance is dashboard-only). So the honest line is:
--   "Balance $X as of <date> (typed from the Retell dashboard by <staff>) · since then: N Riley calls, M min"
-- Minutes come from our own lc_calls.duration_sec — we do not guess dollars we cannot see.
--
-- cc_riley_settings_get / _set are replaced in place (CREATE OR REPLACE keeps their ACL: authenticated +
-- service_role only, not anon). No new public function → anon SECDEF surface unchanged.
--
-- STAGING FIRST, then prod. Idempotent.

begin;

alter table app_private.retell_config
  add column if not exists balance_usd    numeric(10,2),
  add column if not exists balance_as_of  timestamptz,
  add column if not exists balance_set_by uuid;

comment on column app_private.retell_config.balance_usd    is 'Retell account balance as last typed from the Retell dashboard (Retell has no balance API). Set in CC → Riley → Settings.';
comment on column app_private.retell_config.balance_as_of  is 'When balance_usd was read on the Retell dashboard. Usage since this moment is counted from lc_calls.';
comment on column app_private.retell_config.balance_set_by is 'auth.uid() of the staff member who typed balance_usd.';

create or replace function public.cc_riley_settings_get()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'app_private', 'public'
as $function$
  select case when not (public.has_global_permission('comm.view') or public.has_global_permission('comm.manage')
                     or public.has_global_permission('support.view') or public.has_global_permission('dispatch.manage')
                     or public.has_global_permission('settings.manage'))
    then jsonb_build_object('error','not authorized')
    else (select jsonb_build_object(
      'riley_wa_enabled', d.riley_wa_enabled, 'riley_route_to_dispatcher', d.riley_route_to_dispatcher,
      'wa_number', d.wa_number, 'dialer_enabled', d.enabled,
      'record_calls', d.record_calls, 'fallback_number_set', nullif(d.fallback_number,'') is not null,
      'fallback_is_riley', nullif(d.fallback_number,'') is not null and d.fallback_number = r.from_number,
      'riley_number_set', nullif(r.from_number,'') is not null,
      'inbound_agent_id', r.inbound_agent_id, 'outbound_agent_id', r.outbound_agent_id,
      'escalation_number', r.escalation_number, 'retell_key_set', r.api_key is not null,
      'signing_key_set', r.webhook_signing_key is not null, 'allow_unsigned_webhook', r.allow_unsigned_webhook,
      'released_carriers', (select count(*) from app_private.dispatcher_assignments a where a.status = 'active' and a.contact_released_at is not null),
      'retell_balance_usd', r.balance_usd, 'retell_balance_as_of', r.balance_as_of,
      'retell_balance_set_by', (select coalesce(nullif(pr.contact_name,''), pr.email) from public.profiles pr where pr.id = r.balance_set_by),
      'retell_usage_since', case when r.balance_as_of is null then null else (
        select jsonb_build_object('calls', count(*), 'minutes', round(coalesce(sum(c.duration_sec),0) / 60.0, 1))
        from app_private.lc_calls c where c.call_id is not null and c.created_at >= r.balance_as_of) end,
      'can_manage', (public.has_global_permission('comm.manage') or public.has_global_permission('settings.manage')))
      from app_private.dialer_config d, app_private.retell_config r where d.id = 1 and r.id = 1) end;
$function$;

create or replace function public.cc_riley_settings_set(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private', 'public'
as $function$
declare v_esc text; v_bal numeric; v_at timestamptz;
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('settings.manage')) then
    return jsonb_build_object('error','not authorized');
  end if;
  if p ? 'riley_wa_enabled' then
    update app_private.dialer_config set riley_wa_enabled = coalesce((p->>'riley_wa_enabled')::boolean, false), updated_at = now(), updated_by = auth.uid() where id = 1;
  end if;
  if p ? 'riley_route_to_dispatcher' then
    update app_private.dialer_config set riley_route_to_dispatcher = coalesce((p->>'riley_route_to_dispatcher')::boolean, true), updated_at = now(), updated_by = auth.uid() where id = 1;
  end if;
  if p ? 'escalation_number' then
    v_esc := nullif(app_private.dial_e164(p->>'escalation_number'), '');
    if v_esc is not null and v_esc = (select from_number from app_private.retell_config where id = 1) then
      return jsonb_build_object('error','the escalation number cannot be the Riley line itself');
    end if;
    update app_private.retell_config set escalation_number = v_esc where id = 1;
  end if;
  if p ? 'inbound_agent_id' and (p->>'inbound_agent_id') ~ '^agent_[0-9a-f]{20,40}$' then
    update app_private.retell_config set inbound_agent_id = p->>'inbound_agent_id' where id = 1;
  end if;
  if p ? 'outbound_agent_id' and (p->>'outbound_agent_id') ~ '^agent_[0-9a-f]{20,40}$' then
    update app_private.retell_config set outbound_agent_id = p->>'outbound_agent_id' where id = 1;
  end if;
  -- bl_voice_0484: balance typed from the Retell dashboard. Empty string clears it.
  if p ? 'retell_balance_usd' then
    if nullif(trim(p->>'retell_balance_usd'),'') is null then
      update app_private.retell_config set balance_usd = null, balance_as_of = null, balance_set_by = auth.uid() where id = 1;
    else
      if trim(p->>'retell_balance_usd') !~ '^-?[0-9]{1,6}(\.[0-9]{1,2})?$' then
        return jsonb_build_object('error','balance must be a dollar amount like 27.40');
      end if;
      v_bal := trim(p->>'retell_balance_usd')::numeric;
      v_at := coalesce(nullif(p->>'retell_balance_as_of','')::timestamptz, now());
      if v_at > now() + interval '5 minutes' then
        return jsonb_build_object('error','the "as of" time cannot be in the future');
      end if;
      update app_private.retell_config set balance_usd = v_bal, balance_as_of = v_at, balance_set_by = auth.uid() where id = 1;
    end if;
  end if;
  return public.cc_riley_settings_get();
end $function$;

commit;
