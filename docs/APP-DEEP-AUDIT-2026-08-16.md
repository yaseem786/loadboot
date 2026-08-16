# LoadBoot App — Deep Audit vs Big-Brand Apps (Amazon, Uber, Uber Freight, DAT, Truckstop, Relay…)
**Date:** 2026-08-16 · **Scope:** Carrier portal (Play Store TWA), Partner portal, chooser/signup shell, PWA infra, Command Center shell. Benchmarked against consumer leaders (Amazon, Uber, Airbnb, DoorDash) and 15 trucking competitor apps (Uber Freight, DAT One, Truckstop Go, Amazon Relay, Convoy/Flexport, TruckSmarter, CloudTrucks, Trucker Path, CHR Navisphere, J.B. Hunt 360, Schneider FreightPower, Motive, Samsara, Bobtail, Landstar).

## What LoadBoot already does at big-brand level
Instant booking + counteroffer, live trip map with OSRM ETA + geofences, GPS detention/lumper/TONU claims with auto evidence (Convoy-grade), per-load profit estimator (DAT-grade), post-a-truck auto-match, fleet mode with VIN/CDL validation, full finance suite (P&L, IFTA, payroll, QuickBooks), factoring/NOA routing, POD upload with version history, notification inbox with mark-all-read (carrier), update-prompt PWA flow, exemplary logout hygiene, strong telemetry, broker-side live tracker with timeline + live ETA, carrier vetting UI (broker side) with FMCSA + reviews histogram.

## Gap matrix (what big brands have, LoadBoot lacked)

### P0 — store-policy / broken
1. Partner portal has NO delete-account flow (Google Play policy 5.1.1(v) blocker; carrier has it).
2. `loadboot.webmanifest` (the only complete manifest, with shortcuts) was linked by NOTHING — chooser/signup had no manifest at all. (Note: agent/CC manifests DO exist — an earlier sub-audit flagged them missing due to incomplete file staging, corrected.)
5. Partner sign-in has NO forgot-password path — locked-out brokers are stuck.
6. SW push: no `pushsubscriptionchange` handler (push silently dies), favicon.ico used as icon (degraded Android notification), default deep-link sends brokers into the carrier app.
7. Chooser + signup have no offline shell (raw browser error offline).

### P1 — table-stakes every big app has
8. Skeleton loaders: ZERO in app (37+ bare "Loading…" strings). Amazon/DoorDash/LinkedIn standard.
9. Pull-to-refresh: none anywhere (partner also has no refresh button at all).
10. Saved loads / favorites / recent searches / persisted filters: none — DAT/Truckstop/TruckerPath table stakes. Load-board filters reset on every render.
11. Haptics: 1 call site in whole app (Uber/DoorDash use on every confirmation).
12. Push opt-in nag loop: permission cards re-appear on EVERY dashboard visit (dismissal not persisted); no denied-recovery path.
13. Entity deep links: hash routing is tab-only — a "detention approved" notification can't open that claim; nothing is shareable.
14. Post-a-load wizard (~60 fields, 5 steps) has zero draft persistence — one refresh wipes it (broker).
15. In-app help center/FAQ: none (Uber/DoorDash/Amazon all have searchable in-app help).
16. Referral: full carrier referral UI exists in code but is unreachable for carriers (only agents/non-carriers see it); no native share sheet anywhere.
17. What's-new after update: none. Android install prompt (beforeinstallprompt): never captured in /app.
18. Tab-bar unread badges: none (badge only on header bell); no navigator.setAppBadge.
19. Doc scanner wired to only one card and only DOWNLOADS the PDF — not wired into POD upload where it matters.
20. No contact/help action on trip tracking screens (both portals) — Uber's #1 tracking-screen affordance.
21. Undo-style destructive actions: 0 undo; carrier has 57 alert() + 9 confirm(); partner 35 alert() + 5 prompt().
22. Partner Account page is a stub: no theme, no legal links, no version, no notification prefs, no privacy.
23. Market-rate insights not shown at the negotiation moment (counteroffer modal) — only on separate tab.

