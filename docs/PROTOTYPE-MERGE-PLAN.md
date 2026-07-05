# Prototype → Real App Merge Plan
**Source prototype:** `previews/onboarding-system.html` (+ `previews/portal-final-preview.html`)
**Targets:** `app/carrier`, `app/partner` (broker), `app/command-center` (CC), `app/shared/api.js`

The good news from the audit: most of the prototype's behaviour already has backend endpoints in `app/shared/api.js`. The merge is largely **UI assembly + a few privacy policies**, not new infrastructure. The one genuinely new build is the **carrier onboarding wizard**.

---

## Feature → target module → endpoint → reuse vs build

| Prototype feature | Real target | Existing endpoint(s) | Verdict |
|---|---|---|---|
| DOT/MC verify + full FMCSA tabs | new carrier `onboarding` view; share renderer with `previews/fmcsa-profile.html` | FMCSA fetch (client) / `getCarrierDetail` | **Build UI**, reuse FMCSA render |
| Onboarding wizard (lanes, rates, payment/bank, agreement, W-9, review) | new `onboarding` view in `app/carrier` | `setDispatchPrefs`, doc upload, `setCarrierStatus('under_review')` | **Build UI**, reuse endpoints |
| Bank details capture | onboarding payment step | (new field on carrier profile / tokenized) | **Build** (small) |
| CC carrier review (approve/reject, full profile+docs) | `command-center/views/verificationCenter.js` + `carrier360.js` | `getCarrierDetail`, `setCarrierStatus`, `getDocumentsQueue` | **Reuse** (add full-profile tabs) |
| Broker: verified carriers + filters | `app/partner` broker dash / `matchCenter.js` | `getCarriersDirectory`, `matchRank`, `truckPostingMatches` | **Reuse** |
| Broker: post load to carrier | partner `loadInbox` / composer | `createLoad`, `createLoadSourced`, `offerSend` | **Reuse** |
| Accessorials + policy ticks on a load | load composer | `createLoad` payload fields | **Extend payload** |
| CC load forwarding | `command-center/views/dispatch.js`, `loadIntake.js` | `offerSend`, `controlTower`, `loadOffers` | **Reuse** |
| Carrier My Loads (accept/decline + policy tick) | `app/carrier` `trips` view | `carrierOffers`, `offerRespond` | **Reuse** |
| Rate counter-offer | trips / offers | extend `offerRespond` (add `counter` action) | **Extend** |
| Available Loads marketplace + filters | `app/carrier` `loads` view | `carrierBestLoads`, `getLoadsList`, `truckPostingMatches`, `postTruck` | **Reuse** |
| Trip tracking (start/in-transit/delivered) | `trips` view | `tripSetTracking`, `tripCheckin`, `partnerLoadStatus` | **Reuse** |
| Emergency + delivery reschedule | `app/carrier` `safety` view + `command-center/exceptionCenter.js` | `tripEmergencyRequest`, `tripMyEmergencies` (already built) | **Reuse** |
| Settlement / trip ledger (EARNED/SPENT, NET, PDF) | `app/carrier` `finance` view | `trip_income` + finance endpoints | **Reuse** |
| Documents (status/expiry/renewal) | `app/carrier` `documents` view | `getDocumentsQueue`, pocketCompliance | **Reuse** |
| Account & Settings (status pill, security, live chat) | `app/carrier` `account` view | existing account + `chat.js` | **Reuse** (add status pill) |
| **Carrier Packet = LoadBoot dispatch contact + live chat** | partner `packetAgreementCards` / `openPacketSubmit` | packet submit + `chat.js` (comms) | **Modify** (swap contact → LoadBoot) |
| **Contact privacy** (broker never sees carrier direct line) | `getCarrierDetail` response shaping by role | server-side field mask | **Build policy** (small, important) |

---

## Phased wiring order

**Phase 1 — Carrier onboarding wizard (biggest new piece).**
New `onboarding` route in `app/carrier`, gated before dashboard when `carrier.status !== 'verified'`. Port the 12-step wizard UI from the prototype. Steps write to existing endpoints (`setDispatchPrefs`, doc upload, `setCarrierStatus`). FMCSA tabs reuse the `fmcsa-profile` renderer as a shared component. Ends with `setCarrierStatus('under_review')` → surfaces in CC `verificationCenter`.

