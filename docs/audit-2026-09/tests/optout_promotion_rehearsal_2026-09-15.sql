-- STAGING ONLY. No real recipients, worker invocation or provider sends. ROLLBACK all rows.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE unsub_anon_before AS
 SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
CREATE OR REPLACE FUNCTION app_private.sys_email(p_to text, p_template text, p_subject text, p_html text, p_text text DEFAULT NULL::text, p_idem text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions s
             where s.channel='email' and s.address=lower(p_to)
               and (s.reason in ('bounced','complained') or p_template like 'outreach.%')) then return; end if;
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional','email','resend',lower(p_to),
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject',p_subject,'body_html',p_html,'body_text',coalesce(p_text,p_subject),'category','transactional'))
  on conflict (idempotency_key) do nothing;
end; $function$;

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
  if exists (select 1 from app_private.suppressions where channel=p_channel and lower(address)=lower(v_addr)) then
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
end; $function$;

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
                    and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end
                    and (s.reason in ('bounced','complained') or m.template_key like 'outreach.%' or m.source='campaign'));
  return query with claimed as (select id from app_private.message_deliveries m
      where m.status='queued' and m.channel=p_channel and coalesce(m.scheduled_at,now())<=now()
        and not exists (select 1 from app_private.suppressions s
                        where s.channel=m.channel
                          and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end
                          and (s.reason in ('bounced','complained') or m.template_key like 'outreach.%' or m.source='campaign'))
      order by m.scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $function$;

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
           and s.address = lower(d.recipient_email)
           and (
             s.reason in ('bounced', 'complained')
             or coalesce(d.template_key like 'outreach.%', false)
             or d.source = 'campaign'
           )
      )
      and (
        not coalesce(d.template_key like 'outreach.%', false)
        or exists (
          select 1
            from app_private.outreach_contacts oc
           where lower(trim(oc.email)) = lower(d.recipient_email)
             and oc.status in ('active', 'completed')
             and oc.replied_at is null
             and oc.converted_at is null
        )
      )
    from app_private.message_deliveries d
    where d.id = p_id
      and d.channel = 'email'
      and (coalesce(d.template_key like 'outreach.%', false) or d.source = 'campaign')
  ), false);
$function$;

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
  if p_token is distinct from app_private.outreach_unsub_token(v_email) then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;

  update app_private.outreach_contacts
     set status = 'unsubscribed'
   where lower(trim(email)) = v_email
     and status <> 'unsubscribed';

  insert into app_private.suppressions(channel, address, reason)
  values ('email', v_email, 'unsubscribed')
  on conflict do nothing;

  update app_private.message_deliveries
     set status = 'unsubscribed',
         failure_reason = 'recipient opted out of marketing/outreach',
         updated_at = now()
   where channel = 'email'
     and lower(recipient_email) = v_email
     and (template_key like 'outreach.%' or source = 'campaign')
     and status in ('queued', 'claimed');

  perform app_private.log_audit(
    'comm.outreach_unsubscribe', 'email', v_email, null,
    'recipient unsubscribed through outreach footer',
    jsonb_build_object('scope', 'marketing')
  );

  return jsonb_build_object('ok', true, 'scope', 'marketing');
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_delivery_worker_unsubscribe(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare
  d app_private.message_deliveries%rowtype;
  v_email text;
  v_marketing boolean;
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
    v_marketing := coalesce(d.template_key like 'outreach.%', false) or d.source = 'campaign';

    -- A token from an older operational email remains a valid way to opt out of marketing,
    -- but it never suppresses operational delivery or rewrites that operational row.
    insert into app_private.suppressions(channel, address, reason)
    values ('email', v_email, 'unsubscribed')
    on conflict do nothing;

    update app_private.outreach_contacts
       set status = 'unsubscribed'
     where lower(trim(email)) = v_email
       and status <> 'unsubscribed';

    update app_private.message_deliveries
       set status = 'unsubscribed',
           failure_reason = 'recipient opted out of marketing/outreach',
           updated_at = now()
     where channel = 'email'
       and lower(recipient_email) = v_email
       and (template_key like 'outreach.%' or source = 'campaign')
       and status in ('queued', 'claimed');

    if v_marketing then
      update app_private.message_deliveries
         set status = 'unsubscribed', updated_at = now()
       where id = d.id;
    end if;

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
     where id = d.id;

    perform app_private.log_audit(
      'comm.unsubscribe', 'delivery', d.id::text, null,
      'recipient unsubscribed from SMS through one-click link',
      jsonb_build_object('channel', 'sms')
    );

    return jsonb_build_object('ok', true, 'channel', 'sms');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'unsupported channel');
