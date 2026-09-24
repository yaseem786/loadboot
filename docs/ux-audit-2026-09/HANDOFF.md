# UX / product audit — A to Z (Amazon/Uber bar) — BATON

Started 24 Sep 2026 on Yaseen's word. Separate from the security relay (`docs/audit-2026-09/`).
Order he chose: **Broker portal → Carrier → CC → Agent/Dispatcher → Marketing site**.
Policy: audit + fix across all lanes; DB changes staging → test → prod; emails, deletes and
provider settings still need his explicit yes. Screens are judged at 390px (phone) and 1366px.

## How the audit is run (repeatable)
1. `LOADBOOT_STAGING_ANON_KEY=<staging publishable> python build_site.py` (staging-bound build).
2. `python -m http.server 8080 --directory site`.
3. Playwright (Chromium) against localhost, signed in as a STAGING persona
   (`broker@lb.test`, see docs/SS-PIPELINE-HANDOFF.md). Never a real account.
4. Per tab: full-page screenshot, page height, button count, horizontal-overflow check,
   console/network errors. Fix → rebuild → re-shoot the same screen.

## Broker portal — FIXED (commit on main, 24 Sep)
| # | Sev | Finding | Fix |
|---|---|---|---|
| B1 | P1 | Phone dashboard was **10,000px** — full payables ledger (every item with its own Pay button) + full My-loads list duplicated from Invoices / My Loads | Dashboard payables = one slim row per unpaid trip (lane · carrier · items · amount due) + "Review & pay N trips →" to Invoices; My loads = newest two + "View all loads →". Now **3,689px**. Invoices tab unchanged. |
| B2 | P1 | Phone top bar title truncated on every tab ("Re…", "Cl…") | Kind pill hidden ≤560px (already in drawer); title ellipsis only when truly long |
| B3 | P1 | Every card title right-aligned (carrier.css `space-between` with icon + h3 only) | `.cp-cardhead` title sits by its icon, takes free space (partner-premium.css) |
| B4 | P1 | Requests tab wider than the phone (domain-check pill) | pills wrap inside the column |
| B5 | P1 | Chat teaser told brokers/shippers "I can see your verification, trucks and payment setup" (carrier copy) — and showed on the signed-out login/sign-up screen, covering "Create account" | portal teaser only once signed in; partner/agent get their own copy (liveChatCore.js) |
| B6 | P1 | Sign-up had no Terms/Privacy notice | "By creating an account you agree to … Terms of Service and Privacy Policy" under the button |
| B7 | P1 | Raw Supabase errors shown ("Error sending confirmation email", "Invalid login credentials") | mapped to plain sentences |
| B8 | P2 | Sign-up accepted 6-char passwords | client-side minimum 8 (server min is still 6 — see open O3) |
| B9 | P2 | "Forgot password?" shown in sign-up mode; "Are you a carrier? →Staff? Command Center →" glued together | hidden in sign-up; links spaced |
| B10 | P2 | Expired load showed green "Posted" pill beside a red EXPIRED banner | header pill reads "Expired" |
| B11 | P2 | Payables card had two ⇞ icons in its title | one |

| B12 | P1 | Load cards: every action button on its own line on phone (My loads was a card inside a card → 290px action row; "Update pickup time"+"Docs" = 293px) | outer card chrome off on phone; packet labels shortened ("Carrier packet", "Packet after booking"). My Loads 4,212 → 3,589px. No action removed or rewired. |
| B13 | P1 | Open-pool shipper freight exposed the shipper's pickup/delivery contacts to every approved broker before anyone claimed it | **`bl_ux_0430_shipper_pool_contacts`** — `cc_broker_shipment_inbox` returns contacts NULL + `contacts_hidden=true` while `assigned_broker is null`; the claiming broker sees them as before. Staging: rollback-txn test both cases (pool → null, assigned → shown). Prod: pre-flight md5 `c0879c50…` = staging, applied, `anon` still has no EXECUTE. UI says "Pickup & delivery contacts unlock when you claim this freight." |
| B14 | P1 | "Post" (tab-bar FAB, hero button, dashboard banner) scrolled to a wizard buried under payables/KPIs/loads; async cards kept pushing it off-screen | wizard opens on its own at the top with "✕ Close" (focus view); trust-gate's goPost left as before |
| B15 | P1 | Wizard validation = one red paragraph under the form; nothing on the fields | missing lane fields outlined red + `aria-invalid`, first one focused and scrolled to centre; steps 2–3 scroll the message into view |

