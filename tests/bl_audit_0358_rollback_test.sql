-- bl_audit_0358 rollback-txn test. Run as-is; expect "ROLLBACK-OK" with every case true.
do $t$
declare plain uuid:=gen_random_uuid(); owner_u uuid; org uuid; res text:=''; n int; r_owner uuid;
begin
  select id into strict org from public.organizations where kind='internal' and status='active';
  select id into strict r_owner from app_private.roles where key='owner';
  insert into auth.users(id,email,raw_user_meta_data) values (plain,'audit-0358-plain-'||plain||'@example.invalid','{"role":"driver"}');
  insert into app_private.staff_members(user_id,status) values(plain,'active');
  insert into public.organization_memberships(org_id,user_id,member_role,status) values(org,plain,'staff','active');
  insert into storage.objects(bucket_id,name,owner,metadata) values ('documents','ZZt0358carrier/insurance/coi.pdf',null,'{"size":70}');
  perform set_config('request.jwt.claim.sub',plain::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',plain,'role','authenticated')::text,true);
  set local role authenticated;
  res := res || ' c1_plain_staff_is_active=' || public.is_active_staff()::text;
  select count(*) into n from storage.objects where name='ZZt0358carrier/insurance/coi.pdf';
  res := res || ' c2_plain_staff_cannot_read=' || (n=0)::text;
  reset role;
  select user_id into owner_u from app_private.user_role_assignments a where a.role_id=r_owner and a.status='active' and a.scope_type='global' limit 1;
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_u,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into n from storage.objects where name='ZZt0358carrier/insurance/coi.pdf';
  res := res || ' c3_owner_still_reads=' || (n=1)::text;
  reset role;
  res := res || ' c4_blanket_gone=' || (not exists(select 1 from pg_policies where tablename='objects' and policyname='staff read documents'))::text;
  raise exception 'ROLLBACK-OK%', res;
end $t$;
