-- STAGING ONLY: rollback-only synthetic users/ledger/request/session fixtures; no transfer or sender.
BEGIN; SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE payout_anon_before AS SELECT p.proname,pg_get_function_identity_arguments(p.oid) args
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- MIGRATION_UNDER_TEST
CREATE FUNCTION pg_temp.payout_denied() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE call_sql text; refused boolean; n integer:=0;
BEGIN
 FOREACH call_sql IN ARRAY ARRAY[
  'select public.agent_payout_center()', 'select public.agent_request_payout()',
  'select public.cc_my_payout_requests()',
  'select public.cc_referral_request_payout(''{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789"}''::jsonb)'] LOOP
  refused:=false; BEGIN EXECUTE call_sql; EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
  ASSERT refused,'payout endpoint accepted invalid session: '||call_sql; n:=n+1;
 END LOOP; RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.payout_denied() TO anon,authenticated,service_role;
DO $tests$
DECLARE actor uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); other_sid uuid:=gen_random_uuid();
 ref uuid:=gen_random_uuid(); other_ref uuid:=gen_random_uuid(); result jsonb; claims jsonb; n integer:=0; failed boolean; r text; target regprocedure;
BEGIN
 FOREACH target IN ARRAY ARRAY['public.agent_payout_center()'::regprocedure,'public.agent_request_payout()'::regprocedure,'public.cc_my_payout_requests()'::regprocedure,'public.cc_referral_request_payout(jsonb)'::regprocedure] LOOP
  ASSERT position('perform app_private.assert_payment_session();' in pg_get_functiondef(target))>0,'deployed guard missing'; n:=n+1;
 END LOOP;
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (actor,'audit-payout-session-'||actor||'@example.invalid','{"role":"driver"}'),
 (other_user,'audit-payout-session-'||other_user||'@example.invalid','{"role":"driver"}');
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal) VALUES(sid,actor,now(),now(),'aal1'),(other_sid,other_user,now(),now(),'aal1');
 INSERT INTO app_private.referrers(id,user_id,code) VALUES(ref,actor,'audit-'||ref),(other_ref,other_user,'audit-'||other_ref);
 INSERT INTO app_private.agent_profiles(user_id,status,payout_method,payout_details) VALUES
 (actor,'approved','bank','{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789","account":"123456789"}')
 ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,payout_method=excluded.payout_method,payout_details=excluded.payout_details;
 INSERT INTO app_private.referral_commissions(invoice_id,source_org,referrer_id,level,base_fee,pct,amount,status,payable_at)
 VALUES(gen_random_uuid(),gen_random_uuid(),ref,1,12000,1,120,'payable',now()-interval '1 day');
 INSERT INTO app_private.referral_payout_requests(referrer_id,requested_by,amount,payout_details,status)
 VALUES(other_ref,other_user,999,'{"bank_name":"OTHER SYNTHETIC"}','requested');
 claims:=jsonb_build_object('sub',actor,'role','authenticated','session_id',sid);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true); PERFORM set_config('request.jwt.claims',claims::text,true);
 -- Invalid session/account paths must fail before creating payout requests or exposing bank/ledger data.
 UPDATE auth.users SET banned_until='infinity' WHERE id=actor;
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id=actor;
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 UPDATE auth.users SET deleted_at=NULL WHERE id=actor;
 INSERT INTO app_private.account_deletion_requests(user_id,email,status) VALUES(actor,'audit-payout-session-'||actor||'@example.invalid','completed');
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 DELETE FROM app_private.account_deletion_requests WHERE user_id=actor;
 PERFORM set_config('request.jwt.claims',(claims-'session_id')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',(claims||jsonb_build_object('session_id',other_sid))::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',claims::text,true);
 DELETE FROM auth.sessions WHERE id=sid;
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 INSERT INTO auth.sessions(id,user_id,not_after) VALUES(sid,actor,now()-interval '1 minute');
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 UPDATE auth.sessions SET not_after=NULL WHERE id=sid;
 FOREACH r IN ARRAY ARRAY['anon','service_role'] LOOP
  PERFORM set_config('request.jwt.claim.sub','',true); PERFORM set_config('request.jwt.claims',jsonb_build_object('role',r)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',r); n:=n+pg_temp.payout_denied(); EXECUTE 'RESET ROLE';
 END LOOP;
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.referral_payout_requests WHERE referrer_id=ref),'refused call created payout'; n:=n+1;
 ASSERT (SELECT amount=120 AND status='payable' FROM app_private.referral_commissions WHERE referrer_id=ref),'refused call changed ledger'; n:=n+1;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true); PERFORM set_config('request.jwt.claims',claims::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.agent_payout_center(); ASSERT result->>'payable'='120.00' OR (result->>'payable')::numeric=120,'valid center/ledger failed'; n:=n+1;
 ASSERT jsonb_array_length(result->'requests')=0,'other account payout leaked'; n:=n+1;
 result:=public.cc_my_payout_requests(); ASSERT result='[]'::jsonb,'other account history leaked'; n:=n+1;
 result:=public.agent_request_payout(); ASSERT result->>'ok'='true' AND (result->>'amount')::numeric=120,'valid agent payout failed'; n:=n+1;
 failed:=false; BEGIN PERFORM public.agent_request_payout(); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END;
 ASSERT failed,'duplicate agent request allowed'; n:=n+1;
 result:=public.cc_my_payout_requests(); ASSERT jsonb_array_length(result)=1 AND result->0->>'account_last4'='6789','own history/masking failed'; n:=n+1;
 ASSERT NOT (result->0 ? 'account_number'),'full account number exposed'; n:=n+1;
 EXECUTE 'RESET ROLE'; UPDATE app_private.referral_payout_requests SET status='rejected' WHERE referrer_id=ref;
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_referral_request_payout('{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789"}');
 ASSERT result->>'ok'='true' AND (result->>'amount')::numeric=120,'valid referral payout failed'; n:=n+1;
 failed:=false; BEGIN PERFORM public.cc_referral_request_payout('{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789"}'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END;
 ASSERT failed,'duplicate referral request allowed'; n:=n+1;
 EXECUTE 'RESET ROLE';
 ASSERT (SELECT amount=999 AND status='requested' FROM app_private.referral_payout_requests WHERE referrer_id=other_ref),'other account changed'; n:=n+1;
 ASSERT NOT EXISTS((SELECT * FROM payout_anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM payout_anon_before)), 'anonymous surface changed'; n:=n+1;
 ASSERT n=53,'unexpected payout assertion count: '||n;
END $tests$;
ROLLBACK;
SELECT 'PASS: 53 payout behavior/source/ACL checks plus count guard; all fixtures rolled back' result;
