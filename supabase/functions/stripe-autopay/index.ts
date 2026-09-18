// stripe-autopay — starts the carrier's one-time ACH authorisation.
//
// The carrier never types bank details into LoadBoot. This creates a Stripe-hosted Checkout
// session in `setup` mode; Stripe collects the account, shows the NACHA mandate text, and stores
// the payment method. The webhook then records it against the org.
//
// JWT-verified: the caller must be a signed-in carrier. We resolve their org through
// pay_autopay_setup_context() using THEIR token, so a carrier can only ever set up their own org.
//
// Deploy:  supabase functions deploy stripe-autopay --project-ref <ref>     (keep JWT verification ON)
// Secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, LB_PORTAL_URL
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PORTAL = Deno.env.get('LB_PORTAL_URL') ?? 'https://loadboot.com/app/carrier/';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'not signed in' }, 401);

  // act as the CALLER, so their own RLS/permission gates decide which org this is
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data: ctx, error: ctxErr } = await asUser.rpc('pay_autopay_setup_context');
  if (ctxErr || !ctx?.org_id) {
    console.error('[stripe-autopay] context failed', ctxErr?.message);
    return json({ error: 'no carrier account for this user' }, 403);
  }

  try {
    let customer: string | undefined = ctx.stripe_customer_id ?? undefined;
    if (!customer) {
      const c = await stripe.customers.create({
        name: ctx.name || 'Carrier',
        email: ctx.email || undefined,
        metadata: { loadboot_org_id: ctx.org_id },
      }, { idempotencyKey: `lb-cust-${ctx.org_id}` });
      customer = c.id;
      // remember it with the service role, so the worker finds it later
      const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      await svc.rpc('cc_stripe_customer_put', {
        p_org: ctx.org_id, p_customer: customer, p_email: ctx.email ?? null,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      success_url: `${PORTAL}#account/payments?autopay=ok`,
      cancel_url: `${PORTAL}#account/payments?autopay=cancelled`,
      metadata: { loadboot_org_id: ctx.org_id, purpose: 'autopay' },
      setup_intent_data: {
        metadata: { loadboot_org_id: ctx.org_id, purpose: 'autopay' },
      },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('[stripe-autopay] failed', String(err));
    return json({ error: 'could not start authorisation' }, 500);
  }
});
