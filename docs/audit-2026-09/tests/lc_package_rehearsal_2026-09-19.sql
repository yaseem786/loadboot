-- lc_package_rehearsal_2026-09-19.sql — live-chat package (bl_sec_0335 + bl_sec_0336 + bl_audit_0344).
-- PASS = the block RAISEs 'RESULT ...' with every case as listed below; the RAISE rolls back every synthetic row
-- (2 lc_onboarding, 2 lc_conversations, the lc_save_windows row and the temporary max_saves=3 config change).
-- STAGING 2026-09-19 (package already applied 8–10 Sep): PASS.  PROD 2026-09-19 (right after apply): PASS, rows 1->3 then rolled back.
-- Expected: c1 not authorized; c2 true; c3 not authorized; c3b false; c3c not found; c4 true; c5 not authorized; c5b true;
--           c6 not authorized; c7 42501; c8 not found; c9 not found; c10 true; c11.1-3 true, c11.4 rate_limit;
--           grants anon: upload_check=true doc_log=false.
do $$
declare k text := 'v'||repeat('ab',24); k2 text := 'w'||repeat('cd',24); u uuid := gen_random_uuid(); c1 uuid; c2 uuid; r jsonb; msg text := ''; i int; n0 int; n1 int;
begin
  select count(*) into n0 from app_private.lc_onboarding;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  r := public.lc_ob_upload_check(k, null); msg := msg || 'c1 unknown key=' || (r->>'error') || '; ';
  insert into app_private.lc_onboarding(visitor_key, role, step_key, data) values (k,'carrier','step1','{"synthetic":true}');
  insert into app_private.lc_onboarding(visitor_key, role, step_key, data) values (k2,'carrier','step1','{"synthetic":true}');
  r := public.lc_ob_upload_check(k, null); msg := msg || 'c2 guest row=' || coalesce(r->>'ok', r->>'error') || '; ';
  insert into app_private.lc_conversations(visitor_key, user_id, origin, page, mode) values (k, u, 'carrier', '/x', 'bot') returning id into c1;
  insert into app_private.lc_conversations(visitor_key, user_id, origin, page, mode) values ('z'||repeat('ef',24), null, 'website', '/y', 'bot') returning id into c2;
  update app_private.lc_onboarding set conversation_id = c1 where visitor_key = k;
  r := public.lc_ob_upload_check(k, null); msg := msg || 'c3 anon vs account-chat=' || coalesce(r->>'ok', r->>'error') || '; ';
  r := public.lc_ob_get(k); msg := msg || 'c3b lc_ob_get anon exists=' || (r->>'exists') || '; ';
  r := public.lc_ob_save(k, null, null, 'step2', '{"a":1}'); msg := msg || 'c3c lc_ob_save anon bypass=' || coalesce(r->>'ok', r->>'error') || '; ';
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',u)::text, true);
  r := public.lc_ob_upload_check(k, null); msg := msg || 'c4 owner=' || coalesce(r->>'ok', r->>'error') || '; ';
  r := public.lc_ob_upload_check(k, c2); msg := msg || 'c5 owner+foreign conv=' || coalesce(r->>'ok', r->>'error') || '; ';
  r := public.lc_ob_get(k); msg := msg || 'c5b lc_ob_get owner exists=' || (r->>'exists') || '; ';
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',gen_random_uuid())::text, true);
  r := public.lc_ob_upload_check(k, null); msg := msg || 'c6 other user=' || coalesce(r->>'ok', r->>'error') || '; ';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin r := public.lc_ob_doc_log(k2, null, '{"t":"other"}', null); msg := msg || 'c7 doc_log anon=NO-EXCEPTION!; ';
  exception when insufficient_privilege then msg := msg || 'c7 doc_log anon=42501; '; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.lc_ob_doc_log('q'||repeat('gh',24), null, '{"t":"other"}', null); msg := msg || 'c8 doc_log svc unknown=' || coalesce(r->>'ok', r->>'error') || '; ';
  r := public.lc_ob_doc_log(k2, c2, '{"t":"other"}', null); msg := msg || 'c9 doc_log svc foreign conv=' || coalesce(r->>'ok', r->>'error') || '; ';
  r := public.lc_ob_doc_log(k2, null, '{"t":"other"}', null); msg := msg || 'c10 doc_log svc ok=' || coalesce(r->>'ok', r->>'error') || '; ';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  update app_private.lc_save_limit_config set max_saves = 3;
  for i in 1..4 loop r := public.lc_ob_save(k2, null, null, 'step'||i, '{"b":1}'); msg := msg || 'c11.' || i || '=' || coalesce(r->>'ok', r->>'error') || ' '; end loop;
  select count(*) into n1 from app_private.lc_onboarding;
  msg := msg || '; rows ' || n0 || '->' || n1 || ' (rolled back); grants anon: upload_check=' || has_function_privilege('anon','public.lc_ob_upload_check(text,uuid)','execute') || ' doc_log=' || has_function_privilege('anon','public.lc_ob_doc_log(text,uuid,jsonb,text)','execute');
  raise exception 'RESULT % ', msg;
end $$;
