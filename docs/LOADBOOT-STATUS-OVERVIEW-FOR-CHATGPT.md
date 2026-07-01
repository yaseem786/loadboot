# LoadBoot — Full Status Overview for ChatGPT

**Production:** `rwscphuhpjoudvljvmdk` · **Staging:** `snslhvmkjusozgjelghi` · **Live changelog:** `docs/SESSION-CHANGELOG.md`

Both databases are kept in **exact parity** (every changed function hash-identical across staging + production).
The **anon SECURITY DEFINER surface is 5** on both — verified after every single increment, including the ones
that would have made widening it easy (unsubscribe, SMS, A/B, webhooks).

---

## 1. The one canonical status (honest)

```
LOADBOOT ENTERPRISE FOUNDATION GATE: FAIL
Gate summary: PASS 10 / PARTIAL 0 / BLOCKED 2 / FAIL 0 of 12
```

Deliberately **not** claimed as 12/12. The two remaining conditions are real completion conditions (not "polish")
and stay BLOCKED until the owner runs two **browser** proofs that need a real login the assistant can't perform:
POD UI-and-review, and the authenticated persona matrix. Everything buildable without a login is done.

---

## 2. Marketing Delivery Engine — built and proven this session (increments 30–42)

A complete, compliant, multi-channel marketing platform on ONE unified delivery ledger (not per-channel silos).
Every increment: applied to both DBs, proven by a SQL security matrix, frontend passing syntax + import + build
checks, synced to the repo. **15 security matrices pass.**

**The full chain the directive specified — every link built:**
Audience → Template → Campaign/**Trigger** → Channel → **Approval** → Schedule → Queue → Provider → Events →
Analytics → **Attribution** → Audit.

Capabilities:
- **Channels** — email (Resend) and SMS (Twilio) on one `message_deliveries` ledger; per-channel service-role workers.
- **Content** — templates with `{{variable}}` rendering (server-truth), and **A/B variants** with a deterministic
  weighted audience split, per-variant snapshot, per-variant analytics + winner selection.
- **Governance** — maker-checker **approval** (an approver can't approve their own campaign) + a confirm-count
  safety gate; no broad send can fire from a single call on a stale count.
- **Lifecycle** — consent → suppression → durable queue → scheduled-release → atomic claim → send →
  provider webhooks → retry-to-dead-letter → bounce/complaint auto-suppression.
- **Compliance** — RFC 8058 **one-click unsubscribe** with `List-Unsubscribe` headers, built through a
  service-role edge path so the security surface never widened.
- **Automation** — event-triggered autoresponders (a website form submission auto-sends an acknowledgement);
  no-op until an admin activates a trigger.
- **Measurement** — per-campaign + per-variant analytics, delivery-status histograms, UTM conversion attribution,
  full audit trail.

**A working staging demonstration** (directive item 10) ran the entire lifecycle end to end and is captured in
`docs/DELIVERY-ENGINE-STAGING-DEMO.md`.

---

## 3. Developer / API — outbound webhooks (increments 40–41)

`emit_event` wrote durable `domain_events` but nothing delivered them to subscribers. Now:
- **Fan-out** — pending domain events → `webhook_deliveries` for every active endpoint subscribed to that event
  type, marked processed (idempotent). Service-role `cc_fanout_domain_events` + staff `cc_webhooks_flush`.
- **Event catalog** — `cc_event_catalog()` lists subscribable events (dispatch/documents/finance/growth/marketing),
  surfaced in the Webhooks admin.
- **Sender** — service-role `cc_webhook_claim`/`cc_webhook_mark` + `supabase/functions/webhook-sender` that POSTs
  the event JSON with an optional HMAC `X-LoadBoot-Signature` (owner-set env secret; no signing secret in the DB).

## 4. Reliability (increment 42)

`cc_pipeline_health()` — one staff read of backlog across every async queue (message deliveries, webhook
deliveries, domain-event log, suppressions, campaigns in flight); surfaced as a Delivery-Health backlog strip.

---

## 5. Edge functions (source in repo; deploy is owner-gated)

Safe no-ops until the owner sets secrets and deploys them (assistant can't handle secrets or deploy):
`delivery-worker` (Resend email), `delivery-worker-sms` (Twilio), `delivery-webhook` (signed provider events),
`unsubscribe` (one-click), `webhook-sender` (outbound). Until deployed + keyed, the engine queues, tracks, and
measures correctly but transmits nothing — by design.

---

## 6. What remains for genuine 12/12 + go-live (owner-executed)

1. **Push** `preview/command-center-v1` from GitHub Desktop → ships the frontend (Netlify builds from the push;
   DB migrations are already live on both projects).
2. **Set secrets + deploy the five edge functions** → enables real email/SMS/webhook transmission.
3. **Run the two browser proofs** (POD UI + persona matrix) → genuine `PASS 12 / 12`.

---

## 7. Integrity

No fabricated data or evidence; gate honestly 10/12. No passwords/secrets handled in plaintext; no GitHub push by
the assistant; no `.github/workflows` edits; no device-file deletions. Every backend change is additive and proven
by a SQL matrix; existing working subsystems were extended additive-only; the anon surface held at 5 throughout.
