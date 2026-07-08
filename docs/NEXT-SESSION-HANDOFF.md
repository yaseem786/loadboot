# LoadBoot — NEXT-SESSION HANDOFF (read this FIRST)

## 🟢 START HERE — current state + next action (owner is continuing here)

**Local dev now works** (owner's Windows machine, Python 3.14 installed):
- Build: `python build_site.py`  → then  `python -m http.server 8080 --directory C:\Users\HP\Documents\GitHub\loadboot\site`  → open `localhost:8080/app/carrier/`
- Mobile view on laptop: Chrome ⋮ → More tools → Developer tools → `Ctrl+Shift+M` → pick a phone.
- After ANY code change: re-run `python build_site.py`, then refresh the browser.

**Done in the previous session:**
- ✅ Signup auto-provision fix APPLIED to prod DB `rwscphuhpjoudvljvmdk` (and staging `snslhvmkjusozgjelghi`): `handle_new_user()` now also creates `organizations(kind=carrier)` + `organization_memberships(member_role=owner)` on carrier signup, and backfilled stuck carriers. Migration file: `migrations/fix-carrier-signup-provision/0001_carrier_signup_autoprovision.sql`. This fixed the "No carrier account" error.
- ✅ `app/carrier/app.js`: onboarding wizard now reachable (router allows `#onboarding`); bank + FMCSA-verify + in-app W-9/agreement steps inside `loadOnboarding()`; "Propose rate" counter button on load cards (via `requestBookLoad` note); new **"My Profile"** NAV tab.
- ✅ NEW `app/carrier/profile-view.js`: My Profile tab — dark premium, self-styled, live FMCSA 7-tab profile (General/Fleet/Insurance/Safety/Inspections/Violations/Crashes). Wired via app.js render() → `tab==='profile'`.
- ⚠️ NOT yet committed/deployed: the My Profile + router-reachability + profile-view.js changes. Owner must commit → merge to `main` → Netlify build → clear PWA service-worker cache to see them live.

**➡️ NEXT TASK — build the dark premium theme for the whole carrier portal:**
> ✅ 2026-07-06 SESSION 4 (uncommitted): ONBOARDING HARDENING — step gates (1: company+MC/DOT+FMCSA-active incl. silent screen on skip; 2: home base+equipment+trucks; 3: factoring-company OR full bank w/ ABA check; 5: all mandatory docs uploaded); FMCSA verify auto-fill (legalName/mc/phone via carrier.* camelCase fix) + auto-retry + inactive/OOS hard block; docs checklist (live from pocketCompliance, per-row Upload/Start W-9/Sign/Change buttons, auto-upload on pick); dispatch agreement 18-clause letterhead + auto-approve on countersign (cx2) + signature shown in paper + W-9/agreement Download in Account→Legal; premium lbToast + lbConfirm (no browser popups); addr-suggest.js (Photon street autocomplete, W-9+Business addr; CSP+photon+data.transportation.gov); us-cities datalist (home base) + factoring partners datalist (recommend mode only); W-9 classification plain-language hints; account page: fixed 2-col groups+headers, SVG icons, Manrope weights, avatar persist (storage+cc_set_my_avatar), verified-detail unlock dark fix; My Profile honest placeholders. DB (BOTH, parity, anon=5): cx1 fee_collection+ach consent cols/RPCs; cx2 agreement autoapprove; cx3 cc_my_hazmat_readiness (account toggle hard-locked until 3 docs valid); cx4+cx5 hazmat profile<->prefs bidirectional sync triggers; cx6 carrier_hazmat_verified aligned to new 3-doc packet (booking gate); cx7 bank_verification conditional requirement (carrier_has_bank) + generalized condition filter. Booking-gate audit PASS (cc_request_book_load: prefs+mandatory_ok+hazmat_verified hard exceptions). OPEN: dispatch_agreement requirement still optional (owner decision to make mandatory); post-approval authority re-check cron; fee-collection consent UI in wizard; CC flag W-9-state vs FMCSA-state; convert remaining browser confirm() sites to lbConfirm; wire cc risk-flags into compliance drawer (currently Carrier 360 only). Staging fixture: carrier-owner@lb.test RESET to virgin (password loadboot).
> ✅ 2026-07-05 HAZMAT PACKET (BOTH DBs, md5 parity, anon surface 5): migration `cwz_hazmat_conditional_requirements` — compliance_requirements got `condition_key`; 3 new conditional-mandatory rows (hazmat_registration/doc_type hazmat_reg, hazmat_endorsement/hazmat_h, hazmat_insurance/hazmat_coi, all requires_expiry); new app_private.carrier_is_hazmat(org) (dispatch_prefs.hazmat OR member profiles.hazmat); carrier_mandatory_ok + cc_pocket_compliance filter by condition (pocket now also returns doc_type). Matrix: hazmat ON=9 reqs/mandatory_ok false, OFF=6 (fixture self-cleaned). Frontend: DOC_TYPES + onboarding docs-step types include hazmat trio (onboarding shows them only when Haul hazmat is ON, with a warning banner). Also fixed FMCSA verify display bug (edge fn returns carrier.legalName camelCase; g() now reads d.carrier + camelCase).
> 🔒 2026-07-05 SECURITY FIX (BOTH DBs): anon SECURITY DEFINER surface had drifted to 41 (36 cc_* RPCs carried default PUBLIC EXECUTE). Migration `cwy_anon_surface_restore` (staging+prod, identical DO block) revoked public/anon and granted authenticated+service_role explicitly; verified count=5 on BOTH. The 5 intended anon fns: cc_get_public_form, get_active_public_announcements, get_public_load_opportunities, submit_web_form, track_web_event. Re-run the count check after every future migration — creation scripts keep forgetting the revoke.
> ✅ 2026-07-05 session 3 (this session, all UNCOMMITTED): onboarding hero strip on dashboard (prototype design, ring + Submit Your Profile → #onboarding); all dashboard doc-CTAs redirect to onboarding; red compliance banner hidden until onboarding complete; account page = fixed 2-col logical grouping (no masonry shuffle) + verification card shows only items needing attention + .acx beauty pass in carrier-dark.css; auth logo → logo-full-dark.png; auth panel 3-step strip + trust line; CC feature flag ON (staging only); lb.test passwords = loadboot2026 (staging only).
> ✅ 2026-07-05 (FINAL THEME DECISION, owner-approved): DUAL SYSTEM — Carrier portal = Midnight dark (carrier-dark.css); Partner + Command Center + Developer = LIGHT EXECUTIVE via new `app/shared/light-exec.css` (colors/shadows only). Their dark links were swapped to light-exec (cc-dark.css exists but is UNLINKED — keep for a future dark toggle). Rationale: drivers night/mobile = dark; office/data tools = light (Stripe/Seller-Central pattern).
> ✅ 2026-07-05 (later): MIDNIGHT EXECUTIVE rollout — palette softened (bg #0a1322, cards #111c31 w/ subtle gradient, muted #8ea2c3); carrier-dark.css now also covers partner+developer portal classes and is linked in their index.html; NEW app/command-center/cc-dark.css (token-level retint + surface overrides) linked in CC index.html. TONE bgs in app.js switched to dark tints (fixed invisible 'Action needed' rows); dispatch-agreement sign-modal scroll box = white paper (bg #fff inline). Staging lb.test personas got password LoadBoot!2026 (staging only) for portal previews. All uncommitted.
> ✅ 2026-07-05: steps 1+2 DONE — `app/carrier/carrier-dark.css` created (colors-only, 174 lines: cp-* shell/cards/pills/inputs/modal/tabbar + full `.acx` retint via token override) and wired in `index.html` after `carrier.css`. BUILD OK + ESM check ALL PASS. Uncommitted. Remaining = step 3: owner tests locally (desktop + Ctrl+Shift+M mobile), tune colors, then extend to Documents/Account depth. Revert = delete the `<link>` line.
1. Create `app/carrier/carrier-dark.css` — an ADDITIVE override stylesheet (COLORS ONLY, never layout/logic). Dark surfaces: bg `#070b14`, cards `#0d1526`, borders `rgba(255,255,255,.09)`, text `#eaf1fb`, muted `#7f92b3`, accent `#0883F7`/`#3b9dff`, ok `#34d399`. Override the shared classes: `.cp-card, .cp-top, .cp-in, .cp-btn (+variants), .cp-chip, .cp-row, tables, .cp-cardhead, .cp-stat`, plus account-view.js classes `.card, .sec-h, .field, .row, .btn, .chip, .pill, .vpill, .sec-ico`. (`.cp-side` sidebar is already dark.)
2. Wire it: in `app/carrier/index.html`, add `<link rel="stylesheet" href="./carrier-dark.css">` immediately AFTER the `./carrier.css` line.
3. Owner tests locally (`python build_site.py` + refresh) on desktop + `Ctrl+Shift+M` mobile; tune colors as needed. Then extend the same premium look to the Documents + Account pages (do NOT change their logic).

**Rules:** additive & reversible; `node --check` after any .js edit; edit large files via bash/python (Write tool truncates); test on STAGING Supabase not prod; DB changes = migration applied to staging first; after deploy always remind owner to clear the PWA cache.

_Last updated: 2026-07-02 (session 2). Purpose: let a brand-new session (any model) resume with zero context loss._

---
## ⚡ SESSION UPDATE — Onboarding/Marketplace prototype + real wiring (carrier)
_Prototype-to-production pass. All code changes are additive, `node --check`-clean, and revert with `git checkout app/carrier/app.js`._

**Prototype (design spec, clickable, mobile+web):**
- `previews/onboarding-system.html` — full 3-role flow (Carrier onboarding wizard, CC review/forward, Broker post/track). Dark-premium, brand-aligned.
- `previews/portal-final-preview.html` — device-framed (Web/Mobile toggle) viewer of the above.
- `previews/carrier-portal-themed.html` — real carrier portal shell restyled with brand tokens (look-and-feel proof for the design-rollout decision).
- `previews/fmcsa-profile.html` — live FMCSA 7-tab carrier profile (reused as the profile renderer).

**Docs:**
- `docs/PROTOTYPE-MERGE-PLAN.md` — feature→module→endpoint map + audit findings.
- `docs/PHASE1-ONBOARDING-TEST-CHECKLIST.md` — dev test steps for the wiring below.
- `docs/brand-kit/loadboot-tokens.css` — brand design tokens (Navy #10223B / Blue #0883F7 / Orange #FC5305; dark + light). Opt-in; rollout owner-gated.

**Real wiring done in `app/carrier/app.js` (2 scoped areas only):**
1. Onboarding `loadOnboarding()`: FMCSA verify in step 0 (`fmcsaVerify`); bank account fields in payment step (`setMyPaymentProfile`, factoring-exempt, 9-digit routing check); in-app W-9 + agreement launch buttons in docs step (`openW9Wizard`/`openSignModal`). Review shows Payout row.
2. Load card: new **"Propose rate"** counter button → sends carrier's all-in rate via the existing `requestBookLoad(id, note)` note param.

**Audit findings (already in production — no change needed):**
- Broker never sees carrier contact; identity/contact private; live chat via `shared/ui/chatWidget.js` is the single channel (Phase 2 done).
- Marketplace filters + trip tracking already exist in the carrier `loads` view + `tripArrive/tripDepart` (Phase 3 done).
- Counter backend (`offerRespond` `p_counter`, CC `suggested_counter_rate`) already present.

**NEXT (needs human / running app):**
1. Dev-test the two wirings above (use the checklist).
2. Design-token rollout: apply `loadboot-tokens.css` across portals — OWNER-GATED, one batch, eyeball in dev before ship. Not applied to production yet (safety).


## 0. HOW TO START A NEW SESSION
1. Request access to the repo folder: `C:\Users\HP\Documents\GitHub\loadboot`.
2. Read, in order: **this file** → `docs/SESSION-CHANGELOG.md` (full history, newest entries at the bottom) →
   `docs/CARRIER-PORTAL-AND-DESIGN-ROADMAP.md` (the carrier-portal + design vision, tab by tab).
3. Then continue the work in section 6 below.

## 1. WHAT LOADBOOT IS
A US truck-dispatch service platform: a marketing website + four app portals (carrier, partner=broker-only,
command-center=staff, developer) on Supabase. Goal: a carrier dashboard with no real competitor (beating Uber
Freight / Amazon Relay), operating at ~300M-account scale.

## 2. NON-NEGOTIABLE GUARDRAILS (apply to EVERY change)
- **Broker-only partners** (no shipper transactional flows — US broker license required).
- **anon SECURITY DEFINER surface must stay exactly 5.** Check after every DB change:
  `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE');`
  → must return 5. New RPCs must be `revoke all ... from public, anon;` + `grant execute ... to authenticated;`
  (or `service_role` for cron-only). NEVER grant a new SECURITY DEFINER function to anon.
- **Production feature flags OFF** until owner enables (e.g. referral_program: staging ON / prod OFF).
- **No fake/seeded data shown as real.** Everything computed from real rows; estimates explicitly labeled.
- **Every backend increment: apply to BOTH DBs + a live SQL security matrix + md5 parity + confirm anon surface 5.**
- **Commit only at a bare milestone.**
- **Global notification/status colour tokens** (defined once in `app/carrier/app.js` as `TONE`): urgent=red,
  warning=amber, action=blue, success/done=green, info=slate. Reuse everywhere.

## 3. ENVIRONMENT
- Repo: `C:\Users\HP\Documents\GitHub\loadboot`. Branch: `preview/command-center-v1`.
- Supabase MCP (server id `81f05006-...`): use `apply_migration` (DDL) + `execute_sql`.
  - **STAGING project_id: `snslhvmkjusozgjelghi`**
  - **PROD project_id: `rwscphuhpjoudvljvmdk`**
- Build: `python3 build_site.py` → outputs to `site/` (Netlify publishes `site/`). Gates: `node --check` on all
  `app/**/*.js`, `python3 scripts/check_imports.py` (import-reference), then `python3 build_site.py`.
- Frontend helpers: carrier/partner apps use a local `h()`/`mount()`; command-center uses `el`/`mount` from
  `app/shared/ui/dom.js` + components from `app/shared/ui/components.js`. All RPC wrappers live in `app/shared/api.js`.

## 4. THE PROVEN WORKFLOW PATTERN (repeat for each backend increment)
1. Inspect real schema first (`information_schema.columns`, `pg_get_functiondef`) so you build on real tables.
2. `apply_migration` to **staging** (name it `cw<x>_<slug>`; migrations are NOT stored as repo files by design).
3. Run a security matrix via `execute_sql` on staging using a temp table + a DO block; simulate identities with
   `perform set_config('request.jwt.claim.sub','<uuid>', false);` (auth.uid() reads that GUC). Wrap denial tests
   in `begin ... exception when others then ... end;`. **Self-clean** any seeded rows at the end.
4. `apply_migration` to **prod** with the IDENTICAL text.
5. Verify: anon surface = 5 on both + `md5(pg_get_functiondef(...::regprocedure))` identical on both.
6. Add the `app/shared/api.js` wrapper + wire the UI. Log the increment in `docs/SESSION-CHANGELOG.md`.

## 5. GOTCHAS ALREADY HIT (save yourself the pain)
- **md5 drift:** applying "the same" text to staging then prod sometimes differs (whitespace between two pastes).
  FIX: re-apply ONE identical text to BOTH DBs (a `_parity` migration), then re-check — they match.
- **Migrations live in the DB, not the repo.** The repo has no `.sql` for cwj–cwv; the changelog is the record.
  So `git status` shows only frontend files even after huge backend work — that's expected.
- **git `index.lock`:** commits fail with "a lock file already exists". The sandbox CANNOT delete it
  ("Operation not permitted"). The OWNER deletes `C:\Users\HP\Documents\GitHub\loadboot\.git\index.lock`
  (via `del` in cmd) then commits from their own machine. Do NOT try to commit from the sandbox.
- **Sandbox flakiness:** "not enough disk space" → owner frees space (powercfg /h off, cleanmgr Windows.old,
  move files to D:). "Download stalled" / "still starting" → owner restarts the Claude desktop app; retry.
- **execute_sql multi-statement returns only the LAST result set.** Run diagnostics as single statements.
- Cast function signatures with `::regprocedure` (not `::regproc`) when args are included.

## 6. CURRENT STATUS + WHAT'S LEFT
### DONE (committed `9b1bd56`/`c27c497`/earlier + live on BOTH DBs; anon surface 5 throughout)
- Inc 64 BI, 65 PWA, 66 saved reports, 67 carrier scorecard, 68 broker SLA, 69 capstone, 70 notification
  backbone, 71 digest engine. WEB-2 part 2 (referral page + CC overview + partner card).
- Home page sections redesigned (distinct motifs + desire-driven referral earnings panel).
- Carrier Portal: **A1** dashboard (`cc_carrier_dashboard` + UI with global colour tokens + notification feed),
  **A2** `cc_load_detail` (decision-complete: accessorials/windows/FCFS/stops; broker hidden; carriers see only
  CC-approved board loads) + "Detailed overview" modal, **A3** trip emergency (category+reason+proof) + staff
  review + `cc_emergency_queue`, **A4** fleet service log, **A5** employee payroll.
- 29 new RPCs live in PROD. Migrations cwj–cwv. Matrices all PASS (BI 9, saved-reports 13, scorecard 9, SLA 9,
  notifications 9, digest 10, dashboard 6, load-detail 6, emergency 9, fleet-service 9, payroll 9, e-queue 5).

### DONE THIS SESSION (2026-07-02 session 2) — uncommitted until owner pushes
- HOTFIX 1+2: live carrier login was broken by a truncated/duplicated app.js in 9b1bd56/cae3183 — fixed,
  verified live (login renders). NEW GATE: scripts/check_esm_syntax.sh (node --input-type=module --check)
  — ALWAYS run it; `node --check` cannot catch ESM duplicate-declaration/truncation.
- B2–B4 design overhaul: motifs_module.py (7 motifs + 34 original icons) + 11-page pass + referral hero.
- Footer AI section redesigned (withorb-style provider list, original glyphs).
- cww_referral_payouts (BOTH DBs, matrix 12 PASS, parity): payout requests w/ bank details, staff decide,
  affiliate partner dashboard in carrier portal, CC payout queue, ?ref= capture on referral/application forms.
- cwx_load_ready_rates (BOTH DBs, matrix 3 PASS, parity): partner_loads INSERT trigger — full rate card
  (detention/free-hrs/layover/TONU/lumper) + scheduling REQUIRED; partner wizard collects them as required.
- A6 docs urgency tones, A7 dispatch-desk card, A8 setup-gaps card, sign-out hardened, avatar account menu,
  dispatch-prefs required nudge on Loads tab, cp-field/cp-input CSS added.
- WARNING (tooling): file-tool Edits on LARGE files can truncate/apply late (caused both hotfixes). Edit
  big files via sandbox-side python only, and re-run scripts/check_esm_syntax.sh before any commit.

### REMAINING (the task list / roadmap)
- **Site-wide design overhaul (B2–B4)** — owner's top priority. Build a section-motif library (rail/timeline/
  split/diagram/dark/gradient/compare) with UNIQUE icons; redesign resources/partners/brokers/carriers/pricing/
  how-it-works/compliance pages so no two sections look alike; upgrade referral.html hero to match the home
  earnings panel. All in `build_site.py`; verify with `python3 build_site.py` + `scripts/site_inventory.py`.
- **A6 Documents** — urgency-highlighted needs + submitted status (document checklist + `cc_pocket_compliance`
  exist; needs a depth pass / dedicated status view).
- **A7 Support** — message CC + live chat + dedicated-dispatcher contact. NEEDS AN OWNER DECISION on chat
  transport (existing team-chat vs a provider). Support messaging/issues already exist.
- **A8 Account** — settings/profile largely exist (`cc_pocket_get/save_profile`, comm preferences); depth pass.
- **A2/A3 staff-side UI:** Command Center emergency-review screen (backend `cc_emergency_queue` +
  `cc_emergency_review` ready); broker/CC post-time UI to capture the full accessorial rate card + windows + FCFS.
- **Owner actions (not codeable):** schedule `select cc_digest_run_due();` (pg_cron) to activate digests;
  legal sign-off + flip `referral_program` prod flag; live provider keys for email/SMS workers.

### A7 CHAT: DECIDED — WhatsApp deep-link (owner choice, this session)
Owner must set WHATSAPP_NUMBER in app/carrier/app.js (E.164 digits); the Support-tab chat row stays hidden
until then. Optionally point the marketing wa-btn at the same number.

### OWNER TOOLING DIRECTIVE (2026-07-02): website DESIGN work → use the Claude DESIGN BUILDER (the
"Design" plugin visible in Cowork) instead of hand-writing layout code, whenever design tasks come up.

### D-SERIES (INDUSTRY COMPLIANCE SOP — docs/INDUSTRY-COMPLIANCE-SOP.md is CANON)
D1 tender completeness ✔ · D2 onboarding packets ✔ · D3 master agreements ✔ · D4 rate confirmations ✔
REMAINING: D5 dispatch sheet, D6 pre-booking gate, D7 STOP/REJECT engine, D8 delivery doc pack,
plus the D-SCREENS UI batch (packet/agreement/RC cards in all portals + CC onboarding board).

## 7. TEST FIXTURES (staging `snslhvmkjusozgjelghi`)
- Staff (analytics.view + more): `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1`
- Staff (carriers.view/dispatch.manage/comm.send): `11111111-1111-1111-1111-111111111111`, `44444444-4444-4444-4444-444444444444`
- Carrier USER (member of the carrier org): `11111111-1111-1111-1111-111111111101`
- Carrier ORG: `f2e3d0fa-6631-4999-91b9-73734b53e9ed`  · a trip of it: `c930b496-979f-43ee-9a72-f30c79954335`
- Broker USER: `253abb41-5b01-4b32-8c29-e84e0dfda450`  
### Session 5 (2026-07-06) — Account Health v2 (Amazon-style)
- DB (staging+prod, `migrations/ct-waveBK-health-v2/bk_health_0001_account_health_v2.sql`):
  `cc_account_health` carrier branch → 5 weighted groups (reliability 35 / communication+tracking 20 /
  compliance+docs 20 / conduct 15 / financial 10), per-item value/target/basis/improve,
  small-sample guards (no grading under 3 trips), new-carrier grace tier `building`
  (<5 delivered AND <30 days: performance observed, not deducted), expiring_soon (30d) advisory,
  legacy keys (score/tier/deductions) preserved. Anon surface verified = 5 on BOTH DBs.
- Carrier app.js loadHealth: new "Score breakdown" card (per-group earned/weight bars, item rows
  value vs target, ✓/-N, expiring-soon warning, Building notice); hero copy + tone grace-aware.
- OPEN (Phase 3): CC 360 health card → grouped breakdown; tier-drop notification (needs stored
  last-tier snapshot + compare — design: nightly cron or on-read upsert); Plan-of-Action flow for
  critical reinstatement; per-event Dispute button.

### Session 5 (cont.) — Trip GPS checkpoints Phase A (ct-waveBL)
- DB staging+prod `migrations/ct-waveBL-trip-gps/bl_trip_0001_gps_checkpoints.sql`:
  trips + pickup_mode('appointment'|'fcfs') / pickup+delivery lat-lng / started_at;
  trip_dwell_events + lat/lng/distance_m; app_private.haversine_m();
  NEW cc_trip_arrive_gps(trip,stop,lat,lng,free_min) — geofenced Arrive (800m radius,
  refuses with distance message; stamps GPS proof into dwell event; sets started_at on pickup).
  Old cc_trip_arrive untouched. Anon surface = 5 both DBs.
- OPEN Phase B (InDrive-style): carrier trip map (Leaflet+OSM — CSP needs tile host + cdnjs),
  Start button → O→P live leg → GPS-gated "I am at pickup" (cc_trip_arrive_gps) → P→D leg →
  delivery auto-arrive prompt inside geofence; broker live status already exists (wave5 tracking).
- OPEN Phase C: on-time pickup metric from dwell events (appointment trips only; FCFS excluded
  from on-time scoring per owner decision); geocode pickup/delivery coords at trip creation
  (Photon already CSP-allowed); offer-expiry countdown UI both sides (cc_offers_expire exists).
- Phase B SHIPPED: app/carrier/trip-map.js (InDrive-style overlay: Leaflet 1.9.4 via cdnjs,
  OSM tiles, Photon geocode fallback for stops, GPS watch, O→P then P→D dashed leg,
  step machine start→to_pickup→at_pickup→to_delivery→at_delivery→done, buttons GPS-gated
  800m client-side + server enforced via cc_trip_arrive_gps; sessionStorage step cache).
  api.js + tripArriveGps. app.js: "🗺 Live map" button on active trip cards (lazy import).
- Phase C SHIPPED (both DBs, anon surface 5):
  bl_trip_0002: trip_accessorials + status/evidence/decision cols; trip_evidence_snapshot();
  cc_carrier_request_accessorial (claim + auto evidence + staff notification);
  cc_review_accessorial (approve=amount+billable / reject=reason, notifies carrier);
  cc_trip_accessorials (staff+carrier); cc_trip_set_stop_coords (fill-once, map geocode arms
  server geofence); AUTO-DETENTION trigger (depart past free time → requested claim w/ evidence);
  AUTO-TONU trigger (cancel after commit/arrival → requested claim).
  bl_trip_0003: cc_accessorial_queue (staff); health v2.2 G1 = delivery 15 / pickup 10 / cancels 10,
  on-time grades APPOINTMENT trips only (FCFS excluded), pickup on-time from dwell GPS arrive.
  Frontend: carrier trip card "💰 Pay claims" (file + status list, lbToast); trip-map persists
  geocoded coords; CC Exception Center "Pay claims — awaiting review" queue (evidence summary,
  Approve amount / Reject reason). STILL OPEN: offer countdown UI (no carrier offers UI exists yet);
  broker-side accessorial visibility (flows via invoice/settlement today); in-app chat reply-time metric.
- inDrive premium pass: trip-map.js REWRITTEN (CARTO dark tiles, OSRM real road route + ETA bubble,
  Load-request card w/ 2-min visual accept timer, lime action button). CSP + cartocdn (img) +
  router.project-osrm.org (connect) in build_site.py. My Loads trip card REDESIGNED: hero strip
  (A/B route, rate, live pickup/delivery COUNTDOWN with overdue red, big lime "Open live trip"),
  action chips, rest collapsed under "Documents & tools". STAGING fixtures: test load
  Chichawatni→Islamabad (pickup 30.5308,72.6958) status available (self-book via Load Board);
  carrier-owner profile set active + all pending compliance approved (booking gate passes).
- Load Board split into TABS: "📨 Requests (n)" (direct broker→profile offers via carrierOffers,
  live expiry countdown, brand-orange Accept → book_accepted_offer → My Loads) | "🌐 Available loads"
  (existing board = send request/book). Auto-opens Requests tab when offers exist. Brand-kit colors
  everywhere (orange #FC5305 CTA, blue #0883F7, no lime). Live map top bar: 🧭 Navigate (external
  Google Maps to current leg stop) + 📄 Docs (closes map, reveals Documents & tools on trip card).
  Fixture: fresh offer cefa4ee1 (12h expiry) on load 6bc8a995 Chichawatni→Islamabad.
- trip-map v3 (auto-geofence): "I am on my way" broker check-in; AUTO arrive at 800m
  (tripArriveGps → server flips planned→dispatched), AUTO depart pickup on zone exit
  (+150m hysteresis) → in_transit; auto arrive at delivery; manual buttons = fallback.
  Geofence circles drawn at A/B; stage chip; pulsing truck; follow-mode + recenter;
  external nav row in-map (Google/Waze/geo chooser) inDrive-style. Statuses relabeled
  (FRIENDLY_STATUS): planned="Booked — ready to start", dispatched="At pickup",
  in_transit="On the road". bl_trip_0006 (both DBs): accept/book → planned (times+coords);
  cc_trip_arrive_gps pickup → dispatched; manual Start-status buttons removed from card.
- trip-map v4 "premium pass": split layout (map pane top / sheet in normal flow — inDrive style,
  nothing covers the map; visualViewport-aware); ☀️/🌙 day-night tiles toggle (voyager/dark_all,
  localStorage lb:mapstyle); animated white flow-dashes over route; live stats chips (speed from
  GPS, dist to next stop, scheduled time); heading rotation on truck marker; green flash banner
  + vibration on auto check-in/departure; iOS Apple Maps for "Other apps" (geo: only on Android);
  countdown timers fixed (self-clearing-before-mount bug); leaflet dark bg; booking parses
  pickup_time text into scheduled_pickup (bl_trip_0007, both DBs). COMMIT REMINDER: everything since
  preview/command-center-v1 base is uncommitted — owner to commit from own machine.
- trip-map v5 TURN-BY-TURN: OSRM steps=true → Google-style instruction card (arrow, distance,
  "Turn left onto N-5", "Then:" preview), VOICE guidance (speechSynthesis, 🔊 toggle lb:voice,
  spoken at 450m/90m), auto-reroute when >260m off the blue nav line ("Rerouting"),
  driving-mode auto-zoom by speed (13–16), nav leg rebuilt at pickup/delivery transitions.
  Security (bl_trip_0008 both DBs): arrivals REFUSED when stop coords unpinned; 'delivered'
  requires GPS-verified delivery dwell. Fixture trips reset w/ delivery coords pinned.
  Map default = light voyager (lb:mapstyle), ⛶ Full map labelled pill.
- trip-map v6: SIMULATION MODE 🧪 (dev/LAN hosts only) — synthetic GPS drives the real engine:
  approach → auto pickup check-in (free_minutes=0 in sim so detention fires) → 80s dock pause →
  auto depart → road route → auto delivery check-in; uses handleFix() shared by real watchPosition
  (real GPS ignored while sim.on). Contrast: ETA bubble navy chip both modes; flow dashes navy on
  light / white on dark (recolored on style toggle).
- trip-map v7: satellite tiles (Esri World_Imagery, CSP + arcgisonline; style cycles day→dark→sat),
  Google-style nav banner (navy card, orange 2.3rem arrow, full 2-line text), ETA summary in
  stage chip ("X min · Y km · 11:38 AM"), immersive driving (chrome fades + sheet collapses after
  12s moving; tap map reveals), voice primed on gesture (say 'Navigation started'), screen
  WakeLock, onway resume via localStorage. FCFS: pocket_trips returns pickup_mode (0009),
  card amber FCFS strip (no countdown), map 'FCFS' appt chip; Chichawatni trip = FCFS demo.
  CRITICAL FIX 0010: trip_accessorials.amount NOT NULL was killing auto-detention/TONU/claims
  (insert amount 0). OPEN: true background tracking + sticky notification = native wrapper
  (Capacitor/TWA foreground service) — web cannot track with browser closed.
- Carrier 360 v2: LIVE health engine card (cc_account_health groups + score/tier pill + active
  deductions + "⚠ Warn account" account-level violation) + "💰 Pay claims — this carrier" inline
  approve/reject; heuristic card retitled "Review assistant". MERGES: Carrier Scorecards nav hidden
  (scorecard lives in 360; board = Account health); NOTE: /exceptions route was ALREADY dead
  (duplicate key — exceptionCenter wins) → exceptions.js is unreachable legacy.
  Task #11 half done (CC breakdown ✓; tier-drop notification cron still open).
- Carrier 360 v3 (partial): per-document "⚙ Actions" DRAWER (structured reasons list, reviewer
  hints per doc type, description, consequence radio: warn / reject+re-upload / both);
  Health engine card + "📖 Open health policy" drawer (score ladder 90/70/40 bands with staff
  actions, full metric detail, copyable improvement tips); Safety & authority card + live
  "Verify with FMCSA" button (fills legal name/authority/PU/rating inline); docsCard MERGED
  into Onboarding & compliance (removed from mount). Remainder in Task #14.
- Carrier 360 v3.5: doc "View" = in-drawer PREVIEW (iframe/img via signed URL) + Download/Open buttons
  (bl_perm_0015 storage policy "staff read documents" was the missing SELECT — View permission error);
  cc_verify_payment_profile now (org, ok, note) — reject/revoke requires reason, notifies carrier;
  Safety card button → renderFmcsaOnly() drawer = the SAME 7-tab FMCSA profile as carrier My Profile
  (exported from app/carrier/profile-view.js, shared across portals); claims drawer + trip ref,
  per-trip claim history counts (abuse signal >3), per-kind Recommended-action line, suggested
  amount, approve/reject with note. has_global_permission already honors user_permission_grants;
  dispatcher@lb.test = 71 allow grants (staging). PGRST NOTE: reload schema after ANY fn drop/create.
- bl_docs_0018 (both DBs): cc_set_compliance now NOTIFIES the carrier on decisions —
  rejected: in-app urgent notification (title+reviewer note, url→dashboard Fix-now) + branded
  email from hello@ (red reviewer-note box, "What to do", orange Fix-it-now CTA);
  valid: ✓ approved notification + email (with expiry if set). Sent to up to 3 active org
  members; sys_email idempotency docrev:<org>:<key>:<status>:<epoch>. Reject-flow frontend:
  red Fix-now hero (doc names + reasons) & setup-gap/urgent rows jump straight to wizard
  Documents step (sessionStorage lb:onb:jump); stages compliance_check/changes_requested
  now count as "under review" on dashboard + account.
