# Keyword plan — ranking LoadBoot for searches that are not "loadboot" (24 Sep 2026)

Read `BASELINE.md` §1 first: 44 % of Google clicks are brand, 97.5 % of impressions are not, non-brand CTR is
≈ 0.5 %. This plan is how the non-brand half goes from ~73 clicks / 28 d to a real channel.

**Ground rule (Yaseen, 5 Sep):** keywords come from GSC, not from a keyword tool or a guess. Every cluster
below is tagged:

- **GSC** — real query rows from the R9/R10 pulls (28-day windows ending 09-16 / 09-19), impressions @ position.
- **GUESS** — a cluster I expect exists but have **not** seen in GSC. Never build for a GUESS until a
  `query` pull with a filter confirms impressions ≥ 20. Volumes are deliberately not quoted anywhere —
  I have no keyword-tool access and would be inventing them.

Target for the 90 days from the first page session: **non-brand clicks 73 → 250 per 28 d.** Arithmetic,
not ambition: 14,000 non-brand impressions at 1.5 % CTR = 210, plus the growth in impressions the rounds are
already producing. Brand clicks are not a KPI here; they follow the business.

---

## 1. Clusters, mapped to pages

Position is where the site's *best* URL sits for the head query. "Owner" is the page that must rank; every
other page mentioning the phrase links to the owner with that phrase as anchor text.

### A. Rates per mile, by equipment — **GSC**, page 1/2 today, the CTR play

| Head queries (impr @ pos) | Owner page | Today (28 d) | Intent | Move |
|---|---|---|---|---|
| flatbed cost per mile 12 @ 32.8 (+35 @ 40.3 on market-rates) · current flatbed rates per mile 10 @ 14.0 (+17) · average flatbed rate per mile 5 @ 22.6 (+32) · flatbed trucking rates per mile 4 @ 25.5 (+34) · national average flatbed rates 4 | `flatbed-freight-rates.html` | 0 / 1,205 / 11.1 | carrier & shipper, "what should I charge / pay" | Snippet: description that leads with the number *and* the date ("Flatbed rates per mile, September 2026: $3.54 avg, $4.07 spot…"). Title keeps every token (R9). Pull market-rates' flatbed queries over by linking `market-rates` → hub with the exact phrases |
| average box truck rate per mile 5 @ 29.6 | `box-truck-freight-rates.html` | 0 / 241 / 8.0 | | same description shape |
| hotshot rates per mile (cluster) | `hotshot-freight-rates.html` | 5 / 483 / 9.2 | | description + FAQ "hotshot rate per mile 2026" |
| step deck rates | `step-deck-freight-rates.html` | 5 / 182 / 6.3 | | protect; description only |
| dry van rates per mile | `dry-van-freight-rates.html` | 3 / 377 / 11.7 | | description; internal links from the 6 dry-van mentions on other pages |
| power only rates | `power-only-freight-rates.html` | 0 / 215 / 7.3 | | description |
| reefer rates per mile | `reefer-freight-rates.html` | 0 / 137 / 10.0 | | description |
| conestoga rates | `conestoga-freight-rates.html` | small | | leave |

Why descriptions and not titles: these pages are already on page 1. Position is not the problem, the
snippet is. Their descriptions are 221–264 chars, so Google shows its own extract. The rule for the rewrite:
**first 150 characters carry the number, the date, the equipment and "per mile"**; the rest can stay.

### B. Live market table — **GSC**, the cannibalisation source

| Queries | Owner | Today | Move |
|---|---|---|---|
| dozens of "X rates per mile" shapes, "freight rates", "trucking rates today", "load board rates" | `market-rates.html` | 16 / 4,099 / 23.2 | Title **locked**. Make the page the *index* of the hubs: an "by equipment" block above the fold with the 8 hub links using the exact per-mile phrases; description rewritten to the "live, updated <date>" promise. Each hub it loses a query to is a win — that is the point |

### C. Spot / truckload vocabulary — **GSC**, new pages, measure

