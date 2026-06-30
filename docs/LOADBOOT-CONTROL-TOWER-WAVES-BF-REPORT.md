# LoadBoot — Control Tower Expansion, Waves B–F

Date: 30 June 2026. Following Wave A (analytics, forms, SEO), Waves B–F complete the Control Tower: the unified record pages and the remaining top-level modules that make LoadBoot one connected enterprise OS. Everything here is additive, RBAC-gated, audited, proven on staging, and rolled out to production behind flags that stay OFF until you merge the frontend and enable them. Production data fingerprint after rollout is unchanged (greenfield tables empty; no existing data touched).

## What shipped

**Wave B — Entity 360 record pages.** The heart of "everything is clickable." Carrier 360 (`cc_carrier_360`) is one screen that ties together a carrier's profile, compliance status, safety grade and on-time %, documents, drivers, trip history, finance (invoices, fees paid/outstanding, pending settlements), open tasks, and a full audit timeline — each section sourced from the module it belongs to. Because the carrier identity is split in the data model (profiles for onboarding/documents, organizations for compliance/finance/trips), the function accepts **either** id and resolves the link via `organizations.owner_user_id`, so clicking a carrier anywhere opens the right record. Reached from the carrier drawer via "View full 360° record →". A reusable `cc_entity_audit` powers entity timelines. Flag `entity360_enabled`.

**Wave C — Brokers & Shippers.** Brokers and shippers are now first-class records (`partners` table) with contact, MC, billing terms, credit limit and status, plus a per-partner audit timeline. List, filter by type, search, create/edit in a drawer, and hold/reactivate. `cc_partners_*` RPCs, `partners.view`/`partners.manage`. Flag `partners_enabled`.

**Wave D — Support / tickets.** A triage inbox (`support_tickets`) with auto-generated refs (TKT-####), priority ordering, create/assign/resolve, and a per-ticket detail drawer. Creating a ticket fires a new **support follow-up automation** (high-priority task to the support role within 2 hours). `cc_*ticket*` RPCs, `support.view`/`support.manage`. Flag `support_enabled`.

**Wave E — Reports center.** Pick a report — Finance, Carriers, Operations, Sales, Website, Compliance — and a time window; the server returns a typed table (`cc_report`) that renders on screen and exports to CSV, Excel and PDF. Each report reuses the same proven aggregation patterns as the live dashboards, so the numbers match. `reports.view`. Flag `reports_enabled`.

**Wave F — Notifications center + Automations management.** The Notifications center lists every notification the system has raised (queued/sent/read) with mark-as-read — nothing is ever sent silently; delivery still needs a connected provider. The Automations management view lists every rule (trigger → action), flags which require human approval, and lets an owner enable/disable a rule (`cc_list_rules`, `cc_set_rule_enabled`, audited). Flags `notifications_center_enabled`, `automations_admin_enabled`.

## Unified navigation

The Command Center sidebar now follows the target top-level structure: Overview (Dashboard, Ops Radar, Management, Analytics, Analytics Control Center), Operations (Dispatch, Carriers, Loads & trips, Fleet, Documents, Compliance, Automation), Sales & CRM (CRM & leads, Forms inbox, Brokers & shippers), Support (Tickets), Communications (Messages, Notifications), Finance, Marketing, SEO & Website, Reporting (Reports), and Administration (Staff & roles, Automations, Audit, Integrations, Feature flags, Settings). Every new item is permission- and flag-gated, so the live app is unchanged until you enable each flag.

## Clickable-everything

Carrier drawer → full 360° record. 360 sections → the underlying module (documents, drivers, trips, finance, timeline). Partner row → partner detail + timeline. Ticket row → ticket detail + actions. Report row → typed export. Rule row → enable/disable. No dead numbers.

## Security & correctness

All new reads/writes go through `cc_*` RPCs gated on their permissions; `app_private` stays deny-by-default. The Carrier 360 and Reports aggregations were validated against real staging data before production rollout (e.g. Ironhide Freight: 2 documents, 3 trips, 1 driver, 2 invoices, 10 audit entries — all resolving correctly across the profile/organization split). No fabricated data anywhere; greenfield modules start empty.

## Production rollout status

| Wave | Backend | Production | Flag (default) |
|---|---|---|---|
| B — Entity 360 | `cc_carrier_360`, `cc_entity_audit` | ✅ applied | `entity360_enabled` = **off** |
| C — Brokers & Shippers | `partners` + `cc_*partner*` | ✅ applied | `partners_enabled` = **off** |
| D — Support | `support_tickets` + `cc_*ticket*` + automation rule | ✅ applied | `support_enabled` = **off** |
| E — Reports | `cc_report` | ✅ applied | `reports_enabled` = **off** |
| F — Automations mgmt | `cc_list_rules`, `cc_set_rule_enabled` | ✅ applied | `automations_admin_enabled` = **off** |
| F — Notifications center | (existing `cc_list_notifications`) | ✅ ready | `notifications_center_enabled` = **off** |

14 new functions, 5 new permissions, 6 new flags (all off) on production. Automation rules now total 17 (added the ticket follow-up).

## How to turn it on (after merge)

In the Command Center → Feature flags, enable `entity360_enabled`, `partners_enabled`, `support_enabled`, `reports_enabled`, `automations_admin_enabled`, and `notifications_center_enabled`. Each section appears immediately for staff with the matching permission.

## Still owner-blocked (unchanged, credential/billing only)

Real email/SMS delivery (`RESEND_API_KEY` / `TWILIO_*`), automatic backups/PITR (Supabase plan upgrade), and the optional live integrations (GA4, Search Console, FMCSA, Maps, QuickBooks, factoring). None block the modules above — they run on first-party data today.
