-- STAGING ONLY. Actual deletion/eligibility/enqueue RPCs; claim body uses temporary tables only.
-- Never invoke the real delivery worker or real queue claim in this test.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE deletion_anon_before AS
 SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- MIGRATION_UNDER_TEST
CREATE TEMP TABLE claim_deliveries (LIKE app_private.message_deliveries INCLUDING DEFAULTS);
DO $clone$
DECLARE src text;
BEGIN
 src:=pg_get_functiondef('public.cc_delivery_worker_claim(integer,text)'::regprocedure);
 src:=replace(src,'public.cc_delivery_worker_claim','pg_temp.audit_claim');
 src:=replace(src,'app_private.message_deliveries','pg_temp.claim_deliveries');
 EXECUTE src;
END $clone$;
CREATE FUNCTION pg_temp.audit_cleanup_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF old.email=current_setting('audit.cleanup_email',true) AND
    tg_table_name=current_setting('audit.cleanup_failure_table',true) THEN
  RAISE EXCEPTION 'synthetic cleanup failure' USING ERRCODE='PZ001';
 END IF;
 RETURN old;
END $$;
CREATE TRIGGER audit_cleanup_failure BEFORE DELETE ON app_private.crm_contacts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_cleanup_failure();
CREATE TRIGGER audit_cleanup_failure BEFORE DELETE ON app_private.outreach_contacts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_cleanup_failure();
CREATE FUNCTION pg_temp.audit_suppression_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF new.address=current_setting('audit.cleanup_email',true) AND current_setting('audit.fail_suppression',true)='yes' THEN
  RAISE EXCEPTION 'synthetic suppression failure' USING ERRCODE='PZ003';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER audit_suppression_failure BEFORE INSERT ON app_private.suppressions
 FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_suppression_failure();
