-- bl_disp_0409 — 23 Sep 2026. Two owner asks on the same day:
--  (1) Carrier Dispatcher tab: every blocker carries an EXACT deep link ('#fleet/add-truck', '#dashboard/availability' …)
--      and names the truck ("Unit 12 has no driver"), so the carrier lands on the field, not the page.
--  (2) Dispatcher workspace: the carrier's real preference set (app_private.carrier_dispatch_prefs — operating
--      preferences only, never cost/economics columns) + fuller driver details (licence, medical, app installed).
-- Additive. carrier_dispatcher_desk() is re-created in full (same body as 0408 + link/detail); dispatcher_workspace_feed()
-- is anchor-patched (two new keys). APPLIED: staging + prod 23 Sep 2026.

create or replace function public.carrier_dispatcher_desk()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare
  v_org uuid; v_uid uuid := auth.uid();
  v_ob record; v_a record; v_dp record;
  v_sla int := coalesce((select value::int from app_private.disp_desk_config where key = 'assign_sla_business_days'), 3);
  v_wa text := coalesce((select nullif(btrim(value),'') from app_private.disp_desk_config where key = 'whatsapp_number'), (select nullif(btrim(wa_number),'') from app_private.dialer_config order by updated_at desc nulls last limit 1));
  v_esc text := (select nullif(btrim(value),'') from app_private.disp_desk_config where key = 'escalation_email');
  v_released boolean := false;
  v_assign jsonb := null; v_contact jsonb := null; v_calls jsonb := null; v_perf jsonb := null; v_thread jsonb := null;
  v_ready jsonb; v_stage text; v_assign_by timestamptz;
  v_test record; v_line record; v_mail record;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  v_org := app_private.my_carrier_org();
  if v_org is null then return jsonb_build_object('error','no carrier organisation'); end if;
  select * into v_ob from app_private.carrier_onboarding where carrier_id = v_org order by submitted_at desc nulls last limit 1;
  v_stage := coalesce(v_ob.stage, 'not_started');
  if v_stage = 'approved' then v_assign_by := app_private.disp_add_business_days(coalesce(v_ob.decided_at, v_ob.submitted_at, now()), v_sla); end if;

  -- What the dispatcher needs from the carrier. Each row: done, exact deep link, and a detail naming the unit.
  v_ready := (
    with docs as (select type, status from public.documents where carrier_id = (select owner_user_id from public.organizations where id = v_org)),
         trucks as (select t.id, t.unit_no, t.equipment, t.home_time, av.updated_at av_at, av.driver_name av_driver, av.status av_status, av.empty_location
                    from app_private.fleet_trucks t left join app_private.truck_availability av on av.truck_id = t.id
                    where t.carrier_id = v_org and coalesce(t.status,'active') not in ('inactive','retired')),
         drv as (select count(*) n from app_private.fleet_drivers d where d.carrier_id = v_org and coalesce(d.status,'active') <> 'inactive'),
         pr as (select * from public.profiles where id = (select owner_user_id from public.organizations where id = v_org)),
         pf as (select * from app_private.carrier_dispatch_prefs where carrier_id = v_org),
         no_driver as (select string_agg('Unit ' || coalesce(unit_no,'?'), ', ' order by unit_no) s, count(*) n from trucks where coalesce(av_driver,'') = ''),
         stale as (select string_agg('Unit ' || coalesce(unit_no,'?'), ', ' order by unit_no) s, count(*) n from trucks where av_at is null or av_at <= now() - interval '24 hours')
    select jsonb_build_array(
      jsonb_build_object('key','trucks','label','Post at least one truck','done', exists (select 1 from trucks),'link','fleet/add-truck','why','Equipment, payload and dimensions decide which loads fit','blocker', true,
        'detail', case when exists (select 1 from trucks) then (select count(*)::text || ' truck(s) on file' from trucks) else 'No truck on file — your dispatcher has nothing to sell' end),
      jsonb_build_object('key','driver','label','Add a driver to every truck','done', exists (select 1 from trucks) and (select n from no_driver) = 0,'link', case when (select n from drv) = 0 then 'fleet/add-driver' else 'dashboard/availability' end,'why','Brokers call the driver for check-calls and pickup','blocker', true,
        'detail', case when not exists (select 1 from trucks) then 'Post a truck first' when (select n from drv) = 0 then 'No driver on file — add one, then set who is driving each truck' when (select n from no_driver) > 0 then (select s from no_driver) || ' — no driver set' else 'Every truck has a driver' end),
      jsonb_build_object('key','availability','label','Post today''s availability','done', exists (select 1 from trucks) and (select n from stale) = 0,'link','dashboard/availability','why','A dispatcher can only sell a truck they know is empty — where and when','blocker', true,
        'detail', case when not exists (select 1 from trucks) then 'Post a truck first' when (select n from stale) > 0 then (select s from stale) || ' — not updated in 24 h' else 'All trucks updated today' end),
      jsonb_build_object('key','authority','label','Operating authority (MC/DOT) on file','done', exists (select 1 from docs where type='authority' and status='approved'),'link','documents/authority','why','Brokers will not set you up without it','blocker', true,
        'detail', case when exists (select 1 from docs where type='authority' and status='approved') then 'Approved' when exists (select 1 from docs where type='authority' and status='pending') then 'Uploaded — LoadBoot is reviewing it' when exists (select 1 from docs where type='authority' and status='rejected') then 'Rejected — upload a corrected copy' else 'Not uploaded' end),
      jsonb_build_object('key','insurance','label','Certificate of insurance (COI)','done', exists (select 1 from docs where type='insurance' and status='approved'),'link','documents/insurance','why','Every broker packet asks for it; VINs on the COI decide which trucks can run','blocker', true,
        'detail', case when exists (select 1 from docs where type='insurance' and status='approved') then 'Approved' when exists (select 1 from docs where type='insurance' and status='pending') then 'Uploaded — LoadBoot is reviewing it' when exists (select 1 from docs where type='insurance' and status='rejected') then 'Rejected — upload a corrected copy' else 'Not uploaded' end),
      jsonb_build_object('key','w9','label','W-9','done', exists (select 1 from docs where type='w9' and status='approved'),'link','documents/w9','why','Needed for broker setup and payment','blocker', true,
        'detail', case when exists (select 1 from docs where type='w9' and status='approved') then 'Approved' when exists (select 1 from docs where type='w9' and status='pending') then 'Submitted — LoadBoot is reviewing it' else 'Not signed' end),
      jsonb_build_object('key','agreement','label','Dispatch agreement signed','done', exists (select 1 from app_private.dispatch_agreement_signatures g where g.carrier_id = v_org),'link','documents/agreement','why','Authorises your dispatcher to act as your agent','blocker', true,
        'detail', case when exists (select 1 from app_private.dispatch_agreement_signatures g where g.carrier_id = v_org) then 'Signed' else 'Not signed' end),
      jsonb_build_object('key','floor','label','Rate floor ($/mi or minimum total)','done', exists (select 1 from pf where coalesce(min_rpm,0) > 0 or coalesce(min_total_rate,0) > 0),'link','account/dispatch','why','Your dispatcher never books below this','blocker', false,
        'detail', (select case when coalesce(min_rpm,0) > 0 then '$' || min_rpm::text || '/mi' when coalesce(min_total_rate,0) > 0 then '$' || min_total_rate::text || ' minimum' else 'Not set — your dispatcher will ask before every load' end from pf)),
      jsonb_build_object('key','lanes','label','Home base + preferred lanes','done', exists (select 1 from pf where coalesce(home_base,'') <> '' or coalesce(array_length(preferred_lanes,1),0) > 0) or exists (select 1 from pr where coalesce(home_base,'') <> ''),'link','account/dispatch','why','Keeps the truck loaded toward home, not away from it','blocker', false,
        'detail', coalesce((select nullif(home_base,'') from pf), (select nullif(home_base,'') from pr), 'Not set')),
      jsonb_build_object('key','hometime','label','Home-time rule','done', exists (select 1 from pf where coalesce(home_time,'') <> '') or exists (select 1 from trucks where coalesce(home_time,'') <> ''),'link','account/dispatch','why','So the last load of the week ends where you live','blocker', false,
        'detail', coalesce((select nullif(home_time,'') from pf), (select nullif(home_time,'') from trucks where coalesce(home_time,'') <> '' limit 1), 'Not set')),
      jsonb_build_object('key','phone','label','Owner phone on your profile','done', exists (select 1 from pr where coalesce(phone,'') <> ''),'link','account/profile','why','Your dispatcher calls you before every booking','blocker', true,
        'detail', coalesce((select nullif(phone,'') from pr), 'Not set'))
    )
  );

  select a.* into v_a from app_private.dispatcher_assignments a where a.carrier_org_id = v_org and a.status in ('active','paused') order by a.assigned_at desc limit 1;
  if v_a.id is not null then
    select * into v_dp from app_private.dispatcher_profiles where user_id = v_a.dispatcher_user_id;
    select decision, staff_score, max_score, reviewed_at into v_test from app_private.skills_test_attempts where user_id = v_a.dispatcher_user_id and decision = 'pass' order by reviewed_at desc nulls last limit 1;
    v_released := v_a.contact_released_at is not null;
    v_assign := jsonb_build_object(
      'assignment_id', v_a.id, 'status', v_a.status, 'assigned_at', v_a.assigned_at, 'carrier_ack_at', v_a.carrier_ack_at,
      'sop', coalesce(v_a.sop,'{}'::jsonb) - 'disp_read_at',
      'contact_released', v_released, 'contact_released_at', v_a.contact_released_at,
      'dispatcher', jsonb_build_object(
        'name', v_dp.full_name, 'first_name', split_part(coalesce(v_dp.full_name,''),' ',1),
        'country', v_dp.country, 'city', v_dp.city,
        'years_exp', v_dp.years_exp, 'english_level', v_dp.english_level,
        'load_boards', coalesce(to_jsonb(v_dp.load_boards),'[]'::jsonb),
        'timezone', coalesce(v_dp.skills->>'timezone',''), 'us_hours', coalesce((v_dp.skills->>'us_hours_overlap')::boolean,false),
        'equipment', coalesce(v_dp.skills->'equipment', v_dp.skills->'equipment_types', '[]'::jsonb),
        'stage', v_dp.status, 'on_trial', v_dp.status = 'trial', 'trial_end', v_dp.trial_end,
        'id_verified', coalesce(v_dp.skills->>'id_doc','') <> '',
        'skills_test_passed', coalesce(v_test.decision = 'pass', false),
        'skills_test_pct', case when v_test.max_score > 0 then round(100.0 * v_test.staff_score / v_test.max_score) else null end,
        'with_loadboot_since', v_dp.created_at)
    );
    v_thread := jsonb_build_object('unread', (select count(*) from app_private.dispatcher_messages m where m.assignment_id = v_a.id and m.sender_role <> 'carrier'
        and m.created_at > coalesce((select r.read_at from app_private.dispatcher_thread_reads r where r.assignment_id = v_a.id and r.user_id = v_uid), v_a.assigned_at)),
      'last_at', (select max(created_at) from app_private.dispatcher_messages where assignment_id = v_a.id));
    if v_released then
      select phone_e164, label into v_line from app_private.dialer_lines where dispatcher_user_id = v_a.dispatcher_user_id and status = 'active' order by created_at limit 1;
      select address, display_name into v_mail from app_private.dmail_accounts where assigned_to = v_a.dispatcher_user_id and status = 'active' limit 1;
      v_contact := jsonb_build_object('phone', v_line.phone_e164, 'phone_label', coalesce(v_line.label, 'LoadBoot line'), 'email', v_mail.address, 'whatsapp', v_wa, 'escalation_email', v_esc,
        'note', 'Company line and mailbox — every call and message is logged with LoadBoot.');
      v_calls := (select jsonb_build_object(
        'count_30d', count(*) filter (where started_at > now() - interval '30 days'),
        'minutes_30d', coalesce(round(sum(duration_sec) filter (where started_at > now() - interval '30 days') / 60.0), 0),
        'answered_30d', count(*) filter (where started_at > now() - interval '30 days' and answered_at is not null),
        'recent', coalesce((select jsonb_agg(jsonb_build_object('at', c.started_at, 'direction', c.direction, 'who', coalesce(c.contact_name, c.counterparty, c.to_number),
                    'kind', c.contact_kind, 'duration_sec', c.duration_sec, 'status', c.status, 'outcome', c.outcome, 'answered', c.answered_at is not null) order by c.started_at desc)
                  from (select * from app_private.dialer_calls where carrier_org_id = v_org and dispatcher_user_id = v_a.dispatcher_user_id order by started_at desc limit 25) c), '[]'::jsonb))
        from app_private.dialer_calls where carrier_org_id = v_org and dispatcher_user_id = v_a.dispatcher_user_id);
      v_perf := (select jsonb_build_object(
        'loads_total', count(*) filter (where status <> 'cancelled'),
        'loads_delivered', count(*) filter (where status in ('delivered','invoiced','paid')),
        'gross_total', coalesce(sum(gross) filter (where status in ('delivered','invoiced','paid')), 0),
        'gross_month', coalesce(sum(gross) filter (where status <> 'cancelled' and created_at >= date_trunc('month', now())), 0),
        'avg_rpm', case when coalesce(sum(miles) filter (where status <> 'cancelled' and coalesce(miles,0) > 0),0) > 0
                        then round((sum(gross) filter (where status <> 'cancelled' and coalesce(miles,0) > 0) / sum(miles) filter (where status <> 'cancelled' and coalesce(miles,0) > 0))::numeric, 2) else null end,
        'last_booking_at', max(created_at),
        'reply_minutes_median', (select percentile_cont(0.5) within group (order by extract(epoch from (r.reply_at - m.created_at)) / 60)
              from app_private.dispatcher_messages m
              join lateral (select min(x.created_at) reply_at from app_private.dispatcher_messages x where x.assignment_id = m.assignment_id and x.sender_role = 'dispatcher' and x.created_at > m.created_at) r on true
              where m.assignment_id = v_a.id and m.sender_role = 'carrier' and r.reply_at is not null and m.created_at > now() - interval '30 days'))
        from app_private.dispatcher_bookings where carrier_org_id = v_org and dispatcher_user_id = v_a.dispatcher_user_id);
    end if;
  end if;
  return jsonb_build_object(
    'org_id', v_org,
    'onboarding', jsonb_build_object('stage', v_stage, 'submitted_at', v_ob.submitted_at, 'decided_at', v_ob.decided_at, 'note', case when v_stage in ('rejected','info_needed') then v_ob.decision_note end),
    'sla', jsonb_build_object('business_days', v_sla, 'assign_by', v_assign_by,
        'business_days_left', case when v_assign_by is null then null else app_private.disp_business_days_between(now(), v_assign_by) end,
        'overdue', v_assign_by is not null and v_a.id is null and now() > v_assign_by),
    'readiness', v_ready,
    'assignment', v_assign, 'contact', v_contact, 'calls', v_calls, 'performance', v_perf, 'thread', v_thread,
    'program', jsonb_build_object('fee_pct', 5, 'escalation_email', v_esc, 'whatsapp_configured', v_wa is not null, 'whatsapp', v_wa)
  );
