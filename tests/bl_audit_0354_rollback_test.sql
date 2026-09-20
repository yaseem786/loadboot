-- bl_audit_0354 rollback-txn test. Run as-is: the final RAISE rolls everything back; expect "ROLLBACK-OK" with every case true.
do $t$
declare u uuid; staff uuid; r jsonb; res text := ''; c text;
begin
  for u in select id from auth.users order by created_at limit 200 loop
    perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
    if app_private.lc_cc_ok() then staff := u; exit; end if;
  end loop;
  if staff is null then raise exception 'RESULT BLOCKED: no staff user found'; end if;
  insert into app_private.lc_onboarding(visitor_key, docs) values ('ZZt0354_ob_0123456789', '[]');
  insert into app_private.lc_conversations(visitor_key) values ('ZZt0354_cv_0123456789');
  insert into storage.buckets(id,name) values ('zzt0354-bkt','zzt0354-bkt');
  insert into storage.objects(bucket_id,name,created_at,metadata) values
   ('documents','lc-onboarding/ZZt0354_ok_0123456789/old.png',  now()-interval '7 days 1 minute','{"size":70}'),
   ('documents','lc-onboarding/ZZt0354_yg_0123456789/young.png',now()-interval '6 days 23 hours','{"size":70}'),
   ('documents','lc-onboarding/ZZt0354_ob_0123456789/old.png',  now()-interval '30 days','{"size":70}'),
   ('documents','lc-onboarding/ZZt0354_cv_0123456789/old.png',  now()-interval '30 days','{"size":70}'),
   ('zzt0354-bkt','lc-onboarding/ZZt0354_bk_0123456789/old.png',  now()-interval '30 days','{"size":70}'),
   ('documents','carrier-docs/ZZt0354_px_0123456789/old.png',   now()-interval '30 days','{"size":70}');
  r := public.cc_lc_doc_remove_candidates();
  res := res || ' c1_eligible=' || (r->'candidates' @> '[{"name":"lc-onboarding/ZZt0354_ok_0123456789/old.png"}]')::text;
  res := res || ' c2_young_excluded=' || (not (r->'candidates' @> '[{"key":"ZZt0354_yg_0123456789"}]'))::text;
  res := res || ' c3_ob_row_excluded=' || (not (r->'candidates' @> '[{"key":"ZZt0354_ob_0123456789"}]'))::text;
  res := res || ' c4_conversation_excluded=' || (not (r->'candidates' @> '[{"key":"ZZt0354_cv_0123456789"}]'))::text;
  res := res || ' c5_other_bucket_prefix_excluded=' || (not (r->'candidates' @> '[{"key":"ZZt0354_bk_0123456789"}]') and not (r::text like '%ZZt0354_px%'))::text;
  r := public.cc_lc_doc_remove_candidates(interval '1 minute');
  res := res || ' c6_floor_clamped=' || (not (r->'candidates' @> '[{"key":"ZZt0354_yg_0123456789"}]') and r->>'min_age' = '7 days')::text;
  r := public.cc_lc_doc_remove_candidates(interval '60 days');
  res := res || ' c7_longer_age_respected=' || (not (r->'candidates' @> '[{"key":"ZZt0354_ok_0123456789"}]'))::text;
  c := 'FAIL'; begin perform public.lc_doc_recon_log_add(staff,'remove','lc-onboarding/ZZt0354_ok_0123456789/old.png',false,'removed'); exception when insufficient_privilege then c := 'true'; end;
  res := res || ' c8_log_refuses_staff=' || c;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  res := res || ' c9_log_service_ok=' || ((public.lc_doc_recon_log_add(staff,'remove','lc-onboarding/ZZt0354_ok_0123456789/old.png',false,'removed')->>'ok')::boolean
     and public.lc_doc_recon_log_add(staff,'remove','documents/x',false,'removed')->>'error'='bad_request'
     and public.lc_doc_recon_log_add(staff,'relink','lc-onboarding/a/b',false,'removed')->>'error'='bad_request'     )::text;
  -- counted in its own statement: a scalar subquery inside the expression above would use that statement's snapshot and see 0.
  res := res || ' c9b_exactly_one_row=' || ((select count(*) from app_private.lc_doc_recon_log where path like 'lc-onboarding/ZZt0354%' and result='removed' and dry_run=false and actor=staff)=1)::text;
  c := 'FAIL'; begin perform public.cc_lc_doc_remove_candidates(); exception when insufficient_privilege then c := 'true'; end;
  res := res || ' c10_service_role_not_staff_42501=' || c;
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  c := 'FAIL'; begin perform public.cc_lc_doc_remove_candidates(); exception when insufficient_privilege then c := 'true'; end;
  res := res || ' c11_nonstaff_42501=' || c;
  raise exception 'ROLLBACK-OK%', res;
end $t$;
