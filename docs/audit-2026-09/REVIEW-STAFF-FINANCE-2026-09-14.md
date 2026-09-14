# Staff finance sessions and payout amount integrity — 14 September 2026

Applied with Yaseen's standing September 14 authorization to continue tested production fixes. Local working branch remains feat/dispatcher-model; no public push or main merge.

## Outcome

`audit_staff_finance_session_guard` applied staging **20260914120308**, then production **20260914120413**. Adds the existing private current-session guard to five staff endpoints:

- cc_carrier_payment_profile(uuid)
- cc_payment_profiles_queue(text)
- cc_verify_payment_profile(uuid,boolean,text)
- cc_referral_payout_queue(text)
- cc_referral_payout_decide(uuid,text,text)

Existing finance.view / finance.approve authorization remains enforced, including view-only versus approver separation. The shared guard rejects missing/malformed/removed/expired/foreign sessions, bans/deletion/completed erasure and non-user service claims. No public endpoint, grant or broad RBAC helper was added or changed.

## Additional accounting bug confirmed and fixed

The original decision function marked every currently payable commission paid. In a synthetic rollback baseline, an approved $120 request marked $145 of ledger entries paid after another $25 became payable. The same baseline showed banned staff could read the synthetic bank profile and execute that mutation without a current session. No real transfer or customer account was used.

The paid branch now locks the current payable commission rows in ID order, captures their IDs and sum, and requires that sum to equal the approved request amount. A changed balance raises 22023 before any ledger/request mutation. The update targets only the captured IDs; later incoming commissions are not part of that update. NULL actions are rejected explicitly before the decision branches. Existing row locking on the request, self-approval refusal, approval/rejection flows, notifications, audit logging and recorded-only transfer semantics remain.

A mismatch requires staff review/reconciliation; the function does not guess which extra commissions belong to an old request or silently alter the amount. Do not automatically reject/recreate a request if an actual transfer has already happened. No actual payment rail was invoked by this change.

## Verification

- Baseline: banned staff read/mutation and $120/$145 accounting discrepancy reproduced with four assertions plus the baseline-source guard, all rolled back.
- Candidate and deployed staging suites PASS: session refusal cases across all five endpoints; suspended/denied staff; legitimate view-only reads with approvals refused; bank approval and reason-required revocation; NULL/invalid state/self-approval/repeated-paid refusal; valid approve/reject/paid flows; larger/smaller balance mismatch leaves ledger/request unchanged; exact-match payment updates only the selected commission and preserves accrued entries.
- Positive queue controls use the actual queue function bodies with ONLY their table references temporarily mapped to synthetic fixture tables. This avoids reading real customer queues. Original deployed queue sources restored before rollback; no modified test body is deployed.
- Exact-source rollback/reapply rehearsal on staging PASS. Production 15 missing-session role refusals PASS without writing account, bank or payout rows. All five deployed source hashes and grants match staging.
- Exact anonymous name/argument inventories unchanged: staging32 / production33. Full advisor finding identities unchanged in both environments. Zero synthetic users/organizations remain.
- No browser/Auth HTTP or multiple-connection concurrency verification was performed. SQL row-lock behavior and captured-ID update are implemented; no claim of a measured concurrency stress test. No actual sender/provider, real payout, document deletion, personal message or backfill.

Current staging catalog also confirms no anon/authenticated SELECT or authenticated UPDATE grant on the three private org_payment_profiles/referral_payout_requests/referral_commissions tables. RLS is disabled there. This limited grant check is not a complete view/RPC/Storage access audit and does not close F10.

## Exact source and rollback

Source migration: `supabase/migrations/20260914120308_audit_staff_finance_session_guard.sql`. Production used the same source with history version 20260914120413; do not blindly replay all historical migration files.

Before source: `STAFF-FINANCE-BEFORE-2026-09-14.json`. Applied sources/hashes/ACLs, anonymous sets and advisor deltas: `STAFF-FINANCE-DEPLOYMENTS-2026-09-14.json`.

Tests: `tests/staff_finance_baseline_2026-09-14.sql`, `tests/staff_finance_gate_2026-09-14.sql`, `tests/staff_finance_prod_refusals_2026-09-14.sql` under this audit directory. Baseline test intentionally requires original unpatched source and is not a release gate.

`ROLLBACK-STAFF-FINANCE-2026-09-14.sql` checks five applied hashes, restores exact original functions and checks restored hashes/ACLs. It leaves the common helper and previous bank/payout wrappers intact. Rollback would remove these protections and restore the old accounting behavior; it was rehearsed only inside a staging rollback transaction, not applied on production. The shared bank-helper rollback must continue refusing while any payout/staff consumer exists.

## Remaining work

Eleven selected payment/payout RPCs now enforce current sessions on both environments. Other agent-bank review methods, document/Storage paths, direct views/policies, global session revocation, upload freeze and complete erasure proof remain open. F10 intended role/type matrix is still unapproved; no access-policy choice was invented. Stage-only erasure/deletion-suppression/unsubscribe packages are not promoted by this turn. Retell real-provider proof/cutover, browser/native-upload verification, CI/publication, password and recovery/legal gates remain.

Public GitHub publication still blocked by the prior automatic-review public-disclosure decision. New work is committed locally on the user-selected branch and included in the refreshed patch. Outreach stays enabled; SEO/F33/WhatsApp parked.

Faida: staff ke purane/band session se bank/payout access rukta hai, aur purani payout request ke saath nayi commissions ghalti se paid nahi hotin. Baqi risk: poora session/document/erasure audit abhi close nahi; amount mismatch par insani review zaroori hai.
