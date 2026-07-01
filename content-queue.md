# Loadboot — Article Queue (for the auto-writer)

The scheduled writer picks the **first item with status `TODO`**, writes it as a full
premium `rich_article()` in `build_site.py` (same pattern as the cost & vs-broker posts),
rebuilds, commits, and marks it `DONE` here.

Rules every article must follow (no exceptions):
- Premium `rich_article()` layout: hero + sticky TOC + breadcrumb + author box + FAQ.
- 1500–2500 words, original, expert, specific (no filler).
- At least 1 custom on-brand SVG diagram/infographic + 1 feat hero SVG.
- 2–3 in-article service banners (`svc_banner`) redirecting to our service pages.
- 2+ outbound authoritative links (FMCSA / gov / industry) with rel="nofollow".
- Article + BreadcrumbList + FAQPage schema (auto via rich_article).
- A premium thumbnail in `THUMBS` + a `blog_card`/`READTIME` entry + `PREMIUM_ARTICLES` skip.
- Add a 1-line hero-photo brief in the PR/commit so Yaseen can optionally drop a real photo.

Cadence: 3–4 per week (e.g. Mon / Wed / Fri). Never publish more than one per run.

| # | Status | Slug / file | Title | Primary keyword |
|---|--------|-------------|-------|-----------------|
| 1 | DONE | how-much-does-a-truck-dispatcher-cost.html | How Much Does a Truck Dispatcher Cost in 2026? | how much do truck dispatchers charge |
| 2 | DONE | truck-dispatcher-vs-freight-broker.html | Truck Dispatcher vs Freight Broker vs Factoring | dispatcher vs broker |
| 3 | DONE | how-to-find-a-good-truck-dispatcher.html | How to Find a Good Truck Dispatcher (Checklist) | how to find a truck dispatcher |
| 4 | DONE | owner-operator-dispatch-service-guide.html | Owner-Operator Dispatch Service: Complete Guide | owner operator dispatch service |
| 5 | TODO | truck-dispatcher-in-texas.html | Truck Dispatcher in Texas (local money-page) | truck dispatcher texas |
| 6 | TODO | do-new-authority-carriers-need-a-dispatcher.html | Do New-Authority Carriers Need a Dispatcher? | new authority dispatcher |
| 7 | TODO | how-to-read-a-rate-confirmation.html | How to Read a Rate Confirmation | rate confirmation explained |
| 8 | TODO | truck-dispatcher-in-california.html | Truck Dispatcher in California (local money-page) | truck dispatcher california |
| 9 | TODO | how-to-avoid-cheap-freight.html | How to Avoid Cheap Freight | avoid cheap freight |
| 10 | TODO | truck-dispatcher-in-georgia.html | Truck Dispatcher in Georgia / Florida (local) | truck dispatcher georgia |

After the last TODO is done, add new long-tail topics (equipment + state pages) rather than stopping.
