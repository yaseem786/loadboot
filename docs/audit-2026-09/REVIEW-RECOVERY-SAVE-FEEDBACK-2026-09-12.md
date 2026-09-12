# Audit recovery and save feedback — 12 September 2026

## Outcome

Local review branch `audit/recovery-20260912`, based on GitHub main `90ccaff`.
Recovered six applied audit migrations from staging's migration history. Reconstructed the pending onboarding save client against current main and corrected shipper domain-check presentation. No database mutations, production deployment, public push, provider call or personal message this turn.

## Fresh evidence

- Staging newest migration: `20260912071944 / bl_disp_0308b_sweep_count_fix`.
- Production newest migration: `20260912072013 / bl_disp_0308_skills_test_sweep`.
- Staging `lc_ob_save` definition MD5: `f08b898a2309f1403bb74f7df6205289`, matching deployed 0344.
- Production `lc_ob_save` definition MD5: `61d6036fa6820804c538363a9954c827`. No production fix claimed.
- 20 actual-source tests PASS: 16 queue/UI cases and four shipper rendering cases. DOM fixtures are used; these are not browser tests.
- `npm run check`: 156 JavaScript syntax checks and import-reference check PASS before the final shipper copy change; the changed shipper module subsequently parsed and rendered in all four tests.
- Staging build PASS using the project's actual staging anon key. No placeholder credential.
- Browser navigation to the locally served built contact page: `net::ERR_BLOCKED_BY_CLIENT`. Visual verification remains BLOCKED, frontend NOT deployed.

## F36 save client

`lcOnboard.js` now serializes saves through `onboarding-save-queue.js`, snapshots each payload, handles HTTP/JSON failures and uses the configured session-token provider. It checks conversation identity again after token lookup. Explicit `rate_limit` refusals wait the server's 1–60 second delay and retry at most twice. Network failures are not automatically replayed because a note may already have committed. At most 40 saves can remain pending.

A persistent status announces saving, waiting, saved or failure. A later partial save cannot erase an earlier failure. The completion card says “Progress saved” only after a positive result and a healthy queue. Changes of conversation cannot send stale queued payloads into the new conversation. Authentication errors do not fall back to anonymous.

Limitations: this is an in-memory queue; closing/reloading the tab can discard pending work. The warning asks the visitor to keep the tab open and contact support. Cross-connection database load testing is not claimed. Staging's 60 saves/60 seconds is not an approved production quota; key churn is outside this per-key control.

## F11 presentation

Unknown/null MX results now say “Not checked”; only explicit true says “Yes”. Badges describe company-domain checks or onboarding review, not payment capacity. Pending screens do not claim a completed check. Manual-review copy asks about the secure submission process instead of requesting sensitive documents by ordinary email. Posting permissions and booking logic are unchanged. Broader F11/F13 review remains open.

## Recovery and historical evidence boundary

Earlier audit working directories were removed by workspace cleanup. Local commits such as `25c8337`, `0148376`, and the earlier PWA/share/CI patches are not present in this checkout. They are not claimed recovered. The queue and presentation fixes here are new reconstructions tested against current main.

The six SQL files below were recovered from applied staging migration statements. They are historical source recovery, NOT newly applied migrations. Historical counts reported in prior turns (payout 18, deletion 46, account requests 45, compliance 61, save-limit 26) were not rerun today. Previous reports said 15/15 missing staging RPC names had been restored; that statement is historical, not a fresh full contract audit.

| Recovered file | SHA-256 |
|---|---|
| `migrations/20260909072538_bl_audit_0338_agent_payout_review_parity.sql` | `a0a767f510e97fbd1abc639044b0546f138b8f6fc424822fe7decb904e6fc8b1` |
| `migrations/20260909125750_bl_audit_0339_account_deletion_boundaries.sql` | `f2652d6211b5a6c7c302474954e32637e01d8befe54acb9f6e93bf1885e227da` |
| `migrations/20260909130631_bl_audit_0341_account_deletion_bank_cleanup.sql` | `6796ff8972616f18df44a0a7473e1ddb3d060e578591b58c689e93120b336cd1` |
| `migrations/20260910034654_bl_audit_0342_account_request_boundaries.sql` | `5677b93b6c8047233669e3eed66a1a3b8df700e9a5781b1ae85291eeb64a8b8a` |
| `migrations/20260910042010_bl_audit_0343_compliance_contracts.sql` | `b25ae7bdfab17ca2b33597d5928c0ee0d6ac97ca7e5a723f1ebd33da1998123a` |
| `migrations/20260910110616_bl_audit_0344_onboarding_save_limit.sql` | `efbf66c875a0cba044b0a735fb06ddc85ab91ffc9cd14149d3ab6e64a8cdad8a` |

## Remaining work and gates

| Area | Next action / boundary |
|---|---|
| F08/F09/F18/F31 | Recover or reconstruct lost per-tab update consent, logout/share ownership and expiry, CI and AI-verdict patches against current main. Verify actual presence before counting any as complete. No public push while the prior disclosure review block remains unresolved. |
| Live-chat 0335/0336 and F36 | Browser/native-upload verification and guarded promotion package; production requires explicit approval. Retain old edge versions/settings for rollback. |
| F06 reports | Recover the two-report promotion and rollback package; verify `opened_at` dependency against current prod. No production apply without approval. |
| Account deletion | Storage-object erasure, durable suppression, retention policy and existing-session/JWT invalidation remain unresolved. Corrected SQL does not establish complete erasure. |
| F10 documents | Recover role-by-document matrix; resolve intended role access before changing the complete OR-combined policy graph. |
| F14 Retell | Real provider signature proof and explicit cutover approval required; keep observe/old inbound path until then. No real test calls. |
| F04/F12 | Legal/business-model decisions remain owner's gates. |
| F15 | Password-protection setting/plan eligibility still needs verified access; not claimed enabled. |
| F16–F27 | Open measurement, performance, operations, recovery and accessibility items require fresh evidence; do not blanket-close from these UI tests. SEO work remains parked. |
| F33 / WhatsApp / outreach | F33 and WhatsApp parked. Outreach stays enabled; no personal messages. |

## Verification commands and rollback

```sh
node --experimental-vm-modules --test tests/onboarding_save_queue_test.mjs tests/shipper_trust_render_test.mjs
npm run check
CONTEXT=deploy-preview python3 build_site.py
```

The build command requires `LOADBOOT_STAGING_ANON_KEY` in the environment. Never commit the environment or generated staging build.

Frontend has not been deployed. Rollback of these local UI changes means reverting the corresponding UI commit before any deployment; leave recovered migration history intact. Do not execute the recovered migrations as a production batch. Production promotion and database rollback require their own current-definition checks and explicit approval.

## Faida aur risk

Save fail ho to user ko ghalat “saved” tasalli nahi milegi. Chat badalne par pending data doosri chat mein nahi bheja jayega. Domain badge ab sirf available check ka result batata hai. Browser verification abhi blocked hai; is liye frontend deploy aur poora audit complete hone ka daawa nahi hai.
