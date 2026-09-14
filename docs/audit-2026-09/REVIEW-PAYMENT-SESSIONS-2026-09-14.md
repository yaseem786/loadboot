# Payment-profile current-session guard — 14 September 2026

## Outcome and scope

Staging migration `20260914064813 / audit_payment_session_guard` protects `public.cc_my_payment_profile()` and `public.cc_set_my_payment_profile(jsonb)`. Production was not changed. Latest main `b73a854` merged locally at `520b561`, preserving dispatcher roster/test changes and the existing audit work.

The original endpoints authorized by organization membership without current Auth session/account checks. A synthetic staging rollback probe demonstrated that a banned member could read masked bank details and save a bank profile; removing that member's session row also left reads working. This is evidence at the SQL authorization layer with simulated request claims, not a live stolen-token or customer-account test.

Both endpoints now call private `app_private.assert_payment_session()` before reading or writing payment data. It requires a non-anonymous authenticated identity, a parseable session UUID belonging to that user, a current session row with no expired `not_after`, and an Auth user without a current ban or deleted marker. A completed application deletion request also refuses access if the ban is later lifted. Missing, empty, malformed, nonexistent and another user's session identifiers refuse with SQLSTATE 42501. Service-role claims do not bypass this user endpoint guard.

The helper is SECURITY INVOKER with a pg_catalog search path and fully qualified table references; only postgres retains EXECUTE. It runs through the existing privileged endpoint owner, creates no public endpoint and exposes no session data. Existing endpoint bodies otherwise remain identical, including carrier/broker/shipper selection, masked responses, validation and audit/event behavior. Their authenticated/service-role grants are preserved; no new anonymous grant.

## Independently verified

| Check | Result |
| --- | --- |
| Pre-fix baseline, restored only inside a rollback transaction | 7 assertions PASS; banned read/write and removed-session read reproduced |
| Candidate full suite | 44 behavioral/ACL checks plus count guard PASS |
| Applied staging suite | Same 44 checks plus count guard PASS; saved final test also asserts the deployed helper is present |
| Rollback then reapply inside transaction | Full suite PASS; patched hashes restored after transaction rollback |
| Legitimate-user controls | Carrier, broker and shipper read/save work; missing organization membership still refuses |
| Invalid session/account controls | All tested read/write attempts refuse; payment row unchanged |
| Exact anonymous name/argument inventory | Identical before/after, 32 |
| Advisor findings | All finding identities unchanged across six categories; no new or removed identities |
| Fixture cleanup | Zero synthetic users, organizations or bank-submission events |
| Local merged-source checks | 30 API/UI tests PASS; 161 JS syntax files and import references PASS |

Initial fixture attempts hit organization-owner and membership-status constraints; those runs failed and rolled back. Fixtures were corrected before the successful candidate run and deployment. No real account, bank account, document, email sender or provider was used. Test bank fields are inert placeholders. Auth session rows are synthetic rollback fixtures; no real session was revoked. Domain events/audit records roll back before any queue consumer can observe them. The carrier fixture creation avoids the broker/shipper welcome branch.

## Sources and rollback

| Function | Before md5 | Applied md5 |
| --- | --- | --- |
| cc_my_payment_profile() | e94a8f8b04878514d5d3fdc1f9da2c0a | 710d7ce85c0277eef6c14572801a6b70 |
| cc_set_my_payment_profile(jsonb) | 75d78f9fb61762ddfe9458c634f18a1d | 6855c85926b517ec183a148223bef411 |
| assert_payment_session() | absent | 18344c1e6ac6a2b76e2dae5ee7659334 |

Exact before/after source, ACLs, anonymous inventory and advisor comparison: `PAYMENT-SESSION-BEFORE-2026-09-14.json`, `PAYMENT-SESSION-AFTER-2026-09-14.json`, `PAYMENT-SESSION-CHECKS-2026-09-14.json`.

Source: `supabase/migrations/20260914064813_audit_payment_session_guard.sql`.
Tests: `docs/audit-2026-09/tests/payment_session_gate_2026-09-14.sql` and `payment_session_baseline_2026-09-14.sql`. The baseline requires unpatched source and must never be used as the passing deployment gate. To rehearse rollback/reapply, insert the exact rollback followed by migration at the gate test's `-- MIGRATION_UNDER_TEST` marker; the whole test ends in ROLLBACK.

`ROLLBACK-PAYMENT-SESSION-2026-09-14.sql` checks all three applied source hashes and refuses if another stored function has started using the helper. It restores the original two bodies with their ACLs, then drops the helper without CASCADE. This is a code-only rollback; it does not modify accounts, sessions or bank rows. Production execution needs separate authorization.

## Remaining work and practical limits

This closes the selected payment-profile RPC slice only. It does not revoke refresh tokens, invalidate every JWT, protect other RPCs/RLS policies, stop in-flight transactions, enforce inactivity configuration, or freeze document uploads. Auth HTTP/browser behavior has not been tested. Callers of these user endpoints need a current user session; legacy synthetic/service calls without one now fail intentionally. Browser verification is still required before production promotion.

Next sensitive consumers to review from current source: agent_payout_center, agent_request_payout, referral payout functions, staff payment review functions, direct payment-table grants/RLS, and document/Storage authorization. Do not globally patch has_global_permission without testing legitimate staff/background callers. Complete the supported Auth revocation/upload-freeze/removal-proof/final-completion workflow separately; do not call full account erasure complete.

The existing erasure inventory guard remains applied unchanged (processor 3fe3cbac599f19e28d6f4a41109e82ad). F10 role/type decision, notification-consumer parity, Retell real signed proof, browser/native upload checks, CI/publication and other production approvals remain open. Outreach remains enabled; SEO/F33/WhatsApp parked.

Supabase's current session documentation recommends matching a JWT session_id to auth.sessions for strict sensitive-operation sign-out checks: https://supabase.com/docs/guides/auth/sessions . Changelog index fetched September 14; no relevant hosted-session breaking change identified. JWT cryptographic verification remains the responsibility of the gateway; this SQL helper validates current authorization state after that boundary.

## Faida aur baqi risk

Faida: in do bank-profile functions par purana ya band session data parh ya badal nahi sakta; valid account ka kaam chalta rehta hai. Risk: baqi payout/file endpoints ko bhi review karna hai, aur account band karne par tamam sessions revoke karne ka workflow abhi baqi hai. Fix staging par hai; prod par apply nahi hua.
