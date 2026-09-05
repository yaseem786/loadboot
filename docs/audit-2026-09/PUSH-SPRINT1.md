# Push Sprint 1 to GitHub — Yaseen runs this (Claude cannot push from its side)

Open PowerShell in `C:\Users\HP\Documents\GitHub\loadboot` and run, block by block:

```powershell
git status --short
# You will see other lanes' uncommitted work too (build_site.py carries BOTH their copy edits and the F07 block,
# app/*, docs/*). Commit ONLY the audit files below on the audit branch; leave the rest for your normal commits.

git checkout -b audit/s1-boundaries

git add docs/audit-2026-09/ ^
        migrations/bl_sec_0320_email_ingest_service_only.sql ^
        migrations/bl_bp_0321_agent_confirm_resend_idem.sql ^
        supabase/functions/load-mail/index.ts ^
        supabase/functions/domain-check/index.ts ^
        scripts/check_imports.py ^
        package.json ^
        docs/CHATGPT-AUDIT-PROMPT.md ^
        docs/drafts/

# build_site.py: the F07 block is mixed with another lane's copy edits in the same file.
# Add it too if you are fine committing those edits on this branch; otherwise skip this line and
# ChatGPT/Claude will re-apply F07 later with docs/audit-2026-09/apply_f07_build_default.py.
git add build_site.py

git commit -m "audit sprint 1 (staging-verified): F01 lb_email_* service-only + load-mail v8, F02 domain-check auth/SSRF, F05 agent-confirm resend idempotency, F07 staging-bound local build, F18 import gate + CI; HANDOFF + audit docs"
git push -u origin audit/s1-boundaries
```

Then two manual moves ChatGPT/Claude cannot do:

```powershell
# CI workflow (protected path for remote tools):
mkdir .github\workflows 2>$null
copy docs\audit-2026-09\pr-checks.yml .github\workflows\pr-checks.yml
git add .github/workflows/pr-checks.yml
git commit -m "ci: pr-checks (syntax, imports, staging-bound build)"
git push
```

Optional: GitHub → repo Settings → Secrets → `LOADBOOT_STAGING_ANON_KEY` (staging anon key) so the CI preview build is usable.

After the push, tell ChatGPT: **"Pushed. Branch `audit/s1-boundaries` is on GitHub, HANDOFF.md updated with 0323. Continue."**
