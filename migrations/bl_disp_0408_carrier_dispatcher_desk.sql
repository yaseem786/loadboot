-- bl_disp_0408 — Carrier portal "Dispatcher" tab (dedicated-dispatcher desk).
-- 22 Sep 2026. Owner decisions: dispatcher assigned within 3 BUSINESS DAYS of carrier approval;
-- the carrier sees the dispatcher's LoadBoot line (Telnyx), @loadboot.com mailbox (dmail) and ONE
-- company WhatsApp number — never a personal number — and only after CC releases them
-- (contact_released_at). Call log + bookings + response time are released with the contacts.
-- Adds: dispatcher_assignments.contact_released_*; app_private.disp_desk_config;
--   public.carrier_dispatcher_desk()            (carrier members)
--   public.carrier_dispatcher_change_request()  (carrier members)
--   public.cc_dispatcher_contact_release()      (staff)
--   email 'dispatcher.contact.released' via the catalog (rule of 22 Sep 2026).
-- Additive + reversible. Only cc_dispatcher_360 is touched (anchor patch, two extra keys).
-- APPLIED: staging 22 Sep 2026 · PROD 22 Sep 2026 (anon secdef surface: prod 33 / staging 32, names unchanged).

alter table app_private.dispatcher_assignments
  add column if not exists contact_released_at timestamptz,
  add column if not exists contact_released_by uuid,
  add column if not exists contact_release_note text;

