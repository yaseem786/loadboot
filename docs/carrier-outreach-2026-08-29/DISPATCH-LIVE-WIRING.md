# Dispatch Command — live wiring (bl_disp_0307)

29 Aug 2026. The approved preview (`dispatchers-live-redesign.html`) is now the real CC view, and
`app/shared/dispatch-live.js` is no longer dormant: both portals are on channel `dispatch:live`.

**Frontend only. No migration, no RPC change, nothing deployed by this work.**

## What changed

### Command Center — `app/command-center/views/dispatchers.js`
Applied by `docs/carrier-outreach-2026-08-29/apply-dispatchers-live.py` (7 guarded edits, idempotent).

- **Command bar** — ticking US-Eastern clock, `LIVE · dispatch:live` / `POLLING · realtime offline`
  pill that tells the truth about the socket, and presence avatars ("2 dispatchers online",
  hover shows which tab each one is in).
- **7-cell triage strip** — RC to approve · Awaiting RC · Moving · Stale > 4 h · Unread ·
  To pay out ($) · Trial ends ≤ 3 d. Each cell is a filter over the list underneath.
  *Stale > 4 h* is derived from `moving[].last_touch_min`; the money figures come from
  `cc_dispatcher_commission_list(null)` — no new backend.
- **Premium RC rows** — lane, dispatcher → carrier → broker, gross + $/mi, a **ticking**
  countdown to pickup and a **ticking** waiting timer, risk flags in their own column
  (below floor / no RC file / no driver on truck / SLA / pickup in <6 h), then View RC ·
  Approve · Open. **Approve stays disabled until an RC file exists** — the rule the old card
  already enforced, now visible before the click.
- **Live wire rail** — the last 9 events with their age, fed by the broadcast channel.
- **Roster rows** now carry what each dispatcher is owed (`$412 to pay`).

Every approval guard from bl_disp_0300 is untouched: below-floor still asks for a written reason,
overlap still needs "override", approval still goes through `ccDispatcherBookingDecide`.

### Dispatcher portal — `app/agent/dispatcher-workspace.js` — ALREADY DONE, not touched here
The parallel session wired the dispatcher side the same day (`dwLive`, sends after availability /
RC / check call / booking / message, `setTab`, leave-on-unmount, and an inbound
`approved|rejected|message|status_change` → `load()`). A patch written here was **discarded rather
than applied** once a fresh stage showed their work on disk — never stack a second
`dispatchLiveJoin` on the same view. What the CC now hears:

| the dispatcher does | the CC hears |
|---|---|
| uploads an RC | `rc_uploaded` |
| saves availability | `availability_posted` |
| logs a check call | `check_call` |
| sends a message | `message` |
| logs a booking | `booking_created` |
| status / ETA / exception | `status_change` |

## The rule that must survive every future edit
**Every event is a refetch HINT, never data.** The database stays the source of truth, and the
polling paths (the CC's 90 s visible-tab poll, and the workspace's own loops) are the fallback — a dropped socket
must only make the view slower, never wrong. Do not remove the polling.

## Verified
- **Collision check first**: the copy staged at the start of the session was already stale — the
  device file had grown by 1.7 KB (their realtime wiring). The script was rewritten to MERGE onto
  that wiring and re-run on the fresh copy; the file now contains exactly ONE `dispatchLiveJoin`
  call and their `ccPoll` / `ccLive.send('approved'|'rejected')` are intact.
- `node --check`; the apply script re-runs clean (idempotent) on an already-patched copy.
- Real Chromium render of the CC view against stubbed RPCs at 1440 / 1280 / 900 px: no page
  errors, no horizontal overflow, triage cells clickable at every width, countdown and waiting
  timers actually tick, a broadcast event lands in the Live wire, and the header's
  connected/offline label follows the socket.
- Diff against the parallel session's bl_disp_0300 base: only the old `paintQueue` body and nine anchor
  lines were replaced. Terms, assign/SOP, payout dialog and deep links are untouched.

## Not done here
Availability freshness (due 06:00 ET), check-call SLA and broker-setup completeness **per
dispatcher** are in the preview's workforce table but are not in `cc_dispatchers_list`. They need
one new read-only RPC (`cc_dispatcher_team_kpis`) — staging first, then prod. Owed $ is already
live because the commission list carries it.
