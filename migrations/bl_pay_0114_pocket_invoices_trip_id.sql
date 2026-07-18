-- bl_pay_0114: cc_pocket_invoices must return trip_id so the carrier portal can
-- render the "📦 Factoring packet" button on fee-invoice rows (app.js reads i.trip_id;
-- the RPC never returned it, so the button never appeared). Additive: appends a column.
-- NOTE: fin_invoices.due_at is DATE (not timestamptz) — return type must match.
drop function if exists public.cc_pocket_invoices(int);
create or replace function public.cc_pocket_invoices(p_limit int default 50)
 returns table(id uuid, invoice_no text, gross numeric, fee numeric, net numeric,
               status text, due_at date, trip_id uuid)
 language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_org uuid; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query select i.id,i.invoice_no,i.gross,i.fee,i.net,i.status,i.due_at,i.trip_id
    from app_private.fin_invoices i where i.carrier_id=v_org order by i.created_at desc limit v_limit;
end; $$;
revoke all on function public.cc_pocket_invoices(int) from public;
grant execute on function public.cc_pocket_invoices(int) to authenticated;
