BEGIN; SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE anon_before AS SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- Restore only the exact pre-fix ACLs after explicit rollback authorization.
-- ACL-only hardening. Preserve dispatcher bodies and signed-in/service grants.
DO $guard$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES ('public.cc_dispatcher_test_invite(uuid,integer,integer)','76cf69ce9f899a8be5e760d7ef419557'),
('public.cc_dispatcher_test_review(uuid)','26fcfd1a73a439d3efb116264763ec4c'),
('public.cc_dispatcher_test_score(uuid,jsonb,text,text)','ceeb414433d14f42a45e38a952abc18b'),
('public.dispatcher_test_my()','1b909114a66dc5aadc3c6b22849e4267'),
('public.dispatcher_test_save(uuid,text,integer,integer)','df6c83d862e6b442f414e0c33b028242'),
('public.dispatcher_test_start()','4dfa2307e356905c3cf626293bf23128'),
('public.dispatcher_test_submit(jsonb)','0c4be7edbb4adc5e0abae6d6592012f6')) v(sig,hash) LOOP
  IF to_regprocedure(r.sig) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.sig))) IS DISTINCT FROM r.hash THEN RAISE EXCEPTION 'Dispatcher source drift: %',r.sig; END IF;
  IF NOT has_function_privilege('authenticated',to_regprocedure(r.sig),'execute') OR NOT has_function_privilege('service_role',to_regprocedure(r.sig),'execute') THEN RAISE EXCEPTION 'Expected signed-in grants missing: %',r.sig; END IF;
 END LOOP;
END $guard$;
GRANT EXECUTE ON FUNCTION public.cc_dispatcher_test_invite(uuid,integer,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cc_dispatcher_test_review(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cc_dispatcher_test_score(uuid,jsonb,text,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatcher_test_my() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatcher_test_save(uuid,text,integer,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatcher_test_start() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatcher_test_submit(jsonb) TO PUBLIC, anon;

-- ACL-only hardening. Preserve dispatcher bodies and signed-in/service grants.
DO $guard$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES ('public.cc_dispatcher_test_invite(uuid,integer,integer)','76cf69ce9f899a8be5e760d7ef419557'),
('public.cc_dispatcher_test_review(uuid)','26fcfd1a73a439d3efb116264763ec4c'),
('public.cc_dispatcher_test_score(uuid,jsonb,text,text)','ceeb414433d14f42a45e38a952abc18b'),
('public.dispatcher_test_my()','1b909114a66dc5aadc3c6b22849e4267'),
('public.dispatcher_test_save(uuid,text,integer,integer)','df6c83d862e6b442f414e0c33b028242'),
('public.dispatcher_test_start()','4dfa2307e356905c3cf626293bf23128'),
('public.dispatcher_test_submit(jsonb)','0c4be7edbb4adc5e0abae6d6592012f6')) v(sig,hash) LOOP
  IF to_regprocedure(r.sig) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.sig))) IS DISTINCT FROM r.hash THEN RAISE EXCEPTION 'Dispatcher source drift: %',r.sig; END IF;
  IF NOT has_function_privilege('authenticated',to_regprocedure(r.sig),'execute') OR NOT has_function_privilege('service_role',to_regprocedure(r.sig),'execute') THEN RAISE EXCEPTION 'Expected signed-in grants missing: %',r.sig; END IF;
 END LOOP;
END $guard$;
REVOKE EXECUTE ON FUNCTION public.cc_dispatcher_test_invite(uuid,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cc_dispatcher_test_review(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cc_dispatcher_test_score(uuid,jsonb,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dispatcher_test_my() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dispatcher_test_save(uuid,text,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dispatcher_test_start() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dispatcher_test_submit(jsonb) FROM PUBLIC, anon;

DO $after$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES ('public.cc_dispatcher_test_invite(uuid,integer,integer)','76cf69ce9f899a8be5e760d7ef419557'),
('public.cc_dispatcher_test_review(uuid)','26fcfd1a73a439d3efb116264763ec4c'),
('public.cc_dispatcher_test_score(uuid,jsonb,text,text)','ceeb414433d14f42a45e38a952abc18b'),
('public.dispatcher_test_my()','1b909114a66dc5aadc3c6b22849e4267'),
('public.dispatcher_test_save(uuid,text,integer,integer)','df6c83d862e6b442f414e0c33b028242'),
('public.dispatcher_test_start()','4dfa2307e356905c3cf626293bf23128'),
('public.dispatcher_test_submit(jsonb)','0c4be7edbb4adc5e0abae6d6592012f6')) v(sig,hash) LOOP
  ASSERT md5(pg_get_functiondef(to_regprocedure(r.sig)))=r.hash,'Body changed';
  ASSERT NOT has_function_privilege('anon',to_regprocedure(r.sig),'execute'),'Anon still allowed';
  ASSERT has_function_privilege('authenticated',to_regprocedure(r.sig),'execute'),'Authenticated grant lost';
  ASSERT has_function_privilege('service_role',to_regprocedure(r.sig),'execute'),'Service grant lost';
 END LOOP;
 ASSERT NOT EXISTS (
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM anon_before)
 UNION ALL
 (SELECT * FROM anon_before WHERE proname NOT IN ('cc_dispatcher_test_invite','cc_dispatcher_test_review','cc_dispatcher_test_score','dispatcher_test_my','dispatcher_test_save','dispatcher_test_start','dispatcher_test_submit') EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute'))
 ),'Unexpected anon name change';
END $after$;
SET LOCAL ROLE anon;
DO $refused$ BEGIN
 BEGIN PERFORM public.dispatcher_test_my(); RAISE EXCEPTION 'Unexpected anonymous success'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.cc_dispatcher_test_review(null); RAISE EXCEPTION 'Unexpected anonymous staff success'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $refused$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',gen_random_uuid()::text,true),set_config('request.jwt.claims','{"role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $allowed$ BEGIN
 ASSERT public.dispatcher_test_my()->>'state'='none','Signed-in caller cannot reach own empty test state';
 ASSERT public.cc_dispatcher_test_review(null)->>'error'='not authorized','Nonstaff caller accepted';
END $allowed$;
RESET ROLE;
SELECT 'PASS: deployed rollback/reapply rehearsal; seven ACLs narrowed; bodies and auth/service grants preserved; exact surface diff; authenticated empty-state and nonstaff checks; transaction rolled back' result;
ROLLBACK;

