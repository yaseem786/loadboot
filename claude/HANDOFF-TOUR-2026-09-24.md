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

## Done (branch `claude/sweet-albattani-glr8gy`, 24 Sep 2026, second session) — steps 1 + 2
- Preview approved as is. Engine branch merged in (fast-forward), then wired: `index.html` links `tour.css`;
  `app.js` creates the tour after the shell mounts, `help.onRoute(tab)` in `go()`, `autoStart()` 500 ms after the
  first `go(tab)`. Role = owner / driver / dispatcher (driver with `loads.view_board`). Skipped on the agent shell
  (`window.__LB_AGENT`). Shared icon set, not the carrier `ic()` (it lacks `chev`/`handshake`).
- All 13 `data-tour` hooks placed (11 in `app.js`, `disp-hero` on all six `dd-hero` branches, `today` on the driver hero).
- Not yet run against a live login (cloud session, no Supabase session). Owner: open the carrier app in a fresh
  profile / clear `lb_tour.carrier.v1` in localStorage and walk the owner flow once; `window.__lbTour.start()` replays.

## Waiting on owner
- Merge `claude/amazing-mendel-nri5hm` into `main` (GitHub Desktop) — it carries steps 1+2 (`sweet-albattani`) and step 3 — then do the live walks (carrier above, four portals below).

## Next step, exactly
1. (done) Wire into `app/carrier`: link `../shared/ui/tour.css` in `index.html`; in `app.js` `appView()`
   right after `root.setAttribute('aria-busy','false')` (≈line 2516):
   `import { createTour, mountHelp } from '../shared/ui/tour.js'; import { CARRIER_TOUR } from './tour-content.js';`
   `const tour = createTour({ key:'carrier', version:1, role: DRV ? (DRV.perms includes loads.view_board ? 'dispatcher' : 'driver') : 'owner', flows: CARRIER_TOUR.flows, screens: CARRIER_TOUR.screens, navigate: go, currentRoute: () => tab, icon });`
   `const help = mountHelp(tour, { supportRoute:'#support', navigate: go }); tour.autoStart();`
   and call `help.onRoute(tab)` inside `go()`.
2. (done) Add `data-tour` hooks in the views: `dash-kpis`, `dash-setup` (loadDashboard ≈3399), `loads-list`,
   `loads-filters`, `loads-post` (loadLoads ≈4016), `trips-list`, `trip-actions`, `trip-pod` (loadTrips ≈5052),
   `docs-list` (loadDocuments ≈7518), `fin-summary` (loadFinance ≈6678), `fleet-list` (loadFleet),
   `disp-hero` (dispatcher-desk.js `.dd-hero`), `today` (driver-mode.js renderToday).
3. Same engine for partner / agent portals: only a `tour-content.js` per portal.

## Done (branch `claude/amazing-mendel-nri5hm`, 25 Sep 2026, third session) — step 3: partner, agent, investor, developer
Branch = `claude/sweet-albattani-glr8gy` merged in + step 3 on top. **Merge `claude/amazing-mendel-nri5hm` into `main`** (it
contains everything from steps 1-3). Command Center untouched, as decided.

| Portal | Content file | Key / roles | Stops | Wired in |
|---|---|---|---|---|
| Partner (`app/partner/`) | `tour-content.js` | `partner` / `broker`, `shipper` (from `ov.kind`) | 10 / 9 | `app.js` `tourBoot()` after `bgo(btab)`, booted only when `isMyOrgAgent()` is false (agent slim workspace skips it); `pHelp.onRoute(btab)` in `bgo()` |
| Agent (`app/agent/`) | `tour-content.js` | `agent` / `dispatcher`, `referral`, `both` (from `refOnly` / `optedIn`; `noTrack` = no tour until a track is picked) | 10 / 9 / 17 (dispatcher stops mostly `optional`) | `app/carrier/app.js` `agentPortal()` end: dynamic `import('../agent/tour-content.js')`, `agHelp.onRoute(tab)` in the agent `go()`. The carrier shell's own `if (!window.__LB_AGENT)` block is unchanged (agents never reach it). |
| Investor (`app/investor/`) | `tour-content.js` | `investor` / `investor` | 6 | `app.js` `tourSync()` called at the end of `renderShell()`; created once, only when `S.agr.signed_date` is set (unsigned = agreement sheet, no tour). Sets `data-lbtheme=dark` on `<html>` if unset so the coach card uses dark tokens. English only (the portal is trilingual; tour copy is not). |
| Developer (`app/developer/`) | `tour-content.js` | `developer` / `developer` | 6 | `app.js` after the shell mounts; single screen, `navigate` no-op |

Hooks placed (all `data-tour=`): partner `dash-kpis post-load loads-list requests carriers packet invoices rates`;
agent `disp-apply disp-status disp-steps disp-rules disp-academy` (carrier/app.js, via `agCard(title, kids, tourName)` third arg or
`tourTag(el, name)`), `earnings payouts` (carrier/app.js), `ref-link ref-kpis ref-list` (referral-home.js), `dw-tabs dw-kpis dw-queue`
(dispatcher-workspace.js); investor `rec-hero rec-list ledger-hero pay-declare pay-list agr-card`; developer `dev-create dev-keys
dev-quickstart dev-webhooks dev-events`. `tour.css` linked in all four `index.html`.

