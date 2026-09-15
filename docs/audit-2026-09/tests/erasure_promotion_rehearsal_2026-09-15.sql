-- STAGING ONLY. Storage metadata fixture lives ONLY in a temporary table; no Storage mutation/API.
BEGIN; SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE erasure_anon_before AS SELECT p.proname,pg_get_function_identity_arguments(p.oid) args
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
DO $pre$ BEGIN IF EXISTS(SELECT FROM app_private.account_erasure_inventories) THEN RAISE EXCEPTION 'Staging has saved inventory; do not remove'; END IF; END $pre$;
DROP FUNCTION app_private.capture_account_erasure_inventory(bigint);
DROP TABLE app_private.account_erasure_inventories;
CREATE OR REPLACE FUNCTION public.cc_account_deletion_process(p_id bigint, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare r app_private.account_deletion_requests; v_done jsonb := '{}'::jsonb; n int;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select * into r from app_private.account_deletion_requests where id = p_id;
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

  if p_action <> 'complete' then raise exception 'unknown action' using errcode='22023'; end if;

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
     set account_number=null, routing_number=null, tax_id=null, swift_bic=null,
         bank_address=null, beneficiary_address=null, remittance_email=null, bank_phone=null
   where exists (select 1 from public.organizations o
                  where o.id = p.org_id and o.owner_user_id = r.user_id);
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('payment_profiles', n);

  -- 4) uploaded documents (compliance folder) for orgs this user owns
  delete from public.documents d
   where exists (select 1 from public.organizations o
                  where o.id = d.carrier_id and o.owner_user_id = r.user_id);
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('documents', n);

  -- 5) conversations and messages
  update app_private.lc_conversations set email=null, name=null where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('chats', n);
  delete from app_private.agent_messages where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('agent_messages', n);

  -- 6) marketing/CRM traces + suppress the address so nothing is ever sent again
  begin
    delete from app_private.crm_contacts where lower(email) = lower(coalesce(r.email,''));
    delete from app_private.outreach_contacts where lower(email) = lower(coalesce(r.email,''));
  exception when others then null; end;

  begin perform app_private.detach_carrier_drivers(o.id, 'deleted') from public.organizations o where o.owner_user_id = r.user_id and o.kind = 'carrier'; exception when others then null; end;
  -- 7) close the login. The auth row is kept (not dropped) so the retained financial
  --    records keep a stable foreign key — but it can never be signed into again.
  update auth.users
     set encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
         email = 'deleted+' || r.user_id::text || '@deleted.invalid',
         phone = null, raw_user_meta_data = '{}'::jsonb,
         banned_until = 'infinity', updated_at = now()
   where id = r.user_id;

  update app_private.account_deletion_requests
     set status='completed', processed_at=now(), processed_by=auth.uid(),
         note = coalesce(p_note,'') || ' | erased: ' || v_done::text
   where id = p_id;

  return jsonb_build_object('ok', true, 'status','completed', 'erased', v_done);
end $function$;
-- Consolidated production promotion; no account processed or data backfilled.
-- Preserves current driver detach step; does not claim full object erasure.
DO $guard$ BEGIN
 IF to_regclass('app_private.account_erasure_inventories') IS NOT NULL OR to_regprocedure('app_private.capture_account_erasure_inventory(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'Inventory already exists; re-sync'; END IF;
 IF md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure)) IS DISTINCT FROM '26513abdf6f932ecf711032534a8901b' THEN RAISE EXCEPTION 'Deletion source drift'; END IF;
