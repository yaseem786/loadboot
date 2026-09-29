# Shipper registry check — plan (29 Sep 2026, owner: "hai ye bhi banana")

## Why
The MII Brand Import case (see `SHIPPER-TWO-LANE-0491.md` §6 status).

- The signup domain was 4 days old, and the name copies a Victoria's Secret subsidiary.
- It passed our email and website checks, because it controls its own domain.

Today staff can verify the **EIN letter** and **address proof** just by looking at the upload. Both are easy to fake, and a big company's EIN and address are public.

A document only proves something once staff compare it with a record **they pulled themselves**.

## What to build

### 1. Staff "Registry check" (CC → Shipper → Verification)
- A new staff-only item in the `identity` section: `registry_check` (item_type `staff`, required for both lanes).
- It opens from the shipper's `legal_entity` answers (state of formation + entity number). A deep link opens that state's Secretary of State search, with the entity number shown for copy.
- Staff fill in what the registry says:
  - legal name;
  - entity number;
  - status (active / inactive);
  - formation date;
  - principal address;
  - managers / officers / organizer (names);
  - registry URL;
  - a screenshot upload.
- Automatic comparisons, shown as ✓ / ✗:
  - registry name vs `legal_entity.legal_name`;
  - registry address vs `physical_address`;
  - the signer (`authorized_signer.name`) appears among the managers / officers;
  - formation date: less than 180 days old → warning;
  - name matches an SEC company (`sec_name_hit`) but the entity number is not that company's → red warning.

### 2. EIN letter and address proof only verify against the registry
- `cc_onboarding_review_item` must refuse "verify" on `ein_letter` / `address_proof` until `registry_check` is verified.
- Staff tick "name and address on this document match the registry record". The tick is stored with the review.
- If the signer is **not** in the registry, the account needs a written authorization from the company, confirmed through an independent channel (call-back, an email on a domain the registry or official site lists, or a code sent by post).

### 3. The SEC-name rule
When `sec_name_hit` is true, a code confirmed on the **signup** domain does not count as proof of identity. Staff must approve the domain of the confirmed company email.

### 4. Research first (the next session must confirm this — nothing below was searched yet)
- Which states publish **free** open data or an API for business entities (believed: NY data.ny.gov, CO data.colorado.gov, FL Sunbiz bulk, WA, OR). Where it exists, pre-fill the registry card automatically; everywhere else, keep the manual card with a deep link.
- Paid multi-state APIs (OpenCorporates, Middesk, Cobalt) are out of scope unless the owner approves (standing decision: "no paid service").
- Optional, owner decision: Google Places to suggest a phone number for the registry address (staff still click "Call"), and Lob / PostGrid to post a code letter to the registry address. Check current prices before proposing either.

## Rules that apply
- Staging first. Prod only on "prod pe chalao".
- New `public` functions: `revoke … from public, anon` explicitly. Check the anon surface by **name** before and after (prod 36, names md5 `06f779f7…`; staging 35, `b862e7e2…`).
- Any email this adds goes through the email catalog (CLAUDE.md §6).
- Test the refusal paths on a throwaway shipper, never on MII or any real shipper.

---

## Status 29 Sep 2026 — built and tested on STAGING (`bl_ship_0502`). Prod waits for "prod pe chalao".

### §4 research (done this session)
**Free state open data — checked by hand** (each dataset queried; columns read from `/api/views/<id>.json`; no key, CORS open):

| State | Dataset | Look up by | Gives | Note |
|---|---|---|---|---|
| NY | data.ny.gov `n9v6-gdp6` | `dos_id` | name, filing date, process/location address, chairman, registered agent | **active only**; no LLC members |
| CO | data.colorado.gov `4ykn-tg5h` | `entityid` | name, status, formation date, principal address, registered agent | all statuses; no officers |
| CT | data.ct.gov `n7gp-d28j` + Principals `ka36-64k6` | `accountnumber` | name, status, address, principals | all statuses |
| OR | data.oregon.gov `tckn-sxa6` | `registry_number` | name, registry date, principal place, agent, members | **active only**, one row per name |
| PA | data.pa.gov `xvd7-5r2c` | `filing_number` (10 digits) | name, creation date, address, officers | **current only**, one row per officer |

Not found as free machine-readable data (research agent's result, not re-checked by hand; WA only returned endpoint errors, so it may still exist): DE, TX, CA, OH, IL, GA, NJ, NC, MI, MA, VA, AZ, NV, WY, WA (Iowa's old Socrata set is gone). FL has a free SFTP bulk dump (not used). Delaware's free search shows no status or officers — ask the shipper for a Certificate of Good Standing. Texas Comptroller's free search shows status and officers. Any other state: the card links the NASS directory.

