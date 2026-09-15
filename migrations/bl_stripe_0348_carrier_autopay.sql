-- bl_stripe_0348 — Stage 2: carrier auto-pay (ACH mandate held at Stripe).
--
-- The carrier authorises ONCE on a Stripe-hosted page. LoadBoot never sees or stores bank
-- numbers — the mandate and the payment method live at Stripe; we keep only the reference and
-- a masked last4 so the portal can say which account is on file.
--
-- WHEN THE CHARGE HAPPENS: on the DUE DATE, not at approval. The invoice is still sent Net-30
-- with a hosted pay page, so a carrier can still pay early by hand. If it is unpaid on the due
-- date, cc_stripe_autopay_enqueue_due() (daily cron) queues an autopay_charge job and the worker
-- calls stripe.invoices.pay() with the saved mandate.
--
-- NACHA: revocation must be as easy as authorisation. pay_autopay_disable() switches it off
-- immediately — that flag alone governs charging — and queues the detach at Stripe.
--
-- A DECLINED CHARGE SWITCHES AUTO-PAY OFF (cc_stripe_autopay_fail). We do not retry against a
-- carrier's bank account; the invoice simply returns to normal collections.
--
-- STAGING (snslhvmkjusozgjelghi): applied 2026-09-15, anon-executable SECURITY DEFINER count
-- verified 32 before and after. PRODUCTION: not applied.

alter table app_private.lb_stripe_customers
  add column if not exists autopay_enabled        boolean not null default false,
  add column if not exists default_payment_method text,
  add column if not exists mandate_ref            text,
  add column if not exists bank_name              text,
  add column if not exists bank_last4             text,
  add column if not exists autopay_setup_at       timestamptz,
  add column if not exists autopay_disabled_at    timestamptz,
  add column if not exists autopay_last_error     text;

alter table app_private.lb_stripe_queue drop constraint if exists lb_stripe_queue_op_check;
alter table app_private.lb_stripe_queue add constraint lb_stripe_queue_op_check
  check (op in ('create_invoice','void_invoice','autopay_charge','autopay_revoke'));
alter table app_private.lb_stripe_queue alter column invoice_id drop not null;  -- autopay_revoke has no invoice
alter table app_private.lb_stripe_queue add column if not exists org_id uuid;
create unique index if not exists lb_stripe_queue_pending_uidx
  on app_private.lb_stripe_queue(invoice_id, op) where done_at is null and invoice_id is not null;

-- Carrier-facing (authenticated): pay_autopay_status, pay_autopay_disable, pay_autopay_setup_context
-- Service-role only:              cc_stripe_autopay_set, cc_stripe_autopay_fail,
--                                 cc_stripe_autopay_enqueue_due
-- cc_stripe_queue_take was also replaced so it LEFT JOINs fin_invoices (autopay_revoke carries an
-- org, not an invoice) and returns autopay_enabled + default_payment_method.
--
-- Copy the live definitions out of staging when replaying to production:
--   select pg_get_functiondef('public.pay_autopay_status()'::regprocedure);
--   select pg_get_functiondef('public.pay_autopay_disable()'::regprocedure);
--   select pg_get_functiondef('public.pay_autopay_setup_context()'::regprocedure);
--   select pg_get_functiondef('public.cc_stripe_autopay_set(uuid,text,text,text,text,text)'::regprocedure);
--   select pg_get_functiondef('public.cc_stripe_autopay_fail(uuid,text,boolean)'::regprocedure);
--   select pg_get_functiondef('public.cc_stripe_autopay_enqueue_due(int)'::regprocedure);
--   select pg_get_functiondef('public.cc_stripe_queue_take(int)'::regprocedure);
--
-- and REMEMBER the anon revokes — Supabase's default privileges hand every new public function to
-- anon, and `revoke ... from public` does not undo it:
--   revoke all on function <each of the above> from anon;
--   revoke all on function <the three cc_stripe_autopay_*> from authenticated;
--   grant execute on function <the three cc_stripe_autopay_*> to service_role;
--   grant execute on function public.pay_autopay_status(), public.pay_autopay_disable(),
--                             public.pay_autopay_setup_context() to authenticated;

-- daily: charge whatever is due and authorised
-- select cron.schedule('lb_autopay_due', '0 13 * * *',
--   $$ select public.cc_stripe_autopay_enqueue_due(200) $$);
