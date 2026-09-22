# Wiring the 29 planned emails — build plan (bl_comm_0399 onwards)

> **CORRECTION, 22 Sep 2026 — sections 3 and 7 have both been found wrong and rewritten.**
> Section 7 said there was "no POD anywhere in the schema" and "no arrival/departure
> capture". **Both were wrong**; Pack A shipped as pure wiring. Section 3 then said
> `fin_invoices.status` goes to `issued` and to `failed`/`partial`. **Also wrong** — the
> CHECK is `draft|sent|paid|void`. Pack C's claim that nothing captures logins was
> re-checked on 22 Sep and still holds. **Rule 8 below exists because of this: check the
> schema before believing any "this does not exist" or "this status exists" claim in this
> document.**

Written 22 Sep 2026. Companion to `claude/EMAIL-AUDIT-0391.md` and
`claude/EMAIL-CATALOG-PROD-0395.md`. Yaseen's decision: **build all four packs, and every
new email starts switched to Test until he flips it to Live.**

---

## 0. What is already in place (live on staging AND production)

| | |
|---|---|
| `bl_comm_0391…0394` | the catalog, preference groups, sender identities, `email_catalog_sync()`, the six `cc_email_*` RPCs |
| `bl_comm_0395` | `sys_email` v2 — category from the catalog, preference groups enforced, `recipient_user`/`org_id` filled, overrides honoured |
| `bl_comm_0396` | `cc_email_sends()` — per-email timeline: who got it, when, what happened, blocks included |
| `bl_comm_0397` | **send discipline** — quiet hours, daily cap, minimum gap. `app_private.email_send_policy.enabled = false` (nothing applies until it is turned on). Held mail is deferred, not dropped, and released by the `comm-release-due` cron |
| `bl_comm_0398` | **the switch** — `email_catalog.send_mode` = `live` \| `test` \| `off`, set from the CC drawer. Test copies go only to the test address with `[TEST → real@address]` in the subject |
| `bl_comm_0399` | **Pack A shipped** — 14 trip/POD/detention/exception emails wired on both databases, all in `send_mode='test'`. See `claude/EMAIL-PACK-A-0399.md` |
| `bl_comm_0400` | **Pack B shipped** — 4 money emails wired on both databases, all in `send_mode='test'`. See `claude/EMAIL-PACK-B-0400.md` |

So the safety rails exist. Everything below is the actual wiring.

---

## 1. The standard being followed (researched, with sources)

- **Transactional vs marketing**: CAN-SPAM's transactional/relationship carve-out is read narrowly; those messages skip the ad-label, address and opt-out rules but the headers must still be accurate. https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- **CASL** has no equivalent clean carve-out, so a Canadian contact gets sender identification and a working unsubscribe honoured within 10 business days. https://crtc.gc.ca/eng/com500/faq500.htm
- **Caps and spacing**: Uber's push engine enforces a per-user daily cap, a minimum gap between sends and a send window, and drops the lowest-value message rather than queueing everything. LoadBoot defers instead of dropping — a carrier missing a POD request is worse than a late one. https://www.uber.com/us/en/blog/how-uber-optimizes-push-notifications-using-ml/
- **Security alerts** (Google/Amazon/Microsoft shape): fire immediately, state device, approximate location and time, and carry **no clickable action link** — the reader is told to sign in normally. https://googlesystem.blogspot.com/2015/05/google-sends-email-notifications-for-new-sign-ins.html
- **Receipts** (Stripe anatomy): business identity, receipt number, date, itemised lines, total, payment method with last-4 masked, status, support/dispute route. https://stripe.com/resources/more/receipt-template-what-to-include-and-templates-for-different-use-cases
- **POD chase cadence**: benchmark is POD inside 24 hours — passive for the first hours, first outreach at 4–6h, escalation at 12–16h, exception flag at 24h, with well-run desks at ≥85% inside 24h. https://getclearlane.com/blog/pod-chase-best-practices/
- **Detention**: 2 hours free time is the industry norm (sometimes 4 by contract); it is contractual, not FMCSA rule. https://truckstop.com/blog/detention-pay-for-carriers-and-freight-brokers/
- **TONU**: applies on a day-of-pickup cancellation; tell the carrier the moment it is logged. https://www.atsinc.com/blog/truck-order-not-used-tonu-charge-explained
- **Preference centre**: section → category grouping, with non-optional categories shown as a visible but disabled toggle rather than hidden. https://www.suprsend.com/post/notification-preference-center
- **Ratings**: Uber asks at the end of the trip; no published reminder count, so one ask and one reminder is a design choice, not a standard.

Where a number has no source (check-call interval, detention pre-warning, lumper notice window) the plan says so, and the value is a LoadBoot decision — not to be presented as an industry rule.

---

## 2. Pack A — Loads & trips (14 emails) · `bl_comm_0399` — **SHIPPED 22 Sep 2026**

**As built**, on both databases, every key `status='live'`, `send_mode='test'`:

