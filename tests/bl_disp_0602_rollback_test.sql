-- bl_disp_0602 rolled-back end-to-end test. STAGING ONLY. Everything runs inside one DO block that ends by
-- raising its own report, so nothing is kept (three throwaway auth users, their applications, attempts, e-mails).
do $$
declare v_staff uuid; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  r jsonb; out text := ''; v text; n int; rec record;
  pay jsonb := '{"full_name":"Zed Testcase","country":"Pakistan","city":"Lahore","english_level":"fluent","years_exp":"3","load_boards":["DAT"],"skills":{"own_board_access":["DAT"]},"refs":[]}';
  procedure_note text;
begin
  for rec in select id from auth.users order by created_at limit 400 loop
    perform set_config('request.jwt.claims', json_build_object('sub', rec.id, 'role', 'authenticated')::text, true);
    if app_private.disp_is_staff() then v_staff := rec.id; exit; end if;
  end loop;
  if v_staff is null then raise exception 'no staff user found'; end if;

  insert into auth.users (id, email, aud, role) values
    (u1, 'zed.testcase0602@gmail.com', 'authenticated', 'authenticated'),
    (u2, 'zedtest.case0602+again@gmail.com', 'authenticated', 'authenticated'),
    (u3, 'someoneelse0602@outlook.com', 'authenticated', 'authenticated');

  -- 1. first application goes to screening
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  r := public.dispatcher_apply(pay || '{"phone":"+92 300 5550602"}', true);
  out := out || E'\n1 apply u1: ' || r::text;

  -- 2. invite: 5 days
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  r := public.cc_dispatcher_test_invite(u1);
  select round(extract(epoch from (start_by - now())) / 3600) into n from app_private.skills_test_attempts where user_id = u1;
  select status into v from app_private.dispatcher_profiles where user_id = u1;
  out := out || E'\n2 invite: ' || (r - 'attempt')::text || ' window_h=' || n || ' status=' || v;

  -- 3. lapse with the 3 automatic rounds used -> back to screening, and no "application received" e-mail
  update app_private.skills_test_attempts set start_by = now() - interval '1 hour', auto_reinvite = 3 where user_id = u1;
  r := app_private.skills_test_sweep();
  select status into v from app_private.dispatcher_profiles where user_id = u1;
  select count(*) into n from app_private.skills_test_attempts where user_id = u1 and status = 'expired';
  out := out || E'\n3 sweep: done=' || (r->>'reinvite_done') || ' expired_attempts=' || n || ' status=' || v;

  -- 4. the test can be sent again from screening
  r := public.cc_dispatcher_test_invite(u1);
  select status into v from app_private.dispatcher_profiles where user_id = u1;
  out := out || E'\n4 re-invite: ok=' || coalesce(r->>'ok', r->>'error') || ' status=' || v;

  -- 5. started, nothing answered -> back to screening
  update app_private.skills_test_attempts set status = 'in_progress', started_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
   where user_id = u1 and status = 'invited';
  r := app_private.skills_test_sweep();
  select status into v from app_private.dispatcher_profiles where user_id = u1;
  out := out || E'\n5 blank lapse: expired=' || (r->>'expired') || ' status=' || v;

  -- 6. rejected
  r := public.cc_dispatcher_decide(u1, 'reject', 'test reject');
  out := out || E'\n6 reject: ' || coalesce(r->>'status', r->>'error');

  -- 7. same phone, written differently, other e-mail -> held
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.dispatcher_apply(pay || '{"phone":"0300-5550602"}', true);
  select status into v from app_private.dispatcher_profiles where user_id = u3;
  select via || ' attempts=' || attempts into procedure_note from app_private.dispatcher_dup_holds where user_id = u3;
  out := out || E'\n7 apply u3 (same phone): held=' || coalesce(r->>'held', 'NO') || ' status=' || v || ' hold=' || coalesce(procedure_note, 'none');
  r := public.dispatcher_apply(pay || '{"phone":"0300-5550602"}', true);
  select count(*) into n from app_private.notifications where template_key = 'dispatcher.duplicate.held' and payload->>'url' like '%' || u3::text || '%';
  out := out || E'\n7b second submit: held=' || coalesce(r->>'held', 'NO') || ' staff_notices=' || n;

  -- 8. staff cannot walk around the hold
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  r := public.cc_dispatcher_decide(u3, 'screening', null);
  out := out || E'\n8 decide on held: ' || left(coalesce(r->>'error', 'ALLOWED?!'), 40);
  r := public.cc_dispatcher_test_invite(u3);
  out := out || E'\n8b invite on held: ' || left(coalesce(r->>'error', 'ALLOWED?!'), 40);

  -- 9. the record behind it
  r := public.cc_dispatcher_identity(u3);
  out := out || E'\n9 identity: open=' || (r->'hold'->>'open') || ' matches=' || jsonb_array_length(r->'matches')
      || ' first=' || (r->'matches'->0->>'via') || '/' || (r->'matches'->0->>'status') || '/attempts ' || (r->'matches'->0->>'attempts');

  -- 10. management reactivates the original
  r := public.cc_dispatcher_duplicate_resolve(u3, 'reactivate_original', 'second chance');
  select status into v from app_private.dispatcher_profiles where user_id = u1;
  select status into procedure_note from app_private.dispatcher_profiles where user_id = u3;
  out := out || E'\n10 reactivate original: ' || coalesce(r->>'action', r->>'error') || ' u1=' || v || ' u3=' || procedure_note;

  -- 11. Gmail dots / +tag, different phone -> held on e-mail; management allows it
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.dispatcher_apply(pay || '{"phone":"+1 415 555 0199"}', true);
  select via into procedure_note from app_private.dispatcher_dup_holds where user_id = u2;
  out := out || E'\n11 apply u2 (gmail alias): held=' || coalesce(r->>'held', 'NO') || ' via=' || coalesce(procedure_note, 'none');
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  r := public.cc_dispatcher_duplicate_resolve(u2, 'allow', 'ok by management');
  select status into v from app_private.dispatcher_profiles where user_id = u2;
  out := out || E'\n11b allow: ' || coalesce(r->>'action', r->>'error') || ' u2=' || v;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.dispatcher_apply(pay || '{"phone":"+1 415 555 0199"}', true);
  out := out || E'\n11c submit after allow: ' || r::text;

  raise exception E'ROLLBACK REPORT%', out;
end $$;
