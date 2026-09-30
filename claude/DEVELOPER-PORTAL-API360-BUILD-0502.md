# Developer Portal + API 360 — build log (bl_dev_0502, 29 Sep 2026)

Spec: `claude/DEVELOPER-PORTAL-API360-HANDOFF.md`. **Staging: done and tested. Prod: DB + dev-api applied 30 Sep 2026 (see "Prod apply — done" below). Frontend not pushed yet.**

## What changed

| Piece | Where | Staging |
|---|---|---|
| Developer identity, carrier-list exclusion, 5-account data fix | `migrations/bl_dev_0502_developer_accounts.sql` | applied |
| API runtime (log, rate limit, sandbox, filters), portal RPCs, API 360 RPCs, 6 catalog emails | `migrations/bl_dev_0502b_api_runtime_portal_api360.sql` | applied |
| HTML-escape developer-typed text in those emails | `migrations/bl_dev_0502c_escape_developer_emails.sql` | applied |
| `dev-api` v8 (verify_jwt stays false) | `supabase/functions/dev-api/index.ts` | deployed (staging version 16) |
| Developer Portal (tabs: Overview, API keys, Usage, Docs, Webhooks, Account; signup/login/forgot/reset) | `app/developer/*` | local run against staging |
| Signup forwards website / use_case / expected_volume / terms | `app/shared/session.js` | — |
| CC → API 360 (`#/api360`, `#/api360?id=<user>`) | `app/command-center/views/api360.js`, route in `app.js`, nav in `views/shell.js`, wrappers in `shared/api.js` | rendered with mock data |
| Marketing API page copy (Developer Portal, filters, `url`, 429) | `build_site.py` `API_PAGE` | — |

### DB in one paragraph
`app_private.developer_accounts` (status pending/approved/denied/suspended) is the developer persona. `handle_new_user`
now has a `developer` branch and never makes a carrier org for it. `send_welcome_email` skips developers; staff get an
in-app "New developer signup" instead. `cc_list_carriers`, `cc_get_overview` (4 counts), `cc_run_onboarding_reminders`,
`resolve_audience_emails(text)` and `cc_audience_estimate` exclude developers (patched by anchor; each patch carries
`bl_dev_0502`). `cc_create_api_key` now enforces the policy: sandbox self-serve (switch in API 360), production read only
when approved, write never self-serve for developer accounts, max 10 active keys. Logins that are NOT developer accounts
(carriers/brokers/staff) keep the old behaviour. `dev-api` calls `dev_api_auth` (service_role only): 401 / 403 suspended /
429 + Retry-After (60/min default, per-key override), and logs every call to `app_private.api_request_log` (90-day
purge cron `lb-api-log-purge`, 03:17 UTC). Staff RPCs `cc_api360_*` need `integrations.view` / `integrations.manage`
and are audited (`audit_logs` target_type `developer_account` / `api_key`).

### Emails (all in `email_catalog`)
`developer.welcome` (sent once on first portal visit after email confirmation), `developer.production_approved`,
`developer.production_denied`, `developer.suspended`, `developer.key_revoked` (T, account_critical) and
`developer.production_requested` (S, staff_internal → `lc_alert_email()`). Contact line: hello@ only (no phone), so the
contact-switch rule is not touched.

## Tests run on staging (all rolled back / cleaned up)
- Developer signup → developer_accounts row, 0 orgs, no carrier welcome, staff note "New developer signup".
- Pending: production read key refused; sandbox key OK; 4th call at limit 3 → 429 with retry_after.
- Request → staff approve → `developer.production_approved` queued → production read key OK → write refused →
  staff revoke (reason required) → 401 → suspend → sandbox key 403. Emails queued: welcome, approved, key_revoked, suspended.
- Live `dev-api` v8: `me` 200, sandbox `loads` (SBX refs, `url` link-back), sandbox POST 207 with validation, bad
  `origin_state` 400, no key 401, 429 + `Retry-After` + `X-RateLimit-*`, revoked 401; every call in the log.
- Portal in Chromium at 390px and 1280px: signup payload carries `role: developer` + fields (signup call intercepted —
  no real account), confirm screen, real sign-in, sandbox key created, production refused, usage shows calls, no
  horizontal scroll. Fixed during test: "Go to sign in" stayed disabled; Docs overflowed at 390px.
- API 360 list + detail at 390/1280 with mock data: no overflow, user text never rendered as HTML.
- anon SECURITY DEFINER on staging: **35, names md5 unchanged** (`b862e7e2…`).
- Not tested end-to-end: API 360 against a real staff login (needs a staff account on staging), the password-reset
  email itself, and real email delivery.

