-- STAGING ONLY: synthetic records and injected failures; entire transaction rolls back.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE deletion_anon_before AS
 SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- MIGRATION_UNDER_TEST
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
DO $tests$
DECLARE staff uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); org uuid; rid bigint;
 email_addr text:='audit-erase-'||target||'@example.invalid'; profile_before jsonb;
 result jsonb; failed boolean; tbl text; unrelated uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (staff,'audit-erase-staff-'||staff||'@example.invalid','{"role":"driver"}'),
 (target,email_addr,'{"role":"driver"}');
 SELECT id INTO STRICT org FROM public.organizations WHERE kind='internal' AND status='active';
 INSERT INTO app_private.staff_members(user_id,status) VALUES(staff,'active');
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(org,staff,'staff','active');
 INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(staff,'carriers.approve','allow');
 INSERT INTO app_private.account_deletion_requests(user_id,email,status) VALUES(target,email_addr,'requested') RETURNING id INTO rid;
 INSERT INTO app_private.crm_contacts(name,email) VALUES('synthetic target',email_addr);
 INSERT INTO app_private.crm_contacts(id,name,email) VALUES(unrelated,'synthetic unrelated','other-'||target||'@example.invalid');
 INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',email_addr,'unsubscribed');
 INSERT INTO public.documents(carrier_id,type,file_name,file_path) VALUES(target,'w9','synthetic.txt',target||'/w9/synthetic.txt');
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

 PERFORM set_config('audit.cleanup_failure_table','crm_contacts',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.cc_account_deletion_process(rid,'complete');
 EXECUTE 'RESET ROLE';
 ASSERT result->>'status'='completed','Expected historical bug was not reproduced';
 ASSERT EXISTS(SELECT 1 FROM app_private.crm_contacts WHERE email=email_addr),'Expected CRM residue absent';
 ASSERT EXISTS(SELECT 1 FROM app_private.outreach_contacts WHERE email=email_addr),'Expected outreach residue absent';
END $tests$;
SELECT 'CONFIRMED: old source reported completed while injected CRM failure retained both marketing records; rollback only' result;
ROLLBACK;
