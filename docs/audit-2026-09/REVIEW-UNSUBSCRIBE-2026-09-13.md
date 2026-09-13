# Unsubscribe entrypoints — staging, September 13

Applied `20260913214311 / audit_unsubscribe_entrypoints` to staging only. Production was not changed. Main advanced to `515f4f6`; merged at `d5beaeb`, preserving dispatcher and website work. Both environments had received the other lane's `bl_disp_0312_test_result_in_portal` before this batch (stage 213553, prod 213616).

## Confirmed old behavior and correction

A rollback-only baseline showed that a valid footer link for an absent contact returned success without saving any suppression. The old service-token path also rewrote an already delivered operational message to unsubscribed.

| Entry point | Staging correction |
|---|---|
| outreach_unsubscribe(text,text) | Validates address and nonempty token/config/verifier result, retains existing token format, saves a durable marketing opt-out even without a contact, normalizes recipient matching, cancels pending marketing including scheduled rows. |
| cc_delivery_worker_unsubscribe(uuid) | Uses the current production response contract as its base, adds the same durable/normalized marketing handling, accepts an older operational token as a marketing opt-out while preserving operational and delivered-history rows. Missing/unsupported/malformed cases refuse; SMS behavior stays channel-specific. |

Both email paths preserve any stronger existing suppression reason and avoid adding a duplicate on serial repeat. Marketing classification covers case-insensitive outreach dot/underscore/dash prefixes and campaign source, matching the previously staged sender boundaries. Existing caller grants and the signing helper were preserved; the service-token RPC is still service_role-only. No anonymous surface was added.

This is not a byte-identical production copy: narrow corrections also preserve delivered history, cancel scheduled marketing and fail closed on unavailable token verification. Production needs its own reviewed migration against fresh source before promotion. No real token or signing secret was printed or changed.

## Fresh verification

- Old behavior reproduced before apply; synthetic rows rolled back.
- Candidate and deployed tests each **73 runtime assertions PASS** (41 ASSERT sites with path/reason loops).
- Covers anon footer access, service-only token ACL, unknown/null/wrong/empty tokens, malformed addresses, unavailable verifier simulation, injected suppression-write failure rollback, positive valid links, absent/deleted contact, repeat and re-import, stronger bounce/complaint/manual reasons, scheduled cancellation, operational/delivered-history preservation, SMS and unsupported channel.
- Exact anonymous name/argument list stays **32**. Signing helper hash unchanged. Six advisor notices unchanged, including [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Guarded rollback/reapply restores both deployed hashes. Post-test synthetic deliveries, contacts, suppressions and injected triggers all **zero**.
- Merged code: **61 UI/privacy tests + 30 actual-source IP cases PASS**; **160 JS syntax checks + import check PASS**; actual-staging-key build PASS.
- No live email worker, provider send, real recipient, backfill or production mutation. Browser/native sharing/upload verification remains unverified; local/transaction tests are not a substitute for it.

The first candidate SQL assembly failed parsing before fixtures ran; literal replacement corrected the generated source before successful rehearsal or persistent apply.

## Saved package

- `supabase/migrations/20260913214311_audit_unsubscribe_entrypoints.sql` (CLI created as 20260913213813, renamed to actual applied service version).
- `tests/unsubscribe_entrypoints_2026-09-13.sql`: deployed rollback test. For a candidate rehearsal, replace MIGRATION_UNDER_TEST with exact migration text using literal substitution, preserving SQL dollar quotes and regex anchors.
- `tests/unsubscribe_baseline_2026-09-13.sql`: historical reproduction only, expected to fail against fixed code.
- `UNSUBSCRIBE-BEFORE-2026-09-13.json`, `UNSUBSCRIBE-AFTER-2026-09-13.json`: exact sources, ACLs, hashes and anonymous inventory.
- `ROLLBACK-UNSUBSCRIBE-2026-09-13.sql`: guarded code rollback; retains suppression records and cancelled delivery states. No replay/re-import; separate rollback approval required outside the completed rehearsal.

Deployed md5: footer `61f99e7275bf65f27e6ed11b2396a676`; token RPC `0090e4226dd14f8cddf2268c5b451f94`; signing helper remains `0069bd6cc976213230b04c85ad030081`.

## Still open

Full account erasure: capture a document/object manifest before deleting metadata, implement actual Storage API removal according to retention rules, revoke sessions through supported interfaces, cover outstanding JWT access and require all stages before final completion. The suppression marker itself retains a normalized email under the existing suppression mechanism.

Remaining notification/reminder consumers and live edge-source parity need review before claiming every delivery path has equivalent opt-out scope. In-flight messages already accepted by a provider cannot be recalled by this database change. Concurrent opt-outs are not claimed to have exactly-one suppression-row semantics; suppression membership remains effective.

F10 intended role/document decision, browser/native-upload checks, CI/publication, password setting and Retell proof/cutover remain open. Public push remains blocked by the earlier automatic disclosure review. SEO/F33/WhatsApp parked; outreach enabled.

Faida: valid opt-out ab contact ki maujoodgi par depend nahi karta; zaroori transactional mail aur delivered history preserve rehti hai. Agla main gap actual file erasure aur purane login sessions hain. Production unchanged.
