# bl_ui_theme (carrier) — carrier portal Light + Dark (15 Oct 2026)

Follows `claude/UI-THEME-LIGHT-FIRST.md` (the dispatcher portal, same day). Same recipe, same tokens
(`app/shared/theme.css`), same `--lbc-x-*` roles. No DB change: the choice lives in localStorage `lb_theme`
(the key the carrier portal already used for its old Off/On/System switch).

## What the carrier sees
- **☀️ / 🌙 button** in the top bar (desktop and phone) flips Light ↔ Dark in one tap.
- **Settings → Appearance → Theme: Light / Dark / System** (was "🌙 Dark mode: Off / On / System" — same values
  `off` / `on` / `system`, so an earlier choice is kept).
- **Default (nothing chosen yet): see `THEME_DEFAULT` in `app/carrier/app.js`.** Step 1 shipped it as `'on'` (Dark), so no
  carrier's screen changed on deploy; step 2 flips it to `'off'` (Light-first) once every screen was checked in both themes.
- Light: navy sidebar (and the navy phone drawer, sign-in backdrop, Decision-Engine hero, Load-Board hero, account
  hero), light workspace, white cards. Dark: the old premium `carrier-dark.css` look.
- Before this, `carrier-dark.css` was always on, so the old "Off" did nothing visible, and a phone set to system-dark got
  the older flat `#0b1220` look from carrier.css. Now Dark is always the premium navy look on every device.
- **Carriers who had explicitly picked "Off" (or "System" on a light phone) before will now get Light** — that is what
  they asked for; it simply works now.

## Files
| File | What |
|---|---|
| `app/carrier/index.html` | `carrier-dark.css` gets `id="lb-dark-css"` (applyTheme switches its `media`), plus links `../agent/agent-theme.css` (shared cp-* light layer + dark fix-up) and `./carrier-theme.css`. |
| `app/carrier/carrier-theme.css` (new) | Carrier light layer: dark **islands** (`.lbc-dark` + `.cp-side`, `.cpx-drawer`, `.cp-auth`, `.cpx-auth-brand`, `.cpx-mhero`, `.cpa-hero`, `.acx .hero`, toasts) reset every role to `initial` so they keep their dark literals; `.cp-auth-card` / `.lbc-light` turn roles back on (white sign-in card on the navy backdrop). Dark fix-up for carrier-only selectors (`.cpx-chip`, `.cpx-banner`, `.cpx-tabpick`, `.cpx-seg`, `.cpx-adv`…). |
| `app/carrier/app.js` | `THEME_DEFAULT` per portal; `applyTheme()` now also paints every `.lb-theme-btn` / `.lb-theme-seg` and sets `theme-color` for both portals; `themeToggleBtn()` + `themeSeg()` shared by both portals (the dispatcher's inline copies were replaced). Carrier top bar gets the button; carrier Settings gets the Light/Dark/System segment. |
| `app/carrier/*.js` (all but `trip-map.js`) + carrier part of `app.js` | ~750 inline colour literals → `var(--lbc-x-<role>, <old literal>)` (CSS declarations and bare quoted literals used for text colour). |
| `app/carrier/carrier.css` | ~60 dark-designed literals (driver access `da-*`, role picker, driver mode `dm-*`, misc) → same `var()` form. Island classes were left as they are. |

`trip-map.js` (full-screen navigation map) was left dark on purpose: its glass panels sit on the map, not on the page.

## How the conversion was done (so it can be repeated)
Roles exist only in Light (`agent-theme.css` defines them on `html[data-lbtheme="light"]`), so in Dark every
`var(--lbc-x-ok,#4ade80)` falls back to the exact old literal. Classified by property + colour:
- text (`color`): near-white → `ink`, light grey → `ink2`, mid grey → `ink3`, greens → `ok`, ambers → `gold`,
  reds → `danger`, oranges → `warn`, blues → `link`, violets → `violet`.
  White text on a solid/saturated fill (blue/orange/green buttons, `background:' + colour + '`) was left `#fff`.
- `background`: `rgba(255,255,255,≤.25)` and dark translucent panels → `panel`; dark solids (`#111c31`, `#0b1220`…)
  → `field`; all-navy gradients → `hero` (white→#F1F5FB). Brand gradients with a saturated stop stay (islands).
- borders: `rgba(255,255,255,≤.3)` / navy solids → `line`.
- Hex-alpha concatenation (`colour + '55'`) became `color-mix(in srgb, <colour> 33%, transparent)`; SVG
  `stroke="…"` / `fill="…"` attributes that now carry a `var()` moved into `style="stroke:…"` (presentation
  attributes do not accept `var()`).

## Checked
See SESSION-CHANGELOG for the run. Local Playwright harness with a fake Supabase client (no real database touched),
1440 px and 390 px, both themes, every carrier tab; Dark compared pixel-by-pixel with the code before this change.

## Revert
Remove the two new `<link>`s in `app/carrier/index.html` and the `id` on carrier-dark.css: every
`var(--lbc-x-*, <literal>)` falls back to its old literal by itself, and carrier-dark.css is always on again.
