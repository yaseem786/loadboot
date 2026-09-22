-- bl_audit_0365 — ERASURE gate: the reviewed retention/removal workflow (DB half). STAGING ONLY until Yaseen approves the
-- retention table (RETENTION-PROPOSAL-2026-09-20.md). Nothing here deletes a file: it records staff decisions per inventory item
-- and lets the processor complete a request only when every item is decided and every "remove" item has removal evidence.
-- Actual Storage removal is the edge function erasure-purge (Storage API, service key, dry-run default), which marks evidence here.
create table if not exists app_private.erasure_item_decisions (
  request_id bigint not null references app_private.account_deletion_requests(id) on delete cascade,
  item_key text not null,                     -- md5 of the inventory item json
  source text, bucket text, path text,
  decision text not null check (decision in ('remove','hold')),
  retention_class text, retain_until date,
  note text,
  decided_by uuid, decided_at timestamptz not null default now(),
  removed_at timestamptz, removal_result text,
  primary key (request_id, item_key),
  check (decision <> 'hold' or (retention_class is not null and retain_until is not null))
);
alter table app_private.erasure_item_decisions enable row level security;
revoke all on app_private.erasure_item_decisions from public, anon, authenticated;

-- staff view: inventory items + their decision
create or replace function public.cc_erasure_items(p_request_id bigint)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $fn$
declare v jsonb;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_key', md5(e.item::text), 'item', e.item,
           'decision', d.decision, 'retention_class', d.retention_class, 'retain_until', d.retain_until,
           'removed_at', d.removed_at, 'removal_result', d.removal_result) order by e.ord), '[]'::jsonb)
    into v
  from app_private.account_erasure_inventories i
  cross join lateral jsonb_array_elements(i.items) with ordinality e(item, ord)
  left join app_private.erasure_item_decisions d on d.request_id = i.request_id and d.item_key = md5(e.item::text)
  where i.request_id = p_request_id;
  return jsonb_build_object('request_id', p_request_id, 'items', v);
end $fn$;
revoke all on function public.cc_erasure_items(bigint) from public, anon;
grant execute on function public.cc_erasure_items(bigint) to authenticated, service_role;

-- staff decision, one item per call
create or replace function public.cc_erasure_decide(p_request_id bigint, p_item_key text, p_decision text,
  p_retention_class text default null, p_retain_until date default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = app_private, public as $fn$
declare it jsonb; v_no_obj boolean;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('remove','hold') then return jsonb_build_object('error','bad_decision'); end if;
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
  insert into app_private.erasure_item_decisions(request_id, item_key, source, bucket, path, decision, retention_class, retain_until, note, decided_by, removed_at, removal_result)
  values (p_request_id, p_item_key, it->>'source', it->>'bucket', it->>'path', p_decision, p_retention_class, p_retain_until, p_note, auth.uid(),
          case when v_no_obj then now() end, case when v_no_obj then 'no_object' end)
  on conflict (request_id, item_key) do update
    set decision = excluded.decision, retention_class = excluded.retention_class, retain_until = excluded.retain_until,
        note = excluded.note, decided_by = excluded.decided_by, decided_at = now(),
        removed_at = excluded.removed_at, removal_result = excluded.removal_result
    where app_private.erasure_item_decisions.removed_at is null or app_private.erasure_item_decisions.removal_result = 'no_object';   -- a purged item's record is final
  return jsonb_build_object('ok', true, 'item_key', p_item_key, 'decision', p_decision);
end $fn$;
revoke all on function public.cc_erasure_decide(bigint, text, text, text, date, text) from public, anon;
grant execute on function public.cc_erasure_decide(bigint, text, text, text, date, text) to authenticated, service_role;

-- service-only: what the purge edge may delete for this request (decided remove, real bucket+path, not yet removed)
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
revoke all on function public.erasure_removal_candidates(bigint) from public, anon, authenticated;
grant execute on function public.erasure_removal_candidates(bigint) to service_role;

-- service-only: removal evidence
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
revoke all on function public.erasure_removal_mark(bigint, text, text) from public, anon, authenticated;
grant execute on function public.erasure_removal_mark(bigint, text, text) to service_role;

-- processor gate: complete only when every inventory item is decided and every 'remove' has evidence. md5-guarded patch.
do $m$
declare d text; n text;
  old_gate constant text := E'  n := app_private.capture_account_erasure_inventory(p_id);\n  if n > 0 then\n    return jsonb_build_object(''ok'',false,''status'',''requested'',''code'',''ERASURE_REVIEW_REQUIRED'',\n      ''error'',''File review is required before account deletion can be completed.'',''file_references'',n);\n  end if;\n';
  new_gate constant text := E'  n := app_private.capture_account_erasure_inventory(p_id);\n  if n > 0 then\n    -- bl_audit_0365: every item needs a staff decision; every ''remove'' needs removal evidence; ''hold'' needs class + date.\n    declare v_undecided int; v_pending int; v_held int;\n    begin\n      select count(*) filter (where dd.decision is null), count(*) filter (where dd.decision = ''remove'' and dd.removed_at is null), count(*) filter (where dd.decision = ''hold'')\n        into v_undecided, v_pending, v_held\n      from app_private.account_erasure_inventories i cross join lateral jsonb_array_elements(i.items) e(item)\n      left join app_private.erasure_item_decisions dd on dd.request_id = i.request_id and dd.item_key = md5(e.item::text)\n      where i.request_id = p_id;\n      if v_undecided > 0 or v_pending > 0 then\n        return jsonb_build_object(''ok'',false,''status'',''requested'',''code'',''ERASURE_REVIEW_REQUIRED'',\n          ''error'',''File review is required before account deletion can be completed.'',''file_references'',n,\n          ''undecided'',v_undecided,''pending_removal'',v_pending,''held'',v_held);\n      end if;\n      v_done := v_done || jsonb_build_object(''files_removed'', n - v_held, ''files_held'', v_held);\n    end;\n  end if;\n';
begin
  d := pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure);
  if md5(d) <> '1fb9c012cc900cf21e4420dda2bf7ef3' then
    raise exception 'bl_audit_0365: processor baseline moved (md5 %), refusing to patch', md5(d);
  end if;
  if (length(d)-length(replace(d,old_gate,'')))/length(old_gate) <> 1 then
    raise exception 'bl_audit_0365: gate text not found exactly once';
  end if;
  n := replace(d, old_gate, new_gate);
  execute n;
end $m$;
