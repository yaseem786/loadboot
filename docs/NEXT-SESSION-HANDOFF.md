# LoadBoot — NEXT-SESSION HANDOFF (read this FIRST)
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
- Broker USER: `253abb41-5b01-4b32-8c29-e84e0dfda450`  · Broker ORG: `cc000000-0000-0000-0000-000000000002`
- A non-staff/non-carrier uuid for denial tests: `00000000-0000-0000-0000-000000000009`
- (Verify these still exist at session start; they were valid on 2026-07-02.)

## 8. HONEST PENDING GATE
The foundation gate stays **PASS 10 / BLOCKED 2 of 12** — the two blocked items are owner-executed browser-evidence
proofs (see `docs/gate/PENDING-OWNER-EVIDENCE.md`). Not a code blocker.
