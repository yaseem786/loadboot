-- STAGING ONLY. Synthetic accounting states; no real payout, account or sender invocation.
BEGIN; SET LOCAL plpgsql.check_asserts=on;
DO $tests$
DECLARE staff uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); internal_org uuid;
 ref uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); result jsonb;
BEGIN
 ASSERT position('assert_payment_session' in pg_get_functiondef('public.cc_referral_payout_decide(uuid,text,text)'::regprocedure))=0,'baseline requires unpatched function';
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(staff,'audit-staff-finance-'||staff||'@example.invalid','{"role":"driver"}'),(target,'audit-staff-finance-'||target||'@example.invalid','{"role":"driver"}');
 SELECT id INTO STRICT internal_org FROM public.organizations WHERE kind='internal' AND status='active';
 INSERT INTO app_private.staff_members(user_id,status) VALUES(staff,'active');
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(internal_org,staff,'staff','active');
 INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(staff,'finance.view','allow'),(staff,'finance.approve','allow');
 INSERT INTO public.organizations(id,owner_user_id,kind,name,is_demo) VALUES(org,target,'carrier','Audit staff finance synthetic',true);
 INSERT INTO app_private.org_payment_profiles(org_id,bank_name,account_title,account_number,routing_number) VALUES(org,'SYNTHETIC','SYNTHETIC','123456789','021000021');
 INSERT INTO app_private.referrers(id,user_id,code) VALUES(ref,target,'audit-staff-'||ref);
 INSERT INTO app_private.referral_payout_requests(id,referrer_id,requested_by,amount,payout_details,status) VALUES(rid,ref,target,120,'{}','approved');
 INSERT INTO app_private.referral_commissions(invoice_id,source_org,referrer_id,level,base_fee,pct,amount,status,payable_at)
 VALUES(gen_random_uuid(),org,ref,1,12000,1,120,'payable',now()),(gen_random_uuid(),org,ref,1,2500,1,25,'payable',now());
 PERFORM set_config('request.jwt.claim.sub',staff::text,true); PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',staff)::text,true);
 UPDATE auth.users SET banned_until='infinity' WHERE id=staff;
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_carrier_payment_profile(org); ASSERT result->>'account_number'='123456789','baseline banned-bank read changed';
 result:=public.cc_referral_payout_decide(rid,'paid'); ASSERT result->>'ok'='true','baseline banned payout mutation changed';
 EXECUTE 'RESET ROLE';
 ASSERT (SELECT sum(amount)=145 FROM app_private.referral_commissions WHERE referrer_id=ref AND status='paid'),'baseline amount sweep changed';
 ASSERT (SELECT amount=120 AND status='paid' FROM app_private.referral_payout_requests WHERE id=rid),'baseline request changed';
END $tests$;
ROLLBACK;
SELECT 'CONFIRMED: banned staff read/mutation and 145 ledger marked paid against 120 request; four assertions plus baseline-source guard; all writes rolled back' result;