end;
$function$;
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
-- Restore only exact promoted bodies; suppression rows/cancellations remain.
DO $r0$ BEGIN
 IF md5(pg_get_functiondef('app_private.sys_email(text,text,text,text,text,text)'::regprocedure)) IS DISTINCT FROM '49e378917ea2803d0cf11b65aa30ea7d' THEN RAISE EXCEPTION 'Rollback drift: app_private.sys_email(text,text,text,text,text,text)'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION app_private.sys_email(p_to text, p_template text, p_subject text, p_html text, p_text text DEFAULT NULL::text, p_idem text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions s
             where s.channel='email' and s.address=lower(p_to)
               and (s.reason in ('bounced','complained') or p_template like 'outreach.%')) then return; end if;
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional','email','resend',lower(p_to),
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject',p_subject,'body_html',p_html,'body_text',coalesce(p_text,p_subject),'category','transactional'))
  on conflict (idempotency_key) do nothing;
end; $function$
$definition$;
END $r0$;
DO $r1$ BEGIN
 IF md5(pg_get_functiondef('public.cc_enqueue_transactional(text,text,text,text,text,jsonb,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '040e6eacccb65d567fcda499c25401e8' THEN RAISE EXCEPTION 'Rollback drift: public.cc_enqueue_transactional(text,text,text,text,text,jsonb,timestamp with time zone)'; END IF;
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
  if exists (select 1 from app_private.suppressions where channel=p_channel and lower(address)=lower(v_addr)) then
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
END $r1$;
DO $r2$ BEGIN
 IF md5(pg_get_functiondef('public.cc_delivery_worker_claim(integer,text)'::regprocedure)) IS DISTINCT FROM 'd887937ce27f925e88cb96515e34971e' THEN RAISE EXCEPTION 'Rollback drift: public.cc_delivery_worker_claim(integer,text)'; END IF;
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
                    and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end
                    and (s.reason in ('bounced','complained') or m.template_key like 'outreach.%' or m.source='campaign'));
  return query with claimed as (select id from app_private.message_deliveries m
      where m.status='queued' and m.channel=p_channel and coalesce(m.scheduled_at,now())<=now()
        and not exists (select 1 from app_private.suppressions s
                        where s.channel=m.channel
                          and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end
                          and (s.reason in ('bounced','complained') or m.template_key like 'outreach.%' or m.source='campaign'))
      order by m.scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $function$
$definition$;
END $r2$;
DO $r3$ BEGIN
 IF md5(pg_get_functiondef('public.cc_delivery_worker_marketing_allowed(uuid)'::regprocedure)) IS DISTINCT FROM 'e80dba03fa4c09881c280d48e39b69dc' THEN RAISE EXCEPTION 'Rollback drift: public.cc_delivery_worker_marketing_allowed(uuid)'; END IF;
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
           and s.address = lower(d.recipient_email)
           and (
             s.reason in ('bounced', 'complained')
             or coalesce(d.template_key like 'outreach.%', false)
             or d.source = 'campaign'
           )
      )
      and (
        not coalesce(d.template_key like 'outreach.%', false)
        or exists (
          select 1
            from app_private.outreach_contacts oc
           where lower(trim(oc.email)) = lower(d.recipient_email)
             and oc.status in ('active', 'completed')
             and oc.replied_at is null
             and oc.converted_at is null
        )
      )
    from app_private.message_deliveries d
    where d.id = p_id
      and d.channel = 'email'
      and (coalesce(d.template_key like 'outreach.%', false) or d.source = 'campaign')
  ), false);
