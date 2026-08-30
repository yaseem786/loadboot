# dispatch-live.js — wired in (29 Aug 2026)

`app/shared/dispatch-live.js` shipped dormant on 29 Aug. It is now wired into **both** sides.
Applied by `docs/carrier-outreach-2026-08-29/apply-dispatch-live.py` — idempotent, re-runnable on
any base (each edit skips if its own unique marker is present, and hard-fails if its anchor is
missing rather than silently doing nothing). Re-run it if a parallel session overwrites either file.

## What changed

**`app/agent/dispatcher-workspace.js`** (the sending side, 10 edits)

| point | event sent |
|---|---|
| RC upload succeeds | `rc_uploaded` |
| availability saves | `availability_posted` |
| check call logs | `check_call` |
| message sends | `message` |
| booking logged | `booking_created` |
| tab switch | `setTab()` → presence only |

It also *listens*: `approved` / `rejected` / `message` / `status_change` from anyone else calls the
existing `load()`. The dispatcher's name is pushed into presence after the feed arrives, so the CC
sees "Abdul (bookings)" rather than a bare user id. `dwLive.leave()` runs in the existing
MutationObserver teardown, next to `clearInterval(clockTimer)`.

**`app/command-center/views/dispatchers.js`** (the listening side, 4 edits)

- a presence strip above the queue: `🟢 2 dispatchers online — Abdul (bookings) · Sara (today)`
- any event → `paintQueue()` (the queue is always repainted from `ccDispatcherQueue()`, never from
  the payload — the payload is a hint, not data)
- approve / reject send `approved` / `rejected` back to the dispatcher
- **a 90 s visible-tab fallback poll** — this view had no polling at all before, so realtime is not
  its only refresh path. Do not remove it.

## Rules that must survive later edits

1. **Events are refetch hints, never data.** A dropped socket can then only make the view slower,
   never wrong.
2. **Polling stays.** `dispatch-live.js` no-ops when signed out or when the websocket cannot
   connect (`isLive()` false) — polling is the fallback, in both portals.
3. **Every call is wrapped** (`try { … } catch (_) {}`) so realtime can never break a click.
4. `postgres_changes` is not an option: the `supabase_realtime` publication contains only
   `public.messages`, and the dispatcher tables live in `app_private`. Broadcast + presence on
   channel `dispatch:live` needs no table at all.

## Verified (29 Aug, headless chromium against the real files)

Both modules mount clean with a stubbed supabase client, no page errors. Presence paints and clears
correctly. An `approved` event from another user refetched **only** the queue (`cc_dispatcher_queue`
1 → 2) and the dispatcher feed (`dispatcher_workspace_feed` 1 → 2); the dispatcher list was
untouched. **The sender's own echo caused no refetch.** An unknown event type is dropped, an unknown
send type is dropped. Unmounting both hosts left both channels and cleared both timers.
`node --check` OK on both files; the apply script re-runs to 14/14 "already present".

Nothing here touches the database, an edge function or `build_site.py`.
