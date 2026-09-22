-- Rollback for bl_audit_0358: restores the blanket policy exactly as it was on prod/staging before 22 Sep 2026.
create policy "staff read documents" on storage.objects for select to authenticated
  using ((bucket_id = 'documents'::text) and is_active_staff());
