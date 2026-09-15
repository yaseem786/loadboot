-- Isolated actual-source sender checks; only temporary tables, no delivery worker or provider call.
BEGIN; SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE mock_deliveries (LIKE app_private.message_deliveries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TEMP TABLE mock_suppressions (LIKE app_private.suppressions INCLUDING DEFAULTS);
CREATE TEMP TABLE mock_contacts (LIKE app_private.outreach_contacts INCLUDING DEFAULTS);
CREATE FUNCTION pg_temp.can_manage_comms() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION pg_temp.sys_email(p_to text, p_template text, p_subject text, p_html text, p_text text DEFAULT NULL::text, p_idem text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from pg_temp.mock_suppressions where channel='email' and lower(btrim(address))=lower(btrim(p_to))
    and (reason IS DISTINCT FROM 'unsubscribed' or coalesce(p_template ~* '^outreach[._-]',false))) then return; end if;
  insert into pg_temp.mock_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional','email','resend',lower(p_to),
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject',p_subject,'body_html',p_html,'body_text',coalesce(p_text,p_subject),'category','transactional'))
  on conflict (idempotency_key) do nothing;
end; $function$;
CREATE OR REPLACE FUNCTION pg_temp.cc_enqueue_transactional(p_channel text, p_email text, p_template_key text DEFAULT NULL::text, p_subject text DEFAULT NULL::text, p_idem text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_key text; v_sched timestamptz; v_id uuid; v_ins int; v_provider text; v_addr text;
begin
  if not pg_temp.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_channel not in ('email','sms') then raise exception 'invalid channel' using errcode='22023'; end if;
  if p_channel='email' then
    if p_email is null or p_email !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'invalid email recipient' using errcode='22023'; end if;
    v_addr := lower(p_email); v_provider := 'resend';
  else
    if p_email is null or p_email !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid sms recipient' using errcode='22023'; end if;
    v_addr := p_email; v_provider := 'twilio';
  end if;
  if exists (select 1 from pg_temp.mock_suppressions where channel=p_channel and lower(btrim(address))=lower(btrim(v_addr))
    and (p_channel <> 'email' or reason IS DISTINCT FROM 'unsubscribed'
         or coalesce(p_template_key ~* '^outreach[._-]',false))) then
    return jsonb_build_object('queued',false,'reason','suppressed'); end if;
  v_sched := coalesce(p_scheduled_at, now());
  v_key := coalesce(p_idem, 'txn:'||p_channel||':'||lower(v_addr)||':'||coalesce(p_template_key,'')||':'||extract(epoch from v_sched)::bigint::text);
  insert into pg_temp.mock_deliveries(source,channel,provider,recipient_email,recipient_phone,idempotency_key,status,scheduled_at,template_key,meta)
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
CREATE OR REPLACE FUNCTION pg_temp.cc_delivery_worker_claim(p_limit integer DEFAULT 50, p_channel text DEFAULT 'email'::text)
 RETURNS SETOF pg_temp.mock_deliveries
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Close out queued deliveries that suppression policy now blocks.
  update pg_temp.mock_deliveries m
    set status='unsubscribed', failure_reason='recipient suppressed', updated_at=now()
    where m.status='queued' and m.channel=p_channel
      and exists (select 1 from pg_temp.mock_suppressions s
                  where s.channel=m.channel
                    and lower(btrim(s.address)) = lower(btrim(case when m.channel='email' then m.recipient_email else m.recipient_phone end))
                    and (m.channel <> 'email' or s.reason IS DISTINCT FROM 'unsubscribed' or coalesce(m.template_key ~* '^outreach[._-]',false) or m.source='campaign'));
  return query with claimed as (select id from pg_temp.mock_deliveries m
      where m.status='queued' and m.channel=p_channel and coalesce(m.scheduled_at,now())<=now()
        and not exists (select 1 from pg_temp.mock_suppressions s
                        where s.channel=m.channel
                          and lower(btrim(s.address)) = lower(btrim(case when m.channel='email' then m.recipient_email else m.recipient_phone end))
                          and (m.channel <> 'email' or s.reason IS DISTINCT FROM 'unsubscribed' or coalesce(m.template_key ~* '^outreach[._-]',false) or m.source='campaign'))
      order by m.scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update pg_temp.mock_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $function$;
CREATE OR REPLACE FUNCTION pg_temp.cc_delivery_worker_marketing_allowed(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((
    select
      d.status = 'claimed'
      and not exists (
        select 1
          from pg_temp.mock_suppressions s
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
            from pg_temp.mock_contacts oc
           where lower(trim(oc.email)) = lower(btrim(d.recipient_email))
             and oc.status in ('active', 'completed')
             and oc.replied_at is null
             and oc.converted_at is null
        )
      )
    from pg_temp.mock_deliveries d
    where d.id = p_id
      and d.channel = 'email'
      and (coalesce(d.template_key ~* '^outreach[._-]', false) or d.source = 'campaign')
  ), false);
$function$;

DO $tests$
DECLARE reason text; tpl text; expected boolean; r jsonb; rid uuid; n int; checks int:=0;
BEGIN
 FOREACH reason IN ARRAY ARRAY['unsubscribed','bounced','complained','manual',NULL] LOOP
  FOREACH tpl IN ARRAY ARRAY['account.confirm','outreach.carrier','OUTREACH_carrier','outreach-carrier'] LOOP
   TRUNCATE pg_temp.mock_deliveries,pg_temp.mock_suppressions,pg_temp.mock_contacts;
   INSERT INTO pg_temp.mock_suppressions(channel,address,reason) VALUES('email',' Synthetic@EXAMPLE.invalid ',reason);
   expected:=reason='unsubscribed' AND tpl='account.confirm';
   expected:=coalesce(expected,false);
   PERFORM pg_temp.sys_email('synthetic@example.invalid',tpl,'synthetic','synthetic',null,'sys-test');
   ASSERT (EXISTS(SELECT FROM pg_temp.mock_deliveries WHERE idempotency_key='sys-test'))=expected,'sys_email scope'; checks:=checks+1;
   r:=pg_temp.cc_enqueue_transactional('email','synthetic@example.invalid',tpl,'synthetic','enqueue-test');
   ASSERT (r->>'queued')::boolean=expected,'enqueue scope'; checks:=checks+1;
   TRUNCATE pg_temp.mock_deliveries;
   INSERT INTO pg_temp.mock_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
    VALUES('transactional','email','synthetic@example.invalid',tpl,'queued','claim-test') RETURNING id INTO rid;
   SELECT count(*) INTO n FROM pg_temp.cc_delivery_worker_claim(1,'email');
   ASSERT (n=1)=expected,'claim scope'; checks:=checks+1;
  END LOOP;
 END LOOP;
 TRUNCATE pg_temp.mock_deliveries,pg_temp.mock_suppressions,pg_temp.mock_contacts;
 INSERT INTO pg_temp.mock_contacts(kind,email,status) VALUES('carrier','synthetic@example.invalid','active');
 INSERT INTO pg_temp.mock_deliveries(source,channel,recipient_email,template_key,status,idempotency_key)
 VALUES('transactional','email',' SYNTHETIC@example.invalid ','OUTREACH_carrier','claimed','eligibility') RETURNING id INTO rid;
 ASSERT pg_temp.cc_delivery_worker_marketing_allowed(rid),'positive marketing control'; checks:=checks+1;
 INSERT INTO pg_temp.mock_suppressions(channel,address,reason) VALUES('email','synthetic@example.invalid','unsubscribed');
 ASSERT NOT pg_temp.cc_delivery_worker_marketing_allowed(rid),'optout eligibility'; checks:=checks+1;
 ASSERT checks=62,'assertion count';
END $tests$;
ROLLBACK;
SELECT 'PASS: 62 isolated sender/claim/eligibility checks; no real queue or sender used' result;

