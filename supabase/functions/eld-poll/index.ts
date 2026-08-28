// eld-poll — polls Samsara/Motive with each carrier's OWN api token and feeds
//   (1) positions into their active trip via the public eld_ingest RPC (unchanged, since v1), and
//   (2) NEW 28 Aug 2026 (bl_eld_0293): drivers' hours-of-service clocks into truck_availability via
//       eld_hos_ingest, for every carrier with an active integration AND a LoadBoot dispatcher —
//       trip or no trip, because the dispatcher plans the NEXT load from the remaining drive time.
// Both writes are ingest-token authenticated (per carrier); the function needs the service role only
// to read the target lists. Invoked by pg_cron (net.http_post) every 5 minutes. Throttled to >=3 min.
// Samsara: GET /fleet/hos/clocks → driveRemainingDurationMs / shiftRemainingDurationMs /
//          cycleRemainingDurationMs, currentDutyStatus.hosStatusType, driver.name   (vendor docs)
// Motive : GET /v1/available_time → per-driver available drive/shift/cycle; field names vary by
//          account, so the parser accepts seconds OR minutes OR HH:MM and reports what it could read.
// No live ELD account existed when this was written — the Motive parser is defensive on purpose.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
let lastRun = 0;

type Drv = { name: string; drive_h: number | null; shift_h: number | null; cycle_h: number | null; status: string | null; at: string | null };

function hoursFrom(v: unknown, unitHint: 'ms' | 'auto'): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) { const [h, m] = v.split(':').map(Number); return Math.round((h + m / 60) * 10) / 10; }
  const n = Number(v); if (!isFinite(n)) return null;
  if (unitHint === 'ms') return Math.round(n / 3600000 * 10) / 10;
  // auto: seconds if large, minutes if medium, hours if small
  if (n > 3600) return Math.round(n / 3600 * 10) / 10;
  if (n > 60) return Math.round(n / 60 * 10) / 10;
  return Math.round(n * 10) / 10;
}

