-- bl_sec_0329_rollback_test.sql — audit F14. Rollback-txn test for the retell_webhook guard.
-- PASS = the block RAISEs 'RESULT PASS'. Every write is rolled back, including the flag flips.
--
-- WHAT IT PROVES, in the order that matters:
--   case 1 — with the flag at its default (allow_unsigned_webhook = TRUE) an anon caller still gets through and
--            still writes the row. This is the important one: applying the migration changes NOTHING. Retell is
--            still posting straight at PostgREST with the anon key, and 112 lc_calls rows / 8 voice-call leads
--            on prod say that chain is live and earning.
--   case 2 — with the flag OFF, anon and authenticated both get LB403 and write nothing.
--   case 3 — with the flag OFF, service_role (i.e. the retell-hook edge function) still reaches the body.
-- STAGING RESULT 2026-09-06: RESULT PASS on all three.
do $$
declare v_from text; r jsonb; n0 int; n1 int; msg text := '';
begin
  select from_number into v_from from app_private.retell_config where id=1;
  if v_from is null then raise exception 'RESULT FAIL: retell_config.from_number is null on this env'; end if;

  update app_private.retell_config set allow_unsigned_webhook = true where id=1;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  r := public.retell_webhook(jsonb_build_object('event','call_started','call',
        jsonb_build_object('call_id','bl0329-case1','from_number',v_from,'to_number','+15550000001')));
  if r->>'code' = 'LB403' then raise exception 'RESULT FAIL: default flag broke the live provider chain: %', r; end if;
  if not exists (select 1 from app_private.lc_calls where call_id='bl0329-case1') then
    raise exception 'RESULT FAIL: default flag stopped the row being written'; end if;
  msg := msg || ' case1 flag=true anon still works (no behaviour change on apply) PASS;';

  update app_private.retell_config set allow_unsigned_webhook = false where id=1;
  select count(*) into n0 from app_private.lc_calls;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  r := public.retell_webhook(jsonb_build_object('event','call_started','call',
        jsonb_build_object('call_id','bl0329-case2','from_number',v_from,'to_number','+15550000002')));
  if r->>'code' <> 'LB403' then raise exception 'RESULT FAIL: anon got through with the flag off: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  r := public.retell_webhook(jsonb_build_object('event','call_started','call',
        jsonb_build_object('call_id','bl0329-case2b','from_number',v_from,'to_number','+15550000003')));
  if r->>'code' <> 'LB403' then raise exception 'RESULT FAIL: authenticated got through with the flag off: %', r; end if;
  select count(*) into n1 from app_private.lc_calls;
  if n1 <> n0 then raise exception 'RESULT FAIL: % rows written by refused callers', n1-n0; end if;
  msg := msg || ' case2 flag=false anon+authenticated=LB403, 0 rows written PASS;';

  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  r := public.retell_webhook(jsonb_build_object('event','call_started','call',
        jsonb_build_object('call_id','bl0329-case3','from_number',v_from,'to_number','+15550000004')));
  if r->>'code' = 'LB403' then raise exception 'RESULT FAIL: service_role was refused: %', r; end if;
  if not exists (select 1 from app_private.lc_calls where call_id='bl0329-case3') then
    raise exception 'RESULT FAIL: service_role reached the guard but wrote nothing'; end if;
  msg := msg || ' case3 flag=false service_role reaches the body and writes PASS;';

  raise exception 'RESULT PASS (all writes rolled back):%', msg;
end $$;
