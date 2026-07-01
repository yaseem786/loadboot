# LOADBOOT — Handoff Package for ChatGPT (v7 — code-complete, honest 10/12)

**Generated:** 2026-07-01 · **Production:** `rwscphuhpjoudvljvmdk` · **Staging:** `snslhvmkjusozgjelghi`

This package is **honestly NOT a genuine 12/12**. The two remaining conditions are **real completion
conditions, not optional polish** — they stay BLOCKED with no reclassification. What changed since v6: the
**POD frontend is now built** (carrier + driver upload UI and the Command Center review queue), the **POD
backend is hardened and proven** by a 21-check security matrix on staging, and the **authenticated persona
test system is built and strengthened** to prove *server-side* enforcement. All that remains for genuine
12/12 is the owner running the two **browser** proofs against the deployed site (the assistant cannot type
passwords or reach the site headlessly).

## The one consistent total

```
LOADBOOT ENTERPRISE FOUNDATION GATE: FAIL
Gate summary: PASS 10 / PARTIAL 0 / BLOCKED 2 / FAIL 0 of 12
```

Named gates: SETTLEMENT MAKER CHECKER: PASS · SOURCE-CONTROL REPAIR: PASS · SOURCE-OF-TRUTH CONSISTENCY: PASS ·
ANONYMOUS LOAD-SURFACE: PASS · **POD BACKEND SECURITY MATRIX: PASS** · **POD UI AND REVIEW: NOT-RUN** ·
**AUTHENTICATED PORTAL MOBILE PERSONA: NOT-RUN** · PACKAGE-WIDE REPRODUCIBLE VERIFICATION: PASS.

## What is now built and proven (code-complete)

- **POD carrier/driver upload UI.** Pocket app (`app/pocket/pocket.js`) and Carrier Portal
  (`app/carrier/app.js`): appears only for delivered/invoiced trips; file **and** camera picker (mobile) plus
  **drag-and-drop** (desktop); client validation of type (PDF/JPG/PNG/WEBP) and size (≤10 MB); preview,
  remove/replace, upload state, success, network-failure **retry**, and display of existing version + review
  status + **rejection reason** + **resubmit**.
- **Command Center POD Review Queue** (`app/command-center/views/podReview.js`): pending/approved/rejected
  tabs with carrier + route + delivery context, **signed private preview** (2-min TTL), **Approve**, and
  **Reject** (reason required). Approval prepares the invoice exactly once.
- **Hardened backend** (`migrations/ct-waveBI-security-gate-repair/cul…cup`): every upload re-validates
  carrier org, trip ownership, **trip state, MIME, size and the `{uid}/pod/{trip}/{file}` object path**
  server-side (the browser is never trusted). Reviewer RPCs are permission-gated; approval emits
  `invoice.prep_requested` exactly once.
- **POD backend security matrix** (`tests/security/pod_backend_matrix.sql`): **21/21 PASS** on staging,
  covering the directive's checks 1,3,5–11,13–18,20 (valid upload; cross-carrier / anonymous / bad-MIME /
  oversized / bad-state / traversal-path / wrong-trip-path denials; duplicate = new immutable version;
  reviewer preview allowed / non-reviewer denied; reject-needs-reason; resubmit new version; approve →
  invoice-prep-once).
- **Strengthened persona matrix** (`tests/security/persona_matrix.spec.js`): now proves **server-side**
  enforcement — for 11 personas × 4 viewports it calls a **forbidden RPC directly** with the persona's token
  and asserts the backend denies it, plus permitted-RPC success, portal isolation, mobile menu, no overflow,
  clean console, no env leakage, screenshot.

## The two genuinely-open conditions (BLOCKED, not polish)

- **#5 POD UI AND REVIEW — browser capture.** All code is written and the backend matrix passes; what is
  missing is the **real browser run** against the deployed site with a logged-in carrier/driver/staff session,
  captured under `evidence/gate/pod/` (see `tests/security/pod_workflow.spec.js`).
- **#7 AUTHENTICATED PERSONA MATRIX — browser run.** The spec + setup + runbook are written and skip cleanly
  without storage-states; what is missing is the **owner-run** matrix with **zero skips** across the 44
  persona×viewport combinations, producing `persona-playwright-results.json` + HTML report + traces.

## Why the assistant cannot close these itself (honest environment limits — not LoadBoot defects)

1. The assistant is **prohibited from typing passwords** → cannot create authenticated persona sessions.
2. **Headless Chromium egress to the site is blocked** in this sandbox (proven: `ERR_TUNNEL`).
3. Frontend changes deploy only via the **owner's GitHub push**.

## Exact runbook to reach genuine 12/12 (owner-executed)

See `tests/security/PERSONA-TEST-RUNBOOK.md`. In short:

1. Push the branch → Netlify staging preview.
2. Confirm the 11 staging personas, then generate per-persona storage-states via
   `tests/security/auth-setup.spec.js` (credentials via local env, never committed; `.auth/` is gitignored).
3. `PERSONAS_READY=1 … npx playwright test tests/security/persona_matrix.spec.js --reporter=list,json,html`
   → **44 passed, 0 skipped**.
4. `PERSONAS_READY=1 … npx playwright test tests/security/pod_workflow.spec.js --reporter=list,json,html`
   → real carrier/driver upload + staff review, screenshots under `evidence/gate/pod/`.
5. Drop the sanitized results into `evidence/gate/`, then run
   `python3 scripts/generate_gate_artifacts.py` **and** `python3 scripts/verify_handoff_package.py`.
   Only when BOTH pass **with the real browser evidence** does the gate become genuine 12/12.

## Reproducible verification (included, standalone)

`python3 scripts/verify_handoff_package.py` — checks manifest hashes, regenerates + compares artifacts, scans
for contradictions/stale version labels, validates evidence refs, and **refuses to accept a 12/12 claim**
without `evidence/gate/persona-playwright-results.json` (zero skips) + POD screenshots under `evidence/gate/pod/`.
On this honest package it returns PASS (integrity) while reporting the 2 NOT-RUN browser gates.

## Read first

`LOADBOOT-ENTERPRISE-FOUNDATION-GATE-AUDIT.md` (canonical 12-condition table) ·
`LOADBOOT-POD-AND-PERSONA-DELIVERY.md` (what shipped this round + owner steps) ·
`tests/security/PERSONA-TEST-RUNBOOK.md` · `scripts/verify_handoff_package.py` ·
`evidence/gate/live-source-evidence.json` · `docs/gate/FILE-MANIFEST.json` (per-file SHA).
