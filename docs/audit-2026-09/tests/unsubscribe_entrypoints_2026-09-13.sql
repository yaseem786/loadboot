-- STAGING ONLY. No real recipients, worker invocation or provider sends. ROLLBACK all rows.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE unsub_anon_before AS
 SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
-- MIGRATION_UNDER_TEST
CREATE FUNCTION pg_temp.unsub_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF new.address=current_setting('audit.unsub_email',true) AND current_setting('audit.unsub_fail',true)='yes' THEN
  RAISE EXCEPTION 'synthetic opt-out failure' USING ERRCODE='PZ004';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER audit_unsub_failure BEFORE INSERT ON app_private.suppressions
 FOR EACH ROW EXECUTE FUNCTION pg_temp.unsub_injected_failure();
DO $tests$
DECLARE path text; addr text; tok text; correlation uuid; rid uuid; result jsonb; failed boolean; original_helper text; counts int; why text;
BEGIN
 ASSERT has_function_privilege('anon','public.outreach_unsubscribe(text,text)','execute'),'public link lost';
 ASSERT NOT has_function_privilege('anon','public.cc_delivery_worker_unsubscribe(uuid)','execute'),'worker anon grant';
 ASSERT NOT has_function_privilege('authenticated','public.cc_delivery_worker_unsubscribe(uuid)','execute'),'worker authenticated grant';
 ASSERT has_function_privilege('service_role','public.cc_delivery_worker_unsubscribe(uuid)','execute'),'worker service grant lost';
 EXECUTE 'SET LOCAL ROLE anon';
 result:=public.outreach_unsubscribe(null,null); ASSERT result->>'ok'='false','null accepted';
 result:=public.outreach_unsubscribe('not-an-email','invalid'); ASSERT result->>'ok'='false','malformed accepted';
 failed:=false; BEGIN PERFORM public.cc_delivery_worker_unsubscribe(gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
 ASSERT failed,'anonymous worker callable';
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE service_role';
 result:=public.cc_delivery_worker_unsubscribe(gen_random_uuid()); ASSERT result->>'ok'='false','unknown token accepted';
 result:=public.cc_delivery_worker_unsubscribe(null); ASSERT result->>'ok'='false','null worker token accepted';
 EXECUTE 'RESET ROLE';
 FOREACH path IN ARRAY ARRAY['footer','delivery-token'] LOOP
  addr:='audit-unsub-'||gen_random_uuid()||'@example.invalid';
  tok:=app_private.outreach_unsub_token(addr);
  ASSERT tok IS NOT NULL AND tok<>'','staging secret unavailable; do not invent one';
  PERFORM set_config('audit.unsub_email',addr,true);
  INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',addr,'active');
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  SELECT 'transactional','email',' '||upper(addr)||' ','OUTREACH_carrier_1',st,'audit-unsub-'||addr||'-'||st
  FROM unnest(ARRAY['queued','claimed','scheduled','delivered']) st;
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('campaign','email',addr,null,'scheduled','audit-unsub-'||addr||'-campaign'),
        ('transactional','email',addr,'account.confirm','queued','audit-unsub-'||addr||'-txn');
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('transactional','email',addr,'account.confirm','delivered','audit-unsub-'||addr||'-old-operational') RETURNING correlation_id,id INTO correlation,rid;
  EXECUTE 'SET LOCAL ROLE anon';
  result:=public.outreach_unsubscribe(addr,'bad-token'); ASSERT result->>'ok'='false','wrong signature accepted';
  result:=public.outreach_unsubscribe(addr,null); ASSERT result->>'ok'='false','missing signature accepted';
  result:=public.outreach_unsubscribe(addr,''); ASSERT result->>'ok'='false','empty signature accepted';
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT status='active' FROM app_private.outreach_contacts WHERE email=addr),'invalid link changed contact';
  ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'invalid link created suppression';
  -- No secret/value is altered: simulate unavailable verifier result transactionally.
  SELECT pg_get_functiondef('app_private.outreach_unsub_token(text)'::regprocedure) INTO original_helper;
  EXECUTE 'CREATE OR REPLACE FUNCTION app_private.outreach_unsub_token(p_email text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''app_private, public'' AS ''select null::text''';
  EXECUTE 'SET LOCAL ROLE anon';
  result:=public.outreach_unsubscribe(addr,null); ASSERT result->>'ok'='false','NULL verifier + NULL token accepted';
  result:=public.outreach_unsubscribe(addr,tok); ASSERT result->>'ok'='false','unavailable verifier accepted';
  EXECUTE 'RESET ROLE';
  EXECUTE original_helper;
  PERFORM set_config('audit.unsub_fail','yes',true);
  failed:=false;
  IF path='footer' THEN
   EXECUTE 'SET LOCAL ROLE anon';
   BEGIN PERFORM public.outreach_unsubscribe(addr,tok); EXCEPTION WHEN SQLSTATE 'PZ004' THEN failed:=true; END;
  ELSE
   EXECUTE 'SET LOCAL ROLE service_role';
   BEGIN PERFORM public.cc_delivery_worker_unsubscribe(correlation); EXCEPTION WHEN SQLSTATE 'PZ004' THEN failed:=true; END;
  END IF;
  EXECUTE 'RESET ROLE';
  ASSERT failed,'suppression failure swallowed';
  ASSERT (SELECT status='active' FROM app_private.outreach_contacts WHERE email=addr),'failed unsubscribe changed contact';
  ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'failed suppression persisted';
  ASSERT (SELECT status='queued' FROM app_private.message_deliveries WHERE idempotency_key='audit-unsub-'||addr||'-queued'),'failed unsubscribe changed delivery';
  PERFORM set_config('audit.unsub_fail','no',true);
  IF path='footer' THEN
   EXECUTE 'SET LOCAL ROLE anon'; result:=public.outreach_unsubscribe(' '||upper(addr)||' ',tok);
  ELSE
   EXECUTE 'SET LOCAL ROLE service_role'; result:=public.cc_delivery_worker_unsubscribe(correlation);
  END IF;
  EXECUTE 'RESET ROLE';
  ASSERT result->>'ok'='true' AND result->>'scope'='marketing','valid opt-out failed';
  ASSERT (SELECT status='unsubscribed' FROM app_private.outreach_contacts WHERE email=addr),'contact still active';
  ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE address=addr AND reason='unsubscribed'),'durable suppression missing';
  ASSERT (SELECT count(*)=4 FROM app_private.message_deliveries WHERE lower(btrim(recipient_email))=addr AND status='unsubscribed'),'pending marketing not cancelled';
  ASSERT (SELECT status='delivered' FROM app_private.message_deliveries WHERE idempotency_key='audit-unsub-'||addr||'-delivered'),'delivered marketing history overwritten';
  ASSERT (SELECT status='delivered' FROM app_private.message_deliveries WHERE id=rid),'old operational token row rewritten';
  ASSERT (SELECT status='queued' FROM app_private.message_deliveries WHERE idempotency_key='audit-unsub-'||addr||'-txn'),'ordinary transaction cancelled';
  DELETE FROM app_private.outreach_contacts WHERE email=addr;
  IF path='footer' THEN
   EXECUTE 'SET LOCAL ROLE anon'; result:=public.outreach_unsubscribe(addr,tok);
  ELSE
   EXECUTE 'SET LOCAL ROLE service_role'; result:=public.cc_delivery_worker_unsubscribe(correlation);
  END IF;
  EXECUTE 'RESET ROLE';
  ASSERT result->>'ok'='true','repeated opt-out failed after contact deletion';
  ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE address=addr),'duplicate suppression on repeat';
  INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',addr,'active');
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('transactional','email',addr,'outreach.carrier.1','claimed','audit-unsub-'||addr||'-reimport') RETURNING id INTO rid;
  ASSERT NOT public.cc_delivery_worker_marketing_allowed(rid),'reimport bypassed suppression';
  FOR why IN SELECT unnest(ARRAY['bounced','complained','manual']) LOOP
   UPDATE app_private.suppressions SET reason=why WHERE address=addr;
   IF path='footer' THEN
    EXECUTE 'SET LOCAL ROLE anon'; result:=public.outreach_unsubscribe(addr,tok);
   ELSE
    EXECUTE 'SET LOCAL ROLE service_role'; result:=public.cc_delivery_worker_unsubscribe(correlation);
   END IF;
   EXECUTE 'RESET ROLE';
   ASSERT result->>'ok'='true','stronger marker rejects unsubscribe';
   ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE address=addr AND reason=why),'stronger marker overwritten';
  END LOOP;
 END LOOP;
 -- No-contact footer remains a durable opt-out, not a no-op.
 addr:='audit-unsub-'||gen_random_uuid()||'@example.invalid';tok:=app_private.outreach_unsub_token(addr);
 EXECUTE 'SET LOCAL ROLE anon';result:=public.outreach_unsubscribe(addr,tok);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true','no-contact valid link failed';
 ASSERT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'no-contact opt-out lost';
 -- SMS remains channel-specific; unsupported / malformed records cause no success.
 INSERT INTO app_private.message_deliveries(source,channel,recipient_phone,status,idempotency_key)
 VALUES('transactional','sms','+15551112222','queued','audit-unsub-sms-'||gen_random_uuid()) RETURNING correlation_id,id INTO correlation,rid;
 EXECUTE 'SET LOCAL ROLE service_role';result:=public.cc_delivery_worker_unsubscribe(correlation);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true' AND result->>'channel'='sms','SMS unsubscribe failed';
 ASSERT EXISTS(SELECT 1 FROM app_private.suppressions WHERE channel='sms' AND address='+15551112222'),'SMS marker missing';
 ASSERT (SELECT status='unsubscribed' FROM app_private.message_deliveries WHERE id=rid),'SMS pending row not cancelled';
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,status,idempotency_key)
 VALUES('transactional','push',addr,'queued','audit-unsub-push-'||gen_random_uuid()) RETURNING correlation_id INTO correlation;
 EXECUTE 'SET LOCAL ROLE service_role';result:=public.cc_delivery_worker_unsubscribe(correlation);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='false','unsupported channel accepted';
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,status,idempotency_key)
 VALUES('transactional','email',' ','queued','audit-unsub-invalid-'||gen_random_uuid()) RETURNING correlation_id INTO correlation;
 EXECUTE 'SET LOCAL ROLE service_role';result:=public.cc_delivery_worker_unsubscribe(correlation);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='false','empty email accepted';
 ASSERT NOT EXISTS(
 (SELECT * FROM unsub_anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM unsub_anon_before)), 'anon surface changed';
END $tests$;
SELECT 'PASS: footer and delivery-token durable unsubscribe, transactional/history preservation, validation/failure rollback, stronger reasons, re-import and SMS; transaction rolled back' result;
ROLLBACK;
