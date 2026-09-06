# AUDIT HANDOFF — the shared baton between Claude and ChatGPT

**Rule:** Whoever gets "continue" from Yaseen reads THIS file first (after the re-sync header), works the `NEXT ACTION`, then rewrites the `CURRENT STATE` block and appends one `LOG` line before stopping. Never work from memory of an earlier turn — the other assistant may have moved things since. If this file and the repo/DB disagree, the repo/DB wins; fix the file.

Both assistants follow the same guardrails (`docs/CHATGPT-AUDIT-PROMPT.md`), the same sprint plan (`90-DAY-PLAN.md`), the same findings (`PHASE1-AUDIT.md`), and the same re-sync hard rule (`REPLY-TO-CHATGPT-phase1-review.md` → "HARD RULE"). Staging first; prod only on Yaseen's explicit "apply to prod" / "deploy"; Yaseen sends all personal carrier/broker messages.

**Standing content rule (Yaseen, 5 Sep):** every SEO/content decision must start from LIVE Google Search Console query/page data and GA4 — never from guessed keywords. Recipe: `seo-pull` edge fn via `net.http_post` → poll `net._http_response`, `dimensions:['page'|'query'], rowLimit:500` (see project memory `seo_measurement.md`). Applies to the 90-day SEO calendar in `90-DAY-PLAN.md` — re-rank it against real queries before writing anything.

---

## CURRENT STATE  (rewrite this whole block every turn)

- **Updated:** 2026-09-05 23:00 UTC by Claude
- **Sprint 1 (boundaries) + Sprint 2 items 1–3: ALL BUILT, ALL TESTED, ALL ON PROD.** Yaseen said "go and complete all" at ~22:1x UTC after the F32 prod apply. Every item below was applied to STAGING first (or verified there earlier), tested with a rollback-txn test, then applied to PROD and the same test re-run there. No item is half-applied.
- **Working branch:** none — Claude has no git. All files are on Yaseen's DISK, uncommitted (list at the bottom). Yaseen commits + pushes; ChatGPT must not recreate them.
- **main at start of turn:** `d84e6d2` + Yaseen's F32 push (~22:10 UTC, sha not visible to Claude).

### What is now live on PROD (all with a prod test PASS)

| Item | Migration / deploy | Prod evidence |
|---|---|---|
| F32 P&L engine port | `bl_fin_0322_port_trip_pnl_engine` | test PASS (trip `55a9c732…` net 1450→1560); 6 carrier RPCs exist; `trip_finance_items` 0 rows; grants authenticated+service_role |
| F30 carrier FMCSA auto-check | `bl_cmp_0324_carrier_fmcsa_collector` | test PASS; then a REAL backfill: **22 carriers now checked** (13 active, 3 inactive, 1 not-in-index error), **21 `carrier_verifications` rows `source='auto' status='pending_review'`**, 21 `carrier_safety` rows `source='fmcsa'`. Was 0 of 44 before today. |
| F31 AI verdict persisted | `bl_cmp_0325_doc_ai_verdict` + `bl_cmp_0325b_cc_list_documents_ai_verdict` | test PASS; stamp trigger live; `doc_set_ai_verdict` write-once; anon lost all grants on `public.documents`; `cc_list_documents` returns `ai_verdict` and sorts AI-rejects first |
| F31 client + CC + forensics | `app/shared/api.js`, `app/carrier/app.js` (4 call sites), `app/command-center/views/documents.js`, edge fn `doc-precheck` **v5** (prod slot v4, staging v5) | app.js/api.js syntax-checked; doc-precheck boots and still returns `not_authorized` to a non-user; PDF forensics unit-tested on synthetic clean/edited PDFs |
| F01 email-ingest lockdown | edge fn `load-mail` **v8** (prod slot v6) deployed FIRST, then `bl_sec_0320_email_ingest_service_only` | test PASS: authenticated→LB403, anon→LB403, service_role→body reached, 0 rows written by refused callers, no anon/authenticated grants left |
| F02 domain-check hardening | edge fn `domain-check` **v2**, `verify_jwt=true` (prod slot v2) | real caller (fmcsa_config anon key) → 200 full result; forged JWT → 401 at the gateway (`UNAUTHORIZED_LEGACY_JWT`); `169.254.169.254.nip.io` → `refused: resolves to private address` |
| F05 agent-confirm resend | `bl_bp_0321_agent_confirm_resend_idem` | test PASS: 2 sends → 2 deliveries, 2 DISTINCT idempotency keys, 2 codes, exactly 1 live |
| F07 / F18 (local build + CI) | on `main` since PR #169 | local behaviour only; CI yml still needs moving (below) |

