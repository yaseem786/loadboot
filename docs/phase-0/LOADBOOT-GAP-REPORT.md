# LOADBOOT — GAP REPORT

_Measured gaps between the current platform and the Master Directive. Ordered by
risk. “Risk” = blast radius × likelihood × difficulty to retrofit later._

## A. Critical / foundational (fix before mass feature work)

1. **No object storage for documents (BACKEND_ONLY).** `document_files` holds
   metadata; there is no Supabase Storage bucket, signed-URL flow, virus-scan
   boundary, versioning or retention. Blocks: POD/BOL/COI/W-9 upload, the
   doc-request→upload→review golden workflow. _Retrofit cost: medium._
2. **No PITR / tested restore (continuity).** Both projects are Free tier; only
   manual logical JSON backups exist. RPO/RTO undefined; no restore drill.
   _Retrofit cost: low (upgrade) but high consequence if delayed._
3. **Single-tenant operational model.** `organizations` exists but there is no
   legal-entity / region / cell key, no tenant isolation tests, no per-tenant
   rate limits. Required before onboarding many client companies. _High._
4. **No live module/capability registry.** New modules are wired by hand in
   `shell.js` + `app.js`; nothing enforces the “module factory” contract
   (events, permissions, audit, health). _Addressed in Phase 0 improvement._
5. **Scale architecture is single-node.** One Supabase Postgres for transactional
   + analytics + audit + events. No read replicas, cache layer, search index,
   warehouse, queue workers, or multi-region. Acceptable now (3 carriers) but is
   the long-pole for the stated 10⁸-user target.

## B. Missing external surfaces (PLANNED)

- Broker Portal, Shipper Portal, Facility Portal — `partners` table exists; no
  portals, no scoped auth boundaries, no portal feature flags.
- Developer/API Portal — `webhook_endpoints`/`deliveries` exist; no public API
  versioning, docs, keys, or rate-limit headers.
- System Administration & Reliability Console — pieces (`security_events`,
  flags, settings) exist; no unified operator console or SLO dashboards.
- Public Trust/Status Center.

## C. Workflow completeness (FLAGGED → needs end-to-end proof)

Most operational modules are code-complete but **unproven against the 20-point
completeness bar** (RBAC matrix, mobile, failure paths, audit/event/notification
evidence, performance, rollback). Specifically unproven end-to-end:
- load → match → offer → accept → assignment (race-safety untested)
- dispatch → check-ins → POD (POD blocked by storage)
- exception → SLA → accessorial → finance
- invoice → settlement → **human payout approval** (maker/checker present in
  schema; UI/approval-limit proof pending)
- carrier team sub-accounts & field-level restrictions (rates/margins hiding)

## D. Provider-blocked (OWNER action, not engineering)

| Capability | Needs | Status |
|---|---|---|
| Google Analytics / Search Console | `GOOGLE_SA_KEY`, `GA4_PROPERTY_ID`, `GSC_SITE_URL` | Production secrets confirmed; preview/staging pending |
| AI copilot / assist | `GEMINI_API_KEY` | Set |
| Email | `RESEND_API_KEY` | Set |
| FMCSA verify | `FMCSA_WEBKEY` | Set |
| Web push | VAPID (`PUBLIC`/`PRIVATE`/`SUBJECT`) | Production set; staging pending |
| ELD live tracking | per-provider OAuth | `eld_integrations` table only — PLANNED |
| Factoring / payments | provider contracts | PLANNED |
| SSO/SAML/OIDC, SCIM | IdP config | readiness only |

## E. Cross-cutting hardening (BACKEND_ONLY → wire up)

- Idempotency keys exist but are not enforced on all mutating RPCs/edge calls.
- Webhook signing/delivery/retry/dead-letter present in schema; no admin UI or
  proven retry/DLQ workflow.
- Security events captured but no alerting/console.
- WAF / DDoS / bot protection: rely on Netlify + Supabase defaults; no explicit
  rate-limit / quota layer per tenant.
- No automated test matrix in CI (happy/security/reliability/UX/data) — testing
  is currently manual + build-gate.

## F. What is genuinely solid today (do not rebuild)

RBAC + deny-by-default `app_private` schema, event outbox + scheduler, audit,
first-party analytics with real production sessions, 153 RPCs, 41 modules,
the redesigned responsive Carrier Portal, and Command Center→carrier push.
These are the platform spine to build the registry and portals on.

## Priority sequencing (see Roadmap for detail)

1. Object storage + document lifecycle (unblocks compliance & POD).
2. PITR upgrade + restore drill (continuity).
3. Live module registry (this Phase 0 improvement).
4. Tenancy keys + isolation tests (before broker/shipper portals).
5. CI test matrix + idempotency enforcement.
6. External portals (broker → shipper → facility → developer).
7. Scale architecture (cells, replicas, cache, warehouse, queues).
