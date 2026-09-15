# Stripe fee billing — status and what is left

**Decision:** fee terms are **Net-30**. The site, the dispatch agreement and the Stripe account all
said 30; only the database said 15. Published terms win, so the database moved. All three generators
now agree: the delivery trigger, `cc_create_invoice_core` (default 15 → 30) and `views/finance.js`.

## Applied to STAGING (`snslhvmkjusozgjelghi`)

**bl_stripe_0346** — the Stripe rails. All additive.
- `fin_invoices` + `stripe_invoice_id, stripe_status, hosted_url, pdf_url, approved_at, approved_by,
  sent_at, void_reason`
- new tables `lb_stripe_customers`, `lb_stripe_events` (webhook idempotency), `lb_stripe_queue`
- two feature flags, **both OFF** — the migration changes nothing until you turn them on:
  `fee_invoice_approval_queue`, `stripe_fee_billing_enabled`
- `auto_invoice_on_delivery()` — net-30, and holds at `draft` when the queue flag is on
- `app_private.fee_invoice_notify()` — the carrier's in-app notice + premium email, pulled out of the
  trigger so the trigger, the approve RPC and the Stripe worker all send the same email exactly once
  (idempotency key `feeinv:<invoice_no>`)
- staff RPCs (authenticated, finance-gated): `cc_fee_invoice_queue / _approve / _reject`
- service_role-only RPCs: `cc_fee_invoice_mark_paid / _mark_unpaid / _stripe_sync / _stripe_status`,
  `cc_stripe_queue_take / _queue_finish / _customer_put / _event_seen / _event_done`

**bl_stripe_0347** — invoice numbers off `count(*)+1` onto `app_private.fin_invoice_seq` via
`app_private.next_invoice_no()`, in **both** generators, plus a unique index on `invoice_no`.
Sequence seeded to 205, clear of the demo INV-204. The old bug: concurrent deliveries minted the same
number, and voiding an invoice made the next one reuse a number already sent to a carrier.

### ⚠ The trap that nearly shipped
Supabase's default privileges grant EXECUTE on every new `public` function to `anon`, and
`revoke ... from public` does NOT remove it. The anon-executable SECURITY DEFINER count jumped
32 → 36 until explicit `revoke ... from anon` lines were added (section 6 of 0346). Verified back at
32. **Never drop those lines when replaying to production.**

## Committed to disk (not pushed)

| File | What changed |
|---|---|
| `migrations/bl_stripe_0346_fee_billing_rails.sql` | new |
| `migrations/bl_stripe_0347_invoice_no_sequence.sql` | new |
| `supabase/functions/stripe-webhook/index.ts` | new |
| `supabase/functions/stripe-worker/index.ts` | new |
| `app/command-center/views/feeApprovals.js` | new — the approval desk |
| `app/command-center/views/finance.js` | one line: `createInvoice(t.id, 15)` → `30` |
| `app/shared/api.js` | +3 wrappers: `feeInvoiceQueue / Approve / Reject` |
| `app/command-center/app.js` | +import, +Finance tab "Fee approvals", +route `/fee-approvals` |
| `docs/STRIPE-HANDOFF.md` | this file |

Every JS file verified with `esbuild` (not just `node --check`) and CRLF line endings preserved, so
the diffs are three or four lines each, not whole-file rewrites.

## Stage 2 — carrier auto-pay (bl_stripe_0348, applied to staging)

The carrier authorises their bank **once** on a Stripe-hosted page; LoadBoot never sees the account
number. After that each dispatch-fee invoice pays itself **on its due date** — not at approval, so the
carrier still receives the invoice Net-30 and can pay early by hand if they prefer.

- `lb_stripe_customers` + `autopay_enabled, default_payment_method, mandate_ref, bank_name,
  bank_last4, autopay_setup_at, autopay_disabled_at, autopay_last_error`
- queue ops `autopay_charge` and `autopay_revoke`; `cc_stripe_queue_take` now LEFT JOINs the invoice
  because a revoke carries an org, not an invoice
- carrier RPCs (authenticated): `pay_autopay_status`, `pay_autopay_disable`, `pay_autopay_setup_context`
- service_role RPCs: `cc_stripe_autopay_set`, `cc_stripe_autopay_fail`, `cc_stripe_autopay_enqueue_due`
- new edge function **`stripe-autopay`** — JWT-verified, creates the Stripe Checkout setup session.
  Keep JWT verification ON for this one (unlike the webhook). It resolves the org with the CALLER's
  token, so a carrier can only ever authorise their own account.
- webhook now handles `checkout.session.completed` (mode=setup) and `mandate.updated`
- worker now handles `autopay_charge` (calls `invoices.pay` with the saved mandate) and `autopay_revoke`
- carrier portal: Account → Payments has an auto-pay row and a Set up / Turn off button

Two deliberate safety choices: a **declined charge switches auto-pay off** rather than retrying
against the carrier's bank, and the worker re-reads the invoice from Stripe first so an invoice paid
between the cron run and the charge is never double-charged. Revocation is instant and self-serve,
which NACHA requires.

Extra cron for Stage 2:
```
select cron.schedule('lb_autopay_due', '0 13 * * *', $$ select public.cc_stripe_autopay_enqueue_due(200) $$);
```

## Left to do

1. **Deploy the three edge functions to staging** with **test-mode** Stripe keys:
   `supabase functions deploy stripe-webhook --no-verify-jwt`, `supabase functions deploy stripe-worker`,
   and `supabase functions deploy stripe-autopay` (JWT verification stays ON for this one).
   Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LB_WORKER_TOKEN`, `LB_PORTAL_URL`.
2. **Schedule the worker** — pg_cron every 2 minutes, header `x-lb-worker: <LB_WORKER_TOKEN>`.
3. **Stripe webhook endpoint** → the staging function URL, sending `invoice.paid`,
   `invoice.payment_failed`, `invoice.marked_uncollectible`, `payment_intent.processing`,
   `charge.dispute.created`, `checkout.session.completed`, `mandate.updated`.
4. **Turn the flags on in this order:** `fee_invoice_approval_queue` first — that proves the queue,
   the approve button and the email with no Stripe involved. Only then `stripe_fee_billing_enabled`.
5. **Production last**, after a real end-to-end test on staging. Replay 0346 then 0347, copying the
   live function definitions out of staging with `pg_get_functiondef` so prod gets byte-for-byte what
   was tested. Re-check the anon-secdef count against `docs/audit-2026-09/anon-secdef-baseline.md`.

## How it behaves once the flags are on

Load delivered → invoice drafted, **nothing sent** → it appears in Command Center under
Finance → Fee approvals with carrier, lane, gross, the 5% fee and how long it has been waiting →
you approve → Net-30 starts today, the Stripe invoice is created, and the carrier gets one LoadBoot
email with a hosted ACH/card pay button. Reject instead and it voids with a reason; the carrier never
sees it.

## Testing auto-pay on staging

Stripe test mode has ACH test accounts — use routing `110000000` with account `000123456789` on the
hosted setup page, then run the worker by hand (`cc_stripe_autopay_enqueue_due` first) rather than
waiting for the cron. Test the revoke path too: turn auto-pay off in the portal and confirm the
`autopay_revoke` job detaches the payment method at Stripe.

## The ACH rule

A carrier clicking **Pay** does not mean money moved. Funds take about 4–5 business days, the charge
can fail afterwards, and an unauthorised debit can be returned for up to 60 days. Only `invoice.paid`
from the signature-verified webhook marks an invoice paid — never the UI, never on click.
