# Phase 2 SEO — Session 0 baseline (24 Sep 2026)

Scope: the marketing site, `site/sitemap.xml` (131 URLs at the start of the session, 130 after the
referral.html fix below). Source of truth is `build_site.py` + the `*_module.py` files; `site/` is never
edited by hand. Companion files: `KEYWORD-PLAN.md` (what to rank for and how), `LEDGER.md` (the per-page
order, BEFORE numbers, re-check dates), `data/` (crawl output), `harness/seo-crawl.py` (re-runnable).

## 0. What this baseline is built from — and what it is not

| Source | Status this session | Used for |
|---|---|---|
| Crawl of all sitemap URLs, source HTML + live `loadboot.com` | **Done** (`harness/seo-crawl.py --live`) | Section 3 |
| Rendered pass, Playwright 390 px, every sitemap URL | **Done** (`data/rendered-390.txt`) | console errors, rendered H1/title |
| Google Search Console, live | **Blocked from this container** (`*.googleapis.com` CONNECT 403, no `GOOGLE_SA_KEY`). The `gsc-insights` edge function needs a staff JWT — not usable from a session. | — |
| GSC numbers from the weekly SEO rounds R1–R10 (`docs/seo/WEEKLY-LOG.md`), latest window **2026-08-22 → 09-19** | **Used** — these are real GSC pulls, 3–5 days old | Sections 1, 4 |
| GA4, live | **Blocked** (same network rule) | — |
| First-party analytics, prod `app_private.web_sessions` (90 d to 24 Sep, bots + internal excluded) | **Used** — read-only SQL via the Supabase MCP | Section 1 |

Yaseen's standing rule (5 Sep): every SEO decision starts from live GSC query/page data, never guessed
keywords. Session 0 respects that: nothing below is a guessed keyword unless it is explicitly marked
**GUESS** in `KEYWORD-PLAN.md`. The page sessions still need a live pull each time — see Section 5 for the
three ways to get one.

## 1. The question: is it only "loadboot" brand searches that click?

**Short answer: about half the clicks, but almost none of the impressions.** Google shows LoadBoot for
thousands of non-brand queries every month; those results are on page 2 and their snippets do not get
clicked. That is the whole problem to solve.

GSC, 28 days to 2026-09-19 (R10):

| | Clicks | Impressions | CTR | Avg pos |
|---|---|---|---|---|
| Whole site | 131 | 14,227 | 0.92 % | 18.4 |
| Homepage `/` (brand: "loadboot", "load boot") | 55 | 330 | 16.7 % | 6.2 |
| `login.html` ("carrier desk login") | 3 | ~21 | — | 6.2 |
| **Brand-navigational share** | **≈ 58 (44 %)** | **≈ 350 (2.5 %)** | | |
| **Everything else (non-brand)** | **≈ 73 (56 %)** | **≈ 13,900 (97.5 %)** | **≈ 0.5 %** | mostly 11–40 |
| of which `market-rates.html` | 16 | 4,099 | 0.4 % | 23.2 |

First-party sessions, prod, last 90 days (search-engine referrers only):

| Engine | Sessions | Landing on `/` (brand proxy) | Landing on `market-rates` | All other pages |
|---|---|---|---|---|
| Google | 344 | 111 | 107 | 126 |
| Bing | 355 | 19 | 231 | 105 |
| DuckDuckGo | 148 | 1 | 120 | 27 |
| Yahoo | 60 | 3 | 50 | 7 |

Reading the two tables together:

1. **Brand is 44 % of Google clicks and it converts** (5 of the 6 organic-Google conversions in 90 d came
   from a homepage landing). Non-brand Google traffic outside `market-rates` is roughly **1.4 sessions a
   day**. Yaseen's instinct is right in spirit: the site is not yet earning keyword traffic at any scale.
2. **But visibility exists.** 13,900 non-brand impressions in 28 days, growing every round (4,073 → 12,121 →
   14,227 since 3 Sep). The equipment rate hubs already sit at **position 6–12** (step-deck 6.3, power-only
   7.3, box-truck 8.0, hotshot 9.2, reefer 10.0, flatbed 11.1, dry-van 11.7) with a combined ~2,800
   impressions and **13 clicks**. The definition pages (tonu 15.0, detention 16.7, layover 18.2, fcfs 9.3)
   add ~2,000 impressions and 2 clicks.
3. **Bing ranks the site better than Google does.** Bing + DuckDuckGo + Yahoo send 563 sessions vs Google's
   344, and 401 of those land on `market-rates`. That is normal for a three-month-old domain — Bing weights
   on-page relevance more, Google weights links and history — and it is the clearest evidence that the gap
   to close is **authority + snippet CTR**, not indexing or content existence.
4. **The money pages (dispatch services) are the weakest.** power-only-dispatch pos 71, dry-van-dispatch
   52, authority-dot-setup 53, flatbed-dispatch 35, owner-operator-dispatch 33. Four rounds of title work
   moved them little; R10's diagnosis stands: **content and authority, not titles**.

So the diagnosis, in order of weight:

| # | Why non-brand does not click | Evidence | Fix lane |
|---|---|---|---|
| 1 | Positions 11–40 = page 2. Page 2 gets ~1 % of clicks at best. | Site avg pos 18.4; 0-click pages at 15–30 | Content depth + internal links + backlinks (Plan §3–4) |
| 2 | **Snippets are truncated.** 66 titles > 60 chars (up to 137), 70 descriptions > 160 chars (up to 389). Google cuts at ~600 px / ~155 chars and often rewrites long titles, so the searcher never sees the promise. | Crawl §3; flatbed-freight-rates 1,205 impr @ 11.1 with **0 clicks** | Snippet layer (Plan §2) — a **controlled test**, because the keyword-preservation rule of R4–R10 is what earned the impressions |
| 3 | `market-rates.html` absorbs 29 % of all impressions across dozens of query shapes it cannot rank #1 for. | R8 47 % → R10 29 % — de-cannibalisation via hubs is working | Keep splitting clusters into dedicated pages (spot-market, truckload done; see Plan §3) |
| 4 | Domain is 3 months old with near-zero external links (external targets on the site itself: Play Store and LinkedIn only). | `docs/seo/BACKLINKS-*` exist, execution unknown | Off-page (Plan §4) |
| 5 | Dispatch money pages are short service pages competing with 2,000-word dispatch-company sites. | pos 33–78, four rounds flat | Rewrite (Plan §3, weeks 3–8) |

## 2. What changed this session (site-wide hygiene only — no page work)

- `referral.html` was in the sitemap while Netlify 301s it to `agents.html` (live chain `/referral → /referral.html → /agents.html`). Added to `_SITEMAP_EXCLUDE`; sitemap is now 130 URLs.
- `create-agent-account.html` linked to `referral.html` twice (CTA + related) → both now point at live pages. Internal links through a redirect: 2 → 0.
- `unsub.html` (sitemap-excluded, but Bing indexed it — 32 organic landings in 90 d) now gets `X-Robots-Tag: noindex, nofollow` in `_headers`, the same mechanism `/app/*` uses. Closes OS5 / S10.
- Built, `ast.parse` clean, BUILD OK, re-crawled: orphans 7 → 6 (referral gone), redirected links 0.

Nothing else was edited. Titles, descriptions, JSON-LD and content are left exactly as R10 left them so the
R9/R10 measurements are not destroyed.

## 3. Crawl findings (source HTML at HEAD, live-checked 24 Sep)

Full machine output is appended below (§7) and in `data/crawl-report.md`, `data/crawl.csv`, `data/crawl.json`.
Human reading:

