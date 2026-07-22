-- bl_cc_0137 — surface factor remit-to details + NOA status in the CC carrier payment panel.
-- The factoring remit-to lives in org_payment_profiles.factor_details (JSON), NOA in noa_status/
-- noa_doc, but cc_carrier_payment_profile only returned legacy factoring_company/factoring_noa
-- (often empty) so CC 360 showed no factoring. Additive: append factor_details, noa_status,
-- noa_doc, direct_brokers to the return. Applied to STAGING. PROD after owner confirmation.
create or replace function public.cc_carrier_payment_profile(p_org uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $function$
declare r app_private.org_payment_profiles;
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from app_private.org_payment_profiles where org_id = p_org;
  if r.org_id is null then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'bank_name', r.bank_name, 'account_title', r.account_title,
    'account_number', r.account_number, 'routing_number', r.routing_number, 'account_type', r.account_type,
    'payment_method', r.payment_method, 'bank_address', r.bank_address, 'swift_bic', r.swift_bic,
    'beneficiary_address', r.beneficiary_address, 'remittance_email', r.remittance_email, 'bank_phone', r.bank_phone,
    'tax_id', r.tax_id, 'factoring_company', r.factoring_company, 'factoring_noa', r.factoring_noa,
    'factor_details', r.factor_details, 'noa_status', r.noa_status, 'noa_doc', r.noa_doc,
    'direct_brokers', r.direct_brokers,
    'verified', r.verified, 'verified_at', r.verified_at, 'updated_at', r.updated_at);
end; $function$;
