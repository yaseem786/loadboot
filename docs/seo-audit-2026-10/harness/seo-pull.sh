#!/usr/bin/env bash
# seo-pull.sh — live GSC read through the prod `seo-pull` edge function (read-only).
#
#   SEO_PULL_TOKEN=<v4 token> harness/seo-pull.sh <days> [dimensions] [rowLimit] > out.json
#
#   days        1–180 (the function ends the window 2 days ago, GSC lag)
#   dimensions  comma list: page | query | query,page | date  (default: query,page)
#   rowLimit    1–1000 (function cap; default 1000)
#
# Auth = prod publishable/anon key (public by design, gateway verify_jwt) + X-SEO-KEY.
# The token itself is NOT in the repo: set SEO_PULL_TOKEN in the environment.
# Examples for a ledger session (BEFORE row = 28 d page + query,page, then 7 d):
#   harness/seo-pull.sh 28 page      > 28d-page.json
#   harness/seo-pull.sh 28 query,page > 28d-qp.json
#   harness/seo-pull.sh 7  query,page > 7d-qp.json
set -euo pipefail
DAYS="${1:?days}"; DIMS="${2:-query,page}"; LIMIT="${3:-1000}"
: "${SEO_PULL_TOKEN:?SEO_PULL_TOKEN not set (v4 token, see seo_measurement.md)}"
ANON="${LOADBOOT_PROD_ANON_KEY:-sb_publishable_lHr4JKuHCZEkkjaEh7vx3A_ya_XLG4V}"
DIMS_JSON=$(printf '%s' "$DIMS" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"", (i>1?",":""), $i}}')
curl -sS -m 90 -X POST "https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/seo-pull" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "X-SEO-KEY: $SEO_PULL_TOKEN" -H "Content-Type: application/json" \
  -d "{\"days\":$DAYS,\"dimensions\":[$DIMS_JSON],\"rowLimit\":$LIMIT}"
