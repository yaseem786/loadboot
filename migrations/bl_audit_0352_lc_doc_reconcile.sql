-- bl_audit_0352 — live-chat onboarding document reconciliation, PHASE 1 (report only).
-- Design: docs/audit-2026-09/DESIGN-LC-ORPHAN-RECONCILIATION-2026-09-19.md
-- Read-only: no writes, no deletes, no notifications. Staff-only via app_private.lc_cc_ok() (the live-chat CC guard).
-- NOT anon-executable: the anon SECURITY DEFINER surface must be unchanged after apply (compare NAMES).

create or replace function public.cc_lc_doc_reconcile(p_grace interval default interval '1 hour')
returns jsonb
language plpgsql
stable
security definer
set search_path = app_private, public
as $fn$
declare
  v_orphans jsonb; v_dangling jsonb;
begin
  if not app_private.lc_cc_ok() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_grace is null or p_grace < interval '0' then p_grace := interval '1 hour'; end if;

  with d as (
    select o.visitor_key, o.conversation_id, e.doc
    from app_private.lc_onboarding o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.docs) = 'array' then o.docs else '[]'::jsonb end) as e(doc)
  ), s as (
    select so.name, split_part(so.name, '/', 2) as key, so.created_at,
           nullif(so.metadata->>'size','')::bigint as size
    from storage.objects so
    where so.bucket_id = 'documents' and so.name like 'lc-onboarding/%'
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'name', s.name, 'key', s.key, 'size', s.size, 'created_at', s.created_at,
        'has_ob_row', exists (select 1 from app_private.lc_onboarding o where o.visitor_key = s.key),
        'has_conversation', exists (select 1 from app_private.lc_conversations c where c.visitor_key = s.key),
        'looks_test', (s.key = 'debugtest' or s.key like 'lbtest\_%' or s.key like 'ZZsynthetic%')
      ) order by s.created_at), '[]'::jsonb)
     from s
     where s.created_at < now() - p_grace
       and not exists (select 1 from d where d.doc->>'path' = s.name)),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'visitor_key', d.visitor_key, 'conversation_id', d.conversation_id, 'path', d.doc->>'path',
        't', d.doc->>'t', 'f', d.doc->>'f', 'verdict', d.doc->>'verdict', 'ts', d.doc->>'ts')), '[]'::jsonb)
     from d
     where not exists (select 1 from s where s.name = d.doc->>'path'))
  into v_orphans, v_dangling;

  return jsonb_build_object(
    'orphans', v_orphans, 'dangling', v_dangling,
    'counts', jsonb_build_object('orphans', jsonb_array_length(v_orphans), 'dangling', jsonb_array_length(v_dangling)),
    'grace', p_grace::text, 'generated_at', now());
end
$fn$;

revoke all on function public.cc_lc_doc_reconcile(interval) from public, anon;
grant execute on function public.cc_lc_doc_reconcile(interval) to authenticated, service_role;