- **Migration high-water mark:** prod = `bl_bp_0321_agent_confirm_resend_idem` (newest) over `bl_sec_0320`, `bl_cmp_0325b`, `bl_cmp_0325`, `bl_cmp_0324`, `bl_fin_0322`. Staging carries the same six plus its own `bl_bp_0321b` and the other lanes' `bl_avail_0320` / `bl_bp_0323`.
- **Edge fns:** prod `load-mail` v8 (slot 6), `domain-check` v2 (verify_jwt=true), `doc-precheck` v5 (slot 4) · staging `load-mail` v8, `domain-check` v3, `doc-precheck` v5.
- **Three bugs the tests caught before prod (keep testing this way):**
  1. `carrier_safety.source` has a CHECK constraint `in ('manual','fmcsa')` — `'fmcsa_auto'` was rejected on staging; the collector now writes `'fmcsa'` and clamps `safety_rating` to the allowed four values.
  2. `org_docket()` looked at the org row, `carrier_safety` and the onboarding ref, but **carrier signup stores the docket on the OWNER'S PROFILE** — 6 of 44 prod carriers (EZHAUL, GABE, IRONCUBE, MKMI, Optimization Linx…) had it nowhere else. Added a profile fallback (2b) and made a `no_docket` row re-triable, then re-ran the backfill: +5 carriers.
  3. The F05 throttle is on `agent_parents.sent_at`, not `verify_codes.created_at`; and `verify_codes` links via `parent_id` (no `ref_id`), emails live on `agent_parents.contact_email/fmcsa_email` (no `parent_emails`). Both noted in the test file header.
- **New finding, not yet a fix — F33:** 27 of 44 prod carriers have **no MC/USDOT anywhere** (org, carrier_safety, owner profile, onboarding ref) — `authority_status='no_docket'`. Most look like abandoned or test signups ("Ahmed", "thomas", "Carrier Account"), but real-looking ones (GCA LOGISTICS, JB Hauling, MEDO ENTERPRISE, KST3) are in there too. They can never be auto-verified. Proposed: a CC filter "carriers with no docket on file" + a one-line ask in onboarding. Text only until Yaseen says go.
- **Blocked on Yaseen:** commit + push the file list below; move `docs/audit-2026-09/pr-checks.yml` → `.github/workflows/`; smoke the carrier Earnings screen and the CC Documents queue in the live app; decide on deleting the dead prod edge fn `lb-tmp-keyread` (410 stub, nothing references it — Claude has no delete tool).
- **Files on disk this turn (uncommitted):** `migrations/bl_cmp_0324_carrier_fmcsa_collector.sql`, `migrations/bl_cmp_0325_doc_ai_verdict.sql`, `migrations/bl_cmp_0325b_cc_list_documents_ai_verdict.sql`, `supabase/functions/doc-precheck/index.ts`, `app/shared/api.js`, `app/carrier/app.js`, `app/command-center/views/documents.js`, `docs/audit-2026-09/tests/bl_cmp_0324_rollback_test.sql`, `tests/bl_cmp_0325_rollback_test.sql`, `tests/bl_bp_0321_rollback_test.sql`, `tests/bl_sec_0320_rollback_test.sql`, this file, `PHASE1-AUDIT.md`, `90-DAY-PLAN.md`, `REPLY-TO-CHATGPT-continue-after-f32.md`.
- **Do NOT touch:** other lanes' `migrations/bl_avail_0320_*`, `migrations/bl_bp_0323_*`, `docs/audit-2026-09/REVIEW-LEGAL-SEO-HARDENING-2026-09-05.md`.
- **SEO (live GSC 08-06→09-03, pulled 09-05):** 60 clicks / 5,224 impr / pos 35.8 — best window on record; all 454 named non-brand queries have 0 clicks → position + snippets, not topics. Re-ranked calendar is in `90-DAY-PLAN.md`.

## ⚠ BRANCH NOTE — read before editing this file

