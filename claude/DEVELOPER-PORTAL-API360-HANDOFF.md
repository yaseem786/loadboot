# HANDOFF — Developer accounts fix + full Developer Portal + CC "API 360" (29 Sep 2026)

> The owner pasted this handoff into the build session on 29 Sep 2026 (it had not been pushed). The build log is in
> `claude/DEVELOPER-PORTAL-API360-BUILD-0502.md`.

**Owner ask (Yaseen, 29 Sep 2026):** developer/API signups must NOT land in the carrier list; make the Developer Portal
fully functional and consistent with what the marketing site's API page promises; build a complete "API 360" screen in
the Command Center; full login/auth for developers; everything must automatically follow the EXISTING design system (no
new look). Rollout: staging first → Yaseen tests → prod.

## 1. The bug (verified on prod, 29 Sep)

- `app/developer/app.js` line ~62 calls `signUp(em, pw, {})` — no role, no name, no company.
- `handle_new_user()` treats any signup without `raw_user_meta_data.role` as a CARRIER → the developer appears in CC
  Carriers as "Pending" with every column "—".
- Carrier signup (`app/carrier/app.js` ~732) always sends company + name + phone, so "empty meta + no role" =
  developer-portal signup.
- Affected prod accounts (all role carrier, empty meta) — reclassify, DO NOT delete: brian.a@lyntex.io (29 Sep, Lyntex
  Designs, a software/AI agency, not a carrier), nguyenbrian83@gmail.com (22 Sep), byteitsolutionsnc@gmail.com (22 Sep),
  techcentralnc@gmail.com (19 Sep), support@velogriddispatch.com (8 Sep). (One already-deleted placeholder, ignore.)
- `public.profiles.role` CHECK only allows `carrier|admin`. Other personas are handled by branches inside
  `handle_new_user`. Mirror how the `agent` branch avoids creating a carrier org.

## 2. What exists today

- Marketing page `api.html` (source: `API_PAGE` in `build_site.py`) is the CONTRACT: keys `lb_…` shown once, scopes
  read/write, POST loads up to 50, GET public loads, `?resource=me`, sandbox for network/TMS vendors via hello@,
  "no ghost loads". Update copy only if behaviour changes, keep both in sync.
- Developer portal `app/developer/{index.html, app.js, developer.css, tour-content.js}`.
- Edge function `supabase/functions/dev-api/index.ts` (v7).
- Prod RPCs: `cc_create_api_key`, `cc_list_api_keys`, `cc_revoke_api_key`, `dev_verify_api_key`, `dev_post_load`,
  `my_webhook_create/delete`, `my_webhooks`, `cc_list_webhook_endpoints`, `cc_list_webhook_deliveries`,
  `cc_retry_webhook_delivery`, `cc_webhook_claim/mark`, `cc_webhooks_flush`. Table `app_private.api_keys`.
- CC `views/integrations.js` shows only the signed-in staff member's own keys. No cross-account API view.
- Live partner: Milecount (Issa Thomas, Edit All Futures LLC, GA SOS #26081936 Active). Staging sandbox key prefix
  `lb_fefba0`. Production on hold until attribution + link-back are fixed
  (`claude/MILECOUNT-SANDBOX-AND-MAIL-ALIAS-2026-09-28.md`).

## 3. Build spec

- **A. Developer identity** — signup sends `role:'developer'` + name, company, website, use case;
  `handle_new_user` developer branch → `app_private.developer_accounts` (status `pending|approved|suspended`), no
  carrier org/onboarding; every CC carrier list/count excludes developers; data fix for the 5 accounts (idempotent, no
  deletes).
- **B. Developer Portal** — signup (name, company, website, what you're building, expected volume, API terms), email
  verification, login/logout/forgot/reset; dashboard with status + checklist; keys (create with scopes, shown once,
  list, revoke; sandbox self-serve; production read only after approval; write only for verified brokers); sandbox =
  new scope `sandbox` on prod `dev-api` returning fixture loads (keep the staging sandbox working for Milecount);
  in-portal docs mirroring api.html incl. attribution rule and link-back
  `https://loadboot.com/app/carrier/?src=<partner>&ref={ref}`; "Request production access"; usage (7/30 days, last
  call, errors per key); webhooks with delivery status; support via hello@ (contact switch rule for phone/WhatsApp).
- **C. dev-api** — log every call (key, endpoint, method, status, latency; 90 days); per-key rate limit (suggest
  60/min) → 429 + Retry-After; GET filters `equipment`, `origin_state`, `dest_state`; `url` link-back per load;
  `sandbox` scope never touches real data.
- **D. CC "API 360"** — list of developer accounts + staff-created partner keys, filters, search, KPIs; account 360
  (profile, verification notes, approve/deny/suspend with note, keys incl. revoke + issue on behalf, usage chart,
  recent calls, error log, webhooks + deliveries (retry), request history, audit trail). Staff-gated server-side,
  audited.
- **E. Emails only through the catalog** — developer.welcome, developer.production_approved,
  developer.production_denied, developer.key_revoked, developer.suspended.
- **F. Design** — existing tokens/components only; Navy #10223B, Blue #0883F7, Orange #FC5305, no cyan;
  mobile-responsive; marketing page keeps the premium pl- system.

## 4. Rules

Staging (snslhvmkjusozgjelghi) first; prod (rwscphuhpjoudvljvmdk) only after Yaseen approves. Additive + reversible
migrations; nothing new to anon; anon SECURITY DEFINER list unchanged. Verify JS with esbuild. Stage only your own
paths. Yaseen sends every external message himself. Unknown values stay NULL with a note.

## 5. Acceptance checklist

- New developer signup on staging → appears in API 360, NOT in carriers.
- The 5 prod accounts disappear from carriers and appear in API 360 (after prod apply).
- Developer can sign up, verify email, log in, reset password, create sandbox key, call `?resource=me` and
  `GET loads`, see usage.
- Production request → staff approves in API 360 → catalog email sent → developer can create production read key.
- Revoke in API 360 → next API call returns 401.
- Rate limit returns 429; logs visible in API 360.
- All screens pass on mobile width and use existing tokens.

## 6. Owner decisions still open

Rate-limit value. Whether sandbox keys are auto-issued on signup or after a quick staff look. Where API 360 sits in
the CC nav.
