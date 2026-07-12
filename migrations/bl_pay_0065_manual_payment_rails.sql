-- bl_pay_0065 — MANUAL PAYMENT RAILS (Phase 0 of the payment engine).
-- One table runs three money flows, each with the same premium loop:
--   broker/carrier sees HOW-TO-PAY (payee bank details + guidelines) → pays outside →
--   uploads receipt/screenshot → payee sees "payment on the way (ETA)" → payee taps
--   "✓ Received" → both sides see confirmed. Nobody's money ever touches LoadBoot.
-- kinds: 'claim' (broker→carrier, ref=trip_accessorials.id, needs broker_status=approved)
--        'freight' (broker→carrier, ref=trips.id, amount=rate)
--        'platform_fee' (carrier→LoadBoot, ref=fin_invoices.id, LoadBoot confirms in CC)

create table if not exists app_private.pay_transfers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('claim','freight','platform_fee')),
  ref_id uuid not null,
  payer_org uuid references public.organizations(id),
  payee_org uuid references public.organizations(id),   -- null = LoadBoot platform
  amount numeric not null check (amount >= 0),
  status text not null default 'sent' check (status in ('sent','received','disputed')),
  method text,
  receipt_path text,
  receipt_name text,
  payment_ref text,
  note text,
  sent_at timestamptz not null default now(),
  expected_by date,
  received_at timestamptz,
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, ref_id)
);

-- ---------- HOW TO PAY: payee details + guidelines + current state ----------
create or replace function public.pay_instructions(p_kind text, p_ref uuid)
 returns jsonb language plpgsql stable security definer
 set search_path to 'app_private, public'
as $$
declare v_amount numeric; v_payee uuid; v_payer uuid; v_label text; v_bank jsonb; v_tr record;
        a record; t record; l record; fi record; prof record; cfg text; v_ok boolean := false;
begin
  if p_kind = 'claim' then
    select * into a from app_private.trip_accessorials where id = p_ref;
    if a is null then raise exception 'claim not found' using errcode='22023'; end if;
    select * into t from app_private.trips where id = a.trip_id;
    select * into l from public.loads where id = t.load_id;
    if a.broker_status is distinct from 'approved' then raise exception 'approve the claim first' using errcode='22023'; end if;
    v_amount := a.amount; v_payee := t.carrier_id; v_payer := l.broker_org;
    v_label := upper(a.kind) || ' claim · ' || l.origin || ' → ' || l.destination;
  elsif p_kind = 'freight' then
    select * into t from app_private.trips where id = p_ref;
    if t is null then raise exception 'trip not found' using errcode='22023'; end if;
    select * into l from public.loads where id = t.load_id;
    v_amount := t.rate; v_payee := t.carrier_id; v_payer := l.broker_org;
    v_label := 'Freight · ' || l.origin || ' → ' || l.destination;
  elsif p_kind = 'platform_fee' then
    select * into fi from app_private.fin_invoices where id = p_ref;
    if fi is null then raise exception 'invoice not found' using errcode='22023'; end if;
    v_amount := fi.fee; v_payee := null; v_payer := fi.carrier_id;
    v_label := 'LoadBoot service fee · invoice ' || coalesce(fi.invoice_no, left(fi.id::text, 8));
  else
    raise exception 'unknown kind' using errcode='22023';
  end if;

  if public.has_global_permission('dispatch.manage') then v_ok := true;
  elsif v_payer is not null and (app_private.my_partner_org() = v_payer or app_private.my_carrier_org() = v_payer) then v_ok := true;
  elsif v_payee is not null and app_private.my_carrier_org() = v_payee then v_ok := true;
  end if;
  if not v_ok then raise exception 'not authorized' using errcode='42501'; end if;

  if v_payee is not null then
    select * into prof from app_private.org_payment_profiles where org_id = v_payee;
    v_bank := case when prof is null then null else jsonb_build_object(
      'bank_name', prof.bank_name, 'account_title', prof.account_title,
      'account_number', prof.account_number, 'routing_number', prof.routing_number,
      'account_type', prof.account_type, 'payment_method', prof.payment_method,
      'swift_bic', prof.swift_bic, 'remittance_email', prof.remittance_email,
      'factoring_company', prof.factoring_company, 'factoring_noa', prof.factoring_noa,
      'verified', prof.verified) end;
  else
    select instructions into cfg from app_private.payment_config limit 1;
    v_bank := jsonb_build_object('instructions', cfg);
  end if;

  select * into v_tr from app_private.pay_transfers where kind = p_kind and ref_id = p_ref;
  return jsonb_build_object(
    'label', v_label, 'amount', v_amount,
    'payee_bank', v_bank,
    'payee_is_platform', v_payee is null,
    'noa_warning', case when v_payee is not null and prof.factoring_noa then 'This carrier factors their invoices — pay the FACTORING COMPANY per the NOA, not the carrier directly.' end,
    'guidelines', 'Pay by ACH or wire from your business bank. Put the reference shown here in the transfer memo. ACH typically lands in 1–3 business days. After sending, upload the payment receipt/screenshot below — the payee is notified and confirms receipt.',
    'transfer', case when v_tr is null then null else jsonb_build_object(
      'id', v_tr.id, 'status', v_tr.status, 'sent_at', v_tr.sent_at, 'expected_by', v_tr.expected_by,
      'received_at', v_tr.received_at, 'payment_ref', v_tr.payment_ref, 'method', v_tr.method,
      'receipt_path', v_tr.receipt_path, 'receipt_name', v_tr.receipt_name) end);
