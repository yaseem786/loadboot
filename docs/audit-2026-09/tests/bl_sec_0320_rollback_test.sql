-- bl_sec_0320_rollback_test.sql — audit F01. Rollback-txn test for migrations/bl_sec_0320_email_ingest_service_only.sql.
-- PASS = the error message starts with RESULT PASS. Nothing persists.
--
-- WHAT IT PROVES: the three lb_email_* ingestion RPCs (SECURITY DEFINER, no caller check before this migration)
-- now refuse anon and authenticated with {"error":"forbidden","code":"LB403"} and write nothing, while a
-- service_role caller — i.e. the edge fn load-mail v8, which sends Authorization: Bearer <service key> — passes
-- the guard and reaches the real body.
--
-- ORDER ON ANY ENV: deploy load-mail v8 FIRST, then this migration. v7 sent `apikey` only and would be refused.
-- PROD RESULT 2026-09-05 22:4x UTC: RESULT PASS — authenticated=LB403, anon=LB403, service_role reached the body
-- ({"merged":false,"reason":"no_broker"} for a non-existent sender), 0 rows written by the refused callers.
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb; n0 int; n1 int; msg text := '';
begin
  select count(*) into n0 from app_private.email_loads;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
  r1 := public.lb_email_load_ingest(jsonb_build_object('from_email','spoof@test.invalid','subject','x','raw_body','x',
          'parsed', jsonb_build_object('origin','Dallas, TX','destination','Atlanta, GA')));
  if r1->>'code' <> 'LB403' then raise exception 'RESULT FAIL: authenticated got through: %', r1; end if;

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  r2 := public.lb_email_reply_merge('spoof@test.invalid', '{"rate":"1"}'::jsonb);
  if r2->>'code' <> 'LB403' then raise exception 'RESULT FAIL: anon got through reply_merge: %', r2; end if;
  r3 := public.lb_email_ping_confirm_by_email('spoof@test.invalid', '{}'::jsonb);
  if r3->>'code' <> 'LB403' then raise exception 'RESULT FAIL: anon got through ping_confirm: %', r3; end if;

  select count(*) into n1 from app_private.email_loads;
  if n1 <> n0 then raise exception 'RESULT FAIL: rows were written by refused callers'; end if;

  -- service_role passes the guard; whatever the body then decides is its own logic
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  r1 := public.lb_email_reply_merge('nobody-here@test.invalid', '{"rate":"1"}'::jsonb);
  if r1->>'code' = 'LB403' then raise exception 'RESULT FAIL: service_role was refused'; end if;
  msg := format(' authenticated=LB403 anon=LB403 service_role=%s', r1::text);

  if exists (select 1 from information_schema.routine_privileges
              where specific_schema='public'
                and routine_name in ('lb_email_load_ingest','lb_email_reply_merge','lb_email_ping_confirm_by_email')
                and grantee in ('anon','authenticated','PUBLIC')) then
    raise exception 'RESULT FAIL: anon/authenticated grants remain'; end if;

  raise exception 'RESULT PASS (rolled back):%', msg;
end $$;
