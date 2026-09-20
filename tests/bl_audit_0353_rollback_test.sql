-- bl_audit_0353 rollback-txn test. Run as-is: the final RAISE rolls everything back; expect "ROLLBACK-OK" with every case true.
do $t$
declare u uuid; staff uuid; r jsonb; res text := ''; c7 text := 'FAIL'; n int;
begin
  for u in select id from auth.users order by created_at limit 200 loop
    perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
    if app_private.lc_cc_ok() then staff := u; exit; end if;
  end loop;
  if staff is null then raise exception 'RESULT BLOCKED: no staff user found'; end if;
  insert into app_private.lc_onboarding(visitor_key, docs) values
   ('ZZt0353_a_0123456789', '[]'),
   ('ZZt0353_l_0123456789', '[{"t":"coi","f":"k.png","path":"lc-onboarding/ZZt0353_l_0123456789/k.png","verdict":"pass","ts":"x"}]');
  insert into storage.objects(bucket_id,name,created_at,metadata) values
   ('documents','lc-onboarding/ZZt0353_a_0123456789/old.png', now()-interval '2 hours','{"size":70}'),
   ('documents','lc-onboarding/ZZt0353_a_0123456789/fresh.png', now(),'{"size":70}'),
   ('documents','lc-onboarding/ZZt0353_n_0123456789/old.png', now()-interval '2 hours','{"size":70}'),
   ('documents','lc-onboarding/ZZt0353_l_0123456789/k.png', now()-interval '2 hours','{"size":70}');
  r := public.cc_lc_doc_relink('lc-onboarding/ZZt0353_a_0123456789/old.png');
  select jsonb_array_length(docs) into n from app_private.lc_onboarding where visitor_key='ZZt0353_a_0123456789';
  res := res || ' c1_dry_default_no_write=' || (r->>'result'='would_relink' and n=0)::text;
  r := public.cc_lc_doc_relink('lc-onboarding/ZZt0353_a_0123456789/old.png', false);
  res := res || ' c2_relinked=' || (r->>'result'='relinked' and exists(select 1 from app_private.lc_onboarding where visitor_key='ZZt0353_a_0123456789' and docs @> '[{"path":"lc-onboarding/ZZt0353_a_0123456789/old.png","verdict":"recovered","t":"unknown"}]'))::text;
  r := public.cc_lc_doc_relink('lc-onboarding/ZZt0353_a_0123456789/old.png', false);
  select jsonb_array_length(docs) into n from app_private.lc_onboarding where visitor_key='ZZt0353_a_0123456789';
  res := res || ' c3_idempotent=' || (r->>'result'='already_linked' and n=1)::text;
  res := res || ' c4_fresh=' || (public.cc_lc_doc_relink('lc-onboarding/ZZt0353_a_0123456789/fresh.png', false)->>'result'='too_fresh')::text;
  res := res || ' c5_no_ob_row=' || (public.cc_lc_doc_relink('lc-onboarding/ZZt0353_n_0123456789/old.png', false)->>'result'='no_ob_row')::text;
  res := res || ' c6_no_object_badpath=' || (public.cc_lc_doc_relink('lc-onboarding/ZZt0353_a_0123456789/ghost.png', false)->>'result'='no_object' and public.cc_lc_doc_relink('documents/x', false)->>'error'='bad_path' and public.cc_lc_doc_relink('lc-onboarding/ZZt0353_l_0123456789/k.png', false)->>'result'='already_linked')::text;
  select count(*) into n from app_private.lc_doc_recon_log where path like 'lc-onboarding/ZZt0353%';
  res := res || ' c8_logged=' || (n=7)::text;
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  begin perform public.cc_lc_doc_relink('lc-onboarding/ZZt0353_a_0123456789/old.png', false); exception when insufficient_privilege then c7 := 'true'; end;
  res := res || ' c7_nonstaff_42501=' || c7;
  raise exception 'ROLLBACK-OK%', res;
end $t$;
