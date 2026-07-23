-- bl_disp_0141 — Dispatcher assignment (carrier<->dispatcher + per-carrier SOP) and
-- salary terms + monthly salary run (base + per-active-truck + performance bonus).
-- All staff-gated SECURITY DEFINER RPCs. Additive & reversible.
-- Compliance: one active dedicated dispatcher per carrier (enforced by 0140 unique idx);
-- salary only exists once a carrier is assigned. Applied to STAGING first.

-- Assign a verified dispatcher to a carrier org with a per-carrier SOP.
create or replace function public.cc_dispatcher_assign(p_dispatcher uuid, p_carrier_org uuid, p_sop jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_id uuid; v_kind text; v_dstatus text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select kind into v_kind from public.organizations where id = p_carrier_org;
  if v_kind is null then return jsonb_build_object('error','carrier not found'); end if;
  select status into v_dstatus from app_private.dispatcher_profiles where user_id = p_dispatcher;
  if v_dstatus is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if v_dstatus not in ('verified','active') then
    return jsonb_build_object('error','dispatcher must be verified before assignment');
  end if;
  begin
    insert into app_private.dispatcher_assignments (dispatcher_user_id, carrier_org_id, sop, assigned_by)
    values (p_dispatcher, p_carrier_org, coalesce(p_sop,'{}'::jsonb), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('error','this carrier already has an active dispatcher');
  end;
  -- verified -> active once they hold a carrier
  update app_private.dispatcher_profiles set status = 'active', updated_at = now()
    where user_id = p_dispatcher and status = 'verified';
  -- notify the dispatcher
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('user','in_app','dispatcher.assigned',
      jsonb_build_object('user', p_dispatcher, 'title', '🚚 New carrier assigned',
        'body','You have been assigned a carrier. Open your console for the SOP and start dispatching.',
        'tone','success','url','/app/agent/#dispatch'),
      'sent', now());
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'assignment', v_id);
end $$;

-- Update the SOP for an assignment.
create or replace function public.cc_dispatcher_sop(p_assignment uuid, p_sop jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.dispatcher_assignments set sop = coalesce(p_sop,'{}'::jsonb), updated_at = now()
    where id = p_assignment;
  if not found then return jsonb_build_object('error','assignment not found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- End (or pause) an assignment. Reassigning a carrier elsewhere frees its slot.
create or replace function public.cc_dispatcher_unassign(p_assignment uuid, p_reason text default null, p_pause boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_disp uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.dispatcher_assignments
     set status = case when p_pause then 'paused' else 'ended' end,
         ended_at = case when p_pause then null else now() end,
         end_reason = p_reason, updated_at = now()
   where id = p_assignment
   returning dispatcher_user_id into v_disp;
  if v_disp is null then return jsonb_build_object('error','assignment not found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Set a dispatcher's salary terms (base + per-truck + currency).
create or replace function public.cc_dispatcher_salary_set(p_user uuid, p_base numeric, p_per_truck numeric, p_currency text default 'PKR')
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.dispatcher_profiles
     set base_salary = coalesce(p_base,0), per_truck = coalesce(p_per_truck,0),
         currency = coalesce(p_currency,'PKR'), updated_at = now()
   where user_id = p_user;
  if not found then return jsonb_build_object('error','not a dispatcher'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Compute / upsert a monthly salary row: total = base + per_truck*active_trucks + bonus.
-- active_trucks = trucks across the dispatcher's ACTIVE assignments.
create or replace function public.cc_dispatcher_salary_run(p_user uuid, p_period date, p_bonus numeric default 0, p_kpi jsonb default '{}'::jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_base numeric; v_per numeric; v_cur text; v_trucks int; v_pt numeric; v_total numeric; v_period date;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select base_salary, per_truck, currency into v_base, v_per, v_cur from app_private.dispatcher_profiles where user_id = p_user;
  if v_base is null then return jsonb_build_object('error','not a dispatcher'); end if;
  v_period := date_trunc('month', coalesce(p_period, now()))::date;
  select count(*) into v_trucks from app_private.dispatcher_assignments a
     join app_private.fleet_trucks t on t.carrier_id = a.carrier_org_id
   where a.dispatcher_user_id = p_user and a.status = 'active';
  v_pt := coalesce(v_per,0) * coalesce(v_trucks,0);
  v_total := coalesce(v_base,0) + v_pt + coalesce(p_bonus,0);
  insert into app_private.dispatcher_salary_ledger
    (dispatcher_user_id, period, currency, base, per_truck_rate, active_trucks, per_truck_total, performance_bonus, total, kpi, note)
  values (p_user, v_period, coalesce(v_cur,'PKR'), coalesce(v_base,0), coalesce(v_per,0), coalesce(v_trucks,0), v_pt, coalesce(p_bonus,0), v_total, coalesce(p_kpi,'{}'::jsonb), p_note)
  on conflict (dispatcher_user_id, period) do update set
    currency = excluded.currency, base = excluded.base, per_truck_rate = excluded.per_truck_rate,
    active_trucks = excluded.active_trucks, per_truck_total = excluded.per_truck_total,
    performance_bonus = excluded.performance_bonus, total = excluded.total,
    kpi = excluded.kpi, note = coalesce(excluded.note, app_private.dispatcher_salary_ledger.note)
  where app_private.dispatcher_salary_ledger.status = 'draft';
  return jsonb_build_object('ok', true, 'active_trucks', v_trucks, 'total', v_total, 'currency', coalesce(v_cur,'PKR'));
end $$;

-- Approve / mark a salary row paid.
create or replace function public.cc_dispatcher_salary_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_status not in ('draft','approved','paid') then return jsonb_build_object('error','bad status'); end if;
  update app_private.dispatcher_salary_ledger
     set status = p_status,
         approved_by = case when p_status <> 'draft' then auth.uid() else approved_by end,
         approved_at = case when p_status <> 'draft' then now() else approved_at end
   where id = p_id;
  if not found then return jsonb_build_object('error','not found'); end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

grant execute on function public.cc_dispatcher_assign(uuid, uuid, jsonb) to authenticated;
grant execute on function public.cc_dispatcher_sop(uuid, jsonb) to authenticated;
grant execute on function public.cc_dispatcher_unassign(uuid, text, boolean) to authenticated;
grant execute on function public.cc_dispatcher_salary_set(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.cc_dispatcher_salary_run(uuid, date, numeric, jsonb, text) to authenticated;
grant execute on function public.cc_dispatcher_salary_status(uuid, text) to authenticated;
