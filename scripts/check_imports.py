#!/usr/bin/env python3
"""check_imports.py — catch api functions that are USED but not IMPORTED.

`node --check` validates syntax but not undefined references, so a wrapper used without its import throws
only at runtime. This scans every app JS file for calls to names exported by app/shared/api.js that are
neither imported nor locally declared (excluding method calls `x.name(` and a few browser globals).

Exit non-zero if any are found. Run as part of local release gates.
"""
import re, glob, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
api = open(os.path.join(ROOT, "app/shared/api.js")).read()
exports = set(re.findall(r'export\s+const\s+([A-Za-z0-9_]+)\s*=', api))
BROWSER = {'postMessage', 'fetch', 'close', 'open', 'confirm', 'alert', 'print'}
problems = []
for f in glob.glob(os.path.join(ROOT, "app/**/*.js"), recursive=True):
    if f.endswith("shared/api.js"):
        continue
    s = open(f).read()
    imported = set(re.findall(r'\b([A-Za-z0-9_]+)\b', ' '.join(re.findall(r'import\s*\{([^}]*)\}', s))))
    local = set(re.findall(r'(?:const|let|function)\s+([A-Za-z0-9_]+)', s))
    called = set(re.findall(r'(?<![.\w])([A-Za-z0-9_]+)\s*\(', s))
    missing = sorted(n for n in called if n in exports and n not in imported and n not in local and n not in BROWSER)
    if missing:
        problems.append((os.path.relpath(f, ROOT), missing))

if problems:
    print("IMPORT-REFERENCE CHECK: FAIL")
    for f, m in problems:
        print(f"  - {f}: used but not imported -> {m}")
    sys.exit(1)
print("IMPORT-REFERENCE CHECK: PASS")
