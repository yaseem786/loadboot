-- Restore only the four payout wrappers. Keep the shared session helper and bank guards.
DO $rollback$
DECLARE item record; current_source text; restored_source text; old_acl text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.agent_payout_center()',ARRAY['1636d22e583503f03b27397d357d3ad1','d66f2db1a0bb3adad43dc720bedeed40']),
  ('public.agent_request_payout()',ARRAY['004edd969fe466a507386af5d1190b8d']),
  ('public.cc_my_payout_requests()',ARRAY['c81543b69d0fbfa7b067ed5c836f2d13']),
  ('public.cc_referral_request_payout(jsonb)',ARRAY['5e3ae9b903ab33888f5b42a81bac72b5'])) AS v(signature,expected_original_hashes) LOOP
 SELECT pg_get_functiondef(p.oid),p.proacl::text INTO STRICT current_source,old_acl FROM pg_proc p WHERE p.oid=item.signature::regprocedure;
 restored_source:=replace(current_source,E'  perform app_private.assert_payment_session();\n','');
 IF current_source=restored_source OR NOT(md5(restored_source)=ANY(item.expected_original_hashes)) THEN RAISE EXCEPTION 'Rollback source drift: %',item.signature; END IF;
 EXECUTE restored_source;
 IF (SELECT proacl::text FROM pg_proc WHERE oid=item.signature::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'Rollback ACL changed: %',item.signature; END IF;
 END LOOP;
END $rollback$;

