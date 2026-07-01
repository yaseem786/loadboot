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
