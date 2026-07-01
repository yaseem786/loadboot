-- cwe_finance_lifecycle.sql
-- Increment 56 — FINANCE LIFECYCLE: receivables, payables, invoice-prep queue and reconciliation.
-- The maker/checker core already exists and stays untouched (cc_decide_settlement: row lock, stale-version
-- rejection, creator-cannot-approve, monetary limits, idempotent terminal decisions). This increment adds the
-- read/ops layer around it — all deterministic sums over real rows; no projections, no invented figures.
--
--   * cc_finance_receivables — who owes LoadBoot: outstanding partner invoices + carrier fee invoices,
--     aged into current / 1-30 / 31-60 / 61-90 / 90+ buckets by due date.
--   * cc_finance_payables — what LoadBoot owes carriers: pending + approved-not-paid settlements, aged.
--   * cc_invoice_prep_queue — delivered trips with NO invoice yet, with the trip's POD review status,
--     oldest first (the "delivered → POD approved → invoice prepared" pipeline surface).
--   * cc_finance_reconcile — cross-checks invoices vs settlements over a window and lists every mismatch
--     (paid invoice on unpaid settlement, paid settlement carrying unpaid invoices, settlement gross that
--     does not equal the sum of its linked invoices).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_finance_receivables()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_partner jsonb; v_carrier jsonb; v_items jsonb;
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  -- partner invoices outstanding (broker-side receivable)
  select jsonb_build_object(
      'outstanding', coalesce(sum(amount),0), 'count', count(*),
      'current', coalesce(sum(amount) filter (where due_date is null or due_date >= current_date),0),
      'd1_30',  coalesce(sum(amount) filter (where due_date < current_date and due_date >= current_date-30),0),
      'd31_60', coalesce(sum(amount) filter (where due_date < current_date-30 and due_date >= current_date-60),0),
      'd61_90', coalesce(sum(amount) filter (where due_date < current_date-60 and due_date >= current_date-90),0),
      'd90_plus', coalesce(sum(amount) filter (where due_date < current_date-90),0))
    into v_partner
    from app_private.partner_invoices where status in ('sent','payment_submitted');
  -- carrier dispatch-fee invoices outstanding
  select jsonb_build_object(
      'outstanding', coalesce(sum(fee),0), 'count', count(*),
      'current', coalesce(sum(fee) filter (where due_at is null or due_at >= current_date),0),
      'd1_30',  coalesce(sum(fee) filter (where due_at < current_date and due_at >= current_date-30),0),
      'd31_60', coalesce(sum(fee) filter (where due_at < current_date-30 and due_at >= current_date-60),0),
      'd61_90', coalesce(sum(fee) filter (where due_at < current_date-60 and due_at >= current_date-90),0),
      'd90_plus', coalesce(sum(fee) filter (where due_at < current_date-90),0))
    into v_carrier
    from app_private.fin_invoices where status='sent';
  select coalesce(jsonb_agg(x order by (x->>'overdue_days')::int desc), '[]'::jsonb) into v_items from (
    select jsonb_build_object('kind','partner_invoice','id',pi.id,'ref',pi.number,'who',o.name,
        'amount',pi.amount,'due',pi.due_date,'status',pi.status,
        'overdue_days', greatest(coalesce(current_date - pi.due_date,0),0)) as x
      from app_private.partner_invoices pi left join public.organizations o on o.id=pi.partner_org
      where pi.status in ('sent','payment_submitted')
    union all
    select jsonb_build_object('kind','carrier_fee_invoice','id',fi.id,'ref',fi.invoice_no,'who',oc.name,
        'amount',fi.fee,'due',fi.due_at,'status',fi.status,
        'overdue_days', greatest(coalesce(current_date - fi.due_at,0),0))
      from app_private.fin_invoices fi left join public.organizations oc on oc.id=fi.carrier_id
      where fi.status='sent'
    limit 100) q;
  return jsonb_build_object('as_of', current_date,
    'partner_invoices', v_partner, 'carrier_fee_invoices', v_carrier,
    'total_outstanding', (v_partner->>'outstanding')::numeric + (v_carrier->>'outstanding')::numeric,
    'items', v_items,
    'basis', 'issued invoice amounts and due dates — deterministic sums, no projections');
end; $$;
revoke execute on function public.cc_finance_receivables() from anon, public;
grant  execute on function public.cc_finance_receivables() to authenticated;

