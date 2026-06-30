# LOADBOOT — CURRENT TRUTH

_Phase 0 evidence inventory. Generated from the live databases, the deployed edge
functions and the source tree. No capability is marked “live” unless there is
backing evidence (a table + RPC + frontend + a real production data point)._

## 0. Snapshot (measured)

| Signal | Production (`rwscphuhpjoudvljvmdk`) | Staging (`snslhvmkjusozgjelghi`) |
|---|---|---|
| `app_private` base tables | 61 | 61 |
| `public.cc_*` RPCs | 153 | 153 |
| Feature flags (total / on) | 30 / 28 | 30 / 27 |
| Carrier orgs (real) | 3 | — |
| First-party web sessions captured | 10 | 1 |
| Command Center view modules | 41 | 41 |
| Edge functions deployed | 8 | 8 |
| Source-controlled migrations | 98 | 98 |
| App surfaces | command-center, carrier, pocket, shared | same |

Plan tier: both projects are Supabase **Free** (no automatic PITR; manual logical
backups only — see Security/DR plan). This is the single largest scale/continuity
risk and is called out in the Gap Report.

## 1. Classification legend

- **LIVE** — production, flag-on, proven with real data or a real workflow.
- **FLAGGED** — production, behind a flag, code complete.
- **STAGING** — proven on staging, not yet exercised in production.
- **BACKEND-ONLY** — data model + RPC exist, frontend missing/partial.
- **FRONTEND-ONLY** — UI exists, backend/RPC missing.
- **PROVIDER-BLOCKED** — needs a third-party key/integration not yet supplied.
- **PLANNED** — directive requires it; not started.

## 2. Surfaces

| Surface | Path | State | Notes |
|---|---|---|---|
| Public marketing site | `/` | LIVE | Static, SEO-tuned, live load board, CRM form capture. |
| Staff Command Center | `/app/command-center/` | LIVE | 41 modules, RBAC, deep-linkable hash routes. |
| Carrier Portal | `/app/carrier/` | LIVE | Responsive dashboard (sidebar desktop / bottom-nav mobile), self-signup. |
| Driver Pocket (legacy) | `/app/pocket/` | DEPRECATED | Redirects to `/app/carrier/`. |
| Broker Portal | — | PLANNED | Backend `partners` table exists; no portal. |
| Shipper Portal | — | PLANNED | — |
| Facility Portal | — | PLANNED | — |
| Developer/API Portal | — | PLANNED | `webhook_endpoints`/`webhook_deliveries` tables exist; no portal/docs. |
| System Admin & Reliability Console | partial | BACKEND-ONLY | `security_events`, `system_settings`, flags admin exist; no unified console. |
| Support/Trust Center | partial | FLAGGED | Support module exists; no public trust center. |

## 3. Command Center modules (41) by evidence

**LIVE / FLAGGED (code complete, flag-gated, RPC + UI present):**
overview, radar (Ops Radar), management, actionCenter, dispatch, carriers,
loads, trips, documents, compliance, crm, forms, partners, support, seo, reports,
comms, notifications, announcements, chat, finance, **financeAnalytics (new)**,
content, campaigns, staffRoles, audit, integrations, flags, settings, automation,
automationsAdmin, carrier360, opsMap, fleet, analytics, analyticsWeb, googleData,
aiCopilot.

**PROVIDER-DEPENDENT (UI live, value depends on owner-supplied keys/secrets):**
- googleData (GA4 + Search Console) — **LIVE** once `GOOGLE_SA_KEY`, `GA4_PROPERTY_ID`,
  `GSC_SITE_URL` set (owner confirmed production secrets present).
- aiCopilot / ai-assist (Gemini) — LIVE with `GEMINI_API_KEY`.
- send-email (Resend) — LIVE with `RESEND_API_KEY`.
- fmcsa-verify (FMCSA) — LIVE with `FMCSA_WEBKEY`.
- push-send (Web Push) — LIVE with VAPID secrets (production set).

## 4. Shared platform services already present (foundations)

These directive “global shared services” already have a real schema/RPC basis:

| Service | Evidence | State |
|---|---|---|
| Identity & auth | Supabase Auth + `staff_members`, `staff_invitations` | LIVE |
| RBAC | `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `has_global_permission()` | LIVE |
| Org/tenancy | `organizations` (kind=carrier/broker/shipper) | PARTIAL (single-tenant ops) |
| Feature flags | `feature_flags` + `is_flag_enabled()` | LIVE |
| Config/settings | `system_settings`, `system_setting_defs` | LIVE |
| Event bus / outbox | `domain_events` + `emit_event()` + pg_cron `lb-process-outbox` | LIVE |
| Idempotency | `idempotency_keys` | BACKEND-ONLY |
| Task engine | `automation_tasks` | LIVE |
| Rules/workflow | `automation_rules` + outbox processor | FLAGGED |
| Notification engine | `notifications` + `notification-dispatcher` fn + push-send | LIVE |
| Communication threads | `comm_threads`, `comm_messages`, `comm_templates`, `chat_messages` | FLAGGED |
| Document/file service | `document_files` (metadata) | BACKEND-ONLY (no storage bucket yet) |
| Audit log | `audit_logs` + `log_audit()` | LIVE |
| Security events | `security_events` | BACKEND-ONLY |
| Webhooks/integrations | `webhook_endpoints`, `webhook_deliveries`, `integration_configs` | BACKEND-ONLY |
| SLA/escalation | pg_cron `lb-sla-escalation` | FLAGGED |
| Scheduler | pg_cron (outbox 1m, SLA 5m, anomaly 15m, compliance daily) | LIVE |
| First-party analytics | `web_sessions`, `web_events` + beacon | LIVE (10 real prod sessions) |

## 5. Domain data already modelled

CRM (`crm_leads/contacts/companies/pipelines/stages/activities`), carriers
(`organizations`, `carrier_onboarding`, `carrier_compliance`, `carrier_safety`,
`compliance_requirements`), fleet (`fleet_drivers/trucks/trailers`), loads/trips
(`trips`, `trip_stops/events/locations/exceptions/accessorials`), finance
(`fin_invoices/settlements/disputes/adjustments`), partners (`partners`),
content/SEO (`content_pages/posts`, `seo_keywords`, `redirects`), comms,
announcements, campaigns, forms (`form_submissions`), push (`push_subscriptions`),
ELD (`eld_integrations`).

## 6. Honest verdict

LoadBoot is **already a substantial, RBAC-secured, event-driven operations
platform** — far past “demo.” The real gaps are not “missing tables”; they are:
(a) **proof/completeness** of each workflow end-to-end on every persona and device,
(b) **missing external-facing portals** (broker/shipper/facility/developer),
(c) **object storage** for documents (metadata exists, bucket does not),
(d) **scale/continuity architecture** (single Free-tier Postgres, no PITR, no
cells/multi-region), and (e) a **live module/capability registry** so new modules
integrate uniformly. These are addressed in the Gap Report, Target Architecture
and Roadmap.
