-- Promotion authorized 2026-09-15. Source snapshots and rollback preserved.
-- Only definitions change. No queue consumption, sender invocation or backfill.
DO $p0$
DECLARE src text; acl_before text;
BEGIN
 SELECT pg_get_functiondef(oid),proacl::text INTO STRICT src,acl_before FROM pg_proc WHERE oid='app_private.sys_email(text,text,text,text,text,text)'::regprocedure;
 IF md5(src) NOT IN ('bef172b20b9a09f1a3f1926009d291d5','49e378917ea2803d0cf11b65aa30ea7d') THEN RAISE EXCEPTION 'Source drift: app_private.sys_email(text,text,text,text,text,text)'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION app_private.sys_email(p_to text, p_template text, p_subject text, p_html text, p_text text DEFAULT NULL::text, p_idem text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions where channel='email' and lower(btrim(address))=lower(btrim(p_to))
    and (reason IS DISTINCT FROM 'unsubscribed' or coalesce(p_template ~* '^outreach[._-]',false))) then return; end if;
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional','email','resend',lower(p_to),
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject',p_subject,'body_html',p_html,'body_text',coalesce(p_text,p_subject),'category','transactional'))
  on conflict (idempotency_key) do nothing;
end; $function$
$definition$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='app_private.sys_email(text,text,text,text,text,text)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'ACL drift: app_private.sys_email(text,text,text,text,text,text)'; END IF;
END $p0$;
DO $p1$
DECLARE src text; acl_before text;
BEGIN
 SELECT pg_get_functiondef(oid),proacl::text INTO STRICT src,acl_before FROM pg_proc WHERE oid='public.cc_enqueue_transactional(text,text,text,text,text,jsonb,timestamp with time zone)'::regprocedure;
 IF md5(src) NOT IN ('58fb0ca17ee9a213051a6b3f310fb4ca','040e6eacccb65d567fcda499c25401e8') THEN RAISE EXCEPTION 'Source drift: public.cc_enqueue_transactional(text,text,text,text,text,jsonb,timestamp with time zone)'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.cc_enqueue_transactional(p_channel text, p_email text, p_template_key text DEFAULT NULL::text, p_subject text DEFAULT NULL::text, p_idem text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_key text; v_sched timestamptz; v_id uuid; v_ins int; v_provider text; v_addr text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_channel not in ('email','sms') then raise exception 'invalid channel' using errcode='22023'; end if;
  if p_channel='email' then
    if p_email is null or p_email !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'invalid email recipient' using errcode='22023'; end if;
    v_addr := lower(p_email); v_provider := 'resend';
  else
    if p_email is null or p_email !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid sms recipient' using errcode='22023'; end if;
    v_addr := p_email; v_provider := 'twilio';
  end if;
  if exists (select 1 from app_private.suppressions where channel=p_channel and lower(btrim(address))=lower(btrim(v_addr))
    and (p_channel <> 'email' or reason IS DISTINCT FROM 'unsubscribed'
         or coalesce(p_template_key ~* '^outreach[._-]',false))) then
    return jsonb_build_object('queued',false,'reason','suppressed'); end if;
  v_sched := coalesce(p_scheduled_at, now());
  v_key := coalesce(p_idem, 'txn:'||p_channel||':'||lower(v_addr)||':'||coalesce(p_template_key,'')||':'||extract(epoch from v_sched)::bigint::text);
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,recipient_phone,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional',p_channel,v_provider,
    case when p_channel='email' then v_addr else null end,
    case when p_channel='sms'   then v_addr else null end,
    v_key, case when v_sched>now() then 'scheduled' else 'queued' end, v_sched, p_template_key,
    coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('subject',p_subject))
  on conflict (idempotency_key) do nothing returning id into v_id;
  get diagnostics v_ins = row_count;
  return jsonb_build_object('queued', v_ins>0, 'delivery_id', v_id, 'idempotency_key', v_key, 'channel', p_channel,
    'status', case when v_ins=0 then 'duplicate' when v_sched>now() then 'scheduled' else 'queued' end);
end; $function$
$definition$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_enqueue_transactional(text,text,text,text,text,jsonb,timestamp with time zone)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'ACL drift: public.cc_enqueue_transactional(text,text,text,text,text,jsonb,timestamp with time zone)'; END IF;
END $p1$;
DO $p2$
DECLARE src text; acl_before text;
BEGIN
 SELECT pg_get_functiondef(oid),proacl::text INTO STRICT src,acl_before FROM pg_proc WHERE oid='public.cc_delivery_worker_claim(integer,text)'::regprocedure;
 IF md5(src) NOT IN ('f888d4b9e417161d062d951abba451fb','d887937ce27f925e88cb96515e34971e') THEN RAISE EXCEPTION 'Source drift: public.cc_delivery_worker_claim(integer,text)'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.cc_delivery_worker_claim(p_limit integer DEFAULT 50, p_channel text DEFAULT 'email'::text)
 RETURNS SETOF app_private.message_deliveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
