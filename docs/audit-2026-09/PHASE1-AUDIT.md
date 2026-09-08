# LoadBoot — Phase 1 audit

5 September 2026 · For Muhammad Yaseen · Review required before Phase 2

> **CHANGELOG**
> - **2026-09-05 23:00 UTC · Claude · SPRINT 1 + SPRINT 2 (F30, F31, F32) ARE LIVE ON PROD**, each applied to staging first, tested with a rollback-txn test, applied to prod and re-tested there: `bl_fin_0322` (P&L engine), `bl_cmp_0324` (carrier FMCSA collector + backfill — 22 carriers checked, 21 `carrier_verifications` pending_review, was 0 of 44), `bl_cmp_0325`/`0325b` (ai_verdict persisted + CC column), `bl_sec_0320` (email-ingest lockdown, after load-mail v8), `bl_bp_0321` (resend idempotency); edge fns `load-mail` v8, `domain-check` v2 verify_jwt=true, `doc-precheck` v5 (source now in repo + PDF forensics). Tests: `docs/audit-2026-09/tests/`. **F01, F02, F05, F30, F31, F32 → CLOSED pending Yaseen's UI smoke.** New finding **F33** below.
> - **2026-09-05 22:2x UTC · Claude · F30 + F31 DESIGN NOTES added** (text only, below Sprint 2 prep table): F30 = reuse the broker `authority_checks` collector for carriers (prod: 44 carriers, 0 ever checked), replace the dead signup trigger body, collector writes `carrier_safety` + `carrier_verifications(source='auto')`; F31 = pass the `doc-precheck` verdict through the client insert first, then write-once `doc_set_ai_verdict` RPC + trigger stamp, source into repo, PDF forensics advisory. Housekeeping: prod `lb-tmp-keyread` is a dead 410 stub.
> - **2026-09-05 22:00 UTC · Claude · F32 APPLIED TO PROD** on Yaseen's word (`bl_fin_0322_port_trip_pnl_engine`); prod rollback test RESULT PASS; carrier Earnings/P&L RPCs now exist on prod. F32 → closed pending Yaseen's UI smoke test.
> - **2026-09-05 21:45 UTC · Claude · F32 port PREPARED + STAGING-VALIDATED.** `migrations/bl_fin_0322_port_trip_pnl_engine.sql` (wd_0032 + wd_0033 verbatim, explicit grants, ACL check); prod pre-flight clean (only the 4 new nullable `carrier_dispatch_prefs` columns missing); applied on staging; `docs/audit-2026-09/tests/bl_fin_0322_rollback_test.sql` → RESULT PASS. Prod untouched — waits for Yaseen. F32 row below: status → "ready for prod". (ChatGPT's parallel F32 attempt was lost to its usage limit before push; this supersedes it.)
> - **2026-09-05 07:55 UTC · Claude · Sprint 1 built on staging; Sprint 2 prep findings (read-only) added below as F30–F32.** F01/F02/F05/F07/F18 details and prod steps: `HANDOFF.md`.
> - 2026-09-05 06:30 UTC · Claude · F01 + F02 independently re-verified on prod (both real). F03 reclassified (outreach engine is approved platform email — not a conflict with Yaseen's personal-send rule; keep the Resend-quota point as P1). See `REPLY-TO-CHATGPT-phase1-review.md`.

## Sprint 2 prep — findings added 5 Sep (Claude, read-only, prod + staging + repo)

| ID / area | Priority | Evidence and finding | Consequence | Proposed fix | Effort |
|---|---|---|---|---|---|
| F30 B/H | P1 | **The "FMCSA lookup auto-queued at signup" is a silent no-op.** `app_private.trg_auto_fmcsa_at_signup` (trigger on `profiles`) posts `{dot, auto:true, user_id}` to `fmcsa-verify` with **no `Authorization` header and no `carrier_org`**. `fmcsa-verify` v34 persists only `if (carrierOrg && auth)` (index.ts ~L392) and ignores `auto`/`user_id`; nothing collects the pg_net response. Prod 30 days: **22 signups audit-logged as "auto-queued", 1 `carrier_verifications` row (manual staff action), 0 `carrier_safety` rows for GABE.** | Every real signup looks unverified in CC until a human runs the check; the audit log claims work that never happened. | Reuse the existing pg_net **collector pattern** (`authority_checks` + `fmcsa_authority_collect`, built for brokers in bl_bp_0312): at carrier signup insert an `authority_checks` row for the carrier org and let the minute cron collect; a small follow-up writes `carrier_safety` (+ a `carrier_verifications` row with `source='auto'`, `status='pending_review'`). Do NOT put a service-role key in the DB. Fix the audit line to log the request id and let the collector log the outcome. | M |
| F31 B/E | P1 | **`documents.ai_verdict` is never written.** Prod 30 days: 58 documents, **58 NULL**. The upload-time AI check (`doc-precheck` edge fn, called from `carrier/app.js` `lbAiPrecheck`) is advisory and client-side only; its verdict is never persisted (no RPC writes `ai_verdict`; only `coi_ingest_from_document` reads it). `doc-precheck` source is **not in the repo** (prod v3 / staging v4) — same gap as `load-mail` was. | Reviewer sees nothing of what the AI already found (GABE's COI holder problem was almost certainly flagged to the carrier, who clicked "upload anyway" — no trace). CC cannot prioritise by verdict. | Persist the verdict: new RPC `doc_set_ai_verdict(p_doc uuid, p_verdict jsonb)` (owner-only, idempotent) called right after the document row is created when `lbAiPrecheck` returned one; show `ai_verdict.verdict` + top issue on the CC Document review row. Add `supabase/functions/doc-precheck/index.ts` to the repo as canonical. Add the EZHAUL tamper checks (`%%EOF` count, incremental-update markers, ModDate≈upload) server-side in the same fn. | S–M |
| F32 D/B | P1 | **RPC drift root cause found.** The 6 carrier-side RPCs prod lacks (`cc_carrier_earnings`, `cc_get/set_cost_model`, `cc_trip_finance_add/remove`, `cc_trip_pnl`) come from staging migrations **`wd_0032_per_trip_pnl_engine`** (creates `app_private.trip_finance_items`) and **`wd_0033_carrier_cost_model_rpc`** (11 Jul) that were **never applied to prod** — prod's `wd_0032`/`wd_0033` are DIFFERENT migrations (number reuse). All six are wrapped in `api.js` and called from `app/carrier/app.js` (Earnings / trip P&L / cost model). The 2 CC ones (`cc_outreach_audience`, `cc_outreach_log_page`) are `bl_out_0308`, staging-only pending Yaseen's OK (known). | On prod the carrier Earnings/P&L screens call functions that do not exist → errors or empty values that read as "$0". | **ON PROD (5 Sep 22:00, test PASS) — CLOSED pending UI smoke:** `migrations/bl_fin_0322_port_trip_pnl_engine.sql` + `tests/bl_fin_0322_rollback_test.sql`, staging PASS — see HANDOFF. Original plan: port `wd_0032_per_trip_pnl_engine` + `wd_0033_carrier_cost_model_rpc` from staging to prod as ONE new migration (`bl_fin_0322_port_trip_pnl_engine`), after diffing the staging definitions against current prod schema (trips/loads columns) and running the rollback-txn test with a real trip. Until then the Earnings UI must show "unavailable", not 0. | M |

## Sprint 2 design notes — F30 + F31 (Claude, 5 Sep 22:2x UTC; TEXT ONLY, nothing built — waits for Yaseen's GO)

### F30 — carrier FMCSA check at signup: reuse the broker collector, drop the dead trigger

**What the code actually does today (prod, read-only):**
- `app_private.trg_auto_fmcsa_at_signup` (trigger on `profiles`) → `net.http_post(fmcsa-verify, {dot, auto:true, user_id})` with **no Authorization header**. `fmcsa-verify` v34 persists only when `carrierOrg && auth`; both are absent → the call returns a lookup and **writes nothing**. The trigger then audit-logs "FMCSA lookup auto-queued at signup". The pg_net response is never read (`net._http_response` is pruned ~6 h).
- The real, working pipeline already exists for brokers: cron `lb-fmcsa-authority-dispatch` (`10 6 * * *`, `fmcsa_authority_dispatch(40)`) inserts `app_private.authority_checks` rows and posts to `fmcsa_config.function_url` with `Authorization: Bearer fmcsa_config.auth_key`; cron `lb-fmcsa-authority-collect` (`*/5 * * * *`) reads `net._http_response`, writes `authority_status/allowed_to_operate/mc_active/legal_name/safety_rating/out_of_service/raw`, and on `inactive` expires the `mc_authority`/`operating_authority` onboarding item + notifies. It already **excludes carriers from the "pause posting" downgrade** (`kind <> 'carrier'`), so carriers can be fed in safely.
- **Why carriers never get there:** dispatch is gated on an onboarding item `mc_authority`/`operating_authority` in status `verified|expired`. Carrier onboarding rarely creates that item at all — prod: **44 non-demo carriers, 0 `authority_checks` rows, 0 eligible**; only 2 carriers have `operating_authority` and both are `submitted`. So the daily poll is broker-only in practice, and the signup trigger is a no-op. Net effect: **no carrier's authority has ever been checked automatically.**

**Design (one migration `bl_cmp_0324_carrier_fmcsa_collector`, ~S–M):**
1. **New `app_private.fmcsa_authority_request(p_org uuid) returns bigint`** — the single "queue a check for this org now" primitive, factored out of `fmcsa_authority_dispatch`: reads `org_docket(p_org)`, posts with `fmcsa_config.auth_key` (never a service key), upserts `authority_checks` (org_id PK). Idempotent: if a request is in flight (`request_id is not null`) or `checked_at > now()-20h`, return the existing state and do nothing. `fmcsa_authority_dispatch` calls it in its loop (behaviour unchanged for brokers).
2. **Replace the body of `trg_auto_fmcsa_at_signup`** (same trigger, same signature → ACL/attachments untouched, anchor-patch like bl_sec_0320): resolve the new/changed DOT|MC to the user's carrier org (`organization_memberships`/`my_carrier_org` for that `new.id`), call `fmcsa_authority_request(org)`, audit-log `compliance.fmcsa.requested` **with the request_id**. Keep the `exception when others` guard so signup never fails on FMCSA. Delete the unauthenticated `net.http_post`.
3. **Widen dispatch eligibility for carriers**: `kind='carrier'` orgs with a docket on file are eligible regardless of onboarding-item status (brokers keep today's rule). Cap stays (`p_limit`).
4. **Collector writes carrier records**: in `fmcsa_authority_collect`, after the `authority_checks` update, `if (select kind from organizations where id=r.org_id)='carrier'` then upsert `app_private.carrier_safety` (`carrier_id, dot_number, mc_number, authority_status, safety_rating, out_of_service, source='fmcsa_auto', last_checked=now(), fmcsa_snapshot=car`) and insert `app_private.carrier_verifications` (`carrier_org, source='auto', dot, mc, legal_name, authority, safety_rating, out_of_service, raw=car, status='pending_review'`) **only if no row for that org in the last 20 h** (no daily duplicates). On `inactive` for a carrier: staff in-app notification only (`authority.lapsed`, existing template) — **no org status change, no carrier email** (Yaseen sends personal messages).
5. **Backfill**: one-off `select fmcsa_authority_request(id) from organizations where kind='carrier' and not is_demo and status<>'archived'` in batches of 40/min (FMCSA rate) — 44 orgs → 2 minutes. Run on staging first against staging's carriers; on prod only on Yaseen's word.
6. **CC**: no UI work required for the first cut — the Carrier 360 already renders `carrier_safety` when present (verify in `app/command-center/app.js` before claiming). Later: badge "FMCSA auto-checked <date>" and the discrepancy list from `carrier_verifications`.

**Test (rollback-txn, staging):** impersonate a fresh carrier owner; update `profiles.dot` → assert an `authority_checks` row with `request_id`, audit row `compliance.fmcsa.requested` carries the id, `net.http_request_queue` has the request with the Bearer header; then fake a `net._http_response` row for that id (`status_code 200`, minimal `{"carrier":{...}}`), run `fmcsa_authority_collect()`, assert `carrier_safety` + `carrier_verifications(status='pending_review', source='auto')` written and `organizations.status` unchanged; RAISE.

**Not in scope / risks:** `fmcsa_config.auth_key` is the project anon JWT — fine for `fmcsa-verify` (verify_jwt=false, it validates internally); if F02's claims-check pattern is ever applied to `fmcsa-verify`, this caller is already conformant. Rate limit: FMCSA QCMobile ~ 1 req/s — dispatch limit 40/day is far below; backfill must be chunked. Do not touch `fmcsa-verify` source in this item.

### F31 — persist the upload-time AI verdict (`documents.ai_verdict` is 58/58 NULL)

**What happens today (prod + `app/carrier/app.js` on disk, 5 Sep):**
- `lbAiPrecheck(file, type)` (app.js ~L6788) POSTs the file to edge fn `doc-precheck` with the carrier's own session JWT; `doc-precheck` (prod v3 = staging v4, **byte-identical source; not in the repo**) runs Gemini with strict per-type checklists, force-rejects an insurance "pass" whose holder is not LoadBoot, and returns `{ok, ai, doc_type, verdict:{verdict, doc_label, issues[], fields{…}, summary}, holder}`. **It writes nothing.**
- `lbPrecheckGate(verdict)` shows the reject modal; the carrier may click "upload anyway". Then `uploadDocument()` (storage) + `carrierUploadDocument({type,fileName,filePath})` = a **plain `documents` insert from the client** (`api.js` L743). The insert path never includes `ai_verdict`; trigger `protect_document_insert` forces `carrier_id/status/reviewed_at/review_note` but leaves `ai_verdict` alone; policy `docs_insert` = `carrier_id = auth.uid()`. Column grants: authenticated (and anon) hold INSERT/UPDATE on `ai_verdict` — RLS is what protects it (no non-admin UPDATE policy exists).
- Result: the reviewer sees none of what the AI already found; GABE's COI holder problem was almost certainly flagged to the carrier and clicked through — no trace. 30-day prod: 58 documents, 58 NULL.

**Design — two layers, smallest first:**
1. **Client passes the verdict on insert (S, no DB change, ships first).** `carrierUploadDocument({type,fileName,filePath, aiVerdict})` adds `ai_verdict: aiVerdict ? {...aiVerdict, recorded_by:'carrier-client', recorded_at: new Date().toISOString(), fn:'doc-precheck', overridden: verdict==='reject'} : null`. Call sites: the 4 `lbAiPrecheck` callers (app.js ~L6954, 7012, 7492, 7567) already hold `pv9` — pass it through. Because the client supplies it, CC must label it **"carrier-side AI pre-check (advisory)"** — a carrier could forge a pass; that is acceptable because staff review stays final and the value of the field is the *reject* evidence, which nobody forges against themselves. (Touches `app/carrier/app.js` + `api.js` → **outside the Sprint 1 no-touch list; needs Yaseen's explicit OK before editing.**)
2. **Server-side hardening (M, `bl_cmp_0325_doc_ai_verdict`):** trigger `protect_document_insert` additionally stamps `new.ai_verdict := coalesce(new.ai_verdict,'{}') || jsonb_build_object('recorded_by','carrier-client','recorded_at',now())` when `not is_admin()` (so the client can't claim a server origin), and a new **owner-or-admin RPC `doc_set_ai_verdict(p_doc uuid, p_verdict jsonb) returns boolean`** — SECURITY DEFINER, `documents.carrier_id = auth.uid() or is_admin()`, **only if `ai_verdict is null`** (idempotent, write-once), grants authenticated + service_role, revoke anon. Purpose: retro-attach a verdict when the insert happened without one (the precheck sometimes finishes after the upload UI moves on), and give `doc-precheck` a server path later (it would call the RPC with the service key and stamp `recorded_by:'doc-precheck'` — the trustworthy source). Then **revoke anon's column grants on `public.documents`** (hygiene: anon has INSERT/UPDATE column privileges today; RLS blocks it, but defence in depth).
3. **`doc-precheck` source into the repo** as `supabase/functions/doc-precheck/index.ts` (pull from staging v4 via `get_edge_function`, verbatim, header noting prod v3 = same source) — same gap `load-mail` had. No behaviour change in this step.
4. **Tamper checks server-side, in `doc-precheck` (S, separate deploy):** for PDFs, count `%%EOF` markers (>1 = incremental update = edited after signing), detect `/Prev` xref chains, compare `/ModDate` vs `/CreationDate` (ModDate later by >1 day on a COI = warning), flag `/Producer` values from editors (e.g. "Adobe Acrobat Pro", "PDFescape", "Sejda") vs insurer systems. Emit as `issues[{severity:'warning', problem:'PDF shows post-issue edits …'}]` and a `fields.pdf_forensics` object — **advisory**, never auto-reject on it. This is the EZHAUL recipe formalised.
5. **CC Document review row** (`app/command-center/app.js`): show `ai_verdict.verdict` pill + first `issues[0].problem`, tooltip = `summary`, label "AI pre-check (advisory, carrier-side)" or "(doc-precheck)" per `recorded_by`; sort pending docs with `reject` first. CC nav untouched.

**Test (rollback-txn, staging):** as a carrier owner insert a `documents` row with an `ai_verdict` payload → assert `recorded_by='carrier-client'` stamped by trigger regardless of what the client sent; `doc_set_ai_verdict` on a NULL row → true, on the same row again → false (write-once), on another carrier's row → 42501; anon `doc_set_ai_verdict` → no EXECUTE; RAISE.

**Order of work when approved:** (3) repo source → (1) client pass-through → (2) migration → (5) CC row → (4) forensics. Each with its own rollback test; prod only on Yaseen's word.

### Housekeeping found during re-sync (not a finding, one-liners)
- Prod edge fn **`lb-tmp-keyread`** (v2, `verify_jwt=false`) is a dead stub returning 410 "gone" — safe to delete; nothing references it. Delete on Yaseen's word.
- `docs/audit-2026-09/tests/` now exists; every future migration in this programme ships with a `*_rollback_test.sql` there.

## F33 — 27 of 44 prod carriers have no MC/USDOT on file anywhere (found 5 Sep during the F30 backfill)

| ID / area | Priority | Evidence and finding | Consequence | Proposed fix | Effort |
|---|---|---|---|---|---|
| F33 B/H | P2 | After `bl_cmp_0324` went live the backfill queued every non-demo carrier. 17 had a docket on the org row and 5 more only on the OWNER'S PROFILE (EZHAUL, GABE LOGISTICS, IRONCUBE, MKMI ENTERPRISE, Optimization Linx) — the profile fallback was added for exactly this. The remaining **27 carriers have no MC or USDOT in `organizations`, `carrier_safety`, `profiles`, or an onboarding item ref**, so `authority_status='no_docket'`. Many are clearly abandoned or test signups (`Ahmed`, `thomas`, `Carrier Account`, `Rachel_0307` twice, `Loadboot`), but real-looking companies are in the list too: GCA LOGISTICS LLC, JB Hauling LLC, MEDO ENTERPRISE LLC, KST3 enterprise LLc, JayLena Recycling, Primo Liquidation LLC, Pillars Connections. | These accounts can never be verified automatically — the daily FMCSA poll will skip them for ever, and a dispatcher looking at Carrier 360 sees an empty safety panel with no explanation of why. It also inflates the "44 active carriers" number: a carrier with no docket is not a dispatchable carrier. | (a) CC: a "no docket on file" filter/badge on the carrier list driven by `authority_checks.authority_status='no_docket'` — one query, no new table. (b) Onboarding: make MC **or** USDOT a required field on the carrier org (it is already asked at signup — it lands on the profile, which is why the fallback was needed; write it to the org too). (c) A one-time list for Yaseen to triage: archive the obvious test accounts, ask the real ones for their number. `fmcsa_carrier_backfill()` re-tries a `no_docket` row automatically the moment a number appears. | S |

## Evidence boundary

Repository: `yaseem786/loadboot`, latest `main` verified as `b44fbabe12ac1841b2b61c042eb042f760b8ae5f` (PR #168, 05:25:50 UTC). The checkout was refreshed during this audit: findings from the preceding `44790d66` revision were reassessed. References below are to the refreshed revision. Production is `rwscphuhpjoudvljvmdk`; staging is `snslhvmkjusozgjelghi`. Both migration histories and function catalogs were inspected; staging advisors preceded production read-only advisors. Production received metadata and aggregate reads only. No application RPC was invoked, no customer message sent, no database changed, and no repository source edited. The preview build was explicitly bound to staging and generated outside the checkout.

This is a source, metadata, build, and primary-source audit—not a completed penetration test or authenticated end-to-end certification. Browser execution could not start because Chromium was unavailable and its download timed out. Full per-function authorization, every screen interaction, actual onboarding duration, production deploy revision, and Lighthouse/CWV results remain **UNKNOWN**. The evidence inventory records these gaps rather than treating scans as proof of safety. Existing repository screenshots were inspected as harness examples, not live customer sessions.

## Phase 0: LoadBoot today, refreshed

LoadBoot is a Python-generated public site with vanilla-JS carrier, partner and staff portals backed by substantial Supabase RPC, document, e-sign, W-9, booking, tracking and settlement implementations. Their complete runtime behavior is not certified by this audit. The CC still has 21 navigation items. Current main now includes agent multi-brokerage email-code confirmation, shipper business-check UI, the 0316b/0318/0319 migration files and domain-check source: these are no longer “DB-only” gaps. Both databases contain the newer trust functions. Production has **zero non-demo available loads**, 44 active non-demo carrier organizations, eight active and two pending non-demo broker organizations, and one active non-demo shipper organization; “active” and “non-demo” do not prove commercial legitimacy or full verification. Production has three non-demo booked loads and one delivered load, not evidence of a weekly run rate. Eight API-referenced RPC names are absent in production and 15 in staging. Several retired CC modules are deliberate compatibility stubs. The exact Netlify revision and authenticated journey success remain UNKNOWN.

## 1. Executive summary

The immediate constraint is usable supply and trustworthy execution. Adding more dashboards or generic articles will not make an empty marketplace useful. Five moves offer the strongest plausible effect on loads moved per week without advertising spend:

1. **Close trust and communication boundaries before recruiting more users.** Restrict legacy email-ingest RPCs, repair domain-check authentication/URL handling, and resolve the existing automated-outreach conflict with your personal-send rule. These are release blockers, not evidence of a known breach.
2. **Make one narrow broker–carrier lane work repeatedly.** Use existing relationships and carrier-approved capacity to obtain actual broker postings, then retain those brokers with prompt responses, tracking and complete paperwork. Choose the lane from verified availability, not a fabricated market-size estimate. The goals of ten loads/week and 20 verified carriers are targets, not forecasts.
3. **Remove failures in the existing path.** Fix the agent resend/code defect, reconcile RPC contracts between environments, and show an actionable zero-load state. Keep the packet reduction, multi-parent agent model, W-9, agreements and booking engines.
4. **Align money, legal role and promises.** The agreement earns a 5% linehaul fee on booked-and-delivered freight; generated `llms.txt` says booked loads and “no contract.” Shipper copy mixes direct carrier transactions with licensed-broker routing. Obtain a transaction-specific legal decision, then make every representation consistent. Do not add a payment rail or guarantee detention recovery.
5. **Measure the narrow loop and publish proof.** Connect existing web attribution to signup, verification, post, booking and delivery; publish one useful article or substantial update weekly based on real broker/carrier questions. Improve the landing-to-next-action path before increasing article volume.

**Proposed wedge:** “Show the broker you and your truck are ready, with one current, permissioned record of your authority, paperwork and availability.”

This is a testable positioning hypothesis. LoadBoot currently has **no demonstrated defensible difference**. DAT, Truckstop, Uber Freight, Amazon Relay and the current Convoy Platform already provide overlapping verification, matching, tracking, paperwork or payment capabilities. No evidence establishes a feature nobody else has. See the separate competition document for the narrower opportunity and its limits.

## 2. A–L scorecard

Grades assess demonstrated launch readiness, not invented performance scores. Targets are proposed acceptance standards.

| Area | Current | Target | Biggest gap |
|---|---|---|---|
| A Business/economics | D | B | No non-demo available loads; fee and legal-role inconsistencies; contribution margin UNKNOWN |
| B Carrier UX | C | B | Six-step wizard plus account/documents; actual first-load timing UNKNOWN; earnings RPC drift |
| C Supply UX | C | B | New trust UI exists; resend can invalidate codes without sending replacement email |
| D Engineering | C | B | Builds and syntax pass; large eager modules, broken test commands, false-positive import gate, environment drift |
| E Security | F | B | Authenticated legacy ingestion lacks caller authorization; domain-check authentication is insufficient |
| F Performance | D | A | Large generated assets; Lighthouse and field CWV UNKNOWN |
| G SEO | C | B | Crawlable output and metadata exist; unsupported claims and missing funnel proof outweigh more pages |
| H Automation | D | B | Enabled sales outreach conflicts with personal-send rule; free-tier fit UNKNOWN |
| I Operations | C | B | 21-item CC retained; restore, incident and queue recovery drills UNKNOWN |
| J Analytics | C | B | Tracking exists; cross-portal identity/cohort conversion and trustworthy denominators unverified |
| K Design | C | B | Shared components exist, but extensive local styling and no authenticated mobile/accessibility certification |
| L Positioning | D | B | Broad feature parity; repeat use and any network advantage unproven |

## 3. Full findings, ordered by severity

S/M/L are relative implementation effort estimates, not commitments. Every fix is a proposal for a feature branch, reversible staging migration where needed, diff review and staged verification. P0 means block expansion/release of the affected path pending resolution; it does not mean exploitation was observed.

| ID / area | Priority | Evidence and finding | Carrier/broker consequence | Concrete proposed fix | Effort | Fix risk |
|---|---|---|---|---|---|---|
| F01 E | P0 | Live `public.lb_email_load_ingest(jsonb)`, `lb_email_ping_confirm_by_email(text,jsonb)`, `lb_email_reply_merge(text,jsonb)` grant EXECUTE to `authenticated`. Reviewed bodies lack caller/role checks. Ingest trusts supplied sender data and calls `lb_email_notify`, which queues mail; publishing is possible for an already eligible email broker. No `pgrst.db_pre_request` setting was returned from inspected role settings. | A signed-in caller may spoof ingestion, create records or queue messages outside the trusted inbound route. HTTP exploitability not exercised. | Inventory legitimate callers; restrict to the service worker identity and validate authenticated inbound events. Revoke ordinary-role execution in a staging migration, with saved grants/definitions for rollback. Verify with non-delivering staging fixtures. | M | High: preserve legitimate inbound loads and replies. |
| F02 E/C | P0 | `supabase/functions/domain-check/index.ts:43–49`: authorization accepts any header beginning `Bearer ey`; deployed function had JWT verification disabled. `fetchSite:20–27` follows redirects; hostname checks do not reject private resolved IPs or validate redirect destinations. | An external caller may consume resources or direct server requests to unintended destinations. SSRF reachability is UNKNOWN. | Require a verifiable server caller; validate DNS/IP and every redirect destination, forbid private/link-local/loopback ranges and unsuitable ports, cap redirects/time/stream bytes. Stage first; preserve collector response shape. | M | Medium: legitimate sites redirect or use unusual DNS. |
| F03 H/I | P0 | Live `outreach_state.enabled=true`; `outreach.daily_cap=600`, batch 150; active `lb-outreach-daily` cron at `0 13,15,17,19 * * *`. `outreach_run_daily` invokes `sys_email`. Stored `sent_today=600` belongs to 2026-09-04 and is not proof of delivery. | Existing automation conflicts with your instruction that you personally send customer outreach; it may compete with transactional email quota. | Obtain your decision on the existing engine; propose a reversible pause and draft-only approval queue. Do not silently change the live schedule. Record individual approval and message hash; you send. | M | High: changes existing communications behavior; explicit review required. |
| F04 A | P0 decision gate | `build_site.py:7678–7690,7699,7720–7725` advertises direct shipper/carrier freight and no broker markup, while newer shipper UI says brokers quote. Dispatch and matching can involve multiple carriers. FMCSA guidance is fact-specific; a disclaimer does not resolve actual allocation, contracts and fund flows. | Misstated operating role can expose both sides to transactions they did not understand. | Have counsel map each shipper→broker→carrier transaction, identify the licensed counterparty, carrier appointment and allocation decision. Approve copy/agreement changes before implementation. No conclusion that LoadBoot is unlawfully brokering is made here. | M | High: legal/contract change; owner approval mandatory. |
| F05 C | P1 | `bl_bp_0318_agent_multi_parent.sql:232–266` consumes earlier email codes and creates another, but email key is fixed per parent/reminder flag/recipient. Live `sys_email` uses `ON CONFLICT(idempotency_key) DO NOTHING`. | After repeated sends/resends in the same category, the new code may never arrive while the old one is invalid. | Associate each delivery key with the newly created verification-code ID. Retry the same code/delivery without regenerating it; deliberate resend creates one new code. Return queued/suppressed state honestly. | S–M | Medium: preserve throttle, five-attempt limit, seven-day expiry and no agent calls. |
| F06 D/B/C | P1 | Current `api.js` references 726 unique literal RPC names. Production lacks eight and staging 15; exact lists below. Carrier `app.js:5771,5852,5944` calls absent earnings/cost RPCs; `views/outreach.js:511` calls absent log RPC. | Errors and empty fallback values can look like no earnings or no communication history. Staging cannot certify production behavior. | Compare signatures and semantics, identify intended replacement endpoints, then add compatibility wrappers or update callers. Do not blindly copy all missing functions to prod. | M | High for finance; use known fixtures and reconcile totals. |
| F07 D/E | P1 | `build_site.py:43–50` defaults local `dev` to production despite comments about preview safety. | A normal local build can point subsequent browser tests at real users. | Make local development explicitly staging; fail closed without staging config. Keep production context explicit. Audit build already used `CONTEXT=deploy-preview`. | S | Medium: owner local workflow changes. |
| F08 D/B | P1 | `build_site.py:8585–8587` installs with `skipWaiting`; `app/shared/sw-register.js:40–54` offers an update prompt and reloads on controller change. The generated worker lacks the corresponding app `SKIP_WAITING` message path. | Immediate takeover can reload unfinished forms; the prompt does not fully control activation. | Retain existing versioning and prompt; stage an explicit waiting→user-approved activation handshake, preserve dirty forms, and test two tabs and an offline reopen. | M | High: preserve document/e-sign work and rollback compatibility. |
| F09 E/B | P1 | `build_site.py:8591` caches shared files under `lb-share-inbox`; `session.js:144–156` clears only `lb-app*`. `carrier/app.js:6776+` displays the inbox file to the next documents view and deletes it after upload/dismissal. | An unprocessed shared document can survive sign-out on a shared device. | Scope inbox to the session/owner; purge on logout, owner switch and expiry. Preserve a deliberate pending-upload warning before purge. | S–M | Medium: avoid silent file loss. |
| F10 E | P1 | Production storage SELECT policy `staff read documents` grants access to every active staff account; other policies also grant `documents.view` and owner access. Policies combine with OR. | Sensitive W-9/identity documents may be visible more broadly than role permissions imply. | Confirm intended staff roles, then replace blanket access with narrowly authorized paths in a reversible migration. Stage a role-by-document-type matrix. | M | High: avoid blocking legitimate review and settlements. |
| F11 C/E | P1 | `bl_bp_0319_shipper_trust.sql:160–172` passes non-free-mail domains with MX; site/company-name match is informational. `app/partner/shipper-trust.js` describes business confirmation. | Inbox/domain possession can be mistaken for proof of a legal business or creditworthiness. It neither proves payment capacity nor all identity claims. | Preserve low-friction quote requests; label the exact signal checked and timestamp. Require the existing packet and approved transaction checks before booking; manual exception for domainless businesses. | S–M | Medium: trust copy and gate decisions need review. |
| F12 A | P1 | `dispatch-agreement.js:15–16` earns 5% after booking AND delivery, excludes FSC/accessorials, allows settlement deduction/invoice. `build_site.py:8868` says booked loads and “no contract.” | Carriers can misunderstand fee timing, base and contractual obligations. Payment collection/margin remain UNKNOWN. | Owner confirms earned-vs-due-vs-collected rules; use one approved fee specification across agreement, pricing, onboarding, invoices and llms.txt. | M | High: do not change signed terms or payment behavior without approval. |
| F13 A/G | P1 | Generated homepage metadata promises “zero ghost loads”; `build_site.py` and llms.txt describe broad tracking/payment outcomes. Production has zero non-demo available loads. | Promise exceeds demonstrated supply and outcome evidence, damaging first-session trust. | Draft scoped wording: current availability, when checked, request/approval state, agreed accessorial terms. Never promise paid claims or continuous GPS without evidence. | S | Medium: owner copy review. |
| F14 E | P1 | Advisors: production 75 mutable-search-path functions, 32 anon-executable SECURITY DEFINER findings, 793 authenticated; staging 82/35/782. Several examined “cc” functions have proper caller checks; these totals are not leak counts. | Blanket revocation would break working RPCs; ignoring them leaves authorization uncertainty. | Review each grant against purpose, fixed search path, schema ownership, caller scope and downstream effects. Inventory is attached. Record allowlist by signature, not a stale magic count. | L | High: staged batches and positive/negative contract tests. |
| F15 E | P1 | Both security advisors flag disabled leaked-password protection. Password/session/OTP project settings were not fully available in the review. | Password users may lack an available protection; actual auth abuse limits UNKNOWN. | Review Auth settings and plan eligibility; propose protection and documented OTP/session limits. No auth-flow change in this phase. | S | Medium: plan cost and login compatibility. |
| F16 B/J | P1 | `carrier/app.js:7301+` has six wizard steps and loads profile/compliance/preferences; Account and Documents are additional entry points. Duration and abandonment are unmeasured. | Duplicate navigation and optional payment details can delay first useful action. | Shared progress state; resume next required step; autofill existing company/equipment data; collect only what is required at the relevant milestone. Keep legal/dispatchability checks before booking. | M | High if compliance gating is accidentally weakened. |
| F17 A/B/C | P1 | Zero non-demo available loads despite existing organizations; org active status is not verified capacity. | More signups can produce disappointment without useful freight. | Lane-specific capacity opt-in and truthful zero-result states; recruit broker supply matched to confirmed availability. Measure recurring posting and delivered loads. | M | Medium: no unapproved outreach or capacity claims. |
| F18 D | P2 | All 149 original JS sources pass `node --check` via temporary `.mjs`; build reports BUILD OK. `check_imports.py` fails on `partnerIntake.js:258`, although that line dynamically imports `ccAskReschedule`. `package.json:7–8` references two missing test files. No workflow directory in reviewed tree. | False-positive gates and unusable commands make release verification unreliable. | Fix the import checker to recognize dynamic destructuring; repair/remove stale script references by review; add PR checks using existing smoke tests and staging-only contracts. | S–M | Low–medium; do not mistake syntax for runtime safety. |
| F19 D/F | P2 | Preview output: 401 files, 23,411,785 bytes; carrier app 764,611 bytes, partner app 490,961 bytes before transfer compression. A 2,072,328-byte hero PNG is emitted. | Phone download/parse/storage costs; presence in output does not prove each file loads on every page. | Measure actual transfer first; lazy-import noninitial views, reduce precache to each portal shell, use existing appropriate WebP/JPEG sources and responsive sizing. | M | Medium: preserve routes and offline behavior. |
| F20 F/K | P2 | Lighthouse mobile/desktop and field LCP/CLS/INP UNKNOWN; browser dependency unavailable. | No evidence that driver-facing performance/accessibility meets target. | Run the exact seven-page staging measurements in the verification plan; capture field INP separately. Prioritize from measured bottlenecks. | S–M | Low. |
| F21 G | P2 | Generated 123 top-level HTML pages all have titles; only 404 lacks a canonical. `robots.txt` excludes `/app/` and dashboard; app headers noindex. Public sitemap exists. Google discontinued FAQ rich results in May 2026; FAQ markup is widespread. | More schema work will not create the expected FAQ visibility; crawlable HTML already exists. | Keep useful visible FAQs; prioritize accuracy, unique intent, canonicals/redirects and conversions. Do not spend the sprint expanding FAQ schema or llms.txt for Google ranking. | S | Low. |
| F22 G | P2 | `content-queue.md:3–18` proposes auto-writer commits and 3–4 long articles weekly. Existing guide/equipment/state/tool pages already cover much of the keyword map. | One operator can accumulate unsupported claims and duplicate intent faster than useful proof. | One substantial publish/update weekly; human fact/source review and feature-branch PR. Update current pages rather than cloning keyword variants. | S | Low. |
| F23 J/G | P2 | `build_site.py:499–501` already captures pageview, anon_id, referrer and UTMs; lead submission carries them. Signup→org→booking linkage unverified. | Traffic totals cannot establish SEO-generated verified carriers or freight. | Extend existing events with server-recorded conversion IDs and first/last attribution; do not introduce a duplicate tracking stack. | M | Medium: privacy, dedupe, permissions. |
| F24 H | P2 | Production has 40 active cron jobs, including two minutely email-related workers, collection jobs and a 30-second watchdog. Database size 311 MB. Actual account plans/usage UNKNOWN. | The proposed $0 automation budget may not cover existing traffic, logs, email and voice. | Measure calls/egress/outbox/log growth; prioritize transactional mail; coalesce polling and retain bounded logs. Retell trial credit is not recurring free service. | M | Medium: avoid slowing operational notifications. |
| F25 E/F | P2 | Full performance advisories list 53/58 unindexed FKs (prod/staging), 15/12 auth RLS initplans, two/three duplicate indexes. 94/91 tables have RLS enabled with no policy. | Potential performance overhead; no-policy private tables may intentionally deny access. | Inspect real query plans and grants; add only justified indexes in staged migrations. Do not “fix” private no-policy tables by granting access; do not drop indexes in this phase. | M | Medium. |
| F26 I | P2 | Existing support/status modules and cron jobs exist; restore success, recovery objectives and deployed status independence UNKNOWN. | An outage may disable the same surface used to explain it; email queues can hide customer impact. | Draft one runbook; rehearse a staging restore with outbound delivery disabled; show failed jobs/oldest queue items on existing Today/Task queue tabs. | M | Medium: staging restore must never trigger messages. |
| F27 K | P2 | Source scan found 9,672 style literals in app JS/CSS; these are candidates, not 9,672 violations. Broker trust and shipper modules embed their own CSS. Harness screenshots show small secondary text and compact action buttons. | Inconsistent states, hard-to-tap actions and weak sunlight legibility are plausible; measured contrast/tap audit UNKNOWN. | Extend shared components/tokens with semantic states, 44px controls, focus treatment and error associations. Migrate the three hero modules incrementally. | M | Medium: visual regressions; preserve main app files. |
| F28 D/I | P3 | `campaigns.js`, `chat.js`, `exceptions.js`, `management.js`, `marketingAnalytics.js`, `systemModules.js:2` explicitly remain compatibility stubs, not imported active screens. | Mistaking them for missing daily workflows would re-inflate CC. | Keep them until cache/route usage proves retirement safe; document replacements. No new navigation. | S | Low if retained. |
| F29 E | P3 | Deployed `lb-tmp-keyread` source is a 410 “gone” stub. Public publishable Supabase keys are expected client configuration. | Names alone could produce a false key-leak finding. | Record the dead endpoint for later approved retirement; do not rotate public keys merely because clients expose them. Full historical secret scan remains UNKNOWN. | S | Low; deletion still needs approval. |

### Exact RPC drift

Production absent: `cc_carrier_earnings`, `cc_get_cost_model`, `cc_outreach_audience`, `cc_outreach_log_page`, `cc_set_cost_model`, `cc_trip_finance_add`, `cc_trip_finance_remove`, `cc_trip_pnl`.

Staging absent: `cancel_account_deletion`, `cc_account_deletion_process`, `cc_account_deletion_queue`, `cc_account_requests`, `cc_agent_payout_approve_method`, `cc_agent_payout_request_details`, `cc_authority_board`, `cc_org_set_docket`, `cc_packet_set_dates`, `cc_partner_compliance_board`, `cc_partner_packet_remind`, `cc_request_account_action`, `cc_resolve_account_request`, `my_account_deletion_status`, `request_account_deletion`.

Name comparison is only the first contract gate. Overloads, parameter names, permissions and response shapes must also match. Different migration counts (687 staging, 716 production) alone do not establish incompatible schemas; histories include differently split migrations.

### Security controls that do exist

`my_any_org` uses the untrusted `x-lb-app` header to select a portal preference, but its reviewed org resolvers restrict membership to `auth.uid()` and active membership. Header spoofing alone is not a demonstrated cross-tenant bypass. Dispatcher fallback also checks active assignment. Test multi-membership and dispatcher contexts on staging.

The documents bucket is private, limited to 15 MiB and a PDF/image MIME allowlist. This does not prove every signed URL is safe. Avatar code requests 3,600-second URLs; POD review requests 120 seconds. Storage policies include owner, staff, payment-receipt, partner-stop-document and assigned-dispatcher paths. Their full negative-test matrix remains UNKNOWN. Public org logos have no bucket-level size/MIME limits in returned metadata.

The reviewed legacy `book_load` uses one conditional UPDATE on an available unexpired load and checks demo symmetry, preventing a simple double-winner at that statement. That is not certification of the modern offer/request/accept chain, and the old function's limited gates need comparison with all current trust/compliance requirements. Delivery webhook source contains signature and dedupe logic; actual deployed Retell signature/replay coverage remains UNKNOWN.

## 4. Business and money decisions

Current signed-fee text says the carrier pays 5% of gross linehaul for loads booked through the dispatcher and delivered; FSC, lumper, detention, layover and TONU are excluded. Brokerage/shipper posting is advertised free. Whether collection is contingent on the carrier actually being paid is **UNKNOWN**; the displayed agreement does not say that. Whether settlement deduction is operational, who holds funds, real payment terms, chargebacks and accepted factoring instructions are **UNKNOWN**. Do not infer a Stripe/ACH implementation from an invoice or receipt screen.

Define contribution per completed load as **collected dispatch fee − actual variable service cost − refunds/credits − allocated direct operator effort**. All monetary inputs beyond the stated fee rule are UNKNOWN. Advertising spend $0 is a constraint, not proof total acquisition or operating cost is zero. New-authority freight is subject to each broker's underwriting; do not promise universal eligibility.

## 5. Questions for Yaseen

1. Should the existing enabled outreach engine be paused and changed to drafts only? Your audit instruction and current engine behavior conflict.
2. Which licensed broker is the contractual counterparty on each shipper-originated transaction? Does LoadBoot ever accept freight before a named carrier is appointed or choose among overlapping represented carriers?
3. Is the dispatch fee earned on delivery, due after carrier payment, or both? Who invoices, receives and deducts it? What happens on disputes, nonpayment and factoring?
4. Which equipment/lane and existing broker relationship should form the first recurring pilot? Actual willing capacity and broker commitment are UNKNOWN.
5. Which organizations are genuine operating customers and which satisfy current dispatchability requirements? `active`/`is_demo=false` is insufficient.
6. What are the actual Netlify, Supabase, Resend and Retell plans and monthly usage? Does $0 mean incremental growth spend or total infrastructure spend too?
7. Which staging test identities/fixtures may exercise booking, W-9, e-sign and settlement with outbound delivery disabled? None were supplied for this audit.
8. What document retention and staff-access policy is approved for tax/identity/insurance records? What restore loss/time objectives are acceptable?
9. Who approves legal, fee and shipper-copy corrections? Is there an eligible in-person business location/service model for a Google Business Profile?
10. What weekly time can you reserve for legal/trust exceptions and publishing? The roadmap assumes one substantial content item weekly, not a daily manual operations dependency.

## 6. UNKNOWN register and exact verification path

| UNKNOWN | How to verify |
|---|---|
| Exact live Netlify commit and headers | Read the published deploy's commit SHA, build log and environment in Netlify; compare immutable asset hashes with this commit. Do not infer from main. |
| All authenticated carrier/broker/agent/shipper flows | Isolated staging personas, no real recipients, outbound workers/sinks controlled; run the journey and capture network/errors at each step. |
| Every RPC's authorization and RLS safety | Use the attached per-function/table inventories; for each exposed signature verify grants, schema exposure, caller guard and negative cross-tenant tests. No wholesale “secure” assertion. |
| Legacy ingestion HTTP exploitability | Staging only: authenticated low-privilege fixture with transaction rollback and outbox disabled; attempt sender substitution and assert denial with zero deliveries. |
| Domain-check SSRF and auth behavior in runtime | Local/staging controlled DNS/redirect test server and bounded response fixtures; confirm invalid JWTs rejected and no private address contacted. Never probe production/internal services. |
| Agent resend bug runtime | Capture two deliberate resends against a staging parent using a mail sink; compare code IDs, outbox keys and usability of the delivered code. |
| Lighthouse, field CWV and per-portal transfer | Run the seven-page commands in the roadmap; field INP requires real-user interaction or available CrUX/Search Console data. |
| Onboarding and first-load time | Instrument timestamps and run a timed staging journey, then report production cohort medians/p90 only after sufficient legitimate events. |
| Verified operating carriers/brokers, weekly deliveries, retention | Apply approved eligibility predicates to org requirements, trucks, authority freshness and completed-trip events; exclude demos/internal/test accounts. |
| Real fee collection, settlement lag, margin and payment rail | Reconcile invoice/receipt/bank evidence for an owner-approved real cohort; legal and payment decisions first. |
| Keyword volume, rankings, indexed URLs, organic conversion | Export current Search Console query/page/country/device and indexing reports; connect conversions. Search volume remains UNKNOWN without a defensible source. |
| Full rendered per-screen accessibility | 360px/390px mobile, keyboard, screen reader, contrast and 44px target inspection for every listed view and state. Current screenshot examples are harnesses. |
| Full token violations | Review each style-inventory entry against brand tokens and approved semantic colors. A color literal alone is not a violation. |
| All webhooks, secrets/history, session/rate limits | Inspect deployed source/config and signature/replay controls, credential metadata and approved historical scanner; report only redacted findings. |
| Backup/restore, recovery objectives, status independence | Read plan/backup configuration and rehearse in isolated staging with all outbound channels suppressed. |
| Free-tier remaining capacity and per-job success | Account usage/billing views, cron run history, queue backlog, failure/dead-letter counts and bounded retention; job existence is not successful operation. |
| Statistical size/frequency of user pains and moat | Consent-based carrier/broker interviews and pilot events. Competitor feature pages cannot establish unmet demand or switching intent. |

## Sources and companion deliverables

Primary external sources checked on 5 September 2026: [FMCSA final guidance](https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents); [Google Search updates](https://developers.google.com/search/updates); [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies); [Supabase pricing](https://supabase.com/pricing); [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits); [Netlify credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/); [Retell pricing](https://www.retellai.com/pricing).

Companions: **LoadBoot-Competition-and-Wedge.md**, **LoadBoot-90-Day-Plan.md**, and **LoadBoot-Evidence-Index.md** with the evidence archive. No Phase 2 changes have been made. Stop here for your review.

## Corrective round — PRODUCTION results (2026-09-06)

Applied after the Sprint 1+2 verification pass. Staging first in every case, same test re-run on prod.

- **A — `bl_cmp_0326_broker_precedence_fix` (prod `20260906125744`).** Fixes the F30 broker regression introduced
  by my own `bl_cmp_0324`: fmcsa-verify's `authority` field is CARRIER authority only, so a broker-only docket
  returns `authority='inactive'` with `authorityVerified=true`. 0324 applied that precedence to every org kind,
  which would have expired a legitimate broker's onboarding item, paused the org and emailed the owner. 0326
  moves the org-kind lookup above the classification and gates both precedence branches on `v_kind='carrier'`.
  Prod rollback-txn test: **PASS on all three cases** — broker-only → active/no-pause/no-email; lapsed-broker →
  inactive/paused/expired/emailed (the pre-0324 behaviour, byte-for-byte; this leg cannot run on staging because
  `org_onboarding_items_status_check` there has no `'expired'` value); carrier verified-inactive →
  inactive/no-pause/no-email. Post-check: `fix_live=true`, 0 items expired by the test, 0 emails.
  Blast radius before the fix: **zero** — the only two brokers the 06:10 UTC prod dispatch reached both returned
  `no_docket`.
- **B — `load-mail` v9 (prod slot 7).** F01's DB guard closed direct RPC calls but moved the spoofing path one
  layer up: `verify_jwt=true` accepts any valid project credential, including the PUBLIC anon key, and v8 then
  relayed the caller's payload to the RPCs using the service key. v9 adds `isServiceCaller()` — the bearer must
  either byte-match `SUPABASE_SERVICE_ROLE_KEY` (length-guarded constant-time compare, because this project's
  service key is an opaque `sb_secret_…` string, not a JWT) or decode to `role=service_role`. Prod live check:
  anon-key caller → **403 `{"error":"forbidden","code":"LB403"}`**.
- **C — `domain-check` v3.** Two SSRF bypasses in v2's literal-IP check: `new URL("http://[::1]/").hostname`
  keeps the brackets, so no IPv6 literal ever matched; and the parser normalises `::ffff:127.0.0.1` to
  `::ffff:7f00:1`, so the v4-mapped branch missed it too. v3 strips brackets, expands the hex form, and refuses
  anything it cannot classify. **Deployed and verified on STAGING only — NOT on prod.** Prod therefore still
  carries both bypasses. Awaiting Yaseen's word.
- **Not run on prod:** live check 5 (the full inbound-mail → load-mail chain). It ingests a real test-sender row.

### Unreconciled observation (cause UNKNOWN)
Codex reported at 07:30 UTC that "M Usman Farooq (Agent)" was pending with an expired authority item. My
post-backfill queries found 0 items expired and 0 emails from the 0324 dispatch/backfill. Not explained yet; the
row may pre-date the collector. Nobody should assume the collector caused it — query that org's
`org_onboarding_items` history with timestamps first.

### F02 follow-up — domain-check v4 (staging, 2026-09-06)

Codex's verification pass found a third defect in the same function, and it is real: **link-local is
`fe80::/10`, i.e. fe80 through febf**, but v3 tested `h.startsWith("fe80")`, which is only `fe80::/16`.
`fe90::1`, `fea0::1`, `feaf::dead:beef` and `febf::1` were all classified public.

v4 stops matching prefixes on the text form and parses the address instead (`v6Words` expands any RFC-4291
spelling to 8 numeric words; anything it cannot parse is refused). The classifier is then numeric ranges:
`fe80`–`febf` link-local, `fc00::/7` ULA, `ff00::/8` multicast, `::1` and `::` in any spelling, `::ffff:0:0/96`
v4-mapped (dotted or the hex form the WHATWG URL parser produces), `::a.b.c.d` v4-compatible, and `2002::/16`
6to4 plus `64:ff9b::/96` NAT64 resolved down to the IPv4 they embed. `%zone` suffixes are stripped in both
`ipIsPrivate` and `hostIsSafe`. No response field or other behaviour changed.

Evidence, `docs/audit-2026-09/tests/domain_check_v4_ip_cases.mjs` (30 cases, `node` exits 0). The file keeps v3
next to v4 so the regression is demonstrated rather than asserted — **v3 gets 8 of the 30 wrong**, every one of
them "public" when it is not:

| case | v3 | v4 |
|---|---|---|
| `fe90::1`, `fea0::1`, `feaf::dead:beef`, `febf::1` | public ✗ | private ✓ |
| `0:0:0:0:0:0:0:1`, `0:0:0:0:0:0:0:0` (uncompressed loopback / unspecified) | public ✗ | private ✓ |
| `2002:7f00:1::1` (6to4 → 127.0.0.1), `64:ff9b::7f00:1` (NAT64 → 127.0.0.1) | public ✗ | private ✓ |
| `fe7f::1`, `fec0::1`, `::ffff:8.8.8.8`, `2606:4700::1111` (negative controls) | public ✓ | public ✓ |

Live staging checks (`tests/edge_fn_live_checks_2026-09-06.sql`, domain-check slot 5): `fe90--1.sslip.io` and
`febf--1.sslip.io` → `refused: resolves to private address` (v3 let both through); `0--1.sslip.io`,
`169.254.169.254.nip.io` and `0-0-0-0-0-ffff-7f00-1.sslip.io` → refused; `loadboot.com` → 200 with the response
shape unchanged; and the control `2606-4700--1111.sslip.io` (public IPv6) → **not** refused, it reaches the
fetch and fails there. sslip.io writes `:` as `-`, so the v4-mapped host has to be spelled out in full —
`--ffff-7f00-1` is an invalid DNS label.

**Not on prod.** Prod's `domain-check` is still v2 and therefore carries all three defects: the bracket bypass,
the hex v4-mapped bypass and the fe80::/10 range bug. Awaiting Yaseen's explicit approval.

### F03 — closed as a decision, not a defect
Yaseen has decided the outreach engine stays **enabled**. No pause, no schedule change, nothing touched. The
finding stands as recorded context (daily cap 600, cron `0 13,15,17,19 * * *`), not as an open action.

## F14 — first confirmed instance: `public.retell_webhook` is callable by anyone holding the anon key (2026-09-06)

F14 was written as an inventory finding: 32 anon-executable SECURITY DEFINER advisories on prod, 35 on staging,
with the explicit warning that those totals are **not** leak counts and that blanket revocation would break
working RPCs. This is the first one worked end to end, and it shows both halves of that warning were right — it
is a real hole, **and** the obvious fix would have broken a live revenue path.

### The finding

`public.retell_webhook(jsonb)` is SECURITY DEFINER with EXECUTE granted to PUBLIC, `anon` and `authenticated` on
**both** environments. It takes a single **unnamed** parameter, which PostgREST exposes as a raw-body RPC, so it
is reachable over plain HTTP.

Two independent confirmations:
- Codex, on staging, with a rollback-only DB probe: an anonymous caller can insert a synthetic `call_started`
  row. All writes were rolled back by an exception; no real call data changed.
- Claude, on staging, over HTTP: `POST /rest/v1/rpc/retell_webhook` carrying **only the public anon key** →
  **HTTP 200** (pg_net req 193585). The response was `{"ok":true,"ignored":true}` solely because the probe used a
  deliberately non-matching phone number; the function's first gate compares `from_number`/`to_number` against
  `app_private.retell_config.from_number`, which is a **published** phone number.

Reachable impact with the real number: an `app_private.lc_calls` insert, and on a crafted `call_ended` /
`call_analyzed` payload — a `crm_contact`, a `crm_lead`, a `crm_activity`, an `automation_task` and staff
`notifications`. The anon key is present in every browser that loads the site.

### Why "REVOKE anon" is not the fix

That grant **is** the live provider chain: Retell posts the webhook straight at PostgREST with the anon key.
Prod evidence read this turn: **112 `app_private.lc_calls` rows, 65 of them in the last 30 days, and 8
`crm_leads` with `source='voice-call'`.** Revoking would stop inbound voice reaching CC and CRM with no error
anyone would see.

### Why the signature cannot be verified in Postgres

Retell signs `HMAC-SHA256(raw_body || timestamp, api_key)` and sends
`X-Retell-Signature: v=<unix_ms>,d=<hex>`. Its documentation is explicit that the **raw** body must be used,
because re-serialising JSON changes whitespace and key order. PostgREST hands a single-unnamed-jsonb-parameter
function **already-parsed** jsonb — the exact bytes are gone. Verification therefore has to happen in an edge
function, which is the only place the raw body still exists. This is a hard constraint, not a preference, and it
is what shapes the whole fix.

No secret was invented: the signer is the **existing** `app_private.retell_config.api_key`, populated on both
envs, and the design keeps it inside the database.

### The fix, built and tested on STAGING only

| piece | what it does |
|---|---|
| `bl_sec_0329_retell_webhook_signed_only` | adds `retell_config.allow_unsigned_webhook boolean not null default **TRUE**` and anchor-guards a guard into `retell_webhook` that returns LB403 only when the caller is not `service_role` **and** the flag is off. Default TRUE means applying it changes nothing. `app_private.bl_sec_0329_rollback()` restores the saved definition and drops the column |
| `bl_sec_0329b_retell_hook_verify` | `public.retell_hook_verify(raw, sig)` — service_role only, HMAC computed inside the DB, constant-length digest compare, 15-minute replay window, honest reasons (`api_key_not_configured`, `signature_header_unparsable`, `digest_mismatch`, `timestamp_outside_skew`, `signature_ok`) |
| `bl_sec_0329c_retell_hook_log` | `app_private.retell_hook_log` — verdict only. No payload, no phone number, no transcript. 30-day retention |
| `supabase/functions/retell-hook/index.ts` | reads the raw body once, asks the verifier, forwards as service_role. **Observe mode by default** |

Observe mode is deliberate: the signature format above is taken from Retell's documentation, not from a delivery
anyone here has seen. Observe forwards every delivery and records whether it verified, which is how the format
gets confirmed against real traffic before enforcement depends on it.

### Evidence (all run by Claude, on staging)

- `tests/bl_sec_0329_rollback_test.sql` → **RESULT PASS**, 3 cases: flag TRUE → anon still works and still writes
  (this is the case that proves applying the migration is a no-op); flag FALSE → anon **and** authenticated both
  LB403 with **0 rows written**; flag FALSE → `service_role` still reaches the body and writes.
- `tests/bl_sec_0329b_verify_test.sql` → **RESULT PASS**, 4 cases: a signature built with the **real configured
  api_key** verifies; a forged digest, a body altered by a single space, and a missing header all return
  `verified:false` with the correct reason; a 66-minute-old replay is refused; `anon` cannot call the verifier.
- **Live end-to-end, enforce mode on:** unsigned POST to `/functions/v1/retell-hook` → **401
  `{"error":"unauthorized","code":"LB401","reason":"signature_header_unparsable"}`**, nothing forwarded
  (req 193595). Correctly signed POST → **200 `{"verified":true,"enforce":true,"reason":"signature_ok",
  "forwarded":true,"upstream":{"ok":true}}`** (req 193596). Old PostgREST door with the anon key, flag off →
  **LB403** (req 193599).
- Staging then restored to observe mode and the three `bl0329-*` rows deleted — `lc_calls` back to 1 row.

### Cutover — three steps, and the order is load-bearing

1. deploy `retell-hook` to prod in **observe** mode (needs approval);
2. **Yaseen** repoints the Retell dashboard webhook at `.../functions/v1/retell-hook` and watches
   `app_private.retell_hook_log` verify real deliveries;
3. only then `update app_private.retell_config set allow_unsigned_webhook = false`.

Step 3 before step 2 silently stops inbound voice. Step 2 before step 1 loses calls. **Nothing is on prod.**

### What this says about the rest of F14

The method generalises: for each anon-executable SECURITY DEFINER routine, find the *real* caller first, work out
what it can actually prove about itself, and only then close the door — in that order. The 32/35 advisory totals
remain what they always were: a worklist, not a count of holes.

## M Usman Farooq — discrepancy resolved (2026-09-06)

Codex saw an expired `mc_authority` item and a delivered `lapsed:` message at 07:30 UTC; Claude's post-backfill
queries found 0 items expired and 0 emails from the collector. **Both were true — they were different jobs.**

- 2026-08-03 19:42 — item reviewed, `recheck_due` set to **2026-09-05** (a month before the collector existed).
- 2026-08-06 / 08-26 / 09-02 — three reminders, keys `reval:…:mc_authority:2026-09-05:warn30 / :early / :final`.
- 2026-09-06 **06:10:00.242** — `fmcsa_authority_collect` touches the org, records `no_docket` (no MC/DOT on
  file anywhere), **writes no onboarding item and sends no email**.
- 2026-09-06 **07:30:00.355** — `app_private.cron_packet_revalidation` expires the item, stamps `lapsed_at`,
  queues `lapsed:e7676569…:mc_authority:2026-09-05`; delivered 07:30:02.

`cron_packet_revalidation` is the only routine in the catalog that writes a `lapsed:` key; the collector's is
`authlapse:`. Different job, 80 minutes apart, driven by a due date set five weeks earlier. **F30 is not
implicated.** (This org is also one of the F33 no-docket cases, which is why the collector could do nothing.)

## F14 — second confirmed instance: `public.retell_inbound` is a caller-identity oracle (2026-09-06/07)

The first instance (`retell_webhook`) let an anonymous caller **write** a fake call event. This one lets them
**read people**, which is worse.

### The finding

On **prod**, `public.retell_inbound(jsonb)` is SECURITY DEFINER with EXECUTE granted to `anon` and
`authenticated`. It takes a single **unnamed** parameter, so PostgREST exposes it as a raw-body RPC. Its entire
purpose is to turn a phone number into who that person is, so a caller holding only the PUBLIC anon key can POST
any number and read back, branch by branch:

| branch | what comes back |
|---|---|
| `public.profiles` match | contact name, company, role, **MC**, **DOT**, equipment, truck count, lanes, home base, account status |
| `app_private.email_brokers` match | company, contact name, MC number |
| `app_private.form_submissions` match | name, company, form key, and the **first 400 characters of what they wrote** |
| no match | a NEW CALLER default — which still confirms the number is *not* known |

The only gate is `to_number == retell_config.from_number`, and that number is published on the site. Numbers can
be tried one after another, so this is an enumeration oracle, not an incidental leak.

### Environment drift, stated rather than papered over

**`public.retell_inbound` does not exist on staging.** It is prod-only. The staging work therefore does **not**
port the vulnerable function here — doing so would replicate the hole in order to test a fix for it. Only the
service-only replacement was created.

### The fix, on STAGING only

| piece | detail |
|---|---|
| `bl_sec_0330_retell_inbound_verified` | `public.retell_inbound_verified(jsonb)` — prod's body verbatim plus one caller check. Grants verified: `postgres:EXECUTE`, `service_role:EXECUTE`. No PUBLIC, no anon, no authenticated |
| `bl_sec_0330b_..._strict_guard` | removes a broken escape hatch (see below) |
| `bl_sec_0330c_claims_empty_string_safe` | an empty claims GUC now refuses cleanly instead of raising 22P02 |
| `supabase/functions/retell-inbound-hook` v1 | `verify_jwt=false`, `ezbr_sha256 ce940e1ca8c20399e35fba352077e48a386d7d73189d26b2c32acba4b393ac3d`. Reads the raw body, verifies via `retell_hook_verify`, calls **only** the service-only RPC, returns Retell's `{"call_inbound": …}` envelope unchanged. **No observe mode**: this endpoint hands out personal data, so there is no forward-anyway path |
| rollback | `select app_private.bl_sec_0330_rollback();` |

**Equivalence proven, not asserted.** Prod's `pg_get_functiondef`, with the guard block inserted after the single
`begin\n` and the name changed, hashes to **`9117e4e456e16e346dd7886b6f56c1e0`** — byte-identical to what staging
returned for the function `bl_sec_0330` created. (0330b/0330c then altered the guard line only; current staging
md5 `7aec5c56eb74702bb92aa3772098ee8e`.)

### Evidence

`tests/bl_sec_0330_rollback_test.sql` → **RESULT PASS**, 4 cases: `anon` / `authenticated` / empty-claims all
refused with the empty `{"call_inbound":{}}` envelope and `LB403` (a refusal cannot even reveal whether the
number is known); the four cheap contract branches match prod; the website-form branch returns the caller's own
words; and the broker branch still takes **precedence** over a form submission for the same number.

`tests/retell_inbound_hook_live_checks.sql`, live against the deployed function — i1 valid signature **200** with
the full envelope (req 194834); i2 forged digest **401** `digest_mismatch` (194835); i3 missing header **401**
`signature_header_unparsable` (194836); i4 stale-by-66-minutes **401** `timestamp_outside_skew` (194837); i5
valid signature over a different body **401** `digest_mismatch` (194838); i6 verifier unable to answer **503**
`verifier_verdict_incomplete` (194841). Every refusal returns the EMPTY envelope.

i6 was produced by copying `retell_config.api_key` into a scratch table, setting it NULL, firing the request,
then restoring from the copy and dropping the scratch table — verified afterwards: key restored, scratch table
gone. **Do not run i6 on prod.**

**Privacy check:** `app_private.retell_hook_log` was queried after the runs — it holds verdict, reason and event
name only, and **zero rows contain a phone number**.

**Not covered live:** the `body_not_json` → 400 branch. `pg_net`'s `http_post` accepts only a jsonb body, so a
non-JSON raw body cannot be produced from Postgres. Code inspection only — **UNKNOWN** until exercised by a
client that can post arbitrary bytes.

### Two bugs the test caught in the guard — worth recording because both are general

1. **A guard that could never fire.** `bl_sec_0330` had `and current_user not in ('postgres','service_role')` as
   an escape hatch for internal callers. Inside a SECURITY DEFINER function `current_user` is the **function
   owner**, so that clause was true for every caller. The rollback test's first case caught it: `anon` got the
   full NEW CALLER payload instead of `LB403`. `0330b` removes the hatch — the verified JWT claim is now the only
   thing that decides, which is safe because the edge function reaches the RPC through PostgREST with the service
   key.
2. **An empty claims GUC raised instead of refusing.** `current_setting('request.jwt.claims', true)::jsonb`
   throws 22P02 on an empty string. Still fail-closed, but a 500 carrying a Postgres error string is a worse
   answer than a clean refusal. `0330c` wraps it in `nullif(...,'')`.

And a third, for every anchor-guarded patch in this audit: **count anchors with a literal string count, not
`regexp_matches`.** `0330c`'s first attempt reported "anchor found 0 times" for an anchor plainly present,
because `(` and `)` in `current_setting(...)` are regex metacharacters. It failed safe — a pattern that silently
matched the *wrong* text would not have.

### Cutover — Yaseen's, and the order is load-bearing

1. deploy `retell-inbound-hook` + `bl_sec_0330/b/c` to prod;
2. **Yaseen** repoints the Retell **phone-number inbound** webhook at `.../functions/v1/retell-inbound-hook` and
   a real signed delivery is observed verifying in `retell_hook_log`;
3. only then may revoking `anon`/`authenticated` on `public.retell_inbound` be **proposed**.

Step 3 before step 2 removes the personalised greeting from every inbound call. Nothing is on prod: the prod
function and its anon grant are exactly as they were.

### What the two instances say about the remaining F14 worklist

Both followed the same shape: **an unnamed single-parameter SECURITY DEFINER function, reachable through
PostgREST with the anon key, standing in for an external provider that cannot send a Supabase JWT.** That
signature — not the raw advisory count — is what the remaining ~30 should be triaged against first.

## PRODUCTION deploy of the three signed-endpoint changes (2026-09-07)

Approved by Yaseen. All three landed; **nothing was revoked and nothing was switched to enforce.** Prod is now
in a state where the old doors still work and the new signed doors also work — which is exactly the state a
cutover needs before the provider is repointed.

| item | prod | hash |
|---|---|---|
| `domain-check` v5 | slot 3 | `9a2e429dd11263e323b79bdabe270205150ed5c691ab5089caa9531abdc3de67` |
| `retell-hook` v2 | slot 1, `verify_jwt=false` | `1b0fbaa94a68d4f1922216e3bef1ee0f41832d75018f3414b2f487b8928fd0dd` |
| `retell-inbound-hook` v1 | slot 1, `verify_jwt=false` | `c45b322eff1cfa1cc3d5b89c4a4275d1ad86a889d05585fc72affe1f4468e160` |
| migrations | `bl_sec_0329`, `0329b`, `0329c`, `bl_sec_0330` | |

### F02 — closed on prod

Live checks: `loadboot.com` → 200 with the response shape unchanged (req 195107); `0--1.sslip.io`,
`169.254.169.254.nip.io`, `fe90--1.sslip.io`, `febf--1.sslip.io` and `0-0-0-0-0-ffff-7f00-1.sslip.io` all
`refused: resolves to private address` (195108–195112); and the control `2606-4700--1111.sslip.io` (public
IPv6) **not** refused — it reached the network and failed on a TLS handshake (195113). The bracket bypass, the
hex v4-mapped bypass and the fe80::/10 range bug are all closed on production.

### F14 first instance — guarded on prod, switch still OFF

`bl_sec_0329/b/c` applied with `allow_unsigned_webhook = TRUE`, so the guard is inert and the live Retell chain
is untouched. One rollback-txn block returned **RESULT PASS** on four counts: flag TRUE → anon still works and
still writes (the apply is a no-op); flag FALSE → anon **and** authenticated both LB403 with **0 rows written**;
flag FALSE → service_role still reaches the body; and the verifier, tested against the **real prod api_key** —
a correctly signed body verifies, a forged digest and a body altered by one space are rejected, `anon` gets
LB403.

The whole signed path was then proven on prod **without writing anything**: a correctly signed `call_started`
whose from/to numbers deliberately do not match `retell_config.from_number` returned
`{"ok":true,"verified":true,"enforce":false,"reason":"signature_ok","forwarded":true,"upstream":{"ok":true,"ignored":true}}`
(req 195128).

### F14 second instance — twin live on prod, original untouched

`bl_sec_0330` was built on prod **from prod's own live definition**, not from a pasted copy. Verification:
prod's `pg_get_functiondef(retell_inbound)` + the guard inserted after the single `begin\n` + the rename hashes
to `43b69a2488ac4a99661bd74ad82f46f9`, and the created function hashes to the same value — **byte_identical =
true**. Grants on the twin: `postgres:EXECUTE, service_role:EXECUTE`. Grants on `public.retell_inbound`:
**unchanged** at `postgres, anon, authenticated, service_role`.

Rollback test on prod → **RESULT PASS**, 4 cases. Live checks against the deployed hook: q1 valid signature
**200** with the full envelope (195120); q2 forged digest **401** (195121); q3 missing header **401** (195122);
q4 stale by 66 minutes **401** (195123); q5 valid signature over a different body **401** (195124). Every
refusal returns the empty `{"call_inbound":{}}` envelope.

### Prod hygiene after the run

`app_private.lc_calls` = **112**, unchanged. **Zero** `bl0329-*` or `prodchain*` rows left behind.
`allow_unsigned_webhook` still TRUE. `app_private.retell_hook_log` holds 6 verdict rows and **no phone numbers,
no bodies, no context**.

### The two switches that are still off, and what turns them on

1. Yaseen repoints, in the Retell dashboard:
   - the call webhook → `https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/retell-hook`
   - the phone number's inbound-call webhook → `https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/retell-inbound-hook`
2. Real deliveries are watched in `app_private.retell_hook_log` until they show `verified=true, reason='signature_ok'`.
3. Then, separately and reversibly: `update app_private.retell_config set allow_unsigned_webhook = false;` and,
   as a proposal, revoking `anon`/`authenticated` on `public.retell_inbound`.

Rollbacks stay available throughout: `select app_private.bl_sec_0329_rollback();` and
`select app_private.bl_sec_0330_rollback();`

## F34 (new, P3 latent) — the live-chat visitor key was a bearer secret guarded to two different standards

Found while sweeping the rest of F14 on 2026-09-07.

### The sweep first, because it bounds the problem
The exact shape both F14 instances had — **SECURITY DEFINER, granted to anon, single UNNAMED parameter** (which
is what makes PostgREST expose it as a raw-body RPC) — was queried across the whole prod catalog. It returns
**exactly two functions: `retell_webhook` and `retell_inbound`**, both already handled. That shape is exhausted.

Widening to *all* anon-executable SECURITY DEFINER functions gives **33**. Most are public by design (the load
board, market rates, announcements, feature flags, web forms, tracking) or gated by an unguessable uuid token
(`lb_email_claim_get`, `lb_email_ping_get`, `partner_claim_get`, `partner_agent_confirm*`, `outreach_unsubscribe`,
`eld_ingest`). The interesting group is the live-chat family, which is gated not by a token but by a
**visitor key the browser mints for itself**.

### The finding

That key is a bearer secret — present it and you get that visitor's data:

| function | returns | key check |
|---|---|---|
| `lc_history(p_visitor_key)` | last 10 conversations + first-message previews | length **16–64** |
| `lc_ob_get(p_visitor_key)` | onboarding record: role, step, free-form `data`, `docs`, **`account_email`** | length **≥ 8** |

Eight characters is not a secret, and the weaker guard sits on the more personal record.

The key itself was also weaker than it looked. `build_site.py` minted it with `Math.random()`, and the
storage-failure path returned:

```
'novkey' + Date.now().toString(36) + 'xxxxxxxx'
```

which is **fully predictable from the clock** — no randomness at all. A browser with localStorage blocked
(private windows, some corporate policies) got that key, and anyone who knew roughly when that visitor used the
site could enumerate it and read their chat history and onboarding record.

### Evidence that this is latent, not an incident

Prod, read-only, 2026-09-07: **67 `lc_conversations` and 1 `lc_onboarding` row; ZERO with a `novkey` prefix; the
shortest `visitor_key` in use is 26 characters.** The predictable path has never been taken in production. That
is why this is filed P3 latent rather than as an exposure — and it is also why raising the floor locks out
nobody who exists today.

### The fix (staging, plus the site change)

- `bl_sec_0334` — `lc_ob_get`'s floor goes 8 → **16–64**, matching `lc_history`, and the `novkey` prefix is
  refused outright so a key minted by the old fallback can never be replayed. Nothing else about the function
  changes. **Staging applied; prod not applied.**
- `build_site.py` — the key now comes from `crypto.getRandomValues` (24 bytes → 192 bits, hex, 49 chars) and the
  storage-failure path **stays random** instead of falling back to a fixed pattern. Verified: 49 chars (inside
  the 16–64 window), charset `v[0-9a-f]{48}`, 5000 generated keys all unique.
- `tests/bl_sec_0334_rollback_test.sql` → **RESULT PASS**, 4 cases. Case 1 is deliberately first: a real,
  properly-minted key must still work — a guard that locks out the people it protects is not a fix.

### What is NOT changed, and why
`lc_history`'s own 16–64 floor was already correct and is untouched. The other live-chat functions
(`lc_send`, `lc_poll`, `lc_rate`, `lc_ob_save`, `lc_start`) take the same key but write rather than read a
profile; they were not part of this change and have not been reviewed against this standard yet — that is the
next slice of F14, and it is open.
