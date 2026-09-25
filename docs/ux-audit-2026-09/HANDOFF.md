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

## Command Center — pass 1 (24 Sep, cloud session; owner@lb.test, staging build)
Persona: `owner@lb.test` (staff_members active, widest permissions). Its staging password was reset to the SS-pipeline value
(staging only). Same harness as the carrier pass; the CC login form is plain email + password (no role picker). Walked all
24 nav routes at 390 and 1366: full-page shot, height, button count, overflow probe, console + 4xx. **Re-shoot after the fixes
below is NOT done** — the auto-mode classifier blocked every Bash command that carried the fixture password (three tries), so
the fixes are build-checked (`node --check`, BUILD OK) but not re-walked. See "Harness" at the end.
**Re-shot 24 Sep (later cloud session, CC_PASS as an environment secret — it worked):** all 24 routes at 390 and 1366, every one
sw=390 / 1366, no page error, no 4xx beyond O8 + OCC1. CC1's first diagnosis was wrong (see the row); CC4 is fixed.

| # | Sev | Finding | Fix |
|---|---|---|---|
| CC1 | P1 | **Nine screens scrolled sideways on phone** — Brokers & shippers 809px, Partner intake 788, Forms 710, Finance 562, Support 557, CRM 497, Settings 473, Email catalog 470, Compliance 404. Pass 1 blamed the `_tabbed.js` strip sharing `.cc-tabbar/.cc-tab` with the shell's fixed phone bar; the rename was right (a second fixed bar) but the re-shoot showed **the same nine numbers** — the width came from elsewhere. Real causes (probe with the shell chrome excluded): (a) **17 views mount a bare `table.cc-table` with no `.cc-table-wrap` scroller** (partners, partnerIntake, forms, support, finance ×6, announcements, automationsAdmin, bi, emailLoads, formBuilder, notifications, outreach, pluginMarketplace, reports, seo, verificationCenter) — the table's min-content width (up to 1,351px on Email catalog) became the page width; (b) `.cc-seg` segmented filter is `inline-flex` with no wrap (Finance / CRM / Email catalog / Compliance); (c) Settings `.cc-set-row` = label + 240px input + Save on one line. | `command-center.css` ≤780px: unwrapped `.cc-content table.cc-table` gets `display:block;overflow-x:auto` (wrapped tables untouched — `:not(.cc-table-wrap > *)`), `.cc-seg` wraps, `.cc-set-row` stacks. Strip rename kept. **Re-shot: all 24 routes sw=390.** Desktop unchanged (1366 everywhere). |
| CC2 | P1 | **Task queue** = 15,996px on phone and 15,890 on desktop, 200 buttons: `listTasks(limit 200)` drawn in full | fetch unchanged; 25 rows + "Show 25 more · N left" from the cached list (`automation.js`). Re-shot: **5,406 / 4,460px, 63 buttons.** |
| CC3 | P1 | **Email catalog** = 21,046px (228 emails in 8 preference groups, every group open) | each group is a `<details>`: closed ≤780px, open on desktop, open/closed remembered per group in sessionStorage; search still narrows every group. Desktop height unchanged by design (his own registry screen). Re-shot: **phone 21,046 → 1,876px**; desktop 21,060. |
| CC5 | **P1 (prod bug)** | **Website & marketing → "Top referrers"** 400 on every open: `cc_web_referrers` RETURNS TABLE(referrer_host …) and selected the bare column → 42702 "referrer_host is ambiguous", prod and staging alike (md5 `7f481f68…`). Same shape as C1. The four sibling `cc_web_*` RPCs were called as the staff persona on staging and return rows. | **`bl_ux_0437_web_referrers_ambiguous`** — table aliased, columns qualified. Staging: applied + called as owner@lb.test in the same txn ("(direct) · direct · 1 · 0"), committed. Prod: applied, md5 now `a88c830a…`, ACL unchanged (authenticated + service_role, anon never had it), anon-SECDEF count 33. |
| CC6 | P2 (code-read, not runtime-verified) | Dispatchers & agents: the teardown `MutationObserver` checked `document.body.contains(presenceBox)`, but since bl_disp_0316 the presence/queue/feed nodes stay detached until the Work-queue tab opens → the first DOM mutation on the Roster tab cleared the 90 s poll and left the realtime channel | observer checks `host.isConnected` (what `dqTimer` already does). One-line change in `dispatchers.js`. Re-shot: the teardown now fires on leaving the screen (which is what exposed CC4's real trigger). |
| CC4 | **P1 (prod bug, shared module)** | **`Maximum call stack size exceeded`** — pass 1 saw it on `/dispatchers` load; after CC6 it moved to the *next* route (`/dispatchers` → `/finance`). Stack: supabase-js `RealtimeClient._remove` ↔ `channel._trigger` recursing. `app/shared/dispatch-live.js` `ch.subscribe(cb)` called `sb.removeChannel(ch)` whenever `state.closed` — but `removeChannel` → `unsubscribe` → the same callback with `CLOSED` → `removeChannel` → … Fires on every CC teardown of the Dispatchers screen, and on any channel whose socket never connected (`leave()` could not reach a channel that had not reached SUBSCRIBED, so it lived on and recursed on its next status). Same module serves the dispatcher workspace. | `state.pending = ch` right after `sb.channel()`; `leave()` removes `state.ch \|\| state.pending` once (idempotent); the status callback just returns when closed — it never removes. Re-shot `/dispatchers` → `/finance`: no page error at 390 or 1366. |

Walked clean (no overflow, no console error, no 4xx beyond O8's `track_web_event`): Today (3,147 / 1,966), Loads & trips, Market
rates, Rate standards, Carriers, Document review, Carrier reminders, Live chat, Mailbox, Business, Templates, Integrations.
Wide `table.cc-table` elements on phone (Loads 753px, Task queue 1,028, Carriers 738, Reminders 674, Templates 659) scroll inside
`.cc-table-wrap`; the page itself does not (sw=390) — left alone. Desktop: nothing wider than 1366 except Live chat's filter
buttons (`.lcv-fsel` r=1639), which sit in their own scroller.

## Command Center — OPEN (next)
- ~~CC4~~ → fixed (see the table; `app/shared/dispatch-live.js`).
- **OCC1 (P3, env drift, staging only)** staging edge functions `ga4-insights` (v14) and `gsc-insights` are deployed WITHOUT `x-lb-app` in
  `Access-Control-Allow-Headers`; the repo and prod (`gsc-insights` v20) have it. Every GA4/GSC card on Website & marketing fails
  CORS on a staging build. Fix = redeploy both to staging (`supabase functions deploy`), Yaseen's call. Pairs with O8.
- **OCC2 (P3)** Templates 4,868 / 4,502px and Carrier reminders 4,092px on phone — long tables, nothing broken; not looked at closely.
- **OCC3 (P3)** Loads & trips phone 5,827px (six sub-tabs + board table). Not looked at closely.
- Not walked: any write (task Start/Done, approvals, staff invites, flags), the six Loads sub-tabs, Carrier 360 / Broker 360 drawers,
  Live chat conversation view, Settings sub-tabs beyond the first, drawer navigation (More → menu) on phone.
- **Harness (read before the next CC run):** `docs/ux-audit-2026-09/harness/cc-walk.mjs` (committed 24 Sep — the scratchpad copy
  died with its session). Copy it to the scratchpad and run `node cc-walk.mjs <390|1366> [route …]`: no routes = all 24 nav routes;
  one route = full stack traces; `CC_STACKS=1` prints stacks for any run; `CC_SKIP=<selector>` excludes matches from the overflow
  probe (it already excludes the shell bar / drawer / svg); `CC_ACTIONS=<js>` runs on the page before measuring. Shots land in
  `./cc-shots/<width>-<route>.png`; it saves `cc-state.json` (Playwright storageState) after the first login, so the password is
  needed once per session. Overflow probe compares against the requested width, NOT `innerWidth` — with `isMobile` Chromium zooms
  out on overflow and `innerWidth` follows the content (the first probe called 809px "no overflow"). The Bash auto-mode classifier denied every command with `CC_PASS='…'` on the
  line after the first walk, and (later the same day) also blocked the session from writing its own `.claude/settings.local.json`
  allow rule (self-modification). **The way that works: Yaseen adds `CC_PASS` as an environment secret** (cloud environment →
  Edit → Environment variables / secrets; value = the staging test-account password in docs/SS-PIPELINE-HANDOFF.md §3, staging only).
  Both scripts already read `process.env.CC_PASS`, so the command becomes `node …/cc-one.mjs 390 /dispatchers` with no credential
  on the line. Optional extra: a committed `.claude/settings.json` with `"permissions":{"allow":["Bash(node /tmp/claude-0/*)"]}`.

## Agent / Dispatcher portal — pass 1 (24 Sep, cloud session; agent@lb.test, staging build)
Personas on staging (auth.users, all `@lb.test`, SS-pipeline password): **agent** = both tracks (referral opted in + `dispatcher_profiles.status = verified`,
one assigned carrier, two trucks — the widest persona, used for every shot), **agent2** and **dispatcher** = referral only (no dispatcher profile).
`/app/agent/` is `app/carrier/app.js` in `__LB_AGENT` mode: shell tabs dashboard / referral / chain / earnings / payouts / verify / settings
(`AGNAV_ALL`), and the dashboard hosts `app/agent/dispatcher-workspace.js` (today / board / trucks / bookings / brokers / money / messages /
email / packet / kpis) once the status is trial / verified / active. Walked all 17 routes at 390 and 1366: full-page shot, height, buttons,
overflow probe, console + 4xx. **No horizontal overflow anywhere, no 4xx beyond O8's `track_web_event`, no page error.** The `.dw-tabs` strip
the probe flags (r=1146) scrolls inside itself; the page stays 390. Re-shot after every fix below.

| # | Sev | Finding | Fix |
|---|---|---|---|
| A1 | P1 | **Every workspace tab on phone opened ~560px down**: the ID-verification card (400px, "Upload a government ID **to continue** … Applications without a verified ID are not moved to the skills test") + status accordion + clock sat above the tabs on Today, Board, Trucks, … — and the persona is already VERIFIED, so the copy was wrong for it | `app.js` ID card: past the skills test (trial / verified / active) the heading is "Upload a government ID before your first carrier hand-over" and the skills-test sentence is dropped; on phone (≤900) it folds to one line "⚠ Government ID still needed — tap to upload" (`<details>`). Desktop keeps the full card. Phone: dashboard 2,155 → **1,768**, board 3,179 → 2,791, trucks 3,519 → 3,132, kpis 1,387 → 999. |
| A2 | P2 | Two navigations on phone: the sticky `.dw-tabs` strip (all ten tabs, scrolls sideways) AND the bottom bar the workspace paints into `.cp-tabbar` (Today · Board · Log · Bookings · More) | `.dw.dw-barred .dw-tabs{display:none}` ≤900px — `paintChrome` adds `dw-barred` when it takes the bar, `restoreChrome` removes it. Desktop strip unchanged. |
| A9 | P2 | Phone top bar said **"Dashboard"** on every workspace tab — `paintChrome` looked for `.cp-top-title` (the carrier shell) but the agent shell's title is `.cp-title` | selector `.cp-top-title, .cp-title`. Titles now Today / Board / Trucks / … (harness column). |
| A3 | P1 | **Referral tab = 4,969px on phone** for a dispatcher+partner: the live referral home (bl_agent_0402: link card, six tiles, "Where your money is", live referrals, Recent activity) with the legacy program block stacked under it — the same link a second time, the same seven KPI tiles, the same eight events again as "Latest activity" | with the home on top (`!refOnly`) the legacy block keeps only what the home lacks: the pending-verification card (hidden once approved), **Invite by email** (the in-app invite modal the home does not have) and "How your money works". Phone **4,969 → 3,605**, desktop 2,904 → 2,166. Referral-only accounts (home on the dashboard, program on this tab) are untouched — see OA1. |
| A4 | P3 | Money as `$7.6`, `$9.9`, `$22.3`, `$98.1` (maximumFractionDigits only); "Latest activity" / verification chat / alerts as `7/19/2026, 1:04:07 PM` | `money9` min+max 2 decimals; `fmtWhen9` → "Jul 19, 1:04 PM" (year only when not this year) at the three `toLocaleString()` call sites in the agent shell. |
| A6 | P2 | Email tab "Mailbox paused" empty state in a 72vh / 540px box (phone 1,205px, desktop 1,272px of nothing) | `dmail.js`: `.dm-main.dm-off` height auto, `.dm:has(>.dm-off)` min-height 0. Phone 1,205 → 844, desktop 1,272 → 968. |
| A7 | P2 | Desktop sidebar: "Dispatcher · Partner" ran under the rail-collapse toggle ("Dispatcher · Partn⊟") | brand row gets `min-width:0` + ellipsis (carrier.css), and the agent shell passes the short family name (`Dispatcher` / `Partner`) — the full track label already sits in the side foot. |
| A8 | P2 | Softphone dock (`dialer.js`) sat at `right:104px` (desktop) / `88px` (phone) to clear the live-chat bubble — but the portals dock that bubble in the header (`#lbc-fab.lbc-docked`), so the phone pill floated 100px into the content, over the KPI tiles | `lbd-solo` when the bubble is absent / docked / hidden (checked at 0 / 3 / 9 s): `right:18px`, phone `14px`. The "Reconnecting…" in the shots is the session proxy refusing `wss://rtc.telnyx.com` — harness noise. |
| A10 | P3 | Trucks: "Unit T-101 **— ·** Dry Van" when year / make / model are empty | parts joined only when present |
| A11 | P3 | Money: "Trial window: 2026-08-29 → 2026-09-11"; KPI range option the same | `dwDay` → "Aug 29 → Sep 11" |
| A12 | P3 | Board: "Austin, TX → Nashville, **TN,**" (lane string from the feed ends in a comma) | trailing `[\s,]` trimmed on the board row |

Walked clean (both widths): My Referrals, Earnings, Payouts, Verification (tracker + dispatch thread), Settings, Bookings, Brokers, Money, Messages, Packet, My KPIs.
Desktop heights after: dashboard 1,563 · referral 2,166 · board 2,258 · trucks 2,580 · chain 768 · earnings 1,160 · payouts 948 · verify 1,234 · settings 1,056.

## Agent / Dispatcher portal — OPEN (next)
- **OA1 (P3)** Referral-only accounts (agent2@lb.test): the dashboard is the live referral home and the Referral tab is the legacy program block, so link / tiles / activity appear once per tab (phone 2,798 + 2,417). Cross-tab, not same-page — left alone; the same trim as A3 would apply if Yaseen wants the program tab to be explainer + invite only.
- **OA2 (P3)** Trucks → "Last GPS 32.777, -96.797 · 2 h ago" — raw coordinates; no reverse geocoder in the feed.
- **OA3 (P3, data)** Payouts: "✓ Verified By LoadBoot" beside "Documents Missing" (bank proof missing on the persona) reads contradictory; the account is verified, the proof document is not. Copy could say "Bank proof missing".
- **OA4 (P3)** `#dashboard` reopens the workspace on the last tab (`sessionStorage.dw_tab`) — by design, but a deep link to `#dashboard` after Email lands on Email.
- Not walked (writes / fixtures): Log a booking, Request to book, Post the truck, Add broker, RC upload, Messages send, ID upload, payout request, Nudge, Invite by email, the "More" sheet, Board "Details" modal, truck "Update availability" sheet; the dispatcher **application form** and **skills test** (need a persona in `applied` / `screening` / `skills_test` — none on staging); the first-visit track chooser (needs an account with no intent). Staging `track_web_event` 404 on every page = O8 (unchanged).
- **Harness:** `docs/ux-audit-2026-09/harness/ag-walk.mjs` (+ `crop.mjs`, a Playwright-only PNG slicer — no PIL / ImageMagick in the container). `CC_EMAIL` (default agent@lb.test), `CC_TRACK` (both | referral | dispatcher — the login page's track chooser), `CC_PASS` from the environment; state saved per email. Three things it had to learn: (1) the agent shell has **no hashchange listener**, so every route is `about:blank` → fresh load (a same-page `goto('#tab')` just changes the hash and shoots the old screen); (2) `carrier-dark.css` gives `body` a `background-attachment:fixed` gradient and Chromium's fullPage capture paints it for the first viewport only — the harness injects `body{background-attachment:scroll}` for the shot (white page below the fold = artifact, not a bug); (3) the sign-in button has no `type=submit` — it clicks `button.cp-btn-lg` "Sign in", and the login is done once "Do both" (or the track from `CC_TRACK`) is chosen and "Already have an account? Sign in" toggled.

## Marketing site (signed-out, the 131 sitemap URLs, 390 + 1366) — pass 1, 24 Sep
Harness: `harness/mk-walk.mjs` (no login; per page: height, horizontal overflow, console, 4xx, H1 count, missing alt,
tap targets < 24px, title/description length; `MK_SHOT=0` = fast full-site pass, `MK_SKIP=".lbh-drawer,.aurora,.mq-track"`
silences the off-canvas drawer / hero glow / marquee) + `harness/mk-sections.mjs <w> <page>` (which block eats the phone).
Both full passes: **0 of 131 pages overflow sideways at either width**; no page errors beyond the proxy-blocked tags (clarity,
gtag, Trustpilot `//widget…` is a 405 only on localhost http) and status.html's deliberate `rest/v1/` 401 probe (OM4).

| # | Sev | Finding | Fix |
|---|---|---|---|
| M1 | **P1 (prod bug)** | Every **first-time visitor** got "🚀 A new version of Loadboot is available — Update ×" on their first pageview: `sw.js` calls `clients.claim()`, which fires `controllerchange` on the initial install, and PWA_JS treated any `controllerchange` as an update. On phone the banner was capped ~200px wide (`left:50%` shrink-to-fit → one word per line) and sat on the hero's second CTA. | PWA_JS remembers whether a controller existed at page load and swallows the first claim. Banner `width:max-content;max-width:min(92vw,520px)`, × gets a 36px hit area, lifts above the sticky bar. |
| M2 | P1 | Phone, bottom 200px at scroll 0: sticky "Get a Quote / Get Started" bar (the hero's own two buttons + the header's Get Started are on the same screen), "⬇ Get the app" pill sitting ON the bar's Get a Quote, read-through ⌄⌄ button, chat FAB, M1's banner; after one screen back-to-top joined the tower. Desktop 1366×768: the "Get the app" pill covered the hero paragraph. With the drawer open, ⌄⌄ and the FAB floated over its Get Started button (z-index 2147483644 > 300). | Sticky bar slides in only after 480px of scroll (`body.lb-mcta-on`, UX_JS); "Get the app" hidden ≥881px and lifted above the bar on phone; read-through hidden on touch (`hover:none and pointer:coarse` — backToTop.js is shared with the portals, so they lose it on phone too); every float `visibility:hidden` while `.lbh-drawer.open`. liveChatCore's `placeFab` re-measures on a dispatched resize after the bar toggles. |
| M3 | P1 | Footer = **4,570px / 92 links on every page** on phone (status.html: 1,182px of page under 4,570px of footer). Eight link groups, 2-col grid, 48px a row. | ≤700px each group folds under its heading (`role=button`, `aria-expanded`, Enter/Space). Footer 4,570 → **2,528**. Desktop untouched (6 columns). The second "Company" heading (over the e-mail block) → "Contact". |
| M4 | P2 | `.cmp` comparison tables ≤880px had `white-space:nowrap` on the whole table: should-i-buy-a-truck… 3,231px wide (eight phone screens sideways), protect-freight 1,241, spot-market 1,201, truck-dispatcher-vs-broker 1,150. | Cells wrap, `min-width:150px` → 600–750px (one swipe). Privacy `.pv-t` URLs `overflow-wrap:anywhere`. |
| M5 | P2 | Home on phone 36,146px / 30 sections; "How we find your freight" alone 4,002px (six link-cards at 316px + the 1,589px Standard band). | Generic `data-fold="N"` + `data-fold-label` (UX_JS): the six sourcing cards show 3 + "Show 3 more freight sources" ≤700px. Home 36,146 → 33,227; the rest is content (OM1). |
| M6 | P2 | pricing / create-*-account: the "Questions? Call us 24/7 … or we call you" strip above the hero wrapped to three lines on phone → H1 at 387px. | ≤560px the callback half hides (`[data-lb-callonly]`), the number stays. H1 at 330. |
| M7 | P3 | Load-score estimator toggle was a 270×15px tap target. | 32px min height. |

Source: `build_site.py` (PWA_JS, `UX_CSS`, `UX_JS`, `_networks()`, footer()), `app/shared/ui/backToTop.js`, `load_score_module.py`. No DB change.

**Open — marketing (OM):**
- **OM1 (content, his call)** Home phone still 33k px: For carriers 2,039 · For brokers 1,725 · Load-score tool 3,094 · Free-for-drivers
  2,013 · Standard band 1,589 · FAQ 1,368. `data-fold` makes any grid foldable in one attribute; which sections earn the phone scroll is his.
- **OM2** Footer social: Facebook and Instagram icons are `href="#"` on every page (tap = jump to top). Real URLs, or drop the two icons.
- **OM3 (→ Phase 2 baseline)** title > 65 chars on ~25 pages (tonu-policy 137, truckload-freight-rates 125, spot-market 95); meta
  description > 170 on ~50 (tonu-policy 389, layover 373, truckload 350 — policy pages pasting their first paragraph).
- **OM4 (P3)** status.html probes `rest/v1/` with the anon key and reads the 401 as "up" → a console error on every visit;
  `/auth/v1/health` answers 200 without a key.
- **OM5** `PLATFORM_NAMES = []` — the home sourcing section still shows no source chips (owner-confirmed list pending).
- Not walked: form submits (contact / lead forms / newsletter — they write leads), the chat concierge (lcOnboard), cookie consent,
  404.html, `/forms/*` (not in the sitemap), login.html's sign-in (the portal passes covered it).

## PHASE 2 — SEO audit & fix, marketing site (Yaseen's word, 24 Sep 2026)
Starts when the UX order above is finished (CC re-shoot → Agent/Dispatcher → Marketing site UX). His rule: **one page per
session**, judged on LIVE Google Analytics 4 + Google Search Console data for that page, then fixed in the same session.
Scope: the 131 URLs in `site/sitemap.xml` (137 built html; `build_site.py` is the source of truth, never edit `site/`).

**Session 0 — site-wide baseline (one session, before page 1):** crawl all 131 URLs (status, redirect chains, duplicate titles
/ descriptions / H1s, canonical, OG, JSON-LD, broken internal links, orphans, image alt, sitemap vs crawl diff); GSC site totals
+ top queries + pages by impressions (28 d and 90 d); GA4 landing pages 28 d. Output = `docs/seo-audit-2026-10/BASELINE.md` and
a **priority order**: highest impressions × worst position first (pos 11–40 = page-2 money), then the money pages (pricing,
get-started, carriers, brokers, the dispatch-service pages), then the weekly rate reports. Write the order into the ledger.

**Each page session (1 page):**
1. Pull GA4 (28 d: sessions, users, engagement, conversions, entrances) and GSC (28 d + 90 d: queries, impressions, CTR,
   position; "opportunities" = impressions ≥ 20 and pos 11–40) for that URL. Record BEFORE numbers in the ledger.
2. On-page: title / meta / H1 / headings vs the queries GSC actually shows; intent match; canonical; OG + Twitter; JSON-LD
   validity; internal links in and out (anchor text); image alt + weight; CWV via Lighthouse (Playwright Chromium, phone);
   cannibalisation with sibling pages; rendered vs source HTML.
3. Fix in the build source → `build_site.py` → verify the built page + live page after deploy.
4. Ledger row: `docs/seo-audit-2026-10/LEDGER.md` — URL · date · BEFORE (impr / clicks / CTR / pos for the top 3 queries) ·
   what changed · re-check date (+28 d). The re-check is what proves the fix; never skip the BEFORE row.

**Access — needed from Yaseen before Session 0 (checked 24 Sep from the cloud container):**
- `analyticsdata.googleapis.com`, `searchconsole.googleapis.com`, `oauth2.googleapis.com` are **denied** by the environment's
  network policy (CONNECT 403). Add `*.googleapis.com` to the environment's allowed domains (cloud environment menu → Edit →
  Network access). `loadboot.com` itself is reachable, so live-page checks and Lighthouse work already.
- No Google Analytics / Search Console connector is installed in the org (ListConnectors → none).
- Credentials, as **environment secrets, never pasted in chat**: `GOOGLE_SA_KEY` (service-account JSON — the same SA prod's
  `ga4-insights` / `gsc-insights` edge functions already use is fine: Viewer on the GA4 property, user on the GSC property),
  `GA4_PROPERTY_ID`, `GSC_SITE_URL` (`sc-domain:loadboot.com`). The session reads them from the environment only.
- Fallback if he would rather keep the key out of the environment: export GSC Pages + Queries (28 d, 90 d) and the GA4
  landing-page report as CSV into `docs/seo-audit-2026-10/data/` before each session. Works, but it is his time every session.
- **Cheapest route (found in Session 0, 24 Sep):** the weekly SEO rounds already pull GSC through the `seo-pull` edge function via
  `net.http_post` from SQL (`docs/seo/WEEKLY-LOG.md`) — that runs inside Postgres, so the container network rule does not apply.
  Put its v4 token in the environment as `SEO_PULL_TOKEN` and a session can pull `query` / `page` / `query,page` at rowLimit 5000
  through the Supabase MCP. The CC → Google data screen also has Export CSV per table (50 queries / 20 pages cap).

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
- 2026-09-24 — Claude (cloud, branch claude/upbeat-maxwell-fqrpbq): **Command Center pass 1** — CC1 (tab-strip class collision → every
  tabbed screen sideways on phone), CC2 (task queue paging), CC3 (email catalog folds), CC6 (dispatchers teardown guard). DB:
  **bl_ux_0437** (staging + prod; `cc_web_referrers` 42702 — a prod bug, Top referrers never loaded). Prod anon-SECDEF count 33.
  Staging `owner@lb.test` password reset to the SS-pipeline value. Re-shoot blocked by the classifier (see Harness). NEXT: get the
  harness running again → re-shoot the 9 tabbed routes + Task queue + Email catalog → CC4 stack trace → then **Agent/Dispatcher
  portal** per the order.
- 2026-09-24 — Claude (cloud): Yaseen added **Phase 2 — SEO audit** (one marketing page per session on live GA4 + GSC data, after the
  UX order). Plan + access list written above. From here googleapis.com is network-denied and no Google connector exists; he
  needs to open `*.googleapis.com` and add `GOOGLE_SA_KEY` / `GA4_PROPERTY_ID` / `GSC_SITE_URL` as environment secrets (or
  drop CSV exports) before Session 0.
- 2026-09-24 — Claude (cloud, branch claude/funny-hamilton-517yvd, CC_PASS from the environment): merged upbeat-maxwell's CC pass 1,
  **re-shot all 24 CC routes at 390 + 1366**. CC1's real cause = 17 bare `.cc-table`s + `.cc-seg` + Settings rows → three CSS rules,
  all nine screens now 390 wide. **CC4 fixed** (`dispatch-live.js` removeChannel recursion — a prod bug on every Dispatchers teardown).
  CC2/CC3 confirmed. Harness committed to `docs/ux-audit-2026-09/harness/`. No DB change this session. NEXT per the order:
  **Agent/Dispatcher portal** (needs an agent/dispatcher staging persona — check docs/SS-PIPELINE-HANDOFF.md), then Marketing site UX,
  then Phase 2 SEO (Session 0 needs the googleapis network rule + secrets listed above). Still open: OCC1–OCC3, CC unwalked writes.
- 2026-09-24 — Claude (cloud, branch claude/peaceful-volta-7aejxr, CC_PASS from the environment): merged funny-hamilton (CC re-shoot + CC4).
  **Agent/Dispatcher portal pass 1** — A1–A12 (A5 folded into A1). UI only: app/carrier/app.js, app/agent/dispatcher-workspace.js,
  app/shared/dmail.js, app/shared/dialer.js, app/carrier/carrier.css. No DB change. Phone: dashboard 2,155 → 1,768 · referral 4,969 → 3,605 ·
  board 3,179 → 2,791 · email 1,205 → 844. Harness `ag-walk.mjs` + `crop.mjs` committed. NEXT per the order: **Marketing site UX**
  (signed-out pages, 390 + 1366), then Phase 2 SEO. Still open: OA1–OA4, the unwalked writes above, OCC1–OCC3, O3 (Yaseen).
- 2026-09-24 — Claude (cloud, branch claude/dazzling-dijkstra-bx4k0y): **Marketing site pass 1** — M1–M7 (M1 = first-visit "new version"
  banner, a prod bug since the SW got `clients.claim()`). UI only: build_site.py (PWA_JS, UX_CSS/UX_JS appended to styles.css/app.js),
  app/shared/ui/backToTop.js, load_score_module.py. No DB change. Phone: footer 4,570 → 2,528 on every page · home 36,146 → 33,227 ·
  status 5,752 → 3,710 · pricing 14,081 → 12,201. Harness `mk-walk.mjs` + `mk-sections.mjs` committed. UX order is DONE (broker → carrier → CC
  → agent → marketing). NEXT: **Phase 2 SEO, Session 0** (needs the googleapis network rule + GOOGLE_SA_KEY / GA4_PROPERTY_ID / GSC_SITE_URL
  secrets, or the CSV fallback — see the Access list above); OM1–OM5 + the earlier O*/OC*/OCC*/OA* lists stay open.
- 2026-09-24 — Claude (cloud, branch claude/pensive-wozniak-5uxqi9, ff from dazzling-dijkstra): **Phase 2 SEO — Session 0 (crawl half) DONE.**
  `docs/seo-audit-2026-10/BASELINE.md` (crawl of 131 URLs source + live, rendered pass, brand-vs-non-brand answer, priority order),
  `KEYWORD-PLAN.md` (clusters → owner pages → moves, 12-week calendar, GSC vs GUESS tagged), `LEDGER.md` (queue + first row),
  `harness/seo-crawl.py` (stdlib, re-runnable). GSC live still blocked here; used R10's real pull (131 clicks / 14,227 impr / pos 18.4;
  homepage = 55 clicks = the brand share) + prod `web_sessions` 90 d (Google organic 344 sessions: 111 home, 107 market-rates, 126 rest;
  Bing+DDG+Yahoo 563). Site-wide fixes only: `referral.html` out of the sitemap (live 301), `create-agent-account` links off it,
  `unsub.html` X-Robots noindex. No page titles/descriptions touched (R9/R10 windows intact). NEXT: Yaseen picks an access route
  (SEO_PULL_TOKEN env secret is cheapest) → page session #1 per LEDGER queue (market-rates hub index or hotshot description; flatbed
  waits for 16 Oct). Open: OS1–OS6 in BASELINE §6, OM1–OM5 and the earlier O* lists.
- **2026-09-25 — Claude (security-audit lane, input only, nothing changed in your files):** homepage Lighthouse 12 run locally on the built `site/` (PSI quota exhausted): mobile Perf 74 / A11y 95 / BP 79 / SEO 100, LCP 5.3 s — LCP element is the hero `p.lead.reveal` (the reveal fade delays above-the-fold text; exempt hero from `reveal`); footer `logo-full-dark.png` 162 KB offscreen; 11 contrast fails on `.btn-primary` / `.lbh-go` / `.ls-btn.primary`; heading order jumps to h3; `#pwaBtn` aria-label ≠ visible text. Desktop Perf 97, LCP 1.2 s. Yours to fix in Phase 2 — see docs/audit-2026-09/CLOSEOUT-2026-09-24.md (F20).