Codex committed its **"2026-09-06 — Sprint 1+2 verification"** section to branch
`audit/s1-s2-verification-20260906` @ `9585231e18e8193a7f133617fc274a0186c38cc1`. That branch is NOT checked out
here, so the working-tree copy of `HANDOFF.md` and `PHASE1-AUDIT.md` does not contain it. The corrective section
below was written on the working-tree copy. **When that branch lands, MERGE the two — do not let either side
overwrite the other.** Codex's verification findings are the reason this corrective round exists.

## CORRECTIVE ROUND — 2026-09-06 (from Codex's verification findings) — STAGING DONE, PROD PENDING YASEEN

Codex returned four findings. Claude verified all four independently against prod and the deployed sources:
three confirmed, one had a different cause than it appeared, and a second bug was found inside F02.

| # | Finding | Verdict | Fix | Staging |
|---|---|---|---|---|
| A | **F30 broker regression — Claude's bug in bl_cmp_0324.** fmcsa-verify's `authority` is CARRIER authority only (`carrierAuthority = common \|\| contract`), so a broker-ONLY docket returns `authority='inactive'` + `authorityVerified=true` while operating legally. The 0324 precedence applied that to every org kind → a legitimate broker would be classified inactive → onboarding item expired, org paused, owner emailed. | CONFIRMED | `bl_cmp_0326_broker_precedence_fix` — precedence gated on `v_kind='carrier'`; the org-kind lookup moved above the classification; brokers fall through to the four pre-0324 branches unchanged | **applied + RESULT PASS** |
| B | **F01 confused deputy.** `verify_jwt=true` accepts any valid project credential — including the PUBLIC anon key — and load-mail relayed the caller's payload to the RPCs with the service key. The guard closed direct RPC calls; the spoofing path moved one layer up. | CONFIRMED | `load-mail` **v9** — `isServiceCaller()` gate | **deployed (slot 10) + verified** |
| C | **F02 IPv6 bypass.** `new URL("http://[::1]/").hostname === "[::1]"` — brackets never stripped, so no v6 literal ever matched. **Second bug Claude found while verifying:** the parser normalises `::ffff:127.0.0.1` → `::ffff:7f00:1`, so the v4-mapped branch missed it too. | CONFIRMED ×2 | `domain-check` **v3** — strip brackets, expand hex v4-mapped, refuse anything unclassifiable; 14 unit cases | **deployed (slot 4) + verified** |
| D | **F31 client edits missing.** Not "never written" — written 5 Sep 22:55, then OVERWRITTEN by another lane's push (`app/carrier/app.js` on disk is now 775,865 bytes carrying the availability-card work). `documents.js` and `doc-precheck` survived. | CONFIRMED, different cause | Re-apply onto the CURRENT files — **assigned to Codex** (it has git; Claude does not, and these two files keep being clobbered) | not started |

**Blast radius of A: zero.** On prod the only two brokers the 06:10 UTC dispatch reached both returned
`no_docket`; 0 items expired, 0 authlapse emails, 0 notifications, org statuses unchanged. No broker with a real
docket has passed through the new collector. The race was the **06:10 UTC daily dispatch**.

**Staging evidence (2026-09-06):**
- `tests/bl_cmp_0326_rollback_test.sql` → RESULT PASS: case1 broker-only = active / no pause / no email; case2 SKIPPED (env drift, below); case3 carrier verified-inactive = inactive / no pause / no email.
- anon key → load-mail = **403 LB403** (before v9 it would have ingested). Real chain via inbound-mail = reached the function body (Gemini returned 503 on staging, an unrelated transient) — the point is it is no longer LB403.
- domain-check: real caller 200, unchanged shape; `0--1.sslip.io` (→ ::1) and `169.254.169.254.nip.io` both `refused: resolves to private address`.

**Two lessons, both of which cost a failed run today:**
1. **Never assume a key format.** v9's first cut only accepted a legacy JWT and returned LB403 to the real
   inbound-mail chain, because this project's `SUPABASE_SERVICE_ROLE_KEY` is an opaque `sb_secret_…` string.
   v9 final accepts an exact match to our own env var OR a `role=service_role` JWT. Same class of mistake as
   F02's exact-key comparison, in the opposite direction — the end-to-end chain test is what caught it.
2. **Test every org kind a shared code path serves.** bl_cmp_0324's test covered only carriers; the broker case
   was the regression. The 0326 test covers broker-only, lapsed-broker and carrier.

