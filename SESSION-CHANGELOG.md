
## #57 — Amazon-style trip tracker + nicer PDF
- Carrier My-trips: each trip card now shows a 4-stage horizontal progress tracker
  (Booked → Dispatched → In transit → Delivered) driven by real trip.status —
  completed stages green with ✓, current stage blue with glow ring, filled progress
  lines. Canceled trips show a red "Trip canceled" note instead. (app/carrier/app.js
  `tripStepper()`, app/carrier/carrier.css `.cp-steps/.cp-step*`)
- PDF (dispatch sheet / rate con / delivery / statement): navy branded header band,
  "boot" recolored to brand blue (#4ea6f9) — was orange, white uppercase status pill,
  larger money total. (app/shared/ui/printDoc.js shell)
- Gates: ESM ALL PASS (93), BUILD OK, GRAND AUDIT 0 FAIL.

## #58 — Finance: every item downloadable as detailed PDF
- Each invoice row now has a ⬇ PDF button → detailed invoice PDF (invoice #, status,
  load, lane, issued/due, gross, 5% fee, carrier net).
- Each settlement now lists individually with its own ⬇ PDF (settlement #, status, net,
  gross, fees, date).
- Statement PDF enriched: itemized Invoices section + Settlements section.
- (app/carrier/app.js loadFinance)

## #59 — Dispatch preferences: max-detail matching profile + required essentials
- DB (prod + staging): carrier_dispatch_prefs gained avoid_states, target_rpm,
  max_weight_lbs, min_trip_miles, max_trip_miles, hazmat, team_drivers, weekend_ok,
  min_notice_hours. cc_set_dispatch_prefs rewritten to persist them AND enforce
  server-side: min_rpm>0, ≥1 equipment, ≥1 lane, home_base required (errcode 22023).
- Account form rebuilt: 11 text fields + 3 toggles + dispatcher notes, required (*)
  markers, inline red-highlight validation, and a "Matching profile X% complete" meter.
  So the matching engine has everything to push perfect loads. (app/carrier/app.js
  loadAccount, carrier.css .cp-invalid)
- Gates green: ESM ALL PASS (93), BUILD OK, GRAND AUDIT 0 FAIL.

## #60 — New white logo + max wire detail + CC document preview
- Logo: owner replaced logo-full-dark.png (white "load" + blue "boot", 2759×639,
  transparent). Rebuilt site (copies to site/), refreshed the CC splash embedded
  base64 copy from the new file. Live everywhere the white lockup appears.
- Payments (DB prod+staging): org_payment_profiles gained routing_number, account_type,
  payment_method, bank_address, swift_bic, beneficiary_address, remittance_email,
  bank_phone, tax_id, factoring_company, factoring_noa. cc_set_my_payment_profile stores
  them + now REQUIRES bank, title, account #, routing #, account type. Carrier bank modal
  expanded to full wire/ACH/factoring detail; card shows type/ABA/method/NOA.
  New cc_carrier_payment_profile(org) (finance.view) + Carrier-360 "Payout & bank details"
  card with verify/revoke — every carrier's payout details on-desk in Command Center.
- CC Documents review drawer: live preview (PDF iframe / image) + Open + Download via
  server-signed URL. doc_read storage policy broadened to documents.view staff;
  cc_list_documents now returns file_path. (documents.js)
- Gates green across all: ESM 93 PASS, imports PASS, BUILD OK, GRAND AUDIT 0 FAIL.

## #61 — Document preview + download in Carrier 360 too
- cc_carrier_360 documents now include id + file_path (prod + staging).
- Carrier 360 document rows are clickable → drawer with live preview (PDF/image) +
  Open in new tab + Download (server-signed URL). (carrier360.js openDocPreview)
- So documents are preview- and download-able in both the Documents queue and each
  carrier's 360 record. Gates: ESM 93 PASS, imports PASS, BUILD OK, AUDIT 0 FAIL.

## #62 — Brokers & shippers gated: no posting until onboarded + verified
- DB (prod + staging): app_private.org_onboarding_complete(org) = all legal/required
  onboarding_packet_templates items verified/waived. BEFORE INSERT triggers on
  partner_loads + partner_shipments raise 42501 unless the posting org is complete —
  catches every posting path (post_load, submit_load, request_shipment). Broker needs
  6 items (MC authority, BMC-84 bond, W-9, agreement, bank, claims), shipper needs 8.
- cc_partner_overview now returns status + onboarded + onboarding_pending.
- Partner portal (broker + shipper): Post-a-load / request form is replaced by a
  "Verification required to post loads" card (pending count + inline onboarding packet
  with submit buttons) until onboarded === true. (partner/app.js verifyGateCard)
- Gates: ESM 93 PASS, imports PASS, BUILD OK, AUDIT 0 FAIL.

## #63 — Carrier portal: dedicated Account Health tab (Amazon Seller-Central style)
- New "Account health" nav tab (shield icon, right under Dashboard). loadHealth()
  renders: conic score gauge (0–100, tone-coded), tier banner, KPI tiles (score,
  standing, points lost, open issues), a "Suggested warnings & actions" card where each
  deduction shows points lost + a Fix button routing to the right tab (documents/finance/
  trips/account), and a "How your score works" explainer. Real-time via accountHealth().
- Added shield path to carrier ic() icon map.
- Gates: ESM 93 PASS, BUILD OK, AUDIT 0 FAIL.

## #64 — Carrier sidebar "Carrier" label + logo correction
- Added white "Carrier" label next to the carrier sidebar logo (matches partner/shipper
  role labels). (carrier app.js cp-brandrow)
- logo-full-dark.png: reverted an accidental orange→white recolor; canonical dark logo =
  orange swoosh + white "load" + blue "boot" (per owner's file). CC splash base64 regen.
- Marketplace trust/governance system planned as tasks #60 (trust score + verified badge
  foundation), #61 (book-request approval flow replacing direct booking), #62 (cross-party
  profiles + shipper↔broker vetting).
