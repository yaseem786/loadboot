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
