-- bl_disp_0410 — 23 Sep 2026. When the 3-business-day assignment window passes with no dispatcher, the carrier
-- must see a clear, designed reason — set by CC per carrier — instead of a bare "overdue".
-- Reason codes (fixed vocabulary, copy lives in the portal): authority_new · capacity · docs_pending · working · other.
-- No reason set → the portal shows the honest default ("we are working on it, some matches need more time").
-- Additive. APPLIED: staging + prod 23 Sep 2026.

create table if not exists app_private.disp_assign_delays (
  carrier_org_id uuid primary key references public.organizations(id) on delete cascade,
  reason_code text not null check (reason_code in ('authority_new','capacity','docs_pending','working','other')),
  note text,                        -- optional one-liner shown to the carrier under the reason
  eta_days int,                     -- optional: "we expect to match you within N business days"
  set_by uuid, set_at timestamptz not null default now(),
  cleared_at timestamptz
);

-- staff: set / update / clear the delay reason for a carrier
create or replace function public.cc_dispatcher_delay_set(p_carrier_org uuid, p_reason text, p_note text default null, p_eta_days int default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_reason is null or p_reason = 'clear' then
    update app_private.disp_assign_delays set cleared_at = now() where carrier_org_id = p_carrier_org;
    perform app_private.disp_audit('dispatcher.delay_cleared', 'carrier', p_carrier_org::text, p_carrier_org, 'assignment-delay reason cleared', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  insert into app_private.disp_assign_delays (carrier_org_id, reason_code, note, eta_days, set_by, set_at, cleared_at)
    values (p_carrier_org, p_reason, nullif(btrim(coalesce(p_note,'')),''), p_eta_days, auth.uid(), now(), null)
  on conflict (carrier_org_id) do update set reason_code = excluded.reason_code, note = excluded.note, eta_days = excluded.eta_days, set_by = excluded.set_by, set_at = now(), cleared_at = null;
  perform app_private.disp_audit('dispatcher.delay_set', 'carrier', p_carrier_org::text, p_carrier_org, 'assignment-delay reason: ' || p_reason, jsonb_build_object('note', p_note, 'eta_days', p_eta_days));
  return jsonb_build_object('ok', true, 'reason', p_reason);
end $$;
revoke all on function public.cc_dispatcher_delay_set(uuid, text, text, int) from public, anon;
grant execute on function public.cc_dispatcher_delay_set(uuid, text, text, int) to authenticated;

-- carrier desk: expose the reason inside sla (anchor patch on carrier_dispatcher_desk)
do $$
declare src text := pg_get_functiondef('public.carrier_dispatcher_desk()'::regprocedure);
begin
  if src like '%''delay'', (select jsonb_build_object%' then return; end if;
  if src not like '%''overdue'', v_assign_by is not null and v_a.id is null and now() > v_assign_by),%' then raise exception 'anchor missing in carrier_dispatcher_desk'; end if;
  src := replace(src, '''overdue'', v_assign_by is not null and v_a.id is null and now() > v_assign_by),',
    '''overdue'', v_assign_by is not null and v_a.id is null and now() > v_assign_by,
        ''delay'', (select jsonb_build_object(''reason'', x.reason_code, ''note'', x.note, ''eta_days'', x.eta_days, ''set_at'', x.set_at) from app_private.disp_assign_delays x where x.carrier_org_id = v_org and x.cleared_at is null)),');
  execute src;
end $$;
