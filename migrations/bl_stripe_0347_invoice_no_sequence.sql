-- bl_stripe_0347 — invoice numbers from a SEQUENCE, not count(*)+1.
--
-- The old line, in BOTH generators (app_private.auto_invoice_on_delivery and
-- public.cc_create_invoice_core), was:
--     lpad(((select count(*) from app_private.fin_invoices)+1)::text,5,'0')
-- Two ways that breaks on a money path:
--   1. two deliveries in the same instant both read the same count and mint the SAME invoice_no
--   2. voiding an invoice lowers the count, so the next number REUSES one already sent to a carrier
-- A sequence is monotonic and concurrency-safe and never goes backwards, even inside a rolled-back
-- transaction. The counter is global rather than per-year, so INV-2027-00123 simply follows
-- INV-2026-00122 — gapless-per-year was never a requirement, uniqueness always was.
--
-- Also in here: cc_create_invoice_core's default term moves 15 -> 30 days, so the manual
-- "create invoice" path agrees with the delivery trigger, the Stripe account and loadboot.com.
--
-- STAGING (snslhvmkjusozgjelghi): applied 2026-09-15. Sequence seeded to 205 (clear of the
-- demo INV-204), unique index created, both generators verified free of count(*).
-- PRODUCTION: not applied yet. Apply bl_stripe_0346 first, then this.

create sequence if not exists app_private.fin_invoice_seq as bigint start with 1 increment by 1;

-- seed clear of every number already issued; counts rows too, in case any number was hand-made
do $seed$
declare v_max bigint;
begin
  select greatest(
           coalesce(max(nullif(regexp_replace(split_part(invoice_no,'-',3), '\D', '', 'g'), ''))::bigint, 0),
           coalesce(max(nullif(regexp_replace(invoice_no, '\D', '', 'g'), ''))::bigint, 0) % 100000,
           count(*)
         )
    into v_max
    from app_private.fin_invoices;
  perform setval('app_private.fin_invoice_seq', greatest(coalesce(v_max,0), 0) + 1, false);
  raise notice 'fin_invoice_seq seeded to %', greatest(coalesce(v_max,0),0) + 1;
end $seed$;

create or replace function app_private.next_invoice_no()
 returns text language sql volatile
 set search_path to 'app_private, public'
as $$ select 'INV-' || to_char(now(), 'YYYY') || '-' ||
            lpad(nextval('app_private.fin_invoice_seq')::text, 5, '0') $$;
revoke all on function app_private.next_invoice_no() from public;

-- belt and braces: the database itself now refuses a duplicate number
create unique index if not exists fin_invoices_invoice_no_uidx
  on app_private.fin_invoices(invoice_no) where invoice_no is not null;

-- NOTE: the two generator functions are replaced in full by this migration as applied to staging.
-- Their bodies are identical to bl_stripe_0346 except for the v_no line, which is now
--     v_no := app_private.next_invoice_no();
-- and cc_create_invoice_core's `p_due_days integer default 30` (was 15) plus the matching
-- `coalesce(p_due_days,30)` in its insert. Copy the live definitions from staging with
--   select pg_get_functiondef('app_private.auto_invoice_on_delivery()'::regprocedure);
--   select pg_get_functiondef('public.cc_create_invoice_core(uuid,integer)'::regprocedure);
-- when replaying to production, so prod gets byte-for-byte what was tested.

notify pgrst, 'reload schema';
