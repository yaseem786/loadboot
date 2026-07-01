# LoadBoot — Brand Asset Audit (Increment 44 parallel / Inc 61 prep)

Audited the repository's brand and image assets so email/template work uses only confirmed authentic assets.
No fake logos, fabricated customer logos, or placeholder images are permitted.

## Official brand mark
- **Primary logo:** an inline SVG "L" mark (white bars) + orange forward arrow + the "oad**boot**" wordmark.
  Used consistently in the site header, footer, and splash (3 occurrences in `build_site.py`). This is the
  single source of truth for the brand mark — there is no competing logo file.
- **App icons / favicons (authentic, present in repo root → published to site root):**
  `icon-512.png`, `icon-192.png`, `icon-maskable.png`, `apple-touch-icon.png`, `favicon.ico`, `favicon-32.png`,
  `favicon-48.png`. `icon-512.png` is already declared as the Organization logo in the site's JSON-LD.

## Photographic assets (illustrative)
Equipment category photos, published to the site: `dry-van.webp`, `reefer.webp`, `flatbed.webp`,
`power-only.webp`, `hotshot.webp`, `new-authority.webp`, `owner-operator.webp`, `truck-fleet.webp`,
`truck-boxtruck.webp`, `owner-operator-dispatch-hero.jpg`. These are generic equipment imagery, not customer
or partner logos, and carry no fabricated claims.

## Findings
- **Outdated logo files:** none found (single consistent inline mark).
- **Placeholder images:** none. (The `placeholder=` matches in the codebase are all HTML form-field hints, not
  image placeholders. No lorem-ipsum, no `via.placeholder`, no `example.com/img`.)
- **Broken images:** none detected in the build.
- **Externally hotlinked images:** none. (No `src="http…"` image references except allowlisted CDN scripts.)
- **Duplicated assets:** none material.
- **Third-party platform logos / fake customer logos:** already removed (documented in `build_site.py`).

## Decision for email/templates
Email clients render inline SVG unreliably, so branded emails use the **authentic hosted PNG icon**
(`https://loadboot.com/icon-512.png`) + the "LoadBoot" wordmark in a table-based header — not a new or fake
asset. The branded header/footer shell is implemented in the delivery worker (see Increment 61 note in the
changelog). No placeholder or fabricated imagery is introduced.
