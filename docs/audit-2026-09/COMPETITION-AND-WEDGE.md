# LoadBoot — competition and wedge decision

> **2026-09-06 · Codex update:** main 7dc83e4; F31 client wiring restored on audit/s2-f31-client-verdict with isolated regression tests and staging-bound BUILD OK. Prior verification and owner-approved corrective scope are in PHASE1-AUDIT.md/HANDOFF.md: Claude owns F30/F01/F02 backend corrections; Codex D is not merged/deployed. No SEO or wedge implementation in this turn.

5 September 2026 · Phase 1 proposal · Main `b44fbabe12ac1841b2b61c042eb042f760b8ae5f`

## Decision

**LoadBoot has no demonstrated defensible difference today.** Free access, live authority checks, digital paperwork, mobile booking, tracking and fast payment are already available in competing combinations. A new-authority guarantee would be misleading; a payment guarantee would require capital and a settled legal/payment model. “Zero ghost loads” is not demonstrated by an empty non-demo board.

The best candidate is **a permissioned carrier-readiness record tied to fresh, carrier-confirmed availability for a narrow broker network**. The near-term advantage would be operational focus and easy reuse. Any defensibility must come later from trustworthy, consented completion and relationship history. There is no evidence incumbents cannot copy the feature quickly. That criterion is currently unmet, and the proposal should be treated as an experiment, not an established moat.

## Evidence key

Every positive matrix cell has a source key; UNKNOWN means not established in this review. Vendor descriptions establish advertised capabilities, not independent performance or quality. Measured onboarding times and mobile quality are UNKNOWN unless explicitly stated. Traditional dispatchers and factoring boards are categories, not uniform products; RTS is the named factoring-board example. The original Convoy brokerage and the current Convoy Platform must not be conflated.

