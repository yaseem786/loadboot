# LoadBoot Accessorial Recovery Copilot (ARC) — A-to-Z Critical Evaluation
**Date:** 2026-07-03 · **Status:** Board-level evaluation, pre-build
**Rule:** Facts are cited. Everything else is labeled ASSUMPTION, ESTIMATE, or RECOMMENDATION.

---

## PHASE 1 — PROBLEM VALIDATION

### 1.1 How serious is the problem? (CONFIRMED FACTS)
- Driver detention cost the US trucking industry **$15.1 billion in 2023** — $11.5B lost productivity + $3.6B added expenses (ATRI, Sep 2024). Per driver: **$11,000–$19,000/year lost**; 117–209 detained hours/year.
- Drivers were detained on **39.3% of all stops** in 2023 (ATRI).
- **Own-authority owner-operators are hit hardest**: they experience long detention more often than employee or leased drivers (ATRI segment breakdown).
- Carriers invoice for detention only **~75% of the time**, shippers pay only **~55% of invoices sent**, and **17% of drivers never receive any detention pay** (ATRI/industry reporting).
- Average detention rate charged (~$63/hr) is **below** average operating cost ($66.65/hr) — even paid detention loses money.
- **~27% of accessorial fees on freight invoices are incorrect**; accessorials are the least-audited line items (IOFM 2025 via Laneproof).
- Regulatory tailwind: FMCSA ran a formal detention data collection study (80 carriers / 2,500 drivers), and 2025 broker-transparency rules push for rate confirmations that explicitly state detention terms, lumper reimbursement, TONU and accessorial caps.

TONU/layover/lumper: no single authoritative frequency statistic found (honest gap). ASSUMPTION based on industry guides (OTR Solutions, FreightPulse, dispatcher training content): TONU and lumper disputes are weekly-to-monthly events for spot-market carriers, an order of magnitude less frequent than detention but higher per-event value ($150–$500 TONU, $100–$400 lumper).

### 1.2 Who suffers most (CONFIRMED + ASSUMPTION)
1. **Single-truck own-authority owner-operators — worst hit** (ATRI: most long detention, least leverage, no back office). ← target.
2. 2–10 truck fleets — same pain × trucks, part-time dispatcher, still no claims process.
3. Dispatch companies — feel it via clients; potential channel, not end user.
4. 11–50 fleets have TMS + office staff; big fleets have contracts + leverage.

### 1.3 Current manual workflow and where it breaks (ASSUMPTION, to verify in interviews)
Phone photos of gate tickets, texts to broker, no timestamps discipline → **breaks at**: (a) not reading ratecon detention clause before accepting; (b) missing the written notification deadline (often "notify before free time expires or no detention"); (c) no signed in/out times on BOL; (d) invoice sent without evidence package; (e) no follow-up cadence → claim silently dies. Each break point is a software feature.

### 1.4 Will users act? (ESTIMATE)
Try free: HIGH (money recovery + free). Repeat use: MEDIUM-HIGH (detention is weekly). Upload sensitive docs: MEDIUM (trust barrier — LoadBoot dispatch clients already do). Recommend: HIGH if one recovered check. Pay later: MEDIUM (only after recovered money; $49/mo competitors exist, so paying behavior is proven in this niche).

### 1.5 The must-have moment
**Sitting in the dock past free time**: app shows a live countdown, has already GPS-stamped arrival, and drafts the broker notification before the deadline passes. Secondary moment: **pre-book clause check** — "This ratecon specifies NO detention rate. Ask for it in writing before you accept."

---

## PHASE 2 — COMPETITORS (verified via web research, Jul 2026)

| Competitor | Target | Price | What it does | Gaps |
|---|---|---|---|---|
| **DockClaim** | Owner-operators | **$49/mo** | GPS geofence detention timer, GPS-stamped invoices, send to broker | Detention-only; no pre-load clause check; no TONU/lumper/claim lifecycle; $49 is steep for 1 truck |
| **Detention Defender** | Drivers/OOs | app | Geofence timer, auto GPS-stamped invoices | Same: timer+invoice, not full recovery workflow |
| **Detention Source** | Enterprise carriers/brokers | enterprise | Facility wait-time benchmark data | Not for small carriers; no claims |
| **Augie (Augment)** | **Brokers** | enterprise AI | Chases PODs, detects detention/lumper docs for billing | Broker-side; proves the money matters |
| **LoadStop / Vektor / Truckpedia (TMS)** | Fleets | $/truck/mo | AI ratecon extraction to build loads | Extraction for dispatch, not accessorial recovery |
| **Laneproof** | Brokers/carriers | content/templates | Ratecon clause education, templates | Education only, no workflow |
| **Factoring cos (OTR, Triumph…)** | Carriers | % of invoice | Guides, sometimes back-office paperwork help | Not systematic; tied to factoring relationship |
| **ELDs (Motive/Samsara)** | Fleets | $/truck/mo + HW | Dwell reports | Enterprise analytics, no claim package, needs ELD |

