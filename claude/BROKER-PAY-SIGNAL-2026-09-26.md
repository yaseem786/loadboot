# Broker pay-behaviour signal to carriers — design (item 6 of BROKER-AGENT-AUDIT §7)

Status: **designed, not built.** Owner decides. Facts below are from prod (`quickfreights-portal`,
selects only) and the repo at `683a1f5`, 26 Sep 2026. Proposed migration id: `bl_bp_0450`.

## 1. What exists today (and why it is not the signal)

- `public.cc_carrier_view_poster(p_load)` (`bl_ux_0192`) already returns `avg_days_to_pay` +
  `paid_transfers`, and the carrier app shows it in the **poster panel** after the carrier taps a
  load (`app/carrier/app.js` ~4764). It is **not on the load card**, which is where DAT/Truckstop
  put days-to-pay and where the carrier decides whether to call.
- Its metric is wrong. It measures `pay_transfers.received_at − created_at`, i.e. from the moment
  the broker uploaded a payment receipt to the moment the carrier tapped "✓ Received". That is
  how fast the *carrier* confirms, not how fast the *broker* pays. It also counts every kind
  (`claim`, `freight`, `platform_fee`) and every status including `disputed`.
- The line under it, "Payment history (days-to-pay): insufficient verified data yet …", is
  unconditional — it prints even when a number is shown above it (`app.js:4766`).
- **Prod has zero data.** `app_private.pay_transfers` = 0 rows. Broker-partner trips
  (`trips` → `partner_loads.posted_load_id`) = 0. 10 partner loads posted by 2 broker orgs, none
  booked or delivered. So today the signal would be blank for every load on the board; the design
  has to be right about the cold-start state, not just the number.
- The pipeline that will fill it already exists and needs no new writes: freight becomes due at
  `trips.delivered_at` (`pay_due_items`, `bl_pay_0066`), the broker marks it sent in the partner
  app (`pay_instructions` → transfer row, `kind='freight'`, `ref_id=trips.id`), the carrier taps
  Received (`received_at`, nagged via `confirm_nag_count`). First partner delivery = first data point.

## 2. Metric definition (the part to get right once)

Per broker org, over the trailing 12 months, from `pay_transfers` where
`kind='freight' and status='received'`, joined `trips t on t.id=ref_id` and `loads l on l.id=t.load_id`
with `l.broker_org = <org>`:

| Field | Definition | Why |
|---|---|---|
| `paid_n` | count of such transfers | DAT shows count next to the score; n is the credibility |
| `carriers_n` | count distinct `payee_org` | anti-gaming: a broker paying its own pet carrier fast must not earn the chip |
| `median_days` | median of `received_at − t.delivered_at` in days, 1 dp | delivery is the invoice anchor LoadBoot actually has (`trips` has no `invoiced_at`); median resists one late outlier |
| `within_30_pct` | share with `received_at − delivered_at ≤ 30d` | the number carriers ask about ("do they pay in 30?") |
| `last_paid_at` | max `received_at` | staleness |

Exclusions: `organizations.is_demo` orgs on either side (demo isolation stays symmetric);
`status='disputed'` never counts; `claim` and `platform_fee` never count.

