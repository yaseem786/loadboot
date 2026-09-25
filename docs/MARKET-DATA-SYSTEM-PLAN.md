# Market data system — plan (written 25 Sep 2026, for the next session)

**Owner's goal (his words, 25 Sep 2026):** no page on loadboot.com may show stale data. Every
number, and every word that changes week to week (diesel, rates per equipment, lane rates, "this week",
"September 2026", dates), is controlled from ONE place in CC and published from there. When
something goes stale, CC warns and reminds. Market-rates pages get the most visitors, so a wrong
number there hurts the most.

**Owner decisions already made:**
- Diesel: pulled **automatically** from a free API (EIA), not typed in by hand.
- Publish: not answered yet. **Default in this plan:** Publish in CC triggers a Netlify rebuild on its own,
  and the publish function refuses implausible values, so a bad number never gets to the rebuild.
  Ask him once, then proceed.

---

## 1. What exists today (inventory, 25 Sep 2026, from a full production build)

38 pages print a $/mile or $/gallon figure. By kind:

| Kind | Pages | How it updates today |
|---|---|---|
| Live in the browser | homepage strip, `market-rates` table, 8 equipment hubs | JS calls `get_public_market_rates()` on every visit |
| Live at build time | `market-rates` FAQ, `spot-market-freight-rates`, `truckload-freight-rates` | `build_site.py` reads the RPC (commit `e4da056`); fallback `market_rates_fallback.json` |
| Dated weekly reports | 14 report pages + `freight-market-reports` index | `refresh_rate_snapshot.py` run **by hand**, then a build |
| **Hard-coded — goes stale** | meta descriptions of `market-rates` + 8 hubs · `oversize-load-rates-per-mile` ("~$3.72 legal flatbed"; live flatbed is $3.62) · diesel **$3.85/gal** (`fuel-surcharge-trucking` ×14, `spot` ×1, `truckload` ×3) | by hand only |
| Illustrative, not market data | calculators, load-score, homepage example load, $1.80–$2.00 break-even | no update needed |

Lane rates: the public site has none. They exist only inside accounts (`cc_lane_rate`, live).

**Open data problems found:**
- `app_private.rate_benchmarks` was revised in place for all 8 equipment types (dry van $2.97 → $3.03)
  **without moving `as_of` off 2026-09-18** and without a `rate_history` row. The live pages and the
  week-38 report disagree on the same date.
- `app_private.fuel_prices` says US diesel **$6.529** (as_of 2026-09-21, written 09-23 by hand; nothing
  in the repo writes this table). The site says **$3.85**. One of the two is wrong. EIA is blocked from the
  cloud container, so neither was verified. The EIA pull in step 3 settles it.

---

## 2. Where each number comes from

| Data | Source | Free? | Who does it |
|---|---|---|---|
| **Diesel** (US avg + ~10 regions) | EIA Open Data API v2, weekly retail on-highway diesel (product `EPD2D`, area `NUS` + PADD regions; **verify the IDs against the API before coding**). Published Mondays ~5 pm ET (Tuesday after a holiday). | Yes. Needs a free API key from eia.gov/opendata. | **Auto:** edge function + pg_cron, Tuesday morning ET. CC shows the last pull and allows a manual override. |
| **National rates, 3 anchors** (dry van, reefer, flatbed) | No free API for truckload spot rates. DAT RateView / Truckstop / Greenscreens are paid. DAT's free weekly "Trendlines" page publishes national van/reefer/flatbed averages. **Copying its numbers onto our site may breach DAT's terms. Not checked; owner decides.** Alternative: LoadBoot's own booked loads, once volume allows. | Partly | **Manual weekly:** owner types 3 numbers into CC and presses Publish (≈1 minute). |
| **Other 5 equipment** (step deck, conestoga, power only, hotshot, box truck) | No public weekly source. Derived from the anchors with ratios stored in the DB and editable in CC. **How the Sep 2026 values were built is unknown; check `rate_standards` first.** | — | **Auto** from the anchors |
| **Low / high, shipper, broker sides** | Today's data looks like low = 0.8×, high = 1.2× carrier, shipper = carrier × (1 + broker_margin ≈ 15%). Hotshot/power only use fixed 1.80–3.50. **This is inferred from the numbers, not read from code. Verify it in `rate_standards` before relying on it.** | — | **Auto** |
| **Lane rates** (state → state, per equipment) | In-app only via `cc_lane_rate` (bookings blended with the benchmark). Public per-lane pages would be a new SEO product, a separate decision. | — | Auto (already) |
| **Slow facts** (IRS per diem, IFTA quarterly rates, HVUT, FMCSA fees) | IRS / IFTA / FMCSA pages | Yes | **Manual**, with due dates. **IRS transport per diem changes every 1 Oct**, so `truck-driver-per-diem-2026` is due in days. |

