-- Guarded staging rollback. Refuse to discard any captured inventory.
DO $rollback$
BEGIN
 IF md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure)) IS DISTINCT FROM '3fe3cbac599f19e28d6f4a41109e82ad'
 OR md5(pg_get_functiondef('app_private.capture_account_erasure_inventory(bigint)'::regprocedure)) IS DISTINCT FROM 'd6fd7d1c2e24a3a9d81ff763f49e089f' THEN
  RAISE EXCEPTION 'Erasure code drift; re-sync'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.account_erasure_inventories) THEN RAISE EXCEPTION 'Inventory evidence exists; preserve it and design data-safe rollback'; END IF;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_account_deletion_process(p_id bigint, p_action text, p_note text DEFAULT NULL::text)
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
 DROP FUNCTION app_private.capture_account_erasure_inventory(bigint);
 DROP TABLE app_private.account_erasure_inventories;
END $rollback$;
