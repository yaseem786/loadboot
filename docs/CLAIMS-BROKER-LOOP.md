# Claims ↔ Broker Loop (bl_claims_0041–0043, applied staging + prod 2026-07-07)

## Flow (A→Z)
1. **Filing** — carrier files from the trip card (detention/layover/TONU/lumper/other), or the system
   auto-drafts detention (GPS depart past free time) and TONU (load cancelled after commitment).
   Evidence snapshot attaches automatically. **The broker of that load is notified instantly**
   (in-app, `/app/partner/#claims`).
2. **Evidence bundle** — assembled at READ time by `app_private.claim_bundle`, so it is always current:
   - `claim` (ref CLM-XXXXXXXX, kind, amount, statuses, notes)
   - `trip` (route, rate, schedule vs actual, carrier + broker names, load status)
   - `gps_dwell` — every dwell event: arrive/depart timestamps, held vs free minutes,
     computed detention minutes, GPS lat/lng + distance from pin
   - `policy` — the LoadBoot rate card (cc_rate_standards) agreed at booking
   - `cancellation_trail` — audit entries for the load/trip matching cancel (TONU proof)
   - `filed_evidence` — the snapshot taken at filing
3. **Broker review** — partner portal "💰 Claims on your loads": pending-first, evidence expander,
   `✓ Approve` (staff then finalizes the amount → invoice) or `✕ Dispute` (note required, carrier notified).
4. **Escalation** — after a dispute, either side presses "🎧 Ask support to decide"
   (`cc_claim_escalate`, works for carrier and broker; staff get an ops notification and the
   Exception Center row shows **ESCALATED — needs support verdict**).
5. **Verdict** — staff in Exception Center: `⚖ Support verdict` → carrier|broker (+amount if carrier),
   note required, cites GPS. Verdict finalizes the accessorial (approve w/ amount or reject),
   notifies BOTH sides with: "This decision is final — refusing to honour it can lead to account
   strikes or service pause."
6. **Enforcement** — refusal to honour = staff uses the existing tools on Carrier 360 (⚠ Warn −5/−15/−40,
   ⏸ Pause booking/all) or partner-side controls; all audit-logged.

## Surfaces
- Carrier: My Loads → trip card → Pay claims panel — broker pill (approved/disputed w/ note),
  support pill (with support / ruled for-against you + verdict note), escalate button.
- Broker: partner portal claimsCard — status pills, evidence, approve/dispute/escalate.
- CC: Exception Center Pay-claims queue — broker + support pills, approve/reject + ⚖ verdict;
  escalated rows stay in queue even after broker action.

## RPCs
cc_claim_bundle(id) [staff|carrier-of-trip|broker-of-load] · cc_partner_claims() ·
cc_partner_review_claim(id, approve|dispute, note) · cc_claim_escalate(id) ·
cc_support_decide_claim(id, verdict, amount, note) · queue/trip accessorial getters extended in place.
