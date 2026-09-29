# Shipper two-lane marketplace — bl_ship_0491…0497 (28 Sep 2026)

Two ways for a shipper to move a load:

- **Direct to carrier.** The shipper posts the load, sets the rate, and **chooses** the carrier. It pays the carrier directly.
- **Tender to a verified broker.** The shipper chooses the broker. The broker books the truck under its own contract with the shipper.

LoadBoot is the software and the marketplace. It never sets the rate, never picks the carrier or the broker, and never holds freight money.

**Status:** everything below is **applied and tested on STAGING only** (`snslhvmkjusozgjelghi`). Prod is untouched and waits for the owner's "prod pe chalao".

---

## 1. Owner decisions (28 Sep 2026)

| Decision | Answer |
|---|---|
| Lanes | Direct (carriers) + Broker (tender) + both. Shipper chooses per load. |
| Shipper and broker fees | None for now. Config has no shipper fee. |
| Carrier 5% dispatch fee | Kept. Owner's reasoning: the shipper posts and chooses, payment is direct, and the carrier pays for the dispatch/platform service. The Platform Terms disclose it as a carrier-paid service fee, never part of the freight charge. |
| Agreements | Claude drafts them from US law (`claude/agreements/`). The owner reviews and approves, then they are published. Until then **no lane can open** (legal gate enforced by data). |
| Company verification | Free automatic checks where possible. The rest is manual by staff. No paid service. |
| New-shipper limits | Suggested and implemented: 3 open direct loads, $100,000 cargo value per load, lifted after 3 carrier-confirmed paid loads. Staff can lift early with a written reason. |
| High-value threshold | $100,000 (typical carrier cargo cover). Editable in `app_private.shipper_config`. |
| Git branch | `claude/loving-wright-ucajmf` (cloud session; the owner merges `claude/*` into `main` as before). |
| Prod test account | `yuayui788@gmail.com` (see §6). |

## 2. When can a shipper post?

| Stage | Can do |
|---|---|
| `new` | Explore, market rates, drafts. **Nothing reaches carriers or brokers.** |
| `identity_verified` | Identity section done: legal entity, address, signer (staff-verified), company email, signer phone code, independent call-back. Still no posting. |
| `broker_ready` | Identity + Platform Terms + billing (terms, invoicing, AP) + credit references + cargo + insurance + declared value + claims contact + acks. Can **send tenders to verified brokers**. |
| `direct_ready` | Identity + Platform Terms + **Shipper–Carrier Terms** + billing + cargo + insurance + declared value + claims + **≥1 location** + acks incl. "you choose the carrier". Can **post to carriers**. |
| `both_ready` | Both lanes open. |
| `hold` | Hold reason set, or the call-back failed. Nothing moves. |

Load-level checks happen when the shipper posts:
- a hazmat load needs the Hazmat section;
- a food commodity needs the Food (FSMA) section;
- a load worth more than $100k needs the High-value section;
- while the shipper is new, the open-load cap and the value cap apply.

A shipper's load is **never instant-booked**. Every carrier is accepted by the shipper, either through a request-to-book or through the shipper's own direct offer.

## 3. What was built

### Database (`migrations/bl_ship_0491…0497_*.sql`)
- **0491:**
  - `shipper_config` and flags `shipper_direct_lane` / `shipper_broker_lane` (kill switches, ON).
  - Templates gained `section / purpose / required_for / item_type / condition`.
  - The shipper packet was rebuilt as sections A–G (25 items: 19 always, 6 conditional — the call-back is on for everyone while `callback_required_for_all` is true).
  - `org_onboarding_items.data` and file fingerprint columns.
  - `shipper_facilities` (address book).
  - `agreement_signatures` (ESIGN record: name, title, consent text, SHA-256 of the text, IP, user agent).
  - `master_agreements` kinds `shipper_platform` / `shipper_carrier` as unpublished drafts.
  - Trust columns and a risk trigger (`needs_human`).
  - Gate functions: `shipper_lane_gate`, `shipper_stage`, `shipper_tier`, `shipper_can_post`, `assert_shipper_lane`.
  - Validation (`shipper_validate`).
  - Shipper RPCs: `cc_shipper_onboarding`, `cc_shipper_item_save`, `cc_shipper_agreement(_sign)`, `cc_shipper_facilities / _facility_save / _facility_archive`, `cc_shipper_phone_code_send`, `cc_shipper_code_verify`.
  - Staff RPCs: `cc_shipper_callback_start / _fail`, `cc_shipper_limits_lift`.
