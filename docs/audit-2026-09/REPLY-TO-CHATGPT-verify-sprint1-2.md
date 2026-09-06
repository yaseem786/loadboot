# Paste this to ChatGPT (its limit reset, 5 Sep ~23:00 UTC)

---

Continue. A lot happened while you were out — **do not rebuild any of it, your job this turn is to VERIFY it.**

While you were at your limit I told Claude "go and complete all", and Sprint 1 plus Sprint 2 items 1–3 are now **applied to PROD**. Every one went staging-first, with a rollback-transaction test, then prod, with the same test re-run there. What is live on prod right now:

| Item | What landed | Prod evidence |
|---|---|---|
| F32 | `bl_fin_0322_port_trip_pnl_engine` | test PASS (trip `55a9c732…`, net 1450→1560); the 6 carrier Earnings/P&L RPCs now exist on prod |
| F30 | `bl_cmp_0324_carrier_fmcsa_collector` + a real backfill | **22 carriers now FMCSA-checked (13 active, 3 inactive, 1 not-in-index), 21 `carrier_verifications` rows `source='auto' status='pending_review'`, 21 `carrier_safety` rows. It was 0 of 44 before.** |
| F31 | `bl_cmp_0325_doc_ai_verdict` + `bl_cmp_0325b_cc_list_documents_ai_verdict`, plus `app/shared/api.js`, `app/carrier/app.js` (4 call sites), `app/command-center/views/documents.js`, edge fn `doc-precheck` **v5** (source now in the repo + server-side PDF forensics) | test PASS; stamp trigger live; `doc_set_ai_verdict` is write-once; anon lost every grant on `public.documents` |
| F01 | edge fn `load-mail` **v8** deployed FIRST, then `bl_sec_0320_email_ingest_service_only` | test PASS: authenticated→LB403, anon→LB403, service_role reaches the body, 0 rows written by refused callers |
| F02 | edge fn `domain-check` **v2** with `verify_jwt=true` | real caller → 200 full result; forged JWT → 401 at the gateway; `169.254.169.254.nip.io` → `refused: resolves to private address` |
| F05 | `bl_bp_0321_agent_confirm_resend_idem` | test PASS: 2 sends → 2 deliveries with 2 DISTINCT idempotency keys, 2 codes, exactly 1 live |

Prod's newest migration is `bl_bp_0321_agent_confirm_resend_idem`; the six audit migrations above sit under it on both envs. Every test now lives in `docs/audit-2026-09/tests/`.

Do exactly this, in order:

1. **Re-sync header first** (main sha + new commits, `list_migrations` prod + staging, `list_edge_functions` both, changed files). If what you see differs from the table above, stop and tell me before touching anything.
2. **Read `docs/audit-2026-09/HANDOFF.md` in full** — CURRENT STATE has the per-item evidence, the three schema traps the tests caught, and the new finding F33.
3. **Verification pass — this is the whole turn.** For each of F30/F31/F01/F02/F05/F32: read the migration file in `migrations/` against what is actually in the prod catalog (`pg_get_functiondef`), then re-run that item's test from `docs/audit-2026-09/tests/` **on prod** and confirm the numbers. Specifically worth a hard look, because these are where a real regression would hide:
   - `fmcsa_authority_collect()` — the broker path must be **byte-for-byte the old behaviour** (onboarding item expired → org paused → owner emailed). Only the carrier branch is new, and a carrier must never be paused or emailed. Confirm no broker was touched by today's backfill.
   - `bl_sec_0320`'s guard sits inside three functions whose bodies differ between envs — check the guard is the ONLY change on prod, and that `load-mail` v8 is really the deployed slot (it is slot v6 on prod).
   - `bl_cmp_0325b` DROPped and re-CREATEd `cc_list_documents` (return type changed). Confirm grants are exactly `postgres, authenticated, service_role` and nothing else lost EXECUTE.
   - `doc-precheck` v5's PDF forensics must never flip a verdict to `reject` on its own — only `pass → warning`.
   Write the result as a dated "Sprint 1+2 verification" section in `PHASE1-AUDIT.md`. **"No findings" is a valid and welcome result.** Anything that fails: roll it back with that item's `*_rollback()` helper, log it in HANDOFF, and tell me — do not try to fix it silently.
4. **Then, and only then**, the SEO week-1 copy work from the re-ranked table in `90-DAY-PLAN.md` (it was re-ranked against a live Search Console pull on 5 Sep: 60 clicks / 5,224 impressions / avg position 35.8, and every one of the 454 named non-brand queries has zero clicks — so this is a position-and-snippet problem, not a topics problem). Week 1 = `market-rates.html` (meta description naming the equipment hubs, first-screen links to all 8 hubs, an answer-first FTL/truckload-rates section — **do NOT retitle that page**), a definition-first opener on `tonu-policy.html`, a snippet fix on `ghost-loads-load-board-problems.html`. Build staging-bound: since F07, `python build_site.py` refuses without `LOADBOOT_STAGING_ANON_KEY`.
5. Do not start F33 (27 carriers with no docket on file) or the WhatsApp toggle without my go-ahead — design text only.

Standing rules, unchanged: re-read latest `main` + both Supabase migration lists on **every** prompt (Claude and you run in parallel and other lanes push too); staging before prod, always with a rollback-txn test; I send every carrier- and broker-facing message myself. Before you stop: rewrite CURRENT STATE, set NEXT ACTION, append your LOG line — **write the LOG line first if you feel a limit coming**, that is the one thing that must not be lost again.
