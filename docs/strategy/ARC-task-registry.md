# LoadBoot Permanent Task Registry — ARC track
Statuses: Proposed | Validating | Approved | Blocked | In Progress | Tested | Complete
Rule: nothing is Complete without evidence (file, deploy, or logged outcome).

## P0 — Validation (owner: Yaseen + Claude) — DECISION GATE
| # | Task | Status | Notes |
|---|---|---|---|
| V1 | Recruit 15 interview candidates (FB×3 groups, r/Truckers, TruckersReport, dispatch leads) | Proposed | script below |
| V2 | Complete ≥10 interviews, log answers | Proposed | 8 questions in evaluation §5 |
| V3 | "Free ratecon audit" section on site + waitlist form | Proposed | $0, existing stack |
| V4 | Run 3–5 concierge claims end-to-end | Proposed | manual workflow §5 |
| V5 | Sample deliverables: 1 ratecon audit + 1 detention proof package (templates) | Proposed | Claude drafts on first real doc |
| V6 | Attorney consult: disclaimer + collection-agency question | Blocked (budget/registration) | free consults exist; required before public launch, not for pilot |
| V7 | Day-14 go/no-go + Day-30 validation memo vs gates | Proposed | gates in §5 |

## P2 — MVP build (entry: P0 pass) — all inside Carrier Portal
| # | Task | Status | Notes |
|---|---|---|---|
| M1 | Schema: arc_terms, arc_claims, arc_claim_events, arc_evidence + state machine | Approved (design §9) / build Blocked by P0 gate | |
| M2 | RPCs cc_arc_* (terms, claims, calc, package manifest, review queue) | Proposed | pattern: existing cc_* |
| M3 | Ratecon upload + terms checklist UI with PDF beside + keyword highlighter | Proposed | no paid OCR |
| M4 | Pre-load risk flags (missing detention rate / notification deadline / lumper terms) | Proposed | rule-based |
| M5 | Free-time countdown + T-30/T-0 push + notification draft (mailto/copy) | Proposed | push exists |
| M6 | Claim package PDF (print-styled page) | Proposed | $0 approach |
| M7 | Claim tracker UI (states + follow-up reminders) | Proposed | |
| M8 | CC review queue for terms/packages | Proposed | pattern exists (POD queue) |
| M9 | Offline stamp queue (localStorage sync) | Proposed | |
| M10 | Test suite: state machine, calc goldens, persona permissions | Proposed | harness exists |
| — | Arrive/Depart stamps with detention minutes | **Complete** | shipped (tripArrive/tripDepart, carrier portal) |
| — | Per-trip GPS consent + location share/live tracking | **Complete** | shipped this session |
| — | POD/evidence upload with review states | **Complete** | existing pipeline |
| — | PWA install-as-app + push | **Complete** | shipped this session |

## Blocked items (external)
| Item | Blocked by |
|---|---|
| Public ARC launch | legal review (V6) + LLC registration |
| % -of-recovery pricing | legal review — likely never |
| Facility/broker public intelligence | aggregation thresholds (n≥5 carriers, ≥10 events) + legal |
| Native iOS/Android | $124 store fees + revenue |
| SMS alerts | budget (push/email until then) |
| GA4/Search Console live | owner's Google keys (carried from previous session) |
| Legal agreements text | owner's attorney (carried; DRAFT pack delivered 2026-07-03) |

## Scripts (P0)
**Recruit post:** "Owner-ops: how much detention did you eat this year and never get paid for? I'm building a free tool that preps broker claim packages (timestamps + evidence + invoice) and I'll audit your next ratecon by hand for free — DM me. Not selling anything, need 10 testers."
**Interview invite:** "15 minutes on the phone about how you handle detention pay — I'll send you back a free written audit of one of your ratecons as a thank-you."
**Beta invite:** "You're in. Send your next ratecon before you accept the load; we'll flag what's missing and set up your detention clock. Free during beta, no card, your docs stay private."
**Referral offer:** "Know another owner-op eating detention? Both of you get priority human review of your next claim package."
