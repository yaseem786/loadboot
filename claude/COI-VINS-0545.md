# O.6 — approved COI with no VINs never switches the VIN gate off (bl_comp_0545, 12 Oct 2026)

**Bug:** an approved `insurance_coi` with no `coi_coverage` row (or mode `unknown`) made `vin_coverage_state` say
`no_coi`, and `assert_vin_dispatchable` only blocks `not_covered` — so every truck could be added AND posted.

## What changed (migrations/bl_comp_0545_coi_vins_pending.sql)
| Part | Change |
|---|---|
| (b) state | `app_private.coi_vins_pending(org)` = valid COI (same test as `fleet_truck_coi_gate`) AND (no coverage row OR `unknown` OR `scheduled` with 0 VINs). `vin_coverage_state` returns `coi_vins_pending` first. A scheduled row with 0 VINs is never `not_covered` (would block entry). |
| (b) entry | `cc_pocket_upsert_truck` / `cc_upsert_truck` now call `assert_vin_registrable` (bad VIN or `not_covered` only) → trucks save while pending. |
| (b) posting | `assert_vin_dispatchable` raises **LB006** on pending (`cc_post_truck`, `cc_update_truck_posting*`). New BEFORE trigger `trg_truck_posting_vin_gate` refuses any posting going ACTIVE (insert, resume, extend, confirm, set-available, truck swap). Already-active postings are untouched (that is O.6 e). |
| (a) approval | AFTER trigger `trg_coi_approved_needs_vins` on `carrier_compliance`: insurance_coi → valid with no coverage row ⇒ row `scheduled` + 0 VINs, `source='system'`, note "VINs needed from carrier/agent" + staff in-app flag. BEFORE trigger `trg_coi_coverage_no_unknown`: a non-staff `unknown` (AI could not read the schedule) is stored as `scheduled` + 0 VINs. Staff choosing "Cannot tell" keeps `unknown` (still pending). `coi_coverage.source` now allows `system`. |
| (c) carrier | Truck form: "✓ Your insurance is approved — send your insurance ID card or vehicle schedule…" + button "Upload your insurance ID cards or vehicle schedule"; save goes through. Posting sheet warns; LB006 toasts. COI banner says "send us your vehicle list", not "post now". |
| (d) CC | Coverage card: "VINs needed" flag; **Save disabled** for Scheduled autos with 0 VINs; **Request VIN schedule from carrier** → `public.cc_coi_request_vins(org)` (catalog key `document.coi_vins.request`, `email_kit` body, `email_gate` per address — blocked reasons shown verbatim). Card also opens on an "Other" upload while pending (VINs pasted from an ID card keep the COI as the coverage document). Carrier 360 fleet card: amber "VINs needed" line + per-truck verdict. Also fixed: mode chips called an undefined `drawSched()` (fleet preview never refreshed on mode change). |

## Proof (staging, test org 77c6e374, all rolled back)
state=coi_vins_pending · registrable ok · dispatchable LB006 · truck insert ok · post LB006 · resume LB006 ·
approval writes scheduled/system + flag · after VIN: covered / other VIN not_covered · post ok · AI unknown→scheduled ·
staff unknown stays unknown (pending) · lapsed COI + empty row → no_coi. `cc_coi_request_vins`: sent 1 (resend.dev test
inbox, rolled back), refuses any_auto org (22023), refuses a carrier user (42501). Anon SECDEF staging 35, names unchanged.
Email preview: `claude/previews/coi-vins-request-0545.html` (real shell, desktop + phone).

## Prod
`migrations/PROD-bl_comp_0545.sql` — **APPLIED on prod 13 Oct 2026** (owner: "laga do") as
`bl_comp_0545_coi_vins_pending_p1..p5`. After: anon SECDEF 36, name list md5 unchanged (afb63235…); 3 triggers live;
all 5 anchor patches present; catalog row `document.coi_vins.request` present; pending = only "Carrier Account".
Read-only impact list (re-checked 13 Oct, same as 12 Oct):
only **"Carrier Account"** (0 trucks, 0 active posts) becomes pending. T Strick is no longer affected — staff recorded
scheduled + 1 VIN on 12 Oct 16:19. Applied in 5 parts (MCP hangs on `drop trigger` / literal `delete from`).

**O.6 e (13 Oct, prod read-only):** active postings held by VIN-pending carriers = **0** (the only pending carrier,
Carrier Account, has 0 trucks). Nothing to backfill today; the gate now stops any new one going active.

## Staging drift fixed — bl_ops_0546 (12 Oct 2026)
Staging `coi_ingest_from_document` was missing prod's bl_fix_0311 (never committed): if a reviewer already pulled VINs +
note off THIS certificate and pressed Save coverage, approval must keep it instead of the AI overwriting it.
`migrations/bl_ops_0546_staging_coi_ingest_parity.sql` = prod's body verbatim; staging md5 now = prod
(4be84e4f0964dba501719981adf4cd07). Prod untouched. Rolled-back test on staging: same doc → `preserved`, 1 VIN kept;
a different new certificate with no VINs → AI `unknown`, stored as scheduled + 0 VINs (= VINs pending, bl_comp_0545).
The reviewer flow (paste → "Pull VINs out of that" → note → Save coverage) is unchanged; "Request VIN schedule" is the
extra button for when the certificate lists no VINs.
