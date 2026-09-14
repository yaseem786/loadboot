-- STAGING ONLY. All users, sessions, organizations, bank placeholders and events roll back.
-- No actual Auth/Admin sign-out, bank transfer, sender, Storage API or customer diagnostic.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE payment_anon_before AS
 SELECT p.proname,pg_get_function_identity_arguments(p.oid) args
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- MIGRATION_UNDER_TEST
CREATE FUNCTION pg_temp.payment_denied() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE refused boolean; result jsonb; n integer:=0;
BEGIN
 refused:=false;
 BEGIN result:=public.cc_my_payment_profile(); EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 ASSERT refused,'payment read accepted invalid session'; n:=n+1;
 refused:=false;
 BEGIN result:=public.cc_set_my_payment_profile('{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789","routing_number":"021000021"}');
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 ASSERT refused,'payment write accepted invalid session'; n:=n+1;
 RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.payment_denied() TO authenticated,anon,service_role;
DO $tests$
DECLARE actor uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); other_sid uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid(); result jsonb; before_row jsonb; claims jsonb; n integer:=0; role_name text; kind_name text;
 hardened boolean:=to_regprocedure('app_private.assert_payment_session()') IS NOT NULL;
BEGIN
 ASSERT NOT hardened,'baseline requires unpatched source';
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (actor,'audit-payment-session-'||actor||'@example.invalid','{"role":"driver"}'),
 (other_user,'audit-payment-session-'||other_user||'@example.invalid','{"role":"driver"}');
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal) VALUES(sid,actor,now(),now(),'aal1'),(other_sid,other_user,now(),now(),'aal1');
 -- Carrier INSERT does not enter the broker/shipper welcome trigger branch.
 INSERT INTO public.organizations(id,kind,name,is_demo,owner_user_id) VALUES(org,'carrier','Audit payment session synthetic',true,actor);
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(org,actor,'owner','active');
 claims:=jsonb_build_object('sub',actor,'role','authenticated','session_id',sid);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',claims::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_my_payment_profile(); ASSERT result->>'exists'='false','new account read broken'; n:=n+1;
 result:=public.cc_set_my_payment_profile('{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789","routing_number":"021000021"}');
 ASSERT result->>'ok'='true','valid carrier write blocked'; n:=n+1;
 result:=public.cc_my_payment_profile(); ASSERT result->>'account_last4'='6789','valid read broken'; n:=n+1;
 ASSERT NOT (result ? 'account_number'),'full account number exposed'; n:=n+1;
 EXECUTE 'RESET ROLE';
 SELECT to_jsonb(p) INTO STRICT before_row FROM app_private.org_payment_profiles p WHERE org_id=org;
 UPDATE auth.users SET banned_until='infinity' WHERE id=actor;
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF hardened THEN n:=n+pg_temp.payment_denied();
 ELSE
  result:=public.cc_my_payment_profile(); ASSERT result->>'account_last4'='6789','baseline ban read changed'; n:=n+1;
  result:=public.cc_set_my_payment_profile('{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789","routing_number":"021000021"}');
  ASSERT result->>'ok'='true','baseline ban write changed'; n:=n+1;
 END IF;
 EXECUTE 'RESET ROLE'; UPDATE auth.users SET banned_until=NULL WHERE id=actor;
 DELETE FROM auth.sessions WHERE id=sid;
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF hardened THEN n:=n+pg_temp.payment_denied();
 ELSE result:=public.cc_my_payment_profile(); ASSERT result->>'account_last4'='6789','baseline removed-session read changed'; n:=n+1;
 END IF;
 EXECUTE 'RESET ROLE';
 IF NOT hardened THEN RAISE NOTICE 'BASELINE CONFIRMED: % assertions; banned read/write and removed-session read accepted',n; RETURN; END IF;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal) VALUES(sid,actor,now(),now(),'aal1');
 -- Missing, empty, malformed, nonexistent and another user's session all refuse.
 FOREACH kind_name IN ARRAY ARRAY['missing','','malformed',gen_random_uuid()::text,other_sid::text] LOOP
  PERFORM set_config('request.jwt.claims',(CASE WHEN kind_name='missing' THEN claims-'session_id' ELSE jsonb_set(claims,'{session_id}',to_jsonb(kind_name)) END)::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 END LOOP;
 PERFORM set_config('request.jwt.claims',claims::text,true);
 UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id=sid;
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 UPDATE auth.sessions SET not_after=now()+interval '1 hour' WHERE id=sid;
 UPDATE auth.users SET deleted_at=now() WHERE id=actor;
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 UPDATE auth.users SET deleted_at=NULL,banned_until=now()-interval '1 minute' WHERE id=actor;
 -- A completed application request blocks even if an Auth ban is accidentally lifted.
 INSERT INTO app_private.account_deletion_requests(user_id,email,status) VALUES(actor,'audit-payment-session-'||actor||'@example.invalid','completed');
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 DELETE FROM app_private.account_deletion_requests WHERE user_id=actor;
 PERFORM set_config('request.jwt.claims',(claims||'{"is_anonymous":true}'::jsonb)::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',(claims||'{"role":"service_role"}'::jsonb)::text,true);
 EXECUTE 'SET LOCAL ROLE service_role'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 EXECUTE 'SET LOCAL ROLE anon'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 ASSERT (SELECT to_jsonb(p)=before_row FROM app_private.org_payment_profiles p WHERE org_id=org),'denied attempts changed bank data'; n:=n+1;
 -- Valid session still reaches validation/ownership rules and broker/shipper fallback.
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',claims::text,true);
 FOREACH kind_name IN ARRAY ARRAY['carrier','broker','shipper'] LOOP
  UPDATE public.organizations SET kind=kind_name WHERE id=org;
  EXECUTE 'SET LOCAL ROLE authenticated';
  result:=public.cc_my_payment_profile(); ASSERT result->>'exists'='true','valid member read blocked'; n:=n+1;
  result:=public.cc_set_my_payment_profile('{"bank_name":"SYNTHETIC","account_title":"SYNTHETIC","account_number":"123456789","routing_number":"021000021"}');
  ASSERT result->>'ok'='true','valid member write blocked'; n:=n+1;
  EXECUTE 'RESET ROLE';
 END LOOP;
 -- Current session without membership remains unauthorized.
 DELETE FROM public.organization_memberships WHERE org_id=org AND user_id=actor;
 EXECUTE 'SET LOCAL ROLE authenticated'; n:=n+pg_temp.payment_denied(); EXECUTE 'RESET ROLE';
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  ASSERT NOT has_function_privilege(role_name,'app_private.assert_payment_session()','execute'),'helper exposed'; n:=n+1;
 END LOOP;
 ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='app_private.assert_payment_session()'::regprocedure),'helper unexpectedly SECURITY DEFINER'; n:=n+1;
 ASSERT NOT EXISTS((SELECT * FROM payment_anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM payment_anon_before)), 'anonymous surface changed'; n:=n+1;
 ASSERT n=44,'unexpected assertion count';
 RAISE NOTICE 'PAYMENT SESSION PASS: % behavioral/ACL assertions plus count guard',n;
END $tests$;
ROLLBACK;
SELECT 'BASELINE CONFIRMED: seven assertions; banned read/write and removed-session read accepted' AS result;
