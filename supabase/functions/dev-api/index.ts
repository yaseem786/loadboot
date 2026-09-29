// dev-api v8 — LoadBoot public developer API gateway.
// Auth is by API key (Authorization: Bearer lb_...), NOT a Supabase JWT, so this
// function runs with verify_jwt=false and does its own key verification against
// the hashed api_keys table via the service-role-only dev_api_auth RPC.
//
// v7 added the INBOUND posting path (POST ?resource=loads, scope: write). Writes
// delegate to dev_post_load, which runs the same validation the partner portal does.
//
// v8 (bl_dev_0502b, 29 Sep 2026):
//   - dev_api_auth replaces dev_verify_api_key: key check, suspended developer → 403,
//     per-key per-minute rate limit → 429 + Retry-After (limit lives in CC → API 360).
//   - every call is logged (dev_api_log: key, endpoint, method, status, latency).
//   - `sandbox` scope: fixed "SANDBOX TEST" fixture loads; a sandbox POST validates and
//     echoes, it never touches the real board.
//   - GET loads takes optional equipment / origin_state / dest_state filters and every
//     load carries `url` — the link-back with its ref and the partner's ?src=.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'retry-after, x-ratelimit-limit, x-ratelimit-remaining',
};

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

const LINK_BASE = 'https://loadboot.com/app/carrier/';
const linkBack = (partner: string, ref: string) =>
  `${LINK_BASE}?src=${encodeURIComponent(partner || 'api')}&ref=${encodeURIComponent(ref)}`;

