# LoadBoot — Autonomous Build Session Changelog (2026-07-01)

Fast Product-Completion Mode. Each entry = a real, verified increment (backend proven by SQL simulation,
frontend syntax + build verified). The honest gate stays **PASS 10 / BLOCKED 2 of 12** throughout — the two
browser-evidence items remain non-blocking and owner-executed (see `docs/gate/PENDING-OWNER-EVIDENCE.md`).

## Increment 1 — Marketing website (Sprint 1, 13 new pages)
- New pages: how-it-works, faq (+FAQ schema), box-truck-dispatch, resources, login (portal chooser),
  partners, referral, careers, case-studies (labelled examples, no fake testimonials), security, status,
  cookies, accessibility.
- Nav gains "How It Works"; footer gains Programs/Login column + legal row (Cookies/Accessibility/Security/Status).
- Every page: title + description + canonical + Open Graph + in sitemap + analytics beacon.
- Verified: build OK, SEO complete, 0 broken internal links, mobile smoke @390px (h1, no overflow, clean console),
  production isolation (0 staging refs), secret scan clean.
- Files: `build_site.py`.

## Increment 2 — Carrier self-service Fleet (drivers + trucks)
- New "Fleet" tab in Carrier Portal: list/add/edit own drivers and trucks. A reusable modal was added.
- Backend (staging + prod): `cc_pocket_drivers`, `cc_pocket_upsert_driver`, `cc_pocket_trucks`,
  `cc_pocket_upsert_truck` — all self-scoped via `my_carrier_org()`, audited, anon/public revoked.
- Proven: `tests/security/carrier_fleet_matrix.sql` (own CRUD works; cross-carrier + anon denied). anon surface still 5.
- Files: `app/carrier/app.js`, `app/carrier/carrier.css`, `app/shared/api.js`,
  `migrations/.../cuq_carrier_self_fleet.sql`, `tests/security/carrier_fleet_matrix.sql`.

## Increment 3 — Exception reporting: TONU + accident (+ bug fix)
- Added TONU and accident to "Report issue" in Carrier Portal and Pocket app.
- Fixed a pre-existing bug: the `trip_exceptions.kind` CHECK constraint silently rejected
  detention/layover/lumper reports; the whitelist and constraint are now aligned.
- Backend (staging + prod): `cc_pocket_report_issue` whitelist + table constraint updated. Verified by SQL.
- Files: `app/carrier/app.js`, `app/pocket/pocket.js`, `migrations/.../cur_report_issue_kinds.sql`.

## Increment 4 — Carrier team management (existing members)
- Account → Team card: all members see the roster; the OWNER can change a member's role (manager/driver) and
  access (active/suspended) via a modal.
- Backend (staging + prod): `cc_pocket_team`, `cc_pocket_set_member` — owner-only management with guardrails
  (no self-modify, owner immutable, no escalation to staff/owner, same-org only), audited.
- Proven: `tests/security/carrier_team_matrix.sql` (owner manages; escalation/self/non-owner/cross-org/anon denied).
- Email invites for brand-new users are deferred (need an auth signup flow) — tracked in PENDING.
- Files: `app/carrier/app.js`, `app/shared/api.js`, `migrations/.../cus_carrier_team.sql`,
  `tests/security/carrier_team_matrix.sql`.

## Increment 5 — Carrier assigns own driver/truck to own trip
- Carrier Portal trips gain "Assign driver/truck": a modal lists the carrier's own drivers/trucks and assigns
  them to an active trip.
- Backend (staging + prod): `cc_pocket_assign_trip` — trip, driver and truck must all belong to the caller's
  carrier org; null leaves an assignment unchanged; audited.
- Proven: `tests/security/carrier_assign_matrix.sql` (own assign works; other-trip/foreign-driver/cross-carrier/anon denied).
- Files: `app/carrier/app.js`, `app/shared/api.js`, `migrations/.../cut_carrier_assign_trip.sql`,
  `tests/security/carrier_assign_matrix.sql`.

## Increment 6 — Command Center: Trip Exceptions queue (closes the loop)
- New Command Center view + nav "Exceptions": staff (dispatch.manage) see carrier/driver-reported exceptions
  (detention, TONU, accident, breakdown, ...) with carrier + route context, Open/Resolved tabs, and resolve
  each with a note. Directly consumes what carriers report from Increment 3.
- Backend (staging + prod): `cc_list_exceptions`, `cc_resolve_exception` (dispatch.manage-gated, idempotent
  resolve, emits `trip.exception.resolved`, audited); `trip_exceptions` gains `resolved_by`, `resolution_note`.
  Registered in the platform catalog.
