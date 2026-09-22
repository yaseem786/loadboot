# Pack A shipped — `bl_comm_0399`, trip & POD emails (22 Sep 2026)

LIVE on **staging AND production**. All 14 keys are `status='live'`, `send_mode='test'`.
Nothing reaches a carrier or a broker until the owner flips each one to Live in
Command Center -> CRM & outreach -> **Email catalog**.

## The correction that changed the build

`claude/EMAIL-WIRING-PLAN-0399.md` section 7 said there was "no POD anywhere in the
schema" and "no arrival/departure capture". Both were wrong — re-verified from the
databases on 22 Sep:

| plan said | what is actually there |
|---|---|
| no POD field | `app_private.document_files` (`owner_type='trip'`, `kind='pod'`, status/review_note/invoice_prepared) + `cc_pocket_upload_pod`, `cc_review_pod_core`, `cc_pod_review_queue` |
| no detention table | `app_private.trip_dwell_events` (arrived_at, departed_at, free_minutes default 120, lat/lng) + `trg_auto_detention` |
| no arrival/departure input | `cc_trip_arrive`, `cc_trip_arrive_gps`, `cc_trip_depart` — already in `app/shared/api.js` |
| TONU / lumper / layover / exceptions need building | `trg_auto_tonu`, `cc_add_accessorial`, `cc_carrier_request_accessorial`, `cc_log_exception` + `trip_exceptions` |

So Pack A created **no new tables and no new UI**. It is pure wiring: 4 triggers,
1 cron, 4 helper functions, 14 catalog rows.

## What fires what

**Triggers (event):**
- `comm_pod_reviewed` on `document_files` -> `tx.pod_approved` / `tx.pod_rejected` (carrier)
- `comm_dwell_arrived` on `trip_dwell_events` -> `tx.detention_opened` (carrier + broker)
- `comm_trip_exception` on `trip_exceptions` -> `tx.trip_breakdown` / `tx.trip_accident` / `tx.trip_exception_update` (both)
- `comm_accessorial` on `trip_accessorials` -> `tx.load_tonu` / `tx.load_lumper_request` / `tx.trip_layover` (both).
  `kind='detention'` is deliberately silent here so the dwell path and the accessorial
  path cannot double-send.

**Cron `lb-trip-comm`, `*/15 * * * *` -> `app_private.cron_trip_comm()`:**

| email | when | cap | stops when |
|---|---|---|---|
| `tx.pod_required` | 4h / 12h / 24h after delivery | 3 per trip | a POD row exists (pending or approved) |
| `tx.trip_delivery_reminder` | 12h before scheduled delivery | once per trip | delivered or cancelled |
| `tx.trip_checkin_reminder` | in transit, silent 24h | 3 per trip, 1/day | any trip event or position ping in 24h |
| `tx.tracking_stale_warning` | consent on, last ping > 6h | once per stale spell | a fresh ping (the idem carries `last_loc_at`) |
| `tx.detention_warning` | free time gone, no departure | 6 per arrival | departure recorded |

## Where the caps live

There is **no new state table**. Every cap and stop condition is read back out of
`app_private.message_deliveries` by `idempotency_key`, via
`app_private.mail_sent_count(key, prefix)`. Idem prefixes:
`podchase:<trip>:<stage>`, `delivrem:<trip>`, `checkin:<trip>:<YYYYMMDD>`,
`trackstale:<trip>:<epoch of last ping>`, `detwarn:<dwell>:<n>`,
`detopen:<dwell>`, `podrev:<doc>:<a|r>`, `tripexc:<exception>`, `acc:<accessorial>`.
`app_private.trip_mail()` appends `:c` / `:b` for the side, and `sys_email` appends
`:test` in test mode.

## Safety properties worth keeping

- **No back-blast.** The POD chase only looks at trips delivered in the last 7 days and
  the detention sweep only at arrivals in the last 3 days, so flipping these to Live
  cannot chase historical freight.
- **Demo orgs never get mail** — `trip_mail_ctx` returns `demo=true` and `trip_mail`
  returns early.
- `trip_mail` never raises, so a mail problem can never fail an arrival, a POD review or
  an accessorial.

## Verified on staging (22 Sep)

All 14 keys fired, every one in test mode addressed to `hello@loadboot.com` with
`[TEST -> real@address]` in the subject. Throwaway rows (dwell, exception, two
accessorials, two POD docs) were inserted, checked and deleted; the two trips whose
timestamps were nudged to exercise the POD chase and the delivery reminder were restored
to their exact original values.

Prod after-apply: anon-executable SECURITY DEFINER in `public` = **33, names identical to
`docs/audit-2026-09/anon-secdef-baseline.md`**; `has_schema_privilege('anon','app_private','usage')`
still false. Prod dry run returned 0 sends (1 trip, no candidates).

**Baseline drift to note (not from this migration):** staging now reads **38**, not the 32
in the baseline doc. The six extra are `dialer_sms_consent_record/revoke/state` and
`sms_consent_self_state/self_sync/set_self` — the 10DLC/SMS consent work. Prod does not
have them yet. The baseline doc should be refreshed.

## Next

- Pack B `bl_comm_0400` — money (4): `tx.invoice_ready`, `tx.payment_update`,
  `tx.settlement_ready`, `tx.invoice_dispute_update`. `fin_invoices` / `fin_settlements`
  already exist; same pattern, group `billing`.
- Pack C `bl_comm_0401` — security (4). This one **does** need new state
  (`auth_device_seen` + a sweep over `auth.audit_log_entries`); that part of the plan
  was checked and is still true.
- Pack D `bl_comm_0402` — ratings + campaign shells.