- **0492:**
  - The posting trigger uses the lane gate.
  - No instant booking on shipper loads.
  - `cc_decide_book_request`: only the shipper approves on its load; staff can only decline; `'decline'` is now accepted (the portal button used to fail).
  - `cc_decide_partner_shipment`: staff can no longer quote or book; decline (block) only.
  - `cc_partner_update_profile`: patch semantics, so an empty field no longer wipes data.
  - Upload guard: server-side eTag+size fingerprint. The same file in two slots is refused. Tender/BOL/POD/rate-con/invoice filenames are refused in onboarding slots. The same file on two accounts sets `needs_human`.
  - Business-check collector stores risk signals; its copy is fixed.
  - `welcome.shipper` copy fixed.
  - Broker lane refuses politely while no verified broker exists.
- **0493:**
  - `org_onboarding_complete` / review-item completion / `cc_partner_overview` read the lane gates for shippers.
  - `cc_shipper_brokers` (Brokers tab).
  - A tender can name the broker the shipper chose.
  - `cc_assign_shipment` is refused: staff never allocate a shipper's freight.
  - `cc_shipper_verification` (staff view).
- **0494:** the book-requests queue carries `owner_kind`.
- **0496:** a shipper's direct load must carry a cargo value, so the value cap and the high-value check always run. The post wizard marks the field required for shippers.
- **0495:** a "[loads@ unparsed]" mailbox item raises a staff alert.
- **0498 (29 Sep, owner agreement review):**
  - The carrier accepts the Master Shipper–Carrier Terms **once**, in its own app: `cc_carrier_shipper_terms` and `cc_carrier_shipper_terms_sign`. Only an owner or office user can sign (`my_carrier_signer_org`). A dispatcher or driver never can.
  - Without that signature, `trg_bookreq_shipper_terms` refuses the book request and `cc_offer_respond` refuses the accept (`SHIPPER_TERMS:` prefix). The carrier app catches that error, shows the Terms, and retries after signing.
  - Dispatch guard: on a shipper load a LoadBoot dispatcher cannot put a note on a book request (it is replaced with "Requested at your posted rate by the carrier's LoadBoot dispatcher") and cannot counter an offer. The carrier's own users can still counter.
  - Rollback test on staging, all passing: gate before and after signing, dispatcher cannot sign, bad sha refused, dispatcher note and counter refused, carrier's own counter allowed, non-shipper load untouched. The anon surface is unchanged: 35, md5 `b862e7e2…`.
- **0499 + 0499b (29 Sep, owner: "hum shipper se rate ki baat nahi karenge"):** only the carrier or broker the shipper offered the load to may counter.
  - `cc_offer_send` (staff offer at a staff-chosen rate) refuses a shipper's own load.
  - `trg_no_shipper_rate_talk` guards `mail_messages`, `dialer_messages` (SMS), `wa_messages`, `comm_messages` (thread on a shipper load) and `lc_messages` (live chat). A staff message is refused. The AI brain's reply is replaced with a neutral line.
  - The dmail mailboxes (hello@, dispatch@ and the rest) call `svc_shipper_rate_guard` before SMTP (edge function `dmail`). It fails closed, except with PGRST202 (guard not installed).
  - A "shipper contact" is: a member's email or phone, the company email, the call-back phone, a facility phone, an email or phone in the onboarding answers, or a live-chat `visitor_role = 'shipper'`.
  - The detector (`rate_talk_reason`) is a pattern filter, not proof. It catches money + rate words, per-mile/rpm, counter-offers, a number next to "all in/flat/rate", and "raise/lower the rate". It ignores "rate confirmation" and quoted mail.
  - Other pieces: brain rule `rule.no_shipper_rate_talk` (live), and dispatcher conduct terms **v2-2026-09-29** with a no-rate-talk line (re-accepted at the next carrier choice).
  - Staging rollback tests are all passing. The anon surface is still 35, same md5.
  - **Not covered:** phone calls, including Riley voice. Put the same rule in Riley's prompt.
