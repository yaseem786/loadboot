-- bl_ship_0507 rollback test (staging only). One DO block that ends with RAISE, so nothing is kept (pg_net queue too).
-- Three throwaway shippers: A verified, B new, C new + held. Staff = the 0499 staging test staff user.
do $$
declare
  v_staff uuid := '4e57f205-4dc6-4379-9d68-b66c3db151f8';
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  o uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_ver timestamptz := now() - interval '5 days';
  i int; r jsonb; v_id bigint; ok text[] := '{}'; bad text[] := '{}';
  body text := '{"ok":true,"domain":"bl0507test.com","mx":true,"free_mail":false,"site":{"ok":true,"title":"BL0507"},"name_match":true}';
begin
  for i in 1..3 loop
    insert into auth.users(id, email, email_confirmed_at, aud, role) values (u[i], 'bl0507-' || left(u[i]::text, 8) || '@bl0507test.com', now(), 'authenticated', 'authenticated');
    insert into public.organizations(id, kind, name, owner_user_id) values (o[i], 'shipper', 'BL0507 Test ' || i || ' LLC', u[i]);
    insert into app_private.shipper_trust(org_id, domain, free_mail, check_outcome) values (o[i], 'bl0507test.com', false, 'pass')
      on conflict (org_id) do update set domain = excluded.domain, free_mail = false, check_outcome = 'pass';
  end loop;
  update app_private.shipper_trust set verified_at = v_ver, verified_by = 'test' where org_id = o[1];
  update app_private.shipper_trust set hold_reason = 'test hold', held_at = now() where org_id = o[3];

  -- T1 portal/signup path on a verified shipper stays 'already'
  r := app_private.shipper_business_start(o[1]);
  if (r->>'already')::boolean then ok := ok || text 'T1 verified → already'; else bad := bad || ('T1 ' || r::text); end if;

  -- T2 staff re-check on a verified shipper now queues
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.cc_shipper_trust_set(o[1], 'recheck', null);
  if (select request_id is not null and check_outcome = 'pending' from app_private.shipper_trust where org_id = o[1])
    then ok := ok || text 'T2 recheck queued'; else bad := bad || text 'T2 recheck not queued'; end if;

  -- collector: fake a pass answer for all three
  for i in 1..3 loop
    v_id := -900000 - i;
    insert into net._http_response(id, status_code, content, created) values (v_id, 200, body, now());
    update app_private.shipper_trust set request_id = v_id, requested_at = now() - interval '1 minute' where org_id = o[i];
  end loop;
  perform app_private.shipper_check_collect();

  -- T3 verified + re-check: no shipper notice, staff title "re-check", verified_at kept
  if not exists (select 1 from app_private.partner_notifications where partner_org = o[1]) then ok := ok || text 'T3 A no bell'; else bad := bad || text 'T3 A got a bell'; end if;
  if exists (select 1 from app_private.notifications where payload->>'org_id' = o[1]::text and payload->>'title' like '🔁 Shipper re-check: pass%')
    then ok := ok || text 'T3 A staff re-check title'; else bad := bad || text 'T3 A staff title wrong'; end if;
  if (select verified_at = v_ver and check_outcome = 'pass' and risk_signals is not null from app_private.shipper_trust where org_id = o[1])
    then ok := ok || text 'T3 A verified_at kept, signals stored'; else bad := bad || text 'T3 A row wrong'; end if;

  -- T4 first check of a new shipper: unchanged behaviour (bell + green staff title)
  if exists (select 1 from app_private.partner_notifications where partner_org = o[2] and title like '✅ Company email checked%') then ok := ok || text 'T4 B bell'; else bad := bad || text 'T4 B no bell'; end if;
  if exists (select 1 from app_private.notifications where payload->>'org_id' = o[2]::text and payload->>'title' like '🟢 Shipper business confirmed%')
    then ok := ok || text 'T4 B green title'; else bad := bad || text 'T4 B staff title wrong'; end if;

  -- T5 held shipper: no bell
  if not exists (select 1 from app_private.partner_notifications where partner_org = o[3]) then ok := ok || text 'T5 C held no bell'; else bad := bad || text 'T5 C held got a bell'; end if;

  raise exception 'ROLLBACK bl_ship_0507 — ok: % | bad: %', ok, bad;
end $$;
