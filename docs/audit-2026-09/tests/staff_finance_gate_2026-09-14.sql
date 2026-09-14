-- STAGING ONLY: all synthetic writes and temporary function/table substitutions roll back.
-- Positive queue tests substitute only fixture tables in the actual queue bodies, avoiding customer reads.
BEGIN; SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE staff_finance_anon AS SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- MIGRATION_UNDER_TEST
CREATE FUNCTION pg_temp.staff_finance_denied(org uuid,rid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE sql_call text; refused boolean;
BEGIN
 FOREACH sql_call IN ARRAY ARRAY[
 format('select public.cc_carrier_payment_profile(%L::uuid)',org),
 'select public.cc_payment_profiles_queue()', 'select public.cc_referral_payout_queue()',
 format('select public.cc_verify_payment_profile(%L::uuid,true)',org),
 format('select public.cc_referral_payout_decide(%L::uuid,''approve'')',rid)] LOOP
  refused:=false; BEGIN EXECUTE sql_call; EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
  ASSERT refused,'unauthorized staff finance access: '||sql_call;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.staff_finance_denied(uuid,uuid) TO authenticated,anon,service_role;
DO $tests$
DECLARE staff uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); internal_org uuid;
 sid uuid:=gen_random_uuid(); wrong_sid uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid();
 commission uuid:=gen_random_uuid(); extra uuid:=gen_random_uuid(); result jsonb; claims jsonb; failed boolean; mode text;
 original_bank_queue text; original_payout_queue text; before_bank jsonb; before_request jsonb; f record;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
 ('cc_carrier_payment_profile','cc_payment_profiles_queue','cc_verify_payment_profile','cc_referral_payout_queue','cc_referral_payout_decide') LOOP
  ASSERT position('perform app_private.assert_payment_session();' in pg_get_functiondef(f.oid))>0,'deployed session guard missing';
 END LOOP;
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(staff,'audit-staff-finance-'||staff||'@example.invalid','{"role":"driver"}'),(target,'audit-staff-finance-'||target||'@example.invalid','{"role":"driver"}');
 INSERT INTO auth.sessions(id,user_id,created_at,aal) VALUES(sid,staff,now(),'aal1'),(wrong_sid,target,now(),'aal1');
 SELECT id INTO STRICT internal_org FROM public.organizations WHERE kind='internal' AND status='active';
 INSERT INTO app_private.staff_members(user_id,status) VALUES(staff,'active');
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(internal_org,staff,'staff','active');
 INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(staff,'finance.view','allow'),(staff,'finance.approve','allow');
 INSERT INTO public.organizations(id,owner_user_id,kind,name,is_demo) VALUES(org,target,'carrier','Audit staff finance synthetic',true);
 INSERT INTO app_private.org_payment_profiles(org_id,bank_name,account_title,account_number,routing_number) VALUES(org,'SYNTHETIC','SYNTHETIC','123456789','021000021');
 INSERT INTO app_private.referrers(id,user_id,code) VALUES(ref,target,'audit-staff-'||ref);
 INSERT INTO app_private.referral_payout_requests(id,referrer_id,requested_by,amount,payout_details,status) VALUES(rid,ref,target,120,'{"bank_name":"SYNTHETIC"}','requested');
 INSERT INTO app_private.referral_commissions(id,invoice_id,source_org,referrer_id,level,base_fee,pct,amount,status,payable_at)
 VALUES(commission,gen_random_uuid(),org,ref,1,12000,1,120,'payable',now());
 SELECT to_jsonb(p) INTO before_bank FROM app_private.org_payment_profiles p WHERE org_id=org;
 SELECT to_jsonb(p) INTO before_request FROM app_private.referral_payout_requests p WHERE id=rid;
 -- Actual queue SQL against synthetic-only table copies, no real customer result payload.
 CREATE TEMP TABLE finance_profiles AS SELECT * FROM app_private.org_payment_profiles WHERE org_id=org;
 CREATE TEMP TABLE finance_orgs AS SELECT * FROM public.organizations WHERE id=org;
 CREATE TEMP TABLE finance_requests AS SELECT * FROM app_private.referral_payout_requests WHERE id=rid;
 CREATE TEMP TABLE finance_referrers AS SELECT * FROM app_private.referrers WHERE id=ref;
 CREATE TEMP TABLE finance_commissions AS SELECT * FROM app_private.referral_commissions WHERE id=commission;
 original_bank_queue:=pg_get_functiondef('public.cc_payment_profiles_queue(text)'::regprocedure);
 original_payout_queue:=pg_get_functiondef('public.cc_referral_payout_queue(text)'::regprocedure);
 EXECUTE replace(replace(original_bank_queue,'app_private.org_payment_profiles','pg_temp.finance_profiles'),'public.organizations','pg_temp.finance_orgs');
 EXECUTE replace(replace(replace(original_payout_queue,'app_private.referral_payout_requests','pg_temp.finance_requests'),'app_private.referrers','pg_temp.finance_referrers'),'app_private.referral_commissions','pg_temp.finance_commissions');
 claims:=jsonb_build_object('sub',staff,'role','authenticated','session_id',sid);
 PERFORM set_config('request.jwt.claim.sub',staff::text,true); PERFORM set_config('request.jwt.claims',claims::text,true);
 UPDATE auth.users SET banned_until='infinity' WHERE id=staff;
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id=staff;
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 UPDATE auth.users SET deleted_at=NULL WHERE id=staff;
 INSERT INTO app_private.account_deletion_requests(user_id,email,status) VALUES(staff,'audit-staff-finance-'||staff||'@example.invalid','completed');
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 DELETE FROM app_private.account_deletion_requests WHERE user_id=staff;
 FOREACH mode IN ARRAY ARRAY['missing','malformed',wrong_sid::text] LOOP
  PERFORM set_config('request.jwt.claims',(CASE WHEN mode='missing' THEN claims-'session_id' ELSE claims||jsonb_build_object('session_id',mode) END)::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 END LOOP;
 PERFORM set_config('request.jwt.claims',claims::text,true);
 DELETE FROM auth.sessions WHERE id=sid;
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 INSERT INTO auth.sessions(id,user_id,not_after) VALUES(sid,staff,now()-interval '1 minute');
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 UPDATE auth.sessions SET not_after=NULL WHERE id=sid;
 UPDATE app_private.staff_members SET status='suspended' WHERE user_id=staff;
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 UPDATE app_private.staff_members SET status='active' WHERE user_id=staff;
 UPDATE app_private.user_permission_grants SET effect='deny' WHERE user_id=staff;
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 UPDATE app_private.user_permission_grants SET effect='allow' WHERE user_id=staff;
 FOREACH mode IN ARRAY ARRAY['anon','service_role'] LOOP
  PERFORM set_config('request.jwt.claim.sub','',true); PERFORM set_config('request.jwt.claims',jsonb_build_object('role',mode)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',mode); PERFORM pg_temp.staff_finance_denied(org,rid); EXECUTE 'RESET ROLE';
 END LOOP;
 ASSERT (SELECT to_jsonb(p)=before_bank FROM app_private.org_payment_profiles p WHERE org_id=org),'refused caller changed bank';
 ASSERT (SELECT to_jsonb(p)=before_request FROM app_private.referral_payout_requests p WHERE id=rid),'refused caller changed payout';
 PERFORM set_config('request.jwt.claim.sub',staff::text,true); PERFORM set_config('request.jwt.claims',claims::text,true);
 -- View permission alone can read but must not approve.
 DELETE FROM app_private.user_permission_grants WHERE user_id=staff AND permission_key='finance.approve';
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_carrier_payment_profile(org); ASSERT result->>'account_number'='123456789','finance view read broken';
 result:=public.cc_payment_profiles_queue(); ASSERT jsonb_array_length(result)=1 AND result->0->>'org_id'=org::text,'bank queue contract broken';
 result:=public.cc_referral_payout_queue(); ASSERT jsonb_array_length(result)=1 AND result->0->>'id'=rid::text,'payout queue contract broken';
 failed:=false; BEGIN PERFORM public.cc_verify_payment_profile(org,true); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END; ASSERT failed,'viewer approved bank';
 failed:=false; BEGIN PERFORM public.cc_referral_payout_decide(rid,'approve'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END; ASSERT failed,'viewer approved payout';
 EXECUTE 'RESET ROLE'; INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(staff,'finance.approve','allow');
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_verify_payment_profile(org,true); ASSERT result->>'verified'='true','bank approval failed';
 failed:=false; BEGIN PERFORM public.cc_verify_payment_profile(org,false); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'revoke without reason accepted';
 result:=public.cc_verify_payment_profile(org,false,'synthetic reason'); ASSERT result->>'verified'='false','bank revoke failed';
 failed:=false; BEGIN PERFORM public.cc_referral_payout_decide(rid,NULL); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'NULL payout action accepted';
 failed:=false; BEGIN PERFORM public.cc_referral_payout_decide(rid,'paid'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'unapproved payout paid';
 result:=public.cc_referral_payout_decide(rid,'approve'); ASSERT result->>'action'='approve','payout approval failed';
 EXECUTE 'RESET ROLE';
 -- New payable earnings must not be swept into an older approved request.
 INSERT INTO app_private.referral_commissions(id,invoice_id,source_org,referrer_id,level,base_fee,pct,amount,status,payable_at)
 VALUES(extra,gen_random_uuid(),org,ref,1,2500,1,25,'payable',now());
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_referral_payout_decide(rid,'paid'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'larger current balance marked paid';
 EXECUTE 'RESET ROLE';
 ASSERT (SELECT status='approved' FROM app_private.referral_payout_requests WHERE id=rid),'mismatch changed request';
 ASSERT (SELECT count(*)=2 FROM app_private.referral_commissions WHERE referrer_id=ref AND status='payable'),'mismatch changed ledger';
 UPDATE app_private.referral_commissions SET status='accrued' WHERE id=extra;
 UPDATE app_private.referral_commissions SET amount=100 WHERE id=commission;
 EXECUTE 'SET LOCAL ROLE authenticated'; failed:=false; BEGIN PERFORM public.cc_referral_payout_decide(rid,'paid'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'smaller current balance marked paid'; EXECUTE 'RESET ROLE';
 UPDATE app_private.referral_commissions SET amount=120 WHERE id=commission;
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_referral_payout_decide(rid,'paid'); ASSERT result->>'ok'='true' AND result->>'commissions_paid'='1','matching payout failed'; EXECUTE 'RESET ROLE';
 ASSERT (SELECT status='paid' AND paid_by=staff FROM app_private.referral_commissions WHERE id=commission),'exact commission not marked';
 ASSERT (SELECT status='accrued' AND paid_at IS NULL FROM app_private.referral_commissions WHERE id=extra),'unselected commission changed';
 ASSERT (SELECT status='paid' FROM app_private.referral_payout_requests WHERE id=rid),'request not marked paid';
 EXECUTE 'SET LOCAL ROLE authenticated'; failed:=false; BEGIN PERFORM public.cc_referral_payout_decide(rid,'paid'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'repeat paid accepted'; EXECUTE 'RESET ROLE';
 UPDATE app_private.referral_payout_requests SET status='requested',requested_by=staff WHERE id=rid;
 EXECUTE 'SET LOCAL ROLE authenticated'; failed:=false; BEGIN PERFORM public.cc_referral_payout_decide(rid,'approve'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END; ASSERT failed,'self approval accepted'; EXECUTE 'RESET ROLE';
 UPDATE app_private.referral_payout_requests SET requested_by=target WHERE id=rid;
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_referral_payout_decide(rid,'reject','synthetic rejection'); ASSERT result->>'action'='reject','rejection path failed'; EXECUTE 'RESET ROLE';
 EXECUTE original_bank_queue; EXECUTE original_payout_queue;
 ASSERT pg_get_functiondef('public.cc_payment_profiles_queue(text)'::regprocedure)=original_bank_queue,'bank queue source not restored';
 ASSERT pg_get_functiondef('public.cc_referral_payout_queue(text)'::regprocedure)=original_payout_queue,'payout queue source not restored';
 ASSERT NOT EXISTS((SELECT * FROM staff_finance_anon EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM staff_finance_anon)),'anonymous surface changed';
END $tests$;
ROLLBACK;
SELECT 'PASS: staff session/RBAC, bank approvals, exact payout accounting and queue contracts; all synthetic writes and queue substitutions rolled back' result;
