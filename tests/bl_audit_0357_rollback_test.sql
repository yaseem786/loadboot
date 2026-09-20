-- bl_audit_0357 rollback-txn test. Run as-is: the final RAISE rolls everything back; expect "ROLLBACK-OK" with every case true.
do $t$
declare staff uuid:=gen_random_uuid(); gone uuid:=gen_random_uuid(); held uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  org uuid; rid_gone bigint; rid_held bigint; r jsonb; res text:=''; s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid(); s3 uuid:=gen_random_uuid(); s4 uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email,raw_user_meta_data) values
   (staff,'audit-0357-staff-'||staff||'@example.invalid','{"role":"driver"}'),(gone,'audit-0357-gone-'||gone||'@example.invalid','{"role":"driver"}'),
   (held,'audit-0357-held-'||held||'@example.invalid','{"role":"driver"}'),(other,'audit-0357-other-'||other||'@example.invalid','{"role":"driver"}');
  select id into strict org from public.organizations where kind='internal' and status='active';
  insert into app_private.staff_members(user_id,status) values(staff,'active');
  insert into public.organization_memberships(org_id,user_id,member_role,status) values(org,staff,'staff','active');
  insert into app_private.user_permission_grants(user_id,permission_key,effect) values(staff,'carriers.approve','allow');
  insert into auth.sessions(id,user_id) values (s1,gone),(s2,gone),(s3,held),(s4,other);
  insert into auth.refresh_tokens(token,user_id,session_id) values ('zz0357-a',gone::text,s1),('zz0357-b',gone::text,s2),('zz0357-legacy',gone::text,null),('zz0357-c',held::text,s3),('zz0357-d',other::text,s4);
  insert into app_private.account_deletion_requests(user_id,email) values(gone,'audit-0357-gone-'||gone||'@example.invalid') returning id into rid_gone;
  -- PROD has a BEFORE INSERT path on public.documents that takes carrier_id from the caller (a bare postgres insert got 23502 on prod,
  -- not on staging - env drift, 20 Sep). So insert the document AS the user, and BEFORE their request opens (0356 freezes uploads after).
  perform set_config('request.jwt.claim.sub',held::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',held,'role','authenticated')::text,true);
  insert into public.documents(carrier_id,type,file_name,file_path) values(held,'w9','zz0357',held::text||'/w9.pdf');
  insert into app_private.account_deletion_requests(user_id,email) values(held,'audit-0357-held-'||held||'@example.invalid') returning id into rid_held;
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  set local role authenticated;
  r := public.cc_account_deletion_process(rid_gone,'complete');
  reset role;
  res := res || ' c1_completed=' || ((select status from app_private.account_deletion_requests where id=rid_gone)='completed')::text;
  res := res || ' c2_sessions_gone=' || ((select count(*) from auth.sessions where user_id=gone)=0)::text;
  res := res || ' c3_refresh_tokens_gone_incl_legacy=' || ((select count(*) from auth.refresh_tokens where user_id=gone::text)=0)::text;
  res := res || ' c4_still_banned=' || ((select banned_until from auth.users where id=gone)='infinity')::text;
  set local role authenticated;
  r := public.cc_account_deletion_process(rid_held,'complete');
  reset role;
  res := res || ' c5_held_for_review=' || (r->>'code'='ERASURE_REVIEW_REQUIRED')::text;
  res := res || ' c6_held_user_sessions_kept=' || ((select count(*) from auth.sessions where user_id=held)=1 and (select count(*) from auth.refresh_tokens where user_id=held::text)=1)::text;
  res := res || ' c7_other_user_untouched=' || ((select count(*) from auth.sessions where user_id=other)=1 and (select count(*) from auth.refresh_tokens where user_id=other::text)=1)::text;
  raise exception 'ROLLBACK-OK% md5=%', res, md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure));
end $t$;