end $$;
revoke all on function public.carrier_dispatcher_desk() from public, anon;
grant execute on function public.carrier_dispatcher_desk() to authenticated;

-- Dispatcher workspace feed: carrier preferences (operating prefs only — no cost/economics columns) + driver details.
do $$
declare src text := pg_get_functiondef('public.dispatcher_workspace_feed()'::regprocedure);
begin
  if src like '%''prefs'', (select jsonb_build_object(%' then return; end if;
  if src not like '%''drivers'', coalesce((select jsonb_agg(jsonb_build_object(''id'', d.id, ''name'', d.name, ''phone'', d.phone, ''status'', d.status) order by d.name)%' then raise exception 'anchor missing in dispatcher_workspace_feed'; end if;
  src := replace(src,
    '''drivers'', coalesce((select jsonb_agg(jsonb_build_object(''id'', d.id, ''name'', d.name, ''phone'', d.phone, ''status'', d.status) order by d.name)',
    '''prefs'', (select jsonb_build_object(''preferred_equipment'', pf.preferred_equipment, ''equipment_detail'', pf.equipment_detail, ''preferred_lanes'', pf.preferred_lanes, ''home_base'', pf.home_base,
            ''operating_radius_miles'', pf.operating_radius_miles, ''max_deadhead_miles'', pf.max_deadhead_miles, ''avoid_states'', pf.avoid_states, ''haul_types'', pf.haul_types, ''services'', pf.services,
            ''min_rpm'', pf.min_rpm, ''min_rpm_basis'', pf.min_rpm_basis, ''target_rpm'', pf.target_rpm, ''min_total_rate'', pf.min_total_rate,
            ''max_weight_lbs'', pf.max_weight_lbs, ''min_trip_miles'', pf.min_trip_miles, ''max_trip_miles'', pf.max_trip_miles, ''load_size'', pf.load_size,
            ''hazmat'', pf.hazmat, ''team_drivers'', pf.team_drivers, ''weekend_ok'', pf.weekend_ok, ''min_notice_hours'', pf.min_notice_hours, ''home_time'', pf.home_time, ''round_trip_pref'', pf.round_trip_pref,
            ''facility_likes'', pf.facility_likes, ''facility_dislikes'', pf.facility_dislikes, ''external_boards'', pf.external_boards, ''notes'', pf.notes, ''updated_at'', pf.updated_at)
          from app_private.carrier_dispatch_prefs pf where pf.carrier_id = a.carrier_org_id),
        ''drivers'', coalesce((select jsonb_agg(jsonb_build_object(''id'', d.id, ''name'', d.name, ''phone'', d.phone, ''email'', d.email, ''status'', d.status,
            ''license_state'', d.license_state, ''license_exp'', d.license_exp, ''medical_exp'', d.medical_exp, ''app_installed'', coalesce(d.installed_app,false), ''location_on'', coalesce(d.location_on,false), ''last_seen_at'', d.last_seen_at,
            ''driving'', (select string_agg(''Unit '' || coalesce(t2.unit_no,''?''), '', '') from app_private.truck_availability av2 join app_private.fleet_trucks t2 on t2.id = av2.truck_id where av2.carrier_id = a.carrier_org_id and av2.driver_name = d.name)) order by d.name)');
  execute src;
end $$;
