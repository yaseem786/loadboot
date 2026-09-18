#!/usr/bin/env bash
# LoadBoot - MONTHLY RESTORE DRILL (run on your own machine, never on prod).
# An untested backup is not a backup. Needs your age PRIVATE key.
#
#   ./restore_local.sh ~/Downloads/loadboot-prod-2026-10-01.dump.age ~/.age/loadboot.key
set -Eeuo pipefail
ENC="${1:?usage: restore_local.sh <file.dump.age> <age-identity-file>}"
IDENT="${2:?usage: restore_local.sh <file.dump.age> <age-identity-file>}"

DUMP="${ENC%.age}"
age -d -i "$IDENT" -o "$DUMP" "$ENC"

echo "==> starting throwaway Postgres 17"
docker rm -f lb-restore-test >/dev/null 2>&1 || true
docker run -d --name lb-restore-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17 >/dev/null
until docker exec lb-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

URL="postgresql://postgres:test@localhost:55432/postgres"
# Supabase roles/extensions do not exist here, so errors on GRANT/OWNER lines are expected.
pg_restore --no-owner --no-privileges --no-acl -d "$URL" "$DUMP" || true

echo "==> row counts in the restored copy:"
psql "$URL" -c "select 'profiles' t, count(*) from public.profiles
  union all select 'fleet_trucks', count(*) from public.fleet_trucks
  union all select 'auth.users', count(*) from auth.users
  union all select 'storage.objects', count(*) from storage.objects;"

echo
echo "Compare these against production. Then: docker rm -f lb-restore-test"
rm -f "$DUMP"
