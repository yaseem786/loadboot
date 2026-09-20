-- bl_audit_0354 — live-chat onboarding document reconciliation, PHASE 2b (REMOVE), database half.
-- Design: docs/audit-2026-09/DESIGN-LC-ORPHAN-RECONCILIATION-2026-09-19.md, "Phase 2b" (Yaseen's decision 3: 7 days; "haan" 20 Sep).
-- This migration deletes NOTHING. It only (1) lists what is eligible and (2) lets the service role write a log row.
-- The actual delete is done by the edge function lc-doc-purge through the Storage API.
-- Eligible = bucket documents, name lc-onboarding/<key>/<file>, no docs[].path equals it, NO lc_onboarding row for <key>,
-- NO lc_conversations row for <key>, older than max(p_min_age, 7 days). The 7-day floor cannot be lowered by the caller.
-- Staff-only via app_private.lc_cc_ok(). NOT anon-executable: anon SECURITY DEFINER NAMES must be unchanged after apply.

create or replace function public.cc_lc_doc_remove_candidates(p_min_age interval default interval '7 days')
returns jsonb
language plpgsql
stable
security definer
set search_path = app_private, public
as $fn$
declare v_age interval; v_list jsonb;
begin
  if not app_private.lc_cc_ok() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_age := greatest(coalesce(p_min_age, interval '7 days'), interval '7 days');

  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'key', s.key, 'size', s.size, 'created_at', s.created_at) order by s.created_at), '[]'::jsonb)
    into v_list
  from (
    select so.name, split_part(so.name, '/', 2) as key, so.created_at, nullif(so.metadata->>'size','')::bigint as size
    from storage.objects so
    where so.bucket_id = 'documents'
      and so.name like 'lc-onboarding/%/%'
      and split_part(so.name, '/', 2) <> ''
      and so.created_at < now() - v_age
  ) s
  where not exists (select 1 from app_private.lc_onboarding o where o.visitor_key = s.key)
    and not exists (select 1 from app_private.lc_conversations c where c.visitor_key = s.key)
    and not exists (select 1 from app_private.lc_onboarding o
                    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.docs)='array' then o.docs else '[]'::jsonb end) e(doc)
                    where e.doc->>'path' = s.name);

  return jsonb_build_object('candidates', v_list, 'count', jsonb_array_length(v_list),
                            'min_age', v_age::text, 'actor', auth.uid(), 'generated_at', now());
end
$fn$;

revoke all on function public.cc_lc_doc_remove_candidates(interval) from public, anon;
grant execute on function public.cc_lc_doc_remove_candidates(interval) to authenticated, service_role;

create or replace function public.lc_doc_recon_log_add(p_actor uuid, p_action text, p_path text, p_dry_run boolean, p_result text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_private, public
as $fn$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('remove') or p_path is null or p_path not like 'lc-onboarding/%/%'
     or p_result is null or p_result not in ('would_remove','removed','storage_failed','skipped') then
    return jsonb_build_object('error', 'bad_request');
  end if;
  insert into app_private.lc_doc_recon_log(actor, action, path, visitor_key, dry_run, result)
  values (p_actor, p_action, p_path, split_part(p_path, '/', 2), coalesce(p_dry_run, true), p_result);
  return jsonb_build_object('ok', true);
end
$fn$;

revoke all on function public.lc_doc_recon_log_add(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.lc_doc_recon_log_add(uuid, text, text, boolean, text) to service_role;
