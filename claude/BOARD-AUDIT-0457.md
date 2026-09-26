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
5. **No "Post similar" / copy from a past load.** Brokers repost the same lanes every day, and DAT
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
