# Carrier-portal deep links — `#tab/target`

Added 29 Aug 2026. One file changed: **`app/carrier/app.js`** (+62 / −8 lines).
Netlify runs `python3 build_site.py` itself, so nothing under `site/` needs committing —
push `app/carrier/app.js` and the deploy rebuilds.

## What it does

An email link now lands on the exact card, not just the tab. The portal scrolls to it,
outlines it in LoadBoot blue for 3.5 s, and — for the two things that open a modal —
clicks it for the carrier.

`app.js` already split `#tab/id` into `window.__lbDeepEnt` (that is how `#loads/<id>` and
`#trips/<id>` work). This patch adds a lookup table that turns the `id` into a real element.

## The vocabulary — use these in emails, notifications and SMS

Base: `https://loadboot.com/app/carrier/`

| Link | Lands on |
|---|---|
| `#documents` | Documents tab |
| `#documents/checklist` | the Required-documents checklist |
| `#documents/w9` | **opens the W-9 wizard** |
| `#documents/agreement` | **opens the dispatch-agreement signing modal** |
| `#documents/insurance` · `#documents/coi` | the Certificate-of-Insurance row |
| `#documents/authority` · `#documents/mc` | the MC/DOT Operating Authority row |
| `#documents/bank` | the Bank Verification row |
| `#documents/mcs150` | the MCS-150 row |
| `#documents/upload` | the manual upload form |
| `#fleet` | Fleet tab |
| `#fleet/add-truck` | **opens the Add-truck form** |
| `#fleet/add-driver` | **opens the Add-driver form** |
| `#fleet/trucks` · `#fleet/drivers` | the Trucks / Drivers card |
| `#account` | Account tab |
| `#account/payments` (`/pay`, `/bank`) | Payments & payouts section |
| `#account/dispatch` (`/prefs`, `/preferences`) | Dispatch preferences section |
| `#account/verification` (`/verify`) | Verification & documents section |
| `#account/business` (`/biz`) · `/security` · `/alerts` · `/support` · `/profile` | that section |

**Fleet is its own top-level tab — it is not inside Account.** Write "Fleet → Add truck",
never "Account → Fleet".

## Safety properties (all verified, 13/13 automated cases pass)

- **An unknown target is ignored.** `#fleet/typo` lands on Fleet and does nothing else —
  no error, no console noise. Old links keep working forever.
- **A target on the wrong tab does nothing.** `__lbDeepEnt.tab` must match the rendered tab.
- **`loads` and `trips` are untouched** — they are not in the map, so their existing
  entity-deep-link handlers still own them.
- **Never auto-clicks a file picker.** Only the W-9 and agreement buttons are auto-clicked,
  and both open a modal; a browser blocks a programmatic `input[type=file]` click without a
  real user gesture, so uploads only scroll + highlight and the carrier taps it himself.
- **Views mount async**, so the resolver polls for the node for 8 s and then gives up quietly.
- The hash is rewritten to the bare `#tab` with `replaceState` once resolved, so Back still
  works and the hash does not pile up.
- Login survives it: the hash is untouched by the auth screen, so a logged-out carrier who
  clicks `#fleet/add-truck` still lands on Add-truck after signing in.

## Still open (not in this patch)

`cc_onboarding_remind()` in Postgres hard-codes `/app/carrier/#documents` for the in-app
notification it writes. Worth pointing it at the specific document once this ships.