$function$
$definition$;
END $r3$;
DO $r4$ BEGIN
 IF md5(pg_get_functiondef('public.outreach_unsubscribe(text,text)'::regprocedure)) IS DISTINCT FROM '61f99e7275bf65f27e6ed11b2396a676' THEN RAISE EXCEPTION 'Rollback drift: public.outreach_unsubscribe(text,text)'; END IF;
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
  if p_token is distinct from app_private.outreach_unsub_token(v_email) then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;

  update app_private.outreach_contacts
     set status = 'unsubscribed'
   where lower(trim(email)) = v_email
     and status <> 'unsubscribed';

  insert into app_private.suppressions(channel, address, reason)
  values ('email', v_email, 'unsubscribed')
  on conflict do nothing;

  update app_private.message_deliveries
     set status = 'unsubscribed',
         failure_reason = 'recipient opted out of marketing/outreach',
         updated_at = now()
   where channel = 'email'
     and lower(recipient_email) = v_email
     and (template_key like 'outreach.%' or source = 'campaign')
     and status in ('queued', 'claimed');

  perform app_private.log_audit(
    'comm.outreach_unsubscribe', 'email', v_email, null,
    'recipient unsubscribed through outreach footer',
    jsonb_build_object('scope', 'marketing')
  );

  return jsonb_build_object('ok', true, 'scope', 'marketing');
end;
$function$
$definition$;
END $r4$;
DO $r5$ BEGIN
 IF md5(pg_get_functiondef('public.cc_delivery_worker_unsubscribe(uuid)'::regprocedure)) IS DISTINCT FROM '0090e4226dd14f8cddf2268c5b451f94' THEN RAISE EXCEPTION 'Rollback drift: public.cc_delivery_worker_unsubscribe(uuid)'; END IF;
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
  v_marketing boolean;
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
    v_marketing := coalesce(d.template_key like 'outreach.%', false) or d.source = 'campaign';

    -- A token from an older operational email remains a valid way to opt out of marketing,
    -- but it never suppresses operational delivery or rewrites that operational row.
    insert into app_private.suppressions(channel, address, reason)
    values ('email', v_email, 'unsubscribed')
    on conflict do nothing;

    update app_private.outreach_contacts
       set status = 'unsubscribed'
     where lower(trim(email)) = v_email
       and status <> 'unsubscribed';

    update app_private.message_deliveries
       set status = 'unsubscribed',
           failure_reason = 'recipient opted out of marketing/outreach',
           updated_at = now()
     where channel = 'email'
       and lower(recipient_email) = v_email
       and (template_key like 'outreach.%' or source = 'campaign')
       and status in ('queued', 'claimed');

    if v_marketing then
      update app_private.message_deliveries
         set status = 'unsubscribed', updated_at = now()
       where id = d.id;
    end if;

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
     where id = d.id;

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
END $r5$;
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

CREATE FUNCTION pg_temp.unsub_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF new.address=current_setting('audit.unsub_email',true) AND current_setting('audit.unsub_fail',true)='yes' THEN
  RAISE EXCEPTION 'synthetic opt-out failure' USING ERRCODE='PZ004';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER audit_unsub_failure BEFORE INSERT ON app_private.suppressions
 FOR EACH ROW EXECUTE FUNCTION pg_temp.unsub_injected_failure();
