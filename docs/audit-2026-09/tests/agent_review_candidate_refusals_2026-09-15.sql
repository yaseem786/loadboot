BEGIN;
-- Preserve environment-specific notification text; do not call these RPCs here.
DO $patch$
DECLARE item record; original text; patched text; old_acl text;
BEGIN
 IF md5(pg_get_functiondef('app_private.assert_payment_session()'::regprocedure)) IS DISTINCT FROM '18344c1e6ac6a2b76e2dae5ee7659334' THEN RAISE EXCEPTION 'Session helper drift'; END IF;
 FOR item IN SELECT * FROM (VALUES
 ('public.cc_agent_payout_approve_method(uuid,text)',ARRAY['a5fed6efd0f50e1a7318362985d5f49b']),
 ('public.cc_agent_payout_request_details(uuid,text[],text)',ARRAY['661d22b615beecb523efd64a07930c32']),
 ('public.cc_agent_payout_verify(uuid,boolean,text)',ARRAY['4f29c965c80615fc45b7941b2fc3440a','fdcfb71d654ea07e77d223df997ffb7b'])
 ) v(signature,hashes) LOOP
  SELECT pg_get_functiondef(oid),proacl::text INTO STRICT original,old_acl FROM pg_proc WHERE oid=item.signature::regprocedure;
  IF NOT md5(original)=ANY(item.hashes) THEN RAISE EXCEPTION 'Source drift: %',item.signature; END IF;
  IF (length(original)-length(replace(original,E'\nbegin\n','')))/length(E'\nbegin\n')<>1 THEN RAISE EXCEPTION 'Body anchor drift'; END IF;
  patched:=replace(original,E'\nbegin\n',E'\nbegin\n  perform app_private.assert_payment_session();\n');
  IF item.signature='public.cc_agent_payout_verify(uuid,boolean,text)' THEN
   IF (length(patched)-length(replace(patched,'  if not p_ok and','')))/length('  if not p_ok and')<>1 THEN RAISE EXCEPTION 'Decision anchor drift'; END IF;
   patched:=replace(patched,'  if not p_ok and',E'  if p_ok is null then raise exception ''an explicit approve or reject decision is required'' using errcode=''22023''; end if;\n  if not p_ok and');
  END IF;
  EXECUTE patched;
  IF (SELECT proacl::text FROM pg_proc WHERE oid=item.signature::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL drift'; END IF;
 END LOOP;
END $patch$;

SET LOCAL plpgsql.check_asserts=on;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE stmt text; refused boolean;
BEGIN
 FOREACH stmt IN ARRAY ARRAY[
 'select public.cc_agent_payout_approve_method(NULL::uuid,NULL::text)',
 'select public.cc_agent_payout_request_details(NULL::uuid,ARRAY[''account_title''],NULL::text)',
 'select public.cc_agent_payout_verify(NULL::uuid,true,NULL::text)'] LOOP
  refused:=false;
  BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
  ASSERT refused,'Missing identity did not fail closed';
 END LOOP;
END $test$;
RESET ROLE;

ROLLBACK;
SELECT 'PASS: 3 actual RPC missing-identity refusals; migration rolled back' result;
