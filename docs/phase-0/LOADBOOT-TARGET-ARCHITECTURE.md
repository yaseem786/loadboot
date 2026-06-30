# LOADBOOT — TARGET ARCHITECTURE

## 1. Current architecture (measured)

```
Visitors ─▶ Netlify CDN ─▶ static marketing site
                         └▶ /app/* SPA bundles (command-center, carrier)
                                   │ supabase-js (anon/JWT)
                                   ▼
        Supabase project (per env)
        ├─ Postgres 17.6  (public RPC API surface; app_private deny-by-default)
        │   ├─ 61 app_private tables  (ops + identity + events + audit + analytics)
        │   ├─ 153 cc_* SECURITY DEFINER RPCs  (RBAC-gated)
        │   └─ pg_cron: outbox(1m), sla(5m), anomaly(15m), compliance(daily)
        ├─ Auth (GoTrue)
        ├─ Edge Functions (Deno): ai-assist, fmcsa-verify, ga4/gsc-insights,
        │   notification-dispatcher, push-send, send-email, staff-invite
        └─ (no Storage bucket yet)
```

One database does everything. Adequate for current load (3 carriers, single
region). Not the target for the directive's scale.

## 2. Service boundaries (logical, target)

Keep the **modular monolith of RPCs** as the system of record, but split by
*owned domain* with explicit contracts so services can later extract:

- **Identity & Access** — auth, staff, roles, permissions, sessions, tenancy.
- **Sales/CRM** — leads, contacts, companies, pipelines, attribution.
- **Carrier & Fleet** — orgs, onboarding, compliance, drivers, equipment.
- **Partners** — brokers, shippers, facilities.
- **Loads & Dispatch** — loads, offers, matching, trips, exceptions.
- **Documents** — files, versions, review, retention (owns object storage).
- **Communications** — threads, channels, templates, delivery.
- **Notifications** — fan-out, channels, preferences, DLQ.
- **Finance** — invoices, settlements, disputes, payouts (maker/checker).
- **Analytics** — first-party ingest + warehouse + provider connectors.
- **Automation** — rules, tasks, SLA, scheduler.
- **Platform** — module registry, flags, settings, audit, security, webhooks,
  observability, idempotency.

Ownership rule: **no service writes another service's tables directly** — only
via that service's RPC/command or by reacting to its events.

## 3. Target data stores (separate roles)

| Role | Today | Target |
|---|---|---|
| Transactional OLTP | Postgres (shared) | Postgres primary + **read replicas**, partitioned by tenant/region |
| Identity | same Postgres | logical separation; SCIM/SSO ready |
| Object/documents | none | **Supabase Storage / S3** with signed URLs, AV scan, versioning |
| Event stream | `domain_events` table | durable bus (table outbox → Kafka/PubSub at scale) |
| Task queue | `automation_tasks` | dedicated queue + workers with backpressure |
| Cache | none | Redis (read-through, invalidation by event) |
| Full-text search | SQL ILIKE | search index (Postgres FTS → OpenSearch at scale) |
| Geospatial/time-series | `trip_locations` | PostGIS / time-series partition |
| Analytics warehouse | `web_*` tables | warehouse/lake (BigQuery/ClickHouse) + streaming |
| Audit/security archive | `audit_logs`, `security_events` | append-only, WORM/retention |
| Config/secrets | `system_settings` + Supabase secrets | secret manager + rotation |
| Backups | manual JSON | PITR + object-storage backup + cross-region copies |

## 4. Multi-region / cell strategy

- **Cell = (region, tenant-shard)**. Each cell is a self-contained stack
  (app + DB + cache + storage). A tenant is pinned to a home cell by
  `cell_key`; cross-cell access goes through APIs/events only.
- Global control plane holds the **tenant→cell directory**, flags, identity
  federation, and the module registry.
- Blast radius: one cell failing degrades only its tenants. Analytics/SEO/AI/
  reports run in non-critical lanes — their failure never blocks dispatch.

## 5. Reliability tiers (degradation contract)

- **Tier 0 (must never stop):** auth, load/trip read, dispatch actions,
  document read, finance read. Served from primary + replica + cache.
- **Tier 1 (degrade gracefully):** notifications (queue + DLQ, never lose the
  business event), communications, matching.
- **Tier 2 (best-effort):** analytics, SEO, reports, AI, marketing. Circuit-
  broken; failure shows a banner, not an outage.

## 6. Migration path (incremental, no big-bang)

1. **Extract storage** (documents) — first new data store; proves the
   service-owns-its-store pattern.
2. **Harden the event outbox** into the integration backbone (idempotent
   consumers, DLQ, schema registry).
3. **Introduce cache + read replica** for Tier 0 reads.
4. **Add tenant/cell keys** to every owned table (expand/contract migrations).
5. **Stand up the analytics warehouse**; move heavy reports off OLTP.
6. **Cellify**: deploy a second cell/region; route by `cell_key`.
7. **Search + geospatial** indexes as volume demands.

Every step ships behind a flag, is backward-compatible (expansion → backfill →
contraction), and is reversible.

## 7. Edge & protection (target)

Global CDN (Netlify today → multi-CDN), WAF, bot/DDoS protection, per-tenant
rate limits & quotas, request timeouts, circuit breakers, load shedding, and
regional traffic management in front of every surface.
