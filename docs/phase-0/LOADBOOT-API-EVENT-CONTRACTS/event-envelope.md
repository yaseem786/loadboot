# Event envelope (v1)

Every domain event — whether stored in `app_private.domain_events` today or
published to a durable bus later — uses this envelope. Consumers MUST be
idempotent on `idempotency_key`.

```json
{
  "event_id": "uuid",
  "event_type": "carrier.approved",
  "schema_version": 1,
  "occurred_at": "RFC3339",
  "published_at": "RFC3339",
  "actor": { "type": "staff|carrier|service|system", "id": "uuid|null" },
  "tenant": { "org_id": "uuid|null", "cell_key": "string|null", "region": "string|null" },
  "correlation_id": "uuid",
  "causation_id": "uuid|null",
  "idempotency_key": "string",
  "source": "command-center|carrier-portal|automation|edge-fn|system",
  "resource": { "type": "carrier", "id": "uuid" },
  "data_classification": "public|internal|confidential|restricted",
  "payload": { },
  "trace": { "trace_id": "string|null", "span_id": "string|null" }
}
```

## Rules
- `event_type` = `domain.action` (lowercase, dot-separated), never renamed once
  published; breaking changes bump `schema_version` and add a new type.
- At-least-once delivery; consumers dedupe on `idempotency_key`.
- A failed consumer never deletes the source event; it moves to a dead-letter
  with the original envelope intact.
- `data_classification` drives retention, masking and provider-eligibility (e.g.
  `restricted` payloads are never sent to external AI providers).

## Current implementation mapping
- Producer: `app_private.emit_event(type, resource_type, resource_id, payload)`
  → row in `domain_events` (outbox).
- Processor: pg_cron `lb-process-outbox` (1 min) fans out to rules / notifications.
- Target: same envelope on a durable bus when extracted (see Target Architecture).
