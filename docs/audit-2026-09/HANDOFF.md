# AUDIT HANDOFF — the shared baton between Claude and ChatGPT

**Rule:** Whoever gets "continue" from Yaseen reads THIS file first (after the re-sync header), works the `NEXT ACTION`, then rewrites the `CURRENT STATE` block and appends one `LOG` line before stopping. Never work from memory of an earlier turn — the other assistant may have moved things since. If this file and the repo/DB disagree, the repo/DB wins; fix the file.

Both assistants follow the same guardrails (`docs/CHATGPT-AUDIT-PROMPT.md`), the same sprint plan (`90-DAY-PLAN.md`), the same findings (`PHASE1-AUDIT.md`), and the same re-sync hard rule (`REPLY-TO-CHATGPT-phase1-review.md` → "HARD RULE"). Staging first; prod only on Yaseen's explicit "apply to prod" / "deploy"; Yaseen sends all personal carrier/broker messages.

**Standing content rule (Yaseen, 5 Sep):** every SEO/content decision must start from LIVE Google Search Console query/page data and GA4 — never from guessed keywords. Recipe: `seo-pull` edge fn via `net.http_post` → poll `net._http_response`, `dimensions:['page'|'query'], rowLimit:500` (see project memory `seo_measurement.md`). Applies to the 90-day SEO calendar in `90-DAY-PLAN.md` — re-rank it against real queries before writing anything.

---




## CURRENT STATE — 2026-09-07 07:00 UTC (rewritten this turn)

**Yaseen said "tyar sab karo" — all three prod deploys are DONE.** Nothing was revoked and nothing was switched
to enforce. Prod is in the state where the old doors still work and the new signed doors also work.

### PROD, after this turn

| what | prod state | evidence |
|---|---|---|
| `domain-check` | **v5 deployed**, slot 3, `ezbr_sha256 9a2e429dd11263e323b79bdabe270205150ed5c691ab5089caa9531abdc3de67` | live checks below |
| `retell-hook` | **v2 deployed**, slot 1, `1b0fbaa94a68d4f1922216e3bef1ee0f41832d75018f3414b2f487b8928fd0dd`, `verify_jwt=false` | signed end-to-end chain below |
| `bl_sec_0329` / `0329b` / `0329c` | **applied**. `allow_unsigned_webhook = TRUE` (observe) — the live Retell chain is untouched | test below |
| `retell-inbound-hook` | **v1 deployed**, slot 1, `c45b322eff1cfa1cc3d5b89c4a4275d1ad86a889d05585fc72affe1f4468e160`, `verify_jwt=false` | live checks below |
| `bl_sec_0330` | **applied**. `retell_inbound_verified` grants: `postgres:EXECUTE, service_role:EXECUTE` | md5 equivalence below |
| `public.retell_inbound` | **UNCHANGED**, grants still `postgres, anon, authenticated, service_role` | deliberate — the Retell inbound webhook may still point at it |
| `public.retell_webhook` | guarded, but the guard is inert while the flag is TRUE | |

