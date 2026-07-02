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

## Increment 43 — Load-source normalization + Load Intake workspace (GLOBAL DISPATCH MARKETPLACE)

Extended the existing `public.loads` (additively) with a normalized SOURCE model + verification provenance, and
added a Command Center Load Intake workspace. Nothing rebuilt — builds on the existing loads/organizations/trips
model.
- `loads` columns (additive, constrained): source_type (11 sources), source_provider, source_reference,
  verification_state (unverified/partial/verified), confidence (low/medium/high), source_updated_at, created_by,
  broker_org, shipper_org, version, field_meta. Indexes on source_type and (status, created_at).
- `cc_create_load_sourced(jsonb)` — staff (loads.create); REQUIRES source_type (no silently-"verified" data);
  emits `load.created`, audited. `cc_load_intake_list(...)` — staff filterable list with source + verification.
  `cc_load_set_verification(load, state, confidence)` — staff, audited, bumps version.
- Frontend: Command Center **Load Intake** view (`/load-intake`) — source/verification KPIs, filters, a
  source-attributed New-load composer, and a Verify action. Nav gated by `load_marketplace` flag
  (staging ON for preview, production OFF for controlled activation). api wrappers + LOAD_SOURCE_TYPES.
- Proof: `tests/security/load_intake_matrix.sql` → **LOAD INTAKE MATRIX: PASS (9 checks)** (source_type required,
  valid create, invalid source rejected, list, verification set, carrier + anon denied). Migration
  `cvs_load_source_intake` (staging + production). Anon SECURITY DEFINER surface unchanged (5).

## Increment 44 — Partner (broker) Load Wizard + mandatory-document checklist

NOTE: partner scope is BROKER only (US shippers require a broker license to move freight directly; shipper
partner flows intentionally not built).
- `cc_partner_submit_load(jsonb)` — broker self-scoped (my_partner_org('broker')); eligibility (org active),
  validation, **24h duplicate detection** (blocked unless confirm_duplicate=true), richer fields
  (windows/stops/appointment/tracking/accessorials/reference); emits partner.load_submitted.
- `app_private.load_document_checklist` model + seeder; every submission auto-generates a broker document
  checklist (rate con, pickup/delivery #, appointment, billing). `cc_load_checklist` (staff OR owning broker)
  + `cc_load_checklist_set` (staff).
- Frontend: Partner Portal broker dashboard **multi-step Load Wizard** (Lane → Schedule → Equipment → Requirements
  → Review) with duplicate-confirm handling; api wrappers partnerSubmitLoad / loadChecklist / loadChecklistSet.
- Proof: `tests/security/partner_wizard_matrix.sql` → **PARTNER WIZARD MATRIX: PASS (9 checks)** (submit + checklist
  generated, duplicate blocked then confirmed, staff checklist update, cross-tenant carrier denied, anon denied).
  Migration `cvt_partner_wizard_checklist` (staging + production). Anon SECURITY DEFINER surface unchanged (5).

## Increments 45 + 46 — Explainable Matching Engine (eligibility + ranking) + Match Center

Extended the existing matcher into a two-stage EXPLAINABLE engine. An ineligible carrier is never silently
offered a load, and no unexplained AI scores are shown.
- **Stage A — `cc_match_eligibility(load)`**: hard filters per carrier (active/suspended, compliance/authority/
  insurance via carrier_mandatory_ok, truck capacity vs active trips, equipment compatibility from fleet_trucks,
  driver availability with license/medical currency). Returns eligible + structured `hard_fails[]` + `missing_data[]`.
- **Stage B — `cc_match_rank(load)`**: ranks ONLY eligible carriers with a score whose value equals the SUM of an
  explained per-factor breakdown (compliance/capacity/availability/performance/equipment/drivers). Deadhead + ETA
  are honestly marked unavailable (no invented GPS). loaded_rpm from rate/miles.
- Frontend: Command Center **Match Center** drawer — ranked eligible carrier cards with "Why this score" factor
  breakdown + loaded RPM + equipment fit, and a collapsible "Ineligible carriers (with reasons)" section. Opened
  via a **Match** action on every Load Intake row. api wrappers matchEligibility / matchRank.
- Proof: `tests/security/match_engine_matrix.sql` → **MATCH ENGINE MATRIX: PASS (8 checks)** (eligibility
  consistency, every ineligible has a reason, score = factor sum, only-eligible ranked, RPM correct, carrier +
  anon denied). Migrations `cvu_match_eligibility` + `cvv_match_rank` (staging + production).
  Anon SECURITY DEFINER surface unchanged (5).

## Parallel (marketing) — Brand asset audit + professional email header/footer (Inc 61 core)

- `docs/BRAND-ASSET-AUDIT.md` — audited all brand/image assets: one consistent inline-SVG brand mark, authentic
  PNG icons/favicons, illustrative equipment photos. **No fake logos, no fabricated customer logos, no external
  hotlinks, no image placeholders, no broken/duplicated assets.** Third-party platform logos already removed.
- `delivery-worker` now wraps every marketing email in a **professional reusable branded shell** — table-based
  (broad-client-safe), authentic hosted logo (icon-512.png), and a compliant footer (company identity, Support,
  Privacy, Terms, one-click Unsubscribe). Configurable via SITE_URL / BRAND_LOGO_URL env. No fabricated assets.

## Parallel (marketing) — Dedicated Carrier + Broker landing pages (no shipper)

- New **carriers.html** (~14 sections): value prop, who we serve, equipment, load sourcing, rate negotiation,
  dispatch & appointments, documents & compliance, exceptions (detention/lumper/TONU), invoicing & settlement,
  carrier software, getting started, FAQ + CTA. Original content, no fake testimonials/logos/stats.
- New **brokers.html** (~12 sections, BROKER only per owner instruction — US broker license required): value prop,
  onboarding & verification, guided load posting, explainable matching, operational visibility, appointments &
  documents, exception resolution, integrations & security, partner form + FAQ. No shipper page.
- Linked from footer (For Carriers / For Brokers) + HTML sitemap "Get started" group; auto-included in sitemap.xml.
- Verified: preview build OK; **production build isolation OK (0 staging refs)**; beacon/lead forms wired.

## Increment 47 — Offer waves, expiry & carrier response

Connects Matching → booking. New `app_private.load_offers` + RPCs:
- `cc_offer_send(load, carriers[], rate, expiry_minutes)` — staff (dispatch.manage) send an offer wave;
  **eligibility re-checked at send** so ineligible carriers are skipped (never offered), score snapshotted,
  emits offer.created. `cc_load_offers(load)` staff list. `cc_offers_expire()` expires overdue offers.
- `cc_carrier_offers()` (carrier self-scoped) + `cc_offer_respond(offer, view|accept|decline|counter, ...)` —
  concurrency-safe (FOR UPDATE), self-scoped, blocks respond-after-terminal and expired offers.
- Frontend: Match Center gains per-carrier **Send offer / Re-offer** + **Offer wave → top 3** + live offer-status
  pills; api wrappers offerSend/loadOffers/carrierOffers/offerRespond/offersExpire.
- Proof: `tests/security/offers_matrix.sql` → **OFFERS MATRIX: PASS (11 checks)** (eligibility-gated send,
  view/counter/accept, respond-after-accept blocked, cross-carrier denied, staff list, expiry, anon denied).
  Migration `cvw_offers` (staging + production). Anon SECURITY DEFINER surface unchanged (5).

## Increments 48–51 — Transactional booking + Trip Control Tower + consent-first tracking

**48+49 (migration `cvx_transactional_booking`)** — accepting an offer is now ONE atomic transaction:
lock load → status + load-version (stale-acceptance) guards → eligibility re-check at acceptance (new internal
`app_private.match_eligibility`; public RPC is a staff-gated wrapper) → one winning acceptance → all other open
offers expired → load `booked` → trip created exactly once → 8-item broker+carrier booking checklist incl.
rate confirmation, driver/truck/trailer, tracking method → events (offer.accepted, load.assigned, trip.created,
booking.document_requested) + audit. `cc_booking_status(load)` (staff or booked carrier) returns trip +
checklist + completeness. Proof: **BOOKING MATRIX: PASS (13)** — incl. stale-version rejection, losing offer
expired, double-booking blocked, cross-carrier + anon denied. tests/security/booking_matrix.sql.

**50+51 (migration `cvy_trip_tracking`)** — consent-first tracking on the unified trips model:
- legacy `trip_locations` extended additively (accuracy_m, note, created_by; lat/lng nullable for note-only
  manual check-ins; source CHECK incl. legacy 'carrier').
- `cc_trip_set_tracking(trip, pocket_gps|eld|telematics|manual_checkin)` — carrier self-scoped explicit consent
  (timestamped), auto-marks the booking-checklist tracking item. `cc_trip_checkin(trip, lat, lng, note, source)`
  — GPS REQUIRES prior consent; manual check-ins always allowed and clearly labeled; updates last location;
  emits trip.location_updated. No invented GPS anywhere.
- `cc_control_tower(limit)` (staff) — active trips with location source + freshness minutes, consent, checklist
  gaps, open exceptions, and a computed NEXT ACTION (select tracking → complete checklist → stale-tracking
  check-in → dispatch/confirm/monitor). `cc_partner_load_status(partner_load)` — broker sees ONLY permitted info
  (statuses, schedule, tracking_state active/temporarily-unavailable, freshness minutes, own doc checklist);
  no coordinates, no driver personal data, no carrier internals. Stale GPS never auto-cancels a load.
- Frontend: Command Center **Trip Control Tower** (`/control-tower`, flag load_marketplace) with 60s auto-refresh
  KPIs + per-trip Booking drawer; api wrappers tripSetTracking/tripCheckin/controlTower/partnerLoadStatus/bookingStatus.
- Proof: **TRACKING MATRIX: PASS (12)**. Both migrations applied to staging + production (booking fns
  hash-identical). Anon SECURITY DEFINER surface unchanged (5).

## AI LOAD PILOT — explainable take/negotiate/skip + location/preference-aware carrier push (cvz)

Owner ask: "max input → max output — batao ye load lena chahiye ya nahi, aur kis carrier ko push karna chahiye,
carrier ki location aur preferences dekh kar." Delivered as a DETERMINISTIC, fully-explained advisor (no black
box, no invented data):
- `cc_load_advisor(load, overrides)` — 8 itemized factors (rate/mi vs target, est. margin vs cost baseline,
  data trust, source reliability, broker identity, lane history from delivered trips, timing, completeness);
  score == sum of shown points; hard FLAGS (past pickup, expired posting, unverified external); recommendation
  TAKE / NEGOTIATE (with suggested counter = miles × target RPM) / SKIP; assumptions echoed + overridable
  (cost_per_mile, target_rpm, max_deadhead) and everything estimate-labeled.
- Carrier PUSH ranking: match score + REAL deadhead (haversine from the carrier's last trip GPS to load pickup
  coords — 'unknown' when no coords, never invented) + all-in RPM incl. deadhead + preference fit from the new
  `carrier_dispatch_prefs` (min RPM / preferred equipment / lanes / home base; carrier self-service via
  `cc_set_dispatch_prefs` / `cc_get_dispatch_prefs`). Top pick returned as "push to <carrier>".
- Frontend: **AI Pilot** button on every Load Intake row → drawer with recommendation banner, per-factor
  breakdown, flags, lane history, ranked push cards (deadhead/all-in RPM/pref fit) and one-click **Push offer**
  (runs through the eligibility-rechecked cc_offer_send).
- Proof: **LOAD ADVISOR MATRIX: PASS (7 checks)**. Migration `cvz_load_advisor` (staging + production).
  Anon SECURITY DEFINER surface unchanged (5).

