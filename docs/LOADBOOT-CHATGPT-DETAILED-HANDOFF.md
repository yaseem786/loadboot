# LoadBoot — Detailed Handoff for ChatGPT

**Purpose:** a complete, self-contained status report so you (ChatGPT) can decide the next directives.
**Production DB:** `rwscphuhpjoudvljvmdk` · **Staging DB:** `snslhvmkjusozgjelghi`
**Branch:** `preview/command-center-v1` · **Running changelog:** `docs/SESSION-CHANGELOG.md`

Both databases are kept in **exact parity** — every changed function is hash-identical across staging and
production. The **anonymous SECURITY DEFINER surface is 5** on both, re-verified after every increment.

---

## 0. Headline status (honest)

```
LOADBOOT ENTERPRISE FOUNDATION GATE: FAIL
Gate summary: PASS 10 / PARTIAL 0 / BLOCKED 2 / FAIL 0 of 12
```

Not claimed as 12/12. The two BLOCKED items are real completion conditions that need a **real browser login**
the assistant cannot perform: (1) POD UI-and-review proof, (2) authenticated persona matrix. Everything that
can be built and proven without a login is done.

The four gates from the last directive:
- **CURRENT FRONTEND DEPLOYMENT GATE — PASS** (routes resolve, site builds, 0 prod staging-refs, secret scan clean).
- **MARKETING DELIVERY ENGINE BACKEND GATE — PASS.**
- **MARKETING STUDIO FRONTEND GATE — PASS.**
- **CAMPAIGN SAFETY GATE — PASS.**

---

## 1. What was built this session — 13 increments (30–42)

Each increment: applied to BOTH databases, proven by a SQL security matrix (JWT-claim simulation of each
persona), frontend passing `node --check` + import-reference check + build, and synced to the device repo.
**15 security matrices pass.**

| # | Increment | Proof matrix |
|---|-----------|--------------|
| 30 | Unified delivery engine (ledger, preview→confirm→enqueue→claim→mark→auto-suppress; Command Center + Campaign Manager UI) | DELIVERY ENGINE (patched for approval) |
| 31 | Campaign analytics + transactional enqueue | ANALYTICS/TXN |
| 32 | Scheduled-send release transition | RELEASE-DUE |
| 33 | Service-role delivery worker + signed provider webhook (source) | WORKER |
| 34 | Template render + content snapshot into deliveries | RENDER/SNAPSHOT |
| 35 | Campaign approval (maker-checker) + UTM attribution + working staging demo | APPROVAL, ATTRIBUTION |
| 36 | SMS lane through the unified engine (+ Twilio worker source) | SMS TXN |
| 37 | One-click unsubscribe (RFC 8058) without widening the security surface | UNSUBSCRIBE |
| 38 | Campaign A/B testing (variants, weighted split, per-variant analytics + winner) | A/B, NO-VARIANT REGRESSION |
| 39 | Event-triggered transactional automations (form-submitted → acknowledgement) | TRIGGER |
| 40 | Domain-event → webhook fan-out + event catalog | FANOUT |
| 41 | Webhook delivery sender (claim/mark + HMAC-signing edge function) | WEBHOOK SENDER |
| 42 | Pipeline reliability health (backlog across all async queues) | PIPELINE HEALTH |

---

## 2. Architecture — the unified delivery chain (every link built)

```
Audience → Template → Campaign/Trigger → Channel → Approval → Schedule →
Delivery queue → Provider adapter → Delivery events → Analytics → Attribution → Audit
```

**Core tables (app_private):**
- `message_deliveries` — ONE ledger for all channels (email/sms). idempotency_key UNIQUE, status lifecycle
  (scheduled→queued→claimed→sent/delivered/opened/clicked/bounced/complained/unsubscribed/failed/dead_letter),
  attempts, timestamps, provider, correlation_id, related_* business links, meta (subject + body snapshot + variant).
- `suppressions` — global opt-out/bounce/complaint list (unique per channel+address).
- `provider_events` — idempotent provider-webhook sink (dedupe_key unique).
- `campaign_variants` — A/B content variants (label, subject, body, weight).
- `comm_triggers` — event→template automation registry.
- `comm_templates`, `campaigns`, `audiences`, `comm_preferences`, `form_submissions` — pre-existing, extended.
- `domain_events`, `webhook_endpoints`, `webhook_deliveries` — event log + outbound webhook subsystem.

