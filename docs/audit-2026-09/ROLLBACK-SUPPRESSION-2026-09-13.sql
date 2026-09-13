-- Rollback code only after explicit authorization. Keep every recorded suppression.
-- Refuses changed definitions; no contact recreation, deletion or queue replay.
DO $rollback$
BEGIN
IF md5(pg_get_functiondef('public.cc_account_deletion_process'::regproc)) IS DISTINCT FROM '1b064d8662a4b4c2e9b3bc2cdb684f7f' THEN RAISE EXCEPTION 'Rollback source drift: cc_account_deletion_process'; END IF;
IF md5(pg_get_functiondef('public.cc_delivery_worker_claim'::regproc)) IS DISTINCT FROM 'd887937ce27f925e88cb96515e34971e' THEN RAISE EXCEPTION 'Rollback source drift: cc_delivery_worker_claim'; END IF;
IF md5(pg_get_functiondef('public.cc_delivery_worker_marketing_allowed'::regproc)) IS DISTINCT FROM 'e80dba03fa4c09881c280d48e39b69dc' THEN RAISE EXCEPTION 'Rollback source drift: cc_delivery_worker_marketing_allowed'; END IF;
IF md5(pg_get_functiondef('public.cc_enqueue_transactional'::regproc)) IS DISTINCT FROM '040e6eacccb65d567fcda499c25401e8' THEN RAISE EXCEPTION 'Rollback source drift: cc_enqueue_transactional'; END IF;
IF md5(pg_get_functiondef('app_private.sys_email'::regproc)) IS DISTINCT FROM '49e378917ea2803d0cf11b65aa30ea7d' THEN RAISE EXCEPTION 'Rollback source drift: sys_email'; END IF;
EXECUTE $restore$CREATE OR REPLACE FUNCTION public.cc_account_deletion_process(p_id bigint, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare r app_private.account_deletion_requests; v_done jsonb := '{}'::jsonb; n int;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_action IS NULL OR p_action NOT IN ('reject','complete') then
    raise exception 'unknown action' using errcode='22023';
  end if;
  select * into r from app_private.account_deletion_requests where id = p_id FOR UPDATE;
  if r.id is null then raise exception 'request not found' using errcode='22023'; end if;
  if r.status <> 'requested' then raise exception 'request already %', r.status using errcode='22023'; end if;

  if p_action = 'reject' then
    if coalesce(trim(coalesce(p_note,'')),'') = '' then
      raise exception 'a reason is required to reject' using errcode='22023';
    end if;
    update app_private.account_deletion_requests
       set status='rejected', processed_at=now(), processed_by=auth.uid(), note=p_note where id=p_id;
    return jsonb_build_object('ok', true, 'status','rejected');
  end if;


  -- 1) contact details
  update public.profiles
     set email = 'deleted+' || r.user_id::text || '@deleted.invalid',
         contact_name = null, phone = null, company = 'Deleted account'
   where id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('profile', n);

  -- 2) agent payout + tax + address block (holds IBAN, wallet, DOB, ID doc refs)
  update app_private.agent_profiles
     set full_name='Deleted account', phone=null, street=null, zip=null, city=null,
         state=null, country=null, payout_details='{}'::jsonb, tax_id_last4=null
   where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('agent_profile', n);

  -- 3) banking for every org this user owns
  update app_private.org_payment_profiles p
     set account_number='', bank_name='', account_title='',
         verified=false, verified_by=null, verified_at=null,
         routing_number=null, tax_id=null, swift_bic=null,
         bank_address=null, beneficiary_address=null, remittance_email=null, bank_phone=null
   where exists (select 1 from public.organizations o
                  where o.id = p.org_id and o.owner_user_id = r.user_id);
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('payment_profiles', n);

  -- 4) document metadata belongs to profiles(id), not organizations(id).
  -- Storage objects and retained transaction records require separate lifecycle handling.
  delete from public.documents d where d.carrier_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('documents', n);

  -- 5) conversations and messages
  update app_private.lc_conversations set email=null, name=null where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('chats', n);
  delete from app_private.agent_messages where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('agent_messages', n);

  -- 6) matching marketing/CRM rows only. A missing email must not match blank contacts.
  -- Durable suppression and complete erasure remain separate audit work.
  -- Cleanup failures must abort the transaction, never report partial erasure as completed.
  delete from app_private.crm_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('crm_contacts', n);
  delete from app_private.outreach_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('outreach_contacts', n);

  -- 7) close the login. The auth row is kept (not dropped) so the retained financial
  --    records keep a stable foreign key — but it can never be signed into again.
  update auth.users
     set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
         email = 'deleted+' || r.user_id::text || '@deleted.invalid',
         phone = null, raw_user_meta_data = '{}'::jsonb,
         banned_until = 'infinity', updated_at = now()
   where id = r.user_id;

  update app_private.account_deletion_requests
     set status='completed', processed_at=now(), processed_by=auth.uid(),
         note = coalesce(p_note,'') || ' | erased: ' || v_done::text
   where id = p_id;

  return jsonb_build_object('ok', true, 'status','completed', 'erased', v_done);
end $function$
$restore$;
EXECUTE $restore$CREATE OR REPLACE FUNCTION public.cc_delivery_worker_claim(p_limit integer DEFAULT 50, p_channel text DEFAULT 'email'::text)
 RETURNS SETOF app_private.message_deliveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
begin
  return query with claimed as (select id from app_private.message_deliveries
      where status='queued' and channel=p_channel and coalesce(scheduled_at,now())<=now()
      order by scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $function$
$restore$;
EXECUTE $restore$CREATE OR REPLACE FUNCTION public.cc_enqueue_transactional(p_channel text, p_email text, p_template_key text DEFAULT NULL::text, p_subject text DEFAULT NULL::text, p_idem text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
$restore$;
EXECUTE $restore$CREATE OR REPLACE FUNCTION app_private.sys_email(p_to text, p_template text, p_subject text, p_html text, p_text text DEFAULT NULL::text, p_idem text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions where channel='email' and address=lower(p_to)) then return; end if;
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional','email','resend',lower(p_to),
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject',p_subject,'body_html',p_html,'body_text',coalesce(p_text,p_subject),'category','transactional'))
  on conflict (idempotency_key) do nothing;
end; $function$
$restore$;
DROP FUNCTION public.cc_delivery_worker_marketing_allowed(uuid);
END $rollback$;
