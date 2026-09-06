-- bl_cmp_0324_rollback_test.sql — audit F30 (Sprint 2 item 2). Rollback-transaction test for
-- migrations/bl_cmp_0324_carrier_fmcsa_collector.sql. PASS = the error message starts with RESULT PASS.
-- Nothing persists: the DO block raises at the end. The real net.http_post IS queued inside the txn but pg_net's
-- queue table is transactional too — the row disappears with the rollback, so no request leaves the box.
do $$
declare
  v_org uuid; v_uid uuid; v_req bigint; v_before_audit int; v_after_audit int;
  v_kind text; r record; cres jsonb; msg text := '';
begin
  -- 1. a real carrier org with an owner and NO check on file
  select o.id, o.owner_user_id into v_org, v_uid
    from public.organizations o
   where o.kind = 'carrier' and coalesce(o.status,'') <> 'archived' and o.owner_user_id is not null
     and not exists (select 1 from app_private.authority_checks c where c.org_id = o.id)
   order by o.created_at desc limit 1;
  if v_org is null then raise exception 'RESULT FAIL: no carrier org without a check found'; end if;

  -- 2. the signup trigger path: set a DOT on the owner's profile → request queued, audit row with request_id
  select count(*) into v_before_audit from app_private.audit_logs where action = 'compliance.fmcsa.requested';
  update public.profiles set dot = case when dot = '3218776' then '3218777' else '3218776' end where id = v_uid;  -- must DIFFER from the current value or the trigger correctly skips; never leaves the txn
  select request_id into v_req from app_private.authority_checks where org_id = v_org;
  if v_req is null then
    raise exception 'RESULT FAIL: trigger did not queue a request (authority_checks row: %)',
      (select row_to_json(c)::text from app_private.authority_checks c where c.org_id = v_org);
  end if;
  select count(*) into v_after_audit from app_private.audit_logs where action = 'compliance.fmcsa.requested';
  if v_after_audit <> v_before_audit + 1 then raise exception 'RESULT FAIL: no compliance.fmcsa.requested audit row'; end if;
  if not exists (select 1 from app_private.audit_logs where action='compliance.fmcsa.requested' and (detail->>'request_id')::bigint = v_req) then
    raise exception 'RESULT FAIL: audit row does not carry request_id %', v_req; end if;
  -- the queued request must carry the Bearer header (the old trigger sent none)
  if not exists (select 1 from net.http_request_queue q where q.id = v_req and q.headers->>'Authorization' like 'Bearer %') then
    raise exception 'RESULT FAIL: queued request % has no Authorization header', v_req; end if;
  if (select dot_number from public.organizations where id = v_org) is null then
    raise exception 'RESULT FAIL: org dot_number still null after profile update'; end if;
  msg := msg || format(' org=%s req=%s;', v_org, v_req);

  -- 3. idempotency: a second call while in flight returns null and changes nothing
  if app_private.fmcsa_authority_request(v_org) is not null then raise exception 'RESULT FAIL: request not idempotent'; end if;

  -- 4. fake the fmcsa-verify answer (shape = fmcsa-verify v34 with a verified L&I verdict)
  update app_private.authority_checks set requested_at = now() - interval '1 minute' where org_id = v_org;
  delete from net.http_request_queue where id = v_req;   -- never let the real call go out even if the txn survived
  insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created)
  values (v_req, 200, 'application/json', '{}'::jsonb,
    '{"ok":true,"source":"socrata+qcmobile","carrier":{"legalName":"TEST CARRIER LLC","dbaName":null,"dotNumber":3218776,"mcNumber":"MC1006869","allowedToOperate":"Y","mcActive":null,"authority":"active","authorityVerified":true,"authoritySource":"fmcsa-li","entityType":"CARRIER","safetyRating":"none","powerUnits":1,"drivers":1,"outOfService":false}}',
    false, null, now());

  -- 5. collector run
  cres := app_private.fmcsa_authority_collect();
  select * into r from app_private.authority_checks where org_id = v_org;
  if r.request_id is not null or r.authority_status <> 'active' or r.legal_name <> 'TEST CARRIER LLC' then
    raise exception 'RESULT FAIL: authority_checks not updated: %', row_to_json(r); end if;
  if not exists (select 1 from app_private.carrier_safety s where s.carrier_id = v_org and s.source='fmcsa'
                   and s.authority_status='active' and s.power_units=1 and s.fmcsa_snapshot->>'legalName'='TEST CARRIER LLC') then
    raise exception 'RESULT FAIL: carrier_safety not written'; end if;
  if (select count(*) from app_private.carrier_verifications v where v.carrier_org=v_org and v.source='auto' and v.status='pending_review') <> 1 then
    raise exception 'RESULT FAIL: carrier_verifications(source=auto,pending_review) count <> 1'; end if;
  msg := msg || format(' collect=%s;', cres - 'ran_at');

  -- 6. second collect within 20 h must not duplicate the verification row
  update app_private.authority_checks set request_id = v_req, requested_at = now() - interval '1 minute' where org_id = v_org;
  perform app_private.fmcsa_authority_collect();
  if (select count(*) from app_private.carrier_verifications v where v.carrier_org=v_org and v.source='auto') <> 1 then
    raise exception 'RESULT FAIL: duplicate carrier_verifications row on re-collect'; end if;

  -- 7. inactive verdict for a CARRIER → staff notification only, org status untouched, no carrier email
  update app_private.authority_checks set request_id = v_req + 1, requested_at = now() - interval '1 minute' where org_id = v_org;
  insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created)
  values (v_req + 1, 200, 'application/json', '{}'::jsonb,
    '{"ok":true,"carrier":{"legalName":"TEST CARRIER LLC","dotNumber":3218776,"authority":"inactive","authorityVerified":true,"allowedToOperate":"N","outOfService":false,"safetyRating":"none"}}',
    false, null, now());
  select status into v_kind from public.organizations where id = v_org;
  perform app_private.fmcsa_authority_collect();
  if (select status from public.organizations where id = v_org) is distinct from v_kind then
    raise exception 'RESULT FAIL: carrier org status changed on inactive'; end if;
  if not exists (select 1 from app_private.notifications n where n.template_key='authority.lapsed' and n.recipient_role='staff'
                   and n.payload->>'org_id' = v_org::text and n.created_at > now() - interval '1 minute') then
    raise exception 'RESULT FAIL: no staff notification for inactive carrier'; end if;
  if exists (select 1 from app_private.notifications n where n.template_key='authority.lapsed' and n.recipient_user = v_uid and n.created_at > now() - interval '1 minute') then
    raise exception 'RESULT FAIL: carrier owner was notified (must not be)'; end if;
  if exists (select 1 from app_private.message_deliveries d where d.idempotency_key like 'authlapse:'||v_org::text||'%') then
    raise exception 'RESULT FAIL: carrier owner was emailed (must not be)'; end if;

  -- 8. backfill helper sees no remaining org for this one; dispatch does not re-pick it (checked < 20 h)
  if exists (select 1 from public.organizations o where o.id = v_org and not exists (select 1 from app_private.authority_checks c where c.org_id=o.id)) then
    raise exception 'RESULT FAIL: backfill would still pick this org'; end if;

  -- 9. ACL: none of the new/changed functions executable by anon/authenticated
  if exists (select 1 from information_schema.routine_privileges where specific_schema='app_private' and privilege_type='EXECUTE'
              and grantee in ('anon','authenticated','PUBLIC')
              and routine_name in ('fmcsa_authority_request','fmcsa_carrier_backfill','fmcsa_authority_dispatch','fmcsa_authority_collect')) then
    raise exception 'RESULT FAIL: anon/authenticated can execute an fmcsa_* function'; end if;

  raise exception 'RESULT PASS (all writes rolled back):%', msg;
end $$;
