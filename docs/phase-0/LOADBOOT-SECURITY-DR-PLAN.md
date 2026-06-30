# LOADBOOT — SECURITY & DISASTER-RECOVERY PLAN

## 1. Access model (current, real)

- **Deny by default.** `app_private` has RLS on with no policies and no API-role
  grants. All access flows through `public` SECURITY DEFINER `cc_*` RPCs gated on
  `has_global_permission()` / `is_active_staff()` / `my_carrier_org()`.
- **Carrier isolation.** Carrier RPCs (`cc_pocket_*`) resolve the carrier org
  from the session — no carrier-id parameter — so cross-carrier reads are
  impossible by construction.
- **Service-only functions.** Sensitive resolvers (e.g. `cc_push_targets`) are
  granted to `service_role` only and called from edge functions, never the
  browser. The browser never sees push keys or service-role keys (`env.js`
  refuses a service_role key).
- **Audit.** `log_audit()` → `audit_logs`; privileged actions recorded with actor,
  resource, before/after where relevant.

## 2. Threat model (top risks → control)

| Threat | Control (now) | Gap → plan |
|---|---|---|
| Cross-tenant data access | session-resolved scope, deny-by-default RLS | add explicit cell/tenant key + isolation tests |
| Privilege escalation | RBAC, last-owner protection, no self-escalate | add separation-of-duties + grant ceilings UI |
| Secret leakage to client | secrets in Supabase only; env.js guards | secret manager + rotation schedule |
| Injection / XSS / CSRF | parameterized RPCs, CSP, untrusted-data handling | WAF + dependency/secret scanning in CI |
| Bot / abuse / DDoS | Netlify + Supabase defaults | per-tenant rate limits + bot protection |
| Provider compromise | verify_jwt + in-fn re-check; Tier-2 isolation | DPA + data-classification gating for AI |
| Account takeover | Supabase auth | enforce MFA; session/device list + revoke |
| Insider misuse | audit log | break-glass + immutable audit archive |

## 3. Data classification

`public` (marketing), `internal` (ops metadata), `confidential` (rates, margins,
contacts), `restricted` (bank, tax IDs, driver PII, sensitive docs). Classification
drives masking, retention, and external-provider eligibility. Restricted data is
never sent to third-party AI/analytics.

## 4. Backup & recovery (current vs target)

**Current (Free tier):** no automatic PITR. Mitigation in place = **manual
logical JSON backups** (e.g. `loadboot-production-backup-*.json`, 13 tables) +
a documented restore runbook. Object storage not yet used.

**Targets:**
- **RPO ≤ 5 min, RTO ≤ 60 min** for Tier-0 data.
- Upgrade to a plan with **PITR**; schedule daily logical backups + WAL.
- **Object-storage backups** planned separately from DB backups (documents).
- **Cross-region copies** of backups; quarterly **restore drill** (a backup never
  restored in a test does not count as recovery).
- **Secrets recovery** procedure documented; keys rotatable without downtime.
- **Emergency read-only mode** and an **offline operations** fallback for dispatch.

## 5. Continuity / degradation

- Tier-0 (auth, load/trip read, dispatch, finance read) must survive Tier-1/2
  failures.
- Notification delivery failure must not lose the business event (event outbox is
  the source of truth; delivery retries from it; DLQ for poison messages).
- One tenant/region failure must not take down others (cell architecture target).

## 6. Privacy & compliance readiness

- Consent-based location (off by default; per-trip; revocable; only the assigned
  dispatcher can view; retention-limited).
- Anonymous analytics store no unnecessary PII.
- Planned: privacy-request (access/delete) workflow, legal hold, data-residency
  pinning by cell, vendor security review, retention engine enforcement.

## 7. Incident response (skeleton)

Detect (security_events + alerts) → triage (severity, blast radius) → contain
(revoke sessions/keys, flag-off affected module) → eradicate → recover (restore
if needed) → review (immutable timeline + audit) → improve (action items).
On-call runbooks per Tier-0 service are a Phase 1 deliverable.
