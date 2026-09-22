# Git hygiene — 22 September 2026

Baseline: origin/main d422e54. No force push. Local blocker 4506d5c rebased onto that main as b1639e5; the conflict was resolved by keeping the entire remote HANDOFF unchanged and appending only the historical blocker line.

## Earlier export coverage

`git cherry origin/main 55978b1 d977d5d` marks all 20 non-merge commits `-` (patch-equivalent commits already on main). Every one of the 134 paths in `git diff --name-only d977d5d 55978b1` exists on main. Later lane changes are preserved; file existence does not claim byte identity with superseded code.

## Three old audit branches

| Branch | Tip | Disposition |
|---|---|---|
| audit/review-domain-v4-20260906 | f6e636b | F31 plus historical v4 review; archive exact branch diff; retain current v5/runtime and current handoff |
| audit/s1-s2-verification-20260906 | 9585231 | Historical verification documentation; archive exact branch diff |
| audit/s2-f31-client-verdict | 1259d12 | Four verdict call sites already present; restore missing override marker and original regression test |

The three exact merge-base-to-tip diffs are in `archive-2026-09-06/`. They are historical evidence, **not patches to apply to current main**. They preserve the previously missing report paragraphs and old status blocks without rewriting current Claude-owned CURRENT STATE/NEXT ACTION. The merge uses the `ours` strategy only after this selective recovery, preserving ancestry so branch retirement loses no commits. Remote branch retirement follows successful publication; see LOG for actual outcome.

Restored `docs/audit-2026-09/tests/f31_client_verdict_test.mjs`. Main already carried advisory verdicts through all four gated uploads, but reconstruction lost the original `overridden` flag. Restored immutable verdict copying with `overridden: verdict === 'reject'`; existing upload-anyway user consent is unchanged. Synthetic actual-source test and 20 privacy tests PASS. No database/edge change.