**Honest differentiation verdict: MODERATELY DIFFERENTIATED.**
It is NOT a blue ocean — DockClaim/Detention Defender already sell detention timers+invoices to the exact same user. What nobody verified offers in one place, carrier-side: **pre-load clause checker → deadline-aware notification → multi-accessorial (detention+TONU+layover+lumper+extra stop) → evidence package → claim lifecycle tracking → payment follow-up — with a free tier, no ELD required, attached to a real dispatch service.** Individual features are easily copied; the defensible parts are (a) the full lifecycle in one flow, (b) LoadBoot's existing carrier relationships + Command Center human review, (c) accumulated facility/broker payment data over time. Competing on "free vs $49/mo" is a real wedge but not a moat.

---

## PHASE 3 — LEGAL, COMPLIANCE, TRUST (RECOMMENDATIONS — not legal advice; attorney review required before launch)

**Real risks:**
1. **Collection-agency classification** — if LoadBoot demands payment from brokers on carriers' behalf or takes % of recovery, some states may treat it as debt collection (licensing). → Software must have the **carrier** send claims in the carrier's own name/email. No %-of-recovery fee at launch.
2. **Unauthorized practice of law** — never say "this clause is unenforceable" / "you are legally owed". Say "the document states…", "commonly negotiated…", "calculation based on the terms you entered."
3. **Location privacy** — per-trip explicit consent (existing `pocketSetConsent` pattern is correct); no continuous background tracking in MVP.
4. **Defamation via facility/broker scores** — publish only aggregated, verified, minimum-sample medians; never individual accusations; "Insufficient verified data" below thresholds; no free-text public reviews of named facilities at launch.
5. **Document integrity** — hash + timestamp uploads (audit trail exists in codebase); disclaim that LoadBoot doesn't verify authenticity; TOS bans altered documents.
6. **AI/extraction errors** — extraction is a DRAFT the user must confirm field-by-field; the confirmed values are user inputs, not system claims.
7. Broker-carrier confidentiality: ratecons may have non-disclosure of rates → aggregate-only analytics, anonymization thresholds.

**Safe positioning:** document organization · calculation assistance based on user-confirmed terms · reminders · evidence packaging · workflow tracking · educational content.
**Never claim without licenses/review:** legal advice, guaranteed recovery, debt collection, contract enforceability opinions, "fully compliant."
**Disclaimer concept:** "LoadBoot ARC is workflow software. It organizes your documents and calculates amounts from terms you confirm. It is not a law firm, collection agency, or factoring company, and does not guarantee any recovery. This is not legal advice."

---

## PHASE 4 — PRODUCT DECISION

Scored 1–10 (10 = best) — full matrix:

| Criterion | **ARC** | TMS-lite | Compliance deadline tracker | Profit/RPM calculator suite | Ratecon vault + invoice gen | Factoring packet prep |
|---|---|---|---|---|---|---|
| Urgency | 9 | 6 | 7 | 5 | 6 | 6 |
| Frequency of use | 8 | 8 | 3 | 5 | 7 | 6 |
| Willingness to pay | 7 | 6 | 4 | 2 | 4 | 5 |
| Ease of building | 6 | 4 | 9 | 9 | 7 | 7 |
| Cost to launch | 8 | 5 | 9 | 9 | 8 | 8 |
| Legal risk (10=low) | 5 | 8 | 9 | 10 | 8 | 7 |
| External-data independence | 8 | 7 | 8 | 6 | 9 | 8 |
| Network-effect independence | 9 | 9 | 9 | 9 | 9 | 9 |
| Organic referral | 8 | 5 | 4 | 6 | 5 | 4 |
| Proprietary-data potential | 9 | 6 | 2 | 2 | 5 | 4 |
| Fit with LoadBoot today | **10** | 9 | 6 | 7 (built) | 8 | 6 |
| Path to DAT-class vision | 9 | 7 | 3 | 4 | 5 | 4 |
| **Total /120** | **96** | 80 | 73 | 74 | 81 | 74 |