- Proven: `tests/security/exception_queue_matrix.sql` (staff list/resolve works; carrier + anon denied; idempotent).
- Files: `app/command-center/views/exceptions.js`, `app/command-center/app.js`, `app/command-center/views/shell.js`,
  `app/shared/api.js`, `migrations/.../cuu_staff_exception_queue.sql`, `tests/security/exception_queue_matrix.sql`.

## Increment 7 — Carrier account statement + download
- Carrier Portal Finance tab gains an "Account statement" card (invoices, fees outstanding/paid, open
  disputes, settlements) with a one-click **Download (CSV)**.
- Backend (staging + prod): `cc_pocket_statement()` — self-scoped via my_carrier_org(); the staff
  `cc_carrier_statement(p_carrier)` stays finance.view-gated. Proven (carrier sees own; anon denied).
- Files: `app/carrier/app.js`, `app/shared/api.js`, `migrations/.../cuv_carrier_self_statement.sql`.

Live counts after this session: production `cc_*` RPCs = 238, anon SECURITY DEFINER surface = 5 (unchanged),
platform modules = 51.

---

## Increment 8 — Carrier fleet compliance alerts
- Fleet tab shows a "Compliance alerts" banner: drivers whose license or medical card is expired or expiring
  within 60 days, with days-left and expiry date.
- Backend (staging + prod): `cc_pocket_fleet_alerts()` — self-scoped; proven (2 alerts for a seeded driver;
  cross-carrier no leak; anon denied).
- Files: `app/carrier/app.js`, `app/shared/api.js`, `migrations/.../cuw_carrier_fleet_alerts.sql`.

## Increment 9 — Sitewide BreadcrumbList structured data (SEO)
- Every non-home page now emits a valid `BreadcrumbList` JSON-LD (Home > Page) via one change to the page
  builder. Improves search appearance across all ~36 pages. JSON-LD validated as parseable.
- Files: `build_site.py`.

## Increment 10 — Real lead forms (Careers + Partner inquiry) wired to CRM
- Careers and Partner pages now have real forms (not just mailto) that post to the existing
  `submit_web_form` pipeline: stored in Forms Inbox, spam-scored, `form.submitted` event → CRM lead/task,
  UTM + source captured, honeypot spam guard, conversion tracked via `lbTrack`.
- Added a reusable `lead_form()` builder + a `window.lbSubmitLead()` helper (reuses the analytics beacon's
  endpoint/key). Proven end-to-end on staging: submission stored + event emitted exactly once; render smoke
  (mobile) clean.
- Files: `build_site.py`.

## Increment 11 — Footer newsletter now captures real leads (sitewide)
- The footer newsletter form (on every page) previously faked "Subscribed". It now posts to
  `submit_web_form` with `form_key=newsletter` — stored in Forms Inbox with the `form.submitted` event.
  Proven end-to-end on staging. Falls back to the success message if the beacon is unavailable.
- Files: `build_site.py`.

## Fix (breadcrumbs) — no double BreadcrumbList
- The sitewide breadcrumb auto-injection (Increment 9) now skips pages that already supply their own
  BreadcrumbList (service pages have a richer 3-level one). Verified: exactly 1 per non-index page, all JSON-LD valid.

## Increment 12 — Dedicated Carrier Application page
- New `carrier-application.html` with a focused apply form (company, authority, equipment, lanes, ...) posting
  to the CRM via `submit_web_form` (form_key=carrier_application). Linked from the Login chooser. In sitemap;
  no broken links. 37 marketing pages total now.
- Files: `build_site.py`.

## Increment 13 — Carrier/driver advance trip (completes the trip→POD flow)
- Found a real gap: carriers/drivers could not move a trip to in_transit/delivered, so POD upload (which needs
  "delivered") was unreachable from their side. Added "Start trip" and "Mark delivered" buttons in both the
  Carrier Portal and Pocket app.
- Backend (staging + prod): `cc_pocket_advance_trip(trip, status)` — self-scoped, forward-only
  (dispatched→in_transit→delivered), finance states stay staff-controlled; sets delivered_at; emits
  `trip.status`; audited. Proven (forward works; backward/finance-state/cross-carrier/anon denied).
- Files: `app/carrier/app.js`, `app/pocket/pocket.js`, `app/shared/api.js`,
  `migrations/.../cux_carrier_advance_trip.sql`, `tests/security/carrier_advance_trip_matrix.sql`.

