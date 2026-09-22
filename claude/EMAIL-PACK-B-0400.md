# Pack B shipped — `bl_comm_0400`, money emails (22 Sep 2026)

LIVE on **staging AND production**. All 4 keys are `status='live'`, `send_mode='test'`.
Nothing reaches a carrier or a broker until the owner flips each one to Live in
Command Center -> CRM & outreach -> **Email catalog** (`#/email-catalog`).

## The corrections that changed the build

`claude/EMAIL-WIRING-PLAN-0399.md` section 3 was wrong the same way section 7 was
wrong for Pack A. Re-verified against both databases on 22 Sep:

| plan said | what is actually there |
|---|---|
| `fin_invoices.status` -> `issued` | no such value. `CHECK (status in ('draft','sent','paid','void'))` |
| `status` -> `failed` / `partial` | no such values either. After `sent` the only outcomes are `paid` and `void` |
| "staff records a dispute note" | there is a real table, `app_private.fin_disputes` (`open`/`resolved`/`rejected`), driven by `cc_open_dispute` / `cc_resolve_dispute` |
| (not mentioned at all) | `app_private.fin_adjustments` holds the itemisation — and `gross` **already includes** every adjustment (`apply_accessorial_to_invoice` does `gross = gross + amount`), so the receipt derives linehaul as `gross - adjustments` instead of adding them |

## The overlap that had to be settled first

`fin_invoices` already had two live senders on staging:
`fee_invoice_notify()` -> `fee.invoice_due` (fires on `status='sent'`, bills the CARRIER
LoadBoot's 5%, idem `feeinv:<invoice_no>`) and `cc_fee_invoice_mark_paid()` ->
`fee.invoice_paid`. Pack B's two invoice emails sit on the same table and the same event.

**Owner's decision, 22 Sep:** the `tx.*` money emails address the **BROKER** — the party
that owes the gross. The carrier's 5% dispatch-fee bill stays on the `fee.*` path.
Nothing in this migration touches `fee_invoice_notify`, so the two cannot double-send.
`tx.invoice_dispute_update` is the one exception: it goes to **both** sides.

## What fires what

All four are **event-driven triggers — no cron, no new state table, no new UI.**

| Key | Trigger | Fires on | To | Idempotency |
|---|---|---|---|---|
| `tx.invoice_ready` | `comm_fin_invoice` on `fin_invoices` | `status` -> `sent` | broker | `invready:<invoice>` |
| `tx.payment_update` | same trigger | `status` -> `paid` (or `paid_at` first set), and `status` -> `void` | broker | `invpay:<invoice>:paid` / `:void` |
| `tx.settlement_ready` | `comm_fin_settlement` on `fin_settlements` | `status` -> `approved`, then -> `paid` | carrier | `setl:<id>:a` / `:p` |
| `tx.invoice_dispute_update` | `comm_fin_dispute` on `fin_disputes` | insert, then `status` -> `resolved`/`rejected` | carrier **and** broker | `disp:<id>:open\|resolved\|rejected` + `:c` / `:b` |

Helpers: `fin_money`, `fin_mail`, `fin_mail_html`, `fin_mail_ctx`, `fin_settlement_ctx`,
`fin_lines_html` — all in `app_private`, so the anon-executable surface is untouched.

## Staging/prod schema drift found on the way (not caused by this migration)

Staging `fin_invoices` carries `stripe_invoice_id`, `stripe_status`, `hosted_url`,
`pdf_url`, `approved_at/by`, `sent_at`, `void_reason`, plus the whole `cc_fee_invoice_*`
Stripe layer. **Production has none of them.** Production's catalog nevertheless shows
`fee.invoice_due` and `fee.invoice_paid` as `live`/`live` with no function on that
database able to fire them — orphan rows worth cleaning up.

`fin_mail_ctx` therefore reads the invoice row through `to_jsonb(i)`, so a column that
does not exist on production reads as null instead of failing to compile. Verified on
prod: `hosted_url` and `void_reason` come back null and the function runs.

## Honesty rules baked in (never invent a value)

- **Payment method** is named only when a Stripe hosted link exists on the row.
  Otherwise the email says the method is not stored, rather than guessing one.
- **Settlement pay date** has no column on `fin_settlements`, so the approval email says
  the pay date is not recorded yet and promises a second email when it is paid.
- **Void reason** and **dispute resolution** fall back to "no reason recorded" /
  "no resolution text was recorded" rather than being left blank or invented.
- **Due date** falls back to "no due date is recorded on this invoice".

## Verified on staging (22 Sep)

Throwaway rows: two invoices (`ZZTEST-0400-A` gross 2650 with a 150 lumper adjustment,
`ZZTEST-0400-B` for the void path), one dispute, one settlement (`ZZTEST-S-0400`).
All **9 sends** fired, every one in test mode to `hello@loadboot.com` with
`[TEST -> real@address]` in the subject:

- `tx.invoice_ready` x1 (broker), `tx.payment_update` x2 (paid + void, broker)
- `tx.invoice_dispute_update` x4 (open and resolved, carrier + broker each)
- `tx.settlement_ready` x2 (approved + paid, carrier)

Itemisation checked on the rendered body: **Linehaul $2,500.00 / lumper accessorial
$150.00 / Total due $2,650.00** — no double-count. Every throwaway row was deleted
afterwards and the table counts returned to their originals (inv 18, setl 4, disp 1,
adj 7). `fee` was set to 0 on both test invoices so `fire_referral_accrue` stayed out of
the test entirely.

## Prod after-apply

- anon-executable SECURITY DEFINER in `public` = **33, names identical to
  `docs/audit-2026-09/anon-secdef-baseline.md`**
- `has_schema_privilege('anon','app_private','usage')` still false
- All four keys `live` / `test`, group `billing`, deep link `#/finance`
- Staging still reads **38** (the SMS/10DLC consent drift already noted in Pack A) —
  unchanged by this migration

## Open items for the owner

1. **Production has no broker side yet.** The single prod invoice sits on a load with
   `broker_org` null, so `broker_email` is null and both broker emails are correctly
   idle. They will start working the moment a load carries a broker org.
2. **`fee.invoice_due` / `fee.invoice_paid` are `live`/`live` on prod with no sender.**
   Either port the Stripe fee layer to prod or set those two rows to `planned`.
3. **Preference group.** All four sit in `billing`, which is opt-out-able, so
   `unsub_allowed=true` is the honest setting. The plan doc wanted "no unsubscribe on
   receipts" — that would need a non-opt-out group, and the standing rule says only
   `account_critical` and `staff_internal` may be unblockable. Worth a decision before
   these go Live.

## Next

- Pack C `bl_comm_0401` — security (4). This one **does** need new state
  (`auth_device_seen` + a sweep over `auth.audit_log_entries`); that part of the plan was
  re-checked on 22 Sep and still holds.
- Pack D `bl_comm_0402` — ratings + campaign shells.
