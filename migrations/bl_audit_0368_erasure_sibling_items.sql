-- bl_audit_0368 — ERASURE gate: one file, one decision. Found on the 22 Sep prod browser check (request 11): the inventory lists the
-- same Storage object twice — once as the public.documents row (source 'documents') and once as the storage.objects row (source
-- 'storage'), same bucket+path. Under 0365 that meant (a) staff decide every file twice, and (b) after erasure-purge removed the
-- object for the first item, the twin stayed 'remove' with no evidence and vanished from erasure_removal_candidates (object gone),
-- so the processor gate could never reach pending_removal = 0. Fix, all inside the existing functions, no schema change:
--   cc_erasure_decide       applies the decision to every inventory item that shares the same bucket+path
--   erasure_removal_mark    'removed' evidence lands on every 'remove' row for that bucket+path; a failure result never overwrites
--                           a row that already has removal evidence
--   erasure_removal_candidates  one candidate per bucket+path (purge deletes each object once)
do $g$ begin
  if md5(pg_get_functiondef('public.cc_erasure_decide(bigint,text,text,text,date,text)'::regprocedure)) <> '00ce9c2c4657fec7fd3cb9b53585958e'
  or md5(pg_get_functiondef('public.erasure_removal_mark(bigint,text,text)'::regprocedure)) <> '621dd1a04c7cd919811e600262167bca' then
    raise exception 'bl_audit_0368: baseline moved, refusing';
  end if;
end $g$;

create or replace function public.cc_erasure_decide(p_request_id bigint, p_item_key text, p_decision text,
  p_retention_class text default null, p_retain_until date default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = app_private, public as $fn$
declare it jsonb; v_no_obj boolean; r record; n int := 0;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('remove','hold') then return jsonb_build_object('error','bad_decision'); end if;
  if p_decision = 'hold' and p_retention_class is not null and not exists (select 1 from app_private.retention_classes rc where rc.key = p_retention_class) then return jsonb_build_object('error','unknown_retention_class'); end if;
  if p_decision = 'hold' and (p_retention_class is null or p_retain_until is null or p_retain_until <= current_date) then
    return jsonb_build_object('error','hold_needs_class_and_future_date');
  end if;
  if not exists (select 1 from app_private.account_deletion_requests q where q.id = p_request_id and q.status = 'requested') then
    return jsonb_build_object('error','no_open_request');
  end if;
  select e.item into it from app_private.account_erasure_inventories i
    cross join lateral jsonb_array_elements(i.items) e(item)
   where i.request_id = p_request_id and md5(e.item::text) = p_item_key limit 1;
  if it is null then return jsonb_build_object('error','item_not_in_inventory'); end if;
  -- a 'remove' on a reference that has no Storage object behind it (missing path, or already gone) needs no purge: evidence = no_object
  v_no_obj := (p_decision = 'remove') and not exists (select 1 from storage.objects so where so.bucket_id = it->>'bucket' and so.name = it->>'path');
  -- bl_audit_0368: the decision covers the clicked item AND every twin that points at the same bucket+path
  for r in
    select md5(e.item::text) as k, e.item as item
      from app_private.account_erasure_inventories i cross join lateral jsonb_array_elements(i.items) e(item)
     where i.request_id = p_request_id
       and (md5(e.item::text) = p_item_key
            or (it->>'path' is not null and e.item->>'path' = it->>'path' and e.item->>'bucket' is not distinct from it->>'bucket'))
  loop
    insert into app_private.erasure_item_decisions(request_id, item_key, source, bucket, path, decision, retention_class, retain_until, note, decided_by, removed_at, removal_result)
    values (p_request_id, r.k, r.item->>'source', r.item->>'bucket', r.item->>'path', p_decision, p_retention_class, p_retain_until, p_note, auth.uid(),
            case when v_no_obj then now() end, case when v_no_obj then 'no_object' end)
    on conflict (request_id, item_key) do update
      set decision = excluded.decision, retention_class = excluded.retention_class, retain_until = excluded.retain_until,
          note = excluded.note, decided_by = excluded.decided_by, decided_at = now(),
          removed_at = excluded.removed_at, removal_result = excluded.removal_result
      where app_private.erasure_item_decisions.removed_at is null or app_private.erasure_item_decisions.removal_result = 'no_object';   -- a purged item's record is final
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'item_key', p_item_key, 'decision', p_decision, 'applied_to', n);
end $fn$;
revoke all on function public.cc_erasure_decide(bigint, text, text, text, date, text) from public, anon;
grant execute on function public.cc_erasure_decide(bigint, text, text, text, date, text) to authenticated, service_role;

create or replace function public.erasure_removal_candidates(p_request_id bigint)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $fn$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- bl_audit_0368: one candidate per object (twins share bucket+path; the mark below covers them all)
  return jsonb_build_object('candidates', coalesce((select jsonb_agg(jsonb_build_object('item_key', c.item_key, 'bucket', c.bucket, 'path', c.path)) from (
    select distinct on (d.bucket, d.path) d.item_key, d.bucket, d.path
    from app_private.erasure_item_decisions d
    where d.request_id = p_request_id and d.decision = 'remove' and d.removed_at is null
      and d.bucket is not null and d.path is not null and d.path !~ '\.\.' and d.path <> ''
      and exists (select 1 from storage.objects so where so.bucket_id = d.bucket and so.name = d.path)
    order by d.bucket, d.path, d.item_key) c), '[]'::jsonb));
end $fn$;
revoke all on function public.erasure_removal_candidates(bigint) from public, anon, authenticated;
grant execute on function public.erasure_removal_candidates(bigint) to service_role;

create or replace function public.erasure_removal_mark(p_request_id bigint, p_item_key text, p_result text)
returns jsonb language plpgsql volatile security definer set search_path = app_private, public as $fn$
declare v_b text; v_p text; n int;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_result not in ('removed','storage_failed','would_remove') then return jsonb_build_object('error','bad_result'); end if;
  select bucket, path into v_b, v_p from app_private.erasure_item_decisions where request_id = p_request_id and item_key = p_item_key;
  -- bl_audit_0368: evidence for the object reaches every 'remove' row that points at it; a non-removed result never overwrites evidence
  update app_private.erasure_item_decisions
     set removed_at = case when p_result = 'removed' then now() else removed_at end,
         removal_result = p_result
   where request_id = p_request_id and decision = 'remove'
     and (item_key = p_item_key or (v_p is not null and path = v_p and bucket is not distinct from v_b))
     and (p_result = 'removed' or removed_at is null);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'rows', n);
end $fn$;
revoke all on function public.erasure_removal_mark(bigint, text, text) from public, anon, authenticated;
grant execute on function public.erasure_removal_mark(bigint, text, text) to service_role;