## Prod apply — in this order, after Yaseen says go
1. Before: record `select count(*), md5(string_agg(proname, ',' order by proname)) … anon secdef` (expect **36**).
2. Apply `bl_dev_0502` → `bl_dev_0502b` → `bl_dev_0502c` (the same files). 0502 moves the 5 accounts
   (brian.a@lyntex.io, nguyenbrian83@gmail.com, byteitsolutionsnc@gmail.com, techcentralnc@gmail.com,
   support@velogriddispatch.com) to developer_accounts (pending, source reclassified) and closes their auto-made carrier
   org (old status kept in `legacy_org_status`) — only where the login has no documents / settlements (checked: none have).
3. Deploy `dev-api` v8 to prod (verify_jwt false). v8 needs `dev_api_auth` / `dev_api_log` / `dev_api_loads` from 0502b,
   so never deploy it before step 2.
4. After: anon count still 36 with the same names; `cc_list_carriers` no longer shows the 5; API 360 shows 5 pending.
5. Then push the frontend (portal, CC, session.js, build_site.py). The marketing copy promises self-serve sandbox,
   filters and 429 — it must not go live before steps 2–3.

## Findings the owner should know
- 3 of the 5 developers already got carrier onboarding-reminder emails (12 sends in total). That stops with 0502.
- `support@velogriddispatch.com` has 2 production read keys; one was used on 21 Sep. `nguyenbrian83@gmail.com` has 1.
  They were created before approval existed. **Left active** (not revoked) and noted on the account. Revoke from API 360 if you want.
- `techcentralnc@gmail.com` also has an agent profile (full name "BRIAN NGUYEN"); it was already hidden from the carrier
  list as an agent. `nguyenbrian83@gmail.com` may be the same person — that is a guess from the name only.
- `cc_get_overview` still counts agents as carriers (existing behaviour, not changed here).
- Old cached portal JS (service worker) can still create role-less signups for a while. API 360 → "Move a carrier signup
  here" (`cc_api360_reclassify`) moves one, and refuses real carriers.
- The Milecount staging key (`lb_fefba0`) is not a developer account; its link-back `src` is `api` until a partner slug is
  set on the key (`api_keys.partner_slug`). Which slug should it be?
- The API rules wording on the signup checkbox is mine ("keys stay secret; via LoadBoot + link-back"). There is no
  separate API terms page; it links to `/terms.html`. Legal wording is your call.

## Owner decisions (defaults chosen, all switchable)
- Rate limit: **60/min per key** — CC → API 360 → Settings (per-key override on issue).
- Sandbox: **self-serve right after signup** — switch "Developers can create sandbox keys without review" in Settings.
- Nav: API 360 sits right after Integrations (the "Insights & Admin" group), behind `integrations.view` + the
  `integrations` flag. Moving it is one line in `views/shell.js`.

## Prod apply — done (30 Sep 2026, Yaseen said go)
1. Before: anon SECDEF on prod **36**, bare-names md5 `06f779f74423a983253c79ab9d4e1e84`; newest migration `bl_disp_0501b`.
   The 5 logins re-checked: 0 documents, 0 settlements each.
2. Applied `bl_dev_0502` → `bl_dev_0502b` → `bl_dev_0502c` (same files). After 0502 and again after 0502c: **36, same md5**.
   5 accounts now in `developer_accounts` (pending, reclassified); their carrier orgs `active` → `closed` (kept in `legacy_org_status`).
   All 7 carrier-list/count functions carry `bl_dev_0502`; `resolve_audience_emails(text,jsonb)` delegates to the patched `(text)`.
   Catalog: 6 `developer.*` rows. Cron `lb-api-log-purge` `17 3 * * *`.
   Function parity with staging: 20/24 md5-identical; the other 4 (`cc_create_api_key`, `dev_portal_state`, `dev_profile_save`,
   `cc_api360_list`) differ only by in-body `--` comment lines (staging copy lost them; prod matches the repo file).
3. `dev-api` v8 deployed (prod function version 14, verify_jwt false). Smoke test: no key → 401, fake key → 401, both in
   `api_request_log`. No customer key was used. `dev_api_auth` does not look at org status, so velogrid's live read key
   (`lb_9ddec9`, last used 21 Sep) keeps working even though its mistaken carrier org is closed.
4. Legacy keys: **left active** (owner decision, 30 Sep). Decide per account from API 360 after review.
5. Milecount partner slug: **`milecount`** (owner: "suggest and implement"). Set on the staging key `lb_fefba0`
   (`api_keys.partner_slug`). Prod has no Milecount key yet — when one is issued, use API 360 → Issue key with partner slug
   `milecount` (`cc_api360_issue_key(..., p_partner_slug => 'milecount')`).
6. **Still to do:** push the frontend (portal, CC API 360, `session.js`, `build_site.py`) — DB + API it needs are now live.
   Open: API rules wording on the signup checkbox (legal wording is the owner's call; links to `/terms.html`).
