#!/usr/bin/env python3
"""apply_f07_build_default.py — audit F07 (Sprint 1, 2026-09-05): a local build must NEVER point at production by accident.

Before: `python build_site.py` with no CONTEXT ('dev') targeted the PRODUCTION Supabase project, so any
browser/Playwright test against localhost hit real users' data.
After:  'dev' targets STAGING. If LOADBOOT_STAGING_ANON_KEY is missing the build FAILS CLOSED with the two
        explicit ways forward. Netlify is unchanged (it always sets CONTEXT; 'production' still targets prod).
        A deliberate local prod-bound build is still possible, but only by saying so:
            LOADBOOT_CONTEXT=production python build_site.py

Idempotent, anchor-guarded (refuses to run if the anchors are not found exactly once), leaves a .bak.
Run from the repo root on the CURRENT disk copy — build_site.py is edited by several lanes, never overwrite it
from a clone.  Usage:  python docs/audit-2026-09/apply_f07_build_default.py [--check]
"""
import sys, os, shutil, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
P = os.path.join(ROOT, "build_site.py")
src = open(P, encoding="utf-8").read()
MARK = "# audit F07 (2026-09-05): local builds are staging-bound"

OLD = """# 'dev' (no CONTEXT env var = a local build on the owner's machine) targets the PRODUCTION
# project with the PUBLIC publishable key — the same key every visitor's browser receives —
# so localhost works out of the box. Netlify previews/branches are still staging-locked:
# they always set CONTEXT, so they can never be 'dev'.
TARGETS_PROD = IS_PRODUCTION_CTX or _CTX == 'dev'
"""
NEW = """# audit F07 (2026-09-05): local builds are staging-bound. 'dev' (no CONTEXT env var = a local
# build on the owner's machine) now targets STAGING, so localhost/Playwright can never touch real
# users by accident. Netlify always sets CONTEXT ('production' → prod, everything else → staging).
# A deliberate local PROD-bound build must say so:  LOADBOOT_CONTEXT=production python build_site.py
TARGETS_PROD = IS_PRODUCTION_CTX
if not TARGETS_PROD and not STAGING_ANON:
    sys.stderr.write(
        "\\nBUILD REFUSED — this is a STAGING-bound build (CONTEXT=%r) but LOADBOOT_STAGING_ANON_KEY is not set.\\n"
        "  • For local testing against staging:  set LOADBOOT_STAGING_ANON_KEY=<staging anon key>  (Supabase → snslhvmkjusozgjelghi → API)\\n"
        "  • For a deliberate production-bound local build:  set LOADBOOT_CONTEXT=production  (then never deploy that output by hand)\\n\\n" % _CTX)
    sys.exit(2)
"""

def count(h, n): return h.count(n)

if MARK in src:
    print("F07: already applied — nothing to do"); sys.exit(0)
if count(src, OLD) != 1:
    print("F07: anchor block not found exactly once (found %d). build_site.py differs — inspect lines ~40-50 before patching." % count(src, OLD)); sys.exit(1)
if "import sys" not in src.split("PROD_REF")[0] and not re.search(r"^import .*\\bsys\\b|^import sys", src, re.M):
    # build_site.py must have sys available before the guard runs
    src = src.replace("import os", "import os, sys", 1)
if "--check" in sys.argv:
    print("F07: anchors OK, would patch"); sys.exit(0)
shutil.copyfile(P, P + ".bak-f07")
open(P, "w", encoding="utf-8").write(src.replace(OLD, NEW))
print("F07: patched build_site.py (backup: build_site.py.bak-f07). Local builds now target staging; prod needs LOADBOOT_CONTEXT=production.")
