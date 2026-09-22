# Audit work split — Claude vs ChatGPT/Codex (22 Sep 2026, set by Yaseen: "dono ka kaam takraye nahi")

Rule: each side owns the files/areas below. Never edit the other side's files. Both APPEND one line to `HANDOFF.md` → LOG per turn
(append-only, never rewrite the other side's lines). If a task needs the other side's area, write a request in your LOG line; do not do it.

## Claude owns (database, edge functions, security, prod applies)
- `migrations/bl_audit_*.sql`, `tests/bl_audit_*.sql`, `tests/lc_doc_*_contract_test.mjs`, `supabase/functions/lc-doc-check`, `supabase/functions/lc-doc-purge`
- `docs/audit-2026-09/HANDOFF.md` **NEXT ACTION + CURRENT STATE** blocks, `DESIGN-LC-ORPHAN-*`, `RETENTION-PROPOSAL-*`, all `ROLLBACK-*-2026-09-2x.sql`
- Staging→prod DB/edge applies; anon SECURITY DEFINER baseline (`anon-secdef-baseline.md`)
- Open items: erasure real removal (after Yaseen's retention decision), deletion-flow browser check, Retell signature proof, notification/edge parity,
  0342/0343 prod decision once ChatGPT reports (see below), any new DB finding.

## ChatGPT/Codex owns (repo hygiene, frontend, build, measurement, SEO/perf docs)
- Git: merge or retire the three unmerged 6-Sep audit branches; confirm every past Codex file is on `main`; push to `origin/main`.
- `bl_audit_0342` / `0343`: write `REVIEW-0342-0343-PROD-DECISION.md` — line-by-line diff of the 10 function bodies staging vs prod, and a
  recommendation (keep prod as-is / promote). **Do not apply to prod** — Claude applies after Yaseen's yes.
- Frontend (files under `app/**`, `build_site.py`): (a) frozen-user message — when `lc_ob_upload_check` returns `{error:'frozen'}` or a
  documents insert fails with RLS while a deletion request is open, show "Uploads are paused while your account-deletion request is open"
  in `app/shared/ui/lcOnboard.js` and the carrier Documents page; (b) decide/wire `getToken` for the website chat wizard (item 5 signed-in leg)
  or record N/A; (c) F08/F09 SW follow-ups if any remain; (d) F19 bundle size + F20 Lighthouse for the seven pages (measure, report, then fix
  the cheap wins: the 2 MB hero PNG, code-split the 764 KB carrier app if feasible).
- Docs/measurement: F21–F23 (SEO/analytics — outside Claude's lane), F24 cron inventory vs plan limits, F26 status-page independence
  check, F27 style-literal report. Tests you own: `tests/*_ui_*`, `tests/domain_check_*`, `docs/audit-2026-09/tests/*`.
- Rule for any new RPC you add: `revoke all ... from public, anon` unless it is for guests (Postgres grants EXECUTE to PUBLIC by default).

## Prompt to paste into ChatGPT/Codex
```
You are continuing the LoadBoot audit as the ChatGPT/Codex lane. Read, in this order:
docs/audit-2026-09/WORK-SPLIT-2026-09-22.md (your ownership list — do not touch Claude's files),
docs/audit-2026-09/CHATGPT-HANDOFF-2026-09-22.md (status of every finding), then the CURRENT STATE and NEXT ACTION of
docs/audit-2026-09/HANDOFF.md. Then do, in order: (1) git hygiene — diff and merge/retire the three 6-Sep audit branches, verify all
your earlier files are on main, commit on main and push to origin/main; (2) REVIEW-0342-0343-PROD-DECISION.md (diff only, no prod apply);
(3) the frontend items (frozen-user message, getToken decision, F08/F09 leftovers) with tests, staging build PASS, node --check + esbuild;
(4) F19/F20 measure then cheap fixes; (5) F21–F27 measure-and-report docs. Rules: staging first; never touch production DB or edge
functions; never send any email/SMS/message; never delete data; every new RPC gets revoke from public, anon; append one LOG line to
HANDOFF.md per turn (do not rewrite others' lines); if the repo and a doc disagree, the repo wins — fix the doc. Stop and ask Yaseen
before anything irreversible.
```
