-- bl_inv_0411 — bank-transfer details on every receipt: which of LoadBoot's accounts received it,
-- and the sender's bank / account title / last digits. Additive: one jsonb column + 3 functions re-declared
-- (copied from 0401/0402/0405 + the transfer field).
alter table app_private.inv_receipts add column if not exists transfer jsonb not null default '{}'::jsonb;

create or replace function app_private.inv_clean_transfer(p jsonb)
returns jsonb language sql immutable as $$
  select case when coalesce(jsonb_typeof(p),'') <> 'object' then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
    'received_into', nullif(left(btrim(p->>'received_into'),120),''),
    'sender_name',   nullif(left(btrim(p->>'sender_name'),120),''),
    'sender_bank',   nullif(left(btrim(p->>'sender_bank'),120),''),
    'sender_account',nullif(left(btrim(p->>'sender_account'),60),''),
    'country',       nullif(left(btrim(p->>'country'),60),''))) end
$$;

create or replace function public.cc_inv_confirm_receipt(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid; v_agr uuid; v_req uuid; v_amt numeric; r app_private.inv_receipts;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_id := nullif(p->>'receipt_id','')::uuid;
  if v_id is not null then
    select * into r from app_private.inv_receipts where id = v_id;
    if not found then raise exception 'receipt not found' using errcode='42704'; end if;
    if r.rejected_at is not null then raise exception 'that receipt was rejected' using errcode='22023'; end if;
    v_amt := coalesce(nullif(p->>'amount','')::numeric, r.amount);
    if r.confirmed_by_staff_at is null then perform app_private.inv_assert_cap(r.agreement_id, v_amt); end if;
    update app_private.inv_receipts
       set confirmed_by_staff_at = coalesce(confirmed_by_staff_at, now()), confirmed_by = auth.uid(),
           amount = v_amt, method = coalesce(nullif(p->>'method',''), method),
           reference = coalesce(nullif(p->>'reference',''), reference),
           proof_url = coalesce(nullif(p->>'proof_url',''), proof_url),
           transfer = coalesce(transfer, '{}'::jsonb) || app_private.inv_clean_transfer(p->'transfer')
     where id = v_id returning agreement_id, request_id into v_agr, v_req;
  else
    v_agr := (p->>'agreement_id')::uuid; v_req := nullif(p->>'request_id','')::uuid;
    v_amt := round((p->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'amount must be greater than zero' using errcode='22023'; end if;
    perform app_private.inv_assert_cap(v_agr, v_amt);
    insert into app_private.inv_receipts
      (agreement_id, request_id, amount, received_date, method, reference, proof_url, note,
       confirmed_by_staff_at, confirmed_by, created_by, transfer)
    values (v_agr, v_req, v_amt, coalesce((p->>'received_date')::date, current_date),
            nullif(p->>'method',''), nullif(p->>'reference',''), nullif(p->>'proof_url',''),
            nullif(p->>'note',''), now(), auth.uid(), auth.uid(), app_private.inv_clean_transfer(p->'transfer'))
    returning id into v_id;
  end if;
  if v_req is not null then
    update app_private.inv_requests set status = 'funded', responded_at = now() where id = v_req;
  end if;
  perform app_private.log_audit('investor.receipt_confirmed','investor', v_id::text, null, 'Capital receipt confirmed', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'position', app_private.inv_position(v_agr));
end $$;

create or replace function public.inv_declare_payment(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_req uuid; v_id uuid; v_amt numeric;
begin
  a := app_private.inv_guard((p->>'agreement_id')::uuid);
  if app_private.inv_my_investor() is distinct from a.investor_id then
    raise exception 'only the investor can declare a payment' using errcode='42501';
  end if;
  v_amt := round((p->>'amount')::numeric, 2);
  if v_amt is null or v_amt <= 0 then
    raise exception 'amount must be greater than zero' using errcode='22023'; end if;
  v_req := nullif(p->>'request_id','')::uuid;
  if v_req is not null and not exists (
       select 1 from app_private.inv_requests where id = v_req and agreement_id = a.id) then
    raise exception 'request does not belong to this agreement' using errcode='42704';
  end if;
  insert into app_private.inv_receipts
    (agreement_id, request_id, amount, received_date, method, reference, proof_url, note,
     declared_by_investor_at, created_by, transfer)
  values (a.id, v_req, v_amt, coalesce((p->>'received_date')::date, current_date),
          nullif(p->>'method',''), nullif(p->>'reference',''),
          nullif(p->>'proof_url',''), nullif(p->>'note',''), now(), auth.uid(), app_private.inv_clean_transfer(p->'transfer'))
  returning id into v_id;
  if v_req is not null then
    update app_private.inv_requests set status = 'declared', responded_at = now()
     where id = v_req and status = 'pending';
  end if;
  perform app_private.log_audit('investor.payment_declared','investor', v_id::text, null,
    'Investor declared a payment',
    jsonb_build_object('agreement', a.id, 'amount', v_amt, 'request', v_req));
  return jsonb_build_object('ok', true, 'id', v_id,
    'note', 'Recorded. It will show in your position once LoadBoot confirms receipt.');
end $$;

create or replace function public.inv_ledger(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_rcpt jsonb; v_exp jsonb; v_pay jsonb; v_cat jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'amount', r.amount, 'received_date', r.received_date, 'method', r.method,
           'reference', r.reference, 'proof_url', r.proof_url, 'note', r.note, 'transfer', r.transfer,
           'declared_at', r.declared_by_investor_at, 'confirmed_at', r.confirmed_by_staff_at,
           'rejected_reason', r.rejected_reason,
           'state', case when r.rejected_at is not null then 'rejected'
                         when r.reversal_of is not null then 'reversal'
                         when r.confirmed_by_staff_at is not null then 'confirmed'
                         else 'awaiting_confirmation' end
         ) order by r.received_date desc, r.created_at desc), '[]'::jsonb) into v_rcpt
    from app_private.inv_receipts r where r.agreement_id = a.id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'date', e.expense_date, 'category', e.category, 'amount', e.amount,
           'vendor', e.vendor, 'description', e.description, 'receipt_url', e.receipt_url,
           'recurring', e.is_recurring, 'reversed', (e.reversal_of is not null),
           'acknowledged_at', e.acknowledged_at,
           'tranche', (select x.received_date from app_private.inv_receipts x where x.id = e.receipt_id)
         ) order by e.expense_date desc, e.created_at desc), '[]'::jsonb) into v_exp
    from app_private.inv_expenses e where e.agreement_id = a.id;
  select coalesce(jsonb_object_agg(cat, amt), '{}'::jsonb) into v_cat from (
    select category as cat, sum(case when reversal_of is null then amount else -amount end) as amt
      from app_private.inv_expenses where agreement_id = a.id group by category having sum(case when reversal_of is null then amount else -amount end) > 0) z;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'kind', p.kind, 'payback', p.payback_portion, 'share', p.share_portion, 'total', p.total,
           'paid_date', p.paid_date, 'method', p.method, 'reference', p.reference, 'proof_url', p.proof_url,
           'status', p.status, 'confirmed_at', p.confirmed_by_investor_at,
           'month', (select s.period_month from app_private.inv_statements s where s.id = p.statement_id)
         ) order by p.created_at desc), '[]'::jsonb) into v_pay
    from app_private.inv_payouts p where p.agreement_id = a.id;
  return jsonb_build_object('ok', true, 'position', app_private.inv_position(a.id),
    'receipts', v_rcpt, 'expenses', v_exp, 'by_category', v_cat, 'payouts', v_pay);
end $$;