END $guard$;
-- STAGING ONLY: preserve file references and stop destructive completion pending reviewed erasure.
CREATE TABLE app_private.account_erasure_inventories (
 request_id bigint PRIMARY KEY REFERENCES app_private.account_deletion_requests(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL,
 items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(items)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.account_erasure_inventories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.account_erasure_inventories FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app_private.capture_account_erasure_inventory(p_request_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'pg_catalog'
AS $capture$
DECLARE r app_private.account_deletion_requests; found_items jsonb; total integer;
BEGIN
 IF NOT (public.has_global_permission('carriers.approve') OR public.has_global_permission('finance.approve')) THEN
  RAISE EXCEPTION 'not authorized' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM app_private.account_deletion_requests WHERE id=p_request_id FOR UPDATE;
 IF r.id IS NULL OR r.status <> 'requested' THEN RAISE EXCEPTION 'no open request' USING ERRCODE='22023'; END IF;
 WITH owned_orgs AS (SELECT id FROM public.organizations WHERE owner_user_id=r.user_id),
 candidates AS (
  SELECT jsonb_build_object('source','documents','record_id',d.id,'bucket','documents','path',d.file_path,'kind',d.type) item
    FROM public.documents d WHERE d.carrier_id=r.user_id
  UNION ALL
  SELECT jsonb_build_object('source','storage','record_id',o.id,'bucket',o.bucket_id,'path',o.name,'version',o.version)
    FROM storage.objects o WHERE o.owner_id=r.user_id::text OR o.owner=r.user_id
      OR split_part(o.name,'/',1)=r.user_id::text
  UNION ALL
  SELECT jsonb_build_object('source','document_files','record_id',f.id,'bucket',f.bucket,'path',f.path,'kind',f.kind)
    FROM app_private.document_files f
    WHERE f.uploaded_by=r.user_id OR f.owner_id=r.user_id::text
      OR f.owner_id IN (SELECT id::text FROM owned_orgs)
      OR (f.owner_type='trip' AND EXISTS(SELECT 1 FROM app_private.trips t
           WHERE t.id::text=f.owner_id AND t.carrier_id IN (SELECT id FROM owned_orgs)))
      OR EXISTS(SELECT 1 FROM public.documents d WHERE d.carrier_id=r.user_id AND d.file_path=f.path)
  UNION ALL
  SELECT jsonb_build_object('source','agent_profile','record_id',a.user_id,'bucket',null,'path',a.payout_details->>k.key,'kind',k.key)
    FROM app_private.agent_profiles a CROSS JOIN (VALUES('id_doc'),('bank_doc')) k(key)
    WHERE a.user_id=r.user_id AND nullif(a.payout_details->>k.key,'') IS NOT NULL
  UNION ALL
  SELECT jsonb_build_object('source','onboarding','record_id',b.id,'ordinal',d.ordinality,
      'bucket',d.doc->>'bucket','path',coalesce(d.doc->>'path',d.doc->>'file_path',d.doc->>'storage_path'),
      'kind',coalesce(d.doc->>'type',d.doc->>'kind'))
    FROM app_private.lc_onboarding b
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.docs)='array' THEN b.docs ELSE '[]'::jsonb END)
      WITH ORDINALITY d(doc,ordinality)
    WHERE EXISTS(SELECT 1 FROM app_private.lc_conversations c WHERE c.id=b.conversation_id AND c.user_id=r.user_id)
       OR (nullif(btrim(r.email),'') IS NOT NULL AND lower(btrim(b.account_email))=lower(btrim(r.email)))
  UNION ALL
  SELECT jsonb_build_object('source','onboarding_unparsed','record_id',b.id,'bucket',null,'path',null)
    FROM app_private.lc_onboarding b
    WHERE jsonb_typeof(b.docs) IS DISTINCT FROM 'array'
      AND (EXISTS(SELECT 1 FROM app_private.lc_conversations c WHERE c.id=b.conversation_id AND c.user_id=r.user_id)
       OR (nullif(btrim(r.email),'') IS NOT NULL AND lower(btrim(b.account_email))=lower(btrim(r.email))))
 )
 SELECT coalesce(jsonb_agg(DISTINCT item),'[]'::jsonb) INTO found_items FROM candidates;
 -- Append references: disappeared/changed metadata must not erase earlier evidence.
 INSERT INTO app_private.account_erasure_inventories(request_id,user_id,items)
 VALUES(r.id,r.user_id,found_items)
 ON CONFLICT(request_id) DO UPDATE
 SET items=(SELECT coalesce(jsonb_agg(DISTINCT e.item),'[]'::jsonb)
     FROM jsonb_array_elements(app_private.account_erasure_inventories.items || excluded.items) e(item)),
     updated_at=now();
 SELECT jsonb_array_length(items) INTO total FROM app_private.account_erasure_inventories WHERE request_id=r.id;
 RETURN total;
END $capture$;
REVOKE ALL ON FUNCTION app_private.capture_account_erasure_inventory(bigint) FROM PUBLIC,anon,authenticated,service_role;


DO $replace$ DECLARE acl_before text;
BEGIN
 SELECT proacl::text INTO acl_before FROM pg_proc WHERE oid='public.cc_account_deletion_process(bigint,text,text)'::regprocedure;
 EXECUTE $source$
CREATE OR REPLACE FUNCTION public.cc_account_deletion_process(p_id bigint, p_action text, p_note text DEFAULT NULL::text)
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


  -- Inventory must survive a blocked attempt; return a structured refusal, not an exception.
  -- File removal/retention proof is a later reviewed workflow; no bypass flag is exposed.
  n := app_private.capture_account_erasure_inventory(p_id);
  if n > 0 then
    return jsonb_build_object('ok',false,'status','requested','code','ERASURE_REVIEW_REQUIRED',
      'error','File review is required before account deletion can be completed.','file_references',n);
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

  -- Keep the minimal existing marketing opt-out after contact deletion.
  -- Never overwrite a stronger bounce/complaint/manual suppression.
  if nullif(btrim(r.email),'') is not null then
    insert into app_private.suppressions(channel,address,reason)
    select 'email',lower(btrim(r.email)),'unsubscribed'
    where not exists (select 1 from app_private.suppressions s
      where s.channel='email' and lower(btrim(s.address))=lower(btrim(r.email)));
    update app_private.message_deliveries
       set status='unsubscribed',failure_reason='account deletion marketing suppression',updated_at=now()
     where channel='email' and lower(btrim(recipient_email))=lower(btrim(r.email))
       and (coalesce(template_key ~* '^outreach[._-]',false) or source='campaign')
       and status in ('queued','claimed','scheduled');
  end if;

  -- 6) matching marketing/CRM rows only. A missing email must not match blank contacts.
  -- Complete storage erasure and session handling remain separate audit work.
  -- Cleanup failures must abort the transaction, never report partial erasure as completed.
  delete from app_private.crm_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('crm_contacts', n);
  delete from app_private.outreach_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('outreach_contacts', n);

  begin perform app_private.detach_carrier_drivers(o.id, 'deleted') from public.organizations o where o.owner_user_id = r.user_id and o.kind = 'carrier'; exception when others then null; end;
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
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_account_deletion_process(bigint,text,text)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'Deletion ACL drift'; END IF;
END $replace$;
-- Refuse rollback when any inventory has been captured.
DO $rollback$ BEGIN
 IF md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure)) IS DISTINCT FROM 'bc38da2b07e0606095b291df91041eb6' OR md5(pg_get_functiondef('app_private.capture_account_erasure_inventory(bigint)'::regprocedure)) IS DISTINCT FROM 'd6fd7d1c2e24a3a9d81ff763f49e089f' THEN RAISE EXCEPTION 'Rollback source drift'; END IF;
 IF EXISTS(SELECT FROM app_private.account_erasure_inventories) THEN RAISE EXCEPTION 'Saved inventory exists; preserve evidence'; END IF;
 EXECUTE $source$
