# Audit handoff for ChatGPT / Codex — 22 Sep 2026 (written by Claude on Yaseen's instruction)

**Yaseen's instruction (22 Sep):** everything you (ChatGPT/Codex) ever built for this audit must end up in the repo,
on `main`, committed and pushed. Then the remaining audit items get fixed to 100% — staging first, then prod on his standing
approval ("fix karte jao, prod par apply bhi"), except: permanent deletes, real messages/emails to carriers/brokers, and provider
settings, which still need his explicit yes each time. He sends every carrier/broker-facing message himself.

## 1. Your work — what is in the repo/prod and what is not (checked 22 Sep by function-body hash and git)
| Package (yours) | Repo `main` | Prod | Note |
|---|---|---|---|
| Sprint 1+2 (F01/F02/F05/F07/F18, domain-check v5, load-mail v9) | yes | yes | |
| F30/F31/F32 (bl_cmp_0324/0325/0326, bl_fin_0322) | yes | yes | |
| F31 client verdict persistence (api.js aiVerdict insert) | yes (reconstructed 12 Sep) | n/a | |
| Account deletion 0339/0341 + atomic cleanup, outreach suppression, unsubscribe entrypoints, erasure inventory gate | yes | yes (promoted 15 Sep under names audit_marketing_optout_promotion / audit_erasure_guard_promotion) | body hashes identical staging=prod |
| 4 session guards (payment/payout/staff-finance/agent-review) | yes | yes | |
| Dispatcher-test ACL narrowing, reports recovery | yes | yes (13 Sep) | |
| bl_sec_0335/0336/0344 (live-chat boundaries, save limit) | yes | yes (19 Sep) | |
| bl_audit_0338 agent payout parity | yes | yes | |
| **bl_audit_0342 account-request RPCs, bl_audit_0343 compliance contracts** | yes (files) | **NO** | Both files say "STAGING ONLY — restore missing RPCs" (staging-parity repairs). 4 + 6 function bodies DIFFER on prod. **Decide and record: is prod's version the intended one? If yes, mark the files staging-only for good; if no, promote with a rollback-txn test.** |
| Branches `origin/audit/review-domain-v4-20260906`, `origin/audit/s1-s2-verification-20260906`, `origin/audit/s2-f31-client-verdict` | NOT merged (6 Sep, 1–2 commits each, docs + the F31 fix that was later reconstructed) | — | Diff them against `main`; merge anything still missing (docs only, most likely), then delete the branches so nobody works from them. |
Nothing of yours is missing from the repo except possibly doc text on those three branches. Your test files under
`docs/audit-2026-09/tests/` are all on `main`.

## 2. Claude's work since 19 Sep — all on `origin/main`, all LIVE on staging AND prod
bl_audit_0352 reconcile report · 0353 relink · 0354 remove-candidates + edge `lc-doc-purge` (nothing deleted yet) · lc-doc-check v12
(cleanup at source) · 0355 erasure inventory finds guest chat uploads + Storage prefix · 0356 upload freeze while a deletion request
is open · 0357 session/refresh-token revoke on completed deletion · 0358 (22 Sep) dropped the blanket Storage policy
`staff read documents` (F10) · 0359/0361/0362 (F25: FK indexes, RLS initplan, dup indexes) · 0360 anon drift fix · 0363 (F14: search_path
pinned on every invoker function) · 0364 (deletion clears push/device/notification/preference/emergency-contact rows + chat contact data).
Parity check 22 Sep: bl_audit_0352…0364 present on BOTH staging and prod; anon SECDEF names unchanged (staging 32 / prod 33).
Tests: `tests/bl_audit_035x_rollback_test.sql`, `tests/lc_doc_purge_contract_test.mjs`, `tests/lc_doc_check_contract_test.mjs`.
Rollbacks: `ROLLBACK-*-2026-09-20.sql`, `ROLLBACK-STORAGE-STAFF-2026-09-22.sql`. **Order rule:** your two erasure rollbacks
(13/15 Sep) check OLD hashes of `capture_account_erasure_inventory` / `cc_account_deletion_process` — run Claude's 0355/0357
rollbacks first if those are ever needed.

