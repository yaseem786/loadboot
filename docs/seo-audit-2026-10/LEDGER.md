# Phase 2 SEO ledger — one row per page session (append only)

Rules: BEFORE numbers are pulled live at the start of the session (28 d and 90 d), never copied from here.
The "Baseline (R-window)" column below is the last known GSC read from `docs/seo/WEEKLY-LOG.md` and exists
only to order the queue. Re-check = session date + 28 d. Revert line: impressions −15 % or position +5 worse.
Locked = clicks growing week over week → measure only.

## Queue (set in Session 0, 24 Sep 2026 — re-rank every 12 weeks from a fresh `query,page` pull)

| # | URL | Baseline 28 d clicks / impr / pos (window) | Earliest session | Status |
|---|---|---|---|---|
| 1 | flatbed-freight-rates.html | 0 / 1,205 / 11.1 (08-22→09-19) | 16 Oct (R9 title edit 09-18) | queued |
| 2 | market-rates.html | 16 / 4,099 / 23.2 (08-22→09-19) | now — title LOCKED | **edited 25 Sep** — BEFORE pull pending |
| 3 | hotshot-freight-rates.html | 5 / 483 / 9.2 (08-19→09-16) | now | **edited 25 Sep** — BEFORE pull pending |
| 4 | dry-van-freight-rates.html | 3 / 377 / 11.7 (08-19→09-16) | now | queued |
| 5 | box-truck-freight-rates.html | 0 / 241 / 8.0 (08-19→09-16) | now | queued |
| 6 | power-only-freight-rates.html | 0 / 215 / 7.3 (08-19→09-16) | now | queued |
| 7 | step-deck-freight-rates.html | 5 / 182 / 6.3 (08-19→09-16) | now | queued |
| 8 | reefer-freight-rates.html | 0 / 137 / 10.0 (08-19→09-16) | now | queued |
| 9 | layover-policy.html | 1 / 916 / 18.2 (08-22→09-19) | 19 Oct (R10 edit 09-21) | queued |
| 10 | tonu-policy.html | 0 / 486 / 15.0 (08-22→09-19) | 19 Oct (R10 edit 09-21) | queued |
| 11 | detention-pay-policy.html | 0 / 394 / 16.7 (08-22→09-19) | now — title figure rule | queued |
| 12 | lumper-policy.html | 0 / 374 / 30.4 (08-22→09-19) | 19 Oct (R10 edit 09-21) | queued |
| 13 | ghost-loads-load-board-problems.html | 0 / 119 / 6.3 (08-22→09-19) | now — description only | queued |
| 14 | pricing.html | pull | now | queued |
| 15 | get-started.html | pull | now | queued |
| 16 | carriers.html | pull | now | queued |
| 17 | brokers.html | pull | now | queued |
| 18 | power-only-dispatch.html | 0 / 115 / 71.3 (08-22→09-19) | now — content rewrite | queued |
| 19 | dry-van-dispatch.html | 0 / 169 / 51.7 (08-22→09-19) | now — content rewrite | queued |
| 20 | owner-operator-dispatch.html | 2 / 83 / 33.1 (08-22→09-19) | LOCKED — links only | queued |
| 21 | flatbed-dispatch.html | 0 / 102 / 35.0 (08-22→09-19) | 16 Oct (R9 edit 09-18) | queued |
| 22 | how-much-does-a-truck-dispatcher-cost.html | pull (pos 10.4, Jul) | now | queued |
| 23 | new-authority-dispatch.html · us-truck-dispatcher.html · authority-dot-setup.html (0/75/52.6) · boc3-ucr.html (0/55/33.2) | | now | queued |
| 24 | freight-broker-software-cost.html (0/94/21.5) · freight-agent-vs-freight-broker.html (0/80/12.8) | (08-22→09-19) | now — broker_growth_module.py | queued |
| 25 | spot-market-freight-rates.html · truckload-freight-rates.html | new (R9 / R10) | 16 Oct / 19 Oct — measure only | queued |
| 26 | truck-dispatcher-in-texas / georgia / california.html | pull — GUESS cluster, validate first | after 1–23 | queued |
| 27 | weekly rate reports (14 pages) | pos 5.6–7.9 (08-19→09-16) | now — one module fix (Article image) | queued |

## Sessions

| Date | URL | BEFORE — page 28 d (clicks / impr / CTR / pos) | BEFORE — top-3 queries (impr @ pos) | What changed (source file, anchor) | Re-check date | Re-check result |
|---|---|---|---|---|---|---|
| 2026-09-24 | (Session 0 — site-wide) | site 131 / 14,227 / 0.92 % / 18.4 (R10 window) | homepage 330 @ 6.2 (brand) · market-rates 4,099 @ 23.2 · flatbed-freight-rates 1,205 @ 11.1 | `build_site.py`: `referral.html` added to `_SITEMAP_EXCLUDE` (live 301 → agents.html); `create-agent-account` CTA + related links off `referral.html`; `_headers` gets `/unsub.html X-Robots-Tag: noindex, nofollow`. No title / description / content edits. | 2026-10-22 (sitemap 130 URLs indexed clean; referral gone from GSC pages) | |
| 2026-09-25 | market-rates.html | **PENDING** — `GOOGLE_SA_KEY_B64` still empty on 25 Sep. Pull with `node docs/seo-audit-2026-10/harness/gsc-pull.mjs --page /market-rates.html --days 28 --end 2026-09-24` (and `--days 90`) — GSC keeps the window, so the row stays exact. Queue proxy: 16 / 4,099 / 23.2 (08-22→09-19). | PENDING (same pull, `query,page` filtered to the page) | `build_site.py`: (1) new `_SNAP` / `_MR_DESC` — description now reads "Live truckload rates per mile, updated September 2026: dry van $2.97, reefer $3.56, flatbed $3.54, hotshot $2.35 …" from `rate_snapshots.json`, so it moves with each `refresh_rate_snapshot.py`; (2) `_MR_HUBS` — a "Rates per mile by equipment" chip row between the hero and the live table, 8 hub links with the GSC phrases as anchors ("Dry van rates per mile", "Current flatbed rates per mile", "Hotshot rates per mile", "Box truck rate per mile" …) each carrying the benchmark $; (3) the "Current rates by equipment type" paragraph's five bold phrases are now links to the hubs. Title unchanged (LOCKED). | 2026-10-23 | expect: market-rates impressions may FALL on equipment queries while the hubs rise — that is the intended hand-off, not a revert signal; revert only if site-wide equipment-query impressions drop |
| 2026-09-25 | hotshot-freight-rates.html | **PENDING** — same pull, `--page /hotshot-freight-rates.html --end 2026-09-24`. Queue proxy: 5 / 483 / 9.2 (08-19→09-16). | PENDING | `build_site.py`: `_EQ_SEO_OVERRIDE['hotshot']` — description now opens "Hotshot rates per mile, September 2026: $2.35 average to the carrier on the national benchmark …" (number, month, equipment, per mile inside the first 150 chars; rest of the old copy kept); `_EQ_FAQ_LEAD['hotshot']` — new first FAQ "What is the hotshot rate per mile in 2026?" in the visible list and the FAQPage JSON-LD (now 8 entries). Both read `rate_snapshots.json`. Title unchanged (pos 9.2). | 2026-10-23 | |