## INC 57 — WEBSITE MACHINE-READABLE INVENTORY
- `scripts/site_inventory.py` (stdlib-only, deterministic): crawls built `site/` → `docs/site-inventory.json` — per page: URL, title/meta/canonical/robots, H1 count, per-section heading+word breakdown, word count, CTAs, forms+fields, internal/external links, inbound links (orphan detection), images + alt coverage, schema.org JSON-LD types, shingle-based duplication risk vs every other page.
- `docs/site-inventory-gaps.md` honest gap report. Result on current build (39 pages, all counted — no estimates): only `dashboard.html` (app redirect shell) flags missing meta/CTA/schema/H1; 3 thin pages (dashboard, sitemap, status — utility pages); 1 high-dup pair (sitemap↔status, both thin utility pages); 0 missing canonicals, 0 images missing alt on content pages.
- Run after `build_site.py`; every figure counted from actual HTML.

## INC 61 — OFFICIAL EMAIL SENDER IDENTITY
- `delivery-worker/index.ts`: category → identity map. marketing/campaigns → "LoadBoot" <hello@loadboot.com>; dispatch (load/trip/offer/booking/tracking/pod/detention/carrier/driver templates) → "LoadBoot Dispatch" <dispatch@loadboot.com>; billing (invoice/payment/settlement/payout/receipt/factoring) → "LoadBoot Billing" <billing@loadboot.com>. Reply-To always matches the identity. `meta.category` (marketing|dispatch|billing) explicitly overrides per message.
- HONESTY GATE: identities activate ONLY when RESEND_FROM is on loadboot.com (owner has verified the domain with the provider); otherwise every send falls back to RESEND_FROM — never sends from an unverified address. Per-identity overrides via SENDER_MARKETING/SENDER_DISPATCH/SENDER_BILLING secrets.
- Proof: SENDER IDENTITY MAP: PASS (10 checks) + DOMAIN GATE: PASS (4 checks) (node runtime test of the exact mapping logic). Structural balance check OK. No DB change; anon surface untouched (5). Still a safe no-op until owner sets RESEND_API_KEY + deploys.

## AI LOAD PILOT — ADVANCED (fleet level)
- `cwa_pilot_fleet.sql` (BOTH DBs, md5 hash parity verified; anon surface still 5):
  - `cc_carrier_best_loads(p_carrier, p_limit)` — REVERSE advisor: for one carrier, every open load ranked by rate vs the carrier's own stated min RPM, real deadhead from last trip GPS (labeled ESTIMATE + basis), preference fit (equipment/lanes), data trust, timing, broker+completeness — score == sum of itemized factors. Carrier accounts are hard self-scoped (asking about another carrier still returns your own org); staff (dispatch.view) may query any carrier. Ineligible loads skipped with reasons.
  - `cc_dispatch_plan(p_max_loads)` — one-click FLEET PLAN (staff dispatch.manage): greedy explained assignment across open loads × eligible carriers; each load once; carrier capacity (available trucks) respected; fleet-size-unknown carriers capped at 1 planned load with an explicit note; honest accounting (considered == assigned + unassigned). PROPOSAL only — nothing books automatically.
- Proof: PILOT FLEET MATRIX: PASS (10 checks) on staging (tests/security/pilot_fleet_matrix.sql). Live sanity: 1 open load → planned to Ironhide, push score 95, explanation lines incl. honest "deadhead unknown" (that load has no pickup coords).
- UI: Command Center — "AI Fleet Plan" button on Load Intake opens the plan drawer (per-pairing explanation + one-click Push offer); Load Pilot drawer gains WHAT-IF controls (cost/mi, target RPM, max deadhead → Re-analyze, same deterministic RPC with overrides). Carrier portal — "⭐ Best for you (AI Pilot)" card on Loads tab (top 3, scored /100, deadhead labeled est.) + "Dispatch preferences (AI Pilot)" card in Account (min RPM, equipment, lanes, max deadhead, home base → cc_set_dispatch_prefs).
- Gates: node --check OK (loadIntake, loadPilot, api, carrier app), IMPORT-REFERENCE CHECK: PASS.

## INC 52–53 — DETENTION AUTOMATION + EXCEPTION CENTER
- `cwb_detention_exceptions.sql` (BOTH DBs, md5 parity on all 4 fns; anon surface still 5):
  - `app_private.trip_dwell_events` — real arrive/depart stamps per stop (unique trip+stop), free_minutes window.
  - `cc_trip_arrive` / `cc_trip_depart` — carrier self-scoped (own trip) or staff; departure returns measured dwell + detention minutes (pure arithmetic on recorded stamps — nothing invented).
  - `cc_detention_scan` — auto-logs ONE 'detention' exception per overdue stop (deduped via detention_exception link) + DRAFT accessorial with LABELED $/hr assumption, billable=false — a dispatcher must review; the scan never bills.
  - `cc_exception_center` — enriched read (dispatch.view): lane, carrier, age, on-site context, billable vs draft accessorial totals.
- Proof: DETENTION/EXCEPTION MATRIX: PASS (12 checks) on staging (tests/security/detention_exceptions_matrix.sql); test rows cleaned up.
- UI: Command Center → new "Exception Center" nav (flag load_marketplace): KPIs (detention count, draft $ pending review), kind pills, on-site pill, resolve drawer with required audit note + "resolving bills nothing" notice, "Run detention scan" button (dispatch.manage). Carrier portal → "⏱ Arrive / depart" chips on active trips (At/Left pickup/delivery) — recorded timestamps protect the carrier's detention pay; detention alert shown on departure.
- Gates: node --check OK (app.js, shell.js, exceptionCenter.js, api.js, carrier app), IMPORT-REFERENCE CHECK: PASS.

## INC 54 — BROKER DOCUMENTS, APPROVALS + UPDATE-REQUEST WORKFLOWS
- `cwc_broker_docs.sql` (BOTH DBs, md5 parity on all 8 fns; anon surface still 5):
  - load_document_checklist +7 additive columns (submitted_ref/note/at/by, review_reason, reviewed_by/at); cc_load_checklist extended to expose them (staff or owning broker only).
  - `cc_partner_checklist_submit` — broker submits ITS OWN broker-side items (self-scoped; carrier items blocked); resubmit after rejection allowed; verified items locked.
  - `cc_load_checklist_review` — staff verify/reject; rejection REQUIRES a reason the broker sees; reviewer+time recorded.
  - `app_private.update_requests` + `cc_request_update` / `cc_update_requests` (staff) / `cc_partner_update_requests` / `cc_partner_respond_update` (broker self-scoped, single response) / `cc_resolve_update_request` (staff resolve/cancel). Events + audit on every step.
- Proof: BROKER DOCS MATRIX: PASS (14 checks) — tests/security/broker_docs_matrix.sql. Fixtures cleaned.
- UI: Command Center → Partner Intake broker tab: open update-requests card (+Resolve), per-load "Docs" drawer (verify / reject-with-reason, submitted refs visible), "Ask update" drawer. Partner portal → "Docs" button per load: broker sees required items, rejection reasons ("Fix needed: …"), submits reference+note inline.
- ALSO (owner instruction): old Gemini-based **AI Copilot deleted** — nav entry, route, import and view file removed; ai_copilot_enabled flag OFF in BOTH DBs. Replaced by the deterministic AI Load Pilot (no external API key needed).
- Gates: node --check OK (app.js, shell.js, partnerIntake.js, partner/app.js, api.js), IMPORT-REFERENCE CHECK: PASS.

## INC 55 — CARRIER P&L + PERFORMANCE DASHBOARDS
- `cwd_carrier_pnl.sql` (BOTH DBs, md5 parity; anon surface still 5):
  - `app_private.carrier_expenses` (12 categories, amount>0 CHECK, manual|system source).
  - `cc_carrier_add_expense` / `cc_carrier_expenses` / `cc_carrier_delete_expense` — carrier self-scoped; delete limited to own MANUAL rows.
  - `cc_carrier_pnl(from,to,carrier)` — revenue (confirmed booked trip rates + billable accessorials; drafts EXCLUDED and shown separately), expenses by category (labeled "manually entered — not audited accounting"), est_profit (labeled ESTIMATE), loaded RPM, profit/mile, profit/load, on-time % ONLY from real recorded timestamps (basis string states coverage), cancelled count, top-5 lanes, top-5 trucks, 6-month trend. Carrier self; staff any carrier.
- Proof: CARRIER PNL MATRIX: PASS (10 checks) — tests/security/carrier_pnl_matrix.sql (tenant isolation, math consistency, label presence, cross-tenant delete blocked, broker denied, anon zero).
- UI: Carrier portal → Finance tab gains "Profit & Loss (this month)" card: revenue/expenses/est-profit rows each with basis text, per-category breakdown, inline add-expense form (12 categories), top lanes, on-time with coverage note.
- Gates: node --check OK, IMPORT-REFERENCE CHECK: PASS.

## INC 56 — FINANCE LIFECYCLE: RECEIVABLES / PAYABLES / PREP / RECONCILE
- `cwe_finance_lifecycle.sql` (BOTH DBs, md5 parity on all 4 fns; anon surface still 5). Maker/checker core (cc_decide_settlement) untouched — this adds the ops layer around it:
  - `cc_finance_receivables` — partner invoices + carrier fee invoices aged current/1-30/31-60/61-90/90+ by due date; per-item list sorted by overdue days.
  - `cc_finance_payables` — pending + approved-not-paid settlements with age; explicit note that payment only happens via maker/checker.
  - `cc_invoice_prep_queue` — delivered trips with NO live invoice, oldest first, with each trip's latest POD review status ("delivered → POD → invoice" pipeline).
  - `cc_finance_reconcile` — deterministic cross-check; lists EVERY mismatch individually (paid invoice on unpaid settlement / unpaid invoice on paid settlement / settlement gross != sum of linked invoices).
- Proof: FINANCE LIFECYCLE MATRIX: PASS (12 checks) — incl. bucket-sum equality asserted and SEEDED mismatches detected then cleaned up.
- UI: Command Center → Finance gains 4 new tabs: Receivables (aging table + items), Payables (KPIs + list, read-only by design), Invoice prep (one-click Create invoice per delivered trip, POD pill), Reconcile (mismatch table or "books consistent ✓").
- Gates: node --check OK, IMPORT-REFERENCE CHECK: PASS (duplicate import caught and fixed).

## INC 58 — SHIPPER SOLUTIONS PAGE + CORE PAGE DEPTH
- New `shipper-solutions.html` (directive §37 — INQUIRY/CONSULTATION ONLY): 15 planned sections built (hero, scenarios, honest "what LoadBoot is — and is not" disclosure, visibility, facilities/appointments, carrier network concept, billing, claims/support, reporting/integrations/security, consultation inquiry form → shipper_inquiry lead key, FAQ + FAQPage schema, CTA). HONESTY GUARD verified in built HTML: explicit "not a licensed freight broker" disclosure; zero transactional booking claims; broker-partner boundary stated.
- Internal linking: footer gains a "Partners" cluster (Brokers / Shipper Solutions / Partner Portal / Referral); sitemap "Get started" cluster updated. Inventory re-run: 40 pages, shipper page = 26 headings / 928 words / form / schema / 38 inbound links / dup-risk low; 0 new orphans.
- Depth audit vs directive §34–36: Home already 45 headings / 1,837 words; carriers.html 44/1,113; brokers.html 35/886 — all meet the 12–15+ rich-section bar; no filler added (directive forbids pages/sections that only inflate counts).
- Netlify builds from source (netlify.toml: python3 build_site.py → publish /site), so only build_site.py needs committing.

## INC 59 — SERVICE-PAGE DEPTH + INTERNAL-LINK ENGINE
- Box-truck page enriched to sibling depth (original content, no filler): freight-types grid (LTL/final-mile/expedited/events/dedicated/equipment-matched), rate-drivers section, 3-step how-it-works, 4-item FAQ with FAQPage schema. 6→28 headings, 358→831 words.
- INTERNAL-LINK ENGINE (directive §39): deterministic RELATED topic-cluster map (20 commercial pages) + related_block() auto-appended by page() before the footer — every commercial page now links onward to its cluster (sibling service, audience page, pricing, guide, application/inquiry). Footer Freight cluster gains Box Truck.
- Measured effect (inventory re-run): box-truck inbound 1→38; carrier-application inbound 2→17; tools inbound 5→8; 0 commercial orphans (only dashboard.html app shell remains, expected). Build PASS, prod isolation clean.

