# Dispatch-OS repositioning — keyword map, BEFORE rows and re-check plan (25 Sep 2026)

Executes `docs/MARKETING-REPOSITION-PLAN-2026-09-24.md` in one pass (owner decision, 25 Sep: "sara ka sara plan execute karo").
This file is the measurement record the weekly SEO rounds and the Phase 2 SEO session (`docs/seo-audit-2026-10/LEDGER.md`,
branch `claude/pensive-wozniak-5uxqi9`) need so nobody re-edits these pages inside their 28-day window.

**Rules kept:** no URL changed, no title changed on any page that ranks, no redirect. Homepage title unchanged.
**Rule overridden by the owner:** "one page per session" — this pass touched the pages below in one commit.
**Re-check date for everything below: 2026-10-23** (28 days). Revert line as in the playbook: impressions −15 % or position +5 worse on the page's head query.

## 1. BEFORE rows (R10 window 2026-08-22 → 09-19, from `docs/seo/WEEKLY-LOG.md`; "pull" = not in the log, pull before the re-check)

| Page | 28 d clicks / impr / pos | Head queries (impr @ pos) | Title | What changed on 25 Sep |
|---|---|---|---|---|
| `index.html` | 55 / 330 / 6.2 (16.7 % CTR, mostly brand) | loadboot · load boot · carrier desk login | **unchanged** | H1 tail "& a Load Board With Zero Ghosts" → "& a Verified Load Board, on One Platform" (both head phrases kept); lead; meta description; ROUTE block replaced by the 8-step strip; three-layer and eight-role sections added; FAQ fee/contract/"who is my dispatcher" rewritten; promise copy |
| `services.html` | pull | truck dispatch services | unchanged | hero lead; who-does-what columns; full 8-step strip; stat band; meta description |
| `pricing.html` | pull (ledger #14) | dispatch pricing / 5 % | unchanged | "5 % of gross" → "5 % of line-haul" everywhere; includes list; two FAQs; meta description |
| `power-only-dispatch.html` | 0 / 115 / 71.3 (ledger #18, "content rewrite") | power only dispatch services 42 @ 78.6 | unchanged | template: equipment-specific 4-step strip + real process steps + hub links (all svc pages) |
| `dry-van-dispatch.html` | 0 / 169 / 51.7 (ledger #19) | dry van dispatch services 52 @ 66 · dry van dispatcher 25 @ 39.7 | unchanged | same template change |
| `flatbed-dispatch.html` | 0 / 102 / 35.0 — **R9 edit 09-18, window open until 16 Oct** | flatbed dispatch services 25 @ 29.9 | unchanged | same template change (body only; the R9 title edit is untouched — read both effects at the re-check) |
| `owner-operator-dispatch.html` | 2 / 83 / 33.1 — **LOCKED** (growing) | owner operator dispatch services 53 @ 51 | unchanged | template change only (body); related cards gained the two hub links. If clicks stop growing at the re-check, attribute to this pass first |
| `reefer/hotshot/box-truck/new-authority/otr/regional/local` dispatch pages | pull | equipment + "dispatch services" | unchanged | same template change |
| `how-it-works.html` | pull | how loadboot works (brand) | unchanged | fifth lane "carrier with a LoadBoot dispatcher" + FAQ + meta |
| `about.html` | pull | brand | unchanged | dispatcher bullets; three-layer + roles sections; FAQ definition |
| `us-truck-dispatcher.html` | pull (ledger #23) | truck dispatcher (US) | unchanged | hero lead; 8-step strip; card copy; FAQ wording |
| `careers.html` | small, top-10 brand | become a truck dispatcher | unchanged | "own DAT/Truckstop login" → the 21 Sep rule (three spots + JobPosting) |
| `apps.html` | pull | loadboot app | unchanged | MobileApplication schema; Agent card copy |
| `load-score.html`, `create-*-account.html`, accessorial policy pages | pull | — | unchanged | HowTo JSON-LD removed (retired rich result); FAQ markup kept |
| every page | — | — | — | global `Organization` JSON-LD (`@id https://loadboot.com/#org`, sameAs LinkedIn + Play); `ProfessionalService.description` rewritten; footer "Dispatch" group now deep-links the hub pages; mega-menu gained 3 links |

## 2. New URLs (additive; each owns one intent — no cannibalisation with the rows above)

| URL | Intent / target phrases (GUESS until GSC shows ≥ 20 impressions — per the Phase 2 ground rule) | Schema | Inbound links at build |
|---|---|---|---|
| `how-loadboot-dispatch-works.html` | how does a truck dispatcher work · what does a truck dispatcher do for owner operators · how truck dispatch works | Article + FAQPage + Breadcrumb | footer (every page), mega-menu, related cards on 23 dispatch-cluster pages, home strip, equipment strips |
| `dedicated-truck-dispatcher.html` | dedicated truck dispatcher · find a truck dispatcher · hire a truck dispatcher for owner operator | Service (offer: flat 5 %) + FAQPage + Breadcrumb | same |
| `ai-dispatch-for-owner-operators.html` | AI truck dispatcher · AI dispatch trucking · AI dispatch for owner operators | Article + FAQPage | footer, related cards |
| `truck-dispatcher-vs-dispatch-software.html` | truck dispatcher vs dispatch software · TMS for owner operators · dispatch software for owner operators | Article + FAQPage | footer, related cards |
| `broker-agents.html` | freight broker agent load board · post loads as a broker agent · broker agent software | Service (offer: $0) + FAQPage | mega-menu, brokers.html related, agents.html related, roles strip |

Expectation, stated plainly: tens of impressions per month each for the first 4–12 weeks. Their first job is internal-link context for the "dispatcher" entity on the ranking pages; their second job is conversion. Do not judge them on clicks before 2026-11-20 (8 weeks).

## 3. What to read at the re-check (2026-10-23)

1. `query,page` pull at rowLimit 5000 (the R10 recipe). For each row in §1: clicks / impr / pos vs the BEFORE column.
2. Homepage: non-brand impressions and position on "truck dispatch" / "load board" shapes. If non-brand impressions fall > 20 %, restore the old H1 tail (one line in `build_site.py`, anchor `Verified Load Board, on One Platform`). Brand clicks are not the signal.
3. Dispatch cluster (power-only, dry van, flatbed, owner-operator): position on the head query. The bet is that content, not titles, was holding these at pos 35–78. If two rounds show no movement, the next lever is the per-page rewrite the Phase 2 ledger already queues (eligibility, first-week flow, proof) — not more template.
4. New URLs: indexed (GSC URL inspect) and any impressions at all. Not indexed after 4 weeks → check they are in `sitemap.xml` (they are, 136 URLs at build) and request indexing.
5. `apps.html`: does the MobileApplication rich result render (Search Console → Enhancements)? No aggregateRating was added on purpose; add it only from real Play reviews.

## 4. Overlap notice for the other sessions

- `claude/pensive-wozniak-5uxqi9` (SEO Phase 2, Session 0): its ledger queues `pricing.html` (#14), `carriers.html` (#16), `power-only-dispatch.html` (#18), `dry-van-dispatch.html` (#19), `us-truck-dispatcher.html` (#23). **All of those changed in this pass on 25 Sep.** Their next Phase 2 session must take a fresh BEFORE row and treat 2026-10-23 as the earliest edit date, not "now". Its `build_site.py` edits (`_SITEMAP_EXCLUDE` + `referral.html`, `unsub.html` noindex header) do not conflict with this branch line-for-line.
- `claude/dazzling-dijkstra-bx4k0y` (marketing UX pass M1–M7): touches the footer "Company → Contact" heading line, the PWA banner JS and adds `UX_CSS`/`UX_JS`. This branch edits the footer **Dispatch** link group (a different line) and nothing in the PWA/UX blocks. Expect a clean merge; if git reports a conflict in `footer()`, keep both.
- `carriers.html` (ledger #16) was **not** edited here beyond its related-cards list.
