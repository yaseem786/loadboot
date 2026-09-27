# Task list — Riley calls + builds (written 27 Sep 2026; work through one by one)

Source: prod read-only triage of the 28 carriers with a usable US phone (73 real carriers; 45 have no valid number).
Flow per call: Carrier 360 → "Plan a Riley call" → read the plan in Riley → Call plans → **Book with Riley**.
Rules: Mon–Fri 9:00–18:30 carrier time, 1 call / carrier / day.

## Builds
- [ ] **One main line 815**: Riley outbound caller ID = +1 (815) 365-1168. Code: `retell_config.outbound_from_number`, retell_dial / retell_dial_verify use it, `retell_webhook` accepts 815 + 469, CC Settings field + test call. Owner: Telnyx SIP connection (outbound only), Retell → Import number. Docs were blocked here — verify the Retell import steps first.
- [ ] **Human + Riley on the same line**: "Office first" inbound ring (staff browser + mobile ~20 s, then Riley) for callers without a dispatcher; Riley transfer to a staff mobile (escalation_number + prompt change + publish). Owner to name who rings.
- [x] **Carrier 360 live / last seen** — bl_ux_0486 (this commit).

## Batch 1 — book this week
1. CLOCKWORK CARGO (Angelique Griffin, OH) — document_missing: COI certificate holder (rejected 25 Sep); 3 docs valid
2. D'Z TRUCKING (David Gilbert Sr, FL) — document_missing: COI holder + uploaded USDOT instead of MC
3. MUNSTER LOGISTICS (Justin Male, OH) — choice_pending: Jugraj Singh (26 Sep)
4. WARREN'S COURIER (Jason Warren, GA) — choice_pending: Muhammad Raza (27 Sep); 5 unanswered calls in Aug
5. JMS EXPRESS (Tim Jones, OH, 3 trucks) — document_missing: one COI correction
6. SUMMIT 15 TRANSPORT (David Johnson, CO) — onboarding_gap: only W-9
7. WILDEWOOD LOGISTICS (Corey Rucker, OK, 2 trucks) — onboarding_gap
8. L M CASSELLA TRUCKING (TN) — welcome

## Batch 2 — next week
9. E&T TRUCKING (AL) — W-9 2 fixes + COI box · 10. MEDO ENTERPRISE · 11. NATIONWIDE ROADRUNNER (TX) · 12. MKMI (NC) ·
13. UNITED ROOTS (MS) · 14. DR&KIDS (NJ) · 15. MTE LOGISTICS (IL) · 16. IRONCUBE · 17. A&B GLOBAL (FL, maybe Spanish)

## Team, not Riley
18. BLESSED ROAD RUNNER — 5 docs valid, application still pending → approve
19. EZHAUL · 20. PATTERSON FREIGHT — verified, no dispatcher → assign
21. OPTIMIZATION LINX — bank verification re-uploaded the same file → a person calls

## Email instead of calling
22. TOP KNOTCH (7 unanswered) · 23. ALL CITIES (5) · 24. ALL-WAYS TOWING (5) · 25. PRIME FREIGHT (5, COI + W-9 fixes)

## No call
26. GABE LOGISTICS (healthy) · 27. PICK N NETT (dispatcher to check in; 34 d no login) · 28. CAROL LEE — booked Mon 28 Sep 9:00 AM ET, read the outcome