## INC 60 — IMAGE & BRAND ASSET COVERAGE
- PAGE_PHOTOS map + photo_band() in build_site.py: authentic photo bands injected on 10 commercial pages (each image: webp, width/height, lazy, async decode, meaningful alt, honest caption tags — no fake clients/stock deception). Inventory: carriers/brokers/shipper-solutions/services now 2 images each, box-truck 1; 0 missing alt site-wide.
- BRAND-ASSET-AUDIT.md updated. Canva generation for NEW original hero illustrations blocked: connector token revoked — owner must reconnect Canva, then generation resumes (prompts prepared).

## INC 62 — COMPLETE OPERATIONAL TEMPLATE LIBRARY
- `cwf_template_library.sql` (BOTH DBs): 43 templates seeded into app_private.comm_templates — 39 transactional (welcome ×2, application/verification/changes/approved/rejected, document missing/rejected/approved/expiring, offer new/counter/accepted, rate confirmation, booking confirmed, driver assignment, pickup/delivery/check-in reminders, tracking warning, detention warning/opened, lumper, layover, TONU, breakdown, accident, exception update, POD required/rejected/approved, invoice ready, payment update, settlement ready, dispute update, support reply, security alert, maintenance) + 4 marketing (newsletter, promotion, referral, re-engagement — unsubscribe applies via existing suppression enforcement).
- Engineering: unique index on key; idempotent ON CONFLICT DO NOTHING (owner edits never overwritten); CTA button injected from one constant; body_text derived from body in SQL (clean plain-text fallback); ONLY allowlisted variables (server-enforced allowlist, verified 13/13); key prefixes steer the §29 official-sender map (tx.offer_/trip_/pod_/detention_… → dispatch@, tx.invoice_/payment_/settlement_ → billing@, rest + mk.* → hello@).
- Proof: TEMPLATE LIBRARY MATRIX: PASS (6 checks) on staging; production seeded 43/43; anon surface 5 both DBs. Templates render through the existing branded shell; NOTHING sends without owner's provider key.

## INC 63 — WORKFLOW BUILDER (v1)
- `cwg_workflow_builder.sql` (BOTH DBs, md5 parity; anon surface 5): workflow_defs (versioned graphs, draft→published→paused→archived) + workflow_runs (full step trace, idempotency). Server-side graph validation: node-type ALLOWLIST (no approve/money/permission nodes possible), exactly-one-trigger, ≥1 end, edge integrity, 50-node cap. cc_workflow_save / cc_workflow_set_status (publish requires validation pass) / cc_workflows / cc_workflow_run (simulation = ZERO side effects; live = only published, email via consent-enforcing ledger, idempotent dedupe, 100-step cycle guard) / cc_workflow_runs.
- Proof: WORKFLOW BUILDER MATRIX: PASS (11 checks) — forbidden node rejected, branch logic, no-side-effect simulation, live dedupe, denials, anon zero.
- UI: Command Center → "Workflow Builder" nav (settings.manage): list w/ status+versions+runs, step-list editor (condition true/false branching, delay, task note, notification, email-template steps; trigger+end auto), Simulate drawer (sample-event JSON → step trace), publish/pause, run history. KNOWN LIMITATION stated: v1 = step-list editor, not drag/drop canvas (graph model canvas-ready).
- Gates: node --check OK, IMPORT-REFERENCE CHECK: PASS.

## WEB-1 — HOME PAGE OVERHAUL (owner directive)
- LIVE PUBLIC BOARD upgraded: get_public_load_opportunities extended additively (+commodity, +weight, +posted_by generic label 'Broker partner'/'LoadBoot dispatch' — NO company names/contacts/margin; is_public=true gate unchanged). Applied BOTH DBs, md5 parity, anon surface exactly 5 (fn re-granted after recreate). Staging got prod's missing is_public/published_at/expires_at columns additively. Migration: cwh_public_board.sql.
- Board cards now show commodity/weight/source pills + LOGIN-AWARE button: signed-in visitors (sb-*-auth-token present) see "Book this load →" (deep link to carrier loads), others "Login & Book →".
- EXAMPLE-LOADS section REMOVED from home (owner order).
- NEW home sections: "How we work with broker partners" (5 child-simple steps → brokers.html + Partner Portal CTAs), "Your week with LoadBoot" carrier flow (5 steps → carriers.html + application), "The bridge" (LoadBoot between brokers & carriers), referral teaser (3 cards → referral.html).
- Blog section polished ("Free knowledge base" positioning). Home: 45→61 headings, 1,848→2,035 words, 13 CTAs. Build PASS, 8/8 content checks PASS, inventory re-run.
- NOTE: per owner, NOT requesting a push — batch with the next milestone to save Netlify credits.

## WEB-4 — "RESEARCH LOADBOOT WITH AI" FOOTER
- Shared footer block on EVERY page (one component, zero duplication): heading + neutral description + 5 provider buttons (ChatGPT/Claude/Gemini/Perplexity/Grok — text/lettermark treatment, NO fake logos, no hotlinked assets, external-link indicator, rel=noopener noreferrer, tooltip, sr-only labels) + accessible <details> prompt disclosure with Copy button + aria-live copy announcement + third-party privacy disclosure.
- Prompts: NEUTRAL default research prompt (verbatim from spec) + page-aware template driven by a TOPICS configuration map (12 pages mapped: carriers/brokers/shipper/pricing/how-it-works/equipment/services/resources); prompt_version=v1; nothing asks the AI to praise or recommend LoadBoot.
- Behavior: every click copies the prompt to clipboard FIRST (universal fallback), then opens the provider in a new tab; Gemini honestly marked fallback-only (no verified prefill URL — could not verify provider URL patterns from this environment; all providers work via clipboard regardless); failures tracked, never silent.
- Analytics (existing first-party lbTrack): ai_research_link_clicked / provider_opened / prompt_viewed / prompt_copied / fallback_used with provider, topic, prompt_version, prompt_type, placement — full prompt text NEVER placed in events.
- Switch: AI_RESEARCH_FOOTER_ENABLED build constant in build_site.py (owner-flippable; owner reviews every push, which is the deploy gate).
- Gates (tests/ai_research_footer_checks.py against BUILT output): FRONTEND PASS · PROMPT CONFIGURATION PASS · PROVIDER FALLBACK PASS · ANALYTICS PASS · SECURITY PASS (encodeURIComponent, noopener, no secrets/private data, neutral framing asserted).
- KNOWN LIMITATIONS (honest): Command Center prompt-versioning/managed-config screen deferred — a public config read would require a 6th anon SECURITY DEFINER function, violating the locked 5-surface invariant; current versioning is build-time (v1) with owner-controlled deploys. Provider URL patterns unverifiable from this environment; clipboard fallback guarantees function. /resources/research-loadboot-with-ai page deferred until enough real content exists (anti-doorway rule).

## WEB-3 (part 1) — FOUR REAL COMPLIANCE PAGES + WIRING
- New full pages (unique content, educational, honest disclaimers, FAQPage schema, related-cluster cross-links):
  * authority-dot-setup.html — 30 headings / 1,163 words (USDOT vs MC, 6-step filing order, cost honesty without printing changeable govt fees, waiting-period playbook, New Entrant audit, LoadBoot fit, 4 FAQs)
  * boc3-ucr.html — 26 / 963 (process agents, blanket-agent shortcut, 3 practical BOC-3 facts, UCR brackets + renewal window, enforcement reality, autopilot habits)
  * form-2290-hvut.html — 27 / 960 (July–June tax year, Schedule 1, deadlines incl. prorated first-use, 5 field-tested filing tips, record retention)
  * ifta-fuel-tax.html — 30 / 1,002 (why IFTA exists, qualified vehicles, quarterly math via fleet-MPG method, audit records, clean-IFTA habits)
- Footer Compliance cluster now points at the REAL pages (previously all four redirected to services.html — owner's exact complaint fixed). RELATED map: 4 entries added, pages cross-link each other + new-authority + carriers + tools. Inbound links: 42 each — fully interconnected, dup-risk LOW.
- Inventory tool improvement: duplication shingles now EXCLUDE shared footer chrome (the AI-research footer text was inflating similarity on short utility pages — 10 false-positive pairs → 0; metric now measures page content only).
- All pages carry the standing honesty disclaimer (education, not legal/tax advice; fees change — verify on FMCSA.gov/IRS.gov).
- Pending in WEB-3 (part 2): about/contact trust upgrade, how-it-works triple workflow, careers/case-studies enrichment.

## OWNER FIXES — REAL LOGO EVERYWHERE + GOOGLE ANALYTICS PAGE
- REAL LOGO: every hand-drawn SVG approximation of the brand mark replaced with the ORIGINAL asset (/icon-512.png — navy rounded square, white L, orange arrow; zero design changes) across: marketing header, footer, splash screen, Command Center sidebar (cc-mark synthetic gradient removed so the true icon shows unmodified), carrier portal, partner portal, developer portal. 7 replacements + CSS fix; 0 hand-drawn marks remain in built output.
- GOOGLE ANALYTICS PAGE: ga4-insights + gsc-insights edge functions freshly deployed to production (both ACTIVE, verify_jwt on, staff re-check inside). Page now shows the honest "not connected" card with exact setup steps instead of a generic error. REMAINING OWNER ACTION for real data: create a Google Cloud service account, enable Analytics Data API + Search Console API, grant it Viewer on the GA4 property + Search Console site, then set secrets GOOGLE_SA_KEY (full JSON), GA4_PROPERTY_ID (numeric), optional GSC_SITE_URL in Supabase → Edge Functions → Secrets.

## WEB-3 (part 2) — ABOUT / HOW-IT-WORKS / CAREERS / CONTACT ENRICHMENT
- how-it-works.html 17→31 headings: NEW carrier journey (4 steps, unique icons), broker partner journey (4 steps), "Behind the scenes" (matching engine / exception desk / money rail with maker-checker note).
- about.html 11→19: "Rules we run the company by" (explainable-always, tenant-isolated data, humans-control-money) + "Three front doors" official email cards (hello@/dispatch@/billing@).
- careers.html 4→12: life-at-LoadBoot + teams-we-hire-for sections. contact.html 5→13: direct email lines per operation + "what happens next" expectations.
- All four dup-risk LOW; only remaining thin/orphan page site-wide is dashboard.html (app shell — by design). Build PASS, inventory re-run.
- WEB-3 COMPLETE (parts 1+2).

## WEB-2 — MULTI-LEVEL REFERRAL ENGINE (backend + carrier portal)
- `cwi_referral_engine.sql` (BOTH DBs, md5 parity; anon surface 5): referrers (stable code per user; carrier/partner/affiliate kinds — affiliates = influencers/agencies without client org), referral_edges (each org referred exactly ONCE, no self-referral), referral_levels (L1 1% … L5 0.10% of gross, from OUR 5% fee — LoadBoot keeps ≥3%, client never pays extra), referral_commissions (15-DAY HOLD → payable → human-marked paid).
- RPCs: cc_my_referral (join/get code+stats+link), cc_claim_referral (one-time, guarded), cc_my_referral_earnings (self-scope), cc_referral_accrue (finance.manage; walks chain ≤5 levels per fee-bearing invoice; idempotent; promotes hold-expired rows), cc_referral_overview (staff), cc_referral_mark_paid (finance.approve; ONLY payable rows — hold enforced; records decision, money moves outside).
- Proof: REFERRAL ENGINE MATRIX: PASS (15 checks) — chain math asserted to the cent, hold enforced, dedupe, isolation, denials, anon zero.
- UI: carrier portal Account → "Referral program" card (flag-gated): code, copy-link, referral count, accrued/payable/paid, one-time "link referrer" claim, honest fine print. api wrappers ×6.
- Flag referral_program: staging ON, production OFF — OWNER+LEGAL activation required (multi-level commission structures may need legal review; stated to owner).
- PENDING (WEB-2 part 2): referral.html page enrichment for agencies/influencers + home-section deep link (teaser already live), CC Referrals overview screen, partner-portal card, accrual scheduling.

## WEB-2 (part 2) — REFERRAL PAGE + CC OVERVIEW + PARTNER CARD (frontend; engine unchanged)
- referral.html rebuilt from a carrier-only teaser into a full **Referral & Partner Program** page for three
  audiences (carriers, dispatch shops/agencies, creators/influencers): "who it is for" grid, four-step "how it
  works", an honest "multi-level, minus the games" section (paid from OUR 5% fee, carrier never pays extra, up
  to five thinning levels, LoadBoot keeps the majority), TWO lead forms (refer-a-carrier + apply-as-partner with
  a partner_type select), and a 6-item FAQ + FAQPage schema. HONESTY: no binding public commission percentages
  published (multi-level = legal review pending, prod flag OFF); page states terms are confirmed in writing
  before anything is owed. Both forms reuse the already-proven `referral` submit_web_form key (no new/unproven
  form key introduced). Home teaser deep link already live (WEB-1) — unchanged.
