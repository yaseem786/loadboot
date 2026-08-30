# Email outreach — deep audit + fixes
**30 Aug 2026 · CC → CRM & leads → Email outreach · prod `rwscphuhpjoudvljvmdk`**

Every number below was read off prod on 29–30 Aug 2026, not estimated.

---

## The headline

The engine has been running flawlessly and going nowhere.

| | |
|---|---|
| Contacts imported | **140,667** (98,585 carrier · 42,082 broker) |
| Contacts ever emailed | **2,830** — 2.0% |
| Contacts never emailed once | **137,837** |
| Emails sent all-time | 13,000 |
| Opens recorded all-time | **0** |
| Replies recorded all-time | **0** |
| Clicks | 46 contacts (broker 1.99%, carrier 1.27%) |
| Signups attributed | **1** (DR&KIDS LLC, carrier, 14 Aug) |
| Bounce rate | 0.71% — healthy |
| Complaints | 2 in 13,000 — healthy |

Deliverability is fine. Volume is fine. Cadence is fine. **Reach is not**, and nothing on the
screen was measuring it.

---

## Gap 1 — day-1 starvation *(the big one)*

`outreach_run_daily` picked candidates with

```sql
order by oc.emails_sent desc, oc.last_sent_at asc nulls last, oc.created_at asc
```

`emails_sent desc` means *finish the drips already in flight before starting anybody new*.
That was harmless while the in-flight cohort was small. It is not harmless now: 2,830
contacts on a 3-day gap generate roughly **940 follow-ups a day** against a **600/day cap**,
so day-1 never reaches the front of the queue.

Day-1 sends, last two weeks:

| Date | New contacts started | Follow-ups |
|---|---|---|
| 29 Aug | **0** | 600 |
| 28 Aug | 45 | 555 |
| 27 Aug | 73 | 527 |
| 26 Aug | 211 | 389 |
| 21 Aug | **0** | 600 |
| 20 Aug | **0** | 400 |
| 18 Aug | **0** | 400 |
| 17 Aug | **0** | 400 |

Six of the last fourteen days started **zero** new contacts. Broker intake over the whole
30-day window: **0**. At that rate the 137,837 untouched contacts are never reached — not
"slowly", never.

**Fixed** (`bl_out_0307`): every run now draws from two buckets and reserves a share for
contacts with `emails_sent = 0`. The share is a setting, `outreach.new_intake_pct`,
default 40%, editable from the CC screen. Either bucket spills into the other when it runs
dry, so no capacity is wasted.

Verified on staging with a seeded 50-old / 50-new cohort and a 20-email allowance:
`{"sent":20, "intake_target":8, "new_contacts_started":8}` — 8 new, 12 follow-ups, exactly
as designed. Spill test (follow-ups only, no fresh contacts): all 20 went to follow-ups.

---

## Gap 2 — 13,000 emails, zero open data

Resend's open tracking was never switched on for `mail.loadboot.com`. It has been a pending
owner action since the 21 Aug audit. Consequence: `opened_at` is null on all 13,000 rows,
so every panel that mentions opens has always read 0 — and a 0 that means *not measured*
looks exactly like a 0 that means *nobody opened it*. There was no way to tell a dead
template from a dead list.

**Fixed** (`bl_out_0307` + new `mail-open` edge function): open tracking is now
**first-party**. `outreach_prepare` — the single render point for every outreach email —
appends a 1×1 GIF pointing at `https://loadboot.com/o.gif?oc=…&d=…&t=…`. Netlify
200-proxies that path onto the `mail-open` edge function, which stamps
`outreach_contacts.opened_at` and `message_deliveries.opened_at`.

- The token is `md5('open:' + contact + day + secret)` — a **different** salt from the
  unsubscribe token, so a scraper walking pixel URLs cannot unsubscribe anybody.