CREATE OR REPLACE FUNCTION public.cc_account_deletion_process(p_id bigint, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare r app_private.account_deletion_requests; v_done jsonb := '{}'::jsonb; n int;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select * into r from app_private.account_deletion_requests where id = p_id;
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

  if p_action <> 'complete' then raise exception 'unknown action' using errcode='22023'; end if;

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
     set account_number=null, routing_number=null, tax_id=null, swift_bic=null,
         bank_address=null, beneficiary_address=null, remittance_email=null, bank_phone=null
   where exists (select 1 from public.organizations o
                  where o.id = p.org_id and o.owner_user_id = r.user_id);
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('payment_profiles', n);

  -- 4) uploaded documents (compliance folder) for orgs this user owns
  delete from public.documents d
   where exists (select 1 from public.organizations o
                  where o.id = d.carrier_id and o.owner_user_id = r.user_id);
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('documents', n);

  -- 5) conversations and messages
  update app_private.lc_conversations set email=null, name=null where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('chats', n);
  delete from app_private.agent_messages where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('agent_messages', n);

  -- 6) marketing/CRM traces + suppress the address so nothing is ever sent again
  begin
    delete from app_private.crm_contacts where lower(email) = lower(coalesce(r.email,''));
    delete from app_private.outreach_contacts where lower(email) = lower(coalesce(r.email,''));
  exception when others then null; end;

  begin perform app_private.detach_carrier_drivers(o.id, 'deleted') from public.organizations o where o.owner_user_id = r.user_id and o.kind = 'carrier'; exception when others then null; end;
  -- 7) close the login. The auth row is kept (not dropped) so the retained financial
  --    records keep a stable foreign key — but it can never be signed into again.
  update auth.users
     set encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
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
$source$;
 DROP FUNCTION app_private.capture_account_erasure_inventory(bigint);
 DROP TABLE app_private.account_erasure_inventories;