**Show a number only when `paid_n ≥ 3 and carriers_n ≥ 2`.** Below that the broker is "no history yet",
not "slow payer". Anchor note: `delivered_at` is conservative against the broker (a carrier who invoices
late inflates the broker's days). Acceptable — it is the same for every broker and it is what we have.
If `trips.invoiced_at` is ever added, switch the anchor there and say so in the copy.

## 3. Where it shows

1. **Load card (board)** — `cc_pocket_available_loads` already returns `details jsonb` and rebuilds
   it in the select (redacting `load_source`). Add one key there, `details.broker_pay`, filled by
   `app_private.broker_pay_stats(l.broker_org)` (lateral, 60 rows/call, `pay_transfers` is tiny).
   **No return-type change** → plain `create or replace`, no drop/regrant, anon-secdef surface untouched
   (the function is `authenticated` only). The card renders a chip next to the trust chip
   (`app.js:4935`): `💰 Pays ~12d · 7 paid` when eligible; **nothing** when not. Do not put "no pay
   history" on every card — today that would stamp every one of the 10 loads on the board as a
   warning, which is the opposite of what a cold-start brokerage with a live bond deserves.
2. **Poster panel** — `cc_carrier_view_poster` reads the same function (one definition, no drift).
   Eligible: `Pays in ~12 days · median of 7 carrier-confirmed payments from 5 carriers, last 12 months · 86% within 30 days`.
   Not eligible: `No payment history on LoadBoot yet — bond on file, authority FMCSA-verified` (the
   two things we DO know; `cc_trust_profile` already carries `verified`). Delete the unconditional
   "insufficient verified data" line.
3. **Not into `trust_score`** for now. That score gates posting limits and the 3→10 ladder; feeding
   it a metric with n=0 on prod changes nothing today and needs its own design when it does.
4. **Not into `source_notice`.** That is stamped at post time by `trust_label_load()` and would go stale.

## 4. Migration shape (`bl_bp_0450`, ~120 lines, main-loop work)

```sql
create or replace function app_private.broker_pay_stats(p_org uuid) returns jsonb
language sql stable set search_path to 'app_private, public' as $$
  with x as (
    select pt.payee_org, extract(epoch from pt.received_at - t.delivered_at)/86400 as d, pt.received_at
      from app_private.pay_transfers pt
      join app_private.trips t on t.id = pt.ref_id
      join public.loads l on l.id = t.load_id
      join public.organizations b on b.id = l.broker_org
      join public.organizations c on c.id = pt.payee_org
     where pt.kind = 'freight' and pt.status = 'received' and pt.received_at is not null
       and t.delivered_at is not null and l.broker_org = p_org
       and coalesce(b.is_demo,false) = false and coalesce(c.is_demo,false) = false
       and pt.received_at >= now() - interval '12 months')
  select jsonb_build_object(
    'paid_n', count(*), 'carriers_n', count(distinct payee_org),
    'median_days', round((percentile_cont(0.5) within group (order by d))::numeric, 1),
    'within_30_pct', round(100.0 * count(*) filter (where d <= 30) / nullif(count(*),0)),
    'last_paid_at', max(received_at),
    'eligible', (count(*) >= 3 and count(distinct payee_org) >= 2))
  from x $$;
-- app_private: no grant needed (not callable by clients); no anon exposure.
```

Then: patch `cc_pocket_available_loads` — in the `details` expression add
`|| case when l.broker_org is not null then jsonb_build_object('broker_pay', app_private.broker_pay_stats(l.broker_org)) else '{}' end`
(read the current def with the `unnest` trick, replace the one anchor `(coalesce(l.details,'{}'::jsonb) - 'load_source')`).
Patch `cc_carrier_view_poster` — replace the `v_dtp/v_dtp_n` select with `v_pay := app_private.broker_pay_stats(v_broker)`
and return `'pay', v_pay` (keep `avg_days_to_pay`/`paid_transfers` keys for one release, sourced from `v_pay`, then drop).
After applying: anon-secdef check must still read 34 prod / 33 staging with the same names (nothing new is public-facing).

App: `app/carrier/app.js` — card chip (~6 lines at 4935), poster panel copy (~10 lines at 4760–4766).
`app/partner/app.js`: untouched (no new broker action). No email, no catalog row.

## 5. Test plan (staging, throwaway records, then clean up)

1. Throwaway broker org + carrier org, 3 trips delivered on dates D, 3 `pay_transfers` rows
   `kind='freight'`, `status='received'`, `received_at = D+9/12/40` → expect `median_days=12`,
   `within_30_pct=67`, `eligible=false` (one carrier). Add a second payee carrier → `eligible=true`.
2. Flip one row to `disputed` → n drops. Set `is_demo=true` on the carrier → its rows drop.
3. `cc_pocket_available_loads` as that carrier: card chip present for the throwaway broker's load,
   absent for the two real brokers (n=0). `cc_carrier_view_poster` shows the cold-start line for them.
4. Delete the throwaway rows. Re-run the anon-secdef name diff.

## 6. Later (not now)

- **Paid credit feed** (TransCredit / DAT CreditScore) — CC's load wizard already captures
  `source.credit_score` + `days_to_pay` by hand for sourced loads (`loadWizard.js:154`), and the
  board redacts `load_source`, so nothing leaks today. A feed would populate the same
  `broker_pay` key with `source:'transcredit'` — same chip, different provenance label.
- Feed `within_30_pct` into `cc_trust_profile` once ≥10 brokers have `eligible=true`.
- `trips.invoiced_at` if carriers start invoicing materially after delivery.
