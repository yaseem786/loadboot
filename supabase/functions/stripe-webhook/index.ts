// stripe-webhook — the ONLY thing allowed to say a dispatch fee was paid.
//
// ACH is a delayed-notification method: the carrier clicking "Pay" does not mean money moved,
// the charge can fail days later, and an unauthorised debit can be returned for up to 60 days.
// So LoadBoot never marks an invoice paid from the UI — only from a signature-verified event here.
//
// Everything goes through service_role RPCs in `public`. app_private is deliberately NOT exposed
// to PostgREST and must stay that way.
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt --project-ref <ref>
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Stripe → Developers → Webhooks → add endpoint, send:
//   invoice.paid, invoice.payment_failed, invoice.marked_uncollectible,
//   payment_intent.processing, charge.dispute.created
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const invoiceIdOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : (v && typeof v === 'object' && 'id' in (v as any)) ? (v as any).id : null;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const sig = req.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing signature' }, 400);

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    // the async variant is required on Deno (WebCrypto)
    event = await stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] bad signature', String(err));
    return json({ error: 'invalid signature' }, 400);
  }

  // Stripe retries. This is the idempotency gate — false means we already handled it.
  const { data: isNew, error: seenErr } = await db.rpc('cc_stripe_event_seen', {
    p_event: event.id, p_type: event.type, p_payload: event as unknown as Record<string, unknown>,
  });
  if (seenErr) console.error('[stripe-webhook] event log failed', seenErr.message);
  if (isNew === false) return json({ received: true, duplicate: true });

  let handled = 'ignored';
  try {
    switch (event.type) {
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        const types = inv.payment_settings?.payment_method_types || [];
        const method = types.includes('us_bank_account') ? 'stripe_ach' : 'stripe_card';
        const paidAt = (inv.status_transitions?.paid_at ?? event.created) * 1000;
        const { data, error } = await db.rpc('cc_fee_invoice_mark_paid', {
          p_stripe_invoice_id: inv.id,
          p_paid_at: new Date(paidAt).toISOString(),
          p_method: method,
          p_payment_ref: invoiceIdOf(inv.payment_intent) || inv.number || inv.id,
        });
        if (error) throw new Error(error.message);
        handled = 'paid';
        console.log('[stripe-webhook] paid', inv.id, JSON.stringify(data));
        break;
      }

      case 'invoice.payment_failed':
      case 'invoice.marked_uncollectible': {
        const inv = event.data.object as Stripe.Invoice;
        const { error } = await db.rpc('cc_fee_invoice_mark_unpaid', {
          p_stripe_invoice_id: inv.id,
          p_reason: event.type === 'invoice.marked_uncollectible'
            ? 'marked uncollectible in Stripe'
            : (inv.last_finalization_error?.message || 'payment failed or ACH returned'),
          p_stripe_status: event.type === 'invoice.payment_failed' ? 'payment_failed' : 'uncollectible',
        });
        if (error) throw new Error(error.message);
        handled = 'unpaid';
        break;
      }

      case 'payment_intent.processing': {
        // ACH in flight. Money has NOT arrived — record the state, never mark paid.
        const pi = event.data.object as Stripe.PaymentIntent;
        const invId = invoiceIdOf(pi.invoice);
        if (invId) {
          const { error } = await db.rpc('cc_fee_invoice_stripe_status', {
            p_stripe_invoice_id: invId, p_status: 'processing',
          });
          if (error) throw new Error(error.message);
        }
        handled = 'processing';
        break;
      }

      case 'checkout.session.completed': {
        // the carrier finished the hosted ACH authorisation (Stage 2 auto-pay)
        const sess = event.data.object as Stripe.Checkout.Session;
        if (sess.mode !== 'setup' || sess.metadata?.purpose !== 'autopay') { handled = 'ignored'; break; }
        const orgId = sess.metadata?.loadboot_org_id;
        const siId = invoiceIdOf(sess.setup_intent);
        if (!orgId || !siId) throw new Error('setup session missing org or setup_intent');

        const si = await stripe.setupIntents.retrieve(siId, { expand: ['payment_method'] });
        const pm = si.payment_method as Stripe.PaymentMethod | null;
        const bank = pm?.us_bank_account;
        const { error } = await db.rpc('cc_stripe_autopay_set', {
          p_org: orgId,
          p_customer: typeof sess.customer === 'string' ? sess.customer : sess.customer?.id,
          p_payment_method: typeof pm === 'string' ? pm : pm?.id,
          p_mandate: typeof si.mandate === 'string' ? si.mandate : si.mandate?.id ?? null,
          p_bank_name: bank?.bank_name ?? null,
          p_last4: bank?.last4 ?? null,
        });
        if (error) throw new Error(error.message);
        handled = 'autopay_enabled';
        break;
      }

      case 'mandate.updated': {
        // the carrier (or their bank) revoked the ACH authorisation at the bank's end
        const m = event.data.object as Stripe.Mandate;
        if (m.status === 'inactive') {
          const pm = typeof m.payment_method === 'string' ? m.payment_method : m.payment_method?.id;
          console.warn('[stripe-webhook] mandate revoked', m.id, pm);
          // there is no org on the mandate; the worker's next charge will fail and disable it,
          // and the carrier's portal toggle reflects lb_stripe_customers.autopay_enabled.
        }
        handled = 'mandate';
        break;
      }

      case 'charge.dispute.created': {
        const d = event.data.object as Stripe.Dispute;
        console.warn('[stripe-webhook] DISPUTE opened', d.id, d.amount, d.reason);
        handled = 'dispute';
        break;
      }
    }

    await db.rpc('cc_stripe_event_done', { p_event: event.id, p_error: null });
  } catch (err) {
    const msg = String(err);
    console.error('[stripe-webhook] handler failed', event.type, msg);
    await db.rpc('cc_stripe_event_done', { p_event: event.id, p_error: msg });
    // 500 makes Stripe retry — the event is not lost
    return json({ error: 'handler failed' }, 500);
  }

  return json({ received: true, handled });
});
