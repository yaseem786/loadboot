# LOADBOOT — EXECUTION ROADMAP

Sequenced so shared contracts lock before parallel work. Each item ships behind a
flag, with backward-compatible (expand → backfill → contract) migrations and a
rollback. "Done" = meets the 20-point completeness bar (see directive §2),
including real browser + RBAC + failure-path evidence.

## Acceptance gates (every capability)
1. Secured data model + server-side authz
2. Frontend + mobile behavior
3. CRUD lifecycle + search/filter/sort/pagination
4. Loading / empty / validation / error / permission-denied states
5. Related-record links + timeline + audit events
6. Notifications/tasks + automation hooks where applicable
7. API/event contract + export/report where applicable
8. Tests (happy/security/reliability/UX/data) + rollback
9. Real browser workflow proof + persona/RBAC proof
10. Production-readiness classification recorded in the capability registry

## PHASE 0 — Truth & architecture  _(this deliverable)_
Current-truth, capability registry, gap report, target architecture, API/event
contracts, security/DR, roadmap + **one executed improvement (live module
registry on staging)**. → **Foundation Gate**.

## PHASE 1 — Platform foundation  _(unblocks everything)_
Workstreams (parallel after contracts lock):
- **1A Storage & documents** — Supabase Storage bucket, signed URLs, AV-scan
  boundary, versioning, retention, review workflow. _Unblocks POD/BOL/COI._
- **1B Module registry (live)** — promote the Phase 0 staging registry to a
  governed service: every module self-registers events/permissions/audit/health;
  Command Center "System → Modules" reads it.
- **1C Idempotency + DLQ** — enforce `idempotency_keys` on mutating RPCs/edge
  calls; wire webhook retry/dead-letter + admin view.
- **1D Observability** — correlation IDs end-to-end, system-health view from
  `security_events`/cron/queue age, SLOs.
- **1E Continuity** — PITR upgrade + first restore drill.
Gate: storage proven, registry live, restore tested.

## PHASE 2 — Golden dispatch operations
Carrier onboarding wizard, compliance review loop, load lifecycle + offers +
race-safe assignment, trip execution + check-ins + POD, exceptions → SLA →
accessorial, invoice → settlement → **human payout approval** (maker/checker),
Pocket/Carrier parity. Prove golden workflows #2–#6, #8, #9.

## PHASE 3 — Complete self-service
Carrier team sub-accounts + field-level restrictions, full request/support
contract (find-a-load, detention, payment status, disputes…), document requests,
downloadable carrier reports, push end-to-end (device proof). Golden #7.

## PHASE 4 — Revenue & customers
CRM depth + attribution, **Broker / Shipper / Facility 360 + portals**, marketing
+ campaigns + forms + chat. Golden #1, #10.

## PHASE 5 — Intelligence & automation
Workflow builder (draft/publish/simulate/dry-run/DLQ), smart matching + rate
intelligence (advisory), anomaly detection, forecasts, AI copilot with data
classification gating. Golden #12.

## PHASE 6 — Global-scale architecture
Tenant/cell keys + isolation, read replicas + cache, analytics warehouse +
streaming, global search, **Developer/API Portal**, multi-region + DR drills,
capacity engineering. Golden #11, #13, #14.

## Parallelization rules
- Lock event envelope + API conventions + module-registry schema **first**
  (Phase 0/1B) — then teams build independently against contracts.
- No second incompatible task/notification/file/comment/approval/audit system.
- Tier-2 features (analytics/SEO/AI/reports) never block Tier-0 merges.

## Owner-blocked items (need your action, tracked separately)
- Plan upgrade for PITR (continuity).
- Provider keys for staging/preview (GA4/GSC/VAPID) and future ELD/payments/SSO.
- Decision on object-storage provider (Supabase Storage vs external S3).
