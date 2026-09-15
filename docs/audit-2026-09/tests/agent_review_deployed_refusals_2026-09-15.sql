BEGIN;

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
SELECT 'PASS: 3 deployed missing-identity refusals; no customer data' result;
