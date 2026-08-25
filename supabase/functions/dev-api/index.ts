// dev-api v7 — LoadBoot public developer API gateway.
// Auth is by API key (Authorization: Bearer lb_...), NOT a Supabase JWT, so this
// function runs with verify_jwt=false and does its own key verification against
// the hashed api_keys table via the service-role-only dev_verify_api_key RPC.
//
// v7 adds the INBOUND posting path (POST ?resource=loads, scope: write). Until v7
// partners could only read loads out; there was no way for a broker's TMS or a
// syndication network to push loads in. Writes delegate to dev_post_load, which
// runs the same validation the partner portal does.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Fields a partner may send on a load. Anything else is ignored rather than
// rejected, so a TMS with extra columns does not fail the whole post.
const LOAD_FIELDS = [
  'origin', 'destination', 'origin_full', 'destination_full',
  'equipment', 'rate', 'miles', 'weight', 'commodity', 'notes', 'reference',
  'pickup_date', 'delivery_date', 'pickup_window', 'delivery_window',
  'appointment_required', 'tracking_required', 'hazmat', 'hazmat_info',
  'pickup_lat', 'pickup_lng', 'delivery_lat', 'delivery_lng',
  'accessorials', 'stops', 'details', 'idempotency_key',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!key || !key.startsWith('lb_')) {
      return json({ error: 'Missing API key. Send: Authorization: Bearer lb_...' }, 401);
    }
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rows, error } = await sb.rpc('dev_verify_api_key', { p_full: key });
    if (error) return json({ error: 'verification failed' }, 500);
    const principal = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!principal) return json({ error: 'Invalid or revoked API key.' }, 401);

    const url = new URL(req.url);
    const resource = url.searchParams.get('resource') || 'root';
    const scopes: string[] = principal.scopes || [];

    // ---- inbound: post a load ------------------------------------------------
    if (req.method === 'POST') {
      if (resource !== 'loads') return json({ error: 'POST is only supported on ?resource=loads' }, 404);
      if (!scopes.includes('write')) return json({ error: 'insufficient scope: write required' }, 403);

      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'Body must be JSON.' }, 400);
      }

      const batch = Array.isArray(body) ? body : Array.isArray((body as any).loads) ? (body as any).loads : [body];
      if (batch.length === 0) return json({ error: 'No loads in request.' }, 400);
      if (batch.length > 50) return json({ error: 'Max 50 loads per request.' }, 400);

      const headerIdem = req.headers.get('Idempotency-Key') || '';
      const results: unknown[] = [];

      for (let i = 0; i < batch.length; i++) {
        const raw = batch[i] || {};
        const payload: Record<string, unknown> = {};
        for (const f of LOAD_FIELDS) if (raw[f] !== undefined && raw[f] !== null) payload[f] = raw[f];

        // An idempotency key makes a retried POST safe. Prefer the per-load key,
        // fall back to the request header (suffixed so a batch stays distinct).
        if (!payload.idempotency_key && headerIdem) {
          payload.idempotency_key = batch.length > 1 ? `${headerIdem}:${i}` : headerIdem;
        }

        const { data, error: e3 } = await sb.rpc('dev_post_load', { p_user: principal.owner_user_id, p: payload });
        if (e3) {
          results.push({ index: i, ok: false, error: e3.message, reference: raw.reference ?? null });
        } else {
          results.push({ index: i, ok: true, result: data, reference: raw.reference ?? null });
        }
      }

      const okCount = results.filter((r: any) => r.ok).length;
      // 207 when a batch is partly rejected, so the caller knows to read per-item results.
      const status = okCount === results.length ? 200 : okCount === 0 ? 400 : 207;
      return json({ posted: okCount, failed: results.length - okCount, results }, status);
    }

    // ---- outbound ------------------------------------------------------------
    if (resource === 'root') {
      return json({
        service: 'LoadBoot Developer API',
        version: '7',
        authenticated: true,
        scopes,
        endpoints: {
          me: 'GET  ?resource=me',
          read_loads: 'GET  ?resource=loads&limit=25   (public load opportunities — scope: read)',
          post_loads: 'POST ?resource=loads             (post freight to the board — scope: write)',
        },
        post_loads_contract: {
          required: ['origin', 'destination', 'pickup_date', 'hazmat'],
          recommended: ['equipment', 'rate', 'miles', 'weight', 'commodity', 'reference', 'idempotency_key'],
          notes: [
            'Send one load object, or {"loads":[...]} / a bare array for up to 50 at once.',
            'hazmat is a required boolean — we will not infer it.',
            'Detention, layover, TONU and lumper terms default to LoadBoot published rates if you omit them.',
            'Pickup scheduling defaults to FCFS unless you send appointment_required or pickup_window.',
            'Reuse idempotency_key (or send an Idempotency-Key header) to make retries safe.',
            'The API key must belong to an onboarded, document-verified LoadBoot broker account.',
          ],
        },
      });
    }
    if (resource === 'me') {
      return json({ owner: principal.owner_user_id, scopes });
    }
    if (resource === 'loads') {
      if (!scopes.includes('read')) return json({ error: 'insufficient scope: read required' }, 403);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1), 100);
      const { data, error: e2 } = await sb.rpc('get_public_load_opportunities', { p_limit: limit });
      if (e2) return json({ error: 'could not fetch loads' }, 500);
      return json({ count: (data || []).length, loads: data || [] });
    }
    return json({ error: 'unknown resource: ' + resource }, 404);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
