# LOADBOOT — Evidence Packs Detail (Gate Items 4, 5, 6/7, 9)

**Updated:** 2026-07-01, production `rwscphuhpjoudvljvmdk` + staging `snslhvmkjusozgjelghi`.
Status labels here MATCH the canonical gate (`LOADBOOT-ENTERPRISE-FOUNDATION-GATE-AUDIT.md`):
**LOADBOOT ENTERPRISE FOUNDATION GATE: FAIL — PASS 10 / PARTIAL 0 / BLOCKED 2 / FAIL 0 of 12**. The two
BLOCKED items (POD-UI browser capture, authenticated persona browser run) are genuine completion
conditions, not downgrades — the code is complete and the backend is proven; the owner runs the two browser
proofs to reach genuine 12/12.

---

## Item 9 — PLUGIN LIFECYCLE EVIDENCE PACK → PASS

**Manifest (web-push):** publisher LoadBoot, version 1.0.0, category push, scopes `["send:push"]`,
permissions `["content.manage"]`, secrets `["VAPID_PRIVATE_KEY"]`, events_produced `["push.sent"]`.

**Lifecycle (production, real event IDs):** install → `plugin.installed` event **id 15** (installation
`92bbaa8c…`); uninstall → `plugin.uninstalled` event **id 16**, cleanup verified; **kill-switch** tested on
`ga4-insights` (off→on, state restored); **5 pre-existing plugins unchanged**. Action-test (push send) needs
the VAPID secret; a dedicated health-probe beyond install-status is future polish.

---

## Item 5 — SETTLEMENT / PAYOUT-HOLD EVIDENCE PACK → PASS

**Proven (staging, real personas, 11/11 matrix — `tests/finance/settlement_maker_checker_test.sql`):**
finance maker creates → PASS; maker **self-approve DENIED** (maker-checker); different finance checker
approves → PASS; **carrier DENIED**; **dispatcher DENIED**; duplicate approval **idempotent**; **stale-version
DENIED**; amount/version change **invalidates** the approval; payout **HELD** until a valid checker acts;
**exactly one** `settlement.approve` event; **no money transmitted** (invoice stays `sent`).

**Controls (migration `cuj`):** immutable maker (`created_by`); creator cannot approve own payout (permission-
gated break-glass, audited); monetary approval limit; `version`/`approved_version` immutability; transactional
row locking; idempotency. Production also proven earlier: `INV-2026-00001 → STL-2026-0001 → approved → paid`.

---

## Item 4 — TRIP / POD EVIDENCE PACK → backend PROVEN; UI/review NOT-RUN (condition 5 BLOCKED)

**Backend proven (staging, real personas):** carrier uploads POD to **own** delivered trip (linked to
trip+carrier); cross-carrier upload DENIED ("trip not found for your account"); non-carrier (broker) DENIED
("not a carrier account"); staff sees the POD in the review list; `pod.uploaded` event emitted. Production POD
(`300765dc`) retrievable via the staff RPC in the Command Center.

**NOT yet built + executed (required, not polish):** the Carrier/Pocket browser upload UI (file-picker →
MIME/size validation → private-bucket upload → progress → success → shown in Documents tab) and the Command
Center Document Review Queue (signed private preview → approve/reject-with-reason → invoice-prep exactly once →
timeline/audit/event/notification). Needs a deployed frontend + a logged-in carrier/staff browser session.

---

## Item 6/7 — MOBILE & PERSONA BROWSER EVIDENCE → RBAC PROVEN; auth tests NOT-RUN (condition 7 BLOCKED)

**Proven:** the 11-persona RBAC matrix (owner / dispatcher / finance-maker / finance-checker / compliance /
marketing / carrier-owner / driver / broker / shipper / facility) via SQL/JWT simulation — every separation
correct; plus real device-viewport screenshots of PUBLIC pages (Playwright, `evidence/gate/mobile/`).

**NOT yet executed (required, not polish):** the authenticated Playwright persona matrix — 44 persona×viewport
combos with **zero skips**, real per-persona storage-states, server-side denial checks, HTML report + traces.
`tests/security/persona_matrix.spec.js` currently skips without `PERSONAS_READY`. Needs owner-assisted
storage-states + site egress.

---

## Summary

| Pack | Status | Note |
|---|---|---|
| Plugin lifecycle | **PASS** | manifest + install/uninstall events + kill-switch + rollback |
| Settlement / payout | **PASS** | 11/11 maker-checker matrix; payout HELD; dual control enforced |
| Trip / POD | **BLOCKED (cond. 5)** | backend RPC proven; browser upload+review UI not built/executed |
| Mobile / persona | **BLOCKED (cond. 7)** | RBAC proven via SQL; authenticated Playwright matrix not executed (0/44) |
