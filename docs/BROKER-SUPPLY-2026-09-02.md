# Broker supply — tiered trust build, 2 Sep 2026

**Problem (prod, 2 Sep):** 0 real available loads, 0 broker signups in 30 days, 4 of 8 "brokers" are LoadBoot's own agents, 6 trucks across 5 owners is the whole network, loads@ engine dead since 26 Jul, 0 API keys, 1,629 brokers emailed → 0 replies / 0 signups.
**Root cause:** portal posting was hard-gated on an 8-document packet (MC letter, BMC-84, BOC-3, UCR, W-9, agreement, full bank account, claims procedure) + human review. Even our own agents (8 items submitted each, 0–1 verified) could not post.

**What shipped — DB LIVE ON PROD since 4 Sep (bl_bp_0312 a/b/c, 0312b, 0312c, 0313 a/b/c, 0314; prod smoke test in a rollback txn passed; anon SECDEF 28→32 = the four token RPCs; cron `lb-broker-screen-collect` running). Frontend/site still needs Yaseen's push + Netlify deploy.** a broker posts in minutes on a **live FMCSA authority check**; documents move to where they matter.

| Tier | How you get there | What you can do |
|---|---|---|
| `new` | signup | nothing yet — screen your MC (or USDOT) |
| `unclaimed` (0313/0314) | authority ACTIVE but **identity not proven**: pending one of — signup-email domain == FMCSA email domain (automatic) · **a 6-digit code read by an automated call to the FMCSA-listed phone, typed back in the portal (0314, self-service)** · one click from the FMCSA-listed email (`claim-confirm.html?t=…`) · staff call (CC `verify_identity`, last resort) | nothing — a decline from the FMCSA contact = hold + "IMPERSONATION?" staff alert |
| `screened` | broker authority ACTIVE on FMCSA L&I (SAFER fallback) — FMCSA only keeps it active while a BMC-84/85 is on file — **and** identity verified (method domain / phone / email / staff) | accept agreement → post up to **3** open loads (10 after first delivery); loads carry `verification_state='partial'` and book only via request-to-book / broker-sent offer |
| `agent_pending` → `agent_confirmed` | agent declares the parent MC → parent screened → parent confirms: **parent on LoadBoot** → its owner approves under *Agents & team* (in-app + email); otherwise one-click email to the FMCSA-listed contact (`agent-confirm.html?t=…`). An email the parent **invited** is auto-confirmed on signup. **0314: the agent can also trigger an automated call to the parent's FMCSA-listed phone — the call names the agent, whoever answers gives them the code if they approve, the agent types it → confirmed. No LoadBoot staff.** | same as screened once confirmed; `loads.broker` = "<parent legal name> · MC-… (agent: <name>)"; parent can **revoke** (open postings cancelled) |
| `verified` | full packet verified/waived (unchanged) | unlimited, instant booking, payables in-platform |
| `hold` | CC park / parent declined / staff hold | nothing |

Everything is derived live (`app_private.broker_tier`), nothing stored that can go stale. Every portal load is still reviewed by CC dispatch before it goes live (`cc_decide_partner_load`), and request-to-book still requires the broker to approve in 30 min. Double-brokering/ghost controls therefore: live FMCSA (a carrier MC cannot post), staff review per load, posting allowance, request-to-book, TONU on cancel, auto-expiry.

**Identity layer (bl_bp_0313, 3 Sep):** authority ≠ identity — anyone can type a real MC. Now: one MC = one active broker/shipper org (partial unique index; a second signup is refused with a "ask the owner to invite you" message and the real owner + staff are warned — also when a USDOT screening resolves to a held MC); identity claim as above; parent-on-LoadBoot linking (`broker_trust.parent_org_id`); `broker_agent_invites`; parent name + MC on agent loads. CC queue shows identity status/method/FMCSA contact with **Verify identity / Reject identity / Resend claim email**.

