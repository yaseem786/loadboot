# Session guards promoted; repository publication handoff — 14 September 2026

## Completed

Yaseen explicitly requested continuing tested production fixes and placing all pending audit files on `feat/dispatcher-model`, leaving main merge to him. On that authority, two session packages are now on production:

| Package | Staging history version | Production history version | Scope |
| --- | --- | --- | --- |
| audit_payment_session_guard | 20260914064813 | 20260914072602 | Bank-profile read/save + private session helper |
| audit_payout_session_guard | 20260914073221 | 20260914093644 | Agent payout center/request and referral payout history/request |

Repository migration filenames use their staging history versions; production applied the same SQL with its own history timestamp. These are source records, not instructions to blindly replay every migration against production. Other pending migrations are NOT promoted by this report.

All six endpoints require current session/account authorization before reading or writing. The shared private helper rejects missing, malformed, revoked or expired sessions, a different user's session, anonymous identities, banned/deleted accounts and completed account-deletion requests. It is invoker-only, has no PUBLIC/anon/authenticated/service_role EXECUTE grant, and adds no public endpoint. Gateway JWT verification remains separate.

## Evidence and verification limits

- Bank-profile candidate/deployed staging suite: 44 behavior/ACL checks plus presence/count guards PASS, rerun after the staging driver lane changed. Production: six missing-session role refusals PASS. All three deployed sources/grants match the tested staging package. Exact production anonymous names/arguments unchanged at 33; full advisor finding identities unchanged.
- Payout candidate suite: 53 behavior/source/ACL checks plus count guard PASS. Production source variant tested on staging inside rollback: same 53 PASS. Deployed staging and rollback/reapply rehearsal: same 53 PASS. The first rollback rehearsal and prod apply attempt were not executed because automatic-review usage was exhausted; both were resumed successfully after the user's next continue.
- Payout production: 12 missing-session role refusals PASS, without creating users, requests, transfers or messages. Four production function bodies equal their respective original source with only the session guard inserted; ACLs preserved. Staging's payout-center comment differs from production's, so those two hashes intentionally differ. Other three endpoint hashes and helper match. Eight deployed bodies across both environments checked against their respective before source.
- Exact anonymous names/arguments remain stage 32 / prod 33. Production advisor finding identities unchanged. The current staging advisor scan also includes other-lane driver changes; no full pre/post advisor identity comparison is claimed for that stage batch.
- Synthetic users are absent on both environments after checks. Successful staging writes used synthetic users, sessions, ledger entries and requests inside transactions that rolled back; no actual Auth logout, provider call, payout, document operation, real customer diagnostic or sender was invoked. No browser/native validation is claimed.

Evidence: `PAYMENT-SESSION-PROD-2026-09-14.json`, `PAYOUT-SESSION-DEPLOYMENTS-2026-09-14.json`, before-source snapshots, `tests/payout_session_gate_2026-09-14.sql`, `tests/payout_session_prod_refusals_2026-09-14.sql`.

## Rollback and remaining risk

`ROLLBACK-PAYOUT-SESSION-2026-09-14.sql` removes only the four payout guards, after proving the resulting body matches the exact captured original. It preserves ACLs and leaves the shared helper/bank guards intact. Rollback/reapply passed on staging. The older bank rollback now deliberately refuses while payout functions depend on the helper: roll back payout wrappers first if a complete rollback is ever authorized. A deployed source mismatch must stop rollback, not be force-replaced.

This protects selected RPCs only. It does not globally revoke refresh tokens, freeze uploads, block already-running transactions, protect every direct table/RLS/Storage path or complete account erasure. Existing application eligibility/duplicate-request rules are preserved, not re-audited as a complete payout engine. Browser checks and full supported Auth revocation workflow remain open. The erasure inventory, deletion/suppression and unsubscribe fixes are still staging-only unless a later live check proves otherwise.

Other remaining work: staff payout/read/review and sensitive document paths; F10 intended role/type decision; retention/removal-proof and final account erasure; notification-consumer parity; accessible browser/native-upload verification and CI activation; Retell real-provider proof before cutover; password/recovery/legal gates. Outreach remains enabled; SEO/F33/WhatsApp parked. Other-lane driver and dispatcher rejection-email changes preserved.

## Repository publication status

All recoverable local audit changes are in the local `feat/dispatcher-model` history, preserving the fetched target d127c1c and main b73a854. Main was not merged or deployed by this task. No force push was attempted.

Automatic approval review rejected the public push: it judged the user's branch instruction insufficiently explicit for public disclosure of sensitive security documentation and migrations, given the earlier disclosure block. This is separate from the temporary usage-limit failure. No alternate publishing route was used. Public remote publication is NOT complete. A local patch and file manifest are provided for review/manual handoff; public publication needs an explicit response acknowledging that the security code and audit reports will become public.

## Faida aur baqi risk

Faida: bank profile aur chaar payout functions ab purane/band session ko refuse karte hain; valid account ki request aur history chalti rehti hai. Risk: baqi staff/file paths aur poora account-erasure workflow abhi review hone hain. Isliye poora audit complete nahi kaha ja raha. Production ke do tested packages apply hain; GitHub push abhi approval-review block ki wajah se nahi hua.
