-- bl_pay_0066 — THE MONEY LEDGER: every amount owed, both directions, with live rail status.
-- pay_due_items() returns for the calling org:
--   payables    = what YOU owe (broker: freight for delivered trips + approved claims;
--                 carrier: LoadBoot fee invoices due)
--   receivables = what YOU are owed (carrier: freight + approved claims on delivered trips)
-- Every item carries the pay_transfers state so the UI shows: DUE → sent (on the way) → ✓ received.

create or replace function public.pay_due_items()
 returns jsonb language plpgsql stable security definer
 set search_path to 'app_private, public'
as $$
declare v_carrier uuid := app_private.my_carrier_org();
        v_partner uuid := app_private.my_partner_org();
        v_pay jsonb; v_recv jsonb;
begin
  -- ---------- what the BROKER owes (freight + approved claims on their loads) ----------
  with due as (
    select 'freight'::text as kind, t.id as ref_id, t.rate as amount,
           'Freight · ' || l.origin || ' → ' || l.destination as label,
           (select name from public.organizations where id = t.carrier_id) as counterparty,
           t.delivered_at as due_since, l.broker_org as payer, t.carrier_id as payee,
           'LOAD-' || upper(left(replace(l.id::text,'-',''),8)) as memo
      from app_private.trips t join public.loads l on l.id = t.load_id
     where t.status in ('delivered','invoiced') and t.rate is not null
    union all
    select 'claim', a.id, a.amount,
           upper(a.kind) || ' claim · ' || l.origin || ' → ' || l.destination,
           (select name from public.organizations where id = t.carrier_id),
           a.broker_decided_at, l.broker_org, t.carrier_id,
           'CLM-' || upper(left(replace(a.id::text,'-',''),8))
      from app_private.trip_accessorials a
      join app_private.trips t on t.id = a.trip_id
      join public.loads l on l.id = t.load_id
     where a.broker_status = 'approved' and a.amount is not null
    union all
    select 'platform_fee', fi.id, fi.fee,
           'LoadBoot service fee · ' || coalesce(fi.invoice_no, left(fi.id::text,8)),
           'LoadBoot', fi.issued_at, fi.carrier_id, null,
           coalesce(fi.invoice_no, left(fi.id::text,8))
      from app_private.fin_invoices fi
     where fi.status = 'sent' and fi.fee is not null
  ), joined as (
    select d.*, tr.id as transfer_id, tr.status as transfer_status,
           tr.sent_at, tr.expected_by, tr.received_at, tr.payment_ref
      from due d left join app_private.pay_transfers tr on tr.kind = d.kind and tr.ref_id = d.ref_id
  )
  select
    coalesce((select jsonb_agg(to_jsonb(j) - 'payer' - 'payee' order by j.due_since desc nulls last)
       from joined j
      where (v_partner is not null and j.payer = v_partner)
         or (v_carrier is not null and j.kind = 'platform_fee' and j.payer = v_carrier)), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(j) - 'payer' - 'payee'
            || jsonb_build_object('counterparty', (select name from public.organizations where id = j.payer))
            order by j.due_since desc nulls last)
       from joined j
      where v_carrier is not null and j.payee = v_carrier), '[]'::jsonb)
    into v_pay, v_recv;
  return jsonb_build_object('payables', v_pay, 'receivables', v_recv);
end; $$;
revoke all on function public.pay_due_items() from public;
grant execute on function public.pay_due_items() to authenticated;

notify pgrst, 'reload schema';
