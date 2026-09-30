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
6. Frontend pushed and live (30 Sep 2026, owner). Prod anon SECDEF after everything: **36**, md5 `06f779f74423a983253c79ab9d4e1e84`.

## Still open (30 Sep 2026)
1. ~~API rules wording~~ — **done 30 Sep, option B** (`bl_dev_0505`, see the section at the end).
2. **CC → API 360 with a real staff login** — only the owner can do this (never tested against a real staff session).
3. **5 pending developers** — snapshot below (read-only prod query, 30 Sep). Decide per account in API 360.

### Pending developers — prod snapshot (read-only, 30 Sep)
All 5 are `reclassified`: no name / company / website / use case, `terms_accepted_at` null, confirmed email,
signed in only once (the day they signed up). `api_request_log` is new, so 0 calls there says nothing about before 30 Sep.

| Account | Created | Keys (all `read`, none revoked) |
|---|---|---|
| support@velogriddispatch.com | 8 Sep | `lb_7f2a68` never used; `lb_9ddec9` last used 21 Sep |
| techcentralnc@gmail.com | 19 Sep | — (also has agent profile "BRIAN NGUYEN") |
| byteitsolutionsnc@gmail.com | 22 Sep 02:25 UTC | — |
| nguyenbrian83@gmail.com | 22 Sep 02:33 UTC | `lb_b3e55d` never used |
| brian.a@lyntex.io | 29 Sep | — |

Pattern (a guess, not verified): 3–4 of these may be one person — "Brian" in 3 addresses, two "…nc" gmail
accounts, and byteit + nguyenbrian83 signed up 8 minutes apart the same night. Suggested default: keep all 5
`pending` and ask each to finish the profile (use case + company + website) before approving production.
Revoking `lb_7f2a68` and `lb_b3e55d` costs nothing (never used). `lb_9ddec9` is the only key in real use.

### API rules — draft wording (owner to approve; not legal advice)
`/terms.html` has no API section today, so the checkbox links to terms that say nothing about the API.
Option A — checkbox only (smallest change):
> I agree to the LoadBoot Terms and the API Rules: I will keep my API keys secret and not share them; I will show
> "via LoadBoot" on every load that comes from the API and link it back to LoadBoot using the load's url; I will not
> resell, bulk-copy or re-host LoadBoot load data; and LoadBoot may rate-limit, suspend or revoke my keys at any time.

Option B — add an "API use" section to `/terms.html` with the same four points plus: sandbox data is test data;
production access needs LoadBoot approval; LoadBoot may change the API with notice; the developer is responsible
for everything done with their keys. Then the checkbox links to `/terms.html#api`.

## bl_dev_0505 — API use terms (30 Sep 2026, owner chose option B)
- **Terms page:** new "API use" section, clauses A1–A9, anchor `/terms.html#api` (built by `terms_module.py`; nav chip
  + stamp "API use section added 30 September 2026"). Clauses 1–19 untouched. A1 applies; A2 keys; A3 sandbox/production
  (write = verified brokers, Clause 5 applies); A4 "via LoadBoot" + link-back; A5 no resale/bulk copy/competing board/
  going around LoadBoot; A6 rate limits, no extra keys/accounts to dodge them; A7 logs (90 days) + API changes;
  A8 suspension, delete API data within 30 days after access ends; A9 how acceptance and re-acceptance work.
  **Wording is a draft by Claude, not legal advice** — have it read before relying on it in a dispute.
- **DB** (`migrations/bl_dev_0505_api_terms_accept.sql`, staging + prod 30 Sep): `developer_accounts.terms_version`;
  `app_private.dev_api_terms()` = version `api-v1-2026-09-30` + 5 short points; `public.dev_accept_api_terms(p_version)`
  (authenticated only, audited `developer.terms_accepted`); `dev_portal_state` returns `terms{…, needs_accept}`;
  signup records the version only if the screen sent the current one; `dev_request_production` refuses until accepted.
  Existing keys keep working. Staff approval in API 360 is not blocked; API 360 shows "API use terms: accepted … (version)"
  or "old wording only".
- **Portal:** a "Please accept the API use terms" card on top of every tab (5 points, link to `#api`, tick + Accept)
  until accepted; the production-request card says "accept first"; Account tab shows what was accepted. Signup +
  profile-setup consent text now names the API use section and send `terms_version` (`session.js` whitelist).
- **Tests:** staging, rolled back: new-screen signup → version stamped; old-screen signup → null → needs_accept;
  production request refused before accept, allowed after; stale version refused; second accept = no second audit row.
  Chromium 390/1280 (mocked RPCs): terms page 9 clauses, no overflow; card → untick error → accept sends
  `p_version` → card gone → request form back; Account line correct.
