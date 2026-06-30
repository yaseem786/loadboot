# Core entity events (v1 catalog)

Canonical `event_type`s per domain. Each is emitted via `emit_event()` today and
travels in the standard envelope. Consumers listed are the modules that react.

| event_type | producer | key payload | consumers |
|---|---|---|---|
| `form.submitted` | marketing site | fields, utm, referrer, page | crm, notifications, automation |
| `lead.created` | crm | lead_id, source, owner | action_center, notifications |
| `lead.stage_changed` | crm | lead_id, from, to | reports, automation |
| `carrier.created` | carriers | org_id | onboarding, action_center |
| `carrier.approved` | carriers | org_id, approver | notifications, finance, automation |
| `document.uploaded` | documents | file_id, owner, kind | compliance, action_center |
| `document.rejected` | compliance | file_id, reason | carrier_portal, notifications |
| `load.created` | loads | load_id, lane, rate | matching, dispatch |
| `offer.sent` | loads | load_id, carrier_id | carrier_portal, notifications |
| `load.assigned` | loads | load_id, carrier_id, trip_id | dispatch, finance |
| `trip.status_changed` | trips | trip_id, status | ops_map, action_center, notifications |
| `trip.exception` | trips | trip_id, kind, evidence | action_center, support, finance |
| `invoice.created` | finance | invoice_id, carrier_id, fee | carrier_portal, reports |
| `invoice.disputed` | finance | invoice_id, reason | action_center, finance |
| `settlement.ready` | finance | settlement_id, carrier_id | finance(approval), notifications |
| `ticket.created` | support | ticket_id, category | action_center, notifications |
| `ticket.sla_breached` | sla engine | ticket_id | action_center(escalate) |
| `announcement.created` | announcements | announcement_id, kind, audience | carrier_portal, push-send |
| `integration.failed` | integrations | endpoint, attempt | action_center, security |
| `security.event` | platform | type, actor, ip | security console, audit |

## Invariants
- An event represents a fact that already happened; it never contains a command.
- A notification failure must not lose the underlying event — the event persists;
  delivery retries from it.
- Restricted-classification payloads (rates, margins, bank, PII) are masked for
  Tier-2 consumers and never forwarded to external providers.
