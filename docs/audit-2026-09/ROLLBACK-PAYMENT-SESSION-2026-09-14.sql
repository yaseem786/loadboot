-- STAGING rollback package. Production use requires separate authorization.
DO $rollback$
DECLARE old_acl text;
BEGIN
 IF md5(pg_get_functiondef('app_private.assert_payment_session()'::regprocedure)) IS DISTINCT FROM '18344c1e6ac6a2b76e2dae5ee7659334' THEN RAISE EXCEPTION 'Rollback source drift: app_private.assert_payment_session()'; END IF;
 IF md5(pg_get_functiondef('public.cc_my_payment_profile()'::regprocedure)) IS DISTINCT FROM '710d7ce85c0277eef6c14572801a6b70' THEN RAISE EXCEPTION 'Rollback source drift: public.cc_my_payment_profile()'; END IF;
 IF md5(pg_get_functiondef('public.cc_set_my_payment_profile(jsonb)'::regprocedure)) IS DISTINCT FROM '6855c85926b517ec183a148223bef411' THEN RAISE EXCEPTION 'Rollback source drift: public.cc_set_my_payment_profile(jsonb)'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.prokind='f'
  AND p.oid NOT IN ('app_private.assert_payment_session()'::regprocedure,'public.cc_my_payment_profile()'::regprocedure,'public.cc_set_my_payment_profile(jsonb)'::regprocedure)
  AND position('assert_payment_session' in pg_get_functiondef(p.oid))>0)
 THEN RAISE EXCEPTION 'Session helper has additional consumers; preserve it and review rollback'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_my_payment_profile()'::regprocedure;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_my_payment_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_org uuid; r app_private.org_payment_profiles;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then v_org := app_private.my_partner_org('broker'); end if;
  if v_org is null then raise exception 'carrier or broker account required' using errcode='42501'; end if;
  select * into r from app_private.org_payment_profiles where org_id = v_org;
  if r.org_id is null then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'bank_name', r.bank_name, 'account_title', r.account_title,
    'account_last4', right(r.account_number,4), 'routing_last4', right(r.routing_number,4),
    'account_type', r.account_type, 'payment_method', r.payment_method, 'bank_address', r.bank_address,
    'remittance_email', r.remittance_email, 'factoring_company', r.factoring_company, 'factoring_noa', r.factoring_noa,
    'noa_status', coalesce(r.noa_status,'none'),
    'factor_remit', jsonb_build_object('account_title', r.factor_details->>'account_title', 'bank_name', r.factor_details->>'bank_name',
      'account_last4', right(r.factor_details->>'account_number',4), 'routing_last4', right(r.factor_details->>'routing_number',4),
      'remittance_email', r.factor_details->>'remittance_email', 'remit_to', r.factor_details->>'remit_to',
      'has_ach', coalesce(r.factor_details->>'account_number','') <> '' and coalesce(r.factor_details->>'routing_number','') <> '',
      'remit_verified', case when r.factor_details ? 'remit_verified' then (r.factor_details->>'remit_verified')::boolean else null end),
    'fee_collection', r.fee_collection, 'ach_debit_consent', r.ach_debit_consent, 'ach_debit_consent_at', r.ach_debit_consent_at,
    'verified', r.verified, 'updated_at', r.updated_at);
end $function$
$source$;
 IF md5(pg_get_functiondef('public.cc_my_payment_profile()'::regprocedure)) IS DISTINCT FROM 'e94a8f8b04878514d5d3fdc1f9da2c0a' OR (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_my_payment_profile()'::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'Rollback did not restore public.cc_my_payment_profile()'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_set_my_payment_profile(jsonb)'::regprocedure;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_set_my_payment_profile(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_org uuid; v_fee text; v_consent boolean;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then v_org := app_private.my_partner_org('broker'); end if;
  if v_org is null then raise exception 'carrier or broker account required' using errcode='42501'; end if;
  if coalesce(trim(p->>'bank_name'),'')='' or coalesce(trim(p->>'account_title'),'')=''
     or coalesce(trim(p->>'account_number'),'')='' or coalesce(trim(p->>'routing_number'),'')='' then
    raise exception 'Bank name, account title, account number and routing number are all required.' using errcode='22023';
  end if;
  perform app_private.assert_bank_numbers(p->>'account_number', p->>'routing_number');
  v_fee := nullif(trim(p->>'fee_collection'),'');
  if v_fee is not null and v_fee not in ('settlement_deduction','ach_autodebit') then
    raise exception 'fee_collection must be settlement_deduction or ach_autodebit' using errcode='22023';
  end if;
  v_consent := coalesce((p->>'ach_debit_consent')::boolean, false);
  if v_fee = 'ach_autodebit' and not v_consent then
    raise exception 'ACH auto-debit consent is required to collect dispatch fees by bank debit.' using errcode='22023';
  end if;
  insert into app_private.org_payment_profiles(org_id, bank_name, account_title, account_number, routing_number,
      account_type, payment_method, bank_address, swift_bic, beneficiary_address, remittance_email, bank_phone,
      tax_id, factoring_company, factoring_noa, fee_collection, ach_debit_consent, ach_debit_consent_at, updated_by)
    values (v_org, trim(p->>'bank_name'), trim(p->>'account_title'), trim(p->>'account_number'), trim(p->>'routing_number'),
      coalesce(nullif(trim(p->>'account_type'),''),'checking'), nullif(trim(p->>'payment_method'),''), nullif(trim(p->>'bank_address'),''), nullif(trim(p->>'swift_bic'),''),
      nullif(trim(p->>'beneficiary_address'),''), nullif(trim(p->>'remittance_email'),''), nullif(trim(p->>'bank_phone'),''),
      nullif(trim(p->>'tax_id'),''), nullif(trim(p->>'factoring_company'),''), coalesce((p->>'factoring_noa')::boolean,false),
      v_fee, v_consent, case when v_consent then now() else null end, auth.uid())
  on conflict (org_id) do update set bank_name=excluded.bank_name, account_title=excluded.account_title,
    account_number=excluded.account_number, routing_number=excluded.routing_number, account_type=excluded.account_type,
    payment_method=excluded.payment_method, bank_address=excluded.bank_address, swift_bic=excluded.swift_bic,
    beneficiary_address=excluded.beneficiary_address, remittance_email=excluded.remittance_email, bank_phone=excluded.bank_phone,
    tax_id=excluded.tax_id, factoring_company=excluded.factoring_company, factoring_noa=excluded.factoring_noa,
    fee_collection=coalesce(excluded.fee_collection, app_private.org_payment_profiles.fee_collection),
    ach_debit_consent=excluded.ach_debit_consent,
    ach_debit_consent_at=case when excluded.ach_debit_consent then coalesce(app_private.org_payment_profiles.ach_debit_consent_at, now()) else null end,
    verified=false, verified_by=null, verified_at=null, updated_by=auth.uid(), updated_at=now();
  perform app_private.log_audit('payments.profile_set','org',v_org::text,null,'bank profile set/updated (verification reset)',
    jsonb_build_object('fee_collection', v_fee, 'ach_debit_consent', v_consent));
  return jsonb_build_object('ok',true,'verified',false,'note','a person verifies bank details before any payout references them');
end; $function$
$source$;
 IF md5(pg_get_functiondef('public.cc_set_my_payment_profile(jsonb)'::regprocedure)) IS DISTINCT FROM '75d78f9fb61762ddfe9458c634f18a1d' OR (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_set_my_payment_profile(jsonb)'::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'Rollback did not restore public.cc_set_my_payment_profile(jsonb)'; END IF;
 DROP FUNCTION app_private.assert_payment_session();
END $rollback$;

