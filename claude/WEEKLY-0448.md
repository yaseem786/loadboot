# LoadBoot Weekly — one weekly email, three versions (`bl_comm_0448`, 26 Sep 2026)

Owner decisions, 26 Sep 2026: (1) content to Amazon standard — a fixed premium layout with each person's own
data in it, not prose; (2) registered carriers AND dispatchers get it too, each their own version; (3) the
carrier Monday digest (0259-0265) is merged into it, not sent beside it; (4) the owner previews and approves
each week for the first weeks, then flips to automatic. Everything is in CC → CRM & outreach → **Newsletter**
(`#/newsletter`).

## What goes out

| Version | Key | To | Group | What is in it |
|---|---|---|---|---|
| Carrier | `weekly.carrier` | active, non-demo carrier orgs' active members (weekly summaries on) | `digests` (opt-out) | "Your week" tiles (offers / delivered / invoiced / trips), alerts (expiring docs, truck not posted, onboarding gaps), rates for **their** equipment with week-over-week arrows, one dispatch tip, one compliance reminder, one article, "Open your dashboard" |
| Dispatcher | `weekly.dispatcher` | `dispatcher_profiles` active/verified/trial, not blocked | `digests` (opt-out) | fleet tiles (carriers, bookings + gross, delivered, expiring), per-carrier table (offered / delivered / live / posted?), rates for the fleet's equipment, one dispatcher tip, reminder, article, "Open your workspace" |
| Newsletter | `newsletter.weekly` | confirmed subscribers who are NOT a carrier/dispatcher recipient | `newsletter` (opt-out) | all eight rates with arrows, tip, reminder, article, "See all lanes" |

Staff: `weekly.drafts_ready` (Monday, when approval is manual) and `weekly.unapproved` (Tuesday, if the send found
nothing approved) go to `lc_alert_email()`; both `staff_internal`.

Subjects carry live data: "Your week on LoadBoot · Dry Van $3.03/mi ▲ 2.7%". Body layout skeletons are in
`comm_templates` (tokens `{{hero}} {{your_week}} {{alerts}} {{rates}} {{tip}} {{compliance}} {{article}} {{cta}}
{{note}}`), so CC → Templates can still edit copy. No dark bands, gradients or logos inside the body — the
delivery-worker shell (v16) owns branding and strips any it finds. Contact line is `{{contact_inline}}` (CLAUDE.md §7).

## The week

1. **Monday 12:00 UTC** — cron `lb-weekly-build` → `app_private.weekly_issue_build()`. Picks the least-used
   approved tip / reminder / article from `app_private.weekly_content` (shared across the three versions, so the
   pool is burned once a week, not three times), snapshots `app_private.weekly_rates()` (public benchmarks +
   the previous publish from `rate_history`), writes one `app_private.weekly_issues` row per audience:
   `draft` — or `approved` at once when `comm.weekly_approval = 'auto'`. Manual → staff email "drafts ready".
2. **Owner, Monday–Tuesday** — CC → Newsletter → the three cards. **Preview** renders the exact email for a real
   recipient (pick another from the dropdown; on a database with no dispatchers it shows labelled demo data).
   "Change tip / reminder / article" swaps a slot from the approved pool. **Approve** / **Skip this week**.
   **Build this week now** rebuilds from scratch (clears approvals).
3. **Tuesday 14:00 UTC** — cron `lb-newsletter-weekly` (re-pointed) → `app_private.weekly_send_run()`. Master
   switch `comm.newsletter_enabled` ("Weekly send: ON/off"). Only `approved` (or already `sent`) issues go
   out; each recipient is rendered with their own context and sent through `sys_email` → `email_gate`.
   `app_private.weekly_sends` records one row per issue per address, so "Send now" then the cron cannot
   double-send, and a subscriber confirmed on Wednesday gets that week's issue on the next run ("Send to anyone
   new"). Refusals are counted on the issue and filed by the gate (CC → Unsubscribes → Blocked sends).
4. Unapproved on Tuesday → nothing goes to that audience, staff email "nothing was approved".

## Content pool (`app_private.weekly_content`)

`kind` ∈ tip_carrier / tip_dispatcher / compliance / article; `status` draft → approved → retired; `source`
seed / owner / routine. Seed: the 8 carrier tips + 8 compliance reminders 0447 hard-coded, 8 dispatcher tips,
6 site guides. `used_count` / `last_used_at` are **derived** from the issues (`weekly_content_recount()`,
distinct weeks carrying the item) — never incremented by hand, so rebuilds do not burn the pool.
The Tuesday article Routine adds drafts (rule in `docs/seo-audit-2026-10/ARTICLES.md` §6); the owner approves in CC.
Add your own with "+ Add".

## CC RPCs (authenticated only; view = `unsub_can_view`, manage = `can_manage_comms`)

`cc_weekly_overview()`, `cc_weekly_preview(audience, sample)`, `cc_weekly_issue_set({action: build | approve |
unapprove | skip | send_now | swap, audience, force?, slot?, content_id?})`, `cc_weekly_content_list(kind, status)`,
`cc_weekly_content_set({action: add | edit | approve | retire | delete, …})`, `cc_weekly_settings_set({enabled?,
approval?})`. The 0447 entry points still work: `cc_newsletter_preview()` → public preview, `cc_newsletter_set`
`run_now` → `newsletter_weekly_run()` → `weekly_send_run('public')`.

