-- tests/bl_disp_0443_rollback_test.sql — carrier report → permanent block. Run on STAGING after the migration.
-- Everything happens inside one transaction that ends with `raise exception 'ROLLBACK-OK'`: nothing persists.
-- Uses the same fixtures as the 0442 test: the first dispatcher, owner@lb.test staff, the carrier that owns
-- the cc000000…0001 trucks (and its owner as the reporting carrier user).
do $t$
declare v_disp uuid := (select user_id from app_private.dispatcher_profiles order by created_at limit 1);
        v_staff uuid := (select s.user_id from app_private.staff_members s join auth.users u on u.id = s.user_id where u.email = 'owner@lb.test' and s.status = 'active' limit 1);
        v_c1 uuid; v_owner uuid; v_asg uuid; r jsonb; l jsonb; v_r1 uuid; v_r2 uuid; n int; v_attempt uuid;
begin
  if v_disp is null or v_staff is null then raise exception 'fixture: need one dispatcher and owner@lb.test staff'; end if;
  select carrier_id into v_c1 from app_private.fleet_trucks where carrier_id = 'cc000000-0000-0000-0000-000000000001' limit 1;
  select owner_user_id into v_owner from public.organizations where id = v_c1;
  if v_c1 is null or v_owner is null then raise exception 'fixture: carrier cc000000…0001 with an owner'; end if;
  update app_private.dispatcher_assignments set status = 'ended', ended_at = now(), end_reason = 'test 0443' where status <> 'ended';
  update app_private.dispatcher_carrier_choices set status = 'withdrawn' where status = 'pending';
  insert into app_private.carrier_onboarding(carrier_id, stage, decided_at) values (v_c1, 'approved', now() - interval '20 days')
    on conflict (carrier_id) do update set stage = 'approved', decided_at = coalesce(app_private.carrier_onboarding.decided_at, excluded.decided_at);
  update public.organizations set status = 'active', is_demo = false where id = v_c1;
  update app_private.dispatcher_profiles set status = 'trial', blocked_at = null, blocked_reason = null, commission_pct = 2.5, trial_start = current_date, trial_end = app_private.add_working_days(current_date, 10) where user_id = v_disp;
  insert into app_private.dispatcher_assignments(dispatcher_user_id, carrier_org_id, status, assigned_by, assigned_at) values (v_disp, v_c1, 'active', v_staff, now() - interval '2 days') returning id into v_asg;
  if app_private.disp_carrier_available(v_c1) then raise exception 'fixture: carrier should be held by the live assignment'; end if;

  -- c1 the carrier owner reports: row, staff card, staff e-mail, receipt card, receipt e-mail
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  r := public.carrier_report_dispatcher('bogus', null, null, null);
  if r->>'error' is null then raise exception 'c1 bad kind accepted %', r; end if;
  r := public.carrier_report_dispatcher('off_platform_contact', 'whatsapp', null, null);
  if r->>'error' is null then raise exception 'c1 empty report accepted %', r; end if;
  r := public.carrier_report_dispatcher('off_platform_contact', 'whatsapp', '+1 555 010 0199', 'He messaged me from a personal WhatsApp asking for my cell.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'c1 report %', r; end if;
  v_r1 := (r->>'id')::uuid;
  if (select count(*) from app_private.dispatcher_reports where id = v_r1 and status = 'open' and assignment_id = v_asg and dispatcher_user_id = v_disp and reported_by = v_owner) <> 1 then raise exception 'c1 row'; end if;
  select count(*) into n from app_private.notifications where template_key = 'dispatcher.report.staff' and recipient_role = 'staff' and created_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'c1 staff card % (want 1)', n; end if;
  select count(*) into n from app_private.message_deliveries where idempotency_key = 'disp.report.staff:' || v_r1::text; if n <> 1 then raise exception 'c1 staff e-mail % (want 1)', n; end if;
  select count(*) into n from app_private.message_deliveries where idempotency_key = 'disp.report.receipt:' || v_r1::text; if n <> 1 then raise exception 'c1 receipt e-mail % (want 1)', n; end if;
  if exists (select 1 from app_private.message_deliveries where idempotency_key like 'disp.report.%:' || v_r1::text and meta->>'body_html' like '%{{contact_inline}}%') then raise exception 'c1 contact token not expanded'; end if;
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname in ('public','app_private')
               and p.proname in ('carrier_report_dispatcher','cc_dispatcher_report_decide','disp_choice_backfill_email','disp_trial_email','disp_assign_email_html')
               and (pg_get_functiondef(p.oid) like '%253-7575%' or pg_get_functiondef(p.oid) like '%2537575%')) then raise exception 'c1 riley number hard-coded'; end if;
  -- a second report is fine; the fourth open one is refused
  r := public.carrier_report_dispatcher('asked_personal_contact', 'call', null, 'Asked for my personal number on the first call.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'c1 second report %', r; end if;
  v_r2 := (r->>'id')::uuid;
  r := public.carrier_report_dispatcher('other', null, null, 'third'); if not coalesce((r->>'ok')::boolean,false) then raise exception 'c1 third %', r; end if;
  r := public.carrier_report_dispatcher('other', null, null, 'fourth'); if r->>'error' is null then raise exception 'c1 cap not enforced %', r; end if;
  -- the dispatcher cannot call the carrier RPC
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_disp)::text, true);
  r := public.carrier_report_dispatcher('other', null, null, 'x'); if r->>'error' is null then raise exception 'c1 dispatcher could report %', r; end if;

  -- c2 staff sees the queue; dismiss one → carrier told, nothing else changes
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_staff)::text, true);
  l := public.cc_dispatcher_reports('open', null);
  if jsonb_typeof(l) <> 'array' or jsonb_array_length(l) < 3 then raise exception 'c2 queue %', l; end if;
  if (select count(*) from jsonb_array_elements(l) x where (x->>'id')::uuid = v_r1 and (x->'dispatcher'->>'open_reports')::int = 3 and x->'carrier'->>'name' is not null) <> 1 then raise exception 'c2 row shape %', l; end if;
  r := public.cc_dispatcher_report_decide(v_r2, 'dismiss', 'Call log shows the LoadBoot line only.');
  if (r->>'status') is distinct from 'dismissed' then raise exception 'c2 dismiss %', r; end if;
  if (select status from app_private.dispatcher_reports where id = v_r2) <> 'dismissed' then raise exception 'c2 not dismissed'; end if;
  select count(*) into n from app_private.message_deliveries where idempotency_key = 'disp.report.dismissed:' || v_r2::text; if n <> 1 then raise exception 'c2 dismissed e-mail % (want 1)', n; end if;
  if (select status from app_private.dispatcher_profiles where user_id = v_disp) <> 'trial' or (select status from app_private.dispatcher_assignments where id = v_asg) <> 'active' then raise exception 'c2 dismiss changed state'; end if;
  r := public.cc_dispatcher_report_decide(v_r2, 'uphold', 'again'); if r->>'error' is null then raise exception 'c2 decided twice %', r; end if;

  -- c3 uphold → suspended + blocked, assignment ended, carrier free, other open reports closed, both sides e-mailed
  r := public.cc_dispatcher_report_decide(v_r1, 'uphold', 'Screenshots match the personal number.');
  if not coalesce((r->>'blocked')::boolean,false) or (r->>'assignments_ended')::int <> 1 then raise exception 'c3 uphold %', r; end if;
  if (select status from app_private.dispatcher_profiles where user_id = v_disp) <> 'suspended' or (select blocked_at from app_private.dispatcher_profiles where user_id = v_disp) is null then raise exception 'c3 not blocked'; end if;
  if (select status from app_private.dispatcher_assignments where id = v_asg) <> 'ended' then raise exception 'c3 assignment not ended'; end if;
  if not app_private.disp_carrier_available(v_c1) then raise exception 'c3 carrier still held'; end if;
  if (select count(*) from app_private.dispatcher_reports where dispatcher_user_id = v_disp and status in ('open','reviewing')) <> 0 then raise exception 'c3 open reports remain'; end if;
  if (select status from app_private.dispatcher_reports where id = v_r2) <> 'dismissed' then raise exception 'c3 dismissed report touched'; end if;
  select count(*) into n from app_private.message_deliveries where idempotency_key = 'disp.blocked:' || v_disp::text; if n <> 1 then raise exception 'c3 blocked e-mail % (want 1)', n; end if;
  select count(*) into n from app_private.message_deliveries where idempotency_key = 'disp.report.upheld:' || v_r1::text; if n <> 1 then raise exception 'c3 upheld e-mail % (want 1)', n; end if;
  select count(*) into n from app_private.message_deliveries where template_key = 'dispatcher.offboarded' and idempotency_key like 'disp.offboard:' || v_disp::text || ':ended:%' and scheduled_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'c3 offboard e-mail % (want 1)', n; end if;
  select count(*) into n from app_private.notifications where template_key = 'dispatcher.blocked' and (payload->>'user')::uuid = v_disp and created_at > now() - interval '1 minute'; if n <> 1 then raise exception 'c3 blocked card %', n; end if;
  -- reinstate refused, re-apply refused, choosing refused
  r := public.cc_dispatcher_decide(v_disp, 'reinstate', null); if r->>'error' not ilike '%permanently blocked%' then raise exception 'c3 reinstate %', r; end if;
  r := public.cc_dispatcher_decide(v_disp, 'trial', null); if r->>'error' not ilike '%permanently blocked%' then raise exception 'c3 trial while blocked %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_disp)::text, true);
  r := public.dispatcher_reapply(true); if (r->>'reason') is distinct from 'blocked' then raise exception 'c3 reapply %', r; end if;
  r := public.dispatcher_carrier_options(); if (r->>'eligible')::boolean then raise exception 'c3 still eligible %', r - 'carriers'; end if;

  -- c4 the trial e-mail and the carrier intro carry the rule
  if pg_get_functiondef('app_private.disp_trial_email(uuid, text)'::regprocedure) not like '%Contact rule &mdash; permanent block%' then raise exception 'c4 trial e-mail not patched'; end if;
  if pg_get_functiondef('app_private.disp_assign_email_html(uuid)'::regprocedure) not like '%Protect yourself &mdash; one rule%' then raise exception 'c4 carrier intro not patched'; end if;

  -- c5 backfill: a passed skills_test candidate gets ONE e-mail; a second run sends nothing; a blocked one is skipped
  update app_private.dispatcher_profiles set status = 'skills_test', blocked_at = null, blocked_reason = null where user_id = v_disp;
  delete from app_private.skills_test_attempts where user_id = v_disp;
  insert into app_private.skills_test_attempts(user_id, attempt_no, status, minutes, invited_at, start_by, started_at, ends_at, submitted_at, decision, staff_score, max_score, reviewed_at, passed_email_at)
    values (v_disp, 1, 'scored', 45, now() - interval '3 days', now() - interval '1 day', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', 'pass', 80, 100, now() - interval '1 day', now() - interval '1 day')
    returning id into v_attempt;
  r := app_private.disp_choice_backfill_email();
  if (r->>'sent')::int <> 1 then raise exception 'c5 backfill % ', r; end if;
  select count(*) into n from app_private.message_deliveries where idempotency_key = 'disppass.choose:' || v_attempt::text; if n <> 1 then raise exception 'c5 e-mail % (want 1)', n; end if;
  r := app_private.disp_choice_backfill_email();
  if (r->>'sent')::int <> 0 then raise exception 'c5 backfill re-sent %', r; end if;
  update app_private.dispatcher_profiles set blocked_at = now() where user_id = v_disp;
  delete from app_private.message_deliveries where idempotency_key = 'disppass.choose:' || v_attempt::text;
  r := app_private.disp_choice_backfill_email();
  if (r->>'sent')::int <> 0 then raise exception 'c5 blocked candidate e-mailed %', r; end if;

  -- c6 anon can execute none of the three
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if has_function_privilege('anon', 'public.carrier_report_dispatcher(text,text,text,text)', 'execute') or has_function_privilege('anon', 'public.cc_dispatcher_reports(text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.cc_dispatcher_report_decide(uuid,text,text)', 'execute') then raise exception 'c6 anon can execute'; end if;
  raise exception 'ROLLBACK-OK';
end $t$;
