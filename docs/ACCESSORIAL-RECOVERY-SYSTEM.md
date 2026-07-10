# LoadBoot Accessorial Capture → Claim → Recovery → Payout

**A-to-Z design blueprint for auto-collecting detention, layover, lumper, driver assist and TONU — and recovering them from the broker for the carrier.**

Date: 2026-07-08 · Status: design (grounded in the current codebase) · Scope: carrier portal, partner (broker) portal, Command Center, Supabase.

---

## 0. The one principle that makes this work

Every accessorial dies or survives on **one thing: evidence agreed in writing *before* the truck rolls, and captured automatically *while* it rolls.** Industry research is blunt about it:

- "Without timestamps it's your word against theirs" — a **signed detention form / gate log with arrival + departure times** is the single most important detention document.
- A **lumper fee billed without a receipt has a near-zero dispute success rate.**
- The **rate confirmation is the controlling document** — it locks the detention rate, free time, lumper cap, and which accessorials are included/excluded. Anything not in it is a fight the carrier usually loses.
- Most rate cons impose a **48–72h submission window**; miss it and the broker can deny.

LoadBoot's structural advantage: because **every load posts with the full accessorial rate card already agreed in writing** (the work we just shipped in the post-load wizard), the "is this payable?" argument is *pre-settled*. That converts accessorial collection from a negotiation into a **document-assembly + settlement** problem — which is automatable.

So the system is built on four moves, repeated for every accessorial:

1. **Pre-agree** the rate/policy in the rate confirmation (done at post time).
2. **Auto-capture** the trigger + evidence during the trip (GPS stamps, photos, receipts, written approvals).
3. **Auto-assemble** the claim (line item + evidence bundle) and file it inside the platform.
4. **Settle & recover** — pay the carrier and collect from the broker, escalating on a clock if the broker stalls.

---

## 1. What already exists in LoadBoot (do NOT rebuild)

The audit of `migrations/` and `app/shared/api.js` shows most of the spine is already in place:

| Capability | Where it lives today |
|---|---|
| GPS arrive/depart stamps with distance verification | `trip_dwell_events` (`arrived_at`, `departed_at`, `free_minutes`, `stop_type`, GPS `distance_m`) — `bl_trip_0001_gps_checkpoints.sql` |
| **Auto-detention on departure** (dwell − free_minutes) | trigger in `bl_trip_0002_accessorial_proof.sql` |
| Detention warning before free time expires (pg_cron) | `cwb_detention_exceptions.sql` |
| Accessorial line items per trip | `trip_accessorials` (kinds: `detention, lumper, layover, tonu, reconsignment, other`) — `ec2_fleet_0001.sql` |
| Carrier "report issue" with typed kinds | `cur_report_issue_kinds.sql` (`detention, layover, lumper, tonu, breakdown, …`) |
| Carrier requests accessorial + uploads proof | `carrierRequestAccessorial()`, `pocketUploadTripDoc()`, `tripAccessorials()` |
| CC review queue for accessorials | `accessorialQueue()`, `reviewAccessorial(approve/adjust)` |
| Claim lifecycle (broker review → escalate → staff decide) | `partnerClaims()`, `partnerReviewClaim()`, `claimEscalate()`, `supportDecideClaim()`, `claimBundle()` |
| Finance: invoices, settlements, adjustments, disputes, A/R–A/P aging | `fin_invoices`, `fin_settlements`, `fin_adjustments` (kinds incl. `accessorial`, `quickpay_fee`), `partner_invoices`, `openDispute/resolveDispute`, `cwe_finance_lifecycle.sql` |

**Conclusion:** we are not building a claims engine from scratch. We are (a) wiring the five accessorials end-to-end onto this spine, (b) adding the missing *auto-capture* triggers, and (c) adding the *recovery escalation ladder*. Roughly 20% net-new.

---

## 2. The five accessorials — how each is captured, tracked, and evidenced

For each: **Trigger** (what starts it) → **Auto-capture** (what the system records with no human) → **Evidence pack** (what wins the claim) → **Automation target**.

