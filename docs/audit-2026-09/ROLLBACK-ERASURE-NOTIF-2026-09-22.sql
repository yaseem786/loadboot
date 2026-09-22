-- Rollback for bl_audit_0364: removes the exact 7c block text, restoring the 0357 body (md5 3037026e0b305560166be98f5a90e789). Touches no data.
do $m$ declare d text; n text;
  add constant text := E'  -- 7c) bl_audit_0364: notification channels + device identity + chat contact data.\n  delete from app_private.push_subscriptions where user_id = r.user_id;\n  delete from app_private.user_devices where user_id = r.user_id;\n  delete from app_private.notifications where recipient_user = r.user_id;\n  delete from app_private.comm_preferences where user_id = r.user_id;\n  delete from app_private.emergency_contacts ec where ec.carrier_id in (select o.id from public.organizations o where o.owner_user_id = r.user_id);\n  update app_private.lc_onboarding b set account_email = null, data = coalesce(b.data,''{}''::jsonb) - ''email'' - ''phone'' - ''contact_name'', updated_at = now()\n   where exists (select 1 from app_private.lc_conversations c where (c.id = b.conversation_id or c.visitor_key = b.visitor_key) and c.user_id = r.user_id)\n      or (nullif(btrim(r.email),'''') is not null and (lower(btrim(b.account_email)) = lower(btrim(r.email)) or lower(btrim(b.data->>''email'')) = lower(btrim(r.email))));\n';
begin
  d := pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure);
  if (length(d)-length(replace(d,add,'')))/length(add) <> 1 then raise exception 'rollback 0364: 7c block not found exactly once'; end if;
  n := replace(d, add, ''); execute n;
  if md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure)) <> '3037026e0b305560166be98f5a90e789' then
    raise exception 'rollback 0364: restored body does not match the 0357 hash'; end if;
end $m$;
