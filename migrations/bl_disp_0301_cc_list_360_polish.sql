-- bl_disp_0301 — CC dispatcher list + 360 polish (audit 2026-08-29, follows bl_disp_0300).
-- * cc_dispatchers_list: active trucks now exclude inactive/retired units; adds commission_pct, trial_end,
--   open_rc (RC waiting for approval) and unread (thread messages staff has not read) so the list can badge.
-- * cc_dispatcher_360: assignment rows carry carrier_ack_at, end_reason, active-truck count (not all trucks),
--   the carrier's contact + MC, and the terms log; 'salary' ledger dropped from the payload (pay is per load).
-- Additive: both functions keep their signatures. Staging first, then prod.
create or replace function public.cc_dispatchers_list()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized')
    else coalesce(jsonb_agg(jsonb_build_object(
      'user_id', d.user_id, 'name', d.full_name, 'email', (select email from auth.users u where u.id = d.user_id),
      'country', d.country, 'status', d.status, 'years_exp', d.years_exp,
      'applied_at', d.created_at, 'commission_pct', d.commission_pct, 'trial_start', d.trial_start, 'trial_end', d.trial_end,
      'active_trucks', (select count(*) from app_private.dispatcher_assignments a
                          join app_private.fleet_trucks t on t.carrier_id = a.carrier_org_id and coalesce(t.status,'active') not in ('inactive','retired')
                          where a.dispatcher_user_id = d.user_id and a.status = 'active'),
      'carriers', (select count(*) from app_private.dispatcher_assignments a
                     where a.dispatcher_user_id = d.user_id and a.status = 'active'),
      'open_rc', (select count(*) from app_private.dispatcher_bookings b where b.dispatcher_user_id = d.user_id and b.status = 'rc_received'),
      'moving', (select count(*) from app_private.dispatcher_bookings b where b.dispatcher_user_id = d.user_id and b.status in ('approved','dispatched','picked_up')),
      'unread', (select count(*) from app_private.dispatcher_messages m join app_private.dispatcher_assignments a on a.id = m.assignment_id
                   where a.dispatcher_user_id = d.user_id and a.status = 'active' and m.sender_role in ('dispatcher','carrier')
                     and m.created_at > coalesce((select r.read_at from app_private.dispatcher_thread_reads r where r.assignment_id = a.id and r.user_id = auth.uid()), a.assigned_at))
    ) order by d.created_at desc), '[]'::jsonb) end
  from app_private.dispatcher_profiles d;
$$;

create or replace function public.cc_dispatcher_360(p_user uuid)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized')
    else jsonb_build_object(
      'profile', (select to_jsonb(d) - 'base_salary' - 'per_truck' from app_private.dispatcher_profiles d where d.user_id = p_user),
      'email', (select email from auth.users u where u.id = p_user),
      'assignments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'carrier_org_id', a.carrier_org_id,
          'carrier', (select name from public.organizations o where o.id = a.carrier_org_id),
          'carrier_mc', (select p.mc from public.organizations o join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id),
          'carrier_contact', (select coalesce(nullif(p.contact_name,''), '') || coalesce(' · ' || p.phone, '') from public.organizations o join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id),
          'status', a.status, 'sop', coalesce(a.sop,'{}'::jsonb) - 'disp_read_at', 'assigned_at', a.assigned_at, 'ended_at', a.ended_at, 'end_reason', a.end_reason,
          'carrier_ack_at', a.carrier_ack_at,
          'trucks', (select count(*) from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id and coalesce(t.status,'active') not in ('inactive','retired')),
          'unread', (select count(*) from app_private.dispatcher_messages m where m.assignment_id = a.id and m.sender_role in ('dispatcher','carrier')
                       and m.created_at > coalesce((select r.read_at from app_private.dispatcher_thread_reads r where r.assignment_id = a.id and r.user_id = auth.uid()), a.assigned_at))
        ) order by a.assigned_at desc)
        from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user), '[]'::jsonb),
      'terms_log', coalesce((select jsonb_agg(jsonb_build_object('commission_pct', l.commission_pct, 'trial_start', l.trial_start, 'trial_end', l.trial_end, 'set_at', l.set_at, 'note', l.note) order by l.set_at desc)
        from app_private.dispatcher_terms_log l where l.dispatcher_user_id = p_user), '[]'::jsonb)
    ) end;
$$;
