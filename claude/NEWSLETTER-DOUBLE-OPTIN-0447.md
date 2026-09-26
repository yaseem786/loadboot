# Newsletter — double opt-in, consent, category, welcome + weekly digest (bl_comm_0447)

**Status 26 Sep 2026: built and tested on STAGING; waiting for the owner's go for prod.** Decision taken: option (a),
new group `newsletter` ("Tips & market updates"). See "Where it stands" at the end of this file.

Owner decision, 26 Sep 2026: the footer form "Get carrier tips & better loads" must work like
Amazon/Uber. It is built on top of the unsubscribe engine (`claude/UNSUBSCRIBE-ENGINE-0446.md`).
**Precondition: 0446 (incl. §13) is live on prod first.** Build and test on staging only.

## Where it stands today (checked on prod, 26 Sep 2026)

- Form: `build_site.py` → `footer()`/`_footer_raw()` → `window.lbSubmitLead('newsletter', {email})` →
  `public.submit_web_form` → one row in `app_private.form_submissions` (form_key `newsletter`). Nothing else.
- Prod: 5 submissions, 4 people (14 Jul – 19 Sep 2026). No confirmation, no list, no email ever sent to them.
- The form says "Subscribed — thanks!" even when the save fails (`.catch(done)`). That is a false promise.
- Catalog already has `mk.newsletter` (group `marketing`, class M). Groups today: account_critical,
  load_ops, compliance, billing, digests, product_announcements, marketing, staff_internal.

## The four pieces

1. **Double opt-in.** The form calls a new anon RPC. That RPC stores a *pending* subscriber and queues a
   "Confirm your email" email (`newsletter.confirm`, group `account_critical`, because it is
   requested by the person and must arrive). It shows "Check your inbox to confirm". The link goes to
   `loadboot.com/newsletter-confirm.html?t=<token>`. The page calls the confirm RPC, and only then is
   the person on the list. A token expires after 7 days. Re-submitting the same address re-sends
   the email at most once every 24 hours and never says whether the address is already subscribed.
2. **Consent record.** One table `app_private.newsletter_subscribers`: email, status
   (pending/confirmed/unsubscribed), topics, source_page, utm, ip, user_agent, consent_text
   (the exact sentence shown by the form), requested_at, confirmed_at, confirm_ip. Every change also goes into
   `unsub_events` through `app_private.unsub_apply` (CLAUDE.md §6.5, never by hand).
3. **Category.** **Decision for the owner:** either (a) a new preference group `newsletter`
   ("Tips & market updates"), so someone can keep tips while dropping promos (Amazon-style,
   recommended), or (b) reuse `marketing` / `mk.newsletter`. The preference page and CC → Unsubscribes pick up
   a new group with no extra UI work. Every newsletter email carries "Unsubscribe" + RFC 8058 headers
   (worker v20 does this for any non-essential catalogued key).
4. **Welcome + sequence.** On confirm → `newsletter.welcome` (once). Then a weekly digest
   `newsletter.weekly` (Tuesdays, cap 1 a week, stop on unsubscribe). Content comes from what the site already
   publishes each week: market rates (`get_public_market_rates`, the weekly freight-market-report
   pages), one compliance reminder, one dispatch tip. All catalog rows go through `cc_email_template_new` or the
   migration, and all contact lines use `{{contact_inline}}` tokens (CLAUDE.md §7).

## Build order (next session)

1. Owner answers the category question (a/b).
2. Migration `bl_comm_0447` on **staging**. It contains the table, `newsletter_request` + `newsletter_confirm`,
   and the catalog rows for confirm, welcome and weekly. The two RPCs are **new anon SECURITY DEFINER
   functions**. Rate-limit them per IP and per email, and write `revoke ... from public, anon` then
   `grant ... to anon` explicitly. The anon surface goes 33→35 on staging (34→36 prod). Add both names
   to `docs/audit-2026-09/anon-secdef-baseline.md` in the same commit, and compare the names, not just the count.
3. Backfill the 4 existing prod newsletter emails as **pending**, not confirmed. They never confirmed,
   so they each get one confirm email after rollout, which the owner must approve first.
4. Site: the form calls `newsletter_request` and shows an honest state (sent / error, never a fake
   success). Add a consent line under the button, and build `newsletter-confirm.html` in `build_site.py`.
5. CC: a Subscribers view (pending / confirmed / unsubscribed, source page, confirmed date),
   using `openDrawer()` for the person view (CLAUDE.md §8).
6. Weekly sender: a cron that queues `newsletter.weekly` for confirmed subscribers through
   `sys_email`, which runs the gate.
