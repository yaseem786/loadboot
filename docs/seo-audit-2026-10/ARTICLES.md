# Weekly premium article — rules + log

Owner decision, 25 Sep 2026: **one premium article every week**, topic picked from live data, purpose = organic
traffic without ads. Run by the cloud Routine "LoadBoot weekly premium article" (Tuesday). This file is the
Routine's rulebook — change the rules here, not in the Routine prompt. It overrides KEYWORD-PLAN §3's
"new pages only at ≥ 100 impressions" for articles only; everything else in the plan and the LEDGER stands.

## 1. Data (pull fresh every run — never copy numbers from this file)

- **GSC:** `docs/seo-audit-2026-10/harness/seo-pull.sh 90 query,page 1000`, `… 28 query 1000`, `… 28 page 1000`
  (`SEO_PULL_TOKEN` is in the environment). Save to files and analyse with python — never print raw JSON.
- **Site analytics (first-party, what CC shows):** prod `rwscphuhpjoudvljvmdk`, read-only SQL on
  `app_private.web_sessions` — organic landings, pageviews and `converted` per landing page, 90 d, bots and
  internal excluded. GA4 (`ga4-insights`) is staff-gated and not reachable from a Routine; say so, don't guess it.
- Snapshot on 25 Sep 2026 for orientation only: organic traffic is almost all rate intent (`market-rates` 504
  organic sessions / 90 d at 1.1 pageviews, 0 conversions; homepage 135 with 5 conversions). Articles should
  catch rate/money intent **and** hand the reader to dispatch / sign-up.

## 2. Picking the topic (in this order)

1. **Exclusion set.** Every URL in the LEDGER queue, every page with a LEDGER row in the last 28 days, and the
   page that already ranks best for a query. A query whose best page is in this set is **owned** — do not
   write an article that targets it (it would cannibalise a page under measurement: e.g. "layover pay",
   "detention pay", "lumper fee" belong to the policy pages #9/#11/#12). Log it under §5 "for page sessions".
2. **Data-picked (preferred).** A query cluster (shared stem/intent) with ≥ 30 impressions / 90 d, best
   position > 20 or no page matching its intent, and **no existing page on the topic** (grep `build_site.py`
   slugs, titles and H1s, and the built sitemap). Question queries (how/what/can/do/is) count double.
3. **Demand next to what converts.** Supporting articles for landing pages that convert or carry organic
   traffic (per `web_sessions`), answering the next question that reader has, with a link into that page.
4. **Seed backlog (§4)** only if 1–3 give nothing. Say plainly in the log and report that the topic is
   **seed, not data-picked**.

Score survivors by: realistic impressions × LoadBoot fit (owner-operator/carrier dispatch sign-up >
broker > shipper > agent) × no overlap. Pick one. Never two articles on one cluster.

## 3. The article (quality bar — premium or nothing)

- `rich_article()` in `build_site.py`, same pattern as the best existing ones (read `truckload-freight-rates`
  and `how-much-does-a-truck-dispatcher-cost` first). Add its date to `PUB_DATES` (today's real date).
- 1,800–2,800 words, 7–9 TOC sections, **definition-first answer ≤ 45 words** under the H1, 5–7 FAQs (on-page
  + FAQPage schema via `faq_block`), 2–3 `svc_banner()` CTAs to the page that converts for that reader.
- Title ≤ 60 chars with the primary query phrasing; description ≤ 155 chars that carries the click. **No market
  rate figure in a title** (LoadBoot's own prices are fine: flat 5 %, $250 TONU, $60/hr detention).
- Numbers only from: `app_private.rate_benchmarks` / `fuel_prices` (read-only, state the as-of date), the
  repo's market reports, or official sources (FMCSA, IRS, DOT, EIA) fetched this run and cited with a
  `rel="nofollow"` link. **No invented statistics, customers, testimonials or results.** Unsure = leave out.
- Worked examples with real arithmetic (cost per mile, net per load, fees) — that is what makes it premium.
- Links: ≥ 4 in-content links out to relevant LoadBoot pages; ≥ 2 inbound links added through `RELATED`
  grids of related pages. **Do not edit titles, descriptions or body copy of any other page** — the LEDGER owns them.
- Contact rule (CLAUDE.md §7): no `253-7575` anywhere.
- Quality gate before commit: one adversarial read by an Opus subagent (facts, fluff, thin sections,
  cannibalisation); fix what it finds. `python3 build_site.py` must print BUILD OK; verify the built page's
  title, description, H1, JSON-LD (Article + FAQPage + BreadcrumbList), word count, links, and that
  `sitemap.xml` lists it with `<lastmod>`.

## 4. Seed backlog (GUESS until a pull validates it — owner may edit)

- trucking rates by state / freight rates by lane (market-rates query shapes; must not duplicate the hub)
- load board for owner operators
- how to calculate cost per mile for a truck (feeds `cost-per-mile-calculator`, 27 organic sessions / 90 d)
- how owner-operators find their first loads after the new-authority waiting period (check overlap with
  `how-to-get-loads-with-new-authority` first)

## 6. Feed LoadBoot Weekly (set 26 Sep 2026, `bl_comm_0448`)

After the article is published, add it to the weekly email's content pool as DRAFTS — the owner approves them in
CC → Newsletter → Content pool before the engine may pick them. Never insert as `approved`. One SQL statement on
prod (`rwscphuhpjoudvljvmdk`):

```sql
insert into app_private.weekly_content (kind, title, body, url, status, source, note) values
  ('article',      '<article title>', '<one-paragraph blurb, ≤ 220 chars, what the reader gets>', '/<slug>.html', 'draft', 'routine', 'Routine <date>'),
  ('tip_carrier',  null, '<one actionable tip drawn from the article, 1–2 sentences>',            null,           'draft', 'routine', 'Routine <date>'),
  ('tip_carrier',  null, '<a second tip>',                                                        null,           'draft', 'routine', 'Routine <date>'),
  ('compliance',   null, '<one compliance reminder with the real date/rule, only if the article has one>', null,  'draft', 'routine', 'Routine <date>');
```

Rules: tips are one idea the reader can act on this week, no marketing voice, no numbers you did not verify in
§1; `url` is site-relative; skip the compliance row when the article is not about a rule or a date. Log the
inserted count in the §5 row. Docs: `claude/WEEKLY-0448.md`.

## 5. Log (append one row per run; fill re-check results on later runs)

Every run also re-pulls each earlier article at +28 d and +56 d and fills its result column. An article with
0 impressions at +56 d → flag it for URL Inspection in the report.

| Date | URL | Cluster + why (data-picked / seed) | BEFORE: cluster impr / best pos / owner (90 d) | Links in (RELATED) | Re-check +28 d | Re-check +56 d |
|---|---|---|---|---|---|---|

**For page sessions (owned clusters seen by the article run, not written):**

- 2026-09-25 (setup pull): "layover pay" cluster ≈ 620 impr / 90 d at pos 32–48 → `layover-policy.html` (#9,
  window 19 Oct). "how much is detention pay" → `detention-pay-policy.html` (#11). "lumper fee(s)/receipt" →
  `lumper-policy.html` (#12). "full truckload rates", "freight lane rates", "current freight rates" →
  `market-rates.html` (#2) / `truckload-freight-rates.html`.
