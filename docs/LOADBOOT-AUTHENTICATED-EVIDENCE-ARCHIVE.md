# LOADBOOT — Authenticated Evidence Archive (generated)

**Generated:** 2026-07-01T05:07:35Z · **Project:** rwscphuhpjoudvljvmdk (production)
**Validated against evidence/gate/live-source-evidence.json (captured 2026-07-01T05:07:35Z).**

## Gate

`LOADBOOT ENTERPRISE FOUNDATION GATE: FAIL` — PASS 10 / PARTIAL 0 / BLOCKED 2 / FAIL 0 of 12.

Named gates: SETTLEMENT MAKER CHECKER GATE: PASS | SOURCE-CONTROL REPAIR GATE: PASS | SOURCE-OF-TRUTH CONSISTENCY GATE: PASS | ANONYMOUS LOAD-SURFACE GATE: PASS | POD BACKEND SECURITY MATRIX GATE: PASS | POD UI AND REVIEW GATE: NOT-RUN | AUTHENTICATED PORTAL MOBILE PERSONA GATE: NOT-RUN | PACKAGE-WIDE REPRODUCIBLE VERIFICATION: PASS.

## Live counts

240 cc_* RPCs / 77 private tables / 51 modules / 30 flags / 8 edge functions / anon surface 5. Domain events: 21 total / 14 types /
**0 unprocessed**. Audit rows: 26. Plugins: 5/6.

## Golden-workflow evidence (live IDs)

- **Carrier onboarding** — PASS: 3 carrier orgs + 4 profiles
- **Verification (FMCSA)** — PASS: fmcsa-verify HTTP 200, real FMCSA data (GUFFEY-SCHLENSKER, DOT 130113); valid WebKey
- **Load offer & assignment** — PASS: load 92cd29be; load.assigned event
- **Trip / POD** — PARTIAL: trip lifecycle + POD frontend BUILT (Pocket + Carrier Portal upload UI + Command Center review queue) + POD backend security matrix 21/21 PASS on staging (upload/MIME/size/path/state validation, cross-carrier & non-reviewer denials, reject-with-reason, resubmit-new-version, approve->invoice-prep-once). Owner-run browser capture of the deployed flow still pending.
- **Invoice / settlement / payout approval** — PASS: INV-2026-00001 -> STL-2026-0001 -> approved -> paid; maker/checker enforced (11/11)
- **Marketing form -> CRM lead** — PASS: request-a-quote -> Westlane Logistics lead; form.submitted event

## Evidence provenance

Every PASS condition references an item in `evidence/gate/live-source-evidence.json`, each stamped with environment,
project, capture timestamp, query id and a content hash. Machine-checked at generation time.

## Evidence-capture notes

See the gate audit for each non-PASS condition's exact blocker. Every PASS carries a validated evidence reference; nothing was fabricated.
