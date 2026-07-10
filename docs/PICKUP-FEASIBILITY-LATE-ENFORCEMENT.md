# LoadBoot — Pickup Feasibility & Late-Pickup Enforcement (draft spec)

**Date:** 2026-07-09 · **Status:** design draft (shaping the owner's requirement) · builds on existing primitives.

## The problem
A broker posts a load; a carrier books it. But booking ≠ delivering. Example: pickup is in **10h**,
the driver is parked **8h away**, and 3–3.5h after booking the driver **still hasn't started rolling**.
The pickup is now physically impossible, yet the broker is blindly waiting, thinking the truck is coming.

We want LoadBoot to, in **real time**:
1. **Estimate feasibility** from the truck's current location (solo vs team ETA + HOS) at booking.
2. **Detect that the truck isn't moving** toward pickup and start a **late timer** the carrier *and* broker both see.
3. Give the broker a **time-bound decision** (wait or cancel) when pickup is at risk.
4. **Auto-decide fault** so a **carrier-caused** late cancellation earns the carrier **no TONU** — while a
   broker cancelling an on-track carrier still owes TONU.

## The principle (industry-confirmed)
A **late or no-show carrier does NOT qualify for TONU** — "showing up late… they lose the right to claim a
TONU fee." The broker's decision (wait vs cancel-without-pay) hinges on evidence: *was the carrier on time to
the window? did the driver actually attempt pickup, from location + time?* Fault follows the facts:
carrier's own lateness → carrier eats it; broker cancelling a ready/on-track truck → carrier gets TONU.

## Three real-time engines

### A) Feasibility — shown BEFORE booking on the card, then re-checked at booking

**A0) On every load-board / request CARD (the decision helper — the most important piece):**
Right next to the deadhead miles the board already shows, add a **time-to-pickup + feasibility badge**,
computed from the driver's current GPS → pickup (OSRM ETA + HOS; team = nonstop):
- 🟢 *"~8h to pickup · you'll make the 5:00 PM appt"* — safe to book.
- 🟠 *"~8h to pickup · appt in 9h — leave within ~1h"* — tight, book only if you can roll now.
- 🔴 *"~8h to pickup · appt in 4h — you'd be LATE, don't take this"* — discourage / block booking.

This lets the driver decide **instantly, before committing**: *"I can only reach in 8h but the appointment is
in 4h — I should NOT take this load."* No surprise lateness, no fall-off, no wasted broker wait. The board
already streams the driver's live GPS for real deadhead, so the only addition is the **ETA (time)** and the
**badge that compares ETA vs the pickup appointment/window**. (Team-driver ETA shown when the carrier runs teams.)

**A1) At booking (the final gate):** the same check re-runs at the moment of booking — a 🔴 impossible result
warns hard or blocks; a 🟠 tight result asks for confirmation. Last guard before commitment.

For **FCFS** cards the badge compares ETA to the **window end** (e.g., *"~8h to pickup · FCFS window closes in
12h — fine"*), not a fixed time.

### B) Movement tracking — after booking (the "is the truck moving?" engine)
- The carrier's **live location** streams to the trip (already supported).
- Compute **`must_depart_by` = pickup_time − (ETA_to_pickup + safety buffer)** — the latest moment the driver
  can start and still make the window.
- **AT RISK** when: `now > must_depart_by` **AND** the truck is still at/near origin (distance-to-pickup not
  shrinking, no dwell/started_at). The stationary GPS trail is the proof.

### C) Late timer + dual alerts (extends today's "PICKUP OVERDUE BY")
| State | Carrier sees | Broker sees |
|---|---|---|
| **At risk** (past `must_depart_by`, not moving) | ⏱ *"Roll now — you must depart to make pickup."* | ⚠ *"Carrier hasn't departed — pickup at risk."* |
| **Late** (pickup time passed, or ETA now > pickup + grace) | 🔴 *"You are LATE to pickup."* | 🔴 *"Driver still not moving — your pickup is late. Decide: wait or cancel."* |

## Broker decision window (real-time, time-bound)
When a load goes **Late**, the broker gets a **specific-time decision** (same pattern as the Emergency-
Rescheduling 2-hour clock, mediated by LoadBoot Dispatch — broker & carrier never talk directly):
- **Wait / extend** — give the carrier a new must-arrive time.
- **Cancel** — release the load; it goes back on the board.
- A visible **response clock** (default configurable, e.g., 2h or until pickup + N) so the load never hangs.

## Auto fault-decision → who pays (the "deduct/resolve" logic)
At the moment of cancellation the system reads the **GPS movement evidence** and classifies:

- **Carrier at fault (late/no-show):** truck **stayed at origin** past `must_depart_by`, or ETA became
  impossible, or never started. → **NO TONU.** It's logged as a **carrier late-pickup / no-show event** that
  hits the carrier's **reliability score + cancellation rate** (ties into the Carrier-Cancellation Policy).
- **Carrier on track:** truck **was moving toward pickup** and on time for the window when the broker
  cancelled. → **TONU applies** (broker/shipper choice; carrier is paid, evidence-backed).
- **Verified emergency** (breakdown en route, GPS + proof): → Emergency-Rescheduling flow, **no penalty**.

The decision is **automatic from the evidence**, with LoadBoot Dispatch able to override on appeal. This is
the same "evidence-first, pre-agreed" model as the accessorial engine — fault isn't argued, it's *measured*.

## FCFS exception (important)
The strict appointment logic above is for **appointment pickups**. For **FCFS** loads there is no exact time,
only a **window**:
- "Late" / "at risk" is measured against the **window END**, not a point time.
- The carrier just needs to **check in within the window**; `must_depart_by` uses the window end.
- Consequences are softer (they can arrive any time inside the window). No "you're late" until the window
  itself is at risk. So: **appointment = strict clock; FCFS = window-based, lenient.**

## What already exists (build onto, don't rebuild)
- **"PICKUP OVERDUE BY" countdown** in the carrier trip card (screenshot) — extend into the At-risk/Late states.
- **Live location** sharing on trips; **`trip_dwell_events`** GPS trail = movement proof.
- **OSRM ETA + HOS math** in the post-load wizard (`w.__drive_hours`, 11h/10h rule, team nonstop) — reuse for
  the feasibility + `must_depart_by` calc.
- **Emergency-Rescheduling 2-hour response clock** — reuse the pattern for the broker's wait/cancel window.
- **Carrier-Cancellation Policy** (`wd_0010`) — the late-pickup/no-show event feeds the same reliability +
  cancellation-rate metric.

## To build (phased)
1. **`must_depart_by` + feasibility** on every appointment trip (compute from live loc + pickup time + HOS).
2. **Movement watcher** (pg_cron / on-location-update): flag At-risk → Late; notify carrier + broker.
3. **Broker wait/cancel decision** RPC + clock; on cancel, **auto fault-classify** (moving vs stationary) →
   TONU or no-TONU + reliability event.
4. **FCFS branch** (window-end based).
5. Dispatch override + appeal.

## Sources
- [FF Dispatch — TONU when loads get cancelled](https://www.dispatchff.com/blog/tonu-loads-cancelled-pay)
- [AW&A — TONU: fees, disputes, who pays](https://awcollects.com/tonu-meaning-in-trucking-fees-disputes-and-how-to-collect/)
- [Indemni — TONU complete guide (carrier fault loses TONU)](https://www.indemni.com/blog/tonu-in-freight-brokerage-the-complete-guide-to-truck-ordered-not-used)
- [Foreigh — TONU standard rates & broker guide](https://foreigh.com/blog/tonu-fees-standard-rates-broker-guide)
