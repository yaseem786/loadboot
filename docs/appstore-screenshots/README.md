# App Store screenshots — iPhone (captured 18 Sep 2026)

Real captures of the carrier portal at the current deploy (disk == main == loadboot.com), rendered at
iPhone 16 Pro Max logical size (440×902 + 54pt status bar, @3x) against the STAGING demo carrier
(carrier-owner@lb.test). Composed Apple-style: headline + subhead on brand navy, titanium iPhone frame.

Sets (upload the 6.9" set; App Store Connect scales it for smaller iPhones — 6.7"/6.5" are here if you want exact per-size uploads):

- `6.9/` 1320×2868 (required)   - `6.7/` 1290×2796   - `6.5/` 1242×2688
- PNG, RGB, no alpha, all < 2 MB. Order 01→08 is the recommended listing order.

| # | Screen | Headline |
|---|--------|----------|
| 01 | Dashboard | Your trucking business, in one screen |
| 02 | Load Board | Loads matched to your truck |
| 03 | Live trip map | Every mile tracked, automatically |
| 04 | My Loads | From booked to paid |
| 05 | Finance | Know your real profit |
| 06 | Market Rates | Never haul below your cost |
| 07 | Fleet | Your whole fleet, optimized |
| 08 | My Profile | Verified. Trusted by brokers. |

`raw/` = the untouched captures. `tools/` = capture (Playwright) + compose (Pillow) scripts.
Staging data was time-shifted so the demo trips fall in the last 30 days (no invented records).
Map tiles: cartocdn is blocked from the capture sandbox, so identical-zoom Esri tiles were substituted
(the "© OSM · CARTO" label in shot 03 is the app's own attribution text).