- Command Center **Referrals** view (`/referrals`, nav under Finance, flag `referral_program` + `finance.view`):
  KPIs (referrers, referred orgs, accrued-on-hold, payable, paid) off `cc_referral_overview`, top-referrer
  leaderboard (code/type/referrals/earned), **Run accrual** (`cc_referral_accrue`, finance.manage) and per-row
  **Mark payable paid** (`cc_referral_mark_paid`, finance.approve) with a confirm drawer stating it records the
  decision only — money moves through the normal rail. Registered: import + flag load + shell option + route +
  nav entry. RPC return shapes read live from staging to match the UI.
- Partner Portal (broker) **Referral program** card mirroring the carrier card: code, copy-link, referral count,
  accrued/payable/paid, one-time "link referrer" claim (`cc_my_referral` returns kind=partner for brokers),
  honest fine print. Flag-gated; shows "coming soon" when off. Imports added: isFlagEnabled/myReferral/claimReferral.
- NO backend/DB change this increment (engine cwi already applied + matrix PASS 15). **Anon SECURITY DEFINER
  surface = 5 on BOTH DBs; referral_program staging ON / production OFF — confirmed live via SQL.**
- CAVEAT (this session): the isolated build sandbox was unavailable (host disk space), so `node --check`,
  `python build_site.py` and the import-reference scanner could NOT be executed here — verification was static
  (export resolution, brace/quote review) plus live DB invariant checks. Re-run the local gates before pushing.
- PENDING (WEB-2 residual): accrual scheduling (cron/worker for cc_referral_accrue) still owner-deploy-gated.

## INC 64 — BUSINESS INTELLIGENCE (executive summary + trends)
- `cwj_business_intelligence` (BOTH DBs, md5 parity on both fns; anon surface still 5): two staff-gated,
  read-only RPCs over REAL tables only (nothing estimated):
  - `cc_bi_executive_summary(from,to)` — one jsonb across loads (total/on-board/created/booked), trips
    (active/delivered/on-time with an explicit basis string — on-time counted only from trips that have both a
    scheduled_delivery and delivered_at), revenue (fee collected keyed on paid_at / outstanding = all
    non-terminal invoices, labeled), carriers (active + onboarding pending), offers (sent/accepted/acceptance
    rate), delivery (message_deliveries sent/delivered/failed), exceptions (opened/open-now), referrals
    (referrers/payable/paid). Window defaults to last 30 days; from>to rejected.
  - `cc_bi_timeseries(metric,days)` — daily series (day-clamped 1..365) for loads_created / trips_delivered /
    fee_collected / offers_sent, gap-filled via generate_series so empty days show 0.
  - Gate: `analytics.view` OR `reports.view`; EXECUTE revoked from public/anon, granted to authenticated only.
- Proof: **BI MATRIX: PASS (9 checks)** run live on staging (staff summary shape incl. 30-day window, custom
  7-day window, timeseries 30 rows, metric+day-clamp, from>to rejected, non-staff summary+timeseries denied,
  anon denied, anon has no EXECUTE via ACL). Applied to production after PASS; **staging & prod function bodies
  md5-identical; anon SECURITY DEFINER surface = 5 on BOTH DBs — confirmed live.**
- Frontend: Command Center **Business Intelligence** view (`/bi`, Overview nav group, perm any:analytics.view,
  reports.view — no new flag; read-only + staff-gated): 6 KPI cards, four breakdown panels (Revenue/Delivery/
  Growth/Trips each showing the server basis note), a daily-trend bar chart with metric + range (7/30/90)
  selectors, and **Export CSV** (flattens the summary). api wrappers `biExecutiveSummary` / `biTimeseries`.
- Frontend verification static only (build sandbox still down): all new imports resolve to real exports; RPC
  shapes confirmed against live staging output. Re-run node --check + build before pushing.

## INC 65 — PWA HARDENING (app portals installable + per-app offline shells)
- Audited the app-portal PWA: carrier was already installable (manifest + head metas), but **Command Center had
  no PWA head at all** and **Partner had head metas but no manifest** — so neither was installable, and the
  build-generated app service worker only served offline shells for carrier + command-center (partner/pocket/
  developer navigations fell through with no offline shell).
- Fixes (frontend only, no backend/DB change): new `app/partner/partner.webmanifest` + `app/command-center/
  command-center.webmanifest`; wired `<link rel="manifest">` into partner/index.html and a full PWA head
  (theme-color, manifest, apple-touch, apple/mobile web-app-capable, app title) into command-center/index.html.
  All three main portals now register the SW (verified) and are installable.
- Service worker (`build_site.py` generator): replaced the hardcoded carrier/command-center `shellFor` with a
  **generic per-app resolver** — any `/app/<portal>/…` navigation is served that portal's OWN precached
  `index.html` (and only if it is in the precache), so every portal (carrier, partner, command-center, pocket,
  developer) gets an isolated offline shell with zero cross-app HTML bleed. Data-caching rules unchanged: still
  network-only for everything off the static allowlist; NEVER caches API/auth/document/money/location/profile.
- Safety: no new caching behavior, no untested cache of dynamic data; the change is additive shell-routing that
  can only serve already-precached static index shells. Static-verified (build sandbox down): regex + format-arg
  count checked by hand; SW registration confirmed present in all three portal app.js files. Re-run the build to
  regenerate /app/sw.js before pushing.

