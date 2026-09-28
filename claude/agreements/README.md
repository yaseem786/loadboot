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

## Broker–Shipper terms

In the broker lane the broker's own contract governs. A LoadBoot standard template already exists as
`master_agreements (kind='broker_shipper', v1, unpublished)`, which was untouched by this work.

## Source notes

The research sources, with primary citations and the items marked UNVERIFIED, are at the end of each draft.
