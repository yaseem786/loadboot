# Unsubscribe engine — bl_comm_0446 (25 Sep 2026)

Owner's ask: whoever unsubscribes — a signed-in carrier/agent or a cold-outreach address that never
signed up — capture the FULL picture at that moment (which kind of email, from which email, by which
route, why), show all of it in CC in the right place, and refuse with the reason when anyone (staff,
Claude in a session, a cron) later tries to send that person the thing they opted out of. Amazon /
Uber standard: per-category preferences, one-click honoured instantly, reasons collected, nothing silent.

**Status:** staging applied + tested 25 Sep 2026 (anon surface 33 → 33, identical names). Prod: owner
applies `migrations/bl_comm_0446_unsubscribe_engine.sql`, deploys the two edge functions, pushes the site
(unsub.html). Order below.

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
2. Deploy `supabase/functions/unsubscribe` (verify_jwt **off**, as before) and `delivery-worker`.
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
