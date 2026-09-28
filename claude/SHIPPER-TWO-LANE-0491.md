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

## 4. Handoff corrections (verified in code/DB)

1. **"`cc_shipper_post_load` has no gate" was wrong.** A trigger gated it. The gate was simply weak (email MX + website).
2. **The Direct lane already existed.** Shippers were routed to the broker portal (`brokerDash`) and posted to carriers via `cc_partner_submit_load`. `shipperDash` / `cc_shipper_post_load` were unused by the UI.
3. **Pay rail is peer-to-peer.** The payer sees the carrier's own bank or the factor's. LoadBoot only records "sent" and "received". LoadBoot's bank appears only for the carrier's platform fee.
4. **The FMCSA guidance citation is 88 FR 39368 (16 Jun 2023)**, not 88 FR 39152.
5. **Load-mail:** mail was not being lost after 27 Sep (inbound-mail v6 files it as "[loads@ unparsed]"). Only the alert was missing. That is now fixed (0495).

## 5. Risks and open items for the owner

1. **Agreements.** The drafts are in `claude/agreements/`. Blanks to fill: governing state, dispute forum, liability cap. **Until they are published, no shipper can open a lane on either environment.** For a staging walkthrough before approval, the drafts can be published on staging only as a clearly marked test copy (ask first).
2. **LoadBoot dispatchers talking rates with shippers.** FMCSA 2023 guidance (IV.F) lists "interacts with or negotiates any shipment of freight directly with the shipper" as an indicator that a dispatch service needs broker authority. On direct loads the shipper sets the rate and carriers request at it. Dispatchers should **not** counter-offer to shippers. This is not yet enforced in code (counter-offer paths were not audited). The marketing copy no longer claims dispatchers negotiate with shippers.
3. **Existing shippers on prod (4).** After prod rollout they fall back to `new` until they complete the new verification. They are told by the portal. A draft message to them is for the owner to send.
4. **Staff approving carriers on broker loads** is still allowed (unchanged). This is the owner's call.
5. **Phone codes use the Retell verify agent** (real calls). Staging has it configured. Tests inserted code rows directly and placed no calls.
6. **Per-load location linking.** Posting currently requires ≥1 saved location. Picking a saved location inside the post wizard is a follow-up.

## 6. Prod rollout (only on "prod pe chalao")

1. Read the anon baseline (must be 36, names per `docs/audit-2026-09/anon-secdef-baseline.md`).
2. Apply 0491 → 0492 → 0493 → 0494 → 0495 → 0496 → 0497 (same files).
3. Deploy domain-check v6 (compare the deployed version to repo HEAD first).
4. Re-read the anon baseline: still 36, same names.
5. Publish the agreements only after the owner approves the text.
6. Test account `yuayui788@gmail.com`:
   - it signs up as a shipper;
   - staff set `organizations.is_demo = true` so it never reaches real carriers;
   - pair it with the internal test carrier (`bl_sec_0490`);
   - Gmail means it also exercises the no-website / manual-identity path (EIN letter + address proof + call-back).
7. MII BRAND IMPORT LLC (`e3f7d7b9-6da8-4905-9c08-9a743a491d12`): leave it on hold until an independent call-back to a number sourced outside signup confirms the company. Do not open its uploaded PDF unscanned.
