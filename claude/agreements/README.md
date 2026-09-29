# Shipper agreements — drafts (bl_ship_0491)

| File | DB row | Signed by |
|---|---|---|
| `SHIPPER-PLATFORM-TERMS-v1-DRAFT.md` | `app_private.master_agreements (kind='shipper_platform', version=1)` | Shipper ↔ LoadBoot |
| `SHIPPER-CARRIER-TERMS-v1-DRAFT.md` | `app_private.master_agreements (kind='shipper_carrier', version=1)` | Shipper and each carrier. **LoadBoot is not a party.** |

**Current state:** both rows exist with placeholder text, `legal_approved=false` and `published=false`.
While they stay that way:
- the portal shows "This agreement is being finalised";
- no shipper can sign;
- **no shipper can open a lane.**

This is deliberate. It is the legal gate.

## To publish, after the owner (and ideally an attorney) approves the text

1. Fill every **[bracket]** in the draft.
2. Remove the DRAFT banner and the "Sources" and "Items to decide" sections from the body. Keep them in this folder.
3. On staging, run the SQL below, then test signing with a test shipper:

```sql
update app_private.master_agreements
   set body_md = $body$ …final text… $body$,
       title = 'LoadBoot Platform Terms for Shippers',
       legal_approved = true, published = true, published_at = now()
 where kind = 'shipper_platform' and version = 1;
```

4. Do the same for `shipper_carrier`.
5. On prod, run it only when the owner says "prod pe chalao".

## Changing the text later

Never edit a published version. Insert `version = 2`. Every shipper is then asked to sign again, because
`shipper_item_status` compares their acceptance with the latest published and approved version.

Every signature is kept in `app_private.agreement_signatures`, together with the SHA-256 of the exact text
the shipper saw.

## Owner review — 29 Sep 2026 (`bl_ship_0498`)

- **Governing law and forum:** Texas law and Texas courts, with a 30-day talk-first step, the same as the carrier Terms draft. LoadBoot LLC itself is a Wyoming LLC.
- **Liability cap:** the greater of 12 months' fees or US$100, plus a mutual consequential-damages exclusion.
- **Carrier side:** a carrier accepts the Shipper–Carrier Terms once, in its own app, and only an owner or office user can sign. It is enforced in the DB: `trg_bookreq_shipper_terms` blocks book requests and `cc_offer_respond` blocks accepts. A dispatcher can never sign for the carrier.
- **Dispatch guard:** on a shipper load, a LoadBoot dispatcher cannot add a note to a book request and cannot counter an offer. FMCSA 2023 guidance, IV.F. Clauses: Platform §2.5 and Shipper–Carrier §1.5.
- **Fee wording:** §2.3(d) now says LoadBoot receives no part of the freight charge *from the shipper*. §7.4 discloses that the carrier's fee is a percentage of the carrier's revenue for the load.
- **Boilerplate added:** entire agreement, severability, no waiver, assignment, notices, force majeure and survival.
- **Blanks left:** only `[DATE OF PUBLICATION]`, filled in when it is published.

## Broker–Shipper terms

In the broker lane the broker's own contract governs. A LoadBoot standard template already exists as
`master_agreements (kind='broker_shipper', v1, unpublished)`, which was untouched by this work.

## Source notes

The research sources, with primary citations and the items marked UNVERIFIED, are at the end of each draft.
