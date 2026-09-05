# GABE LOGISTICS LLC — compliance review, 5 Sep 2026

MC 1006869 · USDOT 3218776 · Dover, DE · contact Philip Mathenge · joined 3–4 Sep 2026
Reviewer notes are written to paste into CC → ⚙ Actions → Approve / Reject. Carrier-facing emails are DRAFTS — Yaseen sends them.

---

## 1. CC review notes (paste into the note field)

### MC/DOT Operating Authority — APPROVE
```
FMCSA Certificate MC-1006869-C verified. Common carrier of property (except HHG), service date 03/21/2019 (authority ~7.4 yrs). SAFER 09/03/2026: USDOT ACTIVE, AUTHORIZED, OOS none, 1 PU / 1 driver, 0 inspections & 0 crashes (24 mo). Name, address (702 Marta Dr, Dover DE 19901) and phone (302) 674-8474 match FMCSA. Approved.
```

### Certificate of Insurance (Auto Liability $1M) — REJECT · revision required (certificate holder)
```
COVERAGE OK — revision required, not a coverage problem. ACORD 25 dated 11/26/2025. Insured GABE LOGISTICS LLC. Insurer GEICO Marine Insurance Co (NAIC 37923), producer Cavallino Risk Management, Huntington NY. Policy 9300246061-00, 12/01/2025–12/01/2026. Auto Liability CSL $1,000,000 (meets req), GL $1M/$2M agg, Motor Truck Cargo $100,000 / $1,000 ded (meets cargo req). Units: 2016 Mack CXU VIN 1M1AW21Y3GM077936 + 2016 Vanguard dry van trailer. REJECTED because Certificate Holder is the carrier itself; LoadBoot standard requires LoadBoot LLC as Certificate Holder (cancellation notices). Carrier asked to have Cavallino reissue the same policy with LoadBoot LLC as holder and re-upload. On re-upload: approve and set expiry_date = 2026-12-01. FMCSA L&I BIPD filing not independently verified (UNKNOWN).
```

### Bank Verification (Voided Check) — APPROVE
```
Voided business check #1077, Dover Federal Credit Union, printed name GABE LOGISTICS LLC, 702 Marta Dr. MICR routing 231176648 = exact match to profile (confirmed Dover FCU, DE). Account number (14 digits, ends 4790) = exact match to profile. ACH authorization form: name/address/phone/MC/email match profile; signed Philip Mathenge – Owner (form dated 03/18/2024, generic). Business account, not personal. Approved. NOTE: LoadBoot ACH debit consent still false — collect separately if fees are ACH-debited.
```

### W-9 Tax Form — REJECT (carrier must redo)
```
Name, address, signer (Philip Mathenge) and TIN format OK. Rejected for tax classification: LLC class marked "P = Partnership" but all evidence indicates a single-member LLC (owner-operator, 1 unit, Philip listed as Owner on ACH form). A single-member LLC is a disregarded entity — W-9 must select "Individual/sole proprietor or single-member LLC" (or C/S only if a corporate election was filed). Partnership requires 2+ members. Mismatch would create a TIN/name error at 1099 time. Asked carrier to redo the W-9 and confirm member count and whether TIN is EIN or SSN.
```

### Dispatch Service Agreement — already VALID (no action)
```
Executed 09/04/2026, signed Philip Mathenge, auto-countersigned. No action.
```

### Decision
Onboarding stage: keep at `compliance_check` until BOTH arrive: (a) corrected W-9, (b) reissued COI with LoadBoot LLC as certificate holder → then approve both, set COI expiry 2026-12-01, move carrier to active.
Follow-ups to track: (1) corrected W-9, (2) reissued COI, (3) ACH debit consent if applicable, (4) system: no `carrier_verifications` FMCSA row and `ai_verdict` NULL on all 3 docs — automation did not run for this carrier (audit item, not carrier's fault).
Certificate holder address used: LoadBoot LLC, 30 N Gould St Ste N, Sheridan, WY 82801

---

## 2. Plain-text email (draft — Yaseen sends)

**To:** gabelogistic@yahoo.com
**Subject:** Gabe Logistics – almost cleared: W-9 fix + COI certificate holder

```
Hi Philip,

Thanks for getting your documents in so quickly — we've finished reviewing Gabe Logistics LLC (MC 1006869) and you're almost fully cleared.

APPROVED
- Operating authority — FMCSA certificate MC-1006869-C verified, active since 2019
- Bank verification — Dover Federal Credit Union business account, matches your payment profile
- Dispatch service agreement — executed 09/04/2026

TWO QUICK FIXES

1) W-9 — tax classification
Your W-9 lists the LLC tax classification as "P" (Partnership). Since Gabe Logistics LLC appears to be a single-member LLC, the IRS treats it as a disregarded entity, and the W-9 should instead have "Individual / sole proprietor or single-member LLC" selected (or C / S only if you've filed a corporate tax election). This makes sure your 1099 is issued correctly at year-end.
Please redo it in your LoadBoot account: Account → Business → W-9 (about 2 minutes), and confirm whether the TIN you entered is your EIN or your SSN. If the LLC actually has two or more members, just reply and tell us — then Partnership is correct and we'll clear it as is.

2) Certificate of insurance — certificate holder
Your coverage is fine (GEICO Marine, $1M auto liability + $100K cargo, valid through 12/01/2026) — nothing to change on the policy. The certificate just needs to be reissued with LoadBoot listed as Certificate Holder so we receive cancellation notices, the same way every broker requires. Please ask Cavallino Risk Management (631-385-5981) to issue a certificate to:

    LoadBoot LLC
    30 N Gould St Ste N, Sheridan, WY 82801

and upload the new COI under Documents → Insurance. Agents usually turn this around the same day.

Once both are in, your account goes active and we start working loads for your 2016 Mack / dry van out of Dover.

Best regards,
Yaseen
LoadBoot — Carrier Onboarding
loadboot.com · https://loadboot.com/contact.html
```

---

## 3. Premium HTML email
File: `GABE-LOGISTICS-email-2026-09-05.html` (same content, LoadBoot house template — dark header, orange rule, blue CTA).
Sent via system (sys_email → support identity, reply-to hello@loadboot.com) on 5 Sep 2026.
