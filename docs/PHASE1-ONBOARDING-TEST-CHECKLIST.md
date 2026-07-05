# Phase 1 Onboarding — Dev Test Checklist
Verifies the 3 wirings added to `app/carrier/app.js` (`loadOnboarding()`). All are additive and syntax-checked (`node --check`), but need a runtime pass in dev.

Run the carrier portal, sign in as a test carrier whose account is **not yet verified**, open **Onboarding** (`#onboarding`).

## Step 1 — Company & authority (FMCSA verify)
- [ ] Enter an MC **or** DOT number, click **Verify with FMCSA**.
- [ ] Button shows "Verifying with FMCSA…", then a card appears with **Legal name / Authority / Safety rating**.
- [ ] If the company field was empty, it auto-fills with the FMCSA legal name.
- [ ] With no MC/DOT entered, clicking Verify shows "Enter your MC or DOT number first."
- [ ] On FMCSA failure, an inline error appears and you can still continue (upload fallback preserved).
- [ ] Network tab: one call to `cc_fmcsa_verify` (`fmcsaVerify`).

## Step 3 — Factoring & payment (bank details)
- [ ] New fields visible: **Bank name, Account holder/title, Account number, Routing (ABA)**.
- [ ] With factoring = "I use factoring", you can continue with bank fields blank.
- [ ] With factoring ≠ yes and bank blank → "Save & continue" blocks with "Add your bank account for payouts (or select factoring above)."
- [ ] Partial bank fields → "Please complete all bank fields."
- [ ] Routing not 9 digits → "Routing number must be 9 digits."
- [ ] All 4 filled → advances; Network tab shows a call to `cc_set_my_payment_profile` (`setMyPaymentProfile`) with `payment_method: 'ach'`.

## Step 5 — Documents (in-app W-9 + agreement)
- [ ] Two buttons at top: **Complete W-9 in-app**, **Sign dispatch agreement**.
- [ ] "Complete W-9 in-app" opens the existing W-9 wizard (`openW9Wizard`); submitting records via `cc_carrier_submit_w9`.
- [ ] "Sign dispatch agreement" opens the sign modal (`openSignModal`); signing records via `cc_carrier_sign_agreement`.
- [ ] After either completes, the document list below refreshes with the new item + status pill.
- [ ] The manual upload form (type + file + Upload) still works as before.

## Step 6 — Review & submit
- [ ] Review shows a **Payout** row: bank name + last-4, or "Via factoring", or "—".
- [ ] Submit → "Submitted for review" done card; account goes to under-review (surfaces in CC `verificationCenter`).

## Regression (make sure nothing else broke)
- [ ] Dispatch preferences step (step 4) still requires min rate / equipment / lanes.
- [ ] Existing Documents view (`#documents`) W-9/agreement/authority buttons still work.
- [ ] `git diff app/carrier/app.js` shows only changes inside `loadOnboarding()` (+34 / −7).

---
If anything fails, revert is a single file: `git checkout app/carrier/app.js`. The prototype (`previews/onboarding-system.html`) remains the reference for intended behavior.
