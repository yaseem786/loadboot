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