### P2 — differentiators / bigger builds (backlog)
2FA enforcement + WebAuthn/passkey login, per-device session management, data-download (DSAR), notification category×channel matrix (needs backend), offline mutation queue, broker credit/days-to-pay data on loads, fuel price finder + fuel card, multi-leg trip builder (Landstar Ask Max style), loyalty tiers, facility (not just broker) ratings, in-app Play review prompt, live activities/ongoing notification, share_target manifest (share BOL photo straight into LoadBoot), swipe actions, number count-up animations, focus-trap a11y in modals, reduced-motion coverage.

## Page-by-page highlights (carrier)
- **Dashboard:** permission nag loop; silent catch renders zeros on API failure; no skeletons.
- **Load board:** no saved search/favorites/recents/sort; deadhead radius stored but not filterable; rates widget not inline.
- **Trips:** stepper has no timestamps; 15 chips with no hierarchy; no contact action; scanner not wired to stop-proof/POD.
- **Finance:** section state not persisted; plaintext earnings (no mask option); dead-end errors without retry.
- **Documents:** scan→download→re-pick loop; W-9 wizard loses all 5 steps on backdrop tap.
- **Account/Settings:** security section is labels over sign-out (no 2FA/sessions/devices); two conflicting account-closure paths (mailto vs self-service).
- **Support:** no FAQ tier; ticket form pre-attaches nothing; live chat invisible from support ladder copy.
- **Notifications:** taps route to a tab, not the entity; not placeable on tab bar; no category filter.

## Page-by-page highlights (partner)
- **Auth:** no forgot password, no show-password toggle.
- **Dashboard:** triple-fetches partnerMyLoads per render; layout shift from 5 async blocks.
- **My Loads:** no search/filter/sort/pagination at 50 loads; no per-load deep link; no POD viewer.
- **Post-a-load:** no draft persistence; no success moment; no re-post-as-new/templates.
- **Tracker:** no contact actions, no POD at delivered node, no share-tracking link.
- **Account:** 2 cards where ~7 sections expected; no delete account.
- **Network:** rating via browser prompt(); referral has no share sheet.

## IMPLEMENTED in this session (all additive, esbuild-verified, in the working tree)

**New shared modules:** `shared/ux.js` (skeleton loaders + haptics + pull-to-refresh + OS app-icon badge), `shared/whatsnew.js` (once-per-build "What's new" card), `shared/installprompt.js` (Android A2HS install pill via beforeinstallprompt, 14-day cooldown), `shared/faq.js` (searchable in-app Help Center — 15 carrier + 10 broker articles).

**Carrier portal:** skeleton loaders replace "Loading…" on dashboard/trips/fleet/finance/load-board; pull-to-refresh on every page; haptics on toasts, saved-load star, POD scan, booking flows; ★ Saved loads (favorites) on every load card + "★ Saved" filter chip; load-board filters persist across visits (smart defaults) + Clear resets them; entity deep links `#loads/<id>` (opens the load detail) and `#trips/<id>` (scrolls + highlights the trip) — notifications/push/shares can now target an exact entity; "Alerts" added to NAV (can be placed on the bottom tab bar) with unread badge + `navigator.setAppBadge` unread count on the app icon; push opt-in nag loop fixed (dismissal persists 14 days) + notifications-blocked recovery card; camera Scan-to-POD: photos → single PDF → straight into the POD uploader (no more download/re-pick loop); 📞 Contact chip on every trip card (call dispatch / live chat / ticket) — Uber's tracking-screen pattern; searchable Help Center card at the top of Support; 🎁 Invite & earn referral card in Settings (referral UI existed but was unreachable for carriers) + native share sheet; retry buttons on trips/finance/notifications load failures; emergency-contact delete now confirms; W-9 wizard auto-saves a draft (backdrop tap no longer wipes 5 steps); "What's new" card after updates; push subscription self-heal on boot.