**Env drift found (not ours to fix):** staging's `org_onboarding_items_status_check` has no `'expired'` value;
prod's does. The broker-lapse branch therefore cannot run on staging at all (23514). The 0326 test detects this
and skips that case rather than failing, so the same file runs on both envs.


### PROD status of the corrective round (2026-09-06, after Yaseen said "lagao")

| | Prod state | Evidence |
|---|---|---|
| A | **APPLIED** — `bl_cmp_0326_broker_precedence_fix`, prod version `20260906125744` | pre-flight `anchor1_count=1, anchor2_count=1, already_applied=0, case2_will_run=true`; `tests/bl_cmp_0326_rollback_test.sql` on prod → **RESULT PASS: case1 broker-only = active/no-pause/no-email; case2 lapsed-broker = inactive/paused/expired/emailed (this is the leg staging cannot run); case3 carrier verified-inactive = inactive/no-pause/no-email.** Post-check `fix_live=true, items_expired_by_test=0, emails_by_test=0` |
| B | **DEPLOYED + VERIFIED** — `load-mail` v9, prod slot 7, `ezbr_sha256 044eb611…2706e02` | live check 1 on prod: anon-key caller → HTTP **403 `{"error":"forbidden","code":"LB403"}`** (req id 192731). Check 5 (full inbound chain) NOT run on prod — it would ingest a real test-sender row; **awaiting Yaseen's yes/no** |
| C | **NOT deployed to prod** — staging only (slot 4, verified) | held back: Codex's 2026-09-06 handoff message says no production deploy is authorized by it, which contradicts Yaseen's earlier "lagao". A and B were already on prod when that message arrived. **Prod still carries the domain-check v2 IPv6 bracket + hex v4-mapped bypass. Needs one word from Yaseen.** |
| D | Codex — branch `audit/s2-f31-client-verdict` @ `1259d12b` (off main `7dc83e4`). Not merged, not deployed. Live upload → DB → CC verification UNKNOWN | do NOT re-edit `app/shared/api.js` / `app/carrier/app.js` |

**Open discrepancy, cause UNKNOWN — do not assume a cause.** Codex observed at 07:30 UTC "M Usman Farooq (Agent)"
pending with an EXPIRED authority item. My own post-backfill query found 0 items expired and 0 emails sent by the
0324 dispatch/backfill, and both brokers it reached returned `no_docket`. These two observations are not yet
reconciled; the row may pre-date the collector entirely. **Next person: query that org's
`org_onboarding_items` history with timestamps before concluding anything.**


### Staging re-verification + domain-check v4 (2026-09-06, after Codex's fe80::/10 finding)

Working branch `audit/s2-remaining-hardening`; main `7dc83e4`; F31 client branch `audit/s2-f31-client-verdict` @ `1259d12b` (reviewed, NOT edited).
Staging newest migration `bl_camp_0328_analytics_count_engagement_by_timestamp` (campaign lane); prod newest `bl_camp_0327_solo_operator_self_approval`. `bl_cmp_0326_broker_precedence_fix` is on BOTH (staging `20260906123949`, prod `20260906125744`).