| B16 | P1 | **Track live** modal fired `cc_load_stops(<partner_loads.id>)` → 400 "load not found" on every open; extra-stop geofences never drew | **`bl_ux_0431_track_load_id`** — `cc_partner_track_load` board object now carries `load_id` (anchor replace on the live def; staging rollback-txn test as broker: `board.load_id` = `posted_load_id`, `cc_load_stops` count 2). Applied staging + prod; anon-SECDEF names compared on prod: unchanged; function not anon-exec. Client asks for stops with `bd.load_id` after the first draw. |
| B17 | P2 | Track live on phone: six milestones in one 390px row, 3-line labels | premium.css wrap rule lost to the modal's inline `<style>`; now `.cp-modal-card .lt-step` 3 + 3, connector hidden at row end |
| B18 | P1 | **2FA setup** showed the literal text `data:image/svg+xml;utf-8,` beside the QR (Supabase returns a data URI; it was injected as HTML) — partner AND carrier | rendered as `<img>` when the value is a data URI (both portals) |
| B19 | P1 | 2FA: close the setup dialog without a code → unverified factor left behind → next "Enable" fails with raw `A factor with the friendly name "Authenticator app" for this user already exists` | `mfaEnrollTotp` (shared) unenrolls stale unverified TOTP factors before enrolling; the residual error is mapped to a sentence. Re-tested: Enable → Esc → Enable opens the dialog again. |
| B20 | P2 | Account → Notifications: push button stuck on "…" (`navigator.serviceWorker.ready` never settles without a registered worker) | `isPushEnabled` races a 4 s timeout → "Enable on this device" |
| B21 | P2 (O4) | Claim evidence timestamps "7/18/2026, 6:16:30 AM" | `fmtWhen` → "Jul 18, 6:16 AM" (year only when not this year) across filed / timeline / dwell / stop docs / cancellation trail; "N need review" pill no longer wraps |
| B22 | P2 (O2) | Payables items carried a PAY BY/OVERDUE chip AND a "DUE" pill | pill dropped when the chip is present |
| B23 | P2 | "No invoices yet." sat under ~540px of white (carrier.css `.lb-state{min-height:70vh}` meant for full-page states) — same on facility Appointments / Invoices | `.cp-card .lb-state, .cp-tablewrap .lb-state { min-height:0 }` |
| B24 | P2 (O5) | Agents tab opened with a 12-line paragraph | three bullets + `<details>` "How it works" |
| B25 | P2 (O6) | Market rates state boxes clipped their placeholder on phone | ≤560px the two inputs share the row, miles + button wrap below |
| B26 | P1 | **Facility** dashboard on phone scrolled sideways (567px): one-column shell top bar = logo + company + kind chip + bell + avatar + Sign out | ≤560px: company name ellipsis, kind chip hidden, tighter gaps (shipper uses the broker shell and was fine) |
| B27 | P1 | **Carriers** tab on phone = 7,272px (12 full profile cards: 4-KPI band + capacity + coverage chips each) | ≤560px the KPI band and chip sections hide; name, rate line, status strip and both actions stay; "View full profile" has the rest. Now 4,981px. |
| B28 | P2 | API key create: one-time secret rendered under the form, below the fold on phone; "Copy key" gave no feedback; a revoked key's secret stayed on screen | scrolls into view on create; "Copied ✓"; cleared on revoke. Create → revoke walked on staging (throwaway key, revoked). |
| B29 | P2 (O11) | Claims: "Approve" was a native `confirm()`, "Reject" a native `prompt()` | Claim review sheet (`openClaimReviewSheet`): kind · lane · amount, carrier / ref / filed; "Evidence on file" (rate-card calc, dwell held/free/detention + GPS metres from pin, stop-document count, carrier's note); what happens next; optional note on approve, required reason on reject with inline error; toast on success. RPC unchanged (`cc_partner_review_claim` accepts a note on approve → `broker_note`). Writes NOT exercised — the two pending staging claims stay as fixtures. Phone + desktop shot. |
| B30 | P3 (O12) | "Pay this claim" bank panel could not be folded back | "Hide" in the panel header restores the button |
| B31 | P2 (O14) | Shipper phone dashboard: 9-row onboarding packet, each row = label / tag / Pending pill + Submit on three lines | One line per item, "Pending" pill dropped (said nothing beside "Submit"); items that gate posting first, "Before your first booking & optional (6)" folded in a `<details>` that opens by itself once nothing gating is left; submit `alert()` → toast. Shipper phone **3,287 → 2,428px**. |
| B32 | P3 (O14) | Business-check notice read "domain lb.test has no mail (MX) records. Enter an address on your company's real domain under Onboarding — we send it a code." | **`bl_ux_0432_shipper_check_copy`** — anchor replace on `app_private.shipper_check_collect`: "Email at acme.com does not receive mail, so we could not confirm your business automatically. Add an address on your company's own domain under Onboarding and we will send it a code there." Staging + prod (both md5 `59428b60…` before, anchor count 1); staging cron `lb-shipper-check-collect` succeeded after; in-app only (`notify_partner` sends no email). Existing notification rows keep the old text. |
| B33 | P3 (O15) | Chat teaser popped over open dialogs (2FA, Track live, claim sheet): z-index 2147483645 vs modal 1000, and it fired while a dialog was open | Teaser z-index 999 (any portal modal scrim covers it); with a `[role=dialog]` open it waits 20 s and retries instead of spending its once-per-session shot (liveChatCore.js) |
| B34 | P3 (O13) | Carrier setup packet modal (Track live → 🔓 Carrier packet): rows wrapped on phone, VALID/verified landed centred under long labels | Two fixed columns, REQUIRED tag no-wrap. Walked on staging: Track live → Carrier packet opens, 8/8 mandatory verified, no 4xx. |

## Broker portal — OPEN (next)
- **O1b (P2)** Load cards still carry up to 5 actions; a "More ⋯" menu for Docs / Cancel would take one more row off each card. Delivered loads still offer "Request change" — confirm with Yaseen what that is for after delivery.
- **O3 (P1, security/config)** Supabase Auth minimum password length is 6 on staging (check prod in dashboard → Auth → Providers → Email). Raising it is a provider setting → Yaseen's yes. Pairs with open F15 (leaked-password protection).
- **O7 (P3)** `is_my_org_agent` RPC is called before sign-in → 401 on every login page load.
- **O8 (P3, env drift)** STAGING lacks `app_private.tele_ingest` (`bl_obs_0213_client_telemetry` never applied there) → every web-vital from a staging build 404s. Prod is fine.
- ~~O10~~ **closed 24 Sep (Yaseen: "suggest and implement")** — the six investor names were not a deliberate anon surface:
  Supabase's default ACL gives every new `public` function an explicit `anon=X`, and the bl_inv migrations only revoked
  PUBLIC. All six refuse anon on their first line anyway. `bl_sec_0436_inv_anon_revoke` (staging 38 → 32, prod 39 → 33,
  names = baseline). Rule added to CLAUDE.md §4 and the baseline doc.
- Walked this session: claim review sheet (approve + reject, phone + desktop), Track live → Carrier packet (booked load), shipper phone dashboard; earlier: Claims evidence/pay panel, Track live, Carrier packet preview, Account/2FA/push/devices, Developers key create+revoke, desktop layouts of dashboard/claims/account/loads/invoices/requests/carriers/network/onboarding/developers (no overflow, nothing broken), shipper + facility dashboards (phone + desktop).
- Not yet walked: Post-a-load wizard steps 2–3 end to end, claim Approve/Reject WRITES (sheet opens and validates; needs a throwaway claim from the carrier lane), shipper/facility inner tabs and forms (dock appointment create), Network tab content, Documents (onboarding) submit flow.

## Carrier portal — FIXED (24 Sep, cloud session; carrier-owner@lb.test, staging build)
Harness that worked here: `node` with `import ... from '/opt/node22/lib/node_modules/playwright/index.mjs'`, Chromium
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with args `--ignore-certificate-errors --disable-http2
--proxy-server=$HTTPS_PROXY --proxy-bypass-list=localhost;127.0.0.1` (Playwright's own `proxy:{bypass}` did NOT bypass
localhost — the 405 "only accepts CONNECT" page came back for the app itself). Login screen asks "Who are you signing in
as?" first — click **Carrier owner**, then the email/password fields become visible. Realtime websockets 500 through the
session proxy: harness noise, not a product bug.

| # | Sev | Finding | Fix |
|---|---|---|---|
| C1 | P1 (prod bug) | **Support → "Your tickets: Failed to load."** and the dashboard announcements strip never loaded: `cc_pocket_my_issues` and `cc_pocket_announcements` both `RETURNS TABLE(id uuid, …)` and open with `select id into v_org from public.organizations …` → 42702 "column reference id is ambiguous" on EVERY call, prod and staging alike (md5 `1e6b73e4…` / `0e8d7d70…` before). | **`bl_ux_0433_pocket_id_ambiguous`** — anchor replace on both live defs (`select o.id … from public.organizations o …`). Staging rollback-txn test as carrier-owner: issues 0 rows (none filed), announcements 3 rows. Applied staging + prod; prod md5 now `49141f4e…` / `8a1b64cb…`, neither anon-executable (never were), anon-SECDEF count 39 = unchanged. Support tab re-shot: no 4xx. |
| C2 | P1 | **My Loads** on phone = **6,777px**: 11 trips, every one a full card (stepper, Load details / Dispatch pack / Pay claims / Proof of delivery / Contact / Documents & tools), cancelled loads from July carrying the whole cancellation panel + GPS evidence | ≤560px a finished trip (delivered / cancelled) after the first two is one slim row: lane · status · date · rate · "Details ▾", which swaps in the full card (walked: Baltimore → Nashville expands, no overflow). Now **2,775px**. Desktop unchanged. |
| C3 | P1 | **Documents** on phone = **7,364px**: every requirement card had ~120px of dead space above and below its status row — the card is a column-direction `.cp-row`, and `carrier-dark.css` gives `.cp-card .cp-row>div:first-child` `flex:1 1 220px`, which in a column becomes 220px of HEIGHT. Plus "My uploads — review status" repeated every file already listed above. | `.cp-row-col` class on the requirement card + `flex:0 0 auto` for its first child; "My uploads" is a `<details>` folded on phone (open on desktop). Now **4,141px**. |
| C4 | P2 | Dashboard listed every unread notification in full (9 × "Tracking dark … Mark read") | newest 3 + "N more unread → Alerts" (N from the real unread count). Dashboard 4,933 → 4,669 even though announcements (C1) now add three rows. |
| C5 | P2 | Finance fee invoices: 10 rows × PDF / Factoring packet / Pay now / Dispute on phone | ≤560px unpaid (`sent`) + the newest three show, the rest behind "Show N older invoices". No visible change on staging — all ten fixtures are `sent` (all unpaid stay visible on purpose). |
| C6 | P3 | Dispatcher tab: the four "How the program works" answers all open (5,259px) | `<details>` closed on phone, open on desktop. 4,657px. (A stray `//` comment I put mid-line broke the tab once in the built bundle — "Unexpected token ';'" — caught by the re-shoot, removed.) |
| C7 | P3 | Dashboard "Active trips" row read `in_transit · 781 mi · $2,850` beside an "On The Road" pill | raw status dropped from the subtitle |
| C8 | P3 | Settings → Delete account: "Read the full policy →" glued to the red button | link inline-block with a 14px gap |
| C9 | P3 | Active trip countdown read "⚠ DELIVERY OVERDUE BY **-130:26:25**" | ≥48 h shows "5 d 10 h"; the minus is gone (the label already says overdue) |
| C10 | **P1 (prod bug)** | **No phone or ELD GPS ping has landed since bl_drv_0345a.** `cc_pocket_post_location` writes `source = owner_app / driver_app` and `eld_ingest` writes `eld:<provider>`, but `trip_locations_source_check` (cvy_trip_tracking) still allowed only the original seven values → 23514 on every insert. The client swallows it (`postLoc` → false, trip-map `.catch(() => {})`), so it was invisible: prod holds **one** `trip_locations` row ever (1 Jul), staging only `carrier` rows; the "Tracking dark" reminders fire because nothing ever lands. Found by the Request-to-book walk with geolocation granted (400 on the ping). | **`bl_ux_0434_trip_locations_source_check`** — check widened to the nine names + `like 'eld:%'`. DDL only. Staging: rollback-txn insert of owner_app / driver_app / eld:samsara / eld:generic accepted, `portal` still rejected; carrier-owner walk re-run → no 400 (harness rows deleted after). Prod applied; constraint def verified; anon-SECDEF names = 39, unchanged (same six investor names as O10). Prod had 0 consented active trips at the time, so no live trip lost pings today. |
| C11 | P3 (native dialog) | Settings → "Delete my account" was a native `confirm()` | In-app sheet (`openModal`): what happens, "Keep my account" beside the red "Yes, delete my account"; the request fires only from the red button. Opened + closed on staging; write NOT exercised. |
| C12 | P3 (copy) | Alerts: "🛰 Tracking dark for **9275 min** — turn GPS back on" (×52 on the staging persona); same raw minutes in the broker notice, staff notice and audit line | **`bl_ux_0435_tracking_blackout_span`** — anchor replace on `app_private.cron_tracking_blackout` (4 anchors, counted before execute; staging md5 `9bf40ce9…`, prod `af29d6fb…` differ elsewhere but the four lines matched): ≥48 h "6 d 10 h" · ≥2 h "2 h 15 min" · else "45 min". Staging + prod applied; span expression checked for 45/119/135/2879/9275. Existing notification rows keep the old text. |
| OC1 → C13 | P2 | Fleet phone 5,489px: ELD card carried the six Samsara/Motive steps + admin note open before a provider was picked | Steps + note behind "How to get your Samsara token (6 steps)" `<details>` — closed ≤560px, open on desktop; phone drops the intro line the benefit box repeats; Show + Test & connect on one row. Copy, steps, benefit box and WhatsApp box unchanged. Fleet phone **5,489 → 5,032px**; ELD card 1,641 → 1,184. |

Walked (phone 390 + desktop 1366, every nav tab + onboarding/notifications/settings): no horizontal overflow anywhere
(Account's nav chips scroll inside their own strip — the overflow probe flags them, the page does not scroll). Desktop
heights: dashboard 3,086 · trips 4,889 · documents 6,207 (pre-C3; re-shoot) · fleet 3,630 · finance 3,102 · account 3,009.

## Carrier portal — OPEN (next)
- ~~OC1~~ → C13 (done).
- **OC5 (P3, no fix)** Account tab on phone = **5,727px**, but it is every section in one column (Profile 286 · Verification 381 ·
  Business 390 · **Dispatch preferences 1,667** · Security 315 · Notifications 628 · Payments 412 · Support 195 · Legal 307 ·
  Danger 333) and the chip strip jumps between them. The 1,667px is a real form (equipment, lanes, rates, toggles), not dead
  space — left alone. Desktop 3,009.
- **OC6 (P3)** Safety → "+ Add contact" with empty fields shows the server's "name and phone required" inline — plain enough,
  but no client-side check; and the "Report a problem on this trip" incident sheet only renders with an active trip (none on
  the persona) — not walked.
- **OC7 (P3)** `/app/carrier/#driver` sets ROLE=driver but still shows the role picker (`roleChosen` only reads `?role=`).
  Driver mode itself needs a driver persona on staging — none in SS-PIPELINE-HANDOFF; not walked.
- **OC2 (P3)** Ratings/Health on phone = 4,573px (score, breakdown, reviews, trust profile, "how your score works" all in
  one column). Nothing broken; a fold on the explainer would take ~600px off.
- **OC3 (P3)** Desktop My Loads still renders the full cancellation panel + GPS evidence on months-old cancelled loads
  (C2 is phone-only, like B1/B12). Same slim-row treatment would work at 1366 if Yaseen wants it.
- **OC4 (guess, needs a look)** `cc_pocket_*` scope the carrier by `organizations.owner_user_id = auth.uid()` — a
  non-owner carrier login (staff / a second admin, if those exist) would get "not a carrier account" on Support and
  announcements. I did not verify whether such logins exist; C1 did not change the scoping.
- Staging `track_web_event` 404 on every page = O8 (unchanged).
- Walked this session (phone 390): Post availability sheet (opens full-screen; empty submit → "Truck required" toast +
  field outline, fine), Request to book + Propose rate modals (open, no overflow; sends NOT exercised), Safety tab, Alerts tab
  (filters / Mark all read / Open → layout fine), Settings (referral code + Copy my link, devices list, delete sheet),
  Onboarding step 1 (94%; steps 2–6 "Save & continue" would rewrite the persona's onboarding — not walked), ELD card fold
  open/closed. Harness needs `geolocation` + `permissions:['geolocation']` on the context or Request-to-book waits on the
  location modal.
- Not yet walked: driver mode (needs a driver persona), W-9 wizard + agreement e-sign (onboarding steps 5–6, writes),
  Request-to-book / Propose-rate SENDS, Safety incident sheet (needs an active trip), Account → Verification/Business
  form submits.

## LOG (append only)
- 2026-09-24 — Claude (cloud session): broker portal pass 1. Fixed B1–B11 in app/partner/app.js, app/partner/partner-premium.css, app/shared/ui/liveChatCore.js. esbuild OK, BUILD OK, re-shot. NEXT: O1 (load-card actions) then the unwalked flows above.
- 2026-09-24 — Claude: Yaseen said "suggest and implement". O9 → B13 (bl_ux_0430 staging+prod), O1 → B12. O3 (Auth min password 8) needs the Supabase dashboard — no API from here; steps given to Yaseen.
- 2026-09-24 — Claude: B14 focus-view post wizard, B15 field-level validation (step 1). Verified on staging build: 8 fields flagged, focus o_street, Close returns to dashboard.
- 2026-09-24 — Claude (cloud): B16–B28. DB: bl_ux_0431 (staging + prod, additive `board.load_id`). Staging passwords for shipper@lb.test / facility@lb.test reset to the SS-pipeline value (staging only). Harness note: global Playwright at /opt/node22/lib/node_modules/playwright, Chromium needs `--ignore-certificate-errors --disable-http2` behind the session proxy. NEXT: O11 (claim review sheet) → O14 (shipper phone length) → then Carrier portal per the order.
- 2026-09-24 — Claude (cloud): B29–B34 (O11–O15 closed). DB: bl_ux_0432 (staging + prod, copy only, app_private). Prod anon-SECDEF names diffed: 39 = baseline 33 + 6 investor-lane names (see O10). Broker/shipper/facility pass is DONE except O1b/O3/O7/O8. NEXT: **Carrier portal** (carrier-owner@lb.test, /app/carrier/) — same harness, same per-tab shot loop; first pass = phone height + overflow + console per tab, then fix.
- 2026-09-24 — Claude (cloud): **Carrier portal pass 1** — C1–C9. DB: bl_ux_0433 (staging + prod; two `public` SECURITY DEFINER RPCs re-created with the org lookup qualified — a real prod bug, every carrier's Support tickets and announcements were failing since wave K). UI: app/carrier/app.js, carrier-dark.css, dispatcher-desk.js. Phone: trips 6,777 → 2,775 · documents 7,364 → 4,141 · dispatcher 5,259 → 4,657 · dashboard 4,933 → 4,669. NEXT: OC1 (Fleet ELD fold) → unwalked carrier flows above → then Command Center per the order.
- 2026-09-24 — Claude (cloud, branch claude/gallant-johnson-9qvo91): OC1 → C13 (eld-connect.js fold). Flow walk found **C10**
  — `trip_locations_source_check` rejected every owner_app / driver_app / eld:<provider> ping since bl_drv_0345a (prod: one
  GPS row ever). DB: bl_ux_0434 (staging + prod, DDL), bl_ux_0435 (staging + prod, app_private cron copy). UI: C11 delete
  sheet. Prod anon-SECDEF names: 39, unchanged. NEXT: the "not yet walked" list needs personas/fixtures (driver login, an
  active consented trip, a throwaway carrier for onboarding 5–6) — then **Command Center** per the order. O10 closed (bl_sec_0436). Still waiting on Yaseen: O3 (Auth min password 8 — dashboard, steps given).
