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

## Broker portal — OPEN (next)
- **O1 (P1)** Load cards stack up to 7 full-width buttons (Edit, Update pickup, Docs, Carrier packet, Cancel…) with notices interleaved. Needs one primary action + "More ⋯" menu. Touches booking/cancel engines → do carefully, test each action on staging.
- **O2 (P2)** Payables rows on Invoices carry three status indicators each ("$X Still DUE" + "DUE" + "OVERDUE"); one is enough.
- **O3 (P1, security/config)** Supabase Auth minimum password length is 6 on staging (check prod in dashboard → Auth → Providers → Email). Raising it is a provider setting → Yaseen's yes. Pairs with open F15 (leaked-password protection).
- **O4 (P2)** Claims timestamps show seconds ("7/18/2026, 6:16:30 AM"); use "Jul 18, 6:16 AM".
- **O5 (P2)** Agents tab opens with a 12-line paragraph; turn into 3 bullets + "Learn more".
- **O6 (P2)** Market rates: origin/destination inputs too narrow on phone (placeholder cut: "ORIGIN S'").
- **O7 (P3)** `is_my_org_agent` RPC is called before sign-in → 401 on every login page load.
- **O8 (P3, env drift)** STAGING lacks `app_private.tele_ingest` (`bl_obs_0213_client_telemetry` never applied there) → every web-vital from a staging build 404s. Prod is fine.
- **O9 (question for Yaseen)** Requests → "Shipper freight — open pool" shows the shipper's dock-office and receiving phone numbers to every approved broker before anyone claims the load. Intended?
- Not yet walked: Post-a-load wizard end to end, Track live modal, Carrier packet, Claims evidence/approve flow, Developers key create, Account/security/2FA, desktop layouts of each tab, shipper + facility variants.

## LOG (append only)
- 2026-09-24 — Claude (cloud session): broker portal pass 1. Fixed B1–B11 in app/partner/app.js, app/partner/partner-premium.css, app/shared/ui/liveChatCore.js. esbuild OK, BUILD OK, re-shot. NEXT: O1 (load-card actions) then the unwalked flows above.
