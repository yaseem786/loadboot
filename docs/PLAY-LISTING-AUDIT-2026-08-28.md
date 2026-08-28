# Google Play listing ↔ website ↔ app — cross-match audit (28 Aug 2026)

App: **LoadBoot Load Board & Dispatch** · `com.loadboot.app` · v1.0.1 (versionCode 2)
Status: **Approved and live** — last published 26 Aug 2026, "You have no unpublished changes", 100% rollout, phones + tablets.
Public URL: https://play.google.com/store/apps/details?id=com.loadboot.app

Method: read the Play Console (store listing, store settings, privacy policy, dashboard), the public Play page, the live site (loadboot.com), the TWA manifest in `tools/twa/`, and the portal chooser at `/app/?choose=1`. Every "mismatch" below was checked against a second read of the source; where I could not observe something it is marked *unknown*.

---

## 1. What matches (no change needed)

| Claim in listing | Website | Verdict |
|---|---|---|
| Carriers pay flat 5% only on delivered + paid loads; no subscription, no contract | /pricing: "A flat 5% of gross — that's it. No setup fees. No monthly minimums. No long-term contract." | ✅ |
| Brokers & shippers post free, no per-post fee | /free-load-board-for-brokers: "Post Loads at $0 … No per-post fee"; /shipper-solutions: "Free for shippers" | ✅ |
| Agents earn 1% of gross on every delivered load, recurring, no cap | /agents: "You earn 1% of every load — forever … Recurring. No cap." | ✅ |
| Phone +1 (469) 253-7575, any hour | Site header: "24/7 +1 (469) 253-7575"; Play store settings phone `+14692537575` | ✅ |
| Contact email hello@loadboot.com, website https://loadboot.com | Store settings | ✅ |
| Privacy policy URL https://loadboot.com/privacy.html | Live, returns 200 | ✅ |
| Account deletion | Play Data safety says "You can request that data be deleted"; site has /delete-account (covers app + site, privacy@loadboot.com path) | ✅ |
| Digital Asset Links (TWA full-screen) | `/.well-known/assetlinks.json` live with all 3 fingerprints (A6:5D, A7:F2, BA:6D) — matches `asset_statements` in the manifest | ✅ |
| Broker / shipper / agent usable inside the app | TWA opens `https://loadboot.com/app/` → carrier login, with **"All portals"** → chooser (Carrier / Partner / Agent / Create account). Partner portal has its own login + "New partner? Create an account". So the broker/shipper/agent bullets in the listing are reachable from the app, not just the website. | ✅ |
| Category Business; tags Auto & vehicles, Business, Maps & navigation, Productivity, Vehicle maintenance | Reasonable for the product | ✅ (see §3 for a tag note) |

## 2. Mismatches — change needed

### 2.1 🔴 Website still says the app is "coming soon" — `/apps` page (and footer "Get the App")
Live copy on https://loadboot.com/apps :
- "Install in 10 seconds, **no app store needed**"
- "Native listings on the Apple App Store and Google Play **are in preparation**"
- "COMING SOON — LoadBoot is coming to the App Store & Google Play"

This is now false for Android and is the single most visible contradiction — the footer of every page links here ("Get the App"). **Nowhere on loadboot.com is there a link to the Play listing** (checked home, /features, /faq, /carriers, /brokers, /apps — zero `play.google.com` hrefs).

Change: on `/apps` replace the Android block with an official **"Get it on Google Play"** badge linking to `https://play.google.com/store/apps/details?id=com.loadboot.app`, keep the "Add to Home Screen" instructions as the fallback, keep iPhone as PWA, and change "coming soon" to iOS-only. Add the badge to the carrier-portal login screen (`/app/carrier/`) and optionally the site footer. Also update the in-portal PWA-install prompt copy (memory `carrier_pwa_install.md`: "home-screen instructions until the Play Store app ships") — it has shipped.

### 2.2 🟠 Short description is flagged by Play — "may not be promoted"
Console shows on the listing: *"Your app may not be promoted on Google Play because your short description does not meet the following guidelines: Should not use keywords that indicate price or promotion."*
Current (75/80): `Find truck loads on a verified load board. Free to join, dispatch included.`
Trigger word: **"Free"**. This does not block publication, but it disqualifies the app from Play's editorial/featuring surfaces.

Change (≤80 chars, no price words, keeps broker/shipper in view):
`Verified load board & dispatch for carriers, brokers and shippers. GPS proof.` (77)
or `Verified truck load board and dispatch for carriers, brokers and shippers.` (73)

### 2.3 🟠 Privacy policy doesn't cover the app or the non-carrier users (Play requires the policy to describe the app)
Live https://loadboot.com/privacy.html:
- Opens with *"how Loadboot handles information you provide **through this website**"* — never mentions the Android app / Google Play. Google's User Data policy requires the linked policy to cover the app.
- "Last updated: **2026**" — no month/day (terms say "July 2026", delete-account page says "2026"). Reviewers and users read that as a placeholder.
- Entirely **carrier-centric**: lists account, carrier/authority info, uploaded documents, precise location, marketing analytics. Nothing about **broker/shipper data** (company, MC, load details, contact phones parsed from emails to loads@) or **agent data** (referral chain, payout/banking details).
- Play Data safety says *"No data shared with third parties"* while the policy says information is shared *"with brokers and factoring partners on your behalf"*. Sharing to fulfil a user-initiated booking is exempt under Play's definition, so this is defensible — but write the exemption into the policy ("shared with the broker on the load you book, at your direction") so a reviewer sees it as consistent.
- Play Data safety declares **Location, Personal info + 7 other data types** collected. Policy should enumerate the same list (financial info for settlements/1099 & W-9, files/docs, photos (POD uploads), device/other IDs, app activity, messages/in-app chat, contacts if any).