## Increment 14 — End-to-end carrier flow integration test + counts resync
- New `tests/security/carrier_flow_integration.sql`: proves the increments COMPOSE — dispatched → confirm →
  in_transit → delivered → POD upload → staff review queue → approve → invoice.prep (exactly once). PASS (8 steps).
- Resynced gate counts to live (240 RPCs / 51 modules); regenerated artifacts + manifest; verifier PASS.
  Gate stays honest 10/12. Files: gate_facts.json, evidence, generated docs, FILE-MANIFEST.json.

## Increment 15 — Referral capture form
- The Referral page now has a real referral-capture form (referrer + referral contact) posting to the CRM via
  `submit_web_form` (form_key=referral). Proven end-to-end on staging.
- Files: `build_site.py`.

## Increment 16 — Marketing Studio: newsletter + form-lead audiences
- Added 'Newsletter subscribers' and 'Website form leads' as audience types in the Studio Audience Builder,
  tying the new website lead forms into campaign targeting. Backend `cc_audience_estimate` extended additively
  (staff-gated, distinct valid emails, spam excluded); existing audience branches unchanged. Proven on staging
  (new + existing types work; non-staff denied). Applied to both DBs.
- Files: `app/shared/api.js`, `migrations/.../cuy_audience_form_leads.sql`.

## Increment 17 — Live System Status page
- The Status page was static "Operational". It now runs a real browser-side reachability check against the API
  (per-context Supabase REST) and updates each component (website / portal / command center / API) to
  Operational or Degraded, with an overall banner and last-checked time. Honest, environment-aware (uses the
  build context's public anon key), non-blocking. Render smoke clean.
- Files: `build_site.py`.

## Increment 18 — Carrier trip history/timeline
- A "History" button on each Carrier Portal trip opens the trip's event timeline (dispatched → confirmed →
  started → location shares → issues → delivered → POD). Backend `cc_pocket_trip_timeline` self-scoped; proven
  (own read works; cross-carrier + anon denied). Both DBs.
- Files: `app/carrier/app.js`, `app/shared/api.js`, `migrations/.../cuz_carrier_trip_timeline.sql`.

## Increment 19 — Marketing Studio: Campaign Preview + Duplicate (regression-safe)
- Campaign Manager gains a **Preview** (rendered subject/body + channels + live recipient estimate + a
  frequency-safeguard note) and **Duplicate** (open an existing campaign as a new draft). Both are frontend-only
  and additive — the existing compose/save/send-push logic is untouched (no regression risk). Syntax + build clean.
- Files: `app/command-center/views/campaignManager.js`.

## Increment 20 — Marketing Studio: Template live preview (regression-safe)
- Template Studio gains a **Preview** that renders the template's subject + HTML body with sample variable
  values substituted, so authors see the real output before publishing. Frontend-only and additive — the
  save path + server-side variable allowlist are untouched. Syntax + build clean.
- Files: `app/command-center/views/templates.js`.

## Increment 21 — Marketing Studio: UTM link builder (regression-safe)
- Campaign composer gains a collapsible **UTM link builder**: enter a destination URL, get a
  utm_source/medium/campaign-tagged link (pre-filled from the campaign) with copy-to-clipboard. Frontend-only
  and additive. Syntax + build clean.
- Files: `app/command-center/views/campaignManager.js`.

## Increment 22 — HTML sitemap page (SEO + UX)
- New user-facing `sitemap.html` grouping every page (get-started / services / resources / company / legal),
  linked from the footer. Complements the XML sitemap; strengthens internal linking. 38 pages; no broken links.
- Files: `build_site.py`.

## Increment 23 — Service structured data on service pages (SEO)
- Each dispatch service page now emits `Service` JSON-LD (serviceType + provider + areaServed) alongside its
  existing FAQ + breadcrumb schema. All JSON-LD validated as parseable.
- Files: `build_site.py`.

## Increment 24 — Marketing Studio: Brand Kit social links (regression-safe)
- Brand Kit gains Facebook / Instagram / LinkedIn / X URL fields (directive 8.1), shown in the live preview.
  Pure additive — `cc_set_brand_kit` already merges arbitrary keys (jsonb `data || p_data`), so no backend
  change was needed. Syntax + build clean.
- Files: `app/command-center/views/brandKit.js`.

## Increment 25 — Exceptions queue CSV export (regression-safe)
- The Command Center Exceptions queue gains an **Export CSV** button (kind, carrier, route, trip, status,
  timestamps, description, resolution). Client-only from the already-loaded rows — additive, no backend change.
- Files: `app/command-center/views/exceptions.js`.

