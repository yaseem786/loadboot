# Supply-side board audit — DAT/Relay parity (0457, 26 Sep 2026)

Scope: broker post-load wizard (`app/partner/app.js`, "Load Wizard (Inc 44)", ~L1866–2930) and the
carrier load board (`app/carrier/app.js` `loadLoads()` ~L4084, `loadCard()` ~L4550, `showLoadDetail()`
~L5020). The RPC shapes were read on **staging** (read-only). Nothing was written to any database.

## Shipped in this commit (client only, no migration)

| # | Where | What |
|---|---|---|
| 1 | carrier board | **Sort dropdown** (Newest / Highest pay / Highest $/mi / Shortest deadhead / Earliest pickup). Before this the board had no sort. Direct offers to this carrier stay pinned on top in every sort. Deadhead sort uses the same number the card shows (`window.__lbDh` GPS value, falling back to `l.deadhead`). Loads with no value go to the bottom. The choice is saved in `lb_lb_sort`. |
| 2 | wizard draft | **Bug:** the draft auto-save wrote in-flight flags (`__laneP`, `__stds_p`, `__stds_p3`) plus cached rate tables to `lb_pl_draft`. If a refresh landed during a fetch, the lane-rate card and the CC rate standards never loaded again for that draft, and old rate standards stayed in the market estimate. Those keys are now removed on save and on restore. |
| 3 | wizard step 2 | **Bug:** the suggested delivery date used `toISOString()` (a UTC date), so an evening ETA showed the next calendar day. It now uses the local date. |

Checked and fine: `cc_partner_submit_load` reads named keys only (load_size, pallets, temperature
and tarps go into `details`), so the extra `__*` keys in the payload are never stored.
`cc_pocket_available_loads` returns **no street / origin_full** before booking, so brokers are
protected from back-solicitation.

## Gaps against DAT / Relay, highest value first

### Carrier board
1. **No post age ("posted 12m ago").** DAT's Age column is how carriers find fresh freight. The RPC
   does not return `created_at`, even though it already sorts by it. Fix: add `posted_at` to
   `cc_pocket_available_loads`. Because it changes `RETURNS TABLE`, the function has to be dropped
   and recreated, which also means re-granting execute (revoke from `public, anon`) and re-checking
   the anon SECDEF names. That is main-loop work and needs your go-ahead. After that, the card chip
   and a "Newest" sort built on real time are a small client change.
2. **The board is capped at 50 loads.** The server clamps `least(p_limit, 50)` and the client asks
   for 60. There is no paging or "load more", so load #51 onward is invisible to every carrier.
   Fine at today's volume, but it will break silently once volume grows.
3. **Filters are substring text matches.** There is no origin + radius search (DAT's core search,
   e.g. "within 100 mi of Dallas"), no pickup-date range, no multi-state or region filter, and
   equipment is a free-text box instead of a picker. Radius is possible on the client because rows
   carry `pickup_lat`/`pickup_lng`; it needs the city geocoder the wizard already uses.
4. Saved lane searches and alerts: `preferred_lanes` exists in dispatch prefs. **I have not checked**
   whether it notifies anyone when a matching load is posted. Check this before building anything.

### Broker wizard
5. ✅ **SHIPPED (0457b) — see "Post similar" below.** ~~No "Post similar" / copy from a past load.~~ Brokers repost the same lanes every day, and DAT
   and every TMS have templates or copy. Today every repost means re-typing 5 steps. Proposal: a
   "⧉ Post similar" button on each My Loads row. It would call `partnerLoadFull(id)`, map the
   fields into the wizard state `w` (addresses, equipment, commodity, weight, service flags and
   accessorials; not dates or reference numbers) and open step 1. This is client only, but the
   field mapping must be checked against the real `cc_partner_load_full` output first.
6. **Street address and ZIP are required before the load can be posted.** DAT and Relay need only
   city and state. Many brokers do not have the dock address, or do not want to give it, until the
   load is booked. LoadBoot needs the exact pin for the geofence and the automatic miles, so this is
   **your decision**: keep it strict, or allow city-only posting with the address due before dispatch.
7. **Missing standard posting fields:** trailer length (48/53 ft), dimensions (L×W×H) for
   flatbed/step-deck/over-dimension loads, and alternate equipment ("Van OR Reefer"). DAT postings
   carry all three, and carriers filter on length.
8. **A 5-step wizard compared with DAT's one-screen post.** The wizard is thorough (HOS checks,
   lane-fit check, hazmat, rate card), but a "quick post" for a repeat lane would cover most reposts,
   especially together with #5. (This is my judgement, not measured.)