- **0497:** `shipper_badge` tells the broker who is behind a tender: stage, identity verified, call-back confirmed, payment terms, whether credit references were given, and platform terms signed. Never the EIN, bank or reference details. The broker inbox shows it (`shipper-trust.js` `shipperBadge`). The fallback itself already existed (inbound-mail v6, 27 Sep).

### Edge function
`supabase/functions/domain-check` **v6** is deployed on staging (version 18). It adds:
- RDAP domain age;
- DMARC and SPF;
- MX class (corporate / budget host / self-hosted);
- SEC EDGAR name hit, counted only for a filer's own name or an Exhibit 21 subsidiary list.

Verified live: the MII case returns `budget_host`, and SEC hits "Victoria's Secret & Co." (MII Brand Import is on its EX-21).

### Portal (`app/partner/`)
- `shipper-onboarding.js` (new):
  - **Verification** tab: sections A–G, a one-line purpose per item, per-lane progress, new-shipper limits, forms with server validation and "are you sure?" confirmations, e-sign, locations, email/phone codes, uploads.
  - **Brokers** tab: verified brokers, or a polite "coming soon (2–3 days)" card with "Post to carriers today" and "Invite your broker".
  - Dashboard **lane card**.
- `app.js`:
  - Shipper nav has Brokers, and Documents is renamed Verification.
  - Dashboard gate uses the lane card.
  - Profile key bug fixed (`contact_name` → `contactName`).
- `app/shared/api.js`: wrappers.

