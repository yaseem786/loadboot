# LoadBoot — Dispatch OS: Completion & Handover Report

**Status: COMPLETE — live on staging and production.**
Date: 30 June 2026 · Backend: Supabase PostgreSQL 17.6 (production + staging) · Frontend: Netlify

---

## 1. What was built

LoadBoot is a full truck-dispatching operating system for owner-operators and small fleets. It is delivered as one secured backend with two separate frontend surfaces:

- **Command Center** — the internal staff console (operations, sales, finance, marketing, admin).
- **Carrier Pocket App** — a carrier-facing mobile surface where each carrier sees only their own data.

Every capability was built as an independent, feature-flagged module on a shared, reusable Automation Core, then proven end-to-end before going live.

## 2. Modules (all live)

| Layer | Module | What it does |
|---|---|---|
| Core | Command Center | Operator console: overview, carriers, loads, documents, staff & roles, audit, feature flags, settings |
| Core | Automation Core | Event → rules → tasks/notifications engine, with idempotency, retry/dead-letter, SLA timers and a human-approval gate |
| Wave 1 | CRM & Sales | Leads, pipeline, activities; new lead auto-creates a sales follow-up task |
| Wave 2 | Carrier Onboarding & Compliance | Document/credential checklist (MC authority, COI, W-9, MCS-150, safety), expiry tracking, onboarding workflow with an approval gate |
| Wave 3 | Loads / Dispatch / Trips | Trip lifecycle (planned → dispatched → in transit → delivered → invoiced), stops, status timeline; auto-creates driver, check-call and invoice tasks |
| Wave 4 | Communications | Message threads, notification center, message templates |
| Wave 5 | Finance | Flat-5% dispatch-fee invoices from delivered trips; carrier settlements with a payout approval gate |
| Wave 6 | Analytics | Live dashboards: revenue, on-time %, loads/trips breakdowns, top carriers |
| Wave 7 | Content / Marketing | Blog posts (draft/publish/archive) and editable site pages |
| Wave 8 | Integrations / Webhooks | Connected-integration catalog and https-only webhook endpoints (deliveries are queued for review — never auto-sent) |
| Wave 9 | Carrier Pocket App | Mobile carrier surface: a carrier sees only their own trips, invoices and compliance |

## 3. Live URLs

- **Command Center (staff):** `https://ops.loadboot.com/app/command-center/`
- **Carrier Pocket App:** `https://ops.loadboot.com/app/pocket/`
- **Marketing site:** `https://loadboot.com`

## 4. Security model (how your data is protected)

- **Deny-by-default backend.** All business tables live in a private schema with row-level security on and zero direct API access. They can only be reached through reviewed, permission-checked database functions.
- **Role-based access control (RBAC).** 51 fine-grained permissions across roles (owner, operations admin, dispatcher, compliance reviewer, finance, marketing, support, auditor). Every action is re-checked on the server — the UI only hides what it shows.
- **Feature-flag gating.** Each module is gated by a flag, so nothing appears or runs until it is deliberately switched on.
- **Carrier isolation.** The Pocket App resolves a carrier from their login — there is no carrier-id parameter — so one carrier can never see or touch another's data. This was proven: carrier A sees only A's trips; carrier B sees none of A's; a non-carrier is refused.
- **Human-approval gates** on high-risk actions: carrier onboarding approval and carrier settlement payouts require an explicit approver.
- **Full audit trail.** Every privileged action is recorded.
- **No external sends without approval.** Email/SMS and webhooks are queued for review; nothing is transmitted to a third party automatically.

## 5. Production rollout — verified

- All module backends applied to production as **additive** changes. Your existing data was never altered (verified before/after: 3 carriers, 4 loads, 2 documents, 1 staff — unchanged).
- Security advisors: **zero errors**; remaining notices are by-design (the RBAC + deny-by-default pattern) or pre-existing.
- Production health: all 10 modules responding, 12 automation rules active, **0** dead/failed/pending automation events.
- **Automation scheduler (pg_cron) is live.** The event outbox is drained automatically every minute, and a compliance-expiry scan runs daily at 06:00 — so tasks and notifications are created on their own, with no manual step. Verified executing in production.

## 6. Quick start (using it for real)

1. Sign in to the Command Center as the owner.
2. **Onboard a real carrier:** Carriers → Onboarding & compliance → Start onboarding → verify their documents → Approve.
3. **Create and dispatch a load:** Loads & trips → create a load → Dispatch & trips → New trip (assign carrier/driver) → advance status as the truck moves.
4. On delivery, **raise the invoice** (Finance → Invoice trip), then **bundle a settlement** and approve the payout.
5. Watch **Analytics** populate as real trips and invoices flow through.
6. Give a carrier their login and point them to the **Pocket App**.

## 7. Production-readiness checklist

- [x] **Automation scheduler.** Live — outbox drained every minute, daily compliance scan at 06:00 (pg_cron). Done.
- [x] **Custom domain SSL.** `ops.loadboot.com` certificate provisioned (covers loadboot.com, ops.loadboot.com, www). Done.
- [ ] **Backups / point-in-time recovery.** Production is on a free Supabase plan with no automatic backups. Upgrading to enable backups is strongly recommended before relying on it for real business records. *(Requires a billing decision — owner action.)*
- [ ] **Email / SMS delivery.** Notifications and messages are queued today. Connect a real email/SMS provider (via the Integrations module) to actually send them. *(Requires provider API credentials — owner action.)*
- [ ] **Real carrier accounts.** Create carrier logins so carriers can use the Pocket App. *(Owner action.)*

---

*Architecture note: production and staging are separate Supabase projects. Staging carries demo data for safe testing; production is kept clean of synthetic data by design. New work is built and proven on staging, then rolled out to production as additive, flag-gated changes.*
