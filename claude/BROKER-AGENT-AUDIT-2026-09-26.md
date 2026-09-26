# Broker side + Broker Agent — audit, 26 Sep 2026

Read-only audit: repo at `afba1f5` + prod DB (`quickfreights-portal`, selects only, no live-account
probes). Written for the owner; Roman Urdu summary is in the chat that produced this file.

Benchmarks used: FMCSA broker rules (MC authority, BMC-84/85 $75k, BOC-3, UCR); DAT / Truckstop
broker signup; Highway + MyCarrierPackets / RMIS (identity + agent-of-broker); Amazon Relay and
Uber Freight (these onboard **carriers and shippers**, not brokers — their relevant lesson is the
shipper side: business-domain identity, credit, terms before the first tender).

---

## 1. How the broker side actually works today (bl_bp_0312 → 0343, live on prod since 4 Sep)

Two-step signup, then a **live FMCSA screen** decides posting — the 8-item packet no longer gates it.

| Step | Where | What happens |
|---|---|---|
| A. Create account | `/app/partner/#signup` (`app/partner/app.js:586-630`) | email, password, name + **Freight Broker / Shipper / Facility** → stored as `auth.users.raw_user_meta_data.partner_kind`. **No "Broker Agent" here.** |
| B. First login | `choosePartnerType()` (`app.js:797-802`) | four cards: Freight Broker (own MC, ≤8 digits, pre-checked on FMCSA) · Shipper · Facility · **Broker Agent** (brokerage MC + legal name + optional same-domain email). Agent is stored as `organizations.kind='broker'` + `broker_trust.is_agent=true`. |
| C. Provision | `public.cc_partner_register(kind, company, mc)` | org born `status='pending'`, owner membership, staff in-app notice "New broker registered — … · NO MC GIVEN", welcome email `welcome.broker`. |
| D. Screen | `partner_broker_screen` / `partner_agent_declare` → edge fn `fmcsa-verify` → cron `lb-broker-screen-collect` (1 min) | writes `app_private.broker_screenings` (outcome `pass/fail/unknown/not_found/error`, legal name, FMCSA email/phone, broker_authority). On PASS `packet_autofill_from_fmcsa` auto-verifies `mc_authority`, `bmc84_bond`, `boc3`. |
| E. Identity (own-MC brokers only) | `broker_identity` (0313/0314) | authority ≠ identity. Verified by: signup-email domain = FMCSA domain, or link to the FMCSA-listed email, or automated Retell call reading a 6-digit code to the FMCSA-listed phone, or staff. Until then tier = `unclaimed`. |
| F. Agreement | one-click Master Broker Agreement → `broker_agreement` auto-verified | |
| G. Post | `app_private.broker_can_post` | tier `screened` / `agent_confirmed` → 3 open loads, 10 after first delivery; `verified` (packet complete) → unlimited. Nightly re-screen; `authority_fail` / `authority_stale` outrank a verified packet (0343). |

Tier engine (`app_private.broker_tier`, derived live, never stored):
`hold` > `authority_fail` > `authority_stale` > `verified` > (agent: `agent_confirmed` / `agent_pending` / `new`) > `screened` / `unclaimed` / `new`.

Broker packet templates on prod: 10 rows, 8 non-optional (`mc_authority, bmc84_bond, boc3, w9, coi, broker_agreement, bank_instructions, claims_procedure`; `ucr`, `references` optional). After autofill a broker uploads only W-9, bank instructions, claims procedure (+COI if conditional). Shipper packet 9 rows, 3 required before first booking (0319).

## 2. The second scenario — agent under a brokerage — is built and live (0312 → 0313 → 0318)