### 2.1 Detention (waiting past free time)
- **Trigger:** truck arrives at a stop, free time (default 2h from the rate card) elapses before release.
- **Auto-capture (mostly built):** driver taps ARRIVE (or geofence auto-stamp) → `trip_dwell_events.arrived_at` + GPS distance. On DEPART the trigger computes `detention_minutes = dwell − free_minutes` and drafts a `trip_accessorials(kind='detention')` line. pg_cron warns the driver 30 min before free time and nudges the broker.
- **Evidence pack:** GPS-stamped arrive+depart, gate-ticket photo, signed in/out on the BOL, and the *notification sent to the broker before free time expired* (screenshot of send-time). This is exactly what research says wins.
- **Automation target:** **geofence auto-stamp** so ARRIVE/DEPART don't depend on the driver tapping; auto-notify broker at free-time expiry; auto-draft the line (already) and auto-attach the evidence bundle.

### 2.2 Layover (overnight hold)
- **Trigger:** a hold crosses into an overnight — detention "cuts over" to a day rate.
- **Auto-capture:** when a dwell event's elapsed time crosses the calendar/overnight boundary (or exceeds the detention cap, default 5h), the system stops accruing hourly detention and drafts `trip_accessorials(kind='layover')` for $250/day, *on top of* detention earned up to the cutover.
- **Evidence pack:** the detention record for the same stop + GPS proving the truck stayed overnight + the written "come back tomorrow" instruction (captured in the in-app thread) + next-day depart stamp.
- **Automation target:** a **cutover rule** in the detention trigger (detention up to cap, then layover/day) so the carrier never has to know the boundary math.

### 2.3 Lumper (with reimbursement)
- **Trigger:** a facility requires third-party dock labor the carrier must pay for.
- **Two clean paths (per rate-card lumper policy):**
  - **Broker pays direct (preferred):** carrier taps "Request lumper advance" → platform issues a **Comchek/EFS advance code** (or routes the request to the broker) *before* unload → $0 ever touches the carrier. Research: a Comchek/EFS receipt clears far faster than a handwritten note.
  - **Reimbursed with receipt:** carrier fronts it, photographs the **lumper receipt at the dock** (amount, facility, date, PO/load ref) via stop-proof upload → drafts `trip_accessorials(kind='lumper')` = receipt amount, reimbursed 100%.
- **Evidence pack:** the **lumper receipt** (non-negotiable), payment proof (Comchek/EFS/card statement line), and the rate-con lumper clause.
- **Automation target:** in-app **advance-code issuance**, OCR the receipt to auto-fill amount, and settle lumper *with the linehaul* instead of a separate 60-day chase.

### 2.4 Driver assist (driver works the dock)
- **Trigger:** the driver physically loads/unloads — either pre-declared on the rate card, or demanded on-site.
- **Auto-capture (carrier and broker never talk directly — LoadBoot Dispatch is the middle layer):** if the rate card pre-declared driver assist (or it happens at the **standard** $75/stop), it is **already authorized by the rate confirmation** — the driver just taps "Report issue → Driver assist", photographs the dock, and the line drafts automatically; no real-time broker contact needed. Only if the carrier needs **above standard** (or a service the rate card excluded) does the request route to **LoadBoot Dispatch**, who clears it with the broker on the LoadBoot-to-broker channel within a response clock. Drafts `trip_accessorials`.
- **Evidence pack:** the rate-card clause OR the in-app written approval, a timestamped before/after dock photo, and BOL notation "driver assist / driver unload" signed by the facility.
- **Automation target:** the **approval-gate** (no approval → no claim, and the app says so), plus photo capture bound to the trip.

### 2.5 TONU (Truck Ordered, Not Used)
- **Trigger:** a confirmed, dispatched load cancels late (or the truck arrives and there is no freight).
- **Auto-capture:** the broker-cancel action (or carrier "Report issue → TONU") **snapshots** the signed rate con + dispatch time + the carrier's GPS position/deadhead already driven + the cancellation timestamp, and drafts `trip_accessorials(kind='tonu')` = posted TONU (default $250) + optional deadhead × per-mile.
- **Evidence pack:** the signed rate con with the TONU clause, proof of dispatch (LoadBoot trip record), GPS deadhead trail, and the written cancellation.
- **Automation target:** **auto-generate the TONU line the instant a confirmed load is cancelled**, with the evidence snapshot attached — no carrier action required.

