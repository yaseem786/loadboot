# LoadBoot Evidence Strategy — load posted → trip end, every minute accounted for
(bl_claims_0041–0045 · staging + prod · 2026-07-07)

## The chain of custody (what exists TODAY)
| Stage | Auto-recorded evidence |
|---|---|
| Broker posts load | load row: rate, appointment times, pickup coords, rate-card terms (detention/layover/TONU/lumper), audit entry |
| Carrier books | booking audit; trip created with scheduled times + stop coordinates copied; 8-doc checklist |
| Trip starts | started_at + GPS tracking on (Start is GPS-gated) |
| En route | live lat/lng pings (last_lat/lng), status can ONLY change via GPS |
| Arrive stop | geofenced (≤800 m) arrive stamp + GPS fix + distance-to-pin; appointment vs actual computed |
| At dock | dwell clock runs; driver photographs facility-SIGNED BOL/POD (in/out times), lumper receipt, gate ticket → cc_pocket_upload_trip_doc |
| Depart stop | geofenced depart stamp → held/free/detention minutes computed; >free auto-drafts a detention claim |
| Cancelled | audit cancellation trail (who/when) → auto-TONU |
| Delivered | GPS delivery dwell required; POD upload |
| Claim filed | evidence snapshot + broker instantly notified; live bundle assembles ALL of the above + narrative timeline |

## Per-kind strategy — how each claim is proven, and how lying is blocked
**DETENTION** — Proof: on-time arrival vs appointment (timeline says "ON TIME — any wait after this is on the facility"), geofenced arrive→depart duration, facility-signed BOL with in/out times matching GPS. Anti-fraud: stamps are server-created only inside the 800 m geofence; driver can't check in from the highway; times on paper must match GPS or support rejects; FCFS loads state no appointment (weaker claim, rate card governs).
**LAYOVER** — Proof: overnight continuous dwell inside geofence (arrive day 1, depart day 2) + timeline + signed paperwork dated next day. Anti-fraud: if the truck left the geofence at night, dwell breaks — no continuous-dwell, no layover.
**LUMPER** — Proof: receipt photographed AT the dock (upload timestamp during dwell window) + facility name matching stop. Anti-fraud: reimbursement is receipt-amount only; no receipt → auto-reject guidance; receipt uploaded outside dwell window is flagged.
**DRIVER ASSIST** — Proof: noted on signed BOL ("driver unload/assist") + dwell shows loading-length stay + optional dock photo. Anti-fraud: needs facility's signature on the notation; GPS confirms presence for the claimed duration.
**TONU** — Proof: cancellation trail from audit (who cancelled, at what status, when) + truck already committed/en route or GPS-present at pickup. Anti-fraud: cancellation initiated by carrier ≠ TONU; timeline exposes whether dispatch preceded cancellation.

## Why the broker agrees (or support ends it)
1. The bundle is the SAME for all three parties — timeline in plain words, dual-pin map links (truck fix vs facility), signed paper, receipts, rate card agreed at booking.
2. Statement of method on every report: stamps are platform-generated, geofenced, uneditable by either side.
3. If the broker still disputes → either side escalates → support verdict (GPS-cited, final) → refusal = strikes/pause. The economics: arguing with a geofence log + the facility's own signature is a losing game.

## Next hardening (roadmap)
- Dwell breadcrumbs: 5-min GPS pings while checked-in → proves continuous presence (layover/detention airtight).
- Certified copies: signed URLs for stop documents in the partner portal (today: metadata + support-certified copy).
- OCR the signed BOL in/out times and auto-compare with GPS stamps.
- Facility scorecard: chronic-detention facilities flagged to carriers pre-booking.
