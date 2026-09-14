BEGIN; SET LOCAL plpgsql.check_asserts=on;
DO $checks$ DECLARE r text; sql_call text; denied boolean; BEGIN
 PERFORM set_config('request.jwt.claim.sub','',true);
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role',r)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',r);
  FOREACH sql_call IN ARRAY ARRAY['select public.cc_carrier_payment_profile(null::uuid)','select public.cc_payment_profiles_queue()','select public.cc_referral_payout_queue()','select public.cc_verify_payment_profile(null::uuid,true)','select public.cc_referral_payout_decide(null::uuid,''paid'')'] LOOP
   denied:=false; BEGIN EXECUTE sql_call; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   ASSERT denied,'staff finance accepted caller without session';
  END LOOP;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $checks$; ROLLBACK;
SELECT 'PASS: 15 no-session staff-finance refusals; no account, bank or payout writes' result;
