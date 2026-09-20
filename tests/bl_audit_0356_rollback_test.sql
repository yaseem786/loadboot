-- bl_audit_0356 rollback-txn test. Run as-is: the final RAISE rolls everything back; expect "ROLLBACK-OK" with every case true.
do $t$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); rid bigint; res text:=''; c text; n int;
  addr_b text:='audit-0356-b-'||b||'@example.invalid'; kb text:='ZZt0356_frozen_0123456789'; ka text:='ZZt0356_free___0123456789';
begin
  insert into auth.users(id,email,raw_user_meta_data) values (a,'audit-0356-a-'||a||'@example.invalid','{"role":"driver"}'),(b,addr_b,'{"role":"driver"}');
  insert into app_private.account_deletion_requests(user_id,email) values(b,addr_b) returning id into rid;
  insert into app_private.lc_onboarding(visitor_key,data,docs) values (kb, jsonb_build_object('email',upper(addr_b)), '[]'), (ka, '{"email":"free-0356@example.invalid"}', '[]');
  insert into storage.objects(bucket_id,name,owner,metadata) values ('documents', b::text||'/existing.pdf', b, '{"size":70}');

  -- user A: nothing open -> everything works
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  c:='true'; begin insert into public.documents(carrier_id,type,file_name,file_path) values(a,'w9','zz0356',a::text||'/w9.pdf'); exception when others then c:='FAIL '||sqlstate; end;
  res := res || ' c1_free_user_documents_insert=' || c;
  c:='true'; begin insert into storage.objects(bucket_id,name,owner,metadata) values('documents',a::text||'/w9.pdf',a,'{"size":70}'); exception when others then c:='FAIL '||sqlstate; end;
  res := res || ' c2_free_user_storage_insert=' || c;
  res := res || ' c3_free_user_not_frozen=' || (not public.my_uploads_frozen())::text;

  -- user B: open request -> frozen
  reset role;
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  set local role authenticated;
  res := res || ' c4_frozen_flag=' || public.my_uploads_frozen()::text;
  c:='FAIL no error'; begin insert into public.documents(carrier_id,type,file_name,file_path) values(b,'w9','zz0356',b::text||'/w9.pdf'); exception when insufficient_privilege then c:='true'; when others then c:='FAIL '||sqlstate; end;
  res := res || ' c5_frozen_documents_insert_refused=' || c;
  c:='FAIL no error'; begin insert into storage.objects(bucket_id,name,owner,metadata) values('documents',b::text||'/new.pdf',b,'{"size":70}'); exception when insufficient_privilege then c:='true'; when others then c:='FAIL '||sqlstate; end;
  res := res || ' c6_frozen_storage_insert_refused=' || c;
  res := res || ' c7_chat_check_frozen_by_email=' || (public.lc_ob_upload_check(kb,null)->>'error'='frozen')::text;
  -- a LOGGED-IN frozen user is frozen on every chat row, not only the one carrying their email (first draft of this test expected the opposite; the function was right)
  res := res || ' c8_frozen_login_blocks_any_chat_row=' || (public.lc_ob_upload_check(ka,null)->>'error'='frozen')::text;

  -- request cancelled -> freeze lifts at once
  reset role;
  update app_private.account_deletion_requests set status='cancelled' where id=rid;
  set local role authenticated;
  c:='true'; begin insert into public.documents(carrier_id,type,file_name,file_path) values(b,'w9','zz0356',b::text||'/w9.pdf'); exception when others then c:='FAIL '||sqlstate; end;
  res := res || ' c9_cancel_lifts_documents=' || c;
  c:='true'; begin insert into storage.objects(bucket_id,name,owner,metadata) values('documents',b::text||'/new.pdf',b,'{"size":70}'); exception when others then c:='FAIL '||sqlstate; end;
  res := res || ' c10_cancel_lifts_storage=' || c;
  res := res || ' c11_chat_check_lifted=' || (public.lc_ob_upload_check(kb,null)->>'ok'='true')::text;
  reset role;

  -- anon guest with no login and an unrelated row is untouched
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  res := res || ' c12_anon_guest_ok=' || (public.lc_ob_upload_check(ka,null)->>'ok'='true')::text;
  res := res || ' c13_anon_cannot_call_helper=' || (not has_function_privilege('anon','public.my_uploads_frozen()','execute'))::text;
  raise exception 'ROLLBACK-OK%', res;
end $t$;
