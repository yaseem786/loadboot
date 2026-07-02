#!/usr/bin/env bash
# ESM syntax gate — catches what `node --check` (CommonJS parse) misses in ES modules:
# duplicate const/let declarations, truncated files, import/export errors.
# This exact class of bug shipped in 9b1bd56 (duplicate TONE + truncated boot())
# and broke the live carrier portal login. Run before every push.
set -u
FAIL=0
for f in $(find app -name '*.js'); do
  ERR=$(node --input-type=module --check < "$f" 2>&1)
  if [ -n "$ERR" ]; then
    FAIL=1
    echo "SYNTAX FAIL: $f"
    echo "$ERR" | head -4
  fi
done
if [ "$FAIL" -eq 0 ]; then
  echo "ESM SYNTAX CHECK: ALL PASS ($(find app -name '*.js' | wc -l) files)"
else
  exit 1
fi
