-- retell_inbound_hook_live_checks.sql — audit F14. LIVE checks for the retell-inbound-hook edge function.
-- Not a rollback test: an edge function cannot be exercised inside a transaction. Fire, wait ~25 s, then read
-- net._http_response for the ids returned.
--
-- STAGING RESULTS 2026-09-06 (retell-inbound-hook v1, ezbr_sha256 ce940e1ca8c20399e35fba352077e48a386d7d73189d26b2c32acba4b393ac3d):
--   i1 valid signature      194834 → 200, full {"call_inbound":{"dynamic_variables":{…NEW CALLER…}}} envelope
--   i2 forged digest        194835 → 401 {"call_inbound":{},"code":"LB401","reason":"digest_mismatch"}
--   i3 missing header       194836 → 401 … "signature_header_unparsable"
--   i4 stale signature      194837 → 401 … "timestamp_outside_skew"          (signed 66 minutes ago)
--   i5 tampered body        194838 → 401 … "digest_mismatch"                 (valid signature, different body)
--   i6 verifier failure     194841 → 503 {"call_inbound":{},"code":"LB503","reason":"verifier_verdict_incomplete"}
-- Every refusal returns the EMPTY envelope, so a refused caller cannot even tell whether the number is known.
--
-- i6 METHOD, and how it was made safe: retell_config.api_key was copied into a scratch table, set to NULL, the
-- request fired, then the key restored from the copy and the scratch table dropped. Verified afterwards:
-- key_restored=true, scratch table gone. Do NOT run i6 on prod.
--
-- NOT COVERED LIVE — stated rather than glossed: the body_not_json → 400 branch. pg_net's http_post only accepts
-- a jsonb body, so a non-JSON raw body cannot be produced from here. That branch is verified by code inspection
-- only; UNKNOWN until something that can post arbitrary bytes exercises it.
with c as (select api_key k, from_number f from app_private.retell_config where id=1),
p as (select ('{"event":"call_inbound","call_inbound":{"from_number":"+15550117733","to_number":"'||(select f from c)||'"}}')::jsonb j),
s as (select (extract(epoch from now())*1000)::bigint::text ts, (select j::text from p) raw),
old as (select ((extract(epoch from now())-4000)*1000)::bigint::text ts, (select j::text from p) raw)
select 'i1_valid_signature_must_be_200' k, net.http_post(
  url:=current_setting('lb.fn_base', true)||'/retell-inbound-hook',
  headers:=jsonb_build_object('Content-Type','application/json',
    'X-Retell-Signature','v='||s.ts||',d='||encode(extensions.hmac(convert_to(s.raw||s.ts,'utf8'), convert_to((select k from c),'utf8'),'sha256'),'hex')),
  body:=(select j from p), timeout_milliseconds:=20000) id from s
union all
select 'i2_invalid_signature_must_be_401', net.http_post(
  url:=current_setting('lb.fn_base', true)||'/retell-inbound-hook',
  headers:=jsonb_build_object('Content-Type','application/json','X-Retell-Signature','v='||s.ts||',d='||repeat('0',64)),
  body:=(select j from p), timeout_milliseconds:=20000) from s
union all
select 'i3_missing_header_must_be_401', net.http_post(
  url:=current_setting('lb.fn_base', true)||'/retell-inbound-hook',
  headers:=jsonb_build_object('Content-Type','application/json'),
  body:=(select j from p), timeout_milliseconds:=20000)
union all
select 'i4_stale_signature_must_be_401', net.http_post(
  url:=current_setting('lb.fn_base', true)||'/retell-inbound-hook',
  headers:=jsonb_build_object('Content-Type','application/json',
    'X-Retell-Signature','v='||old.ts||',d='||encode(extensions.hmac(convert_to(old.raw||old.ts,'utf8'), convert_to((select k from c),'utf8'),'sha256'),'hex')),
  body:=(select j from p), timeout_milliseconds:=20000) from old
union all
select 'i5_tampered_body_must_be_401', net.http_post(
  url:=current_setting('lb.fn_base', true)||'/retell-inbound-hook',
  headers:=jsonb_build_object('Content-Type','application/json',
    'X-Retell-Signature','v='||s.ts||',d='||encode(extensions.hmac(convert_to(s.raw||s.ts,'utf8'), convert_to((select k from c),'utf8'),'sha256'),'hex')),
  body:='{"event":"call_inbound","call_inbound":{"from_number":"+19990001111","to_number":"x"}}'::jsonb,
  timeout_milliseconds:=20000) from s;
-- then:
--   select id, status_code, left(content,220) from net._http_response where id in (...) order by id;
