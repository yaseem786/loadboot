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

