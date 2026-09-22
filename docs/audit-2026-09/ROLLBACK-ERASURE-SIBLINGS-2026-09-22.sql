-- ROLLBACK for bl_audit_0368 (both envs). Restores the pre-0368 bodies verbatim: cc_erasure_decide as left by bl_audit_0366,
-- erasure_removal_candidates and erasure_removal_mark as created by bl_audit_0365. Guarded on the 0368 body hashes.
do $g$ begin
  if md5(pg_get_functiondef('public.cc_erasure_decide(bigint,text,text,text,date,text)'::regprocedure)) <> 'dd26d09d915005fb6d32167c25958685'
  or md5(pg_get_functiondef('public.erasure_removal_mark(bigint,text,text)'::regprocedure)) <> '91fa14e4cf451d7ed7ba976f14dccaa2'
  or md5(pg_get_functiondef('public.erasure_removal_candidates(bigint)'::regprocedure)) <> '4c3f211af1b1be3fca91a1165d584eb8' then
    raise exception 'ROLLBACK-0368: bodies are not the 0368 versions, refusing';
  end if;
end $g$;
CREATE OR REPLACE FUNCTION public.cc_erasure_decide(p_request_id bigint, p_item_key text, p_decision text, p_retention_class text DEFAULT NULL::text, p_retain_until date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare it jsonb; v_no_obj boolean;
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
  v_no_obj := (p_decision = 'remove') and not exists (select 1 from storage.objects so where so.bucket_id = it->>'bucket' and so.name = it->>'path');
  insert into app_private.erasure_item_decisions(request_id, item_key, source, bucket, path, decision, retention_class, retain_until, note, decided_by, removed_at, removal_result)
  values (p_request_id, p_item_key, it->>'source', it->>'bucket', it->>'path', p_decision, p_retention_class, p_retain_until, p_note, auth.uid(),
          case when v_no_obj then now() end, case when v_no_obj then 'no_object' end)
  on conflict (request_id, item_key) do update
    set decision = excluded.decision, retention_class = excluded.retention_class, retain_until = excluded.retain_until,
        note = excluded.note, decided_by = excluded.decided_by, decided_at = now(),
        removed_at = excluded.removed_at, removal_result = excluded.removal_result
    where app_private.erasure_item_decisions.removed_at is null or app_private.erasure_item_decisions.removal_result = 'no_object';
  return jsonb_build_object('ok', true, 'item_key', p_item_key, 'decision', p_decision);
end $function$;
create or replace function public.erasure_removal_candidates(p_request_id bigint)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $fn$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('candidates', coalesce((select jsonb_agg(jsonb_build_object('item_key', d.item_key, 'bucket', d.bucket, 'path', d.path))
    from app_private.erasure_item_decisions d
    where d.request_id = p_request_id and d.decision = 'remove' and d.removed_at is null
      and d.bucket is not null and d.path is not null and d.path !~ '\.\.' and d.path <> ''
      and exists (select 1 from storage.objects so where so.bucket_id = d.bucket and so.name = d.path)), '[]'::jsonb));
end $fn$;
create or replace function public.erasure_removal_mark(p_request_id bigint, p_item_key text, p_result text)
returns jsonb language plpgsql volatile security definer set search_path = app_private, public as $fn$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_result not in ('removed','storage_failed','would_remove') then return jsonb_build_object('error','bad_result'); end if;
  update app_private.erasure_item_decisions
     set removed_at = case when p_result = 'removed' then now() else removed_at end,
         removal_result = p_result
   where request_id = p_request_id and item_key = p_item_key and decision = 'remove';
  return jsonb_build_object('ok', found);
end $fn$;
-- grants are untouched by CREATE OR REPLACE; verify afterwards:
-- select md5(pg_get_functiondef('public.cc_erasure_decide(bigint,text,text,text,date,text)'::regprocedure)) = '00ce9c2c4657fec7fd3cb9b53585958e',
--        md5(pg_get_functiondef('public.erasure_removal_mark(bigint,text,text)'::regprocedure)) = '621dd1a04c7cd919811e600262167bca';
