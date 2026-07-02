// staff-invite — Supabase Edge Function (Deno).
//
// PHASE 2A STATUS: SAFE NO-OP STUB. The branded-email provider (owner decision D4)
// and the accept-invite / token-redemption workflow (D8) are NOT implemented, so
// this function performs authentication, authorization and configuration checks and
// then returns an explicit 501/503 *** BEFORE generating any token or making any
// database mutation ***. It NEVER creates an invitation row and NEVER reports a
// false success. `staff_invites_enabled` ships OFF.
//
// Hardening:
//   - Caller is authorized with the caller's OWN JWT via the ANON key. If
//     SUPABASE_ANON_KEY is missing we FAIL CLOSED (503) — we never fall back to the
//     service-role key for caller-context checks.
//   - CORS/OPTIONS is restricted to the approved preview/production origins.
//   - Error bodies never include internal details.
//   - Readiness/rate-limit design is documented in README.md (enforced when the
//     real workflow lands).
//
// Required env when the real workflow is implemented (NOT in the repo):
//   SUPABASE_URL, SUPABASE_ANON_KEY            (platform)
//   SUPABASE_SERVICE_ROLE_KEY                  (platform; used ONLY for the future
//                                               transactional create RPC, never for
//                                               caller authorization)
//   EMAIL_PROVIDER_API_KEY, EMAIL_FROM         (branded sender — D4)
//   APP_INVITE_BASE_URL                        (accept-invite route — D8)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const APPROVED_ORIGINS = new Set([
  'https://loadboot.com',
  'https://www.loadboot.com',
  // Netlify staging Deploy Preview origins are validated by suffix below.
]);
function isApprovedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (APPROVED_ORIGINS.has(origin)) return true;
  // Netlify preview subdomains for this site only.
  return /^https:\/\/[a-z0-9-]+--loadboot(-staging)?\.netlify\.app$/.test(origin);
}
function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-lb-app, x-client-info, apikey',
    'Access-Control-Max-Age': '600',
  };
  if (isApprovedOrigin(origin)) h['Access-Control-Allow-Origin'] = origin as string;
  return h;
}
function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  // CORS preflight — only approved origins get the allow-origin header.
  if (req.method === 'OPTIONS') {
    if (!isApprovedOrigin(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);
  if (origin && !isApprovedOrigin(origin)) return json(403, { error: 'origin_not_allowed' }, origin);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'missing_bearer_token' }, origin);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  // FAIL CLOSED: caller authorization MUST use the anon key + caller JWT. Never the
  // service-role key (that would run privileged and defeat the caller check).
  if (!SUPABASE_URL || !ANON_KEY) return json(503, { error: 'server_not_ready' }, origin);

  // (1) Authorize the CALLER with their own JWT.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: ctx, error: ctxErr } = await asCaller.rpc('get_my_staff_context');
  if (ctxErr) return json(403, { error: 'authorization_check_failed' }, origin);
  const perms: string[] = (ctx && ctx.permissions) || [];
  if (!ctx || !ctx.is_staff || !perms.includes('staff.invite')) {
    return json(403, { error: 'forbidden' }, origin);
  }

  // (2) Feature flag must be ON.
  const { data: flagOn } = await asCaller.rpc('is_flag_enabled', { p_key: 'staff_invites_enabled' });
  if (flagOn !== true) return json(403, { error: 'staff_invites_disabled' }, origin);

  // (3) Provider + redemption workflow not implemented (D4/D8). Return BEFORE any
  //     token generation or database mutation. No invitation row is ever created here.
  const EMAIL_READY = !!(Deno.env.get('EMAIL_PROVIDER_API_KEY') && Deno.env.get('EMAIL_FROM') && Deno.env.get('APP_INVITE_BASE_URL'));
  if (!EMAIL_READY) {
    return json(503, { error: 'email_not_configured' }, origin); // config missing → nothing created
  }
  // Even with email configured, the transactional create RPC + accept-invite
  // redemption are not implemented in this checkpoint. Refuse explicitly; do NOT
  // generate a token or write a row.
  return json(501, { error: 'invitation_workflow_not_implemented' }, origin);
});