Phone fixes, 25 Sep 2026 (owner tested on Android): compact coach card on phones (desktop unchanged); header height is
measured (`topInset()`), not assumed; title colour pinned (carrier-dark.css whitened every h3); the carrier "favorite lanes"
micro-ask waits while the tour is running/unseen; a 250 ms position watch follows a target that moves without a scroll event.
**Screen changes:** after navigation the engine waits up to 7 s for the target, shows the card at 1.2 s with "Opening this
screen…", and spotlights the view's empty state when the step has `emptyTarget` (carrier: `loads-empty`, `trips-empty`).
If the real target renders later, the stop re-shows on it.

Engine lesson (matters for any new stop): **`anchor` defeats `optional` and `emptyTitle`** — when the hook is missing the engine falls
back to the anchor and shows the normal copy. So optional / empty-copy stops carry NO anchor (same as the carrier file).

Checks run: `node --check` on every edited file; content->view hook cross-check both ways; `previews/tour-smoke/` (stub page + Playwright
`run.mjs`, usage in its header) drives all 10 flows through the real engine to their done card, with and without hooks: 0 errors.
Not run against a live login (cloud session). Owner: clear `lb_tour.partner.v1` / `lb_tour.agent.v1` / `lb_tour.investor.v1` /
`lb_tour.developer.v1` in localStorage (or `window.__lbTour.reset(); window.__lbTour.start()`) and walk each once.

## Step 3 handoff — every portal except Command Center (owner decision, 25 Sep 2026) — DONE above, kept for reference

Branch to work on: `claude/sweet-albattani-glr8gy` (already carries steps 1+2). Do NOT touch `main`.
Owner approved the carrier copy as is; keep the same tone (plain English, no jargon, 6–11 stops per role).
Do not change the money claims: 5% of linehaul, 100% accessorial pass-through, 30-day expiry warning.

**Engine contract** (read the header of `app/shared/ui/tour.js`, 20 lines — that is all you need):
`createTour({ key, version:1, role, flows:{<role>:[stops]}, screens:{<tab>:{title,tips[]}}, navigate, currentRoute })`,
`mountHelp(tour, { supportRoute, navigate })`, `help.onRoute(tab)` on every route change, `tour.autoStart()` after first paint.
`navigate` receives `'#tab'` — strip the `#` before calling the portal's `go()` (see carrier `tourNav`).
A stop with a missing `target` is skipped when `optional:true`, or shows `emptyTitle/emptyText` centred. Copy `app/carrier/tour-content.js`
as the template; use shared icon names (`grid, search, filter, truck, route, doc, dollar, users, bell, chat, shield, upload, check, alert, handshake`).

**a) Partner portal (`app/partner/`) — broker and shipper.** Own shell, own `app.js`.
- `index.html`: add `<link rel="stylesheet" href="../shared/ui/tour.css">` after `partner-premium.css` (line 20).
- `app.js`: shell mounts at ≈5136 (`mount(root, bShell)` … `bgo(btab)` … `root.setAttribute('aria-busy','false')`).
  Route fn is `bgo(id)`, current tab is `btab`, org kind is `ov.kind` (`'broker'` | `'shipper'`), `window.__lbKindLabel` also set at ≈1850.
  Roles: `broker`, `shipper`. Key `'partner'`. Call `help.onRoute(btab)` inside `bgo()`. autoStart after `bgo(btab)`.
  An agent org can land in the partner shell as the "agent slim workspace" (`isMyOrgAgent()`, ≈5142) — skip the tour there, the agent portal owns it.
- Write `app/partner/tour-content.js` with `PARTNER_TOUR = { flows:{ broker, shipper }, screens }`. Find the tabs from the partner `NAV`
  (grep `NAV = [` / `bgo(`) and hook the same way: post-a-load form, my loads list, carrier packet / trust card, invoices, settings.
  Hooks: `data-tour="post-load"`, `loads-list`, `packet`, `carriers`, `invoices` (pick from the real view functions; `optional:true` for anything gated).

**b) Agent portal (`app/agent/`) — dispatcher and referral.** Reuses the CARRIER shell: `app/agent/index.html` loads `../carrier/app.js`
  with `window.__LB_AGENT=1`. The carrier wiring at `app/carrier/app.js` ≈2525 currently does `if (!window.__LB_AGENT)` → replace that
  with: agent → `import('./../agent/tour-content.js')` (or a static import) and `key:'agent'`, role from the agent intent
  (`AGINTENT` ≈579–604: `'referral'` vs dispatcher), flows `dispatcher` / `referral`. Screens live in `app/agent/dispatcher-workspace.js`,
  `dispatcher-gaps.js`, `referral-home.js`, `skills-test.js`; add `data-tour` hooks there. `index.html`: add the `tour.css` link after
  `carrier-dark.css` (line 18).

**c) Investor (`app/investor/`) and developer (`app/developer/`) portals** — small lanes; do them last, 4–5 stops each, same pattern, keys
  `'investor'` / `'developer'`. Skip if the owner says they are not worth it.

**Not in scope:** Command Center (`app/command-center/`) — owner said no tour there.

**Check before pushing:** `node --check` every edited file; every `data-tour` name in a content file must exist in a view (grep both ways);
autoStart only after the first paint. Then update this doc.
4. Optional later: server-side "tour done" flag on the profile so a new phone remembers.

## Do not
- Do not touch `main` from the cloud session (owner merges via GitHub Desktop).
- Do not change copy claims: 5% of linehaul, 100% accessorial pass-through, 30-day expiry warning.
