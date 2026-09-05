-- bl_bp_0319 rollback test — one statement, ends in RAISE so nothing persists.
create function pg_temp.mkuser(p_uid uuid, p_email text) returns void language plpgsql as $f$
begin
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, 'x', now(), jsonb_build_object('partner_kind','shipper'), '{"provider":"email","providers":["email"]}', now(), now());
end $f$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
end $f$;
create function pg_temp.pg() returns void language plpgsql as $f$ begin perform set_config('role','postgres', true); end $f$;
-- pretend domain-check answered
create function pg_temp.answer(p_org uuid, p_body jsonb) returns void language plpgsql as $f$
declare v_req bigint := 900000000 + (random()*1000000)::bigint;
begin
  update app_private.shipper_trust set request_id = v_req, requested_at = now() - interval '20 seconds' where org_id = p_org;
  insert into net._http_response(id, status_code, content_type, content, created) values (v_req, 200, 'application/json', p_body::text, now());
  perform app_private.shipper_check_collect();
end $f$;
create function pg_temp.code_for(p_org uuid) returns text language plpgsql as $f$
declare v text;
begin
  select (regexp_match(md.meta->>'body_html', 'font-family:ui-monospace[^>]*>([0-9]{6})<'))[1] into v
    from app_private.message_deliveries md where md.template_key = 'shipper.company_email' and md.idempotency_key like 'shipperemail:' || p_org::text || ':%'
   order by md.created_at desc limit 1;
  return v;
end $f$;
create function pg_temp.ship(p_ref text) returns jsonb language sql as $f$
  select jsonb_build_object('origin','Dallas, TX','destination','Atlanta, GA','ref_po',p_ref,'pickup_contact','Ann 555','delivery_contact','Bob 555','commodity','paper','weight','30000','pieces','20','equipment','Van','cargo_value','40000','facility_notes','dock 3','dock_hours','08:00-16:00','hazmat','false') $f$;
do $$
declare uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); oA uuid; oB uuid; r jsonb; out text := ''; v_err text; v_code text; v_lid uuid;
begin
  -- A: company email
  perform pg_temp.mkuser(uA, 'ops@acmemfg.com');
  perform pg_temp.as_user(uA); r := public.cc_partner_register('shipper', 'Acme Manufacturing', null); perform pg_temp.pg();
  oA := (r->>'org')::uuid;
  out := out || format('A queued=%s outcome=%s tier=%s | ', (select request_id is not null from app_private.shipper_trust where org_id = oA), (select check_outcome from app_private.shipper_trust where org_id = oA), app_private.shipper_tier(oA));
  perform pg_temp.as_user(uA);
  begin v_lid := public.cc_shipper_post_load(pg_temp.ship('PO-1')); v_err := 'no error'; exception when others then v_err := sqlerrm; end;
  perform pg_temp.pg();
  out := out || 'A post_before=' || left(v_err, 45) || ' | ';
  perform pg_temp.answer(oA, '{"ok":true,"domain":"acmemfg.com","free_mail":false,"mx":true,"site":{"ok":true,"title":"Acme Manufacturing — Industrial Paper","final_url":"https://acmemfg.com/"},"name_match":true}'::jsonb);
  out := out || format('A after tier=%s by=%s | ', app_private.shipper_tier(oA), (select left(verified_by,60) from app_private.shipper_trust where org_id = oA));
  perform pg_temp.as_user(uA);
  v_lid := public.cc_shipper_post_load(pg_temp.ship('PO-2'));
  r := public.partner_shipper_status();
  perform pg_temp.pg();
  out := out || format('A posted=%s status tier=%s can_post=%s packet_req=%s/%s | ', r->>'shipments', r->>'tier', r->>'can_post', r->>'packet_required_done', r->>'packet_required_total');
  -- overview + broker inbox badge
  perform pg_temp.as_user(uA); r := public.cc_partner_overview(); perform pg_temp.pg();
  out := out || format('overview can_post=%s onboarded=%s | ', r->>'can_post', r->>'onboarded');
  out := out || format('badge=%s | ', (select (app_private.shipper_badge(oA))->>'tier'));

  -- B: gmail → company email code → check → verified
  perform pg_temp.mkuser(uB, 'bob@gmail.com');
  perform pg_temp.as_user(uB); r := public.cc_partner_register('shipper', 'Bob Foods LLC', null); perform pg_temp.pg();
  oB := (r->>'org')::uuid;
  out := out || format('B outcome=%s reason=%s | ', (select check_outcome from app_private.shipper_trust where org_id = oB), left((select reason from app_private.shipper_can_post(oB)), 40));
  perform pg_temp.as_user(uB);
  begin r := public.partner_shipper_company_email('bob@gmail.com'); v_err := 'no error'; exception when others then v_err := sqlerrm; end;
  out := out || 'B gmail_again=' || left(v_err, 30) || ' | ';
  r := public.partner_shipper_company_email('bob@bobfoods.com'); out := out || 'B code_sent=' || (r->>'sent') || ' ';
  perform pg_temp.pg();
  v_code := pg_temp.code_for(oB);
  perform pg_temp.as_user(uB);
  r := public.partner_verify_code('000000'); out := out || 'wrong=' || (r->>'ok') || ' ';
  r := public.partner_verify_code(v_code); out := out || 'right=' || (r->>'ok') || '/' || (r->>'purpose') || '/' || (r->>'outcome') || ' | ';
  perform pg_temp.pg();
  out := out || format('B domain=%s email_verified=%s | ', (select domain from app_private.shipper_trust where org_id = oB), (select email_verified_at is not null from app_private.shipper_trust where org_id = oB));
  perform pg_temp.answer(oB, '{"ok":true,"domain":"bobfoods.com","free_mail":false,"mx":true,"site":{"ok":false,"title":null,"final_url":null},"name_match":null}'::jsonb);
  out := out || format('B tier=%s by=%s | ', app_private.shipper_tier(oB), (select left(verified_by,80) from app_private.shipper_trust where org_id = oB));
  -- no-mail domain → not verified
  perform pg_temp.answer(oA, '{"ok":true,"domain":"acmemfg.com","free_mail":false,"mx":false,"site":{"ok":false}}'::jsonb);
  out := out || format('A still tier=%s (verified never revoked by a later no-mail) | ', app_private.shipper_tier(oA));
  -- staff hold / release
  create or replace function public.has_global_permission(p_perm text) returns boolean language sql as 'select true';
  r := public.cc_shipper_trust_set(oB, 'hold', 'suspicious');
  perform pg_temp.as_user(uB);
  begin v_lid := public.cc_shipper_post_load(pg_temp.ship('PO-9')); v_err := 'no error'; exception when others then v_err := sqlerrm; end;
  perform pg_temp.pg();
  out := out || 'B held_post=' || left(v_err, 30) || ' | ';
  r := public.cc_shipper_trust_set(oB, 'release', null);
  out := out || format('B released tier=%s | queue=%s', app_private.shipper_tier(oB), (select count(*) from jsonb_array_elements(public.cc_shipper_trust_queue()) e where (e->>'org_id')::uuid in (oA, oB)));
  raise exception 'RESULT:%', out;
end $$;