create or replace function public.cc_finance_payables()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_sum jsonb; v_items jsonb;
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_build_object(
      'pending_net', coalesce(sum(net) filter (where status='pending'),0),
      'pending_count', count(*) filter (where status='pending'),
      'approved_unpaid_net', coalesce(sum(net) filter (where status='approved'),0),
      'approved_unpaid_count', count(*) filter (where status='approved'))
    into v_sum from app_private.fin_settlements where status in ('pending','approved');
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'ref',s.settlement_no,'carrier',o.name,
      'net',s.net,'status',s.status,'age_days', (current_date - s.created_at::date),
      'version',s.version,'approved_by_set', s.approved_by is not null)
      order by s.created_at), '[]'::jsonb)
    into v_items
    from app_private.fin_settlements s left join public.organizations o on o.id=s.carrier_id
    where s.status in ('pending','approved') limit 100;
  return jsonb_build_object('as_of', current_date, 'summary', v_sum, 'items', v_items,
    'note', 'payment itself always goes through cc_decide_settlement maker/checker — nothing is paid from this view');
end; $$;
revoke execute on function public.cc_finance_payables() from anon, public;
grant  execute on function public.cc_finance_payables() to authenticated;

create or replace function public.cc_invoice_prep_queue(p_limit integer default 50)
returns table(trip_id uuid, carrier text, lane text, rate numeric, delivered_at timestamptz,
  days_since_delivery integer, pod_status text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select t.id, o.name, coalesce(l.origin,'?')||' → '||coalesce(l.destination,'?'), t.rate, t.delivered_at,
      (current_date - t.delivered_at::date)::int,
      coalesce((select df.status from app_private.document_files df
                 where df.owner_type='trip' and df.owner_id=t.id::text and df.kind='pod'
                 order by df.created_at desc limit 1), 'no POD uploaded')
    from app_private.trips t
    left join public.loads l on l.id=t.load_id
    left join public.organizations o on o.id=t.carrier_id
    where t.status='delivered'
      and not exists (select 1 from app_private.fin_invoices fi where fi.trip_id=t.id and fi.status<>'void')
    order by t.delivered_at asc
    limit least(greatest(coalesce(p_limit,50),1),200);
end; $$;
revoke execute on function public.cc_invoice_prep_queue(integer) from anon, public;
grant  execute on function public.cc_invoice_prep_queue(integer) to authenticated;

create or replace function public.cc_finance_reconcile(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_from date; v_to date; v_inv jsonb; v_set jsonb; v_mis jsonb;
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  v_from := coalesce(p_from, (current_date - 90)); v_to := coalesce(p_to, current_date);
  select jsonb_build_object('issued_count',count(*),'issued_fee',coalesce(sum(fee),0),
      'paid_count',count(*) filter (where status='paid'),'paid_fee',coalesce(sum(fee) filter (where status='paid'),0),
      'void_count',count(*) filter (where status='void'))
    into v_inv from app_private.fin_invoices where created_at::date between v_from and v_to;
  select jsonb_build_object('created_count',count(*),'created_net',coalesce(sum(net),0),
      'approved_count',count(*) filter (where status in ('approved','paid')),
      'paid_count',count(*) filter (where status='paid'),'paid_net',coalesce(sum(net) filter (where status='paid'),0))
    into v_set from app_private.fin_settlements where created_at::date between v_from and v_to;
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_mis from (
    -- paid invoice linked to a settlement that is not paid
    select jsonb_build_object('type','paid_invoice_on_unpaid_settlement','invoice',fi.invoice_no,'settlement',s.settlement_no,
        'detail','invoice marked paid but its settlement is '||s.status) m
      from app_private.fin_invoices fi join app_private.fin_settlements s on s.id=fi.settlement_id
      where fi.status='paid' and s.status<>'paid'
    union all
    -- paid settlement still carrying unpaid linked invoices
    select jsonb_build_object('type','unpaid_invoice_on_paid_settlement','invoice',fi.invoice_no,'settlement',s.settlement_no,
        'detail','settlement paid but linked invoice is '||fi.status)
      from app_private.fin_invoices fi join app_private.fin_settlements s on s.id=fi.settlement_id
      where s.status='paid' and fi.status not in ('paid','void')
    union all
    -- settlement totals that do not equal the sum of linked invoices
    select jsonb_build_object('type','settlement_total_mismatch','settlement',s.settlement_no,
        'detail','settlement gross '||s.gross||' != linked invoice gross '||coalesce(x.sum_gross,0))
      from app_private.fin_settlements s
      left join (select settlement_id, sum(gross) sum_gross from app_private.fin_invoices where status<>'void' group by 1) x
        on x.settlement_id=s.id
      where s.status<>'void' and s.gross is distinct from coalesce(x.sum_gross, s.gross)
  ) q(m);
  return jsonb_build_object('from', v_from, 'to', v_to,
    'invoices', v_inv, 'settlements', v_set,
    'mismatches', v_mis, 'mismatch_count', jsonb_array_length(v_mis),
    'basis', 'deterministic cross-check of fin_invoices vs fin_settlements rows — every mismatch listed individually');
end; $$;
revoke execute on function public.cc_finance_reconcile(date, date) from anon, public;
grant  execute on function public.cc_finance_reconcile(date, date) to authenticated;
