-- bl_inv_0413 — add a receipt to an expense that was logged without one (e.g. a screenshot found later).
-- Staff only; allowed only while the expense has no receipt (an existing receipt can never be swapped); audited.
create or replace function public.cc_inv_expense_attach(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid := (p->>'id')::uuid; v_url text := nullif(btrim(p->>'receipt_url'),''); v_old text;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if v_url is null then raise exception 'receipt is required' using errcode='22023'; end if;
  select receipt_url into v_old from app_private.inv_expenses where id = v_id;
  if not found then raise exception 'expense not found' using errcode='42704'; end if;
  if v_old is not null then raise exception 'this expense already has a receipt; it cannot be replaced' using errcode='22023'; end if;
  update app_private.inv_expenses set receipt_url = v_url where id = v_id;
  perform app_private.log_audit('investor.expense_receipt_added','investor', v_id::text, null, 'Receipt added to a logged expense', p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.cc_inv_expense_attach(jsonb) from public;
grant execute on function public.cc_inv_expense_attach(jsonb) to authenticated;