| Key | Primary source / local evidence |
|---|---|
| L1 | `app/carrier/app.js:7301+`, `account-view.js`, `w9-form.js`, `dispatch-agreement.js`; six wizard stages and existing compliance/document path |
| L2 | `app/partner/broker-trust.js`, `shipper-trust.js`, `broker-agents.js`; `migrations/bl_bp_0312…0319`; current DB trust definitions |
| L3 | `app/shared/api.js`, `app/carrier/app.js`, `app/partner/app.js`; RPC wrappers and source flows; runtime success not certified |
| L4 | `app/carrier/dispatch-agreement.js:15–16`; 5% booked-and-delivered linehaul fee, exclusions; actual collected payment UNKNOWN |
| D1 | [DAT One](https://www.dat.com/one) |
| D2 | [DAT carrier load board](https://www.dat.com/carrier-load-board) |
| D3 | [DAT broker load board](https://www.dat.com/solutions/freight-broker-load-board) |
| T1 | [Truckstop carrier plans](https://truckstop.com/product/load-board/pricing/) |
| T2 | [Truckstop broker plans](https://truckstop.com/product/load-board/broker-pricing/) |
| T3 | [Truckstop carrier board](https://truckstop.com/product/load-board/carrier/) |
| U1 | [Uber Freight carrier resources](https://www.uberfreight.com/en-US/carrier-resources) |
| U2 | [Uber booking help](https://help.uber.com/freight/carrier/article/using-the-uber-freight-app-to-search-and-book-loads?nodeId=dfe69814-ea0d-43e8-ad16-f77621cd2e0c) |
| U3 | [Uber payment help](https://help.uber.com/freight/carrier/article/payment-and-accessorials-faq?nodeId=b671ed28-ba0a-4794-a424-8b4b99ae00d7) |
| U4 | [Uber shipper offering](https://www.uberfreight.com/en-US/tech/truckload-freight) |
| A1 | [Amazon Relay FAQ](https://relay.amazon.com/faq) |
| A2 | [Amazon Relay](https://relay.amazon.com/) |
| C1 | [Convoy Platform](https://convoy.com/) and [DAT acquisition information](https://convoy.com/dat/) |
| C2 | [DAT acquisition announcement](https://www.dat.com/company/news-events/news-releases/dat-to-acquire-convoy-platform-from-flexport) |
| C3 | [Convoy availability to DAT/BrokerPro customers](https://www.dat.com/company/news-events/news-releases/convoy-platform-now-free-to-dat-and-brokerpro-tms-customers) |
| R1 | [RTS load board](https://rtsinc.com/trucking-services/load-board) |
| R2 | [RTS app](https://rtsinc.com/trucking-services/rts-app) and [RTS app help](https://rtsinc.com/mwv/rts-app-help-center) |

## Feature comparison: acquiring and moving freight

| Product | Onboarding time | Verification | Load posting | Matching | Rate transparency | Tracking |
|---|---|---|---|---|---|---|
| LoadBoot | UNKNOWN elapsed; six-stage carrier wizard [L1] | Broker authority/identity, agent parents, shipper domain signals [L2] | Tiered broker posting; shipper quote path [L2] | Wrappers/UI exist; yield UNKNOWN [L3] | Rate/terms UI; observed realized price UNKNOWN [L3] | GPS/ELD surfaces exist; continuous coverage UNKNOWN [L3] |
| DAT One | UNKNOWN | Carrier monitoring/credit-related tools depend on plan [D2,D3] | Loads/trucks, broker posting [D1,D3] | Search/filter/alerts [D1] | Rate tools depend on plan [D1] | Tracking advertised [D1]; exact coverage UNKNOWN |
| Truckstop | UNKNOWN | Broker/carrier vetting features by plan [T2,T3] | Carrier/broker board [T1,T2] | Search/filter and Book It Now offerings [T1,T2] | Rate features vary by plan [T1] | Exact included workflow UNKNOWN |
| Uber Freight | UNKNOWN | Approval required; exact review SLA UNKNOWN [U1] | Shipper platform [U4]; open broker posting UNKNOWN | Search, bid, book and reload suggestions [U1,U2] | Upfront booking/bid workflow [U2] | Shipper real-time tracking offering [U4] |
| Amazon Relay | UNKNOWN approval time | 180-day interstate DOT tenure plus other eligibility conditions [A1] | Amazon's own freight network [A2]; open broker board UNKNOWN | Load board/instant booking [A2] | Load prices in booking workflow [A2] | Relay operational app [A1]; independently measured reliability UNKNOWN |
| Current Convoy-style platform | Advertised review within 24 hours after insurance/signup; elapsed total UNKNOWN [C1] | Vetted carrier network advertised [C1,C2] | Broker automation platform [C1,C2] | Automated freight matching [C1,C2] | Exact price-disclosure scope UNKNOWN | GPS fleet tracking advertised [C1]; reliability UNKNOWN |
| Traditional dispatch services | UNKNOWN; operator-specific | UNKNOWN; contract-specific | UNKNOWN | UNKNOWN; service-specific | UNKNOWN | UNKNOWN |
| Factoring-company boards: RTS example | UNKNOWN | Broker credit features advertised in app offering [R2] | Ryan Transportation freight [R1]; third-party posting UNKNOWN | Search/book freight [R1,R2] | Exact rate-history scope UNKNOWN | Fleet/load management advertised [R2]; shipment GPS scope UNKNOWN |

## Feature comparison: paperwork, cash and experience

| Product | Packet / rate con / BOL / POD | Payment speed | Fees | Mobile quality | Trust / fraud | Support |
|---|---|---|---|---|---|---|
| LoadBoot | Documents/e-sign/W-9/POD implementation exists [L1,L3]; full runtime UNKNOWN | UNKNOWN; settlement UI is not a funding rail [L3] | 5% specified fee [L4]; free partner posting [L2] | PWA exists [L1]; measured quality UNKNOWN | Tier, identity and demo gates [L2]; this audit found material gaps | Support/chat interfaces [L3]; measured SLA UNKNOWN |
| DAT One | Integrations advertised [D2]; exact four-document coverage UNKNOWN | Factoring is separate/conditional [D2]; actual time UNKNOWN | Standard $59/month; broker Express $159/month [D1]; add-ons/taxes UNKNOWN | App advertised [D1]; measured quality UNKNOWN | Carrier/credit tools [D2,D3]; no zero-fraud proof | Exact response SLA UNKNOWN |
| Truckstop | Exact four-document coverage UNKNOWN | UNKNOWN; financing terms not reviewed | Broker Basic $109/user/month before fees/taxes [T1,T2]; carrier plan varies | Mobile board advertised [T3]; measured quality UNKNOWN | Vetting/rating features [T2,T3]; no zero-fraud proof | Support advertised [T3]; measured SLA UNKNOWN |
| Uber Freight | Emailed rate confirmation [U2]; broader document workflow [U1]; exact BOL scope UNKNOWN | Eligible 2-day pay at 2.5%; qualifying exceptions/card programs [U3] | Fast-pay fees conditional [U3]; other selected charges UNKNOWN | App/web [U1]; measured quality UNKNOWN | Approval/network controls [U1]; effectiveness UNKNOWN | 24/7 shipper support advertised [U4]; carrier SLA UNKNOWN |
| Amazon Relay | Automatic invoices [A1]; packet/rate con/BOL/POD coverage UNKNOWN | Weekly cycle, eligibility/details in FAQ [A1] | Free platform access [A2]; carrier operating costs remain | Relay app [A1]; measured quality UNKNOWN | Entry requirements and performance controls [A1] | Operational support [A1]; measured SLA UNKNOWN |
| Current Convoy-style platform | BOL submission and paperwork advertised [C1,C2]; exact packet coverage UNKNOWN | QuickPay advertised [C1,C2]; exact speed/fee UNKNOWN | Free carrier access [C1]; free for specified DAT/BrokerPro customers [C3]; other fees UNKNOWN | Mobile app [C1]; measured quality UNKNOWN | Verified capacity advertised [C1,C2]; independent effectiveness UNKNOWN | Carrier support exists [C1]; measured SLA UNKNOWN |
| Traditional dispatch services | UNKNOWN | UNKNOWN | UNKNOWN; prompt's 5–10% category range not independently verified | UNKNOWN | UNKNOWN | UNKNOWN |
| Factoring-company boards: RTS example | Document upload/TMS tools [R2]; complete packet scope UNKNOWN | Factoring-dependent; universal promise UNKNOWN | Load board free [R1]; financing fees UNKNOWN | App exists [R2]; measured quality UNKNOWN | Credit information [R2]; no zero-fraud proof | Company support [R2]; measured SLA UNKNOWN |

**Implication:** LoadBoot should be an additional tool for a specific transaction and relationship, not demand that a carrier abandon a productive incumbent board. Current Convoy capability under DAT further weakens “small-broker automation” as a unique claim. Cash speed cannot be won with software alone.

## Ten carrier pain hypotheses

The table deliberately separates the event where a pain occurs from its statistical frequency. **Magnitude, prevalence and dollar/time loss are UNKNOWN for every row.** Validate through real interviews and pilot event records. Structural explanations below are hypotheses about incentives/constraints, not claims that competitors have failed to build the feature.

| Pain / affected carrier | Trigger; frequency | Current workaround hypothesis | Why a gap could persist despite incumbents | Feasible for one person at $0? |
|---|---|---|---|---|
| 1. Repeating packets | Each new broker; frequency UNKNOWN | Email the same documents | Each broker owns acceptance and liability rules | Partly: consented reusable evidence; cannot force acceptance |
| 2. New-authority rejection | Broker onboarding; UNKNOWN | Search for accepting counterparties | Risk policy differs; Relay has a tenure criterion [A1] | Show disclosed eligibility; no universal approval guarantee |
| 3. Stale load/availability | Search/request; UNKNOWN | Calls and refreshes | Cross-system inventory freshness | Timestamp and auto-expire LoadBoot records; cannot fix external boards |
| 4. MC identity uncertainty | New counterparty; UNKNOWN | Independently verify official contacts | Public identity data can be copied | Improve evidence/provenance; cannot eliminate fraud |
| 5. Unpaid detention | Dock delay/claim; UNKNOWN | Collect times, rate con, receipts | Payer agreement/dispute is separate from GPS evidence | Prepare complete claims; cannot guarantee recovery |
| 6. Cash timing and factoring cost | Invoice due; UNKNOWN | Factoring/quick pay | Funding has capital and underwriting costs | Explain net proceeds/status; cannot finance at $0 |
| 7. Rate-con/document disorder | Pickup/delivery; UNKNOWN | Email/phone photo folders | Documents cross many companies/tools | Yes, linked checklist and versioned packet using existing modules |
| 8. Reload/deadhead uncertainty | Approaching delivery; UNKNOWN | Search several boards | Future capacity and lane supply are uncertain | Fresh stated availability and relevant suggestions; no rate forecast |
| 9. Repeated status calls | In-transit exception; UNKNOWN | Phone/text | Tracking permissions and weak coverage | Share consented status with last-update age and exception routing |
| 10. No clear next action | Signup/verification stall; UNKNOWN | Contact dispatcher/support | Requirements vary by person and equipment | Yes, one progress source and resumable tasks |

## Ten broker/agent pain hypotheses

Magnitude, frequency and market-wide incidence remain **UNKNOWN** for every row. Validate broker willingness to post and repeat before treating these as “unsolved.”

| Pain / affected broker | Trigger; frequency | Current workaround hypothesis | Structural reason a gap may persist | Feasible for one person at $0? |
|---|---|---|---|---|
| 1. Available truck is not actually available | Tender; UNKNOWN | Call carrier | Availability changes outside the board | Short-lived carrier confirmation; cannot promise attendance |
| 2. Rechecking a familiar carrier | New load/expiry; UNKNOWN | Rebuild packet/checklist | Evidence ages; liability remains broker-specific | Timestamped evidence and delta flags |
| 3. Impersonation / unauthorized agent | New contact; UNKNOWN | Known-number callback | Public MC data is not identity proof | Existing parent authorization plus independent contact verification |
| 4. Agent handles several brokerages | Switching posting identity; UNKNOWN | Separate accounts/tools | Authorities and liability must remain separate | Already partly built; explicit parent selection and revocation |
| 5. Small broker tool subscription burden | Renewal; UNKNOWN | Manual search/other free boards | Subscription economics; free alternatives already exist | Free add-on record; no exclusive advantage by price alone |
| 6. New platform has little usable capacity | First post; UNKNOWN | Keep incumbent board | Two-sided liquidity | Narrow verified pilot only; cannot manufacture network density |
| 7. Missing POD / invoice details | Delivery/payment; UNKNOWN | Chase carrier | Handoffs cross company boundaries | Existing document checklist and approval-controlled reminders |
| 8. No-show / tracking silence | Pickup deadline; UNKNOWN | Calls/recovery carrier | Driver behavior/network coverage | Early alerts and recorded consent, not a guaranteed recovery service |
| 9. Rate/accessorial dispute | Claim; UNKNOWN | Compare emails and rate con | Contract interpretation and contested facts | One immutable evidence bundle; human/legal resolution remains |
| 10. Re-entering loads and replies | New loads/updates; UNKNOWN | Email/spreadsheets/TMS | Heterogeneous source data and TMS contracts | Safe inbox draft extraction; caller/security repair first |

## Wedge #1 — permissioned readiness plus fresh capacity

**Driver promise:** “Show the broker you and your truck are ready, with one current record you control.”

**Broker promise:** “See what was checked, when it was checked, and whether this carrier has confirmed availability.”

MVP: one selected equipment/lane cohort; owner-approved carrier eligibility; authorized reusable evidence; separate authority, insurance, identity, packet and availability statuses; expiring share links; explicit carrier approval of availability; posting/request/acceptance continues through existing parties and contracts. Do not publish W-9s, bank data, exact live locations or private contacts as a public directory. Creditworthiness must not be implied by an authority check.

Existing pieces and missing work:

| Piece | Existing evidence | Missing |
|---|---|---|
| Carrier progress and documents | `account-view.js`, `w9-form.js`, `profile-view.js`, `carrier/app.js:7301+`, shared storage | One authoritative readiness response and scoped sharing policy |
| Broker trust | `broker-trust.js`, migrations 0312–0316 | Expiry/freshness consistently applied at transaction boundary; runtime proof |
| Agent authorization | `broker-agents.js`, migration 0318, `agent_parents` | Resend repair and cross-parent/role tests |
| Shipper quote eligibility | `shipper-trust.js`, migration 0319, domain-check | Authentication/URL repair; exact signal labels and legal routing decision |
| Availability/matching | Truck posting and matching RPC wrappers in `api.js` | Carrier-confirmed freshness, eligible-only broker view, measured match yield |
| Delivery evidence | Existing tracking, POD, claims and settlement surfaces | Reliable joined event history and explicit permission boundaries |

Proposed success measures: readiness-share→broker response rate; median time to broker acceptance; first-post→second-post retention; legitimate delivered loads/week; stale-capacity and incorrect-verification reports. Baselines and achievable thresholds are UNKNOWN. Evaluate the pilot against its own prior workflow; no fabricated percentage improvements.

Network effect hypothesis: repeat counterparties spend less time rebuilding trust when consented evidence and actual completion history accumulate. An extra signup without useful, current data adds no value. Incumbents can copy UI and checks; the only possible longer-term advantage is dense relationships and reliable narrow-lane execution. This has not been proven.

Biggest risk: brokers do not accept the record or have no freight for the cohort. Legal safety also requires a transaction-specific decision about dispatch, allocation and counterparties; label it a proposed design, not a legal guarantee. The FMCSA guidance distinguishes mere lead information from involvement in transactions and stresses the actual nature of dispatch relationships. [Primary guidance](https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents).

## Alternate #2 — a complete delivery-to-invoice evidence bundle

Promise: “Your rate con, delivery proof and agreed extras stay together, ready for the broker to review.” MVP links existing documents and milestones into a permissioned checklist/export. Use POD, claim evidence, agreement version and invoice status. Measure missing-document rate and time from delivery to invoice acceptance; actual cash speed stays UNKNOWN. It works with few loads and is feasible in 90 days, but many incumbents offer related workflows and collection disputes remain. Biggest risk: duplicating the broker's TMS without reducing effort.

## Alternate #3 — multi-brokerage agent workspace

Promise: “One account, each brokerage's approval and MC clearly separated.” MVP stabilizes the already-built parent picker, email confirmation, revocation and per-parent limits; add clear status and scoped history. Measure confirmed-parent→first-post time, wrong-parent incidents and repeat agent posting. Biggest risk: an agent wants consolidated broker tooling but does not bring additional freight; isolation mistakes carry disproportionate risk. It is a focused workflow advantage, not proven unique.

## Make the wedge guide the product

Draft homepage headline: **“Your carrier readiness, clear before the next load.”** Supporting draft: “Share current authority, paperwork status and confirmed availability with your broker. You control access.” Publish only after those capabilities work; until then describe the existing service honestly.

SEO clusters: carrier packet reuse, authority-check steps, new-authority eligibility, rate-con/POD completeness, broker capacity readiness. Onboarding order: role/account → company autofill → actual truck/availability → only current milestone requirements → clearly visible next action. CC routine: stale/unsafe evidence, ready carriers without suitable supply, unanswered broker requests, delivery/invoice exceptions. Automation: refresh evidence, expire stale availability, queue exceptions, prepare drafts for Yaseen. Never automate sales sends or expand CC navigation.

The decision at day 90 is based on repeated real transactions: continue this wedge only if carriers share usable readiness and brokers return. Otherwise favor the smaller delivery-document product or agent workspace. No outcome is promised from current evidence.