9. **Routing and geocoding use public demo servers.** Miles use `router.project-osrm.org` and stop
   geocoding uses `photon.komoot.io`, both straight from the browser. They are rate-limited and have
   no SLA. When they fail, auto-miles fail silently and the HOS and ETA checks fall back to typed
   miles. Worth moving behind our own edge function or a paid provider before volume grows.

## Suggested order
#5 Post similar (client only, biggest time saver for brokers) → #1 post age (small migration, needs
approval) → #3 radius search → #7 length/dims/alt equipment (the posting side, then a board filter)
→ #2 paging. #6 needs your decision first.

## 0457b — "Post similar" (shipped)

- **Button:** "⧉ Post similar" on every My Loads row (`postSimilar()` in `brokerDash`, `app/partner/app.js`).
- **Source:** `partnerLoadFull(id)`. On 26 Sep, `cc_partner_load_full` was identical on prod and staging
  (md5 of the definition matched). It only returns the broker's own load (`broker_org = v_org`).
- **Copied:** lane (street, city, ST, ZIP), extra stops with their exact pins, miles, equipment,
  commodity, weight, load size, pallets, temp, tarps, loading methods, lumper and assist per stop,
  team, cargo value, dock hours, facility contacts, hazmat (UN, class, PG, name parsed back), rate,
  rate card (detention, layover, TONU, assist, extra stop, lumper policy), and for agents the load
  source and posting brokerage.
- **Not copied:** dates, schedule and appointments, reference, PU/delivery/appointment numbers,
  notes (not returned by the RPC).
- **Draft protection:** if a draft is in progress, the broker is asked before it is replaced.
- **Main pickup/delivery pins:** the RPC does not return them, so `geocodeExact()` (new, in
  `app/shared/addr-suggest.js`) re-geocodes with Photon, the same service the suggestions use. A pin
  is set only for a house-number hit with the same ZIP and state. Anything vaguer leaves no pin,
  which is exactly what happens today when a broker types the address instead of picking it. The
  filter logic was tested against mocked Photon responses. **It could not be tested live:** this
  cloud container's network policy blocks photon.komoot.io (HTTP 403).
- **Miles and drive hours:** once both pins exist, step 0 now fetches the real driving miles and
  drive hours automatically, once per pin pair. The HOS and ETA checks in the Schedule step need them.
  This also fixes restored drafts whose OSRM call had failed.
- **Optional follow-up (needs a DB write, so your call):** add `pickup_lat`, `pickup_lng`,
  `delivery_lat` and `delivery_lng` to the `jsonb_build_object` in `cc_partner_load_full`. Then the
  copy reuses the exact original pins and no re-geocoding is needed. It is a jsonb-returning
  function, so `create or replace` keeps its ACL. Still, re-check the anon SECDEF names afterwards.

## 0457c — radius search on the carrier board (audit #3, shipped client-side)

- **UI:** there is a radius select after both Origin and Destination in the board's Filters:
  `Exact text` (the default, which is the old substring match) or within 25/50/100/150/250 mi.
  The setting is saved in `lb_lb_filters` (`or`/`dr`), and Clear resets it. A hint line under the
  filters shows what is applied. Examples: "Pickup within 100 mi of Dallas, TX", "Finding
  “Ennis, TX”…", "“xyz” not found — matching the text instead", and "N loads with no known
  location hidden".
- **Distance:** straight-line (haversine), the same way DAT counts DH-O/DH-D. It is not road miles.
- **Typed place:** the offline `usGeo` city table (~145 cities) is tried first. For anything else,
  the new `geocodePlace()` in `app/shared/addr-suggest.js` asks Photon. It accepts city, town and
  ZIP hits. A state or country hit is rejected, and if the text ends in a state code, the hit must
  be in that state. Results are cached per text.
- **Load side:** the pickup uses the board pin (`pickup_lat`/`pickup_lng`, rounded to 0.1° ≈ 7 mi by
  `bl_stops_0090`). If a load has no pin, its origin city is used. The drop uses the destination city,
  because **`cc_pocket_available_loads` returns no delivery pin**. So the destination radius is
  city-level, and it costs one Photon call per unknown destination city (cached).
- **Tested:** the `geocodePlace` parsing was tested against mocked Photon responses (state filter,
  state-only reject, ZIP, cache). **Not tested live:** Photon is blocked in this container (403),
  and the board needs a signed-in carrier. Please check it once on staging: Filters → Origin
  "Dallas, TX" → Within 100 mi.
- **Optional follow-up (a DB change, so it's your call, like question #2):** add
  `delivery_lat`/`delivery_lng` (rounded the same way) to `cc_pocket_available_loads`. The
  destination radius would then use real pins and make no Photon calls. It changes RETURNS TABLE, so
  it needs a drop/create, the execute re-grant, and an anon SECDEF name check. It could go in the
  same migration as `posted_at`.
