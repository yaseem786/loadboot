-- bl_audit_0364 — ERASURE gate, "notification consumers parity": when a deletion COMPLETES, also remove the channels that could
-- still reach the person and the personal data they hold. Found 22 Sep by reading the live processor: push_subscriptions (web/APNs
-- endpoints), user_devices, in-app notifications (197 prod payloads carry email/phone), comm_preferences, and the emergency contacts
-- of carrier orgs the user owns were all left behind. Also scrubs the chat onboarding rows that 0355 learned to FIND (typed
-- email / linked conversation): account_email + data.email/phone/contact_name -> null. docs[] and Storage objects are NOT touched
-- (retention decision pending; they stay listed in the erasure inventory).
-- md5-guarded patch of the live body (3037026e… after 0357). Rollback: ROLLBACK-ERASURE-NOTIF-2026-09-22.sql.
do $m$
declare d text; n text;
  anchor constant text := E'  delete from auth.sessions where user_id = r.user_id;\n';
  add constant text := E'  -- 7c) bl_audit_0364: notification channels + device identity + chat contact data.\n  delete from app_private.push_subscriptions where user_id = r.user_id;\n  delete from app_private.user_devices where user_id = r.user_id;\n  delete from app_private.notifications where recipient_user = r.user_id;\n  delete from app_private.comm_preferences where user_id = r.user_id;\n  delete from app_private.emergency_contacts ec where ec.carrier_id in (select o.id from public.organizations o where o.owner_user_id = r.user_id);\n  update app_private.lc_onboarding b set account_email = null, data = coalesce(b.data,''{}''::jsonb) - ''email'' - ''phone'' - ''contact_name'', updated_at = now()\n   where exists (select 1 from app_private.lc_conversations c where (c.id = b.conversation_id or c.visitor_key = b.visitor_key) and c.user_id = r.user_id)\n      or (nullif(btrim(r.email),'''') is not null and (lower(btrim(b.account_email)) = lower(btrim(r.email)) or lower(btrim(b.data->>''email'')) = lower(btrim(r.email))));\n';
begin
  d := pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure);
  if md5(d) <> '3037026e0b305560166be98f5a90e789' then
    raise exception 'bl_audit_0364: processor baseline moved (md5 %), refusing to patch', md5(d);
  end if;
  if (length(d)-length(replace(d,anchor,'')))/length(anchor) <> 1 then
    raise exception 'bl_audit_0364: anchor count differs from the reviewed source';
  end if;
  n := replace(d, anchor, anchor || add);
  execute n;
end $m$;
