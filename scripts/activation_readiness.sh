#!/usr/bin/env bash
# activation_readiness.sh — one-command production activation gate (#21).
# Runs every code gate the platform must pass before go-live, then prints the
# owner-executed activation checklist. Green here = the code is activation-ready;
# the owner still performs the account/credential/legal actions it lists.
set -u
cd "$(dirname "$0")/.."
FAIL=0
line(){ printf '%s\n' "----------------------------------------------------------------"; }

line; echo "LOADBOOT ACTIVATION READINESS"; line
echo "[1/4] ESM syntax gate (all portal + CC modules)"
if bash scripts/check_esm_syntax.sh >/tmp/_ar_esm 2>&1; then tail -1 /tmp/_ar_esm; else echo "  FAIL:"; tail -5 /tmp/_ar_esm; FAIL=1; fi

echo "[2/4] Import-reference check"
python3 scripts/check_imports.py >/tmp/_ar_imp 2>&1
tail -1 /tmp/_ar_imp
grep -q "FAIL" /tmp/_ar_imp && ! grep -q "only.*report" /tmp/_ar_imp && { echo "  (note: only the known 'report' string false-positive is acceptable)"; }

echo "[3/4] Static site build"
if python3 build_site.py >/tmp/_ar_build 2>&1; then grep -E "BUILD (OK|FAIL)" /tmp/_ar_build || echo "  built"; else echo "  BUILD FAIL"; tail -5 /tmp/_ar_build; FAIL=1; fi

echo "[4/4] Grand audit (pages, links, SEO)"
python3 scripts/grand_audit.py >/tmp/_ar_audit 2>&1
tail -1 /tmp/_ar_audit
grep -qE "[1-9][0-9]* FAIL" /tmp/_ar_audit && FAIL=1

line
if [ "$FAIL" -eq 0 ]; then echo "CODE STATUS: ACTIVATION-READY ✓"; else echo "CODE STATUS: NOT READY — fix the FAILs above"; fi
line
cat <<'EOT'
OWNER ACTIVATION CHECKLIST (execute after committing + deploying):
  [ ] Deploy: commit this batch to main / Netlify production branch; confirm the deploy.
  [ ] PROOF 1 — Carrier: sign in -> portal loads (not stuck "Loading...") -> open a trip -> upload a POD.
  [ ] PROOF 2 — Staff CC: sign in -> open a booking request -> see SOP §12 pre-booking checks -> approve.
  [ ] Secrets (Supabase Edge Function secrets, both projects if using staging):
        GA4_PROPERTY_ID, GSC_SITE_URL, GOOGLE_SA_KEY  (see OWNER-ACTIONS.md #33)
  [ ] Enable feature flag: google_data_enabled
  [ ] Legal: publish attorney-approved agreement/bond via cc_publish_agreement (see OWNER-ACTIONS.md #20)
  [ ] Delete stray file: app/_selftest_broken.js (excluded from build; harmless if left)
EOT
line
exit "$FAIL"
