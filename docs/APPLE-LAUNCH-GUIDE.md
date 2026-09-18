# LoadBoot — Apple App Store launch guide

Prepared 17 Sep 2026. Everything technical is already in the repo (see §0). This file is the
owner's runbook from "no Apple account" to "Ready for Sale", plus the listing copy and the
review answers. Do the steps in order; each one unblocks the next.

Play Store is live (`com.loadboot.app`, 26 Aug 2026). The iOS app uses the **same bundle id**
and the **same live web build**, so features stay identical across stores.

---

## 0. What is already built (repo)

| Piece | Path | Status |
|---|---|---|
| Capacitor 8 shell (remote mode → `https://loadboot.com/app/`) | `tools/ios/` | done |
| Cloud build → TestFlight (no Mac) | `codemagic.yaml` | done, needs 2 values (§3) |
| iOS config patcher (privacy strings, WKAppBoundDomains, push hook, privacy manifest) | `tools/ios/scripts/apply-ios-config.sh`, `tools/ios/ios-config/` | done |
| App icon 1024 (identical to the site/Play icon) + splash | `tools/ios/resources/` | done |
| Web-side native bridge (push, links, deep links, haptics, splash) | `app/shared/native.js` (+ script tag in carrier/partner/agent/app index.html) | done |
| APNs push in the existing push engine | `app/shared/push.js`, `migrations/bl_ios_0349_apns_push.sql`, `supabase/functions/push-send/index.ts` | done — migration + function NOT yet applied (§5) |
| Universal Links file | `build_site.py` writes `/.well-known/apple-app-site-association` when `APPLE_TEAM_ID` env is set | done, waits for Team ID (§2) |
| App Store screenshots v1 (6.9" iPhone + 13" iPad) | `docs/appstore-screenshots/` + generator `tools/ios/scripts/make-appstore-shots.py` | done (v1 from Play captures; recapture when convenient) |
| Install pills never show inside the store app | `app/shared/ui/iosInstall.js`, `playInstall.js` | done |

Architecture in one line: WKWebView (app-bound to loadboot.com, so the service worker keeps
working) loads the production PWA; Capacitor injects the native bridge; `native.js` uses it.
Every Netlify deploy reaches iOS users instantly — the store binary changes only for native work.

---

## 1. Apple Developer Program — enrol as an ORGANIZATION (Day 0)

Cost **$99 / year** (Enterprise program is $299 — not this one). Enrol as **Organization**, not
Individual: the seller name on the store becomes "LoadBoot LLC" instead of a personal name, and
it can be transferred / have team members later.

Prereqs (all exist already per `areas/loadboot-us-setup`): Wyoming LLC, EIN, **D-U-N-S number** (149880967),
`hello@loadboot.com` (work-domain email is required — no Gmail), public website.

1. Sign in at https://developer.apple.com/programs/enroll/ with an Apple ID that uses
   **hello@loadboot.com** (create one at appleid.apple.com if needed; turn on two-factor — it is
   mandatory). Use the same Chrome profile as the Play Console (u/1).
2. Entity type → **Company / Organization**. Enter the legal entity name exactly as on the LLC
   filing, the D-U-N-S number, address, phone, website `https://loadboot.com`.
3. "Legal binding authority" → you are the owner/founder → yes.
4. Apple may email for verification (business documents; occasionally a phone call). Reply from
   hello@loadboot.com. Typical: 1–7 days.
5. When the "complete your purchase" email arrives → pay $99 → membership active within 24 h.
6. Note the **Team ID** (Account → Membership details, 10 characters). It is needed in §2 and §5.

Meanwhile (does not need approval): create the Codemagic account (§3 step 1) and read §6.

---

## 2. One-time setup in the Apple Developer portal (after enrolment)

developer.apple.com/account →

1. **Identifiers → App IDs → +** → App → Bundle ID **explicit** `com.loadboot.app`,
   description "LoadBoot". Capabilities: tick **Push Notifications** and **Associated Domains**. Save.
