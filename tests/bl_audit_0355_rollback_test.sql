-- bl_audit_0355 rollback-txn test. Run as-is: the final RAISE rolls everything back; expect "ROLLBACK-OK" with every case true.
-- Fixture recipe for a permitted staff user is Codex's (docs/audit-2026-09/tests/erasure_inventory_gate_2026-09-13.sql).
do $t$
declare staff uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); org uuid; rid bigint; items jsonb; res text:=''; total int; total2 int;
  addr text:='audit-0355-'||target||'@example.invalid'; c text;
  kg text:='ZZt0355_guest_0123456789'; kc text:='ZZt0355_conv__0123456789'; ku text:='ZZt0355_user__0123456789'; kx text:='ZZt0355_other_0123456789';
begin
  insert into auth.users(id,email,raw_user_meta_data) values (staff,'audit-0355-staff-'||staff||'@example.invalid','{"role":"driver"}'),(target,addr,'{"role":"driver"}');
  select id into strict org from public.organizations where kind='internal' and status='active';
  insert into app_private.staff_members(user_id,status) values(staff,'active');
  insert into public.organization_memberships(org_id,user_id,member_role,status) values(org,staff,'staff','active');
  insert into app_private.user_permission_grants(user_id,permission_key,effect) values(staff,'carriers.approve','allow');
  insert into app_private.account_deletion_requests(user_id,email) values(target,addr) returning id into rid;
  -- guest row: no account_email, no user conversation; only the typed email (upper-cased + padded) links it
  insert into app_private.lc_onboarding(visitor_key,data,docs) values
   (kg, jsonb_build_object('email','  '||upper(addr)||' '), jsonb_build_array(jsonb_build_object('path','lc-onboarding/'||kg||'/known.pdf','t','coi'))),
   (kx, '{"email":"someone-else-0355@example.invalid"}', jsonb_build_array(jsonb_build_object('path','lc-onboarding/'||kx||'/theirs.pdf','t','coi')));
  insert into app_private.lc_conversations(visitor_key,email) values (kc, addr);
  insert into app_private.lc_conversations(visitor_key,user_id) values (ku, target);
  insert into storage.objects(bucket_id,name,metadata) values
   ('documents','lc-onboarding/'||kg||'/known.pdf','{"size":70}'),
   ('documents','lc-onboarding/'||kg||'/orphan.pdf','{"size":70}'),
   ('documents','lc-onboarding/'||kc||'/conv-email.pdf','{"size":70}'),
   ('documents','lc-onboarding/'||ku||'/conv-user.pdf','{"size":70}'),
   ('documents','lc-onboarding/'||kx||'/theirs.pdf','{"size":70}');
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  total := app_private.capture_account_erasure_inventory(rid);
  select i.items into items from app_private.account_erasure_inventories i where i.request_id=rid;
  res := res || ' c1_guest_docs_entry_by_typed_email=' || (items @> jsonb_build_array(jsonb_build_object('source','onboarding','path','lc-onboarding/'||kg||'/known.pdf')))::text;
  res := res || ' c2_orphan_under_guest_prefix=' || (items @> jsonb_build_array(jsonb_build_object('source','onboarding_storage_prefix','path','lc-onboarding/'||kg||'/orphan.pdf')))::text;
  res := res || ' c3_known_object_also_listed_from_storage=' || (items @> jsonb_build_array(jsonb_build_object('source','onboarding_storage_prefix','path','lc-onboarding/'||kg||'/known.pdf')))::text;
  res := res || ' c4_conversation_email_prefix=' || (items @> jsonb_build_array(jsonb_build_object('source','onboarding_storage_prefix','path','lc-onboarding/'||kc||'/conv-email.pdf')))::text;
  res := res || ' c5_conversation_user_prefix=' || (items @> jsonb_build_array(jsonb_build_object('source','onboarding_storage_prefix','path','lc-onboarding/'||ku||'/conv-user.pdf')))::text;
  res := res || ' c6_other_person_not_listed=' || (items::text not like '%'||kx||'%')::text;
  total2 := app_private.capture_account_erasure_inventory(rid);
  res := res || ' c7_idempotent_total=' || (total=total2 and total=5)::text;
  res := res || ' c8_acl_postgres_only=' || (not has_function_privilege('anon','app_private.capture_account_erasure_inventory(bigint)','execute') and not has_function_privilege('authenticated','app_private.capture_account_erasure_inventory(bigint)','execute') and not has_function_privilege('service_role','app_private.capture_account_erasure_inventory(bigint)','execute'))::text;
  perform set_config('request.jwt.claim.sub',target::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated')::text,true);
  c:='FAIL'; begin perform app_private.capture_account_erasure_inventory(rid); exception when insufficient_privilege then c:='true'; end;
  res := res || ' c9_nonstaff_42501=' || c;
  raise exception 'ROLLBACK-OK total=% %', total, res;
end $t$;