**Clean:** 131/131 live 200; 0 duplicate titles / descriptions / H1s; every page exactly one H1; canonical,
OG (title/description/image/url) and `twitter:card` on every page; JSON-LD on every page (ProfessionalService
131, BreadcrumbList 130, FAQPage 114, Article 40, HowTo 12, Service 11); every content image has `alt`;
0 broken internal links; extensionless `/x` → `/x.html` 301s work on every URL; no `noindex` anywhere; live
titles match the build on 130/131 (prod is at this commit).

**Findings, in priority order:**

| # | Finding | Count | Action |
|---|---|---|---|
| S1 | Titles over 60 chars | 66 (top: 137, 137, 128, 125, 120) | Plan §2 snippet test — do not mass-shorten |
| S2 | Descriptions over 160 chars | 70 (top: 389, 373, 350, 345, 331) | Same — the first 155 chars must carry the click |
| S3 | `Article` JSON-LD without `image` | 14 market-report pages + how-to-get-loads (also no `datePublished`) | Fix in `market_reports_module.py` / the article's block — Article rich results require `image` |
| S4 | `spot-market-freight-rates` Article `headline` > 110 chars | 1 | Trim the headline field only (not the title) |
| S5 | Images > 200 KB in content | 11 pages (`partner-offers.webp` 341 KB, `board-card-details.webp` 337 KB, `track-phone-pickup.webp` 231 KB, …) | Re-encode at display width; LCP on load-board / carriers / create-broker-account |
| S6 | Weakly linked pages (≤ 2 in-content inbound) | 14 — incl. all three state dispatcher pages (TX/GA/CA: 1–2 links each, all from blog.html), otr/regional/local dispatch (only each other), full-truckload-vs-ltl, should-i-buy-a-truck-before-2027 | Internal-link pass in the page sessions of their hub pages |
| S7 | Orphans (no in-content inbound) | 6: accessibility, case-studies, login, sitemap, sms, status | Fine for legal/utility pages; **case-studies** should be linked from carriers/brokers/pricing |
| S8 | Thin pages (< 300 words) | status 215, accessibility 269 (referral gone) | Expected |
| S9 | `sitemap.xml` carries `<changefreq>` only | all | Google ignores changefreq; `<lastmod>` is the field it reads. Only worth adding if it is a real per-page date (build has none) — **do not fake it with the build date** |
| S10 | `unsub.html` is excluded from the sitemap but not `noindex`; Bing sends it 32 organic landings in 90 d, `privacy.html` 15 | 2 | Add `<meta name="robots" content="noindex">` to unsub.html; privacy is fine |
| S11 | Blog thumbnail without width/height | 1 (`blog.html`) | CLS nit |
| S12 | Rendered pass: every page logs 3 console errors — clarity.ms and googletagmanager blocked by the container proxy, trustpilot widget 405 over http from localhost | harness artefacts, not site bugs | none |

**False positives to ignore:** 358 "broken #fragment" hits are all `contact.html#quote` / `#create`. The
contact page maps those hashes in JS (`#quote` → iQuote, `#create` → iAcct); the ids are not in the HTML, so
the crawler cannot see them. Not an SEO issue.

**Not in the crawl, worth knowing:** `source_class = 'ai'` with **no referrer** is 1,376 sessions in 90 days
in `web_sessions` (Chrome/Windows landing on `/` and `create-broker-account`). Either the classifier tags
something as AI that is not, or outreach links carry a tag — not SEO, but it inflates the "ai" channel in CC.
Logged as OS1 below.

## 4. Priority order for the page sessions

Rule from the plan: highest impressions × worst position first (pos 11–40 is page-2 money), then the money
pages, then the weekly reports. Numbers are the R9/R10 GSC windows (see LEDGER.md for which); every session
re-pulls before touching anything. "Earliest" respects the 28-day measurement window of an edit already made.

| Order | Page | 28 d clicks / impr / pos | Why here | Earliest |
|---|---|---|---|---|
| 1 | `flatbed-freight-rates.html` | 0 / 1,205 / 11.1 | Largest zero-CTR asset on the site. Title edited 09-18 (R9); if still 0 clicks the 264-char description is the lever | 16 Oct |
| 2 | `market-rates.html` | 16 / 4,099 / 23.2 | 29 % of impressions. Title **locked** (do not retitle); work = description, above-the-fold intent match, links out to the hubs so the right page ranks | now |
| 3 | `hotshot-freight-rates.html` | 5 / 483 / 9.2 | Page 1, 1 % CTR — snippet | now |
| 4 | `dry-van-freight-rates.html` | 3 / 377 / 11.7 | Page 1/2 edge | now |
| 5 | `box-truck-freight-rates.html` | 0 / 241 / 8.0 | Page 1, zero clicks | now |
| 6 | `power-only-freight-rates.html` | 0 / 215 / 7.3 | Page 1, zero clicks | now |
| 7 | `step-deck-freight-rates.html` | 5 / 182 / 6.3 | Best position on the site | now |
| 8 | `reefer-freight-rates.html` | 0 / 137 / 10.0 | | now |
| 9 | `layover-policy.html` | 1 / 916 / 18.2 | Edited 09-21 (R10) — measure, then description | 19 Oct |
| 10 | `tonu-policy.html` | 0 / 486 / 15.0 | Edited 09-21 — measure | 19 Oct |
| 11 | `detention-pay-policy.html` | 0 / 394 / 16.7 | Title still carries `$50–$100/Hour` — the standing no-market-figure rule; fix + description | now |
| 12 | `lumper-policy.html` | 0 / 374 / 30.4 | Edited 09-21 — measure | 19 Oct |
| 13 | `ghost-loads-load-board-problems.html` | 0 / 119 / 6.3 | Pos 6 with no clicks for five rounds; GSC shows one query — description work only, no blind retitle | now |
| 14 | `pricing.html` | pull | Money page; brand queries land on `/`, so this needs its own non-brand cluster ("truck dispatch service cost", "dispatcher percentage") | now |
| 15 | `get-started.html` | pull | Money | now |
| 16 | `carriers.html` | pull | Money | now |
| 17 | `brokers.html` | pull (title 77 / desc 289) | Money; demand-side doc's head term is on `free-load-board-for-brokers` | now |
| 18 | `power-only-dispatch.html` | 0 / 115 / 71.3 | **Content rewrite**, not title — four rounds flat | now |
| 19 | `dry-van-dispatch.html` | 0 / 169 / 51.7 | Same | now |
| 20 | `owner-operator-dispatch.html` | 2 / 83 / 33.1 | Locked (growing) — measure, internal links only | now |
| 21 | `flatbed-dispatch.html` | 0 / 102 / 35.0 | Edited 09-18 — measure | 16 Oct |
| 22 | `how-much-does-a-truck-dispatcher-cost.html` | pull (pos 10.4 in July) | Highest-intent dispatch query on the site | now |
| 23 | `new-authority-dispatch.html`, `us-truck-dispatcher.html`, `authority-dot-setup.html` (0/75/52.6), `boc3-ucr.html` (0/55/33.2) | | Dispatch cluster | now |
| 24 | `freight-broker-software-cost.html` (0/94/21.5), `freight-agent-vs-freight-broker.html` (0/80/12.8) | | Live in `broker_growth_module.py` — in scope for Phase 2 (the weekly rounds skip them) | now |
| 25 | `spot-market-freight-rates.html` (R9), `truckload-freight-rates.html` (R10) | new | Measure only until 28 d has passed | 16 / 19 Oct |
| 26 | `truck-dispatcher-in-texas/georgia/california.html` | pull | 1–2 inbound links each; **GUESS** cluster "truck dispatcher in <state>" — validate in GSC first | after 1–23 |
| 27 | Weekly rate reports (`*-rates-week-*`, `freight-market-report-week-*`) | pos 5.6–7.9 | Fix S3 (Article image) once in the module — covers all 14 | now, one change |