What the owner originally asked for ("agent apni brokerage se confirm karaye, MC/DOT daale, code official
email ya phone pe jaye") — this is exactly what ships, with one deliberate change:

1. Agent picks **Broker Agent**, enters the brokerage MC + legal name (+ optional email on the brokerage's own domain). Up to **10 brokerages per agent account** (`agent_parents`, one row per MC).
2. LoadBoot screens the **parent MC** on FMCSA. Only on `pass` does anything go out.
3. `broker_parent_confirm_send_p` emails a **6-digit code + one-click confirm/decline link** to: the brokerage's LoadBoot owner (if the MC is already on LoadBoot) + the **FMCSA-listed email** + the agent-supplied address **only if it is on the same domain as the FMCSA email** (free-mail domains ignored). The email says: "If you do not know this person, do not share the code — choose Not our agent".
4. Confirmation paths: brokerage types nothing (clicks link) · agent types the code · brokerage on LoadBoot approves under **Agents & team** · brokerage **invited** that email first → auto-confirmed on pass · staff `confirm_parent` in CC (note required).
5. **Phone OTP was removed from the agent path in 0318** (calls remain for a broker's *own* identity claim). So today: email code only + staff. If the FMCSA record has no email → agent is told to ask the brokerage to update MCS-150; staff can confirm by hand.
6. Loads post **under the parent's name and MC**; agent picks the brokerage per load when several are confirmed; each brokerage has its own open-posting limit; revoke cancels that brokerage's open postings.
7. Brokerage side: `app/partner/broker-agents.js` — approve / decline / revoke / restore, invite by email (gated to tier `screened|verified`).

Industry fit: this matches how brokerages actually run agents (agent has no authority; rate con on the
brokerage's paper; brokerage is liable) and is stricter than DAT/Truckstop, which do not verify agents at
all — they sell a seat under the brokerage's account. Highway's "identity ≠ authority" idea is the same one
0313 implements. **Verdict: model is right, ahead of the load boards.**

## 3. Does Command Center support scenario 2? — Partly. Trust queue yes, 360 no.

| CC screen | Agent support |
|---|---|
| **Partners → Broker trust** (`brokerTrust.js`) | ✅ Full. Shows "Agent of X · parent MC", each brokerage with status / code emailed to whom / source, `Resend code email`, `Confirm brokerage` (note required), `Pass by hand`, `Re-screen`, `Hold`, `Limit`. `needsHuman` includes screening `unknown/not_found/error`. |
| **Broker 360** (`broker360.js`, the screenshot) | ❌ Knows nothing about agents. Renders the **broker packet (0/8)** for an agent who by definition has no bond, BOC-3 or own MC. "Approve account" calls `cc_partner_set_status('approve')` which **raises unless every non-optional packet item is verified/waived** → an agent can only be made `active` by waiving 8 items by hand. No parent / brokerage / code status shown. |
| **Partners → Directory** (`partners.js`) | ✅ **Fixed 26 Sep — `bl_bp_0450`**: agents read "Agent of X" (green when confirmed, amber "awaiting brokerage", red when declined/revoked or no brokerage declared). Was `x/8 verified`; the old `'(Agent)'`-in-name exclusion (bl_ops_0205) only catches dispatch agents. |
| **Partner Intake** | ✅ loads posted by an agent show the parent MC (`details.agent_parent_id`). |
| **Partner compliance / authority poll** | ⚠ polls `organizations.dot_number/mc_number` — NULL for agents; the parent MC is re-screened by 0343's nightly job instead. Fine, but the board shows agents as NO DOCKET. |
| Agents under a brokerage / invites | ❌ No CC view lists agents *under* a given brokerage or its pending invites (`broker_agent_invites` is portal-only). |

Two "mandatory" counts disagree: CC 360 counts `tag <> 'optional'` (includes `conditional`) → 8;
`partner_trust_status.packet_required_*` counts `legal|required` only → 7. Pick one.
**Picked 26 Sep — `bl_bp_0451`: mandatory = `legal|required`.** One function, `app_private.packet_tag_mandatory(tag)`,
and all 17 consumers call it (posting gate, both trust queues, CC approve, reject-parks-account, directory, boards,
prebook, chat status, `partner_trust_status`, `partner_shipper_status`). `conditional` (broker `coi`; shipper
`credit_application`/`payment_terms`/`special_commodity`) is asked for and reviewed but never gates verification,
approval or posting. `cc_partner_360` and `cc_my_onboarding_packet` now emit `mandatory` per item; Broker 360's KPI
and the partner packet summary read that instead of the tag. Why not `<> 'optional'`: the posting gate has read
`legal|required` since 0312/0315 and the partner portal already files `conditional` under "Before your first
booking"; a CC approval stricter than the posting gate only produced hand-waives. No prod org differed between the
two readings on 26 Sep and no `conditional` item was `rejected`, so nothing changed on live data.

Also: `onboarding_packet_templates` seed and `app_private.org_onboarding_complete` existed only on the live
DB, not in `migrations/`. **Both in files now — `bl_bp_0451` (function) and `bl_bp_0453` (seed); see §7 item 7 for the
staging drift the dump exposed.**

## 4. The signup in the screenshot — SALAYIM / "khannawab m afzal"

Facts (prod, read-only):
- auth user created 26 Sep 00:12 UTC, `partner_kind=broker`, company field **blank**, phone blank.
- org `abdb64e0…` created 00:20, `kind=broker`, `status=pending`, `mc_number=NULL`.
- Chose **Broker Agent**. Declared brokerage MC = **"2026"**, brokerage legal name = **"Khan"**, contact email = **their own gmail**.
- FMCSA resolved MC-2026 → **KMG ENTERPRISES LLC**, USDOT 2956205, Midland NC, entity type **CARRIER**, 1 truck / 1 driver, registration **inactive**, broker authority none, FMCSA email `kg-iuoe@hotmail.com`.
- Screening outcome `unknown` → tier `new`, portal shows the brokerage row as `needs_human`. No code email went out (correct — screening did not pass). CC Broker trust queue lists them under **Needs a human**.

**Verdict: not a real broker and not a real agent.** "2026" is the year typed into the MC field; the
record it resolves to is a one-truck carrier, not a brokerage; the "brokerage" name is "Khan"; the
contact email is their own gmail; no company name at signup. Pattern matches a curious signup / someone
trying the portal, not a brokerage.

What to do (CC → Partners → Broker trust → row "khannawab m afzal"):
1. Do **not** press `Pass by hand` or `Confirm brokerage`.
2. Press **Hold** with a reason the person will see, e.g. *"MC-2026 belongs to KMG Enterprises LLC, a one-truck carrier — not a brokerage. Reply with the real MC of the brokerage you post for and your agent agreement, and we will re-check."* This stops the row sitting in Action Needed and tells them exactly what is missing. Posting is already blocked; hold makes that explicit.
3. Nothing to approve in Broker 360 — ignore the 0/8 packet for this account.
4. If they never come back, leave it. If they reply with a real brokerage MC, `Re-screen` in the trust queue → the code email goes to that brokerage's FMCSA contact automatically.

**Decision 26 Sep (owner asked for a recommendation + implementation): Re-screen, not Hold.** The steps
above were written before `bl_bp_0449` existed. With the nudge live, a re-screen of MC-2026 returns the same
`unknown` and `agent_parent_mc_nudge` fires (reason `carrier_record`: authority unknown + 1 power unit): the agent
gets the in-app card and the catalogued e-mail naming KMG ENTERPRISES LLC and asking for the real brokerage MC —
the same message step 2 would have typed by hand, from the template instead. Hold was rejected because (a) posting
is already blocked (tier `new`, org `pending`), so hold protects nothing extra; (b) it tells a day-one signup their
account is paused for a typo; (c) it needs a staff "Release hold" later even when the agent does the right thing,
whereas after the nudge a new MC flows on its own (new `agent_parents` row → screen → code e-mail to the brokerage).
Cost accepted: the row keeps sitting under "Needs a human" in the trust queue. If nothing comes back in a week,
treat it like the July "(Agent)" orgs (§7 item 8). Fired via `broker_screen_request` + `log_audit
('broker.trust.rescreen')` — the same two calls `cc_broker_trust_set(...,'rescreen')` makes.

Also on prod right now (same queue): **LinkLane** is `agent_confirmed` (parent confirmed 25 Sep, packet 3/3) but org status still `pending` — that is the 360 gap in §3, not a data problem. **Vertex Web Systems 2** is `agent_pending` (M&M Brokerage, code emailed 25 Sep 07:01, unanswered).

## 5. Signup role options — what is missing

Public site already says the right thing (`get-started.html`: "Brokers, broker agents and shippers use
the Partner Portal"; `broker-agents.html`; `create-broker-account.html`: "pick Freight Broker (or Broker
Agent)"). The app does not:

- `/app/signup.html` card reads **"Broker / Shipper"** → an agent does not see themselves. Change to "Broker · Broker agent · Shipper".
- Partner create-account (step A) offers broker / shipper / facility only; **Broker Agent appears only at step B**. Add the agent card at step A and pre-select it at step B (`preselectFromSignup9` already handles `partner_kind`).
  - ⚠ Do not store `partner_kind='agent'` raw: `handle_new_user` (bl_ops_0204 / 0312c) skips the phantom carrier org only for `broker|shipper|facility`. Either store `partner_kind='broker'` + `agent_intent=true`, or extend that list in the same migration.
- The third card "Dispatcher / Referral partner" is LoadBoot's own **referral agent program** (`/app/agent/`). Two things called "agent" on one screen is the confusion that produced four July orgs named "(Agent)" with `kind=broker` and no parent MC (Ali Raza, Usman, Asim, Charanpreet — still on prod, `is_agent` NULL, 0/8 packet, some `active`). Rename the card "Dispatcher / Referral partner (earn on carriers)" and add one line under the partner card: "Freight agent posting under a brokerage? Choose Broker agent."
- Industry names the market uses that the picker does not: **3PL / freight forwarder** (post loads under own authority — same as broker; add as a label only, kind stays `broker`), **broker agent** (done above). "Facility / Warehouse" is fine.

## 6. Audit against industry standard

| Area | Standard (FMCSA / DAT / Truckstop / Highway / Relay / Uber Freight) | LoadBoot today | Gap |
|---|---|---|---|
| Broker authority | Active MC, BMC-84/85 on file, BOC-3; load boards check authority at signup and periodically | Live FMCSA screen at signup, nightly re-screen, `authority_fail/stale` pauses posting, bond/BOC-3 autofilled from L&I | ✅ at par or ahead |
| Identity (anti double-brokering) | Highway: email domain vs FMCSA, phone, device; load boards: weak | Domain match · FMCSA-email link · voice OTP to FMCSA phone · staff | ✅ ahead of DAT/Truckstop |
| Agent under brokerage | Brokerage owns the seat; written agent agreement; loads on brokerage paper | Code to FMCSA-listed email, brokerage approves/revokes, loads show parent MC, per-brokerage limits | ✅ model right. ⚠ CC 360/directory not agent-aware (§3); no agent-agreement upload asked |
| Broker credit / pay behaviour | DAT CreditScore + days-to-pay; Truckstop credit; carriers will not haul without it | None. Substitutes: 3→10 posting ladder, first-delivery gate, health score | ⚠ Biggest carrier-facing gap. Cheapest credible step: show "loads delivered · avg days to pay" on the carrier's load card from LoadBoot's own settlement data; a paid credit feed later |
| Shipper identity | Uber Freight / Relay: business email domain, credit app, terms before tender | Domain + MX + site check, code to company email, 3-item packet before first booking | ✅ |
| Carrier-side disclosure | Load shows broker name, MC, verification badge (Relay/Uber: shipper hidden, platform is counterparty) | Load shows brokerage name + MC + "FMCSA-verified · broker approves your request" chip | ✅ |
| Documents / packet | Onboarding tools (MCP, RMIS) keep W-9, insurance, agreement with expiry + re-validation | 10-item packet, revalidate_days, lapsed/overdue board, reminders | ✅ |
| Fraud pattern in §4 (junk MC, own email as contact) | Highway blocks free-mail + name mismatch automatically | Lands in "Needs a human" with the truth visible; no automatic nudge to the person that their MC is not a brokerage | ⚠ small: on `entity_type='CARRIER'` or `broker_authority=false` auto-notify the agent "that MC is not a brokerage" (no staff needed) |
| Docs / SEO for agents | — | `broker-agents.html`, `freight-agent-vs-freight-broker.html` (0 clicks / 111 impressions / pos 12.7), create-broker-account copy | ⚠ pages exist; no product doc for the workflow except `docs/BROKER-SUPPLY-2026-09-02.md`; naming collision "Agent Program" (referral) vs "Broker agent" on the same nav |

## 7. Recommended order (owner decides; status per item below — 26 Sep: all 8 done)

1. **Broker 360 agent-aware** — when `broker_trust.is_agent`: hide the 8-item packet, show the brokerages block from the trust queue, and let "Approve account" pass when `agent_confirmed` (or make `cc_partner_set_status` treat a confirmed agent as packet-complete). Fixes LinkLane sitting `pending` too. *(main-loop work — touches approval logic.)*
2. **Signup picker** — `signup.html` card text; agent card at partner step A; referral card rename; `handle_new_user` list. *(small, mechanical.)* **Done 26 Sep — shipped inside `bl_bp_0448`'s commit** (`signup.html` card reads "Broker · Broker agent · Shipper" with the one-line "Freight agent posting under a brokerage? Choose Broker agent"; referral card says "Not for freight agents posting loads"; Broker Agent card at step A stored as `partner_kind='broker'` + `agent_intent=true`, so `handle_new_user`'s list did not need to change; step B pre-selects it). 26 Sep session 2 added the §5 label-only item: the broker card now reads "Freight Broker / 3PL — brokers, 3PLs and freight forwarders" (kind stays `broker`). Ships with the next site push.
3. **Auto-nudge on non-brokerage MC** — in `agent_parent_screened`, when the screen returns `entity_type='CARRIER'` / `broker_authority=false` / `not_found`, notify the agent with the legal name FMCSA returned and ask for the right MC. *(small.)* **Done 26 Sep — `bl_bp_0449`**: `agent_parent_mc_nudge`, e-mail `broker.agent_parent_mc_check` (catalogued). Fires on `not_found`, `broker_authority=false`, or unknown authority + FMCSA power units; NOT on `entity_type='CARRIER'` alone (LinkLane and M&M read CARRIER too). Once per declared MC. No backfill — SALAYIM gets it on its next screen.
4. **Directory purity** — `cc_partners_accounts` label agents "Agent of X" instead of `x/8`. *(small.)* **Done 26 Sep — `bl_bp_0450`**: three new keys (`is_agent`, `agent_tier`, `agent_parents[{name,mc,status}]`), Packet cell in `partners.js` reads them for agents only; everyone else unchanged. Full create-or-replace (staging never had bl_ops_0205, bodies now identical on both). Anon SECDEF surface unchanged, 34/33 by name.
5. **One "mandatory" definition** shared by 360 and `partner_trust_status`. **Done 26 Sep — `bl_bp_0451`** (see §3). Also puts `app_private.org_onboarding_complete` into a migration file (half of item 7).
6. **Broker pay-behaviour signal to carriers** — medium; design first. **Done 26 Sep — `bl_bp_0452` live on staging + prod; app change ships with the next site push** —
   `claude/BROKER-PAY-SIGNAL-2026-09-26.md`. Findings that changed the plan: prod `pay_transfers` has 0 rows
   and no broker-partner trip has ever been delivered, so the chip is blank for every load today; the existing
   poster-panel number (`cc_carrier_view_poster`, 0192) measures receipt-upload→carrier-confirm, not delivery→paid,
   and its "insufficient data" line prints unconditionally. `bl_bp_0452`: one `app_private.broker_pay_stats`
   (median days delivered→received, n≥3 and ≥2 carriers to show), surfaced as `details.broker_pay` on the board and
   in the poster panel; cold start shows nothing on the card and "no history yet · bond on file" in the panel.
7. Dump `onboarding_packet_templates` seed + `org_onboarding_complete` into a migration file. **Done 26 Sep — `org_onboarding_complete` in `bl_bp_0451`, the seed in `bl_bp_0453` (applied staging + prod).** Dumping it found staging was NOT at parity: 30 rows vs prod's 32 (no `broker.boc3`, no `broker.ucr`) and no `needs_expiry` column, so staging's broker packet had 6 mandatory items where prod has 7 and 0315's autofill was writing a `boc3` item no template described. 0453 is an idempotent upsert of the 32 prod rows with a row-count + content-hash check (`41241fb6…`); prod unchanged, staging now 32/7 mandatory, hash identical. Anon SECDEF 36/35 by name, unchanged.
8. Handle the four July "(Agent)" orgs: archive, or convert to real agents once a brokerage confirms them (BROKER-SUPPLY §"YASEEN" item 6 is still open).
   **Done 26 Sep — owner chose path (a); `bl_bp_0454` applied staging (no-op) + prod.** All four now have a `broker_trust` row with
   `is_agent=true` and no parent: Ali Raza and Asim Latif read tier `new` and land on the portal's agent card to declare a brokerage MC
   (flows through 0449's nudge as normal); Usman and Charanpreet carry `hold_reason` (tier `hold`; a brokerage confirming them clears it).
   `organizations.status` untouched (nothing on the broker side reads `paused`). Audit row `broker.agent_converted` per org. Anon SECDEF 36/35 by name, unchanged.
   **Facts pulled 26 Sep (prod, read-only), owner decides:** all four are `kind=broker`, `mc_number`/`dot_number` NULL, no
   `broker_trust` row at all (so `is_agent` NULL, not false), no `broker_screenings`, 0 loads as `broker_org`, 0 packet items.

   | Org | status | created | login | last sign-in |
   |---|---|---|---|---|
   | Ali Raza (Agent) | active | 18 Jul | loadboot90@gmail.com | 11 Sep |
   | Asim Latif (Agent) | active | 18 Jul | asimmr749@gmail.com | 25 Sep |
   | M Usman Farooq (Agent) | pending | 22 Jul | musmanfarooq.dispatch@gmail.com | 20 Jul |
   | Charanpreet Kaur (Agent) | active | 22 Jul | charanpurba99@gmail.com | 25 Jul |

   Two still log in (Asim yesterday), so this is not dead data. `organizations.status` has no `archived` value on prod
   (only `active` / `pending` / `paused`), so "archive" today means `paused` + a `hold_reason`, or deleting the org. Nothing
   was changed. Recommended path, pending BROKER-SUPPLY item 6: (a) if LoadBoot will NOT hold broker authority, convert
   the two live ones (Asim, Ali Raza) into real agents — insert their `broker_trust` row with `is_agent=true` and let them
   declare a partner brokerage MC from the portal, which then flows through 0449's nudge / the code e-mail as normal; set
   Usman and Charanpreet to `paused` with `hold_reason='july agent placeholder — no brokerage'`; (b) if LoadBoot WILL obtain
   authority, they become agents under LoadBoot's own MC the same way once it exists. Either way the `kind=broker, active,
   no MC` shape should not survive — it is exactly what the §5 picker fix now prevents at signup.
