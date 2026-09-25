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
| 4 | dry-van-freight-rates.html | 3 / 377 / 11.7 (08-19→09-16) | now | **done 2026-09-25** — re-check 10-23 |
| 5 | box-truck-freight-rates.html | 0 / 241 / 8.0 (08-19→09-16) | now | queued |
| 6 | power-only-freight-rates.html | 0 / 215 / 7.3 (08-19→09-16) | now | queued |
| 7 | step-deck-freight-rates.html | 5 / 182 / 6.3 (08-19→09-16) | now | queued |
| 8 | reefer-freight-rates.html | 0 / 137 / 10.0 (08-19→09-16) | now | queued |
| 9 | layover-policy.html | 1 / 916 / 18.2 (08-22→09-19) | 19 Oct (R10 edit 09-21) | queued |
| 10 | tonu-policy.html | 0 / 486 / 15.0 (08-22→09-19) | 19 Oct (R10 edit 09-21) | queued |
| 11 | detention-pay-policy.html | 0 / 394 / 16.7 (08-22→09-19) | now — title figure rule | **done 2026-09-25** — re-check 10-23 |
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
| 2026-09-25 | dry-van-freight-rates.html (#4) | 28 d (08-26→09-23): **5 / 493 / 1.01 % / 11.2** · 7 d (09-16→09-23): 2 / 116 / 1.72 % / 9.5 · 90 d = same as 28 d (page live since 08-30) | own page (all 0-click; the 5 clicks are anonymised): dry van freight brokers 8 @ 38.8 · dry van rates per mile 6 @ 48.7 · dry van rates 5 @ 52.8. The same phrases still resolve to market-rates.html: dry van rates per mile 19 @ 31.5 · current dry van rates 15 @ 21.5 · dry van load rates 8 @ 34.9 | `build_site.py` `_EQ_SEO_OVERRIDE['dry-van']` — **description only**; title LOCKED (clicks 3→5, 2 in the last 7 d). New desc leads with number + date per the Session 0 rule: "Dry van rates per mile, September 2026: $3.03/mi average to the carrier, $3.48 shipper side, $2.42–$3.64 typical range — current national dry van freight rates…" (figures = `get_public_market_rates()` as_of 2026-09-18). Plus **6 new inbound links** to the hub on the cannibalised phrases: market-rates.html ×2 (hero lead "dry van"; section `<b>Dry van rates per mile</b>` — market-rates had ZERO links to any equipment hub), index.html rates-strip "dry van", spot-market-freight-rates.html ×2 (table cell "Dry van"; "national dry van average"), fuel-surcharge-trucking.html "$3.03/mi dry van". | 2026-10-23 | |
| 2026-09-25 | detention-pay-policy.html (#11) | 28 d (08-26→09-23): **0 / 417 / 0 % / 15.3** · 7 d: 0 / 84 / 0 % / 14.0 · 90 d (06-25→09-23): 0 / 602 / 0 % / 28.7 | how much is detention pay 18 @ 36.7 · how much is detention pay for truckers 18 @ 40.3 · amazon relay detention pay tracker 11 @ 42.8 · then detention pay trucking 7, trucking detention pay 7, detention pay 6; the what-is / meaning cluster = 9 impr | `build_site.py` `_ACC_SEO['detention-pay-policy']` title + desc. Title: dropped `$50–$100/Hour` (standing no-market-figure-in-title rule, R6/R7/R9), kept every other token, added "How Much Is Detention Pay Per Hour" (the two top queries verbatim) and "What It Means" (meaning cluster). Was `Detention Pay for Truckers 2026: How Much Is It — $50–$100/Hour, Detention Charges in Trucking & How to Claim` → now `Detention Pay for Truckers 2026: How Much Is Detention Pay Per Hour, What It Means, Detention Charges in Trucking & How to Claim`. Desc: market figure removed too; keeps LoadBoot's own $60/hr after 2 free hours (own price, allowed like "Flat 5%"). | 2026-10-23 | |

Noted 2026-09-25, not fixed: (a) `market-rates.html` linked to **no** equipment hub at all before this session — reefer / flatbed / hotshot / power-only get their link in their own sessions (flatbed's window opens 16 Oct), not now, so each page's 28 d read stays clean. (b) `spot-market-freight-rates`, `truckload-freight-rates` and the market-reports index hard-code dry van **$2.97** as the "September 2026 snapshot" while `get_public_market_rates()` already reads **$3.03** (as_of 09-18) — the static snapshot drifted inside the same month; a build-time read of the live figure would fix all of them at once (design change, not a ledger edit). (c) "amazon relay detention pay tracker" 11 impr @ 42.8 is an uncovered intent on the detention page — candidate FAQ, not this session. (d) The hub's top named query is "dry van freight brokers" (8 impr, broker-side intent) — watch whether the desc's "what brokers buy and sell at" earns it.
