# LoadBoot Weekly SEO Log

Playbook: pull GSC (28d) via seo-pull edge function → find striking-distance queries
(impressions ≥15, clicks 0–2, pos 4–40) → title/meta surgery on the ranking page in
build_site.py (max 3/week, URLs never change) → build → commit → owner pushes.

| Date | Clicks (28d) | Impressions | CTR | Avg pos | Actions |
|------|-------------|-------------|-----|---------|---------|
| 2026-07-26 | 51 | 1,777 | 2.9% | 34.4 | Baseline. R1: market-rates + dispatcher-cost titles (04f1bac). R2: vs-broker + dispatcher-cost rich_article titles, per-diem 2018–2026 by-year table (76f7e10). seo-pull edge function deployed for direct API access. |
| 2026-07-27 | 53 | 2,046 | 2.6% | 34.8 | R3 (first scheduled auto-run). Regression check: last run's edits only 1 day old — no signal, no reverts (7d: dispatcher-cost pos 10.4, market-rates.html 243 impr surge). Zero strict striking-distance candidates (impr≥15 + pos 4–40); 1 boundary surgery: **layover-policy** title/meta (cluster: "layover pay for truckers" 19 impr/46.9, "how much is layover pay for truck drivers" 17/41.1, "…owner operators" 14/11.5; page 7d: 0 clicks/69 impr/pos 32.4 ← pre-edit baseline). Kept "Layover Pay in Trucking 2026/Rates/How to Claim", added "How Much/Truck Drivers/Owner Operators/$150–$350/Day". tonu-policy SKIPPED (1 click this week = WoW growth → locked; pre-edit baseline: 7d 1 click/66 impr/pos 25.1). New article: **oversize-load-rates-per-mile.html** (query "how much do oversize loads pay per mile" 13 impr/pos 41, only tools.html weakly ranking; 2,334 words, 8 TOC, 6 FAQ, 2 CTAs; reverse links from tools.html + flatbed-dispatch.html RELATED). Index health (120d): 67/85 sitemap pages with impressions; 18 zero-impr = mostly 07-18 flagship pages (young, normal lag) + new article. |