| Key | Fires on | Cadence / cap | Stop |
|---|---|---|---|
| `tx.pod_required` | delivered, no POD row | 4h, then 12h, then 24h | a POD row exists (pending or approved) |
| `tx.pod_approved` | `document_files.status` → approved | once per document | — |
| `tx.pod_rejected` | → rejected, `review_note` is the reason | once per document | — |
| `tx.trip_delivery_reminder` | `scheduled_delivery` − 12h | once per trip | delivered or cancelled |
| `tx.trip_checkin_reminder` | in transit, no trip event or ping for 24h | once a day, cap 3 | any event or ping in 24h |
| `tx.tracking_stale_warning` | consent on, `last_loc_at` older than 6h | once per stale spell | a fresh ping |
| `tx.detention_opened` | a `trip_dwell_events` arrival is recorded | once per arrival | — |
| `tx.detention_warning` | free time gone, no departure | hourly, cap 6 | departure recorded |
| `tx.load_tonu` / `tx.load_lumper_request` / `tx.trip_layover` | `trip_accessorials` insert of that kind | once per accessorial | — |
| `tx.trip_breakdown` / `tx.trip_accident` / `tx.trip_exception_update` | `trip_exceptions` insert | once per exception | — |

Mechanism: four triggers (`comm_pod_reviewed`, `comm_dwell_arrived`, `comm_trip_exception`,
`comm_accessorial`), one cron (`lb-trip-comm`, `*/15 * * * *` → `app_private.cron_trip_comm()`),
and four helpers (`trip_mail_ctx`, `trip_mail`, `trip_mail_html`, `mail_sent_count`).
**No new state table** — every cap and stop condition is read back out of
`app_private.message_deliveries` by `idempotency_key`.

## 3. Pack B — Money (4 emails) · `bl_comm_0400` — **SHIPPED 22 Sep 2026**

> **This section was wrong when it was written and has been rewritten from the databases.**
> It claimed `fin_invoices.status` goes to `issued`, and to `failed` / `partial`. None of
> those values exist. It also did not know `fin_disputes` or `fin_adjustments` existed.

Verified schema (both databases, 22 Sep 2026):

- `app_private.fin_invoices(invoice_no, carrier_id, load_id, trip_id, gross, fee_pct, fee,
  net, status, issued_at, due_at, paid_at, settlement_id, …)` —
  `CHECK (status in ('draft','sent','paid','void'))`. **Staging additionally** has
  `stripe_invoice_id, stripe_status, hosted_url, pdf_url, approved_at/by, sent_at,
  void_reason`; **production has none of them.**
- `app_private.fin_settlements(settlement_no, carrier_id, period_start/end, gross, fee,
  net, status, approved_at, paid_at, version, approved_version)` —
  `CHECK (status in ('pending','approved','paid','void'))`. There is **no expected-pay-date
  column**.
- `app_private.fin_disputes(invoice_id, reason, status, resolution, resolved_at/by)` —
  `CHECK (status in ('open','resolved','rejected'))`, driven by `cc_open_dispute` and
  `cc_resolve_dispute`.
- `app_private.fin_adjustments(invoice_id, settlement_id, kind, amount, note)` — the
  itemisation. **`gross` already includes every adjustment** (`apply_accessorial_to_invoice`
  does `gross = gross + amount`), so a receipt must derive linehaul as
  `gross - adjustments`, never add them on top.

**As built**, on both databases, every key `status='live'`, `send_mode='test'`, group
`billing`, class T, deep link `#/finance`:

| Key | Fires on | To | Idempotency |
|---|---|---|---|
| `tx.invoice_ready` | `status` → `sent` | broker | `invready:<invoice>` |
| `tx.payment_update` | `status` → `paid` (or `paid_at` first set), and `status` → `void` | broker | `invpay:<invoice>:paid` / `:void` |
| `tx.settlement_ready` | `status` → `approved`, then → `paid` | carrier | `setl:<id>:a` / `:p` |
| `tx.invoice_dispute_update` | dispute insert, then → `resolved`/`rejected` | carrier **and** broker | `disp:<id>:<stage>` + `:c` / `:b` |

Mechanism: three triggers (`comm_fin_invoice`, `comm_fin_settlement`, `comm_fin_dispute`)
and six `app_private` helpers (`fin_money`, `fin_mail`, `fin_mail_html`, `fin_mail_ctx`,
`fin_settlement_ctx`, `fin_lines_html`). **No cron, no new state table, no new UI**, and
nothing added to the anon-executable surface.

**Overlap decision (owner, 22 Sep 2026).** `fin_invoices` already had live senders:
`fee_invoice_notify()` → `fee.invoice_due` and `cc_fee_invoice_mark_paid()` →
`fee.invoice_paid`, both staging-only, both billing the **carrier** LoadBoot's 5%. So the
`tx.*` money emails address the **broker** — the party that owes the gross — and the `fee.*`
path is left untouched. `tx.invoice_dispute_update` is the only one that mails both sides.