| Queries | Owner | Today | Move |
|---|---|---|---|
| spot market freight rates 35 @ 80 · truckload spot rates 23–25 @ 25 · freight spot rates 21 · trucking spot rates 19 · spot market rates 10 | `spot-market-freight-rates.html` (R9, 18 Sep) | unmeasured | Nothing until 16 Oct. Then: if impressions moved off market-rates, add 3 more internal links; if not, check indexing (GSC URL inspect) before touching copy |
| truckload freight rates 71 @ 22 · full truckload rates 53 @ 47 · truckload rates 37 · truckload rate 29 | `truckload-freight-rates.html` (R10, 21 Sep) | unmeasured | Same, 19 Oct |
| full truckload vs ltl (cluster) | `full-truckload-vs-ltl.html` | 0 impressions (related block was broken until R10) | Link from shipper-solutions hero + truckload page; measure |

### D. Accessorial definitions — **GSC**, page 2, the "what is / meaning" pattern

These are informational, low-conversion, high-volume for this niche. They build topical authority and they
are the pages Bing already ranks. Their job is to rank, then hand the reader to a dispatch page.

| Queries | Owner | Today | Move |
|---|---|---|---|
| tonu meaning 80 @ 11.1 · what does tonu mean in trucking 10 · tonu definition 7 · what is tonu 5 | `tonu-policy.html` | 0 / 486 / 15.0 (edited 09-21) | measure to 19 Oct; then a 40-word definition as the first paragraph under the H1 (featured-snippet shape), FAQ already there |
| layover pay for truckers 52 @ 36 · what is layover pay in trucking 59 @ 34 · how much is layover pay for owner operators 27 @ 10.6 | `layover-policy.html` | 1 / 916 / 18.2 (edited 09-21) | measure; then the same definition-first paragraph + a per-day table |
| detention pay (cluster) · detention pay for truckers | `detention-pay-policy.html` | 0 / 394 / 16.7 | title drops `$50–$100/Hour` (rule), description rewrite, definition-first paragraph |
| lumper fee meaning 13 · lumber fee meaning 10 · what is a lumper in trucking 9 · lumper fee definition 9 | `lumper-policy.html` | 0 / 374 / 30.4 (edited 09-21) | measure |
| fcfs meaning in trucking 20 @ 12.5 | `fcfs-policy.html` | 1 / 186 / 9.3 (locked) | leave |
| **GUESS**: "layover pay calculator", "detention pay calculator", "tonu fee amount" | same owners | — | validate with a filtered `query` pull; a calculator widget on the existing page beats a new page |

Every one of these pages gets the same closing block: "Our dispatchers bill this for you — see dispatch
pricing" → `pricing.html` / `owner-operator-dispatch.html`. That is how an informational click becomes a lead.

### E. Dispatch services — **GSC**, the money cluster, pos 33–78, content problem

| Queries | Owner | Today | Move |
|---|---|---|---|
| power only dispatch services 42 @ 78.6 | `power-only-dispatch.html` | 0 / 115 / 71.3 | **Rewrite** (below) |
| dry van dispatch services 52 @ 66 · dry van dispatcher 25 @ 39.7 | `dry-van-dispatch.html` | 0 / 169 / 51.7 | **Rewrite** |
| flatbed dispatch services 25 @ 29.9 · flatbed dispatch service 7 · flatbed truck dispatch 6 | `flatbed-dispatch.html` | 0 / 102 / 35.0 (edited 09-18) | measure to 16 Oct, then rewrite |
| owner operator dispatch (cluster) | `owner-operator-dispatch.html` | 2 / 83 / 33.1 (locked) | internal links only while it grows |
| how much does a truck dispatcher cost / dispatcher percentage | `how-much-does-a-truck-dispatcher-cost.html` | pos 10.4 in July, re-pull | the single highest-intent page; protect, add the fee table to the snippet |
| new authority dispatch · loads with new authority | `new-authority-dispatch.html`, `how-to-get-loads-with-new-authority.html` | re-pull | check cannibalisation between the two |
| truck dispatcher (US) · truck dispatch service | `us-truck-dispatcher.html` | re-pull | |
| **GUESS**: truck dispatcher near me · truck dispatcher in texas / georgia / california · dispatch service for owner operators no contract · dispatch services 5 percent | `truck-dispatcher-in-<state>.html` (exist, 1–2 inbound links each) | — | validate; if impressions exist, link the three from `us-truck-dispatcher` + `services` + footer "Dispatch by state" |