7. Test on staging with a throwaway address: request → confirm → welcome → digest → unsubscribe →
   digest blocked. Then delete the rows. Then prod rollout: owner approval, migration, anon check, site push.

## Not decided here

- Digest writer. SQL template filled from rates (cheap, deterministic) or a sonnet-drafted article
  the owner approves each week. Recommendation: SQL template first.

## Where it stands — 26 Sep 2026 (staging done)

- **Migration** `migrations/bl_comm_0447_newsletter_double_optin.sql` applied on staging (as `bl_comm_0447` + the
  `0447b` token tweak). Anon surface 33 → 35 (`newsletter_request`, `newsletter_confirm`), baseline doc updated.
  Group `newsletter` added (sort 65, opt-out allowed, in the "fewer emails" list). Catalog: `newsletter.confirm`
  (T, account_critical, unsub_allowed=false), `newsletter.welcome`, `newsletter.weekly` (M, newsletter). Bodies in
  `comm_templates` (CC → Templates can edit them; `{{confirm_url}}`, `{{email}}`, `{{site}}`, `{{week_label}}`,
  `{{as_of}}`, `{{rates_table}}`, `{{tip}}`, `{{compliance}}`; `{{contact_inline}}` is filled by sys_email).
- **Weekly send** = `app_private.newsletter_weekly_run()` on cron `lb-newsletter-weekly` (Tue 14:00 UTC), behind
  `system_settings.comm.newsletter_enabled` (**false** until the owner switches it on in CC → Newsletter). Content:
  rates table from `get_public_market_rates()`, one of 8 dispatch tips and one of 8 compliance reminders rotating by ISO
  week. Every send is `sys_email` → `email_gate`. Idempotent per address per ISO week.
- **Staging test (throwaway `nl-test-0447@example.com`, everything inside one rolled-back-at-the-end transaction so
  the worker never saw a row):** request → pending + confirm email queued (token URL filled, WhatsApp contact line
  present); second request in 24 h → no second email; bad token → invalid; expired → expired; confirm → confirmed +
  welcome queued; second click → "already"; weekly run → digest queued (9-row rates table), second run same week →
  nothing; one-click unsubscribe from the weekly email → status `unsubscribed`, gate `unsubscribed_group` with the full
  sentence, `sys_email` refused and filed; resubscribe (staff) → `confirmed`; "stop everything" → `unsubscribed`;
  re-request after that → `pending`, no new confirm inside 24 h; confirm while "*" was on → `resubscribe` event via
  `unsub_apply`. All rows deleted.
- **Site** (`build_site.py`): footer form calls `newsletter_request` with an honest result ("Check your inbox — we sent
  a confirmation link to …" / a real error), honeypot, consent line under the button; falls back to the old lead form
  when the RPC 404s (prod before rollout) with "You're on the list — we'll email you when the newsletter starts".
  New page `newsletter-confirm.html?t=<token>` (confirmed / already / expired → "Send me a new link" / invalid),
  noindex, out of the sitemap. Built locally: BUILD OK.
- **CC → Newsletter** (`#/newsletter`, `app/command-center/views/newsletter.js`): KPIs, status filter, search, table
  (address, status, source page, asked, confirm email + link validity, confirmed, digests, gate verdict), person drawer
  (consent record, newsletter emails, refused sends, timeline, **"Send confirmation email (approve)"** for pending
  rows — once an hour at most), "Preview this week's email" (iframe), "Weekly send: on/off", "Send this week now"
  (confirm dialog, only when on).
- **Prod rollout (needs the owner's go):** 1) apply the migration on prod → anon 34 → 36, names checked; it backfills
  the old `newsletter` form submissions as PENDING with **no email**; 2) push `main` (site + CC); 3) in CC → Newsletter
  press "Send confirmation email" on each backfilled address you approve; 4) switch "Weekly send" on when the first
  Tuesday should go out (preview first). Until step 2 the live footer form keeps working through the fallback.
- **Riley line on pages (same commit, owner decision 26 Sep: the WhatsApp number takes calls but Riley forwarding
  comes later — for now WhatsApp only):** contact.html's "Call us anytime" box and lead, the FAQ/pricing strip
  ("Questions? Reach us 24/7"), security (2×), delete-account, privacy and terms now carry the number as a
  `data-lb-contact="inline"` link, which the build rewrites to "+1 (815) 365-1168 on WhatsApp" while the switch says
  whatsapp — and back to the phone line if it is ever flipped. sms.html keeps the SMS line (allowed exception); the
  FAQ "Call" card stays `data-lb-callonly` (hidden under whatsapp); schema.org keeps the phone field by design.