**Self-service voice OTP (bl_bp_0314, 3 Sep, Yaseen: "humein kisi ko call/email na karna pare"):** a dedicated, script-locked Retell agent **"LoadBoot Verify (automated OTP)"** (`agent_1f87d0c74e873ffc8b17e883f3`, created via API, one Retell account serves both envs) dials the FMCSA-listed phone (never a user-typed number) and reads a 6-digit code twice; the portal takes the code (`partner_verify_call(identity|parent)` / `partner_verify_code`). Guards: sha256-hashed code, 15 min, 5 attempts, 3 calls/24 h + 2 min between, hangs up on IVR/voicemail (never leaves the code), `lc_calls.source='verify'` rows never become CRM leads. This is how DAT / Highway / MyCarrierPortal verify — and it removes the staff call entirely; `verify_identity` in CC stays only for the rare record with no FMCSA phone *and* no FMCSA email.

**Packet trimmed (bl_bp_0315, 4 Sep, prod + staging):** Yaseen: "onboarding mein abhi bhi 11–13 doc". Now the FMCSA pass auto-verifies `mc_authority`, `bmc84_bond`, `boc3` (note "Verified live on FMCSA … · broker authority ACTIVE", recheck 30 d), the one-click Master Broker Agreement auto-verifies `broker_agreement` (trigger on `org_agreement_acceptances`), `ucr` is optional for brokers. What a broker still uploads for `verified`: **W-9, bank instructions, claims contact** (+ COI when conditional). Backfilled for anyone already screened/agreed; staff `pass` does the same.

