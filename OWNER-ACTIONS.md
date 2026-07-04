# Remaining tasks — owner/legal/credential actions only

Every code-shippable task is done and verified. These 5 cannot be completed in code —
they need YOU (credentials, legal counsel, owner-executed actions, or design direction).
Each is turn-key below.

## #33 — Connect GA4 + Search Console (CODE-COMPLETE, needs secrets)
The edge functions `ga4-insights` and `gsc-insights` are already deployed and read these
Supabase secrets. Set them, then flip the flag — the Command Center "Google data" views
light up with real data. Nothing else to build.
1. Create a Google Cloud service account; grant it:
   - GA4: "Viewer" on your GA4 property (Admin → Property Access Management).
   - Search Console: add the service account email as a user on your GSC property.
2. In Supabase → Project settings → Edge Functions → Secrets, set (BOTH projects if you
   use staging):
   - GA4_PROPERTY_ID   = your GA4 numeric property id (e.g. 123456789)
   - GSC_SITE_URL      = your verified Search Console property (e.g. https://loadboot.com/ or sc-domain:loadboot.com)
   - GOOGLE_SA_KEY     = the full service-account JSON (one line)
3. Enable the feature flag `google_data_enabled` (Command Center → feature flags, or set_feature_flag).

## #20 — Legal text (agreements + carrier bond) — NEEDS COUNSEL
Binding carrier/broker/shipper agreements and bond language must be drafted/approved by a
licensed attorney. I will not fabricate legal text. The platform already RECORDS agreement
acceptance and versions (cc_accept_agreement / cc_publish_agreement / cc_current_agreement);
once counsel gives you the text, publish it via cc_publish_agreement and it flows to users.
ACTION: get the agreement + bond text from counsel, then paste it in and I'll wire the publish.

## #21 — Owner actions: activation bundle — OWNER-EXECUTED
These are account/production activations only you can perform (e.g. domain, DNS/email
verification, payment-rail activation, production Supabase settings). ACTION: tell me which
specific activations you want documented and I'll write exact steps.

## #22 — Foundation gate: 2 owner-executed browser proofs — OWNER-EXECUTED
Two end-to-end proofs to run yourself in a browser after deploy:
1. Carrier: sign in → the portal loads (NOT stuck on "Loading…") → open a trip → upload a POD.
2. Command Center: sign in as staff → open a booking request → see the SOP §12 pre-booking
   checks → approve.
ACTION: run these after deploying this batch; report back and I'll fix anything that fails.

## #23 — Design work via Claude Design Builder — NEEDS DIRECTION/TOOL
Needs your design direction and the Design Builder tool. ACTION: tell me the specific
screens/brand direction and I'll produce them.

---
## UPDATED 2026-07-03 — current owner checklist (in order)
1. **Commit + deploy** the full batch (COMMIT_MSG.txt ready; uncheck app/_selftest_broken.js + COMMIT_MSG.txt).
2. Post-deploy: run the 2 browser proofs (carrier trip/POD; CC booking approve).
3. Reinstall the mobile/desktop PWA — it now opens the /app/ launcher, not the website.
4. LLC registration (state of your choice) — required before taking payments and for store accounts.
5. Google Play developer account ($25 one-time) → send me access/keystore fingerprint and I prepare the TWA package (listing text ready in docs/play-store-listing.md).
6. GA4/GSC: set the 3 Supabase secrets + enable google_data_enabled (unchanged from #33).
7. Attorney: review DRAFT legal pack (delivered 2026-07-03) + ARC disclaimer question (docs/strategy/ARC-evaluation.md §3).
