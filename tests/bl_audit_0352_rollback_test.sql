-- bl_audit_0352 rollback-txn test. Run as-is: the final RAISE rolls everything back; expect "ROLLBACK-OK" with every case true.
-- Finds a real staff uid by probing app_private.lc_cc_ok() (no id hard-coded). Leaves zero fixtures.
-- Note: grace uses strict "<" against now() (txn start), so an object created at now() is hidden even with grace 0 inside one txn.
do $t$
declare u uuid; staff uuid; r jsonb; res text := ''; c5 text := 'FAIL';
begin
  for u in select id from auth.users order by created_at limit 200 loop
    perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
    if app_private.lc_cc_ok() then staff := u; exit; end if;
  end loop;
  if staff is null then raise exception 'RESULT BLOCKED: no staff user found'; end if;
  insert into app_private.lc_onboarding(visitor_key, docs) values
   ('ZZt0352_a_0123456789', '[{"t":"coi","f":"x.png","path":"lc-onboarding/ZZt0352_a_0123456789/x.png","verdict":"pass","ts":"2026-09-19T00:00:00Z"}]'),
   ('ZZt0352_d_0123456789', '[{"t":"w9","f":"m.png","path":"lc-onboarding/ZZt0352_d_0123456789/m.png","verdict":"pass","ts":"2026-09-19T00:00:00Z"}]');
  insert into storage.objects(bucket_id,name,created_at,metadata) values
   ('documents','lc-onboarding/ZZt0352_b_0123456789/old.png', now()-interval '2 hours','{"size":70}'),
   ('documents','lc-onboarding/ZZt0352_c_0123456789/fresh.png', now(),'{"size":70}'),
   ('documents','lc-onboarding/ZZt0352_d_0123456789/m.png', now()-interval '2 hours','{"size":70}');
  r := public.cc_lc_doc_reconcile();
  res := res || ' c1_dangling=' || (r->'dangling' @> '[{"path":"lc-onboarding/ZZt0352_a_0123456789/x.png"}]')::text;
  res := res || ' c2_orphan=' || (r->'orphans' @> '[{"name":"lc-onboarding/ZZt0352_b_0123456789/old.png","looks_test":false,"has_ob_row":false}]')::text;
  res := res || ' c3_fresh_hidden=' || (not (r->'orphans' @> '[{"key":"ZZt0352_c_0123456789"}]'))::text;
  res := res || ' c4_pair_clean=' || (not (r->'orphans' @> '[{"key":"ZZt0352_d_0123456789"}]') and not (r->'dangling' @> '[{"visitor_key":"ZZt0352_d_0123456789"}]'))::text;
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  begin perform public.cc_lc_doc_reconcile(); exception when insufficient_privilege then c5 := 'true'; end;
  res := res || ' c5_nonstaff_42501=' || c5 || ' c5b_anon_no_exec=' || (not has_function_privilege('anon','public.cc_lc_doc_reconcile(interval)','execute'))::text;
  raise exception 'ROLLBACK-OK %', res;
end $t$;
