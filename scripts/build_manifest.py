#!/usr/bin/env python3
"""build_manifest.py — deterministically (re)build docs/gate/FILE-MANIFEST.json for the handoff package.

Hashes are computed from the files on disk, never hand-typed. verify_handoff_package.py re-checks every
hash. Run after regenerating gate artifacts and before packaging.
"""
import json, os, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()

PACKAGE = "LoadBoot-ChatGPT-Handoff-2026-07-01-v7-10of12.zip"
GATE = "FAIL 10/12 (2 BLOCKED: POD-UI browser capture, persona browser run) — code-complete, owner runs the two browser proofs"

# canonical file list (relative to repo root). Missing files are skipped with a warning.
FILES = [
    # generated + narrative docs
    "docs/README-FOR-CHATGPT.md",
    "docs/LOADBOOT-ENTERPRISE-FOUNDATION-GATE-AUDIT.md",
    "docs/LOADBOOT-LIVE-STATE-SNAPSHOT.json",
    "docs/LOADBOOT-CAPABILITY-REGISTRY.json",
    "docs/LOADBOOT-AUTHENTICATED-EVIDENCE-ARCHIVE.md",
    "docs/LOADBOOT-SECURITY-MIGRATION-PROOF.md",
    "docs/LOADBOOT-EVIDENCE-PACKS-DETAIL.md",
    "docs/LOADBOOT-PRODUCTION-TESTDATA-GOVERNANCE.md",
    "docs/LOADBOOT-BACKUP-DR-RUNBOOK.md",
    "docs/LOADBOOT-IDEMPOTENCY-CORRELATION-STANDARD.md",
    "docs/LOADBOOT-PORTAL-DEPTH-AUDIT.md",
    "docs/LOADBOOT-POD-AND-PERSONA-DELIVERY.md",
    # gate tooling + evidence
    "scripts/gate_facts.json",
    "scripts/generate_gate_artifacts.py",
    "scripts/verify_handoff_package.py",
    "scripts/build_manifest.py",
    "evidence/gate/live-source-evidence.json",
    # tests
    "tests/finance/settlement_maker_checker_test.sql",
    "tests/security/personas.js",
    "tests/security/persona_matrix.spec.js",
    "tests/security/auth-setup.spec.js",
    "tests/security/pod_workflow.spec.js",
    "tests/security/pod_backend_matrix.sql",
    "tests/security/PERSONA-TEST-RUNBOOK.md",
    "tests/security/.env.example",
    "playwright.config.js",
    # security + POD migrations (source-controlled, applied staging + prod)
    "migrations/ct-waveBI-security-gate-repair/cuf_revoke_anon_execute_internal_rpcs.sql",
    "migrations/ct-waveBI-security-gate-repair/cug_pin_search_path_helper_fns.sql",
    "migrations/ct-waveBI-security-gate-repair/cuh_lockdown_pocket_available_loads.sql",
    "migrations/ct-waveBI-security-gate-repair/cui_maker_checker_settlement_approval.sql",
    "migrations/ct-waveBI-security-gate-repair/cuj_settlement_maker_checker_hardening.sql",
    "migrations/ct-waveBI-security-gate-repair/cuk_rerevoke_decide_settlement_anon.sql",
    "migrations/ct-waveBI-security-gate-repair/cul_pod_review_workflow.sql",
    "migrations/ct-waveBI-security-gate-repair/cum_pocket_pod_status.sql",
    "migrations/ct-waveBI-security-gate-repair/cun_pod_upload_hardening.sql",
    "migrations/ct-waveBI-security-gate-repair/cuo_pod_queue_enrich.sql",
    "migrations/ct-waveBI-security-gate-repair/cup_register_pod_module.sql",
    # POD frontend source (carrier/driver upload + Command Center review)
    "app/pocket/pocket.js",
    "app/pocket/pocket.css",
    "app/carrier/app.js",
    "app/carrier/carrier.css",
    "app/command-center/views/podReview.js",
    "app/command-center/app.js",
    "app/command-center/views/shell.js",
    "app/shared/api.js",
    "app/shared/storage.js",
    # public-page responsive evidence
    "evidence/gate/mobile/home__android-412x915.png",
    "evidence/gate/mobile/home__desktop-1280x800.png",
    "evidence/gate/mobile/home__mobile-390x844.png",
    "evidence/gate/mobile/home__tablet-768x1024.png",
    "evidence/gate/mobile/pricing__android-412x915.png",
    "evidence/gate/mobile/pricing__desktop-1280x800.png",
    "evidence/gate/mobile/pricing__mobile-390x844.png",
    "evidence/gate/mobile/pricing__tablet-768x1024.png",
    "evidence/gate/mobile/services__android-412x915.png",
    "evidence/gate/mobile/services__desktop-1280x800.png",
    "evidence/gate/mobile/services__mobile-390x844.png",
    "evidence/gate/mobile/services__tablet-768x1024.png",
]

files = {}
missing = []
for rel in FILES:
    fp = os.path.join(ROOT, rel)
    if os.path.exists(fp):
        files[rel] = sha(fp)
    else:
        missing.append(rel)

man = {"generated": "2026-07-01", "package": PACKAGE, "gate": GATE, "files": files}
outp = os.path.join(ROOT, "docs/gate/FILE-MANIFEST.json")
os.makedirs(os.path.dirname(outp), exist_ok=True)
json.dump(man, open(outp, "w"), indent=2)
print(f"FILE-MANIFEST.json written: {len(files)} files")
if missing:
    print("WARNING missing (skipped):")
    for m in missing: print("  -", m)
