-- Guarded code rollback; keep existing suppressions and cancelled delivery statuses.
DO $rollback$ BEGIN
IF md5(pg_get_functiondef('public.outreach_unsubscribe'::regproc)) IS DISTINCT FROM '61f99e7275bf65f27e6ed11b2396a676' THEN RAISE EXCEPTION 'Source drift: outreach_unsubscribe'; END IF;
IF md5(pg_get_functiondef('public.cc_delivery_worker_unsubscribe'::regproc)) IS DISTINCT FROM '0090e4226dd14f8cddf2268c5b451f94' THEN RAISE EXCEPTION 'Source drift: cc_delivery_worker_unsubscribe'; END IF;
EXECUTE $restore$CREATE OR REPLACE FUNCTION public.outreach_unsubscribe(p_email text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
begin
  if p_token is distinct from app_private.outreach_unsub_token(p_email) then
    return jsonb_build_object('error','invalid link');
  end if;
  update app_private.outreach_contacts set status='unsubscribed' where lower(email)=lower(trim(p_email));
  return jsonb_build_object('ok', true);
end $function$
$restore$;
EXECUTE $restore$CREATE OR REPLACE FUNCTION public.cc_delivery_worker_unsubscribe(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare d record;
begin
  select * into d from app_private.message_deliveries where correlation_id = p_token limit 1;
  if d.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown token'); end if;
  if d.channel = 'email' and d.recipient_email is not null then
    insert into app_private.suppressions(channel,address,reason) values ('email', lower(d.recipient_email), 'unsubscribed') on conflict do nothing;
  elsif d.channel = 'sms' and d.recipient_phone is not null then
    insert into app_private.suppressions(channel,address,reason) values ('sms', d.recipient_phone, 'unsubscribed') on conflict do nothing;
  end if;
  update app_private.message_deliveries set status='unsubscribed', updated_at=now() where id=d.id;
  perform app_private.log_audit('comm.unsubscribe','delivery',d.id::text,null,'recipient unsubscribed via one-click link',
    jsonb_build_object('channel',d.channel));
  return jsonb_build_object('ok', true, 'channel', d.channel);
end; $function$
$restore$;
END $rollback$;
