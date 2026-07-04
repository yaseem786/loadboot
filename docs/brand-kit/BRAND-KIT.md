# LOADBOOT OFFICIAL BRAND KIT — v2 (owner-selected 2026-07-02)
**FINAL (owner-locked): Canva design DAHOQsSkUjs** — navy delta-arrow mark + orange dash (left),
wordmark "load"(navy/white)+"boot"(BLUE) baseline-aligned right, exact size/angle per owner reference image.

## Assets (Canva design DAHOQp0P1Oo)
- Edit/refine: https://www.canva.com/d/5Icnaa8WBW2OH0H
- View: https://www.canva.com/d/2LmqZQnKiuoQOLc
- Hi-res transparent PNG (2000px): download from the Canva design (Share → Download → PNG transparent).

## The 3 separable pieces (use independently where needed)
1. **ICON ONLY** (the navy arrow-mark + orange slash): favicons, app icons (192/512/maskable),
   avatars, watermarks, splash. Min size 16px. Clear space = 25% of mark width on all sides.
2. **TEXT LOGO ONLY** ("loadboot": "load" #0F172A on light / #fff on dark, "boot" #2563EB always):
   headers, documents, email signatures where the icon is redundant.
3. **FULL LOCKUP** (icon + wordmark): website header, portal auth cards, invoices, RC/dispatch sheets.

## OFFICIAL TAGLINE (chosen): "Keep Your Wheels Earning"
- Standalone use only (hero subtitles, ads, email footers) — NEVER attached to the lockup (canon rule).
- Color: orange #F97316 on light, #f9a86b on dark.

## Palette — EXACT logo pixel values (owner-locked source of truth, sampled 2026-07-02)
The 3 ink colors, sampled directly from the final logo PNGs, and where each is used:
- **Navy #10223B** — arrow mark (delta chevron + road panel) AND the word "load"
- **Blue #0883F7** — the word "boot"
- **Orange #FC5305** — the thin diagonal dash/slash inside the arrow mark
- **White/transparent #FFFFFF** — background / negative space

### Legacy site tokens (styles.css :root) — CLOSE but NOT identical
Navy #0F172A · Blue #2563EB · Blue-light (dark bg) #60a5fa · Orange #F97316 · Slate #64748b · BG #f1f5f9
RECOMMENDATION: standardize site tokens to the exact logo values above so site/icons/logo match.
(Pending owner go-ahead before rewriting the 50+ built files.)

## Source assets (transparent, white knocked out 2026-07-02)
- `docs/brand-kit/logo-full.png` — full lockup (icon + wordmark), transparent
- `docs/brand-kit/logo-icon.png` — icon only (arrow mark), transparent
- `docs/brand-kit/logo-text.png` — wordmark only, transparent
- `*-orig.png` — white-background originals kept as backup
- All app icons/favicons regenerated from `logo-icon.png` (transparent; maskable/apple-touch on navy).

## Rules
- Never stretch, recolor outside palette, add shadows/gradients, or attach tagline to lockup.
- Dark backgrounds: white wordmark + blue-light "boot". Light: navy + blue.
- CURRENT SITE LOCKUP REMAINS CANON until owner explicitly orders the v2 rollout;
  rollout = one batch: site + 5 portals + PWA icons + favicons + og:image + splash.

---
## LOCKED — Auth screens & descriptor placement (owner-approved 2026-07-03)
Ye design standard FINAL hai. Bina owner approval ke tabdeeli mana hai.

1. **Descriptor placement (Carrier/Partner/Developers):** original lockup image
   (`logo-full.png` / `logo-full-dark.png`, height 34px, file untouched) + descriptor
   TOP-ALIGNED at the cap of "Boot" — 12px Manrope 600, line-height 1, gap 4px,
   margin-top 7px (wordmark cap = 23% of image height). Colors: Carrier #FB923C,
   Partner #94A3B8, Developers #60A5FA. Same on mobile.
2. **Auth brand panel:** NO logo in the panel. Background: navy gradient
   (160deg #0e1c38→#0b1220→#0d1830) + blue glow top-left (rgba(8,131,247,.18))
   + orange glow bottom-right (rgba(249,115,22,.16)). Content order: dashed
   route-line SVG (blue origin dot → green destination dot, caption)
   → headline ("Higher-paying loads. / Paperwork that handles itself.")
   → mock load card ($ + profit chip + route dots) → detention toast → POD toast
   → tagline "The Operating System for Trucking" (#94a3b8).
3. **Mobile auth:** full-screen (no floating card), same lockup treatment.
Reference implementation: app/carrier/app.js authScreen + carrier.css (cpx-auth-*).