**What "rewrite" means for a dispatch page** (the ranking pages for these queries are 1,500–2,500-word
dispatch-company pages): who it is for (equipment, authority age, region) · exactly what the dispatcher does
each day · the fee, in one sentence, with what is and is not included · the first-week process · proof
(real trip counts / lanes from the platform, anonymised) · 6–8 FAQs in the searcher's words (from GSC) ·
links to the matching rate hub, the cost page and the application. Same frame as the 8 rate hubs that went
from nothing to page 1 in six weeks.

### F. Broker / shipper side — **GSC** thin, strategy in `docs/seo/demand-side-broker-shipper-seo-strategy.md`

| Queries | Owner | Today | Move |
|---|---|---|---|
| freight broker software cost (cluster) | `freight-broker-software-cost.html` | 0 / 94 / 21.5 | in `broker_growth_module.py`; description + FAQ (weekly rounds skip this module — Phase 2 does not) |
| freight agent vs freight broker | `freight-agent-vs-freight-broker.html` | 0 / 80 / 12.8 | same |
| ghost loads 4 @ 9 | `ghost-loads-load-board-problems.html` | 0 / 119 / 6.3 | description only |
| **GSC-unknown, from the strategy doc**: free load board for brokers · DAT alternative · post loads free · how to avoid double brokering · how to ship freight without a broker | `free-load-board-for-brokers.html`, `how-to-ship-without-a-broker.html`, `ship-direct-to-carrier.html` | pull | pull `page` rows for these three first; they were built on the strategy doc's reasoning, not on data |

### G. Brand / navigational — **GSC**, leave alone

loadboot · load boot · loadboot login · carrier desk login (21 @ 6.2). Homepage 55 clicks @ 16.7 % CTR,
login 3. Nothing to do except keep the homepage title stable. If a page session ever tempts you to put a
keyword in the homepage title — don't; it is the one page whose clicks are safe.

---

## 2. The snippet layer (weeks 1–4) — a controlled test, not a mass edit

The weekly rounds' keyword-preservation rule earned the impressions: long titles that carry every query
token. The crawl shows the cost: 66 titles over 60 chars, 70 descriptions over 160, and page-1 hubs with
hundreds of impressions and zero clicks. Both things are true. So:

1. **Descriptions first, on the 8 rate hubs (order 1–8 in the ledger).** Titles untouched. Description ≤ 155
   chars, number + date + equipment + "per mile" in the first 100. Measure 28 d. Expected: CTR 0 → 1.5–3 %
   at the same position. This is low-risk because descriptions do not affect ranking.
2. **One title A/B, on one page, with Yaseen's yes.** Pick the hub with the most impressions after step 1.
   Cut its title to ≤ 65 chars keeping the two highest-impression tokens; BEFORE row; 28 d; revert if
   impressions fall > 15 % or position > 3 worse. If clicks rise without losing impressions, repeat one page
   per session. If not, the long-title rule stands and we know it.
3. Definition pages: **definition-first paragraph** (≤ 45 words directly under the H1). Featured snippets in
   this niche come from that shape; it does not touch titles.

## 3. Content & internal links (weeks 3–8)

- Rewrite `power-only-dispatch`, `dry-van-dispatch`, then `flatbed-dispatch` after its window (E above). One per session.
- `market-rates` becomes the hub index (B). One session.
- Internal-link pass, done inside the owner's session, never as a separate sweep: each hub gets ≥ 5 in-content
  links with the exact phrase; the three state pages, otr/regional/local, full-truckload-vs-ltl and
  case-studies come off the "weakly linked" list.