### Command Center
- `views/shipperVerify360.js` (new), in Shipper 360 → **Two-lane verification**:
  - lane gates;
  - fraud signals;
  - section answers with Verify / Reject;
  - independent call-back form (the number's source is required, and the signup number is refused);
  - call-back failed → hold;
  - lift limits.
- `views/bookingRequests.js`: a shipper's load shows "Shipper decides" instead of Approve.
- `views/partnerIntake.js`: Quote and Book buttons removed; "Decline (block)" only.

### Tests
- **Staging rollback tests, all passing.** Every test runs in a transaction that is rolled back.
  - 25 lane/validation/agreement/guard cases;
  - 2 real-trigger inserts;
  - 5 portal-RPC cases.
- **`tests/shipper_onboarding_render_test.mjs`** (4/4 pass):

  ```
  node --experimental-vm-modules --test tests/shipper_onboarding_render_test.mjs
  ```

- The anon-executable SECURITY DEFINER surface on staging is unchanged: **35**, same names md5 `b862e7e2…`.
- **Not done:** a real-browser click-through of the portal against staging. It needs a staging login. Do it before prod.

## 3b. Staging browser walkthrough — 29 Sep 2026

I used a local staging-bound build (`CONTEXT=dev` + staging anon key) in Chromium. The test accounts are Resend test sinks:
- `delivered+lb-shipper-0499@resend.dev` — shipper org "Claude Test Shipping LLC";
- `delivered+lb-carrier-0499@resend.dev` — "Claude Test Carrier 0499";
- `delivered+lb-staff-0499@resend.dev` — `operations_admin`;
- dummy mailbox `claude-test-0499@loadboot.test`, with SMTP at `smtp.invalid`, now `paused`.

They are staging only. Their passwords were never stored in the repo. Create fresh ones the same way next time.

**Passed:**
- Shipper signup and the kind picker.
- The dashboard lane card.
- The Verification tab (sections A–G, lane progress).
- Both agreements signed in the UI. Each ESIGN row has the name, title, IP, UA, and a SHA-256 equal to the published text.
- 13 forms saved through `cc_shipper_item_save`, with server validation.
- Location saved.
- Staff verified the 3 identity items. The shipper reached `direct_ready`.
- Post wizard: cargo value is required (0496). The load was submitted, then staff posted it.
- The carrier sees the load. "Request to book" returns `SHIPPER_TERMS` (403), the Terms dialog appears, the carrier signs, and the request retries on its own. It then stops at the next, unrelated gate: the test carrier has no driver.
- dmail v9: a rate mail to the shipper (including rate text in the subject with the shipper on cc) is refused before SMTP. A clean mail passes the guard.

**Shortcuts (said plainly):** `phone_verify` and `independent_callback` were set to verified by SQL. Both place real Retell calls, and I did not call a real number. The shipper never approved the carrier (no driver). The test load was cancelled afterwards.

**Fixed from the walkthrough (in this commit):**
- `0499c`: `cc_decide_partner_load('post')` calls `cc_offer_send` for the shipper's own chosen carrier, and 0499 would have broken that. It is now let through only for that load, at the load's own rate.
- Post wizard copy for shippers. The old text said "settlement runs through LoadBoot", "LoadBoot dispatch is the day-of contact", "goes to dispatch" and "our dispatch team will review it". It now says: you pay the carrier directly, LoadBoot only records it, and LoadBoot checks for fraud and safety but never changes your rate or picks the carrier. The broker text no longer claims that settlement runs through LoadBoot either.
- The shipper no longer sees the "sell-side guide (+15%)" broker margin line. The lumper line says "you pay" for a shipper.
- Carrier request modal: "The shipper or broker who posted it reviews…" (it used to say "The broker").
- Agreements rendered as raw Markdown. `app/shared/ui/mdLite.js` now renders them as formatted text using text nodes only.
- Test `tests/app_modules_parse_test.mjs` makes every app module parse as ESM (see the partner outage below).

**Found and fixed on 29 Sep (owner: "suggest and implement the best"), verified in the browser:**
1. **Accessorials on shipper loads are suggested defaults, not a floor.** For shippers the wizard says "Your rate card. These are suggested industry defaults — you set the numbers… LoadBoot does not set them". "Change ▸" can go up or down, and the test set detention to $40 against a suggested $60. The DB never enforced a floor (`enforce_load_ready` only needs a number, and `claim_rate` uses the load's own value), so no migration was needed. Brokers keep the standards floor.
2. **Emergency Rescheduling Policy text for shippers:** "the carrier shows you the proof and live GPS in the portal and may move the delivery window; you have 2 hours to confirm… LoadBoot does not decide it". There is no "Dispatch verification" any more.
3. **Carrier board:** a shipper's own load says "📦 Shipper's own load — you contract with the shipper". `0499d` adds `details.poster_kind`.
4. **Shipper dashboard banner** follows the lane gates: "Verified — you can post to carriers" / "Verify your company to start shipping".
5. **Welcome text** (`cc_partner_register`, `0499d`) no longer promises quotes; it points to Verification.
6. **Shipper Invoices tab (owner screenshot):** it showed "PAY TO — LoadBoot", Payoneer and bank details. It now shows "LoadBoot does not bill shippers — you pay each carrier directly (Payables)" plus the fraud warning. Prod has zero LoadBoot invoices to shippers (only 2 broker invoices), so nothing legitimate is hidden.
7. **Prod safety (`shipV2`):** the two-lane shipper UI (Verification, Brokers, lane card) shows only when `cc_partner_overview` returns `shipper_stage`, which happens only with 0493+. On prod before the rollout, shippers keep the previous UI instead of calling functions that do not exist. When the rollout lands, the new UI switches on by itself.

**Still open:**
1. The staff "post" step: a shipper's load waits in `submitted` until staff post it. That is a review gate, not allocation. **Drafted 29 Sep as Platform Terms v2** (`claude/agreements/SHIPPER-PLATFORM-TERMS-v2.md`, new §4.4 + §2.3 wording; details in `claude/agreements/README.md`). Waits for owner approval, then staging publish.

**Partner portal outage (production):** since `d8bf908`, `app/partner/app.js:4574` had a mid-line `//` comment that swallowed a closing brace. The whole Partner portal (brokers and shippers) rendered blank on loadboot.com. It was fixed and pushed to `main` as `06536c4` on 29 Sep.

## 4. Handoff corrections (verified in code/DB)

1. **"`cc_shipper_post_load` has no gate" was wrong.** A trigger gated it. The gate was simply weak (email MX + website).
2. **The Direct lane already existed.** Shippers were routed to the broker portal (`brokerDash`) and posted to carriers via `cc_partner_submit_load`. `shipperDash` / `cc_shipper_post_load` were unused by the UI.
3. **Pay rail is peer-to-peer.** The payer sees the carrier's own bank or the factor's. LoadBoot only records "sent" and "received". LoadBoot's bank appears only for the carrier's platform fee.
4. **The FMCSA guidance citation is 88 FR 39368 (16 Jun 2023)**, not 88 FR 39152.
5. **Load-mail:** mail was not being lost after 27 Sep (inbound-mail v6 files it as "[loads@ unparsed]"). Only the alert was missing. That is now fixed (0495).

## 5. Risks and open items for the owner

1. **Agreements.** Owner review done on 29 Sep: Texas law and courts; liability cap = greater of 12 months' fees or $100, plus a consequential-damages exclusion; the fee wording is honest; boilerplate added (see `claude/agreements/README.md`). The only blank left is the publication date. An attorney review is still recommended. **Until they are published, no shipper can open a lane on either environment.** For a staging walkthrough before approval, the drafts can be published on staging only as a clearly marked test copy (ask first).
2. **LoadBoot dispatchers talking rates with shippers.** *Closed in code by 0498 and 0499/0499b*: book-request note, counter-offer, staff offers, and every text channel (mail, dmail, SMS, WhatsApp, CC threads, live chat and the AI brain). The conduct terms are v2. Voice calls are still policy only. Original note: FMCSA 2023 guidance (IV.F) lists "interacts with or negotiates any shipment of freight directly with the shipper" as an indicator that a dispatch service needs broker authority. On direct loads the shipper sets the rate and carriers request at it. Dispatchers should **not** counter-offer to shippers. This is not yet enforced in code (counter-offer paths were not audited). The marketing copy no longer claims dispatchers negotiate with shippers.
3. **Existing shippers on prod (4).** After prod rollout they fall back to `new` until they complete the new verification. They are told by the portal. A draft message to them is for the owner to send.
4. **Staff approving carriers on broker loads** is still allowed (unchanged). This is the owner's call.
5. **Phone codes use the Retell verify agent** (real calls). Staging has it configured. Tests inserted code rows directly and placed no calls.
6. **Per-load location linking.** Posting currently requires ≥1 saved location. Picking a saved location inside the post wizard is a follow-up.

## 6. Prod rollout (only on "prod pe chalao")

1. Read the anon baseline (must be 36, names per `docs/audit-2026-09/anon-secdef-baseline.md`).
2. Apply 0491 → 0492 → 0493 → 0494 → 0495 → 0496 → 0497 → 0498 → 0499 → 0499b → 0499c → 0499d (same files).
3. Deploy domain-check v6 **and dmail** (with the 0499 guard). Compare each deployed version to repo HEAD first. Deploy dmail only after 0499 is applied.
4. Re-read the anon baseline: still 36, same names.
5. Publish the agreements with the SQL in `claude/agreements/README.md`, then check the SHA-256 against the README: `SHIPPER-CARRIER-TERMS-v1.md` (approved 29 Sep, published on staging) and **Platform Terms v2** (`SHIPPER-PLATFORM-TERMS-v2.md`, once the owner approves it and it is published on staging first). Leave the prod `shipper_platform` v1 row unpublished. If v2 is still unapproved on rollout day, publish v1 as before and v2 later — every shipper then re-signs.
6. Test account `yuayui788@gmail.com`:
   - it signs up as a shipper;
   - staff set `organizations.is_demo = true` so it never reaches real carriers;
   - pair it with the internal test carrier (`bl_sec_0490`);
   - Gmail means it also exercises the no-website / manual-identity path (EIN letter + address proof + call-back).
7. MII BRAND IMPORT LLC (`e3f7d7b9-6da8-4905-9c08-9a743a491d12`): leave it on hold until an independent call-back to a number sourced outside signup confirms the company. Do not open its uploaded PDF unscanned.
