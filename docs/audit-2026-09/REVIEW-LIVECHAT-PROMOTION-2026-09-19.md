# Live-chat DB + edge package — promoted to PRODUCTION 19 Sep 2026 (Claude)

Scope: the coordinated package the 19 Sep handoff asked for — bl_sec_0335 (visitor boundaries), bl_sec_0336
(remaining boundaries + `lc_ob_upload_check` + `lc_ob_doc_log` service-only) and bl_audit_0344 (save throttle),
followed by the lc-doc-check v11 edge. Prod DB and edge were both v10-era before this; staging had the DB since 8–10 Sep.

## Source recovery (not copied blindly)
- 0335 and 0336 had no file on disk; recovered from `supabase_migrations.schema_migrations.statements` on STAGING and
  written to `migrations/bl_sec_0335_livechat_visitor_boundaries.sql` (md5 b00ada5baf57dac2ec191b3619f31e23 = stored) and
  `migrations/bl_sec_0336_chat_remaining_boundaries.sql` (md5 1c2c2a179b48ac98fedd26e77df0c746 = stored). 0344 was already on
  disk (`migrations/20260910110616_bl_audit_0344_onboarding_save_limit.sql`, equals stored + one trailing newline).
- bl_sec_0334 was NOT applied to prod: 0335 fully re-creates `lc_ob_get` and its guard accepts prod's pre-0334 hash.
- Every drift guard in 0335/0336/0344 was checked against prod's live hashes BEFORE applying; all matched
  (lc_history 03ec12e4, lc_ob_get f55a60f1, lc_ob_save 61d6036f→60c0fb2f→f08b898a, lc_poll 65bef776, lc_rate b042086f,
  lc_send a895247c, lc_start 23b43a45, lc_identify ab257eff, lc_ob_doc_log 85938450, lc_chat_request_call 61ffb15c, lc_request_call b90eb189).
- Prod's 9 pre-package bodies were verified identical to `LIVECHAT-PROD-2026-09-15.json` (hash-for-hash) so that snapshot
  is the rollback source; `ROLLBACK-LIVECHAT-2026-09-19.sql` is generated from it.

## Production migrations (server versions)
20260919195205 bl_sec_0335_livechat_visitor_boundaries · 20260919195240 bl_sec_0336_chat_remaining_boundaries · 20260919195311 bl_audit_0344_onboarding_save_limit

## Parity after apply (md5 of pg_get_functiondef, prod vs staging)
Identical: lc_history 91610bfc, lc_ob_get 9de7414c, lc_ob_save f08b898a, lc_ob_doc_log d58d2656, lc_ob_upload_check b517e2e8,
lc_poll 60f6bc71, lc_rate 0e34bd18, lc_send 6be34679, lc_start e9baa2aa, lc_chat_request_call cba3f910.
Different by design (0336 patches each env's OWN copy; prod carries copy fixes staging never had): lc_identify prod 15b640b1 /
staging 041ab8e6; lc_request_call prod f5c7193b / staging aaf514b9 — both verified to contain the novkey/16–64 and null-role guards.

## Anon SECURITY DEFINER surface (names, not count)
Prod 33 → 33; names changed exactly: −lc_ob_doc_log (now service_role only, body raises 42501 for any other JWT)
+lc_ob_upload_check(text,uuid). Baseline doc updated. Staging 32 (unchanged).

## Tests
- `tests/lc_package_rehearsal_2026-09-19.sql` — 15 cases, rollback-txn, synthetic rows only: PASS on staging, PASS on prod
  (prod rows 1→3 inside the txn, back to 1 / 87 conversations / 0 lc_save_windows / max_saves 60 after).
- Edge v11 staging (version 13, ezbr 61f44a04…): no auth 401, short key 400, novkey 400, unknown key 403 (preflight; nothing stored),
  bad mime 400, forged bearer 401, foreign conv_id 403. Positive with Yaseen's OK: synthetic 1×1 PNG under
  `ZZsynthetic_v11_test_2026_09_19_k1` → 200, stored at unique uuid path (70 bytes), Gemini strict verdict `reject`,
  service-role doc_log appended docs (1). DB rows deleted afterwards.
  **Leftover: the 70-byte object `documents/lc-onboarding/ZZsynthetic_v11_test_2026_09_19_k1/df400c2c-…-synthetic-1px.png` on STAGING
  storage — SQL delete is blocked by storage.protect_delete(); delete it from the Storage UI.**
- Edge v11 prod (version 12, ezbr 479aff19…, verify_jwt true, same source): no auth 401, short key 400, unknown key 403,
  direct RPC upload_check as anon → {"error":"not authorized"}, direct RPC lc_ob_doc_log as anon → 42501 (old door closed).
  No prod storage object, no prod Gemini call, no real document.

## Known limitation until the site deploys the new client
The live site still serves the pre-patch `lcOnboard.js` (sends the anon key, not the user token). Guests are unaffected.
A SIGNED-IN user whose onboarding row is bound to an account conversation will get 403 on upload until the new client ships
(prod has 1 onboarding row in total). Yaseen accepted this trade-off on 19 Sep.

## Rollback
`ROLLBACK-LIVECHAT-2026-09-19.sql` (DB, one transaction, not executed) + redeploy v10 edge from `LC-DOC-PROD-BEFORE-2026-09-15.json`.
Order matters: edge v10 first, then DB (v11 needs upload_check).

## Still open (unchanged by this turn)
Orphan reconciliation when doc_log fails after a successful storage write; browser/native upload verification; CI variable +
hosted run; full erasure/Storage access; F10; Retell; password/recovery/legal gates; public publication approval.