async function samsaraHos(token: string): Promise<Drv[]> {
  const out: Drv[] = []; let after = '';
  for (let page = 0; page < 5; page++) {
    const r = await fetch('https://api.samsara.com/fleet/hos/clocks?limit=512' + (after ? '&after=' + encodeURIComponent(after) : ''), { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('samsara hos ' + r.status);
    const j = await r.json();
    for (const row of (j && j.data) || []) {
      const c = row.clocks || row; const drv = row.driver || {};
      out.push({ name: String(drv.name || drv.id || ''), drive_h: hoursFrom(c.drive?.driveRemainingDurationMs ?? c.driveRemainingDurationMs, 'ms'),
        shift_h: hoursFrom(c.shift?.shiftRemainingDurationMs ?? c.shiftRemainingDurationMs, 'ms'), cycle_h: hoursFrom(c.cycle?.cycleRemainingDurationMs ?? c.cycleRemainingDurationMs, 'ms'),
        status: (row.currentDutyStatus && row.currentDutyStatus.hosStatusType) || null, at: (row.currentDutyStatus && row.currentDutyStatus.hosStatusStartTime) || null });
    }
    after = j?.pagination?.endCursor || ''; if (!j?.pagination?.hasNextPage || !after) break;
  }
  return out.filter((d) => d.name);
}

async function motiveHos(token: string): Promise<Drv[]> {
  const r = await fetch('https://api.gomotive.com/v1/available_time', { headers: { 'X-Api-Key': token } });
  if (!r.ok) throw new Error('motive hos ' + r.status);
  const j = await r.json();
  const rows = (j && (j.users || j.drivers || j.available_time || j.data)) || [];
  const out: Drv[] = [];
  for (const w of rows) {
    const u = w.user || w.driver || w; const a = w.available_time || u.available_time || w.availability || u;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.name || String(u.id || '');
    out.push({ name, drive_h: hoursFrom(a.drive ?? a.driving ?? a.drive_remaining ?? a.available_drive, 'auto'), shift_h: hoursFrom(a.shift ?? a.shift_remaining ?? a.on_duty, 'auto'),
      cycle_h: hoursFrom(a.cycle ?? a.cycle_remaining, 'auto'), status: a.duty_status || u.duty_status || w.duty_status || null, at: a.updated_at || w.updated_at || null });
  }
  return out.filter((d) => d.name);
}

Deno.serve(async (_req) => {
  const now = Date.now();
  if (now - lastRun < 3 * 60 * 1000) {
    return new Response(JSON.stringify({ ok: true, skipped: 'throttled' }), { headers: { 'content-type': 'application/json' } });
  }
  lastRun = now;
  const sb = createClient(SB_URL, SERVICE);

  // ---- (1) GPS → active trip (unchanged) ----
  const { data: targets, error } = await sb.rpc('eld_poll_targets');
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  let pushed = 0, failed = 0;
  for (const t of (targets as any[]) || []) {
    try {
      let lat: number | null = null, lng: number | null = null, at: string | null = null;
      if (t.provider === 'samsara') {
        const r = await fetch('https://api.samsara.com/fleet/vehicles/locations', { headers: { Authorization: 'Bearer ' + t.api_token } });
        if (!r.ok) throw new Error('samsara ' + r.status);
        const j = await r.json();
        const vs = (j && j.data) || [];
        let best: any = null;
        for (const v of vs) { const loc = v.location || (v.locations && v.locations[0]); if (loc && (!best || String(loc.time || '') > String(best.time || ''))) best = loc; }
        if (best) { lat = best.latitude; lng = best.longitude; at = best.time || null; }
      } else if (t.provider === 'motive') {
        const r = await fetch('https://api.gomotive.com/v1/vehicle_locations', { headers: { 'X-Api-Key': t.api_token } });
        if (!r.ok) throw new Error('motive ' + r.status);
        const j = await r.json();
        const vs = (j && (j.vehicles || j.vehicle_locations)) || [];
        let best: any = null;
        for (const w of vs) { const v = w.vehicle || w; const loc = v.current_location || v.last_location; if (loc && (!best || String(loc.located_at || '') > String(best.located_at || ''))) best = loc; }
        if (best) { lat = best.lat ?? best.latitude; lng = best.lon ?? best.lng ?? best.longitude; at = best.located_at || null; }
      }
      if (lat == null || lng == null) { continue; }
      const { error: e2 } = await sb.rpc('eld_ingest', { p_token: t.ingest_token, p_lat: lat, p_lng: lng, p_speed: null, p_at: at });
      if (e2) throw new Error(e2.message);
      pushed++;
    } catch (_e) { failed++; }
  }

  // ---- (2) HOS → truck_availability (dispatcher carriers) ----
  let hosPushed = 0, hosFailed = 0, hosUnmatched: string[] = []; const hosErrors: string[] = [];
  try {
    const { data: hosTargets, error: e3 } = await sb.rpc('eld_hos_targets');
    if (e3) throw new Error(e3.message);
    for (const t of (hosTargets as any[]) || []) {
      try {
        const drivers = t.provider === 'samsara' ? await samsaraHos(t.api_token) : t.provider === 'motive' ? await motiveHos(t.api_token) : [];
        if (!drivers.length) { hosErrors.push(t.provider + ': no drivers returned'); continue; }
        const { data: res, error: e4 } = await sb.rpc('eld_hos_ingest', { p_token: t.ingest_token, p_drivers: drivers });
        if (e4) throw new Error(e4.message);
        hosPushed += Number((res as any)?.matched || 0);
        hosUnmatched = hosUnmatched.concat(((res as any)?.unmatched as string[]) || []);
      } catch (e) { hosFailed++; hosErrors.push(t.provider + ': ' + ((e as Error).message || 'error')); }
    }
  } catch (e) { hosErrors.push('targets: ' + ((e as Error).message || 'error')); }

  return new Response(JSON.stringify({ ok: true, targets: ((targets as any[]) || []).length, pushed, failed, hos: { pushed: hosPushed, failed: hosFailed, unmatched: hosUnmatched, errors: hosErrors } }), { headers: { 'content-type': 'application/json' } });
});
