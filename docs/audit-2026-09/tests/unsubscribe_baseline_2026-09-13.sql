BEGIN; SET LOCAL plpgsql.check_asserts=on;
DO $baseline$
DECLARE addr text:='audit-unsub-baseline-'||gen_random_uuid()||'@example.invalid'; tok text; result jsonb; token uuid; id1 uuid;
BEGIN
 tok:=app_private.outreach_unsub_token(addr); ASSERT tok IS NOT NULL,'No staging signing config';
 EXECUTE 'SET LOCAL ROLE anon';
 result:=public.outreach_unsubscribe(addr,tok); EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true','Expected old footer success';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'Old footer already durable';
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
 VALUES('transactional','email',addr,'account.confirm','delivered','audit-unsub-baseline-'||gen_random_uuid()) RETURNING id,correlation_id INTO id1,token;
 EXECUTE 'SET LOCAL ROLE service_role';result:=public.cc_delivery_worker_unsubscribe(token);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true','Old worker failed';
 ASSERT (SELECT status='unsubscribed' FROM app_private.message_deliveries WHERE id=id1),'Expected old operational-history rewrite absent';
END $baseline$;
SELECT 'CONFIRMED: old no-contact footer had no durable marker and old token path rewrote delivered operational history; all writes roll back' result;
ROLLBACK;
