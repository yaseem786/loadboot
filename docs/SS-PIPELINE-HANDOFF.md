# SS-PIPELINE — Automated 3x portal screenshots (Amazon-Relay standard)
GOAL: Claude captures ALL marketing screenshots itself in the sandbox with headless
Chromium at retina DPR, processes them to WebP, drops them in /shots, rebuilds, commits.
Owner does nothing. This doc is the complete recipe — execute top to bottom.

## 0. Preconditions (already done by owner on 2026-07-18)
- Claude app Settings → Capabilities → "Allow network egress" ON, allowlist
  "Package managers only" + additional domains: storage.googleapis.com,
  cdn.playwright.dev, playwright.azureedge.net, *.supabase.co
  (VERIFY spelling: s-u-p-a-b-a-s-e). New sessions pick these up; old ones don't.
- Verify: `pip download playwright -d /tmp -q` works. If proxy 403 → ask owner to
  double-check the toggle/domains, or restart the app.

## 1. Install browser
pip install playwright --break-system-packages
python3 -m playwright install chromium
# If missing shared libs: python3 -m playwright install-deps chromium  (uses apt)

## 2. Build + serve the site in the sandbox
cd /sessions/<session>/mnt/loadboot
LOADBOOT_STAGING_ANON_KEY=sb_publishable_novfrtPFC2mGjIaKvjyJMA_TVRGGvhl python3 build_site.py   # BUILD OK
# CHECK site/app/env-config.js references snslhvmkjusozgjelghi (staging). If it has the
# prod ref (rwscphuhpjoudvljvmdk), find the env flag in build_site.py that switches it.
python3 -m http.server 8080 --directory site &   # background

## 3. Test accounts (STAGING snslhvmkjusozgjelghi ONLY — never prod)
- Carrier: carrier-owner@lb.test  (org cc000000-...-0001, TRUCKING ENTERPRISE INC)
- Broker:  broker@lb.test        (org cc000000-...-0002, Persona Broker LLC)
- Owner knows the passwords; if not available, RESET on staging via Supabase MCP SQL:
  update auth.users set encrypted_password = extensions.crypt('LbShots2026!', extensions.gen_salt('bf'))
  where email in ('carrier-owner@lb.test','broker@lb.test');
  (tell the owner the new password afterwards)

## 4. Demo data already seeded on staging (2026-07-18)
- BOOKED trip: Dallas,TX → Atlanta,GA Reefer $2,850, trip af8118e5-... (RC filled,
  dispatch sheet, packet PU# 88-4471 / DL-20991, broker Persona Broker LLC)
- Available load: Houston,TX → Memphis,TN Flatbed $2,140 (tarps/team/assist chips)
- Available load: Dallas → Atlanta $2,897 (wizard-posted, partner_load 88c478ed... posted)
- Direct offers EXPIRE after 60 min. Re-send before capturing countdown shots:
  insert into app_private.load_offers (load_id, carrier_id, offered_rate, status, sent_at, expiry_at, message)
  values ('79e8ed51-0a91-4692-a6a8-7aaa315707c9','cc000000-0000-0000-0000-000000000001',2140,'sent',now(),now()+interval '60 minutes','Direct offer: steel coils Houston to Memphis, full tarps. First acceptance wins.');
- For the partner "detention accruing" shot, backdate the pickup arrive event ~3h
  (find the trip_events/stop_events table for trip af8118e5 and set arrive ts = now()-3h).
- If pickup_date has passed, bump: update public.loads set pickup_date=current_date+1,
  delivery_date=current_date+3 where id in ('8c1fd20f-...','79e8ed51-...','c1f56f2e-...');

## 5. Capture (playwright, python)
Phone context: viewport 390x844, device_scale_factor=3, is_mobile=True, has_touch=True
Desktop context: viewport 1280x900, device_scale_factor=2
Geolocation for trip-map states: context.grant_permissions(['geolocation']);
  context.set_geolocation: Fort Worth 32.7555,-97.3308 (board deadhead) ·
  Dallas pickup 32.7831,-96.7767 (geofence arrive) · Atlanta 33.7490,-84.5525
Login: goto http://localhost:8080/app/carrier/ → fill email+password → Sign in.
Prefer element screenshots (locator.screenshot) for cards/modals; full_page for RC.

SHOT LIST (save as PNG then process; name → what):
Phone (carrier): board-phone-available (board list) · board-card-details (Details open)
 · board-stops-modal (+2 stops modal) · board-request-countdown ALT phone (Requests tab)
 · booking-assign (assign driver/truck) · booking-packet (Dispatch pack modal)
 · track-phone-pickup (trip map at Dallas pickup — detention clock)
 · track-phone-map (full map + ETA) · track-phone-docs (Maps/Waze + doc buttons)
Desktop (carrier): board-web-available (filters open) · board-request-countdown
 (Requests tab w/ countdown) · board-propose-rate (modal) · booking-trip-card (My Trips)
 · booking-rate-con (RC modal, full) · booking-dispatch-sheet · track-claim (settlement/claim)
Desktop (broker@lb.test): partner-wizard-route · partner-wizard-schedule
 (re-open wizard, fill Dallas→Atlanta demo data) · partner-offers (offer picker → send 15min)
 · partner-live-tracking (booked load track view while carrier context shares location)

## 6. Process + wire (wiring ALREADY DONE — img tags exist, just overwrite files)
PIL → .webp quality=92 method=6 sharp_yuv=True into shots/<name>.webp
(keep 3x pixel size; pages display phones at ~340px so 3x = retina crisp)
cp shots/*.webp site/shots/ ; rebuild not required unless HTML changed; git commit.
The <img> tags live in build_site.py flagship pages (load-board / book-truck-loads /
gps-tracking) — only update width/height attrs if aspect ratios changed.

## 7. Standards (why): capture big (2-3x), display small; tight close-up crops for
dense regions; captions "The real …" stay. Never prod data; lb.test demo data only.
