# Google Play Upload Guide — LoadBoot v1.0.0 (2026-08-15)

Everything below is ready. You type only passwords/payments yourself — never share them.

## What's in this pack

| File | Where | What |
|---|---|---|
| `release/loadboot-v1.aab` | repo | Signed Android App Bundle (TWA, `com.loadboot.app`, versionCode 1, targetSdk 36) |
| `loadboot-upload.keystore` | repo root, **gitignored** | NEW upload keystore (the 2026-07-31 one was lost with its cloud session) |
| `PLAY-KEYSTORE-NOTE.txt` | repo root, **gitignored** | Keystore password + fingerprint. **Back both files up outside the repo (password manager + drive). Lose them = painful key-reset process.** |
| `docs/playstore-screenshots/feature-graphic.png` | repo | 1024×500 feature graphic |
| `docs/playstore-screenshots/01..08.png` | repo | 8 phone screenshots (1080×1920) |
| `tools/twa/` | repo | Full reproducible AAB build recipe (no Android Studio needed) |

## Step 0 — Deploy the new assetlinks FIRST (required before review)

`build_site.py` now publishes **two** fingerprints in `/.well-known/assetlinks.json`
(old lost key + new key). Commit → `python build_site.py` → push → **fetch
https://loadboot.com/.well-known/assetlinks.json and confirm the `A7:F2:…F1:48`
fingerprint is live** (standing rule: always verify live after deploy).

## Step 1 — Developer account

https://play.google.com/console → $25 one-time, personal account is fine for now
(shows your name as developer; an LLC org account can replace it later).
Verification may ask for ID — do it yourself, don't paste documents anywhere else.

## Step 2 — Create app

Create app → Name: **LoadBoot Load Board & Dispatch** · App · Free · Business category.

## Step 3 — App integrity / signing (IMPORTANT)

Accept **Play App Signing** (Google-generated app signing key) and upload our AAB as-is.
Then: **App integrity → App signing key certificate → copy the SHA-256** and give it to
me (or paste it into the assetlinks array in `build_site.py` yourself, same place as the
other two) → rebuild → deploy → verify live. **If this fingerprint is missing, the
installed app shows the browser bar on top — the #1 TWA rejection/quality issue.**

## Step 4 — Store listing

- App name: `LoadBoot Load Board & Dispatch`
- Short description (80): `Loads, trips, GPS proof, PODs & money tools for owner-operators and fleets.`
- Full description: use `docs/play-store-listing.md` (the bullet list, drop the internal notes)
- Graphics: icon 512 = `icon-512.png` · feature graphic = `docs/playstore-screenshots/feature-graphic.png` · screenshots = `docs/playstore-screenshots/01..08.png`
- Privacy policy: `https://loadboot.com/privacy.html`

## Step 5 — Data safety form (answers ready)

Collected & why (none sold, none shared with third parties; all encrypted in transit; deletable):

| Data | Collected? | Shared? | Purpose |
|---|---|---|---|
| Location (precise) | Yes — only during an active trip, user-initiated | No | App functionality (load tracking / GPS proof) |
| Name, email, phone | Yes | No | Account management |
| Financial info (bank/payout details) | Yes | No | Payouts & settlements |
| Photos / documents (PODs, W-9, COI) | Yes | No | App functionality (freight paperwork) |
| Crash logs / diagnostics | Yes | No | Analytics/diagnostics (client telemetry) |

- Data encrypted in transit: **Yes**
- Users can request deletion: **Yes** → in-app (Settings → Delete account) + `https://loadboot.com/delete-account.html`
- Account creation: **Yes, required**

## Step 6 — App access (reviewer credentials)

All four demo accounts are production-isolated (`is_demo`) and never touch real carriers:

- Carrier: `play.review@loadboot.com`
- Broker: `play.broker@loadboot.com`
- Shipper: `play.shipper@loadboot.com`
- Agent: `play.agent@loadboot.com`

Passwords: the ones set on 2026-08-05 (your password manager). Add all four under
"App access → All or some functionality is restricted" with a note that one login
covers each role's portal.

## Step 7 — Content rating & declarations

- Content rating questionnaire: Business/utility app → answers all "No" except
  **"Users can communicate"** = Yes (in-app support/broker chat, moderated). Result: Everyone / PEGI 3.
- Ads: **No**. In-app purchases: **No**.
- Target audience: **18+** only.
- News app: No. COVID app: No. Government app: No.
- US export compliance / encryption: standard HTTPS only → exempt.

## Step 8 — Release

Production → Create release → upload `release/loadboot-v1.aab` → release notes:
`First release: install the LoadBoot portal as an app — loads, trips, GPS proof, PODs and settlements.`
→ Submit for review. New-developer reviews currently take up to ~7 days; you'll also
need the "closed testing with 12 testers for 14 days" track ONLY if Play flags the
account as a new personal account (they usually do for accounts created after Nov 2023 —
if so, tell me and I'll set up the internal/closed track flow with the same AAB).

## Future updates

Bump `android:versionCode` (+1) and `versionName` in `tools/twa/AndroidManifest.xml`,
re-run the recipe in `tools/twa/README.md`, sign with the SAME keystore, upload.

## If Play says "APK signed with wrong key"

Then the 2026-07-31 keystore WAS already used on an existing app record — stop and tell
me; we either find that keystore or request an upload-key reset from Play (takes ~2 days).
