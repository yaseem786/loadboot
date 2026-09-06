# Paste this to ChatGPT / Codex — "what is still left in the audit"

---

Full ledger of the Phase-1 audit, 6 Sep 2026. 33 findings. **9 are closed, 1 is half-closed, 23 are still open.** Nothing below is a new plan — it is the same list from `PHASE1-AUDIT.md`, sorted by what is actually left.

## CLOSED — live on prod, staging-first, each with a rollback-txn test re-run on prod

| # | What landed |
|---|---|
| F01 | `bl_sec_0320_email_ingest_service_only` + `load-mail` **v9** (prod slot 7). anon/authenticated → LB403; verified live on prod. |
| F05 | `bl_bp_0321_agent_confirm_resend_idem` — 2 sends → 2 distinct idempotency keys, exactly 1 live code. |
| F07 | `build_site.py` fails closed without `LOADBOOT_STAGING_ANON_KEY`; local dev is staging-bound. |
| F18 | `check_imports.py` dynamic-import fix, `package.json` scripts repaired, `pr-checks.yml` written (still parked in `docs/`, not `.github/workflows/`). |
| F30 | `bl_cmp_0324_carrier_fmcsa_collector` + real backfill: **22 of 44 carriers checked, 21 `carrier_verifications(source='auto',status='pending_review')`, 21 `carrier_safety` rows — was 0.** |
| F30-fix | `bl_cmp_0326_broker_precedence_fix` — the broker regression 0324 introduced. Prod test PASS on all 3 cases incl. the lapsed-broker leg staging cannot run. |
| F31 (DB) | `bl_cmp_0325` + `bl_cmp_0325b` — stamp trigger, write-once `doc_set_ai_verdict`, anon lost all grants on `public.documents`, `cc_list_documents` returns `ai_verdict`. Plus `doc-precheck` **v5** (source in repo + advisory PDF forensics). |
| F32 | `bl_fin_0322_port_trip_pnl_engine` — the 6 carrier Earnings/P&L RPCs prod was missing. **Still needs a UI smoke on the carrier Earnings screen.** |
| F29 | Confirmed `lb-tmp-keyread` is a dead 410 stub — recorded; deletion still needs Yaseen's word. |

## HALF-CLOSED — this is the one thing blocking "corrective round done"

- **F02** — `domain-check` v2 with `verify_jwt=true` is on prod. **v3 is NOT.** v3 fixes two SSRF bypasses: `new URL("http://[::1]/").hostname` keeps the brackets (so no IPv6 literal ever matched), and `::ffff:127.0.0.1` normalises to `::ffff:7f00:1` (so the v4-mapped branch missed it too). Deployed + verified on staging, slot 4, 14 unit cases. **Prod still carries both bypasses.** Waiting on Yaseen.
- **F31 (client)** — Codex branch `audit/s2-f31-client-verdict` @ `1259d12b` off main `7dc83e4`. Not merged, not deployed, live upload → DB → CC path still UNKNOWN.

## OPEN — P0 / P1, in the order I would take them