**Paid options (owner decision; nothing is wired):**
- Google Places, phone for an address: the phone field is the **Enterprise** SKU (checked on Google's data-fields page). Place Details Enterprise: 1,000 free/month, then $20 per 1,000. Text Search Enterprise: 1,000 free, then $35 per 1,000. Text Search IDs-only: free, unlimited. At 5–30 shippers a month it stays inside the free cap, but it needs a Google Cloud billing account and an API key.
- Code letter by post: Lob Developer plan **$0.828**/letter, no monthly fee, free test mode. PostGrid Starter **$1.019**/letter, no monthly fee. Click2Mail **$1.45**/letter. Stannp US: price not published. At 10 letters/month: **≈ $8.28 with Lob**. The Lob and PostGrid numbers were read from their pricing pages by a research agent; I did not re-open those pages.

### What was built
- `migrations/bl_ship_0502_registry_check.sql`:
  - template `registry_check` (staff, identity, both lanes);
  - `app_private.sos_registries` (14 states: search link, CO/OR deep link, the 5 datasets);
  - `shipper_registry_eval` does the comparisons: state, number, name (suffixes and punctuation ignored), address (house number + city + ZIP), signer in one person line, active, age < 180 days, SEC name;
  - the answers snapshot re-opens a verified check when the shipper edits a compared answer;
  - staff RPCs `cc_shipper_registry_check` / `cc_shipper_doc_verify` / `cc_shipper_email_domain_approve`;
  - review gate on `cc_onboarding_review_item`;
  - SEC rule in `shipper_item_status('email_verify')`;
  - `cc_onboarding_submit_item` accepts only upload items from shippers (it took any template key before).
- Hard refusals on Verify:
  - not active;
  - no link or no screenshot (the file must exist in storage);
  - no formation date;
  - state or number mismatch;
  - name or address mismatch without a written reason;
  - signer not listed without a written authorization + how it was confirmed (the call-back route needs a confirmed call-back);
  - SEC hit without the SEC company's entity number;
  - a different number from the SEC company's, unless there is a confirmed call-back and a 20+ character reason.
- A domain younger than `domain_min_age_days` cannot be approved under the SEC rule. A 4-day-old domain like MII's is refused.
- CC:
  - `views/shipperRegistry360.js`: the registry card, the "Verify vs registry" tick dialog for the EIN letter and address proof, and the SEC email-domain block;
  - `views/registry-prefill.js`: open-data adapters, run in the staff member's browser;
  - wired into `shipperVerify360.js`, with wrappers in `shared/api.js`.
- The portal needs no change: the item shows as "State registry check", with a purpose line and no button.

### Tests
- `tests/bl_ship_0502_registry_check_rollback.sql` on staging: 31 cases, all passing, rolled back. They cover non-staff, wrong number, the direct-verify bypass, dissolved, no screenshot, fake file, address, signer, callback route, good verify, stale snapshot, doc before registry, tick missing/half/stale, shipper submitting staff items, SEC domain young/wrong/approved, SEC number missing/look-alike/same, and the staff view.
- `tests/registry_check_render_test.mjs`: 7/7 (adapters on fixtures + card render).
- Live adapter probe against the real 5 datasets: all returned records.
- `npm run check`: pass.
- Anon on staging: **35, names md5 `b862e7e2…` before and after**. The stored migration text md5 is `57b4fd9d…`, the repo file with the trailing newline stripped.

### Effect on existing shippers
Every shipper now needs a registry check before any lane opens.
- Staging: `Claude Test Shipping LLC` went from `identity_verified` to `new`.
- Prod (read-only check today): all 5 shippers are already `new`, and none has filled legal entity yet, so nothing that is open closes.
- MII's `name_collision` is false on prod: the v6 signals never ran for it. The SEC rule only bites after domain-check runs for it again.

### Prod rollout (only on "prod pe chalao")
1. Anon baseline: 36, md5 `06f779f7…` (bare proname, comma-joined, sorted).
2. Apply `bl_ship_0502_registry_check.sql`. The file raises by itself if the anon names change.
3. Re-read: still 36, same md5. Compare the stored statement md5 with the repo file.
4. Deploy the site: CC files `shipperRegistry360.js`, `registry-prefill.js`, `shipperVerify360.js`, `shared/api.js`.
5. Optional: re-run domain-check for MII so its SEC signal is stored.
