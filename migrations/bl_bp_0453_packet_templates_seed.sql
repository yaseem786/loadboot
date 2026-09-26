-- bl_bp_0453 — onboarding_packet_templates seed, in a migration file at last
-- (audit claude/BROKER-AGENT-AUDIT-2026-09-26.md §3 + §7 item 7; the other half, app_private.org_onboarding_complete,
--  went into bl_bp_0451).
--
-- Before: the 32 packet template rows (10 broker / 13 carrier / 9 shipper) existed only on the live DBs. Every
-- migration since bl_bp_0312 UPDATEs them by key (0315 makes ucr optional, 0343 restores revalidate_days
-- "only for keys already present") but none INSERTs them, so a fresh DB - or staging - could not be rebuilt.
-- Found on 26 Sep 2026 while dumping them: staging was NOT at parity with prod.
--   prod    32 rows, columns (org_kind, item_key, label, status_tag, sort, revalidate_days, needs_expiry)
--   staging 30 rows, no needs_expiry column, no broker.boc3 and no broker.ucr rows.
--   So the staging broker packet had 6 mandatory items where prod has 7 (boc3 is 'legal'), and
--   0315's autofill loop (mc_authority, bmc84_bond, boc3) has been writing an org_onboarding_items row on
--   staging that no template describes. Nothing on either DB reads needs_expiry today (no function, no JS) -
--   it is carried so the two schemas match, not because it drives anything.
--
-- After: this file is THE seed. Idempotent upsert of all 32 rows keyed on (org_kind, item_key); every value is
-- the prod value on 26 Sep 2026. On prod it changes nothing (every column already equals the seed); on staging
-- it adds the column and the two broker rows. A row that is on the DB but not in this file makes the migration
-- fail, so the file cannot silently fall behind the live table. Hash check at the end pins the exact content.
-- No functions created or changed → anon SECURITY DEFINER surface unchanged (36 prod / 35 staging).


alter table app_private.onboarding_packet_templates
  add column if not exists revalidate_days integer,
  add column if not exists needs_expiry boolean not null default false;

insert into app_private.onboarding_packet_templates (org_kind, item_key, label, status_tag, sort, revalidate_days, needs_expiry)
values
  ('broker', 'bank_instructions', 'Bank / payment instructions (verified)', 'required', 60, 180, false),
  ('broker', 'bmc84_bond', '$75,000 BMC-84 surety bond or BMC-85 trust (active)', 'legal', 20, 30, true),
  ('broker', 'boc3', 'BOC-3 process agent designation (on file with FMCSA)', 'legal', 25, 365, false),
  ('broker', 'broker_agreement', 'Signed Broker Agreement', 'required', 50, null, false),
  ('broker', 'claims_procedure', 'Claims-handling procedure', 'required', 70, 365, false),
  ('broker', 'coi', 'Certificate of insurance (GL / E&O / contingent cargo)', 'conditional', 40, 30, true),
  ('broker', 'mc_authority', 'Active FMCSA broker authority / MC number', 'legal', 10, 30, false),
  ('broker', 'references', 'Trade / customer references', 'optional', 80, null, false),
  ('broker', 'ucr', 'Unified Carrier Registration (UCR) — current year', 'optional', 28, 365, true),
  ('broker', 'w9', 'Broker W-9', 'required', 30, null, false),
  ('carrier', 'ach_details', 'Voided check / ACH form (direct payment)', 'conditional', 90, 180, false),
  ('carrier', 'auto_liability', 'Auto liability insurance filing', 'legal', 20, 30, true),
  ('carrier', 'cargo_insurance', 'Cargo insurance (contract level)', 'conditional', 60, 30, true),
  ('carrier', 'carrier_agreement', 'Signed Carrier Agreement', 'required', 30, null, false),
  ('carrier', 'coi_from_agent', 'COI direct from insurance agent', 'required', 50, 30, true),
  ('carrier', 'emergency_contact', 'Emergency contact', 'required', 120, 365, false),
  ('carrier', 'equipment_info', 'Equipment information on file', 'required', 110, 365, false),
  ('carrier', 'hazmat_cert', 'Hazmat certificate / permit', 'conditional', 130, 365, true),
  ('carrier', 'noa_factoring', 'Notice of Assignment / factoring details', 'conditional', 80, 180, false),
  ('carrier', 'operating_authority', 'Active property operating authority (MC/USDOT)', 'legal', 10, 30, false),
  ('carrier', 'reefer_breakdown', 'Reefer breakdown coverage', 'conditional', 70, null, false),
  ('carrier', 'safer_check', 'SAFER safety verification (never dispatch Out-of-Service)', 'required', 100, 90, false),
  ('carrier', 'w9', 'Carrier W-9', 'required', 40, null, false),
  ('shipper', 'billing_instructions', 'Billing submission instructions', 'required', 40, 365, false),
  ('shipper', 'cargo_profile', 'Cargo profile (commodities, values, equipment)', 'optional', 50, 365, false),
  ('shipper', 'claims_contact', 'Claims contact and procedure', 'required', 60, 365, false),
  ('shipper', 'credit_application', 'Credit application — before your first booking', 'conditional', 10, null, false),
  ('shipper', 'facility_rules', 'Facility rules and appointment process', 'optional', 70, 365, false),
  ('shipper', 'insurance_requirements', 'Cargo insurance requirements stated', 'optional', 80, 365, false),
  ('shipper', 'payment_terms', 'Payment terms (Net 15/30/45) — before your first booking', 'conditional', 30, 365, false),
  ('shipper', 'signed_agreement', 'Signed Shipper Agreement', 'required', 20, null, false),
  ('shipper', 'special_commodity', 'Hazmat / food-grade / high-value declarations', 'conditional', 90, null, false)
