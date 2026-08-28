# LoadBoot — Dispatcher (Agent) Portal Audit
**Date:** 28 Aug 2026 · **Scope:** `app/agent/` → `carrier/app.js` (`agentPortal()`, lines 604–1906), `shared/api.js`, `command-center/views/dispatchers.js` · **Benchmark:** what a dispatcher gets inside Amazon Relay / Uber Freight / a modern TMS (Alvys, Rose Rocket) vs what a LoadBoot dispatcher gets today.

---

## 0. Executive summary

**Today the "dispatcher portal" is a hiring form plus a referral-commission dashboard. A hired dispatcher can do zero dispatch work inside it.**

| What a dispatcher needs to do every day | LoadBoot agent portal today |
|---|---|
| See the carrier's trucks, specs, location, availability | ❌ Sees only an integer (`trucks: 1`) and a read-only SOP string |
| Search loads (internal board + DAT/Truckstop) | ❌ No board at all. External boards: no integration anywhere in the codebase |
| Post the truck | ❌ RPCs exist (`postTruck`, `myTruckPostings`) — not surfaced |
| Book / counter / get rate confirmation | ❌ RPCs exist (`requestBookLoad`, `offerSend`, `myRateConfirmation`) — not surfaced. No RC upload, no RC parsing |
| Talk to the carrier / driver | ❌ Only thread is dispatcher ↔ LoadBoot staff (verification) |
| Check calls, ETA, tracking | ❌ `tripCheckin`, `tripLocations`, `addTripNote` exist — not surfaced |
| Detention / TONU / exceptions | ❌ `detentionScan`, `logException`, `carrierRequestAccessorial` exist — not surfaced |
| POD / BOL / invoice handoff | ❌ `pocketUploadPod`, `createInvoice`, `carrierFactoringPacket` exist — not surfaced |
| See own KPIs and commission statement | ❌ One line: "Latest salary: X" — no ledger, no per-load math |
| Daily task list / work queue | ❌ Not found |

**The good news:** ~45 backend RPCs already exist for every one of these steps (they power the carrier portal and CC). The dispatcher portal needs a **UI layer on top of existing endpoints**, not a new backend. The **only** truly missing backend piece is external load-board integration (DAT/Truckstop), which is a commercial/API question, not a code one.

**Recommendation:** treat the agent portal as a new product — "Dispatcher Workspace" — built as its own module (`app/agent/dispatcher-workspace.js`), mounted when `dispatcherMyStatus().status ∈ {trial, verified, active}`. Leave the application form and referral code untouched (additive rule).

---

## 1. What exists (verified in code)

### 1.1 Routes actually reachable in the agent portal (`AGNAV`, app.js:638)
`dashboard · referral · chain · earnings · payouts · verify · settings`

- **dashboard** (`renderDispatcherHome`, :795) — application form if not hired; otherwise status pill, salary terms, "Your assigned carriers" read-only card (:972–983: carrier name, truck count, SOP: scope/lanes/min_rate/equipment/home_time/rules), "Latest salary" one-liner (:987), static compliance card, static academy.
- **referral / chain / earnings / payouts** — the 1% referral program. Not dispatch.
- **verify** — KYC, tax form, agreement e-sign, payout method, staff message thread (`threadCard9`, :1117).
- **settings** — account.

### 1.2 Dead / unreachable code (worth cleaning, not urgent)
- `dispatch` tab (:1676–1766) — an older duplicate dispatcher console. No nav entry; only reachable from its own submit handler.
- `carriers` tab (:1351, `agentCarrierDirectory` :1428) — full carrier directory with packet-status pills. Unreachable + gated on `feed.own_broker_org`.
- `post` (:1336), `resources` (:1630) — unreachable.
- File comment at :793 says "portal is 100% dispatcher; referral code unwired" — but 4 of 7 live tabs are referral. Comment is wrong.

### 1.3 Staff side (`dispatchers.js`)
- Pipeline: applied → screening → skills_test → trial → verified → active / suspended / rejected (`ccDispatcherDecide`).
- Assign / unassign dispatcher ↔ carrier (`ccDispatcherAssign`, `ccDispatcherUnassign`). "One dedicated dispatcher per carrier."
- Per-carrier SOP editor (`ccDispatcherSop`): scope_type (geography/equipment/commodity/single — FMCSA 88 FR 39371 safe), scope_value, lanes, min_rate, equipment, home_time, rules. Seeds from `ccCarrierPrefs`.
- Salary: set terms (base + per-truck, default PKR), monthly run with **two hand-typed KPIs** (utilization, on_time), ledger draft → approved → paid. "Total pay must stay below 5% revenue" — advisory text, **not enforced**.
- **No** trial task list, trial dates, computed performance, or commission-per-load. `dispatcher_salary_ledger` is monthly salary only — **there is no per-load commission ledger**, which is what the current trial offer (2.5% of gross per delivered load) needs.

