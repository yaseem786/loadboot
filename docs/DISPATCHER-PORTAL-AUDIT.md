# LoadBoot — Dispatcher (Agent) Portal Audit
> **STATUS 28 Aug 2026 (evening): P0 + most of P1 are BUILT.** See "§6 What was built" at the bottom. Remaining: P2 (DAT API, RC OCR, ELD) and P1 #10/#11/#12 on *real* trips (today a booking mirrors its events into `trip_events`; the CC trip tools themselves are not yet surfaced to the dispatcher).
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

---

## 6. What was built (28 Aug 2026) — read before touching any of it

### Backend — two migrations, both applied on STAGING and tested end-to-end in a rolled-back `DO` block. Not yet on PROD.
- **`migrations/bl_disp_0288_dispatcher_workspace.sql`** (staging has it as `0288` + fix-ups `0288b/c/d`; the file is the consolidated, correct version — apply the file to prod as one migration).
  Tables (all RLS-locked, RPC-only): `truck_availability`, `dispatcher_bookings`, `dispatcher_booking_events`, `dispatcher_commission`, `broker_contacts`, `dispatcher_messages`. Columns on `dispatcher_profiles`: `commission_pct`, `trial_start`, `trial_end`.
  Helpers: `app_private.disp_is_assigned(org)`, `disp_is_carrier_member(org)`, `disp_role_for(org)` → staff | dispatcher | carrier.
  RPCs (dispatcher): `dispatcher_workspace_feed`, `dispatcher_set_availability`, `dispatcher_log_booking` (flags `below_min` vs truck/SOP/profile min rate; auto-adds broker to the book; staff notification), `dispatcher_booking_update` (RC attach; dispatched → picked_up → delivered; cancel; mirrors into `trip_events` when linked), `dispatcher_booking_event` (check_call / note / exception / eta; exception alerts staff), `dispatcher_booking_timeline`, `dispatcher_broker_upsert/delete`, `dispatcher_thread_list/send`, `carrier_my_dispatcher`.
  RPCs (staff): `cc_dispatcher_set_terms` (commission % ≤ 5, trial window), `cc_dispatcher_bookings`, **`cc_dispatcher_booking_decide`** (approve = requires RC on file → inserts `public.loads` as **`booked`** (never `available`, or the posting matcher would offer an already-booked load to other carriers) + `app_private.trips` + stops + event; trip compliance triggers (valid driver) come back as a readable `error`), `cc_dispatcher_commission_status/list`. `cc_dispatcher_assign` now accepts dispatchers in **`trial`**.
  Trigger: booking → `delivered/invoiced/paid` creates/re-prices a **draft** `dispatcher_commission` row at the profile's `commission_pct`; cancelled/rejected voids it.
  Storage policy `doc_read_assigned_dispatcher`: assigned dispatcher can read the carrier owner's `documents/` folder (carrier packet).