1. **F03 (P0, decision gate)** — the outreach engine is LIVE: `outreach_state.enabled=true`, daily cap 600, cron `0 13,15,17,19 * * *`, `outreach_run_daily` calls `sys_email`. **This directly contradicts Yaseen's standing rule that he sends every carrier- and broker-facing message himself.** Nobody has asked him whether to pause it. Proposal is a reversible pause + a draft-only approval queue; he sends. This is the highest-value open item and it is a question, not code.
2. **F04 (P0, legal gate)** — homepage/`build_site.py` copy says direct shipper↔carrier, no broker markup, while the newer shipper UI says brokers quote. Needs counsel to map who the licensed counterparty is per transaction. No conclusion that anything unlawful is happening — it is a copy/contract mismatch that only Yaseen + a lawyer can close.
3. **F10 (P1)** — prod storage policy `staff read documents` gives EVERY active staff account read on W-9 / identity documents; policies OR together. Needs a role-by-document-type matrix, reversible migration.
4. **F14 (P1)** — 32 anon-executable SECURITY DEFINER advisories on prod (35 staging), 75 mutable-search-path functions. These are advisories, **not** 32 leaks. Needs a per-signature allowlist review, staged in batches with positive AND negative contract tests. Large.
5. **F15 (P1)** — leaked-password protection is off in Auth settings. Small, needs Yaseen to check the plan.
6. **F06 (P1)** — RPC drift beyond F32: prod still lacks 2 CC ones (`cc_outreach_audience`, `cc_outreach_log_page`, = `bl_out_0308`, staging-only pending Yaseen's OK); staging lacks 15. Do NOT bulk-copy — compare signatures first.
7. **F08 / F09 (P1)** — service-worker `skipWaiting` can reload a half-filled form or an in-progress e-sign; `lb-share-inbox` survives sign-out on a shared device. Both are real data-loss/privacy shapes, both small-to-medium.
8. **F11 / F12 / F13 (P1)** — trust and fee copy: domain+MX is labelled as business confirmation; the 5% fee wording differs between `dispatch-agreement.js` and `build_site.py`; the homepage promises "zero ghost loads" while prod has zero non-demo available loads. All three are copy Yaseen must approve, not code we can just ship.
9. **F16 / F17 (P1)** — 6-step carrier wizard with duplicate entry points; and the supply problem underneath everything: **zero non-demo available loads.**

## OPEN — P2 / P3 (measurement and cleanup, nothing urgent)

F19 (23.4 MB preview output, a 2 MB hero PNG), F20 (Lighthouse/field LCP-CLS-INP still UNKNOWN — never measured), F21 (do NOT spend a sprint on FAQ schema; Google dropped FAQ rich results in May 2026), F22 (content cadence: one substantial publish weekly, not 3–4), F23 (attribution: extend the existing events, do not add a second tracking stack), F24 (40 active prod crons vs a $0 automation budget — measure first), F25 (53 unindexed FKs prod / 58 staging; do NOT "fix" the 94 no-policy private tables by granting access), F26 (no rehearsed restore runbook), F27 (9,672 style literals are candidates, not violations), F28 (6 CC compatibility stubs — keep), F33 below.

## NEW since the audit was written

- **F33 (P2)** — **27 of 44 prod carriers have no MC or USDOT anywhere** (`organizations`, `carrier_safety`, `profiles`, onboarding refs) → `authority_status='no_docket'`, so the daily FMCSA poll will skip them for ever. Many are test junk (`Ahmed`, `thomas`, `Carrier Account`, `Rachel_0307` ×2, `Loadboot`) but real-looking ones are in there too: GCA LOGISTICS LLC, JB Hauling LLC, MEDO ENTERPRISE LLC, KST3 enterprise LLc, JayLena Recycling, Primo Liquidation LLC, Pillars Connections. Fix = CC "no docket" badge + write MC/DOT to the org at signup (it currently lands only on the profile) + a triage list for Yaseen. **Design text only until he says go.** It also means "44 active carriers" is an inflated number.
- **Unreconciled, cause UNKNOWN** — Codex saw "M Usman Farooq (Agent)" pending with an expired authority item at 07:30 UTC 6 Sep; my post-backfill queries found 0 items expired, 0 emails, and both brokers the dispatch reached returned `no_docket`. Read that org's `org_onboarding_items` rows with timestamps before anyone blames the collector.

## Yaseen's own queue (not ours)

commit + push the working tree; merge Codex's two branches (`audit/s1-s2-verification-20260906` @ `9585231e`, `audit/s2-f31-client-verdict` @ `1259d12b`); move `docs/audit-2026-09/pr-checks.yml` → `.github/workflows/`; smoke the carrier Earnings screen + the CC Documents queue; say yes/no on domain-check v3 to prod, on live check 5 (it ingests a real test-sender row), and on deleting `lb-tmp-keyread`.

SEO week 1 stays parked until the corrective round is fully closed — that means F02 v3 on prod.
