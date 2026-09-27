-- bl_disp_0481 — Carrier choices: their own CC tab + an item on the Action Center home (27 Sep 2026)
--
--   Owner (27 Sep): a candidate's carrier choice should not live only on that one candidate's Dispatcher 360 page.
--   1. CC → Dispatchers & agents → "Carrier choices" (#/carrier-choices) lists every pending choice across all
--      candidates with Accept / Decline on the card (same flow as the 360 — UI in the same commit).
--      cc_dispatcher_choices gains carrier.mc / carrier.dot so the card can show the authority without a hop.
--   2. CC home (Action Center, cc_action_center): 'choices_pending' count + one 'choice' row per pending choice in
--      the "Needs you now" queue (priority high, related_type dispatcher_choice, related_id = the choice) — the UI
--      links each to #/carrier-choices?id=<choice>.
--   Both functions already exist with their ACL (authenticated only; staff-gated inside); create-or-replace keeps it,
--   the revoke lines below are belt-and-braces. Anon SECURITY DEFINER surface unchanged (36 prod / 35 staging).
begin;

-- ── 1. cc_dispatcher_choices — + carrier.mc / carrier.dot (body otherwise identical to bl_disp_0442 §8) ──
create or replace function public.cc_dispatcher_choices(p_status text default 'pending', p_user uuid default null) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'status', c.status, 'match_kind', c.match_kind, 'note', c.dispatcher_note,
        'created_at', c.created_at, 'decided_at', c.decided_at, 'decision_note', c.decision_note, 'assignment_id', c.assignment_id,
        'age_hours', round(extract(epoch from (now() - c.created_at))/3600, 1),
        'dispatcher_user_id', c.dispatcher_user_id,
        'dispatcher', (select jsonb_build_object('name', d.full_name, 'status', d.status, 'years_exp', d.years_exp, 'country', d.country, 'city', d.city,
              'commission_pct', d.commission_pct, 'trial_start', d.trial_start, 'trial_end', d.trial_end,
              'equipment', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(c.dispatcher_equipment) e),
              'load_boards', d.load_boards, 'hours', d.skills->>'availability_hours', 'timezone', d.skills->>'timezone',
              'score', (select a.staff_score || ' / ' || coalesce(a.max_score::text,'100') from app_private.skills_test_attempts a where a.user_id = c.dispatcher_user_id and a.decision = 'pass' order by a.reviewed_at desc nulls last limit 1))
            from app_private.dispatcher_profiles d where d.user_id = c.dispatcher_user_id),
        'carrier_org_id', c.carrier_org_id,
        'carrier', (select jsonb_build_object('name', o.name, 'mc', nullif(o.mc_number,''), 'dot', nullif(o.dot_number,''),
              'equipment', (select coalesce(array_agg(app_private.disp_equip_label(e) order by e), '{}'::text[]) from unnest(c.carrier_equipment) e),
              'trucks', (select count(*) from app_private.fleet_trucks t where t.carrier_id = o.id and coalesce(t.status,'active') not in ('inactive','retired')),
              'home_base', coalesce((select nullif(p.home_base,'') from app_private.carrier_dispatch_prefs p where p.carrier_id = o.id),
                                    (select nullif(concat_ws(', ', nullif(t.domicile_city,''), nullif(t.domicile_state,'')), '') from app_private.fleet_trucks t where t.carrier_id = o.id order by t.created_at limit 1)),
              'min_rpm', (select p.min_rpm from app_private.carrier_dispatch_prefs p where p.carrier_id = o.id),
              'still_available', app_private.disp_carrier_available(o.id, c.dispatcher_user_id),
              'competing', (select count(*) from app_private.dispatcher_carrier_choices x where x.carrier_org_id = o.id and x.status = 'pending' and x.id <> c.id))
            from public.organizations o where o.id = c.carrier_org_id)
      ) order by c.created_at desc)
      from app_private.dispatcher_carrier_choices c
     where (p_status is null or p_status = 'all' or c.status = p_status)
       and (p_user is null or c.dispatcher_user_id = p_user)
     limit 200), '[]'::jsonb) end
$$;
revoke all on function public.cc_dispatcher_choices(text, uuid) from public, anon;
grant execute on function public.cc_dispatcher_choices(text, uuid) to authenticated;

-- ── 2. cc_action_center — + choices_pending and 'choice' queue rows (body otherwise the live definition) ──
create or replace function public.cc_action_center() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'tasks_open',(select count(*) from app_private.automation_tasks where status='open'),
    'tasks_overdue',(select count(*) from app_private.automation_tasks where status='open' and sla_at is not null and sla_at<now()),
    'docs_pending',(select count(*) from public.documents where status='pending'),
    'exceptions_open',(select count(*) from app_private.trip_exceptions where status='open'),
    'settlements_pending',(select count(*) from app_private.fin_settlements where status in ('pending','approved')),
    'forms_new',(select count(*) from app_private.form_submissions where status='new'),
    'tickets_open',(select count(*) from app_private.support_tickets where status in ('open','pending')),
    'compliance_expiring',(select count(*) from app_private.carrier_compliance where status='valid' and expiry_date is not null and expiry_date between current_date and current_date+30),
    'choices_pending',(select count(*) from app_private.dispatcher_carrier_choices where status='pending'),   -- bl_disp_0481
    'queue',(select coalesce(jsonb_agg(q),'[]'::jsonb) from (select q from (
        select jsonb_build_object('kind','task','task_type',task_type,'title',title,'priority',coalesce(priority,'normal'),'when',coalesce(sla_at,due_at,created_at),'overdue',(sla_at is not null and sla_at<now()),'related_type',related_type,'related_id',related_id) q,
               case coalesce(priority,'normal') when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end ord, coalesce(sla_at,due_at,created_at) t
          from app_private.automation_tasks where status='open'
        union all
        select jsonb_build_object('kind','ticket','title',ref||' · '||subject,'priority',priority,'when',created_at,'overdue',false,'related_type','support_ticket','related_id',id::text),
               case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, created_at
          from app_private.support_tickets where status in ('open','pending')
        union all
        select jsonb_build_object('kind','form','title',coalesce(name,email,'Web enquiry'),'priority','high','when',created_at,'overdue',false,'related_type','form_submission','related_id',id::text),
               1, created_at
          from app_private.form_submissions where status='new'
        union all   -- bl_disp_0481: a candidate picked a carrier — accept (trial + SOP + assign) or decline
        select jsonb_build_object('kind','choice',
                 'title', coalesce(d.full_name,'A candidate') || ' chose ' || coalesce(o.name,'a carrier') || ' — accept or decline',
                 'priority','high','when',c.created_at,'overdue',(c.created_at < now() - interval '48 hours'),
                 'related_type','dispatcher_choice','related_id',c.id::text),
               1, c.created_at
          from app_private.dispatcher_carrier_choices c
          left join app_private.dispatcher_profiles d on d.user_id = c.dispatcher_user_id
          left join public.organizations o on o.id = c.carrier_org_id
         where c.status='pending'
      ) a order by ord, t desc limit 20) b)
  );
end $$;
revoke all on function public.cc_action_center() from public, anon;
grant execute on function public.cc_action_center() to authenticated;

commit;
