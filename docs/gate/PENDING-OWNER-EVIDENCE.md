# PENDING OWNER EVIDENCE (non-blocking)

These items require a real human login and/or site egress and are therefore **owner-executed**. They do
**not** block unrelated product development (per Fast Product-Completion Mode). Everything here is
**code-complete and backend-proven**; only the browser capture remains.

Current honest gate (unchanged, do not falsely flip to PASS):

```
LOADBOOT ENTERPRISE FOUNDATION GATE: PASS 10 / BLOCKED 2 of 12
```

| # | Item | Code status | What the owner must do | Where evidence lands |
|---|------|-------------|------------------------|----------------------|
| 1 | **POD UI AND REVIEW** browser proof | Built (Pocket + Carrier Portal upload UI + Command Center review queue); backend matrix 21/21 PASS on staging | Deploy → log in as carrier/driver/staff → run `tests/security/pod_workflow.spec.js` | `evidence/gate/pod/*.png` + Playwright JSON |
| 2 | **AUTHENTICATED PERSONA MATRIX** browser run | Built + strengthened (server-side denial checks, 44 combos); skips cleanly without storage-states | Generate per-persona storage-states via `tests/security/auth-setup.spec.js`, then run `persona_matrix.spec.js` with `PERSONAS_READY=1` | `evidence/gate/persona-playwright-results.json` (0 skips) + HTML report |

Runbook: `tests/security/PERSONA-TEST-RUNBOOK.md`. When both are captured, re-run
`python3 scripts/generate_gate_artifacts.py` and `python3 scripts/verify_handoff_package.py`; only then does
the gate become a genuine `PASS 12 / 12`.

---

## Also tracked (feature backlog surfaced during sprints)

- Marketing website testimonials: real customer testimonials are pending real customers. The
  `case-studies.html` page ships **clearly-labelled illustrative examples only** — no fabricated
  testimonials or earnings claims (per owner constraint).
- Provider credentials for live sends (email/SMS providers) may remain "Not connected"; the UI, backend and
  queues are built and function without them.
- Carrier team **email invites** for brand-new users are deferred: they need an auth signup/invite flow.
  Existing-member management (role/status) is built and proven (`cus_carrier_team`). Adding invites later
  requires an invite token table + a signup redemption path.