- **Prod after apply:** anon SECDEF **36**, md5 `06f779f74423a983253c79ab9d4e1e84` (unchanged); the 5 functions are md5-identical to
  staging (comments stripped); `dev_accept_api_terms` anon=false / authenticated=true; **5 of 5 developers must accept**
  (all reclassified, none accepted before). No email sent — the prompt appears when they next open the portal.
- To change the terms later: edit `terms_module.py` AND bump `version` in `dev_api_terms()` in a new migration → everyone
  is asked again.

## bl_dev_0506 + follow-ups (30 Sep 2026, owner: "ye sub kuch khud kar de")

**1. API 360 check (backend, as the owner's staff uid; no password used).** `cc_api360_list` / `cc_api360_get` run
clean: kpis pending 5, approved 0, active keys 4, open requests 0; the account view carries `terms_version` /
`terms_accepted_at`. The 2 "errors today" are the build's own smoke tests (`lb_000000`, missing key), no developer.
Live bundle `loadboot.com/app/command-center/app.js` contains the "API use terms" row; `loadboot.com/app/developer/app.js`
has the accept card; `/terms.html` has `#api`. `ops.loadboot.com` is blocked from the cloud session, so the screen itself
was not opened in a browser.

**Bug found and fixed — `bl_dev_0506_h_esc_prod.sql` (prod only).** `app_private.h_esc()` existed on staging but never
on prod, so `bl_dev_0502c` broke on prod: `dev_send_email` (→ `cc_api360_revoke_key`, `cc_api360_set_status`
approve/deny/suspend) and `dev_request_production` all raised 42883 and rolled back the whole action. Nobody had hit it
(0 approved, 0 requests). Created with the staging body (prosrc md5 `f05b0ded…` on both), revoked from public/anon/
authenticated. Anon after: **36**, bare-names md5 `06f779f74423a983253c79ab9d4e1e84` (unchanged).

**2. Keys revoked through `cc_api360_revoke_key`** (audited `apikey.revoke`, `revoked_by` = owner uid, done by Claude
on the owner's instruction), 21:22 UTC. Both had `last_used_at` null and 0 log rows:
- `lb_7f2a68` (VeloGrid Dispatch, support@velogriddispatch.com) — `lb_9ddec9` (VeloGrid Loads) left active.
- `lb_b3e55d` (Tbnb, nguyenbrian83@gmail.com).
`developer.key_revoked` emails (account_critical) delivered by Resend 21:23 UTC, none blocked. Production approval for
the 5 pending accounts: nothing to do until each accepts api-v1 and fills use case / company / website.

**3. A1–A9 review (Claude, not a lawyer).** Checked against what the system does: A4 (`url` + `?src=` on every load),
A6 (60/min, shown in portal docs), A7 (log holds key/endpoint/status/time only — no IP; 90 days = setting), A3 (write
scope staff-issued, posting runs the partner-portal validation), cross-refs to Clauses 5/9/10/14/15/16/18 all correct.
No factual error found. Two optional hardening lines, NOT applied (binding text, owner to decide):
(a) A5: "LoadBoot grants you a limited, non-exclusive, non-transferable, revocable licence…" (Clause 10's "no rights
except as stated" already limits it, so the gap is small); (b) Clause 16 indemnity does not name claims from the
developer's own application → "Clause 16 also covers claims arising from your application or its use of API data".
Changing either = edit `terms_module.py` + bump `dev_api_terms()` version. Cheapest now: 0 of 5 have accepted api-v1.

## bl_dev_0511 — API terms api-v1.1 (30 Sep 2026, owner: "dono")

Both optional lines from the A1–A9 review are now in the Terms:
- **A5** opens with the grant: "Subject to these Terms, LoadBoot grants you a limited, non-exclusive, non-transferable,
  revocable licence to use the API and API data for the product you described when you applied."
- **A7** (the clause that already ties the API to Clauses 14/15) now adds: "…and Clause 16 (Indemnification) also covers
  claims arising from your application or its use of API data." Clauses 1–19 stay untouched.
- Version `api-v1-2026-09-30` → **`api-v1.1-2026-09-30`**: `app_private.dev_api_terms()` (+1 summary point, 6 now),
  `app/developer/app.js` `API_TERMS_VERSION`, and "Version api-v1.1" on `/terms.html#api`.
- Applied to staging + prod. Before: 0 of 5 prod developer accounts had accepted api-v1, so nobody loses an acceptance.
  After: anon SECDEF staging 35 / prod **36**, bare-names md5 unchanged (prod `06f779f74423a983253c79ab9d4e1e84`,
  staging `b862e7e206b44d39503adef7970b89d2`); ACL of `dev_api_terms()` still `{postgres=X/postgres}`.
- Local `build_site.py` build OK; `site/terms.html` carries both lines. Goes live with the next Netlify deploy of `main`.
  Until then a signup would send the old version and simply be asked to accept in the portal (harmless).
