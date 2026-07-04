# App Store / Google Play Readiness Plan (LoadBoot)
Goal: list the SAME product (PWA) as native apps. Two proven wrappers:

## Google Play — TWA (Trusted Web Activity) — do this FIRST
- Cost: **$25 one-time** developer account.
- Tool: Bubblewrap CLI wraps loadboot.com/app into an Android app (no code rewrite).
- Requirements: HTTPS ✓ · valid manifest ✓ (name, icons 192/512 ✓, maskable ✓, start_url /app/ ✓) · **assetlinks.json** at /.well-known/ with the signing key fingerprint (generated during Bubblewrap build) · Lighthouse PWA pass (service worker ✓, offline page — verify).
- Store assets needed: 512×1024 icon ✓ (have 1024) · feature graphic 1024×500 (make from brand kit) · 4–8 phone screenshots · privacy policy URL ✓ (privacy.html) · data-safety form (GPS: per-trip consent; documents: private storage).
- Review time: usually days.

## Apple App Store — Capacitor wrapper
- Cost: **$99/year** + needs a Mac (or cloud Mac ~$20/mo) for Xcode builds.
- Apple rejects "just a website" (Guideline 4.2) → our app qualifies because it has real functionality (GPS stamps, push, camera docs, offline queue), but wrap with Capacitor and add native touches: app icon set, splash (bootIn), push via APNs (needs FCM/APNs bridge — extra work), camera plugin for POD scanner.
- Realistic order: Play first (cheap, fast), Apple after first 20–50 Android/PWA users.

## Pre-store checklist (both)
1. Deploy current batch; 2. LLC + D-U-N-S (Apple needs legal entity for org account — personal account possible but shows personal name); 3. Screenshots after UI is final; 4. Support email + privacy policy links in listing; 5. Version/update discipline (sw.js cache bump per release ✓ pattern exists).
