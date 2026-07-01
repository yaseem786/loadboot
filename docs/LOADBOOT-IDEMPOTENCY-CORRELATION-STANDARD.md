# LOADBOOT — Idempotency & Correlation-ID Standard (Gate Condition #8)

**Status: LIVE (production)** — reference implementation on `cc_partner_post_load`, staging-proven.

## Why
Retries, double-clicks and at-least-once event delivery must never create duplicate
business records, and support/engineering must be able to trace one user action across
audit + events.

## Primitives (app_private)
- `claim_idempotency(scope, key) → (is_new bool, prior_result uuid)`
  Inserts `(scope,key)` into `app_private.idempotency_keys` (unique). First caller gets
  `is_new=true`; any retry gets `is_new=false` plus the stored `prior_result`.
- `idempotency_set_result(scope, key, result_uuid)` — records the result so retries return
  the *same* entity.
- `correlation_id()` — returns the current request's correlation id (GUC `app.correlation_id`)
  or a fresh uuid.
- `cc_set_correlation_id(text)` — set once per request from the client; threads into
  `audit_logs.request_id` and event payloads.

## Standard pattern for any mutating RPC
```sql
-- at the top of a create/submit RPC:
if p_idempotency_key is not null then
  select * into claim from app_private.claim_idempotency('<scope>:'||tenant::text, p_idempotency_key);
  if not claim.is_new then return claim.prior_result; end if;   -- idempotent retry
end if;
-- ... perform the mutation, capture v_id ...
if p_idempotency_key is not null then perform app_private.idempotency_set_result('<scope>:'||tenant::text, p_idempotency_key, v_id); end if;
perform app_private.emit_event('<type>', '<agg>', v_id::text,
  jsonb_build_object(..., 'correlation', app_private.correlation_id()), p_idempotency_key);  -- dedupe_key = idempotency key
```

## Client standard
- Generate one idempotency key per submission attempt (`crypto.randomUUID()`), reuse it on
  retry, regenerate after success. (Implemented in the broker portal's post-load form.)
- Optionally call `cc_set_correlation_id()` at session start so all actions in a session
  share a traceable id.

## Proof (staging)
3 `cc_partner_post_load` calls — two with the same key, one with a different key — produced
**2** loads (not 3); the repeated key returned the identical load id; the correlation id
threaded through. ✅

## Adoption
Other high-risk mutating RPCs (invoice creation, settlement, load assignment) adopt the
same pattern by adding an optional `p_idempotency_key`. This document is the reference.