## 5. Access — the three ways to get live GSC into a session (pick one)

1. **`SEO_PULL_TOKEN` as an environment secret** (cheapest). The weekly rounds already pull GSC through the
   `seo-pull` edge function using `net.http_post` from SQL and poll `net._http_response` — that runs inside
   Postgres, so the container's network rule does not matter. The v4 token lives only in project memory
   (`seo_measurement.md`); it is not in the repo. Put it in the environment as `SEO_PULL_TOKEN` and a session
   can pull `query` / `page` / `query,page` at `rowLimit 5000` through the Supabase MCP. (Also fix the weekly
   task prompt — R9 and R10 both note it still carries the dead v3 token.)
2. **`*.googleapis.com` network rule + `GOOGLE_SA_KEY` / `GA4_PROPERTY_ID` / `GSC_SITE_URL`** as environment
   secrets — gives GA4 as well. Steps are in `docs/ux-audit-2026-09/HANDOFF.md` → PHASE 2 → Access.
3. **CSV export from Command Center → Google data** (the screen already has Export CSV per table for the GSC
   queries/pages and GA4 landing pages) into `docs/seo-audit-2026-10/data/` before each session. Works today,
   costs Yaseen two minutes per session, and the GSC table there is capped at 50 queries / 20 pages.

Whichever it is, the per-page session recipe stays: BEFORE row in `LEDGER.md` → fix in source → build →
verify built + live → re-check date +28 d.

## 6. Open items found this session (OS-series, not fixed)