create table if not exists app_private.disp_desk_config (
  key text primary key,
  value text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
-- Values the owner must fill; NULL = unknown, the portal hides the row until it is set.
insert into app_private.disp_desk_config (key, value, note) values
  ('assign_sla_business_days', '3', 'Promise shown to carriers: dispatcher assigned within N business days of approval'),
  ('whatsapp_number', null, 'LoadBoot company WhatsApp (E.164, e.g. +1XXXXXXXXXX). NULL = not shown in the carrier portal'),
  ('escalation_email', 'dispatch@loadboot.com', 'Where a carrier escalates about their dispatcher')
on conflict (key) do nothing;

-- Mon–Fri business days added to a timestamp (no US holiday calendar — documented promise is business days).
create or replace function app_private.disp_add_business_days(p_from timestamptz, p_days int)
returns timestamptz language plpgsql immutable as $$
declare d date := (p_from at time zone 'America/New_York')::date; n int := 0;
begin
  while n < coalesce(p_days, 0) loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return (d::text || ' 17:00')::timestamp at time zone 'America/New_York';
end $$;

create or replace function app_private.disp_business_days_between(p_from timestamptz, p_to timestamptz)
returns int language plpgsql immutable as $$
declare a date := (p_from at time zone 'America/New_York')::date; b date := (p_to at time zone 'America/New_York')::date; n int := 0;
begin
  if b <= a then return 0; end if;
  while a < b loop a := a + 1; if extract(isodow from a) < 6 then n := n + 1; end if; end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The desk. One call, everything the tab needs. Contact + logs only when contact_released_at.
-- ---------------------------------------------------------------------------------------------
create or replace function public.carrier_dispatcher_desk()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare
  v_org uuid; v_uid uuid := auth.uid();
  v_ob record; v_a record; v_dp record;
  v_sla int := coalesce((select value::int from app_private.disp_desk_config where key = 'assign_sla_business_days'), 3);
  v_wa text := coalesce((select nullif(btrim(value),'') from app_private.disp_desk_config where key = 'whatsapp_number'), (select nullif(btrim(wa_number),'') from app_private.dialer_config where coalesce(wa_enabled,false) limit 1));   -- company WhatsApp = the live Telnyx WA number unless overridden
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

  -- What the dispatcher needs from the carrier (industry-standard carrier packet + operating profile).
  v_ready := (
    with docs as (select type, status from public.documents where carrier_id = (select owner_user_id from public.organizations where id = v_org))   -- documents.carrier_id = OWNER user id, not org id,
         trucks as (select t.*, av.updated_at av_at, av.driver_name av_driver from app_private.fleet_trucks t
                    left join app_private.truck_availability av on av.truck_id = t.id
                    where t.carrier_id = v_org and coalesce(t.status,'active') not in ('inactive','retired')),
         pr as (select * from public.profiles where id = (select owner_user_id from public.organizations where id = v_org)),
         pf as (select * from app_private.carrier_dispatch_prefs where carrier_id = v_org)
    select jsonb_build_array(
      jsonb_build_object('key','authority','label','Operating authority (MC/DOT) on file','done', exists (select 1 from docs where type='authority' and status='approved'),'tab','documents','why','Brokers will not set you up without it'),
      jsonb_build_object('key','insurance','label','Certificate of insurance (COI)','done', exists (select 1 from docs where type='insurance' and status='approved'),'tab','documents','why','Every broker packet asks for it; VINs on the COI decide which trucks can run'),
      jsonb_build_object('key','w9','label','W-9','done', exists (select 1 from docs where type='w9' and status='approved'),'tab','documents','why','Needed for broker setup and payment'),
      jsonb_build_object('key','agreement','label','Dispatch agreement signed','done', exists (select 1 from app_private.dispatch_agreement_signatures g where g.carrier_id = v_org),'tab','account','why','Authorises your dispatcher to act as your agent'),
      jsonb_build_object('key','trucks','label','At least one truck registered with specs','done', exists (select 1 from trucks),'tab','fleet','why','Equipment, payload and dimensions decide which loads fit'),
      jsonb_build_object('key','driver','label','Driver name + phone on each truck','done', exists (select 1 from trucks) and not exists (select 1 from trucks where coalesce(av_driver,'') = ''),'tab','fleet','why','Brokers call the driver for check-calls and pickup'),
      jsonb_build_object('key','availability','label','Truck availability updated in the last 24 h','done', exists (select 1 from trucks where av_at > now() - interval '24 hours'),'tab','fleet','why','A dispatcher can only sell a truck they know is empty — where and when'),
      jsonb_build_object('key','floor','label','Rate floor ($/mi or minimum total)','done', exists (select 1 from pf where coalesce(min_rpm,0) > 0 or coalesce(min_total_rate,0) > 0),'tab','account','why','Your dispatcher never books below this'),
      jsonb_build_object('key','lanes','label','Home base + preferred lanes','done', exists (select 1 from pf where coalesce(home_base,'') <> '' or coalesce(jsonb_array_length(to_jsonb(preferred_lanes)),0) > 0) or exists (select 1 from pr where coalesce(home_base,'') <> ''),'tab','account','why','Keeps the truck loaded toward home, not away from it'),
      jsonb_build_object('key','hometime','label','Home-time rule','done', exists (select 1 from pf where coalesce(home_time,'') <> '') or exists (select 1 from trucks where coalesce(home_time,'') <> ''),'tab','account','why','So the last load of the week ends where you live'),
      jsonb_build_object('key','phone','label','Owner phone on your profile','done', exists (select 1 from pr where coalesce(phone,'') <> ''),'tab','account','why','Your dispatcher calls you before every booking')
    )
  );

  -- Active / paused assignment (dedicated dispatcher)
  select a.* into v_a from app_private.dispatcher_assignments a
   where a.carrier_org_id = v_org and a.status in ('active','paused') order by a.assigned_at desc limit 1;

  if v_a.id is not null then
    select * into v_dp from app_private.dispatcher_profiles where user_id = v_a.dispatcher_user_id;
    select decision, staff_score, max_score, reviewed_at into v_test from app_private.skills_test_attempts
      where user_id = v_a.dispatcher_user_id and decision = 'pass' order by reviewed_at desc nulls last limit 1;
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
    -- unread messages for me in the shared thread
    v_thread := jsonb_build_object('unread', (select count(*) from app_private.dispatcher_messages m where m.assignment_id = v_a.id and m.sender_role <> 'carrier'
        and m.created_at > coalesce((select r.read_at from app_private.dispatcher_thread_reads r where r.assignment_id = v_a.id and r.user_id = v_uid), v_a.assigned_at)),
      'last_at', (select max(created_at) from app_private.dispatcher_messages where assignment_id = v_a.id));

    if v_released then
      select phone_e164, label into v_line from app_private.dialer_lines where dispatcher_user_id = v_a.dispatcher_user_id and status = 'active' order by created_at limit 1;
      select address, display_name into v_mail from app_private.dmail_accounts where assigned_to = v_a.dispatcher_user_id and status = 'active' limit 1;
      v_contact := jsonb_build_object(
        'phone', v_line.phone_e164, 'phone_label', coalesce(v_line.label, 'LoadBoot line'),
        'email', v_mail.address, 'whatsapp', v_wa, 'escalation_email', v_esc,
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

-- Carrier asks for a different dispatcher (owner decision 20 Sep: no confirm step, only remove / ask for a change).
create or replace function public.carrier_dispatcher_change_request(p_reason text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid := app_private.my_carrier_org(); v_a record; v_reason text := nullif(btrim(coalesce(p_reason,'')),''); v_cname text;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','not authorized'); end if;
  if v_reason is null then return jsonb_build_object('error','Tell us briefly why — one line is enough.'); end if;
  select * into v_a from app_private.dispatcher_assignments where carrier_org_id = v_org and status in ('active','paused') order by assigned_at desc limit 1;
  if v_a.id is null then return jsonb_build_object('error','no dispatcher assigned'); end if;
  if exists (select 1 from app_private.audit_logs l where l.action = 'dispatcher.change_requested' and l.target_id = v_a.id::text and l.occurred_at > now() - interval '24 hours')
    then return jsonb_build_object('error','You already asked today — LoadBoot dispatch is on it.'); end if;
  select name into v_cname from public.organizations where id = v_org;
  insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_user, sender_role, body)
    values (v_a.id, v_org, auth.uid(), 'carrier', '⚠ Change request to LoadBoot: ' || left(v_reason, 600));
  insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'dispatcher.change_requested',
      jsonb_build_object('title', coalesce(v_cname,'A carrier') || ' asked for a different dispatcher', 'body', left(v_reason, 200), 'url', '/app/command-center/#/dispatchers', 'tone', 'action', 'assignment_id', v_a.id),
      'sent', now());
  perform app_private.disp_audit('dispatcher.change_requested', 'assignment', v_a.id::text, v_org, left(v_reason, 200), jsonb_build_object('by', auth.uid()));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.carrier_dispatcher_change_request(text) from public, anon;
grant execute on function public.carrier_dispatcher_change_request(text) to authenticated;

-- E-mail (catalog rule of 22 Sep 2026): the carrier is told the contact details are live.
-- cc_email_template_new() needs a staff session, so a code-fired email gets its rows here directly (same shape).
insert into app_private.comm_templates(key,name,channel,subject,body,active,category,status)
values ('dispatcher.contact.released', 'Dispatcher contact details released', 'email',
  'Your dispatcher''s direct line is live — {{dispatcher_name}} for {{carrier_name}}',
  '<p>Hi {{carrier_name}},</p><p>LoadBoot compliance has released the direct contact details for your dedicated dispatcher, <b>{{dispatcher_name}}</b>.</p>'
  '<p>Open the <b>Dispatcher</b> tab in your carrier portal to see the LoadBoot line, e-mail and WhatsApp, plus the call log and every load booked under your MC.</p>'
  '<p><a href="https://loadboot.com/app/carrier/#dispatcher">Open my Dispatcher tab</a></p>'
  '<p>Every call and message on those channels is logged with LoadBoot. Nothing changes on your fee — the flat 5% covers your dispatcher.</p><p>— LoadBoot Dispatch</p>',
  true, 'transactional', 'published')
on conflict (key) do update set name=excluded.name, subject=excluded.subject, body=excluded.body, active=true, status='published';
insert into app_private.email_catalog(key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,stop_condition,preference_group,unsub_allowed,status,cc_deep_link,discovered_in)
values ('dispatcher.contact.released', 'Dispatcher contact details released',
  'Tells the carrier owner that CC has released their dedicated dispatcher''s LoadBoot line, mailbox and WhatsApp into the Dispatcher tab',
  'T', 'carrier', 'event', 'public.cc_dispatcher_contact_release', 'per assignment', 'once per assignment (idempotency dispatcher.contact:<assignment>)',
  'never re-sent; a withdraw + re-release does not e-mail again', 'account_critical', false, 'live', '#/dispatchers', array['code'])
on conflict (key) do nothing;

-- Staff: release (or withdraw) the contact details; notifies the carrier in-app + e-mail once.
create or replace function public.cc_dispatcher_contact_release(p_assignment uuid, p_release boolean default true, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare a record; v_owner uuid; v_email text; v_cname text; v_dname text; v_first boolean;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return jsonb_build_object('error','assignment not found'); end if;
  if not p_release then
    update app_private.dispatcher_assignments set contact_released_at = null, contact_released_by = null, contact_release_note = p_note, updated_at = now() where id = p_assignment;
    perform app_private.disp_audit('dispatcher.contact_withdrawn', 'assignment', p_assignment::text, a.carrier_org_id, coalesce(p_note,'contact details hidden again'), '{}'::jsonb);
    return jsonb_build_object('ok', true, 'released', false);
  end if;
  v_first := a.contact_released_at is null;
  update app_private.dispatcher_assignments set contact_released_at = coalesce(contact_released_at, now()), contact_released_by = coalesce(contact_released_by, auth.uid()), contact_release_note = coalesce(p_note, contact_release_note), updated_at = now() where id = p_assignment;
  select owner_user_id, name into v_owner, v_cname from public.organizations where id = a.carrier_org_id;
  select full_name into v_dname from app_private.dispatcher_profiles where user_id = a.dispatcher_user_id;
  if v_first then
    insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
      values ('carrier', v_owner, 'in_app', 'dispatcher.contact_released',
        jsonb_build_object('title', 'Your dispatcher''s direct line is live', 'body', coalesce(v_dname,'Your dispatcher') || ' — call, e-mail and WhatsApp are now in your Dispatcher tab.', 'url', '/app/carrier/#dispatcher', 'tone', 'action', 'assignment_id', a.id),
        'sent', now());
    select email into v_email from auth.users where id = v_owner;
    if v_email is not null then
      perform app_private.sys_email(v_email, 'dispatcher.contact.released',
        'Your dispatcher''s direct line is live — ' || coalesce(v_dname,'your dispatcher') || ' for ' || coalesce(v_cname,'your trucks'),
        replace(replace((select coalesce((select nullif(html_override,'') from app_private.email_catalog where key = 'dispatcher.contact.released'), (select body from app_private.comm_templates where key = 'dispatcher.contact.released' limit 1), '')), '{{dispatcher_name}}', coalesce(v_dname,'your dispatcher')), '{{carrier_name}}', coalesce(v_cname,'there')),
        null, 'dispatcher.contact:' || p_assignment::text);
    end if;
  end if;
  perform app_private.disp_audit('dispatcher.contact_released', 'assignment', p_assignment::text, a.carrier_org_id, coalesce(p_note,'contact details released to carrier'), jsonb_build_object('first', v_first));
  return jsonb_build_object('ok', true, 'released', true, 'first', v_first);
end $$;
revoke all on function public.cc_dispatcher_contact_release(uuid, boolean, text) from public, anon;
grant execute on function public.cc_dispatcher_contact_release(uuid, boolean, text) to authenticated;

-- CC Dispatcher 360 shows the release state (anchor patch, same style as bl_disp_0302).
do $$
declare src text := pg_get_functiondef('public.cc_dispatcher_360(uuid)'::regprocedure);
begin
  if src not like '%''contact_released_at'', a.contact_released_at%' then
    if src not like '%''carrier_ack_at'', a.carrier_ack_at,%' then raise exception 'anchor missing in cc_dispatcher_360'; end if;
    src := replace(src, '''carrier_ack_at'', a.carrier_ack_at,', '''carrier_ack_at'', a.carrier_ack_at, ''carrier_notified_at'', a.carrier_notified_at, ''contact_released_at'', a.contact_released_at,');
    execute src;
  end if;
end $$;