// Sandbox fixtures — obviously fake, stable refs, dates relative to today so they never look stale.
function sandboxLoads() {
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const rows = [
    ['SBX00001', 'Dallas, TX', 'Atlanta, GA', 'Dry Van', 781, 1950],
    ['SBX00002', 'Chicago, IL', 'Columbus, OH', 'Reefer', 356, 1150],
    ['SBX00003', 'Phoenix, AZ', 'Los Angeles, CA', 'Flatbed', 372, 1400],
    ['SBX00004', 'Atlanta, GA', 'Charlotte, NC', 'Dry Van', 244, 875],
    ['SBX00005', 'Houston, TX', 'Memphis, TN', 'Reefer', 561, 1600],
    ['SBX00006', 'Denver, CO', 'Salt Lake City, UT', 'Flatbed', 525, 1700],
  ] as const;
  return rows.map(([ref, origin, destination, equipment, miles, rate], i) => ({
    ref, origin, destination, equipment, miles, rate,
    rpm: Math.round((rate / miles) * 100) / 100,
    pickup_date: day(1 + (i % 3)), posted: new Date().toISOString(), expires_at: null,
    commodity: 'SANDBOX TEST — not a real load', weight: '40000', posted_by: 'LoadBoot sandbox',
  }));
}
const stateOf = (place: string) => ((place || '').match(/,\s*([A-Za-z]{2})\b/) || [])[1]?.toUpperCase() || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const t0 = Date.now();
  const url = new URL(req.url);
  const resource = url.searchParams.get('resource') || 'root';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let who: Record<string, any> = {};
  const extra: Record<string, string> = {};

  const respond = async (body: unknown, status = 200) => {
    // Log first, then answer. A logging failure must never fail the caller's request.
    try {
      await sb.rpc('dev_api_log', { p: {
        key_id: who.key_id || null, prefix: who.prefix || null, owner: who.owner || null,
        method: req.method, endpoint: resource, status, latency_ms: Date.now() - t0,
        error: status >= 400 ? String((body as any)?.error || '').slice(0, 500) : null,
        sandbox: !!who.sandbox,
      } });
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify(body, null, 2), { status, headers: { ...CORS, ...extra, 'Content-Type': 'application/json' } });
  };

  try {
    const auth = req.headers.get('Authorization') || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!key || !key.startsWith('lb_')) {
      return await respond({ error: 'Missing API key. Send: Authorization: Bearer lb_...' }, 401);
    }
    const { data: principal, error } = await sb.rpc('dev_api_auth', { p_full: key });
    if (error || !principal) return await respond({ error: 'verification failed' }, 500);
    who = principal;
    if (principal.limit) extra['X-RateLimit-Limit'] = String(principal.limit);
    if (principal.remaining !== undefined) extra['X-RateLimit-Remaining'] = String(principal.remaining);
    if (!principal.ok) {
      if (principal.status === 429) { extra['Retry-After'] = String(principal.retry_after || 60); extra['X-RateLimit-Remaining'] = '0'; }
      return await respond({ error: principal.error, ...(principal.status === 429 ? { retry_after: principal.retry_after } : {}) }, principal.status || 401);
    }
    const scopes: string[] = principal.scopes || [];
    const sandbox = !!principal.sandbox;
    const partner: string = principal.partner || 'api';

    // ---- inbound: post a load ------------------------------------------------
    if (req.method === 'POST') {
      if (resource !== 'loads') return await respond({ error: 'POST is only supported on ?resource=loads' }, 404);
      if (!sandbox && !scopes.includes('write')) return await respond({ error: 'insufficient scope: write required' }, 403);

      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return await respond({ error: 'Body must be JSON.' }, 400);
      }

      const batch = Array.isArray(body) ? body : Array.isArray((body as any).loads) ? (body as any).loads : [body];
      if (batch.length === 0) return await respond({ error: 'No loads in request.' }, 400);
      if (batch.length > 50) return await respond({ error: 'Max 50 loads per request.' }, 400);

      const headerIdem = req.headers.get('Idempotency-Key') || '';
      const results: unknown[] = [];

      for (let i = 0; i < batch.length; i++) {
        const raw = batch[i] || {};
        const payload: Record<string, unknown> = {};
        for (const f of LOAD_FIELDS) if (raw[f] !== undefined && raw[f] !== null) payload[f] = raw[f];

        if (!payload.idempotency_key && headerIdem) {
          payload.idempotency_key = batch.length > 1 ? `${headerIdem}:${i}` : headerIdem;
        }

        if (sandbox) {
          // Validate the contract the real endpoint enforces; never write anything.
          const missing = ['origin', 'destination', 'pickup_date'].filter((f) => !String(payload[f] ?? '').trim());
          if (typeof payload.hazmat !== 'boolean') missing.push('hazmat (boolean)');
          if (missing.length) results.push({ index: i, ok: false, error: 'missing: ' + missing.join(', '), reference: raw.reference ?? null });
          else results.push({ index: i, ok: true, sandbox: true, result: { note: 'SANDBOX — validated, not posted', ref: 'SBX' + String(i + 1).padStart(5, '0') }, reference: raw.reference ?? null });
          continue;
        }

        const { data, error: e3 } = await sb.rpc('dev_post_load', { p_user: principal.owner, p: payload });
        if (e3) {
          results.push({ index: i, ok: false, error: e3.message, reference: raw.reference ?? null });
        } else {
          results.push({ index: i, ok: true, result: data, reference: raw.reference ?? null });
        }
      }

      const okCount = results.filter((r: any) => r.ok).length;
      // 207 when a batch is partly rejected, so the caller knows to read per-item results.
      const status = okCount === results.length ? 200 : okCount === 0 ? 400 : 207;
      return await respond({ posted: okCount, failed: results.length - okCount, sandbox, results }, status);
    }

    // ---- outbound ------------------------------------------------------------
    if (resource === 'root') {
      return await respond({
        service: 'LoadBoot Developer API',
        version: '8',
        authenticated: true,
        scopes,
        sandbox,
        endpoints: {
          me: 'GET  ?resource=me',
          read_loads: 'GET  ?resource=loads&limit=25[&equipment=Reefer][&origin_state=TX][&dest_state=GA]   (scope: read, or sandbox)',
          post_loads: 'POST ?resource=loads             (post freight to the board — scope: write)',
        },
        rate_limit: `${principal.limit} requests per minute per key (429 + Retry-After when exceeded)`,
        attribution: {
          label: 'via LoadBoot',
          rule: 'Show "via LoadBoot" only on loads whose ref came from this API, and link each one to its url.',
          url_template: linkBack(partner, '{ref}').replace('%7Bref%7D', '{ref}'),
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
      return await respond({
        owner: principal.owner, scopes, sandbox, key_prefix: principal.prefix,
        account_status: principal.account_status ?? null, company: principal.company ?? null,
        partner, rate_limit_per_min: principal.limit,
      });
    }
    if (resource === 'loads') {
      if (!sandbox && !scopes.includes('read')) return await respond({ error: 'insufficient scope: read required' }, 403);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1), 50);
      const equipment = (url.searchParams.get('equipment') || '').trim();
      const originState = (url.searchParams.get('origin_state') || '').trim().toUpperCase();
      const destState = (url.searchParams.get('dest_state') || '').trim().toUpperCase();
      for (const [k, v] of [['origin_state', originState], ['dest_state', destState]]) {
        if (v && !/^[A-Z]{2}$/.test(v)) return await respond({ error: `${k} must be a 2-letter state code` }, 400);
      }
      let loads: any[];
      if (sandbox) {
        loads = sandboxLoads().filter((l) =>
          (!equipment || l.equipment.toLowerCase().includes(equipment.toLowerCase())) &&
          (!originState || stateOf(l.origin) === originState) &&
          (!destState || stateOf(l.destination) === destState)).slice(0, limit);
      } else {
        const { data, error: e2 } = await sb.rpc('dev_api_loads', {
          p_limit: limit, p_equipment: equipment || null, p_origin_state: originState || null, p_dest_state: destState || null,
        });
        if (e2) return await respond({ error: 'could not fetch loads' }, 500);
        loads = Array.isArray(data) ? data : [];
      }
      loads = loads.map((l) => ({ ...l, url: linkBack(partner, l.ref) }));
      return await respond({ count: loads.length, sandbox, loads });
    }
    return await respond({ error: 'unknown resource: ' + resource }, 404);
  } catch (e) {
    return await respond({ error: String((e as Error).message || e) }, 500);
  }
});