end; $$;
revoke all on function public.pay_instructions(text, uuid) from public;
grant execute on function public.pay_instructions(text, uuid) to authenticated;

-- ---------- I HAVE PAID: attach receipt, start the ETA clock ----------
create or replace function public.pay_mark_sent(p_kind text, p_ref uuid, p_receipt_path text, p_receipt_name text, p_payment_ref text, p_method text)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_amount numeric; v_payee uuid; v_payer uuid; a record; t record; l record; fi record; v_id uuid;
begin
  if p_receipt_path is null or length(trim(p_receipt_path)) = 0 then
    raise exception 'attach the payment receipt/screenshot first' using errcode='22023';
  end if;
  if p_kind = 'claim' then
    select * into a from app_private.trip_accessorials where id = p_ref;
    if a is null or a.broker_status is distinct from 'approved' then raise exception 'claim must be approved first' using errcode='22023'; end if;
    select * into t from app_private.trips where id = a.trip_id;
    select * into l from public.loads where id = t.load_id;
    v_amount := a.amount; v_payee := t.carrier_id; v_payer := l.broker_org;
    if app_private.my_partner_org() is distinct from v_payer then raise exception 'not authorized' using errcode='42501'; end if;
  elsif p_kind = 'freight' then
    select * into t from app_private.trips where id = p_ref;
    if t is null then raise exception 'trip not found' using errcode='22023'; end if;
    select * into l from public.loads where id = t.load_id;
    v_amount := t.rate; v_payee := t.carrier_id; v_payer := l.broker_org;
    if app_private.my_partner_org() is distinct from v_payer then raise exception 'not authorized' using errcode='42501'; end if;
  elsif p_kind = 'platform_fee' then
    select * into fi from app_private.fin_invoices where id = p_ref;
    if fi is null then raise exception 'invoice not found' using errcode='22023'; end if;
    v_amount := fi.fee; v_payee := null; v_payer := fi.carrier_id;
    if app_private.my_carrier_org() is distinct from v_payer then raise exception 'not authorized' using errcode='42501'; end if;
  else
    raise exception 'unknown kind' using errcode='22023';
  end if;

  insert into app_private.pay_transfers (kind, ref_id, payer_org, payee_org, amount, status, method, receipt_path, receipt_name, payment_ref, sent_at, expected_by)
  values (p_kind, p_ref, v_payer, v_payee, v_amount, 'sent', coalesce(p_method,'bank_transfer'), p_receipt_path, p_receipt_name, p_payment_ref, now(), (now() + interval '4 days')::date)
  on conflict (kind, ref_id) do update
    set status = 'sent', method = excluded.method, receipt_path = excluded.receipt_path,
        receipt_name = excluded.receipt_name, payment_ref = excluded.payment_ref,
        sent_at = now(), expected_by = excluded.expected_by, received_at = null, confirmed_by = null
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'sent', 'expected_by', (now() + interval '4 days')::date);
end; $$;
revoke all on function public.pay_mark_sent(text, uuid, text, text, text, text) from public;
grant execute on function public.pay_mark_sent(text, uuid, text, text, text, text) to authenticated;

