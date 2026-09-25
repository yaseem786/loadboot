# Phase 2 SEO ledger — one row per page session (append only)

Rules: BEFORE numbers are pulled live at the start of the session (28 d and 90 d), never copied from here.
Pull = `docs/seo-audit-2026-10/harness/seo-pull.sh <days> [page|query,page]` with `SEO_PULL_TOKEN` in the environment (prod `seo-pull` edge fn, read-only; 1,000-row cap — the 28 d `query,page` pull was 849 rows on 25 Sep, so still complete).
The "Baseline (R-window)" column below is the last known GSC read from `docs/seo/WEEKLY-LOG.md` and exists
only to order the queue. Re-check = session date + 28 d. Revert line: impressions −15 % or position +5 worse.
Locked = clicks growing week over week → measure only.

## Queue (set in Session 0, 24 Sep 2026 — re-rank every 12 weeks from a fresh `query,page` pull)

| # | URL | Baseline 28 d clicks / impr / pos (window) | Earliest session | Status |
|---|---|---|---|---|
| 1 | flatbed-freight-rates.html | 0 / 1,205 / 11.1 (08-22→09-19) | 16 Oct (R9 title edit 09-18) | queued |
| 2 | market-rates.html | 16 / 4,099 / 23.2 (08-22→09-19) | now — title LOCKED | queued |
| 3 | hotshot-freight-rates.html | 5 / 483 / 9.2 (08-19→09-16) | now | queued |
| 4 | dry-van-freight-rates.html | 3 / 377 / 11.7 (08-19→09-16) | now | queued |
| 5 | box-truck-freight-rates.html | 0 / 241 / 8.0 (08-19→09-16) | now | **done 2026-09-25** — re-check 10-23 |
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
| 2026-09-25 | box-truck-freight-rates.html (#5) | 28 d (08-26→09-23): **1 / 298 / 0.34 % / 7.7** · 7 d (09-16→09-23): 1 / 57 / 1.75 % / 6.7 · 90 d = same as 28 d (page live since 08-30). vs baseline 0 / 241 / 8.0: impressions +24 %, the one click sits in the last 7 d ⇒ not locked | own page, all 0-click, named queries = 13 of 298 impressions (the 7.7 is anonymised): average box truck rate per mile 5 @ 29.6 · box truck mileage rate 3 @ 36.3 · box truck freight rates 1 @ 39.0 (rate/rates per mile 1 each @ 42–43). Cannibalised by market-rates.html, which had ZERO box-truck text: box truck rates per mile 4 @ 29.5 · box truck freight rates 4 @ 37.2 · 26ft box truck rate per mile 1 @ 29.0 · box truck rates per mile 2026 1 @ 7.0; cost-per-mile-calculator takes box truck rate per mile calculator 2 @ 74.5 | `build_site.py` `_EQ_SEO_OVERRIDE['box-truck']` — **description only, 154 chars** (KEYWORD-PLAN §2 rule: ≤155, number + date + equipment + "per mile" in the first 100); title untouched (pos 7.7 already page 1). New desc: "Box truck rates per mile, September 2026: $2.58/mi to the carrier, $2.97 shipper side, $2.06–$3.10 range. Live national box truck freight rates, 16–26 ft." (figures = `get_public_market_rates()` as_of 2026-09-18; was the 224-char shared frame). Plus **3 new inbound links** on the cannibalised phrase "box truck rates per mile": market-rates.html equipment paragraph (first box-truck mention on that page), box-truck-dispatch.html Rates card, full-truckload-vs-ltl.html partials card. Pull rows: `data/session-box-truck-2026-09-25.csv`. | 2026-10-23 | |