- Gates: ESM 93 PASS, BUILD OK, AUDIT 0 FAIL.

## #65 — Trust foundation (Phase 1) + cross-party profiles (Phase 3 start)
- cc_trust_profile(org) [prod+staging]: verified badge (all legal/required onboarding
  items verified + active), trust score 0-100 (0.55 onboarding completeness + 0.25 on-time
  perf + 0.20 tenure), star rating 0-5, safe public metrics (docs verified/required,
  on-time %, deliveries, tenure). Cross-party readable (grant authenticated).
  cc_my_trust_profile() self-scoped variant. api: trustProfile / myTrustProfile.
- Carrier Account Health tab: new "Trust profile — what brokers & shippers see" card
  (verified badge, star rating, trust score, docs verified, on-time, tenure).
- Cross-party: cc_carrier_view_poster now returns broker_verified / broker_trust_score /
  broker_rating → carrier's load view shows the broker's Verified badge + rating + trust.
  cc_broker_view_carrier now returns carrier verified/score/rating + dispatch PREFERENCES
  (min/target rpm, equipment, lanes, home base, deadhead, hazmat, team) — ready for the
  broker/booking surface. Load requirements already shown to carrier via load detail.
- Remaining for full Phase 3: broker-side carrier-profile UI + shipper↔broker vetting,
  which land with the book-request approval flow (#61).
- Gates: ESM 93 PASS, imports PASS, BUILD OK, AUDIT 0 FAIL.

## #66 — Book-request approval flow (#61) + anti-disintermediation + broker invoices
- Book-request approval (prod+staging): app_private.load_book_requests + cc_request_book_load
  / cc_my_book_requests / cc_book_requests_queue / cc_decide_book_request. Carrier "Book"
  replaced with "Request to book"; broker/staff approve (books for the requesting carrier,
  creates trip, notifies) or decline. Sibling pending requests auto-rejected on approve.
- ANTI-DISINTERMEDIATION: cc_trust_profile now returns anonymized 'ref' (no company name);
  booking queue shows brokers an anonymized "Carrier XXXXXX" (staff see real name). Broker
  identity already hidden from carrier; removed the "Broker: <name>" leak on the load card.
- Cross-party (Phase 3): carrier load view shows broker Verified badge + rating + trust;
  cc_broker_view_carrier returns carrier trust + dispatch preferences.
- Broker invoices: each invoice now has Preview (modal), Download PDF (branded), "I've paid"
  → expected pay date + reference + proof upload (stored), and a Proof viewer. Columns
  payment_proof_path/expected_pay_date/payment_ref/payment_note added; submit + list RPCs
  extended. (partner/app.js invoicesCard)
- Still queued: #62 shipper↔broker vetting, #63 approved-partners registry.
- Gates: ESM 93 PASS, imports PASS, BUILD OK, AUDIT 0 FAIL.

## #67 — Approved-partners registry (#63) + shipper↔broker (#62)
- cc_my_approved_partners() [prod+staging]: carrier → anonymized brokers who approved their
  book-requests; broker → approved carriers + shippers worked with; shipper → brokers on
  their shipments. Each entry is an anonymized trust profile (ref, verified badge, rating,
  score) + deals count + last_at. Identity never exposed (anti-disintermediation).
- UI: carrier Account Health "Approved brokers" card; broker & shipper dashboards
  "Approved partners" card. api: myApprovedPartners.
- Completes the two-sided marketplace trust loop: standards → scoring → verified badges →
  request-to-book approval (broker sees anonymized carrier profile) → approved-partners
  network, all identity-private.
- Gates: ESM 93 PASS, imports PASS, BUILD OK, AUDIT 0 FAIL.

## #68 — CC Booking Requests view + logo boot-color unify
- Command Center: new "Booking requests" nav item + view (bookingRequests.js) so staff
  approve/decline carrier book-requests (incl. LoadBoot-direct loads with no broker). Shows
  real carrier name + trust profile (verified badge, rating, score, on-time, docs). Route
  guarded by loads.assign/publish/carriers.view. Closes the direct-load approval gap.
- Logo: footer/dark logo "boot" recolored from #53A8F9 → #0883F7 to exactly match the
  header logo's boot (owner request). Reverses the earlier dark-bg brightening. CC splash
  base64 regenerated. Canon: boot = #0883F7 on BOTH light and dark lockups.
- Gates: ESM ALL PASS (94), imports PASS, BUILD OK, AUDIT 0 FAIL.

## #69 — Emergency photo proof + granular per-user permissions
- Emergency (#52): pocket + carrier emergency modals now take a real CAMERA PHOTO as proof
  (uploadPodDocument → storage path in proof_ref), plus optional link. Backend already
  pushed to broker + applied reschedule on approve. (Recovered carrier/app.js from an
  Edit-tool truncation via HEAD tail.)
- Granular permissions (#64, prod+staging): app_private.user_permission_grants (allow/deny)
  + has_global_permission honors overrides (deny wins, allow adds; role grants unchanged).
  cc_list_permissions_for / cc_set_user_permission with grant-ceiling (only assign perms you
  hold) + no self-edit + audit. CC UI: permissionEditor.js drawer — 71 permissions grouped
  by category with checkboxes (Amazon Seller-Central style); "Permissions" button per staff
  row in Staff & Roles.
- Gates: ESM ALL PASS (95), BUILD OK, AUDIT 0 FAIL.

## #70 — Live chat widget, print real-logo, favicons, social banner
- Live chat: shared self-mounting chatWidget.js floating launcher on every dashboard
  (carrier/partner/pocket/CC). WhatsApp channel when number set + always-reachable email
  (hello@ / dispatch@). 
- Print/PDF "fake logo" fixed: exporters.js + printDoc.js now embed the real logo image
  (logo-full.png / logo-full-dark.png) instead of the orange-boot text wordmark.
- Favicons regenerated to fill the canvas (~90-94%) so the mark reads clearly in tabs;
  apple-touch on white tile, maskable on navy safe-zone.
- Social share: new 1200x630 og-image.png (navy + white logo + tagline); og:image +
  twitter:image point to it; twitter:card = summary_large_image; og:image:width/height set.
- Gates: ESM ALL PASS, BUILD OK, AUDIT 0 FAIL.

## #71 — Global search made real + functional notification bell + og-image
- Global search (prod+staging): cc_global_search broadened — carriers (name/MC/DOT/company),
  brokers/shippers/facilities, loads (lane/reference/broker/commodity), leads, invoices,
  drivers (name/phone). SEARCH_HASH routes partner→/partners, driver→/fleet.
- Notification bell (CC topbar): replaced the static dot with a real unread COUNT badge +
  dropdown listing recent notifications (myNotifications), click marks read + navigates,
  "Mark all read", auto-refresh every 60s. (shell.js notifBell)
- Social og-image: larger crisp logo (840px) + real tagline "Keep your wheels earning."
- Gates: ESM ALL PASS (96), imports PASS, BUILD OK, AUDIT 0 FAIL.

## #72 — CC Account Health: clickable, expandable, suggested warnings (rewritten)
- cc_account_health_board now includes org name (prod+staging).
- accountHealth.js: names link to Carrier 360 / partner record; each card has a Details
  toggle → expandable panel (full deduction basis + deep links to 360 & Documents); a
  SUGGESTED warning derived from the account's real deductions pre-fills the Issue form
  (kind/severity/reason). Onboarding-packet rows clickable into the record.
- NOTE: mounted-folder Write truncated the file at ~line 78 twice; wrote via shell heredoc
  to /tmp, node-checked, then cp'd into place. LESSON: for large CC view rewrites, prefer
  shell heredoc → verify → cp over the Write tool when the mount is flaky.
- Gates: ESM ALL PASS (96), BUILD OK, AUDIT 0 FAIL.

## #73 — Footer Company/service-area + purpose emails + SEO contact schema (#45)
- Footer now has a "Company" block: purpose-labeled emails (General & support → hello@,
  Dispatch & loads → dispatch@, Billing & settlements → billing@) + an explicit service-area
  line ("truck dispatch marketplace, serving owner-operators & fleets across the United
  States, all 48 states") — the location signal for Google + user clarity.
- ProfessionalService JSON-LD strengthened with contactPoint[] (support/dispatch/billing)
  alongside the existing areaServed: United States — richer entity for search.
- Gates: BUILD OK, AUDIT 0 FAIL. (build_site.py; verified in built site/index.html)

## #74 — Verified & closed carrier-header (#51) + account-status attention (#56)
- #51 confirmed: bell shows real unread count (bellBadge.textContent), Action-needed is a
  clickable button that pulses (cp-attn-pulse), mobile account menu present (cp-menu-item).
- #56 confirmed: account-status strip fully tappable (cp-row-click → account), global TONE
  tokens (toneOf) drive colours across the dashboard.
- Full gate pass this turn: ESM ALL PASS (96), imports PASS (report = known false-positive),
  BUILD OK, AUDIT 0 FAIL.

## #75 — CC License & medical expiry monitor (#41)
- cc_fleet_expiry_board(days) [prod+staging]: every driver across all carriers whose CDL
  or medical card expires within N days (or is expired), sorted most-urgent-first, with
  carrier name, phone, days-left. cc_warn_driver_expiry(driver,kind) notifies the carrier
  owner instantly. api: fleetExpiryBoard / warnDriverExpiry.
- New CC view fleetExpiry.js + nav "License & medical expiry": KPIs (flagged / expired /
  due ≤14d), 30/45/90-day filter, per-driver cards (tone-coded), "Warn carrier" one-click,
  and a Carrier 360 deep link. Route /fleet-expiry (fleet.view or carriers.view).
- Gates: ESM ALL PASS, imports PASS, BUILD OK, AUDIT 0 FAIL.

## #76 — CC search covers menu items + Contacts directory (#38)
- Global search now also matches NAV/menu pages (flattenNav → NAV_PAGES); typing a page
  name shows "Page" results that navigate on click, above the data results. (shell.js)
- cc_contacts_directory(search,kind,limit) [prod+staging]: every account holder with
  verified badge (onboarding complete + active), contact, MC/DOT, status. New CC view
  contactsDirectory.js + nav "Contacts directory" (route /contacts): KPIs, kind filter,
  search (name/MC/DOT/email/phone), verified badges, row → Carrier 360 / partner record.
- Gates: ESM ALL PASS, imports PASS, BUILD OK, AUDIT 0 FAIL.

## #77 — Ops Radar extended with new actionable items (#30 covered)
- cc_ops_radar (prod+staging) now also returns booking_requests (pending), open_emergencies,
  documents_pending, payment_reports (payment_submitted invoices).
- radar.js: new KPIs (Emergencies / Booking requests / Docs to review) + four new feed cards,
  each linking to the resolving module (/exceptions, /booking-requests, /documents, /finance).
  So Ops Radar is now the complete unified action inbox across every flow added this session.
- Gates: ESM ALL PASS, BUILD OK, AUDIT 0 FAIL.

## #78 — CRITICAL fixes: carrier login + settlement names
- ROOT CAUSE of carrier "Loading…" hang: printDoc.js was truncated at line 65 and lost its
  openPrintable + printDispatchSheet exports; carrier/partner app.js import them, so the ES
  module import failed and the app never mounted. RESTORED both functions (reconstructed
  from the known signatures using the existing shell()/row() helpers). All portal imports
  now resolve (verified with an export-resolution script — ALL IMPORTS RESOLVE).
- CC Finance "New settlement": rows showed blank names because cc_list_carriers returns
  `company` (not `name`); code read c.name. Fixed → c.company (+ MC).
- Gates: ESM ALL PASS (98), BUILD OK.
- NOTE for owner: none of this reaches loadboot.com until committed + pushed + merged to
  main. Empty panels like "No referrer rows"/"0 settlements" are correct empty states for a
  fresh account, not bugs.

## #79 — Staff invite-by-email (#65)
- DB (prod+staging): app_private.staff_invites + cc_invite_staff(email,role) [token + setup
  link, grant-ceiling, blocks owner], cc_list_staff_invites, cc_revoke_staff_invite,
  cc_claim_staff_invite (self-service: on first login with the invited email, provisions
  staff_members + internal-org membership + the role assignment; matched by auth email).
- Staff & Roles: "Invite a staff member by email" card — email + role → creates invite,
  shows a copyable setup link + a pre-filled "Send invite email" (mailto template) + a
  Pending-invites list with Revoke. Gated by staff.assign_role/roles.assign.
- CC boot: cc_claim_staff_invite() runs before the staff gate, so an invited person who
  signs in is auto-granted access and lands straight in the Command Center.
- Gates: ESM ALL PASS (98), BUILD OK, AUDIT 0 FAIL.

## #80 — Health engine (rolling recovery), booking setup-gate, doc-preview CSP, brand labels
- cc_account_health (prod+staging): 180-day rolling window for performance; staff strikes
  auto-recover by severity (warning 90d / violation 180d / critical 365d) if not repeated;
  every deduction now carries an "improve" how-to line; window_days=180. Carrier Account
  Health tab shows the ↳ improve guidance per deduction.
- Booking setup-gate: cc_request_book_load now requires matching profile (min rate,
  equipment, lanes, home base) + mandatory compliance before a carrier can request a load.
  Available Loads shows a "Complete your setup to start booking loads" banner when incomplete.
- Document preview fix: CSP img-src/frame-src now allow the Supabase storage domain (was
  blocking inline image/PDF previews in CC Documents). (build_site.py _APP_CSP)
- Carrier "Carrier" label: not bold, lighter, nudged to top corner, closer to logo (sidebar
  + login), matching the partner/shipper reference.
- All gates: ESM 98 PASS, BUILD OK, AUDIT 0 FAIL.

## #49 — Carrier Finance: real per-trip P&L
- cc_carrier_pnl (prod+staging) now returns by_trip[]: every delivered/invoiced load with its
  own linehaul, billable accessorials, gross, 5% dispatch fee, carrier net, mileage-allocated
  expense share, est. trip profit, RPM, on-time flag, truck, commodity/equipment.
- Carrier → Finance → new "Per-trip P&L" card: each trip is a tappable row (load + lane +
  date + gross → profit); expands to a full money breakdown and a "Trip P&L PDF" export.
- Honest labeling preserved: allocated expenses = month's entered expenses spread by miles;
  est. profit = net after 5% fee minus allocation.
- Gates: node --check carrier app.js OK, BUILD OK, AUDIT 0 FAIL.

## #44 — Unified account-creation hub (get-started.html)
- New tabbed hub: Carrier / Broker / Shipper / Referral & Influencer. Each tab = role value
  block (what you get) + portal link + a tailored lead form (carrier_application, broker_signup,
  shipper_signup, referral_signup). Deep-linkable (#broker etc.); tracks hub_role_selected.
- Repointed the global "Get Started" CTA (header + final CTA) and login "Need an account?"
  card to get-started.html; added to sitemap (HTML + XML auto).
- Gates: BUILD OK, AUDIT 53 pages 0 FAIL.

## #46 — About page redesign (motif-rich + SEO)
- Rebuilt about.html: problem/solution split with navy pull-quote, "What we stand for"
  zigzag, "Our story" timeline, dark "rules we run by" panel, "Who we serve" cards,
  policy-fact stat band (5% / 0 contracts / 100% you approve / 1-day reply), three-front-door
  contact, company FAQ (FAQPage schema), and a gradient CTA to get-started.html.
- SEO: added AboutPage + Organization JSON-LD (knowsAbout keywords); tuned title/meta length.
- NOTE: the Edit tool truncates the large build_site.py on write — edit it via python/bash only.
- Gates: BUILD OK, AUDIT 53 pages 0 FAIL (3 baseline warns).

## #42 — Onboarding & Compliance CC deepening
- compliance.js: KPI cards now clickable — In onboarding / Pending checks (→ in-review stage) /
  Expiring 30d / Expired filter the queue; a focus banner shows the active filter with a Clear.
- One-click "⚠ Warn" on any row that's not mandatory-complete or has documents expiring:
  issues a document warning (cc_issue_violation) and notifies the carrier instantly.
- Live expiry retained per-row ("N soon"); warnings gated to compliance.verify / carriers.manage.
- Validation: node --check compliance.js OK (UTF-8); grand audit 0 FAIL. NOTE: scripts/check_esm_syntax.sh
  pipes files via stdin and mis-flags multibyte UTF-8 in THIS sandbox (fails on pre-existing '·'/'—'
  lines too); direct node --check is authoritative and passes.

## TOOLING FIX + truncation recovery (important)
- DISCOVERY: the Edit/Write tools truncate large files on save in this environment.
  This silently truncated THREE files this session:
  * build_site.py (about/hub edits) — recovered by splicing HEAD tail.
  * app/carrier/app.js — truncated at line 1772 mid-statement by the #49 per-trip P&L edit.
    This is the SAME class of bug that caused the carrier "Loading…" outage before
    (truncated module = SyntaxError = login hang). Recovered by splicing HEAD tail at the
    setup-wizard `st === 2` anchor; per-trip P&L additions preserved; boot() intact.
  * app/command-center/views/compliance.js — truncated by the #42 edit; recovered by
    splicing the original tail (openStart→EOF) onto the good edited head.
- Improved scripts/check_esm_syntax.sh: was piping files via stdin (mangled multibyte UTF-8
  AND, worse, `node --check *.js` is a lenient no-op that MISSED the truncations). Now it
  transliterates non-ASCII (only ever inside UI strings) to ASCII and runs a STRICT
  `node --check` on a temp .mjs — catches truncation/paren/brace/import errors reliably in
  every environment. Verified it catches a deliberately-truncated file.
- GOING FORWARD: edit JS/large files via python/bash writes, then verify with the strict
  .mjs check + line-count sanity, NOT the Edit tool.
- Stray app/_selftest_broken.js (from a gate self-test) could not be unlinked by the sandbox
  mount (EPERM); overwritten to a valid inert `export {};`. Safe to delete on your machine.
- All gates after recovery: ESM ALL PASS (99), BUILD OK, AUDIT 53 pages 0 FAIL.

## #53 (slice) — Pocket app: Uber-style active-trip hero
- Home tab hero upgraded to a driver-first "current trip" card: 3-step progress tracker
  (Dispatched → En route → Delivered) with the live step highlighted, bigger route/rate
  (+ miles), a state-aware primary CTA (Confirm & start vs Continue trip), and a one-tap
  "📍 Share live location" when in transit (reuses shareLocation → consent + GPS post).
- Edited via python + strict .mjs verify (Edit tool avoided due to truncation risk).
- Gates: ESM ALL PASS (99), BUILD OK, AUDIT 0 FAIL.
- #53 remains open: next slices = Trips tab as a full Uber-style trip-detail flow
  (arrive/depart/POD as primary actions), and continuous background location.

## #53 (slice 2) — Pocket Trips tab: per-trip step tracker
- Each trip card now shows the same Dispatched → En route → Delivered progress bar
  (invoiced counts as fully delivered), consistent with the Home hero. Actions unchanged.
- python edit + strict .mjs verify; ESM ALL PASS (99), BUILD OK, AUDIT 0 FAIL.

## #53 (slice 3) — Pocket Trips: richer subtitle
- Trip cards show miles and $/mi alongside rate when present. Gates green.
