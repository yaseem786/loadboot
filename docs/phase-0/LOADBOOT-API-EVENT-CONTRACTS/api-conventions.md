# API conventions (v1)

LoadBoot's API surface today is **PostgREST RPCs** (`public.cc_*`) called with a
Supabase JWT, plus **edge functions** for provider work. These conventions apply
now and carry forward to any extracted HTTP service.

## Request
- **Versioning:** RPC names are stable contracts. Breaking changes ship a new RPC
  (`cc_x_v2`) — never silently change an existing one's shape. HTTP services use
  `/v1/…` path versioning.
- **Auth:** every call carries a JWT (or service key for server-to-server). No
  anonymous access to `cc_*` except explicitly public RPCs
  (e.g. `get_public_load_opportunities`).
- **Authorization:** enforced **server-side** in the RPC via
  `has_global_permission()` / `is_active_staff()` / `my_carrier_org()`. UI hiding
  is never the control.
- **Tenant context:** resolved from the session (carrier org / staff context),
  not from a client-supplied id, to prevent cross-tenant access.
- **Idempotency:** mutating operations accept/clamp an `idempotency_key`
  (`app_private.idempotency_keys`) so retries are safe.
- **Pagination/filter/sort:** list RPCs take `p_limit`, `p_offset`/cursor,
  `p_status`, `p_search`. Never return an unbounded set.

## Response
- Structured rows or a single JSON object; numbers are typed (numeric, not text).
- Errors use Postgres error codes mapped to user-safe messages by
  `humanizeError()`; `42501` = not authorized → permission-denied UI state.
- Untrusted/user-generated content is treated as data, never executed.

## Edge functions
- `verify_jwt = true`; re-check staff/role inside the function
  (defense in depth) before using the service-role key.
- Provider secrets read only from Supabase secrets; never shipped to the browser.
- Return `{ ok, ...result }` or `{ error }`; failures are Tier-2 (never block
  Tier-0 operations).

## Rate limiting / quotas (target)
- Per-tenant and per-identity limits with `RateLimit-*` headers; 429 with
  `Retry-After`; quotas surfaced in the Developer Portal.