## 3. Finding-by-finding status (F01–F33) — what is still open
CLOSED on prod: F01, F02, F05, F06 (RPC drift, 0322), F07, F08, F09, F10, F14 (retell + lc key floors + search_path pins), F18, F25,
F30, F31, F32, F33 (recorded), F34, F36, plus the erasure slices above.
OPEN — needs a decision from Yaseen (do not guess): F04 (broker vs direct wording), F12 (5% fee wording vs agreement), F13 (marketing
promises vs zero loads), F15 (leaked-password protection is a **Supabase dashboard toggle**: Auth → Providers → Email → "Prevent use
of leaked passwords" — Yaseen must flip it; also set OTP expiry ≤ 1h), retention periods (`RETENTION-PROPOSAL-2026-09-20.md`),
F17 (capacity).
OPEN — technical (the DB ones are Claude's, the frontend/measurement ones are yours — see WORK-SPLIT):
- NEW (yours, 22 Sep): CC "Account deletion review" screen on the live RPCs `cc_erasure_items(request_id)` (items + per-item
  suggestion + `classes`), `cc_erasure_decide(request_id,item_key,'remove'|'hold',class,retain_until,note)`, edge `erasure-purge`
  (POST {request_id, dry_run}) then `cc_account_deletion_process(id,'complete')`. Dry-run button first, real purge behind a confirm.
  Both RPCs/edge are LIVE on staging AND prod; build against staging.
  22 Sep addendum (bl_audit_0368, live both envs): a file can appear twice in `items` (source 'documents' and source 'storage',
  same bucket+path). Deciding EITHER now decides both (`cc_erasure_decide` returns `applied_to`), so group rows by bucket+path in
  the screen and show one decision per file. Also: the carrier Documents page shows Upload buttons with NO frozen message while a
  deletion request is open (verified on prod 22 Sep: uploads get a raw 403) — your frozen-user message item covers this page too.
- F25: DONE 22 Sep by Claude (0359/0361/0362 on both envs). Re-run the performance advisor once and record the residual list.
- Anon-surface rule for YOUR new functions: Postgres grants EXECUTE to PUBLIC by default — every new RPC needs an explicit
  `revoke all ... from public, anon` unless it is meant for guests (the SMS-consent lane tripped this on staging; fixed by 0360).
- Erasure: real Storage removal with per-file evidence (pattern = `lc-doc-purge`), blocked on retention decision; frozen-user UI
  message in the carrier Documents page and chat ("uploads paused while your deletion request is open"); deletion-flow browser
  check with a throwaway account (Yaseen logs in).
- Item-5 signed-in chat upload: the website never passes `getToken` to the wizard — either accept N/A or wire it in build_site.py.
- Retell real-signature proof: needs a real inbound call once Retell credit is topped up (Yaseen); until then observe mode stays.
- F19/F20 (bundle size, Lighthouse), F21–F23 (SEO/analytics), F24 (cron load), F26 (status page independence), F27 (style literals):
  measure-and-report items; F22 stays out of this lane (SEO).
- Prod test residue to remove by hand (Yaseen, Storage UI): 3 July probes under `lc-onboarding/debugtest/` and
  `lc-onboarding/lbtest_visitor_001/`, plus Claude's 20 Sep "ZZ TEST" guest chat (conversation b31e5c21…, 1 ob row, 2 objects) —
  or run `lc-doc-purge` from a logged-in CC session after the 7-day window (dry-run first).

## 4. Hard rules (unchanged)
Staging first; prod only per Yaseen's standing approval and never for deletes/messages/provider settings. Never test on prod with
real accounts. Every DB change = migration file + rollback-txn test + rollback SQL. Anon SECURITY DEFINER NAMES must be unchanged
after every apply (baseline `anon-secdef-baseline.md`). Append one LOG line to `HANDOFF.md` per turn. If this file and the DB
disagree, the DB wins — fix the file.
