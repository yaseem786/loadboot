-- STAGING ONLY: preserve marketing opt-out across contact removal; no sender/backfill.
DO $patch0$
DECLARE old_acl text;
BEGIN
 IF md5(pg_get_functiondef('public.outreach_unsubscribe'::regproc)) IS DISTINCT FROM '1dd6ca1fbcb07b7fb9b011eca1235eda' THEN RAISE EXCEPTION 'Unsubscribe source drift: outreach_unsubscribe'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.outreach_unsubscribe'::regproc;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.outreach_unsubscribe(p_email text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+[.][^@]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;
  if p_token is null or btrim(p_token) = ''
     or not exists (select 1 from app_private.outreach_state where id=1 and nullif(unsub_secret,'') is not null)
     or app_private.outreach_unsub_token(v_email) is null
     or p_token is distinct from app_private.outreach_unsub_token(v_email) then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;

  update app_private.outreach_contacts
     set status = 'unsubscribed'
   where lower(trim(email)) = v_email
     and status <> 'unsubscribed';

  insert into app_private.suppressions(channel, address, reason)
  select 'email', v_email, 'unsubscribed'
  where not exists (select 1 from app_private.suppressions s where s.channel='email' and lower(btrim(s.address))=v_email);

  update app_private.message_deliveries
     set status = 'unsubscribed',
         failure_reason = 'recipient opted out of marketing/outreach',
         updated_at = now()
   where channel = 'email'
     and lower(btrim(recipient_email)) = v_email
     and (template_key ~* '^outreach[._-]' or source = 'campaign')
     and status in ('queued', 'claimed', 'scheduled');

  perform app_private.log_audit(
    'comm.outreach_unsubscribe', 'email', v_email, null,
    'recipient unsubscribed through outreach footer',
    jsonb_build_object('scope', 'marketing')
  );

  return jsonb_build_object('ok', true, 'scope', 'marketing');
end;
$function$
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.outreach_unsubscribe'::regproc) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL changed'; END IF;
END $patch0$;

DO $patch1$
DECLARE old_acl text;
BEGIN
 IF md5(pg_get_functiondef('public.cc_delivery_worker_unsubscribe'::regproc)) IS DISTINCT FROM '84e7f447dd22cccffbedbcf7ba44e70f' THEN RAISE EXCEPTION 'Unsubscribe source drift: cc_delivery_worker_unsubscribe'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_delivery_worker_unsubscribe'::regproc;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_delivery_worker_unsubscribe(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare
  d app_private.message_deliveries%rowtype;
  v_email text;
begin
  select * into d
    from app_private.message_deliveries
   where correlation_id = p_token
   limit 1;

  if d.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown token');
  end if;

  if d.channel = 'email' and d.recipient_email is not null then
    v_email := lower(trim(d.recipient_email));
    if v_email = '' or v_email !~ '^[^@]+@[^@]+[.][^@]+$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid recipient');
    end if;

    -- A token from an older operational email remains a valid way to opt out of marketing,
    -- but it never suppresses operational delivery or rewrites that operational row.
    insert into app_private.suppressions(channel, address, reason)
    select 'email', v_email, 'unsubscribed'
    where not exists (select 1 from app_private.suppressions s where s.channel='email' and lower(btrim(s.address))=v_email);

    update app_private.outreach_contacts
       set status = 'unsubscribed'
     where lower(trim(email)) = v_email
       and status <> 'unsubscribed';

    update app_private.message_deliveries
       set status = 'unsubscribed',
           failure_reason = 'recipient opted out of marketing/outreach',
           updated_at = now()
     where channel = 'email'
       and lower(btrim(recipient_email)) = v_email
       and (template_key ~* '^outreach[._-]' or source = 'campaign')
       and status in ('queued', 'claimed', 'scheduled');



    perform app_private.log_audit(
      'comm.outreach_unsubscribe', 'delivery', d.id::text, null,
      'recipient unsubscribed through one-click link',
      jsonb_build_object('channel', 'email', 'scope', 'marketing')
    );

    return jsonb_build_object('ok', true, 'channel', 'email', 'scope', 'marketing');
  elsif d.channel = 'sms' and d.recipient_phone is not null then
    insert into app_private.suppressions(channel, address, reason)
    values ('sms', d.recipient_phone, 'unsubscribed')
    on conflict do nothing;

    update app_private.message_deliveries
       set status = 'unsubscribed', updated_at = now()
     where id = d.id and status in ('queued', 'claimed', 'scheduled');

    perform app_private.log_audit(
      'comm.unsubscribe', 'delivery', d.id::text, null,
      'recipient unsubscribed from SMS through one-click link',
      jsonb_build_object('channel', 'sms')
    );

    return jsonb_build_object('ok', true, 'channel', 'sms');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'unsupported channel');
end;
$function$
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_delivery_worker_unsubscribe'::regproc) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL changed'; END IF;
END $patch1$;
