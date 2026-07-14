-- bl_pay_0092 — FACTORING / NOA engine (industry model: UCC §9-406).
-- How it works in the real world, and now on LoadBoot:
--   · A carrier that factors sells its invoices; the factor sends brokers a Notice of Assignment (NOA).
--   · After an NOA the broker MUST pay the factor — paying the carrier can mean paying TWICE.
--   · The broker does NOT have to agree: UCC 9-406 makes the assignment binding on notice.
--   · There is NO per-trip bank/factor choice: the NOA covers ALL invoices until the factor
--     issues a signed RELEASE letter. Hence ORG-LEVEL setting only, by design.
-- LoadBoot flow:
--   carrier (Finance → 🏦 Factoring) declares factor + remit-to (+ NOA letter under Documents→Factoring NOA)
--     → noa_status 'pending' → staff notified → brokers with OPEN trips notified in-app + email
--   CC verifies (cc_factoring_verify) → 'verified' → carrier notified in-app+email
--   pay_instructions (freight + claims) returns the FACTOR's remit-to (carrier bank hidden) + strong
--     NOA warning; 'pending' adds a confirm-with-factor caution
--   leaving the factor: carrier files the release letter → 'released' → payments flip back to own bank
-- Applied to staging 2026-07-14 (end-to-end verified). Replay on PROD.
-- NOTE: pay_instructions record-null pitfall — use prof.org_id is not null (NOT `prof is not null`).

alter table app_private.org_payment_profiles
  add column if not exists factor_details jsonb not null default '{}'::jsonb,
  add column if not exists noa_status text not null default 'none' check (noa_status in ('none','pending','verified','rejected','released')),
  add column if not exists noa_doc text,
  add column if not exists release_doc text;

-- carrier_factoring_set(p jsonb), cc_factoring_verify(uuid,boolean,text), pay_instructions v3,
-- cc_my_payment_profile v2 (noa_status + factor_remit summary):
-- canonical SQL applied on staging via execute_sql in session 2026-07-14 — for PROD replay,
-- copy the four function definitions from staging:
--   select pg_get_functiondef(oid) from pg_proc where proname in
--     ('carrier_factoring_set','cc_factoring_verify','pay_instructions','cc_my_payment_profile');