### 2.6 "Extra services the broker/facility added that weren't on the load"
This is the case you asked about directly: at the dock, a service appears that **wasn't in the original posting** (surprise lumper, surprise driver unload, an unplanned extra stop, a reconsignment/redelivery). The rule:

- **Carrier and broker are disintermediated** — the carrier never phones the broker at the dock. Authorization comes from one of two places:
  - **Pre-authorized (default, ~95%):** the rate card already set this load's standard rate/policy for lumper, driver assist, detention, layover and TONU at posting. A dock-added service **at standard** is therefore already approved — the carrier taps "Report issue → add accessorial", attaches the receipt/photo, and it becomes a billable line with **no real-time contact**.
  - **Above-standard or excluded service:** the request routes to **LoadBoot Dispatch** (not the broker directly). LoadBoot clears it with the broker on the LoadBoot-to-broker channel and returns an approve / counter / auto-decision within a response clock — same pattern as the emergency-reschedule policy.
- Either way it lands as a normal `trip_accessorials` line with the same evidence → claim → recovery path. The *authorization record* (the rate card, or the LoadBoot Dispatch decision) is the contract basis — so the carrier is protected even though the service was not on the original posting, without ever contacting the broker directly.
- `reconsignment` and `redelivery` (extra stop / re-route the broker imposes) already exist as accessorial kinds and follow the identical flow.

**Net:** whether an accessorial was pre-agreed on the rate card or bolted on at the dock, it lands in the *same* `trip_accessorials` → claim → settlement pipe. The only difference is *where the "agreed amount" comes from* — the rate card, or the in-app approval thread.

---

## 3. The documents a carrier must have to claim (per accessorial)

From the research, the winning evidence set — all of which LoadBoot can capture automatically:

| Accessorial | Must-have documents |
|---|---|
| **All** | Signed **rate confirmation** with the accessorial clause (the controlling doc) |
| Detention | GPS arrive **and** depart stamps; gate-ticket photo; **signed in/out times on the BOL**; the pre-expiry notification to the broker (with send-time) |
| Layover | Same-stop detention record; overnight GPS presence; written "next-day" instruction; next-day depart stamp |
| Lumper | **Lumper receipt** (amount, facility, date, load/PO ref) — non-negotiable; Comchek/EFS or card payment proof |
| Driver assist | Rate-card clause **or** in-app written approval + rate; timestamped dock photo; BOL "driver assist" notation |
| TONU | Signed rate con w/ TONU clause; dispatch proof; GPS deadhead trail; written cancellation w/ timestamp |
| Clean **POD** | Signed proof of delivery — required for the whole invoice, including accessorials |

LoadBoot's job is to make **each of these collect itself**: GPS stamps from the ELD/app, photos via stop-proof upload, the notification/approval from the in-app thread, and the rate con from the booking record. The carrier should end the trip already holding a complete, timestamped evidence bundle.

---

## 4. The A-to-Z lifecycle (post → payout), with automation at each step

```
POST ──► BOOK ──► DISPATCH ──► IN-TRANSIT ──► EVENT ──► EVIDENCE ──► CLAIM ──► REVIEW ──► RECOVERY ──► PAYOUT
```