DO $tests$
DECLARE path text; addr text; tok text; correlation uuid; rid uuid; result jsonb; failed boolean; original_helper text; counts int; why text;
BEGIN
 ASSERT has_function_privilege('anon','public.outreach_unsubscribe(text,text)','execute'),'public link lost';
 ASSERT NOT has_function_privilege('anon','public.cc_delivery_worker_unsubscribe(uuid)','execute'),'worker anon grant';
 ASSERT NOT has_function_privilege('authenticated','public.cc_delivery_worker_unsubscribe(uuid)','execute'),'worker authenticated grant';
 ASSERT has_function_privilege('service_role','public.cc_delivery_worker_unsubscribe(uuid)','execute'),'worker service grant lost';
 EXECUTE 'SET LOCAL ROLE anon';
 result:=public.outreach_unsubscribe(null,null); ASSERT result->>'ok'='false','null accepted';
 result:=public.outreach_unsubscribe('not-an-email','invalid'); ASSERT result->>'ok'='false','malformed accepted';
 failed:=false; BEGIN PERFORM public.cc_delivery_worker_unsubscribe(gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
 ASSERT failed,'anonymous worker callable';
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE service_role';
 result:=public.cc_delivery_worker_unsubscribe(gen_random_uuid()); ASSERT result->>'ok'='false','unknown token accepted';
 result:=public.cc_delivery_worker_unsubscribe(null); ASSERT result->>'ok'='false','null worker token accepted';
 EXECUTE 'RESET ROLE';
 FOREACH path IN ARRAY ARRAY['footer','delivery-token'] LOOP
  addr:='audit-unsub-'||gen_random_uuid()||'@example.invalid';
  tok:=app_private.outreach_unsub_token(addr);
  ASSERT tok IS NOT NULL AND tok<>'','staging secret unavailable; do not invent one';
  PERFORM set_config('audit.unsub_email',addr,true);
  INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',addr,'active');
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  SELECT 'transactional','email',' '||upper(addr)||' ','OUTREACH_carrier_1',st,'audit-unsub-'||addr||'-'||st
  FROM unnest(ARRAY['queued','claimed','scheduled','delivered']) st;
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('campaign','email',addr,null,'scheduled','audit-unsub-'||addr||'-campaign'),
        ('transactional','email',addr,'account.confirm','queued','audit-unsub-'||addr||'-txn');
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('transactional','email',addr,'account.confirm','delivered','audit-unsub-'||addr||'-old-operational') RETURNING correlation_id,id INTO correlation,rid;
  EXECUTE 'SET LOCAL ROLE anon';
  result:=public.outreach_unsubscribe(addr,'bad-token'); ASSERT result->>'ok'='false','wrong signature accepted';
  result:=public.outreach_unsubscribe(addr,null); ASSERT result->>'ok'='false','missing signature accepted';
  result:=public.outreach_unsubscribe(addr,''); ASSERT result->>'ok'='false','empty signature accepted';
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT status='active' FROM app_private.outreach_contacts WHERE email=addr),'invalid link changed contact';
  ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'invalid link created suppression';
  -- No secret/value is altered: simulate unavailable verifier result transactionally.
  SELECT pg_get_functiondef('app_private.outreach_unsub_token(text)'::regprocedure) INTO original_helper;
  EXECUTE 'CREATE OR REPLACE FUNCTION app_private.outreach_unsub_token(p_email text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''app_private, public'' AS ''select null::text''';
  EXECUTE 'SET LOCAL ROLE anon';
  result:=public.outreach_unsubscribe(addr,null); ASSERT result->>'ok'='false','NULL verifier + NULL token accepted';
  result:=public.outreach_unsubscribe(addr,tok); ASSERT result->>'ok'='false','unavailable verifier accepted';
  EXECUTE 'RESET ROLE';
  EXECUTE original_helper;
  PERFORM set_config('audit.unsub_fail','yes',true);
  failed:=false;
  IF path='footer' THEN
   EXECUTE 'SET LOCAL ROLE anon';
   BEGIN PERFORM public.outreach_unsubscribe(addr,tok); EXCEPTION WHEN SQLSTATE 'PZ004' THEN failed:=true; END;
  ELSE
   EXECUTE 'SET LOCAL ROLE service_role';
   BEGIN PERFORM public.cc_delivery_worker_unsubscribe(correlation); EXCEPTION WHEN SQLSTATE 'PZ004' THEN failed:=true; END;
  END IF;
  EXECUTE 'RESET ROLE';
  ASSERT failed,'suppression failure swallowed';
  ASSERT (SELECT status='active' FROM app_private.outreach_contacts WHERE email=addr),'failed unsubscribe changed contact';
  ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'failed suppression persisted';
  ASSERT (SELECT status='queued' FROM app_private.message_deliveries WHERE idempotency_key='audit-unsub-'||addr||'-queued'),'failed unsubscribe changed delivery';
  PERFORM set_config('audit.unsub_fail','no',true);
  IF path='footer' THEN
   EXECUTE 'SET LOCAL ROLE anon'; result:=public.outreach_unsubscribe(' '||upper(addr)||' ',tok);
  ELSE
   EXECUTE 'SET LOCAL ROLE service_role'; result:=public.cc_delivery_worker_unsubscribe(correlation);
  END IF;
  EXECUTE 'RESET ROLE';
  ASSERT result->>'ok'='true' AND result->>'scope'='marketing','valid opt-out failed';
  ASSERT (SELECT status='unsubscribed' FROM app_private.outreach_contacts WHERE email=addr),'contact still active';
  ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE address=addr AND reason='unsubscribed'),'durable suppression missing';
  ASSERT (SELECT count(*)=4 FROM app_private.message_deliveries WHERE lower(btrim(recipient_email))=addr AND status='unsubscribed'),'pending marketing not cancelled';
  ASSERT (SELECT status='delivered' FROM app_private.message_deliveries WHERE idempotency_key='audit-unsub-'||addr||'-delivered'),'delivered marketing history overwritten';
  ASSERT (SELECT status='delivered' FROM app_private.message_deliveries WHERE id=rid),'old operational token row rewritten';
  ASSERT (SELECT status='queued' FROM app_private.message_deliveries WHERE idempotency_key='audit-unsub-'||addr||'-txn'),'ordinary transaction cancelled';
  DELETE FROM app_private.outreach_contacts WHERE email=addr;
  IF path='footer' THEN
   EXECUTE 'SET LOCAL ROLE anon'; result:=public.outreach_unsubscribe(addr,tok);
  ELSE
   EXECUTE 'SET LOCAL ROLE service_role'; result:=public.cc_delivery_worker_unsubscribe(correlation);
  END IF;
  EXECUTE 'RESET ROLE';
  ASSERT result->>'ok'='true','repeated opt-out failed after contact deletion';
  ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE address=addr),'duplicate suppression on repeat';
  INSERT INTO app_private.outreach_contacts(kind,email,status) VALUES('carrier',addr,'active');
  INSERT INTO app_private.message_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
  VALUES('transactional','email',addr,'outreach.carrier.1','claimed','audit-unsub-'||addr||'-reimport') RETURNING id INTO rid;
  ASSERT NOT public.cc_delivery_worker_marketing_allowed(rid),'reimport bypassed suppression';
  FOR why IN SELECT unnest(ARRAY['bounced','complained','manual']) LOOP
   UPDATE app_private.suppressions SET reason=why WHERE address=addr;
   IF path='footer' THEN
    EXECUTE 'SET LOCAL ROLE anon'; result:=public.outreach_unsubscribe(addr,tok);
   ELSE
    EXECUTE 'SET LOCAL ROLE service_role'; result:=public.cc_delivery_worker_unsubscribe(correlation);
   END IF;
   EXECUTE 'RESET ROLE';
   ASSERT result->>'ok'='true','stronger marker rejects unsubscribe';
   ASSERT (SELECT count(*)=1 FROM app_private.suppressions WHERE address=addr AND reason=why),'stronger marker overwritten';
  END LOOP;
 END LOOP;
 -- No-contact footer remains a durable opt-out, not a no-op.
 addr:='audit-unsub-'||gen_random_uuid()||'@example.invalid';tok:=app_private.outreach_unsub_token(addr);
 EXECUTE 'SET LOCAL ROLE anon';result:=public.outreach_unsubscribe(addr,tok);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true','no-contact valid link failed';
 ASSERT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'no-contact opt-out lost';
 -- SMS remains channel-specific; unsupported / malformed records cause no success.
 INSERT INTO app_private.message_deliveries(source,channel,recipient_phone,status,idempotency_key)
 VALUES('transactional','sms','+15551112222','queued','audit-unsub-sms-'||gen_random_uuid()) RETURNING correlation_id,id INTO correlation,rid;
 EXECUTE 'SET LOCAL ROLE service_role';result:=public.cc_delivery_worker_unsubscribe(correlation);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true' AND result->>'channel'='sms','SMS unsubscribe failed';
 ASSERT EXISTS(SELECT 1 FROM app_private.suppressions WHERE channel='sms' AND address='+15551112222'),'SMS marker missing';
 ASSERT (SELECT status='unsubscribed' FROM app_private.message_deliveries WHERE id=rid),'SMS pending row not cancelled';
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,status,idempotency_key)
 VALUES('transactional','push',addr,'queued','audit-unsub-push-'||gen_random_uuid()) RETURNING correlation_id INTO correlation;
 EXECUTE 'SET LOCAL ROLE service_role';result:=public.cc_delivery_worker_unsubscribe(correlation);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='false','unsupported channel accepted';
 INSERT INTO app_private.message_deliveries(source,channel,recipient_email,status,idempotency_key)
 VALUES('transactional','email',' ','queued','audit-unsub-invalid-'||gen_random_uuid()) RETURNING correlation_id INTO correlation;
 EXECUTE 'SET LOCAL ROLE service_role';result:=public.cc_delivery_worker_unsubscribe(correlation);EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='false','empty email accepted';
 ASSERT NOT EXISTS(
 (SELECT * FROM unsub_anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM unsub_anon_before)), 'anon surface changed';
END $tests$;
SELECT 'PASS: footer and delivery-token durable unsubscribe, transactional/history preservation, validation/failure rollback, stronger reasons, re-import and SMS; transaction rolled back' result;
ROLLBACK;

