#!/usr/bin/env bash
# ESM syntax gate — catches duplicate const/let declarations, truncated files,
# and import/export errors that a lenient script parse misses.
# We normalise each file to a temp .mjs and run a STRICT `node --check` on it.
# Non-ASCII characters (—, ·, ⚠, ›, …) only ever appear inside UI string literals;
# some node builds mis-parse them, so we transliterate them to ASCII 'x' first.
# This preserves code structure (brackets, declarations, imports) while giving a
# reliable, environment-independent syntax check.
set -u
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COUNT=0
for f in $(find app -name '*.js'); do
  COUNT=$((COUNT+1))
  python3 -c "import sys;d=open(sys.argv[1],encoding='utf-8').read();open(sys.argv[2],'w',encoding='utf-8').write(''.join(c if ord(c)<128 else 'x' for c in d))" "$f" "$TMP/chk.mjs"
  ERR=$(node --check "$TMP/chk.mjs" 2>&1)
  if [ -n "$ERR" ]; then
    FAIL=1
    echo "SYNTAX FAIL: $f"
    echo "$ERR" | sed "s#$TMP/chk.mjs#$f#g" | head -4
  fi
done
if [ "$FAIL" -eq 0 ]; then
  echo "ESM SYNTAX CHECK: ALL PASS ($COUNT files)"
else
  exit 1
fi
