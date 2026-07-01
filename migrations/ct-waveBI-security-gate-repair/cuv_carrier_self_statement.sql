-- cuv_carrier_self_statement.sql
-- Carrier-facing account statement for the caller's OWN org (my_carrier_org()): invoice totals, fees
-- outstanding/paid, adjustments, open disputes and settlements. Powers "Download statement" in the
-- Carrier Portal Finance tab. (The staff equivalent cc_carrier_statement(p_carrier) is finance.view-gated.)
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_statement()
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return jsonb_build_object(
    'carrier',(select name from public.organizations where id=v_org),
    'invoices_total',(select count(*) from app_private.fin_invoices where carrier_id=v_org),
    'fees_outstanding',(select coalesce(sum(fee),0) from app_private.fin_invoices where carrier_id=v_org and status='sent'),
    'fees_paid',(select coalesce(sum(fee),0) from app_private.fin_invoices where carrier_id=v_org and status='paid'),
    'adjustments',(select coalesce(sum(amount),0) from app_private.fin_adjustments a join app_private.fin_invoices i on i.id=a.invoice_id where i.carrier_id=v_org),
    'open_disputes',(select count(*) from app_private.fin_disputes d join app_private.fin_invoices i on i.id=d.invoice_id where i.carrier_id=v_org and d.status='open'),
    'settlements',(select coalesce(jsonb_agg(jsonb_build_object('no',settlement_no,'net',net,'status',status) order by created_at desc),'[]'::jsonb) from app_private.fin_settlements where carrier_id=v_org));
end; $$;
revoke execute on function public.cc_pocket_statement() from anon, public;
grant  execute on function public.cc_pocket_statement() to authenticated;