- `outreach_mark_open` is granted to `service_role` only. **No new anon surface.**
- The pixel is appended *after* the plain-text part is generated, so it never leaks into it.
- The endpoint returns a valid GIF on every path including failure — a tracker that errors
  shows up as a broken image in somebody's inbox.
- Templates need no change; tracking is injected centrally.

Verified on staging: valid token → 200, `image/gif`, `opened_at` set, `first_open: true`.
Bad token → 200, valid GIF, nothing stamped. Text part clean.

**This does not need the Resend dashboard toggle any more.** Turning it on as well is still
worth doing (it catches opens the pixel misses when images are blocked), but it is no
longer a blocker.

---

## Gap 3 — the delivery log could not be read

`cc_outreach_log` is hard-capped at 500 rows with **no offset**, no date window and no
search. The screen asked for 200 while its own header said "last 500 max". Against a
13,000-row table that is one truncated page and no way to reach row 201.

There was also a real rendering bug: the log built a **5-column** header and then appended a
**6th cell** only on rows that had a failure reason, so a single failed send knocked the
table out of alignment.

**Fixed:** new `cc_outreach_log_page(filter, kind, days, q, limit, offset)` returning
`{rows, total, limit, offset}`. The old function is left in place so an un-deployed Command
Center keeps working. The screen now has real pages (1 2 3 … 520), 25/50/100 per page,
search by email or company, an audience filter, and new **Opened** / **Clicked** filters.

---

## Gap 4 — the queue number was wrong

`cc_outreach_today`'s "contacts due" set ignored suppressions, contacts who already have an
account, and contacts who had replied or converted — all of which `outreach_run_daily`
excludes. So the number on screen was always larger than what would actually send.

**Fixed:** same predicate as the run, and it now splits `due_new` from `due_followup`.

---

## Gap 5 — nothing compared broker to carrier

| | Broker | Carrier |
|---|---|---|
| List size | 42,082 | 98,585 |
| Never emailed | 40,673 | 97,164 |
| Emailed | 1,409 | 1,421 |
| Clicked | 28 (**1.99%**) | 18 (1.27%) |
| Signups | **0** | 1 |
| New started (30d) | **0** | 120 |

Brokers **click more and convert less**. That is not a copy-quality problem, it is an *ask*
problem — see Gap 7.

**Fixed:** new `cc_outreach_audience` RPC and a side-by-side card, including where each
audience's drip stands per day and the runway to finish the untouched remainder.

---

## Gap 6 — silent failures

`outreach_run_daily` wrapped each send in `exception when others then null` and `continue`d
silently when a template rendered empty. A run with a broken template and a run that
worked returned the same clean JSON. (This is the same trap already recorded for the nag
crons.)

**Fixed:** both are counted, returned in the run result (`send_errors`, `blank_renders`),
and raise a staff notification.

---

## Gap 7 — the broker sequence asks for the wrong thing

Six of the seven broker emails ask a broker who has never heard of LoadBoot to **create an
account**. The one ask LoadBoot can make with zero friction and zero risk — *cc
`loads@loadboot.com` on the load list you already send your carriers* — appears **once**, as
a footnote under a second button on day 1, and never again.

Also found:
- Broker contacts have `state` populated for **all 42,082** rows and it is never used. No
  personalization at all beyond `{NAME}`.
- Day 1 has **two** competing CTAs, splitting the click.
- All seven broker emails are heavy branded HTML. LoadBoot's only conversion to date came
  from the **plain-text** carrier email.
- Subjects are feature-shaped ("Live GPS on every load"), not broker-pain-shaped.
- All CTA target pages exist and resolve — that part is fine.

