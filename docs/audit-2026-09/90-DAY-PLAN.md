# LoadBoot — 90-day implementation and operating plan

Phase 1 proposal · 5 September 2026 · No changes authorized or performed in this document

## Delivery sequence

Day 1 begins only after Yaseen says “go.” Each sprint has one feature branch (`audit/<sprint>-<topic>`), a reviewable diff, migration files where applicable, original JS syntax checks, a staging-bound BUILD OK, a staging verification record and an explicit rollback. Each sprint can ship separately; production SQL still requires “apply to prod.” Legal, auth, DNS/email and payment decisions retain their separate approval requirements. No new CC navigation and no framework migration.

The plan budgets one main engineering outcome per fortnight and one useful content publish/update per week. These are proposed workload limits, not measured delivery capacity. If security review takes longer, defer later design/content scope rather than weaken the gate.

| Sprint | Days | Independently deployable outcome | Dependencies / acceptance | Rollback |
|---|---|---|---|---|
| 1 — boundaries | 1–14 | Restrict unsafe ingestion; repair domain-check caller/URL boundary; fix agent code delivery idempotency; safe local build target; repair smoke gate | Owner decisions on outreach/auth; enumerate real callers; staging negative/positive tests with mail/call sinks; no live messages | Saved function/ACL definitions and prior edge version; restore through reviewed migration; revert branch; keep audit trail |
| 2 — reliable transaction | 15–28 | Reconcile active RPC contracts; truthfully display failed/missing earnings/history; legal-approved fee/shipper copy; modern booking/packet/identity contract suite | Sprint 1; legal/fee decisions; all needed staging endpoints; no mixed fee bases or parent identities | Compatibility wrappers retained; revert UI; immutable signed agreement versions preserved |
| 3 — first useful action | 29–42 | New additive carrier home module, shared onboarding progress, zero-load action, scoped fresh availability; safe update prompt and share-inbox lifecycle | Reliable transaction gates; carrier permission policy; offline and dirty-form checks | Feature flag/new-module switch back to existing home; compatible SW version and cache recovery instructions |
| 4 — narrow readiness pilot | 43–56 | Permissioned readiness record and broker capacity view inside existing screens; fresh check timestamps and sharing expiry | Selected real lane/cohort and licensed counterparties; no public PII; broker can use record without a new opaque trust score | Disable sharing feature; existing portal continues; revoke only newly issued links through approved controls |
| 5 — paperwork and exceptions | 57–70 | Delivery-to-invoice checklist; one exception queue; retry/dead-letter visibility; approval-controlled drafts and weekly digest preview | Document access matrix; approved message policy; provider usage budgets | Stop new scheduler/queue consumer, preserve rows; existing uploads/settlements remain |
| 6 — measure and improve | 71–84 | Ten KPI views on existing Business/Today tabs; measured mobile performance fixes; restore drill; prioritize observed pilot failures | Genuine cohort events; staging backup isolation; actual Lighthouse baseline | Revert new views/UI/assets; keep additive events; no destructive index cleanup |
| Review and buffer | 85–90 | Decide whether brokers repeat and carriers receive relevant freight; publish a factual pilot account only with permission | No invented customer counts, rates or outcome claims; review all UNKNOWN gates | Continue existing product if wedge is not validated; do not widen scope automatically |

After any approved deploy: confirm Netlify `main` deploy, then clear the carrier and partner PWA service worker until the revised update workflow is proven. Do not deploy from this audit.

## $0 supply sequence: toward ten loads/week and 20 verified carriers

These are goals from the audit brief, not a predicted funnel. Exact outreach volume, conversion and timing are UNKNOWN.

| Rank | Tactic, advertising/tool cost $0 | What Yaseen does | Product proof required |
|---|---|---|---|
| 1 | Existing carrier's existing broker relationship | Ask permission to prepare the carrier's capacity/readiness for that broker; personally send any message | Accurate available truck/lane, approved carrier appointment, appropriate counterparty |
| 2 | Existing broker/agent organizations | Ask why they have not posted or returned; offer one relevant capacity view and complete paperwork | Distinguish test/inactive orgs from real willing brokers; repair confirmation/resend first |
| 3 | Permissioned invite after successful load | Draft a share/invite the carrier or broker chooses to use | Delivery and document completion actually recorded; no auto-send or reward invented |
| 4 | Useful broker/carrier SEO tools | Publish a sourced checklist/calculator on existing routes and one portal CTA | Tool works without fake rates or lead-gated empty results |
| 5 | Unpaid referral partnerships | Personally propose an information/resource swap to a willing insurance, ELD or factoring contact | No paid referral assumption, no endorsement claim, approved disclosure |
| 6 | Relevant free communities/directories | Answer a real question; follow posting rules and disclose affiliation | No bulk solicitation, fabricated location, scraped mailing list or false review |

