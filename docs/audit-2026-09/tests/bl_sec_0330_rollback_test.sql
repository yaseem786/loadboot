-- bl_sec_0330_rollback_test.sql — audit F14, second instance (public.retell_inbound).
-- PASS = the block RAISEs 'RESULT PASS'. Every synthetic row is rolled back by the RAISE.
--
-- WHAT IT PROVES, and why each case is here:
--   case 1 — REFUSAL. anon, authenticated and a caller with EMPTY claims all get the empty {"call_inbound":{}}
--            envelope plus code LB403, and no dynamic_variables at all. The empty envelope is the same shape
--            Retell already receives for a non-matching call, so a refusal discloses nothing — not even whether
--            the number is known.
--   case 2 — CONTRACT, the cheap branches: wrong event, foreign to_number, withheld number, brand-new caller.
--   case 3 — CONTRACT, the website-form branch, including that the caller's own words come back in `context`.
--   case 4 — CONTRACT, the broker branch, including that it still takes PRECEDENCE over a form submission for
--            the same number. Precedence is the kind of thing a rewrite silently loses.
--
-- TWO REAL BUGS THIS TEST CAUGHT ON ITS FIRST TWO RUNS — both in the guard, neither in the copied body:
--   1. bl_sec_0330's guard had `... and current_user not in ('postgres','service_role')` as an escape hatch for
--      internal callers. Inside a SECURITY DEFINER function current_user is the FUNCTION OWNER, so that clause
--      was true for every caller and the guard could never fire — case 1 got the full NEW CALLER payload back as
--      `anon`. Fixed by bl_sec_0330b: the verified JWT claim is now the only thing that decides.
--   2. `current_setting('request.jwt.claims', true)::jsonb` raises 22P02 when the GUC is set but EMPTY. Still
--      fail-closed, but a 500 carrying a Postgres error string is a worse answer than a clean refusal.
--      Fixed by bl_sec_0330c with nullif(...,'').
--
-- SCHEMA NOTE: app_private.email_brokers.email_domain is NOT NULL — the insert must supply it.
-- STAGING RESULT 2026-09-06: RESULT PASS on all four cases. PROD: this function does not exist there yet.
do $$
declare v_to text; r jsonb; msg text := ''; v_ph text := '+15550117733'; ctx text;
begin
  select from_number into v_to from app_private.retell_config where id=1;
  if v_to is null then raise exception 'RESULT FAIL: retell_config.from_number is null'; end if;

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number',v_ph,'to_number',v_to)));
  if r->>'code' <> 'LB403' or r->'call_inbound' <> '{}'::jsonb then
    raise exception 'RESULT FAIL: anon was not refused / leaked: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number',v_ph,'to_number',v_to)));
  if r->>'code' <> 'LB403' or r->'call_inbound' <> '{}'::jsonb then
    raise exception 'RESULT FAIL: authenticated was not refused / leaked: %', r; end if;
  perform set_config('request.jwt.claims', '', true);
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number',v_ph,'to_number',v_to)));
  if r->>'code' <> 'LB403' then raise exception 'RESULT FAIL: a caller with EMPTY claims got through: %', r; end if;
  msg := msg || ' case1 anon + authenticated + empty-claims all refused with the EMPTY envelope, no context PASS;';

  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  r := public.retell_inbound_verified(jsonb_build_object('event','call_started'));
  if r <> jsonb_build_object('call_inbound', jsonb_build_object()) then
    raise exception 'RESULT FAIL: wrong-event branch changed: %', r; end if;
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number',v_ph,'to_number','+19998887777')));
  if r <> jsonb_build_object('call_inbound', jsonb_build_object()) then
    raise exception 'RESULT FAIL: foreign to_number branch changed: %', r; end if;
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number','','to_number',v_to)));
  if r->'call_inbound'->'dynamic_variables'->>'name' <> 'there'
     or (r->'call_inbound'->'dynamic_variables'->>'context') not like 'Unknown caller%' then
    raise exception 'RESULT FAIL: withheld-number branch changed: %', r; end if;
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number',v_ph,'to_number',v_to)));
  if (r->'call_inbound'->'dynamic_variables'->>'context') not like 'NEW CALLER%' then
    raise exception 'RESULT FAIL: new-caller branch changed: %', r; end if;
  msg := msg || ' case2 service_role: wrong-event / foreign-to_number / withheld / new-caller branches all match prod PASS;';

  insert into app_private.form_submissions(phone, name, company, form_key, message)
    values (v_ph, 'Test Person', 'Test Co', 'contact', 'we need reefer capacity out of Fresno');
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number',v_ph,'to_number',v_to)));
  ctx := r->'call_inbound'->'dynamic_variables'->>'context';
  if ctx not like 'CALLER FROM OUR WEBSITE%' or ctx not like '%reefer capacity out of Fresno%'
     or r->'call_inbound'->'dynamic_variables'->>'name' <> 'Test' then
    raise exception 'RESULT FAIL: form-submission branch changed: %', r; end if;
  msg := msg || ' case3 form-submission branch same shape and content PASS;';

  insert into app_private.email_brokers(phone, company, contact_name, mc_number, email_domain)
    values (v_ph, 'Test Brokerage LLC', 'Dana Broker', '999888', 'test-brokerage.invalid');
  r := public.retell_inbound_verified(jsonb_build_object('event','call_inbound','call_inbound',
        jsonb_build_object('from_number',v_ph,'to_number',v_to)));
  ctx := r->'call_inbound'->'dynamic_variables'->>'context';
  if ctx not like 'KNOWN BROKER%' or r->'call_inbound'->'dynamic_variables'->>'role' <> 'broker'
     or ctx not like '%Test Brokerage LLC%' then
    raise exception 'RESULT FAIL: broker branch changed or lost precedence: %', r; end if;
  msg := msg || ' case4 broker branch takes precedence over the form, same shape PASS;';

  raise exception 'RESULT PASS (all writes rolled back):%', msg;
end $$;
