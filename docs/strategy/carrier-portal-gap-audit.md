# Carrier Portal Gap Audit — LoadBoot vs DAT One / Amazon Relay / Uber Freight
**Date:** 2026-07-03 · Benchmarks researched Jul 2026 (sources at bottom)

## The 8 jobs a carrier hires an app for
1. Find profitable loads · 2. Vet the broker before booking · 3. Book fast · 4. Plan the run (route/fuel) · 5. Execute (facility, docs, detention) · 6. Get paid fast · 7. Run the business (P&L, compliance) · 8. Trust the platform

## Line-by-line scorecard

| Job | Benchmark standard | LoadBoot today | Verdict |
|---|---|---|---|
| **1. Find loads** | DAT: thousands of loads, advanced filters, saved searches, **load alerts**; Relay: load board + **Suggested Reloads** | Own-marketplace loads only; basic list; AI "best for you" ranking w/ real deadhead calc | **WEAK — liquidity is the gap** (partnership problem, not code); search/filters/alerts are code and MISSING |
| 1a. Post-a-Truck auto-book | Relay: post truck + min rate → auto-books matching loads | Dispatch prefs already store min RPM/lanes/equipment — **no matching engine on top** | **MISSING, 100% BUILDABLE NOW** (our data) |
| **2. Vet broker** | DAT killer feature: **broker credit score + days-to-pay** (avg 28 days, credit 94/100 shown per broker) | Trust profile + verified badge + our new rating engine; **no days-to-pay, no credit** | **WEAK** — credit data is licensed (blocked); **our-network days-to-pay is buildable** from invoice/claim outcomes |
| **3. Book fast** | Relay: instant book; Uber: instant book + bundles | Request-to-book (race-safe, broker approves) | **HAVE** (approval flow is by design — our trust model) |
| **4. Plan the run** | Relay: route + fuel/food/parking POIs, all-in pay (rate − fuel − tolls) before booking | Navigate button (Google Maps); RPM shown; **no net-profit preview, no fuel/parking** | **WEAK** — net-profit per load (user's cost/mile) is BUILDABLE NOW; POIs need paid maps (defer) |
| **5. Execute** | Relay: facility info, gate speed; DAT: none really | **Arrive/depart stamps w/ detention minutes, GPS share + live tracking, POD pipeline w/ review, dispatch sheet w/ detention/lumper terms, emergency flow, delivery doc packet** | **HAVE — this is our STRONGEST area; we beat DAT here** |
| **6. Get paid** | Relay: weekly pay; DAT: factoring partners; Uber: quick pay | Invoices, disputes, statements, per-trip P&L | **WEAK on speed** — quickpay/factoring = partnership (blocked, biz-dev); invoicing HAVE |
| **7. Run business** | DAT One: 15-in-1 (docs, IFTA-ish tools) | Fleet (licenses/medicals expiry), compliance docs, per-trip P&L, calculators on site | **PARTIAL** — IFTA/expense tracker MISSING (P2); doc scanner MISSING (buildable) |
| **8. Trust** | DAT: 45 yrs brand; Relay: Amazon | New brand; ratings live; tenant isolation real | **WEAK — only time + users fix this; code cannot** |
| Market rates (RateView) | $1T payments data, daily lane rates | Nothing comparable | **BLOCKED** (data licensing $$) — honest path: our-network lane medians with "insufficient data" rule; never fake it |

## Priority backlog (this defines "satisfied")

**P1 — build now, zero external data, ~2-4 sessions:**
1. **Post-a-Truck / Auto-Match v1** — carrier posts truck (uses existing dispatch prefs) → engine matches new marketplace loads → push alert "load matches your truck" (+ optional auto-request toggle)
2. **Load alerts + saved searches** — save lane/equipment/rate filters → push on match
3. **Net-profit preview on every load card** — carrier sets cost/mile once → each card shows est. profit after fuel/fees, color-coded (real math, user's own numbers)
4. **Suggested Reloads** — after booking, show loads near destination for delivery-day+1 (deadhead calc already exists)
5. **Broker days-to-pay (our network)** — from our invoice outcomes; shown with sample-size honesty ("n=3 loads")
6. **Advanced load filters** — origin radius, dest state, equipment, min rate/RPM, pickup date
7. **Document scanner** — camera → crop → PDF (browser-based, $0)
8. **Rating stars on load cards** — posting party's rating from our engine (aggregate only)

**P2 — after P1:** IFTA/state-miles + expense tracker · maintenance reminders · facility wait-time stats (threshold rule) · Spanish UI · fuel-card partner links
**P3 — blocked (money/partnerships):** market rate data licensing · broker credit bureau data · maps/fuel/parking POIs · factoring/quickpay integration · external load board API partnerships (123Loadboard/Truckstop) — the liquidity answer until own marketplace density

**Sources:** [DAT load board w/ rates](https://www.dat.com/solutions/load-board-with-rates) · [DAT One](https://www.dat.com/one) · [DAT pricing 2026](https://otrucking.com/resources/guides/dat-load-board-pricing-plans/) · [Amazon Relay](https://relay.amazon.com/) · [Relay app](https://play.google.com/store/apps/details?id=com.amazon.relay&hl=en_US)
