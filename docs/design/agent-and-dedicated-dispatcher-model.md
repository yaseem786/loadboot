# LoadBoot — Two-Tier "Agent" Model: Referral Agent vs Dedicated Dispatcher

Design proposal built on the legal research in `docs/research/independent-dispatcher-payment-model.md`.
Goal: keep the existing referral/1%/downline program intact, and add a compliant **Dedicated
Dispatcher** role for the active work an independent dispatcher does for a specific carrier.

> Legal guardrails (carry over to BOTH roles): no one allocates loads among carriers; no one
> touches freight money (broker → carrier/factor direct); LoadBoot is not the broker of record.
> Have a transportation attorney bless the Dedicated Dispatcher agreement before launch.

---

## The two roles are different jobs — keep them separate

| | **Referral Agent** (existing "Agent!") | **Dedicated Dispatcher** (new) |
|---|---|---|
| Nature | Passive — network building | Active — real dispatch labor |
| What they do | Bring carriers / brokers / shippers to LoadBoot via a referral link | Actually dispatch for ONE specific carrier: find/book loads, manage trips, docs, appointments, settlements on LoadBoot |
| Legal status | Pure affiliate/referral — no FMCSA exposure | **Bona fide agent of that carrier** (written dispatch agreement + limited POA); NOT a broker as long as they don't allocate among carriers or touch money |
| Touches loads/money? | No | Sources/books loads FOR that carrier; **never touches freight money** |
| Earns | **1% of gross on delivered loads their chain touches + multi-level downline override** | **A share of the carrier's dispatch fee** for the loads they actually run (active pay), + performance |
| Paid by | LoadBoot (out of its 5%) | LoadBoot (out of the carrier's 5% dispatch fee) — see pricing |
| Can stack? | — | **Yes** — a Dedicated Dispatcher can ALSO be a Referral Agent (earn 1% + downline on their referrals) |

**Key point:** the referral 1%/downline is "**who you bring**." The dedicated-dispatcher pay is "**the work you do for a carrier**." They are additive layers, not a replacement.

---

## Dedicated Dispatcher — how it works

### How the carrier and dispatcher connect
1. A carrier joins LoadBoot and chooses **"managed dispatch"** (a dedicated dispatcher) instead of self-serve.
2. LoadBoot pairs the carrier with a Dedicated Dispatcher (from its vetted dispatcher pool) — OR a dispatcher who **referred** that carrier becomes its dedicated dispatcher.
3. A **written Dispatch Service Agreement + limited Power of Attorney** is signed (carrier ↔ dispatcher, on LoadBoot). The carrier appoints the dispatcher as its agent to negotiate/sign rate cons on the carrier's behalf.
4. The dispatcher now manages that carrier's loads on LoadBoot (board loads or externally-sourced broker loads tendered to THAT carrier).

### Responsibilities / rules for a Dedicated Dispatcher
- **Dedicated to specific carrier(s)** — dispatch loads FOR that carrier; **never allocate/choose among competing carriers** (that = brokering).
- **Never handle freight money** — the broker pays the carrier (or its factor) directly; the dispatcher only helps with invoice + POD.
- **Verify the broker** behind any externally-sourced load (LoadBoot FMCSA + credit tools) before the carrier hauls.
- **Disclose** to brokers that they are the carrier's dispatcher, arranging for that carrier only.
- **Performance standards:** keep the truck loaded, negotiate fair rates, low cancels, on-time %, clean docs, honest communication. (These feed the carrier's health score.)
- **Confidentiality + conduct** rules; no re-brokering; no side deals off-platform.

### What the Dedicated Dispatcher gives LoadBoot
- Their **labor** (dispatching), their **performance** (loaded trucks, low cancels, on-time), and usually **bringing the carrier**. In return LoadBoot gives them the platform/tools, the carrier assignment, support/compliance cover, and pay.

---

## Pricing / compensation model (proposal — numbers are owner's call)

Carrier on **managed dispatch pays LoadBoot the flat 5%** dispatch fee on delivered loads (unchanged). That 5% is then **split**:

- **Dedicated Dispatcher's active share** — e.g., dispatcher keeps **~3 of the 5 points** (i.e., 3% of linehaul) for loads they actually run; **LoadBoot keeps ~2 points** for the platform, support, compliance, tracking, settlement rails. (Split % TBD by owner.)
- **Referral 1% + downline** — SEPARATE and unchanged; stacks on top if the dispatcher also referred parties in the chain. Still paid out of LoadBoot's share, clients never pay extra.
- **Self-serve carriers** (no dedicated dispatcher, just use the software/board themselves) → a **lower platform fee or subscription** (since there's no human dispatcher to pay). This creates a clean **tiered pricing**: *Self-serve (software only)* vs *Managed dispatch (dedicated dispatcher)*.

> Rationale (from research): a dispatcher is paid a % of linehaul (5–10%) BY the carrier. Here the carrier's single 5% to LoadBoot funds both the platform and the dispatcher, so the carrier isn't double-charged for dispatch. Keep all of it out of the freight payment itself.

---

## Impact on the existing "Agent!" program — how much changes

**Low-to-moderate, and ADDITIVE — the referral engine does NOT get rewritten.**

- **Unchanged:** referral link, chain detection (carrier/broker/shipper auto-detect), 1% on delivered loads, multi-level downline overrides, agent earnings/payouts. All of that stays exactly as built.
- **New (additive):**
  1. A **"Dedicated Dispatcher" role/flag** on an agent's account (an agent can be referral-only, dispatcher-only, or both).
  2. A **carrier ↔ dispatcher assignment** + the **Dispatch Service Agreement + POA** e-sign flow.
  3. A **"managed dispatch" option** at carrier onboarding + the **tiered pricing** (self-serve vs managed).
  4. A **dispatch-fee split ledger** — when a load the dedicated dispatcher ran delivers, split the 5% into the dispatcher's active share + LoadBoot's share (separate from the referral 1% accrual).
  5. **Dispatcher performance metrics** (loaded %, on-time, cancels) tied to the carrier's health.
- **Backend:** the referral commission engine (`referral_edges`/`referral_levels`/`referral_commissions`) is untouched; add a parallel **dispatch-assignment + dispatch-fee-split** table/flow. Roughly a **new module**, not a migration of the old one.

---

## Open questions for the owner (+ attorney)
1. Is LoadBoot positioning itself as a **dispatch service** (its dispatchers work for carriers) — yes, its marketing says so — and will each dispatcher be **dedicated to specific carriers** (no cross-carrier allocation)? (Attorney to confirm the dispatch-service structure and the agreement/POA.)
2. **Fee split** between the Dedicated Dispatcher and LoadBoot (of the 5%).
3. **Self-serve vs managed** pricing tiers.
4. Is a Dedicated Dispatcher a **1099 contractor of LoadBoot**, or the **carrier's** contractor with LoadBoot as the platform? (Affects who signs what; attorney call — research shows the carrier-agent structure is the safe one.)
5. Whether externally-sourced broker loads are allowed at launch, or start with **LoadBoot-board loads only** (simpler/safer) and add external-broker load-source later.

---

# PART 2 — Economics + FINAL recommendation (does the 5% cover a dedicated dispatcher?)

## The market rate for a dedicated (human) dispatcher — ALONE
- **5–10% of gross** is the standard dispatch-service cut (avg **5–8%**): budget 4–5%, mid 5–7%, premium/specialized 7–10%. By equipment: dry van 5–7%, reefer 6–8%, flatbed/specialized 7–10%. Alternatives: flat **$50–150/load**, **$150–400/week**, or **$500–1,500/month per truck**. [Truck Dispatch Experts](https://truckdispatchexperts.com/resources/truck-dispatch-rates/) · [FleetCollect](https://fleetcollect.net/blog/truck-dispatcher-cost-percentage-vs-flat-fee) · [TruckLeap pricing](https://truckleap.com/dispatch/pricing) · [OTrucking](https://otrucking.com/resources/guides/how-much-do-dispatchers-charge/)

## The math — the 5% CANNOT cover a human dispatcher + the platform
A dedicated **human** dispatcher costs **5–10% of gross by itself**. LoadBoot's total fee is **5%**. So **one human dispatcher eats the entire 5% (or more) — leaving nothing for the platform.** LoadBoot cannot "provide a dedicated dispatcher inside the 5%." Trying to would either lose money or force the price up to 10–15% (dispatcher % + platform %), which the market won't accept.

## What carriers actually want (demand)
- Many owner-operators (esp. **1–5 trucks**) **self-dispatch** — it's the most cost-effective option and avoids the 5–10% dispatcher cut. A dedicated dispatcher is **not universally demanded**. [TenTrucks self-dispatch](https://tentrucks.com/blog/self-dispatch-small-fleets) · [Getloaded](https://www.getloaded.com/guides/how-to-choose-a-dispatch-service-for-owner-operators/)
- Two industry models: **dispatch SERVICE** (% cut, human books loads) vs **dispatch SOFTWARE** (flat subscription, carrier self-dispatches). Software is a fixed cost that gets cheaper as a % as you grow; the service % scales with revenue. Software fits multi-truck / self-dispatch; a human service fits solos who won't touch load boards. [FleetCollect service-vs-software](https://fleetcollect.net/blog/truck-dispatcher-cost-percentage-vs-flat-fee) · [Numeo](https://numeo.ai/blog/dispatch-service-vs-dispatch-software-which-is-better-for-small-fleets)

## FINAL RECOMMENDATION — drop "LoadBoot-provided dedicated dispatchers"; be the software/self-dispatch operating system + referral
1. **Position LoadBoot as the dispatch SOFTWARE + marketplace / operating system** — the carrier **self-dispatches USING LoadBoot** (verified load board, smart matching, market rates, GPS tracking, docs, settlement, factoring rails, compliance). The **5% is the platform/operating-system fee**, not a human dispatcher's wage. This fits the 5% economics (software margin, no human-dispatcher cost), matches demand (self-dispatch is common), and is the **safest legal posture** (pure software/marketplace = not a broker, no dispatcher-employment or allocation issues).
2. **Referral Agent program stays** — bring carriers/brokers/shippers, earn **1% + downline** out of LoadBoot's 5%. Unchanged. Zero legal exposure.
3. **Do NOT have LoadBoot hire/employ dispatchers or bundle a human dispatcher into the 5%** — the economics don't work and it adds broker/allocation + labor-law risk.
4. **Independent dispatchers are WELCOME as users, not as a LoadBoot-paid service:** a dispatcher who already has carrier clients can bring them onto LoadBoot and use the platform to run them; **that dispatcher charges their own carrier their own fee** (off LoadBoot's books), while LoadBoot earns its 5% from the carrier for the software. LoadBoot never pays or employs the dispatcher.
5. **Optional future tier (only if real demand shows up): a "Dispatcher Marketplace"** — connect carriers who WANT a human dispatcher with independent dispatchers, at **premium pricing** (the dispatcher's 5–10% is charged on top / separately, never squeezed into the base 5%). Build later, separate pricing, attorney-reviewed agreements.

## Net
- **Keep:** software/self-dispatch operating system (5%) + Referral Agent (1% + downline). Safe, profitable, demand-fit.
- **Drop (for now):** LoadBoot providing/paying dedicated dispatchers inside the 5% — economically impossible and legally heavier.
- **Optional later:** a premium dispatcher-marketplace with its own pricing + lawyer-blessed agreements.
- The agent-portal code is already aligned: agents refer (they don't post/offer freight), and the carrier network is a read-only directory.