**Drafted, not applied:** seven replacements in
`docs/outreach/BROKER-DRIP-DRAFT-2026-08-30.html` (open it in a browser — the emails render
exactly as a recipient sees them). Every email now carries **both doors**: the cc address as a
highlighted block (nothing to set up) and the free account as the single button, so both asks
are present without splitting the click. And every email states plainly **what the free account
includes** — a ten-item `$0` panel on days 1, 5 and 7, a one-paragraph version on the rest —
ending with the reason it can be free: LoadBoot is funded by the flat 5% *carrier-side* dispatch
fee, so the broker is never billed. Every claim is lifted from the live site
(`free-load-board-for-brokers.html`, `pricing.html`); nothing is invented. `{STATE}` is merged in
at last. Apply script ready at `docs/outreach/broker-drip-2026-08-30.sql` — **run only after you
approve the draft.**

Two items in the free list need a yes from you before this goes out: *claims desk and documents*
and *the phone app* both come off the live site, but confirm a brand-new broker can really use
them today. A promise a new signup cannot find is worse than not making it.

---

## Gap 8 — replies are invisible, and always will be until hello@ is routed

`trg_outreach_reply` stamps `replied_at` from `mail_messages`, but **hello@ does not route
through the inbound-mail webhook** — only loads@ does. So replied_at is 0 across 13,000
sends and will stay 0 whatever the copy does. Broker and carrier replies land in Yaseen's
inbox and nowhere else.

**Not fixed here** — it needs Cloudflare Email Routing pointed at the `inbound-mail`
function, which is an owner action. It is the single change that makes the next copy test
measurable.

---

## What shipped

**On staging, tested** (`snslhvmkjusozgjelghi`):
- `bl_out_0307_outreach_console` — intake reserve, first-party open pixel, `{DOT}`/`{TRUCKS}`
  merge tags, error counting, indexes, `outreach.new_intake_pct` setting.
- `bl_out_0308_outreach_console_rpcs` — `cc_outreach_log_page`, `cc_outreach_audience`,
  corrected `cc_outreach_today`, and `cc_outreach_control` extended with `daily_cap`,
  `batch_per_run`, `new_intake_pct` (these previously required hand-written SQL).
- `mail-open` edge function, `verify_jwt` off (same pattern as `unsubscribe`).

Grants re-checked after every `create or replace`: no anon execute anywhere.

**In the repo, built and browser-tested, not deployed:**
- `app/command-center/views/outreach.js` — rebuilt screen.
- `app/shared/api.js` — `ccOutreachLogPage`, `ccOutreachAudience`.
- `app/command-center/command-center.css` — console styles.
- `build_site.py` — the `/o.gif` Netlify proxy line.
- `supabase/functions/mail-open/index.ts`.

Real `python build_site.py` → **BUILD OK**, `/o.gif` proxy present in `site/_redirects`.
Browser-driven test of the real view with a stubbed client: mounts clean, no console errors,
pagination sends the right offset, the window control propagates `p_days`, the search box
keeps focus while typing, "show all" expands 7 → 30 rows.

---

## What Yaseen still has to do

1. **Approve or change the broker drip draft**, then run
   `docs/outreach/broker-drip-2026-08-30.sql` (take the backup line at the top first).
   Tell me the sign-off name you want on them, and confirm the two free-list items above.
2. **Apply `bl_out_0307` and `bl_out_0308` to prod** — say the word and I will, they are
   staging-tested. Nothing sends differently until then.
3. **Deploy** (`python build_site.py`, commit, push) — the new screen and the `/o.gif` proxy
   are inert until the site deploys. The `mail-open` function also needs deploying to prod.
4. **Route hello@ inbound** (Gap 8) — the only way reply data ever becomes real.
5. Optional: switch Resend open tracking on as well, for redundancy.

## Decision waiting on you: how fast to burn the list

With the intake reserve at 40% and a 600/day ceiling, roughly 240 new contacts start per day
— about **19 months** to work through 137,837. Raising the ceiling is the lever, and the
list-health numbers (0.71% bounce, 2 complaints in 13,000) say there is room. Both knobs are
now on the screen. **Raise the daily ceiling in steps and watch the bounce rate**, rather
than in one jump — the kill-switch pauses the engine at 10% failures over two days, which
protects the domain but also stops everything.
