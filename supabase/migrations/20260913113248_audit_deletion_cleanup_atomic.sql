-- STAGING ONLY. Atomic cleanup correction; not full erasure/session/retention completion.
DO $patch$
DECLARE src text; prior_acl text;
BEGIN
 SELECT pg_get_functiondef(oid),proacl::text INTO src,prior_acl FROM pg_proc
 WHERE oid='public.cc_account_deletion_process(bigint,text,text)'::regprocedure;
 IF md5(src) IS DISTINCT FROM '555b32439b095bf930317f2ec81c1902' THEN RAISE EXCEPTION 'Deletion source drift; re-sync'; END IF;
 src := replace(src, $old$  begin
    delete from app_private.crm_contacts where lower(email) = lower(nullif(btrim(r.email),''));
    delete from app_private.outreach_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  exception when others then null; end;$old$, $new$  -- Cleanup failures must abort the transaction, never report partial erasure as completed.
  delete from app_private.crm_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('crm_contacts', n);
  delete from app_private.outreach_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('outreach_contacts', n);$new$);
 EXECUTE src;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_account_deletion_process(bigint,text,text)'::regprocedure) IS DISTINCT FROM prior_acl THEN
  RAISE EXCEPTION 'Deletion grants changed'; END IF;
END $patch$;
