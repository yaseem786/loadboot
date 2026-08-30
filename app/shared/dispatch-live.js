// dispatch-live.js — the realtime wire between the dispatcher portal and the Command Center.
// New shared module, 29 Aug 2026 (dispatchers-redesign). Nothing imports it yet; it is safe to
// ship dormant and wire one side at a time.
//
// WHY BROADCAST + PRESENCE, NOT postgres_changes: the dispatcher tables live in app_private,
// which is not in the supabase_realtime publication (only public.messages is — checked on prod
// 29 Aug). Exposing app_private to the replication stream would fight the RLS design for one
// feature. Broadcast channels need no table at all: both portals already share the same
// authenticated supabase-js client, the workspace announces what it just did, the CC repaints
// that one row. The database stays the source of truth — every event here is a HINT to refetch,
// never the data itself, so a dropped socket can never show wrong numbers, only slower ones.
//
// Contract (both sides):
//   join({ role:'dispatcher'|'cc', name, tab, onEvent, onPresence }) → handle
//   handle.send(type, payload)   fire-and-forget; types below
//   handle.setTab(tab)           updates presence (CC shows "online, Bookings tab")
//   handle.leave()
//   Event types: rc_uploaded | availability_posted | check_call | message | status_change
//                | booking_created | approved | rejected
//
// Failure model: if realtime is unreachable (old browser, blocked websocket, supabase outage)
// every method quietly no-ops and isLive() stays false — the existing polling paths are the
// fallback and MUST NOT be removed when wiring this in.

import { getClient } from './supabaseClient.js';

const CHANNEL = 'dispatch:live';
const EVENT_TYPES = ['rc_uploaded', 'availability_posted', 'check_call', 'message',
  'status_change', 'booking_created', 'approved', 'rejected'];

export function dispatchLiveJoin(opts) {
  const o = opts || {};
  const state = { ch: null, live: false, tab: o.tab || null, closed: false };
  const noop = () => {};
  const onEvent = typeof o.onEvent === 'function' ? o.onEvent : noop;
  const onPresence = typeof o.onPresence === 'function' ? o.onPresence : noop;

  (async () => {
    let sb, uid;
    try {
      sb = await getClient();
      const { data } = await sb.auth.getSession();
      uid = data && data.session && data.session.user && data.session.user.id;
      if (!uid || state.closed) return;                 // not signed in → stay dormant
    } catch (_) { return; }
    try {
      const ch = sb.channel(CHANNEL, { config: { presence: { key: uid } } });
      ch.on('broadcast', { event: 'dispatch' }, (msg) => {
        const p = (msg && msg.payload) || {};
        // Never act on our own echo, and never trust the payload as data — it is a refetch hint.
        if (p.from === uid) return;
        if (EVENT_TYPES.indexOf(p.type) < 0) return;
        try { onEvent(p); } catch (_) {}
      });
      const pushPresence = () => {
        try {
          const ps = ch.presenceState();
          const out = [];
          Object.keys(ps).forEach((k) => { const m = ps[k] && ps[k][0]; if (m) out.push({ user_id: k, role: m.role, name: m.name, tab: m.tab, at: m.at }); });
          onPresence(out);
        } catch (_) {}
      };
      ch.on('presence', { event: 'sync' }, pushPresence);
      ch.on('presence', { event: 'join' }, pushPresence);
      ch.on('presence', { event: 'leave' }, pushPresence);
      ch.subscribe(async (status) => {
        if (state.closed) { try { sb.removeChannel(ch); } catch (_) {} return; }
        if (status === 'SUBSCRIBED') {
          state.ch = ch; state.live = true;
          try { await ch.track({ role: o.role || 'cc', name: o.name || '', tab: state.tab, at: new Date().toISOString() }); } catch (_) {}
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          state.live = false;                            // polling carries on; supabase-js retries
        }
      });
    } catch (_) { /* dormant */ }
  })();

  return {
    isLive: () => state.live,
    send: (type, payload) => {
      if (!state.ch || !state.live || EVENT_TYPES.indexOf(type) < 0) return;
      (async () => {
        try {
          const sb = await getClient();
          const { data } = await sb.auth.getSession();
          const uid = data && data.session && data.session.user && data.session.user.id;
          state.ch.send({ type: 'broadcast', event: 'dispatch',
            payload: Object.assign({}, payload || {}, { type: type, from: uid, at: new Date().toISOString() }) });
        } catch (_) {}
      })();
    },
    setTab: (tab) => {
      state.tab = tab;
      if (state.ch && state.live) { state.ch.track({ role: o.role || 'cc', name: o.name || '', tab: tab, at: new Date().toISOString() }).catch(() => {}); }
    },
    leave: () => {
      state.closed = true; state.live = false;
      if (state.ch) { (async () => { try { const sb = await getClient(); sb.removeChannel(state.ch); } catch (_) {} })(); state.ch = null; }
    },
  };
}

// ── Wiring (one line each side; polling stays) ─────────────────────────────────
// dispatcher-workspace.js:
//   const live = dispatchLiveJoin({ role:'dispatcher', name: myName, tab:'today',
//     onEvent: (e) => { if (e.type==='approved'||e.type==='rejected'||e.type==='message') refreshFeed(); } });
//   after an RC upload succeeds:        live.send('rc_uploaded', { booking: b.id, lane: b.lane });
//   after availability saves:           live.send('availability_posted', {});
//   after a check call logs:            live.send('check_call', { booking: b.id });
//   after a message sends:              live.send('message', { assignment: a.id });
//   on tab switch:                      live.setTab(tabId);
// command-center/views/dispatchers.js:
//   const live = dispatchLiveJoin({ role:'cc', name:'Command Center',
//     onEvent: (e) => { paintQueue(); },              // every event is just "refetch now"
//     onPresence: (list) => paintPresence(list) });   // who is online + which tab
//   after approve/reject:               live.send('approved'|'rejected', { booking: b.id });