-- ---------- ✓ RECEIVED: payee confirms; fee invoices flip to paid ----------
create or replace function public.pay_confirm_received(p_id uuid)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare tr record; v_ok boolean := false;
begin
  select * into tr from app_private.pay_transfers where id = p_id;
  if tr is null then raise exception 'transfer not found' using errcode='22023'; end if;
  if tr.payee_org is not null and app_private.my_carrier_org() = tr.payee_org then v_ok := true;
  elsif tr.payee_org is null and (public.has_global_permission('dispatch.manage') or public.has_global_permission('finance.manage')) then v_ok := true;
  end if;
  if not v_ok then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.pay_transfers set status = 'received', received_at = now(), confirmed_by = auth.uid() where id = p_id;
  if tr.kind = 'platform_fee' then
    update app_private.fin_invoices set status = 'paid', paid_at = now() where id = tr.ref_id and paid_at is null;
  end if;
  return jsonb_build_object('id', p_id, 'status', 'received');
end; $$;
revoke all on function public.pay_confirm_received(uuid) from public;
grant execute on function public.pay_confirm_received(uuid) to authenticated;

-- ---------- MY MONEY: both directions, with human context ----------
create or replace function public.pay_my_transfers()
 returns jsonb language sql stable security definer
 set search_path to 'app_private, public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', tr.id, 'kind', tr.kind, 'ref_id', tr.ref_id, 'amount', tr.amount, 'status', tr.status,
      'direction', case when tr.payee_org is not null and tr.payee_org = app_private.my_carrier_org() then 'incoming' else 'outgoing' end,
      'sent_at', tr.sent_at, 'expected_by', tr.expected_by, 'received_at', tr.received_at,
      'payment_ref', tr.payment_ref, 'receipt_path', tr.receipt_path,
      'label', case tr.kind
        when 'platform_fee' then 'LoadBoot service fee'
        else coalesce((select upper(a.kind) || ' · ' || l.origin || ' → ' || l.destination
                        from app_private.trip_accessorials a
                        join app_private.trips t on t.id = a.trip_id join public.loads l on l.id = t.load_id
                        where a.id = tr.ref_id and tr.kind = 'claim'),
                      (select 'Freight · ' || l.origin || ' → ' || l.destination
                        from app_private.trips t join public.loads l on l.id = t.load_id
                        where t.id = tr.ref_id and tr.kind = 'freight'), initcap(tr.kind)) end,
      'counterparty', case when tr.payee_org is null then 'LoadBoot'
        when tr.payee_org = app_private.my_carrier_org() then coalesce((select name from public.organizations where id = tr.payer_org), 'Broker')
        else coalesce((select name from public.organizations where id = tr.payee_org), 'Carrier') end
    ) order by tr.sent_at desc), '[]'::jsonb)
  from app_private.pay_transfers tr
  where tr.payer_org in (app_private.my_carrier_org(), app_private.my_partner_org())
     or tr.payee_org = app_private.my_carrier_org();
$$;
revoke all on function public.pay_my_transfers() from public;
grant execute on function public.pay_my_transfers() to authenticated;

-- ---------- CC: platform-fee receipts waiting for verification ----------
create or replace function public.cc_pay_pending_fees()
 returns jsonb language sql stable security definer
 set search_path to 'app_private, public'
as $$
  select case when not (public.has_global_permission('dispatch.manage') or public.has_global_permission('finance.manage'))
    then jsonb_build_object('error','not authorized')
    else coalesce(jsonb_agg(jsonb_build_object(
      'id', tr.id, 'amount', tr.amount, 'status', tr.status, 'sent_at', tr.sent_at,
      'payment_ref', tr.payment_ref, 'receipt_path', tr.receipt_path, 'receipt_name', tr.receipt_name,
      'carrier', (select name from public.organizations where id = tr.payer_org),
      'invoice_no', (select invoice_no from app_private.fin_invoices where id = tr.ref_id)
    ) order by tr.sent_at), '[]'::jsonb) end
  from app_private.pay_transfers tr where tr.kind = 'platform_fee' and tr.status = 'sent';
$$;
revoke all on function public.cc_pay_pending_fees() from public;
grant execute on function public.cc_pay_pending_fees() to authenticated;

-- ---------- receipts are private docs: payee (and staff) may view ----------
create or replace function public.pay_can_read_receipt(p_name text)
 returns boolean language sql stable security definer
 set search_path to 'app_private, public'
as $$
  select exists (
    select 1 from app_private.pay_transfers tr
    where tr.receipt_path = p_name
      and (tr.payee_org = app_private.my_carrier_org()
           or tr.payer_org in (app_private.my_carrier_org(), app_private.my_partner_org()))
  );
$$;
revoke all on function public.pay_can_read_receipt(text) from public;
grant execute on function public.pay_can_read_receipt(text) to authenticated;

drop policy if exists "payment receipt read" on storage.objects;
create policy "payment receipt read" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.pay_can_read_receipt(name));

notify pgrst, 'reload schema';
