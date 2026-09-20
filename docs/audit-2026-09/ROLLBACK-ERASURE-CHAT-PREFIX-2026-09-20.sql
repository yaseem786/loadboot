-- Rollback for bl_audit_0355 (erasure inventory: chat email/visitor_key matching + Storage prefix listing).
-- Guarded: only runs against the exact 0355 body; restores the 15 Sep body byte-exact (md5 d6fd7d1c2e24a3a9d81ff763f49e089f).
-- Rehearsed on staging 20 Sep inside a rolled-back txn: restored md5 == expected.
-- ORDER: Codex's ROLLBACK-ERASURE-INVENTORY-2026-09-13.sql / ROLLBACK-ERASURE-PROMOTION-2026-09-15.sql check the OLD capture hash,
-- so run THIS file first if those are ever needed. Saved inventory rows are not touched by this file.
do $m$
declare d text; n text; u0 int; u1 int;
  old_pred constant text := 'lower(btrim(b.account_email))=lower(btrim(r.email))';
  new_pred constant text := '(lower(btrim(b.account_email))=lower(btrim(r.email)) OR lower(btrim(b.data->>''email''))=lower(btrim(r.email)) OR EXISTS(SELECT 1 FROM app_private.lc_conversations c2 WHERE c2.visitor_key=b.visitor_key AND lower(btrim(c2.email))=lower(btrim(r.email))))';
  old_conv constant text := 'c.id=b.conversation_id AND c.user_id=r.user_id';
  new_conv constant text := '(c.id=b.conversation_id OR c.visitor_key=b.visitor_key) AND c.user_id=r.user_id';
begin
  d := pg_get_functiondef('app_private.capture_account_erasure_inventory(bigint)'::regprocedure);
  if md5(d) <> '3e252812bb878f63d0ab627b89f20f40' then raise exception 'rollback 0355: not the 0355 body (md5 %)', md5(d); end if;
  u0 := position(E'  UNION ALL\n  SELECT jsonb_build_object(''source'',''onboarding_storage_prefix''' in d);
  u1 := position(E' )\n SELECT coalesce(jsonb_agg(DISTINCT item)' in d);
  n := substr(d,1,u0-1) || substr(d,u1);
  n := replace(n, new_conv, old_conv);
  n := replace(n, new_pred, old_pred);
  execute n;
  if md5(pg_get_functiondef('app_private.capture_account_erasure_inventory(bigint)'::regprocedure)) <> 'd6fd7d1c2e24a3a9d81ff763f49e089f' then
    raise exception 'rollback 0355: restored body does not match the 15 Sep hash';
  end if;
end $m$;