**Phase 2 — Contact privacy + Carrier Packet as LoadBoot dispatch.**
Server: `getCarrierDetail` masks `phone`/`email` when the caller role is `broker` (return LoadBoot dispatch contact instead). Partner packet view shows LoadBoot dispatch line + email + **live chat** (wire to `chat.js`), never the carrier's direct line. This is the core of the dispatch business model — do it early so nothing leaks.

**Phase 3 — Marketplace + filters + tracking polish.**
Wire carrier `loads` view to `carrierBestLoads`/`truckPostingMatches` with the prototype's lane/equipment/rate filters. Confirm trip status uses `tripSetTracking` (start → in-transit → delivered) and reflects on the partner side via `partnerLoadStatus`.

**Phase 4 — Negotiation (counter-offer).**
Extend `offerRespond` with a `counter` action (carrier proposes rate → broker approves → rate updates). Everything else in the offer/accept/decline loop already exists.

**Phase 5 — Design-system rollout (optional, brand-gated).**
If the dark-premium look is approved for production, standardise tokens to the brand palette (Navy `#10223B`, Blue `#0883F7`, Orange `#FC5305`) across the 3 portals + PWA icons in one batch (per BRAND-KIT rollout rule). Otherwise keep prototype styling scoped to the new onboarding view only.

---

## What is genuinely NEW code (everything else is reuse/extend)
1. Carrier onboarding wizard view + DOT-verify step + bank-details field.
2. `getCarrierDetail` role-based contact mask + LoadBoot-contact packet.
3. `offerRespond` `counter` action.

## Not carried over from the prototype (intentionally)
- In-memory demo state → replaced by real endpoints above.
- Simulated PDFs (COI/W-9/packet/settlement) → real generators already exist / to be linked.
- Toast-only notifications → real notification center (`notifications.js`).
- Text wordmark → real brand logo assets.

---

## Findings after code audit (update)

Auditing the real app changed the picture — most of the prototype is **already implemented in production**. Status:

**Phase 1 — Onboarding wizard: DONE (wired this session).**
`loadOnboarding()` in `app/carrier/app.js` already existed (6 steps). Added, all syntax-verified (`node --check`), reusing existing endpoints — no new backend:
- Bank account details in the payment step → `setMyPaymentProfile` (same shape as `account-view.js`), factoring-exempt + 9-digit routing check.
- FMCSA "Verify with FMCSA" in step 0 → `fmcsaVerify` (live authority/safety/OOS, legal-name auto-fill).
- W-9 in-app + Dispatch Agreement e-sign in the docs step → launches existing `openW9Wizard` (`carrierSubmitW9`) and `openSignModal` (`carrierSignAgreement`).

**Phase 2 — Contact privacy + LoadBoot packet: ALREADY IN PRODUCTION (no change needed).**
The partner (broker) app never exposes a carrier's phone/email — grep confirms carrier contact lives only in Command Center + the carrier's own view. Brokers see a verified trust profile + a doc-checklist packet (`bookRequestCarrierPacket`) with no contact. UI copy: *"identity and contact stay private until you work together through LoadBoot."* Live chat/support is the single contact channel via `shared/ui/chatWidget.js`. Production is **stricter** than the prototype (carrier direct line is never released, even post-booking).

**Phase 4 — Counter-offer: BACKEND READY; carrier UI deferred.**
`offerRespond(offerId, 'counter', { counter, message })` → `cc_offer_respond` already accepts a counter. CC AI copilot already computes `suggested_counter_rate`. But the carrier booking model is *request-to-book at posted rate* (`requestBookLoad`) with negotiation handled CC-side, so there is no simple carrier accept/decline surface to attach a counter button to. Wiring it should be done with the app running (locate the offer-response flow), not by blind edits.

**Phase 3 — Marketplace/tracking: largely exists** (`pocketAvailableLoads`, `carrierBestLoads`, `tripArrive`/`tripDepart`, dispatch-pref filters). UI polish only.

**Phase 5 — Design tokens: deferred** (brand-gated one-batch rollout).

### Net remaining work (small)
1. Carrier-side counter-offer UI, attached to the offer-response flow (do with app running).
2. Optional design-token rollout to the dark-premium look, if approved.
3. Dev-environment test of the Phase 1 onboarding changes made this session.

*Recommendation: test the Phase 1 onboarding wiring in dev first. Phases 2 and most of 3 are already live; Phase 4 needs a running app to place the counter UI safely.*