First verify actual supply fit. Then invite only carriers for that available equipment/lane; complete their lawful dispatchability checks; execute the first transactions; ask counterparties whether they will repeat. Increase the cohort toward 20 verified carriers only when useful supply supports it. A signup counter is not liquidity.

## 90-day SEO calendar

All search volumes were **UNKNOWN** when this table was drafted (ChatGPT, 5 Sep 05:xx). **It has since been re-ranked against live Search Console data — see the block right after the table; the re-ranked order wins where the two disagree.** “New” means proposed only if the existing inventory lacks equivalent intent. Most work should update existing pages. One canonical URL per intent; preserve URLs and use reviewed redirects only where justified.

| Week | Topic / target keyword | Intent / page type | Existing or proposed route | Internal links | Measurable portal CTA |
|---|---|---|---|---|---|
| 1 | What LoadBoot does / truck dispatch service | Commercial; service update | `carriers.html`, approved homepage claims | Pricing, how it works, owner operator | Carrier signup; `cta_id=carrier_service` |
| 2 | How a broker checks ready capacity / find carriers for load | Commercial; broker landing update | `brokers.html` | Free broker board, authority guide, packet | Partner post/sign-up; `broker_capacity` |
| 3 | Dispatch fee base and exclusions / dispatch fee percentage | Compare; calculator + pricing clarification | `pricing.html`, existing cost guide | Agreement explanation, calculator, carrier landing | Carrier signup; `fee_explained` |
| 4 | Packet checklist that can be reused / carrier onboarding packet template | Informational/tool; downloadable blank checklist | Proposed packet guide only if not duplicative | W-9 explanation, authority, broker landing | Partner onboarding; `packet_checklist` |
| 5 | New MC eligibility checklist / how to get loads with new MC authority | Informational; existing guide update | `how-to-get-loads-with-new-authority.html` | New-authority dispatch, authority setup, packet | Carrier signup; `new_authority` |
| 6 | What authority checks do and do not prove / how to verify a carrier's authority | Informational; sourced guide/tool | Existing authority page, or unique broker guide | Compliance, packet, brokers | Partner capacity; `authority_guide` |
| 7 | First 90 days operational checklist / new authority loads first 90 days | Informational; deepen existing guide | `new-authority-dispatch.html` or existing first-load guide | Insurance, truck readiness, fee guide | Carrier onboarding; `first_90_days` |
| 8 | Read a rate con before acceptance / rate confirmation checklist | Informational; existing guide update | `how-to-read-a-rate-confirmation.html` | Detention, TONU, POD/invoice checklist | Correct role selector; `rate_con` |
| 9 | Small-vehicle eligibility / box truck dispatch | Commercial; equipment update | `box-truck-dispatch.html` | Equipment limits, new authority, pricing | Carrier equipment flow; `box_truck` |
| 10 | Hotshot operating fit / hotshot dispatch | Commercial; equipment update | `hotshot-dispatch.html` | Existing hotshot guide, calculator, carrier landing | Carrier signup; `hotshot` |
| 11 | Evidence for agreed extras / detention and TONU documentation | Informational; policy/guide update | Existing detention/TONU pages | Rate con, POD, broker terms | Carrier documents or partner terms; `accessorials` |
| 12 | What free posting includes / post loads free | Commercial; existing broker page update | `free-load-board-for-brokers.html` | Trust steps, packet, capacity view | Partner post; `free_posting` |
| 13 | Actual pilot lessons / dispatcher for owner operators | Commercial proof; approved case account or useful process guide if no results | Existing owner-operator guide/case-studies page | Readiness, pricing, brokers, signup | Role-specific signup; `pilot_proof` |

### Re-ranked against LIVE Search Console — data window 2026-08-06 → 2026-09-03 (28 d), pulled 2026-09-05 22:3x UTC by Claude via `seo-pull`

