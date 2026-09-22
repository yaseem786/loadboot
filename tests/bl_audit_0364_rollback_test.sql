-- bl_audit_0364 rollback-txn test. Run as-is; expect "ROLLBACK-OK" with every case true.
do $t$
declare staff uuid:=gen_random_uuid(); gone uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); org uuid; corg uuid; rid bigint; r jsonb; res text:='';
  addr text; kg text:='ZZt0364_chat__0123456789'; ko text:='ZZt0364_other_0123456789';
begin
  addr := 'audit-0364-gone-'||gone||'@example.invalid';
  insert into auth.users(id,email,raw_user_meta_data) values (staff,'audit-0364-staff-'||staff||'@example.invalid','{"role":"driver"}'),(gone,addr,'{"role":"driver"}'),(other,'audit-0364-other-'||other||'@example.invalid','{"role":"driver"}');
  select id into strict org from public.organizations where kind='internal' and status='active';
  insert into app_private.staff_members(user_id,status) values(staff,'active');
  insert into public.organization_memberships(org_id,user_id,member_role,status) values(org,staff,'staff','active');
  insert into app_private.user_permission_grants(user_id,permission_key,effect) values(staff,'carriers.approve','allow');
  insert into public.organizations(id,kind,status,name,owner_user_id) values (gen_random_uuid(),'carrier','active','ZZt0364 Carrier',gone) returning id into corg;
  insert into app_private.push_subscriptions(user_id,endpoint,p256dh,auth) values (gone,'https://push.example/zz0364','k','a'),(other,'https://push.example/zz0364o','k','a');
  insert into app_private.user_devices(user_id,device_key) values (gone,'zz0364'),(other,'zz0364o');
  insert into app_private.notifications(recipient_role,recipient_user,channel,template_key,payload,status) values ('carrier',gone,'in_app','zz0364','{"email":"x"}','queued'),('carrier',other,'in_app','zz0364','{}','queued');
  insert into app_private.comm_preferences(user_id) values (gone),(other);
  insert into app_private.emergency_contacts(carrier_id,name,phone) values (corg,'ZZ Person','5550364');
  insert into app_private.lc_onboarding(visitor_key,account_email,data,docs) values (kg, addr, jsonb_build_object('email',upper(addr),'phone','555','contact_name','ZZ','role_label','carrier'), '[]'), (ko, null, '{"email":"keep-0364@example.invalid","phone":"1"}', '[]');
  insert into app_private.account_deletion_requests(user_id,email) values(gone,addr) returning id into rid;
  perform set_config('request.jwt.claim.sub',staff::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  set local role authenticated;
  r := public.cc_account_deletion_process(rid,'complete');
  reset role;
  res := res || ' c1_completed=' || (r->>'status'='completed')::text;
  res := res || ' c2_push_gone=' || ((select count(*) from app_private.push_subscriptions where user_id=gone)=0 and (select count(*) from app_private.push_subscriptions where user_id=other)=1)::text;
  res := res || ' c3_devices_gone=' || ((select count(*) from app_private.user_devices where user_id=gone)=0 and (select count(*) from app_private.user_devices where user_id=other)=1)::text;
  res := res || ' c4_notifications_gone=' || ((select count(*) from app_private.notifications where recipient_user=gone)=0 and (select count(*) from app_private.notifications where recipient_user=other)=1)::text;
  res := res || ' c5_prefs_gone=' || ((select count(*) from app_private.comm_preferences where user_id=gone)=0 and (select count(*) from app_private.comm_preferences where user_id=other)=1)::text;
  res := res || ' c6_emergency_gone=' || ((select count(*) from app_private.emergency_contacts where carrier_id=corg)=0)::text;
  res := res || ' c7_chat_scrubbed=' || ((select account_email is null and data->>'email' is null and data->>'phone' is null and data->>'contact_name' is null and data->>'role_label'='carrier' from app_private.lc_onboarding where visitor_key=kg))::text;
  res := res || ' c8_other_chat_kept=' || ((select data->>'email'='keep-0364@example.invalid' from app_private.lc_onboarding where visitor_key=ko))::text;
  raise exception 'ROLLBACK-OK% md5=%', res, md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure));
end $t$;
