# bl_ui_theme (carrier) — carrier portal Light + Dark (15 Oct 2026)

Follows `claude/UI-THEME-LIGHT-FIRST.md` (the dispatcher portal, same day). Same recipe, same tokens
(`app/shared/theme.css`), same `--lbc-x-*` roles. No DB change: the choice lives in localStorage `lb_theme`
(the key the carrier portal already used for its old Off/On/System switch).

## What the carrier sees
- **☀️ / 🌙 button** in the top bar (desktop and phone) flips Light ↔ Dark in one tap.
- **Settings → Appearance → Theme: Light / Dark / System** (was "🌙 Dark mode: Off / On / System" — same values
  `off` / `on` / `system`, so an earlier choice is kept).
- **Default (nothing chosen yet) = Light.** Step 1 (commit "step 1") shipped with `THEME_DEFAULT = 'on'` (Dark) so no
  screen changed; after every screen was checked in both themes on desktop and phone, step 2 set it to `'off'` and gave
  carrier-dark.css `media="not all"` in index.html. To go back to dark-by-default, revert only the step-2 commit.
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

## Checked (15 Oct 2026)
Local Playwright harness with a fake Supabase client and fake data (no real database touched), 1440 px and 390 px:
- Light: Dashboard, Ratings, Load Board, My Loads, Dispatcher, My Profile, Fleet, Finance, Documents, Market Rates,
  Alerts, Support, Safety, Account, Settings, plus the phone drawer, the Post-truck sheet and the load-overview sheet.
  An in-page contrast scan (every visible text node vs its real background) was used to find problems, then fixed.
- Dark vs the code before this change, same data, pixel diff: only the new ☀️ button, the Settings → Theme card,
  native checkboxes (now dark, `color-scheme`), the Emergency fix below, and the sidebar Alerts badge ring (now dark
  on the dark rail). Load-board card order differed only because the fake data is time-based.
- `node --check` on every carrier .js; `python build_site.py` → THEME CONTRAST OK, BUILD OK; tests
  `app_modules_parse`, `carrier_owner_drives_regression`, `onboarding_save_queue`, `dispatcher_gaps_render` pass;
  `carrier_fleet_reminder_regression` fails on the base commit too (pre-existing, not touched).

## Fixed on the way (both themes)
- My Loads → active trip → **🚨 Emergency** was red text on the blue primary button (unreadable in Dark too). It is now
  a ghost button with red text.

## Left as they are (on purpose)
- `trip-map.js` (full-screen navigation map overlays) — dark glass on the map in both themes.
- Shared widgets keep their own colours, as in the dispatcher portal: the Dispatch-preferences card
  (`app/shared/ui/prefs-card.js`, a navy card — also used by CC and the dispatcher workspace), Market Rates
  (`market-widget.js`; its light-grey captions are 2.6:1, pre-existing), the FAQ, chat bubble, WhatsApp button, tour.
- WhatsApp green button with white text (brand colours, 2:1, pre-existing in both themes).

## Revert
Remove the two new `<link>`s in `app/carrier/index.html` and the `id` on carrier-dark.css: every
`var(--lbc-x-*, <literal>)` falls back to its old literal by itself, and carrier-dark.css is always on again.