- **`migrations/bl_disp_0289_dispatcher_board.sql`** — `app_private.my_carrier_org()` gains ONE extra source: transaction-local `app.dispatch_as`, honoured only when the caller has an active assignment for that org. Only the `dispatcher_*` wrappers set it (`app_private.disp_act_as`). Wrappers: `dispatcher_board` (best-fit ranking + available loads + book requests + truck postings), `dispatcher_load_detail`, `dispatcher_request_book` (carrier engine's gates still apply: prefs complete, compliance, hazmat, pickup passed), `dispatcher_post_truck` (**auto_request forced false**; origin defaults from availability), `dispatcher_update_posting`, `dispatcher_posting_matches`. KPIs computed from bookings + events: `app_private.disp_kpis`, `dispatcher_my_kpis`, `cc_dispatcher_kpis`. Prod's `my_carrier_org` was byte-compared (whitespace-only diff) before writing this — safe to apply.

### Frontend
- **`app/agent/dispatcher-workspace.js`** (new, ~55 KB, scoped dark styles, `dw-` classes). Tabs: Today (work queue + KPI tiles + rules), **Board**, Trucks (carrier card + SOP + truck specs + availability editor), Bookings (log form with RC upload + live $/mile vs min-rate check; detail modal with status actions, check call, ETA, exception, cancel, timeline), Brokers, Money (per-load ledger), Messages (3-way thread), Packet (carrier docs via signed URLs), **My KPIs**.
- **`app/carrier/app.js`** — one hook in `renderDispatcherHome()`: status ∈ {trial, verified, active} → dynamic-import the module and mount it under the status card; fallback card if the import fails. Trial status text changed. Nothing else touched.
- **`app/shared/api.js`** — wrappers appended after `ccCarrierPrefs`.
- **`app/command-center/views/dispatchers.js`** — 360 drawer gains: computed KPI strip, commission % + trial window, bookings queue (Open RC · Approve → create trip · Reject · invoiced/paid), commission ledger (approve / pay / void), shared thread. Assign picker allows `trial`. Salary run now records computed KPIs in `kpi.computed`.

### Verified
`node --check` on all four JS files; real `python build_site.py` → BUILD OK (module lands in `site/app/agent/` and in the SW precache); headless-Chromium render of every tab with mocked RPCs (desktop + 390 px): zero page/console errors; booking log, availability save, request-to-book, post-truck all call the right RPC with the right payload.

### Added later on 28 Aug (evening, round 2)
- **Icons**: all emoji replaced with Lucide-style line icons (`shared/ui/icons.js` + 10 extras in the module). CC view too.
- **`bl_disp_0290_dispatcher_trip_tools.sql`** (staging): `app_private.can_touch_trip()` gains the assignment-scoped `app.dispatch_as` clause (prod/staging bytes were identical before the change); `dispatcher_trip(org, trip)` (trip row, stops, timeline, dwell, PODs, RC, claims, issues) and `dispatcher_trip_action(org, trip, action, p)` (arrive / depart / checkin / accessorial / issue → the carrier engines, mirrored onto the booking timeline). UI: **Trip panel** inside the booking modal once `trip_id` is set.
- **`bl_fix_0291_claim_compute_detention_bigint.sql`** (staging): pre-existing PROD bug — carrier detention claims without explicit `detention_minutes` 500'd (`sum(int)` → bigint vs `detention_bill(uuid,int)`). One `::int` cast. **Apply to prod with the others.**
- **Carrier portal**: `app/carrier/dispatcher-card.js` + one dynamic-import hook in the dashboard (after the break-even card). Shows the assigned dispatcher and the shared thread; renders nothing when there is no dispatcher.

### Round 3 (28 Aug, late) — RC reader
- **Edge function `rc-parse`** — `supabase/functions/rc-parse/index.ts`, deployed **staging v3 + prod v1** (verify_jwt). Body `{ mime, data_b64 }` ≤ 8 MB (same convention as `doc-precheck`); Gemini with a strict `responseSchema` + `thinkingBudget:0`; model chain `gemini-flash-latest → 2.5-flash → 2.0-flash → 2.5-flash-lite` (flash-latest is first because the others returned 400/503 for inline PDFs on 28 Aug); returns `{ ok, fields, confidence, warnings, model }` or `{ ok:false, error, errors[] }`. Verified end-to-end on BOTH projects with a synthetic TQL rate con: every field correct, confidence high (prod ≈ 5 s, staging ≈ 15 s).
- **Workspace**: the RC file input is now the FIRST field of "Log a booking"; choosing a file calls `readRateCon()` and prefills every empty field, shows a green/orange "Read from the RC (… confidence): …" box with the carrier named on the RC, multi-stop notice and the model's warnings. Advisory only — any failure just says "fill by hand"; nothing blocks.

### Round 4 (28 Aug, late) — carrier keeps availability current
- **`bl_disp_0292_carrier_availability_view.sql`** (staging): `carrier_my_dispatcher()` now returns the carrier's trucks with their `truck_availability`.
- **Carrier card** (`app/carrier/dispatcher-card.js`): "Where is your truck?" block per unit — status / empty at / empty from / home by / home location / drive hours left / driver / overnight rules / note → `dispatcher_set_availability` (carrier role). The dispatcher's Today queue and Board pick it up on the next refresh. ELD HOS auto-sync is NOT built: `app_private.eld_integrations` has **0 rows on prod**, so there is nothing to test against — the manual field is the honest version for now.

### Round 5 (28 Aug, late) — ELD HOS sync, dead tabs, and the ELD bug
- **`bl_eld_0293_hos_sync.sql`** (staging): `eld_hos_targets()` (service role; every ACTIVE integration whose carrier has a LoadBoot dispatcher — trip or not) + `eld_hos_ingest(token, drivers[])` (ingest-token auth; matches driver → truck by name on `truck_availability`, or the single truck of a one-truck carrier; unmatched names are returned, never guessed). Tested: name match, unmatched, bad token.
- **PROD BUG found and fixed in the same file (0293b on staging):** `eld_integrations_status_check` only allowed `disconnected|connected|error`, while `carrier_eld_setup` inserts `'active'` and `eld_ingest`/`eld_poll_targets` filter on `'active'`. **"Connect ELD" has always thrown 23514 — that is why the table is empty on prod.** Widened the check to include `'active'`.
- **`supabase/functions/eld-poll/index.ts`** → staging v3 (prod still v3-old = GPS only; deploy the file to prod after the migration). GPS path unchanged; new step (2) reads Samsara `/fleet/hos/clocks` (documented fields) or Motive `v1/available_time` (defensive parser — no live account to verify against) and posts to `eld_hos_ingest`. Staging run: `{ok, targets:0, hos:{pushed:0, errors:[]}}`.
- **Agent portal dead code removed** (`app/carrier/app.js`): the unreachable `post`, `carriers`, `resources` tabs and the duplicate old `dispatch` console — 203 lines. Comment at the top of `renderDispatcherHome` corrected. `node --input-type=module --check` + full build pass.
- **How a carrier turns HOS on**: Account → ELD (calls `carrier_eld_setup(provider, rotate, api_token)`) with a Samsara API token that has *Read ELD Compliance (US)* + *Read Vehicles* scopes, or a Motive API key. Within 5 minutes the dispatcher's truck card shows "HOS drive left" with a `samsara · driving · shift 9.2h · cycle 41h · synced …` note. Until then the field stays manual.

### To do next (in order)
1. Yaseen: commit + push; apply `0288` → `0289` → `0290` → `0291` → `0292` → `0293` to prod, then deploy `eld-poll` to prod (files as-is); CC → Abdul → trial → terms → assign Warren's.
2. P2 left: DAT/Truckstop API — no free/self-serve API exists (see §7); 123Loadboard partner API is the realistic first integration.
3. Clean the four dead agent tabs (`dispatch`, `carriers`, `post`, `resources`).

---

## 7. External load-board APIs — what actually exists (checked 28 Aug 2026)
| Board | API? | How to get it | Free? |
|---|---|---|---|
| **DAT** | Yes — Load Board, BookNow, Tracking, Freight Posting, RateView via developer.dat.com | Create a developer account; access is granted per company under a commercial agreement (developersupport@dat.com). A dispatcher's own DAT login does NOT grant API use. | **No** — paid/partner. |
| **Truckstop** | Yes — load search, truck search, post load (developer.truckstop.com) | Signed **Systems Integration Agreement** required before credentials are issued (integrations@truckstop.com). | **No** — partner agreement. |
| **123Loadboard** | Yes — post/search loads, post/search trucks, rates, messaging, bid/book | partner-integrations@123loadboard.com · 437-887-2934; a tech lead is assigned. LoadBoot already has a 123Loadboard account with both carriers' searches set up. | Not published; partner terms. **Best first target.** |
| Free boards (Doft, Trulos, TruckSmarter, C.H. Robinson) | Web only; no public API for third-party dispatch tools | — | Free to use by hand; scraping them is against their terms and not something to build. |

So: there is no free DAT or Truckstop API. The trial runs on Abdul's own DAT seat + "Log a booking" (with the RC reader), and LoadBoot's own board. If you want one integration, email 123Loadboard first — the RC-reader and booking log already give you the internal side.

## 8. Deep audit v2 (29 Aug 2026) — every tab, cross-portal linkage, what was fixed

Benchmark used: Amazon Relay (load board + trip status + Relay Ops), DAT One (search/post/matching, rate view), Uber Freight (booking → tracking → POD), plus what a real US dispatch desk does (Eastern time, check-call cadence, RC-first, one channel). "Above standard" here means: nothing on any tab is hand-typed twice, every rule the desk enforces is enforced server-side, and every party sees exactly what it needs and nothing more.

### 8.1 Tab-by-tab — what belongs, what does not, what changed

| Tab | Must be there (standard) | Must NOT be there | Fixed 29 Aug (0300/0301 + frontend) |
|---|---|---|---|
| **Today** | Work queue from server timestamps; ET clock; trial countdown; carrier-confirmation status; unread; per-truck next action | Salary talk, carrier bank info, generic "welcome" filler | ET/PKT clock strip; queue uses `last_event_at`, `carrier_ack`, `pod_count`, `updated_by_role`; new rules: pickup passed, POD missing, carrier problem, daily 06:00 ET availability line, truck OFF/maintenance, carrier not confirmed; keyboard-navigable rows; rule #5 = one channel |
| **Board** | Loads scored for the truck; details before request; filters; posting with floor from SOP; requests → bookings automatically | Broker contact info before acceptance; auto-book | `dispatcher_load_detail` modal; min $/mi, max deadhead, text filters; posting pre-fills effective floor + home-by; `dispatcher_request_book` now creates the booking (source `loadboot`) and the trip link trigger fills `trip_id` |
| **Trucks** | Specs incl. liftgate capacity; SOP floor + note; who last updated availability; HOS note; last GPS; carrier confirmation status | Owner user id / VIN (dropped from feed); editing driver the carrier set | `effective_min_rpm` (SOP overrides truck overrides carrier); availability saves only changed keys; 0–14 h HOS validation; home-by < empty-from refused; GPS link; "confirmed you / not confirmed" pill |
| **Bookings** | RC-first flow; duplicate RC refused; edit before approval; stops; cancel with reason (blocked after pickup); dispatch message; ET everywhere; RC carrier/MC mismatch warning; timeline | Approve button (LoadBoot only); invoiced/paid (Finance owns it); native dialogs | All of the above; RC locked after approval; weight vs payload check; source badge; trip panel with Google-Maps last location; issue/cancel via modals |
| **Brokers** | Book with loads/gross per broker; quick-fill on booking form; outcome taxonomy; tel/mailto | Nothing from other dispatchers | `bookings`/`gross` per broker from feed; datalist quick-fill; outcome select; sorted by volume |
| **Money** | Pending → approved → paid with the real payout (amount, currency, FX, ref); frozen % per load | Base salary / per-truck prose (gone); editable amounts | New columns + copy; en-US formatting |
| **Messages** | Participants; system messages; poll; mark-read; Ctrl+Enter; unread badge that clears | Emails of parties (removed from RPC) | 30 s poll (visible tab only), `dispatcher_thread_mark_read`, participants line, system bubble style |
| **Packet** | authority / insurance / w9 / noa only; missing-doc warning; "never send bank details" | Voided check, rate cons, BOLs, IDs (0298 whitelist + storage policy) | LABEL map = 4 types; missing list (NOA only when factored); copy button |
| **My KPIs** | Trial window from profile; pass bar with green/red tiles; deadhead %, RC turnaround, per-truck rates | Hand-typed KPIs | `disp_kpis` v2 (to_status, per truck, deadhead, rc_turnaround); trial-window option; thresholds coloured |

### 8.2 Cross-portal linkage matrix

Legend: ✅ linked (live) · ➖ deliberately NOT linked · ⬜ not applicable

| Object / event | Dispatcher portal | Carrier portal | Command Center | Marketing site |
|---|---|---|---|---|
| Assignment created | ✅ feed + system msg + e-mail | ✅ card + e-mail + **confirm** (`carrier_dispatcher_ack`) | ✅ 360 shows `carrier_ack_at`; SOP required first | ➖ |
| SOP (floor, scope, home time) | ✅ read-only in Trucks | ✅ "rules your dispatcher works to" (read-only) | ✅ editor (numeric floor + note) | ➖ |
| Truck availability | ✅ edit (partial) | ✅ edit; sees who updated | ✅ via carrier 360 (unchanged) | ➖ |
| ELD / HOS | ✅ `hos_note`, GPS | ✅ ELD card (0297) | ✅ eld_integrations status | ✅ "connect your ELD" copy |
| Booking logged / RC attached | ✅ | ➖ (carrier sees the load only from RC-received onward, RC file only after approval) | ✅ queue (age, SLA, hours-to-pickup, driver-set) + notification + e-mail | ➖ |
| Approval | ➖ (can't approve) | ✅ notified; RC becomes a carrier document; Got it / Problem | ✅ guarded approve; creates load + trip; freezes % | ➖ |
| Check calls / exceptions | ✅ | ✅ trip timeline (trip_events mirror) | ✅ moving list "last touch" + exception alerts | ➖ |
| Cancellation | ✅ with reason, blocked after pickup | ✅ notified, truck → empty | ✅ notified; trip cancelled | ➖ |
| Commission | ✅ Money (own only) | ➖ never shown | ✅ approve / void / **pay** dialog | ➖ (no % promised publicly) |
| Thread | ✅ | ✅ | ✅ (mark-read so unread counts are per user) | ➖ |
| Carrier bank / voided check | ➖ (0298) | ✅ Finance card | ✅ payment profile | ➖ |
| Dispatcher e-mail/phone ↔ carrier | ➖ e-mail hidden; phone shown by design (WhatsApp group) | ✅ phone + hours | ✅ | ➖ |
| Carrier's DAT/Truckstop login | ➖ never (own seat) | ⬜ | ⬜ | ✅ careers copy says "your own login" |
| Pause | ➖ (notified only) | ✅ `carrier_dispatcher_pause` | ✅ Pause / End (force when loads moving) | ➖ |
| Trial / pay terms | ✅ trial window + % | ➖ trial hidden (label "LoadBoot dispatcher") | ✅ terms form on "Move to trial"; terms log | ✅ careers = commission trial → written package |

### 8.3 Marketing copy corrected (build_site.py)
"salary starts the day a carrier is assigned" → 10-working-day commission trial, then written package; "carrier's own load-board seat" → your own DAT/Truckstop login; "US-based dispatchers" → verified remote dispatchers on US Eastern hours; "24/7 dispatch support/desk" → business-hours desk + on-call while loaded (Riley's 24/7 phone line untouched — that one is real); "rate confirmation e-signs in-app" → LoadBoot checks the RC against your floor; "cancel anytime / no contract" → short dispatch agreement, 30 days' notice (matches the actual agreement in lcOnboard.js §14 and the 180-day non-circumvention).

### 8.4 Build log 29 Aug
- `bl_disp_0298` packet whitelist · `bl_fin_0299` factor remit-to · `bl_disp_0300a–e` hardening (applied staging + prod as five parts, one file in repo) · `bl_disp_0301` CC list/360 polish. All additive; every RPC keeps its signature.
- Frontend: `app/agent/dispatcher-workspace.js` (rewritten, ET-first, no native dialogs), `app/carrier/dispatcher-card.js` (confirm / pause / loads / rules), `app/command-center/views/dispatchers.js` (queue, guarded approve, RC preview, pay dialog, no salary UI), `app/shared/api.js` (+7 wrappers).
- Verified: `node --input-type=module --check` on all 5 modules; headless renders of all 9 dispatcher tabs, booking modal, cancel modal, log form with stops, carrier card (confirm + Got-it flow), CC queue + 360 + below-floor approve flow (reason → confirm → decide); `python build_site.py` BUILD OK.
- Not done / owner actions: Warren's new COI upload in CC; WhatsApp groups; Abdul's final e-mail; Warren's factoring e-mail; `dispatch@loadboot.com` alias decision.

### 8.5 Carrier intro e-mail + acknowledgement model (`bl_disp_0302`, 29 Aug)
The carrier already signed the Dispatch Service Agreement (§4 limited authorization), so assigning a named dispatcher needs **no second consent** and nothing blocks on it. What the carrier gets is a branded "Meet <dispatcher>" e-mail (rendered by `app_private.disp_assign_email_html`, wrapped by delivery-worker's shell): what they do, how a load moves (group OK → RC to LoadBoot → approval → driver rolls), what they can/cannot see, the SOP rules, the one-channel rule, a one-tap **Got it** link (`/app/carrier/?ack=<assignment>` → `carrier_dispatcher_ack`, idempotent, survives the in-app login via `sessionStorage`). `ack_state` = `confirmed` | `pending` (< 72 h since notice) | `notified` (72 h passed — the card collapses to one line, the dispatcher's Today queue stops nagging). Staff can (re)send from the 360 (`cc_dispatcher_resend_intro`). The e-mail pulls `sop.min_rate_note` verbatim — keep that note durable, not "this week".
