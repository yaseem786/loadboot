# bl_ui_theme — brief as recovered (15 Oct 2026)

Recovered verbatim from the owner's message in session `bl_disp_0552 carrier redaction` (15 Oct, 17:21 UTC).
**The original paste was cut off there** — it ends at "B) DISPATCHER PORTAL — replace hard-coded colors with tokens / -".
Sections A and the header are complete; everything from B's bullets onward was never received. Branch: the owner
agreed 15 Oct to work on `claude/lucid-sagan-a4aggq` instead of `claude/dispatcher-light-theme`.

---

TASK bl_ui_theme: Light-first theme + dark toggle for the DISPATCHER portal (app/agent/*), carrier portal second.

WHY: research (NN/g, Cloudscape/AWS) — light mode is the default for long-hours work tools, dark is a user choice. The
dispatcher portal is dark-only today. Keep the navy brand on the sidebar; the workspace becomes light.

RULES: branch claude/dispatcher-light-theme. Additive and reversible — nothing in the DOM structure, RPCs or business
logic changes; this is tokens + CSS + a toggle. No DB migration unless a per-user preference column is truly missing
(check first; else store in localStorage AND, if a profile prefs jsonb exists, mirror it there). Mobile-responsive.
node --check AND esbuild on every edited .js, python build_site.py → BUILD OK. Commit + push; Yaseen merges.

READ FIRST: docs/brand-kit/loadboot-tokens.css, app/agent/dispatcher-workspace.js (all inline styles and the dw-* CSS
block), app/agent/*.css, app/shared/training-banner.js, app/shared/ui/*, app/carrier/carrier.css + carrier-dark.css
(how the carrier portal already does dark), and the existing side rail / top bar (.cp-top, .cp-rail).

A) TOKENS (app/shared/theme.css, imported by both portals)
Define semantic CSS variables on :root (light) and [data-theme="dark"]:
- Light: --bg #F5F7FA, --surface #FFFFFF, --surface-2 #EEF2F7, --border #E3E8EF, --text #10223B, --text-2 #4B5A6E,
  --text-3 #7B8794, --accent #0883F7, --accent-text #FFFFFF, --warn #FC5305, --ok #16A34A, --danger #DC2626,
  --rail-bg #10223B (sidebar stays navy), --rail-text #E6EAF0, --focus #0883F7.
- Dark: --bg #0F172A, --surface #121A2B, --surface-2 #1A2336, --border #273247, --text #E6EAF0, --text-2 #A9B4C4,
  --text-3 #7B8794, accents same, --rail-bg #0B1220.
- No pure #000 or pure #FFF text anywhere. Every text/background pair must meet WCAG AA 4.5:1 (3:1 for ≥18px bold);
  write a tiny script (tools/theme-contrast-check.mjs) that computes the ratios for every pair in the token file and
  fails the build task if any pair is below AA.
- Orange #FC5305 only for badges, alerts and one primary CTA per screen — never as a large background. The
  TRAINING/DEMO banner keeps orange text on navy.

B) DISPATCHER PORTAL — replace hard-coded colors with tokens
- **[paste ends here — rest of B and any C, D, … missing]**

---

## Notes for whoever picks this up (not part of the brief)

- Several of A's own pairs fail AA (4.5:1 normal text), so the contrast script fails on the brief's hexes as written.
  Computed 15 Oct with the WCAG 2.x formula: light `--text-3 #7B8794` on `#F5F7FA` **3.41**, on `#FFFFFF` 3.66;
  `--warn #FC5305` on white **3.29**; `--ok #16A34A` on white **3.30**; white on `--accent #0883F7` **3.75** (so the
  primary button's white text fails too); dark `--text-3` on `--surface-2 #1A2336` **4.29**. Passing: `--danger`
  on white 4.83, `--text-2` on `--surface-2` 6.25, dark `--text-3` on `--surface` 4.75, `--accent` on dark surface 4.63.
  These are brand values, so ask the owner before changing any hex. Either darken the text variants (for example
  --text-3, plus an `--ok-text` / `--warn-text` for text use only) or allow 3:1 only for large bold text and badges.
- "#FFF / #000 text" vs `--accent-text #FFFFFF`: the brief contradicts itself. Ask the owner which rule wins.