Change: add an "Applies to" paragraph (loadboot.com, the LoadBoot Android app on Google Play, all portals), a real date, a short broker/shipper/agent section, a location paragraph that matches the app (foreground only? background? — *unknown from this audit; state whatever the portal actually does*), and the data-type list mirrored from Data safety.

### 2.4 🟡 Terms of service are fine — but confirm the repo copy is the live one
Live /terms: "Last updated: July 2026", covers "loadboot.com, the LoadBoot portals and applications", carriers + brokers + shippers. ✅
The repo root `terms.html` and `privacy.html` (mtime Jul 2026) are **older, dispatch-only versions** ("we are not a freight broker", no app mention). The live pages are generated by `build_site.py`, so the root files are dead copies — delete or mark them so nobody edits the wrong one. (Repo `manifest.webmanifest` at root is likewise the old marketing-site manifest: name "Loadboot", start_url "/"; the portals use their own `carrier.webmanifest` / `partner.webmanifest`.)

### 2.5 🟡 Store listing assets incomplete
- **Phone screenshots: 7 / 8** — one slot empty; the public page shows 7. The 8-shot set exists in `docs/playstore-screenshots/01..08` (1080×1920, 15 Aug). Memory notes the listing still carries the Aug-5 padded set — swap to the fresh 8 (and none of the 7 shows the **Partner/broker** side; add at least one broker screenshot: post-load / offers-out / GPS proof, which also fixes §2.6).
- **7-inch and 10-inch tablet screenshots: empty** (both marked required *). The app is distributed to tablets ("Phones and tablets, + 2 more"), but the listing will look broken on a tablet and Play can restrict tablet promotion. Capture 2 × 1200×1920 (7") and 2 × 1600×2560 (10") from the partner/carrier portal.
- Video: none (optional).

### 2.6 🟡 Listing is carrier-first; broker/shipper side under-represented in the visible parts
- App name "LoadBoot Load Board & Dispatch" ✅ neutral.
- Short description: carrier-only ("Find truck loads"). Fix in §2.2.
- "What's new": *"First release: install the LoadBoot portal as an app — loads, trips, GPS proof, PODs and settlements."* — carrier-only. Next release note should say "carriers, brokers, shippers and agents — one app, choose your portal at sign-in".
- Screenshots: 0 of 7 show the partner portal. See §2.5.
- Full description: broker/shipper section is good and matches the site (free posting, verified carriers, live tracking, detention clock). Two claims need backing on the site:
  - **"Add loads@loadboot.com to the same send and your loads post automatically"** — the engine is live on prod (email-loads engine, Jul 2026), but **loads@loadboot.com appears nowhere on the public site** (checked /brokers, /free-load-board-for-brokers, /shipper-solutions, /integrations). A broker reading the listing then visiting the site finds no mention. Add a "Post by email" block on /free-load-board-for-brokers and /integrations.
  - "Detention disputes settle against a shared clock" — site says "Arrival/departure evidence and accessorial requests handled under the load terms, with an audit trail" — consistent ✅.

### 2.7 🟡 Tag "Vehicle maintenance"
The app has no maintenance features. Harmless, but it dilutes relevance for the Play search/recommendation model. Replace with "Logistics" if available, else drop it.

### 2.8 ⚪ Play Console housekeeping
- Unread notifications in the Console — *not read in this audit*; open them (post-approval mails sometimes contain policy deadlines, e.g. target-SDK or data-safety updates).
- Statistics say "Data is not yet available" — 0+ downloads is expected 2 days post-publish.
- Managed publishing is OFF: any Save on the listing goes straight to review. Batch the §2.2 + §2.5 edits in one submission.

---

## 3. Recommended order of work

1. **Website `/apps` page + footer badge + carrier-login badge** (§2.1) — one `build_site.py` edit, deploy. Biggest visible contradiction, zero review risk.
2. **Add loads@loadboot.com to the broker pages** (§2.6) — same deploy.
3. **Privacy policy rewrite** (§2.3) — same deploy; no Play resubmission needed since the URL doesn't change.
4. **Play listing update in one submission** (§2.2, §2.5, §2.7): new short description, 8 fresh phone screenshots incl. ≥1 broker shot, tablet screenshots, drop "Vehicle maintenance". Uses the Console's normal review (hours to a few days); the live listing stays up meanwhile.
5. Delete/mark the stale root `privacy.html` / `terms.html` / `manifest.webmanifest` (§2.4).
6. Optional: iOS is still "coming soon" — that copy can stay, but scope it to Apple only.

## 4. Not checked (out of scope or not observable)
- Whether background location / notifications actually work inside the TWA on a device (the app is a Chrome custom tab; "true background GPS" promised in the old "coming soon" copy is *not* what a TWA delivers — don't move that sentence into the Play description).
- Play Console notifications and any policy-status emails to hello@loadboot.com.
- The Sign-in details reviewer credentials still work (password was reset 16 Aug; approval implies they did at review time).