## Files
- `migrations/bl_bp_0315_packet_autofill.sql` — the above.
- `migrations/bl_bp_0314_self_verify_voice_otp.sql` — `retell_config.verify_agent_id`, `verify_codes`, `lc_calls.org_id`, `retell_dial_verify`, the two RPCs, `partner_trust_status.verify_call/verify_phone_ok`, `retell_webhook` lead-guard surgery, ACL. Staging applied (0314 + a/b/c folded into the file). Rollback test 3 Sep (identity + parent paths, throttles, 5-attempt lockout, no-phone refusal, anon 42501) — see `test-0314-rollback.sql`.
- `migrations/bl_bp_0313_broker_identity.sql` — identity tables/RPCs, unique MC index, parent linking, invites, USDOT→MC resolution in the collector, ACL re-check. Applied on staging (in pieces, all rollback-tested); prod applies the single file.
- `app/partner/broker-agents.js` (new) — parent *Agents & team* tab (BNAV/PAGES entry in `app/partner/app.js`, lazy-mounted); `app/partner/broker-trust.js` — identity card (1b), MC/USDOT toggle, refused-MC message, parent-on-LoadBoot wording, 20 s poll while waiting; `app/shared/api.js` — 8 new wrappers; `app/command-center/views/brokerTrust.js` — identity column + actions; `build_site.py` — `claim-confirm.html` (noindex, sitemap-excluded) + copy on brokers / create-broker-account / faq / load-board.
- `docs/broker-supply-2026-09-02/test-0313-rollback.sql`, `harness-0313/` (Playwright, stubbed api), `preview-0313-*.png`.
- `migrations/bl_bp_0312c_partner_signup_fix.sql` — broker/shipper signup no longer creates a phantom carrier org / sends the carrier welcome; `my_any_org()` partner-first (found by Yaseen's staging test).
- `migrations/bl_bp_0312_broker_trust_tiers.sql` — tables, tier/can_post, gates (trigger on partner_loads + string-surgery on `cc_partner_submit_load` / `cc_partner_set_status`), loads label + booking-gate triggers, screening request/collect (pg_net → fmcsa-verify, cron `lb-broker-screen-collect` every minute), agent flow, portal RPCs, anon-by-token confirm RPCs, CC RPCs, ACL re-check.
- `migrations/bl_bp_0312b_broker_copy.sql` — in-product copy (welcome notice + welcome email) no longer promises a "10-minute packet".
- `app/partner/broker-trust.js` (new) + `docs/broker-supply-2026-09-02/apply-partner-trust.py` (9 exact-anchor edits to `app/partner/app.js`, 1 block in `app/shared/api.js`).
- `app/command-center/views/brokerTrust.js` (new) + `apply-cc-route.py` (route + nav).
- `apply-carrier-chip.py` — board chip for request-only loads in `app/carrier/app.js`.
- `apply_site_broker_trust.py` — 17 copy edits in `build_site.py` (brokers, create-broker-account, free-load-board-for-brokers, api, faq) + `agent-confirm.html` page generator (noindex, sitemap-excluded).
- Harness: `harness-partner.mjs` + `harness-supabaseClient.stub.js` (Playwright, stubbed client, records `window.__rpcCalls`). Previews: `preview-*.png`.

## Verified
- Staging rollback-txn test, 17 checks: fresh → screen → agreement → 3-posting limit → 4th blocked → posted load `partial` + notice → instant book **blocked** → request-to-book path books → broker-offer path books → park = hold → approve still refuses incomplete packet → release → agent declare → parent email queued to the FMCSA address (not the agent-supplied one) → anon confirm by token → second click ignored → bad token rejected → agent load labelled → CC queue row → `partner_trust_status` shape → packet waived ⇒ tier `verified`, load self-heals to `verified`, notice removed.
- Real screening on staging (MC 322451 = DKR Trucking, a carrier): outcome **fail**, reason "SAFER shows this entity is authorized as a carrier, not a broker" — collector proven against a real fmcsa-verify response.
- Real `python build_site.py` → BUILD OK; `agent-confirm.html` built and sitemap-excluded.
- Playwright: partner dashboard choice → screen (spinner, 5 s poll) → pass pill → agreement accept → gate replaced by "Post a load" banner; agent path → "Confirmation email sent to compliance@…"; agent-confirm page → "Confirmed — thank you"; CC view 3 rows + filter. Bundles: partner, CC, carrier all esbuild-clean.
- Anon SECURITY DEFINER on staging: 30 → 32 (exactly the two token RPCs). Prod count 27 before this work (drifted from the 25 noted on 29 Aug — re-baseline).

- **0314 rollback test on staging (16 checks):** unclaimed → call placed to `+1 555 987 6543` with `override_agent_id` = verify agent and vars {company, mc, purpose, requester, code "6 5 8 4 7 8", script}; second call inside 2 min refused; wrong code counts attempts; `partner_trust_status.verify_call` shape; right code → `verified/phone` → tier `screened`; already-verified short-circuits; agent: identity purpose refused, parent purpose dials the parent's FMCSA phone with the agent-naming script; 5 wrong → locked; right code → `agent_confirmed`, `parent_confirmed_by='FMCSA-listed phone code (automated call)'`; no phone on record → clear refusal; anon → 42501. Playwright: identity card shows the call block first, wrong/right code, card disappears; agent card call → confirmed pill.
- **0313 rollback test on staging (23 checks):** domain match → `verified/domain`; other domain → pending + claim email queued + masked reason; resend throttled; anon claim_get / bad token / confirm → `screened`; re-click ignored; decline → hold + IMPERSONATION alert; MC collision **refused (returned, not raised — so the owner warning + staff alert + audit survive)** + unique index; agent declares parent-on-LoadBoot → linked, confirmation routed to the owner (in-app + email); parent list/confirm; agent load `broker` = "Acme Freight LLC · MC-900001 (agent: Dave Agency)"; revoke → hold + load cancelled; foreign parent cannot decide; invite → auto-confirm on declare; unclaimed cannot invite; call request → staff notice; trust_status identity/parent fields; CC queue identity columns; verify_identity requires a note → `screened`; USDOT-only screening through the real collector: resolves MC, refuses a held MC, then passes + domain-verifies.
- Two bugs caught by the test and fixed in the file: FMCSA email domain compared case-sensitively (`Dispatch@AcmeFreight.com`), and the collision `raise` rolling back its own warnings.
- Playwright (stubbed api): identity card (masked email, resend throttle message, call request), Agents page (approve / revoke / invite gated until `screened` / cancel invite), MC↔USDOT toggle sends `p_dot`, refused MC shows the owner's name. `build_site.py` → `claim-confirm.html` built, prod-locked in the default build, sitemap-excluded.

## YASEEN — step by step
1. **Files land in the repo** (this session commits them with mtime guards; if the device was offline, re-run this session or apply the four `apply-*.py` patchers on your disk copy — they are idempotent and abort on any missing anchor).
2. `python build_site.py` → BUILD OK, `node --check` on the three app.js files, `git add -A`, commit on a branch, merge to main, push.
3. ~~Prod DB~~ **DONE 4 Sep** (order 0312 → 0312b → 0312c → 0313 → 0314; 0312a/0312d staging-only). Prod's `handle_new_user` already excluded partner signups (bl_ops_0204), the guard skipped that step. `cc_partner_register` keeps both overloads on prod; the portal's 3-arg call is the patched one. Then run once: `select app_private.broker_screen_collect();` and confirm cron `lb-broker-screen-collect` exists. Re-check `has_function_privilege('anon', …)` on the five non-token RPCs (the migration aborts if any leaks).
4. **Clear the partner-portal PWA service worker** (chrome://serviceworker-internals → unregister) before testing; the old bundle has no `partner_trust_status` import.
5. **Test on prod with your own broker account** (a fresh email): choose Freight Broker, enter a real broker MC you know → within a minute the card shows the FMCSA legal name → accept the agreement → post a load → CC approves → open the carrier portal: the load shows the blue "New brokerage · FMCSA-verified · broker approves your request" chip and only *Request to book*.
5b. **Identity on prod:** your test broker account will land on `unclaimed` unless your signup email is on the brokerage's FMCSA domain — click **📞 Call my FMCSA-listed number now** (the call goes to the phone FMCSA lists for that MC, so test with a brokerage whose phone you can answer), type the code, done. Email link and CC *Verify identity* remain as fallbacks. **To hear the call yourself on staging without a real brokerage:** after screening passes, run on staging `update app_private.broker_screenings set phone='<your number>' where org_id=<your org>; update app_private.broker_identity set fmcsa_phone='<your number>' where org_id=<your org>;` then click the button. Staging calls get no status feedback (the Retell agent's webhook points at prod) — the code still works. Existing prod brokers that were already `screened` before 0313 become `unclaimed` too (the identity row is created on the next screening pass / staff pass) — run `select app_private.broker_identity_start(org_id) from app_private.broker_screenings where outcome='pass'` once after applying, or verify them by hand in CC.
6. **Own agents (Ali Raza, Usman, Asim, Charanpreet):** they have no parent MC and LoadBoot has none — they stay unable to post until a partner brokerage confirms them, or you decide to obtain broker authority. Decide this.
7. **hello@ → inbound-mail routing** (Cloudflare Email Routing) — still the reason every reply reads 0.
8. **Capacity email** (below) to the 1,629 warm broker contacts + every broker a dispatcher talks to — you send, drafts only.
9. Retire the "Have these ready: bond, EIN…" screenshot `acct-partner-signup.webp` caption is updated; the image itself still shows the old role picker — fine, but re-shoot when convenient.

## Capacity email draft (you send; ask = CC loads@, never "create an account")
Subject: `2 trucks free this week — OH gooseneck + GA 26' box`

> Hi {first name},
>
> Two trucks on our board free up this week and I'd rather fill them with your freight than watch them sit:
>
> • **30' gooseneck (25+5), Cincinnati OH** — lumber/flatbed, up to 9,000 lb, tarps & chains, home weekends
> • **26' box, dock-high + liftgate, Hinesville GA** — up to 10,000 lb, $1M/$100k, runs SE ↔ Midwest
>
> If you've got anything that fits, just CC **loads@loadboot.com** on the load email you already send — we read it, quote back inside the hour, and the driver runs with GPS tracking and a signed POD in your inbox.
>
> No account, no signup, no fee to you. If you'd rather post directly, your MC screens on FMCSA in under a minute: loadboot.com/create-broker-account.html
>
> — Yaseen, LoadBoot dispatch · +1 (469) 253-7575

(Fill the truck lines from live `truck_postings` each week; never send stale capacity.)