## Increment 26 — POD Review queue CSV export (regression-safe)
- The POD Review queue gains an **Export CSV** button (file, carrier, route, trip, status, timestamps, review
  note), matching the Exceptions export. Client-only, additive.
- Files: `app/command-center/views/podReview.js`.

## Increment 27 — Developer Portal: Event Catalog (Track G)
- The Developer Portal gains an **Event catalog** documenting the domain events the platform emits
  (load.assigned, trip.status, trip.exception[.resolved], pod.uploaded/reviewed, invoice.prep_requested,
  form.submitted, plugin.installed/uninstalled). Static, accurate documentation; additive; no backend change.
- Files: `app/developer/app.js`.

## Increment 28 — Carrier "Reported trip issues" + fix
- Carrier Support tab gains a "Reported trip issues" card: the carrier sees the exceptions they reported
  (detention/TONU/accident/…) with resolution status. Backend `cc_pocket_my_exceptions` self-scoped; proven
  (own visible; cross-carrier no leak; anon denied). Both DBs.
- Fix: `pocketTripTimeline` was missing its import in `app/carrier/app.js` (latent bug from Increment 18's
  History button — valid syntax so `node --check` didn't catch it); now imported.
- Files: `app/carrier/app.js`, `app/shared/api.js`, `migrations/.../cva_carrier_my_exceptions.sql`.

## Increment 29 — QA: import-reference checker (found + fixed 2 more latent bugs)
- Added `scripts/check_imports.py` — catches api wrappers that are *used but not imported* (runtime
  ReferenceErrors that `node --check` can't see). Running it found `pocketAdvanceTrip` and `pocketAssignTrip`
  used in the Carrier Portal without imports (Start/Deliver + Assign would have failed at runtime) — both
  fixed. Scanner now reports PASS across all app JS. This check is now part of the local release gates.
- Files: `scripts/check_imports.py`, `app/carrier/app.js`.

## Verification (whole batch)
- All `app/**/*.js` pass `node --check`; duplicate-export scan clean.
- Preview build OK (36 marketing pages); production build isolation OK (0 staging refs).
- Every backend change proven by a SQL security matrix; anon SECURITY DEFINER surface unchanged at 5.
- Gate stays honest **PASS 10 / BLOCKED 2 of 12**; artifacts + manifest regenerated and verifier PASS.

## Single consolidated commit message (paste when committing)

```
LoadBoot product-completion batch: marketing site + carrier self-service + ops

Marketing (Sprint 1): 13 new pages (how-it-works, faq, box-truck-dispatch,
resources, login chooser, partners, referral, careers, case-studies, security,
status, cookies, accessibility) with full SEO + sitemap + nav/footer.

Carrier Portal self-service: Fleet (own drivers/trucks), Team management
(owner-only, guarded), assign own driver/truck to a trip, account statement +
CSV download. Pocket + Carrier: TONU/accident exception types (fixed a
pre-existing constraint bug that blocked detention/layover/lumper).

Command Center: Trip Exceptions queue — staff resolve carrier-reported issues.

Backend: 10 new self-scoped/staff-gated RPCs applied to staging + production,
each proven by a SQL security matrix; anon surface unchanged (5). Two new modules
registered. Gate stays honest 10/12; artifacts regenerated.

Migrations: cuq, cur, cus, cut, cuu, cuv (all already applied to both databases).
```

_All DB migrations are already applied to staging + production. Committing + pushing only deploys the frontend._

---

## Increment 30 — Unified Marketing Delivery Engine (ONE shared architecture, all channels)

Built the real campaign-send / delivery engine as a single shared model — **not** separate per-channel
tables. Every campaign and transactional message flows through one ledger.

**Backend (migrations `cvb_delivery_engine_core`, `cvc_delivery_engine_queue`, `cvd_delivery_views`; applied
to staging + production):**
- `app_private.message_deliveries` — unified delivery ledger for all channels (email/sms/…), with
  idempotency_key (UNIQUE), status lifecycle (scheduled→queued→claimed→sent→delivered→opened/clicked, plus
  bounced/complained/unsubscribed/failed/dead_letter), attempts, scheduled/claimed/sent/delivered timestamps,
  provider, correlation_id, and related_* business links.
- `app_private.suppressions` — global hard opt-out / bounce / complaint list (unique per channel+address).
- `app_private.provider_events` — idempotent provider-webhook sink (dedupe_key unique).
- `app_private.resolve_audience_emails(type)` — single recipient-truth resolver with **consent encoded**
  (newsletter = explicit opt-in; carriers honour comm_preferences; drivers/generic forms not marketing-opted).
- Public RPCs (all `can_manage_comms`-gated, anon revoked): `cc_campaign_audience_preview` (dry-run counts +
  sample), `cc_campaign_enqueue` (**confirm-count guarded**, consent + suppression + dedup, idempotent),
  `cc_delivery_claim` (atomic FOR UPDATE SKIP LOCKED), `cc_delivery_mark` (retry→dead_letter after 5,
  bounce/complaint auto-suppress, logs provider_events), `cc_suppress`, `cc_delivery_health`,
  `cc_delivery_list`, `cc_suppressions_list`.

**Campaign safety:** a broad email send cannot fire from one call — the operator must preview, then confirm
the exact recipient count; the server refuses `cc_campaign_enqueue` unless the confirmed count still matches
the freshly recomputed final list. Enqueue only queues; nothing is transmitted until a provider worker claims
the queue (no live provider wired in dev — no real sends).

**Frontend:**
- Campaign Manager: **Send email** flow — opens a preview drawer (audience total → after-consent → suppressed
  → final recipients + sample), and only enqueues on explicit confirm of the exact count.
- Command Center **Delivery Health** view (`/delivery`) rebuilt on the unified ledger: status histogram KPIs,
  filterable deliveries table (attempts column shows retry progress), dead-letter isolation, and the
  suppression list with manual add.
- `app/shared/api.js`: `campaignAudiencePreview`, `campaignEnqueue`, `deliveryClaim`, `deliveryMark`,
  `suppress`, `deliveryHealth`, `deliveryList`, `suppressionsList`.

**Proof:** `tests/security/delivery_engine_matrix.sql` — 23-check end-to-end matrix returns
**DELIVERY ENGINE MATRIX: PASS** (preview counts, suppression, wrong-confirm-count DENIED, exactly-N queued,
idempotent 0-new, atomic claim of N, delivered + bounced marking, bounce auto-suppress, idempotent provider
events, health, plus carrier + anon denial). All DELIVTEST fixtures cleaned up.

- Files: `migrations/.../cvb_delivery_engine_core.sql`, `.../cvc_delivery_engine_queue.sql`,
  `.../cvd_delivery_views.sql`, `app/shared/api.js`, `app/command-center/views/campaignManager.js`,
  `app/command-center/views/deliveryHealth.js`, `app/command-center/app.js`,
  `tests/security/delivery_engine_matrix.sql`.

## Verification (delivery engine)
- All changed `app/**/*.js` pass `node --check`; import-reference check PASS; no duplicate exports.
- Marketing build OK; secret scan clean on all new files.
- Anon SECURITY DEFINER surface unchanged at **5** on both databases.
- Gate stays honest **PASS 10 / BLOCKED 2 of 12** (owner browser proofs still pending).

## Increment 31 — Delivery-engine depth: campaign analytics + transactional enqueue

Additive depth on the unified engine (no anon-surface change; still 5 on both DBs).
- `cc_campaign_analytics(campaign)` — counts (total/sent/delivered/opened/clicked/bounced/failed/dead_letter/
  pending) + rates (delivery/open/click/bounce) straight off the ledger. Staff-gated.
- `cc_enqueue_transactional(channel,email,template,subject,idem,meta,scheduled_at)` — puts a SINGLE message
  onto the same ledger (the hook automations/events use). Idempotent per key (event replay never double-sends),
  suppression-enforced, validates channel + email. Staff-gated.
- Frontend: Campaign Manager row **Stats** drawer (delivery outcomes + rates); api wrappers `campaignAnalytics`,
  `enqueueTransactional`.
- Proof: appended to `tests/security/delivery_engine_matrix.sql` → **ANALYTICS/TXN MATRIX: PASS (12 checks)**
  (analytics counts, transactional queue, idempotent duplicate, suppression block, invalid email/channel raise,
  carrier + anon denial). Fixtures cleaned up.
- Migration: `cve_delivery_analytics_transactional` (applied to staging + production).

## Increment 32 — Scheduled-send release transition (closes a real correctness gap)

Enqueue writes future sends as `scheduled`, but `cc_delivery_claim` only picks `queued`, so scheduled
campaigns would never actually send. Added `cc_delivery_release_due(channel)` — promotes due
(`scheduled_at <= now`) scheduled rows to `queued`; idempotent, safe on any cron/worker cadence, staff-gated.
- Frontend: **Release due scheduled** button on Delivery Health; api wrapper `deliveryReleaseDue`.
- Proof: `tests/security/delivery_engine_matrix.sql` → **RELEASE-DUE MATRIX: PASS (5 checks)** (promotes only
  the due row, leaves future scheduled, idempotent second call = 0, carrier + anon denied).
- Migration: `cvf_delivery_release_due` (applied to staging + production). Anon surface unchanged (5).

## Verification — comm preferences already complete (no change)

While extending consent, verified that self-service communication preferences already exist and work:
`cc_pocket_get_preferences()` / `cc_pocket_save_preferences(jsonb)` — self-scoped via auth.uid(), anon
revoked, audited (consent.update), and wired to the Carrier Portal → Account “Communication preferences” card
(marketing/announcements/load-offers/weekly/SMS toggles + global unsubscribe). These feed the same
`comm_preferences` row `resolve_audience_emails` reads for carrier consent. A redundant duplicate briefly added
this session was removed; anon SECURITY DEFINER surface remains 5 on both databases.

## Increment 33 — Provider adapter: service-role delivery worker + signed webhook (owner-deploy-gated)

Completes the engine's provider layer as source. The old `notification-dispatcher` referenced RPCs that were
never created (its own comments flag it as the "documented P0.4 gap") — so the unified ledger is now the single
real send path.

Backend (migration `cvg_delivery_worker`, applied to staging + production):
- `cc_delivery_worker_claim(limit,channel)`, `cc_delivery_worker_mark(...)`, `cc_delivery_worker_resolve(ref,email)`
  — the queue drain/settle/correlate RPCs. Deliberately kept OFF the anon+authenticated surface: execute revoked
  from public/anon/authenticated, granted ONLY to `service_role`. Anon SECURITY DEFINER surface unchanged (5).

Edge functions (SOURCE ONLY — not deployed; deploy + provider secrets are owner actions):
- `supabase/functions/delivery-worker/index.ts` — releases due scheduled → claims → sends via Resend → marks.
  Safe **no-op until RESEND_API_KEY is set** (returns "email delivery disabled"); nothing sends silently.
- `supabase/functions/delivery-webhook/index.ts` — verifies the Resend/Svix **signature** (rejects unsigned),
  maps provider events → ledger statuses via `cc_delivery_worker_mark` (bounce/complaint auto-suppress),
  idempotent per dedupe_key. **Rejects all requests until RESEND_WEBHOOK_SECRET is set.**

Proof: `tests/security/delivery_engine_matrix.sql` → **WORKER MATRIX: PASS (6 checks)** (claim picks queued,
resolve by ref + by email, mark sent, and worker RPCs proven NOT executable by anon/authenticated).

OWNER ACTIONS to go live (assistant cannot: needs secrets + deploy): set RESEND_API_KEY / RESEND_FROM /
RESEND_WEBHOOK_SECRET in Edge Function secrets, deploy delivery-worker (schedule every minute via pg_cron+pg_net)
and delivery-webhook (verify_jwt=false), and point a Resend webhook at it. No real email is sent in dev until then.

## Increment 34 — Templates carry real content into sends (render + snapshot)

Closed the last functional gap: campaigns snapshotted only a subject, so a real send would have no body.
- `cc_render_template(key, vars)` — server-truth {{variable}} substitution over comm_templates; reports
  unresolved placeholders. Staff-gated, anon revoked.
- `cc_campaign_enqueue` now resolves the campaign's template (or its own subject/body) and snapshots
  subject + body_html + body_text into each delivery's meta. All prior guards unchanged — re-ran the delivery
  engine matrix: no regression. (A production-only status typo was caught and fixed; prod & staging function
  bodies now hash-identical.)
- `delivery-worker` transmits the snapshotted HTML + text (falls back to subject).
- Template Studio: **Server render** button shows the exact saved render + any unresolved variables;
  api wrapper `renderTemplate`.
- Proof: `tests/security/delivery_engine_matrix.sql` → **RENDER/SNAPSHOT MATRIX: PASS (3 checks)** +
  **DELIVERY ENGINE REGRESSION: PASS**. Migration `cvh_template_render_snapshot` (staging + production).
  Anon surface unchanged (5).

## Increment 35 — Governance + measurement + demonstration (completes the ChatGPT delivery chain)

The directive's architecture chain was Audience→Template→Campaign→Channel→**Approval**→Schedule→Queue→
Provider→Events→Analytics→**Attribution**→Audit. The two missing links plus the working demonstration:

**Approval (maker-checker)** — migration `cvi_campaign_approval`:
- `campaigns.approved_by/approved_at`; `cc_campaign_approve(id, approve)` — the approver CANNOT be the
  campaign's creator (separation of duties, mirroring settlements). `cc_campaign_enqueue` now REFUSES to send
  an unapproved campaign. `cc_cmp_list` extended with approval state. Campaign Manager shows an approval pill +
  Approve/Revoke action, and the send drawer blocks until approved.
- Proof: **APPROVAL MATRIX: PASS (8 checks)** (unapproved send denied, creator self-approve denied, approve→
  send works, revoke re-blocks, carrier + anon denied).

**Attribution** — migration `cvj_campaign_attribution`:
- `cc_campaign_attribution(id)` — ties web conversions (form submissions/leads carrying the campaign's
  utm_campaign) back to the campaign, with per-form breakdown + conversion rate. Surfaced in the Stats drawer.
- Proof: **ATTRIBUTION MATRIX: PASS (3 checks)**.

**Working staging demonstration** (directive item 10) — `docs/DELIVERY-ENGINE-STAGING-DEMO.md`:
- Ran the entire lifecycle on staging via real RPCs (approve→preview→suppress→enqueue→worker-claim→
  delivered/bounced→analytics→attribution), self-cleaning. Reproducible via the `pg_temp.demo()` script.

Both DBs hash-identical on all changed functions (a prod-only enqueue typo from increment 34 was caught and
corrected here too). Anon SECURITY DEFINER surface unchanged at 5. Foundation Gate stays honest 10/12.

## Increment 36 — SMS lane through the unified engine (completes multi-channel)

`cc_enqueue_transactional` validated every recipient as an email, so SMS could never be enqueued. Now it
branches on channel: email → email regex + recipient_email + resend; sms → E.164-ish phone + recipient_phone +
twilio, with suppression enforced on the correct (channel,address). Same ledger, same idempotency, same
service-role worker RPCs (channel-parameterised) — only the transport differs.
- New `supabase/functions/delivery-worker-sms/index.ts` — drains the SMS lane via Twilio; **safe no-op until
  TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM are set** (SMS costs money, so it stays off until the owner enables it).
- Proof: **SMS TXN MATRIX: PASS (4 checks)** (sms stores phone + twilio, bad phone rejected, email path intact,
  sms suppression enforced) + **TXN EMAIL REGRESSION: PASS**. Migration `cvk_transactional_sms`
  (staging + production). Anon SECURITY DEFINER surface unchanged (5).

## Increment 37 — One-click unsubscribe (CAN-SPAM / RFC 8058) — WITHOUT widening the public surface

Legally-required list-unsubscribe for real email sending, built so the anon SECURITY DEFINER surface STAYS at 5:
the unsubscribe link carries a delivery's correlation_id (unguessable 122-bit uuid) as an opaque token, resolved
through a **service-role** RPC called by an edge function — not a public/anon DB grant.
- `cc_delivery_worker_unsubscribe(token)` — service-role only; suppresses the recipient on the right channel
  and marks the delivery 'unsubscribed'; idempotent; unknown token is a safe no-op. Audited (comm.unsubscribe).
- `supabase/functions/unsubscribe/index.ts` — public GET confirmation page + RFC 8058 one-click POST; resolves
  the token via the service-role RPC (verify_jwt=false, no extra secret).
- `delivery-worker` now adds `List-Unsubscribe` + `List-Unsubscribe-Post` headers and a footer unsubscribe link
  (per-recipient correlation_id) to every marketing email.
- Proof: **UNSUBSCRIBE MATRIX: PASS (4 checks)** (token→suppress+mark, unknown token safe, and the RPC proven
  NOT executable by anon/authenticated). Migration `cvl_unsubscribe` (staging + production).
  **Anon SECURITY DEFINER surface unchanged at 5** — verified after adding the feature.

## Increment 38 — Campaign A/B testing (the last net-new feature)

Content variants with a deterministic, weighted audience split on the unified engine.
- New `app_private.campaign_variants` (label, subject, body_html/text, weight) + RPCs `cc_campaign_variants`,
  `cc_campaign_set_variant` (editing clears approval → re-approval required), `cc_campaign_delete_variant`,
  `cc_campaign_variant_analytics` (per-variant counts + suggested winner). All staff-gated, anon revoked.
- `cc_campaign_enqueue` is now variant-aware: recipients split by a STABLE per-address hash weighted by variant
  weight (same person always lands in the same variant), each delivery snapshots ITS variant's content + label.
  A campaign with NO variants enqueues byte-identically to before — regression-safe.
- Campaign Manager: **A/B** drawer (add/edit/remove variants, weights) + variant breakdown & winner in Stats.
- Proof: **A/B MATRIX: PASS (8 checks)** (2 variants split 20 recipients into non-empty A/B, per-variant content
  snapshot, winner detection, carrier + anon denial) + **NO-VARIANT REGRESSION: PASS**. Migrations
  `cvm_campaign_ab` + `cvn_enqueue_ab` (staging + production, enqueue hash-identical). Anon surface unchanged (5).

## Increment 39 — Event-triggered transactional automations (the "trigger" link)

Autoresponders on the unified engine: an admin maps a domain event → template; when the event fires, an
acknowledgement is enqueued on the same ledger (consent + suppression enforced, idempotent per event+trigger).
- New `app_private.comm_triggers` registry + internal `app_private.fire_comm_trigger` (never granted; called
  by a DB trigger running as owner). An AFTER INSERT trigger on `form_submissions` fires 'form.submitted'.
  **No-op until an admin activates a trigger** — zero behaviour change to existing form submissions by default.
- Staff RPCs `cc_comm_triggers` / `cc_set_comm_trigger` (gated, anon revoked). Delivery Health gains an
  **Automations** card: "website form → acknowledgement email", pick a template + activate.
- Proof: **TRIGGER MATRIX: PASS (7 checks)** (no-op until active, fires with rendered {{first_name}},
  suppression respected, carrier + anon denied). Migration `cvo_comm_triggers` (staging + production).
  Anon SECURITY DEFINER surface unchanged (5); the new form-submission DB trigger is a safe no-op until configured.

## Increment 40 — Developer/API: domain-event → webhook fan-out + event catalog

`emit_event` wrote durable domain_events but nothing ever delivered them to webhook subscribers — subscribers got
nothing. Closed that gap and exposed the events to integrators.
- `app_private.fanout_domain_events` (internal) — pending domain_events → `webhook_deliveries` for every ACTIVE
  endpoint subscribed to that event_type, then marks the event processed. Idempotent (each event once).
  `cc_fanout_domain_events` (service-role, for a cron/worker) + `cc_webhooks_flush` (staff manual flush).
- `cc_event_catalog()` — curated list of subscribable domain events (dispatch/documents/finance/growth/marketing,
  incl. campaign.enqueued, comm.suppress, comm.unsubscribe, comm.trigger.set). Surfaced in the Webhooks admin,
  plus a "Flush pending events" button.
- Proof: **FANOUT MATRIX: PASS (8 checks)** (delivers only to subscribed+active endpoints, idempotent, marks
  processed, catalog visible, staff flush works, anon denied, fanout RPC off anon+authenticated surface).
  Migration `cvp_webhook_fanout` (staging + production). Anon SECURITY DEFINER surface unchanged (5).

## Increment 41 — Webhook delivery sender (transport for the fan-out)

Completes the outbound-webhook path: the fan-out (cvp) queues deliveries; this transmits them.
- `cc_webhook_claim(limit)` (service-role) — atomically claims queued deliveries with their endpoint URL, sets
  a new 'sending' in-flight status (added to the status CHECK additively). `cc_webhook_mark(id, ok, note)`
  (service-role) — delivered, or failed → retry up to 5 attempts then terminal 'failed'. Off anon+auth surface.
- `supabase/functions/webhook-sender/index.ts` — claims, POSTs the event JSON, marks the result; optional
  HMAC `X-LoadBoot-Signature` when WEBHOOK_SIGNING_SECRET is set (no signing secret stored in the DB).
  Owner action: deploy (verify_jwt=false) + schedule; safe no-op if no active endpoints.
- Proof: **WEBHOOK SENDER MATRIX: PASS (4 checks)** (claim sets in-flight, mark delivered, retry→terminal after
  5 attempts, RPCs off anon+authenticated). Migration `cvq_webhook_sender` (staging + production).
  Anon SECURITY DEFINER surface unchanged (5).

## Increment 42 — Pipeline reliability health (capstone)

`cc_pipeline_health()` — one staff-gated read aggregating backlog across every async queue: message-delivery
status histogram, webhook-delivery status histogram, domain-event pending/processed, suppression count, and
campaigns in flight. Surfaced as a "Pipeline backlog" strip on Delivery Health so a stuck fan-out or unsent
webhook backlog is visible at a glance.
- Proof: **PIPELINE HEALTH MATRIX: PASS (3 checks)** (shape, carrier + anon denial). Migration
  `cvr_pipeline_health` (staging + production). Anon SECURITY DEFINER surface unchanged (5).
