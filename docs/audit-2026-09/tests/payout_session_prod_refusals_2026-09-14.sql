BEGIN; SET LOCAL plpgsql.check_asserts=on;
DO $checks$ DECLARE r text; call_sql text; refused boolean; n integer:=0; BEGIN
 PERFORM set_config('request.jwt.claim.sub','',true);
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role',r)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',r);
  FOREACH call_sql IN ARRAY ARRAY['select public.agent_payout_center()','select public.agent_request_payout()','select public.cc_my_payout_requests()','select public.cc_referral_request_payout(''{}''::jsonb)'] LOOP
   refused:=false; BEGIN EXECUTE call_sql; EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
   ASSERT refused,'missing-session payout access accepted'; n:=n+1;
  END LOOP;
  EXECUTE 'RESET ROLE';
 END LOOP; ASSERT n=12,'wrong check count';
END $checks$; ROLLBACK;
SELECT 'PASS: 12 no-session role refusals; no payout or account data written' result;
