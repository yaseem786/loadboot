# Retention proposal for account erasure — 20 Sep 2026 (Claude) — PROPOSAL ONLY, nothing is deleted by this document

Status: **APPROVED by Yaseen 22 Sep 2026 ("apni suggestion implement karo") and IMPLEMENTED as bl_audit_0365 + 0366 on staging AND prod.** Original text kept below for the record. Claude is not a lawyer; the periods below are the commonly cited US figures and must be
confirmed by Yaseen (ideally with a US accountant/attorney) before any removal code is written. Until then an erasure request that
has files stays at `ERASURE_REVIEW_REQUIRED` and a human decides case by case — that is the safe default and it is live today.

| Class | Examples in LoadBoot | Proposed handling on an erasure request | Why (to be confirmed) |
|---|---|---|---|
| A. Money records | settlements, invoices, fee invoices, payout records, rate confirmations, BOL/POD tied to a paid load | KEEP, locked, staff-only; delete after **7 years** | IRS: keep records 3 years, 6 if income under-reported, 7 for bad-debt/worthless-securities claims — 7 covers all; disputes/claims on loads |
| B. Tax identity | W-9, TIN match evidence | KEEP **4 years after the last year a 1099 was filed for them**, then delete. If NO payment was ever made to them: delete with the account | IRS backup-withholding/1099 support; no payment = no filing duty = no reason to keep |
| C. Carrier qualification | COI, authority letter, signed dispatch agreement | If they hauled a load for us: KEEP **3 years after the last load**. If they never hauled: delete with the account | Broker-style transaction records (49 CFR 371.3 is 3 years — applies to brokers; LoadBoot is a dispatcher today, so this is prudence, not a stated legal duty) |
| D. Never-used onboarding uploads | chat/portal uploads from someone who never completed onboarding or never hauled | DELETE with the account (after the 7-day safety window) | No business or legal reason to hold a stranger's insurance/tax papers |
| E. Chat transcripts, leads, marketing | lc_conversations, CRM lead, outreach rows | Delete/anonymise with the account; keep only the suppression entry (email hash) so they are never mailed again | Already implemented for outreach suppression |
| F. Security/audit logs | recon log, deletion request row, erasure inventory | KEEP **2 years**, no file contents | Proof that we did what was asked |

Decisions needed from Yaseen: (1) accept/adjust the periods; (2) "hauled a load" = at least one trip in status delivered/paid?;
(3) who may approve a Class A–C hold (proposal: any staff with `finance.approve`); (4) do we tell the user in the confirmation email
which classes were kept and for how long (proposal: yes — Yaseen sends/approves that email text himself).

Implementation sketch once approved (separate package, staging first): a `retention_class` + `retain_until` on each inventory item,
set by staff in the review screen; removal runs only for items whose class says delete-now, through the Storage API, logged per file
(same pattern as lc-doc-purge: dry-run default, DB decides, cap per call); a request completes only when every item is either
removed (with evidence) or held with a class + date.

## Implementation record (22 Sep 2026)
- `app_private.retention_classes` holds the six classes (A_money 7y, B_tax 4y after last 1099 year, C_qualification 3y after last load, D_unused, E_marketing, F_audit_log 2y); `cc_retention_classes()` lists them to staff.
- `cc_erasure_items(request_id)` shows every inventory item with its decision AND an advisory suggestion computed from live facts: ever paid (fin_settlements paid / settlements paid_at on orgs the user owns), last delivered load (trips delivered/invoiced). Never paid + never hauled ⇒ D_unused/remove; paid ⇒ W-9 held as B_tax; hauled ⇒ COI/authority/agreement held as C_qualification; money docs ⇒ A_money.
- `cc_erasure_decide` validates the class; `erasure-purge` (edge, both envs) deletes decided objects with evidence; the processor completes only when nothing is undecided or pending.
- Decisions Yaseen has NOT made yet (defaults in force): "hauled" = trip status delivered/invoiced; hold approvers = staff with carriers.approve or finance.approve; the confirmation email to the user is not automated (Yaseen sends it).