### 1.4 Backend RPCs that exist and the dispatcher cannot reach (api.js line numbers)
| Area | RPCs |
|---|---|
| Search / match | `pocketAvailableLoads` 643 · `carrierBestLoads` 129 · `dispatchPlan` 130 · `matchRank` 110 · `loadAdvisor` 125 · `laneRate` · `getLoadDetail` 91 · `ccLoadStops` 338 |
| Truck posting | `postTruck` 157 · `myTruckPostings` 158 · `truckPostingMatches` 159 · `updateTruckPosting` 160 |
| Booking / offers | `requestBookLoad` 645 · `myBookRequests` 654 · `offerSend` 112 · `offerRespond` 115 · `bookingStatus` 118 · `prebookCheck` 190 · `bookRequestCarrierPacket` 180 |
| Rate con / docs | `myRateConfirmation` 193 · `acknowledgeRC` 194 · `rateconDocument` 824 · `dispatchSheet` 191 · `deliveryDocPack` 189 · `pocketUploadTripDoc` 324 |
| Tracking / check calls | `tripCheckin` 121 · `tripArrive` 310 · `tripDepart` 421 · `tripLocations` 818 · `pocketTripTimeline` 756 · `addTripNote` 506 · `tripNotifyParties` 476 |
| Exceptions / accessorials | `detentionScan` 422 · `carrierRequestAccessorial` 313 · `addAccessorial` 798 · `logException` 799 · `reportTripIncident` 1066 · `pocketCancelTrip` 315 |
| POD / money | `pocketUploadPod` 697 · `pocketTripPods` 699 · `createInvoice` 590 · `invoicePrepQueue` 295 · `tripPnl` 647 · `carrierFactoringPacket` 224 · `payTripMarkSent` 227 |
| Prefs | `getDispatchPrefs` 126 · `setDispatchPrefs` 127 · `ccCarrierPrefs` 391 |

Each needs an RLS/permission check that the **assigned dispatcher** (via `dispatcher_assignments`) may call it for **that carrier's org only**. That is the main backend task: a `has_dispatcher_assignment(carrier_org_id)` helper used in the policies of these RPCs.

---

## 2. The benchmark — what "Amazon / Uber standard" actually means for a dispatcher

Amazon Relay and Uber Freight are shipper-side boards, not dispatcher tools, but the dispatcher-facing bar they set is clear:

1. **One screen, one truck, one answer.** Truck card shows: where it is now, when it's empty, what it can haul, home-time deadline, HOS left. Every load result is already filtered by that.
2. **Instant, honest pricing.** Rate shown up front; book or counter in one tap; RC appears in-app within seconds; nobody emails PDFs around.
3. **Status is automatic.** Driver app posts location; dispatcher sees ETA, late-risk, dwell time. Check calls are exceptions, not routine.
4. **Paper is captured at the source.** BOL/POD photo from the driver's phone → attached to the trip → invoice generated → factoring packet built. Dispatcher never chases documents.
5. **Money is transparent.** Per-load: gross, dispatcher cut, carrier net, status (delivered / invoiced / paid). Weekly statement.
6. **Score is visible.** On-time %, acceptance %, loads/week, gross/truck/week — and it drives pay.

LoadBoot already has the backend for 1, 3, 4, 5 and half of 2. It has none of the UI.

---

## 3. Gap list, prioritized

### P0 — needed for the Abdul Rafeh trial (next 2 weeks). Without these the trial runs on WhatsApp + email.
| # | Gap | What to build | Backend |
|---|---|---|---|
| 1 | Dispatcher can't see the truck | **Truck card** in agent dashboard: from `fleet_trucks` for assigned carrier — equipment, dims, payload, liftgate/dock-high, domicile, min_rpm, radius, home_time, insurance limits, driver name/phone. | RLS: assigned dispatcher may `select` on `fleet_trucks` for assigned org |
| 2 | Availability / home-time is a free-text string | **Availability block** on the truck card: `empty_at` (datetime), `empty_location` (city/ZIP), `must_be_home_by` (datetime), `overnight_ok_weekdays`, `overnight_ok_weekends`, HOS remaining (manual entry until ELD). Today this lives in WhatsApp ("back by Thursday", "doesn't stay out weekends"). | New table `truck_availability` or columns on `fleet_trucks`; carrier + dispatcher + staff can write |
| 3 | No booking record | **"Log a booking"** form: broker, MC, rep, lane, pickup/delivery windows, gross rate, RC file upload, notes → creates the trip via existing `requestBookLoad`/`offerSend` path or a new `dispatcher_log_booking` RPC. | New RPC; store RC in `documents` with kind `rate_confirmation` |
| 4 | No per-load commission | **Commission ledger**: on trip `delivered` + invoice created, insert `dispatcher_commission` row = gross × pct (2.5% trial). Dispatcher sees list + running total; staff approves/pays. | New table + trigger; extend `dispatchers.js` salary section |
| 5 | Dispatcher ↔ carrier channel | Reuse `liveChatCore.js` for a **3-way thread per assignment** (carrier, dispatcher, staff) so LoadBoot sees everything. Until built: WhatsApp group with Mike in it. | `agent_messages` extended with `carrier_org_id` |
| 6 | Carrier packet | **"Send carrier packet"** button — existing `bookRequestCarrierPacket` / `requestPacketCopies` with the carrier's MC, W-9, COI, NOA, authority letter, so the dispatcher can set up with a new broker without asking staff. | Permission only |

