# Newsletter — double opt-in, consent, category, welcome + weekly digest (bl_comm_0447)

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
