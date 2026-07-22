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
