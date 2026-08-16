# Responsive + UX sweep — 2026-08-16

Owner brief: mobile/tablet fixes across app + marketing site ("screens fit nahi hoti"),
in-app quick signup (no marketing redirect), chat button overlapping the bottom nav,
duplicate get-started page audit. Standard: Amazon/Uber polish.

## How it was measured

Automated Playwright audit at 360×800, 390×844 (phone) and 768×1024 (tablet) across all
90 built marketing pages plus every carrier/partner/agent portal route (logged in against
staging). A page fails if `scrollWidth > clientWidth` (horizontal pan / mobile zoom-out).

Before: **108 of 270** marketing page-checks failed. After: **0 of 270**.
Portals: carrier (12 routes), partner (10), agent (5) × phone+tablet — all clean, and the
chat FAB verified 12px above the bottom nav on every route.

## What was wrong + the fixes (all additive)

1. `build_site.py` → new `RESP_CSS` block appended to styles.css:
   - `html{overflow-x:clip}` — no page can pan/zoom-out sideways again (safety net).
   - Article pages (`.art-grid`) rendered at 768px wide on phones: grid children carried a
     min-content floor (`1fr` = `minmax(auto,1fr)`); fixed with `min-width:0` on grid
     children (same class of bug in footer `.foot-top`, about-page hero, route grids).
   - Comparison/data tables (`.cmp`, `.accx-cmp`, `.ftx-cmp`, `.mr-t`, article tables) were
     cut off — now swipe-scrollable below 880px.
   - Footer newsletter form / call row overflowed +23px on every page — now wrap.
   - Inline-styled `repeat(4,1fr)` / `repeat(3,1fr)` / `1fr 1fr` grids (load-board role
     strip, resources/brokers mock cards, etc.) never collapsed because inline styles beat
     the class media queries — attribute-selector overrides collapse them on phones only.
   - Get-started hub CTA (`white-space:nowrap`) and `.mcta` box-sizing fixed.

2. `app/shared/ui/liveChatCore.js` — chat FAB overlap fix. The old code checked for a tab
   bar once at mount +1.5s, but portals render the bar only after login, so the FAB sat on
   top of it. Now the widget measures the real bar (`.cp-tabbar/.lb-tabbar/#bTabbar/.mcta`
   — the last one is the marketing mobile CTA bar, same bug there), repositions on resize/
   hashchange/DOM mutations, and moves the panel + teaser bubble up with it.

3. In-app signup (no more marketing redirect):
   - `app/index.html` chooser: "Create an account" now opens an in-app "Who are you?"
     sheet (carrier / freight / dispatch-refer) instead of linking to get-started.html.
   - `app/carrier/app.js` + `app/partner/app.js`: `#signup` deep link opens the auth
     screen directly in create-account mode (works for /app/agent/ too via the shared
     carrier bundle). Play-reviewer friendly: the whole signup stays inside the app scope.

## Get-started duplicate audit (finding, no change shipped)

- `get-started.html` is the ONLY signup hub — no duplicate hub exists.
- The 4 `create-*-account.html` pages are intentional per-role SEO landing pages
  (distinct titles/canonicals/content) — not duplicates.
- The one real overlap: `carrier-application.html` ("Apply to Loadboot" lead form,
  linked from 21 pages) vs `create-carrier-account.html` (self-serve signup). Both target
  carriers. Left untouched — the application form feeds the CC forms/leads engine
  (assisted funnel) while create-carrier-account is the self-serve funnel. If ever
  consolidated, keep the form and cross-link, don't 301 blindly.

## Verify after deploy

`python build_site.py` → serve `/site` → Chrome DevTools device mode at 360/390/768 on:
index, pricing, get-started, load-board, resources, market-rates, any *-policy page, any
blog article, /app/ chooser, /app/carrier/ (login + logged in). No horizontal scroll
anywhere; chat bubble must sit above the bottom nav / CTA bar.
