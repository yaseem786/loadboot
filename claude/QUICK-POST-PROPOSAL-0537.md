# Quick-post proposal — "Post truck has too many sections" (item D, 8 Oct 2026)

Reported by SPRINT SHIFT LOGISTICS (1 Sprinter van). Proposal only — nothing built. Owner decides.

## 1. Audit of today's form (`app/carrier/app.js` → `openPostingForm`, ~line 4010)

| # | Field / step | Stored in `truck_postings` | Matcher needs it? (`tp_run_matcher` / `tp_match_new_load` / `dispatcher_board`) | Verdict |
|---|---|---|---|---|
| 1 | Kind: EMPTY now / BOOKED → backhaul | `kind` (origin = delivery city for backhaul) | yes — decides which city is the origin | keep, but infer: no active trip → EMPTY, active trip → ask |
| 2 | Truck (select) | `truck_id` | yes — equipment, payload, radius come from the unit | **prefill**: 1 truck → hidden |
| 3 | Where it is / frees up: state → city | `origin_city`, `origin_state`, `origin` | **yes** — the whole match starts here | ask (the one real question) |
| 4 | ZIP (optional) | `origin_zip` | nice-to-have (exact deadhead) | More details |
| 5 | Available from (date) | `available_from` | **yes** | ask — default today |
| 6 | Available until (date) | `available_to` | yes — post expires 24 h after start anyway | ask — default +1 day, as chips (Today / Tomorrow / pick) |
| 7 | Where I want to end up | `dest_pref` | soft (ranking only) | More details, prefill from last post |
| 8 | Radius — miles I will drive to pick up | `radius_miles` | yes, but has a default (truck `max_radius_miles` → prefs `operating_radius_miles` → 150) | **prefill** from saved truck / prefs / last post |
| 9 | Equipment (text) | `equipment` | yes, but the truck already knows it | **prefill** from the truck; never retype |
| 10 | Min $/mi (optional) | `min_rpm` | yes, but prefs `min_rpm` is the floor already | **prefill** from prefs / last post |
| 11 | Drive hours left today (0–11) | `hos_drive_left_h` | yes for same-day loads only | More details; default blank = "full day" |
| 12 | Notes | `notes` | no (dispatcher reads it) | More details |
| 13 | "Fields marked * are required" legend + validation | — | — | goes away: only 3/5/6 remain visible |

Conclusion: of 12 inputs the carrier must think about today, **3 are real questions** (where, from when, until when).
Everything else is either already on file (truck, equipment, radius, floor) or ranking-only.

## 2. Quick-post screen (proposed)

Prefilled from: the saved truck (equipment, payload, unit radius) → dispatch prefs (floor, radius, home base) →
the carrier's **last posting** (dest_pref, radius, min_rpm, notes). Every prefilled value is shown as a chip the carrier
can tap to change, never as an empty box.

```
┌──────────────────────────────────────────────┐
│  Post your truck                           ✕ │
│                                              │
│  🚐 Unit 1 · Sprinter Van · 150 mi · $2.25/mi │   ← one line, from the saved truck + prefs (tap = More details)
│                                              │
│  Where is the truck?                         │
│  [ TX ▾ ]  [ Decatur ______________ ]         │   ← state + city; last post's city preselected
│                                              │
│  Available                                   │
│  ( Today ) ( Tomorrow ) ( Pick dates… )      │   ← chips; "until" = from + 1 day unless Pick dates
│                                              │
│  ▸ More details (destination, ZIP, hours left, note)   ← collapsed; opens the 4 soft fields
│                                              │
│  [        Post availability        ]         │
│  Posted trucks expire after 24 h — tap        │
│  "Still available" tomorrow to keep it live.  │
└──────────────────────────────────────────────┘
```

- **Backhaul**: when the carrier has an active trip, the chip row gets `( Empty now ) ( Backhaul from <delivery city> )`
  with the delivery city + date prefilled from the trip — no "Kind" dropdown.
- **More details** (collapsed): Where I want to end up · ZIP · Drive hours left today · Note. Prefilled from the last post.
- **Multiple trucks**: a truck chip row appears above "Where is the truck?" (same component as Fleet).
- **Validation**: only city+state and a from-date; nothing else can block the post.
- Reuses `pocketPostAvailability` / the existing posting RPC unchanged — this is a different form over the same row.
- The "Still available" confirm tap (already on the Dashboard card) stays as is.

## 3. What it does NOT change

- `truck_postings` columns, the matcher, the dispatcher board, the 24 h expiry rule.
- The full form stays reachable (More details expands into it) — nothing is lost for carriers who want every field.

## 4. Build cost (if approved)

One file (`app/carrier/availability-quick.js`, ~250 lines) + the FAB / Dashboard card pointing at it; the old
`openPostingForm` stays as the expanded view. Half a day, no migration.