END $rollback$;
-- Consolidated production promotion; no account processed or data backfilled.
-- Preserves current driver detach step; does not claim full object erasure.
DO $guard$ BEGIN
 IF to_regclass('app_private.account_erasure_inventories') IS NOT NULL OR to_regprocedure('app_private.capture_account_erasure_inventory(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'Inventory already exists; re-sync'; END IF;
 IF md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure)) IS DISTINCT FROM '26513abdf6f932ecf711032534a8901b' THEN RAISE EXCEPTION 'Deletion source drift'; END IF;
END $guard$;
-- STAGING ONLY: preserve file references and stop destructive completion pending reviewed erasure.
CREATE TABLE app_private.account_erasure_inventories (
 request_id bigint PRIMARY KEY REFERENCES app_private.account_deletion_requests(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL,
 items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(items)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.account_erasure_inventories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.account_erasure_inventories FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app_private.capture_account_erasure_inventory(p_request_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'pg_catalog'
AS $capture$
DECLARE r app_private.account_deletion_requests; found_items jsonb; total integer;
BEGIN
 IF NOT (public.has_global_permission('carriers.approve') OR public.has_global_permission('finance.approve')) THEN
  RAISE EXCEPTION 'not authorized' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM app_private.account_deletion_requests WHERE id=p_request_id FOR UPDATE;
 IF r.id IS NULL OR r.status <> 'requested' THEN RAISE EXCEPTION 'no open request' USING ERRCODE='22023'; END IF;
 WITH owned_orgs AS (SELECT id FROM public.organizations WHERE owner_user_id=r.user_id),
 candidates AS (
  SELECT jsonb_build_object('source','documents','record_id',d.id,'bucket','documents','path',d.file_path,'kind',d.type) item
    FROM public.documents d WHERE d.carrier_id=r.user_id
  UNION ALL
  SELECT jsonb_build_object('source','storage','record_id',o.id,'bucket',o.bucket_id,'path',o.name,'version',o.version)
    FROM storage.objects o WHERE o.owner_id=r.user_id::text OR o.owner=r.user_id
      OR split_part(o.name,'/',1)=r.user_id::text
  UNION ALL
  SELECT jsonb_build_object('source','document_files','record_id',f.id,'bucket',f.bucket,'path',f.path,'kind',f.kind)
    FROM app_private.document_files f
    WHERE f.uploaded_by=r.user_id OR f.owner_id=r.user_id::text
      OR f.owner_id IN (SELECT id::text FROM owned_orgs)
      OR (f.owner_type='trip' AND EXISTS(SELECT 1 FROM app_private.trips t
           WHERE t.id::text=f.owner_id AND t.carrier_id IN (SELECT id FROM owned_orgs)))
      OR EXISTS(SELECT 1 FROM public.documents d WHERE d.carrier_id=r.user_id AND d.file_path=f.path)
  UNION ALL
  SELECT jsonb_build_object('source','agent_profile','record_id',a.user_id,'bucket',null,'path',a.payout_details->>k.key,'kind',k.key)
    FROM app_private.agent_profiles a CROSS JOIN (VALUES('id_doc'),('bank_doc')) k(key)
    WHERE a.user_id=r.user_id AND nullif(a.payout_details->>k.key,'') IS NOT NULL
  UNION ALL
  SELECT jsonb_build_object('source','onboarding','record_id',b.id,'ordinal',d.ordinality,
      'bucket',d.doc->>'bucket','path',coalesce(d.doc->>'path',d.doc->>'file_path',d.doc->>'storage_path'),
      'kind',coalesce(d.doc->>'type',d.doc->>'kind'))
    FROM app_private.lc_onboarding b
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.docs)='array' THEN b.docs ELSE '[]'::jsonb END)
      WITH ORDINALITY d(doc,ordinality)
    WHERE EXISTS(SELECT 1 FROM app_private.lc_conversations c WHERE c.id=b.conversation_id AND c.user_id=r.user_id)
       OR (nullif(btrim(r.email),'') IS NOT NULL AND lower(btrim(b.account_email))=lower(btrim(r.email)))
  UNION ALL
  SELECT jsonb_build_object('source','onboarding_unparsed','record_id',b.id,'bucket',null,'path',null)
    FROM app_private.lc_onboarding b
    WHERE jsonb_typeof(b.docs) IS DISTINCT FROM 'array'
      AND (EXISTS(SELECT 1 FROM app_private.lc_conversations c WHERE c.id=b.conversation_id AND c.user_id=r.user_id)
       OR (nullif(btrim(r.email),'') IS NOT NULL AND lower(btrim(b.account_email))=lower(btrim(r.email))))
 )
 SELECT coalesce(jsonb_agg(DISTINCT item),'[]'::jsonb) INTO found_items FROM candidates;
 -- Append references: disappeared/changed metadata must not erase earlier evidence.
 INSERT INTO app_private.account_erasure_inventories(request_id,user_id,items)
 VALUES(r.id,r.user_id,found_items)
 ON CONFLICT(request_id) DO UPDATE
 SET items=(SELECT coalesce(jsonb_agg(DISTINCT e.item),'[]'::jsonb)
     FROM jsonb_array_elements(app_private.account_erasure_inventories.items || excluded.items) e(item)),
     updated_at=now();
 SELECT jsonb_array_length(items) INTO total FROM app_private.account_erasure_inventories WHERE request_id=r.id;
 RETURN total;
END $capture$;
REVOKE ALL ON FUNCTION app_private.capture_account_erasure_inventory(bigint) FROM PUBLIC,anon,authenticated,service_role;


DO $replace$ DECLARE acl_before text;
BEGIN
 SELECT proacl::text INTO acl_before FROM pg_proc WHERE oid='public.cc_account_deletion_process(bigint,text,text)'::regprocedure;
 EXECUTE $source$
CREATE OR REPLACE FUNCTION public.cc_account_deletion_process(p_id bigint, p_action text, p_note text DEFAULT NULL::text)
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


  -- Inventory must survive a blocked attempt; return a structured refusal, not an exception.
  -- File removal/retention proof is a later reviewed workflow; no bypass flag is exposed.
  n := app_private.capture_account_erasure_inventory(p_id);
  if n > 0 then
    return jsonb_build_object('ok',false,'status','requested','code','ERASURE_REVIEW_REQUIRED',
      'error','File review is required before account deletion can be completed.','file_references',n);
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

  -- Keep the minimal existing marketing opt-out after contact deletion.
  -- Never overwrite a stronger bounce/complaint/manual suppression.
  if nullif(btrim(r.email),'') is not null then
    insert into app_private.suppressions(channel,address,reason)
    select 'email',lower(btrim(r.email)),'unsubscribed'
    where not exists (select 1 from app_private.suppressions s
      where s.channel='email' and lower(btrim(s.address))=lower(btrim(r.email)));
    update app_private.message_deliveries
       set status='unsubscribed',failure_reason='account deletion marketing suppression',updated_at=now()
     where channel='email' and lower(btrim(recipient_email))=lower(btrim(r.email))
       and (coalesce(template_key ~* '^outreach[._-]',false) or source='campaign')
       and status in ('queued','claimed','scheduled');
  end if;

  -- 6) matching marketing/CRM rows only. A missing email must not match blank contacts.
  -- Complete storage erasure and session handling remain separate audit work.
  -- Cleanup failures must abort the transaction, never report partial erasure as completed.
  delete from app_private.crm_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('crm_contacts', n);
  delete from app_private.outreach_contacts where lower(email) = lower(nullif(btrim(r.email),''));
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('outreach_contacts', n);

  begin perform app_private.detach_carrier_drivers(o.id, 'deleted') from public.organizations o where o.owner_user_id = r.user_id and o.kind = 'carrier'; exception when others then null; end;
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
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_account_deletion_process(bigint,text,text)'::regprocedure) IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'Deletion ACL drift'; END IF;
END $replace$;

