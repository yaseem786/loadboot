-- bl_cmp_0325_rollback_test.sql — audit F31. Rollback-txn test for migrations/bl_cmp_0325_doc_ai_verdict.sql.
-- PASS = error message starts with RESULT PASS. Nothing persists.
do $$
declare v_uid uuid; v_other uuid; v_doc uuid; v_doc2 uuid; v_ver jsonb; msg text := '';
begin
  -- two real carrier users (documents.carrier_id = user id, per policy docs_insert)
  select p.id into v_uid from public.profiles p join public.organizations o on o.owner_user_id = p.id where o.kind='carrier' order by o.created_at desc limit 1;
  select p.id into v_other from public.profiles p join public.organizations o on o.owner_user_id = p.id where o.kind='carrier' and p.id <> v_uid order by o.created_at desc limit 1;
  if v_uid is null or v_other is null then raise exception 'RESULT FAIL: need two carrier users'; end if;

  -- 1. carrier inserts WITH a verdict that lies about its origin → trigger stamps carrier-client
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into public.documents (carrier_id, type, file_name, file_path, ai_verdict)
  values (v_uid, 'insurance', 'test-coi.pdf', v_uid::text || '/test-coi.pdf',
          '{"verdict":"reject","doc_label":"COI","issues":[{"severity":"reject","problem":"holder is not LoadBoot"}],"summary":"x","recorded_by":"doc-precheck","recorded_at":"2020-01-01"}'::jsonb)
  returning id, ai_verdict into v_doc, v_ver;
  if v_ver->>'recorded_by' <> 'carrier-client' then raise exception 'RESULT FAIL: stamp did not override recorded_by (%)', v_ver->>'recorded_by'; end if;
  if (v_ver->>'recorded_at')::timestamptz < now() - interval '1 minute' then raise exception 'RESULT FAIL: recorded_at not stamped'; end if;
  if v_ver->>'verdict' <> 'reject' then raise exception 'RESULT FAIL: verdict body lost'; end if;
  msg := msg || format(' doc=%s stamped=%s;', v_doc, v_ver->>'recorded_by');

  -- 2. write-once RPC on a row that already has a verdict → false
  if public.doc_set_ai_verdict(v_doc, '{"verdict":"pass"}'::jsonb) then raise exception 'RESULT FAIL: write-once violated'; end if;
  if (select ai_verdict->>'verdict' from public.documents where id = v_doc) <> 'reject' then raise exception 'RESULT FAIL: verdict overwritten'; end if;

  -- 3. insert without verdict, then set it via RPC (owner) → true, stamped carrier-client even if source lies
  insert into public.documents (carrier_id, type, file_name, file_path)
  values (v_uid, 'w9', 'test-w9.pdf', v_uid::text || '/test-w9.pdf') returning id into v_doc2;
  if (select ai_verdict from public.documents where id = v_doc2) is not null then raise exception 'RESULT FAIL: null verdict got stamped'; end if;
  if not public.doc_set_ai_verdict(v_doc2, '{"verdict":"warning","summary":"unsigned"}'::jsonb, 'doc-precheck') then
    raise exception 'RESULT FAIL: owner could not set verdict on null row'; end if;
  select ai_verdict into v_ver from public.documents where id = v_doc2;
  if v_ver->>'recorded_by' <> 'carrier-client' or v_ver->>'verdict' <> 'warning' then
    raise exception 'RESULT FAIL: owner RPC stamp wrong: %', v_ver; end if;

  -- 4. another carrier → 42501 ; bad payload → 22023
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  begin
    perform public.doc_set_ai_verdict(v_doc2, '{"verdict":"pass"}'::jsonb);
    raise exception 'RESULT FAIL: other carrier could touch the document';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.doc_set_ai_verdict(v_doc2, '"nope"'::jsonb);
    raise exception 'RESULT FAIL: non-object payload accepted';
  exception when sqlstate '22023' then null; when sqlstate '42501' then null; end;

  -- 5. service_role may set a server source on a null row (insert as the owner again — prod's protect_document_insert
  --    checks file_path against auth.uid(); staging lacks that trigger, a drift noted in HANDOFF)
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into public.documents (carrier_id, type, file_name, file_path)
  values (v_uid, 'authority', 'test-auth.pdf', v_uid::text || '/test-auth.pdf') returning id into v_doc2;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  if not public.doc_set_ai_verdict(v_doc2, '{"verdict":"pass"}'::jsonb, 'doc-precheck') then raise exception 'RESULT FAIL: service_role could not set'; end if;
  if (select ai_verdict->>'recorded_by' from public.documents where id = v_doc2) <> 'doc-precheck' then raise exception 'RESULT FAIL: service source not kept'; end if;

  -- 6. ACL
  if exists (select 1 from information_schema.routine_privileges where specific_schema='public' and routine_name='doc_set_ai_verdict' and grantee in ('anon','PUBLIC')) then
    raise exception 'RESULT FAIL: anon can execute doc_set_ai_verdict'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='documents' and grantee='anon') then
    raise exception 'RESULT FAIL: anon still has grants on documents'; end if;

  raise exception 'RESULT PASS (all writes rolled back):%', msg;
end $$;