**Totals (official GSC `totals` object):** 60 clicks · 5,224 impressions · CTR 1.15% · avg position 35.8. Versus R7 (09-03: 52 / 4,073 / 42.2) this is the best 28-day window on record — position improved for the second time running. Brand ("loadboot") = 25 of the 60 clicks at pos 1.9; **every one of the 454 non-brand queries GSC names has 0 clicks** (the remaining ~35 non-brand clicks sit in anonymised queries). So the site is *seen* 5,000+ times a month for real trucking terms and almost never clicked: the constraint is **position 25–50 + weak snippets**, not missing topics. That changes the order of the calendar above.

Non-brand demand by cluster (impressions, impression-weighted position; source: query dimension, rowLimit 500):

| Rank | Cluster (live) | Impr | W-pos | Page carrying it today | What the data says to do | Calendar slot |
|---|---|---|---|---|---|---|
| 1 | **Freight rates, generic** ("truckload freight rates" 73 @28.7, "full truckload rates" 63 @51, "current freight rates" 33 @37, "truckload rates" 36 @53, "spot market freight rates" 35 @83 …) 149 queries | 971 | 51.7 | `market-rates.html` — 2,454 impr (47% of site), 8 clicks, pos 36.6 | Do NOT retitle (standing rule). The de-cannibalisation is starting to work: `flatbed-freight-rates.html` now pos **10.0** (50 impr), `oversize-load-rates-per-mile.html` pos **9.3** (36 impr) — both were 0 two weeks ago. Lever = finish the split: (a) an answer-first "truckload / FTL rates" section or hub that owns "truckload freight rates" + "full truckload rates" (0 clicks at pos 28–51 today); (b) every equipment hub linked from the first screen of `market-rates.html`; (c) meta description on market-rates rewritten to name the equipment hubs. | **Week 1** (replaces "What LoadBoot does" — commercial page, demand not visible in GSC) |
| 2 | **Layover pay** ("how much is layover pay for truck drivers" 61 @36, "layover pay trucking" 59 @42, "…for owner operators" 24 @**9.8**, "what is layover pay in trucking" 31 @43) 24 queries | 347 | 39.9 | `layover-policy.html` — 532 impr, **1 click**, pos 29.6 | Users ask *how much / who pays*; the page is a policy. Write the informational answer page ("Layover pay in trucking: typical amounts, when it applies, how to bill it") with the policy page linking to it and vice-versa; definition + typical range in the first 60 words. Only cluster already at pos 9.8 on a money-adjacent query. | **Week 2** (new; replaces "broker checks capacity" — 0 visible demand) |
| 3 | **Flatbed rates** ("average flatbed rate per mile" 33 @46, "flatbed cost per mile" 28 @49, "flatbed trucking rates per mile" 26 @40) 25 queries | 200 | 47.7 | `flatbed-freight-rates.html` pos 10.0 (new) | Add per-mile answer blocks with sourced method (no invented benchmark): "average flatbed rate per mile" H2, formula + user inputs. This is the proof case for the hub strategy — measure it explicitly next round. | **Week 3** |
| 4 | **TONU** ("tonu meaning" 24 @**14.3**, "t o n u" 27 @40, "tonu in trucking" 16 @47) 28 queries | 129 | 35.5 | `tonu-policy.html` — 266 impr, **0 clicks**, pos 24.1 | Definition-first: first paragraph must literally answer "TONU meaning (Truck Ordered Not Used)". Glossary entry + snippet-shaped meta. Zero clicks at pos 24 with 266 impressions = snippet problem, not content problem. | **Week 3** (bundle with #3, both are copy edits) |
| 5 | **Dispatch services, generic** ("owner operator dispatch services" 53 @51, "power only dispatch services" 37 @81, "dry van dispatch services" 34 @78) 43 q + dry van 13 q + power only 9 q | 417 | 60–72 | `owner-operator-dispatch.html` 94 impr @43; `power-only-dispatch.html` 126 @73.7; `dry-van-dispatch.html` 121 @71.6 | These commercial pages rank 70+: they read as brochure copy. Rewrite with the eligibility/operating detail the plan already calls for (what we dispatch, what we don't, fee base, first-week flow) — this is where weeks 9–10 of the original calendar belong, but power-only and dry van have 3–6× the demand of box truck/hotshot. | **Weeks 4–5** (power only, dry van, owner-operator) |
| 6 | **Dispatcher cost / broker vs dispatcher** ("freight broker vs dispatcher" 20 @70) | ~150 | 63 | `how-much-does-a-truck-dispatcher-cost.html` 184 impr, 1 click, pos 29.4; `truck-dispatcher-vs-freight-broker.html` 128 @63 | Cost page: add the fee calculator inline (calendar week 3 item) and a one-line answer up top. Compare page: table-first rewrite. | **Week 6** (merges original weeks 3 + 13) |
| 7 | **Authority / compliance** ("trucking authority packages" 22 @76, "usdot and mc number setup" 21 @61, BOC-3/UCR/2290) 23 q | 107 | 72.9 | `authority-dot-setup.html` 92 @65.8, `boc3-ucr.html` 60 @60.6, `form-2290-hvut.html` 28 @57 | Original weeks 5–7 (new-authority guides) stay but move later: `how-to-get-loads-with-new-authority.html` has 26 impr @44.6 — real but small. Checklist format + step order. | **Weeks 7–8** |
| 8 | **Lumper / detention** (21 + 20 queries) | 154 | 68–77 | `lumper-policy.html` 144 @53.6, `detention-pay-policy.html` 146 @39.9 | Same pattern as layover: policy pages ranking for "how much / who pays" questions. Definition-first rewrite; one combined accessorials explainer linking all three policies. | **Week 9** (original week 11) |
| — | Already winning, protect: `/` 36 clicks @9.2; `driver-assist-policy.html` 3 clicks @10.6; `ghost-loads-load-board-problems.html` 84 impr @12.0 (0 clicks → snippet fix); `apps.html`, `careers.html`, `agents.html` small but top-10 | | | | Snippet/meta pass on ghost-loads (pos 12, 0 clicks). No structural change. | Week 1 side-task |

**Dropped / deferred by the data:** original weeks 1, 2, 4, 12 (homepage claims, broker capacity page, packet checklist, free posting) — no visible search demand in 28 days; they are conversion work, not SEO work, and belong in the product sprints. Box truck (week 9) and hotshot (week 10: 17 impr @32.7) stay in the backlog behind power-only/dry-van.

**Measurement rule for every item above:** before editing, record the page's `clicks / impressions / position` from this pull; two rounds later compare. Re-pull with the recipe in `seo_measurement.md` (four calls in one `execute_sql`: query, page, query+page, default totals). Never sum page rows for totals.

Dry van, reefer, flatbed and power-only pages already exist. Improve their eligibility/operating detail before adding more. State pages must contain real service context and useful local information; never imply an office. Lane pages such as Dallas→Atlanta require actual service capability and sourced operational information; no fictional loads, rates, volume or “live” capacity. Treat state/lane pages as deferred unless there is distinct useful content. Glossary priorities: TONU, detention, BOC-3, MC vs DOT, factoring and quick pay; connect definitions to their relevant workflow. Calculators should accept user-entered values and show formulas, not an invented market benchmark.

Technical SEO priorities: preserve static HTML, title/canonical metadata and robots separation; validate all sitemap URLs and internal links; check redirect/status behavior on the actual staging deploy; validate Article/Organization/Service/BreadcrumbList only where truthful. Use JobPosting only for a real opening with accurate details. Hreflang is unnecessary without actual language variants. Google ended FAQ rich results on May 7, 2026; useful visible FAQs can remain, but expansion for that rich-result benefit is unjustified. Google also says llms.txt is not needed for Search rankings. [Google updates](https://developers.google.com/search/updates). Avoid low-value programmatic pages regardless of whether AI or Python produced them. [Spam policy](https://developers.google.com/search/docs/essentials/spam-policies).

Off-site: verify Google Business Profile eligibility from the actual business model/location before listing; never invent an address. Evaluate Bing Places and free industry directories for legitimate eligibility and cost. For Reddit r/Truckers, read current rules, answer without unsolicited promotional links, and disclose affiliation. LinkedIn broker content should show a useful checklist, with any direct message drafted for Yaseen. Partner swaps must be voluntary and unpaid. No outreach was sent.

Two reusable short-video outlines, for Yaseen to approve and record:

- Rate-con check: show a blank example; identify carrier/broker identity, lane/date and agreed pay; point to detention/TONU terms and required proof; close with the rate-con guide. Do not use customer paperwork.
- Ready for a broker: show separate authority, insurance, equipment and availability statuses; explain that one passing check does not prove everything; close with the readiness checklist. Do not claim guaranteed work.

## Automation map

Existing production jobs already cover many reminders and checks. Extend the existing outbox/audit architecture rather than adding competing schedules. Read current definitions before implementation. Job presence does not prove successful delivery.

| Manual touch / existing surface | Proposed behavior | Idempotency / exception handling |
|---|---|---|
| FMCSA company entry / verification functions | Autofill from a timestamped response; show uncertain/missing fields | Org + source-check ID; retry transient failures; never turn an unavailable response into pass |
| Authority/insurance expiry / compliance and packet jobs | Revalidate relevant evidence, expire stale status, route exceptions | Org + requirement + expiry window; suppress duplicates and stop after resolved |
| First truck / onboarding reminders | One next-action task; reuse existing reminder logic and cooldown | Org + milestone + reminder window; finish cancels pending task |
| Agent confirmation | One code ID per deliberate send; retry same queued delivery | Parent + code ID + recipient; attempts/expiry retained; bounced recipient becomes exception |
| Shipper domain check | Authenticated background check; label domain signal precisely | Org + normalized domain + check generation; bounded retries, manual exception |
| Availability freshness | Expire unconfirmed postings; user chooses renewal | Posting + expiry generation; no auto-renewal pretending fresh capacity |
| Load status/tracking | Show last known update; route deadline exceptions | Trip + event ID; replay is a no-op; permissions follow participants |
| POD/invoice completeness | Checklist and proposed reminder for authorized handling | Trip + missing-document set + window; stop once received |
| Settlement reminder | Draft disputed/due notices; no money movement | Invoice + due window + approved template hash; audit action and recipient |
| Sales outreach | Draft only, waiting for Yaseen; owner resolves existing engine | Recipient + campaign + approved content hash; no automated sends |
| Weekly ops digest | First produce an in-app draft on existing Today/Business tab | Week + recipient/owner; any email delivery needs explicit authorization |
| Failed delivery/anomaly | Visible retry/dead-letter tasks with last error and owner | Claim lease; bounded exponential retry with jitter; terminal failures never silently disappear |

Each action should record purpose, actor/job, entity ID, timestamp in UTC, prior/new state, source version, idempotency key and outcome. Never include secret tokens, W-9 contents or bank details in logs. Time-sensitive appointment displays need the facility's named timezone; UTC storage alone is not a usable appointment label. Concurrency tests must verify one booking winner, one delivery claim and no duplicate fee accrual.

## Free-tier budget assumptions, not account facts

| Service | Published allowance checked 5 September 2026 | Constraint for this plan |
|---|---|---|
| Supabase Free | 500 MB database/project, 50,000 MAU, 500,000 edge invocations; 5 GB uncached plus 5 GB cached egress [pricing](https://supabase.com/pricing) | Production DB metadata says 311 MB, but billable allocation/plan and remaining quota UNKNOWN. Watch logs/storage/egress and project-wide allocation. |
| Resend Free | 3,000 transactional emails/month, 100/day; sent/received and each recipient count [quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits) | Current 600/day outreach cap cannot be treated as free-tier-safe. Actual plan UNKNOWN. Reserve operational capacity; sales remain drafts. |
| Netlify Free credit plan | 300 credits/month; production deploy consumes 15 credits; previews free [plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) | Traffic/compute also consume credits. Actual legacy/current account plan UNKNOWN; do not assume old 300 build-minute allowance. |
| GitHub Actions | Standard hosted runners free for public repos; GitHub Free private allowance 2,000 minutes/month, 500 MB artifact storage [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | Check repo/account billing, short artifact retention, standard Linux only; no paid runners or usage beyond quota. |
| Retell | Trial credit followed by usage pricing [pricing](https://www.retellai.com/pricing) | Not an ongoing free voice service. Preserve current integration; do not expand calls or claim zero-cost automation. |

No paid tool, directory listing or advertising is required by the proposal. Hosting, domain, voice, owner time and financing are not magically costless; actual totals are UNKNOWN.

## Ten metrics on existing CC tabs

All current values are UNKNOWN unless specifically reported in the main audit. Proposed view names below are specifications, not migrations. Check existing BI/report RPCs and event tables before creating them. Use genuine non-demo cohorts, explicit event dates and consistent timezone reporting. With a zero denominator, return NULL/“no eligible records,” not 0%.

| Metric / proposed view | Definition and calculation source |
|---|---|
| 1 Carrier verification conversion / `audit_carrier_conversion` | Genuine carrier signup cohort reaching approved dispatchability / cohort signups; keep signup-completion and legal verification separate. Join org/membership and requirement events. |
| 2 Time to verify / `audit_verification_time` | Median and p90 from signup completion to first fully eligible state; report still-pending cohort separately. Source immutable timestamps, not current status alone. |
| 3 Loads posted / `audit_load_supply` | Distinct eligible non-demo load IDs first published in period, grouped by broker/agent parent; exclude drafts and duplicate relists. |
| 4 Fill rate / `audit_fill_rate` | Eligible published load cohort with an accepted booking before expiry / cohort loads; cancellation reasons visible. |
| 5 Time to book / `audit_booking_time` | First publish→first accepted booking, median/p90; distinguish carrier request from broker acceptance. |
| 6 On-time delivery / `audit_delivery_ontime` | Delivered trips at/before agreed facility-local appointment window end / delivered trips with reliable appointment and proof timestamps; missing evidence excluded and counted. |
| 7 Settlement lag / `audit_settlement_lag` | Delivery→verified carrier payment, plus invoice-ready→payment; do not count receipt upload as verified payment. Unknown payment rail is a prerequisite. |
| 8 Broker retention / `audit_broker_retention` | Broker cohort's second eligible post within an agreed follow-up window, also repeat completed load; dedupe agent posts under parent broker. Proposed window requires owner choice. |
| 9 SEO sessions→signup / `audit_organic_conversion` | Consent-appropriate organic landing sessions linked to genuine signup; attribution window and first/last-touch model declared. Verification conversion is a second stage. |
| 10 Cost per verified carrier / `audit_acquisition_cost` | Actual acquisition cash spend / newly verified carriers; report advertising spend separately from infrastructure and owner time. “$0” only if actual spend is zero and denominator nonzero. |

Attribution exists in `track_web_event` and `submit_web_form`; source migration `migrations/ct-waveA/wa1_web_analytics.sql` creates `app_private.web_events`. Extend it only after inspecting its current schema. Proposed missing fields/events: unique event ID; event type; server time; anonymous session ID; approved identity-link ID; org/role; page; CTA ID; first/last sanitized UTM; relevant load/booking ID. Server derives user/org instead of trusting client claims. Do not store full URL queries, raw credentials or unnecessary IP/PII. Keep append-only conversion events behind scoped RPCs; staff receives aggregates. Start with CTA→signup-completed linkage before adding more analytics.

## Design: prioritized screens and three buildable hero modules

The evidence index includes every scanned view module and public page. Automated state-word detection is not a rendered review. All unexecuted responsive, keyboard, error, offline and screen-reader behavior is UNKNOWN. Existing harness screenshots show the direction of the recent sidebar/trust work; they are not production screenshots.

| Screen or workflow | Priority / additive redesign |
|---|---|
| Public home | P1: accurate value, distinct carrier/broker CTA, current availability explanation, no unsupported guarantee |
| Carrier/broker landings | P1: one audience-specific primary action; show requirements, what happens next and honest supply |
| Pricing / shipper / legal pages | P1: one approved transaction/fee explanation, consistent with actual agreements |
| Carrier home | P1 hero below; prioritize next useful action over zero-value totals |
| Carrier Account / wizard / Documents | P1: one progress source, resume deep links, clear optional vs required, upload recovery and accessible errors |
| Carrier load list/detail/request | P1: broker/parent identity, evidence age, linehaul/FSC/accessorial terms, pickup timezone, request/accepted distinction |
| Carrier trips / tracking / emergency | P1: primary current-trip action, stale-position label, persistent emergency access; never hide emergency under redesign |
| Carrier earnings / invoices / settlements | P1: errors distinguish from zero; due/paid/disputed and fee base explicit; repair RPCs before redesign |
| Carrier fleet / availability | P2: confirmed-until timestamp, equipment, availability and safe renewal; no automatic freshness claims |
| Carrier W-9 / e-sign / profile | P2: retain implementation; larger touch/focus controls, save status and signed version; avoid collecting twice |
| Broker dashboard / trust | P1: precise status and next action; collapse explanatory text after reading; preserve required terms |
| Broker post-load | P1 hero below; parent MC selection is always visible |
| Agent parents / Agents & team | P1: resend state accurately queued, expiry, no-FMCSA-contact recovery; destructive action distinct from confirmation |
| Shipper trust / quote | P1: label domain-email evidence, missing signal and packet-before-booking stages; no legal-business/credit overstatement |
| Partner loads / offers / tracking | P2: request deadlines and missing details; one current action; timestamp and participant scope |
| Partner documents / claims / invoices | P2: checklist, proof, due/disputed state and last successful fetch; no silent empty fallback |
| Public guides/equipment/state/tools | P2: readable content, input labels, accurate sources, contextual portal CTA; avoid redundant banners |
| Login/support/status/404 | P2: role recovery and retry path; real outage status timestamp; no sensitive account enumeration |

**Hero 1: carrier home — proposed `home-next-action.js`.** Mount through an existing route/feature flag. At 360px, show carrier/truck identity and verification freshness, then one primary next action. If onboarding blocks dispatch, list the exact missing requirement and link to its existing Account/Documents step. If ready with no matching loads, say so; offer to update availability/preferences and show last refresh. If a trip exists, pickup/drop-off action and emergency entry take precedence. Cards show linehaul and separately labeled other pay, broker/parent identity, appointment timezone and request status. Use loading skeletons with stable dimensions, explicit retry, stale offline state, and accessible success feedback. Never show fictional loads or animate earnings from an error response.

**Hero 2: broker post-load — proposed `post-load-form.js`.** Keep current RPCs and validations. Display the posting legal entity/MC and agent-parent authorization at the top; explicit selection for multi-parent agents. Group stops/equipment/date, then compensation/accessorial terms, then a review summary. Show trust posting limit and remaining requirements inline. Preserve draft input across validation errors and network loss; disable repeat submission while pending, but use server idempotency too. Before submit, show who receives the post and whether carrier requests require approval. After success, return the actual load ID and next action. No invented instant-fill promise.

**Hero 3: CC daily operations — additive section inside Today.** Four prioritized groups: safety/legal trust exceptions; pickup/request deadlines; missing delivery/payment proof; automation failures. Every row shows entity, reason, age/deadline, owner and one action into an existing screen. Pending draft outreach is visibly unsent. Current counts must come from scoped RPCs, with last-update/error states. Avoid a new nav item or duplicate finance dashboard. Add read-only KPI summaries only after definitions are agreed.

Shared component layer: extend `app/shared/ui/` and brand tokens, do not create a competing design system. Navy `#10223B`, Blue `#0883F7`, Orange `#FC5305`; no cyan accent. Approve distinct semantic warning/error/success colors, then verify contrast rather than replacing all colors with brand blue. Provide button/input/card/table/badge/toast/empty/skeleton primitives with 44px minimum action targets, visible keyboard focus, labels and error associations, reduced motion, and non-color status text. Complex dense tables become prioritized cards on narrow screens; retain accessible tabular headings where appropriate.

### The 21 CC entries, retained

| Existing entry | One-person use / priority |
|---|---|
| Today | Daily exception summary; P1 |
| Task queue | Daily only unresolved/time-sensitive work; P1 |
| Loads & trips | Daily operational core; P1 |
| Market rates | Reference when needed; show source/date, UNKNOWN when unavailable; P2 |
| Rate standards | Exception/policy reference, approval-controlled; P2 |
| Carriers | Readiness and capacity; P1 |
| Compliance | Trust exceptions and expiry; P1 |
| Document review | Required review queue; P1 |
| Brokers & shippers | Supply relationship/trust exceptions; P1 |
| Partner intake | New post/partner blockers; P1 |
| Dispatchers & agents | Authorization changes; on demand; P1 |
| Finance | Due/disputed/receipt exceptions; P1 |
| Live chat | Only active sessions; P2 |
| Support tickets | Overdue/urgent tickets; P1 |
| CRM & outreach | Draft review; existing automation conflict first; P1 |
| Forms | Untriaged actual submissions; P2 |
| Business | Weekly cohort metrics; P2 |
| Website & marketing | Weekly acquisition/indexing check; P2 |
| Templates | On-demand approved wording; P2 |
| Integrations | Failed jobs and credentials metadata; P1 |
| Settings | On-demand controlled administration; P2 |

A proposed 15-minute exception review is a target, not a measured present routine: first trust and imminent pickup issues; then unanswered load requests; then missing POD/payment evidence; then failed jobs. Routine green records need no manual daily re-approval. Trust/legal exceptions remain human decisions.

## Verification and Lighthouse commands

Observed: staging-bound build emitted **BUILD OK**; original JS syntax passed **149/149**; repository import check failed with a verified dynamic-import false positive. No authenticated browser/RPC flow was run. There were no edited source files.

Minimal PR workflow proposal: on `pull_request`, read-only repository permissions, cancel superseded runs, standard Linux runner, pinned Python/Node and dependencies, original `.mjs` syntax checks, corrected import gate, staging-only build, asset/import existence checks and a small non-delivering staging contract matrix. No production credentials, migrations, deployment or messaging in PR CI. Fork PRs run static gates without privileged secrets. Use a short artifact retention and billing limit. Test the existing persona/POD specs only when staging personas are configured; do not count skipped tests as passes.

After a Chrome/Lighthouse installation on a machine with access, use a verified staging preview as `AUDIT_BASE_URL`. Confirm `/app/env-config.js` contains **snslhvmkjusozgjelghi** and no production binding before running. If a local preview is used, serve the staging-bound output and inspect it first. These commands are provided, **not executed successfully in this audit**:

```bash
# Set this to the verified staging preview or local staging-bound server.
export AUDIT_BASE_URL='http://127.0.0.1:8765'
python3 -m http.server 8765 --directory /workspace/scratch/23cf1db77797/audit-preview
```

In another terminal, after confirming the preview target:

```bash
mkdir -p lighthouse-audit
for route in / /carriers.html /brokers.html /app/carrier/ /app/partner/ /features.html /how-it-works.html; do
  name=$(printf '%s' "$route" | tr '/.' '__')
  npx --yes lighthouse "${AUDIT_BASE_URL}${route}" \
    --only-categories=performance,accessibility,best-practices,seo \
    --chrome-flags='--headless' --output=json --output=html \
    --output-path="lighthouse-audit/${name}-mobile"
  npx --yes lighthouse "${AUDIT_BASE_URL}${route}" --preset=desktop \
    --only-categories=performance,accessibility,best-practices,seo \
    --chrome-flags='--headless' --output=json --output=html \
    --output-path="lighthouse-audit/${name}-desktop"
done
```

The two largest static informational content pages in generated HTML, excluding home, interactive load board and signup, are `features.html` (87,643 bytes) and `how-it-works.html` (76,515 bytes). This is the selection rule for the seven-page set. If “content pages” is intended to mean editorial blog posts only, choose the two largest blog entries from the attached inventory and repeat those two targets. Log Lighthouse/Chrome versions and use the same versions for comparisons. Save raw reports; report median of repeated comparable runs only if repeats are actually performed. Portal audits without staging authentication measure their login/redirect shell, not full dashboards.

| Target | Mobile score / LCP / CLS | Desktop score / LCP / CLS | Field INP |
|---|---|---|---|
| Homepage | UNKNOWN | UNKNOWN | UNKNOWN |
| Carrier landing | UNKNOWN | UNKNOWN | UNKNOWN |
| Broker landing | UNKNOWN | UNKNOWN | UNKNOWN |
| Carrier portal | UNKNOWN | UNKNOWN | UNKNOWN |
| Partner portal | UNKNOWN | UNKNOWN | UNKNOWN |
| Features | UNKNOWN | UNKNOWN | UNKNOWN |
| How it works | UNKNOWN | UNKNOWN | UNKNOWN |

INP is not established by a standard navigation Lighthouse run. Obtain field data or an explicitly instrumented interaction sample; never relabel Total Blocking Time as INP. Target public mobile Lighthouse ≥90, as requested. Resolve measured problems in order: primary render dependencies/hero, actual loaded scripts/CSS/fonts, third-party polling, route modules/precache, then lower-value assets. Output file size is only a lead, not a measured LCP cause.

**Review stop:** this plan specifies future work only. Phase 2 begins after your explicit “go,” one sprint and review at a time.
