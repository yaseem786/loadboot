-- bl_disp_0525 — "Hide from dispatchers" (unpublish) on Carrier 360.
-- Builds on bl_disp_0501 (hold). Three states per carrier for the dispatcher "Choose your carrier" list:
--   open   = no row in carrier_dispatch_holds  -> listed, choosable
--   hold   = row, mode 'hold'                  -> listed but locked ("Not available yet")   (unchanged 0501 behaviour)
--   hidden = row, mode 'hidden'                -> NOT listed at all, cannot be chosen
-- Additive: one column, one helper redefined (one extra NOT EXISTS), one new RPC. Existing assignments untouched;
-- staff can still assign directly. Old cc_carrier_dispatch_hold keeps working.

alter table app_private.carrier_dispatch_holds
  add column if not exists mode text not null default 'hold';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'carrier_dispatch_holds_mode_check') then
    alter table app_private.carrier_dispatch_holds
      add constraint carrier_dispatch_holds_mode_check check (mode in ('hold','hidden'));
  end if;
end $$;

-- a hidden carrier is not "available" to dispatchers (options list, choose, choice decide all use this helper)
create or replace function app_private.disp_carrier_available(p_org uuid, p_for uuid default null::uuid)
 returns boolean language sql stable security definer
 set search_path to 'app_private', 'public'
as $function$
  select exists (
    select 1 from public.organizations o
     where o.id = p_org and o.kind = 'carrier' and coalesce(o.status,'active') = 'active'
       and not coalesce(o.is_demo, false)
       and exists (select 1 from app_private.carrier_onboarding ob where ob.carrier_id = o.id and ob.stage = 'approved')
       and not exists (select 1 from app_private.dispatcher_assignments a where a.carrier_org_id = o.id and a.status in ('active','paused'))
       and not exists (select 1 from app_private.carrier_dispatch_holds h where h.carrier_org_id = o.id and h.mode = 'hidden'))
$function$;

-- staff: read (p_mode null) or set open | hold | hidden
create or replace function public.cc_carrier_dispatch_visibility(p_org uuid, p_mode text default null, p_reason text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private', 'public'
as $function$
declare r record; v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'carrier') then
    return jsonb_build_object('error','not a carrier');
  end if;
  if p_mode is not null and p_mode not in ('open','hold','hidden') then
    return jsonb_build_object('error','mode must be open, hold or hidden');
  end if;
  if p_mode in ('hold','hidden') then
    insert into app_private.carrier_dispatch_holds (carrier_org_id, reason, set_by, set_at, mode)
    values (p_org, v_reason, auth.uid(), now(), p_mode)
    on conflict (carrier_org_id) do update set reason = excluded.reason, set_by = excluded.set_by, set_at = now(), mode = excluded.mode;
    perform app_private.disp_audit('carrier.dispatch_' || p_mode, 'carrier', p_org::text, null,
      case p_mode when 'hidden' then 'hidden from dispatchers' else 'held from dispatchers' end || coalesce(' — ' || v_reason, ''), '{}'::jsonb);
  elsif p_mode = 'open' then
    delete from app_private.carrier_dispatch_holds where carrier_org_id = p_org;
    if found then
      perform app_private.disp_audit('carrier.dispatch_open', 'carrier', p_org::text, null, 'published for dispatchers', '{}'::jsonb);
    end if;
  end if;
  select * into r from app_private.carrier_dispatch_holds where carrier_org_id = p_org;
  return jsonb_build_object('ok', true,
    'mode', coalesce(r.mode, 'open'), 'held', r.carrier_org_id is not null, 'hidden', coalesce(r.mode = 'hidden', false),
    'reason', r.reason, 'set_at', r.set_at,
    'set_by_name', case when r.set_by is not null then app_private.cfs_name_of(r.set_by) end);
end $function$;

revoke all on function public.cc_carrier_dispatch_visibility(uuid, text, text) from public, anon;
grant execute on function public.cc_carrier_dispatch_visibility(uuid, text, text) to authenticated;
