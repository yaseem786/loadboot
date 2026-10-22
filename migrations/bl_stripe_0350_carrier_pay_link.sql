-- bl_stripe_0350 (22 Oct 2026) — the carrier portal never showed the Stripe pay page: cc_pocket_invoices predates
-- the Stripe columns. This returns the hosted ACH/card pay link for ONE of the caller's own invoices.
-- Also: bl_stripe_0346–0349 replayed to prod today from staging's applied statements (flags OFF until keys are in).
create or replace function public.pay_fee_invoice_link(p_invoice uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public'
as $$
declare v_org uuid := app_private.my_carrier_org(); i record;
begin
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select id, status, hosted_url, stripe_status into i from app_private.fin_invoices where id = p_invoice and carrier_id = v_org;
  if i.id is null then raise exception 'invoice not found' using errcode='22023'; end if;
  return jsonb_build_object('url', case when i.status = 'sent' then i.hosted_url end, 'status', i.status, 'stripe_status', i.stripe_status);
end; $$;
revoke all on function public.pay_fee_invoice_link(uuid) from public;
revoke all on function public.pay_fee_invoice_link(uuid) from anon;
grant execute on function public.pay_fee_invoice_link(uuid) to authenticated;
notify pgrst, 'reload schema';
