-- bl_cmp_0326_rollback_test.sql — audit F30 follow-up. Rollback-txn test for
-- migrations/bl_cmp_0326_broker_precedence_fix.sql. PASS = the error message starts with RESULT PASS.
--
-- THIS IS THE CASE bl_cmp_0324's TEST MISSED. That test only exercised a CARRIER with a verified verdict, so it
-- never noticed that fmcsa-verify's `authority` field is CARRIER authority only:
--     fromLI():  carrierAuthority = common || contract ;  brokerAuthority = broker
--     caller:    result.authority = L.carrierAuthority ? "active" : "inactive" ; authorityVerified = true
-- A broker-ONLY docket therefore returns authority='inactive' with authorityVerified=true WHILE OPERATING
-- LEGALLY, and bl_cmp_0324's precedence would have expired its onboarding item, paused the org and emailed the
-- owner. Case 1 below is that scenario and must classify ACTIVE.
--
-- ENV NOTE: case 2 needs org_onboarding_items.status='expired'. PROD's check constraint allows it; STAGING's
-- does not (pre-existing drift — bl_fmcsa_0228–0231 never reached staging). The test detects this and skips
-- case 2 with a message rather than failing, so the same file runs on both envs.
-- RESULTS: staging 2026-09-06 — case1 PASS, case2 SKIPPED (drift), case3 PASS.
do $$
declare
  v_bro uuid; v_bro_owner uuid; v_car uuid; v_req bigint := 999000001; msg text := '';
  v_st0 text; v_can_expire boolean;
begin
  select pg_get_constraintdef(oid) like '%expired%' into v_can_expire from pg_constraint
   where conrelid='app_private.org_onboarding_items'::regclass and conname='org_onboarding_items_status_check';

  select o.id, o.owner_user_id into v_bro, v_bro_owner from public.organizations o
   where o.kind='broker' and o.owner_user_id is not null and coalesce(o.status,'')<>'archived' order by o.created_at limit 1;
  select o.id into v_car from public.organizations o where o.kind='carrier' and coalesce(o.status,'')<>'archived' order by o.created_at desc limit 1;
  if v_bro is null or v_car is null then raise exception 'RESULT FAIL: need a broker and a carrier org'; end if;

  update public.organizations set status='active' where id=v_bro;
  insert into app_private.org_onboarding_items(org_id, item_key, status) values (v_bro,'mc_authority','verified')
    on conflict (org_id, item_key) do update set status='verified', lapsed_at=null;
  select status into v_st0 from public.organizations where id=v_bro;

  -- CASE 1 — THE REGRESSION: broker-only docket, authority='inactive' + authorityVerified=true, but legal
  insert into app_private.authority_checks(org_id, mc_number, request_id, requested_at)
    values (v_bro, '123456', v_req, now() - interval '1 minute')
    on conflict (org_id) do update set request_id=excluded.request_id, requested_at=excluded.requested_at, checked_at=null, authority_status=null;
  insert into net._http_response(id,status_code,content_type,headers,content,timed_out,error_msg,created)
    values (v_req,200,'application/json','{}'::jsonb,
      '{"ok":true,"carrier":{"legalName":"TEST BROKERAGE LLC","dotNumber":1234567,"allowedToOperate":"Y","mcActive":null,"authority":"inactive","authorityVerified":true,"brokerOnly":true,"authorityTypes":{"common":false,"contract":false,"broker":true},"safetyRating":"none","outOfService":false}}',
      false,null,now());
  perform app_private.fmcsa_authority_collect();
  if (select authority_status from app_private.authority_checks where org_id=v_bro) <> 'active' then
    raise exception 'RESULT FAIL (regression live): broker-only docket classified % — expected active',
      (select authority_status from app_private.authority_checks where org_id=v_bro); end if;
  if (select status from public.organizations where id=v_bro) is distinct from v_st0 then
    raise exception 'RESULT FAIL: broker org paused on a broker-only docket'; end if;
  if exists (select 1 from app_private.org_onboarding_items where org_id=v_bro and item_key='mc_authority' and status='expired') then
    raise exception 'RESULT FAIL: broker item expired on a broker-only docket'; end if;
  if exists (select 1 from app_private.message_deliveries where idempotency_key like 'authlapse:'||v_bro::text||'%') then
    raise exception 'RESULT FAIL: broker owner EMAILED on a broker-only docket'; end if;
  msg := msg || ' case1 broker-only=active/no-pause/no-email PASS;';

  -- CASE 2 — a genuinely lapsed broker: the pre-0324 path must still fire, byte for byte
  if v_can_expire then
    update app_private.authority_checks set request_id=v_req+1, requested_at=now()-interval '1 minute' where org_id=v_bro;
    insert into net._http_response(id,status_code,content_type,headers,content,timed_out,error_msg,created)
      values (v_req+1,200,'application/json','{}'::jsonb,
        '{"ok":true,"carrier":{"legalName":"TEST BROKERAGE LLC","dotNumber":1234567,"allowedToOperate":"N","authority":"inactive","authorityVerified":false,"safetyRating":"none","outOfService":false}}',
        false,null,now());
    perform app_private.fmcsa_authority_collect();
    if (select authority_status from app_private.authority_checks where org_id=v_bro) <> 'inactive' then
      raise exception 'RESULT FAIL: a truly lapsed broker was not classified inactive'; end if;
    if not exists (select 1 from app_private.org_onboarding_items where org_id=v_bro and item_key='mc_authority' and status='expired') then
      raise exception 'RESULT FAIL: lapsed broker item not expired — the real broker path is broken'; end if;
    if (select status from public.organizations where id=v_bro) <> 'pending' then
      raise exception 'RESULT FAIL: lapsed broker org not paused — the real broker path is broken'; end if;
    msg := msg || ' case2 lapsed-broker=inactive/paused/expired PASS;';
  else
    msg := msg || ' case2 SKIPPED (no ''expired'' in org_onboarding_items_status_check on this env — staging drift);';
  end if;

  -- CASE 3 — the carrier keeps the bl_cmp_0324 improvement and stays carrier-safe
  insert into app_private.authority_checks(org_id, mc_number, request_id, requested_at)
    values (v_car, '654321', v_req+2, now() - interval '1 minute')
    on conflict (org_id) do update set request_id=excluded.request_id, requested_at=excluded.requested_at, checked_at=null, authority_status=null;
  insert into net._http_response(id,status_code,content_type,headers,content,timed_out,error_msg,created)
    values (v_req+2,200,'application/json','{}'::jsonb,
      '{"ok":true,"carrier":{"legalName":"TEST CARRIER LLC","dotNumber":7654321,"allowedToOperate":"Y","authority":"inactive","authorityVerified":true,"safetyRating":"none","outOfService":false}}',
      false,null,now());
  select status into v_st0 from public.organizations where id=v_car;
  perform app_private.fmcsa_authority_collect();
  if (select authority_status from app_private.authority_checks where org_id=v_car) <> 'inactive' then
    raise exception 'RESULT FAIL: carrier lost the verified-verdict precedence'; end if;
  if (select status from public.organizations where id=v_car) is distinct from v_st0 then
    raise exception 'RESULT FAIL: carrier org status changed'; end if;
  if exists (select 1 from app_private.message_deliveries where idempotency_key like 'authlapse:'||v_car::text||'%') then
    raise exception 'RESULT FAIL: carrier owner emailed'; end if;
  msg := msg || ' case3 carrier verified-inactive=inactive/no-pause/no-email PASS;';

  raise exception 'RESULT PASS (all writes rolled back):%', msg;
end $$;
