# Unsubscribe engine — bl_comm_0446 (25 Sep 2026)

Owner's ask: whoever unsubscribes — a signed-in carrier/agent or a cold-outreach address that never
signed up — capture the FULL picture at that moment (which kind of email, from which email, by which
route, why), show all of it in CC in the right place, and refuse with the reason when anyone (staff,
Claude in a session, a cron) later tries to send that person the thing they opted out of. Amazon /
Uber standard: per-category preferences, one-click honoured instantly, reasons collected, nothing silent.

**Status:** staging applied + tested 25 Sep 2026 (anon surface 33 → 33, identical names). Both edge
functions are deployed on staging (`unsubscribe` verify_jwt off — it did not exist on staging before;
`delivery-worker` v19, verify_jwt on, as on prod) and the page was exercised end-to-end with a throwaway
delivery row (GET honoured a Summaries unsubscribe, reason attached, RFC 8058 POST ok, resubscribe ok,
rows deleted). Prod: owner applies `migrations/bl_comm_0446_unsubscribe_engine.sql`, deploys the two
edge functions, pushes the site (unsub.html). Order below.

---

## 1. The shape

| Piece | What it is |
|---|---|
| `app_private.unsub_events` | Immutable ledger. One row per unsubscribe / resubscribe: email, user/org, action, scope (`group`/`marketing`/`all`), groups[], reason code + text, **source** (`one_click`, `preference_page`, `legacy_link`, `reply`, `app_prefs`, `cc_manual`, `sms_stop`, `backfill`), the email it came from (`origin_template`, `origin_delivery`, `origin_campaign`), ip, user agent, actor (staff), meta. |
| `app_private.unsub_prefs` | Current state per address × group. `group_code='*'` = every optional email. Points at the event that set it. |
| `app_private.unsub_reasons` | The reason chips the page offers. CC-editable (label, order, on/off). |
| `app_private.unsub_settings` | One row: what a one-click / a reply / an old link means (`group` = only that category, `marketing`, `all`), whether the page offers "stop everything", asks why, allows resubscribe. |
| `app_private.unsub_apply(...)` | **The only writer.** Every route calls it. Mirrors into the legacy stores (`suppressions` reason=`unsubscribed` for marketing, `email_pref_optouts`, `comm_preferences`) so every old gate agrees, flips `outreach_contacts`, cancels queued mail in the groups just left, writes the audit log. |
| `app_private.email_gate(key, to, user)` | **The only decision.** Returns `{allowed, code, reason, group, group_label, essential}`. Order: hard suppression → essential group (always allowed) → `*` → this group → marketing legacy rows / outreach status → the user's in-app toggles. The `reason` is a full sentence naming date, route and what they said. |
| `app_private.sys_email` | Patched (anchor-replace) to call the gate twice (before the catalog lookup for hard blocks, after `email_identify` for everything) and file refusals in `email_blocked_log` with the sentence + a `code` column. |
| `public.cc_email_can_send(to, key)` | Staff: the question to ask before a hand send. Verdict + state + last 10 events + last 10 refusals. |
| `public.cc_unsub_*` | Staff RPCs behind CC → Unsubscribes: `overview`, `events`, `addresses`, `person`, `blocked`, `set` (unsubscribe/resubscribe on someone's behalf; a resubscribe needs a note), `settings_set`, `reason_set`. |
| `public.unsub_link_get / _apply / _reason` | service_role only; the preference page's three calls. Accept the per-delivery uuid token **and** the old outreach `e`+`t` md5 pair. |
| `supabase/functions/unsubscribe` | The preference page (v2). GET honours the unsubscribe immediately (category of the email clicked, per settings), then shows: what changed, "stop every optional email", per-category switches, reason chips + free text, undo. POST form = RFC 8058 one-click. POST json = the page's own calls. |
| `supabase/functions/delivery-worker` (v19) | Optional operational mail (digests, product news, load offers, compliance nudges, billing reminders) now carries **"Manage email preferences"** + `List-Unsubscribe` / `List-Unsubscribe-Post` headers. Essential mail carries nothing. Right before Resend it asks `cc_delivery_worker_optional_allowed` → the gate; a refusal marks the row `unsubscribed` with the sentence. Marketing keeps "Unsubscribe" + `cc_delivery_worker_marketing_allowed` (now also reads `unsub_prefs`). |
| `loadboot.com/unsub.html` | Now a redirect: hands the old `e`+`t` pair to the preference page. Old outreach footers keep working and land on the new page. |
| Carrier app toggles | `cc_pocket_save_preferences` still writes `comm_preferences`, and now emits one event per flipped toggle (`source='app_prefs'`). |

Backfill on apply: existing `suppressions(unsubscribed)`, unsubscribed `outreach_contacts`,
`email_pref_optouts`, `comm_preferences` toggles → prefs + events dated from the original row,
`source='backfill'`. Staging had none; prod will show the real history from day one.

## 2. Where it shows in CC

- **CRM & outreach → Unsubscribes** (`#/unsubscribes`, also in the sidebar next to Email catalog).
  KPIs (unsubscribed / came back / addresses off / blocked sends / hard suppressed), breakdown by route,
  category, reason and originating email, three tabs: **Activity** (the ledger, filters: search, category,
  route, direction), **People** (every address with something off), **Blocked sends** (every refusal with
  the sentence). Any row → the person drawer: per-category state with On/Off switches (comm.manage),
  "check before you send" (type a catalog key → same verdict as send time), timeline, refused sends,
  suppression rows, recent emails. Header: **"Can I send this?"** (any address), **Settings & reasons**,
  **Export CSV**. `#/unsubscribes?email=x@y` opens the person straight away.
- **Deliverability** → "Open Unsubscribes" on the suppression list. **Audiences** → the Unsubscribed KPI
  drills in. **Outreach** → List health drills in. **Carrier 360** → "Email preferences →" under the
  Next-reminder card.

## 3. The rule for every session (also in CLAUDE.md §6.5)

Before any hand send: `select public.cc_email_can_send('<address>', '<catalog key>')`. `allowed=false`
→ do not send, repeat the `reason` sentence to the owner. Never write to `suppressions`,
`email_pref_optouts` or `comm_preferences` directly — go through `unsub_apply` (or `cc_unsub_set`).

## 4. Prod rollout (owner)

1. Apply `migrations/bl_comm_0446_unsubscribe_engine.sql` on prod. Run the anon-surface check: expect
   **34 → 34, identical names**. Check `select count(*) from app_private.unsub_events where source='backfill'`
   is roughly the old suppression + opt-out count.
2. Deploy `supabase/functions/unsubscribe` (verify_jwt **off**, as before) and `delivery-worker` (**v20**, verify_jwt on).
3. Push the site (`unsub.html` becomes the redirect).
4. Smoke, on a throwaway address only: queue a digest to it, open the link, confirm the page, confirm
   CC → Unsubscribes shows the event, then `cc_unsub_set(... 'resubscribe' ...)` with a note and delete
   the test rows.

## 5. Staging test record (25 Sep 2026)

`unsub-test-0446@example.com`, all rows deleted afterwards:
group unsubscribe (digests, reason too_many) → gate blocks `carrier_weekly_summary` with the full
sentence, `account.closed` still allowed (essential), marketing still allowed; `sys_email` refused and
filed the sentence, no delivery row; `all` via one_click → marketing blocked, suppression row added;
resubscribe marketing while `*` was on → `*` cleared, other groups kept off with their reasons,
suppression row removed. Staff RPC shapes checked under a staff JWT.

## 6. Fix 26 Sep 2026 — the page moved to loadboot.com

Supabase serves every HTML response from `*.supabase.co/functions/v1/*` as `text/plain` with
`Content-Security-Policy: sandbox`, so the v2 page showed raw markup (the owner's first staging test).
The old v1 prod page had the same problem. Now:

- `supabase/functions/unsubscribe` **v3 is an API only**. GET 302s to `loadboot.com/unsub.html` (or
  `UNSUB_PAGE_URL`) with the same `token` / `e`+`t` params and changes nothing, so link scanners cannot
  unsubscribe anyone. POST form = RFC 8058 one-click. POST json `{action:'open'|'state'|'unsubscribe'|'resubscribe'|'reason'}`.
  CORS `*` (the token is the credential).
- `loadboot.com/unsub.html` (built by `build_site.py`) **is the preference centre**. It calls its own
  build's project only (the isolation gate forbids the other ref). If the API is still v1 (prod before
  rollout), an old outreach `e`+`t` link falls back to `outreach_unsubscribe` exactly as before, so
  merging the site first does not break prod unsubscribes.
- Tested 26 Sep in Chromium against staging with a throwaway row: open, reason chip + text, a category
  switch, "stop every optional email", undo — all five events landed in `unsub_events` correctly; rows deleted.
- Staging-bound page for hand testing = a local preview build (`CONTEXT=deploy-preview` +
  `LOADBOOT_STAGING_ANON_KEY`) served from `site/`, or a Netlify deploy preview.

## 7. "Fewer emails" — 26 Sep 2026 (owner chose option 3 of 3)

Instead of losing a subscriber, a person can keep a category at **at most one a week / one a month**.
Offered for `unsub_settings.frequency_groups` (default digests, product news, marketing); loads,
compliance and billing never get a cap. No sender changed: `email_gate` counts what the address
actually received in that category and holds the next one back (`code = frequency_cap`, sentence
"… chose at most one Summaries email every 30 days. The last one went on …, so this one is held back
until …"). `sys_email` files it in `email_blocked_log`; the worker's marketing guard honours it too.

- Page: under "You're unsubscribed" a "Rather get fewer instead? once a week / once a month" box for the
  category just left (it turns the category back on at that pace); every capped-allowed row has a
  "how often" selector.
- Ledger: `unsub_events.action = 'frequency'`, `meta.max_per_days` (7 / 30 / null = every email).
- CC: Activity shows "Fewer emails: at most 1 a month"; the person drawer shows and (comm.manage) sets the
  pace via `cc_unsub_frequency_set`; the "Came back" KPI counts people kept on fewer emails.
- Staging: applied as `bl_comm_0446b_fewer_emails` (same SQL as §12 of the migration file), function v3
  redeployed, tested in SQL (cap blocks, operational group refused, reset works) and in Chromium; anon
  surface 33, the new staff RPC is not anon-executable. Test rows deleted.

## 8. Every send path + CC polish — 26 Sep 2026 (owner's CC review)

- **Leak found and closed (worker v20 + §13 = staging `bl_comm_0446c`).** v19 only ran `email_gate` when a queued
  row's meta carried `preference_group`. `cc_enqueue_transactional`, `fire_comm_trigger`, `reminder_dispatch` and
  `lb_email_notify` never set it, so on prod in the last 60 days **93 catalog-`marketing` emails** (agent.invite,
  chat.lead.followup/nudge, call.lead.followup, dispatcher.waitlist/reapply_invite, welcome.founder_broker) went out
  as "transactional" with no unsubscribe check. v20 gates every non-marketing row; `email_gate` resolves the group
  from `email_catalog` by `template_key`, so essential keys still pass. Catalog-marketing rows get the "Unsubscribe"
  label + one-click headers. The "fewer emails" cap now also counts a sent row by its catalog group.
  Tested on staging in a rolled-back transaction: marketing-off → `chat.lead.followup` blocked; `welcome.account`
  essential; `compliance.reminder` allowed; cap counted an `agent.invite` row with no meta group. Anon surface 33, same names.
- **Complaints (spam reports) backfilled** into the ledger as "every optional email" (§13b). Prod has 4.
- **Old records on prod** come in with §9 of the migration at rollout: ~53 soft-unsubscribe suppressions, 52
  unsubscribed outreach contacts (mostly the same people), 1 app toggle, + 4 complaints. Bounces (293) stay hard
  suppressions only — they are not a choice the person made.
- **Not covered by the engine:** `send-email` (CC Support ticket reply, staff-only, straight to Resend). It is a
  one-to-one reply to someone who wrote in, so it is left as is.
- **CC:** Route column is a one-line chip with an icon and the short label; the long sentence is the tooltip.
- **Site:** the footer (strict: build refuses if the Riley line survives) and body `data-lb-contact` links now get
  the same static WhatsApp rewrite as the header. Plain-text Riley mentions remain in contact, faq, privacy, terms,
  security and delete-account pages (sms.html is the allowed exception) — owner to decide.
- **Staging test rows for muhammadyaseenjanjua786@gmail.com deleted** (7 events, 7 prefs, 1 suppression, 1 delivery).

## 9. Prod rollout record — 26 Sep 2026

- **Migration applied** as `bl_comm_0446_unsubscribe_engine` (the whole file, §12 + §13 included). Anon
  surface **34 → 34, identical name set** (md5 of the sorted names unchanged); `app_private` usage for anon still
  false. Function bodies compared with staging by md5: 24 identical, 6 differ only by `--` comment lines that
  staging's apply had stripped (`email_gate`, `unsub_apply`, `unsub_set_frequency`, `cc_delivery_worker_unsubscribe`,
  `cc_pocket_save_preferences`, `unsub_link_reason`) — logic identical.
- **Backfill bug found and repaired (`bl_comm_0446d`).** `app_private.email_identify(email)` returns ZERO rows for
  an address nobody signed up with, so §9a / §13b's `insert … select … from email_identify(r.email)` inserted no
  event for 52 outreach suppressions and 4 complaint addresses: 61 prefs, 5 events, 56 prefs with
  `last_event_id null`. The gate was never at risk (it reads prefs); only CC → Unsubscribes history was short.
  `migrations/bl_comm_0446d_backfill_events_unknown_addresses.sql` writes the missing events dated from the pref
  and links them; applied prod + staging (no-op there). After: **61 events = 53 suppressions + 1 outreach contact +
  3 app toggles + 4 complaints**, 0 prefs without an event, 0 mislinks.
- **`delivery-worker` v20 deployed** (platform version 24, verify_jwt on).
- **`unsubscribe` v3 NOT yet deployed — deliberately.** v3's GET 302s to `loadboot.com/unsub.html?token=…`, and the
  unsub.html live on prod today is the OLD page (`e`+`t` only → "Invalid unsubscribe link"). Order is therefore:
  site push first (new unsub.html), THEN deploy v3 (verify_jwt off), THEN the throwaway smoke test (§4 step 4).
  Until then v20's links land on the v1 function, which still honours the click through the new
  `cc_delivery_worker_unsubscribe` (group-aware) — it just shows the old plain page.
- **Site push** = merge to `main` + Netlify build (`python3 build_site.py`, publish `site/`). The rollout branch
  is merged on `claude/stoic-brahmagupta-nrhrx3`; the owner fast-forwards `main` from GitHub Desktop.