**`bl_sec_0330` on prod was built from prod's OWN live definition**, not from a pasted copy. Verification:
prod's `pg_get_functiondef(retell_inbound)` + the guard inserted after the single `begin
` + the rename hashes
to **`43b69a2488ac4a99661bd74ad82f46f9`**, and `pg_get_functiondef(retell_inbound_verified)` hashes to the same.
**byte_identical = true.** Every branch, string and precedence rule is prod's own.

### Prod evidence, all run this turn

**domain-check v5** — real caller `loadboot.com` → 200, response shape unchanged (req 195107).
`0--1.sslip.io`, `169.254.169.254.nip.io`, `fe90--1.sslip.io`, `febf--1.sslip.io` and
`0-0-0-0-0-ffff-7f00-1.sslip.io` all → `refused: resolves to private address` (195108–195112).
Control `2606-4700--1111.sslip.io` (public IPv6) → **not refused**; it reached the network and failed on a TLS
handshake (195113). All three former bypasses are closed on prod.

**bl_sec_0329 + 0329b, one rollback-txn block → RESULT PASS on four counts:** flag TRUE → anon still works and
still writes (proves the apply is a no-op for the live chain); flag FALSE → anon **and** authenticated both
LB403 with **0 rows written**; flag FALSE → service_role still reaches the body; and the verifier, using the
**real prod api_key** — a correctly signed body verifies, a forged digest and a one-space-altered body are
rejected, `anon` gets LB403.

**retell-hook v2 end-to-end on prod, signed, with zero writes:** a correctly signed `call_started` whose
from/to numbers deliberately do not match `retell_config.from_number` →
`{"ok":true,"verified":true,"enforce":false,"reason":"signature_ok","forwarded":true,"upstream":{"ok":true,"ignored":true}}`
(req 195128). The whole chain — verify, forward as service_role, upstream answer — works on prod **before**
Yaseen repoints anything.

**bl_sec_0330 rollback test on prod → RESULT PASS, 4 cases:** anon / authenticated / empty-claims all refused
with the empty `{"call_inbound":{}}` envelope; the four cheap branches match; the form branch returns the
caller's own words; the broker branch keeps precedence over the form.

**retell-inbound-hook live on prod:** q1 valid signature → **200** with the full envelope (195120); q2 forged
digest → **401** `digest_mismatch` (195121); q3 missing header → **401** `signature_header_unparsable` (195122);
q4 stale by 66 minutes → **401** `timestamp_outside_skew` (195123); q5 valid signature over a different body →
**401** `digest_mismatch` (195124). Every refusal returns the EMPTY envelope.

**Prod left clean:** `lc_calls` = **112**, unchanged; **0** `bl0329-*` or `prodchain*` rows; flag still TRUE
(observe); `retell_hook_log` holds 6 verdict rows and **no phone numbers, no bodies, no context**.

### What is still OFF, and why

- `allow_unsigned_webhook` is **TRUE**. The old anon door to `retell_webhook` still works. That is intentional:
  Retell is still posting there.
- `public.retell_inbound` still has its `anon` / `authenticated` grants. Also intentional, same reason.
- Neither can be closed until Yaseen repoints the two webhooks in the Retell dashboard and a real signed
  delivery is seen verifying in `app_private.retell_hook_log`.

### Still not covered anywhere
The `body_not_json` → 400 branch of `retell-inbound-hook`: `pg_net` can only post a jsonb body, so a non-JSON
raw body cannot be produced from Postgres. Code inspection only — **UNKNOWN**.


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
2. **Waiting on Yaseen, in the Retell dashboard — this is the only thing blocking the two switches:**
   a. point the **call / webhook** URL at `https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/retell-hook`
   b. point the **phone number's inbound-call webhook** at
      `https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/retell-inbound-hook`
   Then watch: `select at, verified, reason, forwarded, event from app_private.retell_hook_log order by at desc limit 20;`
   Real deliveries should appear with `verified=true, reason='signature_ok'`.
3. **Only after real signed deliveries are seen** — and as two separate, reversible steps:
   a. `update app_private.retell_config set allow_unsigned_webhook = false;`  (closes the old webhook door)
   b. propose revoking `anon`/`authenticated` on `public.retell_inbound`      (closes the identity oracle)
   Rollbacks: `select app_private.bl_sec_0329_rollback();` and `select app_private.bl_sec_0330_rollback();`
4. Still unanswered from earlier: live check 5 (inbound-mail → load-mail chain) on prod — it ingests one real
   test-sender row.
5. Exercise the `body_not_json` → 400 branch of `retell-inbound-hook` with a client that can post arbitrary
   bytes. Code-inspection only today.
6. F08/F09/F18 are Codex's (branch `audit/remaining-gaps-20260906`); D is on `audit/s2-f31-client-verdict`.
7. Then the SEO week-1 copy work from `90-DAY-PLAN.md`: `market-rates.html` (meta description naming the
   equipment hubs, first-screen links to all 8 hubs, an answer-first FTL/truckload-rates section — **do NOT
   retitle it**), a definition-first opener on `tonu-policy.html`, a snippet fix on
   `ghost-loads-load-board-problems.html`. Build staging-bound.
8. Parked: F33, WhatsApp toggle, F10 (needs the role/document matrix), deleting `lb-tmp-keyread`, merging
   Codex's branches. Outreach stays ENABLED. The rest of F14: grep for the same shape — an unnamed
   single-parameter SECURITY DEFINER function reachable through PostgREST with the anon key.

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
- 2026-09-06 20:4x UTC · Claude · **F14 confirmed independently and fixed on staging.** Re-synced: main e2f0c75, prod newest bl_camp_0328, staging now bl_sec_0329c. Confirmed the anon-callable retell_webhook a SECOND way — plain HTTP POST with only the PUBLIC anon key returned 200 (req 193585). Established why a blind REVOKE is not available (that grant IS the live Retell chain: 112 prod lc_calls, 8 voice-call leads) and why Postgres cannot verify the signature (Retell signs the RAW body; PostgREST hands the RPC parsed jsonb). No secret invented — the signer is the existing retell_config.api_key and it never leaves the DB. Built on STAGING: bl_sec_0329 (allow_unsigned_webhook flag defaulting TRUE = no behaviour change + LB403 guard + rollback helper), bl_sec_0329b (retell_hook_verify, service_role only, 15-min replay window), bl_sec_0329c (verdict-only log), and edge fn retell-hook v1 (observe mode by default, because the signature format is doc-derived and no real delivery has been seen). Tests: bl_sec_0329_rollback_test PASS (3 cases incl. 'applying it changes nothing'), bl_sec_0329b_verify_test PASS (4 cases, real api_key), and LIVE end-to-end in enforce mode — unsigned → 401 LB401 nothing forwarded (193595), correctly signed → 200 verified:true forwarded (193596), old anon door → LB403 (193599). Staging restored to observe mode, test rows deleted. **M Usman Farooq discrepancy RESOLVED with timestamps: cron_packet_revalidation at 07:30 on a recheck_due set 2026-08-03; the collector's only touch was 06:10 and returned no_docket, wrote nothing, emailed nobody — both earlier reports were true. F30 not implicated.** Noted that Codex's reported domain-check v5 (slot 6) is NOT in the staging catalog — slot 5 is Claude's v4; flagged as UNKNOWN, not overwritten. F08/F09/F18/D left untouched. **PROD UNTOUCHED: no deploy, migration, rollback, backfill, real-sender test or message.**
- 2026-09-07 06:0x UTC · Claude · **F14 second instance (public.retell_inbound) — service-only twin built and tested on STAGING.** Re-synced: main 6b120e9, prod newest bl_camp_0328 (unchanged), staging now bl_sec_0330c; Codex's retell-hook v2 slot 2 and domain-check v5 slot 6 both present, so the earlier version discrepancy is RESOLVED and I touched neither. Read prod's definition: it is an identity oracle — anon key + any phone number returns name/company/role/MC/DOT/equipment/trucks/lanes/home-base/status, or a broker's details, or 400 chars of what someone typed into a website form; the only gate is the PUBLISHED from_number. **Env drift: retell_inbound does not exist on staging**, so I did NOT copy the vulnerable function here — only the replacement. Built `public.retell_inbound_verified(jsonb)` (bl_sec_0330 + 0330b + 0330c), service_role-only grants, body PROVEN byte-identical to prod's by md5 (prod-def + guard + rename = 9117e4e456e16e346dd7886b6f56c1e0 = staging's own definition), plus edge fn `retell-inbound-hook` v1 (verify_jwt=false, ce940e1c…b4393ac3d) which fails CLOSED with no observe mode because this endpoint hands out personal data. Tests: bl_sec_0330_rollback_test PASS (4 cases incl. broker-over-form precedence and empty-claims refusal); live i1–i6 = 200 / 401 digest_mismatch / 401 unparsable / 401 stale / 401 tampered-body / 503 verifier-incomplete, every refusal returning the EMPTY envelope; retell_hook_log confirmed to hold zero phone numbers. i6 used a scratch-table key swap, restored and verified. **The test caught two real bugs in my own guard** — a current_user escape hatch that could never fire inside SECURITY DEFINER (anon got the full payload), and an empty claims GUC raising 22P02 instead of refusing; plus a third lesson: count anchors literally, not with regexp_matches, because '(' is a metacharacter. body_not_json→400 remains UNKNOWN live (pg_net cannot post non-JSON). **PROD UNTOUCHED: no deploy, migration, rollback, revoke, backfill, provider call or message; retell_inbound and its anon grant are exactly as they were.**
- 2026-09-07 07:0x UTC · Claude · **ALL THREE PROD DEPLOYS DONE (Yaseen: "tyar sab karo"). Nothing revoked, nothing switched to enforce.** domain-check **v5** on prod (slot 3, 9a2e429d…3de67): real caller 200 unchanged shape, and 0--1 / 169.254.169.254 / fe90--1 / febf--1 / 0-0-0-0-0-ffff-7f00-1 all refused, public-IPv6 control NOT refused — all three bypasses closed on prod. retell-hook **v2** on prod (slot 1, 1b0fbaa9…fd0dd) + bl_sec_0329/b/c applied with allow_unsigned_webhook TRUE, so the live Retell chain is untouched; rollback test PASS on 4 counts incl. the verifier against the real prod api_key; and a SIGNED end-to-end chain call with deliberately non-matching numbers returned verified:true/forwarded:true/upstream ignored:true (req 195128) — the whole path works on prod with zero writes. retell-inbound-hook **v1** on prod (slot 1, c45b322e…8e160) + bl_sec_0330, built from PROD's OWN definition: prod-def + guard + rename md5 43b69a2488ac4a99661bd74ad82f46f9 == the created function's md5, **byte_identical=true**; grants postgres+service_role only; rollback test PASS (4 cases); live q1–q5 = 200 / 401 digest_mismatch / 401 unparsable / 401 stale / 401 tampered-body, every refusal the EMPTY envelope. Prod left clean: lc_calls still 112, 0 test rows, flag TRUE, retell_hook_log has 6 verdicts and no phone numbers. **public.retell_inbound and its anon grant are UNCHANGED** — deliberately, until Yaseen repoints the dashboard. Next: he repoints both webhooks, we watch retell_hook_log verify real traffic, THEN the two switches flip separately.
- 2026-09-07 07:5x UTC · Claude · **URL-token fallback for the inbound hook, staging then prod.** Reason: prod's configured inbound webhook turned out to be `.../rest/v1/rpc/retell_inbound?apikey=<PUBLIC anon key>` — a secret in the URL where the secret is the public key every browser holds. So the endpoint IS live and in use, and Retell's docs still do not confirm whether the INBOUND webhook is signed. Rather than gamble on that with a fail-closed endpoint, `retell-inbound-hook` **v2** now accepts EITHER a valid signature OR `?t=<token>`; neither → 401 as before. `bl_sec_0331` adds `retell_config.inbound_hook_token` + `public.retell_inbound_token_ok(text)` (service_role only; the token never leaves the DB). **A real bug was caught on re-reading my own code and fixed by `bl_sec_0331b`:** the constant-time compare accumulated with XOR, which CANCELS — swapping any two characters of the real token would have been accepted. It now accumulates with OR, and the staging test swaps two characters specifically to prove it. Staging tests PASS (correct token 200, wrong token 401 token_mismatch, no token/no signature 401, good token + deliberately bad signature 200). Prod: bl_sec_0331 applied, a 48-char token generated, retell-inbound-hook v2 deployed (`ee72d417b8d0b9d85b843b6d4c74113485c01f7b979400b5a4a28c79e78d2ff7`), live r1/r2/r3 = 200 / 401 token_mismatch / 401. **The token is NOT written to any repo file** — it was handed to Yaseen in chat only. Rotation: update the column, change the URL, old token dies instantly. `public.retell_inbound` and its anon grant remain UNCHANGED.
- 2026-09-07 08:1x UTC · Claude · **Change 1 is live and observe mode immediately earned itself.** Yaseen repointed the Riley Inbound agent's call webhook at prod `retell-hook`. A REAL delivery arrived 07:53:40 UTC — `event=call_started, verified=false, reason=digest_mismatch, forwarded=true`. Nothing broke (that is what observe mode is for), but the signature did not verify. Instead of assuming a format problem I asked Yaseen to compare his dashboard keys against a FINGERPRINT of the stored one (first 4 / last 4 / length — the key itself never crossed the chat). The stored key matched **"loadboot-cc"**, the general API key; his dashboard also holds a second key named **"Secret Key Webhook"**. **Root cause: Retell signs with a separate webhook key; we were verifying with the wrong one.** `bl_sec_0332` (staging + prod) adds `retell_config.webhook_signing_key`, tries it FIRST in `retell_hook_verify`, falls back to `api_key`, and reports `key_used` in the verdict so the log answers the question next time. While the column is NULL behaviour is unchanged. Staging tests PASS on 4 cases (signing key verifies and names itself; api_key still verifies via fallback; an unrelated key refused; NULL column = old behaviour). **Yaseen sets the key himself in the Supabase SQL editor** — Claude never types it and it never passes through a chat. Change 2 also done: the inbound webhook now points at `retell-inbound-hook?t=<token>`; the token path was already proven live on prod (200 / 401 token_mismatch / 401). Old doors still open on purpose — no revoke until a real call verifies. Retell credit is empty and the last real call was 2026-09-03, so there is no inbound traffic to verify against right now; flagged to Yaseen that the published number may effectively be dead until he tops up.
- 2026-09-07 09:xx UTC · Claude · **Website fixes verified live, then F14 sweep → new finding F34.** Verified on the deployed site with a browser (not just the deploy status): top bar clean, footer legal links no longer covered, the floating button reads "Get the app" and clicking it lands on /apps.html. Also fixed the button covering body text mid-page — it now hides while reading downwards and returns on scroll-up, with the footer rule always winning; behaviour proven with a stubbed DOM (top=visible, down=hidden, up=visible, footer=hidden even when scrolling up). **F14 sweep:** the exact shape of both instances (SECURITY DEFINER + anon + single UNNAMED parameter) returns EXACTLY the two functions already handled — that shape is exhausted. Widening to all anon-executable SECURITY DEFINER functions gives 33; most are public by design or uuid-token-gated. **F34 (P3 latent):** the live-chat visitor key is a bearer secret, but `lc_ob_get` required only length ≥8 while `lc_history` requires 16–64 — and the weaker guard returns the more personal record (role, data, docs, account_email). The key was also minted with Math.random(), and its storage-failure path returned 'novkey'+Date.now().toString(36)+'xxxxxxxx' — fully predictable from the clock. **Prod evidence it is latent, not live: 67 conversations, 1 onboarding row, ZERO with a novkey prefix, shortest key in use 26 chars.** Fixed: `bl_sec_0334` on STAGING (floor 8→16–64 + refuse the novkey prefix) and build_site.py now uses crypto.getRandomValues (192-bit, 49 chars) with a still-random failure path. Test PASS on 4 cases, case 1 being that a real key must keep working. **Prod not touched for F34.** Open next: lc_send / lc_poll / lc_rate / lc_ob_save / lc_start take the same key and have not been reviewed against this standard.