## Retired

- cron `carrier_weekly_digest` unscheduled; `app_private.carrier_weekly_digest_run()` returns `{retired:true}`.
  `carrier_weekly_summary(org)` (the JSON) is still the data source for the carrier context.
- catalog `carrier_weekly_summary` → status retired, `replaced_by = weekly.carrier`.
- setting `comm.weekly_summary_enabled` is no longer read.

## Anon surface

Unchanged: 35 staging / 36 prod. Every new `public.cc_weekly_*` function is `revoke … from public, anon` +
`grant … to authenticated`. Checked by name after the staging apply (no new names).

## Where it stands — 26 Sep 2026

- **Staging:** applied as `bl_comm_0448_loadboot_weekly` + `bl_comm_0448b_recount` (the `used_count` fix; the repo
  file `migrations/bl_comm_0448_loadboot_weekly.sql` carries both). Smoke-tested inside rolled-back
  transactions: build → 3 drafts + staff mail; forced rebuild keeps `used_count` at 1; render for a real carrier
  org, a synthetic dispatcher and the public version (no `253-7575`, no dark band, no unfilled token, WhatsApp
  contact line present); send with nothing approved → skipped + staff mail; approve carrier + public → 10 + 1
  queued with idempotency keys `wk:<week>:<aud>:<email>`, second run 0; a subscriber who is also a carrier
  recipient excluded from the public send; all CC RPCs exercised as an `authenticated` staff user (previews for
  two different carriers, swap, wrong-kind guard, approve, send blocked while the switch is off, delete-approved
  guard). Nothing was sent; staging tables are empty.
- **CC:** `app/command-center/views/newsletter.js` rewritten (this week's cards, preview drawer with recipient
  picker and swap, content pool with add/approve/retire/delete, the 0447 subscriber list below); six wrappers in
  `app/shared/api.js`. `node --check` clean. Not yet clicked through in a browser — do that on staging first.
- **Prod:** APPLIED 26 Sep 2026 as `bl_comm_0448_loadboot_weekly` (one file, includes the 0448b recount) on
  `rwscphuhpjoudvljvmdk`, after 0455. Checked: anon SECDEF 36, same names as before; cron `carrier_weekly_digest`
  gone, `lb-weekly-build` (Mon 12:00 UTC) + `lb-newsletter-weekly` (Tue 14:00 UTC) scheduled; 6 `cc_weekly_*`
  RPCs authenticated-only; pool 8/8/8/6 seeded; 5 templates + catalog rows live, `carrier_weekly_summary` retired;
  `comm.newsletter_enabled=false`, `comm.weekly_approval=manual`; recipients carrier 67 / dispatcher 1 / public 0
  (no confirmed subscriber yet). Public render sanity: subject carries live rate, no `253-7575`, no unfilled token,
  `{{contact_inline}}` present. Nothing sent, no issue built. Owner next: merge + Publish CC, then CC → Newsletter:
  "Build this week now", preview all three (dispatcher = the one real dispatcher), approve, "Weekly send: ON".
  `comm.weekly_approval` stays `manual`; flip to automatic after ~4 clean weeks.
- **Open:** the tip/reminder pools repeat after 8 weeks unless the Routine keeps adding; the dispatcher version has
  never rendered against a real dispatcher (none on staging) — preview it on prod before approving the first one.

## 26 Sep 2026, evening — first issue live in prod, confirmations sent, copy patch 0448c

- **Owner did the CC steps himself at 17:21 UTC:** "Build this week now" → `2026-W39` carrier / dispatcher / public
  built, all three approved, "Weekly send: ON" (`comm.newsletter_enabled=true`, approval stays `manual`). First
  send is the cron on **Tuesday 29 Sep 14:00 UTC**; recipients carrier 67 / dispatcher 2 / public 0 (nobody
  confirmed yet). `weekly_sends` is empty — nothing has gone out.
- **Previews checked on prod against real data** (carrier "Carrier Account", dispatcher David Thompson, public):
  subject carries the live rate, no `253-7575`, no unfilled token, WhatsApp contact line present, rates table
  renders. The dispatcher version rendered against a real dispatcher for the first time.
- **Copy fixes seen in those previews → `bl_comm_0448c_weekly_copy` (applied prod 17:3x UTC):** carrier hero with no
  equipment on file said "what your lanes is paying" → "are paying"; dispatcher subject said "1 carriers" → new
  token `{{carriers_word}}` in `weekly_render`'s subject vars and in the `weekly.dispatcher` subject template.
  Patched by anchor inside the existing function (ACL untouched); `migrations/bl_comm_0448_loadboot_weekly.sql`
  carries the same text so a fresh apply matches. Anon SECDEF after: 36, same names md5 `06f779f7…`.
- **4 backfilled newsletter addresses:** gate `cc_email_can_send(…, 'newsletter.confirm')` allowed all four
  (essential / account_critical); `cc_newsletter_send_confirm` queued one confirm email each at 17:24 UTC, links
  valid until 3 Oct, `email_blocked_log` empty. Whoever clicks becomes a `public` recipient for Tuesday.
- **Riley call forwarding:** still parked by owner decision (26 Sep, WhatsApp only for now). Not a repo item.
- Watch on Tuesday: CC → Newsletter cards should show `sent` with counts; CC → Unsubscribes → Blocked sends
  for any gate refusals. Staging still needs `bl_comm_0448c` (same file).
