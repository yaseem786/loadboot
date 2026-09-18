# iOS push — production apply checklist (prepared 18 Sep 2026)

Verified state on 18 Sep 2026 (live queries, both projects):

| Item | Staging `snslhvmkjusozgjelghi` | Production `rwscphuhpjoudvljvmdk` |
|---|---|---|
| `bl_ios_0349_apns_push` migration | applied 17 Sep 22:18 UTC | **NOT applied** |
| `public.cc_push_drop_endpoint(text)` | present | **missing** |
| `app_private.push_subscriptions.platform` (generated col) | present | **missing** |
| `push-send` edge function | v12, APNs + Web Push, deployed 17 Sep | v14 but **June-30 code** — Web Push only, no APNs, no dead-endpoint pruning |
| `cc_save_push_subscription` / `cc_push_targets` | identical on both (md5 match) — no `https://` check, so `apns:<token>` endpoints are accepted as-is |
| Existing prod push subscriptions | — | 5 (all web) — untouched by the migration |
| APNs secrets (`APNS_TEAM_ID/KEY_ID/P8/BUNDLE_ID/ENV`) | not set | not set |

Also on staging but not prod (separate stream, NOT part of this apply): `bl_stripe_0349_set_status_routes_to_approve`,
edge functions `stripe-webhook`, `stripe-worker`, `stripe-autopay`. Prod has two prod-only audit migrations
(`audit_erasure_guard_promotion`, `audit_marketing_optout_promotion`) — expected, leave them.

## Why this is safe to apply BEFORE the APNs key exists

- The migration is additive and idempotent (`add column if not exists`, `create index if not exists`,
  `create or replace function`). It does not touch the web push path.
- push-send v12 is a strict superset of the prod code: web subscriptions go through the same
  `webpush.sendNotification` path; `apns:` subscriptions only exist once the iOS app registers one; and
  with the secrets missing `sendApns()` returns `{ reason: "APNs not configured" }` instead of throwing.
  The only behaviour change for existing web users is that 404/410 endpoints get pruned (good).

## Steps (in order)

1. **Migration → prod**: `apply_migration` on `rwscphuhpjoudvljvmdk` with `migrations/bl_ios_0349_apns_push.sql`
   (name `bl_ios_0349_apns_push`). Verify:
   `select exists(select 1 from pg_proc where proname='cc_push_drop_endpoint');` → true and
   `select platform, count(*) from app_private.push_subscriptions group by 1;` → `web | 5`.
2. **push-send → prod**: `deploy_edge_function` on prod with the staging v12 source (`get_edge_function`
   on staging, slug `push-send`, single `index.ts`), `verify_jwt = true`. Then send a CC test push to
   your own web browser — response JSON must show `sent: 1`, `apns: { targeted: 0 }`.
3. **After Apple approves the Developer Program** (guide §2): create the APNs Auth Key (.p8) at
   developer.apple.com → Keys, then on BOTH projects set Edge Function secrets
   `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_P8` (full PEM), `APNS_BUNDLE_ID=com.loadboot.app`,
   `APNS_ENV=production`. No redeploy needed — secrets are read per request.
4. First TestFlight install → open app → allow notifications → check
   `select platform, device_label, created_at from app_private.push_subscriptions where platform='apns';`
   on prod, then send a CC push to that user: `apns.sent` must be 1.

Steps 1–2 can be done today. Steps 3–4 wait for Apple.
