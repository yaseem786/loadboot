-- Staging-first; preserve each environment's current payout center behavior.
-- One existing comment differs in prod. Both observed hashes are explicitly allowed.
DO $patch$
DECLARE item record; current_source text; old_acl text; patched_source text;
BEGIN
 IF md5(pg_get_functiondef('app_private.assert_payment_session()'::regprocedure)) IS DISTINCT FROM '18344c1e6ac6a2b76e2dae5ee7659334' THEN RAISE EXCEPTION 'Session helper missing or changed'; END IF;
 FOR item IN SELECT * FROM (VALUES
  ('public.agent_payout_center()',ARRAY['1636d22e583503f03b27397d357d3ad1','d66f2db1a0bb3adad43dc720bedeed40']),
  ('public.agent_request_payout()',ARRAY['004edd969fe466a507386af5d1190b8d']),
  ('public.cc_my_payout_requests()',ARRAY['c81543b69d0fbfa7b067ed5c836f2d13']),
  ('public.cc_referral_request_payout(jsonb)',ARRAY['5e3ae9b903ab33888f5b42a81bac72b5'])) AS v(signature,expected_hashes) LOOP
  SELECT pg_get_functiondef(p.oid),p.proacl::text INTO STRICT current_source,old_acl
    FROM pg_proc p WHERE p.oid=item.signature::regprocedure;
  IF NOT (md5(current_source)=ANY(item.expected_hashes)) THEN RAISE EXCEPTION 'Source drift: %',item.signature; END IF;
  IF (length(current_source)-length(replace(current_source,E'\nbegin\n','')))/length(E'\nbegin\n') <> 1 THEN RAISE EXCEPTION 'Ambiguous body anchor: %',item.signature; END IF;
  patched_source:=replace(current_source,E'\nbegin\n',E'\nbegin\n  perform app_private.assert_payment_session();\n');
  EXECUTE patched_source;
  IF (SELECT proacl::text FROM pg_proc WHERE oid=item.signature::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL changed: %',item.signature; END IF;
 END LOOP;
END $patch$;
