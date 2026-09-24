-- bl_inv_0412 — bank-app style timestamps. Every money line can carry the exact moment it happened
-- (txn_at = the time on the bank slip); the ledger also returns when it was logged (logged_at = created_at).
-- Additive: 3 nullable columns, 1 staff RPC, inv_ledger re-declared from 0411 + 2 fields per line.
alter table app_private.inv_receipts add column if not exists txn_at timestamptz;
alter table app_private.inv_expenses add column if not exists txn_at timestamptz;
alter table app_private.inv_payouts  add column if not exists txn_at timestamptz;

-- Staff sets / clears the slip time. It must fall on the record's own date in Pakistan time,
-- so a time can never quietly move a transaction to another day.
create or replace function public.cc_inv_set_txn_time(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_kind text := p->>'kind'; v_id uuid := (p->>'id')::uuid; v_at timestamptz := nullif(p->>'at','')::timestamptz;
        v_day date; v_agr uuid;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if v_kind = 'receipt' then select received_date, agreement_id into v_day, v_agr from app_private.inv_receipts where id = v_id;
  elsif v_kind = 'expense' then select expense_date, agreement_id into v_day, v_agr from app_private.inv_expenses where id = v_id;
  elsif v_kind = 'payout' then select paid_date, agreement_id into v_day, v_agr from app_private.inv_payouts where id = v_id;
  else raise exception 'kind must be receipt, expense or payout' using errcode='22023'; end if;
  if v_agr is null then raise exception 'record not found' using errcode='42704'; end if;
  if v_at is not null and v_day is not null and (v_at at time zone 'Asia/Karachi')::date <> v_day then
    raise exception 'the time must be on the record''s own date (%) in Pakistan time', v_day using errcode='22023';
  end if;
  if v_kind = 'receipt' then update app_private.inv_receipts set txn_at = v_at where id = v_id;
  elsif v_kind = 'expense' then update app_private.inv_expenses set txn_at = v_at where id = v_id;
  else update app_private.inv_payouts set txn_at = v_at where id = v_id; end if;
  perform app_private.log_audit('investor.txn_time_set','investor', v_id::text, null, 'Transaction time set', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'txn_at', v_at);
end $$;
revoke all on function public.cc_inv_set_txn_time(jsonb) from public;
grant execute on function public.cc_inv_set_txn_time(jsonb) to authenticated;

create or replace function public.inv_ledger(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_rcpt jsonb; v_exp jsonb; v_pay jsonb; v_cat jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'amount', r.amount, 'received_date', r.received_date, 'method', r.method,
           'reference', r.reference, 'proof_url', r.proof_url, 'note', r.note, 'transfer', r.transfer, 'txn_at', r.txn_at, 'logged_at', r.created_at,
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
           'acknowledged_at', e.acknowledged_at, 'txn_at', e.txn_at, 'logged_at', e.created_at,
           'tranche', (select x.received_date from app_private.inv_receipts x where x.id = e.receipt_id)
         ) order by e.expense_date desc, e.created_at desc), '[]'::jsonb) into v_exp
    from app_private.inv_expenses e where e.agreement_id = a.id;
  select coalesce(jsonb_object_agg(cat, amt), '{}'::jsonb) into v_cat from (
    select category as cat, sum(case when reversal_of is null then amount else -amount end) as amt
      from app_private.inv_expenses where agreement_id = a.id group by category having sum(case when reversal_of is null then amount else -amount end) > 0) z;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'kind', p.kind, 'payback', p.payback_portion, 'share', p.share_portion, 'total', p.total,
           'paid_date', p.paid_date, 'method', p.method, 'reference', p.reference, 'proof_url', p.proof_url,
           'status', p.status, 'confirmed_at', p.confirmed_by_investor_at, 'txn_at', p.txn_at, 'logged_at', p.created_at,
           'month', (select s.period_month from app_private.inv_statements s where s.id = p.statement_id)
         ) order by p.created_at desc), '[]'::jsonb) into v_pay
    from app_private.inv_payouts p where p.agreement_id = a.id;
  return jsonb_build_object('ok', true, 'position', app_private.inv_position(a.id),
    'receipts', v_rcpt, 'expenses', v_exp, 'by_category', v_cat, 'payouts', v_pay);
end $$;