2. **Keys → +** → name "LoadBoot APNs", tick **Apple Push Notifications service (APNs)** →
   Register → **Download the .p8 once** (it cannot be re-downloaded) → note the **Key ID**.
   Store the .p8 with the Play keystore backup (never in the repo).
3. **Keys → +** again is NOT needed for App Store Connect API — that key is created in App Store
   Connect (§3 step 2).
4. Netlify → Site settings → Environment variables → add `APPLE_TEAM_ID = <Team ID>` → trigger a
   deploy. Verify: `curl -s https://loadboot.com/.well-known/apple-app-site-association` returns
   JSON with `TEAMID.com.loadboot.app` and header `content-type: application/json`.

---

## 3. App Store Connect + Codemagic (cloud Mac build → TestFlight)

### 3a. App Store Connect
1. https://appstoreconnect.apple.com → My Apps → **+ New App**: iOS · name **LoadBoot Load
   Board & Dispatch** (same as Play; if taken, "LoadBoot – Load Board & Dispatch") · primary
   language English (U.S.) · Bundle ID `com.loadboot.app` · SKU `loadboot-ios` · access Full.
2. Open the new app → **App Information** → copy the numeric **Apple ID** (e.g. 6740000000).
3. **Users and Access → Integrations → App Store Connect API → Team Keys → +** → name
   "Codemagic", access **App Manager** → Generate → download the .p8 (once), note **Issuer ID**
   and **Key ID**.
4. **TestFlight → Internal Testing → +** group named exactly **LoadBoot Internal**, add
   hello@loadboot.com (and any iPhone user you want testing).

### 3b. Codemagic
1. https://codemagic.io → sign up with GitHub (personal account = **500 free macOS minutes /
   month**, a full build is ~12–18 min). Grant access to the `loadboot` repo.
2. **Teams → Personal → Integrations → App Store Connect → Add key**: name **`LoadBoot ASC`**
   (must match `codemagic.yaml`), Issuer ID, Key ID, upload the .p8 from 3a-3.
3. In the repo edit `codemagic.yaml` → `APP_STORE_APP_ID: "<numeric Apple ID from 3a-2>"`.
   Commit.
4. Codemagic → Apps → Add application → select repo → "codemagic.yaml" → Save. Workflows
   `ios-testflight` and `ios-simulator-check` appear.
5. Build: `git tag ios-v1.0.0 && git push origin ios-v1.0.0` (or "Start new build" → workflow
   ios-testflight). Codemagic creates the distribution certificate + App Store provisioning
   profile itself, builds the IPA with Xcode 26, uploads to TestFlight and emails
   hello@loadboot.com.
6. On the iPhone: install **TestFlight** from the App Store → accept the invite → install
   LoadBoot → run §4.

First build gotchas: if the build fails at `use-profiles` the bundle ID capabilities (§2 step 1)
are missing; if at `build-ipa` with a signing error, open the build log line "Provisioning
profile ... doesn't include the ... entitlement" → tick that capability in §2 step 1 and
rebuild. Nothing needs a local Mac.

---

## 4. TestFlight acceptance checklist (do on a real iPhone)

- Cold start shows the navy splash → carrier login within ~2 s; no white flash.
- Log in → Dashboard renders; safe-area at top/bottom respected; no "Install LoadBoot" pill.
- Account → Notifications → **Enable** → iOS permission prompt → after "Allow", the toggle shows
  On ✓ and `app_private.push_subscriptions` has a row whose endpoint starts with `apns:`.
- Command Center → send a test push to that user → banner arrives on the phone; tapping it opens
  the app on the URL in the payload.
- Documents → upload → the iOS sheet offers **Take Photo / Photo Library / Choose File**; a photo
  taken with the camera uploads and pre-checks.
- Start a trip → location prompt appears once (the string mentions "only while running a load");
  live tracking updates the map.
- Tap an external link (e.g. FMCSA SAFER, a PDF) → opens in the in-app Safari sheet with a Done
  button; back in the app the state is intact.
- Open https://loadboot.com/app/carrier/ from Notes/Mail → opens **inside** the app (Universal
  Link). If it opens Safari instead: §2 step 4 not deployed yet, or the phone cached an old AASA
  (reinstall the build).
