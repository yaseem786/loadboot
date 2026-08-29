# Carrier onboarding audit — prod (rwscphuhpjoudvljvmdk) — 29 Aug 2026

Source: `app_private.carrier_onboarding_state()`, `app_private.prefs_strength()`,
`carrier_compliance`, `documents`, `fleet_trucks`, `fleet_drivers`, `org_payment_profiles`.
44 carrier orgs total (39 non-demo, 5 demo/test).

## 1. Where everyone actually is

| State | Count | Who |
|---|---|---|
| `active` (approved) | 4 | Warren's Courier, Munster Logistics, Patterson Freight, Pick N Nett |
| `needs_action` (carrier's move) | 7 | Top Knotch, Prime Freight, JMS Express, A&B Global, ACT, E&T Trucking, Optimization Linx |
| `not_started` — real carriers | 4 | All Cities Transport, Nationwide Roadrunner, AEH Cargo, MTE Logistics |
| `not_started` — cold signups, 0 docs, no MC | 15 | IRONCUBE, GCA, EZHAUL, KST3, Primo Liquidation, United Roots, DR&KIDS, Pillars, Ahmed, Artua, All-Ways Towing, Rachel_0307 ×2, Hannan, thomas@thelibertylogistics |
| `awaiting_review` | 1 | "Carrier Account" — Yaseen's own |
| test fixtures / demo | 8 | incl. **"Trucking Inc"** (jeffersonwholesaleinc@outlook.com) |

**Nobody is waiting on LoadBoot.** Every non-test carrier with an open item is blocked on
something *they* have to send. The one exception, "Carrier Account", is internal.

## 2. Blocker-by-blocker — the 11 who got emailed

| Carrier | Verified | Blocked on | Why |
|---|---|---|---|
| JMS Express Lines | 4/5 | COI | Holder box names JMS itself, not LoadBoot |
| Top Knotch Cleaning & Moving | 4/5 | COI | Holder = "Vic's Forever LLC"; only the 2019 Ram 3500 scheduled |
| Prime Freight Services | 2/4 | COI + W-9 | Insured prints "PRIMER" (extra R); holder = self; no VIN. W-9 Line 1 = LLC but ticked sole-prop |
| A&B Global Logistic | 2/4 | COI + agreement | No COI ever uploaded; dispatch agreement unsigned |
| E&T Trucking | 2/5 | COI + W-9 + bank | Holder = DAT Freight & Analytics. W-9 class mismatch + address missing state. No bank doc |
| ACT comapny | 1/4 | authority + COI + W-9 | **USDOT 8463052 returns no FMCSA record at all.** Authority was a PNG screenshot; the same PDF uploaded as both BOL and COI |
| Optimization Linx | 0/5 | everything | **SAFER shows authority NOT AUTHORIZED**, two MC numbers listed. COI is $750k (need $1M), holder = Registry Monitoring, no cargo line |
| All Cities Transport | 0/5 | everything | Only NOAs uploaded. Untouched since 15 Jul |
| Nationwide Roadrunner | 0/4 | everything | MC/DOT entered, then stopped. 426 h idle |
| AEH Cargo | 0/4 | everything | MC/DOT entered, nothing uploaded |
| MTE Logistics | 0/5 | everything | Bank profile saved but no MC/DOT and no documents |

### The one pattern worth fixing in the product
**7 of 11 blockers are the same box:** the ACORD 25 *certificate holder* naming someone other than
LoadBoot (self, Vic's Forever, DAT, Registry Monitoring, Highway App). Coverage is almost always
already correct. This is not a carrier-quality problem — it is a briefing problem. Putting the exact
holder block (copy-paste) on the upload screen *before* they ask their agent would remove most of
this queue.

## 3. Approved carriers — gaps that are costing loads (not emailed yet)

| Carrier | Trucks | Drivers | Prefs strength | Note |
|---|---|---|---|---|
| Warren's Courier | 2 | 2 | 100% | ⚠️ `fleet_trucks` is **stale** — the 16 ft Ford is gone, he rents a 26 ft Hino (10,000 lb, liftgate, dock-high) |
| Munster Logistics | 1 | 1 | 85% | Policy is *scheduled autos only* — any new unit must go on the policy first |
| Patterson Freight | **0** | **0** | **30%** | Fully verified and cannot be matched to anything — no equipment on file |
| Pick N Nett | **0** | 1 | **0%** | No trucks, no bank profile, and an **open DVER compliance hold** (2 vehicle OOS violations, correction certification blank) |

## 4. Funnel leak — 59 signups with no carrier org at all

107 profiles sit at `role=carrier, status=pending`; **59 have no organization membership**, so they
never reach the onboarding board and no one has ever contacted them. Reviewing the list, almost none
are carriers: no MC, no DOT, no company, overwhelmingly dispatcher/VA job-seekers
("Truck Dispatcher Enterprise", "Veltra Dispatch", "Lady She Dispatch", "Beedispatcher"…). Two are
already suppressed as bounced.

Recommendation: do **not** mail them as carriers. Either route `role=carrier` signups with no MC/DOT
into the agent/dispatcher funnel, or add a "what is your MC number?" gate at signup.

## 5. Data-integrity notes

- **"Trucking Inc"** (jeffersonwholesaleinc@outlook.com) shows `ready_not_activated`, 4/4 verified,
  with **zero documents**. Its `carrier_compliance` rows are labelled TEST FIXTURE — set by SQL on
  29 Aug for portal testing. It will keep surfacing in the onboarding board as a real carrier ready
  for approval. Worth flagging `is_demo = true` on that org.
- `Rachel_0307` exists twice (hectotandres91@ / hectorandres91@ — one already bounced), and
  `thomas` / `arora.tinshu` share the contact name "Thomas walker".
- All Cities Transport's `mc_authority` note says "No MC or DOT on file at all", but the org row
  carries MC-72297274 / USDOT 7095402. The note predates the org fields.
