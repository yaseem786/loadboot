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

## Broker portal — OPEN (next)
- **O1b (P2)** Load cards still carry up to 5 actions; a "More ⋯" menu for Docs / Cancel would take one more row off each card. Delivered loads still offer "Request change" — confirm with Yaseen what that is for after delivery.
- **O3 (P1, security/config)** Supabase Auth minimum password length is 6 on staging (check prod in dashboard → Auth → Providers → Email). Raising it is a provider setting → Yaseen's yes. Pairs with open F15 (leaked-password protection).
- **O7 (P3)** `is_my_org_agent` RPC is called before sign-in → 401 on every login page load.
- **O8 (P3, env drift)** STAGING lacks `app_private.tele_ingest` (`bl_obs_0213_client_telemetry` never applied there) → every web-vital from a staging build 404s. Prod is fine.
- **O10 (observation)** Prod `anon`-executable SECURITY DEFINER count in `public` reads **37** (staging 36); CLAUDE.md §4 / the baseline doc say 33/32. Not caused by bl_ux_0430 (that function is not anon-executable before or after). Compare NAMES against `docs/audit-2026-09/anon-secdef-baseline.md` — security lane.
- **O11 (P2)** Claims: "Approve" uses a native `confirm()` and "Reject" a native `prompt()` for the reason; a proper sheet (amount, evidence summary, reason box) is the Uber bar. Approve not exercised on staging (the two pending claims are useful fixtures) — walk it with a throwaway claim when the carrier lane is up.
- **O12 (P3)** Claims: "Pay this claim" opens the bank panel but the button vanishes and there is no way to fold it back.
- **O13 (P3)** Carrier packet 🔒 preview modal (Carriers tab) is fine; the Track-live "Carrier packet" button on a booked load was not opened.
- **O14 (P2)** Shipper dashboard on phone is 3,773px: 10-item onboarding packet (each row = Pending pill + Submit) + KPI grids + payables; and "Recent activity" shows "We could not confirm your business yet — domain lb.test has no mail (MX) record" (staging artefact, but the copy is developer-speak for a shipper).
- **O15 (P3)** Chat teaser ("Question about a load?") can pop over an open modal (2FA / Track live); it fires once per session so real users see it rarely.
- Walked this session: Claims evidence/pay panel, Track live, Carrier packet preview, Account/2FA/push/devices, Developers key create+revoke, desktop layouts of dashboard/claims/account/loads/invoices/requests/carriers/network/onboarding/developers (no overflow, nothing broken), shipper + facility dashboards (phone + desktop).
- Not yet walked: Post-a-load wizard steps 2–3 end to end, claim Approve/Reject writes, shipper/facility inner tabs and forms (dock appointment create), Network tab content, Documents (onboarding) submit flow.

## LOG (append only)
- 2026-09-24 — Claude (cloud session): broker portal pass 1. Fixed B1–B11 in app/partner/app.js, app/partner/partner-premium.css, app/shared/ui/liveChatCore.js. esbuild OK, BUILD OK, re-shot. NEXT: O1 (load-card actions) then the unwalked flows above.
- 2026-09-24 — Claude: Yaseen said "suggest and implement". O9 → B13 (bl_ux_0430 staging+prod), O1 → B12. O3 (Auth min password 8) needs the Supabase dashboard — no API from here; steps given to Yaseen.
- 2026-09-24 — Claude: B14 focus-view post wizard, B15 field-level validation (step 1). Verified on staging build: 8 fields flagged, focus o_street, Close returns to dashboard.
- 2026-09-24 — Claude (cloud): B16–B28. DB: bl_ux_0431 (staging + prod, additive `board.load_id`). Staging passwords for shipper@lb.test / facility@lb.test reset to the SS-pipeline value (staging only). Harness note: global Playwright at /opt/node22/lib/node_modules/playwright, Chromium needs `--ignore-certificate-errors --disable-http2` behind the session proxy. NEXT: O11 (claim review sheet) → O14 (shipper phone length) → then Carrier portal per the order.
