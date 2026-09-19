# DESIGN — live-chat onboarding document orphan reconciliation (19 Sep 2026)

Status: **Phase 1 LIVE on staging AND prod (bl_audit_0352, guard = app_private.lc_cc_ok()); rollback test PASS on both; anon SECDEF names unchanged (32 / 33). Phase 2 not started.** Gate stays OPEN.

**CORRECTION (19 Sep, Claude):** the "edge logs path even when stored=false" claim below was WRONG. lc-doc-check v11 line 81 returns 502 `storage_failed` before doc_log is ever called, so the edge cannot manufacture a dangling entry. I read line 120 without line 81. No edge fix is needed for that. Dangling entries can still come from an object removed by hand. The real remaining source of ORPHANS is unchanged: upload OK, then doc_log fails (line 122 returns 502 and leaves the object).

## Problem
`lc-doc-check` writes the file to Storage (`documents/lc-onboarding/<visitor_key>/<file>`) and THEN calls
`lc_ob_doc_log`, which appends `{t,f,path,verdict,ts}` to `app_private.lc_onboarding.docs`. Two failure shapes:

| Shape | How it happens | Why it matters |
|---|---|---|
| **Orphan object** — object in Storage, no `docs[].path` pointing at it | doc_log fails (bad key / not found / 40-doc limit / 502) after the upload succeeded; edge returns `document_save_failed` but the file stays | A personal document nobody can see in CC, and an erasure that walks `docs[]` never finds it |
| **Dangling entry** — `docs[].path` with no object | edge logs `path` even when `stored=false` (note says "UPLOAD FAILED", the entry still carries the path); or object removed by hand | CC shows a document that cannot be opened |

## Measured today (read-only, 19 Sep)
- PROD: 3 objects under `lc-onboarding/`, 0 `docs[]` entries anywhere → 3 orphans, 0 dangling. All three are 70-byte
  26 Jul test probes (`debugtest/probeA.png`, `debugtest/probeB.png`, `lbtest_visitor_001/…final-test.png`), owner null.
  No real customer document is orphaned on prod. (docs is always a jsonb array — checked.)
- STAGING: the synthetic v11 object `lc-onboarding/ZZsynthetic_v11_test_2026_09_19_k1/…synthetic-1px.png` is still there.

## Design
**Phase 1 — report only (the part to build first).** One function, read-only:

`public.cc_lc_doc_reconcile(p_grace interval default '1 hour') returns jsonb`
- SECURITY DEFINER, `search_path = app_private, public, storage`; first statement = the same staff guard the other
  `cc_*` functions use (copy it from a live `cc_*` body at build time — do not retype it); raise 42501 otherwise.
- Grants: revoke from public/anon; grant authenticated + service_role. **Anon SECDEF surface must stay 33/32 with
  identical names** — check names after apply.
- Returns `{orphans:[{name,key,size,created_at,has_ob_row,has_conversation,looks_test}], dangling:[{visitor_key,
  conversation_id,path,t,f,verdict,ts}], counts:{…}, generated_at}`.
- Orphan = object in bucket `documents`, name like `lc-onboarding/%`, `created_at < now() - p_grace` (so an upload that is
  between the Storage write and doc_log is never reported), and no `docs[]` element with equal `path`.
- `looks_test` = key matches `debugtest|lbtest_%|ZZsynthetic%` — a hint for the human, never an action.
- No writes, no deletes, no notification, no email. It is a list.

**Phase 2 — act (NOT designed in detail; needs Yaseen's decisions below).**
- *Relink* (only when `has_ob_row`): append `{t:'unknown', f, path, verdict:'recovered', ts}` to that row's docs. Staff-only, one path per call, logged.
- *Remove*: must go through the **Storage API** (service role, from an edge function or the dashboard), never
  `delete from storage.objects` — a SQL delete leaves the blob behind and newer Storage versions block it.
- Every act call takes `p_dry_run boolean default true`.

**Edge fix worth doing alongside (small, separate):** when `stored=false`, do not put `path` in `p_doc` — that is the
one code path that manufactures dangling entries by construction.

## Erasure interplay (open gate, unchanged)
Complete erasure must list the Storage prefix `lc-onboarding/<key>/`, not walk `docs[]`. Otherwise every orphan survives
an erasure request. Recorded here so the erasure gate picks it up.

## Test plan (staging first, rollback-txn, zero fixtures left)
1. Fixture ob row with one `docs[]` path and no object → appears in `dangling`.
2. Fixture `storage.objects` row (inside the txn) older than grace, no entry → appears in `orphans`.
3. Same object with `created_at = now()` → NOT reported (grace).
4. Matched pair → in neither list.
5. anon and non-staff authenticated → 42501.
6. After apply: anon SECDEF names identical to baseline on both envs.

## Decisions needed from Yaseen
1. Grace period — 1 hour OK?
2. Orphan with an ob row: relink for review, or delete?
3. Orphan with no ob row and no conversation: delete after how many days?
4. The 3 prod July probes + 1 staging synthetic: delete by hand from the Storage UI (recommended — they are ours).

## Yaseen's answers — 2026-09-19 (late), given in chat
- Decision 1 (grace period): NOT asked this turn — still open; Phase 1 keeps its current default.
- Decision 2: orphan WITH an ob row → **relink for staff review** (do not delete).
- Decision 3: orphan with no ob row and no conversation → **delete after 7 days**.
- Decision 4: Yaseen deletes our own test objects by hand in the Storage UI. Prod `documents` bucket, exact names:
  `lc-onboarding/debugtest/probeA.png`, `lc-onboarding/debugtest/probeB.png`,
  `lc-onboarding/lbtest_visitor_001/1785035521370-final-test.png`.
  Staging: a query for `%ZZsynthetic%` in storage.objects returned 0 rows on 19 Sep late — the synthetic object is already gone (who removed it: unknown).
- Still undecided: the "remove the just-written object when doc_log fails" edge proposal (HANDOFF item 3) — not asked, not approved.