**Honesty rules baked in.** Payment method is named only when a Stripe hosted link exists
on the row; the settlement approval email says the pay date is not recorded yet instead of
inventing one; void reason, dispute resolution and due date all have explicit "not
recorded" fallbacks.

Full build record: `claude/EMAIL-PACK-B-0400.md`.

## 4. Pack C — Security (4 emails) · `bl_comm_0401`

**Nothing captures logins today** (re-checked 22 Sep 2026 — still true).
`app_private.web_sessions` is marketing analytics (anon_id, device, browser) — not auth. The build therefore adds:

- `app_private.auth_device_seen(user_id, device_fp, first_seen, last_seen, ip, ua)`
- a cron that reads `auth.audit_log_entries` for sign-in events, compares against `auth_device_seen`, and fires on a device or IP never seen before.

| Key | Fires on | Rule |
|---|---|---|
| `tx.security_alert` | sign-in from an unseen device/IP | immediate, device + approximate location + time, **no clickable link**, never held by quiet hours (account-critical) |
| `security.password_changed` (new key) | password change | immediate, to the address on file |
| `security.email_changed` (new key) | email change | sent to **both** the old and the new address |
| `security.payout_changed` (new key) | bank/payout detail change | immediate, plus a staff copy — this is the fraud vector with the most money behind it |

## 5. Pack D — Ratings & campaigns (5 emails) · `bl_comm_0402`

- `rating.invite` — trip delivered + POD approved → invite both sides, once per trip per side, one reminder after 72h, stops the moment a row lands in `app_private.party_ratings`. Group `digests`, opt-out allowed. Note there is already a `trip_rating_invite` trigger on `app_private.trips` — check what it does before adding a second path.
- `mk.newsletter`, `mk.promotion`, `mk.reengagement`, `mk.referral_invite` — these are campaign shells, not triggered mail. Wiring = making them selectable in CC Campaigns (`cc_campaign_enqueue`), so they inherit consent, the unsubscribe link and the marketing sender. They stay class M, group `marketing`, and only send to contacts with marketing consent.

---

## 6. Rules every one of these must follow

1. Created with `send_mode='test'` and `status='live'` only once Yaseen flips the switch.
2. A catalog row in the same migration that wires it — never a sender without an entry.
3. Class and preference group set honestly: account-critical only where a person genuinely cannot opt out.
4. Every cron-fired email needs a cap and a stop condition written into `cap_note` / `stop_condition`, and the code must enforce them, not just describe them.
5. Idempotency key per event (`key:trip_id:stage`), so a re-run cannot double-send.
6. Nothing writes to a customer's mailbox from a migration itself — migrations create senders, crons and triggers fire them.
7. After each pack: `select app_private.email_catalog_sync();` and check the anon-executable SECURITY DEFINER **names** against `docs/audit-2026-09/anon-secdef-baseline.md` (prod = 33, names verified unchanged after 0399 and 0400).
8. **Check the schema before believing ANY claim in this document** — not just "this does not exist", but "this status exists" too. Section 7 was wrong for Pack A and section 3 was wrong for Pack B, both in ways that would have shipped broken senders.
9. **Check for an existing sender on the same table and event before adding one.** Pack B nearly double-sent because `fee_invoice_notify` was already firing on `fin_invoices.status='sent'`.

## 7. Honest gaps — rewritten 22 Sep 2026 after verification

1. ~~No POD anywhere in the schema.~~ **Wrong.** POD lives in `app_private.document_files`
   (`owner_type='trip'`, `kind='pod'`). Pack A uses it as-is; no checklist row was added.
2. ~~No arrival/departure capture.~~ **Wrong.** `app_private.trip_dwell_events` plus
   `cc_trip_arrive` / `cc_trip_arrive_gps` / `cc_trip_depart`, already in `app/shared/api.js`.
   Free time is per-arrival (`free_minutes`, default 120), so a 4-hour contract is already
   representable without a schema change.
3. **Opens and clicks are still not tracked on production mail** (every `opened_at` is null),
   so "did they read it" cannot be answered yet. Unchanged.
4. Production currently holds 1 trip, 1 invoice and 1 settlement — these senders are correct
   but nearly idle until real freight moves. The Pack A cron has a 7-day (POD) and 3-day
   (detention) look-back precisely so that flipping to Live cannot back-blast old freight.
5. **Production has no broker side on its invoices.** The one prod invoice sits on a load
   with `broker_org` null, so `tx.invoice_ready` and `tx.payment_update` are correctly idle
   there until a load carries a broker org.
6. **Staging/production schema drift on `fin_invoices`** (the whole Stripe fee layer exists
   on staging only), and production's catalog lists `fee.invoice_due` / `fee.invoice_paid`
   as `live`/`live` with no function on that database able to fire them. Orphan rows — either
   port the layer or set them back to `planned`.