DO $tests$
DECLARE staff uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); org uuid; rid bigint;
 email_addr text:='audit-erase-'||target||'@example.invalid'; profile_before jsonb;
 result jsonb; failed boolean; tbl text; unrelated uuid:=gen_random_uuid();
 delivery record; why text; trial_email text; key text; claim_ids uuid[];
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (staff,'audit-erase-staff-'||staff||'@example.invalid','{"role":"driver"}'),
 (target,email_addr,'{"role":"driver"}');
 SELECT id INTO STRICT org FROM public.organizations WHERE kind='internal' AND status='active';
 INSERT INTO app_private.staff_members(user_id,status) VALUES(staff,'active');
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(org,staff,'staff','active');
 INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(staff,'carriers.approve','allow'),(staff,'content.manage','allow');
 INSERT INTO app_private.account_deletion_requests(user_id,email,status) VALUES(target,email_addr,'requested') RETURNING id INTO rid;
 INSERT INTO app_private.crm_contacts(name,email) VALUES('synthetic target',email_addr);
 INSERT INTO app_private.crm_contacts(id,name,email) VALUES(unrelated,'synthetic unrelated','other-'||target||'@example.invalid');
 INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',email_addr,'unsubscribed');
 INSERT INTO public.documents(carrier_id,type,file_name,file_path) VALUES(target,'w9','synthetic.txt',target||'/w9/synthetic.txt');
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
 SELECT 'transactional','email',email_addr,'OUTREACH_carrier_1',st,'audit-suppress-'||target||'-'||st
 FROM unnest(ARRAY['queued','claimed','scheduled','delivered']) st;
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
 VALUES('campaign','email',email_addr,null,'claimed','audit-suppress-'||target||'-campaign'),
 ('transactional','email',email_addr,'account.confirm','queued','audit-suppress-'||target||'-transactional');
 SELECT to_jsonb(p) INTO STRICT profile_before FROM public.profiles p WHERE id=target;
 PERFORM set_config('audit.cleanup_email',email_addr,true);
 PERFORM set_config('request.jwt.claim.sub',target::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'complete'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
 ASSERT failed,'nonstaff caller accepted';
 EXECUTE 'RESET ROLE';
 ASSERT NOT has_function_privilege('anon','public.cc_account_deletion_process(bigint,text,text)','execute'),'anon grant';
 ASSERT has_function_privilege('authenticated','public.cc_account_deletion_process(bigint,text,text)','execute'),'auth grant lost';
 ASSERT has_function_privilege('service_role','public.cc_account_deletion_process(bigint,text,text)','execute'),'service grant lost';
 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 ASSERT public.has_global_permission('carriers.approve'),'staff fixture missing permission';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,null); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END;
 ASSERT failed,'null action accepted';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'invalid'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END;
 ASSERT failed,'unknown action accepted';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(-1,'complete'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END;
 ASSERT failed,'missing request accepted';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'reject',' '); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END;
 ASSERT failed,'blank rejection accepted';
 EXECUTE 'RESET ROLE';
 BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  result:=public.cc_account_deletion_process(rid,'reject','synthetic reason');
  ASSERT result->>'status'='rejected','rejection broken';
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT to_jsonb(p)=profile_before FROM public.profiles p WHERE id=target),'reject mutated profile';
  RAISE EXCEPTION 'rollback rejection subcase' USING ERRCODE='PZ002';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL; END;
 PERFORM set_config('audit.fail_suppression','yes',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false;
 BEGIN PERFORM public.cc_account_deletion_process(rid,'complete'); EXCEPTION WHEN SQLSTATE 'PZ003' THEN failed:=true; END;
 EXECUTE 'RESET ROLE';
 ASSERT failed,'suppression write failure swallowed';
 ASSERT (SELECT status='requested' FROM app_private.account_deletion_requests WHERE id=rid),'suppression failure completed request';
 ASSERT (SELECT to_jsonb(p)=profile_before FROM public.profiles p WHERE id=target),'suppression failure left partial profile erase';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=email_addr),'failed marker survived';
 PERFORM set_config('audit.fail_suppression','no',true);
 FOREACH tbl IN ARRAY ARRAY['crm_contacts','outreach_contacts'] LOOP
  PERFORM set_config('audit.cleanup_failure_table',tbl,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  failed:=false;
  BEGIN PERFORM public.cc_account_deletion_process(rid,'complete');
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN failed:=true; END;
  EXECUTE 'RESET ROLE';
  ASSERT failed,'cleanup error swallowed: '||tbl;
  ASSERT (SELECT status='requested' FROM app_private.account_deletion_requests WHERE id=rid),'request falsely completed';
  ASSERT (SELECT to_jsonb(p)=profile_before FROM public.profiles p WHERE id=target),'profile not rolled back';
  ASSERT EXISTS(SELECT 1 FROM public.documents WHERE carrier_id=target),'document metadata not rolled back';
  ASSERT (SELECT email=email_addr FROM auth.users WHERE id=target),'auth row not rolled back';
  ASSERT EXISTS(SELECT 1 FROM app_private.crm_contacts WHERE email=email_addr),'CRM cleanup not rolled back';
  ASSERT EXISTS(SELECT 1 FROM app_private.outreach_contacts WHERE email=email_addr),'outreach cleanup not rolled back';
  ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=email_addr),'suppression survived failed deletion';
  ASSERT (SELECT status='claimed' FROM app_private.message_deliveries WHERE idempotency_key='audit-suppress-'||target||'-claimed'),'delivery cancellation survived rollback';
 END LOOP;
 PERFORM set_config('audit.cleanup_failure_table','',true);
 -- Missing request email cannot select an unrelated/blank marketing record.
 BEGIN
  UPDATE app_private.account_deletion_requests SET email=null WHERE id=rid;
  EXECUTE 'SET LOCAL ROLE authenticated';
  result:=public.cc_account_deletion_process(rid,'complete');
  EXECUTE 'RESET ROLE';
  ASSERT result->'erased'->>'crm_contacts'='0','null email CRM match';
  ASSERT result->'erased'->>'outreach_contacts'='0','null email outreach match';
  RAISE EXCEPTION 'rollback null-email subcase' USING ERRCODE='PZ002';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL; END;
 BEGIN
  INSERT INTO app_private.suppressions(channel,address,reason) VALUES('email',email_addr,'bounced');
  EXECUTE 'SET LOCAL ROLE authenticated';
  result:=public.cc_account_deletion_process(rid,'complete');
  EXECUTE 'RESET ROLE';
  ASSERT result->>'status'='completed','prior suppression blocks deletion';
  ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE address=email_addr),'duplicate suppression inserted';
  ASSERT (SELECT reason='bounced' FROM app_private.suppressions WHERE address=email_addr),'stronger suppression overwritten';
  RAISE EXCEPTION 'rollback stronger-marker subcase' USING ERRCODE='PZ002';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL; END;
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_account_deletion_process(rid,'complete');
 EXECUTE 'RESET ROLE';
 ASSERT result->>'status'='completed','successful cleanup cannot complete';
 ASSERT result->'erased'->>'crm_contacts'='1','CRM deletion count';
 ASSERT result->'erased'->>'outreach_contacts'='1','outreach deletion count';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.crm_contacts WHERE email=email_addr),'CRM retained';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.outreach_contacts WHERE email=email_addr),'outreach retained';
 ASSERT EXISTS(SELECT 1 FROM app_private.crm_contacts WHERE id=unrelated),'unrelated contact erased';
 ASSERT (SELECT status='completed' FROM app_private.account_deletion_requests WHERE id=rid),'completion not persisted';
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'complete'); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END;
 ASSERT failed,'completed request replay accepted';
 EXECUTE 'RESET ROLE';
 -- Durable suppression survives contact deletion and re-import.
 ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE channel='email' AND address=email_addr AND reason='unsubscribed'),'durable marker missing';
 ASSERT (SELECT count(*)=4 FROM app_private.message_deliveries WHERE recipient_email=email_addr AND status='unsubscribed'),'pending marketing rows not cancelled';
 ASSERT (SELECT status='queued' FROM app_private.message_deliveries WHERE idempotency_key='audit-suppress-'||target||'-transactional'),'transactional row cancelled';
 ASSERT (SELECT status='delivered' FROM app_private.message_deliveries WHERE idempotency_key='audit-suppress-'||target||'-delivered'),'historical delivery rewritten';
 INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',email_addr,'active');
 FOR tbl IN SELECT unnest(ARRAY['outreach.carrier.1','Outreach-carrier-1','OUTREACH_carrier_1']) LOOP
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('transactional','email','  '||upper(email_addr)||'  ',tbl,'claimed','audit-suppress-'||target||'-'||tbl) RETURNING id INTO unrelated;
  EXECUTE 'SET LOCAL ROLE service_role';
  ASSERT NOT public.cc_delivery_worker_marketing_allowed(unrelated),'re-import bypassed eligibility: '||tbl;
  EXECUTE 'RESET ROLE';
 END LOOP;
 UPDATE app_private.outreach_contacts SET status='completed' WHERE email=email_addr;
 ASSERT NOT public.cc_delivery_worker_marketing_allowed(unrelated),'reactivation bypassed opt-out';
 -- Unsuppressed campaign with null template remains allowed, no contact prerequisite.
 trial_email:='control-'||target||'@example.invalid';
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
 VALUES('campaign','email',trial_email,null,'claimed','audit-suppress-'||target||'-control') RETURNING id INTO unrelated;
 ASSERT public.cc_delivery_worker_marketing_allowed(unrelated),'null-template campaign control denied';
 ASSERT NOT public.cc_delivery_worker_marketing_allowed(gen_random_uuid()),'unknown delivery allowed';
 INSERT INTO app_private.suppressions(channel,address,reason) VALUES('email',trial_email,'unsubscribed');
 ASSERT NOT public.cc_delivery_worker_marketing_allowed(unrelated),'opt-out after claim not enforced';
 DELETE FROM app_private.suppressions WHERE address=trial_email;
 INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',trial_email,'active');
 UPDATE app_private.message_deliveries SET source='transactional',template_key='outreach-carrier-1' WHERE id=unrelated;
 ASSERT public.cc_delivery_worker_marketing_allowed(unrelated),'eligible outreach control denied';

 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_delivery_worker_marketing_allowed(unrelated); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
 ASSERT failed,'authenticated caller can invoke service-only guard';
 result:=public.cc_enqueue_transactional('email',email_addr,'account.confirm','Synthetic','audit-suppress-'||target||'-enqueue');
 ASSERT (result->>'queued')::boolean,'transactional opt-out exemption broken';
 result:=public.cc_enqueue_transactional('email',email_addr,'outreach-carrier-1','Synthetic','audit-suppress-'||target||'-marketing');
 ASSERT result->>'reason'='suppressed','marketing disguised through transactional enqueue';
 EXECUTE 'RESET ROLE';
 PERFORM app_private.sys_email(email_addr,'account.confirm','Synthetic','Synthetic',null,'audit-suppress-'||target||'-sys');
 ASSERT EXISTS(SELECT 1 FROM app_private.message_deliveries WHERE idempotency_key='audit-suppress-'||target||'-sys'),'system transactional mail blocked';
 PERFORM app_private.sys_email(email_addr,'OUTREACH_carrier_1','Synthetic','Synthetic',null,'audit-suppress-'||target||'-sys-marketing');
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.message_deliveries WHERE idempotency_key='audit-suppress-'||target||'-sys-marketing'),'system marketing bypass';
 -- Explicit/global suppressions remain stronger than an outreach opt-out.
 FOREACH why IN ARRAY ARRAY['bounced','complained','manual',NULL] LOOP
  trial_email:='global-'||coalesce(why,'null')||'-'||target||'@example.invalid';
  INSERT INTO app_private.suppressions(channel,address,reason) VALUES('email',trial_email,why);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result:=public.cc_enqueue_transactional('email',trial_email,'account.confirm','Synthetic','audit-suppress-'||trial_email);
  ASSERT result->>'reason'='suppressed','strong suppression lost at transactional enqueue';
  EXECUTE 'RESET ROLE';
  PERFORM app_private.sys_email(trial_email,'account.confirm','Synthetic','Synthetic',null,'audit-suppress-sys-'||trial_email);
  ASSERT NOT EXISTS(SELECT 1 FROM app_private.message_deliveries WHERE idempotency_key='audit-suppress-sys-'||trial_email),'strong suppression lost at sys_email';
  INSERT INTO pg_temp.claim_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('transactional','email',trial_email,'account.confirm','queued','global-'||trial_email);
 END LOOP;
 INSERT INTO app_private.suppressions(channel,address,reason) VALUES('sms','+15550000000','unsubscribed');
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_enqueue_transactional('sms','+15550000000','account.confirm','Synthetic','audit-suppress-sms-'||target);
 ASSERT result->>'reason'='suppressed','SMS unsubscribe weakened';
 EXECUTE 'RESET ROLE';
 INSERT INTO pg_temp.claim_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
 VALUES('transactional','email',email_addr,'OUTREACH_carrier_1','queued','claim-marketing'),
 ('campaign','email',email_addr,null,'queued','claim-campaign'),
 ('transactional','email',email_addr,'account.confirm','queued','claim-transactional'),
 ('campaign','email','control-'||target||'@example.invalid',null,'queued','claim-control');
 SELECT array_agg(id) INTO claim_ids FROM pg_temp.audit_claim(50,'email');
 ASSERT cardinality(claim_ids)=2,'claim must return only two positive controls';
 ASSERT (SELECT status='claimed' FROM pg_temp.claim_deliveries WHERE idempotency_key='claim-transactional'),'transactional claim blocked';
 ASSERT (SELECT status='claimed' FROM pg_temp.claim_deliveries WHERE idempotency_key='claim-control'),'normal campaign claim blocked';
 ASSERT (SELECT count(*)=6 FROM pg_temp.claim_deliveries WHERE status='unsubscribed'),'suppressed rows still queued/claimed';
 ASSERT NOT has_function_privilege('anon','public.cc_delivery_worker_marketing_allowed(uuid)','execute'),'new anon surface';
 ASSERT NOT EXISTS(
 (SELECT * FROM deletion_anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM deletion_anon_before)
 ),'anon function names changed';
END $tests$;
SELECT 'PASS: deletion suppression survives re-import, cancels pending marketing, preserves transactional mail and stronger/SMS suppression; isolated current-source claim contract; all fixtures rolled back' result;
ROLLBACK;