Key structural insight: **LoadBoot has already built ~60% of ARC's hard parts** — trips with arrive/depart detention stamps (`tripArrive/tripDepart` returning `detention_minutes`), per-trip GPS consent + location posts, POD upload with review queue, dispatch sheet already extracting detention/lumper/POD terms, rate-con acknowledgment RPCs, notification engine, tenant-isolated Postgres, PWA. No competitor scored fit like this.

### DECISION: **D — run a manual validation pilot first**, with a pre-committed bridge:
if validation passes its metrics, ARC becomes **the flagship, built INSIDE the existing Carrier Portal** (not a separate app). Why D and not A directly: zero budget, unregistered company, and a $49/mo competitor proves demand but not *free-tier-to-paid* conversion; two weeks of concierge validation costs ~nothing and de-risks the only untested assumptions (trust to upload ratecons, claim outcomes). Why not C: no alternative scored close, and the wedge feeds exactly the facility/broker intelligence the DAT-class vision needs.

---

## PHASE 5 — MANUAL VALIDATION (near-zero cost)

**Target profile:** US own-authority owner-operator or 1–3 truck carrier, spot market via brokers, active weekly, uses WhatsApp/FB, not on an enterprise TMS.
**Where:** Facebook groups (owner-op/dispatch groups), r/Truckers + r/FreightBrokers, OOIDA forum threads, TruckersReport forum, existing LoadBoot dispatch leads/clients, YouTube comment sections of detention videos.

**Interview questions (8):** last detention event & what happened to the money · how do you record in/out times · have you ever been denied detention, why · do you read detention terms before accepting · what would you upload/never upload · have you paid for any app · what would make you trust a free tool · would you let us prepare one claim for you this week.

**Landing page offer:** "We'll prepare your next detention claim package — free. Send us the ratecon and your in/out proof; you get a professional, evidence-backed claim PDF to send your broker."
**Waitlist wording:** "Free while in beta. No card. Your documents stay private and are never shared."

**Concierge workflow (manual):** carrier WhatsApps/emails ratecon → we (Claude-assisted) extract terms into the checklist → send back a one-page "know before you go" · driver texts arrival/departure photos+times → we build timeline → we compute owed amounts → deliver claim PDF + suggested email → carrier sends it themselves → we log outcome.

**Numbers:** 15 interviews; 5 concierge carriers; 10 audited ratecons.
**Success gates (30 days):** ≥10 interviews completed · ≥60% report unpaid accessorials in last 90 days · ≥4/5 concierge users submit the package · ≥2 report broker acknowledgment or payment · ≥3 say they'd use weekly · ≥1 unsolicited referral.
**Kill/redirect signals:** can't recruit 10 interviewees in 14 days · carriers refuse to share ratecons (<50% of asked) · packages get ignored by brokers in every case · users say "I just call my broker, this is overkill."

**14-day plan:** D1–2 scripts+landing (existing site, zero cost) · D3–7 recruit+interview 8 · D5–14 run 3 concierge claims · D14 go/no-go review. **30-day plan:** complete 15 interviews, 5 concierge carriers, ≥6 claims processed, write validation memo, decide BUILD/PIVOT.

---

## PHASE 6 — MVP (only if validation passes)

**Extraction approach (chosen): manual structured entry + rule-based assist + human-assisted review.** A guided checklist form (free time hrs, $/hr, cap, notification deadline, lumper terms, TONU, extra stop) with the ratecon PDF displayed beside it; simple regex/keyword highlighting helps find clauses; a LoadBoot reviewer (Command Center queue) can double-check on request. No paid OCR/AI at launch; PDF.js text layer + keywords is free and safe because the user confirms every field.

