-- bl_disp_0442 rollback-txn test — "Choose your carrier". Run AFTER the migration on STAGING; ends in
-- ROLLBACK-OK (the final raise rolls every fixture, notification and queued e-mail back).
-- Fixture: the one staging dispatcher is reset to skills_test with a released PASS, its live assignment
-- is ended, and a second carrier is approved so the options list has two entries. Every RPC is called
-- under a real JWT (dispatcher, then staff) exactly as PostgREST would.
do $t$
declare v_disp uuid := (select user_id from app_private.dispatcher_profiles order by created_at limit 1);
        v_staff uuid := (select s.user_id from app_private.staff_members s join auth.users u on u.id = s.user_id where u.email = 'owner@lb.test' and s.status = 'active' limit 1);
        v_c1 uuid; v_c2 uuid; r jsonb; o jsonb; v_choice uuid; n int; v_first text; v_asg uuid;
begin
  if v_disp is null or v_staff is null then raise exception 'fixture: need one dispatcher and owner@lb.test staff'; end if;
  -- two approved, unassigned, non-demo carriers: the two that own trucks on staging
  select carrier_id into v_c1 from app_private.fleet_trucks where carrier_id = 'cc000000-0000-0000-0000-000000000001' limit 1;
  select carrier_id into v_c2 from app_private.fleet_trucks where carrier_id <> v_c1 order by created_at limit 1;
  update app_private.dispatcher_assignments set status = 'ended', ended_at = now(), end_reason = 'test 0442' where status <> 'ended';
  update app_private.dispatcher_carrier_choices set status = 'withdrawn' where status = 'pending';
  insert into app_private.carrier_onboarding(carrier_id, stage, decided_at) values (v_c1, 'approved', now() - interval '20 days')
    on conflict (carrier_id) do update set stage = 'approved', decided_at = coalesce(app_private.carrier_onboarding.decided_at, excluded.decided_at);
  insert into app_private.carrier_onboarding(carrier_id, stage, decided_at) values (v_c2, 'approved', now() - interval '3 days')
    on conflict (carrier_id) do update set stage = 'approved', decided_at = coalesce(app_private.carrier_onboarding.decided_at, excluded.decided_at);
  update public.organizations set status = 'active', is_demo = false where id in (v_c1, v_c2);
  -- the candidate knows Reefer only; carrier 1 runs Dry Van + Reefer (partial), carrier 2 runs Reefer (exact)
  update app_private.fleet_trucks set equipment = 'Reefer', status = 'active' where carrier_id = v_c2;
  update app_private.fleet_trucks set equipment = case when unit_no = (select min(unit_no) from app_private.fleet_trucks where carrier_id = v_c1) then 'Dry Van' else 'Reefer' end, status = 'active' where carrier_id = v_c1;
  update app_private.dispatcher_profiles set status = 'skills_test', skills = coalesce(skills,'{}'::jsonb) || '{"equipment":["Reefer"]}'::jsonb, commission_pct = 0, trial_start = null, trial_end = null, conduct_terms_accepted_at = null, conduct_terms_version = null, blocked_at = null where user_id = v_disp;
  delete from app_private.skills_test_attempts where user_id = v_disp;
  insert into app_private.skills_test_attempts(user_id, attempt_no, status, minutes, invited_at, start_by, started_at, ends_at, submitted_at, decision, staff_score, max_score, reviewed_at, passed_email_at)
    values (v_disp, 1, 'scored', 45, now() - interval '1 day', now() + interval '1 day', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours', 'pass', 81, 100, now() - interval '1 hour', now() - interval '1 hour');
  if not app_private.disp_carrier_available(v_c1) or not app_private.disp_carrier_available(v_c2) then raise exception 'fixture: carriers not available'; end if;

  -- c1 the candidate sees both carriers, exact match first, no private fields
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_disp)::text, true);
  o := public.dispatcher_carrier_options();
  if not (o->>'eligible')::boolean or not (o->>'can_choose')::boolean then raise exception 'c1 eligible %', o; end if;
  if jsonb_array_length(o->'carriers') <> 2 then raise exception 'c1 carriers % (want 2)', jsonb_array_length(o->'carriers'); end if;
  if (o->'carriers'->0->>'match_kind') <> 'exact' or (o->'carriers'->0->'org'->>'id')::uuid <> v_c2 then raise exception 'c1 order %', o->'carriers'->0->>'match_kind'; end if;
  if (o->'carriers'->1->>'match_kind') <> 'partial' then raise exception 'c1 partial %', o->'carriers'->1->>'match_kind'; end if;
  if (o->>'exact_count')::int <> 1 then raise exception 'c1 exact_count %', o->>'exact_count'; end if;
  if (o->'carriers'->0->'authority') ? 'mc' or (o->'carriers'->0->'authority') ? 'dot' or (o->'carriers'->0->'ops') ? 'factoring_status' then raise exception 'c1 leaked docket/factoring'; end if;
  if (o->'carriers'->0->'fleet'->>'count')::int < 1 or not ((o->'carriers'->0->'fleet'->'trucks'->0) ? 'equipment') then raise exception 'c1 truck spec missing %', o->'carriers'->0->'fleet'; end if;
  if jsonb_typeof(o->'carriers'->0->'gaps') <> 'array' or jsonb_typeof(o->'carriers'->0->'timeline') <> 'array' then raise exception 'c1 gaps/timeline'; end if;
  -- identity rule (25 Sep 2026): no company name before acceptance — only the anonymous label; authority age still shown
  if (o->'carriers'->0->'org'->>'name') is not null or (o->'carriers'->0->'org'->>'label') not like 'Carrier %' then raise exception 'c1 leaked carrier name %', o->'carriers'->0->'org'; end if;
  if (o->'carriers'->0->'fleet'->'trucks'->0->'availability') ? 'driver_name' then raise exception 'c1 leaked driver name'; end if;
  if (o->'conduct_terms'->>'version') is null or (o->'conduct_terms'->>'accepted_at') is not null then raise exception 'c1 conduct terms %', o->'conduct_terms'; end if;

  -- c1b choosing before the contact rules are accepted is refused; accepting stamps the profile
  r := public.dispatcher_choose_carrier(v_c2, 'too early');
  if (r->>'code') is distinct from 'terms_required' then raise exception 'c1b terms gate %', r; end if;
  r := public.dispatcher_accept_conduct_terms();
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'c1b accept %', r; end if;
  if (select conduct_terms_version from app_private.dispatcher_profiles where user_id = v_disp) <> (o->'conduct_terms'->>'version') then raise exception 'c1b version not stamped'; end if;

  -- c2 choose → pending row, staff card + staff e-mail, receipt card + receipt e-mail
  r := public.dispatcher_choose_carrier(v_c2, 'I ran reefers out of Laredo for two years.');
  if not coalesce((r->>'ok')::boolean,false) or (r->>'match_kind') <> 'exact' then raise exception 'c2 %', r; end if;
  v_choice := (r->>'id')::uuid;
  select count(*) into n from app_private.notifications where template_key = 'dispatcher.carrier.chosen' and recipient_role = 'staff' and created_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'c2 staff card % (want 1)', n; end if;
  select count(*) into n from app_private.notifications where template_key = 'dispatcher.carrier.chosen.receipt' and (payload->>'user')::uuid = v_disp and created_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'c2 receipt card % (want 1)', n; end if;
  select count(*) into n from app_private.message_deliveries where template_key = 'dispatcher.carrier.chosen' and idempotency_key = 'disp.choice.staff:' || v_choice::text;
  if n <> 1 then raise exception 'c2 staff e-mail % (want 1)', n; end if;
  select count(*) into n from app_private.message_deliveries where template_key = 'dispatcher.carrier.chosen.receipt' and idempotency_key = 'disp.choice.receipt:' || v_choice::text;
  if n <> 1 then raise exception 'c2 receipt e-mail % (want 1)', n; end if;
  -- the Riley line may only ever reach an e-mail through the contact switch ({{contact_inline}}), never from the template itself
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private')
               and p.proname in ('dispatcher_choose_carrier','cc_dispatcher_choice_decide','disp_test_pass_email','disp_carrier_book','dispatcher_withdraw_choice')
               and (pg_get_functiondef(p.oid) like '%253-7575%' or pg_get_functiondef(p.oid) like '%2537575%')) then raise exception 'c2 riley number hard-coded'; end if;
  if exists (select 1 from app_private.message_deliveries where idempotency_key like 'disp.choice.%:' || v_choice::text and meta->>'body_html' like '%{{contact_inline}}%') then raise exception 'c2 contact token not expanded'; end if;
  -- the candidate's receipt never carries the carrier's real name; the staff notice does
  if exists (select 1 from app_private.message_deliveries m join public.organizations o on o.id = v_c2 where m.idempotency_key = 'disp.choice.receipt:' || v_choice::text and m.meta->>'body_html' ilike '%' || o.name || '%') then raise exception 'c2 receipt leaked carrier name'; end if;
  if not exists (select 1 from app_private.message_deliveries m join public.organizations o on o.id = v_c2 where m.idempotency_key = 'disp.choice.staff:' || v_choice::text and m.meta->>'body_html' ilike '%' || o.name || '%') then raise exception 'c2 staff notice missing carrier name'; end if;

  -- c3 pending state: nothing else to choose, the carrier is held, a second choice is refused
  o := public.dispatcher_carrier_options();
  if (o->>'can_choose')::boolean or o->'pending' is null or (o->'pending'->>'id')::uuid <> v_choice or jsonb_array_length(o->'carriers') <> 0 then raise exception 'c3 %', o - 'carriers'; end if;
  if (o->'pending'->'book'->'org'->>'id')::uuid <> v_c2 then raise exception 'c3 pending book'; end if;
  r := public.dispatcher_choose_carrier(v_c1, null);
  if r->>'error' is null then raise exception 'c3 second choice accepted %', r; end if;
  if app_private.disp_carrier_available(v_c2) then raise exception 'c3 carrier not held'; end if;
  if not app_private.disp_carrier_available(v_c2, v_disp) then raise exception 'c3 own hold must count as available'; end if;

  -- c4 withdraw → released, choose again
  r := public.dispatcher_withdraw_choice();
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'c4 %', r; end if;
  if (select status from app_private.dispatcher_carrier_choices where id = v_choice) <> 'withdrawn' then raise exception 'c4 status'; end if;
  if not app_private.disp_carrier_available(v_c2) then raise exception 'c4 not released'; end if;
  r := public.dispatcher_choose_carrier(v_c1, null);
  if not coalesce((r->>'ok')::boolean,false) or (r->>'match_kind') <> 'partial' then raise exception 'c4 rechoose %', r; end if;
  v_choice := (r->>'id')::uuid;

  -- c5 staff: the queue shows it; decline → candidate told, carrier free, candidate can choose again
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_staff)::text, true);
  if not app_private.disp_is_staff() then raise exception 'fixture: owner@lb.test is not dispatch staff'; end if;
  o := public.cc_dispatcher_choices('pending', null);
  if jsonb_array_length(o) <> 1 or (o->0->>'id')::uuid <> v_choice or (o->0->'carrier'->>'still_available')::boolean is distinct from true then raise exception 'c5 queue %', o; end if;
  r := public.cc_dispatcher_choice_decide(v_choice, 'decline', 'That carrier needs a dry-van dispatcher first.', null);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'c5 decline %', r; end if;
  select count(*) into n from app_private.notifications where template_key = 'dispatcher.carrier.declined' and (payload->>'user')::uuid = v_disp;
  if n <> 1 then raise exception 'c5 declined card %', n; end if;
  select count(*) into n from app_private.message_deliveries where idempotency_key = 'disp.choice.declined:' || v_choice::text;
  if n <> 1 then raise exception 'c5 declined e-mail %', n; end if;
  if not app_private.disp_carrier_available(v_c1) then raise exception 'c5 not released'; end if;
  r := public.cc_dispatcher_choice_decide(v_choice, 'decline', null, null);
  if r->>'error' is null then raise exception 'c5 double decide %', r; end if;

  -- c6 candidate chooses again (history shows the declined one), staff accepts → trial + assignment in one step
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_disp)::text, true);
  o := public.dispatcher_carrier_options();
  if not (o->>'can_choose')::boolean or jsonb_array_length(o->'history') < 2 then raise exception 'c6 options %', o - 'carriers'; end if;
  r := public.dispatcher_choose_carrier(v_c2, 'second pick');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'c6 choose %', r; end if;
  v_choice := (r->>'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_staff)::text, true);
  r := public.cc_dispatcher_set_terms(v_disp, 2.5, current_date, app_private.add_working_days(current_date, 10));
  if r->>'error' is not null then raise exception 'c6 terms %', r; end if;
  r := public.cc_dispatcher_choice_decide(v_choice, 'accept', 'Welcome aboard.', '{"scope_type":"equipment","scope_value":"Reefer only","min_rate":2.25,"lanes":"TX ↔ Southeast"}'::jsonb);
  if not coalesce((r->>'ok')::boolean,false) or not (r->>'trial_started')::boolean or r->>'assignment' is null then raise exception 'c6 accept %', r; end if;
  v_asg := (r->>'assignment')::uuid;
  if (select status from app_private.dispatcher_profiles where user_id = v_disp) <> 'trial' then raise exception 'c6 status not trial'; end if;
  if (select status from app_private.dispatcher_assignments where id = v_asg) <> 'active' or (select carrier_org_id from app_private.dispatcher_assignments where id = v_asg) <> v_c2 then raise exception 'c6 assignment'; end if;
  if (select status from app_private.dispatcher_carrier_choices where id = v_choice) <> 'accepted' or (select assignment_id from app_private.dispatcher_carrier_choices where id = v_choice) <> v_asg then raise exception 'c6 choice not accepted'; end if;
  if (select sop->>'scope_value' from app_private.dispatcher_assignments where id = v_asg) <> 'Reefer only' then raise exception 'c6 sop'; end if;
  -- the existing trial + brief + carrier intro e-mails fired through the existing functions
  select count(*) into n from app_private.message_deliveries where template_key in ('dispatcher.trial.welcome','dispatcher.assigned.brief','dispatcher.assigned.carrier') and scheduled_at > now() - interval '1 minute';
  if n < 2 then raise exception 'c6 downstream e-mails % (want >= 2: trial + brief; carrier intro needs an owner e-mail)', n; end if;
  -- bl_disp_0443: the trial e-mail carries the contact rule
  if not exists (select 1 from app_private.message_deliveries where template_key = 'dispatcher.trial.welcome' and scheduled_at > now() - interval '1 minute' and meta->>'body_html' like '%Contact rule%permanent block%') then raise exception 'c6 trial e-mail lacks the contact rule'; end if;
  if not app_private.disp_carrier_available(v_c1) then raise exception 'c6 other carrier must stay open'; end if;

  -- c7 assigned now → not eligible; a screening candidate → not eligible
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_disp)::text, true);
  o := public.dispatcher_carrier_options();
  if (o->>'eligible')::boolean or (o->>'reason') <> 'assigned' then raise exception 'c7 assigned %', o - 'carriers' - 'history'; end if;
  r := public.dispatcher_choose_carrier(v_c1, null);
  if r->>'error' is null then raise exception 'c7 choose while assigned %', r; end if;
  update app_private.dispatcher_assignments set status = 'ended', ended_at = now() where id = v_asg;
  update app_private.dispatcher_profiles set status = 'screening' where user_id = v_disp;
  o := public.dispatcher_carrier_options();
  if (o->>'eligible')::boolean or (o->>'reason') <> 'not_passed' then raise exception 'c7 screening %', o - 'carriers' - 'history'; end if;

  -- c8 anon can execute none of the five
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if has_function_privilege('anon', 'public.dispatcher_carrier_options()', 'execute') or has_function_privilege('anon', 'public.dispatcher_choose_carrier(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.dispatcher_withdraw_choice()', 'execute') or has_function_privilege('anon', 'public.cc_dispatcher_choices(text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.cc_dispatcher_choice_decide(uuid,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.dispatcher_accept_conduct_terms()', 'execute') then raise exception 'c8 anon can execute'; end if;
  raise exception 'ROLLBACK-OK';
end $t$;