- Kill the app, reopen → lands on the last portal (launch.js), session persists.
- Sign out → Sign in again works; Delete account card visible under Account → Security.

---

## 5. Backend: APNs push (apply once, staging first)

1. Supabase **staging** (`snslhvmkjusozgjelghi`) → SQL editor → run
   `migrations/bl_ios_0349_apns_push.sql`. Then production (`rwscphuhpjoudvljvmdk`).
2. Edge Functions → **Secrets** (both projects):
   `APNS_TEAM_ID` (Team ID), `APNS_KEY_ID` (from §2 step 2), `APNS_P8` (paste the .p8 file
   contents, BEGIN/END lines included), `APNS_BUNDLE_ID=com.loadboot.app`,
   `APNS_ENV=production` (TestFlight and App Store builds both use production APNs).
3. Deploy `supabase/functions/push-send` to staging, send a test push from the CC to an APNs
   device, check the function log shows `apns.sent ≥ 1`. Then deploy to production.
   Web push keeps working unchanged (same function, split by endpoint prefix).

---

## 6. App Store listing (copy-paste)

**Name** (30): `LoadBoot Load Board & Dispatch`
**Subtitle** (30): `Verified loads. GPS proof.`
**Category**: Business · secondary: Productivity
**Age rating**: 4+ (answer all questionnaire items "None"; the new 2026 questions on user
generated content → "No, not the primary purpose"; loot boxes/gambling → No)
**Price**: Free · **In-app purchases**: none (plans are handled on loadboot.com only — the app
never shows pricing or upgrade buttons, so Guideline 3.1.1 does not apply)
**Copyright**: `© 2026 LoadBoot LLC`
**Support URL**: `https://loadboot.com/contact.html` · **Marketing URL**: `https://loadboot.com/apps`
**Privacy Policy URL**: `https://loadboot.com/privacy.html`

**Promotional text** (170):
`Carriers book and run loads with GPS-stamped proof. Brokers and shippers post freight free and watch it move. Agents track referrals and payouts. One app, four sides of trucking.`

