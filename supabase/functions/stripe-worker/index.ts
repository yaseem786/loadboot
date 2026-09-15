// stripe-worker — drains the Stripe job queue and creates the hosted invoice.
//
// Why a queue instead of calling Stripe from the delivery trigger: a trigger that calls a
// third-party API holds a transaction open on the delivery path. If Stripe is slow, deliveries
// stall. The trigger only enqueues; this worker retries with backoff and fails safely.
//
// Everything goes through service_role RPCs in `public`; app_private stays unexposed.
//
// Deploy:   supabase functions deploy stripe-worker --project-ref <ref>
// Schedule: pg_cron every 2 minutes, or a Supabase scheduled function.
// Secrets:  STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LB_WORKER_TOKEN
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const WORKER_TOKEN = Deno.env.get('LB_WORKER_TOKEN')!;
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

type Job = {
  job_id: string; op: string; attempts: number;
  invoice_id: string; invoice_no: string; fee: number; gross: number; fee_pct: number;
  due_at: string; stripe_invoice_id: string | null;
  carrier_id: string; carrier_name: string | null; carrier_email: string | null;
  stripe_customer_id: string | null; lane: string;
  autopay_enabled: boolean; default_payment_method: string | null;
};

async function customerFor(job: Job): Promise<string> {
  if (job.stripe_customer_id) return job.stripe_customer_id;
  const c = await stripe.customers.create({
    name: job.carrier_name || 'Carrier',
    email: job.carrier_email || undefined,
    metadata: { loadboot_org_id: job.carrier_id },
  }, { idempotencyKey: `lb-cust-${job.carrier_id}` });
  const { error } = await db.rpc('cc_stripe_customer_put', {
    p_org: job.carrier_id, p_customer: c.id, p_email: job.carrier_email,
  });
  if (error) throw new Error('customer save failed: ' + error.message);
  return c.id;
}

async function createInvoice(job: Job) {
  if (job.stripe_invoice_id) return { skipped: 'already has a Stripe invoice' };

  const customer = await customerFor(job);
  const daysUntilDue = Math.max(
    1, Math.ceil((new Date(job.due_at).getTime() - Date.now()) / 86_400_000),
  );

  await stripe.invoiceItems.create({
    customer,
    currency: 'usd',
    amount: Math.round(Number(job.fee) * 100),
    description:
      `Dispatch service fee (${job.fee_pct || 5}% of $${job.gross}) — ${job.lane}`,
    metadata: { loadboot_invoice_no: job.invoice_no, loadboot_invoice_id: job.invoice_id },
  }, { idempotencyKey: `lb-item-${job.invoice_id}` });

  const draft = await stripe.invoices.create({
    customer,
    collection_method: 'send_invoice',
    days_until_due: daysUntilDue,
    auto_advance: false, // we finalize ourselves and send our own branded email
    description: `LoadBoot dispatch fee — invoice ${job.invoice_no}`,
    metadata: { loadboot_invoice_no: job.invoice_no, loadboot_invoice_id: job.invoice_id },
    payment_settings: { payment_method_types: ['us_bank_account', 'card'] },
  }, { idempotencyKey: `lb-inv-${job.invoice_id}` });

  const inv = await stripe.invoices.finalizeInvoice(draft.id);

  // Write the hosted link back, then fire OUR email (p_notify) so the carrier gets one
  // consistent LoadBoot template with the pay button inside it, not Stripe's own.
  const { error } = await db.rpc('cc_fee_invoice_stripe_sync', {
    p_invoice: job.invoice_id,
    p_stripe_id: inv.id,
    p_hosted: inv.hosted_invoice_url,
    p_pdf: inv.invoice_pdf,
    p_stripe_status: inv.status,
    p_notify: true,
  });
  if (error) throw new Error('sync failed: ' + error.message);

  return { stripe_invoice: inv.id, hosted: inv.hosted_invoice_url };
}

async function autopayCharge(job: Job) {
  if (!job.stripe_invoice_id) return { skipped: 'no stripe invoice' };
  if (!job.autopay_enabled || !job.default_payment_method) {
    return { skipped: 'auto-pay is off for this carrier' };
  }

  // Already settled between the cron run and now? Do nothing — never double-charge.
  const current = await stripe.invoices.retrieve(job.stripe_invoice_id);
  if (current.status === 'paid' || current.status === 'void') {
    return { skipped: `invoice already ${current.status}` };
  }

  try {
    const paid = await stripe.invoices.pay(job.stripe_invoice_id, {
      payment_method: job.default_payment_method,
      // do NOT let Stripe fall back to another method the carrier did not authorise
      off_session: true,
    }, { idempotencyKey: `lb-autopay-${job.invoice_id}` });
    // ACH does not settle here — invoice.paid from the webhook is what marks it paid.
    return { charged: paid.id, stripe_status: paid.status };
  } catch (err) {
    const msg = String(err);
    // a declined mandate must not keep retrying against the carrier's bank
    await db.rpc('cc_stripe_autopay_fail', {
      p_org: job.carrier_id, p_error: msg, p_disable: true,
    });
    throw new Error('autopay charge declined, auto-pay switched off: ' + msg);
  }
}

async function autopayRevoke(job: Job) {
  if (!job.default_payment_method) return { skipped: 'nothing on file' };
  try {
    await stripe.paymentMethods.detach(job.default_payment_method);
  } catch (err) {
    // already gone at Stripe is fine — the DB flag is what stops charges
    console.warn('[stripe-worker] detach failed (ignored)', String(err));
  }
  return { revoked: job.default_payment_method };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-lb-worker') !== WORKER_TOKEN) return json({ error: 'forbidden' }, 403);

  const { data: jobs, error } = await db.rpc('cc_stripe_queue_take', { p_limit: 20 });
  if (error) return json({ error: error.message }, 500);
  const list = (jobs || []) as Job[];
  if (!list.length) return json({ ok: true, drained: 0 });

  const results: unknown[] = [];
  for (const job of list) {
    try {
      const out = job.op === 'create_invoice' ? await createInvoice(job)
        : job.op === 'autopay_charge' ? await autopayCharge(job)
        : job.op === 'autopay_revoke' ? await autopayRevoke(job)
        : { skipped: job.op };
      await db.rpc('cc_stripe_queue_finish', { p_job: job.job_id, p_error: null });
      results.push({ job: job.job_id, invoice: job.invoice_no, ok: true, ...out });
    } catch (err) {
      const msg = String(err);
      const { data } = await db.rpc('cc_stripe_queue_finish', { p_job: job.job_id, p_error: msg });
      console.error('[stripe-worker]', job.invoice_no, msg, JSON.stringify(data));
      results.push({ job: job.job_id, invoice: job.invoice_no, ok: false, error: msg });
    }
  }
  return json({ ok: true, drained: results.length, results });
});
