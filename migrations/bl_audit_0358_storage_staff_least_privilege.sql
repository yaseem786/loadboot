-- bl_audit_0358 — F10: drop the blanket Storage policy "staff read documents" (bucket documents, qual = is_active_staff()).
-- Every ACTIVE staff account could read every carrier document regardless of role. The permission-based policy `doc_read`
-- (owner OR is_admin() OR has_global_permission('documents.view')) already covers staff who are meant to see documents.
-- Measured on prod 22 Sep 2026: 1 active staff member, role owner, documents.view granted via role -> zero change for anyone today.
-- Guarded: refuses to run if `doc_read` is not present with the documents.view clause (so access can never drop to nothing).
-- Rollback: re-create the policy verbatim (ROLLBACK-STORAGE-STAFF-2026-09-22.sql).
do $m$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='doc_read'
                 and cmd='SELECT' and qual like '%has_global_permission(''documents.view''::text)%') then
    raise exception 'bl_audit_0358: doc_read (documents.view) policy missing — refusing to drop the staff blanket';
  end if;
  drop policy if exists "staff read documents" on storage.objects;
end $m$;