## INC 66 — SAVED REPORTS & SNAPSHOTS (basis for scheduled digests)
- `cwk_saved_reports` (BOTH DBs, md5-identical on all 5 fns; anon surface still 5): staff-only, **self-scoped**
  saved BI views + point-in-time snapshots, reusing the Inc 64 BI RPCs as the single source of truth.
  - Tables `app_private.report_defs` (name, metric, days, created_by=auth.uid()) + `report_snapshots`
    (payload jsonb, generated_by/at, ON DELETE CASCADE).
  - `cc_report_save` (insert/update own; validates name + metric allowlist + day clamp 1..365),
    `cc_reports` (own list + snapshot count + last_run), `cc_report_delete` (own only),
    `cc_report_run` (captures a snapshot = summary(window)+series for the report's metric; stores + returns),
    `cc_report_snapshots` (own report's snapshot history). Internal `can_report()` = reports.view OR
    analytics.view. All EXECUTE revoked from public/anon, granted to authenticated only.
- Proof: **SAVED REPORTS MATRIX: PASS (13 checks)** live on staging — save/update/list/run/snapshots/invalid
  metric+empty name rejected, and full cross-user isolation (a second staff user cannot see / delete / run
  another's report), non-staff denied, anon denied, anon has no EXECUTE (ACL). Test rows self-cleaned. Applied to
  production; **staging & prod bodies md5-identical; anon SECURITY DEFINER surface = 5 on BOTH DBs — confirmed.**
- Frontend: **Saved reports** panel inside the Business Intelligence view — name + save-current-view, a table
  (metric/window/snapshot count/last run) with per-row **Run** (capture snapshot) and **Delete**. api wrappers
  reportsList/reportSave/reportDelete/reportRun/reportSnapshots. Static-verified (build sandbox down).
- PENDING: wiring cc_report_run into an actual scheduled cron/worker for automated digests remains owner-deploy-gated
  (same posture as the delivery worker) — the snapshot engine it needs is now in place.

## INC 67 — CARRIER PERFORMANCE SCORECARD (deterministic + explainable)
- ROADMAP NOTE: the planned "notifications backbone unification" was deliberately deferred — the existing
  notification system is fragmented across several tables/UIs and rewriting it safely needs the (currently down)
  build/test environment. Swapped in this zero-write-risk, read-only, fully-provable increment instead.
- `cwl_carrier_scorecard` (BOTH DBs, md5-identical — a 135-char cosmetic drift between the two applies was caught
  by the parity check and canonicalized via `cwl_carrier_scorecard_parity`; anon surface still 5):
  - `cc_carrier_scorecard(carrier,days)` — a 0–100 score whose value EQUALS the sum of five shown factor points
    (on-time delivery 35, offer acceptance 20, few exceptions 20, delivered volume 15, low cancellations 10),
    each with a plain-language basis; grade A/B/C/D; raw metrics block. Every value counted from real
    trips/offers/exceptions — nothing invented; coverage stated when a factor has no data. Carrier self-scoped;
    staff (carriers.view/dispatch.view) may query any carrier.
  - `cc_carrier_scorecard_ranking(days,limit)` — staff-only ranked list of active carriers with delivered trips.
  - EXECUTE revoked from public/anon, granted to authenticated only.
- Proof: **CARRIER SCORECARD MATRIX: PASS (9 checks)** live on staging — shape, **score == sum of factor points**
  (explainability), staff ranking is array, carrier self (own org, null + explicit), carrier CANNOT query another
  carrier, carrier CANNOT use the staff ranking, non-staff-non-carrier denied, anon has no EXECUTE. Applied to
  production; parity re-confirmed md5-identical after canonicalization; **anon SECURITY DEFINER surface = 5 both DBs.**
- Frontend: Command Center **Carrier Scorecards** view (`/carrier-scorecards`, Operations nav, perm
  any:carriers.view,dispatch.view): ranked grade/score table + a "Why this score" drawer with the per-factor
  breakdown and raw metrics. api wrappers carrierScorecard/carrierScorecardRanking. Static-verified (sandbox down).

## INC 68 — BROKER SLA & ON-TIME ANALYTICS
- `cwm_broker_sla` (BOTH DBs, md5-identical; anon surface still 5): broker self-scoped (my_partner_org('broker'));
  staff (partners.view) may query any broker. Computed only from real partner_loads -> posted board load -> trip
  linkage — no estimates.
  - `cc_broker_sla(partner,days)` — submitted / posted / covered / delivered / on-time counts, **fill rate**
    (covered÷submitted), **on-time %** (only from delivered trips with a scheduled_delivery), average hours to
    cover, and open exceptions on the broker's trips; each with a basis string.
  - `cc_broker_sla_ranking(days,limit)` — staff-only, ranked by fill rate.
  - EXECUTE revoked from public/anon, granted to authenticated only.
- Proof: **BROKER SLA MATRIX: PASS (9 checks)** live on staging — shape, **count consistency
  (delivered ≤ covered ≤ submitted, on-time ≤ delivered-with-schedule)**, staff ranking is array, broker self
  (own, null + explicit), broker CANNOT query another broker, broker CANNOT use the staff ranking,
  non-staff-non-broker denied, anon has no EXECUTE. Applied to production; **staging & prod md5-identical;
  anon SECURITY DEFINER surface = 5 both DBs — confirmed live.**
- Frontend: Command Center **Broker SLA** view (`/broker-sla`, Sales & CRM nav, flag partners + partners.view):
  KPI strip (active brokers, aggregate fill rate, on-time, delivered) + per-broker table (fill/on-time pills,
  submitted/covered/delivered, avg cover hours, open exceptions). api wrappers brokerSla/brokerSlaRanking. Static-verified.

## INC 69 — CAPSTONE: MODULE-CATALOG RESYNC + INVARIANT RE-VERIFICATION
- `cwn_capstone_module_registry` (BOTH DBs, idempotent by route): registered this session's four new staff
  features in `app_private.platform_modules` so the module registry stays honest — Business Intelligence (/bi),
  Carrier Scorecards (/carrier-scorecards), Broker SLA (/broker-sla), Referral Program (/referrals) — each with
  area, permissions, flag, events and data classification. Re-runnable (WHERE NOT EXISTS by route); no functions
  added, so the anon surface is untouched.
- COUNTS RESYNC + INVARIANT CHECK (live, both DBs):
  - public `cc_*` RPCs = **336 on staging AND production** (count parity).
  - anon SECURITY DEFINER surface = **5 on BOTH DBs** — the locked invariant held across all of Inc 64–69.
  - the 9 net-new RPCs (cc_bi_*, cc_report_*, cc_carrier_scorecard*, cc_broker_sla*) are **0 anon-executable** on
    both DBs — every new function is off the anon surface by construction.
  - 4 new modules present in both DBs. (Module TOTALS differ — staging 46 / prod 55 — a PRE-EXISTING catalog
    drift in the documentation-only platform_modules table, unrelated to this session; flagged for owner cleanup.)
- Result: **CAPSTONE VERIFICATION: PASS.** Referral flag remains staging ON / production OFF.

## SESSION SUMMARY (WEB-2 part 2 + Inc 64–69)
- Delivered: WEB-2 part 2 (referral page + CC overview + partner card), Inc 64 BI, Inc 65 PWA hardening,
  Inc 66 saved reports/snapshots, Inc 67 carrier scorecard, Inc 68 broker SLA, Inc 69 capstone resync.
- Backend increments (64, 66, 67, 68) each proven by a live SQL security matrix on staging, applied to
  production, and confirmed md5-identical with anon surface = 5 on both DBs. Total new backend proof:
  BI 9 + Saved Reports 13 + Carrier Scorecard 9 + Broker SLA 9 = **40 matrix checks PASS**, all self-cleaning.
- DEFERRED (need a testable environment / owner action): notifications-backbone unification (existing system is
  fragmented — deferred to avoid untested regression); scheduled digest cron for cc_report_run (owner-deploy-gated).
- CAVEAT: the isolated build sandbox was unavailable all session (host disk space), so `node --check`,
  `python build_site.py` and the import-reference scanner could NOT run — ALL frontend verification was static
  (export resolution, brace/quote review) plus live DB checks. Re-run the local frontend gates before pushing;
  DB migrations are already applied + proven on both databases.

## INC 70 — NOTIFICATION BACKBONE (additive; unblocks the carrier Dashboard feed)
- `cwo_notification_backbone` (BOTH DBs, md5-identical; anon surface still 5). Writes/reads the EXISTING
  app_private.notifications table; existing per-audience functions untouched.
  - `app_private.emit_notification(role,user,template,payload,channel)` — the single canonical write path
    (in_app→status 'sent'; validates channel; recipient_user FK to profiles enforced). Off the anon+authenticated
    surface entirely (definer RPCs/triggers call it in owner context).
  - `cc_notify_broadcast(p)` — staff (comm.send) broadcast an in-app notification to a role or a specific user; audited.
  - `cc_my_notifications(limit)` / `cc_mark_my_notification(id)` — unified per-user in-app feed, self-scoped to auth.uid().
- Proof: **NOTIFICATION BACKBONE MATRIX: PASS (9 checks)** — staff broadcast to user + to role, recipient sees own,
  marks read, OTHER user cannot see it, missing title/body rejected, non-staff cannot broadcast, emitter off
  anon+authenticated, anon no EXECUTE on public RPCs. Self-cleaning. (Caught a good FK: emit rejects a
  non-existent recipient — validated with real profiles.) Applied to prod; md5-identical; anon surface = 5 both DBs.
- api wrappers myNotifications/markMyNotification/notifyBroadcast.

## INC 71 — SCHEDULED DIGEST ENGINE (source; owner deploys the cron)
- `cwp_scheduled_digests` (+ `cwp_digest_parity` to canonicalize a cosmetic drift; BOTH DBs md5-identical; anon
  surface still 5). Extends saved reports with a cadence and adds a service-role runner.
  - report_defs gains `schedule` (none/daily/weekly, checked) + `last_digest_at`.
  - `cc_report_set_schedule(id,schedule)` — owner-scoped cadence set.
  - `cc_digest_run_due()` — SERVICE-ROLE only: snapshots each DUE report (impersonates the owner locally so the
    owner-scoped snapshot + BI gate resolve correctly), notifies the owner in-app via the Inc 70 backbone, sets
    last_digest_at; a single bad report never aborts the run. Idempotent per cadence window. Off anon+authenticated.
- Proof: **DIGEST ENGINE MATRIX: PASS (10 checks)** — owner sets schedule, invalid rejected, non-owner cannot set,
  run creates snapshot + owner in-app notification + sets last_digest_at, not re-run within window, runner off
  anon+authenticated. Self-cleaning. Applied to prod; md5-identical; anon surface = 5 both DBs.
- OWNER ACTION to activate: schedule `select cc_digest_run_due();` (e.g. pg_cron hourly) — nothing runs until then.
- api wrapper reportSetSchedule.

## CARRIER PORTAL A1 — DASHBOARD AGGREGATE (backend; UI next)
- Owner brief captured in `docs/CARRIER-PORTAL-AND-DESIGN-ROADMAP.md` (full 8-tab carrier-portal vision + site
  design overhaul, broken into shippable increments). Home sections redesigned (distinct motifs + desire-driven
  referral earnings panel) in build_site.py.
- `cwq_carrier_dashboard` (BOTH DBs, md5-identical after `cwq_carrier_dashboard_parity`; anon surface still 5):
  `cc_carrier_dashboard()` — one carrier-self-scoped (my_carrier_org) aggregate: account status + onboarding,
  **"complete your setup" gaps** each carrying a `tone` (warning/action/urgent) + action route (drives the
  highlight-what's-missing requirement), unread + recent **in-app notifications** (Inc 70 backbone, feeds the
  global-colour notification panel), this-week KPIs (active trips, open offers, delivered, revenue), and the
  active-trips list. Real data only; no writes; anon revoked, authenticated-granted.
- Proof: **CARRIER DASHBOARD MATRIX: PASS (6 checks)** — shape, setup_gaps array + numeric KPIs, live notification
  integration (broadcast → unread increments → appears in recent feed), non-carrier denied, anon no EXECUTE.
  Self-cleaning. Applied to prod; md5-identical; anon surface = 5 both DBs. api wrapper carrierDashboard.
- NEXT (queued in task list): carrier Dashboard UI (notification feed w/ global colour tokens, setup-gap cards,
  KPI strip, active-trips) then A2 Available Loads → A3 My Trips → A4–A8 → site-wide design passes. Frontend build
  verification still blocked (sandbox down).
- NOTE on parity: several large functions this session showed a cosmetic md5 drift between the two per-DB applies
  (whitespace between separate pastes); each was caught by the parity check and canonicalized by re-applying one
  identical text to both DBs. All functions now md5-identical across staging + prod.

## CARRIER PORTAL A2 — DECISION-COMPLETE LOAD DETAIL (partial: carrier-facing core done)
- ROUTING (already enforced by the data model, verified this session): broker submissions live in
  `app_private.partner_loads`; a load only reaches carriers once Command Center posts it to `public.loads`
  (status='available'). So carriers NEVER see raw broker loads — the broker→CC→carrier gate is structural.
- `cwr_load_detail` (+ `cwr_load_detail_parity`; BOTH DBs md5-identical `2ead3ce4…`; anon surface 5):
  `cc_load_detail(load_id)` — a carrier-session/staff RPC returning a **decision-complete** view: rate/RPM/miles/
  deadhead, commodity/weight/equipment, pickup+delivery dates & **windows**, **FCFS vs appointment**, **stops**,
  **instructions**, and the broker's **accessorial rate card** (detention/layover/lumper) — all sourced from the
  linked partner_load ("max input" captured at post time). **Broker identity is never exposed** (generic
  posted_by: 'Broker partner' / 'LoadBoot dispatch'). Only status='available' board loads resolve; raw broker
  loads raise. Mandatory-tracking notice included (terms.tracking_required=true).
- Proof: **LOAD DETAIL MATRIX: PASS (6 checks)** on staging — decision-complete shape incl. accessorials, broker
  identity hidden (generic posted_by), tracking mandatory, non-available load rejected, non-carrier-non-staff
  denied, anon no EXECUTE. Applied to prod; md5-identical; anon surface = 5 both DBs.
- Frontend: carrier **Available Loads** cards gain a **"Detailed overview"** button → modal rendering the full
  decision set (accessorial rate card, windows/FCFS, stops, instructions, tracking notice). api wrapper
  carrierLoadDetail. Static-verified (build sandbox recovering).
- A2 RESIDUAL (queued): broker/CC post-time UI to CAPTURE the full accessorial rate card + windows + FCFS as
  required fields (data model already supports it via partner_loads.accessorials/windows/stops); enforce
  location-tracking-on at book (ties into A3 My Trips tracking); pre-book live-chat support (needs chat transport).

## CARRIER PORTAL A3 — EMERGENCY / RESCHEDULE WITH PROOF (My Trips)
- Live tracking (share location, arrive/depart with detention protection) already existed — this adds the
  evidenced-emergency path the owner asked for.
- `cws_trip_emergency` (BOTH DBs, md5-identical `d16e104e…`; anon surface 5): `app_private.trip_emergency_requests`
  (category-checked, status-checked) + three RPCs:
  - `cc_trip_emergency_request(p)` — carrier self-scoped (own trip only); a **DEFINED category** (breakdown/
    accident/weather/medical/road_closure/hours_of_service/mechanical/theft/other) + a **detailed reason (min 10
    chars)** + **mandatory proof_ref** are all required; optional requested reschedule time; notifies dispatch
    in-app (urgent/red via the Inc 70 backbone) + audited.
  - `cc_trip_my_emergencies(limit)` — carrier sees own requests + status.
  - `cc_emergency_review(id, approve, note)` — staff (dispatch.manage) approve/deny with a note.
  - EXECUTE revoked from public/anon, authenticated-granted; review gated by permission.
- Proof: **TRIP EMERGENCY MATRIX: PASS (9 checks)** — valid create, missing proof rejected, short reason rejected,
  invalid category rejected, other-carrier trip denied, carrier sees own, staff approve works, non-staff review
  denied, anon no EXECUTE. Self-cleaning. Applied to prod; md5-identical; anon surface = 5 both DBs.
- Frontend: My Trips active-trip actions gain a **🚨 Emergency** button → modal enforcing category + detailed
  reason + proof (+ optional new delivery time). api wrappers tripEmergencyRequest/tripMyEmergencies/emergencyReview.
- A3 RESIDUAL (queued): staff Emergency-review UI in the Exception Center; richer tracking-history/map polish.
- DISK/SANDBOX: owner's cleanup RESOLVED the disk error (now a transient "download stalled" while provisioning the
  sandbox) — a desktop-app restart should bring it up; then the whole session's frontend gets node/build-verified
  and committed. All backend remains fully proven via the DB connection.

## CARRIER PORTAL A4 (Fleet) — EQUIPMENT SERVICE / MAINTENANCE LOG
- Drivers, trucks and team management already existed; this adds upkeep tracking so a carrier runs the fleet
  without other software.
- `cwt_fleet_service` (BOTH DBs, md5-identical `735cff60…`; anon surface 5): `app_private.fleet_service_records`
  (kind-checked, cost>=0) + `cc_fleet_service_add/list/delete` — carrier self-scoped; a record's truck (if set)
  must belong to the caller's org; kinds = oil_change/tires/brakes/inspection/dot_inspection/repair/pm_service/
  registration/permit/other; list flags `due_soon` (next_due within 14 days) and resolves the truck unit.
- Proof: **FLEET SERVICE MATRIX: PASS (9 checks)** — add (no truck / own truck), not-owned truck rejected,
  invalid kind rejected, list shows own, delete own, delete non-existent rejected, non-carrier denied, anon no
  EXECUTE. Self-cleaning. Applied to prod; md5-identical; anon surface = 5 both DBs.
- Frontend: Fleet tab gains a **Service & maintenance** card — "+ Log service" (truck, type, date, odometer,
  cost, vendor, notes, next-due) + a records list with an ⏰ next-due warning. api wrappers fleetServiceAdd/List/Delete.
- REMAINING carrier-portal (queued): A6 Documents (urgency-highlighted needs + status — checklist model exists),
  A7 Support (message CC + live chat + dedicated dispatcher contact — needs chat transport decision), A8 Account
  (settings/profile — largely exists via cc_pocket_get/save_profile + preferences); plus the site-wide design overhaul.

## CARRIER PORTAL A5 (Finance) — EMPLOYEE PAYROLL
- Per-trip + overall P&L already existed (cc_carrier_pnl); this adds payroll so the carrier runs pay here.
- `cwu_carrier_payroll` (BOTH DBs, md5-identical `baea9f3b…`; anon surface 5): `app_private.carrier_payroll`
  (pay_type-checked, amount>=0) + `cc_payroll_add/list/mark_paid/delete` — carrier self-scoped; pay types =
  salary/hourly/per_mile/percentage/bonus/reimbursement; list returns entries + total/paid/unpaid, labeled
  "manually entered payroll — not audited accounting".
- Proof: **PAYROLL MATRIX: PASS (9 checks)** — add, invalid pay_type rejected, negative amount rejected, missing
  name rejected, list+totals, mark paid, delete own, non-carrier denied, anon no EXECUTE. Self-cleaning. Applied
  to prod; md5-identical; anon surface = 5 both DBs.
- Frontend: Finance tab gains a **Payroll** card (add employee pay + period, mark paid/unpaid, delete, totals
  strip). api wrappers payrollAdd/List/MarkPaid/Delete.
- CARRIER PORTAL STATUS: A1–A5 shipped (backend proven both DBs + UI). A6 Documents / A7 Support / A8 Account
  largely exist already (document checklist + upload, support messaging/issues, profile + comm preferences) — a
  focused depth pass + the A2/A3 staff-side review UIs + the site-wide design overhaul remain.

## A3 LOOP CLOSE — COMMAND CENTER EMERGENCY QUEUE
- `cwv_emergency_queue` (BOTH DBs, md5-identical `2e14ad96…` on first apply; anon surface 5): `cc_emergency_queue
  (status, limit)` — staff (dispatch.view/manage) list of carrier emergency requests enriched with carrier name +
  lane + trip; filter open/all. Pairs with `cc_emergency_review` (Inc A3) for the full request→review→decide loop.
- Proof: **EMERGENCY QUEUE MATRIX: PASS (5 checks)** — staff sees a seeded request with context, all-filter array,
  carrier (non-dispatch) denied, non-staff denied, anon no EXECUTE. Self-cleaning. Applied to prod; md5-identical;
  anon surface = 5 both DBs. api wrapper emergencyQueue.
- BACKEND for the carrier-portal vision is now essentially complete and proven on both DBs. Remaining work is
  FRONTEND-only (Command Center emergency-review screen, A6–A8 depth polish, site-wide design overhaul) which needs
  the build sandbox to `node --check`/build-verify, or a product decision (A7 live-chat transport).

## HOTFIX — LIVE CARRIER PORTAL LOGIN BROKEN (truncated app.js in 9b1bd56)
- SYMPTOM (owner report): loadboot.com → Log in → /app/carrier/ redirects fine but hangs on the
  "Loading…" splash forever. Reproduced live in a real browser.
- ROOT CAUSE (two syntax errors committed in 9b1bd56 — that session could not run gates, sandbox was down,
  and `node --check` parses CommonJS so it can NOT catch either error in an ES module):
  1. `const TONE` declared TWICE in app/carrier/app.js (line 49 new global notification tokens + line 72
     pre-existing status-pill map) → "Identifier 'TONE' has already been declared".
  2. The file was TRUNCATED mid-expression: boot() ended at `appView(user` — no `);`, no closing `}`,
     no `boot();` call.
  Either alone makes the whole ES module fail to evaluate → splash never replaced. Verified live via
  dynamic import: "Identifier 'TONE' has already been declared".
- FIX: line-72 map renamed STATUS_TONE (pill() updated; global TONE tokens stay canonical per guardrail);
  boot() completed + `boot();` restored (ending matches known-good c27c497 tail).
- NEW PERMANENT GATE: `scripts/check_esm_syntax.sh` — `node --input-type=module --check` on every app/**/*.js
  (catches duplicate declarations, truncation, import errors that `node --check` misses).
  Result: ESM SYNTAX CHECK: ALL PASS (91 files). Import-reference check PASS. Build OK; site copy verified.
- DEPLOY NOTE: production Netlify publishes from branch `preview/command-center-v1` (confirmed live —
  home shows 9b1bd56 content; origin/main is 1 commit behind and does NOT gate production).
- No DB change; anon SECURITY DEFINER surface untouched (5).

## B2–B4 — SITE-WIDE DESIGN OVERHAUL (motif library + 11-page pass)
- **B3 — `motifs_module.py`** (new source module, imported by build_site.py, source-only/not published):
  7 visually distinct section motifs — m_rail (floating-number process rail), m_timeline (vertical
  connector timeline), m_split (prose + visual mock panel, optional check bullets), m_dark (dark premium
  icon/number rows), m_zigzag (alternating icon-tile feature rows), m_statband, m_gradcta (per-page
  gradient CTA) — plus 34 ORIGINAL inline stroke-SVG icons (mi()). Each motif has its own layout, icon-chip
  shape and accent; accents varied per page so no two sections (or pages) repeat a look.
- **B2 — referral.html hero** rebuilt to match the home earnings panel: dark emerald-gradient hero with
  earnings-led headline ("Turn your network into monthly income"), the same three ILLUSTRATIVE tiers as the
  home teaser (same disclaimer verbatim — figures labeled illustrative, paid from OUR 5% fee, tiers
  confirmed in writing), single CTA → #join anchor at the forms. "How it works" → emerald rail;
  "Multi-level, minus the games" → dark honesty panel.
- **B4 — page passes** (repeated 3-card grids replaced with varied motifs, content unchanged/honest):
  how-it-works (rail/timeline/dark/zigzag), pricing (split with an illustrative "Example load" receipt
  visual — linehaul/fee/you-keep + no-fee footnote), resources (Load Score split w/ verdict mock, icon
  linkcards, violet reading-path timeline, indigo grad CTA), partners (zigzag + dark 3-step + grad CTA),
  brokers (blue onboarding rail, indigo wizard timeline, explainable-match split w/ factor-bar visual
  labeled illustrative, dark visibility panel, amber exceptions zigzag, grad CTA), carriers (teal zigzag,
  dark sourcing, violet timeline, portal-dashboard split labeled illustrative, orange getting-started rail),
  authority-dot-setup (6-step violet timeline, teal zigzag, dark LoadBoot-fits), boc3-ucr (blue rail, amber
  zigzag), form-2290 (rose deadlines timeline, emerald tips zigzag), ifta (violet math rail, dark audit panel).
- VERIFIED: python build OK on every batch; site_inventory re-run (44 pages; only dashboard.html flagged —
  expected app shell; 6 dup pairs all involve thin utility status.html, pre-existing, none from this pass);
  HTML tag-balance + svg-count + no leftover format specifiers checked on all 11 pages; AI-research footer
  gates ALL PASS; ESM SYNTAX CHECK ALL PASS (91 files); import-reference PASS. No DB change (anon surface
  untouched at 5). All edits done via sandbox-side python (file-tool large-file truncation avoided — see HOTFIX note).

## HOTFIX 2 + FOOTER AI REDESIGN + REFERRAL PAYOUT ENGINE (owner asks)
- **HOTFIX 2:** owner's commit cae3183 shipped app/carrier/app.js with a DUPLICATED boot() ending (a
  delayed file-tool sync landed between my verification and the owner's commit) — live login still hung
  ("Unexpected token '}'", verified live via dynamic import). Working tree corrected on the WINDOWS side
  and re-verified; ESM gate PASS. Owner commits/pushes via GitHub Desktop.
- **Footer AI section redesigned** (owner: "bohot ajeeb lagta tha"): now a clean two-column footer block —
  small-caps "ASK AI ABOUT LOADBOOT" heading + neutral copy + prompt disclosure left; a vertical provider
  list right (ChatGPT/Claude/Gemini/Perplexity/Grok), each row a circular chip with an ORIGINAL geometric
  stroke glyph (no copied logos) + name + hover slide/arrow. All behavior unchanged (copy-first, new tab,
  analytics, fallback). Frontend gate marker switched to structural id="aiResearch"; ALL AI GATES PASS.
- **REFERRAL PAYOUTS + AFFILIATE TRACKING — migration `cww_referral_payouts`** (BOTH DBs, md5-identical
  ×4 fns; anon surface 5 confirmed on both):
  - `app_private.referral_payout_requests` (amount>0, status requested/approved/rejected/paid, ONE open
    request per referrer via partial unique index, bank details in payout_details).
  - `cc_referral_request_payout(details)` — referrer-self; amount = SERVER-computed payable balance
    (client cannot set it); bank_name/account_title/account_number required; audited.
  - `cc_my_payout_requests()` — self history, account number masked to last-4 even for self.
  - `cc_referral_payout_queue(status)` — staff finance.view, full details + live payable.
  - `cc_referral_payout_decide(id, approve|reject|paid, note)` — staff finance.approve; requested→approved→paid
    state machine; 'paid' flips the referrer's payable commissions to paid (mark_paid semantics); the
    REQUESTER CANNOT DECIDE their own payout; decision recorded only — money moves on the normal rail.
  - Proof: **REFERRAL PAYOUT MATRIX: PASS (12 checks)** live on staging (join, hold-money excluded from
    payable, missing-details rejected, exact amount, one-open enforced, masked self-view, carrier denied
    queue, staff queue, paid-before-approve denied, approve→paid flips exactly the payable rows, self-decide
    denied, nobody denied) + all 4 fns anon-unexecutable. Self-cleaning.
- **Frontend:** api wrappers ×4. Carrier portal Account referral card gains **Request payout** (bank modal)
  + payout history with status pills. **Affiliate/influencer mode:** the "No carrier account" dead end now
  detects a referral account (flag-gated) and renders a full **Referral partner dashboard** (unique link,
  referrals, accrued/payable/paid, payout request + history) — influencers without a carrier org can track
  everything themselves. Command Center Referrals view gains a **Payout requests** queue (Approve / Reject /
  Mark paid, finance.approve-gated, confirm dialog restates money-moves-outside).
- **Unique-link attribution:** referral.html + carrier-application.html capture `?ref=CODE` (remembered in
  localStorage) and attach `referral_code` to every lead form submission — an influencer's link is credited
  even when the carrier applies later. Gates: build OK, import-reference PASS, ESM ALL PASS (91 files).

## A6–A8 DEPTH + OWNER BATCH 2 (signout, account menu, ready-to-go loads, required prefs)
- **A6 Documents:** "What LoadBoot needs from you" — every requirement tone-graded via the GLOBAL tokens
  (urgent = required missing/expired/rejected, action = under review, warning = expiring ≤30d / optional,
  success = valid w/ expiry shown), sorted urgent-first, colored left-border rows + count-based subtitle;
  submitted docs show date + "awaiting review".
- **A7 Support:** "Your dispatch desk" card on top — dispatch@ / billing@ direct lines + an urgent-path
  pointer to the trip 🚨 Emergency flow (urgent tone); honest note that in-portal live chat is roadmap
  (transport decision still owner-pending).
- **A8 Account:** "Complete your setup" card — cc_carrier_dashboard setup_gaps rendered with tones + Fix
  deep-links next to Profile.
- **Sign-out fixed (owner report):** session.signOut now races the server call against a 3s timeout and
  FORCE-purges sb-*-auth-token localStorage keys, so the local session always dies; every sign-out button
  shows "Signing out…" and does location.reload() into a clean state.
- **Modern account menu (owner ask):** topbar avatar is now a dropdown — carrier name + email, Account &
  settings, Documents, red Sign out (closes on outside click). CSS added; also added the MISSING
  .cp-field/.cp-input styles (the Dispatch-preferences form was rendering unstyled/broken).
- **READY-TO-GO LOADS — migration `cwx_load_ready_rates` (+_fix) — BOTH DBs, md5-identical
  (d86ae9f2…), trigger present on both, anon surface 5:** BEFORE-INSERT trigger
  `app_private.enforce_load_ready()` on partner_loads — a broker load CANNOT be submitted without a full
  numeric rate card (detention_per_hr, detention_free_hours, layover_per_day, tonu) + lumper_policy + a
  scheduling model (FCFS true OR appointment OR pickup window). Data-layer enforcement = every submit path
  inherits it. Proof: **LOAD READY-RATES MATRIX: PASS (3 checks)** (incomplete rejected w/ named fields,
  schedule-less rejected, complete accepted + rate card stored). Self-cleaning.
- **Partner wizard:** "Requirements" step is now "Rates & requirements" — required detention/free-hours/
  layover/TONU inputs + lumper-policy select + FCFS toggle; client-side validation names what is missing;
  Review shows the full rate card line; payload maps to accessorials{} for the server gate.
- **Dispatch preferences required (owner ask):** Available-Loads tab shows an action-tone banner until the
  carrier sets min RPM / equipment / lanes ("best-match needs these") deep-linking to Account; prefs remain
  editable any time and feed cc_carrier_best_loads + CC AI matching (existing engine).
- Gates: ESM SYNTAX ALL PASS (91 files), import-reference PASS, build OK, AI-footer gates PASS.

## CWY — CC-POSTED LOADS DECISION-COMPLETE + A3 STAFF EMERGENCY SCREEN (loop closed)
- **Migration `cwy_cc_load_rates`** (BOTH DBs, md5-identical 41a39da3…/de7b8fe7…; anon surface 5 both):
  - `cc_create_load_sourced` now enforces the SAME ready-to-go gate as broker submissions — a staff post
    cannot reach the carrier board without field_meta.accessorials (detention_per_hr / detention_free_hours /
    layover_per_day / tonu, numeric) + lumper_policy + a scheduling model (FCFS / appointment / pickup window).
    Fixes the "No accessorial rates specified for this load" case the owner screenshotted.
  - `cc_load_detail` falls back to loads.field_meta for accessorials / windows / appointment / stops, so
    CC-captured terms render to carriers exactly like broker terms (broker identity still never exposed).
  - Proof: **CC LOAD RATES MATRIX: PASS (3 checks)** on staging (rate-less staff post rejected, complete post
    accepted, carrier detail shows the CC rate card + window via fallback). Self-cleaning.
- **Load Intake composer** (Command Center): "Rate card — required" block (detention/free-hours/layover/TONU,
  lumper select, scheduling select + window) with client-side named-field validation; payload maps to field_meta.
- **A3 STAFF LOOP CLOSED — Exception Center gains "🚨 Emergency requests"**: open carrier emergency/reschedule
  requests (category, detailed reason, proof ref, requested new delivery time, carrier + lane context via
  cc_emergency_queue) with per-row **Approve / Deny + decision note** (cc_emergency_review, dispatch.manage-gated;
  field names verified against the live RPC). The carrier-side request flow (cws) now has its staff counterpart.
- Gates: ESM SYNTAX ALL PASS (91), import-reference PASS. No anon-surface change (5 both DBs).

## FOOTER AI → COLUMN + ONBOARDING REQUIRES DISPATCH PREFS (owner instructions; single-commit batch)
- **Footer AI section relocated + compacted** (owner: "column mein ho jaise baqi sections, lambi text nahi"):
  now the 7th links5 column — "Ask AI for info" heading + vertical provider rows (glyph chip + name + ↗),
  no visible prompt/disclosure copy. ALL mechanics preserved (copy-prompt-first, page-aware prompts, new-tab
  noopener, analytics, fallback) via hidden prompt machinery + sr-only live region. links5 grid → 7 columns.
  ai_research_footer_checks.py markers updated to structural ids (owner decision documented in the test).
- **Onboarding wizard: "Dispatch preferences" is now a REQUIRED step** (step 4 of 6) — minimum $/mi, preferred
  equipment (prefills from the equipment step) and lanes are validated before the carrier can continue;
  max deadhead + home base optional; saved via cc_set_dispatch_prefs (editable later in Account, same engine
  that feeds cc_carrier_best_loads + CC AI matching). Review step shows the prefs line.
- Fixed the Loads-tab prefs nudge to read the REAL pref field names (preferred_equipment/preferred_lanes).
- Gates: build OK, ALL AI GATES PASS, ESM ALL PASS (91), import-reference PASS. No DB change (anon 5).

## DOCUMENTS: TAP-TO-UPLOAD ON EVERY REQUIREMENT (owner instruction)
- Every non-valid requirement row in "What LoadBoot needs from you" is now a button (role=button,
  keyboard-focusable): tapping it opens an upload modal with the DOCUMENT TYPE PRE-SELECTED (name→type map:
  insurance/COI→insurance, MC-DOT/MCS-150→authority, W-9→w9, NOA→noa, agreement→agreement, else other),
  file picker + private-storage note; a successful upload refreshes the whole Documents view. Row shows
  "tap to upload" hint + an Upload affordance. Valid items stay non-clickable.
- Gates: ESM ALL PASS (91), import-reference PASS. Frontend only.

## A7 CHAT DECIDED + WIRED — WHATSAPP DEEP-LINK (owner choice via in-session question)
- Owner chose WhatsApp deep-link as the carrier↔dispatch live-chat transport. Support tab's dispatch-desk
  card gains a green "Live chat on WhatsApp" row → wa.me deep link with a prefilled greeting.
- HONESTY GUARD: `WHATSAPP_NUMBER` constant (app/carrier/app.js, top) ships EMPTY — the chat row is HIDDEN
  until the owner sets the real business number in E.164 digits. No invented contact is ever shown.
- OWNER ACTION: set WHATSAPP_NUMBER (e.g. '15551234567') in app/carrier/app.js; optionally point the
  marketing site's floating wa-btn (currently contact.html) at the same number.

## ORIGINAL-LOGO AUDIT — APP PORTALS (owner order: no wrong mark anywhere)
- carrier .cp-logo: the synthetic navy-gradient BOX behind the official icon removed (it made the real
  mark look fake on the login card + sidebar); official icon now renders bare at 34px in carrier, partner
  and developer portals (was 26px inside the box).
- carrier topbar avatar: synthetic blue letter-circle ("C") replaced with the official icon-512 mark
  (round, 38px) — still opens the account menu (name/email/settings/sign out).
- Pocket app: brand rows had NO mark (text only) — official icon added next to the wordmark on both the
  auth and app headers. Command Center/marketing already used the true icon (verified).
- NOTE (tooling): a GitHub-Desktop stash + file-sync race reverted the sandbox tree to HEAD mid-session;
  recovered via `git stash show -p | git apply` (no index lock needed) + idempotent re-apply script.
  All post-commit work verified present again before gates.

## AI FOOTER ROW + TRUE LOGO LOCKUP (owner screenshots; batch 3)
- **Footer AI**: moved OUT of the link columns into its own horizontal ROW below them (chips + names inline);
  "(opens external site)" text REMOVED (the sr-only class was undefined in site CSS, so it rendered visibly
  and wrapped); links5 back to 6 equal columns (owner: "spacing barabar"). Copy-live region now inline
  visually-hidden (real a11y, no visible text). ALL AI GATES PASS; 0 "opens external" strings in output.
- **TRUE LOGO LOCKUP** (owner: login/portals pe "wrong logo"): the approved treatment is icon-"L" + wordmark
  "oadboot" reading as ONE word (marketing header). Portals were rendering icon + FULL "Loadboot" → looked
  like "L·Loadboot". Fixed in ALL brand rows: carrier (auth + sidebar), partner ×3, developer ×2, pocket ×2,
  Command Center brandLogo — wordmark now "oad**boot**"; icon↔word gaps tightened to 2–3px (carrier css is
  shared by partner/developer; cc-brandrow 10→3px).
- CAPSTONE INVARIANTS (live, both DBs): cc_* RPCs **358 = 358** (count parity), anon SECURITY DEFINER
  surface **5 = 5**, payout fns 4/4 present, ready-gate trigger 1/1, referral_program staging ON / prod OFF.

## A9 — POCKET APP DEPTH PASS (driver companion; roadmap Part A closed)
- **Today's trip, front and center**: Home hero card shows the driver's current in_transit (or next
  dispatched) trip with lane, rate, status and a one-tap jump to the full trip actions.
- **Unified notifications on Home**: per-user cc_my_notifications feed (Inc 70 backbone) with the GLOBAL
  tone colours (urgent red / warning amber / action blue / success green / info slate), unread highlight,
  tap-to-mark-read — Command Center pushes now reach the driver's phone view, not just the web portal.
- **Detention protection from the cab**: At/Left pickup + At/Left delivery stamp buttons on active trips
  (cc_trip_arrive/depart — measured minutes; alert shows recorded detention beyond free time).
- **🚨 Emergency from the phone**: proof-backed emergency/reschedule (defined category + detailed reason +
  mandatory proof + optional new delivery time) — same proven cws flow as the carrier portal (payload keys
  matched to the verified carrier implementation).
- Gates: ESM ALL PASS (91), import-reference PASS, build OK. Frontend only (anon surface untouched, 5).
- ROADMAP: Part A (A1–A9) is now fully shipped. Remaining are OWNER ACTIONS (WhatsApp number, pg_cron
  digests/accrual, provider keys, referral prod flag + legal, GA service account, browser-evidence proofs).

## CONTENT QUEUE #5 — "TRUCK DISPATCHER IN TEXAS" (premium local money-page)
- New rich_article `truck-dispatcher-in-texas.html` per the auto-writer rules: ~1,500 words original expert
  content (Texas Triangle reload geometry w/ custom SVG diagram, paying lanes incl. Permian exit-load warning,
  equipment demand, seasons, Laredo border freight, a sequenced sample week, dispatcher value, honest TxDMV
  intrastate note), 2 svc_banners, 4-item FAQ + FAQPage schema, custom THUMB, READTIME 8, blog index card,
  PREMIUM_ARTICLES skip, internal links (tools/authority/new-authority). content-queue.md #5 → DONE.
- Inventory re-run: no new orphans (only dashboard.html app shell); dup pairs down to 3 (all thin status.html
  utility overlaps). Build OK; all gates PASS. Frontend only.

## CWZ — AUTO-DISPATCH ENGINE (100%-automation core loop; owner directive)
- **Migration `cwz_auto_dispatch` (+_fix)** — BOTH DBs, md5-identical (88fd5ef8…), anon surface 5:
  `cc_auto_dispatch_run(actor, limit, top, expiry_min)` — SERVICE-ROLE ONLY cron runner. Every READY-TO-GO
  board load with NO open/accepted offer automatically gets an offer wave to the TOP-matched eligible
  carriers (cc_match_rank order) via the PROVEN cc_offer_send path (eligibility re-checked at send,
  audited, evented, expiry). Broker/CC posts → carriers' phones, zero dispatcher clicks.
- GUARDRAILS: feature flag `auto_dispatch` **staging ON / production OFF** (owner enables); runner must be
  handed a REAL active staff uuid holding dispatch.manage (audit names a person, never a ghost); idempotent
  (open-offer loads never re-offered); expired offers swept each run; carriers still accept by hand —
  booking stays transactional + human on the accepting side; no money automation.
- Proof: **AUTO-DISPATCH MATRIX: PASS (5 checks)** live on staging (invalid actor rejected, flag-off no-op,
  flag-on sends offers on a seeded ready load, second run idempotent, anon+authenticated have NO EXECUTE).
  Self-cleaning. OWNER ACTION to activate: enable the flag + schedule
  `select cc_auto_dispatch_run('<staff-uuid>');` via pg_cron (e.g. every 5 min).
- MARKETING/LEADS NOTE (owner ask): all four target audiences already have dedicated conversion pages with
  lead forms + FAQ schema + the new motif design (carriers.html, brokers.html, shipper-solutions.html,
  referral.html w/ ?ref tracking) + Texas money-page; content-queue #6–#10 remain for further lead content.

## PART C KICKOFF — INDUSTRY RATE DEFAULTS (v1) + FULL-BRIDGE/PAYMENTS ROADMAP (owner directive)
- Broker wizard + CC composer gain **"Use industry-typical defaults"** one-click ($60/hr detention after 2h
  free · $250/day layover · $250 TONU · lumper reimbursed with receipt — editable, labeled typical) and an
  explicit **posting = agreement** note; carriers see the agreed card verbatim pre-book (cwr/cwy paths).
- **docs/CARRIER-PORTAL-AND-DESIGN-ROADMAP.md → PART C** captures the owner's full directive as the next
  session's executable map: C1v2 server-side rate-standards + recorded agreements, C2 shipper↔broker bridge
  (industry needs both ways + CC pipeline/SLA), C3 carrier↔broker deepening (scorecards/pay-signal),
  C4 referral 100% automation (auto-accrue on paid invoice + auto-claim from ?ref), C5 bank-account payment
  system (verified profiles, masked, recorded-only transfers, maker/checker unchanged).
- Gates: ESM ALL PASS, build OK. NOTHING owner said is dropped — sab roadmap + task list mein hai.

## CXA — C1v2 SHIPPED: CANONICAL INDUSTRY RATE STANDARDS + RECORDED AGREEMENTS
- **Migration `cxa_rate_standards` (+_fix)** — BOTH DBs, md5-identical ×3 fns, 7 standards seeded, anon 5:
  `app_private.rate_standards` (detention $60/hr, 2h free, layover $250/day, TONU $250, lumper
  reimbursed-with-receipt, driver assist $75, stop-off $50/stop — VERSIONED, staff-editable via
  `cc_set_rate_standard` w/ audit; `cc_rate_standards` readable by every authenticated user so brokers,
  carriers and staff all see ONE truth).
- **Automatic recorded agreement:** AFTER-INSERT triggers on partner_loads + board loads write
  `app_private.load_rate_agreements` — WHO agreed, WHEN, the exact rate snapshot AND the standards version
  in force. Every posted load now carries a permanent agreement record.
- **Frontend server-truth:** wizard/composer "Use industry defaults" buttons now pull live
  cc_rate_standards (fallback constants). api wrappers rateStandards/setRateStandard.
- Proof: **RATE STANDARDS MATRIX: PASS (5 checks)** (all-auth read, carrier edit denied, staff edit bumps
  version, CC-post agreement auto-recorded w/ snapshot+actor, broker-post agreement auto-recorded).
  Self-cleaning. Gates: ESM ALL PASS, imports PASS.

## CXB — C6 v1: MARKETING INTELLIGENCE BACKEND (ad-campaign-ready first-party data)
- **Migration `cxb_marketing_intel` (+_fix)** — BOTH DBs, md5-identical (617c2a41…), anon surface 5:
  `cc_marketing_intel(days)` (staff: analytics.view/comm.manage/comm.send) — ONE read for the ad desk:
  top pages (beacon pageviews), UTM sources/mediums + campaigns by LEADS (paid-channel truth for
  Google/Meta/TikTok spend decisions), referrer domains, leads-by-audience (carrier/broker/shipper/
  referral_partner/newsletter/careers via form_key, spam-filtered), gap-filled daily lead series, and
  live audience bases (carrier/broker/shipper orgs, drivers, referral partners, newsletter opt-ins) =
  reachable marketing universe per audience. Honest basis string; keyword-level Google data rides the
  already-built gsc-insights function once the owner connects the Google service account.
- Proof: **MARKETING INTEL MATRIX: PASS (3 checks)** (shape, real audience base, carrier denied) +
  anon no EXECUTE. api wrapper `marketingIntel`. C6 task tracks the CC view/graphs + audience-push UI.

## C6 v2 — MARKETING INTELLIGENCE VIEW (Command Center)
- New `/marketing-intel` view (nav: Marketing Intelligence; perm analytics.view / comm.manage / comm.send):
  KPI strip (window leads + per-audience base w/ new-lead counts + newsletter reach), leads-per-day mini
  chart, and measured-conversion bars — leads by audience, UTM sources (per-channel ad truth), UTM
  campaigns, top pages (paid landing candidates), referrer domains — all off cc_marketing_intel (cxb).
  Footer note routes audience PUSH to the existing rails: Campaign Manager (consent-enforced email) +
  Notify broadcast (in-app by role). Files: views/marketingIntel.js, app.js, shell.js, api.js.
- Gates: ESM ALL PASS (92 files), import-reference PASS. C6 residual (GSC keyword panel + keyword
  suggestions + one-click push buttons) stays tracked in task #22.

## CXC — C4 SHIPPED: REFERRAL PROGRAM 100% AUTOMATION
- **C4a auto-claim (frontend):** the marketing site already stores ?ref=CODE in localStorage; the carrier
  portal now claims it SILENTLY on first entry (server still enforces one-referrer-per-org + no self-claim)
  then clears the key — an influencer's link converts to a tracked referral with zero manual steps.
- **C4b auto-accrue — migration `cxc_referral_auto_accrue`** (BOTH DBs, md5-identical ×3 fns, trigger on
  both, anon 5): the proven accrual logic moved to internal `app_private.referral_accrue_core` (never
  granted); `cc_referral_accrue` is now a finance.manage-gated wrapper; an AFTER INSERT/UPDATE-of-status
  trigger on fin_invoices fires the core the MOMENT a fee-bearing invoice is sent/paid — commissions accrue
  and hold-expired rows promote to payable with no cron and no click. Trigger swallows its own errors so
  invoicing can never break on accrual.
- FULL AUTOMATED CHAIN NOW: influencer link → auto-claim → carrier hauls → invoice paid → auto-accrue →
  15-day hold auto-promote → payout REQUEST by referrer (bank details) → the ONLY human gate: staff
  approve/paid (money moves on the normal rail).
- Proof: **AUTO-ACCRUE MATRIX: PASS (4 checks)** (trigger accrues on paid fee-invoice, idempotent re-fire,
  carrier denied on wrapper) + anon surface 5. Self-cleaning (incl. chain-wide commission cleanup).

## CXD — C5 SHIPPED: BANK-ACCOUNT PAYMENT SYSTEM (default rail; frontend + backend)
- **Migration `cxd_payment_profiles`** — BOTH DBs, combined md5 IDENTICAL, anon surface 5:
  `app_private.org_payment_profiles` (one bank profile per carrier/broker org) + 4 RPCs:
  `cc_set_my_payment_profile` (self-scoped upsert; required fields; ANY edit auto-resets verification),
  `cc_my_payment_profile` (masked last-4 even for the owner), `cc_payment_profiles_queue`
  (finance.view; full details for verification), `cc_verify_payment_profile` (finance.approve; verifier
  recorded; revoke supported). NO money moves from any of this — transfers stay recorded-only under
  maker/checker; ACH/provider integration is a future owner decision.
- Proof: **PAYMENT PROFILES MATRIX: PASS (7 checks)** (self set unverified, masked self-read, partial
  rejected, carrier denied queue, staff full-detail queue + verify, edit resets verification, outsider
  denied) + anon no EXECUTE. Self-cleaning.
- **Frontend:** carrier Account gains **"Payment method (bank)"** card — tone-coded status
  (warning=not set / action=awaiting verification / success=verified), masked display, add/update modal
  with the verification-reset notice. api wrappers ×4 (staff queue UI for Finance tab tracked in C5 task
  residual with broker-portal card).

## CXE — C3 SHIPPED: CARRIER↔BROKER BRIDGE TRUST SIGNALS
- **Migration `cxe_bridge_signals`** — BOTH DBs, combined md5 IDENTICAL, anon surface 5:
  - `cc_broker_view_carrier(carrier)` — a broker sees a carrier's REAL performance summary (delivered
    trips, on-time % with basis, open exceptions) but ONLY for a carrier holding an offer/booking on that
    broker's OWN loads — no directory browsing, entitlement enforced in SQL.
  - `cc_carrier_view_poster(load)` — a carrier sees the POSTING PARTY's track record for an available
    board load (loads submitted/posted/delivered, on-time %) with identity still hidden ('Broker partner');
    LoadBoot-direct posts answer honestly with a no-external-party basis.
- Proof: **BRIDGE SIGNALS MATRIX: PASS (4 checks)** (relationship-less broker denied, carrier poster-view
  works incl. LoadBoot-direct answer, carrier denied broker view, outsider denied) + anon no EXECUTE.
- api wrappers brokerViewCarrier/carrierViewPoster. UI surfacing (poster card in the carrier
  "Detailed overview" modal + carrier summary chip on broker offer rows) tracked as C3 residual with C2.

## CXF — C2 SHIPPED: SHIPPER↔BROKER BRIDGE (request→assign→quote pipeline)
- **Migration `cxf_shipper_broker_bridge`** — BOTH DBs, combined md5 IDENTICAL ×5 fns, anon surface 5.
  Built ADDITIVELY on the existing app_private.partner_shipments (+10 columns: assigned_broker, facility_notes,
  dock_hours, appointment_required, terms, quote fields, tendered_partner_load). COMPLIANCE BOUNDARY intact:
  shipper stays inquiry/coordination scope, a LICENSED broker handles the transaction, CC controls assignment.
  - `cc_assign_shipment(id, broker)` — staff (dispatch/partners.manage); refuses non-broker orgs.
  - `cc_broker_shipment_inbox()` — broker self: assigned requests WITH the industry detail a broker needs
    (facility notes, dock hours, appointment flag, terms, weight/commodity/pieces).
  - `cc_broker_quote_shipment(id, amount, note)` — broker self on own assignment; positive amount enforced.
  - `cc_shipper_my_shipments()` — shipper self: status + quote; broker identity HIDDEN ('Licensed broker partner').
  - `cc_shipment_pipeline()` — CC SLA view: every request with status + age_hours.
- Proof: **SHIPPER-BROKER BRIDGE MATRIX: PASS (6 checks)** (non-broker assignment refused, assign works,
  broker inbox carries facility detail, zero-quote refused + quote recorded, carrier denied inbox, staff
  pipeline shows quoted+age). Self-cleaning. api wrappers ×5. Portal UI panels = C2 residual (with C3 UI + C6).

## C2/C3 UI WIRED — BRIDGE SCREENS IN THE PORTALS
- **Broker portal:** new "Shipper requests (assigned to you)" card — CC-assigned shipper freight with the
  full industry detail (equipment/weight/commodity/ready date, facility notes, dock hours, appointment flag,
  terms) + INLINE QUOTE (amount + note → cc_broker_quote_shipment; positive-amount client check; re-quote
  supported; status pills). Empty state explains the CC-routes-to-licensed-brokers model.
- **Carrier portal:** the "Detailed overview" modal now appends the POSTING PARTY's real track record
  (loads delivered, on-time %, submitted — identity hidden; LoadBoot-direct posts answer honestly) via
  cc_carrier_view_poster — the carrier's decision set is now complete INCLUDING who they are working with.
- Gates: ESM ALL PASS (92 files), import-reference PASS. C6 residual (GSC keyword panel = owner Google SA;
  one-click audience push buttons) remains the only open UI item.
