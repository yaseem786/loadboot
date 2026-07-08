# Carrier Post Design — what a broker must see in 5 seconds
(Research basis: how the industry's vetting tools present carriers — Highway (identity/fraud),
Carrier411 (authority+insurance+safety monitoring), RMIS (compliance certify/block),
DAT Directory/CarrierWatch (reviews, equipment, lanes, fleet). July 2026.)

## The broker's real 5-second decision sequence
Every major vetting tool leads with the same go/no-go checks, in this order:
1. WHO — identity confirmed? (name + verified badge; Highway's whole business is this)
2. CAN THEY LEGALLY HAUL — authority ACTIVE, not out-of-service (Carrier411/RMIS lead metric)
3. ARE THEY INSURED — COI on file, current (RMIS auto-blocks without it)
4. WILL THEY PERFORM — peer reviews (DAT company reviews), on-time %, delivered count,
   and the #1 fraud/no-show signal: how often THEY cancelled
5. DO THEY FIT MY LOAD — equipment + counts, HAZMAT/team, and lanes/home base

## CARD (quick glance) — exactly these, nothing else
- Identity row: logo/initials · name · ✓ VERIFIED · (⛔ OOS / ⏸ not accepting if true)
- Status strip (single line, colored dots): DOT · MC · ● Authority ACTIVE · 🛡 Insured ✓
- Reputation: ★ 4.5 · 12 trip-verified reviews (click → reviews) | "✨ New on LoadBoot"
- KPI band (4): On-time % · Delivered · Cancels (green 0 / red >0) · Health
- Capacity: 🚛 equipment × count (top 3) + ☢ HAZMAT / 👥 Team inline icons
- Coverage: 📍 home base · Runs: TX, CA (one line)
- Footer: View full profile · Post a load →

## FULL PROFILE (modal) — the deep audit
Everything on the card PLUS: full compliance document list (COI limits, W-9, agreement,
MCS-150...), safety rating, driver count, full fleet + trailer mix, max weight, weekends,
member since, fleet units, ⭐ full reviews w/ distribution, 🛡 live FMCSA 7-tab profile
(General/Fleet/Insurance/Safety/Inspections/Violations/Crashes).

## Rationale for the two changes vs v3
- Fleet tile OUT of the KPI band, Cancels IN: fleet size is a fit question (capacity line
  covers it); carrier-initiated cancels are the strongest no-show/risk predictor brokers
  look for (Highway cross-broker fraud signals, Carrier411 FreightGuard reports).
- FMCSA chip cluster collapsed to one status strip: brokers don't read four chips — they
  look for two colors (authority green? insured green?). Details belong in the profile.

## Roadmap (not built yet)
- Insurance expiry date + auto-expire chip (RMIS-style continuous monitoring)
- CSA BASIC percentile bars on the profile
- Cross-broker incident flags (double-brokering / no-show reports) with CC arbitration
- "Runs your lane" auto-match when opened from a posted load
