-- bl_fin_0299 — carrier can COMPLETE / UPDATE the factor's remit-to details after the NOA is verified.
-- Found 29 Aug on prod: Warren's Courier is factored (Flat Rate Funding, NOA verified 22 Aug) but the NOA
-- letter only carried a P.O. Box, so factor_details has no bank/ACH fields — CC 360 shows no "NOA account
-- details" and settlements cannot be paid by ACH. The carrier could not fix it himself: the Finance card
-- hides the factoring form once factoring is on, and carrier_factoring_set('activate') would have (a) wiped
-- the staff's verification notes in factor_details and (b) reset noa_status to 'pending' + re-notified
-- every broker. This RPC MERGES only the remit fields, keeps the NOA verified, flags the new bank details
-- for staff (remit_verified=false) and notifies staff once. Additive. Staging first, then prod.
create or replace function public.carrier_factoring_remit_update(p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; r app_private.org_payment_profiles; v_new jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'carrier account required' using errcode='42501'; end if;
  select * into r from app_private.org_payment_profiles where org_id = v_org;
  if r.org_id is null or not coalesce(r.factoring_noa, false) then
    raise exception 'factoring is not active on this account — activate factoring first' using errcode='22023';
  end if;
  if coalesce(p->>'account_title','') = '' or coalesce(p->>'bank_name','') = '' then
    raise exception 'the factor''s payee name and bank are required' using errcode='22023';
  end if;
  if coalesce(p->>'account_number','') = '' or coalesce(p->>'routing_number','') = '' then
    raise exception 'the factor''s full account number and 9-digit routing number are required for ACH' using errcode='22023';
  end if;
  perform app_private.assert_bank_numbers(p->>'account_number', p->>'routing_number');
  v_new := jsonb_strip_nulls(jsonb_build_object(
    'account_title', nullif(trim(p->>'account_title'),''), 'bank_name', nullif(trim(p->>'bank_name'),''),
    'account_number', regexp_replace(p->>'account_number', '\D', '', 'g'), 'routing_number', regexp_replace(p->>'routing_number', '\D', '', 'g'),
    'remittance_email', nullif(lower(trim(p->>'remittance_email')),''), 'payment_method', coalesce(nullif(upper(trim(p->>'payment_method')),''), 'ACH'),
    'remit_source', 'carrier portal — ' || coalesce(nullif(trim(p->>'source'),''), 'entered by the carrier'),
    'remit_updated_at', now(), 'remit_updated_by', auth.uid(), 'remit_verified', false));
  update app_private.org_payment_profiles
     set factor_details = coalesce(factor_details, '{}'::jsonb) || v_new,
         remittance_email = coalesce(nullif(lower(trim(p->>'remittance_email')),''), remittance_email),
         updated_by = auth.uid(), updated_at = now()
   where org_id = v_org;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
    values ('staff','in_app','factoring.remit_updated', jsonb_build_object('title','🏦 Factor remit-to details added — verify',
      'body',(select name from public.organizations where id=v_org) || ' entered ' || coalesce(r.factoring_company,'their factor') || '''s bank details (' || (p->>'bank_name') || ' ····' || right(regexp_replace(p->>'account_number','\D','','g'),4) || '). Confirm them with the factor before the first settlement.','org',v_org));
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'remit_verified', false, 'account_last4', right(regexp_replace(p->>'account_number','\D','','g'),4));
end $$;
revoke all on function public.carrier_factoring_remit_update(jsonb) from public, anon;
grant execute on function public.carrier_factoring_remit_update(jsonb) to authenticated;

-- the card needs to know whether the remit details exist and whether staff verified them
create or replace function public.cc_my_payment_profile()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
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
end $$;
