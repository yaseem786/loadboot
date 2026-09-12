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

