// partners-live.js — the realtime wire from the database to the partner screens (bl_bp_0457).
//
// Unlike dispatch-live.js (portal ↔ CC broadcast), the SENDER here is Postgres: app_private.partners_live()
// calls realtime.send() on the public topic `partners:live` from notify_partner and from row triggers on the
// trust / packet / agreement / organizations tables. The payload is {org_id, type, at, ...} and is ONLY a hint
// to refetch — the CC re-reads cc_partner_360 / cc_partners_accounts, never paints from the payload.
//
// Failure model: if realtime is unreachable every method no-ops and isLive() stays false — the 30 s poll in
// partner360-kit.js and the directory's manual refresh are the fallback and must stay.
import { getClient } from './supabaseClient.js';

const TOPIC = 'partners:live';

export function partnersLiveJoin(onEvent) {
  const state = { ch: null, live: false, closed: false };
  const cb = typeof onEvent === 'function' ? onEvent : () => {};
  (async () => {
    let sb;
    try {
      sb = await getClient();
      const { data } = await sb.auth.getSession();
      if (!(data && data.session) || state.closed) return;          // not signed in → dormant
    } catch (_) { return; }
    try {
      const ch = sb.channel(TOPIC, { config: { broadcast: { self: true } } });
      state.pending = ch;
      ch.on('broadcast', { event: 'partner' }, (msg) => {
        const p = (msg && msg.payload) || {};
        if (!p.org_id) return;
        try { cb(p); } catch (_) {}
      });
      ch.subscribe((status) => {
        if (state.closed) return;
        if (status === 'SUBSCRIBED') { state.ch = ch; state.live = true; }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') state.live = false;
      });
    } catch (_) { /* dormant */ }
  })();
  return {
    isLive: () => !!state.live,
    leave: () => {
      state.closed = true; state.live = false;
      const ch = state.ch || state.pending;
      if (ch) { try { getClient().then((sb) => sb.removeChannel(ch)).catch(() => {}); } catch (_) {} }
      state.ch = null; state.pending = null;
    },
  };
}

// Debounce helper: many rows change in one transaction (approve → packet + org + notice) — refetch once.
export function coalesceEvents(fn, ms) {
  let t = null;
  return () => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; try { fn(); } catch (_) {} }, ms || 400); };
}