- **OS1** — `web_sessions.source_class='ai'` with null referrer = 1,376 sessions / 90 d; classifier or tagging bug; CC "AI" channel is inflated.
- **OS2** — `app_private.seo_keywords` is empty; the CC SEO control screen (`cc_seo_overview`, `seo_enabled` flag off) has never been fed. Either feed it from the ledger or leave it off — decide, don't let it drift.
- **OS3** — S3/S4 JSON-LD Article fields (14 reports + 2 articles). S3 closed (#27, `ea48297`). **S4 fixed 2026-09-25** — `rich_article(headline=)`, spot-market headline 113 → 77 chars, H1 unchanged.
- **OS4** — S5 image weights (11 pages). **Fixed 2026-09-25** — 9 files re-encoded in place (same names, aspect kept, ≤ 2× display width); crawl: 0 pages with an image > 200 KB.
- **S7** — `case-studies.html` orphan: **fixed 2026-09-25**, linked from the Related grid on `services.html`. Not from carriers/pricing (owner: measure only, no edit).
- **OS5** — S10 `unsub.html` noindex — **fixed this session** (`_headers`).
- **OS6** — Bing Webmaster Tools: Bing is the larger organic source right now and IndexNow is wired in the build (`api.indexnow.org` key file present); confirm the property is verified and the sitemap submitted there too — five-minute check for Yaseen.

## 7. Machine output (pre-fix crawl, 131 URLs, live-checked)

## Crawl summary (source HTML of the build at HEAD, live-checked)

| Metric | Value |
|---|---|
| Sitemap URLs | 131 |
| Built .html files | 137 (6 not in sitemap: 404.html, agent-confirm.html, broker-claim.html, claim-confirm.html, dashboard.html, unsub.html) |
| Sitemap URLs not built | 0  |
| Live 200 / other | 131 / 0 |
| Live URLs that redirect | 1 |
| Live title ≠ built title | 1 |
| Extensionless URL not 301→.html | 1 |
| Pages with no issues flagged | 0 |
| Title > 60 chars | 66 |
| Description > 160 / < 70 / missing | 70 / 0 / 0 |
| Duplicate titles (groups) | 0 |
| Duplicate descriptions (groups) | 0 |
| Duplicate H1s (groups) | 0 |
| H1 count ≠ 1 | 0 |
| Canonical missing / ≠ self | 0 / 0 |
| OG incomplete | 0 |
| No twitter:card | 0 |
| No JSON-LD / JSON-LD problems | 0 / 16 |
| Images without alt (pages / images) | 0 / 0 |
| Images without width/height (pages) | 1 |
| Pages with an image > 200 KB | 11 |
| Thin pages (< 300 content words) | 3 |
| Orphans (no in-content inbound link, chrome + sitemap.html excluded) | 7 |
| Broken internal links (instances) | 0 |
| Broken #fragment links (instances) | 358 |
| Internal links that hit a redirect (instances) | 2 |
| Noindex pages | 0 |
| HTML weight median / max | 80 KB / 142 KB |

### Live status (anything not a clean 200)

- `referral.html` — 301 /referral.html → 200 /agents.html

### Live ≠ built (prod is behind or ahead of this commit)

- `referral.html` — live title: "Referral Partner Program — Earn 1% Per Load | LoadBoot" · built: "Referral Program Update — Now the LoadBoot Agent Program"
- `referral.html` — live canonical https://loadboot.com/agents.html · built https://loadboot.com/referral.html

### Extensionless variant not consolidating

- `/referral` — 301 → 301 → 200 https://loadboot.com/agents.html

### Duplicate titles

- none

### Duplicate meta descriptions

- none

### Duplicate H1s

- none

### H1 count ≠ 1

- none

### Titles over 60 characters (Google truncates ~600 px ≈ 60 chars)

- `flatbed-freight-rates.html` — 137: "Flatbed Freight Rates Per Mile 2026 — Current & Average Flatbed Trucking Rates, Cost Per Mile for Carriers, Brokers & Shippers | LoadBoot"
- `tonu-policy.html` — 137: "TONU Meaning in Trucking 2026 — What Does TONU Mean? TONU Definition, Fee & How Much the $250 Truck Ordered Not Used Charge Is | LoadBoot"
- `layover-policy.html` — 128: "Layover Pay for Truckers 2026 — What Is Layover Pay in Trucking, How Much Truck Drivers & Owner Operators Get Per Day | LoadBoot"
- `truckload-freight-rates.html` — 125: "Truckload Freight Rates 2026 — Full Truckload (FTL) Rates Per Mile, Truckload Spot Rates & What a Full Truck Costs | LoadBoot"
- `detention-pay-policy.html` — 120: "Detention Pay for Truckers 2026: How Much Is It — $50–$100/Hour, Detention Charges in Trucking & How to Claim | LoadBoot"
- `lumper-policy.html` — 119: "What Is a Lumper Fee in Trucking? Lumper Meaning, Lumper Fee Definition, Fees, Receipts & Reimbursement 2026 | LoadBoot"
- `flatbed-dispatch.html` — 115: "Flatbed Dispatch Services 2026 — Flatbed Truck & Step-Deck Dispatch Service for Owner-Operators, Flat 5% | LoadBoot"
- `fcfs-policy.html` — 101: "FCFS Meaning in Trucking 2026: First Come First Served, and 2-Hour Detention Still Applies | LoadBoot"
- `freight-agent-vs-freight-broker.html` — 101: "Freight Agent vs Freight Broker: Authority, Pay, Risk and Working Under Several Brokerages | LoadBoot"
- `power-only-dispatch.html` — 100: "Power Only Dispatch Services 2026 — Power Only Dispatcher, Drop-and-Hook Freight, Flat 5% | LoadBoot"
- `spot-market-freight-rates.html` — 95: "Spot Market Freight Rates 2026: Trucking Spot Rates vs Contract & Where to Find Them | LoadBoot"
- `how-to-become-a-freight-broker.html` — 93: "How to Become a Freight Broker in 2026: Authority, Bond, Setup and Your First Load | LoadBoot"
- `otr-dispatch.html` — 93: "OTR Dispatch Services 2026 — Over-the-Road Dispatcher for Owner-Operators, Flat 5% | LoadBoot"
- `new-authority-dispatch.html` — 86: "New Authority Truck Dispatch — Loads From Day One, No Minimum Authority Age | LoadBoot"
- `dry-van-dispatch.html` — 85: "Dry Van Dispatch Services 2026 — Dry Van Dispatcher, Flat 5%, No Contracts | LoadBoot"
- `freight-broker-software-cost.html` — 85: "Freight Broker Software Cost in 2026: The Four-Tool Stack, Priced Honestly | LoadBoot"
- `how-new-freight-brokers-find-carriers.html` — 85: "How New Freight Brokers Find Carriers (and Vet Them Before the First Load) | LoadBoot"
- `emergency-rescheduling-policy.html` — 81: "Truck Breakdown & Emergency Load Rescheduling 2026: No-Penalty Process | LoadBoot"
- `cost-per-mile-calculator.html` — 79: "Trucking Cost Per Mile Calculator (2026) — Free CPM & Rates Per Mile | LoadBoot"
- `owner-operator-dispatch.html` — 79: "Owner-Operator Dispatch Services 2026 — Keep Your Authority, Flat 5% | LoadBoot"
- `regional-truck-dispatch.html` — 79: "Regional Truck Dispatch 2026 — Home Weekly, Lanes Inside Your Radius | LoadBoot"
- `create-agent-account.html` — 78: "Create a Referral Partner Account — Earn 1% on Every Delivered Load | LoadBoot"
- `brokers.html` — 77: "Freight Broker Load Board — Verified Carriers, Proof on Every Load | LoadBoot"
- `create-broker-account.html` — 77: "Create a Broker Account — Post Loads to a Verified Carrier Network | LoadBoot"
- `driver-assist-policy.html` — 77: "Driver Assist & Unloading Pay 2026: When the Driver Works the Dock | LoadBoot"
- `free-load-board-for-brokers.html` — 77: "Free Load Board for Brokers — Post Loads Free to Verified Carriers | LoadBoot"
- `local-truck-dispatch.html` — 77: "Local Truck Dispatch 2026 — 150 Air-Mile Freight, Home Every Night | LoadBoot"
- `power-only-freight-rates.html` — 77: "Power Only Freight Rates Per Mile 2026 — Carrier, Broker & Shipper | LoadBoot"
- `shipper-solutions.html` — 77: "Ship Freight With Verified Carriers — Truckload Quotes & GPS Proof | LoadBoot"
- `sms.html` — 77: "Text Messages from LoadBoot — SMS Opt-In, Keywords and Disclosures | LoadBoot"
- `agriculture-and-produce-freight-shipping.html` — 76: "Agriculture & Produce Freight Shipping — Equipment, Rules & Rates | LoadBoot"
- `box-truck-freight-rates.html` — 76: "Box Truck Freight Rates Per Mile 2026 — Carrier, Broker & Shipper | LoadBoot"
- `conestoga-freight-rates.html` — 76: "Conestoga Freight Rates Per Mile 2026 — Carrier, Broker & Shipper | LoadBoot"
- `step-deck-freight-rates.html` — 76: "Step Deck Freight Rates Per Mile 2026 — Carrier, Broker & Shipper | LoadBoot"
- `where-freight-brokers-get-loads.html` — 76: "Where Freight Brokers Get Loads: How New Brokerages Find Shippers | LoadBoot"
- `delete-account.html` — 75: "Delete Your LoadBoot Account — What Is Erased and What Must Stay | LoadBoot"
- `dry-van-freight-rates.html` — 74: "Dry Van Freight Rates Per Mile 2026 — Carrier, Broker & Shipper | LoadBoot"
- `hotshot-freight-rates.html` — 74: "Hotshot Freight Rates Per Mile 2026 — Carrier, Broker & Shipper | LoadBoot"
- `retail-and-ecommerce-freight-shipping.html` — 74: "Retail & E-commerce Freight Shipping — Equipment, Rules & Rates | LoadBoot"
- `building-materials-freight-shipping.html` — 73: "Building Materials Freight Shipping — Equipment, Rules & Rates | LoadBoot"
- … 26 more (see data/crawl.csv)

### Descriptions over 160 or under 70 characters

- `tonu-policy.html` — 389
- `layover-policy.html` — 373
- `truckload-freight-rates.html` — 350
- `fcfs-policy.html` — 345
- `lumper-policy.html` — 331
- `spot-market-freight-rates.html` — 296
- `brokers.html` — 289
- `flatbed-freight-rates.html` — 264
- `otr-dispatch.html` — 260
- `flatbed-dispatch.html` — 255
- `emergency-rescheduling-policy.html` — 253
- `regional-truck-dispatch.html` — 249
- `detention-pay-policy.html` — 247
- `cost-per-mile-calculator.html` — 243
- `freight-broker-software-cost.html` — 238
- `power-only-dispatch.html` — 234
- `create-carrier-account.html` — 233
- `create-shipper-account.html` — 227
- `local-truck-dispatch.html` — 225
- `power-only-freight-rates.html` — 225
- `box-truck-freight-rates.html` — 224
- `conestoga-freight-rates.html` — 224
- `step-deck-freight-rates.html` — 224
- `owner-operator-dispatch.html` — 223
- `where-freight-brokers-get-loads.html` — 223
- `dry-van-freight-rates.html` — 222
- `hotshot-freight-rates.html` — 222
- `how-to-become-a-freight-broker.html` — 222
- `shipper-solutions.html` — 222
- `reefer-freight-rates.html` — 221
- `create-broker-account.html` — 218
- `fuel-surcharge-trucking.html` — 217
- `dry-van-dispatch.html` — 215
- `create-agent-account.html` — 213
- `how-much-does-a-truck-dispatcher-cost.html` — 212
- `ghost-loads-load-board-problems.html` — 211
- `how-to-ship-without-a-broker.html` — 211
- `free-load-board-for-brokers.html` — 209
- `truck-dispatcher-vs-freight-broker.html` — 206
- `privacy.html` — 204
- … 30 more (see data/crawl.csv)

### Canonical / OG / Twitter problems

- none

### JSON-LD

Types present (pages): ProfessionalService 131, BreadcrumbList 130, FAQPage 114, Article 40, HowTo 12, Service 11, WebPage 7, WebApplication 3, JobPosting 2, AboutPage 1

- `dry-van-rates-week-33-2026.html` — $ Article: missing image
- `flatbed-rates-week-28-2026.html` — $ Article: missing image
- `freight-market-report-week-28-2026.html` — $ Article: missing image
- `freight-market-report-week-29-2026.html` — $ Article: missing image
- `freight-market-report-week-30-2026.html` — $ Article: missing image
- `freight-market-report-week-31-2026.html` — $ Article: missing image
- `freight-market-report-week-33-2026.html` — $ Article: missing image
- `freight-market-report-week-34-2026.html` — $ Article: missing image
- `freight-market-report-week-38-2026.html` — $ Article: missing image
- `hotshot-rates-week-31-2026.html` — $ Article: missing image
- `how-to-get-loads-with-new-authority.html` — $ Article: missing datePublished; $ Article: missing image
- `power-only-rates-week-30-2026.html` — $ Article: missing image
- `power-only-rates-week-38-2026.html` — $ Article: missing image
- `reefer-rates-week-34-2026.html` — $ Article: missing image
- `spot-market-freight-rates.html` — $ headline > 110 chars
- `step-deck-rates-week-29-2026.html` — $ Article: missing image

### Broken internal links

- none

### Broken #fragment links (target id not on the page)

- `about.html` → `contact.html#quote` (content)
- `about.html` → `contact.html#create` (content)
- `accessibility.html` → `contact.html#create` (content)
- `accessibility.html` → `contact.html#quote` (content)
- `accessibility.html` → `contact.html#quote` (content)
- `accessibility.html` → `contact.html#create` (content)
- `agent-confirm.html` → `contact.html#quote` (content)
- `agent-confirm.html` → `contact.html#create` (content)
- `agents.html` → `contact.html#quote` (content)
- `agents.html` → `contact.html#create` (content)
- `agriculture-and-produce-freight-shipping.html` → `contact.html#quote` (content)
- `agriculture-and-produce-freight-shipping.html` → `contact.html#create` (content)
- `api.html` → `contact.html#create` (content)
- `api.html` → `contact.html#quote` (content)
- `api.html` → `contact.html#quote` (content)
- `api.html` → `contact.html#quote` (content)
- `api.html` → `contact.html#quote` (content)
- `api.html` → `contact.html#create` (content)
- `apps.html` → `contact.html#quote` (content)
- `apps.html` → `contact.html#create` (content)
- `authority-dot-setup.html` → `contact.html#create` (content)
- `authority-dot-setup.html` → `contact.html#quote` (content)
- `authority-dot-setup.html` → `contact.html#quote` (content)
- `authority-dot-setup.html` → `contact.html#create` (content)
- `blog.html` → `contact.html#create` (content)
- `blog.html` → `contact.html#quote` (content)
- `blog.html` → `contact.html#quote` (content)
- `blog.html` → `contact.html#create` (content)
- `boc3-ucr.html` → `contact.html#create` (content)
- `boc3-ucr.html` → `contact.html#quote` (content)
- `boc3-ucr.html` → `contact.html#quote` (content)
- `boc3-ucr.html` → `contact.html#create` (content)
- `book-truck-loads.html` → `contact.html#quote` (content)
- `book-truck-loads.html` → `contact.html#create` (content)
- `box-truck-dispatch.html` → `contact.html#create` (content)
- `box-truck-dispatch.html` → `contact.html#quote` (content)
- `box-truck-dispatch.html` → `contact.html#quote` (content)
- `box-truck-dispatch.html` → `contact.html#create` (content)
- `box-truck-freight-rates.html` → `contact.html#quote` (content)
- `box-truck-freight-rates.html` → `contact.html#create` (content)
- … 318 more (see data/crawl.csv)

### Internal links that go through a redirect

- `create-agent-account.html` → `referral.html` (301 → `/agents.html`)
- `create-agent-account.html` → `referral.html` (301 → `/agents.html`)

### Orphans — sitemap pages no other page links to from its content

Chrome (header/nav/footer) links and sitemap.html are ignored; "any" = inbound counting chrome too.

- `accessibility.html` — inbound any: 134
- `case-studies.html` — inbound any: 134
- `login.html` — inbound any: 134
- `referral.html` — inbound any: 0
- `sitemap.html` — inbound any: 134
- `sms.html` — inbound any: 134
- `status.html` — inbound any: 134

### Weakly linked (1–2 in-content inbound links)

- `api.html` — 2: brokers.html, free-load-board-for-brokers.html
- `command-center.html` — 1: faq.html
- `do-new-authority-carriers-need-a-dispatcher.html` — 1: blog.html
- `full-truckload-vs-ltl.html` — 2: shipper-solutions.html, truckload-freight-rates.html
- `index.html` — 1: 404.html
- `local-truck-dispatch.html` — 2: otr-dispatch.html, regional-truck-dispatch.html
- `otr-dispatch.html` — 2: local-truck-dispatch.html, regional-truck-dispatch.html
- `partners.html` — 2: brokers.html, index.html
- `power-only-rates-week-30-2026.html` — 2: freight-market-report-week-30-2026.html, freight-market-reports.html
- `regional-truck-dispatch.html` — 2: local-truck-dispatch.html, otr-dispatch.html
- `resources.html` — 1: tools.html
- `should-i-buy-a-truck-before-2027-epa-rule.html` — 1: blog.html
- `truck-dispatcher-in-california.html` — 2: blog.html, truck-dispatcher-in-texas.html
- `truck-dispatcher-in-georgia.html` — 1: blog.html

### Images

- every content image has an alt attribute
- `blog.html` — > 200 KB: thumb-truck-dispatcher-vs-freight-broker.jpg 252 KB
- `carriers.html` — > 200 KB: board-card-details.webp 337 KB
- `create-broker-account.html` — > 200 KB: partner-offers.webp 341 KB
- `detention-pay-policy.html` — > 200 KB: track-phone-pickup.webp 231 KB
- `fcfs-policy.html` — > 200 KB: track-phone-pickup.webp 231 KB
- `gps-tracking.html` — > 200 KB: track-phone-pickup.webp 231 KB, track-phone-map.webp 210 KB
- `how-to-read-a-rate-confirmation.html` — > 200 KB: dispatcher-cost-hero.jpg 216 KB
- `load-board.html` — > 200 KB: board-card-details.webp 337 KB, board-request-countdown.webp 237 KB, partner-offers.webp 341 KB
- `new-authority-dispatch.html` — > 200 KB: board-request-countdown.webp 237 KB
- `payments-settlements.html` — > 200 KB: pay-broker-payables-main.webp 203 KB
- `power-only-dispatch.html` — > 200 KB: power-only.webp 207 KB
- `blog.html` — 1 img without width/height

### Thin pages (< 300 words outside header/nav/footer)

- `status.html` — 215 words
- `referral.html` — 225 words
- `accessibility.html` — 269 words

### Sitemap vs build

Built but not in sitemap: `404.html`, `agent-confirm.html`, `broker-claim.html`, `claim-confirm.html`, `dashboard.html`, `unsub.html`
In sitemap but not built: none
robots.txt: User-agent: * · Allow: / · Disallow: /dashboard.html · Disallow: /app/ · Sitemap: https://loadboot.com/sitemap.xml
sitemap.xml: 131 `<url>` entries, `<changefreq>` only — no `<lastmod>` (Google ignores changefreq/priority; lastmod is the one field it reads).

### External link targets (domains, link instances across all built pages)

play.google.com 138, www.linkedin.com 135, www.fmcsa.dot.gov 4, www.cargonet.com 2, safer.fmcsa.dot.gov 2, www.trustpilot.com 1, arktms.com 1

## Per-page table

| Page | Live | Title | Desc | H1 | Words | KB | Imgs | In-links | JSON-LD | Issues |
|---|---|---|---|---|---|---|---|---|---|---|
| `about.html` | 200 | 50 | 147 | 1 | 2650 | 102 | 2 | 133/134 | AboutPage/BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `accessibility.html` | 200 | 34 | 126 | 1 | 269 | 61 | 1 | 0/134 | BreadcrumbList/ProfessionalService | thin: 269 words; ORPHAN (no content inbound); no <main> |
| `agents.html` | 200 | 54 | 149 | 1 | 881 | 76 | 1 | 133/134 | BreadcrumbList/FAQPage/JobPosting/ProfessionalService | no <main> |
| `agriculture-and-produce-freight-shipping.html` | 200 | 76 | 193 | 1 | 2748 | 87 | 1 | 8/9 | BreadcrumbList/FAQPage/ProfessionalService | title 76 chars; desc 193 chars; no <main> |
| `api.html` | 200 | 49 | 165 | 1 | 1227 | 72 | 1 | 2/134 | BreadcrumbList/ProfessionalService | desc 165 chars; no <main> |
| `apps.html` | 200 | 56 | 169 | 1 | 497 | 66 | 3 | 4/134 | BreadcrumbList/ProfessionalService | desc 169 chars; no <main> |
| `authority-dot-setup.html` | 200 | 59 | 151 | 1 | 1016 | 80 | 1 | 7/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `blog.html` | 200 | 48 | 135 | 1 | 1576 | 102 | 28 | 134/135 | BreadcrumbList/ProfessionalService | 1 img no w/h; heavy img: thumb-truck-dispatcher-vs-freight-broker.jpg 252KB; no <main> |
| `boc3-ucr.html` | 200 | 60 | 154 | 1 | 824 | 74 | 1 | 4/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `book-truck-loads.html` | 200 | 62 | 142 | 1 | 2025 | 99 | 7 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 62 chars; no <main> |
| `box-truck-dispatch.html` | 200 | 49 | 166 | 1 | 775 | 71 | 2 | 3/134 | BreadcrumbList/FAQPage/ProfessionalService | desc 166 chars; no <main> |
| `box-truck-freight-rates.html` | 200 | 76 | 224 | 1 | 1973 | 85 | 1 | 25/25 | BreadcrumbList/FAQPage/ProfessionalService | title 76 chars; desc 224 chars; no <main> |
| `brokers.html` | 200 | 77 | 289 | 1 | 1935 | 95 | 3 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 77 chars; desc 289 chars; no <main> |
| `building-materials-freight-shipping.html` | 200 | 73 | 159 | 1 | 3099 | 89 | 1 | 10/11 | BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; no <main> |
| `careers.html` | 200 | 57 | 191 | 1 | 1446 | 77 | 1 | 133/134 | BreadcrumbList/JobPosting/ProfessionalService | desc 191 chars; no <main> |
| `carrier-application.html` | 200 | 57 | 142 | 1 | 306 | 66 | 2 | 25/26 | BreadcrumbList/ProfessionalService | no <main> |
| `carriers.html` | 200 | 56 | 162 | 1 | 1174 | 89 | 4 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | desc 162 chars; heavy img: board-card-details.webp 337KB; no <main> |
| `case-studies.html` | 200 | 43 | 150 | 1 | 339 | 64 | 2 | 0/134 | BreadcrumbList/ProfessionalService | ORPHAN (no content inbound); no <main> |
| `command-center.html` | 200 | 55 | 144 | 1 | 644 | 77 | 1 | 1/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `compliance.html` | 200 | 60 | 150 | 1 | 705 | 80 | 4 | 14/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `conestoga-freight-rates.html` | 200 | 76 | 224 | 1 | 2010 | 85 | 1 | 26/26 | BreadcrumbList/FAQPage/ProfessionalService | title 76 chars; desc 224 chars; no <main> |
| `contact.html` | 200 | 49 | 152 | 1 | 726 | 79 | 1 | 133/134 | BreadcrumbList/ProfessionalService | no <main> |
| `cookies.html` | 200 | 51 | 175 | 1 | 1245 | 78 | 1 | 4/134 | BreadcrumbList/FAQPage/ProfessionalService | desc 175 chars; no <main> |
| `cost-per-mile-calculator.html` | 200 | 79 | 243 | 1 | 1237 | 76 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService/WebApplication | title 79 chars; desc 243 chars; no <main> |
| `create-agent-account.html` | 200 | 78 | 213 | 1 | 747 | 79 | 4 | 10/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService | title 78 chars; desc 213 chars; no <main> |
| `create-broker-account.html` | 200 | 77 | 218 | 1 | 1364 | 88 | 4 | 19/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService | title 77 chars; desc 218 chars; heavy img: partner-offers.webp 341KB; no <main> |
| `create-carrier-account.html` | 200 | 69 | 233 | 1 | 1032 | 85 | 4 | 13/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService | title 69 chars; desc 233 chars; no <main> |
| `create-shipper-account.html` | 200 | 66 | 227 | 1 | 892 | 82 | 4 | 20/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService | title 66 chars; desc 227 chars; no <main> |
| `delete-account.html` | 200 | 75 | 192 | 1 | 1178 | 79 | 1 | 4/134 | BreadcrumbList/FAQPage/ProfessionalService | title 75 chars; desc 192 chars; no <main> |
| `detention-pay-policy.html` | 200 | 120 | 247 | 1 | 1574 | 93 | 3 | 55/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebPage | title 120 chars; desc 247 chars; heavy img: track-phone-pickup.webp 231KB; no <main> |
| `do-new-authority-carriers-need-a-dispatcher.html` | 200 | 62 | 166 | 1 | 1270 | 74 | 2 | 1/1 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 62 chars; desc 166 chars; no <main> |
| `driver-assist-policy.html` | 200 | 77 | 195 | 1 | 1385 | 90 | 3 | 16/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebPage | title 77 chars; desc 195 chars; no <main> |
| `dry-van-dispatch.html` | 200 | 85 | 215 | 1 | 767 | 73 | 2 | 5/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 85 chars; desc 215 chars; no <main> |
| `dry-van-freight-rates.html` | 200 | 74 | 222 | 1 | 2167 | 87 | 1 | 29/30 | BreadcrumbList/FAQPage/ProfessionalService | title 74 chars; desc 222 chars; no <main> |
| `dry-van-rates-week-33-2026.html` | 200 | 56 | 144 | 1 | 1144 | 75 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | LD: $ Article: missing image; no <main> |
| `emergency-rescheduling-policy.html` | 200 | 81 | 253 | 1 | 1803 | 94 | 3 | 10/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebPage | title 81 chars; desc 253 chars; no <main> |
| `factoring-noa.html` | 200 | 58 | 145 | 1 | 1001 | 82 | 4 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `faq.html` | 200 | 59 | 145 | 1 | 2533 | 102 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `fcfs-policy.html` | 200 | 101 | 345 | 1 | 1485 | 92 | 3 | 16/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebPage | title 101 chars; desc 345 chars; heavy img: track-phone-pickup.webp 231KB; no <main> |
| `features.html` | 200 | 55 | 152 | 1 | 3280 | 115 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `flatbed-dispatch.html` | 200 | 115 | 255 | 1 | 791 | 74 | 2 | 6/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 115 chars; desc 255 chars; no <main> |
| `flatbed-freight-rates.html` | 200 | 137 | 264 | 1 | 2065 | 86 | 1 | 28/29 | BreadcrumbList/FAQPage/ProfessionalService | title 137 chars; desc 264 chars; no <main> |
| `flatbed-rates-week-28-2026.html` | 200 | 56 | 144 | 1 | 1206 | 75 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | LD: $ Article: missing image; no <main> |
| `fleet-management.html` | 200 | 60 | 153 | 1 | 1008 | 82 | 7 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `food-and-beverage-freight-shipping.html` | 200 | 70 | 163 | 1 | 2822 | 87 | 1 | 9/10 | BreadcrumbList/FAQPage/ProfessionalService | title 70 chars; desc 163 chars; no <main> |
| `form-2290-hvut.html` | 200 | 56 | 147 | 1 | 815 | 75 | 1 | 4/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `free-load-board-for-brokers.html` | 200 | 77 | 209 | 1 | 2428 | 102 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 77 chars; desc 209 chars; no <main> |
| `freight-agent-vs-freight-broker.html` | 200 | 101 | 200 | 1 | 1168 | 73 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 101 chars; desc 200 chars; no <main> |
| `freight-broker-software-cost.html` | 200 | 85 | 238 | 1 | 2409 | 82 | 1 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 85 chars; desc 238 chars; no <main> |
| `freight-broker-startup-checklist.html` | 200 | 61 | 190 | 1 | 990 | 72 | 1 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 61 chars; desc 190 chars; no <main> |
| `freight-market-report-week-28-2026.html` | 200 | 73 | 160 | 1 | 1890 | 83 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; LD: $ Article: missing image; no <main> |
| `freight-market-report-week-29-2026.html` | 200 | 73 | 160 | 1 | 1983 | 84 | 1 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; LD: $ Article: missing image; no <main> |
| `freight-market-report-week-30-2026.html` | 200 | 73 | 160 | 1 | 2027 | 83 | 1 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; LD: $ Article: missing image; no <main> |
| `freight-market-report-week-31-2026.html` | 200 | 73 | 160 | 1 | 1964 | 83 | 1 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; LD: $ Article: missing image; no <main> |
| `freight-market-report-week-33-2026.html` | 200 | 73 | 160 | 1 | 1977 | 83 | 1 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; LD: $ Article: missing image; no <main> |
| `freight-market-report-week-34-2026.html` | 200 | 73 | 160 | 1 | 2019 | 84 | 1 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; LD: $ Article: missing image; no <main> |
| `freight-market-report-week-38-2026.html` | 200 | 73 | 160 | 1 | 1955 | 83 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; LD: $ Article: missing image; no <main> |
| `freight-market-reports.html` | 200 | 67 | 141 | 1 | 2446 | 86 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 67 chars; no <main> |
| `freight-shipping-by-industry.html` | 200 | 66 | 179 | 1 | 1237 | 74 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 66 chars; desc 179 chars; no <main> |
| `fuel-surcharge-trucking.html` | 200 | 62 | 217 | 1 | 3114 | 88 | 1 | 16/16 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 62 chars; desc 217 chars; no <main> |
| `full-truckload-vs-ltl.html` | 200 | 60 | 150 | 1 | 726 | 70 | 1 | 2/2 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `get-started.html` | 200 | 55 | 151 | 1 | 1353 | 103 | 1 | 133/134 | BreadcrumbList/ProfessionalService | no <main> |
| `ghost-loads-load-board-problems.html` | 200 | 55 | 211 | 1 | 1718 | 80 | 2 | 14/134 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 211 chars; no <main> |
| `gps-tracking.html` | 200 | 59 | 153 | 1 | 1804 | 97 | 6 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | heavy img: track-phone-pickup.webp 231KB, track-phone-map.webp 210KB; no <main> |
| `hotshot-dispatch.html` | 200 | 36 | 168 | 1 | 721 | 72 | 2 | 6/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | desc 168 chars; no <main> |
| `hotshot-freight-rates.html` | 200 | 74 | 222 | 1 | 1968 | 85 | 1 | 25/25 | BreadcrumbList/FAQPage/ProfessionalService | title 74 chars; desc 222 chars; no <main> |
| `hotshot-rates-week-31-2026.html` | 200 | 56 | 144 | 1 | 1123 | 75 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | LD: $ Article: missing image; no <main> |
| `how-it-works.html` | 200 | 53 | 154 | 1 | 1808 | 103 | 10 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `how-much-does-a-truck-dispatcher-cost.html` | 200 | 52 | 212 | 1 | 1517 | 78 | 1 | 12/12 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 212 chars; no <main> |
| `how-new-freight-brokers-find-carriers.html` | 200 | 85 | 186 | 1 | 1737 | 76 | 1 | 5/5 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 85 chars; desc 186 chars; no <main> |
| `how-to-avoid-cheap-freight.html` | 200 | 54 | 149 | 1 | 1112 | 71 | 2 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `how-to-become-a-freight-broker.html` | 200 | 93 | 222 | 1 | 1613 | 76 | 1 | 6/6 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 93 chars; desc 222 chars; no <main> |
| `how-to-get-loads-with-new-authority.html` | 200 | 56 | 134 | 1 | 516 | 63 | 1 | 7/7 | Article/BreadcrumbList/ProfessionalService | LD: $ Article: missing datePublished; LD: $ Article: missing image; no <main> |
| `how-to-read-a-rate-confirmation.html` | 200 | 58 | 142 | 1 | 1188 | 72 | 2 | 8/134 | Article/BreadcrumbList/FAQPage/ProfessionalService | heavy img: dispatcher-cost-hero.jpg 216KB; no <main> |
| `how-to-ship-without-a-broker.html` | 200 | 56 | 211 | 1 | 1220 | 74 | 2 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 211 chars; no <main> |
| `ifta-fuel-tax.html` | 200 | 59 | 149 | 1 | 862 | 75 | 1 | 7/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `index.html` | 200 | 60 | 146 | 1 | 3223 | 143 | 3 | 1/135 | FAQPage/ProfessionalService | no <main> |
| `integrations.html` | 200 | 58 | 153 | 1 | 1153 | 83 | 4 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `layover-policy.html` | 200 | 128 | 373 | 1 | 1434 | 92 | 3 | 37/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebPage | title 128 chars; desc 373 chars; no <main> |
| `load-board-subscription-cost.html` | 200 | 56 | 199 | 1 | 1309 | 74 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 199 chars; no <main> |
| `load-board.html` | 200 | 53 | 145 | 1 | 3736 | 123 | 9 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | heavy img: board-card-details.webp 337KB, board-request-countdown.webp 237KB, partner-offers.webp 341KB; no <main> |
| `load-score.html` | 200 | 60 | 132 | 1 | 1159 | 85 | 1 | 134/135 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebApplication | no <main> |
| `local-truck-dispatch.html` | 200 | 77 | 225 | 1 | 1037 | 74 | 1 | 2/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 77 chars; desc 225 chars; no <main> |
| `login.html` | 200 | 65 | 159 | 1 | 311 | 62 | 1 | 0/134 | BreadcrumbList/ProfessionalService | title 65 chars; ORPHAN (no content inbound); no <main> |
| `lumper-policy.html` | 200 | 119 | 331 | 1 | 1424 | 91 | 3 | 39/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebPage | title 119 chars; desc 331 chars; no <main> |
| `manufacturing-and-industrial-freight-shipping.html` | 200 | 68 | 182 | 1 | 2796 | 87 | 1 | 10/11 | BreadcrumbList/FAQPage/ProfessionalService | title 68 chars; desc 182 chars; no <main> |
| `market-rates.html` | 200 | 68 | 177 | 1 | 1090 | 74 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 68 chars; desc 177 chars; no <main> |
| `metals-and-steel-freight-shipping.html` | 200 | 69 | 184 | 1 | 2803 | 87 | 1 | 10/11 | BreadcrumbList/FAQPage/ProfessionalService | title 69 chars; desc 184 chars; no <main> |
| `new-authority-dispatch.html` | 200 | 86 | 163 | 1 | 874 | 73 | 3 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 86 chars; desc 163 chars; heavy img: board-request-countdown.webp 237KB; no <main> |
| `otr-dispatch.html` | 200 | 93 | 260 | 1 | 982 | 74 | 1 | 2/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 93 chars; desc 260 chars; no <main> |
| `oversize-load-rates-per-mile.html` | 200 | 48 | 197 | 1 | 1933 | 80 | 1 | 6/6 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 197 chars; no <main> |
| `owner-operator-dispatch-service-guide.html` | 200 | 58 | 154 | 1 | 2065 | 82 | 2 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `owner-operator-dispatch.html` | 200 | 79 | 223 | 1 | 820 | 73 | 3 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 79 chars; desc 223 chars; no <main> |
| `partners.html` | 200 | 61 | 138 | 1 | 405 | 70 | 1 | 2/134 | BreadcrumbList/ProfessionalService | title 61 chars; no <main> |
| `payments-settlements.html` | 200 | 61 | 149 | 1 | 1454 | 88 | 6 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 61 chars; heavy img: pay-broker-payables-main.webp 203KB; no <main> |
| `power-only-dispatch.html` | 200 | 100 | 234 | 1 | 722 | 72 | 2 | 4/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 100 chars; desc 234 chars; heavy img: power-only.webp 207KB; no <main> |
| `power-only-freight-rates.html` | 200 | 77 | 225 | 1 | 1998 | 85 | 1 | 27/27 | BreadcrumbList/FAQPage/ProfessionalService | title 77 chars; desc 225 chars; no <main> |
| `power-only-rates-week-30-2026.html` | 200 | 59 | 147 | 1 | 1147 | 75 | 1 | 2/2 | Article/BreadcrumbList/FAQPage/ProfessionalService | LD: $ Article: missing image; no <main> |
| `power-only-rates-week-38-2026.html` | 200 | 59 | 147 | 1 | 1192 | 75 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | LD: $ Article: missing image; no <main> |
| `pricing.html` | 200 | 59 | 143 | 1 | 1165 | 78 | 2 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `privacy.html` | 200 | 42 | 204 | 1 | 4671 | 108 | 1 | 5/134 | BreadcrumbList/FAQPage/ProfessionalService | desc 204 chars; no <main> |
| `protect-freight-from-loss-damage-and-fraud.html` | 200 | 56 | 192 | 1 | 1534 | 76 | 2 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 192 chars; no <main> |
| `reefer-dispatch.html` | 200 | 55 | 153 | 1 | 850 | 75 | 2 | 5/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | no <main> |
| `reefer-freight-rates.html` | 200 | 73 | 221 | 1 | 2130 | 87 | 1 | 27/28 | BreadcrumbList/FAQPage/ProfessionalService | title 73 chars; desc 221 chars; no <main> |
| `reefer-rates-week-34-2026.html` | 200 | 55 | 143 | 1 | 1141 | 75 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | LD: $ Article: missing image; no <main> |
| `referral.html` | 200 | 56 | 148 | 1 | 225 | 61 | 1 | 0/0 | BreadcrumbList/ProfessionalService | thin: 225 words; ORPHAN (no content inbound); no <main>; LIVE 1 redirect(s); LIVE title differs; LIVE canonical differs; bare URL: 301 → 301 → 200 https://loadboot.com/agents.html |
| `regional-truck-dispatch.html` | 200 | 79 | 249 | 1 | 956 | 74 | 1 | 2/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 79 chars; desc 249 chars; no <main> |
| `resources.html` | 200 | 58 | 133 | 1 | 675 | 76 | 1 | 1/134 | BreadcrumbList/ProfessionalService | no <main> |
| `retail-and-ecommerce-freight-shipping.html` | 200 | 74 | 180 | 1 | 2727 | 86 | 1 | 10/11 | BreadcrumbList/FAQPage/ProfessionalService | title 74 chars; desc 180 chars; no <main> |
| `security.html` | 200 | 66 | 168 | 1 | 1448 | 81 | 1 | 7/134 | BreadcrumbList/FAQPage/ProfessionalService | title 66 chars; desc 168 chars; no <main> |
| `services.html` | 200 | 46 | 170 | 1 | 1091 | 87 | 3 | 44/135 | BreadcrumbList/FAQPage/ProfessionalService | desc 170 chars; no <main> |
| `ship-direct-to-carrier.html` | 200 | 54 | 148 | 1 | 1765 | 84 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `shipper-solutions.html` | 200 | 77 | 222 | 1 | 2206 | 101 | 3 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService | title 77 chars; desc 222 chars; no <main> |
| `should-i-buy-a-truck-before-2027-epa-rule.html` | 200 | 58 | 192 | 1 | 3064 | 87 | 2 | 1/1 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 192 chars; no <main> |
| `sitemap.html` | 200 | 18 | 91 | 1 | 301 | 64 | 1 | 0/134 | BreadcrumbList/ProfessionalService | title short 18; ORPHAN (no content inbound); no <main> |
| `sms.html` | 200 | 77 | 172 | 1 | 1043 | 78 | 1 | 0/134 | BreadcrumbList/ProfessionalService | title 77 chars; desc 172 chars; ORPHAN (no content inbound); no <main> |
| `spot-market-freight-rates.html` | 200 | 95 | 296 | 1 | 3824 | 93 | 1 | 5/5 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 95 chars; desc 296 chars; LD: $ headline > 110 chars; no <main> |
| `status.html` | 200 | 22 | 85 | 1 | 215 | 62 | 1 | 0/134 | BreadcrumbList/ProfessionalService | title short 22; thin: 215 words; ORPHAN (no content inbound); no <main> |
| `step-deck-freight-rates.html` | 200 | 76 | 224 | 1 | 1989 | 85 | 1 | 27/27 | BreadcrumbList/FAQPage/ProfessionalService | title 76 chars; desc 224 chars; no <main> |
| `step-deck-rates-week-29-2026.html` | 200 | 58 | 146 | 1 | 1160 | 75 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | LD: $ Article: missing image; no <main> |
| `terms.html` | 200 | 27 | 166 | 1 | 3780 | 101 | 1 | 6/134 | BreadcrumbList/FAQPage/ProfessionalService | title short 27; desc 166 chars; no <main> |
| `tonu-policy.html` | 200 | 137 | 389 | 1 | 1512 | 92 | 3 | 40/134 | BreadcrumbList/FAQPage/HowTo/ProfessionalService/WebPage | title 137 chars; desc 389 chars; no <main> |
| `tools.html` | 200 | 65 | 151 | 1 | 1233 | 82 | 1 | 14/15 | BreadcrumbList/FAQPage/ProfessionalService/WebApplication | title 65 chars; no <main> |
| `truck-dispatcher-in-california.html` | 200 | 48 | 139 | 1 | 1254 | 74 | 2 | 2/2 | Article/BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `truck-dispatcher-in-georgia.html` | 200 | 53 | 136 | 1 | 1013 | 72 | 2 | 1/1 | Article/BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `truck-dispatcher-in-texas.html` | 200 | 48 | 140 | 1 | 1715 | 77 | 2 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | no <main> |
| `truck-dispatcher-vs-freight-broker.html` | 200 | 56 | 206 | 1 | 1750 | 83 | 1 | 7/7 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 206 chars; no <main> |
| `truck-driver-per-diem-2026.html` | 200 | 54 | 197 | 1 | 2350 | 90 | 2 | 4/4 | Article/BreadcrumbList/FAQPage/ProfessionalService | desc 197 chars; no <main> |
| `truckload-freight-rates.html` | 200 | 125 | 350 | 1 | 2538 | 86 | 1 | 6/6 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 125 chars; desc 350 chars; no <main> |
| `us-truck-dispatcher.html` | 200 | 62 | 150 | 1 | 1054 | 77 | 1 | 133/134 | BreadcrumbList/FAQPage/ProfessionalService/Service | title 62 chars; no <main> |
| `where-freight-brokers-get-loads.html` | 200 | 76 | 223 | 1 | 1364 | 74 | 1 | 3/3 | Article/BreadcrumbList/FAQPage/ProfessionalService | title 76 chars; desc 223 chars; no <main> |