### P1 — makes the dispatcher self-sufficient (weeks 3–6)
| # | Gap | What to build |
|---|---|---|
| 7 | Internal load board | Surface `pocketAvailableLoads` + `carrierBestLoads` filtered by the assigned truck; book/counter via `requestBookLoad`. Same UI as carrier portal's board, agent-scoped. |
| 8 | Truck posting | Surface `postTruck` / `myTruckPostings` / `truckPostingMatches` — dispatcher posts the truck to LoadBoot's board on the carrier's behalf. |
| 9 | Broker call log | New table `broker_contacts` (broker, MC, rep, phone, email, last call, outcome, lanes, notes). This is the dispatcher's real asset and today it lives in his head. |
| 10 | Check calls + ETA | Trip view with `tripCheckin`, `addTripNote`, `tripLocations` map, `tripArrive`/`tripDepart` buttons. Late-risk flag when ETA > appointment. |
| 11 | Exceptions | Detention timer (`detentionScan`), TONU/layover request (`carrierRequestAccessorial`), incident (`reportTripIncident`) — one "Something went wrong" button per trip. |
| 12 | POD → invoice handoff | Driver uploads POD (carrier portal already does this) → dispatcher sees "POD received → invoice sent → factoring sent → paid" pipeline per load (`pocketTripPods`, `createInvoice`, `carrierFactoringPacket`). |
| 13 | Daily work queue | Auto-generated task list: trucks empty today, loads without check-call in 4 h, RCs not acknowledged, PODs missing >24 h, home-time deadlines in <48 h. |
| 14 | Dispatcher KPIs | Computed from trips, not typed: loads/week, gross/truck/week, avg RPM vs min_rpm, on-time %, deadhead %. Shown to dispatcher and used by `ccDispatcherSalaryRun` instead of the two manual inputs. |

### P2 — competitive parity (quarter)
| # | Gap | Note |
|---|---|---|
| 15 | External board integration (DAT / Truckstop) | Not in codebase. DAT has a partner API (RateView + load search) with a commercial agreement; Truckstop has an API for TMS partners. Realistic path: dispatcher uses **his own DAT login** (Abdul has one) and LoadBoot logs bookings; integrate later once volume justifies the fee. |
| 16 | RC parsing | OCR the uploaded RC → prefill broker, rate, stops, reference numbers. LLM-based parse is cheap and good enough. |
| 17 | HOS / ELD | `api.js:1047` lists "live ELD sync" as not built. Manual HOS field first (P0 #2); Motive/Samsara API later. |
| 18 | Rating loop | Carrier rates dispatcher after each load; broker on-time feeds carrier scorecard (exists) and dispatcher KPI. |
| 19 | Multi-truck / multi-carrier view | Today: one dispatcher per carrier. When a dispatcher has 3+ trucks, needs a board view (all trucks × next 7 days). |
| 20 | Dead-code cleanup | Remove or wire the orphaned `dispatch`, `carriers`, `post`, `resources` tabs; fix comment at :793. |

---

## 4. Compliance notes to keep while building
- Dispatcher books **under the carrier's authority** and must never touch freight money — already stated in the portal's compliance card (:991). Keep the commission ledger separate from carrier settlements.
- SOP `scope_type` exists specifically to avoid FMCSA "allocation of traffic" (88 FR 39371) — every new load-search screen must respect `scope_value` (geography/equipment/commodity) rather than showing the dispatcher everything.
- Dispatcher visibility must be **assignment-scoped**: one `has_dispatcher_assignment(org)` predicate reused in every policy; no global carrier access.

---

## 5. Suggested build order (additive, reversible)
1. `migrations/…_dispatcher_workspace.sql` — `truck_availability`, `dispatcher_commission`, `broker_contacts`, `has_dispatcher_assignment()`, RLS grants on the P0 RPC set. Staging first.
2. `app/agent/dispatcher-workspace.js` — new module; `renderDispatcherHome` mounts it when status ∈ {trial, verified, active}. Truck card + availability + log-booking + commission list + packet button.
3. `dispatchers.js` — commission ledger tab next to salary; trial start/end dates + per-load rows.
4. P1 items as separate modules (`agent-board.js`, `agent-trips.js`, `agent-queue.js`).
5. `node --check` every file; `python build_site.py` must print BUILD OK before any claim that a page works.