**Public RPCs added (all staff-gated via `can_manage_comms` = content.manage OR settings.manage; anon revoked):**
`cc_campaign_audience_preview`, `cc_campaign_enqueue` (approval + confirm-count guarded, A/B-aware),
`cc_campaign_approve`, `cc_delivery_claim`, `cc_delivery_mark`, `cc_delivery_release_due`, `cc_suppress`,
`cc_delivery_health`, `cc_delivery_list`, `cc_suppressions_list`, `cc_campaign_analytics`,
`cc_campaign_attribution`, `cc_enqueue_transactional` (email+sms), `cc_render_template`,
`cc_campaign_variants` / `cc_campaign_set_variant` / `cc_campaign_delete_variant` / `cc_campaign_variant_analytics`,
`cc_comm_triggers` / `cc_set_comm_trigger`, `cc_event_catalog`, `cc_webhooks_flush`, `cc_pipeline_health`.

**Service-role-only RPCs (off the anon+authenticated surface entirely; used by workers):**
`cc_delivery_worker_claim` / `cc_delivery_worker_mark` / `cc_delivery_worker_resolve` /
`cc_delivery_worker_unsubscribe`, `cc_fanout_domain_events`, `cc_webhook_claim` / `cc_webhook_mark`.

**Self-scoped RPC:** `cc_pocket_get_preferences` / `cc_pocket_save_preferences` (already existed; verified).

---

## 3. Safety & compliance properties (all proven)

- **Confirm-before-send:** `cc_campaign_enqueue` refuses unless the caller passes the exact recomputed recipient
  count — no broad send from a stale number.
- **Maker-checker approval:** a campaign must be approved before send, and the approver cannot be its creator.
- **Consent + suppression:** enforced at enqueue and on every transactional/trigger send.
- **Idempotency:** enqueue, transactional, provider webhooks, and fan-out are all idempotent (no double-send).
- **Retry + dead-letter:** failed sends retry up to 5 attempts, then dead-letter; bounces/complaints auto-suppress.
- **One-click unsubscribe (RFC 8058):** `List-Unsubscribe` headers + a signed edge endpoint using an unguessable
  per-delivery token — built through a service-role path so the anon surface stayed at 5.
- **No real sends in dev:** provider transmission only happens once the owner sets secrets and deploys the workers.

---

## 4. Edge functions (source committed; deploy is owner-gated)

Safe no-ops until the owner sets secrets + deploys (the assistant cannot handle secrets or deploy):
`delivery-worker` (Resend email), `delivery-worker-sms` (Twilio SMS), `delivery-webhook` (signed provider
events), `unsubscribe` (one-click), `webhook-sender` (outbound webhooks, optional HMAC signing).

---

## 5. What remains (owner-executed)

1. **Push** `preview/command-center-v1` from GitHub Desktop → ships the frontend (Netlify builds from the push).
   The DB migrations are already live on both projects; the push only ships the frontend.
2. **Enable sending:** set `RESEND_API_KEY` / `RESEND_FROM` / `RESEND_WEBHOOK_SECRET` (email),
   `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` (SMS), optional `WEBHOOK_SIGNING_SECRET`; then deploy
   the five edge functions with `verify_jwt=false` and schedule the workers (pg_cron + pg_net, every minute).
3. **Run the two browser proofs** (POD UI + persona matrix) → genuine `PASS 12 / 12`.

---

## 6. Suggested decisions for ChatGPT

Everything independently buildable in the marketing/delivery + developer/API + reliability scope is done and
verified. The highest-leverage next options:
- **(a)** Owner performs the go-live steps in §5 (push + secrets/deploy + 2 browser proofs) to lock 12/12 and
  turn on real delivery.
- **(b)** Pick the next NEW subsystem to build: a multi-step **Workflow Builder** (generalize the single
  form-submitted trigger into multi-event automations), a cross-subsystem **BI/reporting** dashboard, or deeper
  **Developer/API** (API keys, rate limits, docs). Each is complex existing/new code, so the assistant will keep
  changes additive and matrix-proven on both DBs.

Which do you want first?