begin
  -- Close out queued deliveries that suppression policy now blocks.
  update app_private.message_deliveries m
    set status='unsubscribed', failure_reason='recipient suppressed', updated_at=now()
    where m.status='queued' and m.channel=p_channel
      and exists (select 1 from app_private.suppressions s
                  where s.channel=m.channel
                    and lower(btrim(s.address)) = lower(btrim(case when m.channel='email' then m.recipient_email else m.recipient_phone end))
                    and (m.channel <> 'email' or s.reason IS DISTINCT FROM 'unsubscribed' or coalesce(m.template_key ~* '^outreach[._-]',false) or m.source='campaign'));
  return query with claimed as (select id from app_private.message_deliveries m
      where m.status='queued' and m.channel=p_channel and coalesce(m.scheduled_at,now())<=now()
        and not exists (select 1 from app_private.suppressions s
                        where s.channel=m.channel
                          and lower(btrim(s.address)) = lower(btrim(case when m.channel='email' then m.recipient_email else m.recipient_phone end))
                          and (m.channel <> 'email' or s.reason IS DISTINCT FROM 'unsubscribed' or coalesce(m.template_key ~* '^outreach[._-]',false) or m.source='campaign'))
      order by m.scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $function$
$definition$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_delivery_worker_claim(integer,text)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'ACL drift: public.cc_delivery_worker_claim(integer,text)'; END IF;
END $p2$;
DO $p3$
DECLARE src text; acl_before text;
BEGIN
 SELECT pg_get_functiondef(oid),proacl::text INTO STRICT src,acl_before FROM pg_proc WHERE oid='public.cc_delivery_worker_marketing_allowed(uuid)'::regprocedure;
 IF md5(src) NOT IN ('24370cb986ae6c198b606e1d6f60ea2d','e80dba03fa4c09881c280d48e39b69dc') THEN RAISE EXCEPTION 'Source drift: public.cc_delivery_worker_marketing_allowed(uuid)'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.cc_delivery_worker_marketing_allowed(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
  select coalesce((
    select
      d.status = 'claimed'
      and not exists (
        select 1
          from app_private.suppressions s
         where s.channel = d.channel
           and lower(btrim(s.address)) = lower(btrim(d.recipient_email))
           and (
             s.reason in ('bounced', 'complained')
             or coalesce(d.template_key ~* '^outreach[._-]', false)
             or d.source = 'campaign'
           )
      )
      and (
        not coalesce(d.template_key ~* '^outreach[._-]', false)
        or exists (
          select 1
            from app_private.outreach_contacts oc
           where lower(trim(oc.email)) = lower(btrim(d.recipient_email))
             and oc.status in ('active', 'completed')
             and oc.replied_at is null
             and oc.converted_at is null
        )
      )
    from app_private.message_deliveries d
    where d.id = p_id
      and d.channel = 'email'
      and (coalesce(d.template_key ~* '^outreach[._-]', false) or d.source = 'campaign')
  ), false);
$function$
$definition$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_delivery_worker_marketing_allowed(uuid)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'ACL drift: public.cc_delivery_worker_marketing_allowed(uuid)'; END IF;
END $p3$;
DO $p4$
DECLARE src text; acl_before text;
BEGIN
 SELECT pg_get_functiondef(oid),proacl::text INTO STRICT src,acl_before FROM pg_proc WHERE oid='public.outreach_unsubscribe(text,text)'::regprocedure;
 IF md5(src) NOT IN ('e5c0df06277f623ab707d26ae5bafda4','61f99e7275bf65f27e6ed11b2396a676') THEN RAISE EXCEPTION 'Source drift: public.outreach_unsubscribe(text,text)'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.outreach_unsubscribe(p_email text, p_token text)
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
$definition$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.outreach_unsubscribe(text,text)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'ACL drift: public.outreach_unsubscribe(text,text)'; END IF;
END $p4$;
DO $p5$
DECLARE src text; acl_before text;
BEGIN
 SELECT pg_get_functiondef(oid),proacl::text INTO STRICT src,acl_before FROM pg_proc WHERE oid='public.cc_delivery_worker_unsubscribe(uuid)'::regprocedure;
 IF md5(src) NOT IN ('189d394b467fd4b24ba1f03face6078b','0090e4226dd14f8cddf2268c5b451f94') THEN RAISE EXCEPTION 'Source drift: public.cc_delivery_worker_unsubscribe(uuid)'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.cc_delivery_worker_unsubscribe(p_token uuid)
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
$definition$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_delivery_worker_unsubscribe(uuid)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'ACL drift: public.cc_delivery_worker_unsubscribe(uuid)'; END IF;
END $p5$;