on conflict (org_kind, item_key) do update
  set label = excluded.label,
      status_tag = excluded.status_tag,
      sort = excluded.sort,
      revalidate_days = excluded.revalidate_days,
      needs_expiry = excluded.needs_expiry;

-- Parity checks: exactly these 32 rows, byte for byte.
do $chk$
declare v_n int; v_h text; v_extra text;
begin
  select count(*),
         md5(string_agg(org_kind||'|'||item_key||'|'||label||'|'||status_tag||'|'||sort::text
                        ||'|'||coalesce(revalidate_days::text,'-')||'|'||needs_expiry::text,
                        E'\n' order by org_kind, item_key))
    into v_n, v_h
    from app_private.onboarding_packet_templates;
  if v_n <> 32 then
    select string_agg(org_kind||'.'||item_key, ', ') into v_extra
      from app_private.onboarding_packet_templates t
     where not exists (select 1 from (values
('broker','bank_instructions'),('broker','bmc84_bond'),('broker','boc3'),('broker','broker_agreement'),('broker','claims_procedure'),('broker','coi'),('broker','mc_authority'),('broker','references'),('broker','ucr'),('broker','w9'),('carrier','ach_details'),('carrier','auto_liability'),('carrier','cargo_insurance'),('carrier','carrier_agreement'),('carrier','coi_from_agent'),('carrier','emergency_contact'),('carrier','equipment_info'),('carrier','hazmat_cert'),('carrier','noa_factoring'),('carrier','operating_authority'),('carrier','reefer_breakdown'),('carrier','safer_check'),('carrier','w9'),('shipper','billing_instructions'),('shipper','cargo_profile'),('shipper','claims_contact'),('shipper','credit_application'),('shipper','facility_rules'),('shipper','insurance_requirements'),('shipper','payment_terms'),('shipper','signed_agreement'),('shipper','special_commodity')) s(k,i) where s.k = t.org_kind and s.i = t.item_key);
    raise exception 'bl_bp_0453: % template rows, expected 32; rows not in the seed file: %', v_n, coalesce(v_extra, '(none)');
  end if;
  if v_h <> '41241fb6107e3578482d836cd7224493' then
    raise exception 'bl_bp_0453: template content hash % <> 41241fb6107e3578482d836cd7224493 (prod 26 Sep 2026)', v_h;
  end if;
  raise notice 'bl_bp_0453: % packet template rows, hash %', v_n, v_h;
end
$chk$;