---

## 3. Build order for the next session

Main-loop work: migrations, RLS/RBAC, secrets. Mechanical inventory can go to a haiku subagent.

1. **Registry.** New `app_private.site_facts`: key (e.g. `diesel.us`, `rate.dry_van.carrier`,
   `perdiem.transport.conus`), value, unit, as_of, source, cadence_days, updated_by, updated_at.
   Rates stay in `rate_benchmarks` (`site_facts` points at them) so existing RPCs keep working.
   `revoke ... from public, anon` on every new function, then compare the anon SECURITY DEFINER **names**
   against `docs/audit-2026-09/anon-secdef-baseline.md`.
2. **Publish RPC (staff only).** `cc_market_rates_publish(anchors jsonb)`:
   - sets `as_of = current_date` automatically, so the date is always the publish day
   - writes `rate_history` rows, fixing the in-place-revision bug for good
   - refuses a move over 15% week on week unless a "confirmed" flag is passed (same threshold as
     `_MAX_PLAUSIBLE_WOW` in `market_reports_module.py`)
   - derives the other 5 equipment types plus low/high/shipper
   - fires the Netlify build hook. **The hook URL goes in Vault; the owner creates it and pastes it in himself.**
3. **Diesel auto-pull.** Edge function `eia-diesel-pull` + pg_cron (Tue ~14:00 UTC). Upserts `fuel_prices`
   with EIA's own period date as `as_of`. **The EIA key is a Supabase secret the owner enters himself.**
   On failure: CC warning. The last good value stays and is labelled with its real date.
4. **Build reads everything.** Extend the `_MR_LIVE` pattern in `build_site.py` to diesel and slow facts.
   Replace every hard-coded figure in section 1 (fuel-surcharge page, oversize "$3.72", diesel lines on
   spot/truckload), computing the worked examples as was done on 25 Sep. Weekly reports get built from
   `rate_history` instead of `rate_snapshots.json`, which retires the manual script.
5. **Drift lint.** A build step that scans the output for `$x.xx` in rate or diesel context that did not come
   from the registry, with an allowlist for the illustrative ones. A new hard-coded rate then fails the build
   instead of going stale unnoticed. It also flags "this week", "<Month> 2026" and similar wording that is not
   built from `as_of`.
6. **CC screen "Market data".** Extend `app/command-center/views/marketRates.js`, using `openDrawer()` for
   any popup:
   - Rates tab: 3 anchor inputs, the derived preview for all 8, Publish
   - Diesel tab: last EIA pull, status, manual override
   - Facts tab: slow facts with due dates
   - Pages tab: which pages use which key, and the last build time
   - Stale badges: rates > 7 days, diesel pull failed or > 8 days, a fact past its due date, meta
     descriptions older than the benchmark (these stay manual while their SEO measurement runs)
7. **Reminder email.** Monday staff email when something is stale. **Goes through the email catalog**
   (CLAUDE.md §6): check `email_catalog` for an existing key first, class/audience staff,
   `staff_internal` group.
8. **Test on staging first**: publish a throwaway value, confirm the rebuild, the warnings and the lint, then
   restore it. Then apply to prod and re-check the anon list by name.

## 4. What the owner does himself (never typed in for him)

- Create a free EIA API key and add it as a Supabase secret.
- Create a Netlify build hook and paste its URL into Vault.
- Choose the rates source (DAT Trendlines vs a paid feed vs own data), a terms/legal call.
- Every week: 3 numbers into CC → Publish. Diesel and everything else follow on their own.
