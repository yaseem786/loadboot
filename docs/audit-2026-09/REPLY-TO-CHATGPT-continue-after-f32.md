# Paste this to ChatGPT when its quota is back (after the F32 turn it lost)

---

Continue. Your last turn was lost — you finished "Prepare F32 migration, schema comparison, unrun rollback test" and hit your limit while updating docs / committing; nothing of it reached GitHub or disk. Claude has redone F32 end-to-end, so **do NOT redo it**. State now:

- `main` = `d84e6d2` (PR #169 merged the Sprint 1 files — HANDOFF.md and everything else you were missing is on main now). There is no `audit/s1-boundaries` branch; don't look for one.
- **F32 is DONE — on staging AND on prod** (Yaseen said "fix it" for the prod Earnings error at 21:5x UTC): `migrations/bl_fin_0322_port_trip_pnl_engine.sql` (wd_0032 + wd_0033 verbatim + explicit grants + ACL check) is applied on STAGING as `bl_fin_0322_port_trip_pnl_engine`; `docs/audit-2026-09/tests/bl_fin_0322_rollback_test.sql` ran there → `RESULT PASS` (net 2850→2960 on a real trip, 42501 + ACL guards hold, 0 rows left). Then applied on PROD as `bl_fin_0322_port_trip_pnl_engine` and the same test PASSed there (trip `55a9c732…` net 1450→1560, 0 rows left). **This is the first audit migration on prod; Sprint 1 (0320/0321, edge fns) is still staging-only.** Those two files + HANDOFF.md + PHASE1-AUDIT.md are on my disk, uncommitted — I'll push them; if you can't see them yet, tell me instead of recreating them.
- Other lanes moved too: newest migration on BOTH prod and staging is now `bl_fin_0322_port_trip_pnl_engine`; below it prod has `bl_bp_0323_submit_load_kind_aware`, staging has `bl_avail_0320_daily_truck_availability` + `bl_bp_0323`. Files `migrations/bl_avail_0320_*.sql`, `migrations/bl_bp_0323_*.sql`, `docs/audit-2026-09/REVIEW-LEGAL-SEO-HARDENING-2026-09-05.md` are not audit work — don't touch.

Do exactly this:

1. **Re-sync header first** (main sha vs `d84e6d2`, `list_migrations` prod + staging, `list_edge_functions` both, changed files). If what you see differs from the bullets above, stop and tell me.
2. **Read `docs/audit-2026-09/HANDOFF.md` in full** — CURRENT STATE has the F32 evidence and the exact prod steps; NEXT ACTION is what "continue" means.
3. **Review F32 as a second pair of eyes:** read `migrations/bl_fin_0322_port_trip_pnl_engine.sql` against staging's `wd_0032`/`wd_0033` statements (must be verbatim), read the rollback test, check the three gotchas noted in HANDOFF (no `SET ROLE` inside the test, factoring-aware expected delta, named args for `cc_set_cost_model`). Append a short "F32 review" to `PHASE1-AUDIT.md` (dated changelog line at top). "No findings" is a valid result.
4. **Then do NEXT ACTION in HANDOFF.md.** If I have said "apply to prod" in this thread → the Prod-step column, one item at a time (F01 → F02 → F05; F32 is already on prod), re-running each staging test on prod. Otherwise → **Sprint 2 item 2 as TEXT only in `PHASE1-AUDIT.md`**: the F31 `doc_set_ai_verdict` RPC spec + doc-precheck-into-repo plan + tamper checks, and the F30 collector-pattern design. No code, no DB changes until I approve.
5. **Content rule stands:** any SEO/content item is re-ranked against LIVE Search Console + GA4 (`seo-pull` recipe) before writing; mark the re-rank date in `90-DAY-PLAN.md`.
6. Before you stop: rewrite CURRENT STATE, set NEXT ACTION, append your LOG line, commit + push on a branch off `main` (e.g. `audit/s2-f30-f31`) and tell me the branch. If you hit your limit mid-turn again, write the HANDOFF LOG line FIRST, then everything else — that's the one thing that must not be lost.

Hard rule, every prompt: re-read latest `main` + both Supabase migration lists before acting. Claude and you run in parallel and other lanes push too.