- New pages only where a **GSC** cluster has ≥ 100 impressions with no owner. Today that list is empty (spot
  and truckload took the last two). Re-check each round; candidates to watch: "trucking rates by state",
  "freight rates by lane" (market-rates query shapes), "load board for owner operators" (**GUESS**).
- Fix S3 once in `market_reports_module.py` (Article `image`) so the 14 weekly reports at pos 5.6–7.9 are
  eligible for Article rich results.

## 4. Authority (all 12 weeks, in parallel — this is what moves pos 30 → 10)

Bing ranks the site above Google because Bing does not need links. Google does. The playbooks are written
(`docs/BACKLINKS-PLAYBOOK.md`, `docs/BACKLINKS-CONTENT-PACK.md`, `docs/seo/OFF-PAGE-PACK-2026-08-28.md`);
what is missing is execution and a log. Minimum viable version:

1. **Data as the link magnet.** The weekly market report and the rate hubs are the only pages a trucking
   blog, a factoring company or a state association would cite. Each report goes out to 10 named
   outlets/newsletters with a one-line "rate this week, source linked" — logged in `docs/seo/BACKLINKS-WEEK1.md`'s format.
2. **Directory and profile links that carriers actually use** (FMCSA-adjacent directories, dispatcher
   directories, Google Business Profile, Bing Places, Crunchbase, Product Hunt-style launch pages, app-store
   listings already exist). One session, one afternoon of Yaseen's time for the ones that need identity.
3. **Partners' pages** — every integration/partner named on `integrations.html` and `partners.html` is a link
   request with a reason.
4. Never paid links, never link farms; a three-month-old domain gets penalised, not helped.

Target: 25 referring domains by day 90 (from what looks like ≈ 0 outside app stores and LinkedIn — verify in
GSC → Links, which needs the same access as §5 of BASELINE.md).

## 5. Measurement rules (carry over from the weekly rounds, unchanged)

- BEFORE row in `LEDGER.md` before any edit: URL · date · 28 d clicks / impr / CTR / pos for the page and its
  top-3 queries. No BEFORE row, no edit.
- One page per session. Never re-edit inside 28 days. A page with week-over-week click growth is **locked**.
- Revert line: impressions −15 % or position +5 worse at the 28-day read → revert, log it.
- Titles never carry a market figure (only LoadBoot's own prices: flat 5 %, $250 TONU, $60/hr detention).
- URLs never change.
- The weekly rounds continue on their own cadence; Phase 2 sessions **check the WEEKLY-LOG row for that page
  before touching it** so the two do not edit the same page in the same window.

## 6. Twelve-week calendar (one page session per working day is the pace the plan assumes; slower is fine, order does not change)

| Weeks | Sessions | Deliverable |
|---|---|---|
| 1–2 | Ledger 1–8 (rate hubs, descriptions), 11 (detention title), 13 (ghost-loads), 2 (market-rates hub index) | CTR on page-1 pages; first BEFORE rows |
| 3–4 | 14–17 (pricing, get-started, carriers, brokers: pull + fix), 18 (power-only rewrite), S3 module fix, OS5 | Money pages measured; first rewrite live |
| 5–6 | 19 (dry-van rewrite), 22–23 (dispatch cluster), 24 (broker module pages); 28-day reads of weeks 1–2 → revert or lock | Second rewrite; first proof the snippet layer works |
| 7–8 | 9, 10, 12, 21, 25 come out of their windows → measure, then definition-first paragraphs; title A/B decision | |
| 9–10 | 26 (state pages, if GSC validates), F-cluster broker pages, internal-link debt from S6/S7 | |
| 11–12 | 28-day reads of weeks 5–8; re-rank the ledger from a fresh `query,page` pull at rowLimit 5000; write the next 12 weeks | Non-brand clicks vs the 250 target |

Off-page (§4) runs every week beside this, logged separately.
