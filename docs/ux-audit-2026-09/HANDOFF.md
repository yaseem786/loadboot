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

## Broker portal — OPEN (next)
- **O1b (P2)** Load cards still carry up to 5 actions; a "More ⋯" menu for Docs / Cancel would take one more row off each card. Delivered loads still offer "Request change" — confirm with Yaseen what that is for after delivery.
- **O2 (P2)** Payables rows on Invoices carry three status indicators each ("$X Still DUE" + "DUE" + "OVERDUE"); one is enough.
- **O3 (P1, security/config)** Supabase Auth minimum password length is 6 on staging (check prod in dashboard → Auth → Providers → Email). Raising it is a provider setting → Yaseen's yes. Pairs with open F15 (leaked-password protection).
- **O4 (P2)** Claims timestamps show seconds ("7/18/2026, 6:16:30 AM"); use "Jul 18, 6:16 AM".
- **O5 (P2)** Agents tab opens with a 12-line paragraph; turn into 3 bullets + "Learn more".
- **O6 (P2)** Market rates: origin/destination inputs too narrow on phone (placeholder cut: "ORIGIN S'").
- **O7 (P3)** `is_my_org_agent` RPC is called before sign-in → 401 on every login page load.
- **O8 (P3, env drift)** STAGING lacks `app_private.tele_ingest` (`bl_obs_0213_client_telemetry` never applied there) → every web-vital from a staging build 404s. Prod is fine.
- **O10 (observation)** Prod `anon`-executable SECURITY DEFINER count in `public` reads **37** (staging 36); CLAUDE.md §4 / the baseline doc say 33/32. Not caused by bl_ux_0430 (that function is not anon-executable before or after). Compare NAMES against `docs/audit-2026-09/anon-secdef-baseline.md` — security lane.
- Not yet walked: Post-a-load wizard end to end, Track live modal, Carrier packet, Claims evidence/approve flow, Developers key create, Account/security/2FA, desktop layouts of each tab, shipper + facility variants.

## LOG (append only)
- 2026-09-24 — Claude (cloud session): broker portal pass 1. Fixed B1–B11 in app/partner/app.js, app/partner/partner-premium.css, app/shared/ui/liveChatCore.js. esbuild OK, BUILD OK, re-shot. NEXT: O1 (load-card actions) then the unwalked flows above.
- 2026-09-24 — Claude: Yaseen said "suggest and implement". O9 → B13 (bl_ux_0430 staging+prod), O1 → B12. O3 (Auth min password 8) needs the Supabase dashboard — no API from here; steps given to Yaseen.
- 2026-09-24 — Claude: B14 focus-view post wizard, B15 field-level validation (step 1). Verified on staging build: 8 fields flagged, focus o_street, Close returns to dashboard.
