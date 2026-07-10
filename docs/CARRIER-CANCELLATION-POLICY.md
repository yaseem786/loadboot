# LoadBoot Carrier Cancellation Policy

**Date:** 2026-07-08 · **Status:** implemented on staging (migration `wave-driver/wd_0010`) · pending production.

## The principle
A carrier that books a load has **committed a truck**. If they cancel, the load was off the
market and the broker loses time. Fairness runs both ways:
- **Broker cancels late → pays the carrier TONU** (truck ordered, not used).
- **Carrier cancels late → the carrier bears the cost** (reliability + cancellation-rate hit,
  possible re-coverage charge). A carrier cancellation is **never** a TONU — it is the opposite.

The correct axis is **time-to-PICKUP, not how long the load was held.** Booking a load 5 days
out and cancelling 4 hours later (pickup still days away) is low-harm; cancelling 4 hours *before*
pickup is high-harm. This mirrors the industry standard (Uber Freight: free cancel >24h before
pickup; penalty within 24h; emergencies waived).

## The tiers (defaults)

| When they cancel | Tier | Consequence |
|---|---|---|
| **>24h to pickup**, or **booked <60 min ago** | `standard` / `grace` | **Free** — no penalty. Load goes back on the board. |
| **4h–24h to pickup** | `late` | Reliability-score hit + counts toward the 90-day **cancellation rate**. |
| **<4h to pickup** (or pickup already passed) | `very_late` | Heavy reliability hit + cancellation-rate + may restrict premium/direct loads. If the broker re-covers at a higher rate, the **difference may be charged back**. |
| **Verified on-road emergency** (breakdown w/ GPS + proof) | — | **Waived** — use the Emergency-Rescheduling flow (reschedule, no penalty). |

## Cancellation-rate metric (rolling 90 days)
`cancellation_rate = penalized carrier cancels ÷ bookings` over the last 90 days.

| Rate | Standing |
|---|---|
| `< 3%` | **good** |
| `3–8%` | **warning** (some premium/direct loads restricted) |
| `> 8%` | **restricted** (blocked from premium/direct booking until it recovers) |

Grace/standard (no-penalty) cancellations do **not** count against the rate.

## Implementation (staging)
- `app_private.trip_cancel_tier(trip)` — computes tier + message from `scheduled_pickup` and booking time.
- `cc_cancel_preview(trip)` — carrier UI calls this **before** confirming, to show a tier-aware,
  colour-coded warning (green = free, amber = late, red = very late) instead of a raw browser alert.
- `cc_pocket_cancel_trip(trip, reason)` — stores `cancel_tier`, `cancel_at`, `cancel_no_penalty`;
  puts the load back on the board (`available`); notifies broker + dispatch; returns the tier + a
  clear note. Carrier cancellations never auto-create a TONU (guarded in `trg_auto_tonu`).
- `cc_my_cancellation_rate()` — the carrier's 90-day rate + standing (for Account Health / gating).

## Still to wire (phase 2)
- Scale the **Account-Health reliability score** by tier (currently a flat cancellation count).
- Surface **cancellation rate + standing** on the carrier dashboard and in the broker directory.
- **Re-coverage charge-back** for `very_late` (track the broker's re-cover cost delta → adjustment).

## Sources
- [Uber Freight — carrier cancellation policy](https://help.uber.com/freight/carrier/article/carrier-performance---cancellation-policy?nodeId=280175c7-aa18-4091-8b90-ebd8b9e3e646)
- [Uber — acceptance & cancellation rates](https://www.uber.com/us/en/blog/understanding-acceptance-and-cancellation-rates/)
- [ATS — holding carriers accountable for fall-off](https://www.atsinc.com/blog/freight-broker-fall-through-hold-accountable)
- [Uber Freight shipping FAQ — 24h window / TONU](https://www.uberfreight.com/uber-freight-shipping-faq/)
