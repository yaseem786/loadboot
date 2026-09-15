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