1. **Post (broker):** rate card with every accessorial rate/policy pre-agreed in writing (built). Broker ticks/agrees standard terms; can offer above, never below.
2. **Book (carrier):** carrier accepts → signed rate con auto-generated → terms locked → evidence rules attach to the trip.
3. **Dispatch:** trip record created; free-time clocks, geofences and the TONU snapshot baseline are armed.
4. **In-transit:** live GPS; geofence auto-stamps ARRIVE at each stop; free-time countdown starts; driver gets a 30-min warning; broker auto-notified at expiry.
5. **Event:** detention accrues / layover cuts over / lumper paid / driver assist approved / load cancels (TONU). Each drafts a `trip_accessorials` line automatically.
6. **Evidence:** system binds GPS stamps + photos + receipts + approval thread to the trip and **auto-assembles the evidence bundle** (the accessorial-proof RPC already builds the dwell portion).
7. **Claim:** on delivery + POD, the platform **auto-builds the invoice** = linehaul + all billable accessorials, files it as a claim (`partnerClaims`), and starts the response clock.
8. **Review (broker):** broker sees the pre-agreed line + evidence and approves in one tap (`partnerReviewClaim`). Because it was pre-agreed, "approve" is the default path.
9. **Recovery (if broker stalls):** the escalation ladder (Section 5) runs on a clock — nudge → dispute → bond claim packet → small-claims packet.
10. **Payout (carrier):** carrier is paid via settlement (`fin_settlements`), optionally **QuickPay** (2.5% same-day ACH) or advance (4% Comchek within the hour). LoadBoot collects from the broker via `partner_invoices`.

**"Auto as much as possible" means:** steps 4–7 need *zero* carrier action in the happy path (geofence + triggers + auto-invoice), and step 8 is one broker tap. Human review only appears for exceptions (missing evidence, disputed amount, fraud sensors).

---

## 5. Recovery ladder — how the money actually comes back from the broker

LoadBoot settles *through the platform*, so the normal path is short. The ladder exists for the minority of stalling brokers (research-backed):

1. **Platform settlement (T+0 to T+days):** accessorial rides the linehaul settlement; LoadBoot bills the broker via `partner_invoices`. Most cases end here.
2. **Auto-nudge (broker AP):** if the broker invoice ages past terms, automated reminders on a clock (the finance lifecycle already tracks A/R aging).
3. **Formal dispute (in-platform):** `openDispute` / `resolveDispute` with the evidence bundle attached; staff decision via `supportDecideClaim`.
4. **BMC-84 surety-bond claim:** if the broker won't pay, LoadBoot assembles the **bond-claim packet** — look up the broker's MC/DOT on FMCSA SAFER → find the surety → submit rate con + clean POD + invoices + demand letters. (File within ~90 days; sureties investigate 30–90 days; the $75k bond is a *shared pool*, so timeliness matters.)
5. **Small claims / civil action:** after the bond is exhausted, the same evidence bundle supports a civil filing.

The point: because LoadBoot already holds a *complete, timestamped, pre-agreed* evidence bundle, escalation packets (steps 4–5) can be **generated with one click** instead of reconstructed months later. That is the differentiator.

---

## 6. What's missing today → the build plan (phased)

Grounded in the existing spine, here is the net-new work, ordered by leverage.

### Phase 0 — wire the five accessorials end-to-end (mostly plumbing)
- Ensure `carrierRequestAccessorial` + report-issue kinds map cleanly to `trip_accessorials` kinds for **all five** (detention/layover/lumper/driver-assist/tonu) and that each drafts a reviewable line with its evidence.
- Auto-build the delivery invoice = linehaul + billable accessorials on POD; file as a claim; start the response clock.
- Surface a **carrier "Claims" tab** and broker "Claims to review" tab reading `partnerClaims()` (endpoints exist).

### Phase 1 — auto-capture (kill the manual taps)
- **Geofence auto-stamp** ARRIVE/DEPART from live GPS (fallback to manual tap). This makes detention/layover self-documenting.
- **Detention→layover cutover rule** in the departure trigger (hourly to cap, then day rate).
- **TONU auto-snapshot** on broker cancel of a confirmed load (rate con + dispatch time + GPS deadhead + cancel timestamp → drafted line).
- **Driver-assist approval gate**: block the claim unless a written broker approval exists in the thread (or the rate card pre-declared it).

### Phase 2 — money movement
- **Lumper advance issuance** (Comchek/EFS or broker-routed request) *before* unload; OCR the receipt to auto-fill amount.
- **QuickPay / Advance** payout options for the carrier (2.5% ACH / 4% Comchek), booked as `fin_adjustments(kind='quickpay_fee')` (kind already exists).
- Settle accessorials *with* the linehaul, not as a separate 60-day chase.

