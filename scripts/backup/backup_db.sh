#!/usr/bin/env bash
# LoadBoot - nightly Postgres logical backup -> age-encrypted -> Cloudflare R2
# Requires env: SUPABASE_DB_URL, BACKUP_AGE_PUBKEY, R2_* (see docs/BACKUP-RESTORE.md)
set -Eeuo pipefail

: "${SUPABASE_DB_URL:?missing}"; : "${BACKUP_AGE_PUBKEY:?missing}"
: "${R2_BUCKET:?missing}"; : "${R2_ENDPOINT:?missing}"

STAMP="$(date -u +%Y-%m-%d)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
DUMP="$WORK/loadboot-prod-$STAMP.dump"

echo "==> pg_dump (custom format)"
# Keep: public, auth, storage, app_private + any app schema. Drop Supabase-managed internals.
pg_dump "$SUPABASE_DB_URL" \
  --format=custom --compress=9 --no-owner --no-privileges --no-comments \
  --exclude-schema='pg_*' \
  --exclude-schema=information_schema \
  --exclude-schema=extensions \
  --exclude-schema=graphql --exclude-schema=graphql_public \
  --exclude-schema=pgbouncer \
  --exclude-schema=realtime --exclude-schema=_realtime \
  --exclude-schema=supabase_functions \
  --exclude-schema=supabase_migrations \
  --exclude-schema=vault \
  --exclude-schema=cron \
  --exclude-schema=net \
  --exclude-schema=_analytics \
  -f "$DUMP"

BYTES=$(stat -c%s "$DUMP")
echo "==> dump size: $BYTES bytes"
# Sanity gate: a real LoadBoot dump is never under 1 MB. Fail loud instead of
# uploading a truncated dump over a good one.
if [ "$BYTES" -lt 1000000 ]; then
  echo "FATAL: dump is only $BYTES bytes - refusing to upload." >&2; exit 1
fi

echo "==> table of contents (plain, no data) for automated verification"
TOC="$WORK/loadboot-prod-$STAMP.toc.txt"
pg_restore --list "$DUMP" > "$TOC"
for t in public.profiles public.fleet_trucks auth.users storage.objects; do
  s="${t%%.*}"; n="${t##*.}"
  grep -qi "TABLE DATA $s $n" "$TOC" || { echo "FATAL: $t missing from dump" >&2; exit 1; }
done
echo "==> TOC entries: $(wc -l < "$TOC")"

echo "==> export pg_cron job list (cron schema is not dumped)"
CRON="$WORK/loadboot-prod-$STAMP.cron.csv"
psql "$SUPABASE_DB_URL" -At -F',' -c \
  "select jobid,schedule,command,nodename,active,jobname from cron.job order by jobid" \
  > "$CRON" 2>/dev/null || echo "(cron.job not readable - unknown, check manually)" > "$CRON"

echo "==> encrypt (age, public-key: CI can encrypt but never decrypt)"
age -r "$BACKUP_AGE_PUBKEY" -o "$DUMP.age" "$DUMP"
rm -f "$DUMP"

S3="aws s3 --endpoint-url $R2_ENDPOINT"
PREFIX="daily/$STAMP"
echo "==> upload to r2://$R2_BUCKET/$PREFIX/"
$S3 cp "$DUMP.age" "s3://$R2_BUCKET/$PREFIX/" --only-show-errors
$S3 cp "$TOC"      "s3://$R2_BUCKET/$PREFIX/" --only-show-errors
$S3 cp "$CRON"     "s3://$R2_BUCKET/$PREFIX/" --only-show-errors

# 1st of the month -> keep a copy that retention never touches
if [ "$(date -u +%d)" = "01" ]; then
  echo "==> monthly copy"
  $S3 cp "$DUMP.age" "s3://$R2_BUCKET/monthly/$STAMP/" --only-show-errors
fi
echo "==> db backup OK"