**1. Must launch now:** ratecon upload (existing storage) · terms checklist + clause highlighter · pre-load risk flags ("no detention rate stated") · trip link with arrive/depart stamps (EXISTS) + photo evidence (EXISTS via POD flow pattern) · free-time countdown + on-screen/push alert (push EXISTS) · broker-notification draft (copy-to-clipboard/mailto from carrier's identity) · accessorial calculator (user-confirmed terms × recorded times) · claim package PDF (timeline, stamps, docs list, amounts) · claim tracker states · CC review queue (pattern EXISTS).
**2. Important, later:** geofence auto-arrival · facility wait-time aggregates · broker payment-behavior aggregates · revised-ratecon diff view · templates per major broker · Spanish/Urdu UI.
**3. Paid integrations later:** OCR/LLM extraction · SMS · ELD imports · maps/geofencing service · factoring-partner handoff.
**4. Do NOT build yet:** auto-sending claims as LoadBoot · % recovery billing · public facility/broker scores · dispute/arbitration features · marketplace ties.

Works without: paid ELD ✓ (manual stamps) · background GPS ✓ (tap-to-stamp) · paid maps ✓ · paid SMS ✓ (push+email) · paid OCR ✓ · app stores ✓ (PWA installed) · marketplace ✓.

---

## PHASE 7 — UX (all flows mapped to the existing Carrier Portal)

Driver-at-dock flow = 3 taps max, big buttons, works in a parked truck on 1 bar: **[I've arrived] → live countdown card → [I've left]**, camera buttons for gate ticket/BOL, everything else automatic.

- **Onboarding (carrier):** existing signup → "Add your first ratecon" empty-state.
- **Add truck/driver:** existing Fleet tab.
- **Upload ratecon:** Trips → trip → "Ratecon & terms" → upload → checklist beside PDF → confirm fields (each field editable; nothing auto-final).
- **Correct extraction:** every field shows "you confirmed" chip; tap to edit; audit log keeps versions.
- **Appointment confirm:** date/time + facility name on trip (exists on dispatch sheet).
- **Arrival proof:** Arrive button = timestamp + optional GPS pin (consent prompt, existing) + photo.
- **Detention warning:** push + banner at T-30min and T-0 of free time; one tap opens notification draft.
- **Broker notification:** prefilled professional message (trip refs, arrival stamp) → carrier sends via their email/text; log "notified at".
- **Departure proof:** Depart button; system computes dwell, flags detention minutes (RPC exists).
- **Docs:** BOL/POD/lumper receipt upload (existing uploader + review states).
- **Calculation:** itemized: detention hrs × confirmed rate (capped), TONU/layover/lumper per confirmed terms; every number traceable to a user-confirmed input.
- **Package:** one-tap PDF: cover, timeline, stamps, evidence index, amount table, terms excerpt.
- **Claim tracking:** states with next-action chips + follow-up reminders (D3, D7, D14).
- **Denial:** log reason → suggested next steps (educational) → keep evidence.
- **Payment confirm:** mark paid → feeds (consented) aggregates.
Roles: **owner-op** = all in one phone UI · **small-fleet manager** = same portal, per-truck claims board · **driver** = stamps+photos only (no finance visibility — model exists) · **dispatcher** = multi-client claims board (later) · **LoadBoot admin** = CC queue: review terms, audit packages, outcome logging.

---

## PHASE 8 — DATA STRATEGY

Collect: ratecon docs+confirmed terms · trip stamps/GPS pins (per-trip consent) · evidence docs · claim outcomes. Why: run the workflow; with consent, build aggregates.
**Consent:** separate toggles: (1) required processing; (2) optional "include my anonymized events in industry statistics" (default OFF).
**Aggregation rules:** facility wait stats shown only at **n≥5 distinct carriers AND ≥10 visits in trailing 180 days**; broker payment stats at **n≥5 carriers AND ≥10 closed claims**; otherwise UI must literally show **"Insufficient verified data."** Medians+IQR (outlier-resistant), trailing windows for freshness, confidence label (Low/Med/High by n), duplicate/fraud checks (same doc hash, impossible timelines), correction+deletion honored (Supabase delete + aggregate rebuild), retention: docs 3 years or user deletion.
Path to proprietary intelligence: every closed claim = a labeled record (facility dwell, broker paid/denied/days-to-pay, clause patterns). At even 50 active carriers × ~8 claims/mo this becomes the seed of the DAT-class data layer — without ever claiming DAT-level coverage at launch.

---

## PHASE 9 — TECHNICAL ARCHITECTURE (fits current codebase)

Existing (verified in repo): Supabase Postgres 17 + RLS-style tenant isolation via SECURITY DEFINER RPCs (`app_private.*`, `my_carrier_org()`), private Storage bucket with validated POD pipeline, audit log (`log_audit`), events (`emit_event`), push, PWA (installed launcher shipped this batch), CC review queues, trips with `tripArrive/tripDepart` → `detention_minutes`.

**New tables:** `arc_terms` (trip_id/load_id, field set, source_doc, confirmed_by, version) · `arc_claims` (trip_id, carrier_id, type[detention|tonu|layover|lumper|extra_stop|redelivery], amounts jsonb, state, notified_at, sent_at, outcome, paid_amount, days_to_pay) · `arc_claim_events` (claim_id, event, meta, at) · `arc_evidence` (claim_id → storage path, kind, hash) · reuse `party_ratings`-style aggregates later.
**State machine:** `draft → terms_confirmed → monitoring → evidence_pending → package_ready → sent → acknowledged → approved | denied | partial → invoiced → paid | written_off` (transitions logged; no skipping into `paid` without `sent`).
**RPCs (pattern-consistent):** `cc_arc_save_terms`, `cc_arc_confirm_terms`, `cc_arc_open_claim`, `cc_arc_log_event`, `cc_arc_calc`, `cc_arc_package_manifest`, `cc_arc_my_claims`, staff `cc_arc_review_queue`.
**PDF:** client-side print-to-PDF from a print-styled page at launch ($0), server render later.
**Offline/poor signal:** stamps queue in localStorage with device timestamp, sync on reconnect, marked "device-time (synced later)" for honesty.
**Tests:** state-machine unit tests, RPC permission matrix (existing persona test harness), calc golden cases, package snapshot test.
**Free-tier limits & migration:** Supabase free (500MB DB / 1GB storage / 50k MAU) is enough for pilot; storage is first ceiling (~1,000 doc-heavy claims) → paid Supabase ($25/mo) is the first real infra cost; Netlify free fine.

---

## PHASE 10 — BUSINESS MODEL (all pricing = HYPOTHESES to test)

Free forever: terms checklist, stamps, countdown, 3 active claims, basic package.
**Pro (hypothesis: $19/truck/mo** — undercuts DockClaim $49): unlimited claims, premium package templates, follow-up automation, revised-ratecon tracking, priority human review. **Fleet (hypothesis: $15/truck/mo at 5+)**. Later: factoring referral partnerships (disclosed), broker-side tools, aggregate analytics subscriptions, API/white-label for dispatch services. **No % of recovery** (Phase 3). Introduce payment only after: a carrier has ≥1 paid/acknowledged claim through the tool (the "first recovered check" is the conversion trigger). Revenue milestones fund: LLC (~$150–$800 by state), Play ($25 one-time) + Apple ($99/yr), Supabase $25/mo.

---

## PHASE 11 — GO-TO-MARKET (zero → low budget)

Channels: FB owner-op groups (value posts, not ads) · r/Truckers (AMA-style detention-money posts) · TruckersReport forum · YouTube Shorts/TikTok: "This ratecon has no detention rate — here's what that costs you" ratecon-teardown series · free calculators already on site (detention calculator exists → add CTA) · dispatch clients as first users · factoring/dispatcher/insurance-agent partnerships (they want happier carriers) · SEO: "unpaid detention", "TONU claim letter", "lumper reimbursement" articles.
**Landing copy:** H1: "Stop eating detention." Sub: "Know your ratecon's real terms before you book, prove your wait with timestamps, and send brokers a claim package they can't ignore. Free for owner-operators while in beta." Features list = 6 bullets from MVP. Trust: "Your documents stay private. We never share or sell your rates. No card required. Built by a dispatch team, not a data broker." CTA: "Audit my next ratecon — free." Outreach/beta/referral scripts drafted in the registry file. Banned phrasing: "guaranteed recovery", "get paid every time", "legal action".

---

## PHASE 12 — FINANCIAL SCENARIOS

| Item | 1) Validation (30d) | 2) MVP launch | 3) 3-month pilot |
|---|---|---|---|
| Domain/hosting | $0 (existing Netlify) | $0 | $0–19/mo |
| DB/storage | $0 (Supabase free) | $0 | $25/mo when storage fills |
| Email | $0 (existing) | $0 | $0–15/mo |
| OCR/AI | $0 (manual/concierge) | $0 (rule-assist) | $0–50/mo optional LLM |
| Maps/SMS | $0 | $0 | $0 (push/email only) |
| Legal review | $0 (drafts only) | **$300–800 one-time (required before public launch)** | included |
| Registration (LLC) | $0 | $150–800 (state-dependent) | included |
| App stores | $0 | $0 (PWA) | $124 (optional, deferred) |
| Marketing | $0 (organic) | $0–100 | $100–500 |
| **Total** | **~$0** | **~$450–1,700 one-time** | **+~$50–110/mo** |

