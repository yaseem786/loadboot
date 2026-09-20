-- bl_audit_0355 — account-erasure INVENTORY: close the live-chat gaps found 20 Sep 2026.
-- The inventory (Codex, 13-15 Sep) matched chat onboarding rows only by conversation.user_id or lc_onboarding.account_email and
-- walked docs[] only. Measured on prod: website chats ALWAYS have user_id NULL, and account_email is set only when the account is
-- created inside the chat. So a guest who uploads documents in chat and later signs up in the portal with the same email was
-- invisible to an erasure request, and an orphan object (in Storage, not in docs[]) was invisible to every request.
-- This patch (1) also matches by the email the visitor typed (lc_onboarding.data->>'email', lc_conversations.email) and by
-- visitor_key, and (2) lists every Storage object under lc-onboarding/<matched key>/, whether docs[] knows it or not.
-- Direction of risk: it only ADDS review items -> more requests stop at ERASURE_REVIEW_REQUIRED for a human. It deletes nothing.
-- Applied by patching the LIVE definition under an md5 guard, so nothing is retyped and a moved baseline aborts the migration.
do $m$
declare d text; n text;
  old_pred constant text := 'lower(btrim(b.account_email))=lower(btrim(r.email))';
  new_pred constant text := '(lower(btrim(b.account_email))=lower(btrim(r.email)) OR lower(btrim(b.data->>''email''))=lower(btrim(r.email)) OR EXISTS(SELECT 1 FROM app_private.lc_conversations c2 WHERE c2.visitor_key=b.visitor_key AND lower(btrim(c2.email))=lower(btrim(r.email))))';
  old_conv constant text := 'c.id=b.conversation_id AND c.user_id=r.user_id';
  new_conv constant text := '(c.id=b.conversation_id OR c.visitor_key=b.visitor_key) AND c.user_id=r.user_id';
  tail constant text := E' )\n SELECT coalesce(jsonb_agg(DISTINCT item)';
  prefix_union constant text := E'  UNION ALL\n  SELECT jsonb_build_object(''source'',''onboarding_storage_prefix'',''record_id'',so.id,''bucket'',so.bucket_id,''path'',so.name)\n    FROM storage.objects so\n    WHERE so.bucket_id=''documents'' AND so.name LIKE ''lc-onboarding/%/%''\n      AND split_part(so.name,''/'',2) IN (\n        SELECT b.visitor_key FROM app_private.lc_onboarding b\n         WHERE EXISTS(SELECT 1 FROM app_private.lc_conversations c WHERE (c.id=b.conversation_id OR c.visitor_key=b.visitor_key) AND c.user_id=r.user_id)\n            OR (nullif(btrim(r.email),'''') IS NOT NULL AND NEWPRED)\n        UNION\n        SELECT c.visitor_key FROM app_private.lc_conversations c\n         WHERE c.user_id=r.user_id OR (nullif(btrim(r.email),'''') IS NOT NULL AND lower(btrim(c.email))=lower(btrim(r.email))))\n';
begin
  d := pg_get_functiondef('app_private.capture_account_erasure_inventory(bigint)'::regprocedure);
  if md5(d) <> 'd6fd7d1c2e24a3a9d81ff763f49e089f' then
    raise exception 'bl_audit_0355: baseline moved (md5 %), refusing to patch', md5(d);
  end if;
  if (length(d)-length(replace(d,old_pred,'')))/length(old_pred) <> 2
     or (length(d)-length(replace(d,old_conv,'')))/length(old_conv) <> 2
     or (length(d)-length(replace(d,tail,'')))/length(tail) <> 1 then
    raise exception 'bl_audit_0355: anchor counts differ from the reviewed source';
  end if;
  n := replace(d, old_pred, new_pred);
  n := replace(n, old_conv, new_conv);
  n := replace(n, tail, replace(prefix_union,'NEWPRED',new_pred) || tail);
  execute n;
end $m$;
-- ACL is unchanged by CREATE OR REPLACE (postgres only); asserted by the test.
