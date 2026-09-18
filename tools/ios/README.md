# LoadBoot iOS shell (Capacitor 8)

The iOS app is a **native shell around the live PWA**: a WKWebView bound to
`https://loadboot.com/app/` plus native bridges (APNs push, camera/photo picker, GPS,
Universal Links, system browser, haptics, splash, status bar). The web app in `../../app`
is the product; it deploys through Netlify exactly as before and iOS users get every
deploy instantly. This folder changes only when native behaviour changes.

Same identity as Android: bundle id `com.loadboot.app`.

## Layout

| Path | Purpose |
|---|---|
| `capacitor.config.ts` | app id, remote URL, allowed hosts, plugin config |
| `resources/` | 1024 icon (no alpha) + 2732 splash → `@capacitor/assets` generates all sizes |
| `ios-config/App.entitlements` | push + associated domains |
| `ios-config/PrivacyInfo.xcprivacy` | Apple privacy manifest |
| `scripts/apply-ios-config.sh` | patches the generated Xcode project (Info.plist strings, WKAppBoundDomains, AppDelegate push hook) |
| `www/index.html` | offline fallback only |
| `../../codemagic.yaml` | cloud build → TestFlight (no Mac needed) |

`ios/` (the Xcode project) is **generated in CI** (`npx cap add ios`) and git-ignored —
nothing hand-edited lives there, so upgrades are `rm -rf ios && npm run ios:prepare`.

## Web-side pieces (already in the repo)

- `app/shared/native.js` — detects the shell, registers APNs push through
  `cc_save_apns_token`, hides install pills, routes external links to the system browser,
  handles Universal Links, hides the splash once painted.
- `app/shared/push.js` — native branch (APNs) next to the existing Web Push branch.
- `app/shared/ui/iosInstall.js`, `playInstall.js` — never show inside the shell.
- `migrations/bl_ios_0349_apns_push.sql` + `supabase/functions/push-send` — APNs delivery.
- `build_site.py` — serves `/.well-known/apple-app-site-association` when `APPLE_TEAM_ID` is set.

## Build on Codemagic (recommended)

See **docs/APPLE-LAUNCH-GUIDE.md** — step-by-step from enrollment to "Ready for Sale".
Short version: add the App Store Connect key in Codemagic as integration `LoadBoot ASC`,
set `APP_STORE_APP_ID` in `codemagic.yaml`, push tag `ios-v1.0.0`.

## Build on a Mac (optional)

```bash
cd tools/ios
npm ci
npm run ios:prepare        # cap add ios → apply config → icons/splash → cap sync
npm run ios:open           # Xcode → select your team → run on a device
```

## Rules

- Never point `server.url` at staging for a store build (the CSP on /app/* only allows the
  build's own Supabase project anyway).
- Keep `WKAppBoundDomains` ≤ 10 entries (Apple limit) and in sync with `allowNavigation`.
- Bump `MARKETING_VERSION` in codemagic.yaml for a user-visible release; build numbers auto-increment.
