# Shipper agreements — drafts (bl_ship_0491)

| File | DB row | Signed by |
|---|---|---|
| `SHIPPER-PLATFORM-TERMS-v1-DRAFT.md` | `app_private.master_agreements (kind='shipper_platform', version=1)` | Shipper ↔ LoadBoot |
| `SHIPPER-CARRIER-TERMS-v1-DRAFT.md` | `app_private.master_agreements (kind='shipper_carrier', version=1)` | Shipper and each carrier. **LoadBoot is not a party.** |

**Current state (29 Sep 2026):** the owner approved the text, and it was **published on STAGING** on 29 Sep 2026.
- Final published text: `SHIPPER-PLATFORM-TERMS-v1.md`, SHA-256 `b8ddaed3cb26a3ed5c9e4de1b748990a776a54468d807285d85f103caac27af3`.
- Final published text: `SHIPPER-CARRIER-TERMS-v1.md`, SHA-256 `5ca65f64ac11c57b4c6a3a80f7a730d8ee851b4a3315aabf6cec05b0b63fa167`.
- `-DRAFT.md` files: the review copies, with sources.
- **Prod:** not yet. On "prod pe chalao", after 0491–0498, publish the same two files and check that `encode(extensions.digest(body_md,'sha256'),'hex')` equals the hashes above.

Before publication (and on any database where the rows are still unpublished):
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

## Platform Terms v2 — staff review step (29 Sep 2026, DRAFT, owner approval pending)

`SHIPPER-PLATFORM-TERMS-v2.md` adds the one gap the staging walkthrough found: a shipper's load waits in
`submitted` until staff post it (`cc_decide_partner_load`: `post` / `decline` only; no staff RPC can change a
shipper load's rate — checked on staging, 29 Sep). v1 said blocking was "the only decision LoadBoot makes".

Changes from v1 (nothing else moved):
- §2.3 last paragraph: staff **review** each load before it is posted (§4.4); reviewing and blocking are the only decisions.
- New §4.4 "Staff review before a load is posted": fraud/safety/completeness only; posted exactly as submitted (no rate,
  rate-card or term change; no choosing, ranking or suggesting a carrier; a named direct-offer carrier gets it at the
  shipper's rate); staff may decline (shows as declined in the portal; the shipper may submit a corrected load); the
  review is not a check of the carrier, rate or lawfulness and promises no review time.
- Old §4.4 → §4.5, old §4.5 → §4.6. No cross-reference pointed at them.
- Effective date back to `[DATE OF PUBLICATION]` — fill it when publishing, then re-hash (the hash changes with the date).

**Rollout once approved:**
- Staging: `insert into app_private.master_agreements(kind, version, title, body_md, legal_approved, published, published_at)
  values ('shipper_platform', 2, 'LoadBoot Platform Terms for Shippers', $body$…v2 text…$body$, true, true, now());`
  The staging test shipper then shows Platform Terms as `pending` (it signed v1) — that is the re-sign path working.
- Prod: publish **v2 only** for `shipper_platform` (leave the prod v1 row unpublished; no real shipper ever saw v1), plus
  `SHIPPER-CARRIER-TERMS-v1.md` unchanged. `shipper_item_status` and `cc_shipper_agreement` read the highest
  published+approved version, so no code change is needed.

## Broker–Shipper terms

In the broker lane the broker's own contract governs. A LoadBoot standard template already exists as
`master_agreements (kind='broker_shipper', v1, unpublished)`, which was untouched by this work.

## Source notes

The research sources, with primary citations and the items marked UNVERIFIED, are at the end of each draft.
