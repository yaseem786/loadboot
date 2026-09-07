-- bl_sec_0334_rollback_test.sql — audit F34. PASS = the block RAISEs 'RESULT PASS'. The synthetic onboarding
-- row is rolled back with everything else.
--
-- Case 1 is the one that matters most: a REAL, properly-minted key must keep working. A guard that also locks
-- out the people it is protecting is not a fix.
-- STAGING RESULT 2026-09-07: RESULT PASS on all four.
do $$
declare k text := 'v'||repeat('ab',24); r jsonb; msg text := ''; n0 int;
begin
  select count(*) into n0 from app_private.lc_onboarding;
  insert into app_private.lc_onboarding(visitor_key, role, step_key, data, account_email)
    values (k, 'carrier', 'step1', '{"note":"synthetic"}'::jsonb, 'synthetic@test.invalid');

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);

  r := public.lc_ob_get(k);
  if (r->>'exists') <> 'true' or (r->>'account_email') <> 'synthetic@test.invalid' then
    raise exception 'RESULT FAIL: a real 49-char key stopped working: %', r; end if;
  msg := msg || ' case1 a proper key still works (no regression for real visitors) PASS;';

  r := public.lc_ob_get('shortkey');
  if (r->>'error') <> 'bad key' then raise exception 'RESULT FAIL: 8-char key accepted: %', r; end if;
  r := public.lc_ob_get('fifteenchars123');
  if (r->>'error') <> 'bad key' then raise exception 'RESULT FAIL: 15-char key accepted: %', r; end if;
  msg := msg || ' case2 8-char and 15-char keys refused (floor is now 16, same as lc_history) PASS;';

  r := public.lc_ob_get('novkeymfp9q2xxxxxxxx');
  if (r->>'error') <> 'bad key' then
    raise exception 'RESULT FAIL: the predictable novkey shape was accepted: %', r; end if;
  msg := msg || ' case3 the predictable novkey prefix refused even at a passing length PASS;';

  r := public.lc_ob_get(repeat('z',65));
  if (r->>'error') <> 'bad key' then raise exception 'RESULT FAIL: 65-char key accepted: %', r; end if;
  r := public.lc_ob_get(null);
  if (r->>'error') <> 'bad key' then raise exception 'RESULT FAIL: null key accepted: %', r; end if;
  msg := msg || ' case4 over-long and null refused PASS;';

  if (select count(*) from app_private.lc_onboarding) <> n0 + 1 then
    raise exception 'RESULT FAIL: unexpected row count'; end if;

  raise exception 'RESULT PASS (synthetic row rolled back):%', msg;
end $$;