**Description** (4000) — same body as the Play full description ("the rich 4-sided text ending
'LoadBoot LLC · loadboot.com'"): copy it verbatim from Play Console → Main store listing so the
two stores never drift. Do **not** include "free", "discount", or a competitor name in the first
line — Apple's featuring rules match Play's.

**Keywords** (100, comma-separated, no spaces after commas, no app-name repeats):
`load board,trucking,dispatch,freight,carrier,broker,owner operator,truck loads,GPS tracking,BOL,POD,shipper`

**What's New** (v1.0.0):
`First App Store release. Carriers, brokers, shippers and agents — one app, pick your portal at sign-in. Push alerts for offers and load updates, camera document upload, live GPS trip proof.`

**Screenshots**: upload `docs/appstore-screenshots/iphone-69/*.png` (8, in order) under
iPhone 6.9"; `docs/appstore-screenshots/ipad-13/*.png` under iPad 13" **only if** iPad support
stays on (default: on — the web app is responsive; if you prefer iPhone-only, set
`TARGETED_DEVICE_FAMILY = 1` in the Xcode project via `apply-ios-config.sh` and skip iPad shots).
Recapture later at native size (DevTools → iPhone 15 Pro Max, DPR 3 → 1290×2796 raw) and
re-run `make-appstore-shots.py` for sharper frames.

### App Privacy (nutrition labels) — answers
"Do you collect data?" → **Yes**. Data linked to the user, all for **App Functionality** only,
none used for tracking:
- Contact info: Name, Email, Phone number
- Location: Precise location (only during an active trip, user-initiated)
- User content: Photos or videos (documents the user uploads), Other user content (load & trip data)
- Identifiers: User ID
- Diagnostics: Crash data (not linked)
No third-party advertising, no data brokers, no tracking → **"Data Not Used to Track You"**.
These match `tools/ios/ios-config/PrivacyInfo.xcprivacy`; change both together.

### App Review Information
- Sign-in required → **Yes**. Demo account: `play.review@loadboot.com` (carrier) — and add in
  notes: broker `play.broker@loadboot.com`, agent `play.agent@loadboot.com`, same password. Reset
  the password yourself before submitting (Claude never handles passwords) and verify the demo
  loads on prod are not expired (they expire ~every 2–3 weeks; bump `expires_at` first).
- Contact: your name, phone, hello@loadboot.com.
- **Notes to reviewer** (paste):

  > LoadBoot is a freight-operations platform for US trucking (carriers, brokers, shippers, referral
  > agents). The app is the carrier/partner workspace, not a website wrapper: it registers for APNs
  > push (load offers, booking updates), uses the camera to capture proof-of-delivery and compliance
  > documents, records GPS arrive/depart stamps and live tracking during an accepted load, and opens
  > universal links to loads. Sign in with the carrier demo account above; "Load Board" shows demo
  > broker loads; "Documents" accepts a camera capture; "Account → Notifications → Enable" triggers
  > the push permission; starting the demo trip triggers the location permission. Account deletion
  > is under Account → Security → Delete account (and https://loadboot.com/delete-account.html).
  > No purchases are offered in the app; subscription plans exist only on the website for fleets.

- Export compliance: uses only HTTPS/standard encryption → the binary already declares
  `ITSAppUsesNonExemptEncryption = false`, so no extra question appears.
- Content rights: No third-party content. Advertising identifier: **No**.

---

## 7. Submit → review → release

1. App Store Connect → the app → **1.0 Prepare for Submission** → Build → select the TestFlight
   build → fill §6 → **Add for Review** → **Submit**.
2. Review typically 24–48 h. Common rejection replies for this kind of app and the answer:
   - **4.2 Minimum functionality / "web wrapper"** → reply with the reviewer note above, and a
     short screen recording showing push permission, camera capture, location stamp inside the
     app. Do not argue; show the native features.
   - **5.1.1 account deletion** → point to Account → Security → Delete account (exists).
   - **2.1 Information needed / demo login failed** → reset the demo password, reply with it.
   - **5.1.2 / privacy** → nutrition labels and privacy policy must match — both updated in this
     guide; if they ask, the policy page is dated and covers the app (rewritten 28 Aug 2026).
3. Release: **Manually release** (safer for a first build) → after "Pending Developer Release",
   press Release. Then:
   - site: /apps page "coming soon" → App Store badge (official badge from
     developer.apple.com/app-store/marketing/guidelines — never the self-drawn one); footer badge
     next to Google Play; `iosInstall.js` pill → point to the App Store instead of Add-to-Home-Screen.
   - Play + App Store: keep the descriptions identical.
   - Memory/docs: record the Apple ID, Team ID, Key IDs in `PLAY-KEYSTORE-NOTE.txt` (git-ignored).

---

## 8. Costs (one-time / recurring) — all in USD

| Item | Amount |
|---|---|
| Apple Developer Program (Organization) | $99 / yr |
| Codemagic | $0 (500 free mac-minutes/mo on a personal account; overage $0.095/min) |
| D-U-N-S | $0 (already obtained) |
| Mac hardware | $0 (cloud build) |

Sources checked 17 Sep 2026: Apple "Upcoming requirements" (Xcode 26 / iOS 26 SDK mandatory since
28 Apr 2026), Codemagic pricing page, Capacitor 8 docs (iOS 15+, Xcode 26+, Node 22+), App Store
Connect screenshot specifications (6.9" 1320×2868 required; 13" iPad 2064×2752 required when iPad
is enabled).

---

## 9. After launch — native roadmap (not needed for v1)

- Background GPS during an active trip (`@capacitor-community/background-geolocation`) +
  `NSLocationAlways…` justification video for review.
- Face ID re-auth (`capacitor-native-biometric`) gated to Payments.
- Rich push (images, actions: "Accept offer") via a Notification Service Extension.
- Native camera plugin with document edge-detection (currently the iOS file picker → camera path,
  which is standard and reliable).
- Android: the same Capacitor project can replace the TWA later (`npx cap add android`) if native
  push/camera parity is wanted there; not required — the TWA is live and fine.
