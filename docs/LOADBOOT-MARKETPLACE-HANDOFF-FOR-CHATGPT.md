# LoadBoot — Global Dispatch Marketplace Handoff for ChatGPT

**Purpose:** a complete, self-contained status of the marketplace build so you (ChatGPT) can give the next
directives. **Production:** `rwscphuhpjoudvljvmdk` · **Staging:** `snslhvmkjusozgjelghi` ·
**Branch:** `preview/command-center-v1` · **Live changelog:** `docs/SESSION-CHANGELOG.md`

Both databases are kept in **exact parity** (every changed function hash-identical). The **anonymous
SECURITY DEFINER surface is 5** on both, re-verified after every increment. The delivery/marketing engine from
the prior phase (increments 30–42) is intact and unchanged.

---

## 0. Owner decision applied
Partner scope is **BROKER ONLY**. Shipper partner flows were intentionally **not** built and the shipper
landing page was dropped, because moving freight directly from shippers in the US requires a broker license.

## 1. Honest gate
`FOUNDATION GATE: FAIL — PASS 10 / BLOCKED 2 / FAIL 0 of 12`. Unchanged. The 2 BLOCKED items need owner browser
logins (POD UI proof + persona matrix) and do not block marketplace development.

---

## 2. Increments completed this phase (43–47 + parallel marketing)

Each: applied to BOTH databases, proven by a SQL security matrix (JWT-claim persona simulation), frontend
passing syntax + import-reference + build checks, synced to the device repo.

| # | Increment | Proof |
|---|-----------|-------|
| 43 | Load-source normalization + Command Center Load Intake | LOAD INTAKE PASS (9) |
| 44 | Broker Load Wizard + mandatory-document checklist (broker only) | PARTNER WIZARD PASS (9) |
| 45 | Matching Stage A — explainable hard-eligibility | MATCH ENGINE PASS (8) |
| 46 | Matching Stage B — explainable ranking + Match Center UI | (same matrix) |
| 47 | Offer waves, expiry, carrier response | OFFERS PASS (11) |
| — | Parallel: brand asset audit + branded email header/footer | build + audit |
| — | Parallel: dedicated carriers.html + brokers.html pages | build isolation OK |

---

## 3. Data model (additive; existing tables reused)

- **`public.loads`** +11 columns: `source_type` (11 sources: partner_portal / staff_entered /
  licensed_integration / official_api / uploaded_document / imported / unverified_external / quote_converted /
  recurring_lane / duplicated / api_client), `source_provider`, `source_reference`, `verification_state`
  (unverified/partial/verified), `confidence` (low/med/high), `source_updated_at`, `created_by`, `broker_org`,
  `shipper_org` (unused — broker-only), `version`, `field_meta`.
- **`app_private.partner_loads`** +9 columns: delivery_date, pickup/delivery windows, stops, appointment_required,
  tracking_required, accessorials, reference, submitted_at.
- **`app_private.load_document_checklist`** (new): subject_type(partner_load|load), subject_id, doc_key, label,
  required_from(broker|carrier), status(required/received/verified/rejected/expired/waived), due_at.
- **`app_private.load_offers`** (new): load_id, carrier_id, offered_rate, score, status
  (sent/viewed/accepted/declined/expired/countered), sent_at, expiry_at, viewed_at, responded_at,
  decline_reason, counter_rate, message. unique(load_id, carrier_id).

## 4. RPCs added (all staff- or self-scoped; anon revoked)

- **Load Intake:** `cc_create_load_sourced` (source_type required — no silently-"verified" data),
  `cc_load_intake_list`, `cc_load_set_verification`.
- **Broker wizard:** `cc_partner_submit_load` (eligibility + 24h duplicate detection + checklist generation),
  `cc_load_checklist` (staff or owning broker), `cc_load_checklist_set` (staff).
- **Matching:** `cc_match_eligibility(load)` → per-carrier eligible + structured `hard_fails[]` + `missing_data[]`;
  `cc_match_rank(load)` → ranks ONLY eligible carriers with score = SUM of an explained per-factor breakdown.
  Deadhead/ETA are honestly reported unavailable (no invented GPS).
- **Offers:** `cc_offer_send(load, carriers[], rate, expiry)` (eligibility re-checked at send — ineligible
  skipped), `cc_offer_respond(offer, view|accept|decline|counter, …)` (concurrency-safe, self-scoped),
  `cc_offers_expire`, `cc_load_offers` (staff), `cc_carrier_offers` (carrier).

## 5. Frontend

- Command Center **Load Intake** (`/load-intake`, flag `load_marketplace`): source/verification KPIs, filters,
  source-attributed New-load composer, Verify action, and a **Match** action per load.
- Command Center **Match Center** drawer: ranked eligible carrier cards with "Why this score" factor breakdown,
  loaded RPM, equipment fit; a collapsible "Ineligible carriers (with reasons)" list; per-carrier **Send offer /
  Re-offer**, an **Offer wave → top 3**, and live offer-status pills.
- Partner Portal broker dashboard: **multi-step Load Wizard** (Lane → Schedule → Equipment → Requirements →
  Review) with duplicate-confirm handling.
- Marketing: `carriers.html` (~14 sections) + `brokers.html` (~12 sections, broker-only), linked from footer +
  sitemap; professional branded email header/footer (authentic logo) in the delivery worker.

## 6. Integrity / safety properties (all proven)
- An **ineligible carrier is never offered** a load (eligibility hard-filters at match AND re-checked at send).
- **No unexplained scores** — every rank score equals the sum of shown factor points.
- **No invented GPS** — deadhead/ETA are honestly marked unavailable until tracking exists.
- **Duplicate detection** on broker submissions (24h same-lane guard, confirm to override).
- **Cross-tenant isolation** — carriers only see/act on their own offers; broker only their own loads/checklists.
- **Source honesty** — staff must attribute a load's source; nothing is auto-marked verified.
- Feature-flagged OFF in production for controlled activation; no incomplete routes exposed in prod.

## 7. Events emitted (available to the webhook fan-out from the prior phase)
`load.created`, `partner.load_submitted`, `offer.created`, `offer.responded`.

## 8. What remains (owner lane — nonblocking)
Push `preview/command-center-v1` (ships frontend), set provider secrets + deploy edge functions (enables real
sending), run the 2 browser proofs (locks 12/12). None block further increments.

## 9. Next executable increments (48–64)
48 transactional first-valid-acceptance + assignment (creates trip) · 49 booking checklist + rate-confirmation ·
50 Trip Control Tower + partner visibility · 51 location/geofence/ETA foundation · 52 detention/accessorial
automation · 53 Exception Center · 54 partner doc/update-request · 55 carrier P&L · 56 finance lifecycle ·
57 carrier page enrichment (done) · 58 broker page enrichment (done) · 59 shipper page (DROPPED — broker only) ·
60 service-page depth · 61 email header/footer (core done) · 62 operational template library · 63 workflow
builder · 64 dispatch BI.

**Recommended next:** Increment 48 (transactional acceptance + assignment) — it turns an accepted offer into a
booked load + trip with concurrency-safe first-valid-wins, which is the keystone of the marketplace flow.
