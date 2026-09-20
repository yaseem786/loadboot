-- bl_audit_0356 — ERASURE gate: UPLOAD FREEZE while an account-deletion request is open (status 'requested').
-- Why: the erasure inventory (0355) is a snapshot. Without a freeze, a user can keep adding files after the snapshot and those
-- files are never reviewed. With 0 open requests this migration changes nothing for anyone.
-- What is frozen for the requesting user: INSERT into public.documents, INSERT/UPDATE on storage.objects (all buckets), and
-- live-chat onboarding uploads tied to them (by login or by the email on the chat row). Cancel/reject/complete lifts it at once.
-- NOT frozen (deliberate): staff acting on the user's behalf, service_role (edge functions) — except the chat preflight below.
-- Additive + reversible: one helper, three RESTRICTIVE policies, one md5-guarded patch. Rollback: ROLLBACK-ERASURE-UPLOAD-FREEZE-2026-09-20.sql

create or replace function public.my_uploads_frozen()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $fn$
  select auth.uid() is not null and exists (
    select 1 from app_private.account_deletion_requests q
    where q.user_id = auth.uid() and q.status = 'requested')
$fn$;
revoke all on function public.my_uploads_frozen() from public, anon;
grant execute on function public.my_uploads_frozen() to authenticated, service_role;

drop policy if exists erasure_freeze_documents on public.documents;
create policy erasure_freeze_documents on public.documents as restrictive for insert to authenticated
  with check (not public.my_uploads_frozen());

drop policy if exists erasure_freeze_uploads_insert on storage.objects;
create policy erasure_freeze_uploads_insert on storage.objects as restrictive for insert to authenticated
  with check (not public.my_uploads_frozen());

drop policy if exists erasure_freeze_uploads_update on storage.objects;
create policy erasure_freeze_uploads_update on storage.objects as restrictive for update to authenticated
  using (not public.my_uploads_frozen()) with check (not public.my_uploads_frozen());

do $m$
declare d text; n text;
  anchor constant text := 'RETURN jsonb_build_object(''ok'',true);';
  guard constant text := 'IF EXISTS(SELECT 1 FROM app_private.account_deletion_requests q WHERE q.status=''requested'' AND ((auth.uid() IS NOT NULL AND q.user_id=auth.uid()) OR (nullif(btrim(q.email),'''') IS NOT NULL AND lower(btrim(q.email)) IN (lower(btrim(o.account_email)), lower(btrim(o.data->>''email'')))))) THEN RETURN jsonb_build_object(''error'',''frozen''); END IF; ';
begin
  d := pg_get_functiondef('public.lc_ob_upload_check(text,uuid)'::regprocedure);
  if md5(d) <> 'b517e2e86cb8710691a9ababa37513da' then
    raise exception 'bl_audit_0356: lc_ob_upload_check baseline moved (md5 %), refusing to patch', md5(d);
  end if;
  if (length(d)-length(replace(d,anchor,'')))/length(anchor) <> 1 then
    raise exception 'bl_audit_0356: anchor count differs from the reviewed source';
  end if;
  n := replace(d, anchor, guard || anchor);
  execute n;
end $m$;
