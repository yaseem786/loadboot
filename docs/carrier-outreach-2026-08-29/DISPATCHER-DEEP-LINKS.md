# Dispatcher workspace — every button lands on the exact card

30 Aug 2026. One file changed: **`app/agent/dispatcher-workspace.js`**. `app/carrier/app.js` is
**not** touched — the agent shell falls back to `dashboard` for any hash it does not know and has no
`hashchange` listener of its own, so the workspace owns its sub-route by itself. Applied by
`docs/carrier-outreach-2026-08-29/apply-dispatcher-deeplinks.py` (18 idempotent edits; re-run it on
any base if a parallel session overwrites the file).

Same idea as the carrier portal's `#tab/target` (see `DEEP-LINKS.md`), plus the half that matters
day to day: **the Today work-queue rows now open their own subject**, not just their tab.

## The link vocabulary

Base: `https://loadboot.com/app/agent/` (the dispatcher workspace is the agent portal's Dashboard).

| Link | Lands on |
|---|---|
| `#bookings/<booking id>` | **opens that booking's modal** (RC, status buttons, timeline) |
| `#bookings/new` (`/log`, `/add`) | **opens the Log-a-booking form** |
| `#trucks/<truck id>` | scrolls to that truck card + outlines it 3.5 s |
| `#trucks/<truck id>/availability` · `#availability/<truck id>` | **opens that truck's availability form** |
| `#messages/<assignment id>` | opens **that** carrier thread |
| `#board/<assignment id>` | the load board already switched to that carrier |
| `#brokers/new` | **opens the Add-broker form** |
| `#today` · `#board` · `#trucks` · `#bookings` · `#brokers` · `#money` · `#messages` · `#packet` · `#kpis` | that tab |

Aliases accepted: `queue`/`home` → today, `loads`/`search` → board, `fleet`/`truck` → trucks,
`booking`/`rc` → bookings, `thread`/`chat`/`message` → messages, `commission`/`pay` → money,
`docs`/`documents` → packet, `broker` → brokers, `kpi` → kpis.

The shell prefix is optional and ignored: `#dashboard/bookings/<id>` works exactly like
`#bookings/<id>`, so notification URLs can keep pointing at the agent dashboard.

## The Today queue — each row opens its own subject

| Row | Before | Now |
|---|---|---|
| `N unread from <carrier>` | Messages tab | **that** thread |
| `<carrier> has not confirmed you yet` | Messages tab | that carrier's thread |
| `Find a load — <unit>` | Board | Board **already on that carrier** |
| `Availability not set — <unit>` | Trucks tab | that truck, **availability form open** |
| `Daily availability line is due` | Trucks tab | that truck, **availability form open** |
| `Home-time deadline` · `HOS: N h left` · `Truck is MAINTENANCE` | Trucks tab | that truck card, outlined |
| every booking row (RC, approval, check call, POD, exception) | already opened the booking | unchanged |

## Safety properties (all verified in headless Chrome against the real file)

- **An unknown target is ignored.** `#fleet/does-not-exist` lands on Trucks and does nothing else —
  no modal, no form, no console error.
- **An agent-shell tab passes straight through.** `#referral`, `#chain`, `#earnings`, `#payouts`,
  `#verify`, `#settings` are not workspace tabs, so the module leaves them (and the hash) alone.
- **The hash is rewritten to `#dashboard`** with `replaceState` once a target resolves, so Back
  still works and a target can never re-fire on the next render.
- **No file picker is ever auto-clicked** (browsers block it without a real gesture) — the RC upload
  is reached by opening its booking, and the carrier/dispatcher taps the file button.
- `hashchange` is handled, so a second link clicked while the workspace is open re-targets it; the
  listener is removed in the same teardown that stops the clock and leaves the realtime channel.

## Test results (30 Aug, real module + stub client, 0 page errors)

9/9 link cases: `#dashboard/bookings/b1` → booking modal · `#bookings/new` → Log-a-booking ·
`#messages/a1` → that thread · `#trucks/t1/availability` → editor open **and** card outlined
`rgb(8,131,247)` · `#availability/t1` (alias) → same · `#fleet/does-not-exist` → Trucks only ·
`#brokers/new` → Add broker · `#referral` → untouched · `#money` → Money.
6/6 queue rows: unread → thread · find-a-load → that carrier's board · trial → My KPIs ·
awaiting-approval → that booking's modal · availability-not-set → that truck + form ·
maintenance → that truck card outlined.

Screenshot: `dispatch-deeplink-availability.png` (`#trucks/t1/availability`).
