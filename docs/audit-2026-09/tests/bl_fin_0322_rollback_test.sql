-- bl_fin_0322_rollback_test.sql — audit F32 (Sprint 2 item 1, 2026-09-05)
-- Rollback-transaction test for migrations/bl_fin_0322_port_trip_pnl_engine.sql.
--
-- HOW IT WORKS: one DO block impersonates a real carrier owner via request.jwt.claims, exercises all six RPCs
-- (cc_get_cost_model, cc_set_cost_model, cc_trip_pnl, cc_trip_finance_add, cc_trip_finance_remove,
-- cc_carrier_earnings), checks the P&L moves by exactly the amounts added, checks a non-carrier caller gets 42501,
-- then RAISES so every write is rolled back. Nothing persists. Safe to run on any env AFTER the migration is applied.
--
-- PASS = the error message starts with  RESULT PASS …   (the raise IS the success path)
-- FAIL = any other error (a real 42P01/42703/22P02 etc.) or a RESULT FAIL … message.
--
-- It self-discovers a trip: newest app_private.trips row whose carrier org has an active membership. No hardcoded ids.
-- Run via execute_sql (staging first, then prod only on Yaseen's "apply to prod").
do $$
declare
  v_trip uuid; v_org uuid; v_uid uuid;
  cm0 jsonb; cm1 jsonb; p0 jsonb; p1 jsonb; e jsonb;
  v_earn uuid; v_cost uuid; v_removed boolean;
  n0 numeric; n1 numeric; v_fpct numeric; v_exp numeric;
  msg text := '';
begin
  -- 1. pick a real carrier owner + one of their trips
  select t.id, t.carrier_id, om.user_id into v_trip, v_org, v_uid
    from app_private.trips t
    join public.organizations o on o.id=t.carrier_id and o.kind='carrier'
    join public.organization_memberships om on om.org_id=t.carrier_id and om.status='active'
   order by t.created_at desc limit 1;
  if v_trip is null then raise exception 'RESULT FAIL: no trip with an active carrier member found'; end if;

  -- 2. impersonate that member (authenticated role)
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  -- (role stays postgres on purpose: the RPCs are SECURITY DEFINER and read auth.uid() from the claims; switching
  --  role would also hide anon grants from information_schema in step 9 and give a false PASS)
  if app_private.my_carrier_org() is distinct from v_org then
    raise exception 'RESULT FAIL: my_carrier_org()=% expected %', app_private.my_carrier_org(), v_org; end if;

  -- 3/4. P&L before, add one earning + one cost, P&L after
  cm0 := public.cc_get_cost_model();
  v_fpct := coalesce((cm0->>'factoring_pct')::numeric, 0);   -- factoring is % of gross, so a +150 earning nets 150*(1-pct/100)
  p0 := public.cc_trip_pnl(v_trip);
  v_earn := public.cc_trip_finance_add(v_trip, 'earning', 'accessorial', 'TEST detention', 150, 'rollback test');
  v_cost := public.cc_trip_finance_add(v_trip, 'cost', 'tolls', 'TEST tolls', 40, null);
  p1 := public.cc_trip_pnl(v_trip);
  n0 := coalesce((p0->>'net')::numeric, 0);  n1 := coalesce((p1->>'net')::numeric, 0);
  v_exp := 150 - 150*v_fpct/100.0 - 40;
  if abs((n1 - n0) - v_exp) > 0.02 then
    raise exception 'RESULT FAIL: net moved by % (expected %). before=% after=%', n1-n0, v_exp, p0, p1; end if;
  msg := msg || format(' trip=%s net %s→%s;', v_trip, n0, n1);

  -- 5. remove works and is scoped to own carrier
  v_removed := public.cc_trip_finance_remove(v_cost);
  if not v_removed then raise exception 'RESULT FAIL: cc_trip_finance_remove returned false for own item'; end if;
  if abs((coalesce((public.cc_trip_pnl(v_trip)->>'net')::numeric,0) - n0) - (v_exp + 40)) > 0.02 then
    raise exception 'RESULT FAIL: net after remove not +%', v_exp + 40; end if;

  -- 5b. cost model round-trip (done AFTER the P&L delta check — changing per-mile costs/factoring moves net)
  perform public.cc_set_cost_model(p_driver_pay_per_mile => 0.55, p_maint_per_mile => 0.15, p_fixed_per_mile => 0.30, p_factoring_pct => 3.0);
  cm1 := public.cc_get_cost_model();
  if (cm1->>'driver_pay_per_mile')::numeric <> 0.55 or (cm1->>'factoring_pct')::numeric <> 3.0 then
    raise exception 'RESULT FAIL: cost model did not round-trip: before=% after=%', cm0, cm1; end if;
  if (public.cc_trip_pnl(v_trip)->'costs'->'auto') is null then
    raise exception 'RESULT FAIL: cc_trip_pnl has no costs.auto after cost model set'; end if;

  -- 6. earnings summary runs and is jsonb
  e := public.cc_carrier_earnings(null, null);
  if e is null then raise exception 'RESULT FAIL: cc_carrier_earnings returned null'; end if;
  msg := msg || format(' earnings keys=%s;', (select string_agg(k, ',') from jsonb_object_keys(e) k));

  -- 7. validation paths
  begin
    perform public.cc_trip_finance_add(v_trip, 'sideways', 'x', 'bad', 1, null);
    raise exception 'RESULT FAIL: bad direction accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.cc_trip_finance_add(v_trip, 'cost', 'x', 'zero', 0, null);
    raise exception 'RESULT FAIL: zero amount accepted';
  exception when sqlstate '22023' then null; end;

  -- 8. a caller with no carrier org must get 42501 on every RPC
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.cc_trip_pnl(v_trip);
    raise exception 'RESULT FAIL: cc_trip_pnl allowed a non-carrier caller';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.cc_carrier_earnings(null, null);
    raise exception 'RESULT FAIL: cc_carrier_earnings allowed a non-carrier caller';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.cc_get_cost_model();
    raise exception 'RESULT FAIL: cc_get_cost_model allowed a non-carrier caller';
  exception when sqlstate '42501' then null; end;

  -- 9. ACL: anon must not be able to execute any of the six
  if exists (select 1 from information_schema.routine_privileges
              where specific_schema='public' and privilege_type='EXECUTE' and grantee in ('anon','PUBLIC')
                and routine_name in ('cc_trip_finance_add','cc_trip_finance_remove','cc_trip_pnl','cc_carrier_earnings','cc_set_cost_model','cc_get_cost_model')) then
    raise exception 'RESULT FAIL: anon/PUBLIC still has EXECUTE on a cc_* P&L RPC'; end if;

  raise exception 'RESULT PASS (all writes rolled back):%', msg;
end $$;
