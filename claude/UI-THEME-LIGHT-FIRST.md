# bl_ui_theme — dispatcher portal light-first + dark toggle (15 Oct 2026)

Brief: `claude/BL-UI-THEME-BRIEF.md` (section A came through complete; the paste cut off at B). The owner said on
15 Oct "colour khud fill kar lo", so the colours and the rest of B were decided in this session. Branch:
`claude/lucid-sagan-a4aggq`. No DB change: no per-user prefs column exists (`agent_profiles` has only `network` /
`payout_details` jsonb), so the choice lives in localStorage `lb_theme_agent`.

## What the dispatcher sees
- Opens **light**: navy sidebar (`#10223B`), light workspace (`#F5F7FA` page, white cards).
- **☀️ / 🌙 button** in the top bar flips Light ↔ Dark. **Settings → Appearance**: Light / Dark / System.
- Dark keeps the old look (the premium `carrier-dark.css` navy). Compared pixel by pixel with the old code at
  1440 px, the only differences are the new ☀️ button and native file inputs, which now render dark (`color-scheme`).
- The message thread follows the theme (it was always dark before).
- Phones: the bottom bar, the More sheet and the hamburger drawer are all light in Light mode. The desktop sidebar
  stays navy. The phone drawer is light as well; ask if it should be navy too.

## Files
| File | What |
|---|---|
| `app/shared/theme.css` | Semantic tokens, light on `:root`, dark on `html[data-lbtheme="dark"]`. Prefix **`--lbc-`**, because `--lb-*` (tokens.css), `--lbt-*` (tour.css) and bare `--border/--text/--ok` already mean other things. Linked by both portals; it only defines variables and paints nothing. |
| `tools/theme-contrast-check.mjs` | Checks every pair listed in theme.css's `contrast-pairs` comment, in both themes, against WCAG AA 4.5:1, and rejects pure #FFF/#000 text tokens. `build_site.py` runs it first and refuses the build on a failure (skipped only if node is missing). It currently passes 46 pairs. |
| `app/agent/agent-theme.css` | Light layer (`html[data-lbtheme="light"]`): navy rail, light shell, light values for the workspace's `--dw-*` and the carrier picker's `--line/--panel/--ink/--mut/--blue` variables, plus the `--lbc-x-*` roles below. Also a dark fix-up section: carrier.css has older `html[data-lbtheme=dark]` rules (flat #0b1220) that out-rank carrier-dark.css, so it re-applies carrier-dark's values 1:1. |
| `app/agent/index.html` | Links theme.css + agent-theme.css. `carrier-dark.css` now has `id="lb-dark-css" media="not all"`, so it is off until Dark is chosen. |
| `app/carrier/app.js` | `applyTheme()`: the agent portal uses key `lb_theme_agent`, default `off` (light), and toggles `#lb-dark-css`. Adds the top-bar button and the Settings → Appearance card (agent portal only). The carrier portal keeps key `lb_theme` and its default, and its carrier-dark link has no id, so **nothing changes there**. |
| `app/agent/*.js` + `agentPortal()` in `app/carrier/app.js` | ~540 inline colour literals are now `var(--lbc-x-<role>, <old literal>)`. |
| `app/carrier/index.html` | Links theme.css (tokens only; "carrier portal second" is still to do). |

## How the inline colours work
The `--lbc-x-*` roles are defined **only in light**. In dark every `var(--lbc-x-ok,#4ade80)` falls back to its exact
old literal, which is why dark did not move. Roles map to AA-checked tokens:
`ink/ink2/ink3` → text / text-2 / text-3; `ok/gold/danger/warn/link` → *-text tokens; `panel` → surface-2,
`line` → border, `field` → surface, `hero` (old navy gradients) → a white-to-#F1F5FB gradient, `violet` → #6D28D9.
White text on a blue/orange/green fill was left as `#fff`. The status pill's `color + '55'` hex-alpha border became
`color-mix(in srgb, <colour> 33%, transparent)`, which looks the same in dark.

## Colours chosen (brief values that failed AA were changed for TEXT only; fills and badges keep the brand hexes)
| Token | Light | Dark | Why |
|---|---|---|---|
| `--lbc-text-3` | `#5F6B7A` (brief #7B8794 = 3.41:1) | `#8C98A8` (brief = 4.29:1) | AA |
| `--lbc-accent-strong` / `--lbc-accent-text` | `#0868C9` / `#F8FAFC` | same | White on #0883F7 = 3.75:1. Primary fill + link text. |
| `--lbc-link` | `#0868C9` | `#6CB6FA` | |
| `--lbc-warn-text` / `--lbc-on-warn` | `#B53F04` / `#10223B` on `#FC5305` | `#FF8A4C` | #FC5305 text on white = 3.29:1 |
| `--lbc-ok-text`, `--lbc-danger-text`, `--lbc-gold-text` | `#166534`, `#B91C1C`, `#92400E` | `#4ADE80`, `#F87171`, `#FBBF24` | |

## Checked
`node tools/theme-contrast-check.mjs` → 46/46 AA. `node --check` + esbuild on every edited .js.
`python build_site.py` → THEME CONTRAST OK, BUILD OK. Tests: `dispatcher_gaps_render_test` 4/4, `app_modules_parse_test`
(with `--experimental-vm-modules`) pass; `carrier_fleet_reminder_regression_test` fails on the base commit too
(pre-existing, not touched). Visual: a local Playwright harness with a fake Supabase (no real database touched)
checked Today, Board, Trucks, Bookings, Brokers, Money, Messages, Packet, My KPIs, Referral, My Referrals, Earnings,
Payouts, Verification and Settings, at 1440 px and 390 px, in both themes.

## Not done / next
- Carrier portal light-first ("second" in the brief): the same recipe applies to the rest of `app/carrier/app.js`.
- `app/shared/*` widgets inside the agent portal (chat bubble, dialer, dmail, tour) keep their own colours.
- Revert: remove the two `<link>`s in `app/agent/index.html` and the `media` attribute. The `var(--lbc-x-*,<literal>)`
  calls then fall back to their old literals by themselves.
