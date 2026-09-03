-- bl_bp_0314 rollback test (staging). Everything rolls back on the final RAISE; the Retell call is only queued
-- in net.http_request_queue inside the txn, so no phone ever rings. Helpers are pg_temp (plpgsql has no nested procedures).
create function pg_temp.mkuser(p_uid uuid, p_email text) returns void language plpgsql as $f$
begin
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, 'x', now(), jsonb_build_object('partner_kind','broker'), '{"provider":"email","providers":["email"]}', now(), now());
end $f$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
end $f$;
create function pg_temp.mkorg(p_uid uuid, p_name text) returns uuid language plpgsql as $f$
declare v_id uuid; r jsonb;
begin
  perform pg_temp.as_user(p_uid);
  r := public.cc_partner_register('broker', p_name, null);
  perform set_config('role','postgres', true);
  select org_id into v_id from public.organization_memberships where user_id = p_uid limit 1;
  return v_id;
end $f$;
create function pg_temp.lastbody() returns jsonb language sql as $f$ select convert_from(body,'utf8')::jsonb from net.http_request_queue where url like '%create-phone-call%' order by id desc limit 1 $f$;
do $$
declare uA uuid := gen_random_uuid(); uD uuid := gen_random_uuid(); oA uuid; oD uuid; r jsonb; out text := ''; v_body jsonb; v_code text; v text;
begin
  perform pg_temp.mkuser(uA, 'bob@gmail.com'); perform pg_temp.mkuser(uD, 'dave@gmail.com');
  oA := pg_temp.mkorg(uA, 'Bob Brokerage'); oD := pg_temp.mkorg(uD, 'Dave Agency');
  perform set_config('role','postgres', true);
  update public.organizations set mc_number = '900002' where id = oA;
  insert into app_private.broker_trust(org_id) values (oA);
  insert into app_private.broker_screenings(org_id, mc_number, outcome, legal_name, fmcsa_email, phone, checked_at, attempts) values (oA, '900002', 'pass', 'BOB BROKERAGE INC', 'office@bobbrokerage.com', '(555) 987-6543', now(), 1);
  perform app_private.broker_identity_start(oA);
  out := out || 'A tier=' || app_private.broker_tier(oA) || ' | ';
  perform pg_temp.as_user(uA);
  r := public.partner_verify_code('123456'); out := out || 'code before call: ' || (r->>'why') || ' | ';
  r := public.partner_verify_call('identity'); out := out || 'call1=' || r::text || ' | ';
  r := public.partner_verify_call('identity'); out := out || 'call2 throttle=' || (r->>'why') || ' | ';
  perform set_config('role','postgres', true);
  v_body := pg_temp.lastbody();
  out := out || format('dial to=%s agent=%s vars=%s | ', v_body->>'to_number', v_body->>'override_agent_id', (v_body->'retell_llm_dynamic_variables')::text);
  v_code := replace(v_body->'retell_llm_dynamic_variables'->>'code', ' ', '');
  select count(*)::text into v from app_private.lc_calls where source = 'verify' and org_id = oA and status = 'dialing'; out := out || 'lc_calls dialing=' || v || ' | ';
  perform pg_temp.as_user(uA);
  r := public.partner_verify_code('000000'); out := out || 'wrong=' || (r->>'why') || ' | ';
  r := public.partner_trust_status(); out := out || 'status.verify_call=' || (r->'verify_call')::text || ' phone_ok=' || (r->>'verify_phone_ok') || ' | ';
  r := public.partner_verify_code(v_code); out := out || format('right ok=%s tier=%s | ', r->>'ok', r->>'tier');
  perform set_config('role','postgres', true);
  select status||'/'||method||'/'||verified_by into v from app_private.broker_identity where org_id = oA; out := out || 'identity=' || v || ' | ';
  perform pg_temp.as_user(uA); r := public.partner_verify_call('identity'); out := out || 'after verified already=' || (r->>'already') || ' | '; perform set_config('role','postgres', true);
  insert into app_private.broker_trust(org_id, is_agent, parent_mc, parent_legal_name) values (oD, true, '900009', 'ACME FREIGHT LLC');
  insert into app_private.broker_screenings(org_id, mc_number, outcome, legal_name, fmcsa_email, phone, checked_at, attempts) values (oD, '900009', 'pass', 'ACME FREIGHT LLC', null, '5551234567', now(), 1);
  out := out || 'D tier=' || app_private.broker_tier(oD) || ' | ';
  perform pg_temp.as_user(uD);
  r := public.partner_verify_call('identity'); out := out || 'D identity refused=' || (r->>'why') || ' | ';
  r := public.partner_verify_call('parent'); out := out || 'D parent call=' || (r->>'ok') || ' to ' || (r->>'to') || ' | ';
  perform set_config('role','postgres', true);
  v_body := pg_temp.lastbody();
  v_code := replace(v_body->'retell_llm_dynamic_variables'->>'code', ' ', '');
  out := out || 'D script=' || left(v_body->'retell_llm_dynamic_variables'->>'script', 70) || ' | ';
  perform pg_temp.as_user(uD);
  for i in 1..5 loop r := public.partner_verify_code('111111'); end loop;
  r := public.partner_verify_code(v_code); out := out || 'after 5 wrong: ' || (r->>'why') || ' | ';
  perform set_config('role','postgres', true);
  update app_private.verify_codes set attempts = 0 where org_id = oD;
  perform pg_temp.as_user(uD);
  r := public.partner_verify_code(v_code); out := out || format('D right ok=%s tier=%s | ', r->>'ok', r->>'tier');
  perform set_config('role','postgres', true);
  select parent_confirmed_by into v from app_private.broker_trust where org_id = oD; out := out || 'D confirmed_by=' || v || ' | ';
  update app_private.broker_screenings set phone = null where org_id = oA; update app_private.broker_identity set fmcsa_phone = null, status = 'pending' where org_id = oA;
  perform pg_temp.as_user(uA); r := public.partner_verify_call('identity'); out := out || 'no phone: ' || left(r->>'why', 50) || ' | '; perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('role','anon', true);
  begin r := public.partner_verify_code('123456'); out := out || 'ANON RAN!! | '; exception when others then out := out || 'anon=' || sqlstate || ' | '; end;
  perform set_config('role','postgres', true);
  raise exception 'RESULT: %', out;
end $$;
