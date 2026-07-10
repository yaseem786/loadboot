-- wave-accessorial-payout · wa_0001
-- GAP FIX: approved accessorials (detention/layover/lumper/tonu/driver-assist/other) must reach
-- the carrier's payable. Today auto_invoice_on_delivery() bills LINEHAUL ONLY and cc_create_settlement
-- sums fin_invoices.net — so an approved accessorial never gets paid to the carrier.
--
-- Design: accessorials are 100% PASS-THROUGH to the carrier — LoadBoot takes NO fee on them
-- (matches the rate-card promise "LoadBoot does not charge, add, or take any of them").
-- On approval, the amount is added to the trip's live unpaid invoice: gross += amt, net += amt
-- (fee unchanged → net = gross - fee still holds, because fee is only on linehaul). A matching
-- fin_adjustments(kind='accessorial') row is written for the audit trail. Idempotent via invoiced_at.
-- Additive & reversible: does not alter existing settlement/invoice math, only adds to unpaid invoices.

alter table app_private.trip_accessorials add column if not exists invoiced_at timestamptz;

-- apply ONE approved+billable accessorial to the trip's live (unpaid) invoice, once
create or replace function app_private.apply_accessorial_to_invoice(p_acc uuid)
returns void language plpgsql security definer
set search_path to 'app_private', 'public'
as $function$
declare a record; v_inv uuid;
begin
  select * into a from app_private.trip_accessorials where id = p_acc;
  if a.id is null or a.status <> 'approved' or not a.billable
     or coalesce(a.amount,0) <= 0 or a.invoiced_at is not null then
    return;
  end if;
  -- newest live (not paid/void) invoice for this trip
  select id into v_inv from app_private.fin_invoices
    where trip_id = a.trip_id and status in ('draft','sent')
    order by created_at desc limit 1;
  if v_inv is null then
    return;  -- no live invoice yet; the delivery-invoice trigger will pull it in later
  end if;
  update app_private.fin_invoices
     set gross = gross + a.amount, net = net + a.amount   -- pass-through: no fee on accessorials
   where id = v_inv;
  insert into app_private.fin_adjustments(invoice_id, kind, amount, note, created_by)
    values (v_inv, 'accessorial', a.amount,
            a.kind || ' accessorial (pass-through to carrier, no fee)', a.decided_by);
  update app_private.trip_accessorials set invoiced_at = now() where id = a.id;
  perform app_private.emit_event('invoice.accessorial.applied','fin_invoice', v_inv::text,
    jsonb_build_object('accessorial', a.id, 'kind', a.kind, 'amount', a.amount), 'acc:'||a.id::text);
end; $function$;
revoke all on function app_private.apply_accessorial_to_invoice(uuid) from public, anon, authenticated;

-- when an accessorial becomes approved+billable → push it onto the live invoice
create or replace function app_private.trg_accessorial_to_invoice()
returns trigger language plpgsql
set search_path to 'app_private', 'public'
as $function$
begin
  if new.status = 'approved' and new.billable and coalesce(new.amount,0) > 0 and new.invoiced_at is null then
    perform app_private.apply_accessorial_to_invoice(new.id);
  end if;
  return new;
end; $function$;
drop trigger if exists accessorial_to_invoice on app_private.trip_accessorials;
create trigger accessorial_to_invoice
  after insert or update of status, amount, billable on app_private.trip_accessorials
  for each row execute function app_private.trg_accessorial_to_invoice();

-- when a (delivery) invoice is created → pull in any already-approved accessorials for that trip
create or replace function app_private.trg_invoice_pull_accessorials()
returns trigger language plpgsql
set search_path to 'app_private', 'public'
as $function$
declare r record;
begin
  if new.trip_id is not null and new.status in ('draft','sent') then
    for r in select id from app_private.trip_accessorials
             where trip_id = new.trip_id and status = 'approved' and billable
               and coalesce(amount,0) > 0 and invoiced_at is null
    loop
      perform app_private.apply_accessorial_to_invoice(r.id);
    end loop;
  end if;
  return new;
end; $function$;
drop trigger if exists invoice_pull_accessorials on app_private.fin_invoices;
create trigger invoice_pull_accessorials
  after insert on app_private.fin_invoices
  for each row execute function app_private.trg_invoice_pull_accessorials();