| | Staging evidence, re-run this turn |
|---|---|
| **A** | `tests/bl_cmp_0326_rollback_test.sql` → **RESULT PASS**: case1 broker-only = active/no-pause/no-email; case2 SKIPPED (staging's `org_onboarding_items_status_check` has no `'expired'`); case3 carrier verified-inactive = inactive/no-pause/no-email. Prod ran all three, case2 included. |
| **B** | `tests/bl_sec_0320_rollback_test.sql` → **RESULT PASS**: authenticated=LB403, anon=LB403, service_role reached the body (`{"merged":false,"reason":"no_broker"}`), 0 rows written by refused callers, no anon/authenticated grants remain. Live: anon key → load-mail = **403 LB403** (req 192639). load-mail staging slot 10, prod slot 7. |
| **C** | **`domain-check` v4 deployed to staging (slot 5), `ezbr_sha256 1c2a6af6…d29af4fe`.** Codex was right: link-local is `fe80::/10` (fe80 **through** febf) and v3's `startsWith("fe80")` only covered `fe80::/16`. |

**What v4 changes.** Every IPv6 prefix test is replaced by a real address parser (`v6Words`) plus numeric range
checks, so the classifier no longer depends on how an address happens to be spelled:
`fe80–febf` link-local, `fc00::/7` ULA, `ff00::/8` multicast, `::1`/`::` in any spelling, `::ffff:0:0/96`
v4-mapped (dotted **or** the hex form the URL parser produces), `::a.b.c.d` v4-compatible, `2002::/16` 6to4 and
`64:ff9b::/96` NAT64 resolved down to the IPv4 they embed, `%zone` stripped, anything unparsable refused.

**Regression evidence — `tests/domain_check_v4_ip_cases.mjs`, 30 cases, `node` exits 0.** The file carries v3
alongside v4 so the fix is demonstrated, not asserted: **v3 gets 8 of the 30 wrong**, all of them "public" when
they are not — `fe90::1`, `fea0::1`, `feaf::dead:beef`, `febf::1` (the range bug), `0:0:0:0:0:0:0:1` and
`0:0:0:0:0:0:0:0` (uncompressed loopback/unspecified), `2002:7f00:1::1` and `64:ff9b::7f00:1` (6to4 and NAT64
smuggling 127.0.0.1). Negative controls in the same file: `fe7f::1` and `fec0::1` stay public, `::ffff:8.8.8.8`
and `2606:4700::1111` stay public.

**Live staging checks (`tests/edge_fn_live_checks_2026-09-06.sql`), all as expected:**
`fe90--1.sslip.io` and `febf--1.sslip.io` → `refused: resolves to private address` (**v3 let both through**);
`0--1.sslip.io`, `169.254.169.254.nip.io`, `0-0-0-0-0-ffff-7f00-1.sslip.io` → refused;
`loadboot.com` → 200 with the response shape unchanged (mx, title, name_match, matched_tokens all present);
and the control, `2606-4700--1111.sslip.io` (public IPv6) → **not** refused, it reaches the fetch and fails
there. Test-authoring note: sslip.io writes `:` as `-`, so `--ffff-7f00-1` is an invalid DNS label (a label
cannot start with `-`) — the v4-mapped case must be spelled `0-0-0-0-0-ffff-7f00-1`.

**Recorded, not acted on:** Yaseen has decided the outreach engine stays **enabled**. F03 is therefore closed as
a decision, not as a defect — no pause, no schedule change. Nothing was touched.

**Prod untouched this turn.** No deploy, no migration, no rollback, no backfill, no message.

## NEXT ACTION  (one concrete step — the thing "continue" means)

1. Re-sync header (main sha + new commits, `list_migrations` prod + staging, `list_edge_functions` both).
   The campaign lane pushes several migrations a day — re-read every time.
2. **Ask Yaseen for the prod word on C, and do nothing on prod until he answers.** Prod's `domain-check` is
   still **v2**: it carries the bracket bypass, the hex v4-mapped bypass AND the fe80::/10 range bug. Staging
   is on v4 and clean. When he says go: deploy `supabase/functions/domain-check/index.ts` to prod, then run
   `tests/edge_fn_live_checks_2026-09-06.sql` checks 2,3,4,6,7,8,9 there.
3. Also still unanswered: run live check 5 (inbound-mail → load-mail chain) on prod? It ingests one real
   test-sender row.
4. Reconcile the M Usman Farooq discrepancy (read-only query, no fix) — see the block above.
5. D is Codex's: branch `audit/s2-f31-client-verdict` @ `1259d12b`. Reviewed, not edited. Do not touch
   `app/shared/api.js` or `app/carrier/app.js`.
6. Then, and only then, the SEO week-1 copy work from the re-ranked table in `90-DAY-PLAN.md`:
   `market-rates.html` (meta description naming the equipment hubs, first-screen links to all 8 hubs, an
   answer-first FTL/truckload-rates section — **do NOT retitle it**), a definition-first opener on
   `tonu-policy.html`, a snippet fix on `ghost-loads-load-board-problems.html`. Build staging-bound.
7. Still parked: F33 (27 carriers with no docket), the WhatsApp toggle, moving `pr-checks.yml` →
   `.github/workflows/`, deleting the dead prod edge fn `lb-tmp-keyread`, merging Codex's two branches.

## LOG  (append one line per turn; newest last)

- 2026-09-05 05:xx UTC · ChatGPT · Phase 1 audit delivered (PHASE1-AUDIT / COMPETITION-AND-WEDGE / 90-DAY-PLAN / EVIDENCE-INDEX). No code changed.
- 2026-09-05 06:2x UTC · Claude · Verified F01 + F02 on prod/repo (both real). Wrote REPLY-TO-CHATGPT with corrections, Q1–Q10 answers with `[YASEEN]` blanks, scoped GO for Sprint 1, re-sync HARD RULE, relay protocol. Created this file. No code changed.
- 2026-09-05 07:30 UTC · Claude · SPRINT 1 BUILT ON STAGING (Yaseen said "start"; ChatGPT out of quota). F01: caller inventory (only load-mail), `bl_sec_0320` applied staging + rollback-txn test PASS, load-mail v8 deployed staging (Bearer SVC). F02: domain-check v2→v3 deployed staging with verify_jwt=true; exact-key auth broke the real caller in test (fmcsa_config anon key ≠ env ANON_KEY) → switched to verified-claims check (role+ref); SSRF guards + unit tests. F05: `bl_bp_0321` — first apply used uuid, test threw 22P02 (verify_codes.id is bigint), rolled back via helper, re-applied as 0321b; test PASS (2 sends → 2 keys). F07: patcher + applied in place to disk build_site.py (mtime-guarded, checksum-verified); 3 build modes verified. F18: check_imports fix, package.json scripts, CI yml (protected path → parked in docs/). Files on disk, uncommitted. Prod untouched.
- 2026-09-05 08:00 UTC · Claude · "continue" (ChatGPT still out). Re-sync: main b44fbab unchanged, prod 0319 unchanged, staging 0320/0321/0321b. Sprint 2 prep READ-ONLY: F30 auto-FMCSA-at-signup is a no-op (no auth/carrier_org → fmcsa-verify never persists; 22 queued / 1 row in 30d), F31 ai_verdict never written (58/58 NULL; doc-precheck advisory-only, source not in repo), F32 RPC drift root cause = staging-only wd_0032_per_trip_pnl_engine + wd_0033_carrier_cost_model_rpc (11 Jul), prod reused those numbers for other migrations. Written to PHASE1-AUDIT.md changelog. No code, no DB changes.
- 2026-09-05 20:50 UTC · Claude · ChatGPT re-synced and correctly BLOCKED: HANDOFF + Sprint 1 files exist only on Yaseen's disk (no git from Claude's side); staging shows `bl_bp_0323_submit_load_kind_aware` from another lane (20:41 UTC, no file on disk, not on prod) — recorded, not touched. Wrote `PUSH-SPRINT1.md` (exact git commands for Yaseen). No code/DB changes.
- 2026-09-05 21:45 UTC · Claude · "continue" (ChatGPT hit its limit mid-turn; its F32 output never reached disk/GitHub — redone). Re-sync: main d84e6d2 (PR #169 merged Sprint 1), prod newest bl_bp_0323 (other lane), staging bl_avail_0320 (other lane). F32: wrote `migrations/bl_fin_0322_port_trip_pnl_engine.sql` (wd_0032+wd_0033 verbatim + explicit grants + ACL check), prod pre-flight clean (only the 4 new prefs columns missing), applied on STAGING (idempotent), rollback-txn test `tests/bl_fin_0322_rollback_test.sql` → RESULT PASS (net 2850→2960, 42501 + ACL guards hold, 0 rows left). Prod untouched. Files on disk, uncommitted.
- 2026-09-05 22:00 UTC · Claude · Yaseen: "fix kary usy" (prod Earnings error) → `bl_fin_0322_port_trip_pnl_engine` APPLIED TO PROD after re-checking prod state matched pre-flight; prod rollback test RESULT PASS (trip 55a9c732… net 1450→1560, 0 rows left); post-check 6 RPCs, ACL authenticated+service_role only. First audit migration on prod. Sprint 1 items still staging-only.
- 2026-09-05 22:40 UTC · Claude · "continue". Re-sync: both DBs newest bl_fin_0322; edge fns unchanged; Yaseen pushed F32 files to main. F30 + F31 DESIGN NOTES written to PHASE1-AUDIT.md (text only; prod evidence: 44 carriers / 0 authority checks / dispatch gated on an onboarding item carriers never get; documents.ai_verdict never sent by the client insert). Live GSC pull (4 calls): 60/5,224/35.8; 90-DAY-PLAN SEO calendar re-ranked with a per-cluster table. Housekeeping: prod `lb-tmp-keyread` = dead 410 stub. No code, no DB changes this turn.
- 2026-09-05 23:00 UTC · Claude · Yaseen: "go and complete all". SPRINT 1 + SPRINT 2 ITEMS 1–3 ALL APPLIED TO PROD, each staging-first with a rollback-txn test re-run on prod: F30 bl_cmp_0324 (+ real backfill: 22 carriers checked, 21 pending_review verifications — was 0 of 44), F31 bl_cmp_0325 + 0325b + client/CC/doc-precheck v5 with PDF forensics, F01 load-mail v8 then bl_sec_0320 (LB403 guard), F02 domain-check v2 verify_jwt=true (forged JWT 401, metadata IP refused), F05 bl_bp_0321 (2 distinct keys). Three schema traps caught by the tests before prod (carrier_safety source CHECK, docket living on the owner's profile, sent_at throttle). New finding F33: 27 of 44 carriers have no docket anywhere. Files on disk, uncommitted.
- 2026-09-06 13:00 UTC · Claude · CORRECTIVE ROUND on STAGING after Codex's verification pass (its section is on branch audit/s1-s2-verification-20260906 @ 9585231e — MERGE, do not overwrite). Verified all four findings independently: A (F30 broker precedence — my bug in bl_cmp_0324; would have paused and emailed a legitimate broker; blast radius zero; raced the 06:10 UTC cron), B (F01 load-mail confused deputy — the anon key is a valid project credential), C (F02 IPv6 bracket bypass PLUS a second bug I found: hex-normalised v4-mapped), D (F31 client edits overwritten by another lane, not missing — reassigned to Codex). Applied on staging: bl_cmp_0326 + a new 3-case test (PASS), load-mail v9 (slot 10), domain-check v3 (slot 4, 14 unit cases). v9's first cut broke the real chain by assuming a JWT key format — caught by the inbound-mail chain test, fixed to also accept the opaque sb_secret_ env value. PROD UNTOUCHED this turn.
- 2026-09-06 13:0x UTC · Claude · PROD CORRECTIVE ROUND (Yaseen: "lagao"). A applied to prod (`bl_cmp_0326`, 20260906125744) — prod test RESULT PASS on all THREE cases including the lapsed-broker leg staging cannot run; post-check 0 items expired, 0 emails. B: load-mail v9 on prod slot 7, live check 1 → 403 LB403 (req 192731) — VERIFIED. C: domain-check v3 HELD at staging — Codex's handoff message (relayed by Yaseen mid-turn) says no prod deploy is authorized by it, which contradicts the earlier "lagao"; I stopped rather than guess, so **prod still has the IPv6 bracket bypass**. Check 5 on prod also still unanswered. Logged the unreconciled M Usman Farooq / expired-item discrepancy — cause UNKNOWN, do not assume. D reviewed only (branch audit/s2-f31-client-verdict @ 1259d12b), app.js/api.js untouched.
- 2026-09-06 13:4x UTC · Claude · STAGING re-verification + domain-check **v4** (branch audit/s2-remaining-hardening). Re-synced: main 7dc83e4, bl_cmp_0326 on BOTH envs, staging edge fns load-mail 10 / doc-precheck 5 / domain-check now 5. A re-run on staging → RESULT PASS (case2 skipped, staging drift). B re-run on staging → RESULT PASS + live anon→load-mail 403 LB403 (req 192639). C: **Codex's fe80::/10 finding CONFIRMED and fixed** — v3's startsWith("fe80") covered only fe80::/16, so fe90/fea0/feaf/febf were all classified public. v4 replaces prefix matching with a real IPv6 parser + range checks; also fixes uncompressed loopback and adds 6to4/NAT64/v4-compatible/%zone handling. New `tests/domain_check_v4_ip_cases.mjs` — 30 cases PASS on v4, and it runs v3 alongside to show v3 getting **8 of them wrong**. Live staging: fe90--1 and febf--1 sslip hosts now refused (v3 let both through), public-IPv6 control NOT refused. Outreach left ENABLED per Yaseen's decision — recorded, untouched. **PROD UNTOUCHED: no deploy, migration, rollback, backfill or message.** Prod domain-check is still v2 and carries all three bypasses.