**Partner portal:** Forgot-password link on sign-in (locked-out brokers had NO recovery path); Account page completed — push notifications card, searchable Help Center, About & legal (privacy/terms/version/sign-out), and **self-service Delete account** (Google Play policy blocker closed); Post-a-load wizard auto-saves a draft as you type (localStorage, cleared on submit) — refresh no longer wipes ~60 fields; success toast + haptic on load submit; pull-to-refresh; What's-new card; push self-heal.

**PWA/infra (build_site.py service worker):** chooser + signup now have offline shells (previously raw browser error); push notifications use a real 192px icon (was favicon.ico → degraded on Android), default deep link fixed `/app/` (was `/app/carrier/` — misrouted brokers), collapse `tag` support; `pushsubscriptionchange` handler added (browser subscription rotation no longer silently kills push — SW relays the new subscription and the app re-saves it, plus boot-time self-heal). Manifests: carrier/partner get `id`, `categories`, `display_override` and long-press app `shortcuts` (Find loads / My loads / Documents / Alerts; Post / Loads / Invoices); agent + CC manifests get `id`; the orphaned `loadboot.webmanifest` is now linked from chooser + signup. CSS: skeleton/PTR/badge styles + a blanket `prefers-reduced-motion` guard.

**Batch 2 (owner granted permission for backend/owner-decision items mid-session):**
Real **2FA (TOTP)** via Supabase Auth MFA — enroll with QR in carrier Settings → Security and partner Account → Security, code challenge at sign-in in both portals; **Sign out everywhere** (revokes all sessions on all devices, both portals); **Download my data** (JSON export of profile/loads/invoices/docs/claims, both portals); **lane-rate market context right inside the booking and counteroffer modals** (DAT-style low/avg/high $/mi + above/below-average verdict); **Web Share Target** — share a BOL/POD photo from the phone gallery straight into LoadBoot → lands as an upload banner in Documents (manifest + service worker + inbox); **store-review ask** after a 5-star rating (90-day cooldown, Play listing deep link); partner **My Loads search + status filter** with result counts; partner **claims tab badge** + app-icon badge; broker tracker **contact actions** (chat with dispatch + email); **backnav correctness fixes** (re-init orphan unwind, non-top popLayer desync); **focus trap + role=dialog/aria-modal** on every modal in both portals; **CC login forgot-password**; trips designed empty-state with CTA.

**Batch 3 (owner said: close every point — including backend):**
alert()→premium-toast shim (92 blocking browser alerts across both portals now render branded toasts); KPI **count-up animations** (reduced-motion aware); **swipe-left-to-mark-read** on notification rows; offline **support-ticket outbox** (queued + auto-sent on reconnect); **multi-leg Trip Builder** on the Load Board (chains 2 loads into revenue-ranked tours with connect-deadhead math — Landstar Ask-Max pattern); **LoadBoot Status tiers** (Bronze→Platinum from real delivered/on-time record, progress bar) on the Ratings page; notification prefs completed over the real backend columns (product announcements + pause-all added).

**Backend shipped (migration `bl_ux_0192`, staging → production, anon surface verified unchanged):**
⛽ **Fuel price finder** — DOE/EIA weekly regional diesel prices (all 9 regions + US average, live data week of Aug 10) on the Market Rates tab, auto-refreshed by a weekly scheduled task every Tuesday; 💰 **Broker pay-speed ("days-to-pay")** — computed from LoadBoot's own settlement transfer records, shown on every load card's broker box (the honest equivalent of DAT's credit data, no external bureau needed); 📱 **Signed-in devices list** — real per-device registry (label + last-active, current-device pill) in both portals' security sections; 🏭 **Facility ratings** — carriers rate pickup/delivery facilities after delivery (one-tap stars in the trip rating flow), crowd-sourced averages shown on load detail (Uber Freight's facility-insights pattern).

**Not codeable (business deals, not software):** an actual fuel *card* program and external credit-bureau data both require commercial partnerships (WEX/Comdata, Ansonia/OTR) — the software side (fuel prices, own-data pay-speed) is now live. Offline *mutation* queue for money actions remains a deliberate non-goal (support tickets are queued; payments never will be).
