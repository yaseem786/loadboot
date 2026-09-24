# Handoff — guided tour (carrier portal first), 24 Sep 2026

Paste this into the next session.

## Done (branch `claude/quirky-heisenberg-sbw0qd`, cloud session)
- `app/shared/ui/tour.js` + `tour.css` — shared engine: spotlight veil (outside clicks blocked),
  auto-placed coach card (bottom sheet on phones, swipe left/right = next/back), auto-navigation
  between screens, role flows, progress in localStorage (`lb_tour.<key>.v<n>`), floating `?` help
  (replay, per-screen guide, quick tips, support link), one-time "New here?" nudge per screen,
  keyboard + focus trap, reduced motion, dark tokens (`html[data-lbtheme=dark]`).
  Missing target: `optional:true` drops the stop; `emptyTitle/emptyText` shows centred copy instead.
  `target` = precise hooks (`[data-tour=…]`), `anchor` = generic fallback for placement only.
- `app/carrier/tour-content.js` — owner (11 stops), driver (6), dispatcher (8) + tips for 12 screens.
- `previews/tour-preview/` — clickable preview (real carrier CSS + real engine on a mocked shell).
  Live: https://claude.ai/artifact/BgNH6pKme7C6sp86i7fwgm  (Role / Device / Data: Sample|Empty / Theme).
  `sync-lib.sh` copies engine+CSS into `lib/` (git-ignored) for local opening.

## Waiting on owner
- Preview approval (copy, order, colours). Nothing is wired into the live app yet.

## Next step, exactly
1. Wire into `app/carrier`: link `../shared/ui/tour.css` in `index.html`; in `app.js` `appView()`
   right after `root.setAttribute('aria-busy','false')` (≈line 2516):
   `import { createTour, mountHelp } from '../shared/ui/tour.js'; import { CARRIER_TOUR } from './tour-content.js';`
   `const tour = createTour({ key:'carrier', version:1, role: DRV ? (DRV.perms includes loads.view_board ? 'dispatcher' : 'driver') : 'owner', flows: CARRIER_TOUR.flows, screens: CARRIER_TOUR.screens, navigate: go, currentRoute: () => tab, icon });`
   `const help = mountHelp(tour, { supportRoute:'#support', navigate: go }); tour.autoStart();`
   and call `help.onRoute(tab)` inside `go()`.
2. Add `data-tour` hooks in the views: `dash-kpis`, `dash-setup` (loadDashboard ≈3399), `loads-list`,
   `loads-filters`, `loads-post` (loadLoads ≈4016), `trips-list`, `trip-actions`, `trip-pod` (loadTrips ≈5052),
   `docs-list` (loadDocuments ≈7518), `fin-summary` (loadFinance ≈6678), `fleet-list` (loadFleet),
   `disp-hero` (dispatcher-desk.js `.dd-hero`), `today` (driver-mode.js renderToday).
3. Same engine for partner / agent portals: only a `tour-content.js` per portal.
4. Optional later: server-side "tour done" flag on the profile so a new phone remembers.

## Do not
- Do not touch `main` from the cloud session (owner merges via GitHub Desktop).
- Do not change copy claims: 5% of linehaul, 100% accessorial pass-through, 30-day expiry warning.