### Phase 3 — recovery automation
- **Aging clock + auto-nudge** on unpaid broker accessorial invoices.
- **One-click BMC-84 bond-claim packet** (pull MC/DOT + surety, assemble rate con + POD + invoices + demand letter).
- **One-click small-claims packet** from the same bundle.
- **Facility & broker scorecards** (detention frequency, pay-on-time %) surfaced to carriers — a data moat that also pressures bad actors.

### Data-model additions (small)
- Add `driver_assist` (and keep `reconsignment`/`redelivery`) explicitly to the `trip_accessorials` kind check, or map driver-assist to `other` with a subtype.
- A `claims` view/state machine if not already distinct from `trip_accessorials` (states: `drafted → filed → broker_review → approved|disputed → escalated → paid`), plus `response_due_at` for the clock.
- `accessorial_evidence` links (dwell events, photos, receipts, approval message ids) if not already unified by the accessorial-proof RPC.

---

## 7. Fraud & edge-case controls (so "auto" stays trustworthy)

- **On-time gate:** detention only counts from an *on-time* arrival inside the appointment/FCFS window (research + our FCFS policy).
- **GPS continuity:** a "breakdown"/"waiting" claim with a *moving* GPS trail fails the sensor (already the pattern in the emergency-reschedule policy).
- **Receipt/photo EXIF:** lumper receipt and dock photos checked for matching time/location.
- **No-approval-no-claim** for driver assist and dock-added services.
- **Submission window:** auto-file on POD so the 48–72h window is never missed.
- **Detention vs layover, not both for the same hours** at the same stop (industry rule; enforce in the cutover logic).

---

## 8. TL;DR for implementation

1. **The rate card already pre-agrees every accessorial in writing** — that's 80% of the collection problem solved at post time.
2. **The capture spine already exists** (GPS dwell stamps, auto-detention trigger, `trip_accessorials`, accessorial queue, claims, settlements). Build *onto* it.
3. **Make capture automatic** (geofence stamps, cutover rule, TONU snapshot, approval gate) so the happy path needs zero carrier action.
4. **Auto-assemble the claim on POD**, one-tap broker approval, and **settle through the platform** with QuickPay to the carrier.
5. **Escalate on a clock** — nudge → dispute → one-click BMC-84 bond packet → small-claims packet — using the bundle you already hold.

Do Phase 0–1 first; that alone turns detention/TONU/layover into hands-free, evidence-backed line items. Phases 2–3 turn LoadBoot into the thing brokers can't stall and carriers never have to chase.

---

## Sources

- Geofence detention automation: [CXTMS — geofencing 2026](https://cxtms.com/blog/geofencing-fleet-management-location-based-automation-logistics-workflows-2026), [Teletrac Navman — trailer tracking & detention](https://www.teletracnavman.com/fleet-management-software/trailer-tracking/resources/how-gps-trailer-tracking-can-help-you-manage-detention-costs), [DataDocks — detention disputes](https://datadocks.com/posts/truck-detention-accessorial-fees)
- Claim documentation & rate-con: [Laneproof — 4 documents that win disputes](https://www.laneproof.com/blog/billing-disputes-freight-documents-that-win), [Laneproof — rate confirmation fields](https://www.laneproof.com/blog/rate-confirmation-template-free), [Truckstop — accessorial charges](https://truckstop.com/blog/accessorial-charges/)
- Lumper reimbursement & advances: [Laneproof — lumper who pays/documentation](https://www.laneproof.com/blog/lumper-fee-explained-who-pays-documentation-reimbursement), [RoadSync — Comchek](https://roadsync.com/comchek/), [RXO — carrier payment options](https://rxo.com/carriers/carrier-payment-options/), [FreightWaves — Convoy lumper payment](https://www.freightwaves.com/news/convoy-removes-debate-over-lumper-fees-with-payment-option)
- Broker recovery (bond/small claims): [AW&A — filing on a broker's bond](https://awcollects.com/how-to-file-on-a-brokers-bond/), [Freight Collection Solutions — BMC-84 process](https://freightcollectionsolutions.com/filing-a-freight-broker-bond-claim-a-step-by-step-guide/)
