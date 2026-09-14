-- STAGING ONLY. Storage metadata fixture lives ONLY in a temporary table; no Storage mutation/API.
BEGIN; SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE erasure_anon_before AS SELECT p.proname,pg_get_function_identity_arguments(p.oid) args
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- MIGRATION_UNDER_TEST
CREATE TEMP TABLE inventory_storage (LIKE storage.objects INCLUDING DEFAULTS);
CREATE FUNCTION pg_temp.fail_erasure_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('audit.inventory_fail',true)='yes' THEN RAISE EXCEPTION 'synthetic inventory failure' USING ERRCODE='PZ005'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER audit_inventory_fail BEFORE INSERT ON app_private.account_erasure_inventories
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_erasure_inventory();
DO $tests$
DECLARE staff uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); empty_user uuid:=gen_random_uuid(); org uuid;
 rid bigint; empty_rid bigint; addr text:='audit-inventory-'||target||'@example.invalid';
 result jsonb; profile_before jsonb; failed boolean; original_capture text; captures jsonb; cnt integer; role_name text;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (staff,'audit-inventory-staff-'||staff||'@example.invalid','{"role":"driver"}'),
 (target,addr,'{"role":"driver"}'),(empty_user,'audit-inventory-empty-'||empty_user||'@example.invalid','{"role":"driver"}');
 SELECT id INTO STRICT org FROM public.organizations WHERE kind='internal' AND status='active';
 INSERT INTO app_private.staff_members(user_id,status) VALUES(staff,'active');
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(org,staff,'staff','active');
 INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(staff,'carriers.approve','allow');
 INSERT INTO app_private.account_deletion_requests(user_id,email) VALUES(target,addr) RETURNING id INTO rid;
 INSERT INTO app_private.account_deletion_requests(user_id,email) VALUES(empty_user,'audit-inventory-empty-'||empty_user||'@example.invalid') RETURNING id INTO empty_rid;
 INSERT INTO public.documents(carrier_id,type,file_name,file_path) VALUES(target,'w9','synthetic',null);
 INSERT INTO app_private.document_files(owner_type,owner_id,bucket,path,uploaded_by)
 VALUES('trip','synthetic-unrelated-owner','documents','staff-upload/synthetic.txt',target);
 INSERT INTO app_private.agent_profiles(user_id,payout_details) VALUES(target,'{"id_doc":"agent/id.pdf","bank_doc":"agent/bank.pdf"}')
 ON CONFLICT(user_id) DO UPDATE SET payout_details=excluded.payout_details;
 INSERT INTO app_private.lc_onboarding(visitor_key,account_email,docs)
 VALUES('audit'||replace(target::text,'-',''),upper(addr),'[{"path":"chat/document.pdf","type":"insurance"}]');
 SELECT to_jsonb(p) INTO STRICT profile_before FROM public.profiles p WHERE id=target;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  ASSERT NOT has_table_privilege(role_name,'app_private.account_erasure_inventories','SELECT'),'inventory readable';
  ASSERT NOT has_table_privilege(role_name,'app_private.account_erasure_inventories','INSERT'),'inventory writable';
  ASSERT NOT has_function_privilege(role_name,'app_private.capture_account_erasure_inventory(bigint)','execute'),'capture exposed';
 END LOOP;
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='app_private.account_erasure_inventories'::regclass),'RLS missing';
 PERFORM set_config('request.jwt.claim.sub',target::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'complete'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
 ASSERT failed,'nonstaff accepted'; EXECUTE 'RESET ROLE';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.account_erasure_inventories WHERE request_id=rid),'nonstaff created manifest';
 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 -- Actual deployed capture against actual document/agent/onboarding tables.
 PERFORM set_config('audit.inventory_fail','yes',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'complete'); EXCEPTION WHEN SQLSTATE 'PZ005' THEN failed:=true; END;
 EXECUTE 'RESET ROLE'; ASSERT failed,'capture error swallowed';
 ASSERT (SELECT to_jsonb(p)=profile_before FROM public.profiles p WHERE id=target),'capture failure erased profile';
 ASSERT EXISTS(SELECT 1 FROM public.documents WHERE carrier_id=target),'capture failure erased metadata';
 PERFORM set_config('audit.inventory_fail','no',true);
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'code'='ERASURE_REVIEW_REQUIRED' AND result->>'ok'='false','file-bearing deletion completed';
 ASSERT (SELECT status='requested' FROM app_private.account_deletion_requests WHERE id=rid),'request falsely closed';
 ASSERT (SELECT to_jsonb(p)=profile_before FROM public.profiles p WHERE id=target),'blocked attempt erased profile';
 ASSERT EXISTS(SELECT 1 FROM public.documents WHERE carrier_id=target),'blocked attempt erased metadata';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'blocked attempt ran later side effects';
 ASSERT position('chat/document.pdf' in result::text)=0,'path leaked in public response';
 SELECT items INTO captures FROM app_private.account_erasure_inventories WHERE request_id=rid;
 ASSERT jsonb_array_length(captures)=5,'metadata reference count';
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(captures) e WHERE e->>'source'='documents' AND e->>'path' IS NULL),'missing-path reference ignored';
 -- Execute exact capture body with ONLY storage relation redirected to a temporary fixture.
 SELECT pg_get_functiondef('app_private.capture_account_erasure_inventory(bigint)'::regprocedure) INTO original_capture;
 EXECUTE replace(original_capture,'storage.objects','pg_temp.inventory_storage');
 INSERT INTO pg_temp.inventory_storage(id,bucket_id,name,owner_id) VALUES
 (gen_random_uuid(),'documents',target||'/w9/owned.txt',null),
 (gen_random_uuid(),'documents','legacy/owner-id.txt',target::text),
 (gen_random_uuid(),'documents','unrelated/ignore.txt',null);
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='7','storage owner/prefix fixture capture';
 SELECT items INTO captures FROM app_private.account_erasure_inventories WHERE request_id=rid;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(captures) e WHERE e->>'path'='unrelated/ignore.txt'),'unrelated storage captured';
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='7','repeat duplicated evidence';
 UPDATE public.documents SET file_path='changed/new-path.pdf' WHERE carrier_id=target;
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='8','changed metadata not retained as evidence';
 -- Remove synthetic source refs; the saved inventory must keep its earlier evidence.
 DELETE FROM public.documents WHERE carrier_id=target;
 DELETE FROM app_private.document_files WHERE uploaded_by=target;
 UPDATE app_private.agent_profiles SET payout_details='{}' WHERE user_id=target;
 UPDATE app_private.lc_onboarding SET docs='[]' WHERE lower(account_email)=addr;
 DELETE FROM pg_temp.inventory_storage;
 EXECUTE original_capture;
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='8','disappeared references erased saved inventory';
 ASSERT result->>'code'='ERASURE_REVIEW_REQUIRED','disappeared references bypassed review';
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'reject','synthetic review rejection'); EXECUTE 'RESET ROLE';
 ASSERT result->>'status'='rejected','reject branch blocked by inventory';
 ASSERT (SELECT jsonb_array_length(items)=8 FROM app_private.account_erasure_inventories WHERE request_id=rid),'rejection lost inventory';
 -- No known file references retains the prior scoped SQL cleanup behavior (not full erasure proof).
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(empty_rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true' AND result->>'status'='completed','empty-file control broken';
 ASSERT (SELECT items='[]'::jsonb FROM app_private.account_erasure_inventories WHERE request_id=empty_rid),'empty snapshot missing';
 ASSERT has_function_privilege('authenticated','public.cc_account_deletion_process(bigint,text,text)','execute'),'auth grant changed';
 ASSERT NOT EXISTS(
 (SELECT * FROM erasure_anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM erasure_anon_before)),'anon surface changed';
END $tests$;
SELECT 'PASS: private durable inventory, blocked destructive completion, failure rollback, isolated storage ownership, retained changed/disappeared references, reject and no-file controls; all fixtures rolled back' result;
ROLLBACK;