Costs start rising at: storage fill (Supabase $25/mo), first paid marketing, and legal/LLC gating public launch.

---

## PHASE 13 — ROADMAP (summary; granular tasks in registry)

- **P0 Research/validation (2–4 wks, $0)** — exit: gates in Phase 5 met.
- **P1 Concierge pilot (parallel, $0)** — 5 carriers, ≥6 claims; exit: ≥2 positive outcomes.
- **P2 PWA MVP (3–5 wks build, $0 infra)** — must-launch list inside Carrier Portal; entry: P0 pass + legal draft review; exit: 10 carriers, 25 claims, NPS-style ≥8/10 from 5 users.
- **P3 Automated recovery workflow (4–6 wks)** — follow-up automation, revised-ratecon diff, geofence assist; exit: 50 active carriers or first 10 paying.
- **P4 Small-fleet product (4 wks)** — claims board, roles; exit: 5 fleets 3+ trucks.
- **P5 Facility/broker intelligence** — entry: aggregation thresholds reached organically; exit: intel screens live with "insufficient data" honesty.
- **P6 Native apps** — entry: revenue covers $124+ maintenance; wrap PWA (Capacitor).
- **P7 Carrier OS** — ARC + dispatch + finance + compliance = existing portal converges.
- **P8 Marketplace/analytics** — entry: carrier density + broker demand signals; the DAT-class play.
Risks per phase tracked in registry (biggest: P2 legal signoff, P5 defamation/thresholds).

