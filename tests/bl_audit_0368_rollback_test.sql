-- bl_audit_0368 rollback-txn test. Run AFTER the migration (or with it prepended) in one transaction; ends in ROLLBACK-OK.
-- Fixture: one open request for an existing user, an inventory with a 'documents' item and a 'storage' twin on the same
-- bucket+path plus one unrelated item, and a real storage.objects row behind the path (deleted by the "purge" step below).
do $t$
declare v_owner uuid := (select s.user_id from app_private.staff_members s join auth.users u on u.id = s.user_id where u.email in ('20190myaseen@gmail.com','owner@lb.test') and s.status = 'active' limit 1);
        v_user uuid := (select u.id from auth.users u where not exists (select 1 from app_private.staff_members s where s.user_id = u.id) and not exists (select 1 from app_private.account_deletion_requests q where q.user_id = u.id and q.status = 'requested') order by u.created_at limit 1);
        v_req bigint; k_doc text; k_sto text; k_other text; r jsonb; c jsonb; p text := 'zzt0368/'||gen_random_uuid()||'/a.png';
begin
  insert into app_private.account_deletion_requests(user_id, email, status, requested_at) values (v_user, 'zzt0368@example.invalid', 'requested', now()) returning id into v_req;
  insert into storage.objects(bucket_id, name, owner, metadata) values ('documents', p, v_user, '{"size":1}');
  insert into app_private.account_erasure_inventories(request_id, user_id, items) values (v_req, v_user, jsonb_build_array(
    jsonb_build_object('source','documents','bucket','documents','path',p,'kind','other','record_id','x1'),
    jsonb_build_object('source','storage','bucket','documents','path',p),
    jsonb_build_object('source','documents','bucket','documents','path','zzt0368/none/'||gen_random_uuid()||'/b.png','kind','other','record_id','x2')));
  select md5(e.item::text) into k_doc from app_private.account_erasure_inventories i cross join lateral jsonb_array_elements(i.items) e(item) where i.request_id = v_req and e.item->>'source' = 'documents' and e.item->>'path' = p;
  select md5(e.item::text) into k_sto from app_private.account_erasure_inventories i cross join lateral jsonb_array_elements(i.items) e(item) where i.request_id = v_req and e.item->>'source' = 'storage';
  select md5(e.item::text) into k_other from app_private.account_erasure_inventories i cross join lateral jsonb_array_elements(i.items) e(item) where i.request_id = v_req and e.item->>'record_id' = 'x2';
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  -- c1 decide on the documents item covers the storage twin (applied_to 2), not the unrelated item
  r := public.cc_erasure_decide(v_req, k_doc, 'remove');
  if (r->>'applied_to')::int <> 2 then raise exception 'c1 applied_to % (want 2): %', r->>'applied_to', r; end if;
  if (select count(*) from app_private.erasure_item_decisions where request_id = v_req and decision = 'remove' and removed_at is null) <> 2 then raise exception 'c1 rows'; end if;
  if exists (select 1 from app_private.erasure_item_decisions where request_id = v_req and item_key = k_other) then raise exception 'c1 leaked to unrelated item'; end if;
  -- c2 the unrelated item with no object behind it: remove -> immediate no_object evidence, applied_to 1
  r := public.cc_erasure_decide(v_req, k_other, 'remove');
  if (r->>'applied_to')::int <> 1 or (select removal_result from app_private.erasure_item_decisions where request_id = v_req and item_key = k_other) <> 'no_object' then raise exception 'c2 %', r; end if;
  -- c3 candidates: exactly ONE for the twin pair
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  c := public.erasure_removal_candidates(v_req);
  if jsonb_array_length(c->'candidates') <> 1 or c->'candidates'->0->>'path' <> p then raise exception 'c3 %', c; end if;
  -- c4 a failure result before removal marks only un-evidenced rows (both twins), leaves removed_at null
  r := public.erasure_removal_mark(v_req, k_sto, 'storage_failed');
  if (r->>'rows')::int <> 2 or (select count(*) from app_private.erasure_item_decisions where request_id = v_req and removal_result = 'storage_failed' and removed_at is null) <> 2 then raise exception 'c4 %', r; end if;
  -- c5 "purge": object deleted, then 'removed' evidence on the storage twin's key lands on both rows
  update storage.objects set name = p || '.moved' where bucket_id = 'documents' and name = p;   -- storage.protect_delete forbids SQL deletes; moving the object off the path is the same for the candidate/mark logic
  r := public.erasure_removal_mark(v_req, k_sto, 'removed');
  if (r->>'rows')::int <> 2 or (select count(*) from app_private.erasure_item_decisions where request_id = v_req and removal_result = 'removed' and removed_at is not null) <> 2 then raise exception 'c5 %', r; end if;
  -- c6 a later failure result must NOT overwrite evidence
  r := public.erasure_removal_mark(v_req, k_doc, 'storage_failed');
  if (r->>'rows')::int <> 0 or (select count(*) from app_private.erasure_item_decisions where request_id = v_req and removal_result = 'removed') <> 2 then raise exception 'c6 %', r; end if;
  -- c7 gate: every item decided, every remove evidenced -> processor passes the review gate (it will fail later on other grounds or succeed; we only read the gate fields)
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  if (select count(*) from app_private.erasure_item_decisions d where d.request_id = v_req and d.decision = 'remove' and d.removed_at is null) <> 0 then raise exception 'c7 pending'; end if;
  -- c8 hold on the doc item covers the twin too (re-decision allowed only where not purged: both purged -> 0 rows change, applied_to still counts loop)
  r := public.cc_erasure_decide(v_req, k_doc, 'hold', 'C_qualification', current_date + 1);
  if (select count(*) from app_private.erasure_item_decisions where request_id = v_req and decision = 'hold') <> 0 then raise exception 'c8 purged rows must stay final'; end if;
  -- c9 anon/authenticated cannot call the service functions
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  begin perform public.erasure_removal_mark(v_req, k_doc, 'removed'); raise exception 'c9 mark open'; exception when insufficient_privilege then null; end;
  begin perform public.erasure_removal_candidates(v_req); raise exception 'c9 cand open'; exception when insufficient_privilege then null; end;
  raise exception 'ROLLBACK-OK 9/9 bl_audit_0368';
end $t$;
