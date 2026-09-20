-- Rollback for bl_audit_0356 (upload freeze). Removes the three restrictive policies and the helper, and restores
-- lc_ob_upload_check to its pre-0356 body (md5 b517e2e86cb8710691a9ababa37513da) under an md5 guard. Touches no data.
drop policy if exists erasure_freeze_documents on public.documents;
drop policy if exists erasure_freeze_uploads_insert on storage.objects;
drop policy if exists erasure_freeze_uploads_update on storage.objects;
do $m$
declare d text; n text;
  guard constant text := 'IF EXISTS(SELECT 1 FROM app_private.account_deletion_requests q WHERE q.status=''requested'' AND ((auth.uid() IS NOT NULL AND q.user_id=auth.uid()) OR (nullif(btrim(q.email),'''') IS NOT NULL AND lower(btrim(q.email)) IN (lower(btrim(o.account_email)), lower(btrim(o.data->>''email'')))))) THEN RETURN jsonb_build_object(''error'',''frozen''); END IF; ';
begin
  d := pg_get_functiondef('public.lc_ob_upload_check(text,uuid)'::regprocedure);
  if (length(d)-length(replace(d,guard,'')))/length(guard) <> 1 then raise exception 'rollback 0356: guard text not found exactly once'; end if;
  n := replace(d, guard, '');
  execute n;
  if md5(pg_get_functiondef('public.lc_ob_upload_check(text,uuid)'::regprocedure)) <> 'b517e2e86cb8710691a9ababa37513da' then
    raise exception 'rollback 0356: restored body does not match the pre-0356 hash';
  end if;
end $m$;
drop function if exists public.my_uploads_frozen();