---

## PHASE 14 — EXECUTIVE VERDICT

**1. Conclusion.** ARC attacks a verified, quantified, worsening problem ($15.1B, 39.3% of stops, hardest on exactly LoadBoot's audience) with a workflow product LoadBoot is already ~60% equipped to build, on infrastructure that costs $0 to pilot — but it enters a niche where $49/mo single-feature competitors already exist, so the win depends on full-lifecycle depth, free entry, and trust, not novelty.

**2. Probability (brutally honest, SUBJECTIVE ESTIMATE):** as a venture on its own ("meaningful standalone revenue in 12 months"): **~20–25%**. As an audience-and-data wedge that gets LoadBoot 50–200 engaged carriers and a proprietary dataset within 12 months: **~45–55%** if validation passes and execution stays weekly-consistent. Failure mode is not competition — it's distribution (no audience) and trust (upload barrier).

**3. Top reasons it could succeed:** (a) enormous, documented, *recurring* pain concentrated in our exact segment; (b) 60% of the hard software already exists and is deployed; (c) "first recovered check" is a shareable, word-of-mouth moment competitors' timers don't produce.
**4. Top reasons it could fail:** (a) zero distribution/audience today; (b) carriers may not trust an unknown, unregistered brand with ratecons; (c) brokers ignoring packages → product produces paperwork, not money → churn.
**5. Best first segment:** US own-authority owner-operators, 1–3 trucks, spot freight via brokers, active in FB/Reddit trucking communities.
**6. Best first feature:** the **detention evidence clock** — arrive/depart stamps + free-time countdown + pre-deadline broker-notification draft + instant claim package.
**7. Most dangerous risk:** drifting into collection-agency/legal territory (sending claims as LoadBoot, % fees, "you're owed" language) and defamation via premature facility/broker scores.
**8. Next seven actions:** ① freeze current batch → commit/deploy; ② post recruiting message in 3 FB groups + r/Truckers (script in registry); ③ complete 8 interviews in 7 days; ④ run first 3 concierge claims with existing tools; ⑤ add "Free ratecon audit" landing section to site ($0); ⑥ get one attorney consult on the disclaimer + collection question (~$0–300, many give free first consults); ⑦ day-14 go/no-go against Phase 5 gates.
**9. DECISION: VALIDATE FIRST** — 14–30 day manual concierge validation, with pre-committed gates; on pass → **BUILD as flagship inside the Carrier Portal**; on fail → keep detention clock as a minor portal feature and re-evaluate (the fallback costs nothing since 60% exists).

---

## Master plan changes (add / remove / change)

**ADD:** P0 validation sprint as the immediate top priority · ARC feature track (registry) · legal-review gate before any public ARC launch · aggregate-threshold policy ("insufficient verified data") as a permanent product principle · "first recovered check" as the north-star activation metric.
**REMOVE / PARK:** driver email-invite flow (parked earlier — stays parked) · any near-term marketplace/two-sided features · public broker/facility ratings (until P5 thresholds + legal) · native app-store work (until revenue).
**CHANGE:** Rating engine (built this session) is repositioned as the seed of broker-payment intelligence — claims outcomes will feed it · Carrier Portal roadmap now leads to "Carrier OS" via ARC rather than more dashboard breadth · GA4/Search Console + legal-text owner actions remain open from previous sessions, unchanged.