CREATE TEMP TABLE inventory_storage (LIKE storage.objects INCLUDING DEFAULTS);
CREATE FUNCTION pg_temp.fail_erasure_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('audit.inventory_fail',true)='yes' THEN RAISE EXCEPTION 'synthetic inventory failure' USING ERRCODE='PZ005'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER audit_inventory_fail BEFORE INSERT ON app_private.account_erasure_inventories
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_erasure_inventory();
DO $tests$
DECLARE staff uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); empty_user uuid:=gen_random_uuid(); org uuid;
 rid bigint; empty_rid bigint; addr text:='audit-inventory-'||target||'@example.invalid';
 result jsonb; profile_before jsonb; failed boolean; original_capture text; captures jsonb; cnt integer; role_name text;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (staff,'audit-inventory-staff-'||staff||'@example.invalid','{"role":"driver"}'),
 (target,addr,'{"role":"driver"}'),(empty_user,'audit-inventory-empty-'||empty_user||'@example.invalid','{"role":"driver"}');
 SELECT id INTO STRICT org FROM public.organizations WHERE kind='internal' AND status='active';
 INSERT INTO app_private.staff_members(user_id,status) VALUES(staff,'active');
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(org,staff,'staff','active');
 INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(staff,'carriers.approve','allow');
 INSERT INTO app_private.account_deletion_requests(user_id,email) VALUES(target,addr) RETURNING id INTO rid;
 INSERT INTO app_private.account_deletion_requests(user_id,email) VALUES(empty_user,'audit-inventory-empty-'||empty_user||'@example.invalid') RETURNING id INTO empty_rid;
 INSERT INTO public.documents(carrier_id,type,file_name,file_path) VALUES(target,'w9','synthetic',null);
 INSERT INTO app_private.document_files(owner_type,owner_id,bucket,path,uploaded_by)
 VALUES('trip','synthetic-unrelated-owner','documents','staff-upload/synthetic.txt',target);
 INSERT INTO app_private.agent_profiles(user_id,payout_details) VALUES(target,'{"id_doc":"agent/id.pdf","bank_doc":"agent/bank.pdf"}')
 ON CONFLICT(user_id) DO UPDATE SET payout_details=excluded.payout_details;
 INSERT INTO app_private.lc_onboarding(visitor_key,account_email,docs)
 VALUES('audit'||replace(target::text,'-',''),upper(addr),'[{"path":"chat/document.pdf","type":"insurance"}]');
 SELECT to_jsonb(p) INTO STRICT profile_before FROM public.profiles p WHERE id=target;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  ASSERT NOT has_table_privilege(role_name,'app_private.account_erasure_inventories','SELECT'),'inventory readable';
  ASSERT NOT has_table_privilege(role_name,'app_private.account_erasure_inventories','INSERT'),'inventory writable';
  ASSERT NOT has_function_privilege(role_name,'app_private.capture_account_erasure_inventory(bigint)','execute'),'capture exposed';
 END LOOP;
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='app_private.account_erasure_inventories'::regclass),'RLS missing';
 PERFORM set_config('request.jwt.claim.sub',target::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'complete'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
 ASSERT failed,'nonstaff accepted'; EXECUTE 'RESET ROLE';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.account_erasure_inventories WHERE request_id=rid),'nonstaff created manifest';
 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 -- Actual deployed capture against actual document/agent/onboarding tables.
 PERFORM set_config('audit.inventory_fail','yes',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 failed:=false; BEGIN PERFORM public.cc_account_deletion_process(rid,'complete'); EXCEPTION WHEN SQLSTATE 'PZ005' THEN failed:=true; END;
 EXECUTE 'RESET ROLE'; ASSERT failed,'capture error swallowed';
 ASSERT (SELECT to_jsonb(p)=profile_before FROM public.profiles p WHERE id=target),'capture failure erased profile';
 ASSERT EXISTS(SELECT 1 FROM public.documents WHERE carrier_id=target),'capture failure erased metadata';
 PERFORM set_config('audit.inventory_fail','no',true);
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'code'='ERASURE_REVIEW_REQUIRED' AND result->>'ok'='false','file-bearing deletion completed';
 ASSERT (SELECT status='requested' FROM app_private.account_deletion_requests WHERE id=rid),'request falsely closed';
 ASSERT (SELECT to_jsonb(p)=profile_before FROM public.profiles p WHERE id=target),'blocked attempt erased profile';
 ASSERT EXISTS(SELECT 1 FROM public.documents WHERE carrier_id=target),'blocked attempt erased metadata';
 ASSERT NOT EXISTS(SELECT 1 FROM app_private.suppressions WHERE address=addr),'blocked attempt ran later side effects';
 ASSERT position('chat/document.pdf' in result::text)=0,'path leaked in public response';
 SELECT items INTO captures FROM app_private.account_erasure_inventories WHERE request_id=rid;
 ASSERT jsonb_array_length(captures)=5,'metadata reference count';
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(captures) e WHERE e->>'source'='documents' AND e->>'path' IS NULL),'missing-path reference ignored';
 -- Execute exact capture body with ONLY storage relation redirected to a temporary fixture.
 SELECT pg_get_functiondef('app_private.capture_account_erasure_inventory(bigint)'::regprocedure) INTO original_capture;
 EXECUTE replace(original_capture,'storage.objects','pg_temp.inventory_storage');
 INSERT INTO pg_temp.inventory_storage(id,bucket_id,name,owner_id) VALUES
 (gen_random_uuid(),'documents',target||'/w9/owned.txt',null),
 (gen_random_uuid(),'documents','legacy/owner-id.txt',target::text),
 (gen_random_uuid(),'documents','unrelated/ignore.txt',null);
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='7','storage owner/prefix fixture capture';
 SELECT items INTO captures FROM app_private.account_erasure_inventories WHERE request_id=rid;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(captures) e WHERE e->>'path'='unrelated/ignore.txt'),'unrelated storage captured';
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='7','repeat duplicated evidence';
 UPDATE public.documents SET file_path='changed/new-path.pdf' WHERE carrier_id=target;
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='8','changed metadata not retained as evidence';
 -- Remove synthetic source refs; the saved inventory must keep its earlier evidence.
 DELETE FROM public.documents WHERE carrier_id=target;
 DELETE FROM app_private.document_files WHERE uploaded_by=target;
 UPDATE app_private.agent_profiles SET payout_details='{}' WHERE user_id=target;
 UPDATE app_private.lc_onboarding SET docs='[]' WHERE lower(account_email)=addr;
 DELETE FROM pg_temp.inventory_storage;
 EXECUTE original_capture;
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'file_references'='8','disappeared references erased saved inventory';
 ASSERT result->>'code'='ERASURE_REVIEW_REQUIRED','disappeared references bypassed review';
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(rid,'reject','synthetic review rejection'); EXECUTE 'RESET ROLE';
 ASSERT result->>'status'='rejected','reject branch blocked by inventory';
 ASSERT (SELECT jsonb_array_length(items)=8 FROM app_private.account_erasure_inventories WHERE request_id=rid),'rejection lost inventory';
 -- No known file references retains the prior scoped SQL cleanup behavior (not full erasure proof).
 EXECUTE 'SET LOCAL ROLE authenticated'; result:=public.cc_account_deletion_process(empty_rid,'complete'); EXECUTE 'RESET ROLE';
 ASSERT result->>'ok'='true' AND result->>'status'='completed','empty-file control broken';
 ASSERT (SELECT items='[]'::jsonb FROM app_private.account_erasure_inventories WHERE request_id=empty_rid),'empty snapshot missing';
 ASSERT has_function_privilege('authenticated','public.cc_account_deletion_process(bigint,text,text)','execute'),'auth grant changed';
 ASSERT NOT EXISTS(
 (SELECT * FROM erasure_anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute')) UNION ALL
 (SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM erasure_anon_before)),'anon surface changed';
END $tests$;
SELECT 'PASS: private durable inventory, blocked destructive completion, failure rollback, isolated storage ownership, retained changed/disappeared references, reject and no-file controls; all fixtures rolled back' result;
ROLLBACK;

