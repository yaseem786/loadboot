-- bl_sec_0329b_verify_test.sql — audit F14. Rollback-txn test for public.retell_hook_verify().
-- PASS = the block RAISEs 'RESULT PASS'. Nothing is written at all — this function only reads.
-- The signature is built here with the REAL configured api_key, so case 1 is a true positive, not a mock.
-- STAGING RESULT 2026-09-06: RESULT PASS on all four.
do $$
declare v_key text; v_raw text; v_ts text; v_sig text; r jsonb; msg text := '';
begin
  select api_key into v_key from app_private.retell_config where id=1;
  if v_key is null then raise exception 'RESULT FAIL: retell_config.api_key is not configured on this env'; end if;
  v_raw := '{"event":"call_started","call":{"call_id":"sigtest-1"}}';
  v_ts  := (extract(epoch from now())*1000)::bigint::text;
  v_sig := 'v='||v_ts||',d='||encode(extensions.hmac(convert_to(v_raw||v_ts,'utf8'), convert_to(v_key,'utf8'),'sha256'),'hex');

  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  r := public.retell_hook_verify(v_raw, v_sig);
  if (r->>'verified') <> 'true' then raise exception 'RESULT FAIL: a correctly signed body did not verify: %', r; end if;
  msg := msg || ' case1 valid signature verifies PASS;';

  r := public.retell_hook_verify(v_raw, 'v='||v_ts||',d='||repeat('0',64));
  if (r->>'verified') <> 'false' or (r->>'reason') <> 'digest_mismatch' then
    raise exception 'RESULT FAIL: a forged digest was accepted: %', r; end if;
  r := public.retell_hook_verify(v_raw||' ', v_sig);
  if (r->>'verified') <> 'false' then raise exception 'RESULT FAIL: a tampered body still verified: %', r; end if;
  r := public.retell_hook_verify(v_raw, null);
  if (r->>'verified') <> 'false' or (r->>'reason') <> 'signature_header_unparsable' then
    raise exception 'RESULT FAIL: a missing header was not reported honestly: %', r; end if;
  msg := msg || ' case2 forged digest / tampered body / missing header all verified=false PASS;';

  v_ts := ((extract(epoch from now()) - 4000)*1000)::bigint::text;
  r := public.retell_hook_verify(v_raw, 'v='||v_ts||',d='||encode(extensions.hmac(convert_to(v_raw||v_ts,'utf8'), convert_to(v_key,'utf8'),'sha256'),'hex'));
  if (r->>'verified') <> 'false' or (r->>'reason') <> 'timestamp_outside_skew' then
    raise exception 'RESULT FAIL: a replayed old signature was accepted: %', r; end if;
  msg := msg || ' case3 replay outside the 15-min skew refused PASS;';

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  r := public.retell_hook_verify(v_raw, v_sig);
  if r->>'code' <> 'LB403' then raise exception 'RESULT FAIL: anon could call the verifier: %', r; end if;
  msg := msg || ' case4 anon cannot call the verifier (LB403) PASS;';

  raise exception 'RESULT PASS (nothing persisted):%', msg;
end $$;
